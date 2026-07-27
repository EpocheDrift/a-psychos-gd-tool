import type { Doc, NodeInstance, ParamValue } from '../engine/graph';
import { registry } from '../nodes';
import type { ValidationMode } from '../domain/agentErrors';
import { CAPABILITY_MANIFEST } from '../domain/capabilityManifest';
import {
  createSerializedProject,
  type AssetMetadata,
  type SerializedProject,
  validateJsonValueSafety,
} from '../domain/documentSchema';
import {
  canonicalJsonStringify,
  cloneJsonValue,
  isPlainRecord,
  type JsonObject,
  type JsonValue,
} from '../domain/json';
import { DEFAULT_AGENT_LIMITS } from '../domain/limits';
import { PR7_DEFERRED_AGENT_NODE_TYPES } from '../domain/modelExecutionPolicy';
import { decodeBinds } from '../domain/paramCodecs';
import type { RenderStatus } from '../domain/renderCoordinator';
import { sha256Hex } from '../domain/sha256';
import { validateSerializedProject } from '../domain/semanticValidation';
import type {
  CapabilityInclude,
  AgentCapabilityProfile,
  CapabilityRequest,
  CapabilitySnapshot,
  DocumentInclude,
  DocumentRedaction,
  DocumentSnapshot,
  GetDocumentRequest,
  PublicRenderStatus,
  PublicRenderStatusRequest,
  PublicValidationReport,
  ValidateDocumentRequest,
} from './contracts';
import {
  AGENT_PROTOCOL_VERSION,
  AGENT_SCOPES,
  DOCUMENT_CONTENT_TRUST,
  AGENT_V1_AVAILABLE_SCOPES,
} from './contracts';
import { controllerFault } from './faults';
import {
  captureJsonObject,
  optionalBoolean,
  optionalNonNegativeInteger,
  optionalStringArray,
  own,
  publicJsonClone,
} from './jsonBoundary';
import {
  redactDiagnosticDetails,
  redactDiagnosticString,
} from './redaction';
import { sanitizeValidationReport } from './publicDiagnostics';

