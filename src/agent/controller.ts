import type { AgentFailure, TransactionResult } from '../domain/commandTypes';
import type {
  AwaitRenderRequest,
  RenderStatus,
  RenderStatusRequest,
} from '../domain/renderCoordinator';
import type {
  TransactionPolicy,
} from '../domain/transactionSession';
import { DEFAULT_AGENT_LIMITS } from '../domain/limits';
import type { PreviewCaptureControl, PreviewResult } from '../render/preview';
import { modelNodeTypesInDocument } from '../domain/modelExecutionPolicy';
import type {
  AgentController,
  AgentScope,
  PublicAwaitRenderRequest,
  PublicPreviewRequest,
  PublicPreviewResult,
  PublicRenderStatusRequest,
} from './contracts';
import { controllerFault, normalizeControllerFailure } from './faults';
import {
  captureJsonObject,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  publicJsonClone,
} from './jsonBoundary';
import { PreviewHandleVault } from './previewVault';
import {
  getCapabilitiesQuery,
  getDocumentQuery,
  normalizeRenderStatusRequest,
  publicRenderStatus,
  validateDocumentQuery,
  type ControllerDocumentState,
} from './queries';
import { sanitizeTransactionResult } from './publicDiagnostics';
import type {
  AgentSessionLease,
  AgentSessionManager,
} from './sessionManager';

export interface AgentControllerDependencies {
  getDocumentState(): ControllerDocumentState;
  applyTransaction(
    lease: AgentSessionLease,
    request: unknown,
    policy: TransactionPolicy,
    beforeFinalize: () => void,
  ): TransactionResult;
  revertTransaction(
    lease: AgentSessionLease,
    request: unknown,
    policy: TransactionPolicy,
    beforeFinalize: () => void,
  ): TransactionResult;
  getRenderStatus(request: RenderStatusRequest): RenderStatus;
  awaitRender(request: AwaitRenderRequest): Promise<RenderStatus>;
  capturePreview(
    request: unknown,
    control: PreviewCaptureControl,
  ): Promise<PreviewResult>;
  nowPerformance(): number;
}

export function createModelTransactionPolicy(
  lease: Pick<AgentSessionLease, 'scopes'>,
): TransactionPolicy {
  return (context): AgentFailure | null => {
    const nodeTypes = modelNodeTypesInDocument(context.proposed.document);
    if (nodeTypes.length === 0) return null;
    if (!lease.scopes.has('model')) {
      return {
        ok: false,
        requestId: context.requestId,
        revision: context.current.revision,
        error: {
          code: 'PERMISSION_REQUIRED',
          message: 'The proposed document can execute a model-backed node.',
          path: '/commands',
          details: {
            requiredScope: 'model',
            nodeTypes,
          },
          recoverable: true,
          suggestedFix:
            'Remove model-backed nodes. Model scope is unavailable until the PR7 integrity gate.',
        },
      };
    }
    return {
      ok: false,
      requestId: context.requestId,
      revision: context.current.revision,
      error: {
        code: 'MODEL_DOWNLOAD_REQUIRED',
        message:
          'Model execution remains blocked until model bytes are pinned, self-hosted, and integrity-verified.',
        path: '/commands',
        details: {
          nodeTypes,
          rolloutGate: 'PR7',
        },
        recoverable: true,
      },
    };
  };
}

function captureTransaction(
  raw: unknown,
  revision: number,
): Record<string, unknown> {
  return captureJsonObject(raw, {
    allowedKeys: ['requestId', 'expectedRevision', 'commands', 'dryRun'],
    revision,
    label: 'Transaction request',
    maxBytes: DEFAULT_AGENT_LIMITS.maxTransactionJsonBytes,
  }) as Record<string, unknown>;
}

