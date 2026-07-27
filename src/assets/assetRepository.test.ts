import { describe, expect, it } from 'vitest';
import {
  decodeStrictBase64,
  prepareAssetBytes,
  type PreparedAsset,
} from '../domain/assetPolicy';
import {
  AssetRepositoryError,
  MemoryAssetRepository,
} from './assetRepository';

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function preparedAsset(): PreparedAsset {
  const bytes = decodeStrictBase64(ONE_BY_ONE_PNG_BASE64, 1024)!;
  const prepared = prepareAssetBytes({
    bytes,
    mimeType: 'image/png',
  });
  if (!prepared.ok) throw new Error(prepared.issue.message);
  return prepared.asset;
}

function secondPreparedAsset(): PreparedAsset {
  const original = decodeStrictBase64(ONE_BY_ONE_PNG_BASE64, 1024)!;
  const bytes = new Uint8Array(original.byteLength + 1);
  bytes.set(original);
  const prepared = prepareAssetBytes({
    bytes,
    mimeType: 'image/png',
  });
  if (!prepared.ok) throw new Error(prepared.issue.message);
  return prepared.asset;
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('MemoryAssetRepository', () => {
  it('stores owned immutable copies and returns defensive records', async () => {
    const repository = new MemoryAssetRepository();
    const prepared = preparedAsset();
    const assetId = prepared.metadata.id;
    const expectedBytes = prepared.bytes!.slice();

    await expect(repository.put(prepared)).resolves.toBe('created');
    prepared.bytes![0] ^= 0xff;
    prepared.metadata.width = 99;

    const first = await repository.get(assetId);
    expect(first).not.toBeNull();
    expect(first?.metadata).toMatchObject({
      width: 1,
      height: 1,
      byteLength: expectedBytes.byteLength,
    });
    expect(await blobBytes(first!.blob)).toEqual(expectedBytes);

    first!.metadata.height = 99;
    const second = await repository.get(assetId);
    expect(second?.metadata.height).toBe(1);
    expect(second?.blob).not.toBe(first?.blob);
    expect(await repository.has(assetId)).toBe(true);
  });

  it('repairs existing bytes, accepts provenance changes, and rejects content conflicts', async () => {
    const repository = new MemoryAssetRepository();
    const prepared = preparedAsset();
    const corrupt = prepared.bytes!.slice();
    corrupt[corrupt.length - 1] ^= 0xff;
    await repository.put({
      metadata: { ...prepared.metadata },
      bytes: corrupt,
    });
    await expect(repository.put({
      metadata: { ...prepared.metadata, source: 'generated' },
      bytes: prepared.bytes!.slice(),
    })).resolves.toBe('existing');
    const repaired = await repository.get(prepared.metadata.id);
    expect(repaired?.metadata.source).toBe('generated');
    expect(await blobBytes(repaired!.blob)).toEqual(prepared.bytes);

    await expect(repository.put({
      metadata: {
        ...prepared.metadata,
        width: prepared.metadata.width + 1,
      },
      bytes: prepared.bytes!.slice(),
    })).rejects.toThrow(/conflicts/);
    expect(await repository.get('asset_missing')).toBeNull();
  });

  it('enforces a physical byte cap without evicting undo-safe records', async () => {
    const first = preparedAsset();
    const second = secondPreparedAsset();
    const repository = new MemoryAssetRepository(first.metadata.byteLength);
    await repository.put(first);

    await expect(repository.put(second)).rejects.toEqual(
      expect.objectContaining<Partial<AssetRepositoryError>>({
        name: 'AssetRepositoryError',
        code: 'RESOURCE_LIMIT',
      }),
    );
    expect(await repository.has(first.metadata.id)).toBe(true);
    expect(await repository.has(second.metadata.id)).toBe(false);
  });

  it('lists and deletes records while maintaining physical accounting', async () => {
    const first = preparedAsset();
    const second = secondPreparedAsset();
    const repository = new MemoryAssetRepository(
      first.metadata.byteLength + second.metadata.byteLength,
    );
    await repository.put(first);
    await repository.put(second);
    expect(await repository.listIds()).toEqual(
      [first.metadata.id, second.metadata.id].sort(),
    );
    expect(await repository.delete(first.metadata.id)).toBe(true);
    expect(await repository.delete(first.metadata.id)).toBe(false);
    expect(await repository.listIds()).toEqual([second.metadata.id]);
    await expect(repository.put(first)).resolves.toBe('created');
  });
});
