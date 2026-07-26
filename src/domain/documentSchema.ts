import {
  BLEND_MODES,
  type Doc,
} from '../engine/graph';
import {
  FindingCollector,
  type ValidationReport,
} from './agentErrors';
import {
  MISSING,
  isPlainRecord,
  joinJsonPointer,
  jsonTypeOf,
  readOwnData,
  utf8ByteLength,
} from './json';
import {
  DEFAULT_AGENT_LIMITS,
  resolveAgentLimits,
  type AgentLimits,
} from './limits';
import { isSafeId } from './paramCodecs';

export const PROJECT_FORMAT = 'a-psychos-gd-tool' as const;
export const CURRENT_SCHEMA_VERSION = 3 as const;
export const DEFAULT_DOCUMENT_ID = 'document_1';

export interface AssetMetadata {
  id: string;
  sha256: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  byteLength: number;
  width: number;
  height: number;
  source: 'upload' | 'generated' | 'bundled';
}

export interface SerializedProjectV3 {
  format: typeof PROJECT_FORMAT;
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  documentId: string;
  document: Doc;
  assets?: AssetMetadata[];
}

export interface StructuralValidationOptions {
  limits?: Partial<AgentLimits>;
  maxFindings?: number;
}

interface ScanState {
  visitedValues: number;
  stopped: boolean;
  traversalSafe: boolean;
}

export interface JsonSafetyInspection {
  report: ValidationReport;
  /**
   * False when continuing into schema or semantic traversal could invoke
   * accessors, recurse through cycles, or rely on malformed containers.
   * Invalid scalar values (for example Infinity) remain traversable so
   * independent sibling findings can still be collected.
   */
  traversalSafe: boolean;
}

const MAX_JSON_DEPTH = 128;
const MAX_SCANNED_VALUES = 200_000;

function scanJsonSafety(
  value: unknown,
  path: string,
  collector: FindingCollector,
  ancestors: WeakSet<object>,
  state: ScanState,
  depth: number,
): void {
  if (state.stopped) return;
  state.visitedValues++;
  if (state.visitedValues > MAX_SCANNED_VALUES) {
    collector.error({
      code: 'RESOURCE_LIMIT',
      message: 'JSON value contains too many nested values to validate safely.',
      path,
      details: { maximumValues: MAX_SCANNED_VALUES },
    });
    state.stopped = true;
    state.traversalSafe = false;
    return;
  }
  if (depth > MAX_JSON_DEPTH) {
    collector.error({
      code: 'RESOURCE_LIMIT',
      message: 'JSON nesting exceeds the safe validation depth.',
      path,
      details: { maximumDepth: MAX_JSON_DEPTH },
    });
    state.traversalSafe = false;
    return;
  }

  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      collector.error({
        code: 'INVALID_ARGUMENT',
        message: 'JSON numbers must be finite.',
        path,
      });
    }
    return;
  }
  if (typeof value !== 'object') {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: `Value of type ${typeof value} is not JSON-safe.`,
      path,
      details: { actualType: typeof value },
    });
    return;
  }

  const object = value as object;
  const prototype = Object.getPrototypeOf(object);
  const validPrototype = Array.isArray(value)
    ? prototype === Array.prototype
    : prototype === Object.prototype || prototype === null;
  if (!validPrototype) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: 'Only arrays and plain objects are accepted as JSON containers.',
      path,
    });
    state.traversalSafe = false;
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_SCANNED_VALUES) {
      collector.error({
        code: 'RESOURCE_LIMIT',
        message: 'JSON array length exceeds the safe validation budget.',
        path,
        details: { actualLength: value.length, maximumLength: MAX_SCANNED_VALUES },
      });
      state.stopped = true;
      state.traversalSafe = false;
      return;
    }
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) {
        collector.error({
          code: 'INVALID_ARGUMENT',
          message: 'Sparse arrays are not accepted as JSON values.',
          path: joinJsonPointer(path, index),
        });
        state.traversalSafe = false;
        return;
      }
    }
  }
  if (ancestors.has(object)) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: 'Cyclic object references are not JSON-safe.',
      path,
    });
    state.traversalSafe = false;
    return;
  }

  ancestors.add(object);
  const ownKeys = Reflect.ownKeys(object);
  for (const key of ownKeys) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key === 'symbol') {
      collector.error({
        code: 'INVALID_ARGUMENT',
        message: 'Symbol keys are not JSON-safe.',
        path,
      });
      state.traversalSafe = false;
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    const childPath = joinJsonPointer(path, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      collector.error({
        code: 'INVALID_ARGUMENT',
        message: 'Accessors and non-enumerable data are not accepted in imported JSON.',
        path: childPath,
      });
      state.traversalSafe = false;
      continue;
    }
    if (Array.isArray(value)) {
      const index = Number(key);
      const canonicalIndex = Number.isSafeInteger(index)
        && index >= 0
        && index < value.length
        && String(index) === key;
      if (!canonicalIndex) {
        collector.error({
          code: 'INVALID_ARGUMENT',
          message: 'Arrays cannot contain named or non-canonical index properties.',
          path: childPath,
        });
        state.traversalSafe = false;
        continue;
      }
    }
    scanJsonSafety(descriptor.value, childPath, collector, ancestors, state, depth + 1);
  }
  ancestors.delete(object);
}

