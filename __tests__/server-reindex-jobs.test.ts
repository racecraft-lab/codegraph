import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  startServerFixture,
  type ServerFixture,
} from './helpers/server-fixture';
import { getCodeGraphDir } from '../src/directory';
import { CodeGraph } from '../src';
import { __emitWatchEventForTests } from '../src/sync/watcher';
import { MCPEngine } from '../src/mcp/engine';
import { MCPSession } from '../src/mcp/session';
import { SseWriter } from '../src/server/sse';
import { ReindexJob, JobRegistry, defaultIsLockHeld } from '../src/server/jobs';
import type { JobDeps, JobDescriptor } from '../src/server/jobs';
import { buildJobRoutes, type RouteContext } from '../src/server/routes';
import type { IndexProgress, IndexResult, SyncResult } from '../src/extraction';
import type { JsonRpcTransport, MessageHandler } from '../src/mcp/transport';

/**
 * SPEC-005 Slice-2 — re-index jobs + SSE (T033, RED phase).
 *
 * FR-020 (POST URL-only), FR-021 (jobs run in the serve process; contain every
 * non-lock/non-abort failure), FR-021a (lock contention → terminal
 * `lock_unavailable`, POST still 202; watcher re-arm), FR-022 (409 duplicate
 * active job), FR-023 (SSE snapshot→progress→terminal; headers; backpressure;
 * multi-subscriber; disconnect never cancels; shutdown-abort → `aborted`),
 * FR-024 (latest-job-per-repo; registered-no-job → 404 repo; per-mode result),
 * FR-026 (ordered shutdown aborts the in-flight job).
 *
 * Real files + real SQLite (repo convention). Job LIFECYCLE tests inject a
 * controllable `runIndex` seam (deterministic — no multi-second real index and
 * no flakiness); the REAL library index path is exercised separately by the
 * driver + lock-contention tests over a real fixture.
 */

/** Loosen every wait on CI (cold caches, shared vCPUs). */
const IS_CI = !['', '0', 'false'].includes((process.env.CI ?? '').trim().toLowerCase());
const CT = (ms: number): number => ms * (IS_CI ? 4 : 1);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Small deferred + controllable index-runner seam.
// ---------------------------------------------------------------------------
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

interface Controllable {
  deps: Partial<JobDeps>;
  started: Promise<void>;
  release: Deferred<SyncResult | IndexResult>;
  emit(p: IndexProgress): void;
  aborted(): boolean;
  rearmCalls: string[];
}
/** A `runIndex` that stays running until the test releases it; captures onProgress + signal. */
function controllable(): Controllable {
  const started = deferred<void>();
  const release = deferred<SyncResult | IndexResult>();
  let onProgressRef: ((p: IndexProgress) => void) | null = null;
  let signalRef: AbortSignal | null = null;
  const rearmCalls: string[] = [];
  const deps: Partial<JobDeps> = {
    runIndex: async (_root, _mode, onProgress, signal) => {
      onProgressRef = onProgress;
      signalRef = signal;
      started.resolve();
      // Settle either when the test releases, or when the signal aborts.
      return await Promise.race([
        release.promise,
        new Promise<SyncResult | IndexResult>((_res, rej) => {
          signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
        }),
      ]);
    },
    isLockHeld: () => false,
    rearmWatcher: (root) => { rearmCalls.push(root); },
  };
  return {
    deps,
    started: started.promise,
    release,
    emit: (p) => onProgressRef?.(p),
    aborted: () => signalRef?.aborted ?? false,
    rearmCalls,
  };
}

// ---------------------------------------------------------------------------
// Foreign index lock (a live pid that is NOT us) — real lock-contention driver.
// FileLock is pid-re-entrant, so an in-process job would treat our own pid as
// non-contention; a spawned child's live pid is genuine foreign contention.
// ---------------------------------------------------------------------------
function holdForeignLock(root: string): { child: ChildProcess; release: () => void } {
  const lockPath = path.join(getCodeGraphDir(root), 'codegraph.lock');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' });
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, String(child.pid), { mode: 0o600 });
  return {
    child,
    release: () => {
      try { child.kill('SIGKILL'); } catch { /* raced */ }
      try { fs.unlinkSync(lockPath); } catch { /* gone */ }
    },
  };
}

