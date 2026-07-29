import type { ParamSpec, SocketSpec } from '../engine/registry';
import { socketTypes } from '../engine/registry';
import { PALETTE, registry, type NodeCategory } from '../nodes';
import { EXPRESSION_LANGUAGE } from '../util/expr';
import type { ValidationReport } from './agentErrors';
import type { JsonObject, JsonValue } from './json';
import { DEFAULT_AGENT_LIMITS, resolveAgentLimits, type AgentLimits } from './limits';
import { decodeBinds } from './paramCodecs';
import { getParamPublicMetadata, NODE_PUBLIC_METADATA } from './publicNodeMetadata';
import {
  DEFAULT_PREVIEW_FORMAT,
  PREVIEW_CAPTURE_POLICY,
  PREVIEW_FORMATS,
  PREVIEW_METRICS_VERSION,
} from './previewContract';
import { auditRegistryContract, SOCKET_TYPES } from './registryContract';
import {
  MAX_RENDERED_NODE_MEASUREMENT_TARGETS,
  RENDERED_NODE_COORDINATE_SPACE,
  RENDERED_NODE_MEASUREMENT_LIMITS,
  RENDERED_NODE_MEASUREMENT_POLICY,
  RENDERED_NODE_MEASUREMENT_STAGE,
  RENDERED_NODE_MEASUREMENT_VERSION,
  RENDERED_NODE_MEASUREMENT_WORK_POLICY,
  RENDERED_NODE_VISIBILITY_POLICY,
} from './renderedNodeMeasurementContract';

export interface PublicSocketDescriptor {
  name: string;
  types: string[];
  optional: boolean;
}

export interface PublicParamDescriptor {
  name: string;
  kind: ParamSpec['kind'];
  description: string;
  default: JsonValue;
  schema: JsonObject;
  agentWritable: boolean;
  storageEncoding?: 'json-string';
  codec?: { name: 'binds-json-string-v1' };
  'x-ui-visible-if'?: {
    param: string;
    in: JsonValue[];
  };
}

export interface PublicNodeDescriptor {
  type: string;
  label: string;
  category: string;
  description: string;
  inputs: PublicSocketDescriptor[];
  outputs: PublicSocketDescriptor[];
  params: PublicParamDescriptor[];
  traits: {
    usesFrame: boolean;
    requiresGpu: boolean;
    gpuRequirement: 'none' | 'optional' | 'required';
    asynchronous: boolean;
    expensive: boolean;
    externalDownload: boolean;
  };
  execution: {
    runtime: 'cpu' | 'gpu' | 'worker' | 'model';
    network: 'none' | 'asset-read' | 'model-download';
    cost: 'low' | 'medium' | 'high';
    deterministic: boolean;
  };
}

export interface CapabilityManifest {
  protocolVersion: '1.0';
  documentSchemaVersions: number[];
  socketTypes: string[];
  nodes: PublicNodeDescriptor[];
  limits: AgentLimits;
  features: {
    transactions: boolean;
    dryRun: boolean;
    previews: boolean;
    renderedNodeMeasurements: boolean;
    assets: boolean;
    mcp: boolean;
  };
  permissions: {
    localFonts: {
      agentAvailable: false;
      requiresHumanGesture: true;
      familyEnumeration: 'disabled';
    };
  };
  preview: {
    formats: Array<(typeof PREVIEW_FORMATS)[number]>;
    defaultFormat: typeof DEFAULT_PREVIEW_FORMAT;
    metricsVersion: typeof PREVIEW_METRICS_VERSION;
    capturePolicy: typeof PREVIEW_CAPTURE_POLICY;
  };
  measurement: {
    contractVersion: typeof RENDERED_NODE_MEASUREMENT_VERSION;
    measurementPolicy: typeof RENDERED_NODE_MEASUREMENT_POLICY;
    measurementStage: typeof RENDERED_NODE_MEASUREMENT_STAGE;
    visibilityPolicy: typeof RENDERED_NODE_VISIBILITY_POLICY;
    coordinateSpace: typeof RENDERED_NODE_COORDINATE_SPACE;
    workPolicy: typeof RENDERED_NODE_MEASUREMENT_WORK_POLICY;
    limits: typeof RENDERED_NODE_MEASUREMENT_LIMITS;
    maxTargets: number;
    exactAttemptRequired: true;
    supportedValueKinds: ['text', 'vector', 'elements'];
  };
}

export class RegistryContractError extends Error {
  constructor(readonly report: ValidationReport) {
    super(`Registry contract failed with ${report.errors.length} error(s)`);
    this.name = 'RegistryContractError';
  }
}

