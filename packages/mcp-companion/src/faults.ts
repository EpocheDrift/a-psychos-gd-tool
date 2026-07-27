import { COMPANION_TRANSPORT_LIMITS } from './protocol.js';

export interface PublicAgentFault {
  name: 'AgentControllerFault';
  ok: false;
  revision: number;
  requestId?: string;
  error: {
    code: string;
    message: string;
    recoverable: boolean;
    path?: string;
    commandIndex?: number;
    details?: Record<string, unknown>;
    suggestedFix?: string;
  };
}

const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SAFE_REQUEST_ID =
  /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OUTER_FAULT_KEYS = new Set([
  'name',
  'ok',
  'revision',
  'requestId',
  'error',
]);
const ERROR_KEYS = new Set([
  'code',
  'message',
  'recoverable',
  'path',
  'commandIndex',
  'details',
  'suggestedFix',
]);

export class CompanionFault extends Error {
  readonly publicFault: PublicAgentFault;

  constructor(
    code: string,
    message: string,
    options: {
      revision?: number;
      requestId?: string;
      recoverable?: boolean;
      path?: string;
      details?: Record<string, unknown>;
      suggestedFix?: string;
    } = {},
  ) {
    super(message);
    this.name = 'CompanionFault';
    this.publicFault = {
      name: 'AgentControllerFault',
      ok: false,
      revision:
        Number.isSafeInteger(options.revision)
        && (options.revision ?? -1) >= 0
          ? options.revision!
          : 0,
      ...(options.requestId ? { requestId: options.requestId } : {}),
      error: {
        code: SAFE_CODE.test(code) ? code : 'INTERNAL',
        message,
        recoverable: options.recoverable ?? true,
        ...(options.path ? { path: options.path } : {}),
        ...(options.details ? { details: options.details } : {}),
        ...(options.suggestedFix
          ? { suggestedFix: options.suggestedFix }
          : {}),
      },
    };
  }
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedJsonRecord(value: unknown): value is Record<string, unknown> {
  if (!plainRecord(value)) return false;
  const stack: Array<{ value: unknown; depth: number }> = [{
    value,
    depth: 0,
  }];
  const seen = new Set<object>();
  let values = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    values++;
    if (
      values > COMPANION_TRANSPORT_LIMITS.maxJsonValues
      || current.depth > COMPANION_TRANSPORT_LIMITS.maxJsonDepth
    ) {
      return false;
    }
    if (
      current.value === null
      || typeof current.value === 'string'
      || typeof current.value === 'boolean'
    ) {
      continue;
    }
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) return false;
      continue;
    }
    if (typeof current.value !== 'object' || seen.has(current.value)) {
      return false;
    }
    seen.add(current.value);
    const prototype = Object.getPrototypeOf(current.value);
    if (Array.isArray(current.value)) {
      if (prototype !== Array.prototype) return false;
      for (let index = 0; index < current.value.length; index++) {
        if (!Object.hasOwn(current.value, index)) return false;
        stack.push({
          value: current.value[index],
          depth: current.depth + 1,
        });
      }
      continue;
    }
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(current.value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (
        !('value' in descriptor)
        || key === '__proto__'
        || key === 'constructor'
        || key === 'prototype'
      ) {
        return false;
      }
      stack.push({
        value: descriptor.value,
        depth: current.depth + 1,
      });
    }
  }
  return true;
}

export function isPublicAgentFault(
  value: unknown,
): value is PublicAgentFault {
  try {
    if (
      !plainRecord(value)
      || !hasOnlyKeys(value, OUTER_FAULT_KEYS)
      || value.ok !== false
      || value.name !== 'AgentControllerFault'
      || !Number.isSafeInteger(value.revision)
      || (value.revision as number) < 0
      || (
        value.requestId !== undefined
        && (
          typeof value.requestId !== 'string'
          || !SAFE_REQUEST_ID.test(value.requestId)
        )
      )
      || !plainRecord(value.error)
      || !hasOnlyKeys(value.error, ERROR_KEYS)
    ) {
      return false;
    }
    const error = value.error;
    return typeof error.code === 'string'
      && SAFE_CODE.test(error.code)
      && typeof error.message === 'string'
      && error.message.length <= 2_048
      && typeof error.recoverable === 'boolean'
      && (
        error.path === undefined
        || (
          typeof error.path === 'string'
          && error.path.length <= 1_024
        )
      )
      && (
        error.commandIndex === undefined
        || (
          Number.isSafeInteger(error.commandIndex)
          && (error.commandIndex as number) >= 0
        )
      )
      && (
        error.details === undefined
        || isBoundedJsonRecord(error.details)
      )
      && (
        error.suggestedFix === undefined
        || (
          typeof error.suggestedFix === 'string'
          && error.suggestedFix.length <= 2_048
        )
      );
  } catch {
    return false;
  }
}

export function publicFaultFromUnknown(error: unknown): PublicAgentFault {
  if (error instanceof CompanionFault) return error.publicFault;
  if (isPublicAgentFault(error)) return error;
  return new CompanionFault(
    'INTERNAL',
    'The local companion failed safely.',
    { recoverable: false },
  ).publicFault;
}
