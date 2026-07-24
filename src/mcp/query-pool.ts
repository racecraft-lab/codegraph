/**
 * Query pool — runs CPU-heavy read-tool calls on a pool of worker threads so
 * the shared daemon's main event loop stays free for the MCP transport.
 *
 * Why this exists: see {@link ./query-worker}. One daemon, one event loop, one
 * synchronous SQLite connection serializes every concurrent `codegraph_explore`
 * AND starves the transport (a 10-way wave delivered 0 transport heartbeats in
 * 25s — responses can't flush until the whole batch drains, so clients time
 * out). Spreading the dispatch across worker threads (each its own WAL read
 * connection) restores true multi-core parallelism and an idle main loop.
 *
 * Properties:
 *   - lazy growth: one warm worker on construct, grows to `size` on demand, so a
 *     single-agent session pays for one connection and a 10-subagent burst grows
 *     to the core budget.
 *   - crash recovery: a dead worker is respawned and its in-flight call retried
 *     once; a poison call that keeps crashing fails gracefully (never wedges the
 *     pool). A crash budget trips a circuit breaker (`healthy` → false) so the
 *     caller falls back to in-process dispatch instead of thrashing respawns.
 *   - graceful backstop: a call that can't be served within `softTimeoutMs`
 *     resolves with SUCCESS-shaped "busy, retry" guidance — never `isError`, so
 *     a momentary overload can't teach the agent to abandon codegraph — instead
 *     of hanging past the client's hard timeout.
 */

import { Worker } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';
import type { ToolResult } from './tools';

/** Compiled sibling — `query-worker.js` lives next to this file in `dist/mcp/`. */
const WORKER_FILE = path.join(__dirname, 'query-worker.js');

/**
 * Minimal worker surface the pool drives — satisfied by a real `worker_threads`
 * Worker. Abstracted so tests can inject a fake worker and exercise the pool's
 * queue / growth / crash-recovery / backstop logic without spawning threads or
 * needing a built `dist/`.
 */
export interface PoolWorker {
  postMessage(msg: unknown): void;
  terminate(): Promise<number> | void;
  unref?(): void;
  on(event: 'message', cb: (m: unknown) => void): void;
  on(event: 'error', cb: (e: Error) => void): void;
  on(event: 'exit', cb: (code: number) => void): void;
}

/** Default linger before a queued call is answered with busy-guidance. */
const DEFAULT_BUSY_TIMEOUT_MS = 45_000; // < the ~60s MCP client request timeout

/** Hard ceiling on pool size regardless of core count / env. */
const MAX_POOL_SIZE = 16;

/**
 * Total worker deaths before the pool declares itself unhealthy and the caller
 * reverts to in-process dispatch. High enough to ride out a few transient
 * crashes, low enough that a systematically-broken worker (e.g. a platform that
 * can't spawn threads) degrades quickly instead of respawning forever.
 */
const CRASH_BUDGET = 12;

/**
 * Max workers cold-starting at once. A worker's cold start is heavy — full
 * module load (tree-sitter etc.) + opening a large WAL DB — and starting the
 * whole pool simultaneously thrashes CPU/I-O so badly it can stall the daemon's
 * main loop for tens of seconds. Warming a couple at a time keeps each start
 * fast; as one reports ready the next begins, so the pool still reaches full
 * size within a few calls of a burst, just without the thundering herd.
 */
const MAX_CONCURRENT_SPAWN = 2;

/** Backoff after a synchronous Worker constructor failure (resource pressure). */
const INITIAL_SPAWN_RETRY_MS = 50;
const MAX_SPAWN_RETRY_MS = 1_000;

/** A stuck native call must not make pool retirement or daemon shutdown hang. */
const DEFAULT_WORKER_TERMINATION_TIMEOUT_MS = 5_000;

/** A worker that never completes its ready handshake must not hold capacity forever. */
const DEFAULT_WORKER_STARTUP_TIMEOUT_MS = 60_000;

/** Shape of a message a worker posts back (ready handshake or a tool result). */
interface WorkerMessage {
  type?: string;
  ok?: boolean;
  id?: number;
  result?: ToolResult;
}

interface WorkerTermination {
  /** The worker's actual termination result, which may settle after the deadline. */
  settled: Promise<boolean>;
  /** Bounded view used by shutdown and circuit-breaker decisions. */
  deadline: Promise<boolean>;
}

interface Job {
  id: number;
  toolName: string;
  args: Record<string, unknown>;
  resolve: (r: ToolResult) => void;
  reject: (error: Error) => void;
  retries: number;
  settled: boolean;
  enqueuedAt: number;
  softTimer?: NodeJS.Timeout;
  abortCleanup?: () => void;
}

