/**
 * SPEC-003 T016 — the MCP `codegraph_search` mode surface.
 *
 * Plumbs the optional `mode` param through the MCP tool: schema enum, the
 * omitted/unknown → `auto` surface coercion (never `isError`, never throws),
 * and the production async-acquisition pattern (`acquireQueryVectorForSearch`
 * awaited BEFORE the sync `searchNodesDetailed`). Provenance tags, timing
 * footers, and degradation hints are OUT of scope here — they land in T022.
 *
 * Real SQLite temp projects with hand-seeded fixture vectors and the library's
 * query-provider seam (`__setQueryEmbeddingProviderForTests`), so the semantic
 * arm is observable end-to-end THROUGH the MCP surface without a live endpoint
 * (repo convention: no DB / embedding mocking). Contract:
 * specs/003-hybrid-semantic-search/contracts/mcp-cli-surface.md (FR-002).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ToolHandler, tools } from '../src/mcp/tools';
import { CodeGraph, __setQueryEmbeddingProviderForTests } from '../src';
import { DatabaseConnection, getDatabasePath } from '../src/db';
import { QueryBuilder } from '../src/db/queries';
import { encodeVector } from '../src/embeddings/indexer-hook';
import type { EmbeddingProvider } from '../src/embeddings/provider';

let HAS_SQLITE = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:sqlite');
  HAS_SQLITE = true;
} catch {
  HAS_SQLITE = false;
}

const FIXTURE_MODEL = 'fixture-model-384';
const FIXTURE_DIMS = 384;
/** Basis index of the semantic-only target (query embeds to the same one-hot → cosine 1.0). */
const TARGET_BASIS = 3;
/** Filler bases sit well above the target basis so every filler vector is orthogonal to the query. */
const FILLER_BASIS_START = 50;

/** The strict semantic-only probe: `backoffLoop` shares no FTS token-prefix with the query. */
const SEMANTIC_QUERY = 'exponential wait between flaky endpoint attempts';
const TARGET_NAME = 'backoffLoop';
/** Token-matches "endpoint" → the keyword arm's wrong (non-empty) hit. */
const DECOY_NAME = 'endpointHealthCheck';

/** A one-hot, unit-normalized fixture vector with `hotIndex` set to 1. */
function unitVector(hotIndex: number): Float32Array {
  const v = new Float32Array(FIXTURE_DIMS);
  v[hotIndex] = 1;
  return v;
}

/**
 * Query-provider double the library seam swaps in: reports the EXACT stored model
 * id (so the scan/cache key matches) and maps the semantic query to the target's
 * one-hot basis. Any other text embeds to an orthogonal filler basis (cosine 0) so
 * an incidental warm never surfaces the target spuriously — and never throws.
 */
const fixtureQueryProvider: EmbeddingProvider = {
  id: FIXTURE_MODEL,
  dims: FIXTURE_DIMS,
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => unitVector(t === SEMANTIC_QUERY ? TARGET_BASIS : FILLER_BASIS_START - 1));
  },
};

/** Real TypeScript so tree-sitter populates nodes + nodes_fts (structural index). */
function makeFixture(dirs: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-hybrid-mcp-'));
  dirs.push(dir);
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir);
  fs.writeFileSync(
    path.join(srcDir, 'resilience.ts'),
    '/** Repeatedly runs the closure, doubling the pause each time it throws. */\n' +
      `export function ${TARGET_NAME}(job: () => void): void {\n  job();\n}\n` +
      '/** Verifies a service URL responds before traffic is routed to it. */\n' +
      `export function ${DECOY_NAME}(url: string): boolean {\n  return url.length > 0;\n}\n`,
  );
  return dir;
}

/** Seed backoffLoop's vector at the target basis; everything else gets an orthogonal filler. */
function seedFixtureVectors(dir: string): void {
  const conn = DatabaseConnection.open(getDatabasePath(dir));
  try {
    const q = new QueryBuilder(conn.getDb());
    let filler = FILLER_BASIS_START;
    for (const node of q.selectEmbeddableNodesMissingVector(FIXTURE_MODEL)) {
      const basis = node.name === TARGET_NAME ? TARGET_BASIS : filler++;
      q.upsertNodeVector(node.id, FIXTURE_MODEL, FIXTURE_DIMS, encodeVector(unitVector(basis)), `fixture-hash-${node.id}`);
    }
    q.setMetadata('embedding_model', FIXTURE_MODEL);
    q.setMetadata('embedding_dims', String(FIXTURE_DIMS));
  } finally {
    conn.close();
  }
}

