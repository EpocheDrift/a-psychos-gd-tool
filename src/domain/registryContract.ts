import type { ParamSpec, Registry, SocketSpec } from '../engine/registry';
import { socketTypes } from '../engine/registry';
import type { SocketType } from '../engine/values';
import { PALETTE, type NodeCategory } from '../nodes';
import {
  FindingCollector,
  type ValidationReport,
} from './agentErrors';
import { joinJsonPointer } from './json';
import { DEFAULT_AGENT_LIMITS, type AgentLimits } from './limits';
import { isSafeId } from './paramCodecs';
import { validateParamValue } from './paramValidation';
import { getParamPublicMetadata, NODE_PUBLIC_METADATA } from './publicNodeMetadata';

export const SOCKET_TYPES: readonly SocketType[] = [
  'text',
  'vector',
  'raster',
  'alpha',
  'elements',
  'layout',
];

function auditSocketList(
  collector: FindingCollector,
  sockets: readonly SocketSpec[],
  path: string,
  limits: AgentLimits,
): void {
  const names = new Set<string>();
  sockets.forEach((socket, index) => {
    const socketPath = joinJsonPointer(path, index);
    if (!isSafeId(socket.name, limits.maxIdLength)) {
      collector.error({
        code: 'INVARIANT_VIOLATION',
        message: `Socket name "${socket.name}" is not a safe public identifier.`,
        path: joinJsonPointer(socketPath, 'name'),
      });
    }
    if (names.has(socket.name)) {
      collector.error({
        code: 'INVARIANT_VIOLATION',
        message: `Socket name "${socket.name}" is duplicated.`,
        path: joinJsonPointer(socketPath, 'name'),
      });
    }
    names.add(socket.name);
    const types = socketTypes(socket);
    if (types.length === 0 || new Set(types).size !== types.length) {
      collector.error({
        code: 'INVARIANT_VIOLATION',
        message: 'Socket type union must be non-empty and duplicate-free.',
        path: joinJsonPointer(socketPath, 'type'),
      });
    }
    for (const type of types) {
      if (!SOCKET_TYPES.includes(type)) {
        collector.error({
          code: 'INVARIANT_VIOLATION',
          message: `Socket type "${type}" is not public.`,
          path: joinJsonPointer(socketPath, 'type'),
        });
      }
    }
  });
}

function auditParamDefinition(
  collector: FindingCollector,
  nodeType: string,
  param: ParamSpec,
  params: readonly ParamSpec[],
  path: string,
  limits: AgentLimits,
): void {
  if (!isSafeId(param.name, limits.maxIdLength)) {
    collector.error({
      code: 'INVARIANT_VIOLATION',
      message: `Parameter name "${param.name}" is not a safe public identifier.`,
      path: joinJsonPointer(path, 'name'),
    });
  }

  if (param.kind === 'number') {
    if (param.min !== undefined && !Number.isFinite(param.min)) {
      collector.error({ code: 'INVARIANT_VIOLATION', message: 'Number minimum must be finite.', path });
    }
    if (param.max !== undefined && !Number.isFinite(param.max)) {
      collector.error({ code: 'INVARIANT_VIOLATION', message: 'Number maximum must be finite.', path });
    }
    if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
      collector.error({ code: 'INVARIANT_VIOLATION', message: 'Number minimum exceeds maximum.', path });
    }
    if (param.step !== undefined && (!Number.isFinite(param.step) || param.step <= 0)) {
      collector.error({ code: 'INVARIANT_VIOLATION', message: 'Number step must be finite and positive.', path });
    }
  }

  if (
    param.kind === 'select'
    && (
      param.options.length === 0
      || new Set(param.options).size !== param.options.length
      || !param.options.includes(param.default)
    )
  ) {
    collector.error({
      code: 'INVARIANT_VIOLATION',
      message: 'Select options must be non-empty, unique, and contain the default.',
      path,
    });
  }

  const defaultResult = validateParamValue(nodeType, param, param.default, limits);
  for (const issue of defaultResult.issues) {
    collector.error({
      code: 'INVARIANT_VIOLATION',
      message: `Default for ${nodeType}.${param.name} is invalid: ${issue.message}`,
      path: joinJsonPointer(path, 'default'),
      ...(issue.details ? { details: issue.details } : {}),
    });
  }

  const metadata = getParamPublicMetadata(nodeType, param);
  if (!metadata.description.trim()) {
    collector.error({
      code: 'INVARIANT_VIOLATION',
      message: 'Public parameter description is required.',
      path: joinJsonPointer(path, 'description'),
    });
  }

  if (param.showIf) {
    const controlling = params.find((candidate) => candidate.name === param.showIf?.param);
    const visibilityPath = joinJsonPointer(path, 'showIf');
    if (!controlling || controlling === param) {
      collector.error({
        code: 'INVARIANT_VIOLATION',
        message: 'showIf must reference another parameter on the same node.',
        path: visibilityPath,
      });
    } else {
      for (const condition of param.showIf.in) {
        const valid =
          controlling.kind === 'toggle'
            ? condition === 'true' || condition === 'false'
            : controlling.kind === 'select'
              ? controlling.options.includes(condition)
              : controlling.kind === 'string'
                || controlling.kind === 'channel'
                || controlling.kind === 'image';
        if (!valid) {
          collector.error({
            code: 'INVARIANT_VIOLATION',
            message: `showIf value "${condition}" is impossible for ${controlling.name}.`,
            path: joinJsonPointer(visibilityPath, 'in'),
          });
        }
      }
    }
  }
}