export interface QueryPoolOptions {
  /** Default project root each worker opens at spawn. */
  root: string;
  /** Max worker threads. Defaults to `clamp(cores-1, 1, 16)`. */
  size?: number;
  /** Linger before a queued call gets busy-guidance. Default 45s. */
  softTimeoutMs?: number;
  /** Retries for an in-flight call whose worker crashed. Default 1. */
  maxRetries?: number;
  /** Max wait for worker termination before the pool fails over in-process. */
  terminationTimeoutMs?: number;
  /** Max wait for a worker's ready handshake before replacing it. */
  startupTimeoutMs?: number;
  /** Worker factory (tests inject a fake). Defaults to a real `worker_threads` Worker. */
  createWorker?: () => PoolWorker;
}

/** The worker circuit opened; the caller should retry this job in-process. */
export class QueryPoolUnavailableError extends Error {
  constructor() {
    super('query pool unavailable');
    this.name = 'QueryPoolUnavailableError';
  }
}

/**
 * Resolve the pool size from the `CODEGRAPH_QUERY_POOL_SIZE` override and the
 * machine's core count. `0` (or a negative) explicitly disables the pool (the
 * caller serves in-process — today's behavior). Unset → `clamp(cores-1, 1, 16)`:
 * leave a core for the main loop + OS, but never zero, since even one worker
 * frees the transport and lets responses flush incrementally.
 */
export function resolvePoolSize(envVal: string | undefined, cpuCount: number): number {
  if (envVal !== undefined && envVal !== '') {
    const n = Number(envVal);
    if (Number.isFinite(n) && n >= 0) return Math.min(Math.floor(n), MAX_POOL_SIZE);
    // non-numeric / negative → fall through to the default
  }
  return Math.max(1, Math.min(cpuCount - 1, MAX_POOL_SIZE));
}

function resolveBusyTimeoutMs(): number {
  const raw = process.env.CODEGRAPH_QUERY_BUSY_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_BUSY_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000) return DEFAULT_BUSY_TIMEOUT_MS;
  return Math.floor(n);
}

/** Success-shaped overload guidance (NEVER isError — see the abandonment rule). */
function busyGuidance(waitedMs: number): ToolResult {
  const secs = Math.max(1, Math.round(waitedMs / 1000));
  return {
    content: [{
      type: 'text',
      text:
        `CodeGraph is busy serving other concurrent requests right now (this call waited ${secs}s in the queue). ` +
        `This is NOT an error and the index is fine — wait a few seconds and retry this exact call; it will return normally. ` +
        `If you can't wait, use your built-in tools for just this one step.`,
    }],
  };
}

export class QueryPool {
  private idle: PoolWorker[] = [];
  private queue: Job[] = [];
  private inflight = new Map<PoolWorker, Job>();
  private workers = new Set<PoolWorker>();
  /** Workers no longer dispatchable but still consuming a real thread slot. */
  private retiringWorkers = new Map<PoolWorker, WorkerTermination>();
  // Workers spawned but not yet 'ready'. Growth must count these so a single
  // first call (with the eager worker still starting) doesn't spawn the WHOLE
  // pool at once — N simultaneous cold worker starts (each a full module load +
  // a large DB open) saturate the box and starve the main loop. Grow only when
  // the queue outstrips idle + pending.
  private pendingWorkers = new Set<PoolWorker>();
  private nextId = 1;
  private totalCrashes = 0;
  private destroyed = false;
  private spawnRetryTimer: NodeJS.Timeout | null = null;
  private startupTimers = new Map<PoolWorker, NodeJS.Timeout>();
  private spawnRetryDelayMs = INITIAL_SPAWN_RETRY_MS;
  private readonly root: string;
  private readonly maxSize: number;
  private readonly softTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly terminationTimeoutMs: number;
  private readonly startupTimeoutMs: number;
  private readonly createWorker: () => PoolWorker;

  constructor(opts: QueryPoolOptions) {
    this.root = opts.root;
    this.maxSize = Math.max(1, Math.min(opts.size ?? Math.max(1, os.cpus().length - 1), MAX_POOL_SIZE));
    this.softTimeoutMs = opts.softTimeoutMs ?? resolveBusyTimeoutMs();
    this.maxRetries = opts.maxRetries ?? 1;
    this.terminationTimeoutMs = Math.max(1, opts.terminationTimeoutMs ?? DEFAULT_WORKER_TERMINATION_TIMEOUT_MS);
    this.startupTimeoutMs = Math.max(1, opts.startupTimeoutMs ?? DEFAULT_WORKER_STARTUP_TIMEOUT_MS);
    this.createWorker = opts.createWorker ?? (() => new Worker(WORKER_FILE, { workerData: { root: this.root } }));
    this.spawnOne(); // one eager warm worker, ready for the first call
  }

