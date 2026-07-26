import type {
  AgentErrorCode,
  ValidationMode,
  ValidationReport,
} from '../domain/agentErrors';
import type {
  RevertTransactionRequest,
  TransactionRequest,
  TransactionResult,
} from '../domain/commandTypes';
import type { JsonObject, JsonValue } from '../domain/json';
import type { AgentLimits } from '../domain/limits';
import type { PreviewMetricsV1 } from '../render/previewMetrics';

export const AGENT_PROTOCOL_VERSION = '1.0' as const;

export const AGENT_SCOPES = [
  'read',
  'preview',
  'edit',
  'assets',
  'model',
  'export',
] as const;

export type AgentScope = (typeof AGENT_SCOPES)[number];

/**
 * PR5 exposes the complete vocabulary, while later rollout gates still keep
 * asset, model-download, and filesystem-export authority unavailable.
 */
export const PR5_AVAILABLE_SCOPES = [
  'read',
  'preview',
  'edit',
] as const satisfies readonly AgentScope[];

export const DOCUMENT_CONTENT_TRUST = 'untrusted-document-content' as const;

export type AgentBridgeErrorCode =
  | AgentErrorCode
  | 'UNAUTHENTICATED'
  | 'PAIRING_NOT_ARMED'
  | 'PAIRING_NOT_APPROVED'
  | 'PAIRING_EXPIRED'
  | 'PAIRING_REPLAYED'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'OWNER_ALREADY_CONNECTED'
  | 'INTERNAL';

export interface AgentBridgeError {
  code: AgentBridgeErrorCode;
  message: string;
  recoverable: boolean;
  path?: string;
  details?: Record<string, JsonValue>;
  suggestedFix?: string;
}

/**
 * Controller faults are deliberately plain JSON data rather than Error
 * instances. Callers can catch them without receiving a stack, cause, DOM
 * object, or other ambient browser authority.
 */
export interface AgentControllerFault {
  name: 'AgentControllerFault';
  ok: false;
  revision: number;
  error: AgentBridgeError;
}

export type PairingResult<T extends JsonValue> =
  | { ok: true; value: T }
  | { ok: false; error: AgentBridgeError };

export interface PairingRequest extends JsonObject {
  protocolVersion: typeof AGENT_PROTOCOL_VERSION;
  clientNonce: string;
  clientLabel: string;
  requestedScopes: AgentScope[];
}

export interface PairingChallenge extends JsonObject {
  protocolVersion: typeof AGENT_PROTOCOL_VERSION;
  pairingId: string;
  clientNonce: string;
  serverNonce: string;
  /**
   * A 256-bit one-shot secret. It is returned only to the requesting caller,
   * stored only as a digest by the page, and consumed by completePairing.
   */
  claimToken: string;
  expiresAt: string;
}

export interface CompletePairingRequest extends JsonObject {
  pairingId: string;
  clientNonce: string;
  serverNonce: string;
  claimToken: string;
}

export interface AgentSessionSummary extends JsonObject {
  protocolVersion: typeof AGENT_PROTOCOL_VERSION;
  clientLabel: string;
  clientFingerprint: string;
  sessionFingerprint: string;
  origin: string;
  scopes: AgentScope[];
  connectedAt: string;
  expiresAt: string;
}

export interface AgentPairingBootstrap {
  requestPairing(request: PairingRequest): PairingResult<PairingChallenge>;
  completePairing(
    request: CompletePairingRequest,
  ): PairingResult<AgentSessionSummary>;
}

export type CapabilityInclude = 'sockets' | 'params' | 'traits';

export interface CapabilityRequest {
  nodeTypes?: string[];
  include?: CapabilityInclude[];
}

export interface PublicNodeCapability {
  type: string;
  label: string;
  category: string;
  description?: string;
  inputs?: JsonValue[];
  outputs?: JsonValue[];
  params?: JsonValue[];
  traits?: JsonObject;
  execution?: JsonObject;
}

