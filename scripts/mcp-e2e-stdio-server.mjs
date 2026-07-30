// Test-only stdio child. Puppeteer is used solely to perform the trusted
// approval/revoke clicks that a human performs in normal companion use.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer-core';
import {
  AGENT_ALLOWED_ORIGIN,
  AGENT_COOKIE_NAME,
} from '../packages/mcp-companion/dist/agentSecurity.js';
import {
  AGENT_WORKBENCH_READY_SELECTOR,
  resolveChromeExecutable,
} from '../packages/mcp-companion/dist/browserSession.js';
import {
  createBoundedStdio,
} from '../packages/mcp-companion/dist/boundedStdio.js';
import {
  CompanionRuntime,
} from '../packages/mcp-companion/dist/runtime.js';
import {
  FileModelCache,
} from '../packages/mcp-companion/dist/modelCache.js';
import {
  ModelManager,
  OneShotModelApprovalGate,
} from '../packages/mcp-companion/dist/modelManager.js';
import {
  createToolServer,
} from '../packages/mcp-companion/dist/tools.js';
import {
  RMBG_MODEL_ARTIFACTS,
  RMBG_MODEL_FILES_PATH_PREFIX,
  RMBG_MODEL_KEY,
  RMBG_MODEL_MANIFEST_SHA256,
  RMBG_MODEL_PUBLIC_LICENSE,
  RMBG_MODEL_REVISION,
  RMBG_MODEL_TOTAL_BYTES,
} from '../packages/mcp-companion/dist/modelPublicContract.js';

const diagnostics = (message) => {
  process.stderr.write(`[gfx-mcp-e2e] ${message}\n`);
};

let browser;
let context;
let page;
let server;
let stdio;
let shuttingDown;
const browserProblems = [];
let modelRouteReported = false;
let evalRetryDelayed = false;
const expectedModelArtifactPaths = new Set(
  RMBG_MODEL_ARTIFACTS.map((artifact) =>
    `${RMBG_MODEL_FILES_PATH_PREFIX}${artifact.relativePath}`),
);
// This child is test-only. Always isolate its fixed-model state so both the
// regular MCP E2E and Agent eval remain deterministic when a developer has
// already installed RMBG in their normal companion cache.
const e2eModelCacheRoot = await mkdtemp(
  join(tmpdir(), 'gfx-mcp-e2e-model-'),
);
const e2eModelRuntime = (() => {
  const approvalGate = new OneShotModelApprovalGate();
  return {
    approvalGate,
    manager: new ModelManager({
      approvalProvider: approvalGate,
      cache: new FileModelCache(e2eModelCacheRoot),
    }),
  };
})();

const testReadyModelStatus = {
  schemaVersion: 1,
  modelKey: RMBG_MODEL_KEY,
  revision: RMBG_MODEL_REVISION,
  manifestSha256: RMBG_MODEL_MANIFEST_SHA256,
  state: 'ready',
  bytes: RMBG_MODEL_TOTAL_BYTES,
  totalBytes: RMBG_MODEL_TOTAL_BYTES,
  artifacts: RMBG_MODEL_ARTIFACTS.map((artifact) => ({
    id: artifact.id,
    state: 'ready',
    bytes: artifact.byteLength,
    totalBytes: artifact.byteLength,
  })),
  license: RMBG_MODEL_PUBLIC_LICENSE,
};

