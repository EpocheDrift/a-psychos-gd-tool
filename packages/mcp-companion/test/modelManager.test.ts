import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { FileModelCache } from '../src/modelCache.js';
import type {
  ModelArtifactDownloader,
  OpenedModelArtifact,
} from '../src/modelDownloader.js';
import {
  ModelManager,
  OneShotModelApprovalGate,
  type ModelApprovalDecision,
  type ModelDownloadApprovalRequest,
} from '../src/modelManager.js';
import {
  FIXTURE_MODEL_FILES,
  FIXTURE_REVISION,
  FixtureModelDownloader,
  fixtureModelManifest,
} from './modelTestFixtures.js';

let cacheRoot = '';

beforeEach(async () => {
  cacheRoot = await mkdtemp(join(tmpdir(), 'gfx-model-cache-'));
});

afterEach(async () => {
  if (cacheRoot) {
    await rm(cacheRoot, { recursive: true, force: true });
  }
});

function approved(
  request: ModelDownloadApprovalRequest,
): ModelApprovalDecision {
  return {
    approved: true,
    approvedBy: 'local-user',
    requestSha256: request.requestSha256,
    modelKey: request.model.modelKey,
    manifestSha256: request.model.manifestSha256,
    licenseId: request.license.id,
  };
}

function denied(
  request: ModelDownloadApprovalRequest,
): ModelApprovalDecision {
  return {
    approved: false,
    requestSha256: request.requestSha256,
    modelKey: request.model.modelKey,
    manifestSha256: request.model.manifestSha256,
    licenseId: request.license.id,
  };
}

function modelDirectory(): string {
  return join(cacheRoot, 'rmbg-1.4', FIXTURE_REVISION);
}

async function exists(pathname: string): Promise<boolean> {
  try {
    await lstat(pathname);
    return true;
  } catch (error) {
    return Boolean(
      error
      && typeof error === 'object'
      && 'code' in error
      && error.code !== 'ENOENT',
    );
  }
}

