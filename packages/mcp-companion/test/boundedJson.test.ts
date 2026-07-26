import { describe, expect, it, vi } from 'vitest';
import { assertBoundedWireJson } from '../src/boundedJson.js';
import { COMPANION_TRANSPORT_LIMITS } from '../src/protocol.js';

describe('bounded companion JSON', () => {
  it('rejects values beyond the declared depth and count budgets', () => {
    let nested: Record<string, unknown> = {};
    for (
      let depth = 0;
      depth <= COMPANION_TRANSPORT_LIMITS.maxJsonDepth;
      depth++
    ) {
      nested = { nested };
    }
    expect(() => assertBoundedWireJson(nested)).toThrow('JSON depth');

    expect(() => assertBoundedWireJson(Array.from(
      { length: COMPANION_TRANSPORT_LIMITS.maxJsonValues },
      () => null,
    ))).toThrow('JSON depth or value budget');
  });

  it('rejects accessors and repeated identities without invoking getters', () => {
    const getter = vi.fn(() => 'secret');
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, 'value', {
      enumerable: true,
      get: getter,
    });
    expect(() => assertBoundedWireJson(accessor)).toThrow('accessor');
    expect(getter).not.toHaveBeenCalled();

    const shared = {};
    expect(() => assertBoundedWireJson({ left: shared, right: shared }))
      .toThrow('repeated object identities');
  });
});
