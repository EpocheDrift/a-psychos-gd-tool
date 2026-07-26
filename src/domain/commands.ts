import {
  BLEND_MODES,
  type Doc,
  type Edge,
  type Graph,
  type Layer,
  type NodeInstance,
  type ParamValue,
} from '../engine/graph';
import type { ParamSpec, Registry } from '../engine/registry';
import { canConnect } from '../engine/registry';
import { registry as appRegistry } from '../nodes';
import type { AgentErrorCode, ValidationFinding, ValidationMode } from './agentErrors';
import type {
  AgentFailure,
  ChangedNodeRef,
  CommandApplication,
  CommandApplyOptions,
  CreatedEntity,
  DocumentCommand,
  LayerPatch,
  LayerRef,
  NodeMove,
  NodeRef,
  Point,
  ReplacedEdge,
  RuntimeDocumentState,
  TransactionRequest,
  TransactionSuccess,
} from './commandTypes';
import {
  createSerializedProject,
  validateJsonValueSafety,
} from './documentSchema';
import {
  MISSING,
  boundedCanonicalJsonByteLength,
  canonicalJsonStringify,
  cloneJsonValue,
  isPlainRecord,
  joinJsonPointer,
  readOwnData,
  utf8ByteLength,
  type JsonObject,
  type JsonValue,
} from './json';
import {
  DEFAULT_AGENT_LIMITS,
  resolveAgentLimits,
  type AgentLimits,
} from './limits';
import {
  decodeBinds,
  encodeBinds,
  isSafeId,
} from './paramCodecs';
import { validateParamValue } from './paramValidation';
import { getParamPublicMetadata } from './publicNodeMetadata';
import { validateSerializedProject } from './semanticValidation';
import { sha256Hex } from './sha256';

export interface AgentTransactionApplyOptions {
  limits?: Partial<AgentLimits>;
  registry?: Registry;
  transactionId?: string;
}

interface InternalApplyOptions extends AgentTransactionApplyOptions, CommandApplyOptions {
  /**
   * Closed trusted-UI profile. It still uses this command switch, per-command
   * validation, revision checks, resource budgets, and final structural
   * validation, but avoids whole-document work whose only purpose is an
   * externally observable Agent response.
   */
  trustedUiFastPath?: boolean;
  finalSemanticErrorPolicy?: 'all' | 'resource-only';
}

interface CreatedRefEntry {
  kind: 'layer' | 'node';
  id: string;
  layerId?: string;
}

interface NormalizedRequest {
  readonly request: TransactionRequest;
  readonly fingerprint: string;
  readonly byteLength: number;
}

/** Runtime authority for the otherwise structurally typed normalized handle. */
const sealedNormalizedRequests = new WeakSet<NormalizedRequest>();

type NormalizeResult =
  | { ok: true; value: NormalizedRequest }
  | {
      ok: false;
      failure: AgentFailure;
      /**
       * Present only after the request container and requestId are known safe.
       * A session can then replay even a terminal schema/application failure.
       */
      fingerprint?: string;
    };

function sealNormalizedRequest(normalized: NormalizedRequest): NormalizedRequest {
  // Parsed commands contain only owned JSON values. Freeze the full tree so a
  // caller cannot normalize one request, mutate it, then reuse the authority.
  const pending: object[] = [normalized.request];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === 'object') pending.push(child);
    }
    Object.freeze(current);
  }
  Object.freeze(normalized);
  sealedNormalizedRequests.add(normalized);
  return normalized;
}

class CommandProblem extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
    readonly path?: string,
    readonly commandIndex?: number,
    readonly details?: Record<string, JsonValue>,
    readonly suggestedFix?: string,
  ) {
    super(message);
    this.name = 'CommandProblem';
  }
}

function failure(
  revision: number,
  problem: CommandProblem,
  requestId?: string,
): AgentFailure {
  return {
    ok: false,
    ...(requestId ? { requestId } : {}),
    revision,
    error: {
      code: problem.code,
      message: problem.message,
      ...(problem.path !== undefined ? { path: problem.path } : {}),
      ...(problem.commandIndex !== undefined ? { commandIndex: problem.commandIndex } : {}),
      ...(problem.details ? { details: problem.details } : {}),
      recoverable: problem.code !== 'INTERNAL',
      ...(problem.suggestedFix ? { suggestedFix: problem.suggestedFix } : {}),
    },
  };
}

function findingProblem(finding: ValidationFinding, messagePrefix = ''): CommandProblem {
  return new CommandProblem(
    finding.code as AgentErrorCode,
    `${messagePrefix}${finding.message}`,
    finding.path,
    undefined,
    finding.details,
    finding.suggestedFix,
  );
}

function own(object: Record<PropertyKey, unknown>, key: PropertyKey): unknown {
  const value = readOwnData(object, key);
  return value === MISSING ? undefined : value;
}

function assertKeys(
  object: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  commandIndex?: number,
): void {
  const accepted = new Set(allowed);
  for (const key of Object.keys(object).sort()) {
    if (!accepted.has(key)) {
      throw new CommandProblem(
        'INVALID_ARGUMENT',
        `Unknown field "${key}".`,
        joinJsonPointer(path, key),
        commandIndex,
      );
    }
  }
}

function required(
  object: Record<string, unknown>,
  key: string,
  path: string,
  commandIndex?: number,
): unknown {
  const value = readOwnData(object, key);
  if (value === MISSING) {
    throw new CommandProblem(
      'INVALID_ARGUMENT',
      `Missing required field "${key}".`,
      joinJsonPointer(path, key),
      commandIndex,
    );
  }
  return value;
}

function safeString(
  value: unknown,
  path: string,
  limits: AgentLimits,
  commandIndex?: number,
): string {
  if (typeof value !== 'string' || !isSafeId(value, limits.maxIdLength)) {
    throw new CommandProblem(
      'INVALID_ARGUMENT',
      `Value must be an ASCII-safe identifier of at most ${limits.maxIdLength} characters.`,
      path,
      commandIndex,
    );
  }
  return value;
}

function parseRef(
  value: unknown,
  path: string,
  limits: AgentLimits,
  commandIndex: number,
): LayerRef | NodeRef {
  if (typeof value === 'string') return safeString(value, path, limits, commandIndex);
  if (!isPlainRecord(value)) {
    throw new CommandProblem(
      'INVALID_ARGUMENT',
      'Reference must be a durable ID string or {clientRef}.',
      path,
      commandIndex,
    );
  }
  assertKeys(value, ['clientRef'], path, commandIndex);
  return {
    clientRef: safeString(
      required(value, 'clientRef', path, commandIndex),
      joinJsonPointer(path, 'clientRef'),
      limits,
      commandIndex,
    ),
  };
}

function parsePoint(
  value: unknown,
  path: string,
  commandIndex: number,
): Point {
  if (!isPlainRecord(value)) {
    throw new CommandProblem('INVALID_ARGUMENT', 'Position must be an object.', path, commandIndex);
  }
  assertKeys(value, ['x', 'y'], path, commandIndex);
  const x = required(value, 'x', path, commandIndex);
  const y = required(value, 'y', path, commandIndex);
  if (typeof x !== 'number' || !Number.isFinite(x)) {
    throw new CommandProblem(
      'INVALID_ARGUMENT',
      'Position x must be a finite number.',
      joinJsonPointer(path, 'x'),
      commandIndex,
    );
  }
  if (typeof y !== 'number' || !Number.isFinite(y)) {
    throw new CommandProblem(
      'INVALID_ARGUMENT',
      'Position y must be a finite number.',
      joinJsonPointer(path, 'y'),
      commandIndex,
    );
  }
  return { x, y };
}

function cloneJsonRecord(
  value: unknown,
  path: string,
  commandIndex: number,
): Record<string, JsonValue> {
  if (!isPlainRecord(value)) {
    throw new CommandProblem('INVALID_ARGUMENT', 'Value must be an object.', path, commandIndex);
  }
  const result = Object.create(null) as Record<string, JsonValue>;
  for (const key of Object.keys(value).sort()) {
    const child = readOwnData(value, key);
    if (child === MISSING) continue;
    result[key] = cloneJsonValue(child as JsonValue);
  }
  return result;
}

function parseLayerPatch(value: unknown, path: string, commandIndex: number): LayerPatch {
  if (!isPlainRecord(value)) {
    throw new CommandProblem('INVALID_ARGUMENT', 'Layer patch must be an object.', path, commandIndex);
  }
  assertKeys(value, ['name', 'visible', 'opacity', 'blendMode'], path, commandIndex);
  if (Object.keys(value).length === 0) {
    throw new CommandProblem('INVALID_ARGUMENT', 'Layer patch cannot be empty.', path, commandIndex);
  }
  const patch: LayerPatch = {};
  if (Object.hasOwn(value, 'name')) patch.name = own(value, 'name') as string;
  if (Object.hasOwn(value, 'visible')) patch.visible = own(value, 'visible') as boolean;
  if (Object.hasOwn(value, 'opacity')) patch.opacity = own(value, 'opacity') as number;
  if (Object.hasOwn(value, 'blendMode')) patch.blendMode = own(value, 'blendMode') as string;
  return patch;
}

