/**
 * SPEC-010 Graph-Aware Rename — Slice-2 apply-path unit tests.
 *
 * T028: the two FR-018 post-check QueryBuilder statements the apply path runs,
 * after its resolution-complete re-sync of the touched files, to assert the
 * rename left no dangling reference to the old name. FR-018's post-check is a
 * touched-files-scoped DUAL assertion (never repo-wide):
 *   (a) getUnresolvedRefsByNameInFiles(name, files) — no unresolved reference in
 *       the touched files still carries the old name.
 *   (b) getNodesByNameInFiles(name, files)          — no node named the old name
 *       remains in the touched files.
 *
 * Real files + real SQLite through the full CodeGraph pipeline (no DB mocking,
 * per the constitution; mirrors the T006 harness — initSync → indexAll). The
 * fixture manufactures the post-check's exact inputs directly, without running a
 * rename: a genuinely unresolved reference (a call to an undefined function,
 * which the resolution pass parks as status='failed') and a plain declaration
 * node, each DUPLICATED across an in-scope ("touched") file and an out-of-scope
 * file so scoping is proven in both directions.
 *
 * Status-agnostic (a) is the load-bearing distinction from the pre-existing
 * getUnresolvedReferencesByFiles: a real dangling reference is status='failed'
 * after the resolution-complete re-sync FR-018 mandates, so the post-check probe
 * must NOT inherit that statement's status='pending' filter — which would miss
 * every genuine dangling reference the post-check exists to catch.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { CodeGraph } from '../src';
import type { QueryBuilder } from '../src/db/queries';
import { checkPlanJail } from '../src/refactor/jail';
import type { Refusal, RenameEdit, ApplyResult } from '../src/refactor/types';
import {
  takeSnapshots,
  reverifySpans,
  writeEdits,
  restoreSnapshots,
  RENAME_TEMP_SUFFIX,
} from '../src/refactor/snapshot';
import type { WriteEditsResult, RestoreResult } from '../src/refactor/snapshot';
import { isSourceFile } from '../src/extraction/grammars';
import { discriminateSyncResult, runPostCheck } from '../src/refactor/post-check';
import { formatApplyResultTable } from '../src/refactor/plan-format';
import { applyRename } from '../src/refactor/apply-engine';
import { renameApplyExitCode } from '../src/refactor/types';
import { resolveLspConfig } from '../src/lsp';
import type { SyncResult } from '../src';

// D5 review remediation (Rung 3b, BLOCKER): `fs`'s ESM module namespace is not
// configurable (`vi.spyOn(fs, 'readFileSync')` throws "Cannot redefine
// property"), so — mirroring the established embeddings-model-fetch.test.ts
// workaround — `readFileSync` is wrapped via `importOriginal`: every OTHER fs
// function, and `readFileSync`'s DEFAULT behavior, are the untouched real
// implementation; only the one Rung-3b test below installs a temporary custom
// implementation (reset back to a plain passthrough in its own `finally`).
// `renameSync` is wrapped the SAME way (Copilot review finding, Rung 4): the
// orphaned-temp-sibling-cleanup test forces ONLY renameSync to throw while
// writeFileSync stays real, so a genuine temp sibling lands on disk first.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync), renameSync: vi.fn(actual.renameSync) };
});

const OLD_NAME_REF = 'ghostRef'; //   name of the unresolved (dangling) reference
const OLD_NAME_NODE = 'keepDecl'; //  name of the leftover declaration node

describe('T028 Slice-2 QueryBuilder post-check statements (real SQLite)', () => {
  let dir: string;
  let cg: CodeGraph;
  let queries: QueryBuilder;
  let hitPath: string; //  the in-scope ("touched") file's stored path
  let missPath: string; // the out-of-scope file's stored path

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-rename-slice2-'));
    // Two independent modules (neither imports the other), each carrying BOTH a
    // plain declaration named OLD_NAME_NODE and a call to the never-defined
    // OLD_NAME_REF — so the same old name appears as a leftover NODE and as a
    // dangling REFERENCE in each of an in-scope and an out-of-scope file.
    fs.writeFileSync(
      path.join(dir, 'scope_hit.ts'),
      [
        `function ${OLD_NAME_NODE}(): void {}`,
        `function hitCaller(): void { ${OLD_NAME_REF}(1); }`,
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(dir, 'scope_miss.ts'),
      [
        `function ${OLD_NAME_NODE}(): void {}`,
        `function missCaller(): void { ${OLD_NAME_REF}(2); }`,
      ].join('\n'),
    );

    cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    queries = (cg as unknown as { queries: QueryBuilder }).queries;

    // Derive the stored path strings from the graph itself (they are relative to
    // the project root — 'scope_hit.ts' / 'scope_miss.ts'), so the assertions
    // never depend on the on-disk path format.
    const keepNodes = queries.getNodesByName(OLD_NAME_NODE);
    hitPath = keepNodes.find((n) => n.filePath.endsWith('scope_hit.ts'))!.filePath;
    missPath = keepNodes.find((n) => n.filePath.endsWith('scope_miss.ts'))!.filePath;
  });

  afterAll(() => {
    cg?.destroy();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fixture: the pipeline produced the old name as a dangling reference AND a leftover node in BOTH files (post-check inputs are real)', () => {
    // Unresolved reference in each file (status-agnostic name lookup finds them).
    expect(
      queries.getUnresolvedByName(OLD_NAME_REF).map((r) => r.filePath).sort(),
    ).toEqual([hitPath, missPath].sort());
    // Declaration node named the old name in each file.
    expect(
      queries.getNodesByName(OLD_NAME_NODE).map((n) => n.filePath).sort(),
    ).toEqual([hitPath, missPath].sort());
  });

  // ── (a) getUnresolvedRefsByNameInFiles ────────────────────────────────────
  it('getUnresolvedRefsByNameInFiles: returns the touched-file dangling reference to the old name', () => {
    const rows = queries.getUnresolvedRefsByNameInFiles(OLD_NAME_REF, [hitPath]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.referenceName).toBe(OLD_NAME_REF);
    expect(rows[0]!.filePath).toBe(hitPath);
  });

  it('getUnresolvedRefsByNameInFiles: status-agnostic — catches the failed dangling ref that the pending-only getUnresolvedReferencesByFiles misses (FR-018)', () => {
    // The dangling reference is status='failed' after the resolution-complete
    // re-sync, so the pre-existing pending-only file probe does NOT surface it…
    expect(
      queries.getUnresolvedReferencesByFiles([hitPath]).some((r) => r.referenceName === OLD_NAME_REF),
    ).toBe(false);
    // …but the post-check probe, which ignores status, does.
    expect(queries.getUnresolvedRefsByNameInFiles(OLD_NAME_REF, [hitPath])).toHaveLength(1);
  });

  it('getUnresolvedRefsByNameInFiles: scopes to the touched-file set — a same-named ref in an out-of-scope file is excluded', () => {
    const rows = queries.getUnresolvedRefsByNameInFiles(OLD_NAME_REF, [hitPath]);
    expect(rows.every((r) => r.filePath === hitPath)).toBe(true);
    expect(rows.some((r) => r.filePath === missPath)).toBe(false);
    // The exclusion is a file-scope filter, not a name miss: the same call finds
    // the identically-named ref when THAT file is the one in scope.
    const missRows = queries.getUnresolvedRefsByNameInFiles(OLD_NAME_REF, [missPath]);
    expect(missRows).toHaveLength(1);
    expect(missRows[0]!.filePath).toBe(missPath);
  });

  it('getUnresolvedRefsByNameInFiles: empty file set → [] (a post-check over zero touched files asserts nothing)', () => {
    expect(queries.getUnresolvedRefsByNameInFiles(OLD_NAME_REF, [])).toEqual([]);
  });

  // ── (b) getNodesByNameInFiles ─────────────────────────────────────────────
  it('getNodesByNameInFiles: returns the touched-file node still named the old name', () => {
    const rows = queries.getNodesByNameInFiles(OLD_NAME_NODE, [hitPath]);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((n) => n.name === OLD_NAME_NODE)).toBe(true);
    expect(rows.every((n) => n.filePath === hitPath)).toBe(true);
    expect(rows.some((n) => n.kind === 'function')).toBe(true);
  });

  it('getNodesByNameInFiles: scopes to the touched-file set — a same-named node in an out-of-scope file is excluded', () => {
    // Unscoped, the out-of-scope file's node IS present…
    expect(queries.getNodesByName(OLD_NAME_NODE).some((n) => n.filePath === missPath)).toBe(true);
    // …scoped to the touched file, it is gone; the same call finds it when THAT
    // file is the one in scope (a file-scope filter, not a name miss).
    expect(queries.getNodesByNameInFiles(OLD_NAME_NODE, [hitPath]).some((n) => n.filePath === missPath)).toBe(false);
    const missRows = queries.getNodesByNameInFiles(OLD_NAME_NODE, [missPath]);
    expect(missRows.length).toBeGreaterThanOrEqual(1);
    expect(missRows.every((n) => n.filePath === missPath)).toBe(true);
  });

  it('getNodesByNameInFiles: empty file set → []', () => {
    expect(queries.getNodesByNameInFiles(OLD_NAME_NODE, [])).toEqual([]);
  });
});

/**
 * T030 Rung 2 — the FR-017 per-edit jail + index-scope guard (`checkPlanJail`).
 *
 * A pure-over-paths, whole-plan pre-write gate: an edit whose symlink-resolved
 * path escapes the workspace root refuses `out-of-root`; an in-root edit to a
 * file the shared indexer/watcher scope matcher ignores (gitignored /
 * `codegraph.json`-excluded) refuses `scope-ignored`; both name the offending
 * file(s). It reuses `validatePathWithinRoot` (realpath-both-sides containment)
 * and `buildScopeIgnore`/`ScopeIgnore` (research Decision 5) — never a raw
 * `.gitignore` reparse.
 *
 * Refuse-before-read (FR-017): the check decides on the path alone and never
 * reads an edited file's content — proven here by refusing a NONEXISTENT
 * out-of-root path (a content read would have thrown ENOENT instead of
 * returning a clean refusal). Both refusals are success-shaped — a returned
 * `Refusal` object, deliberately NOT the isError `PathRefusalError` (FR-023);
 * exit-code / isError shaping is the caller's job, so this seam only returns the
 * object. Real filesystem fixtures (temp roots, real `.gitignore` /
 * `codegraph.json`, real symlinks) — no mocking, per the constitution.
 */
