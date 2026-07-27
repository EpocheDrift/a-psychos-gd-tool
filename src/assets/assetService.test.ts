import { describe, expect, it, vi } from 'vitest';
import {
  decodeStrictBase64,
  prepareAssetBytes,
  type PreparedAsset,
} from '../domain/assetPolicy';
import type { AssetMetadata } from '../domain/documentSchema';
import {
  AssetService,
  AssetServiceError,
} from './assetService';
import {
  AssetRepositoryError,
  MemoryAssetRepository,
  type AssetRepository,
  type StoredAsset,
} from './assetRepository';

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function pngBytes(): Uint8Array {
  return decodeStrictBase64(ONE_BY_ONE_PNG_BASE64, 1024)!;
}

function preparedAsset(): PreparedAsset {
  const prepared = prepareAssetBytes({
    bytes: pngBytes(),
    mimeType: 'image/png',
  });
  if (!prepared.ok) throw new Error(prepared.issue.message);
  return prepared.asset;
}

function secondPreparedAsset(): PreparedAsset {
  const original = pngBytes();
  const bytes = new Uint8Array(original.byteLength + 1);
  bytes.set(original);
  const prepared = prepareAssetBytes({
    bytes,
    mimeType: 'image/png',
  });
  if (!prepared.ok) throw new Error(prepared.issue.message);
  return prepared.asset;
}

class StaticRepository implements AssetRepository {
  constructor(
    private readonly record: StoredAsset | null,
    private readonly putFailure = false,
  ) {}

  async put(): Promise<'created'> {
    if (this.putFailure) throw new Error('quota');
    return 'created';
  }

  async get(): Promise<StoredAsset | null> {
    return this.record;
  }

  async has(): Promise<boolean> {
    return this.record !== null;
  }

  async delete(): Promise<boolean> {
    return false;
  }

  async listIds(): Promise<string[]> {
    return this.record ? [this.record.metadata.id] : [];
  }
}

class CountingRepository implements AssetRepository {
  reads = 0;

  constructor(private readonly inner: AssetRepository) {}

  put(asset: PreparedAsset): Promise<'created' | 'existing'> {
    return this.inner.put(asset);
  }

  async get(assetId: string): Promise<StoredAsset | null> {
    this.reads++;
    return this.inner.get(assetId);
  }

  has(assetId: string): Promise<boolean> {
    return this.inner.has(assetId);
  }

  delete(assetId: string): Promise<boolean> {
    return this.inner.delete(assetId);
  }

  listIds(): Promise<string[]> {
    return this.inner.listIds();
  }
}

