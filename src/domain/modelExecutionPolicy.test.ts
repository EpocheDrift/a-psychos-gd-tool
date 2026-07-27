import { describe, expect, it } from 'vitest';
import type { Doc } from '../engine/graph';
import {
  deferredAgentNodeTypesInDocument,
  modelNodeTypesInDocument,
} from './modelExecutionPolicy';

function documentWith(nodeTypes: string[]): Doc {
  return {
    frame: { width: 64, height: 64 },
    layers: [{
      id: 'layer_1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      graph: {
        nodes: Object.fromEntries(nodeTypes.map((type, index) => {
          const id = `node_${index}`;
          return [id, {
            id,
            type,
            params: {},
            position: { x: index * 100, y: 0 },
          }];
        })),
        edges: [],
      },
    }],
  };
}

describe('model execution policy', () => {
  it('detects model-backed nodes without exposing executable registry entries', () => {
    expect(modelNodeTypesInDocument(
      documentWith(['Output', 'RemoveBackground', 'RemoveBackground']),
    )).toEqual(['RemoveBackground']);
    expect(modelNodeTypesInDocument(documentWith(['Noise', 'Output']))).toEqual([]);
  });

  it('does not defer worker tracing after the Gate D resource controls ship', () => {
    expect(deferredAgentNodeTypesInDocument(
      documentWith(['Trace', 'OutlineImage', 'Noise']),
    )).toEqual([]);
  });
});
