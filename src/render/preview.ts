import type { AgentErrorCode } from '../domain/agentErrors';
import { DEFAULT_AGENT_LIMITS } from '../domain/limits';
import {
  DEFAULT_PREVIEW_FORMAT,
  PREVIEW_CAPTURE_POLICY,
  PREVIEW_TRUST,
} from '../domain/previewContract';
import type { RenderStatus, RenderTicket } from '../domain/renderCoordinator';
import {
  CookCancelledError,
  CookDeadlineExceededError,
  CookResourceLimitError,
  remainingCookMs,
  throwIfCookInterrupted,
  type CookControl,
} from '../engine/cookControl';
import { useApp } from '../store';
import {
  appRenderCoordinator,
  currentArtifactTicket,
  readbackPreviewExact,
  registerDevPreviewCapture,
  registerPreviewLifecycle,
} from './appRenderService';
import type { PreviewMetricsV1 } from './previewMetrics';
import {
  encodePreviewInWorker,
  resetPreviewWorker,
} from './previewWorkerClient';
import type {
  PreviewFormat,
  PreviewMimeType,
} from './previewWorkerProtocol';

const DEFAULT_PREVIEW_SIDE = 768;

export interface PreviewRequest {
  revision: number;
  /**
   * Optional exact-attempt extension to the architecture's revision contract.
   * When omitted, the latest attempt is captured atomically at call start.
   */
  attempt?: number;
  maxWidth?: number;
  maxHeight?: number;
  format?: PreviewFormat;
  includeMetrics?: boolean;
}

export interface PreviewBinaryHandle {
  kind: 'inline-array-buffer-v1';
  mimeType: PreviewMimeType;
  byteLength: number;
  contentHash: string;
  trust: typeof PREVIEW_TRUST;
  /**
   * Internal browser boundary only. PR5 maps this transferable buffer to the
   * gated AgentController handle, and PR6 maps it to MCP image content.
   */
  bytes: ArrayBuffer;
}

export interface PreviewResult {
  requestedRevision: number;
  revision: number;
  attempt: number;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  mimeType: PreviewMimeType;
  byteLength: number;
  contentHash: string;
  rgbaSha256: string;
  capturePolicy: typeof PREVIEW_CAPTURE_POLICY;
  image: PreviewBinaryHandle;
  metrics?: PreviewMetricsV1;
}

export interface PreviewCaptureControl {
  signal?: AbortSignal;
  /** Absolute `performance.now()` deadline. */
  deadline?: number;
}

interface NormalizedPreviewRequest {
  revision: number;
  attempt?: number;
  maxWidth: number;
  maxHeight: number;
  format: PreviewFormat;
  includeMetrics: boolean;
}

interface BoundPreviewRequest extends NormalizedPreviewRequest {
  attempt: number;
}

interface QueuedCapture {
  request: BoundPreviewRequest;
  control: CookControl;
  controller: AbortController;
  resolve: (result: PreviewResult) => void;
  reject: (error: Error) => void;
  phase: 'queued' | 'active' | 'settled';
  timer: ReturnType<typeof setTimeout> | null;
  externalSignal?: AbortSignal;
  onExternalAbort?: () => void;
}

export class PreviewCaptureError extends Error {
  readonly recoverable: boolean;

  constructor(
    readonly code: AgentErrorCode,
    message: string,
    options: { recoverable?: boolean } = {},
  ) {
    super(message);
    this.name = 'PreviewCaptureError';
    this.recoverable = options.recoverable ?? true;
  }
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new PreviewCaptureError(
      'INVALID_ARGUMENT',
      `${name} must be a positive safe integer.`,
    );
  }
  return value as number;
}

