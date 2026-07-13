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
import { findDeclarationNameColumn, verifySpan } from '../src/refactor/span-verify';
import { deriveLspRename } from '../src/refactor/lsp-rename';
import { deriveGraphRename } from '../src/refactor/graph-rename';
import { resolveTarget } from '../src/refactor/target-resolver';
import { planRename } from '../src/refactor/plan-engine';
import {
  composeAfterLine,
  formatApplyResultTable,
  formatRenamePlanTable,
  serializeApplyResultJson,
  serializeRenamePlanJson,
} from '../src/refactor/plan-format';
import type { ApplyResult, RecoveryInfo, RenameEdit, RenamePlan, Refusal } from '../src/refactor/types';
// R6 (rp-review A6) — the public rename API types MUST be importable from the
// package entry, not only via a deep `src/refactor/types` import. Aliased to
// avoid clashing with the deep-import names above; this line is the compile-time
// pin (tsc fails if any is not re-exported from `../src`).
import type {
  TargetSelector as PubTargetSelector,
  RenamePlan as PubRenamePlan,
  ApplyResult as PubApplyResult,
  RenameEdit as PubRenameEdit,
  Refusal as PubRefusal,
} from '../src';

// ---------------------------------------------------------------------------
// Shared draft-07-subset schema validator (module scope so both the plan-
// assembly tests (T012 / D3) and the plan-format tests (T013) can validate a
// serialized plan against the ONE contract file without loading/parsing it
// twice or duplicating the recursive validator.
// ---------------------------------------------------------------------------
const schema = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), '__tests__/fixtures/refactor/rename-plan.schema.json'),
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

    // R19 (rp-review): the NEW explicit declaration-recovered label — every site that
    // flows through resolveMethodOnType (a validated `Type::method`) now emits
    // `instance-method-decl`, classified `exact` REGARDLESS of confidence (so the
    // 0.8 objc/pascal factory chains, which collide with the 0.8 capitalization guess
    // under the legacy split, are no longer conflated). The discriminator is the
    // label, not the confidence.
    it.each([[0.8], [0.85], [0.9], [1.0]])(
      'instance-method-decl @ confidence %s (declaration-recovered, validated Type::method) → exact',
      (confidence) => {
        expect(classifyEdgeConfidence({ resolvedBy: 'instance-method-decl', confidence })).toBe('exact');
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
    // R19: this LEGACY label branch is kept UNCHANGED for backward compatibility with
    // already-built indexes (old edges still carry the conflated `instance-method`);
    // new indexes emit `instance-method-decl` for the declaration-recovered sites, so
    // a NEW `instance-method` edge is only ever a Strategy 2/3 guess (0.8/0.7) → still
    // heuristic here, and an OLD declaration-recovered `instance-method` at 0.8
    // under-classifies to heuristic — the SAFE mis-direction (exact→heuristic).
    it.each([[0.8], [0.7], [0.65]])(
      'instance-method (legacy conflated label) @ confidence %s (capitalization-guess / word-overlap) → heuristic',
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

// R18 (rp-review, P0) — the pure declaration-name locator underneath the graph
// declaration edit and the LSP cursor position. Whole-word, decorator-aware,
// keyword-prefix-aware; the graph-path integration cases are pinned separately in
// the R18 deriveGraphRename describe below.
describe('R18 findDeclarationNameColumn — whole-word declaration-name locator', () => {
  it('skips an accessor/modifier keyword equal to the name (`get get`) via the whitespace-gap advance', () => {
    expect(findDeclarationNameColumn('  get get() { return 1; }', 2, 'get')).toBe(6);
    expect(findDeclarationNameColumn('  async async() {}', 2, 'async')).toBe(8);
    expect(findDeclarationNameColumn('  set set(v) {}', 2, 'set')).toBe(6);
  });

  it('skips a same-line `@name` decorator reference and targets the declaration name', () => {
    expect(findDeclarationNameColumn('@foo foo = decorated();', 0, 'foo')).toBe(5);
    expect(findDeclarationNameColumn('@foo() foo = 1;', 0, 'foo')).toBe(7);
  });

  it('never advances onto a same-name parameter (the `(` gap is not whitespace)', () => {
    expect(findDeclarationNameColumn('function foo(foo: number) { return foo; }', 0, 'foo')).toBe(9);
  });

  it('leaves a plain declaration unchanged — the name at/after the keyword', () => {
    expect(findDeclarationNameColumn('class Widget {', 0, 'Widget')).toBe(6);
    expect(findDeclarationNameColumn('export function soloFn(x) { return x; }', 7, 'soloFn')).toBe(16);
  });

  it('is whole-word only — a substring occurrence (`foo` in `foobar`) is never matched', () => {
    expect(findDeclarationNameColumn('const foobar = foo;', 0, 'foo')).toBe(15);
  });

  it('returns -1 when the name does not occur as a whole word at/after fromColumn', () => {
    expect(findDeclarationNameColumn('class Widget {', 0, 'Gadget')).toBe(-1);
  });

  // R22 (rp-review round-3, P0) — the R18 keyword-prefix advance only crossed pure
  // WHITESPACE, so a COMMENT or an intervening KEYWORD between the keyword prefix
  // and the name defeated it: selection stayed on the keyword, span verification
  // then PASSED (the bytes match), and an --apply rewrote the keyword. The
  // delimiter rule (LAST whole-word occurrence before the first signature
  // delimiter) is gap-agnostic.
  it('R22: a COMMENT gap between the keyword prefix and the name (`get /* comment */ get()`) → the name', () => {
    expect(findDeclarationNameColumn('  get /* comment */ get() {', 2, 'get')).toBe(20);
  });

  it('R22: an intervening KEYWORD between the two same-name tokens (`async function async()`) → the second async', () => {
    expect(findDeclarationNameColumn('async function async() {', 0, 'async')).toBe(15);
  });

  it('R22: a receiver/parenthesized prefix before the name (Go `func (s *Server) handle(`) → the first occurrence (delimiter fallback)', () => {
    // The first delimiter is the receiver `(` (col 5), BEFORE `handle` (col 17), so
    // no occurrence precedes it — fall back to the first whole-word occurrence.
    expect(findDeclarationNameColumn('func (s *Server) handle(cfg Config) {', 0, 'handle')).toBe(17);
  });

  // R24 (rp-review round-4, P0) — the delimiter scan and the whole-word occurrence
  // collection ran over the RAW line, so a signature-delimiter character INSIDE a
  // comment poisoned the rule. In `get /* returns: cached value */ get()` the `:`
  // inside the block comment became the "first delimiter", so the name AFTER the
  // comment was excluded and the accessor keyword before it was selected — which
  // then span-verified (its bytes match) and would be rewritten on --apply. Both
  // C-family comment forms are now masked to spaces (indices preserved) before the
  // scan, so neither a delimiter nor a same-name token inside a comment counts.
  it('R24: a signature delimiter inside a `/* … */` block comment does not poison the delimiter scan', () => {
    expect(findDeclarationNameColumn('get /* returns: cached value */ get() {}', 0, 'get')).toBe(32);
    expect(findDeclarationNameColumn('get /* note: cached */ get()', 0, 'get')).toBe(23);
  });

  it('R24: a `//` line comment truncates the scan region without breaking a name before it', () => {
    // `foo` precedes the `//`; the `:` inside the comment must not be treated as the
    // signature delimiter (it would still resolve here, but the truncation is what
    // keeps a comment-internal token from ever being collected as the name).
    expect(findDeclarationNameColumn('foo // sets: x', 0, 'foo')).toBe(0);
  });

  // R26 (rp-review round-5, P1) — maskLineComments scanned for `//` and a block-comment
  // opener WITHOUT string awareness, so a comment opener INSIDE a quoted string was
  // masked as a real comment. `@dec("http://example") class Widget {}` blanked
  // everything from the `//` in the URL onward — including `Widget` — so the locator
  // returned -1, the declaration edit was dropped, and an index-FRESH file drew a
  // spurious stale-span refusal (fail-closed, but a regression: the pre-mask scan
  // could find Widget). The masker now tracks single/double/backtick string state
  // (backslash-escape aware) and opens a comment only OUTSIDE a string.
  it('R26: a comment opener inside a quoted string is code, not a comment — the name after it is still found', () => {
    expect(findDeclarationNameColumn('@dec("http://example") class Widget {}', 0, 'Widget')).toBe(29);
    expect(findDeclarationNameColumn('@dec("/*") class Widget {}', 0, 'Widget')).toBe(17);
  });

  it('R26: a REAL comment outside a string still masks — a `//` after a closed string truncates, a block comment containing a quote masks fully', () => {
    // `foo = "x"` closes its string, so the following `//` is a genuine line comment
    // that truncates the scan (its `:` never becomes the delimiter); the name is col 0.
    expect(findDeclarationNameColumn('foo = "x" // note: y', 0, 'foo')).toBe(0);
    // The apostrophe in `it's` sits INSIDE the block comment, so it must not open a
    // string that would swallow the matching close — the comment masks fully and the
    // real name (the second `get`, col 22) wins over the accessor keyword at col 0.
    expect(findDeclarationNameColumn("get /* it's cached */ get()", 0, 'get')).toBe(22);
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

  // D5-win review remediation (MAJOR): translateWorkspaceEdit derives each
  // edit's `file` via `path.relative(projectRoot, absPath)`, which uses the
  // CURRENT PLATFORM's separator — on win32 that is `\`, producing an edit
  // path that does not match the graph's forward-slash-normalized convention
  // (the same normalization precision-pass.ts's uriToProjectPath already
  // applies). POSIX-safe assertion only: `path.relative` already returns `/`
  // on this platform, so this cannot RED on a POSIX dev machine — it pins the
  // invariant as a regression guard. Full win32 behavior rides the recorded
  // Windows deferral (`.parallels` VM currently unavailable).
  it('derives a forward-slash edit file path for a nested directory, matching the graph\'s path convention (POSIX regression guard; win32 rides the recorded deferral)', async () => {
    const dir = makeLspRenameDir();
    const nestedDir = path.join(dir, 'nested', 'deep');
    fs.mkdirSync(nestedDir, { recursive: true });
    const line = 'export function target(): number { return 1; }';
    fs.writeFileSync(path.join(nestedDir, 'a.ts'), line + '\n');
    const stub = writeRenameStub(dir);

    const col = line.indexOf('target');
    const uri = pathToFileURL(path.join(nestedDir, 'a.ts')).href;
    const renameResult = {
      changes: {
        [uri]: [{ range: { start: { line: 0, character: col }, end: { line: 0, character: col + 6 } }, newText: 'renamed' }],
      },
    };

    const result = await deriveLspRename({
      projectRoot: dir,
      config: lspConfigFor(dir, [process.execPath, stub, '--stdio']),
      language: 'typescript',
      file: 'nested/deep/a.ts',
      position: { line: 1, column: col },
      newName: 'renamed',
      env: { CG_STUB_MODE: 'ok', CG_STUB_RENAME_RESULT: JSON.stringify(renameResult) },
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0]!.file).not.toMatch(/\\/); // no backslashes — the graph's forward-slash convention
    expect(result.edits[0]!.file).toBe('nested/deep/a.ts');
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

  // R25 (rp-review round-4, P0) — the self-loop skip is now POSITIVE: only a
  // FRAMEWORK self-loop sentinel (resolvedBy='framework') is dropped. This guard
  // pins that the framework marker is still excluded even though its recorded span
  // WOULD verify against the live bytes — i.e. the drop is the endpoint+marker guard,
  // not verifySpan. The companion test below pins that a NON-framework self-loop
  // (recursion) now flows through instead of being silently dropped.
  it('R25: drops ONLY a framework self-loop SENTINEL (source===target, resolvedBy=framework) — never an edit even where its span WOULD verify, counted nowhere (FR-004)', async () => {
    const { dir, cg, queries } = await indexFixture({
      'lib.ts': 'export function handler(x) { return x; }\n// handler mention here\n',
    });
    const id = fnId(cg, 'handler');
    // A hand-inserted FRAMEWORK self-loop sentinel — the FR-004 confidence-1.0
    // framework-global marker. Its (line, col) points at a real `handler` token
    // (lib.ts:2, a comment) whose live slice WOULD pass span verification, so ONLY the
    // positive source===target-AND-framework guard drops it (classifyEdgeConfidence
    // cannot see endpoints — the carried-forward T004 rule).
    queries.insertEdge({
      source: id,
      target: id,
      kind: 'references',
      line: 2,
      column: 3,
      metadata: { resolvedBy: 'framework', confidence: 1, refName: 'handler' },
    });
    // Sanity: the statement DOES return the self-loop, so dropping it is the module's job.
    expect(queries.getReferencesToNode(id).some((r) => r.sourceId === id)).toBe(true);

    const result = deriveGraphRename({
      queries,
      projectRoot: dir,
      targetId: id,
      newName: 'process',
    });
    expect(result.edits).toHaveLength(1); // declaration only — the sentinel is never an edit
    expect(result.edits[0]!.range.start.line).toBe(1);
    expect(result.edits.some((e) => e.range.start.line === 2)).toBe(false); // the comment token is never edited
    // Counted nowhere: the sentinel adds nothing to the plan. The lone leftover is the
    // independent comment occurrence (`// handler mention here`), present with or
    // without the sentinel edge; the framework marker is skipped BEFORE the synthesized
    // (provenance='heuristic') dispatch tally, so it contributes 0 there too.
    expect(result.leftoverMentions).toBe(1);
  });

  it('R25: a RECURSIVE self-reference (source===target, non-framework) is span-verified and edited alongside the declaration — not dropped as a sentinel', async () => {
    // The TS resolver emits a genuine self-loop `references` edge for the recursive
    // call (probed: resolvedBy='exact-match' → heuristic tier, provenance null), whose
    // (line, col) IS the real `countdown` occurrence in the body. Before R25 the blanket
    // source===target skip dropped it, so a recursive function's call sites were never
    // renamed and the plan was incomplete; it must now flow through like any reference.
    const { dir, cg, queries } = await indexFixture({
      'rec.ts':
        'export function countdown(n) {\n  if (n <= 0) return;\n  return countdown(n - 1);\n}\n',
    });
    const id = fnId(cg, 'countdown');
    // Sanity: the resolver produced the recursive self-loop this test depends on.
    expect(queries.getReferencesToNode(id).some((r) => r.sourceId === id && r.line === 3)).toBe(true);

    const result = deriveGraphRename({
      queries,
      projectRoot: dir,
      targetId: id,
      newName: 'tick',
    });

    // BOTH the declaration AND the recursive call site are edited (was: declaration only).
    expect(result.edits).toHaveLength(2);
    const declLine = 'export function countdown(n) {';
    const decl = result.edits.find((e) => e.range.start.line === 1)!;
    expect(decl.range.start.column).toBe(declLine.indexOf('countdown')); // 16
    expect(decl.confidence).toBe('exact');

    const callLine = '  return countdown(n - 1);';
    const call = result.edits.find((e) => e.range.start.line === 3)!;
    expect(call).toBeDefined();
    expect(call.range).toEqual({
      start: { line: 3, column: callLine.indexOf('countdown') }, // 9
      end: { line: 3, column: callLine.indexOf('countdown') + 'countdown'.length },
    });
    expect(callLine.slice(call.range.start.column, call.range.end.column)).toBe('countdown');
    expect(call.oldText).toBe('countdown');
    expect(call.newText).toBe('tick');
    expect(call.source).toBe('graph');
    expect(call.confidence).toBe('heuristic'); // resolvedBy='exact-match' → heuristic (FR-004)
    // The recursive call is now a proper edit, so it is no longer a leftover mention.
    expect(result.leftoverMentions).toBe(0);
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
// R18 (rp-review, P0) — the declaration edit must target the declaration NAME,
// not an earlier IDENTICAL token. `graph-rename.ts` located the name with
// `declLine.indexOf(oldName, decl.startColumn)`; the node start column is often a
// KEYWORD that equals the name — an accessor `get`/`set` (`get get()`), an
// `async`/modifier, or a same-line `@name` decorator — so indexOf matched the
// keyword/decorator, and an --apply would corrupt the file (`RENAMED get()`).
// Pinned through the graph derivation with a hand-inserted node whose startColumn
// is CONTROLLED over a hand-written declaration line (the T011 real-SQLite harness);
// the unique node id has no references, so `edits` is the declaration edit alone.
// ---------------------------------------------------------------------------
describe('R18 declaration edit targets the NAME, not a same-name keyword/decorator/parameter (graph path)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  /** Derive the graph plan for a hand-inserted declaration node at a controlled
   *  startColumn over `line`, and return the declaration edit's resolved column. */
  async function declEditColumn(opts: {
    line: string;
    name: string;
    startColumn: number;
    kind?: NodeKind;
  }): Promise<number> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-r18-'));
    // A trivial seed keeps the real extractor busy elsewhere; the decl fixture is
    // written AFTER indexAll so the hand-inserted node owns its identity outright.
    fs.writeFileSync(path.join(dir, 'seed.ts'), 'export const seed = 1;\n');
    const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    const queries = (cg as unknown as { queries: QueryBuilder }).queries;
    cleanups.push(() => {
      cg.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    fs.writeFileSync(path.join(dir, 'decl.ts'), opts.line + '\n');
    const id = `r18:${opts.name}:${opts.startColumn}`;
    queries.insertNode({
      id,
      kind: opts.kind ?? 'method',
      name: opts.name,
      qualifiedName: opts.name,
      filePath: 'decl.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 1,
      startColumn: opts.startColumn,
      endColumn: opts.startColumn + opts.name.length,
      updatedAt: Date.now(),
    });
    const result = deriveGraphRename({ queries, projectRoot: dir, targetId: id, newName: 'RENAMED' });
    expect(result.edits).toHaveLength(1); // no references → the declaration edit alone
    return result.edits[0]!.range.start.column;
  }

  it('an accessor keyword equal to the name (`get get()`) → the edit targets the SECOND `get` (the name), not the accessor keyword', async () => {
    // startColumn 2 is the accessor keyword `get`; indexOf(name, 2) wrongly matches
    // it. The declaration name is the SECOND `get`, at column 6.
    expect(await declEditColumn({ line: '  get get() { return 1; }', name: 'get', startColumn: 2 })).toBe(6);
  });

  it('a decorator reference equal to the name (`@foo foo = …`) → the edit targets the non-@ property occurrence', async () => {
    // startColumn 0 is the `@`; indexOf(name, 0) wrongly matches the `@foo` decorator
    // reference at column 1. The declaration name is the property `foo`, at column 5.
    expect(await declEditColumn({ line: '@foo foo = decorated();', name: 'foo', startColumn: 0, kind: 'property' })).toBe(5);
  });

  it('a same-name parameter (`function foo(foo: number)`) → the edit targets the FIRST `foo` (the name), never the parameter', async () => {
    // The declaration name (col 9) precedes its own parameter (col 13); the gap
    // between them is `(`, not whitespace, so the scan never advances to the param.
    expect(await declEditColumn({ line: 'function foo(foo: number) { return foo; }', name: 'foo', startColumn: 0, kind: 'function' })).toBe(9);
  });

  it('a plain declaration (`class Widget {`) → unchanged: the edit targets the name at/after the keyword', async () => {
    expect(await declEditColumn({ line: 'class Widget {', name: 'Widget', startColumn: 0, kind: 'class' })).toBe(6);
  });

  // R22 (rp-review round-3) — the same keyword-prefix bug when the gap between the
  // keyword and the name is a COMMENT or an intervening keyword (not pure
  // whitespace): the edit must still land on the NAME, never the keyword (which
  // would span-verify and corrupt on --apply). End-to-end through the derivation.
  it('R22: a COMMENT between the accessor keyword and the name (`get /* comment */ get()`) → the SECOND get', async () => {
    expect(await declEditColumn({ line: '  get /* comment */ get() {', name: 'get', startColumn: 2 })).toBe(20);
  });

  it('R22: an intervening keyword (`async function async()`) → the second async, never the keyword', async () => {
    expect(await declEditColumn({ line: 'async function async() {', name: 'async', startColumn: 0, kind: 'function' })).toBe(15);
  });

  // R24 (rp-review round-4) — a signature delimiter (`:`) INSIDE a block comment no
  // longer poisons the delimiter scan: end-to-end, the declaration edit lands on the
  // real name after the comment (col 32), not the accessor keyword before it (col 0,
  // which span-verifies against the live bytes and would corrupt the file on --apply).
  it('R24: a signature delimiter inside a block comment (`get /* returns: cached value */ get()`) → the second get', async () => {
    expect(await declEditColumn({ line: 'get /* returns: cached value */ get() {}', name: 'get', startColumn: 0 })).toBe(32);
  });

  // R26 (rp-review round-5) — a comment opener inside a quoted string (a `//` in a URL)
  // is no longer masked as a comment, so the declaration name after it survives the
  // scan: end-to-end, the edit lands on `Widget` (col 29) instead of the locator
  // returning -1 and the declaration edit being dropped (which surfaces one layer up as
  // a spurious stale-span refusal on an index-fresh file).
  it('R26: a `//` inside a decorator-argument string (`@dec("http://example") class Widget {}`) → the edit targets Widget', async () => {
    expect(await declEditColumn({ line: '@dec("http://example") class Widget {}', name: 'Widget', startColumn: 0, kind: 'class' })).toBe(29);
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
    // D3: this LSP result covers every file the graph independently knows
    // about (a.ts + b.ts) — COMPLETE coverage, so no degradation is recorded.
    expect(plan.lspDegradation).toBeUndefined();
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

  // -------------------------------------------------------------------------
  // D3 — dogfood UAT finding: on a real 381-file TS repo, an ephemeral LSP
  // client issued `textDocument/rename` before tsserver finished project
  // load, so the server answered `ok` from the single open (declaration)
  // file only — silently missing a cross-file import + call site the graph
  // already knew about. `deriveEdits` treated any `status:'ok'` LSP result as
  // authoritative with no completeness check, so the plan (and the apply it
  // fed) covered only the declaration file and left the repo not compiling.
  //
  // Per FR-003a's unusable-result contract (spec.md's overlapping-range
  // clause is the existing precedent — a misbehaving workspace edit "MUST be
  // handled as an unusable rename result that degrades that rename to the
  // graph path"), an `ok` result missing a graph-known file is symmetrically
  // UNUSABLE: the WHOLE rename degrades to the graph derivation (never a
  // per-file merge of the two sources), recording why via `lspDegradation`.
  // -------------------------------------------------------------------------
  it('D3: an ok-status LSP result missing a file the graph already knows about is unusable-incomplete — degrades the WHOLE rename to graph, recording lspDegradation', async () => {
    const { dir, queries } = await setup(forkFixture());
    const stub = writeRenameStub(dir);
    const aCol = A_DECL.indexOf('target');
    // The stub answers `ok`, but its workspace edit covers ONLY the
    // declaration file (a.ts) — it never reaches b.ts's import specifier or
    // its `bus.on(target)` call site, both of which the graph already knows
    // carry a span-verified occurrence of `target` (T012's own fixture).
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'a.ts')).href, version: 1 },
          edits: [{ range: { start: { line: 0, character: aCol }, end: { line: 0, character: aCol + 6 } }, newText: 'renamed' }],
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
    expect(plan.source).toBe('graph'); // NOT lsp — an incomplete ok-result is unusable
    expect(plan.lspDegradation).toBe('incomplete-coverage');
    expect(plan.edits!.some((e) => e.file === 'a.ts')).toBe(true);
    expect(plan.edits!.some((e) => e.file === 'b.ts')).toBe(true); // recovered via the graph path
    for (const e of plan.edits!) expect(e.source).toBe('graph'); // whole-plan degrade, never a per-file merge

    // The degradation reason round-trips through the canonical JSON surface
    // (CLI -j/--json ≡ MCP result) — the same object every consumer sees.
    const obj = JSON.parse(serializeRenamePlanJson(plan));
    expect(obj.lspDegradation).toBe('incomplete-coverage');
  });

  // -------------------------------------------------------------------------
  // D5c / R20 — a set of GENUINELY-DIFFERENT overlapping ranges necessarily
  // includes at least one edit whose live-derived oldText is NOT the target name
  // (two distinct ranges cannot both slice to the same identifier). Since R20's
  // oldName guard marks the WHOLE result `unusable` and is checked BEFORE the
  // overlap check, such a set now degrades as `unsupported-edits` (the wrong-token
  // defect is caught first). Token-aligned overlap — the ONLY overlap where every
  // oldText IS the target name — is identical-range/different-newText, covered by
  // R14 below as `overlapping-edits`; the two reasons no longer collide.
  // -------------------------------------------------------------------------
  it('D5c/R20: genuinely-DIFFERENT overlapping LSP ranges carry a wrong-token edit → the oldName guard degrades to graph as unsupported-edits FIRST (before the overlap check)', async () => {
    const { dir, queries } = await setup({ 'solo.ts': 'export function target(x) { return x; }\n' });
    const stub = writeRenameStub(dir);
    // Two edits on solo.ts whose ranges genuinely overlap ([0,6) and [3,9)) — a
    // malformed/misbehaving workspace edit. Neither slices to `target`
    // (`export` / `ort fu`), so R20's oldName guard fires before the overlap check.
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'solo.ts')).href, version: 1 },
          edits: [
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }, newText: 'AAAAAA' },
            { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 9 } }, newText: 'BBBBBB' },
          ],
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
    expect(plan.source).toBe('graph'); // NOT lsp — a wrong-token edit set is unusable
    expect(plan.lspDegradation).toBe('unsupported-edits'); // R20 guard preempts the overlap check
    for (const e of plan.edits!) expect(e.source).toBe('graph'); // whole-plan degrade, never a per-file merge

    const obj = JSON.parse(serializeRenamePlanJson(plan));
    expect(obj.lspDegradation).toBe('unsupported-edits');
    validate(obj, schema); // schema-covers the enum value
  });

  it('D5c: a fully-coincident duplicate LSP edit is NOT an overlap — still de-duplicates at write time, stays source lsp, no lspDegradation', async () => {
    const { dir, queries } = await setup({ 'solo.ts': 'export function target(x) { return x; }\n' });
    const stub = writeRenameStub(dir);
    const declLine = 'export function target(x) { return x; }';
    const col = declLine.indexOf('target');
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'solo.ts')).href, version: 1 },
          edits: [
            { range: { start: { line: 0, character: col }, end: { line: 0, character: col + 6 } }, newText: 'renamed' },
            { range: { start: { line: 0, character: col }, end: { line: 0, character: col + 6 } }, newText: 'renamed' }, // exact duplicate
          ],
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
    expect(plan.lspDegradation).toBeUndefined();
    // rp-review A4: identical (file+range+newText) LSP edits are now de-duplicated
    // at plan derivation too (not only at writeEdits' apply-time write), so the
    // dry-run preview/JSON never shows the duplicate occurrence twice.
    expect(plan.edits).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // R14 (round-2 review, D1) — the plan-time overlap check's pre-dedup key was
  // `${start}:${end}` WITHOUT `newText`, so two COINCIDENT LSP edits carrying
  // DIFFERENT `newText` (a genuinely contradictory workspace edit — which
  // replacement wins?) collapsed to one span and were NOT flagged as
  // overlapping: the dry-run plan returned source `lsp` carrying both edits,
  // yet apply-time `writeEdits` (whose dedup key DOES include `newText`) would
  // refuse/degrade the same set — a plan/apply disagreement. Including `newText`
  // in the plan-time dedup key (matching `writeEdits`) keeps them two spans, so
  // `hasOverlappingSpans` flags them and the WHOLE rename degrades to graph AT
  // PLAN TIME, exactly like the D5c overlapping-range case above.
  // -------------------------------------------------------------------------
  it('R14: two coincident LSP edits with DIFFERENT newText are a genuine overlap — degrades the WHOLE rename to graph, lspDegradation overlapping-edits (plan≡apply)', async () => {
    const { dir, queries } = await setup({ 'solo.ts': 'export function target(x) { return x; }\n' });
    const stub = writeRenameStub(dir);
    const declLine = 'export function target(x) { return x; }';
    const col = declLine.indexOf('target');
    // Both edits address the IDENTICAL range [col, col+6) but substitute
    // DIFFERENT text — the pre-fix `${start}:${end}` dedup key collapsed them
    // into ONE span (no overlap detected → wrongly accepted as source lsp with
    // both edits). Their live-derived `oldText` is `target` for both (R20's WHERE
    // guard passes), and each `newText` carries the new name `renamed` as a whole
    // word (R23's WHAT guard passes) — so neither unusable guard preempts, and the
    // genuine coincident-but-different-newText overlap is what degrades the plan.
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'solo.ts')).href, version: 1 },
          edits: [
            { range: { start: { line: 0, character: col }, end: { line: 0, character: col + 6 } }, newText: 'renamed' },
            { range: { start: { line: 0, character: col }, end: { line: 0, character: col + 6 } }, newText: 'renamed as alias' },
          ],
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
    expect(plan.source).toBe('graph'); // NOT lsp — coincident-but-different newText is a genuine overlap
    expect(plan.lspDegradation).toBe('overlapping-edits');
    for (const e of plan.edits!) expect(e.source).toBe('graph'); // whole-plan degrade, never a per-file merge

    const obj = JSON.parse(serializeRenamePlanJson(plan));
    expect(obj.lspDegradation).toBe('overlapping-edits');
    validate(obj, schema); // the degraded plan still validates against the contract
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

  // T040 — FR-017 plan-time jail. The apply engine already refuses an out-of-root
  // edit set at Rung 2 (T030), but a DRY-RUN must refuse it too ("at plan and apply
  // time alike", FR-017 / spec Edge Cases). The realistic source is a misbehaving
  // language server whose workspace edit names a file outside the workspace root (a
  // dependency's source, a monorepo sibling) — graph-path occurrences are in-index,
  // hence in-root by construction — so this drives the LSP path with the T009 stub
  // and asserts planRename returns the success-shaped out-of-root refusal, naming
  // only the escaping file, with zero edits.
  it('T040 refuses at plan time (out-of-root) when an LSP workspace edit names a file outside the root — success-shaped, names the file, no edits', async () => {
    const { dir, queries } = await setup({ 'a.ts': A_DECL + '\n' });
    const stub = writeRenameStub(dir);

    // A real file OUTSIDE the workspace root, named by the server's workspace edit.
    // It must exist on disk because the LSP path reads each edited file to recover
    // oldText/lineText and to tally leftovers — so the refusal is the assertion,
    // not an incidental ENOENT.
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-outside-'));
    cleanups.push(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
    const outsideLine = 'export const outsideRef = target;';
    fs.writeFileSync(path.join(outsideDir, 'outside.ts'), outsideLine + '\n');

    const aCol = A_DECL.indexOf('target');
    const outCol = outsideLine.indexOf('target');
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'a.ts')).href, version: 1 },
          edits: [{ range: { start: { line: 0, character: aCol }, end: { line: 0, character: aCol + 6 } }, newText: 'renamed' }],
        },
        {
          textDocument: { uri: pathToFileURL(path.join(outsideDir, 'outside.ts')).href, version: 1 },
          edits: [{ range: { start: { line: 0, character: outCol }, end: { line: 0, character: outCol + 6 } }, newText: 'renamed' }],
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

    expect(plan.refusal?.reason).toBe('out-of-root');
    // The refusal names ONLY the escaping file (workspace-relative), never in-root a.ts.
    const relOutside = path.relative(dir, path.join(outsideDir, 'outside.ts'));
    expect(plan.refusal?.files).toEqual([relOutside]);
    // Whole-plan refusal: no partial edit set, no resolved target leaked, zero writes.
    expect(plan.edits).toBeUndefined();
    expect(plan.applied).toBe(false);
    expect(plan.newName).toBe('renamed');
  });

  // Copilot review finding (PR #44, FR-017): translateWorkspaceEdit
  // (lsp-rename.ts) previously read EVERY workspace-edit file — including an
  // out-of-root one — before the jail above ever runs, violating
  // refuse-before-read. The read-probe: an out-of-root URI whose file does
  // NOT exist on disk. Pre-fix, the unconditional fs.readFileSync throws
  // ENOENT inside deriveLspRename's own try/catch, which mis-classifies it as
  // a generic 'server-crash' LSP failure — silently degrading the WHOLE
  // rename to the graph path (never surfacing the out-of-root condition at
  // all, and never even reaching this test's out-of-root assertions).
  // Post-fix, the file is never opened: the out-of-root URI still flows into
  // the SAME whole-plan out-of-root refusal T040 pins, with zero reads.
  it('T040b refuses at plan time (out-of-root) even when the LSP-named out-of-root file does not exist on disk — never read (Copilot review finding)', async () => {
    const { dir, queries } = await setup({ 'a.ts': A_DECL + '\n' });
    const stub = writeRenameStub(dir);

    // A directory OUTSIDE the workspace root that exists, but the file inside
    // it never gets written — any attempt to read it throws observably.
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-outside-'));
    cleanups.push(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
    const missingOutside = path.join(outsideDir, 'outside.ts'); // deliberately never written

    const aCol = A_DECL.indexOf('target');
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'a.ts')).href, version: 1 },
          edits: [{ range: { start: { line: 0, character: aCol }, end: { line: 0, character: aCol + 6 } }, newText: 'renamed' }],
        },
        {
          textDocument: { uri: pathToFileURL(missingOutside).href, version: 1 },
          edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }, newText: 'renamed' }],
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

    expect(plan.refusal?.reason).toBe('out-of-root');
    const relOutside = path.relative(dir, missingOutside);
    expect(plan.refusal?.files).toEqual([relOutside]);
    expect(plan.edits).toBeUndefined();
    expect(plan.applied).toBe(false);
    expect(plan.newName).toBe('renamed');
  });
});