function socketDescriptor(socket: SocketSpec): PublicSocketDescriptor {
  return {
    name: socket.name,
    types: [...socketTypes(socket)],
    optional: socket.optional === true,
  };
}

function visibilityValue(param: ParamSpec, value: string): JsonValue {
  if (param.kind === 'toggle') return value === 'true';
  if (param.kind === 'number') return Number(value);
  return value;
}

export function buildPublicParamSchema(
  nodeType: string,
  param: ParamSpec,
  limits: AgentLimits,
): JsonObject {
  const metadata = getParamPublicMetadata(nodeType, param);
  switch (param.kind) {
    case 'number': {
      const schema: JsonObject = {
        type: metadata.integer ? 'integer' : 'number',
        finite: true,
      };
      const minimum = metadata.minimum ?? param.min;
      const maximum = metadata.maximum ?? param.max;
      if (minimum !== undefined) schema.minimum = minimum;
      if (maximum !== undefined) schema.maximum = maximum;
      if (param.step !== undefined) schema['x-step'] = param.step;
      return schema;
    }
    case 'toggle':
      return { type: 'boolean' };
    case 'color':
      return { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
    case 'select':
      return { type: 'string', enum: [...param.options] };
    case 'channel':
      return {
        type: 'string',
        minLength: 1,
        maxLength: Math.min(metadata.maxLength ?? limits.maxIdLength, limits.maxIdLength),
        format: 'channel-name-v1',
      };
    case 'image':
      return metadata.format === 'asset-id-v1'
        ? {
            type: 'string',
            format: 'asset-id-v1',
            pattern: '^(?:|asset_[0-9a-f]{64})$',
            maxLength: 70,
          }
        : {
            type: 'string',
            format: 'image-data-uri-v1',
            maxContentBytes: limits.maxLegacyAssetBytes,
            maxPixels: limits.maxAssetPixels,
          };
    case 'binds':
      return {
        type: 'array',
        maxItems: limits.maxBinds,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['channel', 'target', 'amount'],
          properties: {
            channel: {
              type: 'string',
              minLength: 1,
              maxLength: Math.min(128, limits.maxIdLength),
              format: 'channel-name-v1',
            },
            target: { type: 'string', enum: ['scale', 'rotation', 'blur'] },
            amount: { type: 'number', finite: true },
            invert: { type: 'boolean', default: false },
            offset: {
              type: 'number',
              finite: true,
              minimum: -1,
              maximum: 1,
              default: 0,
            },
          },
          allOf: [
            {
              if: { properties: { target: { const: 'blur' } } },
              then: { properties: { amount: { minimum: 0, maximum: 64, 'x-step': 1 } } },
              else: { properties: { amount: { minimum: 0, maximum: 1, 'x-step': 0.01 } } },
            },
          ],
        },
      };
    case 'string': {
      const schema: JsonObject = { type: 'string' };
      if (metadata.minLength !== undefined) schema.minLength = metadata.minLength;
      const formatByteLimit = metadata.format === 'math-expression-v1'
        || metadata.format === 'positive-number-list-v1'
        ? limits.maxExpressionBytes
        : limits.maxStringBytes;
      const effectiveMaxBytes = Math.min(
        metadata.maxBytes ?? limits.maxStringBytes,
        limits.maxStringBytes,
        formatByteLimit,
      );
      if (metadata.maxLength !== undefined) {
        schema.maxLength = Math.min(metadata.maxLength, effectiveMaxBytes);
      }
      if (metadata.format) schema.format = metadata.format;
      schema.maxUtf8Bytes = effectiveMaxBytes;
      if (metadata.format === 'math-expression-v1') {
        schema['x-expression-language'] = {
          version: EXPRESSION_LANGUAGE.version,
          variables: [...(metadata.expressionVariables ?? [])],
          constants: [...EXPRESSION_LANGUAGE.constants],
          functions: EXPRESSION_LANGUAGE.functions.map((entry) => ({ ...entry })),
        };
      }
      if (metadata.format === 'positive-number-list-v1') schema.maxItems = 64;
      return schema;
    }
  }
}

export function buildPersistedParamSchema(
  nodeType: string,
  param: ParamSpec,
  limits: AgentLimits,
): JsonObject {
  if (param.kind !== 'binds') return buildPublicParamSchema(nodeType, param, limits);
  return {
    type: 'string',
    format: 'binds-json-string-v1',
    maxLength: limits.maxStringBytes,
    maxUtf8Bytes: limits.maxStringBytes,
    contentMediaType: 'application/json',
  };
}

