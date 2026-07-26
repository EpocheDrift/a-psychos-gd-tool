import {
  AGENT_ERROR_CODES,
  type AgentErrorCode,
} from './agentErrors';
import {
  CookCancelledError,
  CookDeadlineExceededError,
} from '../engine/cookControl';

export type RenderState =
  | 'idle'
  | 'queued'
  | 'cooking'
  | 'complete'
  | 'failed'
  | 'superseded';

export interface RenderTicket {
  revision: number;
  attempt: number;
}

export interface CookEventSummary {
  revision: number;
  attempt: number;
  layerId: string;
  nodeId: string;
  type: string;
  status: 'hit' | 'miss';
  ms: number;
}

export interface RenderError {
  code: AgentErrorCode;
  message: string;
  revision: number;
  attempt: number;
  recoverable: boolean;
  layerId?: string;
  nodeId?: string;
  nodeType?: string;
  phase?: string;
  details?: Record<string, unknown>;
}

export interface RenderExecutionResult {
  width?: number;
  height?: number;
  events?: CookEventSummary[];
  /**
   * Internal two-phase publication. The coordinator invokes this only after
   * the exact ticket passes its final synchronous abort/deadline check.
   */
  publish?: () => void;
  /** Reclaim a prepared successful result that lost the final ticket check. */
  rollback?: () => void;
}

export interface RenderJob<TInput> {
  ticket: RenderTicket;
  revision: number;
  attempt: number;
  input: TInput;
  signal: AbortSignal;
  /** Absolute `performance.now()` deadline. */
  deadline: number;
}

export type RenderExecutor<TInput> = (
  job: RenderJob<TInput>,
) => Promise<RenderExecutionResult>;

export interface RenderStatus {
  /** Latest document revision observed by the coordinator. */
  documentRevision: number;
  /** Exact immutable attempt described by this status. */
  ticket: RenderTicket | null;
  /** Last attempt whose GPU work completed successfully. */
  displayedTicket: RenderTicket | null;
  displayedRevision: number | null;
  /** Compatibility aliases used by the public Agent contract. */
  requestedRevision: number | null;
  renderRevision: number | null;
  state: RenderState;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  width?: number;
  height?: number;
  error?: RenderError;
  events?: CookEventSummary[];
}

export interface ScheduleRenderOptions {
  deadlineMs?: number;
  /**
   * Repeated scheduling with the same revision and key returns the existing
   * ticket. Store bindings use this to make React StrictMode harmless.
   */
  dedupeKey?: string | number;
}

export interface AwaitRenderRequest {
  revision: number;
  /**
   * When omitted, the latest attempt is captured at call time. If the revision
   * has not been scheduled yet, the waiter binds to its first future attempt.
   */
  attempt?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RenderStatusRequest {
  revision?: number;
  attempt?: number;
}

export interface RenderCoordinatorOptions {
  defaultDeadlineMs?: number;
  historyLimit?: number;
  maxWaiters?: number;
}

interface RenderRecord<TInput> {
  ticket: RenderTicket;
  /** Cleared at terminal state so history never retains full documents. */
  input?: TInput;
  state: Exclude<RenderState, 'idle'>;
  /** Absolute `performance.now()` deadline, including queue time. */
  deadline: number;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
  dedupeKey?: string | number;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: RenderExecutionResult;
  error?: RenderError;
}

interface Waiter {
  resolve: (status: RenderStatus) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  signal?: AbortSignal;
  onAbort?: () => void;
  /** Null only while waiting for a revision's first schedule. */
  key: string | null;
  revision: number;
  registered: boolean;
}

interface ActiveRun<TInput> {
  record: RenderRecord<TInput>;
  controller: AbortController;
}

const TERMINAL_STATES = new Set<RenderState>([
  'complete',
  'failed',
  'superseded',
]);
const ERROR_CODES = new Set<string>(AGENT_ERROR_CODES);
const DEFAULT_DEADLINE_MS = 30_000;
const DEFAULT_HISTORY_LIMIT = 256;
const DEFAULT_MAX_WAITERS = 1024;

function ticketKey(ticket: RenderTicket): string {
  return `${ticket.revision}:${ticket.attempt}`;
}

function cloneTicket(ticket: RenderTicket | null): RenderTicket | null {
  return ticket ? { ...ticket } : null;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function cloneDetails(
  value: unknown,
  depth = 0,
): unknown {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (depth >= 6) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 128).map((item) => cloneDetails(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).slice(0, 128)) {
      const item = (value as Record<string, unknown>)[key];
      if (
        typeof item === 'undefined'
        || typeof item === 'function'
        || typeof item === 'symbol'
        || typeof item === 'bigint'
      ) continue;
      result[key] = cloneDetails(item, depth + 1);
    }
    return result;
  }
  return String(value);
}

