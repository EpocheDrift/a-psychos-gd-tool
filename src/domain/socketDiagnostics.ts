import type { NodeInstance } from '../engine/graph';
import {
  socketTypes,
  type SocketSpec,
} from '../engine/registry';
import type { SocketType } from '../engine/values';
import type { JsonValue } from './json';

interface ExplicitConversion {
  fromType: SocketType;
  toType: SocketType;
  nodeType: string;
  inputSocket: string;
  outputSocket: string;
}

const EXPLICIT_CONVERSIONS: readonly ExplicitConversion[] = [
  {
    fromType: 'raster',
    toType: 'vector',
    nodeType: 'Trace',
    inputSocket: 'in',
    outputSocket: 'out',
  },
  {
    fromType: 'vector',
    toType: 'raster',
    nodeType: 'Rasterize',
    inputSocket: 'vector',
    outputSocket: 'out',
  },
  {
    fromType: 'text',
    toType: 'vector',
    nodeType: 'Outline',
    inputSocket: 'text',
    outputSocket: 'out',
  },
  {
    fromType: 'elements',
    toType: 'vector',
    nodeType: 'Flatten',
    inputSocket: 'in',
    outputSocket: 'out',
  },
] as const;

export interface SocketTypeMismatchDiagnostic {
  message: string;
  details: Record<string, JsonValue>;
  suggestedFix: string;
}

/**
 * Public, bounded recovery guidance for a typed edge mismatch. Conversions are
 * never implicit: when a canonical conversion exists, name its exact node and
 * sockets so an Agent can repair the plan without guessing.
 */
export function socketTypeMismatchDiagnostic(
  fromNode: Pick<NodeInstance, 'id' | 'type'>,
  fromSocket: SocketSpec,
  toNode: Pick<NodeInstance, 'id' | 'type'>,
  toSocket: SocketSpec,
): SocketTypeMismatchDiagnostic {
  // Diagnostics cross a public boundary, so never expose the registry's
  // readonly union arrays by reference.
  const sourceTypes = [...socketTypes(fromSocket)];
  const targetTypes = [...socketTypes(toSocket)];
  const conversion = EXPLICIT_CONVERSIONS.find((candidate) =>
    sourceTypes.includes(candidate.fromType)
    && targetTypes.includes(candidate.toType));
  const sourceLabel =
    `${fromNode.type}.${fromSocket.name} (${sourceTypes.join(' | ')})`;
  const targetLabel =
    `${toNode.type}.${toSocket.name} (${targetTypes.join(' | ')})`;
  const conversionCaveat = conversion?.nodeType === 'Flatten'
    ? ' Flatten can convert only vector/text elements; if the elements contain raster content, restructure the graph to Trace the raster before it becomes elements.'
    : '';

  return {
    message: `Cannot connect ${sourceLabel} to ${targetLabel}.`,
    details: {
      source: {
        nodeId: fromNode.id,
        nodeType: fromNode.type,
        socket: fromSocket.name,
        types: sourceTypes,
      },
      target: {
        nodeId: toNode.id,
        nodeType: toNode.type,
        socket: toSocket.name,
        types: targetTypes,
      },
      ...(conversion
        ? {
            requiredConversion: {
              nodeType: conversion.nodeType,
              inputSocket: conversion.inputSocket,
              outputSocket: conversion.outputSocket,
              fromType: conversion.fromType,
              toType: conversion.toType,
            },
          }
        : {}),
    },
    suggestedFix: conversion
      ? `Insert a ${conversion.nodeType} node: connect ${fromNode.type}.${fromSocket.name} to ${conversion.nodeType}.${conversion.inputSocket}, then ${conversion.nodeType}.${conversion.outputSocket} to ${toNode.type}.${toSocket.name}.${conversionCaveat} Submit the corrected transaction with a new requestId because the rejected requestId is already bound to the original plan.`
      : `Choose sockets with a shared type; the source emits ${sourceTypes.join(' | ')} and the target accepts ${targetTypes.join(' | ')}. Submit the corrected transaction with a new requestId because the rejected requestId is already bound to the original plan.`,
  };
}
