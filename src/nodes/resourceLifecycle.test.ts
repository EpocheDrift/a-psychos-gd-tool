import { describe, expect, it, vi } from 'vitest';
import type { CookContext } from '../engine/registry';
import type { GpuContext } from '../gpu/device';
import { renderElements } from '../gpu/elementRenderer';
import type { PooledTexture } from '../gpu/pool';
import { BlurNode } from './blur';
import { DitherNode } from './rasterOps';

function handle(id: string): PooledTexture {
  return {
    texture: { id } as unknown as GPUTexture,
    width: 16,
    height: 16,
    format: 'rgba8unorm',
    estimatedBytes: 1024,
  };
}

function context(gpu: GpuContext): CookContext {
  return {
    gpu,
    fonts: new Map(),
    frame: { width: 16, height: 16 },
  };
}

describe('node GPU exception cleanup', () => {
  it('discards Blur temporary texture when the second acquire fails', () => {
    const temporary = handle('temporary');
    const pool = {
      acquire: vi.fn()
        .mockReturnValueOnce(temporary)
        .mockImplementationOnce(() => {
          throw new Error('budget exhausted');
        }),
      discard: vi.fn(),
      release: vi.fn(),
    };
    const gpu = { pool, runPass: vi.fn() } as unknown as GpuContext;
    expect(() => BlurNode.cook(
      {
        in: {
          kind: 'raster',
          texture: handle('source'),
          width: 16,
          height: 16,
        },
      },
      { radius: 4 },
      context(gpu),
    )).toThrow('budget exhausted');
    expect(pool.discard).toHaveBeenCalledWith(temporary);
  });

  it('discards both Blur targets after a synchronous pass failure', () => {
    const temporary = handle('temporary');
    const destination = handle('destination');
    const pool = {
      acquire: vi.fn()
        .mockReturnValueOnce(temporary)
        .mockReturnValueOnce(destination),
      discard: vi.fn(),
      release: vi.fn(),
    };
    const runPass = vi.fn()
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => {
        throw new Error('pass failed');
      });
    const gpu = { pool, runPass } as unknown as GpuContext;
    expect(() => BlurNode.cook(
      {
        in: {
          kind: 'raster',
          texture: handle('source'),
          width: 16,
          height: 16,
        },
      },
      { radius: 4 },
      context(gpu),
    )).toThrow('pass failed');
    expect(pool.discard).toHaveBeenCalledWith(temporary);
    expect(pool.discard).toHaveBeenCalledWith(destination);
  });

  it('discards a simple raster target when its pass throws', () => {
    const destination = handle('destination');
    const pool = {
      acquire: vi.fn(() => destination),
      discard: vi.fn(),
    };
    const gpu = {
      pool,
      runPass: vi.fn(() => {
        throw new Error('dither failed');
      }),
    } as unknown as GpuContext;
    expect(() => DitherNode.cook(
      {
        in: {
          kind: 'raster',
          texture: handle('source'),
          width: 16,
          height: 16,
        },
      },
      { levels: 2, scale: 2 },
      context(gpu),
    )).toThrow('dither failed');
    expect(pool.discard).toHaveBeenCalledWith(destination);
  });

  it('discards both element-render targets when final conversion fails', () => {
    const accumulation = handle('accumulation');
    const output = handle('output');
    const pool = {
      acquire: vi.fn()
        .mockReturnValueOnce(accumulation)
        .mockReturnValueOnce(output),
      discard: vi.fn(),
      release: vi.fn(),
    };
    const gpu = {
      pool,
      clear: vi.fn(),
      runPass: vi.fn(() => {
        throw new Error('unpremultiply failed');
      }),
    } as unknown as GpuContext;
    expect(() => renderElements(
      gpu,
      new Map(),
      [],
      16,
      16,
      { r: 0, g: 0, b: 0, a: 0 },
    )).toThrow('unpremultiply failed');
    expect(pool.discard).toHaveBeenCalledWith(output);
    expect(pool.discard).toHaveBeenCalledWith(accumulation);
  });
});
