// Shell: node editor (left, showing the active layer's graph) and the poster
// viewport presenting the composited layer stack (right). A top bar holds the
// frame config, a floating panel the layer stack, and a collapsible cook log.
// Node parameters are edited inline on each node. Any document edit synchronously
// schedules an exact revision ticket; cooking remains serialized offscreen.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as opentype from 'opentype.js';
import type { Font } from 'opentype.js';
import { Evaluator } from './engine/evaluator';
import { socketTypes, type CookContext } from './engine/registry';
import type { Placement } from './engine/values';
import { GpuContext } from './gpu/device';
import { registry } from './nodes';
import { NodeEditor } from './editor/NodeEditor';
import { LayersPanel } from './editor/LayersPanel';
import { loadLocalFontsIfGranted, selectActiveGraph, useApp } from './store';
import {
  appRenderCoordinator,
  configureAppRenderer,
  currentArtifactTicket,
  getDisplayedCanvasIndex,
  getAppRenderStatus,
  readbackExact,
  setRenderCanvases,
  startRenderStoreBinding,
  stopRenderStoreBinding,
} from './render/appRenderService';
import './render/preview';
import type {
  CookEventSummary,
  RenderStatus,
} from './domain/renderCoordinator';
import { DEFAULT_AGENT_LIMITS } from './domain/limits';
import { maximumProjectImportJsonBytes } from './domain/projectCodec';
import {
  getStarterProject,
  STARTER_PROJECTS,
} from './starterProjects';

const FONT_URLS = ['/fonts/Inter-Regular.otf', '/fonts/JetBrainsMono-Regular.ttf', '/fonts/local-fallback.ttf'];
const AGENT_MODE = __GFX_AGENT_BUILD__;

// only show the loading overlay once a cook has run this long — keeps quick
// re-cooks (most param tweaks) from flashing it
const PENDING_DELAY_MS = 250;

const FRAME_PRESETS: { label: string; width: number; height: number }[] = [
  { label: 'Phone — 2304×3456', width: 2304, height: 3456 },
  { label: 'Square — 2048×2048', width: 2048, height: 2048 },
  { label: 'HD — 1920×1080', width: 1920, height: 1080 },
  { label: '4K — 3840×2160', width: 3840, height: 2160 },
  { label: 'A4 300dpi — 2480×3508', width: 2480, height: 3508 },
  { label: 'Portrait — 1080×1350', width: 1080, height: 1350 },
];

async function loadFirstFont(): Promise<Font | null> {
  for (const url of FONT_URLS) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      return opentype.parse(await res.arrayBuffer());
    } catch {
      // try the next candidate
    }
  }
  return null;
}

type Status = 'booting' | 'ready' | 'no-webgpu' | 'no-font';