describe('T030 Rung 2 — jail/scope (FR-017): checkPlanJail (real fs)', () => {
  let root: string;
  const externals: string[] = [];

  const makeExternalDir = (): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-rename-jail-ext-'));
    externals.push(d);
    return d;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-rename-jail-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    while (externals.length) fs.rmSync(externals.pop()!, { recursive: true, force: true });
  });

  // ── out-of-root (FR-017 jail) ─────────────────────────────────────────────
  it('out-of-root: a `../` escape path refuses the whole plan (out-of-root) and names the file', () => {
    const r = checkPlanJail({ projectRoot: root, files: ['../escapee.ts'] });
    expect(r).not.toBeNull();
    expect(r!.reason).toBe('out-of-root');
    expect(r!.files).toContain('../escapee.ts');
    expect(r!.message).toContain('../escapee.ts');
  });

  it('refuse-before-read: a NONEXISTENT out-of-root path is refused on the path alone — a content read would have thrown ENOENT, so a clean out-of-root refusal proves the check ran before any read (FR-017)', () => {
    const ghost = '../does-not-exist-ghost.ts';
    expect(fs.existsSync(path.resolve(root, ghost))).toBe(false);
    // If the jail read the file's bytes before deciding, this call would throw;
    // a returned refusal is the refuse-before-read guarantee.
    const r = checkPlanJail({ projectRoot: root, files: [ghost] });
    expect(r!.reason).toBe('out-of-root');
  });

  it('whole-plan refusal names EVERY offending out-of-root file', () => {
    const r = checkPlanJail({ projectRoot: root, files: ['../a.ts', '../nested/b.ts'] });
    expect(r!.reason).toBe('out-of-root');
    expect(r!.files).toEqual(expect.arrayContaining(['../a.ts', '../nested/b.ts']));
  });

  // ── scope-ignored (FR-017 index-scope guard) ──────────────────────────────
  it('scope-ignored via codegraph.json exclude: an in-root but excluded file refuses (scope-ignored) and names the file', () => {
    fs.writeFileSync(path.join(root, 'codegraph.json'), JSON.stringify({ exclude: ['vendored.ts'] }));
    fs.writeFileSync(path.join(root, 'vendored.ts'), 'export const x = 1;\n');
    const r = checkPlanJail({ projectRoot: root, files: ['vendored.ts'] });
    expect(r).not.toBeNull();
    expect(r!.reason).toBe('scope-ignored');
    expect(r!.files).toContain('vendored.ts');
    expect(r!.message).toContain('vendored.ts');
  });

  it('scope-ignored via .gitignore: an in-root but gitignored file refuses (scope-ignored) — the shared indexer/watcher matcher, not a raw .gitignore reparse', () => {
    fs.writeFileSync(path.join(root, '.gitignore'), 'generated/\n');
    fs.mkdirSync(path.join(root, 'generated'));
    fs.writeFileSync(path.join(root, 'generated', 'legacy.ts'), 'export const y = 2;\n');
    const r = checkPlanJail({ projectRoot: root, files: ['generated/legacy.ts'] });
    expect(r).not.toBeNull();
    expect(r!.reason).toBe('scope-ignored');
    expect(r!.files).toContain('generated/legacy.ts');
  });

  // ── allow path & precedence ───────────────────────────────────────────────
  it('in-root, in-scope file: no refusal (null) — the allow path', () => {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'keep.ts'), 'export function keep(): void {}\n');
    expect(checkPlanJail({ projectRoot: root, files: ['src/keep.ts'] })).toBeNull();
  });

  it('out-of-root takes precedence over scope-ignored when a plan mixes both, and does not conflate the scope-ignored file into the out-of-root list', () => {
    fs.writeFileSync(path.join(root, 'codegraph.json'), JSON.stringify({ exclude: ['vendored.ts'] }));
    fs.writeFileSync(path.join(root, 'vendored.ts'), 'export const x = 1;\n');
    const r = checkPlanJail({ projectRoot: root, files: ['vendored.ts', '../escapee.ts'] });
    expect(r!.reason).toBe('out-of-root');
    expect(r!.files).toContain('../escapee.ts');
    expect(r!.files).not.toContain('vendored.ts');
  });

  // ── success-shaped, not PathRefusalError (FR-023) ─────────────────────────
  it('refusals are success-shaped plain Refusal objects, never a thrown PathRefusalError (isError/exit-code shaping is the caller\'s job)', () => {
    let r: Refusal | null = null;
    expect(() => {
      r = checkPlanJail({ projectRoot: root, files: ['../escapee.ts'] });
    }).not.toThrow();
    expect(r).not.toBeNull();
    expect(r).not.toBeInstanceOf(Error);
    expect((r as unknown as Refusal).reason).toBe('out-of-root');
  });

  // ── symlink-resolved containment (POSIX symlink cases gated) ──────────────
  it.runIf(process.platform !== 'win32')('symlink escape: an in-root symlink whose real target is OUTSIDE the root refuses (out-of-root) — realpath-both-sides jail', () => {
    const external = makeExternalDir();
    const target = path.join(external, 'secret.ts');
    fs.writeFileSync(target, 'export const secret = 1;\n');
    fs.symlinkSync(target, path.join(root, 'link.ts'));
    const r = checkPlanJail({ projectRoot: root, files: ['link.ts'] });
    expect(r).not.toBeNull();
    expect(r!.reason).toBe('out-of-root');
    expect(r!.files).toContain('link.ts');
  });

  it.runIf(process.platform !== 'win32')('symlinked project root: an edit under the real root is in-jail (null) — the root is symlink-resolved to its real location before the containment compare', () => {
    const realRoot = makeExternalDir();
    fs.mkdirSync(path.join(realRoot, 'src'));
    fs.writeFileSync(path.join(realRoot, 'src', 'keep.ts'), 'export function keep(): void {}\n');
    const linkRoot = path.join(root, 'linkroot');
    fs.symlinkSync(realRoot, linkRoot);
    expect(checkPlanJail({ projectRoot: linkRoot, files: ['src/keep.ts'] })).toBeNull();
  });

  // ── case-insensitive containment (portable: never an out-of-jail escape) ──
  it('a case-variant of an in-root path is treated as in-root, never an out-of-jail escape — realpath normalization canonicalizes casing on a case-insensitive FS, and the lexical guard keeps it in-root on a case-sensitive one (FR-017)', () => {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'keep.ts'), 'export function keep(): void {}\n');
    expect(checkPlanJail({ projectRoot: root, files: ['SRC/KEEP.ts'] })).toBeNull();
  });
});

// =============================================================================
// Rungs 3 & 4 of the apply safety ladder — the snapshot/write module
// (`src/refactor/snapshot.ts`). Real temp files, byte-level assertions; no
// mocking, per the constitution. `mkEdit` builds a RenameEdit in the graph's
// native 1-indexed-line / 0-indexed-column convention; `end` is derived from the
// old name's UTF-16 length exactly as the plan engine derives it (data-model
// Decision 8), so the write path's offset math is exercised end-to-end.
// =============================================================================

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const mkEdit = (
  file: string,
  line: number,
  column: number,
  oldText: string,
  newText: string,
  lineText: string,
): RenameEdit => ({
  file,
  range: { start: { line, column }, end: { line, column: column + oldText.length } },
  oldText,
  newText,
  lineText,
  confidence: 'exact',
  source: 'graph',
});

/**
 * T031 Rung 3 — in-memory byte snapshots + apply-time span re-verification
 * (FR-016 / FR-018).
 *
 * `takeSnapshots` copies every touched file's raw bytes into memory BEFORE any
 * write (so a rollback can restore byte-identically). `reverifySpans` re-checks
 * each planned edit against the LIVE file bytes right before writing: a file
 * whose bytes drifted since indexing (the plan→apply window) fails re-verify and
 * is reported in `driftedFiles` — the ENGINE later maps that to a success-shaped
 * `stale-span` refusal with ZERO writes (FR-016). This module contract: report
 * the drifted files and never write during verification.
 */
describe('T031 Rung 3 — snapshot + span re-verify (FR-016/FR-018): snapshot.ts (real fs)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-rename-snap-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const readFileAt = (f: string): string => fs.readFileSync(path.join(root, f), 'utf8');

  // ── takeSnapshots ─────────────────────────────────────────────────────────
  it('takeSnapshots: an exact raw-byte Buffer of every touched file (CRLF + BOM bytes captured verbatim)', () => {
    const aBytes = Buffer.concat([BOM, Buffer.from('x\r\ny', 'utf8')]); // BOM + CRLF, no trailing NL
    const bBytes = Buffer.from('plain\n', 'utf8');
    fs.writeFileSync(path.join(root, 'a.ts'), aBytes);
    fs.writeFileSync(path.join(root, 'b.ts'), bBytes);

    const snaps = takeSnapshots(root, ['a.ts', 'b.ts']);
    expect(snaps.size).toBe(2);
    expect(snaps.get('a.ts')!.equals(aBytes)).toBe(true);
    expect(snaps.get('b.ts')!.equals(bBytes)).toBe(true);
  });

  it('takeSnapshots: the snapshot is an independent in-memory copy — a later disk mutation does not change it (the pre-write state is what rollback restores)', () => {
    const original = Buffer.from('before\n', 'utf8');
    fs.writeFileSync(path.join(root, 'a.ts'), original);
    const snaps = takeSnapshots(root, ['a.ts']);
    fs.writeFileSync(path.join(root, 'a.ts'), Buffer.from('AFTER-CHANGED-ON-DISK\n', 'utf8'));
    expect(snaps.get('a.ts')!.equals(original)).toBe(true);
  });

  // ── reverifySpans ─────────────────────────────────────────────────────────
  it('reverifySpans: every planned span still matches the live bytes → {ok:true}', () => {
    fs.writeFileSync(path.join(root, 'a.ts'), 'const foo = 1\n');
    const edits = [mkEdit('a.ts', 1, 6, 'foo', 'bar', 'const foo = 1')];
    expect(reverifySpans({ edits, readFile: readFileAt })).toEqual({ ok: true });
  });

  it('reverifySpans: strips a leading BOM so line-1 columns align with the graph-native (BOM-free) column count → {ok:true}', () => {
    fs.writeFileSync(
      path.join(root, 'a.ts'),
      Buffer.concat([BOM, Buffer.from('const foo = 1\n', 'utf8')]),
    );
    const edits = [mkEdit('a.ts', 1, 6, 'foo', 'bar', 'const foo = 1')];
    expect(reverifySpans({ edits, readFile: readFileAt })).toEqual({ ok: true });
  });

  it('reverifySpans: a file whose live bytes drifted from the planned span → {ok:false, driftedFiles:[file]} and NOTHING is written (re-verify is read-only)', () => {
    fs.writeFileSync(path.join(root, 'a.ts'), 'const foo = 1\n');
    const edits = [mkEdit('a.ts', 1, 6, 'foo', 'bar', 'const foo = 1')];
    // Drift: shift the identifier so `foo` is no longer at column 6.
    fs.writeFileSync(path.join(root, 'a.ts'), 'const zzzzfoo = 1\n');
    const before = fs.readFileSync(path.join(root, 'a.ts'));

    const res = reverifySpans({ edits, readFile: readFileAt });
    expect(res).toEqual({ ok: false, driftedFiles: ['a.ts'] });
    // Re-verification must never write — the file is byte-unchanged afterward.
    expect(fs.readFileSync(path.join(root, 'a.ts')).equals(before)).toBe(true);
  });

  it('reverifySpans: reports ONLY the drifted file when a sibling file still matches', () => {
    fs.writeFileSync(path.join(root, 'a.ts'), 'const foo = 1\n'); // still matches
    fs.writeFileSync(path.join(root, 'b.ts'), 'XXconst foo = 1\n'); // drifted at col 6
    const edits = [
      mkEdit('a.ts', 1, 6, 'foo', 'bar', 'const foo = 1'),
      mkEdit('b.ts', 1, 6, 'foo', 'bar', 'const foo = 1'),
    ];
    expect(reverifySpans({ edits, readFile: readFileAt })).toEqual({
      ok: false,
      driftedFiles: ['b.ts'],
    });
  });

  it('reverifySpans: de-duplicates the drifted-file list when several edits in one drifted file all fail', () => {
    fs.writeFileSync(path.join(root, 'a.ts'), 'ZZZ nope nope\n'); // neither `foo` present
    const edits = [
      mkEdit('a.ts', 1, 4, 'foo', 'bar', 'let foo = foo'),
      mkEdit('a.ts', 1, 10, 'foo', 'bar', 'let foo = foo'),
    ];
    const res = reverifySpans({ edits, readFile: readFileAt });
    expect(res).toEqual({ ok: false, driftedFiles: ['a.ts'] });
  });
});

/**
 * T032 Rung 4 — the atomic writer, rollback restore, and recovery dump
 * (FR-019 / FR-019a / FR-020).
 *
 * `writeEdits` applies each file's verified edits via a temp-sibling →
 * atomic-rename, operating on the WHOLE file content (never a line-split/rejoin)
 * so every byte outside an edited span — line endings, trailing newline, BOM,
 * multibyte content — round-trips exactly (FR-020 byte-preservation). Edits apply
 * descending / right-to-left so an applied edit never invalidates an unapplied
 * offset; identical duplicate ranges de-dup; a genuine partial overlap is
 * detected and refused across the WHOLE plan without writing anything (the engine
 * degrades that rename to the graph path per FR-003a). `restoreSnapshots` writes
 * the pre-write bytes back byte-identically; a restore that fails (an unwritable
 * file) is reported and its snapshot dumped to a per-incident recovery dir
 * (FR-019a).
 */
