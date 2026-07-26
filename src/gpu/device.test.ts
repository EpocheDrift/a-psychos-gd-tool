import { describe, expect, it, vi } from 'vitest';
import { CookCancelledError } from '../engine/cookControl';
import { GpuContext } from './device';
import type { PooledTexture } from './pool';

(globalThis as Record<string, unknown>).GPUTextureUsage ??= {
  TEXTURE_BINDING: 4,
  RENDER_ATTACHMENT: 16,
  COPY_DST: 2,
  COPY_SRC: 1,
};
(globalThis as Record<string, unknown>).GPUBufferUsage ??= {
  UNIFORM: 64,
  COPY_DST: 2,
  MAP_READ: 1,
};
(globalThis as Record<string, unknown>).GPUMapMode ??= { READ: 1 };

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FakeBuffer {
  map: ReturnType<typeof deferred<void>>;
  mapAsync: ReturnType<typeof vi.fn>;
  getMappedRange: ReturnType<typeof vi.fn>;
  unmap: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

function fakeDevice(options: { submittedImmediately?: boolean } = {}) {
  const submitted = deferred<void>();
  if (options.submittedImmediately) submitted.resolve();
  const lost = deferred<GPUDeviceLostInfo>();
  const buffers: FakeBuffer[] = [];
  const textures: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const listeners = new Map<string, EventListener>();
  const popResults: Array<GPUError | null> = [];
  const device = {
    lost: lost.promise,
    queue: {
      submit: vi.fn(),
      onSubmittedWorkDone: vi.fn(() => submitted.promise),
    },
    createSampler: vi.fn(() => ({})),
    createBuffer: vi.fn(() => {
      const map = deferred<void>();
      const buffer: FakeBuffer = {
        map,
        mapAsync: vi.fn(() => map.promise),
        getMappedRange: vi.fn(() => new ArrayBuffer(256)),
        unmap: vi.fn(),
        destroy: vi.fn(),
      };
      buffers.push(buffer);
      return buffer;
    }),
    createTexture: vi.fn(() => {
      const texture = { destroy: vi.fn() };
      textures.push(texture);
      return texture;
    }),
    createCommandEncoder: vi.fn(() => ({
      copyTextureToBuffer: vi.fn(),
      finish: vi.fn(() => ({})),
    })),
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => popResults.shift() ?? null),
    addEventListener: vi.fn((name: string, listener: EventListener) => {
      listeners.set(name, listener);
    }),
    removeEventListener: vi.fn((name: string) => {
      listeners.delete(name);
    }),
    destroy: vi.fn(),
  };
  return {
    device: device as unknown as GPUDevice,
    submitted,
    lost,
    buffers,
    textures,
    listeners,
    popResults,
    raw: device,
  };
}

function texture(): PooledTexture {
  return {
    texture: {} as GPUTexture,
    width: 1,
    height: 1,
    format: 'rgba8unorm',
    estimatedBytes: 4,
  };
}

