import { describe, expect, it } from 'vitest';
import {
  COMPANION_TRANSPORT_LIMITS,
  companionDeadlineMs,
  companionTransportCapabilities,
  isCompanionWriteOperation,
} from '../src/protocol.js';

describe('companion protocol capability profile', () => {
  it('publishes every enforced JSON and operation deadline budget', () => {
    expect(companionTransportCapabilities()).toMatchObject({
      messageLimits: {
        textBytes: COMPANION_TRANSPORT_LIMITS.maxTextMessageBytes,
        binaryHeaderBytes:
          COMPANION_TRANSPORT_LIMITS.maxBinaryHeaderBytes,
        binaryMessageBytes:
          COMPANION_TRANSPORT_LIMITS.maxBinaryMessageBytes,
        previewBytes: COMPANION_TRANSPORT_LIMITS.maxPreviewBytes,
        stdioRequestBytes:
          COMPANION_TRANSPORT_LIMITS.maxStdioLineBytes,
        stdioResponseBytes:
          COMPANION_TRANSPORT_LIMITS.maxStdioOutputLineBytes,
      },
      jsonLimits: {
        depth: COMPANION_TRANSPORT_LIMITS.maxJsonDepth,
        values: COMPANION_TRANSPORT_LIMITS.maxJsonValues,
      },
      deadlines: {
        helloMs: COMPANION_TRANSPORT_LIMITS.helloDeadlineMs,
        queryAndWriteMs: COMPANION_TRANSPORT_LIMITS.defaultDeadlineMs,
        awaitRenderMs: COMPANION_TRANSPORT_LIMITS.renderDeadlineMs,
        previewMs: COMPANION_TRANSPORT_LIMITS.previewDeadlineMs,
        assetMs: COMPANION_TRANSPORT_LIMITS.assetDeadlineMs,
        pairingMs: COMPANION_TRANSPORT_LIMITS.pairingDeadlineMs,
      },
      rate: {
        requestsPerMinute:
          COMPANION_TRANSPORT_LIMITS.requestsPerMinute,
        burst: COMPANION_TRANSPORT_LIMITS.requestBurst,
        assetUploadBurst:
          COMPANION_TRANSPORT_LIMITS.assetUploadRequestBurst,
      },
    });
  });

  it('classifies asset mutations and gives phased upload its own deadline', () => {
    expect(isCompanionWriteOperation('putAsset')).toBe(true);
    expect(isCompanionWriteOperation('removeAsset')).toBe(true);
    expect(isCompanionWriteOperation('listAssets')).toBe(false);
    expect(isCompanionWriteOperation('getAssetMetadata')).toBe(false);
    expect(companionDeadlineMs('putAsset')).toBe(
      COMPANION_TRANSPORT_LIMITS.assetDeadlineMs,
    );
    expect(companionDeadlineMs('removeAsset')).toBe(
      COMPANION_TRANSPORT_LIMITS.defaultDeadlineMs,
    );
  });
});