export default function App() {
  const doc = useApp((s) => s.doc);
  const activeGraph = useApp(selectActiveGraph);
  const selectedNodeIds = useApp((s) => s.selectedNodeIds);
  // the layout guide only makes sense for one node — hide it for a marquee'd group
  const selectedNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
  const fonts = useApp((s) => s.fonts);
  const revision = useApp((s) => s.revision);
  const localFonts = useApp((s) => s.localFonts);
  const setFrame = useApp((s) => s.setFrame);
  const startupLoadIssue = useApp((s) => s.startupLoadIssue);
  const persistenceValidationReport = useApp((s) => s.persistenceValidationReport);

  const [status, setStatus] = useState<Status>('booting');
  const [renderStatus, setRenderStatus] = useState<RenderStatus>(
    getAppRenderStatus,
  );
  const [displayedCanvasIndex, setDisplayedCanvasIndex] = useState<0 | 1 | null>(
    getDisplayedCanvasIndex,
  );
  const [events, setEvents] = useState<CookEventSummary[]>(
    () => getAppRenderStatus().events ?? [],
  );
  const [poolStats, setPoolStats] = useState({ allocated: 0, free: 0, live: 0 });
  const [cookError, setCookError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [projectIoBusy, setProjectIoBusy] =
    useState<'save' | 'load' | null>(null);
  const [projectIoMessage, setProjectIoMessage] = useState<{
    kind: 'error' | 'success';
    text: string;
  } | null>(null);
  const [guide, setGuide] = useState<{
    placements: Placement[];
    /** generator's coverage rect (Random's area params), artboard-centered */
    area?: { width: number; height: number };
  } | null>(null);

  const canvasARef = useRef<HTMLCanvasElement>(null);
  const canvasBRef = useRef<HTMLCanvasElement>(null);
  const guideRef = useRef<HTMLCanvasElement>(null);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const gpuRef = useRef<GpuContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!AGENT_MODE) {
      loadLocalFontsIfGranted(); // fire-and-forget; boot doesn't wait on the list
    }
    (async () => {
      const gpu = await GpuContext.init();
      if (cancelled) {
        gpu?.dispose();
        return;
      }
      if (!gpu) { setStatus('no-webgpu'); return; }
      const font = await loadFirstFont();
      if (cancelled) {
        gpu.dispose();
        return;
      }
      if (!font) {
        gpu.dispose();
        setStatus('no-font');
        return;
      }
      gpuRef.current = gpu;
      useApp.getState().addFont('default', font);
      const bundledFamily = font.getEnglishName('fontFamily')?.trim();
      if (bundledFamily && bundledFamily !== 'default') {
        // Keep the historical "default" key while exposing the bundled
        // family's real name as a deterministic keyboard-selectable option.
        useApp.getState().addFont(bundledFamily, font);
      }
      setStatus('ready');
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => appRenderCoordinator.subscribe((next) => {
    setRenderStatus(next);
    setDisplayedCanvasIndex(getDisplayedCanvasIndex());
    if (next.events) setEvents(next.events);
    const gpu = gpuRef.current;
    if (gpu && (
      next.state === 'complete'
      || next.state === 'failed'
      || next.state === 'superseded'
    )) {
      setPoolStats(gpu.pool.stats());
    }
    if (next.state === 'failed') {
      setCookError(next.error?.message ?? 'Render failed.');
    } else if (next.state === 'complete') {
      setCookError(null);
    }
  }), []);

  useEffect(() => {
    if (status !== 'ready') return;
    const gpu = gpuRef.current;
    const canvasA = canvasARef.current;
    const canvasB = canvasBRef.current;
    if (!gpu || !canvasA || !canvasB) return;
    setRenderCanvases([canvasA, canvasB]);
    const cleanupRenderer = configureAppRenderer(gpu, {
      onDeviceLost: (error) => {
        setCookError(error.message);
        setStatus('no-webgpu');
      },
    });
    startRenderStoreBinding();
    return () => {
      stopRenderStoreBinding();
      const drained = cleanupRenderer();
      const finalize = () => {
        setRenderCanvases(null);
        if (gpuRef.current === gpu) gpuRef.current = null;
        gpu.dispose();
      };
      void drained.then(
        (tornDown) => {
          if (tornDown) finalize();
        },
        (error) => {
          console.error('Renderer cleanup failed', error);
          // Device disposal is still required when evaluator/worker cleanup
          // throws; leaving it live would retain the whole GPU generation.
          finalize();
        },
      );
    };
  }, [status]);

  useEffect(() => {
    if (
      renderStatus.state !== 'queued'
      && renderStatus.state !== 'cooking'
    ) {
      setPending(false);
      return;
    }
    const timer = setTimeout(() => setPending(true), PENDING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [renderStatus.state, renderStatus.ticket?.revision, renderStatus.ticket?.attempt]);

  // Export leases one exact GPU-complete artifact; it never re-renders or
  // silently follows a newer document revision.
  const exportPng = useCallback(async () => {
    setExporting(true);
    try {
      const ticket = currentArtifactTicket();
      const currentRevision = useApp.getState().revision;
      if (!ticket || ticket.revision !== currentRevision) {
        throw new Error('The current document revision has not finished rendering.');
      }
      const image = await readbackExact(ticket);
      if (useApp.getState().revision !== ticket.revision) {
        throw new Error(
          `Render revision ${ticket.revision} was superseded before export completed.`,
        );
      }
      const off = document.createElement('canvas');
      off.width = image.width;
      off.height = image.height;
      off.getContext('2d')!.putImageData(image, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => off.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG encoding failed');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `poster-r${ticket.revision}-a${ticket.attempt}-${image.width}x${image.height}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setCookError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }, []);

  const saveProject = useCallback(async () => {
    setProjectIoBusy('save');
    setProjectIoMessage(null);
    try {
      const result = await useApp.getState().exportPortableProjectJson();
      if (!result.ok) {
        throw new Error(
          result.report.errors[0]?.message
            ?? 'Portable project export failed validation.',
        );
      }
      const blob = new Blob([result.json], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeDocumentId = result.project.documentId
        .replace(/[^A-Za-z0-9_-]+/g, '_')
        .slice(0, 80) || 'project';
      link.href = url;
      link.download = `${safeDocumentId}.gfxproject.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setProjectIoMessage({
        kind: 'success',
        text: 'Portable project saved with its image assets.',
      });
    } catch (error) {
      setProjectIoMessage({
        kind: 'error',
        text: error instanceof Error
          ? error.message
          : 'Portable project export failed.',
      });
    } finally {
      setProjectIoBusy(null);
    }
  }, []);

  const loadProject = useCallback(async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const expectedRevision = useApp.getState().revision;
    setProjectIoBusy('load');
    setProjectIoMessage(null);
    try {
      const maximumBytes = maximumProjectImportJsonBytes();
      if (file.size > maximumBytes) {
        throw new Error(
          `Project file exceeds the ${maximumBytes}-byte import limit.`,
        );
      }
      const result = await useApp.getState().importProjectJson(
        await file.text(),
        undefined,
        expectedRevision,
      );
      if (!result.ok) {
        throw new Error(
          result.report.errors[0]?.message
            ?? 'Project file failed validation.',
        );
      }
      setProjectIoMessage({
        kind: 'success',
        text: 'Project loaded successfully.',
      });
    } catch (error) {
      setProjectIoMessage({
        kind: 'error',
        text: error instanceof Error
          ? error.message
          : 'Project file could not be loaded.',
      });
    } finally {
      setProjectIoBusy(null);
    }
  }, []);

  const loadStarterProject = useCallback(async (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const select = event.currentTarget;
    const starter = getStarterProject(select.value);
    select.value = '';
    if (!starter) return;
    const confirmed = window.confirm(
      `Start from "${starter.label}"? This replaces the current project. `
      + 'Save the current project first if you want to keep it.',
    );
    if (!confirmed) return;

    const expectedRevision = useApp.getState().revision;
    setProjectIoBusy('load');
    setProjectIoMessage(null);
    try {
      const result = await useApp.getState().importProjectJson(
        JSON.stringify(starter.document),
        starter.documentId,
        expectedRevision,
      );
      if (!result.ok) {
        throw new Error(
          result.report.errors[0]?.message
            ?? 'Starter project failed validation.',
        );
      }
      setProjectIoMessage({
        kind: 'success',
        text: `${starter.label} loaded.`,
      });
    } catch (error) {
      setProjectIoMessage({
        kind: 'error',
        text: error instanceof Error
          ? error.message
          : 'Starter project could not be loaded.',
      });
    } finally {
      setProjectIoBusy(null);
    }
  }, []);

  // Parse any local font a Text node (on any layer) references but that isn't
  // loaded yet; addFont then bumps `fonts`, which re-cooks via the effect
  // above. Also runs when `localFonts` arrives so a saved document's fonts
  // load right at startup.
  useEffect(() => {
    if (AGENT_MODE) return;
    const { fonts: loaded, loadLocalFont } = useApp.getState();
    for (const layer of doc.layers) {
      for (const node of Object.values(layer.graph.nodes)) {
        if (node.type !== 'Text') continue;
        const key = String(node.params.font ?? 'default');
        if (key !== 'default' && !loaded[key]) loadLocalFont(key);
      }
    }
  }, [doc, fonts, localFonts]);

  // Selecting a node that produces a layout shows its placements as a guide
  // over the artboard. Cooked with a throwaway CPU-only evaluator so the main
  // cook cache is untouched; chains that need the GPU just skip the guide.
  useEffect(() => {
    const node = selectedNodeId ? activeGraph.nodes[selectedNodeId] : null;
    const def = node ? registry.get(node.type) : null;
    const layoutSocket = def?.outputs.find((s) => socketTypes(s).includes('layout'));
    if (status !== 'ready' || !node || !layoutSocket) {
      setGuide(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const ctx: CookContext = {
          gpu: null,
          fonts: new Map(Object.entries(useApp.getState().fonts)),
          frame: doc.frame,
          signal: controller.signal,
          deadline: performance.now() + 2_000,
          maxPendingWorkerRequests: 1,
          maxPendingWorkerBytes: 16 * 1024 * 1024,
          maxVectorPaths: Math.min(
            DEFAULT_AGENT_LIMITS.maxVectorPaths,
            50_000,
          ),
          maxVectorCommands: Math.min(
            DEFAULT_AGENT_LIMITS.maxVectorCommands,
            100_000,
          ),
          maxCanvasPaintPaths: Math.min(
            DEFAULT_AGENT_LIMITS.maxCanvasPaintPaths,
            2_000,
          ),
          maxCanvasPaintCommands: Math.min(
            DEFAULT_AGENT_LIMITS.maxCanvasPaintCommands,
            10_000,
          ),
          maxFlattenedPoints: Math.min(
            DEFAULT_AGENT_LIMITS.maxFlattenedPoints,
            100_000,
          ),
          maxBooleanPoints: Math.min(
            DEFAULT_AGENT_LIMITS.maxBooleanPoints,
            5_000,
          ),
          maxGeometryWorkUnits: Math.min(
            DEFAULT_AGENT_LIMITS.maxGeometryWorkUnits,
            500_000,
          ),
          maxRenderableGlyphs: Math.min(
            DEFAULT_AGENT_LIMITS.maxRenderableGlyphs,
            4_096,
          ),
          maxGeneratedItems: Math.min(
            DEFAULT_AGENT_LIMITS.maxGeneratedItems,
            5_000,
          ),
        };
        const result = await new Evaluator(registry).evaluate(activeGraph, node.id, ctx);
        const value = result.outputs[layoutSocket.name];
        // a generating Random (no upstream layout) also shows the area its
        // points are drawn from — params fall back to the def's defaults
        const generates = node.type === 'Random'
          && !activeGraph.edges.some((e) => e.to.node === node.id && e.to.socket === 'layout');
        const area = generates
          ? {
              width: Number(node.params.areaWidth ?? 600),
              height: Number(node.params.areaHeight ?? 400),
            }
          : undefined;
        if (!cancelled) setGuide(value?.kind === 'layout' ? { placements: value.placements, area } : null);
      } catch {
        if (!cancelled) setGuide(null); // half-wired or GPU-dependent chain — no guide
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [doc.frame, activeGraph, selectedNodeId, status]);

  // draw the guide, artboard-centered: placements with cell extents (Grid) draw
  // their actual rect; point placements keep the circle + rotation tick marker
  useEffect(() => {
    const canvas = guideRef.current;
    if (!canvas || !guide) return;
    const { width, height } = doc.frame;
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext('2d')!;
    c.clearRect(0, 0, width, height);
    c.strokeStyle = '#ff1493'; // layout socket color
    c.fillStyle = '#ff1493';
    c.lineWidth = Math.max(1, width / 512);
    if (guide.area) {
      // the generator's coverage rect, dashed so it reads as a bound, not a cell
      c.save();
      c.setLineDash([c.lineWidth * 6, c.lineWidth * 4]);
      c.strokeRect(
        width / 2 - guide.area.width / 2,
        height / 2 - guide.area.height / 2,
        guide.area.width,
        guide.area.height,
      );
      c.restore();
    }
    for (const p of guide.placements) {
      const x = width / 2 + p.x;
      const y = height / 2 + p.y;
      if (p.w != null && p.h != null) {
        c.save();
        c.translate(x, y);
        c.rotate(p.rotation);
        c.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
        c.restore();
        c.beginPath();
        c.arc(x, y, c.lineWidth * 1.5, 0, Math.PI * 2);
        c.fill();
        continue;
      }
      const r = 7 * p.scale;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(p.rotation) * r * 2, y + Math.sin(p.rotation) * r * 2);
      c.stroke();
      c.beginPath();
      c.arc(x, y, c.lineWidth, 0, Math.PI * 2);
      c.fill();
    }
  }, [guide, doc.frame]);

  if (status === 'no-webgpu') {
    return (
      <div className="boot-msg" role="alert">
        {cookError
          ? `WebGPU rendering stopped: ${cookError}`
          : 'WebGPU is not available in this browser. Try Chrome/Edge 113+, or Safari 18+.'}
      </div>
    );
  }
  if (status === 'no-font') return <div className="boot-msg">No font found — run <code>scripts/get-font.sh</code> to fetch one into <code>public/fonts/</code>.</div>;

  const frame = doc.frame;
  const displayedTicket = renderStatus.displayedTicket;
  const exactCurrentRender = renderStatus.state === 'complete'
    && renderStatus.ticket?.revision === revision
    && displayedTicket?.revision === revision
    && displayedTicket.attempt === renderStatus.ticket?.attempt;
  const renderStatusText = `Render ${renderStatus.state}; document revision ${
    revision
  }; requested ${
    renderStatus.ticket
      ? `revision ${renderStatus.ticket.revision}, attempt ${renderStatus.ticket.attempt}`
      : 'none'
  }; displayed ${
    displayedTicket
      ? `revision ${displayedTicket.revision}, attempt ${displayedTicket.attempt}`
      : 'none'
  }.`;
  const displayedStatus = displayedTicket
    ? appRenderCoordinator.getRenderStatus(displayedTicket)
    : null;
  const displayedDimensions = displayedStatus?.width && displayedStatus.height
    ? `${displayedStatus.width} by ${displayedStatus.height} pixels`
    : null;

  return (
    <div className="app">
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-agent-render-status
        data-agent-render-state={renderStatus.state}
        data-agent-document-revision={revision}
        data-agent-render-revision={renderStatus.ticket?.revision ?? ''}
        data-agent-render-attempt={renderStatus.ticket?.attempt ?? ''}
        data-agent-displayed-revision={displayedTicket?.revision ?? ''}
        data-agent-displayed-attempt={displayedTicket?.attempt ?? ''}
      >
        {renderStatusText}
      </div>
      {cookError && (
        <div
          className="render-alert"
          role="alert"
          data-agent-fixed-panel="render-error"
          data-agent-render-error
          data-agent-error-code={renderStatus.error?.code ?? 'RENDER_FAILED'}
          data-agent-error-layer-id={renderStatus.error?.layerId ?? ''}
          data-agent-error-node-id={renderStatus.error?.nodeId ?? ''}
          data-agent-error-phase={renderStatus.error?.phase ?? ''}
        >
          {cookError}
        </div>
      )}
      {projectIoMessage && (
        <div
          className={`project-io-message ${projectIoMessage.kind}`}
          role={projectIoMessage.kind === 'error' ? 'alert' : 'status'}
          data-project-file-status={projectIoMessage.kind}
        >
          {projectIoMessage.text}
        </div>
      )}
      {startupLoadIssue && (
        <div
          className="startup-load-warning"
          role="alert"
          data-agent-fixed-panel="startup-warning"
        >
          Saved project data in <code>{startupLoadIssue.storageKey}</code> could not be loaded
          safely
          {startupLoadIssue.report.errors[0]
            ? ` (${startupLoadIssue.report.errors[0].code} at ${startupLoadIssue.report.errors[0].path || '/'})`
            : ''}
          . The saved value was left untouched and a blank project is shown.
          Autosave is paused until a valid project is explicitly imported.
        </div>
      )}
      {!startupLoadIssue && persistenceValidationReport && (
        <div
          className="persistence-warning"
          role="alert"
          data-agent-fixed-panel="persistence-warning"
        >
          {persistenceValidationReport.errors[0]?.code === 'PERSISTENCE_FAILED'
            ? 'Autosave failed because browser storage rejected the save. Export the project now, then free browser storage or remove large embedded images.'
            : `Autosave is paused${
              persistenceValidationReport.errors[0]
                ? `: ${persistenceValidationReport.errors[0].code} at ${
                  persistenceValidationReport.errors[0].path || '/'
                }`
                : ''
            }. Fix the invalid value to resume.`}
          {' '}The current edit remains in memory.
        </div>
      )}
      <div className="editor">
        <NodeEditor />
        <LayersPanel />
      </div>
      <div className="viewport">
        <div className="frame-config" data-agent-fixed-panel="frame">
          <div className="preset-icons">
            {FRAME_PRESETS.map((p) => {
              const ar = p.width / p.height;
              const w = ar >= 1 ? 22 : Math.round(22 * ar);
              const h = ar >= 1 ? Math.round(22 / ar) : 22;
              return { ...p, w, h };
            })
              .sort((a, b) => a.h - b.h || a.w - b.w)
              .map((p) => {
                const active = p.width === frame.width && p.height === frame.height;
                return (
                  <button
                    key={p.label}
                    type="button"
                    aria-label={`Set frame to ${p.label}`}
                    data-agent-action="set-frame-preset"
                    data-agent-frame-width={p.width}
                    data-agent-frame-height={p.height}
                    className={`preset-icon${active ? ' active' : ''}`}
                    onClick={() => setFrame({ width: p.width, height: p.height })}
                  >
                    <span className="preset-glyph" style={{ width: p.w, height: p.h }} />
                  </button>
                );
              })}
          </div>
          <label className="param inline">
            <span>w</span>
            <input
              type="number"
              aria-label="Frame width"
              data-agent-target="frame-control"
              data-agent-frame-control="width"
              min={16}
              max={4096}
              value={frame.width}
              onChange={(e) => setFrame({ ...frame, width: Number(e.target.value) })}
            />
          </label>
          <button
            type="button"
            className="swap-btn"
            aria-label="Swap frame width and height"
            data-agent-action="swap-frame-dimensions"
            onClick={() => setFrame({ width: frame.height, height: frame.width })}
          >
            ⇄
          </button>
          <label className="param inline">
            <span>h</span>
            <input
              type="number"
              aria-label="Frame height"
              data-agent-target="frame-control"
              data-agent-frame-control="height"
              min={16}
              max={4096}
              value={frame.height}
              onChange={(e) => setFrame({ ...frame, height: Number(e.target.value) })}
            />
          </label>
          <button
            type="button"
            className="export-btn"
            aria-label="Save a portable project file with image assets"
            disabled={projectIoBusy !== null}
            onClick={saveProject}
          >
            {projectIoBusy === 'save' ? 'saving…' : 'save project'}
          </button>
          <button
            type="button"
            className="export-btn"
            aria-label="Load a project file"
            disabled={projectIoBusy !== null}
            onClick={() => projectFileRef.current?.click()}
          >
            {projectIoBusy === 'load' ? 'loading…' : 'load project'}
          </button>
          <select
            className="project-starter-select"
            aria-label="Start from a blank project or bundled example"
            data-project-action="load-starter"
            defaultValue=""
            disabled={projectIoBusy !== null}
            onChange={loadStarterProject}
          >
            <option value="" disabled>start from…</option>
            {STARTER_PROJECTS.map((starter) => (
              <option
                key={starter.id}
                value={starter.id}
                data-starter-project-id={starter.id}
              >
                {starter.label}
              </option>
            ))}
          </select>
          <input
            ref={projectFileRef}
            className="sr-only"
            type="file"
            accept=".gfxproject.json,.json,application/json"
            aria-label="Choose a project file to load"
            onChange={loadProject}
          />
          <button
            type="button"
            className="export-btn"
            aria-label="Download the current exact poster as PNG"
            data-agent-action="export-png"
            disabled={status !== 'ready' || exporting || !exactCurrentRender}
            onClick={exportPng}
          >
            {exporting ? 'exporting…' : 'export png'}
          </button>
        </div>
        <div className="stage" data-agent-stage>
          {status === 'booting' ? (
            <div className="boot-msg">initializing WebGPU…</div>
          ) : (
            <>
              {([0, 1] as const).map((index) => (
                <canvas
                  key={index}
                  ref={index === 0 ? canvasARef : canvasBRef}
                  hidden={displayedCanvasIndex !== index}
                  role={displayedCanvasIndex === index ? 'img' : undefined}
                  aria-hidden={displayedCanvasIndex === index ? undefined : true}
                  aria-label={
                    displayedCanvasIndex === index && displayedTicket
                      ? `Rendered poster revision ${displayedTicket.revision}, attempt ${displayedTicket.attempt}${
                          displayedDimensions ? `, ${displayedDimensions}` : ''
                        }`
                      : undefined
                  }
                  data-agent-preview={
                    displayedCanvasIndex === index ? 'main' : undefined
                  }
                  data-agent-document-revision={
                    displayedCanvasIndex === index ? revision : undefined
                  }
                  data-agent-render-revision={
                    displayedCanvasIndex === index
                      ? displayedTicket?.revision ?? ''
                      : undefined
                  }
                  data-agent-render-attempt={
                    displayedCanvasIndex === index
                      ? displayedTicket?.attempt ?? ''
                      : undefined
                  }
                  data-agent-render-state={
                    displayedCanvasIndex === index
                      ? 'complete'
                      : undefined
                  }
                />
              ))}
              {guide && (
                <canvas
                  ref={guideRef}
                  className="guide-overlay"
                  role="presentation"
                  aria-hidden="true"
                  data-agent-guide="layout"
                />
              )}
              {pending && (
                <div
                  className="cook-pending"
                  aria-hidden="true"
                  data-agent-render-spinner
                />
              )}
            </>
          )}
        </div>
      </div>
      <details className="cook-log" data-agent-fixed-panel="cook-log">
        <summary>
          cook log
          <span className="pool" data-agent-pool-status>
            pool: {poolStats.live} live / {poolStats.allocated} allocated
          </span>
          <span className="render-revision">
            document r{revision} / displayed {displayedTicket ? `r${displayedTicket.revision}a${displayedTicket.attempt}` : 'none'}
          </span>
          {cookError && <span className="cook-error-dot" title={cookError}>●</span>}
        </summary>
        <div className="cook-log-body">
          {cookError && <div className="cook-error">{cookError}</div>}
          <ul>
            {events.map((e, i) => (
              <li
                key={`${e.revision}:${e.attempt}:${e.layerId}:${e.nodeId}:${i}`}
                className={e.status}
                data-agent-cook-event
                data-agent-cook-status={e.status}
                data-agent-cook-node-type={e.type}
                data-agent-layer-id={e.layerId}
                data-agent-node-id={e.nodeId}
                data-agent-render-revision={e.revision}
                data-agent-render-attempt={e.attempt}
              >
                <span className="badge">{e.status.toUpperCase()}</span>
                <span className="ev-node">{e.type}</span>
                <span className="ev-id">{e.nodeId}</span>
                <span className="ev-revision">r{e.revision}a{e.attempt} · {e.layerId}</span>
                <span className="ev-ms">{e.status === 'miss' ? `${e.ms.toFixed(1)}ms` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}
