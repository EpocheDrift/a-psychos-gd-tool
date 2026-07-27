import {
  FACTORY_ASSET_METADATA,
  isAssetId,
  prepareAssetBytes,
  type AssetMimeType,
  type PreparedAsset,
} from '../domain/assetPolicy';
import type { AssetMetadata } from '../domain/documentSchema';
import type { AgentLimits } from '../domain/limits';
import {
  AssetRepositoryError,
  createDefaultAssetRepository,
  sameStoredAssetMetadata,
  type AssetRepository,
} from './assetRepository';

const FACTORY_ASSET_ROUTE = '/factory-image.jpg';
export const DEFAULT_VERIFIED_ASSET_CACHE_BYTES = 32 * 1024 * 1024;

export interface AssetStageResult {
  newlyStoredIds: string[];
  releaseRetention(): void;
}

export interface StoredPreparedAsset extends PreparedAsset {
  newlyStored: boolean;
  /**
   * Holds the content address against process-local GC until the caller has
   * synchronously published the matching manifest entry.
   */
  releaseRetention(): void;
}

export class AssetServiceError extends Error {
  readonly recoverable = true;

  constructor(
    readonly code:
      | 'ASSET_POLICY_VIOLATION'
      | 'INVALID_ARGUMENT'
      | 'RESOURCE_LIMIT'
      | 'PERSISTENCE_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'AssetServiceError';
  }
}

function metadataEqual(
  left: AssetMetadata,
  right: AssetMetadata,
): boolean {
  return (
    left.id === right.id
    && left.sha256 === right.sha256
    && left.mimeType === right.mimeType
    && left.byteLength === right.byteLength
    && left.width === right.width
    && left.height === right.height
    && left.source === right.source
  );
}

function cacheMetadataEqual(
  left: AssetMetadata,
  right: AssetMetadata,
): boolean {
  return left.source === 'bundled' || right.source === 'bundled'
    ? metadataEqual(left, right)
    : sameStoredAssetMetadata(left, right);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
  throw new DOMException('Asset operation was aborted.', 'AbortError');
}

async function verifyDecodedImage(
  asset: PreparedAsset,
  signal?: AbortSignal,
): Promise<void> {
  if (!asset.bytes || typeof createImageBitmap !== 'function') return;
  throwIfAborted(signal);
  const bytes = asset.bytes.slice();
  const blob = new Blob([bytes.buffer as ArrayBuffer], {
    type: asset.metadata.mimeType,
  });
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    throwIfAborted(signal);
    if (
      bitmap.width !== asset.metadata.width
      || bitmap.height !== asset.metadata.height
    ) {
      throw new AssetServiceError(
        'ASSET_POLICY_VIOLATION',
        'Decoded image dimensions do not match its validated header.',
      );
    }
  } catch (error) {
    if (error instanceof AssetServiceError) throw error;
    throwIfAborted(signal);
    throw new AssetServiceError(
      'ASSET_POLICY_VIOLATION',
      'The browser could not decode the validated image.',
    );
  } finally {
    bitmap?.close();
  }
}

export class AssetService {
  private readonly verifiedBlobs = new Map<string, {
    metadata: AssetMetadata;
    blob: Blob;
  }>();
  private verifiedBlobBytes = 0;
  private factoryBlob: Promise<Blob> | null = null;
  private readonly retentionProviders =
    new Set<() => Iterable<string>>();
  private repositoryMutationTail: Promise<void> = Promise.resolve();

  constructor(
    readonly repository: AssetRepository,
    private readonly maximumVerifiedBlobBytes =
      DEFAULT_VERIFIED_ASSET_CACHE_BYTES,
  ) {
    if (
      !Number.isSafeInteger(maximumVerifiedBlobBytes)
      || maximumVerifiedBlobBytes <= 0
    ) {
      throw new RangeError('Verified asset cache byte limit must be positive.');
    }
  }

  cacheStats(): Readonly<{
    entries: number;
    bytes: number;
    maximumBytes: number;
  }> {
    return Object.freeze({
      entries: this.verifiedBlobs.size,
      bytes: this.verifiedBlobBytes,
      maximumBytes: this.maximumVerifiedBlobBytes,
    });
  }

  registerRetentionProvider(
    provider: () => Iterable<string>,
  ): () => void {
    this.retentionProviders.add(provider);
    return () => this.retentionProviders.delete(provider);
  }

