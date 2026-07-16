import { execFileSync } from 'child_process';
import type { ChangedHunk, DiffRequest, UnmappedReason } from './index';

export interface GitFileChange {
  status: string;
  oldPath: string | null;
  newPath: string | null;
  changeKind: ChangedHunk['changeKind'];
}

export interface GitDiffResult {
  mode: DiffRequest['mode'];
  baseRef: string | null;
  mergeBase: string | null;
  files: GitFileChange[];
  hunks: ChangedHunk[];
}

export class GitDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitDiffError';
  }
}

export function acquireGitDiff(projectRoot: string, request: DiffRequest): GitDiffResult {
  const { mode } = request;
  const baseRef = request.baseRef ?? null;
  const headRef = request.headRef ?? 'HEAD';
  if (mode === 'base-ref' && !baseRef) {
    throw new GitDiffError('--base-ref is required when --mode base-ref');
  }
  if (mode !== 'base-ref' && baseRef) {
    throw new GitDiffError('--base-ref can only be used with --mode base-ref');
  }

  const mergeBase = mode === 'base-ref'
    ? runGit(projectRoot, ['merge-base', baseRef!, headRef]).trim()
    : null;

  const diffArgs = argsForMode(mode, mergeBase, headRef);
  const statusOutput = runGit(projectRoot, ['diff', '--name-status', '-z', '-M', ...diffArgs]);
  const patchOutput = runGit(projectRoot, ['diff', '--no-ext-diff', '--no-color', '-M', '--unified=0', ...diffArgs]);
  const files = parseNameStatus(statusOutput);
  const hunks = parseUnifiedDiff(patchOutput);

  const fileKey = (file: GitFileChange) => `${file.oldPath ?? ''}\0${file.newPath ?? ''}`;
  const hunksByFile = new Set(hunks.map((hunk) => `${hunk.oldPath ?? ''}\0${hunk.newPath ?? ''}`));
  for (const file of files) {
    if (hunksByFile.has(fileKey(file))) continue;
    hunks.push(fileLevelHunkForChange(file));
  }

  if (mode === 'all') {
    const untracked = runGit(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
    for (const filePath of splitNul(untracked)) {
      if (filePath.startsWith('.codegraph/')) continue;
      hunks.push({
        id: '',
        oldPath: null,
        newPath: filePath,
        oldStart: null,
        oldLines: null,
        newStart: null,
        newLines: null,
        changeKind: 'unknown',
        isPureMove: false,
        reason: 'untracked',
      });
    }
  }

  return {
    mode,
    baseRef,
    mergeBase,
    files,
    hunks: assignHunkIds(hunks),
  };
}

function argsForMode(mode: DiffRequest['mode'], mergeBase: string | null, headRef: string): string[] {
  switch (mode) {
    case 'unstaged': return ['--'];
    case 'staged': return ['--cached', '--'];
    case 'all': return ['HEAD', '--'];
    case 'base-ref': return [mergeBase!, headRef, '--'];
  }
}

function runGit(projectRoot: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = typeof (error as { stderr?: unknown }).stderr === 'string'
      ? (error as { stderr: string }).stderr.trim()
      : '';
    throw new GitDiffError(stderr || `git ${args.join(' ')} failed`);
  }
}

function parseNameStatus(output: string): GitFileChange[] {
  const parts = splitNul(output);
  const files: GitFileChange[] = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i++]!;
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = parts[i++] ?? null;
      const newPath = parts[i++] ?? oldPath;
      files.push({ status, oldPath, newPath, changeKind: 'renamed' });
      continue;
    }
    const filePath = parts[i++] ?? null;
    files.push({
      status,
      oldPath: status.startsWith('A') ? null : filePath,
      newPath: status.startsWith('D') ? null : filePath,
      changeKind: changeKindFromStatus(status),
    });
  }
  return files;
}

function parseUnifiedDiff(output: string): ChangedHunk[] {
  const hunks: ChangedHunk[] = [];
  let current: {
    oldPath: string | null;
    newPath: string | null;
    changeKind: ChangedHunk['changeKind'];
    binary: boolean;
  } | null = null;

  for (const line of output.split(/\r?\n/)) {
    const diffMatch = parseGitDiffHeader(line);
    if (diffMatch) {
      current = {
        oldPath: diffMatch.oldPath,
        newPath: diffMatch.newPath,
        changeKind: 'modified',
        binary: false,
      };
      continue;
    }
    if (!current) continue;

    if (line.startsWith('new file mode ')) {
      current.changeKind = 'added';
      current.oldPath = null;
      continue;
    }
    if (line.startsWith('deleted file mode ')) {
      current.changeKind = 'deleted';
      current.newPath = null;
      continue;
    }
    if (line.startsWith('rename from ')) {
      current.oldPath = unquotePath(line.slice('rename from '.length));
      current.changeKind = 'renamed';
      continue;
    }
    if (line.startsWith('rename to ')) {
      current.newPath = unquotePath(line.slice('rename to '.length));
      current.changeKind = 'renamed';
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current.binary = true;
      hunks.push(fileLevelHunk(current, 'binary'));
      continue;
    }

    const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunkMatch) continue;
    hunks.push({
      id: '',
      oldPath: current.oldPath,
      newPath: current.newPath,
      oldStart: Number(hunkMatch[1]),
      oldLines: hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]),
      newStart: Number(hunkMatch[3]),
      newLines: hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]),
      changeKind: current.binary ? 'binary' : current.changeKind,
      isPureMove: false,
      reason: current.binary ? 'binary' : undefined,
    });
  }

  return hunks;
}

