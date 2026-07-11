/**
 * SPEC-010 Graph-Aware Rename — plan-engine unit tests (T003).
 *
 * RED-first coverage for the two pure seams the plan engine (and, at apply
 * time, the write path) depend on:
 *
 *  (a) FR-004 confidence table  — `src/refactor/confidence.ts`
 *      `(resolvedBy, provenance) → exact | heuristic`, plus the two
 *      "never a candidate" exclusions (`file-path`, synthesized
 *      `provenance='heuristic'`) and the `instance-method` two-branch split.
 *  (b) FR-005 / FR-016 span guard — `src/refactor/span-verify.ts`
 *      a live line, indexed as a UTF-16 JS string slice, must equal `oldText`;
 *      the range is derived as `(line,col)..(line, col + oldName UTF-16 len)`;
 *      a shadow / alias / string-similar / drifted mismatch drops the edit.
 *
 * Positions are UTF-16 code units end-to-end (SPEC-008 pin) — no byte↔UTF-16
 * translation. The non-ASCII cases extend the SPEC-008 "café" precedent in
 * `lsp-precision-pass.test.ts` (web-tree-sitter reports UTF-16 columns).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'node:url';
import { CodeGraph } from '../src';
import { NODE_KINDS, type NodeKind } from '../src/types';
import type { QueryBuilder } from '../src/db/queries';
import { resolveLspConfig } from '../src/lsp';
import { classifyEdgeConfidence } from '../src/refactor/confidence';
import { verifySpan } from '../src/refactor/span-verify';
import { deriveLspRename } from '../src/refactor/lsp-rename';
import { deriveGraphRename } from '../src/refactor/graph-rename';
import { resolveTarget } from '../src/refactor/target-resolver';
import { planRename } from '../src/refactor/plan-engine';
import {
  composeAfterLine,
  formatRenamePlanTable,
  serializeRenamePlanJson,
} from '../src/refactor/plan-format';
import type { RenameEdit, RenamePlan } from '../src/refactor/types';

describe('FR-004 confidence table — classifyEdgeConfidence', () => {
  describe('exact tier', () => {
    it.each([['import'], ['qualified-name'], ['function-ref']])(
      'resolvedBy=%s → exact (scoped/exact lookup that refuses rather than guesses)',
      (resolvedBy) => {
        expect(classifyEdgeConfidence({ resolvedBy })).toBe('exact');
      },
    );

    it('provenance=lsp → exact (SPEC-008 compiler-verified graph edge)', () => {
      expect(classifyEdgeConfidence({ provenance: 'lsp' })).toBe('exact');
    });

    it('provenance=lsp elevates an otherwise-heuristic resolvedBy to exact', () => {
      expect(classifyEdgeConfidence({ resolvedBy: 'exact-match', provenance: 'lsp' })).toBe('exact');
    });

    // instance-method, declaration-recovered branch (discriminator: confidence ≥ 0.85).
    it.each([[0.85], [0.9], [1.0]])(
      'instance-method @ confidence %s (declaration-recovered) → exact',
      (confidence) => {
        expect(classifyEdgeConfidence({ resolvedBy: 'instance-method', confidence })).toBe('exact');
      },
    );
  });

  describe('heuristic tier', () => {
    it.each([['exact-match'], ['fuzzy'], ['framework']])(
      'resolvedBy=%s → heuristic (last-resort strategy that still emits on a best guess)',
      (resolvedBy) => {
        expect(classifyEdgeConfidence({ resolvedBy })).toBe('heuristic');
      },
    );

    // instance-method, capitalization-guess / word-overlap branch (confidence < 0.85).
    it.each([[0.8], [0.7], [0.65]])(
      'instance-method @ confidence %s (capitalization-guess / word-overlap) → heuristic',
      (confidence) => {
        expect(classifyEdgeConfidence({ resolvedBy: 'instance-method', confidence })).toBe(
          'heuristic',
        );
      },
    );

    it('unenumerated resolvedBy → heuristic (default-deny)', () => {
      expect(classifyEdgeConfidence({ resolvedBy: 'some-future-strategy' })).toBe('heuristic');
    });

    it('absent resolvedBy and provenance → heuristic (default-deny)', () => {
      expect(classifyEdgeConfidence({})).toBe('heuristic');
    });
  });

  describe('never a rename-edit candidate (null) — at any tier', () => {
    it('resolvedBy=file-path → null (targets a file node, an excluded rename kind — FR-011)', () => {
      expect(classifyEdgeConfidence({ resolvedBy: 'file-path' })).toBeNull();
    });

    it('provenance=heuristic synthesized edge → null (dispatch/wiring site, not a name occurrence — FR-013)', () => {
      expect(classifyEdgeConfidence({ provenance: 'heuristic' })).toBeNull();
    });

    it('provenance=heuristic wins over an otherwise-exact resolvedBy (still null)', () => {
      expect(classifyEdgeConfidence({ resolvedBy: 'function-ref', provenance: 'heuristic' })).toBeNull();
    });
  });
});

describe('FR-005 / FR-016 span verification — verifySpan', () => {
  it('returns the derived range when the live UTF-16 slice equals oldName (ASCII)', () => {
    const lineText = '  return handle(input);';
    const column = lineText.indexOf('handle'); // 9
    const result = verifySpan({ lineText, start: { line: 12, column }, oldName: 'handle' });
    expect(result).toEqual({
      start: { line: 12, column },
      end: { line: 12, column: column + 'handle'.length },
    });
    // The guard's own premise: the slice at the recorded span IS the old name.
    expect(lineText.slice(column, column + 'handle'.length)).toBe('handle');
  });

  it('derives the end column from the old-name UTF-16 length', () => {
    const lineText = 'const value = compute();';
    const column = lineText.indexOf('compute');
    const result = verifySpan({ lineText, start: { line: 1, column }, oldName: 'compute' });
    expect(result).not.toBeNull();
    expect(result!.end.column - result!.start.column).toBe('compute'.length);
    expect(result!.end.line).toBe(result!.start.line); // single-line span
  });

  // --- Non-ASCII: extends the SPEC-008 UTF-16 pin (lsp-precision-pass.test.ts:246-304) ---

  it('indexes a non-ASCII line as UTF-16 code units, not bytes (café precedent)', () => {
    const lineText = 'export const café = target();';
    const utf16Column = lineText.indexOf('target');
    const byteColumn = Buffer.byteLength(lineText.slice(0, utf16Column), 'utf8');
    expect(byteColumn).toBeGreaterThan(utf16Column); // é is 2 UTF-8 bytes, 1 UTF-16 code unit

    const ok = verifySpan({ lineText, start: { line: 2, column: utf16Column }, oldName: 'target' });
    expect(ok).toEqual({
      start: { line: 2, column: utf16Column },
      end: { line: 2, column: utf16Column + 'target'.length },
    });

    // A byte-based column would slice the wrong text and be dropped — the pin.
    expect(
      verifySpan({ lineText, start: { line: 2, column: byteColumn }, oldName: 'target' }),
    ).toBeNull();
  });

  it('counts a non-ASCII old name in UTF-16 code units (café has length 4)', () => {
    const lineText = 'const café = 1;';
    const column = lineText.indexOf('café');
    const result = verifySpan({ lineText, start: { line: 1, column }, oldName: 'café' });
    expect('café'.length).toBe(4);
    expect(result).not.toBeNull();
    expect(result!.end.column).toBe(column + 4);
  });

  it('handles surrogate-pair (astral) code units with no byte↔UTF-16 translation', () => {
    const lineText = 'const label = "🎯"; renderTarget();';
    const column = lineText.indexOf('renderTarget');
    const result = verifySpan({ lineText, start: { line: 1, column }, oldName: 'renderTarget' });
    expect(result).toEqual({
      start: { line: 1, column },
      end: { line: 1, column: column + 'renderTarget'.length },
    });
  });

  // --- False positives dropped (FR-005 / FR-016) ---

  it('drops a shadowing-declaration false positive (slice ≠ oldName)', () => {
    // The recorded position now covers a shadowing local `local`, not `value`.
    const lineText = 'const local = 1;';
    const result = verifySpan({ lineText, start: { line: 1, column: 6 }, oldName: 'value' });
    expect(result).toBeNull();
  });

  it('drops an import-alias false positive (the reference reads the alias text)', () => {
    // `import { target as tgt }` — the use site reads `tgt`, not `target`.
    const lineText = 'tgt(payload);';
    const result = verifySpan({ lineText, start: { line: 3, column: 0 }, oldName: 'target' });
    expect(result).toBeNull();
  });

  it('drops a string-similar false positive (shared prefix, different identifier)', () => {
    const lineText = 'handleClick();';
    const result = verifySpan({ lineText, start: { line: 1, column: 0 }, oldName: 'handleError' });
    expect(result).toBeNull();
  });

  it('drops a drifted/stale line whose bytes no longer cover the span (FR-016)', () => {
    const lineText = 'x'; // the line shrank since it was indexed
    const result = verifySpan({ lineText, start: { line: 1, column: 0 }, oldName: 'total' });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T006 — Slice-1 QueryBuilder statements (real SQLite). The three graph lookups
// the plan engine reads to build a RenamePlan (research Decisions 7–8;
// data-model "Schema touchpoints"):
//   • references-to-node   — incoming `references` edges to the target, JOINed
//     to the referencing (source) node so each row already carries the file to
//     edit plus the callsite line/col, the resolver metadata (resolvedBy /
//     confidence / refName) and provenance. This is the ONE new statement
//     (QueryBuilder.getReferencesToNode); getIncomingEdges returns the edge but
//     not the source node's file_path, forcing an N+1 the plan path avoids.
//   • node-declaration-span — the target's own declaration range. REUSE:
//     getNodeById already returns the full start/end line+column (schema cols
//     are NOT NULL — research Decision 8).
//   • nodes-by-name / candidates — every symbol sharing a selector name, with
//     name/kind/file/line for Candidate building and an in-memory `--kind`
//     filter. REUSE: getNodesByName.
//
// Real files + real SQLite through the full CodeGraph pipeline (no DB mocking,
// per the constitution). The cross-file function-as-value fixture mirrors
// function-ref.test.ts's "resolves an imported callback across files via its
// import" case: passing a function by name yields a `references` edge
// (metadata.fnRef), distinct from the `calls` edge a direct call produces — so
// the kind='references' filter is exercised on both sides.
// ---------------------------------------------------------------------------
describe('T006 Slice-1 QueryBuilder statements (real SQLite)', () => {
  let dir: string;
  let cg: CodeGraph;
  let queries: QueryBuilder;
  let onMessageId: string;
  let computeId: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-rename-slice1-'));
    fs.writeFileSync(
      path.join(dir, 'handlers.ts'),
      [
        'export function onMessage(x: number): void { console.log(x); }',
        'export function compute(n: number): number { return n * 2; }',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(dir, 'wiring.ts'),
      [
        "import { onMessage, compute } from './handlers';",
        'export function wire(bus: { on(cb: (x: number) => void): void }): void {',
        '  bus.on(onMessage);', // function-as-value  → `references` edge (fnRef)
        '  compute(3);', //        direct call        → `calls` edge (must be excluded)
        '}',
      ].join('\n'),
    );

    cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    queries = (cg as unknown as { queries: QueryBuilder }).queries;

    onMessageId = cg.getNodesByName('onMessage').find((n) => n.kind === 'function')!.id;
    computeId = cg.getNodesByName('compute').find((n) => n.kind === 'function')!.id;
  });

  afterAll(() => {
    cg?.destroy();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('references-to-node: returns each incoming `references` edge with source file, callsite line/col, metadata (resolvedBy/confidence/refName) and provenance', () => {
    const rows = queries.getReferencesToNode(onMessageId);
    expect(rows.length).toBeGreaterThan(0);

    // onMessage now has TWO wiring.ts occurrences (SPEC-010 D1 widened the kind
    // set): the `import { onMessage }` specifier (source = the module) AND the
    // `bus.on(onMessage)` function-as-value ref (source = `wire`). This test
    // validates the by-ref row, so select it by its fnRef metadata marker.
    const wireRow = rows.find(
      (r) => r.sourceFilePath.endsWith('wiring.ts') && (r.metadata as { fnRef?: boolean } | undefined)?.fnRef,
    );
    expect(wireRow).toBeDefined();

    // Source node info — the file to edit and the id of the referencing node.
    expect(wireRow!.sourceFilePath.endsWith('wiring.ts')).toBe(true);
    expect(cg.getNode(wireRow!.sourceId)?.name).toBe('wire');

    // Callsite start point (UTF-16 columns; the end is derived later from the
    // old-name length — research Decision 8, so the statement stores start only).
    expect(typeof wireRow!.line).toBe('number');
    expect(typeof wireRow!.column).toBe('number');

    // Resolver metadata drives the FR-004 confidence tier + old-name recovery.
    const meta = wireRow!.metadata as
      | { resolvedBy?: unknown; confidence?: unknown; refName?: unknown }
      | undefined;
    expect(meta).toBeDefined();
    expect(typeof meta!.resolvedBy).toBe('string');
    expect(typeof meta!.confidence).toBe('number');
    expect(meta!.refName).toBe('onMessage');

    // Base resolved edges carry NULL provenance; SPEC-008 sets 'lsp' only after
    // the precision pass, which is off for this bare temp project.
    expect(wireRow).toHaveProperty('provenance');
    expect(wireRow!.provenance ?? null).toBeNull();
  });

  it('references-to-node: INCLUDES `calls` and `imports` occurrences — SPEC-010 D1 widened the rename-relevant kind set past `references`', () => {
    // `compute` is only ever CALLED (wiring.ts:4) and IMPORTED (wiring.ts:1),
    // never used by-reference. Before D1 the `references`-only filter returned
    // NOTHING for it — leaving the call site + import specifier un-renamed (broken
    // code on a future apply); now BOTH occurrences are returned so the plan edits
    // them (span verification stays the per-edge safety filter downstream).
    const rows = queries.getReferencesToNode(computeId);
    expect(rows.map((r) => r.line).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 4]);
    for (const r of rows) {
      expect(r.sourceFilePath.endsWith('wiring.ts')).toBe(true);
      expect((r.metadata as { refName?: string }).refName).toBe('compute');
    }
    // The `calls` edge is present in the graph and now surfaced by the statement.
    expect(cg.getIncomingEdges(computeId).some((e) => e.kind === 'calls')).toBe(true);
  });

  it('node-declaration-span: getNodeById returns the target’s full declaration range (start+end line/column)', () => {
    const decl = queries.getNodeById(onMessageId);
    expect(decl).not.toBeNull();
    expect(decl!.name).toBe('onMessage');
    expect(decl!.kind).toBe('function');
    expect(decl!.filePath.endsWith('handlers.ts')).toBe(true);
    // Nodes carry a complete range (schema NOT NULL cols) — research Decision 8.
    expect(typeof decl!.startLine).toBe('number');
    expect(typeof decl!.endLine).toBe('number');
    expect(typeof decl!.startColumn).toBe('number');
    expect(typeof decl!.endColumn).toBe('number');
    expect(decl!.startLine).toBeGreaterThanOrEqual(1); // 1-indexed line
    expect(decl!.endLine).toBeGreaterThanOrEqual(decl!.startLine);
  });

  it('nodes-by-name / candidates: getNodesByName returns every same-named symbol with name/kind/file/line, supporting an in-memory kind filter', () => {
    const candidates = queries.getNodesByName('onMessage');
    expect(candidates.length).toBeGreaterThan(0);

    // Each candidate exposes the fields Candidate building needs.
    for (const c of candidates) {
      expect(c.name).toBe('onMessage');
      expect(typeof c.kind).toBe('string');
      expect(typeof c.filePath).toBe('string');
      expect(typeof c.startLine).toBe('number');
    }

    // The optional `--kind` qualifier is a trivial in-memory filter (no new
    // statement): narrowing to `function` isolates the declaration to rename.
    const fns = candidates.filter((c) => c.kind === 'function');
    expect(fns).toHaveLength(1);
    expect(fns[0]!.filePath.endsWith('handlers.ts')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T009 / T010 — LSP-path rename derivation (deriveLspRename) against a REAL
// stub language server (SPEC-010 FR-003 / FR-003a). Reuses the SPEC-008
// real-stub precedent (lsp-client.test.ts's rpcServerSource): a cheap node
// script speaking minimal JSON-RPC over stdio, driven by the REAL
// LspJsonRpcClient — no client mocking. One stub file; behavior is selected by
// env (CG_STUB_MODE) so every FR-003a degraded reason has a real subprocess:
//   ok                 → answers rename with CG_STUB_RENAME_RESULT
//   initialize-timeout → never answers initialize            (initialize-timeout)
//   request-timeout    → never answers rename                (request-timeout)
//   crash              → exits mid-rename                    (server-crash)
//   malformed          → writes a non-JSON frame             (malformed-protocol-response)
//   shutdown-failure   → answers rename, then hangs shutdown (shutdown-failure)
// The document lifecycle (didOpen → rename → didClose) is asserted from the
// stub's CG_STUB_LOG side-channel — proof it was exercised via the server.
// ---------------------------------------------------------------------------

const lspRenameDirs: string[] = [];

afterEach(() => {
  for (const dir of lspRenameDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeLspRenameDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-lsp-'));
  lspRenameDirs.push(dir);
  return dir;
}

/** Write the parameterized JSON-RPC stub server; returns its absolute path. */
function writeRenameStub(dir: string): string {
  const source = `
const fs = require('fs');
const mode = process.env.CG_STUB_MODE || 'ok';
const logPath = process.env.CG_STUB_LOG;
const renameResult = process.env.CG_STUB_RENAME_RESULT ? JSON.parse(process.env.CG_STUB_RENAME_RESULT) : null;
function log(method) { if (logPath) { try { fs.appendFileSync(logPath, method + '\\n'); } catch (e) {} } }
function frame(message) { const body = JSON.stringify(message); return 'Content-Length: ' + Buffer.byteLength(body, 'utf8') + '\\r\\n\\r\\n' + body; }
function respond(id, result) { process.stdout.write(frame({ jsonrpc: '2.0', id, result })); }
let input = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk]);
  while (true) {
    const headerEnd = input.indexOf('\\r\\n\\r\\n');
    if (headerEnd === -1) return;
    const header = input.subarray(0, headerEnd).toString('ascii');
    const match = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!match) process.exit(91);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + Number(match[1]);
    if (input.length < bodyEnd) return;
    const body = input.subarray(bodyStart, bodyEnd).toString('utf8');
    input = input.subarray(bodyEnd);
    handle(JSON.parse(body));
  }
});
function handle(message) {
  if (message.method) log(message.method);
  switch (message.method) {
    case 'initialize':
      if (mode === 'initialize-timeout') return;
      respond(message.id, { capabilities: { renameProvider: true }, serverInfo: { name: 'rename-stub' } });
      return;
    case 'textDocument/rename':
      if (mode === 'request-timeout') return;
      if (mode === 'crash') { process.exit(1); }
      if (mode === 'malformed') {
        const bad = 'not-json';
        process.stdout.write('Content-Length: ' + Buffer.byteLength(bad, 'utf8') + '\\r\\n\\r\\n' + bad);
        return;
      }
      respond(message.id, renameResult);
      return;
    case 'shutdown':
      if (mode === 'shutdown-failure') return;
      respond(message.id, null);
      return;
    case 'exit':
      process.exit(0);
  }
}
`;
  const stubPath = path.join(dir, 'rename-stub.cjs');
  fs.writeFileSync(stubPath, source);
  return stubPath;
}

