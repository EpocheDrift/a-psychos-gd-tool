/**
 * Pure transport contract shared by the browser adapter and the Node
 * companion. Keep this module free of Node, DOM, MCP, and application imports.
 */
import { AGENT_HOST, AGENT_PORT } from './agentSecurity.js';
export const COMPANION_PROTOCOL_VERSION = '1.0' as const;

export const COMPANION_TOOL_OPERATIONS = [
  'getCapabilities',
  'getDocument',
  'getRenderStatus',
  'validateDocument',
  'applyTransaction',
  'awaitRender',
  'capturePreview',
  'revertTransaction',
] as const;

export type CompanionToolOperation =
  (typeof COMPANION_TOOL_OPERATIONS)[number];

export const COMPANION_INTERNAL_OPERATIONS = [
  'pairRequest',
] as const;

export type CompanionInternalOperation =
  (typeof COMPANION_INTERNAL_OPERATIONS)[number];

export type CompanionOperation =
  | CompanionToolOperation
  | CompanionInternalOperation;

export const COMPANION_WRITE_OPERATIONS = [
  'applyTransaction',
  'revertTransaction',
] as const satisfies readonly CompanionToolOperation[];

export const COMPANION_TRANSPORT_LIMITS = Object.freeze({
  maxTextMessageBytes: 2_621_440,
  maxBinaryHeaderBytes: 65_536,
  maxPreviewBytes: 4 * 1024 * 1024,
  maxBinaryMessageBytes: 4 * 1024 * 1024 + 65_536 + 4,
  maxStdioLineBytes: 3 * 1024 * 1024,
  maxStdioOutputLineBytes: 7 * 1024 * 1024,
  maxPendingRequests: 8,
  maxPendingAwaitRender: 4,
  maxPendingPreview: 1,
  maxConcurrentWrites: 1,
  requestsPerMinute: 120,
  requestBurst: 16,
  helloDeadlineMs: 10_000,
  defaultDeadlineMs: 10_000,
  renderDeadlineMs: 35_000,
  previewDeadlineMs: 20_000,
  pairingDeadlineMs: 60_000,
  heartbeatIntervalMs: 5_000,
  heartbeatTimeoutMs: 15_000,
  maxJsonDepth: 128,
  maxJsonValues: 250_000,
});

export interface CompanionEnvelope {
  protocolVersion: typeof COMPANION_PROTOCOL_VERSION;
  connectionId: string;
  channelToken: string;
  sequence: number;
}

export interface CompanionWelcome {
  kind: 'welcome';
  protocolVersion: typeof COMPANION_PROTOCOL_VERSION;
  connectionId: string;
  serverNonce: string;
}

export interface CompanionHello {
  kind: 'hello';
  protocolVersion: typeof COMPANION_PROTOCOL_VERSION;
  connectionId: string;
  serverNonce: string;
  channelToken: string;
  sequence: 1;
}

export interface CompanionRequest extends CompanionEnvelope {
  kind: 'request';
  requestId: string;
  operation: CompanionOperation;
  input: unknown;
}

export interface CompanionCancel extends CompanionEnvelope {
  kind: 'cancel';
  requestId: string;
}

export interface CompanionSuccess extends CompanionEnvelope {
  kind: 'response';
  requestId: string;
  ok: true;
  value: unknown;
}

export interface CompanionFailureShape {
  name: 'AgentControllerFault';
  ok: false;
  revision: number;
  error: {
    code: string;
    message: string;
    recoverable: boolean;
    path?: string;
    commandIndex?: number;
    details?: Record<string, unknown>;
    suggestedFix?: string;
  };
}

export interface CompanionFailure extends CompanionEnvelope {
  kind: 'response';
  requestId: string;
  ok: false;
  fault: CompanionFailureShape;
}

export interface CompanionBinaryHeader extends CompanionEnvelope {
  kind: 'binary-response';
  requestId: string;
  ok: true;
  value: Record<string, unknown>;
  mimeType: 'image/png' | 'image/webp';
  byteLength: number;
  contentHash: string;
}

