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
  readbackPreviewExact,
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
  const creationSequence = new Map<PooledTexture, number>();
  const pool = {
    checkpoint: vi.fn(() => sequence),
    quarantineSince: vi.fn((checkpoint: number) => {
      for (const [texture, created] of creationSequence) {
        if (created <= checkpoint) continue;
        refs.delete(texture);
        creationSequence.delete(texture);
      }
    }),
    acquire: vi.fn((width: number, height: number) => {
      const recycled = [...refs].find(
        ([texture, count]) => (
          count === 0
          && texture.width === width
          && texture.height === height
        ),
      )?.[0];
      if (recycled) {
        refs.set(recycled, 1);
        return recycled;
      }
      const texture: PooledTexture = {
        texture: { id: ++sequence } as unknown as GPUTexture,
        width,
        height,
        format: 'rgba8unorm',
        estimatedBytes: width * height * 4,
      };
      refs.set(texture, 1);
      creationSequence.set(texture, sequence);
      return texture;
    }),
    retain: vi.fn((texture: PooledTexture) => {
      refs.set(texture, (refs.get(texture) ?? 0) + 1);
    }),
    release: vi.fn((texture: PooledTexture) => {
      if (!refs.has(texture)) return;
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
    readback: vi.fn(async (texture: PooledTexture) => (
      texture.width === 16 && texture.height === 16
        ? image
        : {
            data: new Uint8ClampedArray(texture.width * texture.height * 4),
            width: texture.width,
            height: texture.height,
            colorSpace: 'srgb',
          } as ImageData
    )),
    quarantineFailedAttempt: vi.fn((checkpoint: number) => {
      pool.quarantineSince(checkpoint);
    }),
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

  it('GPU-downsamples before bounded preview readback and releases its lease', async () => {
    const original = useApp.getState();
    const submitted = deferred();
    submitted.resolve();
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
    await appRenderCoordinator.awaitRender(ticket);
    const releasesBefore = pool.release.mock.calls.length;

    await expect(readbackPreviewExact(ticket, 8, 4)).resolves.toMatchObject({
      width: 8,
      height: 4,
    });
    expect(pool.acquire).toHaveBeenLastCalledWith(8, 4);
    expect((gpu.runPass as ReturnType<typeof vi.fn>)).toHaveBeenLastCalledWith(
      'blit',
      expect.objectContaining({ width: 16, height: 16 }),
      expect.objectContaining({ width: 8, height: 4 }),
      undefined,
      expect.objectContaining({
        revision: ticket.revision,
        maxGpuPasses: 2,
        maxGpuPixelWork: 64,
      }),
    );
    expect((gpu.readback as ReturnType<typeof vi.fn>)).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 8, height: 4 }),
      expect.objectContaining({ revision: ticket.revision }),
    );
    // One release returns the temporary; one balances the exact-artifact
    // retain. Renderer ownership remains intact.
    expect(pool.release.mock.calls.length - releasesBefore).toBe(2);

    stopRenderStoreBinding();
    await cleanup();
    setRenderCanvases(null);
    useApp.setState({
      doc: original.doc,
      revision: original.revision + 1,
      fonts: original.fonts,
    });
  });

  it('releases a recycled preview target after an unsafe GPU failure', async () => {
    const original = useApp.getState();
    const submitted = deferred();
    submitted.resolve();
    const { gpu, pool, captureFailures } = fakeGpu(submitted.promise);
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
    await appRenderCoordinator.awaitRender(ticket);

    await readbackPreviewExact(ticket, 8, 4);
    const afterSuccess = pool.stats();
    const recycledTarget = pool.acquire.mock.results.at(-1)?.value;
    expect(recycledTarget).toMatchObject({ width: 8, height: 4 });

    // Cook/present are capture calls 1/2 and the first preview is call 3.
    // Call 4 reuses the free target created before its checkpoint, so
    // quarantine cannot destroy it and the finally block must release it.
    captureFailures.add(4);
    await expect(readbackPreviewExact(ticket, 8, 4)).rejects.toThrow(
      'simulated GPU validation failure',
    );
    expect(pool.acquire.mock.results.at(-1)?.value).toBe(recycledTarget);
    expect(pool.stats()).toEqual(afterSuccess);
    expect(
      (gpu.quarantineFailedAttempt as ReturnType<typeof vi.fn>),
    ).toHaveBeenCalled();

    stopRenderStoreBinding();
    await cleanup();
    setRenderCanvases(null);
    useApp.setState({
      doc: original.doc,
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
