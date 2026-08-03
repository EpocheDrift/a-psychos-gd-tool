// Product UX gate for the shared human-and-Agent workbench. Automation keeps a
// deterministic test viewport, then changes its CSS viewport to prove the app
// itself responds without changing the exact rendered document artifact.
import { readFile } from 'node:fs/promises';
import axe from 'axe-core';
import {
  assertNoPageProblems,
  captureExportPng,
  navigateToApp,
  smokeArtifactPath,
  waitForInitialCook,
  withSmokePage,
} from './smoke/browser.mjs';

const fixture = JSON.parse(await readFile(
  new URL('../test/fixtures/documents/visual-small-frame.json', import.meta.url),
  'utf8',
));

async function settleLayout(page) {
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function assertAccessibility(page, label) {
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(document, {
      resultTypes: ['violations'],
    });
    return result.violations
      .filter((violation) =>
        violation.impact === 'serious' || violation.impact === 'critical')
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        targets: violation.nodes.map((node) => node.target),
      }));
  });
  if (violations.length > 0) {
    throw new Error(
      `${label} accessibility audit failed: ${JSON.stringify(violations)}`,
    );
  }
}

async function layoutSnapshot(page) {
  return page.evaluate(() => {
    const bounds = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing workbench element: ${selector}`);
      }
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const canvas = document.querySelector('[data-agent-preview="main"]');
    const separator = document.querySelector('[data-workbench-splitter]');
    const workbench = document.querySelector('[data-workbench-layout]');
    const frameControls = document.querySelector('.frame-config');
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('The exact preview canvas is unavailable.');
    }
    if (!(separator instanceof HTMLElement)) {
      throw new Error('The workbench separator is unavailable.');
    }
    if (!(workbench instanceof HTMLElement)) {
      throw new Error('The workbench container is unavailable.');
    }
    if (!(frameControls instanceof HTMLElement)) {
      throw new Error('The frame controls are unavailable.');
    }
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      workbench: {
        ...bounds('[data-workbench-layout]'),
        clientHeight: workbench.clientHeight,
        scrollHeight: workbench.scrollHeight,
        scrollTop: workbench.scrollTop,
      },
      editor: bounds('#workbench-node-editor'),
      flow: bounds('[data-agent-node-editor]'),
      preview: bounds('#workbench-poster-preview'),
      stage: bounds('[data-agent-stage]'),
      canvas: {
        ...bounds('[data-agent-preview="main"]'),
        intrinsicWidth: canvas.width,
        intrinsicHeight: canvas.height,
      },
      separator: {
        ...bounds('[data-workbench-splitter]'),
        orientation: separator.getAttribute('aria-orientation'),
        value: Number(separator.getAttribute('aria-valuenow')),
        minimum: Number(separator.getAttribute('aria-valuemin')),
        maximum: Number(separator.getAttribute('aria-valuemax')),
        controls: separator.getAttribute('aria-controls'),
      },
      frameControlsOverflow:
        frameControls.scrollWidth - frameControls.clientWidth,
      pageOverflow:
        document.documentElement.scrollWidth
        - document.documentElement.clientWidth,
      revision: Number(
        document.querySelector('[data-agent-render-status]')
          ?.getAttribute('data-agent-document-revision'),
      ),
      title: document.title,
    };
  });
}

function assertCanvasContained(snapshot, label) {
  const tolerance = 2;
  const { canvas, stage } = snapshot;
  if (
    canvas.width <= 0
    || canvas.height <= 0
    || canvas.left < stage.left - tolerance
    || canvas.top < stage.top - tolerance
    || canvas.right > stage.right + tolerance
    || canvas.bottom > stage.bottom + tolerance
  ) {
    throw new Error(`${label} canvas escaped stage: ${JSON.stringify(snapshot)}`);
  }
  const displayedRatio = canvas.width / canvas.height;
  const intrinsicRatio = canvas.intrinsicWidth / canvas.intrinsicHeight;
  if (Math.abs(displayedRatio - intrinsicRatio) > 0.02) {
    throw new Error(
      `${label} changed artboard ratio: ${displayedRatio} vs ${intrinsicRatio}`,
    );
  }
}

function assertCommonLayout(snapshot, label) {
  if (
    snapshot.editor.width <= 0
    || snapshot.editor.height <= 0
    || snapshot.preview.width <= 0
    || snapshot.preview.height <= 0
    || snapshot.flow.width <= 0
    || snapshot.flow.height <= 0
    || snapshot.stage.width <= 0
    || snapshot.stage.height <= 0
  ) {
    throw new Error(`${label} contains a collapsed pane: ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.pageOverflow > 1 || snapshot.frameControlsOverflow > 1) {
    throw new Error(`${label} has horizontal overflow: ${JSON.stringify(snapshot)}`);
  }
  if (
    snapshot.separator.minimum > snapshot.separator.value
    || snapshot.separator.maximum < snapshot.separator.value
    || snapshot.separator.controls
      !== 'workbench-node-editor workbench-poster-preview'
  ) {
    throw new Error(`${label} separator semantics drifted: ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.title !== 'Graphic Design Workbench — Agent + Human') {
    throw new Error(`${label} workbench title is not discoverable: ${snapshot.title}`);
  }
  assertCanvasContained(snapshot, label);
}

async function resizeWithPointer(page, horizontalDelta, verticalDelta = 0) {
  const separator = await page.$('[data-workbench-splitter]');
  const box = await separator?.boundingBox();
  if (!box) throw new Error('Workbench separator has no pointer target.');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(
    startX + horizontalDelta,
    startY + verticalDelta,
    { steps: 8 },
  );
  await page.mouse.up();
  await settleLayout(page);
}

async function productLayoutGate() {
  await withSmokePage(
    {
      viewport: { width: 1480, height: 920, deviceScaleFactor: 1 },
      storage: { mode: 'v2', document: fixture },
    },
    async ({ page, url, problems }) => {
      await navigateToApp(page, url);
      await waitForInitialCook(page, { width: 256, height: 192 });
      const originalPng = await captureExportPng(page);
      const wide = await layoutSnapshot(page);
      assertCommonLayout(wide, 'wide');
      await assertAccessibility(page, 'wide');
      if (
        wide.separator.orientation !== 'vertical'
        || wide.editor.right > wide.preview.left
      ) {
        throw new Error(`Wide workbench did not use side-by-side panes: ${JSON.stringify(wide)}`);
      }

      await page.screenshot({
        path: await smokeArtifactPath('workbench-wide.png'),
        fullPage: false,
      });

      await resizeWithPointer(page, 120);
      const pointerResized = await layoutSnapshot(page);
      assertCommonLayout(pointerResized, 'pointer-resized');
      if (
        pointerResized.editor.width - wide.editor.width < 60
        || wide.preview.width - pointerResized.preview.width < 60
        || pointerResized.flow.width - wide.flow.width < 60
      ) {
        throw new Error(
          `Pointer resize did not move both panes: ${JSON.stringify({ wide, pointerResized })}`,
        );
      }

      await page.focus('[data-workbench-splitter]');
      const beforeKeyboard = pointerResized.separator.value;
      await page.keyboard.press('ArrowRight');
      await settleLayout(page);
      const keyboardResized = await layoutSnapshot(page);
      if (keyboardResized.separator.value <= beforeKeyboard) {
        throw new Error(`Keyboard resize did not advance: ${JSON.stringify(keyboardResized)}`);
      }

      const savedValue = keyboardResized.separator.value;
      await page.waitForFunction((expected) =>
        Math.abs(Number(localStorage.getItem('gfx.workbench.split.v1')) - expected)
          <= 1, {}, savedValue);
      let expectedPreference = await page.evaluate(() =>
        Number(localStorage.getItem('gfx.workbench.split.v1')));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForInitialCook(page, { width: 256, height: 192 });
      await settleLayout(page);
      const reloaded = await layoutSnapshot(page);
      if (Math.abs(reloaded.separator.value - savedValue) > 1) {
        throw new Error(
          `Workbench split did not survive reload: ${savedValue} -> ${reloaded.separator.value}`,
        );
      }

      await page.setViewport({ width: 720, height: 900, deviceScaleFactor: 1 });
      await page.waitForFunction(() =>
        document.querySelector('[data-workbench-splitter]')
          ?.getAttribute('aria-orientation') === 'horizontal');
      await settleLayout(page);
      const narrow = await layoutSnapshot(page);
      assertCommonLayout(narrow, 'narrow');
      await assertAccessibility(page, 'narrow');
      if (
        narrow.separator.orientation !== 'horizontal'
        || narrow.editor.bottom > narrow.preview.top
      ) {
        throw new Error(`Narrow workbench did not stack panes: ${JSON.stringify(narrow)}`);
      }

      await page.focus('[data-workbench-splitter]');
      const beforeNarrowKeyboard = narrow.separator.value;
      await page.keyboard.press('ArrowUp');
      await settleLayout(page);
      const narrowKeyboard = await layoutSnapshot(page);
      if (narrowKeyboard.separator.value >= beforeNarrowKeyboard) {
        throw new Error(
          `Stacked keyboard resize did not move upward: ${JSON.stringify(narrowKeyboard)}`,
        );
      }
      await page.waitForFunction((expected) =>
        Math.abs(Number(localStorage.getItem('gfx.workbench.split.v1')) - expected)
          <= 1, {}, narrowKeyboard.separator.value);
      expectedPreference = await page.evaluate(() =>
        Number(localStorage.getItem('gfx.workbench.split.v1')));

      await page.screenshot({
        path: await smokeArtifactPath('workbench-narrow.png'),
        fullPage: false,
      });

      // A 1480×920 window at roughly 200% browser zoom exposes about this many
      // CSS pixels. Exercise the equivalent layout pressure without relying on
      // Chrome UI keyboard shortcuts in headless automation.
      await page.setViewport({ width: 740, height: 460, deviceScaleFactor: 1 });
      await settleLayout(page);
      const zoomPressure = await layoutSnapshot(page);
      assertCommonLayout(zoomPressure, 'zoom-pressure');
      if (zoomPressure.separator.orientation !== 'horizontal') {
        throw new Error(
          `Zoom-pressure workbench did not remain stacked: ${JSON.stringify(zoomPressure)}`,
        );
      }
      await page.screenshot({
        path: await smokeArtifactPath('workbench-zoom-pressure.png'),
        fullPage: false,
      });

      const pressurePreference = await page.evaluate(() =>
        Number(localStorage.getItem('gfx.workbench.split.v1')));
      if (
        Math.abs(pressurePreference - expectedPreference) > 0.01
        || zoomPressure.separator.value >= expectedPreference - 5
      ) {
        throw new Error(
          `Window clamping overwrote the saved split preference: ${JSON.stringify({
            expectedPreference,
            pressurePreference,
            effectiveValue: zoomPressure.separator.value,
          })}`,
        );
      }

      // At still higher zoom pressure the pane minima cannot both fit. The
      // workbench itself must become the accessible vertical scroll path.
      await page.setViewport({ width: 740, height: 300, deviceScaleFactor: 1 });
      await settleLayout(page);
      const extremePressure = await layoutSnapshot(page);
      assertCommonLayout(extremePressure, 'extreme-zoom-pressure');
      if (
        extremePressure.separator.orientation !== 'horizontal'
        || extremePressure.workbench.scrollHeight
          <= extremePressure.workbench.clientHeight + 1
      ) {
        throw new Error(
          `Extreme zoom pressure has no workbench scroll path: ${JSON.stringify(extremePressure)}`,
        );
      }
      await page.evaluate(() => {
        const workbench = document.querySelector('[data-workbench-layout]');
        if (workbench instanceof HTMLElement) {
          workbench.scrollTop = workbench.scrollHeight;
        }
      });
      await settleLayout(page);
      const scrolledPressure = await layoutSnapshot(page);
      if (
        scrolledPressure.workbench.scrollTop <= 0
        || scrolledPressure.preview.bottom
          > scrolledPressure.workbench.bottom + 2
      ) {
        throw new Error(
          `Extreme zoom pressure cannot reveal the preview: ${JSON.stringify(scrolledPressure)}`,
        );
      }

      await resizeWithPointer(page, 0, 12);
      const scrolledPointerResize = await layoutSnapshot(page);
      const scrolledPointerDelta = scrolledPointerResize.separator.value
        - scrolledPressure.separator.value;
      if (scrolledPointerDelta < 2 || scrolledPointerDelta > 8) {
        throw new Error(
          `Scrolled separator jumped instead of following pointer delta: ${JSON.stringify({
            before: scrolledPressure,
            after: scrolledPointerResize,
          })}`,
        );
      }
      await page.waitForFunction((expected) =>
        Math.abs(Number(localStorage.getItem('gfx.workbench.split.v1')) - expected)
          <= 1, {}, scrolledPointerResize.separator.value);
      expectedPreference = await page.evaluate(() =>
        Number(localStorage.getItem('gfx.workbench.split.v1')));

      await page.setViewport({ width: 1480, height: 920, deviceScaleFactor: 1 });
      await page.waitForFunction(() =>
        document.querySelector('[data-workbench-splitter]')
          ?.getAttribute('aria-orientation') === 'vertical');
      await settleLayout(page);
      const restoredWide = await layoutSnapshot(page);
      assertCommonLayout(restoredWide, 'restored-wide');
      if (
        Math.abs(restoredWide.separator.value - expectedPreference) > 1
        || restoredWide.workbench.scrollTop !== 0
      ) {
        throw new Error(
          `Wide layout did not restore the saved split: ${JSON.stringify({
            expectedPreference,
            restoredWide,
          })}`,
        );
      }

      const finalPng = await captureExportPng(page);
      if (
        restoredWide.revision !== wide.revision
        || restoredWide.canvas.intrinsicWidth !== wide.canvas.intrinsicWidth
        || restoredWide.canvas.intrinsicHeight !== wide.canvas.intrinsicHeight
        || finalPng !== originalPng
      ) {
        throw new Error('Workbench resize changed the exact document artifact.');
      }
      assertNoPageProblems(problems);
    },
  );
}

async function highDprGate() {
  await withSmokePage(
    {
      viewport: { width: 740, height: 460, deviceScaleFactor: 2 },
      storage: { mode: 'v2', document: fixture },
    },
    async ({ page, url, problems }) => {
      await navigateToApp(page, url);
      await waitForInitialCook(page, { width: 256, height: 192 });
      const snapshot = await layoutSnapshot(page);
      assertCommonLayout(snapshot, 'high-dpr');
      await assertAccessibility(page, 'high-dpr');
      if (
        snapshot.viewport.dpr !== 2
        || snapshot.separator.orientation !== 'horizontal'
      ) {
        throw new Error(`High-DPR workbench ran at ${snapshot.viewport.dpr}.`);
      }
      assertNoPageProblems(problems);
    },
  );
}

await productLayoutGate();
await highDprGate();
console.log('WORKBENCH LAYOUT CHECK PASSED');
