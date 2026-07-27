import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  COMPANION_TRANSPORT_LIMITS,
} from '../packages/mcp-companion/dist/protocol.js';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SERVER_ENTRY = resolve(
  REPOSITORY_ROOT,
  'packages/mcp-companion/dist/index.js',
);
// Production browser navigation is bounded at 20 seconds. Keep the hosted
// runner lifecycle probe on the same bound so a cold Chrome start is not
// mistaken for a stdio failure.
const LIFECYCLE_WAIT_MS = 20_000;
const READ_TOOLS = Object.freeze([
  'gfx_get_capabilities',
  'gfx_get_document',
  'gfx_get_render_status',
  'gfx_validate_document',
  'gfx_await_render',
  'gfx_capture_preview',
]);
const EDIT_TOOLS = Object.freeze([
  'gfx_get_capabilities',
  'gfx_get_document',
  'gfx_get_render_status',
  'gfx_validate_document',
  'gfx_apply_transaction',
  'gfx_await_render',
  'gfx_capture_preview',
  'gfx_revert_transaction',
]);
const ASSET_TOOLS = Object.freeze([
  'gfx_get_capabilities',
  'gfx_get_document',
  'gfx_get_render_status',
  'gfx_validate_document',
  'gfx_put_asset',
  'gfx_list_assets',
  'gfx_get_asset_metadata',
  'gfx_remove_asset',
  'gfx_await_render',
  'gfx_capture_preview',
]);
const EDIT_ASSET_TOOLS = Object.freeze([
  'gfx_get_capabilities',
  'gfx_get_document',
  'gfx_get_render_status',
  'gfx_validate_document',
  'gfx_apply_transaction',
  'gfx_put_asset',
  'gfx_list_assets',
  'gfx_get_asset_metadata',
  'gfx_remove_asset',
  'gfx_await_render',
  'gfx_capture_preview',
  'gfx_revert_transaction',
]);

function withModel(tools) {
  const insertion = tools.indexOf('gfx_validate_document') + 1;
  return Object.freeze([
    ...tools.slice(0, insertion),
    'gfx_get_model_status',
    'gfx_prepare_model',
    ...tools.slice(insertion),
  ]);
}

const MODEL_TOOLS = withModel(READ_TOOLS);
const EDIT_MODEL_TOOLS = withModel(EDIT_TOOLS);
const ASSET_MODEL_TOOLS = withModel(ASSET_TOOLS);
const EDIT_ASSET_MODEL_TOOLS = withModel(EDIT_ASSET_TOOLS);

