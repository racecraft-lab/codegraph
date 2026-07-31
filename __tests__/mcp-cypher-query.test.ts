import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { CodeGraph } from '../src';
import { ToolHandler, type ToolDefinition, type ToolResult } from '../src/mcp/tools';

const CYPHER_QUERY_TOOL_NAME = 'codegraph_query';
const BIN = path.resolve(__dirname, '../dist/bin/codegraph.js');
const CYPHER_T032_VALID_QUERY =
  "MATCH (caller:function)-[:calls]->(callee:function) WHERE caller.name = 'entry' RETURN caller.name AS caller, callee.name AS callee ORDER BY callee.name LIMIT 1";
const CYPHER_T032_EMPTY_QUERY =
  "MATCH (caller:function)-[:calls]->(callee:function) WHERE caller.name = 'doesNotExist' RETURN caller.name LIMIT 5";
const CYPHER_T032_CAPPED_QUERY = 'MATCH (caller:function)-[:calls]->(callee:function) RETURN caller.name AS caller LIMIT 1';
const CYPHER_T032_SYNTAX_QUERY = 'MATCH (caller:function)-[:calls]-> RETURN caller.name LIMIT 1';
const CYPHER_T032_UNSUPPORTED_WRITE_QUERY =
  'MATCH (caller:function)-[:calls]->(callee:function) DELETE callee RETURN caller.name LIMIT 1';
const CYPHER_T032_TIMEOUT_QUERY =
  'MATCH p = (caller:function)-[:calls*1..8]->(callee:function) RETURN p';
const CYPHER_T032_OUTPUT_TOO_LARGE_QUERY = 'MATCH (a:function)-[:calls]->(b:function) RETURN a, b LIMIT 1000';

function oversizedCypherQueryText(secretPrefix = 'oversized'): string {
  return `MATCH (n:function) WHERE n.name = '${secretPrefix}-${'oversized'.repeat(1_260)}' RETURN n.name LIMIT 1`;
}

type T032ParityState = {
  readonly name: string;
  readonly query: string;
  readonly expectedStatus: 'success' | 'diagnostic' | 'timeout';
  readonly expectedCode?: string;
  readonly expectedRows?: number;
  readonly expectedTruncated?: boolean;
  readonly prepare?: (projectPath: string) => void;
  readonly useUnindexedProject?: boolean;
};

type ManualMcpCypherProject = {
  readonly projectRoot: string;
  readonly close: () => void;
};

type McpToolHarness = Pick<ToolHandler, 'execute' | 'getTools'>;

type McpCypherQueryInput = {
  readonly query: string;
  readonly projectPath?: string;
};

type McpSuccessCapture = {
  readonly text: string;
  readonly rawTextBytes: Buffer;
};

type McpCypherFixture = {
  readonly projectRoot: string;
  readonly cg: CodeGraph;
  readonly handler: ToolHandler;
  readonly close: () => void;
};

type McpCypherResult = Record<string, unknown> & {
  readonly status: string;
};