describe('GpuContext lifecycle', () => {
  it('does not report completion before queue.onSubmittedWorkDone', async () => {
    const fake = fakeDevice();
    const gpu = GpuContext.fromDevice(fake.device);
    const observed = vi.fn();
    const waiting = gpu.waitForSubmittedWorkDone().then(observed);
    await Promise.resolve();
    expect(observed).not.toHaveBeenCalled();
    fake.submitted.resolve();
    await waiting;
    expect(observed).toHaveBeenCalledOnce();
  });

  it('destroys the readback buffer exactly once when mapAsync fails', async () => {
    const fake = fakeDevice();
    const gpu = GpuContext.fromDevice(fake.device);
    const reading = gpu.readback(texture());
    const staging = fake.buffers[1];
    staging.map.reject(new Error('map failed'));
    await expect(reading).rejects.toThrow('map failed');
    expect(staging.destroy).toHaveBeenCalledTimes(1);
    expect(staging.unmap).not.toHaveBeenCalled();
  });

  it('destroys the staging buffer and rejects when a readback is aborted', async () => {
    const fake = fakeDevice();
    const gpu = GpuContext.fromDevice(fake.device);
    const controller = new AbortController();
    const reading = gpu.readback(texture(), { signal: controller.signal });
    const rejected = expect(reading).rejects.toBeInstanceOf(CookCancelledError);
    controller.abort(new CookCancelledError(1));
    await rejected;
    expect(fake.buffers[1].destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the staging buffer when command encoding throws synchronously', async () => {
    const fake = fakeDevice();
    fake.raw.createCommandEncoder.mockImplementationOnce(() => {
      throw new Error('encoder failed');
    });
    const gpu = GpuContext.fromDevice(fake.device);
    await expect(gpu.readback(texture())).rejects.toThrow('encoder failed');
    expect(fake.buffers[1].destroy).toHaveBeenCalledTimes(1);
    expect(fake.buffers[1].unmap).not.toHaveBeenCalled();
  });

  it('maps out-of-memory error scopes to a stable resource error', async () => {
    const fake = fakeDevice({ submittedImmediately: true });
    fake.popResults.push(
      null,
      {} as GPUError,
      null,
    );
    const gpu = GpuContext.fromDevice(fake.device);
    await expect(gpu.captureErrors('render', async () => 42)).rejects.toEqual(
      expect.objectContaining({
        code: 'RESOURCE_LIMIT',
        details: { kind: 'gpu-out-of-memory', stage: 'render' },
      }),
    );
  });

  it('taints an aborted attempt when error-scope results cannot be observed', async () => {
    const fake = fakeDevice({ submittedImmediately: true });
    fake.raw.popErrorScope.mockImplementation(
      () => new Promise<GPUError | null>(() => {}),
    );
    const gpu = GpuContext.fromDevice(fake.device);
    const controller = new AbortController();
    await expect(gpu.captureErrors(
      'render',
      async () => {
        const error = new CookCancelledError(7);
        controller.abort(error);
        throw error;
      },
      { signal: controller.signal, revision: 7 },
    )).rejects.toMatchObject({
      code: 'RENDER_SUPERSEDED',
      gpuAttemptTainted: true,
    });
    expect(fake.raw.popErrorScope).toHaveBeenCalledTimes(3);
  });

  it('drops shared sampler/uniform state after an unsafe GPU attempt', () => {
    const fake = fakeDevice({ submittedImmediately: true });
    const gpu = GpuContext.fromDevice(fake.device);
    expect(fake.raw.createSampler).toHaveBeenCalledTimes(1);
    expect(fake.raw.createBuffer).toHaveBeenCalledTimes(1);

    gpu.quarantineFailedAttempt(gpu.pool.checkpoint());
    expect(fake.buffers[0].destroy).toHaveBeenCalledOnce();

    const internals = gpu as unknown as {
      ensureSharedResources(): unknown;
    };
    internals.ensureSharedResources();
    expect(fake.raw.createSampler).toHaveBeenCalledTimes(2);
    expect(fake.raw.createBuffer).toHaveBeenCalledTimes(2);
  });

  it('invalidates the old pool and notifies listeners on device loss', async () => {
    const fake = fakeDevice();
    const gpu = GpuContext.fromDevice(fake.device);
    gpu.pool.acquire(1, 1);
    const listener = vi.fn();
    gpu.onDeviceLost(listener);
    fake.lost.resolve({
      reason: 'unknown',
      message: 'adapter reset',
    } as GPUDeviceLostInfo);
    await fake.lost.promise;
    await Promise.resolve();
    expect(listener).toHaveBeenCalledOnce();
    expect(gpu.pool.stats()).toMatchObject({
      allocated: 0,
      totalBytes: 0,
    });
    expect(fake.textures[0].destroy).toHaveBeenCalledTimes(1);
    await expect(gpu.waitForSubmittedWorkDone()).rejects.toMatchObject({
      code: 'RENDER_FAILED',
      details: { kind: 'gpu-device-lost' },
    });
  });
});
