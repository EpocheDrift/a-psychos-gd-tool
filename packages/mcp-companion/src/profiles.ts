export const COMPANION_SCOPES = [
  'read',
  'preview',
  'edit',
  'assets',
  'model',
] as const;

export type CompanionScope = (typeof COMPANION_SCOPES)[number];

/**
 * Versioned profiles are immutable authority snapshots. Adding a future
 * Companion scope must not silently expand an existing profile.
 */
export const FULL_DESIGN_V1_SCOPES = Object.freeze([
  'read',
  'preview',
  'edit',
  'assets',
  'model',
] as const satisfies readonly CompanionScope[]);

export const COMPANION_PROFILE_IDS = [
  'full-design-v1',
] as const;

export type CompanionProfileId = (typeof COMPANION_PROFILE_IDS)[number];

export function isCompanionProfileId(
  value: string,
): value is CompanionProfileId {
  return (COMPANION_PROFILE_IDS as readonly string[]).includes(value);
}

export function companionProfileScopes(
  profile: CompanionProfileId,
): readonly CompanionScope[] {
  switch (profile) {
    case 'full-design-v1':
      return FULL_DESIGN_V1_SCOPES;
  }
}