describe('T032 Rung 4 — atomic write (FR-019/FR-019a/FR-020): snapshot.ts (real fs)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-rename-write-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const write1 = (file: string, edits: RenameEdit[]): WriteEditsResult =>
    writeEdits({ projectRoot: root, editsByFile: new Map([[file, edits]]) });

  // ── temp-sibling suffix is invisible to the watcher's source filter ───────
  it('the atomic-write temp sibling carries a NON-SOURCE suffix — isSourceFile rejects it, so the file watcher never re-indexes the half-written temp', () => {
    // `isSourceFile` keys purely on extension; the temp suffix must not be one.
    expect(isSourceFile('.App.tsx' + RENAME_TEMP_SUFFIX)).toBe(false);
    expect(isSourceFile('.mod.ts' + RENAME_TEMP_SUFFIX)).toBe(false);
    // Sanity: the underlying real files ARE source files (the suffix is the fix).
    expect(isSourceFile('App.tsx')).toBe(true);
    expect(isSourceFile('mod.ts')).toBe(true);
  });

  // ── byte-preservation outside edited spans (FR-020) ───────────────────────
  it('CRLF line endings round-trip byte-identically — only the identifier span changes', () => {
    const original = Buffer.from('a\r\nfoo\r\nb', 'utf8'); // CRLF, no trailing newline
    fs.writeFileSync(path.join(root, 'a.ts'), original);
    const res = write1('a.ts', [mkEdit('a.ts', 2, 0, 'foo', 'bar', 'foo')]);
    expect(res).toEqual({ ok: true, writtenFiles: ['a.ts'] });
    expect(fs.readFileSync(path.join(root, 'a.ts')).equals(Buffer.from('a\r\nbar\r\nb', 'utf8'))).toBe(
      true,
    );
  });

  it('a missing trailing newline is preserved (no incidental final-newline insertion)', () => {
    fs.writeFileSync(path.join(root, 'a.ts'), Buffer.from('const foo = 1', 'utf8')); // no \n
    write1('a.ts', [mkEdit('a.ts', 1, 6, 'foo', 'bar', 'const foo = 1')]);
    const after = fs.readFileSync(path.join(root, 'a.ts'));
    expect(after.equals(Buffer.from('const bar = 1', 'utf8'))).toBe(true);
    expect(after[after.length - 1]).not.toBe(0x0a); // still no trailing LF
  });

  it('a present trailing newline is preserved', () => {
    fs.writeFileSync(path.join(root, 'a.ts'), Buffer.from('const foo = 1\n', 'utf8'));
    write1('a.ts', [mkEdit('a.ts', 1, 6, 'foo', 'bar', 'const foo = 1')]);
    expect(
      fs.readFileSync(path.join(root, 'a.ts')).equals(Buffer.from('const bar = 1\n', 'utf8')),
    ).toBe(true);
  });

  it('a UTF-8 BOM is preserved (stripped for offset math, re-attached on write)', () => {
    const original = Buffer.concat([BOM, Buffer.from('const foo = 1\n', 'utf8')]);
    fs.writeFileSync(path.join(root, 'a.ts'), original);
    write1('a.ts', [mkEdit('a.ts', 1, 6, 'foo', 'bar', 'const foo = 1')]);
    const expected = Buffer.concat([BOM, Buffer.from('const bar = 1\n', 'utf8')]);
    expect(fs.readFileSync(path.join(root, 'a.ts')).equals(expected)).toBe(true);
  });

  it('bytes OUTSIDE the edited span are preserved exactly — multibyte content on other lines + CRLF survive whole-file (never a line-split/rejoin reformat)', () => {
    const original = Buffer.from('// 你好 🚀\r\nconst foo = 1\r\n', 'utf8');
    fs.writeFileSync(path.join(root, 'a.ts'), original);
    // `const ` is 6 UTF-16 units → foo starts at column 6 on line 2.
    write1('a.ts', [mkEdit('a.ts', 2, 6, 'foo', 'bar', 'const foo = 1')]);
    const expected = Buffer.from('// 你好 🚀\r\nconst bar = 1\r\n', 'utf8');
    expect(fs.readFileSync(path.join(root, 'a.ts')).equals(expected)).toBe(true);
  });

  // ── intra-file edit order (descending / right-to-left) ────────────────────
  it('multiple edits on the SAME line apply right-to-left so a length-changing edit never shifts an earlier offset', () => {
    fs.writeFileSync(path.join(root, 'a.ts'), Buffer.from('let foo = foo;', 'utf8'));
    write1('a.ts', [
      mkEdit('a.ts', 1, 4, 'foo', 'renamed', 'let foo = foo;'),
      mkEdit('a.ts', 1, 10, 'foo', 'renamed', 'let foo = foo;'),
    ]);
    expect(
      fs.readFileSync(path.join(root, 'a.ts')).equals(Buffer.from('let renamed = renamed;', 'utf8')),
    ).toBe(true);
  });

  it('multiple edits across MULTIPLE lines all apply, preserving line endings', () => {
    fs.writeFileSync(path.join(root, 'a.ts'), Buffer.from('foo\nfoo\nfoo\n', 'utf8'));
    write1('a.ts', [
      mkEdit('a.ts', 1, 0, 'foo', 'bar', 'foo'),
      mkEdit('a.ts', 2, 0, 'foo', 'bar', 'foo'),
      mkEdit('a.ts', 3, 0, 'foo', 'bar', 'foo'),
    ]);
    expect(
      fs.readFileSync(path.join(root, 'a.ts')).equals(Buffer.from('bar\nbar\nbar\n', 'utf8')),
    ).toBe(true);
  });

  // ── duplicate & overlap handling (FR-020) ─────────────────────────────────
  it('identical duplicate ranges de-duplicate — one occurrence is written exactly once (no double-write)', () => {
    fs.writeFileSync(path.join(root, 'a.ts'), Buffer.from('let foo;', 'utf8'));
    const dup = mkEdit('a.ts', 1, 4, 'foo', 'barbar', 'let foo;'); // newText longer than oldText
    write1('a.ts', [dup, { ...dup }]); // same range, same substitution, twice
    // Deduped → "let barbar;". A double-write would have produced "let barbarbar;".
    expect(fs.readFileSync(path.join(root, 'a.ts')).equals(Buffer.from('let barbar;', 'utf8'))).toBe(
      true,
    );
  });

  it('a genuine partial overlap is detected and refused ({overlap:true, file}) — the file is left byte-unchanged (zero writes)', () => {
    const original = Buffer.from('foobar', 'utf8');
    fs.writeFileSync(path.join(root, 'a.ts'), original);
    const res = write1('a.ts', [
      mkEdit('a.ts', 1, 0, 'foob', 'X', 'foobar'), // [0,4)
      mkEdit('a.ts', 1, 2, 'obar', 'Y', 'foobar'), // [2,6) — overlaps [0,4)
    ]);
    expect(res).toEqual({ overlap: true, file: 'a.ts' });
    expect(fs.readFileSync(path.join(root, 'a.ts')).equals(original)).toBe(true);
  });

  it('an overlap in ANY file refuses the WHOLE plan — no file (not even a clean sibling) is written', () => {
    const goodOriginal = Buffer.from('let foo;', 'utf8');
    const badOriginal = Buffer.from('foobar', 'utf8');
    fs.writeFileSync(path.join(root, 'good.ts'), goodOriginal);
    fs.writeFileSync(path.join(root, 'bad.ts'), badOriginal);
    const res = writeEdits({
      projectRoot: root,
      editsByFile: new Map([
        ['good.ts', [mkEdit('good.ts', 1, 4, 'foo', 'bar', 'let foo;')]],
        ['bad.ts', [
          mkEdit('bad.ts', 1, 0, 'foob', 'X', 'foobar'),
          mkEdit('bad.ts', 1, 2, 'obar', 'Y', 'foobar'),
        ]],
      ]),
    });
    expect(res).toEqual({ overlap: true, file: 'bad.ts' });
    // Whole-plan atomicity: the clean sibling was NOT written.
    expect(fs.readFileSync(path.join(root, 'good.ts')).equals(goodOriginal)).toBe(true);
    expect(fs.readFileSync(path.join(root, 'bad.ts')).equals(badOriginal)).toBe(true);
  });

  it('no temp sibling lingers after a successful write (the temp is atomically renamed onto the target)', () => {
    fs.writeFileSync(path.join(root, 'a.ts'), Buffer.from('const foo = 1\n', 'utf8'));
    write1('a.ts', [mkEdit('a.ts', 1, 6, 'foo', 'bar', 'const foo = 1')]);
    const leftovers = fs.readdirSync(root).filter((n) => n.endsWith(RENAME_TEMP_SUFFIX));
    expect(leftovers).toEqual([]);
  });

  // ── rollback restore (FR-019) ─────────────────────────────────────────────
  it('restoreSnapshots: writes the pre-write bytes back byte-identically and reports the restored file — no recovery dir when nothing failed', () => {
    const original = Buffer.from('const foo = 1\n', 'utf8');
    fs.writeFileSync(path.join(root, 'a.ts'), original);
    const snaps = takeSnapshots(root, ['a.ts']);
    write1('a.ts', [mkEdit('a.ts', 1, 6, 'foo', 'bar', 'const foo = 1')]);
    expect(fs.readFileSync(path.join(root, 'a.ts')).equals(original)).toBe(false); // sanity: changed

    const res = restoreSnapshots({ projectRoot: root, snapshots: snaps });
    expect(res.restoredFiles).toEqual(['a.ts']);
    expect(res.unrestoredFiles).toEqual([]);
    expect(res.recoveryDir).toBeUndefined();
    expect(fs.readFileSync(path.join(root, 'a.ts')).equals(original)).toBe(true);
    // A clean restore never creates the recovery scaffold.
    expect(fs.existsSync(path.join(root, '.codegraph'))).toBe(false);
  });

  // ── failed rollback restore → recovery dump (FR-019a) ─────────────────────
  it.runIf(process.platform !== 'win32')(
    'restoreSnapshots: an unwritable file → RecoveryInfo lists it as unrestored and dumps its snapshot (byte-equal) to a per-incident .codegraph/rename-recovery-<pid>-<hex>/ dir, preserving the relative path',
    () => {
      const rel = 'src/mod.ts';
      fs.mkdirSync(path.join(root, 'src'));
      const original = Buffer.from('const foo = 1\n', 'utf8');
      fs.writeFileSync(path.join(root, rel), original);
      const snaps = takeSnapshots(root, [rel]);

      // Mutate, then make the file unwritable so the in-place restore fails (EACCES).
      fs.writeFileSync(path.join(root, rel), Buffer.from('const bar = 1\n', 'utf8'));
      fs.chmodSync(path.join(root, rel), 0o444);

      let res: RestoreResult | undefined;
      try {
        res = restoreSnapshots({ projectRoot: root, snapshots: snaps });
      } finally {
        fs.chmodSync(path.join(root, rel), 0o644); // let afterEach clean up
      }

      expect(res!.restoredFiles).toEqual([]);
      expect(res!.unrestoredFiles).toEqual([rel]);
      expect(res!.recoveryDir).toBeTruthy();
      expect(path.dirname(res!.recoveryDir!)).toBe(path.join(root, '.codegraph'));
      expect(path.basename(res!.recoveryDir!)).toMatch(/^rename-recovery-\d+-[0-9a-f]+$/);
      // The unrestored snapshot is dumped under the recovery dir at its relative
      // path, byte-equal to the pre-write snapshot.
      const dumped = path.join(res!.recoveryDir!, rel);
      expect(fs.existsSync(dumped)).toBe(true);
      expect(fs.readFileSync(dumped).equals(original)).toBe(true);
    },
  );
});

/**
 * T033 Rung 5 — re-sync discrimination + the FR-018 post-check
 * (`src/refactor/post-check.ts`).
 *
 * FR-018's apply ladder re-syncs the touched files via `CodeGraph.sync()` (the
 * resolution-complete path, NEVER `indexFiles()`), then runs a touched-file-scoped
 * DUAL assertion over LIVE graph state: (a) no unresolved reference in those
 * files still carries the old name, and (b) no node named the old name remains.
 *
 * Two seams:
 *   discriminateSyncResult(r) — the zero-shape rule. The lock-failure zero-shape
 *     (`filesChecked:0` AND `durationMs:0`, produced only by `sync()`'s file-lock
 *     contention path, `src/index.ts`) is an apply failure → rollback; ANY other
 *     result (`filesChecked>0`, incl. a watcher-raced real-empty `filesModified:0`)
 *     proceeds to the post-check. Unit-tested on synthetic SyncResults (the
 *     zero-shape is producible only by real lock contention, not reliably here),
 *     PLUS one real `sync()` proving a normal result discriminates as 'completed'.
 *   runPostCheck({queries, oldName, touchedFiles}) — the dual assertion, mapping
 *     each hit to a machine-actionable DanglingReference (FR-019).
 *
 * End-to-end fixture (real files + real SQLite, no mocking): index a declaration
 * and two importing call sites, then SIMULATE an apply's writes — rename the
 * declaration in its own file but deliberately leave the call-site files
 * unwritten — and `cg.sync()`. Re-resolution parks the now-undefined old-name
 * calls as dangling refs; the post-check, scoped to the plan's touched files,
 * must catch the one INSIDE the touched set and ignore the identically-named one
 * OUTSIDE it. A never-renamed leftover declaration (`zombieDecl`) exercises the
 * node branch (b) in isolation.
 */