function captureRevert(
  raw: unknown,
  revision: number,
): Record<string, unknown> {
  return captureJsonObject(raw, {
    allowedKeys: ['requestId', 'expectedRevision', 'transactionId'],
    revision,
    label: 'Revert request',
    maxBytes: DEFAULT_AGENT_LIMITS.maxTransactionJsonBytes,
  }) as Record<string, unknown>;
}

export function createAgentController(
  manager: AgentSessionManager,
  lease: AgentSessionLease,
  dependencies: AgentControllerDependencies,
  previewVault = new PreviewHandleVault(),
): {
  controller: AgentController;
  previewVault: PreviewHandleVault;
} {
  const revision = () => dependencies.getDocumentState().revision;
  const safeRevision = (): number => {
    try {
      const value = revision();
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    } catch {
      return 0;
    }
  };
  const throwPublicFailure = (
    error: unknown,
    scope: AgentScope,
  ): never => {
    const currentRevision = safeRevision();
    try {
      manager.assertActive(lease, currentRevision, scope);
    } catch (sessionError) {
      throw normalizeControllerFailure(sessionError, currentRevision);
    }
    throw normalizeControllerFailure(error, currentRevision);
  };
  const publicSync = <T>(
    scope: AgentScope,
    operation: () => T,
  ): T => {
    try {
      return operation();
    } catch (error) {
      return throwPublicFailure(error, scope);
    }
  };
  const publicAsync = async <T>(
    scope: AgentScope,
    operation: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      return throwPublicFailure(error, scope);
    }
  };
  const guard = (scope: AgentScope): number => {
    const currentRevision = revision();
    manager.assertActive(lease, currentRevision, scope);
    return currentRevision;
  };

  const methods: AgentController = {
    getCapabilities: (request) => publicSync('read', () => {
      const currentRevision = guard('read');
      const result = getCapabilitiesQuery(request, currentRevision);
      manager.assertActive(lease, revision(), 'read');
      return result;
    }),

    getDocument: (request) => publicSync('read', () => {
      guard('read');
      const state = dependencies.getDocumentState();
      const result = getDocumentQuery(state, request);
      manager.assertActive(lease, revision(), 'read');
      return result;
    }),

    validateDocument: (request) => publicSync('read', () => {
      guard('read');
      const state = dependencies.getDocumentState();
      const result = validateDocumentQuery(state, request);
      manager.assertActive(lease, revision(), 'read');
      return result;
    }),

    applyTransaction: (request) => publicAsync('edit', async () => {
        const beforeCapture = guard('edit');
        const captured = captureTransaction(request, beforeCapture);
        manager.assertActive(lease, revision(), 'edit');
        const result = dependencies.applyTransaction(
          lease,
          captured,
          createModelTransactionPolicy(lease),
          () => manager.assertActive(lease, revision(), 'edit'),
        );
        // A committed result linearized while the lease was authorized. Do
        // not turn it into a ghost failure merely because expiry followed.
        if (!(result.ok && result.committed)) {
          manager.assertActive(lease, revision(), 'edit');
        }
        return publicJsonClone(sanitizeTransactionResult(result));
    }),

    getRenderStatus: (request) => publicSync('read', () => {
      const currentRevision = guard('read');
      const normalized = normalizeRenderStatusRequest(request, currentRevision);
      manager.assertActive(lease, revision(), 'read');
      const status = dependencies.getRenderStatus(normalized.request);
      const result = publicRenderStatus(status, normalized.includeEvents);
      manager.assertActive(lease, revision(), 'read');
      return result;
    }),

    awaitRender: (request: PublicAwaitRenderRequest) =>
      publicAsync('read', async () => {
      const currentRevision = guard('read');
      const captured = captureJsonObject(request, {
          allowedKeys: ['revision', 'attempt', 'timeoutMs'],
          revision: currentRevision,
          label: 'Await-render request',
          maxBytes: 16 * 1024,
        });
        const requestedRevision = optionalNonNegativeInteger(
          captured,
          'revision',
          currentRevision,
        );
        if (requestedRevision === undefined) {
          throw controllerFault(
            currentRevision,
            'INVALID_ARGUMENT',
            'revision is required.',
            { path: '/revision' },
          );
        }
        const attempt = optionalPositiveInteger(
          captured,
          'attempt',
          currentRevision,
        );
        const timeoutMs = optionalPositiveInteger(
          captured,
          'timeoutMs',
          currentRevision,
        );
        if (
          timeoutMs !== undefined
          && timeoutMs > DEFAULT_AGENT_LIMITS.renderDeadlineMs
        ) {
          throw controllerFault(
            currentRevision,
            'RESOURCE_LIMIT',
            `timeoutMs cannot exceed ${DEFAULT_AGENT_LIMITS.renderDeadlineMs}.`,
            { path: '/timeoutMs' },
          );
        }
        manager.assertActive(lease, revision(), 'read');
        const status = await dependencies.awaitRender({
          revision: requestedRevision,
          ...(attempt === undefined ? {} : { attempt }),
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
          signal: lease.signal,
        });
        manager.assertActive(lease, revision(), 'read');
        return publicRenderStatus(status, false);
    }),

    capturePreview: (request: PublicPreviewRequest) =>
      publicAsync('preview', async () => {
      const currentRevision = guard('preview');
      const captured = captureJsonObject(request, {
          allowedKeys: [
            'revision',
            'attempt',
            'maxWidth',
            'maxHeight',
            'format',
            'includeMetrics',
          ],
          revision: currentRevision,
          label: 'Preview request',
          maxBytes: 16 * 1024,
        });
        manager.assertActive(lease, revision(), 'preview');
        const result = await dependencies.capturePreview(
          captured,
          {
            signal: lease.signal,
            deadline:
              dependencies.nowPerformance()
              + DEFAULT_AGENT_LIMITS.previewDeadlineMs,
          },
        );
        manager.assertActive(lease, revision(), 'preview');
        const handle = previewVault.store(result, result.revision);
        const output: PublicPreviewResult = {
          trust: 'untrusted-document-render',
          requestedRevision: result.requestedRevision,
          revision: result.revision,
          attempt: result.attempt,
          sourceWidth: result.sourceWidth,
          sourceHeight: result.sourceHeight,
          width: result.width,
          height: result.height,
          mimeType: result.mimeType,
          byteLength: result.byteLength,
          contentHash: result.contentHash,
          rgbaSha256: result.rgbaSha256,
          capturePolicy: result.capturePolicy,
          image: handle,
          ...(result.metrics ? { metrics: result.metrics } : {}),
        };
        return publicJsonClone(output);
    }),

    revertTransaction: (request) => publicAsync('edit', async () => {
        const beforeCapture = guard('edit');
        const captured = captureRevert(request, beforeCapture);
        manager.assertActive(lease, revision(), 'edit');
        const result = dependencies.revertTransaction(
          lease,
          captured,
          createModelTransactionPolicy(lease),
          () => manager.assertActive(lease, revision(), 'edit'),
        );
        if (!(result.ok && result.committed)) {
          manager.assertActive(lease, revision(), 'edit');
        }
        return publicJsonClone(sanitizeTransactionResult(result));
    }),
  };

  const controller = Object.create(null) as AgentController;
  for (const [name, method] of Object.entries(methods)) {
    Object.defineProperty(controller, name, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: method,
    });
  }
  return {
    controller: Object.freeze(controller),
    previewVault,
  };
}

export function controllerMethodNames(): readonly string[] {
  return Object.freeze([
    'getCapabilities',
    'getDocument',
    'validateDocument',
    'applyTransaction',
    'getRenderStatus',
    'awaitRender',
    'capturePreview',
    'revertTransaction',
  ]);
}

export function publicRenderRequest(
  request: PublicRenderStatusRequest,
): PublicRenderStatusRequest {
  return { ...request };
}
