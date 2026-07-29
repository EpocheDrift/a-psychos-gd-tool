// Pull-based DAG evaluator with hash-keyed memoization.
//
// evaluate(graph, rootId) cooks the root by recursively cooking its inputs.
// Each node's output is cached under hash(type, params, upstream hashes), so
// changing one param re-cooks only that node and its descendants — everything
// else is a HIT. Async nodes need no special casing: cook() is awaited.

import type { Edge, Graph, NodeId, ParamValue } from './graph';
import { hashNode } from './hash';
import {
  throwIfCookInterrupted,
  waitForCookControl,
} from './cookControl';
import { geometryBudgetFor } from './geometryBudget';
import type { CookContext, NodeDef, Registry } from './registry';
import type { OutputValues, Value } from './values';

/**
 * Node instances may predate params added to their def later (old documents,
 * hand-built graphs). Cook — and hash — with the def's defaults filled in,
 * so a missing param behaves exactly like one set to its default.
 */
function paramsWithDefaults(def: NodeDef, params: Record<string, ParamValue>): Record<string, ParamValue> {
  const merged: Record<string, ParamValue> = {};
  for (const spec of def.params) merged[spec.name] = spec.default;
  return { ...merged, ...params };
}

export interface CookEvent {
  nodeId: NodeId;
  type: string;
  status: 'hit' | 'miss';
  ms: number;
}

interface CacheEntry {
  nodeId: NodeId;
  hash: string;
  outputs: OutputValues;
}

export interface CookResult {
  outputs: OutputValues;
  hash: string;
}

interface EvaluationAttempt {
  entries: Map<string, CacheEntry>;
  latestHash: Map<NodeId, string>;
  events: CookEvent[];
  nodeResults: Map<NodeId, CookResult>;
}

export interface PreparedEvaluation {
  readonly result: CookResult;
  readonly events: readonly CookEvent[];
  /** Exact resolved outputs for every node reached by this evaluation. */
  readonly nodeResults: ReadonlyMap<NodeId, CookResult>;
  /**
   * Publish this attempt only after the outer GPU error scopes and presentation
   * have completed successfully.
   */
  commit(): void;
  /** Release every output created by this attempt. Idempotent. */
  rollback(): void;
}

/**
 * Defense-in-depth error for corrupt or otherwise unvalidated cyclic graphs.
 * Full-document cycle validation belongs at the document boundary, but the
 * evaluator must still fail predictably if that boundary is bypassed.
 */
export class CycleDetectedError extends Error {
  readonly code = 'CYCLE_DETECTED' as const;

  constructor(readonly cycle: readonly NodeId[]) {
    super(`cycle detected: ${cycle.join(' -> ')}`);
    this.name = 'CycleDetectedError';
  }
}

export class NodeCookError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly phase?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    readonly nodeId: NodeId,
    readonly nodeType: string,
    readonly cause: unknown,
  ) {
    const candidate = cause !== null && typeof cause === 'object'
      ? cause as {
          code?: unknown;
          message?: unknown;
          recoverable?: unknown;
          phase?: unknown;
          details?: unknown;
        }
      : {};
    super(
      typeof candidate.message === 'string'
        ? candidate.message
        : `Node ${nodeType} (${nodeId}) failed to cook.`,
    );
    this.name = 'NodeCookError';
    this.code = typeof candidate.code === 'string'
      ? candidate.code
      : 'RENDER_FAILED';
    this.recoverable = typeof candidate.recoverable === 'boolean'
      ? candidate.recoverable
      : true;
    if (typeof candidate.phase === 'string') this.phase = candidate.phase;
    if (
      candidate.details !== null
      && typeof candidate.details === 'object'
      && !Array.isArray(candidate.details)
    ) {
      this.details = candidate.details as Record<string, unknown>;
    }
  }
}

export class Evaluator {
  /** cook log for the most recent evaluate() — HIT/MISS per node, loud on purpose */
  events: CookEvent[] = [];

  private entries = new Map<string, CacheEntry>(); // hash -> cached outputs
  private latestHash = new Map<NodeId, string>(); // nodeId -> hash from last evaluate

  constructor(private registry: Registry) {}

  async evaluate(graph: Graph, rootId: NodeId, ctx: CookContext): Promise<CookResult> {
    const prepared = await this.prepare(graph, rootId, ctx);
    prepared.commit();
    return prepared.result;
  }

