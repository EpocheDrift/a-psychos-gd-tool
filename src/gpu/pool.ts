// Ref-counted, byte-bounded GPU texture pool. Public handles expose immutable
// texture facts; ownership/refcounts/state stay private so a stale or foreign
// handle cannot be silently resurrected.

import { DEFAULT_AGENT_LIMITS } from '../domain/limits';
import { CookResourceLimitError } from '../engine/cookControl';

export interface PooledTexture {
  readonly texture: GPUTexture;
  readonly width: number;
  readonly height: number;
  readonly format: GPUTextureFormat;
  readonly estimatedBytes: number;
}

export interface TextureFactory {
  createTexture(desc: GPUTextureDescriptor): GPUTexture;
}

export interface TexturePoolLimits {
  maxBytes?: number;
  maxFreeBytes?: number;
  maxTextures?: number;
}

export interface TexturePoolStats {
  /** Current live + free texture count (legacy field retained for the UI). */
  allocated: number;
  free: number;
  live: number;
  totalBytes: number;
  freeBytes: number;
  liveBytes: number;
  peakBytes: number;
  created: number;
  evicted: number;
  maxBytes: number;
  maxFreeBytes: number;
  maxTextures: number;
}

type TextureState = 'live' | 'free' | 'destroyed';

interface TextureMetadata {
  key: string;
  creationSequence: number;
  refs: number;
  state: TextureState;
  destroyedByInvalidation: boolean;
}

const FORMAT_BYTES_PER_PIXEL: Readonly<Record<string, number>> = Object.freeze({
  r8unorm: 1,
  r8snorm: 1,
  r8uint: 1,
  r8sint: 1,
  rg8unorm: 2,
  rg8snorm: 2,
  rg8uint: 2,
  rg8sint: 2,
  rgba8unorm: 4,
  'rgba8unorm-srgb': 4,
  rgba8snorm: 4,
  rgba8uint: 4,
  rgba8sint: 4,
  bgra8unorm: 4,
  'bgra8unorm-srgb': 4,
  r16uint: 2,
  r16sint: 2,
  r16float: 2,
  rg16uint: 4,
  rg16sint: 4,
  rg16float: 4,
  rgba16uint: 8,
  rgba16sint: 8,
  rgba16float: 8,
  r32uint: 4,
  r32sint: 4,
  r32float: 4,
  rg32uint: 8,
  rg32sint: 8,
  rg32float: 8,
  rgba32uint: 16,
  rgba32sint: 16,
  rgba32float: 16,
});

// Read at call time so headless tests can stub the browser global.
const usage = () =>
  GPUTextureUsage.TEXTURE_BINDING |
  GPUTextureUsage.RENDER_ATTACHMENT |
  GPUTextureUsage.COPY_DST |
  GPUTextureUsage.COPY_SRC;

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

export function estimateTextureBytes(
  width: number,
  height: number,
  format: GPUTextureFormat,
): number {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
  ) {
    throw new RangeError(`invalid texture size ${width}x${height}`);
  }
  const bytesPerPixel = FORMAT_BYTES_PER_PIXEL[format];
  if (bytesPerPixel === undefined) {
    throw new RangeError(
      `Texture format ${format} has no deterministic byte-accounting rule.`,
    );
  }
  const pixels = width * height;
  const bytes = pixels * bytesPerPixel;
  if (!Number.isSafeInteger(pixels) || !Number.isSafeInteger(bytes)) {
    throw new RangeError('texture byte size exceeds safe integer accounting');
  }
  return bytes;
}

export class TexturePoolInvariantError extends Error {
  readonly code = 'INTERNAL' as const;
  readonly recoverable = false;

  constructor(message: string) {
    super(message);
    this.name = 'TexturePoolInvariantError';
  }
}

export class TexturePool {
  private readonly freeByKey = new Map<string, PooledTexture[]>();
  /** Oldest at index 0, newest at the end. */
  private readonly freeLru: PooledTexture[] = [];
  private readonly metadata = new WeakMap<PooledTexture, TextureMetadata>();
  private readonly handles = new Set<PooledTexture>();
  private readonly maxBytes: number;
  private readonly maxFreeBytes: number;
  private readonly maxTextures: number;
  private totalBytes = 0;
  private freeBytes = 0;
  private freeCount = 0;
  private peakBytes = 0;
  private created = 0;
  private evicted = 0;
  private invalidated = false;