const CAPABILITY_INCLUDES = new Set<CapabilityInclude>([
  'sockets',
  'params',
  'traits',
]);
const DOCUMENT_INCLUDES = new Set<DocumentInclude>([
  'frame',
  'layers',
  'nodes',
  'edges',
  'positions',
]);
const VALIDATION_MODES = new Set<ValidationMode>([
  'structural',
  'editable',
  'renderable',
]);
const MAX_PUBLIC_RENDER_EVENTS = 256;
const DATA_URI = /^data:/i;
const EMBEDDED_DATA_URI = /data:[^\s"<>\\]+/giu;
const PR7_DEFERRED_AGENT_NODES = new Set<string>(
  PR7_DEFERRED_AGENT_NODE_TYPES,
);

function dataUriMimeType(value: string): string {
  const header = value.slice(5, Math.min(
    value.length,
    value.indexOf(',') >= 0 ? value.indexOf(',') : 261,
    261,
  ));
  const candidate = header.split(';', 1)[0]?.toLowerCase() ?? '';
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i
    .test(candidate)
    ? candidate
    : 'application/octet-stream';
}

function redactEmbeddedDataUris(
  value: string,
  path: string,
  redactions: DocumentRedaction[],
): JsonValue {
  const matches = [...value.matchAll(EMBEDDED_DATA_URI)];
  if (matches.length === 0) return value;
  for (const match of matches) {
    const encoded = match[0];
    redactions.push({
      path,
      kind: 'embedded-image-data',
      mimeType: dataUriMimeType(encoded),
      encodedCharacters: encoded.length,
      sha256: sha256Hex(`gfx.redacted-data-uri.v1\u0000${encoded}`),
    });
  }
  if (
    matches.length === 1
    && matches[0]!.index === 0
    && matches[0]![0].length === value.length
    && DATA_URI.test(value)
  ) {
    return {
      redacted: true,
      kind: 'embedded-image-data',
      mimeType: dataUriMimeType(value),
    };
  }
  return value.replace(
    EMBEDDED_DATA_URI,
    '[redacted embedded image data]',
  );
}

export interface ControllerDocumentState {
  documentId: string;
  document: Doc;
  assets?: AssetMetadata[];
  revision: number;
}

function asJson<T>(value: T): JsonValue {
  return cloneJsonValue(value as unknown as JsonValue);
}

function exactJsonEqual(left: JsonValue, right: JsonValue): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

export function getCapabilitiesQuery(
  raw: CapabilityRequest | undefined,
  revision: number,
  profile: AgentCapabilityProfile = { mcp: false },
): CapabilitySnapshot {
  const request = captureJsonObject(raw, {
    optional: true,
    allowedKeys: ['nodeTypes', 'include'],
    revision,
    label: 'Capability request',
    maxBytes: 64 * 1024,
  });
  const nodeTypes = optionalStringArray(request, 'nodeTypes', revision, {
    maximum: CAPABILITY_MANIFEST.nodes.length,
    unique: true,
  });
  const include = optionalStringArray(request, 'include', revision, {
    maximum: CAPABILITY_INCLUDES.size,
    allowed: CAPABILITY_INCLUDES,
    unique: true,
  }) as CapabilityInclude[] | undefined;
  const selectedTypes = nodeTypes ? new Set(nodeTypes) : null;
  if (selectedTypes) {
    const known = new Set(CAPABILITY_MANIFEST.nodes.map((node) => node.type));
    const unknown = nodeTypes!.find((type) => !known.has(type));
    if (unknown) {
      throw controllerFault(
        revision,
        'INVALID_ARGUMENT',
        `Unknown node type "${unknown}".`,
        { path: `/nodeTypes/${nodeTypes!.indexOf(unknown)}` },
      );
    }
  }
  const requested = new Set(include ?? []);
  const nodes = CAPABILITY_MANIFEST.nodes
    .filter((node) => !selectedTypes || selectedTypes.has(node.type))
    .map((node) => ({
      type: node.type,
      label: node.label,
      category: node.category,
      ...(requested.has('sockets')
        ? {
            inputs: node.inputs.map((socket) => asJson(socket)),
            outputs: node.outputs.map((socket) => asJson(socket)),
          }
        : {}),
      ...(requested.has('params')
        ? { params: node.params.map((param) => asJson(param)) }
        : {}),
      ...(requested.has('traits')
        ? {
            description: node.description,
            traits: {
              ...(asJson(node.traits) as JsonObject),
              agentExecution: asJson(
                PR7_DEFERRED_AGENT_NODES.has(node.type)
                  ? {
                      available: false,
                      rolloutGate: 'PR7',
                      reason:
                        'Deferred until asset/model/resource policy is complete.',
                    }
                  : { available: true },
              ),
            },
            execution: asJson(node.execution) as JsonObject,
          }
        : {}),
    }));
  const available = new Set(AGENT_V1_AVAILABLE_SCOPES);
  const scopeAvailability = Object.fromEntries(
    AGENT_SCOPES.map((scope) => [
      scope,
      available.has(scope as (typeof AGENT_V1_AVAILABLE_SCOPES)[number])
        ? { available: true }
        : {
            available: false,
            reason:
              scope === 'model'
                ? 'Model execution remains blocked until PR7 pins and verifies model bytes.'
                : `${scope} tools remain blocked until their later rollout gate.`,
          },
    ]),
  ) as CapabilitySnapshot['scopeAvailability'];
  const omitted: string[] = [];
  if (!requested.has('sockets')) omitted.push('nodes[].inputs', 'nodes[].outputs');
  if (!requested.has('params')) omitted.push('nodes[].params');
  if (!requested.has('traits')) {
    omitted.push('nodes[].description', 'nodes[].traits', 'nodes[].execution');
  }
  return publicJsonClone({
    protocolVersion: AGENT_PROTOCOL_VERSION,
    documentSchemaVersions: [...CAPABILITY_MANIFEST.documentSchemaVersions],
    socketTypes: [...CAPABILITY_MANIFEST.socketTypes],
    nodes,
    limits: { ...CAPABILITY_MANIFEST.limits },
    features: {
      ...CAPABILITY_MANIFEST.features,
      mcp: profile.mcp,
    },
    preview: asJson(CAPABILITY_MANIFEST.preview) as JsonObject,
    permissions: asJson(CAPABILITY_MANIFEST.permissions) as JsonObject,
    ...(profile.transport
      ? { transport: publicJsonClone(profile.transport) }
      : {}),
    scopeAvailability,
    omitted,
  });
}

function publicParamValue(
  node: NodeInstance,
  name: string,
  value: ParamValue,
  path: string,
  redactions: DocumentRedaction[],
): JsonValue {
  if (typeof value === 'string') {
    const redacted = redactEmbeddedDataUris(value, path, redactions);
    if (redacted !== value) return redacted;
  }
  const definition = registry.get(node.type);
  const spec = definition?.params.find((candidate) => candidate.name === name);
  if (spec?.kind === 'binds') {
    const decoded = decodeBinds(
      value,
      DEFAULT_AGENT_LIMITS.maxBinds,
      DEFAULT_AGENT_LIMITS.maxStringBytes,
      DEFAULT_AGENT_LIMITS.maxIdLength,
    );
    if (decoded.ok) return decoded.value as unknown as JsonValue;
  }
  return value;
}

function publicDefaultValue(nodeType: string, name: string): JsonValue | undefined {
  const spec = registry.get(nodeType)?.params.find((candidate) => candidate.name === name);
  if (!spec) return undefined;
  if (spec.kind === 'binds') {
    const decoded = decodeBinds(
      spec.default,
      DEFAULT_AGENT_LIMITS.maxBinds,
      DEFAULT_AGENT_LIMITS.maxStringBytes,
      DEFAULT_AGENT_LIMITS.maxIdLength,
    );
    return decoded.ok ? decoded.value as unknown as JsonValue : spec.default;
  }
  return spec.default;
}

export function getDocumentQuery(
  state: ControllerDocumentState,
  raw: GetDocumentRequest | undefined,
): DocumentSnapshot {
  const request = captureJsonObject(raw, {
    optional: true,
    allowedKeys: ['revision', 'layerIds', 'include', 'compact'],
    revision: state.revision,
    label: 'Document request',
    maxBytes: 64 * 1024,
  });
  const requestedRevision = optionalNonNegativeInteger(
    request,
    'revision',
    state.revision,
  );
  if (
    requestedRevision !== undefined
    && requestedRevision !== state.revision
  ) {
    throw controllerFault(
      state.revision,
      'REVISION_CONFLICT',
      `Only current revision ${state.revision} is available.`,
      {
        path: '/revision',
        details: {
          requestedRevision,
          currentRevision: state.revision,
        },
      },
    );
  }
  const layerIds = optionalStringArray(request, 'layerIds', state.revision, {
    maximum: DEFAULT_AGENT_LIMITS.maxLayers,
    unique: true,
  });
  const include = optionalStringArray(request, 'include', state.revision, {
    maximum: DOCUMENT_INCLUDES.size,
    allowed: DOCUMENT_INCLUDES,
    unique: true,
  }) as DocumentInclude[] | undefined;
  const compact = optionalBoolean(request, 'compact', state.revision, false);
  const included = new Set<DocumentInclude>(
    include ?? ['frame', 'layers', 'nodes', 'edges', 'positions'],
  );
  const selectedLayerIds = layerIds ? new Set(layerIds) : null;
  if (selectedLayerIds) {
    const known = new Set(state.document.layers.map((layer) => layer.id));
    const unknown = layerIds!.find((layerId) => !known.has(layerId));
    if (unknown) {
      throw controllerFault(
        state.revision,
        'INVALID_ARGUMENT',
        `Unknown layer "${unknown}".`,
        { path: `/layerIds/${layerIds!.indexOf(unknown)}` },
      );
    }
  }

  const redactions: DocumentRedaction[] = [];
  const omitted: string[] = [];
  const response: DocumentSnapshot = {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    schemaVersion: 4,
    revision: state.revision,
    documentId: state.documentId,
    trust: DOCUMENT_CONTENT_TRUST,
    omitted,
    redactions,
  };
  if (included.has('frame')) {
    response.frame = { ...state.document.frame };
  } else {
    omitted.push('/frame');
  }
  const needsLayerShell = [...included].some((item) =>
    item === 'layers'
    || item === 'nodes'
    || item === 'edges'
    || item === 'positions');
  if (!needsLayerShell) {
    omitted.push('/layers');
    return publicJsonClone(response);
  }

  response.layers = state.document.layers
    .filter((layer) => !selectedLayerIds || selectedLayerIds.has(layer.id))
    .map((layer, layerIndex): JsonValue => {
      const projected = Object.create(null) as JsonObject;
      projected.id = layer.id;
      if (included.has('layers')) {
        projected.name = redactEmbeddedDataUris(
          layer.name,
          `/layers/${layerIndex}/name`,
          redactions,
        );
        projected.visible = layer.visible;
        projected.opacity = layer.opacity;
        projected.blendMode = layer.blendMode;
      }
      const graph = Object.create(null) as JsonObject;
      if (included.has('nodes') || included.has('positions')) {
        graph.nodes = Object.values(layer.graph.nodes)
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((node): JsonValue => {
            const projectedNode = Object.create(null) as JsonObject;
            projectedNode.id = node.id;
            projectedNode.type = node.type;
            const params = Object.create(null) as JsonObject;
            for (const name of Object.keys(node.params).sort()) {
              const path = `/layers/${layerIndex}/graph/nodes/${node.id}/params/${name}`;
              const value = publicParamValue(
                node,
                name,
                node.params[name],
                path,
                redactions,
              );
              const defaultValue = publicDefaultValue(node.type, name);
              if (
                compact
                && defaultValue !== undefined
                && exactJsonEqual(value, defaultValue)
              ) {
                omitted.push(path);
                continue;
              }
              params[name] = value;
            }
            projectedNode.params = params;
            if (included.has('positions') && !compact && node.position) {
              projectedNode.position = {
                x: node.position.x,
                y: node.position.y,
              };
            } else if (node.position) {
              omitted.push(`/layers/${layerIndex}/graph/nodes/${node.id}/position`);
            }
            return projectedNode;
          });
      }
      if (included.has('edges')) {
        graph.edges = layer.graph.edges.map((edge) => asJson(edge));
      }
      projected.graph = graph;
      return projected;
    });
  if (!included.has('layers')) omitted.push('/layers/*/(name,visible,opacity,blendMode)');
  if (!included.has('nodes') && !included.has('positions')) {
    omitted.push('/layers/*/graph/nodes');
  }
  if (!included.has('edges')) omitted.push('/layers/*/graph/edges');
  if (compact) omitted.push('default-valued node parameters', 'editor positions');
  return publicJsonClone(response);
}

export interface ValidationDocumentEvaluation {
  result: PublicValidationReport;
  assets: AssetMetadata[];
  maxFindings: number;
}

export function evaluateValidationDocumentQuery(
  state: ControllerDocumentState,
  raw: ValidateDocumentRequest,
): ValidationDocumentEvaluation {
  const request = captureJsonObject(raw, {
    allowedKeys: ['source', 'project', 'mode', 'maxFindings'],
    revision: state.revision,
    label: 'Validation request',
    maxBytes: DEFAULT_AGENT_LIMITS.maxTransactionJsonBytes,
  });
  const source = own(request, 'source');
  if (source !== 'current' && source !== 'project') {
    throw controllerFault(
      state.revision,
      'INVALID_ARGUMENT',
      'source must be "current" or "project".',
      { path: '/source' },
    );
  }
  const modeValue = own(request, 'mode');
  const mode: ValidationMode = modeValue === undefined
    ? 'renderable'
    : typeof modeValue === 'string' && VALIDATION_MODES.has(modeValue as ValidationMode)
      ? modeValue as ValidationMode
      : (() => {
          throw controllerFault(
            state.revision,
            'INVALID_ARGUMENT',
            'mode must be "structural", "editable", or "renderable".',
            { path: '/mode' },
          );
        })();
  const maxFindingsValue = optionalNonNegativeInteger(
    request,
    'maxFindings',
    state.revision,
  );
  if (
    maxFindingsValue !== undefined
    && (maxFindingsValue < 1 || maxFindingsValue > DEFAULT_AGENT_LIMITS.maxFindings)
  ) {
    throw controllerFault(
      state.revision,
      'INVALID_ARGUMENT',
      `maxFindings must be between 1 and ${DEFAULT_AGENT_LIMITS.maxFindings}.`,
      { path: '/maxFindings' },
    );
  }
  const rawProject = own(request, 'project');
  let project: SerializedProject | JsonValue;
  if (source === 'current') {
    if (rawProject !== undefined) {
      throw controllerFault(
        state.revision,
        'INVALID_ARGUMENT',
        'project is allowed only when source is "project".',
        { path: '/project' },
      );
    }
    project = createSerializedProject(
      state.documentId,
      state.document,
      state.assets,
    );
  } else {
    if (rawProject === undefined) {
      throw controllerFault(
        state.revision,
        'INVALID_ARGUMENT',
        'project is required when source is "project".',
        { path: '/project' },
      );
    }
    project = rawProject;
  }
  const report = validateSerializedProject(project, {
    mode,
    ...(maxFindingsValue === undefined
      ? {}
      : { maxFindings: maxFindingsValue }),
  });
  const projectAssets = isPlainRecord(project)
    && Array.isArray(project.assets)
    ? project.assets
      .filter((asset): asset is JsonObject => isPlainRecord(asset))
      .map((asset) => ({ ...asset } as unknown as AssetMetadata))
    : [];
  return {
    result: publicJsonClone({
      trust: DOCUMENT_CONTENT_TRUST,
      report: sanitizeValidationReport(report),
    }),
    assets: report.valid && mode === 'renderable' ? projectAssets : [],
    maxFindings: maxFindingsValue ?? DEFAULT_AGENT_LIMITS.maxFindings,
  };
}

export function validateDocumentQuery(
  state: ControllerDocumentState,
  raw: ValidateDocumentRequest,
): PublicValidationReport {
  return evaluateValidationDocumentQuery(state, raw).result;
}

export function normalizeRenderStatusRequest(
  raw: PublicRenderStatusRequest | undefined,
  revision: number,
): {
  request: { revision?: number; attempt?: number };
  includeEvents: boolean;
} {
  const value = captureJsonObject(raw, {
    optional: true,
    allowedKeys: ['revision', 'attempt', 'includeEvents'],
    revision,
    label: 'Render-status request',
    maxBytes: 16 * 1024,
  });
  const requestedRevision = optionalNonNegativeInteger(value, 'revision', revision);
  const attempt = optionalNonNegativeInteger(value, 'attempt', revision);
  if (attempt === 0) {
    throw controllerFault(
      revision,
      'INVALID_ARGUMENT',
      'attempt must be a positive safe integer.',
      { path: '/attempt' },
    );
  }
  if (attempt !== undefined && requestedRevision === undefined) {
    throw controllerFault(
      revision,
      'INVALID_ARGUMENT',
      'attempt requires revision.',
      { path: '/attempt' },
    );
  }
  return {
    request: {
      ...(requestedRevision === undefined ? {} : { revision: requestedRevision }),
      ...(attempt === undefined ? {} : { attempt }),
    },
    includeEvents: optionalBoolean(value, 'includeEvents', revision, false),
  };
}

function safeRenderError(
  error: RenderStatus['error'],
  documentRevision: number,
): JsonObject | undefined {
  if (!error) return undefined;
  const detailsSafety = error.details === undefined
    ? null
    : validateJsonValueSafety(error.details, { maxFindings: 1 });
  const details = detailsSafety?.valid && isPlainRecord(error.details)
    ? redactDiagnosticDetails(error.details as Record<string, JsonValue>)
    : undefined;
  const suggestedFix = (() => {
    if (!error.recoverable) return undefined;
    if (error.code === 'RENDER_SUPERSEDED') {
      return 'This attempt was superseded by a newer render. Query gfx_get_render_status or gfx_await_render for the current revision and exact ticket; do not revert solely because an older attempt was superseded.';
    }
    if (error.code === 'WEBGPU_UNAVAILABLE') {
      return 'Restore WebGPU support in a compatible browser or environment, then re-read the document and request its current render status; changing or reverting the document will not repair the renderer.';
    }
    if (
      error.code === 'MODEL_DOWNLOAD_REQUIRED'
      || error.code === 'CONFIRMATION_REQUIRED'
    ) {
      return 'Query gfx_get_model_status, call gfx_prepare_model, and complete any required human confirmation before requesting the render again.';
    }
    if (error.code === 'PERMISSION_REQUIRED') {
      return 'Re-pair with the scope named by the public error, then re-read the current document and render status.';
    }
    if (error.revision !== documentRevision) {
      return 'A newer document revision exists. Re-read the document and render status before choosing a recovery; do not revert across intervening edits.';
    }
    if ([
      'RENDER_FAILED',
      'RESOURCE_LIMIT',
      'TIMEOUT',
      'OUTPUT_MISSING',
      'OUTPUT_AMBIGUOUS',
      'REQUIRED_INPUT_MISSING',
      'INVARIANT_VIOLATION',
      'ASSET_POLICY_VIOLATION',
    ].includes(error.code)) {
      return 'If this failure came from your latest committed transaction and no newer edit exists, call gfx_revert_transaction with that transactionId, the current revision, and a new requestId.';
    }
    return 'Re-read the current document and exact render status, correct the reported cause with a new requestId, and avoid reverting across intervening edits.';
  })();
  return {
    code: error.code,
    message: redactDiagnosticString(error.message),
    revision: error.revision,
    attempt: error.attempt,
    recoverable: error.recoverable,
    ...(error.layerId ? { layerId: error.layerId } : {}),
    ...(error.nodeId ? { nodeId: error.nodeId } : {}),
    ...(error.nodeType ? { nodeType: error.nodeType } : {}),
    ...(error.phase ? { phase: error.phase } : {}),
    ...(details ? { details } : {}),
    ...(suggestedFix ? { suggestedFix } : {}),
  };
}

export function publicRenderStatus(
  status: RenderStatus,
  includeEvents: boolean,
): PublicRenderStatus {
  const omitted: string[] = [];
  const events = status.events?.slice(0, MAX_PUBLIC_RENDER_EVENTS);
  if (!includeEvents && status.events) omitted.push('/events');
  if (
    includeEvents
    && status.events
    && status.events.length > MAX_PUBLIC_RENDER_EVENTS
  ) {
    omitted.push(`/events/${MAX_PUBLIC_RENDER_EVENTS}+`);
  }
  return publicJsonClone({
    documentRevision: status.documentRevision,
    ticket: status.ticket ? { ...status.ticket } : null,
    displayedTicket: status.displayedTicket ? { ...status.displayedTicket } : null,
    displayedRevision: status.displayedRevision,
    requestedRevision: status.requestedRevision,
    renderRevision: status.renderRevision,
    state: status.state,
    ...(status.queuedAt ? { queuedAt: status.queuedAt } : {}),
    ...(status.startedAt ? { startedAt: status.startedAt } : {}),
    ...(status.completedAt ? { completedAt: status.completedAt } : {}),
    ...(status.width === undefined ? {} : { width: status.width }),
    ...(status.height === undefined ? {} : { height: status.height }),
    ...(status.error
      ? { error: safeRenderError(status.error, status.documentRevision)! }
      : {}),
    ...(includeEvents && events
      ? { events: events.map((event) => asJson(event)) }
      : {}),
    omitted,
  });
}
