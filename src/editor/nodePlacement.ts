export interface PlacementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FindNodePlacementInput {
  preferred: { x: number; y: number };
  size: { width: number; height: number };
  occupied: readonly PlacementRect[];
  blocked?: readonly PlacementRect[];
  gap?: number;
  grid?: number;
  maxRings?: number;
}

function finiteRect(rect: PlacementRect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0;
}

export function placementRectsOverlap(
  left: PlacementRect,
  right: PlacementRect,
  gap = 0,
): boolean {
  return left.x < right.x + right.width + gap
    && left.x + left.width + gap > right.x
    && left.y < right.y + right.height + gap
    && left.y + left.height + gap > right.y;
}

function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

function ringOffsets(ring: number): Array<{ x: number; y: number }> {
  if (ring === 0) return [{ x: 0, y: 0 }];
  const result: Array<{ x: number; y: number }> = [];
  // Deterministic clockwise perimeter, starting at the upper-left corner.
  for (let x = -ring; x <= ring; x++) result.push({ x, y: -ring });
  for (let y = -ring + 1; y <= ring; y++) result.push({ x: ring, y });
  for (let x = ring - 1; x >= -ring; x--) result.push({ x, y: ring });
  for (let y = ring - 1; y > -ring; y--) result.push({ x: -ring, y });
  return result;
}

/**
 * Finds the first deterministic grid/spiral slot that avoids measured nodes
 * and fixed floating panels. The search may leave the current viewport instead
 * of stacking cards when the visible pane is full.
 */
export function findNodePlacement(
  input: FindNodePlacementInput,
): { x: number; y: number } {
  const { width, height } = input.size;
  if (
    !Number.isFinite(input.preferred.x)
    || !Number.isFinite(input.preferred.y)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    throw new RangeError('Placement input must contain finite positive geometry.');
  }
  const gap = input.gap ?? 24;
  const grid = input.grid ?? 16;
  const maxRings = input.maxRings ?? 256;
  if (
    !Number.isSafeInteger(gap)
    || gap < 0
    || !Number.isSafeInteger(grid)
    || grid <= 0
    || !Number.isSafeInteger(maxRings)
    || maxRings <= 0
  ) {
    throw new RangeError('Placement gap, grid, and ring limits are invalid.');
  }
  const obstacles = [...input.occupied, ...(input.blocked ?? [])]
    .filter(finiteRect);
  const stepX = Math.max(grid, Math.ceil((width + gap) / grid) * grid);
  const stepY = Math.max(grid, Math.ceil((height + gap) / grid) * grid);
  const origin = {
    x: snap(input.preferred.x, grid),
    y: snap(input.preferred.y, grid),
  };

  for (let ring = 0; ring <= maxRings; ring++) {
    for (const offset of ringOffsets(ring)) {
      const candidate: PlacementRect = {
        x: origin.x + offset.x * stepX,
        y: origin.y + offset.y * stepY,
        width,
        height,
      };
      if (!obstacles.some((rect) => placementRectsOverlap(candidate, rect, gap))) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }
  throw new RangeError(
    `No collision-free node placement found within ${maxRings} search rings.`,
  );
}
