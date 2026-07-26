import { DEFAULT_AGENT_LIMITS } from '../domain/limits';
import {
  RenderCoordinator,
  type AwaitRenderRequest,
  type RenderExecutionResult,
  type RenderJob,
  type RenderStatus,
  type RenderStatusRequest,
  type RenderTicket,
} from '../domain/renderCoordinator';
import {
  CookCancelledError,
  throwIfCookInterrupted,
  waitForCookControl,
  type CookControl,
} from '../engine/cookControl';
import { Evaluator } from '../engine/evaluator';
import { GpuWorkBudget } from '../engine/gpuWorkBudget';
import type { GpuContext } from '../gpu/device';
import type { PooledTexture } from '../gpu/pool';
import { resetTraceWorker } from '../nodes/traceClient';
import { resetBooleanWorker } from '../nodes/booleanClient';
import { useApp } from '../store';
import {
  disposeEvaluators,
  renderDocument,
  type RenderDocumentInput,
  type RenderedDocument,
} from './renderDocument';

export interface AppRenderInput extends RenderDocumentInput {
  environmentRevision: number;
}

interface RenderArtifact {
  ticket: RenderTicket;
  texture: PooledTexture;
  width: number;
  height: number;
}

export class ExactRenderUnavailableError extends Error {
  readonly code = 'RENDER_SUPERSEDED' as const;
  readonly recoverable = true;

  constructor(readonly ticket: RenderTicket) {
    super(
      `Rendered artifact for revision ${ticket.revision}, attempt ${ticket.attempt} is no longer available.`,
    );
    this.name = 'ExactRenderUnavailableError';
  }
}

export const appRenderCoordinator = new RenderCoordinator<AppRenderInput>({
  defaultDeadlineMs: DEFAULT_AGENT_LIMITS.renderDeadlineMs,
});

const evaluators = new Map<string, Evaluator>();
let gpu: GpuContext | null = null;
let renderCanvases: readonly [HTMLCanvasElement, HTMLCanvasElement] | null = null;
let displayedCanvasIndex: 0 | 1 | null = null;
let artifact: RenderArtifact | null = null;
let rendererCleanup: (() => Promise<boolean>) | null = null;
let rendererResume: ((
  options: { onDeviceLost?: (error: Error) => void },
) => (() => Promise<boolean>)) | null = null;
let rendererForceTeardown: (() => Promise<void>) | null = null;
let unsubscribeStore: (() => void) | null = null;
let environmentRevision = 0;
let storeBindingStarted = false;
let onDeviceLostCallback: ((error: Error) => void) | null = null;
let gpuOperationTail: Promise<void> = Promise.resolve();

function sameTicket(left: RenderTicket, right: RenderTicket): boolean {
  return left.revision === right.revision && left.attempt === right.attempt;
}

function isUnsafeGpuAttempt(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ((error as { gpuAttemptTainted?: unknown }).gpuAttemptTainted === true) {
    return true;
  }
  const kind = (error as { details?: { kind?: unknown } }).details?.kind;
  return typeof kind === 'string'
    && kind.startsWith('gpu-')
    && kind !== 'gpu-device-lost';
}

async function withGpuLock<T>(
  control: CookControl,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = gpuOperationTail.catch(() => {});
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  gpuOperationTail = previous.then(() => gate);
  try {
    await waitForCookControl(previous, control);
    return await operation();
  } finally {
    release();
  }
}

function scheduleState(
  state: ReturnType<typeof useApp.getState>,
  reason: 'document' | 'environment' | 'retry',
): RenderTicket {
  const input: AppRenderInput = {
    document: state.doc,
    fonts: new Map(Object.entries(state.fonts)),
    environmentRevision,
  };
  return appRenderCoordinator.schedule(state.revision, input, {
    dedupeKey: `${state.revision}:${environmentRevision}:${reason}`,
  });
}

export function startRenderStoreBinding(): void {
  if (storeBindingStarted) return;
  storeBindingStarted = true;
  unsubscribeStore = useApp.subscribe((state, previous) => {
    if (
      state.revision === previous.revision
      && state.doc === previous.doc
      && state.fonts === previous.fonts
    ) return;
    const fontsChanged = state.fonts !== previous.fonts;
    if (fontsChanged) environmentRevision++;
    scheduleState(
      state,
      fontsChanged && state.revision === previous.revision
        ? 'environment'
        : 'document',
    );
  });
  // Subscribe first: a synchronous coordinator listener is allowed to trigger
  // a store edit while this initial schedule notifies observers.
  scheduleState(useApp.getState(), 'document');
}

export function stopRenderStoreBinding(): void {
  unsubscribeStore?.();
  unsubscribeStore = null;
  storeBindingStarted = false;
}

export function setRenderCanvases(
  next: readonly [HTMLCanvasElement, HTMLCanvasElement] | null,
): void {
  renderCanvases = next;
  if (!next) displayedCanvasIndex = null;
}

