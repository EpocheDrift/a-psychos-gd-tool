import type { JsonValue } from './json';
import { DEFAULT_AGENT_LIMITS, type AgentLimits } from './limits';
import {
  MISSING,
  isPlainRecord,
  joinJsonPointer,
  readOwnData,
  utf8ByteLength,
} from './json';

export const RESERVED_IDENTIFIERS = new Set(['__proto__', 'constructor', 'prototype']);
export const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
export const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const BIND_TARGETS = ['scale', 'rotation', 'blur'] as const;

export interface PublicBind {
  channel: string;
  target: (typeof BIND_TARGETS)[number];
  amount: number;
  invert: boolean;
  offset: number;
}

export interface CodecIssue {
  code?: 'INVALID_ARGUMENT' | 'RESOURCE_LIMIT';
  path: string;
  message: string;
  details?: Record<string, JsonValue>;
}

export type BindsDecodeResult =
  | { ok: true; value: PublicBind[] }
  | { ok: false; issues: CodecIssue[] };

export function isSafeId(value: string, maxLength = 128): boolean {
  return value.length <= maxLength
    && SAFE_ID_PATTERN.test(value)
    && !RESERVED_IDENTIFIERS.has(value);
}

export function isSafeChannelName(value: string, maxLength = 128): boolean {
  const length = [...value].length;
  return length > 0
    && length <= maxLength
    && !RESERVED_IDENTIFIERS.has(value)
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function decodeBinds(
  value: unknown,
  maxItems: number,
  maxBytes = 64 * 1024,
  maxChannelLength = 128,
): BindsDecodeResult {
  if (typeof value !== 'string') {
    return {
      ok: false,
      issues: [{ path: '', message: 'Binds must use the persisted JSON-string representation.' }],
    };
  }
  const encodedBytes = utf8ByteLength(value);
  if (encodedBytes > maxBytes) {
    return {
      ok: false,
      issues: [{
        code: 'RESOURCE_LIMIT',
        path: '',
        message: `Binds exceeds ${maxBytes} UTF-8 bytes.`,
        details: { actualBytes: encodedBytes, maximumBytes: maxBytes },
      }],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      ok: false,
      issues: [{ path: '', message: 'Binds is not valid JSON.' }],
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      issues: [{ path: '', message: 'Binds must decode to an array.' }],
    };
  }

  const issues: CodecIssue[] = [];
  if (parsed.length > maxItems) {
    issues.push({
      code: 'RESOURCE_LIMIT',
      path: '',
      message: `Binds contains more than ${maxItems} rows.`,
      details: { actual: parsed.length, maximum: maxItems },
    });
  }

  const result: PublicBind[] = [];
  parsed.slice(0, maxItems).forEach((row, index) => {
    const rowPath = `/${index}`;
    if (!isPlainRecord(row)) {
      issues.push({ path: rowPath, message: 'A bind row must be an object.' });
      return;
    }
    const allowed = new Set(['channel', 'target', 'amount', 'invert', 'offset']);
    for (const key of Object.keys(row).sort()) {
      if (!allowed.has(key)) {
        issues.push({
          path: joinJsonPointer(rowPath, key),
          message: `Unknown bind field "${key}".`,
        });
      }
    }

    const channel = readOwnData(row, 'channel');
    const target = readOwnData(row, 'target');
    const amount = readOwnData(row, 'amount');
    const rawInvert = readOwnData(row, 'invert');
    const rawOffset = readOwnData(row, 'offset');
    const invert = rawInvert === MISSING ? false : rawInvert;
    const offset = rawOffset === MISSING ? 0 : rawOffset;

    if (typeof channel !== 'string' || !isSafeChannelName(channel, maxChannelLength)) {
      issues.push({
        path: `${rowPath}/channel`,
        message: `Bind channel must be a safe non-empty name of at most ${maxChannelLength} characters.`,
      });
    }
    if (typeof target !== 'string' || !BIND_TARGETS.includes(target as PublicBind['target'])) {
      issues.push({
        path: `${rowPath}/target`,
        message: 'Bind target must be scale, rotation, or blur.',
      });
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      issues.push({ path: `${rowPath}/amount`, message: 'Bind amount must be a finite number.' });
    } else if (
      (target === 'scale' || target === 'rotation')
        ? amount < 0 || amount > 1
        : target === 'blur' && (amount < 0 || amount > 64)
    ) {
      issues.push({
        path: `${rowPath}/amount`,
        message: target === 'blur'
          ? 'Blur bind amount must be between 0 and 64.'
          : 'Scale and rotation bind amounts must be between 0 and 1.',
      });
    }
    if (typeof invert !== 'boolean') {
      issues.push({ path: `${rowPath}/invert`, message: 'Bind invert must be boolean.' });
    }
    if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < -1 || offset > 1) {
      issues.push({ path: `${rowPath}/offset`, message: 'Bind offset must be a finite number between -1 and 1.' });
    }

    if (
      typeof channel === 'string'
      && isSafeChannelName(channel, maxChannelLength)
      && typeof target === 'string'
      && BIND_TARGETS.includes(target as PublicBind['target'])
      && typeof amount === 'number'
      && Number.isFinite(amount)
      && ((target === 'blur' && amount >= 0 && amount <= 64)
        || ((target === 'scale' || target === 'rotation') && amount >= 0 && amount <= 1))
      && typeof invert === 'boolean'
      && typeof offset === 'number'
      && Number.isFinite(offset)
      && offset >= -1
      && offset <= 1
    ) {
      result.push({ channel, target: target as PublicBind['target'], amount, invert, offset });
    }
  });

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: result };
}