  async prepare(
    graph: Graph,
    rootId: NodeId,
    ctx: CookContext,
  ): Promise<PreparedEvaluation> {
    // Direct Evaluator users (tests, layout guide, future controller calls)
    // receive the same finite defaults as the application renderer. A caller
    // may provide one shared budget to account across several layer evaluators.
    const cookContext: CookContext = ctx.geometryBudget
      ? ctx
      : { ...ctx, geometryBudget: geometryBudgetFor(ctx) };
    const attempt: EvaluationAttempt = {
      entries: new Map(),
      latestHash: new Map(),
      events: [],
      nodeResults: new Map(),
    };
    this.events = attempt.events;
    // per-evaluation memo so a diamond dependency cooks each node once
    const memo = new Map<NodeId, Promise<CookResult>>();
    try {
      const result = await this.cookNode(
        graph,
        rootId,
        cookContext,
        memo,
        [],
        new Set(),
        attempt,
      );
      throwIfCookInterrupted(cookContext);
      let settled = false;
      return {
        result,
        events: attempt.events,
        nodeResults: new Map(attempt.nodeResults),
        commit: () => {
          if (settled) return;
          settled = true;
          for (const [key, entry] of attempt.entries) {
            this.entries.set(key, entry);
          }
          this.latestHash = attempt.latestHash;
          this.evictStale(cookContext);
        },
        rollback: () => {
          if (settled) return;
          settled = true;
          const released = new Set<unknown>();
          for (const entry of attempt.entries.values()) {
            disposeOutputs(entry.outputs, cookContext, released);
          }
        },
      };
    } catch (error) {
      // A failed/superseded attempt never becomes reusable cache state.
      const released = new Set<unknown>();
      for (const entry of attempt.entries.values()) {
        disposeOutputs(entry.outputs, cookContext, released);
      }
      throw error;
    }
  }

  /** Release every cached texture and forget everything — called when the
   * graph this evaluator serves (a layer) is deleted. */
  dispose(ctx: CookContext) {
    const released = new Set<unknown>();
    for (const entry of this.entries.values()) {
      disposeOutputs(entry.outputs, ctx, released);
    }
    this.entries.clear();
    this.latestHash.clear();
  }

  /** Drop cache entries superseded by a newer hash for the same node, freeing their textures. */
  private evictStale(ctx: CookContext) {
    for (const [key, entry] of this.entries) {
      if (this.latestHash.get(entry.nodeId) !== entry.hash) {
        disposeOutputs(entry.outputs, ctx);
        this.entries.delete(key);
      }
    }
  }

