import { describe, expect, it } from 'vitest';
import { CookResourceLimitError } from './cookControl';
import { GpuWorkBudget } from './gpuWorkBudget';

describe('GpuWorkBudget', () => {
  it('rejects pass count before additional work can be submitted', () => {
    const budget = new GpuWorkBudget({
      maxGpuPasses: 2,
      maxGpuPixelWork: 1_000,
    });
    budget.charge(10, 10);
    budget.charge(10, 10);
    expect(() => budget.charge(10, 10)).toThrow(CookResourceLimitError);
    expect(budget.snapshot()).toEqual({ passes: 2, pixelWork: 200 });
  });

  it('bounds cumulative full-frame pixel work independently of pass count', () => {
    const budget = new GpuWorkBudget({
      maxGpuPasses: 100,
      maxGpuPixelWork: 199,
    });
    budget.charge(10, 10);
    expect(() => budget.charge(10, 10)).toThrow(CookResourceLimitError);
    expect(budget.snapshot()).toEqual({ passes: 1, pixelWork: 100 });
  });

  it('makes a large raster-element workload fail before its full queue exists', () => {
    const budget = new GpuWorkBudget({
      maxGpuPasses: 2_048,
      maxGpuPixelWork: 32_000_000_000,
    });
    let accepted = 0;
    expect(() => {
      for (; accepted < 100_000; accepted++) {
        budget.charge(4_096, 4_096);
      }
    }).toThrow(CookResourceLimitError);
    // The production pixel-work cap is reached first at this frame size; the
    // separate 2,048-pass cap remains a second hard ceiling for smaller work.
    expect(accepted).toBe(1_907);
    expect(budget.snapshot()).toEqual({
      passes: 1_907,
      pixelWork: 31_994_150_912,
    });
  });
});
