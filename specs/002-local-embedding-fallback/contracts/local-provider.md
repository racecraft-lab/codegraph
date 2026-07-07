# Contract: LocalProvider ⇄ EmbeddingProvider seam

**Module**: `src/embeddings/local-provider.ts` | **Implements**: `EmbeddingProvider`
(`src/embeddings/provider.ts`) | **Spec**: FR-008, FR-009, FR-010, FR-011

The local provider is a drop-in `EmbeddingProvider`. `runEmbeddingPass` and
`maybeRunEmbeddingPass` depend only on the interface shape — never on the concrete class.

## Interface

```ts
class LocalProvider implements EmbeddingProvider {
  readonly id: string;    // == the checkpoint id, e.g. 'Xenova/all-MiniLM-L6-v2'
  readonly dims: 384;     // STATICALLY known up front — never the 0 "unknown" sentinel
  embed(texts: string[]): Promise<Float32Array[]>;
  close(): Promise<void>; // tear down the worker at end of pass
}
```

## Guarantees (relied on by the embed pass)

1. **Order-preserving**: `embed(texts)` resolves to exactly one `Float32Array` per input,
   index `i` → vector `i`. A short/long batch is a contract violation the pass already
   guards against (it aborts rather than misaligning vectors to symbols).
2. **Fixed dimension**: every returned vector has length `dims === 384`. Because the
   dimension is known from the checkpoint, `dims` is reported up front (not inferred), so
   `runEmbeddingPass` enforces 384 from the first batch with no abort.
3. **Normalized output**: each vector is **mean-pooled over tokens using the attention
   mask, then L2-normalized** (unit length). Post-processing detail is in the worker.
4. **Off-thread**: `embed()` marshals work to a `worker_threads` Worker (the
   `parse-worker.ts` precedent) so a multi-minute pass never stalls the daemon event loop
   or the file watcher (FR-010 / Constitution VI).

## Lifecycle

- **Lazy init on first `embed()`**: (a) acquire the model via `model-fetch`
  (`acquireLocalModel`), obtaining verified `modelPath` + `tokenizerPath`; (b) spawn the
  worker; (c) initialize the ONNX session **inside the worker**, wrapping
  `InferenceSession.create()` in a **timeout** (the missing/corrupt-`.wasm` hang gotcha —
  see research.md OQ-1). The session is created **once** (cold ≈215–250 ms) and reused for
  every batch (warmed ≈5–8 ms/text).
- **Failure is advisory, never thrown at the index**: if the model cannot be acquired
  (offline / checksum / unwritable cache) or session init times out, `embed()` rejects
  with a redacted, actionable reason. `runEmbeddingPass` catches it → `{ aborted: true,
  abortReason }`; the structural index/sync completes regardless (FR-019 / FR-007). No
  source text or composed input is echoed into the reason (mirrors FR-019c).
- **`close()`** terminates the worker at end of pass.

## Worker protocol (internal — `src/embeddings/local-embed-worker.ts`)

`parse-worker.ts`-shaped `parentPort` message handler:

| message in | action | message out |
|---|---|---|
| `{ type: 'init', modelPath, tokenizerPath }` | timeout-wrapped `InferenceSession.create(modelPath)`; load tokenizer vocab | `{ type: 'ready' }` or `{ type: 'init-error', reason }` |
| `{ type: 'embed', id, texts }` | per text: tokenize → 3 int64 tensors → `session.run` → mean-pool(attention_mask) → L2-normalize → `Float32Array(384)` | `{ type: 'embed-result', id, vectors }` or `{ type: 'embed-error', id, reason }` |
| `{ type: 'shutdown' }` | — | `{ type: 'shutdown-ack' }` |

The tokenizer (`src/embeddings/local-tokenizer.ts`) is a **pure module** imported by the
worker: `encode(text) → { inputIds, attentionMask, tokenTypeIds }` as `BigInt64Array`s of
shape `[1, seqLen]` (`[CLS]`/`[SEP]`, truncation, attention mask, all-zero token-type ids).
It is unit-testable without loading ONNX.
