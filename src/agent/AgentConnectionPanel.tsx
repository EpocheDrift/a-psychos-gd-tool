import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AGENT_SCOPES,
  type AgentBridgeError,
  type AgentScope,
} from './contracts';
import type {
  AgentConnectionSnapshot,
  AgentSessionManager,
} from './sessionManager';
import type {
  PublicModelStatus,
} from '../../packages/mcp-companion/src/modelPublicContract';
import {
  ModelPreparationClientError,
  getPinnedModelStatus,
  preparePinnedModelFromTrustedUi,
} from './modelPreparation';
import './agentConnectionPanel.css';

const SCOPE_DESCRIPTIONS: Record<AgentScope, string> = {
  read: 'Read capabilities, document summaries, validation, and render status.',
  preview: 'Capture a bounded exact-revision preview and visual metrics.',
  edit: 'Apply validated revision-checked transactions and revert owned transactions.',
  assets: 'Ingest bounded, content-addressed image assets.',
  model:
    'Run pinned BRIA RMBG 1.4 after a separate human-approved ~210 MiB download; non-commercial use only unless separately licensed.',
  export: 'Create a human-approved external artifact. Unavailable until a later gate.',
};

export function defaultRequestedAgentScopes(
  requestedScopes: readonly AgentScope[],
  availableScopes: readonly AgentScope[],
): AgentScope[] {
  const requested = new Set(requestedScopes);
  const available = new Set(availableScopes);
  return AGENT_SCOPES.filter(
    (scope) => requested.has(scope) && available.has(scope),
  );
}

function readableExpiry(value: string | null): string {
  if (!value) return 'not active';
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function connectionMessage(
  snapshot: AgentConnectionSnapshot,
  controlMode: AgentControlMode,
): string {
  const trustedLocal = controlMode === 'trusted-local-v1';
  switch (snapshot.phase) {
    case 'idle':
      return trustedLocal
        ? 'Trusted Local is connecting.'
        : 'Agent access is off.';
    case 'armed':
      return trustedLocal
        ? 'Trusted Local is waiting for the local companion.'
        : 'Waiting for a local Agent to request pairing.';
    case 'pending':
      return 'A local Agent is requesting access. No scope has been granted.';
    case 'approved':
      return 'Scopes approved. Waiting for the Agent to claim its one-shot challenge.';
    case 'connected':
      return trustedLocal
        ? `Trusted Local connected to ${snapshot.clientLabel ?? 'local Agent'}.`
        : `Connected to ${snapshot.clientLabel ?? 'local Agent'}.`;
    case 'revoked':
      return snapshot.error?.message ?? 'Agent access was revoked.';
    case 'expired':
      return snapshot.error?.message ?? 'Agent access expired.';
    case 'error':
      return snapshot.error?.message ?? 'Agent access failed closed.';
  }
}

function modelRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `model_${btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')}`;
}

function mebibytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function modelStatusText(status: PublicModelStatus | null): string {
  if (!status) return 'Checking the managed model cache…';
  switch (status.state) {
    case 'not-installed':
      return 'Not installed.';
    case 'approval-required':
      return status.error
        ? `Confirmation expired or failed safely (${status.error.code}).`
        : 'A direct human confirmation is required.';
    case 'downloading':
      return `Downloading ${mebibytes(status.bytes)} of ${mebibytes(status.totalBytes)}.`;
    case 'verifying':
      return `Verifying ${mebibytes(status.bytes)} of ${mebibytes(status.totalBytes)}.`;
    case 'ready':
      return `Ready — ${mebibytes(status.totalBytes)} verified locally.`;
    case 'failed':
      return `Preparation failed safely (${status.error?.code ?? 'MODEL_PREPARATION_FAILED'}).`;
  }
}

export function isModelPreparationPollingComplete(
  status: PublicModelStatus | null,
): boolean {
  return status?.state === 'ready'
    || status?.state === 'failed'
    || status?.error !== undefined;
}

export type AgentControlMode = 'interactive' | 'trusted-local-v1';

