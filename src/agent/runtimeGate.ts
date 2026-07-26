import type { JsonValue } from '../domain/json';
import type { AgentBridgeError } from './contracts';
import { bridgeError } from './faults';

export interface AgentRuntimeContext {
  origin: string;
  host: string;
  hostname: string;
  protocol: string;
  topLevel: boolean;
  secureContext: boolean;
}

export type AgentRuntimeGateResult =
  | {
      ok: true;
      context: AgentRuntimeContext;
      allowedOrigin: string;
    }
  | {
      ok: false;
      error: AgentBridgeError;
    };

export function browserRuntimeContext(
  target: Pick<Window, 'location' | 'top' | 'self' | 'isSecureContext'>,
): AgentRuntimeContext {
  return {
    origin: target.location.origin,
    host: target.location.host,
    hostname: target.location.hostname,
    protocol: target.location.protocol,
    topLevel: target.top === target.self,
    secureContext: target.isSecureContext,
  };
}

function denied(
  message: string,
  details?: Record<string, JsonValue>,
): AgentRuntimeGateResult {
  return {
    ok: false,
    error: bridgeError(
      'ORIGIN_NOT_ALLOWED',
      message,
      {
        recoverable: false,
        ...(details ? { details } : {}),
      },
    ),
  };
}

/**
 * This validates the page that owns the JavaScript realm. A direct browser
 * global has no trustworthy caller-origin signal; PR6 separately validates
 * HTTP Host and WebSocket Origin on every transport request.
 */
export function evaluateAgentRuntimeGate(
  context: AgentRuntimeContext,
  allowedOriginText: string,
): AgentRuntimeGateResult {
  let allowed: URL;
  try {
    allowed = new URL(allowedOriginText);
  } catch {
    return denied('The Agent build has no valid exact allowed origin.');
  }
  if (
    allowed.username
    || allowed.password
    || allowed.pathname !== '/'
    || allowed.search
    || allowed.hash
  ) {
    return denied('The Agent allowed origin must contain only scheme, host, and port.');
  }
  if (
    allowed.protocol !== 'http:'
    && allowed.protocol !== 'https:'
  ) {
    return denied('The Agent allowed origin must use HTTP or HTTPS.');
  }
  if (
    allowed.hostname !== '127.0.0.1'
    && allowed.hostname !== '[::1]'
    && allowed.hostname !== '::1'
  ) {
    return denied('The PR5 Agent build is restricted to a literal loopback address.');
  }
  if (!allowed.port) {
    return denied('The Agent allowed origin must use an explicit fixed port.');
  }
  if (!context.topLevel) {
    return denied('The Agent controller is unavailable inside a frame.');
  }
  if (!context.secureContext) {
    return denied('The Agent controller requires a trustworthy browser context.');
  }
  if (
    context.origin !== allowed.origin
    || context.host !== allowed.host
    || context.hostname !== allowed.hostname
    || context.protocol !== allowed.protocol
  ) {
    return denied(
      'The current page does not match the exact Agent origin.',
      {
        expectedOrigin: allowed.origin,
        actualOrigin: context.origin,
      },
    );
  }
  return {
    ok: true,
    context: { ...context },
    allowedOrigin: allowed.origin,
  };
}
