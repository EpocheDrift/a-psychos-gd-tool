// PR4 semantic GUI gate. All document mutations use application-owned DOM
// contracts and keyboard/HTML controls; the only JavaScript hook is the
// read-only exact preview evidence boundary.
import { readFile } from 'node:fs/promises';
import axe from 'axe-core';
import {
  assertNoPageProblems,
  navigateToApp,
  withSmokePage,
} from './smoke/browser.mjs';

const fixture = JSON.parse(await readFile(
  new URL('../test/fixtures/documents/agent-semantic-blank.json', import.meta.url),
  'utf8',
));
const TERMINAL = new Set(['complete', 'failed', 'superseded']);
const SELECT_ALL_MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';
const ROUND_COUNT = Number(process.env.AGENT_UI_ROUNDS ?? 50);
if (!Number.isSafeInteger(ROUND_COUNT) || ROUND_COUNT <= 0 || ROUND_COUNT > 50) {
  throw new Error('AGENT_UI_ROUNDS must be an integer from 1 through 50.');
}

async function focusAndPress(page, selector, key = 'Enter') {
  const element = await page.$(selector);
  if (!element) throw new Error(`Semantic control not found: ${selector}`);
  await element.focus();
  await page.keyboard.press(key);
}

async function focusAndSelectAll(page, selector) {
  const element = await page.$(selector);
  if (!element) throw new Error(`Semantic control not found: ${selector}`);
  await element.focus();
  await page.keyboard.down(SELECT_ALL_MODIFIER);
  await page.keyboard.press('a');
  await page.keyboard.up(SELECT_ALL_MODIFIER);
}

async function renderSnapshot(page) {
  return page.$eval('[data-agent-render-status]', (element) => ({
    state: element.dataset.agentRenderState,
    documentRevision: Number(element.dataset.agentDocumentRevision),
    renderRevision: Number(element.dataset.agentRenderRevision),
    attempt: Number(element.dataset.agentRenderAttempt),
    displayedRevision: Number(element.dataset.agentDisplayedRevision),
    displayedAttempt: Number(element.dataset.agentDisplayedAttempt),
  }));
}

async function waitForTerminal(page, afterRevision = -1) {
  await page.waitForFunction(
    ({ prior, terminal }) => {
      const status = document.querySelector('[data-agent-render-status]');
      if (!(status instanceof HTMLElement)) return false;
      const state = status.dataset.agentRenderState ?? '';
      const documentRevision = Number(status.dataset.agentDocumentRevision);
      const renderRevision = Number(status.dataset.agentRenderRevision);
      const displayedRevision = Number(status.dataset.agentDisplayedRevision);
      if (
        !terminal.includes(state)
        || !Number.isSafeInteger(documentRevision)
        || documentRevision <= prior
      ) return false;
      if (state !== 'complete') return true;
      const preview = document.querySelector('[data-agent-preview="main"]');
      return preview instanceof HTMLCanvasElement
        && renderRevision === documentRevision
        && displayedRevision === documentRevision
        && Number(preview.dataset.agentRenderRevision) === documentRevision;
    },
    {},
    { prior: afterRevision, terminal: [...TERMINAL] },
  );
  const snapshot = await renderSnapshot(page);
  const error = await page.$eval(
    '[data-agent-render-error]',
    (element) => ({
      code: element.dataset.agentErrorCode,
      message: element.textContent?.trim(),
    }),
  ).catch(() => null);
  if (snapshot.state === 'failed') {
    throw new Error(`Render failed: ${JSON.stringify(error ?? snapshot)}`);
  }
  if (snapshot.state !== 'complete') {
    throw new Error(`Render did not complete exactly: ${JSON.stringify(snapshot)}`);
  }
  return snapshot;
}

async function mutateAndWait(page, mutation) {
  const before = await renderSnapshot(page);
  await mutation();
  return waitForTerminal(page, before.documentRevision);
}

