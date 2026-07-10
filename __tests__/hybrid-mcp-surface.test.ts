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
import { DEGRADATION_HINT_STRINGS } from '../src/search/hybrid';
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

// Hermetic in-process env: this suite's fixtures run `indexAll()` and the search
// path IN this vitest worker, so an ambient embedding config (a developer shell /
// direnv loading .envrc.local) would construct a REAL provider — the no-provider
// degradation cases would fuse instead of degrade, and indexAll would embed over
// the wire. Same scrub list as embeddings-dormancy.test.ts; worker-local process,
// scrubbed once at module load.
const EMBED_ENV_KEYS = [
  'CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL', 'CODEGRAPH_EMBEDDING_API_KEY',
  'CODEGRAPH_EMBEDDING_DIMS', 'CODEGRAPH_EMBEDDING_BATCH_SIZE', 'CODEGRAPH_EMBEDDING_CONCURRENCY',
  'CODEGRAPH_EMBEDDING_TIMEOUT_MS', 'CODEGRAPH_EMBEDDING_PROVIDER', 'CODEGRAPH_MODEL_BASE_URL',
  'CODEGRAPH_MODEL_CACHE_DIR',
];
for (const key of EMBED_ENV_KEYS) delete process.env[key];

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

  // ── T022: provenance tags + timing + degradation footers (FR-008/012/015) ──

  it('T022: degraded (no provider, hybrid) → results lead, verbatim string 1 footer follows, success-shaped', async () => {
    const handler = await withDormantFixture();
    const res = await handler.execute('codegraph_search', { query: 'endpoint health', mode: 'hybrid' });
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    // Results lead (keyword arm surfaced the FTS-reachable decoy) …
    expect(text).toContain(DECOY_NAME);
    // … the FR-015 no-provider hint (string 1) follows, VERBATIM.
    expect(text).toContain(DEGRADATION_HINT_STRINGS['no-provider']);
    expect(text.trimEnd().endsWith('to enable.')).toBe(true);
    // Degraded → NO provenance tags and NO timing footer.
    expect(text).not.toContain('[keyword]');
    expect(text).not.toContain('[semantic]');
    expect(text).not.toContain('[both]');
    expect(text).not.toContain('semantic: embed');
  });

  it('T022: healthy hybrid → per-hit provenance tags + timing footer, no degradation note', async () => {
    const handler = await withSemanticFixture();
    const res = await handler.execute('codegraph_search', { query: SEMANTIC_QUERY, mode: 'hybrid' });
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    expect(text).toContain(TARGET_NAME);
    // FR-012 provenance tags on the primary line: the semantic-only target is
    // `[semantic]`, the keyword-matched decoy is `[keyword]`.
    expect(text).toMatch(/\*\*backoffLoop\*\* \(function\) \[semantic\]/);
    expect(text).toMatch(/\*\*endpointHealthCheck\*\* \(function\) \[keyword\]/);
    // FR-008 timing footer with the exact shape (integer ms, middot separator).
    expect(text).toMatch(/semantic: embed \d+ms · fusion \d+ms/);
    // Healthy → NO degradation note.
    expect(text).not.toContain('> **Note:**');
  });

  it('T022: healthy semantic → provenance tag on the target, timing footer present', async () => {
    const handler = await withSemanticFixture();
    const res = await handler.execute('codegraph_search', { query: SEMANTIC_QUERY, mode: 'semantic' });
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    expect(text).toMatch(/\*\*backoffLoop\*\* \(function\) \[semantic\]/);
    expect(text).toMatch(/semantic: embed \d+ms · fusion \d+ms/);
  });

  it('T022: keyword mode stays byte-identical — no tags, no timing, no degradation note', async () => {
    const handler = await withSemanticFixture();
    const res = await handler.execute('codegraph_search', { query: SEMANTIC_QUERY, mode: 'keyword' });
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    expect(text).not.toContain('[keyword]');
    expect(text).not.toContain('[semantic]');
    expect(text).not.toContain('[both]');
    expect(text).not.toContain('semantic: embed');
    expect(text).not.toContain('> **Note:**');
  });

  // ── Review item 1: FR-015 hint must survive the empty-result early return ──

  const NO_HIT_QUERY = 'zznosuchsymbolxyz';

  it('item 1: degraded AND zero results (hybrid, no provider) → "No results found" + verbatim no-provider hint', async () => {
    const handler = await withDormantFixture();
    const res = await handler.execute('codegraph_search', { query: NO_HIT_QUERY, mode: 'hybrid' });
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    expect(text).toContain(`No results found for "${NO_HIT_QUERY}"`);
    // The FR-015 no-provider hint (string 1) still appends, VERBATIM.
    expect(text).toContain(DEGRADATION_HINT_STRINGS['no-provider']);
    expect(text.trimEnd().endsWith('to enable.')).toBe(true);
  });

  it('item 1: explicit keyword mode with zero results stays byte-identical — no hint', async () => {
    const handler = await withDormantFixture();
    const res = await handler.execute('codegraph_search', { query: NO_HIT_QUERY, mode: 'keyword' });
    expect(res.isError).toBeFalsy();
    // Keyword mode carries a null degradation → the empty message is byte-identical to today.
    expect(textOf(res)).toBe(`No results found for "${NO_HIT_QUERY}"`);
  });
});