function fileLevelHunkForChange(file: GitFileChange): ChangedHunk {
  return {
    id: '',
    oldPath: file.oldPath,
    newPath: file.newPath,
    oldStart: null,
    oldLines: null,
    newStart: null,
    newLines: null,
    changeKind: file.changeKind,
    isPureMove: file.status.startsWith('R') || file.status.startsWith('C'),
  };
}

function fileLevelHunk(
  current: { oldPath: string | null; newPath: string | null; changeKind: ChangedHunk['changeKind'] },
  reason?: UnmappedReason,
): ChangedHunk {
  return {
    id: '',
    oldPath: current.oldPath,
    newPath: current.newPath,
    oldStart: null,
    oldLines: null,
    newStart: null,
    newLines: null,
    changeKind: reason === 'binary' ? 'binary' : current.changeKind,
    isPureMove: false,
    reason,
  };
}

function assignHunkIds(hunks: ChangedHunk[]): ChangedHunk[] {
  return hunks.map((hunk, index) => ({ ...hunk, id: `hunk:${index + 1}` }));
}

function parseGitDiffHeader(line: string): { oldPath: string; newPath: string } | null {
  const unquoted = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  if (unquoted) {
    return {
      oldPath: unquotePath(unquoted[1]!),
      newPath: unquotePath(unquoted[2]!),
    };
  }

  if (!line.startsWith('diff --git ')) return null;
  const tokens = splitGitHeaderTokens(line.slice('diff --git '.length));
  if (tokens.length !== 2) return null;
  const oldPath = stripDiffPathPrefix(unquotePath(tokens[0]!), 'a/');
  const newPath = stripDiffPathPrefix(unquotePath(tokens[1]!), 'b/');
  if (oldPath === null || newPath === null) return null;
  return { oldPath, newPath };
}

function splitGitHeaderTokens(raw: string): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < raw.length;) {
    while (raw[i] === ' ') i += 1;
    if (i >= raw.length) break;
    if (raw[i] === '"') {
      const start = i;
      i += 1;
      let escaped = false;
      while (i < raw.length) {
        const char = raw[i]!;
        i += 1;
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') break;
      }
      tokens.push(raw.slice(start, i));
      continue;
    }
    const start = i;
    while (i < raw.length && raw[i] !== ' ') i += 1;
    tokens.push(raw.slice(start, i));
  }
  return tokens;
}

function stripDiffPathPrefix(path: string, prefix: 'a/' | 'b/'): string | null {
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

function splitNul(output: string): string[] {
  return output.split('\0').filter(Boolean);
}

function changeKindFromStatus(status: string): ChangedHunk['changeKind'] {
  if (status.startsWith('A')) return 'added';
  if (status.startsWith('D')) return 'deleted';
  if (status.startsWith('R')) return 'renamed';
  if (status.startsWith('M')) return 'modified';
  return 'unknown';
}

function unquotePath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const bytes: number[] = [];
  const body = raw.slice(1, -1);
  for (let i = 0; i < body.length;) {
    const char = body[i]!;
    if (char !== '\\') {
      bytes.push(...Buffer.from(char));
      i += 1;
      continue;
    }

    const next = body[i + 1];
    if (next === undefined) {
      bytes.push('\\'.charCodeAt(0));
      i += 1;
      continue;
    }

    if (/[0-7]/.test(next)) {
      let octal = next;
      let consumed = 1;
      while (consumed < 3 && /[0-7]/.test(body[i + 1 + consumed] ?? '')) {
        octal += body[i + 1 + consumed];
        consumed += 1;
      }
      bytes.push(Number.parseInt(octal, 8));
      i += 1 + consumed;
      continue;
    }

    const escapedByte = gitQuotedEscapeByte(next);
    if (escapedByte !== null) {
      bytes.push(escapedByte);
    } else {
      bytes.push(...Buffer.from(next));
    }
    i += 2;
  }
  return Buffer.from(bytes).toString('utf8');
}

function gitQuotedEscapeByte(char: string): number | null {
  switch (char) {
    case 'a': return 0x07;
    case 'b': return 0x08;
    case 't': return 0x09;
    case 'n': return 0x0a;
    case 'v': return 0x0b;
    case 'f': return 0x0c;
    case 'r': return 0x0d;
    case '"': return '"'.charCodeAt(0);
    case '\\': return '\\'.charCodeAt(0);
    default: return null;
  }
}
