/**
 * LocalProvider seam — SPEC-002 T014 (FR-008/010/010a/011/019b/019c).
 *
 * Hermetic: NO 22MB model download and NO real onnxruntime-web inference. The
 * provider's two true external seams are stubbed via constructor overrides
 * (mirroring `AcquireLocalModelOverrides` / `EndpointProviderOverrides`):
 *   - `createWorker` (the `parse-pool.ts` precedent) → a deterministic in-process
 *     fake worker that answers the `init`/`embed`/`shutdown` protocol without a
 *     `worker_threads` thread or an ONNX session;
 *   - `acquireLocalModel` → a fake returning verified (dummy) paths, so no cache
 *     dir is touched and no bytes are fetched.
 * The real end-to-end ONNX inference is validated LATER by the T028 self-repo
 * dogfood — this suite validates the provider LIFECYCLE and worker PROTOCOL:
 * static 384 dims, order preservation, once-per-pass session init (FR-010a), and
 * the FR-019b timeout / FR-019c redaction degrade paths.
 */
import { describe, it, expect } from 'vitest';
import { LocalProvider } from '../src/embeddings/local-provider';
import type { LocalEmbedWorker, LocalProviderOverrides } from '../src/embeddings/local-provider';
import type { EmbeddingLocalConfig } from '../src/embeddings/config';
import type { LocalModelArtifacts, LocalModelUnavailable } from '../src/embeddings/model-fetch';

const LOCAL_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

/** An `EmbeddingLocalConfig` with test-tuned batch/concurrency. */
function localConfig(extra: Partial<EmbeddingLocalConfig> = {}): EmbeddingLocalConfig {
  return { provider: 'local', model: LOCAL_MODEL_ID, dims: 384, batchSize: 16, concurrency: 4, ...extra };
}

/** Acquire override that always yields verified (dummy) paths — never read by the fake worker. */
const okAcquire = async (): Promise<LocalModelArtifacts | LocalModelUnavailable> => ({
  modelPath: '/fake/model_quantized.onnx',
  tokenizerPath: '/fake/tokenizer.json',
});

interface FakeWorkerOpts {
  /** Never answer `init` (simulates a wedged InferenceSession.create — the FR-019b hang). */
  hangInit?: boolean;
  /** Answer `init` with `init-error` (simulates a failed InferenceSession.create). */
  failInit?: boolean;
  /** Answer `embed` with `embed-error` (simulates an inference exception). */
  failEmbed?: boolean;
  /** Never answer `embed` (simulates a wedged session.run() — the inference-phase watchdog). */
  hangEmbed?: boolean;
  /** Exit CLEANLY (code 0) on `init` instead of replying (a worker that dies before ready). */
  exitCleanOnInit?: boolean;
  /** Reply to `embed` after a real timer (not a microtask), exposing any overlap window. */
  embedReplyDelayMs?: number;
}

/**
 * Deterministic in-process fake of the `LocalEmbedWorker` surface. Replies on a
 * microtask (as a real worker replies asynchronously, after the provider has
 * registered its pending handler). Each returned vector is a real `Float32Array(384)`
 * whose element 0 encodes the input's LENGTH and element 1 its position in the batch
 * — so a test can prove index i → vector i (order preservation) without real ONNX.
 */
class FakeWorker implements LocalEmbedWorker {
  initCount = 0;
  embedCount = 0;
  terminated = false;
  maxConcurrentEmbeds = 0; // peak overlapping embed messages — must stay 1 when serialized
  private inFlightEmbeds = 0;
  private readonly handlers: Record<string, Array<(arg: unknown) => void>> = {};

  constructor(private readonly opts: FakeWorkerOpts = {}) {}

  on(event: 'message' | 'error' | 'exit', cb: (arg: never) => void): void {
    (this.handlers[event] ??= []).push(cb as (arg: unknown) => void);
  }

  private emit(event: string, arg?: unknown): void {
    for (const cb of this.handlers[event] ?? []) cb(arg);
  }

