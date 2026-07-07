/**
 * Local embedding worker — SPEC-002 T016 (FR-010/010b/019b).
 *
 * Runs the bundled `Xenova/all-MiniLM-L6-v2` ONNX model off the main thread
 * (the `parse-worker.ts` precedent) so a multi-minute embed pass never stalls
 * the daemon event loop or the file watcher (Constitution VI / FR-010). The
 * `parentPort` message protocol (contracts/local-provider.md §"Worker protocol"):
 *
 *   in  { type: 'init', modelPath, tokenizerPath }  out { type: 'ready' | 'init-error', reason? }
 *   in  { type: 'embed', id, texts }                out { type: 'embed-result' | 'embed-error', id, ... }
 *   in  { type: 'shutdown' }                        out { type: 'shutdown-ack' }
 *
 * `onnxruntime-web` is `require`d LAZILY inside `init` (never at module load), so
 * the ~heavy runtime is pulled only once a pass actually begins — matching
 * parse-worker's lazy-grammar shape and keeping the dormant path untouched. The
 * `require('onnxruntime-web')` resolves to ONNX Runtime's Node build with no
 * configuration (research.md OQ-1).
 */

import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import * as os from 'os';
import { createLocalTokenizer } from './local-tokenizer';
import type { TokenizerJson } from './local-tokenizer';

/** The ONNX Runtime module surface — value comes from `require`, types from the package. */
type OrtModule = typeof import('onnxruntime-web');
type OrtInferenceSession = import('onnxruntime-web').InferenceSession;

// Emscripten prints `Aborted()` (and a `-sASSERTIONS` diag line) straight to
// stderr when a WASM module aborts — before the JS catch runs. Worker stderr is
// inherited by the parent, so each abort would leak a noise line to the user's
// terminal even though the JS layer degrades cleanly. Filter those exact lines at
// the source (mirrors parse-worker.ts); everything we log ourselves is unaffected.
{
  const realWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void
  ): boolean => {
    const s = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    if (s.startsWith('Aborted(') || s.includes('Build with -sASSERTIONS for more info')) {
      if (typeof encoding === 'function') encoding();
      else if (cb) cb();
      return true;
    }
    return realWrite(chunk as never, encoding as never, cb as never);
  }) as typeof process.stderr.write;
}

/**
 * Wall-clock cap on `InferenceSession.create()` (FR-019b). A missing or corrupt
 * `.wasm`/model makes ONNX Runtime HANG rather than throw (research.md OQ-1), so
 * the session build is wrapped in this timeout — the hang becomes an `init-error`
 * the provider degrades from. An internal constant, NOT operator-tunable
 * (Constitution Principle II), same posture as model-fetch's download timeout.
 */
const SESSION_INIT_TIMEOUT_MS = 30_000;

let ort: OrtModule | undefined;
let session: OrtInferenceSession | undefined;
let encode: ((text: string) => ReturnType<ReturnType<typeof createLocalTokenizer>>) | undefined;

/** Reject `p` if it hasn't settled within `ms` — converts a hang into a thrown error. */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Bound the ONNX Runtime WASM thread pool to leave cores free for the main
 * thread + watcher (FR-010b) — ORT otherwise defaults to min(cores/2, 4) and can
 * starve the process running codegraph. Capped at 4: ORT WASM embedding doesn't
 * scale past ~4 threads, so a bare `cores - 1` would spawn dozens of threads on a
 * high-core box (e.g. 31 on a 32-core machine) and starve the daemon/watcher for
 * no throughput gain — leaving cores for the rest of codegraph matters more.
 */
function boundedThreadCount(): number {
  return Math.min(4, Math.max(1, os.cpus().length - 1));
}

async function init(modelPath: string, tokenizerPath: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ort = require('onnxruntime-web') as OrtModule;
  const threads = boundedThreadCount();
  ort.env.wasm.numThreads = threads;

  const tokenizerJson = JSON.parse(fs.readFileSync(tokenizerPath, 'utf-8')) as TokenizerJson;
  encode = createLocalTokenizer(tokenizerJson);

  session = await withTimeout(
    ort.InferenceSession.create(modelPath, { intraOpNumThreads: threads }),
    SESSION_INIT_TIMEOUT_MS,
    'local embedding model initialization timed out — the ONNX runtime failed to load (the model or its WebAssembly runtime may be missing or corrupt)',
  );
}

