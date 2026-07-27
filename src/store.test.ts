// Wire rules + store actions, headless against the real node registry.

import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_FRAME, type Doc, type Graph } from './engine/graph';
import { DEFAULT_AGENT_LIMITS } from './domain/limits';
import {
  endGesture,
  previewWireConnection,
  selectActiveGraph,
  useApp,
  wireIsValid,
} from './store';

/** A one-layer document around `graph` — the pre-layers store shape. */
function docWith(graph: Graph): Doc {
  return {
    frame: DEFAULT_FRAME,
    layers: [{ id: 'layer_1', name: 'Layer 1', visible: true, opacity: 1, blendMode: 'normal', graph }],
  };
}

const activeGraph = () => selectActiveGraph(useApp.getState());

function chain(): Graph {
  return {
    nodes: {
      text1: { id: 'text1', type: 'Text', params: {} },
      outline1: { id: 'outline1', type: 'Outline', params: {} },
      raster1: { id: 'raster1', type: 'Rasterize', params: {} },
      blur1: { id: 'blur1', type: 'Blur', params: {} },
      out: { id: 'out', type: 'Output', params: {} },
    },
    edges: [
      { from: { node: 'text1', socket: 'out' }, to: { node: 'outline1', socket: 'text' } },
      { from: { node: 'outline1', socket: 'out' }, to: { node: 'raster1', socket: 'vector' } },
      { from: { node: 'raster1', socket: 'out' }, to: { node: 'blur1', socket: 'in' } },
      { from: { node: 'blur1', socket: 'out' }, to: { node: 'out', socket: 'in' } },
    ],
  };
}

function paddedPngBytes(byteLength = 1_600_000): Uint8Array {
  const bytes = Buffer.alloc(byteLength);
  Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex').copy(bytes);
  return bytes;
}

describe('wireIsValid', () => {
  it('accepts matching socket types', () => {
    expect(wireIsValid(chain(), { source: 'raster1', sourceHandle: 'out', target: 'out', targetHandle: 'in' })).toBe(true);
  });

  it('rejects mismatched socket types — never coerced', () => {
    // text output into a raster input
    expect(wireIsValid(chain(), { source: 'text1', sourceHandle: 'out', target: 'blur1', targetHandle: 'in' })).toBe(false);
  });

  it('rejects wires that would create a cycle', () => {
    // out is downstream of blur1; wiring out back into blur1 closes a loop
    expect(wireIsValid(chain(), { source: 'out', sourceHandle: 'out', target: 'blur1', targetHandle: 'in' })).toBe(false);
  });

  it('rejects unknown sockets', () => {
    expect(wireIsValid(chain(), { source: 'raster1', sourceHandle: 'nope', target: 'out', targetHandle: 'in' })).toBe(false);
  });

  it('union inputs accept any member type, reject the rest', () => {
    const g = chain();
    g.nodes.place1 = { id: 'place1', type: 'Place', params: {} };
    g.nodes.grid1 = { id: 'grid1', type: 'Grid', params: {} };
    // vector -> Place.elements (lifted single element)
    expect(wireIsValid(g, { source: 'outline1', sourceHandle: 'out', target: 'place1', targetHandle: 'elements' })).toBe(true);
    // raster -> Place.elements
    expect(wireIsValid(g, { source: 'raster1', sourceHandle: 'out', target: 'place1', targetHandle: 'elements' })).toBe(true);
    // elements -> Output.in (the artboard composites them)
    expect(wireIsValid(g, { source: 'place1', sourceHandle: 'out', target: 'out', targetHandle: 'in' })).toBe(true);
    // layout is NOT a member — still needs Place or DrawLayout first
    expect(wireIsValid(g, { source: 'grid1', sourceHandle: 'out', target: 'out', targetHandle: 'in' })).toBe(false);
    expect(wireIsValid(g, { source: 'grid1', sourceHandle: 'out', target: 'place1', targetHandle: 'layout' })).toBe(true);
  });
});