export function getDisplayedCanvasIndex(): 0 | 1 | null {
  return displayedCanvasIndex;
}

export function configureAppRenderer(
  nextGpu: GpuContext,
  options: { onDeviceLost?: (error: Error) => void } = {},
): () => Promise<boolean> {
  if (gpu === nextGpu && rendererResume) {
    return rendererResume(options);
  }
  if (gpu || rendererCleanup) {
    throw new Error('An App renderer is already configured.');
  }
  // A physical renderer generation owns different GPU resources even if the
  // document revision did not change. This forces a fresh attempt instead of
  // deduping against a terminal ticket from the previous device/canvas pair.
  environmentRevision++;
  gpu = nextGpu;
  onDeviceLostCallback = options.onDeviceLost ?? null;
  const configuredGpu = nextGpu;

  const run = async (
    job: RenderJob<AppRenderInput>,
  ): Promise<RenderExecutionResult> => withGpuLock(job, async () => {
    throwIfCookInterrupted(job);
    const poolCheckpoint = configuredGpu.pool.checkpoint();
    // The canvas swapchain already contains the last-known-good pixels. Once a
    // newer attempt owns the GPU lock, its old composite is no longer a valid
    // current-document export and can be released before frame-size churn
    // needs a second generation of evaluator textures.
    if (artifact && !sameTicket(artifact.ticket, job.ticket)) {
      configuredGpu.pool.release(artifact.texture);
      artifact = null;
    }
    const attempt: { candidate: RenderedDocument | null } = {
      candidate: null,
    };
    const gpuControl = {
      ...job,
      maxGpuPasses: DEFAULT_AGENT_LIMITS.maxGpuPasses,
      maxGpuPixelWork: DEFAULT_AGENT_LIMITS.maxGpuPixelWork,
    };
    const gpuWorkBudget = new GpuWorkBudget(gpuControl);
    const attemptGpuControl = { ...gpuControl, gpuWorkBudget };
    try {
      const rendered = await configuredGpu.captureErrors(
        `cook-r${job.revision}-a${job.attempt}`,
        async () => {
          const output = await renderDocument(job.input, {
            ticket: job.ticket,
            gpu: configuredGpu,
            evaluators,
            signal: job.signal,
            deadline: job.deadline,
            limits: DEFAULT_AGENT_LIMITS,
            gpuWorkBudget,
          });
          attempt.candidate = output;
          return output;
        },
        job,
      );

      // Do not touch the last-known-good canvas until every offscreen cook
      // command has completed and its error scopes are clean.
      throwIfCookInterrupted(job);
      const canvasPair = renderCanvases;
      const stagedCanvasIndex: 0 | 1 = displayedCanvasIndex === 0 ? 1 : 0;
      const target = canvasPair?.[stagedCanvasIndex] ?? null;
      if (target) {
        await configuredGpu.captureErrors(
          `present-r${job.revision}-a${job.attempt}`,
          async () => {
            throwIfCookInterrupted(job);
            target.width = rendered.width;
            target.height = rendered.height;
            configuredGpu.present(
              rendered.texture,
              target,
              attemptGpuControl,
            );
          },
          job,
        );
        throwIfCookInterrupted(job);
        if (renderCanvases !== canvasPair) {
          throw new CookCancelledError(job.revision);
        }
      }

      let published = false;
      let reclaimed = false;
      return {
        width: rendered.width,
        height: rendered.height,
        events: rendered.events,
        publish: () => {
          if (published || reclaimed) return;
          rendered.commit();
          const previous = artifact;
          artifact = {
            ticket: { ...job.ticket },
            texture: rendered.texture,
            width: rendered.width,
            height: rendered.height,
          };
          if (target) displayedCanvasIndex = stagedCanvasIndex;
          if (previous) configuredGpu.pool.release(previous.texture);
          published = true;
        },
        rollback: () => {
          if (published || reclaimed) return;
          reclaimed = true;
          rendered.rollback();
          try {
            configuredGpu.pool.release(rendered.texture);
          } catch {
            // Device loss already invalidated the owning pool.
          }
        },
      };
    } catch (error) {
      const candidate = attempt.candidate;
      if (candidate) {
        candidate.rollback();
        try {
          configuredGpu.pool.release(candidate.texture);
        } catch {
          // Device loss invalidates the old pool and makes late release a no-op.
        }
      }
      if (isUnsafeGpuAttempt(error)) {
        configuredGpu.quarantineFailedAttempt(poolCheckpoint);
      }
      throw error;
    }
  });
  appRenderCoordinator.setExecutor(run);

  let teardownPromise: Promise<void> | null = null;
  let pendingTeardown: symbol | null = null;
  let unsubscribeLoss = () => {};
  const beginTeardown = (reason?: Error): Promise<void> => {
    if (teardownPromise) return teardownPromise;
    pendingTeardown = null;
    appRenderCoordinator.clearExecutor(run);
    appRenderCoordinator.cancelPending(reason);
    unsubscribeLoss();
    if (gpu === configuredGpu) {
      gpu = null;
      onDeviceLostCallback = null;
    }
    teardownPromise = appRenderCoordinator.whenIdle()
      .then(() => {
        releaseRendererResources(configuredGpu);
      })
      .finally(() => {
        if (rendererCleanup === cleanup) rendererCleanup = null;
        if (rendererResume === resume) rendererResume = null;
        if (rendererForceTeardown === forceTeardown) {
          rendererForceTeardown = null;
        }
      });
    return teardownPromise;
  };
  const cleanup = (): Promise<boolean> => {
    const token = Symbol('renderer-teardown');
    pendingTeardown = token;
    // React StrictMode cleanup/setup occurs synchronously. Give the matching
    // setup one microtask to resume the same renderer without aborting its
    // active job or disposing its device.
    return Promise.resolve().then(async () => {
      if (pendingTeardown !== token) return false;
      pendingTeardown = null;
      await beginTeardown();
      return true;
    });
  };
  const resume = (
    resumedOptions: { onDeviceLost?: (error: Error) => void },
  ): (() => Promise<boolean>) => {
    if (teardownPromise) {
      throw new Error('The previous App renderer is still draining.');
    }
    pendingTeardown = null;
    onDeviceLostCallback = resumedOptions.onDeviceLost ?? null;
    return cleanup;
  };
  const forceTeardown = (): Promise<void> => beginTeardown();
  rendererCleanup = cleanup;
  rendererResume = resume;
  rendererForceTeardown = forceTeardown;
  unsubscribeLoss = nextGpu.onDeviceLost((error) => {
    const callback = onDeviceLostCallback;
    void beginTeardown(error);
    callback?.(error);
  });

  return cleanup;
}

