/**
 * SPEC-011 T019 [US1] — flow-catalog determinism (SC-004, flows portion).
 *
 * Analyzing an unchanged graph twice yields byte-identical `flows` + `flow_steps`
 * rows — both re-running against the same DB and analyzing two identically-seeded
 * DBs from scratch (cross-run/cross-clone reproducibility).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runFlowAnalysis } from '../../../src/analysis';
import { freshSeed, cleanupSeeds, node, edge, file, setVersion, type SeedHandle } from './helpers';

afterEach(cleanupSeeds);

/** Seed a mixed graph with EXPLICIT ids so two DBs are byte-identical inputs. */
function seedGraph(h: SeedHandle): void {
  setVersion(h, 3);
  // Route → handler → service (references then calls).
  node(h, { id: 'route:src/api.ts:1:GET:/users', name: 'GET /users', kind: 'route', filePath: 'src/api.ts' });
  node(h, { id: 'fn:listUsers', name: 'listUsers', kind: 'function', filePath: 'src/api.ts', qualifiedName: 'src/api.ts::listUsers' });
  node(h, { id: 'fn:queryUsers', name: 'queryUsers', kind: 'function', filePath: 'src/db.ts', qualifiedName: 'src/db.ts::queryUsers' });
  edge(h, 'route:src/api.ts:1:GET:/users', 'fn:listUsers', 'references', 'tree-sitter');
  edge(h, 'fn:listUsers', 'fn:queryUsers', 'calls', 'tree-sitter');
  // A CLI command with a named handler.
  file(h, 'src/cli.ts', `program.command('sync').action(syncHandler);\n`);
  node(h, { id: 'fn:syncHandler', name: 'syncHandler', kind: 'function', filePath: 'src/cli.ts', qualifiedName: 'src/cli.ts::syncHandler' });
  node(h, { id: 'fn:doSync', name: 'doSync', kind: 'function', filePath: 'src/sync.ts', qualifiedName: 'src/sync.ts::doSync' });
  edge(h, 'fn:syncHandler', 'fn:doSync', 'calls', 'lsp');
  // An exposed export.
  node(h, { id: 'fn:publicApi', name: 'publicApi', kind: 'function', filePath: 'src/lib.ts', qualifiedName: 'src/lib.ts::publicApi', isExported: true });
}

const FLOWS_SQL =
  'SELECT id, name, entry_kind, root_node_id, root_name, root_kind, truncated_depth, truncated_width, truncated_steps, source_version FROM flows ORDER BY id';
const STEPS_SQL =
  'SELECT flow_id, node_id, symbol_name, symbol_kind, depth, parent_node_id, edge_kind, provenance FROM flow_steps ORDER BY flow_id, node_id';

function snapshot(h: SeedHandle): { flows: unknown[]; steps: unknown[] } {
  return {
    flows: h.db.prepare(FLOWS_SQL).all(),
    steps: h.db.prepare(STEPS_SQL).all(),
  };
}

describe('flow-catalog determinism', () => {
  it('produces byte-identical rows when re-analyzing the same unchanged graph', () => {
    const h = freshSeed();
    seedGraph(h);
    runFlowAnalysis(h.graph, h.db);
    const first = snapshot(h);
    runFlowAnalysis(h.graph, h.db);
    const second = snapshot(h);

    expect(first.flows.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it('produces identical rows across two independently-seeded databases (SC-004)', () => {
    const a = freshSeed();
    const b = freshSeed();
    seedGraph(a);
    seedGraph(b);
    runFlowAnalysis(a.graph, a.db);
    runFlowAnalysis(b.graph, b.db);

    expect(snapshot(a)).toEqual(snapshot(b));
    expect(snapshot(a).flows.length).toBeGreaterThan(0);
  });
});
