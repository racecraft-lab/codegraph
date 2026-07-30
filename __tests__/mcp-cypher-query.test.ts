import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ToolDefinition, ToolHandler, ToolResult } from '../src/mcp/tools';

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
  expect(result.isError).not.toBe(true);
  const text = rawMcpText(result);
  return {
    text,
    rawTextBytes: Buffer.from(text, 'utf8'),
  };
}

function expectMcpIsError(result: ToolResult): void {
  expect(result.isError).toBe(true);
  rawMcpText(result);
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
