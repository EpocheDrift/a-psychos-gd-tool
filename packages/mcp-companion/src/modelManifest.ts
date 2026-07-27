import {
  RMBG_MODEL_ARTIFACTS,
  RMBG_MODEL_DISPLAY_NAME,
  RMBG_MODEL_KEY,
  RMBG_MODEL_MANIFEST_SHA256,
  RMBG_MODEL_PUBLIC_LICENSE,
  RMBG_MODEL_REPOSITORY,
  RMBG_MODEL_REVISION,
  RMBG_MODEL_FILES_PATH_PREFIX,
  type ModelKey,
  type PinnedModelArtifact,
} from './modelPublicContract.js';

export * from './modelPublicContract.js';

export interface ModelArtifactManifest extends PinnedModelArtifact {}

export interface ModelLicenseManifest {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly commercialUse: 'separate-agreement-required';
  readonly termsUrl: string;
  readonly sourceUrl: string;
}

export interface ModelManifest {
  readonly schemaVersion: 1;
  readonly modelKey: ModelKey;
  readonly displayName: string;
  readonly repository: typeof RMBG_MODEL_REPOSITORY;
  readonly revision: string;
  readonly license: ModelLicenseManifest;
  readonly artifacts: readonly ModelArtifactManifest[];
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REVISION_PATTERN = /^[0-9a-f]{40}$/;
const ARTIFACT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const ARTIFACT_PATH_PATTERN = /^[A-Za-z0-9._/-]{1,256}$/;
const MAX_MODEL_ARTIFACTS = 16;
const MAX_MODEL_BYTES = 1024 * 1024 * 1024;

function deepFreezeManifest(manifest: ModelManifest): ModelManifest {
  for (const artifact of manifest.artifacts) Object.freeze(artifact);
  Object.freeze(manifest.artifacts);
  Object.freeze(manifest.license);
  return Object.freeze(manifest);
}

export const RMBG_MODEL_MANIFEST: ModelManifest = deepFreezeManifest({
  schemaVersion: 1,
  modelKey: RMBG_MODEL_KEY,
  displayName: RMBG_MODEL_DISPLAY_NAME,
  repository: RMBG_MODEL_REPOSITORY,
  revision: RMBG_MODEL_REVISION,
  license: {
    id: RMBG_MODEL_PUBLIC_LICENSE.id,
    name: RMBG_MODEL_PUBLIC_LICENSE.name,
    summary: RMBG_MODEL_PUBLIC_LICENSE.summary,
    commercialUse: RMBG_MODEL_PUBLIC_LICENSE.commercialUse,
    termsUrl:
      'https://bria.ai/bria-huggingface-model-license-agreement/',
    sourceUrl: 'https://huggingface.co/briaai/RMBG-1.4',
  },
  artifacts: RMBG_MODEL_ARTIFACTS.map((artifact) => ({ ...artifact })),
});

function hasSafeRelativePath(path: string): boolean {
  if (
    !ARTIFACT_PATH_PATTERN.test(path)
    || path.startsWith('/')
    || path.endsWith('/')
    || path.includes('\\')
  ) {
    return false;
  }
  const segments = path.split('/');
  return segments.every((segment) => (
    segment.length > 0
    && segment !== '.'
    && segment !== '..'
  ));
}

export function assertModelManifest(
  manifest: ModelManifest,
): void {
  if (
    manifest.schemaVersion !== 1
    || manifest.modelKey !== RMBG_MODEL_KEY
    || manifest.repository !== RMBG_MODEL_REPOSITORY
    || !REVISION_PATTERN.test(manifest.revision)
    || manifest.displayName.length < 1
    || manifest.displayName.length > 128
  ) {
    throw new Error('The model manifest identity is invalid.');
  }
  if (
    manifest.license.id !== 'bria-rmbg-1.4'
    || manifest.license.name.length < 1
    || manifest.license.name.length > 128
    || manifest.license.summary.length < 1
    || manifest.license.summary.length > 1_024
    || manifest.license.commercialUse
      !== 'separate-agreement-required'
    || manifest.license.termsUrl
      !== 'https://bria.ai/bria-huggingface-model-license-agreement/'
    || manifest.license.sourceUrl
      !== 'https://huggingface.co/briaai/RMBG-1.4'
  ) {
    throw new Error('The model manifest license is invalid.');
  }
  if (
    manifest.artifacts.length < 1
    || manifest.artifacts.length > MAX_MODEL_ARTIFACTS
  ) {
    throw new Error('The model manifest artifact count is invalid.');
  }
  const ids = new Set<string>();
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const artifact of manifest.artifacts) {
    if (
      !ARTIFACT_ID_PATTERN.test(artifact.id)
      || ids.has(artifact.id)
      || !hasSafeRelativePath(artifact.relativePath)
      || paths.has(artifact.relativePath)
      || !Number.isSafeInteger(artifact.byteLength)
      || artifact.byteLength < 1
      || !SHA256_PATTERN.test(artifact.sha256)
      || artifact.mediaType.length < 1
      || artifact.mediaType.length > 128
    ) {
      throw new Error('The model manifest contains an invalid artifact.');
    }
    ids.add(artifact.id);
    paths.add(artifact.relativePath);
    totalBytes += artifact.byteLength;
  }
  if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_MODEL_BYTES) {
    throw new Error('The model manifest exceeds the storage budget.');
  }
}

