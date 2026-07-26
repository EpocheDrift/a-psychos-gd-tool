// PR5 browser boundary gate: real response headers, explicit human pairing,
// frozen named surface, session-local idempotency/revert state, exact render
// and preview, one-shot claim replay, token non-persistence, and revoke.
import { readFile } from 'node:fs/promises';
import {
  assertNoPageProblems,
  navigateToApp,
  pairAgent,
  waitForInitialCook,
  withSmokePage,
} from './smoke/browser.mjs';

const fixture = JSON.parse(await readFile(
  new URL('../test/fixtures/documents/agent-semantic-blank.json', import.meta.url),
  'utf8',
));
const modelFixture = structuredClone(fixture);
modelFixture.layers[0].graph.nodes = {
  model_noise: {
    id: 'model_noise',
    type: 'Noise',
    params: { mode: 'value', scale: 32, seed: 7 },
    position: { x: 0, y: 0 },
  },
  model_remove_background: {
    id: 'model_remove_background',
    type: 'RemoveBackground',
    params: {},
    position: { x: 240, y: 0 },
  },
  semantic_output: {
    ...modelFixture.layers[0].graph.nodes.semantic_output,
    position: { x: 480, y: 0 },
  },
};
modelFixture.layers[0].graph.edges = [
  {
    from: { node: 'model_noise', socket: 'out' },
    to: { node: 'model_remove_background', socket: 'in' },
  },
  {
    from: { node: 'model_remove_background', socket: 'out' },
    to: { node: 'semantic_output', socket: 'in' },
  },
];