describe('store actions', () => {
  beforeEach(() => useApp.setState({
    doc: docWith(chain()),
    revision: 0,
    activeLayerId: 'layer_1',
    selectedNodeIds: [],
    past: [],
    future: [],
  }));

  it('connect replaces the existing wire on an input socket', () => {
    useApp.getState().connect({ source: 'raster1', sourceHandle: 'out', target: 'out', targetHandle: 'in' });
    const edges = activeGraph().edges;
    const intoOut = edges.filter((e) => e.to.node === 'out');
    expect(intoOut).toHaveLength(1);
    expect(intoOut[0].from.node).toBe('raster1'); // blur1 -> out was replaced
  });

  it('connect returns a stable diagnostic and leaves graph/revision unchanged', () => {
    const before = useApp.getState();
    const result = useApp.getState().connect({
      source: 'text1',
      sourceHandle: 'out',
      target: 'blur1',
      targetHandle: 'in',
    });
    expect(result).toMatchObject({
      ok: false,
      revision: 0,
      error: { code: 'TYPE_MISMATCH' },
    });
    expect(useApp.getState().doc).toBe(before.doc);
    expect(useApp.getState().revision).toBe(before.revision);
    expect(useApp.getState().past).toBe(before.past);
  });

  it.each([
    [
      {
        source: 'missing',
        sourceHandle: 'out',
        target: 'out',
        targetHandle: 'in',
      },
      'UNKNOWN_NODE',
    ],
    [
      {
        source: 'raster1',
        sourceHandle: 'missing',
        target: 'out',
        targetHandle: 'in',
      },
      'UNKNOWN_SOCKET',
    ],
    [
      {
        source: 'text1',
        sourceHandle: 'out',
        target: 'blur1',
        targetHandle: 'in',
      },
      'TYPE_MISMATCH',
    ],
    [
      {
        source: 'out',
        sourceHandle: 'out',
        target: 'blur1',
        targetHandle: 'in',
      },
      'CYCLE_DETECTED',
    ],
  ])('previews connection failure %s as %s without mutation', (wire, code) => {
    const before = useApp.getState();
    const result = previewWireConnection(before, wire);
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(useApp.getState()).toBe(before);
  });

  it('removeNodes drops the node and all its wires', () => {
    useApp.getState().removeNodes(['blur1']);
    const g = activeGraph();
    expect(g.nodes.blur1).toBeUndefined();
    expect(g.edges.some((e) => e.from.node === 'blur1' || e.to.node === 'blur1')).toBe(false);
  });

  it('addNode seeds params from the registry defaults', () => {
    const position = { x: 0, y: 0 };
    const id = useApp.getState().addNode('Blur', position);
    const g = activeGraph();
    const added = Object.values(g.nodes).find((n) => n.type === 'Blur' && n.id !== 'blur1')!;
    expect(id).toBe(added.id);
    expect(useApp.getState().selectedNodeIds).toEqual([id]);
    expect(added.params.radius).toBe(8);
    position.x = 999;
    expect(activeGraph().nodes[added.id].position).toEqual({ x: 0, y: 0 });
    expect(useApp.getState().revision).toBe(1);
  });

  it('increments revision only for actual document changes', () => {
    useApp.getState().select(['text1']);
    expect(useApp.getState().revision).toBe(0);
    useApp.getState().connect({
      source: 'text1',
      sourceHandle: 'out',
      target: 'blur1',
      targetHandle: 'in',
    });
    expect(useApp.getState().revision).toBe(0);
    useApp.getState().setFrame({ width: 640, height: 480 });
    expect(useApp.getState().revision).toBe(1);
    useApp.getState().setFrame({ width: 640, height: 480 });
    expect(useApp.getState().revision).toBe(1);
  });

  it('defensively copies selection arrays without creating a document edit', () => {
    const before = useApp.getState();
    const ids = ['text1'];
    useApp.getState().select(ids);
    const selected = useApp.getState().selectedNodeIds;
    ids.push('blur1');

    expect(selected).not.toBe(ids);
    expect(useApp.getState().selectedNodeIds).toEqual(['text1']);
    expect(useApp.getState().doc).toBe(before.doc);
    expect(useApp.getState().revision).toBe(before.revision);
    expect(useApp.getState().past).toBe(before.past);
  });

  it('preserves structural sharing through the trusted UI command path', () => {
    const document = docWith(chain());
    const inactiveLayer = {
      id: 'layer_2',
      name: 'Layer 2',
      visible: true,
      opacity: 1,
      blendMode: 'normal' as const,
      graph: {
        nodes: {
          out: { id: 'out', type: 'Output', params: { transparent: true } },
        },
        edges: [],
      },
    };
    document.layers.push(inactiveLayer);
    useApp.setState({
      doc: document,
      activeLayerId: 'layer_1',
      revision: 0,
      past: [],
      future: [],
    });

    const activeLayer = document.layers[0];
    const graph = activeLayer.graph;
    const nodes = graph.nodes;
    const blur = nodes.blur1;
    const text = nodes.text1;
    useApp.getState().setParam('blur1', 'radius', 12);
    const after = useApp.getState();

    expect(after.doc.layers[0]).not.toBe(activeLayer);
    expect(after.doc.layers[0].graph).not.toBe(graph);
    expect(after.doc.layers[0].graph.nodes).not.toBe(nodes);
    expect(after.doc.layers[0].graph.nodes.blur1).not.toBe(blur);
    expect(after.doc.layers[0].graph.nodes.text1).toBe(text);
    expect(after.doc.layers[0].graph.edges).toBe(graph.edges);
    expect(after.doc.layers[1]).toBe(inactiveLayer);
    expect(after.past[0].doc).toBe(document);
    expect(after.past[0].doc.layers[1]).toBe(after.doc.layers[1]);
  });

  it('keeps the 20 MiB human binary-upload boundary above the Agent request cap', async () => {
    const bytes = paddedPngBytes();
    const legacyEncodedLength =
      `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`.length;
    expect(legacyEncodedLength)
      .toBeGreaterThan(DEFAULT_AGENT_LIMITS.maxTransactionJsonBytes);
    expect(bytes.byteLength).toBeLessThan(DEFAULT_AGENT_LIMITS.maxLegacyAssetBytes);

    const imageId = useApp.getState().addNode('Image', { x: 0, y: 0 });
    expect(imageId).not.toBeNull();
    const beforeRevision = useApp.getState().revision;
    const beforeHistory = useApp.getState().past.length;
    const metadata = await useApp.getState().putAssetBytes(bytes, 'image/png');
    expect(metadata).toMatchObject({
      id: `asset_${metadata.sha256}`,
      mimeType: 'image/png',
      byteLength: bytes.byteLength,
      width: 1,
      height: 1,
      source: 'upload',
    });
    expect(useApp.getState().assets).toContainEqual(metadata);
    useApp.getState().setParam(imageId!, 'assetId', metadata.id);

    const after = useApp.getState();
    expect(selectActiveGraph(after).nodes[imageId!].params.assetId)
      .toBe(metadata.id);
    expect(after.revision).toBe(beforeRevision + 2);
    expect(after.past).toHaveLength(beforeHistory + 2);
  });
});

