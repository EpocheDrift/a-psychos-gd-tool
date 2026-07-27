import {
  MODEL_PREPARE_PATH,
  MODEL_STATUS_PATH,
  RMBG_MODEL_ARTIFACTS,
  RMBG_MODEL_KEY,
  RMBG_MODEL_MANIFEST_SHA256,
  RMBG_MODEL_PUBLIC_LICENSE,
  RMBG_MODEL_REVISION,
  type PublicModelArtifactState,
  type PublicModelArtifactStatus,
  type PublicModelLicenseStatus,
  type PublicModelState,
  type PublicModelStatus,
} from '../../packages/mcp-companion/src/modelPublicContract';

const MAX_MODEL_STATUS_BYTES = 32 * 1024;
const MODEL_LICENSE_ID = 'bria-rmbg-1.4' as const;
const MODEL_STATES = new Set<PublicModelState>([
  'not-installed',
  'approval-required',
  'downloading',
  'verifying',
  'ready',
  'failed',
]);
const ARTIFACT_STATES = new Set<PublicModelArtifactState>([
  'missing',
  'downloading',
  'verifying',
  'ready',
  'invalid',
]);
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const statusListeners = new Set<(status: PublicModelStatus) => void>();

export class ModelPreparationClientError extends Error {
  readonly code = 'MODEL_PREPARATION_FAILED' as const;
  readonly recoverable = true;

  constructor(message = 'The local model service failed safely.') {
    super(message);
    this.name = 'ModelPreparationClientError';
  }
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function boundedInteger(
  value: unknown,
  maximum: number,
): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= maximum;
}

async function boundedResponseJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null
    && (
      !/^(?:0|[1-9][0-9]{0,5})$/.test(declared)
      || Number(declared) > MAX_MODEL_STATUS_BYTES
    )
  ) {
    throw new ModelPreparationClientError();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ModelPreparationClientError();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      byteLength += next.value.byteLength;
      if (byteLength > MAX_MODEL_STATUS_BYTES) {
        await reader.cancel();
        throw new ModelPreparationClientError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ModelPreparationClientError();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelPreparationClientError();
  }
}

function parseLicense(value: unknown): PublicModelLicenseStatus {
  if (
    !plainRecord(value)
    || !hasExactKeys(value, [
      'id',
      'name',
      'summary',
      'commercialUse',
      'requiresExplicitApproval',
    ])
    || value.id !== RMBG_MODEL_PUBLIC_LICENSE.id
    || value.name !== RMBG_MODEL_PUBLIC_LICENSE.name
    || value.summary !== RMBG_MODEL_PUBLIC_LICENSE.summary
    || value.commercialUse !== 'separate-agreement-required'
    || value.requiresExplicitApproval !== true
  ) {
    throw new ModelPreparationClientError();
  }
  return Object.freeze({
    id: value.id,
    name: value.name,
    summary: value.summary,
    commercialUse: value.commercialUse,
    requiresExplicitApproval: true,
  });
}

function parseArtifacts(
  value: unknown,
): readonly PublicModelArtifactStatus[] {
  if (
    !Array.isArray(value)
    || value.length !== RMBG_MODEL_ARTIFACTS.length
  ) {
    throw new ModelPreparationClientError();
  }
  const parsed = value.map((candidate, index) => {
    const expected = RMBG_MODEL_ARTIFACTS[index]!;
    if (
      !plainRecord(candidate)
      || !hasExactKeys(candidate, [
        'id',
        'state',
        'bytes',
        'totalBytes',
      ])
      || candidate.id !== expected.id
      || typeof candidate.state !== 'string'
      || !ARTIFACT_STATES.has(
        candidate.state as PublicModelArtifactState,
      )
      || candidate.totalBytes !== expected.byteLength
      || !boundedInteger(candidate.bytes, expected.byteLength)
    ) {
      throw new ModelPreparationClientError();
    }
    return Object.freeze({
      id: expected.id,
      state: candidate.state as PublicModelArtifactState,
      bytes: candidate.bytes as number,
      totalBytes: expected.byteLength,
    });
  });
  return Object.freeze(parsed);
}

