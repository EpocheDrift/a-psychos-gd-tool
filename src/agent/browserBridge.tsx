import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AgentConnectionPanel } from './AgentConnectionPanel';
import { createBrowserControllerDependencies } from './browserDependencies';
import {
  createAgentController,
  type AgentCompanionController,
} from './controller';
import type {
  AgentController,
  AgentPairingBootstrap,
  AgentSessionSummary,
  CompletePairingRequest,
  PairingResult,
  PairingRequest,
} from './contracts';
import type { AgentSessionLease } from './sessionManager';
import { bridgeError } from './faults';
import {
  browserRuntimeContext,
  evaluateAgentRuntimeGate,
} from './runtimeGate';
import { AgentSessionManager } from './sessionManager';
import type { PreviewHandleVault } from './previewVault';
import {
  hasLocalCompanionMarker,
  installLocalCompanionBridge,
} from './localCompanionBridge';
import { companionTransportCapabilities } from '../../packages/mcp-companion/src/protocol';
import type { JsonObject } from '../domain/json';
import { subscribePinnedModelStatus } from './modelPreparation';

interface InternalInstallation {
  manager: AgentSessionManager;
  panelRoot: Root;
  panelHost: HTMLDivElement;
  unsubscribe: () => void;
  onPageHide: () => void;
  companionCleanup: () => void;
  unsubscribeModelStatus: () => void;
}

let installation: InternalInstallation | null = null;

function frozenNamedObject<T extends object>(
  methods: Record<string, unknown>,
): T {
  const value = Object.create(null) as Record<string, unknown>;
  for (const [name, method] of Object.entries(methods)) {
    Object.defineProperty(value, name, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: method,
    });
  }
  return Object.freeze(value) as T;
}

export function installBrowserAgentBridge(
): void {
  if (installation || !__GFX_AGENT_BUILD__) return;
  const target = window;
  const initialGate = evaluateAgentRuntimeGate(
    browserRuntimeContext(target),
    __GFX_AGENT_ALLOWED_ORIGIN__,
  );
  if (!initialGate.ok) return;
  if (
    Object.hasOwn(target, 'gfxAgent')
    || Object.hasOwn(target, 'gfxAgentPairing')
  ) {
    return;
  }

  const manager = new AgentSessionManager({
    allowedOrigin: initialGate.allowedOrigin,
    context: () => browserRuntimeContext(target),
  });
  const dependencies = createBrowserControllerDependencies();
  let activeController: AgentController | undefined;
  let activeCompanionController: AgentCompanionController | undefined;
  let activePreviewVault: PreviewHandleVault | null = null;
  let activeLease: AgentSessionLease | null = null;
  const companionMode = hasLocalCompanionMarker(target.document);

  const completePairing = (
    request: CompletePairingRequest,
  ): PairingResult<AgentSessionSummary> => {
      const result = manager.completePairing(request);
      if (!result.ok) return result;
      if (
        !result.value
        || typeof result.value !== 'object'
        || !('lease' in result.value)
      ) {
        return {
          ok: false,
          error: bridgeError(
            'INTERNAL',
            'The pairing host failed closed.',
            { recoverable: false },
          ),
        };
      }
      const created = createAgentController(
        manager,
        result.value.lease,
        dependencies,
        undefined,
        companionMode
          ? {
              mcp: true,
              transport: companionTransportCapabilities() as JsonObject,
            }
          : { mcp: false },
      );
      activePreviewVault?.clear();
      activePreviewVault = created.previewVault;
      activeLease = result.value.lease;
      activeController = created.controller;
      activeCompanionController = created.companionController;
      return { ok: true, value: result.value.summary };
  };
  const pairing = frozenNamedObject<AgentPairingBootstrap>({
    requestPairing: (request: PairingRequest) =>
      manager.requestPairing(request),
    completePairing,
  });

  Object.defineProperty(target, 'gfxAgentPairing', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: pairing,
  });
  Object.defineProperty(target, 'gfxAgent', {
    configurable: false,
    enumerable: false,
    get: () => activeController,
  });
  target.document.documentElement.dataset.agentMode = 'enabled';

  const unsubscribe = manager.subscribe(() => {
    if (manager.getSnapshot().phase === 'connected') return;
    const previousLease = activeLease;
    activeLease = null;
    if (previousLease) {
      dependencies.setModelExecutionAuthorization(previousLease, false);
    }
    activeController = undefined;
    activeCompanionController = undefined;
    activePreviewVault?.clear();
    activePreviewVault = null;
  });
  const unsubscribeModelStatus = subscribePinnedModelStatus((status) => {
    const lease = activeLease;
    if (!lease || !lease.scopes.has('model')) return;
    try {
      manager.assertActive(
        lease,
        dependencies.getDocumentState().revision,
        'model',
      );
      dependencies.setModelExecutionAuthorization(
        lease,
        status.state === 'ready',
      );
    } catch {
      dependencies.setModelExecutionAuthorization(lease, false);
    }
  });
  const onPageHide = () => manager.revoke('pagehide');
  target.addEventListener('pagehide', onPageHide);
  const companionCleanup = installLocalCompanionBridge(target, {
    manager,
    completePairing,
    getController: () => activeController,
    getCompanionController: () => activeCompanionController,
    getPreviewVault: () => activePreviewVault,
  });

  const panelHost = target.document.createElement('div');
  panelHost.id = 'agent-connection-root';
  target.document.body.append(panelHost);
  const panelRoot = createRoot(panelHost);
  panelRoot.render(
    <StrictMode>
      <AgentConnectionPanel manager={manager} />
    </StrictMode>,
  );
  installation = {
    manager,
    panelRoot,
    panelHost,
    unsubscribe,
    onPageHide,
    companionCleanup,
    unsubscribeModelStatus,
  };
}
