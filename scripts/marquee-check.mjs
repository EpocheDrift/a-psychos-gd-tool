// Canvas interaction gate: two-finger scroll pans and pinch zooms; space+drag
// pans; left-drag draws a marquee that selects the boxed nodes; Shift-click
// adds an unselected node without losing the group. The selected group moves
// as one undo step and deletes together. Undo restores both.
// Usage: node scripts/marquee-check.mjs [url]
import process from 'node:process';
import {
  assertNoPageProblems,
  navigateToApp,
  pairAgent,
  smokeArtifactPath,
  waitForInitialCook,
  withSmokePage,
} from './smoke/browser.mjs';

await withSmokePage({ storage: { mode: 'empty' } }, async ({ page, url, problems }) => {
  await navigateToApp(page, url);
  await waitForInitialCook(page, { width: 2480, height: 3508 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const multiSelectModifier = 'Shift';
  const undoModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

  const state = () =>
    page.evaluate(() => {
      const visibleNodes = [
        ...document.querySelectorAll('[data-agent-target="node"]'),
      ];
      const layerId = visibleNodes[0]?.getAttribute('data-agent-layer-id');
      if (!layerId) throw new Error('active semantic layer unavailable');
      const snapshot = globalThis.gfxAgent.getDocument({
        layerIds: [layerId],
        include: ['nodes', 'positions'],
      });
      const layer = snapshot.layers?.[0];
      if (!layer) throw new Error(`active layer ${layerId} unavailable`);
      return {
        selected: visibleNodes
          .filter((node) => node.classList.contains('selected'))
          .map((node) => node.getAttribute('data-agent-node-id'))
          .filter(Boolean)
          .sort(),
        positions: Object.fromEntries(
          layer.graph.nodes.map((node) => [node.id, node.position]),
        ),
      };
    });

  // the canvas camera — pan moves the translate, pinch changes the scale
  const viewport = () =>
    page.$eval('.react-flow__viewport', (el) => {
      const m = el.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/);
      return { x: +m[1], y: +m[2], zoom: +m[3] };
    });

  const nodeRects = () =>
    page.$$eval('.react-flow__node', (els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + 8)?.closest('.react-flow__node');
        return {
          id: el.getAttribute('data-id'),
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          clickable: hit?.getAttribute('data-id') === el.getAttribute('data-id'),
        };
      }),
    );

  const drag = async (x1, y1, x2, y2) => {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x1 + ((x2 - x1) * i) / 8, y1 + ((y2 - y1) * i) / 8);
    await page.mouse.up();
  };

  // pane center, clear of the palette and the poster viewport
  const PANE = { x: 560, y: 700 };

  // --- 1. two-finger scroll pans (no zoom change) ---
  let v0 = await viewport();
  await page.mouse.move(PANE.x, PANE.y);
  await page.mouse.wheel({ deltaX: -40, deltaY: -60 });
  await sleep(200);
  let v1 = await viewport();
  console.log('--- scroll pan ---');
  console.log(`camera (${v0.x}, ${v0.y}) -> (${v1.x}, ${v1.y}), zoom ${v0.zoom} -> ${v1.zoom}`);
  if (v1.x === v0.x && v1.y === v0.y) throw new Error('scroll did not pan');
  if (v1.zoom !== v0.zoom) throw new Error('plain scroll must pan, not zoom');

  // --- 2. pinch zooms (macOS trackpad pinch arrives as a ctrlKey wheel) ---
  v0 = v1;
  await page.evaluate(({ x, y }) => {
    document
      .querySelector('.react-flow__pane')
      .dispatchEvent(new WheelEvent('wheel', { deltaY: -80, ctrlKey: true, bubbles: true, cancelable: true, clientX: x, clientY: y }));
  }, PANE);
  await sleep(200);
  v1 = await viewport();
  console.log('--- pinch zoom ---');
  console.log(`zoom ${v0.zoom} -> ${v1.zoom}`);
  if (v1.zoom <= v0.zoom) throw new Error('pinch (ctrl+wheel) did not zoom in');

  // --- 3. space + drag pans ---
  v0 = v1;
  await page.keyboard.down('Space');
  await drag(PANE.x, PANE.y, PANE.x + 70, PANE.y - 50);
  await page.keyboard.up('Space');
  await sleep(200);
  v1 = await viewport();
  console.log('--- space+drag pan ---');
  console.log(`camera (${v0.x}, ${v0.y}) -> (${v1.x}, ${v1.y})`);
  if (v1.x === v0.x && v1.y === v0.y) throw new Error('space+drag did not pan');

  // --- 4. plain left-drag draws the marquee over two on-screen nodes ---
  // reload to refit the view — the pinch above zoomed way in
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.react-flow__node', { timeout: 15000 });
  await sleep(300);
  await pairAgent(page, { scopes: ['read'] });
  const visible = (r) => r.x > 260 && r.y > 60 && r.x + r.w < 1100 && r.y + r.h < 900;
  const rects = (await nodeRects()).filter(visible);
  if (rects.length < 3) throw new Error(`need 3+ fully visible nodes clear of the palette, got ${rects.length}`);
  const [a, b] = rects;
  const x1 = Math.min(a.x, b.x) - 12, y1 = Math.min(a.y, b.y) - 12;
  const x2 = Math.max(a.x + a.w, b.x + b.w) + 12, y2 = Math.max(a.y + a.h, b.y + b.h) + 12;
  await drag(x1, y1, x2, y2);
  await sleep(200);

  let s = await state();
  console.log('--- marquee over', a.id, '+', b.id, '---');
  console.log('selected:', s.selected.join(', '));
  if (![a.id, b.id].every((id) => s.selected.includes(id))) throw new Error('marquee did not select the boxed nodes');

  // --- 5. Shift-click adds one unobscured node on every platform ---
  const marqueeSelection = [...s.selected];
  const addRect = (await nodeRects()).find(
    (rect) => rect.clickable && !marqueeSelection.includes(rect.id),
  );
  if (!addRect) throw new Error('need one unobscured node outside the marquee selection');
  const shiftClick = async (nodeId) => {
    const rect = await page.$eval(
      `.react-flow__node[data-id="${nodeId}"]`,
      (element) => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, w: bounds.width };
      },
    );
    await page.keyboard.down(multiSelectModifier);
    await sleep(50); // React Flow mirrors the held key into store state in an effect.
    await page.mouse.click(rect.x + rect.w / 2, rect.y + 8); // title bar, clear of param inputs
    await page.keyboard.up(multiSelectModifier);
    await sleep(200);
  };
  await shiftClick(addRect.id);
  s = await state();
  console.log('--- Shift-click adds', addRect.id, '---');
  console.log('selected:', s.selected.join(', '));
  const group = [...marqueeSelection, addRect.id].sort();
  if (
    s.selected.length !== group.length
    || !group.every((id) => s.selected.includes(id))
  ) {
    throw new Error('Shift-click did not add exactly one node without losing the group');
  }

  // --- 6. drag one selected node: the group moves together, one undo step ---
  const before = s;
  const groupAnchor = (await nodeRects()).find(
    (rect) => rect.clickable && group.includes(rect.id),
  );
  if (!groupAnchor) throw new Error('selected group has no unobscured title bar before group drag');
  await drag(
    groupAnchor.x + groupAnchor.w / 2,
    groupAnchor.y + 10,
    groupAnchor.x + groupAnchor.w / 2 + 80,
    groupAnchor.y + 70,
  );
  await sleep(200);
  s = await state();
  const movedIds = group.filter(
    (id) => s.positions[id].x !== before.positions[id].x || s.positions[id].y !== before.positions[id].y,
  );
  console.log('--- group drag ---');
  console.log('moved:', movedIds.join(', '));
  if (movedIds.length !== group.length) throw new Error('group drag did not move every selected node');

  await page.keyboard.down(undoModifier);
  await page.keyboard.press('z');
  await page.keyboard.up(undoModifier);
  await sleep(200);
  s = await state();
  const restored = group.every(
    (id) => s.positions[id].x === before.positions[id].x && s.positions[id].y === before.positions[id].y,
  );
  console.log('undo restored all positions:', restored);
  if (!restored) throw new Error('undo did not restore the whole group');

  // --- 7. batch delete + undo ---
  s = await state();
  const countBefore = Object.keys(s.positions).length;
  await page.keyboard.press('Backspace');
  await sleep(200);
  s = await state();
  console.log('--- batch delete ---');
  console.log('nodes:', countBefore, '->', Object.keys(s.positions).length, '| selected now:', s.selected.length);
  if (Object.keys(s.positions).length !== countBefore - group.length) throw new Error('delete did not remove the selected group');
  if (s.selected.length !== 0) throw new Error('selection should clear after delete');

  await page.keyboard.down(undoModifier);
  await page.keyboard.press('z');
  await page.keyboard.up(undoModifier);
  await sleep(200);
  s = await state();
  console.log('undo restored nodes:', Object.keys(s.positions).length === countBefore);
  if (Object.keys(s.positions).length !== countBefore) throw new Error('undo did not restore deleted nodes');

  const screenshot = await smokeArtifactPath('marquee.png');
  await page.screenshot({ path: screenshot });
  assertNoPageProblems(problems);
  console.log(`screenshot: ${screenshot}`);
  console.log('ALL CHECKS PASSED');
});
