import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Doc, Graph } from '../engine/graph';
import { registry } from '../nodes';
import {
  FACTORY_ASSET_METADATA,
  prepareAssetBytes,
} from './assetPolicy';
import type {
  SerializedProjectV3,
  SerializedProjectV4,
} from './documentSchema';
import {
  PORTABLE_PROJECT_FORMAT,
  PORTABLE_PROJECT_VERSION,
  exportDocumentJson,
  exportPortableProjectJson,
  exportProjectJson,
  importProjectJson,
  prepareProjectImport,
} from './projectCodec';

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function fixtureText(name: string): string {
  return readFileSync(
    new URL(`../../test/fixtures/documents/${name}`, import.meta.url),
    'utf8',
  );
}

function fixture<T>(name: string): T {
  return JSON.parse(fixtureText(name)) as T;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('project JSON import/export', () => {
  it('imports every frozen fixture through explicit migration and renderable validation', () => {
    const cases: Array<[string, string]> = [
      ['legacy-single-graph.json', 'legacy-single-graph'],
      ['layered-local-storage.json', 'legacy-layered-document'],
      ['factory-document.json', 'legacy-layered-document'],
      ['visual-small-frame.json', 'legacy-layered-document'],
      ['all-node-types.json', 'legacy-layered-document'],
      ['legacy-weight-image.json', 'legacy-layered-document'],
      ['serialized-project-v3.json', 'project-v3'],
    ];
    for (const [name, source] of cases) {
      const result = importProjectJson(fixtureText(name), {
        documentIdForLegacy: 'fixture_document',
      });
      expect(result, name).toMatchObject({ ok: true, source });
    }
  });

  it('round-trips a valid document through stable canonical project JSON', () => {
    const document = fixture<Doc>('layered-local-storage.json');
    const exported = exportDocumentJson('roundtrip_document', document);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const imported = importProjectJson(exported.json);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.project).toEqual(exported.project);
    const second = exportProjectJson(imported.project);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.json).toBe(exported.json);
    expect(JSON.parse(second.json)).toEqual(exported.project);
  });

  it('reports invalid JSON and parsing preflight limits with stable root errors', () => {
    expect(importProjectJson('{bad json')).toMatchObject({
      ok: false,
      report: {
        errors: [expect.objectContaining({
          code: 'INVALID_ARGUMENT',
          path: '',
        })],
      },
    });
    const oversized = `"${'x'.repeat(1024 * 1024 + 128)}"`;
    expect(importProjectJson(oversized, {
      limits: {
        maxDocumentJsonBytes: 32,
        maxLegacyAssetBytesPerDocument: 32,
      },
    })).toMatchObject({
      ok: false,
      report: {
        errors: [expect.objectContaining({
          code: 'RESOURCE_LIMIT',
          path: '',
        })],
      },
    });
  });

  it('rejects invalid export candidates instead of serializing them', () => {
    const migrated = prepareProjectImport(
      fixture<SerializedProjectV3>('serialized-project-v3.json'),
    );
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const project = migrated.project;
    project.document.layers[0].graph.nodes.out.params.background = 'red';
    expect(exportProjectJson(project)).toMatchObject({
      ok: false,
      report: {
        errors: expect.arrayContaining([
          expect.objectContaining({
            code: 'INVALID_ARGUMENT',
            path: '/document/layers/0/graph/nodes/out/params/background',
          }),
        ]),
      },
    });
  });

  it('performs migration and validation without fetch, Worker, or node cook side effects', () => {
    const fetch = vi.fn();
    const Worker = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('Worker', Worker);
    const cookSpies = [...registry.values()].map((definition) =>
      vi.spyOn(definition, 'cook'));

    const factory = fixture<Doc>('factory-document.json');
    const prepared = prepareProjectImport(factory, {
      documentIdForLegacy: 'side_effect_check',
    });
    expect(prepared.ok).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(Worker).not.toHaveBeenCalled();
    expect(cookSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it('does not mutate a failed legacy candidate after partial compatibility rewrites', () => {
    const legacy = fixture<Doc>('legacy-weight-image.json');
    legacy.layers[0].graph.edges.push({
      from: { node: 'missing', socket: 'out' },
      to: { node: 'out', socket: 'in' },
    });
    const before = structuredClone(legacy);
    const result = prepareProjectImport(legacy, {
      documentIdForLegacy: 'failed_partial',
    });
    expect(result).toMatchObject({
      ok: false,
      report: {
        errors: expect.arrayContaining([
          expect.objectContaining({ code: 'UNKNOWN_NODE' }),
        ]),
        warnings: expect.arrayContaining([
          expect.objectContaining({ code: 'DEPRECATED_VALUE_MIGRATED' }),
        ]),
      },
    });
    expect(legacy).toEqual(before);
  });

  it('accepts raw v1 values as an internal API, not only JSON text', () => {
    const graph = fixture<Graph>('legacy-single-graph.json');
    expect(prepareProjectImport(graph, {
      documentIdForLegacy: 'raw_v1',
    })).toMatchObject({
      ok: true,
      source: 'legacy-single-graph',
      project: { documentId: 'raw_v1' },
    });
  });

  it('round-trips a portable project with verified image bytes', () => {
    const prepared = prepareAssetBytes({
      bytes: Uint8Array.from(Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64')),
      mimeType: 'image/png',
      source: 'upload',
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const project = fixture<SerializedProjectV4>(
      'serialized-project-v4.json',
    );
    project.assets = [{ ...prepared.asset.metadata }];

    const exported = exportPortableProjectJson(project, [prepared.asset]);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(JSON.parse(exported.json)).toMatchObject({
      format: PORTABLE_PROJECT_FORMAT,
      bundleVersion: PORTABLE_PROJECT_VERSION,
      project,
      assets: [{
        assetId: prepared.asset.metadata.id,
        dataBase64: ONE_PIXEL_PNG_BASE64,
      }],
    });

    const imported = importProjectJson(exported.json);
    expect(imported).toMatchObject({
      ok: true,
      source: 'portable-project-v1',
      project,
    });
    if (!imported.ok) return;
    expect(imported.assetsToStage).toHaveLength(1);
    expect(imported.assetsToStage[0].metadata)
      .toEqual(prepared.asset.metadata);
    expect(imported.assetsToStage[0].bytes)
      .toEqual(prepared.asset.bytes);

    const second = exportPortableProjectJson(
      imported.project,
      imported.assetsToStage,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.json).toBe(exported.json);
  });

  it('keeps fixed bundled assets as references without copying their bytes', () => {
    const project = fixture<SerializedProjectV4>(
      'serialized-project-v4.json',
    );
    project.assets = [{ ...FACTORY_ASSET_METADATA }];
    const exported = exportPortableProjectJson(project, []);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(JSON.parse(exported.json)).toMatchObject({
      project,
      assets: [],
    });
    expect(importProjectJson(exported.json)).toMatchObject({
      ok: true,
      source: 'portable-project-v1',
      assetsToStage: [],
    });
  });

  it('rejects missing, extra, duplicate, and tampered portable asset payloads', () => {
    const prepared = prepareAssetBytes({
      bytes: Uint8Array.from(Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64')),
      mimeType: 'image/png',
      source: 'generated',
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const project = fixture<SerializedProjectV4>(
      'serialized-project-v4.json',
    );
    project.assets = [{ ...prepared.asset.metadata }];
    const exported = exportPortableProjectJson(project, [prepared.asset]);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const original = JSON.parse(exported.json) as {
      assets: Array<{ assetId: string; dataBase64: string }>;
    };

    const candidates = [
      {
        label: 'missing',
        value: { ...structuredClone(original), assets: [] },
      },
      {
        label: 'extra',
        value: {
          ...structuredClone(original),
          assets: [
            ...original.assets,
            {
              assetId: `asset_${'0'.repeat(64)}`,
              dataBase64: ONE_PIXEL_PNG_BASE64,
            },
          ],
        },
      },
      {
        label: 'duplicate',
        value: {
          ...structuredClone(original),
          assets: [original.assets[0], original.assets[0]],
        },
      },
      {
        label: 'tampered',
        value: {
          ...structuredClone(original),
          assets: [{
            ...original.assets[0],
            dataBase64: `A${original.assets[0].dataBase64.slice(1)}`,
          }],
        },
      },
    ];
    for (const candidate of candidates) {
      const result = importProjectJson(JSON.stringify(candidate.value));
      expect(result, candidate.label).toMatchObject({
        ok: false,
        report: {
          errors: expect.arrayContaining([
            expect.objectContaining({
              code: expect.stringMatching(
                /ASSET_POLICY_VIOLATION|INVARIANT_VIOLATION/,
              ),
              path: expect.stringMatching(/^\/assets/),
            }),
          ]),
        },
      });
      if (!result.ok) {
        expect(JSON.stringify(result.report))
          .not.toContain(ONE_PIXEL_PNG_BASE64);
      }
    }
  });

  it('requires a strict v4 project and exact portable envelope fields', () => {
    const legacyProject = fixture<SerializedProjectV3>(
      'serialized-project-v3.json',
    );
    expect(importProjectJson(JSON.stringify({
      format: PORTABLE_PROJECT_FORMAT,
      bundleVersion: PORTABLE_PROJECT_VERSION,
      project: legacyProject,
      assets: [],
      unexpected: true,
    }))).toMatchObject({
      ok: false,
      report: {
        errors: expect.arrayContaining([
          expect.objectContaining({
            code: 'INVALID_ARGUMENT',
            path: '/unexpected',
          }),
          expect.objectContaining({
            code: 'UNSUPPORTED_SCHEMA_VERSION',
            path: '/project/schemaVersion',
          }),
        ]),
      },
    });
  });
});
