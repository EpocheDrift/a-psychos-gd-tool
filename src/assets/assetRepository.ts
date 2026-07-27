import type { AssetMetadata } from '../domain/documentSchema';
import type { PreparedAsset } from '../domain/assetPolicy';

export interface StoredAsset {
  metadata: AssetMetadata;
  blob: Blob;
}

export interface AssetRepository {
  /**
   * `shared-origin` repositories can be opened by multiple tabs. Process-local
   * retention providers are not sufficient authority to delete from them.
   */
  readonly retentionScope?: 'process-local' | 'shared-origin';
  put(asset: PreparedAsset): Promise<'created' | 'existing'>;
  get(assetId: string): Promise<StoredAsset | null>;
  has(assetId: string): Promise<boolean>;
  delete(assetId: string): Promise<boolean>;
  listIds(): Promise<string[]>;
}

// One document remains capped at 64 MiB. The physical CAS has extra bounded
// room for undo/revert snapshots. Process-local repositories may reclaim
// unreachable records on pressure; the origin-shared IndexedDB store fails
// closed at the cap because one tab cannot prove another tab's retention set.
export const MAX_ASSET_REPOSITORY_BYTES = 256 * 1024 * 1024;

export class AssetRepositoryError extends Error {
  readonly recoverable = true;

  constructor(
    readonly code: 'RESOURCE_LIMIT' | 'PERSISTENCE_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'AssetRepositoryError';
  }
}

/**
 * Upload/generated provenance belongs to a project manifest, not to the
 * content-addressed blob identity. Bundled assets remain a separate fixed
 * storage class and are never written to this repository.
 */
export function sameStoredAssetMetadata(
  left: AssetMetadata,
  right: AssetMetadata,
): boolean {
  return (
    left.source !== 'bundled'
    && right.source !== 'bundled'
    && left.id === right.id
    && left.sha256 === right.sha256
    && left.mimeType === right.mimeType
    && left.byteLength === right.byteLength
    && left.width === right.width
    && left.height === right.height
  );
}

export class MemoryAssetRepository implements AssetRepository {
  readonly retentionScope = 'process-local' as const;
  private readonly records = new Map<string, StoredAsset>();
  private totalBytes = 0;

  constructor(
    private readonly maximumBytes = MAX_ASSET_REPOSITORY_BYTES,
  ) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
      throw new RangeError('Asset repository byte limit must be positive.');
    }
  }

  async put(asset: PreparedAsset): Promise<'created' | 'existing'> {
    if (!asset.bytes) return 'existing';
    if (
      asset.metadata.source === 'bundled'
      || asset.bytes.byteLength !== asset.metadata.byteLength
    ) {
      throw new AssetRepositoryError(
        'PERSISTENCE_FAILED',
        'Asset bytes do not match writable content-addressed metadata.',
      );
    }
    const existing = this.records.get(asset.metadata.id);
    if (existing) {
      if (!sameStoredAssetMetadata(existing.metadata, asset.metadata)) {
        throw new Error('Content-addressed asset metadata conflicts with stored bytes.');
      }
    }
    const bytes = asset.bytes.slice();
    const nextBytes =
      this.totalBytes - (existing?.blob.size ?? 0) + bytes.byteLength;
    if (
      nextBytes > this.maximumBytes
      && (!existing || nextBytes > this.totalBytes)
    ) {
      throw new AssetRepositoryError(
        'RESOURCE_LIMIT',
        `Asset repository exceeds its ${this.maximumBytes}-byte physical limit.`,
      );
    }
    this.records.set(asset.metadata.id, {
      metadata: { ...asset.metadata },
      blob: new Blob([bytes.buffer as ArrayBuffer], {
        type: asset.metadata.mimeType,
      }),
    });
    this.totalBytes = nextBytes;
    return existing ? 'existing' : 'created';
  }

  async get(assetId: string): Promise<StoredAsset | null> {
    const record = this.records.get(assetId);
    return record
      ? {
          metadata: { ...record.metadata },
          blob: record.blob.slice(0, record.blob.size, record.blob.type),
        }
      : null;
  }

  async has(assetId: string): Promise<boolean> {
    return this.records.has(assetId);
  }

  async delete(assetId: string): Promise<boolean> {
    const record = this.records.get(assetId);
    if (!record) return false;
    this.records.delete(assetId);
    this.totalBytes -= record.blob.size;
    return true;
  }

  async listIds(): Promise<string[]> {
    return [...this.records.keys()].sort();
  }
}

interface IndexedAssetRecord {
  id: string;
  metadata: AssetMetadata;
  blob: Blob;
}

const DATABASE_NAME = 'gfx.assets.v1';
const DATABASE_VERSION = 1;
const ASSET_STORE = 'assets';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => {
      // onabort owns the terminal rejection; prevent an unhandled event.
    };
  });
}