// ---------------------------------------------------------------------------
// D4 — plan-time index-freshness guard (Slice-2 gate S2-C finding). Index a
// fixture, then mutate a CANDIDATE file on disk WITHOUT re-syncing, and rename.
// Before this fix, per-edge span verification (deriveGraphRename's verifySpan)
// found the live slice ≠ oldName at the drifted position and SILENTLY DROPPED
// just that edit — the identical code path as the deliberate shadow/alias/
// string-similar false-positive exclusion (FR-005/SC-008) — so the remaining
// edits still applied: a partially-renamed workspace with zero user-facing
// signal (the dry-run even reported "all-exact · 0 leftover mention(s)"). The
// fix discriminates on INDEX FRESHNESS OF THE FILE (content_hash/size/
// modified_at vs. live disk state), never the span: a drifted candidate file
// refuses the WHOLE plan `stale-span`; an index-fresh false positive (SC-008)
// still drops silently, unchanged. Real files + real SQLite (T012 harness).
// ---------------------------------------------------------------------------
describe('D4 plan-time index-freshness guard — planRename (stale-span; gate S2-C finding)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  async function setup(
    files: Record<string, string>,
  ): Promise<{ dir: string; cg: CodeGraph; queries: QueryBuilder }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-d4-'));
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

  const disabledLsp = (dir: string) =>
    resolveLspConfig({ projectRoot: dir, cliActivation: 'disable', env: {} });

  // Declaration in a.ts, cross-file import + by-ref occurrence in b.ts — the
  // same shape as T012's forkFixture, so drift can land on either file.
  const A_DECL = 'export function driftTarget(x) { return x; }';
  const B_LINES = [
    "import { driftTarget } from './a';",
    'export function wire(bus) {',
    '  bus.on(driftTarget);',
    '}',
  ];
  const fixture = () => ({ 'a.ts': A_DECL + '\n', 'b.ts': B_LINES.join('\n') + '\n' });

  it('(a) a candidate reference file mutated on disk WITHOUT a re-sync (a line inserted above the reference, shifting its span) refuses the WHOLE plan stale-span, naming the drifted file', async () => {
    const { dir, queries } = await setup(fixture());
    // Drift b.ts: insert an unrelated line above everything, shifting every
    // line number the index recorded for its import specifier + by-ref use.
    fs.writeFileSync(path.join(dir, 'b.ts'), '// unrelated drift\n' + B_LINES.join('\n') + '\n');

    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'driftTarget', kind: 'function' },
      newName: 'renamed',
      lspConfig: disabledLsp(dir),
      env: {},
    });

    expect(plan.refusal?.reason).toBe('stale-span');
    expect(plan.refusal?.files).toEqual(['b.ts']);
    expect(plan.refusal?.message).toMatch(/codegraph sync/);
    // Whole-plan refusal: no partial edit set is ever leaked.
    expect(plan.edits).toBeUndefined();
    expect(plan.applied).toBe(false);
  });

  it('(b) drift on the DECLARATION file itself refuses the WHOLE plan stale-span, naming the declaration file', async () => {
    const { dir, queries } = await setup(fixture());
    fs.writeFileSync(path.join(dir, 'a.ts'), '// unrelated drift\n' + A_DECL + '\n');

    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'driftTarget', kind: 'function' },
      newName: 'renamed',
      lspConfig: disabledLsp(dir),
      env: {},
    });

    expect(plan.refusal?.reason).toBe('stale-span');
    expect(plan.refusal?.files).toEqual(['a.ts']);
    expect(plan.edits).toBeUndefined();
  });

  it('(c) a CRLF line-ending flip on a candidate file (identifier text unchanged) still refuses stale-span — spec.md names CRLF/encoding drift explicitly', async () => {
    const { dir, queries } = await setup(fixture());
    // verifySpan (via lineAt's `.replace(/\r$/, '')`) is \r-tolerant by design —
    // a per-edit check alone would NEVER catch this. Only a file-level compare
    // (content_hash over the raw read string) catches a pure CRLF flip.
    fs.writeFileSync(path.join(dir, 'b.ts'), B_LINES.join('\r\n') + '\r\n');

    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'driftTarget', kind: 'function' },
      newName: 'renamed',
      lspConfig: disabledLsp(dir),
      env: {},
    });

    expect(plan.refusal?.reason).toBe('stale-span');
    expect(plan.refusal?.files).toEqual(['b.ts']);
  });

  it('(d) a candidate reference file DELETED post-index refuses stale-span (never an uncaught crash)', async () => {
    const { dir, queries } = await setup(fixture());
    fs.rmSync(path.join(dir, 'b.ts'));

    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'driftTarget', kind: 'function' },
      newName: 'renamed',
      lspConfig: disabledLsp(dir),
      env: {},
    });

    expect(plan.refusal?.reason).toBe('stale-span');
    expect(plan.refusal?.files).toEqual(['b.ts']);
  });

  it('(e) SC-008 coupling pin: an index-FRESH file with a genuine false positive (string-similar decoy) still drops silently — the plan succeeds, no stale-span refusal', async () => {
    // Mirrors T011's false-positive fixture (mod.ts: target + decoy), but driven
    // through planRename (not deriveGraphRename directly) so the NEW plan-level
    // guard is what is under test. The file is NEVER touched after indexAll, so
    // it must stay fresh and the bad edge must still silently drop.
    const { dir, cg, queries } = await setup({
      'mod.ts': 'export function decoyTarget(x) { return x; }\nexport function decoyDecoy() { return 0; }\n',
    });
    const targetId = cg.getNodesByName('decoyTarget').find((n) => n.kind === 'function')!.id;
    const decoyId = cg.getNodesByName('decoyDecoy').find((n) => n.kind === 'function')!.id;
    const line2 = 'export function decoyDecoy() { return 0; }';
    // A references edge pointing where the live line reads `decoyDecoy`, not
    // `decoyTarget`: the slice ≠ oldName, so span verification drops it — and
    // since mod.ts was never touched after indexing, it must stay a silent drop.
    queries.insertEdge({
      source: decoyId,
      target: targetId,
      kind: 'references',
      line: 2,
      column: line2.indexOf('decoyDecoy'),
      metadata: { resolvedBy: 'import', refName: 'decoyTarget' },
    });

    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'decoyTarget', kind: 'function' },
      newName: 'renamedGoal',
      lspConfig: disabledLsp(dir),
      env: {},
    });

    expect(plan.refusal).toBeUndefined();
    expect(plan.edits).toHaveLength(1); // declaration only — the false positive stays dropped
    expect(plan.edits![0]!.range.start.line).toBe(1);
  });

  it('(f) the remedy loop: after codegraph sync, the identical rename derives a complete plan (no refusal)', async () => {
    const { dir, cg, queries } = await setup(fixture());
    fs.writeFileSync(path.join(dir, 'b.ts'), '// unrelated drift\n' + B_LINES.join('\n') + '\n');

    // Sanity: still drifted before the sync.
    const dryBeforeSync = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'driftTarget', kind: 'function' },
      newName: 'renamed',
      lspConfig: disabledLsp(dir),
      env: {},
    });
    expect(dryBeforeSync.refusal?.reason).toBe('stale-span');

    await cg.sync();
    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'driftTarget', kind: 'function' },
      newName: 'renamed',
      lspConfig: disabledLsp(dir),
      env: {},
    });

    expect(plan.refusal).toBeUndefined();
    expect(plan.edits!.some((e) => e.file === 'a.ts')).toBe(true);
    expect(plan.edits!.some((e) => e.file === 'b.ts')).toBe(true);
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
  // `schema` / `resolveRef` / `validate` are module-scope (shared with the D3
  // tests in T012) — see the block right after the imports.

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

  // D3 — the plan-level `lspDegradation` FYI (an ok-status LSP result rejected
  // as unusable-incomplete; see T012's D3 tests for how the engine derives
  // it). Pure format/serialization coverage here: it renders in the human
  // table, round-trips through the canonical JSON, and the object still
  // schema-validates — `additionalProperties:false` would flag an
  // unregistered key if the schema were not updated alongside the type.
  it('D3: a plan-level lspDegradation renders in the human table footer and the canonical JSON, and the object still schema-validates', () => {
    const plan: RenamePlan = { ...successPlan(), source: 'graph', lspDegradation: 'incomplete-coverage' };

    const table = formatRenamePlanTable(plan);
    expect(table).toContain('incomplete-coverage');

    const obj = JSON.parse(serializeRenamePlanJson(plan));
    validate(obj, schema);
    expect(obj.lspDegradation).toBe('incomplete-coverage');

    // Omitted when absent — a plan that never degraded carries no stray key.
    const plain = JSON.parse(serializeRenamePlanJson(successPlan()));
    validate(plain, schema);
    expect(plain.lspDegradation).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Copilot review finding (PR #44) — formatApplyResultTable's `rolled-back`
// message must name the ACTUAL cause. Before this fix it unconditionally
// blamed "the post-check found dangling references..." even when the
// rollback was forced by the Rung-5 re-sync lock-failure path
// (apply-engine's discriminateSyncResult), which rolls back with an EMPTY
// danglingReferences array and no writeFailure — no post-check ever ran.
// Pure over an ApplyResult value object (no DB), like T013.
// ---------------------------------------------------------------------------
describe('formatApplyResultTable rolled-back message keys on the actual cause (Copilot review finding)', () => {
  function rolledBack(overrides: Partial<ApplyResult>): ApplyResult {
    return {
      outcome: 'rolled-back',
      touchedFiles: ['a.ts'],
      postCheckPassed: false,
      danglingReferences: [],
      ...overrides,
    };
  }

  it('a write-failure-caused rollback names the failed write (writeFailure present) — existing message, pinned', () => {
    const table = formatApplyResultTable(
      rolledBack({ writeFailure: { file: 'a.ts', message: 'EACCES: permission denied' } }),
      'newFn',
    );
    expect(table).toContain('a write to a.ts failed (EACCES: permission denied); no file was left modified.');
    expect(table).not.toContain('post-check found dangling references');
    expect(table).not.toContain('index lock');
  });

  it('a post-check-caused rollback names the dangling references (danglingReferences non-empty, no writeFailure) — existing message, pinned', () => {
    const table = formatApplyResultTable(
      rolledBack({
        danglingReferences: [
          { file: 'a.ts', range: { start: { line: 3, column: 1 }, end: { line: 3, column: 6 } }, name: 'oldFn' },
        ],
      }),
      'newFn',
    );
    expect(table).toContain('the post-check found dangling references to the old name; no file was left modified.');
    expect(table).not.toContain('a write to');
    expect(table).not.toContain('index lock');
  });

  it('a re-sync lock-failure rollback (empty danglingReferences, no writeFailure) gets its OWN message, not the post-check one', () => {
    const table = formatApplyResultTable(rolledBack({}), 'newFn');
    expect(table).not.toContain('post-check found dangling references');
    expect(table).not.toContain('a write to');
    expect(table).toContain('index lock');
    expect(table).toContain('no file was left modified.');
  });
});

// ---------------------------------------------------------------------------
// C6 (rp-review) — the rollback-failed recovery guidance must be ACTIONABLE.
// The old unconditional line "Retrying the restore step alone is safe; do NOT
// re-run the rename" instructed the impossible: no CLI command performs a
// standalone restore. When the snapshot dump succeeded, its dir holds the
// pre-apply bytes of the NOT-restored files (mirroring their relative paths) —
// copy them back and re-sync. When the dump ALSO failed (B5 — no dir), say so
// and flag the files for manual attention. Both keep "Do NOT re-run the rename".
// Pure over an ApplyResult value object (no DB), like the block above.
// ---------------------------------------------------------------------------
describe('formatApplyResultTable rollback-failed guidance is actionable (C6)', () => {
  function rollbackFailed(recovery: RecoveryInfo): ApplyResult {
    return {
      outcome: 'rollback-failed',
      touchedFiles: ['decl.ts', 'caller.ts'],
      postCheckPassed: false,
      recovery,
    };
  }

  it('with a recovery dir → concrete copy-back + `codegraph sync` steps, never the impossible standalone-restore line', () => {
    const table = formatApplyResultTable(
      rollbackFailed({
        restoredFiles: ['decl.ts'],
        unrestoredFiles: ['caller.ts'],
        recoveryDir: '/proj/.codegraph/rename-recovery-123-abc',
      }),
      'gadget',
    );
    expect(table).toContain('recovery dir: /proj/.codegraph/rename-recovery-123-abc');
    // Actionable: copy the preserved pre-apply bytes back, then re-sync the index.
    expect(table).toMatch(/copy/i);
    expect(table).toContain('codegraph sync');
    expect(table).toContain('Do NOT re-run the rename.');
    // The old instruct-the-impossible line is gone.
    expect(table).not.toContain('Retrying the restore step alone is safe');
  });

  it('without a recovery dir (dump also failed, B5) → says the dump failed + names the files for manual attention, still "Do NOT re-run"', () => {
    const table = formatApplyResultTable(
      rollbackFailed({
        restoredFiles: [],
        unrestoredFiles: ['caller.ts'],
        // recoveryDir intentionally absent — the dump itself failed.
      }),
      'gadget',
    );
    expect(table).toContain('the snapshot dump also failed');
    expect(table).toMatch(/manual attention/i);
    expect(table).toContain('codegraph sync');
    expect(table).toContain('Do NOT re-run the rename.');
    expect(table).not.toContain('Retrying the restore step alone is safe');
    expect(table).not.toMatch(/recovery dir: undefined/);
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
// error→exit-1 mapping. The default (no-`--apply`) dry-run surface stays 0/1/2; the
// `--apply` write path and its 0/2/3/4 terminals are covered in T042. Exercised end-to-end
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

    // Parity (FR-027/SC-005), framing contract (R21): the JSON PAYLOAD is
    // byte-identical to the library's own canonical serialization; the CLI stdout
    // appends EXACTLY ONE trailing newline as terminal framing (the MCP text result
    // carries the same payload with NO trailing newline — see rename-mcp.test.ts).
    // Asserted with no trim() so the framing can never silently drift.
    const cg = await CodeGraph.open(dir);
    try {
      const libPlan = await cg.planRename({ name: 'oldFn', kind: 'function' }, 'newFn');
      expect(res.stdout).toBe(serializeRenamePlanJson(libPlan) + '\n');
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

  // `--apply` is now a recognized Slice-2 option (T042 covers its write behavior).
  // Here we only pin that it is NO LONGER an unknown-option usage error and that a
  // recoverable refusal maps to exit 2 — driven through target-not-found so this
  // shared dry-run fixture is never mutated by a successful apply.
  it('--apply is a recognized Slice-2 option: a target-not-found refuses (exit 2), never an unknown-option error, zero writes', () => {
    const res = runRename(['noSuchSymbolAnywhere', 'whatever', '--apply']);
    expect(res.status).toBe(2); // recoverable refusal, NOT commander's unknown-option exit 1
    expect(res.stderr).not.toMatch(/unknown option/i);
    expect(res.stdout).toContain('target-not-found');
    assertFixtureUnchanged();
  });

  it('the dry-run surface maps to the rename exit taxonomy {0,1,2,3,4} (FR-026)', () => {
    const ok = runRename(['soloRenameTarget', 'renamedSolo']).status; // dry-run plan produced
    const refused = runRename(['noSuchSymbolAnywhere', 'whatever']).status; // recoverable refusal
    const usage = runRename(['soloRenameTarget', 'renamedSolo', '--no-such-flag']).status; // commander usage error
    expect(ok).toBe(0); // plan produced
    expect(refused).toBe(2); // recoverable refusal
    expect(usage).toBe(1); // commander's standard unknown-option usage error
    for (const code of [ok, refused, usage]) expect([0, 1, 2, 3, 4]).toContain(code);
    assertFixtureUnchanged();
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
// `unsupported-kind-graph-local`; when the graph path was reached by DEGRADING an
// unavailable server, the message stays honest about WHY — a CONFIGURED-but-
// unexecutable command names itself as the problem (never "did not respond": this
// is a command-availability probe, no server process is ever spawned), while
// nothing configured/found for the language says exactly that.
// The LSP path (FR-009) renames any kind — the resolver lifts
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

  it('FR-003a honesty: unavailable-missing-command (nothing configured/found for the language) → message says no server is configured or found', async () => {
    const { queries } = await indexFixture({ 'm.ts': 'export function f(p) { return p; }\n' });
    insertKindNode(queries, { name: 'localX', kind: 'variable', file: 'm.ts', line: 1 });
    const result = resolveTarget({
      queries,
      selector: { name: 'localX' },
      newName: 'renamedX',
      lspPath: () => 'unavailable-missing-command',
    });
    if (!('reason' in result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('unsupported-kind-graph-local');
    expect(result.message).toMatch(/no local usage tracking/i);
    expect(result.message).toMatch(/none is configured or found/i);
    expect(result.message).not.toMatch(/did not respond/i);
  });

  it('FR-003a honesty: unavailable-command-not-executable (configured but not on PATH/executable) → message names the CONFIGURED command as unavailable, never "did not respond"', async () => {
    const { queries } = await indexFixture({ 'm.ts': 'export function f(p) { return p; }\n' });
    insertKindNode(queries, { name: 'localX', kind: 'variable', file: 'm.ts', line: 1 });
    const result = resolveTarget({
      queries,
      selector: { name: 'localX' },
      newName: 'renamedX',
      lspPath: () => 'unavailable-command-not-executable',
    });
    if (!('reason' in result)) throw new Error('expected a refusal');
    expect(result.reason).toBe('unsupported-kind-graph-local');
    expect(result.message).toMatch(/working language server/i);
    expect(result.message).toMatch(/configured server command is not available/i);
    expect(result.message).not.toMatch(/did not respond/i);
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

// ---------------------------------------------------------------------------
// R1 (rp-review A1) — a graph-local target (variable/parameter) admitted by the
// resolver because the LSP command PROBE said `available`, but whose LSP rename
// then FAILS at runtime (or degrades to an unusable result), must NOT silently
// fall back to a declaration-only graph plan that misses every local usage: the
// whole rename refuses `unsupported-kind-graph-local`. The discriminator is the
// FINAL derivation source — when a graph-local's edits end up on the graph path,
// no language server actually renamed it, so the graph coverage gap is real.
// Real SQLite + a hand-inserted `variable` node (locals aren't extracted) driven
// through a real stub server that crashes mid-rename (T012 harness + stub).
// ---------------------------------------------------------------------------
describe('R1 graph-local runtime-degrade refusal — planRename (FR-010/FR-003a)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  async function setup(files: Record<string, string>): Promise<{ dir: string; queries: QueryBuilder }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-r1-'));
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    const queries = (cg as unknown as { queries: QueryBuilder }).queries;
    cleanups.push(() => {
      cg.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    return { dir, queries };
  }

  it('a variable whose LSP rename crashes at runtime degrades to graph → refuses unsupported-kind-graph-local (never a declaration-only plan), truthfully', async () => {
    const line = 'export function holder(localVarX) { return localVarX; }';
    const { dir, queries } = await setup({ 'm.ts': line + '\n' });
    const stub = writeRenameStub(dir);
    // Hand-insert the local (the TS extractor never emits a `variable` node for a
    // param/local) so the target resolves; its probe says `available` (the stub
    // command exists), so the resolver admits it — the LSP path is only attempted
    // at derivation, where the stub crashes.
    queries.insertNode({
      id: 'test:variable:localVarX',
      kind: 'variable',
      name: 'localVarX',
      qualifiedName: 'localVarX',
      filePath: 'm.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 1,
      startColumn: line.indexOf('localVarX'),
      endColumn: line.indexOf('localVarX') + 'localVarX'.length,
      updatedAt: Date.now(),
    });

    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'localVarX', kind: 'variable' },
      newName: 'renamedX',
      lspConfig: lspConfigFor(dir, [process.execPath, stub, '--stdio']),
      env: { CG_STUB_MODE: 'crash' }, // probe passes (command exists), rename exchange crashes → graph
    });

    expect(plan.refusal?.reason).toBe('unsupported-kind-graph-local');
    // Truthful (D7 precedent): names the language-server dependency, never claims
    // no server is configured (one WAS configured — it just failed at runtime).
    expect(plan.refusal?.message).toMatch(/language server/i);
    expect(plan.refusal?.message).not.toMatch(/none is configured or found/i);
    expect(plan.refusal?.message).not.toMatch(/not on PATH/i);
    // Whole-plan refusal: no partial (declaration-only) edit set is leaked.
    expect(plan.edits).toBeUndefined();
    expect(plan.target).toBeUndefined();
    expect(plan.applied).toBe(false);
  });

  it('a parameter that degrades to graph is likewise refused unsupported-kind-graph-local', async () => {
    const line = 'export function holder(paramP) { return paramP; }';
    const { dir, queries } = await setup({ 'm.ts': line + '\n' });
    const stub = writeRenameStub(dir);
    queries.insertNode({
      id: 'test:parameter:paramP',
      kind: 'parameter',
      name: 'paramP',
      qualifiedName: 'paramP',
      filePath: 'm.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 1,
      startColumn: line.indexOf('paramP'),
      endColumn: line.indexOf('paramP') + 'paramP'.length,
      updatedAt: Date.now(),
    });

    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'paramP', kind: 'parameter' },
      newName: 'renamedP',
      lspConfig: lspConfigFor(dir, [process.execPath, stub, '--stdio']),
      env: { CG_STUB_MODE: 'crash' },
    });

    expect(plan.refusal?.reason).toBe('unsupported-kind-graph-local');
    expect(plan.edits).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// R2 (rp-review A2) — an `ok`-status LSP result whose edit SHAPES are unusable
// must degrade the WHOLE rename to the graph path, recording the new
// lspDegradation `unsupported-edits`, rather than being applied verbatim (which
// would corrupt files). Three unusable shapes: (a) a documentChanges resource
// operation (Create/Rename/DeleteFile) the writer cannot honor, independent of
// containment; (b) an IN-ROOT edit with a multiline range (writeEdits derives
// the end offset from oldText.length, so a multiline range → insert-at-start,
// not replace); (c) an IN-ROOT edit whose live-derived oldText is empty (same
// insert-not-replace corruption). The out-of-root refuse-before-read placeholder
// (also empty oldText) must NOT trip this — its whole-plan out-of-root refusal
// keeps winning (regression pin). Real SQLite + stub server (T012 harness).
// ---------------------------------------------------------------------------
describe('R2 unusable LSP edit shapes degrade to graph — planRename (FR-003a)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  const DECL = 'export function target(x) { return x; }';
  async function setup(): Promise<{ dir: string; queries: QueryBuilder }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-r2-'));
    fs.writeFileSync(path.join(dir, 'solo.ts'), DECL + '\n');
    const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    const queries = (cg as unknown as { queries: QueryBuilder }).queries;
    cleanups.push(() => {
      cg.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    return { dir, queries };
  }

  async function planWith(dir: string, queries: QueryBuilder, renameResult: unknown) {
    const stub = writeRenameStub(dir);
    return planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'target', kind: 'function' },
      newName: 'renamed',
      lspConfig: lspConfigFor(dir, [process.execPath, stub, '--stdio']),
      env: { CG_STUB_MODE: 'ok', CG_STUB_RENAME_RESULT: JSON.stringify(renameResult) },
    });
  }

  it('(a) a documentChanges RenameFile resource operation → source graph, lspDegradation unsupported-edits', async () => {
    const { dir, queries } = await setup();
    const col = DECL.indexOf('target');
    const soloUri = pathToFileURL(path.join(dir, 'solo.ts')).href;
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: soloUri, version: 1 },
          edits: [{ range: { start: { line: 0, character: col }, end: { line: 0, character: col + 6 } }, newText: 'renamed' }],
        },
        // An LSP RenameFile resource op — the symbol writer cannot honor it.
        { kind: 'rename', oldUri: soloUri, newUri: pathToFileURL(path.join(dir, 'moved.ts')).href },
      ],
    };
    const plan = await planWith(dir, queries, renameResult);
    expect(plan.refusal).toBeUndefined();
    expect(plan.source).toBe('graph');
    expect(plan.lspDegradation).toBe('unsupported-edits');
    for (const e of plan.edits!) expect(e.source).toBe('graph');
    const obj = JSON.parse(serializeRenamePlanJson(plan));
    expect(obj.lspDegradation).toBe('unsupported-edits');
    validate(obj, schema); // schema covers the new enum value
  });

  it('(b) an in-root MULTILINE text edit → source graph, lspDegradation unsupported-edits', async () => {
    const { dir, queries } = await setup();
    const col = DECL.indexOf('target');
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'solo.ts')).href, version: 1 },
          // A multiline range — end.line !== start.line: writeEdits would derive
          // the end from oldText.length and insert-at-start instead of replacing.
          edits: [{ range: { start: { line: 0, character: col }, end: { line: 1, character: 0 } }, newText: 'renamed' }],
        },
      ],
    };
    const plan = await planWith(dir, queries, renameResult);
    expect(plan.refusal).toBeUndefined();
    expect(plan.source).toBe('graph');
    expect(plan.lspDegradation).toBe('unsupported-edits');
  });

  it('(c) an in-root edit whose live-derived oldText is empty (zero-width range) → source graph, lspDegradation unsupported-edits', async () => {
    const { dir, queries } = await setup();
    const col = DECL.indexOf('target');
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'solo.ts')).href, version: 1 },
          // A zero-width range on one line → oldText '' — an insert masquerading as a rename.
          edits: [{ range: { start: { line: 0, character: col }, end: { line: 0, character: col } }, newText: 'renamed' }],
        },
      ],
    };
    const plan = await planWith(dir, queries, renameResult);
    expect(plan.refusal).toBeUndefined();
    expect(plan.source).toBe('graph');
    expect(plan.lspDegradation).toBe('unsupported-edits');
  });

  it('(d, R20) an in-root edit over a DIFFERENT token (live oldText ≠ the target old name) → source graph, lspDegradation unsupported-edits', async () => {
    // A buggy server whose range covers `function` (cols 7–15) instead of the
    // `target` identifier: the live-derived oldText is `function`, not `target`, so
    // applying it verbatim would replace the wrong token. Single-line + non-empty, so
    // it slips past the (b)/(c) shape guards — only the oldName comparison catches it.
    const { dir, queries } = await setup();
    const fnStart = DECL.indexOf('function');
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'solo.ts')).href, version: 1 },
          edits: [{ range: { start: { line: 0, character: fnStart }, end: { line: 0, character: fnStart + 'function'.length } }, newText: 'renamed' }],
        },
      ],
    };
    const plan = await planWith(dir, queries, renameResult);
    expect(plan.refusal).toBeUndefined();
    expect(plan.source).toBe('graph'); // NOT lsp — the wrong-token edit is unusable
    expect(plan.lspDegradation).toBe('unsupported-edits');
    for (const e of plan.edits!) expect(e.source).toBe('graph');
    const obj = JSON.parse(serializeRenamePlanJson(plan));
    expect(obj.lspDegradation).toBe('unsupported-edits');
  });

  it('(regression) an out-of-root URI still refuses out-of-root — the refuse-before-read placeholder is NOT treated as an unusable-shape degrade', async () => {
    const { dir, queries } = await setup();
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-r2-outside-'));
    cleanups.push(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
    const outsideLine = 'export const outsideRef = target;';
    fs.writeFileSync(path.join(outsideDir, 'outside.ts'), outsideLine + '\n');
    const col = DECL.indexOf('target');
    const outCol = outsideLine.indexOf('target');
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'solo.ts')).href, version: 1 },
          edits: [{ range: { start: { line: 0, character: col }, end: { line: 0, character: col + 6 } }, newText: 'renamed' }],
        },
        {
          textDocument: { uri: pathToFileURL(path.join(outsideDir, 'outside.ts')).href, version: 1 },
          edits: [{ range: { start: { line: 0, character: outCol }, end: { line: 0, character: outCol + 6 } }, newText: 'renamed' }],
        },
      ],
    };
    const plan = await planWith(dir, queries, renameResult);
    expect(plan.refusal?.reason).toBe('out-of-root');
    expect(plan.lspDegradation).toBeUndefined();
    expect(plan.edits).toBeUndefined();
  });

  it('(e, R23) an in-root edit correctly positioned on the target but whose newText OMITS the requested new name → source graph, lspDegradation unsupported-edits', async () => {
    // A buggy server whose range IS over `target` (so the live oldText matches — the
    // R20 old-name guard passes), single-line + non-empty (slips past the (b)/(c)
    // shape guards), but whose replacement is an UNRELATED identifier: the requested
    // `renamed` is absent, so applying it verbatim would rename to the wrong text.
    // Only the R23 replacement guard catches it.
    const { dir, queries } = await setup();
    const col = DECL.indexOf('target');
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'solo.ts')).href, version: 1 },
          edits: [{ range: { start: { line: 0, character: col }, end: { line: 0, character: col + 6 } }, newText: 'somethingElse' }],
        },
      ],
    };
    const plan = await planWith(dir, queries, renameResult);
    expect(plan.refusal).toBeUndefined();
    expect(plan.source).toBe('graph'); // NOT lsp — the wrong-replacement edit is unusable
    expect(plan.lspDegradation).toBe('unsupported-edits');
    for (const e of plan.edits!) expect(e.source).toBe('graph');
    const obj = JSON.parse(serializeRenamePlanJson(plan));
    expect(obj.lspDegradation).toBe('unsupported-edits');
  });

  it('(f, R23) an in-root edit whose newText CONTAINS the new name as a whole word (server-expanded `old as new`) stays accepted — source lsp, no degradation', async () => {
    // Containment, NOT equality: a legitimate server may expand the replacement
    // (`target as renamed`). `renamed` is present as a whole word, so R23 accepts it
    // — a strict-equality guard would wrongly degrade this, so this pins containment.
    const { dir, queries } = await setup();
    const col = DECL.indexOf('target');
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'solo.ts')).href, version: 1 },
          edits: [{ range: { start: { line: 0, character: col }, end: { line: 0, character: col + 6 } }, newText: 'target as renamed' }],
        },
      ],
    };
    const plan = await planWith(dir, queries, renameResult);
    expect(plan.refusal).toBeUndefined();
    expect(plan.source).toBe('lsp');
    expect(plan.lspDegradation).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// R3 (rp-review A3) — a resolved target whose ordered edit set comes out EMPTY
