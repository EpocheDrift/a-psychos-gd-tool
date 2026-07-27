import { DEFAULT_AGENT_LIMITS } from '../domain/limits';
import {
  CookCancelledError,
  CookDeadlineExceededError,
  CookResourceLimitError,
  remainingCookMs,
} from '../engine/cookControl';
import {
  PREVIEW_METRICS_VERSION,
  type PreviewMetricsV1,
  type PreviewPixels,
} from './previewMetrics';
import type {
  PreviewFormat,
  PreviewWorkerFailure,
  PreviewWorkerReply,
  PreviewWorkerRequest,
  PreviewWorkerSuccess,
} from './previewWorkerProtocol';

interface PreviewWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export type PreviewWorkerFactory = () => PreviewWorkerLike;

export interface PreviewEncodeOptions {
  format: PreviewFormat;
  includeMetrics: boolean;
  signal?: AbortSignal;
  /** Absolute `performance.now()` deadline shared by render and encoding. */
  deadline?: number;
  revision?: number;
  maxBytes?: number;
  maxEncodeAttempts?: number;
  maxPendingRequests?: number;
  maxPendingBytes?: number;
}

interface QueuedPreview {
  id: number;
  pixels: {
    data: ArrayBuffer;
    width: number;
    height: number;
  };
  bytes: number;
  options: PreviewEncodeOptions;
  resolve: (reply: PreviewWorkerSuccess) => void;
  reject: (error: Error) => void;
  phase: 'queued' | 'active' | 'settled';
  generation?: number;
  timer: ReturnType<typeof setTimeout> | null;
  onAbort?: () => void;
}

export class PreviewWorkerError extends Error {
  readonly recoverable = true;
  readonly phase = 'preview-encode' as const;

  constructor(
    readonly code: 'INVALID_ARGUMENT' | 'INTERNAL',
    message: string,
  ) {
    super(message);
    this.name = 'PreviewWorkerError';
  }
}

