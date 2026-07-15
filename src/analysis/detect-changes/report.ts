import {
  type ChangedSymbol,
  type DiffRequest,
  type ImpactReport,
  type RiskAnnotation,
  type UnmappedHunk,
} from './index';

export const SCHEMA_VERSION = 1;
export const EXIT_CODES = {
  clean: 0,
  impact: 1,
  thresholdBreach: 2,
  unavailable: 3,
} as const;
export const DEFAULT_CALLER_DEPTH = 1;
export const MIN_CALLER_DEPTH = 1;
export const MAX_CALLER_DEPTH = 3;
export const DEFAULT_MAX_CALLERS = 20;
export const MIN_MAX_CALLERS = 1;
export const MAX_MAX_CALLERS = 100;
export const HUB_CALLER_THRESHOLD = 20;
export const MAX_FLOWS = 20;

export interface ReportWarning {
  code: string;
  message: string;
}

export interface FailOnPolicy {
  raw: string;
  kind: 'hub' | 'callers';
  threshold?: number;
}

export function normalizeDetectChangesRequest(request: DiffRequest): Required<Omit<DiffRequest, 'projectPath'>> & { projectPath?: string } {
  const mode = request.mode ?? 'all';
  if (!['unstaged', 'staged', 'all', 'base-ref'].includes(mode)) {
    throw new Error(`Invalid detect-changes mode: ${String(mode)}`);
  }
  const format = request.format ?? 'json';
  if (!['json', 'markdown'].includes(format)) {
    throw new Error(`Invalid detect-changes format: ${String(format)}`);
  }
  return {
    mode,
    baseRef: request.baseRef ?? null,
    format,
    failOn: request.failOn ?? null,
    callerDepth: clampInt(request.callerDepth, DEFAULT_CALLER_DEPTH, MIN_CALLER_DEPTH, MAX_CALLER_DEPTH),
    maxCallers: clampInt(request.maxCallers, DEFAULT_MAX_CALLERS, MIN_MAX_CALLERS, MAX_MAX_CALLERS),
    projectPath: request.projectPath,
  };
}

export function buildInitialReport(
  request: ReturnType<typeof normalizeDetectChangesRequest>,
  changedSymbols: ChangedSymbol[],
  unmappedHunks: UnmappedHunk[],
  warnings: ReportWarning[],
): ImpactReport {
  return {
    schemaVersion: SCHEMA_VERSION,
    summary: {
      mode: request.mode,
      baseRef: request.baseRef,
      status: 'clean',
      changedSymbolCount: 0,
      unmappedHunkCount: 0,
      callerCount: 0,
      affectedFlowCount: 0,
      riskCount: 0,
      warningCount: 0,
    },
    changedSymbols,
    unmappedHunks,
    callers: [],
    affectedFlows: {
      state: 'empty',
      items: [],
      sourceVersion: 0,
      truncated: false,
    },
    risks: [],
    warnings,
    limits: {
      callerDepth: request.callerDepth,
      maxCallers: request.maxCallers,
      hubCallerThreshold: HUB_CALLER_THRESHOLD,
      maxFlows: MAX_FLOWS,
      truncatedCallers: false,
      truncatedFlows: false,
    },
    exitCode: 0,
  };
}

export function parseFailOn(raw: string | null | undefined): FailOnPolicy[] {
  if (!raw) return [];
  const policies: FailOnPolicy[] = [];
  for (const token of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
    if (token === 'hub') {
      policies.push({ raw: token, kind: 'hub' });
      continue;
    }
    const callers = /^callers>(\d+)$/.exec(token);
    if (callers) {
      policies.push({ raw: token, kind: 'callers', threshold: Number(callers[1]) });
      continue;
    }
    throw new Error(`Invalid failOn policy: ${token}`);
  }
  return policies;
}

export function applyFailOnPolicies(report: ImpactReport, failOn: string | null): void {
  const policies = parseFailOn(failOn);
  if (policies.length === 0) return;

  const callerCounts = new Map<string, number>();
  for (const caller of report.callers) {
    callerCounts.set(caller.changedSymbolId, (callerCounts.get(caller.changedSymbolId) ?? 0) + 1);
  }

  for (const policy of policies) {
    if (policy.kind === 'hub') {
      for (const risk of report.risks) {
        if (risk.code !== 'hub') continue;
        report.risks.push(thresholdRisk(risk.targetId, policy.raw, `Hub threshold breached for ${risk.targetId}.`));
      }
      continue;
    }

    for (const [symbolId, count] of callerCounts) {
      if (count > (policy.threshold ?? 0)) {
        report.risks.push(thresholdRisk(
          symbolId,
          policy.raw,
          `Changed symbol ${symbolId} has ${count} impacted callers, above failOn policy ${policy.raw}.`,
        ));
      }
    }
  }
}

export function finalizeReport(report: ImpactReport): ImpactReport {
  report.risks = dedupeRisks(report.risks);
  report.warnings = dedupeWarnings(report.warnings);
  report.summary.changedSymbolCount = report.changedSymbols.length;
  report.summary.unmappedHunkCount = report.unmappedHunks.length;
  report.summary.callerCount = report.callers.length;
  report.summary.affectedFlowCount = report.affectedFlows.items.length;
  report.summary.riskCount = report.risks.length;
  report.summary.warningCount = report.warnings.length;

  if (report.summary.status !== 'unavailable') {
    const threshold = report.risks.some((risk) => risk.code === 'threshold-breach');
    if (threshold) report.summary.status = 'threshold_breach';
    else if (report.changedSymbols.length > 0 || report.unmappedHunks.length > 0) report.summary.status = 'impact';
    else report.summary.status = 'clean';
  }

  report.exitCode = exitCodeFor(report);
  return report;
}

