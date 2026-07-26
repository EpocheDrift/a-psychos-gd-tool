import { describe, expect, it, vi } from 'vitest';
import type { Doc } from '../engine/graph';
import type { GpuContext } from '../gpu/device';
import type { PooledTexture } from '../gpu/pool';
import { useApp } from '../store';
import {
  appRenderCoordinator,
  configureAppRenderer,
  currentArtifactTicket,
  getDisplayedCanvasIndex,
  readbackExact,
  setRenderCanvases,
  startRenderStoreBinding,
  stopRenderStoreBinding,
} from './appRenderService';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function minimalDocument(): Doc {
  return {
    frame: { width: 16, height: 16 },
    layers: [{
      id: 'layer',
      name: 'Layer',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      graph: {
        nodes: {
          out: {
            id: 'out',
            type: 'Output',
            params: { transparent: true, background: '#ffffff' },
          },
        },
        edges: [],
      },
    }],
  };
}

function fakeGpu(completion: Promise<void>) {
  let sequence = 0;
  let captureCall = 0;
  const captureFailures = new Set<number>();
  const refs = new Map<PooledTexture, number>();
  const pool = {
    checkpoint: vi.fn(() => sequence),
    quarantineSince: vi.fn(),
    acquire: vi.fn((width: number, height: number) => {
      const texture: PooledTexture = {
        texture: { id: ++sequence } as unknown as GPUTexture,
        width,
        height,
        format: 'rgba8unorm',
        estimatedBytes: width * height * 4,
      };
      refs.set(texture, 1);
      return texture;
    }),
    retain: vi.fn((texture: PooledTexture) => {
      refs.set(texture, (refs.get(texture) ?? 0) + 1);
    }),
    release: vi.fn((texture: PooledTexture) => {
      refs.set(texture, Math.max(0, (refs.get(texture) ?? 0) - 1));
    }),
    discard: vi.fn((texture: PooledTexture) => {
      refs.set(texture, 0);
    }),
    stats: vi.fn(() => ({
      allocated: refs.size,
      free: [...refs.values()].filter((count) => count === 0).length,
      live: [...refs.values()].filter((count) => count > 0).length,
    })),
  };
  const image = {
    data: new Uint8ClampedArray(16 * 16 * 4),
    width: 16,
    height: 16,
    colorSpace: 'srgb',
  } as ImageData;
  const gpu = {
    pool,
    clear: vi.fn(),
    runPass: vi.fn(),
    present: vi.fn(),
    captureErrors: vi.fn(async (
      _stage: string,
      operation: () => Promise<unknown>,
    ) => {
      const call = ++captureCall;
      const value = await operation();
      await completion;
      if (captureFailures.has(call)) {
        throw Object.assign(new Error('simulated GPU validation failure'), {
          code: 'RENDER_FAILED',
          recoverable: true,
          details: { kind: 'gpu-validation', stage: _stage },
        });
      }
      return value;
    }),
    readback: vi.fn(async () => image),
    quarantineFailedAttempt: vi.fn(),
    onDeviceLost: vi.fn(() => () => {}),
  } as unknown as GpuContext;
  return { gpu, pool, image, captureFailures };
}

