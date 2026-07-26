import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Doc, Graph } from './engine/graph';

function readFixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../test/fixtures/documents/${name}`, import.meta.url), 'utf8'),
  ) as T;
}

function storageWith(entries: Record<string, unknown>): Storage {
  const values = new Map(Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

async function loadWithStorage(entries: Record<string, unknown>): Promise<Doc> {
  vi.resetModules();
  vi.stubGlobal('localStorage', storageWith(entries));
  const { useApp } = await import('./store');
  return structuredClone(useApp.getState().doc);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  Reflect.deleteProperty(globalThis, '__app');
});

describe('saved-document loading baseline', () => {
  it('loads a gfx.document.v1 graph as one layer and preserves its frame', async () => {
    const legacy = readFixture<Graph>('legacy-single-graph.json');
    const doc = await loadWithStorage({ 'gfx.document.v1': legacy });
    expect(doc.frame).toEqual(legacy.frame);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0]).toMatchObject({
      id: 'layer_1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
    });
    expect(doc.layers[0].graph).toEqual({ nodes: legacy.nodes, edges: legacy.edges });
  });

  it('loads the layered gfx.document.v2 localStorage shape without drift', async () => {
    const layered = readFixture<Doc>('layered-local-storage.json');
    await expect(loadWithStorage({ 'gfx.document.v2': layered })).resolves.toEqual(layered);
  });

  it('prefers the current layered save when both storage generations exist', async () => {
    const legacy = readFixture<Graph>('legacy-single-graph.json');
    const layered = readFixture<Doc>('layered-local-storage.json');
    await expect(loadWithStorage({
      'gfx.document.v1': legacy,
      'gfx.document.v2': layered,
    })).resolves.toEqual(layered);
  });

  it('uses the frozen factory document when storage is empty', async () => {
    const factory = readFixture<Doc>('factory-document.json');
    await expect(loadWithStorage({})).resolves.toEqual(factory);
  });
});