// ---------------------------------------------------------------------------
// Minimal SSE client over node:http (fetch's body reader is awkward to close
// mid-stream deterministically).
// ---------------------------------------------------------------------------
interface SseFrame { event: string; data: unknown; }
interface SseClient {
  frames: SseFrame[];
  comments: string[];
  gotEnd: boolean;
  statusCode?: number;
  headers: http.IncomingHttpHeaders;
  ready: Promise<void>;
  waitFor(pred: () => boolean, timeoutMs: number, label: string): Promise<void>;
  close(): void;
}
function openSse(url: string): SseClient {
  const client: SseClient = {
    frames: [], comments: [], gotEnd: false, headers: {},
    ready: Promise.resolve(),
    waitFor: async () => undefined,
    close: () => undefined,
  };
  let buffer = '';
  const readyD = deferred<void>();
  client.ready = readyD.promise;

  const parse = (): void => {
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (block.startsWith(':')) { client.comments.push(block); continue; }
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      const raw = dataLines.join('\n');
      let data: unknown = raw;
      try { data = JSON.parse(raw); } catch { /* keep raw */ }
      client.frames.push({ event, data });
    }
  };

  const req = http.get(url, (res) => {
    client.statusCode = res.statusCode;
    client.headers = res.headers;
    readyD.resolve();
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => { buffer += chunk; parse(); });
    res.on('end', () => { client.gotEnd = true; });
    res.on('close', () => { client.gotEnd = true; });
  });
  req.on('error', () => { readyD.resolve(); });

  client.waitFor = async (pred, timeoutMs, label): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!pred()) {
      if (Date.now() > deadline) throw new Error(`SSE waitFor timed out: ${label}`);
      await sleep(20);
    }
  };
  client.close = (): void => { try { req.destroy(); } catch { /* ignore */ } };
  return client;
}

async function poll<T>(fn: () => Promise<T | null>, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v !== null) return v;
    if (Date.now() > deadline) throw new Error(`poll timed out: ${label}`);
    await sleep(50);
  }
}

/** Poll GET /api/reindex/:repo until the job reaches a terminal state. */
async function waitTerminal(base: string, repoId: string, timeoutMs: number): Promise<JobDescriptor> {
  return poll(async () => {
    const res = await fetch(`${base}/api/reindex/${repoId}`);
    if (res.status !== 200) return null;
    const body = (await res.json()) as JobDescriptor;
    return body.status === 'done' || body.status === 'error' ? body : null;
  }, timeoutMs, 'job terminal');
}

// ---------------------------------------------------------------------------
const fixtures: ServerFixture[] = [];
async function server(opts: { jobDeps?: Partial<JobDeps>; files?: Record<string, string> } = {}): Promise<ServerFixture> {
  const fx = await startServerFixture(opts);
  fixtures.push(fx);
  return fx;
}
afterEach(async () => {
  while (fixtures.length) {
    const fx = fixtures.pop()!;
    try { await fx.teardown(); } catch { /* already gone */ }
  }
});

// ===========================================================================
// FR-020 / FR-022 — POST /api/reindex/:repo
// ===========================================================================
describe('POST /api/reindex/:repo (FR-020/022)', () => {
  it('returns 202 with a running job descriptor; default mode is sync', async () => {
    const ctl = controllable();
    const fx = await server({ jobDeps: ctl.deps });
    const res = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    expect(res.status).toBe(202);
    const body = (await res.json()) as JobDescriptor;
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
    expect(body.repo).toBe(fx.repoId);
    expect(body.mode).toBe('sync');
    expect(body.status).toBe('running');
    expect(typeof body.startedAt).toBe('string');
    expect(Number.isNaN(Date.parse(body.startedAt))).toBe(false);
    ctl.release.resolve(syncResult());
  }, CT(20000));

  it('?full=true starts a full-rebuild job (mode:"full")', async () => {
    const ctl = controllable();
    const fx = await server({ jobDeps: ctl.deps });
    const res = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}?full=true`, { method: 'POST' });
    expect(res.status).toBe(202);
    const body = (await res.json()) as JobDescriptor;
    expect(body.mode).toBe('full');
    ctl.release.resolve(indexResult());
  }, CT(20000));

  it('an unregistered repo id → 404 not_found resource:repo', async () => {
    const fx = await server({ jobDeps: controllable().deps });
    const res = await fetch(`${fx.baseURL}/api/reindex/ffffffffffffffff`, { method: 'POST' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; details?: { resource?: string } } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.details?.resource).toBe('repo');
  }, CT(20000));

  it('a second POST while a job is running → 409 conflict; no duplicate job', async () => {
    const ctl = controllable();
    const fx = await server({ jobDeps: ctl.deps });
    const first = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    expect(first.status).toBe(202);
    const firstId = ((await first.json()) as JobDescriptor).id;
    await ctl.started;
    const second = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe('conflict');
    // The still-running job is unchanged (same id).
    const state = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`);
    expect(((await state.json()) as JobDescriptor).id).toBe(firstId);
    ctl.release.resolve(syncResult());
  }, CT(20000));

  it('a fresh POST is allowed once the previous job is terminal (latest-per-repo)', async () => {
    const ctl1 = controllable();
    const fx = await server({ jobDeps: ctl1.deps });
    await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    await ctl1.started;
    ctl1.release.resolve(syncResult());
    await waitTerminal(fx.baseURL, fx.repoId, CT(15000));
    // A second POST after the first settled must be accepted (not 409).
    const again = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    expect(again.status).toBe(202);
  }, CT(25000));
});