describe('T033 Rung 5 — re-sync discrimination + post-check (FR-018/FR-019): post-check.ts (real SQLite)', () => {
  const OLD = 'widget'; //     renamed away in decl.ts; left dangling in the callers
  const NEW = 'gadget'; //     the declaration's new name after the simulated apply
  const ZOMBIE = 'zombieDecl'; // a never-renamed leftover declaration (node branch)

  let dir: string;
  let cg: CodeGraph;
  let queries: QueryBuilder;
  let declPath: string; //          decl.ts (renamed OLD→NEW) — in the touched set, now clean
  let touchedCallerPath: string; // in the touched set, left unwritten → dangles on OLD
  let otherCallerPath: string; //   NOT in the touched set → same-named dangle, out of scope
  let leftoverPath: string; //      carries the never-renamed ZOMBIE node
  let syncResult: SyncResult; //    apply's own re-sync result (real, non-zero-shape)

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-rename-postcheck-'));
    fs.writeFileSync(path.join(dir, 'decl.ts'), `export function ${OLD}(): void {}\n`);
    fs.writeFileSync(
      path.join(dir, 'touched_caller.ts'),
      [`import { ${OLD} } from './decl';`, `export function touchedUse(): void { ${OLD}(); }`, ''].join('\n'),
    );
    fs.writeFileSync(
      path.join(dir, 'other_caller.ts'),
      [`import { ${OLD} } from './decl';`, `export function otherUse(): void { ${OLD}(); }`, ''].join('\n'),
    );
    fs.writeFileSync(path.join(dir, 'leftover.ts'), `function ${ZOMBIE}(): void {}\n`);

    cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    queries = (cg as unknown as { queries: QueryBuilder }).queries;

    // Simulate the apply's writes: rename the DECLARATION in its own file, but
    // deliberately leave BOTH call-site files unwritten — so the old name still
    // dangles in them. Then run the resolution-complete re-sync FR-018 mandates.
    fs.writeFileSync(path.join(dir, 'decl.ts'), `export function ${NEW}(): void {}\n`);
    syncResult = await cg.sync();

    // Stored paths are relative to the project root; derive them from stable
    // function nodes (only decl.ts changed) rather than hardcoding the format.
    declPath = queries.getNodesByName(NEW)[0]!.filePath;
    touchedCallerPath = queries.getNodesByName('touchedUse')[0]!.filePath;
    otherCallerPath = queries.getNodesByName('otherUse')[0]!.filePath;
    leftoverPath = queries.getNodesByName(ZOMBIE)[0]!.filePath;
  });

  afterAll(() => {
    cg?.destroy();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  // ── discriminateSyncResult — the FR-018 zero-shape rule (synthetic) ────────
  describe('discriminateSyncResult (zero-shape rule)', () => {
    const mkSync = (o: Partial<SyncResult>): SyncResult => ({
      filesChecked: 0, filesAdded: 0, filesModified: 0, filesRemoved: 0, nodesUpdated: 0, durationMs: 0, ...o,
    });

    it('the lock-failure zero-shape (filesChecked:0 AND durationMs:0) → lock-failure (triggers rollback)', () => {
      expect(discriminateSyncResult(mkSync({}))).toBe('lock-failure');
    });

    it('a real empty re-sync (filesChecked>0, filesModified:0) → completed — a watcher-raced no-op proceeds to the post-check', () => {
      expect(discriminateSyncResult(mkSync({ filesChecked: 4, filesModified: 0, durationMs: 9 }))).toBe('completed');
    });

    it('a normal re-sync (filesChecked>0, filesModified>0) → completed', () => {
      expect(discriminateSyncResult(mkSync({ filesChecked: 4, filesModified: 2, nodesUpdated: 7, durationMs: 9 }))).toBe('completed');
    });

    it('keys on the exact zero-shape, not filesChecked alone: filesChecked:0 with a nonzero durationMs is completed', () => {
      expect(discriminateSyncResult(mkSync({ filesChecked: 0, durationMs: 5 }))).toBe('completed');
    });

    it('keys on the exact zero-shape, not durationMs alone: a nonzero filesChecked with durationMs:0 is completed', () => {
      expect(discriminateSyncResult(mkSync({ filesChecked: 2, durationMs: 0 }))).toBe('completed');
    });
  });

  // ── one real sync() proves a normal result discriminates as completed ──────
  it('a real CodeGraph.sync() over the changed declaration file discriminates as completed (not the lock-failure zero-shape)', () => {
    expect(syncResult.filesChecked).toBeGreaterThan(0);
    expect(discriminateSyncResult(syncResult)).toBe('completed');
  });

  // ── fixture sanity: the simulated apply produced a genuine dangle ──────────
  it('fixture: the simulated apply (declaration renamed, call-site left unwritten + re-synced) produced a genuine dangling old-name reference inside the touched call site, and no old-name node survives in the renamed file', () => {
    expect(queries.getUnresolvedRefsByNameInFiles(OLD, [touchedCallerPath]).length).toBeGreaterThanOrEqual(1);
    expect(queries.getNodesByNameInFiles(OLD, [declPath])).toEqual([]);
  });

  // ── (a) detects the dangling reference INSIDE the touched set ──────────────
  it('detects a dangling old-name reference INSIDE the touched set — the post-check fails and lists it (FR-018 dual assertion (a); FR-019 payload)', () => {
    const res = runPostCheck({ queries, oldName: OLD, touchedFiles: [declPath, touchedCallerPath] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.danglingReferences.length).toBeGreaterThanOrEqual(1);
      // Every reported dangle is scoped to the touched files and names the old name.
      expect(res.danglingReferences.every((d) => d.name === OLD)).toBe(true);
      expect(res.danglingReferences.every((d) => d.file === declPath || d.file === touchedCallerPath)).toBe(true);
      expect(res.danglingReferences.some((d) => d.file === touchedCallerPath)).toBe(true);
      // The ref-sourced entry's span is the old name's UTF-16 length from its start.
      const refRow = queries.getUnresolvedRefsByNameInFiles(OLD, [touchedCallerPath])[0]!;
      const refEntry = res.danglingReferences.find(
        (d) => d.file === touchedCallerPath && d.range.start.line === refRow.line && d.range.start.column === refRow.column,
      );
      expect(refEntry).toBeDefined();
      expect(refEntry!.range.end).toEqual({ line: refRow.line, column: refRow.column + OLD.length });
    }
  });

  // ── scoping: a same-named dangle OUTSIDE the touched set is ignored ────────
  it('a same-named dangling reference OUTSIDE the touched set does NOT fail the post-check (touched-file scoping)', () => {
    // other_caller.ts also dangles on the old name…
    expect(queries.getUnresolvedRefsByNameInFiles(OLD, [otherCallerPath]).length).toBeGreaterThanOrEqual(1);
    // …yet a post-check scoped to [decl, touchedCaller] never reports it.
    const resScoped = runPostCheck({ queries, oldName: OLD, touchedFiles: [declPath, touchedCallerPath] });
    expect(resScoped.ok).toBe(false);
    if (!resScoped.ok) {
      expect(resScoped.danglingReferences.every((d) => d.file !== otherCallerPath)).toBe(true);
    }
    // Scoped to ONLY the clean renamed file, the post-check is green — the
    // touched_caller dangle is excluded when that file is out of scope.
    expect(runPostCheck({ queries, oldName: OLD, touchedFiles: [declPath] })).toEqual({ ok: true });
  });

  // ── (b) a leftover old-name NODE is reported as a dangling entry ───────────
  it('reports a leftover old-name NODE in a touched file as a dangling entry, mapped to the node\'s recorded span (FR-018 dual assertion (b))', () => {
    const nodes = queries.getNodesByNameInFiles(ZOMBIE, [leftoverPath]);
    expect(nodes).toHaveLength(1);
    const res = runPostCheck({ queries, oldName: ZOMBIE, touchedFiles: [leftoverPath] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.danglingReferences).toHaveLength(1);
      const n = nodes[0]!;
      expect(res.danglingReferences[0]).toEqual({
        file: leftoverPath,
        name: ZOMBIE,
        range: {
          start: { line: n.startLine, column: n.startColumn },
          end: { line: n.endLine, column: n.endColumn },
        },
      });
    }
  });

  // ── the empty/clean green path ────────────────────────────────────────────
  it('an empty touched-file set asserts nothing → green (ok:true)', () => {
    expect(runPostCheck({ queries, oldName: OLD, touchedFiles: [] })).toEqual({ ok: true });
  });
});

// =============================================================================
// The apply engine — the safety ladder composition (`src/refactor/apply-engine.ts`).
// Real files + real SQLite through the full CodeGraph pipeline (no mocking, per
// the constitution): each apply RECOMPUTES its plan from the live index (FR-014),
// writes via the atomic writer, re-syncs, post-checks, and rolls back if needed.
// The re-sync is INJECTED (`CodeGraph.sync` bound), so a test that must perturb
// the plan→apply window (T034) does so through that seam rather than a stub. Every
// apply drives the deterministic GRAPH path (LSP disabled) so the ladder — not a
// spawned language server — is what is under test.
// =============================================================================

/** SHA-256 of a file's raw bytes — the byte-identity oracle for rollback (FR-019/SC-002). */
const shasum = (abs: string): string => createHash('sha256').update(fs.readFileSync(abs)).digest('hex');

/** The four modeled terminal states (ApplyOutcome / SC-002). */
const APPLY_TERMINALS = ['applied', 'refused', 'rolled-back', 'rollback-failed'] as const;

/**
 * Assert an apply resolved to EXACTLY ONE terminal state (SC-002): the outcome is
 * one of the four modeled states, and each outcome-specific payload is present iff
 * it is that outcome's payload — `refusal` ⇔ refused, `danglingReferences` ⇔
 * rolled-back, `recovery` ⇔ rollback-failed. Applied across every induced outcome
 * below, this proves the state machine has no overlapping or half-formed terminal.
 */
function assertExactlyOneTerminal(r: ApplyResult): void {
  expect(APPLY_TERMINALS).toContain(r.outcome);
  expect(r.refusal !== undefined).toBe(r.outcome === 'refused');
  expect(r.danglingReferences !== undefined).toBe(r.outcome === 'rolled-back');
  expect(r.recovery !== undefined).toBe(r.outcome === 'rollback-failed');
}

