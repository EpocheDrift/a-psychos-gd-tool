import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { NodeDef } from '../engine/registry';
import { PALETTE, RegistryConstructionError, buildRegistry, registry, type NodeCategory } from '../nodes';
import {
  CAPABILITY_MANIFEST,
  RegistryContractError,
  buildCapabilityManifest,
} from './capabilityManifest';
import { decodeBinds, encodeBinds } from './paramCodecs';
import { PROJECT_V3_SCHEMA, buildProjectV3Schema } from './projectSchema';
import { auditRegistryContract } from './registryContract';

function readContract(name: string): unknown {
  return JSON.parse(readFileSync(
    new URL(`../../test/fixtures/contracts/${name}`, import.meta.url),
    'utf8',
  ));
}

function replaceNode(type: string, update: (definition: NodeDef) => NodeDef): NodeCategory[] {
  return PALETTE.map((category) => ({
    category: category.category,
    nodes: category.nodes.map((definition) =>
      definition.type === type ? update(definition) : definition),
  }));
}

describe('capability manifest contract', () => {
  it('projects all 31 palette definitions in stable order without executable fields', () => {
    const paletteTypes = PALETTE.flatMap((category) => category.nodes.map((node) => node.type));
    expect(CAPABILITY_MANIFEST.nodes.map((node) => node.type)).toEqual(paletteTypes);
    expect(CAPABILITY_MANIFEST.nodes).toHaveLength(31);
    expect(CAPABILITY_MANIFEST.socketTypes).toEqual([
      'text',
      'vector',
      'raster',
      'alpha',
      'elements',
      'layout',
    ]);
    expect(CAPABILITY_MANIFEST.features).toEqual({
      transactions: true,
      dryRun: true,
      previews: false,
      assets: false,
      mcp: false,
    });

    const json = JSON.stringify(CAPABILITY_MANIFEST);
    expect(json).not.toContain('"cook"');
    expect(json).not.toContain('"hashExtras"');
    expect(JSON.parse(json)).toEqual(CAPABILITY_MANIFEST);
    expect(json).not.toContain('undefined');
  });

  it('exposes structured binds and keeps Image source non-agent-writable', () => {
    const place = CAPABILITY_MANIFEST.nodes.find((node) => node.type === 'Place')!;
    const binds = place.params.find((param) => param.name === 'binds')!;
    expect(binds.default).toEqual([]);
    expect(binds.schema).toMatchObject({ type: 'array', maxItems: 64 });
    expect(binds.storageEncoding).toBe('json-string');
    expect(binds.codec).toEqual({ name: 'binds-json-string-v1' });

    const image = CAPABILITY_MANIFEST.nodes.find((node) => node.type === 'Image')!;
    expect(image.params.find((param) => param.name === 'src')).toMatchObject({
      agentWritable: false,
      schema: { format: 'image-data-uri-v1' },
    });
    expect(image.execution.network).toBe('asset-read');
    expect(image.traits.externalDownload).toBe(false);

    const removeBackground = CAPABILITY_MANIFEST.nodes.find((node) => node.type === 'RemoveBackground')!;
    expect(removeBackground).toMatchObject({
      traits: { expensive: true, externalDownload: true, gpuRequirement: 'required' },
      execution: {
        runtime: 'model',
        network: 'model-download',
        cost: 'high',
        deterministic: false,
      },
    });
  });

  it('distinguishes optional GPU paths from unconditional GPU requirements', () => {
    const grid = CAPABILITY_MANIFEST.nodes.find((node) => node.type === 'Grid')!;
    const output = CAPABILITY_MANIFEST.nodes.find((node) => node.type === 'Output')!;
    expect(grid.traits).toMatchObject({
      requiresGpu: false,
      gpuRequirement: 'optional',
    });
    expect(output.traits).toMatchObject({
      requiresGpu: true,
      gpuRequirement: 'required',
    });
  });

  it('normalizes boolean showIf values without making them semantic rules', () => {
    const text = CAPABILITY_MANIFEST.nodes.find((node) => node.type === 'Text')!;
    expect(text.params.find((param) => param.name === 'strokeColor')?.['x-ui-visible-if'])
      .toEqual({ param: 'stroke', in: [true] });
    const grid = CAPABILITY_MANIFEST.nodes.find((node) => node.type === 'Grid')!;
    expect(grid.params.find((param) => param.name === 'ratioX')?.['x-ui-visible-if'])
      .toEqual({ param: 'distX', in: ['geometric'] });
  });

  it('matches committed schema and manifest golden files', () => {
    expect(CAPABILITY_MANIFEST).toEqual(readContract('capability-manifest.v1.json'));
    expect(PROJECT_V3_SCHEMA).toEqual(readContract('project-v3.schema.json'));
  });

  it('exports a strict Draft 2020-12 schema with one node branch per type', () => {
    expect(PROJECT_V3_SCHEMA).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'urn:a-psychos-gd-tool:schema:project:3',
      additionalProperties: false,
    });
    const definitions = PROJECT_V3_SCHEMA.$defs as Record<string, unknown>;
    expect((definitions.node as { oneOf: unknown[] }).oneOf).toHaveLength(31);
    expect(definitions.graph).toMatchObject({
      additionalProperties: false,
      required: ['nodes', 'edges'],
      properties: {
        nodes: { propertyNames: { $ref: '#/$defs/id' } },
      },
    });
    expect(JSON.parse(JSON.stringify(PROJECT_V3_SCHEMA))).toEqual(PROJECT_V3_SCHEMA);
  });

  it('projects effective custom policy limits into manifest and schema', () => {
    const limits = {
      maxIdLength: 16,
      maxStringBytes: 32,
      maxExpressionBytes: 16,
    };
    const manifest = buildCapabilityManifest({ limits });
    const filter = manifest.nodes.find((node) => node.type === 'Filter')!;
    expect(filter.params.find((param) => param.name === 'channel')?.schema)
      .toMatchObject({ maxLength: 16 });
    const text = manifest.nodes.find((node) => node.type === 'Text')!;
    expect(text.params.find((param) => param.name === 'content')?.schema)
      .toMatchObject({ maxLength: 32, maxUtf8Bytes: 32 });
    const grid = manifest.nodes.find((node) => node.type === 'Grid')!;
    expect(grid.params.find((param) => param.name === 'exprX')?.schema)
      .toMatchObject({ maxLength: 16, maxUtf8Bytes: 16 });

    const schema = buildProjectV3Schema({ limits });
    const definitions = schema.$defs as Record<string, {
      maxLength?: number;
      oneOf?: Array<Record<string, unknown>>;
    }>;
    expect(definitions.id.maxLength).toBe(16);
    const place = definitions.node.oneOf?.find((branch) =>
      (branch.properties as Record<string, { const?: string }>).type.const === 'Place')!;
    const params = (
      (place.properties as Record<string, unknown>).params as {
        properties: Record<string, Record<string, unknown>>;
      }
    ).properties;
    expect(params.binds).toMatchObject({ maxLength: 32, maxUtf8Bytes: 32 });
  });

  it('rejects malformed or internally inconsistent policy overrides', () => {
    expect(() => buildCapabilityManifest({ limits: { maxFindings: 0 } })).toThrow(RangeError);
    expect(() => buildCapabilityManifest({ limits: { maxLayers: 1.5 } })).toThrow(RangeError);
    expect(() => buildCapabilityManifest({
      limits: { minFrameSide: 100, maxFrameSide: 50 },
    })).toThrow(RangeError);
    expect(() => buildCapabilityManifest({
      limits: { unknownLimit: 1 } as never,
    })).toThrow(/Unknown Agent limit/);
    expect(() => buildCapabilityManifest({
      limits: { maxExpressionBytes: 8 },
    })).toThrow(RegistryContractError);
    expect(() => buildCapabilityManifest({
      limits: { maxIdLength: 8 },
    })).toThrow(RegistryContractError);
  });
});

