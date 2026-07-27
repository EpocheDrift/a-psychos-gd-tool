/**
 * Browser-safe pinned-model contract. This module intentionally contains no
 * remote URL, local filesystem path, downloader, or cache implementation.
 * Agent browser code and workers may import it without gaining network or
 * filesystem authority.
 */
export const RMBG_MODEL_KEY = 'rmbg-1.4' as const;
export const RMBG_MODEL_DISPLAY_NAME = 'BRIA RMBG 1.4' as const;
export const RMBG_MODEL_REPOSITORY = 'briaai/RMBG-1.4' as const;
export const RMBG_MODEL_REVISION =
  '2ceba5a5efaec153162aedea169f76caf9b46cf8' as const;
export const RMBG_MODEL_MANIFEST_SHA256 =
  '561ce573597fda1b7b540f7e5929c5f47fcfdce65c33f7f581aa0c3da9eaa269' as const;

export const MODEL_LOCAL_ROUTE_PREFIX = '/__gfx_model_v1' as const;
export const MODEL_STATUS_PATH =
  `${MODEL_LOCAL_ROUTE_PREFIX}/status` as const;
export const MODEL_PREPARE_PATH =
  `${MODEL_LOCAL_ROUTE_PREFIX}/prepare` as const;
export const MODEL_FILES_PATH_PREFIX =
  `${MODEL_LOCAL_ROUTE_PREFIX}/files/` as const;
export const RMBG_MODEL_FILES_PATH_PREFIX =
  `${MODEL_FILES_PATH_PREFIX}${RMBG_MODEL_REPOSITORY}/` as const;

export type ModelKey = typeof RMBG_MODEL_KEY;

export type PublicModelState =
  | 'not-installed'
  | 'approval-required'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'failed';

export type PublicModelArtifactState =
  | 'missing'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'invalid';

export interface PublicModelArtifactStatus {
  readonly id: string;
  readonly state: PublicModelArtifactState;
  readonly bytes: number;
  readonly totalBytes: number;
}

export interface PublicModelLicenseStatus {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly commercialUse: 'separate-agreement-required';
  readonly requiresExplicitApproval: true;
}

export interface PublicModelStatus {
  readonly schemaVersion: 1;
  readonly modelKey: ModelKey;
  readonly revision: string;
  readonly manifestSha256: string;
  readonly state: PublicModelState;
  readonly bytes: number;
  readonly totalBytes: number;
  readonly artifacts: readonly PublicModelArtifactStatus[];
  readonly license: PublicModelLicenseStatus;
  readonly error?: {
    readonly code: string;
    readonly recoverable: boolean;
  };
}

export interface PinnedModelArtifact {
  readonly id: string;
  readonly relativePath: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly mediaType: string;
}

export const RMBG_MODEL_PUBLIC_LICENSE: PublicModelLicenseStatus =
  Object.freeze({
    id: 'bria-rmbg-1.4',
    name: 'BRIA RMBG 1.4 Model License',
    summary:
      'Source-available for non-commercial use; commercial use requires '
      + 'a separate agreement with BRIA.',
    commercialUse: 'separate-agreement-required',
    requiresExplicitApproval: true,
  });

export const RMBG_MODEL_ARTIFACTS: readonly PinnedModelArtifact[] =
  Object.freeze([
    Object.freeze({
      id: 'preprocessor-config',
      relativePath: 'preprocessor_config.json',
      byteLength: 345,
      sha256:
        '6f9c2cfdb87edd9b83c1314629657d5b320a6a89f8481c872a36253132e33afa',
      mediaType: 'application/json',
    }),
    Object.freeze({
      id: 'onnx-fp32',
      relativePath: 'onnx/model.onnx',
      byteLength: 176_153_355,
      sha256:
        '8cafcf770b06757c4eaced21b1a88e57fd2b66de01b8045f35f01535ba742e0f',
      mediaType: 'application/octet-stream',
    }),
    Object.freeze({
      id: 'onnx-q8',
      relativePath: 'onnx/model_quantized.onnx',
      byteLength: 44_403_226,
      sha256:
        'a6648479275dfd0ede0f3a8abc20aa5c437b394681b05e5af6d268250aaf40f3',
      mediaType: 'application/octet-stream',
    }),
  ]);

export const RMBG_MODEL_TOTAL_BYTES = RMBG_MODEL_ARTIFACTS.reduce(
  (total, artifact) => total + artifact.byteLength,
  0,
);
