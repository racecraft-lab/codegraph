/**
 * SPEC-003 T017 — CLI `query` mode surface (FR-002; contracts/mcp-cli-surface.md).
 *
 * Adds `-m, --mode <mode>` to `codegraph query <search>`. This suite pins the
 * SURFACE contract that is deterministically observable through the built binary
 * WITHOUT a live embedding endpoint:
 *
 *   • help text is byte-exact (mirrors the terse -k/-l style);
 *   • an unspecified / unknown / out-of-enum mode COERCES to `auto` in the action
 *     handler and NEVER exits non-zero (no commander `choices()` constraint);
 *   • every semantic-eligible mode (semantic | hybrid | auto) degrades gracefully to
 *     keyword results with a healthy exit 0 when no provider is configured — the
 *     subprocess case, since tests carry no live endpoint (FR-015, Constitution VI);
 *   • human output stays byte-identical to the #1045 no-score policy (no `%`, no
 *     `[matchType]` tag, no timing/degradation footer — those are T022);
 *   • `--json` keeps the existing shape: `score` rides along, and `matchType` /
 *     `fusedScore` are absent on the keyword/dormant path (they fall out of
 *     `JSON.stringify` only when a fused result populates them).
 *
 * DEFERRED (documented, not skipped): the "hybrid finds a semantic-only target that
 * keyword misses" differentiation needs seeded node vectors AND a working query-
 * embedding provider to embed the query. The provider seam
 * (`__setQueryEmbeddingProviderForTests`) is in-process only and unreachable across
 * the execFileSync subprocess boundary, and no live endpoint exists in tests. The
 * fusion/differentiation behavior is already covered in-process at the library layer
 * (`hybrid-search.test.ts`, 67/67), and the fused-rendering CLI assertions land in
 * T022's in-process render tests. Here we prove routing, coercion, help, exit-codes,
 * and the no-provider degradation path — everything the subprocess CAN observe.
 *
 * Exercised end-to-end against the built binary (matches cli-query-command.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeGraph } from '../src';
import {
  DEGRADATION_HINT_STRINGS,
  provenanceTag,
  timingFooterLine,
  withJsonTiming,
  type SearchTiming,
} from '../src/search/hybrid';
import type { SearchResult } from '../src/types';

const BIN = path.resolve(__dirname, '../dist/bin/codegraph.js');

// The dormant-path assertions require NO ambient embedding provider: a developer
// shell (or direnv loading .envrc.local) would otherwise leak a live endpoint into
// the child process and turn the expected keyword-dormant run into a real fused run.
// Same scrub list as embeddings-dormancy.test.ts.
const EMBEDDING_ENV_VARS = [
  'CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL', 'CODEGRAPH_EMBEDDING_API_KEY',
  'CODEGRAPH_EMBEDDING_DIMS', 'CODEGRAPH_EMBEDDING_BATCH_SIZE', 'CODEGRAPH_EMBEDDING_CONCURRENCY',
  'CODEGRAPH_EMBEDDING_TIMEOUT_MS', 'CODEGRAPH_EMBEDDING_PROVIDER', 'CODEGRAPH_MODEL_BASE_URL',
  'CODEGRAPH_MODEL_CACHE_DIR',
];
const CHILD_ENV: NodeJS.ProcessEnv = { ...process.env, CODEGRAPH_NO_DAEMON: '1', CODEGRAPH_WASM_RELAUNCHED: '1' };
for (const key of EMBEDDING_ENV_VARS) delete CHILD_ENV[key];
// ALSO scrub the in-process worker env: the T023 fixtures run `indexAll()` IN this
// vitest worker, and an ambient config would run a real embedding pass (network I/O
// + pre-populated node_vectors rows that collide with the manual seedVector insert).
for (const key of EMBEDDING_ENV_VARS) delete process.env[key];

/** Run `codegraph query parseToken <extraArgs> -p <cwd>` against the built binary. */
function query(cwd: string, extraArgs: string[]): string {
  return execFileSync(process.execPath, [BIN, 'query', 'parseToken', ...extraArgs, '-p', cwd], {
    encoding: 'utf-8',
    env: CHILD_ENV,
    stdio: ['ignore', 'pipe', 'ignore'], // drop stderr (SQLite experimental warning)
  });
}

