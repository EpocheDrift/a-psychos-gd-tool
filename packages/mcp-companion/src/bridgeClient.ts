import { createHash, randomBytes } from 'node:crypto';
import type { WebSocket, RawData } from 'ws';
import {
  COMPANION_PROTOCOL_VERSION,
  COMPANION_TRANSPORT_LIMITS,
  INTERACTIVE_SESSION_TTL_MS,
  TRUSTED_LOCAL_SESSION_TTL_MS,
  companionDeadlineMs,
  isCompanionWriteOperation,
  type CompanionBinaryHeader,
  type CompanionBinaryResult,
  type CompanionCallResult,
  type CompanionHello,
  type CompanionSuccess,
  type CompanionFailure,
  type CompanionOperation,
  type CompanionToolOperation,
} from './protocol.js';
import {
  CompanionFault,
  isPublicAgentFault,
  type PublicAgentFault,
} from './faults.js';
import { assertBoundedWireJson } from './boundedJson.js';
import { AGENT_ALLOWED_ORIGIN } from './agentSecurity.js';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_SEQUENCE = 0x7fff_ffff;
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export type BridgeHealthState =
  | 'waiting-for-browser'
  | 'waiting-for-human'
  | 'ready'
  | 'closed'
  | 'failed';

interface PendingRequest {
  operation: CompanionOperation;
  faultContext: CompanionFaultContext;
  resolve: (value: CompanionCallResult) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  clientCancelled?: boolean;
  onAbort?: () => void;
  signal?: AbortSignal;
}

interface CompanionFaultContext {
  revision?: number;
  requestId?: string;
}

export interface BridgeClientOptions {
  requestedScopes: readonly (
    'read' | 'preview' | 'edit' | 'assets' | 'model'
  )[];
  clientLabel?: string;
  maxSessionTtlMs?: number;
  requireExactScopes?: boolean;
  now?: () => number;
  onTerminal?: (reason: string) => void;
  /**
   * Test seam that may only shorten, never extend, the published hello
   * deadline.
   */
  helloDeadlineMs?: number;
}