/** Resolve an EffectiveLspConfig whose typescript server is the stub (or, when
 *  `stubCommand` is null, the registry default — used to force unavailability). */
function lspConfigFor(dir: string, stubCommand: string[] | null, timeoutMs = 2000) {
  const env: Record<string, string> = { CODEGRAPH_LSP_TYPESCRIPT_TIMEOUT_MS: String(timeoutMs) };
  if (stubCommand) env.CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON = JSON.stringify(stubCommand);
  return resolveLspConfig({ projectRoot: dir, cliActivation: 'enable', env });
}

describe('T009 LSP-path rename derivation — deriveLspRename (real stub server, FR-003)', () => {
  it('translates a textDocument/rename WorkspaceEdit into RenameEdit[] (source=lsp, exact, verbatim UTF-16 ranges) and exercises didOpen→rename→didClose', async () => {
    const dir = makeLspRenameDir();
    const aLine = 'export function target(): number { return 1; }';
    const bLine = 'export const value = target();';
    fs.writeFileSync(path.join(dir, 'a.ts'), aLine + '\n');
    fs.writeFileSync(path.join(dir, 'b.ts'), "import { target } from './a';\n" + bLine + '\n');
    const stub = writeRenameStub(dir);
    const logPath = path.join(dir, 'lifecycle.log');

    const aCol = aLine.indexOf('target');
    const bCol = bLine.indexOf('target');
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'a.ts')).href, version: 1 },
          edits: [{ range: { start: { line: 0, character: aCol }, end: { line: 0, character: aCol + 6 } }, newText: 'renamed' }],
        },
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'b.ts')).href, version: 1 },
          edits: [{ range: { start: { line: 1, character: bCol }, end: { line: 1, character: bCol + 6 } }, newText: 'renamed' }],
        },
      ],
    };

    const result = await deriveLspRename({
      projectRoot: dir,
      config: lspConfigFor(dir, [process.execPath, stub, '--stdio']),
      language: 'typescript',
      file: 'a.ts',
      position: { line: 1, column: aCol }, // 1-indexed line, on the declaration name
      newName: 'renamed',
      env: { CG_STUB_MODE: 'ok', CG_STUB_LOG: logPath, CG_STUB_RENAME_RESULT: JSON.stringify(renameResult) },
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.edits).toHaveLength(2);
    for (const edit of result.edits) {
      expect(edit.source).toBe('lsp'); // FR-027 per-edit derivation path
      expect(edit.confidence).toBe('exact'); // FR-004: LSP workspace edit is exact
      expect(edit.newText).toBe('renamed');
      expect(edit.oldText).toBe('target');
    }
    // LSP 0-based line → graph-native 1-based (converted once); column verbatim.
    const aEdit = result.edits.find((e) => e.file === 'a.ts')!;
    expect(aEdit.range).toEqual({ start: { line: 1, column: aCol }, end: { line: 1, column: aCol + 6 } });
    expect(aEdit.lineText).toBe(aLine);
    const bEdit = result.edits.find((e) => e.file === 'b.ts')!;
    expect(bEdit.range).toEqual({ start: { line: 2, column: bCol }, end: { line: 2, column: bCol + 6 } });
    expect(bEdit.lineText).toBe(bLine);

    // Document lifecycle exercised via the stub server (research Decision 1).
    const log = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    expect(log).toContain('textDocument/didOpen');
    expect(log).toContain('textDocument/rename');
    expect(log).toContain('textDocument/didClose');
    expect(log.indexOf('textDocument/didOpen')).toBeLessThan(log.indexOf('textDocument/rename'));
    expect(log.indexOf('textDocument/rename')).toBeLessThan(log.indexOf('textDocument/didClose'));
  });

  it('maps non-ASCII rename ranges as UTF-16 code units with no byte translation (café pin) and accepts the changes shape', async () => {
    const dir = makeLspRenameDir();
    const line = 'export const café = target();';
    fs.writeFileSync(path.join(dir, 'c.ts'), line + '\n');
    const stub = writeRenameStub(dir);

    const utf16Col = line.indexOf('target');
    const byteCol = Buffer.byteLength(line.slice(0, utf16Col), 'utf8');
    expect(byteCol).toBeGreaterThan(utf16Col); // é: 1 UTF-16 code unit, 2 UTF-8 bytes

    const uri = pathToFileURL(path.join(dir, 'c.ts')).href;
    const renameResult = {
      changes: { [uri]: [{ range: { start: { line: 0, character: utf16Col }, end: { line: 0, character: utf16Col + 6 } }, newText: 'renamed' }] },
    };

    const result = await deriveLspRename({
      projectRoot: dir,
      config: lspConfigFor(dir, [process.execPath, stub, '--stdio']),
      language: 'typescript',
      file: 'c.ts',
      position: { line: 1, column: utf16Col },
      newName: 'renamed',
      env: { CG_STUB_MODE: 'ok', CG_STUB_RENAME_RESULT: JSON.stringify(renameResult) },
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.edits).toHaveLength(1);
    const edit = result.edits[0]!;
    expect(edit.range.start.column).toBe(utf16Col); // verbatim UTF-16 — NOT the byte column
    expect(edit.range.start.column).not.toBe(byteCol);
    expect(edit.range.end.column).toBe(utf16Col + 6);
    expect(edit.oldText).toBe('target'); // slicing the live line at the UTF-16 column is correct
    expect(edit.lineText).toBe(line);
    expect(edit.source).toBe('lsp');
    expect(edit.confidence).toBe('exact');
  });
});