describe('App render service integration', () => {
  it('publishes complete only after GPU completion and readbacks the exact artifact', async () => {
    const original = useApp.getState();
    const submitted = deferred();
    const { gpu, pool, image } = fakeGpu(submitted.promise);
    const canvases = [
      { width: 0, height: 0 },
      { width: 0, height: 0 },
    ] as unknown as [HTMLCanvasElement, HTMLCanvasElement];
    useApp.setState({
      doc: minimalDocument(),
      revision: original.revision + 1,
      fonts: {},
    });
    setRenderCanvases(canvases);
    const cleanup = configureAppRenderer(gpu);
    startRenderStoreBinding();
    const ticket = appRenderCoordinator.getRenderStatus().ticket!;
    const waiting = appRenderCoordinator.awaitRender(ticket);

    await vi.waitFor(() => {
      expect(
        (gpu.captureErrors as ReturnType<typeof vi.fn>),
      ).toHaveBeenCalledOnce();
    });
    // The offscreen cook must be GPU-complete before a failed attempt can
    // touch the last-known-good canvas.
    expect((gpu.present as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(appRenderCoordinator.getRenderStatus(ticket).state).toBe('cooking');

    submitted.resolve();
    await expect(waiting).resolves.toMatchObject({
      ticket,
      displayedTicket: ticket,
      state: 'complete',
    });
    expect((gpu.present as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect(
      (gpu.captureErrors as ReturnType<typeof vi.fn>),
    ).toHaveBeenCalledTimes(2);
    expect(currentArtifactTicket()).toEqual(ticket);
    await expect(readbackExact(ticket)).resolves.toBe(image);
    expect(pool.retain).toHaveBeenCalledOnce();

    stopRenderStoreBinding();
    await cleanup();
    setRenderCanvases(null);
    useApp.setState({
      doc: original.doc,
      // Keep the process-local coordinator's monotonic revision invariant.
      revision: original.revision + 1,
      fonts: original.fonts,
    });
  });

  it('cancels a deferred StrictMode cleanup when the same renderer resumes synchronously', async () => {
    const original = useApp.getState();
    const submitted = deferred();
    submitted.resolve();
    const { gpu } = fakeGpu(submitted.promise);
    const canvases = [
      { width: 0, height: 0 },
      { width: 0, height: 0 },
    ] as unknown as [HTMLCanvasElement, HTMLCanvasElement];
    useApp.setState({
      doc: minimalDocument(),
      revision: original.revision + 1,
      fonts: {},
    });
    setRenderCanvases(canvases);
    const cleanup = configureAppRenderer(gpu);
    startRenderStoreBinding();
    await appRenderCoordinator.awaitRender(
      appRenderCoordinator.getRenderStatus().ticket!,
    );

    stopRenderStoreBinding();
    const strictCleanup = cleanup();
    const resumedCleanup = configureAppRenderer(gpu);
    await expect(strictCleanup).resolves.toBe(false);
    startRenderStoreBinding();
    stopRenderStoreBinding();
    await expect(resumedCleanup()).resolves.toBe(true);

    setRenderCanvases(null);
    useApp.setState({
      doc: original.doc,
      revision: original.revision + 1,
      fonts: original.fonts,
    });
  });

  it('keeps the visible canvas slot unchanged when staged presentation fails', async () => {
    const original = useApp.getState();
    const submitted = deferred();
    submitted.resolve();
    const {
      gpu,
      captureFailures,
    } = fakeGpu(submitted.promise);
    const canvases = [
      { width: 0, height: 0 },
      { width: 0, height: 0 },
    ] as unknown as [HTMLCanvasElement, HTMLCanvasElement];
    useApp.setState({
      doc: minimalDocument(),
      revision: original.revision + 1,
      fonts: {},
    });
    setRenderCanvases(canvases);
    const cleanup = configureAppRenderer(gpu);
    startRenderStoreBinding();
    const first = appRenderCoordinator.getRenderStatus().ticket!;
    await appRenderCoordinator.awaitRender(first);
    const visibleBefore = getDisplayedCanvasIndex();
    expect(visibleBefore).not.toBeNull();

    // Initial cook/present are calls 1/2; fail only the next staged present.
    captureFailures.add(4);
    const state = useApp.getState();
    state.setFrame({ ...state.doc.frame, width: 17 });
    const second = appRenderCoordinator.getRenderStatus().ticket!;
    await expect(appRenderCoordinator.awaitRender(second)).resolves.toMatchObject({
      state: 'failed',
      displayedTicket: first,
      error: {
        code: 'RENDER_FAILED',
        details: { kind: 'gpu-validation' },
      },
    });
    expect(getDisplayedCanvasIndex()).toBe(visibleBefore);
    expect(currentArtifactTicket()).toBeNull();
    expect(
      (gpu.quarantineFailedAttempt as ReturnType<typeof vi.fn>),
    ).toHaveBeenCalledOnce();

    stopRenderStoreBinding();
    await cleanup();
    setRenderCanvases(null);
    useApp.setState({
      doc: original.doc,
      revision: useApp.getState().revision,
      fonts: original.fonts,
    });
  });

  it('does not release renderer-owned state until an aborted executor drains', async () => {
    const original = useApp.getState();
    const submitted = deferred();
    const { gpu, pool } = fakeGpu(submitted.promise);
    const canvases = [
      { width: 0, height: 0 },
      { width: 0, height: 0 },
    ] as unknown as [HTMLCanvasElement, HTMLCanvasElement];
    useApp.setState({
      doc: minimalDocument(),
      revision: original.revision + 1,
      fonts: {},
    });
    setRenderCanvases(canvases);
    const cleanup = configureAppRenderer(gpu);
    startRenderStoreBinding();
    const ticket = appRenderCoordinator.getRenderStatus().ticket!;
    const terminal = appRenderCoordinator.awaitRender(ticket);
    await vi.waitFor(() => {
      expect(
        (gpu.captureErrors as ReturnType<typeof vi.fn>),
      ).toHaveBeenCalledOnce();
    });
    const releasesBefore = pool.release.mock.calls.length;

    stopRenderStoreBinding();
    const draining = cleanup();
    await Promise.resolve();
    await expect(terminal).resolves.toMatchObject({ state: 'superseded' });
    let drained = false;
    void draining.then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    expect(pool.release).toHaveBeenCalledTimes(releasesBefore);

    submitted.resolve();
    await expect(draining).resolves.toBe(true);
    expect(pool.release.mock.calls.length).toBeGreaterThan(releasesBefore);

    setRenderCanvases(null);
    useApp.setState({
      doc: original.doc,
      revision: original.revision + 1,
      fonts: original.fonts,
    });
  });
});
