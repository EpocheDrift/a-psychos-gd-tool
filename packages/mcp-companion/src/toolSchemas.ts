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
    clientRef: safeIdSchema.describe(
      'Client reference for the created layer. It does not name the layer\'s automatic Output node.',
    ),
    name: layerNameSchema.optional(),
    afterLayerId: entityRefSchema.optional(),
  }).describe(
    'Create a layer with exactly one automatic transparent Output node whose node ID is "out". Reuse node ID "out" as the final connection target; do not add another Output node.',
  ),
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

const renderedNodeMeasurementTargetInputSchema = z.strictObject({
  layerId: safeIdSchema,
  nodeId: safeIdSchema,
  outputSocket: safeIdSchema.optional(),
});

export const measureRenderedNodesInputSchema = z.strictObject({
  revision: revisionSchema,
  attempt: positiveIntegerSchema,
  targets: z.array(renderedNodeMeasurementTargetInputSchema)
    .min(1)
    .max(32)
    .superRefine((targets, context) => {
      const seen = new Set<string>();
      targets.forEach((target, index) => {
        const key = [
          target.layerId,
          target.nodeId,
          target.outputSocket ?? 'out',
        ].join('\u0000');
        if (seen.has(key)) {
          context.addIssue({
            code: 'custom',
            message:
              'Rendered node measurement targets must be unique.',
            path: [index],
          });
        }
        seen.add(key);
      });
    }),
});

export const revertTransactionInputSchema = z.strictObject({
  requestId: safeIdSchema,
  expectedRevision: revisionSchema,
  transactionId: safeIdSchema,
});

const uploadIdSchema = z.string().regex(/^upload_[A-Za-z0-9_-]{22}$/);
const assetIdSchema = z.string().regex(/^asset_[0-9a-f]{64}$/);
const canonicalBase64Schema = z.string()
  .min(4)
  .max(1_398_104)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/)
  .refine((value) => {
    if (value.length % 4 !== 0) return false;
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    if (value.endsWith('==')) {
      return (alphabet.indexOf(value[value.length - 3]!) & 0x0f) === 0;
    }
    if (value.endsWith('=')) {
      return (alphabet.indexOf(value[value.length - 2]!) & 0x03) === 0;
    }
    return true;
  }, 'Base64 must use canonical padding bits.');

export const putAssetInputSchema = z.discriminatedUnion('phase', [
  z.strictObject({
    phase: z.literal('begin'),
    requestId: safeIdSchema,
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    byteLength: positiveIntegerSchema.max(20 * 1024 * 1024),
    sha256: z.string().regex(HASH),
  }),
  z.strictObject({
    phase: z.literal('chunk'),
    requestId: safeIdSchema,
    uploadId: uploadIdSchema,
    offset: revisionSchema.max(20 * 1024 * 1024),
    dataBase64: canonicalBase64Schema,
    chunkSha256: z.string().regex(HASH),
  }),
  z.strictObject({
    phase: z.literal('status'),
    uploadId: uploadIdSchema,
  }),
  z.strictObject({
    phase: z.literal('finalize'),
    requestId: safeIdSchema,
    uploadId: uploadIdSchema,
    expectedRevision: revisionSchema,
  }),
  z.strictObject({
    phase: z.literal('abort'),
    requestId: safeIdSchema,
    uploadId: uploadIdSchema,
  }),
]);

export const listAssetsInputSchema = z.strictObject({
  cursor: z.string().max(64).regex(/^r\d+_o\d+$/).optional(),
  limit: positiveIntegerSchema.max(64).optional(),
});

export const getAssetMetadataInputSchema = z.strictObject({
  assetId: assetIdSchema,
});

export const removeAssetInputSchema = z.strictObject({
  requestId: safeIdSchema,
  expectedRevision: revisionSchema,
  assetId: assetIdSchema,
});

export const getModelStatusInputSchema = z.strictObject({});

