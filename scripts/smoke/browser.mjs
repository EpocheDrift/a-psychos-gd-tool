import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

export const DEFAULT_SMOKE_URL = 'http://127.0.0.1:5199/';
export const DEFAULT_VIEWPORT = { width: 1480, height: 920, deviceScaleFactor: 1 };
const parsedTimeout = Number(process.env.SMOKE_TIMEOUT_MS ?? 20_000);
if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
  throw new Error(`SMOKE_TIMEOUT_MS must be a positive number, received "${process.env.SMOKE_TIMEOUT_MS}"`);
}
export const DEFAULT_TIMEOUT_MS = parsedTimeout;

export async function readDocumentFixture(name) {
  return JSON.parse(
    await readFile(
      new URL(`../../test/fixtures/documents/${name}`, import.meta.url),
      'utf8',
    ),
  );
}

async function isExecutable(candidate) {
  if (!candidate) return false;
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathCandidates(names) {
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) => names.map((name) => join(directory, name)));
}

export async function resolveChromeExecutable(explicit = process.env.CHROME) {
  const candidates = [
    explicit,
    ...(process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : []),
    ...(process.platform === 'win32'
      ? [
          process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
          process.env['PROGRAMFILES(X86)']
            && join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
          process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
        ]
      : []),
    ...(process.platform === 'linux'
      ? pathCandidates(['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'])
      : []),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }

  throw new Error(
    [
      'Chrome/Chromium executable not found.',
      'Set CHROME to an executable Chrome path.',
      `Checked: ${candidates.length ? candidates.join(', ') : '(no platform candidates)'}`,
    ].join(' '),
  );
}

export async function launchWebGpuChrome({ viewport = DEFAULT_VIEWPORT } = {}) {
  const executablePath = await resolveChromeExecutable();
  const headed = process.env.SMOKE_HEADED === '1';
  const browser = await puppeteer.launch({
    executablePath,
    headless: !headed,
    args: [
      '--enable-unsafe-webgpu',
      '--hide-scrollbars',
      `--window-size=${viewport.width},${viewport.height}`,
    ],
    defaultViewport: viewport,
  });
  return { browser, executablePath, version: await browser.version() };
}

