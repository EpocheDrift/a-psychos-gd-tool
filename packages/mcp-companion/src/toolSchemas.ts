import * as z from 'zod/v4';

const SAFE_ID =
  /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[0-9a-f]{64}$/;

const safeIdSchema = z.string().regex(SAFE_ID);
const boundedStringSchema = z.string().min(1).max(128);
const revisionSchema = z.number().int().safe().nonnegative();
const positiveIntegerSchema = z.number().int().safe().positive();
const jsonRecordSchema = z.record(z.string(), z.unknown());

const pointSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
});

const clientRefSchema = z.strictObject({
  clientRef: safeIdSchema,
});

const entityRefSchema = z.union([safeIdSchema, clientRefSchema]);

const endpointSchema = z.strictObject({
  nodeId: entityRefSchema,
  socket: safeIdSchema,
});

const layerNameSchema = z.string().min(1).refine(
  (value) => [...value].length <= 128,
  'Layer name may contain at most 128 Unicode code points.',
).meta({ maxLength: 128 });

const layerPatchSchema = z.strictObject({
  name: layerNameSchema.optional(),
  visible: z.boolean().optional(),
  opacity: z.number().finite().min(0).max(1).optional(),
  blendMode: boundedStringSchema.optional(),
});

export const commandSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('set_frame'),
    width: z.number().int().safe().min(16).max(4096),
    height: z.number().int().safe().min(16).max(4096),
  }),
  z.strictObject({
    op: z.literal('add_layer'),
    clientRef: safeIdSchema,
    name: layerNameSchema.optional(),
    afterLayerId: entityRefSchema.optional(),
  }),
  z.strictObject({
    op: z.literal('update_layer'),
    layerId: entityRefSchema,
    patch: layerPatchSchema,
  }),
  z.strictObject({
    op: z.literal('move_layer'),
    layerId: entityRefSchema,
    index: revisionSchema,
  }),
  z.strictObject({
    op: z.literal('remove_layer'),
    layerId: entityRefSchema,
  }),
  z.strictObject({
    op: z.literal('add_node'),
    layerId: entityRefSchema,
    clientRef: safeIdSchema,
    nodeType: safeIdSchema,
    params: jsonRecordSchema.optional(),
    position: pointSchema.optional(),
  }),
  z.strictObject({
    op: z.literal('set_node_params'),
    layerId: entityRefSchema,
    nodeId: entityRefSchema,
    patch: jsonRecordSchema,
  }),
  z.strictObject({
    op: z.literal('move_nodes'),
    layerId: entityRefSchema,
    positions: z.array(z.strictObject({
      nodeId: entityRefSchema,
      position: pointSchema,
    })).min(1).max(200),
  }),
  z.strictObject({
    op: z.literal('remove_nodes'),
    layerId: entityRefSchema,
    nodeIds: z.array(entityRefSchema).min(1).max(200),
  }),
  z.strictObject({
    op: z.literal('connect'),
    layerId: entityRefSchema,
    from: endpointSchema,
    to: endpointSchema,
    replaceExisting: z.boolean().optional(),
  }),
  z.strictObject({
    op: z.literal('disconnect'),
    layerId: entityRefSchema,
    to: endpointSchema,
  }),
  z.strictObject({
    op: z.literal('auto_layout_graph'),
    layerId: entityRefSchema,
    direction: z.enum(['LR', 'TB']).optional(),
  }),
]);

export const getCapabilitiesInputSchema = z.strictObject({
  nodeTypes: z.array(boundedStringSchema).max(64).optional(),
  include: z.array(z.enum(['sockets', 'params', 'traits'])).max(3).optional(),
});

export const getDocumentInputSchema = z.strictObject({
  revision: revisionSchema.optional(),
  layerIds: z.array(boundedStringSchema).max(32).optional(),
  include: z.array(
    z.enum(['frame', 'layers', 'nodes', 'edges', 'positions']),
  ).max(5).optional(),
  compact: z.boolean().optional(),
});

export const getRenderStatusInputSchema = z.strictObject({
  revision: revisionSchema.optional(),
  attempt: positiveIntegerSchema.optional(),
  includeEvents: z.boolean().optional(),
});

export const validateDocumentInputSchema = z.strictObject({
  source: z.enum(['current', 'project']),
  project: z.unknown().optional(),
  mode: z.enum(['structural', 'editable', 'renderable']).optional(),
  maxFindings: z.number().int().safe().min(1).max(256).optional(),
});

export const applyTransactionInputSchema = z.strictObject({
  requestId: safeIdSchema,
  expectedRevision: revisionSchema,
  commands: z.array(commandSchema).min(1).max(100),
  dryRun: z.boolean().optional(),
});

export const awaitRenderInputSchema = z.strictObject({
  revision: revisionSchema,
  attempt: positiveIntegerSchema.optional(),
  timeoutMs: z.number().int().safe().min(1).max(30_000).optional(),
});

