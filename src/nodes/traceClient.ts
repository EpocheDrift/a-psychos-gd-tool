// Bounded, recoverable main-thread broker for traceWorker.ts. Only one request
// is ever posted at a time: synchronous tracing cannot process a cancel message,
// so cancelling an active request terminates that worker and lets queued work
// continue on a fresh generation.

import type { PathCmd } from '../engine/values';
import {
  CookCancelledError,
  CookDeadlineExceededError,
  CookResourceLimitError,
  remainingCookMs,
} from '../engine/cookControl';
import { DEFAULT_AGENT_LIMITS } from '../domain/limits';

export interface TraceRequest {
  op: 'composite' | 'sobel' | 'silhouette' | 'removebg';
  imageData: ImageData;
  smoothness: number;
  minArea: number;
  threshold: number;
  dropLight: boolean;
  /** silhouette op: outline band width in (capped) pixels */
  thickness?: number;
}

export interface WorkerImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface WorkerReply {
  id: number;
  paths?: PathCmd[][];
  image?: WorkerImage;
  error?: string;
  code?: 'TIMEOUT' | 'RESOURCE_LIMIT';
}

interface TraceWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export type TraceWorkerFactory = () => TraceWorkerLike;

export interface TraceDispatchOptions {
  signal?: AbortSignal;
  /** Absolute `performance.now()` deadline. */
  deadline?: number;
  revision?: number;
  maxPendingRequests?: number;
  maxPendingBytes?: number;
  maxVectorCommands?: number;
}

interface QueuedRequest {
  id: number;
  op: TraceRequest['op'];
  request: Omit<TraceRequest, 'imageData'>;
  imageData: ImageData;
  bytes: number;
  options: TraceDispatchOptions;
  resolve: (reply: WorkerReply) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  onAbort?: () => void;
  phase: 'queued' | 'active' | 'settled';
  generation?: number;
}

export class TraceWorkerError extends Error {
  readonly code = 'RENDER_FAILED' as const;
  readonly recoverable = true;
  readonly phase = 'worker' as const;

  constructor(message: string) {
    super(message);
    this.name = 'TraceWorkerError';
  }
}

