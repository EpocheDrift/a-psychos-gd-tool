// PR8 Agent evaluation gate. One official MCP client drives one real browser
// session through bounded stdio, the authenticated companion bridge, and the
// production AgentController. The test launcher performs only the explicit
// human approval/edit actions described in mcp-e2e-stdio-server.mjs.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CallToolResultSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import {
  COMPANION_TRANSPORT_LIMITS,
} from '../packages/mcp-companion/dist/protocol.js';
import { checkMcpAuthority } from './mcp-authority-check.mjs';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const E2E_SERVER = resolve(
  REPOSITORY_ROOT,
  'scripts/mcp-e2e-stdio-server.mjs',
);
const GOLDEN_PATH = resolve(
  REPOSITORY_ROOT,
  'test/fixtures/agent-evals/golden-v1.json',
);
const EVIDENCE_DIRECTORY = resolve(
  REPOSITORY_ROOT,
  'test-results/agent-evals',
);
const PNG_ASSET_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_ASSET_BYTES = Buffer.from(PNG_ASSET_BASE64, 'base64');
const PNG_ASSET_SHA256 = createHash('sha256')
  .update(PNG_ASSET_BYTES)
  .digest('hex');
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const EXPECTED_TOOL_NAMES = [
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
const EVALUATED_NODE_TYPES = [
  'Text',
  'Outline',
  'Warp',
  'Rasterize',
  'Recolor',
  'Output',
  'Split',
  'Function',
  'Place',
  'Image',
  'Grid',
  'Random',
  'Shape',
  'Duplicator',
  'Trace',
  'RemoveBackground',
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function roundMilliseconds(value) {
  return Math.round(value * 100) / 100;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hexHammingDistance(left, right) {
  invariant(
    typeof left === 'string'
      && typeof right === 'string'
      && left.length === right.length
      && /^[0-9a-f]+$/u.test(left)
      && /^[0-9a-f]+$/u.test(right),
    'Perceptual hashes were not comparable lowercase hex values.',
  );
  let distance = 0;
  for (let index = 0; index < left.length; index++) {
    let bits = Number.parseInt(left[index], 16)
      ^ Number.parseInt(right[index], 16);
    while (bits !== 0) {
      distance += bits & 1;
      bits >>>= 1;
    }
  }
  return distance;
}

function publicOutcome(result) {
  const value = result?.structuredContent?.outcome;
  if (!value || typeof value !== 'object') {
    throw new Error(
      `MCP result omitted its structured outcome for ${
        result?.content?.[0]?.type ?? 'unknown content'
      }.`,
    );
  }
  return value;
}

function isRequestTimeout(error) {
  return error instanceof McpError
    && error.code === ErrorCode.RequestTimeout;
}

function successfulValue(result, label) {
  const value = publicOutcome(result);
  if (result.isError || value.ok !== true) {
    const publicError = value.error ?? {};
    throw new Error(
      `${label} failed with ${publicError.code ?? 'unknown error'}`
      + `${publicError.message ? `: ${publicError.message}` : ''}`
      + `${publicError.path ? ` at ${publicError.path}` : ''}`
      + `${publicError.suggestedFix
        ? ` Suggested fix: ${publicError.suggestedFix}`
        : ''}.`,
    );
  }
  return value.value;
}

function failedOutcome(result, label, expectedCode) {
  const value = publicOutcome(result);
  if (
    !result.isError
    || value.ok !== false
    || value.error?.code !== expectedCode
  ) {
    throw new Error(
      `${label} did not return ${expectedCode}; received ${
        value.ok === false ? value.error?.code : 'success'
      }.`,
    );
  }
  return value;
}

function strictCommit(value, request, previousRevision, label) {
  invariant(value?.ok === true, `${label} omitted ok=true.`);
  invariant(value.committed === true, `${label} did not commit.`);
  invariant(value.dryRun === false, `${label} unexpectedly dry-ran.`);
  invariant(
    value.requestId === request.requestId,
    `${label} returned the wrong requestId.`,
  );
  invariant(
    value.previousRevision === previousRevision,
    `${label} returned the wrong previous revision.`,
  );
  invariant(
    value.revision === previousRevision + 1
      && value.proposedRevision === value.revision,
    `${label} returned an inconsistent committed revision.`,
  );
  invariant(
    typeof value.transactionId === 'string'
      && value.transactionId.length > 0,
    `${label} omitted its transactionId.`,
  );
  invariant(
    value.persistenceStatus === 'durable',
    `${label} was not durably persisted.`,
  );
  invariant(
    value.renderStatus?.ticket?.revision === value.revision,
    `${label} omitted its exact render ticket.`,
  );
  return value;
}

function clientRef(value) {
  return { clientRef: value };
}

class RealTokenBucket {
  constructor(capacity, requestsPerMinute) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.tokensPerMillisecond = requestsPerMinute / 60_000;
    this.refilledAt = performance.now();
  }

  refill() {
    const now = performance.now();
    const elapsed = Math.max(0, now - this.refilledAt);
    this.refilledAt = now;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.tokensPerMillisecond,
    );
  }

  async take() {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(
        (1 - this.tokens) / this.tokensPerMillisecond,
      );
      // A small boundary margin keeps this client-side mirror behind the real
      // production bucket instead of relying on timer precision.
      await new Promise((resolveWait) =>
        setTimeout(resolveWait, waitMs + 20));
    }
  }
}

function percentile(values, quantile) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * quantile) - 1),
  );
  return roundMilliseconds(ordered[index]);
}

function latencySummary(values) {
  if (values.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      mean: null,
      p95: null,
    };
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    min: roundMilliseconds(Math.min(...values)),
    max: roundMilliseconds(Math.max(...values)),
    mean: roundMilliseconds(sum / values.length),
    p95: percentile(values, 0.95),
  };
}