export function renderJsonReport(report: ImpactReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderMarkdownReport(report: ImpactReport): string {
  return [
    '# Change Impact Report',
    '',
    '## Summary',
    table(['Field', 'Value'], [
      ['Mode', report.summary.mode],
      ['Base Ref', report.summary.baseRef ?? ''],
      ['Status', report.summary.status],
      ['Changed Symbols', String(report.summary.changedSymbolCount)],
      ['Unmapped Hunks', String(report.summary.unmappedHunkCount)],
      ['Impacted Callers', String(report.summary.callerCount)],
      ['Affected Flows', String(report.summary.affectedFlowCount)],
      ['Risks', String(report.summary.riskCount)],
      ['Warnings', String(report.summary.warningCount)],
      ['Exit Code', String(report.exitCode)],
    ]),
    '',
    '## Warnings',
    tableOrEmpty(['Code', 'Message'], report.warnings.map((w) => [w.code, w.message])),
    '',
    '## Changed Symbols',
    tableOrEmpty(['Symbol', 'Kind', 'Change', 'File', 'Lines', 'Hunks'], report.changedSymbols.map((s) => [
      s.qualifiedName,
      s.kind,
      s.changeType,
      s.filePath,
      lineRange(s.startLine, s.endLine),
      s.hunkIds.join(', '),
    ])),
    '',
    '## Unmapped Hunks',
    tableOrEmpty(['Path', 'Range', 'Reason', 'Message'], report.unmappedHunks.map((h) => [
      h.newPath ?? h.oldPath ?? '',
      hunkRange(h),
      h.reason,
      h.message,
    ])),
    '',
    '## Impacted Callers',
    tableOrEmpty(['Changed Symbol', 'Caller', 'Kind', 'File', 'Line', 'Depth'], report.callers.map((c) => [
      c.changedSymbolId,
      c.qualifiedName,
      c.kind,
      c.filePath,
      c.startLine ? String(c.startLine) : '',
      String(c.depth),
    ])),
    '',
    '## Affected Flows',
    tableOrEmpty(['State', 'Flow', 'Entry Kind', 'Matched Symbols', 'Step Count', 'Truncated'], report.affectedFlows.items.map((f) => [
      report.affectedFlows.state,
      f.name,
      f.entryKind,
      f.matchedNodeIds.join(', '),
      String(f.stepCount),
      String(f.truncated),
    ]), report.affectedFlows.items.length === 0 ? [[report.affectedFlows.state, '', '', '', '', String(report.affectedFlows.truncated)]] : undefined),
    '',
    '## Risks',
    tableOrEmpty(['Severity', 'Code', 'Target', 'Policy', 'Message'], report.risks.map((r) => [
      r.severity,
      r.code,
      r.targetId,
      r.policy ?? '',
      r.message,
    ])),
  ].join('\n');
}

function thresholdRisk(targetId: string, policy: string, message: string): RiskAnnotation {
  return {
    code: 'threshold-breach',
    severity: 'error',
    targetId,
    message,
    policy,
  };
}

function exitCodeFor(report: ImpactReport): ImpactReport['exitCode'] {
  if (report.summary.status === 'unavailable') return EXIT_CODES.unavailable;
  if (report.summary.status === 'threshold_breach') return EXIT_CODES.thresholdBreach;
  if (report.summary.status === 'impact') return EXIT_CODES.impact;
  return EXIT_CODES.clean;
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function tableOrEmpty(headers: string[], rows: string[][], fallback?: string[][]): string {
  return table(headers, rows.length > 0 ? rows : fallback ?? [['', ...headers.slice(1).map(() => '')]]);
}

function table(headers: string[], rows: string[][]): string {
  const header = `| ${headers.map(escapeCell).join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

function escapeCell(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function lineRange(start?: number, end?: number): string {
  if (!start && !end) return '';
  if (start === end || !end) return String(start);
  return `${start}-${end}`;
}

function hunkRange(hunk: UnmappedHunk): string {
  const start = hunk.newStart ?? hunk.oldStart;
  const lines = hunk.newLines ?? hunk.oldLines;
  if (!start) return '';
  return lines && lines > 1 ? `${start}+${lines}` : String(start);
}

function dedupeRisks(risks: RiskAnnotation[]): RiskAnnotation[] {
  const seen = new Set<string>();
  const result: RiskAnnotation[] = [];
  for (const risk of risks) {
    const key = `${risk.code}:${risk.targetId}:${risk.policy ?? ''}:${risk.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(risk);
  }
  return result.sort((a, b) =>
    severityRank(b.severity) - severityRank(a.severity)
    || a.code.localeCompare(b.code)
    || a.targetId.localeCompare(b.targetId)
    || a.message.localeCompare(b.message)
  );
}

function dedupeWarnings(warnings: ReportWarning[]): ReportWarning[] {
  const seen = new Set<string>();
  const result: ReportWarning[] = [];
  for (const warning of warnings) {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(warning);
  }
  return result.sort((a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}

function severityRank(severity: RiskAnnotation['severity']): number {
  if (severity === 'error') return 3;
  if (severity === 'warning') return 2;
  return 1;
}
