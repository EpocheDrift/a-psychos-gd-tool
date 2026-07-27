import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TraceWorkerClient,
  type TraceWorkerFactory,
} from './traceClient';
import {
  CookCancelledError,
  CookDeadlineExceededError,
  CookResourceLimitError,
} from '../engine/cookControl';

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly posted: unknown[] = [];
  readonly transfers: Transferable[][] = [];
  terminated = false;
  throwOnPost: Error | null = null;

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    if (this.throwOnPost) throw this.throwOnPost;
    this.posted.push(message);
    this.transfers.push(transfer);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(payload: Record<string, unknown>): void {
    this.onmessage?.({ data: payload } as MessageEvent<unknown>);
  }

  fail(message = 'worker failed'): void {
    this.onerror?.({
      message,
      preventDefault: vi.fn(),
    } as unknown as ErrorEvent);
  }
}

function harness() {
  const workers: FakeWorker[] = [];
  const factory = (() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  }) as TraceWorkerFactory;
  return { workers, client: new TraceWorkerClient(factory) };
}

function pixels(width = 1, height = 1): ImageData {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: 'srgb',
  } as ImageData;
}

function traceRequest(imageData = pixels()) {
  return {
    op: 'composite' as const,
    imageData,
    smoothness: 1,
    minArea: 1,
    threshold: 1,
    dropLight: false,
  };
}