function parseEndpoint(
  value: unknown,
  path: string,
  limits: AgentLimits,
  commandIndex: number,
): { nodeId: NodeRef; socket: string } {
  if (!isPlainRecord(value)) {
    throw new CommandProblem('INVALID_ARGUMENT', 'Endpoint must be an object.', path, commandIndex);
  }
  assertKeys(value, ['nodeId', 'socket'], path, commandIndex);
  return {
    nodeId: parseRef(
      required(value, 'nodeId', path, commandIndex),
      joinJsonPointer(path, 'nodeId'),
      limits,
      commandIndex,
    ),
    socket: safeString(
      required(value, 'socket', path, commandIndex),
      joinJsonPointer(path, 'socket'),
      limits,
      commandIndex,
    ),
  };
}

function parseCommand(
  value: unknown,
  index: number,
  limits: AgentLimits,
): DocumentCommand {
  const path = `/commands/${index}`;
  if (!isPlainRecord(value)) {
    throw new CommandProblem('INVALID_ARGUMENT', 'Command must be an object.', path, index);
  }
  const op = required(value, 'op', path, index);
  if (typeof op !== 'string') {
    throw new CommandProblem('INVALID_ARGUMENT', 'Command op must be a string.', `${path}/op`, index);
  }

  switch (op) {
    case 'set_frame': {
      assertKeys(value, ['op', 'width', 'height'], path, index);
      return {
        op,
        width: required(value, 'width', path, index) as number,
        height: required(value, 'height', path, index) as number,
      };
    }
    case 'add_layer': {
      assertKeys(value, ['op', 'clientRef', 'name', 'afterLayerId'], path, index);
      const name = own(value, 'name');
      const afterLayerId = own(value, 'afterLayerId');
      return {
        op,
        clientRef: safeString(required(value, 'clientRef', path, index), `${path}/clientRef`, limits, index),
        ...(name !== undefined ? { name: name as string } : {}),
        ...(afterLayerId !== undefined
          ? { afterLayerId: parseRef(afterLayerId, `${path}/afterLayerId`, limits, index) as LayerRef }
          : {}),
      };
    }
    case 'update_layer': {
      assertKeys(value, ['op', 'layerId', 'patch'], path, index);
      return {
        op,
        layerId: parseRef(required(value, 'layerId', path, index), `${path}/layerId`, limits, index),
        patch: parseLayerPatch(required(value, 'patch', path, index), `${path}/patch`, index),
      };
    }
    case 'move_layer': {
      assertKeys(value, ['op', 'layerId', 'index'], path, index);
      return {
        op,
        layerId: parseRef(required(value, 'layerId', path, index), `${path}/layerId`, limits, index),
        index: required(value, 'index', path, index) as number,
      };
    }
    case 'remove_layer': {
      assertKeys(value, ['op', 'layerId'], path, index);
      return {
        op,
        layerId: parseRef(required(value, 'layerId', path, index), `${path}/layerId`, limits, index),
      };
    }
    case 'add_node': {
      assertKeys(value, ['op', 'layerId', 'clientRef', 'nodeType', 'params', 'position'], path, index);
      const params = own(value, 'params');
      const position = own(value, 'position');
      return {
        op,
        layerId: parseRef(required(value, 'layerId', path, index), `${path}/layerId`, limits, index),
        clientRef: safeString(required(value, 'clientRef', path, index), `${path}/clientRef`, limits, index),
        nodeType: safeString(required(value, 'nodeType', path, index), `${path}/nodeType`, limits, index),
        params: params !== undefined
          ? cloneJsonRecord(params, `${path}/params`, index)
          : Object.create(null) as Record<string, JsonValue>,
        ...(position !== undefined ? { position: parsePoint(position, `${path}/position`, index) } : {}),
      };
    }
    case 'set_node_params': {
      assertKeys(value, ['op', 'layerId', 'nodeId', 'patch'], path, index);
      const patch = cloneJsonRecord(required(value, 'patch', path, index), `${path}/patch`, index);
      if (Object.keys(patch).length === 0) {
        throw new CommandProblem('INVALID_ARGUMENT', 'Parameter patch cannot be empty.', `${path}/patch`, index);
      }
      return {
        op,
        layerId: parseRef(required(value, 'layerId', path, index), `${path}/layerId`, limits, index),
        nodeId: parseRef(required(value, 'nodeId', path, index), `${path}/nodeId`, limits, index),
        patch,
      };
    }
    case 'move_nodes': {
      assertKeys(value, ['op', 'layerId', 'positions'], path, index);
      const rawPositions = required(value, 'positions', path, index);
      if (!Array.isArray(rawPositions) || rawPositions.length === 0) {
        throw new CommandProblem(
          'INVALID_ARGUMENT',
          'positions must be a non-empty array.',
          `${path}/positions`,
          index,
        );
      }
      const positions: NodeMove[] = rawPositions.map((move, moveIndex) => {
        const movePath = `${path}/positions/${moveIndex}`;
        if (!isPlainRecord(move)) {
          throw new CommandProblem('INVALID_ARGUMENT', 'Move must be an object.', movePath, index);
        }
        assertKeys(move, ['nodeId', 'position'], movePath, index);
        return {
          nodeId: parseRef(required(move, 'nodeId', movePath, index), `${movePath}/nodeId`, limits, index),
          position: parsePoint(required(move, 'position', movePath, index), `${movePath}/position`, index),
        };
      });
      return {
        op,
        layerId: parseRef(required(value, 'layerId', path, index), `${path}/layerId`, limits, index),
        positions,
      };
    }
    case 'remove_nodes': {
      assertKeys(value, ['op', 'layerId', 'nodeIds'], path, index);
      const rawIds = required(value, 'nodeIds', path, index);
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        throw new CommandProblem('INVALID_ARGUMENT', 'nodeIds must be a non-empty array.', `${path}/nodeIds`, index);
      }
      return {
        op,
        layerId: parseRef(required(value, 'layerId', path, index), `${path}/layerId`, limits, index),
        nodeIds: rawIds.map((nodeId, nodeIndex) =>
          parseRef(nodeId, `${path}/nodeIds/${nodeIndex}`, limits, index)),
      };
    }
    case 'connect': {
      assertKeys(value, ['op', 'layerId', 'from', 'to', 'replaceExisting'], path, index);
      const replaceExisting = own(value, 'replaceExisting');
      if (replaceExisting !== undefined && typeof replaceExisting !== 'boolean') {
        throw new CommandProblem(
          'INVALID_ARGUMENT',
          'replaceExisting must be boolean.',
          `${path}/replaceExisting`,
          index,
        );
      }
      return {
        op,
        layerId: parseRef(required(value, 'layerId', path, index), `${path}/layerId`, limits, index),
        from: parseEndpoint(required(value, 'from', path, index), `${path}/from`, limits, index),
        to: parseEndpoint(required(value, 'to', path, index), `${path}/to`, limits, index),
        replaceExisting: replaceExisting === true,
      };
    }
    case 'disconnect': {
      assertKeys(value, ['op', 'layerId', 'to'], path, index);
      return {
        op,
        layerId: parseRef(required(value, 'layerId', path, index), `${path}/layerId`, limits, index),
        to: parseEndpoint(required(value, 'to', path, index), `${path}/to`, limits, index),
      };
    }
    case 'auto_layout_graph': {
      assertKeys(value, ['op', 'layerId', 'direction'], path, index);
      const direction = own(value, 'direction');
      if (direction !== undefined && direction !== 'LR' && direction !== 'TB') {
        throw new CommandProblem(
          'INVALID_ARGUMENT',
          'direction must be LR or TB.',
          `${path}/direction`,
          index,
        );
      }
      return {
        op,
        layerId: parseRef(required(value, 'layerId', path, index), `${path}/layerId`, limits, index),
        direction: direction ?? 'LR',
      };
    }
    default:
      throw new CommandProblem(
        'INVALID_ARGUMENT',
        `Unknown command op "${op}".`,
        `${path}/op`,
        index,
      );
  }
}

