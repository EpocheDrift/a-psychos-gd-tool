import type { Doc } from '../engine/graph';
import {
  FindingCollector,
  type ValidationFinding,
  type ValidationMode,
  type ValidationReport,
} from './agentErrors';
import {
  createSerializedProject,
  CURRENT_SCHEMA_VERSION,
  type AssetMetadata,
  type SerializedProjectV4,
  validateJsonValueSafety,
} from './documentSchema';
import {
  decodeStrictBase64,
  prepareAssetBytes,
  strictBase64DecodedLength,
  type PreparedAsset,
} from './assetPolicy';
import {
  MISSING,
  canonicalJsonStringify,
  isPlainRecord,
  joinJsonPointer,
  readOwnData,
  utf8ByteLength,
  type JsonValue,
} from './json';
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

export const PORTABLE_PROJECT_FORMAT =
  'a-psychos-gd-tool-portable-project' as const;
export const PORTABLE_PROJECT_VERSION = 1 as const;

export interface PortableProjectAssetV1 {
  assetId: string;
  dataBase64: string;
}

export interface PortableProjectV1 {
  format: typeof PORTABLE_PROJECT_FORMAT;
  bundleVersion: typeof PORTABLE_PROJECT_VERSION;
  project: SerializedProjectV4;
  assets: PortableProjectAssetV1[];
}

export type ProjectImportSource =
  | MigrationSource
  | 'portable-project-v1';

export type ProjectImportResult =
  | {
      ok: true;
      source: ProjectImportSource;
      project: SerializedProjectV4;
      assetsToStage: PreparedAsset[];
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
      project: SerializedProjectV4;
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

function prefixFindingPath(
  finding: ValidationFinding,
  prefix: string,
): ValidationFinding {
  return {
    ...finding,
    path: finding.path === '' ? prefix : `${prefix}${finding.path}`,
  };
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  collector: FindingCollector,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value).sort()) {
    if (allowedSet.has(key)) continue;
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: `Unknown field "${key}".`,
      path: joinJsonPointer(path, key),
    });
  }
}

function sameAssetMetadata(
  left: AssetMetadata,
  right: AssetMetadata,
): boolean {
  return (
    left.id === right.id
    && left.sha256 === right.sha256
    && left.mimeType === right.mimeType
    && left.byteLength === right.byteLength
    && left.width === right.width
    && left.height === right.height
    && left.source === right.source
  );
}

function prepareStandaloneProjectImport(
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
    assetsToStage: migration.assetsToStage,
    warnings,
    report: combinedReport,
  };
}

