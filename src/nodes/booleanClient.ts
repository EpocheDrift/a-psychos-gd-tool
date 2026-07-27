import { DEFAULT_AGENT_LIMITS } from '../domain/limits';
import {
  CookCancelledError,
  CookDeadlineExceededError,
  CookResourceLimitError,
  remainingCookMs,
} from '../engine/cookControl';
import type { Polyline } from '../engine/path';
import type { PathCmd } from '../engine/values';

export type BooleanOperation = 'union' | 'subtract' | 'intersect';

interface WorkerReply {
  id: number;
  paths?: PathCmd[][];
  error?: string;
  code?: 'TIMEOUT' | 'RESOURCE_LIMIT';
}

interface BooleanWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

export type BooleanWorkerFactory = () => BooleanWorkerLike;

export interface BooleanDispatchOptions {
  signal?: AbortSignal;
  deadline?: number;
  revision?: number;
  maxPendingRequests?: number;
  maxBooleanPoints?: number;
  maxVectorCommands?: number;
}

interface QueuedBoolean {
  id: number;
  a: Polyline[];
  b: Polyline[];
  op: BooleanOperation;
  options: BooleanDispatchOptions;
  points: number;
  resolve: (paths: PathCmd[][]) => void;
  reject: (error: Error) => void;
  phase: 'queued' | 'active' | 'settled';
  generation?: number;
  timer: ReturnType<typeof setTimeout> | null;
  onAbort?: () => void;
}

export class BooleanWorkerError extends Error {
  readonly code = 'RENDER_FAILED' as const;
  readonly recoverable = true;
  readonly phase = 'worker' as const;

  constructor(message: string) {
    super(message);
    this.name = 'BooleanWorkerError';
  }
}

function defaultWorkerFactory(): BooleanWorkerLike {
  return new Worker(
    new URL('./booleanWorker.ts', import.meta.url),
    { type: 'module' },
  );
}

function boundedLimit(
  value: number | undefined,
  fallback: number,
  hardMaximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) return fallback;
  return Math.min(value, hardMaximum);
}

function abortReason(options: BooleanDispatchOptions): Error {
  return options.signal?.reason instanceof Error
    ? options.signal.reason
    : new CookCancelledError(options.revision);
}

function protocolError(message: string): BooleanWorkerError {
  return new BooleanWorkerError(`Boolean worker protocol error: ${message}`);
}

export class BooleanWorkerClient {
  private worker: BooleanWorkerLike | null = null;
  private generation = 0;
  private sequence = 0;
  private active: QueuedBoolean | null = null;
  private queue: QueuedBoolean[] = [];

  constructor(
    private readonly workerFactory: BooleanWorkerFactory = defaultWorkerFactory,
  ) {}

  run(
    a: Polyline[],
    b: Polyline[],
    op: BooleanOperation,
    options: BooleanDispatchOptions = {},
  ): Promise<PathCmd[][]> {
    if (options.signal?.aborted) {
      return Promise.reject(abortReason(options));
    }
    const remaining = remainingCookMs(options);
    if (remaining !== null && remaining <= 0) {
      return Promise.reject(new CookDeadlineExceededError(options.revision));
    }
    const maxPending = boundedLimit(
      options.maxPendingRequests,
      DEFAULT_AGENT_LIMITS.maxPendingWorkerRequests,
      64,
    );
    if (this.pendingCount() >= maxPending) {
      return Promise.reject(new CookResourceLimitError(
        `Boolean worker already has ${this.pendingCount()} pending requests.`,
        { actualAtLeast: this.pendingCount() + 1, maximum: maxPending },
      ));
    }
    const points = countPoints(a) + countPoints(b);
    const maxPoints = boundedLimit(
      options.maxBooleanPoints,
      DEFAULT_AGENT_LIMITS.maxBooleanPoints,
      1_000_000,
    );
    if (!Number.isSafeInteger(points) || points > maxPoints) {
      return Promise.reject(new CookResourceLimitError(
        `Boolean operands exceed ${maxPoints} flattened points.`,
        {
          actualAtLeast: Number.isSafeInteger(points)
            ? points
            : maxPoints + 1,
          maximum: maxPoints,
        },
      ));
    }

    const id = ++this.sequence;
    return new Promise<PathCmd[][]>((resolve, reject) => {
      const request: QueuedBoolean = {
        id,
        a,
        b,
        op,
        options,
        points,
        resolve,
        reject,
        phase: 'queued',
        timer: null,
      };
      this.queue.push(request);
      if (options.signal) {
        request.onAbort = () => this.interrupt(request, abortReason(options));
        options.signal.addEventListener('abort', request.onAbort, { once: true });
      }
      if (remaining !== null) {
        request.timer = setTimeout(
          () => this.interrupt(
            request,
            new CookDeadlineExceededError(options.revision),
          ),
          remaining,
        );
      }
      if (options.signal?.aborted) {
        request.onAbort?.();
        return;
      }
      this.pump();
    });
  }

  reset(reason: Error = new CookCancelledError()): void {
    const active = this.active;
    this.terminateWorker();
    if (active) this.settle(active, undefined, reason);
    for (const request of [...this.queue]) {
      this.settle(request, undefined, reason);
    }
  }

  stats(): {
    pending: number;
    active: boolean;
    queued: number;
    worker: boolean;
  } {
    return {
      pending: this.pendingCount(),
      active: this.active !== null,
      queued: this.queue.length,
      worker: this.worker !== null,
    };
  }

