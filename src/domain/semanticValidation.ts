import type { Doc, Edge, Graph, NodeInstance } from '../engine/graph';
import type { NodeDef, Registry, SocketSpec } from '../engine/registry';
import { canConnect } from '../engine/registry';
import { registry as appRegistry } from '../nodes';
import {
  FindingCollector,
  type FindingInput,
  type ValidationMode,
  type ValidationReport,
} from './agentErrors';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_DOCUMENT_ID,
  createSerializedProject,
  inspectJsonValueSafety,
  validateSerializedProjectStructure,
} from './documentSchema';
import {
  MISSING,
  isPlainRecord,
  joinJsonPointer,
  readOwnData,
} from './json';
import { resolveAgentLimits, type AgentLimits } from './limits';
import { validateParamValue } from './paramValidation';

export interface ValidationOptions {
  mode?: ValidationMode;
  limits?: Partial<AgentLimits>;
  registry?: Registry;
  maxFindings?: number;
  /**
   * Trusted human editing may temporarily violate non-resource semantics while
   * typing, but it must never commit past global memory/work budgets.
   */
  semanticErrorPolicy?: 'all' | 'resource-only';
}

class ResourceOnlyFindingCollector extends FindingCollector {
  override error(input: FindingInput): void {
    if (input.code === 'RESOURCE_LIMIT') super.error(input);
  }

  override warning(_input: FindingInput): void {
    // No semantic warnings are required for a resource-only UI gate.
  }
}

interface ValidatedEdge {
  edge: Edge;
  index: number;
  fromNode: NodeInstance;
  toNode: NodeInstance;
  fromSocket: SocketSpec;
  toSocket: SocketSpec;
}

interface SemanticResourceTotals {
  generatedItems: number;
  assetBytes: number;
}

interface SemanticGraphCandidate {
  graph: Graph;
  path: string;
  complete: boolean;
  edgeIndexes: number[];
  presentNodeIds: ReadonlySet<string>;
}

function ownParam(node: NodeInstance, definition: NodeDef, name: string): string | number | boolean {
  if (Object.hasOwn(node.params, name)) return node.params[name];
  return definition.params.find((param) => param.name === name)?.default ?? 0;
}

function graphCycles(graph: Graph, validEdges: readonly ValidatedEdge[]): Array<{
  nodeIds: string[];
  edgeIndexes: number[];
}> {
  const ids = Object.keys(graph.nodes).sort();
  const adjacency = new Map(ids.map((id) => [id, [] as string[]]));
  for (const { edge } of validEdges) adjacency.get(edge.from.node)?.push(edge.to.node);
  for (const neighbors of adjacency.values()) neighbors.sort();

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (id: string): void => {
    indices.set(id, nextIndex);
    lowLinks.set(id, nextIndex);
    nextIndex++;
    stack.push(id);
    onStack.add(id);

    for (const neighbor of adjacency.get(id) ?? []) {
      if (!indices.has(neighbor)) {
        visit(neighbor);
        lowLinks.set(id, Math.min(lowLinks.get(id)!, lowLinks.get(neighbor)!));
      } else if (onStack.has(neighbor)) {
        lowLinks.set(id, Math.min(lowLinks.get(id)!, indices.get(neighbor)!));
      }
    }

    if (lowLinks.get(id) === indices.get(id)) {
      const component: string[] = [];
      let current: string;
      do {
        current = stack.pop()!;
        onStack.delete(current);
        component.push(current);
      } while (current !== id);
      component.sort();
      const selfCycle = component.length === 1
        && (adjacency.get(component[0]) ?? []).includes(component[0]);
      if (component.length > 1 || selfCycle) components.push(component);
    }
  };

  for (const id of ids) if (!indices.has(id)) visit(id);
  return components
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map((nodeIds) => {
      const members = new Set(nodeIds);
      return {
        nodeIds,
        edgeIndexes: validEdges
          .filter(({ edge }) => members.has(edge.from.node) && members.has(edge.to.node))
          .map(({ index }) => index)
          .sort((a, b) => a - b),
      };
    });
}