  /** Pool size cap (for logging/status). */
  get size(): number { return this.maxSize; }

  /** Live worker count (for tests/status). */
  get liveWorkers(): number { return this.workers.size + this.retiringWorkers.size; }

  /**
   * False once the crash budget is exhausted (or after destroy). The ToolHandler
   * checks this and falls back to in-process dispatch — a broken worker platform
   * degrades to today's behavior instead of failing tool calls.
   */
  get healthy(): boolean {
    return !this.destroyed && this.totalCrashes < CRASH_BUDGET;
  }

  /**
   * True while at least one worker has completed its cold start (posted the
   * 'ready' handshake) and remains dispatchable. This is diagnostic state;
   * healthy callers enqueue through {@link run} even while workers are warming,
   * where startup and soft-timeout backstops bound the wait without moving a
   * CPU-heavy read back onto the daemon's event loop.
   */
  get ready(): boolean {
    return this.healthy && (this.idle.length > 0 || this.inflight.size > 0);
  }

  private spawnOne(): boolean {
    if (this.destroyed || this.liveWorkers >= this.maxSize) return false;
    let w: PoolWorker;
    try {
      w = this.createWorker();
    } catch {
      this.totalCrashes++; // counts toward the circuit breaker
      if (!this.healthy) this.openCircuit();
      else this.scheduleSpawnRetry();
      return false;
    }
    if (this.spawnRetryTimer) clearTimeout(this.spawnRetryTimer);
    this.spawnRetryTimer = null;
    this.spawnRetryDelayMs = INITIAL_SPAWN_RETRY_MS;
    this.workers.add(w);
    this.pendingWorkers.add(w);
    w.on('message', (m) => this.onMessage(w, (m ?? {}) as WorkerMessage));
    w.on('error', () => this.onWorkerGone(w));
    // Any exit removes capacity. A clean exit is only expected during destroy,
    // which clears `workers` before terminating and is ignored by the guard in
    // onWorkerGone.
    w.on('exit', () => this.onWorkerGone(w));
    const startupTimer = setTimeout(() => {
      if (this.startupTimers.get(w) !== startupTimer) return;
      this.startupTimers.delete(w);
      this.onWorkerGone(w);
    }, this.startupTimeoutMs);
    startupTimer.unref?.();
    this.startupTimers.set(w, startupTimer);
    return true;
  }

  private scheduleSpawnRetry(): void {
    const needsWarmWorker = this.liveWorkers === 0;
    if (this.destroyed || !this.healthy || (this.queue.length === 0 && !needsWarmWorker) || this.spawnRetryTimer) return;
    const delayMs = this.spawnRetryDelayMs;
    this.spawnRetryDelayMs = Math.min(delayMs * 2, MAX_SPAWN_RETRY_MS);
    this.spawnRetryTimer = setTimeout(() => {
      this.spawnRetryTimer = null;
      if (this.liveWorkers === 0) this.spawnOne();
      else this.drain();
    }, delayMs);
    this.spawnRetryTimer.unref?.();
  }

  private onMessage(w: PoolWorker, m: WorkerMessage): void {
    if (!m || !this.workers.has(w)) return;
    if (m.type === 'ready') {
      if (m.ok === false) {
        // A worker that could not open the index cannot safely serve jobs.
        // Remove it through the normal loss path so capacity is replaced.
        this.onWorkerGone(w);
        return;
      }
      this.clearStartupTimer(w);
      this.pendingWorkers.delete(w);
      this.idle.push(w);
      this.drain();
      return;
    }
    if (m.type === 'result') {
      const job = this.inflight.get(w);
      this.inflight.delete(w);
      this.idle.push(w);
      if (job) this.settle(job, m.result ?? busyGuidance(0));
      this.drain();
    }
  }