// (e.g. the declaration edit dropped because its recorded span no longer locates
// the name in the live file, and there are no references) must NOT return a
// success plan with `edits: []` — the published schema requires edits.minItems:1
// and aggregateConfidence([]) misleadingly reports `all-exact`. After the jail
// and D4 drift guards, an empty edit list refuses `stale-span` naming the
// declaration file. Real SQLite + a hand-inserted node whose position points at
// a line NOT containing its name, with the file itself index-fresh (D4 passes).
// ---------------------------------------------------------------------------
describe('R3 zero-edit plan refuses stale-span — planRename (schema edits.minItems:1)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  const disabledLsp = (dir: string) =>
    resolveLspConfig({ projectRoot: dir, cliActivation: 'disable', env: {} });

  it('a declaration whose recorded span no longer locates the name (no references, file index-fresh) → stale-span, not a 0-edit plan', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-r3-'));
    // The live line does NOT contain "phantom" anywhere — so the declaration edit
    // (indexOf the name at/after the node start) is dropped, and there are no refs.
    fs.writeFileSync(path.join(dir, 'm.ts'), 'export function realFn() { return 0; }\n');
    const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    const queries = (cg as unknown as { queries: QueryBuilder }).queries;
    cleanups.push(() => {
      cg.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    // A function node recorded at m.ts:1 col 0 — but line 1 is `export function
    // realFn()...`, which contains no "phantom". The file is NEVER touched after
    // indexAll, so D4's index-freshness guard passes (content_hash matches) and
    // the empty-edit path is what must refuse.
    queries.insertNode({
      id: 'test:function:phantom',
      kind: 'function',
      name: 'phantom',
      qualifiedName: 'phantom',
      filePath: 'm.ts',
      language: 'typescript',
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 7,
      updatedAt: Date.now(),
    });

    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'phantom', kind: 'function' },
      newName: 'renamed',
      lspConfig: disabledLsp(dir),
      env: {},
    });

    expect(plan.refusal?.reason).toBe('stale-span');
    expect(plan.refusal?.files).toEqual(['m.ts']);
    expect(plan.refusal?.message).toMatch(/codegraph sync/);
    // A zero-edit success plan (schema-invalid: edits.minItems:1) is never leaked.
    expect(plan.edits).toBeUndefined();
    expect(plan.confidence).toBeUndefined();
    expect(plan.applied).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R4 (rp-review A4) — duplicate edits must not survive into the plan preview /
// JSON, on EITHER path: (1) the graph reference loop skips a candidate whose
// verified (file,line,col) start was already emitted (two edges recording the
// same occurrence, or an edge landing on the declaration position); (2) the
// accepted-LSP path de-duplicates identical (file+range+newText) edits before
// returning them. (writeEdits already de-dups at write time — this is about the
// dry-run surface an agent reads.) Real SQLite for the graph case; stub server
// for the LSP case (T012 harness).
// ---------------------------------------------------------------------------
describe('R4 duplicate-edit de-duplication — planRename / deriveGraphRename (FR-027)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  const disabledLsp = (dir: string) =>
    resolveLspConfig({ projectRoot: dir, cliActivation: 'disable', env: {} });

  it('(1) two graph reference edges recording the SAME occurrence yield exactly ONE edit at that occurrence', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-r4-'));
    fs.writeFileSync(
      path.join(dir, 'lib.ts'),
      [
        'export function widget(x) { return x; }', // 1 — declaration
        'export function caller() { return 0; }', //  2
        'export function helper() { return 1; }', //  3
        '// widget mention', //                       4 — the shared occurrence
      ].join('\n') + '\n',
    );
    const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    const queries = (cg as unknown as { queries: QueryBuilder }).queries;
    cleanups.push(() => {
      cg.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const widgetId = cg.getNodesByName('widget').find((n) => n.kind === 'function')!.id;
    const callerId = cg.getNodesByName('caller').find((n) => n.kind === 'function')!.id;
    const helperId = cg.getNodesByName('helper').find((n) => n.kind === 'function')!.id;

    // Two DISTINCT references edges (different sources → two real DB rows, not
    // collapsed by the edges unique key) recording the SAME `widget` occurrence
    // in the comment line (4). Before the fix both push an edit → the plan shows
    // line 4 twice; after the fix the second is skipped (its start was already
    // emitted). A third edge lands on the DECLARATION's own position (line 1) —
    // it too must be skipped as already-emitted.
    const commentCol = '// widget mention'.indexOf('widget');
    for (const src of [callerId, helperId]) {
      queries.insertEdge({
        source: src,
        target: widgetId,
        kind: 'references',
        line: 4,
        column: commentCol,
        metadata: { resolvedBy: 'import', refName: 'widget' },
      });
    }
    const declCol = 'export function widget(x) { return x; }'.indexOf('widget');
    queries.insertEdge({
      source: callerId,
      target: widgetId,
      kind: 'references',
      line: 1,
      column: declCol, // lands on the declaration position — a would-be duplicate
      metadata: { resolvedBy: 'import', refName: 'widget' },
    });

    const plan = await planRename({
      queries,
      projectRoot: dir,
      selector: { name: 'widget', kind: 'function' },
      newName: 'gadget',
      lspConfig: disabledLsp(dir),
      env: {},
    });

    expect(plan.refusal).toBeUndefined();
    // Exactly one edit at line 4 (the shared comment occurrence), one at line 1
    // (the declaration) — no duplicate from the two edges or the decl-collision edge.
    expect(plan.edits!.filter((e) => e.range.start.line === 4)).toHaveLength(1);
    expect(plan.edits!.filter((e) => e.range.start.line === 1)).toHaveLength(1);
    const keys = plan.edits!.map((e) => `${e.file}:${e.range.start.line}:${e.range.start.column}`);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate (file,line,col) keys
  });

  it('R6: the public rename API types are importable from the package entry (compile-time pin)', () => {
    // A pure type-level assertion — if any of these were not re-exported from
    // `../src`, the aliased `import type` above would fail tsc. Exercise each so
    // the symbols are genuinely referenced (not tree-shaken as unused).
    const sel: PubTargetSelector = { name: 'x' };
    const refusal: PubRefusal = { reason: 'target-not-found', message: 'no' };
    const plan: PubRenamePlan = { newName: 'y', applied: false, refusal };
    const edit: PubRenameEdit = {
      file: 'a.ts',
      range: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
      oldText: 'x',
      newText: 'y',
      lineText: 'x',
      confidence: 'exact',
      source: 'graph',
    };
    const result: PubApplyResult = { outcome: 'refused', touchedFiles: [], postCheckPassed: false, refusal };
    expect(sel.name).toBe('x');
    expect(plan.applied).toBe(false);
    expect(edit.newText).toBe('y');
    expect(result.outcome).toBe('refused');
  });

  it('(2) a fully-coincident duplicate LSP text edit is de-duplicated in the accepted-LSP plan (source stays lsp)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-r4b-'));
    fs.writeFileSync(path.join(dir, 'solo.ts'), 'export function target(x) { return x; }\n');
    const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    const queries = (cg as unknown as { queries: QueryBuilder }).queries;
    cleanups.push(() => {
      cg.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const stub = writeRenameStub(dir);
    const declLine = 'export function target(x) { return x; }';
    const col = declLine.indexOf('target');
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'solo.ts')).href, version: 1 },
          edits: [
            { range: { start: { line: 0, character: col }, end: { line: 0, character: col + 6 } }, newText: 'renamed' },
            { range: { start: { line: 0, character: col }, end: { line: 0, character: col + 6 } }, newText: 'renamed' }, // exact duplicate
          ],
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
    expect(plan.lspDegradation).toBeUndefined();
    expect(plan.edits).toHaveLength(1); // de-duplicated at plan derivation
  });
});

