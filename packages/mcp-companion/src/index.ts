#!/usr/bin/env node
import process from 'node:process';
import { createBoundedStdio } from './boundedStdio.js';
import { CompanionRuntime } from './runtime.js';
import { createToolServer } from './tools.js';

interface CliOptions {
  allowEdit: boolean;
  allowAssets: boolean;
  allowModel: boolean;
  headless: boolean;
  executablePath?: string;
}

function parseArguments(arguments_: readonly string[]): CliOptions {
  let allowEdit = false;
  let allowAssets = false;
  let allowModel = false;
  let headless = false;
  let executablePath: string | undefined;
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]!;
    if (argument === '--allow-edit') {
      allowEdit = true;
      continue;
    }
    if (argument === '--allow-assets') {
      allowAssets = true;
      continue;
    }
    if (argument === '--allow-model') {
      allowModel = true;
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
    throw new Error('Unknown companion option.');
  }
  return {
    allowEdit,
    allowAssets,
    allowModel,
    headless,
    ...(executablePath ? { executablePath } : {}),
  };
}

function diagnostic(message: string): void {
  process.stderr.write(`[gfx-mcp] ${message}\n`);
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  let shutdownPromise: Promise<void> | null = null;
  let stdio: ReturnType<typeof createBoundedStdio> | null = null;
  let server: ReturnType<typeof createToolServer> | null = null;
  const runtime = new CompanionRuntime({
    ...options,
    onBrowserDisconnected: () => {
      diagnostic('Chrome disconnected; the Agent session was revoked');
    },
    onBridgeTerminated: (reason) => {
      // Keep stdio alive long enough to return the terminal structured fault.
      // The runtime independently closes its browser and loopback host.
      diagnostic(`bridge ended (${reason}); waiting for MCP client shutdown`);
    },
  });

  const shutdown = (reason: string): Promise<void> => {
    shutdownPromise ??= (async () => {
      diagnostic(`shutting down (${reason})`);
      stdio?.detach();
      await server?.close().catch(() => undefined);
      await runtime.close();
    })();
    return shutdownPromise;
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT').finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM').finally(() => process.exit(0));
  });
  process.stdin.once('end', () => {
    void shutdown('stdio EOF');
  });

  try {
    await runtime.start();
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }
    diagnostic('local app host is listening on http://127.0.0.1:5199');
    const requestedScopes = [
      'read',
      'preview',
      ...(options.allowEdit ? ['edit'] : []),
      ...(options.allowAssets ? ['assets'] : []),
      ...(options.allowModel ? ['model'] : []),
    ];
    diagnostic(
      `Chrome launched; waiting for human approval of ${
        requestedScopes.join(', ')
      } scopes`,
    );

    server = createToolServer({
      bridge: runtime.bridge,
      allowEdit: options.allowEdit,
      allowAssets: options.allowAssets,
      allowModel: options.allowModel,
      ...(runtime.modelManager
        ? { modelManager: runtime.modelManager }
        : {}),
    });
    stdio = createBoundedStdio();
    stdio.input.once('error', () => {
      diagnostic('stdio rejected invalid input');
      void shutdown('invalid stdio input');
    });
    stdio.output.once('error', () => {
      diagnostic('stdio rejected invalid output');
      void shutdown('invalid stdio output');
    });
    await server.connect(stdio.transport);
  } catch (error) {
    await shutdown('startup failure');
    throw error;
  }
}

main().catch(() => {
  diagnostic('The companion failed to start.');
  process.exitCode = 1;
});