await withSmokePage(
  {
    viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    storage: { mode: 'v2', document: fixture },
  },
  async ({ page, url, problems }) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Agent app response failed: ${response.status}`);
    const requiredHeaders = {
      'content-security-policy': [
        "default-src 'self'",
        "frame-ancestors 'none'",
        "script-src 'self'",
      ],
      'referrer-policy': ['no-referrer'],
      'permissions-policy': ['local-fonts=()', 'camera=()', 'microphone=()'],
      'x-content-type-options': ['nosniff'],
      'x-frame-options': ['DENY'],
      'cross-origin-opener-policy': ['same-origin'],
    };
    for (const [name, fragments] of Object.entries(requiredHeaders)) {
      const value = response.headers.get(name) ?? '';
      for (const fragment of fragments) {
        if (!value.includes(fragment)) {
          throw new Error(`Missing Agent response header ${name}: ${fragment}; actual=${value}`);
        }
      }
    }

    await navigateToApp(page, url);
    await waitForInitialCook(page, { width: 256, height: 192 });
    const bootstrap = await page.evaluate(() => ({
      keys: Object.keys(globalThis.gfxAgentPairing ?? {}),
      frozen: Object.isFrozen(globalThis.gfxAgentPairing),
      controllerAbsent: globalThis.gfxAgent === undefined,
      legacyAbsent:
        globalThis.__app === undefined
        && globalThis.__render === undefined,
      unarmed: globalThis.gfxAgentPairing?.requestPairing({
        protocolVersion: '1.0',
        clientNonce: 'A'.repeat(43),
        clientLabel: 'unarmed probe',
        requestedScopes: ['read'],
      }),
    }));
    if (
      JSON.stringify(bootstrap.keys) !== JSON.stringify([
        'requestPairing',
        'completePairing',
      ])
      || !bootstrap.frozen
      || !bootstrap.controllerAbsent
      || !bootstrap.legacyAbsent
      || bootstrap.unarmed?.ok !== false
      || bootstrap.unarmed?.error?.code !== 'PAIRING_NOT_ARMED'
    ) {
      throw new Error(`Unsafe Agent bootstrap surface: ${JSON.stringify(bootstrap)}`);
    }

    // Synthetic DOM .click() is not a human-grant path.
    const syntheticState = await page.evaluate(() => {
      document.querySelector('[data-agent-action="open-agent-pairing"]')?.click();
      return document.querySelector('[data-agent-pairing-panel]')
        ?.getAttribute('data-agent-pairing-state');
    });
    if (syntheticState !== 'idle') {
      throw new Error(`Synthetic click armed pairing: ${syntheticState}`);
    }

    const firstSession = await pairAgent(page, {
      scopes: ['read', 'preview', 'edit'],
      clientLabel: 'PR5 security smoke <untrusted>',
    });
    if (
      firstSession.smokeAudit.secretInDom
      || firstSession.smokeAudit.secretInUrl
      || firstSession.smokeAudit.secretInStorage
      || firstSession.smokeAudit.replayCode !== 'PAIRING_REPLAYED'
    ) {
      throw new Error(`Pairing secret/replay audit failed: ${JSON.stringify(firstSession.smokeAudit)}`);
    }
    if (
      JSON.stringify(firstSession.scopes) !== JSON.stringify([
        'read',
        'preview',
        'edit',
      ])
    ) {
      throw new Error(`Unexpected granted scopes: ${JSON.stringify(firstSession.scopes)}`);
    }
    const layoutAudit = await page.evaluate(() => {
      const panel = document.querySelector('[data-agent-pairing-panel]');
      const frame = document.querySelector('.frame-config');
      const exportButton = document.querySelector('[data-agent-action="export-png"]');
      if (!panel || !frame || !(exportButton instanceof HTMLElement)) return null;
      const panelRect = panel.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const exportRect = exportButton.getBoundingClientRect();
      const hit = document.elementFromPoint(
        exportRect.left + exportRect.width / 2,
        exportRect.top + exportRect.height / 2,
      );
      return {
        panelBottom: panelRect.bottom,
        frameTop: frameRect.top,
        overlap:
          panelRect.left < frameRect.right
          && panelRect.right > frameRect.left
          && panelRect.top < frameRect.bottom
          && panelRect.bottom > frameRect.top,
        exportHit: hit?.closest('[data-agent-action="export-png"]') === exportButton,
      };
    });
    if (!layoutAudit || layoutAudit.overlap || !layoutAudit.exportHit) {
      throw new Error(`Agent panel covered core controls: ${JSON.stringify(layoutAudit)}`);
    }

    const firstRun = await page.evaluate(async () => {
      let stage = 'getCapabilities';
      try {
        const agent = globalThis.gfxAgent;
        const capabilities = agent.getCapabilities({
          nodeTypes: ['Text', 'Output'],
          include: ['params', 'traits'],
        });
        if (
          capabilities.scopeAvailability.model.available
          || capabilities.scopeAvailability.assets.available
          || capabilities.scopeAvailability.export.available
        ) {
          throw new Error('Later rollout scopes unexpectedly available');
        }
        stage = 'getDocument';
        const before = agent.getDocument({ include: ['frame'] });
        const request = {
          requestId: 'agent_controller_replay',
          expectedRevision: before.revision,
          commands: [{
            op: 'set_frame',
            width: 257,
            height: 192,
          }],
        };
        stage = 'applyTransaction';
        const first = await agent.applyTransaction(request);
        stage = 'replayTransaction';
        const replay = await agent.applyTransaction(request);
        if (!first.ok || JSON.stringify(first) !== JSON.stringify(replay)) {
          throw new Error(`Transaction replay mismatch: ${JSON.stringify({ first, replay })}`);
        }
        stage = 'awaitRender';
        const rendered = await agent.awaitRender({
          revision: first.revision,
          timeoutMs: 20_000,
        });
        stage = 'capturePreview';
        const preview = await agent.capturePreview({
          revision: first.revision,
          attempt: rendered.ticket.attempt,
          maxWidth: 257,
          maxHeight: 192,
          includeMetrics: true,
        });
        stage = 'readPreviewHandle';
        const previewBytes = (await (await fetch(preview.image.url)).arrayBuffer()).byteLength;
        stage = 'getFinalDocument';
        const after = agent.getDocument({ include: ['frame'] });
        return {
          capabilitiesRoundTrip:
            JSON.stringify(JSON.parse(JSON.stringify(capabilities)))
            === JSON.stringify(capabilities),
          first,
          after,
          rendered,
          preview: {
            kind: preview.image.kind,
            trust: preview.trust,
            bytes: previewBytes,
            advertisedBytes: preview.byteLength,
            revision: preview.revision,
          },
        };
      } catch (error) {
        return {
          stage,
          thrown: error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : JSON.parse(JSON.stringify(error)),
        };
      }
    });
    if (firstRun.thrown) {
      throw new Error(
        `Controller happy path threw at ${firstRun.stage}: ${JSON.stringify(firstRun.thrown)}`,
      );
    }
    if (
      !firstRun.capabilitiesRoundTrip
      || !firstRun.first.ok
      || firstRun.after.revision !== 1
      || firstRun.after.frame.width !== 257
      || firstRun.rendered.state !== 'complete'
      || firstRun.rendered.renderRevision !== 1
      || firstRun.preview.kind !== 'browser-object-url-v1'
      || firstRun.preview.trust !== 'untrusted-document-render'
      || firstRun.preview.bytes !== firstRun.preview.advertisedBytes
      || firstRun.preview.revision !== 1
    ) {
      throw new Error(`Controller happy path failed: ${JSON.stringify(firstRun)}`);
    }

    const retained = await page.evaluateHandle(() => globalThis.gfxAgent);
    await page.click('[data-agent-action="revoke-agent-session"]');
    await page.waitForFunction(() =>
      globalThis.gfxAgent === undefined
      && document.querySelector('[data-agent-pairing-panel]')
        ?.getAttribute('data-agent-pairing-state') === 'revoked');
    await page.waitForFunction(() =>
      document.activeElement?.getAttribute('data-agent-action')
        === 'open-agent-pairing');
    const retainedFailure = await page.evaluate((controller) => {
      try {
        controller.getCapabilities();
        return null;
      } catch (error) {
        return error;
      }
    }, retained);
    await retained.dispose();
    if (retainedFailure?.error?.code !== 'SESSION_REVOKED') {
      throw new Error(`Retained revoked facade remained active: ${JSON.stringify(retainedFailure)}`);
    }

    const secondSession = await pairAgent(page, {
      scopes: ['read', 'edit'],
      clientLabel: 'PR5 second session',
    });
    if (secondSession.sessionFingerprint === firstSession.sessionFingerprint) {
      throw new Error('Fresh pairing reused a session fingerprint');
    }
    const isolation = await page.evaluate(async () => {
      const agent = globalThis.gfxAgent;
      const before = agent.getDocument({ include: ['frame'] });
      const oldRevert = await agent.revertTransaction({
        requestId: 'new_session_old_revert',
        expectedRevision: before.revision,
        transactionId: 'transaction_1',
      });
      const samePublicRequestId = await agent.applyTransaction({
        requestId: 'agent_controller_replay',
        expectedRevision: before.revision,
        commands: [{
          op: 'set_frame',
          width: 258,
          height: 192,
        }],
      });
      return {
        before,
        oldRevert,
        samePublicRequestId,
        after: agent.getDocument({ include: ['frame'] }),
      };
    });
    if (
      isolation.oldRevert.ok
      || isolation.oldRevert.error.code !== 'INVALID_ARGUMENT'
      || !isolation.samePublicRequestId.ok
      || isolation.after.revision !== 2
      || isolation.after.frame.width !== 258
    ) {
      throw new Error(`Session isolation failed: ${JSON.stringify(isolation)}`);
    }

    assertNoPageProblems(problems);
    console.log('headers: PASS');
    console.log('pairing/replay/revoke: PASS');
    console.log('session-local transaction state: PASS');
    console.log('exact preview handle: PASS');
    console.log('ALL CHECKS PASSED');
  },
);

await withSmokePage(
  {
    viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    storage: { mode: 'v2', document: modelFixture },
  },
  async ({ page, url, problems }) => {
    await navigateToApp(page, url);
    await pairAgent(page, {
      scopes: ['read'],
      clientLabel: 'PR5 preloaded model gate',
    });
    const status = await page.evaluate(async () => {
      const agent = globalThis.gfxAgent;
      return agent.awaitRender({ revision: 0, timeoutMs: 20_000 });
    });
    if (
      status.state !== 'failed'
      || status.error?.code !== 'MODEL_DOWNLOAD_REQUIRED'
      || status.error?.phase !== 'agent-model-policy'
      || !status.error?.details?.nodeTypes?.includes('RemoveBackground')
    ) {
      throw new Error(`Preloaded model document did not fail closed: ${JSON.stringify(status)}`);
    }
    assertNoPageProblems(problems);
    console.log('preloaded model execution gate: PASS');
  },
);