export function cloneModelManifest(
  manifest: ModelManifest,
): ModelManifest {
  assertModelManifest(manifest);
  return deepFreezeManifest({
    ...manifest,
    license: { ...manifest.license },
    artifacts: manifest.artifacts.map((artifact) => ({ ...artifact })),
  });
}

export function modelArtifact(
  manifest: ModelManifest,
  artifactId: string,
): ModelArtifactManifest {
  const artifact = manifest.artifacts.find(
    (candidate) => candidate.id === artifactId,
  );
  if (!artifact) {
    throw new Error('The requested artifact is not in the fixed manifest.');
  }
  return artifact;
}

export function modelArtifactSourceUrl(
  manifest: ModelManifest,
  artifactId: string,
): URL {
  assertModelManifest(manifest);
  const artifact = modelArtifact(manifest, artifactId);
  const encodedPath = artifact.relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return new URL(
    `https://huggingface.co/${RMBG_MODEL_REPOSITORY}/resolve/`
    + `${manifest.revision}/${encodedPath}`,
  );
}

export function modelArtifactLocalPath(
  manifest: ModelManifest,
  artifactId: string,
): string {
  assertModelManifest(manifest);
  const artifact = modelArtifact(manifest, artifactId);
  return `${RMBG_MODEL_FILES_PATH_PREFIX}${artifact.relativePath}`;
}

export function modelArtifactIdFromLocalPath(
  manifest: ModelManifest,
  pathname: string,
): string | null {
  assertModelManifest(manifest);
  for (const artifact of manifest.artifacts) {
    if (
      pathname
      === `${RMBG_MODEL_FILES_PATH_PREFIX}${artifact.relativePath}`
    ) {
      return artifact.id;
    }
  }
  return null;
}

export function modelManifestCanonicalJson(
  manifest: ModelManifest,
): string {
  assertModelManifest(manifest);
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    modelKey: manifest.modelKey,
    displayName: manifest.displayName,
    repository: manifest.repository,
    revision: manifest.revision,
    license: {
      id: manifest.license.id,
      name: manifest.license.name,
      summary: manifest.license.summary,
      commercialUse: manifest.license.commercialUse,
      termsUrl: manifest.license.termsUrl,
      sourceUrl: manifest.license.sourceUrl,
    },
    artifacts: manifest.artifacts.map((artifact) => ({
      id: artifact.id,
      relativePath: artifact.relativePath,
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
      mediaType: artifact.mediaType,
    })),
  });
}

export function assertPinnedRmbgManifest(
  manifest: ModelManifest,
  manifestSha256: string,
): void {
  assertModelManifest(manifest);
  if (
    manifestSha256 !== RMBG_MODEL_MANIFEST_SHA256
    || modelManifestCanonicalJson(manifest)
      !== modelManifestCanonicalJson(RMBG_MODEL_MANIFEST)
  ) {
    throw new Error('The pinned RMBG model manifest changed unexpectedly.');
  }
}

export function totalModelBytes(manifest: ModelManifest): number {
  assertModelManifest(manifest);
  return manifest.artifacts.reduce(
    (total, artifact) => total + artifact.byteLength,
    0,
  );
}
