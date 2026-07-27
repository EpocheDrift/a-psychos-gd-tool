import { describe, expect, it } from 'vitest';
import { sha256BytesHex } from '../domain/sha256';
import { AssetUploadSession } from './assetUploadSession';

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe('AssetUploadSession', () => {
  it('accepts ordered canonical chunks and exposes bytes only at finalize', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const session = new AssetUploadSession({
      limits: {
        maxAssetChunkBytes: 4,
        maxLegacyAssetBytes: 80,
      },
      randomBytes: (length) => new Uint8Array(length).fill(7),
    });
    const begun = session.begin({
      requestId: 'begin_1',
      mimeType: 'image/png',
      byteLength: bytes.byteLength,
      sha256: sha256BytesHex(bytes),
    });
    const status = session.chunk({
      requestId: 'chunk_1',
      uploadId: begun.uploadId,
      offset: 0,
      dataBase64: base64(bytes),
      chunkSha256: sha256BytesHex(bytes),
    });
    expect(status).toMatchObject({
      receivedBytes: 4,
      nextOffset: 4,
      complete: true,
    });
    expect(session.beginFinalize(begun.uploadId).bytes).toEqual(bytes);
    expect(() => session.beginFinalize(begun.uploadId)).toThrow(
      /already in progress/,
    );
    expect(() => session.abort(begun.uploadId)).toThrow(
      /already in progress/,
    );
    session.complete(begun.uploadId);
    expect(() => session.status(begun.uploadId)).toThrow();
  });

  it('can retry a failed finalize without letting the upload expire mid-flight', () => {
    let now = 0;
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const session = new AssetUploadSession({
      now: () => now,
      limits: {
        maxAssetChunkBytes: 4,
        maxLegacyAssetBytes: 80,
        assetUploadIdleMs: 10,
        assetUploadDeadlineMs: 20,
      },
    });
    const begun = session.begin({
      requestId: 'begin_1',
      mimeType: 'image/png',
      byteLength: bytes.byteLength,
      sha256: sha256BytesHex(bytes),
    });
    session.chunk({
      requestId: 'chunk_1',
      uploadId: begun.uploadId,
      offset: 0,
      dataBase64: base64(bytes),
      chunkSha256: sha256BytesHex(bytes),
    });
    session.beginFinalize(begun.uploadId);
    now = 15;
    expect(session.status(begun.uploadId).complete).toBe(true);
    session.cancelFinalize(begun.uploadId);
    expect(session.beginFinalize(begun.uploadId).bytes).toEqual(bytes);
    session.complete(begun.uploadId);
  });

  it('rejects gaps, short non-final chunks, bad hashes, and request reuse', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const first = bytes.subarray(0, 4);
    const session = new AssetUploadSession({
      limits: {
        maxAssetChunkBytes: 4,
        maxLegacyAssetBytes: 80,
      },
    });
    const begun = session.begin({
      requestId: 'begin_1',
      mimeType: 'image/png',
      byteLength: bytes.byteLength,
      sha256: sha256BytesHex(bytes),
    });
    expect(() => session.chunk({
      requestId: 'gap',
      uploadId: begun.uploadId,
      offset: 1,
      dataBase64: base64(first),
      chunkSha256: sha256BytesHex(first),
    })).toThrow(/offset/);
    expect(() => session.chunk({
      requestId: 'short',
      uploadId: begun.uploadId,
      offset: 0,
      dataBase64: base64(first.subarray(0, 2)),
      chunkSha256: sha256BytesHex(first.subarray(0, 2)),
    })).toThrow(/non-final/);
    session.chunk({
      requestId: 'chunk_1',
      uploadId: begun.uploadId,
      offset: 0,
      dataBase64: base64(first),
      chunkSha256: sha256BytesHex(first),
    });
    expect(() => session.chunk({
      requestId: 'chunk_1',
      uploadId: begun.uploadId,
      offset: 4,
      dataBase64: base64(bytes.subarray(4)),
      chunkSha256: sha256BytesHex(bytes.subarray(4)),
    })).toThrow(/reused/);
  });

  it('expires on idle and absolute deadlines without status extending either', () => {
    let now = 0;
    const session = new AssetUploadSession({
      now: () => now,
      limits: {
        assetUploadIdleMs: 10,
        assetUploadDeadlineMs: 20,
      },
    });
    const begun = session.begin({
      requestId: 'begin_1',
      mimeType: 'image/png',
      byteLength: 1,
      sha256: '0'.repeat(64),
    });
    now = 9;
    expect(session.status(begun.uploadId).idleExpiresAtMs).toBe(10);
    now = 10;
    expect(() => session.status(begun.uploadId)).toThrow(/absent/);
  });
});
