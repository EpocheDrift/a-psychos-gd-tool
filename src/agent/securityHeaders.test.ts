import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AGENT_ALLOWED_ORIGIN,
  AGENT_CONTENT_SECURITY_POLICY,
  AGENT_SECURITY_HEADERS,
} from '../../agent-security';

describe('Agent build security policy', () => {
  it('uses an exact loopback origin and restrictive response headers', () => {
    expect(AGENT_ALLOWED_ORIGIN).toBe('http://127.0.0.1:5199');
    expect(AGENT_SECURITY_HEADERS).toMatchObject({
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    expect(AGENT_SECURITY_HEADERS['Permissions-Policy']).toContain('local-fonts=()');
    expect(AGENT_CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    expect(AGENT_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(AGENT_CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(AGENT_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(AGENT_CONTENT_SECURITY_POLICY).toContain("style-src-elem 'self'");
    expect(AGENT_CONTENT_SECURITY_POLICY).toContain(
      "style-src-attr 'unsafe-inline'",
    );
    expect(AGENT_CONTENT_SECURITY_POLICY).not.toMatch(
      /style-src-elem[^;]*'unsafe-inline'/,
    );
    expect(AGENT_CONTENT_SECURITY_POLICY).toContain("connect-src 'self' blob:");
    expect(AGENT_CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
    expect(AGENT_CONTENT_SECURITY_POLICY).not.toMatch(
      /script-src[^;]*'unsafe-inline'/,
    );
  });

  it('loads no remote UI font or third-party script from index.html', () => {
    const html = readFileSync(
      new URL('../../index.html', import.meta.url),
      'utf8',
    );
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
    expect(html).not.toMatch(/<script[^>]+https?:/i);
  });
});
