// App state: the document — an ordered stack of layers, each one a full node
// graph — is the single source of truth. The xyflow editor renders the active
// layer's graph and writes edits back through these actions; the evaluator
// only ever reads it.

import { create } from 'zustand';
import * as opentype from 'opentype.js';
import type { Font } from 'opentype.js';
import { appAssetService } from './assets/assetService';
import {
  DEFAULT_FRAME,
  edgeKey,
  hasPath,
  type Doc,
  type Frame,
  type Graph,
  type Layer,
  type NodeId,
  type ParamValue,
} from './engine/graph';
import { canConnect } from './engine/registry';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_DOCUMENT_ID,
  createSerializedProject,
  type AssetMetadata,
  type SerializedProject,
} from './domain/documentSchema';
import type { ValidationReport } from './domain/agentErrors';
import type { PreparedAsset } from './domain/assetPolicy';
import type { AssetMimeType } from './domain/assetPolicy';
import { sha256Hex } from './domain/sha256';
import type {
  CommandApplication,
  DocumentCommand,
  LayerPatch,
  RuntimeDocumentState,
  TransactionResult,
} from './domain/commandTypes';
import { applyTrustedUiCommands } from './domain/commands';
import {
  exportDocumentJson,
  exportPortableProjectJson as encodePortableProjectJson,
  importProjectJson as decodeProjectJson,
  prepareProjectImport,
  type ProjectExportResult,
  type ProjectImportResult,
} from './domain/projectCodec';
import { validateSerializedProject } from './domain/semanticValidation';
import {
  TransactionSession,
  type SessionFinalizeToken,
  type TrustedAssetMutation,
  type TransactionPolicy,
} from './domain/transactionSession';
import { blankDoc } from './blankDoc';
import { registry } from './nodes';
import { extractFace, faceCount } from './util/sfnt';

// Local Font Access API (Chromium) — not in the default TS lib.
interface FontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
}
declare global {
  interface Window {
    queryLocalFonts?: () => Promise<FontData[]>;
  }
}

// raw queryable font files, keyed by family — kept out of reactive state since
// FontData isn't serializable and is only needed to parse a font on demand
let localFontData = new Map<string, FontData>();
// families whose font file failed to parse — remembered so re-cooks don't
// refetch and refail the same file on every graph edit
const failedFonts = new Set<string>();
export function getLocalFontData(family: string): FontData | undefined {
  return localFontData.get(family);
}
export const localFontsSupported = typeof window !== 'undefined' && 'queryLocalFonts' in window;

/** Load local fonts at startup when access was granted in a previous session.
 * queryLocalFonts only needs a user gesture for the initial permission prompt,
 * so once granted the list can be rebuilt silently on every launch. */
export async function loadLocalFontsIfGranted(): Promise<void> {
  if (!localFontsSupported) return;
  try {
    const status = await navigator.permissions.query({ name: 'local-fonts' as PermissionName });
    if (status.state !== 'granted') return;
    await useApp.getState().loadLocalFonts();
  } catch {
    // permission not queryable or access revoked mid-flight — the font
    // picker's ⤓ button still prompts on demand
  }
}

// The working document persists to localStorage, so the current set-up IS the
// default on next load. Continuous edits are debounced to keep serialization
// and browser storage off drag/scrub hot paths. A minimal blank document is the
// first-run (or unreadable-save) fallback. v1 saves held a single graph — they
// load as a one-layer document; v1 is left in place for older builds.
export const PROJECT_STORAGE_KEY = 'gfx.project';
export const LAYERED_STORAGE_KEY = 'gfx.document.v2';
export const LEGACY_STORAGE_KEY = 'gfx.document.v1';
const persistenceStorage = typeof localStorage === 'undefined' ? null : localStorage;
const canPersist = persistenceStorage !== null;

export interface StartupLoadIssue {
  storageKey: string;
  report: ValidationReport;
}

interface SavedProjectLoad {
  project: SerializedProject | null;
  assetsToStage: PreparedAsset[];
  source: Extract<ProjectImportResult, { ok: true }>['source'] | null;
  issue: StartupLoadIssue | null;
}

function decodeSavedCandidate(
  storageKey: string,
  raw: string,
  legacy: boolean,
): SavedProjectLoad {
  const imported = decodeProjectJson(raw, {
    mode: 'editable',
    ...(legacy ? { documentIdForLegacy: DEFAULT_DOCUMENT_ID } : {}),
  });
  return imported.ok
    ? {
        project: imported.project,
        assetsToStage: imported.assetsToStage,
        source: imported.source,
        issue: null,
      }
    : {
        project: null,
        assetsToStage: [],
        source: null,
        issue: { storageKey, report: imported.report },
      };
}

function loadSavedProject(): SavedProjectLoad {
  if (!canPersist) {
    return {
      project: null,
      assetsToStage: [],
      source: null,
      issue: null,
    };
  }
  try {
    const current = persistenceStorage.getItem(PROJECT_STORAGE_KEY);
    if (current !== null) {
      return decodeSavedCandidate(PROJECT_STORAGE_KEY, current, false);
    }

    const layered = persistenceStorage.getItem(LAYERED_STORAGE_KEY);
    if (layered !== null) {
      return decodeSavedCandidate(LAYERED_STORAGE_KEY, layered, true);
    }

    const legacy = persistenceStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== null) {
      return decodeSavedCandidate(LEGACY_STORAGE_KEY, legacy, true);
    }
    return {
      project: null,
      assetsToStage: [],
      source: null,
      issue: null,
    };
  } catch {
    return {
      project: null,
      assetsToStage: [],
      source: null,
      issue: {
        storageKey: PROJECT_STORAGE_KEY,
        report: storageReadFailureReport(),
      },
    };
  }
}

const blankProject = prepareProjectImport(blankDoc, {
  documentIdForLegacy: DEFAULT_DOCUMENT_ID,
});
if (!blankProject.ok) {
  throw new Error(`Blank document failed validation: ${blankProject.report.errors[0]?.code ?? 'INTERNAL'}`);
}
const savedProject = loadSavedProject();
let lastDurableAssetIds = new Set(
  (savedProject.project?.assets ?? []).map((asset) => asset.id),
);
const initialProject = savedProject.project ?? blankProject.project;
const initialAssetsToStage = savedProject.project
  ? savedProject.assetsToStage
  : blankProject.assetsToStage;
