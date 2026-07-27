import { createHash, timingSafeEqual } from 'node:crypto';
import {
  FileModelCache,
  ModelCacheError,
  type ModelCache,
  type ModelCacheInspection,
  type ModelArtifactReadRange,
  type ModelInstallProgress,
  type OpenedVerifiedModelArtifact,
} from './modelCache.js';
import {
  ModelDownloadError,
  PinnedModelDownloader,
  type ModelArtifactDownloader,
} from './modelDownloader.js';
import {
  RMBG_MODEL_MANIFEST,
  RMBG_MODEL_MANIFEST_SHA256,
  assertPinnedRmbgManifest,
  cloneModelManifest,
  modelArtifact,
  modelArtifactIdFromLocalPath,
  modelManifestCanonicalJson,
  totalModelBytes,
  type ModelManifest,
  type PublicModelArtifactStatus,
  type PublicModelLicenseStatus,
  type PublicModelState,
  type PublicModelStatus,
} from './modelManifest.js';

const REQUEST_ID_PATTERN =
  /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const HUMAN_APPROVAL_TTL_MS = 30_000;
const STATUS_INSPECTION_TTL_MS = 5_000;

export interface ModelPreparationRequest {
  readonly requestId: string;
}

export interface HumanModelApprovalRequest {
  readonly schemaVersion: 1;
  readonly kind: 'model-download-approval';
  readonly requestId: string;
  readonly approved: true;
  readonly modelKey: 'rmbg-1.4';
  readonly manifestSha256: string;
  readonly licenseId: 'bria-rmbg-1.4';
}

export interface ModelDownloadApprovalRequest {
  readonly schemaVersion: 1;
  readonly kind: 'model-download-approval';
  readonly requestId: string;
  readonly requestSha256: string;
  readonly model: {
    readonly modelKey: 'rmbg-1.4';
    readonly displayName: string;
    readonly revision: string;
    readonly manifestSha256: string;
    readonly artifactCount: number;
    readonly totalBytes: number;
  };
  readonly license: PublicModelLicenseStatus;
  readonly source: {
    readonly host: 'huggingface.co';
    readonly repository: 'briaai/RMBG-1.4';
  };
}

interface ModelApprovalBinding {
  readonly requestSha256: string;
  readonly modelKey: 'rmbg-1.4';
  readonly manifestSha256: string;
  readonly licenseId: string;
}

export type ModelApprovalDecision =
  | (ModelApprovalBinding & {
    readonly approved: true;
    readonly approvedBy: 'local-user';
  })
  | (ModelApprovalBinding & {
    readonly approved: false;
  });

export interface ModelApprovalProvider {
  requestApproval(
    request: ModelDownloadApprovalRequest,
    signal: AbortSignal,
  ): Promise<ModelApprovalDecision>;
}

export interface OneShotModelApprovalGateOptions {
  readonly now?: () => number;
  readonly ttlMs?: number;
}

export type ModelManagerErrorCode =
  | 'MODEL_APPROVAL_DENIED'
  | 'MODEL_APPROVAL_FAILED'
  | 'MODEL_APPROVAL_INVALID'
  | 'MODEL_ARTIFACT_HASH_MISMATCH'
  | 'MODEL_ARTIFACT_SIZE_MISMATCH'
  | 'MODEL_CACHE_ABORTED'
  | 'MODEL_CACHE_CORRUPT'
  | 'MODEL_CACHE_ENTRY_UNSAFE'
  | 'MODEL_CACHE_PROMOTION_FAILED'
  | 'MODEL_DOWNLOAD_ABORTED'
  | 'MODEL_DOWNLOAD_HTTP_ERROR'
  | 'MODEL_DOWNLOAD_REDIRECT_REJECTED'
  | 'MODEL_DOWNLOAD_RESPONSE_INVALID'
  | 'MODEL_DOWNLOAD_TIMEOUT'
  | 'MODEL_INSTALL_BUSY'
  | 'MODEL_PREPARATION_ABORTED'
  | 'MODEL_PREPARATION_FAILED'
  | 'MODEL_PREPARATION_REQUEST_INVALID';

export class ModelManagerError extends Error {
  readonly code: ModelManagerErrorCode;
  readonly recoverable: boolean;

