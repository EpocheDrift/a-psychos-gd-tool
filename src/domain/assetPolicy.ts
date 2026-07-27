import type { AssetMetadata } from './documentSchema';
import type { JsonValue } from './json';
import {
  DEFAULT_AGENT_LIMITS,
  resolveAgentLimits,
  type AgentLimits,
} from './limits';
import { sha256BytesHex } from './sha256';

export const ASSET_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type AssetMimeType = (typeof ASSET_MIME_TYPES)[number];

export const ASSET_ID_PREFIX = 'asset_';
export const ASSET_ID_PATTERN = /^asset_[0-9a-f]{64}$/;

export const FACTORY_ASSET_METADATA: Readonly<AssetMetadata> = Object.freeze({
  id: 'asset_6756f325115e27086ff416a91823f7ed87085cb572f79c82b5072dd1b3da5df8',
  sha256: '6756f325115e27086ff416a91823f7ed87085cb572f79c82b5072dd1b3da5df8',
  mimeType: 'image/jpeg',
  byteLength: 987_604,
  width: 4752,
  height: 3168,
  source: 'bundled',
});

export interface PreparedAsset {
  metadata: AssetMetadata;
  /**
   * Bundled assets have no caller-controlled payload; their bytes are served
   * only from the fixed application route. Uploaded/generated assets carry an
   * owned immutable copy here until the asset repository commits them.
   */
  bytes?: Uint8Array;
}

export interface AssetPolicyIssue {
  code: 'INVALID_ARGUMENT' | 'ASSET_POLICY_VIOLATION' | 'RESOURCE_LIMIT';
  message: string;
  details?: Record<string, JsonValue>;
}

export type PrepareAssetResult =
  | { ok: true; asset: PreparedAsset }
  | { ok: false; issue: AssetPolicyIssue };

function readBigEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3]
  );
}

export function imageDimensionsFromBytes(
  mimeType: AssetMimeType,
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (
    mimeType === 'image/png'
    && bytes.length >= 24
    && [137, 80, 78, 71, 13, 10, 26, 10]
      .every((byte, index) => bytes[index] === byte)
  ) {
    return {
      width: readBigEndian(bytes, 16),
      height: readBigEndian(bytes, 20),
    };
  }

  if (
    mimeType === 'image/jpeg'
    && bytes.length >= 4
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
  ) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const size = bytes[offset + 2] * 256 + bytes[offset + 3];
      if (size < 2 || offset + size + 2 > bytes.length) return null;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
          0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
        ].includes(marker)
      ) {
        return {
          height: bytes[offset + 5] * 256 + bytes[offset + 6],
          width: bytes[offset + 7] * 256 + bytes[offset + 8],
        };
      }
      offset += size + 2;
    }
    return null;
  }

  if (
    mimeType === 'image/webp'
    && bytes.length >= 30
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X') {
      return {
        width: 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65_536,
        height: 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65_536,
      };
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      return {
        width: 1 + bytes[21] + (bytes[22] & 0x3f) * 256,
        height:
          1
          + (bytes[22] >> 6)
          + bytes[23] * 4
          + (bytes[24] & 0x0f) * 1024,
      };
    }
    if (
      chunk === 'VP8 '
      && bytes[23] === 0x9d
      && bytes[24] === 0x01
      && bytes[25] === 0x2a
    ) {
      return {
        width: (bytes[26] + bytes[27] * 256) & 0x3fff,
        height: (bytes[28] + bytes[29] * 256) & 0x3fff,
      };
    }
  }
  return null;
}

export function isAssetId(value: unknown): value is string {
  return typeof value === 'string' && ASSET_ID_PATTERN.test(value);
}

export function strictBase64DecodedLength(payload: string): number | null {
  if (
    payload.length === 0
    || payload.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)
  ) return null;
  const firstPadding = payload.indexOf('=');
  if (firstPadding !== -1 && firstPadding < payload.length - 2) return null;
  const padding = payload.endsWith('==')
    ? 2
    : payload.endsWith('=')
      ? 1
      : 0;
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (
    (padding === 2
      && (alphabet.indexOf(payload[payload.length - 3]) & 0x0f) !== 0)
    || (padding === 1
      && (alphabet.indexOf(payload[payload.length - 2]) & 0x03) !== 0)
  ) return null;
  const length = payload.length / 4 * 3 - padding;
  return Number.isSafeInteger(length) ? length : null;
}