export class AwaitRenderTimeoutError extends Error {
  readonly code = 'TIMEOUT' as const;

  constructor(readonly revision: number, readonly attempt?: number) {
    super(
      attempt === undefined
        ? `Timed out waiting for render revision ${revision}.`
        : `Timed out waiting for render revision ${revision}, attempt ${attempt}.`,
    );
    this.name = 'AwaitRenderTimeoutError';
  }
}

export class AwaitRenderCapacityError extends Error {
  readonly code = 'RESOURCE_LIMIT' as const;

  constructor(readonly maximum: number) {
    super(`Render waiter limit of ${maximum} has been reached.`);
    this.name = 'AwaitRenderCapacityError';
  }
}

export class RenderCoordinator<TInput> {
  private readonly defaultDeadlineMs: number;
  private readonly historyLimit: number;
  private readonly maxWaiters: number;
  private readonly records = new Map<string, RenderRecord<TInput>>();
  private readonly latestByRevision = new Map<number, RenderTicket>();
  private readonly nextAttemptByRevision = new Map<number, number>();
  private readonly waitersByKey = new Map<string, Set<Waiter>>();
  private readonly unscheduledWaiters = new Map<number, Set<Waiter>>();
  private readonly listeners = new Set<(status: RenderStatus) => void>();
  private readonly idleWaiters = new Set<() => void>();
  private readonly terminalOrder: string[] = [];
  private readonly evictedThroughAttempt = new Map<number, number>();
  private executor: RenderExecutor<TInput> | null = null;
  private queued: RenderRecord<TInput> | null = null;
  private active: ActiveRun<TInput> | null = null;
  private latestTicket: RenderTicket | null = null;
  private displayedTicket: RenderTicket | null = null;
  private documentRevision = 0;
  private expiredThroughRevision = -1;
  private waiterCount = 0;
  private disposed = false;

  constructor(options: RenderCoordinatorOptions = {}) {
    this.defaultDeadlineMs = options.defaultDeadlineMs ?? DEFAULT_DEADLINE_MS;
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.maxWaiters = options.maxWaiters ?? DEFAULT_MAX_WAITERS;
    assertPositiveSafeInteger(this.defaultDeadlineMs, 'defaultDeadlineMs');
    assertPositiveSafeInteger(this.historyLimit, 'historyLimit');
    assertPositiveSafeInteger(this.maxWaiters, 'maxWaiters');
  }

  setExecutor(executor: RenderExecutor<TInput>): void {
    if (this.disposed) throw new Error('RenderCoordinator is disposed.');
    this.executor = executor;
    this.pump();
  }

  clearExecutor(executor?: RenderExecutor<TInput>): void {
    if (executor && this.executor !== executor) return;
    this.executor = null;
  }

  schedule(
    revision: number,
    input: TInput,
    options: ScheduleRenderOptions = {},
  ): RenderTicket {
    if (this.disposed) throw new Error('RenderCoordinator is disposed.');
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new RangeError('revision must be a non-negative safe integer');
    }
    const deadlineMs = options.deadlineMs ?? this.defaultDeadlineMs;
    assertPositiveSafeInteger(deadlineMs, 'deadlineMs');

    const latestForRevision = this.latestByRevision.get(revision);
    if (latestForRevision && options.dedupeKey !== undefined) {
      const existing = this.records.get(ticketKey(latestForRevision));
      if (existing?.dedupeKey === options.dedupeKey) {
        return cloneTicket(existing.ticket)!;
      }
    }
    if (this.latestTicket && revision < this.documentRevision) {
      throw new RangeError(
        `stale render revision ${revision}; current revision is ${this.documentRevision}`,
      );
    }