  constructor(
    code: ModelManagerErrorCode,
    message: string,
    recoverable = true,
  ) {
    super(message);
    this.name = 'ModelManagerError';
    this.code = code;
    this.recoverable = recoverable;
  }
}

export interface ModelManagerOptions {
  readonly approvalProvider: ModelApprovalProvider;
  readonly cache?: ModelCache;
  readonly downloader?: ModelArtifactDownloader;
  readonly manifest?: ModelManifest;
  readonly now?: () => Date;
}

export interface ManagedRmbgModelManagerOptions {
  readonly approvalProvider: ModelApprovalProvider;
  readonly now?: () => Date;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function sameSha256(left: string, right: string): boolean {
  if (!SHA256_PATTERN.test(left) || !SHA256_PATTERN.test(right)) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(left, 'hex'),
    Buffer.from(right, 'hex'),
  );
}

function publicLicense(
  manifest: ModelManifest,
): PublicModelLicenseStatus {
  return Object.freeze({
    id: manifest.license.id,
    name: manifest.license.name,
    summary: manifest.license.summary,
    commercialUse: manifest.license.commercialUse,
    requiresExplicitApproval: true,
  });
}

function freezeArtifacts(
  artifacts: readonly PublicModelArtifactStatus[],
): readonly PublicModelArtifactStatus[] {
  const frozen = artifacts.map((artifact) => Object.freeze(artifact));
  return Object.freeze(frozen);
}

function requestRecord(value: unknown): value is Record<string, unknown> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length
    && keys.every((key, index) => key === wanted[index]);
}

function assertHumanApprovalRequest(
  request: HumanModelApprovalRequest,
): void {
  if (
    !requestRecord(request)
    || !hasExactKeys(request, [
      'schemaVersion',
      'kind',
      'requestId',
      'approved',
      'modelKey',
      'manifestSha256',
      'licenseId',
    ])
    || request.schemaVersion !== 1
    || request.kind !== 'model-download-approval'
    || typeof request.requestId !== 'string'
    || !REQUEST_ID_PATTERN.test(request.requestId)
    || request.approved !== true
    || request.modelKey !== 'rmbg-1.4'
    || typeof request.manifestSha256 !== 'string'
    || !SHA256_PATTERN.test(request.manifestSha256)
    || request.licenseId !== 'bria-rmbg-1.4'
  ) {
    throw new ModelManagerError(
      'MODEL_PREPARATION_REQUEST_INVALID',
      'The human model approval request is invalid.',
      false,
    );
  }
}

interface ArmedHumanApproval {
  readonly request: HumanModelApprovalRequest;
  readonly expiresAt: number;
}

export class OneShotModelApprovalGate implements ModelApprovalProvider {
  private readonly now: () => number;
  private readonly ttlMs: number;
  private armed: ArmedHumanApproval | null = null;

  constructor(options: OneShotModelApprovalGateOptions = {}) {
    this.now = options.now ?? Date.now;
    const ttlMs = options.ttlMs ?? HUMAN_APPROVAL_TTL_MS;
    if (
      !Number.isSafeInteger(ttlMs)
      || ttlMs < 1
      || ttlMs > 120_000
    ) {
      throw new Error('The model approval lifetime is invalid.');
    }
    this.ttlMs = ttlMs;
  }

  arm(request: HumanModelApprovalRequest): void {
    assertHumanApprovalRequest(request);
    const now = this.now();
    if (!Number.isFinite(now)) {
      throw new Error('The model approval clock is invalid.');
    }
    if (this.armed && this.armed.expiresAt > now) {
      throw new ModelManagerError(
        'MODEL_INSTALL_BUSY',
        'A human model approval is already pending.',
      );
    }
    this.armed = {
      request: Object.freeze({ ...request }),
      expiresAt: now + this.ttlMs,
    };
  }

  clear(): void {
    this.armed = null;
  }

