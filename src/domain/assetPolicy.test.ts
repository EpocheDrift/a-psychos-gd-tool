import { describe, expect, it } from 'vitest';
import {
  FACTORY_ASSET_METADATA,
  decodeStrictBase64,
  imageDimensionsFromBytes,
  isAssetId,
  prepareAssetBytes,
  prepareLegacyDataUri,
  strictBase64DecodedLength,
} from './assetPolicy';
import { sha256BytesHex, sha256Hex } from './sha256';

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('asset policy', () => {
  it('hashes bytes without changing the existing text fingerprint contract', () => {
    expect(sha256BytesHex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('strictly decodes bounded base64 and rejects non-canonical input', () => {
    expect(strictBase64DecodedLength('YQ==')).toBe(1);
    expect(decodeStrictBase64('YQ==', 1)).toEqual(new Uint8Array([97]));
    expect(strictBase64DecodedLength('YR==')).toBeNull();
    expect(strictBase64DecodedLength('YWJ=')).toBeNull();
    expect(decodeStrictBase64('YQ==', 0)).toBeNull();
    expect(strictBase64DecodedLength('YQ=')).toBeNull();
    expect(strictBase64DecodedLength('Y Q=')).toBeNull();
    expect(strictBase64DecodedLength('====')).toBeNull();
  });

  it('validates magic, dimensions, bytes, pixels, side, and content address', () => {
    const bytes = decodeStrictBase64(ONE_BY_ONE_PNG_BASE64, 1024)!;
    expect(imageDimensionsFromBytes('image/png', bytes)).toEqual({
      width: 1,
      height: 1,
    });
    const prepared = prepareAssetBytes({
      bytes,
      mimeType: 'image/png',
      expectedSha256: sha256BytesHex(bytes),
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(isAssetId(prepared.asset.metadata.id)).toBe(true);
    expect(prepared.asset.metadata).toMatchObject({
      mimeType: 'image/png',
      byteLength: bytes.byteLength,
      width: 1,
      height: 1,
      source: 'upload',
    });
    expect(prepared.asset.bytes).not.toBe(bytes);

    expect(prepareAssetBytes({
      bytes,
      mimeType: 'image/jpeg',
    })).toMatchObject({
      ok: false,
      issue: { code: 'ASSET_POLICY_VIOLATION' },
    });
    expect(prepareAssetBytes({
      bytes,
      mimeType: 'image/png',
      expectedSha256: '0'.repeat(64),
    })).toMatchObject({
      ok: false,
      issue: { code: 'ASSET_POLICY_VIOLATION' },
    });
  });

  it('extracts legacy data URIs and maps only the fixed bundled image', () => {
    const extracted = prepareLegacyDataUri(
      `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`,
    );
    expect(extracted.ok).toBe(true);
    if (extracted.ok) {
      expect(extracted.asset?.metadata).toMatchObject({
        mimeType: 'image/png',
        width: 1,
        height: 1,
      });
    }
    expect(prepareLegacyDataUri('/factory-image.jpg')).toEqual({
      ok: true,
      asset: { metadata: { ...FACTORY_ASSET_METADATA } },
    });
    expect(prepareLegacyDataUri('https://example.test/tracker.png')).toMatchObject({
      ok: false,
      issue: { code: 'ASSET_POLICY_VIOLATION' },
    });
  });
});
