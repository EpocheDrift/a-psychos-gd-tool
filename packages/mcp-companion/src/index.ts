#!/usr/bin/env node
import process from 'node:process';
import { createBoundedStdio } from './boundedStdio.js';
import { CompanionRuntime } from './runtime.js';
import { createToolServer } from './tools.js';

interface CliOptions {
  allowEdit: boolean;
  headless: boolean;
  executablePath?: string;
}

function parseArguments(arguments_: readonly string[]): CliOptions {
  let allowEdit = false;
  let headless = false;
  let executablePath: string | undefined;
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]!;
    if (argument === '--allow-edit') {
      allowEdit = true;
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
    throw new Error(`Unknown companion option: ${argument}`);
  }
  return {
    allowEdit,
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
    diagnostic(
      options.allowEdit
        ? 'Chrome launched; waiting for human approval of read, preview, and edit scopes'
        : 'Chrome launched; waiting for human approval of read and preview scopes',
    );

    server = createToolServer({
      bridge: runtime.bridge,
      allowEdit: options.allowEdit,
    });
    stdio = createBoundedStdio();
    stdio.input.once('error', (error) => {
      diagnostic(`stdio rejected input: ${error.message}`);
      void shutdown('invalid stdio input');
    });
    stdio.output.once('error', (error) => {
      diagnostic(`stdio rejected output: ${error.message}`);
      void shutdown('invalid stdio output');
    });
    await server.connect(stdio.transport);
  } catch (error) {
    await shutdown('startup failure');
    throw error;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error
    ? error.message
    : 'The companion failed to start.';
  diagnostic(message);
  process.exitCode = 1;
});
