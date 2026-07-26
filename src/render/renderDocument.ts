import { DEFAULT_AGENT_LIMITS, type AgentLimits } from '../domain/limits';
import type {
  CookEventSummary,
  RenderTicket,
} from '../domain/renderCoordinator';
import { findOutputNodeIds } from '../domain/semanticValidation';
import type { Doc, Graph } from '../engine/graph';
import {
  Evaluator,
  NodeCookError,
  type CookEvent,
  type PreparedEvaluation,
} from '../engine/evaluator';
import {
  throwIfCookInterrupted,
  type CookControl,
} from '../engine/cookControl';
import {
  GeometryBudget,
  type GeometryBudgetControl,
} from '../engine/geometryBudget';
import {
  GpuWorkBudget,
  type GpuWorkBudgetControl,
} from '../engine/gpuWorkBudget';
import type { CookContext } from '../engine/registry';
import type { RasterValue } from '../engine/values';
import { BLEND_MODES } from '../engine/graph';
import type { GpuContext } from '../gpu/device';
import type { PooledTexture } from '../gpu/pool';
import { registry } from '../nodes';
import type { Font } from 'opentype.js';

export interface RenderDocumentInput {
  document: Doc;
  fonts: ReadonlyMap<string, Font>;
  environmentRevision?: number;
}

export interface RenderDocumentRuntime extends CookControl {
  ticket: RenderTicket;
  gpu: GpuContext;
  evaluators: Map<string, Evaluator>;
  limits?: Readonly<AgentLimits>;
  /** Primarily for deterministic tests; normal renders create one per attempt. */
  geometryBudget?: GeometryBudget;
  /** Primarily for deterministic tests; normal renders create one per attempt. */
  gpuWorkBudget?: GpuWorkBudget;
}

export interface RenderedDocument {
  texture: PooledTexture;
  width: number;
  height: number;
  events: CookEventSummary[];
  commit(): void;
  rollback(): void;
}

function outputNodeId(graph: Graph): string {
  const outputIds = findOutputNodeIds(graph);
  if (outputIds.length === 0) {
    const error = new Error('Layer has no Output node.');
    Object.assign(error, { code: 'OUTPUT_MISSING', recoverable: true });
    throw error;
  }
  if (outputIds.length > 1) {
    const error = new Error(
      `Layer has multiple Output nodes (${outputIds.join(', ')}).`,
    );
    Object.assign(error, { code: 'OUTPUT_AMBIGUOUS', recoverable: true });
    throw error;
  }
  return outputIds[0];
}

export class LayerRenderError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly nodeId?: string;
  readonly nodeType?: string;
  readonly phase: string;
  readonly details?: Record<string, unknown>;

  constructor(
    readonly revision: number,
    readonly attempt: number,
    readonly layerId: string,
    cause: unknown,
    phase = 'cook',
  ) {
    const candidate = cause !== null && typeof cause === 'object'
      ? cause as {
          code?: unknown;
          message?: unknown;
          recoverable?: unknown;
          nodeId?: unknown;
          nodeType?: unknown;
          phase?: unknown;
          details?: unknown;
        }
      : {};
    super(
      typeof candidate.message === 'string'
        ? candidate.message
        : `Layer ${layerId} failed to render.`,
    );
    this.name = 'LayerRenderError';
    this.code = typeof candidate.code === 'string'
      ? candidate.code
      : 'RENDER_FAILED';
    this.recoverable = typeof candidate.recoverable === 'boolean'
      ? candidate.recoverable
      : true;
    this.phase = typeof candidate.phase === 'string'
      ? candidate.phase
      : phase;
    if (cause instanceof NodeCookError) {
      this.nodeId = cause.nodeId;
      this.nodeType = cause.nodeType;
    } else {
      if (typeof candidate.nodeId === 'string') this.nodeId = candidate.nodeId;
      if (typeof candidate.nodeType === 'string') {
        this.nodeType = candidate.nodeType;
      }
    }
    if (
      candidate.details !== null
      && typeof candidate.details === 'object'
      && !Array.isArray(candidate.details)
    ) {
      this.details = candidate.details as Record<string, unknown>;
    }
  }
}