async function readAll(
  source: AsyncIterable<Uint8Array>,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function makeManager(options: {
  downloader?: ModelArtifactDownloader;
  requestApproval?: (
    request: ModelDownloadApprovalRequest,
    signal: AbortSignal,
  ) => Promise<ModelApprovalDecision>;
} = {}): {
  manager: ModelManager;
  downloader: ModelArtifactDownloader;
  requestApproval: ReturnType<typeof vi.fn>;
} {
  const downloader =
    options.downloader ?? new FixtureModelDownloader();
  const requestApproval = vi.fn(
    options.requestApproval
      ?? (async (request: ModelDownloadApprovalRequest) => (
        approved(request)
      )),
  );
  const manager = new ModelManager({
    manifest: fixtureModelManifest(),
    cache: new FileModelCache(cacheRoot),
    downloader,
    approvalProvider: { requestApproval },
    now: () => new Date('2026-07-26T12:34:56.000Z'),
  });
  return { manager, downloader, requestApproval };
}

describe('managed RMBG model preparation', () => {
  it('consumes one exact short-lived human approval', async () => {
    let now = 1_000;
    const gate = new OneShotModelApprovalGate({
      now: () => now,
      ttlMs: 100,
    });
    const manager = new ModelManager({
      manifest: fixtureModelManifest(),
      cache: new FileModelCache(cacheRoot),
      downloader: new FixtureModelDownloader(),
      approvalProvider: gate,
    });

    await expect(manager.prepare({
      requestId: 'agent-cannot-approve',
    })).rejects.toMatchObject({ code: 'MODEL_APPROVAL_DENIED' });

    gate.arm({
      schemaVersion: 1,
      kind: 'model-download-approval',
      requestId: 'expired-approval',
      approved: true,
      modelKey: 'rmbg-1.4',
      manifestSha256: manager.manifestSha256,
      licenseId: 'bria-rmbg-1.4',
    });
    now += 101;
    await expect(manager.prepare({
      requestId: 'expired-approval',
    })).rejects.toMatchObject({ code: 'MODEL_APPROVAL_DENIED' });

    gate.arm({
      schemaVersion: 1,
      kind: 'model-download-approval',
      requestId: 'human-approved',
      approved: true,
      modelKey: 'rmbg-1.4',
      manifestSha256: manager.manifestSha256,
      licenseId: 'bria-rmbg-1.4',
    });
    await expect(manager.prepare({
      requestId: 'human-approved',
    })).resolves.toMatchObject({ state: 'ready' });
    gate.clear();
  });

  it('requires one bound local approval before the first download', async () => {
    const fixtureDownloader = new FixtureModelDownloader();
    const { manager, requestApproval } = makeManager({
      downloader: fixtureDownloader,
    });

    const initial = await manager.status();
    expect(initial).toMatchObject({
      schemaVersion: 1,
      modelKey: 'rmbg-1.4',
      state: 'not-installed',
      bytes: 0,
      license: {
        id: 'bria-rmbg-1.4',
        requiresExplicitApproval: true,
      },
    });
    expect(initial.artifacts.every(
      (artifact) => artifact.state === 'missing',
    )).toBe(true);
    expect(JSON.stringify(initial)).not.toContain('http');
    expect(JSON.stringify(initial)).not.toContain(cacheRoot);

    const ready = await manager.prepare({ requestId: 'prepare-1' });
    expect(ready.state).toBe('ready');
    expect(ready.bytes).toBe(ready.totalBytes);
    expect(ready.artifacts.every(
      (artifact) => artifact.state === 'ready',
    )).toBe(true);
    expect(requestApproval).toHaveBeenCalledOnce();
    const approvalRequest = requestApproval.mock.calls[0]?.[0] as
      ModelDownloadApprovalRequest;
    expect(approvalRequest).toMatchObject({
      kind: 'model-download-approval',
      requestId: 'prepare-1',
      source: {
        host: 'huggingface.co',
        repository: 'briaai/RMBG-1.4',
      },
      model: {
        modelKey: 'rmbg-1.4',
        artifactCount: 3,
      },
    });
    expect(Object.isFrozen(approvalRequest)).toBe(true);
    expect(fixtureDownloader.openCalls).toEqual([
      'preprocessor-config',
      'onnx-fp32',
      'onnx-q8',
    ]);
    expect(await readFile(
      join(modelDirectory(), 'preprocessor_config.json'),
    )).toEqual(FIXTURE_MODEL_FILES['preprocessor-config']);
    expect(await readFile(
      join(modelDirectory(), 'onnx', 'model.onnx'),
    )).toEqual(FIXTURE_MODEL_FILES['onnx-fp32']);

    const receipt = JSON.parse(await readFile(
      join(modelDirectory(), '.install-receipt.json'),
      'utf8',
    )) as Record<string, unknown>;
    expect(receipt).toMatchObject({
      manifestSha256: ready.manifestSha256,
      approvalRequestSha256: approvalRequest.requestSha256,
      approvedAt: '2026-07-26T12:34:56.000Z',
      approvedBy: 'local-user',
    });
    expect(JSON.stringify(receipt)).not.toContain('http');
    expect(JSON.stringify(receipt)).not.toContain(cacheRoot);

    const alreadyReady = await manager.prepare({
      requestId: 'prepare-again',
    });
    expect(alreadyReady.state).toBe('ready');
    expect(requestApproval).toHaveBeenCalledOnce();
    expect(fixtureDownloader.openCalls).toHaveLength(3);

    const opened = await manager.openVerifiedArtifact(
      'preprocessor-config',
      { range: { start: 1, endExclusive: 6 } },
    );
    expect(opened).toMatchObject({
      id: 'preprocessor-config',
      mediaType: 'application/json',
      byteLength:
        FIXTURE_MODEL_FILES['preprocessor-config'].byteLength,
      range: { start: 1, endExclusive: 6 },
    });
    expect(await readAll(opened.body)).toEqual(
      FIXTURE_MODEL_FILES['preprocessor-config'].subarray(1, 6),
    );
    await opened.close();
    expect(JSON.stringify(opened)).not.toContain(cacheRoot);

    await writeFile(
      join(modelDirectory(), 'preprocessor_config.json'),
      Buffer.alloc(
        FIXTURE_MODEL_FILES['preprocessor-config'].byteLength,
        0x78,
      ),
    );
    await expect(manager.openVerifiedArtifact(
      'preprocessor-config',
    )).rejects.toMatchObject({
      code: 'MODEL_ARTIFACT_HASH_MISMATCH',
    });
  });

  it('does not open the downloader when approval is denied or drifts', async () => {
    const deniedDownloader = new FixtureModelDownloader();
    const deniedManager = makeManager({
      downloader: deniedDownloader,
      requestApproval: async (request) => denied(request),
    }).manager;
    await expect(deniedManager.prepare({
      requestId: 'denied',
    })).rejects.toMatchObject({
      code: 'MODEL_APPROVAL_DENIED',
    });
    expect(deniedDownloader.openCalls).toEqual([]);

    const driftDownloader = new FixtureModelDownloader();
    const driftManager = makeManager({
      downloader: driftDownloader,
      requestApproval: async (request) => ({
        ...approved(request),
        manifestSha256: '0'.repeat(64),
      }),
    }).manager;
    await expect(driftManager.prepare({
      requestId: 'drifted',
    })).rejects.toMatchObject({
      code: 'MODEL_APPROVAL_INVALID',
    });
    expect(driftDownloader.openCalls).toEqual([]);
    expect(await readdir(cacheRoot)).toEqual([]);
  });

  it('rejects extra request fields before approval or network access', async () => {
    const fixtureDownloader = new FixtureModelDownloader();
    const { manager, requestApproval } = makeManager({
      downloader: fixtureDownloader,
    });
    await expect(manager.prepare({
      requestId: 'request-with-url',
      url: 'https://attacker.invalid/model',
    } as never)).rejects.toMatchObject({
      code: 'MODEL_PREPARATION_REQUEST_INVALID',
    });
    expect(requestApproval).not.toHaveBeenCalled();
    expect(fixtureDownloader.openCalls).toEqual([]);
  });

  it('removes staging data and exposes no final directory on hash failure', async () => {
    const corrupted = Buffer.from(FIXTURE_MODEL_FILES['onnx-q8']);
    corrupted[0] = corrupted[0]! ^ 0xff;
    const fixtureDownloader = new FixtureModelDownloader({
      ...FIXTURE_MODEL_FILES,
      'onnx-q8': corrupted,
    });
    const { manager } = makeManager({ downloader: fixtureDownloader });

    await expect(manager.prepare({
      requestId: 'corrupt-download',
    })).rejects.toMatchObject({
      code: 'MODEL_ARTIFACT_HASH_MISMATCH',
    });
    expect(await exists(modelDirectory())).toBe(false);
    expect(await readdir(join(cacheRoot, 'rmbg-1.4'))).toEqual([]);
    const failed = await manager.status();
    expect(failed).toMatchObject({
      state: 'failed',
      error: { code: 'MODEL_ARTIFACT_HASH_MISMATCH' },
    });
  });

  it('single-flights and briefly caches concurrent status inspections', async () => {
    const cache = new FileModelCache(cacheRoot);
    const inspect = vi.spyOn(cache, 'inspect');
    const manager = new ModelManager({
      manifest: fixtureModelManifest(),
      cache,
      downloader: new FixtureModelDownloader(),
      approvalProvider: {
        requestApproval: async (request) => approved(request),
      },
    });

    const statuses = await Promise.all([
      manager.status(),
      manager.status(),
      manager.status(),
    ]);
    expect(statuses.every((status) => status.state === 'not-installed'))
      .toBe(true);
    expect(inspect).toHaveBeenCalledOnce();
    await expect(manager.status()).resolves.toMatchObject({
      state: 'not-installed',
    });
    expect(inspect).toHaveBeenCalledOnce();
  });

  it('detects installed corruption and requires approval to repair it', async () => {
    const first = makeManager();
    await first.manager.prepare({ requestId: 'initial-install' });
    const quantizedPath = join(
      modelDirectory(),
      'onnx',
      'model_quantized.onnx',
    );
    const corrupted = Buffer.from(FIXTURE_MODEL_FILES['onnx-q8']);
    corrupted[0] = corrupted[0]! ^ 0xff;
    await writeFile(quantizedPath, corrupted);

    const repairDownloader = new FixtureModelDownloader();
    const repaired = makeManager({ downloader: repairDownloader });
    const corruptStatus = await repaired.manager.status();
    expect(corruptStatus).toMatchObject({
      state: 'failed',
      error: { code: 'MODEL_CACHE_CORRUPT' },
    });
    expect(corruptStatus.artifacts.map((artifact) => artifact.state))
      .toEqual(['ready', 'ready', 'invalid']);

    const ready = await repaired.manager.prepare({
      requestId: 'repair-install',
    });
    expect(ready.state).toBe('ready');
    expect(repaired.requestApproval).toHaveBeenCalledOnce();
    expect(repairDownloader.openCalls).toHaveLength(3);
  });

  it('keeps the final directory invisible until promotion', async () => {
    let releaseFirst = () => {};
    const released = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fixtureDownloader = new FixtureModelDownloader();
    let first = true;
    const delayedDownloader: ModelArtifactDownloader = {
      open: async (manifest, artifactId, signal) => {
        const opened = await fixtureDownloader.open(
          manifest,
          artifactId,
          signal,
        );
        if (!first) return opened;
        first = false;
        const delayedBody = async function* (): AsyncIterable<Uint8Array> {
          markStarted();
          await released;
          for await (const chunk of opened.body) yield chunk;
        };
        return {
          ...opened,
          body: delayedBody(),
        } satisfies OpenedModelArtifact;
      },
    };
    const { manager } = makeManager({ downloader: delayedDownloader });
    const preparing = manager.prepare({ requestId: 'atomic-install' });
    await started;

    expect(await exists(modelDirectory())).toBe(false);
    const modelRootEntries = await readdir(join(cacheRoot, 'rmbg-1.4'));
    expect(modelRootEntries).toHaveLength(1);
    expect(modelRootEntries[0]).toMatch(/\.partial-/);
    await expect(manager.prepare({
      requestId: 'concurrent-install',
    })).rejects.toMatchObject({ code: 'MODEL_INSTALL_BUSY' });

    releaseFirst();
    await expect(preparing).resolves.toMatchObject({ state: 'ready' });
    expect(await exists(modelDirectory())).toBe(true);
  });

  it('honors cancellation before invoking the approval provider', async () => {
    const { manager, requestApproval, downloader } = makeManager();
    const controller = new AbortController();
    controller.abort();

    await expect(manager.prepare(
      { requestId: 'cancelled' },
      controller.signal,
    )).rejects.toMatchObject({
      code: 'MODEL_PREPARATION_ABORTED',
    });
    expect(requestApproval).not.toHaveBeenCalled();
    expect((downloader as FixtureModelDownloader).openCalls).toEqual([]);
  });
});