  async requestApproval(
    request: ModelDownloadApprovalRequest,
    signal: AbortSignal,
  ): Promise<ModelApprovalDecision> {
    const armed = this.armed;
    this.armed = null;
    const now = this.now();
    const matches = !signal.aborted
      && armed !== null
      && Number.isFinite(now)
      && now <= armed.expiresAt
      && armed.request.requestId === request.requestId
      && armed.request.modelKey === request.model.modelKey
      && sameSha256(
        armed.request.manifestSha256,
        request.model.manifestSha256,
      )
      && armed.request.licenseId === request.license.id;
    if (!matches) {
      return {
        approved: false,
        requestSha256: request.requestSha256,
        modelKey: request.model.modelKey,
        manifestSha256: request.model.manifestSha256,
        licenseId: request.license.id,
      };
    }
    return {
      approved: true,
      approvedBy: 'local-user',
      requestSha256: request.requestSha256,
      modelKey: request.model.modelKey,
      manifestSha256: request.model.manifestSha256,
      licenseId: request.license.id,
    };
  }
}

function assertPreparationRequest(
  request: ModelPreparationRequest,
): void {
  if (
    !requestRecord(request)
    || Object.keys(request).length !== 1
    || !Object.hasOwn(request, 'requestId')
    || typeof request.requestId !== 'string'
    || !REQUEST_ID_PATTERN.test(request.requestId)
  ) {
    throw new ModelManagerError(
      'MODEL_PREPARATION_REQUEST_INVALID',
      'The model preparation request is invalid.',
      false,
    );
  }
}

function currentTimestamp(now: () => Date): string {
  const value = now();
  if (
    !(value instanceof Date)
    || !Number.isFinite(value.getTime())
  ) {
    throw new ModelManagerError(
      'MODEL_PREPARATION_FAILED',
      'The model manager clock returned an invalid value.',
      false,
    );
  }
  return value.toISOString();
}

function managerError(
  error: unknown,
  signal: AbortSignal,
): ModelManagerError {
  if (error instanceof ModelManagerError) return error;
  if (signal.aborted) {
    return new ModelManagerError(
      'MODEL_PREPARATION_ABORTED',
      'The model preparation was cancelled.',
    );
  }
  if (error instanceof ModelCacheError) {
    return new ModelManagerError(error.code, error.message);
  }
  if (error instanceof ModelDownloadError) {
    return new ModelManagerError(error.code, error.message);
  }
  return new ModelManagerError(
    'MODEL_PREPARATION_FAILED',
    'The model preparation failed safely.',
  );
}

function approvalPayload(
  requestId: string,
  manifest: ModelManifest,
  manifestSha256: string,
): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: 'model-download-approval',
    requestId,
    modelKey: manifest.modelKey,
    displayName: manifest.displayName,
    revision: manifest.revision,
    manifestSha256,
    artifactCount: manifest.artifacts.length,
    totalBytes: totalModelBytes(manifest),
    licenseId: manifest.license.id,
    commercialUse: manifest.license.commercialUse,
    sourceHost: 'huggingface.co',
    repository: manifest.repository,
  });
}

function makeApprovalRequest(
  requestId: string,
  manifest: ModelManifest,
  manifestSha256: string,
  license: PublicModelLicenseStatus,
): ModelDownloadApprovalRequest {
  const requestSha256 = sha256(approvalPayload(
    requestId,
    manifest,
    manifestSha256,
  ));
  const model = Object.freeze({
    modelKey: manifest.modelKey,
    displayName: manifest.displayName,
    revision: manifest.revision,
    manifestSha256,
    artifactCount: manifest.artifacts.length,
    totalBytes: totalModelBytes(manifest),
  });
  const source = Object.freeze({
    host: 'huggingface.co' as const,
    repository: manifest.repository,
  });
  return Object.freeze({
    schemaVersion: 1 as const,
    kind: 'model-download-approval' as const,
    requestId,
    requestSha256,
    model,
    license,
    source,
  });
}

function validApprovalDecision(
  decision: ModelApprovalDecision,
  request: ModelDownloadApprovalRequest,
): boolean {
  if (!requestRecord(decision)) return false;
  const allowedKeys = decision.approved === true
    ? new Set([
      'approved',
      'approvedBy',
      'requestSha256',
      'modelKey',
      'manifestSha256',
      'licenseId',
    ])
    : new Set([
      'approved',
      'requestSha256',
      'modelKey',
      'manifestSha256',
      'licenseId',
    ]);
  if (
    !Object.keys(decision).every((key) => allowedKeys.has(key))
    || decision.modelKey !== request.model.modelKey
    || decision.manifestSha256 !== request.model.manifestSha256
    || decision.licenseId !== request.license.id
    || !sameSha256(decision.requestSha256, request.requestSha256)
  ) {
    return false;
  }
  return decision.approved === false
    || (
      decision.approved === true
      && decision.approvedBy === 'local-user'
    );
}

