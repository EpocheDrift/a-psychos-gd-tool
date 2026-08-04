// The node canvas. xyflow renders the document graph; every edit (drag,
// wire, delete) flows back through store actions. wireIsValid gives live
// red/green feedback while dragging a connection.
//
// Figma-style pointer scheme: left-drag draws a marquee that selects every
// node it touches (⌘/shift-click adds to the selection); pan with a
// two-finger trackpad scroll, space+drag, or the middle/right button; pinch
// zooms. Selected nodes move and delete as a group.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Panel,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  useStoreApi,
  useViewport,
  type Connection,
  type Edge as FlowEdge,
  type EdgeChange,
  type Node as FlowNode,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { edgeKey } from '../engine/graph';
import { socketTypes } from '../engine/registry';
import { PALETTE, registry } from '../nodes';
import {
  endGesture,
  previewWireConnection,
  selectActiveGraph,
  useApp,
} from '../store';
import { GfxNode } from './GfxNode';
import type { SocketType } from '../engine/values';
import {
  findNodePlacement,
  type PlacementRect,
} from './nodePlacement';

const nodeTypes = { gfx: GfxNode };

// Node cards are 210px wide (app.css .gfx-node); used to center new nodes.
const NODE_WIDTH = 210;
const NODE_HEIGHT_GUESS = 120;
const NODE_GAP = 24;

// Wire colors — a bright 2000s palette, one unique hue per type, matching the
// socket circle colors in GfxNode.
const WIRE_COLORS: Record<SocketType, string> = {
  text: '#00e5ff', // cyan
  vector: '#00a99d', // teal
  raster: '#1493ff', // azure
  alpha: '#8a2be2', // blue violet
  elements: '#9aa0a6', // grey
  layout: '#ff1493', // hot pink
};

function estimateNodeSize(type: string): { width: number; height: number } {
  const definition = registry.get(type);
  if (!definition) return { width: NODE_WIDTH, height: NODE_HEIGHT_GUESS };
  const socketRows = definition.inputs.length + definition.outputs.length;
  const paramHeight = definition.params.reduce((height, param) => {
    if (param.name === 'content') return height + 78;
    if (param.kind === 'binds') return height + 116;
    return height + 34;
  }, 0);
  return {
    width: NODE_WIDTH,
    height: Math.max(
      NODE_HEIGHT_GUESS,
      42 + socketRows * 22 + paramHeight,
    ),
  };
}

