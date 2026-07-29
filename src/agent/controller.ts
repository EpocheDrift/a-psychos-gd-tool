import type {
  AgentFailure,
  TransactionResult,
} from '../domain/commandTypes';
import type {
  AwaitRenderRequest,
  RenderStatus,
  RenderStatusRequest,
} from '../domain/renderCoordinator';
import type {
  TransactionPolicy,
  TrustedAssetMutation,
} from '../domain/transactionSession';
import { DEFAULT_AGENT_LIMITS } from '../domain/limits';
import type { AssetMetadata } from '../domain/documentSchema';
import { CAPABILITY_MANIFEST } from '../domain/capabilityManifest';
import {
  MAX_RENDERED_NODE_MEASUREMENT_TARGETS,
  type PublicRenderedNodeMeasurementRequest,
  type PublicRenderedNodeMeasurementResult,
  type ResolvedRenderedNodeMeasurementRequest,
} from '../domain/renderedNodeMeasurementContract';
import { isSafeId } from '../domain/paramCodecs';
import type { AssetMimeType } from '../domain/assetPolicy';
import type {
  PublicModelStatus,
} from '../../packages/mcp-companion/src/modelPublicContract';
import { sha256Hex } from '../domain/sha256';
import { AssetUploadSession } from '../assets/assetUploadSession';
import type { PreviewCaptureControl, PreviewResult } from '../render/preview';
import {
  modelNodeTypesInDocument,
} from '../domain/modelExecutionPolicy';
import type {
  AgentController,
  AgentCapabilityProfile,
  AgentScope,
  GetAssetMetadataRequest,
  ListAssetsRequest,
  ListAssetsResult,
  PublicAssetMetadata,
  PublicAssetUploadStatus,
  PublicAwaitRenderRequest,
  PublicPreviewRequest,
  PublicPreviewResult,
  PublicTransactionResult,
  PublicTransactionRenderStatus,
  PublicTransactionSuccess,
  PublicRenderStatus,
  PublicRenderStatusRequest,
  PutAssetRequest,
  PutAssetResult,
  RemoveAssetRequest,
} from './contracts';
import { controllerFault, normalizeControllerFailure } from './faults';
import {
  captureJsonObject,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  own,
  publicJsonClone,
  requireString,
} from './jsonBoundary';
import { PreviewHandleVault } from './previewVault';
import {
  getCapabilitiesQuery,
  getDocumentQuery,
  evaluateValidationDocumentQuery,
  normalizeRenderStatusRequest,
  publicRenderStatus,
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
  storeAsset(
    input: {
      bytes: Uint8Array;
      mimeType: AssetMimeType;
      expectedSha256: string;
    },
    signal: AbortSignal,
  ): Promise<{
    metadata: AssetMetadata;
    newlyStored: boolean;
    releaseRetention?: () => void;
  }>;
  discardStoredAsset(assetId: string): Promise<boolean>;
  registerLeaseRetention(lease: AgentSessionLease): void;
  isAssetAvailable(metadata: AssetMetadata): Promise<boolean>;
  settlePersistence(): 'durable' | 'memory-only';
  getModelStatus(signal: AbortSignal): Promise<PublicModelStatus>;
  setModelExecutionAuthorization(
    lease: AgentSessionLease,
    enabled: boolean,
  ): void;
  applyAssetMutation(
    lease: AgentSessionLease,
    mutation: TrustedAssetMutation,
    beforeFinalize: () => void,
  ): TransactionResult;
  getRenderStatus(request: RenderStatusRequest): RenderStatus;
  retryRender(): RenderStatus;
  awaitRender(request: AwaitRenderRequest): Promise<RenderStatus>;
  capturePreview(
    request: unknown,
    control: PreviewCaptureControl,
  ): Promise<PreviewResult>;
  measureRenderedNodes(
    request: ResolvedRenderedNodeMeasurementRequest,
  ): PublicRenderedNodeMeasurementResult;
  nowPerformance(): number;
}

export function createModelTransactionPolicy(
  lease: Pick<AgentSessionLease, 'scopes'>,
  options: { modelReady?: boolean } = {},
): TransactionPolicy {
  return (context): AgentFailure | null => {
    const modelNodeTypes = modelNodeTypesInDocument(
      context.proposed.document,
    );
    if (modelNodeTypes.length > 0) {
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
              nodeTypes: modelNodeTypes,
            },
            recoverable: true,
            suggestedFix:
              'Reconnect with --allow-model and ask the human to grant model scope, or remove model-backed nodes.',
          },
        };
      }
      if (options.modelReady !== true) {
        return {
          ok: false,
          requestId: context.requestId,
          revision: context.current.revision,
          error: {
            code: 'MODEL_DOWNLOAD_REQUIRED',
            message:
              'The pinned model must be approved, downloaded, and integrity-verified before use.',
            path: '/commands',
            details: {
              nodeTypes: modelNodeTypes,
              modelKey: 'rmbg-1.4',
            },
            recoverable: true,
            suggestedFix:
              'Ask the human to prepare BRIA RMBG 1.4 in the local Agent panel.',
          },
        };
      }
      return null;
    }
    return null;
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

