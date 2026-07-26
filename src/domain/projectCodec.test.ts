import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Doc, Graph } from '../engine/graph';
import { registry } from '../nodes';
import type { SerializedProjectV3 } from './documentSchema';
import {
  exportDocumentJson,
  exportProjectJson,
  importProjectJson,
  prepareProjectImport,
} from './projectCodec';

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
    const project = fixture<SerializedProjectV3>('serialized-project-v3.json');
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
});
