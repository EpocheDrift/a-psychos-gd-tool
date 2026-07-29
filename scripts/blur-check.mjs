// Blur gate: cook the bundled poster example (Text -> Outline -> Rasterize -> Blur ->
// Output) at a heavy radius and capture the native poster PNG. Eyeball the halo:
// it should fade to paper with no dark rim and no hard cutoff.
// Usage: node scripts/blur-check.mjs [url]
import { writeFile } from 'node:fs/promises';
import {
  assertNoPageProblems,
  captureExportPng,
  navigateToApp,
  pairAgent,
  readDocumentFixture,
  smokeArtifactPath,
  waitForInitialCook,
  withSmokePage,
} from './smoke/browser.mjs';

const posterExample = await readDocumentFixture('factory-document.json');

await withSmokePage({ storage: { mode: 'v2', document: posterExample } }, async ({ page, url, problems }) => {
  await navigateToApp(page, url);
  await waitForInitialCook(page, { width: 2480, height: 3508 });
  await pairAgent(page, { scopes: ['read', 'edit'] });

  const before = await page.evaluate(() => {
    const snapshot = globalThis.gfxAgent.getDocument({
      layerIds: ['layer_1'],
      include: ['nodes'],
    });
    const layer = snapshot.layers?.[0];
    if (!layer?.graph.nodes.some((node) => node.id === 'blur1')) {
      throw new Error('poster example layer_1 blur1 node missing');
    }
    return {
      revision: snapshot.revision,
      nodes: layer.graph.nodes.map((node) => node.id).sort(),
      log: [...document.querySelectorAll('[data-agent-cook-event]')].map((item) => item.textContent).join('|'),
    };
  });
  const transaction = await page.evaluate(async (expectedRevision) => {
    const result = await globalThis.gfxAgent.applyTransaction({
      requestId: 'smoke_blur_radius_32',
      expectedRevision,
      commands: [{
        op: 'set_node_params',
        layerId: 'layer_1',
        nodeId: 'blur1',
        patch: { radius: 32 },
      }],
    });
    if (!result.ok) throw new Error(`blur transaction failed: ${JSON.stringify(result)}`);
    const rendered = await globalThis.gfxAgent.awaitRender({
      revision: result.revision,
    });
    return { result, rendered };
  }, before.revision);
  if (
    transaction.rendered.state !== 'complete'
    || transaction.rendered.renderRevision !== transaction.result.revision
  ) {
    throw new Error(`blur render did not complete exactly: ${JSON.stringify(transaction)}`);
  }
  await page.waitForFunction((previousLog) => {
    if (document.querySelector('[data-agent-render-error]')) return true;
    const currentLog = [...document.querySelectorAll('[data-agent-cook-event]')].map((item) => item.textContent).join('|');
    const miss = [...document.querySelectorAll('[data-agent-cook-event]')].some((item) =>
      item.dataset.agentNodeId === 'blur1'
        && item.dataset.agentCookStatus === 'miss');
    const status = document.querySelector('[data-agent-render-status]');
    return currentLog !== previousLog
      && miss
      && status instanceof HTMLElement
      && status.dataset.agentRenderState === 'complete'
      && status.dataset.agentDocumentRevision === status.dataset.agentRenderRevision;
  }, {}, before.log);
  const after = await page.evaluate(() => {
    const snapshot = globalThis.gfxAgent.getDocument({
      layerIds: ['layer_1'],
      include: ['nodes'],
    });
    const layer = snapshot.layers[0];
    const blur = layer.graph.nodes.find((node) => node.id === 'blur1');
    return {
      nodes: layer.graph.nodes.map((node) => node.id).sort(),
      radius: blur?.params.radius,
    };
  });
  if (JSON.stringify(after.nodes) !== JSON.stringify(before.nodes)) throw new Error('blur edit changed the node inventory');
  if (after.radius !== 32) throw new Error(`blur radius did not update: ${after.radius}`);
  const cookError = await page.$eval('[data-agent-render-error]', (element) => element.textContent).catch(() => null);
  if (cookError) throw new Error(`blur cook error: ${cookError}`);

  const screenshot = await smokeArtifactPath('blur-check.png');
  await writeFile(screenshot, Buffer.from(await captureExportPng(page), 'base64'));
  assertNoPageProblems(problems);
  console.log(`screenshot: ${screenshot}`);
  console.log('PASS: blur1 changed on layer_1 without creating phantom nodes');
});
