# Research: Bundled Local Embedding Fallback (SPEC-002)

**Branch**: `002-local-embedding-fallback` | **Date**: 2026-07-05 | **Spec**: [spec.md](./spec.md)

This document consolidates the plan-phase research. The three design-concept Open
Questions (runtime, checkpoint, worker) were resolved during the autopilot Clarify
sessions and then **empirically validated by a parallel spike**; the spike evidence
below supersedes any earlier `wasmPaths`-based guesswork. No clarification
markers remain.

---

## OQ-1 — WASM runtime library → `onnxruntime-web` (MIT, pure-WASM)

- **Decision**: Use `onnxruntime-web@1.27.0` as the sole inference runtime. CodeGraph
  owns a minimal BERT WordPiece tokenizer (there is no batteries-included pipeline).
- **Rationale**: pure-JS/WASM with **no native addon** — satisfies FR-011 and
  Constitution Principle VII. License **MIT** (permissive; fork license hygiene OK).
- **Alternative rejected — `@huggingface/transformers` (transformers.js)**: MEASURED to
  **hard-depend on native `onnxruntime-node`** and to select it as the **default engine
  when required from Node**. That is a native addon, violating FR-011 / Principle VII.
  The cost of rejecting it is that CodeGraph must own the tokenizer + pooling that the
  pipeline would otherwise provide (~150 LOC), which pushes the reviewable-LOC budget
  past the spec's original ~310/~380 projection (recorded honestly in plan.md).

### Spike evidence (runtime, verbatim)

- `require('onnxruntime-web')` in Node resolves via the package **`node` export
  condition** to `dist/ort.node.min.js` — a Node-tuned WASM backend, **no bundler /
  webpack required**.
- **VERDICT: PASS on all three probes** — the module (a) loads on the Node main thread,
  (b) produces 384-dim output, and (c) runs **inside a `worker_threads` Worker** — all
  with **ZERO manual config** (no `wasmPaths`, no `numThreads`). After
  `InferenceSession.create()`, `ort.env.wasm` auto-populates to
  `{ initTimeout: 0, proxy: false, trace: false, numThreads: 4 }`.
- **CRITICAL gotcha → hard implementation requirement**: a **missing/corrupt `.wasm`
  makes `InferenceSession.create()` HANG INDEFINITELY (it never rejects)**. The
  implementation MUST wrap `create()` in a timeout, or FR-019's "model unavailable →
  skip with an actionable message" would hang the index instead of degrading it.
  Recorded as a design constraint and an early Implement task.
- **Timing**: cold `create()` ≈ **215–250 ms** (one-time model+WASM load, paid once per
  worker/process — NOT per symbol); warmed inference ≈ **5–8 ms per short text**
  (single-digit ms/symbol). This is why the session is created once and the worker is
  reused across the whole pass.

---

## OQ-2 — Checkpoint → `Xenova/all-MiniLM-L6-v2` (384-dim, Apache-2.0)

- **Decision**: `Xenova/all-MiniLM-L6-v2`, quantized ONNX file `onnx/model_quantized.onnx`.
  General-purpose small baseline (MiniLM-L6 class), **384 dimensions**, license
  **Apache-2.0** (permissive). Local is a functional baseline producer of vectors;
  retrieval quality is owned by SPEC-003.
- **Immutable pin (trust anchor)**: HF repo commit SHA
  `751bff37182d3f1213fa05d7196b954e230abad9`. The default download URLs are
  commit-pinned:
  - `https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/751bff37182d3f1213fa05d7196b954e230abad9/onnx/model_quantized.onnx`
  - `https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/751bff37182d3f1213fa05d7196b954e230abad9/tokenizer.json`
  `CODEGRAPH_MODEL_BASE_URL` overrides the **base** (the repo-relative path + filename
  are appended); the pinned SHA-256 verification applies to bytes from any source.
- **Pinned artifacts + checksums** (verified during the spike):
  | Artifact | Bytes | SHA-256 |
  |---|---|---|
  | `onnx/model_quantized.onnx` | 22,972,370 | `afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1` |
  | `tokenizer.json` | 711,661 | *(pin at implement time from the same commit — vocab is embedded in this file)* |
  - **Blocking Implement gate**: the `tokenizer.json` SHA-256 MUST be computed from the real
    bytes fetched at commit `751bff37182d3f1213fa05d7196b954e230abad9` and pinned in source
    before the local provider ships — FR-013's "each downloaded artifact" verification
    requirement has no trust anchor for the tokenizer until this digest is recorded.
- **Model IO (real, observed)**:
  - **Inputs**: `input_ids`, `attention_mask`, `token_type_ids` — all **int64
    (`BigInt64Array`), shape `[1, seqLen]`**.
  - **Output**: `last_hidden_state` — **float32, shape `[1, seqLen, 384]`**.
  - **Post-processing (owned by the provider/worker)**: **mean-pool over tokens using
    `attention_mask`, then L2-normalize** → the 384-dim sentence vector. Because the
    dimension is fixed by the checkpoint, `EmbeddingProvider.dims = 384` is **statically
    known up front** (never the `0` "not yet known" sentinel).
  - This IO shape is exactly why CodeGraph owns a **BERT WordPiece tokenizer**: it must
    turn text into those three int64 tensors (`[CLS]`/`[SEP]`/`[PAD]`, attention mask,
    all-zero token-type ids).
