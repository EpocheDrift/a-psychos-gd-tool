import { BLEND_MODES } from '../engine/graph';
import { PALETTE, type NodeCategory } from '../nodes';
import { buildPersistedParamSchema, RegistryContractError } from './capabilityManifest';
import type { JsonObject } from './json';
import { DEFAULT_AGENT_LIMITS, resolveAgentLimits, type AgentLimits } from './limits';
import { auditRegistryContract } from './registryContract';

export function buildProjectV3Schema(
  options: {
    categories?: readonly NodeCategory[];
    limits?: Partial<AgentLimits>;
  } = {},
): JsonObject {
  const categories = options.categories ?? PALETTE;
  const limits = resolveAgentLimits(options.limits);
  const audit = auditRegistryContract(categories, undefined, limits);
  if (!audit.valid) throw new RegistryContractError(audit);
  const nodeSchemas = categories.flatMap(({ nodes }) =>
    nodes.map((definition): JsonObject => ({
      type: 'object',
      additionalProperties: false,
      required: ['id', 'type', 'params'],
      properties: {
        id: { $ref: '#/$defs/id' },
        type: { const: definition.type },
        params: {
          type: 'object',
          additionalProperties: false,
          properties: Object.fromEntries(definition.params.map((param) => [
            param.name,
            buildPersistedParamSchema(definition.type, param, limits),
          ])) as JsonObject,
        },
        position: { $ref: '#/$defs/position' },
      },
    })),
  );

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'urn:a-psychos-gd-tool:schema:project:3',
    title: 'a-psychos-gd-tool project',
    type: 'object',
    additionalProperties: false,
    required: ['format', 'schemaVersion', 'documentId', 'document'],
    properties: {
      format: { const: 'a-psychos-gd-tool' },
      schemaVersion: { const: 3 },
      documentId: { $ref: '#/$defs/id' },
      document: { $ref: '#/$defs/document' },
      assets: {
        type: 'array',
        items: { $ref: '#/$defs/assetMetadata' },
      },
    },
    $defs: {
      id: {
        type: 'string',
        pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
        maxLength: limits.maxIdLength,
        not: { enum: ['__proto__', 'constructor', 'prototype'] },
      },
      frame: {
        type: 'object',
        additionalProperties: false,
        required: ['width', 'height'],
        properties: {
          width: {
            type: 'integer',
            minimum: limits.minFrameSide,
            maximum: limits.maxFrameSide,
          },
          height: {
            type: 'integer',
            minimum: limits.minFrameSide,
            maximum: limits.maxFrameSide,
          },
        },
      },
      position: {
        type: 'object',
        additionalProperties: false,
        required: ['x', 'y'],
        properties: {
          x: { type: 'number', finite: true },
          y: { type: 'number', finite: true },
        },
      },
      endpoint: {
        type: 'object',
        additionalProperties: false,
        required: ['node', 'socket'],
        properties: {
          node: { $ref: '#/$defs/id' },
          socket: { $ref: '#/$defs/id' },
        },
      },
      edge: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to'],
        properties: {
          from: { $ref: '#/$defs/endpoint' },
          to: { $ref: '#/$defs/endpoint' },
        },
      },
      node: { oneOf: nodeSchemas },
      graph: {
        type: 'object',
        additionalProperties: false,
        required: ['nodes', 'edges'],
        properties: {
          nodes: {
            type: 'object',
            maxProperties: limits.maxNodesPerLayer,
            propertyNames: { $ref: '#/$defs/id' },
            additionalProperties: { $ref: '#/$defs/node' },
          },
          edges: {
            type: 'array',
            maxItems: limits.maxEdgesPerLayer,
            items: { $ref: '#/$defs/edge' },
          },
        },
      },
      layer: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'visible', 'opacity', 'blendMode', 'graph'],
        properties: {
          id: { $ref: '#/$defs/id' },
          name: { type: 'string', maxLength: limits.maxNameLength },
          visible: { type: 'boolean' },
          opacity: { type: 'number', finite: true, minimum: 0, maximum: 1 },
          blendMode: { type: 'string', enum: [...BLEND_MODES] },
          graph: { $ref: '#/$defs/graph' },
        },
      },
      document: {
        type: 'object',
        additionalProperties: false,
        required: ['frame', 'layers'],
        properties: {
          frame: { $ref: '#/$defs/frame' },
          layers: {
            type: 'array',
            minItems: 1,
            maxItems: limits.maxLayers,
            items: { $ref: '#/$defs/layer' },
          },
        },
      },
      assetMetadata: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'sha256', 'mimeType', 'byteLength', 'width', 'height', 'source'],
        properties: {
          id: { $ref: '#/$defs/id' },
          sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] },
          byteLength: { type: 'integer', minimum: 0, maximum: limits.maxLegacyAssetBytes },
          width: { type: 'integer', minimum: 1 },
          height: { type: 'integer', minimum: 1 },
          source: { type: 'string', enum: ['upload', 'generated', 'bundled'] },
        },
      },
    },
  };
}

export const PROJECT_V3_SCHEMA = buildProjectV3Schema({
  limits: { ...DEFAULT_AGENT_LIMITS },
});