let assetBootstrapStatus: 'pending' | 'ready' | 'failed' = 'pending';
let startupBootstrapSuperseded = false;
const startupBootstrapAbort = new AbortController();
let resolveStartupBootstrapSuperseded!: () => void;
let startupBootstrapSupersededResolved = false;
const startupBootstrapSupersededGate = new Promise<void>((resolve) => {
  resolveStartupBootstrapSuperseded = resolve;
});
const releaseInitialAssetRetention =
  appAssetService.registerRetentionProvider(
    () => (initialProject.assets ?? []).map((asset) => asset.id),
  );
function signalStartupBootstrapSuperseded(): void {
  startupBootstrapSuperseded = true;
  assetBootstrapStatus = 'ready';
  startupBootstrapAbort.abort();
  releaseInitialAssetRetention();
  if (startupBootstrapSupersededResolved) return;
  startupBootstrapSupersededResolved = true;
  resolveStartupBootstrapSuperseded();
}
export const assetBootstrapReady = (async () => {
  let staged:
    Awaited<ReturnType<typeof appAssetService.stagePreparedAssets>>
    | undefined;
  try {
    staged = await appAssetService.stagePreparedAssets(
      initialAssetsToStage,
      startupBootstrapAbort.signal,
    );
    await appAssetService.ensureManifestAvailable(
      initialProject.assets,
      startupBootstrapAbort.signal,
    );
    if (!startupBootstrapSuperseded) assetBootstrapStatus = 'ready';
  } catch (error) {
    if (!startupBootstrapSuperseded) assetBootstrapStatus = 'failed';
    throw error;
  } finally {
    staged?.releaseRetention();
    releaseInitialAssetRetention();
  }
})();

async function waitForStartupBootstrap(
  signal?: AbortSignal,
): Promise<void> {
  if (startupBootstrapSuperseded) return;
  if (signal?.aborted) {
    if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
    throw new DOMException('Asset readiness was aborted.', 'AbortError');
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      reject(
        signal?.reason
        ?? new DOMException('Asset readiness was aborted.', 'AbortError'),
      );
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    void assetBootstrapReady.then(finish, finish);
    void startupBootstrapSupersededGate.then(finish);
  });
}

/**
 * Wait for startup staging to settle, then validate the manifest belonging to
 * the render snapshot that is actually being cooked. A failed startup project
 * remains unavailable, but its rejected bootstrap promise must not poison
 * later projects whose bytes have been imported successfully.
 */
export async function ensureAssetManifestReady(
  manifest: readonly AssetMetadata[] | undefined,
  signal?: AbortSignal,
): Promise<void> {
  await waitForStartupBootstrap(signal);
  await appAssetService.ensureManifestAvailable(manifest, signal);
}
const initialDoc: Doc = initialProject.document;

export interface WireSpec {
  source: NodeId;
  sourceHandle: string;
  target: NodeId;
  targetHandle: string;
}

/** Type equality + acyclicity. Pure — used both for live drag feedback and on connect. */
export function wireIsValid(graph: Graph, w: WireSpec): boolean {
  const fromNode = graph.nodes[w.source];
  const toNode = graph.nodes[w.target];
  if (!fromNode || !toNode) return false;
  const fromSpec = registry.get(fromNode.type)?.outputs.find((s) => s.name === w.sourceHandle);
  const toSpec = registry.get(toNode.type)?.inputs.find((s) => s.name === w.targetHandle);
  if (!fromSpec || !toSpec) return false;
  if (!canConnect(fromSpec, toSpec)) return false; // never coerced (unions are membership, not coercion)
  return !hasPath(graph, w.target, w.source); // no cycles
}

// Undo history: whole-graph snapshots. Graph edits are immutable updates that
// share structure, so a snapshot is one object reference — cheap to keep.
// Continuous edits (a param scrub, a node drag, typing in a field) coalesce
// into one undo step: repeats of the same edit key inside the window ride on
// the snapshot already pushed.
const HISTORY_LIMIT = 100;
const COALESCE_MS = 1000;
let lastEdit: { key: string; time: number } | null = null;
let scheduleGestureEndAutosave: () => void = () => {};

/** Close the current coalescing run — the next edit starts a fresh undo step.
 * Called on gesture boundaries (pointer-up on a number scrub). */
export function endGesture(): void {
  lastEdit = null;
  scheduleGestureEndAutosave();
}

interface DocumentSnapshot {
  documentId: string;
  doc: Doc;
  assets?: AssetMetadata[];
}