/** Run `codegraph query --help` (commander short-circuits to help, exit 0). */
function queryHelp(): string {
  return execFileSync(process.execPath, [BIN, 'query', '--help'], {
    encoding: 'utf-8',
    env: CHILD_ENV,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

describe('codegraph query — --mode surface (SPEC-003 T017)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-query-mode-'));
    fs.mkdirSync(path.join(tempDir, 'src'));
    fs.writeFileSync(
      path.join(tempDir, 'src/auth.ts'),
      'export function parseToken(t: string){ return t.trim(); }\n' +
        'export function parseTokenExpiry(t: string){ return Date.parse(t); }\n',
    );
    const cg = CodeGraph.initSync(tempDir);
    await cg.indexAll();
    cg.close();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('help text lists -m, --mode with the exact terse description', () => {
    const help = queryHelp();
    // Collapse commander's terminal line-wrapping (it hard-wraps the long description
    // across lines with padding) so we assert the byte-exact description WORDING, not
    // the incidental wrap column.
    const flat = help.replace(/\s+/g, ' ');
    expect(flat).toContain('-m, --mode <mode>');
    // Byte-exact description string (mirrors the terse -k/-l option style).
    expect(flat).toContain('Search mode: keyword | semantic | hybrid | auto (default: auto)');
  });

  it('keyword mode returns ranked results and exits 0', () => {
    const out = query(tempDir, ['-m', 'keyword', '-l', '5']);
    expect(out).toContain('parseToken');
    // #1045 no-score policy preserved on the keyword path.
    expect(out).not.toContain('%');
  });

  it('an unknown / out-of-enum mode coerces to auto and exits 0 (no choices() rejection)', () => {
    // A mistyped mode must NEVER exit non-zero — execFileSync throws on non-zero exit,
    // so a clean return here IS the exit-0 assertion. Coercion happens in the action
    // handler, and with no provider `auto` resolves to keyword-eligible results.
    const out = query(tempDir, ['-m', 'banana', '-l', '5']);
    expect(out).toContain('parseToken');
    expect(out).not.toContain('%');
  });

  // With no embedding provider configured (the subprocess reality), every semantic-
  // eligible mode degrades to keyword results with a healthy exit 0 and byte-identical
  // human output — no score, no [matchType] tag, no timing/degradation footer (T022).
  for (const mode of ['semantic', 'hybrid', 'auto'] as const) {
    it(`no provider + ${mode} → keyword results, exit 0, no footer/tag rendered yet`, () => {
      const out = query(tempDir, ['-m', mode, '-l', '5']);
      expect(out).toContain('parseToken');
      expect(out).not.toContain('%'); // no score
      // No provenance tag rendered yet (T022). Match the specific tag literals — a bare
      // `[` would false-positive on chalk's ANSI color escapes (e.g. `\x1b[36m`).
      expect(out).not.toContain('[keyword]');
      expect(out).not.toContain('[semantic]');
      expect(out).not.toContain('[both]');
      expect(out).not.toContain('semantic:'); // no timing footer (T022)
    });
  }

  it('--json keeps the existing shape: score present, matchType/fusedScore absent on the dormant path', () => {
    const parsed = JSON.parse(query(tempDir, ['-m', 'hybrid', '--json', '-l', '5']));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(typeof parsed[0].score).toBe('number');
    // No provider → dormant keyword shape: provenance fields never populated, so
    // JSON.stringify omits them entirely.
    expect(parsed[0].matchType).toBeUndefined();
    expect(parsed[0].fusedScore).toBeUndefined();
  });

  // ── T022: degradation hint footer renders on the subprocess-observable path ──

  it('T022: no provider + hybrid → results lead, verbatim string 1 footer follows (exit 0)', () => {
    const out = query(tempDir, ['-m', 'hybrid', '-l', '5']);
    // Results lead …
    expect(out).toContain('parseToken');
    // … the FR-015 no-provider hint (string 1) follows, VERBATIM.
    expect(out).toContain(DEGRADATION_HINT_STRINGS['no-provider']);
    expect(out.trimEnd().endsWith('to enable.')).toBe(true);
    // Degraded → no timing footer, no provenance tags, no score.
    expect(out).not.toContain('semantic: embed');
    expect(out).not.toContain('[keyword]');
    expect(out).not.toContain('%');
  });

  it('T022: --json on the dormant path never carries embedMs/fusionMs', () => {
    const parsed = JSON.parse(query(tempDir, ['-m', 'hybrid', '--json', '-l', '5']));
    expect(parsed[0].embedMs).toBeUndefined();
    expect(parsed[0].fusionMs).toBeUndefined();
  });
});