describe('T010 FR-003a degradation parity — deriveLspRename (unavailable + runtime failures)', () => {
  it('unavailable (missing-default-command): a registry-default server absent from PATH takes the graph path from the start', async () => {
    const dir = makeLspRenameDir();
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function target(): number { return 1; }\n');
    const result = await deriveLspRename({
      projectRoot: dir,
      config: lspConfigFor(dir, null), // no COMMAND_JSON → registry default command
      language: 'typescript',
      file: 'a.ts',
      position: { line: 1, column: 16 },
      newName: 'renamed',
      env: { PATH: '' }, // registry command not resolvable → probe fails
    });
    expect(result).toEqual({ status: 'unavailable', reason: 'missing-default-command' });
    expect('edits' in result).toBe(false); // never a partial plan
  });

  it('unavailable (configured-command-unavailable): a configured command that is absent takes the graph path from the start', async () => {
    const dir = makeLspRenameDir();
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function target(): number { return 1; }\n');
    const result = await deriveLspRename({
      projectRoot: dir,
      config: lspConfigFor(dir, [path.join(dir, 'no-such-lsp'), '--stdio']),
      language: 'typescript',
      file: 'a.ts',
      position: { line: 1, column: 16 },
      newName: 'renamed',
      env: {},
    });
    expect(result).toEqual({ status: 'unavailable', reason: 'configured-command-unavailable' });
    expect('edits' in result).toBe(false);
  });

  it.each([
    ['crash', 'server-crash'],
    ['malformed', 'malformed-protocol-response'],
  ])('runtime failure (%s) degrades that rename to the graph path (reason=%s), success-shaped, no partial edits', async (mode, reason) => {
    const dir = makeLspRenameDir();
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function target(): number { return 1; }\n');
    const stub = writeRenameStub(dir);
    const result = await deriveLspRename({
      projectRoot: dir,
      config: lspConfigFor(dir, [process.execPath, stub, '--stdio']),
      language: 'typescript',
      file: 'a.ts',
      position: { line: 1, column: 16 },
      newName: 'renamed',
      env: { CG_STUB_MODE: mode },
    });
    expect(result).toEqual({ status: 'failed', reason });
    expect('edits' in result).toBe(false);
  });

  it.each([
    ['initialize-timeout', 'initialize-timeout'],
    ['request-timeout', 'request-timeout'],
    ['shutdown-failure', 'shutdown-failure'],
  ])('runtime failure (%s) degrades that rename to the graph path (reason=%s) promptly — bounded by the client timeout, never hanging', async (mode, reason) => {
    const dir = makeLspRenameDir();
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function target(): number { return 1; }\n');
    const stub = writeRenameStub(dir);
    // A valid rename result so shutdown-failure reaches (and hangs on) shutdown.
    const uri = pathToFileURL(path.join(dir, 'a.ts')).href;
    const renameResult = { changes: { [uri]: [{ range: { start: { line: 0, character: 16 }, end: { line: 0, character: 22 } }, newText: 'renamed' }] } };
    const started = Date.now();
    const result = await deriveLspRename({
      projectRoot: dir,
      config: lspConfigFor(dir, [process.execPath, stub, '--stdio'], 400), // short bound
      language: 'typescript',
      file: 'a.ts',
      position: { line: 1, column: 16 },
      newName: 'renamed',
      env: { CG_STUB_MODE: mode, CG_STUB_RENAME_RESULT: JSON.stringify(renameResult) },
    });
    expect(result).toEqual({ status: 'failed', reason });
    expect('edits' in result).toBe(false);
    expect(Date.now() - started).toBeLessThan(3000); // bounded — no hang
  });
});

