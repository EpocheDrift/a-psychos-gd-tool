import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PublicModelStatus } from '../../packages/mcp-companion/src/modelPublicContract';
import type {
  AgentConnectionSnapshot,
  AgentSessionManager,
} from './sessionManager';
import {
  AgentConnectionPanel,
  defaultRequestedAgentScopes,
  isModelPreparationPollingComplete,
} from './AgentConnectionPanel';

function status(
  state: PublicModelStatus['state'],
  error?: PublicModelStatus['error'],
): PublicModelStatus {
  return {
    schemaVersion: 1,
    modelKey: 'rmbg-1.4',
    revision: '0'.repeat(40),
    manifestSha256: '0'.repeat(64),
    state,
    bytes: 0,
    totalBytes: 1,
    artifacts: [],
    license: {
      id: 'bria-rmbg-1.4',
      name: 'fixture',
      summary: 'fixture',
      commercialUse: 'separate-agreement-required',
      requiresExplicitApproval: true,
    },
    ...(error ? { error } : {}),
  };
}

describe('Agent model preparation polling', () => {
  it('stops for ready, failed, and approval failures but not progress', () => {
    expect(isModelPreparationPollingComplete(null)).toBe(false);
    expect(isModelPreparationPollingComplete(status('downloading')))
      .toBe(false);
    expect(isModelPreparationPollingComplete(status('approval-required')))
      .toBe(false);
    expect(isModelPreparationPollingComplete(status(
      'approval-required',
      { code: 'MODEL_APPROVAL_DENIED', recoverable: true },
    ))).toBe(true);
    expect(isModelPreparationPollingComplete(status('failed'))).toBe(true);
    expect(isModelPreparationPollingComplete(status('ready'))).toBe(true);
  });
});

describe('Agent pairing scope defaults', () => {
  it('preselects only requested scopes that are available', () => {
    expect(defaultRequestedAgentScopes(
      ['model', 'read', 'export', 'edit'],
      ['read', 'preview', 'edit', 'model'],
    )).toEqual(['read', 'edit', 'model']);
  });

  it('uses canonical scope order and ignores duplicates', () => {
    expect(defaultRequestedAgentScopes(
      ['edit', 'read', 'edit'],
      ['edit', 'read', 'read'],
    )).toEqual(['read', 'edit']);
  });
});

describe('Agent control mode status', () => {
  it('exposes trusted local control clearly for the connected session', () => {
    const snapshot: AgentConnectionSnapshot = {
      phase: 'connected',
      origin: 'http://127.0.0.1:5199',
      clientLabel: 'Codex',
      clientFingerprint: 'client-1',
      sessionFingerprint: 'session-1',
      requestedScopes: ['read', 'preview', 'edit'],
      grantedScopes: ['read', 'preview', 'edit'],
      availableScopes: ['read', 'preview', 'edit'],
      expiresAt: '2026-07-29T00:00:00.000Z',
      error: null,
    };
    const manager = {
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
    } as unknown as AgentSessionManager;

    const html = renderToStaticMarkup(createElement(AgentConnectionPanel, {
      manager,
      controlMode: 'trusted-local-v1',
    }));

    expect(html).toContain('data-agent-control-mode="trusted-local-v1"');
    expect(html).toContain('Trusted Local connected to Codex.');
    expect(html).toContain('<strong>Trusted Local</strong>');
    expect(html).toContain(
      'automatic control with the granted session scopes',
    );
    expect(html).toContain('data-agent-action="revoke-agent-session"');
  });

  it('does not expose a redundant Connect button while Trusted Local starts', () => {
    const snapshot: AgentConnectionSnapshot = {
      phase: 'idle',
      origin: 'http://127.0.0.1:5199',
      clientLabel: null,
      clientFingerprint: null,
      sessionFingerprint: null,
      requestedScopes: [],
      grantedScopes: [],
      availableScopes: ['read', 'preview'],
      expiresAt: null,
      error: null,
    };
    const manager = {
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
    } as unknown as AgentSessionManager;

    const html = renderToStaticMarkup(createElement(AgentConnectionPanel, {
      manager,
      controlMode: 'trusted-local-v1',
    }));

    expect(html).toContain('Trusted Local is connecting.');
    expect(html).not.toContain('Connect Agent');
  });
});
