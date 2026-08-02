import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';

const STACKED_WORKBENCH_QUERY = '(max-width: 900px)';
const DEFAULT_SPLIT_PERCENT = 60;
const ABSOLUTE_MIN_PERCENT = 20;
const ABSOLUTE_MAX_PERCENT = 80;
const SIDE_BY_SIDE_MIN_EDITOR_PX = 460;
const SIDE_BY_SIDE_MIN_PREVIEW_PX = 340;
const STACKED_MIN_EDITOR_PX = 180;
const STACKED_MIN_PREVIEW_PX = 200;

function useStackedWorkbench(): boolean {
  const [stacked, setStacked] = useState(() =>
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(STACKED_WORKBENCH_QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(STACKED_WORKBENCH_QUERY);
    const update = () => setStacked(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return stacked;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

interface WorkbenchSplitterProps {
  containerRef: RefObject<HTMLDivElement | null>;
  /** The person's persisted preference, before window-specific clamping. */
  value: number;
  onChange: (value: number) => void;
  /** The value the current layout can actually display. */
  onEffectiveChange: (value: number) => void;
}

interface SplitRange {
  minimum: number;
  maximum: number;
}

interface ActiveDrag {
  pointerId: number;
  startCoordinate: number;
  startValue: number;
  containerLength: number;
  stacked: boolean;
}

export function WorkbenchSplitter({
  containerRef,
  value,
  onChange,
  onEffectiveChange,
}: WorkbenchSplitterProps) {
  const stacked = useStackedWorkbench();
  const [range, setRange] = useState<SplitRange>({
    minimum: ABSOLUTE_MIN_PERCENT,
    maximum: ABSOLUTE_MAX_PERCENT,
  });
  const pendingValue = useRef<number | null>(null);
  const animationFrame = useRef<number | null>(null);
  const activeDrag = useRef<ActiveDrag | null>(null);

  const availableRange = useCallback((): SplitRange => {
    const bounds = containerRef.current?.getBoundingClientRect();
    const length = stacked ? bounds?.height : bounds?.width;
    if (!length || length <= 0) {
      return {
        minimum: ABSOLUTE_MIN_PERCENT,
        maximum: ABSOLUTE_MAX_PERCENT,
      };
    }

    const minimumPrimaryPx = stacked
      ? STACKED_MIN_EDITOR_PX
      : SIDE_BY_SIDE_MIN_EDITOR_PX;
    const minimumSecondaryPx = stacked
      ? STACKED_MIN_PREVIEW_PX
      : SIDE_BY_SIDE_MIN_PREVIEW_PX;
    const minimum = Math.max(
      ABSOLUTE_MIN_PERCENT,
      minimumPrimaryPx / length * 100,
    );
    const maximum = Math.min(
      ABSOLUTE_MAX_PERCENT,
      100 - minimumSecondaryPx / length * 100,
    );

    // Extremely small windows cannot satisfy both preferred pixel minima.
    // Keep the control bounded and let CSS preserve access through its own
    // minimum sizes instead of allowing NaN or an inverted range.
    if (minimum > maximum) {
      return {
        minimum: ABSOLUTE_MIN_PERCENT,
        maximum: ABSOLUTE_MAX_PERCENT,
      };
    }
    return { minimum, maximum };
  }, [containerRef, stacked]);

  const clampToAvailableSpace = useCallback((candidate: number) => {
    const nextRange = availableRange();
    return clamp(candidate, nextRange.minimum, nextRange.maximum);
  }, [availableRange]);

  const effectiveValue = clamp(value, range.minimum, range.maximum);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const nextRange = availableRange();
      setRange((previous) =>
        Math.abs(previous.minimum - nextRange.minimum) < 0.01
        && Math.abs(previous.maximum - nextRange.maximum) < 0.01
          ? previous
          : nextRange);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [availableRange, containerRef]);

  useEffect(() => {
    onEffectiveChange(effectiveValue);
  }, [effectiveValue, onEffectiveChange]);

  useEffect(() => () => {
    if (animationFrame.current !== null) {
      cancelAnimationFrame(animationFrame.current);
    }
  }, []);

  const scheduleChange = useCallback((nextValue: number) => {
    pendingValue.current = nextValue;
    if (animationFrame.current !== null) return;
    animationFrame.current = requestAnimationFrame(() => {
      animationFrame.current = null;
      const next = pendingValue.current;
      pendingValue.current = null;
      if (next !== null) onChange(next);
    });
  }, [onChange]);

  const updateFromPointer = useCallback((clientX: number, clientY: number) => {
    const drag = activeDrag.current;
    if (!drag) return;
    const coordinate = drag.stacked ? clientY : clientX;
    const candidate = drag.startValue
      + (coordinate - drag.startCoordinate) / drag.containerLength * 100;
    scheduleChange(clampToAvailableSpace(candidate));
  }, [clampToAvailableSpace, scheduleChange]);

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    const bounds = containerRef.current?.getBoundingClientRect();
    const containerLength = stacked ? bounds?.height : bounds?.width;
    if (!containerLength || containerLength <= 0) return;
    event.preventDefault();
    activeDrag.current = {
      pointerId: event.pointerId,
      startCoordinate: stacked ? event.clientY : event.clientX,
      startValue: effectiveValue,
      containerLength,
      stacked,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (
      activeDrag.current?.pointerId !== event.pointerId
      || !event.currentTarget.hasPointerCapture(event.pointerId)
    ) return;
    updateFromPointer(event.clientX, event.clientY);
  };

  const pointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (activeDrag.current?.pointerId === event.pointerId) {
      activeDrag.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decrement = stacked ? 'ArrowUp' : 'ArrowLeft';
    const increment = stacked ? 'ArrowDown' : 'ArrowRight';
    let candidate: number | null = null;
    if (event.key === decrement) candidate = effectiveValue - 2;
    if (event.key === increment) candidate = effectiveValue + 2;
    if (event.key === 'Home') candidate = range.minimum;
    if (event.key === 'End') candidate = range.maximum;
    if (event.key === 'Enter') {
      event.preventDefault();
      onChange(DEFAULT_SPLIT_PERCENT);
      return;
    }
    if (candidate === null) return;
    event.preventDefault();
    onChange(clampToAvailableSpace(candidate));
  };

  return (
    <div
      className="workbench-splitter"
      role="separator"
      tabIndex={0}
      aria-label="Resize node editor and poster preview"
      aria-orientation={stacked ? 'horizontal' : 'vertical'}
      aria-controls="workbench-node-editor workbench-poster-preview"
      aria-valuemin={Math.floor(range.minimum)}
      aria-valuemax={Math.ceil(range.maximum)}
      aria-valuenow={Math.round(effectiveValue)}
      aria-valuetext={`${Math.round(effectiveValue)}% for the node editor`}
      title="Drag to resize; use arrow keys for precise adjustment; double-click to reset"
      data-workbench-splitter
      data-workbench-orientation={stacked ? 'stacked' : 'side-by-side'}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerEnd}
      onPointerCancel={pointerEnd}
      onLostPointerCapture={() => {
        activeDrag.current = null;
      }}
      onKeyDown={keyDown}
      onDoubleClick={() => onChange(DEFAULT_SPLIT_PERCENT)}
    />
  );
}
