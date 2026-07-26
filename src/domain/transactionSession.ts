import type { Registry } from '../engine/registry';
import type { AgentErrorCode, ValidationFinding } from './agentErrors';
import type {
  AgentFailure,
  CommandApplication,
  RevertTransactionRequest,
  RuntimeDocumentState,
  TransactionChangeSummary,
  TransactionResult,
  TransactionSuccess,
} from './commandTypes';
import {
  applyNormalizedDocumentTransaction,
  normalizeTransactionRequest,
  type NormalizeResult,
} from './commands';
import {
  createSerializedProject,
  validateJsonValueSafety,
  type SerializedProjectV3,
} from './documentSchema';
import {
  MISSING,
  boundedCanonicalJsonByteLength,
  canonicalJsonStringify,
  cloneJsonValue,
  isPlainRecord,
  readOwnData,
  type JsonObject,
  type JsonValue,
} from './json';
import {
  resolveAgentLimits,
  type AgentLimits,
} from './limits';
import { isSafeId } from './paramCodecs';
import { sha256Hex } from './sha256';

export interface SessionApplication extends CommandApplication {
  /**
   * A replay intentionally never carries `next`, even when its cached result
   * describes a successful commit.
   */
  replayed: boolean;
  /**
   * Preparing an operation never mutates session state. The host must finalize
   * this opaque token only after it has built the complete atomic state commit.
   */
  finalizeToken: SessionFinalizeToken | null;
}

export interface TransactionSessionOptions {
  limits?: Partial<AgentLimits>;
  registry?: Registry;
}

interface ReplayEntry {
  fingerprint: string;
  result: TransactionResult;
}

interface TransactionRecord {
  transactionId: string;
  requestId: string;
  committedRevision: number;
  beforeProject: SerializedProjectV3;
  afterProjectDigest: string;
  kind: 'apply' | 'revert';
}

interface NormalizedRevert {
  request: RevertTransactionRequest;
  fingerprint: string;
}

export type RevertNormalization =
  | { ok: true; value: NormalizedRevert }
  | { ok: false; failure: AgentFailure; fingerprint?: string };

declare const capturedApplyRequestBrand: unique symbol;
declare const capturedRevertRequestBrand: unique symbol;
declare const sessionFinalizeTokenBrand: unique symbol;

export interface CapturedApplyRequest {
  readonly [capturedApplyRequestBrand]: true;
}

export interface CapturedRevertRequest {
  readonly [capturedRevertRequestBrand]: true;
}

interface CapturedRequestData<T> {
  owner: TransactionSession;
  value: T;
}

interface PendingFinalization {
  owner: TransactionSession;
  generation: number;
  requestId: string;
  fingerprint: string;
  cachedResult: TransactionResult;
  record?: TransactionRecord;
  recordBytes: number;
  incrementSequence: boolean;
}

/** Opaque, session-owned, one-shot token. */
export interface SessionFinalizeToken {
  readonly [sessionFinalizeTokenBrand]: true;
}

// Token payloads are deliberately off-object: Reflect.ownKeys(), descriptors,
// prototype tricks, and shallow freezing cannot expose or alter ledger data.
const pendingFinalizations = new WeakMap<object, PendingFinalization>();
const capturedApplyRequests = new WeakMap<object, CapturedRequestData<NormalizeResult>>();
const capturedRevertRequests = new WeakMap<object, CapturedRequestData<RevertNormalization>>();

function opaqueToken<T extends object>(): T {
  return Object.freeze(Object.create(null) as object) as T;
}

function cloneResult<T extends TransactionResult>(result: T): T {
  return cloneJsonValue(result as unknown as JsonValue) as unknown as T;
}

function cloneProject(project: SerializedProjectV3): SerializedProjectV3 {
  return cloneJsonValue(project as unknown as JsonValue) as unknown as SerializedProjectV3;
}

function projectFromState(state: RuntimeDocumentState): SerializedProjectV3 {
  return createSerializedProject(state.documentId, state.document, state.assets);
}