  async pruneUnretained(): Promise<number> {
    if (!this.localDeletionIsSafe()) return 0;
    return this.withRepositoryMutation(() => this.pruneUnretainedLocked());
  }

  async discardUnretained(assetId: string): Promise<boolean> {
    if (!this.localDeletionIsSafe()) return false;
    return this.withRepositoryMutation(async () => {
      if (this.retainedAssetIds().has(assetId)) return false;
      const removed = await this.repository.delete(assetId);
      if (removed) this.evictVerifiedBlob(assetId);
      return removed;
    });
  }

  async prepareAndStore(
    input: {
      bytes: Uint8Array;
      mimeType: AssetMimeType;
      source?: 'upload' | 'generated';
      expectedSha256?: string;
    },
    limits?: Partial<AgentLimits>,
    signal?: AbortSignal,
  ): Promise<StoredPreparedAsset> {
    throwIfAborted(signal);
    const prepared = prepareAssetBytes(input, limits);
    if (!prepared.ok) {
      throw new AssetServiceError(prepared.issue.code, prepared.issue.message);
    }
    await verifyDecodedImage(prepared.asset, signal);
    throwIfAborted(signal);
    const retainedId = prepared.asset.metadata.id;
    const unregisterRetention = this.registerRetentionProvider(
      () => [retainedId],
    );
    let retentionReleased = false;
    const releaseRetention = () => {
      if (retentionReleased) return;
      retentionReleased = true;
      unregisterRetention();
    };
    let newlyStored = false;
    try {
      newlyStored = await this.storePreparedAsset(prepared.asset);
      throwIfAborted(signal);
      return {
        metadata: { ...prepared.asset.metadata },
        bytes: prepared.asset.bytes?.slice(),
        newlyStored,
        releaseRetention,
      };
    } catch (error) {
      releaseRetention();
      if (newlyStored) {
        await this.discardUnretained(retainedId).catch(() => false);
      }
      throw error;
    }
  }

  async stagePreparedAssets(
    assets: readonly PreparedAsset[],
    signal?: AbortSignal,
  ): Promise<AssetStageResult> {
    const newlyStoredIds: string[] = [];
    const candidateIds = assets
      .filter((asset) => asset.bytes !== undefined)
      .map((asset) => asset.metadata.id);
    const unregisterStagingRetention = this.registerRetentionProvider(
      () => candidateIds,
    );
    let retentionReleased = false;
    const releaseRetention = () => {
      if (retentionReleased) return;
      retentionReleased = true;
      signal?.removeEventListener('abort', releaseRetention);
      unregisterStagingRetention();
    };
    signal?.addEventListener('abort', releaseRetention, { once: true });
    try {
      for (const asset of assets) {
        throwIfAborted(signal);
        if (!asset.bytes) continue;
        await verifyDecodedImage(asset, signal);
        if (await this.storePreparedAsset(asset)) {
          newlyStoredIds.push(asset.metadata.id);
        }
        throwIfAborted(signal);
      }
      return { newlyStoredIds, releaseRetention };
    } catch (error) {
      releaseRetention();
      await Promise.all(
        newlyStoredIds.map((assetId) =>
          this.discardUnretained(assetId).catch(() => false)),
      );
      throw error;
    }
  }

  async ensureManifestAvailable(
    manifest: readonly AssetMetadata[] | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    for (const metadata of manifest ?? []) {
      throwIfAborted(signal);
      if (
        metadata.source === 'bundled'
        && metadataEqual(metadata, FACTORY_ASSET_METADATA)
      ) {
        continue;
      }
      const cached = this.verifiedBlobs.get(metadata.id);
      if (cached && cacheMetadataEqual(cached.metadata, metadata)) {
        this.touchVerifiedBlob(metadata, cached.blob);
        continue;
      }
      try {
        const blob = await this.resolveStoredAsset(metadata, signal);
        this.cacheVerifiedBlob(metadata, blob);
      } catch {
        throwIfAborted(signal);
        throw new AssetServiceError(
          'PERSISTENCE_FAILED',
          'Project references asset bytes that are missing or failed integrity verification.',
        );
      }
    }
  }