/** Create + index a real fixture; returns the handle, queries, and a cleanup fn. */
async function makeIndexedFixture(
  files: Record<string, string>,
): Promise<{ dir: string; cg: CodeGraph; queries: QueryBuilder; cleanup: () => void }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-rename-apply-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); // supports nested fixture paths (e.g. 'sub/caller.ts')
    fs.writeFileSync(path.join(dir, name), content);
  }
  const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
  await cg.indexAll();
  const queries = (cg as unknown as { queries: QueryBuilder }).queries;
  return {
    dir,
    cg,
    queries,
    cleanup: () => {
      cg.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A graph-forced EffectiveLspConfig — every apply test drives the deterministic graph path. */
const graphOnlyLsp = (dir: string) =>
  resolveLspConfig({ projectRoot: dir, cliActivation: 'disable', env: {} });

/**
 * T029 Rung 1 — the FR-015 confidence gate.
 *
 * `--apply` is all-or-nothing on confidence: a plan carrying ANY below-`exact`
 * edit is refused `heuristic-gated` (listing the gated edits) with ZERO writes,
 * unless the caller opts the heuristics in. A heuristic edit is induced the way
 * the T012 `contains-heuristic` assembly test does — a hand-inserted `references`
 * edge through a heuristic `resolvedBy` (`exact-match`, a cross-file bare-name
 * match — FR-004 table: below `exact`) at a real, span-verifiable old-name
 * occurrence — so the recomputed plan (FR-014) genuinely contains it.
 */
describe('T029 Rung 1 — confidence gate (FR-015): apply-engine.ts (real SQLite)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  // widget: the renamed function (exact declaration edit). other: an unrelated
  // decl that will source the hand-inserted heuristic reference at the comment.
  const fixture = {
    'lib.ts':
      [
        'export function widget(x) { return x; }',
        'export function other() { return 0; }',
        '// widget mention',
      ].join('\n') + '\n',
  };
  const COMMENT_LINE = '// widget mention';

  /** Index the fixture and hand-insert the span-verifiable heuristic reference. */
  async function setupHeuristicPlan(): Promise<{
    dir: string;
    cg: CodeGraph;
    queries: QueryBuilder;
  }> {
    const { dir, cg, queries, cleanup } = await makeIndexedFixture(fixture);
    cleanups.push(cleanup);
    const widgetId = cg.getNodesByName('widget').find((n) => n.kind === 'function')!.id;
    const otherId = cg.getNodesByName('other').find((n) => n.kind === 'function')!.id;
    // resolvedBy='exact-match' → heuristic tier; span verifies against `// widget mention`.
    queries.insertEdge({
      source: otherId,
      target: widgetId,
      kind: 'references',
      line: 3,
      column: COMMENT_LINE.indexOf('widget'),
      metadata: { resolvedBy: 'exact-match', refName: 'widget' },
    });
    return { dir, cg, queries };
  }

  it('a below-exact edit with no includeHeuristic → refused heuristic-gated, lists gatedEdits, ZERO writes', async () => {
    const { dir, cg, queries } = await setupHeuristicPlan();
    const before = shasum(path.join(dir, 'lib.ts'));

    const result = await applyRename({
      queries,
      projectRoot: dir,
      selector: { name: 'widget', kind: 'function' },
      newName: 'gadget',
      lspConfig: graphOnlyLsp(dir),
      env: {},
      includeHeuristic: false,
      sync: () => cg.sync(),
    });

    assertExactlyOneTerminal(result);
    expect(result.outcome).toBe('refused');
    expect(result.refusal?.reason).toBe('heuristic-gated');
    // The gated edits are named (so the caller can act without a Read) and are
    // exactly the below-exact edits — the declaration edit (exact) is NOT listed.
    expect(result.refusal!.gatedEdits?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(result.refusal!.gatedEdits!.every((e) => e.confidence === 'heuristic')).toBe(true);
    // ZERO writes — the gate is pre-write, so the file is byte-identical.
    expect(shasum(path.join(dir, 'lib.ts'))).toBe(before);
  });

  it('the same plan with includeHeuristic → proceeds past the gate and applies', async () => {
    const { dir, cg, queries } = await setupHeuristicPlan();

    const result = await applyRename({
      queries,
      projectRoot: dir,
      selector: { name: 'widget', kind: 'function' },
      newName: 'gadget',
      lspConfig: graphOnlyLsp(dir),
      env: {},
      includeHeuristic: true,
      sync: () => cg.sync(),
    });

    assertExactlyOneTerminal(result);
    // Past the gate: NOT a heuristic-gated refusal — the write ladder ran.
    expect(result.refusal?.reason).not.toBe('heuristic-gated');
    expect(result.outcome).toBe('applied');
    // The declaration was renamed on disk (proof the write happened).
    expect(fs.readFileSync(path.join(dir, 'lib.ts'), 'utf8')).toContain('function gadget');
  });
});

/**
 * T034 Rung 6 — unconditional rollback + the FR-019a recovery malfunction.
 *
 * A post-check dangling reference forces an unconditional rollback: every touched
 * file is restored byte-identically from its pre-write snapshot (asserted by
 * shasum equality with the pre-apply bytes), the workspace re-syncs, and the
 * result reports the `danglingReferences` — outcome `rolled-back` (SC-002).
 *
 * The dangle is induced HONESTLY through the injected re-sync seam: after the
 * atomic write but before apply's own re-sync, a NEW old-name reference lands in a
 * touched file (the FR-014→write-window drift the post-check exists to catch). The
 * seam fires exactly at the engine's re-sync point and is guarded to inject ONCE,
 * so the post-rollback re-sync (FR-019) never re-introduces the drift and break
 * byte-identity.
 *
 * When the rollback restore ITSELF fails (a touched file made unwritable), the
 * apply returns the sole error-shaped terminal `rollback-failed` carrying a
 * `recovery` object and dumping the unrestored snapshot byte-equal to a
 * per-incident `.codegraph/rename-recovery-<pid>-<hex>/` dir (FR-019a).
 */
describe('T034 Rung 6 — rollback + recovery (FR-019/FR-019a): apply-engine.ts (real SQLite)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  // A clean cross-file, all-exact rename: decl + import specifier + call site are
  // all edited, so the apply passes the confidence gate and touches both files.
  const fixture = {
    'decl.ts': 'export function widget(): void {}\n',
    'caller.ts':
      [
        "import { widget } from './decl';",
        'export function useWidget(): void { widget(); }',
        '',
      ].join('\n'),
  };
  const DRIFT_LINE = 'export function drift(): void { widget(); }\n';

  it('a post-check dangling ref → restores every touched file byte-identically, re-syncs, reports danglingReferences, outcome rolled-back', async () => {
    const { dir, cg, queries } = await makeIndexedFixture(fixture).then((f) => {
      cleanups.push(f.cleanup);
      return f;
    });
    const declAbs = path.join(dir, 'decl.ts');
    const callerAbs = path.join(dir, 'caller.ts');
    const beforeDecl = shasum(declAbs);
    const beforeCaller = shasum(callerAbs);

    // Inject the drift ONCE, at the engine's re-sync point (post-write), then run
    // the real re-sync. The guard keeps the post-rollback re-sync drift-free.
    let injected = false;
    const sync = async (): Promise<SyncResult> => {
      if (!injected) {
        injected = true;
        fs.appendFileSync(callerAbs, DRIFT_LINE);
      }
      return cg.sync();
    };

    const result = await applyRename({
      queries,
      projectRoot: dir,
      selector: { name: 'widget', kind: 'function' },
      newName: 'gadget',
      lspConfig: graphOnlyLsp(dir),
      env: {},
      sync,
    });

    assertExactlyOneTerminal(result);
    expect(result.outcome).toBe('rolled-back');
    // The dangle is surfaced machine-actionably (file + old name), scoped to the
    // touched files — the caller learns what blocked the rename without a Read.
    expect(result.danglingReferences!.length).toBeGreaterThanOrEqual(1);
    expect(result.danglingReferences!.every((d) => d.name === 'widget')).toBe(true);
    expect(result.danglingReferences!.some((d) => d.file.endsWith('caller.ts'))).toBe(true);
    // Byte-identical restore of EVERY touched file (SC-002): shasum == pre-apply,
    // even though the write (and the injected drift) mutated both files.
    expect(shasum(declAbs)).toBe(beforeDecl);
    expect(shasum(callerAbs)).toBe(beforeCaller);
    // A clean rollback carries no recovery object and leaves no temp sibling.
    expect(result.recovery).toBeUndefined();
    expect(fs.readdirSync(dir).filter((n) => n.endsWith(RENAME_TEMP_SUFFIX))).toEqual([]);
  });

  it.runIf(process.platform !== 'win32')(
    'a failed restore (an unwritable touched file) → outcome rollback-failed, a recovery object, the unrestored snapshot dumped byte-equal; the sole error-shaped terminal',
    async () => {
      const { dir, cg, queries } = await makeIndexedFixture(fixture).then((f) => {
        cleanups.push(f.cleanup);
        return f;
      });
      const declAbs = path.join(dir, 'decl.ts');
      const callerAbs = path.join(dir, 'caller.ts');
      const preApplyCaller = fs.readFileSync(callerAbs); // the snapshot oracle
      const preApplyDeclSum = shasum(declAbs);

      // Inject the same drift, then make caller.ts unwritable so its IN-PLACE
      // restore fails (EACCES) — chmod the FILE, not the dir (restore writes in
      // place; the write path renames a temp, which a read-only dir would not
      // block — so the file mode is what forces the FR-019a path).
      let injected = false;
      const sync = async (): Promise<SyncResult> => {
        if (!injected) {
          injected = true;
          fs.appendFileSync(callerAbs, DRIFT_LINE);
          fs.chmodSync(callerAbs, 0o444);
        }
        return cg.sync();
      };

      let result: ApplyResult | undefined;
      try {
        result = await applyRename({
          queries,
          projectRoot: dir,
          selector: { name: 'widget', kind: 'function' },
          newName: 'gadget',
          lspConfig: graphOnlyLsp(dir),
          env: {},
          sync,
        });
      } finally {
        fs.chmodSync(callerAbs, 0o644); // let afterEach clean up
      }

      assertExactlyOneTerminal(result!);
      expect(result!.outcome).toBe('rollback-failed');
      const rec = result!.recovery!;
      // decl.ts restored; caller.ts (unwritable) could not be — both reported by path.
      expect(rec.restoredFiles.some((f) => f.endsWith('decl.ts'))).toBe(true);
      expect(rec.unrestoredFiles.some((f) => f.endsWith('caller.ts'))).toBe(true);
      // The unrestored snapshot is dumped byte-equal under a per-incident dir
      // (present here — `.codegraph` is writable, so the dump succeeded; the
      // recoveryDir-absent path is the separate B5 dump-failure case).
      expect(path.dirname(rec.recoveryDir!)).toBe(path.join(dir, '.codegraph'));
      expect(path.basename(rec.recoveryDir!)).toMatch(/^rename-recovery-\d+-[0-9a-f]+$/);
      const dumped = path.join(rec.recoveryDir!, rec.unrestoredFiles.find((f) => f.endsWith('caller.ts'))!);
      expect(fs.existsSync(dumped)).toBe(true);
      expect(fs.readFileSync(dumped).equals(preApplyCaller)).toBe(true);
      // rollback-failed is error-shaped ONLY: no success-shaped refusal, no dangling list.
      expect(result!.refusal).toBeUndefined();
      expect(result!.danglingReferences).toBeUndefined();
      // decl.ts (the writable touched file) WAS restored byte-identically.
      expect(shasum(declAbs)).toBe(preApplyDeclSum);
    },
  );
});

/**
 * D5 review remediation (BLOCKER) — a write-path malfunction must reach the
 * SAME rollback ladder a post-check dangle does, never escape as an uncaught
 * exception (SC-002 / FR-019 / FR-019a). Two read-only rungs run before any
 * write; Rung 4 itself writes:
 *   - Rung 3b (reverifySpans' file reads): a read error (e.g. the file is
 *     deleted between the snapshot and the reverify) previously threw
 *     uncaught. Nothing has been written yet, so the correct terminal is the
 *     SAME zero-write stale-span refusal a reverify MISMATCH already
 *     produces (treat unreadable as drifted) — never a rollback (there is
 *     nothing to roll back).
 *   - Rung 4 (writeEdits): a mid-loop write/rename error (EACCES/ENOSPC)
 *     previously unwound past rollback, leaving earlier files mutated and the
 *     snapshots discarded. It now routes through the SAME rollback(...) path
 *     the post-check-failure branch uses, carrying the cause as
 *     `ApplyResult.writeFailure` (mirrors how a dangle carries
 *     `danglingReferences`) so the caller learns WHY without a Read.
 */
describe('D5 write-path malfunctions reach the rollback ladder (FR-019/FR-019a): apply-engine.ts (real fs)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  // decl.ts sorts before sub/caller.ts (FR-027 deterministic edit order), so
  // the Rung-4 write loop always touches decl.ts FIRST (succeeds) and
  // sub/caller.ts SECOND — whose directory can be made read-only to force
  // ONLY the second file's write to fail, leaving the first genuinely mutated.
  const twoFileFixture = {
    'decl.ts': 'export function widget(): void {}\n',
    'sub/caller.ts': [
      "import { widget } from '../decl';",
      'export function useWidget(): void { widget(); }',
      '',
    ].join('\n'),
  };

  it.runIf(process.platform !== 'win32')(
    'Rung 4: a mid-loop write failure (second touched file\'s directory made read-only) → outcome rolled-back, the FIRST file restored byte-identically, the cause surfaced as writeFailure',
    async () => {
      const { dir, cg, queries } = await makeIndexedFixture(twoFileFixture).then((f) => {
        cleanups.push(f.cleanup);
        return f;
      });
      const declAbs = path.join(dir, 'decl.ts');
      const callerAbs = path.join(dir, 'sub', 'caller.ts');
      const subDir = path.join(dir, 'sub');
      const beforeDecl = shasum(declAbs);
      const beforeCaller = shasum(callerAbs);

      fs.chmodSync(subDir, 0o555); // no write — blocks the temp-sibling CREATE for caller.ts
      let result: ApplyResult | undefined;
      try {
        result = await applyRename({
          queries,
          projectRoot: dir,
          selector: { name: 'widget', kind: 'function' },
          newName: 'gadget',
          lspConfig: graphOnlyLsp(dir),
          env: {},
          sync: () => cg.sync(),
        });
      } finally {
        fs.chmodSync(subDir, 0o755); // let afterEach clean up
      }

      assertExactlyOneTerminal(result!);
      expect(result!.outcome).toBe('rolled-back');
      // Byte-identical restore of BOTH touched files: decl.ts really was
      // written and renamed-over before the failure; sub/caller.ts's write
      // never got that far, and its restore is a harmless identical rewrite.
      expect(shasum(declAbs)).toBe(beforeDecl);
      expect(shasum(callerAbs)).toBe(beforeCaller);
      expect(result!.danglingReferences).toEqual([]); // no post-check ran — the cause is the write failure, not a dangle
      expect(result!.recovery).toBeUndefined();
      expect(result!.writeFailure).toBeDefined();
      expect(result!.writeFailure!.file).toContain('caller.ts');
      expect(result!.writeFailure!.message.length).toBeGreaterThan(0);
      // No leftover temp sibling from the aborted write, in either directory.
      expect(fs.readdirSync(dir).filter((n) => n.endsWith(RENAME_TEMP_SUFFIX))).toEqual([]);
      expect(fs.readdirSync(subDir).filter((n) => n.endsWith(RENAME_TEMP_SUFFIX))).toEqual([]);
    },
  );

  it.runIf(process.platform !== 'win32')(
    'Rung 4: a mid-loop write failure whose restore ALSO fails → outcome rollback-failed, a recovery dump, the writeFailure cause still surfaced (reuses T034\'s unwritable-restore machinery)',
    async () => {
      const { dir, cg, queries } = await makeIndexedFixture(twoFileFixture).then((f) => {
        cleanups.push(f.cleanup);
        return f;
      });
      const declAbs = path.join(dir, 'decl.ts');
      const subDir = path.join(dir, 'sub');
      const preApplyDecl = fs.readFileSync(declAbs); // the snapshot oracle

      // rp-review B4 reworked this: the rollback now restores ONLY the file it
      // actually WROTE (decl.ts), never the file whose write FAILED (sub/caller.ts
      // is never restored, so its own mode is irrelevant now). To exercise the
      // restore-ALSO-fails path, make the WRITTEN file's restore fail: chmod
      // decl.ts 0o444 up front — B3 preserves that mode onto the temp-renamed
      // decl.ts, so its in-place restore hits EACCES. sub/caller.ts's write still
      // fails (subDir read-only) and remains the writeFailure cause.
      fs.chmodSync(subDir, 0o555);
      fs.chmodSync(declAbs, 0o444);

      let result: ApplyResult | undefined;
      try {
        result = await applyRename({
          queries,
          projectRoot: dir,
          selector: { name: 'widget', kind: 'function' },
          newName: 'gadget',
          lspConfig: graphOnlyLsp(dir),
          env: {},
          sync: () => cg.sync(),
        });
      } finally {
        fs.chmodSync(subDir, 0o755);
        fs.chmodSync(declAbs, 0o644);
      }

      assertExactlyOneTerminal(result!);
      expect(result!.outcome).toBe('rollback-failed');
      const rec = result!.recovery!;
      // decl.ts is the only written file and its restore failed → unrestored.
      expect(rec.unrestoredFiles.some((f) => f.endsWith('decl.ts'))).toBe(true);
      // sub/caller.ts was never written, so it is never in the rollback set at all.
      expect(rec.restoredFiles.some((f) => f.endsWith('caller.ts'))).toBe(false);
      expect(rec.unrestoredFiles.some((f) => f.endsWith('caller.ts'))).toBe(false);
      const dumped = path.join(rec.recoveryDir!, rec.unrestoredFiles.find((f) => f.endsWith('decl.ts'))!);
      expect(fs.existsSync(dumped)).toBe(true);
      expect(fs.readFileSync(dumped).equals(preApplyDecl)).toBe(true);
      // The write-failure cause survives even though the OUTCOME is now
      // rollback-failed — the restore failure is a SEPARATE malfunction from
      // the original write-failure cause that triggered the rollback.
      expect(result!.writeFailure).toBeDefined();
      expect(result!.writeFailure!.file).toContain('caller.ts');
      expect(result!.refusal).toBeUndefined();
      expect(result!.danglingReferences).toBeUndefined();
    },
  );

  // Copilot review finding (PR #44): writeEdits' catch path returned the
  // writeError result WITHOUT cleaning up a temp sibling that writeFileSync
  // had already created before renameSync threw — leaving a `.codegraph-tmp`
  // file behind. renameSync is mocked to fail for exactly the touched file's
  // target path (writeFileSync stays REAL, so a genuine temp sibling lands on
  // disk first) — a static chmod can't isolate renameSync alone from
  // writeFileSync, since POSIX rename() and file creation both need the SAME
  // directory-write permission, so there is no static permission state that
  // blocks one but not the other.
  it('Rung 4: renameSync throws AFTER the temp sibling is already written → the orphaned .codegraph-tmp file is cleaned up (Copilot review finding)', async () => {
    const { dir, cg, queries } = await makeIndexedFixture({
      'decl.ts': 'export function widget(): void {}\n',
    }).then((f) => {
      cleanups.push(f.cleanup);
      return f;
    });
    const declAbs = path.resolve(dir, 'decl.ts');

    const realFs = await vi.importActual<typeof import('fs')>('fs');
    const mockedRename = vi.mocked(fs.renameSync);
    mockedRename.mockImplementation(((...args: Parameters<typeof fs.renameSync>) => {
      // writeEdits' temp-sibling rename target is always the touched file's
      // own absolute path (the second argument) — force ONLY this rename to
      // fail, after the real writeFileSync already created the temp sibling.
      if (args[1] === declAbs) {
        throw Object.assign(new Error(`EACCES: permission denied, rename to '${declAbs}'`), { code: 'EACCES' });
      }
      return (realFs.renameSync as (...a: Parameters<typeof fs.renameSync>) => void)(...args);
    }) as typeof fs.renameSync);

    let result: ApplyResult | undefined;
    try {
      result = await applyRename({
        queries,
        projectRoot: dir,
        selector: { name: 'widget', kind: 'function' },
        newName: 'gadget',
        lspConfig: graphOnlyLsp(dir),
        env: {},
        sync: () => cg.sync(),
      });
    } finally {
      // Reset to a plain passthrough so no later test in this file inherits
      // this test's custom (rename-failing) implementation.
      mockedRename.mockImplementation(realFs.renameSync as typeof fs.renameSync);
    }

    assertExactlyOneTerminal(result!);
    expect(result!.outcome).toBe('rolled-back');
    expect(result!.writeFailure).toBeDefined();
    expect(result!.writeFailure!.file).toContain('decl.ts');
    // The temp sibling writeFileSync created before the failed rename must
    // not be left behind.
    expect(fs.readdirSync(dir).filter((n) => n.endsWith(RENAME_TEMP_SUFFIX))).toEqual([]);
  });

  it('Rung 3b: a touched file deleted AFTER takeSnapshots captures it but BEFORE reverifySpans reads it → zero writes, stale-span-shaped refusal, no throw', async () => {
    const { dir, cg, queries } = await makeIndexedFixture({
      'decl.ts': 'export function widget(): void {}\n',
    }).then((f) => {
      cleanups.push(f.cleanup);
      return f;
    });
    const declAbs = path.resolve(dir, 'decl.ts');

    const realFs = await vi.importActual<typeof import('fs')>('fs');
    let deleted = false;
    const mocked = vi.mocked(fs.readFileSync);
    mocked.mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => {
      const out = (realFs.readFileSync as (...a: Parameters<typeof fs.readFileSync>) => ReturnType<typeof fs.readFileSync>)(...args);
      // takeSnapshots' Buffer-mode read (no encoding argument) is the ONLY
      // no-encoding read of a touched file anywhere in the apply path — every
      // other read site (plan-time derivation, D4, reverify) passes 'utf8' —
      // so this fires exactly once, right after takeSnapshots captures
      // decl.ts, deleting it for real before reverify's OWN read of the same
      // path (a genuine, real ENOENT — no fake error is fabricated).
      if (!deleted && args[0] === declAbs && args[1] === undefined) {
        deleted = true;
        realFs.unlinkSync(declAbs);
      }
      return out;
    }) as typeof fs.readFileSync);

    let result: ApplyResult | undefined;
    try {
      result = await applyRename({
        queries,
        projectRoot: dir,
        selector: { name: 'widget', kind: 'function' },
        newName: 'gadget',
        lspConfig: graphOnlyLsp(dir),
        env: {},
        sync: () => cg.sync(),
      });
    } finally {
      // Reset to a plain passthrough so no later test in this file inherits
      // this test's custom (file-deleting) implementation.
      mocked.mockImplementation(realFs.readFileSync as typeof fs.readFileSync);
    }

    assertExactlyOneTerminal(result!);
    expect(result!.outcome).toBe('refused');
    expect(result!.refusal?.reason).toBe('stale-span');
    expect(result!.touchedFiles).toEqual([]);
    expect(result!.refusal?.files).toContain('decl.ts');
  });

  // Copilot review finding (PR #44): a touched file deleted between the Rung-0
  // recompute and Rung 3 (takeSnapshots) previously threw UNCAUGHT — takeSnapshots
  // itself has no injected read seam (unlike reverifySpans above), so the file is
  // made unreadable by forcing takeSnapshots' OWN read (the Buffer-mode call, no
  // encoding argument — unique to takeSnapshots; every other read site in this
  // path passes 'utf8') to fail directly, without needing to delete anything for
  // real. Nothing has been written yet, so the correct terminal is the SAME
  // zero-write stale-span refusal Rung 3b already gives an unreadable file.
  it('Rung 3: a touched file unreadable when takeSnapshots reads it (deleted after the plan was derived) → zero writes, stale-span-shaped refusal, no throw', async () => {
    const { dir, cg, queries } = await makeIndexedFixture({
      'decl.ts': 'export function widget(): void {}\n',
    }).then((f) => {
      cleanups.push(f.cleanup);
      return f;
    });
    const declAbs = path.resolve(dir, 'decl.ts');

    const realFs = await vi.importActual<typeof import('fs')>('fs');
    const mocked = vi.mocked(fs.readFileSync);
    mocked.mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => {
      if (args[0] === declAbs && args[1] === undefined) {
        const err = new Error(`ENOENT: no such file or directory, open '${declAbs}'`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        err.path = declAbs;
        throw err;
      }
      return (realFs.readFileSync as (...a: Parameters<typeof fs.readFileSync>) => ReturnType<typeof fs.readFileSync>)(...args);
    }) as typeof fs.readFileSync);

    let result: ApplyResult | undefined;
    try {
      result = await applyRename({
        queries,
        projectRoot: dir,
        selector: { name: 'widget', kind: 'function' },
        newName: 'gadget',
        lspConfig: graphOnlyLsp(dir),
        env: {},
        sync: () => cg.sync(),
      });
    } finally {
      // Reset to a plain passthrough so no later test in this file inherits
      // this test's custom (throwing) implementation.
      mocked.mockImplementation(realFs.readFileSync as typeof fs.readFileSync);
    }

    assertExactlyOneTerminal(result!);
    expect(result!.outcome).toBe('refused');
    expect(result!.refusal?.reason).toBe('stale-span');
    expect(result!.touchedFiles).toEqual([]);
    expect(result!.refusal?.files).toContain('decl.ts');
  });
});

