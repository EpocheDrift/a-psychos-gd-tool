import { DEFAULT_FRAME } from '../engine/graph';
import {
  FindingCollector,
  type ValidationFinding,
  type ValidationReport,
} from './agentErrors';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_DOCUMENT_ID,
  PROJECT_FORMAT,
  type SerializedProjectV3,
  validateJsonValueSafety,
  validateSerializedProjectStructure,
} from './documentSchema';
import {
  MISSING,
  cloneJsonValue,
  hasOwnData,
  isPlainRecord,
  joinJsonPointer,
  readOwnData,
  utf8ByteLength,
  type JsonValue,
} from './json';
import { resolveAgentLimits, type AgentLimits } from './limits';
import { isSafeId } from './paramCodecs';

export type MigrationSource =
  | 'legacy-single-graph'
  | 'legacy-layered-document'
  | 'project-v3';

export type MigrationResult =
  | {
      ok: true;
      source: MigrationSource;
      project: SerializedProjectV3;
      warnings: ValidationFinding[];
      truncated?: true;
    }
  | {
      ok: false;
      report: ValidationReport;
    };

export interface MigrationOptions {
  documentIdForLegacy?: string;
  limits?: Partial<AgentLimits>;
  maxFindings?: number;
}

function failure(
  limits: AgentLimits,
  input: Parameters<FindingCollector['error']>[0],
  maxFindings?: number,
): MigrationResult {
  const collector = new FindingCollector(maxFindings ?? limits.maxFindings);
  collector.error(input);
  return { ok: false, report: collector.report('structural', null) };
}

function warning(
  collector: FindingCollector,
  code: 'LEGACY_FORMAT_MIGRATED' | 'VALUE_NORMALIZED' | 'DEPRECATED_VALUE_MIGRATED',
  path: string,
  message: string,
  details?: Record<string, JsonValue>,
): void {
  collector.warning({
    code,
    path,
    message,
    ...(details ? { details } : {}),
  });
}

function mutableRecord(value: JsonValue): Record<string, JsonValue> | null {
  return isPlainRecord(value) ? value as Record<string, JsonValue> : null;
}

function rewriteLegacyBinds(
  params: Record<string, JsonValue>,
  paramPath: string,
  collector: FindingCollector,
  limits: AgentLimits,
): void {
  const raw = readOwnData(params, 'binds');
  if (typeof raw !== 'string') return;
  // Legacy normalization must not parse an unbounded nested JSON string before
  // the ordinary parameter budget has had a chance to reject it.
  if (utf8ByteLength(raw) > limits.maxStringBytes) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  let changed = false;
  parsed.forEach((row, index) => {
    if (!isPlainRecord(row) || readOwnData(row, 'channel') !== 'image') return;
    row.channel = 'image luma';
    changed = true;
    warning(
      collector,
      'DEPRECATED_VALUE_MIGRATED',
      paramPath,
      'Place bind channel "image" migrated to "image luma".',
      { decodedPath: `/${index}/channel`, before: 'image', after: 'image luma' },
    );
  });
  if (changed) params.binds = JSON.stringify(parsed);
}

