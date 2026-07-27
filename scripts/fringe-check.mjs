// Edge-fringe gate: render white text on a white background and scan the
// viewport for dark pixels. Soft glyph edges must stay white — any gray/black
// rim means transparent-black texels leaked into the composite (straight-alpha
// filtering or src-over onto a transparent ground without un-premultiplying).
// Usage: node scripts/fringe-check.mjs [url]
import { readFile, writeFile } from 'node:fs/promises';
import {
  assertNoPageProblems,
  captureExportPng,
  navigateToApp,
  pairAgent,
  smokeArtifactPath,
  waitForInitialCook,
  withSmokePage,
} from './smoke/browser.mjs';

const graph = JSON.parse(
  await readFile(new URL('../test/fixtures/documents/legacy-single-graph.json', import.meta.url), 'utf8'),
);

await withSmokePage({ storage: { mode: 'legacy', graph } }, async ({ page, url, problems }) => {
  await navigateToApp(page, url);
  await waitForInitialCook(page, { width: 320, height: 240 });
  await pairAgent(page, { scopes: ['read', 'edit'] });

  const before = await page.evaluate(() => {
    const snapshot = globalThis.gfxAgent.getDocument({
      layerIds: ['layer_1'],
      include: ['nodes'],
    });
    const layer = snapshot.layers?.[0];
    const ids = layer?.graph.nodes.map((node) => node.id) ?? [];
    if (!ids.includes('text') || !ids.includes('out')) throw new Error('legacy fringe nodes missing');
    return {
      revision: snapshot.revision,
      nodes: ids.sort(),
      log: [...document.querySelectorAll('[data-agent-cook-event]')].map((item) => item.textContent).join('|'),
    };
  });
  const transaction = await page.evaluate(async (expectedRevision) => {
    const result = await globalThis.gfxAgent.applyTransaction({
      requestId: 'smoke_fringe_white_background',
      expectedRevision,
      commands: [{
        op: 'set_node_params',
        layerId: 'layer_1',
        nodeId: 'out',
        patch: { background: '#ffffff' },
      }],
    });
    if (!result.ok) throw new Error(`fringe transaction failed: ${JSON.stringify(result)}`);
    const rendered = await globalThis.gfxAgent.awaitRender({
      revision: result.revision,
    });
    return { result, rendered };
  }, before.revision);
  if (transaction.rendered.state !== 'complete') {
    throw new Error(`fringe render failed: ${JSON.stringify(transaction)}`);
  }

  await page.waitForFunction((previousLog) => {
    if (document.querySelector('[data-agent-render-error]')) return true;
    const currentLog = [...document.querySelectorAll('[data-agent-cook-event]')].map((item) => item.textContent).join('|');
    const status = document.querySelector('[data-agent-render-status]');
    return currentLog !== previousLog
      && status instanceof HTMLElement
      && status.dataset.agentRenderState === 'complete'
      && status.dataset.agentDocumentRevision === status.dataset.agentRenderRevision;
  }, {}, before.log);
  const renderedPng = await captureExportPng(page);
  const rendered = await page.evaluate(async (png) => {
    const documentSnapshot = globalThis.gfxAgent.getDocument({
      layerIds: ['layer_1'],
      include: ['nodes'],
    });
    const layer = documentSnapshot.layers[0];
    const out = layer.graph.nodes.find((node) => node.id === 'out');
    const binary = atob(png);
    const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: 'image/png' }),
    );
    const snapshot = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = snapshot.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let dark = 0;
    let darkest = 255;
    for (let offset = 0; offset < data.length; offset += 4) {
      const channel = Math.min(data[offset], data[offset + 1], data[offset + 2]);
      darkest = Math.min(darkest, channel);
      if (channel < 230) dark++;
    }
    return {
      nodes: layer.graph.nodes.map((node) => node.id).sort(),
      background: out?.params.background,
      pixels: data.length / 4,
      dark,
      darkest,
    };
  }, renderedPng);
  if (JSON.stringify(rendered.nodes) !== JSON.stringify(before.nodes)) throw new Error('fringe edit changed node inventory');
  if (rendered.background !== '#ffffff') throw new Error(`background did not update: ${rendered.background}`);
  const cookError = await page.$eval('[data-agent-render-error]', (element) => element.textContent).catch(() => null);
  if (cookError) throw new Error(`fringe cook error: ${cookError}`);

  const screenshot = await smokeArtifactPath('fringe-check.png');
  await writeFile(screenshot, Buffer.from(renderedPng, 'base64'));
  console.log(`screenshot: ${screenshot}`);
  console.log(`scanned ${rendered.pixels} px — ${rendered.dark} darker than 230, darkest channel ${rendered.darkest}`);
  if (rendered.dark !== 0) throw new Error('dark fringe present');
  assertNoPageProblems(problems);
  console.log('PASS: white-on-white stays white');
});