async function ensurePaletteTypeOpen(page, type) {
  const selector = `[data-agent-action="add-node"][data-agent-node-type="${type}"]`;
  const state = await page.$eval(selector, (button) => {
    const group = button.closest('details');
    const summary = group?.querySelector('[data-agent-action="toggle-palette-category"]');
    return {
      open: group?.open === true,
      category: summary instanceof HTMLElement
        ? summary.dataset.agentCategory ?? ''
        : '',
    };
  });
  if (!state.category) throw new Error(`Palette category missing for ${type}`);
  if (!state.open) {
    const summary = `[data-agent-action="toggle-palette-category"][data-agent-category="${state.category}"]`;
    await focusAndPress(page, summary);
    await page.waitForFunction(
      (buttonSelector) => {
        const button = document.querySelector(buttonSelector);
        return button?.closest('details')?.open === true;
      },
      {},
      selector,
    );
  }
  return selector;
}

async function semanticNodeIds(page) {
  return page.$$eval(
    '[data-agent-target="node"]',
    (nodes) => nodes.map((node) => ({
      id: node.dataset.agentNodeId,
      type: node.dataset.agentNodeType,
      layerId: node.dataset.agentLayerId,
    })),
  );
}

async function addNode(page, type) {
  const selector = await ensurePaletteTypeOpen(page, type);
  const before = await semanticNodeIds(page);
  await mutateAndWait(page, () => focusAndPress(page, selector));
  const after = await semanticNodeIds(page);
  const known = new Set(before.map((node) => `${node.layerId}\u0000${node.id}`));
  const created = after.filter(
    (node) => !known.has(`${node.layerId}\u0000${node.id}`),
  );
  if (created.length !== 1 || created[0].type !== type || !created[0].id) {
    throw new Error(`Could not identify added ${type}: ${JSON.stringify(created)}`);
  }
  return created[0].id;
}

async function ensureConnectionInspectorOpen(page) {
  const summary = '[data-agent-action="toggle-connection-inspector"]';
  const open = await page.$eval(
    summary,
    (element) => element.closest('details')?.open === true,
  );
  if (open) return;
  await focusAndPress(page, summary);
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.closest('details')?.open === true,
    {},
    summary,
  );
}

async function selectConnectionField(page, field, value) {
  const selector = `[data-agent-connection-field="${field}"]`;
  const selected = await page.select(selector, value);
  if (!selected.includes(value)) {
    throw new Error(`Connection field ${field} has no option ${value}`);
  }
  await page.waitForFunction(
    ({ fieldSelector, expected }) => {
      const select = document.querySelector(fieldSelector);
      return select instanceof HTMLSelectElement && select.value === expected;
    },
    {},
    { fieldSelector: selector, expected: value },
  );
}

async function connectNodes(
  page,
  sourceNode,
  sourceSocket,
  targetNode,
  targetSocket,
) {
  await ensureConnectionInspectorOpen(page);
  await selectConnectionField(page, 'source-node', sourceNode);
  await selectConnectionField(page, 'source-socket', sourceSocket);
  await selectConnectionField(page, 'target-node', targetNode);
  await selectConnectionField(page, 'target-socket', targetSocket);
  const terminal = await mutateAndWait(
    page,
    () => focusAndPress(page, '[data-agent-action="connect-sockets"]'),
  );
  const diagnostic = await page.$eval(
    '[data-agent-connection-status]',
    (element) => ({
      code: element.dataset.agentConnectionCode,
      message: element.textContent?.trim(),
    }),
  );
  if (diagnostic.code !== 'OK') {
    throw new Error(`Connection failed: ${JSON.stringify(diagnostic)}`);
  }
  return terminal;
}