export interface AppStore {
  /** Stable persisted identity. Runtime revision is deliberately separate. */
  documentId: string;
  doc: Doc;
  /** Monotonic session revision; never persisted or restored from history. */
  revision: number;
  /** Versioned asset metadata is preserved even before PR 7 adds asset storage. */
  assets?: AssetMetadata[];
  /** A rejected saved value remains in storage; this report explains the fallback. */
  startupLoadIssue: StartupLoadIssue | null;
  /** Current editable state is kept in memory but not autosaved until this is fixed. */
  persistenceValidationReport: ValidationReport | null;
  /** the layer whose graph the node editor shows and edits — always a live id */
  activeLayerId: string;
  /** the selected nodes, in selection order — one entry for a plain click, many for a marquee */
  selectedNodeIds: NodeId[];
  /** undo/redo stacks of document snapshots — selection and fonts stay out of history */
  past: DocumentSnapshot[];
  future: DocumentSnapshot[];
  undo: () => void;
  redo: () => void;
  /** parsed fonts ready to cook, keyed by font key ('default' + local families) */
  fonts: Record<string, Font>;
  /** family names of the user's local fonts, available to load on demand */
  localFonts: string[];
  select: (ids: NodeId[]) => void;
  setFrame: (frame: Frame) => void;
  setParam: (nodeId: NodeId, name: string, value: ParamValue) => void;
  /** one call moves the whole dragged set, so a group drag is a single undo step */
  moveNodes: (positions: Record<NodeId, { x: number; y: number }>) => void;
  addNode: (type: string, position: { x: number; y: number }) => NodeId | null;
  removeNodes: (ids: NodeId[]) => void;
  /** Structured result is shared by pointer wiring and the keyboard inspector. */
  connect: (w: WireSpec) => TransactionResult;
  removeEdges: (edgeKeys: string[]) => void;
  selectLayer: (id: string) => void;
  /** insert a fresh layer (transparent Output, empty otherwise) above the active one */
  addLayer: () => void;
  /** refuses to remove the last layer — the document always has one */
  removeLayer: (id: string) => void;
  /** +1 raises the layer in the stack, -1 lowers it; no-op at the ends */
  moveLayer: (id: string, dir: 1 | -1) => void;
  /** drag-and-drop reorder: place a layer at an absolute stack index (0 = bottom) */
  moveLayerTo: (id: string, to: number) => void;
  updateLayer: (id: string, patch: Partial<Pick<Layer, 'name' | 'visible' | 'opacity' | 'blendMode'>>) => void;
  addFont: (key: string, font: Font) => void;
  /** parse a queryable local font (by family) into the cookable fonts map */
  loadLocalFont: (family: string) => Promise<void>;
  /** prompt for local font access and list the available families */
  loadLocalFonts: () => Promise<void>;
  /** Store validated image bytes, then publish only their content-addressed metadata. */
  putAssetBytes: (
    bytes: Uint8Array,
    mimeType: AssetMimeType,
  ) => Promise<AssetMetadata>;
  /** Validate and atomically replace the current project, or leave all state untouched. */
  importProjectJson: (
    json: string,
    documentIdForLegacy?: string,
    expectedRevision?: number,
  ) => Promise<ProjectImportResult>;
  /** Validate and serialize the current project without changing state or persistence. */
  exportProjectJson: () => ProjectExportResult;
  /**
   * Create a human-downloadable project bundle with all non-bundled asset
   * bytes. This does not grant the Agent filesystem or document-replace access.
   */
  exportPortableProjectJson: () => Promise<ProjectExportResult>;
  /** Strict, revision-checked, idempotent Agent mutation boundary. */
  applyTransaction: (request: unknown) => TransactionResult;
  /** Revert only a compatible transaction created in this runtime session. */
  revertTransaction: (request: unknown) => TransactionResult;
}

/** The graph the node editor is looking at — the active layer's. */
export function selectActiveGraph(s: Pick<AppStore, 'doc' | 'activeLayerId'>): Graph {
  return (s.doc.layers.find((l) => l.id === s.activeLayerId) ?? s.doc.layers[s.doc.layers.length - 1]).graph;
}

/** After swapping in a document (undo/redo), keep active layer + selection pointing at things that exist. */
function revalidate(s: AppStore, doc: Doc): Pick<AppStore, 'activeLayerId' | 'selectedNodeIds'> {
  const existing = doc.layers.find((layer) => layer.id === s.activeLayerId);
  const layer = existing ?? doc.layers[doc.layers.length - 1];
  return {
    activeLayerId: layer.id,
    selectedNodeIds: existing
      ? s.selectedNodeIds.filter((id) => Object.hasOwn(layer.graph.nodes, id))
      : [],
  };
}

function runtimeDocumentState(
  state: Pick<AppStore, 'documentId' | 'doc' | 'assets' | 'revision'>,
): RuntimeDocumentState {
  return {
    documentId: state.documentId,
    document: state.doc,
    assets: state.assets,
    revision: state.revision,
  };
}

function runUiCommands(
  state: AppStore,
  commands: DocumentCommand[],
): CommandApplication {
  return applyTrustedUiCommands(runtimeDocumentState(state), commands);
}

export function previewWireConnection(
  state: AppStore,
  wire: WireSpec,
): TransactionResult {
  return runUiCommands(state, [{
    op: 'connect',
    layerId: state.activeLayerId,
    from: { nodeId: wire.source, socket: wire.sourceHandle },
    to: { nodeId: wire.target, socket: wire.targetHandle },
    replaceExisting: true,
  }]).result;
}

function applyUiCommands(
  state: AppStore,
  commands: DocumentCommand[],
): RuntimeDocumentState | null {
  return runUiCommands(state, commands).next ?? null;
}

const transactionSession = new TransactionSession();
const trustedUiAssetSession = new TransactionSession();
let nextTrustedUiAssetRequest = 1;

function transactionHostFailure(
  revision: number,
  requestId: string | undefined,
  message = 'The host could not atomically commit the prepared transaction.',
): TransactionResult {
  return {
    ok: false,
    ...(requestId ? { requestId } : {}),
    revision,
    error: {
      code: 'INTERNAL',
      message,
      recoverable: false,
    },
  };
}

/** The history push that precedes a document edit. A `key` marks the edit as
 * continuous: repeats inside the coalescing window reuse the snapshot already
 * pushed. Discrete edits pass null and always snapshot. */
function buildHistorySnapshot(
  s: AppStore,
): Pick<AppStore, 'past' | 'future'> {
  return {
    past: [...s.past.slice(1 - HISTORY_LIMIT), {
      documentId: s.documentId,
      doc: s.doc,
      assets: s.assets,
    }],
    future: [],
  };
}

function pushHistory(s: AppStore, key: string | null): Pick<AppStore, 'past' | 'future'> | undefined {
  if (!key) {
    lastEdit = null;
    return buildHistorySnapshot(s);
  }
  const now = Date.now();
  if (key && lastEdit && lastEdit.key === key && now - lastEdit.time < COALESCE_MS) {
    lastEdit.time = now;
    return undefined;
  }
  lastEdit = { key, time: now };
  return buildHistorySnapshot(s);
}