function migrateLegacyGraph(
  graphValue: JsonValue,
  graphPath: string,
  collector: FindingCollector,
  limits: AgentLimits,
): void {
  const graph = mutableRecord(graphValue);
  if (!graph) return;
  const nodesValue = readOwnData(graph, 'nodes');
  const nodes = isPlainRecord(nodesValue) ? nodesValue as Record<string, JsonValue> : null;
  if (!nodes) return;

  let hasLegacyImageWeight = false;
  let hasCurrentImageLumaWeight = false;
  for (const nodeId of Object.keys(nodes).sort()) {
    const node = mutableRecord(nodes[nodeId]);
    if (!node) continue;
    const type = readOwnData(node, 'type');
    const paramsValue = readOwnData(node, 'params');
    const params = isPlainRecord(paramsValue) ? paramsValue as Record<string, JsonValue> : null;
    if (!params) continue;
    if (type === 'Weight') {
      const source = readOwnData(params, 'source');
      if (source === 'image') hasLegacyImageWeight = true;
      if (source === 'image luma') hasCurrentImageLumaWeight = true;
    }
  }

  for (const nodeId of Object.keys(nodes).sort()) {
    const node = mutableRecord(nodes[nodeId]);
    if (!node) continue;
    const type = readOwnData(node, 'type');
    const paramsValue = readOwnData(node, 'params');
    const params = isPlainRecord(paramsValue) ? paramsValue as Record<string, JsonValue> : null;
    if (!params) continue;
    const paramsPath = joinJsonPointer(
      joinJsonPointer(joinJsonPointer(graphPath, 'nodes'), nodeId),
      'params',
    );

    if (type === 'Weight' && readOwnData(params, 'source') === 'image') {
      params.source = 'image luma';
      warning(
        collector,
        'DEPRECATED_VALUE_MIGRATED',
        `${paramsPath}/source`,
        'Weight source "image" migrated to "image luma".',
        { before: 'image', after: 'image luma' },
      );
    }
    if (type === 'Random' && hasOwnData(params, 'count')) {
      delete params.count;
      warning(
        collector,
        'DEPRECATED_VALUE_MIGRATED',
        `${paramsPath}/count`,
        'Removed the retired Random.count parameter.',
        { removed: 'count' },
      );
    }
    if (hasLegacyImageWeight && type === 'Filter' && readOwnData(params, 'channel') === 'image') {
      params.channel = 'image luma';
      warning(
        collector,
        'DEPRECATED_VALUE_MIGRATED',
        `${paramsPath}/channel`,
        'Filter channel "image" migrated with its legacy Weight source.',
        { before: 'image', after: 'image luma' },
      );
    }
    if (hasLegacyImageWeight && type === 'Place') {
      rewriteLegacyBinds(params, joinJsonPointer(paramsPath, 'binds'), collector, limits);
    }
  }

  if (hasLegacyImageWeight && hasCurrentImageLumaWeight) {
    warning(
      collector,
      'VALUE_NORMALIZED',
      joinJsonPointer(graphPath, 'nodes'),
      'Legacy and current Weight nodes now share the "image luma" channel; review downstream ordering.',
      { channel: 'image luma', collision: true },
    );
  }
}

function normalizeLegacyLayer(
  layerValue: JsonValue,
  layerIndex: number,
  collector: FindingCollector,
  limits: AgentLimits,
): void {
  const layer = mutableRecord(layerValue);
  if (!layer) return;
  const layerPath = `/document/layers/${layerIndex}`;
  const defaults: Array<[string, JsonValue]> = [
    ['name', `Layer ${layerIndex + 1}`],
    ['visible', true],
    ['opacity', 1],
    ['blendMode', 'normal'],
  ];
  for (const [key, defaultValue] of defaults) {
    if (!hasOwnData(layer, key)) {
      layer[key] = defaultValue;
      warning(
        collector,
        'VALUE_NORMALIZED',
        joinJsonPointer(layerPath, key),
        `Missing legacy layer ${key} received its default value.`,
        { field: key },
      );
    }
  }
  const graphValue = readOwnData(layer, 'graph');
  const graph = isPlainRecord(graphValue) ? graphValue as Record<string, JsonValue> : null;
  if (!graph) return;
  if (hasOwnData(graph, 'frame')) {
    delete graph.frame;
    warning(
      collector,
      'VALUE_NORMALIZED',
      `${layerPath}/graph/frame`,
      'Removed legacy per-graph frame; the document frame is authoritative.',
      { removed: 'frame' },
    );
  }
  migrateLegacyGraph(graph, `${layerPath}/graph`, collector, limits);
}

function migrateLegacyLayered(
  value: JsonValue,
  documentId: string,
  collector: FindingCollector,
  limits: AgentLimits,
): SerializedProjectV3 {
  const document = cloneJsonValue(value) as unknown as Record<string, JsonValue>;
  if (!hasOwnData(document, 'frame')) {
    document.frame = { ...DEFAULT_FRAME };
    warning(
      collector,
      'VALUE_NORMALIZED',
      '/document/frame',
      'Missing legacy document frame received the default frame.',
    );
  }
  const layers = readOwnData(document, 'layers');
  if (Array.isArray(layers)) {
    layers.forEach((layer, index) => normalizeLegacyLayer(layer, index, collector, limits));
  }
  warning(
    collector,
    'LEGACY_FORMAT_MIGRATED',
    '',
    'Layered localStorage document migrated into the version 3 project envelope.',
    { source: 'gfx.document.v2', targetSchemaVersion: CURRENT_SCHEMA_VERSION },
  );
  return {
    format: PROJECT_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    documentId,
    document: document as unknown as SerializedProjectV3['document'],
  };
}

