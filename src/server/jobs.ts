/**
 * SPEC-005 Slice-2 re-index jobs (FR-020..FR-024/FR-026).
 *
 * Jobs run IN the serve process via the library's `sync()`/`indexAll()`
 * (FR-021), arbitrated against the daemon's file watcher by the existing
 * cross-process file lock. An in-memory latest-job-per-repo registry backs the
 * POST/GET routes and the SSE stream. Every in-job failure is CONTAINED as a
 * terminal `error` with a whitelisted `reason` — a job never crashes the serve
 * process, surfaces as a 5xx on the already-returned 202, or sticks in
 * `running` (FR-021). Lock contention retries briefly then terminates
 * `lock_unavailable` (FR-021a); a shutdown abort terminates `aborted` (FR-023).
 *
 * @module server/jobs
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Socket } from 'net';
import { pathToFileURL } from 'node:url';
import CodeGraph from '../index';
import type { IndexProgress, IndexResult, SyncResult } from '../extraction';
import { connectWithHello } from '../mcp/proxy';
import { getDaemonSocketCandidates } from '../mcp/daemon-paths';
import { SocketTransport } from '../mcp/transport';
import { findNearestCodeGraphRoot, getCodeGraphDir } from '../directory';

/** Incremental sync (default) or full rebuild (`?full=true`) — the result discriminator. */
export type JobMode = 'sync' | 'full';

/** Job lifecycle: created `running`; terminal `done` | `error` (no queued state). */
export type JobStatus = 'running' | 'done' | 'error';

/** Terminal `result` for `mode:"sync"` — SyncResult minus `changedFilePaths` (FR-015a whitelist). */
export interface SyncJobResult {
  filesChecked: number;
  filesAdded: number;
  filesModified: number;
  filesRemoved: number;
  nodesUpdated: number;
  durationMs: number;
}

/** Terminal `result` for `mode:"full"` — IndexResult minus `errors[]` (FR-015a whitelist). */
export interface FullJobResult {
  success: boolean;
  filesIndexed: number;
  filesSkipped: number;
  filesErrored: number;
  filesDiscovered?: number;
  nodesCreated: number;
  edgesCreated: number;
  durationMs: number;
}

export type JobResult = SyncJobResult | FullJobResult;

/** The job descriptor — POST 202 body, SSE snapshot/terminal, and latest-state read. */
export interface JobDescriptor {
  id: string;
  repo: string;
  mode: JobMode;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  reason?: string;
  result?: JobResult;
}

/** An SSE-facing job event (progress frame or the single terminal frame). */
export type JobEvent =
  | { type: 'progress'; progress: IndexProgress }
  | { type: 'terminal'; descriptor: JobDescriptor };

/** Injectable seams (production defaults are real; tests inject spies). */
export interface JobDeps {
  /** Open + run the index op under the file lock, forwarding progress. */
  runIndex?(
    root: string,
    mode: JobMode,
    onProgress: (p: IndexProgress) => void,
    signal: AbortSignal,
  ): Promise<SyncResult | IndexResult>;
  /** Whether the index file lock is held by a FOREIGN live process (contention). */
  isLockHeld?(root: string): boolean;
  /** Fire the watcher re-arm control message after lock release (best-effort). */
  rearmWatcher?(root: string, signal?: AbortSignal): void | Promise<void>;
  /** Bounded lock-retry window (ms). */
  lockRetryWindowMs?: number;
  /** Poll interval within the lock-retry window (ms). */
  lockRetryIntervalMs?: number;
  /**
   * Server-side diagnostic sink (F1). A CONTAINED in-job failure is whitelisted
   * to `index_failed` on the wire (FR-015a) — which hides the real fault from the
   * operator too. This logs the underlying exception (message + stack) locally so
   * an operator can diagnose it. NEVER carries a token/Authorization (it only
   * receives the caught exception, never request headers). Silent unless wired;
   * `runWebServerCli` defaults it to `console.error`.
   */
  logDiagnostic?(message: string): void;
}

/** A duplicate active job already tracked in this server's registry (→ 409, FR-022). */
export class JobConflictError extends Error {
  constructor() {
    super('a re-index job is already running for this repo');
    this.name = 'JobConflictError';
  }
}

/** Bounded lock-retry window (FR-021a target 2–3s) and its poll cadence. */
const DEFAULT_LOCK_RETRY_WINDOW_MS = 2_500;
const DEFAULT_LOCK_RETRY_INTERVAL_MS = 150;
/** Generous JSON-RPC timeouts for the (cold) daemon control round-trip. */
const REARM_TIMEOUT_MS = 15_000;

