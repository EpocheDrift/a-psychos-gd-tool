import { describe, expect, it } from 'vitest';
import type { Doc, NodeInstance } from '../engine/graph';
import type { CookResult } from '../engine/evaluator';
import { CookCancelledError } from '../engine/cookControl';
import type {
  ElementsValue,
  RasterValue,
  Rect,
  Value,
  VectorValue,
} from '../engine/values';
import { buildRegistry } from '../nodes';
import {
  buildRenderedNodeMeasurementSnapshot,
  type RenderedLayerNodeResults,
} from './renderedNodeMeasurements';

function node(id: string, type: string): NodeInstance {
  return { id, type, params: {} };
}

function vector(bounds: Rect): VectorValue {
  return {
    kind: 'vector',
    paths: [],
    bounds,
  };
}

function raster(width = 100, height = 80): RasterValue {
  return {
    kind: 'raster',
    texture: {} as RasterValue['texture'],
    width,
    height,
  };
}

function result(id: string, value: Value): CookResult {
  return {
    hash: `hash-${id}`,
    outputs: { out: value },
  };
}

function measurementByNode(
  snapshot: ReturnType<typeof buildRenderedNodeMeasurementSnapshot>,
  nodeId: string,
) {
  return snapshot.measurements.find(
    (measurement) => measurement.target.nodeId === nodeId,
  );
}