export class ModelManager {
  readonly manifestSha256: string;
  private readonly manifest: ModelManifest;
  private readonly cache: ModelCache;
  private readonly downloader: ModelArtifactDownloader;
  private readonly approvalProvider: ModelApprovalProvider;
  private readonly now: () => Date;
  private readonly license: PublicModelLicenseStatus;
  private activePreparation = false;
  private verifiedReady = false;
  private terminalPreparationFailure = false;
  private statusInspection: Promise<PublicModelStatus> | null = null;
  private statusInspectedAtMs = Number.NEGATIVE_INFINITY;
  private currentStatus: PublicModelStatus;

  constructor(options: ModelManagerOptions) {
    this.manifest = cloneModelManifest(
      options.manifest ?? RMBG_MODEL_MANIFEST,
    );
    this.manifestSha256 = sha256(
      modelManifestCanonicalJson(this.manifest),
    );
    if (options.manifest === undefined) {
      assertPinnedRmbgManifest(
        this.manifest,
        RMBG_MODEL_MANIFEST_SHA256,
      );
      if (this.manifestSha256 !== RMBG_MODEL_MANIFEST_SHA256) {
        throw new Error('The built-in RMBG manifest digest is invalid.');
      }
    }
    this.cache = options.cache ?? new FileModelCache();
    this.downloader = options.downloader ?? new PinnedModelDownloader();
    this.approvalProvider = options.approvalProvider;
    this.now = options.now ?? (() => new Date());
    this.license = publicLicense(this.manifest);
    this.currentStatus = this.makeStatus(
      'not-installed',
      0,
      this.missingArtifacts(),
    );
  }

  async status(): Promise<PublicModelStatus> {
    if (
      this.activePreparation
      || this.verifiedReady
      || this.terminalPreparationFailure
    ) {
      return this.currentStatus;
    }
    if (
      Date.now() - this.statusInspectedAtMs
      < STATUS_INSPECTION_TTL_MS
    ) {
      return this.currentStatus;
    }
    if (this.statusInspection) return this.statusInspection;
    const inspection = this.cache.inspect(
      this.manifest,
      this.manifestSha256,
    ).then((result) => {
      this.currentStatus = this.statusFromInspection(result);
      this.verifiedReady = result.kind === 'ready';
      this.statusInspectedAtMs = Date.now();
      return this.currentStatus;
    });
    this.statusInspection = inspection;
    try {
      return await inspection;
    } finally {
      if (this.statusInspection === inspection) {
        this.statusInspection = null;
      }
    }
  }

  isPreparing(): boolean {
    return this.activePreparation;
  }

  artifactIdFromLocalPath(pathname: string): string | null {
    return modelArtifactIdFromLocalPath(this.manifest, pathname);
  }

  artifactByteLength(artifactId: string): number {
    return modelArtifact(this.manifest, artifactId).byteLength;
  }

