import { describe, expect, it, vi } from 'vitest';
import type {
  AgentScope,
  CompletePairingRequest,
  PairingChallenge,
  PairingRequest,
} from './contracts';
import {
  AgentSessionManager,
  type AgentSessionLease,
} from './sessionManager';
import type { AgentRuntimeContext } from './runtimeGate';

const origin = 'http://127.0.0.1:5199';
const clientNonce = 'A'.repeat(43);

function runtimeContext(): AgentRuntimeContext {
  return {
    origin,
    host: '127.0.0.1:5199',
    hostname: '127.0.0.1',
    protocol: 'http:',
    topLevel: true,
    secureContext: true,
  };
}

function harness() {
  let now = 1_700_000_000_000;
  let randomSequence = 0;
  let context = runtimeContext();
  const manager = new AgentSessionManager({
    allowedOrigin: origin,
    context: () => context,
    now: () => now,
    randomBytes: (length) =>
      new Uint8Array(length).fill((++randomSequence % 250) + 1),
    setTimer: (() => 1) as unknown as typeof setTimeout,
    clearTimer: vi.fn(),
  });
  return {
    manager,
    advance: (milliseconds: number) => {
      now += milliseconds;
      manager.sweep();
    },
    setContext: (next: AgentRuntimeContext) => {
      context = next;
    },
  };
}