export function validateJsonValueSafety(
  value: unknown,
  options: StructuralValidationOptions = {},
): ValidationReport {
  return inspectJsonValueSafety(value, options).report;
}

export function inspectJsonValueSafety(
  value: unknown,
  options: StructuralValidationOptions = {},
): JsonSafetyInspection {
  const limits = resolveAgentLimits(options.limits);
  const collector = new FindingCollector(options.maxFindings ?? limits.maxFindings);
  const state: ScanState = {
    visitedValues: 0,
    stopped: false,
    traversalSafe: true,
  };
  scanJsonSafety(value, '', collector, new WeakSet(), state, 0);
  return {
    report: collector.report('structural', null),
    traversalSafe: state.traversalSafe,
  };
}

function rejectUnknownFields(
  object: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  collector: FindingCollector,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(object).sort()) {
    if (!allowedSet.has(key)) {
      collector.error({
        code: 'INVALID_ARGUMENT',
        message: `Unknown field "${key}".`,
        path: joinJsonPointer(path, key),
      });
    }
  }
}

function requireField(
  object: Record<string, unknown>,
  key: string,
  path: string,
  collector: FindingCollector,
): unknown | typeof MISSING {
  const value = readOwnData(object, key);
  if (value === MISSING) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: `Required field "${key}" is missing.`,
      path: joinJsonPointer(path, key),
    });
  }
  return value;
}

function validateId(
  value: unknown,
  path: string,
  collector: FindingCollector,
  limits: AgentLimits,
): value is string {
  if (typeof value !== 'string') {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: 'ID must be a string.',
      path,
      details: { actualType: jsonTypeOf(value) },
    });
    return false;
  }
  if (!isSafeId(value, limits.maxIdLength)) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: `ID must be ASCII-safe, at most ${limits.maxIdLength} characters, and not prototype-sensitive.`,
      path,
      details: { actualLength: value.length, maximumLength: limits.maxIdLength },
    });
    return false;
  }
  return true;
}

function validateFrame(
  value: unknown,
  path: string,
  collector: FindingCollector,
  limits: AgentLimits,
): void {
  if (!isPlainRecord(value)) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: 'Frame must be an object.',
      path,
      details: { actualType: jsonTypeOf(value) },
    });
    return;
  }
  rejectUnknownFields(value, ['width', 'height'], path, collector);
  const width = requireField(value, 'width', path, collector);
  const height = requireField(value, 'height', path, collector);
  for (const [name, side] of [['width', width], ['height', height]] as const) {
    const sidePath = joinJsonPointer(path, name);
    if (typeof side !== 'number' || !Number.isSafeInteger(side)) {
      collector.error({
        code: 'INVALID_ARGUMENT',
        message: 'Frame dimensions must be finite integers.',
        path: sidePath,
      });
    } else if (side < limits.minFrameSide || side > limits.maxFrameSide) {
      collector.error({
        code: 'RESOURCE_LIMIT',
        message: `Frame dimension must be between ${limits.minFrameSide} and ${limits.maxFrameSide}.`,
        path: sidePath,
        details: {
          actual: side,
          minimum: limits.minFrameSide,
          maximum: limits.maxFrameSide,
        },
      });
    }
  }
  if (
    typeof width === 'number'
    && typeof height === 'number'
    && Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && width * height > limits.maxFramePixels
  ) {
    collector.error({
      code: 'RESOURCE_LIMIT',
      message: `Frame exceeds the ${limits.maxFramePixels}-pixel budget.`,
      path,
      details: { pixels: width * height, maximumPixels: limits.maxFramePixels },
    });
  }
}