export function AgentConnectionPanel({
  manager,
  controlMode = 'interactive',
}: {
  manager: AgentSessionManager;
  controlMode?: AgentControlMode;
}) {
  const snapshot = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );
  const [selected, setSelected] = useState<AgentScope[]>([]);
  const [uiError, setUiError] = useState<AgentBridgeError | null>(null);
  const [modelStatus, setModelStatus] =
    useState<PublicModelStatus | null>(null);
  const [modelPreparing, setModelPreparing] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const connectRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const revokeRef = useRef<HTMLButtonElement>(null);
  const pairAgainRef = useRef<HTMLButtonElement>(null);
  const previousPhaseRef = useRef(snapshot.phase);
  const requested = useMemo(
    () => new Set(snapshot.requestedScopes),
    [snapshot.requestedScopes],
  );
  const available = useMemo(
    () => new Set(snapshot.availableScopes),
    [snapshot.availableScopes],
  );
  const showDialog =
    snapshot.phase === 'pending'
    || snapshot.phase === 'approved';
  const modelGranted =
    snapshot.phase === 'connected'
    && snapshot.grantedScopes.includes('model');
  const selectableScopes = useMemo(
    () => defaultRequestedAgentScopes(
      snapshot.requestedScopes,
      snapshot.availableScopes,
    ),
    [snapshot.requestedScopes, snapshot.availableScopes],
  );

  useEffect(() => {
    if (snapshot.phase === 'pending') {
      setSelected(selectableScopes);
      setUiError(null);
    }
    if (snapshot.phase !== 'pending' && snapshot.phase !== 'approved') return;
    queueMicrotask(() => headingRef.current?.focus());
  }, [snapshot.phase, snapshot.clientFingerprint, selectableScopes]);

  useEffect(() => {
    if (!showDialog) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [showDialog]);

  useEffect(() => {
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = snapshot.phase;
    if (previous === snapshot.phase || showDialog) return;
    queueMicrotask(() => {
      if (snapshot.phase === 'idle') connectRef.current?.focus();
      else if (snapshot.phase === 'armed') cancelRef.current?.focus();
      else if (snapshot.phase === 'connected') revokeRef.current?.focus();
      else if (
        snapshot.phase === 'revoked'
        || snapshot.phase === 'expired'
        || snapshot.phase === 'error'
      ) {
        pairAgainRef.current?.focus();
      }
    });
  }, [showDialog, snapshot.phase]);

  useEffect(() => {
    if (!modelGranted) {
      setModelStatus(null);
      setModelPreparing(false);
      return;
    }
    const abort = new AbortController();
    void getPinnedModelStatus(abort.signal).then(
      (status) => setModelStatus(status),
      () => {
        if (!abort.signal.aborted) {
          setUiError({
            code: 'MODEL_DOWNLOAD_REQUIRED',
            message: 'The local model status could not be verified.',
            recoverable: true,
          });
        }
      },
    );
    return () => abort.abort();
  }, [modelGranted]);

  useEffect(() => {
    if (!modelGranted || !modelPreparing) return;
    if (isModelPreparationPollingComplete(modelStatus)) {
      setModelPreparing(false);
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void getPinnedModelStatus(abort.signal).then(
        (status) => setModelStatus(status),
        (error) => {
          if (abort.signal.aborted) return;
          setModelPreparing(false);
          setUiError({
            code: 'MODEL_DOWNLOAD_REQUIRED',
            message: error instanceof ModelPreparationClientError
              ? error.message
              : 'The local model status could not be verified.',
            recoverable: true,
          });
        },
      );
    }, 750);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [modelGranted, modelPreparing, modelStatus]);

  const requireTrustedGesture = (
    event: React.SyntheticEvent,
    action: () => void,
  ) => {
    if (!event.nativeEvent.isTrusted) {
      setUiError({
        code: 'CONFIRMATION_REQUIRED',
        message: 'Scope and session controls require a direct browser user gesture.',
        recoverable: true,
      });
      return;
    }
    setUiError(null);
    action();
  };

  const toggleScope = (scope: AgentScope, checked: boolean) => {
    setSelected((current) => (
      checked
        ? [...new Set([...current, scope])]
        : current.filter((candidate) => candidate !== scope)
    ));
  };

  return (
    <aside
      className="agent-connection"
      data-agent-pairing-panel
      data-agent-fixed-panel="agent-connection"
      data-agent-pairing-state={snapshot.phase}
      data-agent-control-mode={controlMode}
      aria-label="Local Agent connection"
    >
      <div
        className="agent-connection-status"
        role={
          snapshot.phase === 'revoked'
          || snapshot.phase === 'expired'
          || snapshot.phase === 'error'
            ? undefined
            : 'status'
        }
        aria-live={
          snapshot.phase === 'revoked'
          || snapshot.phase === 'expired'
          || snapshot.phase === 'error'
            ? undefined
            : 'polite'
        }
        data-agent-pairing-status
      >
        <strong>Agent</strong>
        <span>{connectionMessage(snapshot, controlMode)}</span>
      </div>

      {snapshot.phase === 'idle' && controlMode === 'interactive' && (
        <button
          ref={connectRef}
          type="button"
          data-agent-action="open-agent-pairing"
          onClick={(event) => requireTrustedGesture(event, () => {
            const result = manager.armPairing();
            if (!result.ok) setUiError(result.error);
          })}
        >
          Connect Agent
        </button>
      )}

      {snapshot.phase === 'armed' && (
        <div className="agent-connection-actions">
          <span>Pairing closes at {readableExpiry(snapshot.expiresAt)}.</span>
          <button
            ref={cancelRef}
            type="button"
            data-agent-action="cancel-agent-pairing"
            onClick={(event) =>
              requireTrustedGesture(event, () => manager.cancelPairing())}
          >
            Cancel
          </button>
        </div>
      )}

      {snapshot.phase === 'connected' && (
        <div className="agent-session-summary">
          {controlMode === 'trusted-local-v1' && (
            <span className="agent-trusted-session" aria-hidden="true">
              <strong>Trusted Local</strong>
              {' — '}
              automatic control with the granted session scopes
            </span>
          )}
          <span>
            Client {snapshot.clientFingerprint}; session {snapshot.sessionFingerprint}
          </span>
          <span
            data-agent-granted-scopes={snapshot.grantedScopes.join(' ')}
          >
            Scopes: {snapshot.grantedScopes.join(', ')}
          </span>
          <span>Expires at {readableExpiry(snapshot.expiresAt)}.</span>
          <button
            ref={revokeRef}
            type="button"
            className="agent-revoke"
            data-agent-action="revoke-agent-session"
            onClick={(event) =>
              requireTrustedGesture(event, () => manager.revoke('human'))}
          >
            Revoke now
          </button>
        </div>
      )}

      {modelGranted && (
        <div
          className="agent-model-summary"
          data-agent-model-state={modelStatus?.state ?? 'checking'}
          data-agent-model-manifest={
            modelStatus?.manifestSha256 ?? ''
          }
        >
          <strong>BRIA RMBG 1.4</strong>
          <span role="status" aria-live="polite">
            {modelStatusText(modelStatus)}
          </span>
          <span>
            Non-commercial use only unless you have a separate BRIA
            commercial license. The first preparation downloads and verifies
            about 210.3 MiB from the fixed BRIA Hugging Face revision.
          </span>
          {modelStatus
            && modelStatus.state !== 'ready'
            && modelStatus?.state !== 'downloading'
            && modelStatus?.state !== 'verifying' && (
              <button
                type="button"
                disabled={modelPreparing}
                data-agent-action="prepare-pinned-model"
                onClick={(event) => requireTrustedGesture(event, () => {
                  setModelPreparing(true);
                  void preparePinnedModelFromTrustedUi(
                    modelRequestId(),
                  ).then(
                    (status) => setModelStatus(status),
                    (error) => {
                      setModelPreparing(false);
                      setUiError({
                        code: 'MODEL_DOWNLOAD_REQUIRED',
                        message:
                          error instanceof ModelPreparationClientError
                            ? error.message
                            : 'The pinned model preparation failed safely.',
                        recoverable: true,
                      });
                    },
                  );
                })}
              >
                {modelPreparing
                  ? 'Preparing…'
                  : 'Approve model download'}
              </button>
            )}
        </div>
      )}

      {(snapshot.phase === 'revoked'
        || snapshot.phase === 'expired'
        || snapshot.phase === 'error') && (
        <div className="agent-connection-actions" role="alert">
          <span data-agent-pairing-error-code={snapshot.error?.code ?? ''}>
            {snapshot.error?.message}
          </span>
          <button
            ref={pairAgainRef}
            type="button"
            data-agent-action="open-agent-pairing"
            onClick={(event) => requireTrustedGesture(event, () => {
              manager.resetToIdle();
              const result = manager.armPairing();
              if (!result.ok) setUiError(result.error);
            })}
          >
            Pair again
          </button>
        </div>
      )}

      {uiError && (
        <div
          className="agent-pairing-error"
          role="alert"
          data-agent-pairing-error-code={uiError.code}
        >
          {uiError.message}
        </div>
      )}

      {showDialog && (
        <dialog
          ref={dialogRef}
          className="agent-pairing-dialog"
          aria-labelledby="agent-pairing-title"
          aria-describedby="agent-pairing-description"
          onCancel={(event) => {
            event.preventDefault();
            if (snapshot.phase === 'pending') manager.rejectPairing();
          }}
        >
          <h2
            id="agent-pairing-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {snapshot.phase === 'approved'
              ? 'Agent access approved'
              : 'Allow Agent control?'}
          </h2>
          <p id="agent-pairing-description">
            {snapshot.phase === 'approved'
              ? 'Waiting for the Agent to finish connecting.'
              : 'Allow this local Agent to control the document with the requested permissions supported by this app.'}
          </p>
          <p>
            Client:{' '}
            <bdi
              dir="auto"
              className="agent-client-label"
              data-agent-content-trust="untrusted-client-label"
            >
              {snapshot.clientLabel}
            </bdi>{' '}
            ({snapshot.clientFingerprint})
          </p>
          <p>
            Origin: <code>{snapshot.origin}</code>
          </p>
          <p>
            This label and document content are untrusted. They cannot grant or
            elevate permissions.
          </p>
          <details className="agent-permission-details">
            <summary>
              <span>Advanced details</span>
              <span className="agent-permission-count">
                {snapshot.phase === 'approved'
                  ? `${snapshot.grantedScopes.length} permissions granted`
                  : `${selected.length} of ${selectableScopes.length} permissions selected`}
              </span>
            </summary>
            <fieldset disabled={snapshot.phase === 'approved'}>
              <legend>Choose individual permissions</legend>
              {AGENT_SCOPES.map((scope) => {
                const isRequested = requested.has(scope);
                const isAvailable = available.has(scope);
                const disabled = !isRequested || !isAvailable;
                const checked = snapshot.phase === 'approved'
                  ? snapshot.grantedScopes.includes(scope)
                  : selected.includes(scope);
                return (
                  <label
                    key={scope}
                    className={disabled ? 'agent-scope unavailable' : 'agent-scope'}
                  >
                    <input
                      type="checkbox"
                      data-agent-scope={scope}
                      data-agent-scope-selected={checked ? 'true' : 'false'}
                      data-agent-scope-granted={
                        snapshot.grantedScopes.includes(scope) ? 'true' : 'false'
                      }
                      checked={checked}
                      disabled={disabled}
                      onChange={(event) => {
                        const checkedValue = event.target.checked;
                        requireTrustedGesture(
                          event,
                          () => toggleScope(scope, checkedValue),
                        );
                      }}
                    />
                    <span>
                      <strong>{scope}</strong>
                      {' — '}
                      {SCOPE_DESCRIPTIONS[scope]}
                      {!isRequested && ' Not requested.'}
                      {isRequested && !isAvailable && ' Unavailable in this session.'}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </details>
          <p>Pairing expires at {readableExpiry(snapshot.expiresAt)}.</p>
          <div className="agent-dialog-actions">
            <button
              type="button"
              className="agent-deny"
              data-agent-action="cancel-agent-pairing"
              onClick={(event) =>
                requireTrustedGesture(event, () => manager.rejectPairing())}
            >
              Deny
            </button>
            {snapshot.phase === 'pending' && (
              <button
                type="button"
                className="agent-allow"
                data-agent-action="approve-agent-pairing"
                disabled={selected.length === 0}
                onClick={(event) => requireTrustedGesture(event, () => {
                  const result = manager.approvePairing(selected);
                  if (!result.ok) setUiError(result.error);
                })}
              >
                Allow Agent control
              </button>
            )}
          </div>
        </dialog>
      )}
    </aside>
  );
}
