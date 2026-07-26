import { describe, expect, it } from 'vitest';
import type { Doc } from '../engine/graph';
import type { NodeDef, Registry } from '../engine/registry';
import { registry as appRegistry } from '../nodes';
import * as commandApi from './commands';
import type { RuntimeDocumentState, TransactionRequest } from './commandTypes';
import {
  applyDocumentTransaction,
  applyTrustedUiCommands,
  normalizeTransactionRequest,
} from './commands';
import { DEFAULT_AGENT_LIMITS } from './limits';
import { sha256Hex } from './sha256';

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

function runtime(document = documentWithOutput(), revision = 0): RuntimeDocumentState {
  return {
    documentId: 'document_1',
    document,
    revision,
  };
}

function paddedPngDataUri(byteLength: number): string {
  const bytes = Buffer.alloc(byteLength);
  Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex').copy(bytes);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function request(
  commands: TransactionRequest['commands'],
  options: Partial<Pick<TransactionRequest, 'requestId' | 'expectedRevision' | 'dryRun'>> = {},
): TransactionRequest {
  return {
    requestId: options.requestId ?? 'request_1',
    expectedRevision: options.expectedRevision ?? 0,
    commands,
    ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
  };
}

describe('SHA-256 request fingerprints', () => {
  it('matches published SHA-256 vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('normalizes object key order and omitted dryRun', () => {
    const first = normalizeTransactionRequest({
      requestId: 'one',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    }, 0);
    const second = normalizeTransactionRequest({
      commands: [{ height: 480, width: 640, op: 'set_frame' }],
      dryRun: false,
      expectedRevision: 0,
      requestId: 'two',
    }, 0);
    expect(first.ok && second.ok && first.value.fingerprint)
      .toBe(second.ok && second.value.fingerprint);
  });

  it('normalizes command-level semantic defaults', () => {
    const variants = [
      [
        {
          op: 'connect',
          layerId: 'layer_1',
          from: { nodeId: 'noise', socket: 'out' },
          to: { nodeId: 'out', socket: 'in' },
        },
      ],
      [
        {
          op: 'connect',
          layerId: 'layer_1',
          from: { nodeId: 'noise', socket: 'out' },
          to: { nodeId: 'out', socket: 'in' },
          replaceExisting: false,
        },
      ],
      [{ op: 'auto_layout_graph', layerId: 'layer_1' }],
      [{ op: 'auto_layout_graph', layerId: 'layer_1', direction: 'LR' }],
    ];
    const normalized = variants.map((commands, index) =>
      normalizeTransactionRequest({
        requestId: `defaults_${index}`,
        expectedRevision: 0,
        commands,
      }, 0));
    expect(normalized[0].ok && normalized[1].ok && normalized[0].value.fingerprint)
      .toBe(normalized[1].ok && normalized[1].value.fingerprint);
    expect(normalized[2].ok && normalized[3].ok && normalized[2].value.fingerprint)
      .toBe(normalized[3].ok && normalized[3].value.fingerprint);

    const omittedParams = normalizeTransactionRequest({
      requestId: 'omitted_params',
      expectedRevision: 0,
      commands: [{
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'shape',
        nodeType: 'Shape',
      }],
    }, 0);
    const emptyParams = normalizeTransactionRequest({
      requestId: 'empty_params',
      expectedRevision: 0,
      commands: [{
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'shape',
        nodeType: 'Shape',
        params: {},
      }],
    }, 0);
    expect(
      omittedParams.ok
      && emptyParams.ok
      && omittedParams.value.fingerprint,
    ).toBe(emptyParams.ok && emptyParams.value.fingerprint);
  });
});