export const useApp = create<AppStore>((set, get) => ({
  documentId: initialProject.documentId,
  doc: initialDoc,
  revision: 0,
  assets: initialProject.assets,
  startupLoadIssue: savedProject.issue,
  persistenceValidationReport: null,
  activeLayerId: initialDoc.layers[initialDoc.layers.length - 1].id,
  selectedNodeIds: [],
  past: [],
  future: [],
  fonts: {},
  localFonts: [],

  select: (ids) => set({ selectedNodeIds: [...ids] }),

  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev || s.revision >= Number.MAX_SAFE_INTEGER) return s;
      endGesture();
      return {
        past: s.past.slice(0, -1),
        future: [...s.future, {
          documentId: s.documentId,
          doc: s.doc,
          assets: s.assets,
        }],
        documentId: prev.documentId,
        doc: prev.doc,
        assets: prev.assets,
        revision: s.revision + 1,
        ...revalidate(s, prev.doc),
      };
    }),

  redo: () =>
    set((s) => {
      const next = s.future[s.future.length - 1];
      if (!next || s.revision >= Number.MAX_SAFE_INTEGER) return s;
      endGesture();
      return {
        future: s.future.slice(0, -1),
        past: [...s.past, {
          documentId: s.documentId,
          doc: s.doc,
          assets: s.assets,
        }],
        documentId: next.documentId,
        doc: next.doc,
        assets: next.assets,
        revision: s.revision + 1,
        ...revalidate(s, next.doc),
      };
    }),

  setFrame: (frame) =>
    set((s) => {
      const next = applyUiCommands(s, [{
        op: 'set_frame',
        width: Math.max(16, Math.min(4096, Math.round(frame.width) || DEFAULT_FRAME.width)),
        height: Math.max(16, Math.min(4096, Math.round(frame.height) || DEFAULT_FRAME.height)),
      }]);
      if (!next) return s;
      return {
        ...pushHistory(s, 'frame'),
        doc: next.document,
        revision: next.revision,
      };
    }),

  setParam: (nodeId, name, value) =>
    set((s) => {
      const next = applyUiCommands(s, [{
        op: 'set_node_params',
        layerId: s.activeLayerId,
        nodeId,
        patch: { [name]: value },
      }]);
      if (!next) return s;
      return {
        ...pushHistory(s, `param:${s.activeLayerId}:${nodeId}:${name}`),
        doc: next.document,
        revision: next.revision,
      };
    }),

  moveNodes: (positions) =>
    set((s) => {
      const graph = selectActiveGraph(s);
      const ids = Object.keys(positions).filter((id) => Object.hasOwn(graph.nodes, id));
      if (!ids.length) return s;
      const next = applyUiCommands(s, [{
        op: 'move_nodes',
        layerId: s.activeLayerId,
        positions: ids.map((nodeId) => ({
          nodeId,
          position: { ...positions[nodeId] },
        })),
      }]);
      if (!next) return s;
      // the dragged set is stable for the whole gesture, so keying on it
      // coalesces every step of a group drag into one undo snapshot
      return {
        ...pushHistory(s, `move:${s.activeLayerId}:${ids.sort().join(',')}`),
        doc: next.document,
        revision: next.revision,
      };
    }),

  addNode: (type, position) => {
    let createdId: NodeId | null = null;
    set((s) => {
      const application = runUiCommands(s, [{
        op: 'add_node',
        layerId: s.activeLayerId,
        clientRef: 'created_node',
        nodeType: type,
        position: { ...position },
      }]);
      if (!application.next || !application.result.ok) return s;
      createdId = application.result.created.created_node ?? null;
      if (!createdId) return s;
      return {
        ...pushHistory(s, null),
        doc: application.next.document,
        revision: application.next.revision,
        selectedNodeIds: [createdId],
      };
    });
    return createdId;
  },

  removeNodes: (ids) =>
    set((s) => {
      const graph = selectActiveGraph(s);
      const uniqueIds = [...new Set(ids)].filter((id) => Object.hasOwn(graph.nodes, id));
      if (uniqueIds.length === 0) return s;
      const next = applyUiCommands(s, [{
        op: 'remove_nodes',
        layerId: s.activeLayerId,
        nodeIds: uniqueIds,
      }]);
      if (!next) return s;
      const drop = new Set(uniqueIds);
      return {
        ...pushHistory(s, null),
        doc: next.document,
        revision: next.revision,
        selectedNodeIds: s.selectedNodeIds.filter((id) => !drop.has(id)),
      };
    }),

  connect: (w) => {
    let result: TransactionResult = transactionHostFailure(
      get().revision,
      undefined,
    );
    set((s) => {
      const application = runUiCommands(s, [{
        op: 'connect',
        layerId: s.activeLayerId,
        from: { nodeId: w.source, socket: w.sourceHandle },
        to: { nodeId: w.target, socket: w.targetHandle },
        replaceExisting: true,
      }]);
      result = application.result;
      if (!application.next || !application.result.ok) return s;
      return {
        ...pushHistory(s, null),
        doc: application.next.document,
        revision: application.next.revision,
      };
    });
    return result;
  },

  removeEdges: (keys) =>
    set((s) => {
      const drop = new Set(keys);
      const commands: DocumentCommand[] = [];
      const targets = new Set<string>();
      for (const edge of selectActiveGraph(s).edges) {
        if (!drop.has(edgeKey(edge))) continue;
        const targetKey = JSON.stringify([edge.to.node, edge.to.socket]);
        if (targets.has(targetKey)) continue;
        targets.add(targetKey);
        commands.push({
          op: 'disconnect',
          layerId: s.activeLayerId,
          to: { nodeId: edge.to.node, socket: edge.to.socket },
        });
      }
      if (commands.length === 0) return s;
      const next = applyUiCommands(s, commands);
      if (!next) return s;
      return {
        ...pushHistory(s, null),
        doc: next.document,
        revision: next.revision,
      };
    }),

  selectLayer: (id) =>
    set((s) => {
      if (s.activeLayerId === id || !s.doc.layers.some((l) => l.id === id)) return s;
      // switching layers is a view change, not a document edit — no history
      return { activeLayerId: id, selectedNodeIds: [] };
    }),

  addLayer: () =>
    set((s) => {
      const application = runUiCommands(s, [{
        op: 'add_layer',
        clientRef: 'created_layer',
        afterLayerId: s.activeLayerId,
      }]);
      if (!application.next || !application.result.ok) return s;
      const id = application.result.created.created_layer;
      if (!id) return s;
      return {
        ...pushHistory(s, null),
        doc: application.next.document,
        revision: application.next.revision,
        activeLayerId: id,
        selectedNodeIds: [],
      };
    }),

  removeLayer: (id) =>
    set((s) => {
      if (s.doc.layers.length <= 1) return s;
      const at = s.doc.layers.findIndex((l) => l.id === id);
      if (at === -1) return s;
      const next = applyUiCommands(s, [{ op: 'remove_layer', layerId: id }]);
      if (!next) return s;
      const active = s.activeLayerId === id
        ? next.document.layers[Math.min(at, next.document.layers.length - 1)].id
        : s.activeLayerId;
      return {
        ...pushHistory(s, null),
        doc: next.document,
        revision: next.revision,
        activeLayerId: active,
        selectedNodeIds: s.activeLayerId === id ? [] : s.selectedNodeIds,
      };
    }),

  moveLayer: (id, dir) =>
    set((s) => {
      const at = s.doc.layers.findIndex((l) => l.id === id);
      const to = at + dir;
      if (at === -1 || to < 0 || to >= s.doc.layers.length) return s;
      const next = applyUiCommands(s, [{ op: 'move_layer', layerId: id, index: to }]);
      if (!next) return s;
      return {
        ...pushHistory(s, null),
        doc: next.document,
        revision: next.revision,
      };
    }),

  moveLayerTo: (id, to) =>
    set((s) => {
      const at = s.doc.layers.findIndex((l) => l.id === id);
      if (at === -1) return s;
      const clamped = Math.max(0, Math.min(s.doc.layers.length - 1, to));
      if (clamped === at) return s;
      const next = applyUiCommands(s, [{
        op: 'move_layer',
        layerId: id,
        index: clamped,
      }]);
      if (!next) return s;
      return {
        ...pushHistory(s, null),
        doc: next.document,
        revision: next.revision,
      };
    }),

  updateLayer: (id, patch) =>
    set((s) => {
      if (!s.doc.layers.some((l) => l.id === id)) return s;
      const commandPatch: LayerPatch = {};
      if (patch.name !== undefined) commandPatch.name = patch.name;
      if (patch.visible !== undefined) commandPatch.visible = patch.visible;
      if (patch.opacity !== undefined) commandPatch.opacity = patch.opacity;
      if (patch.blendMode !== undefined) commandPatch.blendMode = patch.blendMode;
      if (Object.keys(commandPatch).length === 0) return s;
      const next = applyUiCommands(s, [{
        op: 'update_layer',
        layerId: id,
        patch: commandPatch,
      }]);
      if (!next) return s;
      // opacity scrubs and name typing coalesce into one undo step each
      const key = 'opacity' in patch ? `layer:${id}:opacity` : 'name' in patch ? `layer:${id}:name` : null;
      return {
        ...pushHistory(s, key),
        doc: next.document,
        revision: next.revision,
      };
    }),

  addFont: (key, font) => set((s) => ({ fonts: { ...s.fonts, [key]: font } })),

  loadLocalFont: async (family) => {
    if (get().fonts[family] || failedFonts.has(family)) return;
    const fd = localFontData.get(family);
    if (!fd) return;
    try {
      // many macOS families ship as .ttc collections — pick the face whose
      // postscript name matches the queried one, else the first that parses
      const buf = await (await fd.blob()).arrayBuffer();
      let font: Font | null = null;
      for (let i = 0; i < faceCount(buf); i++) {
        try {
          const face = opentype.parse(extractFace(buf, i));
          font ??= face;
          const names = face.names.postScriptName ?? {};
          if (Object.values(names).includes(fd.postscriptName)) {
            font = face;
            break;
          }
        } catch {
          // a broken face shouldn't sink the whole collection
        }
      }
      if (!font) throw new Error('no parseable face in font file');
      set((s) => ({ fonts: { ...s.fonts, [family]: font as Font } }));
    } catch {
      failedFonts.add(family);
      console.error('A local font failed to load.');
    }
  },

  loadLocalFonts: async () => {
    if (!window.queryLocalFonts) return;
    const data = await window.queryLocalFonts();
    const map = new Map<string, FontData>();
    // one entry per family; the Regular style wins over whichever came first
    for (const fd of data) {
      const cur = map.get(fd.family);
      if (!cur || (cur.style !== 'Regular' && fd.style === 'Regular')) map.set(fd.family, fd);
    }
    localFontData = map;
    set({ localFonts: [...map.keys()].sort((a, b) => a.localeCompare(b)) });
  },

  putAssetBytes: async (bytes, mimeType) => {
    const prepared = await appAssetService.prepareAndStore({
      bytes,
      mimeType,
      source: 'upload',
    });
    let published = false;
    try {
      const expectedRevision = get().revision;
      const requestId = `ui_asset_${nextTrustedUiAssetRequest++}`;
      const fingerprint = sha256Hex(
        `gfx.ui.asset-put.v1\u0000${expectedRevision}\u0000${
          prepared.metadata.id
        }`,
      );
      const result = applyStoreAssetMutation(
        trustedUiAssetSession,
        {
          kind: 'asset-put',
          requestId,
          fingerprint,
          expectedRevision,
          metadata: prepared.metadata,
        },
      );
      if (!result.ok) {
        throw Object.assign(new Error(result.error.message), {
          code: result.error.code,
          recoverable: result.error.recoverable,
        });
      }
      published = true;
      return { ...prepared.metadata };
    } finally {
      prepared.releaseRetention();
      if (!published && prepared.newlyStored) {
        await appAssetService.discardUnretained(
          prepared.metadata.id,
        ).catch(() => false);
      }
    }
  },

  importProjectJson: async (
    json,
    documentIdForLegacy = DEFAULT_DOCUMENT_ID,
    callerExpectedRevision,
  ) => {
    const expectedRevision = callerExpectedRevision ?? get().revision;
    const imported = decodeProjectJson(json, {
      documentIdForLegacy,
      mode: 'editable',
    });
    if (!imported.ok) return imported;
    if (get().revision !== expectedRevision) {
      return {
        ok: false,
        report: projectIoFailureReport(
          imported.report,
          'REVISION_CONFLICT',
          'The document changed while the project file was being read.',
        ),
      };
    }
    if (expectedRevision >= Number.MAX_SAFE_INTEGER) {
      return {
        ok: false,
        report: {
          ...imported.report,
          valid: false,
          errors: [{
            severity: 'error',
            code: 'RESOURCE_LIMIT',
            message: 'Document revision is exhausted.',
            path: '',
            recoverable: true,
          }],
        },
      };
    }
    let staged:
      Awaited<ReturnType<typeof appAssetService.stagePreparedAssets>>
      | undefined;
    const releaseImportRetention =
      appAssetService.registerRetentionProvider(
        () => (imported.project.assets ?? []).map((asset) => asset.id),
      );
    try {
      staged = await appAssetService.stagePreparedAssets(
        imported.assetsToStage,
      );
      await appAssetService.ensureManifestAvailable(imported.project.assets);
    } catch {
      staged?.releaseRetention();
      releaseImportRetention();
      await Promise.all(
        (staged?.newlyStoredIds ?? []).map((assetId) =>
          appAssetService.discardUnretained(assetId).catch(() => false)),
      );
      return {
        ok: false,
        report: persistenceFailureReport(),
      };
    }
    endGesture();
    let committed = false;
    set((s) => {
      if (s.revision !== expectedRevision) return s;
      committed = true;
      startupBootstrapSuperseded = true;
      assetBootstrapStatus = 'ready';
      return {
        ...pushHistory(s, null),
        documentId: imported.project.documentId,
        doc: imported.project.document,
        assets: imported.project.assets,
        revision: s.revision + 1,
        startupLoadIssue: null,
        persistenceValidationReport: null,
        ...revalidate(s, imported.project.document),
      };
    });
    if (committed) signalStartupBootstrapSuperseded();
    staged.releaseRetention();
    releaseImportRetention();
    if (!committed) {
      await Promise.all(
        staged.newlyStoredIds.map((assetId) =>
          appAssetService.discardUnretained(assetId).catch(() => false)),
      );
      return {
        ok: false,
        report: {
          ...imported.report,
          valid: false,
          errors: [{
            severity: 'error',
            code: 'REVISION_CONFLICT',
            message: 'The document changed while imported assets were being committed.',
            path: '',
            recoverable: true,
          }],
        },
      };
    }
    return imported;
  },

  exportProjectJson: () => {
    const state = get();
    return exportDocumentJson(state.documentId, state.doc, {}, state.assets);
  },

  exportPortableProjectJson: async () => {
    const snapshot = get();
    const exported = exportDocumentJson(
      snapshot.documentId,
      snapshot.doc,
      { mode: 'editable' },
      snapshot.assets,
    );
    if (!exported.ok) return exported;
    const unregisterRetention = appAssetService.registerRetentionProvider(
      () => (snapshot.assets ?? []).map((asset) => asset.id),
    );
    try {
      await ensureAssetManifestReady(snapshot.assets);
      const assets = await appAssetService.exportManifestAssets(
        snapshot.assets,
      );
      if (get().revision !== snapshot.revision) {
        return {
          ok: false,
          report: projectIoFailureReport(
            exported.report,
            'REVISION_CONFLICT',
            'The document changed while the portable project was being saved.',
          ),
        };
      }
      return encodePortableProjectJson(
        exported.project,
        assets,
        { mode: 'editable' },
      );
    } catch {
      return {
        ok: false,
        report: projectIoFailureReport(
          exported.report,
          'PERSISTENCE_FAILED',
          'Portable project export could not read all referenced asset bytes.',
        ),
      };
    } finally {
      unregisterRetention();
    }
  },

  applyTransaction: (request) => {
    return applyStoreTransaction(transactionSession, request);
  },

  revertTransaction: (request) => {
    return revertStoreTransaction(transactionSession, request);
  },
}));

