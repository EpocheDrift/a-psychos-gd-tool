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
import './agentConnectionPanel.css';

const SCOPE_DESCRIPTIONS: Record<AgentScope, string> = {
  read: 'Read capabilities, document summaries, validation, and render status.',
  preview: 'Capture a bounded exact-revision preview and visual metrics.',
  edit: 'Apply validated revision-checked transactions and revert owned transactions.',
  assets: 'Ingest bounded binary assets. Unavailable until PR7.',
  model: 'Run an approved, pinned model. Unavailable until PR7.',
  export: 'Create a human-approved external artifact. Unavailable until a later gate.',
};

function readableExpiry(value: string | null): string {
  if (!value) return 'not active';
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function connectionMessage(snapshot: AgentConnectionSnapshot): string {
  switch (snapshot.phase) {
    case 'idle':
      return 'Agent access is off.';
    case 'armed':
      return 'Waiting for a local Agent to request pairing.';
    case 'pending':
      return 'A local Agent is requesting access. No scope has been granted.';
    case 'approved':
      return 'Scopes approved. Waiting for the Agent to claim its one-shot challenge.';
    case 'connected':
      return `Connected to ${snapshot.clientLabel ?? 'local Agent'}.`;
    case 'revoked':
      return snapshot.error?.message ?? 'Agent access was revoked.';
    case 'expired':
      return snapshot.error?.message ?? 'Agent access expired.';
    case 'error':
      return snapshot.error?.message ?? 'Agent access failed closed.';
  }
}

export function AgentConnectionPanel({
  manager,
}: {
  manager: AgentSessionManager;
}) {
  const snapshot = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );
  const [selected, setSelected] = useState<AgentScope[]>([]);
  const [uiError, setUiError] = useState<AgentBridgeError | null>(null);
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

  useEffect(() => {
    if (snapshot.phase === 'pending') {
      setSelected([]);
      setUiError(null);
    }
    if (snapshot.phase !== 'pending' && snapshot.phase !== 'approved') return;
    queueMicrotask(() => headingRef.current?.focus());
  }, [snapshot.phase, snapshot.clientFingerprint]);

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
        <span>{connectionMessage(snapshot)}</span>
      </div>

      {snapshot.phase === 'idle' && (
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
            Review Agent access
          </h2>
          <p id="agent-pairing-description">
            Origin: <code>{snapshot.origin}</code>
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
            This label and document content are untrusted. They cannot grant or
            elevate permissions.
          </p>
          <fieldset disabled={snapshot.phase === 'approved'}>
            <legend>Grant only the scopes you intend</legend>
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
                  </span>
                </label>
              );
            })}
          </fieldset>
          <p>Pairing expires at {readableExpiry(snapshot.expiresAt)}.</p>
          <div className="agent-dialog-actions">
            <button
              type="button"
              data-agent-action="cancel-agent-pairing"
              onClick={(event) =>
                requireTrustedGesture(event, () => manager.rejectPairing())}
            >
              Deny
            </button>
            {snapshot.phase === 'pending' && (
              <button
                type="button"
                data-agent-action="approve-agent-pairing"
                disabled={selected.length === 0}
                onClick={(event) => requireTrustedGesture(event, () => {
                  const result = manager.approvePairing(selected);
                  if (!result.ok) setUiError(result.error);
                })}
              >
                Approve selected scopes
              </button>
            )}
          </div>
        </dialog>
      )}
    </aside>
  );
}