export function NodeEditor() {
  const graph = useApp(selectActiveGraph);
  const selectedNodeIds = useApp((s) => s.selectedNodeIds);
  const activeLayerId = useApp((s) => s.activeLayerId);
  const activeLayerName = useApp(
    (s) => s.doc.layers.find((layer) => layer.id === s.activeLayerId)?.name
      ?? s.activeLayerId,
  );

  const nodes: FlowNode[] = useMemo(
    () =>
      Object.values(graph.nodes).map((n) => {
        const definition = registry.get(n.type);
        const label = definition?.label ?? n.type;
        return {
          id: n.id,
          type: 'gfx',
          position: n.position ?? { x: 0, y: 0 },
          data: {},
          selected: selectedNodeIds.includes(n.id),
          ariaLabel: `${label} node ${n.id} in layer ${activeLayerName} (${activeLayerId})`,
          domAttributes: {
            'data-agent-target': 'node',
            'data-agent-layer-id': activeLayerId,
            'data-agent-node-id': n.id,
            'data-agent-node-type': n.type,
          } as unknown as NonNullable<FlowNode['domAttributes']>,
        };
      }),
    [
      graph.nodes,
      selectedNodeIds,
      activeLayerId,
      activeLayerName,
    ],
  );

  const edges: FlowEdge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const fromDef = registry.get(graph.nodes[e.from.node]?.type ?? '');
        const fromSpec = fromDef?.outputs.find((s) => s.name === e.from.socket);
        const socketType = fromSpec ? socketTypes(fromSpec)[0] : undefined;
        return {
          id: edgeKey(e),
          source: e.from.node,
          sourceHandle: e.from.socket,
          target: e.to.node,
          targetHandle: e.to.socket,
          ariaLabel: `${fromDef?.label ?? graph.nodes[e.from.node]?.type ?? 'Unknown'} ${e.from.node} output ${e.from.socket} to ${graph.nodes[e.to.node]?.type ?? 'Unknown'} ${e.to.node} input ${e.to.socket} in layer ${activeLayerName} (${activeLayerId})`,
          domAttributes: {
            'data-agent-target': 'edge',
            'data-agent-layer-id': activeLayerId,
            'data-agent-source-node-id': e.from.node,
            'data-agent-source-socket': e.from.socket,
            'data-agent-target-node-id': e.to.node,
            'data-agent-target-socket': e.to.socket,
          } as unknown as NonNullable<FlowEdge['domAttributes']>,
          style: socketType ? { stroke: WIRE_COLORS[socketType], strokeWidth: 1.5 } : undefined,
        };
      }),
    [graph, activeLayerId, activeLayerName],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const { moveNodes, removeNodes, select, selectedNodeIds: selected } = useApp.getState();
    const moved: Record<string, { x: number; y: number }> = {};
    const selectChanges = new Map<string, boolean>();
    const removed: string[] = [];
    let dragEnded = false;
    for (const c of changes) {
      if (c.type === 'position') {
        // a group drag emits one change per node in the same batch — collect
        // them so the whole set moves in a single store update / undo step
        if (c.position) moved[c.id] = c.position;
        if (c.dragging === false) dragEnded = true;
      } else if (c.type === 'remove') removed.push(c.id);
      else if (c.type === 'select') selectChanges.set(c.id, c.selected);
    }
    if (Object.keys(moved).length) moveNodes(moved);
    if (removed.length) removeNodes(removed);
    if (selectChanges.size) {
      const next = selected.filter((id) => selectChanges.get(id) !== false);
      for (const [id, on] of selectChanges) if (on && !next.includes(id)) next.push(id);
      select(next);
    }
    // the drop lands inside the drag's undo step; the next drag is its own
    if (dragEnded) endGesture();
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
    if (removed.length) useApp.getState().removeEdges(removed);
  }, []);

  const onConnect = useCallback((conn: Connection) => {
    if (!conn.sourceHandle || !conn.targetHandle) return;
    useApp.getState().connect({
      source: conn.source,
      sourceHandle: conn.sourceHandle,
      target: conn.target,
      targetHandle: conn.targetHandle,
    });
  }, []);

  const isValidConnection = useCallback((conn: Connection | FlowEdge) => {
    if (!conn.sourceHandle || !conn.targetHandle) return false;
    return previewWireConnection(useApp.getState(), {
      source: conn.source,
      sourceHandle: conn.sourceHandle,
      target: conn.target,
      targetHandle: conn.targetHandle,
    }).ok;
  }, []);

  // Cmd/Ctrl+Z undoes, +Shift redoes — skipped while a text field has focus so
  // the browser's own undo keeps working inside param inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) useApp.getState().redo();
      else useApp.getState().undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ReactFlow
      aria-label={`Node graph for layer ${activeLayerName} (${activeLayerId})`}
      data-agent-node-editor
      data-agent-layer-id={activeLayerId}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      deleteKeyCode={['Backspace', 'Delete']}
      // left-drag draws the selection marquee; panning lives on two-finger
      // scroll, held space + drag, and the middle/right button; pinch zooms
      selectionOnDrag
      selectionMode={SelectionMode.Partial}
      multiSelectionKeyCode={['Meta', 'Shift']}
      panOnDrag={[1, 2]}
      panOnScroll
      panActivationKeyCode="Space"
      minZoom={0.1}
      fitView
      proOptions={{ hideAttribution: true }}
      colorMode="light"
    >
      <Background gap={16} size={1} />
      <Palette />
      <ConnectionInspector />
      <ViewportControls />
    </ReactFlow>
  );
}

