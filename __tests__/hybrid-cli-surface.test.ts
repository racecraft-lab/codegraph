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
});
