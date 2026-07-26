import type { Doc } from '../engine/graph';
import { NODE_PUBLIC_METADATA } from './publicNodeMetadata';

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