// ---------------------------------------------------------------------------
// R7 (rp-review A7) — the schema's `refusal` definition (and the `candidates`
// item schema inside it) must be CLOSED (`additionalProperties: false`) like
// every other definition, so an unknown extra property is rejected. Uses the
// module-scope draft-07-subset `validate` + `schema` (which enforce
// additionalProperties:false). Every EXISTING emitted refusal shape must still
// validate — the closure declares exactly the serializer's canonical surface.
// ---------------------------------------------------------------------------
describe('R7 refusal schema is closed — rename-plan.schema.json (additionalProperties:false)', () => {
  it('an adversarial refusal carrying an unknown extra property FAILS validation', () => {
    const adversarial = {
      newName: 'renamed',
      applied: false,
      refusal: { reason: 'target-not-found', message: 'no such symbol', bogusExtra: 42 },
    };
    expect(() => validate(adversarial, schema)).toThrow();
  });

  it('an adversarial CANDIDATE carrying an unknown extra property FAILS validation', () => {
    const adversarial = {
      newName: 'renamed',
      applied: false,
      refusal: {
        reason: 'ambiguous-target',
        message: 'several match',
        candidates: [{ name: 'x', kind: 'function', file: 'a.ts', line: 1, selector: 'X.x', sneaky: true }],
      },
    };
    expect(() => validate(adversarial, schema)).toThrow();
  });

  it('every legitimately-emitted refusal shape still validates (serializer parity)', () => {
    // Drive each real refusal through the serializer and validate the JSON — the
    // schema must match the code's canonical surface, never reject a real field.
    const refusals: Refusal[] = [
      { reason: 'target-not-found', message: 'no such symbol' },
      {
        reason: 'ambiguous-target',
        message: 'several match',
        candidates: [{ name: 'x', kind: 'function', file: 'a.ts', line: 1, selector: 'X.x' }],
      },
      { reason: 'stale-span', message: 'drifted', files: ['a.ts', 'b.ts'] },
      {
        reason: 'heuristic-gated',
        message: 'below exact',
        gatedEdits: [
          {
            file: 'a.ts',
            range: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
            oldText: 'x',
            newText: 'y',
            lineText: 'x',
            confidence: 'heuristic',
            source: 'graph',
          },
        ],
      },
      { reason: 'invalid-argument', message: 'bad kind', validKinds: [...NODE_KINDS] },
    ];
    for (const refusal of refusals) {
      const obj = JSON.parse(serializeRenamePlanJson({ newName: 'renamed', applied: false, refusal }));
      expect(() => validate(obj, schema)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// R16 (round-2 review, D3) — a serialized APPLY result must ALSO validate against
// contracts/rename-plan.schema.json (the same one contract the dry-run plan is
// pinned to). `serializeApplyResultJson` always emits `touchedFiles` and
// `postCheckPassed`, but the schema's envelope (top-level RenamePlan,
// `additionalProperties:false`) declared NEITHER — so every serialized apply
// result violated the published contract. This block drives an APPLIED and a
// ROLLED-BACK result through the serializer and validates the JSON against the
// module-scope draft-07-subset `validate` + `schema` (shared with the T013/R7
// dry-run tests), and keeps the closed-schema guarantee: an apply JSON carrying
// an unknown extra property still FAILS validation.
// ---------------------------------------------------------------------------
describe('R16 serialized apply result validates against rename-plan.schema.json (additionalProperties:false)', () => {
  const applied: ApplyResult = {
    outcome: 'applied',
    touchedFiles: ['a.ts', 'sub/b.ts'],
    postCheckPassed: true,
  };
  const rolledBack: ApplyResult = {
    outcome: 'rolled-back',
    touchedFiles: ['a.ts'],
    postCheckPassed: false,
    danglingReferences: [
      { file: 'a.ts', range: { start: { line: 3, column: 2 }, end: { line: 3, column: 7 } }, name: 'oldFn' },
    ],
  };

  it('an APPLIED result serializes to schema-valid JSON (touchedFiles + postCheckPassed now declared)', () => {
    const obj = JSON.parse(serializeApplyResultJson(applied, 'newFn'));
    validate(obj, schema); // pre-fix: THROWS — touchedFiles/postCheckPassed are undeclared extra keys
    expect(obj.outcome).toBe('applied');
    expect(obj.applied).toBe(true);
    expect(obj.touchedFiles).toEqual(['a.ts', 'sub/b.ts']);
    expect(obj.postCheckPassed).toBe(true);
  });

  it('a ROLLED-BACK result serializes to schema-valid JSON (danglingReferences alongside touchedFiles/postCheckPassed)', () => {
    const obj = JSON.parse(serializeApplyResultJson(rolledBack, 'newFn'));
    validate(obj, schema);
    expect(obj.outcome).toBe('rolled-back');
    expect(obj.applied).toBe(false);
    expect(obj.touchedFiles).toEqual(['a.ts']);
    expect(obj.postCheckPassed).toBe(false);
    // The ONE surface conversion still applies to the dangling range (internal
    // 1-indexed line → 0-based line/character).
    expect(obj.danglingReferences[0].range.start.line).toBe(2);
    expect(obj.danglingReferences[0].range.start.character).toBe(2);
  });

  it('an adversarial apply result carrying an unknown extra property STILL fails validation (schema stays closed)', () => {
    const adversarial = {
      newName: 'newFn',
      applied: true,
      outcome: 'applied',
      touchedFiles: ['a.ts'],
      postCheckPassed: true,
      bogusExtra: 42,
    };
    expect(() => validate(adversarial, schema)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// R5 (rp-review A5) — countLspLeftovers' per-file read must not crash the plan
// with an uncaught internal error when the accepted LSP result names a file the
// index does not cover. NOTE ON REPRODUCIBILITY: an in-root file the server
// invents that is ABSENT from disk cannot exercise the countLspLeftovers crash
// directly — translateWorkspaceEdit (lsp-rename.ts) reads the same in-root file
// FIRST, inside deriveLspRename's own try/catch, so an absent file degrades the
// whole rename to the graph path there (probed: source `graph`, no throw), never
// reaching countLspLeftovers. The countLspLeftovers guard added for A5 is
// defense-in-depth for the plan→count TOCTOU window (a file readable at
// translate, gone at count). What IS deterministically reproducible — and is the
// intended end-state — is an in-root LSP-named file that EXISTS on disk but is
// NOT indexed: the LSP result is accepted (coverage passes), countLspLeftovers
// reads it without crashing, and the D4 drift guard then refuses the WHOLE plan
// `stale-span` (no `files` row). This pins both the no-crash property and that
// refusal path. Real SQLite + stub server (T012 harness).
// ---------------------------------------------------------------------------
describe('R5 countLspLeftovers read safety — planRename (FR-003a / D4)', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  it('an accepted LSP result naming an in-root but UNINDEXED file → no crash; the D4 drift guard refuses the whole plan stale-span', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-r5-'));
    const decl = 'export function target(x) { return x; }';
    fs.writeFileSync(path.join(dir, 'solo.ts'), decl + '\n');
    // A real in-root file that the indexer NEVER saw (created after indexAll):
    // it exists (so translateWorkspaceEdit + countLspLeftovers read it without
    // throwing), but has no `files` row → the D4 drift guard treats it as drifted.
    const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
    await cg.indexAll();
    const queries = (cg as unknown as { queries: QueryBuilder }).queries;
    cleanups.push(() => {
      cg.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const invented = 'export const target2 = target;';
    fs.writeFileSync(path.join(dir, 'invented.ts'), invented + '\n');

    const stub = writeRenameStub(dir);
    const col = decl.indexOf('target');
    const invCol = invented.indexOf('target');
    const renameResult = {
      documentChanges: [
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'solo.ts')).href, version: 1 },
          edits: [{ range: { start: { line: 0, character: col }, end: { line: 0, character: col + 6 } }, newText: 'renamed' }],
        },
        {
          textDocument: { uri: pathToFileURL(path.join(dir, 'invented.ts')).href, version: 1 },
          edits: [{ range: { start: { line: 0, character: invCol }, end: { line: 0, character: invCol + 6 } }, newText: 'renamed' }],
        },
      ],
    };

    let plan: RenamePlan | undefined;
    await expect(
      (async () => {
        plan = await planRename({
          queries,
          projectRoot: dir,
          selector: { name: 'target', kind: 'function' },
          newName: 'renamed',
          lspConfig: lspConfigFor(dir, [process.execPath, stub, '--stdio']),
          env: { CG_STUB_MODE: 'ok', CG_STUB_RENAME_RESULT: JSON.stringify(renameResult) },
        });
      })(),
    ).resolves.toBeUndefined(); // never throws an uncaught internal error

    expect(plan!.refusal?.reason).toBe('stale-span');
    expect(plan!.refusal?.files).toContain('invented.ts');
    expect(plan!.edits).toBeUndefined();
  });
});
