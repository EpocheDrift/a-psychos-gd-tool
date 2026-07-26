import { PREVIEW_METRICS_VERSION } from '../domain/previewContract';

export { PREVIEW_METRICS_VERSION };

export interface PreviewPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface PreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewMetricsV1 {
  version: typeof PREVIEW_METRICS_VERSION;
  /**
   * Mean normalized alpha, not merely the count of non-zero pixels. This makes
   * a fully transparent output exactly 0 and a fully opaque output exactly 1.
   */
  alphaCoverage: number;
  nonBackgroundBounds: PreviewBounds | null;
  luminance: {
    min: number;
    max: number;
    mean: number;
  };
  /**
   * 64-bit pHash over white-matted linear luminance. It is similarity
   * evidence, never an integrity or authorization digest.
   */
  perceptualHash: string;
  background: {
    /** Dominant border color in premultiplied 8-bit RGBA. */
    premultipliedRgba: [number, number, number, number];
    confidence: number;
  } | null;
}

export type PreviewCheckpoint = () => void;

const BACKGROUND_QUANTIZATION_MASK = 0xf8;
const BACKGROUND_TOLERANCE = 4;
const BACKGROUND_CONFIDENCE = 0.5;
const PHASH_SIDE = 32;
const PHASH_COEFFICIENT_SIDE = 8;

function assertPixels(pixels: PreviewPixels): void {
  if (
    !Number.isSafeInteger(pixels.width)
    || !Number.isSafeInteger(pixels.height)
    || pixels.width <= 0
    || pixels.height <= 0
  ) {
    throw new RangeError('Preview pixel dimensions must be positive integers.');
  }
  const count = pixels.width * pixels.height;
  if (
    !Number.isSafeInteger(count)
    || pixels.data.byteLength !== count * 4
  ) {
    throw new RangeError('Preview RGBA byte length does not match its dimensions.');
  }
}

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function whiteMattedLuminance(
  data: Uint8ClampedArray,
  offset: number,
): number {
  const alpha = data[offset + 3] / 255;
  const red = srgbToLinear(data[offset]) * alpha + 1 - alpha;
  const green = srgbToLinear(data[offset + 1]) * alpha + 1 - alpha;
  const blue = srgbToLinear(data[offset + 2]) * alpha + 1 - alpha;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function premultipliedAt(
  data: Uint8ClampedArray,
  offset: number,
): [number, number, number, number] {
  const alpha = data[offset + 3];
  if (alpha === 0) return [0, 0, 0, 0];
  return [
    Math.round((data[offset] * alpha) / 255),
    Math.round((data[offset + 1] * alpha) / 255),
    Math.round((data[offset + 2] * alpha) / 255),
    alpha,
  ];
}

function quantizedColorKey(color: readonly number[]): string {
  return color
    .map((channel) => channel & BACKGROUND_QUANTIZATION_MASK)
    .join(',');
}

function quantizedCenter(key: string): [number, number, number, number] {
  const channels = key.split(',').map(Number);
  return channels.map((channel) => Math.min(255, channel + 3)) as [
    number,
    number,
    number,
    number,
  ];
}

function borderOffsets(width: number, height: number): number[] {
  const offsets: number[] = [];
  for (let x = 0; x < width; x++) offsets.push(x * 4);
  if (height > 1) {
    const row = (height - 1) * width;
    for (let x = 0; x < width; x++) offsets.push((row + x) * 4);
  }
  for (let y = 1; y < height - 1; y++) {
    offsets.push(y * width * 4);
    if (width > 1) offsets.push((y * width + width - 1) * 4);
  }
  return offsets;
}

function dominantBorderBackground(
  pixels: PreviewPixels,
  checkpoint: PreviewCheckpoint,
): PreviewMetricsV1['background'] {
  const offsets = borderOffsets(pixels.width, pixels.height);
  const counts = new Map<string, number>();
  let dominantKey = '';
  let dominantCount = 0;
  for (let index = 0; index < offsets.length; index++) {
    if ((index & 511) === 0) checkpoint();
    const key = quantizedColorKey(premultipliedAt(pixels.data, offsets[index]));
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count > dominantCount || (count === dominantCount && key < dominantKey)) {
      dominantKey = key;
      dominantCount = count;
    }
  }
  const confidence = offsets.length === 0 ? 0 : dominantCount / offsets.length;
  if (confidence < BACKGROUND_CONFIDENCE) return null;
  return {
    premultipliedRgba: quantizedCenter(dominantKey),
    confidence,
  };
}

