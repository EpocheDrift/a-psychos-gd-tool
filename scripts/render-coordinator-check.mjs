// Revision/render contract gate against the real browser and WebGPU stack.
// It proves exact-ticket waiting, latest-wins coalescing, last-known-good
// metadata, and bounded texture-pool behavior during frame-size churn.
import {
  assertNoPageProblems,
  navigateToApp,
  pairAgent,
  waitForInitialCook,
  withSmokePage,
} from './smoke/browser.mjs';

await withSmokePage(
  { storage: { mode: 'empty' } },
  async ({ page, url, problems }) => {
    await navigateToApp(page, url);
    await waitForInitialCook(page, { width: 2480, height: 3508 });
    await pairAgent(page, { scopes: ['read', 'edit'] });

    const coalesced = await page.evaluate(async () => {
      const agent = globalThis.gfxAgent;
      const tickets = [];
      const initial = agent.getDocument({ include: ['frame'] });
      let expectedRevision = initial.revision;

      // Every transaction commits synchronously before its resolved Promise
      // yields. Render scheduling is synchronous with the store publication,
      // so all but the final queued revision are coalesced.
      for (let width = 801; width <= 812; width++) {
        const result = await agent.applyTransaction({
          requestId: `coalesce_${width}`,
          expectedRevision,
          commands: [{
            op: 'set_frame',
            width,
            height: initial.frame.height,
          }],
        });
        if (!result.ok) throw new Error(`coalescing transaction failed: ${JSON.stringify(result)}`);
        expectedRevision = result.revision;
        tickets.push(agent.getRenderStatus().ticket);
      }

      const first = tickets[0];
      const last = tickets.at(-1);
      const firstResult = await agent.awaitRender({
        ...first,
        timeoutMs: 20_000,
      });
      const lastResult = await agent.awaitRender({
        ...last,
        timeoutMs: 20_000,
      });
      return {
        tickets,
        firstResult,
        lastResult,
        statuses: tickets.map((ticket) => agent.getRenderStatus(ticket)),
        latest: agent.getRenderStatus(),
        documentRevision: agent.getDocument({ include: [] }).revision,
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
      const agent = globalThis.gfxAgent;
      const snapshots = [];
      const initial = agent.getDocument({ include: ['frame'] });
      const limits = agent.getCapabilities().limits;
      let expectedRevision = initial.revision;
      for (const width of [864, 928, 992, 1056, 1120, 1184]) {
        const result = await agent.applyTransaction({
          requestId: `completed_churn_${width}`,
          expectedRevision,
          commands: [{
            op: 'set_frame',
            width,
            height: initial.frame.height,
          }],
        });
        if (!result.ok) throw new Error(`churn transaction failed: ${JSON.stringify(result)}`);
        expectedRevision = result.revision;
        const ticket = agent.getRenderStatus().ticket;
        const status = await agent.awaitRender({
          ...ticket,
          timeoutMs: 20_000,
        });
        const poolText = document.querySelector('[data-agent-pool-status]')?.textContent ?? '';
        const match = /pool:\s*(\d+)\s+live\s*\/\s*(\d+)\s+allocated/.exec(poolText);
        snapshots.push({
          ticket,
          status,
          pool: match
            ? { live: Number(match[1]), allocated: Number(match[2]) }
            : null,
        });
      }
      return {
        snapshots,
        latest: agent.getRenderStatus(),
        documentRevision: agent.getDocument({ include: [] }).revision,
        maxTextures: limits.maxGpuTextures,
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
        stats.live > stats.allocated
        || stats.allocated > completedChurn.maxTextures
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
      '[data-agent-preview="main"]',
      (element) => ({
        revision: Number(element.dataset.agentRenderRevision),
        attempt: Number(element.dataset.agentRenderAttempt),
        state: element.dataset.agentRenderState,
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
