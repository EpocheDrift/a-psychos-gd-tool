import { describe, expect, it, vi } from 'vitest';
import {
  boundsOfPaths,
  flattenPaths,
  polylinesToPaths,
  samplePathEvenly,
  transformPaths,
} from './path';
import type { PathCmd } from './values';
import { DisplaceNode } from '../nodes/vectorOps';
import { ShapeNode } from '../nodes/shape';
import type { CookContext } from './registry';
import type { VectorValue } from './values';
import {
  CookDeadlineExceededError,
  CookResourceLimitError,
} from './cookControl';
import { GeometryBudget } from './geometryBudget';
import { preflightCanvasPaint } from '../gpu/paint';

const ctx: CookContext = { gpu: null, fonts: new Map(), frame: { width: 768, height: 512 } };

describe('flattenPaths', () => {
  it('keeps line segments and the closed flag', () => {
    const cmds: PathCmd[][] = [[
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 10, y: 0 },
      { type: 'L', x: 10, y: 10 },
      { type: 'Z' },
    ]];
    const polys = flattenPaths(cmds);
    expect(polys).toHaveLength(1);
    expect(polys[0].closed).toBe(true);
    expect(polys[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('samples cubics densely and lands exactly on the endpoint', () => {
    const cmds: PathCmd[][] = [[
      { type: 'M', x: 0, y: 0 },
      { type: 'C', x1: 0, y1: 100, x2: 100, y2: 100, x: 100, y: 0 },
    ]];
    const polys = flattenPaths(cmds, 2.5);
    const pts = polys[0].points;
    expect(pts.length).toBeGreaterThan(10);
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it('splits multiple M-subpaths into separate polylines', () => {
    const cmds: PathCmd[][] = [[
      { type: 'M', x: 0, y: 0 }, { type: 'L', x: 5, y: 0 }, { type: 'Z' },
      { type: 'M', x: 20, y: 20 }, { type: 'L', x: 25, y: 20 }, { type: 'Z' },
    ]];
    expect(flattenPaths(cmds)).toHaveLength(2);
  });

  it('rejects curve expansion before exceeding the flattened-point budget', () => {
    const cmds: PathCmd[][] = [[
      { type: 'M', x: 0, y: 0 },
      {
        type: 'C',
        x1: 0,
        y1: 1_000,
        x2: 1_000,
        y2: 1_000,
        x: 1_000,
        y: 0,
      },
    ]];
    expect(() => flattenPaths(cmds, 1, {
      maxFlattenedPoints: 8,
      maxGeometryWorkUnits: 10_000,
    })).toThrow(CookResourceLimitError);
  });

  it('checks an absolute deadline from inside a long synchronous path loop', () => {
    const now = vi.spyOn(performance, 'now');
    let calls = 0;
    now.mockImplementation(() => (++calls < 3 ? 0 : 11));
    const commands: PathCmd[] = [{ type: 'M', x: 0, y: 0 }];
    for (let index = 0; index < 600; index++) {
      commands.push({ type: 'L', x: index, y: index });
    }
    try {
      expect(() => boundsOfPaths([commands], {
        deadline: 10,
        maxVectorCommands: 10_000,
        maxGeometryWorkUnits: 10_000,
      })).toThrow(CookDeadlineExceededError);
    } finally {
      now.mockRestore();
    }
  });
});

describe('polylinesToPaths', () => {
  it('round-trips a polyline to M/L/Z', () => {
    const paths = polylinesToPaths([{ points: [{ x: 0, y: 0 }, { x: 4, y: 2 }], closed: true }]);
    expect(paths).toEqual([[
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 4, y: 2 },
      { type: 'Z' },
    ]]);
  });

  it('bounds path copies by vector-command work', () => {
    const paths: PathCmd[][] = [[
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 1, y: 0 },
      { type: 'L', x: 1, y: 1 },
      { type: 'Z' },
    ]];
    expect(() => transformPaths(
      paths,
      { x: 0, y: 0, rotation: 0, scale: 1 },
      {
        maxVectorCommands: 3,
        maxGeometryWorkUnits: 100,
      },
    )).toThrow(CookResourceLimitError);
  });

  it('drops empty paths instead of allocating transformed containers', () => {
    const control = {
      maxVectorPaths: 1,
      maxVectorCommands: 10,
      maxGeometryWorkUnits: 10,
    };
    const geometryBudget = new GeometryBudget(control);
    expect(transformPaths(
      [[], [], [], [], []],
      { x: 0, y: 0, rotation: 0, scale: 1 },
      { ...control, geometryBudget },
    )).toEqual([]);
    expect(geometryBudget.snapshot()).toMatchObject({
      vectorPaths: 0,
      geometryWorkUnits: 5,
    });
  });

  it('rejects path-container amplification before allocating past its cap', () => {
    const source: PathCmd[][] = Array.from({ length: 3 }, (_, index) => [{
      type: 'M',
      x: index,
      y: 0,
    }]);
    const control = {
      maxVectorPaths: 2,
      maxVectorCommands: 10,
      maxGeometryWorkUnits: 100,
    };
    const geometryBudget = new GeometryBudget(control);
    expect(() => transformPaths(
      source,
      { x: 0, y: 0, rotation: 0, scale: 1 },
      { ...control, geometryBudget },
    )).toThrow(CookResourceLimitError);
    expect(geometryBudget.snapshot().vectorPaths).toBe(2);
  });
});

describe('Canvas paint peak limits', () => {
  it('rejects one opaque native paint by path or command count', () => {
    expect(() => preflightCanvasPaint(
      [[{ type: 'M', x: 0, y: 0 }], [{ type: 'M', x: 1, y: 0 }]],
      {
        maxCanvasPaintPaths: 1,
        maxCanvasPaintCommands: 10,
        maxGeometryWorkUnits: 100,
      },
    )).toThrow(CookResourceLimitError);

    expect(() => preflightCanvasPaint(
      [[
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 1, y: 0 },
        { type: 'L', x: 2, y: 0 },
      ]],
      {
        maxCanvasPaintPaths: 10,
        maxCanvasPaintCommands: 2,
        maxGeometryWorkUnits: 100,
      },
    )).toThrow(CookResourceLimitError);
  });

  it('treats the native-call ceiling as a peak, not an attempt total', () => {
    const control = {
      maxCanvasPaintPaths: 1,
      maxCanvasPaintCommands: 2,
      maxGeometryWorkUnits: 100,
    };
    const geometryBudget = new GeometryBudget(control);
    const paths: PathCmd[][] = [[
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 1, y: 0 },
    ]];
    preflightCanvasPaint(paths, { ...control, geometryBudget });
    preflightCanvasPaint(paths, { ...control, geometryBudget });
    expect(geometryBudget.snapshot().geometryWorkUnits).toBe(2);
  });
});

describe('Shape node', () => {
  it('makes an ellipse with the requested bounds', async () => {
    const out = await ShapeNode.cook({}, { kind: 'ellipse', width: 300, height: 200, sides: 6 }, ctx);
    const v = out.out as VectorValue;
    expect(v.bounds.width).toBeGreaterThanOrEqual(298);
    expect(v.bounds.width).toBeLessThanOrEqual(302);
    expect(v.bounds.height).toBeGreaterThanOrEqual(198);
    expect(v.bounds.height).toBeLessThanOrEqual(202);
  });
});

describe('samplePathEvenly offset / gap', () => {
  // a unit square, perimeter 400, walked clockwise from the origin
  const square = flattenPaths([[
    { type: 'M', x: 0, y: 0 }, { type: 'L', x: 100, y: 0 },
    { type: 'L', x: 100, y: 100 }, { type: 'L', x: 0, y: 100 }, { type: 'Z' },
  ]]);

  it('gap drives how many points fit; the run is centered on the path', () => {
    const pts = samplePathEvenly(square, 100); // 400 / 100 = 4 points, centered
    expect(pts).toHaveLength(4);
    expect(pts.map((p) => [p.x, p.y])).toEqual([[50, 100], [0, 50], [50, 0], [100, 50]]);
  });

  it('offset slides the whole run along the arc (half a side → the corners)', () => {
    const pts = samplePathEvenly(square, 100, 50);
    expect(pts.map((p) => [p.x, p.y])).toEqual([[0, 100], [0, 0], [100, 0], [100, 100]]);
  });

  it('a gap that does not divide the length evenly drops the remainder', () => {
    expect(samplePathEvenly(square, 120)).toHaveLength(3); // floor(400 / 120)
  });

  it('is not pinned to the start: the first sample moves when gap changes', () => {
    const a = samplePathEvenly(square, 100)[0];
    const b = samplePathEvenly(square, 160)[0];
    expect([a.x, a.y]).not.toEqual([b.x, b.y]);
  });

  it('rejects dynamic sample counts before allocating them', () => {
    expect(() => samplePathEvenly(
      [{
        points: [{ x: 0, y: 0 }, { x: 1_000, y: 0 }],
        closed: false,
      }],
      1,
      0,
      {
        maxGeneratedItems: 10,
        maxGeometryWorkUnits: 10_000,
      },
    )).toThrow(CookResourceLimitError);
  });

  it('uses bounded segment lookup for dense multi-segment sampling', () => {
    const points = Array.from(
      { length: 1_001 },
      (_, index) => ({ x: index, y: 0 }),
    );
    expect(samplePathEvenly(
      [{ points, closed: false }],
      1,
      0,
      {
        maxGeneratedItems: 2_000,
        maxGeometryWorkUnits: 50_000,
      },
    )).toHaveLength(1_000);
  });
});

describe('Displace node', () => {
  it('is deterministic for the same seed, different for another', async () => {
    const square: VectorValue = {
      kind: 'vector',
      paths: [[
        { type: 'M', x: 0, y: 0 }, { type: 'L', x: 100, y: 0 },
        { type: 'L', x: 100, y: 100 }, { type: 'L', x: 0, y: 100 }, { type: 'Z' },
      ]],
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    };
    const p = { amount: 8, scale: 40, seed: 3 };
    const a = await DisplaceNode.cook({ in: square }, p, ctx);
    const b = await DisplaceNode.cook({ in: square }, p, ctx);
    const c = await DisplaceNode.cook({ in: square }, { ...p, seed: 4 }, ctx);
    expect(a.out).toEqual(b.out); // cache-safe: same params, same geometry
    expect(a.out).not.toEqual(c.out);
    expect(boundsOfPaths((a.out as VectorValue).paths).width).toBeGreaterThan(90);
  });
});