// ---------------------------------------------------------------------------
// T011 — Graph-path rename derivation (deriveGraphRename) against a REAL indexed
// project (SPEC-010 FR-003/FR-004/FR-005/FR-012/FR-013). Reuses the T006 harness
// (initSync → indexAll → real SQLite, no DB mocking): each test indexes a small
// fixture and derives the graph-path plan. Branch cases the resolver won't emit on
// its own — a self-loop sentinel, a synthesized dispatch edge, a false-positive
// span — are hand-inserted with the real `QueryBuilder.insertEdge`, the established
// edge-consumer test pattern (c-fnptr-synthesizer.test.ts), still real SQLite.
//
// Grounded on dist/ probe evidence: a TS declaration node's start column is the
// `function` keyword (col 7), so the declaration edit is the NAME occurrence found
// at/after that start — NOT a blind start+len slice (which would read "function ").
// A cross-file function-as-value yields exactly ONE `references` edge
// (resolvedBy='import', provenance=null) whose (line, col) lands on the identifier.
// ---------------------------------------------------------------------------
describe('T011 graph-path rename derivation — deriveGraphRename (real SQLite)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  async function indexFixture(
    files: Record<string, string>,
  ): Promise<{ dir: string; cg: CodeGraph; queries: QueryBuilder }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-graph-rename-'));
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    const queries = (cg as unknown as { queries: QueryBuilder }).queries;
    cleanups.push(() => {
      cg.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    return { dir, cg, queries };
  }

  const fnId = (cg: CodeGraph, name: string) =>
    cg.getNodesByName(name).find((n) => n.kind === 'function')!.id;

  it('empty-reference target still yields the declaration edit (FR-002 / US1 scenario 3), located at the name — NOT the node-start keyword — source graph, exact', async () => {
    const { dir, cg, queries } = await indexFixture({
      'solo.ts': 'export function soloFn(x) { return x; }\n',
    });
    const result = deriveGraphRename({
      queries,
      projectRoot: dir,
      targetId: fnId(cg, 'soloFn'),
      newName: 'renamedFn',
    });

    // A symbol with zero references is a valid plan — the declaration edit alone.
    expect(result.edits).toHaveLength(1);
    const decl = result.edits[0]!;
    const line = 'export function soloFn(x) { return x; }';
    const nameCol = line.indexOf('soloFn'); // 16 — AFTER `export function `, not the node start column (7)
    expect(nameCol).toBe(16);
    expect(decl.file).toBe('solo.ts');
    expect(decl.range).toEqual({
      start: { line: 1, column: nameCol },
      end: { line: 1, column: nameCol + 'soloFn'.length },
    });
    expect(decl.oldText).toBe('soloFn');
    expect(decl.newText).toBe('renamedFn');
    expect(decl.lineText).toBe(line);
    expect(decl.confidence).toBe('exact'); // FR-004: the declaration span is exact
    expect(decl.source).toBe('graph');
    expect(result.leftoverMentions).toBe(0);
  });

  it('a cross-file references edge becomes a span-verified exact edit (source graph) alongside the declaration edit (FR-003/FR-004/FR-005)', async () => {
    const { dir, cg, queries } = await indexFixture({
      'handlers.ts': 'export function onEvent(x) { return x; }\n',
      'wiring.ts':
        "import { onEvent } from './handlers';\nexport function wire(bus) {\n  bus.on(onEvent);\n}\n",
    });
    const result = deriveGraphRename({
      queries,
      projectRoot: dir,
      targetId: fnId(cg, 'onEvent'),
      newName: 'onSignal',
    });

    // Declaration + the import specifier + the function-as-value reference.
    // SPEC-010 D1 now edits the `import { onEvent }` specifier too — before D1 the
    // graph plan was only {declaration, by-ref} (the un-edited import specifier was
    // exactly the leftover-broken-code class the fix closes).
    expect(result.edits).toHaveLength(3);
    for (const e of result.edits) {
      expect(e.oldText).toBe('onEvent');
      expect(e.newText).toBe('onSignal');
      expect(e.source).toBe('graph');
      expect(e.confidence).toBe('exact'); // resolvedBy='import' → exact
    }

    const declLine = 'export function onEvent(x) { return x; }';
    const decl = result.edits.find((e) => e.file === 'handlers.ts')!;
    expect(decl.range.start).toEqual({ line: 1, column: declLine.indexOf('onEvent') });
    expect(decl.lineText).toBe(declLine);

    // The import specifier occurrence (wiring.ts:1) — now a span-verified edit.
    const importLine = "import { onEvent } from './handlers';";
    const imp = result.edits.find((e) => e.file === 'wiring.ts' && e.range.start.line === 1)!;
    expect(imp.range.start.column).toBe(importLine.indexOf('onEvent'));
    expect(importLine.slice(imp.range.start.column, imp.range.end.column)).toBe('onEvent');

    const refLine = '  bus.on(onEvent);';
    const ref = result.edits.find((e) => e.file === 'wiring.ts' && e.range.start.line === 3)!;
    expect(ref.range).toEqual({
      start: { line: 3, column: refLine.indexOf('onEvent') },
      end: { line: 3, column: refLine.indexOf('onEvent') + 'onEvent'.length },
    });
    expect(ref.lineText).toBe(refLine);
    // The FR-005 premise: the live slice at the derived span IS the old name.
    expect(refLine.slice(ref.range.start.column, ref.range.end.column)).toBe('onEvent');
  });

  it('drops a self-loop sentinel references edge (source===target) BEFORE tier classification — never an edit, even where its own span WOULD verify (FR-004)', async () => {
    const { dir, cg, queries } = await indexFixture({
      'lib.ts': 'export function handler(x) { return x; }\n// handler mention here\n',
    });
    const id = fnId(cg, 'handler');
    // A hand-inserted framework self-loop sentinel. Its (line, col) points at a real
    // `handler` token (lib.ts:2, a comment) whose live slice WOULD pass span
    // verification — so ONLY the source===target guard can drop it
    // (classifyEdgeConfidence cannot see endpoints — the carried-forward T004 rule).
    queries.insertEdge({
      source: id,
      target: id,
      kind: 'references',
      line: 2,
      column: 3,
      metadata: { resolvedBy: 'import', refName: 'handler' },
    });
    // Sanity: the statement DOES return the self-loop, so dropping it is the module's job.
    expect(queries.getReferencesToNode(id).some((r) => r.sourceId === id)).toBe(true);

    const result = deriveGraphRename({
      queries,
      projectRoot: dir,
      targetId: id,
      newName: 'process',
    });
    expect(result.edits).toHaveLength(1); // declaration only
    expect(result.edits[0]!.range.start.line).toBe(1);
    expect(result.edits.some((e) => e.range.start.line === 2)).toBe(false); // the comment token is never edited
  });

  it('leftover FYI tallies comment/string occurrences + synthesized (provenance=heuristic) dispatch sites, but edits NONE of them (FR-012/FR-013)', async () => {
    const { dir, cg, queries } = await indexFixture({
      'svc.ts': 'export function notify(x) { return x; }\n',
      'app.ts':
        [
          "import { notify } from './svc';", // 1 — import specifier: NOW edited (D1); was a leftover
          'export function run(bus) {', //      2
          '  bus.on(notify);', //               3 — the real `references` edge (exact) → edited
          '  // notify the user later', //      4 — comment → leftover, never edited
          '  const msg = "notify pending";', // 5 — string  → leftover, never edited
          '}', //                               6
        ].join('\n') + '\n',
    });
    const id = fnId(cg, 'notify');
    // A synthesized dispatch edge (provenance='heuristic'): a wiring site, not a name
    // occurrence — counted in the FYI, never emitted as an edit (FR-004/FR-013).
    queries.insertEdge({
      source: fnId(cg, 'run'),
      target: id,
      kind: 'references',
      line: 3,
      column: 2, // the `bus.on(...)` dispatch site, not the identifier column (9)
      metadata: { resolvedBy: 'callback', synthesizedBy: 'callback', refName: 'notify' },
      provenance: 'heuristic',
    });

    const result = deriveGraphRename({
      queries,
      projectRoot: dir,
      targetId: id,
      newName: 'alert',
    });

    // The declaration (svc.ts:1), the import specifier (app.ts:1 — now edited by
    // D1), and the real by-ref reference (app.ts:3) are edited.
    expect(result.edits).toHaveLength(3);
    expect(result.edits.map((e) => `${e.file}:${e.range.start.line}`).sort()).toEqual([
      'app.ts:1',
      'app.ts:3',
      'svc.ts:1',
    ]);
    // FR-012: no comment/string line is edited; the synthesized dispatch site (col 2) is not edited.
    expect(result.edits.some((e) => e.file === 'app.ts' && [4, 5].includes(e.range.start.line))).toBe(
      false,
    );
    expect(result.edits.some((e) => e.file === 'app.ts' && e.range.start.column === 2)).toBe(false);
    // FR-013: 2 textual leftovers (comment + string) + 1 synthesized dispatch site.
    // The import specifier (app.ts:1) is NO LONGER a leftover — D1 promotes it to an edit.
    expect(result.leftoverMentions).toBe(3);
  });

  it('drops a graph edge whose live-byte slice no longer equals the old name (FR-005 false positive — shadow/alias/string-similar)', async () => {
    const { dir, cg, queries } = await indexFixture({
      'mod.ts': 'export function target(x) { return x; }\nexport function decoy() { return 0; }\n',
    });
    const id = fnId(cg, 'target');
    // A references edge pointing where the live line reads `decoy`, not `target`:
    // the slice ≠ oldName, so span verification drops it (never a guessed edit).
    const line2 = 'export function decoy() { return 0; }';
    queries.insertEdge({
      source: fnId(cg, 'decoy'),
      target: id,
      kind: 'references',
      line: 2,
      column: line2.indexOf('decoy'),
      metadata: { resolvedBy: 'import', refName: 'target' },
    });

    const result = deriveGraphRename({
      queries,
      projectRoot: dir,
      targetId: id,
      newName: 'goal',
    });
    expect(result.edits).toHaveLength(1); // declaration only — the mismatched edge dropped
    expect(result.edits[0]!.range.start.line).toBe(1);
    expect(result.edits.some((e) => e.range.start.line === 2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T017 — Target selector resolution (resolveTarget) against a REAL indexed
// project (SPEC-010 FR-006). BASIC contract only: a bare or qualified
// `Class.method` name, optionally narrowed by `--file` / `--kind`, resolves to
// exactly ONE Target (name/kind/file + the declaration range from getNodeById),
// or a success-shaped `target-not-found` refusal; a surviving multi-match
// returns a placeholder `ambiguous-target` refusal (US2 T026 builds the full
// candidate list — asserted only NOT to resolve here). Reuses the T006 harness
// (initSync → indexAll → real SQLite, no DB mocking).
//
// Grounded on dist/ probe evidence: a TS method's qualifiedName is
// `Class::method` (`Worker::handle`), so `Worker.handle` matches by comparing
// separator-normalized qualified-name segments, NOT a literal `.` compare; node
// file paths are workspace-relative (`models.ts`).
// ---------------------------------------------------------------------------
describe('T017 target selector resolution — resolveTarget (real SQLite, FR-006)', () => {
  let dir: string;
  let cg: CodeGraph;
  let queries: QueryBuilder;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-target-resolve-'));
    fs.writeFileSync(
      path.join(dir, 'models.ts'),
      [
        'export class Worker {',
        '  handle(x) { return x; }', //    2 — Worker::handle (method)
        '  process(y) { return y; }', //   3
        '}', //                            4
        'export class Helper {', //        5
        '  handle(z) { return z; }', //    6 — Helper::handle (method)
        '}', //                            7
        'export function handle(w) { return w; }', // 8 — bare handle (function)
        'export function soloUnique(a) { return a; }', // 9 — unique across the project
      ].join('\n') + '\n',
    );
    // Same name in two files — narrowed only by --file.
    fs.writeFileSync(path.join(dir, 'dup-a.ts'), 'export function dup(a) { return a; }\n');
    fs.writeFileSync(path.join(dir, 'dup-b.ts'), 'export function dup(b) { return b; }\n');

    cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    queries = (cg as unknown as { queries: QueryBuilder }).queries;
  });

  afterAll(() => {
    cg?.destroy();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('bare unique name → resolved Target carrying name/kind/file and the declaration range verbatim from getNodeById', () => {
    const result = resolveTarget({ queries, selector: { name: 'soloUnique' } });
    if ('reason' in result) throw new Error(`expected a Target, got refusal ${result.reason}`);
    expect(result.name).toBe('soloUnique');
    expect(result.kind).toBe('function');
    expect(result.file).toBe('models.ts');

    // The range is the declaration node's own span — start+end line/column verbatim.
    const node = cg.getNodesByName('soloUnique').find((n) => n.kind === 'function')!;
    expect(result.range).toEqual({
      start: { line: node.startLine, column: node.startColumn },
      end: { line: node.endLine, column: node.endColumn },
    });
  });

  it('qualified `Class.method` resolves the method of THAT class (Worker.handle → Worker::handle, not Helper::handle or the bare function)', () => {
    const result = resolveTarget({ queries, selector: { name: 'Worker.handle' } });
    if ('reason' in result) throw new Error(`expected a Target, got refusal ${result.reason}`);
    expect(result.name).toBe('handle');
    expect(result.kind).toBe('method');
    expect(result.file).toBe('models.ts');

    // The Worker method (declaration line 2), never Helper's (line 6) or the function (line 8).
    const workerHandle = cg
      .getNodesByName('handle')
      .find((n) => n.kind === 'method' && n.qualifiedName.includes('Worker'))!;
    expect(result.range.start).toEqual({
      line: workerHandle.startLine,
      column: workerHandle.startColumn,
    });
    expect(result.range.start.line).toBe(2);
  });

  it('--file narrows a name shared across files to the candidate in that file (path suffix match)', () => {
    // Without --file, `dup` exists in two files and does NOT resolve to one Target.
    const ambiguous = resolveTarget({ queries, selector: { name: 'dup' } });
    if (!('reason' in ambiguous)) throw new Error('expected `dup` to be ambiguous without --file');
    expect(ambiguous.reason).toBe('ambiguous-target');

    const result = resolveTarget({ queries, selector: { name: 'dup', file: 'dup-b.ts' } });
    if ('reason' in result) throw new Error(`expected a Target, got refusal ${result.reason}`);
    expect(result.name).toBe('dup');
    expect(result.file).toBe('dup-b.ts');
  });

  it('--kind narrows an across-kinds name to the one candidate of that kind (handle + kind=function → the bare function, not the two methods)', () => {
    const result = resolveTarget({ queries, selector: { name: 'handle', kind: 'function' } });
    if ('reason' in result) throw new Error(`expected a Target, got refusal ${result.reason}`);
    expect(result.kind).toBe('function');
    expect(result.name).toBe('handle');
    expect(result.file).toBe('models.ts');
    // The bare function is on line 8 — distinct from the two methods (lines 2, 6).
    expect(result.range.start.line).toBe(8);
  });

  it('an unmatched selector returns a success-shaped `target-not-found` refusal (a returned object, never a throw)', () => {
    const result = resolveTarget({ queries, selector: { name: 'noSuchSymbolAnywhere' } });
    expect('reason' in result).toBe(true);
    if (!('reason' in result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('target-not-found');
    expect(typeof result.message).toBe('string');
  });

  it('a surviving multi-match returns an `ambiguous-target` refusal — it does NOT resolve to a single Target (US2 T026 builds the candidate list)', () => {
    // Bare `handle` matches two methods + one function — three survivors.
    const result = resolveTarget({ queries, selector: { name: 'handle' } });
    expect('reason' in result).toBe(true);
    if (!('reason' in result)) throw new Error('expected a refusal, not a resolved Target');
    expect(result.reason).toBe('ambiguous-target');
  });
});

// ---------------------------------------------------------------------------
// T012 — Plan assembly (planRename) against a REAL indexed project + a REAL
// stub LSP server (SPEC-010 FR-003/FR-003a/FR-027). Combines the T011 harness
// (initSync → indexAll → real SQLite, no DB mocking) with the T009/T010 stub
// server so the LSP-vs-graph FORK is exercised end-to-end: a configured +
// available server drives the LSP path (per-edit `source:'lsp'`); an unavailable
// or runtime-failed server degrades THAT rename to the graph path (`source:
// 'graph'`) — success-shaped, never a command failure. Also pins the plan-level
// aggregate confidence (`all-exact` vs `contains-heuristic`) and the
// deterministic edit ordering by (file path, range start line, start character).
// ---------------------------------------------------------------------------
describe('T012 plan assembly — planRename (LSP-vs-graph fork, confidence, ordering)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  async function setup(
    files: Record<string, string>,
  ): Promise<{ dir: string; cg: CodeGraph; queries: QueryBuilder }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-plan-engine-'));
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    const queries = (cg as unknown as { queries: QueryBuilder }).queries;
    cleanups.push(() => {
      cg.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    return { dir, cg, queries };
  }

  const disabledLsp = (dir: string) =>
    resolveLspConfig({ projectRoot: dir, cliActivation: 'disable', env: {} });

  // A cross-file function-as-value fixture: the declaration in a.ts plus a
  // `references` edge in b.ts (`bus.on(target)`), so BOTH derivation paths yield
  // a real multi-edit plan (the fork is what differs).
  const A_DECL = 'export function target(x) { return x; }';
  const B_LINES = [
    "import { target } from './a';",
    'export function wire(bus) {',
    '  bus.on(target);',
    '}',
  ];
  const forkFixture = () => ({ 'a.ts': A_DECL + '\n', 'b.ts': B_LINES.join('\n') + '\n' });

  it('uses the LSP path when a configured, available server covers the language (plan+per-edit source lsp, exact)', async () => {
    const { dir, queries } = await setup(forkFixture());
    const stub = writeRenameStub(dir);
    const aCol = A_DECL.indexOf('target');
    const bCol = B_LINES[2]!.indexOf('target');
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'a.ts')).href, version: 1 },
          edits: [{ range: { start: { line: 0, character: aCol }, end: { line: 0, character: aCol + 6 } }, newText: 'renamed' }],
        },
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'b.ts')).href, version: 1 },
          edits: [{ range: { start: { line: 2, character: bCol }, end: { line: 2, character: bCol + 6 } }, newText: 'renamed' }],
        },
      ],
    };

    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'target', kind: 'function' },
      newName: 'renamed',
      lspConfig: lspConfigFor(dir, [process.execPath, stub, '--stdio']),
      env: { CG_STUB_MODE: 'ok', CG_STUB_RENAME_RESULT: JSON.stringify(renameResult) },
    });

    expect(plan.refusal).toBeUndefined();
    expect(plan.source).toBe('lsp');
    expect(plan.edits).toHaveLength(2);
    for (const e of plan.edits!) expect(e.source).toBe('lsp');
    expect(plan.confidence).toBe('all-exact');
    expect(plan.applied).toBe(false);
    expect(plan.newName).toBe('renamed');
    expect(plan.target?.name).toBe('target');
    expect(plan.target?.kind).toBe('function');
    // Deterministic order — a.ts before b.ts.
    expect(plan.edits!.map((e) => e.file)).toEqual(['a.ts', 'b.ts']);
  });

  it('degrades to the graph path when the configured LSP server is UNAVAILABLE (per-edit source graph, from the start)', async () => {
    const { dir, queries } = await setup(forkFixture());
    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'target', kind: 'function' },
      newName: 'renamed',
      lspConfig: lspConfigFor(dir, null), // registry-default command …
      env: { PATH: '' }, // … which cannot be resolved → probe unavailable → graph
    });

    expect(plan.refusal).toBeUndefined();
    expect(plan.source).toBe('graph');
    expect(plan.edits!.length).toBeGreaterThanOrEqual(2);
    for (const e of plan.edits!) expect(e.source).toBe('graph');
    // Declaration edit (a.ts) + the function-as-value reference (b.ts).
    expect(plan.edits!.some((e) => e.file === 'a.ts')).toBe(true);
    expect(plan.edits!.some((e) => e.file === 'b.ts')).toBe(true);
  });

  it('degrades to the graph path when the LSP server FAILS at runtime mid-rename (per-edit source graph), never failing the command', async () => {
    const { dir, queries } = await setup(forkFixture());
    const stub = writeRenameStub(dir);
    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'target', kind: 'function' },
      newName: 'renamed',
      lspConfig: lspConfigFor(dir, [process.execPath, stub, '--stdio']),
      env: { CG_STUB_MODE: 'crash' }, // probe passes, rename exchange crashes → graph
    });

    expect(plan.refusal).toBeUndefined();
    expect(plan.source).toBe('graph');
    for (const e of plan.edits!) expect(e.source).toBe('graph');
  });

  it('uses the graph path directly when LSP is disabled — never attempts a server', async () => {
    const { dir, queries } = await setup(forkFixture());
    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'target', kind: 'function' },
      newName: 'renamed',
      lspConfig: disabledLsp(dir),
      env: {},
    });
    expect(plan.source).toBe('graph');
    for (const e of plan.edits!) expect(e.source).toBe('graph');
  });

  it('aggregate confidence is all-exact when every edit is exact (declaration-only plan)', async () => {
    const { dir, queries } = await setup({ 'solo.ts': 'export function soloExact(x) { return x; }\n' });
    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'soloExact' },
      newName: 'renamedExact',
      lspConfig: disabledLsp(dir),
      env: {},
    });
    expect(plan.source).toBe('graph');
    expect(plan.edits).toHaveLength(1); // declaration only
    expect(plan.edits![0]!.confidence).toBe('exact');
    expect(plan.confidence).toBe('all-exact');
  });

  it('aggregate confidence is contains-heuristic when ANY edit is heuristic', async () => {
    const { dir, cg, queries } = await setup({
      'lib.ts':
        ['export function widget(x) { return x; }', 'export function other() { return 0; }', '// widget mention'].join('\n') + '\n',
    });
    const widgetId = cg.getNodesByName('widget').find((n) => n.kind === 'function')!.id;
    const otherId = cg.getNodesByName('other').find((n) => n.kind === 'function')!.id;
    const commentLine = '// widget mention';
    // A span-verified heuristic reference (resolvedBy='fuzzy') — hand-inserted like
    // the T011 synthetic edges; classifyEdgeConfidence('fuzzy') = heuristic.
    queries.insertEdge({
      source: otherId,
      target: widgetId,
      kind: 'references',
      line: 3,
      column: commentLine.indexOf('widget'),
      metadata: { resolvedBy: 'fuzzy', refName: 'widget' },
    });

    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'widget', kind: 'function' },
      newName: 'gadget',
      lspConfig: disabledLsp(dir),
      env: {},
    });
    expect(plan.source).toBe('graph');
    expect(plan.edits!.map((e) => e.confidence)).toContain('heuristic');
    expect(plan.edits!.map((e) => e.confidence)).toContain('exact'); // the declaration
    expect(plan.confidence).toBe('contains-heuristic');
  });

  it('orders edits deterministically by (file path, range start line, start character)', async () => {
    const zetaDecl = 'export function shared(x) { return x; }';
    const { dir, cg, queries } = await setup({
      'zeta.ts': zetaDecl + '\n',
      'alpha.ts':
        ['export function a() { return 0; }', 'export function b() { return 1; }', '// shared A', '// shared B'].join('\n') + '\n',
    });
    const sharedId = cg.getNodesByName('shared').find((n) => n.kind === 'function')!.id;
    const aId = cg.getNodesByName('a').find((n) => n.kind === 'function')!.id;
    const bId = cg.getNodesByName('b').find((n) => n.kind === 'function')!.id;
    // Insert two references OUT OF (file,line) ORDER — line 4 first, then line 3.
    queries.insertEdge({
      source: bId,
      target: sharedId,
      kind: 'references',
      line: 4,
      column: '// shared B'.indexOf('shared'),
      metadata: { resolvedBy: 'import', refName: 'shared' },
    });
    queries.insertEdge({
      source: aId,
      target: sharedId,
      kind: 'references',
      line: 3,
      column: '// shared A'.indexOf('shared'),
      metadata: { resolvedBy: 'import', refName: 'shared' },
    });

    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'shared', kind: 'function' },
      newName: 'common',
      lspConfig: disabledLsp(dir),
      env: {},
    });

    const keys = plan.edits!.map((e) => `${e.file}:${e.range.start.line}:${e.range.start.column}`);
    expect(keys).toEqual(['alpha.ts:3:3', 'alpha.ts:4:3', `zeta.ts:1:${zetaDecl.indexOf('shared')}`]);
  });

  it('resolveTarget refusals pass through as a success-shaped plan (newName + applied + refusal, no edits)', async () => {
    const { dir, queries } = await setup({ 'solo.ts': 'export function soloExact(x) { return x; }\n' });
    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'noSuchSymbolAnywhere' },
      newName: 'whatever',
      lspConfig: disabledLsp(dir),
      env: {},
    });
    expect(plan.applied).toBe(false);
    expect(plan.newName).toBe('whatever');
    expect(plan.refusal?.reason).toBe('target-not-found');
    expect(plan.edits).toBeUndefined();
    expect(plan.target).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T013 — Plan format + schema (plan-format.ts) — PURE over a RenamePlan value
