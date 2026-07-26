// Headless engine tests — the Phase 1 gate, provable without a GPU:
// change one param → only that node and its descendants re-cook.

import { describe, expect, it, vi } from 'vitest';
import type { Graph } from './graph';
import { CycleDetectedError, Evaluator } from './evaluator';
import type { CookContext, NodeDef, Registry } from './registry';
import {
  CookCancelledError,
  CookDeadlineExceededError,
} from './cookControl';
import type { PooledTexture } from '../gpu/pool';

// numeric stub values stand in for real Values; the evaluator never inspects
// them beyond raster disposal (skipped when ctx.gpu is null)
const num = (v: number) => ({ kind: 'num', v }) as never;

function stubRegistry(cookCounts: Record<string, number>): Registry {
  const count = (type: string) => { cookCounts[type] = (cookCounts[type] ?? 0) + 1; };
  const defs: NodeDef[] = [
    {
      type: 'Const',
      inputs: [],
      outputs: [{ name: 'out', type: 'raster' }],
      params: [{ name: 'v', kind: 'number', default: 0 }],
      cook: (_i, p) => { count('Const'); return { out: num(Number(p.v)) }; },
    },
    {
      type: 'Add',
      inputs: [{ name: 'in', type: 'raster' }],
      outputs: [{ name: 'out', type: 'raster' }],
      params: [{ name: 'k', kind: 'number', default: 0 }],
      cook: (i, p) => { count('Add'); return { out: num((i.in as never as { v: number }).v + Number(p.k)) }; },
    },
    {
      type: 'Sum2',
      inputs: [{ name: 'a', type: 'raster' }, { name: 'b', type: 'raster' }],
      outputs: [{ name: 'out', type: 'raster' }],
      params: [],
      cook: (i) => {
        count('Sum2');
        return { out: num((i.a as never as { v: number }).v + (i.b as never as { v: number }).v) };
      },
    },
    {
      type: 'AsyncAdd',
      inputs: [{ name: 'in', type: 'raster' }],
      outputs: [{ name: 'out', type: 'raster' }],
      params: [{ name: 'k', kind: 'number', default: 0 }],
      cook: async (i, p) => {
        count('AsyncAdd');
        await new Promise((r) => setTimeout(r, 1));
        return { out: num((i.in as never as { v: number }).v + Number(p.k)) };
      },
    },
    {
      type: 'AsyncConst',
      inputs: [],
      outputs: [{ name: 'out', type: 'raster' }],
      params: [{ name: 'v', kind: 'number', default: 0 }],
      cook: async (_i, p) => {
        count('AsyncConst');
        await new Promise((r) => setTimeout(r, 1));
        return { out: num(Number(p.v)) };
      },
    },
  ];
  return new Map(defs.map((d) => [d.type, d]));
}

const ctx: CookContext = { gpu: null, fonts: new Map(), frame: { width: 768, height: 512 } };

function chainGraph(): Graph {
  // a(Const) -> b(Add) -> c(Add)
  return {
    nodes: {
      a: { id: 'a', type: 'Const', params: { v: 1 } },
      b: { id: 'b', type: 'Add', params: { k: 10 } },
      c: { id: 'c', type: 'Add', params: { k: 100 } },
    },
    edges: [
      { from: { node: 'a', socket: 'out' }, to: { node: 'b', socket: 'in' } },
      { from: { node: 'b', socket: 'out' }, to: { node: 'c', socket: 'in' } },
    ],
  };
}

function statuses(ev: Evaluator): Record<string, 'hit' | 'miss'> {
  return Object.fromEntries(ev.events.map((e) => [e.nodeId, e.status]));
}