describe('AssetService persistence boundary', () => {
  it('validates, persists, resolves, and returns defensive binary copies', async () => {
    const repository = new MemoryAssetRepository();
    const service = new AssetService(repository);
    const bytes = pngBytes();
    const expectedBytes = bytes.slice();
    const stored = await service.prepareAndStore({
      bytes,
      mimeType: 'image/png',
    });
    bytes[0] ^= 0xff;

    await expect(service.ensureManifestAvailable([stored.metadata]))
      .resolves.toBeUndefined();
    const first = await service.resolve(stored.metadata.id, [stored.metadata]);
    const second = await service.resolve(stored.metadata.id, [stored.metadata]);
    expect(first).not.toBe(second);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(expectedBytes);
    stored.releaseRetention();
  });

  it('fails manifest preflight for missing, mismatched, or corrupted records', async () => {
    const prepared = preparedAsset();
    const missing = new AssetService(new StaticRepository(null));
    await expect(missing.ensureManifestAvailable([prepared.metadata]))
      .rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });

    const mismatchedMetadata: AssetMetadata = {
      ...prepared.metadata,
      width: 2,
    };
    const mismatched = new AssetService(new StaticRepository({
      metadata: mismatchedMetadata,
      blob: new Blob([prepared.bytes!.buffer as ArrayBuffer], {
        type: prepared.metadata.mimeType,
      }),
    }));
    await expect(mismatched.ensureManifestAvailable([prepared.metadata]))
      .rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });

    const corrupt = prepared.bytes!.slice();
    corrupt[corrupt.length - 1] ^= 0xff;
    const corrupted = new AssetService(new StaticRepository({
      metadata: { ...prepared.metadata },
      blob: new Blob([corrupt.buffer as ArrayBuffer], {
        type: prepared.metadata.mimeType,
      }),
    }));
    await expect(corrupted.ensureManifestAvailable([prepared.metadata]))
      .rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
  });

  it('does not reuse a verified cache entry for conflicting manifest metadata', async () => {
    const repository = new MemoryAssetRepository();
    const prepared = preparedAsset();
    await repository.put(prepared);
    const service = new AssetService(repository);
    await service.resolve(prepared.metadata.id, [prepared.metadata]);

    await expect(service.resolve(prepared.metadata.id, [{
      ...prepared.metadata,
      width: 2,
    }])).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
  });

  it('bounds verified blobs with byte-accounted LRU eviction', async () => {
    const repository = new MemoryAssetRepository();
    const first = preparedAsset();
    const second = secondPreparedAsset();
    await repository.put(first);
    await repository.put(second);
    const counting = new CountingRepository(repository);
    const cacheBytes = Math.max(
      first.metadata.byteLength,
      second.metadata.byteLength,
    );
    const service = new AssetService(counting, cacheBytes);

    await service.resolve(first.metadata.id, [first.metadata]);
    await service.resolve(first.metadata.id, [first.metadata]);
    expect(counting.reads).toBe(1);
    await service.resolve(second.metadata.id, [second.metadata]);
    expect(service.cacheStats()).toMatchObject({
      entries: 1,
      bytes: second.metadata.byteLength,
      maximumBytes: cacheBytes,
    });
    await service.resolve(first.metadata.id, [first.metadata]);
    expect(counting.reads).toBe(3);
  });

  it('reports availability only after integrity verification and ignores stored provenance', async () => {
    const prepared = preparedAsset();
    const repository = new MemoryAssetRepository();
    await repository.put(prepared);
    const service = new AssetService(repository);
    await expect(service.isAvailable({
      ...prepared.metadata,
      source: 'generated',
    })).resolves.toBe(true);

    const corrupt = prepared.bytes!.slice();
    corrupt[corrupt.length - 1] ^= 0xff;
    const corrupted = new AssetService(new StaticRepository({
      metadata: { ...prepared.metadata },
      blob: new Blob([corrupt.buffer as ArrayBuffer], {
        type: prepared.metadata.mimeType,
      }),
    }));
    await expect(corrupted.isAvailable(prepared.metadata)).resolves.toBe(false);
    await expect(
      new AssetService(new StaticRepository(null))
        .isAvailable(prepared.metadata),
    ).resolves.toBe(false);
  });

  it('normalizes repository write failures and rejects out-of-manifest access', async () => {
    const service = new AssetService(new StaticRepository(null, true));
    await expect(service.prepareAndStore({
      bytes: pngBytes(),
      mimeType: 'image/png',
    })).rejects.toEqual(expect.objectContaining({
      name: 'AssetServiceError',
      code: 'PERSISTENCE_FAILED',
    }));

    const prepared = preparedAsset();
    await expect(service.resolve(prepared.metadata.id, []))
      .rejects.toBeInstanceOf(AssetServiceError);
  });

  it('preserves a recognizable resource-limit error from repository quota', async () => {
    const bytes = pngBytes();
    const service = new AssetService(
      new MemoryAssetRepository(bytes.byteLength - 1),
    );
    await expect(service.prepareAndStore({
      bytes,
      mimeType: 'image/png',
    })).rejects.toMatchObject({
      name: 'AssetServiceError',
      code: 'RESOURCE_LIMIT',
    });
  });

  it('serializes same-digest writes and identifies exactly one CAS creator', async () => {
    const repository = new MemoryAssetRepository();
    const service = new AssetService(repository);
    const [first, second] = await Promise.all([
      service.prepareAndStore({
        bytes: pngBytes(),
        mimeType: 'image/png',
      }),
      service.prepareAndStore({
        bytes: pngBytes(),
        mimeType: 'image/png',
      }),
    ]);

    expect([first.newlyStored, second.newlyStored].sort()).toEqual([
      false,
      true,
    ]);
    expect(await repository.listIds()).toEqual([first.metadata.id]);
    first.releaseRetention();
    second.releaseRetention();
  });

  it('pins a prepared CAS record until its caller publishes the manifest', async () => {
    const first = preparedAsset();
    const second = secondPreparedAsset();
    const repository = new MemoryAssetRepository(
      second.metadata.byteLength,
    );
    const service = new AssetService(repository);
    const storedFirst = await service.prepareAndStore({
      bytes: first.bytes!.slice(),
      mimeType: first.metadata.mimeType,
    });
    await expect(service.prepareAndStore({
      bytes: second.bytes!.slice(),
      mimeType: second.metadata.mimeType,
    })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
    });
    expect(await repository.listIds()).toEqual([first.metadata.id]);

    storedFirst.releaseRetention();
    const storedSecond = await service.prepareAndStore({
      bytes: second.bytes!.slice(),
      mimeType: second.metadata.mimeType,
    });
    expect(storedSecond).toMatchObject({
      metadata: { id: second.metadata.id },
      newlyStored: true,
    });
    storedSecond.releaseRetention();
    expect(await repository.listIds()).toEqual([second.metadata.id]);

    await repository.delete(second.metadata.id);
    await repository.put(first);
    const unregister = service.registerRetentionProvider(
      () => [first.metadata.id],
    );
    await expect(service.prepareAndStore({
      bytes: second.bytes!.slice(),
      mimeType: second.metadata.mimeType,
    })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
    });
    expect(await repository.listIds()).toEqual([first.metadata.id]);
    unregister();
  });

  it('pins existing CAS hits for the whole staging lease', async () => {
    const first = preparedAsset();
    const second = secondPreparedAsset();
    const repository = new MemoryAssetRepository(
      second.metadata.byteLength,
    );
    await repository.put(first);
    const service = new AssetService(repository);
    const staged = await service.stagePreparedAssets([first]);

    await expect(service.prepareAndStore({
      bytes: second.bytes!.slice(),
      mimeType: second.metadata.mimeType,
    })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
    });
    expect(await repository.listIds()).toEqual([first.metadata.id]);

    staged.releaseRetention();
    const storedSecond = await service.prepareAndStore({
      bytes: second.bytes!.slice(),
      mimeType: second.metadata.mimeType,
    });
    storedSecond.releaseRetention();
    expect(await repository.listIds()).toEqual([second.metadata.id]);
  });

  it('pins staged assets together and cleans a failed staging batch', async () => {
    const first = preparedAsset();
    const second = secondPreparedAsset();
    const repository = new MemoryAssetRepository(
      second.metadata.byteLength,
    );
    const service = new AssetService(repository);

    await expect(service.stagePreparedAssets([first, second]))
      .rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    expect(await repository.listIds()).toEqual([]);
  });

  it('never applies process-local GC authority to a shared-origin repository', async () => {
    const prepared = preparedAsset();
    const remove = vi.fn(async () => true);
    const listIds = vi.fn(async () => [prepared.metadata.id]);
    const repository: AssetRepository = {
      retentionScope: 'shared-origin',
      put: vi.fn(async () => {
        throw new AssetRepositoryError('RESOURCE_LIMIT', 'full');
      }),
      get: vi.fn(async () => null),
      has: vi.fn(async () => false),
      delete: remove,
      listIds,
    };
    const service = new AssetService(repository);

    await expect(service.pruneUnretained()).resolves.toBe(0);
    await expect(
      service.discardUnretained(prepared.metadata.id),
    ).resolves.toBe(false);
    await expect(service.prepareAndStore({
      bytes: prepared.bytes!.slice(),
      mimeType: prepared.metadata.mimeType,
    })).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });

    expect(listIds).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
