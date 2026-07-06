import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseConnection, QueryBuilder } from '../src';
import { GraphQueryManager, GraphTraverser } from '../src/graph';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function insertNode(queries: QueryBuilder, id: string, name: string, filePath: string): void {
  queries.insertNode({
    id,
    kind: 'function',
    name,
    qualifiedName: name,
    filePath,
    language: 'typescript',
    startLine: 1,
    endLine: 3,
    startColumn: 0,
    endColumn: 20,
    visibility: 'public',
    isExported: true,
    isAsync: false,
    isStatic: false,
    isAbstract: false,
    updatedAt: Date.now(),
  });
}

describe('LSP retrieval regression filtering', () => {
  it('excludes inactive LSP suppression audit rows while preserving active heuristic edges', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lsp-retrieval-'));
    dirs.push(dir);
    const db = DatabaseConnection.initialize(path.join(dir, 'codegraph.db'));
    try {
      const queries = new QueryBuilder(db.getDb());
      insertNode(queries, 'source', 'caller', 'src/caller.ts');
      insertNode(queries, 'active-target', 'activeHelper', 'src/active.ts');
      insertNode(queries, 'inactive-target', 'inactiveHelper', 'src/inactive.ts');

      queries.insertEdge({
        source: 'source',
        target: 'active-target',
        kind: 'calls',
        line: 2,
        column: 4,
        provenance: 'heuristic',
        metadata: { synthesizedBy: 'fixture' },
      });
      queries.insertEdge({
        source: 'source',
        target: 'inactive-target',
        kind: 'calls',
        line: 3,
        column: 4,
        provenance: 'tree-sitter',
        metadata: {
          lsp: {
            decision: 'suppressed',
            active: false,
            reason: 'external-target',
          },
        },
      });

      const rawCount = db.getDb().prepare('SELECT COUNT(*) AS count FROM edges').get() as { count: number };
      const traverser = new GraphTraverser(queries);
      const graph = new GraphQueryManager(queries);

      expect(rawCount.count).toBe(2);
      expect(queries.getOutgoingEdges('source').map((edge) => edge.target)).toEqual(['active-target']);
      expect(queries.getIncomingEdges('inactive-target')).toEqual([]);
      expect(
        queries
          .findEdgesBetweenNodes(['source', 'active-target', 'inactive-target'], ['calls'])
          .map((edge) => edge.target),
      ).toEqual(['active-target']);
      expect(traverser.getCallees('source').map((entry) => entry.node.id)).toEqual(['active-target']);
      expect(graph.getContext('source').outgoingRefs.map((entry) => entry.node.id)).toEqual(['active-target']);
    } finally {
      db.close();
    }
  });
});
