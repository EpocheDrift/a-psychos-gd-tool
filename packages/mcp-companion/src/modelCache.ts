import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  dirname,
  join,
  parse,
  resolve,
  sep,
} from 'node:path';
import type {
  ModelArtifactDownloader,
  OpenedModelArtifact,
} from './modelDownloader.js';
import {
  assertModelManifest,
  modelArtifact,
  totalModelBytes,
  type ModelArtifactManifest,
  type ModelManifest,
} from './modelManifest.js';

const CACHE_NAMESPACE = 'models-v1';
const RECEIPT_FILE_NAME = '.install-receipt.json';
const MAX_RECEIPT_BYTES = 8 * 1024;
const HASH_BUFFER_BYTES = 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type ModelCacheInspection =
  | {
    readonly kind: 'missing';
    readonly verifiedBytes: 0;
  }
  | {
    readonly kind: 'ready';
    readonly verifiedBytes: number;
  }
  | {
    readonly kind: 'corrupt';
    readonly verifiedBytes: number;
    readonly reason:
      | 'artifact'
      | 'cache-entry'
      | 'receipt';
  };

export interface ModelInstallAuthorization {
  readonly approvalRequestSha256: string;
  readonly approvedAt: string;
  readonly approvedBy: 'local-user';
}

export interface ModelInstallProgress {
  readonly phase: 'downloading' | 'verifying';
  readonly artifactId: string;
  readonly completedBytes: number;
  readonly totalBytes: number;
}

export interface ModelInstallRequest {
  readonly manifest: ModelManifest;
  readonly manifestSha256: string;
  readonly authorization: ModelInstallAuthorization;
  readonly downloader: ModelArtifactDownloader;
  readonly signal: AbortSignal;
  readonly installedAt: string;
  readonly onProgress?: (progress: ModelInstallProgress) => void;
}

export interface ModelCache {
  inspect(
    manifest: ModelManifest,
    manifestSha256: string,
    signal?: AbortSignal,
  ): Promise<ModelCacheInspection>;
  install(request: ModelInstallRequest): Promise<ModelCacheInspection>;
  openVerifiedArtifact(
    request: OpenVerifiedModelArtifactRequest,
  ): Promise<OpenedVerifiedModelArtifact>;
}

export interface ModelArtifactReadRange {
  readonly start: number;
  readonly endExclusive: number;
}

export interface OpenVerifiedModelArtifactRequest {
  readonly manifest: ModelManifest;
  readonly manifestSha256: string;
  readonly artifactId: string;
  readonly range?: ModelArtifactReadRange;
  readonly signal?: AbortSignal;
}

export interface OpenedVerifiedModelArtifact {
  readonly id: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly range: ModelArtifactReadRange;
  readonly body: AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}

export type ModelCacheErrorCode =
  | 'MODEL_ARTIFACT_HASH_MISMATCH'
  | 'MODEL_ARTIFACT_SIZE_MISMATCH'
  | 'MODEL_CACHE_ABORTED'
  | 'MODEL_CACHE_ENTRY_UNSAFE'
  | 'MODEL_CACHE_PROMOTION_FAILED';

export class ModelCacheError extends Error {
  readonly code: ModelCacheErrorCode;

  constructor(code: ModelCacheErrorCode, message: string) {
    super(message);
    this.name = 'ModelCacheError';
    this.code = code;
  }
}

interface InstallReceipt {
  readonly schemaVersion: 1;
  readonly modelKey: string;
  readonly revision: string;
  readonly manifestSha256: string;
  readonly approvalRequestSha256: string;
  readonly approvedAt: string;
  readonly approvedBy: 'local-user';
  readonly installedAt: string;
}

function errorCode(error: unknown): string | undefined {
  if (
    error
    && typeof error === 'object'
    && 'code' in error
    && typeof error.code === 'string'
  ) {
    return error.code;
  }
  return undefined;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ModelCacheError(
      'MODEL_CACHE_ABORTED',
      'The model installation was cancelled.',
    );
  }
}

