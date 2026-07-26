// Production build gate: default output contains no Agent entry/global, while
// the explicit Agent artifact contains the narrow bridge and still refuses to
// install when served from the wrong port.
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import process from 'node:process';
import {
  navigateToApp,
  waitForInitialCook,
  withSmokePage,
} from './smoke/browser.mjs';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const viteExecutable = join(projectRoot, 'node_modules', '.bin', 'vite');

async function waitForServer(url, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Preview server exited early with ${child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Preview server did not become ready: ${url}`);
}

async function withPreview(args, url, run) {
  const child = spawn(viteExecutable, ['preview', ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-16_384);
  });
  child.stderr.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-16_384);
  });
  try {
    await waitForServer(url, child);
    await run();
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nPreview output:\n${output}`,
    );
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolveExit) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(fallback);
          resolveExit();
        };
        const fallback = setTimeout(finish, 2_000);
        child.once('exit', finish);
      });
    }
  }
}

async function assertAgentSourceDevFailsClosed() {
  const child = spawn(viteExecutable, [
    '--mode',
    'agent',
    '--host',
    '127.0.0.1',
    '--port',
    '5203',
    '--strictPort',
  ], {
    cwd: projectRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-16_384);
  });
  child.stderr.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-16_384);
  });
  const result = await new Promise((resolveResult, reject) => {
    const timeout = setTimeout(
      () => resolveResult({ timedOut: true, code: null }),
      5_000,
    );
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolveResult({ timedOut: false, code });
    });
  });
  if (result.timedOut && child.exitCode === null) {
    child.kill('SIGTERM');
    throw new Error('Agent Vite source-development server unexpectedly started.');
  }
  if (
    result.code === 0
    || !output.includes('Agent mode is available only as a built static artifact')
  ) {
    throw new Error(
      `Agent source-development gate did not fail for the expected reason:\n${output}`,
    );
  }
}

async function assertNoAgentRuntime(url, options = {}) {
  await withSmokePage({ url, storage: { mode: 'empty' } }, async ({ page }) => {
    await navigateToApp(page, url);
    await page.waitForSelector('.app');
    if (options.waitForFactory) {
      await waitForInitialCook(page, { width: 2480, height: 3508 });
      const exportReady = await page.$eval(
        '[data-agent-action="export-png"]',
        (element) => element instanceof HTMLButtonElement && !element.disabled,
      );
      if (!exportReady) throw new Error('Default production export did not become ready.');
    }
    const surface = await page.evaluate(() => ({
      controller: globalThis.gfxAgent !== undefined,
      pairing: globalThis.gfxAgentPairing !== undefined,
      legacyApp: globalThis.__app !== undefined,
      legacyRender: globalThis.__render !== undefined,
      panel: Boolean(document.querySelector('[data-agent-pairing-panel]')),
    }));
    if (Object.values(surface).some(Boolean)) {
      throw new Error(`Unexpected production control surface: ${JSON.stringify(surface)}`);
    }
  });
}

async function assertAgentModuleBoundary(url) {
  await withSmokePage({ url, storage: { mode: 'empty' } }, async ({ page }) => {
    await navigateToApp(page, url);
    await page.waitForSelector('[data-agent-pairing-panel]');
    const inspection = await page.evaluate(async () => {
      const urls = new Set(
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => {
            try {
              const candidate = new URL(name);
              return candidate.origin === location.origin
                && candidate.pathname.endsWith('.js');
            } catch {
              return false;
            }
          }),
      );
      for (const script of document.querySelectorAll('script[type="module"][src]')) {
        if (script instanceof HTMLScriptElement) urls.add(script.src);
      }
      const modules = [];
      for (const moduleUrl of [...urls].sort()) {
        try {
          const namespace = await import(moduleUrl);
          const exports = Object.keys(namespace);
          const storeLike = [];
          for (const [name, value] of Object.entries(namespace)) {
            try {
              if (
                value !== null
                && (typeof value === 'object' || typeof value === 'function')
                && typeof value.getState === 'function'
                && typeof value.setState === 'function'
              ) {
                storeLike.push(name);
              }
            } catch {
              // An exported hostile namespace value is itself outside the
              // narrow no-authority module contract.
              storeLike.push(name);
            }
          }
          modules.push({ moduleUrl, exports, storeLike });
        } catch (error) {
          modules.push({
            moduleUrl,
            exports: [],
            storeLike: ['<module import failed closed>'],
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return modules;
    });
    if (inspection.length === 0) {
      throw new Error('No first-party production module was inspected.');
    }
    const leaked = inspection.filter((module) => module.storeLike.length > 0);
    if (leaked.length > 0) {
      throw new Error(
        `Agent ESM namespace exposed raw authority: ${JSON.stringify(leaked)}`,
      );
    }
    const entry = inspection.find((module) =>
      /\/assets\/index-[^/]+\.js$/.test(new URL(module.moduleUrl).pathname));
    if (!entry) {
      throw new Error(`Agent entry module was not inspected: ${JSON.stringify(inspection)}`);
    }
    if (entry.exports.length > 0) {
      throw new Error(
        `Agent HTML entry must export no bindings: ${JSON.stringify(entry.exports)}`,
      );
    }
    const surface = await page.evaluate(() => ({
      pairing: Object.keys(globalThis.gfxAgentPairing ?? {}),
      controller: globalThis.gfxAgent,
    }));
    if (
      surface.controller !== undefined
      || JSON.stringify(surface.pairing) !== JSON.stringify([
        'requestPairing',
        'completePairing',
      ])
    ) {
      throw new Error(`Unexpected unpaired Agent surface: ${JSON.stringify(surface)}`);
    }
  });
}

const defaultUrl = 'http://127.0.0.1:5201/';
await assertAgentSourceDevFailsClosed();
await withPreview(
  ['--host', '127.0.0.1', '--port', '5201', '--strictPort'],
  defaultUrl,
  () => assertNoAgentRuntime(defaultUrl, { waitForFactory: true }),
);

const wrongOriginUrl = 'http://127.0.0.1:5202/';
await withPreview(
  ['--mode', 'agent', '--host', '127.0.0.1', '--port', '5202', '--strictPort'],
  wrongOriginUrl,
  () => assertNoAgentRuntime(wrongOriginUrl),
);

const agentUrl = 'http://127.0.0.1:5199/';
await withPreview(
  ['--mode', 'agent', '--host', '127.0.0.1', '--port', '5199', '--strictPort'],
  agentUrl,
  () => assertAgentModuleBoundary(agentUrl),
);

console.log('default production Agent surface: absent');
console.log('Agent Vite source-development mode: fail closed');
console.log('wrong-origin Agent artifact: fail closed');
console.log('Agent ESM namespace: no raw store authority');
console.log('default production factory render/export: PASS');
console.log('ALL CHECKS PASSED');
