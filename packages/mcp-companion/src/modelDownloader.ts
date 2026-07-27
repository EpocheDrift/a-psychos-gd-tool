import type { IncomingMessage } from 'node:http';
import {
  request as httpsRequest,
  type RequestOptions,
} from 'node:https';
import {
  modelArtifact,
  modelArtifactSourceUrl,
  type ModelManifest,
} from './modelManifest.js';

const MAX_REDIRECTS = 4;
const USER_AGENT = 'a-psychos-gd-tool-model-manager/1';
const CDN_HOST_PATTERN = /^(?:[a-z0-9-]+\.)*cdn\.hf\.co$/;
const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;

export interface ModelDownloadResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<
    string,
    string | readonly string[] | undefined
  >>;
  readonly body: AsyncIterable<Uint8Array>;
  close(): void;
}

export interface ModelDownloadRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export type ModelDownloadTransport = (
  url: URL,
  request: ModelDownloadRequest,
) => Promise<ModelDownloadResponse>;

export interface OpenedModelArtifact {
  readonly body: AsyncIterable<Uint8Array>;
  readonly contentLength?: number;
  close(): void;
}

export interface ModelArtifactDownloader {
  open(
    manifest: ModelManifest,
    artifactId: string,
    signal: AbortSignal,
  ): Promise<OpenedModelArtifact>;
}

export type ModelDownloadErrorCode =
  | 'MODEL_DOWNLOAD_ABORTED'
  | 'MODEL_DOWNLOAD_HTTP_ERROR'
  | 'MODEL_DOWNLOAD_REDIRECT_REJECTED'
  | 'MODEL_DOWNLOAD_RESPONSE_INVALID'
  | 'MODEL_DOWNLOAD_TIMEOUT';

export class ModelDownloadError extends Error {
  readonly code: ModelDownloadErrorCode;

  constructor(code: ModelDownloadErrorCode, message: string) {
    super(message);
    this.name = 'ModelDownloadError';
    this.code = code;
  }
}

function oneHeader(
  headers: ModelDownloadResponse['headers'],
  name: string,
): string | undefined {
  const value = headers[name];
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (value.length === 1) return value[0];
  throw new ModelDownloadError(
    'MODEL_DOWNLOAD_RESPONSE_INVALID',
    `The model response contained multiple ${name} headers.`,
  );
}

function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9][0-9]{0,15})$/.test(value)) {
    throw new ModelDownloadError(
      'MODEL_DOWNLOAD_RESPONSE_INVALID',
      'The model response content length is invalid.',
    );
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new ModelDownloadError(
      'MODEL_DOWNLOAD_RESPONSE_INVALID',
      'The model response content length is unsafe.',
    );
  }
  return length;
}

function isAllowedRedirectUrl(url: URL): boolean {
  return url.protocol === 'https:'
    && url.username === ''
    && url.password === ''
    && (url.port === '' || url.port === '443')
    && (
      url.hostname === 'huggingface.co'
      || CDN_HOST_PATTERN.test(url.hostname)
    );
}

function isRedirect(statusCode: number): boolean {
  return statusCode === 301
    || statusCode === 302
    || statusCode === 303
    || statusCode === 307
    || statusCode === 308;
}

function incomingHeaders(
  response: IncomingMessage,
): ModelDownloadResponse['headers'] {
  const headers: Record<string, string | readonly string[] | undefined> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    headers[name] = value;
  }
  return headers;
}

async function* incomingBody(
  response: IncomingMessage,
): AsyncIterable<Uint8Array> {
  for await (const chunk of response) {
    if (typeof chunk === 'string') {
      yield Buffer.from(chunk);
    } else {
      yield chunk;
    }
  }
}

const nodeHttpsTransport: ModelDownloadTransport = (
  url,
  request,
) => new Promise((resolve, reject) => {
  const options: RequestOptions = {
    method: 'GET',
    headers: request.headers,
    signal: request.signal,
  };
  const outgoing = httpsRequest(url, options, (response) => {
    response.setTimeout(DEFAULT_RESPONSE_TIMEOUT_MS, () => {
      response.destroy(new ModelDownloadError(
        'MODEL_DOWNLOAD_TIMEOUT',
        'The model download became unresponsive.',
      ));
    });
    resolve({
      statusCode: response.statusCode ?? 0,
      headers: incomingHeaders(response),
      body: incomingBody(response),
      close: () => response.destroy(),
    });
  });
  outgoing.setTimeout(DEFAULT_RESPONSE_TIMEOUT_MS, () => {
    outgoing.destroy(new ModelDownloadError(
      'MODEL_DOWNLOAD_TIMEOUT',
      'The model host did not respond in time.',
    ));
  });
  outgoing.once('error', reject);
  outgoing.end();
});

export interface PinnedModelDownloaderOptions {
  readonly transport?: ModelDownloadTransport;
  readonly responseTimeoutMs?: number;
}

export class PinnedModelDownloader implements ModelArtifactDownloader {
  private readonly transport: ModelDownloadTransport;
  private readonly responseTimeoutMs: number;