export function retryCurrentRender(): RenderTicket {
  environmentRevision++;
  return scheduleState(useApp.getState(), 'retry');
}

export async function readbackExact(
  ticket: RenderTicket,
  control: Omit<CookControl, 'revision'> = {},
): Promise<ImageData> {
  const status = await appRenderCoordinator.awaitRender(ticket);
  if (status.state !== 'complete') {
    if (status.error) {
      throw Object.assign(new Error(status.error.message), status.error);
    }
    throw new ExactRenderUnavailableError(ticket);
  }
  const readbackControl: CookControl = {
    ...control,
    revision: ticket.revision,
    deadline: control.deadline
      ?? performance.now() + DEFAULT_AGENT_LIMITS.renderDeadlineMs,
  };
  return withGpuLock(
    readbackControl,
    async () => {
      const activeGpu = gpu;
      const exact = artifact;
      if (!activeGpu || !exact || !sameTicket(exact.ticket, ticket)) {
        throw new ExactRenderUnavailableError(ticket);
      }
      // The public method never exposes the GPU handle. Retain atomically
      // inside the GPU lock before the first readback await.
      activeGpu.pool.retain(exact.texture);
      try {
        return await activeGpu.captureErrors(
          `readback-r${ticket.revision}-a${ticket.attempt}`,
          () => activeGpu.readback(exact.texture, readbackControl),
          readbackControl,
        );
      } finally {
        activeGpu.pool.release(exact.texture);
      }
    },
  );
}

export function currentArtifactTicket(): RenderTicket | null {
  return artifact ? { ...artifact.ticket } : null;
}

export function getAppRenderStatus(): RenderStatus {
  return appRenderCoordinator.getRenderStatus();
}

export function disposeAppRenderer(): Promise<void> {
  stopRenderStoreBinding();
  setRenderCanvases(null);
  const teardown = rendererForceTeardown;
  if (teardown) return teardown();
  return Promise.resolve();
}

function releaseRendererResources(activeGpu: GpuContext): void {
  if (artifact) {
    try {
      activeGpu.pool.release(artifact.texture);
    } catch {
      // The pool may already be invalidated by device loss.
    }
    artifact = null;
  }
  disposeEvaluators(evaluators, activeGpu);
  resetTraceWorker(new CookCancelledError());
  resetBooleanWorker(new CookCancelledError());
}

// Development-only, read-only observability for the real WebGPU smoke suite.
// The public Agent boundary lands in PR 5 and must not expose the coordinator,
// Zustand, GPU handles, or arbitrary callbacks.
if (import.meta.env?.DEV) {
  (globalThis as Record<string, unknown>).__render = Object.freeze({
    getStatus: (request: number | RenderStatusRequest = {}) =>
      appRenderCoordinator.getRenderStatus(request),
    awaitRender: (request: AwaitRenderRequest) =>
      appRenderCoordinator.awaitRender(request),
    getPoolStats: () => gpu?.pool.stats() ?? null,
  });
}