export const prepareModelInputSchema = z.strictObject({
  requestId: safeIdSchema,
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
const renderedNodeMeasurementCapabilitySchema = z.strictObject({
  contractVersion: z.literal('rendered-node-measurement-v1'),
  measurementPolicy: z.literal('current-exact-ticket-v1'),
  measurementStage: z.literal('target-output-before-downstream-v1'),
  visibilityPolicy: z.literal('frame-clip-only-no-occlusion-v1'),
  coordinateSpace: z.literal('frame-pixels-top-left-v1'),
  workPolicy: z.literal('bounded-fail-soft-v1'),
  limits: z.strictObject({
    maxVectorPaths: z.literal(25_000),
    maxVectorCommands: z.literal(50_000),
    maxCanvasPaintPaths: z.literal(5_000),
    maxCanvasPaintCommands: z.literal(25_000),
    maxFlattenedPoints: z.literal(250_000),
    maxBooleanPoints: z.literal(2_500),
    maxGeometryWorkUnits: z.literal(250_000),
    maxRenderableGlyphs: z.literal(4_096),
    maxGeneratedItems: z.literal(25_000),
  }),
  maxTargets: z.literal(32),
  exactAttemptRequired: z.literal(true),
  supportedValueKinds: z.tuple([
    z.literal('text'),
    z.literal('vector'),
    z.literal('elements'),
  ]),
});
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
    renderedNodeMeasurements: z.boolean(),
    assets: z.boolean(),
    mcp: z.boolean(),
  }),
  preview: jsonObjectSchema,
  measurement: renderedNodeMeasurementCapabilitySchema,
  permissions: z.strictObject({
    localFonts: z.strictObject({
      agentAvailable: z.literal(false),
      requiresHumanGesture: z.literal(true),
      familyEnumeration: z.literal('disabled'),
    }),
  }),
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
  schemaVersion: z.literal(4),
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

const transactionSuccessCommonShape = {
  ok: z.literal(true),
  requestId: safeIdSchema,
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
    assetIds: z.array(safeIdSchema),
    nodes: z.array(z.strictObject({
      layerId: safeIdSchema,
      nodeId: safeIdSchema,
    })),
    edgeCountDelta: z.number().int().safe(),
    replacedEdges: z.array(z.unknown()),
  }),
  warnings: z.array(validationFindingSchema),
};

const committedTransactionRenderStatusSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.enum([
      'idle',
      'queued',
      'cooking',
      'complete',
      'failed',
      'superseded',
    ]),
    ticket: z.strictObject({
      revision: revisionSchema,
      attempt: positiveIntegerSchema,
    }).nullable(),
  }),
  z.strictObject({
    state: z.literal('unavailable'),
    ticket: z.null(),
  }),
]);

const committedTransactionSuccessSchema = z.strictObject({
  ...transactionSuccessCommonShape,
  dryRun: z.literal(false),
  committed: z.literal(true),
  transactionId: safeIdSchema,
  persistenceStatus: z.enum(['durable', 'memory-only']),
  renderStatus: committedTransactionRenderStatusSchema,
});

const uncommittedTransactionSuccessSchema = z.strictObject({
  ...transactionSuccessCommonShape,
  dryRun: z.boolean(),
  committed: z.literal(false),
  transactionId: z.null(),
  persistenceStatus: z.literal('not-applicable'),
  renderStatus: z.strictObject({
    state: z.literal('not-applicable'),
    ticket: z.null(),
  }),
});

export const transactionSuccessSchema = z.discriminatedUnion('committed', [
  committedTransactionSuccessSchema,
  uncommittedTransactionSuccessSchema,
]).superRefine((value, context) => {
  if (
    value.committed
    && value.renderStatus.ticket
    && value.renderStatus.ticket.revision !== value.revision
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Render ticket revision must match the committed transaction.',
      path: ['renderStatus', 'ticket', 'revision'],
    });
  }
  if (
    value.committed
    && (
      value.previousRevision + 1 !== value.revision
      || value.proposedRevision !== value.revision
    )
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Committed transaction revisions are inconsistent.',
      path: ['revision'],
    });
  }
  if (
    !value.committed
    && !value.dryRun
    && (
      value.previousRevision !== value.revision
      || value.proposedRevision !== value.revision
    )
  ) {
    context.addIssue({
      code: 'custom',
      message: 'No-op transaction revisions are inconsistent.',
      path: ['revision'],
    });
  }
});

const assetMetadataSchema = z.strictObject({
  id: assetIdSchema,
  sha256: z.string().regex(HASH),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  byteLength: positiveIntegerSchema.max(20 * 1024 * 1024),
  width: positiveIntegerSchema.max(8192),
  height: positiveIntegerSchema.max(8192),
  source: z.enum(['upload', 'generated', 'bundled']),
});