function reachableUpstream(outputId: string, edges: readonly ValidatedEdge[]): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const { edge } of edges) {
    const list = incoming.get(edge.to.node) ?? [];
    list.push(edge.from.node);
    incoming.set(edge.to.node, list);
  }
  const reachable = new Set<string>();
  const stack = [outputId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const source of incoming.get(id) ?? []) stack.push(source);
  }
  return reachable;
}

function saturatingAdd(left: number, right: number, ceiling: number): number {
  if (left >= ceiling || right >= ceiling || left > ceiling - right) return ceiling;
  return left + right;
}

function saturatingMultiply(left: number, right: number, ceiling: number): number {
  if (left <= 0 || right <= 0) return 0;
  if (left >= ceiling || right >= ceiling || left > ceiling / right) return ceiling;
  return left * right;
}

function estimateGeneratedItems(
  graph: Graph,
  definitions: ReadonlyMap<string, NodeDef>,
  validEdges: readonly ValidatedEdge[],
  limit: number,
): number {
  const ceiling = limit + 1;
  const incoming = new Map<string, Map<string, string>>();
  for (const { edge } of validEdges) {
    const sockets = incoming.get(edge.to.node) ?? new Map<string, string>();
    sockets.set(edge.to.socket, edge.from.node);
    incoming.set(edge.to.node, sockets);
  }
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const estimate = (nodeId: string): number => {
    const cached = memo.get(nodeId);
    if (cached !== undefined) return cached;
    if (visiting.has(nodeId)) return ceiling;
    visiting.add(nodeId);
    const node = graph.nodes[nodeId];
    const definition = node ? definitions.get(nodeId) : undefined;
    if (!node || !definition) return 0;
    const source = (socket: string): number => {
      const sourceId = incoming.get(nodeId)?.get(socket);
      return sourceId ? estimate(sourceId) : 1;
    };
    const numberParam = (name: string): number => Number(ownParam(node, definition, name));

    let count = 1;
    switch (node.type) {
      case 'Split': {
        const textId = incoming.get(nodeId)?.get('text');
        const textNode = textId ? graph.nodes[textId] : undefined;
        const textDefinition = textId ? definitions.get(textId) : undefined;
        const content = textNode && textDefinition && textNode.type === 'Text'
          ? String(ownParam(textNode, textDefinition, 'content'))
          : '';
        count = ownParam(node, definition, 'by') === 'words'
          ? content.trim().split(/\s+/).filter(Boolean).length
          : [...content].filter((character) => character !== ' ').length;
        break;
      }
      case 'Duplicator':
        count = saturatingMultiply(source('in'), Math.max(0, Math.round(numberParam('count'))), ceiling);
        break;
      case 'Grid':
        count = saturatingMultiply(
          Math.max(0, Math.round(numberParam('columns'))),
          Math.max(0, Math.round(numberParam('rows'))),
          ceiling,
        );
        break;
      case 'Random': {
        const upstream = incoming.get(nodeId)?.get('layout');
        count = upstream
          ? estimate(upstream)
          : Math.max(1, Math.min(
              1000,
              Math.round(
                (numberParam('areaWidth') * numberParam('areaHeight'))
                / Math.max(1, numberParam('spacing') ** 2),
              ),
            ));
        break;
      }
      case 'Function': {
        const gap = Math.max(1, numberParam('gap'));
        const radius = Math.max(1, numberParam('radius'));
        const turns = Math.max(0.25, numberParam('turns'));
        const width = Math.max(10, numberParam('width'));
        const fn = ownParam(node, definition, 'fn');
        const length =
          fn === 'circle'
            ? 2 * Math.PI * radius
            : fn === 'spiral'
              ? 2 * Math.PI * radius * turns
              : width * 2;
        count = Math.min(ceiling, Math.max(1, Math.ceil(length / gap)));
        break;
      }
      case 'Weight':
      case 'Filter':
        count = source('layout');
        break;
      case 'Place':
        count = source('elements');
        break;
      default:
        count = 1;
    }
    visiting.delete(nodeId);
    memo.set(nodeId, Math.min(ceiling, count));
    return Math.min(ceiling, count);
  };

  let total = 0;
  for (const nodeId of Object.keys(graph.nodes).sort()) {
    total = saturatingAdd(total, estimate(nodeId), ceiling);
    if (total >= ceiling) break;
  }
  return total;
}