describe('strict binds compatibility codec', () => {
  it('checks bytes before parse and uses prototype-safe own-field reads', () => {
    expect(decodeBinds(`[${' '.repeat(64)}]`, 64, 16)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'RESOURCE_LIMIT', path: '' })],
    });

    Object.defineProperty(Object.prototype, 'channel', {
      configurable: true,
      writable: true,
      value: 'polluted',
    });
    try {
      const decoded = decodeBinds('[{"target":"scale","amount":1}]', 64);
      expect(decoded).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({ path: '/0/channel' }),
        ]),
      });
    } finally {
      Reflect.deleteProperty(Object.prototype, 'channel');
    }
  });

  it('escapes decoded paths and refuses to encode invalid public values', () => {
    expect(decodeBinds(
      '[{"channel":"weight","target":"scale","amount":1,"bad/~field":true}]',
      64,
    )).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: '/0/bad~1~0field' }),
      ]),
    });
    expect(() => encodeBinds([{
      channel: 'weight',
      target: 'scale',
      amount: 99,
      invert: false,
      offset: 0,
    }])).toThrow(/invalid binds/i);
  });

  it('encodes against the same effective policy advertised by the manifest', () => {
    const bind = {
      channel: 'weight',
      target: 'scale' as const,
      amount: 1,
      invert: false,
      offset: 0,
    };
    expect(() => encodeBinds(
      [bind, bind],
      { maxBinds: 1, maxStringBytes: 1024, maxIdLength: 128 },
    )).toThrow(/more than 1 rows/);
    expect(decodeBinds(
      encodeBinds(
        Array.from({ length: 65 }, () => bind),
        { maxBinds: 100, maxStringBytes: 64 * 1024, maxIdLength: 128 },
      ),
      100,
      64 * 1024,
      128,
    )).toMatchObject({ ok: true, value: expect.any(Array) });
    expect(() => encodeBinds(
      [{ ...bind, channel: 'long-channel' }],
      { maxBinds: 64, maxStringBytes: 1024, maxIdLength: 4 },
    )).toThrow(/at most 4 characters/);
  });
});