async function lstatOrNull(
  pathname: string,
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(pathname);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

function resolveInside(root: string, relativePath: string): string {
  const target = resolve(root, ...relativePath.split('/'));
  if (!target.startsWith(`${resolve(root)}${sep}`)) {
    throw new ModelCacheError(
      'MODEL_CACHE_ENTRY_UNSAFE',
      'The model cache path escaped its managed root.',
    );
  }
  return target;
}

async function assertRealDirectory(pathname: string): Promise<void> {
  const entry = await lstat(pathname);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new ModelCacheError(
      'MODEL_CACHE_ENTRY_UNSAFE',
      'The managed model cache contains an unsafe entry.',
    );
  }
}

async function syncDirectory(pathname: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(pathname, 'r');
    await handle.sync();
  } catch (error) {
    if (
      errorCode(error) !== 'EINVAL'
      && errorCode(error) !== 'ENOTSUP'
      && errorCode(error) !== 'EPERM'
      && errorCode(error) !== 'EISDIR'
    ) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function hashFile(
  pathname: string,
  signal?: AbortSignal,
): Promise<string> {
  const handle = await open(
    pathname,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    return await hashHandle(handle, signal);
  } finally {
    await handle.close();
  }
}

async function hashHandle(
  handle: Awaited<ReturnType<typeof open>>,
  signal?: AbortSignal,
): Promise<string> {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
  let position = 0;
  while (true) {
    throwIfAborted(signal);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      buffer.byteLength,
      position,
    );
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest('hex');
}

function sameOpenedEntry(
  left: {
    dev: number;
    ino: number;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
  },
  right: {
    dev: number;
    ino: number;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
  },
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function assertArtifactRange(
  artifact: ModelArtifactManifest,
  range?: ModelArtifactReadRange,
): ModelArtifactReadRange {
  const selected = range ?? {
    start: 0,
    endExclusive: artifact.byteLength,
  };
  if (
    !Number.isSafeInteger(selected.start)
    || !Number.isSafeInteger(selected.endExclusive)
    || selected.start < 0
    || selected.endExclusive <= selected.start
    || selected.endExclusive > artifact.byteLength
  ) {
    throw new ModelCacheError(
      'MODEL_CACHE_ENTRY_UNSAFE',
      'The requested model artifact range is invalid.',
    );
  }
  return Object.freeze({
    start: selected.start,
    endExclusive: selected.endExclusive,
  });
}

function openedArtifactBody(
  handle: Awaited<ReturnType<typeof open>>,
  range: ModelArtifactReadRange,
  signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
  return (async function* () {
    let position = range.start;
    while (position < range.endExclusive) {
      throwIfAborted(signal);
      const length = Math.min(
        HASH_BUFFER_BYTES,
        range.endExclusive - position,
      );
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        length,
        position,
      );
      if (bytesRead < 1) {
        throw new ModelCacheError(
          'MODEL_ARTIFACT_SIZE_MISMATCH',
          'The verified model artifact became incomplete.',
        );
      }
      position += bytesRead;
      yield buffer.subarray(0, bytesRead);
    }
  })();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 20
    && value.length <= 64
    && Number.isFinite(Date.parse(value));
}

async function readValidReceipt(
  directory: string,
  manifest: ModelManifest,
  manifestSha256: string,
): Promise<InstallReceipt | null> {
  const pathname = join(directory, RECEIPT_FILE_NAME);
  const entry = await lstatOrNull(pathname);
  if (
    !entry
    || !entry.isFile()
    || entry.isSymbolicLink()
    || entry.size < 2
    || entry.size > MAX_RECEIPT_BYTES
  ) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(pathname, 'utf8'));
  } catch {
    return null;
  }
  if (!isPlainRecord(value)) return null;
  const allowedKeys = new Set([
    'schemaVersion',
    'modelKey',
    'revision',
    'manifestSha256',
    'approvalRequestSha256',
    'approvedAt',
    'approvedBy',
    'installedAt',
  ]);
  if (!Object.keys(value).every((key) => allowedKeys.has(key))) {
    return null;
  }
  if (
    value.schemaVersion !== 1
    || value.modelKey !== manifest.modelKey
    || value.revision !== manifest.revision
    || value.manifestSha256 !== manifestSha256
    || typeof value.approvalRequestSha256 !== 'string'
    || !SHA256_PATTERN.test(value.approvalRequestSha256)
    || value.approvedBy !== 'local-user'
    || !isTimestamp(value.approvedAt)
    || !isTimestamp(value.installedAt)
  ) {
    return null;
  }
  return value as unknown as InstallReceipt;
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
): Promise<void> {
  const buffer = Buffer.from(bytes);
  let offset = 0;
  while (offset < buffer.byteLength) {
    const { bytesWritten } = await handle.write(
      buffer,
      offset,
      buffer.byteLength - offset,
      null,
    );
    if (bytesWritten < 1) {
      throw new Error('The model cache stopped accepting bytes.');
    }
    offset += bytesWritten;
  }
}

