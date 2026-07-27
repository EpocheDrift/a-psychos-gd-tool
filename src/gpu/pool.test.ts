import { describe, expect, it, vi } from 'vitest';
import {
  estimateTextureBytes,
  TexturePool,
  TexturePoolInvariantError,
  type TextureFactory,
} from './pool';
import { CookResourceLimitError } from '../engine/cookControl';

(globalThis as Record<string, unknown>).GPUTextureUsage ??= {
  TEXTURE_BINDING: 4,
  RENDER_ATTACHMENT: 16,
  COPY_DST: 2,
  COPY_SRC: 1,
};

interface FakeTexture extends GPUTexture {
  destroy: ReturnType<typeof vi.fn>;
}

function fakeDevice(): TextureFactory & {
  created: FakeTexture[];
  descriptors: GPUTextureDescriptor[];
  error: Error | null;
} {
  const factory = {
    created: [] as FakeTexture[],
    descriptors: [] as GPUTextureDescriptor[],
    error: null as Error | null,
    createTexture(desc: GPUTextureDescriptor): GPUTexture {
      if (factory.error) throw factory.error;
      const texture = { destroy: vi.fn() } as unknown as FakeTexture;
      factory.created.push(texture);
      factory.descriptors.push(desc);
      return texture;
    },
  };
  return factory;
}

