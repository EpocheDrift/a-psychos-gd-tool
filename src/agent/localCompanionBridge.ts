import {
  AGENT_ALLOWED_ORIGIN,
  AGENT_COMPANION_CONTROL_META_NAME,
  AGENT_COMPANION_CONTROL_MODE_INTERACTIVE,
  AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL,
  AGENT_COMPANION_META_NAME,
  AGENT_COMPANION_META_VALUE,
  AGENT_WEBSOCKET_PATH,
  AGENT_WEBSOCKET_PROTOCOL,
  type AgentCompanionControlMode,
} from '../../packages/mcp-companion/src/agentSecurity';
import {
  COMPANION_PROTOCOL_VERSION,
  COMPANION_TRANSPORT_LIMITS,
  isCompanionOperation,
  isCompanionWriteOperation,
  type CompanionBinaryHeader,
  type CompanionCancel,
  type CompanionRequest,
  type CompanionServerMessage,
  type CompanionWelcome,
} from '../../packages/mcp-companion/src/protocol';
import {
  assertBoundedWireJson,
} from '../../packages/mcp-companion/src/boundedJson';
import type {
  AgentBridgeError,
  AgentController,
  AgentControllerFault,
  AgentSessionSummary,
  CompletePairingRequest,
  PairingRequest,
  PairingResult,
} from './contracts';
import type { AgentCompanionController } from './controller';
import { controllerFault, normalizeControllerFailure } from './faults';
import type { PreviewHandleVault } from './previewVault';
import type { AgentSessionManager } from './sessionManager';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const textEncoder = new TextEncoder();

interface CompanionBridgeBindings {
  manager: AgentSessionManager;
  completePairing(
    request: CompletePairingRequest,
  ): PairingResult<AgentSessionSummary>;
  getController(): AgentController | undefined;
  getCompanionController(): AgentCompanionController | undefined;
  getPreviewVault(): PreviewHandleVault | null;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomToken(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

function isWelcome(value: unknown): value is CompanionWelcome {
  return plainRecord(value)
    && hasExactKeys(value, [
      'kind',
      'protocolVersion',
      'connectionId',
      'serverNonce',
    ])
    && value.kind === 'welcome'
    && value.protocolVersion === COMPANION_PROTOCOL_VERSION
    && typeof value.connectionId === 'string'
    && ID_PATTERN.test(value.connectionId)
    && typeof value.serverNonce === 'string'
    && TOKEN_PATTERN.test(value.serverNonce);
}

function isAuthenticatedServerMessage(
  value: unknown,
  connectionId: string,
  channelToken: string,
  expectedSequence: number,
): value is CompanionRequest | CompanionCancel {
  if (!plainRecord(value)) return false;
  if (
    value.protocolVersion !== COMPANION_PROTOCOL_VERSION
    || value.connectionId !== connectionId
    || value.channelToken !== channelToken
    || value.sequence !== expectedSequence
    || !Number.isSafeInteger(value.sequence)
  ) {
    return false;
  }
  if (value.kind === 'request') {
    return hasExactKeys(value, [
      'kind',
      'protocolVersion',
      'connectionId',
      'channelToken',
      'sequence',
      'requestId',
      'operation',
      'input',
    ])
      && typeof value.requestId === 'string'
      && ID_PATTERN.test(value.requestId)
      && isCompanionOperation(value.operation);
  }
  if (value.kind === 'cancel') {
    return hasExactKeys(value, [
      'kind',
      'protocolVersion',
      'connectionId',
      'channelToken',
      'sequence',
      'requestId',
    ])
      && typeof value.requestId === 'string'
      && ID_PATTERN.test(value.requestId);
  }
  return false;
}

function faultFromBridgeError(
  error: AgentBridgeError,
): AgentControllerFault {
  return controllerFault(0, error.code, error.message, {
    recoverable: error.recoverable,
    ...(error.path === undefined ? {} : { path: error.path }),
    ...(error.details === undefined ? {} : { details: error.details }),
    ...(error.suggestedFix === undefined
      ? {}
      : { suggestedFix: error.suggestedFix }),
  });
}

function phaseFailure(manager: AgentSessionManager): AgentControllerFault {
  const snapshot = manager.getSnapshot();
  if (snapshot.error) return faultFromBridgeError(snapshot.error);
  return controllerFault(
    0,
    'PAIRING_NOT_APPROVED',
    'The human has not approved this local Agent session.',
  );
}

function waitForPairingPhase(
  manager: AgentSessionManager,
  accepted: ReadonlySet<string>,
  deadlineMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (error?: AgentControllerFault) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const inspect = () => {
      const phase = manager.getSnapshot().phase;
      if (accepted.has(phase)) {
        finish();
        return;
      }
      if (
        phase === 'revoked'
        || phase === 'expired'
        || phase === 'error'
      ) {
        finish(phaseFailure(manager));
      }
    };
    const timer = setTimeout(() => {
      finish(controllerFault(
        0,
        'TIMEOUT',
        'The in-app Agent approval window timed out.',
      ));
    }, deadlineMs);
    unsubscribe = manager.subscribe(inspect);
    inspect();
  });
}

