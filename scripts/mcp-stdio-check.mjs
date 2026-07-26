import { connect } from 'node:net';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SERVER_ENTRY = resolve(
  REPOSITORY_ROOT,
  'packages/mcp-companion/dist/index.js',
);
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

async function waitFor(predicate, description) {
  const deadline = Date.now() + 8_000;
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

async function runProfile({ label, arguments_, expectedTools }) {
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

await runProfile({
  label: 'read-preview',
  arguments_: [],
  expectedTools: READ_TOOLS,
});
await runProfile({
  label: 'edit',
  arguments_: ['--allow-edit'],
  expectedTools: EDIT_TOOLS,
});

process.stdout.write(
  `MCP stdio lifecycle passed: ${READ_TOOLS.length}/`
  + `${EDIT_TOOLS.length} profile tools, structured unpaired failures, `
  + 'clean EOF teardown.\n',
);
