/**
 * SPEC-011 T058 — cross-surface parity (FR-028a, SC-009).
 *
 * The MCP tools and the REST endpoints render catalog responses from ONE shared
 * TypeScript wire-shape source (`src/analysis/types.ts`), so the two surfaces
 * cannot drift. This test makes that checkable rather than merely asserted: it
 * produces a REAL item for each of the four wire shapes by driving the analysis
 * engine + read facades (the exact objects the MCP handlers serialize), then
 * asserts each item's field names are field-for-field identical to the
 * corresponding `FlowSummary` / `FlowDetail` / `FlowStep` / `ClusterSummary`
 * schema in the committed `src/server/openapi.yaml` (the REST contract).
 *
 * Zero-dep by design (the repo ships no YAML parser): the four schemas' declared
 * field sets are read structurally, reusing the no-parser discipline of
 * `server-openapi-contract.test.ts`. Every property of these four schemas is
 * `required`, so the schema's `required` array IS its full field set.
 *
 * Real SQLite temp dirs (no mocking).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  runFlowAnalysis,
  runClusterAnalysis,
  readFlowList,
  readFlowDetail,
  readClusterList,
} from '../../src/analysis';
import { cleanupSeeds, edge, file, freshSeed, node, setVersion, type SeedHandle } from './flows/helpers';

afterEach(cleanupSeeds);

const OPENAPI = path.resolve(__dirname, '../../src/server/openapi.yaml');

/**
 * The declared top-level field set of a `components.schemas.<name>` schema,
 * read straight from the committed contract. A schema is declared at a 4-space
 * key; its own `required: [...]` array is the first 6-space `required:` after it
 * (a nested object's `required` sits at 10 spaces, so the exact-6-space match
 * never captures it), and the next 4-space key ends the schema. Throws if the
 * schema or its required array is missing, so a contract typo fails loudly.
 */
function schemaFields(yaml: string, name: string): string[] {
  if (yaml.includes('\t')) throw new Error('YAML indentation must not use tabs');
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^ {4}${name}:\\s*(#.*)?$`).test(l));
  if (start === -1) throw new Error(`schema ${name} not found in openapi.yaml`);
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^ {6}required:\s*\[([^\]]*)\]\s*$/);
    if (m) return m[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (/^ {4}\S/.test(line)) break; // next schema — no top-level required found
  }
  throw new Error(`no top-level required array for schema ${name}`);
}

/**
 * Seed a graph with a route→handler→service flow (so a flow with steps exists)
 * and three files with cross-file evidence (so clusters populate), then run both
 * analyzers into the catalog.
 */
async function seedAndAnalyze(h: SeedHandle): Promise<void> {
  setVersion(h, 1);
  node(h, { id: 'route:GET:/users', name: 'GET /users', kind: 'route', filePath: 'src/api.ts' });
  node(h, { id: 'fn:listUsers', name: 'listUsers', kind: 'function', filePath: 'src/api.ts', isExported: true });
  node(h, { id: 'fn:queryUsers', name: 'queryUsers', kind: 'function', filePath: 'src/db.ts' });
  edge(h, 'route:GET:/users', 'fn:listUsers', 'references', 'tree-sitter');
  edge(h, 'fn:listUsers', 'fn:queryUsers', 'calls', 'lsp');
  file(h, 'src/api.ts', 'x');
  file(h, 'src/db.ts', 'x');
  file(h, 'src/util.ts', 'x'); // an isolated file → a singleton cluster
  await runFlowAnalysis(h.graph, h.db);
  await runClusterAnalysis(h.graph, h.db);
}

describe('SPEC-011 T058 — MCP ↔ REST cross-surface field parity (FR-028a, SC-009)', () => {
  it('every catalog item field-for-field matches its openapi schema', async () => {
    const h = freshSeed();
    await seedAndAnalyze(h);
    const yaml = fs.readFileSync(OPENAPI, 'utf8');

    // Produce the REAL wire objects the MCP handlers serialize.
    const flowList = readFlowList(h.db, true, 20, 0);
    expect(flowList.items.length).toBeGreaterThan(0);
    const flowSummary = flowList.items[0]!;

    const detailRead = readFlowDetail(h.db, true, flowSummary.id);
    expect(detailRead.found).toBe(true);
    if (!detailRead.found) throw new Error('flow detail not found');
    const flowDetail = detailRead.flow;
    expect(flowDetail.steps.length).toBeGreaterThan(0);
    const flowStep = flowDetail.steps[0]!;

    const clusterList = readClusterList(h.db, true, 1, 20, 0);
    expect(clusterList.items.length).toBeGreaterThan(0);
    const clusterSummary = clusterList.items[0]!;

    // Field-for-field: runtime item keys == the schema's declared field set.
    const cases: Array<[string, Record<string, unknown>]> = [
      ['FlowSummary', flowSummary],
      ['FlowDetail', flowDetail],
      ['FlowStep', flowStep as unknown as Record<string, unknown>],
      ['ClusterSummary', clusterSummary],
    ];
    for (const [schema, item] of cases) {
      const declared = schemaFields(yaml, schema).sort();
      expect(declared.length, `${schema} declared fields`).toBeGreaterThan(0);
      const actual = Object.keys(item).sort();
      expect(actual, `${schema}: MCP item ⇄ openapi schema`).toEqual(declared);
    }
  });

  it('pins each schema field set so a one-sided add/remove is caught', () => {
    const yaml = fs.readFileSync(OPENAPI, 'utf8');
    expect(schemaFields(yaml, 'FlowSummary').sort()).toEqual(
      ['entryKind', 'id', 'name', 'stepCount', 'truncated'],
    );
    expect(schemaFields(yaml, 'FlowStep').sort()).toEqual(
      ['depth', 'edgeKind', 'kind', 'name', 'nodeId', 'parentNodeId', 'provenance'],
    );
    expect(schemaFields(yaml, 'FlowDetail').sort()).toEqual(
      ['entryKind', 'id', 'name', 'root', 'sourceVersion', 'state', 'steps', 'truncated', 'truncation'],
    );
    expect(schemaFields(yaml, 'ClusterSummary').sort()).toEqual(
      ['canonicalLabel', 'displayLabel', 'id', 'isSingleton', 'memberCount'],
    );
  });
});