function normalizeTransactionRequestUnsafe(
  value: unknown,
  revision: number,
  options: {
    limits?: Partial<AgentLimits>;
    computeFingerprint?: boolean;
  } = {},
): NormalizeResult {
  const limits = resolveAgentLimits(options.limits);
  const safety = validateJsonValueSafety(value, { limits, maxFindings: 1 });
  if (!safety.valid) {
    return {
      ok: false,
      failure: failure(revision, findingProblem(safety.errors[0]!, 'Unsafe transaction request: ')),
    };
  }
  if (!isPlainRecord(value)) {
    return {
      ok: false,
      failure: failure(
        revision,
        new CommandProblem('INVALID_ARGUMENT', 'Transaction request must be an object.', ''),
      ),
    };
  }

  const byteLength = boundedCanonicalJsonByteLength(
    value as JsonObject,
    limits.maxTransactionJsonBytes,
  );
  let requestId: string | undefined;
  let fallbackFingerprint: string | undefined;
  try {
    requestId = safeString(own(value, 'requestId'), '/requestId', limits);
    if (byteLength > limits.maxTransactionJsonBytes) {
      throw new CommandProblem(
        'RESOURCE_LIMIT',
        `Transaction request exceeds ${limits.maxTransactionJsonBytes} UTF-8 bytes.`,
        '',
        undefined,
        {
          actualBytesAtLeast: byteLength,
          maximumBytes: limits.maxTransactionJsonBytes,
        },
      );
    }
    if (options.computeFingerprint !== false) {
      const fallbackDigestInput = Object.create(null) as JsonObject;
      for (const key of Object.keys(value).sort()) {
        if (key === 'requestId') continue;
        const child = readOwnData(value, key);
        if (child !== MISSING) fallbackDigestInput[key] = cloneJsonValue(child as JsonValue);
      }
      if (!Object.hasOwn(fallbackDigestInput, 'dryRun')) fallbackDigestInput.dryRun = false;
      fallbackFingerprint = sha256Hex(
        `gfx.apply-transaction.v1\u0000${canonicalJsonStringify(fallbackDigestInput)}`,
      );
    }
    assertKeys(value, ['requestId', 'expectedRevision', 'commands', 'dryRun'], '');
    const expectedRevision = required(value, 'expectedRevision', '');
    if (
      typeof expectedRevision !== 'number'
      || !Number.isSafeInteger(expectedRevision)
      || expectedRevision < 0
    ) {
      throw new CommandProblem(
        'INVALID_ARGUMENT',
        'expectedRevision must be a non-negative safe integer.',
        '/expectedRevision',
      );
    }
    const rawCommands = required(value, 'commands', '');
    if (!Array.isArray(rawCommands) || rawCommands.length === 0) {
      throw new CommandProblem(
        'INVALID_ARGUMENT',
        'commands must be a non-empty array.',
        '/commands',
      );
    }
    if (rawCommands.length > limits.maxTransactionCommands) {
      throw new CommandProblem(
        'RESOURCE_LIMIT',
        `Transaction contains more than ${limits.maxTransactionCommands} commands.`,
        '/commands',
        undefined,
        { actual: rawCommands.length, maximum: limits.maxTransactionCommands },
      );
    }
    const dryRunValue = own(value, 'dryRun');
    if (dryRunValue !== undefined && typeof dryRunValue !== 'boolean') {
      throw new CommandProblem('INVALID_ARGUMENT', 'dryRun must be boolean.', '/dryRun');
    }
    const commands = rawCommands.map((command, index) => parseCommand(command, index, limits));
    const request: TransactionRequest = {
      requestId,
      expectedRevision,
      commands,
      dryRun: dryRunValue === true,
    };
    const digestInput: JsonObject = {
      expectedRevision,
      commands: commands as unknown as JsonValue,
      dryRun: request.dryRun === true,
    };
    return {
      ok: true,
      value: sealNormalizedRequest({
        request,
        fingerprint: options.computeFingerprint === false
          ? 'trusted-ui-untracked'
          : sha256Hex(
              `gfx.apply-transaction.v1\u0000${canonicalJsonStringify(digestInput)}`,
            ),
        byteLength,
      }),
    };
  } catch (error) {
    const problem = error instanceof CommandProblem
      ? error
      : new CommandProblem('INTERNAL', 'Unexpected request normalization failure.');
    return {
      ok: false,
      failure: failure(revision, problem, requestId),
      ...(fallbackFingerprint ? { fingerprint: fallbackFingerprint } : {}),
    };
  }
}

function normalizeTrustedUiTransactionRequest(
  value: unknown,
  revision: number,
  options: { limits?: Partial<AgentLimits> } = {},
): NormalizeResult {
  try {
    return normalizeTransactionRequestUnsafe(value, revision, {
      limits: options.limits,
      computeFingerprint: false,
    });
  } catch {
    return {
      ok: false,
      failure: failure(
        revision,
        new CommandProblem('INTERNAL', 'Unexpected trusted UI request normalization failure.'),
      ),
    };
  }
}

export function normalizeTransactionRequest(
  value: unknown,
  revision: number,
  options: { limits?: Partial<AgentLimits> } = {},
): NormalizeResult {
  try {
    // Rebuild the options object so runtime callers cannot smuggle the private
    // computeFingerprint switch through TypeScript's structural boundary.
    return normalizeTransactionRequestUnsafe(value, revision, {
      limits: options.limits,
      computeFingerprint: true,
    });
  } catch {
    return {
      ok: false,
      failure: failure(
        revision,
        new CommandProblem('INTERNAL', 'Unexpected request normalization failure.'),
      ),
    };
  }
}

function refClientId(ref: LayerRef | NodeRef): string | null {
  return typeof ref === 'string' ? null : ref.clientRef;
}

function allocateLayerId(reserved: Set<string>): string {
  for (let index = 1; index <= Number.MAX_SAFE_INTEGER; index++) {
    const candidate = `layer_${index}`;
    if (!reserved.has(candidate)) {
      reserved.add(candidate);
      return candidate;
    }
  }
  throw new CommandProblem('RESOURCE_LIMIT', 'No layer IDs remain available.');
}

function allocateNodeId(reserved: Set<string>, nodeType: string): string {
  const prefix = nodeType.toLowerCase();
  for (let index = 1; index <= Number.MAX_SAFE_INTEGER; index++) {
    const candidate = `${prefix}_${index}`;
    if (!reserved.has(candidate)) {
      reserved.add(candidate);
      return candidate;
    }
  }
  throw new CommandProblem('RESOURCE_LIMIT', 'No node IDs remain available.');
}

function countEdges(document: Doc): number {
  return document.layers.reduce((total, layer) => total + layer.graph.edges.length, 0);
}

const GENERATED_RESOURCE_PARAMS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  Text: new Set(['content']),
  Split: new Set(['by']),
  Duplicator: new Set(['count']),
  Grid: new Set(['columns', 'rows']),
  Random: new Set(['areaWidth', 'areaHeight', 'spacing']),
  Function: new Set(['fn', 'gap', 'radius', 'turns', 'width']),
});

function commandsMayChangeGlobalResourceBudget(
  commands: readonly DocumentCommand[],
  document: Doc,
  registry: Registry,
): boolean {
  return commands.some((command) => {
    switch (command.op) {
      case 'set_frame':
      case 'update_layer':
      case 'move_layer':
      case 'move_nodes':
      case 'auto_layout_graph':
        return false;
      case 'set_node_params': {
        if (typeof command.layerId !== 'string' || typeof command.nodeId !== 'string') {
          return true;
        }
        const layer = document.layers.find((candidate) => candidate.id === command.layerId);
        const node = layer?.graph.nodes[command.nodeId];
        const definition = node ? registry.get(node.type) : undefined;
        if (!node || !definition) return true;
        const nodeType = node.type;
        const generatedParams = GENERATED_RESOURCE_PARAMS[nodeType];
        return Object.keys(command.patch).some((paramName) => {
          const spec = definition.params.find((candidate) => candidate.name === paramName);
          return spec?.kind === 'image' || generatedParams?.has(paramName) === true;
        });
      }
      case 'add_layer':
      case 'remove_layer':
      case 'add_node':
      case 'remove_nodes':
      case 'connect':
      case 'disconnect':
        return true;
    }
  });
}

function nodeAddressKey(layerId: string, nodeId: string): string {
  return canonicalJsonStringify([layerId, nodeId]);
}