async function assertConnectionRejected(
  page,
  sourceNode,
  sourceSocket,
  targetNode,
  targetSocket,
  expectedCode,
) {
  await ensureConnectionInspectorOpen(page);
  await selectConnectionField(page, 'source-node', sourceNode);
  await selectConnectionField(page, 'source-socket', sourceSocket);
  await selectConnectionField(page, 'target-node', targetNode);
  await selectConnectionField(page, 'target-socket', targetSocket);
  const before = await renderSnapshot(page);
  const beforeEdges = await page.$$eval(
    '[data-agent-target="edge"]',
    (edges) => edges.map((edge) => edge.getAttribute('aria-label')).sort(),
  );
  const previousSequence = await page.$eval(
    '[data-agent-connection-status]',
    (element) => Number(element.dataset.agentConnectionSequence),
  );
  await focusAndPress(page, '[data-agent-action="connect-sockets"]');
  await page.waitForFunction(
    (sequence) => {
      const status = document.querySelector('[data-agent-connection-status]');
      return status instanceof HTMLElement
        && Number(status.dataset.agentConnectionSequence) > sequence;
    },
    {},
    previousSequence,
  );
  const diagnostic = await page.$eval(
    '[data-agent-connection-status]',
    (element) => ({
      code: element.dataset.agentConnectionCode,
      revision: Number(element.dataset.agentRevision),
      message: element.textContent?.trim(),
    }),
  );
  const after = await renderSnapshot(page);
  const afterEdges = await page.$$eval(
    '[data-agent-target="edge"]',
    (edges) => edges.map((edge) => edge.getAttribute('aria-label')).sort(),
  );
  if (
    diagnostic.code !== expectedCode
    || diagnostic.revision !== before.documentRevision
    || after.documentRevision !== before.documentRevision
    || JSON.stringify(afterEdges) !== JSON.stringify(beforeEdges)
  ) {
    throw new Error(
      `Rejected connection mutated state or returned the wrong diagnostic: ${
        JSON.stringify({ expectedCode, diagnostic, before, after })
      }`,
    );
  }
}

async function deleteNode(page, nodeId) {
  const terminal = await mutateAndWait(
    page,
    () => focusAndPress(
      page,
      `[data-agent-action="delete-node"][data-agent-node-id="${nodeId}"]`,
    ),
  );
  const stillPresent = (await semanticNodeIds(page)).some((node) => node.id === nodeId);
  if (stillPresent) throw new Error(`Semantic node ${nodeId} was not deleted`);
  return terminal;
}

async function capturePreview(page, terminal, format = 'png') {
  return page.evaluate(async ({ revision, attempt, requestedFormat }) => {
    const hook = globalThis.__render;
    if (!hook?.capturePreview) throw new Error('Read-only preview hook unavailable');
    const result = await hook.capturePreview({
      revision,
      attempt,
      maxWidth: 768,
      maxHeight: 768,
      format: requestedFormat,
      includeMetrics: true,
    });
    return {
      requestedRevision: result.requestedRevision,
      revision: result.revision,
      attempt: result.attempt,
      sourceWidth: result.sourceWidth,
      sourceHeight: result.sourceHeight,
      width: result.width,
      height: result.height,
      mimeType: result.mimeType,
      byteLength: result.byteLength,
      contentHash: result.contentHash,
      rgbaSha256: result.rgbaSha256,
      imageByteLength: result.image.bytes.byteLength,
      imageTrust: result.image.trust,
      metrics: result.metrics,
    };
  }, {
    revision: terminal.documentRevision,
    attempt: terminal.attempt,
    requestedFormat: format,
  });
}

