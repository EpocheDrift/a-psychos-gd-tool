import { CompanionFault } from './faults.js';
import { COMPANION_TRANSPORT_LIMITS } from './protocol.js';

interface StackItem {
  value: unknown;
  depth: number;
}

export function assertBoundedWireJson(value: unknown): void {
  const stack: StackItem[] = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let values = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    values++;
    if (
      values > COMPANION_TRANSPORT_LIMITS.maxJsonValues
      || current.depth > COMPANION_TRANSPORT_LIMITS.maxJsonDepth
    ) {
      throw new CompanionFault(
        'RESOURCE_LIMIT',
        'The MCP request exceeds the JSON depth or value budget.',
      );
    }
    if (
      current.value === null
      || typeof current.value === 'string'
      || typeof current.value === 'boolean'
    ) {
      continue;
    }
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) {
        throw new CompanionFault(
          'INVALID_ARGUMENT',
          'The MCP request contains a non-finite number.',
        );
      }
      continue;
    }
    if (typeof current.value !== 'object') {
      throw new CompanionFault(
        'INVALID_ARGUMENT',
        'The MCP request must contain only JSON values.',
      );
    }
    if (seen.has(current.value)) {
      throw new CompanionFault(
        'INVALID_ARGUMENT',
        'The MCP request cannot contain repeated object identities.',
      );
    }
    seen.add(current.value);
    const prototype = Object.getPrototypeOf(current.value);
    if (Array.isArray(current.value)) {
      if (prototype !== Array.prototype) {
        throw new CompanionFault(
          'INVALID_ARGUMENT',
          'The MCP request contains a non-plain array.',
        );
      }
      for (let index = current.value.length - 1; index >= 0; index--) {
        if (!Object.hasOwn(current.value, index)) {
          throw new CompanionFault(
            'INVALID_ARGUMENT',
            'The MCP request contains a sparse array.',
          );
        }
        stack.push({
          value: current.value[index],
          depth: current.depth + 1,
        });
      }
      continue;
    }
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CompanionFault(
        'INVALID_ARGUMENT',
        'The MCP request contains a non-plain object.',
      );
    }
    const descriptors = Object.getOwnPropertyDescriptors(current.value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!('value' in descriptor)) {
        throw new CompanionFault(
          'INVALID_ARGUMENT',
          'The MCP request contains an accessor property.',
        );
      }
      if (
        key === '__proto__'
        || key === 'constructor'
        || key === 'prototype'
      ) {
        throw new CompanionFault(
          'INVALID_ARGUMENT',
          'The MCP request contains a prototype-sensitive object key.',
        );
      }
      stack.push({
        value: descriptor.value,
        depth: current.depth + 1,
      });
    }
  }
}
