#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputJson = process.argv.includes('--json');
const distIndex = path.join(repoRoot, 'dist/index.js');
const distGraph = path.join(repoRoot, 'dist/graph/index.js');

if (!fs.existsSync(distIndex) || !fs.existsSync(distGraph)) {
  console.error('SPEC-008 retrieval probe requires a built dist/. Run `npm run build` first.');
  process.exit(1);
}

const [{ DatabaseConnection, QueryBuilder }, { GraphQueryManager, GraphTraverser }] = await Promise.all([
  import(pathToFileURL(distIndex).href),
  import(pathToFileURL(distGraph).href),
]);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-spec-008-retrieval-'));
let db;

try {
  db = DatabaseConnection.initialize(path.join(tempDir, 'codegraph.db'));
  const queries = new QueryBuilder(db.getDb());
  const before = countNodesAndEdges(db);

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
    metadata: { synthesizedBy: 'spec-008-probe' },
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

  const after = countNodesAndEdges(db);
  const traverser = new GraphTraverser(queries);
  const graph = new GraphQueryManager(queries);
  const outgoingTargets = queries.getOutgoingEdges('source').map((edge) => edge.target);
  const incomingInactive = queries.getIncomingEdges('inactive-target').length;
  const recoveredTargets = queries
    .findEdgesBetweenNodes(['source', 'active-target', 'inactive-target'], ['calls'])
    .map((edge) => edge.target);
  const calleeTargets = traverser.getCallees('source').map((entry) => entry.node.id);
  const contextTargets = graph.getContext('source').outgoingRefs.map((entry) => entry.node.id);

  const result = {
    status: 'pass',
    before,
    after,
    delta: {
      nodes: after.nodes - before.nodes,
      rawEdges: after.edges - before.edges,
      activeOutgoingEdges: outgoingTargets.length,
      inactiveAuditRowsHidden: after.edges - before.edges - outgoingTargets.length,
    },
    retrieval: {
      outgoingTargets,
      incomingInactive,
      recoveredTargets,
      calleeTargets,
      contextTargets,
    },
  };

  const expected = ['active-target'];
  const failures = [];
  if (after.nodes - before.nodes !== 3) failures.push('expected +3 nodes');
  if (after.edges - before.edges !== 2) failures.push('expected +2 raw edges');
  if (JSON.stringify(outgoingTargets) !== JSON.stringify(expected)) failures.push('outgoing retrieval leaked inactive edge');
  if (incomingInactive !== 0) failures.push('incoming retrieval leaked inactive edge');
  if (JSON.stringify(recoveredTargets) !== JSON.stringify(expected)) failures.push('edge recovery leaked inactive edge');
  if (JSON.stringify(calleeTargets) !== JSON.stringify(expected)) failures.push('callee traversal leaked inactive edge');
  if (JSON.stringify(contextTargets) !== JSON.stringify(expected)) failures.push('context retrieval leaked inactive edge');
  if (failures.length > 0) {
    result.status = 'fail';
    result.failures = failures;
  }

  if (outputJson || result.status === 'fail') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `SPEC-008 retrieval probe passed: nodes +${result.delta.nodes}, raw edges +${result.delta.rawEdges}, ` +
      `active outgoing ${result.delta.activeOutgoingEdges}, inactive audit rows hidden ${result.delta.inactiveAuditRowsHidden}.`,
    );
  }

  if (result.status === 'fail') process.exit(1);
} finally {
  if (db) db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function insertNode(queries, id, name, filePath) {
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

function countNodesAndEdges(connection) {
  return connection.getDb()
    .prepare('SELECT (SELECT COUNT(*) FROM nodes) AS nodes, (SELECT COUNT(*) FROM edges) AS edges')
    .get();
}
