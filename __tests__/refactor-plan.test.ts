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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeGraph } from '../src';
import type { QueryBuilder } from '../src/db/queries';
import { classifyEdgeConfidence } from '../src/refactor/confidence';
import { verifySpan } from '../src/refactor/span-verify';

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

    const wireRow = rows.find((r) => r.sourceFilePath.endsWith('wiring.ts'));
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

  it('references-to-node: excludes `calls` edges — only kind=`references` occurrences are rename candidates', () => {
    // `compute` is only ever CALLED, so its single incoming edge is `calls`;
    // getReferencesToNode returns nothing for it, even though the call is in the
    // graph — pinning that the statement filters to kind='references'.
    expect(queries.getReferencesToNode(computeId)).toEqual([]);
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