// Pure render helpers (FR-008/012). Unit-tested in-process because the fused-render
// path needs the query-embedding provider seam, which is unreachable across the
// execFileSync subprocess boundary — the helpers are the isolable, deterministic core.
describe('SPEC-003 T022 — pure render helpers', () => {
  it('provenanceTag maps each matchType to a leading-space bracket tag', () => {
    expect(provenanceTag('keyword')).toBe(' [keyword]');
    expect(provenanceTag('semantic')).toBe(' [semantic]');
    expect(provenanceTag('both')).toBe(' [both]');
  });

  it('provenanceTag returns EMPTY for a dormant/keyword hit (no matchType) — byte-identical', () => {
    expect(provenanceTag(undefined)).toBe('');
  });

  it('timingFooterLine renders the FR-008 shape with integer ms + middot separator', () => {
    const timing: SearchTiming = { embedMs: 34, fusionMs: 12 };
    expect(timingFooterLine(timing)).toBe('semantic: embed 34ms · fusion 12ms');
    expect(timingFooterLine(timing)).toMatch(/^semantic: embed \d+ms · fusion \d+ms$/);
  });

  it('withJsonTiming attaches embedMs/fusionMs to every result when the semantic arm ran', () => {
    const results = [
      { node: { id: 'a' }, score: 1, matchType: 'semantic', fusedScore: 0.5 },
      { node: { id: 'b' }, score: 0.9, matchType: 'keyword', fusedScore: 0.4 },
    ] as unknown as SearchResult[];
    const out = withJsonTiming(results, { embedMs: 7, fusionMs: 3 }) as unknown as Array<Record<string, unknown>>;
    expect(out).toHaveLength(2);
    for (const r of out) {
      expect(r.embedMs).toBe(7);
      expect(r.fusionMs).toBe(3);
    }
    // matchType/fusedScore preserved.
    expect(out[0].matchType).toBe('semantic');
    expect(out[0].fusedScore).toBe(0.5);
  });

  it('withJsonTiming is a no-op (no embedMs/fusionMs) when timing is absent — keyword/degraded', () => {
    const results = [{ node: { id: 'a' }, score: 1 }] as unknown as SearchResult[];
    const out = withJsonTiming(results, undefined) as unknown as Array<Record<string, unknown>>;
    expect(out).toBe(results); // identity — no wrapping allocation on the dormant path
    expect(out[0].embedMs).toBeUndefined();
    expect(out[0].fusionMs).toBeUndefined();
  });
});