export function getStoreRetainedAssetIds(
  additionalSessions: Iterable<TransactionSession> = [],
): string[] {
  const retained = new Set<string>();
  const state = useApp.getState();
  const retainSnapshot = (snapshot: {
    assets?: readonly AssetMetadata[];
  }) => {
    for (const asset of snapshot.assets ?? []) retained.add(asset.id);
  };
  retainSnapshot(state);
  for (const snapshot of state.past) retainSnapshot(snapshot);
  for (const snapshot of state.future) retainSnapshot(snapshot);
  for (const session of [
    transactionSession,
    trustedUiAssetSession,
    ...additionalSessions,
  ]) {
    for (const assetId of session.retainedAssetIds()) {
      retained.add(assetId);
    }
  }
  for (const assetId of lastDurableAssetIds) retained.add(assetId);
  return [...retained].sort();
}

appAssetService.registerRetentionProvider(
  () => getStoreRetainedAssetIds(),
);

void assetBootstrapReady.then(
  () => {
    if (startupBootstrapSuperseded) return;
    const current = useApp.getState();
    if (current.startupLoadIssue) return;
    void appAssetService.pruneUnretained().catch(() => undefined);
    if (!canPersist) return;
    const unchanged =
      current.revision === 0
      && current.documentId === initialProject.documentId
      && current.doc === initialDoc
      && current.assets === initialProject.assets;
    if (
      unchanged
      && (
        !savedProject.project
        || savedProject.source === null
        || savedProject.source === 'project-v4'
      )
    ) return;
    persistSnapshot({
      documentId: current.documentId,
      doc: current.doc,
      assets: current.assets,
    });
  },
  () => {
    if (startupBootstrapSuperseded) return;
    useApp.setState({
      persistenceValidationReport: persistenceFailureReport(),
    });
  },
);

