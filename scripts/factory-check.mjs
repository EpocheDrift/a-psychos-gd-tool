// First-run gate: with no saved document, the app boots into the four-layer
// factory doc extracted from the author's setup, the public image asset
// fetches, and every layer cooks without page errors.
// Usage: node scripts/factory-check.mjs [url]
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
  await pairAgent(page, { scopes: ['read'] });

  const state = await page.evaluate(() => {
    const current = globalThis.gfxAgent.getDocument({
      include: ['frame', 'layers', 'nodes', 'edges'],
    });
    return {
      frame: current.frame,
      trust: current.trust,
      layers: current.layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        nodes: layer.graph.nodes.length,
        edges: layer.graph.edges.length,
      })),
      totalNodes: current.layers.reduce((sum, layer) => sum + layer.graph.nodes.length, 0),
      totalEdges: current.layers.reduce((sum, layer) => sum + layer.graph.edges.length, 0),
      imageAssetIds: current.layers.flatMap((layer) =>
        layer.graph.nodes
          .filter((node) => node.type === 'Image')
          .map((node) => node.params.assetId)),
    };
  });
  console.log('frame:', JSON.stringify(state.frame));
  console.log('layers:', JSON.stringify(state.layers));
  console.log('image asset IDs:', JSON.stringify(state.imageAssetIds));

  if (state.trust !== 'untrusted-document-content') throw new Error('document trust label missing');
  if (state.frame.width !== 2480 || state.frame.height !== 3508) throw new Error('wrong frame');
  const expectedLayers = [
    { id: 'layer_2', nodes: 6, edges: 5 },
    { id: 'layer_3', nodes: 7, edges: 6 },
    { id: 'layer_1', nodes: 19, edges: 18 },
    { id: 'layer_4', nodes: 10, edges: 9 },
  ];
  const actualLayers = state.layers.map(({ id, nodes, edges }) => ({ id, nodes, edges }));
  if (JSON.stringify(actualLayers) !== JSON.stringify(expectedLayers)) {
    throw new Error(`wrong factory inventory: ${JSON.stringify(actualLayers)}`);
  }
  if (state.totalNodes !== 42 || state.totalEdges !== 38) {
    throw new Error(`wrong factory totals: ${state.totalNodes} nodes, ${state.totalEdges} edges`);
  }
  const factoryAssetId =
    'asset_6756f325115e27086ff416a91823f7ed87085cb572f79c82b5072dd1b3da5df8';
  if (
    !state.imageAssetIds.length
    || !state.imageAssetIds.every((assetId) => assetId === factoryAssetId)
  ) {
    throw new Error('image node does not reference the fixed bundled asset');
  }

  const image = await page.evaluate(async () => {
    const response = await fetch('/factory-image.jpg');
    return { ok: response.ok, bytes: (await response.blob()).size };
  });
  console.log('image fetch:', JSON.stringify(image));
  if (!image.ok || image.bytes !== 987604) throw new Error('factory image asset missing or wrong size');

  const screenshot = await smokeArtifactPath('factory-first-run.png');
  await page.screenshot({ path: screenshot });
  assertNoPageProblems(problems);
  console.log(`screenshot: ${screenshot}`);
  console.log('ALL CHECKS PASSED');
});