/**
 * The generic terminal reason for a CONTAINED in-job failure (FR-015a/021). A
 * fixed, whitelisted token — NEVER the raw exception text, message, or path
 * (which could leak an absolute filesystem path). `aborted` and
 * `lock_unavailable` are the other two documented reasons.
 */
const INDEX_FAILED_REASON = 'index_failed';

/**
 * A `sleep(ms)` that also resolves promptly when `signal` aborts (removing its
 * listener), so a shutdown abort during a lock-retry wait is observed at once
 * rather than only after the interval elapses (FR-023/026).
 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = (): void => { clearTimeout(t); resolve(); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Result whitelisting + contention detection.
// ---------------------------------------------------------------------------

/** Drop `changedFilePaths` / `errors[]` — the terminal result is the FR-015a whitelist. */
function whitelistResult(mode: JobMode, result: SyncResult | IndexResult): JobResult {
  if (mode === 'full') {
    const r = result as IndexResult;
    const out: FullJobResult = {
      success: r.success,
      filesIndexed: r.filesIndexed,
      filesSkipped: r.filesSkipped,
      filesErrored: r.filesErrored,
      nodesCreated: r.nodesCreated,
      edgesCreated: r.edgesCreated,
      durationMs: r.durationMs,
    };
    if (typeof r.filesDiscovered === 'number') out.filesDiscovered = r.filesDiscovered;
    return out; // errors[] dropped
  }
  const r = result as SyncResult;
  return {
    filesChecked: r.filesChecked,
    filesAdded: r.filesAdded,
    filesModified: r.filesModified,
    filesRemoved: r.filesRemoved,
    nodesUpdated: r.nodesUpdated,
    durationMs: r.durationMs,
  }; // changedFilePaths dropped
}

/**
 * Whether a library result is the lock-contention SENTINEL. The library returns
 * a sentinel instead of throwing: `indexAll()` a `{success:false, durationMs:0}`
 * with a lock error message; `sync()` an all-zero `{filesChecked:0,
 * durationMs:0}` shape. The sync zero-shape is ambiguous with a genuinely-empty
 * sync, so the caller disambiguates by re-probing the lock (see
 * {@link runWithLockRetry}).
 */
function isContentionSentinel(mode: JobMode, result: SyncResult | IndexResult): boolean {
  if (mode === 'full') {
    const r = result as IndexResult;
    return (
      r.success === false &&
      r.durationMs === 0 &&
      Array.isArray(r.errors) &&
      r.errors.some((e) => /lock/i.test(e?.message ?? ''))
    );
  }
  const r = result as SyncResult;
  return (
    r.filesChecked === 0 &&
    r.durationMs === 0 &&
    r.filesAdded === 0 &&
    r.filesModified === 0 &&
    r.filesRemoved === 0 &&
    r.nodesUpdated === 0
  );
}

/**
 * Default lock probe (FR-021a): is `.codegraph/codegraph.lock` held by a live
 * FOREIGN process? A lock file carrying OUR pid is re-entrant (not contention);
 * a missing/garbage file is free. This is the mode-agnostic PRIMARY contention
 * signal — it resolves the `sync()` zero-shape ambiguity by construction (a
 * genuinely-empty sync returns the zero-shape but leaves no foreign lock held).
 */
export function defaultIsLockHeld(root: string): boolean {
  let content: string;
  try {
    content = fs.readFileSync(path.join(getCodeGraphDir(root), 'codegraph.lock'), 'utf8').trim();
  } catch (err) {
    // ENOENT is the common, unambiguous "no lock file → free" case. Any OTHER
    // read failure (EACCES, EIO, EISDIR, …) means we cannot prove the lock is
    // free — treat it conservatively as HELD so a job never races an indexer we
    // simply failed to observe (FR-021a).
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
    return true;
  }
  const pid = parseInt(content, 10);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return false; // our own re-entrant hold — not contention
  try {
    process.kill(pid, 0);
    return true; // a live foreign holder → contention
  } catch (err) {
    // ESRCH → the pid is dead → the lock is stale/free. EPERM (or any other
    // error) means the process EXISTS but we cannot signal it — treat as HELD,
    // consistent with the read-failure branch above (never race an indexer we
    // simply failed to observe).
    return (err as NodeJS.ErrnoException)?.code !== 'ESRCH';
  }
}

/**
 * Default index runner (FR-021): open a `CodeGraph` in THIS serve process and
 * run the library op with the abort signal. The op acquires/releases the file
 * lock in its own `finally` (so the lock is released by the time this resolves,
 * before the job fires the watcher re-arm). Writes only — never a read (FR-002
 * governs reads, not this indexing path).
 */