export interface StoreTransactionOptions {
  policy?: TransactionPolicy;
  /**
   * Trusted, non-reentrant authorization check at the transaction
   * linearization point. Throwing prevents both state and session settlement.
   */
  beforeFinalize?: () => void;
}

/**
 * Shared atomic host for the legacy in-process API and each paired Agent's
 * private TransactionSession. Raw input is captured before the Zustand updater
 * and the final session settlement remains the last non-trivial commit action.
 */
export function applyStoreTransaction(
  session: TransactionSession,
  request: unknown,
  options: StoreTransactionOptions = {},
): TransactionResult {
  const captured = session.captureApply(request);
  let response = transactionHostFailure(useApp.getState().revision, undefined);
  let finalized = false;
  let pendingFinalizeToken: SessionFinalizeToken | null = null;
  try {
    useApp.setState((s) => {
      const application = session.prepareApply(
        runtimeDocumentState(s),
        captured,
        options.policy,
      );
      response = application.result;
      pendingFinalizeToken = application.finalizeToken;
      if (!application.next) {
        if (application.finalizeToken) options.beforeFinalize?.();
        if (
          application.finalizeToken
          && !session.finalize(application.finalizeToken)
        ) {
          response = transactionHostFailure(s.revision, response.requestId);
          return s;
        }
        finalized = application.finalizeToken !== null;
        pendingFinalizeToken = null;
        return s;
      }

      const replacement: AppStore = {
        ...s,
        ...buildHistorySnapshot(s),
        documentId: application.next.documentId,
        doc: application.next.document,
        assets: application.next.assets,
        revision: application.next.revision,
        ...revalidate(s, application.next.document),
      };
      const latest = useApp.getState();
      if (latest !== s) {
        response = transactionHostFailure(
          latest.revision,
          response.requestId,
          'Store state changed while the transaction commit was being prepared.',
        );
        if (application.finalizeToken) session.discard(application.finalizeToken);
        pendingFinalizeToken = null;
        return latest;
      }
      options.beforeFinalize?.();
      if (
        !application.finalizeToken
        || !session.finalize(application.finalizeToken)
      ) {
        const current = useApp.getState();
        response = transactionHostFailure(current.revision, response.requestId);
        return current;
      }
      lastEdit = null;
      finalized = true;
      pendingFinalizeToken = null;
      return replacement;
    }, true);
    return response;
  } catch {
    if (pendingFinalizeToken) session.discard(pendingFinalizeToken);
    if (finalized) return response;
    return transactionHostFailure(
      useApp.getState().revision,
      response.requestId,
    );
  }
}