// ===========================================================================
// FR-024 — GET /api/reindex/:repo (latest state; per-mode result union)
// ===========================================================================
describe('GET /api/reindex/:repo (FR-024)', () => {
  it('a registered repo with NO job on record → 404 not_found resource:repo', async () => {
    const fx = await server({ jobDeps: controllable().deps });
    const res = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; details?: { resource?: string } } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.details?.resource).toBe('repo');
  }, CT(20000));

  it('a done sync job exposes the SyncResult union (no changedFilePaths)', async () => {
    const ctl = controllable();
    const fx = await server({ jobDeps: ctl.deps });
    await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    await ctl.started;
    ctl.release.resolve({ ...syncResult(), changedFilePaths: ['leaked.ts'] } as SyncResult);
    const term = await waitTerminal(fx.baseURL, fx.repoId, CT(15000));
    expect(term.status).toBe('done');
    const r = term.result as unknown as Record<string, unknown>;
    expect(r).toBeTruthy();
    for (const k of ['filesChecked', 'filesAdded', 'filesModified', 'filesRemoved', 'nodesUpdated', 'durationMs']) {
      expect(typeof r[k]).toBe('number');
    }
    // FR-015a whitelist: the raw path array is dropped.
    expect('changedFilePaths' in r).toBe(false);
  }, CT(20000));

  it('a done full job exposes the IndexResult union (no errors[])', async () => {
    const ctl = controllable();
    const fx = await server({ jobDeps: ctl.deps });
    await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}?full=true`, { method: 'POST' });
    await ctl.started;
    ctl.release.resolve({ ...indexResult(), errors: [{ message: 'boom', severity: 'error' }] } as unknown as IndexResult);
    const term = await waitTerminal(fx.baseURL, fx.repoId, CT(15000));
    expect(term.status).toBe('done');
    const r = term.result as unknown as Record<string, unknown>;
    expect(typeof r.success).toBe('boolean');
    for (const k of ['filesIndexed', 'filesSkipped', 'filesErrored', 'nodesCreated', 'edgesCreated', 'durationMs']) {
      expect(typeof r[k]).toBe('number');
    }
    // FR-015a whitelist: the errors[] array is dropped.
    expect('errors' in r).toBe(false);
  }, CT(20000));
});

// ===========================================================================
// FR-021 — jobs run in the serve process; every failure is contained
// ===========================================================================
describe('job driver (FR-021)', () => {
  it('a real incremental sync completes → terminal done + SyncResult', async () => {
    // No jobDeps override → the REAL default runIndex opens a CodeGraph and runs
    // sync() in the serve process. Re-arm is stubbed to skip the socket walk.
    const fx = await server({ jobDeps: { rearmWatcher: () => {} } });
    const res = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    expect(res.status).toBe(202);
    const term = await waitTerminal(fx.baseURL, fx.repoId, CT(40000));
    expect(term.status).toBe('done');
    expect(term.mode).toBe('sync');
    expect(typeof (term.result as SyncResult).filesChecked).toBe('number');
  }, CT(50000));

  it('a real full rebuild completes → terminal done + IndexResult', async () => {
    const fx = await server({ jobDeps: { rearmWatcher: () => {} } });
    const res = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}?full=true`, { method: 'POST' });
    expect(res.status).toBe(202);
    const term = await waitTerminal(fx.baseURL, fx.repoId, CT(40000));
    expect(term.status).toBe('done');
    expect(term.mode).toBe('full');
    const r = term.result as IndexResult;
    expect(typeof r.success).toBe('boolean');
    expect(typeof r.filesIndexed).toBe('number');
  }, CT(50000));

  it('a non-lock/non-abort failure is CONTAINED — terminal error, POST still 202, never stuck running', async () => {
    const fx = await server({
      jobDeps: {
        runIndex: async () => { throw new Error('extractor exploded: /abs/secret/path.ts'); },
        isLockHeld: () => false,
        rearmWatcher: () => {},
      },
    });
    const res = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    expect(res.status).toBe(202); // the already-returned 202 never becomes a 5xx
    const term = await waitTerminal(fx.baseURL, fx.repoId, CT(15000));
    expect(term.status).toBe('error');
    expect(typeof term.reason).toBe('string');
    expect(term.reason).not.toBe('lock_unavailable');
    expect(term.reason).not.toBe('aborted');
    // FR-015a: the reason is a whitelisted token, never the raw exception text/path.
    expect(term.reason).not.toContain('/abs/secret/path.ts');
    expect(term.reason).not.toContain('exploded');
  }, CT(20000));

  it('fires the watcher re-arm from the job terminal path (FR-021a duty)', async () => {
    const ctl = controllable();
    const fx = await server({ jobDeps: ctl.deps });
    await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    await ctl.started;
    ctl.release.resolve(syncResult());
    await waitTerminal(fx.baseURL, fx.repoId, CT(15000));
    // Re-arm is gated by isDegraded on the daemon side, but the JOB must ALWAYS
    // fire it on a terminal path (done/error/lock_unavailable/aborted).
    await poll(async () => (ctl.rearmCalls.length > 0 ? true : null), CT(5000), 'rearm fired');
    expect(ctl.rearmCalls).toContain(fx.root);
  }, CT(20000));
});

