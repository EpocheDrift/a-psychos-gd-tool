export interface AgentLimits {
  maxDocumentJsonBytes: number;
  maxLayers: number;
  maxNodesPerLayer: number;
  maxNodesPerDocument: number;
  maxEdgesPerLayer: number;
  minFrameSide: number;
  maxFrameSide: number;
  maxFramePixels: number;
  maxIdLength: number;
  maxNameLength: number;
  maxStringBytes: number;
  maxExpressionBytes: number;
  maxLegacyAssetBytes: number;
  maxAssetPixels: number;
  maxLegacyAssetBytesPerDocument: number;
  maxBinds: number;
  maxGeneratedItems: number;
  maxFindings: number;
  maxTransactionJsonBytes: number;
  maxTransactionCommands: number;
  maxClientRefs: number;
  maxTouchedNodes: number;
  maxRequestCacheEntries: number;
  maxTransactionLedgerEntries: number;
  maxTransactionLedgerBytes: number;
  maxPreviewSide: number;
  maxPreviewBytes: number;
  renderDeadlineMs: number;
}

export const DEFAULT_AGENT_LIMITS: Readonly<AgentLimits> = Object.freeze({
  maxDocumentJsonBytes: 2 * 1024 * 1024,
  maxLayers: 32,
  maxNodesPerLayer: 256,
  maxNodesPerDocument: 1024,
  maxEdgesPerLayer: 1024,
  minFrameSide: 16,
  maxFrameSide: 4096,
  maxFramePixels: 4096 * 4096,
  maxIdLength: 128,
  maxNameLength: 128,
  maxStringBytes: 64 * 1024,
  maxExpressionBytes: 2 * 1024,
  maxLegacyAssetBytes: 20 * 1024 * 1024,
  maxAssetPixels: 32 * 1024 * 1024,
  maxLegacyAssetBytesPerDocument: 64 * 1024 * 1024,
  maxBinds: 64,
  maxGeneratedItems: 100_000,
  maxFindings: 256,
  maxTransactionJsonBytes: 2 * 1024 * 1024,
  maxTransactionCommands: 100,
  maxClientRefs: 100,
  maxTouchedNodes: 200,
  maxRequestCacheEntries: 256,
  maxTransactionLedgerEntries: 256,
  maxTransactionLedgerBytes: 256 * 1024 * 1024,
  maxPreviewSide: 1024,
  maxPreviewBytes: 4 * 1024 * 1024,
  renderDeadlineMs: 30_000,
});

export function resolveAgentLimits(overrides: Partial<AgentLimits> = {}): AgentLimits {
  const limits = { ...DEFAULT_AGENT_LIMITS } as AgentLimits;
  for (const [name, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(DEFAULT_AGENT_LIMITS, name)) {
      throw new RangeError(`Unknown Agent limit: ${name}`);
    }
    (limits as unknown as Record<string, number>)[name] = value as number;
  }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
  }
  if (limits.maxFindings > 4096) {
    throw new RangeError('maxFindings cannot exceed the hard response cap of 4096');
  }
  if (limits.minFrameSide > limits.maxFrameSide) {
    throw new RangeError('minFrameSide cannot exceed maxFrameSide');
  }
  if (limits.maxFramePixels < limits.minFrameSide * limits.minFrameSide) {
    throw new RangeError('maxFramePixels cannot be smaller than the minimum frame');
  }
  return limits;
}
