/**
 * LocalProvider — the bundled-model `EmbeddingProvider` (SPEC-002, T017).
 *
 * A drop-in `EmbeddingProvider` (contract: contracts/local-provider.md) that
 * embeds locally with no network: it acquires the pinned checkpoint via
 * `model-fetch`, spawns the `local-embed-worker.ts` `worker_threads` Worker (the
 * `parse-pool.ts` precedent), initializes the ONNX session ONCE per pass
 * (FR-010a), and marshals each `embed()` batch to the worker, reassembling
 * vectors in input order (FR-011).
 *
 * Failure is ADVISORY, never thrown at the index (FR-008/019): an unacquirable
 * model, a session-init timeout, or a worker crash makes `embed()` REJECT with a
 * redacted, actionable reason — `runEmbeddingPass` catches it as
 * `{ aborted, abortReason }` and the structural index/sync completes regardless.
 * No source text or composed input is ever echoed into a reason (FR-019c/FR-025a).
 */
import * as path from 'path';
import { Worker } from 'worker_threads';
import type { EmbeddingProvider } from './provider';
import type { EmbeddingLocalConfig } from './config';
import { acquireLocalModel } from './model-fetch';

/** The pinned checkpoint's fixed embedding width — known up front, never inferred (FR-011). */
const LOCAL_DIMS = 384;

/**
 * Provider-level backstop on the init handshake. The worker's OWN
 * `InferenceSession.create()` timeout (FR-019b, ~30s) is the primary degrade path
 * and fires first with a precise reason; this only catches a worker that dies or
 * never answers `init` at all, so it sits just above the worker's internal cap.
 */
const DEFAULT_INIT_TIMEOUT_MS = 45_000;

/**
 * Wall-clock watchdog on a single provider→worker `embed()` round-trip — the ONE
 * unbounded stall path once the session is warm (acquisition and init are both
 * already bounded above). A hung `session.run()` in the worker would otherwise
 * leave this promise — and therefore `runEmbeddingPass` — pending forever,
 * holding the index lock indefinitely. Generous (real inference is far faster)
 * and an internal constant, NOT operator-tunable (Principle II), same posture as
 * the init timeouts above.
 */
const DEFAULT_EMBED_TIMEOUT_MS = 120_000;

/**
 * Minimal `worker_threads` Worker surface the provider drives — abstracted (as
 * `ParsePoolWorker` is) so tests inject a fake worker and exercise the provider's
 * init/embed/close protocol without spawning a thread or loading ONNX.
 */
export interface LocalEmbedWorker {
  postMessage(msg: unknown): void;
  terminate(): Promise<number> | void;
  on(event: 'message', cb: (m: unknown) => void): void;
  on(event: 'error', cb: (e: Error) => void): void;
  on(event: 'exit', cb: (code: number) => void): void;
}

/**
 * Test-only knobs so the provider runs hermetically — no 22MB download, no
 * `worker_threads` thread, no ONNX. Production constructs the provider with none
 * of these; every field defaults to real behavior. Same trust posture as
 * `AcquireLocalModelOverrides` / `EndpointProviderOverrides`.
 */
export interface LocalProviderOverrides {
  /** Injected model acquisition. Defaults to the real `acquireLocalModel`. */
  acquireLocalModel?: typeof acquireLocalModel;
  /** Worker factory (tests inject a fake). Defaults to a real `local-embed-worker.js` Worker. */
  createWorker?: () => LocalEmbedWorker;
  /** Init-handshake backstop timeout (ms). Defaults to DEFAULT_INIT_TIMEOUT_MS. */
  initTimeoutMs?: number;
  /** Per-`embed()`-round-trip watchdog (ms). Defaults to DEFAULT_EMBED_TIMEOUT_MS. */
  embedTimeoutMs?: number;
}

interface PendingEmbed {
  resolve: (vectors: Float32Array[]) => void;
  reject: (err: Error) => void;
}

/** Worker → provider message shape (loosely typed — the worker is the contract). */
interface WorkerReply {
  type?: string;
  id?: number;
  reason?: string;
  vectors?: Array<Float32Array | number[]>;
}