describe('Evaluator', () => {
  it('preserves actionable resource details through node attribution', async () => {
    const registry: Registry = new Map([[
      'Limited',
      {
        type: 'Limited',
        inputs: [],
        outputs: [{ name: 'out', type: 'raster' }],
        params: [],
        cook: () => {
          throw Object.assign(new Error('GPU budget exhausted'), {
            code: 'RESOURCE_LIMIT',
            recoverable: true,
            phase: 'allocate',
            details: {
              requestedBytes: 64,
              maximumBytes: 32,
            },
          });
        },
      },
    ]]);
    const evaluator = new Evaluator(registry);
    await expect(evaluator.evaluate({
      nodes: {
        limited: { id: 'limited', type: 'Limited', params: {} },
      },
      edges: [],
    }, 'limited', ctx)).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
      nodeId: 'limited',
      nodeType: 'Limited',
      phase: 'allocate',
      details: {
        requestedBytes: 64,
        maximumBytes: 32,
      },
    });
  });

  it('cooks a chain and produces the right value', async () => {
    const ev = new Evaluator(stubRegistry({}));
    const { outputs } = await ev.evaluate(chainGraph(), 'c', ctx);
    expect((outputs.out as never as { v: number }).v).toBe(111);
    expect(statuses(ev)).toEqual({ a: 'miss', b: 'miss', c: 'miss' });
  });

  it('hits cache on a second identical evaluate — zero re-cooks', async () => {
    const counts: Record<string, number> = {};
    const ev = new Evaluator(stubRegistry(counts));
    const g = chainGraph();
    await ev.evaluate(g, 'c', ctx);
    await ev.evaluate(g, 'c', ctx);
    expect(statuses(ev)).toEqual({ a: 'hit', b: 'hit', c: 'hit' });
    expect(counts).toEqual({ Const: 1, Add: 2 }); // nothing cooked twice
  });

  it('re-cooks only descendants when a mid-chain param changes', async () => {
    const ev = new Evaluator(stubRegistry({}));
    const g = chainGraph();
    await ev.evaluate(g, 'c', ctx);
    g.nodes.b.params.k = 20; // change the middle node
    const { outputs } = await ev.evaluate(g, 'c', ctx);
    expect(statuses(ev)).toEqual({ a: 'hit', b: 'miss', c: 'miss' });
    expect((outputs.out as never as { v: number }).v).toBe(121);
  });

  it('re-cooks everything when the leaf changes', async () => {
    const ev = new Evaluator(stubRegistry({}));
    const g = chainGraph();
    await ev.evaluate(g, 'c', ctx);
    g.nodes.a.params.v = 2;
    await ev.evaluate(g, 'c', ctx);
    expect(statuses(ev)).toEqual({ a: 'miss', b: 'miss', c: 'miss' });
  });

  it('cooks a diamond dependency once per node', async () => {
    const counts: Record<string, number> = {};
    const ev = new Evaluator(stubRegistry(counts));
    // a -> b, a -> c, (b,c) -> d
    const g: Graph = {
      nodes: {
        a: { id: 'a', type: 'Const', params: { v: 1 } },
        b: { id: 'b', type: 'Add', params: { k: 10 } },
        c: { id: 'c', type: 'Add', params: { k: 100 } },
        d: { id: 'd', type: 'Sum2', params: {} },
      },
      edges: [
        { from: { node: 'a', socket: 'out' }, to: { node: 'b', socket: 'in' } },
        { from: { node: 'a', socket: 'out' }, to: { node: 'c', socket: 'in' } },
        { from: { node: 'b', socket: 'out' }, to: { node: 'd', socket: 'a' } },
        { from: { node: 'c', socket: 'out' }, to: { node: 'd', socket: 'b' } },
      ],
    };
    const { outputs } = await ev.evaluate(g, 'd', ctx);
    expect((outputs.out as never as { v: number }).v).toBe(112);
    expect(counts.Const).toBe(1); // shared upstream cooked once, not twice
  });

  it('does not mistake an async diamond for a cycle', async () => {
    const counts: Record<string, number> = {};
    const ev = new Evaluator(stubRegistry(counts));
    const g: Graph = {
      nodes: {
        a: { id: 'a', type: 'AsyncConst', params: { v: 1 } },
        b: { id: 'b', type: 'Add', params: { k: 10 } },
        c: { id: 'c', type: 'Add', params: { k: 100 } },
        d: { id: 'd', type: 'Sum2', params: {} },
      },
      edges: [
        { from: { node: 'a', socket: 'out' }, to: { node: 'b', socket: 'in' } },
        { from: { node: 'a', socket: 'out' }, to: { node: 'c', socket: 'in' } },
        { from: { node: 'b', socket: 'out' }, to: { node: 'd', socket: 'a' } },
        { from: { node: 'c', socket: 'out' }, to: { node: 'd', socket: 'b' } },
      ],
    };

    const { outputs } = await ev.evaluate(g, 'd', ctx);
    expect((outputs.out as never as { v: number }).v).toBe(112);
    expect(counts.AsyncConst).toBe(1);
  });

  it('serializes independent siblings to bound in-flight node resources', async () => {
    const leftGate = deferred<void>();
    const rightGate = deferred<void>();
    const leftStarted = deferred<void>();
    const rightStarted = deferred<void>();
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;
    const registry: Registry = new Map([
      ['Gated', {
        type: 'Gated',
        inputs: [],
        outputs: [{ name: 'out', type: 'raster' }],
        params: [{ name: 'v', kind: 'number', default: 0 }],
        cook: async (_inputs, params) => {
          const value = Number(params.v);
          started.push(value);
          active++;
          maxActive = Math.max(maxActive, active);
          if (value === 1) {
            leftStarted.resolve();
            await leftGate.promise;
          } else {
            rightStarted.resolve();
            await rightGate.promise;
          }
          active--;
          return { out: num(value) };
        },
      }],
      ['Join', {
        type: 'Join',
        inputs: [
          { name: 'a', type: 'raster' },
          { name: 'b', type: 'raster' },
        ],
        outputs: [{ name: 'out', type: 'raster' }],
        params: [],
        cook: (inputs) => ({
          out: num(
            (inputs.a as never as { v: number }).v
            + (inputs.b as never as { v: number }).v,
          ),
        }),
      }],
    ]);
    const graph: Graph = {
      nodes: {
        left: { id: 'left', type: 'Gated', params: { v: 1 } },
        right: { id: 'right', type: 'Gated', params: { v: 2 } },
        root: { id: 'root', type: 'Join', params: {} },
      },
      edges: [
        { from: { node: 'right', socket: 'out' }, to: { node: 'root', socket: 'b' } },
        { from: { node: 'left', socket: 'out' }, to: { node: 'root', socket: 'a' } },
      ],
    };

    const running = new Evaluator(registry).evaluate(graph, 'root', ctx);
    await leftStarted.promise;
    expect(started).toEqual([1]);
    expect(active).toBe(1);

    leftGate.resolve();
    await rightStarted.promise;
    expect(started).toEqual([1, 2]);
    expect(active).toBe(1);
    expect(maxActive).toBe(1);

    rightGate.resolve();
    const result = await running;
    expect((result.outputs.out as never as { v: number }).v).toBe(3);
  });

  it('returns CYCLE_DETECTED with the reachable cycle path', async () => {
    const counts: Record<string, number> = {};
    const ev = new Evaluator(stubRegistry(counts));
    const g: Graph = {
      nodes: {
        a: { id: 'a', type: 'Add', params: {} },
        b: { id: 'b', type: 'Add', params: {} },
      },
      edges: [
        { from: { node: 'a', socket: 'out' }, to: { node: 'b', socket: 'in' } },
        { from: { node: 'b', socket: 'out' }, to: { node: 'a', socket: 'in' } },
      ],
    };

    await expect(ev.evaluate(g, 'a', ctx)).rejects.toMatchObject({
      name: 'CycleDetectedError',
      code: 'CYCLE_DETECTED',
      cycle: ['a', 'b', 'a'],
    });
    expect(counts).toEqual({});
  });

  it('returns CYCLE_DETECTED for a self-loop', async () => {
    const ev = new Evaluator(stubRegistry({}));
    const g: Graph = {
      nodes: { a: { id: 'a', type: 'Add', params: {} } },
      edges: [{ from: { node: 'a', socket: 'out' }, to: { node: 'a', socket: 'in' } }],
    };

    await expect(ev.evaluate(g, 'a', ctx)).rejects.toEqual(
      expect.objectContaining({
        name: 'CycleDetectedError',
        code: 'CYCLE_DETECTED',
        cycle: ['a', 'a'],
      }),
    );
  });

  it('can retry with the same evaluator after a cyclic graph is repaired', async () => {
    const ev = new Evaluator(stubRegistry({}));
    const g: Graph = {
      nodes: {
        source: { id: 'source', type: 'Const', params: { v: 2 } },
        a: { id: 'a', type: 'Add', params: { k: 10 } },
        b: { id: 'b', type: 'Add', params: { k: 100 } },
      },
      edges: [
        { from: { node: 'a', socket: 'out' }, to: { node: 'b', socket: 'in' } },
        { from: { node: 'b', socket: 'out' }, to: { node: 'a', socket: 'in' } },
      ],
    };
    await expect(ev.evaluate(g, 'b', ctx)).rejects.toBeInstanceOf(CycleDetectedError);

    g.edges = [
      { from: { node: 'source', socket: 'out' }, to: { node: 'a', socket: 'in' } },
      { from: { node: 'a', socket: 'out' }, to: { node: 'b', socket: 'in' } },
    ];
    const repaired = await ev.evaluate(g, 'b', ctx);
    expect((repaired.outputs.out as never as { v: number }).v).toBe(112);

    await ev.evaluate(g, 'b', ctx);
    expect(statuses(ev)).toEqual({ source: 'hit', a: 'hit', b: 'hit' });
  });

  it('allows optional inputs to stay unwired, requires the rest', async () => {
    const counts: Record<string, number> = {};
    const registry = stubRegistry(counts);
    registry.set('Opt', {
      type: 'Opt',
      inputs: [
        { name: 'in', type: 'raster' },
        { name: 'extra', type: 'raster', optional: true },
      ],
      outputs: [{ name: 'out', type: 'raster' }],
      params: [],
      cook: (i) => ({ out: num((i.in as never as { v: number }).v + (i.extra ? 1000 : 0)) }),
    });
    const ev = new Evaluator(registry);
    const g: Graph = {
      nodes: {
        a: { id: 'a', type: 'Const', params: { v: 3 } },
        o: { id: 'o', type: 'Opt', params: {} },
      },
      edges: [{ from: { node: 'a', socket: 'out' }, to: { node: 'o', socket: 'in' } }],
    };
    const { outputs } = await ev.evaluate(g, 'o', ctx);
    expect((outputs.out as never as { v: number }).v).toBe(3); // cooked without 'extra'

    g.edges = []; // now even the required input is gone
    await expect(ev.evaluate(g, 'o', ctx)).rejects.toThrow(/input "in" is not connected/);
  });

  it('fills missing params with registry defaults, hashing them identically', async () => {
    const counts: Record<string, number> = {};
    const registry = stubRegistry(counts);
    registry.set('Sized', {
      type: 'Sized',
      inputs: [],
      outputs: [{ name: 'out', type: 'raster' }],
      params: [{ name: 'size', kind: 'number', default: 64 }],
      cook: (_i, p) => {
        if (typeof p.size !== 'number' || Number.isNaN(p.size)) throw new Error('size missing');
        return { out: num(Number(p.size)) };
      },
    });
    const ev = new Evaluator(registry);
    // instance predates the param — params is empty (the createTexture NaN bug)
    const bare: Graph = { nodes: { s: { id: 's', type: 'Sized', params: {} } }, edges: [] };
    const first = await ev.evaluate(bare, 's', ctx);
    expect((first.outputs.out as never as { v: number }).v).toBe(64); // cooked with the default

    // an instance with the default written out is the SAME content → cache hit
    const explicit: Graph = { nodes: { s: { id: 's', type: 'Sized', params: { size: 64 } } }, edges: [] };
    await ev.evaluate(explicit, 's', ctx);
    expect(statuses(ev)).toEqual({ s: 'hit' });
  });

  it('re-cooks only frame-aware nodes when the frame changes', async () => {
    const counts: Record<string, number> = {};
    const registry = stubRegistry(counts);
    registry.set('Framed', {
      type: 'Framed',
      inputs: [{ name: 'in', type: 'raster' }],
      outputs: [{ name: 'out', type: 'raster' }],
      params: [],
      usesFrame: true,
      cook: (i, _p, c) => {
        counts.Framed = (counts.Framed ?? 0) + 1;
        return { out: num((i.in as never as { v: number }).v + c.frame.width) };
      },
    });
    const ev = new Evaluator(registry);
    const g: Graph = {
      nodes: {
        a: { id: 'a', type: 'Const', params: { v: 1 } }, // frame-unaware
        f: { id: 'f', type: 'Framed', params: {} },
      },
      edges: [{ from: { node: 'a', socket: 'out' }, to: { node: 'f', socket: 'in' } }],
    };
    const first = await ev.evaluate(g, 'f', { ...ctx, frame: { width: 100, height: 100 } });
    expect((first.outputs.out as never as { v: number }).v).toBe(101);

    const second = await ev.evaluate(g, 'f', { ...ctx, frame: { width: 200, height: 100 } });
    expect(statuses(ev)).toEqual({ a: 'hit', f: 'miss' }); // only the frame-aware node re-cooked
    expect((second.outputs.out as never as { v: number }).v).toBe(201);
  });

  it('re-cooks via hashExtras when the resolved context changes', async () => {
    const registry = stubRegistry({});
    // mirrors Text's font fallback: cook resolves the requested font from
    // ctx.fonts or falls back, and hashExtras folds the resolved key into the
    // hash so the cached fallback cook is invalidated once the font loads
    registry.set('Fonty', {
      type: 'Fonty',
      inputs: [],
      outputs: [{ name: 'out', type: 'raster' }],
      params: [{ name: 'font', kind: 'string', default: 'wanted' }],
      hashExtras: (p, c) => ({
        '@font': c.fonts.has(String(p.font)) ? String(p.font) : 'default',
        '@environment': String(c.environmentRevision ?? 0),
      }),
      cook: (_i, p, c) => ({ out: num(c.fonts.has(String(p.font)) ? 1 : 0) }),
    });
    const ev = new Evaluator(registry);
    const g: Graph = { nodes: { t: { id: 't', type: 'Fonty', params: {} } }, edges: [] };

    const before = await ev.evaluate(g, 't', { ...ctx, fonts: new Map() });
    expect((before.outputs.out as never as { v: number }).v).toBe(0); // cooked with the fallback

    const loaded = new Map([['wanted', {} as never]]);
    const after = await ev.evaluate(g, 't', { ...ctx, fonts: loaded });
    expect(statuses(ev)).toEqual({ t: 'miss' }); // the arriving font invalidates the fallback cook
    expect((after.outputs.out as never as { v: number }).v).toBe(1);

    await ev.evaluate(g, 't', { ...ctx, fonts: loaded });
    expect(statuses(ev)).toEqual({ t: 'hit' }); // stable once resolved

    await ev.evaluate(g, 't', {
      ...ctx,
      fonts: loaded,
      environmentRevision: 1,
    });
    expect(statuses(ev)).toEqual({ t: 'miss' });
  });

  it('awaits async nodes with no special casing', async () => {
    const ev = new Evaluator(stubRegistry({}));
    const g: Graph = {
      nodes: {
        a: { id: 'a', type: 'Const', params: { v: 5 } },
        b: { id: 'b', type: 'AsyncAdd', params: { k: 7 } },
      },
      edges: [{ from: { node: 'a', socket: 'out' }, to: { node: 'b', socket: 'in' } }],
    };
    const first = await ev.evaluate(g, 'b', ctx);
    expect((first.outputs.out as never as { v: number }).v).toBe(12);
    await ev.evaluate(g, 'b', ctx);
    expect(statuses(ev)).toEqual({ a: 'hit', b: 'hit' }); // async result cached like any other
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function raster(texture: PooledTexture) {
  return {
    kind: 'raster' as const,
    texture,
    width: 1,
    height: 1,
  };
}

function gpuContext(release: ReturnType<typeof vi.fn>): CookContext {
  return {
    gpu: {
      pool: { release },
    } as unknown as CookContext['gpu'],
    fonts: new Map(),
    frame: { width: 1, height: 1 },
    revision: 1,
    layerId: 'layer_1',
  };
}

describe('Evaluator cancellation transactions', () => {
  it('detaches an async cook that never settles after cancellation', async () => {
    const registry: Registry = new Map([['Never', {
      type: 'Never',
      inputs: [],
      outputs: [{ name: 'out', type: 'raster' }],
      params: [],
      cook: () => new Promise(() => {}),
    }]]);
    const graph: Graph = {
      nodes: { never: { id: 'never', type: 'Never', params: {} } },
      edges: [],
    };
    const controller = new AbortController();
    const running = new Evaluator(registry).evaluate(graph, 'never', {
      ...ctx,
      signal: controller.signal,
      revision: 9,
    });
    await Promise.resolve();
    controller.abort(new CookCancelledError(9));
    await expect(running).rejects.toMatchObject({
      code: 'RENDER_SUPERSEDED',
      nodeId: 'never',
    });
  });

  it('does not call cook for an already aborted attempt', async () => {
    const cook = vi.fn(() => ({ out: num(1) }));
    const registry: Registry = new Map([['Source', {
      type: 'Source',
      inputs: [],
      outputs: [{ name: 'out', type: 'raster' }],
      params: [],
      cook,
    }]]);
    const graph: Graph = {
      nodes: { source: { id: 'source', type: 'Source', params: {} } },
      edges: [],
    };
    const controller = new AbortController();
    controller.abort(new CookCancelledError(1));
    await expect(new Evaluator(registry).evaluate(graph, 'source', {
      ...ctx,
      signal: controller.signal,
      revision: 1,
    })).rejects.toBeInstanceOf(CookCancelledError);
    expect(cook).not.toHaveBeenCalled();
  });

  it('fails before cook when the shared deadline has elapsed', async () => {
    const cook = vi.fn(() => ({ out: num(1) }));
    const registry: Registry = new Map([['Source', {
      type: 'Source',
      inputs: [],
      outputs: [{ name: 'out', type: 'raster' }],
      params: [],
      cook,
    }]]);
    const graph: Graph = {
      nodes: { source: { id: 'source', type: 'Source', params: {} } },
      edges: [],
    };
    await expect(new Evaluator(registry).evaluate(graph, 'source', {
      ...ctx,
      deadline: performance.now() - 1,
      revision: 2,
    })).rejects.toBeInstanceOf(CookDeadlineExceededError);
    expect(cook).not.toHaveBeenCalled();
  });

  it('releases a late raster result and does not cache it', async () => {
    const first = deferred<Record<string, ReturnType<typeof raster>>>();
    const texture = {} as PooledTexture;
    const release = vi.fn();
    let calls = 0;
    const registry: Registry = new Map([['Slow', {
      type: 'Slow',
      inputs: [],
      outputs: [{ name: 'out', type: 'raster' }],
      params: [],
      cook: () => {
        calls++;
        return calls === 1 ? first.promise : { out: raster(texture) };
      },
    }]]);
    const graph: Graph = {
      nodes: { slow: { id: 'slow', type: 'Slow', params: {} } },
      edges: [],
    };
    const evaluator = new Evaluator(registry);
    const controller = new AbortController();
    const running = evaluator.evaluate(graph, 'slow', {
      ...gpuContext(release),
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort(new CookCancelledError(1));
    first.resolve({ out: raster(texture) });
    await expect(running).rejects.toMatchObject({
      code: 'RENDER_SUPERSEDED',
      nodeId: 'slow',
    });
    expect(release).toHaveBeenCalledTimes(1);

    await evaluator.evaluate(graph, 'slow', gpuContext(release));
    expect(calls).toBe(2);
  });

  it('does not start a later sibling after an earlier dependency fails', async () => {
    const slowCook = vi.fn((): Promise<never> => new Promise(() => {}));
    const registry: Registry = new Map([
      ['Fail', {
        type: 'Fail',
        inputs: [],
        outputs: [{ name: 'out', type: 'raster' }],
        params: [],
        cook: () => {
          throw new Error('left failed');
        },
      }],
      ['Slow', {
        type: 'Slow',
        inputs: [],
        outputs: [{ name: 'out', type: 'raster' }],
        params: [],
        cook: slowCook,
      }],
      ['Join', {
        type: 'Join',
        inputs: [
          { name: 'left', type: 'raster' },
          { name: 'right', type: 'raster' },
        ],
        outputs: [{ name: 'out', type: 'raster' }],
        params: [],
        cook: () => ({ out: num(0) }),
      }],
    ]);
    const graph: Graph = {
      nodes: {
        left: { id: 'left', type: 'Fail', params: {} },
        right: { id: 'right', type: 'Slow', params: {} },
        root: { id: 'root', type: 'Join', params: {} },
      },
      edges: [
        { from: { node: 'left', socket: 'out' }, to: { node: 'root', socket: 'left' } },
        { from: { node: 'right', socket: 'out' }, to: { node: 'root', socket: 'right' } },
      ],
    };
    await expect(new Evaluator(registry).evaluate(graph, 'root', ctx))
      .rejects.toThrow('left failed');
    expect(slowCook).not.toHaveBeenCalled();
  });

  it('does not preserve successful upstream cache from a failed attempt', async () => {
    const release = vi.fn();
    let sourceCalls = 0;
    const registry: Registry = new Map([
      ['Source', {
        type: 'Source',
        inputs: [],
        outputs: [{ name: 'out', type: 'raster' }],
        params: [],
        cook: () => {
          sourceCalls++;
          return { out: raster({} as PooledTexture) };
        },
      }],
      ['Fail', {
        type: 'Fail',
        inputs: [{ name: 'in', type: 'raster' }],
        outputs: [{ name: 'out', type: 'raster' }],
        params: [],
        cook: () => {
          throw new Error('downstream failed');
        },
      }],
    ]);
    const graph: Graph = {
      nodes: {
        source: { id: 'source', type: 'Source', params: {} },
        fail: { id: 'fail', type: 'Fail', params: {} },
      },
      edges: [{
        from: { node: 'source', socket: 'out' },
        to: { node: 'fail', socket: 'in' },
      }],
    };
    const evaluator = new Evaluator(registry);
    await expect(evaluator.evaluate(
      graph,
      'fail',
      gpuContext(release),
    )).rejects.toThrow('downstream failed');
    await expect(evaluator.evaluate(
      graph,
      'fail',
      gpuContext(release),
    )).rejects.toThrow('downstream failed');
    expect(sourceCalls).toBe(2);
    expect(release).toHaveBeenCalledTimes(2);
  });
});