export function encodeBinds(
  value: readonly PublicBind[],
  limits: Pick<AgentLimits, 'maxBinds' | 'maxStringBytes' | 'maxIdLength'> = DEFAULT_AGENT_LIMITS,
): string {
  const encoded = JSON.stringify(value.map((bind) => ({
    channel: bind.channel,
    target: bind.target,
    amount: bind.amount,
    invert: bind.invert,
    offset: bind.offset,
  })));
  const checked = decodeBinds(
    encoded,
    limits.maxBinds,
    limits.maxStringBytes,
    Math.min(128, limits.maxIdLength),
  );
  if (!checked.ok) {
    throw new TypeError(`Cannot encode invalid binds: ${checked.issues[0]?.message ?? 'invalid value'}`);
  }
  return encoded;
}

export function validatePositiveNumberList(
  value: string,
  maxBytes: number,
  maxItems = 64,
): CodecIssue[] {
  const issues: CodecIssue[] = [];
  if (utf8ByteLength(value) > maxBytes) {
    issues.push({
      path: '',
      message: `Number list exceeds ${maxBytes} UTF-8 bytes.`,
      details: { maximumBytes: maxBytes },
    });
    return issues;
  }
  const tokens = value.trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > maxItems) {
    issues.push({
      path: '',
      message: `Number list must contain between 1 and ${maxItems} values.`,
      details: { actualItems: tokens.length, maximumItems: maxItems },
    });
  }
  tokens.slice(0, maxItems).forEach((token, index) => {
    const number = Number(token);
    if (!Number.isFinite(number) || number <= 0) {
      issues.push({
        path: `/${index}`,
        message: 'Number-list entries must be finite and greater than zero.',
      });
    }
  });
  return issues;
}

export interface ImageSourceInfo {
  kind: 'empty' | 'bundled' | 'data';
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  byteLength: number;
  width?: number;
  height?: number;
}

export type ImageSourceResult =
  | { ok: true; value: ImageSourceInfo }
  | { ok: false; issue: CodecIssue };

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64Prefix(payload: string, maxBytes: number): Uint8Array {
  const outputLength = Math.min(maxBytes, Math.floor((payload.length * 3) / 4));
  const output = new Uint8Array(outputLength);
  let offset = 0;
  for (let index = 0; index < payload.length && offset < outputLength; index += 4) {
    const a = BASE64_ALPHABET.indexOf(payload[index]);
    const b = BASE64_ALPHABET.indexOf(payload[index + 1]);
    const c = payload[index + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(payload[index + 2]);
    const d = payload[index + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(payload[index + 3]);
    const bits = (a << 18) | (b << 12) | (c << 6) | d;
    output[offset++] = (bits >> 16) & 0xff;
    if (offset < outputLength && payload[index + 2] !== '=') output[offset++] = (bits >> 8) & 0xff;
    if (offset < outputLength && payload[index + 3] !== '=') output[offset++] = bits & 0xff;
  }
  return output.subarray(0, offset);
}

function readBigEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3]
  );
}

function imageDimensions(
  mimeType: ImageSourceInfo['mimeType'],
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (
    mimeType === 'image/png'
    && bytes.length >= 24
    && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  ) {
    return { width: readBigEndian(bytes, 16), height: readBigEndian(bytes, 20) };
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
      if (size < 2) return null;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]
          .includes(marker)
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
        height: 1 + (bytes[22] >> 6) + bytes[23] * 4 + (bytes[24] & 0x0f) * 1024,
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

export function validateImageSource(
  value: unknown,
  maxBytes: number,
  maxPixels: number,
): ImageSourceResult {
  if (typeof value !== 'string') {
    return { ok: false, issue: { path: '', message: 'Image source must be a string.' } };
  }
  if (value === '') return { ok: true, value: { kind: 'empty', byteLength: 0 } };
  if (value === '/factory-image.jpg') {
    return { ok: true, value: { kind: 'bundled', byteLength: 0 } };
  }

  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) {
    return {
      ok: false,
      issue: {
        path: '',
        message: 'Image source must be empty, the bundled factory image, or a strict base64 PNG/JPEG/WebP data URI.',
      },
    };
  }

  const payload = match[2];
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const byteLength = (payload.length / 4) * 3 - padding;
  if (byteLength > maxBytes) {
    return {
      ok: false,
      issue: {
        path: '',
        message: `Embedded image exceeds the ${maxBytes}-byte limit.`,
        details: { byteLength, maximumBytes: maxBytes },
      },
    };
  }

  const mimeType = match[1] as ImageSourceInfo['mimeType'];
  const dimensions = imageDimensions(mimeType, decodeBase64Prefix(payload, 1024 * 1024));
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return {
      ok: false,
      issue: {
        path: '',
        message: 'Embedded image header is invalid or does not match its declared MIME type.',
      },
    };
  }
  const pixels = dimensions.width * dimensions.height;
  if (!Number.isSafeInteger(pixels) || pixels > maxPixels) {
    return {
      ok: false,
      issue: {
        path: '',
        message: `Embedded image exceeds the ${maxPixels}-pixel limit.`,
        details: {
          width: dimensions.width,
          height: dimensions.height,
          pixels,
          maximumPixels: maxPixels,
        },
      },
    };
  }

  return {
    ok: true,
    value: {
      kind: 'data',
      mimeType,
      byteLength,
      width: dimensions.width,
      height: dimensions.height,
    },
  };
}