describe('undo/redo', () => {
  beforeEach(() => {
    useApp.setState({
      doc: docWith(chain()),
      revision: 0,
      activeLayerId: 'layer_1',
      selectedNodeIds: [],
      past: [],
      future: [],
    });
    endGesture();
  });

  it('undo restores a removed node and its wires; redo removes it again', () => {
    useApp.getState().removeNodes(['blur1']);
    useApp.getState().undo();
    let g = activeGraph();
    expect(g.nodes.blur1).toBeDefined();
    expect(g.edges.filter((e) => e.from.node === 'blur1' || e.to.node === 'blur1')).toHaveLength(2);
    useApp.getState().redo();
    g = activeGraph();
    expect(g.nodes.blur1).toBeUndefined();
  });

  it('a new edit clears the redo stack', () => {
    useApp.getState().removeNodes(['blur1']);
    useApp.getState().undo();
    useApp.getState().addNode('Blur', { x: 0, y: 0 });
    expect(useApp.getState().future).toHaveLength(0);
  });

  it('a param scrub coalesces into one undo step, split at gesture boundaries', () => {
    useApp.getState().setParam('blur1', 'radius', 1);
    useApp.getState().setParam('blur1', 'radius', 2);
    useApp.getState().setParam('blur1', 'radius', 3);
    expect(useApp.getState().revision).toBe(3);
    endGesture(); // pointer-up
    useApp.getState().setParam('blur1', 'radius', 9);
    expect(useApp.getState().past).toHaveLength(2);
    expect(useApp.getState().revision).toBe(4);
    useApp.getState().undo();
    expect(activeGraph().nodes.blur1.params.radius).toBe(3);
    expect(useApp.getState().revision).toBe(5);
    useApp.getState().undo();
    expect(activeGraph().nodes.blur1.params.radius).toBeUndefined();
    expect(useApp.getState().revision).toBe(6);
  });

  it('endGesture splits two drags of the same node into two undo steps', () => {
    useApp.getState().moveNodes({ blur1: { x: 1, y: 0 } });
    useApp.getState().moveNodes({ blur1: { x: 2, y: 0 } }); // same drag — coalesces
    endGesture(); // drag end
    useApp.getState().moveNodes({ blur1: { x: 9, y: 0 } });
    expect(useApp.getState().past).toHaveLength(2);
  });

  it('a group drag is one undo step that restores every node', () => {
    useApp.getState().moveNodes({ blur1: { x: 1, y: 0 }, raster1: { x: 1, y: 1 } });
    useApp.getState().moveNodes({ blur1: { x: 2, y: 0 }, raster1: { x: 2, y: 1 } }); // same drag — coalesces
    endGesture();
    expect(useApp.getState().past).toHaveLength(1);
    useApp.getState().undo();
    const g = activeGraph();
    expect(g.nodes.blur1.position).toBeUndefined();
    expect(g.nodes.raster1.position).toBeUndefined();
  });

  it('edits to different params do not coalesce', () => {
    useApp.getState().setParam('blur1', 'radius', 1);
    useApp.getState().setParam('text1', 'content', 'A');
    expect(useApp.getState().past).toHaveLength(2);
  });

  it('an invalid connect leaves no history entry', () => {
    useApp.getState().connect({ source: 'text1', sourceHandle: 'out', target: 'blur1', targetHandle: 'in' });
    expect(useApp.getState().past).toHaveLength(0);
  });

  it('undo with an empty stack is a no-op', () => {
    const before = useApp.getState().doc;
    useApp.getState().undo();
    expect(useApp.getState().doc).toBe(before);
  });

  it('selected nodes that vanish on undo are dropped from the selection', () => {
    useApp.getState().select(['text1']);
    useApp.getState().addNode('Blur', { x: 0, y: 0 });
    expect(useApp.getState().selectedNodeIds).toHaveLength(1);
    useApp.getState().select([...useApp.getState().selectedNodeIds, 'text1']);
    useApp.getState().undo();
    // the added node is gone; the surviving node stays selected
    expect(useApp.getState().selectedNodeIds).toEqual(['text1']);
  });

  it('removeNodes drops the removed ids from a multi-selection', () => {
    useApp.getState().select(['blur1', 'raster1', 'text1']);
    useApp.getState().removeNodes(['blur1', 'raster1']);
    expect(useApp.getState().selectedNodeIds).toEqual(['text1']);
  });
});

