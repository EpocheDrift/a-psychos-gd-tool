import { describe, expect, it, vi } from 'vitest';
import type { PreviewResult } from '../render/preview';
import { PreviewHandleVault } from './previewVault';

function preview(byte = 7): PreviewResult {
  const bytes = new Uint8Array([byte, byte + 1]).buffer;
  return {
    requestedRevision: 1,
    revision: 1,
    attempt: 1,
    sourceWidth: 1,
    sourceHeight: 1,
    width: 1,
    height: 1,
    mimeType: 'image/png',
    byteLength: bytes.byteLength,
    contentHash: 'a'.repeat(64),
    rgbaSha256: 'b'.repeat(64),
    capturePolicy: 'current-exact-ticket-v1',
    image: {
      kind: 'inline-array-buffer-v1',
      mimeType: 'image/png',
      byteLength: bytes.byteLength,
      contentHash: 'a'.repeat(64),
      trust: 'untrusted-document-render',
      bytes,
    },
  };
}

describe('PreviewHandleVault', () => {
  it('returns only a JSON handle and revokes object URLs on clear', () => {
    const revoked: string[] = [];
    let sequence = 0;
    const vault = new PreviewHandleVault({
      randomId: () => `preview_${++sequence}`,
      createObjectUrl: () => `blob:test/${sequence}`,
      revokeObjectUrl: (url) => revoked.push(url),
      setTimer: (() => 1) as unknown as typeof setTimeout,
      clearTimer: vi.fn(),
    });
    const handle = vault.store(preview(), 1);
    expect(handle).toMatchObject({
      kind: 'browser-object-url-v1',
      byteLength: 2,
      trust: 'untrusted-document-render',
    });
    expect(handle).not.toHaveProperty('bytes');
    expect(JSON.parse(JSON.stringify(handle))).toEqual(handle);
    expect(structuredClone(handle)).toEqual(handle);
    expect(vault.resolveBytes(handle.handleId)).toEqual(
      new Uint8Array([7, 8]).buffer,
    );
    vault.clear();
    expect(vault.resolveBytes(handle.handleId)).toBeNull();
    expect(revoked).toEqual([handle.url]);
  });

  it('evicts the oldest handle at the count budget', () => {
    const revoked: string[] = [];
    let sequence = 0;
    const vault = new PreviewHandleVault({
      maxHandles: 1,
      randomId: () => `preview_${++sequence}`,
      createObjectUrl: () => `blob:test/${sequence}`,
      revokeObjectUrl: (url) => revoked.push(url),
      setTimer: (() => sequence) as unknown as typeof setTimeout,
      clearTimer: vi.fn(),
    });
    const first = vault.store(preview(1), 1);
    const second = vault.store(preview(3), 1);
    expect(vault.resolveBytes(first.handleId)).toBeNull();
    expect(vault.resolveBytes(second.handleId)).not.toBeNull();
    expect(revoked).toContain(first.url);
    vault.clear();
  });
});