    const nextAttempt = (this.nextAttemptByRevision.get(revision) ?? 0) + 1;
    this.nextAttemptByRevision.set(revision, nextAttempt);
    const ticket: RenderTicket = { revision, attempt: nextAttempt };
    const deadline = performance.now() + deadlineMs;
    const record: RenderRecord<TInput> = {
      ticket,
      input,
      state: 'queued',
      deadline,
      deadlineTimer: null,
      ...(options.dedupeKey !== undefined
        ? { dedupeKey: options.dedupeKey }
        : {}),
      queuedAt: new Date().toISOString(),
    };

    this.documentRevision = Math.max(this.documentRevision, revision);
    this.latestTicket = ticket;
    this.latestByRevision.set(revision, ticket);
    this.records.set(ticketKey(ticket), record);
    record.deadlineTimer = setTimeout(
      () => this.expire(record),
      deadlineMs,
    );

    // Only one latest-wins queued attempt is retained. An active attempt is
    // immediately terminal for callers, but its executor is allowed to drain
    // before the next attempt starts and reuses evaluator state.
    if (this.queued) {
      this.supersede(this.queued);
      this.queued = null;
    }
    if (this.active && !TERMINAL_STATES.has(this.active.record.state)) {
      const reason = this.supersede(this.active.record);
      this.active.controller.abort(reason);
    }
    this.queued = record;
    this.bindUnscheduledWaiters(ticket);
    this.notify(record);
    this.pump();
    return cloneTicket(ticket)!;
  }

  getRenderStatus(request: number | RenderStatusRequest = {}): RenderStatus {
    const normalized: RenderStatusRequest = typeof request === 'number'
      ? { revision: request }
      : request;
    let ticket: RenderTicket | null = null;
    if (normalized.revision !== undefined) {
      ticket = normalized.attempt === undefined
        ? this.latestByRevision.get(normalized.revision)
          ?? (
            normalized.revision <= this.expiredThroughRevision
              ? { revision: normalized.revision, attempt: 1 }
              : null
          )
        : { revision: normalized.revision, attempt: normalized.attempt };
    } else {
      ticket = this.latestTicket;
    }

    if (!ticket) {
      return {
        documentRevision: this.documentRevision,
        ticket: null,
        displayedTicket: cloneTicket(this.displayedTicket),
        displayedRevision: this.displayedTicket?.revision ?? null,
        requestedRevision: normalized.revision ?? null,
        renderRevision: null,
        state: 'idle',
      };
    }

    const key = ticketKey(ticket);
    const record = this.records.get(key);
    if (!record && this.isExpiredTicket(ticket)) {
      const error = this.makeError(
        new CookCancelledError(ticket.revision),
        ticket,
        'RENDER_SUPERSEDED',
      );
      return {
        documentRevision: this.documentRevision,
        ticket: cloneTicket(ticket),
        displayedTicket: cloneTicket(this.displayedTicket),
        displayedRevision: this.displayedTicket?.revision ?? null,
        requestedRevision: ticket.revision,
        renderRevision: null,
        state: 'superseded',
        completedAt: new Date().toISOString(),
        error,
      };
    }
    if (!record) {
      return {
        documentRevision: this.documentRevision,
        ticket: cloneTicket(ticket),
        displayedTicket: cloneTicket(this.displayedTicket),
        displayedRevision: this.displayedTicket?.revision ?? null,
        requestedRevision: ticket.revision,
        renderRevision: null,
        state: 'idle',
      };
    }
    return this.statusFor(record);
  }

  awaitRender(
    requestOrRevision: AwaitRenderRequest | number,
    legacyOptions: Omit<AwaitRenderRequest, 'revision'> = {},
  ): Promise<RenderStatus> {
    if (this.disposed) {
      return Promise.reject(new CookCancelledError());
    }
    const request: AwaitRenderRequest = typeof requestOrRevision === 'number'
      ? { revision: requestOrRevision, ...legacyOptions }
      : requestOrRevision;
    if (!Number.isSafeInteger(request.revision) || request.revision < 0) {
      return Promise.reject(
        new RangeError('revision must be a non-negative safe integer'),
      );
    }
    if (
      request.attempt !== undefined
      && (!Number.isSafeInteger(request.attempt) || request.attempt <= 0)
    ) {
      return Promise.reject(
        new RangeError('attempt must be a positive safe integer'),
      );
    }
    if (
      request.timeoutMs !== undefined
      && (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0)
    ) {
      return Promise.reject(
        new RangeError('timeoutMs must be a positive safe integer'),
      );
    }
    if (request.signal?.aborted) {
      return Promise.reject(this.waiterAbortReason(request.signal));
    }
    if (request.attempt === undefined) {
      const revisionStatus = this.getRenderStatus({ revision: request.revision });
      if (TERMINAL_STATES.has(revisionStatus.state)) {
        return Promise.resolve(revisionStatus);
      }
    }

    const captured = request.attempt === undefined
      ? this.latestByRevision.get(request.revision) ?? null
      : { revision: request.revision, attempt: request.attempt };
    if (captured) {
      const status = this.getRenderStatus(captured);
      if (TERMINAL_STATES.has(status.state)) return Promise.resolve(status);
    }
    if (this.waiterCount >= this.maxWaiters) {
      return Promise.reject(new AwaitRenderCapacityError(this.maxWaiters));
    }
    const knownRecord = captured
      ? this.records.has(ticketKey(captured))
      : false;
    const timeoutMs = request.timeoutMs
      ?? (knownRecord ? undefined : this.defaultDeadlineMs);

    return new Promise<RenderStatus>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: null,
        ...(request.signal ? { signal: request.signal } : {}),
        key: captured ? ticketKey(captured) : null,
        revision: request.revision,
        registered: true,
      };
      this.waiterCount++;
      if (timeoutMs !== undefined) {
        waiter.timer = setTimeout(() => {
          this.removeWaiter(waiter);
          reject(new AwaitRenderTimeoutError(
            request.revision,
            captured?.attempt ?? request.attempt,
          ));
        }, timeoutMs);
      }
      if (request.signal) {
        waiter.onAbort = () => {
          this.removeWaiter(waiter);
          reject(this.waiterAbortReason(request.signal!));
        };
        request.signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      if (waiter.key) {
        this.addKeyedWaiter(waiter.key, waiter);
      } else {
        const revisionWaiters = this.unscheduledWaiters.get(request.revision)
          ?? new Set<Waiter>();
        revisionWaiters.add(waiter);
        this.unscheduledWaiters.set(request.revision, revisionWaiters);
      }
    });
  }

  subscribe(listener: (status: RenderStatus) => void): () => void {
    if (this.disposed) {
      throw new Error('RenderCoordinator is disposed.');
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Fail and abort the active attempt, for example after device loss. Queued
   * work remains queued so a replacement executor can recover it explicitly.
   */
  failCurrent(error: unknown): void {
    if (!this.active || TERMINAL_STATES.has(this.active.record.state)) return;
    const normalized = this.makeError(error, this.active.record.ticket);
    this.finish(this.active.record, 'failed', normalized);
    this.active.controller.abort(normalized);
  }

  /**
   * Stop all work owned by the installed executor without disposing historical
   * status. Teardown uses this before waiting for the active promise to drain.
   */
  cancelPending(error?: unknown): void {
    if (this.queued && !TERMINAL_STATES.has(this.queued.state)) {
      const queued = this.queued;
      this.queued = null;
      if (error === undefined) this.supersede(queued);
      else this.finish(queued, 'failed', this.makeError(error, queued.ticket));
    }
    if (this.active && !TERMINAL_STATES.has(this.active.record.state)) {
      const { record, controller } = this.active;
      const reason = error === undefined
        ? this.supersede(record)
        : this.makeError(error, record.ticket);
      if (error !== undefined) this.finish(record, 'failed', reason);
      controller.abort(
        error instanceof Error
          ? error
          : Object.assign(new Error(reason.message), reason),
      );
    }
  }

  /** Resolve after the currently executing promise has run its finally block. */
  whenIdle(): Promise<void> {
    if (!this.active) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleWaiters.add(resolve);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.executor = null;
    if (this.queued && !TERMINAL_STATES.has(this.queued.state)) {
      this.supersede(this.queued);
    }
    this.queued = null;
    if (this.active && !TERMINAL_STATES.has(this.active.record.state)) {
      const reason = this.supersede(this.active.record);
      this.active.controller.abort(reason);
    }
    for (const waiters of [
      ...this.unscheduledWaiters.values(),
      ...this.waitersByKey.values(),
    ]) {
      for (const waiter of waiters) {
        this.clearWaiter(waiter);
        waiter.reject(new CookCancelledError(waiter.revision));
      }
    }
    this.unscheduledWaiters.clear();
    this.waitersByKey.clear();
    for (const record of this.records.values()) {
      if (record.deadlineTimer !== null) clearTimeout(record.deadlineTimer);
      record.input = undefined;
    }
    this.records.clear();
    this.latestByRevision.clear();
    this.nextAttemptByRevision.clear();
    this.evictedThroughAttempt.clear();
    this.terminalOrder.length = 0;
    this.latestTicket = null;
    this.displayedTicket = null;
    this.listeners.clear();
    if (!this.active) this.resolveIdleWaiters();
  }

  private pump(): void {
    if (
      this.disposed
      || this.active
      || !this.executor
      || !this.queued
    ) return;

    const record = this.queued;
    this.queued = null;
    if (record.state !== 'queued') {
      this.pump();
      return;
    }
    if (performance.now() >= record.deadline) {
      this.expire(record);
      this.pump();
      return;
    }
    const controller = new AbortController();
    record.state = 'cooking';
    record.startedAt = new Date().toISOString();
    const run: ActiveRun<TInput> = { record, controller };
    this.active = run;
    this.notify(record);

    const executor = this.executor;
    let execution: Promise<RenderExecutionResult>;
    try {
      execution = executor({
        ticket: cloneTicket(record.ticket)!,
        revision: record.ticket.revision,
        attempt: record.ticket.attempt,
        input: record.input as TInput,
        signal: controller.signal,
        deadline: record.deadline,
      });
    } catch (error) {
      execution = Promise.reject(error);
    }
    void execution.then(
      (result) => {
        if (record.state !== 'cooking') {
          result.rollback?.();
          return;
        }
        if (controller.signal.aborted || performance.now() >= record.deadline) {
          result.rollback?.();
          this.expire(record);
          return;
        }
        try {
          // No task/event can interleave this synchronous publish with the
          // exact-ticket check above or the terminal status write below.
          result.publish?.();
          record.result = this.sanitizeResult(result, record.ticket);
          this.displayedTicket = record.ticket;
          this.finish(record, 'complete');
        } catch (error) {
          result.rollback?.();
          this.finish(record, 'failed', this.makeError(error, record.ticket));
        }
      },
      (error) => {
        if (record.state !== 'cooking') return;
        this.finish(record, 'failed', this.makeError(error, record.ticket));
      },
    ).finally(() => {
      if (this.active === run) this.active = null;
      this.resolveIdleWaiters();
      this.pump();
    });
  }

  private resolveIdleWaiters(): void {
    if (this.active) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  private expire(record: RenderRecord<TInput>): void {
    if (TERMINAL_STATES.has(record.state)) return;
    const error = this.makeError(
      new CookDeadlineExceededError(record.ticket.revision),
      record.ticket,
      'TIMEOUT',
    );
    if (this.queued === record) this.queued = null;
    this.finish(record, 'failed', error);
    if (this.active?.record === record) {
      this.active.controller.abort(error);
    }
  }

  private supersede(record: RenderRecord<TInput>): RenderError {
    const error = this.makeError(
      new CookCancelledError(record.ticket.revision),
      record.ticket,
      'RENDER_SUPERSEDED',
    );
    this.finish(record, 'superseded', error);
    return error;
  }

  private finish(
    record: RenderRecord<TInput>,
    state: 'complete' | 'failed' | 'superseded',
    error?: RenderError,
  ): void {
    if (TERMINAL_STATES.has(record.state)) return;
    record.state = state;
    record.completedAt = new Date().toISOString();
    if (record.deadlineTimer !== null) {
      clearTimeout(record.deadlineTimer);
      record.deadlineTimer = null;
    }
    record.input = undefined;
    if (error) record.error = error;
    this.terminalOrder.push(ticketKey(record.ticket));
    this.resolveWaiters(record);
    this.notify(record);
    this.trimHistory();
  }

  private statusFor(record: RenderRecord<TInput>): RenderStatus {
    return {
      documentRevision: this.documentRevision,
      ticket: cloneTicket(record.ticket),
      displayedTicket: cloneTicket(this.displayedTicket),
      displayedRevision: this.displayedTicket?.revision ?? null,
      requestedRevision: record.ticket.revision,
      renderRevision: record.state === 'complete'
        ? record.ticket.revision
        : null,
      state: record.state,
      queuedAt: record.queuedAt,
      ...(record.startedAt ? { startedAt: record.startedAt } : {}),
      ...(record.completedAt ? { completedAt: record.completedAt } : {}),
      ...(record.result?.width !== undefined
        ? { width: record.result.width }
        : {}),
      ...(record.result?.height !== undefined
        ? { height: record.result.height }
        : {}),
      ...(record.error ? {
        error: {
          ...record.error,
          ...(record.error.details
            ? {
                details: cloneDetails(record.error.details) as Record<
                  string,
                  unknown
                >,
              }
            : {}),
        },
      } : {}),
      ...(record.result?.events
        ? { events: record.result.events.map((event) => ({ ...event })) }
        : {}),
    };
  }

  private makeError(
    error: unknown,
    ticket: RenderTicket,
    fallbackCode: AgentErrorCode = 'RENDER_FAILED',
  ): RenderError {
    const candidate = error !== null && typeof error === 'object'
      ? error as {
          code?: unknown;
          message?: unknown;
          recoverable?: unknown;
          layerId?: unknown;
          nodeId?: unknown;
          nodeType?: unknown;
          phase?: unknown;
          details?: unknown;
        }
      : {};
    const code = typeof candidate.code === 'string'
      && ERROR_CODES.has(candidate.code)
      ? candidate.code as AgentErrorCode
      : fallbackCode;
    const message = typeof candidate.message === 'string'
      ? candidate.message
      : error instanceof Error
        ? error.message
        : `Render revision ${ticket.revision} failed.`;
    return {
      code,
      message,
      revision: ticket.revision,
      attempt: ticket.attempt,
      recoverable: typeof candidate.recoverable === 'boolean'
        ? candidate.recoverable
        : true,
      ...(typeof candidate.layerId === 'string'
        ? { layerId: candidate.layerId }
        : {}),
      ...(typeof candidate.nodeId === 'string'
        ? { nodeId: candidate.nodeId }
        : {}),
      ...(typeof candidate.nodeType === 'string'
        ? { nodeType: candidate.nodeType }
        : {}),
      ...(typeof candidate.phase === 'string'
        ? { phase: candidate.phase }
        : {}),
      ...(candidate.details !== null
        && typeof candidate.details === 'object'
        && !Array.isArray(candidate.details)
        ? {
            details: cloneDetails(candidate.details) as Record<
              string,
              unknown
            >,
          }
        : {}),
    };
  }

  private sanitizeResult(
    result: RenderExecutionResult,
    ticket: RenderTicket,
  ): RenderExecutionResult {
    return {
      ...(Number.isSafeInteger(result.width) && (result.width ?? 0) > 0
        ? { width: result.width }
        : {}),
      ...(Number.isSafeInteger(result.height) && (result.height ?? 0) > 0
        ? { height: result.height }
        : {}),
      ...(Array.isArray(result.events)
        ? {
            events: result.events.slice(0, 10_000).map((event) => ({
              revision: ticket.revision,
              attempt: ticket.attempt,
              layerId: String(event.layerId),
              nodeId: String(event.nodeId),
              type: String(event.type),
              status: event.status === 'hit' ? 'hit' as const : 'miss' as const,
              ms: Number.isFinite(event.ms) && event.ms >= 0 ? event.ms : 0,
            })),
          }
        : {}),
    };
  }

  private bindUnscheduledWaiters(ticket: RenderTicket): void {
    const waiters = this.unscheduledWaiters.get(ticket.revision);
    if (!waiters) return;
    this.unscheduledWaiters.delete(ticket.revision);
    const key = ticketKey(ticket);
    for (const waiter of waiters) {
      waiter.key = key;
      this.addKeyedWaiter(key, waiter);
    }
  }

  private addKeyedWaiter(key: string, waiter: Waiter): void {
    const waiters = this.waitersByKey.get(key) ?? new Set<Waiter>();
    waiters.add(waiter);
    this.waitersByKey.set(key, waiters);
  }

  private resolveWaiters(record: RenderRecord<TInput>): void {
    const key = ticketKey(record.ticket);
    const waiters = this.waitersByKey.get(key);
    if (!waiters) return;
    this.waitersByKey.delete(key);
    for (const waiter of waiters) {
      this.clearWaiter(waiter);
      waiter.resolve(this.statusFor(record));
    }
  }

  private removeWaiter(waiter: Waiter): void {
    if (waiter.key) {
      const waiters = this.waitersByKey.get(waiter.key);
      waiters?.delete(waiter);
      if (waiters?.size === 0) this.waitersByKey.delete(waiter.key);
    } else {
      const waiters = this.unscheduledWaiters.get(waiter.revision);
      waiters?.delete(waiter);
      if (waiters?.size === 0) this.unscheduledWaiters.delete(waiter.revision);
    }
    this.clearWaiter(waiter);
  }

  private clearWaiter(waiter: Waiter): void {
    if (waiter.registered) {
      waiter.registered = false;
      this.waiterCount = Math.max(0, this.waiterCount - 1);
    }
    if (waiter.timer !== null) clearTimeout(waiter.timer);
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
    }
  }

  private waiterAbortReason(signal: AbortSignal): Error {
    return signal.reason instanceof Error
      ? signal.reason
      : new CookCancelledError();
  }

  private notify(record: RenderRecord<TInput>): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this.statusFor(record));
      } catch {
        // A UI listener cannot corrupt render state or strand a waiter.
      }
    }
  }

  private trimHistory(): void {
    let scansRemaining = this.terminalOrder.length;
    while (
      this.records.size > this.historyLimit
      && this.terminalOrder.length > 0
      && scansRemaining-- > 0
    ) {
      const key = this.terminalOrder.shift()!;
      const record = this.records.get(key);
      if (!record || !TERMINAL_STATES.has(record.state)) continue;
      if (
        (this.displayedTicket && key === ticketKey(this.displayedTicket))
        || (this.latestTicket && key === ticketKey(this.latestTicket))
      ) {
        this.terminalOrder.push(key);
        continue;
      }
      this.records.delete(key);
      this.evictedThroughAttempt.set(
        record.ticket.revision,
        Math.max(
          this.evictedThroughAttempt.get(record.ticket.revision) ?? 0,
          record.ticket.attempt,
        ),
      );
      const latestForRevision = this.latestByRevision.get(record.ticket.revision);
      if (latestForRevision && ticketKey(latestForRevision) === key) {
        this.latestByRevision.delete(record.ticket.revision);
      }
      const revisionStillRetained = [...this.records.values()].some(
        (candidate) => candidate.ticket.revision === record.ticket.revision,
      );
      if (
        !revisionStillRetained
        && record.ticket.revision < this.documentRevision
      ) {
        this.expiredThroughRevision = Math.max(
          this.expiredThroughRevision,
          record.ticket.revision,
        );
        this.latestByRevision.delete(record.ticket.revision);
        this.nextAttemptByRevision.delete(record.ticket.revision);
        this.evictedThroughAttempt.delete(record.ticket.revision);
      }
    }
  }

  private isExpiredTicket(ticket: RenderTicket): boolean {
    if (
      ticket.revision <= this.expiredThroughRevision
      && ticket.revision < this.documentRevision
    ) return true;
    if (
      ticket.attempt
      <= (this.evictedThroughAttempt.get(ticket.revision) ?? 0)
    ) return true;
    const scheduledThrough = this.nextAttemptByRevision.get(ticket.revision);
    return scheduledThrough !== undefined && ticket.attempt <= scheduledThrough;
  }
}