function defaultWorkerFactory(): PreviewWorkerLike {
  return new Worker(
    new URL('./previewWorker.ts', import.meta.url),
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

function abortReason(options: PreviewEncodeOptions): Error {
  return options.signal?.reason instanceof Error
    ? options.signal.reason
    : new CookCancelledError(options.revision);
}

function protocolError(message: string): PreviewWorkerError {
  return new PreviewWorkerError(
    'INTERNAL',
    `Preview worker protocol error: ${message}`,
  );
}

function workerFailure(error: PreviewWorkerFailure): Error {
  if (error.code === 'TIMEOUT') {
    return new CookDeadlineExceededError();
  }
  if (error.code === 'RESOURCE_LIMIT') {
    return new CookResourceLimitError(error.message);
  }
  return new PreviewWorkerError(error.code, error.message);
}

function finiteUnit(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= 1;
}

function validMetrics(
  value: unknown,
  width: number,
  height: number,
): value is PreviewMetricsV1 {
  if (!value || typeof value !== 'object') return false;
  const metrics = value as Partial<PreviewMetricsV1>;
  const luminance = metrics.luminance;
  if (
    metrics.version !== PREVIEW_METRICS_VERSION
    || !finiteUnit(metrics.alphaCoverage)
    || !luminance
    || !finiteUnit(luminance.min)
    || !finiteUnit(luminance.max)
    || !finiteUnit(luminance.mean)
    || luminance.min > luminance.mean
    || luminance.mean > luminance.max
    || !/^[0-9a-f]{16}$/.test(metrics.perceptualHash ?? '')
  ) {
    return false;
  }
  const bounds = metrics.nonBackgroundBounds;
  if (
    bounds !== null
    && (
      !bounds
      || !Number.isSafeInteger(bounds.x)
      || !Number.isSafeInteger(bounds.y)
      || !Number.isSafeInteger(bounds.width)
      || !Number.isSafeInteger(bounds.height)
      || bounds.x < 0
      || bounds.y < 0
      || bounds.width <= 0
      || bounds.height <= 0
      || bounds.x + bounds.width > width
      || bounds.y + bounds.height > height
    )
  ) {
    return false;
  }
  const background = metrics.background;
  if (background === null) return true;
  return !!background
    && Array.isArray(background.premultipliedRgba)
    && background.premultipliedRgba.length === 4
    && background.premultipliedRgba.every(
      (channel) => Number.isSafeInteger(channel) && channel >= 0 && channel <= 255,
    )
    && finiteUnit(background.confidence);
}

function validSuccess(
  value: PreviewWorkerReply,
  request: QueuedPreview,
): value is PreviewWorkerSuccess {
  const expectedMimeType = request.options.format === 'webp'
    ? 'image/webp'
    : 'image/png';
  return value.ok
    && Number.isSafeInteger(value.width)
    && Number.isSafeInteger(value.height)
    && value.width > 0
    && value.height > 0
    && value.width <= request.pixels.width
    && value.height <= request.pixels.height
    && value.mimeType === expectedMimeType
    && value.bytes instanceof ArrayBuffer
    && value.byteLength === value.bytes.byteLength
    && Number.isSafeInteger(value.byteLength)
    && value.byteLength > 0
    && value.byteLength <= (
      request.options.maxBytes ?? DEFAULT_AGENT_LIMITS.maxPreviewBytes
    )
    && /^[0-9a-f]{64}$/.test(value.contentHash)
    && /^[0-9a-f]{64}$/.test(value.rgbaSha256)
    && (
      request.options.includeMetrics
        ? validMetrics(value.metrics, value.width, value.height)
        : value.metrics === undefined
    );
}

export class PreviewWorkerClient {
  private worker: PreviewWorkerLike | null = null;
  private generation = 0;
  private sequence = 0;
  private active: QueuedPreview | null = null;
  private queue: QueuedPreview[] = [];
  private pendingBytes = 0;
  private readonly idleWaiters = new Set<() => void>();

  constructor(
    private readonly workerFactory: PreviewWorkerFactory = defaultWorkerFactory,
  ) {}

  encode(
    pixels: PreviewPixels,
    options: PreviewEncodeOptions,
  ): Promise<PreviewWorkerSuccess> {
    if (
      !Number.isSafeInteger(pixels.width)
      || !Number.isSafeInteger(pixels.height)
      || pixels.width <= 0
      || pixels.height <= 0
      || pixels.data.byteLength !== pixels.width * pixels.height * 4
    ) {
      return Promise.reject(
        new PreviewWorkerError('INVALID_ARGUMENT', 'Preview pixels are invalid.'),
      );
    }
    if (options.format !== 'png' && options.format !== 'webp') {
      return Promise.reject(
        new PreviewWorkerError('INVALID_ARGUMENT', 'Preview format is invalid.'),
      );
    }
    if (options.signal?.aborted) {
      return Promise.reject(abortReason(options));
    }
    const remaining = remainingCookMs(options);
    if (remaining !== null && remaining <= 0) {
      return Promise.reject(new CookDeadlineExceededError(options.revision));
    }
    const maxPendingRequests = boundedLimit(
      options.maxPendingRequests,
      DEFAULT_AGENT_LIMITS.maxPendingPreviewRequests,
      DEFAULT_AGENT_LIMITS.maxPendingPreviewRequests,
    );
    if (this.pendingCount() >= maxPendingRequests) {
      return Promise.reject(new CookResourceLimitError(
        `Preview worker already has ${this.pendingCount()} pending requests.`,
        {
          actualAtLeast: this.pendingCount() + 1,
          maximum: maxPendingRequests,
        },
      ));
    }
    const maxPendingBytes = boundedLimit(
      options.maxPendingBytes,
      DEFAULT_AGENT_LIMITS.maxPendingPreviewBytes,
      DEFAULT_AGENT_LIMITS.maxPendingPreviewBytes,
    );
    const bytes = pixels.data.byteLength;
    if (bytes > maxPendingBytes - this.pendingBytes) {
      return Promise.reject(new CookResourceLimitError(
        'Preview worker queue would exceed its byte budget.',
        {
          actualAtLeast: this.pendingBytes + bytes,
          maximum: maxPendingBytes,
        },
      ));
    }

    const id = ++this.sequence;
    // Give the queue its own exact ArrayBuffer. The active request transfers
    // ownership to the worker without detaching the caller's ImageData.
    const data = new Uint8ClampedArray(pixels.data).buffer;
    return new Promise<PreviewWorkerSuccess>((resolve, reject) => {
      const request: QueuedPreview = {
        id,
        pixels: {
          data,
          width: pixels.width,
          height: pixels.height,
        },
        bytes,
        options,
        resolve,
        reject,
        phase: 'queued',
        timer: null,
      };
      this.queue.push(request);
      this.pendingBytes += bytes;
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
    this.resolveIdle();
  }

  whenIdle(): Promise<void> {
    if (this.pendingCount() === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleWaiters.add(resolve);
    });
  }

  stats(): {
    pending: number;
    active: boolean;
    queued: number;
    pendingBytes: number;
    worker: boolean;
    generation: number;
  } {
    return {
      pending: this.pendingCount(),
      active: this.active !== null,
      queued: this.queue.length,
      pendingBytes: this.pendingBytes,
      worker: this.worker !== null,
      generation: this.generation,
    };
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) {
      this.resolveIdle();
      return;
    }
    const request = this.queue.shift()!;
    request.phase = 'active';
    this.active = request;
    try {
      const worker = this.ensureWorker();
      request.generation = this.generation;
      const remaining = remainingCookMs(request.options);
      if (remaining !== null && remaining <= 0) {
        this.interrupt(
          request,
          new CookDeadlineExceededError(request.options.revision),
        );
        return;
      }
      const message: PreviewWorkerRequest = {
        id: request.id,
        generation: request.generation,
        width: request.pixels.width,
        height: request.pixels.height,
        data: request.pixels.data,
        format: request.options.format,
        includeMetrics: request.options.includeMetrics,
        maxBytes: boundedLimit(
          request.options.maxBytes,
          DEFAULT_AGENT_LIMITS.maxPreviewBytes,
          DEFAULT_AGENT_LIMITS.maxPreviewBytes,
        ),
        maxEncodeAttempts: boundedLimit(
          request.options.maxEncodeAttempts,
          DEFAULT_AGENT_LIMITS.maxPreviewEncodeAttempts,
          DEFAULT_AGENT_LIMITS.maxPreviewEncodeAttempts,
        ),
        ...(remaining === null ? {} : { timeoutMs: remaining }),
      };
      worker.postMessage(message, [message.data]);
    } catch (error) {
      this.failActiveAndRestart(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private ensureWorker(): PreviewWorkerLike {
    if (this.worker) return this.worker;
    const worker = this.workerFactory();
    const generation = ++this.generation;
    worker.onmessage = (event) => this.onMessage(event.data, generation);
    worker.onerror = (event) => {
      this.failActiveAndRestart(
        new PreviewWorkerError(
          'INTERNAL',
          event.message || 'Preview worker failed.',
        ),
      );
    };
    worker.onmessageerror = () => {
      this.failActiveAndRestart(protocolError('message could not be decoded'));
    };
    this.worker = worker;
    return worker;
  }

  private onMessage(value: unknown, generation: number): void {
    if (generation !== this.generation) return;
    const request = this.active;
    if (!request) return;
    if (!value || typeof value !== 'object') {
      this.failActiveAndRestart(protocolError('reply is not an object'));
      return;
    }
    const reply = value as PreviewWorkerReply;
    if (
      reply.id !== request.id
      || reply.generation !== generation
      || request.generation !== generation
    ) {
      this.failActiveAndRestart(protocolError('reply identity does not match'));
      return;
    }
    if (!reply.ok) {
      this.settle(request, undefined, workerFailure(reply));
      this.pump();
      return;
    }
    if (!validSuccess(reply, request)) {
      this.failActiveAndRestart(protocolError('success payload is invalid'));
      return;
    }
    this.settle(request, reply);
    this.pump();
  }

  private interrupt(request: QueuedPreview, error: Error): void {
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
    request: QueuedPreview,
    reply?: PreviewWorkerSuccess,
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
    this.resolveIdle();
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

  private resolveIdle(): void {
    if (this.pendingCount() !== 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}

const sharedPreviewWorker = new PreviewWorkerClient();

export function encodePreviewInWorker(
  pixels: PreviewPixels,
  options: PreviewEncodeOptions,
): Promise<PreviewWorkerSuccess> {
  return sharedPreviewWorker.encode(pixels, options);
}

export function resetPreviewWorker(
  reason: Error = new CookCancelledError(),
): void {
  sharedPreviewWorker.reset(reason);
}

export function whenPreviewWorkerIdle(): Promise<void> {
  return sharedPreviewWorker.whenIdle();
}

export function previewWorkerStats(): ReturnType<PreviewWorkerClient['stats']> {
  return sharedPreviewWorker.stats();
}