function assertPreview(preview, terminal, expectedMimeType = 'image/png') {
  if (
    preview.revision !== terminal.documentRevision
    || preview.attempt !== terminal.attempt
    || preview.sourceWidth !== 256
    || preview.sourceHeight !== 192
    || preview.width !== 256
    || preview.height !== 192
    || preview.mimeType !== expectedMimeType
    || preview.byteLength <= 0
    || preview.byteLength > 4 * 1024 * 1024
    || preview.imageByteLength !== preview.byteLength
    || preview.imageTrust !== 'untrusted-document-render'
    || !/^[0-9a-f]{64}$/.test(preview.contentHash)
    || !/^[0-9a-f]{64}$/.test(preview.rgbaSha256)
  ) {
    throw new Error(`Invalid preview evidence: ${JSON.stringify(preview)}`);
  }
  if (
    preview.metrics?.version !== 'preview-metrics-v1'
    || preview.metrics.alphaCoverage !== 1
    || !preview.metrics.nonBackgroundBounds
    || !/^[0-9a-f]{16}$/.test(preview.metrics.perceptualHash)
  ) {
    throw new Error(`Preview is blank or metrics are invalid: ${JSON.stringify(preview.metrics)}`);
  }
}

async function assertStalePreviewRejected(page, terminal) {
  const rejected = await page.evaluate(async ({ revision, attempt }) => {
    try {
      await globalThis.__render.capturePreview({
        revision,
        attempt,
        maxWidth: 256,
        maxHeight: 192,
      });
      return null;
    } catch (error) {
      return {
        code: error?.code,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }, {
    revision: terminal.documentRevision,
    attempt: terminal.attempt,
  });
  if (rejected?.code !== 'RENDER_SUPERSEDED') {
    throw new Error(`Stale preview was not rejected: ${JSON.stringify(rejected)}`);
  }
}

async function accessibilityAudit(page, stateName) {
  await page.addScriptTag({ content: axe.source });
  const result = await page.evaluate(async () => {
    const axeResult = await globalThis.axe.run(document, {
      resultTypes: ['violations'],
    });
    const severe = axeResult.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    const nameFor = (element) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      const referenced = labelledBy
        ? labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
            .filter(Boolean)
            .join(' ')
        : '';
      return (
        element.getAttribute('aria-label')
        || referenced
        || element.getAttribute('title')
        || element.textContent?.replace(/\s+/g, ' ').trim()
        || ''
      );
    };
    const semantic = [
      ...document.querySelectorAll('[data-agent-target], [data-agent-action]'),
    ].map((element) => ({
      tag: element.tagName,
      name: nameFor(element),
      target: element.getAttribute('data-agent-target'),
      action: element.getAttribute('data-agent-action'),
    }));
    const emptySemantic = semantic.filter((entry) => !entry.name);
    const byName = new Map();
    for (const entry of semantic) {
      const list = byName.get(entry.name) ?? [];
      list.push(entry);
      byName.set(entry.name, list);
    }
    const duplicateNames = [...byName.entries()]
      .filter(([name, entries]) => name && entries.length > 1);
    const unnamedControls = [
      ...document.querySelectorAll('button, input, canvas'),
    ].filter((element) => {
      if (
        element.closest('[hidden]')
        || element.getAttribute('aria-hidden') === 'true'
        || (element instanceof HTMLInputElement && element.type === 'hidden')
        || element.getClientRects().length === 0
      ) return false;
      return !nameFor(element);
    }).map((element) => element.outerHTML.slice(0, 240));
    return {
      severe: severe.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map((node) => node.target),
      })),
      semanticCount: semantic.length,
      emptySemantic,
      duplicateNames,
      unnamedControls,
      mainPreviewCount: document.querySelectorAll(
        '[data-agent-preview="main"]',
      ).length,
      exposedGuideCount: [...document.querySelectorAll('[data-agent-guide]')]
        .filter((element) => element.getAttribute('aria-hidden') !== 'true')
        .length,
    };
  });
  if (
    result.severe.length
    || result.emptySemantic.length
    || result.duplicateNames.length
    || result.unnamedControls.length
    || result.mainPreviewCount !== 1
    || result.exposedGuideCount !== 0
  ) {
    throw new Error(
      `Accessibility audit failed (${stateName}): ${JSON.stringify(result)}`,
    );
  }
  return result;
}

