import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Doc, Graph } from './engine/graph';
import type { AssetMetadata, SerializedProjectV3 } from './domain/documentSchema';
import { FACTORY_ASSET_METADATA } from './domain/assetPolicy';
import { prepareProjectImport } from './domain/projectCodec';
import { blankDoc } from './blankDoc';
import { getStarterProject } from './starterProjects';

const UNBACKED_V3_ASSET: AssetMetadata = {
  id: 'asset_1',
  sha256: 'a'.repeat(64),
  mimeType: 'image/png',
  byteLength: 16,
  width: 2,
  height: 2,
  source: 'upload',
};

const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function v3ProjectWithEmbeddedAsset(): SerializedProjectV3 {
  const project = readFixture<SerializedProjectV3>('serialized-project-v3.json');
  project.document.layers[0].graph.nodes.migrated_image = {
    id: 'migrated_image',
    type: 'Image',
    params: { src: ONE_PIXEL_PNG },
  };
  return project;
}

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

async function finishGesture(endGesture: () => void): Promise<void> {
  endGesture();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('versioned saved-project loading', () => {
  it('loads a gfx.document.v1 graph as one layer and preserves its frame', async () => {
    const legacy = readFixture<Graph>('legacy-single-graph.json');
    const { assetBootstrapReady, useApp, harness } = await loadStore({
      'gfx.document.v1': JSON.stringify(legacy),
    });
    await assetBootstrapReady;
    const state = useApp.getState();
    expect(state.documentId).toBe('document_1');
    expect(state.revision).toBe(0);
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
    expect(harness.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(harness.values.get('gfx.project')!)).toMatchObject({
      schemaVersion: 4,
      document: { frame: legacy.frame },
    });
    expect(harness.values.get('gfx.document.v1')).toBe(JSON.stringify(legacy));
  });

  it('loads the layered gfx.document.v2 shape through migration without drift', async () => {
    const layered = readFixture<Doc>('layered-local-storage.json');
    const { assetBootstrapReady, useApp, harness } = await loadStore({
      'gfx.document.v2': JSON.stringify(layered),
    });
    await assetBootstrapReady;
    expect(useApp.getState().doc).toEqual(layered);
    expect(useApp.getState().documentId).toBe('document_1');
    expect(harness.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(harness.values.get('gfx.project')!)).toMatchObject({
      schemaVersion: 4,
      document: layered,
    });
    expect(harness.values.get('gfx.document.v2')).toBe(JSON.stringify(layered));
  });

  it('loads a v3 envelope with its persistent documentId and drops unbacked metadata', async () => {
    const project = readFixture<SerializedProjectV3>('serialized-project-v3.json');
    project.assets = [UNBACKED_V3_ASSET];
    const { assetBootstrapReady, useApp, harness } = await loadStore({
      'gfx.project': JSON.stringify(project),
    });
    await assetBootstrapReady;
    expect(useApp.getState().doc).toEqual(project.document);
    expect(useApp.getState().documentId).toBe('fixture_project');
    expect(useApp.getState().assets).toBeUndefined();
    expect(useApp.getState().revision).toBe(0);
    expect(useApp.getState().startupLoadIssue).toBeNull();
    expect(harness.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(harness.values.get('gfx.project')!)).toMatchObject({
      schemaVersion: 4,
      documentId: 'fixture_project',
    });
  });

  it('uses strict key priority and never falls back past a malformed newer candidate', async () => {
    const layered = readFixture<Doc>('layered-local-storage.json');
    const legacy = readFixture<Graph>('legacy-single-graph.json');
    const { useApp, harness } = await loadStore({
      'gfx.project': '{malformed',
      'gfx.document.v2': JSON.stringify(layered),
      'gfx.document.v1': JSON.stringify(legacy),
    });
    expect(useApp.getState().doc).toEqual(blankDoc);
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

  it('fails closed when saved-project storage cannot be read', async () => {
    vi.resetModules();
    const harness = storageWith({});
    harness.getItem.mockImplementation(() => {
      throw new Error('blocked storage');
    });
    vi.stubGlobal('localStorage', harness.storage);
    const {
      assetBootstrapReady,
      settleStorePersistence,
      useApp,
    } = await import('./store');
    await assetBootstrapReady;

    expect(useApp.getState().startupLoadIssue).toMatchObject({
      storageKey: 'gfx.project',
      report: {
        errors: [expect.objectContaining({
          code: 'PERSISTENCE_FAILED',
        })],
      },
    });
    useApp.getState().setFrame({ width: 640, height: 480 });
    expect(settleStorePersistence()).toBe('memory-only');
    expect(harness.setItem).not.toHaveBeenCalled();

    const imported = await useApp.getState().importProjectJson(
      JSON.stringify(
        readFixture('serialized-project-v4.json'),
      ),
    );
    expect(imported.ok).toBe(true);
    expect(useApp.getState().startupLoadIssue).toBeNull();
    expect(harness.setItem).toHaveBeenCalled();
  });

  it('does not overwrite a rejected recovery candidate during an Agent persistence settlement', async () => {
    const rejected = '{"schemaVersion":999,"documentId":"future"}';
    const {
      settleStorePersistence,
      useApp,
      harness,
    } = await loadStore({
      'gfx.project': rejected,
    });
    expect(useApp.getState().startupLoadIssue).not.toBeNull();
    harness.setItem.mockClear();

    expect(settleStorePersistence()).toBe('memory-only');
    expect(harness.setItem).not.toHaveBeenCalled();
    expect(harness.values.get('gfx.project')).toBe(rejected);
    expect(useApp.getState().startupLoadIssue).not.toBeNull();
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

  it('uses the canonical blank document when storage is empty', async () => {
    const { assetBootstrapReady, useApp, harness } = await loadStore({});
    await assetBootstrapReady;
    expect(useApp.getState()).toMatchObject({
      documentId: 'document_1',
      doc: blankDoc,
      revision: 0,
      startupLoadIssue: null,
    });
    expect(useApp.getState().assets).toBeUndefined();
    expect(harness.setItem).not.toHaveBeenCalled();
  });

  it('loads the bundled poster only through an explicit starter import', async () => {
    const starter = getStarterProject('factory-poster');
    expect(starter).toBeDefined();
    if (!starter) return;
    const expected = prepareProjectImport(starter.document, {
      documentIdForLegacy: starter.documentId,
    });
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;

    const { assetBootstrapReady, useApp } = await loadStore({});
    await assetBootstrapReady;
    const result = await useApp.getState().importProjectJson(
      JSON.stringify(starter.document),
      starter.documentId,
    );
    expect(result.ok).toBe(true);
    expect(useApp.getState()).toMatchObject({
      documentId: starter.documentId,
      doc: expected.project.document,
      revision: 1,
    });
    expect(useApp.getState().assets).toEqual([FACTORY_ASSET_METADATA]);

    useApp.getState().undo();
    expect(useApp.getState()).toMatchObject({
      documentId: 'document_1',
      doc: blankDoc,
      revision: 2,
    });
  });

  it('checkpoints a staged v3 embedded-asset migration as v4 exactly once', async () => {
    const project = v3ProjectWithEmbeddedAsset();
    const expected = prepareProjectImport(project);
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    const rollbackV2 = JSON.stringify(readFixture<Doc>('layered-local-storage.json'));
    const rollbackV1 = JSON.stringify(readFixture<Graph>('legacy-single-graph.json'));
    const { assetBootstrapReady, harness } = await loadStore({
      'gfx.project': JSON.stringify(project),
      'gfx.document.v2': rollbackV2,
      'gfx.document.v1': rollbackV1,
    });

    await assetBootstrapReady;
    await vi.waitFor(() => {
      expect(harness.setItem).toHaveBeenCalledTimes(1);
    });
    expect(harness.setItem.mock.calls[0][0]).toBe('gfx.project');
    expect(JSON.parse(harness.setItem.mock.calls[0][1]))
      .toEqual(expected.project);
    expect(harness.values.get('gfx.document.v2')).toBe(rollbackV2);
    expect(harness.values.get('gfx.document.v1')).toBe(rollbackV1);
    expect(harness.removeItem).not.toHaveBeenCalled();
  });

  it('does not rewrite an already-v4 startup project', async () => {
    const project = prepareProjectImport(
      readFixture<SerializedProjectV3>('serialized-project-v3.json'),
    );
    expect(project.ok).toBe(true);
    if (!project.ok) return;
    const raw = JSON.stringify(project.project);
    const { assetBootstrapReady, harness } = await loadStore({
      'gfx.project': raw,
    });

    await assetBootstrapReady;
    await Promise.resolve();
    expect(harness.setItem).not.toHaveBeenCalled();
    expect(harness.values.get('gfx.project')).toBe(raw);
  });

  it('does not checkpoint a migration whose asset staging fails', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new Error('corrupt image decode');
    }));
    const project = v3ProjectWithEmbeddedAsset();
    const raw = JSON.stringify(project);
    const { assetBootstrapReady, harness } = await loadStore({
      'gfx.project': raw,
    });

    await expect(assetBootstrapReady).rejects.toMatchObject({
      code: 'ASSET_POLICY_VIOLATION',
    });
    await Promise.resolve();
    expect(harness.setItem).not.toHaveBeenCalled();
    expect(harness.values.get('gfx.project')).toBe(raw);
  });

  it('never checkpoints a stale startup snapshot after an edit during staging', async () => {
    let resolveBitmap!: (bitmap: ImageBitmap) => void;
    const bitmap = new Promise<ImageBitmap>((resolve) => {
      resolveBitmap = resolve;
    });
    const createImageBitmap = vi.fn(() => bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const project = v3ProjectWithEmbeddedAsset();
    const {
      assetBootstrapReady,
      endGesture,
      harness,
      settleStorePersistence,
      useApp,
    } =
      await loadStore({
        'gfx.project': JSON.stringify(project),
      });
    await vi.waitFor(() => {
      expect(createImageBitmap).toHaveBeenCalledOnce();
    });

    const updatedFrame = { width: 777, height: 555 };
    useApp.getState().setFrame(updatedFrame);
    expect(useApp.getState()).toMatchObject({
      revision: 1,
      doc: { frame: updatedFrame },
    });
    expect(settleStorePersistence()).toBe('memory-only');
    expect(harness.setItem).not.toHaveBeenCalled();
    resolveBitmap({
      width: 1,
      height: 1,
      close: vi.fn(),
    } as unknown as ImageBitmap);
    await assetBootstrapReady;
    await Promise.resolve();

    for (const call of harness.setItem.mock.calls) {
      expect(JSON.parse(call[1])).toMatchObject({
        document: { frame: updatedFrame },
      });
    }
    await finishGesture(endGesture);
    expect(JSON.parse(harness.values.get('gfx.project')!)).toMatchObject({
      schemaVersion: 4,
      document: { frame: updatedFrame },
    });
  });

  it('keeps asset-bootstrap failure sticky across edits and Agent settlements', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new Error('corrupt image decode');
    }));
    const project = v3ProjectWithEmbeddedAsset();
    const raw = JSON.stringify(project);
    const {
      assetBootstrapReady,
      settleStorePersistence,
      useApp,
      harness,
    } = await loadStore({
      'gfx.project': raw,
    });
    await expect(assetBootstrapReady).rejects.toBeDefined();
    await vi.waitFor(() => {
      expect(useApp.getState().persistenceValidationReport).not.toBeNull();
    });
    harness.setItem.mockClear();

    useApp.getState().setFrame({ width: 701, height: 702 });
    expect(settleStorePersistence()).toBe('memory-only');
    expect(harness.setItem).not.toHaveBeenCalled();
    expect(harness.values.get('gfx.project')).toBe(raw);
    expect(useApp.getState().persistenceValidationReport).not.toBeNull();
  });
});