function storedByteLength(store: IDBObjectStore): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let total = 0;
    const request = store.openCursor();
    request.onerror = () =>
      reject(request.error ?? new Error('Asset database cursor failed.'));
    request.onsuccess = () => {
      try {
        const cursor = request.result;
        if (!cursor) {
          resolve(total);
          return;
        }
        const record = cursor.value as IndexedAssetRecord;
        if (!(record?.blob instanceof Blob)) {
          reject(new Error('Asset database record is invalid.'));
          return;
        }
        total += record.blob.size;
        if (!Number.isSafeInteger(total)) {
          reject(new Error('Asset database physical usage is invalid.'));
          return;
        }
        cursor.continue();
      } catch (error) {
        reject(error);
      }
    };
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ASSET_STORE)) {
        database.createObjectStore(ASSET_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Asset database could not be opened.'));
    request.onblocked = () =>
      reject(new Error('Asset database upgrade is blocked by another page.'));
  });
}

export class IndexedDbAssetRepository implements AssetRepository {
  readonly retentionScope = 'shared-origin' as const;
  private readonly database: Promise<IDBDatabase>;

  constructor(
    private readonly maximumBytes = MAX_ASSET_REPOSITORY_BYTES,
  ) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
      throw new RangeError('Asset repository byte limit must be positive.');
    }
    this.database = openDatabase();
  }

  async put(asset: PreparedAsset): Promise<'created' | 'existing'> {
    if (!asset.bytes) return 'existing';
    if (
      asset.metadata.source === 'bundled'
      || asset.bytes.byteLength !== asset.metadata.byteLength
    ) {
      throw new AssetRepositoryError(
        'PERSISTENCE_FAILED',
        'Asset bytes do not match writable content-addressed metadata.',
      );
    }
    const database = await this.database;
    const transaction = database.transaction(ASSET_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    const store = transaction.objectStore(ASSET_STORE);
    try {
      const existing = await requestResult(
        store.get(asset.metadata.id) as IDBRequest<IndexedAssetRecord | undefined>,
      );
      if (
        existing
        && !sameStoredAssetMetadata(existing.metadata, asset.metadata)
      ) {
        throw new Error(
          'Content-addressed asset metadata conflicts with stored bytes.',
        );
      }
      const currentBytes = await storedByteLength(store);
      const bytes = asset.bytes.slice();
      const nextBytes =
        currentBytes - (existing?.blob.size ?? 0) + bytes.byteLength;
      if (
        nextBytes > this.maximumBytes
        && (!existing || nextBytes > currentBytes)
      ) {
        throw new AssetRepositoryError(
          'RESOURCE_LIMIT',
          `Asset repository exceeds its ${this.maximumBytes}-byte physical limit.`,
        );
      }
      store.put({
        id: asset.metadata.id,
        metadata: { ...asset.metadata },
        blob: new Blob([bytes.buffer as ArrayBuffer], {
          type: asset.metadata.mimeType,
        }),
      } satisfies IndexedAssetRecord);
      await completion;
      return existing ? 'existing' : 'created';
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // A failed request may already have aborted the transaction.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async get(assetId: string): Promise<StoredAsset | null> {
    const database = await this.database;
    const transaction = database.transaction(ASSET_STORE, 'readonly');
    const completion = transactionComplete(transaction);
    try {
      const record = await requestResult(
        transaction.objectStore(ASSET_STORE).get(assetId) as
          IDBRequest<IndexedAssetRecord | undefined>,
      );
      await completion;
      return record
        ? {
            metadata: { ...record.metadata },
            blob: record.blob,
          }
        : null;
    } catch (error) {
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async has(assetId: string): Promise<boolean> {
    const database = await this.database;
    const transaction = database.transaction(ASSET_STORE, 'readonly');
    const completion = transactionComplete(transaction);
    try {
      const key = await requestResult(
        transaction.objectStore(ASSET_STORE).getKey(assetId),
      );
      await completion;
      return key !== undefined;
    } catch (error) {
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async delete(assetId: string): Promise<boolean> {
    const database = await this.database;
    const transaction = database.transaction(ASSET_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    try {
      const store = transaction.objectStore(ASSET_STORE);
      const existing = await requestResult(store.getKey(assetId));
      if (existing === undefined) {
        await completion;
        return false;
      }
      store.delete(assetId);
      await completion;
      return true;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The failing request may already have aborted the transaction.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async listIds(): Promise<string[]> {
    const database = await this.database;
    const transaction = database.transaction(ASSET_STORE, 'readonly');
    const completion = transactionComplete(transaction);
    try {
      const keys = await requestResult(
        transaction.objectStore(ASSET_STORE).getAllKeys(),
      );
      await completion;
      if (!keys.every((key) => typeof key === 'string')) {
        throw new Error('Asset database keys are invalid.');
      }
      return (keys as string[]).sort();
    } catch (error) {
      await completion.catch(() => undefined);
      throw error;
    }
  }
}

export function createDefaultAssetRepository(): AssetRepository {
  return typeof indexedDB === 'undefined'
    ? new MemoryAssetRepository()
    : new IndexedDbAssetRepository();
}