const assetUploadStatusSchema = z.strictObject({
  uploadId: uploadIdSchema,
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  byteLength: positiveIntegerSchema.max(20 * 1024 * 1024),
  receivedBytes: revisionSchema.max(20 * 1024 * 1024),
  nextOffset: revisionSchema.max(20 * 1024 * 1024),
  chunkBytes: positiveIntegerSchema.max(1024 * 1024),
  idleExpiresAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  complete: z.boolean(),
});

const publicAssetMetadataSchema = z.strictObject({
  metadata: assetMetadataSchema,
  referenceCount: revisionSchema.max(1024),
  references: z.array(z.strictObject({
    layerId: safeIdSchema,
    nodeId: safeIdSchema,
  })).max(1024),
  availability: z.enum(['available', 'bundled', 'missing']),
});

const publicTransactionRenderStatusSchema = z.union([
  committedTransactionRenderStatusSchema,
  z.strictObject({
    state: z.literal('not-applicable'),
    ticket: z.null(),
  }),
]);

const finalizedAssetResultSchema = z.strictObject({
  phase: z.literal('finalize'),
  revision: revisionSchema,
  asset: assetMetadataSchema,
  /** CAS deduplication is independent from whether the manifest committed. */
  deduplicated: z.boolean(),
  persistenceStatus: z.enum([
    'durable',
    'memory-only',
    'not-applicable',
  ]),
  renderStatus: publicTransactionRenderStatusSchema,
  transaction: transactionSuccessSchema,
}).superRefine((value, context) => {
  if (value.revision !== value.transaction.revision) {
    context.addIssue({
      code: 'custom',
      message: 'Finalize revision must match its nested transaction.',
      path: ['revision'],
    });
  }
  if (value.persistenceStatus !== value.transaction.persistenceStatus) {
    context.addIssue({
      code: 'custom',
      message:
        'Finalize persistence status must match its nested transaction.',
      path: ['persistenceStatus'],
    });
  }
  if (value.transaction.dryRun) {
    context.addIssue({
      code: 'custom',
      message: 'Asset finalization can never be a dry run.',
      path: ['transaction', 'dryRun'],
    });
  }
  if (
    value.renderStatus.ticket
    && value.renderStatus.ticket.revision !== value.revision
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Finalize render ticket revision must match its revision.',
      path: ['renderStatus', 'ticket', 'revision'],
    });
  }
  if (
    value.transaction.committed
    && JSON.stringify(value.renderStatus)
      !== JSON.stringify(value.transaction.renderStatus)
  ) {
    context.addIssue({
      code: 'custom',
      message:
        'Committed finalize render status must match its nested transaction.',
      path: ['renderStatus'],
    });
  }
});

const putAssetResultSchema = z.union([
  z.strictObject({
    phase: z.enum(['begin', 'chunk', 'status']),
    revision: revisionSchema,
    upload: assetUploadStatusSchema,
  }),
  z.strictObject({
    phase: z.literal('abort'),
    revision: revisionSchema,
    aborted: z.boolean(),
  }),
  finalizedAssetResultSchema,
]);

const listAssetsResultSchema = z.strictObject({
  trust: z.literal('untrusted-asset-metadata'),
  revision: revisionSchema,
  assets: z.array(publicAssetMetadataSchema).max(64),
  nextCursor: z.string().max(64).regex(/^r\d+_o\d+$/).optional(),
});