describe('TexturePool', () => {
  it('recycles released textures without exposing mutable refcounts', () => {
    const device = fakeDevice();
    const pool = new TexturePool(device);
    const first = pool.acquire(256, 256);
    expect(Object.isFrozen(first)).toBe(true);
    pool.release(first);
    const recycled = pool.acquire(256, 256);
    expect(recycled).toBe(first);
    expect(device.created).toHaveLength(1);
  });

  it('tracks current counts and exact live/free bytes', () => {
    const pool = new TexturePool(fakeDevice());
    const small = pool.acquire(2, 2);
    pool.acquire(4, 4);
    pool.release(small);
    expect(pool.stats()).toMatchObject({
      allocated: 2,
      free: 1,
      live: 1,
      totalBytes: 80,
      freeBytes: 16,
      liveBytes: 64,
      peakBytes: 80,
      created: 2,
    });
  });

  it('retain keeps a texture live across one release', () => {
    const pool = new TexturePool(fakeDevice());
    const first = pool.acquire(4, 4);
    pool.retain(first);
    pool.release(first);
    expect(pool.stats()).toMatchObject({ live: 1, free: 0 });
    expect(pool.acquire(4, 4)).not.toBe(first);
    pool.release(first);
    expect(pool.stats().free).toBe(1);
  });

  it('rejects double release and free-handle resurrection', () => {
    const pool = new TexturePool(fakeDevice());
    const texture = pool.acquire(4, 4);
    pool.release(texture);
    expect(() => pool.release(texture)).toThrow(TexturePoolInvariantError);
    expect(() => pool.retain(texture)).toThrow(TexturePoolInvariantError);
  });

  it('accounts known formats and rejects unknown/overflowing sizes', () => {
    expect(estimateTextureBytes(3, 5, 'rgba8unorm')).toBe(60);
    expect(estimateTextureBytes(3, 5, 'rgba16float')).toBe(120);
    expect(() => estimateTextureBytes(
      1,
      1,
      'depth24plus' as GPUTextureFormat,
    )).toThrow(/no deterministic byte-accounting/);
    expect(() => estimateTextureBytes(
      Number.MAX_SAFE_INTEGER,
      2,
      'rgba8unorm',
    )).toThrow(/safe integer/);
  });

  it('evicts the globally oldest free texture and destroys exactly once', () => {
    const device = fakeDevice();
    const pool = new TexturePool(device, {
      maxBytes: 128,
      maxFreeBytes: 40,
      maxTextures: 8,
    });
    const oldest = pool.acquire(2, 2); // 16 B
    const newest = pool.acquire(3, 3); // 36 B
    pool.release(oldest);
    pool.release(newest); // 52 B: oldest is evicted
    expect(device.created[0].destroy).toHaveBeenCalledTimes(1);
    expect(device.created[1].destroy).not.toHaveBeenCalled();
    expect(pool.stats()).toMatchObject({
      allocated: 1,
      free: 1,
      freeBytes: 36,
      evicted: 1,
    });
    pool.dispose();
    pool.dispose();
    expect(device.created[0].destroy).toHaveBeenCalledTimes(1);
    expect(device.created[1].destroy).toHaveBeenCalledTimes(1);
  });

  it('evicts free textures before allocation and rejects pressure from live textures', () => {
    const device = fakeDevice();
    const pool = new TexturePool(device, {
      maxBytes: 64,
      maxFreeBytes: 64,
      maxTextures: 4,
    });
    const large = pool.acquire(4, 4);
    pool.release(large);
    const replacement = pool.acquire(2, 2);
    expect(device.created[0].destroy).toHaveBeenCalledTimes(1);
    expect(replacement).not.toBe(large);

    expect(() => pool.acquire(4, 4)).toThrow(CookResourceLimitError);
    expect(pool.stats().totalBytes).toBeLessThanOrEqual(64);
  });

  it('does not change statistics when createTexture throws', () => {
    const device = fakeDevice();
    const pool = new TexturePool(device);
    device.error = new Error('device lost during create');
    expect(() => pool.acquire(4, 4)).toThrow('device lost');
    expect(pool.stats()).toMatchObject({
      allocated: 0,
      totalBytes: 0,
      created: 0,
      evicted: 0,
    });
  });

  it('rejects cross-pool handles and safely ignores late release after invalidation', () => {
    const first = new TexturePool(fakeDevice());
    const second = new TexturePool(fakeDevice());
    const texture = first.acquire(4, 4);
    expect(() => second.release(texture)).toThrow(/does not belong/);
    first.invalidate();
    expect(() => first.release(texture)).not.toThrow();
    expect(() => first.acquire(1, 1)).toThrow(/invalidated/);
  });

  it('keeps repeated frame-size churn inside both budgets', () => {
    const device = fakeDevice();
    const pool = new TexturePool(device, {
      maxBytes: 16 * 1024,
      maxFreeBytes: 4 * 1024,
      maxTextures: 16,
    });
    for (let size = 8; size < 108; size++) {
      const texture = pool.acquire(size, 8);
      pool.release(texture);
      const stats = pool.stats();
      expect(stats.totalBytes).toBeLessThanOrEqual(stats.maxBytes);
      expect(stats.freeBytes).toBeLessThanOrEqual(stats.maxFreeBytes);
      expect(stats.allocated).toBeLessThanOrEqual(stats.maxTextures);
    }
    expect(device.created.some((texture) =>
      texture.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('enforces the texture-count cap independently of byte capacity', () => {
    const pool = new TexturePool(fakeDevice(), {
      maxBytes: 1024,
      maxFreeBytes: 1024,
      maxTextures: 1,
    });
    pool.acquire(1, 1);
    expect(() => pool.acquire(1, 1)).toThrow(CookResourceLimitError);
  });

  it('quarantines live and free textures created by one failed GPU attempt', () => {
    const device = fakeDevice();
    const pool = new TexturePool(device);
    const reusable = pool.acquire(2, 2);
    pool.release(reusable);
    const checkpoint = pool.checkpoint();
    const returned = pool.acquire(3, 3);
    const stillLive = pool.acquire(4, 4);
    pool.release(returned);

    pool.quarantineSince(checkpoint);

    expect(device.created[0].destroy).not.toHaveBeenCalled();
    expect(device.created[1].destroy).toHaveBeenCalledOnce();
    expect(device.created[2].destroy).toHaveBeenCalledOnce();
    expect(pool.stats()).toMatchObject({
      allocated: 1,
      free: 1,
      totalBytes: 16,
    });
    // A finally block racing quarantine is an intentional no-op, while the
    // pre-checkpoint texture remains reusable.
    expect(() => pool.release(stillLive)).not.toThrow();
    expect(pool.acquire(2, 2)).toBe(reusable);
  });
});