describe('registry/schema drift gates', () => {
  it('accepts the built-in registry and metadata exactly', () => {
    expect(auditRegistryContract(PALETTE, registry)).toMatchObject({
      valid: true,
      errors: [],
    });
  });

  it('rejects duplicate node types before Map overwrite', () => {
    const duplicate: NodeCategory[] = [{
      category: 'Duplicate',
      nodes: [PALETTE[0].nodes[0], PALETTE[0].nodes[0]],
    }];
    expect(() => buildRegistry(duplicate)).toThrow(RegistryConstructionError);
    try {
      buildRegistry(duplicate);
    } catch (error) {
      expect(error).toMatchObject({ code: 'DUPLICATE_NODE_TYPE', nodeType: 'Text' });
    }
    expect(auditRegistryContract(duplicate).errors.some((finding) =>
      finding.message.includes('duplicated'))).toBe(true);
  });

  it('rejects invalid defaults, duplicate params/sockets, and impossible showIf', () => {
    const invalid = replaceNode('Text', (definition) => ({
      ...definition,
      inputs: [{ name: 'dup', type: 'text' }, { name: 'dup', type: 'text' }],
      params: [
        ...definition.params.map((param) =>
          param.name === 'fontSize' && param.kind === 'number'
            ? { ...param, default: Number.POSITIVE_INFINITY }
            : param.name === 'strokeColor' && param.kind === 'color'
              ? { ...param, showIf: { param: 'stroke', in: ['maybe'] } }
              : param),
        definition.params[0],
      ],
    }));
    const report = auditRegistryContract(invalid);
    expect(report.valid).toBe(false);
    expect(report.errors.map((finding) => finding.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('duplicated'),
      expect.stringContaining('Default for Text.fontSize is invalid'),
      expect.stringContaining('showIf value'),
    ]));
    expect(() => buildCapabilityManifest({ categories: invalid })).toThrow(RegistryContractError);
    expect(() => buildProjectV3Schema({ categories: invalid })).toThrow(RegistryContractError);
  });
});
