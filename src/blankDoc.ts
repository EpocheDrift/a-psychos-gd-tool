import { DEFAULT_FRAME, type Doc } from './engine/graph';

/**
 * The canonical new-project document. It is intentionally minimal but still
 * renderable: every document has one layer, and every layer has one Output.
 */
export const blankDoc: Doc = {
  frame: { ...DEFAULT_FRAME },
  layers: [{
    id: 'layer_1',
    name: 'Layer 1',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    graph: {
      nodes: {
        out: {
          id: 'out',
          type: 'Output',
          params: {
            transparent: false,
            background: '#ffffff',
          },
          position: { x: 320, y: 160 },
        },
      },
      edges: [],
    },
  }],
};
