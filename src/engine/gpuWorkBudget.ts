import { DEFAULT_AGENT_LIMITS } from '../domain/limits';
import {
  CookResourceLimitError,
  throwIfCookInterrupted,
  type CookControl,
} from './cookControl';

export interface GpuWorkBudgetControl extends CookControl {
  maxGpuPasses?: number;
  maxGpuPixelWork?: number;
  gpuWorkBudget?: GpuWorkBudget;
}

export interface GpuWorkBudgetSnapshot {
  passes: number;
  pixelWork: number;
}

/**
 * Attempt-scoped submission budget. GPU work already queued cannot be
 * cancelled, so limits are charged before encoding/submitting each operation.
 */
export class GpuWorkBudget {
  private passes = 0;
  private pixelWork = 0;

  constructor(private readonly control: GpuWorkBudgetControl = {}) {
    throwIfCookInterrupted(control);
  }

  charge(width: number, height: number, passes = 1): void {
    throwIfCookInterrupted(this.control);
    if (
      !Number.isSafeInteger(width)
      || !Number.isSafeInteger(height)
      || !Number.isSafeInteger(passes)
      || width <= 0
      || height <= 0
      || passes <= 0
    ) {
      throw new CookResourceLimitError(
        'GPU work accounting received invalid dimensions.',
      );
    }
    const maximumPasses = this.control.maxGpuPasses
      ?? DEFAULT_AGENT_LIMITS.maxGpuPasses;
    if (passes > maximumPasses - this.passes) {
      throw new CookResourceLimitError(
        `GPU pass count exceeds the configured maximum of ${maximumPasses}.`,
        {
          actualAtLeast: this.passes + passes,
          maximum: maximumPasses,
        },
      );
    }
    const pixels = width * height * passes;
    const maximumPixels = this.control.maxGpuPixelWork
      ?? DEFAULT_AGENT_LIMITS.maxGpuPixelWork;
    if (
      !Number.isSafeInteger(pixels)
      || pixels > maximumPixels - this.pixelWork
    ) {
      throw new CookResourceLimitError(
        `GPU pixel work would reach at least ${
          Number.isSafeInteger(pixels)
            ? this.pixelWork + pixels
            : maximumPixels + 1
        }, exceeding the configured maximum of ${maximumPixels}.`,
        {
          actualAtLeast: Number.isSafeInteger(pixels)
            ? this.pixelWork + pixels
            : maximumPixels + 1,
          maximum: maximumPixels,
        },
      );
    }
    this.passes += passes;
    this.pixelWork += pixels;
  }

  snapshot(): GpuWorkBudgetSnapshot {
    return { passes: this.passes, pixelWork: this.pixelWork };
  }
}

export function gpuWorkBudgetFor(
  control: GpuWorkBudgetControl = {},
): GpuWorkBudget {
  return control.gpuWorkBudget ?? new GpuWorkBudget(control);
}