/**
 * D5b review remediation (MAJOR) — concurrent `CodeGraph.applyRename` calls on
 * the SAME instance must serialize (the daemon serves multiple sessions; MCP
 * renames dispatch on the main instance, and the ladder interleaves at its
 * await points without a dedicated lock). A SEPARATE `Mutex` instance from
 * `indexMutex` — the ladder's injected `sync()` acquires `indexMutex` itself,
 * so reusing it would deadlock (Mutex is non-reentrant, `src/utils.ts`).
 *
 * The fixture uses two fully INDEPENDENT rename targets (no shared file, no
 * shared symbol) so BOTH calls succeed regardless of ordering — isolating the
 * assertion to PURE serialization (never overlapping in time), not correctness
 * of the outcome. `cg.sync` is instrumented with a real timer delay + an
 * order-tracking array: without a mutex the two ladders' Rung-5 re-syncs would
 * overlap (both start before either resolves); with the mutex, the second
 * ladder cannot even BEGIN its Rung-0 recompute until the first's whole
 * `applyRename` call has resolved, so the two sync calls can never interleave.
 */
describe('D5b apply mutex — concurrent applyRename calls serialize per CodeGraph instance (FR-018/FR-020)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  it("two concurrent applyRename calls on independent targets never overlap in time — the second ladder's re-sync never starts before the first fully resolves", async () => {
    const { dir, cg, cleanup } = await makeIndexedFixture({
      'a.ts': 'export function alpha(): void {}\n',
      'b.ts': 'export function beta(): void {}\n',
    });
    cleanups.push(cleanup);

    const events: string[] = [];
    const originalSync = cg.sync.bind(cg);
    let callCount = 0;
    // Own-property monkey-patch (established MCP-rename-tool pattern): a real
    // timer delay makes an UNSERIALIZED overlap observable — the second
    // ladder's sync call would fire WHILE the first's is still pending.
    (cg as unknown as { sync: typeof cg.sync }).sync = (async (...args: Parameters<typeof cg.sync>) => {
      const id = ++callCount;
      events.push(`start-${id}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const result = await originalSync(...args);
      events.push(`end-${id}`);
      return result;
    }) as typeof cg.sync;

    const [r1, r2] = await Promise.all([
      cg.applyRename({ name: 'alpha', kind: 'function' }, 'alphaRenamed'),
      cg.applyRename({ name: 'beta', kind: 'function' }, 'betaRenamed'),
    ]);

    assertExactlyOneTerminal(r1);
    assertExactlyOneTerminal(r2);
    expect(r1.outcome).toBe('applied');
    expect(r2.outcome).toBe('applied');

    // Serialized: whichever ladder's sync call fires first (id 1) always
    // fully resolves (end-1) before the OTHER ladder's sync call starts
    // (start-2) — never interleaved. This is only possible if the mutex holds
    // the WHOLE ladder (Rung 0 recompute through post-check), not merely the
    // sync sub-step.
    expect(events).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);

    // The workspace reflects BOTH renames, applied cleanly (no interleaved write).
    expect(fs.readFileSync(path.join(dir, 'a.ts'), 'utf8')).toContain('alphaRenamed');
    expect(fs.readFileSync(path.join(dir, 'b.ts'), 'utf8')).toContain('betaRenamed');
  });
});

/**
 * T035 — no-index-explosion + single-terminal atomicity (SC-010 / SC-002).
 *
 * A successful apply is a name substitution over already-indexed files: total node
 * and edge counts measured immediately BEFORE the rename equal the counts
 * immediately AFTER the post-check re-sync — the old-named node is replaced by the
 * new-named node and references re-resolve in place, never an index explosion. A
 * small all-exact cross-file fixture (declaration + import specifier + call site)
 * is the canonical happy-path apply, so no confidence opt-in is needed and the
 * equality stays a clean, deterministic assertion. `assertExactlyOneTerminal`
 * (applied across every induced outcome in this file) proves each apply resolves
 * to exactly one state.
 */
describe('T035 no-index-explosion + atomicity (SC-010/SC-002): apply-engine.ts (real SQLite)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  it('total node + edge counts are stable across a successful rename + post-check re-sync (old node replaced by new)', async () => {
    const { dir, cg, queries } = await makeIndexedFixture({
      'decl.ts': 'export function widget(): void {}\n',
      'caller.ts':
        [
          "import { widget } from './decl';",
          'export function useWidget(): void { widget(); }',
          '',
        ].join('\n'),
    }).then((f) => {
      cleanups.push(f.cleanup);
      return f;
    });

    const before = queries.getStats();
    const result = await applyRename({
      queries,
      projectRoot: dir,
      selector: { name: 'widget', kind: 'function' },
      newName: 'gadget',
      lspConfig: graphOnlyLsp(dir),
      env: {},
      sync: () => cg.sync(),
    });

    assertExactlyOneTerminal(result);
    expect(result.outcome).toBe('applied');

    const after = queries.getStats();
    // SC-010: no index explosion — a rename is a substitution, not a growth.
    expect(after.nodeCount).toBe(before.nodeCount);
    expect(after.edgeCount).toBe(before.edgeCount);
    // The old-named node is gone; the new-named node is present (replacement, not addition).
    expect(queries.getNodesByName('widget')).toEqual([]);
    expect(queries.getNodesByName('gadget').some((n) => n.kind === 'function')).toBe(true);
  });
});

// =============================================================================
// T042 — CLI `codegraph rename … --apply` (built binary; FR-014/FR-015/FR-018/
// FR-026; contracts/cli-rename.md). Slice-2 adds `--apply` (recompute + execute
// the safety ladder) and `--include-heuristic` (confidence-gate escape). Exercised
// end-to-end through dist/bin/codegraph.js against a real indexed fixture, LSP env
// scrubbed so the deterministic graph path drives both surfaces. Each apply test
// mutates its OWN fixture (isolated). The rolled-back (exit 3) / rollback-failed
// (exit 4) terminals are impractical to induce through a subprocess (they need a
// mid-apply drift / a read-only touched file); they are covered at the engine level
// (T034) plus the exported ApplyResult→exit-code mapper unit test below.
// -----------------------------------------------------------------------------
describe('T042 CLI --apply — codegraph rename (built binary, FR-014/FR-015/FR-026)', () => {
  const BIN = path.resolve(__dirname, '../dist/bin/codegraph.js');
  const cliCleanups: Array<() => void> = [];
  let childEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    if (!fs.existsSync(BIN)) {
      throw new Error(`Build the project first: ${BIN} is missing (run npm run build).`);
    }
    // Force the graph path (LSP env scrubbed) so the CLI apply is deterministic and
    // matches the in-process engine tests above (SC-005). NO_DAEMON keeps the write
    // + re-sync in the invoked process; WASM_RELAUNCHED skips the startup re-exec.
    for (const k of Object.keys(process.env)) if (k.startsWith('CODEGRAPH_LSP')) delete process.env[k];
    childEnv = { ...process.env, CODEGRAPH_NO_DAEMON: '1', CODEGRAPH_WASM_RELAUNCHED: '1' };
  });

  afterEach(() => {
    for (const fn of cliCleanups.splice(0)) fn();
  });

  /** Build + index a writable fixture dir on disk (each `--apply` test mutates its own). */
  async function makeCliFixture(files: Record<string, string>): Promise<string> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-apply-cli-'));
    cliCleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    cg.close();
    return dir;
  }

  /** Run `codegraph rename <args> -p <projectPath>` against the built binary. */
  function runRename(args: string[], projectPath: string): { status: number | null; stdout: string; stderr: string } {
    const res = spawnSync(process.execPath, [BIN, 'rename', ...args, '-p', projectPath], {
      encoding: 'utf-8',
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
  }

  // Cross-file decl + import + call → an all-`exact` plan (import binding is exact).
  const EXACT_FIXTURE: Record<string, string> = {
    'decl.ts': 'export function widget(): void {}\n',
    'caller.ts': ["import { widget } from './decl';", 'export function consume(): void { widget(); }', ''].join('\n'),
  };

  // Single-file intra-call → a `contains-heuristic` plan (a same-file name match is
  // heuristic, unlike a cross-file import binding — the FR-004 tier split).
  const HEURISTIC_FIXTURE: Record<string, string> = {
    'lib.ts': ['function widget(): number { return 1; }', 'export function consume(): number { return widget(); }', ''].join('\n'),
  };

  it('the rename command help advertises --apply in its description (C7 — the command is not dry-run-only)', () => {
    // The command accepts --apply (below), so its one-line description must not
    // claim "(no files are written)" — that misleads a user reading `--help`.
    const res = spawnSync(process.execPath, [BIN, 'rename', '--help'], {
      encoding: 'utf-8',
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const help = res.stdout ?? '';
    expect(help).toContain('Preview a graph-aware rename as a dry-run plan; pass --apply to execute it');
    expect(help).not.toContain('(no files are written)');
  });

  it('--apply on an all-exact plan rewrites the files on disk, re-syncs the index, exits 0 (FR-014/FR-018/FR-026)', async () => {
    const dir = await makeCliFixture(EXACT_FIXTURE);
    const res = runRename(['widget', 'gadget', '--kind', 'function', '--apply'], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('applied');
    expect(res.stderr).not.toMatch(/\n\s+at /); // never an error-shaped stack trace

    // The files are actually rewritten on disk — new name present, old name gone.
    const decl = fs.readFileSync(path.join(dir, 'decl.ts'), 'utf8');
    const caller = fs.readFileSync(path.join(dir, 'caller.ts'), 'utf8');
    expect(decl).toContain('gadget');
    expect(decl).not.toMatch(/\bwidget\b/);
    expect(caller).toContain('gadget'); // both the import specifier AND the call site
    expect(caller).not.toMatch(/\bwidget\b/);

    // Index re-synced (FR-018): re-open and confirm the graph now knows only the new name.
    const cg = await CodeGraph.open(dir);
    try {
      expect(cg.getNodesByName('widget')).toEqual([]);
      expect(cg.getNodesByName('gadget').some((n) => n.kind === 'function')).toBe(true);
    } finally {
      cg.close();
    }
  });

  it('--apply on a heuristic-containing plan WITHOUT --include-heuristic refuses (heuristic-gated), exits 2, writes nothing (FR-015)', async () => {
    const dir = await makeCliFixture(HEURISTIC_FIXTURE);
    const before = fs.readFileSync(path.join(dir, 'lib.ts'), 'utf8');

    // Fixture sanity: the recomputed plan is genuinely contains-heuristic — otherwise
    // the gate would be vacuously "passed" by an all-exact plan.
    const dry = runRename(['widget', 'gadget', '--kind', 'function', '--json'], dir);
    expect(dry.status).toBe(0);
    expect(JSON.parse(dry.stdout).confidence).toBe('contains-heuristic');

    const res = runRename(['widget', 'gadget', '--kind', 'function', '--apply'], dir);
    expect(res.status).toBe(2); // recoverable refusal, NOT the generic exit 1
    expect(res.stdout).toContain('heuristic-gated'); // names the gate reason
    expect(res.stdout).toContain('gated edits'); // lists the below-exact edit(s)
    expect(res.stderr).not.toMatch(/\n\s+at /);
    expect(fs.readFileSync(path.join(dir, 'lib.ts'), 'utf8')).toBe(before); // zero writes
  });

  it('--apply --include-heuristic on the same plan applies the heuristic edits, exits 0 (FR-015)', async () => {
    const dir = await makeCliFixture(HEURISTIC_FIXTURE);
    const res = runRename(['widget', 'gadget', '--kind', 'function', '--apply', '--include-heuristic'], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('applied');
    const lib = fs.readFileSync(path.join(dir, 'lib.ts'), 'utf8');
    expect(lib).toContain('gadget');
    expect(lib).not.toMatch(/\bwidget\b/); // the declaration AND the intra-call are rewritten
  });

  // D4 / S2-C — the quickstart repro: index a fixture, mutate a candidate
  // reference file on disk WITHOUT re-syncing (spans drift), then `--apply`.
  // Before the fix, the recomputed plan (FR-014) silently dropped the drifted
  // edit and applied the rest — a partially-renamed workspace, exit 0. The fix
  // refuses the WHOLE apply at the plan-recompute step (Rung 0), writing nothing.
  it('D4/S2-C: a candidate reference file that drifted since the last index refuses the WHOLE apply (stale-span), exits 2, writes NOTHING (shasum + mtime verified)', async () => {
    const dir = await makeCliFixture(EXACT_FIXTURE);
    const declPath = path.join(dir, 'decl.ts');
    const callerPath = path.join(dir, 'caller.ts');
    const declShaBefore = shasum(declPath);
    const declMtimeBefore = fs.statSync(declPath).mtimeMs;

    // Drift caller.ts WITHOUT a re-sync: a line inserted above shifts every span
    // the index recorded for its import specifier + call site (S2-C repro).
    const callerBeforeDrift = fs.readFileSync(callerPath, 'utf8');
    fs.writeFileSync(callerPath, '// unrelated drift\n' + callerBeforeDrift);
    const callerShaAfterDrift = shasum(callerPath);
    const callerMtimeAfterDrift = fs.statSync(callerPath).mtimeMs;

    const res = runRename(['widget', 'gadget', '--kind', 'function', '--apply'], dir);
    expect(res.status).toBe(2); // recoverable refusal, NOT the generic exit 1, NOT exit 0
    expect(res.stdout).toContain('stale-span');
    expect(res.stdout).toMatch(/codegraph sync/);
    expect(res.stdout).toContain('caller.ts');
    expect(res.stderr).not.toMatch(/\n\s+at /); // success-shaped, never a stack trace

    // ZERO writes: decl.ts untouched (shasum + mtime unchanged); caller.ts left
    // EXACTLY as drifted — not reverted, not further mutated by the refused apply.
    expect(shasum(declPath)).toBe(declShaBefore);
    expect(fs.statSync(declPath).mtimeMs).toBe(declMtimeBefore);
    expect(shasum(callerPath)).toBe(callerShaAfterDrift);
    expect(fs.statSync(callerPath).mtimeMs).toBe(callerMtimeAfterDrift);
  });
});

// =============================================================================
// T042 — the exported ApplyResult→exit-code mapper (FR-026). The four apply
// terminals map to distinct process codes; the CLI action turns an outcome into an
// exit code through this one pure seam. Pinned directly so `rolled-back` (3) and
// `rollback-failed` (4) — impractical to force through a CLI subprocess — have
// deterministic coverage alongside the engine-level T034 inducement.
// -----------------------------------------------------------------------------
describe('T042 ApplyResult → exit-code mapper — renameApplyExitCode (FR-026)', () => {
  it('maps every ApplyOutcome to its FR-026 exit code (applied→0, refused→2, rolled-back→3, rollback-failed→4)', () => {
    expect(renameApplyExitCode('applied')).toBe(0);
    expect(renameApplyExitCode('refused')).toBe(2);
    expect(renameApplyExitCode('rolled-back')).toBe(3);
    expect(renameApplyExitCode('rollback-failed')).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// R8 (rp-review B1) — a THROW from the post-write section (the injected
// re-sync, or the post-check) must not escape with renamed files left on disk
// (the taxonomy's worst un-modeled state). The engine restores every touched
// file byte-identically first; if the restore fully succeeds it RETHROWS the
// original error (the workspace is clean, so the CLI's exit-1 internal-error
// path is honest); if the restore itself fails it returns `rollback-failed`.
// Real SQLite (T034 fixture); the throw is injected via the `sync` option and a
// queries proxy that throws from the post-check probe.
// ---------------------------------------------------------------------------
describe('R8 post-write throws reach rollback (FR-019): apply-engine.ts', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  const fixture = {
    'decl.ts': 'export function widget(): void {}\n',
    'caller.ts': ["import { widget } from './decl';", 'export function useWidget(): void { widget(); }', ''].join('\n'),
  };

  it('a THROWING re-sync (Rung 5) → files restored byte-identically, the call rejects (original error rethrown)', async () => {
    const { dir, queries, cleanup } = await makeIndexedFixture(fixture);
    cleanups.push(cleanup);
    const declAbs = path.join(dir, 'decl.ts');
    const callerAbs = path.join(dir, 'caller.ts');
    const beforeDecl = shasum(declAbs);
    const beforeCaller = shasum(callerAbs);

    await expect(
      applyRename({
        queries,
        projectRoot: dir,
        selector: { name: 'widget', kind: 'function' },
        newName: 'gadget',
        lspConfig: graphOnlyLsp(dir),
        env: {},
        sync: async () => {
          throw new Error('re-sync boom');
        },
      }),
    ).rejects.toThrow('re-sync boom');

    // The write happened, then was undone byte-identically — no half-renamed workspace.
    expect(shasum(declAbs)).toBe(beforeDecl);
    expect(shasum(callerAbs)).toBe(beforeCaller);
    expect(fs.readdirSync(dir).filter((n) => n.endsWith(RENAME_TEMP_SUFFIX))).toEqual([]);
  });

  it('a THROWING post-check (Rung 5b) → files restored byte-identically, the call rejects (original error rethrown)', async () => {
    const { dir, cg, queries, cleanup } = await makeIndexedFixture(fixture);
    cleanups.push(cleanup);
    const declAbs = path.join(dir, 'decl.ts');
    const callerAbs = path.join(dir, 'caller.ts');
    const beforeDecl = shasum(declAbs);
    const beforeCaller = shasum(callerAbs);

    // A queries proxy that throws ONLY from the post-check's unresolved-refs probe
    // (planRename's Rung-0 recompute never calls it, so the plan still derives).
    const throwingQueries = new Proxy(queries, {
      get(target, prop, receiver) {
        if (prop === 'getUnresolvedRefsByNameInFiles') {
          return () => {
            throw new Error('post-check boom');
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }) as QueryBuilder;

    await expect(
      applyRename({
        queries: throwingQueries,
        projectRoot: dir,
        selector: { name: 'widget', kind: 'function' },
        newName: 'gadget',
        lspConfig: graphOnlyLsp(dir),
        env: {},
        sync: () => cg.sync(),
      }),
    ).rejects.toThrow('post-check boom');

    expect(shasum(declAbs)).toBe(beforeDecl);
    expect(shasum(callerAbs)).toBe(beforeCaller);
    expect(fs.readdirSync(dir).filter((n) => n.endsWith(RENAME_TEMP_SUFFIX))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R9 (rp-review B2) — rollback()'s OWN post-restore re-sync can fail (its
// injected sync throws or returns the lock-failure zero-shape) AFTER the bytes
// were already restored. That must still report `rolled-back` (the workspace IS
// restored), but flag `resyncFailed: true` so the caller knows the index no
// longer matches the restored bytes, and the human table must instruct
// `codegraph sync`. Real SQLite (T034 fixture); a post-check dangle forces the
// rollback, and the 2nd sync call (rollback's re-sync) is the one made to fail.
// ---------------------------------------------------------------------------
describe('R9 rollback re-sync failure → resyncFailed (FR-019): apply-engine.ts', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  const fixture = {
    'decl.ts': 'export function widget(): void {}\n',
    'caller.ts': ["import { widget } from './decl';", 'export function useWidget(): void { widget(); }', ''].join('\n'),
  };
  const DRIFT_LINE = 'export function drift(): void { widget(); }\n';

  it('a post-check dangle forces rollback, then the rollback re-sync throws → outcome rolled-back, resyncFailed:true, table says codegraph sync', async () => {
    const { dir, cg, queries, cleanup } = await makeIndexedFixture(fixture);
    cleanups.push(cleanup);
    const declAbs = path.join(dir, 'decl.ts');
    const callerAbs = path.join(dir, 'caller.ts');
    const beforeDecl = shasum(declAbs);
    const beforeCaller = shasum(callerAbs);

    // 1st sync (Rung 5): inject the drift + real sync (→ completed, post-check
    // then finds the dangle). 2nd sync (rollback's re-sync): throw.
    let calls = 0;
    const sync = async (): Promise<SyncResult> => {
      calls += 1;
      if (calls === 1) {
        fs.appendFileSync(callerAbs, DRIFT_LINE);
        return cg.sync();
      }
      throw new Error('rollback re-sync boom');
    };

    const result = await applyRename({
      queries,
      projectRoot: dir,
      selector: { name: 'widget', kind: 'function' },
      newName: 'gadget',
      lspConfig: graphOnlyLsp(dir),
      env: {},
      sync,
    });

    assertExactlyOneTerminal(result);
    expect(result.outcome).toBe('rolled-back');
    expect(result.resyncFailed).toBe(true);
    // Bytes ARE restored despite the re-sync failure.
    expect(shasum(declAbs)).toBe(beforeDecl);
    expect(shasum(callerAbs)).toBe(beforeCaller);
    // The human table tells the user the index re-sync failed and to run codegraph sync.
    const table = formatApplyResultTable(result, 'gadget');
    expect(table).toMatch(/codegraph sync/);
  });
});

// ---------------------------------------------------------------------------
// R10 (rp-review B3) — writeEdits' temp-sibling → atomic-rename must PRESERVE
// the target file's permission bits. The temp is created 0o600 (CodeQL
// js/insecure-temporary-file sink stays closed) and renamed over the target, so
// the renamed file would inherit 0o600 — silently stripping exec bits (0o755
// scripts) and group/world read (0o644). Fix: statSync the target's mode first,
// chmod the temp to it just before renameSync. POSIX-gated (Windows has no
// POSIX mode bits). Real fs via writeEdits directly (T032 mkEdit helper).
// ---------------------------------------------------------------------------
describe('R10 writeEdits preserves file permission bits (rp-review B3): snapshot.ts (real fs)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-rename-mode-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const DECL = 'export function widget() {}';
  const col = DECL.indexOf('widget');

  it.runIf(process.platform !== 'win32')('a 0o755 (executable) file keeps its exec bits after writeEdits', () => {
    const abs = path.join(root, 's.ts');
    fs.writeFileSync(abs, DECL + '\n');
    fs.chmodSync(abs, 0o755);
    const res = writeEdits({ projectRoot: root, editsByFile: new Map([['s.ts', [mkEdit('s.ts', 1, col, 'widget', 'gadget', DECL)]]]) });
    expect(res).toEqual({ ok: true, writtenFiles: ['s.ts'] });
    expect(fs.readFileSync(abs, 'utf8')).toBe('export function gadget() {}\n'); // the edit applied
    expect(fs.statSync(abs).mode & 0o777).toBe(0o755); // exec bits preserved, not stripped to 0o600
  });

  it.runIf(process.platform !== 'win32')('a 0o644 file stays 0o644 after writeEdits', () => {
    const abs = path.join(root, 's.ts');
    fs.writeFileSync(abs, DECL + '\n');
    fs.chmodSync(abs, 0o644);
    writeEdits({ projectRoot: root, editsByFile: new Map([['s.ts', [mkEdit('s.ts', 1, col, 'widget', 'gadget', DECL)]]]) });
    expect(fs.statSync(abs).mode & 0o777).toBe(0o644);
  });
});

// ---------------------------------------------------------------------------
// R11 (rp-review B4) — on a mid-loop write failure, the engine must roll back
// ONLY the files it actually wrote, not the whole snapshot map (which would
// clobber a concurrent external modification to a not-yet-written file). The
// writeError result now carries `writtenFiles` (the files fully renamed before
// the failure); the engine rolls back exactly those and reports them as
// `touchedFiles`. Real fs; the SECOND file's write fails (its directory made
// read-only), so only the FIRST was written. POSIX-gated (chmod). Reuses the D5
// two-file fixture shape (decl.ts sorts before sub/caller.ts).
// ---------------------------------------------------------------------------
describe('R11 partial-write rollback is scoped to written files (rp-review B4): apply-engine.ts', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  const twoFileFixture = {
    'decl.ts': 'export function widget(): void {}\n',
    'sub/caller.ts': ["import { widget } from '../decl';", 'export function useWidget(): void { widget(); }', ''].join('\n'),
  };

  it.runIf(process.platform !== 'win32')(
    'the SECOND file\'s write fails → only the FIRST (written) file is rolled back; touchedFiles is just the written file',
    async () => {
      const { dir, cg, queries, cleanup } = await makeIndexedFixture(twoFileFixture);
      cleanups.push(cleanup);
      const callerAbs = path.join(dir, 'sub', 'caller.ts');
      const subDir = path.join(dir, 'sub');
      const beforeCaller = shasum(callerAbs);

      fs.chmodSync(subDir, 0o555); // blocks the temp-sibling CREATE for caller.ts (2nd write)
      let result: ApplyResult | undefined;
      try {
        result = await applyRename({
          queries,
          projectRoot: dir,
          selector: { name: 'widget', kind: 'function' },
          newName: 'gadget',
          lspConfig: graphOnlyLsp(dir),
          env: {},
          sync: () => cg.sync(),
        });
      } finally {
        fs.chmodSync(subDir, 0o755);
      }

      assertExactlyOneTerminal(result!);
      expect(result!.outcome).toBe('rolled-back');
      // touchedFiles is exactly the file that was actually written (decl.ts) —
      // NOT the never-written second file whose snapshot would otherwise be
      // clobbered over any concurrent external edit.
      expect(result!.touchedFiles).toEqual(['decl.ts']);
      expect(result!.touchedFiles).not.toContain('sub/caller.ts');
      // The never-written second file's live bytes are untouched by the rollback.
      expect(shasum(callerAbs)).toBe(beforeCaller);
      expect(result!.writeFailure!.file).toContain('caller.ts');
    },
  );
});

// ---------------------------------------------------------------------------
// R12 (rp-review B5) — when a restore fails AND the recovery-dir dump itself
// also fails (the same ENOSPC/EPERM that broke the restore), restoreSnapshots
// must not let the dump's mkdir/write THROW out of rollback() with no modeled
// outcome. It returns the rollback-failed shape with `recoveryDir` ABSENT (the
// unrestored files still need manual attention, but no dump was written), and
// the human table renders that gracefully. Real SQLite (T034 machinery) with
// `.codegraph` made read-only so the dump mkdir fails. POSIX-gated.
// ---------------------------------------------------------------------------
describe('R12 recovery-dump failure is structured, not thrown (rp-review B5): apply-engine.ts', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  const fixture = {
    'decl.ts': 'export function widget(): void {}\n',
    'caller.ts': ["import { widget } from './decl';", 'export function useWidget(): void { widget(); }', ''].join('\n'),
  };
  const DRIFT_LINE = 'export function drift(): void { widget(); }\n';

  it.runIf(process.platform !== 'win32')(
    'a failed restore whose recovery dump ALSO fails → rollback-failed with recoveryDir undefined, no throw; table handles the missing dir',
    async () => {
      const { dir, cg, queries, cleanup } = await makeIndexedFixture(fixture);
      cleanups.push(cleanup);
      const callerAbs = path.join(dir, 'caller.ts');
      const codegraphDir = path.join(dir, '.codegraph');

      // 1st sync (Rung 5): inject the drift, make caller.ts unwritable (its
      // restore fails), run the real sync (DB still writable), THEN make
      // `.codegraph` read-only so the subsequent recovery dump's mkdir fails.
      let injected = false;
      const sync = async (): Promise<SyncResult> => {
        if (!injected) {
          injected = true;
          fs.appendFileSync(callerAbs, DRIFT_LINE);
          fs.chmodSync(callerAbs, 0o444);
          const r = await cg.sync();
          fs.chmodSync(codegraphDir, 0o555); // dump target now unwritable
          return r;
        }
        return cg.sync();
      };

      let result: ApplyResult | undefined;
      let threw: unknown = null;
      try {
        result = await applyRename({
          queries,
          projectRoot: dir,
          selector: { name: 'widget', kind: 'function' },
          newName: 'gadget',
          lspConfig: graphOnlyLsp(dir),
          env: {},
          sync,
        });
      } catch (e) {
        threw = e;
      } finally {
        fs.chmodSync(codegraphDir, 0o755);
        fs.chmodSync(callerAbs, 0o644);
      }

      expect(threw).toBeNull(); // structured, never an uncaught throw
      assertExactlyOneTerminal(result!);
      expect(result!.outcome).toBe('rollback-failed');
      expect(result!.recovery!.unrestoredFiles.some((f) => f.endsWith('caller.ts'))).toBe(true);
      expect(result!.recovery!.recoveryDir).toBeUndefined(); // dump failed → no dir
      // The human table renders without a bogus "recovery dir: undefined" line.
      const table = formatApplyResultTable(result!, 'gadget');
      expect(table).not.toMatch(/recovery dir: undefined/);
      expect(table).toMatch(/rollback-failed/);
      // C6: the guidance is actionable — the dump-failed path names the files for
      // manual attention + re-sync, never the old impossible standalone-restore line.
      expect(table).toMatch(/manual attention/i);
      expect(table).toContain('Do NOT re-run the rename.');
      expect(table).not.toContain('Retrying the restore step alone is safe');
    },
  );
});

// ---------------------------------------------------------------------------
// R13 (rp-review B6) — the FR-018 post-check must catch a QUALIFIED dangling
// reference. A dotted/scoped dangle (`util.oldName`, `Mod::oldName`) keeps its
// dotted `reference_name`, but its `name_tail` column holds the last segment
// (`oldName`) — written when the ref is marked failed (the state a genuine
// dangle is in after the resolution-complete re-sync). getUnresolvedRefsByNameInFiles
// matched `reference_name = ?` exactly, so it MISSED the qualified dangle and the
// post-check passed despite it. Widened to `(reference_name = ? OR name_tail = ?)`.
// Real SQLite: a real unresolved_refs row, marked failed so name_tail is set.
// ---------------------------------------------------------------------------
describe('R13 qualified dangling references are caught by the post-check (rp-review B6): queries.ts', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  it('a failed unresolved_refs row with reference_name "util.oldName" / name_tail "oldName" is reported when the post-check scans for "oldName"', async () => {
    const { queries, cleanup } = await makeIndexedFixture({ 'mod.ts': 'export function host(): void {}\n' });
    cleanups.push(cleanup);
    const host = queries.getNodesByName('host').find((n) => n.kind === 'function')!;
    const filePath = host.filePath; // relative, in the touched set

    // A genuine QUALIFIED dangle: reference_name keeps its dotted form, but after
    // markReferencesFailed the name_tail column holds the last segment.
    queries.insertUnresolvedRef({
      fromNodeId: host.id,
      referenceName: 'util.oldName',
      referenceKind: 'calls',
      line: 1,
      column: 0,
      filePath,
      language: 'typescript',
    });
    queries.markReferencesFailed([{ fromNodeId: host.id, referenceName: 'util.oldName', referenceKind: 'calls' }]);

    // Sanity: the bare-name exact match does NOT find it (it's dotted)…
    expect(queries.getUnresolvedRefsByNameInFiles('oldName', [filePath]).length).toBeGreaterThanOrEqual(0);

    // …but the post-check (scanning for the renamed-away bare name) MUST report it.
    const res = runPostCheck({ queries, oldName: 'oldName', touchedFiles: [filePath] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.danglingReferences.some((d) => d.file === filePath && d.name === 'oldName')).toBe(true);
    }
  });
});