  constructor(
    private readonly device: TextureFactory,
    limits: TexturePoolLimits = {},
  ) {
    this.maxBytes = positiveLimit(
      limits.maxBytes ?? DEFAULT_AGENT_LIMITS.maxGpuTextureBytes,
      'maxBytes',
    );
    this.maxFreeBytes = positiveLimit(
      limits.maxFreeBytes ?? DEFAULT_AGENT_LIMITS.maxGpuFreeTextureBytes,
      'maxFreeBytes',
    );
    this.maxTextures = positiveLimit(
      limits.maxTextures ?? DEFAULT_AGENT_LIMITS.maxGpuTextures,
      'maxTextures',
    );
    if (this.maxFreeBytes > this.maxBytes) {
      throw new RangeError('maxFreeBytes cannot exceed maxBytes');
    }
  }

  acquire(
    width: number,
    height: number,
    format: GPUTextureFormat = 'rgba8unorm',
  ): PooledTexture {
    if (this.invalidated) {
      throw new TexturePoolInvariantError('cannot acquire from an invalidated texture pool');
    }
    const estimatedBytes = estimateTextureBytes(width, height, format);
    const key = `${width}x${height}:${format}`;
    const list = this.freeByKey.get(key);
    const recycled = list?.pop();
    if (recycled) {
      if (list?.length === 0) this.freeByKey.delete(key);
      const meta = this.requireMetadata(recycled);
      if (meta.state !== 'free' || meta.refs !== 0) {
        throw new TexturePoolInvariantError('free-list texture has invalid ownership state');
      }
      const lruIndex = this.freeLru.indexOf(recycled);
      if (lruIndex < 0) {
        throw new TexturePoolInvariantError('free-list texture is missing from global LRU');
      }
      this.freeLru.splice(lruIndex, 1);
      this.freeCount--;
      this.freeBytes -= recycled.estimatedBytes;
      meta.state = 'live';
      meta.refs = 1;
      return recycled;
    }

    this.makeRoom(estimatedBytes);
    if (
      estimatedBytes > this.maxBytes - this.totalBytes
      || this.handles.size >= this.maxTextures
    ) {
      throw new CookResourceLimitError(
        'GPU texture pool cannot satisfy the allocation within its hard budget.',
        {
          requestedBytes: estimatedBytes,
          liveBytes: this.totalBytes - this.freeBytes,
          freeBytes: this.freeBytes,
          totalBytes: this.totalBytes,
          maximumBytes: this.maxBytes,
        },
      );
    }

    // Statistics are updated only after the browser has actually created the
    // resource. A synchronous createTexture failure leaves accounting exact.
    const texture = this.device.createTexture({
      size: { width, height },
      format,
      usage: usage(),
      viewFormats: format === 'rgba8unorm' ? ['rgba8unorm-srgb'] : [],
    });
    const handle: PooledTexture = Object.freeze({
      texture,
      width,
      height,
      format,
      estimatedBytes,
    });
    this.metadata.set(handle, {
      key,
      creationSequence: this.created + 1,
      refs: 1,
      state: 'live',
      destroyedByInvalidation: false,
    });
    this.handles.add(handle);
    this.totalBytes += estimatedBytes;
    this.peakBytes = Math.max(this.peakBytes, this.totalBytes);
    this.created++;
    return handle;
  }

  /** Opaque allocation watermark used to quarantine one failed GPU attempt. */
  checkpoint(): number {
    return this.created;
  }

  /**
   * Destroy every texture physically created after a checkpoint. This includes
   * temporaries already returned to the free LRU and guards against WebGPU's
   * asynchronous createTexture OOM/validation reporting.
   */
  quarantineSince(checkpoint: number): void {
    if (
      !Number.isSafeInteger(checkpoint)
      || checkpoint < 0
      || checkpoint > this.created
    ) {
      throw new RangeError('invalid texture-pool checkpoint');
    }
    for (const texture of [...this.handles]) {
      const meta = this.requireMetadata(texture);
      if (meta.creationSequence <= checkpoint) continue;
      this.destroyHandle(texture, true);
    }
  }

  retain(texture: PooledTexture): void {
    const meta = this.requireMetadata(texture);
    if (meta.state !== 'live' || meta.refs <= 0) {
      throw new TexturePoolInvariantError(
        'cannot retain a free, destroyed, or stale texture',
      );
    }
    if (!Number.isSafeInteger(meta.refs + 1)) {
      throw new TexturePoolInvariantError('texture reference count overflow');
    }
    meta.refs++;
  }