  // A worker was lost (error, exit, or failed initialization). Respawn a
  // replacement and retry its in-flight job once; a job that keeps crashing
  // workers fails gracefully so it can't loop the pool forever.
  private onWorkerGone(w: PoolWorker): void {
    if (!this.workers.has(w)) return; // already handled (error+exit both fire)
    this.clearStartupTimer(w);
    this.workers.delete(w);
    this.pendingWorkers.delete(w);
    this.idle = this.idle.filter((x) => x !== w);
    this.totalCrashes++;
    const job = this.inflight.get(w);
    this.inflight.delete(w);
    if (job && !job.settled) {
      if (!this.healthy) {
        this.rejectJob(job, new QueryPoolUnavailableError());
      } else if (job.retries < this.maxRetries) {
        job.retries++;
        this.queue.unshift(job); // head of line — retry promptly
      } else {
        this.settle(job, { isError: true, content: [{ type: 'text', text: 'codegraph worker crashed; please retry the call.' }] });
      }
    }
    if (!this.healthy) this.openCircuit();
    this.trackWorkerTermination(w, true);
    this.drain();
  }

  private drain(): void {
    // Grow toward maxSize while queued work outstrips workers that are idle OR
    // already on their way up (pending) — so we never spawn the whole pool for a
    // single call whose eager worker just hasn't reported ready yet.
    while (
      this.queue.length > this.idle.length + this.pendingWorkers.size &&
      this.liveWorkers < this.maxSize &&
      this.pendingWorkers.size < MAX_CONCURRENT_SPAWN &&
      !this.spawnRetryTimer &&
      this.healthy
    ) {
      if (!this.spawnOne()) break;
    }
    if (!this.healthy) {
      this.rejectQueuedWhenUnavailable();
      return;
    }
    while (this.idle.length && this.queue.length) {
      // Skip jobs the backstop already answered.
      let job: Job | undefined;
      while (this.queue.length && (job = this.queue.shift()) && job.settled) job = undefined;
      if (!job || job.settled) break;
      const w = this.idle.pop()!;
      this.inflight.set(w, job);
      try {
        w.postMessage({ type: 'call', id: job.id, toolName: job.toolName, args: job.args });
      } catch {
        this.onWorkerGone(w);
        return;
      }
    }
  }

  private openCircuit(): void {
    if (this.healthy || this.destroyed) return;
    if (this.spawnRetryTimer) clearTimeout(this.spawnRetryTimer);
    this.spawnRetryTimer = null;
    this.clearStartupTimers();
    const workers = [...this.workers];
    const jobs = new Set([...this.inflight.values(), ...this.queue]);
    this.workers.clear();
    this.pendingWorkers.clear();
    this.idle = [];
    this.inflight.clear();
    this.queue = [];
    for (const job of jobs) this.rejectJob(job, new QueryPoolUnavailableError());
    for (const worker of workers) this.trackWorkerTermination(worker, false);
  }

  private terminateWorker(worker: PoolWorker): Promise<boolean> {
    try {
      return Promise.resolve(worker.terminate()).then(() => true, () => false);
    } catch {
      return Promise.resolve(false);
    }
  }

  private unrefWorker(worker: PoolWorker): void {
    try { worker.unref?.(); } catch { /* best-effort process-liveness release */ }
  }

  private clearStartupTimer(worker: PoolWorker): void {
    const timer = this.startupTimers.get(worker);
    if (!timer) return;
    clearTimeout(timer);
    this.startupTimers.delete(worker);
  }

  private clearStartupTimers(): void {
    for (const timer of this.startupTimers.values()) clearTimeout(timer);
    this.startupTimers.clear();
  }

