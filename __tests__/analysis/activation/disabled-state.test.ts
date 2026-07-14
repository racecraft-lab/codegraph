/**
 * SPEC-011 T053 [US5] — disabled-state resolution + success-shape (FR-025/030, SC-009).
 *
 * The live per-catalog opt-in flag is consulted FIRST: a catalog previously
 * enabled and computed but now disabled reads state="disabled" (its retained
 * rows/metadata inert), NEVER available or stale. Expected conditions — disabled,
 * not-indexed, unknown identifier — are success-shaped on every surface (never
 * `isError`) and carry the machine-readable `state`.
 *
 * Both surfaces render from the SAME shared read facades
 * (`readFlowList`/`readClusterList`, FR-028a), so the state-resolution invariants
 * are asserted surface-agnostically at the facade + `resolveState` level; the MCP
 * surface is additionally smoke-checked for isError-free shape.
 *
 * Real files + real SQLite temp dirs (no mocking).
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
import { readClusterList, readFlowList } from '../../../src/analysis';
import {
  resolveState,
  swapClusters,
  swapFlows,
  type CatalogProbe,
  type ClusterRow,
  type FlowRow,
} from '../../../src/analysis/catalog-store';
import { cleanupSeeds, freshSeed, type SeedHandle } from '../flows/helpers';

const FLOW: FlowRow = {
  id: 'flow:a',
  name: 'GET /a',
  entryKind: 'route',
  rootNodeId: 'root:flow:a',
  rootName: 'GET /a',
  rootKind: 'route',
  truncatedDepth: false,
  truncatedWidth: false,
  truncatedSteps: false,
};
const CLUSTER: ClusterRow = {
  id: 'cl:a',
  canonicalLabel: 'src: a',
  displayLabel: null,
  memberCount: 2,
  isSingleton: false,
};

/** A content-bearing, fresh (recorded == live) probe — available when enabled. */
function freshProbe(): CatalogProbe {
  return { graphWriteVersion: 5, computedFromVersion: 5, firstRunFailed: false, hasMeta: true, contentCount: 3 };
}
/** A content-bearing but stale (recorded < live) probe — stale when enabled. */
function staleProbe(): CatalogProbe {
  return { graphWriteVersion: 6, computedFromVersion: 5, firstRunFailed: false, hasMeta: true, contentCount: 3 };
}

