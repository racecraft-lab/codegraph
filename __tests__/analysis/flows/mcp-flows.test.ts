/**
 * SPEC-011 T018 [US1] — MCP contract for `codegraph_list_flows` +
 * `codegraph_get_flow` (FR-027/030).
 *
 * offset/limit paging (default 20, clamp 1–100, over-cap clamps not errors); sort
 * name asc then id; get_flow shape `{truncated, truncation:{depth,width,totalSteps}}`;
 * success-shaped (never isError) unknown-id / disabled / not-indexed.
 *
 * Real temp SQLite + a real opened CodeGraph; the flows catalog is seeded through
 * a second connection to the project's own DB (the index-time hook is US4).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import CodeGraph from '../../../src/index';
import { ToolHandler, type ToolResult } from '../../../src/mcp/tools';
import { DatabaseConnection } from '../../../src/db';
import { QueryBuilder } from '../../../src/db/queries';
import { getCodeGraphDir } from '../../../src/directory';
import { clearProjectConfigCache } from '../../../src/project-config';
import { swapFlows, type FlowRow, type FlowStepRow } from '../../../src/analysis/catalog-store';

const dirs: string[] = [];
const graphs: CodeGraph[] = [];
afterEach(() => {
  while (graphs.length) {
    try {
      graphs.pop()!.close();
    } catch {
      /* ignore */
    }
  }
  while (dirs.length) {
    try {
      fs.rmSync(dirs.pop()!, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function flow(id: string, name: string, extra: Partial<FlowRow> = {}): FlowRow {
  return {
    id,
    name,
    entryKind: 'route',
    rootNodeId: `root:${id}`,
    rootName: name,
    rootKind: 'route',
    truncatedDepth: false,
    truncatedWidth: false,
    truncatedSteps: false,
    ...extra,
  };
}

/**
 * Build an opened CodeGraph over a temp project whose flows catalog is pre-seeded.
 * `flowsEnabled` writes the `analysis.flows` opt-in flag to codegraph.json.
 */
function project(opts: {
  flows: FlowRow[];
  steps?: FlowStepRow[];
  flowsEnabled: boolean;
}): CodeGraph {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-mcpflows-'));
  dirs.push(dir);
  const seed = CodeGraph.initSync(dir);
  seed.close();
  const cfg: Record<string, unknown> = {};
  if (opts.flowsEnabled) cfg.analysis = { flows: true };
  fs.writeFileSync(path.join(dir, 'codegraph.json'), JSON.stringify(cfg));
  clearProjectConfigCache();

  const dbPath = path.join(getCodeGraphDir(dir), 'codegraph.db');
  const conn = DatabaseConnection.open(dbPath); // initSync already created + schema'd it

  const q = new QueryBuilder(conn.getDb());
  q.advanceGraphWriteVersion(); // live version → 1
  swapFlows(conn.getDb(), 1, opts.flows, opts.steps ?? []);
  conn.close();

  const cg = CodeGraph.openSync(dir);
  graphs.push(cg);
  return cg;
}

function parse(result: ToolResult): { isError: boolean; body: Record<string, unknown> } {
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
  return { isError: result.isError === true, body: JSON.parse(text) as Record<string, unknown> };
}

describe('codegraph_list_flows', () => {
  it('defaults limit to 20 and reports the effective envelope', async () => {
    const cg = project({ flows: [flow('flow:a', 'GET /a'), flow('flow:b', 'GET /b')], flowsEnabled: true });
    const res = parse(await new ToolHandler(cg).execute('codegraph_list_flows', {}));
    expect(res.isError).toBe(false);
    expect(res.body.limit).toBe(20);
    expect(res.body.offset).toBe(0);
    expect(res.body.total).toBe(2);
    expect(res.body.state).toBe('available');
    expect((res.body.items as unknown[]).length).toBe(2);
  });

  it('clamps an over-cap limit to 100 and a below-min limit to 1 (never errors)', async () => {
    const cg = project({ flows: [flow('flow:a', 'GET /a')], flowsEnabled: true });
    const handler = new ToolHandler(cg);
    expect(parse(await handler.execute('codegraph_list_flows', { limit: 500 })).body.limit).toBe(100);
    expect(parse(await handler.execute('codegraph_list_flows', { limit: 0 })).body.limit).toBe(1);
    expect(parse(await handler.execute('codegraph_list_flows', { limit: 'abc' })).body.limit).toBe(20);
  });

  it('sorts by name ascending then id, and pages by offset/limit', async () => {
    const cg = project({
      flows: [flow('flow:z', 'Z'), flow('flow:a2', 'A'), flow('flow:a1', 'A')],
      flowsEnabled: true,
    });
    const handler = new ToolHandler(cg);
    const all = parse(await handler.execute('codegraph_list_flows', {})).body.items as Array<{ id: string; name: string }>;
    // name asc ('A' before 'Z'), then id asc within the 'A' tie.
    expect(all.map((f) => f.id)).toEqual(['flow:a1', 'flow:a2', 'flow:z']);

    const page = parse(await handler.execute('codegraph_list_flows', { limit: 1, offset: 1 }));
    expect((page.body.items as Array<{ id: string }>).map((f) => f.id)).toEqual(['flow:a2']);
    expect(page.body.total).toBe(3);
  });

  it('returns success-shaped disabled guidance when the catalog is not enabled', async () => {
    const cg = project({ flows: [flow('flow:a', 'GET /a')], flowsEnabled: false });
    const res = parse(await new ToolHandler(cg).execute('codegraph_list_flows', {}));
    expect(res.isError).toBe(false);
    expect(res.body.state).toBe('disabled');
    expect((res.body.items as unknown[]).length).toBe(0);
  });

  it('returns success-shaped not_indexed guidance for an un-indexed projectPath', async () => {
    const cg = project({ flows: [flow('flow:a', 'GET /a')], flowsEnabled: true });
    const bogus = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-noindex-'));
    dirs.push(bogus);
    const res = parse(await new ToolHandler(cg).execute('codegraph_list_flows', { projectPath: bogus }));
    expect(res.isError).toBe(false);
    expect(res.body.state).toBe('not_indexed');
  });
});

describe('codegraph_get_flow', () => {
  const steps: FlowStepRow[] = [
    { flowId: 'flow:a', nodeId: 'root:flow:a', symbolName: 'GET /a', symbolKind: 'route', depth: 0, parentNodeId: null, edgeKind: null, provenance: null },
    { flowId: 'flow:a', nodeId: 'fn:h', symbolName: 'handler', symbolKind: 'function', depth: 1, parentNodeId: 'root:flow:a', edgeKind: 'references', provenance: 'lsp' },
  ];

  it('returns the bounded graph with the exact truncation shape', async () => {
    const cg = project({
      flows: [flow('flow:a', 'GET /a', { truncatedDepth: true })],
      steps,
      flowsEnabled: true,
    });
    const res = parse(await new ToolHandler(cg).execute('codegraph_get_flow', { id: 'flow:a' }));
    expect(res.isError).toBe(false);
    expect(res.body.id).toBe('flow:a');
    expect(res.body.truncated).toBe(true);
    expect(res.body.truncation).toEqual({ depth: true, width: false, totalSteps: false });
    expect((res.body.steps as unknown[]).length).toBe(2);
    // The lsp step keeps its distinct 3-value provenance.
    const nonRoot = (res.body.steps as Array<{ depth: number; provenance: string | null }>).find((s) => s.depth === 1)!;
    expect(nonRoot.provenance).toBe('lsp');
  });

  it('returns success-shaped guidance for an unknown flow id (never isError)', async () => {
    const cg = project({ flows: [flow('flow:a', 'GET /a')], flowsEnabled: true });
    const res = parse(await new ToolHandler(cg).execute('codegraph_get_flow', { id: 'flow:does-not-exist' }));
    expect(res.isError).toBe(false);
    expect(res.body.found).toBe(false);
  });

  it('returns success-shaped disabled guidance when the catalog is not enabled', async () => {
    const cg = project({ flows: [flow('flow:a', 'GET /a')], steps, flowsEnabled: false });
    const res = parse(await new ToolHandler(cg).execute('codegraph_get_flow', { id: 'flow:a' }));
    expect(res.isError).toBe(false);
    expect(res.body.found).toBe(false);
    expect(res.body.state).toBe('disabled');
  });
});
