import type { PreviewMetricsV1 } from './previewMetrics';

export type PreviewFormat = 'png' | 'webp';
export type PreviewMimeType = 'image/png' | 'image/webp';

export interface PreviewWorkerRequest {
  id: number;
  generation: number;
  width: number;
  height: number;
  data: ArrayBuffer;
  format: PreviewFormat;
  includeMetrics: boolean;
  maxBytes: number;
  maxEncodeAttempts: number;
  timeoutMs?: number;
}

export interface PreviewWorkerSuccess {
  id: number;
  generation: number;
  ok: true;
  width: number;
  height: number;
  mimeType: PreviewMimeType;
  bytes: ArrayBuffer;
  byteLength: number;
  contentHash: string;
  rgbaSha256: string;
  metrics?: PreviewMetricsV1;
}

export interface PreviewWorkerFailure {
  id: number;
  generation: number;
  ok: false;
  code: 'INVALID_ARGUMENT' | 'RESOURCE_LIMIT' | 'TIMEOUT' | 'INTERNAL';
  message: string;
}

export type PreviewWorkerReply = PreviewWorkerSuccess | PreviewWorkerFailure;
