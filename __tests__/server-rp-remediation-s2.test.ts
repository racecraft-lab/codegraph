/**
 * SPEC-005 slice-2 (jobs/SSE) review-remediation regression tests.
 *
 * Covers the cleanly-testable behavioral fixes from the PR #42 external review.
 * 42-4 (latest-progress-on-connect) is a minor connect-ordering nicety exercised
 * by the existing SSE snapshot/progress suite; the code change is a two-line
 * `latestProgress()` send verified by inspection + type-check.
 *
 * @module __tests__/server-rp-remediation-s2
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultIsLockHeld, JobConflictError, JobRegistry, ReindexJob, type JobDescriptor } from '../src/server/jobs';
import { SseWriter, streamJobToResponse } from '../src/server/sse';
import {
  buildJobRoutes,
  buildReadRoutes,
  handleApiRequest,
  type JobApiDeps,
  type ReadApiDeps,
  type RepoInfo,
  type RouteContext,
} from '../src/server/routes';
import { getCodeGraphDir } from '../src/directory';

describe('SPEC-005 slice-2 review remediation', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });

  // 42-3 (FR-021a): process.kill(pid,0) throws for BOTH a dead pid (ESRCH) and a
  // live-but-unsignalable one (EPERM). Only ESRCH means the lock is stale/free;
  // EPERM means a live foreign holder we simply cannot signal — treat as HELD so a
  // job never races a concurrent indexer into index corruption.
  it('42-3: a foreign lock owner we cannot signal (EPERM) is HELD; a dead one (ESRCH) is free', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rp-lock-'));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const cgDir = getCodeGraphDir(dir);
    fs.mkdirSync(cgDir, { recursive: true });
    // A foreign pid (not ours; defaultIsLockHeld short-circuits our own pid).
    fs.writeFileSync(path.join(cgDir, 'codegraph.lock'), String(process.pid + 100_000));

    const realKill = process.kill.bind(process);
    try {
      (process as unknown as { kill: unknown }).kill = () => {
        const e = new Error('operation not permitted') as NodeJS.ErrnoException;
        e.code = 'EPERM';
        throw e;
      };
      expect(defaultIsLockHeld(dir)).toBe(true); // EPERM → HELD (conservative)

      (process as unknown as { kill: unknown }).kill = () => {
        const e = new Error('no such process') as NodeJS.ErrnoException;
        e.code = 'ESRCH';
        throw e;
      };
      expect(defaultIsLockHeld(dir)).toBe(false); // ESRCH → stale/free
    } finally {
      (process as unknown as { kill: unknown }).kill = realKill;
    }
  });

  // 42-6 (FR-021): a job must ALWAYS reach a terminal state and settle. A
  // user-injected diagnostic sink that throws in the failure path must not skip
  // the terminal transition (which would hang whenSettled / reject run()).
  it('42-6: a throwing diagnostic sink still reaches terminal error and settles', async () => {
    const job = new ReindexJob({ id: 'r', root: os.tmpdir() }, 'sync', {
      runIndex: async () => {
        throw new Error('index boom');
      },
      isLockHeld: () => false,
      rearmWatcher: () => undefined,
      logDiagnostic: () => {
        throw new Error('diagnostic sink boom');
      },
    });

    await expect(job.run()).resolves.toBeUndefined(); // must not reject
    await job.whenSettled(); // must resolve, not hang
    expect(job.isTerminal()).toBe(true);
    expect(job.descriptor().status).toBe('error');
  });

  // 42-7 (FR-021a/026): whenSettled() — the signal ordered shutdown (abortAll)
  // waits on — must not resolve until run()'s cleanup, INCLUDING the watcher
  // re-arm, has finished. The terminal SSE event still fires first (in finish()).
  it('42-7: whenSettled waits for the watcher re-arm to complete', async () => {
    let releaseRearm!: () => void;
    const rearmGate = new Promise<void>((r) => {
      releaseRearm = r;
    });
    const job = new ReindexJob({ id: 'r', root: os.tmpdir() }, 'sync', {
      runIndex: async () => ({
        filesChecked: 1,
        filesAdded: 0,
        filesModified: 0,
        filesRemoved: 0,
        nodesUpdated: 0,
        durationMs: 1,
      }),
      isLockHeld: () => false,
      rearmWatcher: () => rearmGate, // stays pending until we release it
    });

    const runP = job.run();
    let settled = false;
    void job.whenSettled().then(() => {
      settled = true;
    });
    // Let run() reach its finally (terminal emitted) and block on the re-arm gate.
    await new Promise((r) => setImmediate(r));
    expect(job.isTerminal()).toBe(true); // terminal already emitted in finish()
    expect(settled).toBe(false); // but NOT settled — still awaiting re-arm

    releaseRearm();
    await runP;
    await job.whenSettled();
    expect(settled).toBe(true);
  });

  // 42-7/registry (FR-026): ordered shutdown (abortAll) must await a job that has
  // already emitted terminal but whose cleanup (watcher re-arm) is still running —
  // abortAll tracks in-flight (unsettled) jobs, not just non-terminal ones.
  it('abortAll waits for a terminal-but-still-cleaning-up job', async () => {
    let releaseRearm!: () => void;
    const rearmGate = new Promise<void>((r) => {
      releaseRearm = r;
    });
    const registry = new JobRegistry({
      runIndex: async () => ({
        filesChecked: 1,
        filesAdded: 0,
        filesModified: 0,
        filesRemoved: 0,
        nodesUpdated: 0,
        durationMs: 1,
      }),
      isLockHeld: () => false,
      rearmWatcher: () => rearmGate,
    });
    registry.start({ id: 'r', root: os.tmpdir() }, 'sync');
    // Let the job reach terminal (re-arm now pending in its run() finally).
    await new Promise((r) => setImmediate(r));

    let abortDone = false;
    const abortP = registry.abortAll().then(() => {
      abortDone = true;
    });
    await new Promise((r) => setImmediate(r));
    expect(abortDone).toBe(false); // still awaiting the terminal job's re-arm

    releaseRearm();
    await abortP;
    expect(abortDone).toBe(true);
  });

  // 42-5 (FR-023): heartbeats must respect backpressure — a slow client that
  // cannot accept a write must not accumulate heartbeat frames.
  it('42-5: a heartbeat is skipped while the socket is backpressured', () => {
    const writes: string[] = [];
    let accept = true;
    const sink = {
      write: (c: string) => {
        writes.push(c);
        return accept;
      },
      end: () => undefined,
      on: () => undefined,
    };
    const writer = new SseWriter(sink as never);

    // A progress write the socket refuses (returns false) arms draining.
    accept = false;
    writer.writeProgress({ phase: 'scanning', current: 1, total: 10 } as never);
    const afterProgress = writes.length;

    writer.writeHeartbeat(); // must be a no-op while draining
    expect(writes.length).toBe(afterProgress);
  });
});

describe('SPEC-005 slice-2 round-2 remediation', () => {
  // R2-P1e (FR-023/026): an abort during a lock-retry WAIT must be observed at
  // once, not only after the interval elapses. With a long interval, a plain
  // sleep would block ~30s; the abortable sleep resolves promptly → `aborted`.
  it('R2-P1e: a job aborted during a lock-retry wait settles promptly as aborted', async () => {
    const job = new ReindexJob({ id: 'r', root: os.tmpdir() }, 'sync', {
      runIndex: async () => { throw new Error('runIndex must not run while the lock is held'); },
      isLockHeld: () => true,        // always contended → the retry loop waits
      rearmWatcher: () => undefined,
      lockRetryWindowMs: 60_000,     // far deadline: we're mid-wait, not past it
      lockRetryIntervalMs: 30_000,   // a long wait the abort must cut short
    });

    const runP = job.run();
    await new Promise((r) => setImmediate(r)); // let run() enter the abortable wait
    job.abort();
    await runP;                       // resolves at once — not after 30s
    await job.whenSettled();
    expect(job.isTerminal()).toBe(true);
    expect(job.descriptor().status).toBe('error');
    expect(job.descriptor().reason).toBe('aborted');
  });

  // R2-P1d (FR-021a): the watcher re-arm receives the job's AbortSignal so a
  // shutdown abort during the re-arm RPC tears the socket down promptly.
  it('R2-P1d: the watcher re-arm is invoked with the job AbortSignal', async () => {
    let receivedSignal: unknown = 'unset';
    const job = new ReindexJob({ id: 'r', root: os.tmpdir() }, 'sync', {
      runIndex: async () => ({
        filesChecked: 1, filesAdded: 0, filesModified: 0, filesRemoved: 0, nodesUpdated: 0, durationMs: 1,
      }),
      isLockHeld: () => false,
      rearmWatcher: (_root, signal) => { receivedSignal = signal; },
    });
    await job.run();
    await job.whenSettled();
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  // R2-P1c (FR-023): a SYNCHRONOUS throw from the sink (socket torn down
  // mid-write) must transition the writer to closed, not propagate.
  it('R2-P1c: a synchronous write() throw transitions the writer to closed, not propagated', () => {
    let ended = false;
    const sink = {
      write: (): boolean => { throw new Error('EPIPE mid-write'); },
      end: () => { ended = true; },
      on: () => undefined,
      off: () => undefined,
    };
    const writer = new SseWriter(sink as never);
    const descriptor: JobDescriptor = {
      id: 'j', repo: 'r', mode: 'sync', status: 'running', startedAt: new Date().toISOString(),
    };
    expect(() => writer.writeSnapshot(descriptor)).not.toThrow(); // caught in safeWrite
    expect(ended).toBe(true);                                     // …and the writer closed
    // Once closed, further writes are inert no-ops (never re-throw).
    expect(() => writer.writeProgress({ phase: 'parsing', current: 1, total: 2 } as never)).not.toThrow();
  });

  // R2-P1c (FR-023): the RESPONSE's own close/error — the reliable long-lived
  // disconnect signal — must run cleanup (heartbeat cleared, unsubscribed, writer
  // closed), idempotently.
  it('R2-P1c: a response close/error signal runs cleanup and closes the writer (idempotent)', () => {
    // A fresh, un-run job stays `running`/non-terminal — enough to drive the glue.
    const job = new ReindexJob({ id: 'r', root: os.tmpdir() }, 'sync', {});
    const listeners: Record<string, Array<() => void>> = {};
    let ended = false;
    const res = {
      writeHead: () => undefined,
      write: () => true,
      end: () => { ended = true; },
      on: (event: string, l: () => void) => { (listeners[event] ??= []).push(l); },
      off: () => undefined,
    };
    streamJobToResponse(res as never, undefined, job);
    expect(ended).toBe(false); // live stream: snapshot written, not ended
    // The RESPONSE's own close AND error are wired (not only req-close).
    expect((listeners.close ?? []).length).toBeGreaterThan(0);
    expect((listeners.error ?? []).length).toBeGreaterThan(0);
    for (const l of listeners.error) l(); // a response error fires cleanup → writer.close() → res.end()
    expect(ended).toBe(true);
    for (const l of listeners.close) l(); // idempotent: a later close neither re-runs nor throws
    expect(ended).toBe(true);
  });

  // R2-P1f (FR-015a): a throwing diagnostic sink on the daemon-attach path must
  // not turn the documented 503 into a 500 — safeDiagnostic contains it.
  // (R2-P2b is a comment-only fix with no separate behavioral surface.)
  it('R2-P1f: a throwing diagnostic sink on the daemon-attach path still returns 503, not 500', async () => {
    const repo: RepoInfo = { id: 'r1', root: '/tmp/x', name: 'x' };
    const deps: ReadApiDeps = {
      version: '1.0.0',
      defaultRepo: repo,
      resolveRepo: (id) => (id === undefined || id === 'r1' ? repo : null),
      getClient: async () => { throw new Error('daemon spawn failed'); },
      isRepoIndexed: () => true,
    };
    const routes = buildReadRoutes(deps);
    const ctx: RouteContext = {
      method: 'GET',
      rawPath: '/api/node/abc',
      params: {},
      query: new URLSearchParams(''),
      headers: {},
      logDiagnostic: () => { throw new Error('diagnostic sink boom'); },
    };
    const result = await handleApiRequest(routes, ctx);
    expect(result?.status).toBe(503);
  });
});

describe('SPEC-005 slice-2 round-3 remediation', () => {
  // R3-#4 (FR-021a): the watcher re-arm MUST run even when the job was aborted
  // (shutdown) — the abort path, not just normal completion, restores the shared
  // daemon watcher. (A prior fix wrongly early-returned on an aborted signal.)
  it('R3-#4: an aborted job still fires the watcher re-arm (FR-021a)', async () => {
    let rearmCalled = false;
    let rearmSawAbortedSignal: boolean | undefined;
    const job = new ReindexJob({ id: 'r', root: os.tmpdir() }, 'sync', {
      runIndex: async () => ({
        filesChecked: 0,
        filesAdded: 0,
        filesModified: 0,
        filesRemoved: 0,
        nodesUpdated: 0,
        durationMs: 1,
      }),
      isLockHeld: () => false,
      rearmWatcher: (_root, signal) => {
        rearmCalled = true;
        rearmSawAbortedSignal = signal?.aborted;
      },
    });
    job.abort(); // shutdown abort BEFORE run
    await job.run();
    expect(job.descriptor().status).toBe('error');
    expect(job.descriptor().reason).toBe('aborted');
    expect(rearmCalled).toBe(true); // re-arm ran despite the abort
    expect(rearmSawAbortedSignal).toBe(true); // and received the aborted signal
  });

  // R3-#2 (FR-021a): a FULL-mode lock sentinel is unambiguous (the library result
  // carries a lock error), so it must be treated as contention even if the lock
  // file reads free on the re-probe (the writer released in between) — never
  // reported as a `done` empty index.
  it('R3-#2: a full-mode lock sentinel is contention even when the re-probe reads free', async () => {
    const job = new ReindexJob({ id: 'r', root: os.tmpdir() }, 'full', {
      runIndex: async () => ({
        success: false,
        durationMs: 0,
        errors: [{ message: 'index lock is held by another process' }],
        filesIndexed: 0,
        filesSkipped: 0,
        filesErrored: 0,
        nodesCreated: 0,
        edgesCreated: 0,
      }),
      isLockHeld: () => false, // writer released between acquire-fail and re-probe
      rearmWatcher: () => undefined,
      lockRetryWindowMs: 0, // past the window immediately → terminal lock_unavailable
      lockRetryIntervalMs: 1,
    });
    await job.run();
    expect(job.descriptor().status).toBe('error');
    expect(job.descriptor().reason).toBe('lock_unavailable'); // NOT 'done'
  });
});

describe('SPEC-005 slice-2 round-4 remediation', () => {
  // R4-EMPTY (FR-020/024): matchRoute accepts an EMPTY `:repo` segment, so
  // `/api/reindex/` and `/api/reindex//events` match with repo=''. index.ts's
  // resolveRepo maps '' → the DEFAULT repo (correct for the OPTIONAL `?repo`
  // query, wrong for the REQUIRED path id), so each job handler must reject an
  // empty path repo BEFORE resolveRepo — 404 resource:repo, never the default.
  it('R4-EMPTY: an empty path repo (/api/reindex/, /api/reindex//events) → 404 repo, not the default', async () => {
    const repo: RepoInfo = { id: 'r1', root: '/tmp/x', name: 'x' };
    const deps: JobApiDeps = {
      // Mirror index.ts: '' (and undefined) resolve to the DEFAULT repo — exactly
      // the wrong resolution the guard prevents. A started job here would be a bug.
      resolveRepo: (id) => (id === undefined || id === '' || id === 'r1' ? repo : null),
      registry: new JobRegistry({
        runIndex: async () => { throw new Error('no job must start for an empty path repo'); },
        isLockHeld: () => false,
        rearmWatcher: () => undefined,
      }),
    };
    const routes = buildJobRoutes(deps);
    for (const [method, rawPath] of [
      ['POST', '/api/reindex/'],
      ['GET', '/api/reindex/'],
      ['GET', '/api/reindex//events'],
    ] as const) {
      const ctx: RouteContext = {
        method, rawPath, params: {}, query: new URLSearchParams(''), headers: {},
      };
      const res = await handleApiRequest(routes, ctx);
      expect(res?.status, `${method} ${rawPath}`).toBe(404);
      const body = res?.body as { error: { details?: { resource?: string } } };
      expect(body.error.details?.resource).toBe('repo');
    }
  });

  // R4-SHUTDOWN-START (FR-026): once shutdown has begun (abortAll set the flag), a
  // POST that raced onto a keep-alive connection must be REJECTED, not spawn a job
  // that abortAll's one-shot snapshot can no longer track. start() throws
  // JobConflictError (the route maps it to 409 — acceptable, the server is closing).
  it('R4-SHUTDOWN-START: start() after abortAll() throws JobConflictError (no untracked shutdown job)', async () => {
    const registry = new JobRegistry({
      runIndex: async () => ({
        filesChecked: 0, filesAdded: 0, filesModified: 0, filesRemoved: 0, nodesUpdated: 0, durationMs: 0,
      }),
      isLockHeld: () => false,
      rearmWatcher: () => undefined,
    });
    await registry.abortAll(); // shutdown begins (nothing in flight)
    expect(() => registry.start({ id: 'r', root: os.tmpdir() }, 'sync')).toThrow(JobConflictError);
  });

  // R4-REARM-LISTENER (FR-021a): the abort→transport.stop() listener in
  // defaultRearmWatcher is now NAMED and removed in the finally, so a completed
  // re-arm never leaves the listener (and the stopped transport it closes over)
  // retained on the job's AbortSignal. There is no surgical unit seam for the
  // removal without a live daemon socket; the re-arm path itself stays covered by
  // the R2-P1d (signal passed) and R3-#4 (re-arm runs on the abort path) tests.
});