function defaultWorkerFactory(): TraceWorkerLike {
  return new Worker(
    new URL('./traceWorker.ts', import.meta.url),
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

function requestAbortReason(options: TraceDispatchOptions): Error {
  return options.signal?.reason instanceof Error
    ? options.signal.reason
    : new CookCancelledError(options.revision);
}

function protocolError(message: string): TraceWorkerError {
  return new TraceWorkerError(`Trace worker protocol error: ${message}`);
}

export class TraceWorkerClient {
  private worker: TraceWorkerLike | null = null;
  private generation = 0;
  private sequence = 0;
  private queue: QueuedRequest[] = [];
  private active: QueuedRequest | null = null;
  private pendingBytes = 0;

  constructor(
    private readonly workerFactory: TraceWorkerFactory = defaultWorkerFactory,
  ) {}

  async runTrace(
    request: TraceRequest,
    options: TraceDispatchOptions = {},
  ): Promise<PathCmd[][]> {
    const { imageData, ...wireRequest } = request;
    const reply = await this.dispatch(wireRequest, imageData, options);
    if (!Array.isArray(reply.paths)) {
      throw protocolError('trace success reply omitted paths');
    }
    return reply.paths;
  }

  async runRemoveBg(
    imageData: ImageData,
    options: TraceDispatchOptions = {},
  ): Promise<WorkerImage> {
    const reply = await this.dispatch(
      {
        op: 'removebg',
        smoothness: 0,
        minArea: 0,
        threshold: 0,
        dropLight: false,
      },
      imageData,
      options,
    );
    if (!this.validWorkerImage(reply.image)) {
      throw protocolError('remove-background success reply omitted a valid image');
    }
    return reply.image;
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
    pendingBytes: number;
    active: boolean;
    queued: number;
    worker: boolean;
  } {
    return {
      pending: this.pendingCount(),
      pendingBytes: this.pendingBytes,
      active: this.active !== null,
      queued: this.queue.length,
      worker: this.worker !== null,
    };
  }

  private dispatch(
    request: Omit<TraceRequest, 'imageData'>,
    imageData: ImageData,
    options: TraceDispatchOptions,
  ): Promise<WorkerReply> {
    if (options.signal?.aborted) {
      return Promise.reject(requestAbortReason(options));
    }
    const remaining = remainingCookMs(options);
    if (remaining !== null && remaining <= 0) {
      return Promise.reject(new CookDeadlineExceededError(options.revision));
    }

    const expectedBytes = imageData.width * imageData.height * 4;
    if (
      !Number.isSafeInteger(expectedBytes)
      || expectedBytes <= 0
      || imageData.data.byteLength !== expectedBytes
    ) {
      return Promise.reject(new CookResourceLimitError(
        'Trace worker pixel buffer does not match its declared dimensions.',
        {
          actualBytes: imageData.data.byteLength,
          expectedBytes: Number.isSafeInteger(expectedBytes)
            ? expectedBytes
            : 0,
        },
      ));
    }
    // Transfer exactly the billed pixel view. A subarray can otherwise expose
    // unrelated backing bytes to the worker and exceed pending-byte accounting.
    const exactPixels = (
      imageData.data.byteOffset === 0
      && imageData.data.byteLength === imageData.data.buffer.byteLength
    )
      ? imageData.data
      : new Uint8ClampedArray(imageData.data);
    const normalizedImageData = exactPixels === imageData.data
      ? imageData
      : {
          data: exactPixels,
          width: imageData.width,
          height: imageData.height,
          colorSpace: imageData.colorSpace,
        } as ImageData;
    const bytes = exactPixels.byteLength;
    const maxRequests = boundedLimit(
      options.maxPendingRequests,
      DEFAULT_AGENT_LIMITS.maxPendingWorkerRequests,
      64,
    );
    const maxBytes = boundedLimit(
      options.maxPendingBytes,
      DEFAULT_AGENT_LIMITS.maxPendingWorkerBytes,
      1024 * 1024 * 1024,
    );
    if (this.pendingCount() >= maxRequests) {
      return Promise.reject(new CookResourceLimitError(
        `Trace worker already has ${this.pendingCount()} pending requests.`,
        { actual: this.pendingCount(), maximum: maxRequests },
      ));
    }
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > maxBytes - this.pendingBytes) {
      return Promise.reject(new CookResourceLimitError(
        'Trace worker pending pixel buffers exceed the configured byte budget.',
        {
          requestedBytes: bytes,
          pendingBytes: this.pendingBytes,
          maximumBytes: maxBytes,
        },
      ));
    }

    const id = ++this.sequence;
    return new Promise<WorkerReply>((resolve, reject) => {
      const queued: QueuedRequest = {
        id,
        op: request.op,
        request,
        imageData: normalizedImageData,
        bytes,
        options,
        resolve,
        reject,
        timer: null,
        phase: 'queued',
      };
      this.queue.push(queued);
      this.pendingBytes += bytes;

      if (options.signal) {
        queued.onAbort = () => this.interrupt(
          queued,
          requestAbortReason(options),
        );
        options.signal.addEventListener('abort', queued.onAbort, { once: true });
      }
      if (remaining !== null) {
        queued.timer = setTimeout(
          () => this.interrupt(
            queued,
            new CookDeadlineExceededError(options.revision),
          ),
          remaining,
        );
      }
      // Close the small race between the initial check and listener install.
      if (options.signal?.aborted) {
        queued.onAbort?.();
        return;
      }
      this.pump();
    });
  }

  private pump(): void {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    if (next.phase !== 'queued') {
      this.pump();
      return;
    }
    next.phase = 'active';
    this.active = next;

    let worker: TraceWorkerLike;
    try {
      worker = this.getWorker();
    } catch (error) {
      this.settle(
        next,
        undefined,
        new TraceWorkerError(
          error instanceof Error ? error.message : 'trace worker creation failed',
        ),
      );
      this.pump();
      return;
    }
    next.generation = this.generation;
    try {
      const timeoutMs = remainingCookMs(next.options);
      if (timeoutMs !== null && timeoutMs <= 0) {
        this.interrupt(
          next,
          new CookDeadlineExceededError(next.options.revision),
        );
        return;
      }
      const buffer = next.imageData.data.buffer as ArrayBuffer;
      worker.postMessage(
        {
          id: next.id,
          ...next.request,
          width: next.imageData.width,
          height: next.imageData.height,
          data: buffer,
          maxVectorCommands: boundedLimit(
            next.options.maxVectorCommands,
            DEFAULT_AGENT_LIMITS.maxVectorCommands,
            10_000_000,
          ),
          ...(timeoutMs !== null
            ? { timeoutMs }
            : {}),
        },
        [buffer],
      );
    } catch (error) {
      this.failActiveAndRestart(new TraceWorkerError(
        error instanceof Error ? error.message : 'trace worker postMessage failed',
      ));
    }
  }

  private getWorker(): TraceWorkerLike {
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
        new TraceWorkerError(event.message || 'trace worker error'),
      );
    };
    worker.onmessageerror = () => {
      if (this.worker !== worker || this.generation !== generation) return;
      this.failActiveAndRestart(
        new TraceWorkerError('trace worker returned an unreadable message'),
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
      this.failActiveAndRestart(protocolError('reply id did not match the active request'));
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
          : new TraceWorkerError(reply.error),
      );
      this.pump();
      return;
    }
    if (
      active.op === 'removebg'
        ? !this.validWorkerImage(reply.image)
        : !Array.isArray(reply.paths)
    ) {
      this.failActiveAndRestart(protocolError('success reply had the wrong payload'));
      return;
    }
    this.settle(active, reply);
    this.pump();
  }

  private validWorkerImage(image: WorkerImage | undefined): image is WorkerImage {
    if (
      !image
      || !(image.data instanceof Uint8ClampedArray)
      || !Number.isSafeInteger(image.width)
      || !Number.isSafeInteger(image.height)
      || image.width <= 0
      || image.height <= 0
    ) return false;
    const pixels = image.width * image.height;
    return Number.isSafeInteger(pixels)
      && image.data.byteLength === pixels * 4;
  }

  private interrupt(request: QueuedRequest, error: Error): void {
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
    request: QueuedRequest,
    reply?: WorkerReply,
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
    this.pendingBytes = Math.max(0, this.pendingBytes - request.bytes);
    if (error) request.reject(error);
    else request.resolve(reply!);
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

const sharedTraceWorker = new TraceWorkerClient();

export function runTrace(
  request: TraceRequest,
  options: TraceDispatchOptions = {},
): Promise<PathCmd[][]> {
  return sharedTraceWorker.runTrace(request, options);
}

export function runRemoveBg(
  imageData: ImageData,
  options: TraceDispatchOptions = {},
): Promise<WorkerImage> {
  return sharedTraceWorker.runRemoveBg(imageData, options);
}

export function resetTraceWorker(reason = new CookCancelledError()): void {
  sharedTraceWorker.reset(reason);
}

export function traceWorkerStats(): ReturnType<TraceWorkerClient['stats']> {
  return sharedTraceWorker.stats();
}
