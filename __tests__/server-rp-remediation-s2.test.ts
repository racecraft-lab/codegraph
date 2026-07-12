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
import { defaultIsLockHeld, ReindexJob } from '../src/server/jobs';
import { SseWriter } from '../src/server/sse';
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