- **Rationale**: small (≈22 MB quantized), fast on CPU, permissively licensed, abundant
  and stable ONNX build; "good enough" vectors are the bar for a fallback.
- **Alternative rejected**: code-specific small models with proven permissive ONNX/WASM
  builds are scarce; a general-purpose small model is the pragmatic, dormancy-safe choice.

---

## OQ-3 — Worker wiring → off-thread inside `LocalProvider.embed()`

- **Decision**: Off-thread inference lives **inside `LocalProvider.embed()`**, mirroring
  the `src/extraction/parse-worker.ts` + `parse-pool.ts` precedent. `runEmbeddingPass`
  already `await`s `provider.embed()`, so a long WASM pass never stalls the daemon event
  loop or the file watcher (Constitution VI / FR-010). Progress rides SPEC-001's existing
  `onProgress` hook.
- **Rationale + evidence**: the spike (OQ-1) proved `onnxruntime-web` initializes and
  runs cleanly inside a `worker_threads` Worker with zero manual config — the residual
  technical risk flagged at Clarify is **closed (PASS)**. The session is created once per
  worker (cold ≈215–250 ms) and reused, so the per-symbol cost is single-digit ms.
- **Threading model**: one long-lived worker for the pass (the model+session load is the
  expensive part; a pool is unnecessary because the pass is already batched by
  `batchSize × concurrency` super-chunks upstream). The worker is a normal `.ts` module
  compiled by `tsc` to `dist/embeddings/local-embed-worker.js` and spawned by path (same
  as `parse-worker.js`).

---

## Dependency facts (inputs to `BUNDLING.md` / FR-024)

Gathered from the npm registry (read-only) for `onnxruntime-web@1.27.0`:

- **Version**: 1.27.0 · **License**: MIT
- **Unpacked size in `node_modules`**: **≈131 MB** (ships web + node + all 7 `.wasm`
  variants). This is the honest footprint the runtime dependency adds; the packed tarball
  is smaller, and **model weights are NOT bundled** (lazy download, FR-012). This size
  MUST be documented in `BUNDLING.md` per FR-024. It does not violate FR-024's
  "MUST NOT meaningfully grow the npm payload" for CodeGraph's *published* package because
  the weights (the large, variable cost) are lazy-downloaded, not shipped — but the added
  transitive `node_modules` footprint is a real, documented cost.
- **Transitive deps**: `flatbuffers`, `guid-typescript`, `long`, `onnxruntime-common`,
  `platform`, `protobufjs` — all pure-JS, no native addon.

---

## Design findings (from reading the SPEC-001 seams)

1. **FR-017a cache validator must NOT reuse `validateProjectPath` verbatim.**
   `src/utils.ts` `validateProjectPath` rejects sensitive home subdirectories including
   **`.config`**. A legitimate `XDG_CACHE_HOME` frequently lives under `~/.config` (or a
   sibling), so reusing that validator verbatim would **false-reject a valid cache dir**.
   The spec already anticipates this ("a cache-appropriate validation is used, not the
   project-path validator verbatim"). Design: a small purpose-built cache-path check that
   reuses the `SENSITIVE_PATHS` set + the lexical `../`-traversal logic from
   `validatePathWithinRoot`, but **omits the `.config`/home-subdir rejection**.

2. **Worker files are `tsc`-compiled, NOT `copy-assets`; ORT `.wasm` resolves from
   `node_modules`.** The `copy-assets` npm script only copies `src/db/schema.sql` and
   `src/extraction/wasm/*.wasm` into `dist/`. The new inference worker is a normal `.ts`
   module → `tsc` emits `dist/embeddings/local-embed-worker.js` automatically (no
   copy-assets change). `onnxruntime-web` resolves its own 7 `.wasm` variants by **relative
   path from `node_modules/onnxruntime-web/dist/`** (the same pattern tree-sitter uses).
   As long as `node_modules/onnxruntime-web` survives into the bundled / thin-installer
   runtime tree, **no new copy-assets step is needed for the runtime `.wasm`**. Follow-up
   (not a blocker): verify `node_modules/onnxruntime-web/dist/*.wasm` is preserved by
   `scripts/build-bundle.sh` before release.

---

## Residual risks / follow-ups (advisory, non-blocking)

- **Timeout-wrap `InferenceSession.create()`** — mandatory (the hang gotcha). Early
  Implement task with a test that points at a missing/corrupt `.wasm` and asserts the
  provider rejects within the timeout so the pass degrades (never hangs).
- **`scripts/build-bundle.sh` `.wasm` preservation** — verify at implement time that the
  bundled runtime tree keeps `node_modules/onnxruntime-web/dist/*.wasm`.
- **`tokenizer.json` SHA-256** — pin the exact digest at implement time from commit
  `751bff37182d3f1213fa05d7196b954e230abad9` (the model digest is already pinned above).