function projectDigest(state: RuntimeDocumentState): string {
  return sha256Hex(
    `gfx.project-state.v1\u0000${canonicalJsonStringify(
      projectFromState(state) as unknown as JsonValue,
    )}`,
  );
}

function transactionRecordByteLength(
  record: TransactionRecord,
  maximum: number,
): number {
  return boundedCanonicalJsonByteLength(record as unknown as JsonValue, maximum);
}

function makeFailure(
  revision: number,
  code: AgentErrorCode,
  message: string,
  options: {
    requestId?: string;
    path?: string;
    details?: Record<string, JsonValue>;
    recoverable?: boolean;
    suggestedFix?: string;
  } = {},
): AgentFailure {
  return {
    ok: false,
    ...(options.requestId ? { requestId: options.requestId } : {}),
    revision,
    error: {
      code,
      message,
      ...(options.path !== undefined ? { path: options.path } : {}),
      ...(options.details ? { details: options.details } : {}),
      recoverable: options.recoverable ?? code !== 'INTERNAL',
      ...(options.suggestedFix ? { suggestedFix: options.suggestedFix } : {}),
    },
  };
}

function findingFailure(
  revision: number,
  finding: ValidationFinding,
  requestId?: string,
): AgentFailure {
  return makeFailure(
    revision,
    finding.code as AgentErrorCode,
    `Unsafe revert request: ${finding.message}`,
    {
      requestId,
      path: finding.path,
      details: finding.details,
      recoverable: finding.recoverable,
      suggestedFix: finding.suggestedFix,
    },
  );
}

function safeId(
  value: unknown,
  limits: AgentLimits,
  revision: number,
  path: string,
  requestId?: string,
): string | AgentFailure {
  if (typeof value === 'string' && isSafeId(value, limits.maxIdLength)) return value;
  return makeFailure(
    revision,
    'INVALID_ARGUMENT',
    `Value must be an ASCII-safe identifier of at most ${limits.maxIdLength} characters.`,
    { requestId, path },
  );
}