describe('pure document transactions', () => {
  it('builds and wires a multi-node graph with backward client references', () => {
    const before = runtime();
    const applied = applyDocumentTransaction(before, request([
      {
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'headline',
        nodeType: 'Text',
        params: { content: 'HELLO' },
        position: { x: 0, y: 0 },
      },
      {
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'outline',
        nodeType: 'Outline',
      },
      {
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'raster',
        nodeType: 'Rasterize',
      },
      {
        op: 'connect',
        layerId: 'layer_1',
        from: { nodeId: { clientRef: 'headline' }, socket: 'out' },
        to: { nodeId: { clientRef: 'outline' }, socket: 'text' },
      },
      {
        op: 'connect',
        layerId: 'layer_1',
        from: { nodeId: { clientRef: 'outline' }, socket: 'out' },
        to: { nodeId: { clientRef: 'raster' }, socket: 'vector' },
      },
      {
        op: 'connect',
        layerId: 'layer_1',
        from: { nodeId: { clientRef: 'raster' }, socket: 'out' },
        to: { nodeId: 'out', socket: 'in' },
      },
    ]), { transactionId: 'transaction_1' });

    expect(applied.result).toMatchObject({
      ok: true,
      committed: true,
      transactionId: 'transaction_1',
      previousRevision: 0,
      revision: 1,
      created: {
        headline: 'text_1',
        outline: 'outline_1',
        raster: 'rasterize_1',
      },
      changed: { edgeCountDelta: 3 },
    });
    expect(applied.next?.document.layers[0].graph).toMatchObject({
      nodes: {
        text_1: { id: 'text_1', type: 'Text', params: { content: 'HELLO' } },
        outline_1: { id: 'outline_1', type: 'Outline' },
        rasterize_1: { id: 'rasterize_1', type: 'Rasterize' },
      },
    });
    expect(before.document.layers[0].graph.nodes).toEqual({
      out: expect.objectContaining({ id: 'out' }),
    });
  });

  it('rolls back every draft change when a later command fails', () => {
    const before = runtime();
    const snapshot = structuredClone(before.document);
    const applied = applyDocumentTransaction(before, request([
      {
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'shape',
        nodeType: 'Shape',
      },
      {
        op: 'connect',
        layerId: 'layer_1',
        from: { nodeId: { clientRef: 'shape' }, socket: 'out' },
        to: { nodeId: 'out', socket: 'in' },
      },
    ]), { transactionId: 'transaction_1' });
    expect(applied.result).toMatchObject({
      ok: false,
      error: { code: 'TYPE_MISMATCH', commandIndex: 1 },
    });
    expect(applied.next).toBeUndefined();
    expect(before.document).toEqual(snapshot);
  });

  it('dry-runs with deterministic proposed IDs and no committed next state', () => {
    const before = runtime();
    const commands: TransactionRequest['commands'] = [{
      op: 'add_node',
      layerId: 'layer_1',
      clientRef: 'shape',
      nodeType: 'Shape',
    }];
    const dry = applyDocumentTransaction(
      before,
      request(commands, { requestId: 'dry', dryRun: true }),
    );
    const commit = applyDocumentTransaction(
      before,
      request(commands, { requestId: 'commit' }),
      { transactionId: 'transaction_1' },
    );
    expect(dry.result).toMatchObject({
      ok: true,
      committed: false,
      transactionId: null,
      revision: 0,
      proposedRevision: 1,
      created: { shape: 'shape_1' },
    });
    expect(dry.next).toBeUndefined();
    expect(commit.result).toMatchObject({
      ok: true,
      created: { shape: 'shape_1' },
    });
  });

  it('checks expectedRevision before applying commands', () => {
    const applied = applyDocumentTransaction(runtime(documentWithOutput(), 4), request([
      { op: 'set_frame', width: 640, height: 480 },
    ], { expectedRevision: 3 }), { transactionId: 'transaction_1' });
    expect(applied.result).toMatchObject({
      ok: false,
      revision: 4,
      error: { code: 'REVISION_CONFLICT', path: '/expectedRevision' },
    });
  });

  it('requires a removed Output to be replaced in the same strict transaction', () => {
    const single = applyDocumentTransaction(runtime(), request([
      { op: 'remove_nodes', layerId: 'layer_1', nodeIds: ['out'] },
    ]), { transactionId: 'transaction_1' });
    expect(single.result).toMatchObject({
      ok: false,
      error: { code: 'OUTPUT_MISSING' },
    });

    const replacement = applyDocumentTransaction(runtime(), request([
      { op: 'remove_nodes', layerId: 'layer_1', nodeIds: ['out'] },
      {
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'replacement',
        nodeType: 'Output',
      },
    ], { requestId: 'replace' }), { transactionId: 'transaction_2' });
    expect(replacement.result).toMatchObject({
      ok: true,
      created: { replacement: 'output_1' },
    });
  });

  it('makes occupied-input replacement explicit and reports the complete old edge', () => {
    const document = documentWithOutput();
    document.layers[0].graph.nodes.first = { id: 'first', type: 'Noise', params: {} };
    document.layers[0].graph.nodes.second = { id: 'second', type: 'Noise', params: {} };
    document.layers[0].graph.edges = [{
      from: { node: 'first', socket: 'out' },
      to: { node: 'out', socket: 'in' },
    }];
    const command: TransactionRequest['commands'][number] = {
      op: 'connect',
      layerId: 'layer_1',
      from: { nodeId: 'second', socket: 'out' },
      to: { nodeId: 'out', socket: 'in' },
    };
    expect(applyDocumentTransaction(runtime(document), request([command]), {
      transactionId: 'transaction_1',
    }).result).toMatchObject({
      ok: false,
      error: { code: 'INPUT_ALREADY_CONNECTED' },
    });
    const replaced = applyDocumentTransaction(runtime(document), request([
      { ...command, replaceExisting: true },
    ], { requestId: 'replace' }), { transactionId: 'transaction_2' });
    expect(replaced.result).toMatchObject({
      ok: true,
      changed: {
        edgeCountDelta: 0,
        replacedEdges: [{
          layerId: 'layer_1',
          edge: {
            from: { node: 'first', socket: 'out' },
            to: { node: 'out', socket: 'in' },
          },
        }],
      },
    });
  });

  it('rejects forward, duplicate, wrong-kind, and cross-layer client references', () => {
    const forward = applyDocumentTransaction(runtime(), request([
      {
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'outline',
        nodeType: 'Outline',
      },
      {
        op: 'connect',
        layerId: 'layer_1',
        from: { nodeId: { clientRef: 'later' }, socket: 'out' },
        to: { nodeId: { clientRef: 'outline' }, socket: 'text' },
      },
      {
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'later',
        nodeType: 'Text',
      },
    ]), { transactionId: 'transaction_1' });
    expect(forward.result).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_NODE', commandIndex: 1 },
    });

    const wrongKind = applyDocumentTransaction(runtime(), request([
      { op: 'add_layer', clientRef: 'created_layer' },
      {
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'node',
        nodeType: 'Shape',
      },
      {
        op: 'remove_nodes',
        layerId: 'layer_1',
        nodeIds: [{ clientRef: 'created_layer' }],
      },
    ], { requestId: 'wrong_kind' }), { transactionId: 'transaction_2' });
    expect(wrongKind.result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', commandIndex: 2 },
    });
  });

  it('accepts manifest-structured binds and persists their compatibility encoding', () => {
    const applied = applyDocumentTransaction(runtime(), request([
      {
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'place',
        nodeType: 'Place',
        params: {
          binds: [{
            channel: 'weight',
            target: 'scale',
            amount: 0.5,
          }],
        },
      },
    ]), { transactionId: 'transaction_1' });
    expect(applied.result.ok).toBe(true);
    expect(applied.next?.document.layers[0].graph.nodes.place_1.params.binds)
      .toBe('[{"channel":"weight","target":"scale","amount":0.5,"invert":false,"offset":0}]');
  });

  it('applies deterministic auto layout and defensively copies positions', () => {
    const document = documentWithOutput();
    document.layers[0].graph.nodes.noise = { id: 'noise', type: 'Noise', params: {} };
    document.layers[0].graph.edges = [{
      from: { node: 'noise', socket: 'out' },
      to: { node: 'out', socket: 'in' },
    }];
    const applied = applyDocumentTransaction(runtime(document), request([
      { op: 'auto_layout_graph', layerId: 'layer_1', direction: 'LR' },
    ]), { transactionId: 'transaction_1' });
    expect(applied.result.ok).toBe(true);
    expect(applied.next?.document.layers[0].graph.nodes).toMatchObject({
      noise: { position: { x: 0, y: 0 } },
      out: { position: { x: 280, y: 0 } },
    });
  });

  it('enforces command, client-ref, touched-node, and request-byte budgets', () => {
    expect(applyDocumentTransaction(runtime(), request([
      { op: 'set_frame', width: 640, height: 480 },
      { op: 'set_frame', width: 800, height: 600 },
    ]), {
      limits: { maxTransactionCommands: 1 },
      transactionId: 'transaction_1',
    }).result).toMatchObject({
      ok: false,
      error: { code: 'RESOURCE_LIMIT', path: '/commands' },
    });

    const document = documentWithOutput();
    document.layers[0].graph.nodes.noise = { id: 'noise', type: 'Noise', params: {} };
    expect(applyDocumentTransaction(runtime(document), request([{
      op: 'move_nodes',
      layerId: 'layer_1',
      positions: [
        { nodeId: 'out', position: { x: 1, y: 1 } },
        { nodeId: 'noise', position: { x: 2, y: 2 } },
      ],
    }]), {
      limits: { maxTouchedNodes: 1 },
      transactionId: 'transaction_1',
    }).result).toMatchObject({
      ok: false,
      error: { code: 'RESOURCE_LIMIT' },
    });
  });

  it('rejects hostile request containers without invoking getters', () => {
    let calls = 0;
    const hostile = {
      requestId: 'request_1',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    } as Record<string, unknown>;
    Object.defineProperty(hostile, 'evil', {
      enumerable: true,
      get() {
        calls++;
        return true;
      },
    });
    const result = applyDocumentTransaction(runtime(), hostile, {
      transactionId: 'transaction_1',
    }).result;
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(calls).toBe(0);
  });

  it('does not depend on any active-layer state', () => {
    const document = documentWithOutput();
    document.layers.push({
      id: 'layer_2',
      name: 'Layer 2',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      graph: {
        nodes: { out: { id: 'out', type: 'Output', params: { transparent: true } } },
        edges: [],
      },
    });
    const applied = applyDocumentTransaction(runtime(document), request([{
      op: 'add_node',
      layerId: 'layer_1',
      clientRef: 'shape',
      nodeType: 'Shape',
    }]), { transactionId: 'transaction_1' });
    expect(applied.result.ok).toBe(true);
    expect(applied.next?.document.layers[0].graph.nodes.shape_1).toBeDefined();
    expect(applied.next?.document.layers[1].graph.nodes.shape_1).toBeUndefined();
  });

  it('updates, moves, and removes explicit layers in one atomic plan', () => {
    const applied = applyDocumentTransaction(runtime(), request([
      {
        op: 'add_layer',
        clientRef: 'second',
        name: 'Second',
        afterLayerId: 'layer_1',
      },
      {
        op: 'update_layer',
        layerId: { clientRef: 'second' },
        patch: { opacity: 0.5, visible: false },
      },
      {
        op: 'move_layer',
        layerId: { clientRef: 'second' },
        index: 0,
      },
      { op: 'remove_layer', layerId: 'layer_1' },
    ], { requestId: 'layer_ops' }), { transactionId: 'transaction_1' });
    expect(applied.result).toMatchObject({
      ok: true,
      created: { second: 'layer_2' },
    });
    expect(applied.next?.document.layers).toMatchObject([{
      id: 'layer_2',
      name: 'Second',
      opacity: 0.5,
      visible: false,
    }]);

    expect(applyDocumentTransaction(runtime(), request([{
      op: 'update_layer',
      layerId: 'layer_1',
      patch: { name: 'Layer 1' },
    }], { requestId: 'layer_noop' }), {
      transactionId: 'transaction_2',
    }).result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', commandIndex: 0 },
    });
  });

  it('sets parameters and disconnects an existing input explicitly', () => {
    const document = documentWithOutput();
    document.layers[0].graph.nodes.shape = {
      id: 'shape',
      type: 'Shape',
      params: {},
    };
    document.layers[0].graph.nodes.noise = {
      id: 'noise',
      type: 'Noise',
      params: {},
    };
    document.layers[0].graph.edges = [{
      from: { node: 'noise', socket: 'out' },
      to: { node: 'out', socket: 'in' },
    }];
    const applied = applyDocumentTransaction(runtime(document), request([
      {
        op: 'set_node_params',
        layerId: 'layer_1',
        nodeId: 'shape',
        patch: { width: 640 },
      },
      {
        op: 'disconnect',
        layerId: 'layer_1',
        to: { nodeId: 'out', socket: 'in' },
      },
    ], { requestId: 'param_disconnect' }), { transactionId: 'transaction_1' });
    expect(applied.result).toMatchObject({
      ok: true,
      changed: {
        edgeCountDelta: -1,
        nodes: expect.arrayContaining([
          { layerId: 'layer_1', nodeId: 'shape' },
          { layerId: 'layer_1', nodeId: 'noise' },
          { layerId: 'layer_1', nodeId: 'out' },
        ]),
      },
    });
    expect(applied.next?.document.layers[0].graph.nodes.shape.params.width).toBe(640);
    expect(applied.next?.document.layers[0].graph.edges).toEqual([]);

    expect(applyDocumentTransaction(runtime(document), request([{
      op: 'disconnect',
      layerId: 'layer_1',
      to: { nodeId: 'shape', socket: 'missing' },
    }], { requestId: 'unknown_socket' }), {
      transactionId: 'transaction_2',
    }).result).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_SOCKET', path: '/commands/0/to/socket' },
    });
  });

  it('enforces global backward client references and their layer ownership', () => {
    const duplicate = applyDocumentTransaction(runtime(), request([
      { op: 'add_layer', clientRef: 'same' },
      {
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'same',
        nodeType: 'Shape',
      },
    ], { requestId: 'duplicate_ref' }), { transactionId: 'transaction_1' });
    expect(duplicate.result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', commandIndex: 1 },
    });

    const crossLayer = applyDocumentTransaction(runtime(), request([
      { op: 'add_layer', clientRef: 'other_layer' },
      {
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'shape',
        nodeType: 'Shape',
      },
      {
        op: 'move_nodes',
        layerId: { clientRef: 'other_layer' },
        positions: [{
          nodeId: { clientRef: 'shape' },
          position: { x: 1, y: 2 },
        }],
      },
    ], { requestId: 'cross_layer_ref' }), { transactionId: 'transaction_2' });
    expect(crossLayer.result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', commandIndex: 2 },
    });

    const forwardLayer = applyDocumentTransaction(runtime(), request([
      {
        op: 'add_node',
        layerId: { clientRef: 'later_layer' },
        clientRef: 'shape',
        nodeType: 'Shape',
      },
      { op: 'add_layer', clientRef: 'later_layer' },
    ], { requestId: 'forward_layer_ref' }), { transactionId: 'transaction_3' });
    expect(forwardLayer.result).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_LAYER', commandIndex: 0 },
    });
  });

  it('counts removed and replaced edge endpoints against the touched-node budget', () => {
    const removeDocument = documentWithOutput();
    removeDocument.layers[0].graph.nodes.noise = {
      id: 'noise',
      type: 'Noise',
      params: {},
    };
    removeDocument.layers[0].graph.edges = [{
      from: { node: 'noise', socket: 'out' },
      to: { node: 'out', socket: 'in' },
    }];
    expect(applyDocumentTransaction(runtime(removeDocument), request([{
      op: 'remove_nodes',
      layerId: 'layer_1',
      nodeIds: ['noise'],
    }], { requestId: 'remove_budget' }), {
      limits: { maxTouchedNodes: 1 },
      transactionId: 'transaction_1',
    }).result).toMatchObject({
      ok: false,
      error: { code: 'RESOURCE_LIMIT' },
    });

    const replaceDocument = documentWithOutput();
    replaceDocument.layers[0].graph.nodes.first = {
      id: 'first',
      type: 'Noise',
      params: {},
    };
    replaceDocument.layers[0].graph.nodes.second = {
      id: 'second',
      type: 'Noise',
      params: {},
    };
    replaceDocument.layers[0].graph.edges = [{
      from: { node: 'first', socket: 'out' },
      to: { node: 'out', socket: 'in' },
    }];
    expect(applyDocumentTransaction(runtime(replaceDocument), request([{
      op: 'connect',
      layerId: 'layer_1',
      from: { nodeId: 'second', socket: 'out' },
      to: { nodeId: 'out', socket: 'in' },
      replaceExisting: true,
    }], { requestId: 'replace_budget' }), {
      limits: { maxTouchedNodes: 2 },
      transactionId: 'transaction_2',
    }).result).toMatchObject({
      ok: false,
      error: { code: 'RESOURCE_LIMIT' },
    });
  });

  it('derives created IDs and changed nodes from the final document diff', () => {
    const applied = applyDocumentTransaction(runtime(), request([
      {
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'temporary',
        nodeType: 'Shape',
      },
      {
        op: 'remove_nodes',
        layerId: 'layer_1',
        nodeIds: [{ clientRef: 'temporary' }],
      },
      {
        op: 'move_nodes',
        layerId: 'layer_1',
        positions: [{ nodeId: 'out', position: { x: 1, y: 2 } }],
      },
      {
        op: 'move_nodes',
        layerId: 'layer_1',
        positions: [{ nodeId: 'out', position: { x: 800, y: 0 } }],
      },
      { op: 'set_frame', width: 640, height: 480 },
    ], { requestId: 'final_diff' }), { transactionId: 'transaction_1' });
    expect(applied.result).toMatchObject({
      ok: true,
      created: {},
      createdEntities: {},
      changed: {
        frame: true,
        layerIds: [],
        nodes: [],
        edgeCountDelta: 0,
      },
    });
  });

  it('enforces manifest write policy, structured binds, and escaped error paths', () => {
    expect(commandApi).not.toHaveProperty('applyNormalizedTransaction');
    expect(applyDocumentTransaction(runtime(), request([{
      op: 'add_node',
      layerId: 'layer_1',
      clientRef: 'image',
      nodeType: 'Image',
      params: { src: '' },
    }], { requestId: 'image_policy' }), {
      transactionId: 'transaction_1',
    }).result).toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_REQUIRED', path: '/commands/0/params/src' },
    });
    expect(applyDocumentTransaction(runtime(), request([{
      op: 'add_node',
      layerId: 'layer_1',
      clientRef: 'image',
      nodeType: 'Image',
      params: { src: '' },
    }], { requestId: 'runtime_image_policy_bypass' }), {
      transactionId: 'transaction_runtime_bypass',
      enforceAgentWritable: false,
      trustedUiFastPath: true,
      finalValidationMode: 'structural',
    } as never).result).toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_REQUIRED', path: '/commands/0/params/src' },
    });
    if (false) {
      applyDocumentTransaction(runtime(), request([{
        op: 'set_frame',
        width: 640,
        height: 480,
      }]), {
        // @ts-expect-error Agent callers cannot opt into trusted UI policy.
        enforceAgentWritable: false,
      });
    }

    expect(applyDocumentTransaction(runtime(), request([{
      op: 'add_node',
      layerId: 'layer_1',
      clientRef: 'place',
      nodeType: 'Place',
      params: { binds: '[]' },
    }], { requestId: 'persisted_binds' }), {
      transactionId: 'transaction_2',
    }).result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', path: '/commands/0/params/binds' },
    });

    expect(applyDocumentTransaction(runtime(), request([{
      op: 'add_node',
      layerId: 'layer_1',
      clientRef: 'shape',
      nodeType: 'Shape',
      params: { 'bad/name': 1 },
    }], { requestId: 'escaped_param' }), {
      transactionId: 'transaction_3',
    }).result).toMatchObject({
      ok: false,
      error: {
        code: 'UNKNOWN_PARAM',
        path: '/commands/0/params/bad~1name',
      },
    });
  });

  it('detects self-cycles without discarding the occupied input on failure', () => {
    const document = documentWithOutput();
    document.layers[0].graph.nodes.noise = { id: 'noise', type: 'Noise', params: {} };
    document.layers[0].graph.nodes.blur = { id: 'blur', type: 'Blur', params: {} };
    document.layers[0].graph.edges = [
      {
        from: { node: 'noise', socket: 'out' },
        to: { node: 'blur', socket: 'in' },
      },
      {
        from: { node: 'blur', socket: 'out' },
        to: { node: 'out', socket: 'in' },
      },
    ];
    const applied = applyDocumentTransaction(runtime(document), request([{
      op: 'connect',
      layerId: 'layer_1',
      from: { nodeId: 'blur', socket: 'out' },
      to: { nodeId: 'blur', socket: 'in' },
      replaceExisting: true,
    }], { requestId: 'self_cycle' }), { transactionId: 'transaction_1' });
    expect(applied.result).toMatchObject({
      ok: false,
      error: { code: 'CYCLE_DETECTED' },
    });
    expect(applied.next).toBeUndefined();
    expect(document.layers[0].graph.edges[0]).toEqual({
      from: { node: 'noise', socket: 'out' },
      to: { node: 'blur', socket: 'in' },
    });
  });

  it('supports one validation authority when a custom registry is injected', () => {
    const customDefinition: NodeDef = {
      type: 'Custom',
      inputs: [],
      outputs: [],
      params: [],
      cook: () => ({}),
    };
    const customRegistry: Registry = new Map(appRegistry);
    customRegistry.set(customDefinition.type, customDefinition);
    const applied = applyDocumentTransaction(runtime(), request([{
      op: 'add_node',
      layerId: 'layer_1',
      clientRef: 'custom',
      nodeType: 'Custom',
    }], { requestId: 'custom_registry' }), {
      registry: customRegistry,
      transactionId: 'transaction_1',
    });
    expect(applied.result).toMatchObject({ ok: true, created: { custom: 'custom_1' } });
  });

  it('turns revoked proxy failures into a structured internal error', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => applyDocumentTransaction(runtime(), proxy, {
      transactionId: 'transaction_1',
    })).not.toThrow();
    expect(applyDocumentTransaction(runtime(), proxy, {
      transactionId: 'transaction_1',
    }).result).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL', recoverable: false },
    });
  });

  it('enforces client-reference and request-byte limits independently', () => {
    expect(applyDocumentTransaction(runtime(), request([
      { op: 'add_layer', clientRef: 'first' },
      { op: 'add_layer', clientRef: 'second' },
    ], { requestId: 'client_ref_limit' }), {
      limits: { maxClientRefs: 1 },
      transactionId: 'transaction_1',
    }).result).toMatchObject({
      ok: false,
      error: { code: 'RESOURCE_LIMIT' },
    });

    expect(applyDocumentTransaction(runtime(), request([
      { op: 'set_frame', width: 640, height: 480 },
    ], { requestId: 'request_byte_limit' }), {
      limits: { maxTransactionJsonBytes: 64 },
      transactionId: 'transaction_2',
    }).result).toMatchObject({
      ok: false,
      error: { code: 'RESOURCE_LIMIT', path: '' },
    });
  });

  it('never reuses a deleted node ID for a later client reference', () => {
    const commands: TransactionRequest['commands'] = [
      {
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'old',
        nodeType: 'Shape',
      },
      {
        op: 'remove_nodes',
        layerId: 'layer_1',
        nodeIds: [{ clientRef: 'old' }],
      },
      {
        op: 'add_node',
        layerId: 'layer_1',
        clientRef: 'current',
        nodeType: 'Shape',
      },
    ];
    const applied = applyDocumentTransaction(
      runtime(),
      request(commands, { requestId: 'node_id_tombstone' }),
      { transactionId: 'transaction_1' },
    );
    expect(applied.result).toMatchObject({
      ok: true,
      created: { current: 'shape_2' },
    });
    expect(applied.result.ok && applied.result.created).not.toHaveProperty('old');
    expect(applied.next?.document.layers[0].graph.nodes).not.toHaveProperty('shape_1');
    expect(applied.next?.document.layers[0].graph.nodes).toHaveProperty('shape_2');

    const staleRef = applyDocumentTransaction(
      runtime(),
      request([
        ...commands,
        {
          op: 'set_node_params',
          layerId: 'layer_1',
          nodeId: { clientRef: 'old' },
          patch: { width: 10 },
        },
      ], { requestId: 'stale_node_ref' }),
      { transactionId: 'transaction_2' },
    );
    expect(staleRef.result).toMatchObject({
      ok: false,
      error: {
        code: 'UNKNOWN_NODE',
        path: '/commands/3/nodeId',
        commandIndex: 3,
      },
    });
    expect(staleRef.next).toBeUndefined();

    expect(applyDocumentTransaction(
      runtime(),
      request(commands, { requestId: 'node_id_budget' }),
      {
        limits: { maxTouchedNodes: 1 },
        transactionId: 'transaction_3',
      },
    ).result).toMatchObject({
      ok: false,
      error: { code: 'RESOURCE_LIMIT', commandIndex: 2 },
    });
  });

  it('never reuses a deleted layer ID for a later client reference', () => {
    const commands: TransactionRequest['commands'] = [
      { op: 'add_layer', clientRef: 'old' },
      { op: 'remove_layer', layerId: { clientRef: 'old' } },
      { op: 'add_layer', clientRef: 'current' },
    ];
    const applied = applyDocumentTransaction(
      runtime(),
      request(commands, { requestId: 'layer_id_tombstone' }),
      { transactionId: 'transaction_1' },
    );
    expect(applied.result).toMatchObject({
      ok: true,
      created: { current: 'layer_3' },
    });
    expect(applied.result.ok && applied.result.created).not.toHaveProperty('old');
    expect(applied.next?.document.layers.map((layer) => layer.id))
      .toEqual(['layer_1', 'layer_3']);

    const staleRef = applyDocumentTransaction(
      runtime(),
      request([
        ...commands,
        {
          op: 'update_layer',
          layerId: { clientRef: 'old' },
          patch: { name: 'stale' },
        },
      ], { requestId: 'stale_layer_ref' }),
      { transactionId: 'transaction_2' },
    );
    expect(staleRef.result).toMatchObject({
      ok: false,
      error: {
        code: 'UNKNOWN_LAYER',
        path: '/commands/3/layerId',
        commandIndex: 3,
      },
    });
  });

  it('reports precise structured-bind and frame field paths', () => {
    const invalidTarget = applyDocumentTransaction(runtime(), request([{
      op: 'add_node',
      layerId: 'layer_1',
      clientRef: 'place',
      nodeType: 'Place',
      params: {
        binds: [{
          channel: 'weight',
          target: 'invalid',
          amount: 1,
          invert: false,
          offset: 0,
        }],
      },
    }], { requestId: 'bind_target_path' }), {
      transactionId: 'transaction_1',
    });
    expect(invalidTarget.result).toMatchObject({
      ok: false,
      error: { path: '/commands/0/params/binds/0/target' },
    });

    const unknownBindKey = applyDocumentTransaction(runtime(), request([{
      op: 'add_node',
      layerId: 'layer_1',
      clientRef: 'place',
      nodeType: 'Place',
      params: {
        binds: [{
          channel: 'weight',
          target: 'scale',
          amount: 1,
          invert: false,
          offset: 0,
          'bad/name': true,
        }],
      },
    }], { requestId: 'bind_escaped_path' }), {
      transactionId: 'transaction_2',
    });
    expect(unknownBindKey.result).toMatchObject({
      ok: false,
      error: { path: '/commands/0/params/binds/0/bad~1name' },
    });

    expect(applyDocumentTransaction(runtime(), request([{
      op: 'set_frame',
      width: 1.5,
      height: 480,
    }], { requestId: 'frame_width_path' }), {
      transactionId: 'transaction_3',
    }).result).toMatchObject({
      ok: false,
      error: { path: '/commands/0/width' },
    });
    expect(applyDocumentTransaction(runtime(), request([{
      op: 'set_frame',
      width: 640,
      height: 1.5,
    }], { requestId: 'frame_height_path' }), {
      transactionId: 'transaction_4',
    }).result).toMatchObject({
      ok: false,
      error: { path: '/commands/0/height' },
    });
  });

  it('copy-on-write preserves every untouched UI document branch', () => {
    const document = documentWithOutput();
    document.layers[0].graph.nodes.shape = {
      id: 'shape',
      type: 'Shape',
      params: { width: 100 },
      position: { x: 0, y: 0 },
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
        },
        edges: [],
      },
    });
    const originalLayers = document.layers;
    const activeLayer = document.layers[0];
    const inactiveLayer = document.layers[1];
    const originalGraph = activeLayer.graph;
    const originalNodes = originalGraph.nodes;
    const untouchedOutput = originalNodes.out;
    const originalEdges = originalGraph.edges;

    const moved = applyTrustedUiCommands(runtime(document), [{
      op: 'move_nodes',
      layerId: 'layer_1',
      positions: [{ nodeId: 'shape', position: { x: 10, y: 20 } }],
    }]);
    expect(moved.result.ok).toBe(true);
    expect(moved.next?.document).not.toBe(document);
    expect(moved.next?.document.layers).not.toBe(originalLayers);
    expect(moved.next?.document.layers[0]).not.toBe(activeLayer);
    expect(moved.next?.document.layers[0].graph).not.toBe(originalGraph);
    expect(moved.next?.document.layers[0].graph.nodes).not.toBe(originalNodes);
    expect(moved.next?.document.layers[0].graph.nodes.shape).not.toBe(originalNodes.shape);
    expect(moved.next?.document.layers[0].graph.nodes.out).toBe(untouchedOutput);
    expect(moved.next?.document.layers[0].graph.edges).toBe(originalEdges);
    expect(moved.next?.document.layers[1]).toBe(inactiveLayer);

    const metadata = applyTrustedUiCommands(runtime(document), [{
      op: 'update_layer',
      layerId: 'layer_1',
      patch: { opacity: 0.5 },
    }]);
    expect(metadata.next?.document.layers[0]).not.toBe(activeLayer);
    expect(metadata.next?.document.layers[0].graph).toBe(originalGraph);
    expect(metadata.next?.document.layers[1]).toBe(inactiveLayer);

    const resized = applyTrustedUiCommands(runtime(document), [{
      op: 'set_frame',
      width: 640,
      height: 480,
    }]);
    expect(resized.next?.document.layers).toBe(originalLayers);
  });

  it('trusted UI preserves transient edits without bypassing global resource budgets', () => {
    const document = documentWithOutput();
    const twentyMiB = paddedPngDataUri(DEFAULT_AGENT_LIMITS.maxLegacyAssetBytes);
    for (let index = 1; index <= 3; index++) {
      document.layers[0].graph.nodes[`image_${index}`] = {
        id: `image_${index}`,
        type: 'Image',
        params: { src: twentyMiB },
      };
    }
    document.layers[0].graph.nodes.image_4 = {
      id: 'image_4',
      type: 'Image',
      params: { src: '' },
    };
    const fiveMiB = paddedPngDataUri(5 * 1024 * 1024);
    const application = applyTrustedUiCommands(runtime(document), [{
      op: 'set_node_params',
      layerId: 'layer_1',
      nodeId: 'image_4',
      patch: { src: fiveMiB },
    }]);

    expect(application.result).toMatchObject({
      ok: false,
      error: { code: 'RESOURCE_LIMIT', path: '/document' },
    });
    expect(application.next).toBeUndefined();
    expect(document.layers[0].graph.nodes.image_4.params.src).toBe('');
  });
});