function validateGraphSemantics(
  graph: Graph,
  path: string,
  complete: boolean,
  edgeIndexes: readonly number[],
  presentNodeIds: ReadonlySet<string>,
  mode: ValidationMode,
  registry: Registry,
  limits: AgentLimits,
  collector: FindingCollector,
  totals: SemanticResourceTotals,
): void {
  const definitions = new Map<string, NodeDef>();
  const nodeIds = Object.keys(graph.nodes).sort();
  for (const nodeId of nodeIds) {
    const node = graph.nodes[nodeId];
    const nodePath = joinJsonPointer(joinJsonPointer(path, 'nodes'), nodeId);
    const definition = registry.get(node.type);
    if (!definition) {
      collector.error({
        code: 'UNKNOWN_NODE_TYPE',
        message: `Node type "${node.type}" is not supported.`,
        path: joinJsonPointer(nodePath, 'type'),
        details: { nodeId, nodeType: node.type },
      });
      continue;
    }
    definitions.set(nodeId, definition);
    const paramsByName = new Map(definition.params.map((param) => [param.name, param]));
    for (const paramName of Object.keys(node.params).sort()) {
      const paramPath = joinJsonPointer(joinJsonPointer(nodePath, 'params'), paramName);
      const param = paramsByName.get(paramName);
      if (!param) {
        collector.error({
          code: 'UNKNOWN_PARAM',
          message: `Parameter "${paramName}" is not defined for ${node.type}.`,
          path: paramPath,
          details: { nodeType: node.type, param: paramName },
        });
        continue;
      }
      const result = validateParamValue(node.type, param, node.params[paramName], limits);
      for (const issue of result.issues) {
        collector.error({
          code: issue.code,
          message: issue.message,
          path: paramPath,
          ...(issue.details || issue.pathSuffix
            ? {
                details: {
                  ...(issue.details ?? {}),
                  ...(issue.pathSuffix ? { decodedPath: issue.pathSuffix } : {}),
                },
              }
            : {}),
        });
      }
      if (result.image?.kind === 'data') {
        totals.assetBytes = saturatingAdd(
          totals.assetBytes,
          result.image.byteLength,
          limits.maxLegacyAssetBytesPerDocument + 1,
        );
      }
    }
  }

  const validEdges: ValidatedEdge[] = [];
  const occupiedInputs = new Map<string, number>();
  graph.edges.forEach((edge, safeIndex) => {
    const index = edgeIndexes[safeIndex] ?? safeIndex;
    const edgePath = joinJsonPointer(joinJsonPointer(path, 'edges'), index);
    const fromNode = Object.hasOwn(graph.nodes, edge.from.node) ? graph.nodes[edge.from.node] : undefined;
    const toNode = Object.hasOwn(graph.nodes, edge.to.node) ? graph.nodes[edge.to.node] : undefined;
    if (!fromNode && !presentNodeIds.has(edge.from.node)) {
      collector.error({
        code: 'UNKNOWN_NODE',
        message: `Edge source node "${edge.from.node}" does not exist.`,
        path: `${edgePath}/from/node`,
        details: { nodeId: edge.from.node },
      });
    }
    if (!toNode && !presentNodeIds.has(edge.to.node)) {
      collector.error({
        code: 'UNKNOWN_NODE',
        message: `Edge target node "${edge.to.node}" does not exist.`,
        path: `${edgePath}/to/node`,
        details: { nodeId: edge.to.node },
      });
    }
    if (!fromNode || !toNode) return;
    const fromDefinition = definitions.get(fromNode.id);
    const toDefinition = definitions.get(toNode.id);
    if (!fromDefinition || !toDefinition) return;
    const fromSocket = fromDefinition.outputs.find((socket) => socket.name === edge.from.socket);
    const toSocket = toDefinition.inputs.find((socket) => socket.name === edge.to.socket);
    if (!fromSocket) {
      collector.error({
        code: 'UNKNOWN_SOCKET',
        message: `Output socket "${edge.from.socket}" does not exist on ${fromNode.type}.`,
        path: `${edgePath}/from/socket`,
        details: { nodeId: fromNode.id, socket: edge.from.socket, direction: 'output' },
      });
    }
    if (!toSocket) {
      collector.error({
        code: 'UNKNOWN_SOCKET',
        message: `Input socket "${edge.to.socket}" does not exist on ${toNode.type}.`,
        path: `${edgePath}/to/socket`,
        details: { nodeId: toNode.id, socket: edge.to.socket, direction: 'input' },
      });
    }
    if (!fromSocket || !toSocket) return;
    if (!canConnect(fromSocket, toSocket)) {
      collector.error({
        code: 'TYPE_MISMATCH',
        message: 'Edge socket types are incompatible.',
        path: edgePath,
        details: {
          fromNodeId: fromNode.id,
          fromSocket: fromSocket.name,
          toNodeId: toNode.id,
          toSocket: toSocket.name,
        },
      });
      return;
    }
    const inputKey = `${toNode.id}\u0000${toSocket.name}`;
    const earlier = occupiedInputs.get(inputKey);
    if (earlier !== undefined) {
      collector.error({
        code: 'INPUT_ALREADY_CONNECTED',
        message: 'An input socket may have at most one incoming edge.',
        path: `${edgePath}/to`,
        details: { earlierEdgeIndex: earlier, nodeId: toNode.id, socket: toSocket.name },
      });
      return;
    }
    occupiedInputs.set(inputKey, index);
    validEdges.push({ edge, index, fromNode, toNode, fromSocket, toSocket });
  });

  // Local node and edge checks above are sound for each sanitized subtree.
  // Whole-graph rules below require every node and edge shape to be present;
  // otherwise a malformed sibling could create misleading cycle, closure, or
  // resource conclusions.
  if (!complete) return;

  const cycles = graphCycles(graph, validEdges);
  for (const cycle of cycles) {
    collector.error({
      code: 'CYCLE_DETECTED',
      message: 'Graph contains a directed cycle.',
      path: joinJsonPointer(path, 'edges'),
      details: { nodeIds: cycle.nodeIds, edgeIndexes: cycle.edgeIndexes },
    });
  }

  if (cycles.length === 0) {
    totals.generatedItems = saturatingAdd(
      totals.generatedItems,
      estimateGeneratedItems(graph, definitions, validEdges, limits.maxGeneratedItems),
      limits.maxGeneratedItems + 1,
    );
  }

  if (mode !== 'renderable') return;
  const outputIds = nodeIds.filter((nodeId) => graph.nodes[nodeId].type === 'Output');
  if (outputIds.length === 0) {
    collector.error({
      code: 'OUTPUT_MISSING',
      message: 'Layer graph requires exactly one Output node.',
      path: joinJsonPointer(path, 'nodes'),
    });
    return;
  }
  if (outputIds.length > 1) {
    collector.error({
      code: 'OUTPUT_AMBIGUOUS',
      message: 'Layer graph contains more than one Output node.',
      path: joinJsonPointer(path, 'nodes'),
      details: { outputNodeIds: outputIds },
    });
    return;
  }
  if (cycles.length > 0) return;

  const reachable = reachableUpstream(outputIds[0], validEdges);
  const connectedInputs = new Set(validEdges.map(({ edge }) => `${edge.to.node}\u0000${edge.to.socket}`));
  for (const nodeId of [...reachable].sort()) {
    const definition = definitions.get(nodeId);
    if (!definition) continue;
    for (const input of definition.inputs) {
      if (input.optional) continue;
      if (!connectedInputs.has(`${nodeId}\u0000${input.name}`)) {
        collector.error({
          code: 'REQUIRED_INPUT_MISSING',
          message: `Required input "${input.name}" is not connected.`,
          path: joinJsonPointer(joinJsonPointer(path, 'nodes'), nodeId),
          details: { nodeId, socket: input.name },
        });
      }
    }
  }
}

