/**
 * `codegraph query` score rendering (#1045).
 *
 * The human-readable output used to print `(score * 100)%` next to each hit,
 * but `score` is an unbounded BM25/FTS relevance magnitude (relative-ranking
 * only), so it rendered as nonsensical percentages like "12042%". The CLI now
 * shows no score — results are already in rank order, matching the MCP search
 * tool — while `--json` still carries the raw `score` for programmatic use.
 *
 * Exercised end-to-end against the built binary.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { CodeGraph } from '../src';

const BIN = path.resolve(__dirname, '../dist/bin/codegraph.js');

function cliTestEnv(): NodeJS.ProcessEnv {
  return { ...process.env, CODEGRAPH_NO_DAEMON: '1', CODEGRAPH_WASM_RELAUNCHED: '1' };
}

type CliProcessResult = {
  readonly args: readonly string[];
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
};

type CliQueryProcessOptions = {
  readonly projectPath: string;
  readonly query?: string;
  readonly stdin?: Buffer;
  readonly extraArgs?: readonly string[];
  readonly binPath?: string;
};

/**
 * Expire the Cypher runtime deadline for one subprocess run. Shipped code no
 * longer sniffs query text for a test marker; the enforced deadline comes from
 * the environment, and `cliTestEnv()` spreads `process.env` into the child.
 */
function withExpiredCypherDeadline<T>(run: () => T): T {
  const previous = process.env.CODEGRAPH_CYPHER_DEADLINE_MS;
  process.env.CODEGRAPH_CYPHER_DEADLINE_MS = '0';
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.CODEGRAPH_CYPHER_DEADLINE_MS;
    } else {
      process.env.CODEGRAPH_CYPHER_DEADLINE_MS = previous;
    }
  }
}

function malformedCliStdinBytes(): Buffer {
  return Buffer.from([0xc3, 0x28]);
}

function asBuffer(value: Buffer | string | null | undefined): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  return Buffer.from(value ?? '');
}