export function decodeStrictBase64(
  payload: string,
  maximumBytes: number,
): Uint8Array | null {
  const byteLength = strictBase64DecodedLength(payload);
  if (byteLength === null || byteLength > maximumBytes) return null;
  const binary = atob(payload);
  if (binary.length !== byteLength) return null;
  const bytes = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function failure(
  code: AssetPolicyIssue['code'],
  message: string,
  details?: Record<string, JsonValue>,
): PrepareAssetResult {
  return {
    ok: false,
    issue: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

export function prepareAssetBytes(
  input: {
    bytes: Uint8Array;
    mimeType: AssetMimeType;
    source?: 'upload' | 'generated';
    expectedSha256?: string;
  },
  policy: Partial<AgentLimits> = {},
): PrepareAssetResult {
  const limits = resolveAgentLimits(policy);
  const byteLength = input.bytes.byteLength;
  if (byteLength <= 0) {
    return failure(
      'ASSET_POLICY_VIOLATION',
      'Asset bytes cannot be empty.',
    );
  }
  if (byteLength > limits.maxLegacyAssetBytes) {
    return failure(
      'RESOURCE_LIMIT',
      `Asset exceeds the ${limits.maxLegacyAssetBytes}-byte limit.`,
      { byteLength, maximumBytes: limits.maxLegacyAssetBytes },
    );
  }
  if (!ASSET_MIME_TYPES.includes(input.mimeType)) {
    return failure(
      'ASSET_POLICY_VIOLATION',
      'Asset MIME type is not supported.',
    );
  }
  const dimensions = imageDimensionsFromBytes(input.mimeType, input.bytes);
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return failure(
      'ASSET_POLICY_VIOLATION',
      'Asset header is invalid or does not match its declared MIME type.',
    );
  }
  const { width, height } = dimensions;
  if (width > limits.maxAssetSide || height > limits.maxAssetSide) {
    return failure(
      'RESOURCE_LIMIT',
      `Asset dimensions exceed the ${limits.maxAssetSide}-pixel side limit.`,
      {
        width,
        height,
        maximumSide: limits.maxAssetSide,
      },
    );
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > limits.maxAssetPixels) {
    return failure(
      'RESOURCE_LIMIT',
      `Asset exceeds the ${limits.maxAssetPixels}-pixel limit.`,
      {
        width,
        height,
        pixels,
        maximumPixels: limits.maxAssetPixels,
      },
    );
  }
  const sha256 = sha256BytesHex(input.bytes);
  if (
    input.expectedSha256 !== undefined
    && input.expectedSha256 !== sha256
  ) {
    return failure(
      'ASSET_POLICY_VIOLATION',
      'Asset SHA-256 does not match the declared digest.',
      {
        expectedSha256: input.expectedSha256,
        actualSha256: sha256,
      },
    );
  }
  const metadata: AssetMetadata = {
    id: `${ASSET_ID_PREFIX}${sha256}`,
    sha256,
    mimeType: input.mimeType,
    byteLength,
    width,
    height,
    source: input.source ?? 'upload',
  };
  return {
    ok: true,
    asset: {
      metadata,
      bytes: input.bytes.slice(),
    },
  };
}

export function prepareLegacyDataUri(
  source: string,
  policy: Partial<AgentLimits> = {},
): PrepareAssetResult | { ok: true; asset: null } {
  if (source === '') return { ok: true, asset: null };
  if (source === '/factory-image.jpg') {
    return {
      ok: true,
      asset: { metadata: { ...FACTORY_ASSET_METADATA } },
    };
  }
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/
      .exec(source);
  if (!match) {
    return failure(
      'ASSET_POLICY_VIOLATION',
      'Legacy image source is outside the bundled/embedded allowlist.',
    );
  }
  const limits = resolveAgentLimits(policy);
  const bytes = decodeStrictBase64(match[2], limits.maxLegacyAssetBytes);
  if (!bytes) {
    return failure(
      'ASSET_POLICY_VIOLATION',
      'Legacy image data is not strict bounded base64.',
    );
  }
  return prepareAssetBytes({
    bytes,
    mimeType: match[1] as AssetMimeType,
    source: 'upload',
  }, limits);
}

export function defaultAssetPolicy(): Readonly<AgentLimits> {
  return DEFAULT_AGENT_LIMITS;
}
