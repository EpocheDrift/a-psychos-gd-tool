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
