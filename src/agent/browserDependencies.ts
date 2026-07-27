import {
  applyStoreAssetMutation,
  applyStoreTransaction,
  settleStorePersistence,
  revertStoreTransaction,
  useApp,
  getStoreRetainedAssetIds,
} from '../store';
import { appAssetService } from '../assets/assetService';
import {
  appRenderCoordinator,
  retryCurrentRender,
  setAgentModelExecutionAuthorization,
} from '../render/appRenderService';
import { capturePreview } from '../render/preview';
import type { AgentControllerDependencies } from './controller';
import { getPinnedModelStatus } from './modelPreparation';
import type { TransactionSession } from '../domain/transactionSession';

export function createBrowserControllerDependencies(): AgentControllerDependencies {
  const liveSessions = new Set<TransactionSession>();
  appAssetService.registerRetentionProvider(
    () => getStoreRetainedAssetIds(liveSessions),
  );
  return {
    getDocumentState: () => {
      const state = useApp.getState();
      return {
        documentId: state.documentId,
        document: state.doc,
        assets: state.assets,
        revision: state.revision,
      };
    },
    applyTransaction: (lease, request, policy, beforeFinalize) =>
      applyStoreTransaction(
        lease.transactions,
        request,
        { policy, beforeFinalize },
      ),
    revertTransaction: (lease, request, policy, beforeFinalize) =>
      revertStoreTransaction(
        lease.transactions,
        request,
        { policy, beforeFinalize },
      ),
    storeAsset: async (input, signal) => {
      const prepared = await appAssetService.prepareAndStore(
        {
          bytes: input.bytes,
          mimeType: input.mimeType,
          source: 'upload',
          expectedSha256: input.expectedSha256,
        },
        {},
        signal,
      );
      return {
        metadata: { ...prepared.metadata },
        newlyStored: prepared.newlyStored,
        releaseRetention: prepared.releaseRetention,
      };
    },
    discardStoredAsset: (assetId) =>
      appAssetService.discardUnretained(assetId),
    registerLeaseRetention: (lease) => {
      if (liveSessions.has(lease.transactions)) return;
      liveSessions.add(lease.transactions);
      lease.signal.addEventListener(
        'abort',
        () => liveSessions.delete(lease.transactions),
        { once: true },
      );
    },
    isAssetAvailable: (metadata) =>
      appAssetService.isAvailable(metadata),
    settlePersistence: () => settleStorePersistence(),
    getModelStatus: (signal) => getPinnedModelStatus(signal),
    setModelExecutionAuthorization: (lease, enabled) =>
      setAgentModelExecutionAuthorization(lease.signal, enabled),
    applyAssetMutation: (lease, mutation, beforeFinalize) =>
      applyStoreAssetMutation(
        lease.transactions,
        mutation,
        { beforeFinalize },
      ),
    getRenderStatus: (request) =>
      appRenderCoordinator.getRenderStatus(request),
    retryRender: () => {
      const ticket = retryCurrentRender();
      return appRenderCoordinator.getRenderStatus(ticket);
    },
    awaitRender: (request) =>
      appRenderCoordinator.awaitRender(request),
    capturePreview: (request, control) =>
      capturePreview(request, control),
    nowPerformance: () => performance.now(),
  };
}
