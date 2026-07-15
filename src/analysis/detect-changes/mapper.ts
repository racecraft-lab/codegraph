import * as path from 'path';
import type { Node } from '../../types';
import type {
  ChangedHunk,
  ChangedSymbol,
  DetectChangesGraph,
  UnmappedHunk,
  UnmappedReason,
} from './index';
import type { GitDiffResult } from './git-diff';
import type { ReportWarning } from './report';

const SYMBOL_KINDS = new Set([
  'class',
  'struct',
  'interface',
  'trait',
  'protocol',
  'function',
  'method',
  'property',
  'field',
  'variable',
  'constant',
  'enum',
  'enum_member',
  'type_alias',
  'route',
  'component',
]);

const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.kts', '.scala',
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.cs', '.vb',
  '.php', '.rb', '.swift', '.m', '.mm', '.dart', '.lua', '.luau',
  '.r', '.pas', '.pp', '.cob', '.cbl', '.cfm', '.cfml', '.ml', '.mli',
  '.vue', '.svelte', '.astro',
]);

export interface MappingResult {
  changedSymbols: ChangedSymbol[];
  unmappedHunks: UnmappedHunk[];
  warnings: ReportWarning[];
}

export function mapDiffToSymbols(cg: DetectChangesGraph, diff: GitDiffResult): MappingResult {
  const indexedFiles = new Set(cg.getFiles().map((file) => file.path));
  const bySymbol = new Map<string, ChangedSymbol>();
  const unmappedHunks: UnmappedHunk[] = [];
  const warnings: ReportWarning[] = [];

  for (const hunk of diff.hunks) {
    if (hunk.isPureMove) {
      unmappedHunks.push(toUnmapped(
        hunk,
        'no-symbol-span',
        'Path-only rename or move is reported without mapped symbol impact.',
      ));
      continue;
    }

    const reason = classifyUnmapped(hunk, indexedFiles);
    if (reason) {
      unmappedHunks.push(toUnmapped(hunk, reason));
      warnings.push({ code: reason, message: toUnmapped(hunk, reason).message });
      continue;
    }

    const filePath = mappingPath(hunk, indexedFiles);
    if (!filePath) {
      unmappedHunks.push(toUnmapped(hunk, 'unindexed'));
      continue;
    }

    const nodes = cg.getNodesInFile(filePath).filter(isReportableSymbol);
    const range = hunkRange(hunk);
    const intersecting = nodes.filter((node) => nodeIntersects(node, range));

    if (intersecting.length === 0) {
      const fallback = hunk.changeKind === 'deleted' ? 'deleted-without-span' : 'no-symbol-span';
      unmappedHunks.push(toUnmapped(hunk, fallback));
      continue;
    }

    for (const node of intersecting) {
      const changeType = symbolChangeType(hunk);
      const key = `${node.id}:${changeType}`;
      const existing = bySymbol.get(key);
      if (existing) {
        if (!existing.hunkIds.includes(hunk.id)) existing.hunkIds.push(hunk.id);
        continue;
      }
      bySymbol.set(key, {
        id: '',
        nodeId: node.id,
        name: node.name,
        qualifiedName: node.qualifiedName || node.name,
        kind: node.kind,
        filePath: node.filePath,
        startLine: node.startLine,
        endLine: node.endLine,
        changeType,
        hunkIds: [hunk.id],
      });
    }
  }

  const changedSymbols = [...bySymbol.values()]
    .sort((a, b) =>
      a.filePath.localeCompare(b.filePath)
      || (a.startLine ?? 0) - (b.startLine ?? 0)
      || a.qualifiedName.localeCompare(b.qualifiedName)
      || a.changeType.localeCompare(b.changeType)
    )
    .map((symbol, index) => ({ ...symbol, id: `symbol:${index + 1}`, hunkIds: [...symbol.hunkIds].sort() }));

  return {
    changedSymbols,
    unmappedHunks: unmappedHunks.sort(sortUnmapped),
    warnings: dedupeWarnings(warnings),
  };
}