function cypherToolDefinition(): ToolDefinition {
  return {
    name: CYPHER_QUERY_TOOL_NAME,
    description: 'Run a bounded structured Cypher graph query against a CodeGraph index.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Cypher query text.',
        },
        projectPath: {
          type: 'string',
          description: 'Absolute path to the project to query.',
        },
      },
      required: ['query'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

function defaultMcpToolNames(harness: Pick<McpToolHarness, 'getTools'>): string[] {
  return harness.getTools().map((tool) => tool.name);
}

async function invokeMcpCodegraphQuery(
  harness: Pick<McpToolHarness, 'execute'>,
  input: McpCypherQueryInput,
): Promise<ToolResult> {
  return harness.execute(CYPHER_QUERY_TOOL_NAME, {
    query: input.query,
    ...(input.projectPath === undefined ? {} : { projectPath: input.projectPath }),
  });
}

function rawMcpText(result: ToolResult): string {
  expect(result.content).toHaveLength(1);
  expect(result.content[0]?.type).toBe('text');
  return result.content[0]?.text ?? '';
}

function rawMcpTextBytes(result: ToolResult): Buffer {
  return Buffer.from(rawMcpText(result), 'utf8');
}

function expectMcpSuccessShape(result: ToolResult): McpSuccessCapture {
  const text = rawMcpText(result);
  if (result.isError === true) {
    throw new Error(
      'SPEC-013 MCP Cypher tool contract missing: expected `codegraph_query` expected-state responses ' +
        `to be success-shaped without isError, but got isError text="${previewText(text)}".`,
    );
  }
  return {
    text,
    rawTextBytes: Buffer.from(text, 'utf8'),
  };
}

function expectMcpIsError(result: ToolResult): void {
  expect(result.isError).toBe(true);
  rawMcpText(result);
}

function createIndexedMcpCypherFixture(): McpCypherFixture {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-mcp-cypher-'));
  fs.mkdirSync(path.join(projectRoot, 'src'));
  fs.writeFileSync(
    path.join(projectRoot, 'src/main.ts'),
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
      'export function lonely(): string {',
      "  return 'lonely';",
      '}',
      '',
    ].join('\n'),
  );

  const init = CodeGraph.initSync(projectRoot);
  init.close();

  const cg = CodeGraph.openSync(projectRoot);
  const handler = new ToolHandler(cg);
  let closed = false;

  return {
    projectRoot,
    cg,
    handler,
    close: () => {
      if (closed) return;
      closed = true;
      handler.closeAll();
      cg.close();
      fs.rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}

/** Applies the expired deadline only to the parity scenario that expects a timeout. */
async function withScenarioCypherDeadline<T>(scenario: T032ParityState, run: () => Promise<T>): Promise<T> {
  return scenario.expectedStatus === 'timeout' ? withExpiredCypherDeadline(run) : run();
}

/**
 * Expire the Cypher runtime deadline for the duration of one call. Shipped code
 * no longer sniffs query text for a test marker — the enforced deadline is read
 * from the environment, and `cliTestEnv()` forwards it to the CLI subprocess so
 * both halves of a parity check run on the same setting.
 */
async function withExpiredCypherDeadline<T>(run: () => Promise<T> | T): Promise<T> {
  const previous = process.env.CODEGRAPH_CYPHER_DEADLINE_MS;
  process.env.CODEGRAPH_CYPHER_DEADLINE_MS = '0';
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.CODEGRAPH_CYPHER_DEADLINE_MS;
    } else {
      process.env.CODEGRAPH_CYPHER_DEADLINE_MS = previous;
    }
  }
}

function cliTestEnv(): NodeJS.ProcessEnv {
  return { ...process.env, CODEGRAPH_NO_DAEMON: '1', CODEGRAPH_WASM_RELAUNCHED: '1' };
}

function runCliCypherJsonBytes(projectPath: string, queryText: string): Buffer {
  const result = spawnSync(process.execPath, [BIN, 'query', queryText, '--json', '--path', projectPath], {
    env: cliTestEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw result.error;
  }
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? '');
  if (stdout.length === 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr ?? '');
    throw new Error(
      `SPEC-013 T032 CLI/MCP parity missing: CLI emitted no JSON bytes for ${queryText}. ` +
        `exit=${result.status} stderr="${previewText(stderr)}"`,
    );
  }
  return stdout;
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

function schemaSql(): string {
  return fs.readFileSync(path.join(process.cwd(), 'src', 'db', 'schema.sql'), 'utf8');
}

function insertManualMcpCypherNode(
  db: DatabaseSync,
  input: {
    readonly id: string;
    readonly name: string;
    readonly qualifiedName?: string;
    readonly signature?: string | null;
  },
): void {
  db.prepare(`
    INSERT INTO nodes (
      id, kind, name, qualified_name, file_path, language,
      start_line, end_line, start_column, end_column,
      docstring, signature, visibility,
      is_exported, is_async, is_static, is_abstract,
      decorators, type_parameters, return_type, updated_at
    )
    VALUES (?, 'function', ?, ?, 'src/manual.ts', 'typescript', 1, 1, 0, 1, null, ?, null, 0, 0, 0, 0, '[]', '[]', null, 1700000000000)
  `).run(
    input.id,
    input.name,
    input.qualifiedName ?? `src/manual.${input.name}`,
    input.signature ?? null,
  );
}

function insertManualMcpCypherCall(db: DatabaseSync, source: string, target: string, line: number): void {
  db.prepare(`
    INSERT INTO edges (source, target, kind, metadata, line, col, provenance)
    VALUES (?, ?, 'calls', null, ?, 0, 'tree-sitter')
  `).run(source, target, line);
}

