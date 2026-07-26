import type { CreatedBrowserSession } from './browserSession.js';
import { launchCompanionBrowser } from './browserSession.js';
import { BridgeClient } from './bridgeClient.js';
import { LocalAppHost } from './localAppHost.js';

export interface BrowserSessionLike {
  close(): Promise<void>;
}

export interface CompanionRuntimeOptions {
  allowEdit: boolean;
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
}

export class CompanionRuntime {
  readonly bridge: BridgeClient;
  private readonly host: LocalAppHost;
  private browser: BrowserSessionLike | null = null;
  private started = false;
  private starting = false;
  private startPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;

  constructor(private readonly options: CompanionRuntimeOptions) {
    this.bridge = new BridgeClient({
      requestedScopes: options.allowEdit
        ? ['read', 'preview', 'edit']
        : ['read', 'preview'],
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
      ...(options.appDirectory
        ? { appDirectory: options.appDirectory }
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