async function completeHumanPairing(
  bindings: CompanionBridgeBindings,
  input: unknown,
): Promise<AgentSessionSummary> {
  const deadline =
    Date.now() + COMPANION_TRANSPORT_LIMITS.pairingDeadlineMs;
  const remainingMs = () => Math.max(0, deadline - Date.now());
  if (bindings.manager.getSnapshot().phase === 'idle') {
    // The authenticated local Companion may present the approval request
    // without first making the human click a no-authority "Connect" button.
    // The session still receives no scope until the trusted Allow action.
    const armed = bindings.manager.armPairing();
    if (!armed.ok) throw faultFromBridgeError(armed.error);
  }
  await waitForPairingPhase(
    bindings.manager,
    new Set(['armed']),
    remainingMs(),
  );
  const challenge = bindings.manager.requestPairing(input as PairingRequest);
  if (!challenge.ok) throw faultFromBridgeError(challenge.error);
  await waitForPairingPhase(
    bindings.manager,
    new Set(['approved']),
    remainingMs(),
  );
  // The one-shot claim never leaves this authenticated owning-page realm.
  const completed = bindings.completePairing({
    pairingId: challenge.value.pairingId,
    clientNonce: challenge.value.clientNonce,
    serverNonce: challenge.value.serverNonce,
    claimToken: challenge.value.claimToken,
  });
  if (!completed.ok) throw faultFromBridgeError(completed.error);
  return completed.value;
}

