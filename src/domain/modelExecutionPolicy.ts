import type { Doc } from '../engine/graph';
import { NODE_PUBLIC_METADATA } from './publicNodeMetadata';

export const PR7_DEFERRED_AGENT_NODE_TYPES = Object.freeze([
  'Trace',
  'OutlineImage',
] as const);

/** Return the public node types that can execute or download model code/data. */
export function modelNodeTypesInDocument(document: Doc): string[] {
  const found = new Set<string>();
  for (const layer of document.layers) {
    for (const node of Object.values(layer.graph.nodes)) {
      const metadata = NODE_PUBLIC_METADATA[node.type];
      if (
        metadata?.execution.runtime === 'model'
        || metadata?.execution.network === 'model-download'
        || metadata?.externalDownload
      ) {
        found.add(node.type);
      }
    }
  }
  return [...found].sort();
}

/** Worker tracing stays behind Gate D even though it needs no model scope. */
export function deferredAgentNodeTypesInDocument(document: Doc): string[] {
  const deferred = new Set<string>(PR7_DEFERRED_AGENT_NODE_TYPES);
  const found = new Set<string>();
  for (const layer of document.layers) {
    for (const node of Object.values(layer.graph.nodes)) {
      if (deferred.has(node.type)) found.add(node.type);
    }
  }
  return [...found].sort();
}
