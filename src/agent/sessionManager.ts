import { TransactionSession } from '../domain/transactionSession';
import { sha256Hex } from '../domain/sha256';
import type { JsonObject, JsonValue } from '../domain/json';
import {
  AGENT_PROTOCOL_VERSION,
  AGENT_SCOPES,
  AGENT_V1_AVAILABLE_SCOPES,
  type AgentBridgeError,
  type AgentScope,
  type AgentSessionSummary,
  type CompletePairingRequest,
  type PairingChallenge,
  type PairingRequest,
  type PairingResult,
} from './contracts';
import { bridgeError, controllerFault, isControllerFault } from './faults';
import {
  captureJsonObject,
  optionalStringArray,
  own,
  requireString,
} from './jsonBoundary';
import {
  evaluateAgentRuntimeGate,
  type AgentRuntimeContext,
} from './runtimeGate';

const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const DEFAULT_PAIRING_TTL_MS = 60_000;
const DEFAULT_SESSION_TTL_MS = 30 * 60_000;
const MAX_CLIENT_LABEL = 80;
const MAX_CLAIM_FAILURES = 3;
const MAX_CONSUMED_PAIRINGS = 32;
const UNSAFE_CLIENT_LABEL =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/u;

type TimerHandle = ReturnType<typeof setTimeout>;

export type AgentConnectionPhase =
  | 'idle'
  | 'armed'
  | 'pending'
  | 'approved'
  | 'connected'
  | 'revoked'
  | 'expired'
  | 'error';

export interface AgentConnectionSnapshot {
  phase: AgentConnectionPhase;
  origin: string;
  clientLabel: string | null;
  clientFingerprint: string | null;
  sessionFingerprint: string | null;
  requestedScopes: AgentScope[];
  grantedScopes: AgentScope[];
  availableScopes: AgentScope[];
  expiresAt: string | null;
  error: AgentBridgeError | null;
}

interface PendingPairing {
  pairingId: string;
  clientNonce: string;
  serverNonce: string;
  claimTokenDigest: string;
  clientLabel: string;
  clientFingerprint: string;
  requestedScopes: AgentScope[];
  expiresAtMs: number;
  approvedScopes: AgentScope[] | null;
  claimFailures: number;
}

export interface AgentSessionLease {
  readonly sessionFingerprint: string;
  readonly clientLabel: string;
  readonly clientFingerprint: string;
  readonly origin: string;
  readonly scopes: ReadonlySet<AgentScope>;
  readonly connectedAtMs: number;
  readonly expiresAtMs: number;
  readonly signal: AbortSignal;
  readonly transactions: TransactionSession;
}

interface InternalLease extends AgentSessionLease {
  readonly identity: object;
  readonly controller: AbortController;
}

export interface AgentSessionManagerOptions {
  allowedOrigin: string;
  context: () => AgentRuntimeContext;
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
  pairingTtlMs?: number;
  sessionTtlMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

export interface CompletedPairing {
  lease: AgentSessionLease;
  summary: AgentSessionSummary;
}

function base64Url(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const value =
      (first << 16)
      | ((second ?? 0) << 8)
      | (third ?? 0);
    output += alphabet[(value >>> 18) & 63];
    output += alphabet[(value >>> 12) & 63];
    if (second !== undefined) output += alphabet[(value >>> 6) & 63];
    if (third !== undefined) output += alphabet[value & 63];
  }
  return output;
}

function immutableScopeSet(
  values: readonly AgentScope[],
): ReadonlySet<AgentScope> {
  const source = new Set(values);
  let view: ReadonlySet<AgentScope>;
  view = {
    get size() {
      return source.size;
    },
    has: (value) => source.has(value),
    entries: () => source.entries(),
    keys: () => source.keys(),
    values: () => source.values(),
    forEach: (callback, thisArg) => {
      source.forEach((value) => callback.call(thisArg, value, value, view));
    },
    [Symbol.iterator]: () => source[Symbol.iterator](),
  };
  return Object.freeze(view);
}

function defaultRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function iso(timeMs: number): string {
  return new Date(timeMs).toISOString();
}

function sameSecret(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function pairingFailure(
  error: AgentBridgeError,
): { ok: false; error: AgentBridgeError } {
  return { ok: false, error };
}

function normalizedClientLabel(value: string, revision: number): string {
  if (UNSAFE_CLIENT_LABEL.test(value)) {
    throw controllerFault(
      revision,
      'INVALID_ARGUMENT',
      'clientLabel contains unsafe control or bidirectional formatting characters.',
      { path: '/clientLabel' },
    );
  }
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (normalized.length === 0 || normalized.length > MAX_CLIENT_LABEL) {
    throw controllerFault(
      revision,
      'INVALID_ARGUMENT',
      `clientLabel must contain between 1 and ${MAX_CLIENT_LABEL} visible characters.`,
      { path: '/clientLabel' },
    );
  }
  return normalized;
}

function resultFromThrown(error: unknown): { ok: false; error: AgentBridgeError } {
  if (isControllerFault(error)) return pairingFailure(error.error);
  return pairingFailure(bridgeError(
    'INVALID_ARGUMENT',
    'The pairing request is invalid.',
  ));
}

export class AgentSessionManager {
  private readonly allowedOrigin: string;
  private readonly contextProvider: () => AgentRuntimeContext;
  private readonly now: () => number;
  private readonly randomBytes: (length: number) => Uint8Array;
  private readonly pairingTtlMs: number;
  private readonly sessionTtlMs: number;
  private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;
  private readonly listeners = new Set<() => void>();
  private readonly consumedPairings = new Set<string>();
  private phase: AgentConnectionPhase = 'idle';
  private armedUntilMs = 0;
  private pending: PendingPairing | null = null;
  private active: InternalLease | null = null;
  private timer: TimerHandle | null = null;
  private lastError: AgentBridgeError | null = null;
  private snapshot: AgentConnectionSnapshot;

  constructor(options: AgentSessionManagerOptions) {
    this.allowedOrigin = options.allowedOrigin;
    this.contextProvider = options.context;
    this.now = options.now ?? Date.now;
    this.randomBytes = options.randomBytes ?? defaultRandomBytes;
    this.pairingTtlMs = options.pairingTtlMs ?? DEFAULT_PAIRING_TTL_MS;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
    this.snapshot = this.buildSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AgentConnectionSnapshot => this.snapshot;

  armPairing(): PairingResult<JsonObject> {
    const gate = this.gate();
    if (!gate.ok) return pairingFailure(gate.error);
    this.sweep();
    if (this.active) {
      return pairingFailure(bridgeError(
        'OWNER_ALREADY_CONNECTED',
        'An Agent session already owns this document.',
      ));
    }
    if (this.pending) {
      return pairingFailure(bridgeError(
        'OWNER_ALREADY_CONNECTED',
        'A pairing request is already pending.',
      ));
    }
    this.phase = 'armed';
    this.armedUntilMs = this.now() + this.pairingTtlMs;
    this.lastError = null;
    this.reschedule(this.armedUntilMs);
    this.publish();
    return {
      ok: true,
      value: {
        phase: 'armed',
        expiresAt: iso(this.armedUntilMs),
      },
    };
  }

  cancelPairing(): void {
    if (this.active) return;
    this.pending = null;
    this.armedUntilMs = 0;
    this.phase = 'idle';
    this.lastError = null;
    this.reschedule(null);
    this.publish();
  }

  requestPairing(raw: PairingRequest): PairingResult<PairingChallenge> {
    const gate = this.gate();
    if (!gate.ok) return pairingFailure(gate.error);
    this.sweep();
    if (this.active) {
      return pairingFailure(bridgeError(
        'OWNER_ALREADY_CONNECTED',
        'An Agent session already owns this document.',
      ));
    }
    if (this.phase !== 'armed' || this.now() >= this.armedUntilMs) {
      return pairingFailure(bridgeError(
        'PAIRING_NOT_ARMED',
        'A human must first open the in-app Agent pairing window.',
      ));
    }
    if (this.pending) {
      return pairingFailure(bridgeError(
        'OWNER_ALREADY_CONNECTED',
        'A pairing request is already pending.',
      ));
    }

    let request: PairingRequest;
    try {
      const value = captureJsonObject(raw, {
        allowedKeys: [
          'protocolVersion',
          'clientNonce',
          'clientLabel',
          'requestedScopes',
        ],
        revision: 0,
        label: 'Pairing request',
        maxBytes: 16 * 1024,
      });
      const protocolVersion = requireString(value, 'protocolVersion', 0, {
        minLength: 3,
        maxLength: 16,
      });
      if (protocolVersion !== AGENT_PROTOCOL_VERSION) {
        throw controllerFault(
          0,
          'INVALID_ARGUMENT',
          `protocolVersion must be "${AGENT_PROTOCOL_VERSION}".`,
          { path: '/protocolVersion' },
        );
      }
      const clientNonce = requireString(value, 'clientNonce', 0, {
        minLength: 43,
        maxLength: 43,
        pattern: NONCE_PATTERN,
      });
      const clientLabel = normalizedClientLabel(
        requireString(value, 'clientLabel', 0, {
        minLength: 1,
        maxLength: MAX_CLIENT_LABEL,
        }),
        0,
      );
      const requestedScopes = optionalStringArray(
        value,
        'requestedScopes',
        0,
        {
          maximum: AGENT_SCOPES.length,
          allowed: new Set(AGENT_SCOPES),
        },
      );
      if (!requestedScopes || requestedScopes.length === 0) {
        throw controllerFault(
          0,
          'INVALID_ARGUMENT',
          'requestedScopes must contain at least one scope.',
          { path: '/requestedScopes' },
        );
      }
      request = {
        protocolVersion: AGENT_PROTOCOL_VERSION,
        clientNonce,
        clientLabel,
        requestedScopes: requestedScopes as AgentScope[],
      };
    } catch (error) {
      return resultFromThrown(error);
    }

    const pairingId = base64Url(this.randomBytes(16));
    const serverNonce = base64Url(this.randomBytes(32));
    const claimToken = base64Url(this.randomBytes(32));
    const expiresAtMs = this.now() + this.pairingTtlMs;
    this.pending = {
      pairingId,
      clientNonce: request.clientNonce,
      serverNonce,
      claimTokenDigest: sha256Hex(`gfx.agent.claim.v1\u0000${claimToken}`),
      clientLabel: request.clientLabel,
      clientFingerprint: sha256Hex(
        `gfx.agent.client.v1\u0000${request.clientNonce}`,
      ).slice(0, 12),
      requestedScopes: [...request.requestedScopes],
      expiresAtMs,
      approvedScopes: null,
      claimFailures: 0,
    };
    this.phase = 'pending';
    this.armedUntilMs = 0;
    this.lastError = null;
    this.reschedule(expiresAtMs);
    this.publish();
    return {
      ok: true,
      value: {
        protocolVersion: AGENT_PROTOCOL_VERSION,
        pairingId,
        clientNonce: request.clientNonce,
        serverNonce,
        claimToken,
        expiresAt: iso(expiresAtMs),
      },
    };
  }

  approvePairing(scopes: readonly AgentScope[]): PairingResult<JsonObject> {
    this.sweep();
    const pending = this.pending;
    if (!pending || this.phase !== 'pending') {
      return pairingFailure(bridgeError(
        'PAIRING_EXPIRED',
        'There is no live pairing request to approve.',
      ));
    }
    const requested = new Set(pending.requestedScopes);
    const available = new Set<AgentScope>(AGENT_V1_AVAILABLE_SCOPES);
    const unique = [...new Set(scopes)];
    const invalid = unique.find(
      (scope) => !requested.has(scope) || !available.has(scope),
    );
    if (invalid || unique.length === 0) {
      return pairingFailure(bridgeError(
        'INVALID_ARGUMENT',
        'Granted scopes must be a non-empty available subset of the requested scopes.',
        {
          path: '/scopes',
          details: invalid ? { invalidScope: invalid } : undefined,
        },
      ));
    }
    pending.approvedScopes = unique;
    this.phase = 'approved';
    this.lastError = null;
    this.publish();
    return {
      ok: true,
      value: {
        phase: 'approved',
        grantedScopes: [...unique],
        expiresAt: iso(pending.expiresAtMs),
      },
    };
  }

  rejectPairing(): void {
    if (!this.pending) {
      this.cancelPairing();
      return;
    }
    this.rememberConsumed(this.pending.pairingId);
    this.pending = null;
    this.phase = 'revoked';
    this.lastError = bridgeError(
      'SESSION_REVOKED',
      'The human rejected the Agent pairing request.',
    );
    this.reschedule(null);
    this.publish();
  }

  completePairing(
    raw: CompletePairingRequest,
  ): { ok: false; error: AgentBridgeError } | { ok: true; value: CompletedPairing } {
    const gate = this.gate();
    if (!gate.ok) return pairingFailure(gate.error);
    this.sweep();

    let request: CompletePairingRequest;
    try {
      const value = captureJsonObject(raw, {
        allowedKeys: [
          'pairingId',
          'clientNonce',
          'serverNonce',
          'claimToken',
        ],
        revision: 0,
        label: 'Pairing completion',
        maxBytes: 8 * 1024,
      });
      request = {
        pairingId: requireString(value, 'pairingId', 0, {
          minLength: 22,
          maxLength: 22,
          pattern: ID_PATTERN,
        }),
        clientNonce: requireString(value, 'clientNonce', 0, {
          minLength: 43,
          maxLength: 43,
          pattern: NONCE_PATTERN,
        }),
        serverNonce: requireString(value, 'serverNonce', 0, {
          minLength: 43,
          maxLength: 43,
          pattern: NONCE_PATTERN,
        }),
        claimToken: requireString(value, 'claimToken', 0, {
          minLength: 43,
          maxLength: 43,
          pattern: NONCE_PATTERN,
        }),
      };
    } catch (error) {
      return resultFromThrown(error);
    }

    if (this.consumedPairings.has(request.pairingId)) {
      return pairingFailure(bridgeError(
        'PAIRING_REPLAYED',
        'This pairing challenge has already been consumed.',
        { recoverable: false },
      ));
    }
    const pending = this.pending;
    if (!pending) {
      return pairingFailure(bridgeError(
        'PAIRING_EXPIRED',
        'The pairing challenge is absent or expired.',
      ));
    }
    if (!pending.approvedScopes || this.phase !== 'approved') {
      return pairingFailure(bridgeError(
        'PAIRING_NOT_APPROVED',
        'The human has not approved this pairing request.',
      ));
    }

    const tokenDigest = sha256Hex(
      `gfx.agent.claim.v1\u0000${request.claimToken}`,
    );
    const matches =
      sameSecret(request.pairingId, pending.pairingId)
      && sameSecret(request.clientNonce, pending.clientNonce)
      && sameSecret(request.serverNonce, pending.serverNonce)
      && sameSecret(tokenDigest, pending.claimTokenDigest);
    if (!matches) {
      pending.claimFailures++;
      if (pending.claimFailures >= MAX_CLAIM_FAILURES) {
        this.rememberConsumed(pending.pairingId);
        this.pending = null;
        this.phase = 'revoked';
        this.lastError = bridgeError(
          'SESSION_REVOKED',
          'The pairing challenge was revoked after repeated invalid claims.',
          { recoverable: false },
        );
        this.reschedule(null);
        this.publish();
      }
      return pairingFailure(bridgeError(
        'UNAUTHENTICATED',
        'The pairing proof is invalid.',
        { recoverable: false },
      ));
    }

    this.rememberConsumed(pending.pairingId);
    const connectedAtMs = this.now();
    const expiresAtMs = connectedAtMs + this.sessionTtlMs;
    const rawSessionId = base64Url(this.randomBytes(32));
    const controller = new AbortController();
    const sessionFingerprint = sha256Hex(
      `gfx.agent.session.v1\u0000${rawSessionId}`,
    ).slice(0, 12);
    const lease: InternalLease = Object.freeze({
      identity: Object.freeze(Object.create(null) as object),
      sessionFingerprint,
      clientLabel: pending.clientLabel,
      clientFingerprint: pending.clientFingerprint,
      origin: gate.allowedOrigin,
      scopes: immutableScopeSet(pending.approvedScopes),
      connectedAtMs,
      expiresAtMs,
      signal: controller.signal,
      controller,
      transactions: new TransactionSession(),
    });
    this.active = lease;
    this.pending = null;
    this.phase = 'connected';
    this.lastError = null;
    this.reschedule(expiresAtMs);
    this.publish();

    const summary: AgentSessionSummary = {
      protocolVersion: AGENT_PROTOCOL_VERSION,
      clientLabel: lease.clientLabel,
      clientFingerprint: lease.clientFingerprint,
      sessionFingerprint,
      origin: gate.allowedOrigin,
      scopes: [...lease.scopes],
      connectedAt: iso(connectedAtMs),
      expiresAt: iso(expiresAtMs),
    };
    return { ok: true, value: { lease, summary } };
  }

  assertActive(
    lease: AgentSessionLease,
    revision: number,
    requiredScope?: AgentScope,
  ): void {
    const internal = lease as InternalLease;
    if (!this.active || this.active.identity !== internal.identity) {
      const code = this.phase === 'expired'
        ? 'SESSION_EXPIRED'
        : 'SESSION_REVOKED';
      throw controllerFault(
        revision,
        code,
        code === 'SESSION_EXPIRED'
          ? 'The Agent session has expired.'
          : 'The Agent session has been revoked.',
      );
    }
    const gate = this.gate();
    if (!gate.ok) {
      this.revoke('origin');
      throw controllerFault(
        revision,
        'ORIGIN_NOT_ALLOWED',
        gate.error.message,
        { recoverable: false, details: gate.error.details },
      );
    }
    if (this.now() >= internal.expiresAtMs) {
      this.expireActive();
      throw controllerFault(
        revision,
        'SESSION_EXPIRED',
        'The Agent session has expired.',
      );
    }
    if (requiredScope && !internal.scopes.has(requiredScope)) {
      throw controllerFault(
        revision,
        'PERMISSION_REQUIRED',
        `The "${requiredScope}" scope was not granted by the human.`,
        {
          details: { requiredScope },
          suggestedFix: 'Ask the human to revoke and approve a new pairing with this scope.',
        },
      );
    }
  }

  revoke(
    reason:
      | 'human'
      | 'pagehide'
      | 'origin'
      | 'transport'
      | 'dispose' = 'human',
  ): void {
    const active = this.active;
    if (active && !active.controller.signal.aborted) {
      active.controller.abort(
        controllerFault(
          0,
          'SESSION_REVOKED',
          `The Agent session was revoked (${reason}).`,
        ),
      );
    }
    active?.transactions.destroy();
    this.active = null;
    this.pending = null;
    this.armedUntilMs = 0;
    this.phase = 'revoked';
    this.lastError = bridgeError(
      'SESSION_REVOKED',
      `The Agent session was revoked (${reason}).`,
    );
    this.reschedule(null);
    this.publish();
  }

  resetToIdle(): void {
    if (this.active) return;
    this.pending = null;
    this.armedUntilMs = 0;
    this.phase = 'idle';
    this.lastError = null;
    this.reschedule(null);
    this.publish();
  }

  dispose(): void {
    this.revoke('dispose');
    this.listeners.clear();
  }

  sweep(): void {
    const now = this.now();
    if (
      this.pending
      && now >= this.pending.expiresAtMs
    ) {
      this.rememberConsumed(this.pending.pairingId);
      this.pending = null;
      this.phase = 'expired';
      this.lastError = bridgeError(
        'PAIRING_EXPIRED',
        'The Agent pairing challenge expired.',
      );
      this.reschedule(null);
      this.publish();
      return;
    }
    if (this.phase === 'armed' && now >= this.armedUntilMs) {
      this.armedUntilMs = 0;
      this.phase = 'expired';
      this.lastError = bridgeError(
        'PAIRING_EXPIRED',
        'The Agent pairing window expired.',
      );
      this.reschedule(null);
      this.publish();
      return;
    }
    if (this.active && now >= this.active.expiresAtMs) {
      this.expireActive();
    }
  }

  private gate() {
    return evaluateAgentRuntimeGate(
      this.contextProvider(),
      this.allowedOrigin,
    );
  }

  private expireActive(): void {
    const active = this.active;
    if (active && !active.controller.signal.aborted) {
      active.controller.abort(
        controllerFault(
          0,
          'SESSION_EXPIRED',
          'The Agent session expired.',
        ),
      );
    }
    active?.transactions.destroy();
    this.active = null;
    this.phase = 'expired';
    this.lastError = bridgeError(
      'SESSION_EXPIRED',
      'The Agent session expired.',
    );
    this.reschedule(null);
    this.publish();
  }

  private rememberConsumed(pairingId: string): void {
    this.consumedPairings.add(pairingId);
    if (this.consumedPairings.size <= MAX_CONSUMED_PAIRINGS) return;
    const oldest = this.consumedPairings.values().next().value;
    if (typeof oldest === 'string') this.consumedPairings.delete(oldest);
  }

  private reschedule(deadlineMs: number | null): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (deadlineMs === null) return;
    this.timer = this.setTimer(
      () => {
        this.timer = null;
        this.sweep();
      },
      Math.max(0, deadlineMs - this.now()),
    );
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private buildSnapshot(): AgentConnectionSnapshot {
    const pending = this.pending;
    const active = this.active;
    return Object.freeze({
      phase: this.phase,
      origin: this.allowedOrigin,
      clientLabel: active?.clientLabel ?? pending?.clientLabel ?? null,
      clientFingerprint:
        active?.clientFingerprint
        ?? pending?.clientFingerprint
        ?? null,
      sessionFingerprint: active?.sessionFingerprint ?? null,
      requestedScopes: Object.freeze(
        [...(pending?.requestedScopes ?? [])],
      ) as AgentScope[],
      grantedScopes: Object.freeze(
        [...(active?.scopes ?? pending?.approvedScopes ?? [])],
      ) as AgentScope[],
      availableScopes: Object.freeze(
        [...AGENT_V1_AVAILABLE_SCOPES],
      ) as AgentScope[],
      expiresAt:
        active
          ? iso(active.expiresAtMs)
          : pending
            ? iso(pending.expiresAtMs)
            : this.phase === 'armed'
              ? iso(this.armedUntilMs)
              : null,
      error: this.lastError ? { ...this.lastError } : null,
    });
  }
}

export function requestedScopesFromSnapshot(
  snapshot: AgentConnectionSnapshot,
): ReadonlySet<AgentScope> {
  return new Set(snapshot.requestedScopes);
}

export function parseScopeValue(value: string): AgentScope | null {
  return (AGENT_SCOPES as readonly string[]).includes(value)
    ? value as AgentScope
    : null;
}

export function pairingRequestFromJson(value: JsonObject): PairingRequest {
  return value as unknown as PairingRequest;
}

export function completePairingRequestFromJson(
  value: JsonObject,
): CompletePairingRequest {
  // Kept as a named conversion for transport adapters; it performs no grant.
  return value as unknown as CompletePairingRequest;
}

export function pairingValue(object: JsonObject, key: string): JsonValue | undefined {
  return own(object, key);
}