export const publicModelStatusSchema = z.strictObject({
  schemaVersion: z.literal(1),
  modelKey: z.literal('rmbg-1.4'),
  revision: z.string().regex(/^[0-9a-f]{40}$/),
  manifestSha256: z.string().regex(HASH),
  state: z.enum([
    'not-installed',
    'approval-required',
    'downloading',
    'verifying',
    'ready',
    'failed',
  ]),
  bytes: revisionSchema.max(1024 * 1024 * 1024),
  totalBytes: positiveIntegerSchema.max(1024 * 1024 * 1024),
  artifacts: z.array(z.strictObject({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    state: z.enum([
      'missing',
      'downloading',
      'verifying',
      'ready',
      'invalid',
    ]),
    bytes: revisionSchema.max(1024 * 1024 * 1024),
    totalBytes: positiveIntegerSchema.max(1024 * 1024 * 1024),
  })).min(1).max(16),
  license: z.strictObject({
    id: z.literal('bria-rmbg-1.4'),
    name: z.string().min(1).max(128),
    summary: z.string().min(1).max(1_024),
    commercialUse: z.literal('separate-agreement-required'),
    requiresExplicitApproval: z.literal(true),
  }),
  error: z.strictObject({
    code: z.string().min(1).max(128),
    recoverable: z.boolean(),
  }).optional(),
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

const MAX_RENDERED_NODE_BOUND = 1_000_000_000;

const renderedNodeRectSchema = z.strictObject({
  x: z.number().finite()
    .min(-MAX_RENDERED_NODE_BOUND)
    .max(MAX_RENDERED_NODE_BOUND),
  y: z.number().finite()
    .min(-MAX_RENDERED_NODE_BOUND)
    .max(MAX_RENDERED_NODE_BOUND),
  width: z.number().finite().positive().max(MAX_RENDERED_NODE_BOUND),
  height: z.number().finite().positive().max(MAX_RENDERED_NODE_BOUND),
}).superRefine((rect, context) => {
  if (Math.abs(rect.x + rect.width) > MAX_RENDERED_NODE_BOUND) {
    context.addIssue({
      code: 'custom',
      message: 'Rendered node bounds exceed the supported x range.',
      path: ['width'],
    });
  }
  if (Math.abs(rect.y + rect.height) > MAX_RENDERED_NODE_BOUND) {
    context.addIssue({
      code: 'custom',
      message: 'Rendered node bounds exceed the supported y range.',
      path: ['height'],
    });
  }
});

const renderedNodeMeasurementTargetSchema = z.strictObject({
  layerId: safeIdSchema,
  nodeId: safeIdSchema,
  outputSocket: safeIdSchema,
});

const renderedNodeMeasurementBase = {
  target: renderedNodeMeasurementTargetSchema,
  nodeType: safeIdSchema,
  valueKind: z.enum([
    'text',
    'vector',
    'raster',
    'alpha',
    'elements',
    'layout',
  ]),
};

const renderedNodeClippingSchema = z.strictObject({
  state: z.enum(['inside', 'partial', 'outside']),
  sides: z.array(z.enum(['left', 'top', 'right', 'bottom']))
    .max(4)
    .refine(
      (sides) => new Set(sides).size === sides.length,
      'Clipped sides must be unique.',
    ),
  overflowPx: z.strictObject({
    left: z.number().finite().nonnegative().max(MAX_RENDERED_NODE_BOUND),
    top: z.number().finite().nonnegative().max(MAX_RENDERED_NODE_BOUND),
    right: z.number().finite().nonnegative().max(MAX_RENDERED_NODE_BOUND),
    bottom: z.number().finite().nonnegative().max(MAX_RENDERED_NODE_BOUND),
  }),
});

export const renderedNodeMeasurementSchema = z.discriminatedUnion(
  'status',
  [
    z.strictObject({
      ...renderedNodeMeasurementBase,
      status: z.literal('measured'),
      basis: z.literal('conservative-painted-geometry-aabb-v1'),
      unclippedBounds: renderedNodeRectSchema,
      visibleBounds: renderedNodeRectSchema.nullable(),
      clipping: renderedNodeClippingSchema,
    }).superRefine((measurement, context) => {
      const hasOverflow = Object.values(
        measurement.clipping.overflowPx,
      ).some((value) => value > 0);
      const sidesMatchOverflow = (
        ['left', 'top', 'right', 'bottom'] as const
      ).every((side) =>
        measurement.clipping.sides.includes(side)
          === (measurement.clipping.overflowPx[side] > 0));
      if (!sidesMatchOverflow) {
        context.addIssue({
          code: 'custom',
          message: 'Clipped sides and overflow values must agree.',
          path: ['clipping', 'sides'],
        });
      }
      if (
        measurement.clipping.state === 'inside'
        && (hasOverflow || measurement.visibleBounds === null)
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Inside measurements must be visible with no overflow.',
          path: ['clipping', 'state'],
        });
      }
      if (
        measurement.clipping.state === 'partial'
        && (!hasOverflow || measurement.visibleBounds === null)
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Partially clipped measurements require overflow and visible bounds.',
          path: ['clipping', 'state'],
        });
      }
      if (
        measurement.clipping.state === 'outside'
        && (!hasOverflow || measurement.visibleBounds !== null)
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Outside measurements require overflow and no visible bounds.',
          path: ['clipping', 'state'],
        });
      }
    }),
    z.strictObject({
      ...renderedNodeMeasurementBase,
      status: z.literal('empty'),
      reason: z.literal('no-painted-geometry'),
    }),
    z.strictObject({
      ...renderedNodeMeasurementBase,
      status: z.literal('not-rendered'),
      reason: z.enum(['hidden-layer', 'disconnected-from-output']),
    }),
    z.strictObject({
      ...renderedNodeMeasurementBase,
      status: z.literal('not-visual'),
      reason: z.enum(['layout-output', 'alpha-output']),
    }),
    z.strictObject({
      ...renderedNodeMeasurementBase,
      status: z.literal('unavailable'),
      reason: z.enum([
        'raster-clipping-already-baked',
        'raster-backed-elements',
        'bounds-limit-exceeded',
        'unsupported-value-kind',
      ]),
    }),
  ],
);