async function runFiftyRoundGate() {
  return withSmokePage(
    {
      viewport: { width: 1480, height: 920, deviceScaleFactor: 1 },
      storage: { mode: 'v2', document: fixture },
    },
    async ({ page, url, problems }) => {
      await navigateToApp(page, url);
      const initial = await waitForTerminal(page);
      if (initial.documentRevision !== 0) {
        throw new Error(`Unexpected initial revision: ${JSON.stringify(initial)}`);
      }
      const output = (await semanticNodeIds(page)).find(
        (node) => node.type === 'Output',
      );
      if (!output?.id) throw new Error('Output node was not discoverable semantically');

      const hashes = new Set();
      let audit = null;
      for (let round = 0; round < ROUND_COUNT; round++) {
        const text = await addNode(page, 'Text');
        const outline = await addNode(page, 'Outline');
        const rasterize = await addNode(page, 'Rasterize');
        if (round === 0) {
          await assertConnectionRejected(
            page,
            text,
            'out',
            rasterize,
            'vector',
            'TYPE_MISMATCH',
          );
          const blur = await addNode(page, 'Blur');
          await assertConnectionRejected(
            page,
            blur,
            'out',
            blur,
            'in',
            'CYCLE_DETECTED',
          );
          await deleteNode(page, blur);
        }
        await connectNodes(page, text, 'out', outline, 'text');
        await connectNodes(page, outline, 'out', rasterize, 'vector');
        const terminal = await connectNodes(
          page,
          rasterize,
          'out',
          output.id,
          'in',
        );
        const preview = await capturePreview(page, terminal);
        assertPreview(preview, terminal);
        hashes.add(preview.rgbaSha256);

        if (round === 0) {
          const webpPreview = await capturePreview(page, terminal, 'webp');
          assertPreview(webpPreview, terminal, 'image/webp');
          if (webpPreview.rgbaSha256 !== preview.rgbaSha256) {
            throw new Error(
              `PNG/WebP canonical pixels disagree: ${preview.rgbaSha256} !== ${webpPreview.rgbaSha256}`,
            );
          }

          const beforeViewport = await page.$eval(
            '[data-agent-viewport-state]',
            (element) => ({
              x: Number(element.dataset.agentViewportX),
              zoom: Number(element.dataset.agentViewportZoom),
            }),
          );
          await focusAndPress(page, '[data-agent-action="zoom-viewport-out"]');
          await page.waitForFunction(
            (zoom) => Number(
              document.querySelector('[data-agent-viewport-state]')
                ?.getAttribute('data-agent-viewport-zoom'),
            ) < zoom,
            {},
            beforeViewport.zoom,
          );
          const afterZoom = await page.$eval(
            '[data-agent-viewport-state]',
            (element) => ({
              x: Number(element.dataset.agentViewportX),
              zoom: Number(element.dataset.agentViewportZoom),
            }),
          );
          await focusAndPress(page, '[data-agent-action="pan-viewport-right"]');
          await page.waitForFunction(
            (x) => Number(
              document.querySelector('[data-agent-viewport-state]')
                ?.getAttribute('data-agent-viewport-x'),
            ) > x,
            {},
            afterZoom.x,
          );

          const fontSize = `[data-agent-target="parameter"][data-agent-node-id="${text}"][data-agent-param="fontSize"]`;
          const beforeNumberEdit = await renderSnapshot(page);
          await focusAndSelectAll(page, fontSize);
          await page.keyboard.type('144');
          await page.keyboard.press('Enter');
          await waitForTerminal(page, beforeNumberEdit.documentRevision);

          const font = `[data-agent-target="parameter"][data-agent-node-id="${text}"][data-agent-param="font"]`;
          await focusAndPress(page, font, 'ArrowDown');
          await page.waitForFunction(
            (selector) => document.querySelector(selector)?.getAttribute('aria-expanded') === 'true',
            {},
            font,
          );
          audit = await accessibilityAudit(page, 'connected-font-menu');
          const previousFont = await page.$eval(font, (element) => element.value);
          const beforeFontSelection = await renderSnapshot(page);
          await focusAndPress(page, font, 'Enter');
          await page.waitForFunction(
            (selector) => document.querySelector(selector)?.getAttribute('aria-expanded') === 'false',
            {},
            font,
          );
          await waitForTerminal(page, beforeFontSelection.documentRevision);
          const selectedFont = await page.$eval(font, (element) => element.value);
          if (!selectedFont || selectedFont === previousFont) {
            throw new Error(
              `Keyboard font selection did not choose a different option: ${selectedFont}`,
            );
          }
        }

        await deleteNode(page, rasterize);
        if (round === 0) await assertStalePreviewRejected(page, terminal);
        await deleteNode(page, outline);
        await deleteNode(page, text);
        if ((round + 1) % 10 === 0 || round + 1 === ROUND_COUNT) {
          console.log(`semantic progress: ${round + 1}/${ROUND_COUNT}`);
        }
      }
      if (hashes.size !== 1) {
        throw new Error(`Canonical preview pixels drifted across rounds: ${JSON.stringify([...hashes])}`);
      }
      assertNoPageProblems(problems);
      return {
        rounds: ROUND_COUNT,
        rgbaSha256: [...hashes][0],
        accessibilityTargets: audit?.semanticCount ?? 0,
      };
    },
  );
}