async function completeTrustedLocalPairing(
  bindings: CompanionBridgeBindings,
  input: unknown,
): Promise<AgentSessionSummary> {
  const phase = bindings.manager.getSnapshot().phase;
  if (phase === 'idle') {
    const armed = bindings.manager.armPairing();
    if (!armed.ok) throw faultFromBridgeError(armed.error);
  } else if (phase !== 'armed') {
    throw phaseFailure(bindings.manager);
  }

  const challenge = bindings.manager.requestPairing(input as PairingRequest);
  if (!challenge.ok) throw faultFromBridgeError(challenge.error);
  const requestedScopes =
    bindings.manager.getSnapshot().requestedScopes;
  const approved = bindings.manager.approvePairing(requestedScopes);
  if (!approved.ok) throw faultFromBridgeError(approved.error);

  // Trusted Local is an explicit process startup policy. It removes browser
  // click ceremony but keeps the same one-shot proof, immutable scopes,
  // revision checks, transport revocation, and in-app kill switch.
  const completed = bindings.completePairing({
    pairingId: challenge.value.pairingId,
    clientNonce: challenge.value.clientNonce,
    serverNonce: challenge.value.serverNonce,
    claimToken: challenge.value.claimToken,
  });
  if (!completed.ok) throw faultFromBridgeError(completed.error);
  return completed.value;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function dispatchControllerRequest(
  operation: CompanionRequest['operation'],
  input: unknown,
  bindings: CompanionBridgeBindings,
  controlMode: AgentCompanionControlMode,
  signal?: AbortSignal,
): Promise<
  | { kind: 'json'; value: unknown }
  | {
      kind: 'binary';
      value: Record<string, unknown>;
      bytes: ArrayBuffer;
      mimeType: 'image/png' | 'image/webp';
      contentHash: string;
    }
> {
  if (operation === 'pairRequest') {
    return {
      kind: 'json',
      value: controlMode === AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL
        ? await completeTrustedLocalPairing(bindings, input)
        : await completeHumanPairing(bindings, input),
    };
  }
  const controller = bindings.getController();
  if (!controller) {
    throw controllerFault(
      0,
      'PAIRING_NOT_APPROVED',
      'Approve the local Agent session in the browser before calling tools.',
    );
  }

  switch (operation) {
    case 'getCapabilities':
      return { kind: 'json', value: controller.getCapabilities(input as never) };
    case 'getDocument':
      return { kind: 'json', value: controller.getDocument(input as never) };
    case 'getRenderStatus':
      return { kind: 'json', value: controller.getRenderStatus(input as never) };
    case 'validateDocument':
      return {
        kind: 'json',
        value: await controller.validateDocument(input as never),
      };
    case 'applyTransaction':
      return {
        kind: 'json',
        value: await controller.applyTransaction(input as never),
      };
    case 'awaitRender':
      {
        const companionController = bindings.getCompanionController();
        if (!signal || !companionController) {
          throw controllerFault(
            0,
            'INTERNAL',
            'The cancellable render bridge is unavailable.',
            { recoverable: false },
          );
        }
        return {
          kind: 'json',
          value: await companionController.awaitRender(
            input as never,
            signal,
          ),
        };
      }
    case 'revertTransaction':
      return {
        kind: 'json',
        value: await controller.revertTransaction(input as never),
      };
    case 'putAsset':
      return {
        kind: 'json',
        value: await controller.putAsset(input as never),
      };
    case 'listAssets':
      return {
        kind: 'json',
        value: await controller.listAssets(input as never),
      };
    case 'getAssetMetadata':
      return {
        kind: 'json',
        value: await controller.getAssetMetadata(input as never),
      };
    case 'removeAsset':
      return {
        kind: 'json',
        value: await controller.removeAsset(input as never),
      };
    case 'measureRenderedNodes':
      return {
        kind: 'json',
        value: controller.measureRenderedNodes(input as never),
      };
    case 'capturePreview': {
      const companionController = bindings.getCompanionController();
      if (!signal || !companionController) {
        throw controllerFault(
          0,
          'INTERNAL',
          'The cancellable preview bridge is unavailable.',
          { recoverable: false },
        );
      }
      const result = await companionController.capturePreview(
        input as never,
        signal,
      );
      const vault = bindings.getPreviewVault();
      if (!vault) {
        throw controllerFault(
          result.revision,
          'INTERNAL',
          'The bounded preview vault is unavailable.',
          { recoverable: false },
        );
      }
      const bytes = vault.resolveBytes(result.image.handleId);
      vault.remove(result.image.handleId);
      if (
        !bytes
        || bytes.byteLength !== result.byteLength
        || bytes.byteLength > COMPANION_TRANSPORT_LIMITS.maxPreviewBytes
      ) {
        throw controllerFault(
          result.revision,
          'INTERNAL',
          'The preview transport received invalid bounded bytes.',
          { recoverable: false },
        );
      }
      const contentHash = await sha256Hex(bytes);
      if (contentHash !== result.contentHash) {
        throw controllerFault(
          result.revision,
          'INTERNAL',
          'The preview transport integrity check failed.',
          { recoverable: false },
        );
      }
      const { image: _internalHandle, ...metadata } = result;
      return {
        kind: 'binary',
        value: {
          ...metadata,
          image: {
            kind: 'mcp-image-content-v1',
            mimeType: result.mimeType,
            byteLength: result.byteLength,
            contentHash: result.contentHash,
            trust: result.trust,
          },
        },
        bytes,
        mimeType: result.mimeType,
        contentHash,
      };
    }
    default: {
      const exhaustive: never = operation;
      throw controllerFault(
        0,
        'INVALID_ARGUMENT',
        `Unsupported companion operation: ${String(exhaustive)}.`,
      );
    }
  }
}

function encodeBinaryResponse(
  header: CompanionBinaryHeader,
  bytes: ArrayBuffer,
): ArrayBuffer {
  assertBoundedWireJson(header);
  const headerBytes = textEncoder.encode(JSON.stringify(header));
  if (
    headerBytes.byteLength > COMPANION_TRANSPORT_LIMITS.maxBinaryHeaderBytes
    || bytes.byteLength > COMPANION_TRANSPORT_LIMITS.maxPreviewBytes
  ) {
    throw controllerFault(
      Number(header.value.revision ?? 0),
      'RESOURCE_LIMIT',
      'The preview response exceeds the companion transport budget.',
    );
  }
  const output = new Uint8Array(4 + headerBytes.byteLength + bytes.byteLength);
  new DataView(output.buffer).setUint32(0, headerBytes.byteLength, false);
  output.set(headerBytes, 4);
  output.set(new Uint8Array(bytes), 4 + headerBytes.byteLength);
  return output.buffer;
}

export function hasLocalCompanionMarker(document: Document): boolean {
  const marker = document.querySelector(
    `meta[name="${AGENT_COMPANION_META_NAME}"]`,
  );
  return marker instanceof HTMLMetaElement
    && marker.content === AGENT_COMPANION_META_VALUE;
}

export function localCompanionControlMode(
  document: Document,
): AgentCompanionControlMode {
  const marker = document.querySelector(
    `meta[name="${AGENT_COMPANION_CONTROL_META_NAME}"]`,
  );
  return marker instanceof HTMLMetaElement
    && marker.content === AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL
    ? AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL
    : AGENT_COMPANION_CONTROL_MODE_INTERACTIVE;
}

export function installLocalCompanionBridge(
  target: Window,
  bindings: CompanionBridgeBindings,
): () => void {
  if (!hasLocalCompanionMarker(target.document)) return () => undefined;
  if (target.location.origin !== AGENT_ALLOWED_ORIGIN) return () => undefined;
  const controlMode = localCompanionControlMode(target.document);

  const socketUrl =
    `${AGENT_ALLOWED_ORIGIN.replace(/^http:/, 'ws:')}${AGENT_WEBSOCKET_PATH}`;
  const socket = new WebSocket(socketUrl, AGENT_WEBSOCKET_PROTOCOL);
  socket.binaryType = 'arraybuffer';
  let connectionId = '';
  let channelToken = '';
  let incomingSequence = 0;
  let outgoingSequence = 0;
  let authenticated = false;
  let disposed = false;
  let pairingStarted = false;
  const activeRequests = new Set<string>();
  const activeOperations = new Map<string, AbortController | null>();
  let activeWrites = 0;
  let activeRenderWaits = 0;
  let activePreviews = 0;
  let rateTokens: number = COMPANION_TRANSPORT_LIMITS.requestBurst;
  let assetRateTokens: number =
    COMPANION_TRANSPORT_LIMITS.assetUploadRequestBurst;
  let lastRateRefill = Date.now();

  const closeProtocol = (reason: string) => {
    if (
      socket.readyState === WebSocket.OPEN
      || socket.readyState === WebSocket.CONNECTING
    ) {
      // Browser WebSocket APIs permit application close codes only in
      // 3000-4999. The Node peer treats 4002 as a protocol/session failure.
      socket.close(4002, reason.slice(0, 100));
    }
  };

  const sendJson = (value: unknown) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    let text: string;
    try {
      assertBoundedWireJson(value);
      text = JSON.stringify(value);
    } catch {
      closeProtocol('invalid bounded response');
      return;
    }
    if (
      textEncoder.encode(text).byteLength
      > COMPANION_TRANSPORT_LIMITS.maxTextMessageBytes
    ) {
      closeProtocol('response budget exceeded');
      return;
    }
    socket.send(text);
  };

  const authenticatedEnvelope = () => ({
    protocolVersion: COMPANION_PROTOCOL_VERSION,
    connectionId,
    channelToken,
    sequence: ++outgoingSequence,
  });

  const respond = async (request: CompanionRequest) => {
    const now = Date.now();
    rateTokens = Math.min(
      COMPANION_TRANSPORT_LIMITS.requestBurst,
      rateTokens
      + Math.max(0, now - lastRateRefill)
        * (COMPANION_TRANSPORT_LIMITS.requestsPerMinute / 60_000),
    );
    assetRateTokens = Math.min(
      COMPANION_TRANSPORT_LIMITS.assetUploadRequestBurst,
      assetRateTokens
      + Math.max(0, now - lastRateRefill)
        * (COMPANION_TRANSPORT_LIMITS.requestsPerMinute / 60_000),
    );
    lastRateRefill = now;
    const isWrite = isCompanionWriteOperation(request.operation);
    const isRenderWait = request.operation === 'awaitRender';
    const isPreview = request.operation === 'capturePreview';
    const countsAgainstPublicRate = request.operation !== 'pairRequest';
    if (
      (
        countsAgainstPublicRate
        && (
          request.operation === 'putAsset'
            ? assetRateTokens < 1
            : rateTokens < 1
        )
      )
      || activeRequests.size
        >= COMPANION_TRANSPORT_LIMITS.maxPendingRequests
      || activeRequests.has(request.requestId)
      || (
        isWrite
        && activeWrites
          >= COMPANION_TRANSPORT_LIMITS.maxConcurrentWrites
      )
      || (
        isRenderWait
        && activeRenderWaits
          >= COMPANION_TRANSPORT_LIMITS.maxPendingAwaitRender
      )
      || (
        isPreview
        && activePreviews
          >= COMPANION_TRANSPORT_LIMITS.maxPendingPreview
      )
    ) {
      closeProtocol('request budget or replay violation');
      return;
    }
    if (countsAgainstPublicRate) {
      if (request.operation === 'putAsset') assetRateTokens -= 1;
      else rateTokens -= 1;
    }
    activeRequests.add(request.requestId);
    const abortController =
      !isWrite
      && request.operation !== 'pairRequest'
        ? new AbortController()
        : null;
    activeOperations.set(request.requestId, abortController);
    if (isWrite) activeWrites++;
    if (isRenderWait) activeRenderWaits++;
    if (isPreview) activePreviews++;
    try {
      const result = await dispatchControllerRequest(
        request.operation,
        request.input,
        bindings,
        controlMode,
        abortController?.signal,
      );
      if (result.kind === 'json') {
        sendJson({
          kind: 'response',
          ...authenticatedEnvelope(),
          requestId: request.requestId,
          ok: true,
          value: result.value,
        });
        return;
      }
      const header: CompanionBinaryHeader = {
        kind: 'binary-response',
        ...authenticatedEnvelope(),
        requestId: request.requestId,
        ok: true,
        value: result.value,
        mimeType: result.mimeType,
        byteLength: result.bytes.byteLength,
        contentHash: result.contentHash,
      };
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(encodeBinaryResponse(header, result.bytes));
      }
    } catch (error) {
      const fault = normalizeControllerFailure(error, 0);
      sendJson({
        kind: 'response',
        ...authenticatedEnvelope(),
        requestId: request.requestId,
        ok: false,
        fault,
      });
    } finally {
      activeRequests.delete(request.requestId);
      activeOperations.delete(request.requestId);
      if (isWrite) activeWrites--;
      if (isRenderWait) activeRenderWaits--;
      if (isPreview) activePreviews--;
    }
  };

  socket.addEventListener('message', (event) => {
    if (disposed || typeof event.data !== 'string') {
      closeProtocol('unexpected binary request');
      return;
    }
    if (
      textEncoder.encode(event.data).byteLength
      > COMPANION_TRANSPORT_LIMITS.maxTextMessageBytes
    ) {
      closeProtocol('request budget exceeded');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
      assertBoundedWireJson(parsed);
    } catch {
      closeProtocol('invalid bounded JSON');
      return;
    }
    if (!authenticated) {
      if (!isWelcome(parsed)) {
        closeProtocol('invalid welcome');
        return;
      }
      connectionId = parsed.connectionId;
      channelToken = randomToken(32);
      outgoingSequence = 1;
      sendJson({
        kind: 'hello',
        protocolVersion: COMPANION_PROTOCOL_VERSION,
        connectionId,
        serverNonce: parsed.serverNonce,
        channelToken,
        sequence: 1,
      });
      authenticated = true;
      return;
    }
    if (!isAuthenticatedServerMessage(
      parsed,
      connectionId,
      channelToken,
      incomingSequence + 1,
    )) {
      closeProtocol('invalid authenticated envelope');
      return;
    }
    incomingSequence = parsed.sequence;
    const message: CompanionServerMessage = parsed;
    if (message.kind === 'cancel') {
      const active = activeOperations.get(message.requestId);
      if (active && !active.signal.aborted) {
        active.abort(new DOMException(
          'The MCP client cancelled the request.',
          'AbortError',
        ));
      }
      return;
    }
    if (message.operation === 'pairRequest') {
      if (pairingStarted) {
        closeProtocol('pairing replay');
        return;
      }
      pairingStarted = true;
    }
    void respond(message);
  });

  const revokeForTransportLoss = () => {
    if (disposed) return;
    disposed = true;
    const phase = bindings.manager.getSnapshot().phase;
    if (
      phase === 'pending'
      || phase === 'approved'
      || phase === 'connected'
    ) {
      bindings.manager.revoke('transport');
    }
    activeRequests.clear();
    for (const active of activeOperations.values()) {
      active?.abort(new DOMException(
        'The companion transport ended.',
        'AbortError',
      ));
    }
    activeOperations.clear();
  };
  socket.addEventListener('close', revokeForTransportLoss);
  socket.addEventListener('error', () => {
    // close drives the single cleanup path; error details stay out of the UI.
  });
  let observedConnected = false;
  const unsubscribeSession = bindings.manager.subscribe(() => {
    const phase = bindings.manager.getSnapshot().phase;
    if (phase === 'connected') {
      observedConnected = true;
      return;
    }
    if (
      observedConnected
      && (
        phase === 'revoked'
        || phase === 'expired'
        || phase === 'error'
      )
    ) {
      closeProtocol('Agent session ended');
    }
  });

  return () => {
    unsubscribeSession();
    revokeForTransportLoss();
    if (
      socket.readyState === WebSocket.OPEN
      || socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close(1000, 'page cleanup');
    }
  };
}