function finalChangeSummary(
  before: Doc,
  after: Doc,
  replacementEvents: readonly ReplacedEdge[],
): TransactionSuccess['changed'] {
  const beforeLayers = new Map(
    before.layers.map((layer, index) => [layer.id, { layer, index }]),
  );
  const afterLayers = new Map(
    after.layers.map((layer, index) => [layer.id, { layer, index }]),
  );
  const layerIds = [...new Set([...beforeLayers.keys(), ...afterLayers.keys()])]
    .filter((layerId) => {
      const left = beforeLayers.get(layerId);
      const right = afterLayers.get(layerId);
      return !left
        || !right
        || left.index !== right.index
        || canonicalJsonStringify(left.layer as unknown as JsonValue)
          !== canonicalJsonStringify(right.layer as unknown as JsonValue);
    })
    .sort();

  const beforeNodes = new Map<string, JsonValue>();
  const afterNodes = new Map<string, JsonValue>();
  for (const [document, target] of [
    [before, beforeNodes],
    [after, afterNodes],
  ] as const) {
    for (const layer of document.layers) {
      for (const [nodeId, node] of Object.entries(layer.graph.nodes)) {
        target.set(nodeAddressKey(layer.id, nodeId), node as unknown as JsonValue);
      }
    }
  }

  const nodeKeys = new Set<string>();
  for (const key of new Set([...beforeNodes.keys(), ...afterNodes.keys()])) {
    const left = beforeNodes.get(key);
    const right = afterNodes.get(key);
    if (
      left === undefined
      || right === undefined
      || canonicalJsonStringify(left) !== canonicalJsonStringify(right)
    ) {
      nodeKeys.add(key);
    }
  }
  for (const layerId of new Set([...beforeLayers.keys(), ...afterLayers.keys()])) {
    const beforeEdges = beforeLayers.get(layerId)?.layer.graph.edges ?? [];
    const afterEdges = afterLayers.get(layerId)?.layer.graph.edges ?? [];
    const beforeEdgeKeys = new Set(
      beforeEdges.map((edge) => canonicalJsonStringify(edge as unknown as JsonValue)),
    );
    const afterEdgeKeys = new Set(
      afterEdges.map((edge) => canonicalJsonStringify(edge as unknown as JsonValue)),
    );
    for (const edge of beforeEdges) {
      if (!afterEdgeKeys.has(canonicalJsonStringify(edge as unknown as JsonValue))) {
        nodeKeys.add(nodeAddressKey(layerId, edge.from.node));
        nodeKeys.add(nodeAddressKey(layerId, edge.to.node));
      }
    }
    for (const edge of afterEdges) {
      if (!beforeEdgeKeys.has(canonicalJsonStringify(edge as unknown as JsonValue))) {
        nodeKeys.add(nodeAddressKey(layerId, edge.from.node));
        nodeKeys.add(nodeAddressKey(layerId, edge.to.node));
      }
    }
  }
  const nodes = [...nodeKeys]
    .map((key) => JSON.parse(key) as [string, string])
    .map(([layerId, nodeId]) => ({ layerId, nodeId }))
    .sort(
      (left, right) =>
        left.layerId.localeCompare(right.layerId)
        || left.nodeId.localeCompare(right.nodeId),
    );

  const replacedEdges = replacementEvents.filter((replacement) => {
    const finalLayer = afterLayers.get(replacement.layerId)?.layer;
    return !finalLayer?.graph.edges.some((edge) => edgesEqual(edge, replacement.edge));
  });
  return {
    frame:
      before.frame.width !== after.frame.width
      || before.frame.height !== after.frame.height,
    layerIds,
    nodes,
    edgeCountDelta: countEdges(after) - countEdges(before),
    replacedEdges,
  };
}

function pointsEqual(left: Point | undefined, right: Point): boolean {
  return left?.x === right.x && left.y === right.y;
}

function edgesEqual(left: Edge, right: Edge): boolean {
  return left.from.node === right.from.node
    && left.from.socket === right.from.socket
    && left.to.node === right.to.node
    && left.to.socket === right.to.socket;
}

function validateLayerName(
  value: unknown,
  path: string,
  limits: AgentLimits,
  commandIndex: number,
  allowEmpty = false,
): string {
  if (typeof value !== 'string' || (!allowEmpty && [...value].length === 0)) {
    throw new CommandProblem(
      'INVALID_ARGUMENT',
      'Layer name must be a non-empty string.',
      path,
      commandIndex,
    );
  }
  const length = [...value].length;
  const bytes = utf8ByteLength(value);
  if (length > limits.maxNameLength || bytes > limits.maxStringBytes) {
    throw new CommandProblem(
      'RESOURCE_LIMIT',
      'Layer name exceeds the configured limit.',
      path,
      commandIndex,
      {
        actualLength: length,
        maximumLength: limits.maxNameLength,
        actualBytes: bytes,
        maximumBytes: limits.maxStringBytes,
      },
    );
  }
  return value;
}

function normalizeParam(
  nodeType: string,
  spec: ParamSpec,
  value: JsonValue,
  path: string,
  limits: AgentLimits,
  commandIndex: number,
  allowTransient: boolean,
  enforceAgentWritable: boolean,
  acceptPersistedBinds: boolean,
): ParamValue {
  const metadata = getParamPublicMetadata(nodeType, spec);
  if (enforceAgentWritable && metadata.agentWritable === false) {
    throw new CommandProblem(
      'PERMISSION_REQUIRED',
      `Parameter "${spec.name}" is not writable through the Agent command boundary.`,
      path,
      commandIndex,
      { nodeType, param: spec.name },
      'Use the approved asset workflow or edit this parameter in the human UI.',
    );
  }
  if (spec.kind === 'binds' && Array.isArray(value)) {
    const persisted = JSON.stringify(value);
    const decoded = decodeBinds(
      persisted,
      limits.maxBinds,
      limits.maxStringBytes,
      Math.min(128, limits.maxIdLength),
    );
    if (!decoded.ok) {
      const issue = decoded.issues[0]!;
      throw new CommandProblem(
        issue.code ?? 'INVALID_ARGUMENT',
        issue.message,
        `${path}${issue.path}`,
        commandIndex,
        issue.details,
      );
    }
    return encodeBinds(decoded.value, limits);
  }
  if (spec.kind === 'binds' && !acceptPersistedBinds) {
    throw new CommandProblem(
      'INVALID_ARGUMENT',
      'Binds must be supplied as the structured array advertised by the capability manifest.',
      path,
      commandIndex,
    );
  }

  if (
    typeof value !== 'string'
    && typeof value !== 'number'
    && typeof value !== 'boolean'
  ) {
    throw new CommandProblem(
      'INVALID_ARGUMENT',
      'Parameter value must be a JSON scalar, except structured binds.',
      path,
      commandIndex,
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new CommandProblem(
      'INVALID_ARGUMENT',
      'Parameter number must be finite.',
      path,
      commandIndex,
    );
  }

  const checked = validateParamValue(nodeType, spec, value, limits);
  if (
    allowTransient
    && spec.kind !== 'image'
    && spec.kind !== 'binds'
    && !checked.issues.some((issue) => issue.code === 'RESOURCE_LIMIT')
  ) {
    return value;
  }
  if (checked.issues.length > 0) {
    const issue = checked.issues[0];
    throw new CommandProblem(
      issue.code,
      issue.message,
      `${path}${issue.pathSuffix ?? ''}`,
      commandIndex,
      issue.details,
    );
  }
  return value;
}

function deterministicLayout(graph: Graph, direction: 'LR' | 'TB'): Map<string, Point> {
  const nodeIds = Object.keys(graph.nodes).sort();
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map(nodeIds.map((id) => [id, [] as string[]]));
  for (const edge of graph.edges) {
    if (!indegree.has(edge.from.node) || !indegree.has(edge.to.node)) continue;
    indegree.set(edge.to.node, (indegree.get(edge.to.node) ?? 0) + 1);
    outgoing.get(edge.from.node)!.push(edge.to.node);
  }
  for (const neighbors of outgoing.values()) neighbors.sort();

  const ready = nodeIds.filter((id) => indegree.get(id) === 0);
  const ranks = new Map(nodeIds.map((id) => [id, 0]));
  const ordered: string[] = [];
  while (ready.length > 0) {
    ready.sort();
    const id = ready.shift()!;
    ordered.push(id);
    for (const target of outgoing.get(id) ?? []) {
      ranks.set(target, Math.max(ranks.get(target) ?? 0, (ranks.get(id) ?? 0) + 1));
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) ready.push(target);
    }
  }
  if (ordered.length !== nodeIds.length) {
    throw new CommandProblem('CYCLE_DETECTED', 'Cannot lay out a cyclic graph.');
  }

  const groups = new Map<number, string[]>();
  for (const id of ordered) {
    const rank = ranks.get(id) ?? 0;
    const group = groups.get(rank) ?? [];
    group.push(id);
    groups.set(rank, group);
  }
  const positions = new Map<string, Point>();
  for (const [rank, group] of [...groups.entries()].sort(([a], [b]) => a - b)) {
    group.sort();
    group.forEach((id, index) => {
      positions.set(id, direction === 'LR'
        ? { x: rank * 280, y: index * 180 }
        : { x: index * 280, y: rank * 180 });
    });
  }
  return positions;
}

