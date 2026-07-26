import { describe, expect, it } from 'vitest';
import {
  evaluateAgentRuntimeGate,
  type AgentRuntimeContext,
} from './runtimeGate';

const allowed = 'http://127.0.0.1:5199';

function context(
  overrides: Partial<AgentRuntimeContext> = {},
): AgentRuntimeContext {
  return {
    origin: allowed,
    host: '127.0.0.1:5199',
    hostname: '127.0.0.1',
    protocol: 'http:',
    topLevel: true,
    secureContext: true,
    ...overrides,
  };
}

describe('Agent runtime gate', () => {
  it('accepts only the exact top-level trustworthy loopback origin', () => {
    expect(evaluateAgentRuntimeGate(context(), allowed)).toMatchObject({
      ok: true,
      allowedOrigin: allowed,
    });

    for (const candidate of [
      context({ origin: 'http://127.0.0.1:5200', host: '127.0.0.1:5200' }),
      context({
        origin: 'http://localhost:5199',
        host: 'localhost:5199',
        hostname: 'localhost',
      }),
      context({
        origin: 'http://evil.test:5199',
        host: 'evil.test:5199',
        hostname: 'evil.test',
      }),
      context({ topLevel: false }),
      context({ secureContext: false }),
      context({ origin: 'null', protocol: 'file:' }),
    ]) {
      expect(evaluateAgentRuntimeGate(candidate, allowed)).toMatchObject({
        ok: false,
        error: { code: 'ORIGIN_NOT_ALLOWED' },
      });
    }
  });

  it('rejects wildcard-like, credentialed, path-bearing, and non-loopback policy', () => {
    for (const policy of [
      '*',
      'null',
      'http://user:pass@127.0.0.1:5199',
      'http://127.0.0.1:5199/path',
      'http://127.0.0.1',
      'https://example.com:5199',
      'file:///tmp/app',
    ]) {
      expect(evaluateAgentRuntimeGate(context(), policy)).toMatchObject({
        ok: false,
        error: { code: 'ORIGIN_NOT_ALLOWED' },
      });
    }
  });
});