function attachProblemCollector(page) {
  const problems = [];
  page.on('pageerror', (error) => {
    const problem = { kind: 'pageerror', message: error.message };
    problems.push(problem);
    console.error(`[${problem.kind}] ${problem.message}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const problem = { kind: 'console.error', message: message.text() };
    problems.push(problem);
    console.error(`[${problem.kind}] ${problem.message}`);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const problem = { kind: 'http', message: `${response.status()} ${response.url()}` };
    problems.push(problem);
    console.error(`[${problem.kind}] ${problem.message}`);
  });
  page.on('requestfailed', (request) => {
    const problem = {
      kind: 'requestfailed',
      message: `${request.failure()?.errorText ?? 'unknown failure'} ${request.url()}`,
    };
    problems.push(problem);
    console.error(`[${problem.kind}] ${problem.message}`);
  });
  return problems;
}

async function installDeterministicNetwork(page, appUrl, problems) {
  const appOrigin = new URL(appUrl).origin;
  const fallbackFont = await readFile(
    new URL('../../public/fonts/JetBrainsMono-Regular.ttf', import.meta.url),
  );
  const pending = new Set();
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const task = (async () => {
      if (request.isInterceptResolutionHandled()) return;
      const requested = new URL(request.url());
      if (requested.origin === appOrigin && requested.pathname === '/fonts/Inter-Regular.otf') {
        await request.respond({
          status: 200,
          contentType: 'font/ttf',
          body: fallbackFont,
        });
        return;
      }
      if (
        (requested.protocol === 'http:' || requested.protocol === 'https:')
        && requested.origin !== appOrigin
      ) {
        const problem = {
          kind: 'unexpected-network',
          message: `Agent smoke blocked cross-origin request ${request.url()}`,
        };
        problems.push(problem);
        console.error(`[${problem.kind}] ${problem.message}`);
        await request.abort('blockedbyclient');
        return;
      }
      await request.continue();
    })().catch(async (error) => {
      const problem = {
        kind: 'request-interception',
        message: `${error instanceof Error ? error.message : String(error)} ${request.url()}`,
      };
      problems.push(problem);
      console.error(`[${problem.kind}] ${problem.message}`);
      if (!request.isInterceptResolutionHandled()) await request.abort('failed').catch(() => undefined);
    }).finally(() => {
      pending.delete(task);
    });
    pending.add(task);
  });
  return async () => {
    while (pending.size > 0) await Promise.allSettled([...pending]);
  };
}

async function installStorageSeed(page, storage, appUrl) {
  const seed = storage ?? { mode: 'empty' };
  const expectedOrigin = new URL(appUrl).origin;
  await page.evaluateOnNewDocument((value, origin) => {
    if (location.origin !== origin) return;
    const marker = '__gfx_smoke_storage_seeded__';
    if (sessionStorage.getItem(marker) === '1') return;
    localStorage.removeItem('gfx.document.v1');
    localStorage.removeItem('gfx.document.v2');
    localStorage.removeItem('gfx.project');
    if (value.mode === 'v2') localStorage.setItem('gfx.document.v2', JSON.stringify(value.document));
    if (value.mode === 'legacy') localStorage.setItem('gfx.document.v1', JSON.stringify(value.graph));
    sessionStorage.setItem(marker, '1');
  }, seed, expectedOrigin);
}

export async function withSmokePage(options, run) {
  const viewport = options?.viewport ?? DEFAULT_VIEWPORT;
  const url = options?.url ?? process.argv[2] ?? process.env.SMOKE_URL ?? DEFAULT_SMOKE_URL;
  const { browser, executablePath, version } = await launchWebGpuChrome({ viewport });
  let context;

  try {
    context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT_MS);
    const problems = attachProblemCollector(page);
    const drainRequests = await installDeterministicNetwork(page, url, problems);
    await installStorageSeed(page, options?.storage, url);
    let result;
    try {
      result = await run({ page, url, problems, executablePath, version });
    } finally {
      await drainRequests();
    }
    assertNoPageProblems(problems);
    return result;
  } finally {
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export async function navigateToApp(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const webGpu = await page.evaluate(async () => {
    const gpu = navigator.gpu;
    const adapter = gpu ? await gpu.requestAdapter() : null;
    return {
      secureContext: globalThis.isSecureContext,
      hasNavigatorGpu: Boolean(gpu),
      hasAdapter: Boolean(adapter),
    };
  });
  if (!webGpu.secureContext || !webGpu.hasNavigatorGpu || !webGpu.hasAdapter) {
    throw new Error(
      `WebGPU unavailable at ${url}: secureContext=${webGpu.secureContext}, `
        + `navigator.gpu=${webGpu.hasNavigatorGpu}, adapter=${webGpu.hasAdapter}`,
    );
  }
  return webGpu;
}

export async function pairAgent(
  page,
  {
    scopes = ['read'],
    clientLabel = 'Codex browser smoke',
  } = {},
) {
  await page.waitForFunction(() =>
    Boolean(globalThis.gfxAgentPairing)
    && document.querySelector('[data-agent-pairing-panel]'));
  const unpaired = await page.evaluate(() => ({
    controller: globalThis.gfxAgent,
    legacyApp: globalThis.__app,
    legacyRender: globalThis.__render,
  }));
  if (
    unpaired.controller !== undefined
    || unpaired.legacyApp !== undefined
    || unpaired.legacyRender !== undefined
  ) {
    throw new Error('Agent build exposed a controller before pairing or a legacy raw hook.');
  }
  await page.click('[data-agent-action="open-agent-pairing"]');
  await page.waitForFunction(() =>
    document.querySelector('[data-agent-pairing-panel]')
      ?.getAttribute('data-agent-pairing-state') === 'armed');

  const challenge = await page.evaluateHandle(({ requestedScopes, label }) => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const clientNonce = btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    let result;
    try {
      result = globalThis.gfxAgentPairing?.requestPairing({
        protocolVersion: '1.0',
        clientNonce,
        clientLabel: label,
        requestedScopes,
      });
    } catch (error) {
      throw new Error(
        `Pairing request threw: ${error instanceof Error ? error.stack : String(error)}`,
      );
    }
    if (!result?.ok) {
      throw new Error(`Pairing request failed: ${JSON.stringify(result?.error)}`);
    }
    return result.value;
  }, { requestedScopes: scopes, label: clientLabel });

  try {
    await page.waitForFunction(() =>
      document.querySelector('[data-agent-pairing-panel]')
        ?.getAttribute('data-agent-pairing-state') === 'pending');
    await page.waitForFunction(() =>
      document.activeElement?.id === 'agent-pairing-title');
    const dialogAudit = await page.evaluate(() => {
      const dialog = document.querySelector('.agent-pairing-dialog');
      return {
        open: dialog instanceof HTMLDialogElement && dialog.open,
        modal:
          dialog instanceof HTMLDialogElement
          && typeof dialog.matches === 'function'
          && dialog.matches(':modal'),
        activeId: document.activeElement?.id,
        scopes: Array.from(
          document.querySelectorAll('[data-agent-scope]'),
          (element) => element.getAttribute('data-agent-scope'),
        ),
      };
    });
    if (
      !dialogAudit.open
      || !dialogAudit.modal
      || dialogAudit.activeId !== 'agent-pairing-title'
      || JSON.stringify(dialogAudit.scopes) !== JSON.stringify([
        'read',
        'preview',
        'edit',
        'assets',
        'model',
        'export',
      ])
    ) {
      throw new Error(`Pairing dialog semantic audit failed: ${JSON.stringify(dialogAudit)}`);
    }
    const firstScope = scopes[0];
    await page.evaluate((scope) => {
      const input = document.querySelector(`[data-agent-scope="${scope}"]`);
      input?.click();
    }, firstScope);
    await page.waitForFunction((scope) => {
      const input = document.querySelector(`[data-agent-scope="${scope}"]`);
      return input instanceof HTMLInputElement
        && input.checked
        && input.getAttribute('data-agent-scope-selected') === 'true';
    }, {}, firstScope);
    const syntheticScope = await page.evaluate((scope) => {
      const input = document.querySelector(`[data-agent-scope="${scope}"]`);
      return {
        checked: input instanceof HTMLInputElement && input.checked,
        selected: input?.getAttribute('data-agent-scope-selected'),
        granted: input?.getAttribute('data-agent-scope-granted'),
        phase: document.querySelector('[data-agent-pairing-panel]')
          ?.getAttribute('data-agent-pairing-state'),
      };
    }, firstScope);
    if (
      !syntheticScope.checked
      || syntheticScope.selected !== 'true'
      || syntheticScope.granted !== 'false'
      || syntheticScope.phase !== 'pending'
    ) {
      throw new Error(`Synthetic scope selection crossed consent boundary: ${JSON.stringify(syntheticScope)}`);
    }
    for (const scope of scopes) {
      const selector = `[data-agent-scope="${scope}"]`;
      const ready = await page.$eval(selector, (element) =>
        element instanceof HTMLInputElement
        && !element.disabled
        && element.checked
        && element.getAttribute('data-agent-scope-selected') === 'true');
      if (!ready) {
        throw new Error(`Requested smoke scope was not selected by default: ${scope}`);
      }
    }
    const pendingGrantAudit = await page.evaluate(() => ({
      phase: document.querySelector('[data-agent-pairing-panel]')
        ?.getAttribute('data-agent-pairing-state'),
      accidentallyGranted: Array.from(
        document.querySelectorAll('[data-agent-scope-granted="true"]'),
        (element) => element.getAttribute('data-agent-scope'),
      ),
    }));
    if (
      pendingGrantAudit.phase !== 'pending'
      || pendingGrantAudit.accidentallyGranted.length > 0
    ) {
      throw new Error(`Pending scope appeared granted: ${JSON.stringify(pendingGrantAudit)}`);
    }
    const syntheticApprove = await page.evaluate(() => {
      document.querySelector('[data-agent-action="approve-agent-pairing"]')?.click();
      return document.querySelector('[data-agent-pairing-panel]')
        ?.getAttribute('data-agent-pairing-state');
    });
    if (syntheticApprove !== 'pending') {
      throw new Error(`Synthetic approval crossed consent boundary: ${syntheticApprove}`);
    }
    await page.click('[data-agent-action="approve-agent-pairing"]');
    await page.waitForFunction(() =>
      document.querySelector('[data-agent-pairing-panel]')
        ?.getAttribute('data-agent-pairing-state') === 'approved');
    const result = await page.evaluate((pairingChallenge) => {
      const completed = globalThis.gfxAgentPairing?.completePairing({
        pairingId: pairingChallenge.pairingId,
        clientNonce: pairingChallenge.clientNonce,
        serverNonce: pairingChallenge.serverNonce,
        claimToken: pairingChallenge.claimToken,
      });
      if (!completed?.ok) {
        throw new Error(`Pairing completion failed: ${JSON.stringify(completed?.error)}`);
      }
      return completed.value;
    }, challenge);
    const smokeAudit = await page.evaluate((pairingChallenge) => {
      const sensitive = [
        pairingChallenge.pairingId,
        pairingChallenge.clientNonce,
        pairingChallenge.serverNonce,
        pairingChallenge.claimToken,
      ];
      const dom = document.documentElement.outerHTML;
      const storage = [
        ...Object.entries(localStorage),
        ...Object.entries(sessionStorage),
      ].flatMap(([key, value]) => [key, value]);
      const replay = globalThis.gfxAgentPairing?.completePairing({
        pairingId: pairingChallenge.pairingId,
        clientNonce: pairingChallenge.clientNonce,
        serverNonce: pairingChallenge.serverNonce,
        claimToken: pairingChallenge.claimToken,
      });
      return {
        secretInDom: sensitive.some((value) => dom.includes(value)),
        secretInUrl: sensitive.some((value) => location.href.includes(value)),
        secretInStorage: sensitive.some((value) =>
          storage.some((entry) => entry.includes(value))),
        replayCode: replay?.ok ? 'UNEXPECTED_SUCCESS' : replay?.error?.code,
      };
    }, challenge);
    await page.waitForFunction(() => Boolean(globalThis.gfxAgent));
    await page.waitForFunction(() =>
      document.activeElement?.getAttribute('data-agent-action')
        === 'revoke-agent-session');
    const syntheticRevoke = await page.evaluate(() => {
      document.querySelector('[data-agent-action="revoke-agent-session"]')?.click();
      return document.querySelector('[data-agent-pairing-panel]')
        ?.getAttribute('data-agent-pairing-state');
    });
    if (syntheticRevoke !== 'connected') {
      throw new Error(`Synthetic revoke crossed trusted control boundary: ${syntheticRevoke}`);
    }
    const surface = await page.evaluate(() => ({
      methods: Object.keys(globalThis.gfxAgent ?? {}),
      frozen: Object.isFrozen(globalThis.gfxAgent),
      extensible: Object.isExtensible(globalThis.gfxAgent),
      hasGenericCall: Object.hasOwn(globalThis.gfxAgent ?? {}, 'call'),
      hasLegacyApp: globalThis.__app !== undefined,
      hasLegacyRender: globalThis.__render !== undefined,
    }));
    const expected = [
      'getCapabilities',
      'getDocument',
      'validateDocument',
      'applyTransaction',
      'getRenderStatus',
      'awaitRender',
      'capturePreview',
      'revertTransaction',
      'putAsset',
      'listAssets',
      'getAssetMetadata',
      'removeAsset',
    ];
    if (
      JSON.stringify(surface.methods) !== JSON.stringify(expected)
      || !surface.frozen
      || surface.extensible
      || surface.hasGenericCall
      || surface.hasLegacyApp
      || surface.hasLegacyRender
    ) {
      throw new Error(`Unsafe Agent surface: ${JSON.stringify(surface)}`);
    }
    return { ...result, smokeAudit };
  } finally {
    await challenge.dispose();
  }
}

export async function waitForInitialCook(page, { width, height }) {
  await page.waitForFunction(
    ({ expectedWidth, expectedHeight }) => {
      if (document.querySelector('[data-agent-render-error]')) return true;
      const canvas = document.querySelector('[data-agent-preview="main"]');
      const status = document.querySelector('[data-agent-render-status]');
      return canvas instanceof HTMLCanvasElement
        && status instanceof HTMLElement
        && canvas.width === expectedWidth
        && canvas.height === expectedHeight
        && status.dataset.agentRenderState === 'complete'
        && status.dataset.agentDocumentRevision === status.dataset.agentRenderRevision
        && canvas.dataset.agentRenderRevision === status.dataset.agentDocumentRevision;
    },
    {},
    { expectedWidth: width, expectedHeight: height },
  );
  const cookError = await page.$eval(
    '[data-agent-render-error]',
    (element) => element.textContent,
  ).catch(() => null);
  if (cookError) throw new Error(`cook error: ${cookError}`);
}

/** Capture the app's native PNG export without writing a browser download. */
export async function captureExportPng(page) {
  await page.evaluate((timeoutMs) => {
    globalThis.__gfxSmokeExport = new Promise((resolve, reject) => {
      const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
      const timeout = setTimeout(() => {
        URL.createObjectURL = originalCreateObjectUrl;
        reject(new Error(`PNG export did not complete within ${timeoutMs}ms`));
      }, timeoutMs);
      URL.createObjectURL = (blob) => {
        URL.createObjectURL = originalCreateObjectUrl;
        const objectUrl = originalCreateObjectUrl(blob);
        const reader = new FileReader();
        reader.addEventListener('load', () => {
          clearTimeout(timeout);
          resolve(String(reader.result).split(',')[1]);
        }, { once: true });
        reader.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(reader.error ?? new Error('PNG FileReader failed'));
        }, { once: true });
        reader.readAsDataURL(blob);
        return objectUrl;
      };
    });
  }, DEFAULT_TIMEOUT_MS);
  await page.click('[data-agent-action="export-png"]');
  return page.evaluate(() => globalThis.__gfxSmokeExport);
}

export function assertNoPageProblems(problems) {
  if (problems.length === 0) return;
  throw new Error(problems.map((problem) => `${problem.kind}: ${problem.message}`).join('\n'));
}

export async function smokeArtifactPath(name) {
  const directory = resolve(process.env.SMOKE_ARTIFACT_DIR ?? join(tmpdir(), 'a-psychos-gd-tool-smoke'));
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, name);
  await mkdir(dirname(path), { recursive: true });
  return path;
}