function validateEndpoint(
  value: unknown,
  path: string,
  collector: FindingCollector,
  limits: AgentLimits,
): void {
  if (!isPlainRecord(value)) {
    collector.error({ code: 'INVALID_ARGUMENT', message: 'Edge endpoint must be an object.', path });
    return;
  }
  rejectUnknownFields(value, ['node', 'socket'], path, collector);
  validateId(requireField(value, 'node', path, collector), joinJsonPointer(path, 'node'), collector, limits);
  validateId(requireField(value, 'socket', path, collector), joinJsonPointer(path, 'socket'), collector, limits);
}

function validateEdge(
  value: unknown,
  path: string,
  collector: FindingCollector,
  limits: AgentLimits,
): void {
  if (!isPlainRecord(value)) {
    collector.error({ code: 'INVALID_ARGUMENT', message: 'Edge must be an object.', path });
    return;
  }
  rejectUnknownFields(value, ['from', 'to'], path, collector);
  validateEndpoint(requireField(value, 'from', path, collector), joinJsonPointer(path, 'from'), collector, limits);
  validateEndpoint(requireField(value, 'to', path, collector), joinJsonPointer(path, 'to'), collector, limits);
}

function validatePosition(
  value: unknown,
  path: string,
  collector: FindingCollector,
): void {
  if (!isPlainRecord(value)) {
    collector.error({ code: 'INVALID_ARGUMENT', message: 'Node position must be an object.', path });
    return;
  }
  rejectUnknownFields(value, ['x', 'y'], path, collector);
  for (const name of ['x', 'y'] as const) {
    const coordinate = requireField(value, name, path, collector);
    if (typeof coordinate !== 'number' || !Number.isFinite(coordinate)) {
      collector.error({
        code: 'INVALID_ARGUMENT',
        message: 'Node position coordinates must be finite numbers.',
        path: joinJsonPointer(path, name),
      });
    }
  }
}

function validateNode(
  key: string,
  value: unknown,
  path: string,
  collector: FindingCollector,
  limits: AgentLimits,
  embeddedImagePaths: Set<string>,
): string | null {
  validateId(key, path, collector, limits);
  if (!isPlainRecord(value)) {
    collector.error({ code: 'INVALID_ARGUMENT', message: 'Node must be an object.', path });
    return null;
  }
  rejectUnknownFields(value, ['id', 'type', 'params', 'position'], path, collector);
  const id = requireField(value, 'id', path, collector);
  const type = requireField(value, 'type', path, collector);
  const params = requireField(value, 'params', path, collector);
  const validInternalId = validateId(id, joinJsonPointer(path, 'id'), collector, limits);
  if (validInternalId && id !== key) {
    collector.error({
      code: 'INVARIANT_VIOLATION',
      message: 'Node map key must match node.id.',
      path: joinJsonPointer(path, 'id'),
      details: { mapKey: key, nodeId: id },
    });
  }
  validateId(type, joinJsonPointer(path, 'type'), collector, limits);
  if (!isPlainRecord(params)) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: 'Node params must be an object.',
      path: joinJsonPointer(path, 'params'),
    });
  } else {
    for (const paramName of Object.keys(params).sort()) {
      const paramPath = joinJsonPointer(joinJsonPointer(path, 'params'), paramName);
      if (!isSafeId(paramName, limits.maxIdLength)) {
        collector.error({
          code: 'INVALID_ARGUMENT',
          message: 'Parameter key is not a safe identifier.',
          path: paramPath,
        });
      }
      const paramValue = readOwnData(params, paramName);
      if (
        typeof paramValue !== 'string'
        && typeof paramValue !== 'number'
        && typeof paramValue !== 'boolean'
      ) {
        collector.error({
          code: 'INVALID_ARGUMENT',
          message: 'Persisted parameter values must be strings, numbers, or booleans.',
          path: paramPath,
          details: { actualType: jsonTypeOf(paramValue) },
        });
      }
    }
    const src = readOwnData(params, 'src');
    if (
      type === 'Image'
      && typeof src === 'string'
      && /^data:image\/(?:png|jpeg|webp);base64,/.test(src)
    ) {
      embeddedImagePaths.add(joinJsonPointer(joinJsonPointer(path, 'params'), 'src'));
    }
  }
  const position = readOwnData(value, 'position');
  if (position !== MISSING) validatePosition(position, joinJsonPointer(path, 'position'), collector);
  return validInternalId ? id : null;
}

