import { describe, expect, it } from 'vitest';
import {
  findNodePlacement,
  placementRectsOverlap,
  type PlacementRect,
} from './nodePlacement';

describe('collision-aware node placement', () => {
  it('places 20 mixed-size cards without node or fixed-panel overlap', () => {
    const fixed: PlacementRect[] = [
      { x: -120, y: -160, width: 240, height: 280 },
      { x: 300, y: -120, width: 220, height: 360 },
    ];
    const nodes: PlacementRect[] = [];
    for (let index = 0; index < 20; index++) {
      const size = {
        width: index % 3 === 0 ? 250 : 210,
        height: 100 + (index % 5) * 45,
      };
      const position = findNodePlacement({
        preferred: { x: 0, y: 0 },
        size,
        occupied: nodes,
        blocked: fixed,
      });
      const added = { ...position, ...size };
      expect(nodes.some((node) => placementRectsOverlap(added, node))).toBe(false);
      expect(fixed.some((panel) => placementRectsOverlap(added, panel))).toBe(false);
      nodes.push(added);
    }
    expect(nodes).toHaveLength(20);
  });

  it('is deterministic for identical geometry', () => {
    const input = {
      preferred: { x: 10, y: 20 },
      size: { width: 210, height: 120 },
      occupied: [{ x: 0, y: 16, width: 210, height: 120 }],
    };
    expect(findNodePlacement(input)).toEqual(findNodePlacement(input));
  });

  it('rejects malformed geometry and impossible bounded searches', () => {
    expect(() => findNodePlacement({
      preferred: { x: Number.NaN, y: 0 },
      size: { width: 10, height: 10 },
      occupied: [],
    })).toThrow(/finite/);
    expect(() => findNodePlacement({
      preferred: { x: 0, y: 0 },
      size: { width: 10, height: 10 },
      occupied: [],
      blocked: [{ x: -100, y: -100, width: 200, height: 200 }],
      maxRings: 1,
    })).toThrow(/No collision-free/);
  });
});
