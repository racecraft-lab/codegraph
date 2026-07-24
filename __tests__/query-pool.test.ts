/**
 * QueryPool — the off-loop worker pool that keeps the shared daemon's main
 * event loop free for the MCP transport under concurrent read load (the
 * "10 subagents time out" report). These tests drive the pool's queue / growth /
 * crash-recovery / backstop logic with INJECTED fake workers, so they exercise
 * the real scheduling code without spawning threads or needing a built dist.
 *
 * End-to-end behavior with real worker threads (a worker opens its own WAL read
 * connection and runs codegraph_explore) is validated separately against a real
 * index; here we pin the orchestration that makes that safe and fair.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  QueryPool,
  QueryPoolUnavailableError,
  resolvePoolSize,
  type PoolWorker,
} from '../src/mcp/query-pool';
import { ToolHandler, type ToolResult } from '../src/mcp/tools';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await sleep(5);
  }
}

interface CallMsg { type: 'call'; id: number; toolName: string; args: Record<string, unknown> }
type Action = { result: ToolResult } | { crash: true } | { hang: true } | { wait: Promise<ToolResult> };

/**
 * Fake worker speaking the same {type:'ready'|'result'} protocol as the real
 * one. `behavior` decides per call whether to return a result, crash (exit≠0),
 * hang (never reply — exercises the backstop), or wait on a promise (lets a test
 * hold a call in-flight to observe concurrency). Emits 'ready' on a macrotask so
 * the pool has wired its listeners first.
 */
class FakeWorker implements PoolWorker {
  private msgCb?: (m: unknown) => void;
  private exitCb?: (code: number) => void;
  alive = true;
  unrefCalled = false;
  constructor(private behavior: (m: CallMsg) => Action, readyOk = true, emitReady = true) {
    if (emitReady) setTimeout(() => { if (this.alive) this.msgCb?.({ type: 'ready', ok: readyOk }); }, 0);
  }
  on(event: string, cb: (...args: any[]) => void): void {
    if (event === 'message') this.msgCb = cb;
    else if (event === 'exit') this.exitCb = cb;
    // 'error' unused by the fakes
  }
  private reply(id: number, result: ToolResult): void {
    if (this.alive) this.msgCb?.({ type: 'result', id, result });
  }
  postMessage(msg: unknown): void {
    if (!this.alive) return;
    const m = msg as CallMsg;
    if (!m || m.type !== 'call') return;
    const action = this.behavior(m);
    if ('crash' in action) {
      this.exit(13); // simulate a crash exit
      return;
    }
    if ('hang' in action) return; // never reply
    if ('wait' in action) { void action.wait.then((r) => this.reply(m.id, r)); return; }
    setTimeout(() => this.reply(m.id, action.result), 0);
  }
  exit(code = 0): void {
    if (!this.alive) return;
    this.alive = false;
    setTimeout(() => this.exitCb?.(code), 0);
  }
  terminate(): Promise<number> { this.alive = false; return Promise.resolve(0); }
  unref(): void { this.unrefCalled = true; }
}

class ThrowingPostWorker extends FakeWorker {
  override postMessage(): void {
    throw new Error('postMessage failed');
  }
}

class DelayedTerminateWorker extends FakeWorker {
  private resolveTermination!: (code: number) => void;
  private readonly termination = new Promise<number>((resolve) => {
    this.resolveTermination = resolve;
  });

  override terminate(): Promise<number> { return this.termination; }

  finishTermination(): void {
    this.alive = false;
    this.resolveTermination(0);
  }
}

class RejectingTerminateWorker extends FakeWorker {
  override terminate(): Promise<number> { return Promise.reject(new Error('termination failed')); }
}

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] });

