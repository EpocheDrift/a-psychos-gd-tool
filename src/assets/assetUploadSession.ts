import {
  ASSET_MIME_TYPES,
  decodeStrictBase64,
  type AssetMimeType,
} from '../domain/assetPolicy';
import type { AgentErrorCode } from '../domain/agentErrors';
import { resolveAgentLimits, type AgentLimits } from '../domain/limits';
import { sha256BytesHex, sha256Hex } from '../domain/sha256';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export class AssetUploadError extends Error {
  readonly recoverable = true;

  constructor(
    readonly code: AgentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AssetUploadError';
  }
}

export interface AssetUploadStatus {
  uploadId: string;
  mimeType: AssetMimeType;
  byteLength: number;
  receivedBytes: number;
  nextOffset: number;
  chunkBytes: number;
  idleExpiresAtMs: number;
  expiresAtMs: number;
  complete: boolean;
}

interface ChunkReplay {
  fingerprint: string;
  status: AssetUploadStatus;
}

interface ActiveUpload {
  uploadId: string;
  beginRequestId: string;
  beginFingerprint: string;
  mimeType: AssetMimeType;
  byteLength: number;
  expectedSha256: string;
  bytes: Uint8Array;
  receivedBytes: number;
  createdAtMs: number;
  lastActivityAtMs: number;
  chunks: Map<string, ChunkReplay>;
  finalizing: boolean;
}

export interface AssetUploadSessionOptions {
  limits?: Partial<AgentLimits>;
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
}

function base64Url(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const value =
      (first << 16)
      | ((second ?? 0) << 8)
      | (third ?? 0);
    output += alphabet[(value >>> 18) & 63];
    output += alphabet[(value >>> 12) & 63];
    if (second !== undefined) output += alphabet[(value >>> 6) & 63];
    if (third !== undefined) output += alphabet[value & 63];
  }
  return output;
}

function defaultRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export class AssetUploadSession {
  private readonly limits: AgentLimits;
  private readonly now: () => number;
  private readonly randomBytes: (length: number) => Uint8Array;
  private active: ActiveUpload | null = null;
  private destroyed = false;

  constructor(options: AssetUploadSessionOptions = {}) {
    this.limits = resolveAgentLimits(options.limits);
    this.now = options.now ?? Date.now;
    this.randomBytes = options.randomBytes ?? defaultRandomBytes;
  }

  begin(input: {
    requestId: string;
    mimeType: string;
    byteLength: number;
    sha256: string;
  }): AssetUploadStatus {
    this.assertLive();
    this.sweep();
    if (!ASSET_MIME_TYPES.includes(input.mimeType as AssetMimeType)) {
      throw new AssetUploadError(
        'ASSET_POLICY_VIOLATION',
        'Asset MIME type must be image/png, image/jpeg, or image/webp.',
      );
    }
    if (
      !Number.isSafeInteger(input.byteLength)
      || input.byteLength <= 0
      || input.byteLength > this.limits.maxLegacyAssetBytes
    ) {
      throw new AssetUploadError(
        'RESOURCE_LIMIT',
        `Asset byteLength must be between 1 and ${this.limits.maxLegacyAssetBytes}.`,
      );
    }
    if (
      Math.ceil(input.byteLength / this.limits.maxAssetChunkBytes)
      > this.limits.maxAssetChunks
    ) {
      throw new AssetUploadError(
        'RESOURCE_LIMIT',
        `Asset upload exceeds the ${this.limits.maxAssetChunks}-chunk limit.`,
      );
    }
    if (!SHA256_PATTERN.test(input.sha256)) {
      throw new AssetUploadError(
        'INVALID_ARGUMENT',
        'Asset sha256 must contain 64 lowercase hexadecimal characters.',
      );
    }
    const beginFingerprint = sha256Hex(
      `gfx.asset-upload.begin.v1\u0000${input.mimeType}\u0000${
        input.byteLength
      }\u0000${input.sha256}`,
    );
    if (this.active) {
      if (
        this.active.beginRequestId === input.requestId
        && this.active.beginFingerprint === beginFingerprint
      ) {
        return this.status(this.active.uploadId);
      }
      throw new AssetUploadError(
        'RESOURCE_LIMIT',
        'Only one pending asset upload is allowed per Agent session.',
      );
    }
    const now = this.now();
    this.active = {
      uploadId: `upload_${base64Url(this.randomBytes(16))}`,
      beginRequestId: input.requestId,
      beginFingerprint,
      mimeType: input.mimeType as AssetMimeType,
      byteLength: input.byteLength,
      expectedSha256: input.sha256,
      bytes: new Uint8Array(input.byteLength),
      receivedBytes: 0,
      createdAtMs: now,
      lastActivityAtMs: now,
      chunks: new Map(),
      finalizing: false,
    };
    return this.snapshot(this.active);
  }

  chunk(input: {
    requestId: string;
    uploadId: string;
    offset: number;
    dataBase64: string;
    chunkSha256: string;
  }): AssetUploadStatus {
    this.assertLive();
    const upload = this.requireActive(input.uploadId);
    if (upload.finalizing) {
      throw new AssetUploadError(
        'RESOURCE_LIMIT',
        'Asset upload finalization is already in progress.',
      );
    }
    if (!SHA256_PATTERN.test(input.chunkSha256)) {
      throw new AssetUploadError(
        'INVALID_ARGUMENT',
        'chunkSha256 must contain 64 lowercase hexadecimal characters.',
      );
    }
    if (!Number.isSafeInteger(input.offset) || input.offset < 0) {
      throw new AssetUploadError(
        'INVALID_ARGUMENT',
        'Chunk offset must be a non-negative safe integer.',
      );
    }
    const bytes = decodeStrictBase64(
      input.dataBase64,
      this.limits.maxAssetChunkBytes,
    );
    if (!bytes || bytes.byteLength === 0) {
      throw new AssetUploadError(
        'ASSET_POLICY_VIOLATION',
        'Chunk data must be non-empty canonical bounded base64.',
      );
    }
    const actualSha256 = sha256BytesHex(bytes);
    if (actualSha256 !== input.chunkSha256) {
      throw new AssetUploadError(
        'ASSET_POLICY_VIOLATION',
        'Chunk bytes do not match chunkSha256.',
      );
    }
    const fingerprint = sha256Hex(
      `gfx.asset-upload.chunk.v1\u0000${input.uploadId}\u0000${
        input.offset
      }\u0000${bytes.byteLength}\u0000${input.chunkSha256}`,
    );
    const replay = upload.chunks.get(input.requestId);
    if (replay) {
      if (replay.fingerprint !== fingerprint) {
        throw new AssetUploadError(
          'REQUEST_ID_REUSED',
          'Chunk requestId was reused with different arguments.',
        );
      }
      return { ...replay.status };
    }
    if (input.offset !== upload.receivedBytes) {
      throw new AssetUploadError(
        'INVALID_ARGUMENT',
        'Chunk offset must equal the next expected byte offset.',
      );
    }
    const nextOffset = input.offset + bytes.byteLength;
    if (nextOffset > upload.byteLength) {
      throw new AssetUploadError(
        'RESOURCE_LIMIT',
        'Chunk exceeds the declared asset byteLength.',
      );
    }
    if (
      nextOffset < upload.byteLength
      && bytes.byteLength !== this.limits.maxAssetChunkBytes
    ) {
      throw new AssetUploadError(
        'INVALID_ARGUMENT',
        'Every non-final chunk must use the negotiated chunk size.',
      );
    }
    upload.bytes.set(bytes, input.offset);
    upload.receivedBytes = nextOffset;
    upload.lastActivityAtMs = this.now();
    const status = this.snapshot(upload);
    upload.chunks.set(input.requestId, {
      fingerprint,
      status: { ...status },
    });
    return status;
  }

  status(uploadId: string): AssetUploadStatus {
    this.assertLive();
    return this.snapshot(this.requireActive(uploadId));
  }

  beginFinalize(uploadId: string): {
    bytes: Uint8Array;
    mimeType: AssetMimeType;
    expectedSha256: string;
  } {
    this.assertLive();
    const upload = this.requireActive(uploadId);
    if (upload.finalizing) {
      throw new AssetUploadError(
        'RESOURCE_LIMIT',
        'Asset upload finalization is already in progress.',
      );
    }
    if (upload.receivedBytes !== upload.byteLength) {
      throw new AssetUploadError(
        'INVALID_ARGUMENT',
        'Asset upload is incomplete.',
      );
    }
    const actualSha256 = sha256BytesHex(upload.bytes);
    if (actualSha256 !== upload.expectedSha256) {
      throw new AssetUploadError(
        'ASSET_POLICY_VIOLATION',
        'Uploaded asset does not match its declared SHA-256.',
      );
    }
    upload.finalizing = true;
    return {
      bytes: upload.bytes.slice(),
      mimeType: upload.mimeType,
      expectedSha256: upload.expectedSha256,
    };
  }

  cancelFinalize(uploadId: string): void {
    if (this.destroyed || this.active?.uploadId !== uploadId) return;
    this.active.finalizing = false;
    this.active.lastActivityAtMs = this.now();
  }

  complete(uploadId: string): void {
    if (
      this.destroyed
      || !this.active
      || this.active.uploadId !== uploadId
      || !this.active.finalizing
    ) {
      throw new AssetUploadError(
        'INTERNAL',
        'Asset upload finalization state was lost.',
      );
    }
    this.active = null;
  }

  abort(uploadId: string): boolean {
    this.assertLive();
    this.sweep();
    if (!this.active || this.active.uploadId !== uploadId) return false;
    if (this.active.finalizing) {
      throw new AssetUploadError(
        'RESOURCE_LIMIT',
        'Asset upload finalization is already in progress.',
      );
    }
    this.active = null;
    return true;
  }

  destroy(): void {
    this.active = null;
    this.destroyed = true;
  }

  private requireActive(uploadId: string): ActiveUpload {
    this.sweep();
    if (!this.active || this.active.uploadId !== uploadId) {
      throw new AssetUploadError(
        'INVALID_ARGUMENT',
        'Asset upload is absent, expired, or belongs to another session.',
      );
    }
    return this.active;
  }

  private snapshot(upload: ActiveUpload): AssetUploadStatus {
    return {
      uploadId: upload.uploadId,
      mimeType: upload.mimeType,
      byteLength: upload.byteLength,
      receivedBytes: upload.receivedBytes,
      nextOffset: upload.receivedBytes,
      chunkBytes: this.limits.maxAssetChunkBytes,
      idleExpiresAtMs:
        upload.lastActivityAtMs + this.limits.assetUploadIdleMs,
      expiresAtMs:
        upload.createdAtMs + this.limits.assetUploadDeadlineMs,
      complete: upload.receivedBytes === upload.byteLength,
    };
  }

  private sweep(): void {
    if (!this.active || this.active.finalizing) return;
    const now = this.now();
    if (
      now >= this.active.createdAtMs + this.limits.assetUploadDeadlineMs
      || now >= this.active.lastActivityAtMs + this.limits.assetUploadIdleMs
    ) {
      this.active = null;
    }
  }

  private assertLive(): void {
    if (this.destroyed) {
      throw new AssetUploadError(
        'INTERNAL',
        'Asset upload session is destroyed.',
      );
    }
  }
}