async function keyboardLayerGate(page) {
  const beforeLayers = await page.$$eval(
    '[data-agent-target="layer"]',
    (layers) => layers.map((layer) => layer.dataset.agentLayerId),
  );
  await mutateAndWait(
    page,
    () => focusAndPress(page, '[data-agent-action="add-layer"]'),
  );
  const afterLayers = await page.$$eval(
    '[data-agent-target="layer"]',
    (layers) => layers.map((layer) => layer.dataset.agentLayerId),
  );
  const created = afterLayers.filter((id) => id && !beforeLayers.includes(id));
  if (created.length !== 1) throw new Error(`New layer not discoverable: ${created}`);
  const layerId = created[0];
  const originalLayerId = beforeLayers.find(Boolean);
  if (!originalLayerId) throw new Error('Original layer identity is missing');
  await focusAndPress(
    page,
    `[data-agent-action="select-layer"][data-agent-layer-id="${originalLayerId}"]`,
  );
  await page.waitForFunction(
    (id) => document.querySelector(
      `[data-agent-action="select-layer"][data-agent-layer-id="${id}"]`,
    )?.getAttribute('aria-current') === 'true',
    {},
    originalLayerId,
  );
  await focusAndPress(
    page,
    `[data-agent-action="select-layer"][data-agent-layer-id="${layerId}"]`,
  );
  await page.waitForFunction(
    (id) => document.querySelector(
      `[data-agent-action="select-layer"][data-agent-layer-id="${id}"]`,
    )?.getAttribute('aria-current') === 'true',
    {},
    layerId,
  );

  await focusAndPress(
    page,
    `[data-agent-action="rename-layer"][data-agent-layer-id="${layerId}"]`,
  );
  const rename = `[data-agent-target="layer-name"][data-agent-layer-id="${layerId}"]`;
  await page.waitForSelector(rename);
  const beforeRename = await renderSnapshot(page);
  await focusAndSelectAll(page, rename);
  await page.keyboard.type('Keyboard layer');
  await page.keyboard.press('Enter');
  await waitForTerminal(page, beforeRename.documentRevision);

  await mutateAndWait(
    page,
    () => focusAndPress(
      page,
      `[data-agent-action="toggle-layer-visibility"][data-agent-layer-id="${layerId}"]`,
    ),
  );
  const reorder = await page.$(
    `[data-agent-action="lower-layer"][data-agent-layer-id="${layerId}"]:not(:disabled)`,
  ) ?? await page.$(
    `[data-agent-action="raise-layer"][data-agent-layer-id="${layerId}"]:not(:disabled)`,
  );
  if (!reorder) throw new Error('No keyboard layer reorder action available');
  await mutateAndWait(page, async () => {
    await reorder.focus();
    await page.keyboard.press('Enter');
  });

  const opacity = `[data-agent-target="layer-control"][data-agent-layer-id="${layerId}"][data-agent-layer-control="opacity"]`;
  const beforeOpacity = await renderSnapshot(page);
  const opacityInput = await page.$(opacity);
  if (!opacityInput) throw new Error('Layer opacity spinbutton not found');
  await opacityInput.focus();
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press('Backspace');
  }
  await page.keyboard.type('75');
  await page.keyboard.press('Enter');
  await waitForTerminal(page, beforeOpacity.documentRevision);
  await mutateAndWait(
    page,
    () => focusAndPress(
      page,
      `[data-agent-action="delete-layer"][data-agent-layer-id="${layerId}"]`,
    ),
  );
  return originalLayerId;
}