const runtime = new CompanionRuntime({
  allowEdit: true,
  allowAssets: true,
  allowModel: true,
  headless: true,
  modelRuntime: e2eModelRuntime,
  launchBrowser: async ({ bootstrapToken, onDisconnected }) => {
    const executablePath = await resolveChromeExecutable();
    browser = await puppeteer.launch({
      executablePath,
      pipe: true,
      headless: true,
      defaultViewport: {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
      },
      args: [
        '--enable-unsafe-webgpu',
        '--hide-scrollbars',
        '--window-size=1280,800',
      ],
    });
    try {
      context = await browser.createBrowserContext();
      page = await context.newPage();
      page.setDefaultTimeout(20_000);
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        void (async () => {
          const url = new URL(request.url());
          if (
            url.origin === AGENT_ALLOWED_ORIGIN
            && url.pathname === '/__gfx_model_v1/status'
          ) {
            await request.respond({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(testReadyModelStatus),
            });
            return;
          }
          await request.continue();
        })().catch(() => {
          if (!shuttingDown && browser?.connected) {
            browserProblems.push('model route interception failed');
          }
        });
      });
      page.on('response', (response) => {
        if (modelRouteReported || response.status() !== 409) return;
        const url = new URL(response.url());
        if (
          url.origin !== AGENT_ALLOWED_ORIGIN
          || !expectedModelArtifactPaths.has(url.pathname)
        ) return;
        modelRouteReported = true;
        diagnostics('MODEL_ROUTE_SEEN');
      });
      page.on('pageerror', (error) => {
        browserProblems.push(`pageerror: ${error.message}`);
      });
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const location = message.location().url;
        if (!location.includes('/__gfx_model_v1/files/')) {
          browserProblems.push(`console.error: ${message.text()}`);
        }
      });
      await page.setCookie({
        name: AGENT_COOKIE_NAME,
        value: bootstrapToken,
        url: AGENT_ALLOWED_ORIGIN,
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Strict',
      });
      await page.goto(AGENT_ALLOWED_ORIGIN, {
        waitUntil: 'domcontentloaded',
      });
      if (onDisconnected) browser.once('disconnected', onDisconnected);

      const tokenEscaped = await page.evaluate((token) => {
        const storageValues = [];
        for (const storage of [localStorage, sessionStorage]) {
          for (let index = 0; index < storage.length; index++) {
            const key = storage.key(index) ?? '';
            storageValues.push(`${key}=${storage.getItem(key) ?? ''}`);
          }
        }
        return [
          location.href,
          document.documentElement.outerHTML,
          ...storageValues,
        ].some((value) => value.includes(token));
      }, bootstrapToken);
      if (tokenEscaped) {
        throw new Error(
          'The transport token escaped into URL, DOM, or web storage.',
        );
      }

      await page.waitForFunction(() =>
        document.querySelector('[data-agent-pairing-panel]')
          ?.getAttribute('data-agent-pairing-state') === 'pending');
      await page.click('[data-agent-action="approve-agent-pairing"]');
      await page.waitForFunction(() =>
        document.querySelector('[data-agent-pairing-panel]')
          ?.getAttribute('data-agent-pairing-state') === 'connected');
      await page.waitForSelector(AGENT_WORKBENCH_READY_SELECTOR);

      return {
        close: async () => {
          await context?.close().catch(() => undefined);
          await browser?.close().catch(() => undefined);
        },
      };
    } catch (error) {
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
      context = undefined;
      browser = undefined;
      page = undefined;
      throw error;
    }
  },
  onBridgeTerminated: (reason) => {
    diagnostics(`bridge terminal: ${reason}`);
  },
});

const shutdown = (reason) => {
  shuttingDown ??= (async () => {
    diagnostics(`shutdown: ${reason}`);
    stdio?.detach();
    await server?.close().catch(() => undefined);
    try {
      await runtime.close();
    } finally {
      await rm(e2eModelCacheRoot, { recursive: true, force: true });
    }
    if (browserProblems.length > 0) {
      throw new Error(browserProblems.join(' | '));
    }
  })();
  return shuttingDown;
};

process.once('SIGUSR1', () => {
  void (async () => {
    if (!page) throw new Error('The E2E page is unavailable.');
    await page.click('[data-agent-action="revoke-agent-session"]');
    const deadline = Date.now() + 5_000;
    while (
      runtime.bridge.healthState() !== 'failed'
      && runtime.bridge.healthState() !== 'closed'
      && Date.now() < deadline
    ) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    if (
      runtime.bridge.healthState() !== 'failed'
      && runtime.bridge.healthState() !== 'closed'
    ) {
      throw new Error('The revoked bridge did not become terminal.');
    }
    diagnostics('CONTROL_REVOKED');
  })().catch((error) => {
    diagnostics(
      `CONTROL_ERROR: ${
        error instanceof Error ? error.message : 'unknown control failure'
      }`,
    );
    process.exitCode = 1;
  });
});

