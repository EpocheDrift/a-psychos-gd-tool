// Revision/render contract gate against the real browser and WebGPU stack.
// It proves exact-ticket waiting, latest-wins coalescing, last-known-good
// metadata, and bounded texture-pool behavior during frame-size churn.
import {
  assertDevHook,
  assertNoPageProblems,
  navigateToApp,
  waitForInitialCook,
  withSmokePage,
} from './smoke/browser.mjs';

await withSmokePage(
  { storage: { mode: 'empty' } },
  async ({ page, url, problems }) => {
    await navigateToApp(page, url);
    await assertDevHook(page);
    await waitForInitialCook(page, { width: 2480, height: 3508 });

    const hookAvailable = await page.evaluate(() =>
      Boolean(
        globalThis.__render?.getStatus
        && globalThis.__render?.awaitRender
        && globalThis.__render?.getPoolStats,
      ));
    if (!hookAvailable) {
      throw new Error(
        'Revision smoke requires the DEV-only read-only __render hook.',
      );
    }

    const coalesced = await page.evaluate(async () => {
      const app = globalThis.__app;
      const render = globalThis.__render;
      const tickets = [];

      // This loop never yields. Every store subscription schedules
      // synchronously, so all but the final attempt must be coalesced.
      for (let width = 801; width <= 812; width++) {
        const state = app.getState();
        state.setFrame({ ...state.doc.frame, width });
        tickets.push(render.getStatus().ticket);
      }

      const first = tickets[0];
      const last = tickets.at(-1);
      const firstResult = await render.awaitRender({
        ...first,
        timeoutMs: 20_000,
      });
      const lastResult = await render.awaitRender({
        ...last,
        timeoutMs: 20_000,
      });
      return {
        tickets,
        firstResult,
        lastResult,
        statuses: tickets.map((ticket) => render.getStatus(ticket)),
        latest: render.getStatus(),
        pool: render.getPoolStats(),
        documentRevision: app.getState().revision,
      };
    });

    if (coalesced.tickets.some((ticket) => !ticket)) {
      throw new Error(`missing scheduled ticket: ${JSON.stringify(coalesced)}`);
    }
    const uniqueRevisions = new Set(
      coalesced.tickets.map((ticket) => ticket.revision),
    );
    if (uniqueRevisions.size !== coalesced.tickets.length) {
      throw new Error(`frame edits did not create unique revisions: ${JSON.stringify(coalesced.tickets)}`);
    }
    if (coalesced.firstResult.state !== 'superseded') {
      throw new Error(`exact first ticket did not supersede: ${JSON.stringify(coalesced.firstResult)}`);
    }
    if (coalesced.statuses.slice(0, -1).some((status) => status.state !== 'superseded')) {
      throw new Error(`an intermediate ticket was not superseded: ${JSON.stringify(coalesced.statuses)}`);
    }
    const finalTicket = coalesced.tickets.at(-1);
    if (
      coalesced.lastResult.state !== 'complete'
      || coalesced.lastResult.renderRevision !== finalTicket.revision
      || coalesced.latest.displayedRevision !== finalTicket.revision
      || coalesced.latest.documentRevision !== coalesced.documentRevision
    ) {
      throw new Error(`latest render did not complete exactly: ${JSON.stringify(coalesced)}`);
    }

    // Sequentially completed sizes exercise retained evaluator generations,
    // free-texture LRU eviction, and hard allocation limits—not only queue
    // coalescing.
    const completedChurn = await page.evaluate(async () => {
      const app = globalThis.__app;
      const render = globalThis.__render;
      const snapshots = [];
      for (const width of [864, 928, 992, 1056, 1120, 1184]) {
        const state = app.getState();
        state.setFrame({ ...state.doc.frame, width });
        const ticket = render.getStatus().ticket;
        const status = await render.awaitRender({
          ...ticket,
          timeoutMs: 20_000,
        });
        snapshots.push({ ticket, status, pool: render.getPoolStats() });
      }
      return {
        snapshots,
        latest: render.getStatus(),
        documentRevision: app.getState().revision,
      };
    });

    for (const snapshot of completedChurn.snapshots) {
      if (
        snapshot.status.state !== 'complete'
        || snapshot.status.renderRevision !== snapshot.ticket.revision
      ) {
        throw new Error(`sequential churn did not complete exactly: ${JSON.stringify(snapshot)}`);
      }
      const stats = snapshot.pool;
      if (!stats) throw new Error('texture-pool stats unavailable');
      if (
        stats.totalBytes > stats.maxBytes
        || stats.freeBytes > stats.maxFreeBytes
        || stats.allocated > stats.maxTextures
      ) {
        throw new Error(`texture-pool budget exceeded: ${JSON.stringify(stats)}`);
      }
    }

    const last = completedChurn.snapshots.at(-1);
    if (
      completedChurn.latest.displayedRevision !== completedChurn.documentRevision
      || last.ticket.revision !== completedChurn.documentRevision
    ) {
      throw new Error(`displayed/document revision mismatch: ${JSON.stringify(completedChurn.latest)}`);
    }

    const canvasStatus = await page.$eval(
      '.viewport canvas:not(.guide-overlay):not([hidden])',
      (element) => ({
        revision: Number(element.dataset.renderRevision),
        attempt: Number(element.dataset.renderAttempt),
        state: element.dataset.renderState,
      }),
    );
    if (
      canvasStatus.revision !== last.ticket.revision
      || canvasStatus.attempt !== last.ticket.attempt
      || canvasStatus.state !== 'complete'
    ) {
      throw new Error(`canvas revision label mismatch: ${JSON.stringify(canvasStatus)}`);
    }

    console.log('coalesced revisions:', coalesced.tickets.length);
    console.log('completed churn:', completedChurn.snapshots.length);
    console.log('final status:', JSON.stringify(completedChurn.latest));
    console.log('final pool:', JSON.stringify(last.pool));
    assertNoPageProblems(problems);
    console.log('ALL CHECKS PASSED');
  },
);
