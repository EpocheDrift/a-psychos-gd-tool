import {
  computePreviewMetrics,
  downsamplePreviewPixels,
  type PreviewPixels,
} from './previewMetrics';
import type {
  PreviewMimeType,
  PreviewWorkerFailure,
  PreviewWorkerReply,
  PreviewWorkerRequest,
} from './previewWorkerProtocol';

const post = (
  self as unknown as {
    postMessage: (message: unknown, transfer?: Transferable[]) => void;
  }
).postMessage.bind(self);

interface WorkerError extends Error {
  code?: PreviewWorkerFailure['code'];
}

function workerError(
  code: PreviewWorkerFailure['code'],
  message: string,
): WorkerError {
  return Object.assign(new Error(message), { code });
}

function mimeFor(format: PreviewWorkerRequest['format']): PreviewMimeType {
  return format === 'webp' ? 'image/webp' : 'image/png';
}

function checkpoint(deadline: number | null): void {
  if (deadline !== null && performance.now() >= deadline) {
    throw workerError('TIMEOUT', 'Preview encoding exceeded its deadline.');
  }
}

async function sha256(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function encode(
  pixels: PreviewPixels,
  mimeType: PreviewMimeType,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(pixels.width, pixels.height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw workerError('INTERNAL', 'Preview encoder could not create a 2D context.');
  }
  context.putImageData(
    new ImageData(
      new Uint8ClampedArray(pixels.data),
      pixels.width,
      pixels.height,
    ),
    0,
    0,
  );
  const blob = await canvas.convertToBlob({
    type: mimeType,
    ...(mimeType === 'image/webp' ? { quality: 0.92 } : {}),
  });
  if (blob.type !== mimeType) {
    throw workerError(
      'INTERNAL',
      `Browser returned ${blob.type || 'an unknown format'} for ${mimeType}.`,
    );
  }
  return blob;
}

async function handle(request: PreviewWorkerRequest): Promise<PreviewWorkerReply> {
  const deadline = typeof request.timeoutMs === 'number'
    && Number.isFinite(request.timeoutMs)
    ? performance.now() + Math.max(0, request.timeoutMs)
    : null;
  const check = () => checkpoint(deadline);
  check();
  if (
    !Number.isSafeInteger(request.width)
    || !Number.isSafeInteger(request.height)
    || request.width <= 0
    || request.height <= 0
    || !Number.isSafeInteger(request.maxBytes)
    || request.maxBytes <= 0
    || !Number.isSafeInteger(request.maxEncodeAttempts)
    || request.maxEncodeAttempts <= 0
    || request.data.byteLength !== request.width * request.height * 4
    || (request.format !== 'png' && request.format !== 'webp')
  ) {
    throw workerError('INVALID_ARGUMENT', 'Preview worker request is invalid.');
  }

  const mimeType = mimeFor(request.format);
  let pixels: PreviewPixels = {
    data: new Uint8ClampedArray(request.data),
    width: request.width,
    height: request.height,
  };
  let blob: Blob | null = null;
  for (let attempt = 0; attempt < request.maxEncodeAttempts; attempt++) {
    check();
    blob = await encode(pixels, mimeType);
    check();
    if (blob.size <= request.maxBytes) break;
    if (attempt === request.maxEncodeAttempts - 1) break;
    if (pixels.width === 1 && pixels.height === 1) break;
    const scale = Math.min(
      0.9,
      Math.max(0.25, Math.sqrt(request.maxBytes / blob.size) * 0.9),
    );
    const width = Math.max(
      1,
      Math.min(pixels.width - (pixels.width > 1 ? 1 : 0), Math.floor(pixels.width * scale)),
    );
    const height = Math.max(
      1,
      Math.min(pixels.height - (pixels.height > 1 ? 1 : 0), Math.floor(pixels.height * scale)),
    );
    pixels = downsamplePreviewPixels(pixels, width, height, check);
  }
  if (!blob || blob.size > request.maxBytes) {
    throw workerError(
      'RESOURCE_LIMIT',
      `Encoded preview exceeds the ${request.maxBytes} byte limit.`,
    );
  }

  check();
  const encoded = await blob.arrayBuffer();
  check();
  const [contentHash, rgbaSha256] = await Promise.all([
    sha256(encoded),
    sha256(new Uint8Array(pixels.data).buffer),
  ]);
  check();
  const metrics = request.includeMetrics
    ? computePreviewMetrics(pixels, check)
    : undefined;
  const reply: PreviewWorkerReply = {
    id: request.id,
    generation: request.generation,
    ok: true,
    width: pixels.width,
    height: pixels.height,
    mimeType,
    bytes: encoded,
    byteLength: encoded.byteLength,
    contentHash,
    rgbaSha256,
    ...(metrics ? { metrics } : {}),
  };
  return reply;
}

self.onmessage = (event: MessageEvent<PreviewWorkerRequest>) => {
  const request = event.data;
  void handle(request).then(
    (reply) => {
      if (reply.ok) post(reply, [reply.bytes]);
      else post(reply);
    },
    (error: unknown) => {
      const candidate = error as WorkerError;
      const code = candidate?.code;
      const reply: PreviewWorkerFailure = {
        id: request.id,
        generation: request.generation,
        ok: false,
        code: code === 'INVALID_ARGUMENT'
          || code === 'RESOURCE_LIMIT'
          || code === 'TIMEOUT'
          || code === 'INTERNAL'
          ? code
          : 'INTERNAL',
        message: error instanceof Error ? error.message : String(error),
      };
      post(reply);
    },
  );
};
