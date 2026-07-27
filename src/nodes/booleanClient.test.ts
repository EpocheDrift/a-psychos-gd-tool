import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BooleanWorkerClient,
  type BooleanWorkerFactory,
} from './booleanClient';
import {
  CookCancelledError,
  CookDeadlineExceededError,
  CookResourceLimitError,
} from '../engine/cookControl';
import type { Polyline } from '../engine/path';

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(payload: Record<string, unknown>): void {
    this.onmessage?.({ data: payload } as MessageEvent<unknown>);
  }
}

function harness() {
  const workers: FakeWorker[] = [];
  const factory = (() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  }) as BooleanWorkerFactory;
  return { client: new BooleanWorkerClient(factory), workers };
}

function polygon(points = 3): Polyline[] {
  return [{
    points: Array.from(
      { length: points },
      (_, index) => ({ x: index, y: index % 2 }),
    ),
    closed: true,
  }];
}

function postedId(worker: FakeWorker): number {
  return (worker.posted[0] as { id: number }).id;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('BooleanWorkerClient', () => {
  it('serializes requests and accepts only the exact active reply', async () => {
    const { client, workers } = harness();
    const first = client.run(polygon(), polygon(), 'union');
    const second = client.run(polygon(), polygon(), 'subtract');

    expect(workers).toHaveLength(1);
    expect(workers[0].posted).toHaveLength(1);
    workers[0].reply({ id: postedId(workers[0]), paths: [] });
    await expect(first).resolves.toEqual([]);
    expect(workers[0].posted).toHaveLength(2);
    const secondId = (workers[0].posted[1] as { id: number }).id;
    workers[0].reply({ id: secondId, paths: [] });
    await expect(second).resolves.toEqual([]);
    expect(client.stats()).toMatchObject({
      pending: 0,
      active: false,
      queued: 0,
    });
  });

  it('terminates opaque active work at deadline and recovers on a new worker', async () => {
    vi.useFakeTimers();
    const { client, workers } = harness();
    const first = client.run(polygon(), polygon(), 'intersect', {
      deadline: performance.now() + 25,
      revision: 9,
    });
    const rejected = expect(first).rejects.toBeInstanceOf(
      CookDeadlineExceededError,
    );
    const second = client.run(polygon(), polygon(), 'union');

    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    workers[1].reply({ id: postedId(workers[1]), paths: [] });
    await expect(second).resolves.toEqual([]);
  });

  it('removes a queued abort without terminating active work', async () => {
    const { client, workers } = harness();
    const first = client.run(polygon(), polygon(), 'union');
    const controller = new AbortController();
    const second = client.run(polygon(), polygon(), 'subtract', {
      signal: controller.signal,
    });
    const rejected = expect(second).rejects.toBeInstanceOf(
      CookCancelledError,
    );
    controller.abort(new CookCancelledError(2));
    await rejected;
    expect(workers[0].terminated).toBe(false);
    workers[0].reply({ id: postedId(workers[0]), paths: [] });
    await first;
  });

  it('rejects operand and queue limits before posting more work', async () => {
    const { client, workers } = harness();
    await expect(client.run(
      polygon(6),
      polygon(6),
      'union',
      { maxBooleanPoints: 10 },
    )).rejects.toBeInstanceOf(CookResourceLimitError);
    expect(workers).toHaveLength(0);

    const first = client.run(polygon(), polygon(), 'union', {
      maxPendingRequests: 1,
    });
    await expect(client.run(polygon(), polygon(), 'union', {
      maxPendingRequests: 1,
    })).rejects.toBeInstanceOf(CookResourceLimitError);
    workers[0].reply({ id: postedId(workers[0]), paths: [] });
    await first;
  });

  it('maps a worker resource rejection to a stable cook error', async () => {
    const { client, workers } = harness();
    const request = client.run(polygon(), polygon(), 'union');
    workers[0].reply({
      id: postedId(workers[0]),
      error: 'too complex',
      code: 'RESOURCE_LIMIT',
    });
    await expect(request).rejects.toBeInstanceOf(CookResourceLimitError);
  });
});
