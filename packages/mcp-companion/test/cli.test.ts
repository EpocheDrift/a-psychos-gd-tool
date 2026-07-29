import { describe, expect, it } from 'vitest';
import { parseCompanionArguments } from '../src/cli.js';

describe('companion CLI authority profiles', () => {
  it('expands full-design-v1 to one immutable v1 scope snapshot', () => {
    expect(parseCompanionArguments([
      '--profile=full-design-v1',
      '--trusted-local',
    ])).toEqual({
      allowEdit: true,
      allowAssets: true,
      allowModel: true,
      controlMode: 'trusted-local-v1',
      profile: 'full-design-v1',
      headless: false,
    });
  });

  it('keeps legacy explicit flags independent in either control mode', () => {
    expect(parseCompanionArguments([
      '--allow-assets',
      '--trusted-local',
      '--chrome',
      '/Applications/Chromium',
    ])).toEqual({
      allowEdit: false,
      allowAssets: true,
      allowModel: false,
      controlMode: 'trusted-local-v1',
      headless: false,
      executablePath: '/Applications/Chromium',
    });
    expect(parseCompanionArguments([])).toEqual({
      allowEdit: false,
      allowAssets: false,
      allowModel: false,
      controlMode: 'interactive-v1',
      headless: false,
    });
  });

  it('rejects ambiguous, unknown, or duplicated authority options', () => {
    expect(() => parseCompanionArguments([
      '--profile=full-design-v1',
      '--allow-edit',
    ])).toThrow('cannot be combined');
    expect(() => parseCompanionArguments([
      '--profile=future-design-v2',
    ])).toThrow('Unknown companion profile');
    expect(() => parseCompanionArguments([
      '--trusted-local',
      '--trusted-local',
    ])).toThrow('only once');
    expect(() => parseCompanionArguments([
      '--profile',
    ])).toThrow('requires a versioned profile ID');
  });
});
