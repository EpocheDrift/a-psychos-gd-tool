import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Doc, Graph } from './engine/graph';
import { factoryDoc } from './factoryDoc';
import { PALETTE, registry } from './nodes';

function readJsonFixture<T>(name: string): T {
  const url = new URL(`../test/fixtures/documents/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}

describe('PR 0 saved-document baseline', () => {
  it('freezes the bundled poster example and its layer/node counts', () => {
    const fixture = readJsonFixture<Doc>('factory-document.json');
    expect(fixture).toEqual(factoryDoc);
    expect(fixture.layers.map((layer) => ({
      id: layer.id,
      nodes: Object.keys(layer.graph.nodes).length,
      edges: layer.graph.edges.length,
    }))).toEqual([
      { id: 'layer_2', nodes: 6, edges: 5 },
      { id: 'layer_3', nodes: 7, edges: 6 },
      { id: 'layer_1', nodes: 19, edges: 18 },
      { id: 'layer_4', nodes: 10, edges: 9 },
    ]);
    expect(fixture.layers.reduce((sum, layer) => sum + Object.keys(layer.graph.nodes).length, 0)).toBe(42);
    expect(fixture.layers.reduce((sum, layer) => sum + layer.graph.edges.length, 0)).toBe(38);
    expect(fixture.layers.flatMap((layer) => Object.values(layer.graph.nodes))
      .filter((node) => node.type === 'Output')).toHaveLength(4);
  });

  it('keeps a representative legacy gfx.document.v1 single-graph save', () => {
    const fixture = readJsonFixture<Graph>('legacy-single-graph.json');
    expect(fixture.frame).toEqual({ width: 320, height: 240 });
    expect(Object.values(fixture.nodes).map((node) => node.type)).toEqual([
      'Text',
      'Outline',
      'Rasterize',
      'Output',
    ]);
    expect(fixture.edges).toHaveLength(3);
  });

  it('keeps a representative layered gfx.document.v2 localStorage save', () => {
    const fixture = readJsonFixture<Doc>('layered-local-storage.json');
    expect(fixture.frame).toEqual({ width: 320, height: 240 });
    expect(fixture.layers.map((layer) => layer.id)).toEqual(['base', 'overlay']);
    expect(fixture.layers.map(({ visible, opacity, blendMode }) => ({
      visible,
      opacity,
      blendMode,
    }))).toEqual([
      { visible: true, opacity: 0.8, blendMode: 'multiply' },
      { visible: false, opacity: 0.5, blendMode: 'screen' },
    ]);
    expect(fixture.layers[0].graph.edges).toHaveLength(2);
    expect(Object.values(fixture.layers[0].graph.nodes).map((node) => node.type)).toEqual([
      'Shape',
      'Rasterize',
      'Output',
    ]);
    expect(fixture.layers.every((layer) => Object.values(layer.graph.nodes).some((node) => node.type === 'Output'))).toBe(true);
  });

  it('keeps one JSON-safe instance of every built-in node type', () => {
    const fixture = readJsonFixture<Doc>('all-node-types.json');
    const fixtureTypes = Object.values(fixture.layers[0].graph.nodes).map((node) => node.type).sort();
    const registryTypes = [...registry.keys()].sort();
    expect(fixtureTypes).toEqual(registryTypes);
    expect(fixtureTypes).toHaveLength(31);
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
  });
});

describe('palette and registry inventory', () => {
  it('derives the registry from the complete, duplicate-free palette inventory', () => {
    const paletteDefinitions = PALETTE.flatMap((category) => category.nodes);
    const paletteTypes = paletteDefinitions.map((definition) => definition.type);
    expect(new Set(paletteTypes).size).toBe(paletteTypes.length);
    expect([...registry.keys()]).toEqual(paletteTypes);
    expect([...registry.values()]).toEqual(paletteDefinitions);
    expect(PALETTE.every((category) => category.nodes.length > 0)).toBe(true);
    expect(registry.size).toBe(31);
  });
});

describe('small-frame screenshot fixture', () => {
  it('is a native 256x192 PNG', () => {
    const png = readFileSync(new URL('../test/fixtures/screenshots/visual-small-frame.png', import.meta.url));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.readUInt32BE(16)).toBe(256);
    expect(png.readUInt32BE(20)).toBe(192);
  });
});