function postedId(worker: FakeWorker, index = 0): number {
  return (worker.posted[index] as { id: number }).id;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('TraceWorkerClient', () => {
  it('dispatches FIFO with only one active request', async () => {
    const { client, workers } = harness();
    const first = client.runTrace(traceRequest());
    const second = client.runTrace(traceRequest());

    expect(workers).toHaveLength(1);
    expect(workers[0].posted).toHaveLength(1);
    expect(client.stats()).toMatchObject({
      pending: 2,
      active: true,
      queued: 1,
    });

    workers[0].reply({ id: postedId(workers[0]), paths: [] });
    await expect(first).resolves.toEqual([]);
    expect(workers[0].posted).toHaveLength(2);
    workers[0].reply({ id: postedId(workers[0], 1), paths: [] });
    await expect(second).resolves.toEqual([]);
    expect(client.stats()).toMatchObject({
      pending: 0,
      pendingBytes: 0,
      active: false,
      queued: 0,
    });
  });

  it('enforces request-count and transferred-byte budgets before posting', async () => {
    const { client, workers } = harness();
    const first = client.runTrace(traceRequest(pixels(2, 2)), {
      maxPendingRequests: 1,
      maxPendingBytes: 16,
    });
    await expect(client.runTrace(traceRequest(), {
      maxPendingRequests: 1,
      maxPendingBytes: 16,
    })).rejects.toBeInstanceOf(CookResourceLimitError);
    await expect(client.runTrace(traceRequest(pixels(2, 2)), {
      maxPendingRequests: 2,
      maxPendingBytes: 31,
    })).rejects.toBeInstanceOf(CookResourceLimitError);
    expect(workers[0].posted).toHaveLength(1);
    workers[0].reply({ id: postedId(workers[0]), paths: [] });
    await first;
  });

  it('transfers exactly the billed pixel view and forwards vector limits', async () => {
    const { client, workers } = harness();
    const backing = new Uint8ClampedArray(12);
    const image = {
      data: backing.subarray(4, 8),
      width: 1,
      height: 1,
      colorSpace: 'srgb',
    } as ImageData;
    const request = client.runTrace(traceRequest(image), {
      maxVectorCommands: 123,
    });
    expect(workers[0].posted[0]).toMatchObject({
      maxVectorCommands: 123,
      data: expect.any(ArrayBuffer),
    });
    expect(
      (workers[0].posted[0] as { data: ArrayBuffer }).data.byteLength,
    ).toBe(4);
    expect(workers[0].transfers[0][0]).toBe(
      (workers[0].posted[0] as { data: ArrayBuffer }).data,
    );
    workers[0].reply({ id: postedId(workers[0]), paths: [] });
    await request;
  });

  it('maps a worker vector-limit rejection to a stable resource error', async () => {
    const { client, workers } = harness();
    const request = client.runTrace(traceRequest());
    workers[0].reply({
      id: postedId(workers[0]),
      error: 'too many commands',
      code: 'RESOURCE_LIMIT',
    });
    await expect(request).rejects.toBeInstanceOf(CookResourceLimitError);
  });

  it('removes a queued abort without terminating the active worker', async () => {
    const { client, workers } = harness();
    const first = client.runTrace(traceRequest(), { maxPendingRequests: 2 });
    const controller = new AbortController();
    const second = client.runTrace(traceRequest(), {
      maxPendingRequests: 2,
      signal: controller.signal,
    });
    const rejected = expect(second).rejects.toBeInstanceOf(CookCancelledError);
    controller.abort(new CookCancelledError(2));
    await rejected;
    expect(workers[0].terminated).toBe(false);
    expect(client.stats()).toMatchObject({ pending: 1, queued: 0 });

    const replacement = client.runTrace(traceRequest(), {
      maxPendingRequests: 2,
    });
    workers[0].reply({ id: postedId(workers[0]), paths: [] });
    await first;
    workers[0].reply({ id: postedId(workers[0], 1), paths: [] });
    await replacement;
  });

  it('terminates an active abort and continues queued work on a new worker', async () => {
    const { client, workers } = harness();
    const controller = new AbortController();
    const first = client.runTrace(traceRequest(), { signal: controller.signal });
    const second = client.runTrace(traceRequest());
    const rejected = expect(first).rejects.toBeInstanceOf(CookCancelledError);
    controller.abort(new CookCancelledError(1));
    await rejected;

    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1].posted).toHaveLength(1);
    workers[1].reply({ id: postedId(workers[1]), paths: [] });
    await expect(second).resolves.toEqual([]);
  });

  it('hard-terminates an active worker at the shared deadline', async () => {
    vi.useFakeTimers();
    const { client, workers } = harness();
    const request = client.runTrace(traceRequest(), {
      revision: 3,
      deadline: performance.now() + 25,
    });
    const rejected = expect(request).rejects.toBeInstanceOf(
      CookDeadlineExceededError,
    );
    expect(workers[0].posted[0]).toMatchObject({
      timeoutMs: expect.any(Number),
    });
    expect(workers[0].posted[0]).not.toHaveProperty('deadline');
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(workers[0].terminated).toBe(true);
    expect(client.stats().pending).toBe(0);
  });

  it('recovers after worker error, messageerror, and postMessage throw', async () => {
    const { client, workers } = harness();
    const first = client.runTrace(traceRequest());
    const firstRejected = expect(first).rejects.toThrow('boom');
    workers[0].fail('boom');
    await firstRejected;

    const second = client.runTrace(traceRequest());
    const secondRejected = expect(second).rejects.toThrow('unreadable');
    workers[1].onmessageerror?.({ data: null } as MessageEvent<unknown>);
    await secondRejected;

    const thirdPromise = client.runTrace(traceRequest());
    // This request was already posted. Fail it through a malformed protocol
    // reply, then configure the next generation to throw on post.
    const thirdRejected = expect(thirdPromise).rejects.toThrow('protocol');
    workers[2].reply({ nope: true });
    await thirdRejected;

    const throwing = new FakeWorker();
    throwing.throwOnPost = new Error('post broke');
    const throwingFactory = (() => throwing) as TraceWorkerFactory;
    const throwingClient = new TraceWorkerClient(throwingFactory);
    await expect(throwingClient.runTrace(traceRequest())).rejects.toThrow(
      'post broke',
    );
    expect(throwing.terminated).toBe(true);
  });

  it('ignores a late reply from a terminated generation', async () => {
    const { client, workers } = harness();
    const controller = new AbortController();
    const first = client.runTrace(traceRequest(), { signal: controller.signal });
    const oldHandler = workers[0].onmessage!;
    const oldId = postedId(workers[0]);
    const second = client.runTrace(traceRequest());
    const rejected = expect(first).rejects.toBeInstanceOf(CookCancelledError);
    controller.abort(new CookCancelledError(1));
    await rejected;

    oldHandler({ data: { id: oldId, paths: [] } } as MessageEvent<unknown>);
    expect(client.stats()).toMatchObject({ pending: 1, active: true });
    workers[1].reply({ id: postedId(workers[1]), paths: [] });
    await expect(second).resolves.toEqual([]);
  });

  it('rejects malformed success payloads instead of treating them as empty', async () => {
    const { client, workers } = harness();
    const trace = client.runTrace(traceRequest());
    const rejected = expect(trace).rejects.toThrow('wrong payload');
    workers[0].reply({ id: postedId(workers[0]) });
    await rejected;
    expect(workers[0].terminated).toBe(true);
  });

  it('reset rejects every request and clears all accounting', async () => {
    const { client, workers } = harness();
    const first = client.runTrace(traceRequest());
    const second = client.runTrace(traceRequest());
    const firstRejected = expect(first).rejects.toBeInstanceOf(
      CookCancelledError,
    );
    const secondRejected = expect(second).rejects.toBeInstanceOf(
      CookCancelledError,
    );
    client.reset();
    await Promise.all([firstRejected, secondRejected]);
    expect(workers[0].terminated).toBe(true);
    expect(client.stats()).toEqual({
      pending: 0,
      pendingBytes: 0,
      active: false,
      queued: 0,
      worker: false,
    });
  });
});
