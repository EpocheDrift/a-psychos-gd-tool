import { describe, expect, it, vi } from 'vitest';
import type { Doc } from '../engine/graph';
import { NodeCookError, type Evaluator } from '../engine/evaluator';
import type { GpuContext } from '../gpu/device';
import type { PooledTexture } from '../gpu/pool';
import { renderDocument } from './renderDocument';

function handle(id: string): PooledTexture {
  return {
    texture: { id } as unknown as GPUTexture,
    width: 16,
    height: 16,
    format: 'rgba8unorm',
    estimatedBytes: 1024,
  };
}

function documentWithLayer(): Doc {
  return {
    frame: { width: 16, height: 16 },
    layers: [{
      id: 'layer_1',
      name: 'Layer',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      graph: {
        nodes: {
          out: {
            id: 'out',
            type: 'Output',
            params: { transparent: true, background: '#ffffff' },
          },
        },
        edges: [],
      },
    }],
  };
}

function fakeGpu(options: { failBlend?: boolean } = {}) {
  const acquired: PooledTexture[] = [];
  const release = vi.fn();
  const discard = vi.fn();
  const pool = {
    acquire: vi.fn(() => {
      const next = handle(`acquired-${acquired.length}`);
      acquired.push(next);
      return next;
    }),
    release,
    discard,
  };
  const gpu = {
    pool,
    clear: vi.fn(),
    runPass: vi.fn(() => {
      if (options.failBlend) throw new Error('blend failed');
    }),
  } as unknown as GpuContext;
  return { gpu, pool, acquired, release, discard };
}

function evaluatorReturning(texture: PooledTexture): Evaluator & {
  preparedCommit: ReturnType<typeof vi.fn>;
  preparedRollback: ReturnType<typeof vi.fn>;
} {
  const preparedCommit = vi.fn();
  const preparedRollback = vi.fn();
  return {
    events: [{
      nodeId: 'out',
      type: 'Output',
      status: 'miss',
      ms: 2,
    }],
    prepare: vi.fn(async () => ({
      result: {
        hash: 'hash',
        outputs: {
          out: {
            kind: 'raster',
            texture,
            width: 16,
            height: 16,
          },
        },
      },
      events: [],
      commit: preparedCommit,
      rollback: preparedRollback,
    })),
    dispose: vi.fn(),
    preparedCommit,
    preparedRollback,
  } as unknown as Evaluator & {
    preparedCommit: ReturnType<typeof vi.fn>;
    preparedRollback: ReturnType<typeof vi.fn>;
  };
}

describe('renderDocument', () => {
  it('disposes deleted layer evaluators and stamps every cook event', async () => {
    const { gpu } = fakeGpu();
    const source = handle('source');
    const current = evaluatorReturning(source);
    const deleted = evaluatorReturning(source);
    const evaluators = new Map<string, Evaluator>([
      ['layer_1', current],
      ['deleted', deleted],
    ]);
    const rendered = await renderDocument(
      { document: documentWithLayer(), fonts: new Map() },
      {
        ticket: { revision: 7, attempt: 2 },
        gpu,
        evaluators,
      },
    );
    expect(deleted.dispose).toHaveBeenCalledOnce();
    expect(evaluators.has('deleted')).toBe(false);
    expect(rendered.events).toEqual([{
      revision: 7,
      attempt: 2,
      layerId: 'layer_1',
      nodeId: 'out',
      type: 'Output',
      status: 'miss',
      ms: 2,
    }]);
    expect(current.preparedCommit).not.toHaveBeenCalled();
    rendered.commit();
    expect(current.preparedCommit).toHaveBeenCalledOnce();
    rendered.rollback();
    expect(current.preparedRollback).not.toHaveBeenCalled();
  });

  it('preserves originating node and layer attribution', async () => {
    const { gpu } = fakeGpu();
    const failed = {
      events: [],
      prepare: vi.fn(async () => {
        throw new NodeCookError(
          'trace_1',
          'Trace',
          Object.assign(new Error('worker failed'), {
            code: 'RENDER_FAILED',
            recoverable: true,
          }),
        );
      }),
      dispose: vi.fn(),
    } as unknown as Evaluator;
    await expect(renderDocument(
      { document: documentWithLayer(), fonts: new Map() },
      {
        ticket: { revision: 9, attempt: 1 },
        gpu,
        evaluators: new Map([['layer_1', failed]]),
      },
    )).rejects.toMatchObject({
      code: 'RENDER_FAILED',
      revision: 9,
      attempt: 1,
      layerId: 'layer_1',
      nodeId: 'trace_1',
      nodeType: 'Trace',
      message: 'worker failed',
    });
  });

  it('discards an uncommitted blend target and releases the accumulator', async () => {
    const { gpu, acquired, release, discard } = fakeGpu({ failBlend: true });
    const evaluator = evaluatorReturning(handle('source'));
    await expect(renderDocument(
      { document: documentWithLayer(), fonts: new Map() },
      {
        ticket: { revision: 1, attempt: 1 },
        gpu,
        evaluators: new Map([
          ['layer_1', evaluator],
        ]),
      },
    )).rejects.toMatchObject({
      layerId: 'layer_1',
      phase: 'blend',
    });
    expect(discard).toHaveBeenCalledWith(acquired[1]);
    expect(release).toHaveBeenCalledWith(acquired[0]);
    expect(evaluator.preparedRollback).toHaveBeenCalledOnce();
    expect(evaluator.preparedCommit).not.toHaveBeenCalled();
  });
});