export const capturePreviewInputSchema = z.strictObject({
  revision: revisionSchema,
  attempt: positiveIntegerSchema.optional(),
  maxWidth: z.number().int().safe().min(1).max(1024).optional(),
  maxHeight: z.number().int().safe().min(1).max(1024).optional(),
  format: z.enum(['png', 'webp']).optional(),
  includeMetrics: z.boolean().optional(),
});

export const revertTransactionInputSchema = z.strictObject({
  requestId: safeIdSchema,
  expectedRevision: revisionSchema,
  transactionId: safeIdSchema,
});

export const publicErrorSchema = z.strictObject({
  code: z.string().min(1).max(128),
  message: z.string().max(2_048),
  recoverable: z.boolean(),
  path: z.string().max(1_024).optional(),
  commandIndex: revisionSchema.optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  suggestedFix: z.string().max(2_048).optional(),
});

export const toolOutcomeSchema = z.strictObject({
  outcome: z.discriminatedUnion('ok', [
    z.strictObject({
      ok: z.literal(true),
      value: z.unknown(),
    }),
    z.strictObject({
      ok: z.literal(false),
      revision: revisionSchema,
      requestId: safeIdSchema.optional(),
      error: publicErrorSchema,
    }),
  ]),
});

export const previewImageMetadataSchema = z.strictObject({
  kind: z.literal('mcp-image-content-v1'),
  mimeType: z.enum(['image/png', 'image/webp']),
  byteLength: positiveIntegerSchema.max(4 * 1024 * 1024),
  contentHash: z.string().regex(HASH),
  trust: z.literal('untrusted-document-render'),
});

const jsonObjectSchema = z.record(z.string(), z.unknown());
const publicNodeCapabilitySchema = z.strictObject({
  type: z.string(),
  label: z.string(),
  category: z.string(),
  description: z.string().optional(),
  inputs: z.array(z.unknown()).optional(),
  outputs: z.array(z.unknown()).optional(),
  params: z.array(z.unknown()).optional(),
  traits: jsonObjectSchema.optional(),
  execution: jsonObjectSchema.optional(),
});

export const capabilitySnapshotSchema = z.strictObject({
  protocolVersion: z.literal('1.0'),
  documentSchemaVersions: z.array(revisionSchema),
  socketTypes: z.array(z.string()),
  nodes: z.array(publicNodeCapabilitySchema),
  limits: z.record(z.string(), positiveIntegerSchema),
  features: z.strictObject({
    transactions: z.boolean(),
    dryRun: z.boolean(),
    previews: z.boolean(),
    assets: z.boolean(),
    mcp: z.boolean(),
  }),
  preview: jsonObjectSchema,
  transport: jsonObjectSchema.optional(),
  scopeAvailability: z.strictObject({
    read: z.strictObject({
      available: z.boolean(),
      reason: z.string().optional(),
    }),
    preview: z.strictObject({
      available: z.boolean(),
      reason: z.string().optional(),
    }),
    edit: z.strictObject({
      available: z.boolean(),
      reason: z.string().optional(),
    }),
    assets: z.strictObject({
      available: z.boolean(),
      reason: z.string().optional(),
    }),
    model: z.strictObject({
      available: z.boolean(),
      reason: z.string().optional(),
    }),
    export: z.strictObject({
      available: z.boolean(),
      reason: z.string().optional(),
    }),
  }),
  omitted: z.array(z.string()),
});

export const documentSnapshotSchema = z.strictObject({
  protocolVersion: z.literal('1.0'),
  schemaVersion: z.literal(3),
  revision: revisionSchema,
  documentId: safeIdSchema,
  trust: z.literal('untrusted-document-content'),
  frame: z.strictObject({
    width: positiveIntegerSchema,
    height: positiveIntegerSchema,
  }).optional(),
  layers: z.array(z.unknown()).optional(),
  omitted: z.array(z.string()),
  redactions: z.array(z.strictObject({
    path: z.string(),
    kind: z.literal('embedded-image-data'),
    mimeType: z.string(),
    encodedCharacters: revisionSchema,
    sha256: z.string().regex(HASH),
  })),
});

export const renderStatusSchema = z.strictObject({
  documentRevision: revisionSchema,
  ticket: z.strictObject({
    revision: revisionSchema,
    attempt: positiveIntegerSchema,
  }).nullable(),
  displayedTicket: z.strictObject({
    revision: revisionSchema,
    attempt: positiveIntegerSchema,
  }).nullable(),
  displayedRevision: revisionSchema.nullable(),
  requestedRevision: revisionSchema.nullable(),
  renderRevision: revisionSchema.nullable(),
  state: z.enum([
    'idle',
    'queued',
    'cooking',
    'complete',
    'failed',
    'superseded',
  ]),
  queuedAt: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  width: positiveIntegerSchema.optional(),
  height: positiveIntegerSchema.optional(),
  error: jsonObjectSchema.optional(),
  events: z.array(z.unknown()).optional(),
  omitted: z.array(z.string()),
});

const validationFindingSchema = z.strictObject({
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  message: z.string(),
  path: z.string(),
  recoverable: z.boolean(),
  details: jsonObjectSchema.optional(),
  suggestedFix: z.string().optional(),
});