function createManualMcpCypherProject(): ManualMcpCypherProject {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-mcp-cypher-us2-'));
  const codegraphDir = path.join(projectRoot, '.codegraph');
  fs.mkdirSync(codegraphDir, { recursive: true });
  const db = new DatabaseSync(path.join(codegraphDir, 'codegraph.db'));
  db.exec(schemaSql());
  db.prepare(`
    INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count, errors)
    VALUES ('src/manual.ts', 'hash-manual', 'typescript', 300, 1700000000000, 1700000000100, 5, '[]')
  `).run();

  insertManualMcpCypherNode(db, {
    id: 'fn:entry',
    name: 'entry',
    signature: 'function entry(): void',
  });
  insertManualMcpCypherNode(db, {
    id: 'fn:parseToken',
    name: 'parseToken',
    signature: 'function parseToken(token: string): string',
  });
  insertManualMcpCypherNode(db, {
    id: 'fn:helper',
    name: 'helper',
    signature: 'function helper(value: string): string',
  });
  insertManualMcpCypherNode(db, { id: 'fn:heuristicTarget', name: 'heuristicTarget' });
  insertManualMcpCypherNode(db, { id: 'fn:lspTarget', name: 'lspTarget' });

  insertManualMcpCypherCall(db, 'fn:entry', 'fn:helper', 10);
  insertManualMcpCypherCall(db, 'fn:entry', 'fn:heuristicTarget', 11);
  insertManualMcpCypherCall(db, 'fn:entry', 'fn:lspTarget', 12);
  insertManualMcpCypherCall(db, 'fn:parseToken', 'fn:helper', 20);
  db.close();

  return {
    projectRoot,
    close: () => fs.rmSync(projectRoot, { recursive: true, force: true }),
  };
}

async function indexMcpCypherFixture(fixture: McpCypherFixture): Promise<void> {
  await fixture.cg.indexAll();
}

function previewText(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 220);
}