function runCliQueryProcess(options: CliQueryProcessOptions): CliProcessResult {
  const { projectPath, query: queryText, stdin, extraArgs = [], binPath = BIN } = options;

  if ((queryText === undefined) === (stdin === undefined)) {
    throw new Error('Provide exactly one CLI query source: query or stdin');
  }

  const operand = stdin === undefined ? queryText : '-';
  if (operand === undefined) {
    throw new Error('CLI query source was not resolved');
  }

  const args: string[] = [binPath, 'query', operand, ...extraArgs, '--path', projectPath];
  const result = spawnSync(process.execPath, args, {
    env: cliTestEnv(),
    input: stdin,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw result.error;
  }

  return {
    args,
    stdout: asBuffer(result.stdout),
    stderr: asBuffer(result.stderr),
    exitCode: result.status,
    signal: result.signal,
  };
}

function runCliQueryMatch(
  projectPath: string,
  queryText: string,
  extraArgs: readonly string[] = [],
  binPath = BIN,
): CliProcessResult {
  return runCliQueryProcess({ projectPath, query: queryText, extraArgs, binPath });
}

function runCliQueryStdin(
  projectPath: string,
  stdin: Buffer,
  extraArgs: readonly string[] = [],
  binPath = BIN,
): CliProcessResult {
  return runCliQueryProcess({ projectPath, stdin, extraArgs, binPath });
}

function runCliSearchText(
  projectPath: string,
  searchText: string,
  extraArgs: readonly string[] = [],
  binPath = BIN,
): CliProcessResult {
  const args = searchText.startsWith('-')
    ? [binPath, 'search', ...extraArgs, '--path', projectPath, '--', searchText]
    : [binPath, 'search', searchText, ...extraArgs, '--path', projectPath];
  const result = spawnSync(process.execPath, args, {
    env: cliTestEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw result.error;
  }

  return {
    args,
    stdout: asBuffer(result.stdout),
    stderr: asBuffer(result.stderr),
    exitCode: result.status,
    signal: result.signal,
  };
}

function query(cwd: string, extraArgs: string[]): string {
  return execFileSync(process.execPath, [BIN, 'query', 'parseToken', ...extraArgs, '-p', cwd], {
    encoding: 'utf-8',
    env: cliTestEnv(),
    stdio: ['ignore', 'pipe', 'ignore'], // drop stderr (SQLite experimental warning)
  });
}

type CypherCliJson = Record<string, unknown> & {
  readonly status: string;
};

const CYPHER_CLI_MATCH_QUERY =
  "MATCH (caller:function)-[:calls]->(callee:function) WHERE caller.name = 'entry' RETURN caller.name AS caller, callee.name AS callee ORDER BY callee.name LIMIT 1";

const CYPHER_T032_VALID_QUERY = CYPHER_CLI_MATCH_QUERY;
const CYPHER_T032_EMPTY_QUERY =
  "MATCH (caller:function)-[:calls]->(callee:function) WHERE caller.name = 'doesNotExist' RETURN caller.name LIMIT 5";
const CYPHER_T032_CAPPED_QUERY = 'MATCH (caller:function)-[:calls]->(callee:function) RETURN caller.name AS caller LIMIT 1';
const CYPHER_T032_SYNTAX_QUERY = 'MATCH (caller:function)-[:calls]-> RETURN caller.name LIMIT 1';
const CYPHER_T032_UNSUPPORTED_WRITE_QUERY =
  'MATCH (caller:function)-[:calls]->(callee:function) DELETE callee RETURN caller.name LIMIT 1';
const CYPHER_T032_TIMEOUT_QUERY =
  'MATCH p = (caller:function)-[:calls*1..8]->(callee:function) RETURN p';
const CYPHER_T032_OUTPUT_TOO_LARGE_QUERY = 'MATCH (a:function)-[:calls]->(b:function) RETURN a, b LIMIT 1000';

type T032CliExpectedState = 'success' | 'diagnostic' | 'timeout';

type T032CliScenario = {
  readonly name: string;
  readonly expectedStatus: T032CliExpectedState;
  readonly expectedExitCode: number;
  readonly expectedCode?: string;
  readonly expectedRows?: number;
  readonly expectedTruncated?: boolean;
  readonly query?: string;
  readonly stdin?: () => Buffer;
  readonly prepare?: (projectPath: string) => void;
  readonly useUnindexedProject?: boolean;
};

function createCypherCliProject(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-cypher-cli-'));
  fs.mkdirSync(path.join(tempDir, 'src'));
  fs.writeFileSync(
    path.join(tempDir, 'src/main.ts'),
    [
      'export function helper(value: string): string {',
      '  return value.trim();',
      '}',
      '',
      'export function entry(value: string): string {',
      '  return helper(value);',
      '}',
      '',
      'export function parseToken(token: string): string {',
      '  return helper(token);',
      '}',
      '',
      'export function MATCH(): string {',
      "  return 'literal MATCH symbol';",
      '}',
      '',
      'export function dashSearchToken(): string {',
      "  return 'literal dash search symbol';",
      '}',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(tempDir, 'src/-dashSearchToken.ts'),
    [
      'export function dashSearchTokenFromDashFile(): string {',
      "  return 'literal dash-prefixed file path search symbol';",
      '}',
      '',
    ].join('\n'),
  );
  const cg = CodeGraph.initSync(tempDir);
  cg.close();
  return tempDir;
}

function oversizedCypherInputBytes(): Buffer {
  return Buffer.from(oversizedCypherQueryText(), 'utf8');
}

function oversizedMalformedCypherStdinBytes(): Buffer {
  return Buffer.concat([
    Buffer.from(`stdin-byte-ceiling-secret-${'x'.repeat(30_001)}`, 'utf8'),
    malformedCliStdinBytes(),
  ]);
}

function oversizedCypherQueryText(secretPrefix = 'oversized'): string {
  return `MATCH (n:function) WHERE n.name = '${secretPrefix}-${'oversized'.repeat(1_260)}' RETURN n.name LIMIT 1`;
}

function addOversizedCypherPayloadRows(projectPath: string): void {
  const db = new DatabaseSync(path.join(projectPath, '.codegraph', 'codegraph.db'));
  const insertNode = db.prepare(`
    INSERT OR REPLACE INTO nodes (
      id, kind, name, qualified_name, file_path, language,
      start_line, end_line, start_column, end_column,
      docstring, signature, visibility,
      is_exported, is_async, is_static, is_abstract,
      decorators, type_parameters, return_type, updated_at
    )
    VALUES (?, 'function', ?, ?, 'src/oversized.ts', 'typescript', 1, 1, 0, 1, ?, null, null, 0, 0, 0, 0, null, null, null, 1700000000000)
  `);
  const insertEdge = db.prepare(`
    INSERT INTO edges (source, target, kind, metadata, line, col, provenance)
    VALUES (?, ?, 'calls', null, ?, 0, 'tree-sitter')
  `);
  db.exec('BEGIN');
  try {
    const wideDocstring = 'payload'.repeat(600);
    for (let index = 0; index < 420; index += 1) {
      const ordinal = String(index).padStart(4, '0');
      const sourceId = `function:t032:oversized:source:${ordinal}`;
      const targetId = `function:t032:oversized:target:${ordinal}`;
      insertNode.run(sourceId, `oversizedSource${ordinal}`, `oversizedSource${ordinal}`, `${wideDocstring}:source:${ordinal}`);
      insertNode.run(targetId, `oversizedTarget${ordinal}`, `oversizedTarget${ordinal}`, `${wideDocstring}:target:${ordinal}`);
      insertEdge.run(sourceId, targetId, 10_000 + index);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}

async function indexCypherCliProject(tempDir: string): Promise<void> {
  const cg = await CodeGraph.open(tempDir);
  try {
    await cg.indexAll();
  } finally {
    cg.close();
  }
}

function previewBuffer(buffer: Buffer): string {
  return buffer.toString('utf8').replace(/\s+/g, ' ').slice(0, 220);
}

function parseJsonPayload(result: CliProcessResult, context: string): unknown {
  const text = result.stdout.toString('utf8');
  if (text.length === 0) {
    throw new Error(
      `SPEC-013 Cypher CLI contract missing: ${context} expected canonical JSON on stdout, ` +
        `but stdout was empty. exit=${result.exitCode} stderr="${previewBuffer(result.stderr)}"`,
    );
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `SPEC-013 Cypher CLI contract missing: ${context} expected parseable canonical JSON. ` +
        `exit=${result.exitCode} stdout="${previewBuffer(result.stdout)}" ` +
        `stderr="${previewBuffer(result.stderr)}" ` +
        `parseError=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function expectCypherResultObject(result: CliProcessResult, context: string): CypherCliJson {
  const parsed = parseJsonPayload(result, context);
  if (Array.isArray(parsed)) {
    throw new Error(
      `SPEC-013 Cypher CLI routing contract missing: ${context} returned legacy search JSON array ` +
        'instead of a Cypher result union object.',
    );
  }
  if (!parsed || typeof parsed !== 'object' || !('status' in parsed)) {
    throw new Error(
      `SPEC-013 Cypher CLI result contract missing: ${context} expected a result union object with status. ` +
        `payload="${previewBuffer(result.stdout)}"`,
    );
  }
  return parsed as CypherCliJson;
}

function expectNoTrailingNewline(result: CliProcessResult, context: string): void {
  expect(result.stdout.length, `${context} stdout length`).toBeGreaterThan(0);
  const lastByte = result.stdout[result.stdout.length - 1];
  if (lastByte === 0x0a || lastByte === 0x0d) {
    throw new Error(
      `SPEC-013 Cypher CLI canonical JSON contract missing: ${context} emitted trailing newline/framing byte.`,
    );
  }
}

function expectCypherCliSuccess(result: CliProcessResult, context: string): CypherCliJson {
  if (result.exitCode !== 0) {
    throw new Error(
      `SPEC-013 Cypher CLI success contract missing: ${context} expected exit 0. ` +
        `exit=${result.exitCode} stdout="${previewBuffer(result.stdout)}" stderr="${previewBuffer(result.stderr)}"`,
    );
  }
  const payload = expectCypherResultObject(result, context);
  expect(payload.status).toBe('success');
  expect(Array.isArray(payload.columns)).toBe(true);
  expect(Array.isArray(payload.rows)).toBe(true);
  return payload;
}

function expectCypherCliDiagnostic(result: CliProcessResult, code: string, context: string): CypherCliJson {
  if (result.exitCode === 0) {
    throw new Error(
      `SPEC-013 Cypher CLI failure-exit contract missing: ${context} expected non-zero exit for ${code}. ` +
        `stdout="${previewBuffer(result.stdout)}" stderr="${previewBuffer(result.stderr)}"`,
    );
  }
  const payload = expectCypherResultObject(result, context);
  expect(payload.status).toBe('diagnostic');
  expect(payload.code).toBe(code);
  expect(typeof payload.message).toBe('string');
  expect(typeof payload.offset).toBe('number');
  expect(typeof payload.line).toBe('number');
  expect(typeof payload.column).toBe('number');
  expect(typeof payload.expected).toBe('string');
  expect(typeof payload.anchor).toBe('string');
  expect(typeof payload.excerpt).toBe('string');
  expect(typeof payload.truncatedBefore).toBe('boolean');
  expect(typeof payload.truncatedAfter).toBe('boolean');
  return payload;
}

function expectT032CliJsonState(result: CliProcessResult, scenario: T032CliScenario): CypherCliJson {
  expectNoTrailingNewline(result, scenario.name);
  expect(result.exitCode, `${scenario.name} exit code`).toBe(scenario.expectedExitCode);
  const payload = expectCypherResultObject(result, scenario.name);
  expect(payload.status, `${scenario.name} status`).toBe(scenario.expectedStatus);
  if (scenario.expectedCode !== undefined) {
    expect(payload.code, `${scenario.name} diagnostic code`).toBe(scenario.expectedCode);
  }
  if (scenario.expectedRows !== undefined) {
    expect(payload.rows, `${scenario.name} rows`).toHaveLength(scenario.expectedRows);
  }
  if (scenario.expectedTruncated !== undefined) {
    expect(payload.truncated, `${scenario.name} truncated`).toBe(scenario.expectedTruncated);
  }
  if (scenario.expectedStatus === 'timeout') {
    expect(payload).not.toHaveProperty('rows');
  }
  return payload;
}

function expectLegacySearchJsonArray(result: CliProcessResult, context: string): readonly Record<string, unknown>[] {
  expect(result.exitCode, `${context} exit code`).toBe(0);
  const payload = parseJsonPayload(result, context);
  if (!Array.isArray(payload)) {
    throw new Error(
      `SPEC-013 search alias contract missing: ${context} expected legacy search JSON array, ` +
        `but received "${previewBuffer(result.stdout)}"`,
    );
  }
  return payload as readonly Record<string, unknown>[];
}

/** Per-result wall-clock fields; identical inputs still produce different numbers. */
const LEGACY_SEARCH_TIMING_FIELDS = ['embedMs', 'fusionMs'] as const;

function withoutSearchTimings(result: CliProcessResult): unknown {
  const payload = JSON.parse(result.stdout.toString('utf8')) as unknown;
  if (!Array.isArray(payload)) {
    return payload;
  }
  return payload.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return entry;
    }
    const stripped: Record<string, unknown> = { ...(entry as Record<string, unknown>) };
    for (const field of LEGACY_SEARCH_TIMING_FIELDS) {
      delete stripped[field];
    }
    return stripped;
  });
}

describe('codegraph query — score rendering (#1045)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-query-cmd-'));
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

  it('human output ranks results without rendering a raw score as a percentage', () => {
    const out = query(tempDir, ['-l', '5']);
    // Still finds and lists the symbol...
    expect(out).toContain('parseToken');
    // ...but never prints the bogus `(12042%)`-style score.
    expect(out).not.toMatch(/\(\d+%\)/);
    expect(out).not.toContain('%');
  });

  it('--json still carries the raw numeric score for programmatic use', () => {
    const parsed = JSON.parse(query(tempDir, ['-l', '5', '--json']));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(typeof parsed[0].score).toBe('number');
  });
});

describe('SPEC-013 codegraph query Cypher CLI contracts', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = createCypherCliProject();
    await indexCypherCliProject(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('routes positional MATCH text through Cypher mode with shared --path and --json result union', () => {
    const result = runCliQueryMatch(tempDir, CYPHER_CLI_MATCH_QUERY, ['--json']);

    expect(result.args).toEqual([BIN, 'query', CYPHER_CLI_MATCH_QUERY, '--json', '--path', tempDir]);
    const payload = expectCypherCliSuccess(result, 'positional MATCH --json query');
    expect(JSON.stringify(payload)).toContain('entry');
    expect(JSON.stringify(payload)).toContain('helper');
    expect(payload).toMatchObject({
      status: 'success',
      effectiveCap: 1,
      truncated: false,
    });
  });

  it('emits canonical minified JSON bytes for Cypher --json without a trailing newline', () => {
    const result = runCliQueryMatch(tempDir, CYPHER_CLI_MATCH_QUERY, ['--json']);

    expectNoTrailingNewline(result, 'positional MATCH --json query');
    expect(result.stdout.toString('utf8')).not.toContain('\n');
    expect(result.stdout.toString('utf8')).not.toContain('  ');
    expectCypherCliSuccess(result, 'canonical Cypher --json query');
  });

  it('reads bounded UTF-8 Cypher text from query - stdin', () => {
    const stdin = Buffer.from(CYPHER_CLI_MATCH_QUERY, 'utf8');
    const result = runCliQueryStdin(tempDir, stdin, ['--json']);

    expect(result.args).toEqual([BIN, 'query', '-', '--json', '--path', tempDir]);
    const payload = expectCypherCliSuccess(result, 'stdin - Cypher query');
    expect(JSON.stringify(payload)).toContain('entry');
    expect(JSON.stringify(payload)).toContain('helper');
  });

  it.each([
    ['unsupported OpenCypher', 'OPTIONAL MATCH (n:function) RETURN n LIMIT 1', 'CYPHER_UNSUPPORTED_OPENCYPHER'],
    ['mutating/direct SQL', 'CREATE (n:function)', 'CYPHER_DIRECT_SQL_UNSUPPORTED'],
    ['malformed query', 'not valid Cypher', 'CYPHER_SYNTAX'],
  ])('preserves stdin provenance and routes non-MATCH %s text through Cypher', (_name, stdinText, expectedCode) => {
    const result = runCliQueryStdin(tempDir, Buffer.from(stdinText, 'utf8'), ['--json']);

    const diagnostic = expectCypherCliDiagnostic(result, expectedCode, `${_name} stdin`);
    expect(diagnostic.status).toBe('diagnostic');
    expect(Array.isArray(parseJsonPayload(result, `${_name} stdin`))).toBe(false);
    expectNoTrailingNewline(result, `${_name} stdin`);
  });

  it('rejects malformed stdin bytes before parsing or execution with a failure exit', () => {
    const result = runCliQueryStdin(tempDir, malformedCliStdinBytes(), ['--json']);

    const diagnostic = expectCypherCliDiagnostic(result, 'CYPHER_INVALID_STDIN_ENCODING', 'malformed UTF-8 stdin');
    expect(diagnostic).toMatchObject({
      offset: 0,
      line: 1,
      column: 0,
      expected: 'valid UTF-8 stdin',
      anchor: 'cli-input',
      excerpt: '',
      truncatedBefore: false,
      truncatedAfter: false,
    });
    expect(String(diagnostic.message)).not.toContain('c328');
    expect(previewBuffer(result.stderr)).not.toContain('c328');
  });

  it('covers final T059 malformed stdin and positional oversized query privacy diagnostics', () => {
    const malformed = runCliQueryStdin(tempDir, malformedCliStdinBytes(), ['--json']);
    const malformedDiagnostic = expectCypherCliDiagnostic(
      malformed,
      'CYPHER_INVALID_STDIN_ENCODING',
      'T059 malformed UTF-8 stdin',
    );
    expectNoTrailingNewline(malformed, 'T059 malformed UTF-8 stdin');
    expect(malformedDiagnostic).toMatchObject({
      offset: 0,
      line: 1,
      column: 0,
      expected: 'valid UTF-8 stdin',
      anchor: 'cli-input',
      excerpt: '',
      truncatedBefore: false,
      truncatedAfter: false,
    });
    expect(`${malformed.stdout.toString('utf8')} ${malformed.stderr.toString('utf8')}`).not.toContain('c328');

    const oversizedQuery = oversizedCypherQueryText('final-oversized-secret');
    const oversized = runCliQueryMatch(tempDir, oversizedQuery, ['--json']);
    const oversizedDiagnostic = expectCypherCliDiagnostic(
      oversized,
      'CYPHER_INPUT_TOO_LONG',
      'T059 positional oversized query text',
    );
    expectNoTrailingNewline(oversized, 'T059 positional oversized query text');
    expect(oversizedDiagnostic.excerpt).toBe('');
    expect(String(oversizedDiagnostic.message)).toContain('10000');
    expect(`${oversized.stdout.toString('utf8')} ${oversized.stderr.toString('utf8')}`).not.toContain('final-oversized-secret');
    expect(`${oversized.stdout.toString('utf8')} ${oversized.stderr.toString('utf8')}`).not.toContain('oversizedoversized');
  });

  it('rejects stdin text longer than the 10,000 UTF-16 code unit ceiling before parsing', () => {
    const oversized = Buffer.from(`MATCH ${'x'.repeat(10_050)}`, 'utf8');
    const result = runCliQueryStdin(tempDir, oversized, ['--json']);

    const diagnostic = expectCypherCliDiagnostic(result, 'CYPHER_INPUT_TOO_LONG', 'oversized stdin query');
    expect(diagnostic.excerpt).toBe('');
    expect(String(diagnostic.message)).toContain('10000');
    expect(String(diagnostic.message)).not.toContain('xxxxxxxx');
  });

  it('enforces the incremental stdin byte ceiling before UTF-8 decoding without leaking input', () => {
    const result = runCliQueryStdin(tempDir, oversizedMalformedCypherStdinBytes(), ['--json']);

    const diagnostic = expectCypherCliDiagnostic(
      result,
      'CYPHER_INPUT_TOO_LONG',
      'oversized malformed stdin byte stream',
    );
    expect(diagnostic.excerpt).toBe('');
    expect(String(diagnostic.message)).toContain('10000');
    expect(`${result.stdout.toString('utf8')} ${result.stderr.toString('utf8')}`).not.toContain(
      'stdin-byte-ceiling-secret',
    );
    expectNoTrailingNewline(result, 'oversized malformed stdin byte stream');
  });

  it.each([
    ['--kind', 'function'],
    ['--mode', 'keyword'],
    ['--limit', '1'],
    ['--file', 'src/main.ts'],
  ])('rejects search-only flag %s in Cypher mode before execution', (flag, value) => {
    const result = runCliQueryMatch(tempDir, CYPHER_CLI_MATCH_QUERY, ['--json', flag, value]);

    const diagnostic = expectCypherCliDiagnostic(result, 'CYPHER_UNSUPPORTED', `${flag} in Cypher mode`);
    expect(String(diagnostic.message)).toContain(flag);
    expect(JSON.stringify(diagnostic)).not.toContain('entry');
    expect(JSON.stringify(diagnostic)).not.toContain('helper');
  });

  it('requires Cypher row limits inside query text instead of CLI --limit', () => {
    const inTextLimit = runCliQueryMatch(tempDir, CYPHER_CLI_MATCH_QUERY, ['--json']);
    const payload = expectCypherCliSuccess(inTextLimit, 'Cypher LIMIT inside query text');
    expect(payload.effectiveCap).toBe(1);

    const cliLimit = runCliQueryMatch(tempDir, CYPHER_CLI_MATCH_QUERY, ['--json', '--limit', '1']);
    expectCypherCliDiagnostic(cliLimit, 'CYPHER_UNSUPPORTED', 'CLI --limit in Cypher mode');
  });

  it('preserves legacy symbol search for non-MATCH query text', () => {
    const result = runCliQueryMatch(tempDir, 'parseToken', ['--json']);

    expect(result.exitCode).toBe(0);
    const payload = parseJsonPayload(result, 'legacy non-MATCH query');
    expect(Array.isArray(payload)).toBe(true);
    expect(JSON.stringify(payload)).toContain('parseToken');
    expect(JSON.stringify(payload)).toContain('score');
  });

  it.each(['match', 'match(', 'matcher'])(
    'keeps lowercase %s on keyword search instead of routing it into Cypher',
    (searchText) => {
      // Cypher mode is entered on an uppercase MATCH only. Matching the keyword
      // case-insensitively would turn an ordinary search for a common English
      // word into a parse diagnostic and a non-zero exit, breaking the
      // never-error posture the legacy search path guarantees.
      const result = runCliQueryMatch(tempDir, searchText, ['--json']);

      expect(result.exitCode, `${searchText} exit code`).toBe(0);
      expect(Array.isArray(parseJsonPayload(result, `lowercase ${searchText} query`))).toBe(true);
      expect(result.stdout.toString('utf8')).not.toContain('"status"');
      expect(result.stderr.toString('utf8')).not.toContain('CYPHER_');
    },
  );

  it('supports explicit codegraph search as the unchanged legacy search alias', () => {
    const legacyQuery = runCliQueryMatch(tempDir, 'parseToken', ['--json']);
    const explicitSearch = runCliSearchText(tempDir, 'parseToken', ['--json']);

    expectLegacySearchJsonArray(explicitSearch, 'explicit codegraph search parseToken');
    // Compare parsed payloads with timings stripped: the legacy search envelope
    // carries per-result wall-clock fields (`embedMs`, `fusionMs`) that differ
    // between two subprocess runs whenever an embedding provider is configured,
    // so a raw stdout comparison fails on timing rather than on aliasing.
    expect(withoutSearchTimings(explicitSearch)).toEqual(withoutSearchTimings(legacyQuery));
  });

  it('keeps literal MATCH-prefixed terms on the explicit search alias instead of routing to Cypher', () => {
    const result = runCliSearchText(tempDir, 'MATCH', ['--json']);

    const payload = expectLegacySearchJsonArray(result, 'literal MATCH search alias');
    expect(JSON.stringify(payload)).toContain('MATCH');
    expect(result.stdout.toString('utf8')).not.toContain('"status"');
    expect(result.stderr.toString('utf8')).not.toContain('CYPHER_');
  });

  it('keeps dash-prefixed literal terms on the explicit search alias instead of parsing them as options or stdin', () => {
    const result = runCliSearchText(tempDir, '-dashSearchToken', ['--json']);

    const payload = expectLegacySearchJsonArray(result, 'literal dash-prefixed search alias');
    expect(JSON.stringify(payload)).toContain('dashSearchToken');
    expect(result.stderr.toString('utf8')).not.toContain('unknown option');
    expect(result.stderr.toString('utf8')).not.toContain('stdin');
  });

  it('renders final human Cypher tables for scalar, aggregate, and path values', () => {
    const queryText = [
      "MATCH p = (caller:function)-[:calls]->(callee:function) WHERE caller.name = 'entry'",
      'RETURN caller.name AS caller, count(callee) AS callees, p',
      'ORDER BY caller ASC',
      'LIMIT 1',
    ].join(' ');
    const result = runCliQueryMatch(tempDir, queryText);
    const output = result.stdout.toString('utf8');

    expect(result.exitCode, `human table exit stderr="${previewBuffer(result.stderr)}"`).toBe(0);
    expect(output).toContain('caller\tcallees\tp');
    expect(output).toContain('entry');
    expect(output).toContain('\t1\t');
    expect(output).toContain('path length 1');
    expect(output).not.toContain('[object Object]');
    expect(output).not.toContain('"status"');
    expect(result.stderr.toString('utf8')).not.toContain('CYPHER_');
  });

  it('maps Cypher diagnostics to failure exits with canonical JSON payloads', () => {
    const result = runCliQueryMatch(
      tempDir,
      'MATCH (caller:function)-[:calls]-> RETURN caller.name LIMIT 1',
      ['--json'],
    );

    const diagnostic = expectCypherCliDiagnostic(result, 'CYPHER_SYNTAX', 'invalid Cypher syntax');
    expect(String(diagnostic.expected).length).toBeGreaterThan(0);
    expect(String(diagnostic.anchor).length).toBeGreaterThan(0);
    expect(result.stdout.toString('utf8')).not.toContain('\n');
  });

  it.each<T032CliScenario>([
    {
      name: 'valid result',
      query: CYPHER_T032_VALID_QUERY,
      expectedStatus: 'success',
      expectedExitCode: 0,
      expectedRows: 1,
      expectedTruncated: false,
    },
    {
      name: 'empty success',
      query: CYPHER_T032_EMPTY_QUERY,
      expectedStatus: 'success',
      expectedExitCode: 0,
      expectedRows: 0,
      expectedTruncated: false,
    },
    {
      name: 'capped/truncated result',
      query: CYPHER_T032_CAPPED_QUERY,
      expectedStatus: 'success',
      expectedExitCode: 0,
      expectedRows: 1,
      expectedTruncated: true,
    },
    {
      name: 'syntax diagnostic',
      query: CYPHER_T032_SYNTAX_QUERY,
      expectedStatus: 'diagnostic',
      expectedCode: 'CYPHER_SYNTAX',
      expectedExitCode: 1,
    },
    {
      name: 'unsupported write diagnostic',
      query: CYPHER_T032_UNSUPPORTED_WRITE_QUERY,
      expectedStatus: 'diagnostic',
      expectedCode: 'CYPHER_UNSUPPORTED',
      expectedExitCode: 1,
    },
    {
      name: 'oversized input diagnostic',
      stdin: oversizedCypherInputBytes,
      expectedStatus: 'diagnostic',
      expectedCode: 'CYPHER_INPUT_TOO_LONG',
      expectedExitCode: 1,
    },
    {
      name: 'malformed stdin diagnostic',
      stdin: malformedCliStdinBytes,
      expectedStatus: 'diagnostic',
      expectedCode: 'CYPHER_INVALID_STDIN_ENCODING',
      expectedExitCode: 1,
    },
    {
      name: 'output-too-large diagnostic',
      query: CYPHER_T032_OUTPUT_TOO_LARGE_QUERY,
      prepare: addOversizedCypherPayloadRows,
      expectedStatus: 'diagnostic',
      expectedCode: 'CYPHER_OUTPUT_TOO_LARGE',
      expectedExitCode: 1,
    },
    {
      name: 'timeout state',
      query: CYPHER_T032_TIMEOUT_QUERY,
      expectedStatus: 'timeout',
      expectedCode: 'CYPHER_TIMEOUT',
      expectedExitCode: 1,
    },
    {
      name: 'not-indexed diagnostic',
      query: CYPHER_T032_VALID_QUERY,
      useUnindexedProject: true,
      expectedStatus: 'diagnostic',
      expectedCode: 'CYPHER_NOT_INDEXED',
      expectedExitCode: 1,
    },
  ])('emits canonical CLI --json bytes for T032 $name', (scenario) => {
    const projectPath = scenario.useUnindexedProject === true
      ? fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-cypher-cli-not-indexed-'))
      : tempDir;
    try {
      scenario.prepare?.(projectPath);
      const runScenario = (): CliProcessResult => (scenario.stdin === undefined
        ? runCliQueryMatch(projectPath, scenario.query ?? '', ['--json'])
        : runCliQueryStdin(projectPath, scenario.stdin(), ['--json']));
      const result = scenario.expectedStatus === 'timeout'
        ? withExpiredCypherDeadline(runScenario)
        : runScenario();

      expectT032CliJsonState(result, scenario);
    } finally {
      if (projectPath !== tempDir) {
        fs.rmSync(projectPath, { recursive: true, force: true });
      }
    }
  });
});

describe('cypher CLI process helpers', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-cypher-cli-helper-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('support positional MATCH input, stdin -, malformed stdin bytes, raw streams, exit code, and shared --path', () => {
    const echoBin = path.join(tempDir, 'echo-cli-helper.cjs');
    fs.writeFileSync(
      echoBin,
      [
        "const chunks = [];",
        "process.stdin.on('data', (chunk) => chunks.push(chunk));",
        "process.stdin.on('end', () => {",
        "  process.stdout.write(JSON.stringify({",
        "    argv: process.argv.slice(2),",
        "    stdinHex: Buffer.concat(chunks).toString('hex'),",
        "  }));",
        "  process.stderr.write(Buffer.from([0x65, 0x72, 0x72]));",
        "  process.exit(7);",
        "});",
      ].join('\n'),
    );

    const matchText = 'MATCH (n:function) RETURN n LIMIT 1';
    const positional = runCliQueryMatch(tempDir, matchText, ['--json'], echoBin);
    const positionalPayload = JSON.parse(positional.stdout.toString('utf8'));

    expect(positional.args).toEqual([echoBin, 'query', matchText, '--json', '--path', tempDir]);
    expect(positionalPayload).toEqual({
      argv: ['query', matchText, '--json', '--path', tempDir],
      stdinHex: '',
    });
    expect(Buffer.isBuffer(positional.stdout)).toBe(true);
    expect(positional.stderr).toEqual(Buffer.from([0x65, 0x72, 0x72]));
    expect(positional.exitCode).toBe(7);
    expect(positional.signal).toBeNull();

    const stdinMatch = Buffer.from('MATCH (n:file) RETURN n LIMIT 1', 'utf8');
    const stdinResult = runCliQueryStdin(tempDir, stdinMatch, ['--json'], echoBin);
    const stdinPayload = JSON.parse(stdinResult.stdout.toString('utf8'));

    expect(stdinResult.args).toEqual([echoBin, 'query', '-', '--json', '--path', tempDir]);
    expect(stdinPayload).toEqual({
      argv: ['query', '-', '--json', '--path', tempDir],
      stdinHex: stdinMatch.toString('hex'),
    });

    const malformedResult = runCliQueryStdin(tempDir, malformedCliStdinBytes(), [], echoBin);
    const malformedPayload = JSON.parse(malformedResult.stdout.toString('utf8'));

    expect(malformedPayload).toEqual({
      argv: ['query', '-', '--path', tempDir],
      stdinHex: 'c328',
    });
  });
});