function normalizeRevertRequestUnsafe(
  value: unknown,
  revision: number,
  limits: AgentLimits,
): RevertNormalization {
  const safety = validateJsonValueSafety(value, { limits, maxFindings: 1 });
  if (!safety.valid) {
    return { ok: false, failure: findingFailure(revision, safety.errors[0]!) };
  }
  if (!isPlainRecord(value)) {
    return {
      ok: false,
      failure: makeFailure(
        revision,
        'INVALID_ARGUMENT',
        'Revert request must be an object.',
        { path: '' },
      ),
    };
  }

  const rawRequestId = readOwnData(value, 'requestId');
  const requestIdOrFailure = safeId(
    rawRequestId === MISSING ? undefined : rawRequestId,
    limits,
    revision,
    '/requestId',
  );
  if (typeof requestIdOrFailure !== 'string') {
    return { ok: false, failure: requestIdOrFailure };
  }
  const requestId = requestIdOrFailure;

  const byteLength = boundedCanonicalJsonByteLength(
    value as JsonObject,
    limits.maxTransactionJsonBytes,
  );
  if (byteLength > limits.maxTransactionJsonBytes) {
    return {
      ok: false,
      failure: makeFailure(
        revision,
        'RESOURCE_LIMIT',
        `Revert request exceeds ${limits.maxTransactionJsonBytes} UTF-8 bytes.`,
        {
          requestId,
          path: '',
          details: {
            actualBytesAtLeast: byteLength,
            maximumBytes: limits.maxTransactionJsonBytes,
          },
        },
      ),
    };
  }

  const fallback = Object.create(null) as JsonObject;
  for (const key of Object.keys(value).sort()) {
    if (key === 'requestId') continue;
    const child = readOwnData(value, key);
    if (child !== MISSING) fallback[key] = cloneJsonValue(child as JsonValue);
  }
  const fallbackFingerprint = sha256Hex(
    `gfx.revert-transaction.v1\u0000${canonicalJsonStringify(fallback)}`,
  );

  const keys = Object.keys(value).sort();
  const unknown = keys.find(
    (key) => key !== 'requestId' && key !== 'expectedRevision' && key !== 'transactionId',
  );
  if (unknown) {
    return {
      ok: false,
      failure: makeFailure(
        revision,
        'INVALID_ARGUMENT',
        `Unknown field "${unknown}".`,
        { requestId, path: `/${unknown.replace(/~/g, '~0').replace(/\//g, '~1')}` },
      ),
      fingerprint: fallbackFingerprint,
    };
  }

  const rawExpectedRevision = readOwnData(value, 'expectedRevision');
  const expectedRevision = rawExpectedRevision === MISSING ? undefined : rawExpectedRevision;
  if (
    typeof expectedRevision !== 'number'
    || !Number.isSafeInteger(expectedRevision)
    || expectedRevision < 0
  ) {
    return {
      ok: false,
      failure: makeFailure(
        revision,
        'INVALID_ARGUMENT',
        'expectedRevision must be a non-negative safe integer.',
        { requestId, path: '/expectedRevision' },
      ),
      fingerprint: fallbackFingerprint,
    };
  }

  const rawTransactionId = readOwnData(value, 'transactionId');
  const transactionIdOrFailure = safeId(
    rawTransactionId === MISSING ? undefined : rawTransactionId,
    limits,
    revision,
    '/transactionId',
    requestId,
  );
  if (typeof transactionIdOrFailure !== 'string') {
    return {
      ok: false,
      failure: transactionIdOrFailure,
      fingerprint: fallbackFingerprint,
    };
  }
  const transactionId = transactionIdOrFailure;
  const digestInput: JsonObject = { expectedRevision, transactionId };
  return {
    ok: true,
    value: {
      request: { requestId, expectedRevision, transactionId },
      fingerprint: sha256Hex(
        `gfx.revert-transaction.v1\u0000${canonicalJsonStringify(digestInput)}`,
      ),
    },
  };
}

function normalizeRevertRequest(
  value: unknown,
  revision: number,
  limits: AgentLimits,
): RevertNormalization {
  try {
    return normalizeRevertRequestUnsafe(value, revision, limits);
  } catch {
    return {
      ok: false,
      failure: makeFailure(
        revision,
        'INTERNAL',
        'Unexpected revert request normalization failure.',
        { recoverable: false },
      ),
    };
  }
}

function nodeMap(project: SerializedProjectV3): Map<string, JsonValue> {
  const result = new Map<string, JsonValue>();
  for (const layer of project.document.layers) {
    for (const [nodeId, node] of Object.entries(layer.graph.nodes)) {
      result.set(
        canonicalJsonStringify([layer.id, nodeId]),
        node as unknown as JsonValue,
      );
    }
  }
  return result;
}

function changedSummary(
  before: SerializedProjectV3,
  after: SerializedProjectV3,
): TransactionChangeSummary {
  const beforeLayers = new Map(before.document.layers.map((layer, index) => [layer.id, { layer, index }]));
  const afterLayers = new Map(after.document.layers.map((layer, index) => [layer.id, { layer, index }]));
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

  const beforeNodes = nodeMap(before);
  const afterNodes = nodeMap(after);
  const changedNodeKeys = new Set<string>();
  for (const key of new Set([...beforeNodes.keys(), ...afterNodes.keys()])) {
    const left = beforeNodes.get(key);
    const right = afterNodes.get(key);
    if (
      left === undefined
      || right === undefined
      || canonicalJsonStringify(left) !== canonicalJsonStringify(right)
    ) {
      changedNodeKeys.add(key);
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
      const key = canonicalJsonStringify(edge as unknown as JsonValue);
      if (!afterEdgeKeys.has(key)) {
        changedNodeKeys.add(canonicalJsonStringify([layerId, edge.from.node]));
        changedNodeKeys.add(canonicalJsonStringify([layerId, edge.to.node]));
      }
    }
    for (const edge of afterEdges) {
      const key = canonicalJsonStringify(edge as unknown as JsonValue);
      if (!beforeEdgeKeys.has(key)) {
        changedNodeKeys.add(canonicalJsonStringify([layerId, edge.from.node]));
        changedNodeKeys.add(canonicalJsonStringify([layerId, edge.to.node]));
      }
    }
  }

  const nodes = [...changedNodeKeys]
    .map((key) => JSON.parse(key) as [string, string])
    .map(([layerId, nodeId]) => ({ layerId, nodeId }))
    .sort(
      (left, right) =>
        left.layerId.localeCompare(right.layerId)
        || left.nodeId.localeCompare(right.nodeId),
    );
  const edgeCount = (project: SerializedProjectV3): number =>
    project.document.layers.reduce((sum, layer) => sum + layer.graph.edges.length, 0);

  return {
    frame:
      before.document.frame.width !== after.document.frame.width
      || before.document.frame.height !== after.document.frame.height,
    layerIds,
    nodes,
    edgeCountDelta: edgeCount(after) - edgeCount(before),
    replacedEdges: [],
  };
}