  /** Start termination and retain both its actual and bounded completion. */
  private terminateWorkerWithDeadline(worker: PoolWorker): WorkerTermination {
    const settled = this.terminateWorker(worker);
    const deadline = new Promise<boolean>((resolve) => {
      let finished = false;
      const finish = (terminated: boolean): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (!terminated) this.unrefWorker(worker);
        resolve(terminated);
      };
      const timer = setTimeout(() => finish(false), this.terminationTimeoutMs);
      timer.unref?.();
      void settled.then(finish);
    });
    return { settled, deadline };
  }

  private trackWorkerTermination(worker: PoolWorker, replaceCapacity: boolean): void {
    if (this.retiringWorkers.has(worker)) return;
    const termination = this.terminateWorkerWithDeadline(worker);
    this.retiringWorkers.set(worker, termination);
    void termination.deadline.then(async (terminated) => {
      if (this.retiringWorkers.get(worker) !== termination) return;
      if (!terminated) {
        // Decide failover before releasing the retiring slot. A rejected
        // terminate() may leave the old thread alive, so letting drain() see
        // free capacity first could briefly exceed the hard worker cap.
        this.totalCrashes = CRASH_BUDGET;
        this.openCircuit();
        this.drain();
        await termination.settled;
        if (this.retiringWorkers.get(worker) !== termination) return;
      }
      this.retiringWorkers.delete(worker);
      if (terminated && replaceCapacity && this.healthy) this.spawnOne();
      this.drain();
    });
  }

  private settle(job: Job, result: ToolResult): void {
    if (job.settled) return; // already answered (by backstop or worker)
    job.settled = true;
    if (job.softTimer) clearTimeout(job.softTimer);
    job.abortCleanup?.();
    job.resolve(result);
  }

  private removeQueuedJob(job: Job): void {
    const index = this.queue.indexOf(job);
    if (index >= 0) this.queue.splice(index, 1);
  }

  /**
   * A synchronous worker call cannot be interrupted in place. Once its caller
   * has abandoned the result, retire that worker so a hung call cannot consume
   * pool capacity forever. Intentional retirement is not a crash and therefore
   * does not spend the circuit-breaker budget.
   */
  private retireWorkerRunning(job: Job): void {
    let worker: PoolWorker | undefined;
    for (const [candidate, current] of this.inflight) {
      if (current === job) {
        worker = candidate;
        break;
      }
    }
    if (!worker) return;
    this.inflight.delete(worker);
    this.workers.delete(worker);
    this.pendingWorkers.delete(worker);
    this.idle = this.idle.filter((candidate) => candidate !== worker);
    this.trackWorkerTermination(worker, true);
  }

  private rejectJob(job: Job, error: Error): void {
    if (job.settled) return;
    job.settled = true;
    if (job.softTimer) clearTimeout(job.softTimer);
    job.abortCleanup?.();
    job.reject(error);
  }

  private rejectQueuedWhenUnavailable(): void {
    if (this.healthy || this.queue.length === 0) return;
    const queued = this.queue;
    this.queue = [];
    for (const job of queued) this.rejectJob(job, new QueryPoolUnavailableError());
  }

  private cancel(job: Job): void {
    if (job.settled) return;
    job.settled = true;
    if (job.softTimer) clearTimeout(job.softTimer);
    job.abortCleanup?.();
    this.removeQueuedJob(job);
    job.reject(new Error('Request aborted'));
    this.retireWorkerRunning(job);
    this.drain();
  }

  /** Run a read tool. Rejects on caller cancellation or when the circuit opens. */
  run(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    if (signal?.aborted) return Promise.reject(new Error('Request aborted'));
    if (!this.healthy) return Promise.reject(new QueryPoolUnavailableError());
    return new Promise<ToolResult>((resolve, reject) => {
      const job: Job = {
        id: this.nextId++, toolName, args, resolve, reject,
        retries: 0, settled: false, enqueuedAt: Date.now(),
      };
      // Don't let the caller wait past softTimeoutMs. The worker may still be
      // busy (we can't cancel synchronous CPU), but the CLIENT gets a prompt,
      // success-shaped "retry" instead of a hard timeout.
      job.softTimer = setTimeout(() => {
        if (!job.settled) {
          // Queued work no longer has a caller once the backstop responds. Drop
          // it immediately instead of retaining its arguments. An in-flight
          // synchronous call cannot be interrupted, so retire its worker after
          // settling the caller and replace that capacity without treating the
          // intentional retirement as a crash.
          this.removeQueuedJob(job);
          this.settle(job, busyGuidance(Date.now() - job.enqueuedAt));
          this.retireWorkerRunning(job);
          this.drain();
        }
      }, this.softTimeoutMs);
      job.softTimer.unref?.();
      if (signal) {
        const onAbort = (): void => this.cancel(job);
        signal.addEventListener('abort', onAbort, { once: true });
        job.abortCleanup = () => signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          this.cancel(job);
          return;
        }
      }
      this.queue.push(job);
      this.drain();
    });
  }

  /** Terminate all workers and answer any outstanding calls gracefully. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.spawnRetryTimer) clearTimeout(this.spawnRetryTimer);
    this.spawnRetryTimer = null;
    this.clearStartupTimers();
    const ws = [...this.workers];
    const retiring = [...this.retiringWorkers.entries()];
    for (const worker of [...ws, ...retiring.map(([worker]) => worker)]) {
      this.unrefWorker(worker);
    }
    this.workers.clear();
    this.retiringWorkers.clear();
    this.pendingWorkers.clear();
    this.idle = [];
    for (const job of [...this.inflight.values(), ...this.queue]) {
      this.settle(job, { isError: true, content: [{ type: 'text', text: 'codegraph is shutting down; retry shortly.' }] });
    }
    this.inflight.clear();
    this.queue = [];
    await Promise.all([
      ...ws.map((w) => this.terminateWorkerWithDeadline(w).deadline),
      ...retiring.map(([, termination]) => termination.deadline),
    ]);
  }
}
