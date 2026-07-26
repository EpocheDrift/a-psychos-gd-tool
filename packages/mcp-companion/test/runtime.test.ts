import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompanionRuntime } from '../src/runtime.js';

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