export class TransactionSession {
  private readonly limits: AgentLimits;
  private readonly registry?: Registry;
  private readonly replayCache = new Map<string, ReplayEntry>();
  private readonly ledger = new Map<string, TransactionRecord>();
  private nextTransactionSequence = 1;
  private ledgerBytes = 0;
  private generation = 0;

  constructor(options: TransactionSessionOptions = {}) {
    this.limits = resolveAgentLimits(options.limits);
    this.registry = options.registry;
  }

  /**
   * Capture and clone all caller-controlled apply data. Hosts must call this
   * outside their state updater so Proxy traps cannot re-enter a captured
   * mutation.
   */
  captureApply(request: unknown): CapturedApplyRequest {
    const normalized = normalizeTransactionRequest(request, 0, {
      limits: this.limits,
    });
    const captured = opaqueToken<CapturedApplyRequest>();
    capturedApplyRequests.set(captured, { owner: this, value: normalized });
    return captured;
  }

  /** Capture and clone all caller-controlled revert data outside the updater. */
  captureRevert(request: unknown): CapturedRevertRequest {
    const normalized = normalizeRevertRequest(request, 0, this.limits);
    const captured = opaqueToken<CapturedRevertRequest>();
    capturedRevertRequests.set(captured, { owner: this, value: normalized });
    return captured;
  }