export const renderedNodeMeasurementResultSchema = z.strictObject({
  contractVersion: z.literal('rendered-node-measurement-v1'),
  measurementPolicy: z.literal('current-exact-ticket-v1'),
  measurementStage: z.literal('target-output-before-downstream-v1'),
  visibilityPolicy: z.literal('frame-clip-only-no-occlusion-v1'),
  revision: revisionSchema,
  attempt: positiveIntegerSchema,
  frame: z.strictObject({
    width: z.number().int().safe().min(16).max(4096),
    height: z.number().int().safe().min(16).max(4096),
  }),
  coordinateSpace: z.strictObject({
    kind: z.literal('frame-pixels-top-left-v1'),
    units: z.literal('px'),
    xAxis: z.literal('right'),
    yAxis: z.literal('down'),
  }),
  measurements: z.array(renderedNodeMeasurementSchema)
    .min(1)
    .max(32)
    .superRefine((measurements, context) => {
      const seen = new Set<string>();
      measurements.forEach((measurement, index) => {
        const key = [
          measurement.target.layerId,
          measurement.target.nodeId,
          measurement.target.outputSocket,
        ].join('\u0000');
        if (seen.has(key)) {
          context.addIssue({
            code: 'custom',
            message:
              'Rendered node measurements must have unique targets.',
            path: [index, 'target'],
          });
        }
        seen.add(key);
      });
    }),
  trust: z.literal('untrusted-document-render'),
  requestedRevision: revisionSchema,
}).superRefine((result, context) => {
  if (result.requestedRevision !== result.revision) {
    context.addIssue({
      code: 'custom',
      message:
        'Requested and measured render revisions must match.',
      path: ['requestedRevision'],
    });
  }
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
export const measureRenderedNodesOutputSchema =
  outputEnvelopeSchema(renderedNodeMeasurementResultSchema);
export const revertTransactionOutputSchema =
  outputEnvelopeSchema(transactionSuccessSchema);
export const putAssetOutputSchema =
  outputEnvelopeSchema(putAssetResultSchema);
export const listAssetsOutputSchema =
  outputEnvelopeSchema(listAssetsResultSchema);
export const getAssetMetadataOutputSchema =
  outputEnvelopeSchema(publicAssetMetadataSchema);
export const removeAssetOutputSchema =
  outputEnvelopeSchema(transactionSuccessSchema);
export const getModelStatusOutputSchema =
  outputEnvelopeSchema(publicModelStatusSchema);
export const prepareModelOutputSchema =
  outputEnvelopeSchema(publicModelStatusSchema);

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
  measureRenderedNodes: measureRenderedNodesInputSchema,
  revertTransaction: revertTransactionInputSchema,
  putAsset: putAssetInputSchema,
  listAssets: listAssetsInputSchema,
  getAssetMetadata: getAssetMetadataInputSchema,
  removeAsset: removeAssetInputSchema,
  getModelStatus: getModelStatusInputSchema,
  prepareModel: prepareModelInputSchema,
});