  release(texture: PooledTexture): void {
    const meta = this.requireMetadata(texture);
    if (meta.state === 'destroyed' && meta.destroyedByInvalidation) {
      // Device teardown may race late finally blocks. The old pool owns this
      // handle, so release is an intentional no-op; a new pool still rejects it.
      return;
    }
    if (meta.state !== 'live' || meta.refs <= 0) {
      throw new TexturePoolInvariantError('double release of texture');
    }
    meta.refs--;
    if (meta.refs > 0) return;

    meta.state = 'free';
    const list = this.freeByKey.get(meta.key) ?? [];
    list.push(texture);
    this.freeByKey.set(meta.key, list);
    this.freeLru.push(texture);
    this.freeCount++;
    this.freeBytes += texture.estimatedBytes;
    this.trimFreeBudget();
  }

  /**
   * Permanently destroy a uniquely-owned live texture instead of caching it.
   * Used after an invalid GPU attempt where reuse would be unsafe.
   */
  discard(texture: PooledTexture): void {
    const meta = this.requireMetadata(texture);
    if (meta.state !== 'live' || meta.refs !== 1) {
      throw new TexturePoolInvariantError(
        'discard requires one uniquely-owned live texture',
      );
    }
    this.destroyHandle(texture, false);
  }

  invalidate(): void {
    if (this.invalidated) return;
    this.invalidated = true;
    for (const texture of [...this.handles]) {
      this.destroyHandle(texture, true);
    }
    this.freeByKey.clear();
    this.freeLru.length = 0;
    this.freeCount = 0;
    this.freeBytes = 0;
    this.totalBytes = 0;
  }

  dispose(): void {
    this.invalidate();
  }

  stats(): TexturePoolStats {
    return {
      allocated: this.handles.size,
      free: this.freeCount,
      live: this.handles.size - this.freeCount,
      totalBytes: this.totalBytes,
      freeBytes: this.freeBytes,
      liveBytes: this.totalBytes - this.freeBytes,
      peakBytes: this.peakBytes,
      created: this.created,
      evicted: this.evicted,
      maxBytes: this.maxBytes,
      maxFreeBytes: this.maxFreeBytes,
      maxTextures: this.maxTextures,
    };
  }

  private makeRoom(requestedBytes: number): void {
    while (
      this.freeLru.length > 0
      && (
        requestedBytes > this.maxBytes - this.totalBytes
        || this.handles.size >= this.maxTextures
      )
    ) {
      this.destroyOldestFree();
    }
  }

  private trimFreeBudget(): void {
    while (
      this.freeBytes > this.maxFreeBytes
      && this.freeLru.length > 0
    ) {
      this.destroyOldestFree();
    }
  }

  private destroyOldestFree(): void {
    const texture = this.freeLru.shift();
    if (!texture) return;
    const meta = this.requireMetadata(texture);
    if (meta.state !== 'free' || meta.refs !== 0) {
      throw new TexturePoolInvariantError('LRU texture has invalid ownership state');
    }
    const list = this.freeByKey.get(meta.key);
    const index = list?.indexOf(texture) ?? -1;
    if (index < 0 || !list) {
      throw new TexturePoolInvariantError('LRU texture is missing from keyed free list');
    }
    list.splice(index, 1);
    if (list.length === 0) this.freeByKey.delete(meta.key);
    this.destroyHandle(texture, false, true);
  }

  private destroyHandle(
    texture: PooledTexture,
    invalidation: boolean,
    removedFromLru = false,
  ): void {
    const meta = this.requireMetadata(texture);
    if (meta.state === 'destroyed') return;
    if (meta.state === 'free') {
      if (!removedFromLru) {
        const lruIndex = this.freeLru.indexOf(texture);
        if (lruIndex >= 0) this.freeLru.splice(lruIndex, 1);
        const list = this.freeByKey.get(meta.key);
        const keyIndex = list?.indexOf(texture) ?? -1;
        if (list && keyIndex >= 0) list.splice(keyIndex, 1);
        if (list?.length === 0) this.freeByKey.delete(meta.key);
      }
      this.freeCount--;
      this.freeBytes -= texture.estimatedBytes;
    }
    meta.refs = 0;
    meta.state = 'destroyed';
    meta.destroyedByInvalidation = invalidation;
    this.handles.delete(texture);
    this.totalBytes -= texture.estimatedBytes;
    texture.texture.destroy();
    this.evicted++;
  }

  private requireMetadata(texture: PooledTexture): TextureMetadata {
    const meta = this.metadata.get(texture);
    if (!meta) {
      throw new TexturePoolInvariantError(
        'texture does not belong to this pool',
      );
    }
    return meta;
  }
}
