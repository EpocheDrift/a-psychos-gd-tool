import { describe, expect, it, vi } from 'vitest';
import type { Doc } from '../engine/graph';
import type { TransactionPolicyContext } from '../domain/transactionSession';
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

  it('blocks model documents both before permission and after the PR7 integrity gate', () => {
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
  });

  it('keeps tracing nodes behind the PR7 resource-policy gate', () => {
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
    })(context)).toMatchObject({
      error: {
        code: 'PERMISSION_REQUIRED',
        details: {
          nodeTypes: ['Trace'],
          rolloutGate: 'PR7',
        },
      },
    });
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
});
