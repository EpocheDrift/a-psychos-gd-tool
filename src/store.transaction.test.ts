import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc } from './engine/graph';
import type { TransactionResult } from './domain/commandTypes';
import { endGesture, useApp } from './store';

function documentWithOutput(): Doc {
  return {
    frame: { width: 320, height: 240 },
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
            params: { transparent: true },
            position: { x: 800, y: 0 },
          },
        },
        edges: [],
      },
    }],
  };
}

function reset(document = documentWithOutput()): void {
  endGesture();
  useApp.setState({
    documentId: 'document_1',
    doc: document,
    assets: undefined,
    revision: 0,
    activeLayerId: document.layers[0].id,
    selectedNodeIds: [],
    past: [],
    future: [],
    startupLoadIssue: null,
    persistenceValidationReport: null,
  });
}

function trapNextHistorySlice(effect: () => void): () => void {
  const original = useApp.getState().past;
  let fired = false;
  const trapped = new Proxy(original, {
    get(target, property, receiver) {
      if (property === 'slice' && !fired) {
        fired = true;
        effect();
      }
      return Reflect.get(target, property, receiver);
    },
  });
  useApp.setState({ past: trapped });
  return () => {
    if (useApp.getState().past === trapped) useApp.setState({ past: original });
  };
}

describe('store Agent transaction integration', () => {
  beforeEach(() => reset());

  it('commits a multi-command batch as one revision and one history entry', () => {
    useApp.getState().select(['out']);
    const listener = vi.fn();
    const unsubscribe = useApp.subscribe(listener);
    const result = useApp.getState().applyTransaction({
      requestId: 'store_batch',
      expectedRevision: 0,
      commands: [
        {
          op: 'add_node',
          layerId: 'layer_1',
          clientRef: 'shape',
          nodeType: 'Shape',
          position: { x: 10, y: 20 },
        },
        {
          op: 'set_node_params',
          layerId: 'layer_1',
          nodeId: { clientRef: 'shape' },
          patch: { width: 640 },
        },
        { op: 'set_frame', width: 640, height: 480 },
      ],
    });
    unsubscribe();

    expect(result).toMatchObject({
      ok: true,
      transactionId: expect.any(String),
      previousRevision: 0,
      revision: 1,
      created: { shape: 'shape_1' },
    });
    expect(useApp.getState()).toMatchObject({
      revision: 1,
      selectedNodeIds: ['out'],
      past: [expect.any(Object)],
      future: [],
    });
    expect(useApp.getState().doc.layers[0].graph.nodes.shape_1.params.width).toBe(640);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('leaves every store reference untouched when any command fails', () => {
    const before = useApp.getState();
    const listener = vi.fn();
    const unsubscribe = useApp.subscribe(listener);
    const result = before.applyTransaction({
      requestId: 'store_rollback',
      expectedRevision: 0,
      commands: [
        { op: 'set_frame', width: 640, height: 480 },
        {
          op: 'add_node',
          layerId: 'layer_1',
          clientRef: 'bad',
          nodeType: 'DoesNotExist',
        },
      ],
    });
    unsubscribe();

    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_NODE_TYPE' } });
    expect(useApp.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps dry-run and replay outside Zustand while returning stable IDs', () => {
    const listener = vi.fn();
    const unsubscribe = useApp.subscribe(listener);
    const dry = useApp.getState().applyTransaction({
      requestId: 'store_dry',
      expectedRevision: 0,
      dryRun: true,
      commands: [{
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'shape',
        nodeType: 'Shape',
      }],
    });
    expect(dry).toMatchObject({
      ok: true,
      committed: false,
      created: { shape: 'shape_1' },
    });
    expect(useApp.getState()).toMatchObject({ revision: 0, past: [] });
    expect(listener).not.toHaveBeenCalled();

    const request = {
      requestId: 'store_replay',
      expectedRevision: 0,
      commands: [{
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'shape',
        nodeType: 'Shape',
      }],
    };
    const committed = useApp.getState().applyTransaction(request);
    expect(listener).toHaveBeenCalledTimes(1);
    const afterCommit = useApp.getState();
    const replay = useApp.getState().applyTransaction(request);
    unsubscribe();

    expect(replay).toEqual(committed);
    expect(useApp.getState()).toBe(afterCommit);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useApp.getState()).toMatchObject({ revision: 1, past: [expect.any(Object)] });
  });

  it('rejects a stale Agent plan after a human edit', () => {
    useApp.getState().setFrame({ width: 500, height: 400 });
    const afterHuman = useApp.getState();
    const result = afterHuman.applyTransaction({
      requestId: 'store_stale',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    });
    expect(result).toMatchObject({
      ok: false,
      revision: 1,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(useApp.getState()).toBe(afterHuman);
    expect(useApp.getState().doc.frame).toEqual({ width: 500, height: 400 });
  });

  it('reverts only the compatible head as one new history entry', () => {
    const beforeDocument = structuredClone(useApp.getState().doc);
    const applied = useApp.getState().applyTransaction({
      requestId: 'store_apply_revert',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    });
    expect(applied.ok).toBe(true);
    const transactionId = applied.ok ? applied.transactionId : null;
    const reverted = useApp.getState().revertTransaction({
      requestId: 'store_revert',
      expectedRevision: 1,
      transactionId,
    });
    expect(reverted).toMatchObject({
      ok: true,
      previousRevision: 1,
      revision: 2,
    });
    expect(useApp.getState().doc).toEqual(beforeDocument);
    expect(useApp.getState()).toMatchObject({
      revision: 2,
      past: [expect.any(Object), expect.any(Object)],
    });
  });

  it('cannot use transaction revert to undo a later human edit or undo', () => {
    const applied = useApp.getState().applyTransaction({
      requestId: 'store_conflict_apply',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    });
    const transactionId = applied.ok ? applied.transactionId : '';
    useApp.getState().setFrame({ width: 700, height: 500 });
    const afterHuman = useApp.getState();
    const blocked = afterHuman.revertTransaction({
      requestId: 'store_conflict_revert',
      expectedRevision: 2,
      transactionId,
    });
    expect(blocked).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    expect(useApp.getState()).toBe(afterHuman);

    reset();
    const second = useApp.getState().applyTransaction({
      requestId: 'store_undo_apply',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    });
    const secondId = second.ok ? second.transactionId : '';
    useApp.getState().undo();
    const afterUndo = useApp.getState();
    const undoBlocked = afterUndo.revertTransaction({
      requestId: 'store_undo_revert',
      expectedRevision: 2,
      transactionId: secondId,
    });
    expect(undoBlocked).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    expect(useApp.getState()).toBe(afterUndo);
  });

  it('uses explicit layer targets and keeps UI-only state outside results', () => {
    const document = documentWithOutput();
    document.layers.push({
      id: 'layer_2',
      name: 'Layer 2',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      graph: {
        nodes: {
          out: { id: 'out', type: 'Output', params: { transparent: true } },
        },
        edges: [],
      },
    });
    reset(document);
    useApp.getState().select(['out']);
    const result = useApp.getState().applyTransaction({
      requestId: 'store_explicit_layer',
      expectedRevision: 0,
      commands: [{
        op: 'add_node',
        layerId: 'layer_2',
        clientRef: 'shape',
        nodeType: 'Shape',
      }],
    });
    expect(result.ok).toBe(true);
    expect(useApp.getState()).toMatchObject({
      activeLayerId: 'layer_1',
      selectedNodeIds: ['out'],
    });
    expect(document.layers[0].graph.nodes.shape_1).toBeUndefined();
    expect(useApp.getState().doc.layers[1].graph.nodes.shape_1).toBeDefined();
  });

  it('clears selection when an Agent removes its layer, even across duplicate node IDs', () => {
    const document = documentWithOutput();
    document.layers[0].graph.nodes.shared = {
      id: 'shared',
      type: 'Shape',
      params: {},
    };
    document.layers.push({
      id: 'layer_2',
      name: 'Layer 2',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      graph: {
        nodes: {
          out: { id: 'out', type: 'Output', params: { transparent: true } },
          shared: { id: 'shared', type: 'Shape', params: {} },
        },
        edges: [],
      },
    });
    reset(document);
    useApp.getState().select(['shared']);
    const result = useApp.getState().applyTransaction({
      requestId: 'store_remove_active_layer',
      expectedRevision: 0,
      commands: [{ op: 'remove_layer', layerId: 'layer_1' }],
    });
    expect(result.ok).toBe(true);
    expect(useApp.getState()).toMatchObject({
      activeLayerId: 'layer_2',
      selectedNodeIds: [],
      revision: 1,
    });
  });

  it('captures hostile apply proxies before state capture so nested writes cannot be lost', () => {
    let nested: TransactionResult | undefined;
    let fired = false;
    const outer = new Proxy({
      requestId: 'proxy_outer_apply',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 800, height: 600 }],
    }, {
      getPrototypeOf(target) {
        if (!fired) {
          fired = true;
          nested = useApp.getState().applyTransaction({
            requestId: 'proxy_inner_apply',
            expectedRevision: 0,
            commands: [{ op: 'set_frame', width: 640, height: 480 }],
          });
        }
        return Object.getPrototypeOf(target);
      },
    });

    const result = useApp.getState().applyTransaction(outer);
    expect(nested).toMatchObject({ ok: true, revision: 1 });
    expect(result).toMatchObject({
      ok: false,
      revision: 1,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(useApp.getState().doc.frame).toEqual({ width: 640, height: 480 });
    expect(useApp.getState().revision).toBe(1);
    expect(useApp.getState().past).toHaveLength(1);
  });

  it('preserves a nested human edit when the hostile outer request is invalid', () => {
    let fired = false;
    const outer = new Proxy({
      requestId: 'proxy_invalid_outer',
      expectedRevision: 0,
      commands: [],
    }, {
      getPrototypeOf(target) {
        if (!fired) {
          fired = true;
          useApp.getState().setFrame({ width: 700, height: 500 });
        }
        return Object.getPrototypeOf(target);
      },
    });

    const result = useApp.getState().applyTransaction(outer);
    expect(result).toMatchObject({
      ok: false,
      revision: 1,
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(useApp.getState().doc.frame).toEqual({ width: 700, height: 500 });
    expect(useApp.getState().revision).toBe(1);
    expect(useApp.getState().past).toHaveLength(1);
  });

  it('does not cache a ghost apply success when host history construction throws', () => {
    const request = {
      requestId: 'host_apply_failure',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    };
    const restoreHistory = trapNextHistorySlice(() => {
      throw new Error('clock unavailable');
    });
    const failed = useApp.getState().applyTransaction(request);
    restoreHistory();
    expect(failed).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(useApp.getState().revision).toBe(0);
    expect(useApp.getState().past).toHaveLength(0);
    expect(useApp.getState().doc.frame).toEqual({ width: 320, height: 240 });

    const retried = useApp.getState().applyTransaction(request);
    expect(retried).toMatchObject({
      ok: true,
      transactionId: expect.any(String),
      revision: 1,
    });
    expect(useApp.getState().revision).toBe(1);
    expect(useApp.getState().doc.frame).toEqual({ width: 640, height: 480 });
  });

  it('aborts an outer commit if history preparation re-enters an Agent write', () => {
    let nested: TransactionResult | undefined;
    const restoreHistory = trapNextHistorySlice(() => {
      nested = useApp.getState().applyTransaction({
        requestId: 'history_inner_agent',
        expectedRevision: 0,
        commands: [{ op: 'set_frame', width: 640, height: 480 }],
      });
    });
    const outer = useApp.getState().applyTransaction({
      requestId: 'history_outer_agent',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 800, height: 600 }],
    });
    restoreHistory();

    expect(nested).toMatchObject({ ok: true, revision: 1 });
    expect(outer).toMatchObject({
      ok: false,
      revision: 1,
      error: { code: 'INTERNAL' },
    });
    expect(useApp.getState().doc.frame).toEqual({ width: 640, height: 480 });
    expect(useApp.getState().revision).toBe(1);
    expect(useApp.getState().past).toHaveLength(1);
    expect(useApp.getState().applyTransaction({
      requestId: 'history_inner_agent',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    })).toEqual(nested);
  });

  it('aborts an outer commit if history preparation re-enters a human edit', () => {
    const restoreHistory = trapNextHistorySlice(() => {
      useApp.getState().setFrame({ width: 700, height: 500 });
    });
    const outer = useApp.getState().applyTransaction({
      requestId: 'history_outer_human',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 800, height: 600 }],
    });
    restoreHistory();

    expect(outer).toMatchObject({
      ok: false,
      revision: 1,
      error: { code: 'INTERNAL' },
    });
    expect(useApp.getState().doc.frame).toEqual({ width: 700, height: 500 });
    expect(useApp.getState().revision).toBe(1);
    expect(useApp.getState().past).toHaveLength(1);
  });

  it('does not cache a ghost revert success when host history construction throws', () => {
    const applied = useApp.getState().applyTransaction({
      requestId: 'host_revert_source',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    });
    expect(applied).toMatchObject({ ok: true, revision: 1 });
    const request = {
      requestId: 'host_revert_failure',
      expectedRevision: 1,
      transactionId: applied.ok ? applied.transactionId! : '',
    };
    const restoreHistory = trapNextHistorySlice(() => {
      throw new Error('clock unavailable');
    });
    const failed = useApp.getState().revertTransaction(request);
    restoreHistory();
    expect(failed).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(useApp.getState().revision).toBe(1);
    expect(useApp.getState().doc.frame).toEqual({ width: 640, height: 480 });
    expect(useApp.getState().past).toHaveLength(1);

    const retried = useApp.getState().revertTransaction(request);
    expect(retried).toMatchObject({ ok: true, revision: 2 });
    expect(useApp.getState().doc.frame).toEqual({ width: 320, height: 240 });
    expect(useApp.getState().past).toHaveLength(2);
  });

  it('aborts an outer revert if history preparation re-enters a human edit', () => {
    const applied = useApp.getState().applyTransaction({
      requestId: 'reentrant_revert_source',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    });
    expect(applied).toMatchObject({ ok: true, revision: 1 });
    const restoreHistory = trapNextHistorySlice(() => {
      useApp.getState().setFrame({ width: 700, height: 500 });
    });
    const reverted = useApp.getState().revertTransaction({
      requestId: 'reentrant_revert_outer',
      expectedRevision: 1,
      transactionId: applied.ok ? applied.transactionId! : '',
    });
    restoreHistory();

    expect(reverted).toMatchObject({
      ok: false,
      revision: 2,
      error: { code: 'INTERNAL' },
    });
    expect(useApp.getState().doc.frame).toEqual({ width: 700, height: 500 });
    expect(useApp.getState().revision).toBe(2);
    expect(useApp.getState().past).toHaveLength(2);
  });

  it('keeps session and document committed when a Zustand listener throws', () => {
    const request = {
      requestId: 'throwing_listener_commit',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    };
    const unsubscribe = useApp.subscribe(() => {
      throw new Error('listener failure');
    });
    const committed = useApp.getState().applyTransaction(request);
    unsubscribe();
    expect(committed).toMatchObject({ ok: true, revision: 1 });
    expect(useApp.getState().revision).toBe(1);
    expect(useApp.getState().doc.frame).toEqual({ width: 640, height: 480 });
    expect(useApp.getState().past).toHaveLength(1);

    const replay = useApp.getState().applyTransaction(request);
    expect(replay).toEqual(committed);
    expect(useApp.getState().revision).toBe(1);
    expect(useApp.getState().past).toHaveLength(1);
  });
});
