import type { Font } from 'opentype.js';
import {
  RENDERED_NODE_COORDINATE_SPACE,
  RENDERED_NODE_MEASUREMENT_LIMITS,
  RENDERED_NODE_MEASUREMENT_POLICY,
  RENDERED_NODE_MEASUREMENT_STAGE,
  RENDERED_NODE_MEASUREMENT_VERSION,
  RENDERED_NODE_VISIBILITY_POLICY,
  type RenderedNodeClippedSide,
  type RenderedNodeMeasurement,
  type RenderedNodeMeasurementSnapshot,
} from '../domain/renderedNodeMeasurementContract';
import type { Doc, NodeId } from '../engine/graph';
import {
  GeometryBudget,
  geometryBudgetFor,
  type GeometryBudgetControl,
} from '../engine/geometryBudget';
import {
  CookResourceLimitError,
  throwIfCookInterrupted,
} from '../engine/cookControl';
import type { CookResult } from '../engine/evaluator';
import type { Registry } from '../engine/registry';
import {
  contentPaintBounds,
  transformLocalPaintBounds,
  transformedElementBounds,
} from '../engine/spatialBounds';
import {
  IDENTITY,
  type Element,
  type Rect,
  type Value,
} from '../engine/values';
import type { RenderTicket } from '../domain/renderCoordinator';

const MAX_ABSOLUTE_BOUND = 1_000_000_000;
const BOUND_QUANTIZATION = 64;

export type RenderedLayerNodeResults = ReadonlyMap<
  string,
  ReadonlyMap<NodeId, CookResult>
>;