// ── MCP surface harness (a real opened CodeGraph, both catalogs pre-seeded) ─────
const dirs: string[] = [];
const graphs: CodeGraph[] = [];
afterEach(() => {
  cleanupSeeds();
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

/** Open a CodeGraph over a temp project whose flows + clusters catalogs are pre-seeded at v1. */
function project(opts: { flowsEnabled: boolean; clustersEnabled: boolean }): CodeGraph {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-disabled-'));
  dirs.push(dir);
  const seed = CodeGraph.initSync(dir);
  seed.close();
  const analysis: Record<string, boolean> = {};
  if (opts.flowsEnabled) analysis.flows = true;
  if (opts.clustersEnabled) analysis.clusters = true;
  fs.writeFileSync(path.join(dir, 'codegraph.json'), JSON.stringify({ analysis }));
  clearProjectConfigCache();

  const dbPath = path.join(getCodeGraphDir(dir), 'codegraph.db');
  const conn = DatabaseConnection.open(dbPath);
  const q = new QueryBuilder(conn.getDb());
  q.advanceGraphWriteVersion(); // live version → 1
  swapFlows(conn.getDb(), 1, [FLOW], []);
  swapClusters(conn.getDb(), 1, [CLUSTER], []);
  conn.close();

  const cg = CodeGraph.openSync(dir);
  graphs.push(cg);
  return cg;
}

function parse(result: ToolResult): { isError: boolean; body: Record<string, unknown> } {
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
  return { isError: result.isError === true, body: JSON.parse(text) as Record<string, unknown> };
}

describe('disabled-state resolution — live flag consulted FIRST (T053, FR-025)', () => {
  it('resolveState returns disabled when the flag is OFF, even over a fresh available catalog', () => {
    // The ONLY difference is the flag: enabled → available, disabled → disabled.
    expect(resolveState(true, freshProbe())).toBe('available');
    expect(resolveState(false, freshProbe())).toBe('disabled');
  });

  it('resolveState returns disabled (not stale) when the flag is OFF over a stale catalog', () => {
    expect(resolveState(true, staleProbe())).toBe('stale');
    expect(resolveState(false, staleProbe())).toBe('disabled');
  });

  it('readFlowList/readClusterList suppress retained rows when disabled (inert), serve them when enabled', () => {
    const h: SeedHandle = freshSeed();
    h.queries.advanceGraphWriteVersion(); // live version → 1
    swapFlows(h.db, 1, [FLOW], []);
    swapClusters(h.db, 1, [CLUSTER], []);

    // Enabled: retained rows are live and available.
    const flowsOn = readFlowList(h.db, true, 20, 0);
    expect(flowsOn.state).toBe('available');
    expect(flowsOn.total).toBe(1);
    expect(flowsOn.items.length).toBe(1);
    const clustersOn = readClusterList(h.db, true, 1, 20, 0);
    expect(clustersOn.state).toBe('available');
    expect(clustersOn.total).toBe(1);

    // Disabled: the SAME retained rows are inert — an empty page under state=disabled.
    const flowsOff = readFlowList(h.db, false, 20, 0);
    expect(flowsOff.state).toBe('disabled');
    expect(flowsOff.items).toEqual([]);
    expect(flowsOff.total).toBe(0);
    expect(flowsOff.sourceVersion).toBe(0);
    const clustersOff = readClusterList(h.db, false, 1, 20, 0);
    expect(clustersOff.state).toBe('disabled');
    expect(clustersOff.items).toEqual([]);
    expect(clustersOff.total).toBe(0);
  });
});

describe('disabled-state success-shape across the MCP surface (T053, FR-030/SC-009)', () => {
  it('a previously-computed-but-now-disabled catalog is success-shaped with state=disabled', async () => {
    const cg = project({ flowsEnabled: false, clustersEnabled: false });
    const handler = new ToolHandler(cg);

    const flows = parse(await handler.execute('codegraph_list_flows', {}));
    expect(flows.isError).toBe(false);
    expect(flows.body.state).toBe('disabled');
    expect((flows.body.items as unknown[]).length).toBe(0);

    const clusters = parse(await handler.execute('codegraph_list_clusters', {}));
    expect(clusters.isError).toBe(false);
    expect(clusters.body.state).toBe('disabled');
    expect((clusters.body.items as unknown[]).length).toBe(0);

    const detail = parse(await handler.execute('codegraph_get_flow', { id: 'flow:a' }));
    expect(detail.isError).toBe(false);
    expect(detail.body.state).toBe('disabled');
    expect(detail.body.found).toBe(false);
  });

  it('not-indexed and unknown-id queries are success-shaped and carry a state', async () => {
    const cg = project({ flowsEnabled: true, clustersEnabled: true });
    const handler = new ToolHandler(cg);

    // Unknown flow id within a live catalog → success-shaped miss.
    const unknown = parse(await handler.execute('codegraph_get_flow', { id: 'flow:nope' }));
    expect(unknown.isError).toBe(false);
    expect(unknown.body.found).toBe(false);

    // A projectPath with no index at all → success-shaped not_indexed on both lists.
    const bogus = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-noindex-'));
    dirs.push(bogus);
    const flows = parse(await handler.execute('codegraph_list_flows', { projectPath: bogus }));
    expect(flows.isError).toBe(false);
    expect(flows.body.state).toBe('not_indexed');
    const clusters = parse(await handler.execute('codegraph_list_clusters', { projectPath: bogus }));
    expect(clusters.isError).toBe(false);
    expect(clusters.body.state).toBe('not_indexed');
  });
});
