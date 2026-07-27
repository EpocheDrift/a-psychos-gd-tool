import type { JsonValue } from './json';

export const AGENT_ERROR_CODES = [
  'INVALID_ARGUMENT',
  'UNSUPPORTED_SCHEMA_VERSION',
  'UNKNOWN_LAYER',
  'UNKNOWN_NODE',
  'UNKNOWN_NODE_TYPE',
  'UNKNOWN_PARAM',
  'UNKNOWN_SOCKET',
  'TYPE_MISMATCH',
  'INPUT_ALREADY_CONNECTED',
  'CYCLE_DETECTED',
  'OUTPUT_MISSING',
  'OUTPUT_AMBIGUOUS',
  'REQUIRED_INPUT_MISSING',
  'INVARIANT_VIOLATION',
  'RESOURCE_LIMIT',
  'ASSET_POLICY_VIOLATION',
  'PERMISSION_REQUIRED',
  'MODEL_DOWNLOAD_REQUIRED',
  'CONFIRMATION_REQUIRED',
  'REVISION_CONFLICT',
  'REQUEST_ID_REUSED',
  'RENDER_FAILED',
  'RENDER_SUPERSEDED',
  'WEBGPU_UNAVAILABLE',
  'TIMEOUT',
  'PERSISTENCE_FAILED',
  'INTERNAL',
] as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export const AGENT_WARNING_CODES = [
  'LEGACY_FORMAT_MIGRATED',
  'VALUE_NORMALIZED',
  'DEPRECATED_VALUE_MIGRATED',
] as const;

export type AgentWarningCode = (typeof AGENT_WARNING_CODES)[number];
export type ValidationMode = 'structural' | 'editable' | 'renderable';

export interface ValidationFinding {
  severity: 'error' | 'warning';
  code: AgentErrorCode | AgentWarningCode;
  message: string;
  /** RFC 6901 JSON Pointer. The empty string addresses the root. */
  path: string;
  recoverable: boolean;
  details?: Record<string, JsonValue>;
  suggestedFix?: string;
}

export interface ValidationReport {
  valid: boolean;
  mode: ValidationMode;
  schemaVersion: number | null;
  errors: ValidationFinding[];
  warnings: ValidationFinding[];
  truncated?: boolean;
}

export interface FindingInput {
  code: AgentErrorCode | AgentWarningCode;
  message: string;
  path: string;
  recoverable?: boolean;
  details?: Record<string, JsonValue>;
  suggestedFix?: string;
}

export class FindingCollector {
  readonly errors: ValidationFinding[] = [];
  readonly warnings: ValidationFinding[] = [];
  truncated = false;
  private errorObserved = false;
  private readonly maxFindings: number;

  constructor(maxFindings: number) {
    // A caller-controlled response cap must never be able to suppress every
    // error and turn an invalid value into a valid report.
    this.maxFindings = Number.isSafeInteger(maxFindings) && maxFindings >= 1
      ? Math.min(maxFindings, 4096)
      : 1;
  }

  error(input: FindingInput): void {
    this.add('error', input);
  }

  warning(input: FindingInput): void {
    this.add('warning', input);
  }

  append(findings: readonly ValidationFinding[]): void {
    for (const finding of findings) {
      if (finding.severity === 'error') this.error(finding);
      else this.warning(finding);
    }
  }

  report(mode: ValidationMode, schemaVersion: number | null): ValidationReport {
    return {
      valid: !this.errorObserved,
      mode,
      schemaVersion,
      errors: this.errors,
      warnings: this.warnings,
      ...(this.truncated ? { truncated: true } : {}),
    };
  }

  private add(severity: ValidationFinding['severity'], input: FindingInput): void {
    if (severity === 'error') this.errorObserved = true;
    if (this.errors.length + this.warnings.length >= this.maxFindings) {
      this.truncated = true;
      return;
    }
    const finding: ValidationFinding = {
      severity,
      code: input.code,
      message: input.message,
      path: input.path,
      recoverable: input.recoverable ?? true,
      ...(input.details ? { details: input.details } : {}),
      ...(input.suggestedFix ? { suggestedFix: input.suggestedFix } : {}),
    };
    (severity === 'error' ? this.errors : this.warnings).push(finding);
  }
}