describe('resolvePoolSize', () => {
  it('honors a numeric override and disables on 0', () => {
    expect(resolvePoolSize('0', 8)).toBe(0);
    expect(resolvePoolSize('3', 8)).toBe(3);
  });
  it('caps the override at the hard ceiling', () => {
    expect(resolvePoolSize('999', 8)).toBe(16);
  });
  it('defaults to clamp(cores-1, 1, 16) when unset/blank/non-numeric', () => {
    expect(resolvePoolSize(undefined, 8)).toBe(7);
    expect(resolvePoolSize('', 8)).toBe(7);
    expect(resolvePoolSize('abc', 8)).toBe(7);
    expect(resolvePoolSize(undefined, 1)).toBe(1);   // never zero
    expect(resolvePoolSize(undefined, 64)).toBe(16); // never above the ceiling
  });
});

describe('QueryPool', () => {
  it('dispatches a call and returns the worker result', async () => {
    const pool = new QueryPool({ root: '/x', size: 1, createWorker: () => new FakeWorker((m) => ({ result: ok(`r:${m.toolName}`) })) });
    const res = await pool.run('codegraph_explore', { query: 'q' });
    expect(res.content[0].text).toBe('r:codegraph_explore');
    await pool.destroy();
  });

  it('runs N concurrent calls in parallel (not serialized)', async () => {
    let active = 0, maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    // Each call holds in-flight until the gate opens, so max concurrency across
    // the pool is observable: with size=5 and 5 calls, all 5 should run at once.
    const behavior = (m: CallMsg): Action => ({
      wait: (async () => {
        active++; maxActive = Math.max(maxActive, active);
        await gate;
        active--;
        return ok(`r${m.id}`);
      })(),
    });
    const pool = new QueryPool({ root: '/x', size: 5, createWorker: () => new FakeWorker(behavior) });
    const calls = Promise.all(Array.from({ length: 5 }, (_, i) => pool.run('codegraph_search', { i })));
    await waitUntil(() => maxActive === 5); // let all workers spawn (cold-start cap → a few generations) + dispatch
    expect(maxActive).toBe(5);
    release();
    const results = await calls;
    expect(results.every((r) => /^r\d+$/.test(r.content[0].text))).toBe(true);
    await pool.destroy();
  });

  it('does not spawn the whole pool for a single call (pending-aware growth)', async () => {
    let created = 0;
    const pool = new QueryPool({ root: '/x', size: 8, createWorker: () => { created++; return new FakeWorker((m) => ({ result: ok(`r${m.id}`) })); } });
    await pool.run('codegraph_node', { symbol: 's' });
    // One eager worker + at most the cold-start cap — never all 8.
    expect(created).toBeLessThanOrEqual(2);
    await pool.destroy();
  });

  it('backs off after synchronous worker creation failure without exhausting the crash budget', async () => {
    let available = false;
    let attempts = 0;
    const pool = new QueryPool({
      root: '/x',
      size: 2,
      softTimeoutMs: 1_000,
      createWorker: () => {
        attempts++;
        if (!available) throw new Error('temporary worker resource shortage');
        return new FakeWorker((message) => ({ result: ok(`recovered:${message.id}`) }));
      },
    });
    const outcome = pool.run('after-spawn-shortage', {}).then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    setTimeout(() => { available = true; }, 20);

    const settled = await outcome;

    expect(settled).toMatchObject({ result: { content: [{ text: 'recovered:1' }] } });
    expect(pool.healthy).toBe(true);
    expect(attempts).toBeLessThan(12);
    await pool.destroy();
  });

  it('retries a transient eager worker creation failure before any job is queued', async () => {
    let attempts = 0;
    const pool = new QueryPool({
      root: '/x',
      size: 1,
      createWorker: () => {
        attempts++;
        if (attempts === 1) throw new Error('temporary startup resource shortage');
        return new FakeWorker((message) => ({ result: ok(`ready:${message.id}`) }));
      },
    });

    expect(pool.ready).toBe(false);
    await waitUntil(() => pool.ready);

    expect(pool.ready).toBe(true);
    expect(attempts).toBe(2);
    await pool.destroy();
  });

  it('recovers from a worker crash: retries the in-flight call and respawns', async () => {
    let calls = 0;
    const pool = new QueryPool({
      root: '/x', size: 2, maxRetries: 1,
      // First dispatch crashes its worker; the retry (on a respawn/other worker) succeeds.
      createWorker: () => new FakeWorker((m) => (++calls === 1 ? { crash: true } : { result: ok(`recovered:${m.id}`) })),
    });
    const res = await pool.run('codegraph_explore', { query: 'q' });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toBe('recovered:1');
    await sleep(10);
    // The pool grows lazily, so one call keeps one worker — but the crash must
    // have been replaced (not dropped to zero) and the pool stays healthy and
    // keeps serving.
    expect(pool.liveWorkers).toBeGreaterThanOrEqual(1);
    expect(pool.healthy).toBe(true);
    const again = await pool.run('codegraph_node', { symbol: 's' });
    expect(again.isError).toBeFalsy();
    await pool.destroy();
  });

  it('does not replace a crashed worker until its termination settles', async () => {
    const workers: FakeWorker[] = [];
    let retiring!: DelayedTerminateWorker;
    const pool = new QueryPool({
      root: '/x',
      size: 1,
      maxRetries: 1,
      createWorker: () => {
        const worker = workers.length === 0
          ? (retiring = new DelayedTerminateWorker(() => ({ crash: true })))
          : new FakeWorker((message) => ({ result: ok(`replacement:${message.toolName}`) }));
        workers.push(worker);
        return worker;
      },
    });
    await waitUntil(() => pool.ready);

    const recovered = pool.run('crash-once', {});
    await waitUntil(() => !retiring.alive && pool.liveWorkers === 1);

    expect(workers).toHaveLength(1);
    retiring.finishTermination();
    await expect(recovered).resolves.toMatchObject({
      content: [{ text: 'replacement:crash-once' }],
    });
    expect(workers).toHaveLength(2);
    expect(pool.liveWorkers).toBe(1);
    await pool.destroy();
  });

  it('opens the circuit when retiring-worker termination misses its deadline', async () => {
    const workers: FakeWorker[] = [];
    let retiring!: DelayedTerminateWorker;
    const pool = new QueryPool({
      root: '/x',
      size: 1,
      softTimeoutMs: 20,
      terminationTimeoutMs: 20,
      createWorker: () => {
        const worker = retiring = new DelayedTerminateWorker(() => ({ hang: true }));
        workers.push(worker);
        return worker;
      },
    });

    const result = await pool.run('never-terminates', {});
    expect(result.content[0].text).toMatch(/busy|retry/i);
    await waitUntil(() => !pool.healthy);

    expect(pool.healthy).toBe(false);
    expect(pool.liveWorkers).toBe(1);
    expect(retiring.unrefCalled).toBe(true);
    expect(workers).toHaveLength(1);
    await expect(pool.run('after-timeout', {})).rejects.toBeInstanceOf(QueryPoolUnavailableError);
    retiring.finishTermination();
    await waitUntil(() => pool.liveWorkers === 0);
    expect(pool.liveWorkers).toBe(0);
    await pool.destroy();
  });

  it('opens the circuit when worker termination rejects', async () => {
    const workers: FakeWorker[] = [];
    const pool = new QueryPool({
      root: '/x',
      size: 1,
      softTimeoutMs: 20,
      terminationTimeoutMs: 100,
      createWorker: () => {
        const worker = new RejectingTerminateWorker(() => ({ hang: true }));
        workers.push(worker);
        return worker;
      },
    });

    await pool.run('termination-rejects', {});
    await waitUntil(() => !pool.healthy);

    expect(pool.healthy).toBe(false);
    expect(pool.liveWorkers).toBe(0);
    expect(workers).toHaveLength(1);
    await pool.destroy();
  });

  it('does not release rejected-termination capacity before opening the circuit', async () => {
    const workers: FakeWorker[] = [];
    const controller = new AbortController();
    const pool = new QueryPool({
      root: '/x',
      size: 1,
      softTimeoutMs: 5_000,
      terminationTimeoutMs: 100,
      createWorker: () => {
        const worker = workers.length === 0
          ? new RejectingTerminateWorker(() => ({ hang: true }))
          : new FakeWorker((message) => ({ result: ok(`unexpected:${message.toolName}`) }));
        workers.push(worker);
        return worker;
      },
    });
    await waitUntil(() => pool.ready);
    const abandoned = pool.run('abandoned', {}, controller.signal);
    await waitUntil(() => (pool as unknown as { inflight: Map<unknown, unknown> }).inflight.size === 1);
    const queued = pool.run('queued', {});

    controller.abort();

    await expect(abandoned).rejects.toThrow('Request aborted');
    await expect(queued).rejects.toBeInstanceOf(QueryPoolUnavailableError);
    expect(pool.healthy).toBe(false);
    expect(workers).toHaveLength(1);
    await pool.destroy();
  });

  it('bounds destroy when worker termination never settles', async () => {
    let worker!: DelayedTerminateWorker;
    const pool = new QueryPool({
      root: '/x',
      size: 1,
      terminationTimeoutMs: 20,
      createWorker: () => worker = new DelayedTerminateWorker(() => ({ hang: true })),
    });
    await waitUntil(() => pool.ready);

    const completed = await Promise.race([
      pool.destroy().then(() => true),
      sleep(200).then(() => false),
    ]);

    expect(completed).toBe(true);
    expect(worker.unrefCalled).toBe(true);
    worker.finishTermination();
  });

  it('fails a poison call gracefully without wedging the pool', async () => {
    // This specific call always crashes its worker; a normal call still works.
    const poison = (m: CallMsg) => m.toolName === 'codegraph_explore';
    const pool = new QueryPool({
      root: '/x', size: 3, maxRetries: 1,
      createWorker: () => new FakeWorker((m) => (poison(m) ? { crash: true } : { result: ok(`ok:${m.id}`) })),
    });
    const bad = await pool.run('codegraph_explore', { query: 'boom' });
    expect(bad.isError).toBe(true); // graceful, after retries
    const good = await pool.run('codegraph_search', { query: 'fine' });
    expect(good.isError).toBeFalsy();
    expect(good.content[0].text).toMatch(/^ok:/);
    await pool.destroy();
  });

  it('releases queued calls immediately when the worker circuit breaker opens', async () => {
    const pool = new QueryPool({
      root: '/x',
      size: 1,
      maxRetries: 20,
      softTimeoutMs: 5_000,
      createWorker: () => new FakeWorker(() => ({ crash: true })),
    });
    const first = pool.run('first', {});
    const queued = pool.run('queued', {});
    const outcomes = Promise.allSettled([first, queued]);

    await waitUntil(() => !pool.healthy, 2_000);
    expect(pool.healthy).toBe(false);
    const settled = await Promise.race([
      outcomes,
      sleep(100).then(() => null),
    ]);

    expect(settled).not.toBeNull();
    expect(settled).toEqual([
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ message: expect.stringMatching(/unavailable/i) }) }),
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ message: expect.stringMatching(/unavailable/i) }) }),
    ]);
    await pool.destroy();
  });

  it('retires surviving workers and rejects their calls when the circuit opens', async () => {
    let releaseHeld!: (result: ToolResult) => void;
    const held = new Promise<ToolResult>((resolve) => { releaseHeld = resolve; });
    const workers: FakeWorker[] = [];
    const pool = new QueryPool({
      root: '/x',
      size: 2,
      maxRetries: 20,
      softTimeoutMs: 5_000,
      createWorker: () => {
        const worker = workers.length === 0
          ? new FakeWorker((message) => message.toolName === 'held' ? { wait: held } : { crash: true })
          : new FakeWorker(() => ({ crash: true }));
        workers.push(worker);
        return worker;
      },
    });
    await waitUntil(() => pool.ready);
    const outcomes = Promise.allSettled([
      pool.run('held', {}),
      pool.run('crash', {}),
    ]);

    await waitUntil(() => !pool.healthy, 2_000);

    expect(pool.healthy).toBe(false);
    expect(pool.liveWorkers).toBe(0);
    expect(workers.every((worker) => !worker.alive)).toBe(true);
    const settled = await Promise.race([
      outcomes,
      sleep(100).then(() => null),
    ]);
    expect(settled).toEqual([
      expect.objectContaining({ status: 'rejected', reason: expect.any(QueryPoolUnavailableError) }),
      expect.objectContaining({ status: 'rejected', reason: expect.any(QueryPoolUnavailableError) }),
    ]);
    releaseHeld(ok('late'));
    await pool.destroy();
  });

  it('recovers from a synchronous worker postMessage failure', async () => {
    let created = 0;
    const workers: FakeWorker[] = [];
    const pool = new QueryPool({
      root: '/x',
      size: 1,
      maxRetries: 1,
      createWorker: () => {
        const worker = created++ === 0
          ? new ThrowingPostWorker(() => ({ hang: true }))
          : new FakeWorker((message) => ({ result: ok(`recovered:${message.id}`) }));
        workers.push(worker);
        return worker;
      },
    });
    await waitUntil(() => pool.ready);

    const result = await pool.run('after-post-failure', {});

    expect(result.content[0].text).toBe('recovered:1');
    expect(workers[0]?.alive).toBe(false);
    expect(pool.liveWorkers).toBe(1);
    await pool.destroy();
  });

  it('falls back in-process when the worker circuit opens during a call', async () => {
    const handler = new ToolHandler(null);
    const poolRun = vi.fn().mockRejectedValue(new QueryPoolUnavailableError());
    handler.setQueryPool({
      healthy: true,
      ready: true,
      run: poolRun,
    } as unknown as QueryPool);
    const fallback = vi.spyOn(handler, 'executeReadTool').mockResolvedValue(ok('in-process'));

    const result = await handler.execute('codegraph_search', { query: 'alpha' });

    expect(poolRun).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledWith('codegraph_search', { query: 'alpha' });
    expect(result.content[0].text).toBe('in-process');
  });

  it('graceful backstop: a call that can\'t be served in time gets success-shaped busy guidance', async () => {
    // 1 worker, every call hangs; soft-timeout small → the caller gets guidance,
    // never a hard error, never a hang.
    const pool = new QueryPool({ root: '/x', size: 1, softTimeoutMs: 60, createWorker: () => new FakeWorker(() => ({ hang: true })) });
    const res = await pool.run('codegraph_explore', { query: 'q' });
    expect(res.isError).toBeFalsy();            // NOT an error (abandonment rule)
    expect(res.content[0].text).toMatch(/busy|retry/i);
    await pool.destroy();
  });

  it('retires a hung in-flight worker at the backstop and restores pool capacity', async () => {
    const workers: FakeWorker[] = [];
    let retiring!: DelayedTerminateWorker;
    const pool = new QueryPool({
      root: '/x',
      size: 1,
      softTimeoutMs: 40,
      createWorker: () => {
        const worker = workers.length === 0
          ? (retiring = new DelayedTerminateWorker(() => ({ hang: true })))
          : new FakeWorker((message) => ({ result: ok(`replacement:${message.toolName}`) }));
        workers.push(worker);
        return worker;
      },
    });

    const timedOut = await pool.run('hung', {});

    expect(timedOut.content[0].text).toMatch(/busy|retry/i);
    expect(workers).toHaveLength(1);
    expect(pool.liveWorkers).toBe(1);
    expect(retiring.alive).toBe(true);
    retiring.finishTermination();
    await waitUntil(() => workers.length === 2 && pool.ready);
    expect(retiring.alive).toBe(false);
    expect(pool.liveWorkers).toBe(1);
    expect(pool.healthy).toBe(true);
    const recovered = await pool.run('after-timeout', {});
    expect(recovered.content[0].text).toBe('replacement:after-timeout');
    await pool.destroy();
  });

  it('retires an abandoned in-flight worker without charging the crash budget', async () => {
    const workers: FakeWorker[] = [];
    const controller = new AbortController();
    const pool = new QueryPool({
      root: '/x',
      size: 1,
      softTimeoutMs: 5_000,
      createWorker: () => {
        const worker = new FakeWorker((message) => workers.length === 1
          ? { hang: true }
          : { result: ok(`replacement:${message.toolName}`) });
        workers.push(worker);
        return worker;
      },
    });
    await waitUntil(() => pool.ready);
    const abandoned = pool.run('abandoned', {}, controller.signal);
    await waitUntil(() => (pool as unknown as { inflight: Map<unknown, unknown> }).inflight.size === 1);

    controller.abort();

    await expect(abandoned).rejects.toThrow('Request aborted');
    await waitUntil(() => workers.length === 2 && pool.ready);
    expect(workers[0]?.alive).toBe(false);
    expect(pool.liveWorkers).toBe(1);
    expect(pool.healthy).toBe(true);
    const recovered = await pool.run('after-abort', {});
    expect(recovered.content[0].text).toBe('replacement:after-abort');
    await pool.destroy();
  });

  it('drops timed-out queued jobs instead of retaining their arguments', async () => {
    const dispatched: string[] = [];
    const pool = new QueryPool({
      root: '/x',
      size: 1,
      softTimeoutMs: 40,
      createWorker: () => new FakeWorker((message) => {
        dispatched.push(message.toolName);
        return { hang: true };
      }),
    });
    await waitUntil(() => pool.ready);
    const first = pool.run('first', {});
    await waitUntil(() => dispatched.length === 1);
    const queued = pool.run('queued', { retained: 'payload' });

    const result = await queued;

    expect(result.content[0].text).toMatch(/busy|retry/i);
    expect(dispatched).toEqual(['first']);
    expect((pool as unknown as { queue: unknown[] }).queue).toHaveLength(0);
    await pool.destroy();
    await first;
  });

  it('drops queued work when its caller disconnects', async () => {
    const dispatched: string[] = [];
    const worker = new FakeWorker((message) => {
      dispatched.push(message.toolName);
      return { hang: true };
    });
    const pool = new QueryPool({ root: '/x', size: 1, createWorker: () => worker });
    await waitUntil(() => pool.ready);
    const first = pool.run('first', {});
    await waitUntil(() => dispatched.length === 1);
    const controller = new AbortController();
    const queued = pool.run('queued', {}, controller.signal);

    controller.abort();

    await expect(queued).rejects.toThrow('Request aborted');
    expect(dispatched).toEqual(['first']);
    await pool.destroy();
    await first;
  });

  it('replaces a worker that exits cleanly while the pool is active', async () => {
    const workers: FakeWorker[] = [];
    const pool = new QueryPool({
      root: '/x',
      size: 1,
      createWorker: () => {
        const worker = new FakeWorker((message) => ({ result: ok(`replacement:${message.id}`) }));
        workers.push(worker);
        return worker;
      },
    });
    await waitUntil(() => pool.ready);

    workers[0].exit(0);

    await waitUntil(() => workers.length === 2);
    const result = await pool.run('after-clean-exit', {});
    expect(result.content[0].text).toBe('replacement:1');
    expect(pool.liveWorkers).toBe(1);
    await pool.destroy();
  });

  it('replaces a failed ready worker without dispatching queued work to it', async () => {
    let created = 0;
    const dispatched: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<ToolResult>((resolve) => {
      releaseFirst = () => resolve(ok('first-done'));
    });
    const pool = new QueryPool({
      root: '/x',
      size: 2,
      softTimeoutMs: 1_000,
      createWorker: () => {
        const index = created++;
        if (index === 0) {
          return new FakeWorker((message) => {
            dispatched.push(`first:${message.toolName}`);
            return { wait: firstGate };
          });
        }
        if (index === 1) {
          return new FakeWorker((message) => {
            dispatched.push(`failed:${message.toolName}`);
            return { result: ok('must-not-run') };
          }, false);
        }
        return new FakeWorker((message) => {
          dispatched.push(`replacement:${message.toolName}`);
          return { result: ok('replacement-result') };
        });
      },
    });
    await waitUntil(() => pool.ready);
    const first = pool.run('first', {});
    await waitUntil(() => dispatched.includes('first:first'));

    const second = await pool.run('second', {});

    expect(second.content[0].text).toBe('replacement-result');
    expect(created).toBe(3);
    expect(dispatched).not.toContain('failed:second');
    expect(dispatched).toContain('replacement:second');
    releaseFirst();
    await first;
    await pool.destroy();
  });

  it('destroy settles outstanding calls instead of hanging', async () => {
    const pool = new QueryPool({ root: '/x', size: 1, softTimeoutMs: 10_000, createWorker: () => new FakeWorker(() => ({ hang: true })) });
    const pending = pool.run('codegraph_explore', { query: 'q' });
    await sleep(5);
    await pool.destroy();
    const res = await pending; // must resolve, not hang
    expect(res.isError).toBe(true);
    expect(pool.healthy).toBe(false);
  });

  it('is not `ready` until a worker completes its cold start', async () => {
    // `ready` remains useful for diagnostics: it is false before the first
    // handshake and true after. Healthy callers may still enqueue work while
    // startup is in progress; QueryPool's startup and soft-timeout backstops
    // bound that wait without running the same heavy read on the main thread.
    // (FakeWorker posts 'ready' on a macrotask — the synchronous check below
    // observes the cold-start window.)
    const pool = new QueryPool({ root: '/x', size: 1, createWorker: () => new FakeWorker((m) => ({ result: ok(`r:${m.toolName}`) })) });
    expect(pool.ready).toBe(false); // eager worker spawned but not yet warm
    await sleep(5);                 // let the ready handshake land
    expect(pool.ready).toBe(true);
    const res = await pool.run('codegraph_status', {});
    expect(res.content[0].text).toBe('r:codegraph_status');
    await pool.destroy();
    expect(pool.ready).toBe(false); // destroyed pool must not be selected
  });

  it('routes reads through a healthy pool while its eager worker is warming', async () => {
    const handler = new ToolHandler(null);
    const poolRun = vi.fn().mockResolvedValue(ok('worker-result'));
    handler.setQueryPool({
      healthy: true,
      ready: false,
      run: poolRun,
    } as unknown as QueryPool);
    const fallback = vi.spyOn(handler, 'executeReadTool').mockResolvedValue(ok('in-process'));

    const result = await handler.execute('codegraph_search', { query: 'alpha' });

    expect(poolRun).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
    expect(result.content[0].text).toBe('worker-result');
  });

  it('a failed cold start (ready ok:false) does not mark the pool ready', async () => {
    const pool = new QueryPool({ root: '/x', size: 1, createWorker: () => new FakeWorker(() => ({ hang: true }), /* readyOk */ false) });
    await sleep(5);
    expect(pool.ready).toBe(false); // hard open failure — keep serving in-process
    await pool.destroy();
  });

  it('reports not ready while replacing a worker that never completes startup', async () => {
    const workers: FakeWorker[] = [];
    const pool = new QueryPool({
      root: '/x',
      size: 1,
      startupTimeoutMs: 25,
      createWorker: () => {
        const worker = workers.length === 1
          ? new FakeWorker(() => ({ hang: true }), true, false)
          : new FakeWorker((message) => ({ result: ok(`replacement:${message.id}`) }));
        workers.push(worker);
        return worker;
      },
    });
    await waitUntil(() => pool.ready);

    workers[0].exit(1);
    await waitUntil(() => workers.length === 2);

    expect(pool.ready).toBe(false);
    await waitUntil(() => workers.length === 3 && pool.ready);
    expect(workers[1].alive).toBe(false);

    const result = await pool.run('after-startup-timeout', {});
    expect(result.content[0].text).toBe('replacement:1');
    await pool.destroy();
  });
});