  prepareApply(
    current: RuntimeDocumentState,
    captured: CapturedApplyRequest,
  ): SessionApplication {
    const capture = capturedApplyRequests.get(captured);
    if (!capture || capture.owner !== this) {
      return {
        result: makeFailure(
          current.revision,
          'INTERNAL',
          'Apply request capture is invalid for this session.',
          { recoverable: false },
        ),
        replayed: false,
        finalizeToken: null,
      };
    }
    const normalized = capture.value;
    if (!normalized.ok) {
      const capturedFailure = cloneResult(normalized.failure);
      capturedFailure.revision = current.revision;
      const requestId = capturedFailure.requestId;
      if (!requestId || !normalized.fingerprint) {
        return {
          result: capturedFailure,
          replayed: false,
          finalizeToken: null,
        };
      }
      const replay = this.lookup(requestId, normalized.fingerprint, current.revision);
      if (replay) return replay;
      if (this.replayCache.size >= this.limits.maxRequestCacheEntries) {
        return this.cacheFull(current.revision, requestId);
      }
      return this.prepareSettlement(requestId, normalized.fingerprint, capturedFailure);
    }

    const { request: normalizedRequest, fingerprint } = normalized.value;
    const replay = this.lookup(normalizedRequest.requestId, fingerprint, current.revision);
    if (replay) return replay;
    if (this.replayCache.size >= this.limits.maxRequestCacheEntries) {
      return this.cacheFull(current.revision, normalizedRequest.requestId);
    }
    if (
      normalizedRequest.dryRun !== true
      && this.ledger.size >= this.limits.maxTransactionLedgerEntries
    ) {
      return this.prepareSettlement(
        normalizedRequest.requestId,
        fingerprint,
        makeFailure(
          current.revision,
          'RESOURCE_LIMIT',
          'Transaction ledger is full for this session.',
          {
            requestId: normalizedRequest.requestId,
            details: { maximumEntries: this.limits.maxTransactionLedgerEntries },
          },
        ),
      );
    }

    const transactionId = normalizedRequest.dryRun === true
      ? undefined
      : this.nextTransactionId(current.revision, normalizedRequest.requestId);
    if (typeof transactionId !== 'string' && transactionId !== undefined) {
      return this.prepareSettlement(normalizedRequest.requestId, fingerprint, transactionId);
    }
    const application = applyNormalizedDocumentTransaction(current, normalized.value, {
      limits: this.limits,
      ...(this.registry ? { registry: this.registry } : {}),
      ...(transactionId ? { transactionId } : {}),
    });
    if (!application.result.ok || !application.next) {
      return this.prepareSettlement(
        normalizedRequest.requestId,
        fingerprint,
        application.result,
      );
    }

    const beforeProject = cloneProject(projectFromState(current));
    const record: TransactionRecord = {
      transactionId: transactionId!,
      requestId: normalizedRequest.requestId,
      committedRevision: application.next.revision,
      beforeProject,
      afterProjectDigest: projectDigest(application.next),
      kind: 'apply',
    };
    const remainingLedgerBytes = this.limits.maxTransactionLedgerBytes - this.ledgerBytes;
    const recordBytes = transactionRecordByteLength(record, remainingLedgerBytes);
    if (recordBytes > remainingLedgerBytes) {
      return this.prepareSettlement(
        normalizedRequest.requestId,
        fingerprint,
        makeFailure(
          current.revision,
          'RESOURCE_LIMIT',
          'Transaction ledger byte budget is exhausted for this session.',
          {
            requestId: normalizedRequest.requestId,
            details: {
              currentBytes: this.ledgerBytes,
              requestedBytesAtLeast: recordBytes,
              maximumBytes: this.limits.maxTransactionLedgerBytes,
            },
          },
        ),
      );
    }
    const settled = this.prepareSettlement(
      normalizedRequest.requestId,
      fingerprint,
      application.result,
      { record, recordBytes, incrementSequence: true },
    );
    return {
      ...settled,
      next: application.next,
    };
  }