async function defaultRunIndex(
  root: string,
  mode: JobMode,
  onProgress: (p: IndexProgress) => void,
  signal: AbortSignal,
): Promise<SyncResult | IndexResult> {
  const cg = await CodeGraph.open(root);
  try {
    return mode === 'full'
      ? await cg.indexAll({ onProgress, signal })
      : await cg.sync({ onProgress, signal });
  } finally {
    try {
      cg.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Run the index op with a bounded lock-retry window (FR-021a). Probes the lock
 * BEFORE each attempt (never running the op while a foreign holder has it), and
 * re-probes after a library contention sentinel to disambiguate a real race
 * from a genuinely-empty result. No queue: past the window, reports contention.
 */
async function runWithLockRetry(
  root: string,
  mode: JobMode,
  onProgress: (p: IndexProgress) => void,
  signal: AbortSignal,
  deps: JobDeps,
): Promise<{ result?: SyncResult | IndexResult; contended: boolean }> {
  const isLockHeld = deps.isLockHeld ?? defaultIsLockHeld;
  const runIndex = deps.runIndex ?? defaultRunIndex;
  const windowMs = deps.lockRetryWindowMs ?? DEFAULT_LOCK_RETRY_WINDOW_MS;
  const intervalMs = deps.lockRetryIntervalMs ?? DEFAULT_LOCK_RETRY_INTERVAL_MS;
  const deadline = Date.now() + windowMs;

  for (;;) {
    if (signal.aborted) return { contended: false }; // caller maps to `aborted`
    if (isLockHeld(root)) {
      if (Date.now() >= deadline) return { contended: true };
      await abortableSleep(intervalMs, signal);
      continue;
    }
    const result = await runIndex(root, mode, onProgress, signal);
    // Full mode's sentinel is UNAMBIGUOUS (the library result carries a lock error),
    // so trust it alone — a re-probe that raced the writer's release would wrongly
    // report the empty `success:false` result as `done`. Sync mode's all-zero
    // sentinel IS ambiguous with a genuinely-empty sync, so it still needs the
    // confirming lock re-probe.
    if (isContentionSentinel(mode, result) && (mode === 'full' || isLockHeld(root))) {
      // Race: a foreign writer took the lock between the probe and the acquire.
      if (Date.now() >= deadline) return { contended: true };
      await abortableSleep(intervalMs, signal);
      continue;
    }
    return { result, contended: false };
  }
}

// ---------------------------------------------------------------------------
// A single running re-index job.
// ---------------------------------------------------------------------------

/**
 * One re-index job — its lifecycle, progress fan-out, and terminal transition.
 * Created `running`; `run()` drives the op to a single terminal `done`/`error`.
 */
export class ReindexJob {
  readonly id: string;
  readonly mode: JobMode;
  private readonly repoId: string;
  private readonly root: string;
  private readonly deps: JobDeps;

  private status: JobStatus = 'running';
  private readonly startedAt = new Date().toISOString();
  private finishedAt: string | undefined;
  private reason: string | undefined;
  private result: JobResult | undefined;
  private latestProgressVal: IndexProgress | null = null;

  private readonly listeners = new Set<(evt: JobEvent) => void>();
  private readonly controller = new AbortController();
  private readonly settled = ((): { promise: Promise<void>; resolve: () => void } => {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => { resolve = res; });
    return { promise, resolve };
  })();

  constructor(repo: { id: string; root: string }, mode: JobMode, deps: JobDeps) {
    this.repoId = repo.id;
    this.root = repo.root;
    this.mode = mode;
    this.deps = deps;
    this.id = randomId();
  }

  /** A point-in-time snapshot of the job's state (POST body / SSE snapshot / GET). */
  descriptor(): JobDescriptor {
    const d: JobDescriptor = {
      id: this.id,
      repo: this.repoId,
      mode: this.mode,
      status: this.status,
      startedAt: this.startedAt,
    };
    if (this.finishedAt) d.finishedAt = this.finishedAt;
    if (this.reason) d.reason = this.reason;
    if (this.result) d.result = this.result;
    return d;
  }

  latestProgress(): IndexProgress | null {
    return this.latestProgressVal;
  }

  isTerminal(): boolean {
    return this.status !== 'running';
  }

  /** Subscribe to live `progress` + the single terminal event (SSE). Returns unsubscribe. */
  subscribe(listener: (evt: JobEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Trigger the AbortSignal (shutdown, FR-023/026). Terminal transition happens in `run()`. */
  abort(): void {
    this.controller.abort();
  }

  /** Resolves once run() is fully complete — terminal event emitted AND cleanup (the watcher re-arm) done; ordered shutdown (abortAll) waits on this. */
  whenSettled(): Promise<void> {
    return this.settled.promise;
  }

  /** Drive the op to a terminal outcome, then fire the watcher re-arm (best-effort). */
  async run(): Promise<void> {
    const onProgress = (p: IndexProgress): void => {
      this.latestProgressVal = p;
      this.emit({ type: 'progress', progress: p });
    };
    try {
      const outcome = await runWithLockRetry(this.root, this.mode, onProgress, this.controller.signal, this.deps);
      if (this.controller.signal.aborted) {
        this.finish('error', { reason: 'aborted' });
      } else if (outcome.contended) {
        this.finish('error', { reason: 'lock_unavailable' });
      } else {
        // A partial full index (success:false) is still `done` with the result —
        // recoverable by re-running (data-model). Contention was handled above.
        this.finish('done', { result: whitelistResult(this.mode, outcome.result as SyncResult | IndexResult) });
      }
    } catch (err) {
      // FR-021: contain every non-lock/non-abort failure as a terminal error.
      // The wire `reason` is the whitelisted `index_failed` (FR-015a) — log the
      // underlying cause server-side so the operator can still diagnose it (F1);
      // an abort is expected shutdown, not a fault, so it is not logged.
      if (!this.controller.signal.aborted) {
        try {
          this.deps.logDiagnostic?.(diagnosticLine('reindex job failed', err));
        } catch {
          /* a diagnostic sink must never block the terminal settlement below */
        }
      }
      this.finish('error', { reason: this.controller.signal.aborted ? 'aborted' : classifyReason(err) });
    } finally {
      // The op released the file lock in its own `finally`, so this fires AFTER
      // lock release. Gated on the daemon side (isDegraded), so a healthy
      // watcher is a cheap no-op (FR-021a). Best-effort — never fails the job.
      try {
        await this.deps.rearmWatcher?.(this.root, this.controller.signal);
      } catch {
        /* best-effort watcher restore */
      }
      // Only NOW is the run fully complete (terminal emitted + lock released +
      // re-arm attempted): resolve `settled` so ordered shutdown (abortAll) waits
      // for the re-arm to land, still bounded by index.ts close()'s grace race.
      this.settled.resolve();
    }
  }

  /**
   * Single, idempotent terminal transition: sets state and emits the terminal SSE
   * event. Does NOT resolve `settled` — that fires only after run()'s finally
   * completes (incl. the watcher re-arm), so ordered shutdown (abortAll) waits for
   * full cleanup, not merely the terminal emit; subscriber delivery is unchanged.
   */
  private finish(status: 'done' | 'error', opts: { reason?: string; result?: JobResult }): void {
    if (this.status !== 'running') return; // exactly one terminal event
    this.status = status;
    this.finishedAt = new Date().toISOString();
    if (opts.reason) this.reason = opts.reason;
    if (opts.result) this.result = opts.result;
    this.emit({ type: 'terminal', descriptor: this.descriptor() });
  }

  private emit(evt: JobEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(evt);
      } catch {
        /* a broken subscriber never stalls the job or the others (FR-023) */
      }
    }
  }
}

/** FR-015a: never leak the underlying fault — a fixed, whitelisted terminal reason. */
function classifyReason(_err: unknown): string {
  return INDEX_FAILED_REASON;
}

/**
 * Format a caught exception for the LOCAL diagnostic sink (F1): message + stack
 * only. Never touches request headers, so it can never carry a token — the
 * counterpart to the whitelisted wire reason (FR-015a).
 */
function diagnosticLine(where: string, err: unknown): string {
  const e = err instanceof Error ? err : new Error(String(err));
  return `[codegraph:web] ${where}: ${e.message}${e.stack ? `\n${e.stack}` : ''}`;
}

function randomId(): string {
  return randomUUID(); // crypto.randomUUID() (data-model).
}

// ---------------------------------------------------------------------------
// In-memory latest-job-per-repo registry (T034).
// ---------------------------------------------------------------------------

/**
 * The latest re-index job per repo (in memory, lost on restart — FR-024). Backs
 * the 409 single-active guard (FR-022), the SSE subscription, and the ordered
 * shutdown abort (FR-026).
 */
export class JobRegistry {
  private readonly jobs = new Map<string, ReindexJob>();
  // Every job whose run() has not FULLY settled (terminal emitted AND cleanup —
  // incl. the watcher re-arm — done). Tracked independently of `jobs` so ordered
  // shutdown (abortAll) still awaits a job that finished but whose re-arm is in
  // flight, or one already replaced in the latest-per-repo map by a newer job.
  private readonly inFlight = new Set<ReindexJob>();
  private readonly deps: JobDeps;

  constructor(deps: JobDeps = {}) {
    this.deps = deps;
  }

  /** Start a job for `repo`. Throws {@link JobConflictError} if one is already active. */
  start(repo: { id: string; root: string }, mode: JobMode): JobDescriptor {
    const existing = this.jobs.get(repo.id);
    if (existing && !existing.isTerminal()) throw new JobConflictError();
    const job = new ReindexJob(repo, mode, this.deps);
    this.jobs.set(repo.id, job); // latest-per-repo: replaces any prior terminal job
    this.inFlight.add(job);
    // fire-and-forget — run() contains every failure internally; drop from the
    // in-flight set only once run() has FULLY settled (cleanup complete).
    void job.run().finally(() => this.inFlight.delete(job));
    return job.descriptor();
  }

  /** The latest job descriptor for `repoId`, or null when none has run. */
  latest(repoId: string): JobDescriptor | null {
    return this.jobs.get(repoId)?.descriptor() ?? null;
  }

  /** The live job object for `repoId` (for SSE subscription), or null. */
  get(repoId: string): ReindexJob | null {
    return this.jobs.get(repoId) ?? null;
  }

  /**
   * Abort every running job and resolve once ALL in-flight jobs have FULLY
   * settled — including one that already emitted terminal but whose cleanup (the
   * watcher re-arm) is still running, and one already replaced in the map by a
   * newer job (FR-026). Bounded by index.ts close()'s grace race.
   */
  async abortAll(): Promise<void> {
    const jobs = [...this.inFlight];
    for (const j of jobs) if (!j.isTerminal()) j.abort();
    await Promise.all(jobs.map((j) => j.whenSettled()));
  }
}

// ---------------------------------------------------------------------------
// Watcher re-arm control message (T039, FR-021a).
// ---------------------------------------------------------------------------

/**
 * Send the additive `codegraph/rearm-watcher` control message over the per-repo
 * daemon socket (FR-021a). Best-effort: if the repo is not indexed or no daemon
 * is live, there is nothing to re-arm, so this is a quiet no-op. The daemon side
 * gates on `isWatcherDegraded()`, so this is cheap when the watcher is healthy.
 *
 * A short-lived socket rather than the read pool's client because the client
 * (daemon-client.ts, upstream-adjacent) speaks only `tools/call`/`codegraph/read`
 * — this is a distinct control method. Kept minimal and fully wrapped.
 */
export async function defaultRearmWatcher(root: string, signal?: AbortSignal): Promise<void> {
  // Re-arm MUST run even when the indexing signal is already aborted (a shutdown
  // abort): FR-021a requires the abort path — not just normal completion — to
  // restore the shared daemon watcher. The signal only makes an IN-FLIGHT re-arm
  // droppable (the abort listener below); it never SKIPS the re-arm. Bounded by
  // index.ts close()'s grace race so it can't defer shutdown indefinitely.
  let indexedRoot: string;
  try {
    const real = fs.realpathSync(root);
    const nearest = findNearestCodeGraphRoot(real);
    if (!nearest) return; // not indexed → no daemon → nothing to re-arm
    try {
      indexedRoot = fs.realpathSync(nearest);
    } catch {
      indexedRoot = nearest;
    }
  } catch {
    return;
  }

  let socket: Socket | null = null;
  for (const candidate of getDaemonSocketCandidates(indexedRoot)) {
    const s = await connectWithHello(candidate).catch(() => null);
    if (s && s !== 'version-mismatch') {
      socket = s;
      break;
    }
  }
  if (!socket) return; // no live daemon → its watcher cannot have been degraded by us

  const transport = new SocketTransport(socket, 'cg-web-rearm');
  // An abort during the initialize/rearm round-trip tears the socket down at once
  // (the transport.request REARM_TIMEOUT_MS is the backstop, not the fast path).
  signal?.addEventListener('abort', () => transport.stop(), { once: true });
  const rootUri = pathToFileURL(indexedRoot).href;
  transport.start(async (msg) => {
    const m = msg as { method?: string; id?: string | number };
    if (m.method === 'roots/list' && m.id !== undefined) {
      transport.sendResult(m.id, { roots: [{ uri: rootUri, name: path.basename(indexedRoot) }] });
    }
  });
  try {
    await transport.request(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'codegraph-web-rearm', version: '0.0.0' },
        rootUri,
      },
      REARM_TIMEOUT_MS,
    );
    await transport.request('codegraph/rearm-watcher', {}, REARM_TIMEOUT_MS);
  } finally {
    transport.stop();
  }
}
