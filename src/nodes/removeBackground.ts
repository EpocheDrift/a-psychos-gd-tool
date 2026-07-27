// Remove Background (raster => raster) — a segmentation model (RMBG-1.4 via
// Transformers.js) decides which pixels are the foreground subject, and its mask
// is folded into the image's alpha so the background becomes transparent. The
// model and the masking run in a Web Worker (see traceWorker.ts), so the UI stays
// responsive. In the Agent build, a separate human action downloads the fixed
// revision into the companion's verified managed cache before this node can be
// added; the worker itself has no remote-model authority.

import type { NodeDef } from '../engine/registry';
import type { RasterValue } from '../engine/values';
import { runRemoveBg } from './traceClient';
import { throwIfCookInterrupted } from '../engine/cookControl';
import { gpuWorkBudgetFor } from '../engine/gpuWorkBudget';

export const RemoveBackgroundNode: NodeDef = {
  type: 'RemoveBackground',
  label: 'Remove Background',
  inputs: [{ name: 'in', type: 'raster' }],
  outputs: [{ name: 'out', type: 'raster' }],
  params: [],
  async cook(inputs, _params, ctx) {
    const gpu = ctx.gpu;
    if (!gpu) throw new Error('Remove Background needs a GPU context');
    const src = inputs.in as RasterValue;

    const imageData = await gpu.readback(src.texture, ctx);
    throwIfCookInterrupted(ctx);
    const cut = await runRemoveBg(imageData, {
      signal: ctx.signal,
      deadline: ctx.deadline,
      revision: ctx.revision,
      maxPendingRequests: ctx.maxPendingWorkerRequests,
      maxPendingBytes: ctx.maxPendingWorkerBytes,
    });
    throwIfCookInterrupted(ctx);

    // upload the masked pixels back into a texture (browser is the uploader, as
    // in Image/Rasterize)
    const canvas = new OffscreenCanvas(cut.width, cut.height);
    // copy into a fresh ArrayBuffer-backed array for the ImageData constructor
    const pixels = new ImageData(new Uint8ClampedArray(cut.data), cut.width, cut.height);
    canvas.getContext('2d')!.putImageData(pixels, 0, 0);
    const t = gpu.pool.acquire(cut.width, cut.height);
    try {
      gpuWorkBudgetFor(ctx).charge(cut.width, cut.height);
      gpu.device.queue.copyExternalImageToTexture(
        { source: canvas },
        { texture: t.texture },
        { width: cut.width, height: cut.height },
      );
      throwIfCookInterrupted(ctx);
    } catch (error) {
      gpu.pool.discard(t);
      throw error;
    }

    const value: RasterValue = { kind: 'raster', texture: t, width: cut.width, height: cut.height };
    return { out: value };
  },
};
