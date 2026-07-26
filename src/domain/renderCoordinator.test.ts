import { describe, expect, it, vi } from 'vitest';
import {
  AwaitRenderTimeoutError,
  RenderCoordinator,
  type RenderExecutionResult,
  type RenderJob,
} from './renderCoordinator';
import { CookCancelledError } from '../engine/cookControl';

interface DeferredRun {
  job: RenderJob<string>;
  resolve: (result?: RenderExecutionResult) => void;
  reject: (error: unknown) => void;
}

function deferredExecutor() {
  const runs: DeferredRun[] = [];
  const executor = vi.fn((job: RenderJob<string>) =>
    new Promise<RenderExecutionResult>((resolve, reject) => {
      const onAbort = () => reject(job.signal.reason);
      job.signal.addEventListener('abort', onAbort, { once: true });
      runs.push({
        job,
        resolve: (result = {}) => {
          job.signal.removeEventListener('abort', onAbort);
          resolve(result);
        },
        reject,
      });
    }));
  return { executor, runs };
}

async function turn(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('RenderCoordinator', () => {
  it('publishes queued, cooking, and GPU-confirmed completion for one ticket', async () => {
    const { executor, runs } = deferredExecutor();
    const coordinator = new RenderCoordinator<string>();
    const observed: string[] = [];
    coordinator.subscribe((status) => observed.push(
      `${status.requestedRevision}:${status.state}`,
    ));
    coordinator.setExecutor(executor);

    const ticket = coordinator.schedule(1, 'doc-1');
    expect(ticket).toEqual({ revision: 1, attempt: 1 });
    expect(runs).toHaveLength(1);
    expect(runs[0].job.input).toBe('doc-1');
    expect(runs[0].job.ticket).toEqual(ticket);

    const waiting = coordinator.awaitRender(ticket);
    const publish = vi.fn();
    const rollback = vi.fn();
    runs[0].resolve({
      events: [{
        revision: 1,
        attempt: 1,
        layerId: 'layer_1',
        nodeId: 'out',
        type: 'Output',
        status: 'miss',
        ms: 2,
      }],
      publish,
      rollback,
    });
    const complete = await waiting;
    expect(complete).toMatchObject({
      documentRevision: 1,
      ticket,
      displayedTicket: ticket,
      requestedRevision: 1,
      renderRevision: 1,
      state: 'complete',
      events: [{ revision: 1, layerId: 'layer_1', nodeId: 'out' }],
    });
    expect(publish).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
    expect(observed).toEqual(['1:queued', '1:cooking', '1:complete']);
  });

  it('marks active and skipped intermediate revisions superseded', async () => {
    const { executor, runs } = deferredExecutor();
    const coordinator = new RenderCoordinator<string>();
    coordinator.setExecutor(executor);
    const ticket1 = coordinator.schedule(1, 'doc-1');
    const first = coordinator.awaitRender(ticket1);
    const ticket2 = coordinator.schedule(2, 'doc-2');
    const second = coordinator.awaitRender(ticket2);
    const ticket3 = coordinator.schedule(3, 'doc-3');

    expect((await first)).toMatchObject({
      requestedRevision: 1,
      state: 'superseded',
      error: { code: 'RENDER_SUPERSEDED' },
    });
    expect((await second)).toMatchObject({
      requestedRevision: 2,
      state: 'superseded',
      error: { code: 'RENDER_SUPERSEDED' },
    });

    await turn();
    expect(runs).toHaveLength(2);
    expect(runs[1].job).toMatchObject({
      ticket: ticket3,
      revision: 3,
      input: 'doc-3',
    });
    runs[1].resolve();
    await turn();
    expect(coordinator.getRenderStatus(3)).toMatchObject({
      requestedRevision: 3,
      renderRevision: 3,
      state: 'complete',
    });
  });

  it('never resolves an exact waiter from a later unrelated completion', async () => {
    vi.useFakeTimers();
    try {
      const { executor, runs } = deferredExecutor();
      const coordinator = new RenderCoordinator<string>();
      coordinator.setExecutor(executor);
      const unknown = coordinator.awaitRender(7, { timeoutMs: 50 });
      coordinator.schedule(8, 'doc-8');
      runs[0].resolve();
      await turn();
      expect(coordinator.getRenderStatus(8).state).toBe('complete');

      const observed = vi.fn();
      void unknown.then(observed, observed);
      await turn();
      expect(observed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(50);
      await expect(unknown).rejects.toBeInstanceOf(AwaitRenderTimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives a same-revision rerender a new immutable attempt', async () => {
    const { executor, runs } = deferredExecutor();
    const coordinator = new RenderCoordinator<string>();
    coordinator.setExecutor(executor);
    const firstTicket = coordinator.schedule(4, 'fallback-font');
    const first = coordinator.awaitRender(firstTicket);
    const secondTicket = coordinator.schedule(4, 'loaded-font');
    const second = coordinator.awaitRender(secondTicket);
    await expect(first).resolves.toMatchObject({
      ticket: firstTicket,
      state: 'superseded',
      error: { code: 'RENDER_SUPERSEDED' },
    });
    await turn();

    expect(runs).toHaveLength(2);
    expect(runs[1].job.input).toBe('loaded-font');

    runs[1].resolve();
    await expect(second).resolves.toMatchObject({
      ticket: secondTicket,
      requestedRevision: 4,
      state: 'complete',
      renderRevision: 4,
    });
  });

  it('locks an attempt-less waiter to the latest attempt at call time', async () => {
    const { executor, runs } = deferredExecutor();
    const coordinator = new RenderCoordinator<string>();
    coordinator.setExecutor(executor);
    const firstTicket = coordinator.schedule(4, 'fallback-font');
    const waiting = coordinator.awaitRender({ revision: 4 });
    coordinator.schedule(4, 'loaded-font');
    await expect(waiting).resolves.toMatchObject({
      ticket: firstTicket,
      state: 'superseded',
    });
    await turn();
    runs[1].resolve();
  });

  it('deduplicates an identical store scheduling key', () => {
    const { executor } = deferredExecutor();
    const coordinator = new RenderCoordinator<string>();
    coordinator.setExecutor(executor);
    const first = coordinator.schedule(1, 'doc', { dedupeKey: 'env:0' });
    const duplicate = coordinator.schedule(1, 'ignored', { dedupeKey: 'env:0' });
    expect(duplicate).toEqual(first);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('preserves stable layer and node attribution on failure', async () => {
    const coordinator = new RenderCoordinator<string>();
    coordinator.setExecutor(async () => {
      throw Object.assign(new Error('node cook exploded'), {
        code: 'RENDER_FAILED',
        layerId: 'layer_2',
        nodeId: 'trace_1',
        recoverable: true,
      });
    });
    const ticket = coordinator.schedule(9, 'doc-9');
    const status = await coordinator.awaitRender(ticket);
    expect(status).toMatchObject({
      state: 'failed',
      error: {
        code: 'RENDER_FAILED',
        revision: 9,
        attempt: 1,
        layerId: 'layer_2',
        nodeId: 'trace_1',
        message: 'node cook exploded',
      },
    });
  });

  it('fails a deadline even when an executor does not observe abort promptly', async () => {
    vi.useFakeTimers();
    try {
      const { executor } = deferredExecutor();
      const coordinator = new RenderCoordinator<string>({ defaultDeadlineMs: 25 });
      coordinator.setExecutor(executor);
      const ticket = coordinator.schedule(10, 'doc-10');
      const waiting = coordinator.awaitRender(ticket);
      await vi.advanceTimersByTimeAsync(25);
      await expect(waiting).resolves.toMatchObject({
        state: 'failed',
        error: { code: 'TIMEOUT', revision: 10 },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the last successful revision visible while a newer one fails', async () => {
    let call = 0;
    const coordinator = new RenderCoordinator<string>();
    coordinator.setExecutor(async () => {
      call++;
      if (call === 2) throw new Error('second failed');
      return {};
    });
    const first = coordinator.schedule(1, 'doc-1');
    await coordinator.awaitRender(first);
    const second = coordinator.schedule(2, 'doc-2');
    const failed = await coordinator.awaitRender(second);
    expect(failed).toMatchObject({
      documentRevision: 2,
      requestedRevision: 2,
      renderRevision: null,
      displayedRevision: 1,
      displayedTicket: first,
      state: 'failed',
    });
  });

  it('gives independent waiters independent timeouts', async () => {
    vi.useFakeTimers();
    try {
      const { executor, runs } = deferredExecutor();
      const coordinator = new RenderCoordinator<string>();
      coordinator.setExecutor(executor);
      const ticket = coordinator.schedule(1, 'doc');
      const short = coordinator.awaitRender({ ...ticket, timeoutMs: 10 });
      const long = coordinator.awaitRender({ ...ticket, timeoutMs: 50 });
      const shortAssertion = expect(short).rejects.toBeInstanceOf(
        AwaitRenderTimeoutError,
      );
      await vi.advanceTimersByTimeAsync(10);
      await shortAssertion;
      runs[0].resolve();
      await expect(long).resolves.toMatchObject({ ticket, state: 'complete' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a stale revision without superseding the current one', () => {
    const { executor } = deferredExecutor();
    const coordinator = new RenderCoordinator<string>();
    coordinator.setExecutor(executor);
    const current = coordinator.schedule(10, 'new');
    expect(() => coordinator.schedule(9, 'stale')).toThrow(/stale render revision/);
    expect(coordinator.getRenderStatus()).toMatchObject({
      documentRevision: 10,
      ticket: current,
      state: 'cooking',
    });
  });

  it('counts queued time against the render deadline', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new RenderCoordinator<string>();
      const ticket = coordinator.schedule(1, 'queued', { deadlineMs: 10 });
      const waiting = coordinator.awaitRender(ticket);
      await vi.advanceTimersByTimeAsync(10);
      await expect(waiting).resolves.toMatchObject({
        ticket,
        state: 'failed',
        error: { code: 'TIMEOUT' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out queued work even while an obsolete executor refuses to drain', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new RenderCoordinator<string>();
      coordinator.setExecutor(() => new Promise(() => {}));
      coordinator.schedule(1, 'stuck', { deadlineMs: 100 });
      const queued = coordinator.schedule(2, 'latest', { deadlineMs: 10 });
      const waiting = coordinator.awaitRender(queued);
      await vi.advanceTimersByTimeAsync(10);
      await expect(waiting).resolves.toMatchObject({
        state: 'failed',
        error: { code: 'TIMEOUT' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('never publishes a late executor success after the absolute deadline', async () => {
    vi.useFakeTimers();
    try {
      let resolve!: (result: RenderExecutionResult) => void;
      const coordinator = new RenderCoordinator<string>();
      coordinator.setExecutor(() => new Promise((done) => {
        resolve = done;
      }));
      const ticket = coordinator.schedule(1, 'slow', { deadlineMs: 10 });
      const waiting = coordinator.awaitRender(ticket);
      const rollback = vi.fn();
      await vi.advanceTimersByTimeAsync(10);
      await expect(waiting).resolves.toMatchObject({ state: 'failed' });
      resolve({ rollback });
      await turn();
      expect(coordinator.getRenderStatus(ticket).state).toBe('failed');
      expect(rollback).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects keyed future waiters and clears their listeners on dispose', async () => {
    const coordinator = new RenderCoordinator<string>();
    const waiting = coordinator.awaitRender({ revision: 1, attempt: 99 });
    const rejected = expect(waiting).rejects.toBeInstanceOf(Error);
    coordinator.dispose();
    await rejected;
    await expect(coordinator.awaitRender({ revision: 2 })).rejects.toBeInstanceOf(
      CookCancelledError,
    );
    expect(() => coordinator.subscribe(() => {})).toThrow(/disposed/);
  });

  it('keeps evicted exact tickets conservatively terminal', async () => {
    const coordinator = new RenderCoordinator<string>({ historyLimit: 1 });
    coordinator.setExecutor(async () => ({}));
    for (let revision = 1; revision <= 4; revision++) {
      const ticket = coordinator.schedule(revision, `doc-${revision}`);
      await coordinator.awaitRender(ticket);
    }
    expect(coordinator.getRenderStatus({
      revision: 1,
      attempt: 1,
    }).state).toBe('superseded');
    expect((await coordinator.awaitRender({ revision: 1 })).state).toBe(
      'superseded',
    );
  });

  it('returns isolated event and error snapshots', async () => {
    let call = 0;
    const coordinator = new RenderCoordinator<string>();
    coordinator.setExecutor(async () => {
      call++;
      if (call === 1) {
        return {
          events: [{
            revision: 999,
            attempt: 999,
            layerId: 'layer',
            nodeId: 'node',
            type: 'Output',
            status: 'miss',
            ms: 1,
          }],
        };
      }
      throw Object.assign(new Error('failed'), {
        details: { nested: { value: 1 } },
      });
    });
    const first = coordinator.schedule(1, 'ok');
    const firstStatus = await coordinator.awaitRender(first);
    firstStatus.events![0].revision = 999;
    expect(coordinator.getRenderStatus(first).events![0]).toMatchObject({
      revision: 1,
      attempt: 1,
    });

    const second = coordinator.schedule(2, 'bad');
    const failed = await coordinator.awaitRender(second);
    (failed.error!.details!.nested as { value: number }).value = 999;
    expect(coordinator.getRenderStatus(second).error?.details).toEqual({
      nested: { value: 1 },
    });
  });

  it('bounds outstanding waiters', async () => {
    const coordinator = new RenderCoordinator<string>({
      maxWaiters: 1,
      defaultDeadlineMs: 100,
    });
    const first = coordinator.awaitRender({ revision: 1, attempt: 1 });
    await expect(coordinator.awaitRender({
      revision: 1,
      attempt: 2,
    })).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    coordinator.dispose();
    await expect(first).rejects.toBeInstanceOf(Error);
  });

  it('rolls back a prepared success that loses its exact ticket before publish', async () => {
    let resolveFirst!: (result: RenderExecutionResult) => void;
    const coordinator = new RenderCoordinator<string>();
    coordinator.setExecutor((job) => {
      if (job.revision === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({});
    });
    const first = coordinator.schedule(1, 'first');
    const firstTerminal = coordinator.awaitRender(first);
    const publish = vi.fn();
    const rollback = vi.fn();
    resolveFirst({ publish, rollback });
    const second = coordinator.schedule(2, 'second');

    await expect(firstTerminal).resolves.toMatchObject({
      state: 'superseded',
    });
    await turn();
    expect(publish).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledOnce();
    await expect(coordinator.awaitRender(second)).resolves.toMatchObject({
      state: 'complete',
    });
  });

  it('cancels terminal status immediately but resolves idle only after executor drain', async () => {
    let resolveRun!: (result: RenderExecutionResult) => void;
    const coordinator = new RenderCoordinator<string>();
    coordinator.setExecutor(() => new Promise((resolve) => {
      resolveRun = resolve;
    }));
    const ticket = coordinator.schedule(1, 'active');
    const terminal = coordinator.awaitRender(ticket);
    const idle = coordinator.whenIdle();
    const idleObserved = vi.fn();
    void idle.then(idleObserved);

    coordinator.clearExecutor();
    coordinator.cancelPending();
    await expect(terminal).resolves.toMatchObject({ state: 'superseded' });
    await turn();
    expect(idleObserved).not.toHaveBeenCalled();

    const rollback = vi.fn();
    resolveRun({ rollback });
    await idle;
    expect(rollback).toHaveBeenCalledOnce();
    expect(idleObserved).toHaveBeenCalledOnce();
  });
});