// ── T023: `codegraph status` hybrid-search availability line + --json fields ──
//
// FR-017 / SC-007 (contract: contracts/degradation-hints.md §Status availability line).
// The line is derived SOLELY from the existing getEmbeddingStatus() snapshot — no new
// probe, no live daemon warmth. Exercised end-to-end against the built binary across all
// three reachable states:
//   • yes                                  ⟺ active provider AND ≥1 matching-model vector;
//   • no (no embedding provider configured) ⟺ dormant / misconfigured;
//   • no (no matching-model vectors …)       ⟺ active provider but 0 matching-model vectors.
// The active states need NO live endpoint: getEmbeddingStatus reads CONFIG (env) + coverage
// (DB JOIN) only — never the endpoint — so a dummy URL/MODEL + a seeded node_vectors row
// fully drive the yes/no-vectors branches across the subprocess boundary.
describe('codegraph status — hybrid-search availability (SPEC-003 T023)', () => {
  let tempDir: string;

  // The exact reason literals (contract §Status availability line). The human line wraps
  // the reason in `no (…)`; --json exposes the same reason text verbatim (or null when yes).
  const REASON_NO_PROVIDER = 'no embedding provider configured';
  const REASON_NO_VECTORS = 'no matching-model vectors — run `codegraph sync`';

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-status-hybrid-'));
    fs.mkdirSync(path.join(tempDir, 'src'));
    fs.writeFileSync(
      path.join(tempDir, 'src/auth.ts'),
      'export function parseToken(t: string){ return t.trim(); }\n',
    );
    const cg = CodeGraph.initSync(tempDir);
    await cg.indexAll();
    cg.close();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** Run `codegraph status` (human) against the built binary, embedding env scrubbed. */
  function statusHuman(extraEnv: NodeJS.ProcessEnv = {}): string {
    return execFileSync(process.execPath, [BIN, 'status'], {
      cwd: tempDir,
      encoding: 'utf-8',
      env: { ...CHILD_ENV, ...extraEnv },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  }

  /** Run `codegraph status --json`, parse the single JSON line. */
  function statusJson(extraEnv: NodeJS.ProcessEnv = {}): Record<string, unknown> {
    const out = execFileSync(process.execPath, [BIN, 'status', '--json'], {
      cwd: tempDir,
      encoding: 'utf-8',
      env: { ...CHILD_ENV, ...extraEnv },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(out.trim().split('\n').filter(Boolean).pop()!);
  }

  /** Seed exactly one matching-model vector so coverage.embedded > 0 (the `yes` predicate). */
  function seedVector(model: string): void {
    // require, not import: vite tries to bundle a dynamic import specifier (mirrors
    // status-json.test.ts's index_state seeding).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(tempDir, '.codegraph', 'codegraph.db'));
    const row = db
      .prepare("SELECT id FROM nodes WHERE kind = 'function' LIMIT 1")
      .get() as { id: string } | undefined;
    if (!row) throw new Error('fixture has no embeddable function node to seed a vector for');
    db.prepare(
      'INSERT INTO node_vectors (node_id, model, dims, vector, input_hash) VALUES (?, ?, 1, ?, ?)',
    ).run(row.id, model, Buffer.from([0, 0, 0, 0]), 'seed');
    db.close();
  }

  // Active endpoint provider = both URL and MODEL set. getEmbeddingStatus never reaches
  // the URL, so a dummy is sufficient. Layered over CHILD_ENV's scrub of the same vars.
  const ACTIVE_ENV: NodeJS.ProcessEnv = {
    CODEGRAPH_EMBEDDING_URL: 'http://localhost:9/embed',
    CODEGRAPH_EMBEDDING_MODEL: 'test-model',
  };

  // ── State 1: no provider configured (dormant) ──
  it('no provider → human line reads `no (no embedding provider configured)`', () => {
    const out = statusHuman();
    expect(out).toContain(`Hybrid search available: no (${REASON_NO_PROVIDER})`);
  });

  it('no provider → --json: hybridSearchAvailable=false, hybridSearchReason=<no-provider>', () => {
    const out = statusJson();
    expect(out.hybridSearchAvailable).toBe(false);
    expect(out.hybridSearchReason).toBe(REASON_NO_PROVIDER);
  });

  // ── State 2: active provider but no matching-model vectors (coverage.embedded === 0) ──
  it('active + 0 vectors → human line reads `no (no matching-model vectors — run `codegraph sync`)`', () => {
    const out = statusHuman(ACTIVE_ENV);
    expect(out).toContain(`Hybrid search available: no (${REASON_NO_VECTORS})`);
  });

  it('active + 0 vectors → --json: hybridSearchAvailable=false, hybridSearchReason=<no-vectors>', () => {
    const out = statusJson(ACTIVE_ENV);
    expect(out.hybridSearchAvailable).toBe(false);
    expect(out.hybridSearchReason).toBe(REASON_NO_VECTORS);
  });

  // ── State 3: active provider AND ≥1 matching-model vector → yes ──
  it('active + ≥1 matching vector → human line reads `yes`', () => {
    seedVector('test-model');
    const out = statusHuman(ACTIVE_ENV);
    expect(out).toContain('Hybrid search available: yes');
    // The negative branches must NOT also render.
    expect(out).not.toContain('Hybrid search available: no');
  });

  it('active + ≥1 matching vector → --json: hybridSearchAvailable=true, hybridSearchReason=null', () => {
    seedVector('test-model');
    const out = statusJson(ACTIVE_ENV);
    expect(out.hybridSearchAvailable).toBe(true);
    expect(out.hybridSearchReason).toBeNull();
  });

  // ── null-iff-true invariant (contract): reason is null EXACTLY when available is true ──
  it('hybridSearchReason is null if and only if hybridSearchAvailable is true (all 3 states)', () => {
    const dormant = statusJson();
    expect(dormant.hybridSearchAvailable).toBe(false);
    expect(dormant.hybridSearchReason).not.toBeNull();

    const noVectors = statusJson(ACTIVE_ENV);
    expect(noVectors.hybridSearchAvailable).toBe(false);
    expect(noVectors.hybridSearchReason).not.toBeNull();

    seedVector('test-model');
    const yes = statusJson(ACTIVE_ENV);
    expect(yes.hybridSearchAvailable).toBe(true);
    expect(yes.hybridSearchReason).toBeNull();
  });

  // ── Additive: every existing status --json property stays byte-stable ──
  it('the two hybrid fields are ADDITIVE — existing status --json properties are untouched', () => {
    const out = statusJson();
    // Existing top-level fields (their presence + shape) are preserved.
    expect(out.initialized).toBe(true);
    expect(typeof out.version).toBe('string');
    expect(out.indexPath as string).toContain('.codegraph');
    // Nested snapshots the two fields must NOT be folded into.
    expect(out.embedding).toBeTypeOf('object');
    expect((out.embedding as Record<string, unknown>).hybridSearchAvailable).toBeUndefined();
    expect(out.lsp).toBeTypeOf('object');
    // The new fields are flat, top-level siblings.
    expect(Object.prototype.hasOwnProperty.call(out, 'hybridSearchAvailable')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(out, 'hybridSearchReason')).toBe(true);
  });
});
