// The Phase 3 raster ops. Every one is the same shape: acquire a target,
// run one shader pass over the upstream texture(s), return a new handle.

import type { CookContext, NodeDef } from '../engine/registry';
import type { AlphaValue, ElementsValue, RasterValue } from '../engine/values';
import { renderElements } from '../gpu/elementRenderer';
import { hexToRgb } from '../util/color';
import type { PooledTexture } from '../gpu/pool';

function requireGpu(ctx: { gpu: unknown }) {
  if (!ctx.gpu) throw new Error('raster ops need a GPU context');
}

function renderTarget(
  ctx: CookContext,
  width: number,
  height: number,
  render: (target: PooledTexture) => void,
): PooledTexture {
  const pool = ctx.gpu!.pool;
  const target = pool.acquire(width, height);
  try {
    render(target);
    return target;
  } catch (error) {
    pool.discard(target);
    throw error;
  }
}

/**
 * Elements lift to ink on transparent ground at frame resolution — the same
 * compositing path as Output, minus the paper. `lifted` marks textures created
 * here (not owned by an upstream cache entry) so the caller releases them.
 */
function liftToRaster(v: RasterValue | ElementsValue, ctx: CookContext): { value: RasterValue; lifted: boolean } {
  if (v.kind === 'raster') return { value: v, lifted: false };
  const { width, height } = ctx.frame;
  const texture = renderElements(
    ctx.gpu!,
    ctx.fonts,
    v.items,
    width,
    height,
    { r: 0, g: 0, b: 0, a: 0 },
    ctx,
  );
  return { value: { kind: 'raster', texture, width, height }, lifted: true };
}

export const DitherNode: NodeDef = {
  type: 'Dither',
  inputs: [{ name: 'in', type: 'raster' }],
  outputs: [{ name: 'out', type: 'raster' }],
  params: [
    { name: 'levels', kind: 'number', default: 2, min: 2, max: 8, step: 1 },
    { name: 'scale', kind: 'number', default: 2, min: 1, max: 8, step: 1 },
  ],
  cook(inputs, params, ctx) {
    requireGpu(ctx);
    const src = inputs.in as RasterValue;
    const dst = renderTarget(ctx, src.width, src.height, (target) => {
      ctx.gpu!.runPass('dither', src.texture, target,
        new Float32Array([Number(params.levels), Number(params.scale), 0, 0]),
        ctx);
    });
    return { out: { kind: 'raster', texture: dst, width: src.width, height: src.height } satisfies RasterValue };
  },
};

export const RecolorNode: NodeDef = {
  type: 'Recolor',
  inputs: [{ name: 'in', type: 'raster' }],
  outputs: [{ name: 'out', type: 'raster' }],
  params: [
    { name: 'dark', kind: 'color', default: '#1c1240' },
    { name: 'light', kind: 'color', default: '#ffd27f' },
  ],
  cook(inputs, params, ctx) {
    requireGpu(ctx);
    const src = inputs.in as RasterValue;
    const a = hexToRgb(String(params.dark));
    const b = hexToRgb(String(params.light));
    const dst = renderTarget(ctx, src.width, src.height, (target) => {
      ctx.gpu!.runPass('recolor', src.texture, target,
        new Float32Array([...a, 1, ...b, 1]),
        ctx);
    });
    return { out: { kind: 'raster', texture: dst, width: src.width, height: src.height } satisfies RasterValue };
  },
};

export const ChromaKeyNode: NodeDef = {
  type: 'ChromaKey',
  label: 'Chroma Key',
  inputs: [{ name: 'in', type: 'raster' }],
  outputs: [{ name: 'out', type: 'raster' }],
  params: [
    { name: 'key', kind: 'color', default: '#ffffff' },
    { name: 'tolerance', kind: 'number', default: 0.2, min: 0, max: 1, step: 0.01 },
    { name: 'softness', kind: 'number', default: 0.1, min: 0, max: 1, step: 0.01 },
  ],
  cook(inputs, params, ctx) {
    requireGpu(ctx);
    const src = inputs.in as RasterValue;
    const key = hexToRgb(String(params.key));
    const dst = renderTarget(ctx, src.width, src.height, (target) => {
      ctx.gpu!.runPass('chromakey', src.texture, target,
        new Float32Array([...key, 1, Number(params.tolerance), Number(params.softness), 0, 0]),
        ctx);
    });
    return { out: { kind: 'raster', texture: dst, width: src.width, height: src.height } satisfies RasterValue };
  },
};