export function normalizePreviewRequest(
  value: unknown,
): NormalizedPreviewRequest {
  if (!plainRecord(value)) {
    throw new PreviewCaptureError(
      'INVALID_ARGUMENT',
      'Preview request must be a plain object.',
    );
  }
  const allowed = new Set([
    'revision',
    'attempt',
    'maxWidth',
    'maxHeight',
    'format',
    'includeMetrics',
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new PreviewCaptureError(
      'INVALID_ARGUMENT',
      `Unknown preview request field: ${unknown[0]}.`,
    );
  }
  if (
    !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 0
  ) {
    throw new PreviewCaptureError(
      'INVALID_ARGUMENT',
      'revision must be a non-negative safe integer.',
    );
  }
  const attempt = value.attempt === undefined
    ? undefined
    : positiveInteger(value.attempt, 'attempt');
  const hasWidth = value.maxWidth !== undefined;
  const hasHeight = value.maxHeight !== undefined;
  const maxWidth = hasWidth
    ? positiveInteger(value.maxWidth, 'maxWidth')
    : hasHeight
      ? DEFAULT_AGENT_LIMITS.maxPreviewSide
      : Math.min(DEFAULT_PREVIEW_SIDE, DEFAULT_AGENT_LIMITS.maxPreviewSide);
  const maxHeight = hasHeight
    ? positiveInteger(value.maxHeight, 'maxHeight')
    : hasWidth
      ? DEFAULT_AGENT_LIMITS.maxPreviewSide
      : Math.min(DEFAULT_PREVIEW_SIDE, DEFAULT_AGENT_LIMITS.maxPreviewSide);
  if (
    maxWidth > DEFAULT_AGENT_LIMITS.maxPreviewSide
    || maxHeight > DEFAULT_AGENT_LIMITS.maxPreviewSide
  ) {
    throw new PreviewCaptureError(
      'RESOURCE_LIMIT',
      `Preview sides cannot exceed ${DEFAULT_AGENT_LIMITS.maxPreviewSide}.`,
    );
  }
  const format = value.format === undefined
    ? DEFAULT_PREVIEW_FORMAT
    : value.format;
  if (format !== 'png' && format !== 'webp') {
    throw new PreviewCaptureError(
      'INVALID_ARGUMENT',
      'format must be "png" or "webp".',
    );
  }
  const includeMetrics = value.includeMetrics === undefined
    ? true
    : value.includeMetrics;
  if (typeof includeMetrics !== 'boolean') {
    throw new PreviewCaptureError(
      'INVALID_ARGUMENT',
      'includeMetrics must be a boolean.',
    );
  }
  return {
    revision: value.revision as number,
    ...(attempt === undefined ? {} : { attempt }),
    maxWidth,
    maxHeight,
    format,
    includeMetrics,
  };
}

export function fitPreviewDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  for (const [name, value] of Object.entries({
    sourceWidth,
    sourceHeight,
    maxWidth,
    maxHeight,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  const scale = Math.min(
    1,
    maxWidth / sourceWidth,
    maxHeight / sourceHeight,
  );
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
  };
}

function sameTicket(
  left: RenderTicket | null,
  right: RenderTicket | null,
): boolean {
  return !!left
    && !!right
    && left.revision === right.revision
    && left.attempt === right.attempt;
}

function statusError(status: RenderStatus): Error {
  if (status.error) {
    return Object.assign(new Error(status.error.message), status.error);
  }
  return new PreviewCaptureError(
    'RENDER_SUPERSEDED',
    `Render revision ${status.ticket?.revision ?? 'unknown'} is unavailable.`,
  );
}

async function captureExact(
  request: BoundPreviewRequest,
  control: CookControl,
): Promise<PreviewResult> {
  throwIfCookInterrupted(control);
  if (useApp.getState().revision !== request.revision) {
    throw new PreviewCaptureError(
      'RENDER_SUPERSEDED',
      `Preview capture is allowed only for current document revision ${
        useApp.getState().revision
      }.`,
    );
  }

  const snapshot = appRenderCoordinator.getRenderStatus({
    revision: request.revision,
    attempt: request.attempt,
  });
  const boundTicket = snapshot.ticket
    ? { ...snapshot.ticket }
    : { revision: request.revision, attempt: request.attempt };
  const remaining = remainingCookMs(control);
  const status = await appRenderCoordinator.awaitRender({
    revision: request.revision,
    attempt: boundTicket.attempt,
    ...(remaining === null
      ? {}
      : { timeoutMs: Math.max(1, Math.ceil(remaining)) }),
    ...(control.signal ? { signal: control.signal } : {}),
  });
  throwIfCookInterrupted(control);
  if (
    status.state !== 'complete'
    || !status.ticket
    || !sameTicket(status.ticket, status.displayedTicket)
    || !sameTicket(status.ticket, boundTicket)
  ) {
    throw statusError(status);
  }
  if (
    useApp.getState().revision !== request.revision
    || appRenderCoordinator.getRenderStatus().documentRevision !== request.revision
  ) {
    throw new PreviewCaptureError(
      'RENDER_SUPERSEDED',
      `Render revision ${request.revision} stopped being current before capture.`,
    );
  }
  if (
    !Number.isSafeInteger(status.width)
    || !Number.isSafeInteger(status.height)
    || (status.width ?? 0) <= 0
    || (status.height ?? 0) <= 0
  ) {
    throw new PreviewCaptureError(
      'INTERNAL',
      'Completed render is missing exact dimensions.',
      { recoverable: false },
    );
  }
  const sourceWidth = status.width!;
  const sourceHeight = status.height!;
  const dimensions = fitPreviewDimensions(
    sourceWidth,
    sourceHeight,
    request.maxWidth,
    request.maxHeight,
  );
  const image = await readbackPreviewExact(
    status.ticket,
    dimensions.width,
    dimensions.height,
    control,
  );
  throwIfCookInterrupted(control);
  if (
    image.width !== dimensions.width
    || image.height !== dimensions.height
    || image.data.byteLength !== image.width * image.height * 4
  ) {
    throw new PreviewCaptureError(
      'INTERNAL',
      'Preview readback dimensions do not match the requested bounds.',
      { recoverable: false },
    );
  }

  const encoded = await encodePreviewInWorker(
    {
      data: image.data,
      width: image.width,
      height: image.height,
    },
    {
      format: request.format,
      includeMetrics: request.includeMetrics,
      signal: control.signal,
      deadline: control.deadline,
      revision: request.revision,
      maxBytes: DEFAULT_AGENT_LIMITS.maxPreviewBytes,
      maxEncodeAttempts: DEFAULT_AGENT_LIMITS.maxPreviewEncodeAttempts,
      maxPendingRequests: DEFAULT_AGENT_LIMITS.maxPendingPreviewRequests,
      maxPendingBytes: DEFAULT_AGENT_LIMITS.maxPendingPreviewBytes,
    },
  );
  throwIfCookInterrupted(control);

  const latest = appRenderCoordinator.getRenderStatus({
    revision: request.revision,
  });
  if (
    useApp.getState().revision !== request.revision
    || latest.state !== 'complete'
    || !sameTicket(latest.ticket, status.ticket)
    || !sameTicket(latest.displayedTicket, status.ticket)
    || !sameTicket(currentArtifactTicket(), status.ticket)
  ) {
    throw new PreviewCaptureError(
      'RENDER_SUPERSEDED',
      `Render revision ${request.revision}, attempt ${
        status.ticket.attempt
      } changed while preview evidence was encoded.`,
    );
  }

  return {
    requestedRevision: request.revision,
    revision: status.ticket.revision,
    attempt: status.ticket.attempt,
    sourceWidth,
    sourceHeight,
    width: encoded.width,
    height: encoded.height,
    mimeType: encoded.mimeType,
    byteLength: encoded.byteLength,
    contentHash: encoded.contentHash,
    rgbaSha256: encoded.rgbaSha256,
    capturePolicy: PREVIEW_CAPTURE_POLICY,
    image: {
      kind: 'inline-array-buffer-v1',
      mimeType: encoded.mimeType,
      byteLength: encoded.byteLength,
      contentHash: encoded.contentHash,
      trust: PREVIEW_TRUST,
      bytes: encoded.bytes,
    },
    ...(encoded.metrics ? { metrics: encoded.metrics } : {}),
  };
}

export class PreviewCaptureService {
  private active: QueuedCapture | null = null;
  private queue: QueuedCapture[] = [];
  private readonly idleWaiters = new Set<() => void>();

  constructor(
    private readonly executeCapture: (
      request: BoundPreviewRequest,
      control: CookControl,
    ) => Promise<PreviewResult> = captureExact,
    private readonly bindRequest: (
      request: NormalizedPreviewRequest,
    ) => BoundPreviewRequest = bindPreviewRequestAtCallStart,
  ) {}

  capture(
    request: unknown,
    options: PreviewCaptureControl = {},
  ): Promise<PreviewResult> {
    let normalized: BoundPreviewRequest;
    try {
      normalized = this.bindRequest(normalizePreviewRequest(request));
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.pendingCount() >= DEFAULT_AGENT_LIMITS.maxPendingPreviewRequests) {
      return Promise.reject(new CookResourceLimitError(
        `Preview service already has ${this.pendingCount()} pending requests.`,
        {
          actualAtLeast: this.pendingCount() + 1,
          maximum: DEFAULT_AGENT_LIMITS.maxPendingPreviewRequests,
        },
      ));
    }
    if (options.signal?.aborted) {
      return Promise.reject(
        options.signal.reason instanceof Error
          ? options.signal.reason
          : new CookCancelledError(normalized.revision),
      );
    }
    const now = performance.now();
    const policyDeadline = now + DEFAULT_AGENT_LIMITS.previewDeadlineMs;
    const deadline = options.deadline === undefined
      ? policyDeadline
      : Math.min(options.deadline, policyDeadline);
    if (!Number.isFinite(deadline) || deadline <= now) {
      return Promise.reject(new CookDeadlineExceededError(normalized.revision));
    }
    const controller = new AbortController();
    const control: CookControl = {
      revision: normalized.revision,
      signal: controller.signal,
      deadline,
    };
    return new Promise<PreviewResult>((resolve, reject) => {
      const queued: QueuedCapture = {
        request: normalized,
        control,
        controller,
        resolve,
        reject,
        phase: 'queued',
        timer: null,
        ...(options.signal ? { externalSignal: options.signal } : {}),
      };
      if (options.signal) {
        queued.onExternalAbort = () => {
          const reason = options.signal?.reason instanceof Error
            ? options.signal.reason
            : new CookCancelledError(normalized.revision);
          this.interrupt(queued, reason);
        };
        options.signal.addEventListener(
          'abort',
          queued.onExternalAbort,
          { once: true },
        );
      }
      queued.timer = setTimeout(
        () => this.interrupt(
          queued,
          new CookDeadlineExceededError(normalized.revision),
        ),
        Math.max(0, deadline - now),
      );
      this.queue.push(queued);
      this.pump();
    });
  }

  reset(reason: Error = new CookCancelledError()): void {
    if (this.active && !this.active.controller.signal.aborted) {
      this.active.controller.abort(reason);
    }
    for (const request of [...this.queue]) {
      this.settle(request, undefined, reason);
    }
    resetPreviewWorker(reason);
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
  } {
    return {
      pending: this.pendingCount(),
      active: this.active !== null,
      queued: this.queue.length,
    };
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) {
      this.resolveIdle();
      return;
    }
    const request = this.queue.shift()!;
    if (request.controller.signal.aborted) {
      this.settle(
        request,
        undefined,
        request.controller.signal.reason instanceof Error
          ? request.controller.signal.reason
          : new CookCancelledError(request.request.revision),
      );
      this.pump();
      return;
    }
    request.phase = 'active';
    this.active = request;
    void this.executeCapture(request.request, request.control).then(
      (result) => this.settle(request, result),
      (error) => this.settle(
        request,
        undefined,
        error instanceof Error ? error : new Error(String(error)),
      ),
    ).finally(() => {
      this.pump();
    });
  }

  private interrupt(request: QueuedCapture, reason: Error): void {
    if (request.phase === 'settled') return;
    if (!request.controller.signal.aborted) request.controller.abort(reason);
    if (request.phase === 'queued') {
      this.settle(request, undefined, reason);
      this.pump();
    }
  }

  private settle(
    request: QueuedCapture,
    result?: PreviewResult,
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
    if (request.externalSignal && request.onExternalAbort) {
      request.externalSignal.removeEventListener(
        'abort',
        request.onExternalAbort,
      );
    }
    if (error) request.reject(error);
    else request.resolve(result!);
    this.resolveIdle();
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

function bindPreviewRequestAtCallStart(
  request: NormalizedPreviewRequest,
): BoundPreviewRequest {
  const currentRevision = useApp.getState().revision;
  if (currentRevision !== request.revision) {
    throw new PreviewCaptureError(
      'RENDER_SUPERSEDED',
      `Preview capture is allowed only for current document revision ${
        currentRevision
      }.`,
    );
  }
  if (request.attempt !== undefined) {
    return { ...request, attempt: request.attempt };
  }
  // This read is synchronous with the caller and happens before queue
  // admission. A same-revision retry after this point can only supersede the
  // bound ticket; it can never redirect this request to the newer attempt.
  const status = appRenderCoordinator.getRenderStatus({
    revision: request.revision,
  });
  if (!status.ticket) {
    throw new PreviewCaptureError(
      'RENDER_SUPERSEDED',
      `No render attempt exists for revision ${request.revision}.`,
    );
  }
  return { ...request, attempt: status.ticket.attempt };
}

const sharedPreviewCapture = new PreviewCaptureService();

export function capturePreview(
  request: unknown,
  options: PreviewCaptureControl = {},
): Promise<PreviewResult> {
  return sharedPreviewCapture.capture(request, options);
}

export function resetPreviewCapture(reason = new CookCancelledError()): void {
  sharedPreviewCapture.reset(reason);
}

export function whenPreviewCaptureIdle(): Promise<void> {
  return sharedPreviewCapture.whenIdle();
}

export function previewCaptureStats(): ReturnType<PreviewCaptureService['stats']> {
  return sharedPreviewCapture.stats();
}

registerPreviewLifecycle((reason) => {
  sharedPreviewCapture.reset(reason);
});
registerDevPreviewCapture((request) => sharedPreviewCapture.capture(request));