function preparePortableProjectImport(
  value: Record<string, unknown>,
  options: ProjectCodecOptions,
): ProjectImportResult {
  const limits = resolveAgentLimits(options.limits);
  const maxFindings = options.maxFindings ?? limits.maxFindings;
  const mode = options.mode ?? 'renderable';
  const collector = new FindingCollector(maxFindings);
  const safety = validateJsonValueSafety(value, { limits, maxFindings });
  collector.append(safety.errors);
  collector.append(safety.warnings);
  if (!safety.valid) {
    return { ok: false, report: collector.report('structural', null) };
  }

  rejectUnknownFields(
    value,
    ['format', 'bundleVersion', 'project', 'assets'],
    '',
    collector,
  );
  if (readOwnData(value, 'format') !== PORTABLE_PROJECT_FORMAT) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: `Portable project format must be "${PORTABLE_PROJECT_FORMAT}".`,
      path: '/format',
    });
  }
  if (readOwnData(value, 'bundleVersion') !== PORTABLE_PROJECT_VERSION) {
    collector.error({
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      message: 'Portable project bundle version is not supported by this build.',
      path: '/bundleVersion',
      recoverable: false,
      details: { supportedVersions: [PORTABLE_PROJECT_VERSION] },
    });
  }
  const projectValue = readOwnData(value, 'project');
  if (projectValue === MISSING) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: 'Required field "project" is missing.',
      path: '/project',
    });
  } else if (!isPlainRecord(projectValue)) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: 'Portable project payload must be an object.',
      path: '/project',
    });
  }
  const assetValues = readOwnData(value, 'assets');
  if (assetValues === MISSING) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: 'Required field "assets" is missing.',
      path: '/assets',
    });
  } else if (!Array.isArray(assetValues)) {
    collector.error({
      code: 'INVALID_ARGUMENT',
      message: 'Portable project assets must be an array.',
      path: '/assets',
    });
  }
  let report = collector.report(mode, null);
  if (!isPlainRecord(projectValue) || !Array.isArray(assetValues)) {
    return { ok: false, report };
  }

  const nested = prepareStandaloneProjectImport(projectValue, {
    ...options,
    limits,
  });
  if (!nested.ok) {
    collector.append(nested.report.errors.map((finding) =>
      prefixFindingPath(finding, '/project')));
    collector.append(nested.report.warnings.map((finding) =>
      prefixFindingPath(finding, '/project')));
    report = collector.report(mode, nested.report.schemaVersion);
    if (nested.report.truncated) report.truncated = true;
    return { ok: false, report };
  }
  collector.append(nested.report.warnings.map((finding) =>
    prefixFindingPath(finding, '/project')));
  if (nested.source !== 'project-v4') {
    collector.error({
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      message: 'Portable project bundles must contain a version 4 project.',
      path: '/project/schemaVersion',
      recoverable: false,
      details: { supportedVersions: [CURRENT_SCHEMA_VERSION] },
    });
  }

  const expectedAssets = new Map(
    (nested.project.assets ?? [])
      .filter((asset) => asset.source !== 'bundled')
      .map((asset) => [asset.id, asset] as const),
  );
  if (assetValues.length !== expectedAssets.size) {
    collector.error({
      code: 'ASSET_POLICY_VIOLATION',
      message:
        'Portable project asset payload count does not match its manifest.',
      path: '/assets',
      details: {
        actual: assetValues.length,
        expected: expectedAssets.size,
      },
    });
  }

  const seen = new Set<string>();
  const payloadsToDecode: Array<{
    assetPath: string;
    dataBase64: string;
    metadata: AssetMetadata;
  }> = [];
  let decodedBytes = 0;
  for (let index = 0; index < assetValues.length; index++) {
    const assetPath = joinJsonPointer('/assets', index);
    const assetValue = assetValues[index];
    if (!isPlainRecord(assetValue)) {
      collector.error({
        code: 'INVALID_ARGUMENT',
        message: 'Portable project asset payload must be an object.',
        path: assetPath,
      });
      continue;
    }
    rejectUnknownFields(
      assetValue,
      ['assetId', 'dataBase64'],
      assetPath,
      collector,
    );
    const assetId = readOwnData(assetValue, 'assetId');
    const dataBase64 = readOwnData(assetValue, 'dataBase64');
    if (typeof assetId !== 'string') {
      collector.error({
        code: 'INVALID_ARGUMENT',
        message: 'Portable project assetId must be a string.',
        path: joinJsonPointer(assetPath, 'assetId'),
      });
      continue;
    }
    if (typeof dataBase64 !== 'string') {
      collector.error({
        code: 'INVALID_ARGUMENT',
        message: 'Portable project asset dataBase64 must be a string.',
        path: joinJsonPointer(assetPath, 'dataBase64'),
      });
      continue;
    }
    if (seen.has(assetId)) {
      collector.error({
        code: 'INVARIANT_VIOLATION',
        message: `Portable project asset "${assetId}" is duplicated.`,
        path: joinJsonPointer(assetPath, 'assetId'),
      });
      continue;
    }
    seen.add(assetId);
    const metadata = expectedAssets.get(assetId);
    if (!metadata) {
      collector.error({
        code: 'ASSET_POLICY_VIOLATION',
        message: 'Portable project contains bytes outside its asset manifest.',
        path: joinJsonPointer(assetPath, 'assetId'),
      });
      continue;
    }
    const decodedLength = strictBase64DecodedLength(dataBase64);
    if (decodedLength === null) {
      collector.error({
        code: 'ASSET_POLICY_VIOLATION',
        message: 'Portable project asset bytes are not strict base64.',
        path: joinJsonPointer(assetPath, 'dataBase64'),
      });
      continue;
    }
    if (decodedLength !== metadata.byteLength) {
      collector.error({
        code: 'ASSET_POLICY_VIOLATION',
        message:
          'Portable project asset byte length does not match its manifest.',
        path: joinJsonPointer(assetPath, 'dataBase64'),
        details: {
          actualBytes: decodedLength,
          expectedBytes: metadata.byteLength,
        },
      });
      continue;
    }
    decodedBytes += decodedLength;
    if (decodedBytes > limits.maxLegacyAssetBytesPerDocument) {
      collector.error({
        code: 'RESOURCE_LIMIT',
        message:
          `Portable project assets exceed the ${
            limits.maxLegacyAssetBytesPerDocument
          }-byte document budget.`,
        path: '/assets',
        details: {
          actualBytes: decodedBytes,
          maximumBytes: limits.maxLegacyAssetBytesPerDocument,
        },
      });
      continue;
    }
    payloadsToDecode.push({ assetPath, dataBase64, metadata });
  }
  for (const assetId of [...expectedAssets.keys()].sort()) {
    if (seen.has(assetId)) continue;
    collector.error({
      code: 'ASSET_POLICY_VIOLATION',
      message: `Portable project is missing bytes for asset "${assetId}".`,
      path: '/assets',
    });
  }

  // Coverage, size, and canonical-base64 checks are deliberately complete
  // before allocating any decoded asset buffers.
  report = collector.report(mode, CURRENT_SCHEMA_VERSION);
  if (nested.report.truncated) report.truncated = true;
  if (!report.valid) return { ok: false, report };

  const assetsToStage: PreparedAsset[] = [];
  for (const { assetPath, dataBase64, metadata } of payloadsToDecode) {
    const bytes = decodeStrictBase64(
      dataBase64,
      limits.maxLegacyAssetBytes,
    );
    if (!bytes) {
      collector.error({
        code: 'RESOURCE_LIMIT',
        message:
          `Portable project asset exceeds the ${
            limits.maxLegacyAssetBytes
          }-byte asset budget.`,
        path: joinJsonPointer(assetPath, 'dataBase64'),
      });
      continue;
    }
    const prepared = prepareAssetBytes({
      bytes,
      mimeType: metadata.mimeType,
      source: metadata.source === 'generated' ? 'generated' : 'upload',
      expectedSha256: metadata.sha256,
    }, limits);
    if (!prepared.ok) {
      collector.error({
        code: prepared.issue.code,
        message: prepared.issue.message,
        path: joinJsonPointer(assetPath, 'dataBase64'),
        ...(prepared.issue.details ? { details: prepared.issue.details } : {}),
      });
      continue;
    }
    if (!sameAssetMetadata(prepared.asset.metadata, metadata)) {
      collector.error({
        code: 'ASSET_POLICY_VIOLATION',
        message:
          'Portable project asset metadata does not match its verified bytes.',
        path: assetPath,
      });
      continue;
    }
    assetsToStage.push(prepared.asset);
  }

  report = collector.report(mode, CURRENT_SCHEMA_VERSION);
  if (nested.report.truncated) report.truncated = true;
  if (!report.valid) return { ok: false, report };
  return {
    ok: true,
    source: 'portable-project-v1',
    project: nested.project,
    assetsToStage: assetsToStage.sort((left, right) =>
      left.metadata.id.localeCompare(right.metadata.id)),
    warnings: report.warnings,
    report,
  };
}

