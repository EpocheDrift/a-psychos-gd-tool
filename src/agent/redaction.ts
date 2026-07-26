import {
  cloneJsonValue,
  type JsonObject,
  type JsonValue,
} from '../domain/json';
import { sha256Hex } from '../domain/sha256';

const DATA_URI = /^data:/i;
const BLOB_URI = /^blob:/i;
const EMBEDDED_URI = /\b(?:data|blob):[^\s"'<>]*/gi;
const BEARER_SECRET = /\bbearer\s+[A-Za-z0-9._~+/=-]+/gi;
const NAMED_SECRET =
  /\b(authorization|cookie|password|secret|(?:access|refresh|session|claim)?token|nonce)\b\s*[:=]\s*[^\s,;]+/gi;
const MAX_DIAGNOSTIC_STRING = 512;
const MAX_DIAGNOSTIC_DEPTH = 12;
const MAX_DIAGNOSTIC_ITEMS = 128;

export function redactDiagnosticString(
  value: string,
  maximum = MAX_DIAGNOSTIC_STRING,
): string {
  const redacted = value
    .replace(EMBEDDED_URI, (match) =>
      match.toLowerCase().startsWith('data:')
        ? '[redacted data URI]'
        : '[redacted browser object URL]')
    .replace(BEARER_SECRET, 'Bearer [redacted]')
    .replace(NAMED_SECRET, (_match, name: string) => `${name}=[redacted]`);
  if (redacted.length <= maximum) return redacted;
  const digest = sha256Hex(`gfx.agent.diagnostic.v1\u0000${value}`).slice(0, 16);
  return `${redacted.slice(0, maximum)}…[truncated; sha256:${digest}]`;
}

function sensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return normalized.includes('authorization')
    || normalized.includes('bearer')
    || normalized.includes('cookie')
    || normalized.includes('secret')
    || normalized.endsWith('token')
    || normalized.endsWith('nonce')
    || normalized.endsWith('password')
    || normalized.endsWith('bytes')
    || normalized.endsWith('byte')
    || normalized.endsWith('base64')
    || normalized.endsWith('fontdata')
    || normalized.endsWith('imagedata');
}

function redact(
  value: JsonValue,
  key: string,
  depth: number,
): JsonValue {
  if (sensitiveKey(key)) return '[redacted]';
  if (typeof value === 'string') {
    if (DATA_URI.test(value)) return `[redacted data URI; ${value.length} characters]`;
    if (BLOB_URI.test(value)) return '[redacted browser object URL]';
    return redactDiagnosticString(value);
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DIAGNOSTIC_DEPTH) return '[redacted deep value]';
  if (Array.isArray(value)) {
    const visible = value
      .slice(0, MAX_DIAGNOSTIC_ITEMS)
      .map((item) => redact(item, '', depth + 1));
    if (value.length > visible.length) {
      visible.push(`[truncated ${value.length - visible.length} items]`);
    }
    return visible;
  }
  const output = Object.create(null) as JsonObject;
  const keys = Object.keys(value).sort();
  for (const [index, childKey] of keys
    .slice(0, MAX_DIAGNOSTIC_ITEMS)
    .entries()) {
    const baseKey = sensitiveKey(childKey)
      ? '[redacted field]'
      : redactDiagnosticString(childKey, 128);
    let publicKey = baseKey || '[empty field]';
    if (Object.hasOwn(output, publicKey)) {
      publicKey = `${publicKey}#${index + 1}`;
    }
    output[publicKey] = redact(value[childKey], childKey, depth + 1);
  }
  if (keys.length > MAX_DIAGNOSTIC_ITEMS) {
    output._truncated = `${keys.length - MAX_DIAGNOSTIC_ITEMS} fields`;
  }
  return output;
}

/** Redact data intended for diagnostics, never normal document/query output. */
export function redactDiagnosticDetails(
  details: Record<string, JsonValue>,
): Record<string, JsonValue> {
  return redact(
    cloneJsonValue(details as JsonObject),
    '',
    0,
  ) as Record<string, JsonValue>;
}
