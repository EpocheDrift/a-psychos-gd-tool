import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Doc, Graph, NodeInstance } from '../src/engine/graph';
import { CAPABILITY_MANIFEST } from '../src/domain/capabilityManifest';
import { prepareProjectImport } from '../src/domain/projectCodec';
import {
  PROJECT_V3_SCHEMA,
  PROJECT_V4_SCHEMA,
} from '../src/domain/projectSchema';
import {
  LEGACY_SCHEMA_VERSION,
  PROJECT_FORMAT,
  validateSerializedProjectV3Structure,
  type SerializedProjectV3,
} from '../src/domain/documentSchema';
import { factoryDoc } from '../src/factoryDoc';
import { PALETTE } from '../src/nodes';

const fixtureDirectory = resolve('test/fixtures/documents');
const contractFixtureDirectory = resolve('test/fixtures/contracts');

async function writeJson(directory: string, name: string, value: unknown): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, name), `${JSON.stringify(value, null, 2)}\n`);
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

const legacyWeightImage: Doc = {
  frame: { width: 320, height: 240 },
  layers: [{
    id: 'legacy_weight',
    name: 'Legacy image channel',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    graph: {
      nodes: {
        grid: { id: 'grid', type: 'Grid', params: { columns: 2, rows: 2 } },
        image: { id: 'image', type: 'Image', params: { src: '/factory-image.jpg' } },
        weight: { id: 'weight', type: 'Weight', params: { source: 'image' } },
        filter: {
          id: 'filter',
          type: 'Filter',
          params: { mode: 'threshold', channel: 'image', threshold: 0.5 },
        },
        shape: { id: 'shape', type: 'Shape', params: {} },
        copies: { id: 'copies', type: 'Duplicator', params: { count: 4 } },
        place: {
          id: 'place',
          type: 'Place',
          params: {
            binds: '[{"channel":"image","target":"scale","amount":0.5}]',
          },
        },
        out: { id: 'out', type: 'Output', params: { transparent: true } },
      },
      edges: [
        { from: { node: 'grid', socket: 'out' }, to: { node: 'weight', socket: 'layout' } },
        { from: { node: 'image', socket: 'out' }, to: { node: 'weight', socket: 'map' } },
        { from: { node: 'weight', socket: 'out' }, to: { node: 'filter', socket: 'layout' } },
        { from: { node: 'filter', socket: 'out' }, to: { node: 'place', socket: 'layout' } },
        { from: { node: 'shape', socket: 'out' }, to: { node: 'copies', socket: 'in' } },
        { from: { node: 'copies', socket: 'out' }, to: { node: 'place', socket: 'elements' } },
        { from: { node: 'place', socket: 'out' }, to: { node: 'out', socket: 'in' } },
      ],
    },
  }],
};

const serializedProjectV3: SerializedProjectV3 = {
  format: PROJECT_FORMAT,
  schemaVersion: LEGACY_SCHEMA_VERSION,
  documentId: 'fixture_project',
  document: structuredClone(layeredLocalStorage),
};
const v3Report = validateSerializedProjectV3Structure(serializedProjectV3);
if (!v3Report.valid) {
  throw new Error(`serialized v3 fixture failed validation: ${v3Report.errors[0]?.code}`);
}
const serializedProjectV4 = prepareProjectImport(serializedProjectV3, {
  documentIdForLegacy: 'fixture_project',
});
if (!serializedProjectV4.ok) {
  throw new Error(`serialized v4 fixture failed validation: ${serializedProjectV4.report.errors[0]?.code}`);
}

await Promise.all([
  writeJson(fixtureDirectory, 'factory-document.json', factoryDoc),
  writeJson(fixtureDirectory, 'legacy-single-graph.json', legacySingleGraph),
  writeJson(fixtureDirectory, 'layered-local-storage.json', layeredLocalStorage),
  writeJson(fixtureDirectory, 'visual-small-frame.json', visualSmallFrame),
  writeJson(fixtureDirectory, 'all-node-types.json', allNodeTypes),
  writeJson(fixtureDirectory, 'legacy-weight-image.json', legacyWeightImage),
  writeJson(fixtureDirectory, 'serialized-project-v3.json', serializedProjectV3),
  writeJson(fixtureDirectory, 'serialized-project-v4.json', serializedProjectV4.project),
  writeJson(contractFixtureDirectory, 'capability-manifest.v1.json', CAPABILITY_MANIFEST),
  writeJson(contractFixtureDirectory, 'project-v3.schema.json', PROJECT_V3_SCHEMA),
  writeJson(contractFixtureDirectory, 'project-v4.schema.json', PROJECT_V4_SCHEMA),
]);

console.log(`updated document and contract fixtures in ${fixtureDirectory}`);
