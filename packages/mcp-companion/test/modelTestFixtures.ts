import { createHash } from 'node:crypto';
import type {
  ModelArtifactDownloader,
  OpenedModelArtifact,
} from '../src/modelDownloader.js';
import type { ModelManifest } from '../src/modelManifest.js';

export const FIXTURE_REVISION =
  '2ceba5a5efaec153162aedea169f76caf9b46cf8';

export const FIXTURE_MODEL_FILES = Object.freeze({
  'preprocessor-config': Buffer.from('{"fixture":true}\n'),
  'onnx-fp32': Buffer.from([0x08, 0x01, 0x12, 0x03, 0x6f, 0x6e, 0x78]),
  'onnx-q8': Buffer.from([0x08, 0x08, 0x12, 0x02, 0x71, 0x38]),
});

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function fixtureModelManifest(): ModelManifest {
  return {
    schemaVersion: 1,
    modelKey: 'rmbg-1.4',
    displayName: 'BRIA RMBG 1.4 fixture',
    repository: 'briaai/RMBG-1.4',
    revision: FIXTURE_REVISION,
    license: {
      id: 'bria-rmbg-1.4',
      name: 'BRIA RMBG 1.4 fixture license',
      summary: 'Small non-production fixture for model manager tests.',
      commercialUse: 'separate-agreement-required',
      termsUrl:
        'https://bria.ai/bria-huggingface-model-license-agreement/',
      sourceUrl: 'https://huggingface.co/briaai/RMBG-1.4',
    },
    artifacts: [
      {
        id: 'preprocessor-config',
        relativePath: 'preprocessor_config.json',
        byteLength:
          FIXTURE_MODEL_FILES['preprocessor-config'].byteLength,
        sha256: digest(FIXTURE_MODEL_FILES['preprocessor-config']),
        mediaType: 'application/json',
      },
      {
        id: 'onnx-fp32',
        relativePath: 'onnx/model.onnx',
        byteLength: FIXTURE_MODEL_FILES['onnx-fp32'].byteLength,
        sha256: digest(FIXTURE_MODEL_FILES['onnx-fp32']),
        mediaType: 'application/octet-stream',
      },
      {
        id: 'onnx-q8',
        relativePath: 'onnx/model_quantized.onnx',
        byteLength: FIXTURE_MODEL_FILES['onnx-q8'].byteLength,
        sha256: digest(FIXTURE_MODEL_FILES['onnx-q8']),
        mediaType: 'application/octet-stream',
      },
    ],
  };
}

async function* chunks(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  const midpoint = Math.max(1, Math.floor(bytes.byteLength / 2));
  yield bytes.subarray(0, midpoint);
  if (midpoint < bytes.byteLength) {
    yield bytes.subarray(midpoint);
  }
}

export class FixtureModelDownloader implements ModelArtifactDownloader {
  readonly openCalls: string[] = [];
  closeCalls = 0;
  private readonly files: Readonly<Record<string, Uint8Array>>;

  constructor(
    files: Readonly<Record<string, Uint8Array>> = FIXTURE_MODEL_FILES,
  ) {
    this.files = files;
  }

  async open(
    _manifest: ModelManifest,
    artifactId: string,
    signal: AbortSignal,
  ): Promise<OpenedModelArtifact> {
    if (signal.aborted) throw new Error('fixture aborted');
    this.openCalls.push(artifactId);
    const bytes = this.files[artifactId];
    if (!bytes) throw new Error('missing fixture artifact');
    return {
      body: chunks(bytes),
      contentLength: bytes.byteLength,
      close: () => {
        this.closeCalls++;
      },
    };
  }
}