  prepareRevert(
    current: RuntimeDocumentState,
    captured: CapturedRevertRequest,
  ): SessionApplication {
    const capture = capturedRevertRequests.get(captured);
    if (!capture || capture.owner !== this) {
      return {
        result: makeFailure(
          current.revision,
          'INTERNAL',
          'Revert request capture is invalid for this session.',
          { recoverable: false },
        ),
        replayed: false,
        finalizeToken: null,
      };
    }
    const normalized = capture.value;
    if (!normalized.ok) {
      const capturedFailure = cloneResult(normalized.failure);
      capturedFailure.revision = current.revision;
      const requestId = capturedFailure.requestId;
      if (!requestId || !normalized.fingerprint) {
        return {
          result: capturedFailure,
          replayed: false,
          finalizeToken: null,
        };
      }
      const replay = this.lookup(requestId, normalized.fingerprint, current.revision);
      if (replay) return replay;
      if (this.replayCache.size >= this.limits.maxRequestCacheEntries) {
        return this.cacheFull(current.revision, requestId);
      }
      return this.prepareSettlement(requestId, normalized.fingerprint, capturedFailure);
    }

    const { request: normalizedRequest, fingerprint } = normalized.value;
    const replay = this.lookup(normalizedRequest.requestId, fingerprint, current.revision);
    if (replay) return replay;
    if (this.replayCache.size >= this.limits.maxRequestCacheEntries) {
      return this.cacheFull(current.revision, normalizedRequest.requestId);
    }

    const reject = (
      code: AgentErrorCode,
      message: string,
      options: { path?: string; details?: Record<string, JsonValue> } = {},
    ): SessionApplication => this.prepareSettlement(
      normalizedRequest.requestId,
      fingerprint,
      makeFailure(current.revision, code, message, {
        requestId: normalizedRequest.requestId,
        ...options,
      }),
    );

    if (normalizedRequest.expectedRevision !== current.revision) {
      return reject(
        'REVISION_CONFLICT',
        `Expected revision ${normalizedRequest.expectedRevision}, current revision is ${current.revision}.`,
        {
          path: '/expectedRevision',
          details: {
            expectedRevision: normalizedRequest.expectedRevision,
            currentRevision: current.revision,
          },
        },
      );
    }
    if (current.revision >= Number.MAX_SAFE_INTEGER) {
      return reject('RESOURCE_LIMIT', 'Document revision is exhausted.');
    }
    if (this.ledger.size >= this.limits.maxTransactionLedgerEntries) {
      return reject(
        'RESOURCE_LIMIT',
        'Transaction ledger is full for this session.',
        { details: { maximumEntries: this.limits.maxTransactionLedgerEntries } },
      );
    }

    const target = this.ledger.get(normalizedRequest.transactionId);
    if (!target) {
      return reject(
        'INVALID_ARGUMENT',
        'Transaction is not available in this session.',
        { path: '/transactionId' },
      );
    }
    if (
      target.committedRevision !== current.revision
      || projectDigest(current) !== target.afterProjectDigest
    ) {
      return reject(
        'REVISION_CONFLICT',
        'Transaction is no longer the current compatible document head.',
        {
          path: '/transactionId',
          details: {
            transactionRevision: target.committedRevision,
            currentRevision: current.revision,
          },
        },
      );
    }

    const transactionId = this.nextTransactionId(
      current.revision,
      normalizedRequest.requestId,
    );
    if (typeof transactionId !== 'string') {
      return this.prepareSettlement(normalizedRequest.requestId, fingerprint, transactionId);
    }
    const beforeProject = cloneProject(projectFromState(current));
    const restored = cloneProject(target.beforeProject);
    const next: RuntimeDocumentState = {
      documentId: restored.documentId,
      document: restored.document,
      assets: restored.assets,
      revision: current.revision + 1,
    };
    const record: TransactionRecord = {
      transactionId,
      requestId: normalizedRequest.requestId,
      committedRevision: next.revision,
      beforeProject,
      afterProjectDigest: projectDigest(next),
      kind: 'revert',
    };
    const remainingLedgerBytes = this.limits.maxTransactionLedgerBytes - this.ledgerBytes;
    const recordBytes = transactionRecordByteLength(record, remainingLedgerBytes);
    if (recordBytes > remainingLedgerBytes) {
      return reject(
        'RESOURCE_LIMIT',
        'Transaction ledger byte budget is exhausted for this session.',
        {
          details: {
            currentBytes: this.ledgerBytes,
            requestedBytesAtLeast: recordBytes,
            maximumBytes: this.limits.maxTransactionLedgerBytes,
          },
        },
      );
    }
    const result: TransactionSuccess = {
      ok: true,
      requestId: normalizedRequest.requestId,
      dryRun: false,
      committed: true,
      transactionId,
      previousRevision: current.revision,
      revision: next.revision,
      proposedRevision: next.revision,
      created: Object.create(null) as Record<string, string>,
      createdEntities: Object.create(null),
      changed: changedSummary(beforeProject, restored),
      warnings: [],
    };

    const settled = this.prepareSettlement(
      normalizedRequest.requestId,
      fingerprint,
      result,
      { record, recordBytes, incrementSequence: true },
    );
    return { ...settled, next };
  }

