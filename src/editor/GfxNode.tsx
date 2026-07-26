// Custom xyflow node: title bar + one row per socket, handles colored by
// SocketType so the type ladder is visible on the canvas itself. Parameters
// are edited inline, right on the node.

import { useEffect, useId, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { socketTypes, type ParamSpec, type SocketSpec } from '../engine/registry';
import type { ParamValue } from '../engine/graph';
import type { SocketType } from '../engine/values';
import { registry } from '../nodes';
import { BIND_TARGETS, parseBinds, type BindSpec } from '../nodes/elements';
import { DEFAULT_AGENT_LIMITS } from '../domain/limits';
import { validateImageSource } from '../domain/paramCodecs';
import { getParamPublicMetadata } from '../domain/publicNodeMetadata';
import { endGesture, localFontsSupported, selectActiveGraph, useApp } from '../store';

// Type ladder colors — a bright 2000s computer palette, one unique hue per type,
// matching the wire colors. Sockets (the circles) and the wires that leave them
// read as the same color.
export const SOCKET_COLORS: Record<SocketType, string> = {
  text: '#00e5ff', // cyan
  vector: '#00a99d', // teal
  raster: '#1493ff', // azure
  alpha: '#8a2be2', // blue violet
  elements: '#9aa0a6', // grey
  layout: '#ff1493', // hot pink
};

/** single type → its color; union input → neutral (accepts several) */
function socketColor(spec: SocketSpec): string {
  const types = socketTypes(spec);
  return types.length === 1 ? SOCKET_COLORS[types[0]] : '#a8a8a8';
}

function socketTitle(spec: SocketSpec): string {
  return `${spec.name}: ${socketTypes(spec).join(' | ')}${spec.optional ? ' (optional)' : ''}`;
}

export function GfxNode({ id }: NodeProps) {
  const node = useApp((s) => selectActiveGraph(s).nodes[id]);
  const activeLayerId = useApp((s) => s.activeLayerId);
  const activeLayerName = useApp(
    (s) => s.doc.layers.find((layer) => layer.id === s.activeLayerId)?.name
      ?? s.activeLayerId,
  );
  const setParam = useApp((s) => s.setParam);
  const removeNodes = useApp((s) => s.removeNodes);
  if (!node) return null;
  const def = registry.get(node.type);
  if (!def) return <div className="gfx-node">unknown: {node.type}</div>;

  // a param's effective value (instance value, else its def default)
  const paramVal = (name: string) =>
    node.params[name] ?? def.params.find((p) => p.name === name)?.default;
  // hide params gated behind a showIf whose controlling param isn't a match
  const visibleParams = def.params.filter(
    (p) => !p.showIf || p.showIf.in.includes(String(paramVal(p.showIf.param))),
  );
  const context: AgentParamContext = {
    layerId: activeLayerId,
    layerName: activeLayerName,
    nodeId: node.id,
    nodeType: node.type,
    nodeLabel: def.label ?? node.type,
  };

  return (
    <div
      className="gfx-node"
      data-agent-node-content={node.id}
      data-agent-layer-id={activeLayerId}
    >
      <div className="gfx-title">
        <span>{def.label ?? node.type}</span>
        <button
          type="button"
          className="node-delete nodrag"
          aria-label={`Delete ${context.nodeLabel} node ${node.id} in layer ${activeLayerName} (${activeLayerId})`}
          data-agent-action="delete-node"
          data-agent-layer-id={activeLayerId}
          data-agent-node-id={node.id}
          onClick={(event) => {
            event.stopPropagation();
            removeNodes([node.id]);
          }}
        >
          ×
        </button>
      </div>
      <div className="gfx-body">
        {def.inputs.map((s) => (
          <div key={s.name} className="gfx-row in">
            <Handle
              type="target"
              position={Position.Left}
              id={s.name}
              title={socketTitle(s)}
              role="img"
              aria-label={`${context.nodeLabel} ${node.id} input socket ${s.name} in layer ${activeLayerName} (${activeLayerId}), type ${socketTypes(s).join(' or ')}`}
              data-agent-target="socket"
              data-agent-layer-id={activeLayerId}
              data-agent-node-id={node.id}
              data-agent-node-type={node.type}
              data-agent-socket={s.name}
              data-agent-direction="input"
              data-agent-socket-types={socketTypes(s).join(' ')}
              style={{ background: socketColor(s) }}
            />
            <span>{s.optional ? `${s.name}?` : s.name}</span>
          </div>
        ))}
        {def.outputs.map((s) => (
          <div key={s.name} className="gfx-row out">
            <span>{s.name}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={s.name}
              title={socketTitle(s)}
              role="img"
              aria-label={`${context.nodeLabel} ${node.id} output socket ${s.name} in layer ${activeLayerName} (${activeLayerId}), type ${socketTypes(s).join(' or ')}`}
              data-agent-target="socket"
              data-agent-layer-id={activeLayerId}
              data-agent-node-id={node.id}
              data-agent-node-type={node.type}
              data-agent-socket={s.name}
              data-agent-direction="output"
              data-agent-socket-types={socketTypes(s).join(' ')}
              style={{ background: socketColor(s) }}
            />
          </div>
        ))}
      </div>
      {visibleParams.length > 0 && (
        <div className="gfx-params nodrag">
          {visibleParams.map((spec) => (
            <NodeParam
              key={spec.name}
              context={context}
              spec={spec}
              value={node.params[spec.name] ?? spec.default}
              onChange={(v) => setParam(node.id, spec.name, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface AgentParamContext {
  layerId: string;
  layerName: string;
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
}

function parameterLabel(
  context: AgentParamContext,
  name: string,
  detail?: string,
): string {
  return `${context.nodeLabel} ${context.nodeId} parameter ${name}${
    detail ? ` ${detail}` : ''
  } in layer ${context.layerName} (${context.layerId})`;
}

function parameterAttributes(
  context: AgentParamContext,
  name: string,
  detail?: string,
) {
  return {
    'data-agent-target': 'parameter',
    'data-agent-layer-id': context.layerId,
    'data-agent-node-id': context.nodeId,
    'data-agent-node-type': context.nodeType,
    'data-agent-param': name,
    ...(detail ? { 'data-agent-param-detail': detail } : {}),
  } as const;
}

function NodeParam({
  context,
  spec,
  value,
  onChange,
}: {
  context: AgentParamContext;
  spec: ParamSpec;
  value: ParamValue;
  onChange: (v: ParamValue) => void;
}) {
  const publicMetadata = getParamPublicMetadata(context.nodeType, spec);
  const label = parameterLabel(context, spec.name);
  const attributes = parameterAttributes(context, spec.name);
  if (spec.name === 'font') {
    return (
      <div className="param">
        <span>{spec.name}</span>
        <FontSelect
          value={String(value)}
          onChange={onChange}
          ariaLabel={label}
          agentAttributes={attributes}
        />
      </div>
    );
  }
  if (spec.name === 'content') {
    return (
      <label className="param">
        <span>{spec.name}</span>
        <textarea
          className="nodrag"
          aria-label={label}
          {...attributes}
          rows={3}
          maxLength={publicMetadata.maxLength}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    );
  }
  if (spec.kind === 'binds') {
    return (
      <BindList
        value={String(value)}
        onChange={onChange}
        context={context}
        paramName={spec.name}
      />
    );
  }
  if (spec.kind === 'channel') {
    return (
      <label className="param">
        <span>{spec.name}</span>
        <ChannelSelect
          value={String(value)}
          onChange={onChange}
          aria-label={label}
          {...attributes}
        />
      </label>
    );
  }
  if (spec.kind === 'image') {
    return (
      <div className="param">
        <span>{spec.name}</span>
        <ImageUpload
          value={String(value)}
          onChange={onChange}
          context={context}
          paramName={spec.name}
        />
      </div>
    );
  }
  if (spec.kind === 'number') {
    return (
      <div className="param">
        <span>{spec.name}</span>
        <NumberDrag
          spec={spec}
          value={Number(value)}
          onChange={onChange}
          ariaLabel={label}
          agentAttributes={attributes}
        />
      </div>
    );
  }
  if (spec.kind === 'color') {
    return (
      <label className="param">
        <span>{spec.name}</span>
        <input
          type="color"
          aria-label={label}
          {...attributes}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    );
  }
  if (spec.kind === 'toggle') {
    return (
      <label className="param">
        <span>{spec.name}</span>
        <input
          type="checkbox"
          aria-label={label}
          {...attributes}
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      </label>
    );
  }
  if (spec.kind === 'select') {
    return (
      <label className="param">
        <span>{spec.name}</span>
        <select
          aria-label={label}
          {...attributes}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {spec.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="param">
      <span>{spec.name}</span>
      <input
        type="text"
        aria-label={label}
        {...attributes}
        maxLength={publicMetadata.maxLength}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

// What a channel consumer can read: the built-ins + whatever this layer's
// Weights write — channels are named after their Weight node's source.
// Channels live on wires, so only the active layer's graph is in scope.
function useDocChannels(): string[] {
  const nodes = useApp((s) => selectActiveGraph(s).nodes);
  const channels = ['weight', 'progress'];
  for (const n of Object.values(nodes)) {
    if (n.type !== 'Weight') continue;
    const t = String(n.params.source ?? 'noise').trim();
    if (t && !channels.includes(t)) channels.push(t);
  }
  return channels;
}

// One channel dropdown, shared semantics with the binds rows: the document's
// live channels, keeping the current value selectable even when no Weight
// writes it (old documents, deleted Weights).
function ChannelSelect({
  value,
  onChange,
  ...attributes
}: {
  value: string;
  onChange: (v: ParamValue) => void;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  const channels = useDocChannels();
  return (
    <select
      {...attributes}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {(channels.includes(value) ? channels : [...channels, value]).map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
  );
}

// Place's channel bindings: one row per bind (channel → target, amount, plus
// offset/invert to shape the signal), and an "add channel" button that appends
// a row. Rows live in one JSON param; parseBinds is shared with the cook so
// both sides read it alike.
function BindList({
  value,
  onChange,
  context,
  paramName,
}: {
  value: string;
  onChange: (v: ParamValue) => void;
  context: AgentParamContext;
  paramName: string;
}) {
  const binds = parseBinds(value);
  const set = (next: BindSpec[]) => onChange(JSON.stringify(next));
  const patch = (i: number, part: Partial<BindSpec>) =>
    set(binds.map((b, k) => (k === i ? { ...b, ...part } : b)));

  // amounts mean different things per target: strength (0..1) vs blur px
  const amountSpec = (target: BindSpec['target']): NumberSpec =>
    target === 'blur'
      ? { name: 'amount', kind: 'number', default: 8, min: 0, max: 64, step: 1 }
      : { name: 'amount', kind: 'number', default: 1, min: 0, max: 1, step: 0.01 };

  return (
    <div className="bind-list">
      {binds.map((b, i) => (
        <div key={i} className="bind-item" data-agent-bind-index={i}>
          <div className="bind-item-head">
            <span>bind {i + 1}</span>
            <button
              type="button"
              className="num-arrow"
              aria-label={`Remove ${parameterLabel(context, paramName, `binding ${i + 1}`)}`}
              data-agent-action="remove-binding"
              data-agent-layer-id={context.layerId}
              data-agent-node-id={context.nodeId}
              data-agent-param={paramName}
              data-agent-bind-index={i}
              onClick={() => set(binds.filter((_, k) => k !== i))}
            >
              ×
            </button>
          </div>
          <label className="param">
            <span>channel</span>
            <ChannelSelect
              value={b.channel}
              onChange={(v) => patch(i, { channel: String(v) })}
              aria-label={parameterLabel(context, paramName, `binding ${i + 1} channel`)}
              {...parameterAttributes(context, paramName, `binding-${i}-channel`)}
            />
          </label>
          <label className="param">
            <span>target</span>
            <select
              aria-label={parameterLabel(context, paramName, `binding ${i + 1} target`)}
              {...parameterAttributes(context, paramName, `binding-${i}-target`)}
              value={b.target}
              onChange={(e) => {
                const target = e.target.value as BindSpec['target'];
                patch(i, { target, amount: target === 'blur' ? 8 : 1 });
              }}
            >
              {BIND_TARGETS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <div className="param">
            <span>amount</span>
            <NumberDrag
              spec={amountSpec(b.target)}
              value={b.amount}
              onChange={(v) => patch(i, { amount: v })}
              ariaLabel={parameterLabel(context, paramName, `binding ${i + 1} amount`)}
              agentAttributes={parameterAttributes(context, paramName, `binding-${i}-amount`)}
            />
          </div>
          <div className="param">
            <span>offset</span>
            <NumberDrag
              spec={{ name: 'offset', kind: 'number', default: 0, min: -1, max: 1, step: 0.01 }}
              value={b.offset ?? 0}
              onChange={(v) => patch(i, { offset: v })}
              ariaLabel={parameterLabel(context, paramName, `binding ${i + 1} offset`)}
              agentAttributes={parameterAttributes(context, paramName, `binding-${i}-offset`)}
            />
          </div>
          <label className="param">
            <span>invert</span>
            <select
              aria-label={parameterLabel(context, paramName, `binding ${i + 1} invert`)}
              {...parameterAttributes(context, paramName, `binding-${i}-invert`)}
              value={b.invert ? 'yes' : 'no'}
              onChange={(e) => patch(i, { invert: e.target.value === 'yes' })}
            >
              <option value="no">no</option>
              <option value="yes">yes</option>
            </select>
          </label>
        </div>
      ))}
      <button
        type="button"
        className="bind-add"
        aria-label={`Add binding to ${parameterLabel(context, paramName)}`}
        data-agent-action="add-binding"
        data-agent-layer-id={context.layerId}
        data-agent-node-id={context.nodeId}
        data-agent-param={paramName}
        onClick={() => set([...binds, { channel: 'weight', target: 'scale', amount: 1 }])}
      >
        + add channel
      </button>
    </div>
  );
}

// Image upload: a hidden file input behind an upload/replace button, with a
// thumbnail of the current picture. The file is read as a data: URI so it lands
// straight in the node param and travels with the document.
function ImageUpload({
  value,
  onChange,
  context,
  paramName,
}: {
  value: string;
  onChange: (v: ParamValue) => void;
  context: AgentParamContext;
  paramName: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const label = parameterLabel(context, paramName);
  const attributes = parameterAttributes(context, paramName);
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // let the same file be re-picked after any outcome
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > DEFAULT_AGENT_LIMITS.maxLegacyAssetBytes) {
      setError('The image exceeds the 20 MiB embedded-image limit.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError('The image could not be read.');
    reader.onload = () => {
      const source = String(reader.result);
      const validated = validateImageSource(
        source,
        DEFAULT_AGENT_LIMITS.maxLegacyAssetBytes,
        DEFAULT_AGENT_LIMITS.maxAssetPixels,
      );
      if (!validated.ok) {
        setError(validated.issue.message);
        return;
      }
      setError(null);
      onChange(source);
    };
    reader.readAsDataURL(file);
  };
  return (
    <div className="image-upload">
      <button
        type="button"
        className="image-upload-btn"
        aria-label={`${value ? 'Replace' : 'Upload'} image for ${label}`}
        data-agent-action="choose-image"
        data-agent-layer-id={context.layerId}
        data-agent-node-id={context.nodeId}
        data-agent-param={paramName}
        onClick={() => inputRef.current?.click()}
      >
        {value ? 'replace' : 'upload'}
      </button>
      {value && <img className="image-upload-thumb" src={value} alt="" />}
      {error && <span className="image-upload-error" role="alert">{error}</span>}
      <input
        ref={inputRef}
        type="file"
        aria-label={label}
        {...attributes}
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={onFile}
      />
    </div>
  );
}

// Font picker: a searchable combobox over the loaded fonts plus the user's
// local font families. Each option is previewed in its own typeface (local
// families resolve as installed system fonts), and a button requests local-font
// access (Chromium's Local Font Access API).
function FontSelect({
  value,
  onChange,
  ariaLabel,
  agentAttributes,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  agentAttributes: ReturnType<typeof parameterAttributes>;
}) {
  const fonts = useApp((s) => s.fonts);
  const localFonts = useApp((s) => s.localFonts);
  const loadLocalFont = useApp((s) => s.loadLocalFont);
  const loadLocalFonts = useApp((s) => s.loadLocalFonts);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const options = Array.from(new Set(['default', value, ...Object.keys(fonts), ...localFonts]));
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((f) => f.toLowerCase().includes(q)) : options;

  const close = () => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  };

  // close the menu when clicking outside the control
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const choose = (f: string) => {
    onChange(f);
    // start parsing right away instead of waiting for the graph→effect
    // round-trip; no-ops for 'default' and already-loaded fonts
    loadLocalFont(f);
    close();
  };

  const previewFont = (f: string) => (f === 'default' ? 'inherit' : `"${f}"`);
  const moveActive = (delta: number) => {
    if (filtered.length === 0) return;
    setActiveIndex((index) => (
      (Math.min(index, filtered.length - 1) + delta + filtered.length)
      % filtered.length
    ));
  };

  return (
    <div
      className="font-select"
      ref={ref}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <div className="font-select-control">
        <input
          className="font-select-input"
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={
            open && filtered[activeIndex]
              ? `${listboxId}-option-${activeIndex}`
              : undefined
          }
          {...agentAttributes}
          value={open ? query : value}
          placeholder={value}
          style={{ fontFamily: open ? 'inherit' : previewFont(value) }}
          onFocus={(e) => {
            setOpen(true);
            setQuery('');
            setActiveIndex(Math.max(0, options.indexOf(value)));
            e.target.setSelectionRange(0, e.target.value.length);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              if (!open) setOpen(true);
              else moveActive(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              if (!open) setOpen(true);
              else moveActive(-1);
            } else if (event.key === 'Home' && open) {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === 'End' && open) {
              event.preventDefault();
              setActiveIndex(Math.max(0, filtered.length - 1));
            } else if (event.key === 'Enter' && open && filtered[activeIndex]) {
              event.preventDefault();
              choose(filtered[activeIndex]);
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              close();
            }
          }}
        />
        <button
          type="button"
          className="num-arrow font-select-caret"
          aria-label={`Show font options for ${ariaLabel}`}
          data-agent-action="show-font-options"
          data-agent-layer-id={agentAttributes['data-agent-layer-id']}
          data-agent-node-id={agentAttributes['data-agent-node-id']}
          data-agent-param={agentAttributes['data-agent-param']}
          aria-expanded={open}
          aria-controls={listboxId}
          onPointerDown={(e) => {
            e.preventDefault();
          }}
          onClick={() => {
            setOpen((o) => !o);
            setQuery('');
            setActiveIndex(0);
          }}
        >
          ▾
        </button>
        {localFontsSupported && (
          <button
            type="button"
            className="num-arrow"
            aria-label={`Load local fonts for ${ariaLabel}`}
            data-agent-action="load-local-fonts"
            data-agent-layer-id={agentAttributes['data-agent-layer-id']}
            data-agent-node-id={agentAttributes['data-agent-node-id']}
            data-agent-param={agentAttributes['data-agent-param']}
            onClick={() => loadLocalFonts()}
          >
            ⤓
          </button>
        )}
      </div>
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`Font options for ${ariaLabel}`}
          className="font-select-menu nodrag nowheel"
          onWheelCapture={(e) => e.stopPropagation()}
        >
          {filtered.length === 0 && (
            <li className="font-select-empty" role="status">no match</li>
          )}
          {filtered.map((f, index) => (
            <li
              key={f}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={f === value}
              className={index === activeIndex ? 'active' : ''}
              style={{ fontFamily: previewFont(f) }}
              onPointerMove={() => setActiveIndex(index)}
              onPointerDown={(e) => {
                e.preventDefault();
                choose(f);
              }}
            >
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type NumberSpec = Extract<ParamSpec, { kind: 'number' }>;

// Blender-style number field: drag horizontally to scrub the value, click the
// ‹ › arrows to step, or click the field to type an exact value.
// Also used by the layers panel for opacity, so all numeric controls match.
export function NumberDrag({
  spec,
  value,
  onChange,
  ariaLabel = spec.name,
  agentAttributes,
}: {
  spec: NumberSpec;
  value: number;
  onChange: (v: number) => void;
  ariaLabel?: string;
  agentAttributes?: {
    readonly [key: `data-agent-${string}`]: string | number | undefined;
  };
}) {
  const min = spec.min ?? -Infinity;
  const max = spec.max ?? Infinity;
  const step = spec.step ?? 1;
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);

  const snap = (v: number) => {
    const snapped = Math.round(v / step) * step;
    const clamped = Math.min(max, Math.max(min, snapped));
    return Number(clamped.toPrecision(12));
  };

  const dot = String(step).indexOf('.');
  const decimals = dot === -1 ? 0 : String(step).length - dot - 1;
  const display = value.toFixed(decimals);
  const [draft, setDraft] = useState(display);
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(display);
  }, [display]);

  const commit = (raw: string) => {
    const parsed = Number(raw);
    const next = Number.isFinite(parsed) ? snap(parsed) : value;
    setDraft(next.toFixed(decimals));
    if (next !== value) onChange(next);
    return next;
  };
  const stepBy = (delta: number) => {
    const next = snap(value + delta * step);
    setDraft(next.toFixed(decimals));
    if (next !== value) onChange(next);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, v: value, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 3) d.moved = true;
    if (!d.moved) return;
    const range = Number.isFinite(max - min) ? max - min : 100;
    const next = snap(d.v + dx * (range / 200));
    setDraft(next.toFixed(decimals));
    onChange(next);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (d?.moved) endGesture(); // the scrub was one undo step; the next is its own
  };

  return (
    <div className="num-drag" role="group" aria-label={`${ariaLabel} controls`}>
      <button
        type="button"
        className="num-arrow"
        aria-label={`Decrease ${ariaLabel}`}
        data-agent-action="decrease-number"
        onClick={() => stepBy(-1)}
      >
        ‹
      </button>
      <input
        ref={inputRef}
        className="num-field"
        type="number"
        aria-label={ariaLabel}
        {...agentAttributes}
        value={draft}
        min={spec.min}
        max={spec.max}
        step={step}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          commit(event.target.value);
          endGesture();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit(event.currentTarget.value);
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(display);
            event.currentTarget.blur();
          }
        }}
      />
      <button
        type="button"
        className="num-scrub"
        aria-label={`Scrub ${ariaLabel}`}
        data-agent-action="scrub-number"
        title="drag horizontally to scrub"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        ↔
      </button>
      <button
        type="button"
        className="num-arrow"
        aria-label={`Increase ${ariaLabel}`}
        data-agent-action="increase-number"
        onClick={() => stepBy(1)}
      >
        ›
      </button>
    </div>
  );
}