function semanticGraphCandidates(value: unknown): SemanticGraphCandidate[] {
  if (!isPlainRecord(value)) return [];
  if (readOwnData(value, 'format') !== 'a-psychos-gd-tool') return [];
  if (readOwnData(value, 'schemaVersion') !== CURRENT_SCHEMA_VERSION) return [];
  const document = readOwnData(value, 'document');
  if (!isPlainRecord(document)) return [];
  const layers = readOwnData(document, 'layers');
  if (!Array.isArray(layers)) return [];

  const candidates: SemanticGraphCandidate[] = [];
  layers.forEach((layer, layerIndex) => {
    if (!isPlainRecord(layer)) return;
    const graph = readOwnData(layer, 'graph');
    if (!isPlainRecord(graph)) return;
    const nodes = readOwnData(graph, 'nodes');
    const edges = readOwnData(graph, 'edges');
    if (!isPlainRecord(nodes) || !Array.isArray(edges)) return;

    let complete = true;
    const presentNodeIds = new Set(Object.keys(nodes));
    const safeNodes = Object.create(null) as Record<string, NodeInstance>;
    for (const key of Object.keys(nodes).sort()) {
      const node = readOwnData(nodes, key);
      if (!isPlainRecord(node)) {
        complete = false;
        continue;
      }
      const id = readOwnData(node, 'id');
      const type = readOwnData(node, 'type');
      const params = readOwnData(node, 'params');
      if (id !== key) complete = false;
      if (typeof type !== 'string') {
        complete = false;
        continue;
      }
      const safeParams = Object.create(null) as NodeInstance['params'];
      if (!isPlainRecord(params)) {
        complete = false;
        safeNodes[key] = { id: key, type, params: safeParams };
        continue;
      }
      for (const name of Object.keys(params).sort()) {
        const param = readOwnData(params, name);
        if (
          typeof param === 'string'
          || typeof param === 'boolean'
          || (typeof param === 'number' && Number.isFinite(param))
        ) {
          safeParams[name] = param;
        } else {
          complete = false;
        }
      }
      safeNodes[key] = { id: key, type, params: safeParams };
    }

    const safeEdges: Edge[] = [];
    const edgeIndexes: number[] = [];
    edges.forEach((edge, edgeIndex) => {
      if (!isPlainRecord(edge)) {
        complete = false;
        return;
      }
      const from = readOwnData(edge, 'from');
      const to = readOwnData(edge, 'to');
      if (!isPlainRecord(from) || !isPlainRecord(to)) {
        complete = false;
        return;
      }
      const fromNode = readOwnData(from, 'node');
      const fromSocket = readOwnData(from, 'socket');
      const toNode = readOwnData(to, 'node');
      const toSocket = readOwnData(to, 'socket');
      if (
        typeof fromNode !== 'string'
        || typeof fromSocket !== 'string'
        || typeof toNode !== 'string'
        || typeof toSocket !== 'string'
      ) {
        complete = false;
        return;
      }
      safeEdges.push({
        from: { node: fromNode, socket: fromSocket },
        to: { node: toNode, socket: toSocket },
      });
      edgeIndexes.push(edgeIndex);
    });

    candidates.push({
      graph: { nodes: safeNodes, edges: safeEdges },
      path: `/document/layers/${layerIndex}/graph`,
      complete,
      edgeIndexes,
      presentNodeIds,
    });
  });
  return candidates;
}