function captureRenderedNodeMeasurementRequest(
  raw: unknown,
  revision: number,
  state: ControllerDocumentState,
): ResolvedRenderedNodeMeasurementRequest {
  const captured = captureJsonObject(raw, {
    allowedKeys: ['revision', 'attempt', 'targets'],
    revision,
    label: 'Rendered node measurement request',
    maxBytes: 16 * 1024,
  });
  const requestedRevision = optionalNonNegativeInteger(
    captured,
    'revision',
    revision,
  );
  const attempt = optionalPositiveInteger(captured, 'attempt', revision);
  if (requestedRevision === undefined) {
    throw controllerFault(
      revision,
      'INVALID_ARGUMENT',
      'revision is required.',
      { path: '/revision' },
    );
  }
  if (attempt === undefined) {
    throw controllerFault(
      revision,
      'INVALID_ARGUMENT',
      'attempt is required.',
      { path: '/attempt' },
    );
  }
  if (requestedRevision !== revision) {
    throw controllerFault(
      revision,
      'RENDER_SUPERSEDED',
      `Rendered node measurement is allowed only for current document revision ${revision}.`,
      {
        path: '/revision',
        recoverable: true,
        suggestedFix:
          'Read the current render status, await its exact ticket, then measure that revision and attempt.',
      },
    );
  }
  const rawTargets = own(captured, 'targets');
  if (
    !Array.isArray(rawTargets)
    || rawTargets.length < 1
    || rawTargets.length > MAX_RENDERED_NODE_MEASUREMENT_TARGETS
  ) {
    throw controllerFault(
      revision,
      'INVALID_ARGUMENT',
      `targets must contain 1 to ${
        MAX_RENDERED_NODE_MEASUREMENT_TARGETS
      } entries.`,
      { path: '/targets' },
    );
  }
  const seen = new Set<string>();
  const targets = rawTargets.map((rawTarget, index) => {
    const path = `/targets/${index}`;
    if (
      !rawTarget
      || typeof rawTarget !== 'object'
      || Array.isArray(rawTarget)
    ) {
      throw controllerFault(
        revision,
        'INVALID_ARGUMENT',
        'Each measurement target must be an object.',
        { path },
      );
    }
    const target = rawTarget as Record<string, unknown>;
    const allowed = new Set(['layerId', 'nodeId', 'outputSocket']);
    const unknown = Object.keys(target).sort()
      .find((key) => !allowed.has(key));
    if (unknown) {
      throw controllerFault(
        revision,
        'INVALID_ARGUMENT',
        `Unknown measurement target field "${unknown}".`,
        { path: `${path}/${unknown}` },
      );
    }
    const layerId = target.layerId;
    const nodeId = target.nodeId;
    const outputSocket = target.outputSocket ?? 'out';
    for (const [field, value] of Object.entries({
      layerId,
      nodeId,
      outputSocket,
    })) {
      if (
        typeof value !== 'string'
        || !isSafeId(value, DEFAULT_AGENT_LIMITS.maxIdLength)
      ) {
        throw controllerFault(
          revision,
          'INVALID_ARGUMENT',
          `${field} must be an ASCII-safe identifier.`,
          { path: `${path}/${field}` },
        );
      }
    }
    const layer = state.document.layers.find(
      (candidate) => candidate.id === layerId,
    );
    if (!layer) {
      throw controllerFault(
        revision,
        'UNKNOWN_LAYER',
        `Unknown layer "${String(layerId)}".`,
        { path: `${path}/layerId` },
      );
    }
    const node = layer.graph.nodes[String(nodeId)];
    if (!node) {
      throw controllerFault(
        revision,
        'UNKNOWN_NODE',
        `Unknown node "${String(nodeId)}".`,
        { path: `${path}/nodeId` },
      );
    }
    const nodeCapability = CAPABILITY_MANIFEST.nodes.find(
      (candidate) => candidate.type === node.type,
    );
    if (
      !nodeCapability
      || !nodeCapability.outputs.some((output) =>
        output.name === outputSocket)
    ) {
      throw controllerFault(
        revision,
        'UNKNOWN_SOCKET',
        `Unknown output socket "${String(outputSocket)}".`,
        { path: `${path}/outputSocket` },
      );
    }
    const key = `${layerId}\u0000${nodeId}\u0000${outputSocket}`;
    if (seen.has(key)) {
      throw controllerFault(
        revision,
        'INVALID_ARGUMENT',
        'Measurement targets must be unique.',
        { path },
      );
    }
    seen.add(key);
    return {
      layerId: String(layerId),
      nodeId: String(nodeId),
      outputSocket: String(outputSocket),
    };
  });
  return {
    revision: requestedRevision,
    attempt,
    targets,
  };
}

