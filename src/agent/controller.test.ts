import { describe, expect, it, vi } from 'vitest';
import type { Doc } from '../engine/graph';
import {
  createSerializedProject,
  type AssetMetadata,
} from '../domain/documentSchema';
import type {
  PublicModelState,
  PublicModelStatus,
} from '../../packages/mcp-companion/src/modelPublicContract';
import type { TransactionPolicyContext } from '../domain/transactionSession';
import { sha256BytesHex } from '../domain/sha256';
import type { PreviewResult } from '../render/preview';
import {
  controllerMethodNames,
  createAgentController,
  createModelTransactionPolicy,
  type AgentControllerDependencies,
} from './controller';
import type { AgentScope } from './contracts';
import { PreviewHandleVault } from './previewVault';
import {
  AgentSessionManager,
} from './sessionManager';

const origin = 'http://127.0.0.1:5199';

function documentWith(nodeType = 'Output'): Doc {
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
          node_1: {
            id: 'node_1',
            type: nodeType,
            params: nodeType === 'Output' ? { transparent: true } : {},
          },
        },
        edges: [],
      },
    }],
  };
}

function uploadedAsset(hex = 'a'): AssetMetadata {
  const sha256 = hex.repeat(64);
  return {
    id: `asset_${sha256}`,
    sha256,
    mimeType: 'image/png',
    byteLength: 68,
    width: 1,
    height: 1,
    source: 'upload',
  };
}

function modelStatus(state: PublicModelState): PublicModelStatus {
  return {
    schemaVersion: 1,
    modelKey: 'rmbg-1.4',
    revision: '2ceba5a5efaec153162aedea169f76caf9b46cf8',
    manifestSha256:
      '561ce573597fda1b7b540f7e5929c5f47fcfdce65c33f7f581aa0c3da9eaa269',
    state,
    bytes: state === 'ready' ? 220_556_926 : 0,
    totalBytes: 220_556_926,
    artifacts: [],
    license: {
      id: 'bria-rmbg-1.4',
      name: 'BRIA RMBG 1.4 Model License',
      summary: 'fixture',
      commercialUse: 'separate-agreement-required',
      requiresExplicitApproval: true,
    },
  };
}

function paired(scopes: AgentScope[]) {
  let random = 0;
  const manager = new AgentSessionManager({
    allowedOrigin: origin,
    context: () => ({
      origin,
      host: '127.0.0.1:5199',
      hostname: '127.0.0.1',
      protocol: 'http:',
      topLevel: true,
      secureContext: true,
    }),
    randomBytes: (length) => new Uint8Array(length).fill(++random),
    setTimer: (() => 1) as unknown as typeof setTimeout,
    clearTimer: vi.fn(),
  });
  manager.armPairing();
  const challenge = manager.requestPairing({
    protocolVersion: '1.0',
    clientNonce: 'A'.repeat(43),
    clientLabel: 'controller test',
    requestedScopes: scopes,
  });
  if (!challenge.ok) throw new Error('request failed');
  manager.approvePairing(scopes);
  const completed = manager.completePairing({
    pairingId: challenge.value.pairingId,
    clientNonce: challenge.value.clientNonce,
    serverNonce: challenge.value.serverNonce,
    claimToken: challenge.value.claimToken,
  });
  if (!completed.ok) throw new Error('complete failed');
  return { manager, lease: completed.value.lease };
}