  postMessage(msg: unknown): void {
    const m = msg as { type: string; id?: number; texts?: string[] };
    if (m.type === 'init') {
      this.initCount++;
      if (this.opts.exitCleanOnInit) { queueMicrotask(() => this.emit('exit', 0)); return; } // dies clean, no reply
      if (this.opts.hangInit) return; // never reply — the provider timeout must fire
      if (this.opts.failInit) {
        queueMicrotask(() => this.emit('message', { type: 'init-error', reason: 'onnx runtime failed to load the model' }));
        return;
      }
      queueMicrotask(() => this.emit('message', { type: 'ready' }));
    } else if (m.type === 'embed') {
      this.embedCount++;
      if (this.opts.hangEmbed) return; // never reply — the provider's embed watchdog must fire
      if (this.opts.failEmbed) {
        queueMicrotask(() => this.emit('message', { type: 'embed-error', id: m.id, reason: 'local embedding inference failed' }));
        return;
      }
      const vectors = (m.texts ?? []).map((t, k) => {
        const v = new Float32Array(384);
        v[0] = t.length;
        v[1] = k;
        return v;
      });
      // Track overlapping in-flight embeds: a serialized provider posts message N+1 only after
      // N's reply, so this peaks at 1; unserialized, two posts arrive before either replies.
      this.inFlightEmbeds++;
      this.maxConcurrentEmbeds = Math.max(this.maxConcurrentEmbeds, this.inFlightEmbeds);
      const reply = (): void => {
        this.inFlightEmbeds--;
        this.emit('message', { type: 'embed-result', id: m.id, vectors });
      };
      if (this.opts.embedReplyDelayMs) setTimeout(reply, this.opts.embedReplyDelayMs);
      else queueMicrotask(reply);
    } else if (m.type === 'shutdown') {
      queueMicrotask(() => this.emit('message', { type: 'shutdown-ack' }));
    }
  }

  terminate(): Promise<number> {
    this.terminated = true;
    queueMicrotask(() => this.emit('exit', 1)); // real Worker.terminate → exit code 1
    return Promise.resolve(0);
  }
}

/** Build a provider wired to `fake` with an OK acquire, plus any extra overrides. */
function providerWith(fake: FakeWorker, extra: Partial<LocalProviderOverrides> = {}): LocalProvider {
  return new LocalProvider(localConfig(), { acquireLocalModel: okAcquire, createWorker: () => fake, ...extra });
}