function migrateLegacySingleGraph(
  value: JsonValue,
  documentId: string,
  collector: FindingCollector,
  limits: AgentLimits,
): SerializedProjectV3 {
  const graph = cloneJsonValue(value) as unknown as Record<string, JsonValue>;
  const legacyFrame = readOwnData(graph, 'frame');
  const frame = legacyFrame === MISSING ? { ...DEFAULT_FRAME } : cloneJsonValue(legacyFrame as JsonValue);
  if (legacyFrame === MISSING) {
    warning(
      collector,
      'VALUE_NORMALIZED',
      '/document/frame',
      'Missing legacy graph frame received the default frame.',
    );
  }
  if (hasOwnData(graph, 'frame')) delete graph.frame;
  migrateLegacyGraph(graph, '/document/layers/0/graph', collector, limits);
  warning(
    collector,
    'LEGACY_FORMAT_MIGRATED',
    '',
    'Single-graph localStorage document migrated into one version 3 layer.',
    { source: 'gfx.document.v1', targetSchemaVersion: CURRENT_SCHEMA_VERSION },
  );
  return {
    format: PROJECT_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    documentId,
    document: {
      frame: frame as unknown as SerializedProjectV3['document']['frame'],
      layers: [{
        id: 'layer_1',
        name: 'Layer 1',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        graph: graph as unknown as SerializedProjectV3['document']['layers'][number]['graph'],
      }],
    },
  };
}

export function migrateProject(
  value: unknown,
  options: MigrationOptions = {},
): MigrationResult {
  const limits = resolveAgentLimits(options.limits);
  const safety = validateJsonValueSafety(value, {
    limits,
    maxFindings: options.maxFindings,
  });
  if (!safety.valid) return { ok: false, report: safety };
  if (!isPlainRecord(value)) {
    return failure(limits, {
      code: 'INVALID_ARGUMENT',
      message: 'Project or legacy document must be an object.',
      path: '',
    }, options.maxFindings);
  }

  const hasEnvelopeMarker = ['format', 'schemaVersion', 'documentId', 'document']
    .some((key) => hasOwnData(value, key));
  if (hasEnvelopeMarker) {
    const version = readOwnData(value, 'schemaVersion');
    if (typeof version === 'number' && Number.isInteger(version) && version !== CURRENT_SCHEMA_VERSION) {
      return failure(limits, {
        code: 'UNSUPPORTED_SCHEMA_VERSION',
        message: `Schema version ${version} is not supported by this build.`,
        path: '/schemaVersion',
        recoverable: false,
        details: { supportedVersions: [CURRENT_SCHEMA_VERSION] },
      }, options.maxFindings);
    }
    const structural = validateSerializedProjectStructure(value, {
      limits,
      maxFindings: options.maxFindings,
    });
    if (!structural.valid) return { ok: false, report: structural };
    return {
      ok: true,
      source: 'project-v3',
      project: cloneJsonValue(value as JsonValue) as unknown as SerializedProjectV3,
      warnings: [],
    };
  }

  const layeredMarker = hasOwnData(value, 'layers');
  const graphMarker = hasOwnData(value, 'nodes') || hasOwnData(value, 'edges');
  if (layeredMarker === graphMarker) {
    return failure(limits, {
      code: 'INVALID_ARGUMENT',
      message: layeredMarker
        ? 'Legacy payload is ambiguous because it contains document and graph markers.'
        : 'Value is neither a recognized project nor a supported legacy document.',
      path: '',
    }, options.maxFindings);
  }

  const documentId = options.documentIdForLegacy ?? DEFAULT_DOCUMENT_ID;
  if (!isSafeId(documentId, limits.maxIdLength)) {
    return failure(limits, {
      code: 'INVALID_ARGUMENT',
      message: 'Legacy migration requires a safe caller-supplied document ID.',
      path: '/documentId',
    }, options.maxFindings);
  }

  const collector = new FindingCollector(options.maxFindings ?? limits.maxFindings);
  const cloned = cloneJsonValue(value as JsonValue);
  const project = layeredMarker
    ? migrateLegacyLayered(cloned, documentId, collector, limits)
    : migrateLegacySingleGraph(cloned, documentId, collector, limits);
  return {
    ok: true,
    source: layeredMarker ? 'legacy-layered-document' : 'legacy-single-graph',
    project,
    warnings: collector.warnings,
    ...(collector.truncated ? { truncated: true } : {}),
  };
}