function request(
  manager: AgentSessionManager,
  scopes: AgentScope[] = ['read'],
): PairingChallenge {
  expect(manager.armPairing()).toMatchObject({ ok: true });
  const result = manager.requestPairing({
    protocolVersion: '1.0',
    clientNonce,
    clientLabel: 'test companion',
    requestedScopes: scopes,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('pairing request failed');
  return result.value;
}

function complete(
  manager: AgentSessionManager,
  challenge: PairingChallenge,
  scopes: AgentScope[] = ['read'],
): AgentSessionLease {
  expect(manager.approvePairing(scopes)).toMatchObject({ ok: true });
  const result = manager.completePairing({
    pairingId: challenge.pairingId,
    clientNonce: challenge.clientNonce,
    serverNonce: challenge.serverNonce,
    claimToken: challenge.claimToken,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('pairing completion failed');
  return result.value.lease;
}

function caught(action: () => void): unknown {
  try {
    action();
    return null;
  } catch (error) {
    return error;
  }
}

describe('AgentSessionManager', () => {
  it('requires human arming and approval, grants only an available requested subset', () => {
    const { manager } = harness();
    expect(manager.requestPairing({
      protocolVersion: '1.0',
      clientNonce,
      clientLabel: 'untrusted label',
      requestedScopes: ['read'],
    })).toMatchObject({
      ok: false,
      error: { code: 'PAIRING_NOT_ARMED' },
    });

    const challenge = request(manager, ['read', 'preview', 'assets']);
    expect(manager.getSnapshot()).toMatchObject({
      phase: 'pending',
      requestedScopes: ['read', 'preview', 'assets'],
      grantedScopes: [],
    });
    expect(JSON.stringify(manager.getSnapshot())).not.toContain(
      challenge.claimToken,
    );
    expect(JSON.stringify(manager.getSnapshot())).not.toContain(
      challenge.serverNonce,
    );
    expect(manager.approvePairing(['assets'])).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
    const lease = complete(manager, challenge, ['read', 'preview']);
    expect([...lease.scopes]).toEqual(['read', 'preview']);
    expect(Object.isFrozen(lease.scopes)).toBe(true);
    expect('add' in lease.scopes).toBe(false);
    expect(manager.getSnapshot()).toMatchObject({
      phase: 'connected',
      grantedScopes: ['read', 'preview'],
    });
  });

  it('rejects control and bidirectional formatting in untrusted client labels', () => {
    for (const label of ['safe\u202Eevil', 'safe\u2066evil', 'safe\nfake']) {
      const { manager } = harness();
      expect(manager.armPairing()).toMatchObject({ ok: true });
      expect(manager.requestPairing({
        protocolVersion: '1.0',
        clientNonce,
        clientLabel: label,
        requestedScopes: ['read'],
      })).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT', path: '/clientLabel' },
      });
      expect(manager.getSnapshot().phase).toBe('armed');
    }
  });

  it('consumes the one-shot proof, rejects replay, and enforces one owner', () => {
    const { manager } = harness();
    const challenge = request(manager, ['read']);
    complete(manager, challenge);
    expect(manager.completePairing({
      pairingId: challenge.pairingId,
      clientNonce: challenge.clientNonce,
      serverNonce: challenge.serverNonce,
      claimToken: challenge.claimToken,
    })).toMatchObject({
      ok: false,
      error: { code: 'PAIRING_REPLAYED' },
    });
    expect(manager.armPairing()).toMatchObject({
      ok: false,
      error: { code: 'OWNER_ALREADY_CONNECTED' },
    });
  });

  it('revokes a challenge after repeated wrong proofs without exposing which field failed', () => {
    const { manager } = harness();
    const challenge = request(manager, ['read']);
    expect(manager.approvePairing(['read'])).toMatchObject({ ok: true });
    const wrong: CompletePairingRequest = {
      pairingId: challenge.pairingId,
      clientNonce: challenge.clientNonce,
      serverNonce: challenge.serverNonce,
      claimToken: 'B'.repeat(43),
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(manager.completePairing(wrong)).toMatchObject({
        ok: false,
        error: { code: 'UNAUTHENTICATED' },
      });
    }
    expect(manager.getSnapshot()).toMatchObject({
      phase: 'revoked',
      error: { code: 'SESSION_REVOKED' },
    });
  });

  it('expires and revokes retained leases, including on runtime-origin change', () => {
    const first = harness();
    const firstLease = complete(first.manager, request(first.manager));
    first.advance(31 * 60_000);
    expect(caught(() =>
      first.manager.assertActive(firstLease, 7, 'read'))).toMatchObject({
      error: { code: 'SESSION_EXPIRED' },
    });
    expect(firstLease.signal.aborted).toBe(true);

    const second = harness();
    const secondLease = complete(second.manager, request(second.manager));
    second.setContext({
      ...runtimeContext(),
      origin: 'http://127.0.0.1:5200',
      host: '127.0.0.1:5200',
    });
    expect(caught(() =>
      second.manager.assertActive(secondLease, 8, 'read'))).toMatchObject({
      error: { code: 'ORIGIN_NOT_ALLOWED' },
    });
    expect(secondLease.signal.aborted).toBe(true);
  });

  it('keeps transaction replay and revert state private to each fresh session', () => {
    const { manager } = harness();
    const first = complete(manager, request(manager));
    expect(first.transactions.getStats()).toEqual({
      replayEntries: 0,
      ledgerEntries: 0,
      ledgerBytes: 0,
    });
    manager.revoke('human');
    expect(() => first.transactions.captureApply({})).toThrow(/destroyed/);
    manager.resetToIdle();
    const second = complete(manager, request(manager));
    expect(second.transactions).not.toBe(first.transactions);
    expect(second.transactions.getStats()).toEqual({
      replayEntries: 0,
      ledgerEntries: 0,
      ledgerBytes: 0,
    });
    expect(caught(() => manager.assertActive(first, 0, 'read'))).toMatchObject({
      error: { code: 'SESSION_REVOKED' },
    });
  });

  it('does not invoke accessors while rejecting a hostile pairing request', () => {
    const { manager } = harness();
    expect(manager.armPairing()).toMatchObject({ ok: true });
    const getter = vi.fn(() => '1.0');
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, 'protocolVersion', {
      enumerable: true,
      get: getter,
    });
    hostile.clientNonce = clientNonce;
    hostile.clientLabel = 'hostile';
    hostile.requestedScopes = ['read'];
    expect(manager.requestPairing(hostile as PairingRequest)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(getter).not.toHaveBeenCalled();
  });
});