export function revertStoreTransaction(
  session: TransactionSession,
  request: unknown,
  options: StoreTransactionOptions = {},
): TransactionResult {
  const captured = session.captureRevert(request);
  let response = transactionHostFailure(useApp.getState().revision, undefined);
  let finalized = false;
  let pendingFinalizeToken: SessionFinalizeToken | null = null;
  try {
    useApp.setState((s) => {
      const application = session.prepareRevert(
        runtimeDocumentState(s),
        captured,
        options.policy,
      );
      response = application.result;
      pendingFinalizeToken = application.finalizeToken;
      if (!application.next) {
        if (application.finalizeToken) options.beforeFinalize?.();
        if (
          application.finalizeToken
          && !session.finalize(application.finalizeToken)
        ) {
          response = transactionHostFailure(s.revision, response.requestId);
          return s;
        }
        finalized = application.finalizeToken !== null;
        pendingFinalizeToken = null;
        return s;
      }

      const replacement: AppStore = {
        ...s,
        ...buildHistorySnapshot(s),
        documentId: application.next.documentId,
        doc: application.next.document,
        assets: application.next.assets,
        revision: application.next.revision,
        ...revalidate(s, application.next.document),
      };
      const latest = useApp.getState();
      if (latest !== s) {
        response = transactionHostFailure(
          latest.revision,
          response.requestId,
          'Store state changed while the transaction revert was being prepared.',
        );
        if (application.finalizeToken) session.discard(application.finalizeToken);
        pendingFinalizeToken = null;
        return latest;
      }
      options.beforeFinalize?.();
      if (
        !application.finalizeToken
        || !session.finalize(application.finalizeToken)
      ) {
        const current = useApp.getState();
        response = transactionHostFailure(current.revision, response.requestId);
        return current;
      }
      lastEdit = null;
      finalized = true;
      pendingFinalizeToken = null;
      return replacement;
    }, true);
    return response;
  } catch {
    if (pendingFinalizeToken) session.discard(pendingFinalizeToken);
    if (finalized) return response;
    return transactionHostFailure(
      useApp.getState().revision,
      response.requestId,
    );
  }
}

export function applyStoreAssetMutation(
  session: TransactionSession,
  mutation: TrustedAssetMutation,
  options: StoreTransactionOptions = {},
): TransactionResult {
  let response = transactionHostFailure(
    useApp.getState().revision,
    mutation.requestId,
  );
  let finalized = false;
  let pendingFinalizeToken: SessionFinalizeToken | null = null;
  try {
    useApp.setState((state) => {
      const application = session.prepareTrustedAssetMutation(
        runtimeDocumentState(state),
        mutation,
        options.policy,
      );
      response = application.result;
      pendingFinalizeToken = application.finalizeToken;
      if (!application.next) {
        if (application.finalizeToken) options.beforeFinalize?.();
        if (
          application.finalizeToken
          && !session.finalize(application.finalizeToken)
        ) {
          response = transactionHostFailure(
            state.revision,
            response.requestId,
          );
          return state;
        }
        finalized = application.finalizeToken !== null;
        pendingFinalizeToken = null;
        return state;
      }
      const replacement: AppStore = {
        ...state,
        ...buildHistorySnapshot(state),
        documentId: application.next.documentId,
        doc: application.next.document,
        assets: application.next.assets,
        revision: application.next.revision,
        ...revalidate(state, application.next.document),
      };
      const latest = useApp.getState();
      if (latest !== state) {
        response = transactionHostFailure(
          latest.revision,
          response.requestId,
          'Store state changed while the asset mutation was being prepared.',
        );
        if (application.finalizeToken) {
          session.discard(application.finalizeToken);
        }
        pendingFinalizeToken = null;
        return latest;
      }
      options.beforeFinalize?.();
      if (
        !application.finalizeToken
        || !session.finalize(application.finalizeToken)
      ) {
        const current = useApp.getState();
        response = transactionHostFailure(
          current.revision,
          response.requestId,
        );
        return current;
      }
      lastEdit = null;
      finalized = true;
      pendingFinalizeToken = null;
      return replacement;
    }, true);
    return response;
  } catch {
    if (pendingFinalizeToken) session.discard(pendingFinalizeToken);
    if (finalized) return response;
    return transactionHostFailure(
      useApp.getState().revision,
      mutation.requestId,
    );
  }
}

