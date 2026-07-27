import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_PREPARE_PATH,
  MODEL_STATUS_PATH,
  RMBG_MODEL_ARTIFACTS,
  RMBG_MODEL_KEY,
  RMBG_MODEL_MANIFEST_SHA256,
  RMBG_MODEL_PUBLIC_LICENSE,
  RMBG_MODEL_REVISION,
  RMBG_MODEL_TOTAL_BYTES,
} from '../../packages/mcp-companion/src/modelPublicContract';
import {
  ModelPreparationClientError,
  getPinnedModelStatus,
  parsePublicModelStatus,
  preparePinnedModelFromTrustedUi,
} from './modelPreparation';

const totalBytes = RMBG_MODEL_TOTAL_BYTES;

function completeStatus(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    modelKey: RMBG_MODEL_KEY,
    revision: RMBG_MODEL_REVISION,
    manifestSha256: RMBG_MODEL_MANIFEST_SHA256,
    state: 'ready',
    bytes: totalBytes,
    totalBytes,
    artifacts: RMBG_MODEL_ARTIFACTS.map((artifact) => ({
      id: artifact.id,
      state: 'ready',
      bytes: artifact.byteLength,
      totalBytes: artifact.byteLength,
    })),
    license: {
      id: RMBG_MODEL_PUBLIC_LICENSE.id,
      name: RMBG_MODEL_PUBLIC_LICENSE.name,
      summary: RMBG_MODEL_PUBLIC_LICENSE.summary,
      commercialUse: 'separate-agreement-required',
      requiresExplicitApproval: true,
    },
  };
}

function cloneStatus(): Record<string, unknown> {
  return structuredClone(completeStatus());
}

function artifactsOf(
  status: Record<string, unknown>,
): Array<Record<string, unknown>> {
  return status.artifacts as Array<Record<string, unknown>>;
}

function licenseOf(
  status: Record<string, unknown>,
): Record<string, unknown> {
  return status.license as Record<string, unknown>;
}

function jsonResponse(
  value: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('model preparation status parser', () => {
  it('accepts only the fixed complete pinned-model status', () => {
    const parsed = parsePublicModelStatus(completeStatus());
    expect(parsed).toEqual(completeStatus());
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.artifacts)).toBe(true);
    expect(parsed.artifacts.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(parsed.license)).toBe(true);
  });

  it('rejects extra keys at every public status level', () => {
    const candidates = [
      (() => {
        const status = cloneStatus();
        status.extra = true;
        return status;
      })(),
      (() => {
        const status = cloneStatus();
        licenseOf(status).extra = true;
        return status;
      })(),
      (() => {
        const status = cloneStatus();
        artifactsOf(status)[0]!.extra = true;
        return status;
      })(),
      (() => {
        const status = cloneStatus();
        status.state = 'failed';
        status.error = {
          code: 'MODEL_CACHE_CORRUPT',
          recoverable: true,
          message: 'internal detail',
        };
        return status;
      })(),
    ];

    for (const candidate of candidates) {
      expect(() => parsePublicModelStatus(candidate))
        .toThrow(ModelPreparationClientError);
    }
  });

  it('rejects the wrong manifest digest, revision, and byte totals', () => {
    const candidates = [
      (() => {
        const status = cloneStatus();
        status.manifestSha256 = '0'.repeat(64);
        return status;
      })(),
      (() => {
        const status = cloneStatus();
        status.revision = '0'.repeat(40);
        return status;
      })(),
      (() => {
        const status = cloneStatus();
        status.totalBytes = totalBytes + 1;
        return status;
      })(),
      (() => {
        const status = cloneStatus();
        artifactsOf(status)[0]!.totalBytes =
          RMBG_MODEL_ARTIFACTS[0]!.byteLength + 1;
        return status;
      })(),
    ];

    for (const candidate of candidates) {
      expect(() => parsePublicModelStatus(candidate))
        .toThrow(ModelPreparationClientError);
    }
  });

  it('rejects artifact reordering, wrong IDs, and inconsistent byte sums', () => {
    const candidates = [
      (() => {
        const status = cloneStatus();
        status.artifacts = [...artifactsOf(status)].reverse();
        return status;
      })(),
      (() => {
        const status = cloneStatus();
        artifactsOf(status)[0]!.id = 'unexpected-artifact';
        return status;
      })(),
      (() => {
        const status = cloneStatus();
        artifactsOf(status)[0]!.bytes = 0;
        return status;
      })(),
      (() => {
        const status = cloneStatus();
        status.bytes = totalBytes - 1;
        return status;
      })(),
    ];

    for (const candidate of candidates) {
      expect(() => parsePublicModelStatus(candidate))
        .toThrow(ModelPreparationClientError);
    }
  });

  it('rejects URL/path disclosure and overlong error codes', () => {
    const candidates = [
      (() => {
        const status = cloneStatus();
        status.url = 'https://huggingface.co/private/source';
        return status;
      })(),
      (() => {
        const status = cloneStatus();
        artifactsOf(status)[0]!.path = '/private/model/cache';
        return status;
      })(),
      (() => {
        const status = cloneStatus();
        status.state = 'failed';
        status.error = {
          code: 'MODEL_FAILURE',
          recoverable: true,
          path: '/private/model/cache',
        };
        return status;
      })(),
      (() => {
        const status = cloneStatus();
        status.state = 'failed';
        status.error = {
          code: `M${'A'.repeat(64)}`,
          recoverable: true,
        };
        return status;
      })(),
    ];

    for (const candidate of candidates) {
      expect(() => parsePublicModelStatus(candidate))
        .toThrow(ModelPreparationClientError);
    }
  });
});