  /**
   * Atomically publish a prepared replay entry and optional ledger record.
   * No callbacks, cloning, hashing, validation, or user-controlled objects are
   * touched here; a host can make this its final action before returning a
   * prebuilt state replacement.
   */
  finalize(token: SessionFinalizeToken): boolean {
    if ((typeof token !== 'object' && typeof token !== 'function') || token === null) {
      return false;
    }
    const pending = pendingFinalizations.get(token);
    if (!pending || pending.owner !== this) {
      return false;
    }
    pendingFinalizations.delete(token);
    if (pending.generation !== this.generation) return false;
    if (
      this.replayCache.has(pending.requestId)
      || this.replayCache.size >= this.limits.maxRequestCacheEntries
    ) {
      return false;
    }
    if (pending.record) {
      if (
        this.ledger.has(pending.record.transactionId)
        || this.ledger.size >= this.limits.maxTransactionLedgerEntries
        || pending.recordBytes > this.limits.maxTransactionLedgerBytes - this.ledgerBytes
        || !pending.incrementSequence
      ) {
        return false;
      }
    }

    this.replayCache.set(pending.requestId, {
      fingerprint: pending.fingerprint,
      result: pending.cachedResult,
    });
    if (pending.record) {
      this.ledger.set(pending.record.transactionId, pending.record);
      this.ledgerBytes += pending.recordBytes;
      this.nextTransactionSequence++;
    }
    this.generation++;
    return true;
  }

  /** Test/debug-only bounded counts; no project or request content is exposed. */
  getStats(): Readonly<{
    replayEntries: number;
    ledgerEntries: number;
    ledgerBytes: number;
  }> {
    return Object.freeze({
      replayEntries: this.replayCache.size,
      ledgerEntries: this.ledger.size,
      ledgerBytes: this.ledgerBytes,
    });
  }

  private nextTransactionId(
    revision: number,
    requestId: string,
  ): string | AgentFailure {
    const candidate = `transaction_${this.nextTransactionSequence}`;
    if (!isSafeId(candidate, this.limits.maxIdLength)) {
      return makeFailure(
        revision,
        'INTERNAL',
        'Transaction ID allocator returned an invalid identifier.',
        { requestId },
      );
    }
    if (this.ledger.has(candidate)) {
      return makeFailure(
        revision,
        'INTERNAL',
        'Transaction ID allocator returned a duplicate identifier.',
        { requestId },
      );
    }
    return candidate;
  }

  private lookup(
    requestId: string,
    fingerprint: string,
    revision: number,
  ): SessionApplication | null {
    const cached = this.replayCache.get(requestId);
    if (!cached) return null;
    if (cached.fingerprint === fingerprint) {
      return {
        result: cloneResult(cached.result),
        replayed: true,
        finalizeToken: null,
      };
    }
    return {
      result: makeFailure(
        revision,
        'REQUEST_ID_REUSED',
        `requestId "${requestId}" was already used with different arguments.`,
        { requestId, path: '/requestId' },
      ),
      replayed: false,
      finalizeToken: null,
    };
  }

  private prepareSettlement(
    requestId: string,
    fingerprint: string,
    result: TransactionResult,
    options: {
      record?: TransactionRecord;
      recordBytes?: number;
      incrementSequence?: boolean;
    } = {},
  ): SessionApplication {
    const publicResult = cloneResult(result);
    const pending: PendingFinalization = {
      owner: this,
      generation: this.generation,
      requestId,
      fingerprint,
      cachedResult: cloneResult(result),
      ...(options.record ? { record: options.record } : {}),
      recordBytes: options.recordBytes ?? 0,
      incrementSequence: options.incrementSequence === true,
    };
    const finalizeToken = opaqueToken<SessionFinalizeToken>();
    pendingFinalizations.set(finalizeToken, pending);
    return {
      result: publicResult,
      replayed: false,
      finalizeToken,
    };
  }

  private cacheFull(revision: number, requestId: string): SessionApplication {
    return {
      result: makeFailure(
        revision,
        'RESOURCE_LIMIT',
        'Request replay cache is full for this session.',
        {
          requestId,
          details: { maximumEntries: this.limits.maxRequestCacheEntries },
        },
      ),
      replayed: false,
      finalizeToken: null,
    };
  }
}
