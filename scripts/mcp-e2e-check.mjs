// PR6 full transport gate. The official MCP client talks to a real child
// stdio server; its test-only launcher performs the trusted approval clicks.
// Every design operation travels bounded stdio -> authenticated WebSocket ->
// lexical AgentController.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  COMPANION_TRANSPORT_LIMITS,
} from '../packages/mcp-companion/dist/protocol.js';
import { checkMcpAuthority } from './mcp-authority-check.mjs';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const E2E_SERVER = resolve(
  REPOSITORY_ROOT,
  'scripts/mcp-e2e-stdio-server.mjs',
);

function outcome(result) {
  const value = result.structuredContent?.outcome;
  if (!value || typeof value !== 'object') {
    throw new Error(`Missing structured MCP outcome: ${JSON.stringify(result)}`);
  }
  return value;
}

function successValue(result, label) {
  const value = outcome(result);
  if (result.isError || value.ok !== true) {
    throw new Error(`${label} failed: ${JSON.stringify(value)}`);
  }
  return value.value;
}

async function waitForGeneralRateTokens(count) {
  const refillMs = Math.ceil(
    count * 60_000 / COMPANION_TRANSPORT_LIMITS.requestsPerMinute,
  );
  await new Promise((resolveWait) => setTimeout(resolveWait, refillMs + 50));
}

await checkMcpAuthority();

const stderrChunks = [];
let stderrText = '';
const diagnosticWaiters = new Set();
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [E2E_SERVER],
  cwd: REPOSITORY_ROOT,
  stderr: 'pipe',
  env: process.env.CHROME ? { CHROME: process.env.CHROME } : {},
});
transport.stderr?.on('data', (chunk) => {
  const bytes = Buffer.from(chunk);
  stderrChunks.push(bytes);
  stderrText += bytes.toString('utf8');
  for (const waiter of diagnosticWaiters) waiter();
});
const mcpClient = new Client(
  { name: 'pr6-e2e', version: '1.0.0' },
  { capabilities: {} },
);
const protocolErrors = [];
mcpClient.onerror = (error) => protocolErrors.push(error);

function waitForDiagnostic(marker) {
  const deadline = Date.now() + 10_000;
  return new Promise((resolveWait, rejectWait) => {
    const inspect = () => {
      if (stderrText.includes(marker)) {
        diagnosticWaiters.delete(inspect);
        resolveWait();
        return;
      }
      if (stderrText.includes('CONTROL_ERROR') || Date.now() >= deadline) {
        diagnosticWaiters.delete(inspect);
        rejectWait(new Error(
          `Missing child diagnostic ${marker}: ${stderrText}`,
        ));
      }
    };
    diagnosticWaiters.add(inspect);
    const timer = setInterval(() => {
      inspect();
      if (!diagnosticWaiters.has(inspect)) clearInterval(timer);
    }, 25);
    timer.unref?.();
    inspect();
  });
}

