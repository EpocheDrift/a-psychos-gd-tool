import type { Edge, ParamValue } from '../engine/graph';
import type { AgentErrorCode, ValidationFinding } from './agentErrors';
import type { AssetMetadata } from './documentSchema';
import type { JsonValue } from './json';

export interface ClientRef {
  clientRef: string;
}

export type LayerRef = string | ClientRef;
export type NodeRef = string | ClientRef;

export interface Point {
  x: number;
  y: number;
}

export interface LayerPatch {
  name?: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
}

export interface NodeMove {
  nodeId: NodeRef;
  position: Point;
}

export type DocumentCommand =
  | { op: 'set_frame'; width: number; height: number }
  | {
      op: 'add_layer';
      clientRef: string;
      name?: string;
      afterLayerId?: LayerRef;
    }
  | { op: 'update_layer'; layerId: LayerRef; patch: LayerPatch }
  | { op: 'move_layer'; layerId: LayerRef; index: number }
  | { op: 'remove_layer'; layerId: LayerRef }
  | {
      op: 'add_node';
      layerId: LayerRef;
      clientRef: string;
      nodeType: string;
      /**
       * Public values are JSON-safe. Most parameters are scalar ParamValue;
       * binds additionally accept their manifest-advertised structured array.
       */
      params?: Record<string, JsonValue>;
      position?: Point;
    }
  | {
      op: 'set_node_params';
      layerId: LayerRef;
      nodeId: NodeRef;
      patch: Record<string, JsonValue>;
    }
  | {
      op: 'move_nodes';
      layerId: LayerRef;
      /** JSON-capable replacement for the architecture sketch's impossible Record<NodeRef, Point>. */
      positions: NodeMove[];
    }
  | { op: 'remove_nodes'; layerId: LayerRef; nodeIds: NodeRef[] }
  | {
      op: 'connect';
      layerId: LayerRef;
      from: { nodeId: NodeRef; socket: string };
      to: { nodeId: NodeRef; socket: string };
      replaceExisting?: boolean;
    }
  | {
      op: 'disconnect';
      layerId: LayerRef;
      to: { nodeId: NodeRef; socket: string };
    }
  | { op: 'auto_layout_graph'; layerId: LayerRef; direction?: 'LR' | 'TB' };

export interface TransactionRequest {
  requestId: string;
  expectedRevision: number;
  commands: DocumentCommand[];
  dryRun?: boolean;
}

export interface RevertTransactionRequest {
  requestId: string;
  expectedRevision: number;
  transactionId: string;
}

export interface ChangedNodeRef {
  layerId: string;
  nodeId: string;
}

export interface ReplacedEdge {
  layerId: string;
  edge: Edge;
}

export interface TransactionChangeSummary {
  frame: boolean;
  layerIds: string[];
  assetIds: string[];
  /** Precise identities; node IDs are only unique inside a layer. */
  nodes: ChangedNodeRef[];
  edgeCountDelta: number;
  replacedEdges: ReplacedEdge[];
}

export interface CreatedEntity {
  kind: 'layer' | 'node';
  id: string;
  layerId?: string;
}

export interface TransactionSuccess {
  ok: true;
  requestId: string;
  dryRun: boolean;
  committed: boolean;
  /** Dry runs do not reserve a durable transaction ID. */
  transactionId: string | null;
  previousRevision: number;
  /** Current committed revision; unchanged for dry runs. */
  revision: number;
  proposedRevision: number;
  created: Record<string, string>;
  createdEntities: Record<string, CreatedEntity>;
  changed: TransactionChangeSummary;
  warnings: ValidationFinding[];
}

export interface AgentFailure {
  ok: false;
  requestId?: string;
  revision: number;
  error: {
    code: AgentErrorCode;
    message: string;
    path?: string;
    commandIndex?: number;
    details?: Record<string, JsonValue>;
    recoverable: boolean;
    suggestedFix?: string;
  };
}

export type TransactionResult = TransactionSuccess | AgentFailure;

export interface RuntimeDocumentState {
  documentId: string;
  document: import('../engine/graph').Doc;
  assets?: AssetMetadata[];
  revision: number;
}

export interface CommandApplication {
  result: TransactionResult;
  /**
   * Fully validated proposed state for internal policy inspection. Dry runs
   * expose it only to the in-process host; it is never part of the public
   * TransactionResult and is never committed.
   */
  proposed?: RuntimeDocumentState;
  next?: RuntimeDocumentState;
}

export interface CommandApplyOptions {
  /**
   * Agent transactions use editable input + renderable final validation.
   * The UI adapter can use structural validation to preserve transient drafts,
   * while still sharing the same command implementation.
   */
  baseValidationMode?: 'structural' | 'editable';
  finalValidationMode?: 'structural' | 'editable' | 'renderable';
  allowTransientParamValues?: boolean;
  /** Public Agent calls honor manifest write policy by default. */
  enforceAgentWritable?: boolean;
  /** Trusted UI adapters may pass the version 3 persisted binds string. */
  acceptPersistedBinds?: boolean;
  /** Trusted UI naming fields may transiently be empty while the user types. */
  allowEmptyLayerNames?: boolean;
}

export type PersistedParamValue = ParamValue;