// ===========================================================================
// FR-021a — lock contention (real path)
// ===========================================================================
describe('lock contention (FR-021a)', () => {
  it('a foreign-held lock → terminal error lock_unavailable; POST still 202 (never 409/503)', async () => {
    // Real default runIndex + real lock probe; a spawned child holds the lock.
    const fx = await server({ jobDeps: { rearmWatcher: () => {} } });
    const lock = holdForeignLock(fx.root);
    try {
      const res = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
      expect(res.status).toBe(202); // FR-021a: POST is unaffected by contention
      const term = await waitTerminal(fx.baseURL, fx.repoId, CT(20000));
      expect(term.status).toBe('error');
      expect(term.reason).toBe('lock_unavailable');
    } finally {
      lock.release();
    }
  }, CT(30000));
});

// ===========================================================================
// FR-023 — SSE stream
// ===========================================================================
describe('SSE GET /api/reindex/:repo/events (FR-023)', () => {
  it('sets the streaming headers and emits snapshot → progress → single terminal done, then closes', async () => {
    const ctl = controllable();
    const fx = await server({ jobDeps: ctl.deps });
    await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    await ctl.started;

    const sse = openSse(`${fx.baseURL}/api/reindex/${fx.repoId}/events`);
    await sse.ready;
    expect(sse.statusCode).toBe(200);
    expect(String(sse.headers['content-type'])).toContain('text/event-stream');
    expect(String(sse.headers['cache-control'])).toContain('no-cache');
    expect(String(sse.headers['connection']).toLowerCase()).toContain('keep-alive');
    expect(String(sse.headers['x-accel-buffering'])).toBe('no');

    await sse.waitFor(() => sse.frames.some((f) => f.event === 'snapshot'), CT(10000), 'snapshot');
    const snap = sse.frames.find((f) => f.event === 'snapshot')!;
    expect((snap.data as JobDescriptor).status).toBe('running');

    // A progress frame mirrors IndexProgress verbatim.
    ctl.emit({ phase: 'parsing', current: 3, total: 10, currentFile: 'src/a.ts' });
    await sse.waitFor(() => sse.frames.some((f) => f.event === 'progress'), CT(10000), 'progress');
    const prog = sse.frames.find((f) => f.event === 'progress')!.data as IndexProgress;
    expect(prog).toEqual({ phase: 'parsing', current: 3, total: 10, currentFile: 'src/a.ts' });

    ctl.release.resolve(syncResult());
    await sse.waitFor(() => sse.frames.some((f) => f.event === 'done'), CT(10000), 'done');
    await sse.waitFor(() => sse.gotEnd, CT(10000), 'stream closed');
    // Exactly one terminal frame.
    expect(sse.frames.filter((f) => f.event === 'done' || f.event === 'error')).toHaveLength(1);
    sse.close();
  }, CT(30000));

  it('a mid-job reconnect re-snapshots the running job', async () => {
    const ctl = controllable();
    const fx = await server({ jobDeps: ctl.deps });
    await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    await ctl.started;

    const first = openSse(`${fx.baseURL}/api/reindex/${fx.repoId}/events`);
    await first.ready;
    await first.waitFor(() => first.frames.some((f) => f.event === 'snapshot'), CT(10000), 'snap1');
    first.close();

    // A brand-new subscriber gets its own fresh snapshot of the still-running job.
    const second = openSse(`${fx.baseURL}/api/reindex/${fx.repoId}/events`);
    await second.ready;
    await second.waitFor(() => second.frames.some((f) => f.event === 'snapshot'), CT(10000), 'snap2');
    expect((second.frames.find((f) => f.event === 'snapshot')!.data as JobDescriptor).status).toBe('running');
    ctl.release.resolve(syncResult());
    second.close();
  }, CT(30000));

  it('connecting to an ALREADY-finished job snapshots terminal state and closes immediately', async () => {
    const ctl = controllable();
    const fx = await server({ jobDeps: ctl.deps });
    await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    await ctl.started;
    ctl.release.resolve(syncResult());
    await waitTerminal(fx.baseURL, fx.repoId, CT(15000));

    const sse = openSse(`${fx.baseURL}/api/reindex/${fx.repoId}/events`);
    await sse.ready;
    await sse.waitFor(() => sse.frames.length > 0, CT(10000), 'snapshot');
    expect(sse.frames[0].event).toBe('snapshot');
    expect((sse.frames[0].data as JobDescriptor).status).toBe('done');
    await sse.waitFor(() => sse.gotEnd, CT(10000), 'closed');
    sse.close();
  }, CT(30000));

  it('multiple subscribers each get snapshot + terminal independently', async () => {
    const ctl = controllable();
    const fx = await server({ jobDeps: ctl.deps });
    await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    await ctl.started;

    const a = openSse(`${fx.baseURL}/api/reindex/${fx.repoId}/events`);
    const b = openSse(`${fx.baseURL}/api/reindex/${fx.repoId}/events`);
    await Promise.all([a.ready, b.ready]);
    await a.waitFor(() => a.frames.some((f) => f.event === 'snapshot'), CT(10000), 'a snap');
    await b.waitFor(() => b.frames.some((f) => f.event === 'snapshot'), CT(10000), 'b snap');

    ctl.release.resolve(syncResult());
    await a.waitFor(() => a.frames.some((f) => f.event === 'done'), CT(10000), 'a done');
    await b.waitFor(() => b.frames.some((f) => f.event === 'done'), CT(10000), 'b done');
    a.close();
    b.close();
  }, CT(30000));

  it('a client disconnect does NOT cancel the running job', async () => {
    const ctl = controllable();
    const fx = await server({ jobDeps: ctl.deps });
    await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    await ctl.started;

    const sse = openSse(`${fx.baseURL}/api/reindex/${fx.repoId}/events`);
    await sse.ready;
    await sse.waitFor(() => sse.frames.some((f) => f.event === 'snapshot'), CT(10000), 'snap');
    sse.close(); // client goes away mid-job
    await sleep(CT(300));
    expect(ctl.aborted()).toBe(false); // the job's signal was NOT aborted

    // The job still completes and its terminal state is readable.
    ctl.release.resolve(syncResult());
    const term = await waitTerminal(fx.baseURL, fx.repoId, CT(15000));
    expect(term.status).toBe('done');
  }, CT(30000));

  it('a heartbeat comment frame keeps a quiet stream alive', async () => {
    const ctl = controllable();
    // A tiny heartbeat interval so the test observes a comment frame quickly
    // (production default is ~15s; the writer honors this env override).
    const prev = process.env.CODEGRAPH_SSE_HEARTBEAT_MS;
    process.env.CODEGRAPH_SSE_HEARTBEAT_MS = '80';
    try {
      const fx = await server({ jobDeps: ctl.deps });
      await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
      await ctl.started;
      const sse = openSse(`${fx.baseURL}/api/reindex/${fx.repoId}/events`);
      await sse.ready;
      await sse.waitFor(() => sse.comments.length > 0, CT(10000), 'heartbeat');
      expect(sse.comments[0].startsWith(':')).toBe(true);
      ctl.release.resolve(syncResult());
      sse.close();
    } finally {
      if (prev === undefined) delete process.env.CODEGRAPH_SSE_HEARTBEAT_MS;
      else process.env.CODEGRAPH_SSE_HEARTBEAT_MS = prev;
    }
  }, CT(20000));
});