function rawPreview(): PreviewResult {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  return {
    requestedRevision: 0,
    revision: 0,
    attempt: 1,
    sourceWidth: 1,
    sourceHeight: 1,
    width: 1,
    height: 1,
    mimeType: 'image/png',
    byteLength: 3,
    contentHash: 'a'.repeat(64),
    rgbaSha256: 'b'.repeat(64),
    capturePolicy: 'current-exact-ticket-v1',
    image: {
      kind: 'inline-array-buffer-v1',
      mimeType: 'image/png',
      byteLength: 3,
      contentHash: 'a'.repeat(64),
      trust: 'untrusted-document-render',
      bytes,
    },
  };
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function dependencies() {
  let revision = 0;
  let document = documentWith();
  let applyCalls = 0;
  const deps: AgentControllerDependencies = {
    getDocumentState: () => ({
      documentId: 'document_1',
      document,
      revision,
    }),
    applyTransaction: (_lease, request, policy, beforeFinalize) => {
      applyCalls++;
      const requestId = (request as { requestId: string }).requestId;
      const proposed = {
        documentId: 'document_1',
        document,
        revision: revision + 1,
      };
      const denied = policy({
        kind: 'apply',
        current: {
          documentId: 'document_1',
          document,
          revision,
        },
        proposed,
        requestId,
      });
      if (denied) return denied;
      beforeFinalize();
      const previousRevision = revision;
      revision++;
      return {
        ok: true,
        requestId,
        dryRun: false,
        committed: true,
        transactionId: 'transaction_1',
        previousRevision,
        revision,
        proposedRevision: revision,
        created: {},
        createdEntities: {},
        changed: {
          frame: true,
          layerIds: [],
          assetIds: [],
          nodes: [],
          edgeCountDelta: 0,
          replacedEdges: [],
        },
        warnings: [],
      };
    },
    revertTransaction: (_lease, request) => ({
      ok: false,
      requestId: (request as { requestId: string }).requestId,
      revision,
      error: {
        code: 'INVALID_ARGUMENT',
        message: 'not in fake ledger',
        recoverable: true,
      },
    }),
    storeAsset: async () => {
      throw new Error('not used by this test');
    },
    discardStoredAsset: async () => false,
    registerLeaseRetention: () => undefined,
    isAssetAvailable: async () => false,
    settlePersistence: () => 'durable',
    getModelStatus: async () => modelStatus('ready'),
    setModelExecutionAuthorization: () => undefined,
    applyAssetMutation: (_lease, mutation) => ({
      ok: false,
      requestId: mutation.requestId,
      revision,
      error: {
        code: 'INVALID_ARGUMENT',
        message: 'not used by this test',
        recoverable: true,
      },
    }),
    getRenderStatus: (request) => ({
      documentRevision: revision,
      ticket: {
        revision: request.revision ?? revision,
        attempt: request.attempt ?? 1,
      },
      displayedTicket: null,
      displayedRevision: null,
      requestedRevision: request.revision ?? revision,
      renderRevision: request.revision ?? revision,
      state: 'complete',
      width: 320,
      height: 240,
    }),
    retryRender: () => ({
      documentRevision: revision,
      ticket: {
        revision,
        attempt: 2,
      },
      displayedTicket: null,
      displayedRevision: null,
      requestedRevision: revision,
      renderRevision: null,
      state: 'queued',
    }),
    awaitRender: async (request) => ({
      documentRevision: revision,
      ticket: {
        revision: request.revision,
        attempt: request.attempt ?? 1,
      },
      displayedTicket: {
        revision: request.revision,
        attempt: request.attempt ?? 1,
      },
      displayedRevision: request.revision,
      requestedRevision: request.revision,
      renderRevision: request.revision,
      state: 'complete',
      width: 320,
      height: 240,
    }),
    capturePreview: async () => rawPreview(),
    nowPerformance: () => 100,
  };
  return {
    deps,
    setDocument: (next: Doc) => {
      document = next;
    },
    applyCalls: () => applyCalls,
    revision: () => revision,
  };
}

function vault(): PreviewHandleVault {
  return new PreviewHandleVault({
    randomId: () => 'preview_test',
    createObjectUrl: () => 'blob:test/preview',
    revokeObjectUrl: vi.fn(),
    setTimer: (() => 1) as unknown as typeof setTimeout,
    clearTimer: vi.fn(),
  });
}

describe('AgentController', () => {
  it('exposes exactly the frozen named allowlist without internal capabilities', () => {
    const session = paired(['read']);
    const fake = dependencies();
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );
    expect(Object.keys(controller)).toEqual(controllerMethodNames());
    expect(Object.isFrozen(controller)).toBe(true);
    expect(Object.isExtensible(controller)).toBe(false);
    expect(controller).not.toHaveProperty('call');
    expect(controller).not.toHaveProperty('getState');
    expect(controller).not.toHaveProperty('store');
    expect(controller).not.toHaveProperty('gpu');
    expect(controller).not.toHaveProperty('fonts');
    expect(controller.getDocument()).toMatchObject({
      trust: 'untrusted-document-content',
      revision: 0,
    });
  });

  it('enforces independent read, preview, and edit scopes before side effects', async () => {
    const session = paired(['read']);
    const fake = dependencies();
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );
    await expect(controller.capturePreview({ revision: 0 })).rejects.toMatchObject({
      error: { code: 'PERMISSION_REQUIRED' },
    });
    await expect(controller.applyTransaction({
      requestId: 'denied',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    })).rejects.toMatchObject({
      error: { code: 'PERMISSION_REQUIRED' },
    });
    expect(fake.applyCalls()).toBe(0);
    expect(fake.revision()).toBe(0);
  });

  it('reports commit, render, and persistence separately and replays effect evidence', async () => {
    const session = paired(['edit']);
    const fake = dependencies();
    const settlePersistence = vi.fn(() => 'durable' as const);
    const getRenderStatus = vi.fn(fake.deps.getRenderStatus);
    fake.deps.settlePersistence = settlePersistence;
    fake.deps.getRenderStatus = getRenderStatus;
    fake.deps.applyTransaction = vi.fn((_lease, request) => {
      const captured = request as {
        requestId: string;
        dryRun?: boolean;
      };
      const committed = captured.dryRun !== true;
      return {
        ok: true as const,
        requestId: captured.requestId,
        dryRun: captured.dryRun === true,
        committed,
        transactionId: committed ? 'transaction_effects' : null,
        previousRevision: 0,
        revision: committed ? 1 : 0,
        proposedRevision: 1,
        created: {},
        createdEntities: {},
        changed: {
          frame: committed,
          layerIds: [],
          assetIds: [],
          nodes: [],
          edgeCountDelta: 0,
          replacedEdges: [],
        },
        warnings: [],
      };
    });
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );
    const request = {
      requestId: 'effect_evidence',
      expectedRevision: 0,
      commands: [{ op: 'set_frame' as const, width: 640, height: 480 }],
    };

    const first = await controller.applyTransaction(request);
    const replay = await controller.applyTransaction(request);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      ok: true,
      committed: true,
      persistenceStatus: 'durable',
      renderStatus: {
        state: 'complete',
        ticket: { revision: 1, attempt: 1 },
      },
    });
    expect(settlePersistence).toHaveBeenCalledOnce();
    expect(getRenderStatus).toHaveBeenCalledOnce();

    const dryRun = await controller.applyTransaction({
      ...request,
      requestId: 'effect_evidence_dry_run',
      dryRun: true,
    });
    expect(dryRun).toMatchObject({
      ok: true,
      dryRun: true,
      committed: false,
      persistenceStatus: 'not-applicable',
      renderStatus: {
        state: 'not-applicable',
        ticket: null,
      },
    });
    expect(settlePersistence).toHaveBeenCalledOnce();
    expect(getRenderStatus).toHaveBeenCalledOnce();
  });

  it('checks CAS integrity for renderable current and proposed validation only', async () => {
    const session = paired(['read']);
    const fake = dependencies();
    const document = documentWith();
    const metadata = uploadedAsset();
    fake.deps.getDocumentState = () => ({
      documentId: 'document_1',
      document,
      assets: [metadata],
      revision: 0,
    });
    const isAssetAvailable = vi.fn(
      async (_metadata: AssetMetadata) => false,
    );
    fake.deps.isAssetAvailable = isAssetAvailable;
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );
    const project = createSerializedProject(
      'proposed_document',
      document,
      [metadata],
    );

    for (const request of [
      { source: 'current' as const, mode: 'renderable' as const },
      {
        source: 'project' as const,
        mode: 'renderable' as const,
        project: project as never,
      },
    ]) {
      const result = await controller.validateDocument(request);
      expect(result.report).toMatchObject({
        valid: false,
        mode: 'renderable',
        errors: [expect.objectContaining({
          code: 'PERSISTENCE_FAILED',
          path: '/assets/0',
          details: { assetId: metadata.id },
        })],
      });
    }
    expect(isAssetAvailable).toHaveBeenCalledTimes(2);
    for (const [candidate] of isAssetAvailable.mock.calls) {
      expect(candidate).toEqual(metadata);
    }

    isAssetAvailable.mockClear();
    await expect(controller.validateDocument({
      source: 'current',
      mode: 'structural',
    })).resolves.toMatchObject({
      report: { valid: true, mode: 'structural' },
    });
    await expect(controller.validateDocument({
      source: 'current',
      mode: 'editable',
    })).resolves.toMatchObject({
      report: { valid: true, mode: 'editable' },
    });
    await expect(controller.validateDocument({
      source: 'project',
      mode: 'structural',
      project: project as never,
    })).resolves.toMatchObject({
      report: { valid: true, mode: 'structural' },
    });
    await expect(controller.validateDocument({
      source: 'project',
      mode: 'editable',
      project: project as never,
    })).resolves.toMatchObject({
      report: { valid: true, mode: 'editable' },
    });
    expect(isAssetAvailable).not.toHaveBeenCalled();
  });

  it('uses complete integrity metadata for list/get asset availability', async () => {
    const session = paired(['assets']);
    const fake = dependencies();
    const document = documentWith();
    const metadata = uploadedAsset('b');
    fake.deps.getDocumentState = () => ({
      documentId: 'document_1',
      document,
      assets: [metadata],
      revision: 0,
    });
    const isAssetAvailable = vi.fn(
      async (_metadata: AssetMetadata) => false,
    )
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    fake.deps.isAssetAvailable = isAssetAvailable;
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );

    await expect(controller.listAssets()).resolves.toMatchObject({
      revision: 0,
      assets: [{
        metadata,
        availability: 'missing',
      }],
    });
    await expect(controller.getAssetMetadata({
      assetId: metadata.id,
    })).resolves.toMatchObject({
      metadata,
      availability: 'available',
    });
    expect(isAssetAvailable).toHaveBeenCalledTimes(2);
    for (const [candidate] of isAssetAvailable.mock.calls) {
      expect(candidate).toEqual(metadata);
      expect(Object.keys(candidate).sort()).toEqual(
        Object.keys(metadata).sort(),
      );
    }
  });

  it('accepts an exact 1 MiB asset chunk at the controller boundary', async () => {
    const session = paired(['assets']);
    const fake = dependencies();
    const bytes = new Uint8Array(1024 * 1024).fill(0xa5);
    const digest = sha256BytesHex(bytes);
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );

    const begun = await controller.putAsset({
      phase: 'begin',
      requestId: 'asset_mib_begin',
      mimeType: 'image/png',
      byteLength: bytes.byteLength,
      sha256: digest,
    });
    if (begun.phase !== 'begin') throw new Error('expected begin result');
    const chunked = await controller.putAsset({
      phase: 'chunk',
      requestId: 'asset_mib_chunk',
      uploadId: begun.upload.uploadId,
      offset: 0,
      dataBase64: base64(bytes),
      chunkSha256: digest,
    });

    expect(chunked).toMatchObject({
      phase: 'chunk',
      revision: 0,
      upload: {
        byteLength: 1024 * 1024,
        chunkBytes: 1024 * 1024,
        receivedBytes: 1024 * 1024,
        nextOffset: 1024 * 1024,
        complete: true,
      },
    });
  });

  it.each([
    { newlyStored: true, deduplicated: false, storageCase: 'new CAS bytes' },
    { newlyStored: false, deduplicated: true, storageCase: 'existing CAS bytes' },
  ])(
    'finalizes $storageCase once and replays without touching bytes again',
    async ({ newlyStored, deduplicated }) => {
    const session = paired(['assets']);
    const fake = dependencies();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const digest = sha256BytesHex(bytes);
    const metadata = {
      id: `asset_${digest}`,
      sha256: digest,
      mimeType: 'image/png' as const,
      byteLength: bytes.byteLength,
      width: 1,
      height: 1,
      source: 'upload' as const,
    };
    const releaseRetention = vi.fn();
    const storeAsset = vi.fn(async () => ({
      metadata,
      newlyStored,
      releaseRetention,
    }));
    const applyAssetMutation = vi.fn((_lease, mutation) => ({
      ok: true as const,
      requestId: mutation.requestId,
      dryRun: false as const,
      committed: true,
      transactionId: 'transaction_1',
      previousRevision: 0,
      revision: 1,
      proposedRevision: 1,
      created: {},
      createdEntities: {},
      changed: {
        frame: false,
        layerIds: [],
        assetIds: [metadata.id],
        nodes: [],
        edgeCountDelta: 0,
        replacedEdges: [],
      },
      warnings: [],
    }));
    const settlePersistence = vi.fn(() => 'durable' as const);
    const getRenderStatus = vi.fn(fake.deps.getRenderStatus);
    fake.deps.storeAsset = storeAsset;
    fake.deps.applyAssetMutation = applyAssetMutation;
    fake.deps.settlePersistence = settlePersistence;
    fake.deps.getRenderStatus = getRenderStatus;
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );

    const begun = await controller.putAsset({
      phase: 'begin',
      requestId: 'asset_begin',
      mimeType: metadata.mimeType,
      byteLength: bytes.byteLength,
      sha256: digest,
    });
    if (begun.phase !== 'begin') throw new Error('expected begin result');
    await controller.putAsset({
      phase: 'chunk',
      requestId: 'asset_chunk',
      uploadId: begun.upload.uploadId,
      offset: 0,
      dataBase64: base64(bytes),
      chunkSha256: digest,
    });
    const request = {
      phase: 'finalize' as const,
      requestId: 'asset_finalize',
      uploadId: begun.upload.uploadId,
      expectedRevision: 0,
    };
    const first = await controller.putAsset(request);
    const replay = await controller.putAsset(request);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      phase: 'finalize',
      revision: 1,
      deduplicated,
      persistenceStatus: 'durable',
      renderStatus: {
        state: 'complete',
        ticket: { revision: 1, attempt: 1 },
      },
      transaction: {
        ok: true,
        changed: { assetIds: [metadata.id] },
        persistenceStatus: 'durable',
        renderStatus: {
          state: 'complete',
          ticket: { revision: 1, attempt: 1 },
        },
      },
    });
    expect(storeAsset).toHaveBeenCalledOnce();
    expect(applyAssetMutation).toHaveBeenCalledOnce();
    expect(settlePersistence).toHaveBeenCalledOnce();
    expect(getRenderStatus).toHaveBeenCalledOnce();
    expect(releaseRetention).toHaveBeenCalledOnce();
    await expect(controller.putAsset({
      ...request,
      expectedRevision: 1,
    })).rejects.toMatchObject({
      error: { code: 'REQUEST_ID_REUSED' },
    });
    },
  );

  it('reports a committed asset as memory-only when its manifest checkpoint fails', async () => {
    const session = paired(['assets']);
    const fake = dependencies();
    const bytes = new Uint8Array([5, 6, 7, 8]);
    const digest = sha256BytesHex(bytes);
    const metadata = {
      id: `asset_${digest}`,
      sha256: digest,
      mimeType: 'image/png' as const,
      byteLength: bytes.byteLength,
      width: 1,
      height: 1,
      source: 'upload' as const,
    };
    fake.deps.storeAsset = async () => ({
      metadata,
      newlyStored: true,
    });
    fake.deps.applyAssetMutation = (_lease, mutation) => ({
      ok: true,
      requestId: mutation.requestId,
      dryRun: false,
      committed: true,
      transactionId: 'transaction_memory_only',
      previousRevision: 0,
      revision: 1,
      proposedRevision: 1,
      created: {},
      createdEntities: {},
      changed: {
        frame: false,
        layerIds: [],
        assetIds: [metadata.id],
        nodes: [],
        edgeCountDelta: 0,
        replacedEdges: [],
      },
      warnings: [],
    });
    fake.deps.settlePersistence = () => {
      throw new Error('quota');
    };
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );

    const begun = await controller.putAsset({
      phase: 'begin',
      requestId: 'asset_memory_begin',
      mimeType: metadata.mimeType,
      byteLength: bytes.byteLength,
      sha256: digest,
    });
    if (begun.phase !== 'begin') throw new Error('expected begin result');
    await controller.putAsset({
      phase: 'chunk',
      requestId: 'asset_memory_chunk',
      uploadId: begun.upload.uploadId,
      offset: 0,
      dataBase64: base64(bytes),
      chunkSha256: digest,
    });
    const result = await controller.putAsset({
      phase: 'finalize',
      requestId: 'asset_memory_finalize',
      uploadId: begun.upload.uploadId,
      expectedRevision: 0,
    });

    expect(result).toMatchObject({
      phase: 'finalize',
      revision: 1,
      persistenceStatus: 'memory-only',
      transaction: {
        ok: true,
        committed: true,
      },
    });
  });

  it.each([
    { newlyStored: false, deduplicated: true, storageCase: 'existing CAS bytes' },
    { newlyStored: true, deduplicated: false, storageCase: 'restored CAS bytes' },
  ])(
    'separates $storageCase from a manifest no-op and retries rendering',
    async ({ newlyStored, deduplicated }) => {
    const session = paired(['assets']);
    const fake = dependencies();
    const bytes = new Uint8Array([13, 14, 15, 16]);
    const digest = sha256BytesHex(bytes);
    const metadata = {
      id: `asset_${digest}`,
      sha256: digest,
      mimeType: 'image/png' as const,
      byteLength: bytes.byteLength,
      width: 1,
      height: 1,
      source: 'upload' as const,
    };
    fake.deps.storeAsset = async () => ({
      metadata,
      newlyStored,
    });
    fake.deps.applyAssetMutation = (_lease, mutation) => ({
      ok: true,
      requestId: mutation.requestId,
      dryRun: false,
      committed: false,
      transactionId: null,
      previousRevision: 0,
      revision: 0,
      proposedRevision: 0,
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
    });
    const settlePersistence = vi.fn(() => 'durable' as const);
    const retryRender = vi.fn(fake.deps.retryRender);
    fake.deps.settlePersistence = settlePersistence;
    fake.deps.retryRender = retryRender;
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );

    const begun = await controller.putAsset({
      phase: 'begin',
      requestId: 'asset_dedupe_begin',
      mimeType: metadata.mimeType,
      byteLength: bytes.byteLength,
      sha256: digest,
    });
    if (begun.phase !== 'begin') throw new Error('expected begin result');
    await controller.putAsset({
      phase: 'chunk',
      requestId: 'asset_dedupe_chunk',
      uploadId: begun.upload.uploadId,
      offset: 0,
      dataBase64: base64(bytes),
      chunkSha256: digest,
    });
    const result = await controller.putAsset({
      phase: 'finalize',
      requestId: 'asset_dedupe_finalize',
      uploadId: begun.upload.uploadId,
      expectedRevision: 0,
    });

    expect(result).toMatchObject({
      phase: 'finalize',
      revision: 0,
      deduplicated,
      persistenceStatus: 'not-applicable',
      renderStatus: {
        state: 'queued',
        ticket: { revision: 0, attempt: 2 },
      },
      transaction: {
        ok: true,
        committed: false,
        persistenceStatus: 'not-applicable',
        renderStatus: {
          state: 'not-applicable',
          ticket: null,
        },
      },
    });
    expect(settlePersistence).not.toHaveBeenCalled();
    expect(retryRender).toHaveBeenCalledOnce();
    },
  );

  it('discards newly-created CAS bytes when finalize loses its revision race', async () => {
    const session = paired(['assets']);
    const fake = dependencies();
    const bytes = new Uint8Array([9, 10, 11, 12]);
    const digest = sha256BytesHex(bytes);
    const metadata = {
      id: `asset_${digest}`,
      sha256: digest,
      mimeType: 'image/png' as const,
      byteLength: bytes.byteLength,
      width: 1,
      height: 1,
      source: 'upload' as const,
    };
    fake.deps.storeAsset = async () => ({
      metadata,
      newlyStored: true,
    });
    fake.deps.applyAssetMutation = (_lease, mutation) => ({
      ok: false,
      requestId: mutation.requestId,
      revision: 1,
      error: {
        code: 'REVISION_CONFLICT',
        message: 'stale',
        recoverable: true,
      },
    });
    const discardStoredAsset = vi.fn(async () => true);
    fake.deps.discardStoredAsset = discardStoredAsset;
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );
    const begun = await controller.putAsset({
      phase: 'begin',
      requestId: 'asset_stale_begin',
      mimeType: metadata.mimeType,
      byteLength: bytes.byteLength,
      sha256: digest,
    });
    if (begun.phase !== 'begin') throw new Error('expected begin');
    await controller.putAsset({
      phase: 'chunk',
      requestId: 'asset_stale_chunk',
      uploadId: begun.upload.uploadId,
      offset: 0,
      dataBase64: base64(bytes),
      chunkSha256: digest,
    });

    await expect(controller.putAsset({
      phase: 'finalize',
      requestId: 'asset_stale_finalize',
      uploadId: begun.upload.uploadId,
      expectedRevision: 0,
    })).rejects.toMatchObject({
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(discardStoredAsset).toHaveBeenCalledWith(metadata.id);
  });

  it('maps preview bytes to a bounded JSON handle and never exposes ArrayBuffer', async () => {
    const session = paired(['preview']);
    const fake = dependencies();
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );
    const result = await controller.capturePreview({ revision: 0 });
    expect(result).toMatchObject({
      trust: 'untrusted-document-render',
      image: {
        kind: 'browser-object-url-v1',
        url: 'blob:test/preview',
      },
    });
    expect(result.image).not.toHaveProperty('bytes');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(structuredClone(result)).toEqual(result);
  });

  it('keeps transport cancellation on a private companion controller', async () => {
    const session = paired(['read']);
    const fake = dependencies();
    let observedSignal: AbortSignal | undefined;
    const aborted = vi.fn();
    fake.deps.awaitRender = async (request) => {
      observedSignal = request.signal;
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          aborted();
          reject(request.signal?.reason);
        };
        request.signal?.addEventListener('abort', onAbort, { once: true });
        if (request.signal?.aborted) onAbort();
        void resolve;
      });
    };
    const { controller, companionController } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );
    expect(controller).not.toHaveProperty('companionController');
    expect(controller).not.toHaveProperty('signal');

    const transport = new AbortController();
    const pending = companionController.awaitRender(
      { revision: 0 },
      transport.signal,
    );
    await expect.poll(() => observedSignal).toBeInstanceOf(AbortSignal);
    expect(observedSignal).not.toBe(transport.signal);
    transport.abort(new DOMException('cancelled by MCP', 'AbortError'));

    await expect(pending).rejects.toMatchObject({
      error: { code: 'INTERNAL' },
    });
    expect(aborted).toHaveBeenCalledOnce();
    expect(observedSignal?.aborted).toBe(true);
  });

  it('fails retained controller references after human revoke', () => {
    const session = paired(['read']);
    const fake = dependencies();
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );
    session.manager.revoke('human');
    let failure: unknown;
    try {
      controller.getCapabilities();
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      error: { code: 'SESSION_REVOKED' },
    });
  });

  it('does not return render status when authorization is revoked mid-query', () => {
    const session = paired(['read']);
    const fake = dependencies();
    const original = fake.deps.getRenderStatus;
    fake.deps.getRenderStatus = (request) => {
      const status = original(request);
      session.manager.revoke('human');
      return status;
    };
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );
    expect(() => controller.getRenderStatus()).toThrow();
    try {
      controller.getRenderStatus();
    } catch (failure) {
      expect(failure).toMatchObject({
        error: { code: 'SESSION_REVOKED' },
      });
    }
  });

  it('rejects hostile accessors before calling the transaction host', async () => {
    const session = paired(['edit']);
    const fake = dependencies();
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );
    const getter = vi.fn(() => 'hostile');
    const request = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(request, 'requestId', {
      enumerable: true,
      get: getter,
    });
    request.expectedRevision = 0;
    request.commands = [];
    await expect(
      controller.applyTransaction(request as never),
    ).rejects.toMatchObject({
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(getter).not.toHaveBeenCalled();
    expect(fake.applyCalls()).toBe(0);
  });

  it('normalizes hostile Proxy traps on every public controller boundary', async () => {
    const session = paired(['read', 'edit', 'preview']);
    const fake = dependencies();
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );
    const hostile = new Proxy(Object.create(null), {
      getPrototypeOf() {
        throw new Error('raw-proxy-secret-stack');
      },
      ownKeys() {
        throw new Error('raw-proxy-secret-stack');
      },
    });
    const calls = [
      () => controller.getCapabilities(hostile as never),
      () => controller.getDocument(hostile as never),
      () => controller.validateDocument(hostile as never),
      () => controller.getRenderStatus(hostile as never),
      () => controller.applyTransaction(hostile as never),
      () => controller.awaitRender(hostile as never),
      () => controller.capturePreview(hostile as never),
      () => controller.revertTransaction(hostile as never),
    ];
    for (const call of calls) {
      let failure: unknown;
      try {
        await call();
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        name: 'AgentControllerFault',
        ok: false,
        revision: 0,
        error: {
          code: 'INTERNAL',
          recoverable: false,
        },
      });
      const serialized = JSON.stringify(failure);
      expect(serialized).not.toContain('raw-proxy-secret-stack');
      expect(serialized).not.toContain('stack');
      expect(structuredClone(failure)).toEqual(failure);
    }
  });

  it('bounds and redacts transaction failure diagnostics from the host', async () => {
    const session = paired(['edit']);
    const fake = dependencies();
    const secret = 'transaction-secret-that-must-not-survive';
    const hugePath = `/${'x'.repeat(8_000)}`;
    fake.deps.revertTransaction = (_lease, request) => ({
      ok: false,
      requestId: (request as { requestId: string }).requestId,
      revision: 0,
      error: {
        code: 'INVALID_ARGUMENT',
        message: `failed data:;base64,${secret} claimToken=${secret} ${
          'm'.repeat(8_000)
        }`,
        path: hugePath,
        details: {
          claimToken: secret,
          [`data:;base64,${secret}${'k'.repeat(2_000)}`]: secret,
        },
        recoverable: true,
        suggestedFix: `do not use blob:http://127.0.0.1/${secret}`,
      },
    });
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );
    const result = await controller.revertTransaction({
      requestId: 'diagnostic_boundary',
      expectedRevision: 0,
      transactionId: 'transaction_1',
    });
    const serialized = JSON.stringify(result);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(serialized).not.toContain(secret);
    expect(serialized.length).toBeLessThan(3_000);
    expect(serialized).toContain('truncated');
    expect(structuredClone(result)).toEqual(result);
  });

  it('requires model scope and a ready integrity-verified local model', () => {
    const proposed = {
      documentId: 'document_1',
      document: documentWith('RemoveBackground'),
      revision: 1,
    };
    const context: TransactionPolicyContext = {
      kind: 'apply',
      current: {
        documentId: 'document_1',
        document: documentWith(),
        revision: 0,
      },
      proposed,
      requestId: 'model',
    };
    expect(createModelTransactionPolicy({
      scopes: new Set<AgentScope>(['edit']),
    })(context)).toMatchObject({
      error: { code: 'PERMISSION_REQUIRED' },
    });
    expect(createModelTransactionPolicy({
      scopes: new Set<AgentScope>(['edit', 'model']),
    })(context)).toMatchObject({
      error: { code: 'MODEL_DOWNLOAD_REQUIRED' },
    });
    expect(createModelTransactionPolicy({
      scopes: new Set<AgentScope>(['edit', 'model']),
    }, {
      modelReady: true,
    })(context)).toBeNull();
  });

  it('commits a model-backed proposal only after the pinned model reports ready', async () => {
    const session = paired(['edit', 'model']);
    const fake = dependencies();
    fake.setDocument(documentWith('RemoveBackground'));
    const getModelStatus = vi.fn(
      async (_signal: AbortSignal) => modelStatus('ready'),
    );
    fake.deps.getModelStatus = getModelStatus;
    const hostApply = vi.spyOn(fake.deps, 'applyTransaction');
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );

    await expect(controller.applyTransaction({
      requestId: 'model_ready_apply',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    })).resolves.toMatchObject({
      ok: true,
      committed: true,
      revision: 1,
    });
    expect(getModelStatus).toHaveBeenCalledOnce();
    expect(getModelStatus).toHaveBeenCalledWith(session.lease.signal);
    expect(hostApply).toHaveBeenCalledOnce();
    expect(fake.revision()).toBe(1);
  });

  it.each([
    ['not-installed', false],
    ['request-failure', true],
  ] as const)(
    'denies a model-backed proposal with stable MODEL_DOWNLOAD_REQUIRED on %s',
    async (_caseName, rejectStatus) => {
      const session = paired(['edit', 'model']);
      const fake = dependencies();
      fake.setDocument(documentWith('RemoveBackground'));
      const getModelStatus = vi.fn(
        async (_signal: AbortSignal) => {
          if (rejectStatus) throw new Error('local status unavailable');
          return modelStatus('not-installed');
        },
      );
      fake.deps.getModelStatus = getModelStatus;
      const hostApply = vi.spyOn(fake.deps, 'applyTransaction');
      const { controller } = createAgentController(
        session.manager,
        session.lease,
        fake.deps,
        vault(),
      );

      await expect(controller.applyTransaction({
        requestId: `model_not_ready_${rejectStatus ? 'error' : 'state'}`,
        expectedRevision: 0,
        commands: [{ op: 'set_frame', width: 640, height: 480 }],
      })).resolves.toMatchObject({
        ok: false,
        revision: 0,
        error: {
          code: 'MODEL_DOWNLOAD_REQUIRED',
          details: {
            modelKey: 'rmbg-1.4',
            nodeTypes: ['RemoveBackground'],
          },
        },
      });
      expect(getModelStatus).toHaveBeenCalledOnce();
      // The host constructs and validates the proposal under the supplied
      // policy, but must not publish it when readiness is false.
      expect(hostApply).toHaveBeenCalledOnce();
      expect(fake.revision()).toBe(0);
    },
  );

  it('denies model-backed proposals without model scope and skips status I/O', async () => {
    const session = paired(['edit']);
    const fake = dependencies();
    fake.setDocument(documentWith('RemoveBackground'));
    const getModelStatus = vi.fn(
      async (_signal: AbortSignal) => modelStatus('ready'),
    );
    fake.deps.getModelStatus = getModelStatus;
    const hostApply = vi.spyOn(fake.deps, 'applyTransaction');
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );

    await expect(controller.applyTransaction({
      requestId: 'model_scope_missing',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    })).resolves.toMatchObject({
      ok: false,
      revision: 0,
      error: {
        code: 'PERMISSION_REQUIRED',
        details: {
          requiredScope: 'model',
          nodeTypes: ['RemoveBackground'],
        },
      },
    });
    expect(getModelStatus).not.toHaveBeenCalled();
    expect(hostApply).toHaveBeenCalledOnce();
    expect(fake.revision()).toBe(0);
  });

  it('passes ready model state into the revert transaction policy', async () => {
    const session = paired(['edit', 'model']);
    const fake = dependencies();
    const getModelStatus = vi.fn(
      async (_signal: AbortSignal) => modelStatus('ready'),
    );
    fake.deps.getModelStatus = getModelStatus;
    const revertHost = vi.fn(
      (_lease, request, policy, beforeFinalize) => {
        const requestId = (request as { requestId: string }).requestId;
        const denied = policy({
          kind: 'revert',
          current: {
            documentId: 'document_1',
            document: documentWith(),
            revision: 0,
          },
          proposed: {
            documentId: 'document_1',
            document: documentWith('RemoveBackground'),
            revision: 1,
          },
          requestId,
        });
        if (denied) return denied;
        beforeFinalize();
        return {
          ok: true as const,
          requestId,
          dryRun: false,
          committed: true,
          transactionId: 'transaction_revert_result',
          previousRevision: 0,
          revision: 1,
          proposedRevision: 1,
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
      },
    );
    fake.deps.revertTransaction = revertHost;
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );

    await expect(controller.revertTransaction({
      requestId: 'model_ready_revert',
      expectedRevision: 0,
      transactionId: 'transaction_1',
    })).resolves.toMatchObject({
      ok: true,
      committed: true,
      revision: 1,
    });
    expect(getModelStatus).toHaveBeenCalledWith(session.lease.signal);
    expect(revertHost).toHaveBeenCalledOnce();
  });

  it('fails closed when the session is revoked during async model status', async () => {
    const session = paired(['edit', 'model']);
    const fake = dependencies();
    fake.setDocument(documentWith('RemoveBackground'));
    let resolveStatus!: (status: PublicModelStatus) => void;
    const pendingStatus = new Promise<PublicModelStatus>((resolve) => {
      resolveStatus = resolve;
    });
    const getModelStatus = vi.fn(
      async (_signal: AbortSignal) => pendingStatus,
    );
    fake.deps.getModelStatus = getModelStatus;
    const hostApply = vi.spyOn(fake.deps, 'applyTransaction');
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );

    const pending = controller.applyTransaction({
      requestId: 'model_status_revoked',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    });
    await expect.poll(() => getModelStatus.mock.calls.length).toBe(1);
    session.manager.revoke('human');
    expect(session.lease.signal.aborted).toBe(true);
    resolveStatus(modelStatus('ready'));

    await expect(pending).rejects.toMatchObject({
      error: { code: 'SESSION_REVOKED' },
    });
    expect(hostApply).not.toHaveBeenCalled();
    expect(fake.revision()).toBe(0);
  });

  it('allows bounded worker tracing without model authority', () => {
    const context: TransactionPolicyContext = {
      kind: 'apply',
      current: {
        documentId: 'document_1',
        document: documentWith(),
        revision: 0,
      },
      proposed: {
        documentId: 'document_1',
        document: documentWith('Trace'),
        revision: 1,
      },
      requestId: 'trace',
    };
    expect(createModelTransactionPolicy({
      scopes: new Set<AgentScope>(['edit']),
    })(context)).toBeNull();
  });

  it('keeps successful transaction results JSON-safe', async () => {
    const session = paired(['edit']);
    const fake = dependencies();
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );
    const result = await controller.applyTransaction({
      requestId: 'safe',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    });
    expect(result).toMatchObject({ ok: true, revision: 1 });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(structuredClone(result)).toEqual(result);
  });

  it('returns a commit that was authorized before a following revoke', async () => {
    const session = paired(['edit']);
    const fake = dependencies();
    const originalApply = fake.deps.applyTransaction;
    fake.deps.applyTransaction = (lease, request, policy, beforeFinalize) => {
      const result = originalApply(lease, request, policy, beforeFinalize);
      session.manager.revoke('human');
      return result;
    };
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );
    await expect(controller.applyTransaction({
      requestId: 'linearized_before_revoke',
      expectedRevision: 0,
      commands: [{ op: 'set_frame', width: 640, height: 480 }],
    })).resolves.toMatchObject({
      ok: true,
      committed: true,
      revision: 1,
    });
    expect(fake.revision()).toBe(1);
  });

  it('returns an asset commit when a synchronous listener revokes afterward', async () => {
    const session = paired(['assets']);
    const fake = dependencies();
    const bytes = new Uint8Array([21, 22, 23, 24]);
    const digest = sha256BytesHex(bytes);
    const metadata = {
      id: `asset_${digest}`,
      sha256: digest,
      mimeType: 'image/png' as const,
      byteLength: bytes.byteLength,
      width: 1,
      height: 1,
      source: 'upload' as const,
    };
    const releaseRetention = vi.fn();
    const discardStoredAsset = vi.fn(async () => true);
    fake.deps.storeAsset = async () => ({
      metadata,
      newlyStored: true,
      releaseRetention,
    });
    fake.deps.discardStoredAsset = discardStoredAsset;
    fake.deps.applyAssetMutation = (_lease, mutation) => {
      const result = {
        ok: true as const,
        requestId: mutation.requestId,
        dryRun: false as const,
        committed: true as const,
        transactionId: 'transaction_asset_revoke',
        previousRevision: 0,
        revision: 1,
        proposedRevision: 1,
        created: {},
        createdEntities: {},
        changed: {
          frame: false,
          layerIds: [],
          assetIds: [metadata.id],
          nodes: [],
          edgeCountDelta: 0,
          replacedEdges: [],
        },
        warnings: [],
      };
      session.manager.revoke('human');
      return result;
    };
    const { controller } = createAgentController(
      session.manager,
      session.lease,
      fake.deps,
      vault(),
    );
    const begun = await controller.putAsset({
      phase: 'begin',
      requestId: 'asset_revoke_begin',
      mimeType: metadata.mimeType,
      byteLength: bytes.byteLength,
      sha256: digest,
    });
    if (begun.phase !== 'begin') throw new Error('expected begin');
    await controller.putAsset({
      phase: 'chunk',
      requestId: 'asset_revoke_chunk',
      uploadId: begun.upload.uploadId,
      offset: 0,
      dataBase64: base64(bytes),
      chunkSha256: digest,
    });

    await expect(controller.putAsset({
      phase: 'finalize',
      requestId: 'asset_revoke_finalize',
      uploadId: begun.upload.uploadId,
      expectedRevision: 0,
    })).resolves.toMatchObject({
      phase: 'finalize',
      revision: 1,
      deduplicated: false,
      transaction: {
        ok: true,
        committed: true,
        transactionId: 'transaction_asset_revoke',
      },
    });
    expect(releaseRetention).toHaveBeenCalledOnce();
    expect(discardStoredAsset).not.toHaveBeenCalled();
  });
});