function validateGraph(
  value: unknown,
  path: string,
  collector: FindingCollector,
  limits: AgentLimits,
  embeddedImagePaths: Set<string>,
): number {
  if (!isPlainRecord(value)) {
    collector.error({ code: 'INVALID_ARGUMENT', message: 'Graph must be an object.', path });
    return 0;
  }
  rejectUnknownFields(value, ['nodes', 'edges'], path, collector);
  const nodes = requireField(value, 'nodes', path, collector);
  const edges = requireField(value, 'edges', path, collector);
  let nodeCount = 0;
  if (!isPlainRecord(nodes)) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: 'Graph nodes must be an object map.',
      path: joinJsonPointer(path, 'nodes'),
    });
  } else {
    const keys = Object.keys(nodes).sort();
    nodeCount = keys.length;
    if (nodeCount > limits.maxNodesPerLayer) {
      collector.error({
        code: 'RESOURCE_LIMIT',
        message: `Layer exceeds the ${limits.maxNodesPerLayer}-node budget.`,
        path: joinJsonPointer(path, 'nodes'),
        details: { actual: nodeCount, maximum: limits.maxNodesPerLayer },
      });
    }
    const internalIds = new Set<string>();
    for (const key of keys) {
      const nodePath = joinJsonPointer(joinJsonPointer(path, 'nodes'), key);
      const internalId = validateNode(
        key,
        readOwnData(nodes, key),
        nodePath,
        collector,
        limits,
        embeddedImagePaths,
      );
      if (internalId && internalIds.has(internalId)) {
        collector.error({
          code: 'INVARIANT_VIOLATION',
          message: `Node id "${internalId}" is duplicated.`,
          path: joinJsonPointer(nodePath, 'id'),
        });
      }
      if (internalId) internalIds.add(internalId);
    }
  }
  if (!Array.isArray(edges)) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: 'Graph edges must be an array.',
      path: joinJsonPointer(path, 'edges'),
    });
  } else {
    if (edges.length > limits.maxEdgesPerLayer) {
      collector.error({
        code: 'RESOURCE_LIMIT',
        message: `Layer exceeds the ${limits.maxEdgesPerLayer}-edge budget.`,
        path: joinJsonPointer(path, 'edges'),
        details: { actual: edges.length, maximum: limits.maxEdgesPerLayer },
      });
    }
    edges.forEach((edge, index) =>
      validateEdge(edge, joinJsonPointer(joinJsonPointer(path, 'edges'), index), collector, limits));
  }
  return nodeCount;
}

