import { describe, expect, it } from 'vitest';
import {
  boundedCanonicalJsonByteLength,
  canonicalJsonStringify,
  utf8ByteLength,
  type JsonValue,
} from './json';

describe('bounded canonical JSON byte measurement', () => {
  it('matches canonical serialization for escapes, Unicode, and containers', () => {
    const values: JsonValue[] = [
      null,
      true,
      false,
      -0,
      1.25e30,
      'plain',
      '"\\\b\t\n\f\r\u0000',
      'é中😀',
      '\ud800',
      ['a', 1, false, { z: 'last', a: 'first' }],
      { z: [1, 2, 3], a: { nested: 'value' } },
    ];
    for (const value of values) {
      const canonical = canonicalJsonStringify(value);
      expect(boundedCanonicalJsonByteLength(value, 10_000))
        .toBe(utf8ByteLength(canonical));
    }
  });

  it('stops at maximum + 1 without serializing a monolithic value', () => {
    const value: JsonValue = { payload: 'x'.repeat(10_000) };
    expect(boundedCanonicalJsonByteLength(value, 64)).toBe(65);
    expect(boundedCanonicalJsonByteLength(value, 0)).toBe(1);
  });
});
