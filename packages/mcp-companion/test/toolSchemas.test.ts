import * as z from 'zod/v4';
import { describe, expect, it } from 'vitest';
import {
  applyTransactionInputSchema,
  commandSchema,
  getModelStatusInputSchema,
  listAssetsInputSchema,
  prepareModelInputSchema,
  putAssetInputSchema,
  putAssetOutputSchema,
  toolOutcomeSchema,
  transactionSuccessSchema,
} from '../src/toolSchemas.js';
import { assertBoundedWireJson } from '../src/boundedJson.js';
import { COMPANION_TRANSPORT_LIMITS } from '../src/protocol.js';

describe('MCP tool schemas', () => {
  it('accepts every command discriminator and rejects nested unknown fields', () => {
    const commands = [
      { op: 'set_frame', width: 320, height: 240 },
      { op: 'add_layer', clientRef: 'layer' },
      { op: 'update_layer', layerId: 'layer', patch: { visible: true } },
      { op: 'move_layer', layerId: 'layer', index: 0 },
      { op: 'remove_layer', layerId: 'layer' },
      {
        op: 'add_node',
        layerId: 'layer',
        clientRef: 'node',
        nodeType: 'Text',
        params: { text: 'hello' },
      },
      {
        op: 'set_node_params',
        layerId: 'layer',
        nodeId: 'node',
        patch: { text: 'updated' },
      },
      {
        op: 'move_nodes',
        layerId: 'layer',
        positions: [{ nodeId: 'node', position: { x: 1, y: 2 } }],
      },
      { op: 'remove_nodes', layerId: 'layer', nodeIds: ['node'] },
      {
        op: 'connect',
        layerId: 'layer',
        from: { nodeId: 'node', socket: 'out' },
        to: { nodeId: 'output', socket: 'in' },
      },
      {
        op: 'disconnect',
        layerId: 'layer',
        to: { nodeId: 'output', socket: 'in' },
      },
      { op: 'auto_layout_graph', layerId: 'layer', direction: 'LR' },
    ];
    for (const command of commands) {
      expect(commandSchema.safeParse(command).success).toBe(true);
    }
    expect(commandSchema.safeParse({
      op: 'connect',
      layerId: 'layer',
      from: { nodeId: 'node', socket: 'out', extra: true },
      to: { nodeId: 'output', socket: 'in' },
    }).success).toBe(false);
    expect(applyTransactionInputSchema.safeParse({
      requestId: 'request_1',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 320, height: 240 }],
      unknown: true,
    }).success).toBe(false);
    expect(commandSchema.safeParse({
      op: 'add_layer',
      clientRef: 'unicode_layer',
      name: '😀'.repeat(128),
    }).success).toBe(true);
    expect(commandSchema.safeParse({
      op: 'add_layer',
      clientRef: 'unicode_layer',
      name: '😀'.repeat(129),
    }).success).toBe(false);
    expect(JSON.stringify(z.toJSONSchema(commandSchema))).toContain(
      '"name":{"type":"string","minLength":1,"maxLength":128',
    );
  });

  it('publishes one strict success-or-failure structured envelope', () => {
    expect(toolOutcomeSchema.safeParse({
      outcome: { ok: true, value: { revision: 1 } },
    }).success).toBe(true);
    expect(toolOutcomeSchema.safeParse({
      outcome: {
        ok: false,
        revision: 1,
        error: {
          code: 'TYPE_MISMATCH',
          message: 'Socket types differ.',
          recoverable: true,
        },
      },
    }).success).toBe(true);
    expect(toolOutcomeSchema.safeParse({
      outcome: { ok: true, value: {}, extra: true },
    }).success).toBe(false);
  });

  it('keeps commit and persistence semantics internally consistent', () => {
    const common = {
      ok: true as const,
      requestId: 'transaction_request',
      previousRevision: 2,
      revision: 3,
      proposedRevision: 3,
      created: {},
      createdEntities: {},
      changed: {
        frame: false,
        layerIds: [],
        assetIds: [],
        nodes: [],
        edgeCountDelta: 0,
        replacedEdges: [],
      },
      warnings: [],
    };
    for (const value of [
      {
        ...common,
        dryRun: false,
        committed: true,
        transactionId: 'transaction_1',
        persistenceStatus: 'durable',
        renderStatus: {
          state: 'queued',
          ticket: { revision: 3, attempt: 1 },
        },
      },
      {
        ...common,
        dryRun: false,
        committed: true,
        transactionId: 'transaction_1',
        persistenceStatus: 'memory-only',
        renderStatus: {
          state: 'unavailable',
          ticket: null,
        },
      },
      {
        ...common,
        dryRun: true,
        committed: false,
        transactionId: null,
        persistenceStatus: 'not-applicable',
        renderStatus: {
          state: 'not-applicable',
          ticket: null,
        },
      },
    ]) {
      expect(transactionSuccessSchema.safeParse(value).success).toBe(true);
    }
    for (const value of [
      {
        ...common,
        dryRun: false,
        committed: false,
        transactionId: null,
        persistenceStatus: 'durable',
        renderStatus: {
          state: 'not-applicable',
          ticket: null,
        },
      },
      {
        ...common,
        dryRun: false,
        committed: true,
        transactionId: 'transaction_1',
        persistenceStatus: 'not-applicable',
        renderStatus: {
          state: 'queued',
          ticket: { revision: 3, attempt: 1 },
        },
      },
      {
        ...common,
        dryRun: false,
        committed: true,
        transactionId: 'transaction_1',
        persistenceStatus: 'durable',
        renderStatus: {
          state: 'queued',
          ticket: { revision: 2, attempt: 1 },
        },
      },
    ]) {
      expect(transactionSuccessSchema.safeParse(value).success).toBe(false);
    }
  });

  it('requires asset finalize status to match its nested transaction', () => {
    const assetId = `asset_${'a'.repeat(64)}`;
    const commonTransaction = {
      ok: true as const,
      requestId: 'asset_finalize',
      dryRun: false as const,
      previousRevision: 0,
      revision: 1,
      proposedRevision: 1,
      created: {},
      createdEntities: {},
      changed: {
        frame: false,
        layerIds: [],
        assetIds: [assetId],
        nodes: [],
        edgeCountDelta: 0,
        replacedEdges: [],
      },
      warnings: [],
    };
    const commonFinalize = {
      phase: 'finalize' as const,
      revision: 1,
      asset: {
        id: assetId,
        sha256: 'a'.repeat(64),
        mimeType: 'image/png' as const,
        byteLength: 68,
        width: 1,
        height: 1,
        source: 'upload' as const,
      },
    };
    const committed = {
      ...commonFinalize,
      deduplicated: false as const,
      persistenceStatus: 'durable' as const,
      renderStatus: {
        state: 'queued' as const,
        ticket: { revision: 1, attempt: 1 },
      },
      transaction: {
        ...commonTransaction,
        committed: true as const,
        transactionId: 'transaction_1',
        persistenceStatus: 'durable' as const,
        renderStatus: {
          state: 'queued' as const,
          ticket: { revision: 1, attempt: 1 },
        },
      },
    };
    const deduplicated = {
      ...commonFinalize,
      revision: 0,
      deduplicated: true as const,
      persistenceStatus: 'not-applicable' as const,
      renderStatus: {
        state: 'queued' as const,
        ticket: { revision: 0, attempt: 2 },
      },
      transaction: {
        ...commonTransaction,
        revision: 0,
        proposedRevision: 0,
        committed: false as const,
        transactionId: null,
        persistenceStatus: 'not-applicable' as const,
        renderStatus: {
          state: 'not-applicable' as const,
          ticket: null,
        },
      },
    };
    for (const value of [
      committed,
      { ...committed, deduplicated: true },
      deduplicated,
      { ...deduplicated, deduplicated: false },
    ]) {
      expect(putAssetOutputSchema.safeParse({
        outcome: { ok: true, value },
      }).success).toBe(true);
    }
    expect(putAssetOutputSchema.safeParse({
      outcome: {
        ok: true,
        value: { ...committed, persistenceStatus: 'memory-only' },
      },
    }).success).toBe(false);
    expect(putAssetOutputSchema.safeParse({
      outcome: {
        ok: true,
        value: { ...committed, revision: 2 },
      },
    }).success).toBe(false);
    expect(putAssetOutputSchema.safeParse({
      outcome: {
        ok: true,
        value: {
          ...committed,
          renderStatus: {
            state: 'queued',
            ticket: { revision: 1, attempt: 2 },
          },
        },
      },
    }).success).toBe(false);
    expect(putAssetOutputSchema.safeParse({
      outcome: {
        ok: true,
        value: {
          ...deduplicated,
          transaction: {
            ...deduplicated.transaction,
            dryRun: true,
            proposedRevision: 1,
          },
        },
      },
    }).success).toBe(false);
  });

  it('accepts every asset-upload phase and bounds a full binary chunk', () => {
    const uploadId = `upload_${'a'.repeat(22)}`;
    const requestId = 'asset_request';
    const sha256 = '0'.repeat(64);
    const maxChunkBase64 =
      Buffer.alloc(1024 * 1024).toString('base64');
    const phases = [
      {
        phase: 'begin',
        requestId,
        mimeType: 'image/png',
        byteLength: 1024 * 1024,
        sha256,
      },
      {
        phase: 'chunk',
        requestId,
        uploadId,
        offset: 0,
        dataBase64: maxChunkBase64,
        chunkSha256: sha256,
      },
      { phase: 'status', uploadId },
      {
        phase: 'finalize',
        requestId,
        uploadId,
        expectedRevision: 4,
      },
      { phase: 'abort', requestId, uploadId },
    ];
    for (const phase of phases) {
      expect(putAssetInputSchema.safeParse(phase).success).toBe(true);
    }
    const wireBytes = Buffer.byteLength(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'gfx_put_asset',
        arguments: phases[1],
      },
    }));
    expect(maxChunkBase64).toHaveLength(1_398_104);
    expect(wireBytes).toBeLessThan(
      COMPANION_TRANSPORT_LIMITS.maxTextMessageBytes,
    );
    expect(wireBytes).toBeLessThan(
      COMPANION_TRANSPORT_LIMITS.maxStdioLineBytes,
    );
  });

  it('rejects non-canonical base64, authority fields, and unbounded cursors', () => {
    const base = {
      phase: 'chunk',
      requestId: 'asset_chunk',
      uploadId: `upload_${'a'.repeat(22)}`,
      offset: 0,
      chunkSha256: '0'.repeat(64),
    };
    for (const dataBase64 of [
      'YR==',
      'YWIx=',
      'Y Q=',
      'A'.repeat(1_398_108),
    ]) {
      expect(putAssetInputSchema.safeParse({
        ...base,
        dataBase64,
      }).success).toBe(false);
    }
    expect(putAssetInputSchema.safeParse({
      phase: 'begin',
      requestId: 'asset_begin',
      mimeType: 'image/png',
      byteLength: 1,
      sha256: '0'.repeat(64),
      url: 'https://example.test/tracker.png',
    }).success).toBe(false);
    expect(listAssetsInputSchema.safeParse({
      cursor: `r${'1'.repeat(64)}_o0`,
    }).success).toBe(false);
  });

  it('keeps model tools pathless and human approval out of MCP input', () => {
    expect(getModelStatusInputSchema.safeParse({}).success).toBe(true);
    expect(prepareModelInputSchema.safeParse({
      requestId: 'model-status-check',
    }).success).toBe(true);
    for (const forbidden of [
      { approved: true },
      { path: '/tmp/model.onnx' },
      { url: 'https://attacker.invalid/model.onnx' },
      { manifestSha256: '0'.repeat(64) },
    ]) {
      expect(prepareModelInputSchema.safeParse({
        requestId: 'model-status-check',
        ...forbidden,
      }).success).toBe(false);
    }
  });

  it('rejects deep or prototype-sensitive dynamic JSON iteratively', () => {
    let deep: unknown = 'leaf';
    for (let index = 0; index < 130; index++) deep = [deep];
    expect(() => assertBoundedWireJson(deep)).toThrow('depth or value');
    expect(() => assertBoundedWireJson(
      JSON.parse('{"__proto__":{"polluted":true}}'),
    )).toThrow('prototype-sensitive');
  });
});