export function parsePublicModelStatus(value: unknown): PublicModelStatus {
  if (
    !plainRecord(value)
    || !hasExactKeys(value, [
      'schemaVersion',
      'modelKey',
      'revision',
      'manifestSha256',
      'state',
      'bytes',
      'totalBytes',
      'artifacts',
      'license',
    ], ['error'])
    || value.schemaVersion !== 1
    || value.modelKey !== RMBG_MODEL_KEY
    || value.revision !== RMBG_MODEL_REVISION
    || value.manifestSha256 !== RMBG_MODEL_MANIFEST_SHA256
    || typeof value.state !== 'string'
    || !MODEL_STATES.has(value.state as PublicModelState)
  ) {
    throw new ModelPreparationClientError();
  }
  const totalBytes = RMBG_MODEL_ARTIFACTS.reduce(
    (total, artifact) => total + artifact.byteLength,
    0,
  );
  if (
    value.totalBytes !== totalBytes
    || !boundedInteger(value.bytes, totalBytes)
  ) {
    throw new ModelPreparationClientError();
  }
  const artifacts = parseArtifacts(value.artifacts);
  const artifactBytes = artifacts.reduce(
    (total, artifact) => total + artifact.bytes,
    0,
  );
  if (artifactBytes !== value.bytes) {
    throw new ModelPreparationClientError();
  }
  let error: PublicModelStatus['error'];
  if (value.error !== undefined) {
    if (
      !plainRecord(value.error)
      || !hasExactKeys(value.error, ['code', 'recoverable'])
      || typeof value.error.code !== 'string'
      || !ERROR_CODE.test(value.error.code)
      || typeof value.error.recoverable !== 'boolean'
    ) {
      throw new ModelPreparationClientError();
    }
    error = Object.freeze({
      code: value.error.code,
      recoverable: value.error.recoverable,
    });
  }
  return Object.freeze({
    schemaVersion: 1,
    modelKey: RMBG_MODEL_KEY,
    revision: RMBG_MODEL_REVISION,
    manifestSha256: RMBG_MODEL_MANIFEST_SHA256,
    state: value.state as PublicModelState,
    bytes: value.bytes as number,
    totalBytes,
    artifacts,
    license: parseLicense(value.license),
    ...(error ? { error } : {}),
  });
}

async function readModelResponse(
  responsePromise: Promise<Response>,
): Promise<PublicModelStatus> {
  let response: Response;
  try {
    response = await responsePromise;
  } catch {
    throw new ModelPreparationClientError();
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ModelPreparationClientError();
  }
  const status = parsePublicModelStatus(await boundedResponseJson(response));
  for (const listener of statusListeners) listener(status);
  return status;
}

export function subscribePinnedModelStatus(
  listener: (status: PublicModelStatus) => void,
): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function getPinnedModelStatus(
  signal?: AbortSignal,
): Promise<PublicModelStatus> {
  return readModelResponse(fetch(MODEL_STATUS_PATH, {
    method: 'GET',
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: {
      Accept: 'application/json',
    },
  }));
}

export function preparePinnedModelFromTrustedUi(
  requestId: string,
  signal?: AbortSignal,
): Promise<PublicModelStatus> {
  if (!REQUEST_ID.test(requestId)) {
    return Promise.reject(new ModelPreparationClientError());
  }
  return readModelResponse(fetch(MODEL_PREPARE_PATH, {
    method: 'POST',
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      schemaVersion: 1,
      kind: 'model-download-approval',
      requestId,
      approved: true,
      modelKey: RMBG_MODEL_KEY,
      manifestSha256: RMBG_MODEL_MANIFEST_SHA256,
      licenseId: MODEL_LICENSE_ID,
    }),
  }));
}
