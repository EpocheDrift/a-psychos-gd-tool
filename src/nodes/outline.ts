// Outline (text => vector) — glyphs become paths. The explicit step down the
// ladder: after this the text is geometry, no longer live type.

import { boundsOfPaths } from '../engine/path';
import { geometryBudgetFor } from '../engine/geometryBudget';
import type { NodeDef } from '../engine/registry';
import type { PathCmd, TextValue, VectorValue } from '../engine/values';

export const OutlineNode: NodeDef = {
  type: 'Outline',
  label: 'Outline Text',
  inputs: [{ name: 'text', type: 'text' }],
  outputs: [{ name: 'out', type: 'vector' }],
  params: [],
  cook(inputs, _params, ctx) {
    const budget = geometryBudgetFor(ctx);
    const text = inputs.text as TextValue;
    const font = ctx.fonts.get(text.fontKey);
    if (!font) throw new Error(`font not loaded: ${text.fontKey}`);

    const paths: PathCmd[][] = [];
    // getPath is synchronous library code, so reject an oversized glyph batch
    // before entering it one glyph at a time.
    budget.chargeGlyphs(text.glyphs.length);
    for (const g of text.glyphs) {
      budget.checkInterrupt();
      const glyph = font.glyphs.get(g.glyphId);
      const path = glyph.getPath(g.x, g.y, text.fontSize);
      const commands = path.commands as PathCmd[];
      if (commands.length === 0) continue;
      budget.chargeVectorPaths();
      budget.chargeVectorCommands(commands.length);
      paths.push(commands);
    }

    const value: VectorValue = {
      kind: 'vector',
      paths,
      bounds: boundsOfPaths(paths, ctx),
      style: text.style,
    };
    return { out: value };
  },
};
