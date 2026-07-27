import { describe, expect, it } from 'vitest';
import type { PublicModelStatus } from '../../packages/mcp-companion/src/modelPublicContract';
import { isModelPreparationPollingComplete } from './AgentConnectionPanel';

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
