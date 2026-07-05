/**
 * Embedding incremental freshness — SPEC-001 Slice B / User Story 2 (T024).
 *
 * Slice A embeds every symbol on a full index. Slice B keeps that vector layer
 * CURRENT as code changes: each vector-preserving re-index (and, once T026 wires
 * it, each `sync()`) must re-embed ONLY symbols whose embedding input genuinely
 * changed, delete vectors for symbols that were removed, and touch nothing else —
 * at an endpoint cost proportional to the change, not the repo size.
 *
 * These tests drive the WHOLE stack at the library level — a real temp project +
 * `CodeGraph.init`/`open` + `indexAll()` against a local `node:http` mock endpoint
 * (the T019/T021 integration shape). A second `indexAll()` is a vector-preserving
 * in-place re-index: `storeExtractionResult` re-extracts only content-changed files
 * (delete-then-reinsert their nodes), and `node_vectors` has NO foreign key, so a
 * symbol's vector survives its node's delete-reinsert whenever the node id is stable.
 * Node ids are `sha256(filePath:kind:name:line)`, so every edit here is CHARACTER-
 * LEVEL (no line-count change) to keep a symbol's id stable while changing its source
 * — which is exactly the case the input-hash staleness scan must catch (the vector
 * survives, so missing-vector selection alone would never re-embed it).
 *
 * The harness is deliberately shaped for reuse by T026/T027 (wiring the same pass
 * into `sync()`): swap the `index()` driver's `indexAll()` for `sync()` and every
 * assertion still applies.
 *
 * Real SQLite, real temp files, real HTTP — no DB mocking (repo convention). Skipped
 * where `node:sqlite` is unavailable (Node < 22.5). FR-016/FR-016a/FR-017/FR-027/SC-003.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseConnection, getDatabasePath } from '../src/db';
import { CodeGraph } from '../src';
import { __emitWatchEventForTests } from '../src/sync/watcher';
import { setLogger, getLogger } from '../src/errors';

let HAS_SQLITE = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:sqlite');
  HAS_SQLITE = true;
} catch {
  HAS_SQLITE = false;
}

// =============================================================================
// T024 — incremental freshness on re-index (the pass runs inside indexAll today;
// T026 will additionally run it inside sync()). Every scenario embeds once, mutates
// the source, re-indexes, and asserts that endpoint work + vector writes are scoped
// to exactly what changed.
// =============================================================================
describe.skipIf(!HAS_SQLITE)('incremental embedding freshness — runEmbeddingPass via re-index (T024)', () => {
  const MOCK_DIMS = 4;
  const EMBED_ENV_KEYS = [
    'CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL', 'CODEGRAPH_EMBEDDING_API_KEY',
    'CODEGRAPH_EMBEDDING_DIMS', 'CODEGRAPH_EMBEDDING_BATCH_SIZE', 'CODEGRAPH_EMBEDDING_CONCURRENCY',
    'CODEGRAPH_EMBEDDING_TIMEOUT_MS',
  ];

  // The six embeddable declarations the base project defines (four functions + two
  // consts). Pinned so a change in extraction that adds/drops an embeddable node is
  // caught rather than silently skewing the incremental-count assertions.
  const EXPECTED_NAMES = ['add', 'mul', 'greet', 'shout', 'PI', 'E'];

  interface EmbedMock {
    origin: string;
    requests: Array<{ body: string }>;
    requestCount: () => number;
    close: () => Promise<void>;
  }

  const dirs: string[] = [];
  const graphs: CodeGraph[] = [];
  const inspectConns: DatabaseConnection[] = [];
  const mocks: EmbedMock[] = [];
  let savedEnv: Record<string, string | undefined> = {};
  let savedLogger: ReturnType<typeof getLogger>;

  /** 200 with exactly one MOCK_DIMS-length vector per input (count MUST match, FR-021a). */
  function embedOk(inputs: string[]): { status: number; body: string } {
    const data = inputs.map((_t, index) => ({
      index,
      embedding: Array.from({ length: MOCK_DIMS }, (_v, k) => k + index * 0.5),
    }));
    return { status: 200, body: JSON.stringify({ data, model: 'test-model' }) };
  }

  /** A local OpenAI-compatible endpoint that RECORDS every request body (for input inspection). */
  async function startEmbedMock(): Promise<EmbedMock> {
    const requests: Array<{ body: string }> = [];
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        requests.push({ body });
        let inputs: string[] = [];
        try {
          inputs = (JSON.parse(body) as { input?: string[] }).input ?? [];
        } catch {
          /* leave inputs empty — embedOk maps whatever it is handed */
        }
        const r = embedOk(inputs);
        res.writeHead(r.status, { 'content-type': 'application/json' });
        res.end(r.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const mock: EmbedMock = {
      origin: `http://127.0.0.1:${port}`,
      requests,
      requestCount: () => requests.length,
      close: () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    };
    mocks.push(mock);
    return mock;
  }

  /** Point the embedding config at the mock under a given active model. */
  function configureEndpoint(mock: EmbedMock, model = 'test-model'): void {
    process.env.CODEGRAPH_EMBEDDING_URL = `${mock.origin}/v1/embeddings`;
    process.env.CODEGRAPH_EMBEDDING_MODEL = model;
  }

  /** The `name:` field composed into a symbol's embedding input (its 2nd line). */
  function nameOfInput(composed: string): string {
    const m = /^name: (.+)$/m.exec(composed);
    return m ? m[1]! : '<unknown>';
  }

  /** Symbol names embedded across every request recorded AT/AFTER `since` (a request index). */
  function embeddedNamesSince(mock: EmbedMock, since: number): string[] {
    const names: string[] = [];
    for (const req of mock.requests.slice(since)) {
      let inputs: string[] = [];
      try {
        inputs = (JSON.parse(req.body) as { input?: string[] }).input ?? [];
      } catch {
        /* a malformed body carries no symbols */
      }
      for (const composed of inputs) names.push(nameOfInput(composed));
    }
    return names;
  }

  /** The base project: two multi-symbol files + one control file, all with unique names. */
  function baseFiles(): Record<string, string> {
    return {
      // add (lines 1-3), mul (lines 4-6). Editing mul's body char-for-char keeps mul's
      // start line — hence its id — stable while its source (and thus hash) changes.
      'calc.ts':
        'export function add(a: number, b: number): number {\n  return a + b;\n}\n' +
        'export function mul(a: number, b: number): number {\n  return a * b;\n}\n',
      // greet (lines 1-3), shout (lines 4-6, the trailing symbol → deletable without
      // shifting greet's lines).
      'text.ts':
        'export function greet(name: string): string {\n  return "hi " + name;\n}\n' +
        'export function shout(msg: string): string {\n  return msg.toUpperCase();\n}\n',
      // Control file — never edited. Its vectors must survive every scenario untouched.
      'consts.ts':
        'export const PI = 3.14159;\n' +
        'export const E = 2.71828;\n',
    };
  }

  function makeProject(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-embed-sync-'));
    dirs.push(dir);
    const srcDir = path.join(dir, 'src');
    fs.mkdirSync(srcDir);
    for (const [rel, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(srcDir, rel), content);
    }
    return dir;
  }

  function writeSource(dir: string, rel: string, content: string): void {
    fs.writeFileSync(path.join(dir, 'src', rel), content);
  }

  /** init-or-open + a full indexAll (which runs the advisory embed pass) + close. */
  async function reindex(dir: string, mode: 'init' | 'open'): Promise<void> {
    const cg = mode === 'init' ? await CodeGraph.init(dir) : await CodeGraph.open(dir);
    graphs.push(cg);
    await cg.indexAll();
    cg.close();
  }

  interface VecByName {
    nodeId: string;
    model: string;
    dims: number;
    inputHash: string;
    vector: Buffer;
  }
  /** Live-node vectors keyed by symbol name (JOIN drops orphan rows), via a fresh connection. */
  function readVectorsByName(dir: string): Map<string, VecByName> {
    const conn = DatabaseConnection.open(getDatabasePath(dir));
    inspectConns.push(conn);
    const rows = conn.getDb().prepare(
      `SELECT n.name AS name, v.node_id AS node_id, v.model AS model, v.dims AS dims,
              v.input_hash AS input_hash, v.vector AS vector
       FROM node_vectors v JOIN nodes n ON n.id = v.node_id`,
    ).all() as Array<{ name: string; node_id: string; model: string; dims: number; input_hash: string; vector: Uint8Array }>;
    const map = new Map<string, VecByName>();
    for (const r of rows) {
      map.set(r.name, {
        nodeId: r.node_id, model: r.model, dims: r.dims,
        inputHash: r.input_hash, vector: Buffer.from(r.vector),
      });
    }
    return map;
  }

  /** EVERY node_vectors row (incl. any orphan), via a fresh connection — for count/reconcile checks. */
  function readAllVectorRows(dir: string): Array<{ node_id: string; model: string; input_hash: string }> {
    const conn = DatabaseConnection.open(getDatabasePath(dir));
    inspectConns.push(conn);
    return conn.getDb()
      .prepare('SELECT node_id, model, input_hash FROM node_vectors')
      .all() as Array<{ node_id: string; model: string; input_hash: string }>;
  }

  beforeEach(() => {
    savedEnv = {};
    for (const k of EMBED_ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    savedLogger = getLogger();
    setLogger({ debug() {}, warn() {}, error() {} });
  });

  afterEach(async () => {
    setLogger(savedLogger);
    for (const k of EMBED_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    while (graphs.length) {
      try { graphs.pop()!.close(); } catch { /* may already be closed inline */ }
    }
    while (inspectConns.length) {
      try { inspectConns.pop()!.close(); } catch { /* already closed */ }
    }
    await Promise.all(mocks.splice(0).map((m) => m.close()));
    while (dirs.length) {
      const d = dirs.pop()!;
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('editing one symbol body re-embeds ONLY that symbol; every other vector row is byte-untouched (FR-016)', async () => {
    const mock = await startEmbedMock();
    configureEndpoint(mock);
    const dir = makeProject(baseFiles());

    await reindex(dir, 'init'); // pass 1 — full embed
    const snap1 = readVectorsByName(dir);
    const afterPass1 = mock.requestCount();

    // The project extracts exactly the six expected embeddable symbols.
    expect(new Set(snap1.keys())).toEqual(new Set(EXPECTED_NAMES));

    // Edit ONLY mul's body (char-for-char: `*` → `-`), so mul's start line — and id —
    // is unchanged while its source changes. Its vector survives the re-extraction;
    // only an input-hash comparison can notice it is now stale.
    writeSource(dir, 'calc.ts', baseFiles()['calc.ts']!.replace('return a * b', 'return a - b'));
    await reindex(dir, 'open'); // pass 2 — incremental

    // Exactly one symbol reached the endpoint on pass 2.
    expect(embeddedNamesSince(mock, afterPass1)).toEqual(['mul']);

    const snap2 = readVectorsByName(dir);
    // Same symbol set (no id churn from the char-level edit).
    expect(new Set(snap2.keys())).toEqual(new Set(snap1.keys()));
    // mul's stored input hash advanced (it was genuinely re-embedded).
    expect(snap2.get('mul')!.inputHash).not.toBe(snap1.get('mul')!.inputHash);
    // Every OTHER row is byte-identical — same hash AND same vector bytes.
    for (const name of snap1.keys()) {
      if (name === 'mul') continue;
      expect(snap2.get(name)!.inputHash).toBe(snap1.get(name)!.inputHash);
      expect(Buffer.compare(snap2.get(name)!.vector, snap1.get(name)!.vector)).toBe(0);
    }
  });

  it('an edit that leaves every symbol input unchanged (a trailing comment) re-embeds nothing (FR-016)', async () => {
    const mock = await startEmbedMock();
    configureEndpoint(mock);
    const dir = makeProject(baseFiles());

    await reindex(dir, 'init');
    const snap1 = readVectorsByName(dir);
    const afterPass1 = mock.requestCount();

    // Append a comment BELOW every declaration in the control file: the file's content
    // hash changes (so it IS re-extracted), but no symbol's line range or source text
    // changes, so no embedding input changes.
    writeSource(dir, 'consts.ts', baseFiles()['consts.ts']! + '// trailing note — not part of any symbol\n');
    await reindex(dir, 'open');

    // Zero symbols reached the endpoint — the compose-and-compare scan found no change.
    expect(embeddedNamesSince(mock, afterPass1)).toEqual([]);

    const snap2 = readVectorsByName(dir);
    for (const name of snap1.keys()) {
      expect(snap2.get(name)!.inputHash).toBe(snap1.get(name)!.inputHash);
      expect(Buffer.compare(snap2.get(name)!.vector, snap1.get(name)!.vector)).toBe(0);
    }
  });

  it('deleting a symbol removes its vector via the live-set anti-join; untouched files keep every vector (FR-017)', async () => {
    const mock = await startEmbedMock();
    configureEndpoint(mock);
    const dir = makeProject(baseFiles());

    await reindex(dir, 'init');
    const snap1 = readVectorsByName(dir);
    const rowsBefore = readAllVectorRows(dir).length;
    const afterPass1 = mock.requestCount();
    expect(snap1.has('shout')).toBe(true);

    // Remove the trailing `shout` from text.ts — greet stays at lines 1-3, so greet's id
    // (and vector) is untouched; shout's node vanishes, orphaning its vector row.
    writeSource(dir, 'text.ts', 'export function greet(name: string): string {\n  return "hi " + name;\n}\n');
    await reindex(dir, 'open');

    const snap2 = readVectorsByName(dir);
    const rowsAfter = readAllVectorRows(dir);

    // shout is gone from the live set...
    expect(new Set(snap2.keys())).toEqual(new Set([...snap1.keys()].filter((n) => n !== 'shout')));
    // ...and its vector was actually DELETED, not left as an orphan row.
    expect(rowsAfter.length).toBe(rowsBefore - 1);
    expect(rowsAfter.some((r) => r.node_id === snap1.get('shout')!.nodeId)).toBe(false);
    // No symbol needed embedding — reconciliation happens with zero endpoint calls.
    expect(embeddedNamesSince(mock, afterPass1)).toEqual([]);
    // Every surviving symbol (incl. untouched files) keeps byte-identical vectors —
    // the anti-join over the WHOLE live node set never falsely deletes them (FR-017).
    for (const name of snap2.keys()) {
      expect(snap2.get(name)!.inputHash).toBe(snap1.get(name)!.inputHash);
      expect(Buffer.compare(snap2.get(name)!.vector, snap1.get(name)!.vector)).toBe(0);
    }
  });

  it('a symbol vector SURVIVES its file node delete-reinsert when a sibling changes — no cascade (FR-016a)', async () => {
    const mock = await startEmbedMock();
    configureEndpoint(mock);
    const dir = makeProject(baseFiles());

    await reindex(dir, 'init');
    const snap1 = readVectorsByName(dir);
    const afterPass1 = mock.requestCount();

    // Edit ONLY mul; add shares the file and is delete-reinserted with it, but add's
    // identity + input are unchanged.
    writeSource(dir, 'calc.ts', baseFiles()['calc.ts']!.replace('return a * b', 'return a - b'));
    await reindex(dir, 'open');

    const snap2 = readVectorsByName(dir);
    // The edited sibling re-embedded...
    expect(snap2.get('mul')!.inputHash).not.toBe(snap1.get('mul')!.inputHash);
    expect(embeddedNamesSince(mock, afterPass1)).toEqual(['mul']);
    // ...but the unchanged sibling kept its EXACT vector + hash despite the file's
    // node delete-reinsert cycle — node_vectors has no FK, so nothing cascaded.
    expect(snap2.get('add')!.inputHash).toBe(snap1.get('add')!.inputHash);
    expect(Buffer.compare(snap2.get('add')!.vector, snap1.get('add')!.vector)).toBe(0);
  });

  it('re-embed count equals exactly the changed inputs, never the repo total; a no-op re-index issues zero requests (FR-027/SC-003)', async () => {
    const mock = await startEmbedMock();
    configureEndpoint(mock);
    const dir = makeProject(baseFiles());

    await reindex(dir, 'init');
    const totalSymbols = readVectorsByName(dir).size;
    const afterPass1 = mock.requestCount();
    expect(totalSymbols).toBe(EXPECTED_NAMES.length);

    // Change exactly two symbols, in two different files.
    writeSource(dir, 'calc.ts', baseFiles()['calc.ts']!.replace('return a * b', 'return a - b'));   // mul
    writeSource(dir, 'text.ts', baseFiles()['text.ts']!.replace('return "hi " + name', 'return "hey " + name')); // greet
    await reindex(dir, 'open');

    // Exactly the two changed symbols reached the endpoint — not the whole repo.
    const changed = embeddedNamesSince(mock, afterPass1);
    expect(new Set(changed)).toEqual(new Set(['mul', 'greet']));
    expect(changed).toHaveLength(2);
    const afterPass2 = mock.requestCount();

    // A no-op re-index (no source change) issues ZERO further endpoint requests: the
    // staleness scan + anti-join settle entirely on the codegraph side (SC-003).
    await reindex(dir, 'open');
    expect(mock.requestCount()).toBe(afterPass2);
    expect(embeddedNamesSince(mock, afterPass2)).toEqual([]);
  });

  it('switching the active model re-embeds every symbol and replaces the prior-model vectors (FR-010)', async () => {
    const mock = await startEmbedMock();
    configureEndpoint(mock, 'model-a');
    const dir = makeProject(baseFiles());

    await reindex(dir, 'init');
    const rows1 = readAllVectorRows(dir);
    const afterPass1 = mock.requestCount();
    expect(rows1.length).toBe(EXPECTED_NAMES.length);
    expect(rows1.every((r) => r.model === 'model-a')).toBe(true);

    // A plain re-index under a NEW active model backfills the whole repo under it
    // (every prior-model row is stale) — no special command, no duplicate rows.
    configureEndpoint(mock, 'model-b');
    await reindex(dir, 'open');

    const rows2 = readAllVectorRows(dir);
    expect(rows2.length).toBe(EXPECTED_NAMES.length);           // still one row per symbol
    expect(rows2.every((r) => r.model === 'model-b')).toBe(true); // all replaced under model-b
    expect(new Set(embeddedNamesSince(mock, afterPass1))).toEqual(new Set(EXPECTED_NAMES));
  });

  // ===========================================================================
  // T026 — the SAME embed pass, wired into sync(). These reuse the whole harness
  // above (mock, base project, vector inspection) but drive the pass through
  // cg.sync() instead of indexAll(): the incremental scenarios on the sync path
  // (FR-013/016/017), the zero-change backfill heal (FR-018), and dormancy. sync()
  // runs the pass in its post-resolution advisory slot even when no file changed.
  // ===========================================================================
  describe('embedding pass via sync() (T026)', () => {
    /** open + a single incremental sync (which now runs the advisory embed pass) + close. */
    async function syncOnce(dir: string): Promise<void> {
      const cg = await CodeGraph.open(dir);
      graphs.push(cg);
      await cg.sync();
      cg.close();
    }

    it('editing a symbol then sync()-ing re-embeds ONLY that symbol; a deleted symbol is reconciled away (FR-013/016/017)', async () => {
      const mock = await startEmbedMock();
      configureEndpoint(mock);
      const dir = makeProject(baseFiles());

      await reindex(dir, 'init'); // pass 1 — full embed via indexAll
      const snap1 = readVectorsByName(dir);
      const afterPass1 = mock.requestCount();
      expect(new Set(snap1.keys())).toEqual(new Set(EXPECTED_NAMES));

      // In ONE change set: edit mul's body char-for-char (its start line — hence id —
      // is stable, so only an input-hash comparison can notice it is stale) AND delete
      // the trailing `shout` from text.ts (greet stays at lines 1-3, untouched). This
      // exercises staleness re-embed + live-set anti-join reconciliation on the SYNC
      // path, driven through cg.sync() rather than indexAll().
      writeSource(dir, 'calc.ts', baseFiles()['calc.ts']!.replace('return a * b', 'return a - b'));
      writeSource(dir, 'text.ts', 'export function greet(name: string): string {\n  return "hi " + name;\n}\n');
      await syncOnce(dir);

      // Exactly the one edited symbol reached the endpoint — not greet (unchanged), not
      // the deleted shout, not the repo total.
      expect(embeddedNamesSince(mock, afterPass1)).toEqual(['mul']);

      const snap2 = readVectorsByName(dir);
      // shout's vector was reconciled away by the anti-join over the live node set.
      expect(snap2.has('shout')).toBe(false);
      expect(new Set(snap2.keys())).toEqual(new Set(EXPECTED_NAMES.filter((n) => n !== 'shout')));
      // mul genuinely re-embedded (its stored hash advanced)...
      expect(snap2.get('mul')!.inputHash).not.toBe(snap1.get('mul')!.inputHash);
      // ...and every surviving OTHER symbol (incl. add, the delete-reinserted sibling in
      // mul's own file, and the untouched control file) keeps byte-identical hash + vector.
      for (const name of snap2.keys()) {
        if (name === 'mul') continue;
        expect(snap2.get(name)!.inputHash).toBe(snap1.get(name)!.inputHash);
        expect(Buffer.compare(snap2.get(name)!.vector, snap1.get(name)!.vector)).toBe(0);
      }
    });

    it('a plain sync() with ZERO file changes backfills every missing vector to 100% coverage (FR-018 heal)', async () => {
      const mock = await startEmbedMock();
      const dir = makeProject(baseFiles());

      // Index with the feature OFF (env unset by beforeEach) — nodes exist, zero vectors.
      await reindex(dir, 'init');
      expect(readAllVectorRows(dir).length).toBe(0);

      // NOW enable embedding and run a plain sync with NO file edits. sync detects zero
      // changed files, yet the advisory embed slot must still run and backfill the whole
      // repo — the heal path a bare `codegraph sync` relies on.
      configureEndpoint(mock);
      await syncOnce(dir);

      const snap = readVectorsByName(dir);
      expect(new Set(snap.keys())).toEqual(new Set(EXPECTED_NAMES)); // 100% coverage
      expect(mock.requestCount()).toBeGreaterThan(0);                // the heal hit the endpoint
    });

    it('a sync() with no embedding env configured stays fully dormant — zero requests, zero vector writes', async () => {
      const mock = await startEmbedMock(); // started, but the endpoint is never configured
      const dir = makeProject(baseFiles());

      await reindex(dir, 'init'); // feature off — dormant
      // Edit a file so sync does real incremental work: this proves dormancy is about
      // config, not about "there was nothing to do".
      writeSource(dir, 'calc.ts', baseFiles()['calc.ts']!.replace('return a * b', 'return a - b'));
      await syncOnce(dir);

      // No env → the advisory embed block never touches the network or the vector table.
      expect(mock.requestCount()).toBe(0);
      expect(readAllVectorRows(dir).length).toBe(0);
    });
  });

  // ===========================================================================
  // T027 — a WATCHER-triggered sync runs the pass identically to a CLI sync. The
  // watcher (and the daemon's liveness sync) both call CodeGraph.sync(), so T026's
  // wiring covers them with no extra code — nothing in src/mcp/ or the watcher had
  // to change (FR-015). Driven through the deterministic synthetic-event seam the
  // existing watcher tests use (`__emitWatchEventForTests` + inertForTests), so it
  // does not depend on real OS event timing. Also pins that the API key is redacted
  // on this path — never in a request body, never in a log line.
  // ===========================================================================
  describe('embedding pass via watcher-triggered sync (T027)', () => {
    /** Poll until `condition` holds (or time out). Mirrors the watcher tests' helper. */
    function waitFor(condition: () => boolean, timeoutMs = 8000, intervalMs = 25): Promise<void> {
      const start = Date.now();
      return new Promise((resolve, reject) => {
        const tick = (): void => {
          let ok = false;
          try { ok = condition(); } catch { ok = false; }
          if (ok) return resolve();
          if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
          setTimeout(tick, intervalMs);
        };
        tick();
      });
    }

    it('a watcher-triggered sync re-embeds the changed symbol; the API key never leaks into a request body or a log line (FR-015)', async () => {
      const SECRET_KEY = 'sk-watcher-secret-DO-NOT-LEAK-1234567890';
      const mock = await startEmbedMock();
      configureEndpoint(mock);
      process.env.CODEGRAPH_EMBEDDING_API_KEY = SECRET_KEY;

      const dir = makeProject(baseFiles());
      await reindex(dir, 'init'); // full embed via indexAll
      const snap1 = readVectorsByName(dir);
      const afterInit = mock.requestCount();
      expect(new Set(snap1.keys())).toEqual(new Set(EXPECTED_NAMES));

      // Record every log line for the redaction assertion (this overrides the silent
      // logger the suite installs in beforeEach; afterEach restores the original either
      // way). Stringify object args too, so an endpoint/key smuggled inside a metadata
      // object would still be caught.
      const logs: string[] = [];
      const dump = (args: unknown[]): string =>
        args.map((a) => { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); } }).join(' ');
      setLogger({
        debug: (...a: unknown[]) => { logs.push(dump(a)); },
        warn: (...a: unknown[]) => { logs.push(dump(a)); },
        error: (...a: unknown[]) => { logs.push(dump(a)); },
      });

      // Re-open and start a watcher, then drive one change through the synthetic-event
      // seam. inertForTests installs no OS watcher — the seam feeds the exact same
      // debounce → sync() pipeline, so this exercises the real watcher-to-sync path.
      const cg = await CodeGraph.open(dir);
      graphs.push(cg);
      cg.watch({ debounceMs: 100, inertForTests: true });
      await cg.waitUntilWatcherReady();

      // Char-level edit to mul (start line — hence id — stable), written to disk so the
      // watcher's sync sees the new content, then inject the change event.
      writeSource(dir, 'calc.ts', baseFiles()['calc.ts']!.replace('return a * b', 'return a - b'));
      __emitWatchEventForTests(dir, 'src/calc.ts');

      // The debounced flush awaits sync() (which now runs the embed pass) and only then
      // drains pendingFiles — so an empty pending set AND a fresh endpoint request means
      // the watcher-triggered embed has finished.
      await waitFor(() => cg.getPendingFiles().length === 0 && mock.requestCount() > afterInit);

      cg.unwatch();
      cg.close();

      // The watcher path re-embedded exactly the changed symbol — identical to a CLI sync.
      expect(embeddedNamesSince(mock, afterInit)).toEqual(['mul']);
      const snap2 = readVectorsByName(dir);
      expect(snap2.get('mul')!.inputHash).not.toBe(snap1.get('mul')!.inputHash);
      for (const name of snap2.keys()) {
        if (name === 'mul') continue;
        expect(Buffer.compare(snap2.get(name)!.vector, snap1.get(name)!.vector)).toBe(0);
      }

      // Redaction on the watcher path: the API key travels only in the Authorization
      // header, so it must appear in NO recorded request body and NO log line.
      const allBodies = mock.requests.map((r) => r.body).join('\n');
      expect(allBodies).not.toContain(SECRET_KEY);
      expect(logs.join('\n')).not.toContain(SECRET_KEY);
    });
  });
});