export interface CapabilitySnapshot {
  protocolVersion: typeof AGENT_PROTOCOL_VERSION;
  documentSchemaVersions: number[];
  socketTypes: string[];
  nodes: PublicNodeCapability[];
  limits: AgentLimits;
  features: {
    transactions: boolean;
    dryRun: boolean;
    previews: boolean;
    assets: boolean;
    mcp: boolean;
  };
  preview: JsonObject;
  scopeAvailability: Record<
    AgentScope,
    {
      available: boolean;
      reason?: string;
    }
  >;
  omitted: string[];
}

export type DocumentInclude =
  | 'frame'
  | 'layers'
  | 'nodes'
  | 'edges'
  | 'positions';

export interface GetDocumentRequest {
  revision?: number;
  layerIds?: string[];
  include?: DocumentInclude[];
  compact?: boolean;
}

export interface DocumentRedaction {
  path: string;
  kind: 'embedded-image-data';
  mimeType: string;
  encodedCharacters: number;
  sha256: string;
}

export interface DocumentSnapshot {
  protocolVersion: typeof AGENT_PROTOCOL_VERSION;
  schemaVersion: 3;
  revision: number;
  documentId: string;
  trust: typeof DOCUMENT_CONTENT_TRUST;
  frame?: { width: number; height: number };
  layers?: JsonValue[];
  omitted: string[];
  redactions: DocumentRedaction[];
}

export type ValidateDocumentRequest =
  | {
      source: 'current';
      mode?: ValidationMode;
      maxFindings?: number;
    }
  | {
      source: 'project';
      project: JsonValue;
      mode?: ValidationMode;
      maxFindings?: number;
    };

export interface PublicValidationReport {
  trust: typeof DOCUMENT_CONTENT_TRUST;
  report: ValidationReport;
}

export interface PublicRenderStatusRequest {
  revision?: number;
  attempt?: number;
  includeEvents?: boolean;
}

export interface PublicAwaitRenderRequest {
  revision: number;
  attempt?: number;
  timeoutMs?: number;
}

export interface PublicRenderStatus {
  documentRevision: number;
  ticket: { revision: number; attempt: number } | null;
  displayedTicket: { revision: number; attempt: number } | null;
  displayedRevision: number | null;
  requestedRevision: number | null;
  renderRevision: number | null;
  state: 'idle' | 'queued' | 'cooking' | 'complete' | 'failed' | 'superseded';
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  width?: number;
  height?: number;
  error?: JsonObject;
  events?: JsonValue[];
  omitted: string[];
}

export interface PublicPreviewRequest {
  revision: number;
  attempt?: number;
  maxWidth?: number;
  maxHeight?: number;
  format?: 'png' | 'webp';
  includeMetrics?: boolean;
}

export interface PublicPreviewHandle {
  kind: 'browser-object-url-v1';
  handleId: string;
  url: string;
  mimeType: 'image/png' | 'image/webp';
  byteLength: number;
  contentHash: string;
  trust: 'untrusted-document-render';
  expiresAt: string;
}

export interface PublicPreviewResult {
  trust: 'untrusted-document-render';
  requestedRevision: number;
  revision: number;
  attempt: number;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/webp';
  byteLength: number;
  contentHash: string;
  rgbaSha256: string;
  capturePolicy: 'current-exact-ticket-v1';
  image: PublicPreviewHandle;
  metrics?: PreviewMetricsV1;
}

export interface AgentController {
  getCapabilities(request?: CapabilityRequest): CapabilitySnapshot;
  getDocument(request?: GetDocumentRequest): DocumentSnapshot;
  validateDocument(request: ValidateDocumentRequest): PublicValidationReport;
  applyTransaction(request: TransactionRequest): Promise<TransactionResult>;
  getRenderStatus(request?: PublicRenderStatusRequest): PublicRenderStatus;
  awaitRender(request: PublicAwaitRenderRequest): Promise<PublicRenderStatus>;
  capturePreview(request: PublicPreviewRequest): Promise<PublicPreviewResult>;
  revertTransaction(request: RevertTransactionRequest): Promise<TransactionResult>;
}

declare global {
  interface Window {
    /** Undefined until an explicitly approved pairing has been claimed. */
    readonly gfxAgent?: AgentController;
    /** Present only in an explicitly Agent-enabled, runtime-approved build. */
    readonly gfxAgentPairing?: AgentPairingBootstrap;
  }
}