function validateLayer(
  value: unknown,
  path: string,
  collector: FindingCollector,
  limits: AgentLimits,
  embeddedImagePaths: Set<string>,
): { id: string | null; nodes: number } {
  if (!isPlainRecord(value)) {
    collector.error({ code: 'INVALID_ARGUMENT', message: 'Layer must be an object.', path });
    return { id: null, nodes: 0 };
  }
  rejectUnknownFields(value, ['id', 'name', 'visible', 'opacity', 'blendMode', 'graph'], path, collector);
  const id = requireField(value, 'id', path, collector);
  const name = requireField(value, 'name', path, collector);
  const visible = requireField(value, 'visible', path, collector);
  const opacity = requireField(value, 'opacity', path, collector);
  const blendMode = requireField(value, 'blendMode', path, collector);
  const graph = requireField(value, 'graph', path, collector);
  const validId = validateId(id, joinJsonPointer(path, 'id'), collector, limits);
  if (typeof name !== 'string') {
    collector.error({ code: 'INVALID_ARGUMENT', message: 'Layer name must be a string.', path: joinJsonPointer(path, 'name') });
  } else if ([...name].length > limits.maxNameLength) {
    collector.error({
      code: 'RESOURCE_LIMIT',
      message: `Layer name exceeds ${limits.maxNameLength} characters.`,
      path: joinJsonPointer(path, 'name'),
      details: { actualLength: [...name].length, maximumLength: limits.maxNameLength },
    });
  }
  if (typeof visible !== 'boolean') {
    collector.error({ code: 'INVALID_ARGUMENT', message: 'Layer visible must be boolean.', path: joinJsonPointer(path, 'visible') });
  }
  if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: 'Layer opacity must be a finite number between 0 and 1.',
      path: joinJsonPointer(path, 'opacity'),
    });
  }
  if (typeof blendMode !== 'string' || !BLEND_MODES.includes(blendMode)) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: 'Layer blendMode is not supported.',
      path: joinJsonPointer(path, 'blendMode'),
      details: { allowed: [...BLEND_MODES] },
    });
  }
  return {
    id: validId ? id : null,
    nodes: validateGraph(graph, joinJsonPointer(path, 'graph'), collector, limits, embeddedImagePaths),
  };
}

function validateDocument(
  value: unknown,
  path: string,
  collector: FindingCollector,
  limits: AgentLimits,
  embeddedImagePaths: Set<string>,
): void {
  if (!isPlainRecord(value)) {
    collector.error({ code: 'INVALID_ARGUMENT', message: 'Document must be an object.', path });
    return;
  }
  rejectUnknownFields(value, ['frame', 'layers'], path, collector);
  validateFrame(requireField(value, 'frame', path, collector), joinJsonPointer(path, 'frame'), collector, limits);
  const layers = requireField(value, 'layers', path, collector);
  if (!Array.isArray(layers)) {
    collector.error({ code: 'INVALID_ARGUMENT', message: 'Document layers must be an array.', path: joinJsonPointer(path, 'layers') });
    return;
  }
  if (layers.length === 0) {
    collector.error({
      code: 'INVARIANT_VIOLATION',
      message: 'Document must contain at least one layer.',
      path: joinJsonPointer(path, 'layers'),
    });
  }
  if (layers.length > limits.maxLayers) {
    collector.error({
      code: 'RESOURCE_LIMIT',
      message: `Document exceeds the ${limits.maxLayers}-layer budget.`,
      path: joinJsonPointer(path, 'layers'),
      details: { actual: layers.length, maximum: limits.maxLayers },
    });
  }
  const layerIds = new Set<string>();
  let totalNodes = 0;
  layers.forEach((layer, index) => {
    const result = validateLayer(
      layer,
      joinJsonPointer(joinJsonPointer(path, 'layers'), index),
      collector,
      limits,
      embeddedImagePaths,
    );
    totalNodes += result.nodes;
    if (result.id && layerIds.has(result.id)) {
      collector.error({
        code: 'INVARIANT_VIOLATION',
        message: `Layer id "${result.id}" is duplicated.`,
        path: `${path}/layers/${index}/id`,
      });
    }
    if (result.id) layerIds.add(result.id);
  });
  if (totalNodes > limits.maxNodesPerDocument) {
    collector.error({
      code: 'RESOURCE_LIMIT',
      message: `Document exceeds the ${limits.maxNodesPerDocument}-node budget.`,
      path: joinJsonPointer(path, 'layers'),
      details: { actual: totalNodes, maximum: limits.maxNodesPerDocument },
    });
  }
}

