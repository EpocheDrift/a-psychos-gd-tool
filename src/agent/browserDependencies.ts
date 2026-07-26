import {
  applyStoreTransaction,
  revertStoreTransaction,
  useApp,
} from '../store';
import {
  appRenderCoordinator,
} from '../render/appRenderService';
import { capturePreview } from '../render/preview';
import type { AgentControllerDependencies } from './controller';

export function createBrowserControllerDependencies(): AgentControllerDependencies {
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
    getRenderStatus: (request) =>
      appRenderCoordinator.getRenderStatus(request),
    awaitRender: (request) =>
      appRenderCoordinator.awaitRender(request),
    capturePreview: (request, control) =>
      capturePreview(request, control),
    nowPerformance: () => performance.now(),
  };
}
