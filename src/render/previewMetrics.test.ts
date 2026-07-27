import { describe, expect, it } from 'vitest';
import {
  PREVIEW_METRICS_VERSION,
  computePreviewMetrics,
  downsamplePreviewPixels,
  type PreviewPixels,
} from './previewMetrics';

function pixels(
  width: number,
  height: number,
  color: [number, number, number, number] = [0, 0, 0, 0],
): PreviewPixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data.set(color, index * 4);
  }
  return { data, width, height };
}

function setPixel(
  image: PreviewPixels,
  x: number,
  y: number,
  color: [number, number, number, number],
): void {
  image.data.set(color, (y * image.width + x) * 4);
}

describe('preview metrics v1', () => {
  it('identifies a fully transparent output deterministically', () => {
    const metrics = computePreviewMetrics(pixels(4, 3));
    expect(metrics).toMatchObject({
      version: PREVIEW_METRICS_VERSION,
      alphaCoverage: 0,
      nonBackgroundBounds: null,
      luminance: { min: 1, max: 1, mean: 1 },
      perceptualHash: '0000000000000000',
    });
  });

  it('treats a uniform opaque frame as background rather than artwork', () => {
    const metrics = computePreviewMetrics(
      pixels(8, 8, [128, 128, 128, 255]),
    );
    expect(metrics.alphaCoverage).toBe(1);
    expect(metrics.nonBackgroundBounds).toBeNull();
    expect(metrics.background?.confidence).toBe(1);
    expect(metrics.luminance.min).toBeCloseTo(0.2158605, 6);
    expect(metrics.luminance.max).toBeCloseTo(0.2158605, 6);
    expect(metrics.luminance.mean).toBeCloseTo(0.2158605, 6);
    expect(metrics.perceptualHash).toBe('0000000000000000');
  });

  it('preserves min/mean/max ordering after uniform-frame accumulation', () => {
    const metrics = computePreviewMetrics(
      pixels(257, 192, [19, 35, 51, 255]),
    );
    expect(metrics.luminance.mean).toBeGreaterThanOrEqual(metrics.luminance.min);
    expect(metrics.luminance.mean).toBeLessThanOrEqual(metrics.luminance.max);
  });

  it('finds non-background bounds and uses mean normalized alpha coverage', () => {
    const image = pixels(5, 4);
    for (let y = 1; y <= 2; y++) {
      for (let x = 1; x <= 3; x++) {
        setPixel(image, x, y, [255, 0, 0, 255]);
      }
    }
    const metrics = computePreviewMetrics(image);
    expect(metrics.alphaCoverage).toBeCloseTo(6 / 20, 12);
    expect(metrics.nonBackgroundBounds).toEqual({
      x: 1,
      y: 1,
      width: 3,
      height: 2,
    });
    expect(metrics.background).toMatchObject({ confidence: 1 });
    expect(metrics.perceptualHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('accounts for partial alpha rather than counting it as opaque', () => {
    const image = pixels(2, 1);
    setPixel(image, 0, 0, [255, 0, 0, 128]);
    setPixel(image, 1, 0, [0, 0, 0, 0]);
    const metrics = computePreviewMetrics(image);
    expect(metrics.alphaCoverage).toBeCloseTo(128 / (255 * 2), 12);
    expect(metrics.luminance.min).toBeGreaterThan(0);
    expect(metrics.luminance.max).toBe(1);
  });

  it('calls checkpoints during bounded metric work', () => {
    let calls = 0;
    computePreviewMetrics(pixels(64, 64, [10, 20, 30, 255]), () => {
      calls++;
    });
    expect(calls).toBeGreaterThan(3);
  });
});

describe('preview fallback downsampling', () => {
  it('uses premultiplied box averaging for transparent edges', () => {
    const image = pixels(2, 1);
    setPixel(image, 0, 0, [255, 0, 0, 255]);
    setPixel(image, 1, 0, [0, 0, 255, 0]);
    const result = downsamplePreviewPixels(image, 1, 1);
    expect([...result.data]).toEqual([255, 0, 0, 128]);
  });

  it('rejects upscaling and malformed buffers', () => {
    const image = pixels(2, 2);
    expect(() => downsamplePreviewPixels(image, 3, 2)).toThrow(
      /fit inside the source/,
    );
    expect(() => computePreviewMetrics({
      data: new Uint8ClampedArray(3),
      width: 1,
      height: 1,
    })).toThrow(/byte length/);
  });
});
