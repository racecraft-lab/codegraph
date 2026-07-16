import * as fs from 'fs';
import * as path from 'path';
import type { Edge, FileRecord, Node } from '../../types';
import { acquireGitDiff, type GitDiffResult } from './git-diff';
import { mapDiffToSymbols } from './mapper';
import { enrichImpact } from './impact';
import {
  buildInitialReport,
  finalizeReport,
  normalizeDetectChangesRequest,
  type ReportWarning,
} from './report';

export const DIFF_MODES = ['unstaged', 'staged', 'all', 'base-ref'] as const;
export type DiffMode = typeof DIFF_MODES[number];

export const REPORT_FORMATS = ['json', 'markdown'] as const;
export type ReportFormat = typeof REPORT_FORMATS[number];

export const UNMAPPED_REASONS = [
  'no-symbol-span',
  'binary',
  'generated',
  'unsupported',
  'unindexed',
  'untracked',
  'deleted-without-span',
] as const;
export type UnmappedReason = typeof UNMAPPED_REASONS[number];

export const SUMMARY_STATUSES = ['clean', 'impact', 'threshold_breach', 'unavailable'] as const;
export type SummaryStatus = typeof SUMMARY_STATUSES[number];

export {
  DEFAULT_CALLER_DEPTH,
  DEFAULT_MAX_CALLERS,
  EXIT_CODES,
  HUB_CALLER_THRESHOLD,
  MAX_CALLER_DEPTH,
  MAX_FLOWS,
  MAX_MAX_CALLERS,
  MIN_CALLER_DEPTH,
  MIN_MAX_CALLERS,
  SCHEMA_VERSION,
} from './report';

export interface DiffRequest {
  mode: DiffMode;
  baseRef?: string | null;
  format?: ReportFormat;
  failOn?: string | null;
  callerDepth?: number;
  maxCallers?: number;
  projectPath?: string;
}

export interface DetectChangesOptions {
  baseGraph?: DetectChangesGraph | null;
}

export interface ChangedHunk {
  id: string;
  oldPath: string | null;
  newPath: string | null;
  oldStart: number | null;
  oldLines: number | null;
  newStart: number | null;
  newLines: number | null;
  changeKind: 'added' | 'modified' | 'deleted' | 'renamed' | 'moved' | 'binary' | 'unknown';
  isPureMove: boolean;
  reason?: UnmappedReason;
}

export interface ChangedSymbol {
  id: string;
  nodeId: string;
  name: string;
  qualifiedName: string;
  kind: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed_modified';
  hunkIds: string[];
}

export interface UnmappedHunk {
  hunkId: string;
  oldPath: string | null;
  newPath: string | null;
  oldStart?: number;
  oldLines?: number;
  newStart?: number;
  newLines?: number;
  reason: UnmappedReason;
  message: string;
}

export interface CallerImpact {
  changedSymbolId: string;
  callerNodeId: string;
  name: string;
  qualifiedName: string;
  kind: string;
  filePath: string;
  startLine?: number;
  depth: number;
  edgeKind: Edge['kind'];
}

export interface AffectedFlowItem {
  flowId: string;
  name: string;
  entryKind: string;
  matchedNodeIds: string[];
  stepCount: number;
  truncated: boolean;
}

export interface AffectedFlows {
  state: 'disabled' | 'unavailable' | 'not_indexed' | 'stale' | 'empty' | 'available';
  items: AffectedFlowItem[];
  sourceVersion: number;
  truncated: boolean;
}

export interface RiskAnnotation {
  code: 'high-callers' | 'hub' | 'truncated-callers' | 'stale-index' | 'flow-unavailable' | 'threshold-breach';
  severity: 'info' | 'warning' | 'error';
  targetId: string;
  message: string;
  policy?: string;
}

export interface Limits {
  callerDepth: number;
  maxCallers: number;
  hubCallerThreshold: number;
  maxFlows: number;
  truncatedCallers: boolean;
  truncatedFlows: boolean;
}

export interface ImpactReport {
  schemaVersion: 1;
  summary: {
    mode: DiffMode;
    baseRef: string | null;
    status: SummaryStatus;
    changedSymbolCount: number;
    unmappedHunkCount: number;
    callerCount: number;
    affectedFlowCount: number;
    riskCount: number;
    warningCount: number;
  };
  changedSymbols: ChangedSymbol[];
  unmappedHunks: UnmappedHunk[];
  callers: CallerImpact[];
  affectedFlows: AffectedFlows;
  risks: RiskAnnotation[];
  warnings: ReportWarning[];
  limits: Limits;
  exitCode: 0 | 1 | 2 | 3;
}

export interface DetectChangesGraph {
  getProjectRoot(): string;
  getFiles(): FileRecord[];
  getNodesInFile(filePath: string): Node[];
  getCallers(nodeId: string, maxDepth?: number): Array<{ node: Node; edge: Edge }>;
  listFlows?(limit: number, offset: number): {
    items: Array<{ id: string; name: string; entryKind: string; stepCount: number; truncated: boolean }>;
    total: number;
    limit: number;
    offset: number;
    sourceVersion: number;
    state: AffectedFlows['state'];
  };
  getFlowById?(id: string): unknown;
}

export interface DetectChangesResult {
  diff: GitDiffResult;
  report: ImpactReport;
}

export async function detectChanges(
  cg: DetectChangesGraph,
  request: DiffRequest,
  options: DetectChangesOptions = {},
): Promise<ImpactReport> {
  const normalized = normalizeDetectChangesRequest(request);
  const projectRoot = request.projectPath ? path.resolve(request.projectPath) : cg.getProjectRoot();
  const diff = acquireGitDiff(projectRoot, normalized);
  const mapping = mapDiffToSymbols(cg, diff, options.baseGraph ?? null);
  const warnings = [...mapping.warnings, ...staleIndexWarnings(cg, projectRoot, diff)];
  const report = buildInitialReport(normalized, mapping.changedSymbols, mapping.unmappedHunks, warnings);
  enrichImpact(cg, report, normalized.failOn ?? null, options.baseGraph ?? null);
  return finalizeReport(report);
}

export function createUnavailableReport(
  request: DiffRequest,
  message: string,
  code = 'unavailable',
): ImpactReport {
  const normalized = normalizeDetectChangesRequest(request);
  const report = buildInitialReport(normalized, [], [], [{ code, message }]);
  report.summary.status = 'unavailable';
  report.risks.push({
    code: 'flow-unavailable',
    severity: 'error',
    targetId: 'report',
    message,
  });
  return finalizeReport(report);
}

function staleIndexWarnings(
  cg: DetectChangesGraph,
  projectRoot: string,
  diff: GitDiffResult,
): ReportWarning[] {
  const files = new Map(cg.getFiles().map((file) => [file.path, file]));
  const changedPaths = new Set<string>();
  for (const hunk of diff.hunks) {
    const rel = hunk.changeKind === 'deleted' ? hunk.oldPath : hunk.newPath;
    if (rel) changedPaths.add(rel);
  }

  const warnings: ReportWarning[] = [];
  for (const rel of [...changedPaths].sort()) {
    const record = files.get(rel);
    if (!record) continue;
    const abs = path.join(projectRoot, rel);
    if (!fs.existsSync(abs)) continue;
    const currentMtime = fs.statSync(abs).mtimeMs;
    if (Math.round(currentMtime) > Math.round(record.modifiedAt)) {
      warnings.push({
        code: 'stale-index',
        message: `Indexed metadata for ${rel} is older than the working tree file; run codegraph sync for freshest spans.`,
      });
    }
  }
  return warnings;
}
