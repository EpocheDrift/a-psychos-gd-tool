import { describe, expect, it, vi } from 'vitest';
import type { Edge, NodeInstance } from '../engine/graph';
import {
  createSerializedProject,
  type SerializedProject,
} from './documentSchema';
import { validateSerializedProject } from './semanticValidation';

const ONE_PIXEL_SHA =
  '431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460';
const ONE_PIXEL_ASSET_ID = `asset_${ONE_PIXEL_SHA}`;

function onePixelAsset() {
  return {
    id: ONE_PIXEL_ASSET_ID,
    sha256: ONE_PIXEL_SHA,
    mimeType: 'image/png' as const,
    byteLength: 68,
    width: 1,
    height: 1,
    source: 'upload' as const,
  };
}

function projectWith(
  nodes: Record<string, NodeInstance>,
  edges: Edge[] = [],
): SerializedProject {
  return createSerializedProject('document_1', {
    frame: { width: 320, height: 240 },
    layers: [{
      id: 'layer_1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      graph: { nodes, edges },
    }],
  });
}

function output(id = 'out'): NodeInstance {
  return { id, type: 'Output', params: { transparent: true } };
}

function expectFinding(
  project: SerializedProject,
  code: string,
  path: string,
  mode: 'editable' | 'renderable' = 'renderable',
): void {
  const report = validateSerializedProject(project, { mode });
  expect(report.valid).toBe(false);
  expect(report.errors).toContainEqual(expect.objectContaining({ code, path }));
}