function validateAssets(
  value: unknown,
  path: string,
  collector: FindingCollector,
  limits: AgentLimits,
): void {
  if (!Array.isArray(value)) {
    collector.error({ code: 'INVALID_ARGUMENT', message: 'Assets must be an array.', path });
    return;
  }
  const ids = new Set<string>();
  let totalBytes = 0;
  value.forEach((asset, index) => {
    const assetPath = joinJsonPointer(path, index);
    if (!isPlainRecord(asset)) {
      collector.error({ code: 'INVALID_ARGUMENT', message: 'Asset metadata must be an object.', path: assetPath });
      return;
    }
    rejectUnknownFields(asset, ['id', 'sha256', 'mimeType', 'byteLength', 'width', 'height', 'source'], assetPath, collector);
    const id = requireField(asset, 'id', assetPath, collector);
    const sha256 = requireField(asset, 'sha256', assetPath, collector);
    const mimeType = requireField(asset, 'mimeType', assetPath, collector);
    const byteLength = requireField(asset, 'byteLength', assetPath, collector);
    const width = requireField(asset, 'width', assetPath, collector);
    const height = requireField(asset, 'height', assetPath, collector);
    const source = requireField(asset, 'source', assetPath, collector);
    if (validateId(id, joinJsonPointer(assetPath, 'id'), collector, limits)) {
      if (ids.has(id)) {
        collector.error({
          code: 'INVARIANT_VIOLATION',
          message: `Asset id "${id}" is duplicated.`,
          path: joinJsonPointer(assetPath, 'id'),
        });
      }
      ids.add(id);
    }
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
      collector.error({ code: 'INVALID_ARGUMENT', message: 'Asset sha256 must be 64 lowercase hex characters.', path: joinJsonPointer(assetPath, 'sha256') });
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(String(mimeType))) {
      collector.error({ code: 'INVALID_ARGUMENT', message: 'Asset MIME type is not supported.', path: joinJsonPointer(assetPath, 'mimeType') });
    }
    if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 0) {
      collector.error({ code: 'INVALID_ARGUMENT', message: 'Asset byteLength must be a non-negative integer.', path: joinJsonPointer(assetPath, 'byteLength') });
    } else {
      totalBytes += byteLength;
      if (byteLength > limits.maxLegacyAssetBytes) {
        collector.error({
          code: 'RESOURCE_LIMIT',
          message: `Asset exceeds the ${limits.maxLegacyAssetBytes}-byte budget.`,
          path: joinJsonPointer(assetPath, 'byteLength'),
          details: { actual: byteLength, maximum: limits.maxLegacyAssetBytes },
        });
      }
    }
    if (
      typeof width !== 'number'
      || typeof height !== 'number'
      || !Number.isSafeInteger(width)
      || !Number.isSafeInteger(height)
      || width <= 0
      || height <= 0
    ) {
      collector.error({ code: 'INVALID_ARGUMENT', message: 'Asset dimensions must be positive integers.', path: assetPath });
    } else if (width * height > limits.maxAssetPixels) {
      collector.error({
        code: 'RESOURCE_LIMIT',
        message: `Asset exceeds the ${limits.maxAssetPixels}-pixel budget.`,
        path: assetPath,
        details: { pixels: width * height, maximumPixels: limits.maxAssetPixels },
      });
    }
    if (!['upload', 'generated', 'bundled'].includes(String(source))) {
      collector.error({ code: 'INVALID_ARGUMENT', message: 'Asset source is not supported.', path: joinJsonPointer(assetPath, 'source') });
    }
  });
  if (totalBytes > limits.maxLegacyAssetBytesPerDocument) {
    collector.error({
      code: 'RESOURCE_LIMIT',
      message: `Assets exceed the ${limits.maxLegacyAssetBytesPerDocument}-byte document budget.`,
      path,
      details: { actual: totalBytes, maximum: limits.maxLegacyAssetBytesPerDocument },
    });
  }
}

