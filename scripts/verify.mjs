// Frame config gate: editing the frame in the sidebar re-cooks exactly the
// frame-aware nodes (Rasterize/Noise/Output) and their descendants — Text and
// vector ops stay cached — and the artboard canvas takes the new size.
// Usage: node scripts/verify.mjs [url]
import {
  assertNoPageProblems,
  navigateToApp,
  smokeArtifactPath,
  waitForInitialCook,
  withSmokePage,
} from './smoke/browser.mjs';

await withSmokePage({ storage: { mode: 'empty' } }, async ({ page, url, problems }) => {
  await navigateToApp(page, url);
  await waitForInitialCook(page, { width: 2480, height: 3508 });

  const readEvents = () =>
    page.$$eval('.cook-log li', (items) => items.map((item) => ({
      status: item.querySelector('.badge')?.textContent?.trim().toLowerCase(),
      type: item.querySelector('.ev-node')?.textContent?.trim(),
      nodeId: item.querySelector('.ev-id')?.textContent?.trim(),
      text: item.textContent.replace(/\s+/g, ' ').trim(),
    })));
  const canvasSize = () =>
    page.$eval('.viewport canvas:not(.guide-overlay)', (canvas) => `${canvas.width}x${canvas.height}`);

  console.log('--- cook 1 (factory document, 2480×3508 frame) ---');
  const initialEvents = await readEvents();
  for (const event of initialEvents) console.log(event.text);
  console.log('canvas:', await canvasSize());

  // Type a new frame width into the real sidebar control.
  await page.evaluate(() => {
    const input = document.querySelector('.frame-config input[type=number]');
    if (!(input instanceof HTMLInputElement)) throw new Error('frame width input not found');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('native input value setter unavailable');
    setter.call(input, '1024');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction((previousEvents) => {
    const canvas = document.querySelector('.viewport canvas:not(.guide-overlay)');
    const currentEvents = [...document.querySelectorAll('.cook-log li')].map((item) => ({
      status: item.querySelector('.badge')?.textContent?.trim().toLowerCase(),
      type: item.querySelector('.ev-node')?.textContent?.trim(),
      nodeId: item.querySelector('.ev-id')?.textContent?.trim(),
    }));
    return canvas instanceof HTMLCanvasElement
      && canvas.width === 1024
      && canvas.height === 3508
      && JSON.stringify(currentEvents) !== previousEvents
      && !document.querySelector('.cook-pending');
  }, {}, JSON.stringify(initialEvents.map(({ status, type, nodeId }) => ({ status, type, nodeId }))));
  const cookError = await page.$eval('.cook-error', (element) => element.textContent).catch(() => null);
  if (cookError) throw new Error(`cook error after frame edit: ${cookError}`);

  console.log('--- frame width 2480 -> 1024 via UI ---');
  const resizedEvents = await readEvents();
  for (const event of resizedEvents) console.log(event.text);
  const finalSize = await canvasSize();
  if (finalSize !== '1024x3508') throw new Error(`wrong canvas size after edit: ${finalSize}`);
  const statusFor = (type, nodeId) =>
    resizedEvents.find((event) => event.type === type && event.nodeId === nodeId)?.status;
  for (const [type, nodeId] of [
    ['Text', 'text1'],
    ['Outline', 'outline1'],
    ['Shape', 'shape_1'],
    ['Shape', 'shape_5'],
  ]) {
    const status = statusFor(type, nodeId);
    if (status !== 'hit') throw new Error(`expected frame-independent ${type} ${nodeId} HIT, got ${status}`);
  }
  for (const nodeId of ['raster1', 'rasterize_2', 'rasterize_6']) {
    const status = statusFor('Rasterize', nodeId);
    if (status !== 'miss') throw new Error(`expected frame-aware Rasterize ${nodeId} MISS, got ${status}`);
  }
  const outputs = resizedEvents.filter((event) => event.type === 'Output');
  if (outputs.length !== 4 || outputs.some((event) => event.status !== 'miss')) {
    throw new Error(`expected four frame-aware Output MISS events, got ${JSON.stringify(outputs)}`);
  }
  console.log('canvas:', finalSize);
  console.log('---', await page.$eval('.pool', (element) => element.textContent));

  const screenshot = await smokeArtifactPath('frame-resize.png');
  await page.screenshot({ path: screenshot });
  assertNoPageProblems(problems);
  console.log(`screenshot: ${screenshot}`);
  console.log('ALL CHECKS PASSED');
});