describe('rendered node measurements', () => {
  it('reports exact-ticket inside, partial, outside, hidden, disconnected, and unavailable states', () => {
    const document: Doc = {
      frame: { width: 100, height: 80 },
      layers: [
        {
          id: 'visible_layer',
          name: 'Visible',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          graph: {
            nodes: {
              inside: node('inside', 'Shape'),
              partial: node('partial', 'Shape'),
              outside: node('outside', 'Shape'),
              tiny_inside: node('tiny_inside', 'Shape'),
              tiny_partial: node('tiny_partial', 'Shape'),
              disconnected: node('disconnected', 'Shape'),
              raster: node('raster', 'Image'),
            },
            edges: [],
          },
        },
        {
          id: 'hidden_layer',
          name: 'Hidden',
          visible: false,
          opacity: 1,
          blendMode: 'normal',
          graph: {
            nodes: {
              hidden: node('hidden', 'Shape'),
            },
            edges: [],
          },
        },
      ],
    };
    const nodeResults: RenderedLayerNodeResults = new Map([
      ['visible_layer', new Map([
        ['inside', result('inside', vector({
          x: -10,
          y: -5,
          width: 20,
          height: 10,
        }))],
        ['partial', result('partial', vector({
          x: 40,
          y: -10,
          width: 20,
          height: 20,
        }))],
        ['outside', result('outside', vector({
          x: 60,
          y: -10,
          width: 20,
          height: 20,
        }))],
        ['tiny_inside', result('tiny-inside', vector({
          x: 0,
          y: 0,
          width: 0.001,
          height: 0.001,
        }))],
        ['tiny_partial', result('tiny-partial', vector({
          x: 49.999,
          y: 0,
          width: 0.002,
          height: 0.002,
        }))],
        ['raster', result('raster', raster())],
      ])],
      ['hidden_layer', new Map([
        ['hidden', result('hidden', vector({
          x: -5,
          y: -5,
          width: 10,
          height: 10,
        }))],
      ])],
    ]);

    const snapshot = buildRenderedNodeMeasurementSnapshot({
      document,
      ticket: { revision: 17, attempt: 3 },
      nodeResults,
      fonts: new Map(),
      registry: buildRegistry(),
    });

    expect(snapshot).toMatchObject({
      contractVersion: 'rendered-node-measurement-v1',
      measurementPolicy: 'current-exact-ticket-v1',
      measurementStage: 'target-output-before-downstream-v1',
      visibilityPolicy: 'frame-clip-only-no-occlusion-v1',
      revision: 17,
      attempt: 3,
      frame: { width: 100, height: 80 },
      coordinateSpace: {
        kind: 'frame-pixels-top-left-v1',
        units: 'px',
        xAxis: 'right',
        yAxis: 'down',
      },
    });
    expect(measurementByNode(snapshot, 'inside')).toMatchObject({
      nodeType: 'Shape',
      valueKind: 'vector',
      status: 'measured',
      unclippedBounds: { x: 40, y: 35, width: 20, height: 10 },
      visibleBounds: { x: 40, y: 35, width: 20, height: 10 },
      clipping: {
        state: 'inside',
        sides: [],
        overflowPx: { left: 0, top: 0, right: 0, bottom: 0 },
      },
    });
    expect(measurementByNode(snapshot, 'partial')).toMatchObject({
      status: 'measured',
      unclippedBounds: { x: 90, y: 30, width: 20, height: 20 },
      visibleBounds: { x: 90, y: 30, width: 10, height: 20 },
      clipping: {
        state: 'partial',
        sides: ['right'],
        overflowPx: { left: 0, top: 0, right: 10, bottom: 0 },
      },
    });
    expect(measurementByNode(snapshot, 'outside')).toMatchObject({
      status: 'measured',
      unclippedBounds: { x: 110, y: 30, width: 20, height: 20 },
      visibleBounds: null,
      clipping: {
        state: 'outside',
        sides: ['right'],
        overflowPx: { left: 0, top: 0, right: 30, bottom: 0 },
      },
    });
    expect(measurementByNode(snapshot, 'tiny_inside')).toMatchObject({
      status: 'measured',
      unclippedBounds: {
        x: 50,
        y: 40,
        width: 1 / 64,
        height: 1 / 64,
      },
      clipping: { state: 'inside' },
    });
    expect(measurementByNode(snapshot, 'tiny_partial')).toMatchObject({
      status: 'measured',
      unclippedBounds: {
        x: 99 + 63 / 64,
        y: 40,
        width: 2 / 64,
        height: 1 / 64,
      },
      visibleBounds: {
        x: 99 + 63 / 64,
        y: 40,
        width: 1 / 64,
        height: 1 / 64,
      },
      clipping: {
        state: 'partial',
        sides: ['right'],
        overflowPx: { left: 0, top: 0, right: 1 / 64, bottom: 0 },
      },
    });
    expect(measurementByNode(snapshot, 'hidden')).toMatchObject({
      status: 'not-rendered',
      reason: 'hidden-layer',
    });
    expect(measurementByNode(snapshot, 'disconnected')).toMatchObject({
      status: 'not-rendered',
      reason: 'disconnected-from-output',
    });
    expect(measurementByNode(snapshot, 'raster')).toMatchObject({
      nodeType: 'Image',
      valueKind: 'raster',
      status: 'unavailable',
      reason: 'raster-clipping-already-baked',
    });
  });

  it('distinguishes raster-backed element and unsafe-bound unavailability', () => {
    const document: Doc = {
      frame: { width: 100, height: 80 },
      layers: [{
        id: 'layer',
        name: 'Layer',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        graph: {
          nodes: {
            raster_elements: node('raster_elements', 'Duplicator'),
            unsafe_bounds: node('unsafe_bounds', 'Shape'),
          },
          edges: [],
        },
      }],
    };
    const rasterElements: ElementsValue = {
      kind: 'elements',
      items: [{
        content: raster(20, 10),
        transform: { x: 0, y: 0, rotation: 0, scale: 1 },
        index: 0,
        progress: 0,
        weight: 1,
      }],
    };
    const nodeResults: RenderedLayerNodeResults = new Map([
      ['layer', new Map([
        ['raster_elements', result('raster-elements', rasterElements)],
        ['unsafe_bounds', result('unsafe-bounds', vector({
          x: 1_000_000_000,
          y: 0,
          width: 1,
          height: 1,
        }))],
      ])],
    ]);

    const snapshot = buildRenderedNodeMeasurementSnapshot({
      document,
      ticket: { revision: 4, attempt: 1 },
      nodeResults,
      fonts: new Map(),
      registry: buildRegistry(),
    });

    expect(measurementByNode(snapshot, 'raster_elements')).toMatchObject({
      status: 'unavailable',
      reason: 'raster-backed-elements',
    });
    expect(measurementByNode(snapshot, 'unsafe_bounds')).toMatchObject({
      status: 'unavailable',
      reason: 'bounds-limit-exceeded',
    });
  });

  it('fails soft within its bounded work policy but preserves cancellation', () => {
    const content = vector({
      x: -5,
      y: -5,
      width: 10,
      height: 10,
    });
    const oversized: ElementsValue = {
      kind: 'elements',
      items: [0, 1].map((index) => ({
        content,
        transform: { x: index * 10, y: 0, rotation: 0, scale: 1 },
        index,
        progress: index,
        weight: 1,
      })),
    };
    const document: Doc = {
      frame: { width: 100, height: 80 },
      layers: [{
        id: 'layer',
        name: 'Layer',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        graph: {
          nodes: {
            a_oversized: node('a_oversized', 'Duplicator'),
            b_small: node('b_small', 'Shape'),
          },
          edges: [],
        },
      }],
    };
    const nodeResults: RenderedLayerNodeResults = new Map([
      ['layer', new Map([
        ['a_oversized', result('oversized', oversized)],
        ['b_small', result('small', content)],
      ])],
    ]);
    const input = {
      document,
      ticket: { revision: 8, attempt: 2 },
      nodeResults,
      fonts: new Map(),
      registry: buildRegistry(),
    };
    const snapshot = buildRenderedNodeMeasurementSnapshot({
      ...input,
      control: { maxGeneratedItems: 1 },
    });

    expect(measurementByNode(snapshot, 'a_oversized')).toMatchObject({
      status: 'unavailable',
      reason: 'bounds-limit-exceeded',
    });
    expect(measurementByNode(snapshot, 'b_small')).toMatchObject({
      status: 'measured',
    });

    const controller = new AbortController();
    controller.abort(new CookCancelledError(8));
    expect(() => buildRenderedNodeMeasurementSnapshot({
      ...input,
      control: { signal: controller.signal },
    })).toThrow(CookCancelledError);

    const broken = {
      kind: 'vector',
      paths: [],
    } as unknown as VectorValue;
    Object.defineProperty(broken, 'bounds', {
      enumerable: true,
      get() {
        throw new Error('measurement-internal-error');
      },
    });
    expect(() => buildRenderedNodeMeasurementSnapshot({
      ...input,
      nodeResults: new Map([
        ['layer', new Map([
          ['a_oversized', result('broken', broken)],
        ])],
      ]),
    })).toThrow('measurement-internal-error');
  });
});