export type CompanionServerMessage =
  | CompanionWelcome
  | CompanionRequest
  | CompanionCancel;

export type CompanionBrowserMessage =
  | CompanionHello
  | CompanionSuccess
  | CompanionFailure;

export interface CompanionBinaryResult {
  value: Record<string, unknown>;
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/webp';
  byteLength: number;
  contentHash: string;
}

export type CompanionCallResult = unknown | CompanionBinaryResult;

export function isCompanionToolOperation(
  value: unknown,
): value is CompanionToolOperation {
  return typeof value === 'string'
    && (COMPANION_TOOL_OPERATIONS as readonly string[]).includes(value);
}

export function isCompanionOperation(
  value: unknown,
): value is CompanionOperation {
  return isCompanionToolOperation(value)
    || (
      typeof value === 'string'
      && (COMPANION_INTERNAL_OPERATIONS as readonly string[]).includes(value)
    );
}

export function companionDeadlineMs(
  operation: CompanionOperation,
): number {
  switch (operation) {
    case 'pairRequest':
      return COMPANION_TRANSPORT_LIMITS.pairingDeadlineMs;
    case 'awaitRender':
      return COMPANION_TRANSPORT_LIMITS.renderDeadlineMs;
    case 'capturePreview':
      return COMPANION_TRANSPORT_LIMITS.previewDeadlineMs;
    case 'getCapabilities':
    case 'getDocument':
    case 'getRenderStatus':
    case 'validateDocument':
    case 'applyTransaction':
    case 'revertTransaction':
      return COMPANION_TRANSPORT_LIMITS.defaultDeadlineMs;
  }
}

export function companionTransportCapabilities(): Record<string, unknown> {
  return {
    protocol: 'authenticated-same-origin-websocket-v1',
    host: AGENT_HOST,
    port: AGENT_PORT,
    mcpTransport: 'stdio',
    messageLimits: {
      textBytes: COMPANION_TRANSPORT_LIMITS.maxTextMessageBytes,
      binaryHeaderBytes:
        COMPANION_TRANSPORT_LIMITS.maxBinaryHeaderBytes,
      binaryMessageBytes:
        COMPANION_TRANSPORT_LIMITS.maxBinaryMessageBytes,
      previewBytes: COMPANION_TRANSPORT_LIMITS.maxPreviewBytes,
      stdioRequestBytes: COMPANION_TRANSPORT_LIMITS.maxStdioLineBytes,
      stdioResponseBytes:
        COMPANION_TRANSPORT_LIMITS.maxStdioOutputLineBytes,
    },
    concurrency: {
      pendingRequests: COMPANION_TRANSPORT_LIMITS.maxPendingRequests,
      writes: COMPANION_TRANSPORT_LIMITS.maxConcurrentWrites,
      awaitRender: COMPANION_TRANSPORT_LIMITS.maxPendingAwaitRender,
      preview: COMPANION_TRANSPORT_LIMITS.maxPendingPreview,
    },
    rate: {
      requestsPerMinute: COMPANION_TRANSPORT_LIMITS.requestsPerMinute,
      burst: COMPANION_TRANSPORT_LIMITS.requestBurst,
    },
    jsonLimits: {
      depth: COMPANION_TRANSPORT_LIMITS.maxJsonDepth,
      values: COMPANION_TRANSPORT_LIMITS.maxJsonValues,
    },
    deadlines: {
      helloMs: COMPANION_TRANSPORT_LIMITS.helloDeadlineMs,
      queryAndWriteMs: COMPANION_TRANSPORT_LIMITS.defaultDeadlineMs,
      awaitRenderMs: COMPANION_TRANSPORT_LIMITS.renderDeadlineMs,
      previewMs: COMPANION_TRANSPORT_LIMITS.previewDeadlineMs,
      pairingMs: COMPANION_TRANSPORT_LIMITS.pairingDeadlineMs,
    },
    heartbeat: {
      intervalMs: COMPANION_TRANSPORT_LIMITS.heartbeatIntervalMs,
      timeoutMs: COMPANION_TRANSPORT_LIMITS.heartbeatTimeoutMs,
    },
  };
}