describe('semantic project validation', () => {
  it('accepts a valid typed chain and a transparent Output-only layer', () => {
    const project = projectWith({
      shape: { id: 'shape', type: 'Shape', params: { kind: 'ellipse', sides: 6 } },
      raster: { id: 'raster', type: 'Rasterize', params: {} },
      out: output(),
    }, [
      { from: { node: 'shape', socket: 'out' }, to: { node: 'raster', socket: 'vector' } },
      { from: { node: 'raster', socket: 'out' }, to: { node: 'out', socket: 'in' } },
    ]);
    expect(validateSerializedProject(project)).toMatchObject({ valid: true, errors: [] });
    expect(validateSerializedProject(projectWith({ out: output() }))).toMatchObject({
      valid: true,
      errors: [],
    });
  });

  it('reports unknown nodes and params with stable paths', () => {
    const project = projectWith({
      mystery: { id: 'mystery', type: 'NotInstalled', params: {} },
      out: { ...output(), params: { transparent: true, surprise: 1 } },
    });
    const report = validateSerializedProject(project);
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'UNKNOWN_NODE_TYPE',
        path: '/document/layers/0/graph/nodes/mystery/type',
      }),
      expect.objectContaining({
        code: 'UNKNOWN_PARAM',
        path: '/document/layers/0/graph/nodes/out/params/surprise',
      }),
    ]));
  });

  it('continues safe semantic checks when a sibling structural field is invalid', () => {
    const project = projectWith({
      out: { ...output(), params: { transparent: true, surprise: 1 } },
    }, [{
      from: { node: 'missing', socket: 'out' },
      to: { node: 'out', socket: 'in' },
    }]);
    (project.document.layers[0] as unknown as Record<string, unknown>).extra = true;
    const report = validateSerializedProject(project);
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        path: '/document/layers/0/extra',
      }),
      expect.objectContaining({
        code: 'UNKNOWN_PARAM',
        path: '/document/layers/0/graph/nodes/out/params/surprise',
      }),
      expect.objectContaining({
        code: 'UNKNOWN_NODE',
        path: '/document/layers/0/graph/edges/0/from/node',
      }),
    ]));
  });

  it('keeps safe node and edge findings when a sibling node is malformed', () => {
    const project = projectWith({
      broken: {
        id: 'broken',
        type: 'Shape',
        params: null,
      } as unknown as NodeInstance,
      out: { ...output(), params: { transparent: true, surprise: 1 } },
    }, [{
      from: { node: 'missing', socket: 'out' },
      to: { node: 'out', socket: 'in' },
    }]);
    const report = validateSerializedProject(project);
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        path: '/document/layers/0/graph/nodes/broken/params',
      }),
      expect.objectContaining({
        code: 'UNKNOWN_PARAM',
        path: '/document/layers/0/graph/nodes/out/params/surprise',
      }),
      expect.objectContaining({
        code: 'UNKNOWN_NODE',
        path: '/document/layers/0/graph/edges/0/from/node',
      }),
    ]));
  });

  it('does not call a present-but-malformed node missing', () => {
    const project = projectWith({
      bad: {
        id: 'bad',
        type: 'Noise',
        params: null,
      } as unknown as NodeInstance,
      out: output(),
    }, [{
      from: { node: 'bad', socket: 'out' },
      to: { node: 'out', socket: 'in' },
    }]);
    const report = validateSerializedProject(project);
    expect(report.errors).toContainEqual(expect.objectContaining({
      code: 'INVALID_ARGUMENT',
      path: '/document/layers/0/graph/nodes/bad/params',
    }));
    expect(report.errors).not.toContainEqual(expect.objectContaining({
      code: 'UNKNOWN_NODE',
      path: '/document/layers/0/graph/edges/0/from/node',
    }));
  });

  it('reports a safe unknown type even when that node params field is malformed', () => {
    const project = projectWith({
      mystery: {
        id: 'mystery',
        type: 'NotInstalled',
        params: null,
      } as unknown as NodeInstance,
      out: output(),
    });
    const report = validateSerializedProject(project);
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        path: '/document/layers/0/graph/nodes/mystery/params',
      }),
      expect.objectContaining({
        code: 'UNKNOWN_NODE_TYPE',
        path: '/document/layers/0/graph/nodes/mystery/type',
      }),
    ]));
  });

  it('keeps safe node findings when a sibling edge is malformed', () => {
    const project = projectWith({
      out: { ...output(), params: { transparent: true, surprise: 1 } },
    });
    project.document.layers[0].graph.edges.push(null as unknown as Edge);
    const report = validateSerializedProject(project);
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        path: '/document/layers/0/graph/edges/0',
      }),
      expect.objectContaining({
        code: 'UNKNOWN_PARAM',
        path: '/document/layers/0/graph/nodes/out/params/surprise',
      }),
    ]));
  });

  it('keeps safe sibling findings beside a non-finite parameter', () => {
    const project = projectWith({
      out: {
        ...output(),
        params: {
          transparent: true,
          bad: Number.POSITIVE_INFINITY,
          surprise: 1,
        },
      },
    });
    const report = validateSerializedProject(project);
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        path: '/document/layers/0/graph/nodes/out/params/bad',
      }),
      expect.objectContaining({
        code: 'UNKNOWN_PARAM',
        path: '/document/layers/0/graph/nodes/out/params/surprise',
      }),
    ]));
  });

  it('validates parameter primitive kind, integer/range, enum, color, expression, and binds', () => {
    const project = projectWith({
      shape: {
        id: 'shape',
        type: 'Shape',
        params: { sides: 3.5, fill: '#fff' },
      },
      weight: {
        id: 'weight',
        type: 'Weight',
        params: { source: 'image', expr: 'process.exit()' },
      },
      place: {
        id: 'place',
        type: 'Place',
        params: {
          binds: '[{"channel":"weight","target":"blur","amount":99,"extra":true}]',
        },
      },
      out: output(),
    });
    const report = validateSerializedProject(project);
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        path: '/document/layers/0/graph/nodes/shape/params/sides',
      }),
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        path: '/document/layers/0/graph/nodes/shape/params/fill',
      }),
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        path: '/document/layers/0/graph/nodes/weight/params/source',
      }),
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        path: '/document/layers/0/graph/nodes/weight/params/expr',
      }),
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        path: '/document/layers/0/graph/nodes/place/params/binds',
        details: expect.objectContaining({ decodedPath: '/0/extra' }),
      }),
    ]));
  });

  it('rejects unsafe Image asset references without network or decoder work', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const project = projectWith({
      image: { id: 'image', type: 'Image', params: { assetId: 'https://tracker.invalid/pixel.png' } },
      out: output(),
    });
    expectFinding(
      project,
      'ASSET_POLICY_VIOLATION',
      '/document/layers/0/graph/nodes/image/params/assetId',
    );
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('accepts a content-addressed image and enforces asset byte budgets', () => {
    const project = projectWith({
      image: { id: 'image', type: 'Image', params: { assetId: ONE_PIXEL_ASSET_ID } },
      out: output(),
    });
    project.assets = [onePixelAsset()];
    expect(validateSerializedProject(project).valid).toBe(true);
    const report = validateSerializedProject(project, {
      limits: {
        maxLegacyAssetBytes: 1,
        maxAssetChunkBytes: 1,
        maxAssetChunks: 1,
      },
    });
    expect(report.errors).toContainEqual(expect.objectContaining({
      code: 'RESOURCE_LIMIT',
      path: '/assets/0/byteLength',
    }));
  });

  it('reports dangling endpoints before socket/type cascades', () => {
    const project = projectWith({ out: output() }, [{
      from: { node: 'missing_from', socket: 'out' },
      to: { node: 'missing_to', socket: 'in' },
    }]);
    const report = validateSerializedProject(project, { mode: 'editable' });
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'UNKNOWN_NODE',
        path: '/document/layers/0/graph/edges/0/from/node',
      }),
      expect.objectContaining({
        code: 'UNKNOWN_NODE',
        path: '/document/layers/0/graph/edges/0/to/node',
      }),
    ]));
    expect(report.errors.some((error) => error.code === 'UNKNOWN_SOCKET')).toBe(false);
    expect(report.errors.some((error) => error.code === 'TYPE_MISMATCH')).toBe(false);
  });

  it('reports bad sockets and type mismatches independently', () => {
    const badSocket = projectWith({
      noise: { id: 'noise', type: 'Noise', params: {} },
      out: output(),
    }, [{
      from: { node: 'noise', socket: 'missing' },
      to: { node: 'out', socket: 'in' },
    }]);
    expectFinding(badSocket, 'UNKNOWN_SOCKET', '/document/layers/0/graph/edges/0/from/socket', 'editable');

    const mismatch = projectWith({
      shape: { id: 'shape', type: 'Shape', params: {} },
      out: output(),
    }, [{
      from: { node: 'shape', socket: 'out' },
      to: { node: 'out', socket: 'in' },
    }]);
    expectFinding(mismatch, 'TYPE_MISMATCH', '/document/layers/0/graph/edges/0', 'editable');
  });

  it('rejects a second incoming edge and detects cycles, including self loops', () => {
    const duplicateInput = projectWith({
      a: { id: 'a', type: 'Noise', params: {} },
      b: { id: 'b', type: 'Noise', params: {} },
      out: output(),
    }, [
      { from: { node: 'a', socket: 'out' }, to: { node: 'out', socket: 'in' } },
      { from: { node: 'b', socket: 'out' }, to: { node: 'out', socket: 'in' } },
    ]);
    expectFinding(
      duplicateInput,
      'INPUT_ALREADY_CONNECTED',
      '/document/layers/0/graph/edges/1/to',
      'editable',
    );

    const cycle = projectWith({
      warp: { id: 'warp', type: 'Warp', params: {} },
      out: output(),
    }, [{
      from: { node: 'warp', socket: 'out' },
      to: { node: 'warp', socket: 'in' },
    }]);
    expectFinding(cycle, 'CYCLE_DETECTED', '/document/layers/0/graph/edges', 'editable');
  });

  it('requires exactly one Output and never chooses object enumeration order', () => {
    const missing = projectWith({
      shape: { id: 'shape', type: 'Shape', params: {} },
    });
    expectFinding(missing, 'OUTPUT_MISSING', '/document/layers/0/graph/nodes');

    const ambiguous = projectWith({
      z_output: output('z_output'),
      a_output: output('a_output'),
    });
    const report = validateSerializedProject(ambiguous);
    expect(report.errors).toContainEqual(expect.objectContaining({
      code: 'OUTPUT_AMBIGUOUS',
      path: '/document/layers/0/graph/nodes',
      details: { outputNodeIds: ['a_output', 'z_output'] },
    }));
  });

  it('checks required inputs only in the selected Output upstream closure', () => {
    const disconnectedDraft = projectWith({
      draft: { id: 'draft', type: 'Rasterize', params: {} },
      out: output(),
    });
    expect(validateSerializedProject(disconnectedDraft).valid).toBe(true);

    const reachableMissing = projectWith({
      raster: { id: 'raster', type: 'Rasterize', params: {} },
      out: output(),
    }, [{
      from: { node: 'raster', socket: 'out' },
      to: { node: 'out', socket: 'in' },
    }]);
    expectFinding(
      reachableMissing,
      'REQUIRED_INPUT_MISSING',
      '/document/layers/0/graph/nodes/raster',
    );
  });

  it('uses a saturating generated-item estimate for multiplicative chains', () => {
    const project = projectWith({
      shape: { id: 'shape', type: 'Shape', params: {} },
      first: { id: 'first', type: 'Duplicator', params: { count: 1000 } },
      second: { id: 'second', type: 'Duplicator', params: { count: 1000 } },
      out: output(),
    }, [
      { from: { node: 'shape', socket: 'out' }, to: { node: 'first', socket: 'in' } },
      { from: { node: 'first', socket: 'out' }, to: { node: 'second', socket: 'in' } },
    ]);
    const report = validateSerializedProject(project, {
      mode: 'editable',
      limits: { maxGeneratedItems: 10_000 },
    });
    expect(report.errors).toContainEqual(expect.objectContaining({
      code: 'RESOURCE_LIMIT',
      path: '/document/layers',
      details: expect.objectContaining({ maximum: 10_000 }),
    }));
  });

  it('aggregates generated-item and asset budgets across the whole document', () => {
    const graph = projectWith({
      shape: { id: 'shape', type: 'Shape', params: {} },
      first: { id: 'first', type: 'Duplicator', params: { count: 300 } },
      second: { id: 'second', type: 'Duplicator', params: { count: 300 } },
      out: output(),
    }, [
      { from: { node: 'shape', socket: 'out' }, to: { node: 'first', socket: 'in' } },
      { from: { node: 'first', socket: 'out' }, to: { node: 'second', socket: 'in' } },
    ]);
    graph.document.layers.push({
      ...structuredClone(graph.document.layers[0]),
      id: 'layer_2',
      name: 'Layer 2',
    });
    expect(validateSerializedProject(graph, {
      limits: { maxGeneratedItems: 100_000 },
    }).errors).toContainEqual(expect.objectContaining({
      code: 'RESOURCE_LIMIT',
      path: '/document/layers',
      details: expect.objectContaining({ maximum: 100_000 }),
    }));

    const assets = projectWith({
      image: { id: 'image', type: 'Image', params: { assetId: `asset_${'a'.repeat(64)}` } },
      out: output(),
    });
    assets.assets = [
      {
        id: `asset_${'a'.repeat(64)}`,
        sha256: 'a'.repeat(64),
        mimeType: 'image/png',
        byteLength: 60,
        width: 1,
        height: 1,
        source: 'upload',
      },
      {
        id: `asset_${'b'.repeat(64)}`,
        sha256: 'b'.repeat(64),
        mimeType: 'image/png',
        byteLength: 60,
        width: 1,
        height: 1,
        source: 'upload',
      },
    ];
    expect(validateSerializedProject(assets, {
      limits: {
        maxLegacyAssetBytes: 100,
        maxLegacyAssetBytesPerDocument: 100,
        maxAssetChunkBytes: 100,
      },
    }).errors).toContainEqual(expect.objectContaining({
      code: 'RESOURCE_LIMIT',
      path: '/document',
      details: expect.objectContaining({ maximumBytes: 100 }),
    }));
  });
});
