import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Doc, Graph } from './engine/graph';
import type { AssetMetadata, SerializedProjectV3 } from './domain/documentSchema';

const TEST_ASSET: AssetMetadata = {
  id: 'asset_1',
  sha256: 'a'.repeat(64),
  mimeType: 'image/png',
  byteLength: 16,
  width: 2,
  height: 2,
  source: 'upload',
};

function readFixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../test/fixtures/documents/${name}`, import.meta.url), 'utf8'),
  ) as T;
}

interface StorageHarness {
  storage: Storage;
  values: Map<string, string>;
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
}

function storageWith(entries: Record<string, string>): StorageHarness {
  const values = new Map(Object.entries(entries));
  const getItem = vi.fn((key: string) => values.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => {
    values.set(key, value);
  });
  const removeItem = vi.fn((key: string) => {
    values.delete(key);
  });
  const clear = vi.fn(() => values.clear());
  return {
    values,
    getItem,
    setItem,
    removeItem,
    clear,
    storage: {
      get length() {
        return values.size;
      },
      clear,
      getItem,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem,
      setItem,
    },
  };
}

async function loadStore(entries: Record<string, string>) {
  vi.resetModules();
  const harness = storageWith(entries);
  vi.stubGlobal('localStorage', harness.storage);
  const module = await import('./store');
  return { ...module, harness };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  Reflect.deleteProperty(globalThis, '__app');
});

describe('versioned saved-project loading', () => {
  it('loads a gfx.document.v1 graph as one layer and preserves its frame', async () => {
    const legacy = readFixture<Graph>('legacy-single-graph.json');
    const { useApp, harness } = await loadStore({
      'gfx.document.v1': JSON.stringify(legacy),
    });
    const state = useApp.getState();
    expect(state.documentId).toBe('document_1');
    expect(state.doc.frame).toEqual(legacy.frame);
    expect(state.doc.layers).toHaveLength(1);
    expect(state.doc.layers[0]).toMatchObject({
      id: 'layer_1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
    });
    expect(state.doc.layers[0].graph).toEqual({ nodes: legacy.nodes, edges: legacy.edges });
    expect(harness.setItem).not.toHaveBeenCalled();
  });

  it('loads the layered gfx.document.v2 shape through migration without drift', async () => {
    const layered = readFixture<Doc>('layered-local-storage.json');
    const { useApp, harness } = await loadStore({
      'gfx.document.v2': JSON.stringify(layered),
    });
    expect(useApp.getState().doc).toEqual(layered);
    expect(useApp.getState().documentId).toBe('document_1');
    expect(harness.setItem).not.toHaveBeenCalled();
  });

  it('loads a v3 envelope with its persistent documentId', async () => {
    const project = readFixture<SerializedProjectV3>('serialized-project-v3.json');
    project.assets = [TEST_ASSET];
    const { useApp, harness } = await loadStore({
      'gfx.project': JSON.stringify(project),
    });
    expect(useApp.getState().doc).toEqual(project.document);
    expect(useApp.getState().documentId).toBe('fixture_project');
    expect(useApp.getState().assets).toEqual([TEST_ASSET]);
    expect(harness.setItem).not.toHaveBeenCalled();
  });

  it('uses strict key priority and never falls back past a malformed newer candidate', async () => {
    const layered = readFixture<Doc>('layered-local-storage.json');
    const legacy = readFixture<Graph>('legacy-single-graph.json');
    const { useApp, harness } = await loadStore({
      'gfx.project': '{malformed',
      'gfx.document.v2': JSON.stringify(layered),
      'gfx.document.v1': JSON.stringify(legacy),
    });
    expect(useApp.getState().doc.frame).toEqual({ width: 2480, height: 3508 });
    expect(useApp.getState().doc).not.toEqual(layered);
    expect(useApp.getState().startupLoadIssue).toMatchObject({
      storageKey: 'gfx.project',
      report: {
        errors: [expect.objectContaining({ code: 'INVALID_ARGUMENT' })],
      },
    });
    expect(harness.values.get('gfx.project')).toBe('{malformed');
    useApp.getState().setFrame({ width: 640, height: 480 });
    expect(harness.values.get('gfx.project')).toBe('{malformed');
    expect(harness.setItem).not.toHaveBeenCalled();
  });

  it('prefers v2 over v1 when no envelope exists', async () => {
    const legacy = readFixture<Graph>('legacy-single-graph.json');
    const layered = readFixture<Doc>('layered-local-storage.json');
    const { useApp } = await loadStore({
      'gfx.document.v1': JSON.stringify(legacy),
      'gfx.document.v2': JSON.stringify(layered),
    });
    expect(useApp.getState().doc).toEqual(layered);
  });

  it('keeps an unsupported legacy image save untouched and exposes the rejection', async () => {
    const layered = readFixture<Doc>('layered-local-storage.json');
    layered.layers[0].graph.nodes.legacy_image = {
      id: 'legacy_image',
      type: 'Image',
      params: { src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==' },
    };
    const raw = JSON.stringify(layered);
    const { useApp, harness } = await loadStore({
      'gfx.document.v2': raw,
    });
    expect(useApp.getState().startupLoadIssue).toMatchObject({
      storageKey: 'gfx.document.v2',
      report: {
        errors: expect.arrayContaining([
          expect.objectContaining({ code: 'ASSET_POLICY_VIOLATION' }),
        ]),
      },
    });
    expect(harness.values.get('gfx.document.v2')).toBe(raw);
    expect(harness.removeItem).not.toHaveBeenCalled();
    useApp.getState().setFrame({ width: 640, height: 480 });
    expect(harness.values.get('gfx.document.v2')).toBe(raw);
    expect(harness.setItem).not.toHaveBeenCalled();
  });

  it('uses the migrated factory document when storage is empty', async () => {
    const factory = readFixture<Doc>('factory-document.json');
    const { useApp } = await loadStore({});
    const document = useApp.getState().doc;
    expect(document).toEqual({
      ...factory,
      layers: factory.layers.map((layer) => ({
        ...layer,
        graph: {
          ...layer.graph,
          nodes: Object.fromEntries(Object.entries(layer.graph.nodes).map(([id, node]) => [
            id,
            node.type === 'Random'
              ? { ...node, params: Object.fromEntries(Object.entries(node.params).filter(([name]) => name !== 'count')) }
              : node,
          ])),
        },
      })),
    });
  });
});

describe('versioned persistence and atomic import/export', () => {
  it('persists edits as a v3 envelope and leaves rollback keys intact', async () => {
    const layered = readFixture<Doc>('layered-local-storage.json');
    const { useApp, harness } = await loadStore({
      'gfx.document.v2': JSON.stringify(layered),
    });
    useApp.getState().setFrame({ width: 640, height: 480 });
    expect(harness.setItem).toHaveBeenCalledTimes(1);
    expect(harness.setItem.mock.calls[0][0]).toBe('gfx.project');
    expect(JSON.parse(harness.setItem.mock.calls[0][1])).toMatchObject({
      format: 'a-psychos-gd-tool',
      schemaVersion: 3,
      documentId: 'document_1',
      document: { frame: { width: 640, height: 480 } },
    });
    expect(harness.removeItem).not.toHaveBeenCalled();
    expect(harness.values.has('gfx.document.v2')).toBe(true);
  });

  it('leaves every store/history/persistence reference untouched when import fails', async () => {
    const { useApp, harness } = await loadStore({});
    const before = useApp.getState();
    const listener = vi.fn();
    const unsubscribe = useApp.subscribe(listener);
    const result = before.importProjectJson('{"format":"a-psychos-gd-tool","schemaVersion":99}');
    unsubscribe();

    expect(result).toMatchObject({
      ok: false,
      report: {
        errors: [expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA_VERSION' })],
      },
    });
    const after = useApp.getState();
    expect(after.doc).toBe(before.doc);
    expect(after.past).toBe(before.past);
    expect(after.future).toBe(before.future);
    expect(after.activeLayerId).toBe(before.activeLayerId);
    expect(after.selectedNodeIds).toBe(before.selectedNodeIds);
    expect(after.documentId).toBe(before.documentId);
    expect(listener).not.toHaveBeenCalled();
    expect(harness.setItem).not.toHaveBeenCalled();
    expect(harness.removeItem).not.toHaveBeenCalled();
    expect(harness.clear).not.toHaveBeenCalled();
  });

  it('commits a valid import once, persists once, and restores document identity on undo', async () => {
    const project = readFixture<SerializedProjectV3>('serialized-project-v3.json');
    project.assets = [TEST_ASSET];
    const { useApp, harness } = await loadStore({});
    const before = useApp.getState();
    useApp.setState({
      future: [{ documentId: 'future_document', doc: before.doc }],
      selectedNodeIds: ['does_not_exist'],
    });
    harness.setItem.mockClear();
    const listener = vi.fn();
    const unsubscribe = useApp.subscribe(listener);
    const result = useApp.getState().importProjectJson(JSON.stringify(project));
    unsubscribe();

    expect(result.ok).toBe(true);
    const imported = useApp.getState();
    expect(imported.documentId).toBe('fixture_project');
    expect(imported.doc).toEqual(project.document);
    expect(imported.assets).toEqual([TEST_ASSET]);
    expect(imported.past).toHaveLength(1);
    expect(imported.future).toHaveLength(0);
    expect(imported.selectedNodeIds).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(harness.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(harness.setItem.mock.calls[0][1])).toEqual(project);

    imported.undo();
    expect(useApp.getState().documentId).toBe(before.documentId);
    expect(useApp.getState().doc).toBe(before.doc);
    expect(useApp.getState().assets).toBe(before.assets);
  });

  it('exports current state without mutation or persistence', async () => {
    const project = readFixture<SerializedProjectV3>('serialized-project-v3.json');
    project.assets = [TEST_ASSET];
    const { useApp, harness } = await loadStore({
      'gfx.project': JSON.stringify(project),
    });
    const before = useApp.getState();
    const result = before.exportProjectJson();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.json)).toEqual(project);
    expect(useApp.getState()).toBe(before);
    expect(harness.setItem).not.toHaveBeenCalled();
  });

  it('round-trips editable Output drafts through local working storage', async () => {
    const project = readFixture<SerializedProjectV3>('serialized-project-v3.json');
    const first = await loadStore({ 'gfx.project': JSON.stringify(project) });
    const active = first.useApp.getState().activeLayerId;
    const activeLayer = first.useApp.getState().doc.layers.find((layer) => layer.id === active)!;
    const outputId = Object.values(activeLayer.graph.nodes)
      .find((node) => node.type === 'Output')!.id;
    first.useApp.getState().removeNodes([outputId]);
    expect(first.harness.setItem).toHaveBeenCalledTimes(1);
    const saved = first.harness.values.get('gfx.project')!;

    const second = await loadStore({ 'gfx.project': saved });
    const reloadedLayer = second.useApp.getState().doc.layers
      .find((layer) => layer.id === active)!;
    expect(Object.values(reloadedLayer.graph.nodes)
      .filter((node) => node.type === 'Output')).toHaveLength(0);
    expect(second.useApp.getState().startupLoadIssue).toBeNull();
  });

  it('never overwrites the last safe working save with a transient invalid parameter', async () => {
    const project = readFixture<SerializedProjectV3>('serialized-project-v3.json');
    const { useApp, harness } = await loadStore({
      'gfx.project': JSON.stringify(project),
    });
    useApp.getState().addNode('Weight', { x: 0, y: 0 });
    const weightId = useApp.getState().selectedNodeIds[0];
    const safeSave = harness.values.get('gfx.project');
    harness.setItem.mockClear();

    useApp.getState().setParam(weightId, 'expr', 'process.exit(');
    expect(useApp.getState().doc.layers
      .find((layer) => layer.id === useApp.getState().activeLayerId)!
      .graph.nodes[weightId].params.expr).toBe('process.exit(');
    expect(harness.setItem).not.toHaveBeenCalled();
    expect(harness.values.get('gfx.project')).toBe(safeSave);
    expect(useApp.getState().persistenceValidationReport).toMatchObject({
      valid: false,
      errors: [expect.objectContaining({
        path: expect.stringContaining(`/nodes/${weightId}/params/expr`),
      })],
    });

    useApp.getState().setParam(weightId, 'expr', '1 - progress');
    expect(useApp.getState().persistenceValidationReport).toBeNull();
    expect(harness.setItem).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe Image values before state, history, or persistence changes', async () => {
    const project = readFixture<SerializedProjectV3>('serialized-project-v3.json');
    const { useApp, harness } = await loadStore({
      'gfx.project': JSON.stringify(project),
    });
    useApp.getState().addNode('Image', { x: 0, y: 0 });
    const imageId = useApp.getState().selectedNodeIds[0];
    harness.setItem.mockClear();
    const before = useApp.getState();
    useApp.getState().setParam(imageId, 'src', 'https://tracker.invalid/pixel.gif');
    const after = useApp.getState();
    expect(after).toBe(before);
    expect(harness.setItem).not.toHaveBeenCalled();
  });
});