export interface AgentCompanionController {
  awaitRender(
    request: PublicAwaitRenderRequest,
    signal: AbortSignal,
  ): Promise<PublicRenderStatus>;
  capturePreview(
    request: PublicPreviewRequest,
    signal: AbortSignal,
  ): Promise<PublicPreviewResult>;
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UPLOAD_ID = /^upload_[A-Za-z0-9_-]{22}$/;
const ASSET_ID = /^asset_[0-9a-f]{64}$/;
const MAX_ASSET_CHUNK_BASE64_LENGTH =
  4 * Math.ceil(DEFAULT_AGENT_LIMITS.maxAssetChunkBytes / 3);

type FinalizedAssetResult = Extract<PutAssetResult, { phase: 'finalize' }>;

function uploadStatus(
  status: ReturnType<AssetUploadSession['status']>,
): PublicAssetUploadStatus {
  return {
    uploadId: status.uploadId,
    mimeType: status.mimeType,
    byteLength: status.byteLength,
    receivedBytes: status.receivedBytes,
    nextOffset: status.nextOffset,
    chunkBytes: status.chunkBytes,
    idleExpiresAt: new Date(status.idleExpiresAtMs).toISOString(),
    expiresAt: new Date(status.expiresAtMs).toISOString(),
    complete: status.complete,
  };
}

function assetReferences(
  state: ControllerDocumentState,
  assetId: string,
): Array<{ layerId: string; nodeId: string }> {
  const references: Array<{ layerId: string; nodeId: string }> = [];
  for (const layer of state.document.layers) {
    for (const node of Object.values(layer.graph.nodes)) {
      if (node.type === 'Image' && node.params.assetId === assetId) {
        references.push({ layerId: layer.id, nodeId: node.id });
      }
    }
  }
  return references.sort(
    (left, right) =>
      left.layerId.localeCompare(right.layerId)
      || left.nodeId.localeCompare(right.nodeId),
  );
}

export function createAgentController(
  manager: AgentSessionManager,
  lease: AgentSessionLease,
  dependencies: AgentControllerDependencies,
  previewVault = new PreviewHandleVault(),
  capabilityProfile: AgentCapabilityProfile = { mcp: false },
): {
  controller: AgentController;
  companionController: AgentCompanionController;
  previewVault: PreviewHandleVault;
} {
  dependencies.registerLeaseRetention(lease);
  const assetUploads = new AssetUploadSession();
  const finalizedAssets = new Map<
    string,
    {
      requestId: string;
      expectedRevision: number;
      result: FinalizedAssetResult;
    }
  >();
  const persistenceResults = new Map<
    string,
    'durable' | 'memory-only'
  >();
  const transactionRenderResults =
    new Map<string, PublicTransactionRenderStatus>();
  lease.signal.addEventListener(
    'abort',
    () => {
      assetUploads.destroy();
      finalizedAssets.clear();
      persistenceResults.clear();
      transactionRenderResults.clear();
    },
    { once: true },
  );
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
  const modelReady = async (): Promise<boolean> => {
    if (!lease.scopes.has('model')) {
      dependencies.setModelExecutionAuthorization(lease, false);
      return false;
    }
    try {
      const status = await dependencies.getModelStatus(lease.signal);
      manager.assertActive(lease, revision(), 'edit');
      const ready = status.state === 'ready';
      dependencies.setModelExecutionAuthorization(lease, ready);
      return ready;
    } catch {
      dependencies.setModelExecutionAuthorization(lease, false);
      manager.assertActive(lease, revision(), 'edit');
      return false;
    }
  };
  const publicTransactionResult = (
    result: TransactionResult,
  ): PublicTransactionResult => {
    const sanitized = sanitizeTransactionResult(result);
    if (!sanitized.ok) return sanitized;
    if (!sanitized.committed) {
      return {
        ...sanitized,
        persistenceStatus: 'not-applicable',
        renderStatus: {
          state: 'not-applicable',
          ticket: null,
        },
      };
    }
    let persistenceStatus = persistenceResults.get(sanitized.requestId);
    if (!persistenceStatus) {
      try {
        persistenceStatus = dependencies.settlePersistence();
      } catch {
        // The in-memory transaction and replay ledger already committed.
        // Report checkpoint failure separately instead of inventing a ghost
        // transaction failure.
        persistenceStatus = 'memory-only';
      }
      persistenceResults.set(sanitized.requestId, persistenceStatus);
    }
    let renderStatus = transactionRenderResults.get(sanitized.requestId);
    if (!renderStatus) {
      try {
        const observed = publicRenderStatus(
          dependencies.getRenderStatus({ revision: sanitized.revision }),
          false,
        );
        renderStatus = {
          state: observed.state,
          ticket: observed.ticket,
        };
      } catch {
        // The transaction is already committed. Preserve that fact and let a
        // later getRenderStatus call diagnose a renderer that was not ready.
        renderStatus = {
          state: 'unavailable',
          ticket: null,
        };
      }
      transactionRenderResults.set(sanitized.requestId, renderStatus);
    }
    return {
      ...sanitized,
      persistenceStatus,
      renderStatus,
    };
  };
  const compactRenderStatus = (
    status: RenderStatus,
  ): PublicTransactionRenderStatus => {
    const observed = publicRenderStatus(status, false);
    return {
      state: observed.state,
      ticket: observed.ticket,
    };
  };
  const withOperationSignal = async <T>(
    signal: AbortSignal | undefined,
    operation: (combinedSignal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    if (!signal || signal === lease.signal) {
      return operation(lease.signal);
    }
    if (lease.signal.aborted) return operation(lease.signal);
    if (signal.aborted) return operation(signal);

    // AbortSignal.any() is unavailable in supported Chrome 113–115. Relay
    // both cancellation sources explicitly and always remove the listeners.
    const combined = new AbortController();
    const relayLease = () => combined.abort(lease.signal.reason);
    const relayTransport = () => combined.abort(signal.reason);
    lease.signal.addEventListener('abort', relayLease, { once: true });
    signal.addEventListener('abort', relayTransport, { once: true });
    if (lease.signal.aborted) relayLease();
    else if (signal.aborted) relayTransport();
    try {
      return await operation(combined.signal);
    } finally {
      lease.signal.removeEventListener('abort', relayLease);
      signal.removeEventListener('abort', relayTransport);
    }
  };
  const awaitRender = (
    request: PublicAwaitRenderRequest,
    signal?: AbortSignal,
  ): Promise<PublicRenderStatus> =>
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
      const status = await withOperationSignal(
        signal,
        (combinedSignal) => dependencies.awaitRender({
          revision: requestedRevision,
          ...(attempt === undefined ? {} : { attempt }),
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
          signal: combinedSignal,
        }),
      );
      manager.assertActive(lease, revision(), 'read');
      return publicRenderStatus(status, false);
    });
  const capturePreview = (
    request: PublicPreviewRequest,
    signal?: AbortSignal,
  ): Promise<PublicPreviewResult> =>
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
      const result = await withOperationSignal(
        signal,
        (combinedSignal) => dependencies.capturePreview(
          captured,
          {
            signal: combinedSignal,
            deadline:
              dependencies.nowPerformance()
              + DEFAULT_AGENT_LIMITS.previewDeadlineMs,
          },
        ),
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
    });
  const measureRenderedNodes = (
    request: PublicRenderedNodeMeasurementRequest,
  ): PublicRenderedNodeMeasurementResult =>
    publicSync('preview', () => {
      const currentRevision = guard('preview');
      const state = dependencies.getDocumentState();
      const captured = captureRenderedNodeMeasurementRequest(
        request,
        currentRevision,
        state,
      );
      manager.assertActive(lease, revision(), 'preview');
      const result = dependencies.measureRenderedNodes(captured);
      manager.assertActive(lease, revision(), 'preview');
      return publicJsonClone(result);
    });

  const assetMetadataResult = async (
    state: ControllerDocumentState,
    metadata: AssetMetadata,
  ): Promise<PublicAssetMetadata> => {
    const references = assetReferences(state, metadata.id);
    const availability = metadata.source === 'bundled'
      ? 'bundled'
      : await dependencies.isAssetAvailable(metadata)
        ? 'available'
        : 'missing';
    return {
      metadata: { ...metadata },
      referenceCount: references.length,
      references,
      availability,
    };
  };

  const throwAssetMutationFailure = (
    result: TransactionResult,
  ): never => {
    if (result.ok) {
      throw controllerFault(
        result.revision,
        'INTERNAL',
        'Asset mutation unexpectedly returned no failure.',
        { recoverable: false },
      );
    }
    throw controllerFault(
      result.revision,
      result.error.code,
      result.error.message,
      {
        path: result.error.path,
        details: result.error.details,
        recoverable: result.error.recoverable,
        suggestedFix: result.error.suggestedFix,
      },
    );
  };

  const putAsset = (request: PutAssetRequest): Promise<PutAssetResult> =>
    publicAsync('assets', async () => {
      const currentRevision = guard('assets');
      const envelope = captureJsonObject(request, {
        allowedKeys: [
          'phase',
          'requestId',
          'mimeType',
          'byteLength',
          'sha256',
          'uploadId',
          'offset',
          'dataBase64',
          'chunkSha256',
          'expectedRevision',
        ],
        revision: currentRevision,
        label: 'Asset upload request',
        maxBytes:
          MAX_ASSET_CHUNK_BASE64_LENGTH
          + 64 * 1024,
      });
      const phase = requireString(envelope, 'phase', currentRevision, {
        minLength: 5,
        maxLength: 8,
      });
      if (!['begin', 'chunk', 'status', 'finalize', 'abort'].includes(phase)) {
        throw controllerFault(
          currentRevision,
          'INVALID_ARGUMENT',
          'Asset upload phase is not supported.',
          { path: '/phase' },
        );
      }
      const fieldsByPhase: Record<string, readonly string[]> = {
        begin: ['phase', 'requestId', 'mimeType', 'byteLength', 'sha256'],
        chunk: [
          'phase',
          'requestId',
          'uploadId',
          'offset',
          'dataBase64',
          'chunkSha256',
        ],
        status: ['phase', 'uploadId'],
        finalize: ['phase', 'requestId', 'uploadId', 'expectedRevision'],
        abort: ['phase', 'requestId', 'uploadId'],
      };
      const captured = captureJsonObject(envelope, {
        allowedKeys: fieldsByPhase[phase]!,
        revision: currentRevision,
        label: `${phase} asset upload request`,
        maxBytes:
          MAX_ASSET_CHUNK_BASE64_LENGTH
          + 64 * 1024,
      });
      const requestId = phase === 'status'
        ? undefined
        : requireString(captured, 'requestId', currentRevision, {
            minLength: 1,
            maxLength: DEFAULT_AGENT_LIMITS.maxIdLength,
            pattern: SAFE_REQUEST_ID,
          });

      if (phase === 'begin') {
        const mimeType = requireString(
          captured,
          'mimeType',
          currentRevision,
          { minLength: 9, maxLength: 10 },
        );
        const byteLength = optionalPositiveInteger(
          captured,
          'byteLength',
          currentRevision,
        );
        if (byteLength === undefined) {
          throw controllerFault(
            currentRevision,
            'INVALID_ARGUMENT',
            'byteLength is required.',
            { path: '/byteLength' },
          );
        }
        const digest = requireString(captured, 'sha256', currentRevision, {
          minLength: 64,
          maxLength: 64,
          pattern: SHA256,
        });
        const state = dependencies.getDocumentState();
        const alreadyPresent = state.assets?.some(
          (asset) => asset.id === `asset_${digest}`,
        ) ?? false;
        const currentBytes = (state.assets ?? []).reduce(
          (sum, asset) => sum + asset.byteLength,
          0,
        );
        if (
          !alreadyPresent
          && currentBytes + byteLength
            > DEFAULT_AGENT_LIMITS.maxLegacyAssetBytesPerDocument
        ) {
          throw controllerFault(
            currentRevision,
            'RESOURCE_LIMIT',
            'Asset would exceed the project asset-byte budget.',
            {
              path: '/byteLength',
              details: {
                currentBytes,
                requestedBytes: byteLength,
                maximumBytes:
                  DEFAULT_AGENT_LIMITS.maxLegacyAssetBytesPerDocument,
              },
            },
          );
        }
        const status = assetUploads.begin({
          requestId: requestId!,
          mimeType,
          byteLength,
          sha256: digest,
        });
        return publicJsonClone({
          phase: 'begin',
          revision: dependencies.getDocumentState().revision,
          upload: uploadStatus(status),
        });
      }
      const uploadId = requireString(
        captured,
        'uploadId',
        currentRevision,
        {
          minLength: 29,
          maxLength: 29,
          pattern: UPLOAD_ID,
        },
      );
      if (phase === 'chunk') {
        const offset = optionalNonNegativeInteger(
          captured,
          'offset',
          currentRevision,
        );
        if (offset === undefined) {
          throw controllerFault(
            currentRevision,
            'INVALID_ARGUMENT',
            'offset is required.',
            { path: '/offset' },
          );
        }
        const dataBase64 = requireString(
          captured,
          'dataBase64',
          currentRevision,
          {
            minLength: 4,
            maxLength: MAX_ASSET_CHUNK_BASE64_LENGTH,
          },
        );
        const chunkSha256 = requireString(
          captured,
          'chunkSha256',
          currentRevision,
          {
            minLength: 64,
            maxLength: 64,
            pattern: SHA256,
          },
        );
        const status = assetUploads.chunk({
          requestId: requestId!,
          uploadId,
          offset,
          dataBase64,
          chunkSha256,
        });
        return publicJsonClone({
          phase: 'chunk',
          revision: dependencies.getDocumentState().revision,
          upload: uploadStatus(status),
        });
      }
      if (phase === 'status') {
        return publicJsonClone({
          phase: 'status',
          revision: dependencies.getDocumentState().revision,
          upload: uploadStatus(assetUploads.status(uploadId)),
        });
      }
      if (phase === 'abort') {
        const aborted = assetUploads.abort(uploadId);
        return publicJsonClone({
          phase: 'abort',
          revision: dependencies.getDocumentState().revision,
          aborted,
        });
      }

      const expectedRevision = optionalNonNegativeInteger(
        captured,
        'expectedRevision',
        currentRevision,
      );
      if (expectedRevision === undefined) {
        throw controllerFault(
          currentRevision,
          'INVALID_ARGUMENT',
          'expectedRevision is required.',
          { path: '/expectedRevision' },
        );
      }
      const finalized = finalizedAssets.get(uploadId);
      if (finalized) {
        if (
          finalized.requestId !== requestId
          || finalized.expectedRevision !== expectedRevision
        ) {
          throw controllerFault(
            currentRevision,
            'REQUEST_ID_REUSED',
            'Finalized upload was retried with different arguments.',
            { path: '/requestId' },
          );
        }
        return publicJsonClone(finalized.result);
      }
      if (
        finalizedAssets.size
        >= DEFAULT_AGENT_LIMITS.maxRequestCacheEntries
      ) {
        throw controllerFault(
          currentRevision,
          'RESOURCE_LIMIT',
          'Finalized asset replay cache is full for this session.',
        );
      }

      const pending = assetUploads.beginFinalize(uploadId);
      let completed = false;
      let stored:
        {
          metadata: AssetMetadata;
          newlyStored: boolean;
          releaseRetention?: () => void;
        }
        | undefined;
      try {
        stored = await dependencies.storeAsset(
          pending,
          lease.signal,
        );
        const { metadata } = stored;
        manager.assertActive(lease, revision(), 'assets');
        const mutation: TrustedAssetMutation = {
          kind: 'asset-put',
          requestId: requestId!,
          fingerprint: sha256Hex(
            `gfx.asset-finalize.v1\u0000${uploadId}\u0000${
              expectedRevision
            }\u0000${metadata.id}`,
          ),
          expectedRevision,
          metadata,
        };
        const transaction = dependencies.applyAssetMutation(
          lease,
          mutation,
          () => manager.assertActive(lease, revision(), 'assets'),
        );
        const successfulTransaction = transaction.ok
          ? transaction
          : throwAssetMutationFailure(transaction);
        const publicTransaction = publicTransactionResult(
          successfulTransaction,
        ) as PublicTransactionSuccess;
        let renderStatus = publicTransaction.renderStatus;
        if (!successfulTransaction.committed) {
          try {
            renderStatus = compactRenderStatus(dependencies.retryRender());
          } catch {
            renderStatus = {
              state: 'unavailable',
              ticket: null,
            };
          }
        }
        const result: FinalizedAssetResult = publicJsonClone({
          phase: 'finalize',
          revision: successfulTransaction.revision,
          asset: { ...metadata },
          deduplicated: !stored.newlyStored,
          persistenceStatus: publicTransaction.persistenceStatus,
          renderStatus,
          transaction: publicTransaction,
        });
        finalizedAssets.set(uploadId, {
          requestId: requestId!,
          expectedRevision,
          result,
        });
        completed = true;
        // A synchronous state listener may revoke the session immediately
        // after the manifest commit. Losing the upload bookkeeping at that
        // point must not turn an already-committed transaction into failure.
        try {
          assetUploads.complete(uploadId);
        } catch {
          // Session revocation already destroyed the upload bytes.
        }
        return publicJsonClone(result);
      } finally {
        stored?.releaseRetention?.();
        if (!completed) {
          assetUploads.cancelFinalize(uploadId);
          if (stored?.newlyStored) {
            await dependencies.discardStoredAsset(
              stored.metadata.id,
            ).catch(() => false);
          }
        }
      }
    });

  const listAssets = (
    request?: ListAssetsRequest,
  ): Promise<ListAssetsResult> => publicAsync('assets', async () => {
    const currentRevision = guard('assets');
    const captured = captureJsonObject(request, {
      optional: true,
      allowedKeys: ['cursor', 'limit'],
      revision: currentRevision,
      label: 'Asset list request',
      maxBytes: 8 * 1024,
    });
    const limit = optionalPositiveInteger(
      captured,
      'limit',
      currentRevision,
    ) ?? 64;
    if (limit > 64) {
      throw controllerFault(
        currentRevision,
        'RESOURCE_LIMIT',
        'Asset list limit cannot exceed 64.',
        { path: '/limit' },
      );
    }
    const cursor = own(captured, 'cursor');
    let offset = 0;
    if (cursor !== undefined) {
      if (typeof cursor !== 'string') {
        throw controllerFault(
          currentRevision,
          'INVALID_ARGUMENT',
          'cursor must be a string.',
          { path: '/cursor' },
        );
      }
      const match = /^r(\d+)_o(\d+)$/.exec(cursor);
      if (
        !match
        || Number(match[1]) !== currentRevision
        || !Number.isSafeInteger(Number(match[2]))
      ) {
        throw controllerFault(
          currentRevision,
          'REVISION_CONFLICT',
          'Asset list cursor does not belong to the current revision.',
          { path: '/cursor' },
        );
      }
      offset = Number(match[2]);
    }
    const state = dependencies.getDocumentState();
    const catalog = [...(state.assets ?? [])]
      .sort((left, right) => left.id.localeCompare(right.id));
    if (offset > catalog.length) {
      throw controllerFault(
        currentRevision,
        'INVALID_ARGUMENT',
        'Asset list cursor offset is outside the catalog.',
        { path: '/cursor' },
      );
    }
    const page = catalog.slice(offset, offset + limit);
    const assets = await Promise.all(
      page.map((metadata) => assetMetadataResult(state, metadata)),
    );
    manager.assertActive(lease, revision(), 'assets');
    const nextOffset = offset + page.length;
    return publicJsonClone({
      trust: 'untrusted-asset-metadata',
      revision: currentRevision,
      assets,
      ...(nextOffset < catalog.length
        ? { nextCursor: `r${currentRevision}_o${nextOffset}` }
        : {}),
    });
  });

  const getAssetMetadata = (
    request: GetAssetMetadataRequest,
  ): Promise<PublicAssetMetadata> => publicAsync('assets', async () => {
    const currentRevision = guard('assets');
    const captured = captureJsonObject(request, {
      allowedKeys: ['assetId'],
      revision: currentRevision,
      label: 'Asset metadata request',
      maxBytes: 8 * 1024,
    });
    const assetId = requireString(captured, 'assetId', currentRevision, {
      minLength: 70,
      maxLength: 70,
      pattern: ASSET_ID,
    });
    const state = dependencies.getDocumentState();
    const metadata = state.assets?.find((asset) => asset.id === assetId);
    if (!metadata) {
      throw controllerFault(
        currentRevision,
        'INVALID_ARGUMENT',
        'Asset is not present in the current project manifest.',
        { path: '/assetId' },
      );
    }
    const result = await assetMetadataResult(state, metadata);
    manager.assertActive(lease, revision(), 'assets');
    return publicJsonClone(result);
  });

  const removeAsset = (
    request: RemoveAssetRequest,
  ): Promise<PublicTransactionResult> => publicAsync('assets', async () => {
    const currentRevision = guard('assets');
    const captured = captureJsonObject(request, {
      allowedKeys: ['requestId', 'expectedRevision', 'assetId'],
      revision: currentRevision,
      label: 'Asset removal request',
      maxBytes: 8 * 1024,
    });
    const requestId = requireString(
      captured,
      'requestId',
      currentRevision,
      {
        minLength: 1,
        maxLength: DEFAULT_AGENT_LIMITS.maxIdLength,
        pattern: SAFE_REQUEST_ID,
      },
    );
    const expectedRevision = optionalNonNegativeInteger(
      captured,
      'expectedRevision',
      currentRevision,
    );
    if (expectedRevision === undefined) {
      throw controllerFault(
        currentRevision,
        'INVALID_ARGUMENT',
        'expectedRevision is required.',
        { path: '/expectedRevision' },
      );
    }
    const assetId = requireString(captured, 'assetId', currentRevision, {
      minLength: 70,
      maxLength: 70,
      pattern: ASSET_ID,
    });
    const mutation: TrustedAssetMutation = {
      kind: 'asset-remove',
      requestId,
      expectedRevision,
      assetId,
      fingerprint: sha256Hex(
        `gfx.asset-remove.v1\u0000${expectedRevision}\u0000${assetId}`,
      ),
    };
    const result = dependencies.applyAssetMutation(
      lease,
      mutation,
      () => manager.assertActive(lease, revision(), 'assets'),
    );
    if (!(result.ok && result.committed)) {
      manager.assertActive(lease, revision(), 'assets');
    }
    return publicJsonClone(publicTransactionResult(result));
  });

  const methods: AgentController = {
    getCapabilities: (request) => publicSync('read', () => {
      const currentRevision = guard('read');
      const result = getCapabilitiesQuery(
        request,
        currentRevision,
        capabilityProfile,
      );
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

    validateDocument: (request) => publicAsync('read', async () => {
      guard('read');
      const state = dependencies.getDocumentState();
      const evaluation = evaluateValidationDocumentQuery(state, request);
      const result = evaluation.result;
      for (let index = 0; index < evaluation.assets.length; index++) {
        const metadata = evaluation.assets[index]!;
        const available = await dependencies.isAssetAvailable(metadata);
        manager.assertActive(lease, revision(), 'read');
        if (available) continue;
        if (
          result.report.errors.length + result.report.warnings.length
          >= evaluation.maxFindings
        ) {
          result.report.truncated = true;
          break;
        }
        result.report.valid = false;
        result.report.errors.push({
          severity: 'error',
          code: 'PERSISTENCE_FAILED',
          message:
            'Asset bytes are missing or failed integrity verification in the local content-addressed store.',
          path: `/assets/${index}`,
          details: { assetId: metadata.id },
          recoverable: true,
          suggestedFix:
            'Upload or import the exact asset bytes again before rendering.',
        });
      }
      manager.assertActive(lease, revision(), 'read');
      return publicJsonClone(result);
    }),

    applyTransaction: (request) => publicAsync('edit', async () => {
        const beforeCapture = guard('edit');
        const captured = captureTransaction(request, beforeCapture);
        manager.assertActive(lease, revision(), 'edit');
        const isModelReady = await modelReady();
        const result = dependencies.applyTransaction(
          lease,
          captured,
          createModelTransactionPolicy(lease, {
            modelReady: isModelReady,
          }),
          () => manager.assertActive(lease, revision(), 'edit'),
        );
        // A committed result linearized while the lease was authorized. Do
        // not turn it into a ghost failure merely because expiry followed.
        if (!(result.ok && result.committed)) {
          manager.assertActive(lease, revision(), 'edit');
        }
        return publicJsonClone(publicTransactionResult(result));
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

    awaitRender: (request) => awaitRender(request),

    capturePreview: (request) => capturePreview(request),

    measureRenderedNodes: (request) => measureRenderedNodes(request),

    revertTransaction: (request) => publicAsync('edit', async () => {
        const beforeCapture = guard('edit');
        const captured = captureRevert(request, beforeCapture);
        manager.assertActive(lease, revision(), 'edit');
        const isModelReady = await modelReady();
        const result = dependencies.revertTransaction(
          lease,
          captured,
          createModelTransactionPolicy(lease, {
            modelReady: isModelReady,
          }),
          () => manager.assertActive(lease, revision(), 'edit'),
        );
        if (!(result.ok && result.committed)) {
          manager.assertActive(lease, revision(), 'edit');
        }
        return publicJsonClone(publicTransactionResult(result));
    }),

    putAsset,

    listAssets,

    getAssetMetadata,

    removeAsset,
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
  const companionController: AgentCompanionController = Object.freeze({
    awaitRender: (
      request: PublicAwaitRenderRequest,
      signal: AbortSignal,
    ) => awaitRender(request, signal),
    capturePreview: (
      request: PublicPreviewRequest,
      signal: AbortSignal,
    ) => capturePreview(request, signal),
  });
  return {
    controller: Object.freeze(controller),
    companionController,
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
    'measureRenderedNodes',
    'revertTransaction',
    'putAsset',
    'listAssets',
    'getAssetMetadata',
    'removeAsset',
  ]);
}

export function publicRenderRequest(
  request: PublicRenderStatusRequest,
): PublicRenderStatusRequest {
  return { ...request };
}
