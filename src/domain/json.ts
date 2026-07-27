export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const MISSING = Symbol('missing-own-data-property');

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Read an own data property without invoking a getter inherited from a hostile
 * object. Import validation calls this before treating any value as trusted.
 */
export function readOwnData(
  object: Record<PropertyKey, unknown>,
  key: PropertyKey,
): unknown | typeof MISSING {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && 'value' in descriptor ? descriptor.value : MISSING;
}

export function hasOwnData(
  object: Record<PropertyKey, unknown>,
  key: PropertyKey,
): boolean {
  return readOwnData(object, key) !== MISSING;
}

export function escapeJsonPointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function joinJsonPointer(base: string, token: string | number): string {
  return `${base}/${escapeJsonPointerToken(String(token))}`;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedJsonStringByteLength(value: string, maximum: number): number {
  let bytes = 2; // opening and closing quotes
  for (let index = 0; index < value.length && bytes <= maximum; index++) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) {
      bytes += 2;
    } else if (
      code === 0x08
      || code === 0x09
      || code === 0x0a
      || code === 0x0c
      || code === 0x0d
    ) {
      bytes += 2;
    } else if (code <= 0x1f) {
      bytes += 6;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4;
        index++;
      } else {
        // Well-formed JSON.stringify escapes lone surrogates as "\\udxxx".
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
  }
  return bytes > maximum ? maximum + 1 : bytes;
}

/**
 * Measure canonical JSON UTF-8 bytes without first allocating one monolithic
 * serialized string. Input must already have passed JSON-safety validation.
 * Returns `maximum + 1` as soon as the limit is exceeded.
 */
export function boundedCanonicalJsonByteLength(
  value: JsonValue,
  maximum: number,
): number {
  const cap = Number.isSafeInteger(maximum) && maximum >= 0
    ? maximum
    : Number.MAX_SAFE_INTEGER;
  const add = (total: number, amount: number): number => {
    if (total > cap || amount > cap - total) return cap + 1;
    return total + amount;
  };
  const measure = (item: JsonValue): number => {
    if (item === null) return 4;
    if (typeof item === 'boolean') return item ? 4 : 5;
    if (typeof item === 'number') return JSON.stringify(item).length;
    if (typeof item === 'string') return boundedJsonStringByteLength(item, cap);
    if (Array.isArray(item)) {
      let total = 2;
      for (let index = 0; index < item.length; index++) {
        if (index > 0) total = add(total, 1);
        total = add(total, measure(item[index]));
        if (total > cap) return cap + 1;
      }
      return total;
    }
    let total = 2;
    const keys = Object.keys(item).sort();
    for (let index = 0; index < keys.length; index++) {
      if (index > 0) total = add(total, 1);
      total = add(total, boundedJsonStringByteLength(keys[index], cap));
      total = add(total, 1);
      const child = readOwnData(item, keys[index]);
      if (child !== MISSING) total = add(total, measure(child as JsonValue));
      if (total > cap) return cap + 1;
    }
    return total;
  };
  return measure(value);
}

export function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Clone already-validated JSON data without consulting `toJSON`. */
export function cloneJsonValue<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const clone = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(value)) {
      const child = readOwnData(value, key);
      if (child === MISSING) continue;
      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: cloneJsonValue(child as JsonValue),
      });
    }
    return clone as T;
  }
  return value;
}

/** Deterministic JSON text used by project export and future request digests. */
export function canonicalJsonStringify(value: JsonValue, space = 0): string {
  const normalize = (item: JsonValue): JsonValue => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === 'object') {
      const result = Object.create(null) as Record<string, JsonValue>;
      for (const key of Object.keys(item).sort()) {
        const child = readOwnData(item, key);
        if (child === MISSING) continue;
        Object.defineProperty(result, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: normalize(child as JsonValue),
        });
      }
      return result;
    }
    return item;
  };
  return JSON.stringify(normalize(value), null, space);
}
