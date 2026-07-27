import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_ALLOWED_ORIGIN,
  AGENT_COMPANION_META_VALUE,
  AGENT_WEBSOCKET_PROTOCOL,
} from '../../packages/mcp-companion/src/agentSecurity';
import {
  COMPANION_PROTOCOL_VERSION,
} from '../../packages/mcp-companion/src/protocol';
import type {
  AgentController,
  PublicValidationReport,
} from './contracts';
import { installLocalCompanionBridge } from './localCompanionBridge';
import type { AgentSessionManager } from './sessionManager';

type SocketEvent = { data?: unknown };
type SocketListener = (event: SocketEvent) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly sent: unknown[] = [];
  readonly listeners = new Map<string, Set<SocketListener>>();
  readyState = FakeWebSocket.OPEN;
  binaryType = '';

  constructor(
    readonly url: string,
    readonly protocol: string,
  ) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? new Set<SocketListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(value: unknown): void {
    this.sent.push(value);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', {});
  }

  emit(type: string, event: SocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeHtmlMetaElement {
  constructor(readonly content: string) {}
}

afterEach(() => {
  FakeWebSocket.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('local companion bridge', () => {
  it('awaits async document validation before serializing its response', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('HTMLMetaElement', FakeHtmlMetaElement);
    const marker = new FakeHtmlMetaElement(AGENT_COMPANION_META_VALUE);
    const target = {
      document: {
        querySelector: vi.fn(() => marker),
      },
      location: {
        origin: AGENT_ALLOWED_ORIGIN,
      },
    } as unknown as Window;
    let resolveValidation!: (value: PublicValidationReport) => void;
    const validation = new Promise<PublicValidationReport>((resolve) => {
      resolveValidation = resolve;
    });
    const validateDocument = vi.fn(() => validation);
    const controller = {
      validateDocument,
    } as unknown as AgentController;
    const manager = {
      getSnapshot: () => ({ phase: 'connected' }),
      subscribe: () => () => undefined,
      revoke: vi.fn(),
    } as unknown as AgentSessionManager;

    const dispose = installLocalCompanionBridge(target, {
      manager,
      completePairing: () => {
        throw new Error('Pairing is not part of this test.');
      },
      getController: () => controller,
      getCompanionController: () => undefined,
      getPreviewVault: () => null,
    });
    const socket = FakeWebSocket.instances[0]!;
    expect(socket.protocol).toBe(AGENT_WEBSOCKET_PROTOCOL);
    socket.emit('message', {
      data: JSON.stringify({
        kind: 'welcome',
        protocolVersion: COMPANION_PROTOCOL_VERSION,
        connectionId: 'C'.repeat(22),
        serverNonce: 'N'.repeat(43),
      }),
    });
    expect(socket.sent).toHaveLength(1);
    const hello = JSON.parse(socket.sent[0] as string) as {
      channelToken: string;
    };

    socket.emit('message', {
      data: JSON.stringify({
        kind: 'request',
        protocolVersion: COMPANION_PROTOCOL_VERSION,
        connectionId: 'C'.repeat(22),
        channelToken: hello.channelToken,
        sequence: 1,
        requestId: 'R'.repeat(22),
        operation: 'validateDocument',
        input: {
          source: 'current',
          mode: 'renderable',
        },
      }),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(validateDocument).toHaveBeenCalledOnce();
    expect(socket.sent).toHaveLength(1);

    const expected: PublicValidationReport = {
      trust: 'untrusted-document-content',
      report: {
        valid: false,
        mode: 'renderable',
        schemaVersion: 4,
        errors: [{
          severity: 'error',
          code: 'PERSISTENCE_FAILED',
          message: 'missing bytes',
          path: '/assets/0',
          recoverable: true,
        }],
        warnings: [],
      },
    };
    resolveValidation(expected);
    await vi.waitFor(() => {
      expect(socket.sent).toHaveLength(2);
    });
    const response = JSON.parse(socket.sent[1] as string) as {
      ok: boolean;
      value: unknown;
    };
    expect(response).toMatchObject({
      ok: true,
      value: expected,
    });
    expect(response.value).not.toEqual({});
    expect(
      response.value
      && typeof response.value === 'object'
      && 'then' in response.value,
    ).toBe(false);
    dispose();
  });
});
