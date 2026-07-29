import type { Rect, SocketType } from '../engine/values';

export const RENDERED_NODE_MEASUREMENT_VERSION =
  'rendered-node-measurement-v1' as const;
export const RENDERED_NODE_MEASUREMENT_POLICY =
  'current-exact-ticket-v1' as const;
export const RENDERED_NODE_MEASUREMENT_STAGE =
  'target-output-before-downstream-v1' as const;
export const RENDERED_NODE_VISIBILITY_POLICY =
  'frame-clip-only-no-occlusion-v1' as const;
export const RENDERED_NODE_COORDINATE_SPACE =
  'frame-pixels-top-left-v1' as const;
export const RENDERED_NODE_MEASUREMENT_WORK_POLICY =
  'bounded-fail-soft-v1' as const;
export const MAX_RENDERED_NODE_MEASUREMENT_TARGETS = 32;
export const RENDERED_NODE_MEASUREMENT_LIMITS = Object.freeze({
  maxVectorPaths: 25_000,
  maxVectorCommands: 50_000,
  maxCanvasPaintPaths: 5_000,
  maxCanvasPaintCommands: 25_000,
  maxFlattenedPoints: 250_000,
  maxBooleanPoints: 2_500,
  maxGeometryWorkUnits: 250_000,
  maxRenderableGlyphs: 4_096,
  maxGeneratedItems: 25_000,
});

export interface RenderedNodeMeasurementTarget {
  layerId: string;
  nodeId: string;
  outputSocket: string;
}

interface RenderedNodeMeasurementBase {
  target: RenderedNodeMeasurementTarget;
  nodeType: string;
  valueKind: SocketType;
}

export type RenderedNodeClippedSide =
  | 'left'
  | 'top'
  | 'right'
  | 'bottom';

export interface RenderedNodeClipping {
  state: 'inside' | 'partial' | 'outside';
  sides: RenderedNodeClippedSide[];
  overflowPx: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

export interface MeasuredRenderedNode extends RenderedNodeMeasurementBase {
  status: 'measured';
  basis: 'conservative-painted-geometry-aabb-v1';
  unclippedBounds: Rect;
  visibleBounds: Rect | null;
  clipping: RenderedNodeClipping;
}

export interface EmptyRenderedNode extends RenderedNodeMeasurementBase {
  status: 'empty';
  reason: 'no-painted-geometry';
}

export interface NotRenderedNode extends RenderedNodeMeasurementBase {
  status: 'not-rendered';
  reason: 'hidden-layer' | 'disconnected-from-output';
}

export interface NotVisualRenderedNode extends RenderedNodeMeasurementBase {
  status: 'not-visual';
  reason: 'layout-output' | 'alpha-output';
}

export interface UnavailableRenderedNode extends RenderedNodeMeasurementBase {
  status: 'unavailable';
  reason:
    | 'raster-clipping-already-baked'
    | 'raster-backed-elements'
    | 'bounds-limit-exceeded'
    | 'unsupported-value-kind';
}

export type RenderedNodeMeasurement =
  | MeasuredRenderedNode
  | EmptyRenderedNode
  | NotRenderedNode
  | NotVisualRenderedNode
  | UnavailableRenderedNode;

export interface RenderedNodeMeasurementSnapshot {
  contractVersion: typeof RENDERED_NODE_MEASUREMENT_VERSION;
  measurementPolicy: typeof RENDERED_NODE_MEASUREMENT_POLICY;
  measurementStage: typeof RENDERED_NODE_MEASUREMENT_STAGE;
  visibilityPolicy: typeof RENDERED_NODE_VISIBILITY_POLICY;
  revision: number;
  attempt: number;
  frame: { width: number; height: number };
  coordinateSpace: {
    kind: typeof RENDERED_NODE_COORDINATE_SPACE;
    units: 'px';
    xAxis: 'right';
    yAxis: 'down';
  };
  measurements: RenderedNodeMeasurement[];
}

export interface PublicRenderedNodeMeasurementRequest {
  revision: number;
  attempt: number;
  targets: Array<{
    layerId: string;
    nodeId: string;
    outputSocket?: string;
  }>;
}

export interface ResolvedRenderedNodeMeasurementRequest {
  revision: number;
  attempt: number;
  targets: RenderedNodeMeasurementTarget[];
}

export interface PublicRenderedNodeMeasurementResult
  extends RenderedNodeMeasurementSnapshot {
  trust: 'untrusted-document-render';
  requestedRevision: number;
}