  /**
   * Read and re-verify every non-bundled manifest entry for a human-initiated
   * portable project export. Fixed application assets stay references: their
   * bytes ship with the destination build and are never copied into a project.
   */
  async exportManifestAssets(
    manifest: readonly AssetMetadata[] | undefined,
    signal?: AbortSignal,
  ): Promise<PreparedAsset[]> {
    const exported: PreparedAsset[] = [];
    for (const metadata of manifest ?? []) {
      throwIfAborted(signal);
      if (metadata.source === 'bundled') continue;
      const blob = await this.resolve(metadata.id, manifest, signal);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      throwIfAborted(signal);
      const verified = prepareAssetBytes({
        bytes,
        mimeType: metadata.mimeType,
        source: metadata.source === 'generated' ? 'generated' : 'upload',
        expectedSha256: metadata.sha256,
      });
      if (
        !verified.ok
        || !metadataEqual(verified.asset.metadata, metadata)
      ) {
        throw new AssetServiceError(
          'PERSISTENCE_FAILED',
          'Asset bytes failed portable-export integrity verification.',
        );
      }
      exported.push(verified.asset);
    }
    return exported.sort((left, right) =>
      left.metadata.id.localeCompare(right.metadata.id));
  }

  async isAvailable(
    metadata: AssetMetadata,
    signal?: AbortSignal,
  ): Promise<boolean> {
    try {
      await this.resolve(metadata.id, [metadata], signal);
      return true;
    } catch {
      throwIfAborted(signal);
      return false;
    }
  }

  async resolve(
    assetId: string,
    manifest: readonly AssetMetadata[] | undefined,
    signal?: AbortSignal,
  ): Promise<Blob> {
    throwIfAborted(signal);
    if (!isAssetId(assetId)) {
      throw new AssetServiceError(
        'ASSET_POLICY_VIOLATION',
        'Image references an invalid content-addressed asset ID.',
      );
    }
    const metadata = manifest?.find((candidate) => candidate.id === assetId);
    if (!metadata) {
      throw new AssetServiceError(
        'ASSET_POLICY_VIOLATION',
        'Image references an asset outside the current project manifest.',
      );
    }
    const cached = this.verifiedBlobs.get(assetId);
    if (cached) {
      if (cacheMetadataEqual(cached.metadata, metadata)) {
        this.touchVerifiedBlob(metadata, cached.blob);
        return cached.blob.slice(0, cached.blob.size, cached.blob.type);
      }
      this.verifiedBlobs.delete(assetId);
      this.verifiedBlobBytes -= cached.blob.size;
    }

    const blob = metadata.source === 'bundled'
      ? await this.resolveFactoryAsset(metadata, signal)
      : await this.resolveStoredAsset(metadata, signal);
    this.cacheVerifiedBlob(metadata, blob);
    return blob.slice(0, blob.size, blob.type);
  }

  private async resolveStoredAsset(
    metadata: AssetMetadata,
    signal?: AbortSignal,
  ): Promise<Blob> {
    let record;
    try {
      record = await this.repository.get(metadata.id);
    } catch {
      throw new AssetServiceError(
        'PERSISTENCE_FAILED',
        'Browser storage could not read the referenced asset bytes.',
      );
    }
    throwIfAborted(signal);
    if (!record || !sameStoredAssetMetadata(record.metadata, metadata)) {
      throw new AssetServiceError(
        'PERSISTENCE_FAILED',
        'Asset bytes are missing or do not match the project manifest.',
      );
    }
    const bytes = new Uint8Array(await record.blob.arrayBuffer());
    throwIfAborted(signal);
    const verified = prepareAssetBytes({
      bytes,
      mimeType: metadata.mimeType,
      source: metadata.source === 'generated' ? 'generated' : 'upload',
      expectedSha256: metadata.sha256,
    });
    if (
      !verified.ok
      || !sameStoredAssetMetadata(verified.asset.metadata, metadata)
    ) {
      throw new AssetServiceError(
        'PERSISTENCE_FAILED',
        'Stored asset bytes failed integrity verification.',
      );
    }
    return new Blob([bytes.buffer as ArrayBuffer], { type: metadata.mimeType });
  }

  private async storePreparedAsset(asset: PreparedAsset): Promise<boolean> {
    return this.withRepositoryMutation(async () => {
      try {
        let result;
        try {
          result = await this.repository.put(asset);
        } catch (error) {
          if (
            !(error instanceof AssetRepositoryError)
            || error.code !== 'RESOURCE_LIMIT'
          ) {
            throw error;
          }
          if (!this.localDeletionIsSafe()) throw error;
          await this.pruneUnretainedLocked();
          result = await this.repository.put(asset);
        }
        return result === 'created';
      } catch (error) {
        if (
          error instanceof AssetRepositoryError
          && error.code === 'RESOURCE_LIMIT'
        ) {
          throw new AssetServiceError('RESOURCE_LIMIT', error.message);
        }
        throw new AssetServiceError(
          'PERSISTENCE_FAILED',
          'Browser storage rejected the validated asset bytes.',
        );
      }
    });
  }

