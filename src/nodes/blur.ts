// Blur (raster => raster) — the template every raster op follows: acquire
// target(s) from the pool, run shader pass(es) sampling the upstream texture,
// return a new handle. Separable gaussian = two passes ping-ponging targets.

import type { NodeDef } from '../engine/registry';
import type { RasterValue } from '../engine/values';

export const BlurNode: NodeDef = {
  type: 'Blur',
  inputs: [{ name: 'in', type: 'raster' }],
  outputs: [{ name: 'out', type: 'raster' }],
  params: [{ name: 'radius', kind: 'number', default: 8, min: 0, max: 4096, step: 1 }],
  cook(inputs, params, ctx) {
    const gpu = ctx.gpu;
    if (!gpu) throw new Error('Blur needs a GPU context');
    const src = inputs.in as RasterValue;
    const radius = Number(params.radius);

    const tmp = gpu.pool.acquire(src.width, src.height);
    let dst: ReturnType<typeof gpu.pool.acquire> | null = null;
    try {
      dst = gpu.pool.acquire(src.width, src.height);
      gpu.runPass(
        'blur',
        src.texture,
        tmp,
        new Float32Array([1, 0, radius, 0]),
        ctx,
      );
      gpu.runPass(
        'blur',
        tmp,
        dst,
        new Float32Array([0, 1, radius, 0]),
        ctx,
      );
    } catch (error) {
      gpu.pool.discard(tmp);
      if (dst) gpu.pool.discard(dst);
      throw error;
    }
    gpu.pool.release(tmp); // back to the free list — next cook reuses it

    const value: RasterValue = { kind: 'raster', texture: dst, width: src.width, height: src.height };
    return { out: value };
  },
};
