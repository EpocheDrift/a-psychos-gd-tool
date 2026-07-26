import {
  validateJsonValueSafety,
} from '../domain/documentSchema';
import {
  MISSING,
  boundedCanonicalJsonByteLength,
  cloneJsonValue,
  isPlainRecord,
  readOwnData,
  type JsonObject,
  type JsonValue,
} from '../domain/json';
import { DEFAULT_AGENT_LIMITS } from '../domain/limits';
import { controllerFault } from './faults';

const MAX_PUBLIC_JSON_BYTES = 4 * 1024 * 1024;

export interface CaptureObjectOptions {
  optional?: boolean;
  allowedKeys: readonly string[];
  maxBytes?: number;
  revision: number;
  label: string;
}

/**
 * Capture untrusted input without invoking getters or `toJSON`. Proxy traps can
 * still run in JavaScript, so callers must perform this before any state
 * updater and re-check their session after capture.
 */
export function captureJsonObject(
  value: unknown,
  options: CaptureObjectOptions,
): JsonObject {
  const candidate = value === undefined && options.optional ? {} : value;
  const safety = validateJsonValueSafety(candidate, { maxFindings: 1 });
  if (!safety.valid) {
    const finding = safety.errors[0]!;
    throw controllerFault(
      options.revision,
      finding.code === 'RESOURCE_LIMIT' ? 'RESOURCE_LIMIT' : 'INVALID_ARGUMENT',
      `${options.label} is not safe JSON: ${finding.message}`,
      {
        path: finding.path,
        details: finding.details,
        recoverable: finding.recoverable,
      },
    );
  }
  if (!isPlainRecord(candidate)) {
    throw controllerFault(
      options.revision,
      'INVALID_ARGUMENT',
      `${options.label} must be a plain object.`,
      { path: '' },
    );
  }
  const maximum = options.maxBytes ?? DEFAULT_AGENT_LIMITS.maxTransactionJsonBytes;
  const byteLength = boundedCanonicalJsonByteLength(
    candidate as JsonObject,
    maximum,
  );
  if (byteLength > maximum) {
    throw controllerFault(
      options.revision,
      'RESOURCE_LIMIT',
      `${options.label} exceeds ${maximum} UTF-8 JSON bytes.`,
      {
        path: '',
        details: {
          actualBytesAtLeast: byteLength,
          maximumBytes: maximum,
        },
      },
    );
  }
  const allowed = new Set(options.allowedKeys);
  const unknown = Object.keys(candidate).sort().find((key) => !allowed.has(key));
  if (unknown) {
    throw controllerFault(
      options.revision,
      'INVALID_ARGUMENT',
      `Unknown ${options.label} field "${unknown}".`,
      { path: `/${unknown.replace(/~/g, '~0').replace(/\//g, '~1')}` },
    );
  }
  return cloneJsonValue(candidate as JsonObject);
}

export function own(
  object: JsonObject,
  key: string,
): JsonValue | undefined {
  const value = readOwnData(object, key);
  return value === MISSING ? undefined : value as JsonValue;
}

export function requireString(
  object: JsonObject,
  key: string,
  revision: number,
  options: {
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
  } = {},
): string {
  const value = own(object, key);
  const minLength = options.minLength ?? 1;
  const maxLength = options.maxLength ?? DEFAULT_AGENT_LIMITS.maxStringBytes;
  if (
    typeof value !== 'string'
    || value.length < minLength
    || value.length > maxLength
    || (options.pattern && !options.pattern.test(value))
  ) {
    throw controllerFault(
      revision,
      'INVALID_ARGUMENT',
      `${key} must be a string between ${minLength} and ${maxLength} characters.`,
      { path: `/${key}` },
    );
  }
  return value;
}

export function optionalBoolean(
  object: JsonObject,
  key: string,
  revision: number,
  fallback: boolean,
): boolean {
  const value = own(object, key);
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    throw controllerFault(
      revision,
      'INVALID_ARGUMENT',
      `${key} must be a boolean.`,
      { path: `/${key}` },
    );
  }
  return value;
}

export function optionalNonNegativeInteger(
  object: JsonObject,
  key: string,
  revision: number,
): number | undefined {
  const value = own(object, key);
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    throw controllerFault(
      revision,
      'INVALID_ARGUMENT',
      `${key} must be a non-negative safe integer.`,
      { path: `/${key}` },
    );
  }
  return value;
}

export function optionalPositiveInteger(
  object: JsonObject,
  key: string,
  revision: number,
): number | undefined {
  const value = optionalNonNegativeInteger(object, key, revision);
  if (value === undefined) return undefined;
  if (value === 0) {
    throw controllerFault(
      revision,
      'INVALID_ARGUMENT',
      `${key} must be a positive safe integer.`,
      { path: `/${key}` },
    );
  }
  return value;
}

export function optionalStringArray(
  object: JsonObject,
  key: string,
  revision: number,
  options: {
    maximum: number;
    allowed?: ReadonlySet<string>;
    unique?: boolean;
  },
): string[] | undefined {
  const value = own(object, key);
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > options.maximum) {
    throw controllerFault(
      revision,
      'INVALID_ARGUMENT',
      `${key} must be an array with at most ${options.maximum} entries.`,
      { path: `/${key}` },
    );
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    if (
      typeof item !== 'string'
      || item.length === 0
      || item.length > DEFAULT_AGENT_LIMITS.maxIdLength
      || (options.allowed && !options.allowed.has(item))
      || (options.unique !== false && seen.has(item))
    ) {
      throw controllerFault(
        revision,
        'INVALID_ARGUMENT',
        `${key} contains an invalid or duplicate string.`,
        { path: `/${key}/${index}` },
      );
    }
    seen.add(item);
    result.push(item);
  }
  return result;
}

/** Make the JSON guarantee explicit at the final public boundary. */
export function publicJsonClone<T>(value: T): T {
  const safety = validateJsonValueSafety(value, { maxFindings: 1 });
  if (!safety.valid) {
    throw controllerFault(
      0,
      'INTERNAL',
      'An internal result violated the public JSON contract.',
      { recoverable: false },
    );
  }
  const byteLength = boundedCanonicalJsonByteLength(
    value as JsonValue,
    MAX_PUBLIC_JSON_BYTES,
  );
  if (byteLength > MAX_PUBLIC_JSON_BYTES) {
    throw controllerFault(
      0,
      'INTERNAL',
      'An internal result exceeded the bounded public JSON contract.',
      { recoverable: false },
    );
  }
  return cloneJsonValue(value as JsonValue) as T;
}