function summarizeEvents(
  events: readonly CookEvent[],
  ticket: RenderTicket,
  layerId: string,
): CookEventSummary[] {
  return events.map((event) => ({
    revision: ticket.revision,
    attempt: ticket.attempt,
    layerId,
    nodeId: event.nodeId,
    type: event.type,
    status: event.status,
    ms: event.ms,
  }));
}

function contextForLayer(
  input: RenderDocumentInput,
  runtime: RenderDocumentRuntime,
  layerId: string,
  geometryBudget: GeometryBudget,
  gpuWorkBudget: GpuWorkBudget,
): CookContext {
  const limits = runtime.limits ?? DEFAULT_AGENT_LIMITS;
  return {
    gpu: runtime.gpu,
    fonts: new Map(input.fonts),
    frame: input.document.frame,
    revision: runtime.ticket.revision,
    layerId,
    signal: runtime.signal,
    deadline: runtime.deadline,
    environmentRevision: input.environmentRevision,
    maxPendingWorkerRequests: limits.maxPendingWorkerRequests,
    maxPendingWorkerBytes: limits.maxPendingWorkerBytes,
    maxVectorPaths: limits.maxVectorPaths,
    maxVectorCommands: limits.maxVectorCommands,
    maxCanvasPaintPaths: limits.maxCanvasPaintPaths,
    maxCanvasPaintCommands: limits.maxCanvasPaintCommands,
    maxFlattenedPoints: limits.maxFlattenedPoints,
    maxBooleanPoints: limits.maxBooleanPoints,
    maxGeometryWorkUnits: limits.maxGeometryWorkUnits,
    maxRenderableGlyphs: limits.maxRenderableGlyphs,
    maxGeneratedItems: limits.maxGeneratedItems,
    geometryBudget,
    maxGpuPasses: limits.maxGpuPasses,
    maxGpuPixelWork: limits.maxGpuPixelWork,
    gpuWorkBudget,
  };
}

/**
 * Cook each visible layer through its persistent evaluator and composite the
 * stack bottom-to-top. The caller owns the returned texture. GPU completion is
 * deliberately handled by the outer coordinator executor.
 */
