import {
  companionProfileScopes,
  isCompanionProfileId,
  type CompanionProfileId,
} from './profiles.js';
import {
  AGENT_COMPANION_CONTROL_MODE_INTERACTIVE,
  AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL,
  type AgentCompanionControlMode,
} from './agentSecurity.js';

export interface CompanionCliOptions {
  allowEdit: boolean;
  allowAssets: boolean;
  allowModel: boolean;
  controlMode: AgentCompanionControlMode;
  profile?: CompanionProfileId;
  headless: boolean;
  executablePath?: string;
}

function profileValue(
  arguments_: readonly string[],
  index: number,
): { value: string; nextIndex: number } | null {
  const argument = arguments_[index]!;
  if (argument === '--profile') {
    const value = arguments_[index + 1];
    if (!value) throw new Error('--profile requires a versioned profile ID.');
    return { value, nextIndex: index + 1 };
  }
  if (argument.startsWith('--profile=')) {
    const value = argument.slice('--profile='.length);
    if (!value) throw new Error('--profile requires a versioned profile ID.');
    return { value, nextIndex: index };
  }
  return null;
}

export function parseCompanionArguments(
  arguments_: readonly string[],
): CompanionCliOptions {
  let allowEdit = false;
  let allowAssets = false;
  let allowModel = false;
  let explicitScopeFlag = false;
  let profile: CompanionProfileId | undefined;
  let controlMode: AgentCompanionControlMode =
    AGENT_COMPANION_CONTROL_MODE_INTERACTIVE;
  let headless = false;
  let executablePath: string | undefined;

  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]!;
    const parsedProfile = profileValue(arguments_, index);
    if (parsedProfile) {
      if (profile) throw new Error('--profile may be specified only once.');
      if (!isCompanionProfileId(parsedProfile.value)) {
        throw new Error(
          `Unknown companion profile "${parsedProfile.value}".`,
        );
      }
      profile = parsedProfile.value;
      index = parsedProfile.nextIndex;
      continue;
    }
    if (argument === '--allow-edit') {
      allowEdit = true;
      explicitScopeFlag = true;
      continue;
    }
    if (argument === '--allow-assets') {
      allowAssets = true;
      explicitScopeFlag = true;
      continue;
    }
    if (argument === '--allow-model') {
      allowModel = true;
      explicitScopeFlag = true;
      continue;
    }
    if (argument === '--trusted-local') {
      if (controlMode === AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL) {
        throw new Error('--trusted-local may be specified only once.');
      }
      controlMode = AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL;
      continue;
    }
    if (argument === '--headless') {
      headless = true;
      continue;
    }
    if (argument === '--chrome') {
      const value = arguments_[++index];
      if (!value) throw new Error('--chrome requires an executable path.');
      executablePath = value;
      continue;
    }
    if (argument.startsWith('--chrome=')) {
      const value = argument.slice('--chrome='.length);
      if (!value) throw new Error('--chrome requires an executable path.');
      executablePath = value;
      continue;
    }
    throw new Error(`Unknown companion option "${argument}".`);
  }

  if (profile && explicitScopeFlag) {
    throw new Error(
      '--profile cannot be combined with individual --allow-* flags.',
    );
  }
  if (profile) {
    const scopes = new Set(companionProfileScopes(profile));
    allowEdit = scopes.has('edit');
    allowAssets = scopes.has('assets');
    allowModel = scopes.has('model');
  }

  return {
    allowEdit,
    allowAssets,
    allowModel,
    controlMode,
    ...(profile ? { profile } : {}),
    headless,
    ...(executablePath ? { executablePath } : {}),
  };
}
