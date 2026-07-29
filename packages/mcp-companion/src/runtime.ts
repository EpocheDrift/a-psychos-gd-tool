import type { CreatedBrowserSession } from './browserSession.js';
import { launchCompanionBrowser } from './browserSession.js';
import { BridgeClient } from './bridgeClient.js';
import { LocalAppHost } from './localAppHost.js';
import {
  AGENT_COMPANION_CONTROL_MODE_INTERACTIVE,
  AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL,
  type AgentCompanionControlMode,
} from './agentSecurity.js';
import {
  ModelManager,
  OneShotModelApprovalGate,
  createManagedRmbgModelManager,
} from './modelManager.js';
import {
  INTERACTIVE_SESSION_TTL_MS,
  TRUSTED_LOCAL_SESSION_TTL_MS,
} from './protocol.js';
import {
  companionProfileScopes,
  type CompanionProfileId,
} from './profiles.js';

export interface BrowserSessionLike {
  close(): Promise<void>;
}

export interface CompanionRuntimeOptions {
  allowEdit: boolean;
  allowAssets: boolean;
  allowModel: boolean;
  controlMode?: AgentCompanionControlMode;
  profile?: CompanionProfileId;
  executablePath?: string;
  headless?: boolean;
  appDirectory?: string;
  launchBrowser?: (
    options: {
      bootstrapToken: string;
      executablePath?: string;
      headless?: boolean;
      onDisconnected?: () => void;
    },
  ) => Promise<BrowserSessionLike>;
  onBrowserDisconnected?: () => void;
  onBridgeTerminated?: (reason: string) => void;
  modelRuntime?: {
    readonly manager: ModelManager;
    readonly approvalGate: OneShotModelApprovalGate;
  };
}

export function companionRequestedScopes(
  options: Pick<
    CompanionRuntimeOptions,
    'allowEdit' | 'allowAssets' | 'allowModel'
  >,
): readonly ('read' | 'preview' | 'edit' | 'assets' | 'model')[] {
  return Object.freeze([
    'read',
    'preview',
    ...(options.allowEdit ? ['edit' as const] : []),
    ...(options.allowAssets ? ['assets' as const] : []),
    ...(options.allowModel ? ['model' as const] : []),
  ]);
}

export function companionSessionTtlMs(
  controlMode: AgentCompanionControlMode =
    AGENT_COMPANION_CONTROL_MODE_INTERACTIVE,
): number {
  switch (controlMode) {
    case AGENT_COMPANION_CONTROL_MODE_INTERACTIVE:
      return INTERACTIVE_SESSION_TTL_MS;
    case AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL:
      return TRUSTED_LOCAL_SESSION_TTL_MS;
  }
}

function sameScopes(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((scope, index) => scope === right[index]);
}

export class CompanionRuntime {
  readonly bridge: BridgeClient;
  readonly modelManager?: ModelManager;
  private readonly host: LocalAppHost;
  private browser: BrowserSessionLike | null = null;
  private started = false;
  private starting = false;
  private startPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;

  constructor(private readonly options: CompanionRuntimeOptions) {
    const controlMode =
      options.controlMode ?? AGENT_COMPANION_CONTROL_MODE_INTERACTIVE;
    const requestedScopes = companionRequestedScopes(options);
    if (
      options.profile
      && !sameScopes(
        requestedScopes,
        companionProfileScopes(options.profile),
      )
    ) {
      throw new Error(
        'The Companion runtime flags do not match its versioned profile.',
      );
    }
    if (options.modelRuntime && !options.allowModel) {
      throw new Error(
        'A model runtime cannot be injected while model access is disabled.',
      );
    }
    let modelRuntime = options.modelRuntime;
    if (options.allowModel && !modelRuntime) {
      const approvalGate = new OneShotModelApprovalGate();
      modelRuntime = {
        approvalGate,
        manager: createManagedRmbgModelManager({
          approvalProvider: approvalGate,
        }),
      };
    }
    this.modelManager = modelRuntime?.manager;
    this.bridge = new BridgeClient({
      requestedScopes,
      maxSessionTtlMs: companionSessionTtlMs(controlMode),
      requireExactScopes:
        controlMode === AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL,
      onTerminal: (reason) => {
        void this.close();
        try {
          options.onBridgeTerminated?.(reason);
        } catch {
          // Observer failures must never suppress security teardown.
        }
      },
    });
    this.host = new LocalAppHost({
      bridge: this.bridge,
      controlMode,
      ...(options.appDirectory
        ? { appDirectory: options.appDirectory }
        : {}),
      ...(modelRuntime
        ? {
            modelManager: modelRuntime.manager,
            modelApprovalGate: modelRuntime.approvalGate,
          }
        : {}),
    });
  }

  start(): Promise<void> {
    if (this.started || this.starting) {
      return Promise.reject(
        new Error('The companion runtime is already started.'),
      );
    }
    if (this.closePromise) {
      return Promise.reject(
        new Error('The companion runtime was closed before startup.'),
      );
    }
    this.starting = true;
    const starting = this.startInternal();
    this.startPromise = starting;
    void starting.finally(() => {
      if (this.startPromise === starting) this.startPromise = null;
      this.starting = false;
    }).catch(() => undefined);
    return starting;
  }

  private async startInternal(): Promise<void> {
    try {
      await this.host.start();
      if (this.closePromise) {
        await this.host.close();
        throw new Error('The companion runtime closed during startup.');
      }
      const launcher = this.options.launchBrowser
        ?? (async (options): Promise<CreatedBrowserSession> =>
          launchCompanionBrowser(options));
      const launchedBrowser = await launcher({
        bootstrapToken: this.host.bootstrapToken,
        ...(this.options.executablePath
          ? { executablePath: this.options.executablePath }
          : {}),
        ...(this.options.headless === undefined
          ? {}
          : { headless: this.options.headless }),
        onDisconnected: () => {
          try {
            this.options.onBrowserDisconnected?.();
          } catch {
            // Observer failures must never suppress session revocation.
          }
          if (!this.closePromise) {
            this.bridge.close('Chrome disconnected');
          }
        },
      });
      if (this.closePromise) {
        await launchedBrowser.close().catch(() => undefined);
        throw new Error('The companion runtime closed during browser startup.');
      }
      this.browser = launchedBrowser;
      this.started = true;
    } catch (error) {
      await this.host.close();
      throw error;
    }
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeInternal();
    return this.closePromise;
  }

  private async closeInternal(): Promise<void> {
    this.bridge.close('companion shutdown');
    await this.startPromise?.catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
    await this.host.close();
    this.started = false;
  }
}