export function auditRegistryContract(
  categories: readonly NodeCategory[] = PALETTE,
  registry?: Registry,
  limits: AgentLimits = { ...DEFAULT_AGENT_LIMITS },
): ValidationReport {
  const collector = new FindingCollector(limits.maxFindings);
  const seenTypes = new Set<string>();
  const paletteTypes: string[] = [];

  categories.forEach((category, categoryIndex) => {
    const categoryPath = `/categories/${categoryIndex}`;
    if (!category.category.trim() || category.nodes.length === 0) {
      collector.error({
        code: 'INVARIANT_VIOLATION',
        message: 'Palette categories require a name and at least one node.',
        path: categoryPath,
      });
    }
    category.nodes.forEach((definition, nodeIndex) => {
      const path = `${categoryPath}/nodes/${nodeIndex}`;
      paletteTypes.push(definition.type);
      if (!isSafeId(definition.type, limits.maxIdLength)) {
        collector.error({
          code: 'INVARIANT_VIOLATION',
          message: `Node type "${definition.type}" is not a safe public identifier.`,
          path: joinJsonPointer(path, 'type'),
        });
      }
      if (seenTypes.has(definition.type)) {
        collector.error({
          code: 'INVARIANT_VIOLATION',
          message: `Node type "${definition.type}" is duplicated.`,
          path: joinJsonPointer(path, 'type'),
        });
      }
      seenTypes.add(definition.type);

      const publicMetadata = NODE_PUBLIC_METADATA[definition.type];
      if (!publicMetadata || !publicMetadata.description.trim()) {
        collector.error({
          code: 'INVARIANT_VIOLATION',
          message: `Node type "${definition.type}" lacks public description and execution metadata.`,
          path,
        });
      }

      auditSocketList(collector, definition.inputs, joinJsonPointer(path, 'inputs'), limits);
      auditSocketList(collector, definition.outputs, joinJsonPointer(path, 'outputs'), limits);

      const paramNames = new Set<string>();
      definition.params.forEach((param, paramIndex) => {
        const paramPath = `${path}/params/${paramIndex}`;
        if (paramNames.has(param.name)) {
          collector.error({
            code: 'INVARIANT_VIOLATION',
            message: `Parameter "${param.name}" is duplicated.`,
            path: joinJsonPointer(paramPath, 'name'),
          });
        }
        paramNames.add(param.name);
        auditParamDefinition(collector, definition.type, param, definition.params, paramPath, limits);
      });
    });
  });

  for (const metadataType of Object.keys(NODE_PUBLIC_METADATA).sort()) {
    if (!seenTypes.has(metadataType)) {
      collector.error({
        code: 'INVARIANT_VIOLATION',
        message: `Public metadata exists for unknown node type "${metadataType}".`,
        path: `/metadata/${metadataType}`,
      });
    }
  }

  if (registry) {
    const registryTypes = [...registry.keys()];
    if (
      registryTypes.length !== paletteTypes.length
      || registryTypes.some((type, index) => type !== paletteTypes[index])
    ) {
      collector.error({
        code: 'INVARIANT_VIOLATION',
        message: 'Palette and registry type order differ.',
        path: '/registry',
        details: { paletteTypes, registryTypes },
      });
    }
    for (const type of paletteTypes) {
      if (registry.get(type) !== categories.flatMap((category) => category.nodes).find((node) => node.type === type)) {
        collector.error({
          code: 'INVARIANT_VIOLATION',
          message: `Registry definition for "${type}" does not match the palette definition.`,
          path: `/registry/${type}`,
        });
      }
    }
  }

  return collector.report('structural', null);
}
