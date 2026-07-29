import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CompanionRuntime,
  companionRequestedScopes,
  companionSessionTtlMs,
} from '../src/runtime.js';
import {
  AGENT_COMPANION_CONTROL_MODE_INTERACTIVE,
  AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL,
} from '../src/agentSecurity.js';
import {
  INTERACTIVE_SESSION_TTL_MS,
  TRUSTED_LOCAL_SESSION_TTL_MS,
} from '../src/protocol.js';

const directories: string[] = [];
const runtimes: CompanionRuntime[] = [];

afterEach(async () => {
  while (runtimes.length > 0) await runtimes.pop()?.close();
  while (directories.length > 0) {
    await rm(directories.pop()!, { recursive: true, force: true });
  }
});

function healthStatus(): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = request({
      hostname: '127.0.0.1',
      port: 5199,
      path: '/healthz',
      headers: { Host: '127.0.0.1:5199' },
    }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    outgoing.once('error', reject);
    outgoing.end();
  });
}

describe('companion runtime lifecycle', () => {
  it.each([
    [false, false, false, ['read', 'preview']],
    [true, false, false, ['read', 'preview', 'edit']],
    [false, true, false, ['read', 'preview', 'assets']],
    [true, true, false, ['read', 'preview', 'edit', 'assets']],
    [false, false, true, ['read', 'preview', 'model']],
    [true, false, true, ['read', 'preview', 'edit', 'model']],
    [false, true, true, ['read', 'preview', 'assets', 'model']],
    [
      true,
      true,
      true,
      ['read', 'preview', 'edit', 'assets', 'model'],
    ],
  ] as const)(
    'derives independent edit=%s assets=%s model=%s pairing scopes',
    (allowEdit, allowAssets, allowModel, expected) => {
      expect(companionRequestedScopes({
        allowEdit,
        allowAssets,
        allowModel,
      })).toEqual(expected);
    },
  );

  it('uses a bounded mode-specific session lifetime', () => {
    expect(companionSessionTtlMs(
      AGENT_COMPANION_CONTROL_MODE_INTERACTIVE,
    )).toBe(INTERACTIVE_SESSION_TTL_MS);
    expect(companionSessionTtlMs(
      AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL,
    )).toBe(TRUSTED_LOCAL_SESSION_TTL_MS);
    expect(TRUSTED_LOCAL_SESSION_TTL_MS).toBe(12 * 60 * 60_000);
  });

  it('fails closed when runtime flags drift from a versioned profile', () => {
    expect(() => new CompanionRuntime({
      allowEdit: false,
      allowAssets: true,
      allowModel: true,
      profile: 'full-design-v1',
    })).toThrow('do not match its versioned profile');
  });

  it('closes its browser and host when the bridge becomes terminal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gfx-runtime-'));
    directories.push(directory);
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><html><head></head><body>runtime</body></html>',
    );
    const closeBrowser = vi.fn(async () => undefined);
    const onTerminal = vi.fn();
    const runtime = new CompanionRuntime({
      allowEdit: false,
      allowAssets: false,
      allowModel: false,
      appDirectory: directory,
      launchBrowser: async () => ({ close: closeBrowser }),
      onBridgeTerminated: onTerminal,
    });
    runtimes.push(runtime);
    await runtime.start();
    await expect(healthStatus()).resolves.toBe(200);

    runtime.bridge.close('simulated browser transport loss');
    await runtime.close();

    expect(onTerminal).toHaveBeenCalledOnce();
    expect(closeBrowser).toHaveBeenCalledOnce();
    await expect(healthStatus()).rejects.toBeDefined();
    await expect(
      runtime.bridge.call('getDocument', {}),
    ).rejects.toMatchObject({
      publicFault: { error: { code: 'SESSION_REVOKED' } },
    });
  });

  it('closes a browser that resolves after shutdown starts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gfx-runtime-race-'));
    directories.push(directory);
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><html><head></head><body>runtime</body></html>',
    );
    let resolveLaunch:
      | ((browser: { close(): Promise<void> }) => void)
      | undefined;
    const launched = new Promise<{ close(): Promise<void> }>((resolve) => {
      resolveLaunch = resolve;
    });
    const closeBrowser = vi.fn(async () => undefined);
    const launchBrowser = vi.fn(async () => launched);
    const runtime = new CompanionRuntime({
      allowEdit: false,
      allowAssets: false,
      allowModel: false,
      appDirectory: directory,
      launchBrowser,
    });
    runtimes.push(runtime);

    const starting = runtime.start();
    await expect.poll(() => launchBrowser).toHaveBeenCalledOnce();
    const closing = runtime.close();
    let closeSettled = false;
    void closing.finally(() => {
      closeSettled = true;
    });
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    resolveLaunch!({ close: closeBrowser });

    await expect(starting).rejects.toThrow('closed during browser startup');
    await closing;
    expect(closeBrowser).toHaveBeenCalledOnce();
    await expect(healthStatus()).rejects.toBeDefined();
  });

  it('tears down even when a terminal observer throws', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gfx-runtime-observer-'));
    directories.push(directory);
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><html><head></head><body>runtime</body></html>',
    );
    const closeBrowser = vi.fn(async () => undefined);
    const runtime = new CompanionRuntime({
      allowEdit: false,
      allowAssets: false,
      allowModel: false,
      appDirectory: directory,
      launchBrowser: async () => ({ close: closeBrowser }),
      onBridgeTerminated: () => {
        throw new Error('observer failure');
      },
    });
    runtimes.push(runtime);
    await runtime.start();

    expect(() => runtime.bridge.close('simulated terminal fault')).not.toThrow();
    await runtime.close();

    expect(closeBrowser).toHaveBeenCalledOnce();
    await expect(healthStatus()).rejects.toBeDefined();
  });
});
