import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeGraph } from '../src';
import { ToolHandler, type ToolDefinition, type ToolResult } from '../src/mcp/tools';

const CYPHER_QUERY_TOOL_NAME = 'codegraph_query';

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
    const result = await invokeMcpCodegraphQuery(fixture.handler, {
      projectPath: fixture.projectRoot,
      query: 'MATCH p = (caller:function)-[:calls*1..8]->(callee:function) RETURN p /* codegraph-test-force-timeout */',
    });

    expectMcpCypherTimeout(result, 'timeout query');
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