describe('versioned persistence and atomic import/export', () => {
  it('persists edits as a v4 envelope and leaves rollback keys intact', async () => {
    const layered = readFixture<Doc>('layered-local-storage.json');
    const { useApp, harness, endGesture } = await loadStore({
      'gfx.document.v2': JSON.stringify(layered),
    });
    harness.setItem.mockClear();
    useApp.getState().setFrame({ width: 640, height: 480 });
    await finishGesture(endGesture);
    expect(harness.setItem).toHaveBeenCalledTimes(1);
    expect(harness.setItem.mock.calls[0][0]).toBe('gfx.project');
    expect(JSON.parse(harness.setItem.mock.calls[0][1])).toMatchObject({
      format: 'a-psychos-gd-tool',
      schemaVersion: 4,
      documentId: 'document_1',
      document: { frame: { width: 640, height: 480 } },
    });
    expect(JSON.parse(harness.setItem.mock.calls[0][1])).not.toHaveProperty('revision');
    expect(useApp.getState().revision).toBe(1);
    expect(harness.removeItem).not.toHaveBeenCalled();
    expect(harness.values.has('gfx.document.v2')).toBe(true);
  });

  it('coalesces continuous edits and persists only the final gesture state', async () => {
    const project = readFixture<SerializedProjectV3>('serialized-project-v3.json');
    const { useApp, harness, endGesture } = await loadStore({
      'gfx.project': JSON.stringify(project),
    });
    harness.setItem.mockClear();

    useApp.getState().setFrame({ width: 640, height: 480 });
    useApp.getState().setFrame({ width: 700, height: 500 });
    useApp.getState().setFrame({ width: 800, height: 600 });
    expect(harness.setItem).not.toHaveBeenCalled();

    await finishGesture(endGesture);
    expect(harness.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(harness.values.get('gfx.project')!)).toMatchObject({
      document: { frame: { width: 800, height: 600 } },
    });
  });

  it('leaves every store/history/persistence reference untouched when import fails', async () => {
    const { useApp, harness } = await loadStore({});
    const before = useApp.getState();
    const listener = vi.fn();
    const unsubscribe = useApp.subscribe(listener);
    const result = await before.importProjectJson(
      '{"format":"a-psychos-gd-tool","schemaVersion":99}',
    );
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
    expect(after.revision).toBe(before.revision);
    expect(listener).not.toHaveBeenCalled();
    expect(harness.setItem).not.toHaveBeenCalled();
    expect(harness.removeItem).not.toHaveBeenCalled();
    expect(harness.clear).not.toHaveBeenCalled();
  });

  it('rejects an import when the document changes while assets are staging', async () => {
    let resolveBitmap!: (bitmap: ImageBitmap) => void;
    const bitmap = new Promise<ImageBitmap>((resolve) => {
      resolveBitmap = resolve;
    });
    const createImageBitmap = vi.fn(() => bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const { assetBootstrapReady, useApp } = await loadStore({});
    await assetBootstrapReady;
    const before = useApp.getState();
    const importing = before.importProjectJson(
      JSON.stringify(v3ProjectWithEmbeddedAsset()),
    );
    await vi.waitFor(() => {
      expect(createImageBitmap).toHaveBeenCalledOnce();
    });

    before.setFrame({ width: 909, height: 707 });
    resolveBitmap({
      width: 1,
      height: 1,
      close: vi.fn(),
    } as unknown as ImageBitmap);
    const result = await importing;

    expect(result).toMatchObject({
      ok: false,
      report: {
        errors: [expect.objectContaining({ code: 'REVISION_CONFLICT' })],
      },
    });
    expect(useApp.getState()).toMatchObject({
      revision: 1,
      doc: { frame: { width: 909, height: 707 } },
    });
  });

  it('commits a valid import once, persists once, and restores document identity on undo', async () => {
    const project = v3ProjectWithEmbeddedAsset();
    const expected = prepareProjectImport(project);
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    const { assetBootstrapReady, useApp, harness } = await loadStore({});
    await assetBootstrapReady;
    const before = useApp.getState();
    useApp.setState({
      future: [{ documentId: 'future_document', doc: before.doc }],
      selectedNodeIds: ['does_not_exist'],
    });
    harness.setItem.mockClear();
    const listener = vi.fn();
    const unsubscribe = useApp.subscribe(listener);
    const result = await useApp.getState().importProjectJson(JSON.stringify(project));
    unsubscribe();

    expect(result.ok).toBe(true);
    const imported = useApp.getState();
    expect(imported.documentId).toBe('fixture_project');
    expect(imported.doc).toEqual(expected.project.document);
    expect(imported.assets).toEqual(expected.project.assets);
    expect(imported.past).toHaveLength(1);
    expect(imported.future).toHaveLength(0);
    expect(imported.selectedNodeIds).toEqual([]);
    expect(imported.revision).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(harness.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(harness.setItem.mock.calls[0][1]))
      .toEqual(expected.project);

    imported.undo();
    expect(useApp.getState().documentId).toBe(before.documentId);
    expect(useApp.getState().doc).toBe(before.doc);
    expect(useApp.getState().assets).toBe(before.assets);
    expect(useApp.getState().revision).toBe(2);
  });

  it('recovers render asset readiness after missing startup bytes and a valid import', async () => {
    const legacyProject = v3ProjectWithEmbeddedAsset();
    const prepared = prepareProjectImport(legacyProject);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    // A v4 working save contains only the content-addressed manifest. Starting
    // with an empty repository reproduces a project whose backing bytes have
    // disappeared since it was saved.
    const {
      assetBootstrapReady,
      ensureAssetManifestReady,
      useApp,
    } = await loadStore({
      'gfx.project': JSON.stringify(prepared.project),
    });
    await expect(assetBootstrapReady).rejects.toMatchObject({
      code: 'PERSISTENCE_FAILED',
    });
    await expect(
      ensureAssetManifestReady(useApp.getState().assets),
    ).rejects.toMatchObject({
      code: 'PERSISTENCE_FAILED',
    });
    await vi.waitFor(() => {
      expect(useApp.getState().persistenceValidationReport).toMatchObject({
        valid: false,
        errors: [expect.objectContaining({ code: 'PERSISTENCE_FAILED' })],
      });
    });

    const renderService = await import('./render/appRenderService');
    const resolveImageAsset = async ({
      input,
      signal,
    }: Parameters<
      Parameters<typeof renderService.appRenderCoordinator.setExecutor>[0]
    >[0]) => {
      const imageNode = Object.values(input.document.layers[0].graph.nodes)
        .find((node) => node.type === 'Image');
      const assetId = imageNode?.params.assetId;
      if (typeof assetId !== 'string' || !input.resolveAsset) {
        throw new Error('Expected a renderable Image asset.');
      }
      await input.resolveAsset(assetId, signal);
      return {};
    };
    renderService.appRenderCoordinator.setExecutor(resolveImageAsset);
    renderService.startRenderStoreBinding();
    try {
      const missingTicket =
        renderService.appRenderCoordinator.getRenderStatus().ticket!;
      await expect(
        renderService.appRenderCoordinator.awaitRender(missingTicket),
      ).resolves.toMatchObject({
        state: 'failed',
        error: { code: 'PERSISTENCE_FAILED' },
      });

      // Importing the legacy envelope supplies and stages the embedded bytes.
      // The newly scheduled render must validate this manifest instead of
      // replaying the one-shot startup rejection forever.
      const imported = await useApp.getState().importProjectJson(
        JSON.stringify(legacyProject),
      );
      expect(imported.ok).toBe(true);
      const importedState = useApp.getState();
      await expect(
        ensureAssetManifestReady(importedState.assets),
      ).resolves.toBeUndefined();
      expect(importedState.persistenceValidationReport).toBeNull();

      const recoveredTicket =
        renderService.appRenderCoordinator.getRenderStatus().ticket!;
      await expect(
        renderService.appRenderCoordinator.awaitRender(recoveredTicket),
      ).resolves.toMatchObject({
        ticket: recoveredTicket,
        state: 'complete',
      });
    } finally {
      renderService.stopRenderStoreBinding();
      renderService.appRenderCoordinator.clearExecutor(resolveImageAsset);
    }
  });

  it('lets a valid import supersede a still-pending startup image decode', async () => {
    let resolveStartupBitmap!: (bitmap: ImageBitmap) => void;
    const startupBitmap = new Promise<ImageBitmap>((resolve) => {
      resolveStartupBitmap = resolve;
    });
    const closeStartup = vi.fn();
    const closeImported = vi.fn();
    const createImageBitmap = vi.fn()
      .mockImplementationOnce(() => startupBitmap)
      .mockResolvedValueOnce({
        width: 1,
        height: 1,
        close: closeImported,
      } as unknown as ImageBitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmap);

    const legacyProject = v3ProjectWithEmbeddedAsset();
    const {
      assetBootstrapReady,
      ensureAssetManifestReady,
      useApp,
    } = await loadStore({
      'gfx.project': JSON.stringify(legacyProject),
    });
    await vi.waitFor(() => {
      expect(createImageBitmap).toHaveBeenCalledTimes(1);
    });

    const imported = await useApp.getState().importProjectJson(
      JSON.stringify(legacyProject),
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(createImageBitmap).toHaveBeenCalledTimes(2);
    expect(closeImported).toHaveBeenCalledOnce();

    const bounded = async <T>(operation: Promise<T>): Promise<T> =>
      Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          setTimeout(
            () => reject(new Error('superseded bootstrap still blocked')),
            500,
          );
        }),
      ]);
    await expect(
      bounded(ensureAssetManifestReady(imported.project.assets)),
    ).resolves.toBeUndefined();
    const portable = await bounded(
      useApp.getState().exportPortableProjectJson(),
    );
    expect(portable.ok).toBe(true);

    resolveStartupBitmap({
      width: 1,
      height: 1,
      close: closeStartup,
    } as unknown as ImageBitmap);
    await expect(assetBootstrapReady).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(closeStartup).toHaveBeenCalledOnce();
  });

  it('exports current state without mutation or persistence', async () => {
    const project = v3ProjectWithEmbeddedAsset();
    const expected = prepareProjectImport(project);
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    const { assetBootstrapReady, useApp, harness } = await loadStore({
      'gfx.project': JSON.stringify(project),
    });
    await assetBootstrapReady;
    harness.setItem.mockClear();
    const before = useApp.getState();
    const result = before.exportProjectJson();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.json)).toEqual(expected.project);
    expect(useApp.getState()).toBe(before);
    expect(harness.setItem).not.toHaveBeenCalled();
  });

  it('carries verified image bytes to a fresh repository in a portable project', async () => {
    const legacyProject = v3ProjectWithEmbeddedAsset();
    const expected = prepareProjectImport(legacyProject, { mode: 'editable' });
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;

    const first = await loadStore({
      'gfx.project': JSON.stringify(legacyProject),
    });
    await first.assetBootstrapReady;
    first.harness.setItem.mockClear();
    const beforeExport = first.useApp.getState();
    const portable =
      await beforeExport.exportPortableProjectJson();
    expect(portable.ok).toBe(true);
    if (!portable.ok) return;
    expect(first.useApp.getState()).toBe(beforeExport);
    expect(first.harness.setItem).not.toHaveBeenCalled();
    expect(JSON.parse(portable.json)).toMatchObject({
      format: 'a-psychos-gd-tool-portable-project',
      bundleVersion: 1,
      project: expected.project,
      assets: [{
        assetId: expected.project.assets?.[0].id,
        dataBase64: expect.any(String),
      }],
    });

    // Resetting modules creates a separate empty in-memory repository, which
    // models importing the file in another browser origin.
    const second = await loadStore({});
    await second.assetBootstrapReady;
    second.harness.setItem.mockClear();
    const imported =
      await second.useApp.getState().importProjectJson(portable.json);
    expect(imported).toMatchObject({
      ok: true,
      source: 'portable-project-v1',
    });
    if (!imported.ok) return;
    await expect(
      second.ensureAssetManifestReady(imported.project.assets),
    ).resolves.toBeUndefined();
    expect(second.useApp.getState().assets)
      .toEqual(expected.project.assets);
    expect(second.harness.setItem).toHaveBeenCalledTimes(1);
    const workingSave = second.harness.values.get('gfx.project')!;
    expect(JSON.parse(workingSave)).toEqual(expected.project);
    expect(workingSave).not.toContain('dataBase64');
  });

  it('uses the revision captured before a project file is read', async () => {
    const project = readFixture<SerializedProjectV3>(
      'serialized-project-v3.json',
    );
    const { assetBootstrapReady, useApp } = await loadStore({});
    await assetBootstrapReady;
    const expectedRevision = useApp.getState().revision;
    useApp.getState().setFrame({ width: 777, height: 555 });

    const result = await useApp.getState().importProjectJson(
      JSON.stringify(project),
      undefined,
      expectedRevision,
    );
    expect(result).toMatchObject({
      ok: false,
      report: {
        errors: [expect.objectContaining({
          code: 'REVISION_CONFLICT',
        })],
      },
    });
    expect(useApp.getState()).toMatchObject({
      revision: expectedRevision + 1,
      doc: { frame: { width: 777, height: 555 } },
    });
  });

  it('cleans newly stored UI bytes when manifest publication is rejected', async () => {
    const { assetBootstrapReady, useApp } = await loadStore({});
    const { appAssetService } = await import('./assets/assetService');
    await assetBootstrapReady;
    useApp.setState({ revision: Number.MAX_SAFE_INTEGER });
    const bytes = new Uint8Array(
      Buffer.from(ONE_PIXEL_PNG.split(',')[1]!, 'base64'),
    );

    await expect(
      useApp.getState().putAssetBytes(bytes, 'image/png'),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    await expect(appAssetService.repository.listIds()).resolves.toEqual([]);
  });

  it('retains the last durable manifest after a later save fails', async () => {
    const project = v3ProjectWithEmbeddedAsset();
    const {
      assetBootstrapReady,
      getStoreRetainedAssetIds,
      harness,
      useApp,
    } = await loadStore({
      'gfx.project': JSON.stringify(project),
    });
    await assetBootstrapReady;
    await vi.waitFor(() => {
      expect(harness.setItem).toHaveBeenCalled();
    });
    const durableAssetId = useApp.getState().assets?.[0]?.id;
    expect(durableAssetId).toBeTruthy();
    harness.setItem.mockImplementation(() => {
      throw new Error('quota');
    });

    useApp.setState({
      assets: undefined,
      past: [],
      future: [],
    });
    expect(getStoreRetainedAssetIds()).toContain(durableAssetId);
  });

  it('round-trips editable Output drafts through local working storage', async () => {
    const project = readFixture<SerializedProjectV3>('serialized-project-v3.json');
    const first = await loadStore({ 'gfx.project': JSON.stringify(project) });
    first.harness.setItem.mockClear();
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
    const { useApp, harness, endGesture } = await loadStore({
      'gfx.project': JSON.stringify(project),
    });
    useApp.getState().addNode('Weight', { x: 0, y: 0 });
    const weightId = useApp.getState().selectedNodeIds[0];
    const safeSave = harness.values.get('gfx.project');
    harness.setItem.mockClear();

    useApp.getState().setParam(weightId, 'expr', 'process.exit(');
    await finishGesture(endGesture);
    expect(useApp.getState().revision).toBe(2);
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
    await finishGesture(endGesture);
    expect(useApp.getState().revision).toBe(3);
    expect(useApp.getState().persistenceValidationReport).toBeNull();
    expect(harness.setItem).toHaveBeenCalledTimes(1);
  });

  it('surfaces browser storage failures and retries on the next safe edit', async () => {
    const project = readFixture<SerializedProjectV3>('serialized-project-v3.json');
    const { useApp, harness, endGesture } = await loadStore({
      'gfx.project': JSON.stringify(project),
    });
    const safeSave = harness.values.get('gfx.project');
    expect(JSON.parse(safeSave!)).toMatchObject({ schemaVersion: 4 });
    harness.setItem.mockClear();
    harness.setItem.mockImplementationOnce(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    useApp.getState().setFrame({ width: 640, height: 480 });
    await finishGesture(endGesture);

    expect(harness.values.get('gfx.project')).toBe(safeSave);
    expect(useApp.getState().persistenceValidationReport).toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ code: 'PERSISTENCE_FAILED' })],
    });

    useApp.getState().setFrame({ width: 800, height: 600 });
    await finishGesture(endGesture);
    expect(useApp.getState().persistenceValidationReport).toBeNull();
    expect(JSON.parse(harness.values.get('gfx.project')!)).toMatchObject({
      document: { frame: { width: 800, height: 600 } },
    });
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
    useApp.getState().setParam(
      imageId,
      'assetId',
      'https://tracker.invalid/pixel.gif',
    );
    const after = useApp.getState();
    expect(after).toBe(before);
    expect(harness.setItem).not.toHaveBeenCalled();
  });

  it('persists the first Agent commit once but not dry-runs, failures, or replays', async () => {
    const project = readFixture<SerializedProjectV3>('serialized-project-v3.json');
    const { useApp, harness } = await loadStore({
      'gfx.project': JSON.stringify(project),
    });
    harness.setItem.mockClear();
    const request = {
      requestId: 'persistence_agent_commit',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    };
    const committed = useApp.getState().applyTransaction(request);
    expect(committed).toMatchObject({ ok: true, revision: 1 });
    expect(harness.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(harness.setItem.mock.calls[0][1])).not.toHaveProperty('revision');

    expect(useApp.getState().applyTransaction(request)).toEqual(committed);
    useApp.getState().applyTransaction({
      requestId: 'persistence_agent_dry',
      expectedRevision: 1,
      dryRun: true,
      commands: [{ op: 'set_frame', width: 800, height: 600 }],
    });
    useApp.getState().applyTransaction({
      requestId: 'persistence_agent_failure',
      expectedRevision: 1,
      commands: [{
        op: 'add_node',
        layerId: 'missing',
        clientRef: 'shape',
        nodeType: 'Shape',
      }],
    });
    expect(harness.setItem).toHaveBeenCalledTimes(1);
    expect(useApp.getState().revision).toBe(1);
  });

  it('settles a committed Agent asset manifest as durable', async () => {
    const prepared = prepareProjectImport(v3ProjectWithEmbeddedAsset());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const metadata = prepared.project.assets?.[0];
    expect(metadata).toBeDefined();
    if (!metadata) return;
    const project = readFixture<SerializedProjectV3>('serialized-project-v3.json');
    const {
      applyStoreAssetMutation,
      settleStorePersistence,
      useApp,
      harness,
    } = await loadStore({
      'gfx.project': JSON.stringify(project),
    });
    const { TransactionSession } = await import('./domain/transactionSession');
    harness.setItem.mockClear();

    const committed = applyStoreAssetMutation(
      new TransactionSession(),
      {
        kind: 'asset-put',
        requestId: 'settle_asset_durable',
        fingerprint: 'b'.repeat(64),
        expectedRevision: 0,
        metadata,
      },
    );
    expect(committed).toMatchObject({
      ok: true,
      committed: true,
      revision: 1,
      changed: { assetIds: [metadata.id] },
    });
    const committedState = useApp.getState();
    expect(committedState.assets).toEqual([metadata]);

    harness.setItem.mockClear();
    expect(settleStorePersistence()).toBe('durable');
    expect(harness.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(harness.setItem.mock.calls[0][1])).toMatchObject({
      assets: [metadata],
    });
    expect(useApp.getState().revision).toBe(1);
    expect(useApp.getState().assets).toBe(committedState.assets);
  });

  it('settles quota-rejected Agent asset persistence as memory-only without rollback', async () => {
    const prepared = prepareProjectImport(v3ProjectWithEmbeddedAsset());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const metadata = prepared.project.assets?.[0];
    expect(metadata).toBeDefined();
    if (!metadata) return;
    const project = readFixture<SerializedProjectV3>('serialized-project-v3.json');
    const {
      applyStoreAssetMutation,
      settleStorePersistence,
      useApp,
      harness,
    } = await loadStore({
      'gfx.project': JSON.stringify(project),
    });
    const { TransactionSession } = await import('./domain/transactionSession');
    harness.setItem.mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    const committed = applyStoreAssetMutation(
      new TransactionSession(),
      {
        kind: 'asset-put',
        requestId: 'settle_asset_memory_only',
        fingerprint: 'c'.repeat(64),
        expectedRevision: 0,
        metadata,
      },
    );
    expect(committed).toMatchObject({
      ok: true,
      committed: true,
      revision: 1,
      changed: { assetIds: [metadata.id] },
    });
    const committedAssets = useApp.getState().assets;

    expect(settleStorePersistence()).toBe('memory-only');
    expect(useApp.getState().revision).toBe(1);
    expect(useApp.getState().assets).toBe(committedAssets);
    expect(committedAssets).toEqual([metadata]);
    expect(useApp.getState().persistenceValidationReport).toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ code: 'PERSISTENCE_FAILED' })],
    });
  });
});
