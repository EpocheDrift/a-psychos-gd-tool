import type { Doc } from '../engine/graph';
import {
  FindingCollector,
  type ValidationFinding,
  type ValidationMode,
  type ValidationReport,
} from './agentErrors';
import {
  createSerializedProject,
  type AssetMetadata,
  type SerializedProjectV3,
} from './documentSchema';
import { canonicalJsonStringify, utf8ByteLength, type JsonValue } from './json';
import { resolveAgentLimits, type AgentLimits } from './limits';
import {
  migrateProject,
  type MigrationSource,
} from './migrations';
import { validateSerializedProject } from './semanticValidation';

export interface ProjectCodecOptions {
  documentIdForLegacy?: string;
  mode?: ValidationMode;
  limits?: Partial<AgentLimits>;
  maxFindings?: number;
}

export type ProjectImportResult =
  | {
      ok: true;
      source: MigrationSource;
      project: SerializedProjectV3;
      warnings: ValidationFinding[];
      report: ValidationReport;
    }
  | {
      ok: false;
      report: ValidationReport;
    };

export type ProjectExportResult =
  | {
      ok: true;
      project: SerializedProjectV3;
      json: string;
      report: ValidationReport;
    }
  | {
      ok: false;
      report: ValidationReport;
    };

function parseFailure(
  message: string,
  code: 'INVALID_ARGUMENT' | 'RESOURCE_LIMIT',
  details: Record<string, JsonValue> | undefined,
  maxFindings: number,
): ProjectImportResult {
  const collector = new FindingCollector(maxFindings);
  collector.error({
    code,
    message,
    path: '',
    ...(details ? { details } : {}),
  });
  return { ok: false, report: collector.report('structural', null) };
}

export function prepareProjectImport(
  value: unknown,
  options: ProjectCodecOptions = {},
): ProjectImportResult {
  const limits = resolveAgentLimits(options.limits);
  const migration = migrateProject(value, {
    documentIdForLegacy: options.documentIdForLegacy,
    limits,
    maxFindings: options.maxFindings,
  });
  if (!migration.ok) return migration;
  const report = validateSerializedProject(migration.project, {
    mode: options.mode ?? 'renderable',
    limits,
    maxFindings: options.maxFindings,
  });
  const combined = new FindingCollector(options.maxFindings ?? limits.maxFindings);
  combined.append(report.errors);
  combined.append(migration.warnings);
  combined.append(report.warnings);
  const combinedReport = combined.report(report.mode, report.schemaVersion);
  if (migration.truncated || report.truncated) combinedReport.truncated = true;
  const warnings = combinedReport.warnings;
  if (!combinedReport.valid) return { ok: false, report: combinedReport };
  return {
    ok: true,
    source: migration.source,
    project: migration.project,
    warnings,
    report: combinedReport,
  };
}

export function importProjectJson(
  json: string,
  options: ProjectCodecOptions = {},
): ProjectImportResult {
  const limits = resolveAgentLimits(options.limits);
  const encodedAssetAllowance = Math.ceil(
    limits.maxLegacyAssetBytesPerDocument * 4 / 3,
  );
  const maxRawBytes = Math.min(
    Number.MAX_SAFE_INTEGER,
    limits.maxDocumentJsonBytes + encodedAssetAllowance + 1024 * 1024,
  );
  const rawBytes = utf8ByteLength(json);
  if (rawBytes > maxRawBytes) {
    return parseFailure(
      `Project import exceeds the ${maxRawBytes}-byte parsing preflight limit.`,
      'RESOURCE_LIMIT',
      { actualBytes: rawBytes, maximumBytes: maxRawBytes },
      options.maxFindings ?? limits.maxFindings,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return parseFailure(
      'Project text is not valid JSON.',
      'INVALID_ARGUMENT',
      undefined,
      options.maxFindings ?? limits.maxFindings,
    );
  }
  return prepareProjectImport(value, { ...options, limits });
}

export function exportProjectJson(
  project: SerializedProjectV3,
  options: Omit<ProjectCodecOptions, 'documentIdForLegacy'> = {},
): ProjectExportResult {
  const report = validateSerializedProject(project, {
    mode: options.mode ?? 'renderable',
    limits: options.limits,
    maxFindings: options.maxFindings,
  });
  if (!report.valid) return { ok: false, report };
  return {
    ok: true,
    project,
    json: `${canonicalJsonStringify(project as unknown as JsonValue, 2)}\n`,
    report,
  };
}

export function exportDocumentJson(
  documentId: string,
  document: Doc,
  options: Omit<ProjectCodecOptions, 'documentIdForLegacy'> = {},
  assets?: AssetMetadata[],
): ProjectExportResult {
  return exportProjectJson(createSerializedProject(documentId, document, assets), options);
}
