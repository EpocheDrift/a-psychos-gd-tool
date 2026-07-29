import { describe, expect, it } from 'vitest';
import {
  COMPANION_SCOPES,
  FULL_DESIGN_V1_SCOPES,
  companionProfileScopes,
} from '../src/profiles.js';

describe('versioned companion profiles', () => {
  it('pins full-design-v1 to the explicit current scope list', () => {
    expect(FULL_DESIGN_V1_SCOPES).toEqual([
      'read',
      'preview',
      'edit',
      'assets',
      'model',
    ]);
    expect(companionProfileScopes('full-design-v1')).toBe(
      FULL_DESIGN_V1_SCOPES,
    );
    expect(Object.isFrozen(FULL_DESIGN_V1_SCOPES)).toBe(true);
  });

  it('does not derive a profile dynamically from the available-scope array', () => {
    expect(FULL_DESIGN_V1_SCOPES).not.toBe(COMPANION_SCOPES);
  });
});
