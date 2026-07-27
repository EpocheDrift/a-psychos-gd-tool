// Renders an ordered list of elements onto an artboard texture, in z-order.
// Vector/text elements batch into OffscreenCanvas layers (the browser is the
// tessellator, as in Rasterize); raster elements draw as transformed quads
// sampling their texture directly — no readback, no detour through vector.

import type { Font } from 'opentype.js';
import type { Element, PathCmd } from '../engine/values';
import {
  appendPath,
  paintErases,
  paintPath,
  preflightCanvasPaint,
} from './paint';
import type { GpuContext } from './device';
import type { PooledTexture } from './pool';
import {
  throwIfCookInterrupted,
} from '../engine/cookControl';
import {
  geometryBudgetFor,
  type GeometryBudgetControl,
} from '../engine/geometryBudget';
import { gpuWorkBudgetFor } from '../engine/gpuWorkBudget';

/** artboard-covering layer: local px (0..W, 0..H) -> clip */
function fullscreenCoeffs(W: number, H: number): Float32Array<ArrayBuffer> {
  return new Float32Array([2 / W, 0, 0, -2 / H, -1, 1, W, H]);
}

/** content px through the element TRS (centered anchor, artboard origin at center) -> clip */
function elementCoeffs(el: Element, w: number, h: number, W: number, H: number): Float32Array<ArrayBuffer> {
  const t = el.transform;
  const cs = Math.cos(t.rotation) * t.scale;
  const sn = Math.sin(t.rotation) * t.scale;
  const ax = w / 2, ay = h / 2;
  return new Float32Array([
    cs / (W / 2), -sn / (W / 2),
    -sn / (H / 2), -cs / (H / 2),
    (t.x - cs * ax + sn * ay) / (W / 2),
    -(t.y - sn * ax - cs * ay) / (H / 2),
    w, h,
  ]);
}

export function renderElements(
  gpu: GpuContext,
  fonts: Map<string, Font>,
  items: Element[],
  width: number,
  height: number,
  background: { r: number; g: number; b: number; a: number },
  control: GeometryBudgetControl = {},
): PooledTexture {
  const budget = geometryBudgetFor(control);
  const gpuBudget = gpuWorkBudgetFor(control);
  budget.assertGeneratedItems(items.length);
  const dst = gpu.pool.acquire(width, height);
  let ownsDst = true;
  try {
    throwIfCookInterrupted(control);
    gpu.clear(dst, background, control);

    let canvas: OffscreenCanvas | null = null;
    let c2d: OffscreenCanvasRenderingContext2D | null = null;

    const flush = () => {
      if (!canvas) return;
      throwIfCookInterrupted(control);
      const tmp = gpu.pool.acquire(width, height);
      let succeeded = false;
      try {
        gpuBudget.charge(width, height);
        gpu.device.queue.copyExternalImageToTexture(
          { source: canvas },
          { texture: tmp.texture },
          { width, height },
        );
        gpu.drawQuad(
          tmp,
          dst,
          fullscreenCoeffs(width, height),
          control,
        );
        succeeded = true;
      } finally {
        if (succeeded) gpu.pool.release(tmp);
        else gpu.pool.discard(tmp);
      }
      canvas = null;
      c2d = null;
    };

    for (let index = 0; index < items.length; index++) {
      budget.chargeWork();
      const el = items[index];
      if (el.content.kind === 'raster') {
        flush(); // keep z-order: pending vector layer goes down first
        gpu.drawQuad(
          el.content.texture,
          dst,
          elementCoeffs(
            el,
            el.content.width,
            el.content.height,
            width,
            height,
          ),
          control,
        );
        continue;
      }

      // an erasing draw (grow < 0, or an unfilled outside stroke) punches through
      // everything under it on the shared layer — give it a fresh one and flush
      // it out right after
      const erodes = paintErases(el.content.style);
      if (erodes) flush();
      if (!canvas) {
        canvas = new OffscreenCanvas(width, height);
        c2d = canvas.getContext('2d')!;
      }
      const t = el.transform;
      const cs = Math.cos(t.rotation) * t.scale;
      const sn = Math.sin(t.rotation) * t.scale;
      c2d!.setTransform(cs, sn, -sn, cs, width / 2 + t.x, height / 2 + t.y);

      const p = new Path2D();
      if (el.content.kind === 'vector') {
        preflightCanvasPaint(el.content.paths, control);
        for (const path of el.content.paths) appendPath(p, path, control);
      } else {
        const font = fonts.get(el.content.fontKey);
        if (!font) throw new Error(`font not loaded: ${el.content.fontKey}`);
        budget.chargeGlyphs(el.content.glyphs.length);
        const glyphPaths: PathCmd[][] = [];
        let glyphCommands = 0;
        for (const g of el.content.glyphs) {
          budget.checkInterrupt();
          const commands = font.glyphs
            .get(g.glyphId)
            .getPath(g.x, g.y, el.content.fontSize)
            .commands as PathCmd[];
          if (commands.length === 0) continue;
          glyphCommands = commands.length > Number.MAX_SAFE_INTEGER - glyphCommands
            ? Number.MAX_SAFE_INTEGER
            : glyphCommands + commands.length;
          budget.assertCanvasPaint(glyphPaths.length + 1, glyphCommands);
          glyphPaths.push(commands);
        }
        for (const commands of glyphPaths) {
          appendPath(p, commands, control);
        }
      }
      // per-element blur (Place's blur bind) — canvas filters apply per draw op.
      // raster elements skip it for now (they bypass the canvas layer entirely).
      c2d!.filter = el.blur && el.blur > 0 ? `blur(${el.blur}px)` : 'none';
      budget.checkInterrupt();
      paintPath(c2d!, p, el.content.style);
      c2d!.filter = 'none';
      if (erodes) flush();
    }
    flush();
    throwIfCookInterrupted(control);
    // drawQuad accumulates premultiplied (soft edges over transparency would
    // otherwise darken toward black) — convert back to the straight-alpha
    // convention every downstream pass expects
    const out = gpu.pool.acquire(width, height);
    try {
      gpu.runPass('unpremul', dst, out, undefined, control);
    } catch (error) {
      gpu.pool.discard(out);
      throw error;
    }
    gpu.pool.release(dst);
    ownsDst = false;
    return out;
  } catch (error) {
    if (ownsDst) gpu.pool.discard(dst);
    throw error;
  }
}