  private retainedAssetIds(): Set<string> {
    const retained = new Set<string>();
    for (const provider of this.retentionProviders) {
      for (const assetId of provider()) retained.add(assetId);
    }
    return retained;
  }

  private localDeletionIsSafe(): boolean {
    return this.repository.retentionScope === 'process-local';
  }

  private async pruneUnretainedLocked(): Promise<number> {
    let removed = 0;
    for (const assetId of await this.repository.listIds()) {
      if (this.retainedAssetIds().has(assetId)) continue;
      if (await this.repository.delete(assetId)) {
        this.evictVerifiedBlob(assetId);
        removed++;
      }
    }
    return removed;
  }

  private async withRepositoryMutation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.repositoryMutationTail;
    let release!: () => void;
    this.repositoryMutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private evictVerifiedBlob(assetId: string): void {
    const cached = this.verifiedBlobs.get(assetId);
    if (!cached) return;
    this.verifiedBlobs.delete(assetId);
    this.verifiedBlobBytes -= cached.blob.size;
  }

  private async resolveFactoryAsset(
    metadata: AssetMetadata,
    signal?: AbortSignal,
  ): Promise<Blob> {
    if (!metadataEqual(metadata, FACTORY_ASSET_METADATA)) {
      throw new AssetServiceError(
        'ASSET_POLICY_VIOLATION',
        'Bundled asset metadata is not on the fixed application allowlist.',
      );
    }
    this.factoryBlob ??= (async () => {
      const response = await fetch(FACTORY_ASSET_ROUTE, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        throw new AssetServiceError(
          'PERSISTENCE_FAILED',
          'The fixed bundled image is unavailable.',
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const verified = prepareAssetBytes({
        bytes,
        mimeType: FACTORY_ASSET_METADATA.mimeType,
        expectedSha256: FACTORY_ASSET_METADATA.sha256,
      });
      if (
        !verified.ok
        || verified.asset.metadata.byteLength !== FACTORY_ASSET_METADATA.byteLength
        || verified.asset.metadata.width !== FACTORY_ASSET_METADATA.width
        || verified.asset.metadata.height !== FACTORY_ASSET_METADATA.height
      ) {
        throw new AssetServiceError(
          'PERSISTENCE_FAILED',
          'The fixed bundled image failed integrity verification.',
        );
      }
      return new Blob([bytes.buffer as ArrayBuffer], {
        type: FACTORY_ASSET_METADATA.mimeType,
      });
    })().catch((error) => {
      this.factoryBlob = null;
      throw error;
    });
    const blob = await this.factoryBlob;
    throwIfAborted(signal);
    return blob;
  }

  private touchVerifiedBlob(metadata: AssetMetadata, blob: Blob): void {
    this.verifiedBlobs.delete(metadata.id);
    this.verifiedBlobs.set(metadata.id, {
      metadata: { ...metadata },
      blob,
    });
  }

  private cacheVerifiedBlob(metadata: AssetMetadata, blob: Blob): void {
    const existing = this.verifiedBlobs.get(metadata.id);
    if (existing) {
      this.verifiedBlobBytes -= existing.blob.size;
      this.verifiedBlobs.delete(metadata.id);
    }
    if (blob.size > this.maximumVerifiedBlobBytes) return;
    while (
      this.verifiedBlobBytes + blob.size > this.maximumVerifiedBlobBytes
    ) {
      const oldest = this.verifiedBlobs.entries().next().value as
        | [string, { metadata: AssetMetadata; blob: Blob }]
        | undefined;
      if (!oldest) break;
      this.verifiedBlobs.delete(oldest[0]);
      this.verifiedBlobBytes -= oldest[1].blob.size;
    }
    this.verifiedBlobs.set(metadata.id, {
      metadata: { ...metadata },
      blob,
    });
    this.verifiedBlobBytes += blob.size;
  }
}

export const appAssetService = new AssetService(
  createDefaultAssetRepository(),
);
