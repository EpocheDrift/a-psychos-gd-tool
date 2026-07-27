import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { BridgeClient } from '../src/bridgeClient.js';
import { LocalAppHost } from '../src/localAppHost.js';
import { FileModelCache } from '../src/modelCache.js';
import type {
  ModelArtifactDownloader,
  OpenedModelArtifact,
} from '../src/modelDownloader.js';
import {
  ModelManager,
  OneShotModelApprovalGate,
} from '../src/modelManager.js';
import {
  MODEL_PREPARE_PATH,
  MODEL_STATUS_PATH,
  modelArtifactLocalPath,
} from '../src/modelManifest.js';
import {
  AGENT_ALLOWED_ORIGIN,
  AGENT_COOKIE_NAME,
} from '../src/agentSecurity.js';
import {
  FIXTURE_MODEL_FILES,
  FixtureModelDownloader,
  fixtureModelManifest,
} from './modelTestFixtures.js';

let fixtureDirectory = '';
let cacheDirectory = '';
let host: LocalAppHost | null = null;
let bridge: BridgeClient | null = null;
let manager: ModelManager;
let gate: OneShotModelApprovalGate;
let downloader: FixtureModelDownloader;

beforeEach(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'gfx-model-host-'));
  cacheDirectory = join(fixtureDirectory, 'managed-cache');
  await writeFile(
    join(fixtureDirectory, 'index.html'),
    '<!doctype html><html><head></head><body>model fixture</body></html>',
  );
  bridge = new BridgeClient({ requestedScopes: ['read', 'preview', 'model'] });
  gate = new OneShotModelApprovalGate();
  downloader = new FixtureModelDownloader();
  manager = new ModelManager({
    manifest: fixtureModelManifest(),
    cache: new FileModelCache(cacheDirectory),
    downloader,
    approvalProvider: gate,
  });
  host = new LocalAppHost({
    bridge,
    appDirectory: fixtureDirectory,
    modelManager: manager,
    modelApprovalGate: gate,
  });
  await host.start();
});

afterEach(async () => {
  await host?.close();
  host = null;
  bridge = null;
  if (fixtureDirectory) {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

interface HttpResult {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly bytes: Buffer;
  readonly body: string;
}

function cookie(): string {
  return `${AGENT_COOKIE_NAME}=${host!.bootstrapToken}`;
}

function httpCall(options: {
  path: string;
  method?: string;
  cookie?: string;
  origin?: string;
  contentType?: string;
  body?: string | Buffer;
  range?: string;
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const outgoing = request({
      hostname: '127.0.0.1',
      port: 5199,
      path: options.path,
      method: options.method ?? 'GET',
      headers: {
        Host: '127.0.0.1:5199',
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.origin ? { Origin: options.origin } : {}),
        ...(options.contentType
          ? { 'Content-Type': options.contentType }
          : {}),
        ...(options.range ? { Range: options.range } : {}),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('end', () => {
        const bytes = Buffer.concat(chunks);
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          bytes,
          body: bytes.toString('utf8'),
        });
      });
    });
    outgoing.once('error', reject);
    outgoing.end(options.body);
  });
}

function approvalBody(
  requestId: string,
  patch: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: 'model-download-approval',
    requestId,
    approved: true,
    modelKey: 'rmbg-1.4',
    manifestSha256: manager.manifestSha256,
    licenseId: 'bria-rmbg-1.4',
    ...patch,
  });
}

async function waitForReady(): Promise<void> {
  await expect.poll(
    async () => (await manager.status()).state,
    { timeout: 5_000 },
  ).toBe('ready');
}