async function writeArtifact(
  stagingDirectory: string,
  artifact: ModelArtifactManifest,
  opened: OpenedModelArtifact,
  request: ModelInstallRequest,
  completedBeforeArtifact: number,
): Promise<void> {
  if (
    opened.contentLength !== undefined
    && opened.contentLength !== artifact.byteLength
  ) {
    throw new ModelCacheError(
      'MODEL_ARTIFACT_SIZE_MISMATCH',
      'The downloaded model artifact has the wrong size.',
    );
  }
  const finalPath = resolveInside(
    stagingDirectory,
    artifact.relativePath,
  );
  const partialPath = `${finalPath}.partial`;
  await mkdir(dirname(finalPath), { recursive: true, mode: 0o700 });
  const hash = createHash('sha256');
  let received = 0;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(partialPath, 'wx', 0o600);
    for await (const chunk of opened.body) {
      throwIfAborted(request.signal);
      if (!(chunk instanceof Uint8Array) || chunk.byteLength < 1) {
        throw new ModelCacheError(
          'MODEL_ARTIFACT_SIZE_MISMATCH',
          'The model host returned an invalid data chunk.',
        );
      }
      if (received + chunk.byteLength > artifact.byteLength) {
        throw new ModelCacheError(
          'MODEL_ARTIFACT_SIZE_MISMATCH',
          'The downloaded model artifact exceeded its fixed size.',
        );
      }
      await writeAll(handle, chunk);
      hash.update(chunk);
      received += chunk.byteLength;
      request.onProgress?.({
        phase: 'downloading',
        artifactId: artifact.id,
        completedBytes: completedBeforeArtifact + received,
        totalBytes: totalModelBytes(request.manifest),
      });
    }
    request.onProgress?.({
      phase: 'verifying',
      artifactId: artifact.id,
      completedBytes: completedBeforeArtifact + received,
      totalBytes: totalModelBytes(request.manifest),
    });
    if (received !== artifact.byteLength) {
      throw new ModelCacheError(
        'MODEL_ARTIFACT_SIZE_MISMATCH',
        'The downloaded model artifact is incomplete.',
      );
    }
    if (hash.digest('hex') !== artifact.sha256) {
      throw new ModelCacheError(
        'MODEL_ARTIFACT_HASH_MISMATCH',
        'The downloaded model artifact failed SHA-256 verification.',
      );
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(partialPath, finalPath);
    await syncDirectory(dirname(finalPath));
  } catch (error) {
    await handle?.close();
    await rm(partialPath, { force: true });
    throw error;
  }
}

