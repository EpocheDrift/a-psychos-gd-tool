import type { ParamSpec } from '../engine/registry';
import { compileExpr } from '../util/expr';
import type { AgentErrorCode } from './agentErrors';
import type { JsonValue } from './json';
import { utf8ByteLength } from './json';
import type { AgentLimits } from './limits';
import {
  COLOR_PATTERN,
  decodeBinds,
  isSafeChannelName,
  validateImageSource,
  validatePositiveNumberList,
  type ImageSourceInfo,
  type PublicBind,
} from './paramCodecs';
import { isAssetId } from './assetPolicy';
import { getParamPublicMetadata } from './publicNodeMetadata';

export interface ParamIssue {
  code: AgentErrorCode;
  message: string;
  pathSuffix?: string;
  details?: Record<string, JsonValue>;
}

export interface ParamValidationResult {
  issues: ParamIssue[];
  decodedBinds?: PublicBind[];
  image?: ImageSourceInfo;
}

function typeIssue(expected: string, actual: unknown): ParamIssue {
  return {
    code: 'INVALID_ARGUMENT',
    message: `Parameter must be ${expected}.`,
    details: { expected, actualType: actual === null ? 'null' : Array.isArray(actual) ? 'array' : typeof actual },
  };
}

export function validateParamValue(
  nodeType: string,
  param: ParamSpec,
  value: unknown,
  limits: AgentLimits,
): ParamValidationResult {
  const metadata = getParamPublicMetadata(nodeType, param);
  const issues: ParamIssue[] = [];

  switch (param.kind) {
    case 'number': {
      if (typeof value !== 'number') return { issues: [typeIssue('a number', value)] };
      if (!Number.isFinite(value)) {
        return { issues: [{ code: 'INVALID_ARGUMENT', message: 'Parameter must be finite.' }] };
      }
      const minimum = metadata.minimum ?? param.min;
      const maximum = metadata.maximum ?? param.max;
      if (metadata.integer && !Number.isInteger(value)) {
        issues.push({ code: 'INVALID_ARGUMENT', message: 'Parameter must be an integer.' });
      }
      if (minimum !== undefined && value < minimum) {
        issues.push({
          code: 'INVALID_ARGUMENT',
          message: `Parameter must be at least ${minimum}.`,
          details: { minimum },
        });
      }
      if (maximum !== undefined && value > maximum) {
        issues.push({
          code: 'INVALID_ARGUMENT',
          message: `Parameter must be at most ${maximum}.`,
          details: { maximum },
        });
      }
      return { issues };
    }

    case 'toggle':
      return typeof value === 'boolean'
        ? { issues }
        : { issues: [typeIssue('boolean', value)] };

    case 'color':
      if (typeof value !== 'string') return { issues: [typeIssue('a color string', value)] };
      return COLOR_PATTERN.test(value)
        ? { issues }
        : { issues: [{ code: 'INVALID_ARGUMENT', message: 'Color must use six-digit #rrggbb syntax.' }] };

    case 'select':
      if (typeof value !== 'string') return { issues: [typeIssue('a string enum value', value)] };
      return param.options.includes(value)
        ? { issues }
        : {
            issues: [{
              code: 'INVALID_ARGUMENT',
              message: 'Parameter is not one of the supported enum values.',
              details: { allowed: [...param.options] },
            }],
          };

    case 'string': {
      if (typeof value !== 'string') return { issues: [typeIssue('a string', value)] };
      const characterLength = [...value].length;
      if (metadata.minLength !== undefined && characterLength < metadata.minLength) {
        issues.push({
          code: 'INVALID_ARGUMENT',
          message: `String must contain at least ${metadata.minLength} characters.`,
          details: { minimumLength: metadata.minLength },
        });
      }
      const effectiveMaxLength = Math.min(
        metadata.maxLength ?? limits.maxStringBytes,
        limits.maxStringBytes,
      );
      if (characterLength > effectiveMaxLength) {
        issues.push({
          code: 'RESOURCE_LIMIT',
          message: `String exceeds ${effectiveMaxLength} characters.`,
          details: { actualLength: characterLength, maximumLength: effectiveMaxLength },
        });
      }
      const formatByteLimit = metadata.format === 'math-expression-v1'
        || metadata.format === 'positive-number-list-v1'
        ? limits.maxExpressionBytes
        : limits.maxStringBytes;
      const byteLimit = Math.min(
        metadata.maxBytes ?? limits.maxStringBytes,
        limits.maxStringBytes,
        formatByteLimit,
      );
      const bytes = utf8ByteLength(value);
      if (bytes > byteLimit) {
        issues.push({
          code: 'RESOURCE_LIMIT',
          message: `String exceeds ${byteLimit} UTF-8 bytes.`,
          details: { actualBytes: bytes, maximumBytes: byteLimit },
        });
      }
      if (metadata.format === 'font-key-v1' && /[\u0000-\u001f\u007f]/.test(value)) {
        issues.push({ code: 'INVALID_ARGUMENT', message: 'Font key contains a control character.' });
      }
      if (metadata.format === 'positive-number-list-v1') {
        for (const issue of validatePositiveNumberList(value, byteLimit)) {
          issues.push({
            code: issue.message.includes('exceeds') ? 'RESOURCE_LIMIT' : 'INVALID_ARGUMENT',
            message: issue.message,
            pathSuffix: issue.path,
            ...(issue.details ? { details: issue.details } : {}),
          });
        }
      }
      if (metadata.format === 'math-expression-v1') {
        const expressionBytes = utf8ByteLength(value);
        if (expressionBytes > byteLimit) {
          issues.push({
            code: 'RESOURCE_LIMIT',
            message: `Expression exceeds ${byteLimit} UTF-8 bytes.`,
            details: { actualBytes: expressionBytes, maximumBytes: byteLimit },
          });
        } else if (!issues.some((issue) => issue.code === 'RESOURCE_LIMIT')) {
          try {
            compileExpr(value, metadata.expressionVariables);
          } catch {
            issues.push({
              code: 'INVALID_ARGUMENT',
              message: 'Expression does not conform to math-expression-v1.',
            });
          }
        }
      }
      return { issues };
    }

    case 'channel':
      if (typeof value !== 'string') return { issues: [typeIssue('a channel string', value)] };
      {
        const maximumLength = Math.min(
          metadata.maxLength ?? limits.maxIdLength,
          limits.maxIdLength,
        );
        return isSafeChannelName(value, maximumLength)
        ? { issues }
        : {
            issues: [{
              code: 'INVALID_ARGUMENT',
              message: `Channel must be a safe non-empty name of at most ${maximumLength} characters.`,
            }],
          };
      }

    case 'binds': {
      const decoded = decodeBinds(
        value,
        limits.maxBinds,
        limits.maxStringBytes,
        Math.min(128, limits.maxIdLength),
      );
      if (!decoded.ok) {
        return {
          issues: decoded.issues.map((issue) => ({
            code: issue.code ?? 'INVALID_ARGUMENT',
            message: issue.message,
            ...(issue.path ? { pathSuffix: issue.path } : {}),
            ...(issue.details ? { details: issue.details } : {}),
          })),
        };
      }
      return { issues, decodedBinds: decoded.value };
    }

    case 'image': {
      if (metadata.format === 'asset-id-v1') {
        if (typeof value !== 'string') {
          return { issues: [typeIssue('an asset ID string', value)] };
        }
        return value === '' || isAssetId(value)
          ? { issues }
          : {
              issues: [{
                code: 'ASSET_POLICY_VIOLATION',
                message:
                  'Image assetId must be empty or use asset_<sha256> content addressing.',
              }],
            };
      }
      const validated = validateImageSource(value, limits.maxLegacyAssetBytes, limits.maxAssetPixels);
      if (!validated.ok) {
        const resourceLimit = validated.issue.details !== undefined
          && ('maximumBytes' in validated.issue.details || 'maximumPixels' in validated.issue.details);
        return {
          issues: [{
            code: resourceLimit ? 'RESOURCE_LIMIT' : 'ASSET_POLICY_VIOLATION',
            message: validated.issue.message,
            ...(validated.issue.details ? { details: validated.issue.details } : {}),
          }],
        };
      }
      return { issues, image: validated.value };
    }
  }
}