// ===========================================================================
// FR-023 — SSE writer backpressure (UNIT, no socket)
// ===========================================================================
describe('SseWriter backpressure (FR-023, unit)', () => {
  class FakeSink {
    writes: string[] = [];
    accept = true;
    ended = false;
    private drainCbs: Array<() => void> = [];
    write(chunk: string): boolean { this.writes.push(chunk); return this.accept; }
    end(cb?: () => void): void { this.ended = true; cb?.(); }
    on(event: string, listener: () => void): void { if (event === 'drain') this.drainCbs.push(listener); }
    fireDrain(): void { const cbs = this.drainCbs; this.drainCbs = []; for (const cb of cbs) cb(); }
  }
  const desc = (status: JobDescriptor['status']): JobDescriptor => ({
    id: 'j1', repo: 'r1', mode: 'sync', status, startedAt: new Date().toISOString(),
  });
  const progressFrames = (s: FakeSink): string[] => s.writes.filter((w) => w.includes('event: progress'));

  it('always delivers the snapshot even when the sink is backpressured', () => {
    const sink = new FakeSink();
    sink.accept = false;
    const w = new SseWriter(sink);
    w.writeSnapshot(desc('running'));
    expect(sink.writes.some((x) => x.includes('event: snapshot'))).toBe(true);
  });

  it('coalesces progress to the latest pending frame under backpressure', () => {
    const sink = new FakeSink();
    const w = new SseWriter(sink);
    w.writeSnapshot(desc('running'));
    sink.accept = false; // socket refuses further writes
    w.writeProgress({ phase: 'parsing', current: 1, total: 100 });
    w.writeProgress({ phase: 'parsing', current: 2, total: 100 });
    w.writeProgress({ phase: 'parsing', current: 3, total: 100 });
    // Only the first write reached the sink; the rest coalesced to ONE pending.
    expect(progressFrames(sink).length).toBe(1);
    expect(progressFrames(sink)[0]).toContain('"current":1');

    sink.accept = true;
    sink.fireDrain(); // flush the single coalesced pending frame (the latest = 3)
    const frames = progressFrames(sink);
    expect(frames.length).toBe(2);
    expect(frames[1]).toContain('"current":3');
    // The superseded intermediate frame (current:2) was dropped.
    expect(sink.writes.some((x) => x.includes('"current":2'))).toBe(false);
  });

  it('always delivers the terminal frame and ends the stream even under backpressure', () => {
    const sink = new FakeSink();
    const w = new SseWriter(sink);
    w.writeSnapshot(desc('running'));
    sink.accept = false;
    w.writeProgress({ phase: 'storing', current: 5, total: 9 });
    w.writeTerminal(desc('done'));
    expect(sink.writes.some((x) => x.includes('event: done'))).toBe(true);
    expect(sink.ended).toBe(true);
  });
});