interface ConnectionNotice {
  sequence: number;
  layerId: string;
  ok: boolean;
  code: string;
  message: string;
  revision: number;
}

function ConnectionInspector() {
  const graph = useApp(selectActiveGraph);
  const layerId = useApp((state) => state.activeLayerId);
  const nodes = Object.values(graph.nodes);
  const sourceNodes = nodes.filter(
    (node) => (registry.get(node.type)?.outputs.length ?? 0) > 0,
  );
  const targetNodes = nodes.filter(
    (node) => (registry.get(node.type)?.inputs.length ?? 0) > 0,
  );
  const [sourceNode, setSourceNode] = useState(sourceNodes[0]?.id ?? '');
  const [sourceSocket, setSourceSocket] = useState('');
  const [targetNode, setTargetNode] = useState(targetNodes[0]?.id ?? '');
  const [targetSocket, setTargetSocket] = useState('');
  const [notice, setNotice] = useState<ConnectionNotice | null>(null);
  const sourceDefinition = registry.get(graph.nodes[sourceNode]?.type ?? '');
  const targetDefinition = registry.get(graph.nodes[targetNode]?.type ?? '');

  useEffect(() => {
    if (!sourceNodes.some((node) => node.id === sourceNode)) {
      setSourceNode(sourceNodes[0]?.id ?? '');
    }
  }, [sourceNodes, sourceNode]);
  useEffect(() => {
    if (!targetNodes.some((node) => node.id === targetNode)) {
      setTargetNode(targetNodes[0]?.id ?? '');
    }
  }, [targetNodes, targetNode]);
  useEffect(() => {
    if (!sourceDefinition?.outputs.some((socket) => socket.name === sourceSocket)) {
      setSourceSocket(sourceDefinition?.outputs[0]?.name ?? '');
    }
  }, [sourceDefinition, sourceSocket]);
  useEffect(() => {
    if (!targetDefinition?.inputs.some((socket) => socket.name === targetSocket)) {
      setTargetSocket(targetDefinition?.inputs[0]?.name ?? '');
    }
  }, [targetDefinition, targetSocket]);

  const incoming = graph.edges.find(
    (edge) => edge.to.node === targetNode && edge.to.socket === targetSocket,
  );
  const announce = (
    result: Omit<ConnectionNotice, 'sequence' | 'layerId'>,
  ) => setNotice((current) => ({
    ...result,
    layerId,
    sequence: (current?.sequence ?? 0) + 1,
  }));
  const visibleNotice = notice?.layerId === layerId ? notice : null;
  const connect = () => {
    if (!sourceNode || !sourceSocket || !targetNode || !targetSocket) {
      announce({
        ok: false,
        code: 'INVALID_ARGUMENT',
        message: 'Choose both endpoint nodes and sockets.',
        revision: useApp.getState().revision,
      });
      return;
    }
    const result = useApp.getState().connect({
      source: sourceNode,
      sourceHandle: sourceSocket,
      target: targetNode,
      targetHandle: targetSocket,
    });
    if (result.ok) {
      announce({
        ok: true,
        code: 'OK',
        message: `Connected ${sourceNode}.${sourceSocket} to ${targetNode}.${targetSocket}.`,
        revision: result.revision,
      });
    } else {
      announce({
        ok: false,
        code: result.error.code,
        message: result.error.message,
        revision: result.revision,
      });
    }
  };
  const disconnect = () => {
    if (!incoming) return;
    useApp.getState().removeEdges([edgeKey(incoming)]);
    announce({
      ok: true,
      code: 'OK',
      message: `Disconnected ${targetNode}.${targetSocket}.`,
      revision: useApp.getState().revision,
    });
  };

  return (
    <Panel
      position="bottom-right"
      className="connection-panel"
      data-agent-fixed-panel="connection"
      data-agent-layer-id={layerId}
    >
      <details>
        <summary
          data-agent-action="toggle-connection-inspector"
          aria-label={`Toggle connection inspector for layer ${layerId}`}
        >
          connections
        </summary>
        <form
          className="connection-form"
          aria-label={`Connect node sockets in layer ${layerId}`}
          data-agent-connection-inspector
          onSubmit={(event) => {
            event.preventDefault();
            connect();
          }}
        >
          <label>
            <span>from node</span>
            <select
              required
              aria-label={`Connection source node in layer ${layerId}`}
              data-agent-connection-field="source-node"
              value={sourceNode}
              onChange={(event) => setSourceNode(event.target.value)}
            >
              {sourceNodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {registry.get(node.type)?.label ?? node.type} ({node.id})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>from socket</span>
            <select
              required
              aria-label={`Connection source socket on ${sourceNode} in layer ${layerId}`}
              data-agent-connection-field="source-socket"
              value={sourceSocket}
              onChange={(event) => setSourceSocket(event.target.value)}
            >
              {(sourceDefinition?.outputs ?? []).map((socket) => (
                <option key={socket.name} value={socket.name}>
                  {socket.name} ({socketTypes(socket).join(' | ')})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>to node</span>
            <select
              required
              aria-label={`Connection target node in layer ${layerId}`}
              data-agent-connection-field="target-node"
              value={targetNode}
              onChange={(event) => setTargetNode(event.target.value)}
            >
              {targetNodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {registry.get(node.type)?.label ?? node.type} ({node.id})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>to socket</span>
            <select
              required
              aria-label={`Connection target socket on ${targetNode} in layer ${layerId}`}
              data-agent-connection-field="target-socket"
              value={targetSocket}
              onChange={(event) => setTargetSocket(event.target.value)}
            >
              {(targetDefinition?.inputs ?? []).map((socket) => (
                <option key={socket.name} value={socket.name}>
                  {socket.name} ({socketTypes(socket).join(' | ')})
                </option>
              ))}
            </select>
          </label>
          <div className="connection-actions">
            <button
              type="submit"
              data-agent-action="connect-sockets"
              data-agent-layer-id={layerId}
            >
              connect
            </button>
            <button
              type="button"
              data-agent-action="disconnect-socket"
              data-agent-layer-id={layerId}
              disabled={!incoming}
              onClick={disconnect}
            >
              disconnect target
            </button>
          </div>
        </form>
      </details>
      <div
        className="connection-status"
        role={visibleNotice?.ok === false ? 'alert' : 'status'}
        aria-live={visibleNotice?.ok === false ? 'assertive' : 'polite'}
        aria-atomic="true"
        data-agent-connection-status
        data-agent-connection-sequence={visibleNotice?.sequence ?? 0}
        data-agent-connection-code={visibleNotice?.code ?? 'IDLE'}
        data-agent-revision={visibleNotice?.revision ?? useApp.getState().revision}
      >
        {visibleNotice?.message ?? 'Connection inspector ready.'}
      </div>
    </Panel>
  );
}

function ViewportControls() {
  const { fitView, setViewport } = useReactFlow();
  const viewport = useViewport();
  const pan = (x: number, y: number) => {
    void setViewport({
      x: viewport.x + x,
      y: viewport.y + y,
      zoom: viewport.zoom,
    });
  };
  const zoom = (factor: number) => {
    void setViewport({
      ...viewport,
      zoom: Math.max(0.1, Math.min(2, viewport.zoom * factor)),
    });
  };

  return (
    <Panel
      position="bottom-left"
      className="viewport-controls"
      aria-label="Node viewport controls"
      data-agent-fixed-panel="viewport-controls"
      data-agent-viewport-state
      data-agent-viewport-x={viewport.x}
      data-agent-viewport-y={viewport.y}
      data-agent-viewport-zoom={viewport.zoom}
    >
      <button
        type="button"
        aria-label="Zoom node viewport out"
        data-agent-action="zoom-viewport-out"
        onClick={() => zoom(1 / 1.2)}
      >
        −
      </button>
      <button
        type="button"
        aria-label="Fit all nodes in viewport"
        data-agent-action="fit-node-viewport"
        onClick={() => void fitView()}
      >
        fit
      </button>
      <button
        type="button"
        aria-label="Zoom node viewport in"
        data-agent-action="zoom-viewport-in"
        onClick={() => zoom(1.2)}
      >
        +
      </button>
      {[
        ['left', '←', -64, 0],
        ['up', '↑', 0, 64],
        ['down', '↓', 0, -64],
        ['right', '→', 64, 0],
      ].map(([direction, label, x, y]) => (
        <button
          key={String(direction)}
          type="button"
          aria-label={`Pan node viewport ${direction}`}
          data-agent-action={`pan-viewport-${direction}`}
          onClick={() => pan(Number(x), Number(y))}
        >
          {label}
        </button>
      ))}
    </Panel>
  );
}

// The add-node palette. Lives inside <ReactFlow> so it can read the current
// viewport and drop new nodes at the center of the visible pane.
function Palette() {
  const { getViewport, screenToFlowPosition } = useReactFlow();
  const flowStore = useStoreApi();

  const addNode = (type: string) => {
    const { width, height } = flowStore.getState();
    const { x, y, zoom } = getViewport();
    // center of the visible pane in flow coordinates
    const cx = (width / 2 - x) / zoom - NODE_WIDTH / 2;
    const cy = (height / 2 - y) / zoom - NODE_HEIGHT_GUESS / 2;
    const state = useApp.getState();
    const graph = selectActiveGraph(state);
    const activeLayerId = state.activeLayerId;
    const measured = new Map<string, PlacementRect>();
    for (
      const element of document.querySelectorAll<HTMLElement>(
        '[data-agent-target="node"]',
      )
    ) {
      if (element.dataset.agentLayerId !== activeLayerId) continue;
      const id = element.dataset.agentNodeId;
      if (!id) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const topLeft = screenToFlowPosition({ x: rect.left, y: rect.top });
      const bottomRight = screenToFlowPosition({
        x: rect.right,
        y: rect.bottom,
      });
      measured.set(id, {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      });
    }
    const occupied = Object.values(graph.nodes).map((node) => {
      const exact = measured.get(node.id);
      if (exact) return exact;
      return {
        ...(node.position ?? { x: 0, y: 0 }),
        ...estimateNodeSize(node.type),
      };
    });
    const blocked: PlacementRect[] = [];
    for (
      const element of document.querySelectorAll<HTMLElement>(
        '[data-agent-fixed-panel]',
      )
    ) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const topLeft = screenToFlowPosition({ x: rect.left, y: rect.top });
      const bottomRight = screenToFlowPosition({
        x: rect.right,
        y: rect.bottom,
      });
      blocked.push({
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      });
    }
    const size = estimateNodeSize(type);
    const position = findNodePlacement({
      preferred: { x: cx, y: cy },
      size,
      occupied,
      blocked,
      gap: NODE_GAP,
    });
    useApp.getState().addNode(type, position);
  };

  return (
    <Panel
      position="top-left"
      className="palette"
      data-agent-fixed-panel="palette"
    >
      <h1 className="editor-title">
        a-psychos-gd-tool
        <a
          className="github-link"
          href="https://github.com/EpocheDrift/a-psychos-gd-tool"
          target="_blank"
          rel="noreferrer"
          title="view this distribution on GitHub"
          aria-label="view this distribution on GitHub"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        </a>
      </h1>
      {PALETTE.map(({ category, nodes }) => (
        <details
          key={category}
          className="palette-group"
          data-agent-palette-category={category}
        >
          <summary
            className="palette-heading"
            data-agent-action="toggle-palette-category"
            data-agent-category={category}
          >
            {category}
          </summary>
          <div className="palette-buttons">
            {nodes.map((def) => (
              <button
                key={def.type}
                type="button"
                aria-label={`Add ${def.label ?? def.type} node`}
                data-agent-action="add-node"
                data-agent-node-type={def.type}
                onClick={() => addNode(def.type)}
              >
                + {def.label ?? def.type}
              </button>
            ))}
          </div>
        </details>
      ))}
    </Panel>
  );
}
