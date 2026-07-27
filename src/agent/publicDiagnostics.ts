import type {
  AgentFailure,
  TransactionResult,
} from '../domain/commandTypes';
import {
  validateJsonValueSafety,
} from '../domain/documentSchema';
import type {
  ValidationFinding,
  ValidationReport,
} from '../domain/agentErrors';
import {
  isPlainRecord,
  type JsonValue,
} from '../domain/json';
import {
  redactDiagnosticDetails,
  redactDiagnosticString,
} from './redaction';

function safeDiagnosticDetails(
  value: Record<string, JsonValue> | undefined,
): Record<string, JsonValue> | undefined {
  if (value === undefined) return undefined;
  try {
    const safety = validateJsonValueSafety(value, { maxFindings: 1 });
    if (!safety.valid || !isPlainRecord(value)) return undefined;
    return redactDiagnosticDetails(value);
  } catch {
    return undefined;
  }
}

export function sanitizeValidationFinding(
  finding: ValidationFinding,
): ValidationFinding {
  const details = safeDiagnosticDetails(finding.details);
  return {
    severity: finding.severity,
    code: finding.code,
    message: redactDiagnosticString(finding.message),
    path: redactDiagnosticString(finding.path),
    recoverable: finding.recoverable,
    ...(details ? { details } : {}),
    ...(finding.suggestedFix
      ? { suggestedFix: redactDiagnosticString(finding.suggestedFix) }
      : {}),
  };
}

export function sanitizeValidationReport(
  report: ValidationReport,
): ValidationReport {
  return {
    valid: report.valid,
    mode: report.mode,
    schemaVersion: report.schemaVersion,
    errors: report.errors.map(sanitizeValidationFinding),
    warnings: report.warnings.map(sanitizeValidationFinding),
    ...(report.truncated ? { truncated: true } : {}),
  };
}

export function sanitizeAgentFailure(failure: AgentFailure): AgentFailure {
  const details = safeDiagnosticDetails(failure.error.details);
  return {
    ok: false,
    ...(failure.requestId === undefined
      ? {}
      : { requestId: failure.requestId }),
    revision: failure.revision,
    error: {
      code: failure.error.code,
      message: redactDiagnosticString(failure.error.message),
      ...(failure.error.path === undefined
        ? {}
        : { path: redactDiagnosticString(failure.error.path) }),
      ...(failure.error.commandIndex === undefined
        ? {}
        : { commandIndex: failure.error.commandIndex }),
      ...(details ? { details } : {}),
      recoverable: failure.error.recoverable,
      ...(failure.error.suggestedFix
        ? {
            suggestedFix: redactDiagnosticString(
              failure.error.suggestedFix,
            ),
          }
        : {}),
    },
  };
}

export function sanitizeTransactionResult(
  result: TransactionResult,
): TransactionResult {
  if (!result.ok) return sanitizeAgentFailure(result);
  return {
    ...result,
    warnings: result.warnings.map(sanitizeValidationFinding),
  };
}