async function collisionGate() {
  return withSmokePage(
    {
      viewport: { width: 1480, height: 920, deviceScaleFactor: 1 },
      storage: { mode: 'v2', document: fixture },
    },
    async ({ page, url, problems }) => {
      await navigateToApp(page, url);
      await waitForTerminal(page);
      const layerId = await keyboardLayerGate(page);
      const types = [
        'Text',
        'Outline',
        'Rasterize',
        'Blur',
        'Shape',
        'Grid',
        'Place',
        'Noise',
        'Filter',
        'Random',
      ];
      for (let index = 0; index < 20; index++) {
        await addNode(page, types[index % types.length]);
      }
      const collision = await page.evaluate((activeLayerId) => {
        const rect = (element) => {
          const value = element.getBoundingClientRect();
          return {
            name: element.getAttribute('aria-label')
              || element.getAttribute('data-agent-fixed-panel')
              || element.tagName,
            left: value.left,
            top: value.top,
            right: value.right,
            bottom: value.bottom,
            width: value.width,
            height: value.height,
          };
        };
        const overlap = (left, right) => (
          Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1
          && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1
        );
        const nodes = [...document.querySelectorAll('[data-agent-target="node"]')]
          .filter((element) => element.dataset.agentLayerId === activeLayerId)
          .map(rect)
          .filter((value) => value.width > 0 && value.height > 0);
        const panels = [...document.querySelectorAll('[data-agent-fixed-panel]')]
          .map(rect)
          .filter((value) => value.width > 0 && value.height > 0);
        const nodePairs = [];
        for (let left = 0; left < nodes.length; left++) {
          for (let right = left + 1; right < nodes.length; right++) {
            if (overlap(nodes[left], nodes[right])) {
              nodePairs.push([nodes[left], nodes[right]]);
            }
          }
        }
        const panelPairs = nodes.flatMap((node) =>
          panels.filter((panel) => overlap(node, panel))
            .map((panel) => [node, panel]));
        return { nodeCount: nodes.length, nodePairs, panelPairs };
      }, layerId);
      if (
        collision.nodeCount < 20
        || collision.nodePairs.length
        || collision.panelPairs.length
      ) {
        throw new Error(`Node placement collision: ${JSON.stringify(collision)}`);
      }
      const audit = await accessibilityAudit(page, 'twenty-nodes-and-layers');
      assertNoPageProblems(problems);
      return {
        nodes: collision.nodeCount,
        accessibilityTargets: audit.semanticCount,
      };
    },
  );
}

const semantic = await runFiftyRoundGate();
console.log(`semantic rounds: ${semantic.rounds}`);
console.log(`canonical rgba sha256: ${semantic.rgbaSha256}`);
console.log(`semantic accessibility targets: ${semantic.accessibilityTargets}`);
const collision = await collisionGate();
console.log(`collision nodes: ${collision.nodes}`);
console.log(`collision accessibility targets: ${collision.accessibilityTargets}`);
console.log('ALL CHECKS PASSED');