export function prepareProjectImport(
  value: unknown,
  options: ProjectCodecOptions = {},
): ProjectImportResult {
  if (
    isPlainRecord(value)
    && readOwnData(value, 'format') === PORTABLE_PROJECT_FORMAT
  ) {
    return preparePortableProjectImport(value, options);
  }
  return prepareStandaloneProjectImport(value, options);
}

export function maximumProjectImportJsonBytes(
  options: Pick<ProjectCodecOptions, 'limits'> = {},
): number {
  const limits = resolveAgentLimits(options.limits);
  const encodedAssetAllowance = Math.ceil(
    limits.maxLegacyAssetBytesPerDocument * 4 / 3,
  );
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    limits.maxDocumentJsonBytes * 2
      + encodedAssetAllowance
      + 1024 * 1024,
  );
}

export function importProjectJson(
  json: string,
  options: ProjectCodecOptions = {},
): ProjectImportResult {
  const limits = resolveAgentLimits(options.limits);
  const maxRawBytes = maximumProjectImportJsonBytes({ limits });
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

function bytesToStrictBase64(bytes: Uint8Array): string {
  const encoded: string[] = [];
  const chunkBytes = 3 * 16_384;
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    const chunk = bytes.subarray(offset, offset + chunkBytes);
    let binary = '';
    for (let index = 0; index < chunk.length; index++) {
      binary += String.fromCharCode(chunk[index]);
    }
    encoded.push(btoa(binary));
  }
  return encoded.join('');
}