function differsFromBackground(
  color: readonly number[],
  background: readonly number[],
): boolean {
  for (let index = 0; index < 4; index++) {
    if (Math.abs(color[index] - background[index]) > BACKGROUND_TOLERANCE) {
      return true;
    }
  }
  return false;
}

function resizeLuminance(
  source: Float64Array,
  width: number,
  height: number,
  checkpoint: PreviewCheckpoint,
): Float64Array {
  const output = new Float64Array(PHASH_SIDE * PHASH_SIDE);
  for (let targetY = 0; targetY < PHASH_SIDE; targetY++) {
    checkpoint();
    const sourceY0 = Math.floor((targetY * height) / PHASH_SIDE);
    const sourceY1 = Math.max(
      sourceY0 + 1,
      Math.ceil(((targetY + 1) * height) / PHASH_SIDE),
    );
    for (let targetX = 0; targetX < PHASH_SIDE; targetX++) {
      const sourceX0 = Math.floor((targetX * width) / PHASH_SIDE);
      const sourceX1 = Math.max(
        sourceX0 + 1,
        Math.ceil(((targetX + 1) * width) / PHASH_SIDE),
      );
      let sum = 0;
      let count = 0;
      for (let sourceY = sourceY0; sourceY < Math.min(height, sourceY1); sourceY++) {
        const row = sourceY * width;
        for (
          let sourceX = sourceX0;
          sourceX < Math.min(width, sourceX1);
          sourceX++
        ) {
          sum += source[row + sourceX];
          count++;
        }
      }
      output[targetY * PHASH_SIDE + targetX] = sum / Math.max(1, count);
    }
  }
  return output;
}

function perceptualHash(
  luminance: Float64Array,
  width: number,
  height: number,
  min: number,
  max: number,
  checkpoint: PreviewCheckpoint,
): string {
  if (max - min < 1e-12) return '0000000000000000';
  const resized = resizeLuminance(luminance, width, height, checkpoint);
  const coefficients: number[] = [];
  for (let v = 0; v < PHASH_COEFFICIENT_SIDE; v++) {
    checkpoint();
    for (let u = 0; u < PHASH_COEFFICIENT_SIDE; u++) {
      let sum = 0;
      for (let y = 0; y < PHASH_SIDE; y++) {
        const yWeight = Math.cos(((2 * y + 1) * v * Math.PI) / (2 * PHASH_SIDE));
        for (let x = 0; x < PHASH_SIDE; x++) {
          const xWeight = Math.cos(
            ((2 * x + 1) * u * Math.PI) / (2 * PHASH_SIDE),
          );
          sum += resized[y * PHASH_SIDE + x] * xWeight * yWeight;
        }
      }
      const uScale = u === 0 ? 1 / Math.sqrt(2) : 1;
      const vScale = v === 0 ? 1 / Math.sqrt(2) : 1;
      coefficients.push((2 / PHASH_SIDE) * uScale * vScale * sum);
    }
  }
  const ac = coefficients.slice(1).sort((left, right) => left - right);
  const middle = Math.floor(ac.length / 2);
  const median = ac.length % 2 === 0
    ? (ac[middle - 1] + ac[middle]) / 2
    : ac[middle];
  let bits = 0n;
  for (const coefficient of coefficients) {
    bits = (bits << 1n) | (coefficient > median ? 1n : 0n);
  }
  return bits.toString(16).padStart(16, '0');
}