  constructor(options: PinnedModelDownloaderOptions = {}) {
    this.transport = options.transport ?? nodeHttpsTransport;
    this.responseTimeoutMs =
      options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.responseTimeoutMs)
      || this.responseTimeoutMs < 1
      || this.responseTimeoutMs > 120_000
    ) {
      throw new RangeError('The model response timeout is invalid.');
    }
  }

  private async transportWithTimeout(
    url: URL,
    request: ModelDownloadRequest,
  ): Promise<ModelDownloadResponse> {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const transport = this.transport(url, request);
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new ModelDownloadError(
          'MODEL_DOWNLOAD_TIMEOUT',
          'The model host did not respond in time.',
        ));
      }, this.responseTimeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([transport, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        void transport.then(
          (lateResponse) => lateResponse.close(),
          () => undefined,
        );
      }
    }
  }

  private bodyWithTimeout(
    response: ModelDownloadResponse,
    signal: AbortSignal,
  ): AsyncIterable<Uint8Array> {
    const timeoutMs = this.responseTimeoutMs;
    return {
      async *[Symbol.asyncIterator]() {
        const iterator = response.body[Symbol.asyncIterator]();
        while (true) {
          if (signal.aborted) {
            response.close();
            throw new ModelDownloadError(
              'MODEL_DOWNLOAD_ABORTED',
              'The model download was cancelled.',
            );
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              response.close();
              reject(new ModelDownloadError(
                'MODEL_DOWNLOAD_TIMEOUT',
                'The model download became unresponsive.',
              ));
            }, timeoutMs);
            timer.unref?.();
          });
          let next: IteratorResult<Uint8Array>;
          try {
            next = await Promise.race([iterator.next(), timeout]);
          } finally {
            if (timer) clearTimeout(timer);
          }
          if (next.done) return;
          yield next.value;
        }
      },
    };
  }

  async open(
    manifest: ModelManifest,
    artifactId: string,
    signal: AbortSignal,
  ): Promise<OpenedModelArtifact> {
    const artifact = modelArtifact(manifest, artifactId);
    let url = modelArtifactSourceUrl(manifest, artifactId);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      if (signal.aborted) {
        throw new ModelDownloadError(
          'MODEL_DOWNLOAD_ABORTED',
          'The model download was cancelled.',
        );
      }
      let response: ModelDownloadResponse;
      try {
        response = await this.transportWithTimeout(url, {
          signal,
          headers: Object.freeze({
            Accept: artifact.mediaType,
            'Accept-Encoding': 'identity',
            'User-Agent': USER_AGENT,
          }),
        });
      } catch (error) {
        if (signal.aborted) {
          throw new ModelDownloadError(
            'MODEL_DOWNLOAD_ABORTED',
            'The model download was cancelled.',
          );
        }
        throw error;
      }
      if (isRedirect(response.statusCode)) {
        try {
          if (redirects === MAX_REDIRECTS) {
            throw new ModelDownloadError(
              'MODEL_DOWNLOAD_REDIRECT_REJECTED',
              'The model download exceeded its redirect limit.',
            );
          }
          const location = oneHeader(response.headers, 'location');
          if (!location) {
            throw new ModelDownloadError(
              'MODEL_DOWNLOAD_REDIRECT_REJECTED',
              'The model download redirect had no location.',
            );
          }
          const redirected = new URL(location, url);
          if (!isAllowedRedirectUrl(redirected)) {
            throw new ModelDownloadError(
              'MODEL_DOWNLOAD_REDIRECT_REJECTED',
              'The model download redirect left the approved hosts.',
            );
          }
          url = redirected;
        } finally {
          response.close();
        }
        continue;
      }
      if (response.statusCode !== 200) {
        response.close();
        throw new ModelDownloadError(
          'MODEL_DOWNLOAD_HTTP_ERROR',
          `The model host returned HTTP ${response.statusCode}.`,
        );
      }
      try {
        const contentEncoding = oneHeader(
          response.headers,
          'content-encoding',
        );
        if (
          contentEncoding !== undefined
          && contentEncoding.toLowerCase() !== 'identity'
        ) {
          throw new ModelDownloadError(
            'MODEL_DOWNLOAD_RESPONSE_INVALID',
            'The model response used an unexpected content encoding.',
          );
        }
        const repositoryRevision = oneHeader(
          response.headers,
          'x-repo-commit',
        );
        if (
          repositoryRevision !== undefined
          && repositoryRevision !== manifest.revision
        ) {
          throw new ModelDownloadError(
            'MODEL_DOWNLOAD_RESPONSE_INVALID',
            'The model host returned a different repository revision.',
          );
        }
        const contentLength = parseContentLength(
          oneHeader(response.headers, 'content-length'),
        );
        if (
          contentLength !== undefined
          && contentLength !== artifact.byteLength
        ) {
          throw new ModelDownloadError(
            'MODEL_DOWNLOAD_RESPONSE_INVALID',
            'The model response length does not match the manifest.',
          );
        }
        return {
          body: this.bodyWithTimeout(response, signal),
          ...(contentLength === undefined ? {} : { contentLength }),
          close: () => response.close(),
        };
      } catch (error) {
        response.close();
        throw error;
      }
    }
    throw new ModelDownloadError(
      'MODEL_DOWNLOAD_REDIRECT_REJECTED',
      'The model download exceeded its redirect limit.',
    );
  }
}
