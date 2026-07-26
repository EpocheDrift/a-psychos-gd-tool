// Blur gate: cook the factory graph (Text -> Outline -> Rasterize -> Blur ->
// Output) at a heavy radius and capture the native poster PNG. Eyeball the halo:
// it should fade to paper with no dark rim and no hard cutoff.
// Usage: node scripts/blur-check.mjs [url]
import { writeFile } from 'node:fs/promises';
import {
  assertDevHook,
  assertNoPageProblems,
  captureExportPng,
  navigateToApp,
  smokeArtifactPath,
  waitForInitialCook,
  withSmokePage,
} from './smoke/browser.mjs';

await withSmokePage({ storage: { mode: 'empty' } }, async ({ page, url, problems }) => {
  await navigateToApp(page, url);
  await assertDevHook(page);
  await waitForInitialCook(page, { width: 2480, height: 3508 });

  const before = await page.evaluate(() => {
    const app = globalThis.__app;
    app.getState().selectLayer('layer_1');
    const layer = app.getState().doc.layers.find((candidate) => candidate.id === 'layer_1');
    if (!layer?.graph.nodes.blur1) throw new Error('factory layer_1 blur1 node missing');
    return {
      nodes: Object.keys(layer.graph.nodes).sort(),
      log: [...document.querySelectorAll('.cook-log li')].map((item) => item.textContent).join('|'),
    };
  });
  await page.evaluate(() => globalThis.__app.getState().setParam('blur1', 'radius', 32));
  await page.waitForFunction((previousLog) => {
    const currentLog = [...document.querySelectorAll('.cook-log li')].map((item) => item.textContent).join('|');
    const miss = [...document.querySelectorAll('.cook-log li')].some((item) =>
      item.querySelector('.ev-id')?.textContent === 'blur1'
        && item.querySelector('.badge')?.textContent === 'MISS');
    return currentLog !== previousLog && miss && !document.querySelector('.cook-pending');
  }, {}, before.log);
  const after = await page.evaluate(() => {
    const layer = globalThis.__app.getState().doc.layers.find((candidate) => candidate.id === 'layer_1');
    return {
      nodes: Object.keys(layer.graph.nodes).sort(),
      radius: layer.graph.nodes.blur1.params.radius,
    };
  });
  if (JSON.stringify(after.nodes) !== JSON.stringify(before.nodes)) throw new Error('blur edit changed the node inventory');
  if (after.radius !== 32) throw new Error(`blur radius did not update: ${after.radius}`);
  const cookError = await page.$eval('.cook-error', (element) => element.textContent).catch(() => null);
  if (cookError) throw new Error(`blur cook error: ${cookError}`);

  const screenshot = await smokeArtifactPath('blur-check.png');
  await writeFile(screenshot, Buffer.from(await captureExportPng(page), 'base64'));
  assertNoPageProblems(problems);
  console.log(`screenshot: ${screenshot}`);
  console.log('PASS: blur1 changed on layer_1 without creating phantom nodes');
});
