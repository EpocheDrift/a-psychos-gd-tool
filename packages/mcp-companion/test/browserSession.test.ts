import process from 'node:process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ launch: vi.fn() }));

vi.mock('puppeteer-core', () => ({
  default: { launch: mocks.launch },
}));

import { launchCompanionBrowser } from '../src/browserSession.js';

const bootstrapToken = 'a'.repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  const page = {
    setCookie: vi.fn(async () => undefined),
    setDefaultNavigationTimeout: vi.fn(),
    goto: vi.fn(async () => undefined),
    waitForSelector: vi.fn(async () => undefined),
  };
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  };
  const browser = {
    createBrowserContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
    once: vi.fn(),
  };
  mocks.launch.mockResolvedValue(browser);
});

describe('companion browser viewport policy', () => {
  it('lets the visible shared workbench follow its native window', async () => {
    const session = await launchCompanionBrowser({
      bootstrapToken,
      executablePath: process.execPath,
      headless: false,
    });

    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({
      headless: false,
      defaultViewport: null,
      args: expect.arrayContaining(['--window-size=1480,920']),
    }));
    const options = mocks.launch.mock.calls[0]![0];
    expect(options.args).not.toContain('--hide-scrollbars');
    await session.close();
  });

  it('keeps deterministic device metrics for headless automation', async () => {
    const session = await launchCompanionBrowser({
      bootstrapToken,
      executablePath: process.execPath,
      headless: true,
    });

    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({
      headless: true,
      defaultViewport: {
        width: 1480,
        height: 920,
        deviceScaleFactor: 1,
      },
      args: expect.arrayContaining([
        '--window-size=1480,920',
        '--hide-scrollbars',
      ]),
    }));
    await session.close();
  });
});
