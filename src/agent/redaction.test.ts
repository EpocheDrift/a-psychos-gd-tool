import { describe, expect, it } from 'vitest';
import {
  redactDiagnosticDetails,
  redactDiagnosticString,
} from './redaction';

describe('Agent diagnostic redaction', () => {
  it('redacts nested credentials, binary fields, data URIs, blob URLs, and long strings', () => {
    const secret = 'secret-value-that-must-not-survive';
    const redacted = redactDiagnosticDetails({
      authorization: secret,
      nested: {
        claimToken: secret,
        client_nonce: secret,
        imageBytes: secret,
        ordinary: 'safe',
        data: 'data:image/png;base64,AAAA',
        previewUrl: 'blob:http://127.0.0.1:5199/secret-handle',
        long: 'x'.repeat(700),
      },
    });
    const json = JSON.stringify(redacted);
    expect(json).not.toContain(secret);
    expect(json).not.toContain('AAAA');
    expect(json).not.toContain('secret-handle');
    expect(json).toContain('safe');
    expect(json).toContain('redacted');
    expect(json).toContain('truncated');
  });

  it('sanitizes embedded URIs and named secrets in bounded messages', () => {
    const value = redactDiagnosticString(
      `failed data:;base64,AAAA blob:http://127.0.0.1/x claimToken=secret ${
        'x'.repeat(1_000)
      }`,
    );
    expect(value).not.toContain('AAAA');
    expect(value).not.toContain('/x');
    expect(value).not.toContain('secret');
    expect(value.length).toBeLessThan(700);
    expect(value).toContain('sha256:');
  });

  it('bounds and redacts diagnostic object keys as well as values', () => {
    const secret = 'key-secret-that-must-not-survive';
    const redacted = redactDiagnosticDetails({
      [`data:;base64,${secret}${'x'.repeat(2_000)}`]: 'safe-value',
      claimToken: secret,
    });
    const json = JSON.stringify(redacted);
    expect(json).not.toContain(secret);
    expect(json.length).toBeLessThan(1_000);
    expect(json).toContain('redacted');
  });
});