export const validationReportSchema = z.strictObject({
  trust: z.literal('untrusted-document-content'),
  report: z.strictObject({
    valid: z.boolean(),
    mode: z.enum(['structural', 'editable', 'renderable']),
    schemaVersion: revisionSchema.nullable(),
    errors: z.array(validationFindingSchema),
    warnings: z.array(validationFindingSchema),
    truncated: z.boolean().optional(),
  }),
});

export const transactionSuccessSchema = z.strictObject({
  ok: z.literal(true),
  requestId: safeIdSchema,
  dryRun: z.boolean(),
  committed: z.boolean(),
  transactionId: safeIdSchema.nullable(),
  previousRevision: revisionSchema,
  revision: revisionSchema,
  proposedRevision: revisionSchema,
  created: z.record(z.string(), safeIdSchema),
  createdEntities: z.record(z.string(), z.strictObject({
    kind: z.enum(['layer', 'node']),
    id: safeIdSchema,
    layerId: safeIdSchema.optional(),
  })),
  changed: z.strictObject({
    frame: z.boolean(),
    layerIds: z.array(safeIdSchema),
    nodes: z.array(z.strictObject({
      layerId: safeIdSchema,
      nodeId: safeIdSchema,
    })),
    edgeCountDelta: z.number().int().safe(),
    replacedEdges: z.array(z.unknown()),
  }),
  warnings: z.array(validationFindingSchema),
});

const previewMetricsSchema = z.strictObject({
  version: z.literal('preview-metrics-v1'),
  alphaCoverage: z.number().finite().min(0).max(1),
  nonBackgroundBounds: z.strictObject({
    x: revisionSchema,
    y: revisionSchema,
    width: positiveIntegerSchema,
    height: positiveIntegerSchema,
  }).nullable(),
  luminance: z.strictObject({
    min: z.number().finite(),
    max: z.number().finite(),
    mean: z.number().finite(),
  }),
  perceptualHash: z.string().regex(/^[0-9a-f]{16}$/),
  background: z.strictObject({
    premultipliedRgba: z.tuple([
      revisionSchema.max(255),
      revisionSchema.max(255),
      revisionSchema.max(255),
      revisionSchema.max(255),
    ]),
    confidence: z.number().finite().min(0).max(1),
  }).nullable(),
});

export const previewMetadataSchema = z.strictObject({
  trust: z.literal('untrusted-document-render'),
  requestedRevision: revisionSchema,
  revision: revisionSchema,
  attempt: positiveIntegerSchema,
  sourceWidth: positiveIntegerSchema,
  sourceHeight: positiveIntegerSchema,
  width: positiveIntegerSchema,
  height: positiveIntegerSchema,
  mimeType: z.enum(['image/png', 'image/webp']),
  byteLength: positiveIntegerSchema.max(4 * 1024 * 1024),
  contentHash: z.string().regex(HASH),
  rgbaSha256: z.string().regex(HASH),
  capturePolicy: z.literal('current-exact-ticket-v1'),
  image: previewImageMetadataSchema,
  metrics: previewMetricsSchema.optional(),
});

export function outputEnvelopeSchema<Success extends z.ZodType>(
  success: Success,
) {
  return z.strictObject({
    outcome: z.discriminatedUnion('ok', [
      z.strictObject({
        ok: z.literal(true),
        value: success,
      }),
      z.strictObject({
        ok: z.literal(false),
        revision: revisionSchema,
        requestId: safeIdSchema.optional(),
        error: publicErrorSchema,
      }),
    ]),
  });
}

export const getCapabilitiesOutputSchema =
  outputEnvelopeSchema(capabilitySnapshotSchema);
export const getDocumentOutputSchema =
  outputEnvelopeSchema(documentSnapshotSchema);
export const getRenderStatusOutputSchema =
  outputEnvelopeSchema(renderStatusSchema);
export const validateDocumentOutputSchema =
  outputEnvelopeSchema(validationReportSchema);
export const applyTransactionOutputSchema =
  outputEnvelopeSchema(transactionSuccessSchema);
export const awaitRenderOutputSchema =
  outputEnvelopeSchema(renderStatusSchema);
export const capturePreviewOutputSchema =
  outputEnvelopeSchema(previewMetadataSchema);
export const revertTransactionOutputSchema =
  outputEnvelopeSchema(transactionSuccessSchema);

export type ToolOutputEnvelope = {
  outcome:
    | { ok: true; value: unknown }
    | {
        ok: false;
        revision: number;
        requestId?: string;
        error: z.output<typeof publicErrorSchema>;
      };
};

export const TOOL_INPUT_SCHEMAS = Object.freeze({
  getCapabilities: getCapabilitiesInputSchema,
  getDocument: getDocumentInputSchema,
  getRenderStatus: getRenderStatusInputSchema,
  validateDocument: validateDocumentInputSchema,
  applyTransaction: applyTransactionInputSchema,
  awaitRender: awaitRenderInputSchema,
  capturePreview: capturePreviewInputSchema,
  revertTransaction: revertTransactionInputSchema,
});