function measuredJsonBytes(
  value: unknown,
  path: string,
  omittedStringPaths: ReadonlySet<string>,
): number {
  if (typeof value === 'string') {
    return utf8ByteLength(JSON.stringify(omittedStringPaths.has(path) ? '[embedded-image]' : value));
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return utf8ByteLength(JSON.stringify(value));
  }
  if (Array.isArray(value)) {
    return 2 + value.reduce((total, item, index) =>
      total + (index > 0 ? 1 : 0) + measuredJsonBytes(item, joinJsonPointer(path, index), omittedStringPaths), 0);
  }
  if (isPlainRecord(value)) {
    const keys = Object.keys(value);
    return 2 + keys.reduce((total, key, index) => {
      const keyBytes = utf8ByteLength(JSON.stringify(key));
      const child = readOwnData(value, key);
      return total
        + (index > 0 ? 1 : 0)
        + keyBytes
        + 1
        + measuredJsonBytes(child, joinJsonPointer(path, key), omittedStringPaths);
    }, 0);
  }
  return 0;
}

export function validateSerializedProjectStructure(
  value: unknown,
  options: StructuralValidationOptions = {},
): ValidationReport {
  const limits = resolveAgentLimits(options.limits);
  const collector = new FindingCollector(options.maxFindings ?? limits.maxFindings);
  const scanState: ScanState = {
    visitedValues: 0,
    stopped: false,
    traversalSafe: true,
  };
  scanJsonSafety(value, '', collector, new WeakSet(), scanState, 0);
  const jsonSafetyPassed = collector.errors.length === 0;
  if (!scanState.traversalSafe) return collector.report('structural', null);

  let schemaVersion: number | null = null;
  const embeddedImagePaths = new Set<string>();
  if (!isPlainRecord(value)) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: 'Project must be an object.',
      path: '',
      details: { actualType: jsonTypeOf(value) },
    });
    return collector.report('structural', schemaVersion);
  }

  rejectUnknownFields(value, ['format', 'schemaVersion', 'documentId', 'document', 'assets'], '', collector);
  const format = requireField(value, 'format', '', collector);
  const version = requireField(value, 'schemaVersion', '', collector);
  const documentId = requireField(value, 'documentId', '', collector);
  const document = requireField(value, 'document', '', collector);
  if (format !== PROJECT_FORMAT) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: `Project format must be "${PROJECT_FORMAT}".`,
      path: '/format',
    });
  }
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: 'schemaVersion must be an integer.',
      path: '/schemaVersion',
    });
  } else {
    schemaVersion = version;
    if (version !== CURRENT_SCHEMA_VERSION) {
      collector.error({
        code: 'UNSUPPORTED_SCHEMA_VERSION',
        message: `Schema version ${version} is not supported by this build.`,
        path: '/schemaVersion',
        recoverable: false,
        details: { supportedVersions: [CURRENT_SCHEMA_VERSION] },
      });
    }
  }
  validateId(documentId, '/documentId', collector, limits);
  validateDocument(document, '/document', collector, limits, embeddedImagePaths);
  const assets = readOwnData(value, 'assets');
  if (assets !== MISSING) validateAssets(assets, '/assets', collector, limits);

  if (jsonSafetyPassed) {
    const bytes = measuredJsonBytes(value, '', embeddedImagePaths);
    if (bytes > limits.maxDocumentJsonBytes) {
      collector.error({
        code: 'RESOURCE_LIMIT',
        message: `Project JSON excluding embedded image bodies exceeds ${limits.maxDocumentJsonBytes} bytes.`,
        path: '',
        details: { actualBytes: bytes, maximumBytes: limits.maxDocumentJsonBytes },
      });
    }
  }
  return collector.report('structural', schemaVersion);
}

export function createSerializedProject(
  documentId: string,
  document: Doc,
  assets?: AssetMetadata[],
): SerializedProjectV3 {
  return {
    format: PROJECT_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    documentId,
    document,
    ...(assets ? { assets } : {}),
  };
}

export const DEFAULT_STRUCTURAL_VALIDATION_OPTIONS: Readonly<StructuralValidationOptions> = Object.freeze({
  limits: { ...DEFAULT_AGENT_LIMITS },
});
