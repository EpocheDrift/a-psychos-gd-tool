import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('semantic Agent GUI gate source', () => {
  const source = readFileSync(
    new URL('../../scripts/agent-semantic-check.mjs', import.meta.url),
    'utf8',
  );

  it('does not depend on spatial input, private framework classes, or raw state', () => {
    for (const forbidden of [
      /react-flow__/,
      /page\.mouse/,
      /waitForTimeout/,
      /force\s*:/,
      /__app/,
      /__render/,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  it('does not hard-code generated node identities', () => {
    expect(source).not.toMatch(/\b(?:text|outline|rasterize)_\d+\b/i);
  });

  it('keeps the required default 50-round repetition gate', () => {
    expect(source).toContain('process.env.AGENT_UI_ROUNDS ?? 50');
    expect(source).toContain('round < ROUND_COUNT');
  });
});