/**
 * Mean-pool the token embeddings over the attention mask, then L2-normalize —
 * the standard sentence-transformers pooling for all-MiniLM-L6-v2. `hiddenStates`
 * is the flattened `[1, seqLen, hidden]` `last_hidden_state`; masked ([PAD]) tokens
 * are excluded from the mean, and a zero-norm vector is left as zeros. Defensive:
 * `seqLen` is bounded against `attentionMask.length` so a hypothetical divergence
 * between the model's own output sequence length and the tokenizer's mask length
 * can never read out of bounds (never true for the pinned checkpoint, where they
 * are always equal — no behavior change there).
 */
function meanPoolAndNormalize(
  hiddenStates: Float32Array,
  attentionMask: BigInt64Array,
  seqLen: number,
  hidden: number,
): Float32Array {
  const pooled = new Float32Array(hidden);
  let maskSum = 0;
  const bound = Math.min(seqLen, attentionMask.length);
  for (let t = 0; t < bound; t++) {
    if (attentionMask[t] === 0n) continue;
    maskSum++;
    const base = t * hidden;
    for (let h = 0; h < hidden; h++) pooled[h]! += hiddenStates[base + h]!;
  }
  if (maskSum > 0) {
    for (let h = 0; h < hidden; h++) pooled[h]! /= maskSum;
  }
  let norm = 0;
  for (let h = 0; h < hidden; h++) norm += pooled[h]! * pooled[h]!;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let h = 0; h < hidden; h++) pooled[h]! /= norm;
  }
  return pooled;
}

/** One text → the pooled+normalized embedding vector. */
async function embedOne(text: string): Promise<Float32Array> {
  const enc = encode!(text);
  const seqLen = enc.inputIds.length;
  const Tensor = ort!.Tensor;
  const results = await session!.run({
    input_ids: new Tensor('int64', enc.inputIds, [1, seqLen]),
    attention_mask: new Tensor('int64', enc.attentionMask, [1, seqLen]),
    token_type_ids: new Tensor('int64', enc.tokenTypeIds, [1, seqLen]),
  });
  const output = results[session!.outputNames[0]!]!;
  const data = output.data as Float32Array; // [1, seq, hidden] float32
  // Defensive: read the sequence length + hidden size from the MODEL's own
  // output shape rather than assuming the tokenizer's seqLen — a hypothetical
  // shape divergence is then bounded by meanPoolAndNormalize above instead of
  // reading past either buffer. Equal to `seqLen` for the pinned checkpoint.
  const dims = output.dims;
  const outSeq = dims.length >= 2 ? dims[dims.length - 2]! : seqLen;
  const hidden = dims[dims.length - 1]!;
  return meanPoolAndNormalize(data, enc.attentionMask, outSeq, hidden);
}

/** Embed a batch sequentially (single-thread worker), preserving input order. */
async function embed(texts: string[]): Promise<Float32Array[]> {
  const vectors: Float32Array[] = [];
  for (const text of texts) vectors.push(await embedOne(text));
  return vectors;
}

interface WorkerMessage {
  type: string;
  id?: number;
  texts?: string[];
  modelPath?: string;
  tokenizerPath?: string;
}

parentPort!.on('message', async (msg: WorkerMessage) => {
  if (msg.type === 'init') {
    try {
      await init(msg.modelPath!, msg.tokenizerPath!);
      parentPort!.postMessage({ type: 'ready' });
    } catch (err) {
      // Model-load context only (paths/runtime) — never source text (FR-019c).
      parentPort!.postMessage({ type: 'init-error', reason: err instanceof Error ? err.message : String(err) });
    }
  } else if (msg.type === 'embed') {
    try {
      const vectors = await embed(msg.texts ?? []);
      parentPort!.postMessage({ type: 'embed-result', id: msg.id, vectors });
    } catch {
      // A fixed reason — the composed input (source text) is NEVER echoed (FR-019c/FR-025a).
      parentPort!.postMessage({ type: 'embed-error', id: msg.id, reason: 'local embedding inference failed' });
    }
  } else if (msg.type === 'shutdown') {
    parentPort!.postMessage({ type: 'shutdown-ack' });
  }
});
