# Implementation Plan: Bundled Local Embedding Fallback (SPEC-002)

**Branch**: `002-local-embedding-fallback` | **Date**: 2026-07-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-local-embedding-fallback/spec.md`

## Summary

Add an explicit-opt-in local embedding provider so semantic indexing works with **zero
external setup**. When an operator selects `CODEGRAPH_EMBEDDING_PROVIDER=local` (or
`codegraph index --embeddings local`), CodeGraph lazily downloads a small, permissively
licensed quantized model (`Xenova/all-MiniLM-L6-v2`, 384-dim, Apache-2.0), verifies it
against a SHA-256 pinned in source, caches it machine-wide, and embeds every symbol
**in-process, off the main thread** via `onnxruntime-web` (MIT, pure-WASM, no native
addon). A fully-unset config stays **byte-identical dormant** (no download, no network, no
schema write). The feature rides SPEC-001's seams unchanged — the `EmbeddingProvider`
interface, the `node_vectors` store, `runEmbeddingPass`, and the model-column-mismatch
re-embed — adding no new graph/schema machinery. Offline/checksum failures degrade
gracefully: the structural index always completes and `codegraph status` reports why
coverage is 0%.

Technical approach and the resolved runtime/checkpoint/worker decisions (with empirical
spike evidence) are in [research.md](./research.md); the config union, cache model, and
re-embed mechanism are in [data-model.md](./data-model.md); the provider and acquisition
seams are in [contracts/](./contracts/).

## Technical Context

**Language/Version**: TypeScript (strict), Node `>=20 <25` (from-source floor 22.5 for
`node:sqlite`); npm `engines` range preserved unchanged.

**Primary Dependencies**: `onnxruntime-web@1.27.0` (MIT, pure-JS/WASM, no native addon —
**new** runtime dependency); existing `node:sqlite`, `worker_threads`, `node:crypto`,
`commander`. No `@huggingface/transformers` (rejected — pulls native `onnxruntime-node`,
see research.md OQ-1).

**Storage**: `node:sqlite`; the SPEC-001 `node_vectors` table is **reused unchanged** — no
new table, no migration. Model weights live in a machine-wide platform-aware **cache dir**
(FR-016), never inside a project's `.codegraph/`.

**Testing**: vitest (`npm test`) — real files, real SQLite, no DB mocking; platform-divergent
cache paths `it.runIf`-gated and validated on the real platform.

**Target Platform**: macOS / Linux / Windows (Node runtime); WASM CPU inference in a
`worker_threads` Worker (spike-validated on all three probes — main thread, 384-dim output,
inside a Worker — with zero manual config).

**Project Type**: single project — a local-first library + CLI + MCP server (this feature
is a new capability inside `src/embeddings/`).

**Performance Goals**: session cold-load ≈215–250 ms once per worker/process (not per
symbol); warmed inference ≈5–8 ms/text (single-digit ms/symbol). Off-thread so the daemon
event loop and file watcher are never stalled (FR-010 / Principle VI).

**Constraints**: pure-JS/WASM only (no native addon); byte-identical dormancy when
unconfigured; SHA-256 verify-before-use (host untrusted); `InferenceSession.create()`
**must be timeout-wrapped** (a missing/corrupt `.wasm` hangs indefinitely — research.md
OQ-1); embed failures are advisory (never fail the structural index); node/edge counts
stable across re-embed. Only ONNX inference is off-thread; input composition +
`readSource` file reads run on the pass-driving thread — the daemon MUST drive the pass
and yield between super-chunks so query serving isn't blocked; bound
`ort.env.wasm.numThreads` so the WASM pool doesn't saturate cores.

**Scale/Scope**: ~650–680 reviewable production LOC across 8 production files (4 new + 4
modified); ~7 new test suites; 1 new doc (`BUNDLING.md`). See Reviewability Budget.

**Reviewability Budget**: Primary surface = harness/adapter (the local embedding provider +
its worker/tokenizer/fetch modules). Projected reviewable LOC ≈ **650–680** (production only;
the Phase-4 checklist hardening — download bounds, tokenizer verify, path prefix/realpath,
redaction, timeout wrappers, thread bound — adds ~40–70 LOC over the original ~603 estimate);
production files **8**; total code/doc files ≈ **16**. Budget result: **over the soft warn
thresholds (400 LOC / 6 files), within the hard block limits (800 LOC / 8 files)** — advisory
WARN, greenfield allowance applies, **no split** (see the dedicated subsection below).

## Constitution Check

*GATE: evaluated before Phase 0 and re-affirmed after Phase 1 design. Result: **PASS** on
all seven principles; one advisory Complexity Tracking row for the reviewability-budget
overage (below).*

| Principle | Verdict | Basis |
|---|---|---|
| **I. Think Before Coding** | PASS | The 3 design-concept Open Questions (runtime/checkpoint/worker) are resolved with **measured** evidence, not guesses; the transformers.js-vs-onnxruntime-web fork was surfaced and decided empirically; no clarification markers remain. Competing interpretations recorded in research.md. |
| **II. Simplicity First** | PASS (with advisory) | Minimum code that satisfies the constraints; no speculative flags/abstractions. The owned BERT tokenizer + inference worker are **forced** by the pure-WASM runtime choice (FR-011/VII), not gold-plating — but they push reviewable LOC past the spec's ~310/~380 projection. Recorded honestly in a Complexity Tracking row. |
| **III. Surgical Changes** | PASS | New capability lives in **new modules** under `src/embeddings/` behind the explicit `CODEGRAPH_EMBEDDING_PROVIDER=local` opt-in. Diffs to upstream-owned files (`config.ts`, `indexer-hook.ts`, `index.ts`, `bin/codegraph.ts`) are minimal additive branches; `node_vectors` reused with zero schema churn. |
| **IV. Goal-Driven Execution** | PASS | Success criteria SC-001..SC-008 are measurable; quickstart.md gives runnable end-to-end validation; the worker-viability spike is green with recorded evidence; the binding self-repo dogfood UAT (HAL endpoint → local) is included. |
| **V. Deterministic, LLM-Free Extraction** | PASS | Local vectors are a **prose-layer** artifact (embeddings), never graph nodes/edges. Re-embed rides the model-column mismatch and produces **0 graph growth** (FR-023 / SC-007); no synthesized edges, no node explosion. |
| **VI. Retrieval Performance Is a Regression Surface** | PASS | Inference is **off-thread** (worker) AND the worker **bounds `ort.env.wasm.numThreads`** to leave ≥1 core free (**FR-010b**) — off-thread execution alone is insufficient (the WASM pool defaults to `min(cores/2,4)` and spawns nested threads unless bounded), so the daemon event loop, query serving, and file watcher are never starved (FR-010 + FR-010b; the guarantee SC-010 states, validated by T029). This spec only *produces* vectors — the retrieval/tool surface (explore/node) and its budgets are untouched (search is SPEC-003). No tool-output or `isError` changes. |
| **VII. Local-First, Private, Zero Native Dependencies** | PASS | `onnxruntime-web` is **pure-JS/WASM, no native addon** (transformers.js rejected precisely because it pulls native `onnxruntime-node`). `node:sqlite` sole store, `node_vectors` reused. `engines >=20 <25` preserved. **Dormancy byte-identical** when unconfigured (FR-005/SC-004): zero network, zero schema write. **copy-assets**: the worker is `tsc`-compiled (no copy-assets), and ORT resolves its `.wasm` from `node_modules` by relative path (like tree-sitter) — no new src asset to wire (follow-up: verify `build-bundle.sh` keeps `node_modules/onnxruntime-web/dist/*.wasm`). **License**: onnxruntime-web MIT + all-MiniLM-L6-v2 Apache-2.0, both permissive. **FR-024**: the ~131 MB unpacked node-dep footprint is documented in `BUNDLING.md`; model weights are lazy-downloaded, not shipped. |

**Fork & Ecosystem Constraints**: PASS — all-new-code MIT; both new artifacts permissively
licensed; PR targets `origin`; vendor-neutral. **Dogfooding**: PASS — self-repo UAT switches
this repo endpoint→local and re-embeds (quickstart.md).

## Project Structure

### Documentation (this feature)

```text
specs/002-local-embedding-fallback/
├── plan.md              # This file
├── research.md          # Phase 0 — resolved OQs + spike evidence
├── data-model.md        # Phase 1 — config union, node_vectors reuse, cache model
├── quickstart.md        # Phase 1 — operator + dogfood validation walkthrough
├── contracts/
│   ├── local-provider.md    # LocalProvider ⇄ EmbeddingProvider seam
│   └── model-fetch.md       # lazy checksum-verified acquisition seam
└── tasks.md             # Phase 2 — created by /speckit-tasks (NOT here)
```

### Source Code (repository root)

New modules (all under the existing `src/embeddings/`; net-new, opt-in):

```text
src/embeddings/
├── local-provider.ts        # NEW  ~100 LOC — EmbeddingProvider impl; dims=384 up front;
│                            #                 lazy init; embed() marshals to the worker
├── local-tokenizer.ts       # NEW  ~150 LOC — pure BERT WordPiece: text -> 3 int64 tensors
│                            #                 (input_ids/attention_mask/token_type_ids)
├── local-embed-worker.ts    # NEW   ~95 LOC — worker_threads entry; timeout-wrapped
│                            #                 InferenceSession.create; run + mean-pool + L2
├── model-fetch.ts           # NEW  ~140 LOC — cache-dir resolve+validate; lazy download;
│                            #                 SHA-256 verify; atomic promote; typed skips
├── config.ts                # MOD  ~+55 LOC — CODEGRAPH_EMBEDDING_PROVIDER selector;
│                            #                 EmbeddingLocalConfig arm; FR-003 precedence
└── indexer-hook.ts          # MOD   ~+8 LOC — retype pass config to EmbedPassConfig subset

src/
├── index.ts                 # MOD  ~+35 LOC — maybeRunEmbeddingPass local branch (build
│                            #                 LocalProvider); getEmbeddingStatus local arm
└── bin/codegraph.ts         # MOD  ~+20 LOC — `--embeddings` flag on index; status render
                             #                 shows provider=local / model / dims

BUNDLING.md                  # NEW  (docs)   — onnxruntime-web payload note (FR-024)
```

Tests (new, ~7 suites — not counted in reviewable production LOC):

```text
__tests__/
├── embeddings-dormancy.test.ts           # SC-004 guard: zero network + zero node_vectors writes when unconfigured
├── embeddings-config-selection.test.ts   # FR-003 precedence + dormancy/half-config preserved
├── embeddings-model-fetch.test.ts        # cache resolve/validate, verify, atomic, skip msgs
├── embeddings-local-tokenizer.test.ts    # WordPiece encode: CLS/SEP/PAD, mask, int64 shape
├── embeddings-local-provider.test.ts     # order-preserving embed, dims=384, timeout/advisory
├── embeddings-local-index.test.ts        # end-to-end local embed, re-embed graph-stable, offline degrade
└── embeddings-local-status.test.ts       # status shows provider=local / model / dims=384 / coverage + skip reason
```

### Per-file LOC estimate

| File | Change | Reviewable LOC |
|---|---|---|
| `src/embeddings/local-tokenizer.ts` | new | 150 |
| `src/embeddings/model-fetch.ts` | new | 140 |
| `src/embeddings/local-provider.ts` | new | 100 |
| `src/embeddings/local-embed-worker.ts` | new | 95 |
| `src/embeddings/config.ts` | modify | 55 |
| `src/index.ts` | modify | 35 |
| `src/bin/codegraph.ts` | modify | 20 |
| `src/embeddings/indexer-hook.ts` | modify | 8 |
| Checklist hardening (cross-file: download size/time bounds, tokenizer checksum, cache-path prefix/realpath + safe temp-file, redaction, session-init timeout, thread bound) | additive | ~40–70 |
| **Total (production)** | | **~650–680** |

**Structure Decision**: Single project. The whole feature lands inside the existing
`src/embeddings/` module (4 new files) plus minimal additive edits to `config.ts`,
`indexer-hook.ts`, `index.ts`, and `bin/codegraph.ts`. This matches Principle III's
fork discipline (new capability in new modules behind an opt-in) and reuses every SPEC-001
seam (`provider.ts`, `node_vectors`, `runEmbeddingPass`, model-column re-embed) unchanged.

### Reviewability Budget (preset: speckit-pro-reviewability)

- **Primary surface**: harness/adapter — the local embedding provider and its
  worker/tokenizer/fetch modules.
- **Secondary surfaces**: seed/config (`config.ts` selection resolution); docs/process
  (`BUNDLING.md` payload note).
- **Projected reviewable LOC**: **~650–680** (production only; excludes tests, docs,
  lock/vendor). The Phase-4 checklist hardening (download size/time bounds, tokenizer
  checksum verification, cache-path prefix/realpath validation + safe temp-file creation,
  `CODEGRAPH_MODEL_BASE_URL` redaction, session-init timeout wrapper, ORT thread bound)
  adds ~40–70 LOC over the earlier ~603 estimate.
- **Projected production files**: **8** (4 new + 4 modified).
- **Projected total files**: **~16** (8 production + `BUNDLING.md` + ~7 test suites).
- **Budget result**: **advisory WARN** — over the soft warn thresholds (400 reviewable LOC,
  6 production files) but **still within the hard block limits** (800 LOC / 8 production
  files / 25 total files / 1 primary surface) even after the hardening additions. The
  overage vs the spec's original ~310/~380 projection is caused primarily by the pure-WASM
  runtime decision at Clarify, which forced CodeGraph to **own a tokenizer + inference
  worker** (2 modules, ~245 LOC, absent from the original count), plus the Phase-4
  checklist hardening above. The slice is predominantly net-new modules, so the
  **greenfield allowance** applies. **No split** — the projection stays comfortably under
  the 800 LOC hard block.
- **Split decision**: **remains a single spec.** The provider, its lazy checksum-verified
  acquisition, the selection resolution, and the status/observability surface form one
  cohesive capability with no independently shippable sub-slice (a tokenizer without a
  provider, or acquisition without a consumer, ships nothing). The projection sits inside
  the hard block limits, so no ratified split exception is required.

### PR Review Packet (source of the required sections)

- **What changed**: local `EmbeddingProvider` (`onnxruntime-web` + owned WordPiece
  tokenizer, off-thread), lazy checksum-verified model acquisition, `CODEGRAPH_EMBEDDING_PROVIDER`
  selection, `--embeddings` flag, status observability, `BUNDLING.md`.
- **Why**: semantic indexing with zero external setup, as an explicit opt-in (roadmap SPEC-002).
- **Non-goals**: retrieval quality (**SPEC-003**), GPU paths, model fine-tuning, bundling
  weights, auto-activation on an unconfigured repo, a first-party model mirror.
- **Review order**: `config.ts` (selection) → `model-fetch.ts` (acquisition/trust) →
  `local-tokenizer.ts` → `local-embed-worker.ts` → `local-provider.ts` → `index.ts` /
  `bin/codegraph.ts` wiring → `BUNDLING.md`.
- **Scope budget**: ~650–680 reviewable LOC / 8 production files (advisory WARN; within block).
- **Traceability**: each FR/SC maps to changed files + verification (spec ↔ contracts ↔
  quickstart scenarios ↔ test suites).
- **Verification**: `npm run build` + `npm test` green; quickstart Scenarios 1–7 + the
  self-repo dogfood; the `security` checklist covers the download-trust/traversal surface.
- **Known gaps**: retrieval quality deferred to SPEC-003; `build-bundle.sh` `.wasm`
  preservation is a release-time follow-up check.
- **Rollback / flags**: fully behind the explicit opt-in — unset config is byte-identical
  dormant, so rollback is "do not set `CODEGRAPH_EMBEDDING_PROVIDER=local`".

## Declared File Operations

<!--
  Machine-readable production-surface declaration for the plan-phase reviewability
  estimator (production only — tests live in the Tests subsection above and are
  excluded from the production-LOC metric per the spec's Reviewability Budget).
  One entry per line: `- NEW <repo-relative-path>` or `- MODIFIED <path>`.
-->

- NEW src/embeddings/local-provider.ts
- NEW src/embeddings/local-tokenizer.ts
- NEW src/embeddings/local-embed-worker.ts
- NEW src/embeddings/model-fetch.ts
- MODIFIED src/embeddings/config.ts
- MODIFIED src/embeddings/indexer-hook.ts
- MODIFIED src/index.ts
- MODIFIED src/bin/codegraph.ts
- NEW BUNDLING.md

## Complexity Tracking

*One advisory row — the Constitution Check PASSES; this documents the reviewability-budget
overage per Principle II's escape-hatch discipline (not an unjustified violation).*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Reviewability budget exceeds the soft warn thresholds (~650–680 reviewable LOC / 8 production files vs the spec's ~310/~380 & the 400 LOC / 6 file warn line) | The Clarify-mandated pure-WASM runtime (`onnxruntime-web`, no native addon — FR-011/VII) has **no batteries-included pipeline**, so CodeGraph must own a BERT WordPiece **tokenizer** (~150 LOC) + an inference **worker** (~95 LOC) that a higher-level library would have provided. These 2 modules (~245 LOC) are most of the overage; the Phase-4 checklist hardening (download bounds, tokenizer verify, path prefix/realpath, redaction, timeout wrappers, thread bound — ~40–70 LOC) adds the remainder. Both are the minimum to satisfy the constraints they close. | `@huggingface/transformers` (transformers.js) would remove the owned tokenizer/worker (~245 LOC) but **hard-depends on native `onnxruntime-node`** and selects it as the default engine from Node — a native addon that violates FR-011 / Constitution VII. Trading a hard constitutional violation for fewer LOC is rejected. Dropping the checklist hardening would leave the security/error-handling/performance gaps unresolved. Splitting the spec was also rejected (no independently shippable sub-slice; still within hard block limits — ~650–680 vs the 800 LOC ceiling). |
