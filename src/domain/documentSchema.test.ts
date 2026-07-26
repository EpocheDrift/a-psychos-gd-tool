import { describe, expect, it } from 'vitest';
import { FindingCollector } from './agentErrors';
import {
  createSerializedProject,
  validateJsonValueSafety,
  validateSerializedProjectStructure,
  type SerializedProjectV3,
} from './documentSchema';
import { validateSerializedProject } from './semanticValidation';

function minimalProject(): SerializedProjectV3 {
  return createSerializedProject('document_1', {
    frame: { width: 320, height: 240 },
    layers: [{
      id: 'layer_1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      graph: {
        nodes: {
          out: { id: 'out', type: 'Output', params: {} },
        },
        edges: [],
      },
    }],
  });
}

function finding(project: unknown, code: string, path: string): void {
  const report = validateSerializedProjectStructure(project);
  expect(report.valid).toBe(false);
  expect(report.errors).toContainEqual(expect.objectContaining({ code, path }));
}

describe('version 3 structural validation', () => {
  it('accepts a strict minimal envelope', () => {
    expect(validateSerializedProjectStructure(minimalProject())).toMatchObject({
      valid: true,
      schemaVersion: 3,
      errors: [],
    });
  });

  it('rejects future envelopes without partially accepting them', () => {
    const project = minimalProject() as unknown as { schemaVersion: number };
    project.schemaVersion = 99;
    finding(project, 'UNSUPPORTED_SCHEMA_VERSION', '/schemaVersion');
  });

  it('rejects unknown fields and escapes their RFC 6901 path', () => {
    const project = minimalProject();
    const layer = project.document.layers[0] as unknown as Record<string, unknown>;
    layer['bad/~field'] = true;
    finding(project, 'INVALID_ARGUMENT', '/document/layers/0/bad~1~0field');
  });

  it('collects independent sibling failures instead of stopping at the first', () => {
    const project = minimalProject();
    project.document.frame = { width: 1, height: 9999 };
    project.document.layers[0].name = 'x'.repeat(129);
    const report = validateSerializedProjectStructure(project);
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'RESOURCE_LIMIT', path: '/document/frame/width' }),
      expect.objectContaining({ code: 'RESOURCE_LIMIT', path: '/document/frame/height' }),
      expect.objectContaining({ code: 'RESOURCE_LIMIT', path: '/document/layers/0/name' }),
    ]));
  });

  it('rejects prototype-sensitive IDs and node map key/id disagreement', () => {
    const project = minimalProject();
    project.document.layers[0].graph.nodes = JSON.parse(
      '{"__proto__":{"id":"__proto__","type":"Output","params":{}},"safe":{"id":"other","type":"Output","params":{}}}',
    );
    const report = validateSerializedProjectStructure(project);
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        path: '/document/layers/0/graph/nodes/__proto__',
      }),
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        path: '/document/layers/0/graph/nodes/__proto__/id',
      }),
      expect.objectContaining({
        code: 'INVARIANT_VIOLATION',
        path: '/document/layers/0/graph/nodes/safe/id',
      }),
    ]));
  });

  it('rejects duplicate layer IDs and configurable count budgets', () => {
    const project = minimalProject();
    project.document.layers.push(structuredClone(project.document.layers[0]));
    const report = validateSerializedProjectStructure(project, {
      limits: { maxLayers: 1, maxNodesPerDocument: 1 },
    });
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'RESOURCE_LIMIT', path: '/document/layers' }),
      expect.objectContaining({ code: 'INVARIANT_VIOLATION', path: '/document/layers/1/id' }),
      expect.objectContaining({ code: 'RESOURCE_LIMIT', path: '/document/layers' }),
    ]));
  });

  it('rejects non-finite values, accessors, custom prototypes, and cycles without invoking getters', () => {
    const nonFinite = minimalProject();
    nonFinite.document.layers[0].graph.nodes.out.params.bad = Number.POSITIVE_INFINITY;
    finding(nonFinite, 'INVALID_ARGUMENT', '/document/layers/0/graph/nodes/out/params/bad');

    let getterCalls = 0;
    const accessor = minimalProject() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, 'evil', {
      enumerable: true,
      get() {
        getterCalls++;
        return 'never';
      },
    });
    finding(accessor, 'INVALID_ARGUMENT', '/evil');
    expect(getterCalls).toBe(0);

    const custom = Object.create({ inherited: true }) as Record<string, unknown>;
    custom.value = 1;
    expect(validateJsonValueSafety(custom).errors[0]).toMatchObject({
      code: 'INVALID_ARGUMENT',
      path: '',
    });

    const cyclic = minimalProject() as unknown as Record<string, unknown>;
    cyclic.self = cyclic;
    finding(cyclic, 'INVALID_ARGUMENT', '/self');
  });

  it('enforces strict asset metadata and total budgets', () => {
    const project = minimalProject();
    project.assets = [{
      id: 'asset_1',
      sha256: 'a'.repeat(64),
      mimeType: 'image/png',
      byteLength: 20,
      width: 4,
      height: 4,
      source: 'upload',
    }];
    expect(validateSerializedProjectStructure(project, {
      limits: {
        maxLegacyAssetBytes: 20,
        maxLegacyAssetBytesPerDocument: 20,
        maxAssetPixels: 16,
      },
    }).valid).toBe(true);
    project.assets[0].byteLength = 21;
    project.assets[0].width = 5;
    const report = validateSerializedProjectStructure(project, {
      limits: {
        maxLegacyAssetBytes: 20,
        maxLegacyAssetBytesPerDocument: 20,
        maxAssetPixels: 16,
      },
    });
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'RESOURCE_LIMIT', path: '/assets/0/byteLength' }),
      expect.objectContaining({ code: 'RESOURCE_LIMIT', path: '/assets/0' }),
      expect.objectContaining({ code: 'RESOURCE_LIMIT', path: '/assets' }),
    ]));
  });

  it('caps finding output deterministically', () => {
    const project = minimalProject();
    const node = project.document.layers[0].graph.nodes.out as unknown as Record<string, unknown>;
    for (let index = 0; index < 20; index++) node[`unknown_${index}`] = true;
    const report = validateSerializedProjectStructure(project, { maxFindings: 3 });
    expect(report.errors).toHaveLength(3);
    expect(report.truncated).toBe(true);
  });

  it('rejects sparse arrays before structural traversal', () => {
    const project = minimalProject();
    project.document.layers = new Array(1);
    const report = validateSerializedProject(project);
    expect(report).toMatchObject({
      valid: false,
      errors: [expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        path: '/document/layers/0',
      })],
    });
  });

  it('rejects arrays with a missing prototype or named index-like properties', () => {
    for (const target of ['layers', 'edges', 'assets'] as const) {
      const project = minimalProject();
      const array = target === 'layers'
        ? project.document.layers
        : target === 'edges'
          ? project.document.layers[0].graph.edges
          : (project.assets = []);
      Object.setPrototypeOf(array, null);
      expect(() => validateSerializedProject(project)).not.toThrow();
      expect(validateSerializedProject(project).valid).toBe(false);
    }

    const named = minimalProject();
    Object.defineProperty(named.document.layers, '4294967295', {
      configurable: true,
      enumerable: true,
      value: 'hidden',
    });
    finding(named, 'INVALID_ARGUMENT', '/document/layers/4294967295');
  });

  it('does not let an invalid finding cap suppress every error', () => {
    const project = minimalProject() as unknown as Record<string, unknown>;
    project.format = 'wrong';
    const report = validateSerializedProjectStructure(project, { maxFindings: 0 });
    expect(report.valid).toBe(false);
    expect(report.errors).toHaveLength(1);

    const collector = new FindingCollector(1);
    collector.warning({ code: 'VALUE_NORMALIZED', message: 'first', path: '' });
    collector.error({ code: 'INVALID_ARGUMENT', message: 'suppressed detail', path: '' });
    expect(collector.report('structural', null)).toMatchObject({
      valid: false,
      errors: [],
      truncated: true,
    });
  });

  it('keeps every finding JSON-safe even for extreme numeric input', () => {
    const project = minimalProject();
    project.document.frame = {
      width: Number.MAX_VALUE,
      height: Number.MAX_VALUE,
    };
    project.assets = [{
      id: 'asset_1',
      sha256: 'a'.repeat(64),
      mimeType: 'image/png',
      byteLength: Number.MAX_VALUE,
      width: Number.MAX_VALUE,
      height: Number.MAX_VALUE,
      source: 'upload',
    }];
    const report = validateSerializedProjectStructure(project);
    expect(report.valid).toBe(false);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});