function paramDescriptor(
  nodeType: string,
  params: readonly ParamSpec[],
  param: ParamSpec,
  limits: AgentLimits,
): PublicParamDescriptor {
  const metadata = getParamPublicMetadata(nodeType, param);
  const decodedDefault = param.kind === 'binds'
    ? decodeBinds(
        param.default,
        limits.maxBinds,
        limits.maxStringBytes,
        Math.min(128, limits.maxIdLength),
      )
    : null;
  if (decodedDefault && !decodedDefault.ok) {
    throw new Error(`Invalid binds default for ${nodeType}.${param.name}`);
  }
  const control = param.showIf
    ? params.find((candidate) => candidate.name === param.showIf?.param)
    : undefined;
  return {
    name: param.name,
    kind: param.kind,
    description: metadata.description,
    default: decodedDefault && decodedDefault.ok
      ? decodedDefault.value.map((bind) => ({
          channel: bind.channel,
          target: bind.target,
          amount: bind.amount,
          invert: bind.invert,
          offset: bind.offset,
        }))
      : param.default,
    schema: buildPublicParamSchema(nodeType, param, limits),
    agentWritable: metadata.agentWritable ?? true,
    ...(param.kind === 'binds'
      ? {
          storageEncoding: 'json-string' as const,
          codec: { name: 'binds-json-string-v1' as const },
        }
      : {}),
    ...(param.showIf && control
      ? {
          'x-ui-visible-if': {
            param: param.showIf.param,
            in: param.showIf.in.map((value) => visibilityValue(control, value)),
          },
        }
      : {}),
  };
}

export function buildCapabilityManifest(
  options: {
    categories?: readonly NodeCategory[];
    limits?: Partial<AgentLimits>;
  } = {},
): CapabilityManifest {
  const categories = options.categories ?? PALETTE;
  const limits = resolveAgentLimits(options.limits);
  const audit = auditRegistryContract(
    categories,
    categories === PALETTE ? registry : undefined,
    limits,
  );
  if (!audit.valid) throw new RegistryContractError(audit);

  const nodes = categories.flatMap(({ category, nodes: definitions }) =>
    definitions.map((definition): PublicNodeDescriptor => {
      const metadata = NODE_PUBLIC_METADATA[definition.type];
      return {
        type: definition.type,
        label: definition.label ?? definition.type,
        category,
        description: metadata.description,
        inputs: definition.inputs.map(socketDescriptor),
        outputs: definition.outputs.map(socketDescriptor),
        params: definition.params.map((param) =>
          paramDescriptor(definition.type, definition.params, param, limits)),
        traits: {
          usesFrame: definition.usesFrame === true,
          requiresGpu: metadata.gpuRequirement === 'required',
          gpuRequirement: metadata.gpuRequirement,
          asynchronous: metadata.asynchronous,
          expensive: metadata.expensive,
          externalDownload: metadata.externalDownload,
        },
        execution: { ...metadata.execution },
      };
    }),
  );

  return {
    protocolVersion: '1.0',
    documentSchemaVersions: [3, 4],
    socketTypes: [...SOCKET_TYPES],
    nodes,
    limits: { ...limits },
    features: {
      transactions: true,
      dryRun: true,
      previews: true,
      renderedNodeMeasurements: true,
      assets: true,
      mcp: false,
    },
    permissions: {
      localFonts: {
        agentAvailable: false,
        requiresHumanGesture: true,
        familyEnumeration: 'disabled',
      },
    },
    preview: {
      formats: [...PREVIEW_FORMATS],
      defaultFormat: DEFAULT_PREVIEW_FORMAT,
      metricsVersion: PREVIEW_METRICS_VERSION,
      capturePolicy: PREVIEW_CAPTURE_POLICY,
    },
    measurement: {
      contractVersion: RENDERED_NODE_MEASUREMENT_VERSION,
      measurementPolicy: RENDERED_NODE_MEASUREMENT_POLICY,
      measurementStage: RENDERED_NODE_MEASUREMENT_STAGE,
      visibilityPolicy: RENDERED_NODE_VISIBILITY_POLICY,
      coordinateSpace: RENDERED_NODE_COORDINATE_SPACE,
      workPolicy: RENDERED_NODE_MEASUREMENT_WORK_POLICY,
      limits: { ...RENDERED_NODE_MEASUREMENT_LIMITS },
      maxTargets: MAX_RENDERED_NODE_MEASUREMENT_TARGETS,
      exactAttemptRequired: true,
      supportedValueKinds: ['text', 'vector', 'elements'],
    },
  };
}

export const CAPABILITY_MANIFEST = buildCapabilityManifest({
  limits: { ...DEFAULT_AGENT_LIMITS },
});