function classifyUnmapped(hunk: ChangedHunk, indexedFiles: Set<string>): UnmappedReason | null {
  if (hunk.reason === 'binary' || hunk.changeKind === 'binary') return 'binary';
  if (hunk.reason === 'untracked') return 'untracked';
  const filePath = mappingPath(hunk, indexedFiles);
  if (!filePath) return 'unindexed';
  if (isGenerated(filePath)) return 'generated';
  if (!isSupportedPath(filePath)) return 'unsupported';
  if (!indexedFiles.has(filePath)) return hunk.changeKind === 'deleted' ? 'deleted-without-span' : 'unindexed';
  return null;
}

function mappingPath(hunk: ChangedHunk, indexedFiles?: Set<string>): string | null {
  if (hunk.changeKind === 'deleted') return hunk.oldPath;
  if ((hunk.changeKind === 'renamed' || hunk.changeKind === 'moved') && indexedFiles) {
    if (hunk.newPath && indexedFiles.has(hunk.newPath)) return hunk.newPath;
    if (hunk.oldPath && indexedFiles.has(hunk.oldPath)) return hunk.oldPath;
  }
  return hunk.newPath;
}

function hunkRange(hunk: ChangedHunk): { start: number; end: number } {
  const start = hunk.changeKind === 'deleted' ? hunk.oldStart : hunk.newStart;
  const lines = hunk.changeKind === 'deleted' ? hunk.oldLines : hunk.newLines;
  const safeStart = Math.max(1, start ?? 1);
  const safeLines = Math.max(1, lines ?? 1);
  return { start: safeStart, end: safeStart + safeLines - 1 };
}

function nodeIntersects(node: Node, range: { start: number; end: number }): boolean {
  if (!node.startLine || !node.endLine) return false;
  return node.startLine <= range.end && node.endLine >= range.start;
}

function isReportableSymbol(node: Node): boolean {
  return SYMBOL_KINDS.has(node.kind);
}

function symbolChangeType(hunk: ChangedHunk): ChangedSymbol['changeType'] {
  if (hunk.changeKind === 'added') return 'added';
  if (hunk.changeKind === 'deleted') return 'deleted';
  if (hunk.changeKind === 'renamed' || hunk.changeKind === 'moved') return 'renamed_modified';
  return 'modified';
}

function toUnmapped(hunk: ChangedHunk, reason: UnmappedReason, message = messageFor(reason)): UnmappedHunk {
  return {
    hunkId: hunk.id,
    oldPath: hunk.oldPath,
    newPath: hunk.newPath,
    oldStart: hunk.oldStart ?? undefined,
    oldLines: hunk.oldLines ?? undefined,
    newStart: hunk.newStart ?? undefined,
    newLines: hunk.newLines ?? undefined,
    reason,
    message,
  };
}

function messageFor(reason: UnmappedReason): string {
  switch (reason) {
    case 'binary': return 'Binary file change cannot be mapped to indexed symbol spans.';
    case 'generated': return 'Generated or dependency output is intentionally not mapped to symbols.';
    case 'unsupported': return 'File type is not supported by the current extractor set.';
    case 'unindexed': return 'Changed file is not present in the CodeGraph index.';
    case 'untracked': return 'Untracked file is reported as a diagnostic and not mapped to symbols.';
    case 'deleted-without-span': return 'Deleted content has no retained indexed symbol span.';
    case 'no-symbol-span': return 'Textual hunk does not intersect any indexed symbol span.';
  }
}

function isGenerated(filePath: string): boolean {
  return /(^|\/)(dist|build|coverage|node_modules|vendor)\//.test(filePath)
    || /\.generated\./.test(filePath)
    || /(^|\/)generated\//.test(filePath);
}

function isSupportedPath(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function sortUnmapped(a: UnmappedHunk, b: UnmappedHunk): number {
  const aPath = a.newPath ?? a.oldPath ?? '';
  const bPath = b.newPath ?? b.oldPath ?? '';
  return aPath.localeCompare(bPath)
    || (a.newStart ?? a.oldStart ?? 0) - (b.newStart ?? b.oldStart ?? 0)
    || a.reason.localeCompare(b.reason);
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