function safeFailureMessage(error) {
  const source = error instanceof Error ? error.message : 'Unknown failure';
  return source
    .replaceAll(REPOSITORY_ROOT, '[repository]')
    .replace(/https?:\/\/[^\s"'<>]+/giu, '[url]')
    .replace(/data:[^\s"'<>]+/giu, '[embedded-data]')
    .replace(/[A-Za-z0-9+/]{96,}={0,2}/gu, '[encoded-data]')
    .slice(0, 1_000);
}

await rm(EVIDENCE_DIRECTORY, { recursive: true, force: true });
await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
const golden = JSON.parse(await readFile(GOLDEN_PATH, 'utf8'));
invariant(
  golden.schemaVersion === 1,
  'Unsupported Agent evaluation golden schema.',
);

const stderrChunks = [];
let stderrText = '';
const diagnosticWaiters = new Set();
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [E2E_SERVER],
  cwd: REPOSITORY_ROOT,
  stderr: 'pipe',
  env: {
    ...(process.env.CHROME ? { CHROME: process.env.CHROME } : {}),
    GFX_AGENT_EVAL: '1',
  },
});
transport.stderr?.on('data', (chunk) => {
  const bytes = Buffer.from(chunk);
  stderrChunks.push(bytes);
  stderrText += bytes.toString('utf8');
  for (const waiter of diagnosticWaiters) waiter();
});

function waitForDiagnostic(pattern, fromIndex = 0, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveWait, rejectWait) => {
    const inspect = () => {
      const tail = stderrText.slice(fromIndex);
      const match = typeof pattern === 'string'
        ? (tail.includes(pattern) ? [pattern] : null)
        : tail.match(pattern);
      if (match) {
        diagnosticWaiters.delete(inspect);
        resolveWait(match);
        return;
      }
      if (tail.includes('CONTROL_ERROR') || Date.now() >= deadline) {
        diagnosticWaiters.delete(inspect);
        rejectWait(new Error('The browser launcher missed an eval diagnostic.'));
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

const mcpClient = new Client(
  { name: 'gfx-agent-eval', version: '1.0.0' },
  { capabilities: {} },
);
const protocolErrors = [];
mcpClient.onerror = (error) => protocolErrors.push(error);

const generalBucket = new RealTokenBucket(
  COMPANION_TRANSPORT_LIMITS.requestBurst,
  COMPANION_TRANSPORT_LIMITS.requestsPerMinute,
);
const assetBucket = new RealTokenBucket(
  COMPANION_TRANSPORT_LIMITS.assetUploadRequestBurst,
  COMPANION_TRANSPORT_LIMITS.requestsPerMinute,
);
const traceEntries = [];
const scenarioReports = [];
const renderLatencies = [];
const previewArtifacts = [];
let activeScenario = 'suite_setup';
let traceSequence = 0;
let currentRevision = null;
let invalidPlans = 0;
let revisionConflicts = 0;
let retries = 0;
let timedOutRetries = 0;
let successfulRecoveries = 0;

async function callTool(name, args, options = {}) {
  const bucket = name === 'gfx_put_asset' ? assetBucket : generalBucket;
  await bucket.take();
  const startedAt = performance.now();
  const entry = {
    sequence: ++traceSequence,
    scenario: activeScenario,
    tool: name,
    ...(typeof args?.phase === 'string' ? { phase: args.phase } : {}),
    ...(typeof args?.requestId === 'string'
      ? { requestId: args.requestId }
      : {}),
  };
  try {
    const result = await mcpClient.callTool(
      { name, arguments: args },
      CallToolResultSchema,
      options.timeoutMs === undefined
        ? undefined
        : { timeout: options.timeoutMs },
    );
    const elapsed = performance.now() - startedAt;
    const outcome = publicOutcome(result);
    Object.assign(entry, {
      durationMs: roundMilliseconds(elapsed),
      outcome: outcome.ok === true ? 'success' : 'error',
      ...(outcome.ok === false
        ? { errorCode: outcome.error?.code ?? 'UNKNOWN' }
        : {}),
      ...(Number.isSafeInteger(
        outcome.ok === true
          ? outcome.value?.revision
            ?? outcome.value?.documentRevision
            ?? outcome.value?.requestedRevision
          : outcome.revision,
      )
        ? {
            revision: outcome.ok === true
              ? outcome.value?.revision
                ?? outcome.value?.documentRevision
                ?? outcome.value?.requestedRevision
              : outcome.revision,
          }
        : {}),
    });
    traceEntries.push(entry);
    return { result, durationMs: elapsed };
  } catch (error) {
    const elapsed = performance.now() - startedAt;
    const requestTimedOut = isRequestTimeout(error);
    Object.assign(entry, {
      durationMs: roundMilliseconds(elapsed),
      outcome: requestTimedOut
        ? 'client-timeout'
        : 'transport-error',
      errorCode: requestTimedOut
        ? 'CLIENT_TIMEOUT'
        : 'MCP_TRANSPORT_ERROR',
    });
    traceEntries.push(entry);
    throw error;
  }
}

async function callSuccess(scenario, name, args, label, options) {
  const previousScenario = activeScenario;
  activeScenario = scenario;
  try {
    const called = await callTool(name, args, options);
    return {
      ...called,
      value: successfulValue(called.result, label),
    };
  } finally {
    activeScenario = previousScenario;
  }
}

async function runScenario(name, operation) {
  const beforeCalls = traceEntries.length;
  const startedAt = performance.now();
  const previousScenario = activeScenario;
  activeScenario = name;
  try {
    await operation();
    scenarioReports.push({
      name,
      status: 'passed',
      durationMs: roundMilliseconds(performance.now() - startedAt),
      toolCalls: traceEntries.length - beforeCalls,
    });
  } finally {
    activeScenario = previousScenario;
  }
}

async function applyTransaction(request, label) {
  const previousRevision = currentRevision;
  const { value } = await callSuccess(
    activeScenario,
    'gfx_apply_transaction',
    request,
    label,
  );
  strictCommit(value, request, previousRevision, label);
  currentRevision = value.revision;
  return value;
}

async function readDocument(args, label) {
  const { value } = await callSuccess(
    activeScenario,
    'gfx_get_document',
    args,
    label,
  );
  if (currentRevision === null) {
    currentRevision = value.revision;
  } else {
    invariant(
      value.revision === currentRevision,
      `${label} returned revision ${value.revision}, expected ${currentRevision}.`,
    );
  }
  invariant(
    value.schemaVersion === 4
      && value.trust === 'untrusted-document-content',
    `${label} returned the wrong public document contract.`,
  );
  invariant(
    Array.isArray(value.redactions) && value.redactions.length === 0,
    `${label} unexpectedly required content redaction.`,
  );
  return value;
}

async function validateCurrent(label) {
  const { value } = await callSuccess(
    activeScenario,
    'gfx_validate_document',
    {
      source: 'current',
      mode: 'renderable',
      maxFindings: 64,
    },
    label,
  );
  invariant(
    value.trust === 'untrusted-document-content'
      && value.report?.mode === 'renderable'
      && value.report?.valid === true
      && value.report?.errors?.length === 0,
    `${label} did not validate as renderable.`,
  );
  return value;
}

async function awaitExactRender(revision, expectedState, label) {
  const called = await callSuccess(
    activeScenario,
    'gfx_await_render',
    { revision, timeoutMs: 30_000 },
    label,
  );
  renderLatencies.push(called.durationMs);
  const value = called.value;
  invariant(
    value.state === expectedState
      && value.requestedRevision === revision
      && value.ticket?.revision === revision,
    `${label} did not return the exact ${expectedState} ticket.`,
  );
  if (expectedState === 'complete') {
    invariant(
      value.renderRevision === revision
        && value.displayedRevision === revision,
      `${label} did not display the exact completed revision.`,
    );
  }
  return value;
}

function layerFromSnapshot(snapshot, layerId, label) {
  invariant(Array.isArray(snapshot.layers), `${label} omitted layers.`);
  const layer = snapshot.layers.find((candidate) => candidate?.id === layerId);
  invariant(layer, `${label} omitted layer ${layerId}.`);
  invariant(
    layer.graph
      && Array.isArray(layer.graph.nodes)
      && Array.isArray(layer.graph.edges),
    `${label} omitted graph content.`,
  );
  return layer;
}

function nodeMap(layer) {
  return new Map(layer.graph.nodes.map((node) => [node.id, node]));
}

function normalizedTopology(layer) {
  const nodes = nodeMap(layer);
  const nodeTypes = sorted(
    layer.graph.nodes.map((node) => node.type),
  );
  const edges = sorted(layer.graph.edges.map((edge) => {
    const from = nodes.get(edge.from?.node);
    const to = nodes.get(edge.to?.node);
    invariant(from && to, 'Document edge referenced an unknown node.');
    return `${from.type}.${edge.from.socket}->${to.type}.${edge.to.socket}`;
  }));
  return { nodeTypes, edges };
}

function assertParamSubset(layer, expected, label) {
  for (const [type, params] of Object.entries(expected)) {
    const matches = layer.graph.nodes.filter((node) => node.type === type);
    invariant(
      matches.length === 1,
      `${label} expected exactly one ${type} node.`,
    );
    for (const [name, value] of Object.entries(params)) {
      invariant(
        jsonEqual(matches[0].params?.[name], value),
        `${label} returned the wrong ${type}.${name}.`,
      );
    }
  }
}

function assertCreativeGolden(
  snapshot,
  layerId,
  scenarioName,
  fallbackParams,
) {
  const specification = golden.creativeScenarios?.[scenarioName];
  invariant(specification, `Missing golden for ${scenarioName}.`);
  const expectedFrame = specification.frame ?? {
    width: 512,
    height: 384,
  };
  invariant(
    snapshot.frame?.width === expectedFrame.width
      && snapshot.frame?.height === expectedFrame.height,
    `${scenarioName} did not preserve its golden frame.`,
  );
  const layer = layerFromSnapshot(snapshot, layerId, scenarioName);
  const actual = normalizedTopology(layer);
  invariant(
    jsonEqual(actual.nodeTypes, sorted(specification.nodeTypes)),
    `${scenarioName} node topology diverged from the golden.`,
  );
  invariant(
    jsonEqual(actual.edges, sorted(specification.edges)),
    `${scenarioName} typed edges diverged from the golden.`,
  );
  assertParamSubset(
    layer,
    specification.params ?? fallbackParams,
    scenarioName,
  );
  return layer;
}

async function captureCreativePreview(
  scenarioName,
  renderStatus,
  specification,
) {
  const called = await callTool('gfx_capture_preview', {
    revision: currentRevision,
    attempt: renderStatus.ticket.attempt,
    maxWidth: specification.preview.width,
    maxHeight: specification.preview.height,
    format: 'png',
    includeMetrics: true,
  });
  const preview = successfulValue(
    called.result,
    `${scenarioName} preview`,
  );
  const image = called.result.content?.find(
    (block) => block.type === 'image',
  );
  invariant(image?.type === 'image', `${scenarioName} omitted PNG content.`);
  const bytes = Buffer.from(image.data, 'base64');
  const contentHash = sha256(bytes);
  const luminanceRange =
    preview.metrics?.luminance?.max - preview.metrics?.luminance?.min;
  invariant(
    bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
    `${scenarioName} preview was not a PNG.`,
  );
  invariant(
    preview.revision === currentRevision
      && preview.requestedRevision === currentRevision
      && preview.attempt === renderStatus.ticket.attempt,
    `${scenarioName} preview did not bind to its exact render.`,
  );
  invariant(
    preview.width === specification.preview.width
      && preview.height === specification.preview.height
      && preview.sourceWidth
        === (
          specification.preview.sourceWidth
          ?? specification.frame?.width
          ?? 512
        )
      && preview.sourceHeight
        === (
          specification.preview.sourceHeight
          ?? specification.frame?.height
          ?? 384
        ),
    `${scenarioName} preview dimensions diverged from the golden.`,
  );
  invariant(
    preview.mimeType === 'image/png'
      && image.mimeType === 'image/png'
      && preview.byteLength === bytes.byteLength
      && preview.image?.byteLength === bytes.byteLength
      && preview.image?.contentHash === contentHash
      && preview.image?.mimeType === image.mimeType,
    `${scenarioName} preview bytes and MCP metadata disagreed.`,
  );
  invariant(
    bytes.byteLength >= specification.preview.minByteLength
      && bytes.byteLength
        <= COMPANION_TRANSPORT_LIMITS.maxPreviewBytes,
    `${scenarioName} preview byte length was outside policy.`,
  );
  invariant(
    preview.metrics?.version === 'preview-metrics-v1'
      && preview.metrics.alphaCoverage
        >= specification.preview.minAlphaCoverage
      && luminanceRange >= specification.preview.minLuminanceRange
      && /^[0-9a-f]{16}$/u.test(
        preview.metrics.perceptualHash ?? '',
      ),
    `${scenarioName} preview metrics did not prove visible content.`,
  );
  const perceptualDistance = specification.preview.perceptualHash
    ? hexHammingDistance(
        preview.metrics.perceptualHash,
        specification.preview.perceptualHash,
      )
    : null;
  if (perceptualDistance !== null) {
    invariant(
      Number.isSafeInteger(specification.preview.maxHammingDistance)
        && perceptualDistance <= specification.preview.maxHammingDistance,
      `${scenarioName} preview diverged from its reviewed perceptual golden.`,
    );
  }
  if (specification.preview.requireNonBackgroundBounds) {
    invariant(
      preview.metrics.nonBackgroundBounds !== null,
      `${scenarioName} preview had no non-background bounds.`,
    );
  }
  invariant(
    /^[0-9a-f]{64}$/u.test(preview.rgbaSha256 ?? ''),
    `${scenarioName} preview omitted its RGBA hash.`,
  );
  const fileName = `${scenarioName}.png`;
  await writeFile(resolve(EVIDENCE_DIRECTORY, fileName), bytes);
  previewArtifacts.push({
    scenario: scenarioName,
    file: fileName,
    revision: currentRevision,
    attempt: renderStatus.ticket.attempt,
    width: preview.width,
    height: preview.height,
    byteLength: bytes.byteLength,
    contentHash,
    rgbaSha256: preview.rgbaSha256,
    alphaCoverage: preview.metrics.alphaCoverage,
    nonBackgroundBounds: preview.metrics.nonBackgroundBounds,
    luminance: preview.metrics.luminance,
    luminanceRange,
    perceptualHash: preview.metrics.perceptualHash,
    ...(perceptualDistance === null ? {} : { perceptualDistance }),
  });
}

async function hideLayers(layerIds, requestId) {
  if (layerIds.length === 0) return;
  const previousScenario = activeScenario;
  activeScenario = 'suite_housekeeping';
  try {
    await applyTransaction({
      requestId,
      expectedRevision: currentRevision,
      commands: layerIds.map((layerId) => ({
        op: 'update_layer',
        layerId,
        patch: { visible: false },
      })),
    }, 'eval layer isolation');
  } finally {
    activeScenario = previousScenario;
  }
}

async function uploadMaskAsset() {
  const begin = await callSuccess(
    activeScenario,
    'gfx_put_asset',
    {
      phase: 'begin',
      requestId: 'agent_eval_asset_begin_v1',
      mimeType: 'image/png',
      byteLength: PNG_ASSET_BYTES.byteLength,
      sha256: PNG_ASSET_SHA256,
    },
    'eval asset begin',
  );
  invariant(
    begin.value.phase === 'begin'
      && begin.value.revision === currentRevision
      && begin.value.upload?.nextOffset === 0,
    'Eval asset begin returned an invalid upload lease.',
  );
  const uploadId = begin.value.upload.uploadId;
  const chunk = await callSuccess(
    activeScenario,
    'gfx_put_asset',
    {
      phase: 'chunk',
      requestId: 'agent_eval_asset_chunk_v1',
      uploadId,
      offset: 0,
      dataBase64: PNG_ASSET_BASE64,
      chunkSha256: PNG_ASSET_SHA256,
    },
    'eval asset chunk',
  );
  invariant(
    chunk.value.phase === 'chunk'
      && chunk.value.revision === currentRevision
      && chunk.value.upload?.complete === true
      && chunk.value.upload?.receivedBytes === PNG_ASSET_BYTES.byteLength,
    'Eval asset chunk did not complete exactly.',
  );
  const previousRevision = currentRevision;
  const finalizeRequest = {
    phase: 'finalize',
    requestId: 'agent_eval_asset_finalize_v1',
    uploadId,
    expectedRevision: currentRevision,
  };
  const finalized = await callSuccess(
    activeScenario,
    'gfx_put_asset',
    finalizeRequest,
    'eval asset finalize',
  );
  const value = finalized.value;
  invariant(
    value.phase === 'finalize'
      && value.asset?.sha256 === PNG_ASSET_SHA256
      && value.asset?.mimeType === 'image/png'
      && value.asset?.byteLength === PNG_ASSET_BYTES.byteLength,
    'Eval asset finalize returned the wrong content address.',
  );
  strictCommit(
    value.transaction,
    finalizeRequest,
    previousRevision,
    'eval asset finalize transaction',
  );
  invariant(
    value.revision === value.transaction.revision
      && value.persistenceStatus === 'durable'
      && value.renderStatus?.ticket?.revision === value.revision,
    'Eval asset finalize split commit, persistence, and render incorrectly.',
  );
  currentRevision = value.revision;
  return value.asset.id;
}

let runFailure;
const suiteStartedAt = new Date().toISOString();
const suiteStartedClock = performance.now();

try {
  await checkMcpAuthority();
  await mcpClient.connect(transport);
  await waitForDiagnostic('CONTROL_READY');
  const listed = await mcpClient.listTools();
  invariant(
    jsonEqual(
      listed.tools.map((tool) => tool.name),
      EXPECTED_TOOL_NAMES,
    ),
    'The Agent evaluation observed an unexpected MCP tool surface.',
  );
  const discovered = await callSuccess(
    activeScenario,
    'gfx_get_capabilities',
    {
      nodeTypes: EVALUATED_NODE_TYPES,
      include: ['sockets', 'params', 'traits'],
    },
    'Agent eval capability discovery',
  );
  invariant(
    discovered.value.features?.mcp === true
      && discovered.value.scopeAvailability?.read?.available === true
      && discovered.value.scopeAvailability?.preview?.available === true
      && discovered.value.scopeAvailability?.edit?.available === true
      && discovered.value.scopeAvailability?.assets?.available === true
      && discovered.value.scopeAvailability?.model?.available === true
      && discovered.value.transport?.rate?.burst
        === COMPANION_TRANSPORT_LIMITS.requestBurst
      && discovered.value.transport?.rate?.requestsPerMinute
        === COMPANION_TRANSPORT_LIMITS.requestsPerMinute
      && jsonEqual(
        sorted(discovered.value.nodes?.map((node) => node.type) ?? []),
        sorted(EVALUATED_NODE_TYPES),
      )
      && discovered.value.nodes?.every((node) =>
        Array.isArray(node.inputs)
        && Array.isArray(node.outputs)
        && Array.isArray(node.params)
        && node.traits?.agentExecution?.available === true),
    'Capability discovery did not authorize the evaluated node contracts.',
  );

  const initial = await readDocument(
    {
      include: ['frame', 'layers', 'nodes', 'edges', 'positions'],
    },
    'initial eval document',
  );
  currentRevision = initial.revision;
  const initiallyVisible = (initial.layers ?? [])
    .filter((layer) => layer?.visible === true)
    .map((layer) => layer.id);
  if (initiallyVisible.length > 0) {
    await applyTransaction({
      requestId: 'agent_eval_isolate_initial_v1',
      expectedRevision: currentRevision,
      commands: initiallyVisible.map((layerId) => ({
        op: 'update_layer',
        layerId,
        patch: { visible: false },
      })),
    }, 'initial layer isolation');
  }

  let typographyLayerId;
  await runScenario('typography_chain', async () => {
    const request = {
      requestId: 'agent_eval_typography_v1',
      expectedRevision: currentRevision,
      commands: [
        { op: 'set_frame', width: 512, height: 384 },
        {
          op: 'add_layer',
          clientRef: 'typography_layer',
          name: 'Agent Eval Typography',
        },
        {
          op: 'add_node',
          layerId: clientRef('typography_layer'),
          clientRef: 'typography_text',
          nodeType: 'Text',
          params: {
            content: 'AGENT READY',
            fontSize: 68,
            fill: '#20104f',
            weight: 700,
          },
        },
        {
          op: 'add_node',
          layerId: clientRef('typography_layer'),
          clientRef: 'typography_outline',
          nodeType: 'Outline',
        },
        {
          op: 'add_node',
          layerId: clientRef('typography_layer'),
          clientRef: 'typography_warp',
          nodeType: 'Warp',
          params: {
            axis: 'y',
            amplitude: 28,
            wavelength: 260,
            phase: 0.35,
          },
        },
        {
          op: 'add_node',
          layerId: clientRef('typography_layer'),
          clientRef: 'typography_raster',
          nodeType: 'Rasterize',
        },
        {
          op: 'add_node',
          layerId: clientRef('typography_layer'),
          clientRef: 'typography_recolor',
          nodeType: 'Recolor',
          params: { dark: '#32145f', light: '#ffb45c' },
        },
        {
          op: 'connect',
          layerId: clientRef('typography_layer'),
          from: {
            nodeId: clientRef('typography_text'),
            socket: 'out',
          },
          to: {
            nodeId: clientRef('typography_outline'),
            socket: 'text',
          },
        },
        {
          op: 'connect',
          layerId: clientRef('typography_layer'),
          from: {
            nodeId: clientRef('typography_outline'),
            socket: 'out',
          },
          to: {
            nodeId: clientRef('typography_warp'),
            socket: 'in',
          },
        },
        {
          op: 'connect',
          layerId: clientRef('typography_layer'),
          from: {
            nodeId: clientRef('typography_warp'),
            socket: 'out',
          },
          to: {
            nodeId: clientRef('typography_raster'),
            socket: 'vector',
          },
        },
        {
          op: 'connect',
          layerId: clientRef('typography_layer'),
          from: {
            nodeId: clientRef('typography_raster'),
            socket: 'out',
          },
          to: {
            nodeId: clientRef('typography_recolor'),
            socket: 'in',
          },
        },
        {
          op: 'connect',
          layerId: clientRef('typography_layer'),
          from: {
            nodeId: clientRef('typography_recolor'),
            socket: 'out',
          },
          to: { nodeId: 'out', socket: 'in' },
        },
        {
          op: 'auto_layout_graph',
          layerId: clientRef('typography_layer'),
          direction: 'LR',
        },
      ],
    };
    const applied = await applyTransaction(request, 'typography transaction');
    typographyLayerId = applied.created.typography_layer;
    invariant(
      typeof typographyLayerId === 'string',
      'Typography transaction omitted its layer ID.',
    );
    await validateCurrent('typography validation');
    const rendered = await awaitExactRender(
      currentRevision,
      'complete',
      'typography render',
    );
    const document = await readDocument(
      {
        revision: currentRevision,
        layerIds: [typographyLayerId],
        include: ['frame', 'layers', 'nodes', 'edges'],
      },
      'typography document',
    );
    assertCreativeGolden(
      document,
      typographyLayerId,
      'typography_chain',
      {
        Text: {
          content: 'AGENT READY',
          fontSize: 68,
          fill: '#20104f',
          weight: 700,
        },
        Warp: {
          axis: 'y',
          amplitude: 28,
          wavelength: 260,
          phase: 0.35,
        },
        Recolor: { dark: '#32145f', light: '#ffb45c' },
        Output: { transparent: true },
      },
    );
    await captureCreativePreview(
      'typography_chain',
      rendered,
      golden.creativeScenarios.typography_chain,
    );
  });
  await hideLayers(
    [typographyLayerId],
    'agent_eval_hide_typography_v1',
  );

  let circularLayerId;
  await runScenario('circular_type', async () => {
    const request = {
      requestId: 'agent_eval_circular_v1',
      expectedRevision: currentRevision,
      commands: [
        {
          op: 'add_layer',
          clientRef: 'circular_layer',
          name: 'Agent Eval Circular Type',
        },
        {
          op: 'add_node',
          layerId: clientRef('circular_layer'),
          clientRef: 'circular_text',
          nodeType: 'Text',
          params: {
            content: 'CIRCULAR AGENT',
            fontSize: 48,
            fill: '#172554',
            weight: 600,
          },
        },
        {
          op: 'add_node',
          layerId: clientRef('circular_layer'),
          clientRef: 'circular_split',
          nodeType: 'Split',
          params: { by: 'characters' },
        },
        {
          op: 'add_node',
          layerId: clientRef('circular_layer'),
          clientRef: 'circular_function',
          nodeType: 'Function',
          params: { fn: 'circle', gap: 52, radius: 122 },
        },
        {
          op: 'add_node',
          layerId: clientRef('circular_layer'),
          clientRef: 'circular_place',
          nodeType: 'Place',
          params: { distribute: 'spread' },
        },
        {
          op: 'connect',
          layerId: clientRef('circular_layer'),
          from: { nodeId: clientRef('circular_text'), socket: 'out' },
          to: { nodeId: clientRef('circular_split'), socket: 'text' },
        },
        {
          op: 'connect',
          layerId: clientRef('circular_layer'),
          from: { nodeId: clientRef('circular_split'), socket: 'out' },
          to: {
            nodeId: clientRef('circular_place'),
            socket: 'elements',
          },
        },
        {
          op: 'connect',
          layerId: clientRef('circular_layer'),
          from: {
            nodeId: clientRef('circular_function'),
            socket: 'out',
          },
          to: {
            nodeId: clientRef('circular_place'),
            socket: 'layout',
          },
        },
        {
          op: 'connect',
          layerId: clientRef('circular_layer'),
          from: { nodeId: clientRef('circular_place'), socket: 'out' },
          to: { nodeId: 'out', socket: 'in' },
        },
        {
          op: 'auto_layout_graph',
          layerId: clientRef('circular_layer'),
          direction: 'LR',
        },
      ],
    };
    const applied = await applyTransaction(request, 'circular transaction');
    circularLayerId = applied.created.circular_layer;
    invariant(
      typeof circularLayerId === 'string',
      'Circular transaction omitted its layer ID.',
    );
    await validateCurrent('circular validation');
    const rendered = await awaitExactRender(
      currentRevision,
      'complete',
      'circular render',
    );
    const document = await readDocument(
      {
        revision: currentRevision,
        layerIds: [circularLayerId],
        include: ['frame', 'layers', 'nodes', 'edges'],
      },
      'circular document',
    );
    assertCreativeGolden(
      document,
      circularLayerId,
      'circular_type',
      {
        Text: {
          content: 'CIRCULAR AGENT',
          fontSize: 48,
          fill: '#172554',
          weight: 600,
        },
        Split: { by: 'characters' },
        Function: { fn: 'circle', gap: 52, radius: 122 },
        Place: { distribute: 'spread' },
      },
    );
    await captureCreativePreview(
      'circular_type',
      rendered,
      golden.creativeScenarios.circular_type,
    );
  });
  await hideLayers([circularLayerId], 'agent_eval_hide_circular_v1');

  let maskAssetId;
  let scatterLayerId;
  await runScenario('masked_scatter', async () => {
    maskAssetId = await uploadMaskAsset();
    invariant(
      maskAssetId === `asset_${PNG_ASSET_SHA256}`,
      'Uploaded mask did not receive its content-addressed ID.',
    );
    const request = {
      requestId: 'agent_eval_masked_scatter_v1',
      expectedRevision: currentRevision,
      commands: [
        {
          op: 'add_layer',
          clientRef: 'scatter_layer',
          name: 'Agent Eval Masked Scatter',
        },
        {
          op: 'add_node',
          layerId: clientRef('scatter_layer'),
          clientRef: 'scatter_image',
          nodeType: 'Image',
          params: { assetId: maskAssetId, fit: 'contain' },
        },
        {
          op: 'add_node',
          layerId: clientRef('scatter_layer'),
          clientRef: 'scatter_grid',
          nodeType: 'Grid',
          params: {
            columns: 6,
            rows: 4,
            gapX: 12,
            gapY: 12,
            padX: 50,
            padY: 50,
          },
        },
        {
          op: 'add_node',
          layerId: clientRef('scatter_layer'),
          clientRef: 'scatter_random',
          nodeType: 'Random',
          params: {
            offset: 18,
            rotate: 0.45,
            scaleJitter: 0.25,
            seed: 31,
          },
        },
        {
          op: 'add_node',
          layerId: clientRef('scatter_layer'),
          clientRef: 'scatter_shape',
          nodeType: 'Shape',
          params: {
            kind: 'ellipse',
            width: 34,
            height: 34,
            fill: '#e11d48',
          },
        },
        {
          op: 'add_node',
          layerId: clientRef('scatter_layer'),
          clientRef: 'scatter_duplicator',
          nodeType: 'Duplicator',
          params: { count: 24 },
        },
        {
          op: 'add_node',
          layerId: clientRef('scatter_layer'),
          clientRef: 'scatter_place',
          nodeType: 'Place',
          params: { distribute: 'by-order' },
        },
        {
          op: 'connect',
          layerId: clientRef('scatter_layer'),
          from: { nodeId: clientRef('scatter_image'), socket: 'out' },
          to: { nodeId: clientRef('scatter_grid'), socket: 'mask' },
        },
        {
          op: 'connect',
          layerId: clientRef('scatter_layer'),
          from: { nodeId: clientRef('scatter_grid'), socket: 'out' },
          to: { nodeId: clientRef('scatter_random'), socket: 'layout' },
        },
        {
          op: 'connect',
          layerId: clientRef('scatter_layer'),
          from: { nodeId: clientRef('scatter_image'), socket: 'out' },
          to: { nodeId: clientRef('scatter_random'), socket: 'mask' },
        },
        {
          op: 'connect',
          layerId: clientRef('scatter_layer'),
          from: { nodeId: clientRef('scatter_shape'), socket: 'out' },
          to: {
            nodeId: clientRef('scatter_duplicator'),
            socket: 'in',
          },
        },
        {
          op: 'connect',
          layerId: clientRef('scatter_layer'),
          from: {
            nodeId: clientRef('scatter_duplicator'),
            socket: 'out',
          },
          to: {
            nodeId: clientRef('scatter_place'),
            socket: 'elements',
          },
        },
        {
          op: 'connect',
          layerId: clientRef('scatter_layer'),
          from: { nodeId: clientRef('scatter_random'), socket: 'out' },
          to: { nodeId: clientRef('scatter_place'), socket: 'layout' },
        },
        {
          op: 'connect',
          layerId: clientRef('scatter_layer'),
          from: { nodeId: clientRef('scatter_place'), socket: 'out' },
          to: { nodeId: 'out', socket: 'in' },
        },
        {
          op: 'auto_layout_graph',
          layerId: clientRef('scatter_layer'),
          direction: 'LR',
        },
      ],
    };
    const applied = await applyTransaction(request, 'masked scatter transaction');
    scatterLayerId = applied.created.scatter_layer;
    invariant(
      typeof scatterLayerId === 'string',
      'Masked scatter transaction omitted its layer ID.',
    );
    await validateCurrent('masked scatter validation');
    const rendered = await awaitExactRender(
      currentRevision,
      'complete',
      'masked scatter render',
    );
    const document = await readDocument(
      {
        revision: currentRevision,
        layerIds: [scatterLayerId],
        include: ['frame', 'layers', 'nodes', 'edges'],
      },
      'masked scatter document',
    );
    const layer = assertCreativeGolden(
      document,
      scatterLayerId,
      'masked_scatter',
      {
        Image: { assetId: maskAssetId, fit: 'contain' },
        Grid: {
          columns: 6,
          rows: 4,
          gapX: 12,
          gapY: 12,
          padX: 50,
          padY: 50,
        },
        Random: {
          offset: 18,
          rotate: 0.45,
          scaleJitter: 0.25,
          seed: 31,
        },
        Shape: {
          kind: 'ellipse',
          width: 34,
          height: 34,
          fill: '#e11d48',
        },
        Duplicator: { count: 24 },
        Place: { distribute: 'by-order' },
        Output: { transparent: true },
      },
    );
    const imageNode = layer.graph.nodes.find((node) => node.type === 'Image');
    const metadata = await callSuccess(
      activeScenario,
      'gfx_get_asset_metadata',
      { assetId: maskAssetId },
      'masked scatter asset metadata',
    );
    invariant(
      metadata.value.metadata?.id === maskAssetId
        && metadata.value.metadata?.sha256 === PNG_ASSET_SHA256
        && metadata.value.availability === 'available'
        && metadata.value.referenceCount === 1
        && metadata.value.references?.length === 1
        && metadata.value.references[0].layerId === scatterLayerId
        && metadata.value.references[0].nodeId === imageNode?.id,
      'Masked scatter asset metadata did not report its exact graph reference.',
    );
    await captureCreativePreview(
      'masked_scatter',
      rendered,
      golden.creativeScenarios.masked_scatter,
    );
  });
  await hideLayers([scatterLayerId], 'agent_eval_hide_scatter_v1');

  let recoveredHumanLayerId;
  let humanCreatedLayerId;
  await runScenario('human_edit_conflict', async () => {
    const observed = await readDocument(
      {
        include: ['frame', 'layers', 'nodes', 'edges'],
      },
      'pre-human observation',
    );
    const staleRevision = observed.revision;
    const diagnosticStart = stderrText.length;
    const childPid = transport.pid;
    invariant(childPid, 'The eval child PID is unavailable.');
    process.kill(childPid, 'SIGUSR2');
    const humanDiagnostic = await waitForDiagnostic(
      /HUMAN_EDIT_COMPLETE:([A-Za-z0-9_-]+)/u,
      diagnosticStart,
    );
    humanCreatedLayerId = humanDiagnostic[1];
    const staleRequest = {
      requestId: 'agent_eval_human_stale_v1',
      expectedRevision: staleRevision,
      commands: [
        {
          op: 'add_layer',
          clientRef: 'stale_agent_layer',
          name: 'Stale Agent Plan',
        },
      ],
    };
    const staleCall = await callTool(
      'gfx_apply_transaction',
      staleRequest,
    );
    const stale = failedOutcome(
      staleCall.result,
      'stale human-edit plan',
      golden.recoveryScenarios.human_edit_conflict.errorCode,
    );
    invariant(
      stale.revision === staleRevision + 1
        && stale.requestId === staleRequest.requestId
        && stale.error?.details?.expectedRevision === staleRevision
        && stale.error?.details?.currentRevision === stale.revision
        && /new requestId/iu.test(stale.error?.suggestedFix ?? ''),
      'Human edit conflict omitted bounded recovery guidance.',
    );
    revisionConflicts += 1;
    currentRevision = stale.revision;
    const refreshed = await readDocument(
      {
        revision: currentRevision,
        include: ['frame', 'layers', 'nodes', 'edges'],
      },
      'post-human refresh',
    );
    const humanLayerBefore = layerFromSnapshot(
      refreshed,
      humanCreatedLayerId,
      'human-created document',
    );
    invariant(
      !(refreshed.layers ?? []).some(
        (layer) => layer?.name === 'Stale Agent Plan',
      ),
      'Rejected stale transaction changed the document.',
    );
    const recoveryRequest = {
      requestId: 'agent_eval_human_replan_v1',
      expectedRevision: currentRevision,
      commands: [
        {
          op: 'add_layer',
          clientRef: 'human_recovery_layer',
          name: 'Fresh Agent Replan',
        },
      ],
    };
    const recovered = await applyTransaction(
      recoveryRequest,
      'fresh human-edit replan',
    );
    recoveredHumanLayerId = recovered.created.human_recovery_layer;
    invariant(
      typeof recoveredHumanLayerId === 'string',
      'Fresh human-edit replan omitted its created layer.',
    );
    const after = await readDocument(
      {
        revision: currentRevision,
        include: ['frame', 'layers', 'nodes', 'edges'],
      },
      'post-replan document',
    );
    const humanLayerAfter = layerFromSnapshot(
      after,
      humanCreatedLayerId,
      'preserved human layer',
    );
    invariant(
      jsonEqual(humanLayerAfter, humanLayerBefore),
      'Fresh Agent replan changed the human-created layer.',
    );
    layerFromSnapshot(after, recoveredHumanLayerId, 'fresh Agent layer');
    successfulRecoveries += 1;
  });
  await hideLayers(
    [humanCreatedLayerId, recoveredHumanLayerId],
    'agent_eval_hide_human_recovery_v1',
  );

  let correctedPlanLayerId;
  await runScenario('bad_plan_recovery', async () => {
    const badRevision = currentRevision;
    const badRequest = {
      requestId: 'agent_eval_bad_plan_v1',
      expectedRevision: badRevision,
      commands: [
        {
          op: 'add_layer',
          clientRef: 'bad_plan_layer',
          name: 'Rejected Raster Vector Plan',
        },
        {
          op: 'add_node',
          layerId: clientRef('bad_plan_layer'),
          clientRef: 'bad_image',
          nodeType: 'Image',
          params: { assetId: maskAssetId },
        },
        {
          op: 'add_node',
          layerId: clientRef('bad_plan_layer'),
          clientRef: 'bad_warp',
          nodeType: 'Warp',
        },
        {
          op: 'connect',
          layerId: clientRef('bad_plan_layer'),
          from: { nodeId: clientRef('bad_image'), socket: 'out' },
          to: { nodeId: clientRef('bad_warp'), socket: 'in' },
        },
      ],
    };
    const rejectedCall = await callTool(
      'gfx_apply_transaction',
      badRequest,
    );
    const rejected = failedOutcome(
      rejectedCall.result,
      'raster-to-vector bad plan',
      golden.recoveryScenarios.bad_plan_recovery.errorCode,
    );
    const expectedBad = golden.recoveryScenarios.bad_plan_recovery;
    invariant(
      rejected.revision === badRevision
        && rejected.requestId === badRequest.requestId
        && jsonEqual(
          rejected.error?.details?.source?.types,
          expectedBad.sourceTypes,
        )
        && jsonEqual(
          rejected.error?.details?.target?.types,
          expectedBad.targetTypes,
        )
        && rejected.error?.details?.requiredConversion?.nodeType
          === expectedBad.requiredConversion
        && rejected.error?.details?.requiredConversion?.inputSocket === 'in'
        && rejected.error?.details?.requiredConversion?.outputSocket === 'out'
        && /Trace\.in/iu.test(rejected.error?.suggestedFix ?? '')
        && /Trace\.out/iu.test(rejected.error?.suggestedFix ?? '')
        && /new requestId/iu.test(rejected.error?.suggestedFix ?? ''),
      'TYPE_MISMATCH did not explain the explicit Trace conversion.',
    );
    invalidPlans += 1;
    const afterRejected = await readDocument(
      {
        revision: currentRevision,
        include: ['layers', 'nodes', 'edges'],
      },
      'post-bad-plan document',
    );
    invariant(
      afterRejected.revision === badRevision
        && !(afterRejected.layers ?? []).some(
          (layer) => layer?.name === 'Rejected Raster Vector Plan',
        ),
      'Rejected type plan mutated the document.',
    );
    const correctedRequest = {
      requestId: 'agent_eval_bad_plan_corrected_v1',
      expectedRevision: currentRevision,
      commands: [
        {
          op: 'add_layer',
          clientRef: 'corrected_plan_layer',
          name: 'Corrected Trace Plan',
        },
        {
          op: 'add_node',
          layerId: clientRef('corrected_plan_layer'),
          clientRef: 'corrected_image',
          nodeType: 'Image',
          params: { assetId: maskAssetId },
        },
        {
          op: 'add_node',
          layerId: clientRef('corrected_plan_layer'),
          clientRef: 'corrected_trace',
          nodeType: 'Trace',
          params: {
            method: 'fill',
            smoothness: 1,
            minArea: 1,
            ignoreLight: 'yes',
          },
        },
        {
          op: 'add_node',
          layerId: clientRef('corrected_plan_layer'),
          clientRef: 'corrected_warp',
          nodeType: 'Warp',
          params: { amplitude: 12, wavelength: 220 },
        },
        {
          op: 'add_node',
          layerId: clientRef('corrected_plan_layer'),
          clientRef: 'corrected_raster',
          nodeType: 'Rasterize',
        },
        {
          op: 'connect',
          layerId: clientRef('corrected_plan_layer'),
          from: { nodeId: clientRef('corrected_image'), socket: 'out' },
          to: { nodeId: clientRef('corrected_trace'), socket: 'in' },
        },
        {
          op: 'connect',
          layerId: clientRef('corrected_plan_layer'),
          from: { nodeId: clientRef('corrected_trace'), socket: 'out' },
          to: { nodeId: clientRef('corrected_warp'), socket: 'in' },
        },
        {
          op: 'connect',
          layerId: clientRef('corrected_plan_layer'),
          from: { nodeId: clientRef('corrected_warp'), socket: 'out' },
          to: {
            nodeId: clientRef('corrected_raster'),
            socket: 'vector',
          },
        },
        {
          op: 'connect',
          layerId: clientRef('corrected_plan_layer'),
          from: { nodeId: clientRef('corrected_raster'), socket: 'out' },
          to: { nodeId: 'out', socket: 'in' },
        },
        {
          op: 'auto_layout_graph',
          layerId: clientRef('corrected_plan_layer'),
          direction: 'LR',
        },
      ],
    };
    const corrected = await applyTransaction(
      correctedRequest,
      'corrected Trace transaction',
    );
    correctedPlanLayerId = corrected.created.corrected_plan_layer;
    const correctedDocument = await readDocument(
      {
        revision: currentRevision,
        layerIds: [correctedPlanLayerId],
        include: ['layers', 'nodes', 'edges'],
      },
      'corrected Trace document',
    );
    const correctedTopology = normalizedTopology(layerFromSnapshot(
      correctedDocument,
      correctedPlanLayerId,
      'corrected Trace layer',
    ));
    for (const edge of [
      'Image.out->Trace.in',
      'Trace.out->Warp.in',
      'Warp.out->Rasterize.vector',
      'Rasterize.out->Output.in',
    ]) {
      invariant(
        correctedTopology.edges.includes(edge),
        `Corrected plan omitted ${edge}.`,
      );
    }
    await validateCurrent('corrected Trace validation');
    await awaitExactRender(
      currentRevision,
      'complete',
      'corrected Trace render',
    );
    successfulRecoveries += 1;
  });
  await hideLayers(
    [correctedPlanLayerId],
    'agent_eval_hide_corrected_plan_v1',
  );

  await runScenario('render_failure_recovery', async () => {
    const failureRequest = {
      requestId: 'agent_eval_render_failure_v1',
      expectedRevision: currentRevision,
      commands: [
        {
          op: 'add_layer',
          clientRef: 'render_failure_layer',
          name: 'Expected Remove Background Failure',
        },
        {
          op: 'add_node',
          layerId: clientRef('render_failure_layer'),
          clientRef: 'render_failure_image',
          nodeType: 'Image',
          params: { assetId: maskAssetId },
        },
        {
          op: 'add_node',
          layerId: clientRef('render_failure_layer'),
          clientRef: 'render_failure_remove_bg',
          nodeType: 'RemoveBackground',
        },
        {
          op: 'connect',
          layerId: clientRef('render_failure_layer'),
          from: {
            nodeId: clientRef('render_failure_image'),
            socket: 'out',
          },
          to: {
            nodeId: clientRef('render_failure_remove_bg'),
            socket: 'in',
          },
        },
        {
          op: 'connect',
          layerId: clientRef('render_failure_layer'),
          from: {
            nodeId: clientRef('render_failure_remove_bg'),
            socket: 'out',
          },
          to: { nodeId: 'out', socket: 'in' },
        },
        {
          op: 'auto_layout_graph',
          layerId: clientRef('render_failure_layer'),
          direction: 'LR',
        },
      ],
    };
    const failedTransaction = await applyTransaction(
      failureRequest,
      'RemoveBackground failure transaction',
    );
    const failureLayerId = failedTransaction.created.render_failure_layer;
    const failedRender = await awaitExactRender(
      currentRevision,
      golden.recoveryScenarios.render_failure_recovery.state,
      'RemoveBackground failed render',
    );
    const expectedFailure =
      golden.recoveryScenarios.render_failure_recovery;
    invariant(
      failedRender.error?.nodeType === expectedFailure.nodeType
        && failedRender.error?.phase === expectedFailure.phase
        && failedRender.error?.revision === currentRevision
        && failedRender.error?.attempt === failedRender.ticket.attempt
        && failedRender.error?.recoverable === true
        && /gfx_revert_transaction/iu.test(
          failedRender.error?.suggestedFix ?? '',
        )
        && /new requestId/iu.test(
          failedRender.error?.suggestedFix ?? '',
        ),
      'RemoveBackground failure omitted exact bounded recovery evidence.',
    );
    await waitForDiagnostic('MODEL_ROUTE_SEEN');
    const failedRevision = currentRevision;
    const revertRequest = {
      requestId: 'agent_eval_render_failure_revert_v1',
      expectedRevision: failedRevision,
      transactionId: failedTransaction.transactionId,
    };
    const revertedCall = await callSuccess(
      activeScenario,
      'gfx_revert_transaction',
      revertRequest,
      'RemoveBackground transaction revert',
    );
    strictCommit(
      revertedCall.value,
      revertRequest,
      failedRevision,
      'RemoveBackground transaction revert',
    );
    currentRevision = revertedCall.value.revision;
    await awaitExactRender(
      currentRevision,
      'complete',
      'post-revert render',
    );
    const afterRevert = await readDocument(
      {
        revision: currentRevision,
        include: ['layers', 'nodes', 'edges'],
      },
      'post-render-failure document',
    );
    invariant(
      !(afterRevert.layers ?? []).some(
        (layer) => layer?.id === failureLayerId,
      ),
      'Render-failure revert left the responsible layer behind.',
    );
    await validateCurrent('post-render-failure validation');
    successfulRecoveries += 1;
  });

  await runScenario('timed_out_retry', async () => {
    const retryRevision = currentRevision;
    const retryRequest = {
      requestId: 'agent_eval_retry_v1',
      expectedRevision: retryRevision,
      commands: [
        {
          op: 'add_layer',
          clientRef: 'retry_layer',
          name: 'Timed-out Agent Retry',
        },
        {
          op: 'add_node',
          layerId: clientRef('retry_layer'),
          clientRef: 'retry_text',
          nodeType: 'Text',
          params: {
            content: 'RETRY ONCE',
            fontSize: 64,
            fill: '#0f172a',
          },
        },
        {
          op: 'add_node',
          layerId: clientRef('retry_layer'),
          clientRef: 'retry_split',
          nodeType: 'Split',
          params: { by: 'words' },
        },
        {
          op: 'connect',
          layerId: clientRef('retry_layer'),
          from: { nodeId: clientRef('retry_text'), socket: 'out' },
          to: { nodeId: clientRef('retry_split'), socket: 'text' },
        },
        {
          op: 'connect',
          layerId: clientRef('retry_layer'),
          from: { nodeId: clientRef('retry_split'), socket: 'out' },
          to: { nodeId: 'out', socket: 'in' },
        },
        {
          op: 'auto_layout_graph',
          layerId: clientRef('retry_layer'),
          direction: 'LR',
        },
      ],
    };
    const retryDiagnosticStart = stderrText.length;
    let timedOut = false;
    const timeoutStarted = performance.now();
    try {
      await callTool(
        'gfx_apply_transaction',
        retryRequest,
        {
          timeoutMs:
            golden.recoveryScenarios.timed_out_retry.clientTimeoutMs,
        },
      );
    } catch (error) {
      timedOut = isRequestTimeout(error);
    }
    const timeoutElapsed = performance.now() - timeoutStarted;
    invariant(
      timedOut
        && timeoutElapsed
          >= golden.recoveryScenarios.timed_out_retry.clientTimeoutMs - 5,
      'Official MCP client did not observe the deliberate 25ms timeout.',
    );
    timedOutRetries += 1;
    await waitForDiagnostic(
      'RETRY_COMMITTED',
      retryDiagnosticStart,
    );
    // Let the delayed first MCP handler finish before requesting its replay.
    await new Promise((resolveWait) => setTimeout(resolveWait, 280));
    const replayedCall = await callSuccess(
      activeScenario,
      'gfx_apply_transaction',
      retryRequest,
      'timed-out request replay',
    );
    const replayed = strictCommit(
      replayedCall.value,
      retryRequest,
      retryRevision,
      'timed-out request replay',
    );
    currentRevision = replayed.revision;
    retries += 1;
    const retryLayerId = replayed.created.retry_layer;
    const retryDocument = await readDocument(
      {
        revision: currentRevision,
        include: ['layers', 'nodes', 'edges'],
      },
      'timed-out replay document',
    );
    const matchingLayers = (retryDocument.layers ?? []).filter(
      (layer) => layer?.id === retryLayerId,
    );
    invariant(
      matchingLayers.length === 1
        && replayed.createdEntities?.retry_layer?.kind === 'layer'
        && replayed.createdEntities?.retry_layer?.id === retryLayerId
        && replayed.createdEntities?.retry_text?.layerId === retryLayerId
        && replayed.createdEntities?.retry_split?.layerId === retryLayerId,
      'Timed-out replay did not return the original created identities.',
    );
    const retryLayer = matchingLayers[0];
    const retryNodes = new Set(
      retryLayer.graph.nodes.map((node) => node.id),
    );
    invariant(
      retryNodes.has(replayed.created.retry_text)
        && retryNodes.has(replayed.created.retry_split)
        && retryLayer.graph.nodes.length === 3,
      'Timed-out replay allocated duplicate nodes or returned stale IDs.',
    );
    await validateCurrent('timed-out replay validation');
    await awaitExactRender(
      currentRevision,
      'complete',
      'timed-out replay render',
    );
    successfulRecoveries += 1;
  });

  invariant(
    scenarioReports.length === golden.metricRequirements.scenarioCount,
    'Agent evaluation did not execute all golden scenarios.',
  );
  invariant(
    successfulRecoveries
      === golden.metricRequirements.successfulRecoveries,
    'Agent evaluation recovery count diverged from the golden.',
  );
  invariant(
    invalidPlans === golden.metricRequirements.expectedInvalidPlans,
    'Agent evaluation invalid-plan count diverged from the golden.',
  );
  invariant(
    revisionConflicts
      === golden.metricRequirements.expectedRevisionConflicts,
    'Agent evaluation conflict count diverged from the golden.',
  );
  invariant(
    timedOutRetries
      === golden.metricRequirements.expectedTimedOutRetries,
    'Agent evaluation timeout-retry count diverged from the golden.',
  );
  invariant(
    previewArtifacts.length === 3,
    'Agent evaluation did not emit all creative PNG artifacts.',
  );
  invariant(
    !stderrText.includes('CONTROL_ERROR')
      && protocolErrors.length === 0,
    'The Agent evaluation transport reported a protocol/control failure.',
  );
} catch (error) {
  runFailure = error;
} finally {
  await mcpClient.close().catch((error) => {
    runFailure ??= error;
  });
}

const finalStderr = Buffer.concat(stderrChunks).toString('utf8');
if (
  /pageerror:|console\.error:|CONTROL_ERROR/u.test(finalStderr)
  && !runFailure
) {
  runFailure = new Error(
    'The Agent evaluation browser reported an unexpected runtime error.',
  );
}
if (protocolErrors.length > 0 && !runFailure) {
  runFailure = new Error(
    'The Agent evaluation MCP client observed a protocol error.',
  );
}

const suiteCompletedAt = new Date().toISOString();
const metrics = {
  schemaVersion: 1,
  suite: 'gfx-agent-eval-v1',
  status: runFailure ? 'failed' : 'passed',
  goldenSchemaVersion: golden.schemaVersion,
  startedAt: suiteStartedAt,
  completedAt: suiteCompletedAt,
  durationMs: roundMilliseconds(performance.now() - suiteStartedClock),
  scenarioCount: scenarioReports.length,
  toolCalls: traceEntries.length,
  invalidPlans,
  revisionConflicts,
  retries,
  timedOutRetries,
  successfulRecoveries,
  renderLatencyMs: latencySummary(renderLatencies),
  scenarios: scenarioReports,
  previews: previewArtifacts,
  evidencePolicy: {
    rawToolArgumentsStored: false,
    rawToolResultsStored: false,
    assetBytesStoredInTrace: false,
    previewBase64StoredInTrace: false,
    pairingCredentialsStored: false,
    childStderrStored: false,
  },
  ...(runFailure
    ? {
        failure: {
          name: runFailure instanceof Error
            ? runFailure.name
            : 'Error',
          message: safeFailureMessage(runFailure),
        },
      }
    : {}),
};
const trace = {
  schemaVersion: 1,
  suite: 'gfx-agent-eval-v1',
  redacted: true,
  fields:
    'scenario, tool, public requestId, duration, revision, public outcome',
  entries: traceEntries,
};
await writeFile(
  resolve(EVIDENCE_DIRECTORY, 'metrics.json'),
  `${JSON.stringify(metrics, null, 2)}\n`,
);
await writeFile(
  resolve(EVIDENCE_DIRECTORY, 'trace.json'),
  `${JSON.stringify(trace, null, 2)}\n`,
);

if (runFailure) throw runFailure;

process.stdout.write(
  `Agent eval passed: ${scenarioReports.length} scenarios, `
  + `${traceEntries.length} MCP tool calls, `
  + `${successfulRecoveries} verified recoveries, `
  + `${previewArtifacts.length} PNG artifacts.\n`,
);
