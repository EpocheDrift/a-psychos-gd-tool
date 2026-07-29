import type { Font } from 'opentype.js';
import {
  geometryBudgetFor,
  type GeometryBudgetControl,
} from './geometryBudget';
import { boundsOfPaths } from './path';
import {
  DEFAULT_STYLE,
  type Element,
  type Rect,
  type Style,
  type TextValue,
} from './values';

export type HorizontalElementAnchor =
  | 'legacy'
  | 'start'
  | 'center'
  | 'end';
export type VerticalElementAnchor =
  | 'legacy'
  | 'top'
  | 'middle'
  | 'bottom';

function visibleStyle(style: Style): boolean {
  return style.fillEnabled !== false || style.strokeWidth > 0;
}

function paintExpansion(style: Style): number {
  let expansion = style.fillEnabled !== false
    ? Math.max(0, style.grow)
    : 0;
  if (style.strokeWidth > 0) {
    if (style.strokeAlign === 'outside') {
      expansion = Math.max(expansion, style.strokeWidth);
    } else if (style.strokeAlign === 'center') {
      expansion = Math.max(expansion, style.strokeWidth / 2);
    }
  }
  return expansion;
}

function expandRect(rect: Rect, amount: number): Rect {
  if (amount <= 0) return { ...rect };
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

function textGeometryBounds(
  value: TextValue,
  fonts: ReadonlyMap<string, Font>,
  control: GeometryBudgetControl,
): Rect | null {
  const font = fonts.get(value.fontKey);
  if (!font) return null;
  const budget = geometryBudgetFor(control);
  budget.chargeGlyphs(value.glyphs.length);
  const paths = [];
  let commandCount = 0;
  for (const glyph of value.glyphs) {
    budget.checkInterrupt();
    const commands = font.glyphs
      .get(glyph.glyphId)
      .getPath(glyph.x, glyph.y, value.fontSize)
      .commands;
    if (commands.length === 0) continue;
    commandCount = commandCount > Number.MAX_SAFE_INTEGER - commands.length
      ? Number.MAX_SAFE_INTEGER
      : commandCount + commands.length;
    budget.assertCanvasPaint(paths.length + 1, commandCount);
    paths.push(commands);
  }
  if (paths.length === 0) return null;
  return boundsOfPaths(paths, control);
}

/**
 * Returns the local painted extent used by Place anchors and render
 * diagnostics. Vector/text bounds include conservative stroke/grow expansion;
 * raster bounds use their storage extent centered on the element origin.
 */
export function contentPaintBounds(
  content: Element['content'],
  fonts: ReadonlyMap<string, Font>,
  control: GeometryBudgetControl = {},
): Rect | null {
  if (content.kind === 'raster') {
    return {
      x: -content.width / 2,
      y: -content.height / 2,
      width: content.width,
      height: content.height,
    };
  }
  const style = content.style ?? DEFAULT_STYLE;
  if (!visibleStyle(style)) return null;
  const geometry = content.kind === 'vector'
    ? content.bounds
    : textGeometryBounds(content, fonts, control);
  if (!geometry) return null;
  return expandRect(geometry, paintExpansion(style));
}

export function anchoredTransformPosition(
  target: { x: number; y: number },
  bounds: Rect | null,
  rotation: number,
  scale: number,
  anchorX: HorizontalElementAnchor,
  anchorY: VerticalElementAnchor,
): { x: number; y: number } {
  if (!bounds || (anchorX === 'legacy' && anchorY === 'legacy')) {
    return { ...target };
  }
  const localX =
    anchorX === 'start'
      ? bounds.x
      : anchorX === 'center'
        ? bounds.x + bounds.width / 2
        : anchorX === 'end'
          ? bounds.x + bounds.width
          : 0;
  const localY =
    anchorY === 'top'
      ? bounds.y
      : anchorY === 'middle'
        ? bounds.y + bounds.height / 2
        : anchorY === 'bottom'
          ? bounds.y + bounds.height
          : 0;
  const cosine = Math.cos(rotation) * scale;
  const sine = Math.sin(rotation) * scale;
  return {
    x: target.x - (cosine * localX - sine * localY),
    y: target.y - (sine * localX + cosine * localY),
  };
}

export function transformedElementBounds(
  element: Element,
  fonts: ReadonlyMap<string, Font>,
  control: GeometryBudgetControl = {},
): Rect | null {
  const local = contentPaintBounds(element.content, fonts, control);
  return local ? transformLocalPaintBounds(element, local) : null;
}

export function transformLocalPaintBounds(
  element: Element,
  local: Rect,
): Rect {
  const { rotation, scale, x, y } = element.transform;
  const cosine = Math.cos(rotation) * scale;
  const sine = Math.sin(rotation) * scale;
  const corners = [
    [local.x, local.y],
    [local.x + local.width, local.y],
    [local.x, local.y + local.height],
    [local.x + local.width, local.y + local.height],
  ] as const;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [localX, localY] of corners) {
    const transformedX = x + cosine * localX - sine * localY;
    const transformedY = y + sine * localX + cosine * localY;
    minX = Math.min(minX, transformedX);
    minY = Math.min(minY, transformedY);
    maxX = Math.max(maxX, transformedX);
    maxY = Math.max(maxY, transformedY);
  }
  const blurExpansion = Math.max(0, element.blur ?? 0) * 3;
  return expandRect({
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }, blurExpansion);
}
