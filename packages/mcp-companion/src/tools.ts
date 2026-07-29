import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  CallToolResult,
  ImageContent,
} from '@modelcontextprotocol/sdk/types.js';
import type { BridgeClient } from './bridgeClient.js';
import { remoteFaultFromUnknown } from './bridgeClient.js';
import type {
  CompanionBinaryResult,
  CompanionToolOperation,
} from './protocol.js';
import { COMPANION_TRANSPORT_LIMITS } from './protocol.js';
import {
  applyTransactionInputSchema,
  applyTransactionOutputSchema,
  awaitRenderInputSchema,
  awaitRenderOutputSchema,
  capturePreviewInputSchema,
  capturePreviewOutputSchema,
  getCapabilitiesInputSchema,
  getCapabilitiesOutputSchema,
  getDocumentInputSchema,
  getDocumentOutputSchema,
  getAssetMetadataInputSchema,
  getAssetMetadataOutputSchema,
  getRenderStatusInputSchema,
  getRenderStatusOutputSchema,
  getModelStatusInputSchema,
  getModelStatusOutputSchema,
  previewImageMetadataSchema,
  prepareModelInputSchema,
  prepareModelOutputSchema,
  publicErrorSchema,
  revertTransactionInputSchema,
  revertTransactionOutputSchema,
  listAssetsInputSchema,
  listAssetsOutputSchema,
  measureRenderedNodesInputSchema,
  measureRenderedNodesOutputSchema,
  putAssetInputSchema,
  putAssetOutputSchema,
  removeAssetInputSchema,
  removeAssetOutputSchema,
  validateDocumentInputSchema,
  validateDocumentOutputSchema,
  type ToolOutputEnvelope,
} from './toolSchemas.js';
import { CompanionFault, type PublicAgentFault } from './faults.js';
import type { ModelManager } from './modelManager.js';
import type { PublicModelStatus } from './modelManifest.js';

