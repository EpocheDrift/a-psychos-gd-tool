// Rasterize (vector => raster) — the CPU→GPU boundary crossing. Pixels are
// produced at the document's frame size, so the whole raster lane shares
// one resolution. Output is ink on a transparent ground: paper (background)
// is laid down only at Output, so rasters stay composable as elements.
//
// Scaffold note: paths are drawn via OffscreenCanvas 2D (the browser is the
// tessellator) and uploaded once. Real GPU tessellation can replace the body
// of this cook later without touching its sockets.

import type { NodeDef } from '../engine/registry';
import type { RasterValue, VectorValue } from '../engine/values';
import {
  appendPath,
  paintPath,
  preflightCanvasPaint,
} from '../gpu/paint';
import { throwIfCookInterrupted } from '../engine/cookControl';
import { gpuWorkBudgetFor } from '../engine/gpuWorkBudget';

export const RasterizeNode: NodeDef = {
  type: 'Rasterize',
  inputs: [{ name: 'vector', type: 'vector' }],
  outputs: [{ name: 'out', type: 'raster' }],
  params: [],
  usesFrame: true,
  cook(inputs, _params, ctx) {
    const gpu = ctx.gpu;
    if (!gpu) throw new Error('Rasterize needs a GPU context');
    const vector = inputs.vector as VectorValue;
    const { width, height } = ctx.frame;
    throwIfCookInterrupted(ctx);
    preflightCanvasPaint(vector.paths, ctx);

    const canvas = new OffscreenCanvas(width, height);
    const c2d = canvas.getContext('2d')!;

    // center the geometry on the artboard
    const b = vector.bounds;
    c2d.translate(width / 2 - (b.x + b.width / 2), height / 2 - (b.y + b.height / 2));
    // one fill across ALL subpaths: hole contours must subtract via nonzero
    // winding, which only works inside a single path
    const combined = new Path2D();
    for (let index = 0; index < vector.paths.length; index++) {
      if ((index & 63) === 0) throwIfCookInterrupted(ctx);
      appendPath(combined, vector.paths[index], ctx);
    }
    paintPath(c2d, combined, vector.style);

    throwIfCookInterrupted(ctx);
    const t = gpu.pool.acquire(width, height);
    try {
      gpuWorkBudgetFor(ctx).charge(width, height);
      gpu.device.queue.copyExternalImageToTexture(
        { source: canvas },
        { texture: t.texture },
        { width, height },
      );
      throwIfCookInterrupted(ctx);
    } catch (error) {
      gpu.pool.discard(t);
      throw error;
    }

    const value: RasterValue = { kind: 'raster', texture: t, width, height };
    return { out: value };
  },
};