function applyNormalizedTransactionCore(
  state: RuntimeDocumentState,
  normalized: NormalizedRequest,
  options: InternalApplyOptions = {},
): CommandApplication {
  const limits = resolveAgentLimits(options.limits);
  const selectedRegistry = options.registry ?? appRegistry;
  const request = normalized.request;
  if (request.expectedRevision !== state.revision) {
    return {
      result: failure(
        state.revision,
        new CommandProblem(
          'REVISION_CONFLICT',
          `Expected revision ${request.expectedRevision}, current revision is ${state.revision}.`,
          '/expectedRevision',
          undefined,
          { expectedRevision: request.expectedRevision, currentRevision: state.revision },
        ),
        request.requestId,
      ),
    };
  }
  if (state.revision >= Number.MAX_SAFE_INTEGER) {
    return {
      result: failure(
        state.revision,
        new CommandProblem('RESOURCE_LIMIT', 'Document revision is exhausted.'),
        request.requestId,
      ),
    };
  }

  const trustedUiFastPath = options.trustedUiFastPath === true;
  const baseMode: ValidationMode = options.baseValidationMode ?? 'editable';
  const finalMode: ValidationMode = options.finalValidationMode ?? 'renderable';
  if (!trustedUiFastPath) {
    const baseReport = validateSerializedProject(
      createSerializedProject(state.documentId, state.document, state.assets),
      { mode: baseMode, limits, registry: selectedRegistry },
    );
    if (!baseReport.valid) {
      return {
        result: failure(
          state.revision,
          new CommandProblem(
            'INVARIANT_VIOLATION',
            `Current document cannot accept a transaction: ${baseReport.errors[0]?.message ?? 'invalid base'}`,
            baseReport.errors[0]?.path,
            undefined,
            baseReport.errors[0]?.details,
          ),
          request.requestId,
        ),
      };
    }
  }

  // Unified copy-on-write draft for both Agent and UI calls. The document root
  // is private immediately, while layers/graphs/maps/nodes stay shared until a
  // command actually writes that branch.
  const draft: Doc = { ...state.document };
  let ownsLayers = false;
  const ownedLayers = new WeakSet<Layer>();
  const ownedGraphs = new WeakSet<Graph>();
  const ownedNodeMaps = new WeakSet<Record<string, NodeInstance>>();
  const mutableLayers = (): Layer[] => {
    if (!ownsLayers) {
      draft.layers = [...draft.layers];
      ownsLayers = true;
    }
    return draft.layers;
  };
  const mutableLayer = (layer: Layer): Layer => {
    if (ownedLayers.has(layer)) return layer;
    const index = draft.layers.findIndex((candidate) => candidate === layer);
    if (index < 0) {
      throw new CommandProblem('INTERNAL', 'Copy-on-write layer is no longer in the draft.');
    }
    const copy = { ...layer };
    mutableLayers()[index] = copy;
    ownedLayers.add(copy);
    return copy;
  };
  const mutableGraph = (
    layer: Layer,
    mutation: { nodes?: boolean } = {},
  ): Layer => {
    const writableLayer = mutableLayer(layer);
    let graph = writableLayer.graph;
    if (!ownedGraphs.has(graph)) {
      graph = { ...graph };
      writableLayer.graph = graph;
      ownedGraphs.add(graph);
    }
    if (mutation.nodes && !ownedNodeMaps.has(graph.nodes)) {
      graph.nodes = { ...graph.nodes };
      ownedNodeMaps.add(graph.nodes);
    }
    return writableLayer;
  };
  const reservedLayerIds = new Set(draft.layers.map((layer) => layer.id));
  const reservedNodeIds = new Map(
    draft.layers.map((layer) => [
      layer.id,
      new Set(Object.keys(layer.graph.nodes)),
    ]),
  );
  const createdRefs = new Map<string, CreatedRefEntry>();
  const created = Object.create(null) as Record<string, string>;
  const createdEntities = Object.create(null) as Record<string, CreatedEntity>;
  const changedLayers = new Set<string>();
  const changedNodes = new Map<string, ChangedNodeRef>();
  const touchedNodes = new Set<string>();
  const replacedEdges: ReplacedEdge[] = [];
  let frameChanged = false;

  const addClientRef = (
    clientRef: string,
    entry: CreatedRefEntry,
    index: number,
    path: string,
  ): void => {
    if (createdRefs.has(clientRef)) {
      throw new CommandProblem(
        'INVALID_ARGUMENT',
        `clientRef "${clientRef}" is duplicated.`,
        path,
        index,
      );
    }
    if (createdRefs.size >= limits.maxClientRefs) {
      throw new CommandProblem(
        'RESOURCE_LIMIT',
        `Transaction creates more than ${limits.maxClientRefs} client references.`,
        path,
        index,
      );
    }
    createdRefs.set(clientRef, entry);
    created[clientRef] = entry.id;
    createdEntities[clientRef] = { ...entry };
  };

  const layerById = (layerId: string): Layer | undefined =>
    draft.layers.find((layer) => layer.id === layerId);

  const resolveLayer = (ref: LayerRef, index: number, path: string): Layer => {
    let id: string;
    const clientRef = refClientId(ref);
    if (clientRef) {
      const entry = createdRefs.get(clientRef);
      if (!entry) {
        throw new CommandProblem(
          'UNKNOWN_LAYER',
          `Unknown or forward layer clientRef "${clientRef}".`,
          path,
          index,
        );
      }
      if (entry.kind !== 'layer') {
        throw new CommandProblem(
          'INVALID_ARGUMENT',
          `clientRef "${clientRef}" refers to a node, not a layer.`,
          path,
          index,
        );
      }
      id = entry.id;
    } else {
      id = ref as string;
    }
    const layer = layerById(id);
    if (!layer) {
      throw new CommandProblem(
        'UNKNOWN_LAYER',
        `Layer "${id}" does not exist.`,
        path,
        index,
        { layerId: id },
      );
    }
    return layer;
  };

  const resolveNode = (
    layer: Layer,
    ref: NodeRef,
    index: number,
    path: string,
  ): NodeInstance => {
    let id: string;
    const clientRef = refClientId(ref);
    if (clientRef) {
      const entry = createdRefs.get(clientRef);
      if (!entry) {
        throw new CommandProblem(
          'UNKNOWN_NODE',
          `Unknown or forward node clientRef "${clientRef}".`,
          path,
          index,
        );
      }
      if (entry.kind !== 'node') {
        throw new CommandProblem(
          'INVALID_ARGUMENT',
          `clientRef "${clientRef}" refers to a layer, not a node.`,
          path,
          index,
        );
      }
      if (entry.layerId !== layer.id) {
        throw new CommandProblem(
          'INVALID_ARGUMENT',
          `Node clientRef "${clientRef}" belongs to another layer.`,
          path,
          index,
          { expectedLayerId: layer.id, actualLayerId: entry.layerId ?? '' },
        );
      }
      id = entry.id;
    } else {
      id = ref as string;
    }
    const node = Object.hasOwn(layer.graph.nodes, id) ? layer.graph.nodes[id] : undefined;
    if (!node) {
      throw new CommandProblem(
        'UNKNOWN_NODE',
        `Node "${id}" does not exist in layer "${layer.id}".`,
        path,
        index,
        { layerId: layer.id, nodeId: id },
      );
    }
    return node;
  };

  const markLayer = (layerId: string): void => {
    changedLayers.add(layerId);
  };
  const markNode = (layerId: string, nodeId: string): void => {
    changedNodes.set(nodeAddressKey(layerId, nodeId), { layerId, nodeId });
  };
  const touchNode = (
    layerId: string,
    nodeId: string,
    index: number,
    path: string,
  ): void => {
    touchedNodes.add(nodeAddressKey(layerId, nodeId));
    if (touchedNodes.size > limits.maxTouchedNodes) {
      throw new CommandProblem(
        'RESOURCE_LIMIT',
        `Transaction touches more than ${limits.maxTouchedNodes} nodes.`,
        path,
        index,
        { actualAtLeast: touchedNodes.size, maximum: limits.maxTouchedNodes },
      );
    }
  };

  try {
    request.commands.forEach((command, index) => {
      const path = `/commands/${index}`;
      switch (command.op) {
        case 'set_frame': {
          const { width, height } = command;
          if (!Number.isSafeInteger(width)) {
            throw new CommandProblem(
              'INVALID_ARGUMENT',
              'Frame width must be a safe integer.',
              `${path}/width`,
              index,
            );
          }
          if (!Number.isSafeInteger(height)) {
            throw new CommandProblem(
              'INVALID_ARGUMENT',
              'Frame height must be a safe integer.',
              `${path}/height`,
              index,
            );
          }
          if (width < limits.minFrameSide || width > limits.maxFrameSide) {
            throw new CommandProblem(
              'RESOURCE_LIMIT',
              'Frame width exceeds the configured policy.',
              `${path}/width`,
              index,
              {
                width,
                minimumSide: limits.minFrameSide,
                maximumSide: limits.maxFrameSide,
              },
            );
          }
          if (height < limits.minFrameSide || height > limits.maxFrameSide) {
            throw new CommandProblem(
              'RESOURCE_LIMIT',
              'Frame height exceeds the configured policy.',
              `${path}/height`,
              index,
              {
                height,
                minimumSide: limits.minFrameSide,
                maximumSide: limits.maxFrameSide,
              },
            );
          }
          if (width * height > limits.maxFramePixels) {
            throw new CommandProblem(
              'RESOURCE_LIMIT',
              'Frame pixel count exceeds the configured policy.',
              path,
              index,
              {
                width,
                height,
                maximumPixels: limits.maxFramePixels,
              },
            );
          }
          if (draft.frame.width === width && draft.frame.height === height) {
            throw new CommandProblem('INVALID_ARGUMENT', 'set_frame would not change the document.', path, index);
          }
          draft.frame = { width, height };
          frameChanged = true;
          break;
        }

        case 'add_layer': {
          const name = command.name === undefined
            ? `Layer ${draft.layers.length + 1}`
            : validateLayerName(
                command.name,
                `${path}/name`,
                limits,
                index,
                options.allowEmptyLayerNames === true,
              );
          const id = allocateLayerId(reservedLayerIds);
          const output: NodeInstance = {
            id: 'out',
            type: 'Output',
            params: { transparent: true },
            position: { x: 480, y: 120 },
          };
          const layer: Layer = {
            id,
            name,
            visible: true,
            opacity: 1,
            blendMode: 'normal',
            graph: { nodes: { out: output }, edges: [] },
          };
          ownedLayers.add(layer);
          ownedGraphs.add(layer.graph);
          ownedNodeMaps.add(layer.graph.nodes);
          let insertAt = draft.layers.length;
          if (command.afterLayerId !== undefined) {
            const after = resolveLayer(command.afterLayerId, index, `${path}/afterLayerId`);
            insertAt = draft.layers.findIndex((candidate) => candidate.id === after.id) + 1;
          }
          const layers = mutableLayers();
          layers.slice(insertAt).forEach((candidate) => markLayer(candidate.id));
          layers.splice(insertAt, 0, layer);
          reservedNodeIds.set(id, new Set(['out']));
          addClientRef(command.clientRef, { kind: 'layer', id }, index, `${path}/clientRef`);
          markLayer(id);
          markNode(id, 'out');
          touchNode(id, 'out', index, path);
          break;
        }

        case 'update_layer': {
          const layer = resolveLayer(command.layerId, index, `${path}/layerId`);
          const patch = command.patch;
          const next: Partial<Layer> = {};
          let changed = false;
          if (patch.name !== undefined) {
            const name = validateLayerName(
              patch.name,
              `${path}/patch/name`,
              limits,
              index,
              options.allowEmptyLayerNames === true,
            );
            next.name = name;
            changed ||= name !== layer.name;
          }
          if (patch.visible !== undefined) {
            if (typeof patch.visible !== 'boolean') {
              throw new CommandProblem(
                'INVALID_ARGUMENT',
                'visible must be boolean.',
                `${path}/patch/visible`,
                index,
              );
            }
            next.visible = patch.visible;
            changed ||= patch.visible !== layer.visible;
          }
          if (patch.opacity !== undefined) {
            if (
              typeof patch.opacity !== 'number'
              || !Number.isFinite(patch.opacity)
              || patch.opacity < 0
              || patch.opacity > 1
            ) {
              throw new CommandProblem(
                'INVALID_ARGUMENT',
                'opacity must be a finite number between 0 and 1.',
                `${path}/patch/opacity`,
                index,
              );
            }
            next.opacity = patch.opacity;
            changed ||= patch.opacity !== layer.opacity;
          }
          if (patch.blendMode !== undefined) {
            if (typeof patch.blendMode !== 'string' || !BLEND_MODES.includes(patch.blendMode)) {
              throw new CommandProblem(
                'INVALID_ARGUMENT',
                'blendMode is not supported.',
                `${path}/patch/blendMode`,
                index,
                { allowed: [...BLEND_MODES] },
              );
            }
            next.blendMode = patch.blendMode;
            changed ||= patch.blendMode !== layer.blendMode;
          }
          if (!changed) {
            throw new CommandProblem('INVALID_ARGUMENT', 'update_layer would not change the document.', path, index);
          }
          const writableLayer = mutableLayer(layer);
          Object.assign(writableLayer, next);
          markLayer(writableLayer.id);
          break;
        }

        case 'move_layer': {
          const layer = resolveLayer(command.layerId, index, `${path}/layerId`);
          if (
            !Number.isSafeInteger(command.index)
            || command.index < 0
            || command.index >= draft.layers.length
          ) {
            throw new CommandProblem(
              'INVALID_ARGUMENT',
              'Layer index is outside the document.',
              `${path}/index`,
              index,
            );
          }
          const from = draft.layers.findIndex((candidate) => candidate.id === layer.id);
          if (from === command.index) {
            throw new CommandProblem('INVALID_ARGUMENT', 'move_layer would not change the document.', path, index);
          }
          const layers = mutableLayers();
          const affectedStart = Math.min(from, command.index);
          const affectedEnd = Math.max(from, command.index);
          layers.slice(affectedStart, affectedEnd + 1)
            .forEach((candidate) => markLayer(candidate.id));
          layers.splice(from, 1);
          layers.splice(command.index, 0, layer);
          markLayer(layer.id);
          break;
        }

        case 'remove_layer': {
          const layer = resolveLayer(command.layerId, index, `${path}/layerId`);
          if (draft.layers.length === 1) {
            throw new CommandProblem(
              'INVARIANT_VIOLATION',
              'The last layer cannot be removed.',
              `${path}/layerId`,
              index,
            );
          }
          for (const nodeId of Object.keys(layer.graph.nodes).sort()) {
            touchNode(layer.id, nodeId, index, path);
            markNode(layer.id, nodeId);
          }
          const layers = mutableLayers();
          const removeAt = layers.findIndex((candidate) => candidate.id === layer.id);
          layers.slice(removeAt + 1).forEach((candidate) => markLayer(candidate.id));
          layers.splice(removeAt, 1);
          markLayer(layer.id);
          break;
        }

        case 'add_node': {
          const layer = resolveLayer(command.layerId, index, `${path}/layerId`);
          const definition = selectedRegistry.get(command.nodeType);
          if (!definition) {
            throw new CommandProblem(
              'UNKNOWN_NODE_TYPE',
              `Node type "${command.nodeType}" is not supported.`,
              `${path}/nodeType`,
              index,
              { nodeType: command.nodeType },
            );
          }
          const layerReservedIds = reservedNodeIds.get(layer.id)
            ?? new Set(Object.keys(layer.graph.nodes));
          reservedNodeIds.set(layer.id, layerReservedIds);
          const id = allocateNodeId(layerReservedIds, definition.type);
          const params = Object.create(null) as Record<string, ParamValue>;
          for (const spec of definition.params) params[spec.name] = spec.default;
          for (const paramName of Object.keys(command.params ?? {}).sort()) {
            const spec = definition.params.find((candidate) => candidate.name === paramName);
            if (!spec) {
              throw new CommandProblem(
                'UNKNOWN_PARAM',
                `Parameter "${paramName}" is not defined for ${definition.type}.`,
                joinJsonPointer(`${path}/params`, paramName),
                index,
                { nodeType: definition.type, param: paramName },
              );
            }
            params[paramName] = normalizeParam(
              definition.type,
              spec,
              command.params![paramName],
              joinJsonPointer(`${path}/params`, paramName),
              limits,
              index,
              options.allowTransientParamValues === true,
              options.enforceAgentWritable !== false,
              options.acceptPersistedBinds === true,
            );
          }
          const node: NodeInstance = {
            id,
            type: definition.type,
            params,
            ...(command.position ? { position: { ...command.position } } : {}),
          };
          const writableLayer = mutableGraph(layer, { nodes: true });
          writableLayer.graph.nodes[id] = node;
          addClientRef(
            command.clientRef,
            { kind: 'node', id, layerId: layer.id },
            index,
            `${path}/clientRef`,
          );
          markLayer(layer.id);
          markNode(layer.id, id);
          touchNode(layer.id, id, index, path);
          break;
        }

        case 'set_node_params': {
          const layer = resolveLayer(command.layerId, index, `${path}/layerId`);
          const node = resolveNode(layer, command.nodeId, index, `${path}/nodeId`);
          const definition = selectedRegistry.get(node.type);
          if (!definition) {
            throw new CommandProblem(
              'UNKNOWN_NODE_TYPE',
              `Node type "${node.type}" is not supported.`,
              `${path}/nodeId`,
              index,
            );
          }
          const params = { ...node.params };
          let changed = false;
          for (const paramName of Object.keys(command.patch).sort()) {
            const spec = definition.params.find((candidate) => candidate.name === paramName);
            if (!spec) {
              throw new CommandProblem(
                'UNKNOWN_PARAM',
                `Parameter "${paramName}" is not defined for ${node.type}.`,
                joinJsonPointer(`${path}/patch`, paramName),
                index,
                { nodeType: node.type, param: paramName },
              );
            }
            const normalizedValue = normalizeParam(
              node.type,
              spec,
              command.patch[paramName],
              joinJsonPointer(`${path}/patch`, paramName),
              limits,
              index,
              options.allowTransientParamValues === true,
              options.enforceAgentWritable !== false,
              options.acceptPersistedBinds === true,
            );
            changed ||= params[paramName] !== normalizedValue;
            params[paramName] = normalizedValue;
          }
          if (!changed) {
            throw new CommandProblem(
              'INVALID_ARGUMENT',
              'set_node_params would not change the document.',
              path,
              index,
            );
          }
          const writableLayer = mutableGraph(layer, { nodes: true });
          writableLayer.graph.nodes[node.id] = { ...node, params };
          markLayer(layer.id);
          markNode(layer.id, node.id);
          touchNode(layer.id, node.id, index, path);
          break;
        }

        case 'move_nodes': {
          const layer = resolveLayer(command.layerId, index, `${path}/layerId`);
          const seen = new Set<string>();
          const updates: Array<{ node: NodeInstance; position: Point }> = [];
          let changed = false;
          for (let moveIndex = 0; moveIndex < command.positions.length; moveIndex++) {
            const move = command.positions[moveIndex];
            const node = resolveNode(
              layer,
              move.nodeId,
              index,
              `${path}/positions/${moveIndex}/nodeId`,
            );
            if (seen.has(node.id)) {
              throw new CommandProblem(
                'INVALID_ARGUMENT',
                `Node "${node.id}" is moved more than once.`,
                `${path}/positions/${moveIndex}/nodeId`,
                index,
              );
            }
            seen.add(node.id);
            const nodeChanged = !pointsEqual(node.position, move.position);
            changed ||= nodeChanged;
            if (nodeChanged) {
              updates.push({ node, position: move.position });
              markNode(layer.id, node.id);
            }
            touchNode(layer.id, node.id, index, path);
          }
          if (!changed) {
            throw new CommandProblem('INVALID_ARGUMENT', 'move_nodes would not change the document.', path, index);
          }
          const writableLayer = mutableGraph(layer, { nodes: true });
          for (const update of updates) {
            writableLayer.graph.nodes[update.node.id] = {
              ...update.node,
              position: { ...update.position },
            };
          }
          markLayer(layer.id);
          break;
        }

        case 'remove_nodes': {
          const layer = resolveLayer(command.layerId, index, `${path}/layerId`);
          const ids = new Set<string>();
          command.nodeIds.forEach((ref, nodeIndex) => {
            const node = resolveNode(layer, ref, index, `${path}/nodeIds/${nodeIndex}`);
            if (ids.has(node.id)) {
              throw new CommandProblem(
                'INVALID_ARGUMENT',
                `Node "${node.id}" is listed more than once.`,
                `${path}/nodeIds/${nodeIndex}`,
                index,
              );
            }
            ids.add(node.id);
            markNode(layer.id, node.id);
            touchNode(layer.id, node.id, index, path);
          });
          const removedEdges = layer.graph.edges.filter(
            (edge) => ids.has(edge.from.node) || ids.has(edge.to.node),
          );
          for (const edge of removedEdges) {
            markNode(layer.id, edge.from.node);
            markNode(layer.id, edge.to.node);
            touchNode(layer.id, edge.from.node, index, path);
            touchNode(layer.id, edge.to.node, index, path);
          }
          const writableLayer = mutableGraph(layer, { nodes: true });
          for (const id of ids) delete writableLayer.graph.nodes[id];
          writableLayer.graph.edges = writableLayer.graph.edges.filter(
            (edge) => !ids.has(edge.from.node) && !ids.has(edge.to.node),
          );
          markLayer(layer.id);
          break;
        }

        case 'connect': {
          const layer = resolveLayer(command.layerId, index, `${path}/layerId`);
          const fromNode = resolveNode(layer, command.from.nodeId, index, `${path}/from/nodeId`);
          const toNode = resolveNode(layer, command.to.nodeId, index, `${path}/to/nodeId`);
          const fromDefinition = selectedRegistry.get(fromNode.type);
          const toDefinition = selectedRegistry.get(toNode.type);
          if (!fromDefinition || !toDefinition) {
            throw new CommandProblem(
              'UNKNOWN_NODE_TYPE',
              'Edge endpoint has an unsupported node type.',
              path,
              index,
            );
          }
          const fromSocket = fromDefinition.outputs.find(
            (socket) => socket.name === command.from.socket,
          );
          const toSocket = toDefinition.inputs.find(
            (socket) => socket.name === command.to.socket,
          );
          if (!fromSocket) {
            throw new CommandProblem(
              'UNKNOWN_SOCKET',
              `Output socket "${command.from.socket}" does not exist on ${fromNode.type}.`,
              `${path}/from/socket`,
              index,
            );
          }
          if (!toSocket) {
            throw new CommandProblem(
              'UNKNOWN_SOCKET',
              `Input socket "${command.to.socket}" does not exist on ${toNode.type}.`,
              `${path}/to/socket`,
              index,
            );
          }
          if (!canConnect(fromSocket, toSocket)) {
            throw new CommandProblem(
              'TYPE_MISMATCH',
              'Edge socket types are incompatible.',
              path,
              index,
            );
          }
          const incoming = layer.graph.edges.filter(
            (edge) =>
              edge.to.node === toNode.id
              && edge.to.socket === command.to.socket,
          );
          if (incoming.length > 1) {
            throw new CommandProblem(
              'INVARIANT_VIOLATION',
              'Target input already has multiple incoming edges.',
              `${path}/to`,
              index,
            );
          }
          const edge: Edge = {
            from: { node: fromNode.id, socket: command.from.socket },
            to: { node: toNode.id, socket: command.to.socket },
          };
          if (incoming.length === 1) {
            if (!command.replaceExisting) {
              throw new CommandProblem(
                'INPUT_ALREADY_CONNECTED',
                'Target input is already connected; set replaceExisting to replace it explicitly.',
                `${path}/to`,
                index,
              );
            }
            if (edgesEqual(incoming[0], edge)) {
              throw new CommandProblem('INVALID_ARGUMENT', 'connect would not change the document.', path, index);
            }
          }
          const withoutIncoming = incoming.length === 0
            ? layer.graph.edges
            : layer.graph.edges.filter((candidate) => candidate !== incoming[0]);
          const cycleGraph: Graph = { ...layer.graph, edges: withoutIncoming };
          const stack = [toNode.id];
          const seen = new Set<string>();
          let closesCycle = fromNode.id === toNode.id;
          while (stack.length > 0 && !closesCycle) {
            const current = stack.pop()!;
            if (seen.has(current)) continue;
            seen.add(current);
            for (const candidate of cycleGraph.edges) {
              if (candidate.from.node !== current) continue;
              if (candidate.to.node === fromNode.id) {
                closesCycle = true;
                break;
              }
              stack.push(candidate.to.node);
            }
          }
          if (closesCycle) {
            throw new CommandProblem(
              'CYCLE_DETECTED',
              'Connection would create a directed cycle.',
              path,
              index,
            );
          }
          const writableLayer = mutableGraph(layer);
          writableLayer.graph.edges = [...withoutIncoming, edge];
          if (incoming[0]) {
            replacedEdges.push({
              layerId: layer.id,
              edge: cloneJsonValue(incoming[0] as unknown as JsonValue) as unknown as Edge,
            });
            markNode(layer.id, incoming[0].from.node);
            touchNode(layer.id, incoming[0].from.node, index, path);
          }
          markLayer(layer.id);
          markNode(layer.id, fromNode.id);
          markNode(layer.id, toNode.id);
          touchNode(layer.id, fromNode.id, index, path);
          touchNode(layer.id, toNode.id, index, path);
          break;
        }

        case 'disconnect': {
          const layer = resolveLayer(command.layerId, index, `${path}/layerId`);
          const toNode = resolveNode(layer, command.to.nodeId, index, `${path}/to/nodeId`);
          const definition = selectedRegistry.get(toNode.type);
          if (!definition?.inputs.some((socket) => socket.name === command.to.socket)) {
            throw new CommandProblem(
              'UNKNOWN_SOCKET',
              `Input socket "${command.to.socket}" does not exist on ${toNode.type}.`,
              `${path}/to/socket`,
              index,
            );
          }
          const incoming = layer.graph.edges.filter(
            (edge) => edge.to.node === toNode.id && edge.to.socket === command.to.socket,
          );
          if (incoming.length === 0) {
            throw new CommandProblem(
              'INVALID_ARGUMENT',
              'Target input is not connected.',
              `${path}/to`,
              index,
            );
          }
          if (incoming.length > 1) {
            throw new CommandProblem(
              'INVARIANT_VIOLATION',
              'Target input has multiple incoming edges.',
              `${path}/to`,
              index,
            );
          }
          const removed = incoming[0];
          const writableLayer = mutableGraph(layer);
          writableLayer.graph.edges = writableLayer.graph.edges.filter((edge) => edge !== removed);
          markLayer(layer.id);
          markNode(layer.id, removed.from.node);
          markNode(layer.id, removed.to.node);
          touchNode(layer.id, removed.from.node, index, path);
          touchNode(layer.id, removed.to.node, index, path);
          break;
        }

        case 'auto_layout_graph': {
          const layer = resolveLayer(command.layerId, index, `${path}/layerId`);
          const positions = deterministicLayout(layer.graph, command.direction ?? 'LR');
          const updates: Array<{ node: NodeInstance; position: Point }> = [];
          for (const nodeId of Object.keys(layer.graph.nodes).sort()) {
            const node = layer.graph.nodes[nodeId];
            const position = positions.get(nodeId)!;
            if (!pointsEqual(node.position, position)) {
              updates.push({ node, position });
              markNode(layer.id, nodeId);
            }
            touchNode(layer.id, nodeId, index, path);
          }
          if (updates.length === 0) {
            throw new CommandProblem(
              'INVALID_ARGUMENT',
              'auto_layout_graph would not change the document.',
              path,
              index,
            );
          }
          const writableLayer = mutableGraph(layer, { nodes: true });
          for (const update of updates) {
            writableLayer.graph.nodes[update.node.id] = {
              ...update.node,
              position: { ...update.position },
            };
          }
          markLayer(layer.id);
          break;
        }
      }
    });

    if (
      !trustedUiFastPath
      &&
      canonicalJsonStringify(draft as unknown as JsonValue)
      === canonicalJsonStringify(state.document as unknown as JsonValue)
    ) {
      throw new CommandProblem('INVALID_ARGUMENT', 'Transaction has no net document change.', '/commands');
    }

    const finalProject = createSerializedProject(state.documentId, draft, state.assets);
    const resourceOnly = options.finalSemanticErrorPolicy === 'resource-only';
    const effectiveFinalMode = resourceOnly
      && !commandsMayChangeGlobalResourceBudget(request.commands, draft, selectedRegistry)
      ? 'structural'
      : finalMode;
    const finalReport = validateSerializedProject(finalProject, {
      mode: effectiveFinalMode,
      limits,
      registry: selectedRegistry,
      semanticErrorPolicy: resourceOnly ? 'resource-only' : 'all',
    });
    if (!finalReport.valid) throw findingProblem(finalReport.errors[0]!);

    const proposedRevision = state.revision + 1;
    const dryRun = request.dryRun === true;
    const finalCreated = Object.create(null) as Record<string, string>;
    const finalCreatedEntities = Object.create(null) as Record<string, CreatedEntity>;
    for (const [clientRef, entry] of createdRefs) {
      const layer = layerById(entry.kind === 'layer' ? entry.id : entry.layerId!);
      const exists = entry.kind === 'layer'
        ? layer !== undefined
        : layer !== undefined && Object.hasOwn(layer.graph.nodes, entry.id);
      if (!exists) continue;
      finalCreated[clientRef] = created[clientRef];
      finalCreatedEntities[clientRef] = { ...createdEntities[clientRef] };
    }
    const changed = trustedUiFastPath
      ? {
          frame: frameChanged,
          layerIds: [...changedLayers].sort(),
          nodes: [...changedNodes.values()].sort(
            (left, right) =>
              left.layerId.localeCompare(right.layerId)
              || left.nodeId.localeCompare(right.nodeId),
          ),
          edgeCountDelta: countEdges(draft) - countEdges(state.document),
          replacedEdges: replacedEdges.filter((replacement) => {
            const finalLayer = layerById(replacement.layerId);
            return !finalLayer?.graph.edges.some((edge) => edgesEqual(edge, replacement.edge));
          }),
        }
      : finalChangeSummary(state.document, draft, replacedEdges);
    const result: TransactionSuccess = {
      ok: true,
      requestId: request.requestId,
      dryRun,
      committed: !dryRun,
      transactionId: dryRun ? null : (options.transactionId ?? null),
      previousRevision: state.revision,
      revision: dryRun ? state.revision : proposedRevision,
      proposedRevision,
      created: finalCreated,
      createdEntities: finalCreatedEntities,
      changed,
      warnings: finalReport.warnings,
    };
    if (!dryRun && !result.transactionId) {
      throw new CommandProblem('INTERNAL', 'Committed transaction requires a transactionId.');
    }
    const proposed: RuntimeDocumentState = {
      documentId: state.documentId,
      document: draft,
      assets: state.assets,
      revision: proposedRevision,
    };
    return {
      result,
      proposed,
      ...(!dryRun ? { next: proposed } : {}),
    };
  } catch (error) {
    const problem = error instanceof CommandProblem
      ? error
      : new CommandProblem('INTERNAL', 'Unexpected transaction application failure.');
    return { result: failure(state.revision, problem, request.requestId) };
  }
}

