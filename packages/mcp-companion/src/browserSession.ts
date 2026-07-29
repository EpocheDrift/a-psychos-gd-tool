import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import process from 'node:process';
import puppeteer, {
  type Browser,
  type BrowserContext,
} from 'puppeteer-core';
import {
  AGENT_ALLOWED_ORIGIN,
  AGENT_COOKIE_NAME,
} from './agentSecurity.js';

export interface BrowserSessionOptions {
  bootstrapToken: string;
  executablePath?: string;
  headless?: boolean;
  onDisconnected?: () => void;
}

const WORKBENCH_READY_TIMEOUT_MS = 20_000;
export const AGENT_WORKBENCH_READY_SELECTOR =
  '[data-agent-render-status][data-agent-workbench-ready="true"]';

function pathCandidates(names: readonly string[]): string[] {
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) => names.map((name) => join(directory, name)));
}

async function isExecutable(candidate: string | undefined): Promise<boolean> {
  if (!candidate) return false;
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveChromeExecutable(
  explicit = process.env.CHROME,
): Promise<string> {
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
          process.env.PROGRAMFILES
            && join(
              process.env.PROGRAMFILES,
              'Google/Chrome/Application/chrome.exe',
            ),
          process.env['PROGRAMFILES(X86)']
            && join(
              process.env['PROGRAMFILES(X86)'],
              'Google/Chrome/Application/chrome.exe',
            ),
          process.env.LOCALAPPDATA
            && join(
              process.env.LOCALAPPDATA,
              'Google/Chrome/Application/chrome.exe',
            ),
        ]
      : []),
    ...(process.platform === 'linux'
      ? pathCandidates([
          'google-chrome-stable',
          'google-chrome',
          'chromium',
          'chromium-browser',
        ])
      : []),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }
  throw new Error(
    'Chrome/Chromium was not found. Set CHROME to an executable path.',
  );
}

export class CreatedBrowserSession {
  private closed = false;

  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
  ) {}

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
  }
}

export async function launchCompanionBrowser(
  options: BrowserSessionOptions,
): Promise<CreatedBrowserSession> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(options.bootstrapToken)) {
    throw new Error('The browser bootstrap token must contain 256 bits.');
  }
  const executablePath = await resolveChromeExecutable(options.executablePath);
  const browser = await puppeteer.launch({
    executablePath,
    pipe: true,
    headless: options.headless ?? false,
    defaultViewport: {
      width: 1480,
      height: 920,
      deviceScaleFactor: 1,
    },
    args: [
      '--enable-unsafe-webgpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--window-size=1480,920',
    ],
  });
  let context: BrowserContext | undefined;
  try {
    context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setCookie({
      name: AGENT_COOKIE_NAME,
      value: options.bootstrapToken,
      url: AGENT_ALLOWED_ORIGIN,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Strict',
    });
    page.setDefaultNavigationTimeout(20_000);
    await page.goto(AGENT_ALLOWED_ORIGIN, {
      waitUntil: 'domcontentloaded',
    });
    try {
      await page.waitForSelector(
        AGENT_WORKBENCH_READY_SELECTOR,
        { timeout: WORKBENCH_READY_TIMEOUT_MS },
      );
    } catch (error) {
      throw new Error(
        'The shared 5199 workbench did not schedule its initial exact render before startup completed.',
        { cause: error },
      );
    }
    if (options.onDisconnected) {
      browser.once('disconnected', options.onDisconnected);
    }
    return new CreatedBrowserSession(browser, context);
  } catch (error) {
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    throw error;
  }
}