try {
  await mcpClient.connect(transport);
  await waitForDiagnostic('CONTROL_READY');
  const listed = await mcpClient.listTools();
  const toolNames = listed.tools.map((tool) => tool.name);
  const expectedTools = [
    'gfx_get_capabilities',
    'gfx_get_document',
    'gfx_get_render_status',
    'gfx_validate_document',
    'gfx_get_model_status',
    'gfx_prepare_model',
    'gfx_apply_transaction',
    'gfx_put_asset',
    'gfx_list_assets',
    'gfx_get_asset_metadata',
    'gfx_remove_asset',
    'gfx_await_render',
    'gfx_capture_preview',
    'gfx_revert_transaction',
  ];
  if (JSON.stringify(toolNames) !== JSON.stringify(expectedTools)) {
    throw new Error(`Unexpected MCP tool surface: ${JSON.stringify(toolNames)}`);
  }

  const capabilities = successValue(await mcpClient.callTool({
    name: 'gfx_get_capabilities',
    arguments: {
      nodeTypes: ['Text', 'Outline', 'Rasterize', 'Output'],
      include: ['sockets', 'params', 'traits'],
    },
  }), 'capability discovery');
  if (
    capabilities.features?.mcp !== true
    || capabilities.transport?.protocol
      !== 'authenticated-same-origin-websocket-v1'
    || capabilities.transport?.jsonLimits?.depth !== 128
    || capabilities.transport?.jsonLimits?.values !== 250_000
    || capabilities.transport?.deadlines?.queryAndWriteMs !== 10_000
    || capabilities.transport?.deadlines?.awaitRenderMs !== 35_000
    || capabilities.transport?.deadlines?.previewMs !== 20_000
    || capabilities.transport?.deadlines?.assetMs !== 35_000
    || capabilities.transport?.deadlines?.pairingMs !== 60_000
    || capabilities.transport?.rate?.assetUploadBurst !== 32
    || capabilities.scopeAvailability?.assets?.available !== true
    || capabilities.scopeAvailability?.model?.available !== true
  ) {
    throw new Error(
      `Companion capability profile is inaccurate: ${JSON.stringify(capabilities)}`,
    );
  }

  const modelStatus = successValue(await mcpClient.callTool({
    name: 'gfx_get_model_status',
    arguments: {},
  }), 'model status');
  if (
    modelStatus.modelKey !== 'rmbg-1.4'
    || typeof modelStatus.manifestSha256 !== 'string'
    || JSON.stringify(modelStatus).includes('http')
  ) {
    throw new Error(
      `Model status exposed an invalid contract: ${
        JSON.stringify(modelStatus)
      }`,
    );
  }
  const prepareCheck = await mcpClient.callTool({
    name: 'gfx_prepare_model',
    arguments: { requestId: 'mcp_model_prepare_check_v1' },
  });
  const prepareOutcome = outcome(prepareCheck);
  const alreadyAvailable =
    prepareOutcome.ok === true
    && ['downloading', 'verifying', 'ready'].includes(
      prepareOutcome.value?.state,
    );
  const humanRequired =
    prepareCheck.isError
    && prepareOutcome.ok === false
    && prepareOutcome.error?.code === 'MODEL_DOWNLOAD_REQUIRED'
    && prepareOutcome.error?.details?.reason === 'CONFIRMATION_REQUIRED';
  if (!alreadyAvailable && !humanRequired) {
    throw new Error(
      `MCP model preparation bypassed its human gate: ${
        JSON.stringify(prepareOutcome)
      }`,
    );
  }

  const initial = successValue(await mcpClient.callTool({
    name: 'gfx_get_document',
    arguments: { include: ['frame', 'layers'] },
  }), 'initial document');
  let baselineRevision = initial.revision;
  const initiallyVisible = (initial.layers ?? [])
    .filter((layer) => layer?.visible === true)
    .map((layer) => layer.id);
  // This transport gate should exercise its own model/poster layers, not pay
  // the software-GPU cost of the full factory artwork on headless CI.
  const isolationCommands = [
    ...(
      initial.frame?.width === 128 && initial.frame?.height === 128
        ? []
        : [{ op: 'set_frame', width: 128, height: 128 }]
    ),
    ...initiallyVisible.map((layerId) => ({
      op: 'update_layer',
      layerId,
      patch: { visible: false },
    })),
  ];
  if (isolationCommands.length > 0) {
    const isolated = successValue(await mcpClient.callTool({
      name: 'gfx_apply_transaction',
      arguments: {
        requestId: 'mcp_isolate_initial_layers_v1',
        expectedRevision: baselineRevision,
        commands: isolationCommands,
      },
    }), 'initial layer isolation');
    if (
      !isolated.committed
      || isolated.revision !== baselineRevision + 1
      || isolated.persistenceStatus !== 'durable'
      || isolated.renderStatus?.ticket?.revision !== isolated.revision
    ) {
      throw new Error(
        `Initial layer isolation failed: ${JSON.stringify(isolated)}`,
      );
    }
    baselineRevision = isolated.revision;
  }
  const assetBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const assetBytes = Buffer.from(assetBase64, 'base64');
  const assetSha256 = createHash('sha256')
    .update(assetBytes)
    .digest('hex');
  const begunAsset = successValue(await mcpClient.callTool({
    name: 'gfx_put_asset',
    arguments: {
      phase: 'begin',
      requestId: 'mcp_asset_begin_v1',
      mimeType: 'image/png',
      byteLength: assetBytes.byteLength,
      sha256: assetSha256,
    },
  }), 'asset begin');
  if (
    begunAsset.phase !== 'begin'
    || begunAsset.revision !== baselineRevision
    || begunAsset.upload?.nextOffset !== 0
  ) {
    throw new Error(
      `Unexpected asset begin result: ${JSON.stringify(begunAsset)}`,
    );
  }
  const chunkedAsset = successValue(await mcpClient.callTool({
    name: 'gfx_put_asset',
    arguments: {
      phase: 'chunk',
      requestId: 'mcp_asset_chunk_v1',
      uploadId: begunAsset.upload.uploadId,
      offset: 0,
      dataBase64: assetBase64,
      chunkSha256: assetSha256,
    },
  }), 'asset chunk');
  if (
    chunkedAsset.phase !== 'chunk'
    || !chunkedAsset.upload?.complete
    || chunkedAsset.upload?.receivedBytes !== assetBytes.byteLength
    || chunkedAsset.revision !== baselineRevision
  ) {
    throw new Error(
      `Unexpected asset chunk result: ${JSON.stringify(chunkedAsset)}`,
    );
  }
  const finalizedAsset = successValue(await mcpClient.callTool({
    name: 'gfx_put_asset',
    arguments: {
      phase: 'finalize',
      requestId: 'mcp_asset_finalize_v1',
      uploadId: begunAsset.upload.uploadId,
      expectedRevision: baselineRevision,
    },
  }), 'asset finalize');
  if (
    finalizedAsset.phase !== 'finalize'
    || finalizedAsset.asset?.sha256 !== assetSha256
    || finalizedAsset.revision !== baselineRevision + 1
    || finalizedAsset.transaction?.committed !== true
    || finalizedAsset.persistenceStatus !== 'durable'
    || finalizedAsset.transaction?.persistenceStatus !== 'durable'
    || finalizedAsset.renderStatus?.ticket?.revision
      !== finalizedAsset.revision
    || finalizedAsset.transaction?.renderStatus?.ticket?.revision
      !== finalizedAsset.revision
  ) {
    throw new Error(
      `Unexpected asset finalize result: ${JSON.stringify(finalizedAsset)}`,
    );
  }
  const listedAssets = successValue(await mcpClient.callTool({
    name: 'gfx_list_assets',
    arguments: { limit: 64 },
  }), 'asset list');
  if (
    listedAssets.revision !== finalizedAsset.revision
    || !listedAssets.assets?.some(
      (asset) => asset.metadata?.id === finalizedAsset.asset.id,
    )
  ) {
    throw new Error(
      `Finalized asset was not listed: ${JSON.stringify(listedAssets)}`,
    );
  }
  const assetMetadata = successValue(await mcpClient.callTool({
    name: 'gfx_get_asset_metadata',
    arguments: { assetId: finalizedAsset.asset.id },
  }), 'asset metadata');
  if (
    assetMetadata.metadata?.sha256 !== assetSha256
    || assetMetadata.referenceCount !== 0
    || assetMetadata.availability !== 'available'
  ) {
    throw new Error(
      `Unexpected asset metadata: ${JSON.stringify(assetMetadata)}`,
    );
  }
  const removedAsset = successValue(await mcpClient.callTool({
    name: 'gfx_remove_asset',
    arguments: {
      requestId: 'mcp_asset_remove_v1',
      expectedRevision: finalizedAsset.revision,
      assetId: finalizedAsset.asset.id,
    },
  }), 'asset removal');
  if (
    !removedAsset.committed
    || removedAsset.revision !== finalizedAsset.revision + 1
    || removedAsset.persistenceStatus !== 'durable'
    || removedAsset.renderStatus?.ticket?.revision !== removedAsset.revision
  ) {
    throw new Error(
      `Asset removal failed: ${JSON.stringify(removedAsset)}`,
    );
  }
  const restoredAsset = successValue(await mcpClient.callTool({
    name: 'gfx_revert_transaction',
    arguments: {
      requestId: 'mcp_asset_remove_revert_v1',
      expectedRevision: removedAsset.revision,
      transactionId: removedAsset.transactionId,
    },
  }), 'asset removal revert');
  if (
    !restoredAsset.committed
    || restoredAsset.revision !== removedAsset.revision + 1
    || restoredAsset.persistenceStatus !== 'durable'
    || restoredAsset.renderStatus?.ticket?.revision !== restoredAsset.revision
  ) {
    throw new Error(
      `Asset removal revert failed: ${JSON.stringify(restoredAsset)}`,
    );
  }
  const modelTransaction = {
    requestId: 'mcp_model_route_v1',
    expectedRevision: restoredAsset.revision,
    commands: [
      {
        op: 'add_layer',
        clientRef: 'model_layer',
        name: 'Local model route probe',
      },
      {
        op: 'add_node',
        layerId: { clientRef: 'model_layer' },
        clientRef: 'model_noise',
        nodeType: 'Noise',
        params: { mode: 'grain', scale: 64, seed: 7 },
      },
      {
        op: 'add_node',
        layerId: { clientRef: 'model_layer' },
        clientRef: 'remove_background',
        nodeType: 'RemoveBackground',
      },
      {
        op: 'connect',
        layerId: { clientRef: 'model_layer' },
        from: { nodeId: { clientRef: 'model_noise' }, socket: 'out' },
        to: {
          nodeId: { clientRef: 'remove_background' },
          socket: 'in',
        },
      },
      {
        op: 'connect',
        layerId: { clientRef: 'model_layer' },
        from: {
          nodeId: { clientRef: 'remove_background' },
          socket: 'out',
        },
        to: { nodeId: 'out', socket: 'in' },
      },
    ],
  };
  const modelApplied = successValue(await mcpClient.callTool({
    name: 'gfx_apply_transaction',
    arguments: modelTransaction,
  }), 'model route transaction');
  if (
    !modelApplied.committed
    || modelApplied.persistenceStatus !== 'durable'
    || modelApplied.renderStatus?.ticket?.revision !== modelApplied.revision
  ) {
    throw new Error(
      `Model transaction did not commit: ${JSON.stringify(modelApplied)}`,
    );
  }
  const modelRender = successValue(await mcpClient.callTool({
    name: 'gfx_await_render',
    arguments: {
      revision: modelApplied.revision,
      timeoutMs: 30_000,
    },
  }), 'model route render');
  if (
    modelRender.state !== 'failed'
    || modelRender.requestedRevision !== modelApplied.revision
    || modelRender.ticket?.revision !== modelApplied.revision
    || modelRender.error?.nodeType !== 'RemoveBackground'
    || modelRender.error?.phase !== 'worker'
  ) {
    throw new Error(
      `Authorized model render did not enter its local worker path: ${
        JSON.stringify(modelRender)
      }; child diagnostics: ${stderrText}`,
    );
  }
  await waitForDiagnostic('MODEL_ROUTE_SEEN');
  const modelReverted = successValue(await mcpClient.callTool({
    name: 'gfx_revert_transaction',
    arguments: {
      requestId: 'mcp_model_route_revert_v1',
      expectedRevision: modelApplied.revision,
      transactionId: modelApplied.transactionId,
    },
  }), 'model route revert');
  if (
    !modelReverted.committed
    || modelReverted.persistenceStatus !== 'durable'
    || modelReverted.renderStatus?.ticket?.revision !== modelReverted.revision
  ) {
    throw new Error(
      `Model transaction revert failed: ${JSON.stringify(modelReverted)}`,
    );
  }
  const transaction = {
    requestId: 'mcp_text_poster_v1',
    expectedRevision: modelReverted.revision,
    commands: [
      { op: 'set_frame', width: 320, height: 240 },
      {
        op: 'add_layer',
        clientRef: 'poster_layer',
        name: 'MCP Poster',
      },
      {
        op: 'add_node',
        layerId: { clientRef: 'poster_layer' },
        clientRef: 'poster_text',
        nodeType: 'Text',
        params: {
          content: 'AGENT',
          fontSize: 96,
          fill: '#111111',
        },
      },
      {
        op: 'add_node',
        layerId: { clientRef: 'poster_layer' },
        clientRef: 'poster_outline',
        nodeType: 'Outline',
      },
      {
        op: 'add_node',
        layerId: { clientRef: 'poster_layer' },
        clientRef: 'poster_raster',
        nodeType: 'Rasterize',
      },
      {
        op: 'connect',
        layerId: { clientRef: 'poster_layer' },
        from: { nodeId: { clientRef: 'poster_text' }, socket: 'out' },
        to: { nodeId: { clientRef: 'poster_outline' }, socket: 'text' },
      },
      {
        op: 'connect',
        layerId: { clientRef: 'poster_layer' },
        from: { nodeId: { clientRef: 'poster_outline' }, socket: 'out' },
        to: { nodeId: { clientRef: 'poster_raster' }, socket: 'vector' },
      },
      {
        op: 'connect',
        layerId: { clientRef: 'poster_layer' },
        from: { nodeId: { clientRef: 'poster_raster' }, socket: 'out' },
        to: { nodeId: 'out', socket: 'in' },
      },
      {
        op: 'auto_layout_graph',
        layerId: { clientRef: 'poster_layer' },
        direction: 'LR',
      },
    ],
  };
  const applied = successValue(await mcpClient.callTool({
    name: 'gfx_apply_transaction',
    arguments: transaction,
  }), 'poster transaction');
  if (
    !applied.committed
    || applied.revision !== modelReverted.revision + 1
    || applied.persistenceStatus !== 'durable'
    || applied.renderStatus?.ticket?.revision !== applied.revision
  ) {
    throw new Error(`Unexpected transaction result: ${JSON.stringify(applied)}`);
  }

  const validation = successValue(await mcpClient.callTool({
    name: 'gfx_validate_document',
    arguments: {
      source: 'current',
      mode: 'renderable',
      maxFindings: 32,
    },
  }), 'current document validation');
  if (!validation.report?.valid) {
    throw new Error(
      `Committed document did not validate: ${JSON.stringify(validation)}`,
    );
  }

  const replayed = successValue(await mcpClient.callTool({
    name: 'gfx_apply_transaction',
    arguments: transaction,
  }), 'idempotent retry');
  if (JSON.stringify(replayed) !== JSON.stringify(applied)) {
    throw new Error(
      `Duplicate request changed its result: ${JSON.stringify({ applied, replayed })}`,
    );
  }

  const invalid = await mcpClient.callTool({
    name: 'gfx_apply_transaction',
    arguments: {
      requestId: 'mcp_invalid_wire_v1',
      expectedRevision: applied.revision,
      commands: [
        {
          op: 'add_node',
          layerId: applied.created.poster_layer,
          clientRef: 'invalid_raster',
          nodeType: 'Rasterize',
        },
        {
          op: 'connect',
          layerId: applied.created.poster_layer,
          from: {
            nodeId: applied.created.poster_text,
            socket: 'out',
          },
          to: {
            nodeId: { clientRef: 'invalid_raster' },
            socket: 'vector',
          },
        },
      ],
    },
  });
  const invalidOutcome = outcome(invalid);
  if (
    !invalid.isError
    || invalidOutcome.ok !== false
    || invalidOutcome.error?.code !== 'TYPE_MISMATCH'
    || invalidOutcome.revision !== applied.revision
  ) {
    throw new Error(
      `Invalid wiring was not preserved structurally: ${JSON.stringify(invalidOutcome)}`,
    );
  }
  const afterInvalid = successValue(await mcpClient.callTool({
    name: 'gfx_get_document',
    arguments: { include: ['frame'] },
  }), 'post-invalid document');
  if (afterInvalid.revision !== applied.revision) {
    throw new Error('Invalid wiring changed the document revision.');
  }

  // This gate intentionally exercises more calls than the published burst.
  // Refill through the real rate limiter instead of weakening production
  // limits or creating a test-only transport bypass.
  await waitForGeneralRateTokens(4);

  const rendered = successValue(await mcpClient.callTool({
    name: 'gfx_await_render',
    arguments: {
      revision: applied.revision,
      timeoutMs: 30_000,
    },
  }), 'exact render');
  if (
    rendered.state !== 'complete'
    || rendered.renderRevision !== applied.revision
    || rendered.displayedRevision !== applied.revision
  ) {
    throw new Error(`Exact render did not complete: ${JSON.stringify(rendered)}`);
  }
  const renderStatus = successValue(await mcpClient.callTool({
    name: 'gfx_get_render_status',
    arguments: {
      revision: applied.revision,
      attempt: rendered.ticket.attempt,
      includeEvents: false,
    },
  }), 'exact render status');
  if (
    renderStatus.state !== 'complete'
    || renderStatus.renderRevision !== applied.revision
  ) {
    throw new Error(
      `Render status disagreed with await: ${JSON.stringify(renderStatus)}`,
    );
  }

  const stalePreviewResult = await mcpClient.callTool({
    name: 'gfx_capture_preview',
    arguments: {
      revision: baselineRevision,
      maxWidth: 64,
      maxHeight: 64,
      format: 'png',
    },
  });
  const stalePreview = outcome(stalePreviewResult);
  if (
    !stalePreviewResult.isError
    || stalePreview.ok !== false
    || stalePreview.error?.code !== 'RENDER_SUPERSEDED'
  ) {
    throw new Error(
      `Stale preview failure was not preserved: ${JSON.stringify(stalePreview)}`,
    );
  }

  const previewResult = await mcpClient.callTool({
    name: 'gfx_capture_preview',
    arguments: {
      revision: applied.revision,
      attempt: rendered.ticket.attempt,
      maxWidth: 320,
      maxHeight: 240,
      format: 'png',
      includeMetrics: true,
    },
  });
  const preview = successValue(previewResult, 'exact preview');
  const image = previewResult.content.find((block) => block.type === 'image');
  if (!image || image.type !== 'image') {
    throw new Error('MCP preview did not return image content.');
  }
  const previewBytes = Buffer.from(image.data, 'base64');
  const previewHash = createHash('sha256').update(previewBytes).digest('hex');
  if (
    preview.revision !== applied.revision
    || preview.requestedRevision !== applied.revision
    || preview.image.byteLength !== previewBytes.byteLength
    || preview.image.contentHash !== previewHash
    || preview.image.mimeType !== image.mimeType
  ) {
    throw new Error(
      `Preview evidence mismatch: ${JSON.stringify({ preview, previewHash })}`,
    );
  }

  const reverted = successValue(await mcpClient.callTool({
    name: 'gfx_revert_transaction',
    arguments: {
      requestId: 'mcp_revert_poster_v1',
      expectedRevision: applied.revision,
      transactionId: applied.transactionId,
    },
  }), 'transaction revert');
  if (
    !reverted.committed
    || reverted.revision !== applied.revision + 1
    || reverted.persistenceStatus !== 'durable'
    || reverted.renderStatus?.ticket?.revision !== reverted.revision
  ) {
    throw new Error(`Revert failed: ${JSON.stringify(reverted)}`);
  }

  const childPid = transport.pid;
  if (!childPid) throw new Error('The stdio E2E child PID is unavailable.');
  process.kill(childPid, 'SIGUSR1');
  await waitForDiagnostic('CONTROL_REVOKED');
  const revoked = await mcpClient.callTool({
    name: 'gfx_get_document',
    arguments: {},
  });
  const revokedOutcome = outcome(revoked);
  if (
    !revoked.isError
    || revokedOutcome.ok !== false
    || !['SESSION_REVOKED', 'PAIRING_NOT_APPROVED'].includes(
      revokedOutcome.error?.code,
    )
  ) {
    throw new Error(
      `Revoked session retained authority: ${JSON.stringify(revokedOutcome)}`,
    );
  }

  if (stderrText.includes('CONTROL_ERROR')) {
    throw new Error(`Child browser control failed: ${stderrText}`);
  }
  if (protocolErrors.length > 0) {
    throw new Error(
      `The real stdio stream contained protocol errors: ${
        protocolErrors.map((error) => error.message).join(' | ')
      }`,
    );
  }
  process.stdout.write(
    `MCP stdio E2E passed: revision ${applied.revision}, `
    + `${assetBytes.byteLength} asset bytes, `
    + `${previewBytes.byteLength} preview bytes, exact reverts and revoke.\n`,
  );
} finally {
  await mcpClient.close().catch(() => undefined);
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  if (
    /pageerror:|console\.error:/.test(stderr)
    || stderr.includes('CONTROL_ERROR')
  ) {
    throw new Error(`Browser problems in stdio E2E child: ${stderr}`);
  }
}