describe('human-only model host routes', () => {
  it('requires cookie, exact Origin, content type, and exact bounded body', async () => {
    expect((await httpCall({ path: MODEL_STATUS_PATH })).status).toBe(401);
    expect((await httpCall({
      path: MODEL_STATUS_PATH,
      cookie: cookie(),
    })).status).toBe(200);

    const validBody = approvalBody('prepare-secure');
    expect((await httpCall({
      path: MODEL_PREPARE_PATH,
      method: 'POST',
      cookie: cookie(),
      contentType: 'application/json',
      body: validBody,
    })).status).toBe(403);
    expect((await httpCall({
      path: MODEL_PREPARE_PATH,
      method: 'POST',
      cookie: cookie(),
      origin: 'https://attacker.invalid',
      contentType: 'application/json',
      body: validBody,
    })).status).toBe(403);
    expect((await httpCall({
      path: MODEL_PREPARE_PATH,
      method: 'POST',
      cookie: cookie(),
      origin: AGENT_ALLOWED_ORIGIN,
      contentType: 'application/json; charset=utf-8',
      body: validBody,
    })).status).toBe(415);
    expect((await httpCall({
      path: MODEL_PREPARE_PATH,
      method: 'POST',
      cookie: cookie(),
      origin: AGENT_ALLOWED_ORIGIN,
      contentType: 'application/json',
      body: approvalBody('extra-field', {
        url: 'https://attacker.invalid/model',
      }),
    })).status).toBe(400);
    expect((await httpCall({
      path: MODEL_PREPARE_PATH,
      method: 'POST',
      cookie: cookie(),
      origin: AGENT_ALLOWED_ORIGIN,
      contentType: 'application/json',
      body: approvalBody('wrong-manifest', {
        manifestSha256: '0'.repeat(64),
      }),
    })).status).toBe(409);
    expect((await httpCall({
      path: MODEL_PREPARE_PATH,
      method: 'POST',
      cookie: cookie(),
      origin: AGENT_ALLOWED_ORIGIN,
      contentType: 'application/json',
      body: Buffer.alloc(2_049, 0x20),
    })).status).toBe(413);
    expect(downloader.openCalls).toEqual([]);

    const accepted = await httpCall({
      path: MODEL_PREPARE_PATH,
      method: 'POST',
      cookie: cookie(),
      origin: AGENT_ALLOWED_ORIGIN,
      contentType: 'application/json',
      body: validBody,
    });
    expect(accepted.status).toBe(202);
    expect(JSON.parse(accepted.body)).toMatchObject({
      schemaVersion: 1,
      modelKey: 'rmbg-1.4',
      manifestSha256: manager.manifestSha256,
    });
    expect(accepted.body).not.toContain(cacheDirectory);
    expect(accepted.body).not.toContain('http');
    await waitForReady();
    expect(downloader.openCalls).toEqual([
      'preprocessor-config',
      'onnx-fp32',
      'onnx-q8',
    ]);
  });

  it('serves only exact verified artifacts with HEAD and one safe range', async () => {
    const accepted = await httpCall({
      path: MODEL_PREPARE_PATH,
      method: 'POST',
      cookie: cookie(),
      origin: AGENT_ALLOWED_ORIGIN,
      contentType: 'application/json',
      body: approvalBody('prepare-artifacts'),
    });
    expect(accepted.status).toBe(202);
    await waitForReady();

    const manifest = fixtureModelManifest();
    const pathname = modelArtifactLocalPath(
      manifest,
      'preprocessor-config',
    );
    const full = await httpCall({ path: pathname, cookie: cookie() });
    expect(full.status).toBe(200);
    expect(full.bytes).toEqual(
      FIXTURE_MODEL_FILES['preprocessor-config'],
    );
    expect(full.headers['accept-ranges']).toBe('bytes');

    const head = await httpCall({
      path: pathname,
      cookie: cookie(),
      method: 'HEAD',
    });
    expect(head.status).toBe(200);
    expect(head.bytes).toHaveLength(0);
    expect(Number(head.headers['content-length'])).toBe(
      FIXTURE_MODEL_FILES['preprocessor-config'].byteLength,
    );

    const range = await httpCall({
      path: pathname,
      cookie: cookie(),
      range: 'bytes=1-5',
    });
    expect(range.status).toBe(206);
    expect(range.bytes).toEqual(
      FIXTURE_MODEL_FILES['preprocessor-config'].subarray(1, 6),
    );
    expect(range.headers['content-range']).toBe(
      `bytes 1-5/${FIXTURE_MODEL_FILES['preprocessor-config'].byteLength}`,
    );

    expect((await httpCall({
      path: pathname,
      cookie: cookie(),
      range: 'bytes=999-1000',
    })).status).toBe(416);
    expect((await httpCall({
      path:
        '/__gfx_model_v1/files/briaai/RMBG-1.4/'
        + 'onnx/../preprocessor_config.json',
      cookie: cookie(),
    })).status).toBe(400);
    expect((await httpCall({
      path:
        '/__gfx_model_v1/files/briaai/RMBG-1.4/'
        + 'onnx/not-in-manifest.onnx',
      cookie: cookie(),
    })).status).toBe(404);

    await writeFile(
      join(
        cacheDirectory,
        'rmbg-1.4',
        manifest.revision,
        'preprocessor_config.json',
      ),
      Buffer.alloc(
        FIXTURE_MODEL_FILES['preprocessor-config'].byteLength,
        0x78,
      ),
    );
    const corrupt = await httpCall({ path: pathname, cookie: cookie() });
    expect(corrupt.status).toBe(409);
    expect(corrupt.body).toBe('Model Artifact Unavailable');
    expect(corrupt.body).not.toContain(cacheDirectory);
  });

  it('aborts an in-flight model download when the host closes', async () => {
    await host!.close();
    const started = vi.fn();
    const observedAbort = vi.fn();
    const delayedDownloader: ModelArtifactDownloader = {
      open: async (
        _manifest,
        _artifactId,
        signal,
      ): Promise<OpenedModelArtifact> => ({
        contentLength:
          FIXTURE_MODEL_FILES['preprocessor-config'].byteLength,
        body: (async function* () {
          started();
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            signal.addEventListener('abort', () => resolve(), {
              once: true,
            });
          });
          observedAbort(signal.aborted);
          throw new Error('fixture download aborted');
        })(),
        close: () => undefined,
      }),
    };
    gate = new OneShotModelApprovalGate();
    manager = new ModelManager({
      manifest: fixtureModelManifest(),
      cache: new FileModelCache(cacheDirectory),
      downloader: delayedDownloader,
      approvalProvider: gate,
    });
    host = new LocalAppHost({
      bridge: bridge!,
      appDirectory: fixtureDirectory,
      modelManager: manager,
      modelApprovalGate: gate,
    });
    await host.start();

    expect((await httpCall({
      path: MODEL_PREPARE_PATH,
      method: 'POST',
      cookie: cookie(),
      origin: AGENT_ALLOWED_ORIGIN,
      contentType: 'application/json',
      body: approvalBody('shutdown-abort'),
    })).status).toBe(202);
    await expect.poll(() => started.mock.calls.length).toBe(1);
    await host.close();
    expect(observedAbort).toHaveBeenCalledWith(true);
  });
});