// ===========================================================================
// FR-026 — shutdown aborts the in-flight job
// ===========================================================================
describe('shutdown-abort (FR-023/026)', () => {
  it('aborting the server terminates the in-flight job as error/aborted and emits a terminal SSE frame', async () => {
    const ctl = controllable();
    const fx = await server({ jobDeps: ctl.deps });
    await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    await ctl.started;

    const sse = openSse(`${fx.baseURL}/api/reindex/${fx.repoId}/events`);
    await sse.ready;
    await sse.waitFor(() => sse.frames.some((f) => f.event === 'snapshot'), CT(10000), 'snap');

    // Ordered shutdown (step 2): abort the in-flight job via its AbortSignal.
    await fx.handle.close();

    expect(ctl.aborted()).toBe(true);
    // The subscriber receives the terminal frame (error/aborted) before the
    // socket is released — but delivery + parse is async, so wait for it.
    await sse.waitFor(() => sse.frames.some((f) => f.event === 'error'), CT(5000), 'terminal on shutdown');
    const terminal = sse.frames.find((f) => f.event === 'error')!;
    expect((terminal.data as JobDescriptor).status).toBe('error');
    expect((terminal.data as JobDescriptor).reason).toBe('aborted');
    sse.close();
    // Mark torn down so afterEach does not double-close.
    fixtures.splice(fixtures.indexOf(fx), 1);
    fx.teardown().catch(() => undefined);
  }, CT(30000));
});

// ===========================================================================
// FR-021a — watcher re-arm: MCPEngine gate + session wire dispatch + latch clear
// ===========================================================================
describe('watcher re-arm (FR-021a)', () => {
  it('MCPEngine.rearmWatcher() is a no-op ({rearmed:false}) when there is no open project', () => {
    const engine = new MCPEngine({ watch: false });
    expect(engine.rearmWatcher()).toEqual({ rearmed: false });
    engine.stop();
  });

  it('MCPEngine.rearmWatcher() is a no-op on a HEALTHY watcher (gate)', async () => {
    const fx = await server({ jobDeps: controllable().deps });
    const engine = new MCPEngine({ watch: true });
    try {
      await engine.ensureInitialized(fx.root);
      // Freshly opened → watcher healthy → the gate makes re-arm a cheap no-op.
      expect(engine.rearmWatcher()).toEqual({ rearmed: false });
    } finally {
      engine.stop();
    }
  }, CT(30000));

  it('unwatch()+watch() clears the one-way degrade latch (the mechanism rearmWatcher uses)', async () => {
    const fx = await server({ jobDeps: controllable().deps });
    const cg = await CodeGraph.open(fx.root);
    const lock = holdForeignLock(fx.root);
    try {
      expect(cg.watch({ debounceMs: 1, inertForTests: true })).toBe(true);
      // Drive events while the foreign lock is held → the watcher's sync keeps
      // hitting lock contention and, past MAX_LOCK_RETRIES, degrades permanently.
      const degraded = poll(async () => {
        __emitWatchEventForTests(fx.root, 'fixture.ts');
        return cg.isWatcherDegraded() ? true : null;
      }, CT(15000), 'watcher degraded');
      await degraded;
      expect(cg.isWatcherDegraded()).toBe(true);

      // The exact primitive rearmWatcher orchestrates: a fresh watcher clears the latch.
      cg.unwatch();
      expect(cg.watch({ debounceMs: 1, inertForTests: true })).toBe(true);
      expect(cg.isWatcherDegraded()).toBe(false);
    } finally {
      lock.release();
      cg.unwatch();
      cg.close();
    }
  }, CT(30000));

  it('the daemon session dispatches the additive codegraph/rearm-watcher method', async () => {
    class FakeTransport implements JsonRpcTransport {
      handler: MessageHandler | null = null;
      sent: Array<{ id?: string | number | null; result?: unknown; error?: { code: number } }> = [];
      start(h: MessageHandler): void { this.handler = h; }
      stop(): void { /* no-op */ }
      send(): void { /* no-op */ }
      notify(): void { /* no-op */ }
      request(): Promise<unknown> { return Promise.resolve(undefined); }
      sendResult(id: string | number, result: unknown): void { this.sent.push({ id, result }); }
      sendError(id: string | number | null, code: number): void { this.sent.push({ id, error: { code } }); }
    }
    const engine = new MCPEngine({ watch: false });
    const t = new FakeTransport();
    const session = new MCPSession(t, engine);
    session.start();
    try {
      await t.handler!({ jsonrpc: '2.0', id: 7, method: 'codegraph/rearm-watcher', params: {} } as never);
      const resp = t.sent.find((m) => m.id === 7);
      expect(resp, 'session replied to codegraph/rearm-watcher').toBeTruthy();
      // Additive method is dispatched (not MethodNotFound -32601); no project → {rearmed:false}.
      expect(resp!.error).toBeUndefined();
      expect(resp!.result).toEqual({ rearmed: false });
    } finally {
      engine.stop();
    }
  }, CT(20000));
});