async function writeReceipt(
  stagingDirectory: string,
  request: ModelInstallRequest,
): Promise<void> {
  const receipt: InstallReceipt = {
    schemaVersion: 1,
    modelKey: request.manifest.modelKey,
    revision: request.manifest.revision,
    manifestSha256: request.manifestSha256,
    approvalRequestSha256:
      request.authorization.approvalRequestSha256,
    approvedAt: request.authorization.approvedAt,
    approvedBy: request.authorization.approvedBy,
    installedAt: request.installedAt,
  };
  const pathname = join(stagingDirectory, RECEIPT_FILE_NAME);
  const handle = await open(pathname, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(receipt)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function managedModelCacheDirectory(): string {
  let base: string;
  if (process.platform === 'darwin') {
    base = join(homedir(), 'Library', 'Caches');
  } else if (process.platform === 'win32') {
    base = process.env.LOCALAPPDATA
      ? resolve(process.env.LOCALAPPDATA)
      : join(homedir(), 'AppData', 'Local');
  } else {
    base = process.env.XDG_CACHE_HOME
      ? resolve(process.env.XDG_CACHE_HOME)
      : join(homedir(), '.cache');
  }
  return join(base, 'a-psychos-gd-tool', CACHE_NAMESPACE);
}

export class FileModelCache implements ModelCache {
  private readonly rootDirectory: string;

  constructor(rootDirectory = managedModelCacheDirectory()) {
    const absolute = resolve(rootDirectory);
    if (
      absolute === parse(absolute).root
      || absolute.length <= parse(absolute).root.length
    ) {
      throw new ModelCacheError(
        'MODEL_CACHE_ENTRY_UNSAFE',
        'The model cache root is too broad.',
      );
    }
    this.rootDirectory = absolute;
  }

  async inspect(
    manifest: ModelManifest,
    manifestSha256: string,
    signal?: AbortSignal,
  ): Promise<ModelCacheInspection> {
    assertModelManifest(manifest);
    if (!SHA256_PATTERN.test(manifestSha256)) {
      throw new Error('The model manifest digest is invalid.');
    }
    throwIfAborted(signal);
    const finalDirectory = this.finalDirectory(manifest);
    const finalEntry = await lstatOrNull(finalDirectory);
    if (!finalEntry) return { kind: 'missing', verifiedBytes: 0 };
    if (!finalEntry.isDirectory() || finalEntry.isSymbolicLink()) {
      return {
        kind: 'corrupt',
        verifiedBytes: 0,
        reason: 'cache-entry',
      };
    }
    const receipt = await readValidReceipt(
      finalDirectory,
      manifest,
      manifestSha256,
    );
    if (!receipt) {
      return {
        kind: 'corrupt',
        verifiedBytes: 0,
        reason: 'receipt',
      };
    }
    let verifiedBytes = 0;
    for (const artifact of manifest.artifacts) {
      throwIfAborted(signal);
      const pathname = resolveInside(
        finalDirectory,
        artifact.relativePath,
      );
      const entry = await lstatOrNull(pathname);
      if (
        !entry
        || !entry.isFile()
        || entry.isSymbolicLink()
        || entry.size !== artifact.byteLength
        || await hashFile(pathname, signal) !== artifact.sha256
      ) {
        return {
          kind: 'corrupt',
          verifiedBytes,
          reason: 'artifact',
        };
      }
      verifiedBytes += artifact.byteLength;
    }
    return { kind: 'ready', verifiedBytes };
  }

  async install(
    request: ModelInstallRequest,
  ): Promise<ModelCacheInspection> {
    assertModelManifest(request.manifest);
    if (
      !SHA256_PATTERN.test(request.manifestSha256)
      || !SHA256_PATTERN.test(
        request.authorization.approvalRequestSha256,
      )
      || request.authorization.approvedBy !== 'local-user'
      || !isTimestamp(request.authorization.approvedAt)
      || !isTimestamp(request.installedAt)
    ) {
      throw new Error('The model installation receipt is invalid.');
    }
    throwIfAborted(request.signal);
    const modelDirectory = this.modelDirectory(request.manifest);
    const finalDirectory = this.finalDirectory(request.manifest);
    await mkdir(modelDirectory, { recursive: true, mode: 0o700 });
    await assertRealDirectory(this.rootDirectory);
    await assertRealDirectory(modelDirectory);

    const existing = await this.inspect(
      request.manifest,
      request.manifestSha256,
      request.signal,
    );
    if (existing.kind === 'ready') return existing;
    const finalEntry = await lstatOrNull(finalDirectory);
    if (finalEntry) {
      if (!finalEntry.isDirectory() || finalEntry.isSymbolicLink()) {
        throw new ModelCacheError(
          'MODEL_CACHE_ENTRY_UNSAFE',
          'The managed model cache contains an unsafe final entry.',
        );
      }
      await rm(finalDirectory, { recursive: true, force: true });
    }

    const stagingDirectory = await mkdtemp(join(
      modelDirectory,
      `.${request.manifest.revision}.partial-`,
    ));
    let promoted = false;
    try {
      let completedBytes = 0;
      for (const artifact of request.manifest.artifacts) {
        throwIfAborted(request.signal);
        const opened = await request.downloader.open(
          request.manifest,
          artifact.id,
          request.signal,
        );
        try {
          await writeArtifact(
            stagingDirectory,
            artifact,
            opened,
            request,
            completedBytes,
          );
        } finally {
          opened.close();
        }
        completedBytes += artifact.byteLength;
      }
      await writeReceipt(stagingDirectory, request);
      await syncDirectory(stagingDirectory);
      try {
        await rename(stagingDirectory, finalDirectory);
        promoted = true;
      } catch (error) {
        if (
          errorCode(error) !== 'EEXIST'
          && errorCode(error) !== 'ENOTEMPTY'
        ) {
          throw error;
        }
        const winner = await this.inspect(
          request.manifest,
          request.manifestSha256,
          request.signal,
        );
        if (winner.kind !== 'ready') {
          throw new ModelCacheError(
            'MODEL_CACHE_PROMOTION_FAILED',
            'The verified model could not be promoted atomically.',
          );
        }
        return winner;
      }
      await syncDirectory(modelDirectory);
      return {
        kind: 'ready',
        verifiedBytes: totalModelBytes(request.manifest),
      };
    } finally {
      if (!promoted) {
        await rm(stagingDirectory, { recursive: true, force: true });
      }
    }
  }

  async openVerifiedArtifact(
    request: OpenVerifiedModelArtifactRequest,
  ): Promise<OpenedVerifiedModelArtifact> {
    assertModelManifest(request.manifest);
    if (!SHA256_PATTERN.test(request.manifestSha256)) {
      throw new Error('The model manifest digest is invalid.');
    }
    throwIfAborted(request.signal);
    const artifact = modelArtifact(
      request.manifest,
      request.artifactId,
    );
    const range = assertArtifactRange(artifact, request.range);
    const finalDirectory = this.finalDirectory(request.manifest);
    const directoryEntry = await lstatOrNull(finalDirectory);
    if (
      !directoryEntry
      || !directoryEntry.isDirectory()
      || directoryEntry.isSymbolicLink()
      || !await readValidReceipt(
        finalDirectory,
        request.manifest,
        request.manifestSha256,
      )
    ) {
      throw new ModelCacheError(
        'MODEL_CACHE_ENTRY_UNSAFE',
        'The verified model cache entry is unavailable.',
      );
    }

    const pathname = resolveInside(
      finalDirectory,
      artifact.relativePath,
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        pathname,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      const before = await handle.stat();
      if (
        !before.isFile()
        || before.size !== artifact.byteLength
        || await hashHandle(handle, request.signal) !== artifact.sha256
      ) {
        throw new ModelCacheError(
          'MODEL_ARTIFACT_HASH_MISMATCH',
          'The cached model artifact failed integrity verification.',
        );
      }
      const after = await handle.stat();
      if (!sameOpenedEntry(before, after)) {
        throw new ModelCacheError(
          'MODEL_CACHE_ENTRY_UNSAFE',
          'The cached model artifact changed during verification.',
        );
      }
      const openedHandle = handle;
      handle = undefined;
      let closed = false;
      return Object.freeze({
        id: artifact.id,
        mediaType: artifact.mediaType,
        byteLength: artifact.byteLength,
        range,
        body: openedArtifactBody(
          openedHandle,
          range,
          request.signal,
        ),
        close: async () => {
          if (closed) return;
          closed = true;
          await openedHandle.close();
        },
      });
    } catch (error) {
      await handle?.close();
      if (
        errorCode(error) === 'ELOOP'
        || errorCode(error) === 'EMLINK'
      ) {
        throw new ModelCacheError(
          'MODEL_CACHE_ENTRY_UNSAFE',
          'The cached model artifact entry is unsafe.',
        );
      }
      throw error;
    }
  }

  private modelDirectory(manifest: ModelManifest): string {
    return resolveInside(this.rootDirectory, manifest.modelKey);
  }

  private finalDirectory(manifest: ModelManifest): string {
    return resolveInside(
      this.modelDirectory(manifest),
      manifest.revision,
    );
  }
}