export function applyDocumentTransaction(
  state: RuntimeDocumentState,
  request: unknown,
  options: AgentTransactionApplyOptions = {},
): CommandApplication {
  const normalized = normalizeTransactionRequest(request, state.revision, {
    limits: options.limits,
  });
  if (!normalized.ok) return { result: normalized.failure };
  return applyNormalizedDocumentTransaction(state, normalized.value, options);
}

/**
 * Strict executor for a handle returned by `normalizeTransactionRequest`.
 * TransactionSession uses this to avoid re-reading, re-hashing, or applying the
 * raw-byte limit to an already-normalized request. The WeakSet authority and
 * deep freeze prevent forged or post-normalization-mutated requests.
 */
export function applyNormalizedDocumentTransaction(
  state: RuntimeDocumentState,
  normalized: NormalizedRequest,
  options: AgentTransactionApplyOptions = {},
): CommandApplication {
  if (
    normalized === null
    || typeof normalized !== 'object'
    || !sealedNormalizedRequests.has(normalized)
  ) {
    return {
      result: failure(
        state.revision,
        new CommandProblem('INTERNAL', 'Normalized transaction handle is invalid.'),
      ),
    };
  }
  // Copy only the public strict fields. Runtime JavaScript callers cannot
  // smuggle trusted-UI policy switches through an object with extra keys.
  const strictOptions: AgentTransactionApplyOptions = {
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.registry ? { registry: options.registry } : {}),
    ...(options.transactionId ? { transactionId: options.transactionId } : {}),
  };
  return applyNormalizedTransactionCore(state, normalized, strictOptions);
}