function finiteRect(rect: Rect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width >= 0
    && rect.height >= 0
    && Math.abs(rect.x) <= MAX_ABSOLUTE_BOUND
    && Math.abs(rect.y) <= MAX_ABSOLUTE_BOUND
    && rect.width <= MAX_ABSOLUTE_BOUND
    && rect.height <= MAX_ABSOLUTE_BOUND
    && Math.abs(rect.x + rect.width) <= MAX_ABSOLUTE_BOUND
    && Math.abs(rect.y + rect.height) <= MAX_ABSOLUTE_BOUND;
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function quantize(value: number): number {
  const rounded = Math.round(value * BOUND_QUANTIZATION)
    / BOUND_QUANTIZATION;
  return normalizeZero(rounded);
}

function quantizedOutwardRect(rect: Rect): Rect {
  const left = normalizeZero(
    Math.floor(rect.x * BOUND_QUANTIZATION) / BOUND_QUANTIZATION,
  );
  const top = normalizeZero(
    Math.floor(rect.y * BOUND_QUANTIZATION) / BOUND_QUANTIZATION,
  );
  const right = normalizeZero(
    Math.ceil((rect.x + rect.width) * BOUND_QUANTIZATION)
      / BOUND_QUANTIZATION,
  );
  const bottom = normalizeZero(
    Math.ceil((rect.y + rect.height) * BOUND_QUANTIZATION)
      / BOUND_QUANTIZATION,
  );
  return {
    x: left,
    y: top,
    width: normalizeZero(right - left),
    height: normalizeZero(bottom - top),
  };
}

function frameRect(
  centered: Rect,
  frame: { width: number; height: number },
): Rect {
  return {
    x: centered.x + frame.width / 2,
    y: centered.y + frame.height / 2,
    width: centered.width,
    height: centered.height,
  };
}

function clippingFor(
  unclipped: Rect,
  frame: { width: number; height: number },
) {
  const right = unclipped.x + unclipped.width;
  const bottom = unclipped.y + unclipped.height;
  const overflowPx = {
    left: Math.max(0, -unclipped.x),
    top: Math.max(0, -unclipped.y),
    right: Math.max(0, right - frame.width),
    bottom: Math.max(0, bottom - frame.height),
  };
  const sides: RenderedNodeClippedSide[] = [];
  if (overflowPx.left > 0) sides.push('left');
  if (overflowPx.top > 0) sides.push('top');
  if (overflowPx.right > 0) sides.push('right');
  if (overflowPx.bottom > 0) sides.push('bottom');
  const visibleLeft = Math.max(0, unclipped.x);
  const visibleTop = Math.max(0, unclipped.y);
  const visibleRight = Math.min(frame.width, right);
  const visibleBottom = Math.min(frame.height, bottom);
  const visibleBounds = visibleRight > visibleLeft
    && visibleBottom > visibleTop
    ? quantizedOutwardRect({
        x: visibleLeft,
        y: visibleTop,
        width: visibleRight - visibleLeft,
        height: visibleBottom - visibleTop,
      })
    : null;
  return {
    state: sides.length === 0
      ? 'inside' as const
      : visibleBounds
        ? 'partial' as const
        : 'outside' as const,
    sides,
    overflowPx: {
      left: quantize(overflowPx.left),
      top: quantize(overflowPx.top),
      right: quantize(overflowPx.right),
      bottom: quantize(overflowPx.bottom),
    },
    visibleBounds,
  };
}

function measuredBounds(
  value: Value,
  fonts: ReadonlyMap<string, Font>,
  frame: { width: number; height: number },
  control: GeometryBudgetControl,
): { bounds: Rect | null; rasterBacked: boolean } | null {
  if (value.kind === 'raster' || value.kind === 'alpha') return null;
  if (value.kind === 'layout') return { bounds: null, rasterBacked: false };
  if (value.kind === 'text' || value.kind === 'vector') {
    const bounds = transformedElementBounds({
      content: value,
      transform: IDENTITY,
      index: 0,
      progress: 0,
      weight: 1,
    }, fonts, control);
    return {
      bounds: bounds ? frameRect(bounds, frame) : null,
      rasterBacked: false,
    };
  }

  const budget = geometryBudgetFor(control);
  budget.assertGeneratedItems(value.items.length);
  for (const item of value.items) {
    budget.chargeWork();
    if (item.content.kind === 'raster') {
      return { bounds: null, rasterBacked: true };
    }
  }
  const contentCache = new Map<
    Element['content'],
    ReturnType<typeof contentPaintBounds>
  >();
  let bounds: Rect | null = null;
  for (const item of value.items) {
    budget.chargeWork();
    let local = contentCache.get(item.content);
    if (local === undefined) {
      local = contentPaintBounds(item.content, fonts, control);
      contentCache.set(item.content, local);
    }
    if (!local) continue;
    const transformed = transformLocalPaintBounds(item, local);
    if (!bounds) {
      bounds = transformed;
      continue;
    }
    const left = Math.min(bounds.x, transformed.x);
    const top = Math.min(bounds.y, transformed.y);
    const right = Math.max(
      bounds.x + bounds.width,
      transformed.x + transformed.width,
    );
    const bottom = Math.max(
      bounds.y + bounds.height,
      transformed.y + transformed.height,
    );
    bounds = {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  }
  return {
    bounds: bounds ? frameRect(bounds, frame) : null,
    rasterBacked: false,
  };
}

function unavailableMeasurement(
  base: Pick<
    RenderedNodeMeasurement,
    'target' | 'nodeType' | 'valueKind'
  >,
  reason:
    | 'raster-clipping-already-baked'
    | 'raster-backed-elements'
    | 'bounds-limit-exceeded'
    | 'unsupported-value-kind',
): RenderedNodeMeasurement {
  return { ...base, status: 'unavailable', reason };
}

export function buildRenderedNodeMeasurementSnapshot(input: {
  document: Doc;
  ticket: RenderTicket;
  nodeResults: RenderedLayerNodeResults;
  fonts: ReadonlyMap<string, Font>;
  registry: Registry;
  control?: GeometryBudgetControl;
}): RenderedNodeMeasurementSnapshot {
  const boundedLimit = (
    name: keyof typeof RENDERED_NODE_MEASUREMENT_LIMITS,
  ): number => Math.min(
    RENDERED_NODE_MEASUREMENT_LIMITS[name],
    input.control?.[name] ?? Number.MAX_SAFE_INTEGER,
  );
  const measurementControl: GeometryBudgetControl = {
    ...input.control,
    maxVectorPaths: boundedLimit('maxVectorPaths'),
    maxVectorCommands: boundedLimit('maxVectorCommands'),
    maxCanvasPaintPaths: boundedLimit('maxCanvasPaintPaths'),
    maxCanvasPaintCommands: boundedLimit('maxCanvasPaintCommands'),
    maxFlattenedPoints: boundedLimit('maxFlattenedPoints'),
    maxBooleanPoints: boundedLimit('maxBooleanPoints'),
    maxGeometryWorkUnits: boundedLimit('maxGeometryWorkUnits'),
    maxRenderableGlyphs: boundedLimit('maxRenderableGlyphs'),
    maxGeneratedItems: boundedLimit('maxGeneratedItems'),
  };
  // Measurements are optional diagnostics. They receive a separate, smaller,
  // advertised budget so resource exhaustion degrades to `unavailable`
  // without consuming another full render-attempt allowance.
  measurementControl.geometryBudget = new GeometryBudget(measurementControl);
  const measurementBudget = measurementControl.geometryBudget;
  const measurements: RenderedNodeMeasurement[] = [];

  for (const layer of input.document.layers) {
    measurementBudget.checkInterrupt();
    const results = input.nodeResults.get(layer.id);
    for (const nodeId of Object.keys(layer.graph.nodes).sort()) {
      measurementBudget.checkInterrupt();
      const node = layer.graph.nodes[nodeId]!;
      const definition = input.registry.get(node.type);
      if (!definition) continue;
      const resolved = results?.get(nodeId);
      for (const output of definition.outputs) {
        const declaredKind = Array.isArray(output.type)
          ? output.type[0]!
          : output.type;
        const target = {
          layerId: layer.id,
          nodeId,
          outputSocket: output.name,
        };
        const value = resolved?.outputs[output.name];
        const valueKind = value?.kind ?? declaredKind;
        const base = { target, nodeType: node.type, valueKind };
        if (!layer.visible) {
          measurements.push({
            ...base,
            status: 'not-rendered',
            reason: 'hidden-layer',
          });
          continue;
        }
        if (!value) {
          measurements.push({
            ...base,
            status: 'not-rendered',
            reason: 'disconnected-from-output',
          });
          continue;
        }
        if (value.kind === 'layout') {
          measurements.push({
            ...base,
            status: 'not-visual',
            reason: 'layout-output',
          });
          continue;
        }
        if (value.kind === 'alpha') {
          measurements.push({
            ...base,
            status: 'not-visual',
            reason: 'alpha-output',
          });
          continue;
        }
        if (value.kind === 'raster') {
          measurements.push(unavailableMeasurement(
            base,
            'raster-clipping-already-baked',
          ));
          continue;
        }
        try {
          const measured = measuredBounds(
            value,
            input.fonts,
            input.document.frame,
            measurementControl,
          );
          if (!measured) {
            measurements.push(unavailableMeasurement(
              base,
              'unsupported-value-kind',
            ));
            continue;
          }
          if (measured.rasterBacked) {
            measurements.push(unavailableMeasurement(
              base,
              'raster-backed-elements',
            ));
            continue;
          }
          if (
            !measured.bounds
            || measured.bounds.width <= 0
            || measured.bounds.height <= 0
          ) {
            measurements.push({
              ...base,
              status: 'empty',
              reason: 'no-painted-geometry',
            });
            continue;
          }
          if (!finiteRect(measured.bounds)) {
            measurements.push(unavailableMeasurement(
              base,
              'bounds-limit-exceeded',
            ));
            continue;
          }
          const unclippedBounds = quantizedOutwardRect(measured.bounds);
          if (!finiteRect(unclippedBounds)) {
            measurements.push(unavailableMeasurement(
              base,
              'bounds-limit-exceeded',
            ));
            continue;
          }
          const clipping = clippingFor(
            unclippedBounds,
            input.document.frame,
          );
          measurements.push({
            ...base,
            status: 'measured',
            basis: 'conservative-painted-geometry-aabb-v1',
            unclippedBounds,
            visibleBounds: clipping.visibleBounds,
            clipping: {
              state: clipping.state,
              sides: clipping.sides,
              overflowPx: clipping.overflowPx,
            },
          });
        } catch (error) {
          throwIfCookInterrupted(measurementControl);
          if (!(error instanceof CookResourceLimitError)) throw error;
          measurements.push(unavailableMeasurement(
            base,
            'bounds-limit-exceeded',
          ));
        }
      }
    }
  }

  return {
    contractVersion: RENDERED_NODE_MEASUREMENT_VERSION,
    measurementPolicy: RENDERED_NODE_MEASUREMENT_POLICY,
    measurementStage: RENDERED_NODE_MEASUREMENT_STAGE,
    visibilityPolicy: RENDERED_NODE_VISIBILITY_POLICY,
    revision: input.ticket.revision,
    attempt: input.ticket.attempt,
    frame: { ...input.document.frame },
    coordinateSpace: {
      kind: RENDERED_NODE_COORDINATE_SPACE,
      units: 'px',
      xAxis: 'right',
      yAxis: 'down',
    },
    measurements,
  };
}
