import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_ALLOWED_ORIGIN,
  AGENT_COMPANION_CONTROL_META_NAME,
  AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL,
  AGENT_COMPANION_META_VALUE,
  AGENT_COMPANION_META_NAME,
  AGENT_WEBSOCKET_PROTOCOL,
} from '../../packages/mcp-companion/src/agentSecurity';
import {
  COMPANION_PROTOCOL_VERSION,
  TRUSTED_LOCAL_SESSION_TTL_MS,
} from '../../packages/mcp-companion/src/protocol';
import type {
  AgentController,
  PublicValidationReport,
} from './contracts';
import {
  installLocalCompanionBridge,
  localCompanionControlMode,
} from './localCompanionBridge';
import { AgentSessionManager } from './sessionManager';

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
  it('auto-pairs only when the authenticated host marks trusted-local mode', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('HTMLMetaElement', FakeHtmlMetaElement);
    const target = {
      document: {
        querySelector: vi.fn((selector: string) => {
          if (selector.includes(AGENT_COMPANION_META_NAME)) {
            return new FakeHtmlMetaElement(AGENT_COMPANION_META_VALUE);
          }
          if (selector.includes(AGENT_COMPANION_CONTROL_META_NAME)) {
            return new FakeHtmlMetaElement(
              AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL,
            );
          }
          return null;
        }),
      },
      location: {
        origin: AGENT_ALLOWED_ORIGIN,
      },
    } as unknown as Window;
    const now = 1_700_000_000_000;
    const manager = new AgentSessionManager({
      allowedOrigin: AGENT_ALLOWED_ORIGIN,
      context: () => ({
        origin: AGENT_ALLOWED_ORIGIN,
        host: '127.0.0.1:5199',
        hostname: '127.0.0.1',
        protocol: 'http:',
        topLevel: true,
        secureContext: true,
      }),
      now: () => now,
      sessionTtlMs: TRUSTED_LOCAL_SESSION_TTL_MS,
      setTimer: (() => 1) as unknown as typeof setTimeout,
      clearTimer: vi.fn(),
    });

    const dispose = installLocalCompanionBridge(target, {
      manager,
      completePairing: (request) => {
        const result = manager.completePairing(request);
        return result.ok
          ? { ok: true, value: result.value.summary }
          : result;
      },
      getController: () => undefined,
      getCompanionController: () => undefined,
      getPreviewVault: () => null,
    });
    expect(localCompanionControlMode(target.document)).toBe(
      AGENT_COMPANION_CONTROL_MODE_TRUSTED_LOCAL,
    );
    const socket = FakeWebSocket.instances[0]!;
    socket.emit('message', {
      data: JSON.stringify({
        kind: 'welcome',
        protocolVersion: COMPANION_PROTOCOL_VERSION,
        connectionId: 'C'.repeat(22),
        serverNonce: 'N'.repeat(43),
      }),
    });
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
        requestId: 'P'.repeat(22),
        operation: 'pairRequest',
        input: {
          protocolVersion: '1.0',
          clientNonce: 'A'.repeat(43),
          clientLabel: 'Trusted local test companion',
          requestedScopes: ['read', 'preview', 'edit'],
        },
      }),
    });
    await vi.waitFor(() => {
      expect(socket.sent).toHaveLength(2);
    });
    const response = JSON.parse(socket.sent[1] as string) as {
      ok: boolean;
      value: {
        scopes: string[];
        connectedAt: string;
        expiresAt: string;
      };
    };
    expect(response.ok).toBe(true);
    expect(response.value.scopes).toEqual(['read', 'preview', 'edit']);
    expect(
      Date.parse(response.value.expiresAt)
      - Date.parse(response.value.connectedAt),
    ).toBe(TRUSTED_LOCAL_SESSION_TTL_MS);
    expect(manager.getSnapshot()).toMatchObject({
      phase: 'connected',
      grantedScopes: ['read', 'preview', 'edit'],
    });
    dispose();
  });

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