function parseMcpCypherJson(result: ToolResult, context: string): McpCypherResult {
  const success = expectMcpSuccessShape(result);
  if (success.text.length === 0) {
    throw new Error(
      `SPEC-013 MCP Cypher contract missing: ${context} expected canonical JSON text, but MCP text was empty.`,
    );
  }

  try {
    const parsed = JSON.parse(success.text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('status' in parsed)) {
      throw new Error('payload is not a Cypher result union object with status');
    }
    return parsed as McpCypherResult;
  } catch (error) {
    throw new Error(
      `SPEC-013 MCP Cypher contract missing: ${context} expected success-shaped canonical JSON. ` +
        `isError=${result.isError === true} text="${previewText(success.text)}" ` +
        `parseError=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function expectMcpCanonicalJson(result: ToolResult, context: string): McpCypherResult {
  const success = expectMcpSuccessShape(result);
  expect(success.rawTextBytes.length, `${context} text byte length`).toBeGreaterThan(0);
  const lastByte = success.rawTextBytes[success.rawTextBytes.length - 1];
  if (lastByte === 0x0a || lastByte === 0x0d) {
    throw new Error(
      `SPEC-013 MCP Cypher canonical JSON contract missing: ${context} emitted trailing newline/framing byte.`,
    );
  }
  expect(success.text).not.toContain('\n');
  expect(success.text).not.toContain('  ');
  return parseMcpCypherJson(result, context);
}

function expectMcpCypherSuccess(result: ToolResult, context: string): McpCypherResult {
  const payload = expectMcpCanonicalJson(result, context);
  expect(payload.status).toBe('success');
  expect(Array.isArray(payload.columns)).toBe(true);
  expect(Array.isArray(payload.rows)).toBe(true);
  return payload;
}

function expectMcpCypherDiagnostic(result: ToolResult, code: string, context: string): McpCypherResult {
  const payload = expectMcpCanonicalJson(result, context);
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

function expectMcpCypherTimeout(result: ToolResult, context: string): McpCypherResult {
  const payload = expectMcpCanonicalJson(result, context);
  expect(payload.status).toBe('timeout');
  expect(payload.code).toBe('CYPHER_TIMEOUT');
  expect(payload.deadlineMs).toBe(5000);
  expect(String(payload.guidance)).toContain('narrow');
  expect(payload).not.toHaveProperty('rows');
  return payload;
}

function expectT032McpPayload(result: ToolResult, scenario: T032ParityState): {
  readonly payload: McpCypherResult;
  readonly bytes: Buffer;
} {
  const success = expectMcpSuccessShape(result);
  expect(result.isError, `${scenario.name} isError`).not.toBe(true);
  expect(success.text).not.toContain('\n');
  expect(success.text).not.toContain('  ');
  const payload = parseMcpCypherJson(result, scenario.name);
  expect(payload.status, `${scenario.name} status`).toBe(scenario.expectedStatus);
  if (scenario.expectedCode !== undefined) {
    expect(payload.code, `${scenario.name} code`).toBe(scenario.expectedCode);
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
  return { payload, bytes: success.rawTextBytes };
}

function scalarMcpRowValue(row: Record<string, unknown>, column: string): unknown {
  const value = row[column];
  expect(value).toMatchObject({ type: 'scalar' });
  return (value as { readonly value: unknown }).value;
}

describe('SPEC-013 MCP Cypher helper contracts', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-mcp-cypher-helper-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('inspect default listing, invoke codegraph_query, capture success bytes, and assert isError behavior', async () => {
    const successText = '{"columns":[],"effectiveCap":100,"rows":[],"status":"success","truncated":false}';
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const harness: McpToolHarness = {
      getTools: () => [cypherToolDefinition()],
      execute: async (name, args) => {
        calls.push({ name, args });
        return { content: [{ type: 'text', text: successText }] };
      },
    };

    expect(defaultMcpToolNames(harness)).toContain(CYPHER_QUERY_TOOL_NAME);

    const query = 'MATCH (n:function) RETURN n LIMIT 1';
    const result = await invokeMcpCodegraphQuery(harness, { query, projectPath: tempDir });
    expect(calls).toEqual([{ name: CYPHER_QUERY_TOOL_NAME, args: { query, projectPath: tempDir } }]);

    const success = expectMcpSuccessShape(result);
    expect(success.text).toBe(successText);
    expect(success.rawTextBytes).toEqual(Buffer.from(successText, 'utf8'));
    expect(rawMcpTextBytes(result)).toEqual(Buffer.from(successText, 'utf8'));

    expectMcpIsError({ content: [{ type: 'text', text: 'path refused' }], isError: true });
  });
});

describe('SPEC-013 MCP codegraph_query contracts', () => {
  let fixture: McpCypherFixture;

  beforeEach(async () => {
    fixture = createIndexedMcpCypherFixture();
    await indexMcpCypherFixture(fixture);
  });

  afterEach(() => {
    fixture.close();
  });

  it('default-lists codegraph_query with read-only schema and deliberate structured-query description', () => {
    const tool = fixture.handler.getTools().find((candidate) => candidate.name === CYPHER_QUERY_TOOL_NAME);

    if (!tool) {
      throw new Error(
        'SPEC-013 MCP Cypher tool contract missing: expected ToolHandler.getTools() to default-list `codegraph_query`.',
      );
    }

    expect(defaultMcpToolNames(fixture.handler)).toContain(CYPHER_QUERY_TOOL_NAME);
    expect(tool.description).toContain('Cypher');
    expect(tool.description).toContain('structured');
    expect(tool.description).not.toMatch(/primary/i);
    expect(tool.inputSchema.required).toEqual(['query']);
    expect(tool.inputSchema.properties).toHaveProperty('query');
    expect(tool.inputSchema.properties).toHaveProperty('projectPath');
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('returns a valid bounded path result as success-shaped canonical JSON without isError', async () => {
    const result = await invokeMcpCodegraphQuery(fixture.handler, {
      projectPath: fixture.projectRoot,
      query: "MATCH p = (caller:function)-[:calls*1..3]->(callee:function) WHERE caller.name = 'entry' RETURN p LIMIT 5",
    });

    const payload = expectMcpCypherSuccess(result, 'valid bounded path query');
    expect(payload.effectiveCap).toBe(5);
    expect(payload.truncated).toBe(false);
    expect(JSON.stringify(payload)).toContain('"type":"path"');
    expect(JSON.stringify(payload)).toContain('entry');
    expect(JSON.stringify(payload)).toContain('helper');
  });

  it('returns empty matches as success with rows [] and no isError', async () => {
    const result = await invokeMcpCodegraphQuery(fixture.handler, {
      projectPath: fixture.projectRoot,
      query: "MATCH (caller:function)-[:calls]->(callee:function) WHERE caller.name = 'doesNotExist' RETURN caller.name LIMIT 5",
    });

    const payload = expectMcpCypherSuccess(result, 'empty bounded query');
    expect(payload.rows).toEqual([]);
    expect(payload.truncated).toBe(false);
  });

  it('returns parser diagnostics and unsupported-subset diagnostics as expected success-shaped JSON', async () => {
    expectMcpCypherDiagnostic(
      await invokeMcpCodegraphQuery(fixture.handler, {
        projectPath: fixture.projectRoot,
        query: 'MATCH (caller:function)-[:calls]-> RETURN caller.name LIMIT 1',
      }),
      'CYPHER_SYNTAX',
      'parser diagnostic',
    );

    expectMcpCypherDiagnostic(
      await invokeMcpCodegraphQuery(fixture.handler, {
        projectPath: fixture.projectRoot,
        query: 'MATCH (caller:function)-[:calls]->(callee:function) DELETE callee RETURN caller.name',
      }),
      'CYPHER_UNSUPPORTED',
      'unsupported write clause diagnostic',
    );
  });

  it('returns not-indexed as a success-shaped diagnostic without isError', async () => {
    const unindexed = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-mcp-cypher-not-indexed-'));
    try {
      const diagnostic = expectMcpCypherDiagnostic(
        await invokeMcpCodegraphQuery(fixture.handler, {
          projectPath: unindexed,
          query: 'MATCH (n:function)-[:calls]->(m:function) RETURN n.name LIMIT 1',
        }),
        'CYPHER_NOT_INDEXED',
        'not-indexed project diagnostic',
      );
      expect(String(diagnostic.message)).toContain('index');
    } finally {
      fs.rmSync(unindexed, { recursive: true, force: true });
    }
  });

  it('returns timeout state as success-shaped JSON without partial rows or isError', async () => {
    const result = await withExpiredCypherDeadline(() => invokeMcpCodegraphQuery(fixture.handler, {
      projectPath: fixture.projectRoot,
      query: CYPHER_T032_TIMEOUT_QUERY,
    }));

    expectMcpCypherTimeout(result, 'timeout query');
  });

  it('returns count and implicit grouping rows as success-shaped MCP JSON', async () => {
    const project = createManualMcpCypherProject();
    try {
      const result = await invokeMcpCodegraphQuery(fixture.handler, {
        projectPath: project.projectRoot,
        query: [
          'MATCH (caller:function)-[:calls]->(target:function)',
          'RETURN caller.name AS callerName, count(*) AS calls, count(target.signature) AS documentedTargets',
          'ORDER BY calls DESC, callerName ASC',
          'LIMIT 5',
        ].join(' '),
      });

      const payload = expectMcpCypherSuccess(result, 'MCP count and grouping query');
      expect(payload.columns).toEqual([{ name: 'callerName' }, { name: 'calls' }, { name: 'documentedTargets' }]);
      expect((payload.rows as Array<Record<string, unknown>>).map((row) => ({
        callerName: scalarMcpRowValue(row, 'callerName'),
        calls: scalarMcpRowValue(row, 'calls'),
        documentedTargets: scalarMcpRowValue(row, 'documentedTargets'),
      }))).toEqual([
        { callerName: 'entry', calls: 3, documentedTargets: 1 },
        { callerName: 'parseToken', calls: 1, documentedTargets: 1 },
      ]);
      expect(payload.truncated).toBe(false);
    } finally {
      project.close();
    }
  });

  it('applies MCP string predicates with Cypher null semantics', async () => {
    const project = createManualMcpCypherProject();
    try {
      const result = await invokeMcpCodegraphQuery(fixture.handler, {
        projectPath: project.projectRoot,
        query: [
          'MATCH (caller:function)-[:calls]->(target:function)',
          "WHERE caller.name STARTS WITH 'par' OR target.name ENDS WITH 'Target' OR target.name CONTAINS 'lsp'",
          'RETURN caller.name AS callerName, target.name AS targetName',
          'ORDER BY callerName ASC, targetName ASC',
          'LIMIT 5',
        ].join(' '),
      });

      const payload = expectMcpCypherSuccess(result, 'MCP string predicate query');
      expect(payload.columns).toEqual([{ name: 'callerName' }, { name: 'targetName' }]);
      expect((payload.rows as Array<Record<string, unknown>>).map((row) => ({
        callerName: scalarMcpRowValue(row, 'callerName'),
        targetName: scalarMcpRowValue(row, 'targetName'),
      }))).toEqual([
        { callerName: 'entry', targetName: 'heuristicTarget' },
        { callerName: 'entry', targetName: 'lspTarget' },
        { callerName: 'parseToken', targetName: 'helper' },
      ]);
    } finally {
      project.close();
    }
  });

  it('accepts backtick identifiers and aliases through MCP without changing canonical output keys', async () => {
    const project = createManualMcpCypherProject();
    try {
      const result = await invokeMcpCodegraphQuery(fixture.handler, {
        projectPath: project.projectRoot,
        query: [
          'MATCH (`call``er`:`function`)-[:`calls`]->(`target-node`:`function`)',
          "WHERE `call``er`.name = 'entry'",
          'RETURN `call``er`.name AS `caller``name`, `target-node`.`name` AS `target-name`',
          'ORDER BY `target-name` ASC',
          'LIMIT 2',
        ].join(' '),
      });

      const payload = expectMcpCypherSuccess(result, 'MCP backtick identifier query');
      expect(payload.columns).toEqual([{ name: 'caller`name' }, { name: 'target-name' }]);
      expect((payload.rows as Array<Record<string, unknown>>).map((row) => ({
        caller: scalarMcpRowValue(row, 'caller`name'),
        target: scalarMcpRowValue(row, 'target-name'),
      }))).toEqual([
        { caller: 'entry', target: 'helper' },
        { caller: 'entry', target: 'heuristicTarget' },
      ]);
    } finally {
      project.close();
    }
  });

  it('rejects unsupported backtick escape forms through MCP as success-shaped diagnostics', async () => {
    const project = createManualMcpCypherProject();
    try {
      const diagnostic = expectMcpCypherDiagnostic(
        await invokeMcpCodegraphQuery(fixture.handler, {
          projectPath: project.projectRoot,
          query: 'MATCH (`bad\\u006e`:function)-[:calls]->(target:function) RETURN target.name LIMIT 1',
        }),
        'CYPHER_UNSUPPORTED',
        'MCP unsupported backtick escape diagnostic',
      );
      expect(JSON.stringify(diagnostic)).not.toContain('helper');
    } finally {
      project.close();
    }
  });

  it('emits canonical aggregate JSON bytes for recipe-compatible MCP output', async () => {
    const project = createManualMcpCypherProject();
    try {
      const result = await invokeMcpCodegraphQuery(fixture.handler, {
        projectPath: project.projectRoot,
        query: [
          'MATCH (caller:function)-[:calls]->(target:function)',
          'RETURN caller.name AS callerName, count(*) AS calls',
          'ORDER BY calls DESC, callerName ASC',
          'LIMIT 2',
        ].join(' '),
      });

      const success = expectMcpSuccessShape(result);
      expect(success.text).toBe(
        '{"columns":[{"name":"callerName"},{"name":"calls"}],"effectiveCap":2,"rows":[{"callerName":{"type":"scalar","value":"entry"},"calls":{"type":"scalar","value":3}},{"callerName":{"type":"scalar","value":"parseToken"},"calls":{"type":"scalar","value":1}}],"status":"success","truncated":false}',
      );
    } finally {
      project.close();
    }
  });

  it('returns documented expected-empty recipe output as canonical success JSON', async () => {
    const project = createManualMcpCypherProject();
    try {
      const result = await invokeMcpCodegraphQuery(fixture.handler, {
        projectPath: project.projectRoot,
        query: [
          'MATCH (caller:function)-[:calls]->(target:function)',
          "WHERE caller.name STARTS WITH 'recipeNoMatch'",
          'RETURN caller.name AS callerName, target.name AS targetName',
          'ORDER BY callerName ASC, targetName ASC',
          'LIMIT 5',
        ].join(' '),
      });

      const payload = expectMcpCypherSuccess(result, 'MCP expected-empty recipe query');
      expect(payload.columns).toEqual([{ name: 'callerName' }, { name: 'targetName' }]);
      expect(payload.rows).toEqual([]);
      expect(payload.truncated).toBe(false);
    } finally {
      project.close();
    }
  });

  it('provides timeout guidance that points agents toward bounded recipe rewrites', async () => {
    const result = await withExpiredCypherDeadline(() => invokeMcpCodegraphQuery(fixture.handler, {
      projectPath: fixture.projectRoot,
      query: CYPHER_T032_TIMEOUT_QUERY,
    }));

    const timeout = expectMcpCypherTimeout(result, 'MCP timeout guidance query');
    expect(String(timeout.guidance)).toContain('relationship depth');
    expect(String(timeout.guidance)).toContain('LIMIT');
    expect(String(timeout.guidance)).not.toContain('CODEGRAPH_CYPHER_DEADLINE_MS');
  });

  it.each([
    {
      name: 'aggregate grouping',
      query: [
        'MATCH (caller:function)-[:calls]->(target:function)',
        'RETURN caller.name AS callerName, count(*) AS calls',
        'ORDER BY calls DESC, callerName ASC',
        'LIMIT 2',
      ].join(' '),
    },
    {
      name: 'string predicate expected empty recipe',
      query: [
        'MATCH (caller:function)-[:calls]->(target:function)',
        "WHERE caller.name STARTS WITH 'recipeNoMatch'",
        'RETURN caller.name AS callerName, target.name AS targetName',
        'ORDER BY callerName ASC, targetName ASC',
        'LIMIT 5',
      ].join(' '),
    },
    {
      name: 'backtick identifiers',
      query: [
        'MATCH (`call``er`:`function`)-[:`calls`]->(`target-node`:`function`)',
        "WHERE `call``er`.name = 'entry'",
        'RETURN `call``er`.name AS `caller``name`, `target-node`.`name` AS `target-name`',
        'ORDER BY `target-name` ASC',
        'LIMIT 1',
      ].join(' '),
    },
  ])('matches CLI --json bytes for T045 $name', async (scenario) => {
    const project = createManualMcpCypherProject();
    try {
      const mcpResult = await invokeMcpCodegraphQuery(fixture.handler, {
        projectPath: project.projectRoot,
        query: scenario.query,
      });
      expectMcpCypherSuccess(mcpResult, `T045 ${scenario.name} MCP success before CLI parity`);
      const success = expectMcpSuccessShape(mcpResult);
      const cliBytes = runCliCypherJsonBytes(project.projectRoot, scenario.query);

      expect(cliBytes).toEqual(success.rawTextBytes);
    } finally {
      project.close();
    }
  });

  it.each<T032ParityState>([
    {
      name: 'valid result',
      query: CYPHER_T032_VALID_QUERY,
      expectedStatus: 'success',
      expectedRows: 1,
      expectedTruncated: false,
    },
    {
      name: 'empty success',
      query: CYPHER_T032_EMPTY_QUERY,
      expectedStatus: 'success',
      expectedRows: 0,
      expectedTruncated: false,
    },
    {
      name: 'capped/truncated result',
      query: CYPHER_T032_CAPPED_QUERY,
      expectedStatus: 'success',
      expectedRows: 1,
      expectedTruncated: true,
    },
    {
      name: 'syntax diagnostic',
      query: CYPHER_T032_SYNTAX_QUERY,
      expectedStatus: 'diagnostic',
      expectedCode: 'CYPHER_SYNTAX',
    },
    {
      name: 'unsupported write diagnostic',
      query: CYPHER_T032_UNSUPPORTED_WRITE_QUERY,
      expectedStatus: 'diagnostic',
      expectedCode: 'CYPHER_UNSUPPORTED',
    },
    {
      name: 'oversized input diagnostic',
      query: oversizedCypherQueryText(),
      expectedStatus: 'diagnostic',
      expectedCode: 'CYPHER_INPUT_TOO_LONG',
    },
    {
      name: 'output-too-large diagnostic',
      query: CYPHER_T032_OUTPUT_TOO_LARGE_QUERY,
      prepare: addOversizedCypherPayloadRows,
      expectedStatus: 'diagnostic',
      expectedCode: 'CYPHER_OUTPUT_TOO_LARGE',
    },
    {
      name: 'timeout state',
      query: CYPHER_T032_TIMEOUT_QUERY,
      expectedStatus: 'timeout',
      expectedCode: 'CYPHER_TIMEOUT',
    },
    {
      name: 'not-indexed diagnostic',
      query: CYPHER_T032_VALID_QUERY,
      useUnindexedProject: true,
      expectedStatus: 'diagnostic',
      expectedCode: 'CYPHER_NOT_INDEXED',
    },
  ])('matches canonical CLI --json bytes for T032 $name', async (scenario) => {
    const projectPath = scenario.useUnindexedProject === true
      ? fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-mcp-cypher-not-indexed-parity-'))
      : fixture.projectRoot;
    try {
      scenario.prepare?.(projectPath);
      await withScenarioCypherDeadline(scenario, async () => {
        const mcpResult = await invokeMcpCodegraphQuery(fixture.handler, {
          projectPath,
          query: scenario.query,
        });
        const mcp = expectT032McpPayload(mcpResult, scenario);
        const cliBytes = runCliCypherJsonBytes(projectPath, scenario.query);

        expect(cliBytes).toEqual(mcp.bytes);
      });
    } finally {
      if (projectPath !== fixture.projectRoot) {
        fs.rmSync(projectPath, { recursive: true, force: true });
      }
    }
  });

  it.each<T032ParityState>([
    {
      name: 'valid result',
      query: CYPHER_T032_VALID_QUERY,
      expectedStatus: 'success',
      expectedRows: 1,
      expectedTruncated: false,
    },
    {
      name: 'empty success',
      query: CYPHER_T032_EMPTY_QUERY,
      expectedStatus: 'success',
      expectedRows: 0,
      expectedTruncated: false,
    },
    {
      name: 'capped/truncated result',
      query: CYPHER_T032_CAPPED_QUERY,
      expectedStatus: 'success',
      expectedRows: 1,
      expectedTruncated: true,
    },
    {
      name: 'syntax diagnostic',
      query: CYPHER_T032_SYNTAX_QUERY,
      expectedStatus: 'diagnostic',
      expectedCode: 'CYPHER_SYNTAX',
    },
    {
      name: 'unsupported write diagnostic',
      query: CYPHER_T032_UNSUPPORTED_WRITE_QUERY,
      expectedStatus: 'diagnostic',
      expectedCode: 'CYPHER_UNSUPPORTED',
    },
    {
      name: 'oversized input diagnostic',
      query: oversizedCypherQueryText('final-oversized-secret'),
      expectedStatus: 'diagnostic',
      expectedCode: 'CYPHER_INPUT_TOO_LONG',
    },
    {
      name: 'output-too-large diagnostic',
      query: CYPHER_T032_OUTPUT_TOO_LARGE_QUERY,
      prepare: addOversizedCypherPayloadRows,
      expectedStatus: 'diagnostic',
      expectedCode: 'CYPHER_OUTPUT_TOO_LARGE',
    },
    {
      name: 'timeout state',
      query: CYPHER_T032_TIMEOUT_QUERY,
      expectedStatus: 'timeout',
      expectedCode: 'CYPHER_TIMEOUT',
    },
    {
      name: 'not-indexed diagnostic',
      query: CYPHER_T032_VALID_QUERY,
      useUnindexedProject: true,
      expectedStatus: 'diagnostic',
      expectedCode: 'CYPHER_NOT_INDEXED',
    },
  ])('matches final T059 CLI --json bytes for $name', async (scenario) => {
    const projectPath = scenario.useUnindexedProject === true
      ? fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-mcp-cypher-t059-not-indexed-'))
      : fixture.projectRoot;
    try {
      scenario.prepare?.(projectPath);
      await withScenarioCypherDeadline(scenario, async () => {
        const mcpResult = await invokeMcpCodegraphQuery(fixture.handler, {
          projectPath,
          query: scenario.query,
        });
        const mcp = expectT032McpPayload(mcpResult, scenario);
        const cliBytes = runCliCypherJsonBytes(projectPath, scenario.query);

        expect(cliBytes).toEqual(mcp.bytes);
        if (scenario.name === 'oversized input diagnostic') {
          const combined = mcp.bytes.toString('utf8');
          expect(combined).not.toContain('final-oversized-secret');
          expect(combined).not.toContain('oversizedoversized');
        }
      });
    } finally {
      if (projectPath !== fixture.projectRoot) {
        fs.rmSync(projectPath, { recursive: true, force: true });
      }
    }
  });

  it('keeps final T059 path/access refusals error-shaped while expected Cypher states stay success-shaped', async () => {
    const notIndexed = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-mcp-cypher-t059-expected-'));
    const missingPath = path.join(os.tmpdir(), `codegraph-mcp-cypher-t059-missing-${Date.now()}`, 'missing');
    try {
      const expectedState = await invokeMcpCodegraphQuery(fixture.handler, {
        projectPath: notIndexed,
        query: CYPHER_T032_VALID_QUERY,
      });
      expectMcpCypherDiagnostic(expectedState, 'CYPHER_NOT_INDEXED', 'T059 expected not-indexed state');
      expect(expectedState.isError).not.toBe(true);

      const refusedPath = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
      const accessRefusal = await invokeMcpCodegraphQuery(fixture.handler, {
        projectPath: refusedPath,
        query: CYPHER_T032_VALID_QUERY,
      });
      expectMcpIsError(accessRefusal);
      expect(rawMcpText(accessRefusal)).not.toContain('"status":"diagnostic"');

      const missingRefusal = await invokeMcpCodegraphQuery(fixture.handler, {
        projectPath: missingPath,
        query: CYPHER_T032_VALID_QUERY,
      });
      expectMcpIsError(missingRefusal);
      expect(rawMcpText(missingRefusal)).not.toContain('"status":"diagnostic"');
    } finally {
      fs.rmSync(notIndexed, { recursive: true, force: true });
    }
  });

  it('keeps path/access refusals error-shaped while expected Cypher states stay success-shaped', async () => {
    const notIndexed = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-mcp-cypher-expected-'));
    try {
      const expectedState = await invokeMcpCodegraphQuery(fixture.handler, {
        projectPath: notIndexed,
        query: 'MATCH (n:function)-[:calls]->(m:function) RETURN n.name LIMIT 1',
      });
      expectMcpCypherDiagnostic(expectedState, 'CYPHER_NOT_INDEXED', 'expected not-indexed state');

      const refusedPath = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
      const refusal = await invokeMcpCodegraphQuery(fixture.handler, {
        projectPath: refusedPath,
        query: 'MATCH (n:function)-[:calls]->(m:function) RETURN n.name LIMIT 1',
      });
      expectMcpIsError(refusal);
      expect(rawMcpText(refusal)).not.toContain('"status":"diagnostic"');
    } finally {
      fs.rmSync(notIndexed, { recursive: true, force: true });
    }
  });
});