function portIsListening() {
  return new Promise((resolveListening) => {
    const socket = connect(5199, '127.0.0.1');
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveListening(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForProcessExit(child, description) {
  return new Promise((resolveExit, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${description}.`));
    }, 12_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolveExit({ code, signal });
    });
  });
}

async function runRedactionRegressions() {
  const cliSecret = 'CLI_SECRET_MUST_NOT_ESCAPE';
  const rejectedArgument =
    `--bad=data:image/png;base64,${cliSecret}`;
  const rejected = spawn(
    process.execPath,
    [SERVER_ENTRY, rejectedArgument],
    {
      cwd: REPOSITORY_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const rejectedStdout = [];
  const rejectedStderr = [];
  rejected.stdout.on('data', (chunk) =>
    rejectedStdout.push(Buffer.from(chunk)));
  rejected.stderr.on('data', (chunk) =>
    rejectedStderr.push(Buffer.from(chunk)));
  const rejectedExit = await waitForProcessExit(
    rejected,
    'the redacted invalid-CLI process to exit',
  );
  const rejectedOutput = Buffer.concat(rejectedStdout).toString('utf8');
  const rejectedDiagnostics =
    Buffer.concat(rejectedStderr).toString('utf8');
  if (
    rejectedExit.code !== 1
    || rejectedOutput !== ''
    || rejectedOutput.includes(cliSecret)
    || rejectedDiagnostics.includes(cliSecret)
    || rejectedDiagnostics.includes(rejectedArgument)
  ) {
    throw new Error(
      'The production CLI exposed a rejected argument or secret.',
    );
  }

  if (await portIsListening()) {
    throw new Error('Port 5199 must be free before the stdio redaction gate.');
  }
  const stdinSecret = 'STDIN_SECRET_MUST_NOT_ESCAPE';
  let nested = `data:image/png;base64,${stdinSecret}`;
  for (
    let index = 0;
    index < COMPANION_TRANSPORT_LIMITS.maxJsonDepth + 16;
    index++
  ) nested = [nested];
  const invalidLine = `${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'secret_probe',
    params: { nested },
  })}\n`;
  const invalid = spawn(
    process.execPath,
    [SERVER_ENTRY, '--headless'],
    {
      cwd: REPOSITORY_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const invalidStdout = [];
  const invalidStderr = [];
  invalid.stdout.on('data', (chunk) =>
    invalidStdout.push(Buffer.from(chunk)));
  invalid.stderr.on('data', (chunk) =>
    invalidStderr.push(Buffer.from(chunk)));
  try {
    await waitFor(
      () => Buffer.concat(invalidStderr)
        .toString('utf8')
        .includes('local app host is listening on http://127.0.0.1:5199'),
      'the invalid-stdin companion to start',
    );
    invalid.stdin.end(invalidLine);
    const invalidExit = await waitForProcessExit(
      invalid,
      'the invalid-stdin companion to exit',
    );
    const output = Buffer.concat(invalidStdout).toString('utf8');
    const diagnostics = Buffer.concat(invalidStderr).toString('utf8');
    if (
      invalidExit.signal !== null
      || output.includes(stdinSecret)
      || diagnostics.includes(stdinSecret)
      || output.includes('data:image')
      || diagnostics.includes('data:image')
      || !diagnostics.includes('stdio rejected invalid input')
    ) {
      throw new Error(
        'The production stdio rejection exposed input content or lost its fixed diagnostic.',
      );
    }
  } catch (error) {
    invalid.kill('SIGTERM');
    throw error;
  }
  await waitFor(
    async () => !(await portIsListening()),
    'fixed port 5199 to be released after invalid stdin',
  );
}

async function waitFor(predicate, description) {
  const deadline = Date.now() + LIFECYCLE_WAIT_MS;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function toolOutcome(result) {
  const outcome = result.structuredContent?.outcome;
  if (!outcome || typeof outcome !== 'object') {
    throw new Error(
      `Missing structured MCP outcome: ${JSON.stringify(result)}`,
    );
  }
  return outcome;
}

async function runProfile({
  label,
  arguments_,
  expectedTools,
  expectedScopes,
}) {
  if (await portIsListening()) {
    throw new Error(`Port 5199 must be free before the ${label} stdio gate.`);
  }
  const stderrChunks = [];
  const protocolErrors = [];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY, '--headless', ...arguments_],
    cwd: REPOSITORY_ROOT,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk) => {
    stderrChunks.push(Buffer.from(chunk));
  });
  const client = new Client(
    { name: `pr6-real-stdio-${label}`, version: '1.0.0' },
    { capabilities: {} },
  );
  client.onerror = (error) => protocolErrors.push(error);
  let childPid = null;
  try {
    await client.connect(transport);
    childPid = transport.pid;
    if (!childPid || !processExists(childPid)) {
      throw new Error('The stdio transport did not expose a live server PID.');
    }
    if (!(await portIsListening())) {
      throw new Error('The compiled companion did not bind fixed port 5199.');
    }

    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    if (JSON.stringify(names) !== JSON.stringify(expectedTools)) {
      throw new Error(
        `${label} stdio profile exposed unexpected tools: ${
          JSON.stringify(names)
        }`,
      );
    }
    const unpaired = await client.callTool({
      name: 'gfx_get_document',
      arguments: {},
    });
    const outcome = toolOutcome(unpaired);
    if (
      !unpaired.isError
      || outcome.ok !== false
      || outcome.error?.code !== 'PAIRING_NOT_APPROVED'
    ) {
      throw new Error(
        `Unpaired stdio call did not fail structurally: ${
          JSON.stringify(outcome)
        }`,
      );
    }
    if (expectedTools.includes('gfx_put_asset')) {
      const unpairedAsset = await client.callTool({
        name: 'gfx_put_asset',
        arguments: {
          phase: 'begin',
          requestId: 'stdio_asset_begin',
          mimeType: 'image/png',
          byteLength: 1,
          sha256: '0'.repeat(64),
        },
      });
      const assetOutcome = toolOutcome(unpairedAsset);
      if (
        !unpairedAsset.isError
        || assetOutcome.ok !== false
        || assetOutcome.error?.code !== 'PAIRING_NOT_APPROVED'
      ) {
        throw new Error(
          `Unpaired asset call did not fail structurally: ${
            JSON.stringify(assetOutcome)
          }`,
        );
      }
    }
    if (expectedTools.includes('gfx_get_model_status')) {
      const modelStatus = await client.callTool({
        name: 'gfx_get_model_status',
        arguments: {},
      });
      const statusOutcome = toolOutcome(modelStatus);
      if (
        modelStatus.isError
        || statusOutcome.ok !== true
        || statusOutcome.value?.modelKey !== 'rmbg-1.4'
      ) {
        throw new Error(
          `Model status was not available locally: ${
            JSON.stringify(statusOutcome)
          }`,
        );
      }
      const prepareModel = await client.callTool({
        name: 'gfx_prepare_model',
        arguments: { requestId: `stdio_model_${label}` },
      });
      const prepareOutcome = toolOutcome(prepareModel);
      const accepted =
        prepareOutcome.ok === true
        && ['downloading', 'verifying', 'ready'].includes(
          prepareOutcome.value?.state,
        );
      const humanRequired =
        prepareModel.isError
        && prepareOutcome.ok === false
        && prepareOutcome.error?.code === 'MODEL_DOWNLOAD_REQUIRED'
        && prepareOutcome.error?.details?.reason
          === 'CONFIRMATION_REQUIRED';
      if (!accepted && !humanRequired) {
        throw new Error(
          `Agent model preparation escaped the human gate: ${
            JSON.stringify(prepareOutcome)
          }`,
        );
      }
    }
  } finally {
    await client.close().catch(() => undefined);
  }

  if (childPid) {
    await waitFor(
      () => !processExists(childPid),
      'the compiled companion process to exit after stdio EOF',
    );
  }
  await waitFor(
    async () => !(await portIsListening()),
    'fixed port 5199 to be released',
  );

  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  const diagnosticLines = stderr.split(/\r?\n/).filter(Boolean);
  if (
    !diagnosticLines.some((line) =>
      line.includes('local app host is listening on http://127.0.0.1:5199'))
    || !diagnosticLines.some((line) =>
      line.includes(
        `waiting for human approval of ${expectedScopes.join(', ')} scopes`,
      ))
    || !diagnosticLines.some((line) =>
      line.includes('shutting down (stdio EOF)'))
  ) {
    throw new Error(`Missing lifecycle diagnostics on stderr: ${stderr}`);
  }
  if (diagnosticLines.some((line) => !line.startsWith('[gfx-mcp] '))) {
    throw new Error(`Unexpected non-diagnostic stderr output: ${stderr}`);
  }
  if (protocolErrors.length > 0) {
    throw new Error(
      `The real stdio stream contained invalid protocol output: ${
        protocolErrors.map((error) => error.message).join(' | ')
      }`,
    );
  }
}

await runRedactionRegressions();

await runProfile({
  label: 'read-preview',
  arguments_: [],
  expectedTools: READ_TOOLS,
  expectedScopes: ['read', 'preview'],
});
await runProfile({
  label: 'edit',
  arguments_: ['--allow-edit'],
  expectedTools: EDIT_TOOLS,
  expectedScopes: ['read', 'preview', 'edit'],
});
await runProfile({
  label: 'assets',
  arguments_: ['--allow-assets'],
  expectedTools: ASSET_TOOLS,
  expectedScopes: ['read', 'preview', 'assets'],
});
await runProfile({
  label: 'edit-assets',
  arguments_: ['--allow-edit', '--allow-assets'],
  expectedTools: EDIT_ASSET_TOOLS,
  expectedScopes: ['read', 'preview', 'edit', 'assets'],
});
await runProfile({
  label: 'model',
  arguments_: ['--allow-model'],
  expectedTools: MODEL_TOOLS,
  expectedScopes: ['read', 'preview', 'model'],
});
await runProfile({
  label: 'edit-model',
  arguments_: ['--allow-edit', '--allow-model'],
  expectedTools: EDIT_MODEL_TOOLS,
  expectedScopes: ['read', 'preview', 'edit', 'model'],
});
await runProfile({
  label: 'assets-model',
  arguments_: ['--allow-assets', '--allow-model'],
  expectedTools: ASSET_MODEL_TOOLS,
  expectedScopes: ['read', 'preview', 'assets', 'model'],
});
await runProfile({
  label: 'edit-assets-model',
  arguments_: ['--allow-edit', '--allow-assets', '--allow-model'],
  expectedTools: EDIT_ASSET_MODEL_TOOLS,
  expectedScopes: ['read', 'preview', 'edit', 'assets', 'model'],
});

process.stdout.write(
  `MCP stdio lifecycle passed: ${READ_TOOLS.length}/`
  + `${EDIT_TOOLS.length}/${ASSET_TOOLS.length}/`
  + `${EDIT_ASSET_TOOLS.length} base profile tools and +2 with model, `
  + 'structured unpaired failures, '
  + 'redacted CLI/stdio rejections, clean EOF teardown.\n',
);