  private cookNode(
    graph: Graph,
    nodeId: NodeId,
    ctx: CookContext,
    memo: Map<NodeId, Promise<CookResult>>,
    path: readonly NodeId[],
    visiting: ReadonlySet<NodeId>,
    attempt: EvaluationAttempt,
  ): Promise<CookResult> {
    // This check must precede the memo lookup. Returning the current node's
    // pending promise from a recursive A -> B -> A traversal would deadlock.
    if (visiting.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      throw new CycleDetectedError([...path.slice(cycleStart), nodeId]);
    }

    const existing = memo.get(nodeId);
    if (existing) return existing;

    // Ancestry is call-local. Distinct branches may legitimately share an
    // upstream node (a diamond DAG), so recursive calls must not share a
    // mutable visiting set even though they share the per-evaluation memo.
    const nextPath = [...path, nodeId];
    const nextVisiting = new Set(visiting);
    nextVisiting.add(nodeId);

    const promise = (async (): Promise<CookResult> => {
      throwIfCookInterrupted(ctx);
      const node = graph.nodes[nodeId];
      if (!node) {
        throw new NodeCookError(nodeId, 'unknown', new Error(`unknown node: ${nodeId}`));
      }
      const def = this.registry.get(node.type);
      if (!def) {
        throw new NodeCookError(
          nodeId,
          node.type,
          new Error(`unknown node type: ${node.type}`),
        );
      }

      // 1. Cook dependencies in deterministic socket order. Serial traversal
      // intentionally bounds heavyweight browser/GPU primitives to one active
      // node cook per evaluator: a legal wide DAG must not start hundreds of
      // frame-sized canvases or readback buffers before budgets can account
      // for them. The per-evaluation memo still cooks shared diamond ancestors
      // exactly once.
      const inputEdges = graph.edges
        .filter((edge) => edge.to.node === nodeId)
        .sort((a, b) => (
          a.to.socket.localeCompare(b.to.socket)
          || a.from.node.localeCompare(b.from.node)
          || a.from.socket.localeCompare(b.from.socket)
        ));
      const upstream: Array<{ edge: Edge; result: CookResult }> = [];
      for (const edge of inputEdges) {
        throwIfCookInterrupted(ctx);
        upstream.push({
          edge,
          result: await this.cookNode(
            graph,
            edge.from.node,
            ctx,
            memo,
            nextPath,
            nextVisiting,
            attempt,
          ),
        });
      }
      throwIfCookInterrupted(ctx);

      // 2. assemble inputs; hash in deterministic socket order
      const inputs: Record<string, Value> = {};
      const inputHashes: string[] = [];
      for (const { edge, result } of upstream) {
        const value = result.outputs[edge.from.socket];
        if (value === undefined) {
          throw new NodeCookError(
            nodeId,
            node.type,
            new Error(`${edge.from.node} has no output socket "${edge.from.socket}"`),
          );
        }
        inputs[edge.to.socket] = value;
        inputHashes.push(`${edge.to.socket}:${result.hash}`);
      }

      // 2b. a half-wired graph should fail with a message, not a crash deep in a cook
      for (const spec of def.inputs) {
        if (!spec.optional && !(spec.name in inputs)) {
          throw new NodeCookError(
            nodeId,
            node.type,
            new Error(`${node.type} (${nodeId}): input "${spec.name}" is not connected`),
          );
        }
      }

      // 3. content hash → cache lookup. Frame-aware nodes hash the frame too,
      // so a frame change re-cooks exactly the nodes that read it; hashExtras
      // folds in any other ambient context the cook resolves (e.g. fonts).
      const params = paramsWithDefaults(def, node.params);
      const hashParams = {
        ...params,
        ...(def.usesFrame ? { '@frame': `${ctx.frame.width}x${ctx.frame.height}` } : undefined),
        ...def.hashExtras?.(params, ctx),
      };
      const hash = hashNode(node.type, hashParams, inputHashes);
      attempt.latestHash.set(nodeId, hash);
      const cacheKey = `${nodeId}\u0000${hash}`;
      const cached = this.entries.get(cacheKey);
      if (cached) {
        attempt.events.push({ nodeId, type: node.type, status: 'hit', ms: 0 });
        const result = { outputs: cached.outputs, hash };
        attempt.nodeResults.set(nodeId, result);
        return result;
      }

      // 4. miss: run the actual work (await covers async/model nodes too).
      // NodeDef cooks must observe ctx.signal/deadline before GPU side effects.
      // The evaluator can detach a non-cooperative promise for liveness; any
      // late raster/alpha it returns must be newly owned so it can be released.
      const t0 = performance.now();
      let outputs: OutputValues;
      let cooking: Promise<OutputValues>;
      try {
        cooking = Promise.resolve(def.cook(inputs, params, ctx));
      } catch (error) {
        if (error instanceof NodeCookError) throw error;
        throw new NodeCookError(nodeId, node.type, error);
      }
      try {
        outputs = await waitForCookControl(cooking, ctx);
      } catch (error) {
        // Detach a non-cooperative browser/model primitive from the active
        // coordinator. If it eventually yields GPU outputs, reclaim them even
        // though this attempt has already terminated.
        void cooking.then(
          (lateOutputs) => disposeOutputs(lateOutputs, ctx),
          () => {},
        );
        if (error instanceof NodeCookError) throw error;
        throw new NodeCookError(nodeId, node.type, error);
      }
      try {
        throwIfCookInterrupted(ctx);
      } catch (error) {
        // A non-cooperative async cook may return after supersession. Its
        // textures were never transferred into the attempt cache, so reclaim
        // them here exactly once before preserving node attribution.
        disposeOutputs(outputs, ctx);
        throw new NodeCookError(nodeId, node.type, error);
      }
      attempt.entries.set(cacheKey, { nodeId, hash, outputs });
      attempt.events.push({
        nodeId,
        type: node.type,
        status: 'miss',
        ms: performance.now() - t0,
      });
      const result = { outputs, hash };
      attempt.nodeResults.set(nodeId, result);
      return result;
    })();

    memo.set(nodeId, promise);
    return promise;
  }
}

// Ownership rule: a cache entry owns exactly the textures in its own
// raster/alpha outputs. Raster content embedded in elements is NOT owned —
// it belongs to the producing node's entry, and hash propagation guarantees
// producer and consumer entries are always evicted in the same pass.
function disposeOutputs(
  outputs: OutputValues,
  ctx: CookContext,
  released: Set<unknown> = new Set(),
) {
  if (!ctx.gpu) return;
  for (const value of Object.values(outputs)) {
    if (value.kind === 'raster' || value.kind === 'alpha') {
      if (released.has(value.texture)) continue;
      released.add(value.texture);
      ctx.gpu.pool.release(value.texture);
    }
  }
}

/** Find the input edges wired into a node, keyed by input socket name. */
export function incomingEdges(graph: Graph, nodeId: NodeId): Edge[] {
  return graph.edges.filter((e) => e.to.node === nodeId);
}
