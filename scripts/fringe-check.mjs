// Edge-fringe gate: render white text on a white background and scan the
// viewport for dark pixels. Soft glyph edges must stay white — any gray/black
// rim means transparent-black texels leaked into the composite (straight-alpha
// filtering or src-over onto a transparent ground without un-premultiplying).
// Usage: node scripts/fringe-check.mjs [url]
import { readFile, writeFile } from 'node:fs/promises';
import {
  assertDevHook,
  assertNoPageProblems,
  captureExportPng,
  navigateToApp,
  smokeArtifactPath,
  waitForInitialCook,
  withSmokePage,
} from './smoke/browser.mjs';

const graph = JSON.parse(
  await readFile(new URL('../test/fixtures/documents/legacy-single-graph.json', import.meta.url), 'utf8'),
);

await withSmokePage({ storage: { mode: 'legacy', graph } }, async ({ page, url, problems }) => {
  await navigateToApp(page, url);
  await assertDevHook(page);
  await waitForInitialCook(page, { width: 320, height: 240 });

  const before = await page.evaluate(() => {
    const app = globalThis.__app;
    app.getState().selectLayer('layer_1');
    const layer = app.getState().doc.layers.find((candidate) => candidate.id === 'layer_1');
    if (!layer?.graph.nodes.text || !layer.graph.nodes.out) throw new Error('legacy fringe nodes missing');
    return {
      nodes: Object.keys(layer.graph.nodes).sort(),
      log: [...document.querySelectorAll('.cook-log li')].map((item) => item.textContent).join('|'),
    };
  });
  await page.evaluate(() => globalThis.__app.getState().setParam('out', 'background', '#ffffff'));

  await page.waitForFunction((previousLog) => {
    const currentLog = [...document.querySelectorAll('.cook-log li')].map((item) => item.textContent).join('|');
    return currentLog !== previousLog && !document.querySelector('.cook-pending');
  }, {}, before.log);
  const renderedPng = await captureExportPng(page);
  const rendered = await page.evaluate(async (png) => {
    const app = globalThis.__app;
    const layer = app.getState().doc.layers.find((candidate) => candidate.id === 'layer_1');
    const response = await fetch(`data:image/png;base64,${png}`);
    const bitmap = await createImageBitmap(await response.blob());
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
      nodes: Object.keys(layer.graph.nodes).sort(),
      background: layer.graph.nodes.out.params.background,
      pixels: data.length / 4,
      dark,
      darkest,
    };
  }, renderedPng);
  if (JSON.stringify(rendered.nodes) !== JSON.stringify(before.nodes)) throw new Error('fringe edit changed node inventory');
  if (rendered.background !== '#ffffff') throw new Error(`background did not update: ${rendered.background}`);
  const cookError = await page.$eval('.cook-error', (element) => element.textContent).catch(() => null);
  if (cookError) throw new Error(`fringe cook error: ${cookError}`);

  const screenshot = await smokeArtifactPath('fringe-check.png');
  await writeFile(screenshot, Buffer.from(renderedPng, 'base64'));
  console.log(`screenshot: ${screenshot}`);
  console.log(`scanned ${rendered.pixels} px — ${rendered.dark} darker than 230, darkest channel ${rendered.darkest}`);
  if (rendered.dark !== 0) throw new Error('dark fringe present');
  assertNoPageProblems(problems);
  console.log('PASS: white-on-white stays white');
});