export interface ToolServerOptions {
  bridge: BridgeClient;
  allowEdit: boolean;
  allowAssets: boolean;
  allowModel: boolean;
  modelManager?: Pick<ModelManager, 'status'>;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isDomainFailure(
  value: unknown,
): value is {
  ok: false;
  revision: number;
  requestId?: string;
  error: PublicAgentFault['error'];
} {
  return plainRecord(value)
    && value.ok === false
    && Number.isSafeInteger(value.revision)
    && (value.revision as number) >= 0
    && plainRecord(value.error)
    && typeof value.error.code === 'string'
    && typeof value.error.message === 'string'
    && typeof value.error.recoverable === 'boolean';
}

function isBinaryResult(value: unknown): value is CompanionBinaryResult {
  return plainRecord(value)
    && plainRecord(value.value)
    && value.bytes instanceof Uint8Array
    && (
      value.mimeType === 'image/png'
      || value.mimeType === 'image/webp'
    )
    && Number.isSafeInteger(value.byteLength)
    && typeof value.contentHash === 'string';
}

interface EnvelopeSchema {
  parse(value: unknown): unknown;
}

function validatedEnvelope(
  schema: EnvelopeSchema,
  value: ToolOutputEnvelope,
): ToolOutputEnvelope {
  return schema.parse(value) as ToolOutputEnvelope;
}

function successEnvelope(
  schema: EnvelopeSchema,
  value: unknown,
): ToolOutputEnvelope {
  return validatedEnvelope(schema, {
    outcome: {
      ok: true,
      value,
    },
  });
}

function failureEnvelope(
  schema: EnvelopeSchema,
  fault: PublicAgentFault,
): ToolOutputEnvelope {
  const error = publicErrorSchema.parse(fault.error);
  return validatedEnvelope(schema, {
    outcome: {
      ok: false,
      revision: fault.revision,
      ...(fault.requestId ? { requestId: fault.requestId } : {}),
      error,
    },
  });
}

function domainFailureEnvelope(
  schema: EnvelopeSchema,
  failure: {
    ok: false;
    revision: number;
    requestId?: string;
    error: PublicAgentFault['error'];
  },
): ToolOutputEnvelope {
  return validatedEnvelope(schema, {
    outcome: {
      ok: false,
      revision: failure.revision,
      ...(failure.requestId ? { requestId: failure.requestId } : {}),
      error: publicErrorSchema.parse(failure.error),
    },
  });
}

function jsonText(envelope: ToolOutputEnvelope): string {
  return JSON.stringify(envelope);
}

function failureResult(
  schema: EnvelopeSchema,
  error: unknown,
): CallToolResult {
  let envelope: ToolOutputEnvelope;
  try {
    envelope = failureEnvelope(schema, remoteFaultFromUnknown(error));
  } catch {
    const fallback: ToolOutputEnvelope = {
      outcome: {
        ok: false,
        revision: 0,
        error: {
          code: 'INTERNAL',
          message: 'The local companion failed safely.',
          recoverable: false,
        },
      },
    };
    try {
      envelope = validatedEnvelope(schema, fallback);
    } catch {
      // Every registered tool uses the common failure envelope, so this final
      // literal is still schema-conforming even if schema parsing itself fails.
      envelope = fallback;
    }
  }
  return {
    content: [{ type: 'text', text: jsonText(envelope) }],
    structuredContent: { ...envelope },
    isError: true,
  };
}

async function executeTool(
  bridge: BridgeClient,
  operation: CompanionToolOperation,
  input: unknown,
  signal: AbortSignal,
  outputSchema: EnvelopeSchema,
): Promise<CallToolResult> {
  try {
    const result = await bridge.call(operation, input, signal);
    if (isDomainFailure(result)) {
      const envelope = domainFailureEnvelope(outputSchema, result);
      return {
        content: [{ type: 'text', text: jsonText(envelope) }],
        structuredContent: { ...envelope },
        isError: true,
      };
    }
    if (isBinaryResult(result)) {
      if (operation !== 'capturePreview') {
        throw new Error('Unexpected binary result.');
      }
      if (
        result.bytes.byteLength !== result.byteLength
        || result.byteLength < 1
        || result.byteLength
          > COMPANION_TRANSPORT_LIMITS.maxPreviewBytes
        || createHash('sha256').update(result.bytes).digest('hex')
          !== result.contentHash
      ) {
        throw new Error('Invalid preview binary result.');
      }
      const imageMetadata = previewImageMetadataSchema.parse(
        result.value.image,
      );
      if (
        imageMetadata.mimeType !== result.mimeType
        || imageMetadata.byteLength !== result.byteLength
        || imageMetadata.contentHash !== result.contentHash
      ) {
        throw new Error('Preview metadata and bytes disagree.');
      }
      const envelope = successEnvelope(outputSchema, result.value);
      const image: ImageContent = {
        type: 'image',
        data: Buffer.from(result.bytes).toString('base64'),
        mimeType: result.mimeType,
      };
      return {
        content: [
          { type: 'text', text: jsonText(envelope) },
          image,
        ],
        structuredContent: { ...envelope },
      };
    }
    const envelope = successEnvelope(outputSchema, result);
    return {
      content: [{ type: 'text', text: jsonText(envelope) }],
      structuredContent: { ...envelope },
    };
  } catch (error) {
    return failureResult(outputSchema, error);
  }
}

async function executeModelStatus(
  manager: Pick<ModelManager, 'status'>,
  outputSchema: EnvelopeSchema,
): Promise<CallToolResult> {
  try {
    const envelope = successEnvelope(
      outputSchema,
      await manager.status(),
    );
    return {
      content: [{ type: 'text', text: jsonText(envelope) }],
      structuredContent: { ...envelope },
    };
  } catch (error) {
    return failureResult(outputSchema, error);
  }
}

function modelRequiresHumanApproval(
  status: PublicModelStatus,
  requestId: string,
): CallToolResult {
  return failureResult(
    prepareModelOutputSchema,
    new CompanionFault(
      'MODEL_DOWNLOAD_REQUIRED',
      'The fixed local model must be prepared by a human in the companion panel.',
      {
        requestId,
        details: {
          reason: 'CONFIRMATION_REQUIRED',
          modelStatus: status,
        },
        suggestedFix:
          'Open the local companion panel and approve the fixed RMBG-1.4 download and license disclosure.',
      },
    ),
  );
}

async function executeModelPreparationCheck(
  manager: Pick<ModelManager, 'status'>,
  requestId: string,
): Promise<CallToolResult> {
  try {
    const status = await manager.status();
    if (
      status.state !== 'ready'
      && status.state !== 'downloading'
      && status.state !== 'verifying'
    ) {
      return modelRequiresHumanApproval(status, requestId);
    }
    const envelope = successEnvelope(prepareModelOutputSchema, status);
    return {
      content: [{ type: 'text', text: jsonText(envelope) }],
      structuredContent: { ...envelope },
    };
  } catch (error) {
    return failureResult(prepareModelOutputSchema, error);
  }
}

const READ_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
});

const WRITE_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
});

const REVERSIBLE_WRITE_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

