import { describe, expect, it } from 'vitest';
import {
  PreviewCaptureError,
  PreviewCaptureService,
  fitPreviewDimensions,
  normalizePreviewRequest,
} from './preview';
import type { PreviewResult } from './preview';

describe('preview request contract', () => {
  it('applies bounded evidence defaults', () => {
    expect(normalizePreviewRequest({ revision: 4 })).toEqual({
      revision: 4,
      maxWidth: 768,
      maxHeight: 768,
      format: 'png',
      includeMetrics: true,
    });
  });

  it('supports exact attempts, one-sided bounds, and WebP', () => {
    expect(normalizePreviewRequest({
      revision: 4,
      attempt: 2,
      maxWidth: 512,
      format: 'webp',
      includeMetrics: false,
    })).toEqual({
      revision: 4,
      attempt: 2,
      maxWidth: 512,
      maxHeight: 1024,
      format: 'webp',
      includeMetrics: false,
    });
  });

  it.each([
    [null, 'plain object'],
    [{ revision: -1 }, 'revision'],
    [{ revision: 1.5 }, 'revision'],
    [{ revision: 1, attempt: 0 }, 'attempt'],
    [{ revision: 1, maxWidth: 0 }, 'maxWidth'],
    [{ revision: 1, maxHeight: 1025 }, 'cannot exceed'],
    [{ revision: 1, format: 'jpeg' }, 'format'],
    [{ revision: 1, format: null }, 'format'],
    [{ revision: 1, includeMetrics: 'yes' }, 'includeMetrics'],
    [{ revision: 1, includeMetrics: null }, 'includeMetrics'],
    [{ revision: 1, surprise: true }, 'Unknown'],
  ])('rejects invalid request %#', (request, message) => {
    expect(() => normalizePreviewRequest(request)).toThrow(message);
  });

  it('uses stable error codes for policy failures', () => {
    try {
      normalizePreviewRequest({ revision: 1, maxWidth: 2048 });
      throw new Error('expected request rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PreviewCaptureError);
      expect((error as PreviewCaptureError).code).toBe('RESOURCE_LIMIT');
    }
  });
});

describe('preview queue attempt binding', () => {
  it('binds every revision-only request before admission, not when it becomes active', async () => {
    let currentAttempt = 1;
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const executedAttempts: number[] = [];
    let executionCount = 0;
    const service = new PreviewCaptureService(
      async (request) => {
        executedAttempts.push(request.attempt);
        if (executionCount++ === 0) await firstBlocked;
        return {
          requestedRevision: request.revision,
          revision: request.revision,
          attempt: request.attempt,
        } as PreviewResult;
      },
      (request) => ({
        ...request,
        attempt: request.attempt ?? currentAttempt,
      }),
    );

    const first = service.capture({ revision: 4 });
    const second = service.capture({ revision: 4 });
    currentAttempt = 2;
    releaseFirst();

    await expect(first).resolves.toMatchObject({ attempt: 1 });
    await expect(second).resolves.toMatchObject({ attempt: 1 });
    expect(executedAttempts).toEqual([1, 1]);
    await expect(service.whenIdle()).resolves.toBeUndefined();
  });
});

describe('preview dimensions', () => {
  it('preserves aspect ratio without upscaling', () => {
    expect(fitPreviewDimensions(4096, 2048, 1024, 1024)).toEqual({
      width: 1024,
      height: 512,
    });
    expect(fitPreviewDimensions(320, 200, 1024, 1024)).toEqual({
      width: 320,
      height: 200,
    });
    expect(fitPreviewDimensions(1, 4096, 1024, 768)).toEqual({
      width: 1,
      height: 768,
    });
  });
});