export class LocalProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dims: number = LOCAL_DIMS;

  private readonly acquire: typeof acquireLocalModel;
  private readonly createWorker: () => LocalEmbedWorker;
  private readonly initTimeoutMs: number;
  private readonly embedTimeoutMs: number;
  private readonly onModelProgress?: (message: string) => void;

  /** Memoized so the ONNX session is initialized AT MOST ONCE per pass (FR-010a). */
  private initPromise?: Promise<void>;
  private worker?: LocalEmbedWorker;
  private closed = false;
  /**
   * Single-flight teardown, memoized so concurrent/repeat close() calls all share ONE
   * worker.terminate() and every caller's await resolves only AFTER it completes. Without
   * this, the embed-timeout path's fire-and-forget `void this.close()` (runEmbed) clears
   * this.worker before its terminate() settles, so the caller's `await close()` in its
   * finally reads worker===undefined and resolves early — before the thread has torn down.
   */
  private closePromise?: Promise<void>;
  /** Aborted by close() so an in-flight model acquisition (download) is cancelled promptly. */
  private readonly acquireAbort = new AbortController();
  private nextId = 1;
  private readonly pending = new Map<number, PendingEmbed>();

  /**
   * Serializes embed() round-trips so only ONE worker `embed` message — hence one
   * session.run() — is ever in flight. The worker's async message handler does not queue,
   * so two overlapping embed() calls would otherwise interleave session.run() on the single
   * shared InferenceSession. The sole current caller awaits each embed() serially, so this is
   * defensive: EmbeddingProvider is the SPEC-002/003 seam and EndpointProvider IS
   * concurrency-safe (bounded pool), so a caller safely fanning concurrent embed() at an
   * endpoint must not corrupt a LocalProvider's one WASM session. The tail `.catch(() => {})`
   * only advances the chain past a failed/timed-out batch; `return run` still delivers the
   * real rejection to the caller.
   */
  private embedChain: Promise<unknown> = Promise.resolve();

  /** Set when the init handshake is in flight; cleared on ready/init-error/timeout. */
  private initResolve?: () => void;
  private initReject?: (err: Error) => void;

  /** A fatal worker error/exit latches here so later embeds fail fast instead of hanging. */
  private workerFailure?: Error;

  constructor(
    config: EmbeddingLocalConfig,
    overrides: LocalProviderOverrides = {},
    onModelProgress?: (message: string) => void,
  ) {
    this.id = config.model;
    this.acquire = overrides.acquireLocalModel ?? acquireLocalModel;
    this.initTimeoutMs = overrides.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    this.embedTimeoutMs = overrides.embedTimeoutMs ?? DEFAULT_EMBED_TIMEOUT_MS;
    this.onModelProgress = onModelProgress;
    if (overrides.createWorker) {
      this.createWorker = overrides.createWorker;
    } else {
      // The COMPILED worker sits beside this module: dist/embeddings/local-embed-worker.js
      // at runtime (__dirname === dist/embeddings). Mirrors the parse pool's path.
      const scriptPath = path.join(__dirname, 'local-embed-worker.js');
      this.createWorker = () => new Worker(scriptPath) as unknown as LocalEmbedWorker;
    }
  }

  /**
   * Embed a batch, preserving order (FR-011). Lazily acquires the model + spawns
   * the worker + initializes the session on the first call, then reuses that one
   * session for every subsequent batch. Rejects (advisory) on any acquisition,
   * init, or inference failure — never throws synchronously.
   */
  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.closed) throw new Error('local embedding provider is closed');
    if (texts.length === 0) return [];
    // Chain through embedChain so init+inference run one-at-a-time (see the field doc). The
    // re-check of `closed` inside the step (plus the workerFailure/worker-undefined guards in
    // runEmbed and onWorkerGone clearing pending) makes a queued item fast-reject after close
    // without ever posting to a terminated worker — no explicit queue-drain needed.
    const run = this.embedChain.then(async () => {
      if (this.closed) throw new Error('local embedding provider is closed');
      await this.ensureInit();
      return this.runEmbed(texts);
    });
    this.embedChain = run.catch(() => {});
    return run;
  }

  /**
   * Tear down the worker at end of pass. Idempotent AND single-flight: concurrent or
   * repeat calls all share one teardown promise (see `closePromise`), so every caller's
   * await resolves only after the single worker.terminate() actually completes. Safe
   * before init. `doClose` runs synchronously up to its first await, so `closed` and the
   * pending-rejection side effects still land synchronously on the first call.
   */
  close(): Promise<void> {
    return (this.closePromise ??= this.doClose());
  }

  private async doClose(): Promise<void> {
    this.closed = true;
    // Cancel an in-flight model acquisition (download) so close() is prompt + terminal: the
    // pending embed()'s doInit unblocks immediately instead of waiting out the download budget,
    // and the closed-check in doInit makes "closed" win over the resulting unavailable.
    this.acquireAbort.abort();
    // Reject any in-flight init immediately rather than letting it wait out the init watchdog
    // (~45s). finish() clears the timer + nulls the handlers, so this is a no-op once init has
    // already settled, and it runs BEFORE the worker terminate() below (whose exit event
    // onWorkerGone then ignores because we are closed).
    this.initReject?.(new Error('local embedding provider was closed during initialization'));
    const worker = this.worker;
    this.worker = undefined;
    for (const [, pending] of this.pending) {
      pending.reject(new Error('local embedding provider was closed before the batch completed'));
    }
    this.pending.clear();
    if (!worker) return;
    try {
      await Promise.resolve(worker.terminate());
    } catch {
      /* already gone */
    }
  }

  private ensureInit(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    // (a) Acquire the verified model + tokenizer. Never throws — an unavailable
    //     result is a typed, actionable, source-free message we reject with (FR-008/019).
    // "acquiring" — not "downloading": acquireLocalModel is a cache hit on repeat
    // runs, so a "downloading" verb would falsely imply a re-download every pass.
    this.onModelProgress?.('acquiring embedding model…');
    const acquired = await this.acquire({ env: process.env, signal: this.acquireAbort.signal });
    // close() may have run (and aborted acquisition) during the await above. Check it FIRST so
    // "closed" wins over any unavailable result once shutdown has begun, and no worker is ever
    // spawned after close (makes close() terminal, avoids an orphan worker the caller can't reach).
    if (this.closed) throw new Error('local embedding provider was closed during initialization');
    if ('unavailable' in acquired) {
      throw new Error(acquired.message);
    }

    // (b) Spawn the worker and (c) initialize the session ONCE, timeout-wrapped.
    this.onModelProgress?.('loading embedding model…');
    const worker = this.createWorker();
    this.worker = worker;
    worker.on('message', (m) => this.onMessage(m as WorkerReply));
    worker.on('error', (e) =>
      this.onWorkerGone(new Error(`local embedding worker error: ${e instanceof Error ? e.message : 'unknown'}`)),
    );
    worker.on('exit', (code) => {
      // ANY exit before close() is unexpected — even a clean code 0 (e.g. the worker exiting
      // before it replies to init/embed) must fail the pending op immediately, not hang until
      // the watchdog and needlessly hold the index lock. onWorkerGone() is a no-op once close()
      // has run (an expected terminate()), so only genuine premature exits reject.
      this.onWorkerGone(new Error(`local embedding worker exited unexpectedly (code ${code})`));
    });

    await this.initSession(worker, acquired.modelPath, acquired.tokenizerPath);
  }

  private initSession(worker: LocalEmbedWorker, modelPath: string, tokenizerPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.initResolve = undefined;
        this.initReject = undefined;
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(
        () => finish(new Error('local embedding model initialization timed out')),
        this.initTimeoutMs,
      );
      timer.unref?.();
      this.initResolve = () => finish();
      this.initReject = (err: Error) => finish(err);
      // Last statement, intentionally unguarded: for this structured-cloneable payload
      // postMessage cannot throw (DataCloneError applies only to non-cloneable values, and
      // post-to-a-closed-port is a silent drop per the MessagePort spec), and a worker that
      // dies here is caught by the 'exit'/'error' handlers (onWorkerGone) plus the unref'd
      // init timer — both settle init via finish(). A try/catch here would be dead code.
      worker.postMessage({ type: 'init', modelPath, tokenizerPath });
    });
  }

  /**
   * A hung `session.run()` (e.g. a wedged WASM runtime) would otherwise leave this
   * promise pending forever — this is the ONE unbounded stall path once the
   * session is warm (acquisition and init are already bounded). On timeout: reject
   * advisorily with a fixed, source-free reason (FR-019c) and terminate the
   * worker via `close()` so the stuck inference can't linger into later batches.
   */
  private runEmbed(texts: string[]): Promise<Float32Array[]> {
    if (this.workerFailure) return Promise.reject(this.workerFailure);
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('local embedding worker is not available'));
    const id = this.nextId++;
    return new Promise<Float32Array[]>((resolve, reject) => {
      let settled = false;
      const finish = (err: Error | undefined, vectors?: Float32Array[]): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pending.delete(id);
        if (err) reject(err);
        else resolve(vectors!);
      };
      const timer = setTimeout(() => {
        finish(new Error('local embedding inference timed out'));
        void this.close();
      }, this.embedTimeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (vectors) => finish(undefined, vectors),
        reject: (err) => finish(err),
      });
      // Unguarded by design (see doInit): postMessage can't throw for this cloneable payload,
      // and worker death is handled by onWorkerGone + the unref'd embed timer — both route
      // through finish(), clearing this pending entry. A try/catch would be dead code.
      worker.postMessage({ type: 'embed', id, texts });
    });
  }

  private onMessage(m: WorkerReply): void {
    switch (m.type) {
      case 'ready':
        this.initResolve?.();
        return;
      case 'init-error':
        this.initReject?.(new Error(typeof m.reason === 'string' ? m.reason : 'local embedding model initialization failed'));
        return;
      case 'embed-result': {
        if (m.id === undefined) return;
        const pending = this.pending.get(m.id);
        if (!pending) return;
        this.pending.delete(m.id);
        const vectors = (m.vectors ?? []).map((v) => (v instanceof Float32Array ? v : Float32Array.from(v)));
        pending.resolve(vectors);
        return;
      }
      case 'embed-error': {
        if (m.id === undefined) return;
        const pending = this.pending.get(m.id);
        if (!pending) return;
        this.pending.delete(m.id);
        pending.reject(new Error(typeof m.reason === 'string' ? m.reason : 'local embedding inference failed'));
        return;
      }
      default:
        return; // shutdown-ack and any unknown message are ignored
    }
  }

  /** A worker died mid-flight (crash/exit). Fail init and every pending embed, then latch. */
  private onWorkerGone(err: Error): void {
    if (this.closed) return; // an expected terminate() during close()
    this.workerFailure = err;
    this.initReject?.(err);
    for (const [, pending] of this.pending) pending.reject(err);
    this.pending.clear();
  }
}