describe('LocalProvider (T014)', () => {
  it('reports dims === 384 statically, up front — never the 0 "unknown" sentinel', () => {
    const provider = providerWith(new FakeWorker());
    // Known before any embed() (no worker spawned, no acquire): the checkpoint's fixed width.
    expect(provider.dims).toBe(384);
    expect(provider.id).toBe(LOCAL_MODEL_ID);
  });

  it('embed() is order-preserving: one Float32Array(384) per input, index i → vector i (FR-011)', async () => {
    const provider = providerWith(new FakeWorker());
    const texts = ['export function alpha', 'fn bee', 'g']; // distinct lengths 21 / 6 / 1
    const vectors = await provider.embed(texts);

    expect(vectors).toHaveLength(3);
    for (const v of vectors) {
      expect(v).toBeInstanceOf(Float32Array);
      expect(v.length).toBe(384);
    }
    // Element 0 encodes each input's length in its ORIGINAL position → order preserved.
    expect(vectors[0]![0]).toBe(21);
    expect(vectors[1]![0]).toBe(6);
    expect(vectors[2]![0]).toBe(1);
    // Element 1 encodes the batch position — strictly increasing, no reshuffle.
    expect([vectors[0]![1], vectors[1]![1], vectors[2]![1]]).toEqual([0, 1, 2]);

    await provider.close();
  });

  it('initializes the session AT MOST ONCE per pass, reused across batches (FR-010a)', async () => {
    const fake = new FakeWorker();
    const provider = providerWith(fake);

    await provider.embed(['first batch a', 'first batch b']);
    await provider.embed(['second batch c']);
    await provider.embed(['third batch d']);

    // One worker, one init handshake — the ~215ms cold session load is paid once.
    expect(fake.initCount).toBe(1);
    expect(fake.embedCount).toBe(3);

    await provider.close();
  });

  it('close() terminates the worker', async () => {
    const fake = new FakeWorker();
    const provider = providerWith(fake);
    await provider.embed(['warm the worker']);
    await provider.close();
    expect(fake.terminated).toBe(true);
  });

  it('concurrent close() calls share ONE teardown — the second await resolves only after terminate() completes, not early', async () => {
    // A worker whose terminate() stays pending until we release the gate — modeling the real
    // Worker.terminate() Promise that only fulfills on the thread's 'exit'. This exposes the race:
    // the embed-timeout path fires `void this.close()` (call A, now awaiting terminate) while the
    // caller's finally `await`s close() (call B). Call B must await the SAME teardown, not read the
    // already-cleared this.worker and resolve before the thread has actually torn down.
    let releaseTerminate!: () => void;
    const terminateGate = new Promise<number>((resolve) => { releaseTerminate = () => resolve(0); });
    let terminateCalls = 0;
    const handlers: Record<string, Array<(a: unknown) => void>> = {};
    const emit = (event: string, arg?: unknown): void => { for (const cb of handlers[event] ?? []) cb(arg); };
    const worker: LocalEmbedWorker = {
      on(event: 'message' | 'error' | 'exit', cb: (a: never) => void): void {
        (handlers[event] ??= []).push(cb as (a: unknown) => void);
      },
      postMessage(msg: unknown): void {
        const m = msg as { type: string; id?: number; texts?: string[] };
        if (m.type === 'init') queueMicrotask(() => emit('message', { type: 'ready' }));
        else if (m.type === 'embed')
          queueMicrotask(() => emit('message', { type: 'embed-result', id: m.id, vectors: (m.texts ?? []).map(() => new Float32Array(384)) }));
      },
      terminate(): Promise<number> { terminateCalls++; return terminateGate; },
    };
    const provider = new LocalProvider(localConfig(), { acquireLocalModel: okAcquire, createWorker: () => worker });

    await provider.embed(['warm the worker']); // spawns + inits the worker so this.worker is set

    const first = provider.close();  // captures the worker, now awaiting terminate() (gate held)
    const second = provider.close(); // must await the SAME teardown, not short-circuit

    // Race `second` against a macrotask marker. terminateGate is still held, so a correctly-shared
    // teardown keeps `second` pending across the setTimeout(0) boundary → 'marker'. The pre-fix
    // early-return resolves `second` on a microtask, well before the macrotask → 'second-settled'.
    const winner = await Promise.race([
      second.then(() => 'second-settled'),
      new Promise<string>((r) => setTimeout(() => r('marker'), 0)),
    ]);
    expect(winner).toBe('marker');
    expect(terminateCalls).toBe(1); // one shared teardown — terminate() invoked exactly once

    releaseTerminate();
    await Promise.all([first, second]); // both resolve only now that the thread has "exited"
  });

  it('close() DURING init rejects the in-flight embed immediately, not after the init watchdog', async () => {
    const fake = new FakeWorker({ hangInit: true }); // init never replies
    const provider = providerWith(fake, { initTimeoutMs: 10_000 });
    const p = provider.embed(['x']);
    await new Promise((r) => setTimeout(r, 20)); // let embed reach initSession + set initReject
    await provider.close();
    // Rejects via close()→initReject, NOT the 10s watchdog. The 1s test timeout is the guard:
    // pre-fix, close() left init hanging and this test would fail by timeout.
    await expect(p).rejects.toThrow(/closed/i);
  }, 1000);

  it('close() DURING model acquisition rejects and never spawns a worker (no orphan worker)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = () => r(); });
    const acquire = async (): Promise<LocalModelArtifacts | LocalModelUnavailable> => {
      await gate; // hold acquisition open so close() lands mid-init
      return { modelPath: '/fake/m', tokenizerPath: '/fake/t' };
    };
    let spawned = 0;
    const fake = new FakeWorker();
    const provider = new LocalProvider(localConfig(), {
      acquireLocalModel: acquire,
      createWorker: () => { spawned++; return fake; },
    });

    const p = provider.embed(['x']); // suspends at the acquire gate
    await provider.close();          // close BEFORE acquisition resolves
    release();                       // acquisition resolves → post-acquire closed-check must fire
    await expect(p).rejects.toThrow(/closed/i);
    expect(spawned).toBe(0);         // no worker was ever created after close
  });

  it('close() ABORTS the in-flight acquisition and "closed" wins over the resulting unavailable', async () => {
    let entered!: () => void;
    const acquireEntered = new Promise<void>((r) => { entered = () => r(); });
    // Stays pending until its signal aborts (close), THEN returns unavailable — a slow download
    // that close() cancels. The abort is what unblocks it (no manual release); a 300ms fallback
    // keeps the pre-fix path (no signal passed) from hanging, so RED fails fast with the
    // unavailable message instead of a timeout.
    const acquire = (opts: { env: NodeJS.ProcessEnv; signal?: AbortSignal }): Promise<LocalModelArtifacts | LocalModelUnavailable> => {
      entered();
      // NB: these messages deliberately do NOT contain the word "closed", so the /closed/i
      // assertion below distinguishes a "closed" rejection from an "unavailable" one.
      return new Promise((resolve) => {
        const t = setTimeout(() => resolve({ unavailable: 'offline', message: 'model download stalled' }), 300);
        opts.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          resolve({ unavailable: 'offline', message: 'model download aborted' });
        });
      });
    };
    let spawned = 0;
    const provider = new LocalProvider(localConfig(), {
      acquireLocalModel: acquire as typeof import('../src/embeddings/model-fetch').acquireLocalModel,
      createWorker: () => { spawned++; return new FakeWorker(); },
    });

    const p = provider.embed(['x']);
    await acquireEntered;       // doInit is now blocked in `await acquire(signal)`
    await provider.close();     // aborts the signal → acquire resolves unavailable → closed wins

    await expect(p).rejects.toThrow(/closed/i); // NOT the unavailable message
    expect(spawned).toBe(0);
  }, 1000);

  it('serializes concurrent embed() calls — only one worker embed (session.run) is ever in flight, order preserved', async () => {
    const fake = new FakeWorker({ embedReplyDelayMs: 20 }); // real reply delay exposes overlap
    const provider = providerWith(fake);
    // Fire two WITHOUT awaiting the first — unserialized, both post before either replies,
    // overlapping session.run() on the single shared InferenceSession.
    const p1 = provider.embed(['a']);  // length 1
    const p2 = provider.embed(['bb']); // length 2
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fake.maxConcurrentEmbeds).toBe(1);        // never overlapped
    expect(r1[0]![0]).toBe(1);                        // order preserved: r1 ↔ ['a']
    expect(r2[0]![0]).toBe(2);                        //                  r2 ↔ ['bb']
    await provider.close();
  });

  it('close() drains the serialized embed queue — a queued embed rejects and never posts to the worker', async () => {
    const fake = new FakeWorker({ embedReplyDelayMs: 50 });
    const provider = providerWith(fake);
    const p1 = provider.embed(['a']); // starts init + posts the first embed
    const p2 = provider.embed(['b']); // queued behind p1
    p1.catch(() => {});               // p1 rejects on close; the assertion is on p2
    await new Promise((r) => setTimeout(r, 5)); // let p1 actually post its embed message
    await provider.close();
    await expect(p2).rejects.toThrow(/closed/i);
    expect(fake.embedCount).toBe(1);  // the queued second embed was never posted to the worker
  });

  it('a HANGING InferenceSession.create degrades to an advisory reject within the timeout — not a hang (FR-019b)', async () => {
    const fake = new FakeWorker({ hangInit: true });
    const provider = providerWith(fake, { initTimeoutMs: 60 });

    const started = Date.now();
    await expect(provider.embed(['anything'])).rejects.toThrow();
    const elapsed = Date.now() - started;

    // Rejected promptly (bounded by the timeout), NOT hung — proves the FR-019b wrap fired.
    expect(elapsed).toBeLessThan(2000);
    await provider.close();
  });

  it('a FAILED InferenceSession.create (init-error) rejects advisorily, reason free of any source text (FR-019c)', async () => {
    const fake = new FakeWorker({ failInit: true });
    const provider = providerWith(fake);

    // The reject is advisory: the provider rejects, runEmbeddingPass (not the provider)
    // decides the pass outcome. The reason names the failure, never the composed input.
    const SOURCE = 'export function TOP_SECRET_SYMBOL() { return 42; }';
    await expect(provider.embed([SOURCE])).rejects.toThrow(/onnx|model|local embedding/i);
    await expect(provider.embed([SOURCE])).rejects.not.toThrow(new RegExp('TOP_SECRET_SYMBOL'));
    await provider.close();
  });

  it('a CLEAN worker exit (code 0) before init replies rejects the pending op immediately — not after the watchdog', async () => {
    const fake = new FakeWorker({ exitCleanOnInit: true });
    // A long init timeout: the reject must come from the exit handler, NOT the watchdog.
    const provider = providerWith(fake, { initTimeoutMs: 60_000 });

    const started = Date.now();
    await expect(provider.embed(['anything'])).rejects.toThrow(/exited unexpectedly/);
    // Rejected promptly — proves a clean (code 0) premature exit fails fast, not after 60s.
    expect(Date.now() - started).toBeLessThan(2000);
    await provider.close();
  });

  it('an embed-time inference failure rejects with NO source echoed into the reason (FR-019c/FR-025a)', async () => {
    const fake = new FakeWorker({ failEmbed: true });
    const provider = providerWith(fake);

    const SECRET = 'const apiKey = "sk-do-not-leak-me-123";';
    let caught: unknown;
    try {
      await provider.embed([SECRET]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain('sk-do-not-leak-me-123');
    await provider.close();
  });

  it('a HANGING session.run() degrades to an advisory reject within the embed watchdog, not an indefinite stall, and tears down the worker', async () => {
    const fake = new FakeWorker({ hangEmbed: true });
    const provider = providerWith(fake, { embedTimeoutMs: 60 });

    const SOURCE = 'export function TOP_SECRET_WEDGED_SYMBOL() { return 1; }';
    const started = Date.now();
    let caught: unknown;
    try {
      await provider.embed([SOURCE]);
    } catch (err) {
      caught = err;
    }
    const elapsed = Date.now() - started;

    // Rejected promptly (bounded by the watchdog), NOT hung — the one unbounded
    // stall path once the session is warm (acquisition/init are already bounded).
    expect(elapsed).toBeLessThan(2000);
    expect(caught).toBeInstanceOf(Error);
    // The composed input (source text) is NEVER echoed into the reason (FR-019c).
    expect((caught as Error).message).not.toContain('TOP_SECRET_WEDGED_SYMBOL');
    // The stuck worker was torn down so a wedged session.run() can't linger.
    expect(fake.terminated).toBe(true);

    await provider.close();
  });

  it('an UNAVAILABLE model acquisition rejects advisorily with the acquire message (never throws synchronously)', async () => {
    const fake = new FakeWorker();
    const provider = new LocalProvider(localConfig(), {
      createWorker: () => fake,
      acquireLocalModel: async (): Promise<LocalModelUnavailable> => ({
        unavailable: 'offline',
        message: 'Local embedding model unavailable: could not download model_quantized.onnx.',
      }),
    });

    // Advisory: embed() returns a rejected promise; it does not throw synchronously and
    // never spawns the worker when acquisition fails.
    await expect(provider.embed(['x'])).rejects.toThrow(/unavailable/i);
    expect(fake.initCount).toBe(0);
    await provider.close();
  });
});