export function computePreviewMetrics(
  pixels: PreviewPixels,
  checkpoint: PreviewCheckpoint = () => {},
): PreviewMetricsV1 {
  assertPixels(pixels);
  const pixelCount = pixels.width * pixels.height;
  const luminance = new Float64Array(pixelCount);
  let alphaSum = 0;
  let luminanceMin = 1;
  let luminanceMax = 0;
  let luminanceSum = 0;
  for (let index = 0; index < pixelCount; index++) {
    if ((index & 4095) === 0) checkpoint();
    const offset = index * 4;
    alphaSum += pixels.data[offset + 3];
    const value = whiteMattedLuminance(pixels.data, offset);
    luminance[index] = value;
    luminanceMin = Math.min(luminanceMin, value);
    luminanceMax = Math.max(luminanceMax, value);
    luminanceSum += value;
  }

  const alphaCoverage = alphaSum / (255 * pixelCount);
  const luminanceMean = Math.min(
    luminanceMax,
    Math.max(luminanceMin, luminanceSum / pixelCount),
  );
  const background = dominantBorderBackground(pixels, checkpoint);
  let minX = pixels.width;
  let minY = pixels.height;
  let maxX = -1;
  let maxY = -1;
  if (alphaSum > 0) {
    if (!background) {
      minX = 0;
      minY = 0;
      maxX = pixels.width - 1;
      maxY = pixels.height - 1;
    } else {
      for (let y = 0; y < pixels.height; y++) {
        if ((y & 31) === 0) checkpoint();
        for (let x = 0; x < pixels.width; x++) {
          const color = premultipliedAt(
            pixels.data,
            (y * pixels.width + x) * 4,
          );
          if (!differsFromBackground(color, background.premultipliedRgba)) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
  }

  checkpoint();
  return {
    version: PREVIEW_METRICS_VERSION,
    alphaCoverage,
    nonBackgroundBounds: maxX < minX || maxY < minY
      ? null
      : {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        },
    luminance: {
      min: luminanceMin,
      max: luminanceMax,
      mean: luminanceMean,
    },
    perceptualHash: perceptualHash(
      luminance,
      pixels.width,
      pixels.height,
      luminanceMin,
      luminanceMax,
      checkpoint,
    ),
    background,
  };
}

/**
 * Deterministic premultiplied box resampling used only for encoded-byte
 * fallback after the GPU has already produced the bounded first preview.
 */
export function downsamplePreviewPixels(
  pixels: PreviewPixels,
  width: number,
  height: number,
  checkpoint: PreviewCheckpoint = () => {},
): PreviewPixels {
  assertPixels(pixels);
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || width > pixels.width
    || height > pixels.height
  ) {
    throw new RangeError('Downsample dimensions must fit inside the source.');
  }
  if (width === pixels.width && height === pixels.height) {
    return {
      data: new Uint8ClampedArray(pixels.data),
      width,
      height,
    };
  }
  const output = new Uint8ClampedArray(width * height * 4);
  for (let targetY = 0; targetY < height; targetY++) {
    checkpoint();
    const sourceY0 = Math.floor((targetY * pixels.height) / height);
    const sourceY1 = Math.max(
      sourceY0 + 1,
      Math.ceil(((targetY + 1) * pixels.height) / height),
    );
    for (let targetX = 0; targetX < width; targetX++) {
      const sourceX0 = Math.floor((targetX * pixels.width) / width);
      const sourceX1 = Math.max(
        sourceX0 + 1,
        Math.ceil(((targetX + 1) * pixels.width) / width),
      );
      let alphaSum = 0;
      let redPremultiplied = 0;
      let greenPremultiplied = 0;
      let bluePremultiplied = 0;
      let samples = 0;
      for (
        let sourceY = sourceY0;
        sourceY < Math.min(pixels.height, sourceY1);
        sourceY++
      ) {
        for (
          let sourceX = sourceX0;
          sourceX < Math.min(pixels.width, sourceX1);
          sourceX++
        ) {
          const offset = (sourceY * pixels.width + sourceX) * 4;
          const alpha = pixels.data[offset + 3];
          alphaSum += alpha;
          redPremultiplied += pixels.data[offset] * alpha;
          greenPremultiplied += pixels.data[offset + 1] * alpha;
          bluePremultiplied += pixels.data[offset + 2] * alpha;
          samples++;
        }
      }
      const outputOffset = (targetY * width + targetX) * 4;
      const alpha = alphaSum / samples;
      output[outputOffset + 3] = Math.round(alpha);
      if (alphaSum > 0) {
        output[outputOffset] = Math.round(redPremultiplied / alphaSum);
        output[outputOffset + 1] = Math.round(greenPremultiplied / alphaSum);
        output[outputOffset + 2] = Math.round(bluePremultiplied / alphaSum);
      }
    }
  }
  return { data: output, width, height };
}