/** Concatenated text of a ToolResult's content blocks. */
function textOf(res: { content: Array<{ text: string }> }): string {
  return res.content.map((c) => c.text).join('\n');
}

describe.skipIf(!HAS_SQLITE)('SPEC-003 T016 — MCP codegraph_search mode surface', () => {
  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];
  const savedAllowlist = process.env.CODEGRAPH_MCP_TOOLS;

  beforeEach(() => {
    // execute() enforces CODEGRAPH_MCP_TOOLS; unset means every tool is allowed
    // through the guard (the default-explore-only paring lives in getTools, not
    // execute). Force-unset so a stray ambient value can't disable search here.
    delete process.env.CODEGRAPH_MCP_TOOLS;
  });

  afterEach(() => {
    __setQueryEmbeddingProviderForTests(undefined);
    if (savedAllowlist === undefined) delete process.env.CODEGRAPH_MCP_TOOLS;
    else process.env.CODEGRAPH_MCP_TOOLS = savedAllowlist;
    while (graphs.length) { try { graphs.pop()!.close(); } catch { /* may already be closed */ } }
    while (dirs.length) {
      const dir = dirs.pop()!;
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** An indexed fixture WITH seeded vectors and the query-provider seam installed. */
  async function withSemanticFixture(): Promise<ToolHandler> {
    __setQueryEmbeddingProviderForTests(fixtureQueryProvider);
    const dir = makeFixture(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);
    seedFixtureVectors(dir);
    return new ToolHandler(cg);
  }

  /** An indexed fixture with NO provider and NO vectors — every mode is dormant → keyword. */
  async function withDormantFixture(): Promise<ToolHandler> {
    const dir = makeFixture(dirs);
    const cg = await CodeGraph.init(dir);
    graphs.push(cg);
    expect((await cg.indexAll()).success).toBe(true);
    return new ToolHandler(cg);
  }

  it('exposes `mode` on the codegraph_search inputSchema with the four-value enum', () => {
    const search = tools.find((t) => t.name === 'codegraph_search');
    expect(search).toBeDefined();
    const mode = search!.inputSchema.properties.mode;
    expect(mode).toBeDefined();
    expect(mode.type).toBe('string');
    expect(mode.enum).toEqual(['keyword', 'semantic', 'hybrid', 'auto']);
    expect(typeof mode.description).toBe('string');
    expect(mode.description.length).toBeGreaterThan(0);
    // NOT required — mode is optional and defaults to auto at the surface.
    expect(search!.inputSchema.required).toEqual(['query']);
  });

  it('does NOT add `mode` to the codegraph_explore schema (explore path untouched)', () => {
    const explore = tools.find((t) => t.name === 'codegraph_explore');
    expect(explore).toBeDefined();
    expect(explore!.inputSchema.properties.mode).toBeUndefined();
  });

  it('keyword mode is non-vacuous: returns the decoy, NOT the semantic-only target', async () => {
    const handler = await withSemanticFixture();
    const res = await handler.execute('codegraph_search', { query: SEMANTIC_QUERY, mode: 'keyword' });
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    expect(text).toContain(DECOY_NAME);
    expect(text).not.toContain(TARGET_NAME);
  });

  it('hybrid mode surfaces the semantic-only target through the MCP surface', async () => {
    const handler = await withSemanticFixture();
    const res = await handler.execute('codegraph_search', { query: SEMANTIC_QUERY, mode: 'hybrid' });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain(TARGET_NAME);
  });

  it('semantic mode surfaces the semantic-only target through the MCP surface', async () => {
    const handler = await withSemanticFixture();
    const res = await handler.execute('codegraph_search', { query: SEMANTIC_QUERY, mode: 'semantic' });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain(TARGET_NAME);
  });

  it('omitted mode → auto: with no provider it serves keyword results, success-shaped', async () => {
    const handler = await withDormantFixture();
    const res = await handler.execute('codegraph_search', { query: 'endpoint health' });
    expect(res.isError).toBeFalsy();
    // Dormant auto → keyword arm surfaces the FTS-reachable symbol.
    expect(textOf(res)).toContain(DECOY_NAME);
  });

  it('unknown mode ("kwd") → coerced to auto, never errors', async () => {
    const handler = await withDormantFixture();
    const res = await handler.execute('codegraph_search', { query: 'endpoint health', mode: 'kwd' });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain(DECOY_NAME);
  });
});