/**
 * The only trusted UI adapter. It deliberately seals the policy switches so
 * callers cannot opt an Agent request into the faster, less descriptive path.
 */
export function applyTrustedUiCommands(
  state: RuntimeDocumentState,
  commands: DocumentCommand[],
): CommandApplication {
  const fastPath = commands.length === 1
    || (commands.length > 0 && commands.every((command) => command.op === 'disconnect'));
  const limits: Partial<AgentLimits> = {
    maxTransactionJsonBytes:
      Math.ceil(DEFAULT_AGENT_LIMITS.maxLegacyAssetBytes * 4 / 3)
      + 1024 * 1024,
    maxTransactionCommands: DEFAULT_AGENT_LIMITS.maxEdgesPerLayer,
    maxTouchedNodes: DEFAULT_AGENT_LIMITS.maxNodesPerDocument,
  };
  const normalized = normalizeTrustedUiTransactionRequest(
    {
      requestId: 'ui_internal',
      expectedRevision: state.revision,
      commands,
    },
    state.revision,
    { limits },
  );
  if (!normalized.ok) return { result: normalized.failure };
  return applyNormalizedTransactionCore(state, normalized.value, {
    limits,
    transactionId: 'ui_internal',
    baseValidationMode: 'structural',
    finalValidationMode: 'editable',
    finalSemanticErrorPolicy: 'resource-only',
    allowTransientParamValues: true,
    enforceAgentWritable: false,
    acceptPersistedBinds: true,
    allowEmptyLayerNames: true,
    trustedUiFastPath: fastPath,
  });
}

export type { NormalizedRequest, NormalizeResult };
