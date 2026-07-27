import { describe, expect, it, vi } from 'vitest';
import {
  ModelDownloadError,
  PinnedModelDownloader,
  type ModelDownloadResponse,
  type ModelDownloadTransport,
} from '../src/modelDownloader.js';
import {
  FIXTURE_MODEL_FILES,
  fixtureModelManifest,
} from './modelTestFixtures.js';

async function* body(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

function response(
  statusCode: number,
  headers: ModelDownloadResponse['headers'],
  bytes = new Uint8Array(),
  close = vi.fn(),
): ModelDownloadResponse {
  return {
    statusCode,
    headers,
    body: body(bytes),
    close,
  };
}

async function readAll(
  source: AsyncIterable<Uint8Array>,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe('pinned model downloader', () => {
  it('bounds both response startup and body inactivity', async () => {
    const never = new Promise<ModelDownloadResponse>(() => undefined);
    const responseTimeout = new PinnedModelDownloader({
      transport: async () => never,
      responseTimeoutMs: 10,
    });
    await expect(responseTimeout.open(
      fixtureModelManifest(),
      'preprocessor-config',
      new AbortController().signal,
    )).rejects.toMatchObject<ModelDownloadError>({
      code: 'MODEL_DOWNLOAD_TIMEOUT',
    });

    const close = vi.fn();
    const stalledBody = {
      async *[Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array> {
        await new Promise<void>(() => undefined);
        yield new Uint8Array();
      },
    };
    const bodyTimeout = new PinnedModelDownloader({
      transport: async () => ({
        statusCode: 200,
        headers: {},
        body: stalledBody,
        close,
      }),
      responseTimeoutMs: 10,
    });
    const opened = await bodyTimeout.open(
      fixtureModelManifest(),
      'preprocessor-config',
      new AbortController().signal,
    );
    await expect(readAll(opened.body)).rejects.toMatchObject<
      ModelDownloadError
    >({
      code: 'MODEL_DOWNLOAD_TIMEOUT',
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('requests only the manifest-derived revision URL', async () => {
    const manifest = fixtureModelManifest();
    const bytes = FIXTURE_MODEL_FILES['preprocessor-config'];
    const requested: URL[] = [];
    const transport: ModelDownloadTransport = vi.fn(
      async (url, request) => {
        requested.push(url);
        expect(request.headers).toMatchObject({
          Accept: 'application/json',
          'Accept-Encoding': 'identity',
        });
        return response(200, {
          'content-length': String(bytes.byteLength),
          'x-repo-commit': manifest.revision,
        }, bytes);
      },
    );
    const downloader = new PinnedModelDownloader({ transport });
    const opened = await downloader.open(
      manifest,
      'preprocessor-config',
      new AbortController().signal,
    );

    expect(await readAll(opened.body)).toEqual(bytes);
    opened.close();
    expect(requested.map((url) => url.toString())).toEqual([
      'https://huggingface.co/briaai/RMBG-1.4/resolve/'
      + `${manifest.revision}/preprocessor_config.json`,
    ]);
  });

  it('allows a relative same-origin redirect with a query string', async () => {
    const manifest = fixtureModelManifest();
    const bytes = FIXTURE_MODEL_FILES['preprocessor-config'];
    const requested: URL[] = [];
    const firstClose = vi.fn();
    const transport: ModelDownloadTransport = vi.fn(async (url) => {
      requested.push(url);
      if (requested.length === 1) {
        return response(307, {
          location:
            `/api/resolve-cache/models/briaai/RMBG-1.4/`
            + `${manifest.revision}/preprocessor_config.json`
            + '?download=true',
        }, undefined, firstClose);
      }
      return response(200, {
        'content-length': String(bytes.byteLength),
        'x-repo-commit': manifest.revision,
      }, bytes);
    });
    const opened = await new PinnedModelDownloader({ transport }).open(
      manifest,
      'preprocessor-config',
      new AbortController().signal,
    );

    expect(await readAll(opened.body)).toEqual(bytes);
    expect(firstClose).toHaveBeenCalledOnce();
    expect(requested[1]?.hostname).toBe('huggingface.co');
    expect(requested[1]?.search).toBe('?download=true');
  });

  it('rejects redirects outside strict HTTPS Hugging Face hosts', async () => {
    const close = vi.fn();
    const transport: ModelDownloadTransport = vi.fn(async () => (
      response(302, {
        location: 'http://127.0.0.1:8080/private',
      }, undefined, close)
    ));
    const downloader = new PinnedModelDownloader({ transport });

    await expect(downloader.open(
      fixtureModelManifest(),
      'onnx-fp32',
      new AbortController().signal,
    )).rejects.toMatchObject<ModelDownloadError>({
      code: 'MODEL_DOWNLOAD_REDIRECT_REJECTED',
    });
    expect(transport).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects response metadata that drifts from the manifest', async () => {
    const bytes = FIXTURE_MODEL_FILES['onnx-q8'];
    const wrongLength = new PinnedModelDownloader({
      transport: async () => response(200, {
        'content-length': String(bytes.byteLength + 1),
      }, bytes),
    });
    await expect(wrongLength.open(
      fixtureModelManifest(),
      'onnx-q8',
      new AbortController().signal,
    )).rejects.toMatchObject<ModelDownloadError>({
      code: 'MODEL_DOWNLOAD_RESPONSE_INVALID',
    });

    const wrongRevision = new PinnedModelDownloader({
      transport: async () => response(200, {
        'content-length': String(bytes.byteLength),
        'x-repo-commit':
          '0000000000000000000000000000000000000000',
      }, bytes),
    });
    await expect(wrongRevision.open(
      fixtureModelManifest(),
      'onnx-q8',
      new AbortController().signal,
    )).rejects.toMatchObject<ModelDownloadError>({
      code: 'MODEL_DOWNLOAD_RESPONSE_INVALID',
    });
  });
});
