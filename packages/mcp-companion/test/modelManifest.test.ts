import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MODEL_FILES_PATH_PREFIX,
  MODEL_PREPARE_PATH,
  MODEL_STATUS_PATH,
  RMBG_MODEL_FILES_PATH_PREFIX,
  RMBG_MODEL_MANIFEST,
  RMBG_MODEL_MANIFEST_SHA256,
  assertModelManifest,
  assertPinnedRmbgManifest,
  modelArtifactIdFromLocalPath,
  modelArtifactLocalPath,
  modelArtifactSourceUrl,
  modelManifestCanonicalJson,
  totalModelBytes,
  type ModelManifest,
} from '../src/modelManifest.js';

describe('pinned RMBG model manifest', () => {
  it('pins revision, artifact sizes, hashes, and license', () => {
    expect(RMBG_MODEL_MANIFEST.revision).toBe(
      '2ceba5a5efaec153162aedea169f76caf9b46cf8',
    );
    expect(RMBG_MODEL_MANIFEST.artifacts).toEqual([
      {
        id: 'preprocessor-config',
        relativePath: 'preprocessor_config.json',
        byteLength: 345,
        sha256:
          '6f9c2cfdb87edd9b83c1314629657d5b320a6a89f8481c872a36253132e33afa',
        mediaType: 'application/json',
      },
      {
        id: 'onnx-fp32',
        relativePath: 'onnx/model.onnx',
        byteLength: 176_153_355,
        sha256:
          '8cafcf770b06757c4eaced21b1a88e57fd2b66de01b8045f35f01535ba742e0f',
        mediaType: 'application/octet-stream',
      },
      {
        id: 'onnx-q8',
        relativePath: 'onnx/model_quantized.onnx',
        byteLength: 44_403_226,
        sha256:
          'a6648479275dfd0ede0f3a8abc20aa5c437b394681b05e5af6d268250aaf40f3',
        mediaType: 'application/octet-stream',
      },
    ]);
    expect(totalModelBytes(RMBG_MODEL_MANIFEST)).toBe(220_556_926);
    expect(RMBG_MODEL_MANIFEST.license).toMatchObject({
      id: 'bria-rmbg-1.4',
      commercialUse: 'separate-agreement-required',
    });
    expect(Object.isFrozen(RMBG_MODEL_MANIFEST)).toBe(true);
    expect(Object.isFrozen(RMBG_MODEL_MANIFEST.artifacts)).toBe(true);
    expect(Object.isFrozen(RMBG_MODEL_MANIFEST.artifacts[0])).toBe(true);
  });

  it('pins the canonical manifest digest and fixed local routes', () => {
    const digest = createHash('sha256')
      .update(modelManifestCanonicalJson(RMBG_MODEL_MANIFEST))
      .digest('hex');
    expect(digest).toBe(RMBG_MODEL_MANIFEST_SHA256);
    expect(() => assertPinnedRmbgManifest(
      RMBG_MODEL_MANIFEST,
      digest,
    )).not.toThrow();
    expect(() => assertPinnedRmbgManifest(
      RMBG_MODEL_MANIFEST,
      '0'.repeat(64),
    )).toThrow('changed unexpectedly');

    expect(MODEL_STATUS_PATH).toBe('/__gfx_model_v1/status');
    expect(MODEL_PREPARE_PATH).toBe('/__gfx_model_v1/prepare');
    expect(MODEL_FILES_PATH_PREFIX).toBe('/__gfx_model_v1/files/');
    expect(RMBG_MODEL_FILES_PATH_PREFIX).toBe(
      '/__gfx_model_v1/files/briaai/RMBG-1.4/',
    );
    expect(modelArtifactLocalPath(
      RMBG_MODEL_MANIFEST,
      'onnx-fp32',
    )).toBe(
      '/__gfx_model_v1/files/briaai/RMBG-1.4/onnx/model.onnx',
    );
    expect(modelArtifactIdFromLocalPath(
      RMBG_MODEL_MANIFEST,
      '/__gfx_model_v1/files/briaai/RMBG-1.4/onnx/model.onnx',
    )).toBe('onnx-fp32');
    expect(modelArtifactIdFromLocalPath(
      RMBG_MODEL_MANIFEST,
      '/__gfx_model_v1/files/../../secret',
    )).toBeNull();
  });

  it('derives only a pinned revision URL from an artifact id', () => {
    expect(modelArtifactSourceUrl(
      RMBG_MODEL_MANIFEST,
      'onnx-q8',
    ).toString()).toBe(
      'https://huggingface.co/briaai/RMBG-1.4/resolve/'
      + '2ceba5a5efaec153162aedea169f76caf9b46cf8/'
      + 'onnx/model_quantized.onnx',
    );
    expect(() => modelArtifactSourceUrl(
      RMBG_MODEL_MANIFEST,
      'https://attacker.invalid/model',
    )).toThrow('not in the fixed manifest');
  });

  it('rejects traversal and duplicate paths in injected manifests', () => {
    const unsafe = {
      ...RMBG_MODEL_MANIFEST,
      artifacts: [{
        ...RMBG_MODEL_MANIFEST.artifacts[0],
        relativePath: '../outside.bin',
      }],
    } as ModelManifest;
    expect(() => assertModelManifest(unsafe)).toThrow('invalid artifact');

    const duplicate = {
      ...RMBG_MODEL_MANIFEST,
      artifacts: [
        RMBG_MODEL_MANIFEST.artifacts[0],
        {
          ...RMBG_MODEL_MANIFEST.artifacts[0],
          id: 'duplicate',
        },
      ],
    } as ModelManifest;
    expect(() => assertModelManifest(duplicate)).toThrow('invalid artifact');
  });
});
