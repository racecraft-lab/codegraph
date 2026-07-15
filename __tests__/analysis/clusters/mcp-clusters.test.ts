/**
 * SPEC-011 T031 [US2] — MCP contract for `codegraph_list_clusters`
 * (FR-027/029/030).
 *
 * Sort member_count desc → canonicalLabel asc → id; `minSize` default 1, `<1`→1,
 * `>=2` suppresses singletons, `total` reflects the post-`minSize` count;
 * success-shaped disabled / not-indexed (never isError).
 *
 * Real temp SQLite + a real opened CodeGraph; the clusters catalog is seeded
 * through a second connection (the index-time hook is US4).
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
import { swapClusters, type ClusterRow } from '../../../src/analysis/catalog-store';

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

function cluster(id: string, memberCount: number, canonicalLabel: string, extra: Partial<ClusterRow> = {}): ClusterRow {
  return {
    id,
    canonicalLabel,
    displayLabel: null,
    memberCount,
    isSingleton: memberCount === 1,
    ...extra,
  };
}

/** Opened CodeGraph over a temp project whose clusters catalog is pre-seeded. */
function project(opts: { clusters: ClusterRow[]; clustersEnabled: boolean }): CodeGraph {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-mcpclusters-'));
  dirs.push(dir);
  const seed = CodeGraph.initSync(dir);
  seed.close();
  const cfg: Record<string, unknown> = {};
  if (opts.clustersEnabled) cfg.analysis = { clusters: true };
  fs.writeFileSync(path.join(dir, 'codegraph.json'), JSON.stringify(cfg));
  clearProjectConfigCache();

  const dbPath = path.join(getCodeGraphDir(dir), 'codegraph.db');
  const conn = DatabaseConnection.open(dbPath);
  const q = new QueryBuilder(conn.getDb());
  q.advanceGraphWriteVersion(); // live version → 1
  swapClusters(conn.getDb(), 1, opts.clusters, []);
  conn.close();

  const cg = CodeGraph.openSync(dir);
  graphs.push(cg);
  return cg;
}

function parse(result: ToolResult): { isError: boolean; body: Record<string, unknown> } {
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
  return { isError: result.isError === true, body: JSON.parse(text) as Record<string, unknown> };
}

describe('codegraph_list_clusters', () => {
  it('defaults limit to 20 and reports the effective envelope', async () => {
    const cg = project({
      clusters: [cluster('cl:a', 3, 'A'), cluster('cl:b', 5, 'B')],
      clustersEnabled: true,
    });
    const res = parse(await new ToolHandler(cg).execute('codegraph_list_clusters', {}));
    expect(res.isError).toBe(false);
    expect(res.body.limit).toBe(20);
    expect(res.body.offset).toBe(0);
    expect(res.body.total).toBe(2);
    expect(res.body.state).toBe('available');
    expect((res.body.items as unknown[]).length).toBe(2);
  });

  it('sorts by member_count desc, then canonicalLabel asc, then id', async () => {
    const cg = project({
      clusters: [cluster('cl:1', 3, 'B'), cluster('cl:2', 5, 'A'), cluster('cl:3', 3, 'A')],
      clustersEnabled: true,
    });
    const res = parse(await new ToolHandler(cg).execute('codegraph_list_clusters', {}));
    const ids = (res.body.items as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toEqual(['cl:2', 'cl:3', 'cl:1']);
  });

  it('surfaces the shared item field names (id, canonicalLabel, displayLabel, memberCount, isSingleton)', async () => {
    const cg = project({ clusters: [cluster('cl:a', 2, 'A')], clustersEnabled: true });
    const res = parse(await new ToolHandler(cg).execute('codegraph_list_clusters', {}));
    const item = (res.body.items as Array<Record<string, unknown>>)[0]!;
    expect(Object.keys(item).sort()).toEqual(['canonicalLabel', 'displayLabel', 'id', 'isSingleton', 'memberCount']);
    expect(item.isSingleton).toBe(false);
  });

  it('default minSize=1 includes singletons; minSize>=2 suppresses them and total reflects the filter', async () => {
    const seed = { clusters: [cluster('cl:big', 4, 'Big'), cluster('cl:solo', 1, 'Solo')], clustersEnabled: true };
    const handler = new ToolHandler(project(seed));
    const all = parse(await handler.execute('codegraph_list_clusters', {}));
    expect(all.body.total).toBe(2);
    expect((all.body.items as unknown[]).length).toBe(2);

    const filtered = parse(await handler.execute('codegraph_list_clusters', { minSize: 2 }));
    expect(filtered.body.total).toBe(1); // total reflects the post-minSize count
    expect((filtered.body.items as Array<{ id: string }>).map((c) => c.id)).toEqual(['cl:big']);
  });

  it('clamps minSize below 1 to 1 (singletons return)', async () => {
    const cg = project({ clusters: [cluster('cl:solo', 1, 'Solo')], clustersEnabled: true });
    const res = parse(await new ToolHandler(cg).execute('codegraph_list_clusters', { minSize: 0 }));
    expect(res.body.total).toBe(1);
    expect((res.body.items as unknown[]).length).toBe(1);
  });

  it('clamps an over-cap limit to 100 and a below-min limit to 1 (never errors)', async () => {
    const cg = project({ clusters: [cluster('cl:a', 2, 'A')], clustersEnabled: true });
    const handler = new ToolHandler(cg);
    expect(parse(await handler.execute('codegraph_list_clusters', { limit: 500 })).body.limit).toBe(100);
    expect(parse(await handler.execute('codegraph_list_clusters', { limit: 0 })).body.limit).toBe(1);
    expect(parse(await handler.execute('codegraph_list_clusters', { limit: 'abc' })).body.limit).toBe(20);
    // Empty string is ABSENT → default (limit 20; minSize 1), matching read-ops /
    // REST — not Number('') === 0 (FR-028a).
    expect(parse(await handler.execute('codegraph_list_clusters', { limit: '' })).body.limit).toBe(20);
    const emptyMin = parse(await handler.execute('codegraph_list_clusters', { minSize: '' }));
    expect((emptyMin.body.items as unknown[]).length).toBe(1); // minSize '' → default 1
  });

  it('returns success-shaped disabled guidance when the catalog is not enabled', async () => {
    const cg = project({ clusters: [cluster('cl:a', 2, 'A')], clustersEnabled: false });
    const res = parse(await new ToolHandler(cg).execute('codegraph_list_clusters', {}));
    expect(res.isError).toBe(false);
    expect(res.body.state).toBe('disabled');
    expect((res.body.items as unknown[]).length).toBe(0);
  });

  it('returns success-shaped not_indexed guidance for an un-indexed projectPath', async () => {
    const cg = project({ clusters: [cluster('cl:a', 2, 'A')], clustersEnabled: true });
    const bogus = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-noindex-'));
    dirs.push(bogus);
    const res = parse(await new ToolHandler(cg).execute('codegraph_list_clusters', { projectPath: bogus }));
    expect(res.isError).toBe(false);
    expect(res.body.state).toBe('not_indexed');
  });
});