// ===========================================================================
// Code-review remediation — F1 (diagnostics), F3 (SSE cascade), F6 (lock probe),
// t1/t2 (contention-sentinel disambiguation), t4 (emit isolation).
// ===========================================================================

/** The all-zero incremental-sync shape the library returns on contention (or a genuinely-empty sync). */
function zeroSync(): SyncResult {
  return { filesChecked: 0, filesAdded: 0, filesModified: 0, filesRemoved: 0, nodesUpdated: 0, durationMs: 0 };
}
/** A full-mode contention sentinel: success:false, durationMs:0, a lock-flavored error. */
function fullLockSentinel(): IndexResult {
  return {
    success: false, filesIndexed: 0, filesSkipped: 0, filesErrored: 0,
    nodesCreated: 0, edgesCreated: 0, errors: [{ message: 'index lock held', severity: 'error' }], durationMs: 0,
  } as unknown as IndexResult;
}

describe('F1 — a contained job failure logs the cause locally, wire reason stays whitelisted', () => {
  it('logDiagnostic receives the real exception while term.reason is the whitelisted token', async () => {
    const diag: string[] = [];
    const secret = '/abs/secret/only-in-local-logs.ts';
    const fx = await server({
      jobDeps: {
        runIndex: async () => { throw new Error(`extractor exploded: ${secret}`); },
        isLockHeld: () => false,
        rearmWatcher: () => {},
        logDiagnostic: (m) => diag.push(m),
      },
    });
    const res = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    expect(res.status).toBe(202); // the already-returned 202 never becomes a 5xx
    const term = await waitTerminal(fx.baseURL, fx.repoId, CT(15000));
    expect(term.status).toBe('error');
    expect(term.reason).toBe('index_failed'); // FR-015a whitelisted token on the wire
    expect(term.reason).not.toContain(secret);
    // …but the operator diagnostic captured the underlying cause (F1).
    const joined = diag.join('\n');
    expect(joined).toContain(secret);
    expect(joined.toLowerCase()).not.toContain('authorization');
    expect(joined.toLowerCase()).not.toContain('bearer');
  }, CT(20000));
});

describe('F3 — an SSE stream that throws AFTER writeHead is contained (no double writeHead)', () => {
  it('the events handler catches a post-header throw, returns hijacked, and ends the stream', () => {
    const ctl = controllable();
    const registry = new JobRegistry(ctl.deps);
    registry.start({ id: 'r1', root: '/tmp/x' }, 'sync'); // a running job
    const routes = buildJobRoutes({
      resolveRepo: (id) => (id === 'r1' ? { id: 'r1', root: '/tmp/x', name: 'x' } : null),
      registry,
    });
    const eventsRoute = routes.find((r) => r.method === 'GET' && r.pattern.endsWith('/events'))!;

    // A response whose write() throws AFTER writeHead has flipped headersSent.
    let ended = false;
    const res = {
      headersSent: false,
      writeHead(): void { (res as { headersSent: boolean }).headersSent = true; },
      write(): boolean { throw new Error('EPIPE after headers'); },
      end(): void { ended = true; },
      on(): void { /* drain/close — unused here */ },
    };
    const diag: string[] = [];
    const ctx: RouteContext = {
      method: 'GET', rawPath: '/api/reindex/r1/events', params: { repo: 'r1' },
      query: new URLSearchParams(''), headers: {},
      res: res as unknown as RouteContext['res'],
      req: { on: () => undefined } as unknown as RouteContext['req'],
      logDiagnostic: (m) => diag.push(m),
    };

    let result: unknown;
    // The throw must NOT escape (it would return a non-hijacked error result → a
    // second writeHead → ERR_HTTP_HEADERS_SENT → unhandled rejection).
    expect(() => { result = eventsRoute.handler(ctx); }).not.toThrow();
    expect(result).toMatchObject({ status: 200, hijacked: true });
    expect(ended).toBe(true);                       // the hijacked stream was ended cleanly
    expect(diag.join('\n')).toContain('SSE stream failed');

    ctl.release.resolve(syncResult()); // let the running job settle
  });
});

