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
  maxVectorPaths: number;
  maxVectorCommands: number;
  maxCanvasPaintPaths: number;
  maxCanvasPaintCommands: number;
  maxFlattenedPoints: number;
  maxBooleanPoints: number;
  maxGeometryWorkUnits: number;
  maxRenderableGlyphs: number;
  maxFindings: number;
  maxTransactionJsonBytes: number;
  maxTransactionCommands: number;
  maxClientRefs: number;
  maxTouchedNodes: number;
  maxRequestCacheEntries: number;
  maxTransactionLedgerEntries: number;
  maxTransactionLedgerBytes: number;
  maxPendingWorkerRequests: number;
  maxPendingWorkerBytes: number;
  maxGpuTextureBytes: number;
  maxGpuFreeTextureBytes: number;
  maxGpuTextures: number;
  maxGpuPasses: number;
  maxGpuPixelWork: number;
  maxPreviewSide: number;
  maxPreviewBytes: number;
  maxPendingPreviewRequests: number;
  maxPendingPreviewBytes: number;
  maxPreviewEncodeAttempts: number;
  previewDeadlineMs: number;
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
  // Runtime geometry limits are attempt-scoped. They bound work that cannot be
  // predicted statically from dynamic Trace, font, or duplicated path output.
  maxVectorPaths: 250_000,
  maxVectorCommands: 250_000,
  // Canvas2D fill/stroke/clip calls are opaque, synchronous native work. Bound
  // each combined Path2D independently so one call cannot monopolize the main
  // thread even when the attempt-wide geometry budget still has headroom.
  maxCanvasPaintPaths: 10_000,
  maxCanvasPaintCommands: 25_000,
  maxFlattenedPoints: 1_000_000,
  maxBooleanPoints: 10_000,
  maxGeometryWorkUnits: 4_000_000,
  maxRenderableGlyphs: 16_384,
  maxFindings: 256,
  maxTransactionJsonBytes: 2 * 1024 * 1024,
  maxTransactionCommands: 100,
  maxClientRefs: 100,
  maxTouchedNodes: 200,
  maxRequestCacheEntries: 256,
  maxTransactionLedgerEntries: 256,
  maxTransactionLedgerBytes: 256 * 1024 * 1024,
  maxPendingWorkerRequests: 4,
  maxPendingWorkerBytes: 128 * 1024 * 1024,
  // The shipped four-layer 2480×3508 factory document keeps a last successful
  // evaluator generation while a changed Blur/Output pair cooks. 512 MiB
  // rejects that supported edit; 768 MiB preserves the transactional cache
  // guarantee while remaining a deterministic, advertised hard ceiling.
  maxGpuTextureBytes: 768 * 1024 * 1024,
  maxGpuFreeTextureBytes: 128 * 1024 * 1024,
  maxGpuTextures: 512,
  maxGpuPasses: 2_048,
  // The factory document deliberately renders ~1,000 eroding elements as
  // isolated full-frame Canvas2D flushes. Pass count remains the primary queue
  // cap; this secondary pixel-equivalent cap must preserve that shipped case.
  maxGpuPixelWork: 32_000_000_000,
  maxPreviewSide: 1024,
  maxPreviewBytes: 4 * 1024 * 1024,
  // Preview readback is at most 4 MiB of RGBA at 1024². Keep only a small,
  // explicitly byte-accounted worker queue so callers cannot turn evidence
  // capture into an unbounded main-memory buffer.
  maxPendingPreviewRequests: 4,
  maxPendingPreviewBytes: 16 * 1024 * 1024,
  maxPreviewEncodeAttempts: 6,
  previewDeadlineMs: 15_000,
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