function randomId(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function faultContextFromInput(input: unknown): CompanionFaultContext {
  if (!plainRecord(input)) return {};
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const dataValue = (key: string): unknown => {
    const descriptor = descriptors[key];
    return descriptor && 'value' in descriptor
      ? descriptor.value
      : undefined;
  };
  const requestedRevision = dataValue('revision');
  const expectedRevision = dataValue('expectedRevision');
  const revision = Number.isSafeInteger(requestedRevision)
    && (requestedRevision as number) >= 0
    ? requestedRevision as number
    : Number.isSafeInteger(expectedRevision)
        && (expectedRevision as number) >= 0
      ? expectedRevision as number
      : undefined;
  const rawRequestId = dataValue('requestId');
  const requestId =
    typeof rawRequestId === 'string'
    && /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
      .test(rawRequestId)
      ? rawRequestId
      : undefined;
  return {
    ...(revision === undefined ? {} : { revision }),
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function contextualizeCompanionFault(
  error: unknown,
  context: CompanionFaultContext,
): unknown {
  if (!(error instanceof CompanionFault)) return error;
  const fault = error.publicFault;
  return new CompanionFault(
    fault.error.code,
    fault.error.message,
    {
      revision: context.revision ?? fault.revision,
      requestId: context.requestId ?? fault.requestId,
      recoverable: fault.error.recoverable,
      ...(fault.error.path === undefined
        ? {}
        : { path: fault.error.path }),
      ...(fault.error.details === undefined
        ? {}
        : { details: fault.error.details }),
      ...(fault.error.suggestedFix === undefined
        ? {}
        : { suggestedFix: fault.error.suggestedFix }),
    },
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function isHello(
  value: unknown,
  connectionId: string,
  serverNonce: string,
): value is CompanionHello {
  return plainRecord(value)
    && hasExactKeys(value, [
      'kind',
      'protocolVersion',
      'connectionId',
      'serverNonce',
      'channelToken',
      'sequence',
    ])
    && value.kind === 'hello'
    && value.protocolVersion === COMPANION_PROTOCOL_VERSION
    && value.connectionId === connectionId
    && value.serverNonce === serverNonce
    && typeof value.channelToken === 'string'
    && TOKEN_PATTERN.test(value.channelToken)
    && value.sequence === 1;
}

function isAuthenticatedResponse(
  value: unknown,
  connectionId: string,
  channelToken: string,
  expectedSequence: number,
): value is CompanionSuccess | CompanionFailure {
  if (!plainRecord(value)) return false;
  if (
    value.kind !== 'response'
    || value.protocolVersion !== COMPANION_PROTOCOL_VERSION
    || value.connectionId !== connectionId
    || value.channelToken !== channelToken
    || value.sequence !== expectedSequence
    || !Number.isSafeInteger(value.sequence)
    || typeof value.requestId !== 'string'
    || !ID_PATTERN.test(value.requestId)
    || typeof value.ok !== 'boolean'
  ) {
    return false;
  }
  return value.ok
    ? hasExactKeys(value, [
        'kind',
        'protocolVersion',
        'connectionId',
        'channelToken',
        'sequence',
        'requestId',
        'ok',
        'value',
      ])
    : hasExactKeys(value, [
        'kind',
        'protocolVersion',
        'connectionId',
        'channelToken',
        'sequence',
        'requestId',
        'ok',
        'fault',
      ]) && isPublicAgentFault(value.fault);
}

function parseBinary(
  data: RawData,
  connectionId: string,
  channelToken: string,
  expectedSequence: number,
): {
  header: CompanionBinaryHeader;
  bytes: Uint8Array;
} | null {
  const buffer = Buffer.isBuffer(data)
    ? data
    : Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.from(data as ArrayBuffer);
  if (
    buffer.byteLength < 4
    || buffer.byteLength > COMPANION_TRANSPORT_LIMITS.maxBinaryMessageBytes
  ) {
    return null;
  }
  const headerLength = buffer.readUInt32BE(0);
  if (
    headerLength < 2
    || headerLength > COMPANION_TRANSPORT_LIMITS.maxBinaryHeaderBytes
    || 4 + headerLength > buffer.byteLength
  ) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(
      buffer.subarray(4, 4 + headerLength),
    ));
    assertBoundedWireJson(parsed);
  } catch {
    return null;
  }
  if (
    !plainRecord(parsed)
    || !hasExactKeys(parsed, [
      'kind',
      'protocolVersion',
      'connectionId',
      'channelToken',
      'sequence',
      'requestId',
      'ok',
      'value',
      'mimeType',
      'byteLength',
      'contentHash',
    ])
    || parsed.kind !== 'binary-response'
    || parsed.protocolVersion !== COMPANION_PROTOCOL_VERSION
    || parsed.connectionId !== connectionId
    || parsed.channelToken !== channelToken
    || parsed.sequence !== expectedSequence
    || parsed.ok !== true
    || typeof parsed.requestId !== 'string'
    || !ID_PATTERN.test(parsed.requestId)
    || !plainRecord(parsed.value)
    || (
      parsed.mimeType !== 'image/png'
      && parsed.mimeType !== 'image/webp'
    )
    || !Number.isSafeInteger(parsed.byteLength)
    || (parsed.byteLength as number) < 1
    || (parsed.byteLength as number)
      > COMPANION_TRANSPORT_LIMITS.maxPreviewBytes
    || typeof parsed.contentHash !== 'string'
    || !HASH_PATTERN.test(parsed.contentHash)
  ) {
    return null;
  }
  const bytes = buffer.subarray(4 + headerLength);
  if (bytes.byteLength !== parsed.byteLength) return null;
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== parsed.contentHash) return null;
  if (
    parsed.mimeType === 'image/png'
    && !bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return null;
  }
  if (
    parsed.mimeType === 'image/webp'
    && (
      bytes.byteLength < 12
      || bytes.toString('ascii', 0, 4) !== 'RIFF'
      || bytes.toString('ascii', 8, 12) !== 'WEBP'
    )
  ) {
    return null;
  }
  return {
    header: parsed as unknown as CompanionBinaryHeader,
    bytes: Uint8Array.from(bytes),
  };
}

function validatePairingSummary(
  value: CompanionCallResult,
  clientNonce: string,
  clientLabel: string,
  requestedScopes: readonly string[],
  maxSessionTtlMs: number,
  requireExactScopes: boolean,
): void {
  if (
    !plainRecord(value)
    || !hasExactKeys(value, [
      'protocolVersion',
      'clientLabel',
      'clientFingerprint',
      'sessionFingerprint',
      'origin',
      'scopes',
      'connectedAt',
      'expiresAt',
    ])
    || value.protocolVersion !== COMPANION_PROTOCOL_VERSION
    || value.clientLabel !== clientLabel
    || value.origin !== AGENT_ALLOWED_ORIGIN
    || typeof value.clientFingerprint !== 'string'
    || !/^[0-9a-f]{12}$/.test(value.clientFingerprint)
    || typeof value.sessionFingerprint !== 'string'
    || !/^[0-9a-f]{12}$/.test(value.sessionFingerprint)
    || !Array.isArray(value.scopes)
    || value.scopes.length < 1
    || new Set(value.scopes).size !== value.scopes.length
    || value.scopes.some((scope) =>
      typeof scope !== 'string' || !requestedScopes.includes(scope))
    || (
      requireExactScopes
      && (
        value.scopes.length !== requestedScopes.length
        || requestedScopes.some(
          (scope) => !(value.scopes as unknown[]).includes(scope),
        )
      )
    )
    || typeof value.connectedAt !== 'string'
    || typeof value.expiresAt !== 'string'
  ) {
    throw new CompanionFault(
      'UNAUTHENTICATED',
      'The browser returned an invalid pairing summary.',
      { recoverable: false },
    );
  }
  const expectedFingerprint = createHash('sha256')
    .update(`gfx.agent.client.v1\u0000${clientNonce}`)
    .digest('hex')
    .slice(0, 12);
  const connectedAt = Date.parse(value.connectedAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (
    value.clientFingerprint !== expectedFingerprint
    || !Number.isFinite(connectedAt)
    || !Number.isFinite(expiresAt)
    || new Date(connectedAt).toISOString() !== value.connectedAt
    || new Date(expiresAt).toISOString() !== value.expiresAt
    || expiresAt <= connectedAt
    || expiresAt - connectedAt > maxSessionTtlMs + 1_000
  ) {
    throw new CompanionFault(
      'UNAUTHENTICATED',
      'The browser pairing summary did not match this companion request.',
      { recoverable: false },
    );
  }
}

export class BridgeClient {
  private readonly requestedScopes;
  private readonly clientLabel: string;
  private readonly maxSessionTtlMs: number;
  private readonly requireExactScopes: boolean;
  private readonly now: () => number;
  private readonly onTerminal?: (reason: string) => void;
  private socket: WebSocket | null = null;
  private state: BridgeHealthState = 'waiting-for-browser';
  private connectionId = '';
  private serverNonce = '';
  private channelToken = '';
  private incomingSequence = 0;
  private outgoingSequence = 0;
  private pending = new Map<string, PendingRequest>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private helloDeadline: ReturnType<typeof setTimeout> | null = null;
  private readonly helloDeadlineMs: number;
  private lastPongAt = 0;
  private writeCount = 0;
  private awaitCount = 0;
  private previewCount = 0;
  private generation = 0;
  private rateTokens: number = COMPANION_TRANSPORT_LIMITS.requestBurst;
  private assetRateTokens: number =
    COMPANION_TRANSPORT_LIMITS.assetUploadRequestBurst;
  private lastRefillAt: number;

  constructor(options: BridgeClientOptions) {
    this.requestedScopes = Object.freeze([...options.requestedScopes]);
    this.clientLabel = options.clientLabel ?? 'Graphic Design MCP companion';
    const maxSessionTtlMs =
      options.maxSessionTtlMs ?? INTERACTIVE_SESSION_TTL_MS;
    if (
      !Number.isSafeInteger(maxSessionTtlMs)
      || maxSessionTtlMs < 1
      || maxSessionTtlMs > TRUSTED_LOCAL_SESSION_TTL_MS
    ) {
      throw new Error('The maximum Agent session lifetime is invalid.');
    }
    this.maxSessionTtlMs = maxSessionTtlMs;
    this.requireExactScopes = options.requireExactScopes ?? false;
    this.now = options.now ?? Date.now;
    this.onTerminal = options.onTerminal;
    const requestedHelloDeadline = options.helloDeadlineMs;
    this.helloDeadlineMs = Number.isFinite(requestedHelloDeadline)
      ? Math.max(
          1,
          Math.min(
            COMPANION_TRANSPORT_LIMITS.helloDeadlineMs,
            Math.trunc(requestedHelloDeadline as number),
          ),
        )
      : COMPANION_TRANSPORT_LIMITS.helloDeadlineMs;
    this.lastRefillAt = this.now();
  }

  healthState(): BridgeHealthState {
    return this.state;
  }

  hasOwner(): boolean {
    return this.socket !== null;
  }

  attach(socket: WebSocket): void {
    if (this.state === 'closed' || this.state === 'failed') {
      socket.close(1008, 'session is terminal');
      return;
    }
    if (this.socket) {
      socket.close(1008, 'owner already connected');
      return;
    }
    this.generation++;
    this.socket = socket;
    this.state = 'waiting-for-human';
    this.connectionId = randomId(16);
    this.serverNonce = randomId(32);
    this.channelToken = '';
    this.incomingSequence = 0;
    this.outgoingSequence = 0;
    this.lastPongAt = this.now();
    socket.on('message', (data, isBinary) => {
      this.handleMessage(data, isBinary);
    });
    socket.on('pong', () => {
      this.lastPongAt = this.now();
    });
    socket.once('close', () => {
      if (this.socket === socket) this.close('browser disconnected');
    });
    socket.once('error', () => {
      if (this.socket === socket) this.close('browser transport error');
    });
    const generation = this.generation;
    this.clearHelloDeadline();
    this.helloDeadline = setTimeout(() => {
      if (
        this.generation === generation
        && this.socket === socket
        && !this.channelToken
      ) {
        this.close('hello deadline');
      }
    }, this.helloDeadlineMs);
    this.helloDeadline.unref?.();
    this.sendRaw({
      kind: 'welcome',
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      connectionId: this.connectionId,
      serverNonce: this.serverNonce,
    });
  }

  async call(
    operation: CompanionToolOperation,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<CompanionCallResult> {
    const faultContext = faultContextFromInput(input);
    if (this.state !== 'ready') {
      if (this.state === 'failed' || this.state === 'closed') {
        throw new CompanionFault(
          'SESSION_REVOKED',
          'The browser companion session ended and must be restarted.',
          {
            ...faultContext,
            recoverable: true,
            suggestedFix: 'Restart the MCP companion and approve a new session.',
          },
        );
      }
      throw new CompanionFault(
        'PAIRING_NOT_APPROVED',
        'Open the local browser and approve the requested Agent scopes.',
        {
          ...faultContext,
          suggestedFix:
            'Click Connect Agent, review scopes, and approve this companion.',
        },
      );
    }
    this.consumeRateToken(operation, faultContext);
    const generation = this.generation;
    this.reserve(operation, faultContext);
    try {
      return await this.sendRequest(operation, input, signal);
    } finally {
      if (this.generation === generation) this.release(operation);
    }
  }

  close(reason = 'companion shutdown'): void {
    const normalShutdown =
      reason === 'companion shutdown' || reason === 'host shutdown';
    const notifyTerminal =
      !normalShutdown && this.state !== 'failed' && this.state !== 'closed';
    this.generation++;
    const socket = this.socket;
    this.socket = null;
    this.state = normalShutdown
      ? 'closed'
      : 'failed';
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.clearHelloDeadline();
    if (
      socket
      && (socket.readyState === socket.OPEN
        || socket.readyState === socket.CONNECTING)
    ) {
      socket.close(1000, reason.slice(0, 100));
    }
    for (const [requestId, entry] of this.pending) {
      this.settle(requestId);
      entry.reject(new CompanionFault(
        'SESSION_REVOKED',
        'The browser companion session is no longer available.',
        entry.faultContext,
      ));
    }
    this.pending.clear();
    this.writeCount = 0;
    this.awaitCount = 0;
    this.previewCount = 0;
    this.connectionId = '';
    this.serverNonce = '';
    this.channelToken = '';
    if (notifyTerminal) this.onTerminal?.(reason);
  }

  private handleMessage(data: RawData, isBinary: boolean): void {
    if (!this.socket) return;
    if (!this.channelToken) {
      if (isBinary) {
        this.protocolFailure('binary hello');
        return;
      }
      let parsed: unknown;
      try {
        const text = Buffer.isBuffer(data)
          ? data.toString('utf8')
          : String(data);
        if (
          Buffer.byteLength(text)
          > COMPANION_TRANSPORT_LIMITS.maxTextMessageBytes
        ) {
          throw new Error('hello too large');
        }
        parsed = JSON.parse(text);
      } catch {
        this.protocolFailure('invalid hello');
        return;
      }
      if (!isHello(parsed, this.connectionId, this.serverNonce)) {
        this.protocolFailure('invalid hello');
        return;
      }
      this.clearHelloDeadline();
      this.channelToken = parsed.channelToken;
      this.incomingSequence = 1;
      this.startHeartbeat();
      const clientNonce = randomId(32);
      void this.sendRequest('pairRequest', {
        protocolVersion: COMPANION_PROTOCOL_VERSION,
        clientNonce,
        clientLabel: this.clientLabel,
        requestedScopes: [...this.requestedScopes],
      }).then((summary) => {
        validatePairingSummary(
          summary,
          clientNonce,
          this.clientLabel,
          this.requestedScopes,
          this.maxSessionTtlMs,
          this.requireExactScopes,
        );
        if (this.socket) this.state = 'ready';
      }).catch(() => {
        this.close('pairing failed');
      });
      return;
    }

    if (this.incomingSequence >= MAX_SEQUENCE) {
      this.protocolFailure('sequence exhausted');
      return;
    }
    if (isBinary) {
      const parsed = parseBinary(
        data,
        this.connectionId,
        this.channelToken,
        this.incomingSequence + 1,
      );
      if (!parsed) {
        this.protocolFailure('invalid binary response');
        return;
      }
      const pending = this.pending.get(parsed.header.requestId);
      if (!pending || pending.operation !== 'capturePreview') {
        this.protocolFailure('unexpected binary response');
        return;
      }
      this.incomingSequence = parsed.header.sequence;
      const result: CompanionBinaryResult = {
        value: parsed.header.value,
        bytes: parsed.bytes,
        mimeType: parsed.header.mimeType,
        byteLength: parsed.header.byteLength,
        contentHash: parsed.header.contentHash,
      };
      this.settle(parsed.header.requestId);
      if (pending.clientCancelled) {
        pending.reject(new CompanionFault(
          'TIMEOUT',
          'The MCP client cancelled the request.',
          { ...pending.faultContext, recoverable: true },
        ));
      } else {
        pending.resolve(result);
      }
      return;
    }

    let parsed: unknown;
    try {
      const text = Buffer.isBuffer(data)
        ? data.toString('utf8')
        : String(data);
      if (
        Buffer.byteLength(text)
        > COMPANION_TRANSPORT_LIMITS.maxTextMessageBytes
      ) {
        throw new Error('message too large');
      }
      parsed = JSON.parse(text);
      assertBoundedWireJson(parsed);
    } catch {
      this.protocolFailure('invalid response');
      return;
    }
    if (!isAuthenticatedResponse(
      parsed,
      this.connectionId,
      this.channelToken,
      this.incomingSequence + 1,
    )) {
      this.protocolFailure('invalid response envelope');
      return;
    }
    const pending = this.pending.get(parsed.requestId);
    if (
      !pending
      || (pending.operation === 'capturePreview' && parsed.ok)
    ) {
      this.protocolFailure('unexpected response');
      return;
    }
    this.incomingSequence = parsed.sequence;
    this.settle(parsed.requestId);
    if (pending.clientCancelled) {
      pending.reject(new CompanionFault(
        'TIMEOUT',
        'The MCP client cancelled the request.',
        { ...pending.faultContext, recoverable: true },
      ));
    } else if (parsed.ok) {
      pending.resolve(parsed.value);
    } else {
      pending.reject(parsed.fault);
    }
  }

  private sendRequest(
    operation: CompanionOperation,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<CompanionCallResult> {
    const faultContext = faultContextFromInput(input);
    const socket = this.socket;
    if (!socket || socket.readyState !== socket.OPEN) {
      return Promise.reject(new CompanionFault(
        'SESSION_REVOKED',
        'The browser companion transport is not connected.',
        faultContext,
      ));
    }
    if (this.pending.size >= COMPANION_TRANSPORT_LIMITS.maxPendingRequests) {
      return Promise.reject(new CompanionFault(
        'RESOURCE_LIMIT',
        'The companion pending-request budget is exhausted.',
        faultContext,
      ));
    }
    if (signal?.aborted) {
      return Promise.reject(new CompanionFault(
        'TIMEOUT',
        'The MCP client cancelled the request before dispatch.',
        faultContext,
      ));
    }
    const requestId = randomId(16);
    return new Promise((resolve, reject) => {
      const deadline = companionDeadlineMs(operation);
      const timer = setTimeout(() => {
        const entry = this.pending.get(requestId);
        if (!entry) return;
        this.settle(requestId);
        if (isCompanionWriteOperation(operation)) {
          entry.reject(new CompanionFault(
            'TIMEOUT',
            'The write response deadline expired and its outcome is unknown.',
            {
              ...faultContext,
              recoverable: true,
              suggestedFix:
                'The pairing will close. Reconnect, read the current document, and verify whether the write committed; replay identity is guaranteed only inside the original live session, so do not assume a cross-session retry can recover the prior result.',
            },
          ));
          this.close('write response deadline');
          return;
        }
        entry.reject(new CompanionFault(
          'TIMEOUT',
          'The companion request deadline expired.',
          { ...faultContext, recoverable: true },
        ));
        this.close(`${operation} response deadline`);
      }, deadline);
      const entry: PendingRequest = {
        operation,
        faultContext,
        resolve,
        reject,
        timer,
        ...(signal && !isCompanionWriteOperation(operation) ? { signal } : {}),
      };
      if (signal && !isCompanionWriteOperation(operation)) {
        entry.onAbort = () => {
          const active = this.pending.get(requestId);
          if (!active) return;
          // Keep the reservation until the browser acknowledges cancellation.
          // This prevents a cancelled preview/render from admitting overlapping
          // work while the browser is still unwinding it.
          active.clientCancelled = true;
          this.sendCancel(requestId);
        };
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      this.pending.set(requestId, entry);
      try {
        this.sendAuthenticated({
          kind: 'request',
          requestId,
          operation,
          input,
        });
      } catch (error) {
        this.settle(requestId);
        reject(contextualizeCompanionFault(error, faultContext));
      }
    });
  }

  private sendCancel(requestId: string): void {
    if (!this.socket || !this.channelToken) return;
    try {
      this.sendAuthenticated({ kind: 'cancel', requestId });
    } catch {
      this.close('cancel transport failure');
    }
  }

  private sendAuthenticated(
    message:
      | {
          kind: 'request';
          requestId: string;
          operation: CompanionOperation;
          input: unknown;
        }
      | {
          kind: 'cancel';
          requestId: string;
        },
  ): void {
    if (this.outgoingSequence >= MAX_SEQUENCE) {
      throw new CompanionFault(
        'SESSION_EXPIRED',
        'The companion transport sequence is exhausted.',
      );
    }
    this.sendRaw({
      ...message,
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      connectionId: this.connectionId,
      channelToken: this.channelToken,
      sequence: ++this.outgoingSequence,
    });
  }

  private sendRaw(value: unknown): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== socket.OPEN) {
      throw new CompanionFault(
        'SESSION_REVOKED',
        'The browser companion transport is closed.',
      );
    }
    assertBoundedWireJson(value);
    const text = JSON.stringify(value);
    if (
      Buffer.byteLength(text)
      > COMPANION_TRANSPORT_LIMITS.maxTextMessageBytes
    ) {
      throw new CompanionFault(
        'RESOURCE_LIMIT',
        'The companion request exceeds the WebSocket message budget.',
      );
    }
    socket.send(text);
  }

  private settle(requestId: string): PendingRequest | null {
    const entry = this.pending.get(requestId);
    if (!entry) return null;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener('abort', entry.onAbort);
    }
    return entry;
  }

  private reserve(
    operation: CompanionToolOperation,
    faultContext: CompanionFaultContext,
  ): void {
    if (
      isCompanionWriteOperation(operation)
      && this.writeCount >= COMPANION_TRANSPORT_LIMITS.maxConcurrentWrites
    ) {
      throw new CompanionFault(
        'RESOURCE_LIMIT',
        'Only one Agent write may be active at a time.',
        faultContext,
      );
    }
    if (
      operation === 'awaitRender'
      && this.awaitCount >= COMPANION_TRANSPORT_LIMITS.maxPendingAwaitRender
    ) {
      throw new CompanionFault(
        'RESOURCE_LIMIT',
        'The pending render-wait budget is exhausted.',
        faultContext,
      );
    }
    if (
      operation === 'capturePreview'
      && this.previewCount >= COMPANION_TRANSPORT_LIMITS.maxPendingPreview
    ) {
      throw new CompanionFault(
        'RESOURCE_LIMIT',
        'Only one preview transfer may be active at a time.',
        faultContext,
      );
    }
    if (isCompanionWriteOperation(operation)) this.writeCount++;
    if (operation === 'awaitRender') this.awaitCount++;
    if (operation === 'capturePreview') this.previewCount++;
  }

  private release(operation: CompanionToolOperation): void {
    if (isCompanionWriteOperation(operation)) this.writeCount--;
    if (operation === 'awaitRender') this.awaitCount--;
    if (operation === 'capturePreview') this.previewCount--;
  }

  private consumeRateToken(
    operation: CompanionToolOperation,
    faultContext: CompanionFaultContext,
  ): void {
    const now = this.now();
    const elapsed = Math.max(0, now - this.lastRefillAt);
    this.lastRefillAt = now;
    const refill =
      elapsed
      * (COMPANION_TRANSPORT_LIMITS.requestsPerMinute / 60_000);
    this.rateTokens = Math.min(
      COMPANION_TRANSPORT_LIMITS.requestBurst,
      this.rateTokens + refill,
    );
    this.assetRateTokens = Math.min(
      COMPANION_TRANSPORT_LIMITS.assetUploadRequestBurst,
      this.assetRateTokens + refill,
    );
    if (operation === 'putAsset') {
      if (this.assetRateTokens < 1) {
        throw new CompanionFault(
          'RESOURCE_LIMIT',
          'The asset-upload request-rate budget is exhausted.',
          faultContext,
        );
      }
      this.assetRateTokens -= 1;
      return;
    }
    if (this.rateTokens < 1) {
      throw new CompanionFault(
        'RESOURCE_LIMIT',
        'The companion request-rate budget is exhausted.',
        faultContext,
      );
    }
    this.rateTokens -= 1;
  }

  private startHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      const socket = this.socket;
      if (!socket) return;
      if (
        this.now() - this.lastPongAt
        > COMPANION_TRANSPORT_LIMITS.heartbeatTimeoutMs
      ) {
        socket.terminate();
        this.close('heartbeat timeout');
        return;
      }
      socket.ping();
    }, COMPANION_TRANSPORT_LIMITS.heartbeatIntervalMs);
    this.heartbeat.unref?.();
  }

  private clearHelloDeadline(): void {
    if (this.helloDeadline) clearTimeout(this.helloDeadline);
    this.helloDeadline = null;
  }

  private protocolFailure(_reason: string): void {
    const socket = this.socket;
    if (socket && socket.readyState === socket.OPEN) {
      socket.close(1002, 'protocol violation');
    }
    this.close('protocol violation');
  }
}

export function remoteFaultFromUnknown(error: unknown): PublicAgentFault {
  if (isPublicAgentFault(error)) return error;
  if (error instanceof CompanionFault) return error.publicFault;
  return new CompanionFault(
    'INTERNAL',
    'The local companion failed safely.',
    { recoverable: false },
  ).publicFault;
}