describe('model preparation HTTP client', () => {
  it('fetches the bounded fixed status from the local same-origin route', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(completeStatus()),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getPinnedModelStatus()).resolves.toEqual(completeStatus());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      MODEL_STATUS_PATH,
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: { Accept: 'application/json' },
      }),
    );
  });

  it('rejects declared and streamed bodies above the status budget', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(completeStatus(), {
          headers: { 'content-length': String(32 * 1024 + 1) },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(getPinnedModelStatus())
      .rejects.toBeInstanceOf(ModelPreparationClientError);

    fetchMock.mockResolvedValueOnce(new Response(
      'x'.repeat(32 * 1024 + 1),
      { status: 200 },
    ));
    await expect(getPinnedModelStatus())
      .rejects.toBeInstanceOf(ModelPreparationClientError);
  });

  it('rejects non-2xx status responses without parsing their body', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(completeStatus(), { status: 503 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getPinnedModelStatus())
      .rejects.toBeInstanceOf(ModelPreparationClientError);
  });

  it('posts exactly the seven trusted-approval fields without URL or path data', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(completeStatus()),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      preparePinnedModelFromTrustedUi('prepare_request.1'),
    ).resolves.toEqual(completeStatus());
    expect(fetchMock).toHaveBeenCalledOnce();
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe(MODEL_PREPARE_PATH);
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      schemaVersion: 1,
      kind: 'model-download-approval',
      requestId: 'prepare_request.1',
      approved: true,
      modelKey: RMBG_MODEL_KEY,
      manifestSha256: RMBG_MODEL_MANIFEST_SHA256,
      licenseId: 'bria-rmbg-1.4',
    });
    expect(Object.keys(body)).toHaveLength(7);
    expect(Object.keys(body).some((key) => /url|path/i.test(key))).toBe(false);
  });

  it('rejects unsafe request IDs before fetch', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse(completeStatus()),
    );
    vi.stubGlobal('fetch', fetchMock);

    for (const requestId of [
      '',
      '_starts-with-punctuation',
      'contains whitespace',
      'contains/slash',
      'r'.repeat(129),
      '非ascii',
    ]) {
      await expect(preparePinnedModelFromTrustedUi(requestId))
        .rejects.toBeInstanceOf(ModelPreparationClientError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