  private pump(): void {
    if (this.active) return;
    const request = this.queue.shift();
    if (!request) return;
    if (request.phase !== 'queued') {
      this.pump();
      return;
    }
    request.phase = 'active';
    this.active = request;

    let worker: BooleanWorkerLike;
    try {
      worker = this.getWorker();
    } catch (error) {
      this.settle(
        request,
        undefined,
        new BooleanWorkerError(
          error instanceof Error
            ? error.message
            : 'Boolean worker creation failed.',
        ),
      );
      this.pump();
      return;
    }
    request.generation = this.generation;
    try {
      const timeoutMs = remainingCookMs(request.options);
      if (timeoutMs !== null && timeoutMs <= 0) {
        this.interrupt(
          request,
          new CookDeadlineExceededError(request.options.revision),
        );
        return;
      }
      worker.postMessage({
        id: request.id,
        a: request.a,
        b: request.b,
        op: request.op,
        maxBooleanPoints: boundedLimit(
          request.options.maxBooleanPoints,
          DEFAULT_AGENT_LIMITS.maxBooleanPoints,
          1_000_000,
        ),
        maxVectorCommands: boundedLimit(
          request.options.maxVectorCommands,
          DEFAULT_AGENT_LIMITS.maxVectorCommands,
          10_000_000,
        ),
        ...(timeoutMs === null ? {} : { timeoutMs }),
      });
    } catch (error) {
      this.failActiveAndRestart(new BooleanWorkerError(
        error instanceof Error
          ? error.message
          : 'Boolean worker postMessage failed.',
      ));
    }
  }

  private getWorker(): BooleanWorkerLike {
    if (this.worker) return this.worker;
    const worker = this.workerFactory();
    const generation = ++this.generation;
    this.worker = worker;
    worker.onmessage = (event) => {
      if (this.worker !== worker || this.generation !== generation) return;
      this.handleMessage(event.data);
    };
    worker.onerror = (event) => {
      if (this.worker !== worker || this.generation !== generation) return;
      event.preventDefault?.();
      this.failActiveAndRestart(
        new BooleanWorkerError(event.message || 'Boolean worker error.'),
      );
    };
    worker.onmessageerror = () => {
      if (this.worker !== worker || this.generation !== generation) return;
      this.failActiveAndRestart(
        new BooleanWorkerError('Boolean worker returned an unreadable message.'),
      );
    };
    return worker;
  }

  private handleMessage(data: unknown): void {
    const active = this.active;
    if (!active) return;
    if (
      data === null
      || typeof data !== 'object'
      || !Number.isSafeInteger((data as { id?: unknown }).id)
    ) {
      this.failActiveAndRestart(protocolError('malformed reply'));
      return;
    }
    const reply = data as WorkerReply;
    if (
      reply.id !== active.id
      || active.generation !== this.generation
    ) {
      this.failActiveAndRestart(
        protocolError('reply id did not match the active request'),
      );
      return;
    }
    if (typeof reply.error === 'string') {
      this.settle(
        active,
        undefined,
        reply.code === 'TIMEOUT'
          ? new CookDeadlineExceededError(active.options.revision)
          : reply.code === 'RESOURCE_LIMIT'
            ? new CookResourceLimitError(reply.error)
            : new BooleanWorkerError(reply.error),
      );
      this.pump();
      return;
    }
    if (!Array.isArray(reply.paths)) {
      this.failActiveAndRestart(
        protocolError('success reply omitted paths'),
      );
      return;
    }
    this.settle(active, reply.paths);
    this.pump();
  }

  private interrupt(request: QueuedBoolean, error: Error): void {
    if (request.phase === 'settled') return;
    if (request.phase === 'active') {
      this.failActiveAndRestart(error);
      return;
    }
    this.settle(request, undefined, error);
    this.pump();
  }

  private failActiveAndRestart(error: Error): void {
    const active = this.active;
    this.terminateWorker();
    if (active) this.settle(active, undefined, error);
    this.pump();
  }

  private settle(
    request: QueuedBoolean,
    paths?: PathCmd[][],
    error?: Error,
  ): void {
    if (request.phase === 'settled') return;
    if (this.active === request) this.active = null;
    else {
      const index = this.queue.indexOf(request);
      if (index >= 0) this.queue.splice(index, 1);
    }
    request.phase = 'settled';
    if (request.timer !== null) clearTimeout(request.timer);
    if (request.options.signal && request.onAbort) {
      request.options.signal.removeEventListener('abort', request.onAbort);
    }
    if (error) request.reject(error);
    else request.resolve(paths!);
  }

  private terminateWorker(): void {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }

  private pendingCount(): number {
    return this.queue.length + (this.active ? 1 : 0);
  }
}

function countPoints(polylines: Polyline[]): number {
  let count = 0;
  for (const polyline of polylines) {
    const next = count + polyline.points.length;
    if (!Number.isSafeInteger(next)) return Number.MAX_SAFE_INTEGER;
    count = next;
  }
  return count;
}

const sharedBooleanWorker = new BooleanWorkerClient();

export function runBoolean(
  a: Polyline[],
  b: Polyline[],
  op: BooleanOperation,
  options: BooleanDispatchOptions = {},
): Promise<PathCmd[][]> {
  return sharedBooleanWorker.run(a, b, op, options);
}

export function resetBooleanWorker(
  reason = new CookCancelledError(),
): void {
  sharedBooleanWorker.reset(reason);
}

export function booleanWorkerStats(): ReturnType<BooleanWorkerClient['stats']> {
  return sharedBooleanWorker.stats();
}