function declaredAssetBytes(value: unknown, ceiling: number): number {
  if (!isPlainRecord(value)) return 0;
  const assets = readOwnData(value, 'assets');
  if (assets === MISSING || !Array.isArray(assets)) return 0;
  let total = 0;
  for (const asset of assets) {
    if (!isPlainRecord(asset)) continue;
    const byteLength = readOwnData(asset, 'byteLength');
    if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 0) {
      continue;
    }
    total = saturatingAdd(total, byteLength, ceiling);
  }
  return total;
}

export function findOutputNodeIds(graph: Graph): string[] {
  return Object.keys(graph.nodes)
    .filter((nodeId) => graph.nodes[nodeId].type === 'Output')
    .sort();
}

export function validateSerializedProject(
  value: unknown,
  options: ValidationOptions = {},
): ValidationReport {
  const mode = options.mode ?? 'renderable';
  const limits = resolveAgentLimits(options.limits);
  const structural = validateSerializedProjectStructure(value, {
    limits,
    maxFindings: options.maxFindings,
  });
  if (mode === 'structural') {
    return { ...structural, mode };
  }

  const safety = inspectJsonValueSafety(value, {
    limits,
    maxFindings: options.maxFindings,
  });
  if (!safety.traversalSafe) return { ...structural, mode };

  const collector = new FindingCollector(options.maxFindings ?? limits.maxFindings);
  collector.append(structural.errors);
  collector.append(structural.warnings);
  const semanticCollector = options.semanticErrorPolicy === 'resource-only'
    ? new ResourceOnlyFindingCollector(options.maxFindings ?? limits.maxFindings)
    : collector;
  const selectedRegistry = options.registry ?? appRegistry;
  const totals: SemanticResourceTotals = {
    generatedItems: 0,
    assetBytes: declaredAssetBytes(value, limits.maxLegacyAssetBytesPerDocument + 1),
  };
  for (const candidate of semanticGraphCandidates(value)) {
    validateGraphSemantics(
      candidate.graph,
      candidate.path,
      candidate.complete,
      candidate.edgeIndexes,
      candidate.presentNodeIds,
      mode,
      selectedRegistry,
      limits,
      semanticCollector,
      totals,
    );
  }
  if (totals.generatedItems > limits.maxGeneratedItems) {
    semanticCollector.error({
      code: 'RESOURCE_LIMIT',
      message: `Static document generated-item estimate exceeds ${limits.maxGeneratedItems}.`,
      path: '/document/layers',
      details: {
        estimateAtLeast: totals.generatedItems,
        maximum: limits.maxGeneratedItems,
        estimate: 'static-saturating-v1',
      },
    });
  }
  if (totals.assetBytes > limits.maxLegacyAssetBytesPerDocument) {
    semanticCollector.error({
      code: 'RESOURCE_LIMIT',
      message: `Embedded images exceed ${limits.maxLegacyAssetBytesPerDocument} bytes for the document.`,
      path: '/document',
      details: {
        actualBytesAtLeast: totals.assetBytes,
        maximumBytes: limits.maxLegacyAssetBytesPerDocument,
      },
    });
  }
  if (semanticCollector !== collector) {
    collector.append(semanticCollector.errors);
    collector.append(semanticCollector.warnings);
    if (semanticCollector.truncated) collector.truncated = true;
  }
  const report = collector.report(mode, structural.schemaVersion);
  if (structural.truncated) report.truncated = true;
  return report;
}

export function validateDocument(
  document: unknown,
  options: ValidationOptions = {},
): ValidationReport {
  return validateSerializedProject(
    createSerializedProject(DEFAULT_DOCUMENT_ID, document as Doc),
    options,
  );
}
