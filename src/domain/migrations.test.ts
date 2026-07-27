import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Doc, Graph } from '../engine/graph';
import type { SerializedProjectV3 } from './documentSchema';
import { migrateProject } from './migrations';
import { prepareProjectImport } from './projectCodec';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(
    new URL(`../../test/fixtures/documents/${name}`, import.meta.url),
    'utf8',
  )) as T;
}

function deepFreeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

describe('pure project migrations', () => {
  it('promotes a v1 graph frame and wraps it in one default layer', () => {
    const graph = fixture<Graph>('legacy-single-graph.json');
    const before = structuredClone(graph);
    deepFreeze(graph);
    const result = migrateProject(graph, { documentIdForLegacy: 'legacy_v1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({
      source: 'legacy-single-graph',
      project: {
        format: 'a-psychos-gd-tool',
        schemaVersion: 4,
        documentId: 'legacy_v1',
        document: {
          frame: { width: 320, height: 240 },
          layers: [{
            id: 'layer_1',
            name: 'Layer 1',
            visible: true,
            opacity: 1,
            blendMode: 'normal',
          }],
        },
      },
    });
    expect(result.project.document.layers[0].graph).toEqual({
      nodes: before.nodes,
      edges: before.edges,
    });
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'LEGACY_FORMAT_MIGRATED',
      path: '',
    }));
    expect(graph).toEqual(before);
  });

  it('wraps v2 layered localStorage without drift or mutation', () => {
    const document = fixture<Doc>('layered-local-storage.json');
    const before = structuredClone(document);
    deepFreeze(document);
    const result = migrateProject(document, { documentIdForLegacy: 'legacy_v2' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('legacy-layered-document');
    expect(result.project.document).toEqual(before);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'LEGACY_FORMAT_MIGRATED',
    }));
    expect(document).toEqual(before);
  });

  it('normalizes only missing v2 layer defaults and rejects malformed existing values later', () => {
    const document = fixture<Doc>('layered-local-storage.json') as unknown as {
      frame: Doc['frame'];
      layers: Array<Record<string, unknown>>;
    };
    delete document.layers[0].name;
    delete document.layers[0].visible;
    document.layers[0].opacity = '1';
    const migrated = migrateProject(document, { documentIdForLegacy: 'legacy_v2' });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.project.document.layers[0]).toMatchObject({
      name: 'Layer 1',
      visible: true,
      opacity: '1',
    });
    expect(prepareProjectImport(document, { documentIdForLegacy: 'legacy_v2' })).toMatchObject({
      ok: false,
      report: {
        errors: expect.arrayContaining([
          expect.objectContaining({
            code: 'INVALID_ARGUMENT',
            path: '/document/layers/0/opacity',
          }),
        ]),
      },
    });
  });

  it('migrates Weight image and all affected Filter/Place channel references', () => {
    const legacy = fixture<Doc>('legacy-weight-image.json');
    const result = prepareProjectImport(legacy, { documentIdForLegacy: 'legacy_weight' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const nodes = result.project.document.layers[0].graph.nodes;
    expect(nodes.weight.params.source).toBe('image luma');
    expect(nodes.filter.params.channel).toBe('image luma');
    expect(JSON.parse(String(nodes.place.params.binds))).toEqual([{
      channel: 'image luma',
      target: 'scale',
      amount: 0.5,
    }]);
    expect(result.warnings.filter((finding) =>
      finding.code === 'DEPRECATED_VALUE_MIGRATED')).toHaveLength(3);
  });

  it('removes the retired factory Random.count only through the legacy path', () => {
    const factory = fixture<Doc>('factory-document.json');
    expect(factory.layers[2].graph.nodes.random_3.params.count).toBe(999);
    const result = prepareProjectImport(factory, { documentIdForLegacy: 'factory' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.document.layers[2].graph.nodes.random_3.params)
      .not.toHaveProperty('count');
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'DEPRECATED_VALUE_MIGRATED',
      path: '/document/layers/2/graph/nodes/random_3/params/count',
    }));
  });

  it('migrates a valid v3 envelope once and does not apply unrelated legacy aliases', () => {
    const project = fixture<SerializedProjectV3>('serialized-project-v3.json');
    const migrated = migrateProject(project);
    expect(migrated).toMatchObject({
      ok: true,
      source: 'project-v3',
      project: {
        schemaVersion: 4,
        documentId: project.documentId,
        document: project.document,
      },
      warnings: [
        expect.objectContaining({
          code: 'LEGACY_FORMAT_MIGRATED',
          path: '/schemaVersion',
        }),
      ],
    });

    const legacyAlias = structuredClone(project);
    legacyAlias.document.layers[0].graph.nodes.weight = {
      id: 'weight',
      type: 'Weight',
      params: { source: 'image' },
    };
    const prepared = prepareProjectImport(legacyAlias);
    expect(prepared).toMatchObject({
      ok: false,
      report: {
        errors: expect.arrayContaining([
          expect.objectContaining({
            code: 'INVALID_ARGUMENT',
            path: '/document/layers/0/graph/nodes/weight/params/source',
          }),
        ]),
      },
    });
  });

  it('rejects malformed/future envelopes and ambiguous legacy shapes without fallback', () => {
    expect(migrateProject({
      format: 'a-psychos-gd-tool',
      schemaVersion: 99,
      documentId: 'future',
      document: {},
    })).toMatchObject({
      ok: false,
      report: {
        errors: [expect.objectContaining({
          code: 'UNSUPPORTED_SCHEMA_VERSION',
          path: '/schemaVersion',
        })],
      },
    });
    expect(migrateProject({ frame: {}, layers: [], nodes: {}, edges: [] })).toMatchObject({
      ok: false,
      report: {
        errors: [expect.objectContaining({
          code: 'INVALID_ARGUMENT',
          path: '',
        })],
      },
    });
    expect(migrateProject({ frame: {} })).toMatchObject({
      ok: false,
      report: {
        errors: [expect.objectContaining({
          code: 'INVALID_ARGUMENT',
          path: '',
        })],
      },
    });
  });

  it('diagnoses zero or multiple Output roots after migration without choosing one', () => {
    const document = fixture<Doc>('layered-local-storage.json');
    delete document.layers[0].graph.nodes.out;
    document.layers[0].graph.edges = document.layers[0].graph.edges
      .filter((edge) => edge.to.node !== 'out');
    expect(prepareProjectImport(document, { documentIdForLegacy: 'missing_output' }))
      .toMatchObject({
        ok: false,
        report: {
          errors: expect.arrayContaining([
            expect.objectContaining({
              code: 'OUTPUT_MISSING',
              path: '/document/layers/0/graph/nodes',
            }),
          ]),
        },
      });

    document.layers[0].graph.nodes.a = {
      id: 'a',
      type: 'Output',
      params: {},
    };
    document.layers[0].graph.nodes.z = {
      id: 'z',
      type: 'Output',
      params: {},
    };
    const ambiguous = prepareProjectImport(document, { documentIdForLegacy: 'ambiguous_output' });
    expect(ambiguous).toMatchObject({
      ok: false,
      report: {
        errors: expect.arrayContaining([
          expect.objectContaining({
            code: 'OUTPUT_AMBIGUOUS',
            details: { outputNodeIds: ['a', 'z'] },
          }),
        ]),
      },
    });
  });

  it('bounds legacy binds before nested parsing and escapes migration warning paths', () => {
    const legacy = fixture<Doc>('legacy-weight-image.json');
    legacy.layers[0].graph.nodes.place.params.binds = `[${' '.repeat(128)}]`;
    const parse = vi.spyOn(JSON, 'parse');
    const result = prepareProjectImport(legacy, {
      documentIdForLegacy: 'bounded_binds',
      limits: { maxStringBytes: 32 },
    });
    expect(result).toMatchObject({
      ok: false,
      report: {
        errors: expect.arrayContaining([
          expect.objectContaining({
            code: 'RESOURCE_LIMIT',
            path: '/document/layers/0/graph/nodes/place/params/binds',
          }),
        ]),
      },
    });
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();

    const graph: Graph = {
      nodes: {
        'bad/~weight': {
          id: 'bad/~weight',
          type: 'Weight',
          params: { source: 'image' },
        },
      },
      edges: [],
    };
    const migrated = migrateProject(graph, { documentIdForLegacy: 'escaped_warning' });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.warnings).toContainEqual(expect.objectContaining({
      path: '/document/layers/0/graph/nodes/bad~1~0weight/params/source',
    }));
  });

  it('applies one global finding cap without allowing warnings to hide invalidity', () => {
    const legacy = fixture<Doc>('legacy-weight-image.json');
    legacy.layers[0].graph.edges.push({
      from: { node: 'missing', socket: 'out' },
      to: { node: 'out', socket: 'in' },
    });
    const result = prepareProjectImport(legacy, {
      documentIdForLegacy: 'capped',
      maxFindings: 1,
    });
    expect(result).toMatchObject({
      ok: false,
      report: {
        valid: false,
        truncated: true,
        errors: [expect.objectContaining({ code: 'UNKNOWN_NODE' })],
        warnings: [],
      },
    });
  });
});
