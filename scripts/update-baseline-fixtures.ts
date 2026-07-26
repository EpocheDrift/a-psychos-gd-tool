import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Doc, Graph, NodeInstance } from '../src/engine/graph';
import { factoryDoc } from '../src/factoryDoc';
import { PALETTE } from '../src/nodes';

const fixtureDirectory = resolve('test/fixtures/documents');

async function writeJson(name: string, value: unknown): Promise<void> {
  await mkdir(fixtureDirectory, { recursive: true });
  await writeFile(resolve(fixtureDirectory, name), `${JSON.stringify(value, null, 2)}\n`);
}

const legacySingleGraph: Graph = {
  frame: { width: 320, height: 240 },
  nodes: {
    text: {
      id: 'text',
      type: 'Text',
      params: { content: 'LEGACY', font: 'default', fontSize: 72, fill: '#ffffff' },
      position: { x: 0, y: 0 },
    },
    outline: { id: 'outline', type: 'Outline', params: {}, position: { x: 220, y: 0 } },
    raster: { id: 'raster', type: 'Rasterize', params: {}, position: { x: 440, y: 0 } },
    out: {
      id: 'out',
      type: 'Output',
      params: { transparent: false, background: '#101820' },
      position: { x: 660, y: 0 },
    },
  },
  edges: [
    { from: { node: 'text', socket: 'out' }, to: { node: 'outline', socket: 'text' } },
    { from: { node: 'outline', socket: 'out' }, to: { node: 'raster', socket: 'vector' } },
    { from: { node: 'raster', socket: 'out' }, to: { node: 'out', socket: 'in' } },
  ],
};

// Representative gfx.document.v2 localStorage payload. The base contains a
// connected graph, while both layers exercise non-default composition
// metadata without fonts, assets, or model/network work.
const layeredLocalStorage: Doc = {
  frame: { width: 320, height: 240 },
  layers: [
    {
      id: 'base',
      name: 'Connected base',
      visible: true,
      opacity: 0.8,
      blendMode: 'multiply',
      graph: {
        nodes: {
          shape: {
            id: 'shape',
            type: 'Shape',
            params: {
              kind: 'rect',
              width: 120,
              height: 80,
              sides: 6,
              filled: true,
              fill: '#ff1493',
              stroke: false,
              strokeColor: '#000000',
              strokeWidth: 4,
              strokeAlign: 'center',
            },
            position: { x: 0, y: 0 },
          },
          raster: {
            id: 'raster',
            type: 'Rasterize',
            params: {},
            position: { x: 220, y: 0 },
          },
          out: {
            id: 'out',
            type: 'Output',
            params: { transparent: false, background: '#204060' },
            position: { x: 440, y: 0 },
          },
        },
        edges: [
          { from: { node: 'shape', socket: 'out' }, to: { node: 'raster', socket: 'vector' } },
          { from: { node: 'raster', socket: 'out' }, to: { node: 'out', socket: 'in' } },
        ],
      },
    },
    {
      id: 'overlay',
      name: 'Transparent overlay',
      visible: false,
      opacity: 0.5,
      blendMode: 'screen',
      graph: {
        nodes: {
          out: {
            id: 'out',
            type: 'Output',
            params: { transparent: true, background: '#ffffff' },
            position: { x: 0, y: 0 },
          },
        },
        edges: [],
      },
    },
  ],
};

const visualSmallFrame: Doc = {
  frame: { width: 256, height: 192 },
  layers: [
    {
      id: 'visual',
      name: 'Deterministic visual',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      graph: {
        nodes: {
          shape: {
            id: 'shape',
            type: 'Shape',
            params: {
              kind: 'rect',
              width: 96,
              height: 64,
              sides: 6,
              filled: true,
              fill: '#ff1493',
              stroke: false,
              strokeColor: '#000000',
              strokeWidth: 4,
              strokeAlign: 'center',
            },
            position: { x: 0, y: 0 },
          },
          raster: { id: 'raster', type: 'Rasterize', params: {}, position: { x: 220, y: 0 } },
          out: {
            id: 'out',
            type: 'Output',
            params: { transparent: false, background: '#102030' },
            position: { x: 440, y: 0 },
          },
        },
        edges: [
          { from: { node: 'shape', socket: 'out' }, to: { node: 'raster', socket: 'vector' } },
          { from: { node: 'raster', socket: 'out' }, to: { node: 'out', socket: 'in' } },
        ],
      },
    },
  ],
};

const allNodes = PALETTE.flatMap(({ nodes }) => nodes).map((def, index): NodeInstance => {
  const id = `${def.type.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}_${index + 1}`;
  return {
    id,
    type: def.type,
    params: Object.fromEntries(def.params.map((param) => [param.name, param.default])),
    position: { x: (index % 6) * 240, y: Math.floor(index / 6) * 180 },
  };
});

const allNodeTypes: Doc = {
  frame: { width: 320, height: 240 },
  layers: [
    {
      id: 'all_node_types',
      name: 'Every built-in node',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      graph: {
        nodes: Object.fromEntries(allNodes.map((node) => [node.id, node])),
        edges: [],
      },
    },
  ],
};

await Promise.all([
  writeJson('factory-document.json', factoryDoc),
  writeJson('legacy-single-graph.json', legacySingleGraph),
  writeJson('layered-local-storage.json', layeredLocalStorage),
  writeJson('visual-small-frame.json', visualSmallFrame),
  writeJson('all-node-types.json', allNodeTypes),
]);

console.log(`updated baseline document fixtures in ${fixtureDirectory}`);