// object (no DB). Pins: the human table grouped by file (path, per-edit
// range/before-after/tier, aggregate+leftover footer); the `-j/--json`
// serialization validates against contracts/rename-plan.schema.json (loaded and
// structurally checked — this repo has no ajv, so a focused recursive validator
// enforces required fields, types, enums, and additionalProperties:false);
// every edit carries `lineText` (SC-001); the ONE surface boundary conversion
// (internal 1-indexed line → 0-based line/character); canonical serialization
// (stable key order, UTF-8, no insignificant whitespace); and same-line
// composition right-to-left by range start (FR-027).
// ---------------------------------------------------------------------------
describe('T013 plan format + schema — plan-format (FR-027 / SC-001)', () => {
  const schema = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'specs/010-graph-aware-rename/contracts/rename-plan.schema.json'),
      'utf8',
    ),
  ) as Record<string, unknown>;

  /** Resolve a local `#/definitions/...` (or any `#/...`) ref against the schema. */
  function resolveRef(ref: string): Record<string, unknown> {
    let cur: unknown = schema;
    for (const part of ref.replace(/^#\//, '').split('/')) {
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur as Record<string, unknown>;
  }

  /** A focused JSON-Schema (draft-07 subset) validator tied to the loaded file. */
  function validate(value: unknown, node: Record<string, unknown>, where = '$'): void {
    if (typeof node.$ref === 'string') return validate(value, resolveRef(node.$ref), where);
    if (Array.isArray(node.enum)) expect(node.enum, `${where} enum`).toContain(value);
    const type = (node.type as string | undefined) ?? (node.properties || node.required ? 'object' : undefined);
    if (type === 'object') {
      expect(typeof value === 'object' && value !== null, `${where} object`).toBe(true);
      const obj = value as Record<string, unknown>;
      for (const req of (node.required as string[] | undefined) ?? []) {
        expect(Object.keys(obj), `${where} required ${req}`).toContain(req);
      }
      const props = (node.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
      if (node.additionalProperties === false) {
        for (const k of Object.keys(obj)) expect(Object.keys(props), `${where} extra key "${k}"`).toContain(k);
      }
      for (const [k, sub] of Object.entries(props)) {
        if (obj[k] !== undefined) validate(obj[k], sub, `${where}.${k}`);
      }
    } else if (type === 'array') {
      expect(Array.isArray(value), `${where} array`).toBe(true);
      const arr = value as unknown[];
      if (typeof node.minItems === 'number') expect(arr.length, `${where} minItems`).toBeGreaterThanOrEqual(node.minItems);
      for (let i = 0; i < arr.length; i++) validate(arr[i], node.items as Record<string, unknown>, `${where}[${i}]`);
    } else if (type === 'string') {
      expect(typeof value, `${where} string`).toBe('string');
    } else if (type === 'integer') {
      expect(Number.isInteger(value), `${where} integer`).toBe(true);
      if (typeof node.minimum === 'number') expect(value as number, `${where} minimum`).toBeGreaterThanOrEqual(node.minimum);
    } else if (type === 'boolean') {
      expect(typeof value, `${where} boolean`).toBe('boolean');
    }
  }

  function successPlan(): RenamePlan {
    return {
      target: {
        name: 'oldFn',
        kind: 'function',
        file: 'a.ts',
        range: { start: { line: 1, column: 16 }, end: { line: 1, column: 21 } },
      },
      newName: 'newFn',
      edits: [
        {
          file: 'a.ts',
          range: { start: { line: 1, column: 16 }, end: { line: 1, column: 21 } },
          oldText: 'oldFn',
          newText: 'newFn',
          lineText: 'export function oldFn() {}',
          confidence: 'exact',
          source: 'graph',
        },
        {
          file: 'b.ts',
          range: { start: { line: 3, column: 2 }, end: { line: 3, column: 7 } },
          oldText: 'oldFn',
          newText: 'newFn',
          lineText: '  oldFn();',
          confidence: 'heuristic',
          source: 'graph',
        },
      ],
      confidence: 'contains-heuristic',
      source: 'graph',
      leftoverMentions: 2,
      applied: false,
    };
  }

  it('renders a human table grouped by file with per-edit range, before/after, and tier, plus an aggregate+leftover footer', () => {
    const table = formatRenamePlanTable(successPlan());
    expect(table).toContain('a.ts');
    expect(table).toContain('b.ts');
    expect(table).toContain('oldFn');
    expect(table).toContain('newFn');
    expect(table).toContain('exact');
    expect(table).toContain('heuristic');
    // Footer: aggregate confidence + leftover-mention count.
    expect(table).toContain('contains-heuristic');
    expect(table).toMatch(/2/);
    // Grouped by file — the a.ts group precedes the b.ts group.
    expect(table.indexOf('a.ts')).toBeLessThan(table.indexOf('b.ts'));
  });

  it('every edit carries lineText so the before/after preview renders without a Read (SC-001)', () => {
    const plan = successPlan();
    for (const e of plan.edits!) expect(typeof e.lineText).toBe('string');
    const table = formatRenamePlanTable(plan);
    // The pre-edit source line is shown verbatim (before side of the preview).
    expect(table).toContain('export function oldFn() {}');
  });

  it('renders a refusal envelope in the human table (reason + guidance message)', () => {
    const table = formatRenamePlanTable({
      newName: 'newFn',
      applied: false,
      refusal: { reason: 'target-not-found', message: 'No symbol matches "oldFn".' },
    });
    expect(table).toContain('target-not-found');
    expect(table).toContain('No symbol matches "oldFn".');
  });

  it('serializes -j/--json to an object that validates against contracts/rename-plan.schema.json', () => {
    const obj = JSON.parse(serializeRenamePlanJson(successPlan()));
    validate(obj, schema);
    expect(obj.newName).toBe('newFn');
    expect(obj.applied).toBe(false);
    expect(Array.isArray(obj.edits)).toBe(true);
    expect(obj.edits).toHaveLength(2);
    // Enums surface exactly as the schema declares them.
    expect(obj.confidence).toBe('contains-heuristic');
    expect(obj.edits[0].confidence).toBe('exact');
    expect(obj.edits[1].confidence).toBe('heuristic');
    expect(obj.edits[0].source).toBe('graph');
  });

  it('converts the internal 1-indexed line to a 0-based surface line/character (the ONE boundary conversion)', () => {
    const obj = JSON.parse(serializeRenamePlanJson(successPlan()));
    // internal range.start.line=1 → surface line 0; column passes through verbatim.
    expect(obj.edits[0].range.start.line).toBe(0);
    expect(obj.edits[0].range.start.character).toBe(16);
    expect(obj.edits[0].range.end.line).toBe(0);
    expect(obj.edits[0].range.end.character).toBe(21);
    expect(obj.edits[1].range.start.line).toBe(2); // internal 3 → surface 2
    // The surface uses `character`, never the internal `column`.
    expect(obj.edits[0].range.start).not.toHaveProperty('column');
    // target range converts too.
    expect(obj.target.range.start.line).toBe(0);
    expect(obj.target.range.start.character).toBe(16);
  });

  it('every edit carries lineText in the JSON payload (SC-001)', () => {
    const obj = JSON.parse(serializeRenamePlanJson(successPlan()));
    expect(obj.edits[0].lineText).toBe('export function oldFn() {}');
    expect(obj.edits[1].lineText).toBe('  oldFn();');
  });

  it('emits canonical JSON — no insignificant whitespace, deterministic, stable key order', () => {
    const a = serializeRenamePlanJson(successPlan());
    const b = serializeRenamePlanJson(successPlan());
    expect(a).toBe(b); // deterministic
    expect(a).not.toMatch(/\n/); // not pretty-printed
    expect(a).not.toMatch(/": /); // no space after a key's colon (compact)
    // Stable key order matches the schema's property order.
    expect(a.indexOf('"target"')).toBeLessThan(a.indexOf('"newName"'));
    expect(a.indexOf('"newName"')).toBeLessThan(a.indexOf('"edits"'));
    expect(a.indexOf('"edits"')).toBeLessThan(a.indexOf('"applied"'));
  });

  it('serializes a success-shaped refusal envelope (only newName + applied required; refusal carried) and validates against the schema', () => {
    const plan: RenamePlan = {
      newName: 'newFn',
      applied: false,
      refusal: {
        reason: 'ambiguous-target',
        message: '"oldFn" matches 2 symbols. Qualify with Class.method, --file, or --kind.',
        candidates: [
          { name: 'oldFn', kind: 'function', file: 'a.ts', line: 1, selector: '--file a.ts' },
          { name: 'oldFn', kind: 'method', file: 'b.ts', line: 3, selector: 'Worker.oldFn' },
        ],
      },
    };
    const obj = JSON.parse(serializeRenamePlanJson(plan));
    validate(obj, schema);
    expect(obj.newName).toBe('newFn');
    expect(obj.applied).toBe(false);
    expect(obj.target).toBeUndefined();
    expect(obj.edits).toBeUndefined();
    expect(obj.confidence).toBeUndefined();
    expect(obj.refusal.reason).toBe('ambiguous-target');
    expect(schema.definitions).toBeDefined();
    expect((resolveRef('#/definitions/refusal').properties as Record<string, Record<string, unknown>>).reason.enum).toContain(
      obj.refusal.reason,
    );
    expect(obj.refusal.candidates).toHaveLength(2);
    expect(obj.refusal.candidates[0].selector).toBe('--file a.ts');
  });

  it('composes a same-line after-preview right-to-left by range start, order-independently (FR-027)', () => {
    const lineText = 'return foo(target) + target;';
    const first = lineText.indexOf('target'); // 11
    const second = lineText.indexOf('target', first + 1); // 21
    const mk = (col: number): RenameEdit => ({
      file: 'a.ts',
      range: { start: { line: 1, column: col }, end: { line: 1, column: col + 'target'.length } },
      oldText: 'target',
      newText: 'renamedTarget',
      lineText,
      confidence: 'exact',
      source: 'graph',
    });
    const expected = 'return foo(renamedTarget) + renamedTarget;';
    // Right-to-left application keeps the earlier column's offsets valid; input
    // order must not matter (the composer sorts descending by range start).
    expect(composeAfterLine(lineText, [mk(first), mk(second)])).toBe(expected);
    expect(composeAfterLine(lineText, [mk(second), mk(first)])).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// T014 — CLI dry-run surface `codegraph rename <target> <new-name>` against the
// BUILT binary (SPEC-010 FR-001/FR-023/FR-026/FR-027; contracts/cli-rename.md).
// Slice 1 is unconditionally dry-run: it prints a plan (human table by default;
// `-j/--json` the stable schema object, byte-identical to the library plan —
// SC-005), writes NOTHING, and maps outcomes to a Slice-1 exit taxonomy of only
// 0 (plan produced) / 2 (recoverable success-shaped refusal: target-not-found,
// not-indexed) / 1 (unexpected) — never the read-only commands' generic
// error→exit-1 mapping. `--apply` is NOT a Slice-1 option, so commander rejects
// it with its standard unknown-option error (Assumptions). Exercised end-to-end
// through dist/bin/codegraph.js (matches index-command.test.ts /
// hybrid-cli-surface.test.ts) against a real indexed fixture; the graph path is
// forced (LSP env scrubbed) so the CLI plan equals the in-process library plan.
// ---------------------------------------------------------------------------
describe('T014 CLI dry-run — codegraph rename (built binary, FR-001/FR-026/FR-027)', () => {
  const BIN = path.resolve(__dirname, '../dist/bin/codegraph.js');
  // `oldFn` is imported+referenced across files (so `--kind function` yields a
  // multi-file plan); `soloRenameTarget` is unique with no import (so the bare
  // task-example name `codegraph rename <x> <y>` resolves unambiguously).
  const FIXTURE: Record<string, string> = {
    'a.ts': 'export function oldFn(x) { return x; }\n',
    'b.ts': "import { oldFn } from './a';\nexport function wire(bus) {\n  bus.on(oldFn);\n}\n",
    'c.ts': 'export function soloRenameTarget(x) { return x; }\n',
  };
  let dir: string;
  let childEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    if (!fs.existsSync(BIN)) {
      throw new Error(`Build the project first: ${BIN} is missing (run npm run build).`);
    }
    // Force the graph path on BOTH surfaces (the subprocess CLI and the in-process
    // library call the parity test makes), so a dev shell / codegraph.json that
    // enabled a real language server for only one side can't diverge the plans
    // (SC-005). The 69 in-process LSP tests pass their own explicit `env` to
    // resolveLspConfig and are unaffected by this process.env scrub.
    for (const k of Object.keys(process.env)) if (k.startsWith('CODEGRAPH_LSP')) delete process.env[k];
    childEnv = { ...process.env, CODEGRAPH_NO_DAEMON: '1', CODEGRAPH_WASM_RELAUNCHED: '1' };

    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-cli-'));
    for (const [name, content] of Object.entries(FIXTURE)) fs.writeFileSync(path.join(dir, name), content);
    const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    cg.close();
  });

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Run `codegraph rename <args> -p <projectPath>` against the built binary. */
  function runRename(args: string[], projectPath = dir): { status: number | null; stdout: string; stderr: string } {
    const res = spawnSync(process.execPath, [BIN, 'rename', ...args, '-p', projectPath], {
      encoding: 'utf-8',
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
  }

  /** A dry-run writes NOTHING — every fixture file is byte-identical afterwards. */
  function assertFixtureUnchanged(): void {
    for (const [name, content] of Object.entries(FIXTURE)) {
      expect(fs.readFileSync(path.join(dir, name), 'utf8'), `${name} must be byte-unchanged`).toBe(content);
    }
  }

  it('prints a human table for a dry-run plan, writes NOTHING, exits 0 (FR-001/FR-027)', () => {
    const res = runRename(['soloRenameTarget', 'renamedSolo']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('c.ts'); // grouped-by-file table
    expect(res.stdout).toContain('soloRenameTarget');
    expect(res.stdout).toContain('renamedSolo');
    expect(res.stdout).toContain('exact'); // per-edit confidence tier
    expect(res.stderr).not.toMatch(/\n\s+at /); // not an error-shaped stack trace
    assertFixtureUnchanged();
  });

  it('a multi-file plan with the --kind qualifier still writes nothing, exits 0 (FR-006)', () => {
    const res = runRename(['oldFn', 'newFn', '--kind', 'function']);
    expect(res.status).toBe(0);
    // Declaration (a.ts) + import specifier + by-ref occurrence (b.ts) — D1 widened.
    expect(res.stdout).toContain('a.ts');
    expect(res.stdout).toContain('b.ts');
    expect(res.stdout).toContain('oldFn');
    expect(res.stdout).toContain('newFn');
    assertFixtureUnchanged();
  });

  it('accepts the --file qualifier (narrows to one declaration), exits 0 (FR-006)', () => {
    const res = runRename(['oldFn', 'newFn', '--file', 'a.ts']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('a.ts');
    expect(res.stdout).toContain('newFn');
    assertFixtureUnchanged();
  });

  it('-j/--json emits the stable schema object, byte-identical to the library plan (SC-005), zero writes', async () => {
    const res = runRename(['oldFn', 'newFn', '--kind', 'function', '--json']);
    expect(res.status).toBe(0);

    const parsed = JSON.parse(res.stdout) as {
      newName: string;
      applied: boolean;
      edits: Array<Record<string, unknown>>;
    };
    // Schema-shape spot checks (contracts/rename-plan.schema.json).
    expect(parsed.newName).toBe('newFn');
    expect(parsed.applied).toBe(false);
    expect(Array.isArray(parsed.edits)).toBe(true);
    expect(parsed.edits.length).toBeGreaterThanOrEqual(2);
    for (const e of parsed.edits) {
      for (const key of ['file', 'range', 'oldText', 'newText', 'lineText', 'confidence', 'source']) {
        expect(Object.keys(e)).toContain(key);
      }
      expect(e.oldText).toBe('oldFn');
      expect(e.newText).toBe('newFn');
    }

    // Parity (FR-027/SC-005): the CLI --json stdout equals the library's own
    // canonical serialization of the plan it returns for the identical request.
    const cg = await CodeGraph.open(dir);
    try {
      const libPlan = await cg.planRename({ name: 'oldFn', kind: 'function' }, 'newFn');
      expect(res.stdout.trim()).toBe(serializeRenamePlanJson(libPlan));
      expect(parsed).toEqual(JSON.parse(serializeRenamePlanJson(libPlan)));
    } finally {
      cg.close();
    }
    assertFixtureUnchanged();
  });

  it('target-not-found → success-shaped guidance on stdout, exit 2, zero writes (FR-023/FR-026)', () => {
    const res = runRename(['noSuchSymbolAnywhere', 'whatever']);
    expect(res.status).toBe(2); // recoverable refusal, NOT the generic exit 1
    expect(res.stdout).toContain('target-not-found');
    expect(res.stderr).not.toMatch(/\n\s+at /); // success-shaped, never a stack trace
    assertFixtureUnchanged();
  });

  it('a not-indexed project → success-shaped not-indexed guidance, exit 2 (checked before targeting)', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-noindex-'));
    try {
      const res = runRename(['oldFn', 'newFn'], bare);
      expect(res.status).toBe(2);
      expect(res.stdout).toContain('not-indexed');
      expect(res.stdout).toMatch(/codegraph (init|index)/); // names the fix
      expect(res.stderr).not.toMatch(/\n\s+at /);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it('-j/--json carries the refusal envelope (reason + message; no target/edits), exit 2', () => {
    const res = runRename(['noSuchSymbolAnywhere', 'whatever', '--json']);
    expect(res.status).toBe(2);
    const parsed = JSON.parse(res.stdout) as {
      applied: boolean;
      target?: unknown;
      edits?: unknown;
      refusal: { reason: string; message: string };
    };
    expect(parsed.applied).toBe(false);
    expect(parsed.refusal.reason).toBe('target-not-found');
    expect(typeof parsed.refusal.message).toBe('string');
    expect(parsed.target).toBeUndefined();
    expect(parsed.edits).toBeUndefined();
  });

  it('--apply is NOT a Slice-1 option: commander rejects it as an unknown option, non-zero exit', () => {
    const res = runRename(['soloRenameTarget', 'renamedSolo', '--apply']);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/unknown option/i);
    assertFixtureUnchanged();
  });

  it('exit codes stay within the Slice-1 taxonomy {0,1,2} (FR-026)', () => {
    const ok = runRename(['soloRenameTarget', 'renamedSolo']).status;
    const refused = runRename(['noSuchSymbolAnywhere', 'whatever']).status;
    const usage = runRename(['soloRenameTarget', 'renamedSolo', '--apply']).status;
    expect(ok).toBe(0); // plan produced
    expect(refused).toBe(2); // recoverable refusal
    expect(usage).toBe(1); // commander's standard unknown-option usage error
    for (const code of [ok, refused, usage]) expect([0, 1, 2]).toContain(code);
  });
});

// ---------------------------------------------------------------------------
// T022 — Ambiguity refusal (resolveTarget, SPEC-010 FR-007/FR-008/SC-003). A bare
// name matching several symbols refuses with `ambiguous-target` and a `candidates`
// array — each candidate carrying name/kind/file/line PLUS the exact qualifier
// (`Class.method`, `--file <path>`, or `--kind <kind>`) that uniquely selects it —
// with NO single resolution (no guess, no writes). Retrying with any printed
// selector then resolves to exactly that one Target, purely over the graph
// (resolveTarget does no file I/O), proving the SC-003 "one qualified retry, zero
// files read" guarantee. Reuses the T017 harness (initSync → indexAll → real
// SQLite); the fixture mirrors T017's (probe-verified qualifiedName Worker::handle
// / Helper::handle, bare `handle` at lines 2 / 5 / 7).
// ---------------------------------------------------------------------------
describe('T022 ambiguous-target refusal — resolveTarget (real SQLite, FR-007/FR-008/SC-003)', () => {
  let dir: string;
  let cg: CodeGraph;
  let queries: QueryBuilder;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-ambig-'));
    fs.writeFileSync(
      path.join(dir, 'models.ts'),
      [
        'export class Worker {',
        '  handle(x) { return x; }', //   2 — Worker::handle (method)
        '}',
        'export class Helper {',
        '  handle(z) { return z; }', //   5 — Helper::handle (method)
        '}',
        'export function handle(w) { return w; }', // 7 — bare handle (function)
        'export function soloUnique(a) { return a; }', // 8 — unique
      ].join('\n') + '\n',
    );
    fs.writeFileSync(path.join(dir, 'dup-a.ts'), 'export function dup(a) { return a; }\n');
    fs.writeFileSync(path.join(dir, 'dup-b.ts'), 'export function dup(b) { return b; }\n');
    cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    queries = (cg as unknown as { queries: QueryBuilder }).queries;
  });

  afterAll(() => {
    cg?.destroy();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Turn a printed candidate selector back into a TargetSelector for the retry. */
  function toSelector(name: string, selector: string): { name: string; file?: string; kind?: string } {
    if (selector.startsWith('--file ')) return { name, file: selector.slice('--file '.length) };
    if (selector.startsWith('--kind ')) return { name, kind: selector.slice('--kind '.length) };
    return { name: selector };
  }

  it('a bare name matching several symbols → ambiguous-target with a candidate per match (name/kind/file/line/selector), NO single resolution (no guess)', () => {
    const result = resolveTarget({ queries, selector: { name: 'handle' } });
    if (!('reason' in result)) throw new Error('expected a refusal, not a resolved Target (no guess)');
    expect(result.reason).toBe('ambiguous-target');
    expect(result.candidates).toBeDefined();
    expect(result.candidates).toHaveLength(3);

    for (const c of result.candidates!) {
      expect(typeof c.name).toBe('string');
      expect(typeof c.kind).toBe('string');
      expect(typeof c.file).toBe('string');
      expect(typeof c.line).toBe('number');
      expect(typeof c.selector).toBe('string');
    }

    // The uniquely-selecting qualifier per candidate: Class.method for the two
    // methods, --kind for the lone function (all three share models.ts, so --file
    // cannot disambiguate — the selector must ACTUALLY distinguish this candidate).
    const bySelector = Object.fromEntries(result.candidates!.map((c) => [c.selector, c]));
    expect(bySelector['Worker.handle']).toMatchObject({ name: 'handle', kind: 'method', file: 'models.ts', line: 2 });
    expect(bySelector['Helper.handle']).toMatchObject({ name: 'handle', kind: 'method', file: 'models.ts', line: 5 });
    expect(bySelector['--kind function']).toMatchObject({ name: 'handle', kind: 'function', file: 'models.ts', line: 7 });
  });

  it('a name shared across files → each candidate carries the --file qualifier that selects it', () => {
    const result = resolveTarget({ queries, selector: { name: 'dup' } });
    if (!('reason' in result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('ambiguous-target');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates!.map((c) => c.selector).sort()).toEqual(['--file dup-a.ts', '--file dup-b.ts']);
  });

  it('SC-003: retrying with each printed selector resolves to exactly that ONE Target — zero files read (resolveTarget is graph-only)', () => {
    for (const name of ['handle', 'dup']) {
      const ambiguous = resolveTarget({ queries, selector: { name } });
      if (!('reason' in ambiguous)) throw new Error(`expected ${name} to be ambiguous`);
      for (const c of ambiguous.candidates!) {
        const retry = resolveTarget({ queries, selector: toSelector(c.name, c.selector) });
        if ('reason' in retry) {
          throw new Error(`selector "${c.selector}" did not uniquely resolve: ${retry.reason}`);
        }
        expect(retry.kind).toBe(c.kind);
        expect(retry.file).toBe(c.file);
        expect(retry.range.start.line).toBe(c.line);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// T023 — Kind-coverage refusals (resolveTarget, SPEC-010 FR-009/FR-010/FR-011 +
// FR-003a honesty). The graph path cannot cover locals/parameters (no tracked
// references), so a `variable`/`parameter` target on the graph path is refused
// `unsupported-kind-graph-local`; when the graph path was reached by DEGRADING a
// configured-but-unavailable server, the message stays honest that a WORKING
// server is required. The LSP path (FR-009) renames any kind — the resolver lifts
// the restriction when the disposition is `available`, and the LSP-path derivation
// itself never kind-filters. `file`/`route`/`import`/`export` are `excluded-kind`
// on EVERY path (FR-011). Locals/parameters/excluded kinds are not produced by TS
// extraction, so — like T011's synthetic edges — they are hand-inserted with the
// real QueryBuilder.insertNode; real SQLite throughout.
// ---------------------------------------------------------------------------
describe('T023 kind-coverage refusals — resolveTarget (FR-009/FR-010/FR-011, FR-003a honesty)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  async function indexFixture(files: Record<string, string>): Promise<{ dir: string; cg: CodeGraph; queries: QueryBuilder }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-kind-'));
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    const queries = (cg as unknown as { queries: QueryBuilder }).queries;
    cleanups.push(() => {
      cg.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    return { dir, cg, queries };
  }

  /** Hand-insert a declaration node of an arbitrary kind (locals/params/excluded
   *  kinds aren't produced by TS extraction — mirrors T011's insertEdge pattern). */
  function insertKindNode(queries: QueryBuilder, opts: { name: string; kind: string; file: string; line: number }): void {
    queries.insertNode({
      id: `test:${opts.kind}:${opts.name}:${opts.line}`,
      kind: opts.kind as NodeKind,
      name: opts.name,
      qualifiedName: opts.name,
      filePath: opts.file,
      language: 'typescript',
      startLine: opts.line,
      endLine: opts.line,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    });
  }

  it('a graph-path variable → unsupported-kind-graph-local ("no local usage tracking — needs a language server")', async () => {
    const { queries } = await indexFixture({ 'm.ts': 'export function f(p) { return p; }\n' });
    insertKindNode(queries, { name: 'localX', kind: 'variable', file: 'm.ts', line: 1 });
    const result = resolveTarget({ queries, selector: { name: 'localX' }, newName: 'renamedX', lspPath: () => 'absent' });
    if (!('reason' in result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('unsupported-kind-graph-local');
    expect(result.message).toMatch(/no local usage tracking/i);
    expect(result.message).toMatch(/language server/i);
  });

  it('a graph-path parameter is likewise refused unsupported-kind-graph-local', async () => {
    const { queries } = await indexFixture({ 'm.ts': 'export function f(p) { return p; }\n' });
    insertKindNode(queries, { name: 'paramP', kind: 'parameter', file: 'm.ts', line: 1 });
    const result = resolveTarget({ queries, selector: { name: 'paramP' }, newName: 'renamedP', lspPath: () => 'absent' });
    if (!('reason' in result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('unsupported-kind-graph-local');
  });

  it('FR-003a honesty: a graph path reached by DEGRADING a configured-but-unavailable server → message requires a WORKING server', async () => {
    const { queries } = await indexFixture({ 'm.ts': 'export function f(p) { return p; }\n' });
    insertKindNode(queries, { name: 'localX', kind: 'variable', file: 'm.ts', line: 1 });
    const result = resolveTarget({ queries, selector: { name: 'localX' }, newName: 'renamedX', lspPath: () => 'unavailable' });
    if (!('reason' in result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('unsupported-kind-graph-local');
    expect(result.message).toMatch(/working/i); // honesty clause: the configured server did not respond
    expect(result.message).toMatch(/language server/i);
  });

  it('FR-009: on the LSP path (available) a local/parameter is NOT restricted — it resolves to a Target', async () => {
    const { queries } = await indexFixture({ 'm.ts': 'export function f(p) { return p; }\n' });
    insertKindNode(queries, { name: 'localX', kind: 'variable', file: 'm.ts', line: 1 });
    const result = resolveTarget({ queries, selector: { name: 'localX' }, newName: 'renamedX', lspPath: () => 'available' });
    if ('reason' in result) throw new Error(`expected a Target on the LSP path, got ${result.reason}`);
    expect(result.name).toBe('localX');
    expect(result.kind).toBe('variable');
  });

  it('FR-009: deriveLspRename renames a LOCAL identifier with no kind filter (the LSP path has no kind restriction)', async () => {
    const dir = makeLspRenameDir();
    const line = 'function outer() { let localX = 1; return localX; }';
    fs.writeFileSync(path.join(dir, 'a.ts'), line + '\n');
    const stub = writeRenameStub(dir);
    const c1 = line.indexOf('localX');
    const c2 = line.indexOf('localX', c1 + 1);
    const uri = pathToFileURL(path.join(dir, 'a.ts')).href;
    const renameResult = {
      changes: {
        [uri]: [
          { range: { start: { line: 0, character: c1 }, end: { line: 0, character: c1 + 6 } }, newText: 'renamedX' },
          { range: { start: { line: 0, character: c2 }, end: { line: 0, character: c2 + 6 } }, newText: 'renamedX' },
        ],
      },
    };
    const result = await deriveLspRename({
      projectRoot: dir,
      config: lspConfigFor(dir, [process.execPath, stub, '--stdio']),
      language: 'typescript',
      file: 'a.ts',
      position: { line: 1, column: c1 },
      newName: 'renamedX',
      env: { CG_STUB_MODE: 'ok', CG_STUB_RENAME_RESULT: JSON.stringify(renameResult) },
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.edits.length).toBeGreaterThanOrEqual(1);
    for (const e of result.edits) {
      expect(e.source).toBe('lsp');
      expect(e.confidence).toBe('exact');
      expect(e.oldText).toBe('localX');
    }
  });

  it('planRename wires the graph-local refusal end-to-end (LSP disabled → unsupported-kind-graph-local, success-shaped, no edits)', async () => {
    const { dir, queries } = await indexFixture({ 'm.ts': 'export function f(p) { return p; }\n' });
    insertKindNode(queries, { name: 'loose', kind: 'variable', file: 'm.ts', line: 1 });
    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'loose' },
      newName: 'tight',
      lspConfig: resolveLspConfig({ projectRoot: dir, cliActivation: 'disable', env: {} }),
      env: {},
    });
    expect(plan.applied).toBe(false);
    expect(plan.refusal?.reason).toBe('unsupported-kind-graph-local');
    expect(plan.edits).toBeUndefined();
    expect(plan.target).toBeUndefined();
  });

  it.each([['file'], ['route'], ['import'], ['export']])(
    'FR-011: kind=%s is excluded-kind on EVERY path (graph AND lsp)',
    async (kind) => {
      const { queries } = await indexFixture({ 'm.ts': 'export function f(p) { return p; }\n' });
      insertKindNode(queries, { name: 'excludedThing', kind, file: 'm.ts', line: 1 });
      const onGraph = resolveTarget({ queries, selector: { name: 'excludedThing' }, newName: 'renamed', lspPath: () => 'absent' });
      if (!('reason' in onGraph)) throw new Error('expected a refusal on the graph path');
      expect(onGraph.reason).toBe('excluded-kind');
      const onLsp = resolveTarget({ queries, selector: { name: 'excludedThing' }, newName: 'renamed', lspPath: () => 'available' });
      if (!('reason' in onLsp)) throw new Error('expected a refusal on the lsp path');
      expect(onLsp.reason).toBe('excluded-kind');
    },
  );
});

// ---------------------------------------------------------------------------
// T024 — Invalid-argument validation (resolveTarget, SPEC-010 FR-021a). The two
// identifying arguments are validated before a plan is derived: an empty or
// syntactically-invalid new name, a no-op rename (new name equals the current
// name), and an unrecognized `--kind` each refuse success-shaped with
// `invalid-argument`, naming the offending argument; the unknown-kind refusal
// carries `validKinds` (every recognized NodeKind) so a corrected retry needs no
// file read. These stay DISTINCT from `excluded-kind` (a well-formed but excluded
// kind — see T023) and `target-not-found` (a valid kind that matches nothing).
// ---------------------------------------------------------------------------
describe('T024 invalid-argument validation — resolveTarget (FR-021a)', () => {
  let dir: string;
  let cg: CodeGraph;
  let queries: QueryBuilder;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-invalidarg-'));
    fs.writeFileSync(path.join(dir, 'm.ts'), 'export function soloUnique(a) { return a; }\n');
    cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    queries = (cg as unknown as { queries: QueryBuilder }).queries;
  });

  afterAll(() => {
    cg?.destroy();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('an empty new name → invalid-argument (names the offending argument), never a plan', () => {
    const result = resolveTarget({ queries, selector: { name: 'soloUnique' }, newName: '' });
    if (!('reason' in result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('invalid-argument');
    expect(result.message).toMatch(/name/i);
  });

  it('a syntactically-invalid new name → invalid-argument', () => {
    const result = resolveTarget({ queries, selector: { name: 'soloUnique' }, newName: 'not a valid name!' });
    if (!('reason' in result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('invalid-argument');
  });

  it('a no-op rename (new name equals the current name) → invalid-argument', () => {
    const result = resolveTarget({ queries, selector: { name: 'soloUnique' }, newName: 'soloUnique' });
    if (!('reason' in result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('invalid-argument');
    expect(result.message).toMatch(/same|current|nothing/i);
  });

  it('an unrecognized --kind → invalid-argument carrying validKinds (every recognized NodeKind)', () => {
    const result = resolveTarget({ queries, selector: { name: 'soloUnique', kind: 'notARealKind' }, newName: 'renamed' });
    if (!('reason' in result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('invalid-argument');
    expect(result.validKinds).toEqual([...NODE_KINDS]);
    expect(result.validKinds).toContain('function');
  });

  it('DISTINCTNESS: a valid kind that matches nothing is target-not-found (NOT invalid-argument)', () => {
    // soloUnique is a function; --kind method matches no symbol.
    const result = resolveTarget({ queries, selector: { name: 'soloUnique', kind: 'method' }, newName: 'renamed' });
    if (!('reason' in result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('target-not-found');
  });

  it('DISTINCTNESS: a valid new name on a real symbol still resolves (validation does not over-refuse)', () => {
    const result = resolveTarget({ queries, selector: { name: 'soloUnique' }, newName: 'soloRenamed' });
    if ('reason' in result) throw new Error(`expected a Target, got ${result.reason}`);
    expect(result.name).toBe('soloUnique');
    expect(result.kind).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// T024 (CLI surface) — invalid-argument through the BUILT binary (SPEC-010
// FR-021a/FR-023/FR-026). An unrecognized --kind and a no-op rename each print a
// success-shaped invalid-argument refusal and exit 2 (the recoverable-refusal
// code, never the generic exit 1); -j/--json carries the refusal with validKinds.
// T014-style: dist/bin/codegraph.js via spawnSync, LSP env scrubbed, real index.
// ---------------------------------------------------------------------------
describe('T024 invalid-argument CLI — codegraph rename (built binary, FR-021a/FR-026)', () => {
  const BIN = path.resolve(__dirname, '../dist/bin/codegraph.js');
  let dir: string;
  let childEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    if (!fs.existsSync(BIN)) throw new Error(`Build the project first: ${BIN} is missing (run npm run build).`);
    for (const k of Object.keys(process.env)) if (k.startsWith('CODEGRAPH_LSP')) delete process.env[k];
    childEnv = { ...process.env, CODEGRAPH_NO_DAEMON: '1', CODEGRAPH_WASM_RELAUNCHED: '1' };
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-invalidarg-cli-'));
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function soloRenameTarget(x) { return x; }\n');
    const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    cg.close();
  });

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  function runRename(args: string[], projectPath = dir): { status: number | null; stdout: string; stderr: string } {
    const res = spawnSync(process.execPath, [BIN, 'rename', ...args, '-p', projectPath], {
      encoding: 'utf-8',
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
  }

  it('unrecognized --kind → success-shaped invalid-argument, exit 2, enumerates valid kinds', () => {
    const res = runRename(['soloRenameTarget', 'renamedSolo', '--kind', 'notARealKind']);
    expect(res.status).toBe(2);
    expect(res.stdout).toContain('invalid-argument');
    expect(res.stdout).toMatch(/function/); // validKinds enumerated in the guidance
    expect(res.stderr).not.toMatch(/\n\s+at /); // success-shaped, not a stack trace
  });

  it('a no-op rename (new name equals current) → invalid-argument, exit 2', () => {
    const res = runRename(['soloRenameTarget', 'soloRenameTarget']);
    expect(res.status).toBe(2);
    expect(res.stdout).toContain('invalid-argument');
    expect(res.stderr).not.toMatch(/\n\s+at /);
  });

  it('-j/--json carries the invalid-argument refusal with validKinds for an unknown kind, exit 2', () => {
    const res = runRename(['soloRenameTarget', 'renamedSolo', '--kind', 'notARealKind', '--json']);
    expect(res.status).toBe(2);
    const parsed = JSON.parse(res.stdout) as { applied: boolean; refusal: { reason: string; validKinds?: string[] } };
    expect(parsed.applied).toBe(false);
    expect(parsed.refusal.reason).toBe('invalid-argument');
    expect(Array.isArray(parsed.refusal.validKinds)).toBe(true);
    expect(parsed.refusal.validKinds).toContain('function');
  });
});

// ---------------------------------------------------------------------------
// T025 — Scope-ignored invisibility (deriveGraphRename, SPEC-010 FR-005/SC-008).
// The shadow / import-alias / string-similar / comment / string false positives
// are already dropped by verifySpan (the FR-005 span tests above) and the T011
// derivation tests, so they are NOT re-asserted here. The GENUINELY NEW guarantee:
// an old-name reference living in a scope-ignored file (excluded from indexing —
// gitignored or codegraph.json `exclude`) is invisible to the graph (no edge
// exists), so it is NEVER emitted as an edit AND never increments the
// leftover-mention FYI (the leftover tally scans only touched files). Real SQLite;
// the excluded file is confirmed un-indexed as a precondition.
// ---------------------------------------------------------------------------
describe('T025 scope-ignored invisibility — deriveGraphRename (FR-005/SC-008)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  it('an old-name reference in a scope-ignored file is neither edited NOR counted as a leftover (no edge exists)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-scopeignore-'));
    // decl.ts declares the target; wire.ts has the real references (import
    // specifier + by-ref, BOTH edited by D1); ignored.ts is EXCLUDED — its import
    // specifier + reference + comment would all be visible if indexed, but must
    // NOT be (no edge → no edit → not touched → not tallied).
    fs.writeFileSync(path.join(dir, 'decl.ts'), 'export function scopedName(x) { return x; }\n');
    fs.writeFileSync(
      path.join(dir, 'wire.ts'),
      "import { scopedName } from './decl';\nexport function w(bus) {\n  bus.on(scopedName);\n}\n",
    );
    fs.writeFileSync(
      path.join(dir, 'ignored.ts'),
      "import { scopedName } from './decl';\nexport function ig(bus) {\n  bus.on(scopedName);\n}\n// scopedName mentioned in an ignored file\n",
    );
    // codegraph.json `exclude` (gitignore-style, root-relative) un-indexes the
    // file, so no reference edge from it ever enters the graph (the SC-008 scope).
    fs.writeFileSync(path.join(dir, 'codegraph.json'), JSON.stringify({ exclude: ['ignored.ts'] }));
    const cg = CodeGraph.initSync(dir);
    await cg.indexAll();
    const queries = (cg as unknown as { queries: QueryBuilder }).queries;
    cleanups.push(() => {
      cg.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    // Precondition: ignored.ts was NOT indexed (its `ig` function is absent).
    expect(cg.getNodesByName('ig')).toHaveLength(0);

    const targetId = cg.getNodesByName('scopedName').find((n) => n.kind === 'function')!.id;
    const result = deriveGraphRename({ queries, projectRoot: dir, targetId, newName: 'renamedScope' });

    // Edits: decl.ts declaration + wire.ts import specifier + wire.ts by-ref — and
    // NOTHING in ignored.ts. (D1 now edits wire.ts's import specifier too, so
    // wire.ts contributes two edits; the SC-008 guarantee under test is the
    // no-ignored-file invariant.)
    expect([...new Set(result.edits.map((e) => e.file))].sort()).toEqual(['decl.ts', 'wire.ts']);
    expect(result.edits.some((e) => e.file === 'ignored.ts')).toBe(false);
    expect(result.edits.map((e) => `${e.file}:${e.range.start.line}`).sort()).toEqual([
      'decl.ts:1',
      'wire.ts:1',
      'wire.ts:3',
    ]);

    // Leftover FYI is 0: D1 promotes wire.ts's import specifier from a leftover to
    // an edit, and ignored.ts is invisible (no edge). Were ignored.ts indexed, its
    // comment `// scopedName mentioned…` would be tallied — its absence from the
    // count is exactly the SC-008 scope-invisibility guarantee.
    expect(result.leftoverMentions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// D1 — Name-occurrence edge coverage (Slice-1 UAT defect). The graph path must
// derive edits from EVERY edge kind whose SOURCE POSITION textually names the
// target, not just `references`. UAT evidence: a function with an import
// specifier + direct call sites + a by-ref use produced a graph plan of only
// {declaration, by-ref} (2 edits) while the LSP arm correctly produced 11
// (imports + calls + refs); the un-edited call-site/import tokens would leave
// broken code on a future apply that the touched-file post-check cannot see
// (FR-018 premise). `getReferencesToNode` widens to the rename-relevant kind
// set; span verification (FR-005) stays the per-edge filter, so an edge whose
// recorded position does NOT carry the old name is still dropped (proven here
// with `new X()`, whose `instantiates` position points at the `new` keyword).
// Real files + real SQLite through the full pipeline (T011 harness pattern).
// ---------------------------------------------------------------------------
describe('D1 name-occurrence edge coverage — deriveGraphRename + getReferencesToNode', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  async function indexFixture(
    files: Record<string, string>,
  ): Promise<{ dir: string; cg: CodeGraph; queries: QueryBuilder }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-d1-'));
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    const queries = (cg as unknown as { queries: QueryBuilder }).queries;
    cleanups.push(() => {
      cg.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    return { dir, cg, queries };
  }
  const fnId = (cg: CodeGraph, name: string) => cg.getNodesByName(name).find((n) => n.kind === 'function')!.id;
  const classId = (cg: CodeGraph, name: string) => cg.getNodesByName(name).find((n) => n.kind === 'class')!.id;
  const ifaceId = (cg: CodeGraph, name: string) => cg.getNodesByName(name).find((n) => n.kind === 'interface')!.id;

  it('a called + imported function includes the call-site AND import-specifier edits, not just the declaration (the UAT scenario)', async () => {
    const importLine = "import { add } from './math';";
    const call1 = '  const x = add(1, 2);';
    const call2 = '  const y = add(3, 4);';
    const { dir, cg, queries } = await indexFixture({
      'math.ts': 'export function add(a, b) { return a + b; }\n',
      'main.ts': [importLine, 'export function run() {', call1, call2, '  return x + y;', '}'].join('\n') + '\n',
    });
    const result = deriveGraphRename({ queries, projectRoot: dir, targetId: fnId(cg, 'add'), newName: 'sum' });

    // Declaration + import specifier (main.ts:1) + BOTH call sites (main.ts:3, :4).
    const keys = result.edits.map((e) => `${e.file}:${e.range.start.line}`).sort();
    expect(keys).toEqual(['main.ts:1', 'main.ts:3', 'main.ts:4', 'math.ts:1']);
    for (const e of result.edits) {
      expect(e.oldText).toBe('add');
      expect(e.newText).toBe('sum');
      expect(e.source).toBe('graph');
      expect(e.confidence).toBe('exact'); // resolvedBy='import' → exact
    }
    // The two D1 tokens that got NO edit before the fix — span-verified occurrences.
    const importEdit = result.edits.find((e) => e.file === 'main.ts' && e.range.start.line === 1)!;
    expect(importLine.slice(importEdit.range.start.column, importEdit.range.end.column)).toBe('add');
    const callEdit = result.edits.find((e) => e.file === 'main.ts' && e.range.start.line === 3)!;
    expect(call1.slice(callEdit.range.start.column, callEdit.range.end.column)).toBe('add');
  });

  it('getReferencesToNode returns call-site (`calls`) and import-specifier (`imports`) occurrences — the widened rename-relevant kind set', async () => {
    const { cg, queries } = await indexFixture({
      'math.ts': 'export function mul(a, b) { return a * b; }\n',
      'main.ts': "import { mul } from './math';\nexport const z = mul(2, 3);\n",
    });
    const rows = queries.getReferencesToNode(fnId(cg, 'mul'));
    // Both the import specifier (main.ts:1) and the call site (main.ts:2) are now
    // returned; before D1 the `references`-only filter returned NEITHER (mul is
    // only ever imported + called, never used by-reference).
    const lines = rows.map((r) => r.line).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(lines).toEqual([1, 2]);
    for (const r of rows) {
      expect(r.sourceFilePath.endsWith('main.ts')).toBe(true);
      expect((r.metadata as { refName?: string }).refName).toBe('mul');
    }
  });

  it('a class target includes its extends occurrence + import specifier; the `new X()` name-token is NOT edited (its `instantiates` edge points at the `new` keyword) but is tallied as a leftover', async () => {
    const importLine = "import { Base } from './shapes';";
    const extendsLine = 'export class Widget extends Base {}';
    const newLine = 'export const w = new Base();';
    const { dir, cg, queries } = await indexFixture({
      'shapes.ts': 'export class Base { greet() { return 0; } }\n',
      'app.ts': [importLine, extendsLine, newLine].join('\n') + '\n',
    });
    const result = deriveGraphRename({ queries, projectRoot: dir, targetId: classId(cg, 'Base'), newName: 'Shape' });

    const keys = result.edits.map((e) => `${e.file}:${e.range.start.line}`).sort();
    // Declaration (shapes.ts:1) + import specifier (app.ts:1) + extends occurrence (app.ts:2).
    expect(keys).toEqual(['app.ts:1', 'app.ts:2', 'shapes.ts:1']);
    for (const e of result.edits) expect(e.oldText).toBe('Base');
    // The `extends Base` occurrence IS a real edit whose live slice equals the name.
    const extendsEdit = result.edits.find((e) => e.file === 'app.ts' && e.range.start.line === 2)!;
    expect(extendsLine.slice(extendsEdit.range.start.column, extendsEdit.range.end.column)).toBe('Base');
    // The `new Base()` name-token (app.ts:3) is NOT edited — the only edge at that
    // statement is `instantiates`, whose recorded position is the `new` keyword, so
    // span verification drops it (broad kind inclusion never mis-edits a sigil
    // position). It survives instead as a whole-word leftover-mention FYI.
    expect(result.edits.some((e) => e.range.start.line === 3)).toBe(false);
    expect(result.leftoverMentions).toBeGreaterThanOrEqual(1);
  });

  it('an interface target includes its `implements` occurrence (class-hierarchy coverage)', async () => {
    const implLine = 'export class Circle implements Shape { area() { return 1; } }';
    const { dir, cg, queries } = await indexFixture({
      'shapes.ts': 'export interface Shape { area(): number; }\n',
      'app.ts': "import { Shape } from './shapes';\n" + implLine + '\n',
    });
    const result = deriveGraphRename({ queries, projectRoot: dir, targetId: ifaceId(cg, 'Shape'), newName: 'Figure' });

    // The `implements Shape` occurrence (app.ts:2) is now a span-verified edit.
    const implEdit = result.edits.find((e) => e.file === 'app.ts' && e.range.start.line === 2);
    expect(implEdit).toBeDefined();
    expect(implLine.slice(implEdit!.range.start.column, implEdit!.range.end.column)).toBe('Shape');
    expect(result.edits.some((e) => e.file === 'shapes.ts')).toBe(true); // declaration
  });
});

// ---------------------------------------------------------------------------
// D2 — Refusal candidate list on the HUMAN surface (Slice-1 UAT defect). FR-007
// requires the candidate list on the human table too — the machine (`-j`) path
// already carries it (T013), but `formatRenamePlanTable` rendered only
// `refused: <reason>\n<message>`, so the ambiguous message ("Retry with one of
// the listed selectors") listed nothing. Each refusal payload field renders on
// the human table only when present: candidates (selector · kind · file:line),
// validKinds (comma list), files (one per line), gatedEdits (file:line · tier).
// Pure over a RenamePlan value object (no DB), like T013.
// ---------------------------------------------------------------------------
describe('D2 refusal candidate surface — formatRenamePlanTable (FR-007)', () => {
  it('an ambiguous-target refusal lists every candidate with its selector, kind, and file:line', () => {
    const table = formatRenamePlanTable({
      newName: 'renamed',
      applied: false,
      refusal: {
        reason: 'ambiguous-target',
        message: '"handle" matches 2 symbols. Retry with one of the listed selectors.',
        candidates: [
          { name: 'handle', kind: 'method', file: 'models.ts', line: 2, selector: 'Worker.handle' },
          { name: 'handle', kind: 'method', file: 'models.ts', line: 5, selector: 'Helper.handle' },
        ],
      },
    });
    expect(table).toContain('ambiguous-target');
    // Both candidates' uniquely-selecting qualifiers appear on the human surface.
    expect(table).toContain('Worker.handle');
    expect(table).toContain('Helper.handle');
    // …each with its kind and file:line, so a retry needs no file read (SC-003).
    expect(table).toContain('method');
    expect(table).toContain('models.ts:2');
    expect(table).toContain('models.ts:5');
  });

  it('an invalid-argument refusal renders the valid-kinds list', () => {
    const table = formatRenamePlanTable({
      newName: 'renamed',
      applied: false,
      refusal: {
        reason: 'invalid-argument',
        message: '--kind "clazz" is not a recognized NodeKind.',
        validKinds: ['function', 'method', 'class'],
      },
    });
    expect(table).toContain('invalid-argument');
    expect(table).toContain('function');
    expect(table).toContain('method');
    expect(table).toContain('class');
  });

  it('renders files (stale-span) and gatedEdits (heuristic-gated) payloads when present, and omits every optional block otherwise', () => {
    const withFiles = formatRenamePlanTable({
      newName: 'renamed',
      applied: false,
      refusal: { reason: 'stale-span', message: 'Live bytes drifted.', files: ['src/a.ts', 'src/b.ts'] },
    });
    expect(withFiles).toContain('src/a.ts');
    expect(withFiles).toContain('src/b.ts');

    const withGated = formatRenamePlanTable({
      newName: 'renamed',
      applied: false,
      refusal: {
        reason: 'heuristic-gated',
        message: 'Below-exact edits block apply.',
        gatedEdits: [
          {
            file: 'src/c.ts',
            range: { start: { line: 7, column: 4 }, end: { line: 7, column: 9 } },
            oldText: 'oldFn',
            newText: 'newFn',
            lineText: '    oldFn();',
            confidence: 'heuristic',
            source: 'graph',
          },
        ],
      },
    });
    expect(withGated).toContain('src/c.ts:7');
    expect(withGated).toContain('heuristic');

    // A bare refusal (no optional payloads) renders only reason + message — no
    // stray "candidates:" / "files:" headers leak in.
    const bare = formatRenamePlanTable({
      newName: 'renamed',
      applied: false,
      refusal: { reason: 'target-not-found', message: 'No symbol matches "oldFn".' },
    });
    expect(bare).toContain('target-not-found');
    expect(bare).toContain('No symbol matches "oldFn".');
    expect(bare).not.toMatch(/candidates:|valid kinds:|files:|gated edits:/);
  });
});