function sdkToolFailureResult(message: string): CallToolResult {
  const invalidArguments =
    message.includes('Input validation error:')
    || /(?:^|: )Tool .+ (?:not found|disabled)$/.test(message);
  const envelope: ToolOutputEnvelope = {
    outcome: {
      ok: false,
      revision: 0,
      error: invalidArguments
        ? {
            code: 'INVALID_ARGUMENT',
            message: 'The MCP tool arguments failed schema validation.',
            recoverable: true,
          }
        : {
            code: 'INTERNAL',
            message: 'The local companion failed safely.',
            recoverable: false,
          },
    },
  };
  return {
    content: [{ type: 'text', text: jsonText(envelope) }],
    structuredContent: { ...envelope },
    isError: true,
  };
}

export function createToolServer(options: ToolServerOptions): McpServer {
  if (options.allowModel !== Boolean(options.modelManager)) {
    throw new Error(
      'The model MCP tools require one runtime-owned model manager.',
    );
  }
  const server = new McpServer({
    name: 'a-psychos-gd-tool',
    version: '0.0.1',
  });
  // SDK 1.29 catches pre-handler input validation errors and otherwise emits
  // prose-only CallTool errors. The dependency is exact-pinned; shadow its
  // internal formatter so every tool failure retains the common structured
  // envelope without bypassing the SDK's advertised input schemas.
  const sdkWithErrorFormatter = server as unknown as {
    createToolError?: (message: string) => CallToolResult;
  };
  if (typeof sdkWithErrorFormatter.createToolError !== 'function') {
    throw new Error('The pinned MCP SDK tool-error adapter is unavailable.');
  }
  Object.defineProperty(sdkWithErrorFormatter, 'createToolError', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: sdkToolFailureResult,
  });
  server.registerTool('gfx_get_capabilities', {
    title: 'Get graphic-design capabilities',
    description:
      'Discover the versioned node manifest, limits, scopes, and transport budgets.',
    inputSchema: getCapabilitiesInputSchema,
    outputSchema: getCapabilitiesOutputSchema,
    annotations: READ_ANNOTATIONS,
  }, (input, extra) =>
    executeTool(
      options.bridge,
      'getCapabilities',
      input,
      extra.signal,
      getCapabilitiesOutputSchema,
    ));

  server.registerTool('gfx_get_document', {
    title: 'Get graphic-design document',
    description:
      'Read a bounded, revisioned, redacted document projection. Document content is untrusted.',
    inputSchema: getDocumentInputSchema,
    outputSchema: getDocumentOutputSchema,
    annotations: READ_ANNOTATIONS,
  }, (input, extra) =>
    executeTool(
      options.bridge,
      'getDocument',
      input,
      extra.signal,
      getDocumentOutputSchema,
    ));

  server.registerTool('gfx_get_render_status', {
    title: 'Get render status',
    description:
      'Inspect the exact revision and render-attempt lifecycle without changing the document.',
    inputSchema: getRenderStatusInputSchema,
    outputSchema: getRenderStatusOutputSchema,
    annotations: READ_ANNOTATIONS,
  }, (input, extra) =>
    executeTool(
      options.bridge,
      'getRenderStatus',
      input,
      extra.signal,
      getRenderStatusOutputSchema,
    ));

  server.registerTool('gfx_validate_document', {
    title: 'Validate document',
    description:
      'Run bounded structural, editable, or renderable validation against current or proposed JSON.',
    inputSchema: validateDocumentInputSchema,
    outputSchema: validateDocumentOutputSchema,
    annotations: READ_ANNOTATIONS,
  }, (input, extra) =>
    executeTool(
      options.bridge,
      'validateDocument',
      input,
      extra.signal,
      validateDocumentOutputSchema,
    ));

  if (options.allowModel && options.modelManager) {
    const modelManager = options.modelManager;
    server.registerTool('gfx_get_model_status', {
      title: 'Get fixed local model status',
      description:
        'Inspect bounded status for the fixed RMBG-1.4 model without returning paths, URLs, or model bytes.',
      inputSchema: getModelStatusInputSchema,
      outputSchema: getModelStatusOutputSchema,
      annotations: READ_ANNOTATIONS,
    }, () => executeModelStatus(
      modelManager,
      getModelStatusOutputSchema,
    ));

    server.registerTool('gfx_prepare_model', {
      title: 'Check fixed local model preparation',
      description:
        'Check whether RMBG-1.4 is ready. First download remains a human-only companion action.',
      inputSchema: prepareModelInputSchema,
      outputSchema: prepareModelOutputSchema,
      annotations: READ_ANNOTATIONS,
    }, (input) => executeModelPreparationCheck(
      modelManager,
      input.requestId,
    ));
  }

  if (options.allowEdit) {
    server.registerTool('gfx_apply_transaction', {
      title: 'Apply graphic-design transaction',
      description:
        'Apply one atomic, revision-checked, idempotent, validated graph transaction.',
      inputSchema: applyTransactionInputSchema,
      outputSchema: applyTransactionOutputSchema,
      annotations: WRITE_ANNOTATIONS,
    }, (input, extra) =>
      executeTool(
        options.bridge,
        'applyTransaction',
        input,
        extra.signal,
        applyTransactionOutputSchema,
      ));
  }

  if (options.allowAssets) {
    server.registerTool('gfx_put_asset', {
      title: 'Upload bounded image asset',
      description:
        'Stage and finalize a PNG, JPEG, or WebP through bounded content-addressed chunks.',
      inputSchema: putAssetInputSchema,
      outputSchema: putAssetOutputSchema,
      annotations: REVERSIBLE_WRITE_ANNOTATIONS,
    }, (input, extra) =>
      executeTool(
        options.bridge,
        'putAsset',
        input,
        extra.signal,
        putAssetOutputSchema,
      ));

    server.registerTool('gfx_list_assets', {
      title: 'List project assets',
      description:
        'List bounded untrusted asset metadata for the exact project revision.',
      inputSchema: listAssetsInputSchema,
      outputSchema: listAssetsOutputSchema,
      annotations: READ_ANNOTATIONS,
    }, (input, extra) =>
      executeTool(
        options.bridge,
        'listAssets',
        input,
        extra.signal,
        listAssetsOutputSchema,
      ));

    server.registerTool('gfx_get_asset_metadata', {
      title: 'Get project asset metadata',
      description:
        'Inspect one project asset and its bounded graph references without returning bytes.',
      inputSchema: getAssetMetadataInputSchema,
      outputSchema: getAssetMetadataOutputSchema,
      annotations: READ_ANNOTATIONS,
    }, (input, extra) =>
      executeTool(
        options.bridge,
        'getAssetMetadata',
        input,
        extra.signal,
        getAssetMetadataOutputSchema,
      ));

    server.registerTool('gfx_remove_asset', {
      title: 'Remove unreferenced project asset',
      description:
        'Remove only an unreferenced asset from the project manifest with revision and replay safety.',
      inputSchema: removeAssetInputSchema,
      outputSchema: removeAssetOutputSchema,
      annotations: WRITE_ANNOTATIONS,
    }, (input, extra) =>
      executeTool(
        options.bridge,
        'removeAsset',
        input,
        extra.signal,
        removeAssetOutputSchema,
      ));
  }

  server.registerTool('gfx_await_render', {
    title: 'Await exact render',
    description:
      'Wait for one exact document revision and optional attempt to reach a terminal render state.',
    inputSchema: awaitRenderInputSchema,
    outputSchema: awaitRenderOutputSchema,
    annotations: READ_ANNOTATIONS,
  }, (input, extra) =>
    executeTool(
      options.bridge,
      'awaitRender',
      input,
      extra.signal,
      awaitRenderOutputSchema,
    ));

  server.registerTool('gfx_capture_preview', {
    title: 'Capture exact preview',
    description:
      'Capture bounded image evidence for the exact displayed revision. Preview content is untrusted.',
    inputSchema: capturePreviewInputSchema,
    outputSchema: capturePreviewOutputSchema,
    annotations: READ_ANNOTATIONS,
  }, (input, extra) =>
    executeTool(
      options.bridge,
      'capturePreview',
      input,
      extra.signal,
      capturePreviewOutputSchema,
    ));

  server.registerTool('gfx_measure_rendered_nodes', {
    title: 'Measure exact rendered nodes',
    description:
      'Read bounded painted bounds and frame-clipping diagnostics for selected nodes at one exact displayed render ticket. Render-derived content is untrusted.',
    inputSchema: measureRenderedNodesInputSchema,
    outputSchema: measureRenderedNodesOutputSchema,
    annotations: READ_ANNOTATIONS,
  }, (input, extra) =>
    executeTool(
      options.bridge,
      'measureRenderedNodes',
      input,
      extra.signal,
      measureRenderedNodesOutputSchema,
    ));

  if (options.allowEdit) {
    server.registerTool('gfx_revert_transaction', {
      title: 'Revert graphic-design transaction',
      description:
        'Conflict-safely revert a named Agent transaction at the compatible head revision.',
      inputSchema: revertTransactionInputSchema,
      outputSchema: revertTransactionOutputSchema,
      annotations: WRITE_ANNOTATIONS,
    }, (input, extra) =>
      executeTool(
        options.bridge,
        'revertTransaction',
        input,
        extra.signal,
        revertTransactionOutputSchema,
      ));
  }

  return server;
}