  async openVerifiedArtifact(
    artifactId: string,
    options: {
      readonly range?: ModelArtifactReadRange;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<OpenedVerifiedModelArtifact> {
    if (!this.verifiedReady) {
      const status = await this.status();
      if (status.state !== 'ready') {
        throw new ModelManagerError(
          'MODEL_CACHE_CORRUPT',
          'The verified model is not ready.',
        );
      }
    }
    try {
      return await this.cache.openVerifiedArtifact({
        manifest: this.manifest,
        manifestSha256: this.manifestSha256,
        artifactId,
        ...(options.range ? { range: options.range } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      this.verifiedReady = false;
      throw managerError(
        error,
        options.signal ?? new AbortController().signal,
      );
    }
  }

  async prepare(
    request: ModelPreparationRequest,
    signal = new AbortController().signal,
  ): Promise<PublicModelStatus> {
    assertPreparationRequest(request);
    if (this.activePreparation) {
      throw new ModelManagerError(
        'MODEL_INSTALL_BUSY',
        'A model preparation is already in progress.',
      );
    }
    this.terminalPreparationFailure = false;
    this.activePreparation = true;
    try {
      return await this.prepareOnce(request, signal);
    } catch (error) {
      const normalized = managerError(error, signal);
      this.verifiedReady = false;
      const approvalError =
        normalized.code === 'MODEL_APPROVAL_DENIED'
        || normalized.code === 'MODEL_APPROVAL_FAILED'
        || normalized.code === 'MODEL_APPROVAL_INVALID';
      this.currentStatus = this.makeStatus(
        approvalError ? 'approval-required' : 'failed',
        this.currentStatus.bytes,
        this.currentStatus.artifacts,
        normalized,
      );
      this.terminalPreparationFailure = true;
      throw normalized;
    } finally {
      this.activePreparation = false;
    }
  }

  private async prepareOnce(
    request: ModelPreparationRequest,
    signal: AbortSignal,
  ): Promise<PublicModelStatus> {
    if (signal.aborted) {
      throw new ModelManagerError(
        'MODEL_PREPARATION_ABORTED',
        'The model preparation was cancelled.',
      );
    }
    const inspection = await this.cache.inspect(
      this.manifest,
      this.manifestSha256,
      signal,
    );
    if (inspection.kind === 'ready') {
      this.currentStatus = this.statusFromInspection(inspection);
      this.verifiedReady = true;
      return this.currentStatus;
    }

    const approvalRequest = makeApprovalRequest(
      request.requestId,
      this.manifest,
      this.manifestSha256,
      this.license,
    );
    this.currentStatus = this.makeStatus(
      'approval-required',
      inspection.verifiedBytes,
      this.artifactsFromInspection(inspection),
    );
    let decision: ModelApprovalDecision;
    try {
      decision = await this.approvalProvider.requestApproval(
        approvalRequest,
        signal,
      );
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ModelManagerError(
        'MODEL_APPROVAL_FAILED',
        'The trusted local approval flow failed.',
      );
    }
    if (!validApprovalDecision(decision, approvalRequest)) {
      throw new ModelManagerError(
        'MODEL_APPROVAL_INVALID',
        'The approval response did not match this model request.',
        false,
      );
    }
    if (!decision.approved) {
      throw new ModelManagerError(
        'MODEL_APPROVAL_DENIED',
        'A local user must explicitly approve the model download.',
      );
    }
    if (signal.aborted) {
      throw new ModelManagerError(
        'MODEL_PREPARATION_ABORTED',
        'The model preparation was cancelled.',
      );
    }

    const approvedAt = currentTimestamp(this.now);
    this.currentStatus = this.makeStatus(
      'downloading',
      0,
      this.missingArtifacts(),
    );
    const installed = await this.cache.install({
      manifest: this.manifest,
      manifestSha256: this.manifestSha256,
      authorization: {
        approvalRequestSha256: approvalRequest.requestSha256,
        approvedAt,
        approvedBy: decision.approvedBy,
      },
      downloader: this.downloader,
      signal,
      installedAt: currentTimestamp(this.now),
      onProgress: (progress) => this.onProgress(progress),
    });
    if (installed.kind !== 'ready') {
      throw new ModelManagerError(
        'MODEL_PREPARATION_FAILED',
        'The model cache did not become ready.',
      );
    }
    this.currentStatus = this.statusFromInspection(installed);
    this.verifiedReady = true;
    return this.currentStatus;
  }

  private onProgress(progress: ModelInstallProgress): void {
    const currentIndex = this.manifest.artifacts.findIndex(
      (artifact) => artifact.id === progress.artifactId,
    );
    if (currentIndex < 0) return;
    let completedBefore = 0;
    const artifacts = this.manifest.artifacts.map((artifact, index) => {
      if (index < currentIndex) {
        completedBefore += artifact.byteLength;
        return {
          id: artifact.id,
          state: 'ready' as const,
          bytes: artifact.byteLength,
          totalBytes: artifact.byteLength,
        };
      }
      if (index === currentIndex) {
        return {
          id: artifact.id,
          state: progress.phase,
          bytes: Math.max(
            0,
            Math.min(
              artifact.byteLength,
              progress.completedBytes - completedBefore,
            ),
          ),
          totalBytes: artifact.byteLength,
        };
      }
      return {
        id: artifact.id,
        state: 'missing' as const,
        bytes: 0,
        totalBytes: artifact.byteLength,
      };
    });
    this.currentStatus = this.makeStatus(
      progress.phase,
      progress.completedBytes,
      artifacts,
    );
  }

  private statusFromInspection(
    inspection: ModelCacheInspection,
  ): PublicModelStatus {
    if (inspection.kind === 'ready') {
      return this.makeStatus(
        'ready',
        inspection.verifiedBytes,
        this.manifest.artifacts.map((artifact) => ({
          id: artifact.id,
          state: 'ready',
          bytes: artifact.byteLength,
          totalBytes: artifact.byteLength,
        })),
      );
    }
    if (inspection.kind === 'missing') {
      return this.makeStatus(
        'not-installed',
        0,
        this.missingArtifacts(),
      );
    }
    return this.makeStatus(
      'failed',
      inspection.verifiedBytes,
      this.artifactsFromInspection(inspection),
      new ModelManagerError(
        'MODEL_CACHE_CORRUPT',
        'The managed model cache failed integrity verification.',
      ),
    );
  }

  private artifactsFromInspection(
    inspection: ModelCacheInspection,
  ): readonly PublicModelArtifactStatus[] {
    if (inspection.kind === 'ready') {
      return this.manifest.artifacts.map((artifact) => ({
        id: artifact.id,
        state: 'ready',
        bytes: artifact.byteLength,
        totalBytes: artifact.byteLength,
      }));
    }
    if (inspection.kind === 'missing') return this.missingArtifacts();
    if (inspection.reason !== 'artifact') {
      return this.manifest.artifacts.map((artifact) => ({
        id: artifact.id,
        state: 'invalid',
        bytes: 0,
        totalBytes: artifact.byteLength,
      }));
    }
    let remainingVerified = inspection.verifiedBytes;
    let foundInvalid = false;
    return this.manifest.artifacts.map((artifact) => {
      if (
        !foundInvalid
        && remainingVerified >= artifact.byteLength
      ) {
        remainingVerified -= artifact.byteLength;
        return {
          id: artifact.id,
          state: 'ready',
          bytes: artifact.byteLength,
          totalBytes: artifact.byteLength,
        };
      }
      if (!foundInvalid) {
        foundInvalid = true;
        return {
          id: artifact.id,
          state: 'invalid',
          bytes: 0,
          totalBytes: artifact.byteLength,
        };
      }
      return {
        id: artifact.id,
        state: 'missing',
        bytes: 0,
        totalBytes: artifact.byteLength,
      };
    });
  }

  private missingArtifacts(): readonly PublicModelArtifactStatus[] {
    return this.manifest.artifacts.map((artifact) => ({
      id: artifact.id,
      state: 'missing',
      bytes: 0,
      totalBytes: artifact.byteLength,
    }));
  }

  private makeStatus(
    state: PublicModelState,
    bytes: number,
    artifacts: readonly PublicModelArtifactStatus[],
    error?: ModelManagerError,
  ): PublicModelStatus {
    const publicError = error
      ? Object.freeze({
        code: error.code,
        recoverable: error.recoverable,
      })
      : undefined;
    return Object.freeze({
      schemaVersion: 1 as const,
      modelKey: this.manifest.modelKey,
      revision: this.manifest.revision,
      manifestSha256: this.manifestSha256,
      state,
      bytes,
      totalBytes: totalModelBytes(this.manifest),
      artifacts: freezeArtifacts(artifacts),
      license: this.license,
      ...(publicError ? { error: publicError } : {}),
    });
  }
}

export function createManagedRmbgModelManager(
  options: ManagedRmbgModelManagerOptions,
): ModelManager {
  return new ModelManager({
    approvalProvider: options.approvalProvider,
    cache: new FileModelCache(),
    downloader: new PinnedModelDownloader(),
    ...(options.now ? { now: options.now } : {}),
  });
}
