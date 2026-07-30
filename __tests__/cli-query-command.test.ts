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

function query(cwd: string, extraArgs: string[]): string {
  return execFileSync(process.execPath, [BIN, 'query', 'parseToken', ...extraArgs, '-p', cwd], {
    encoding: 'utf-8',
    env: cliTestEnv(),
    stdio: ['ignore', 'pipe', 'ignore'], // drop stderr (SQLite experimental warning)
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
