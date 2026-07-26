import type { AgentErrorCode } from '../domain/agentErrors';
import { AGENT_ERROR_CODES } from '../domain/agentErrors';
import type { JsonValue } from '../domain/json';
import type {
  AgentBridgeError,
  AgentBridgeErrorCode,
  AgentControllerFault,
} from './contracts';
import {
  redactDiagnosticDetails,
  redactDiagnosticString,
} from './redaction';

const controllerFaultInstances = new WeakSet<object>();

export function bridgeError(
  code: AgentBridgeErrorCode,
  message: string,
  options: {
    recoverable?: boolean;
    path?: string;
    details?: Record<string, JsonValue>;
    suggestedFix?: string;
  } = {},
): AgentBridgeError {
  return {
    code,
    message: redactDiagnosticString(message),
    recoverable: options.recoverable ?? code !== 'INTERNAL',
    ...(options.path !== undefined
      ? { path: redactDiagnosticString(options.path) }
      : {}),
    ...(options.details
      ? { details: redactDiagnosticDetails(options.details) }
      : {}),
    ...(options.suggestedFix
      ? { suggestedFix: redactDiagnosticString(options.suggestedFix) }
      : {}),
  };
}

export function controllerFault(
  revision: number,
  code: AgentBridgeErrorCode,
  message: string,
  options: Parameters<typeof bridgeError>[2] = {},
): AgentControllerFault {
  const fault: AgentControllerFault = {
    name: 'AgentControllerFault',
    ok: false,
    revision,
    error: bridgeError(code, message, options),
  };
  controllerFaultInstances.add(fault);
  return fault;
}

export function isControllerFault(value: unknown): value is AgentControllerFault {
  return (
    value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && controllerFaultInstances.has(value)
  );
}

function internalControllerFault(revision: number): AgentControllerFault {
  return controllerFault(
    revision,
    'INTERNAL',
    'The Agent operation failed without exposing internal diagnostics.',
    { recoverable: false },
  );
}

function ownDataValue(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

export function normalizeControllerFailure(
  error: unknown,
  revision: number,
): AgentControllerFault {
  if (isControllerFault(error)) return error;
  try {
    // Only real Error instances may contribute a known public error code.
    // Reading own data descriptors avoids invoking hostile getters. Every
    // reflective operation remains inside this fail-closed try block because
    // Proxy traps may throw even during `instanceof` or descriptor lookup.
    if (!(error instanceof Error)) return internalControllerFault(revision);
    const code = ownDataValue(error, 'code');
    if (
      typeof code !== 'string'
      || !(AGENT_ERROR_CODES as readonly string[]).includes(code)
    ) {
      return internalControllerFault(revision);
    }
    const bridgeCode = code as AgentErrorCode;
    const message = ownDataValue(error, 'message');
    const recoverable = ownDataValue(error, 'recoverable');
    return controllerFault(revision, bridgeCode, (
      bridgeCode === 'INTERNAL'
        ? 'The Agent operation failed without exposing internal diagnostics.'
        : typeof message === 'string'
          ? message
          : 'The Agent operation failed.'
    ), {
      recoverable:
        typeof recoverable === 'boolean'
          ? recoverable
          : bridgeCode !== 'INTERNAL',
    });
  } catch {
    return internalControllerFault(revision);
  }
}