describe('layers', () => {
  beforeEach(() => {
    useApp.setState({
      doc: docWith(chain()),
      revision: 0,
      activeLayerId: 'layer_1',
      selectedNodeIds: [],
      past: [],
      future: [],
    });
    endGesture();
  });

  it('addLayer inserts above the active layer, transparent by default, and activates it', () => {
    useApp.getState().addLayer();
    const { doc, activeLayerId } = useApp.getState();
    expect(doc.layers).toHaveLength(2);
    expect(doc.layers[1].id).toBe(activeLayerId); // above layer_1
    expect(doc.layers[1].opacity).toBe(1);
    expect(doc.layers[1].blendMode).toBe('normal');
    const out = Object.values(doc.layers[1].graph.nodes).find((n) => n.type === 'Output')!;
    expect(out.params.transparent).toBe(true);
  });

  it('graph edits land on the active layer only', () => {
    useApp.getState().addLayer();
    useApp.getState().addNode('Shape', { x: 0, y: 0 });
    const { doc } = useApp.getState();
    expect(Object.values(doc.layers[1].graph.nodes).some((n) => n.type === 'Shape')).toBe(true);
    expect(Object.values(doc.layers[0].graph.nodes).some((n) => n.type === 'Shape')).toBe(false);
  });

  it('moveLayer reorders the stack and clamps at the ends', () => {
    useApp.getState().addLayer();
    const top = useApp.getState().activeLayerId;
    useApp.getState().moveLayer(top, 1); // already topmost — no-op, no history
    expect(useApp.getState().doc.layers[1].id).toBe(top);
    const before = useApp.getState().past.length;
    useApp.getState().moveLayer(top, -1);
    expect(useApp.getState().doc.layers[0].id).toBe(top);
    expect(useApp.getState().past.length).toBe(before + 1);
  });

  it('moveLayerTo places a layer at an absolute index, clamped, no-op in place', () => {
    useApp.getState().addLayer();
    useApp.getState().addLayer();
    const [a, b, c] = useApp.getState().doc.layers.map((l) => l.id);
    useApp.getState().moveLayerTo(c, 0);
    expect(useApp.getState().doc.layers.map((l) => l.id)).toEqual([c, a, b]);
    const before = useApp.getState().past.length;
    useApp.getState().moveLayerTo(c, 0); // already there — no-op, no history
    expect(useApp.getState().past.length).toBe(before);
    useApp.getState().moveLayerTo(c, 99); // clamps to the top
    expect(useApp.getState().doc.layers.map((l) => l.id)).toEqual([a, b, c]);
  });

  it('removeLayer refuses to drop the last layer and re-targets the active one', () => {
    useApp.getState().removeLayer('layer_1');
    expect(useApp.getState().doc.layers).toHaveLength(1); // refused
    useApp.getState().addLayer();
    const added = useApp.getState().activeLayerId;
    useApp.getState().removeLayer(added);
    expect(useApp.getState().doc.layers).toHaveLength(1);
    expect(useApp.getState().activeLayerId).toBe('layer_1');
  });

  it('updateLayer sets blend mode and visibility discretely, coalesces opacity scrubs', () => {
    useApp.getState().updateLayer('layer_1', { blendMode: 'multiply' });
    useApp.getState().updateLayer('layer_1', { visible: false });
    useApp.getState().updateLayer('layer_1', { opacity: 0.5 });
    useApp.getState().updateLayer('layer_1', { opacity: 0.3 }); // same scrub — coalesces
    const layer = useApp.getState().doc.layers[0];
    expect(layer.blendMode).toBe('multiply');
    expect(layer.visible).toBe(false);
    expect(layer.opacity).toBe(0.3);
    expect(useApp.getState().past).toHaveLength(3);
  });

  it('undoing a layer delete restores it; the active id survives revalidation', () => {
    useApp.getState().addLayer();
    const added = useApp.getState().activeLayerId;
    useApp.getState().removeLayer(added);
    useApp.getState().undo();
    expect(useApp.getState().doc.layers).toHaveLength(2);
    // the active layer had vanished from the restored doc's perspective — it
    // must land on a layer that exists
    const { doc, activeLayerId } = useApp.getState();
    expect(doc.layers.some((l) => l.id === activeLayerId)).toBe(true);
  });

  it('selectLayer switches the editing target without touching history', () => {
    useApp.getState().addLayer();
    const before = useApp.getState().past.length;
    useApp.getState().selectLayer('layer_1');
    expect(useApp.getState().activeLayerId).toBe('layer_1');
    expect(useApp.getState().past.length).toBe(before);
    expect(useApp.getState().revision).toBe(1);
    expect(activeGraph().nodes.text1).toBeDefined();
  });
});