process.once('SIGUSR2', () => {
  void (async () => {
    if (process.env.GFX_AGENT_EVAL !== '1') {
      throw new Error('The human-edit probe is enabled only for Agent evals.');
    }
    if (!page) throw new Error('The E2E page is unavailable.');
    const before = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('[data-agent-target="layer"]'),
        (element) => element.getAttribute('data-agent-layer-id'),
      ).filter((id) => typeof id === 'string'));
    await page.click('[data-agent-action="add-layer"]');
    await page.waitForFunction((known) =>
      Array.from(
        document.querySelectorAll('[data-agent-target="layer"]'),
        (element) => element.getAttribute('data-agent-layer-id'),
      ).some((id) => typeof id === 'string' && !known.includes(id)), {}, before);
    const after = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('[data-agent-target="layer"]'),
        (element) => element.getAttribute('data-agent-layer-id'),
      ).filter((id) => typeof id === 'string'));
    const created = after.find((id) => !before.includes(id));
    if (!created) throw new Error('The human UI did not create a layer.');
    diagnostics(`HUMAN_EDIT_COMPLETE:${created}`);
  })().catch((error) => {
    diagnostics(
      `CONTROL_ERROR: ${
        error instanceof Error ? error.message : 'unknown human-edit failure'
      }`,
    );
    process.exitCode = 1;
  });
});

process.once('SIGINT', () => {
  void shutdown('SIGINT').finally(() => process.exit(process.exitCode ?? 0));
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM').finally(() => process.exit(process.exitCode ?? 0));
});
process.stdin.once('end', () => {
  void shutdown('stdio EOF').catch((error) => {
    diagnostics(error instanceof Error ? error.message : 'shutdown failed');
    process.exitCode = 1;
  });
});

try {
  await runtime.start();
  await new Promise((resolveReady, rejectReady) => {
    const deadline = Date.now() + 5_000;
    const inspect = () => {
      if (runtime.bridge.healthState() === 'ready') {
        resolveReady();
      } else if (Date.now() >= deadline) {
        rejectReady(new Error('The E2E bridge did not become ready.'));
      } else {
        setTimeout(inspect, 10);
      }
    };
    inspect();
  });
  const toolBridge = process.env.GFX_AGENT_EVAL === '1'
    ? {
        call: async (operation, input, signal) => {
          const retryProbe =
            operation === 'applyTransaction'
            && input !== null
            && typeof input === 'object'
            && input.requestId === 'agent_eval_retry_v1';
          const result = await runtime.bridge.call(
            operation,
            input,
            retryProbe ? new AbortController().signal : signal,
          );
          if (retryProbe && !evalRetryDelayed) {
            evalRetryDelayed = true;
            diagnostics('RETRY_COMMITTED');
            // Test-only lost-response simulation: the browser commit and
            // replay-cache settlement are complete before the MCP caller's
            // deliberately short timeout expires.
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
          }
          return result;
        },
      }
    : runtime.bridge;
  server = createToolServer({
    bridge: toolBridge,
    allowEdit: true,
    allowAssets: true,
    allowModel: true,
    modelManager: runtime.modelManager,
  });
  stdio = createBoundedStdio();
  stdio.input.once('error', (error) => {
    diagnostics(`stdio input error: ${error.message}`);
    void shutdown('invalid stdio input');
  });
  stdio.output.once('error', (error) => {
    diagnostics(`stdio output error: ${error.message}`);
    void shutdown('invalid stdio output');
  });
  await server.connect(stdio.transport);
  diagnostics('CONTROL_READY');
} catch (error) {
  diagnostics(error instanceof Error ? error.message : 'E2E startup failed');
  await shutdown('startup failure').catch(() => undefined);
  process.exitCode = 1;
}