describe('F6 — defaultIsLockHeld distinguishes ENOENT (free) from other read errors (held)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
  });
  const mkroot = (): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lockprobe-'));
    dirs.push(d);
    fs.mkdirSync(getCodeGraphDir(d), { recursive: true });
    return d;
  };
  const lockPath = (root: string): string => path.join(getCodeGraphDir(root), 'codegraph.lock');

  it('a missing lock file (ENOENT) → not held (free)', () => {
    expect(defaultIsLockHeld(mkroot())).toBe(false);
  });

  it('our own pid in the lock → not held (re-entrant, not contention)', () => {
    const root = mkroot();
    fs.writeFileSync(lockPath(root), String(process.pid));
    expect(defaultIsLockHeld(root)).toBe(false);
  });

  it('a dead foreign pid → not held (stale)', () => {
    const root = mkroot();
    fs.writeFileSync(lockPath(root), '2147483646'); // ~never a live pid → ESRCH
    expect(defaultIsLockHeld(root)).toBe(false);
  });

  it('a NON-ENOENT read failure (lock path is a directory → EISDIR) → conservatively HELD', () => {
    const root = mkroot();
    fs.mkdirSync(lockPath(root)); // reading a directory throws EISDIR, not ENOENT
    expect(defaultIsLockHeld(root)).toBe(true);
  });
});

describe('t1/t2 — contention-sentinel disambiguation (runWithLockRetry)', () => {
  it('t1: all-zero sync sentinel + lock held on re-probe ⇒ lock_unavailable', async () => {
    let probes = 0; // pre-probe (call #1) false, re-probe (call #2+) true
    const fx = await server({
      jobDeps: {
        runIndex: async () => zeroSync(),
        isLockHeld: () => probes++ > 0,
        rearmWatcher: () => {},
        lockRetryWindowMs: 0,
        lockRetryIntervalMs: 1,
      },
    });
    const res = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    expect(res.status).toBe(202);
    const term = await waitTerminal(fx.baseURL, fx.repoId, CT(15000));
    expect(term.status).toBe('error');
    expect(term.reason).toBe('lock_unavailable');
  }, CT(20000));

  it('t1: all-zero sync sentinel + lock never held ⇒ done (genuinely-empty sync)', async () => {
    const fx = await server({
      jobDeps: {
        runIndex: async () => zeroSync(),
        isLockHeld: () => false,
        rearmWatcher: () => {},
      },
    });
    const res = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}`, { method: 'POST' });
    expect(res.status).toBe(202);
    const term = await waitTerminal(fx.baseURL, fx.repoId, CT(15000));
    expect(term.status).toBe('done');
    expect(term.reason).not.toBe('lock_unavailable');
    expect((term.result as SyncResult).filesChecked).toBe(0); // the whitelisted zero result
  }, CT(20000));

  it('t2: full-mode errors[] lock sentinel + lock held on re-probe ⇒ lock_unavailable; POST still 202', async () => {
    let probes = 0;
    const fx = await server({
      jobDeps: {
        runIndex: async () => fullLockSentinel(),
        isLockHeld: () => probes++ > 0,
        rearmWatcher: () => {},
        lockRetryWindowMs: 0,
        lockRetryIntervalMs: 1,
      },
    });
    const res = await fetch(`${fx.baseURL}/api/reindex/${fx.repoId}?full=true`, { method: 'POST' });
    expect(res.status).toBe(202);
    const term = await waitTerminal(fx.baseURL, fx.repoId, CT(15000));
    expect(term.status).toBe('error');
    expect(term.mode).toBe('full');
    expect(term.reason).toBe('lock_unavailable');
  }, CT(20000));
});

describe('t4 — ReindexJob.emit subscriber isolation', () => {
  it('a throwing subscriber never stops a good one from receiving the terminal; the job settles', async () => {
    const deps: JobDeps = {
      runIndex: async () => syncResult(),
      isLockHeld: () => false,
      rearmWatcher: () => {},
    };
    const job = new ReindexJob({ id: 'r1', root: '/tmp/x' }, 'sync', deps);
    const received: Array<{ type: string }> = [];
    job.subscribe(() => { throw new Error('bad subscriber'); });
    job.subscribe((evt) => { received.push(evt); });
    await job.run();
    await job.whenSettled();
    expect(received.some((e) => e.type === 'terminal')).toBe(true);
    expect(job.descriptor().status).toBe('done');
  }, CT(15000));
});

// ---------------------------------------------------------------------------
function syncResult(): SyncResult {
  return { filesChecked: 1, filesAdded: 0, filesModified: 0, filesRemoved: 0, nodesUpdated: 0, durationMs: 5 };
}
function indexResult(): IndexResult {
  return {
    success: true, filesIndexed: 1, filesSkipped: 0, filesErrored: 0,
    nodesCreated: 2, edgesCreated: 1, errors: [], durationMs: 7,
  };
}
