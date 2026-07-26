import { describe, expect, it, vi } from 'vitest';
import { CookResourceLimitError } from '../engine/cookControl';
import {
  PreviewWorkerClient,
  type PreviewWorkerFactory,
} from './previewWorkerClient';
import { PREVIEW_METRICS_VERSION } from './previewMetrics';
import type {
  PreviewWorkerReply,
  PreviewWorkerRequest,
} from './previewWorkerProtocol';

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly posted: PreviewWorkerRequest[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.posted.push(message as PreviewWorkerRequest);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(value: PreviewWorkerReply): void {
    this.onmessage?.({ data: value } as MessageEvent<unknown>);
  }
}

function pixel(width = 1, height = 1) {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  };
}

function success(
  request: PreviewWorkerRequest,
  overrides: Partial<Extract<PreviewWorkerReply, { ok: true }>> = {},
): Extract<PreviewWorkerReply, { ok: true }> {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  return {
    id: request.id,
    generation: request.generation,
    ok: true,
    width: request.width,
    height: request.height,
    mimeType: request.format === 'webp' ? 'image/webp' : 'image/png',
    bytes,
    byteLength: bytes.byteLength,
    contentHash: 'a'.repeat(64),
    rgbaSha256: 'b'.repeat(64),
    ...(request.includeMetrics
      ? {
          metrics: {
            version: PREVIEW_METRICS_VERSION,
            alphaCoverage: 1,
            nonBackgroundBounds: null,
            luminance: { min: 1, max: 1, mean: 1 },
            perceptualHash: '0'.repeat(16),
            background: {
              premultipliedRgba: [0, 0, 0, 0],
              confidence: 1,
            },
          },
        }
      : {}),
    ...overrides,
  };
}

function harness() {
  const workers: FakeWorker[] = [];
  const factory: PreviewWorkerFactory = () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  };
  return {
    client: new PreviewWorkerClient(factory),
    workers,
  };
}

describe('PreviewWorkerClient', () => {
  it('dispatches one request at a time and preserves FIFO order', async () => {
    const { client, workers } = harness();
    const first = client.encode(pixel(), {
      format: 'png',
      includeMetrics: true,
    });
    const second = client.encode(pixel(), {
      format: 'webp',
      includeMetrics: false,
    });
    expect(workers).toHaveLength(1);
    expect(workers[0].posted).toHaveLength(1);
    const firstRequest = workers[0].posted[0];
    workers[0].reply(success(firstRequest));
    await expect(first).resolves.toMatchObject({ mimeType: 'image/png' });
    expect(workers[0].posted).toHaveLength(2);
    const secondRequest = workers[0].posted[1];
    workers[0].reply(success(secondRequest));
    await expect(second).resolves.toMatchObject({ mimeType: 'image/webp' });
    await expect(client.whenIdle()).resolves.toBeUndefined();
    expect(client.stats()).toMatchObject({
      pending: 0,
      pendingBytes: 0,
      active: false,
    });
  });

  it('terminates an interrupted active worker and recovers on a fresh generation', async () => {
    const { client, workers } = harness();
    const controller = new AbortController();
    const first = client.encode(pixel(), {
      format: 'png',
      includeMetrics: true,
      signal: controller.signal,
      revision: 7,
    });
    const second = client.encode(pixel(), {
      format: 'png',
      includeMetrics: true,
    });
    controller.abort(new Error('stop preview'));
    await expect(first).rejects.toThrow('stop preview');
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    const secondRequest = workers[1].posted[0];
    expect(secondRequest.generation).toBeGreaterThan(
      workers[0].posted[0].generation,
    );
    workers[1].reply(success(secondRequest));
    await expect(second).resolves.toMatchObject({ byteLength: 3 });
  });

  it('rejects count and byte queue overflow before copying more pixels', async () => {
    const { client } = harness();
    const first = client.encode(pixel(), {
      format: 'png',
      includeMetrics: true,
      maxPendingRequests: 1,
    });
    await expect(client.encode(pixel(), {
      format: 'png',
      includeMetrics: true,
      maxPendingRequests: 1,
    })).rejects.toBeInstanceOf(CookResourceLimitError);
    client.reset();
    await expect(first).rejects.toMatchObject({ code: 'RENDER_SUPERSEDED' });

    const pending = client.encode(pixel(2, 2), {
      format: 'png',
      includeMetrics: true,
      maxPendingBytes: 16,
    });
    await expect(client.encode(pixel(), {
      format: 'png',
      includeMetrics: true,
      maxPendingBytes: 16,
    })).rejects.toBeInstanceOf(CookResourceLimitError);
    client.reset();
    await expect(pending).rejects.toMatchObject({ code: 'RENDER_SUPERSEDED' });
  });

  it('restarts after a malformed success payload', async () => {
    const { client, workers } = harness();
    const first = client.encode(pixel(), {
      format: 'png',
      includeMetrics: true,
    });
    const request = workers[0].posted[0];
    workers[0].reply(success(request, {
      byteLength: 999,
    }));
    await expect(first).rejects.toThrow(/protocol error/);
    expect(workers[0].terminated).toBe(true);
  });

  it.each([
    { mimeType: 'image/webp' as const },
    { metrics: undefined },
    {
      metrics: {
        version: PREVIEW_METRICS_VERSION,
        alphaCoverage: 2,
        nonBackgroundBounds: null,
        luminance: { min: 0, max: 1, mean: 0.5 },
        perceptualHash: '0'.repeat(16),
        background: null,
      },
    },
  ])('rejects a success payload that violates its request contract', async (override) => {
    const { client, workers } = harness();
    const encoded = client.encode(pixel(), {
      format: 'png',
      includeMetrics: true,
    });
    const request = workers[0].posted[0];
    workers[0].reply(success(request, override));
    await expect(encoded).rejects.toThrow(/protocol error/);
    expect(workers[0].terminated).toBe(true);
  });

  it('settles accounting and recovers when worker construction throws', async () => {
    const working = new FakeWorker();
    let factories = 0;
    const client = new PreviewWorkerClient(() => {
      if (factories++ === 0) throw new Error('worker blocked by policy');
      return working;
    });
    await expect(client.encode(pixel(), {
      format: 'png',
      includeMetrics: true,
    })).rejects.toThrow('worker blocked by policy');
    expect(client.stats()).toMatchObject({
      pending: 0,
      pendingBytes: 0,
      active: false,
      worker: false,
    });

    const recovered = client.encode(pixel(), {
      format: 'png',
      includeMetrics: true,
    });
    const request = working.posted[0];
    working.reply(success(request));
    await expect(recovered).resolves.toMatchObject({ mimeType: 'image/png' });
    await expect(client.whenIdle()).resolves.toBeUndefined();
  });

  it('terminates active native work at its deadline', async () => {
    vi.useFakeTimers();
    try {
      const { client, workers } = harness();
      const encoded = client.encode(pixel(), {
        format: 'png',
        includeMetrics: true,
        revision: 3,
        deadline: performance.now() + 50,
      });
      const rejected = expect(encoded).rejects.toMatchObject({ code: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(51);
      await rejected;
      expect(workers[0].terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