export async function renderDocument(
  input: RenderDocumentInput,
  runtime: RenderDocumentRuntime,
): Promise<RenderedDocument> {
  const { document } = input;
  const { gpu, evaluators, ticket } = runtime;
  const { width, height } = document.frame;
  throwIfCookInterrupted(runtime);
  const limits = runtime.limits ?? DEFAULT_AGENT_LIMITS;
  const geometryControl: GeometryBudgetControl = {
    ...runtime,
    maxVectorPaths: limits.maxVectorPaths,
    maxVectorCommands: limits.maxVectorCommands,
    maxCanvasPaintPaths: limits.maxCanvasPaintPaths,
    maxCanvasPaintCommands: limits.maxCanvasPaintCommands,
    maxFlattenedPoints: limits.maxFlattenedPoints,
    maxBooleanPoints: limits.maxBooleanPoints,
    maxGeometryWorkUnits: limits.maxGeometryWorkUnits,
    maxRenderableGlyphs: limits.maxRenderableGlyphs,
    maxGeneratedItems: limits.maxGeneratedItems,
  };
  const geometryBudget = runtime.geometryBudget
    ?? new GeometryBudget(geometryControl);
  const gpuControl: GpuWorkBudgetControl = {
    ...runtime,
    maxGpuPasses: limits.maxGpuPasses,
    maxGpuPixelWork: limits.maxGpuPixelWork,
  };
  const gpuWorkBudget = runtime.gpuWorkBudget
    ?? new GpuWorkBudget(gpuControl);
  const attemptGpuControl: GpuWorkBudgetControl = {
    ...gpuControl,
    gpuWorkBudget,
  };

  // Coordinator serialization guarantees a deleted layer has no active
  // evaluate when its cache is disposed.
  const liveLayerIds = new Set(document.layers.map((layer) => layer.id));
  for (const [layerId, evaluator] of evaluators) {
    if (liveLayerIds.has(layerId)) continue;
    evaluator.dispose(contextForLayer(
      input,
      runtime,
      layerId,
      geometryBudget,
      gpuWorkBudget,
    ));
    evaluators.delete(layerId);
  }

  const events: CookEventSummary[] = [];
  const preparedEvaluations: PreparedEvaluation[] = [];
  let accumulator = gpu.pool.acquire(width, height);
  try {
    gpu.clear(
      accumulator,
      { r: 0, g: 0, b: 0, a: 0 },
      attemptGpuControl,
    );
    for (const layer of document.layers) {
      if (!layer.visible) continue;
      throwIfCookInterrupted(runtime);
      const context = contextForLayer(
        input,
        runtime,
        layer.id,
        geometryBudget,
        gpuWorkBudget,
      );
      let evaluator = evaluators.get(layer.id);
      if (!evaluator) {
        evaluator = new Evaluator(registry);
        evaluators.set(layer.id, evaluator);
      }

      let result;
      try {
        const prepared = await evaluator.prepare(
          layer.graph,
          outputNodeId(layer.graph),
          context,
        );
        preparedEvaluations.push(prepared);
        result = prepared.result;
      } catch (error) {
        throw new LayerRenderError(
          ticket.revision,
          ticket.attempt,
          layer.id,
          error,
        );
      }
      events.push(...summarizeEvents(evaluator.events, ticket, layer.id));
      throwIfCookInterrupted(runtime);

      const raster = result.outputs.out as RasterValue | undefined;
      if (
        !raster
        || raster.kind !== 'raster'
        || raster.width !== width
        || raster.height !== height
      ) {
        throw new LayerRenderError(
          ticket.revision,
          ticket.attempt,
          layer.id,
          Object.assign(
            new Error('Output node did not produce a frame-sized raster.'),
            { code: 'RENDER_FAILED', recoverable: true },
          ),
          'blend',
        );
      }

      let next: PooledTexture;
      try {
        next = gpu.pool.acquire(width, height);
      } catch (error) {
        throw new LayerRenderError(
          ticket.revision,
          ticket.attempt,
          layer.id,
          error,
          'blend',
        );
      }
      try {
        gpu.runPass(
          'layerblend',
          [accumulator, raster.texture],
          next,
          new Float32Array([
            Math.max(0, BLEND_MODES.indexOf(layer.blendMode)),
            layer.opacity,
            0,
            0,
          ]),
          context,
        );
      } catch (error) {
        gpu.pool.discard(next);
        throw new LayerRenderError(
          ticket.revision,
          ticket.attempt,
          layer.id,
          error,
          'blend',
        );
      }
      gpu.pool.release(accumulator);
      accumulator = next;
    }
    throwIfCookInterrupted(runtime);
    let settled = false;
    return {
      texture: accumulator,
      width,
      height,
      events,
      commit: () => {
        if (settled) return;
        settled = true;
        for (const prepared of preparedEvaluations) prepared.commit();
      },
      rollback: () => {
        if (settled) return;
        settled = true;
        for (const prepared of [...preparedEvaluations].reverse()) {
          prepared.rollback();
        }
      },
    };
  } catch (error) {
    for (const prepared of [...preparedEvaluations].reverse()) {
      prepared.rollback();
    }
    gpu.pool.release(accumulator);
    throw error;
  }
}

export function disposeEvaluators(
  evaluators: Map<string, Evaluator>,
  gpu: GpuContext,
): void {
  const context: CookContext = {
    gpu,
    fonts: new Map(),
    frame: { width: 1, height: 1 },
  };
  for (const evaluator of evaluators.values()) evaluator.dispose(context);
  evaluators.clear();
}