export function exportProjectJson(
  project: SerializedProjectV4,
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

export function exportPortableProjectJson(
  project: SerializedProjectV4,
  assets: readonly PreparedAsset[],
  options: Omit<ProjectCodecOptions, 'documentIdForLegacy'> = {},
): ProjectExportResult {
  const exported = exportProjectJson(project, options);
  if (!exported.ok) return exported;
  const limits = resolveAgentLimits(options.limits);
  const collector = new FindingCollector(
    options.maxFindings ?? limits.maxFindings,
  );
  collector.append(exported.report.warnings);
  const expectedAssets = new Map(
    (project.assets ?? [])
      .filter((asset) => asset.source !== 'bundled')
      .map((asset) => [asset.id, asset] as const),
  );
  const seen = new Set<string>();
  const payloads: PortableProjectAssetV1[] = [];
  let totalBytes = 0;
  for (const asset of [...assets].sort((left, right) =>
    left.metadata.id.localeCompare(right.metadata.id))) {
    const assetId = asset.metadata.id;
    if (seen.has(assetId)) {
      collector.error({
        code: 'INVARIANT_VIOLATION',
        message: `Portable project asset "${assetId}" is duplicated.`,
        path: '/assets',
      });
      continue;
    }
    seen.add(assetId);
    const expected = expectedAssets.get(assetId);
    if (!expected) {
      collector.error({
        code: 'ASSET_POLICY_VIOLATION',
        message: 'Portable project export received bytes outside its manifest.',
        path: '/assets',
      });
      continue;
    }
    if (!asset.bytes) {
      collector.error({
        code: 'PERSISTENCE_FAILED',
        message: `Portable project asset "${assetId}" has no readable bytes.`,
        path: '/assets',
      });
      continue;
    }
    const prepared = prepareAssetBytes({
      bytes: asset.bytes,
      mimeType: expected.mimeType,
      source: expected.source === 'generated' ? 'generated' : 'upload',
      expectedSha256: expected.sha256,
    }, limits);
    if (!prepared.ok || !sameAssetMetadata(prepared.asset.metadata, expected)) {
      collector.error({
        code: prepared.ok
          ? 'ASSET_POLICY_VIOLATION'
          : prepared.issue.code,
        message: prepared.ok
          ? 'Portable project asset metadata does not match its verified bytes.'
          : prepared.issue.message,
        path: '/assets',
      });
      continue;
    }
    totalBytes += prepared.asset.metadata.byteLength;
    if (totalBytes > limits.maxLegacyAssetBytesPerDocument) {
      collector.error({
        code: 'RESOURCE_LIMIT',
        message:
          `Portable project assets exceed the ${
            limits.maxLegacyAssetBytesPerDocument
          }-byte document budget.`,
        path: '/assets',
      });
      continue;
    }
    payloads.push({
      assetId,
      dataBase64: bytesToStrictBase64(prepared.asset.bytes!),
    });
  }
  for (const assetId of [...expectedAssets.keys()].sort()) {
    if (seen.has(assetId)) continue;
    collector.error({
      code: 'PERSISTENCE_FAILED',
      message: `Portable project export could not read asset "${assetId}".`,
      path: '/assets',
    });
  }
  const report = collector.report(
    options.mode ?? 'renderable',
    CURRENT_SCHEMA_VERSION,
  );
  if (!report.valid) return { ok: false, report };
  const bundle: PortableProjectV1 = {
    format: PORTABLE_PROJECT_FORMAT,
    bundleVersion: PORTABLE_PROJECT_VERSION,
    project,
    assets: payloads,
  };
  return {
    ok: true,
    project,
    json: `${canonicalJsonStringify(
      bundle as unknown as JsonValue,
      2,
    )}\n`,
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
