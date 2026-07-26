// PR 0 WebGPU gate: seed a deterministic 256x192 saved document before the
// app loads, render it in an isolated browser context, check tolerant visual
// metrics, and compare it with the reviewed PNG fixture.
//
// Usage:
//   npm run smoke:serve
//   npm run smoke:baseline
// Update the reviewed PNG deliberately with UPDATE_SCREENSHOTS=1.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import {
  assertDevHook,
  assertNoPageProblems,
  captureExportPng,
  navigateToApp,
  smokeArtifactPath,
  waitForInitialCook,
  withSmokePage,
} from './smoke/browser.mjs';

const documentUrl = new URL('../test/fixtures/documents/visual-small-frame.json', import.meta.url);
const screenshotUrl = new URL('../test/fixtures/screenshots/visual-small-frame.png', import.meta.url);
const document = JSON.parse(await readFile(documentUrl, 'utf8'));

await withSmokePage(
  {
    viewport: { width: 1024, height: 768, deviceScaleFactor: 1 },
    storage: { mode: 'v2', document },
  },
  async ({ page, url, problems, version, executablePath }) => {
    console.log(`Chrome: ${version} (${executablePath})`);
    await navigateToApp(page, url);
    await assertDevHook(page);
    await waitForInitialCook(page, { width: 256, height: 192 });

    // Capture the native rendered pixels through the existing PNG export
    // readback. WebGPU swapchain canvases are not guaranteed to support
    // toDataURL/drawImage or compositor screenshots in headless Chrome.
    const renderedPng = await captureExportPng(page);
    const rendered = await page.evaluate(async (png) => {
      const canvases = document.querySelectorAll(
        '.viewport canvas:not(.guide-overlay):not([hidden])',
      );
      if (canvases.length !== 1) throw new Error(`expected one main canvas, found ${canvases.length}`);
      const response = await fetch(`data:image/png;base64,${png}`);
      const bitmap = await createImageBitmap(await response.blob());
      const snapshot = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = snapshot.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D screenshot context unavailable');
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const background = [0x10, 0x20, 0x30];
      let changed = 0;
      let minX = bitmap.width;
      let minY = bitmap.height;
      let maxX = -1;
      let maxY = -1;
      let opaque = 0;
      for (let y = 0; y < bitmap.height; y++) {
        for (let x = 0; x < bitmap.width; x++) {
          const offset = (y * bitmap.width + x) * 4;
          const different = Math.max(
            Math.abs(pixels[offset] - background[0]),
            Math.abs(pixels[offset + 1] - background[1]),
            Math.abs(pixels[offset + 2] - background[2]),
          ) > 4;
          if (pixels[offset + 3] === 255) opaque++;
          if (!different) continue;
          changed++;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      const pixel = (x, y) => {
        const offset = (y * bitmap.width + x) * 4;
        return Array.from(pixels.slice(offset, offset + 4));
      };
      return {
        width: bitmap.width,
        height: bitmap.height,
        center: pixel(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2)),
        corner: pixel(0, 0),
        alphaCoverage: opaque / (bitmap.width * bitmap.height),
        nonBackgroundBounds: changed === 0
          ? null
          : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      };
    }, renderedPng);

    if (rendered.width !== 256 || rendered.height !== 192) {
      throw new Error(`wrong preview size: ${rendered.width}x${rendered.height}`);
    }
    if (rendered.alphaCoverage !== 1) {
      throw new Error(`expected opaque preview, alpha coverage=${rendered.alphaCoverage}`);
    }
    const channelDelta = (actual, expected) => Math.max(...actual.map((value, index) => Math.abs(value - expected[index])));
    if (channelDelta(rendered.corner, [0x10, 0x20, 0x30, 0xff]) > 2) {
      throw new Error(`unexpected corner color: ${rendered.corner.join(',')}`);
    }
    if (channelDelta(rendered.center, [0xff, 0x14, 0x93, 0xff]) > 2) {
      throw new Error(`unexpected center color: ${rendered.center.join(',')}`);
    }
    const bounds = rendered.nonBackgroundBounds;
    if (
      !bounds
      || Math.abs(bounds.x - 80) > 1
      || Math.abs(bounds.y - 64) > 1
      || Math.abs(bounds.width - 96) > 2
      || Math.abs(bounds.height - 64) > 2
    ) {
      throw new Error(`unexpected non-background bounds: ${JSON.stringify(bounds)}`);
    }

    const actualPng = Buffer.from(renderedPng, 'base64');
    const artifact = await smokeArtifactPath('visual-small-frame.actual.png');
    await writeFile(artifact, actualPng);
    assertNoPageProblems(problems);

    if (process.env.UPDATE_SCREENSHOTS === '1') {
      await mkdir(new URL('../test/fixtures/screenshots/', import.meta.url), { recursive: true });
      await writeFile(screenshotUrl, actualPng);
      console.log(`updated reviewed screenshot: ${screenshotUrl.pathname}`);
    } else {
      const expectedPng = await readFile(screenshotUrl);
      const comparison = await page.evaluate(async ({ actual, expected }) => {
        const decode = async (base64) => {
          const response = await fetch(`data:image/png;base64,${base64}`);
          const bitmap = await createImageBitmap(await response.blob());
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext('2d', { willReadFrequently: true });
          context.drawImage(bitmap, 0, 0);
          return { width: bitmap.width, height: bitmap.height, pixels: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
        };
        const a = await decode(actual);
        const b = await decode(expected);
        if (a.width !== b.width || a.height !== b.height) {
          return { sameSize: false, changedPixels: a.width * a.height, maxDelta: 255 };
        }
        let changedPixels = 0;
        let maxDelta = 0;
        for (let offset = 0; offset < a.pixels.length; offset += 4) {
          let pixelDelta = 0;
          for (let channel = 0; channel < 4; channel++) {
            pixelDelta = Math.max(pixelDelta, Math.abs(a.pixels[offset + channel] - b.pixels[offset + channel]));
          }
          maxDelta = Math.max(maxDelta, pixelDelta);
          if (pixelDelta > 2) changedPixels++;
        }
        return { sameSize: true, changedPixels, maxDelta };
      }, { actual: renderedPng, expected: expectedPng.toString('base64') });
      const changedFraction = comparison.changedPixels / (rendered.width * rendered.height);
      if (!comparison.sameSize || changedFraction > 0.002) {
        throw new Error(
          `visual baseline drift: maxDelta=${comparison.maxDelta}, changed=${comparison.changedPixels} `
            + `(${(changedFraction * 100).toFixed(3)}%); actual=${artifact}`,
        );
      }
      console.log(
        `visual diff: maxDelta=${comparison.maxDelta}, changed=${comparison.changedPixels} `
          + `(${(changedFraction * 100).toFixed(3)}%)`,
      );
    }

    console.log(`metrics: ${JSON.stringify({
      center: rendered.center,
      corner: rendered.corner,
      alphaCoverage: rendered.alphaCoverage,
      nonBackgroundBounds: rendered.nonBackgroundBounds,
    })}`);
    console.log(`actual screenshot: ${artifact}`);
    console.log('ALL CHECKS PASSED');
  },
);
