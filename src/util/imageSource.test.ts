import { describe, expect, it } from 'vitest';
import { imageSourceBlob } from './imageSource';

describe('imageSourceBlob', () => {
  it('decodes strict embedded image bytes without a data-URI fetch', async () => {
    const blob = await imageSourceBlob('data:image/png;base64,AQID');
    expect(blob.type).toBe('image/png');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('rejects arbitrary URLs before fetch', async () => {
    await expect(
      imageSourceBlob('https://example.invalid/tracker.png'),
    ).rejects.toThrow('outside the bundled/embedded allowlist');
  });

  it('honors cancellation before embedded decoding', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      imageSourceBlob('data:image/png;base64,AQID', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