export const AsciiNode: NodeDef = {
  type: 'ASCII',
  inputs: [{ name: 'in', type: 'raster' }],
  outputs: [{ name: 'out', type: 'raster' }],
  params: [{ name: 'cell', kind: 'number', default: 8, min: 4, max: 32, step: 1 }],
  cook(inputs, params, ctx) {
    requireGpu(ctx);
    const src = inputs.in as RasterValue;
    const atlas = ctx.gpu!.getAsciiAtlas();
    const dst = renderTarget(ctx, src.width, src.height, (target) => {
      ctx.gpu!.runPass('ascii', [src.texture, atlas.texture], target,
        new Float32Array([Number(params.cell), atlas.glyphs, 0, 0]),
        ctx);
    });
    return { out: { kind: 'raster', texture: dst, width: src.width, height: src.height } satisfies RasterValue };
  },
};

export const ToAlphaNode: NodeDef = {
  type: 'ToAlpha',
  label: 'To Alpha',
  inputs: [{ name: 'in', type: 'raster' }],
  outputs: [{ name: 'out', type: 'alpha' }],
  params: [
    { name: 'source', kind: 'select', options: ['luminance', 'alpha'], default: 'luminance' },
    { name: 'invert', kind: 'select', options: ['no', 'yes'], default: 'no' },
    // in = value ≥ threshold (after invert); softness feathers a band around
    // the cutoff instead of a hard step, for anti-aliased mask edges
    { name: 'threshold', kind: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    { name: 'softness', kind: 'number', default: 0, min: 0, max: 0.5, step: 0.01 },
  ],
  cook(inputs, params, ctx) {
    requireGpu(ctx);
    const src = inputs.in as RasterValue;
    const dst = renderTarget(ctx, src.width, src.height, (target) => {
      ctx.gpu!.runPass('toalpha', src.texture, target, new Float32Array([
        params.source === 'alpha' ? 1 : 0,
        params.invert === 'yes' ? 1 : 0,
        Number(params.threshold),
        Number(params.softness),
      ]), ctx);
    });
    return { out: { kind: 'alpha', texture: dst, width: src.width, height: src.height } satisfies AlphaValue };
  },
};

const COMPOSITE_MODES = ['normal', 'multiply', 'screen', 'overlay'];

export const CompositeNode: NodeDef = {
  type: 'Composite',
  inputs: [
    { name: 'base', type: ['raster', 'elements'] },
    { name: 'overlay', type: ['raster', 'elements'] },
    { name: 'mask', type: 'alpha', optional: true },
  ],
  outputs: [{ name: 'out', type: 'raster' }],
  params: [
    { name: 'mode', kind: 'select', options: COMPOSITE_MODES, default: 'normal' },
    { name: 'opacity', kind: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  usesFrame: true,
  cook(inputs, params, ctx) {
    requireGpu(ctx);
    let base: ReturnType<typeof liftToRaster> | null = null;
    let overlay: ReturnType<typeof liftToRaster> | null = null;
    try {
      base = liftToRaster(inputs.base as RasterValue | ElementsValue, ctx);
      overlay = liftToRaster(inputs.overlay as RasterValue | ElementsValue, ctx);
      const mask = inputs.mask as AlphaValue | undefined;
      const dst = renderTarget(
        ctx,
        base.value.width,
        base.value.height,
        (target) => {
          ctx.gpu!.runPass(
            'composite',
            [base!.value.texture, overlay!.value.texture, mask ? mask.texture : ctx.gpu!.white()],
            target,
            new Float32Array([Math.max(0, COMPOSITE_MODES.indexOf(String(params.mode))), Number(params.opacity), 0, 0]),
            ctx,
          );
        },
      );
      return { out: { kind: 'raster', texture: dst, width: base.value.width, height: base.value.height } satisfies RasterValue };
    } finally {
      if (base?.lifted) ctx.gpu!.pool.release(base.value.texture);
      if (overlay?.lifted) ctx.gpu!.pool.release(overlay.value.texture);
    }
  },
};