interface PersistenceSnapshot {
  documentId: string;
  doc: Doc;
  assets?: AssetMetadata[];
}

const AUTOSAVE_DEBOUNCE_MS = 250;
let pendingAutosave: PersistenceSnapshot | null = null;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function samePersistenceSnapshot(snapshot: PersistenceSnapshot): boolean {
  const current = useApp.getState();
  return current.documentId === snapshot.documentId
    && current.doc === snapshot.doc
    && current.assets === snapshot.assets;
}

function projectIoFailureReport(
  report: ValidationReport,
  code: 'PERSISTENCE_FAILED' | 'REVISION_CONFLICT',
  message: string,
): ValidationReport {
  return {
    ...report,
    valid: false,
    errors: [
      ...report.errors,
      {
        severity: 'error',
        code,
        message,
        path: '',
        recoverable: true,
      },
    ],
  };
}

function persistenceFailureReport(): ValidationReport {
  return {
    valid: false,
    mode: 'editable',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    errors: [{
      severity: 'error',
      code: 'PERSISTENCE_FAILED',
      message: 'Browser storage rejected the working project save.',
      path: '',
      recoverable: true,
      suggestedFix:
        'Export the project now, then free browser storage or remove large embedded images.',
    }],
    warnings: [],
  };
}

function storageReadFailureReport(): ValidationReport {
  return {
    valid: false,
    mode: 'editable',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    errors: [{
      severity: 'error',
      code: 'PERSISTENCE_FAILED',
      message: 'Browser storage could not read the saved working project.',
      path: '',
      recoverable: true,
      suggestedFix:
        'Keep this tab open, export a portable project, then repair or clear browser storage.',
    }],
    warnings: [],
  };
}

function persistSnapshot(snapshot: PersistenceSnapshot): void {
  if (assetBootstrapStatus !== 'ready') return;
  try {
    const project = createSerializedProject(
      snapshot.documentId,
      snapshot.doc,
      snapshot.assets,
    );
    // Local working saves may be incomplete (for example, an Output can be
    // temporarily absent), but they must still be structurally and
    // semantically safe to reload. Explicit external import stays renderable.
    const validation = validateSerializedProject(project, { mode: 'editable' });
    if (!validation.valid) {
      if (samePersistenceSnapshot(snapshot)) {
        useApp.setState({ persistenceValidationReport: validation });
      }
      return;
    }
    persistenceStorage!.setItem(PROJECT_STORAGE_KEY, JSON.stringify(project));
    lastDurableAssetIds = new Set(
      (snapshot.assets ?? []).map((asset) => asset.id),
    );
    if (
      samePersistenceSnapshot(snapshot)
      && useApp.getState().persistenceValidationReport
    ) {
      useApp.setState({ persistenceValidationReport: null });
    }
  } catch {
    // Editing remains available, but a quota/private-mode failure must be
    // visible: otherwise a refresh can silently discard the in-memory work.
    if (samePersistenceSnapshot(snapshot)) {
      useApp.setState({ persistenceValidationReport: persistenceFailureReport() });
    }
  }
}

function cancelAutosaveTimer(): void {
  if (autosaveTimer === null) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
}

function flushPendingAutosave(): void {
  cancelAutosaveTimer();
  const snapshot = pendingAutosave;
  pendingAutosave = null;
  if (snapshot) persistSnapshot(snapshot);
}

/**
 * Synchronously checkpoint the exact current project after an Agent asset
 * finalize. The document revision has already committed, so persistence
 * failure is reported as memory-only instead of being turned into a false
 * transaction failure.
 */
export function settleStorePersistence(): 'durable' | 'memory-only' {
  if (!canPersist) return 'memory-only';
  cancelAutosaveTimer();
  pendingAutosave = null;
  const current = useApp.getState();
  // Keep the original recovery candidate byte-for-byte until a human
  // explicitly imports a replacement. Agent checkpoints must obey the same
  // guard as ordinary autosave.
  if (
    current.startupLoadIssue
    || assetBootstrapStatus !== 'ready'
  ) return 'memory-only';
  persistSnapshot({
    documentId: current.documentId,
    doc: current.doc,
    assets: current.assets,
  });
  return useApp.getState().persistenceValidationReport === null
    ? 'durable'
    : 'memory-only';
}

function schedulePendingAutosave(delayMs: number): void {
  cancelAutosaveTimer();
  autosaveTimer = setTimeout(flushPendingAutosave, delayMs);
}

if (canPersist) {
  scheduleGestureEndAutosave = () => {
    if (pendingAutosave) schedulePendingAutosave(0);
  };
  useApp.subscribe((s, prev) => {
    if (
      s.doc === prev.doc
      && s.documentId === prev.documentId
      && s.assets === prev.assets
    ) return;
    // Do not overwrite a rejected recovery candidate with the blank fallback.
    // A successful explicit import clears the issue and resumes autosave.
    if (
      s.startupLoadIssue
      || assetBootstrapStatus !== 'ready'
    ) {
      cancelAutosaveTimer();
      pendingAutosave = null;
      return;
    }
    const snapshot: PersistenceSnapshot = {
      documentId: s.documentId,
      doc: s.doc,
      assets: s.assets,
    };
    if (lastEdit) {
      pendingAutosave = snapshot;
      schedulePendingAutosave(AUTOSAVE_DEBOUNCE_MS);
      return;
    }
    cancelAutosaveTimer();
    pendingAutosave = null;
    persistSnapshot(snapshot);
  });

  // Best-effort durability if the tab closes during the debounce window.
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushPendingAutosave);
  }
}
