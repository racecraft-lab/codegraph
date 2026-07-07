---
topic: "SPEC-002 — Bundled Local Embedding Fallback"
date: 2026-07-05
source-input: "technical-roadmap SPEC-002 scope (setup mode via /speckit-pro:speckit-scaffold-spec)"
question-count: 9
mode: setup
---

# SPEC-002 — Bundled Local Embedding Fallback — Design Concept

## Goals

- Semantic indexing works on any machine with **zero external setup** via a small,
  permissively-licensed, in-process (WASM/ONNX CPU) code-embedding model — as an
  **explicit opt-in**, never an automatic default.
- Preserve the constitution's dormancy invariant (Principle VII + the SPEC-001
  dogfooding amendment): a fully-unset config stays byte-identical — `loadEmbeddingConfig`
  keeps returning `null`, zero network calls, zero schema writes. Local activates only on
  a deliberate `CODEGRAPH_EMBEDDING_PROVIDER=local` / `--embeddings local`.
- Ride SPEC-001's existing seams — the `EmbeddingProvider` interface (a statically-known
  `dims` provider), the `node_vectors` store, and the model-switch re-embed
  (`selectEmbeddableNodesMissingVector(model)`) — rather than adding new graph/schema
  machinery.
- Advance the binding **dogfood ladder**: SPEC-001 embeds this repo via the HAL endpoint;
  SPEC-002's self-repo UAT switches it to the local provider and re-embeds (a model switch
  that full-re-embeds by design).
- **Slice sizing:** keep as **one vertical slice** (estimator: 380 LOC, 1 slice, `ok`;
  reviewability gate: 325 LOC / 4 production files, within budget). No split.

## Non-goals

- **Auto-activation** on an unconfigured repo (breaks dormancy) — explicitly rejected (Q1).
- **Bundling weights** in the npm package, or shipping them as `optionalDependencies` —
  weights are lazy-downloaded (Q4).
- GPU execution paths; model fine-tuning.
- Search / retrieval behavior and quality — that is **SPEC-003**. Local is a *fallback
  producer* of vectors; "good enough" is the bar, not SOTA code retrieval (Q3).
- Running a racecraft-hosted model mirror (Q5).

## Design Tree (Q&A log)

### Q1 — Activation vs dormancy *(the crux)*
**Question:** The roadmap says local is "selected automatically when no endpoint is
configured," but the constitution's dormancy rule requires an unconfigured repo to stay
byte-identical (zero network, zero schema writes). How should local activate?
**Recommended:** Explicit opt-in only.
**Chosen:** ✅ **Explicit opt-in only.** Local activates ONLY via explicit config/flag; a
fully-unconfigured repo stays dormant — no download, no embed. "Automatic" is reinterpreted:
*once you've opted into embeddings*, local is the default when no endpoint URL is given.
**Why:** Auto-download+embed on any unconfigured `codegraph index` would silently turn on a
model download for every existing user — a Principle VII / dogfooding dormancy violation.

### Q2 — WASM runtime library
**Question:** transformers.js vs onnxruntime-web-only + own tokenizer, given the ~310 LOC
budget and the npm dependency footprint (weights are lazy-downloaded either way)?
**Recommended:** transformers.js (least code to own).
**Chosen:** ⏳ **Decide at plan phase.** Both `@huggingface/transformers` (Apache-2.0,
bundles onnxruntime-web/MIT, batteries-included) and `onnxruntime-web`-only + a hand-rolled
tokenizer are candidates. **→ Open Question.**
**Why:** The decision hinges on the *measured* installed size of each dependency and a
confirmed license + pure-JS/WASM (no native addon) status — hard numbers `/speckit-plan`
should gather, not guess. Drives the BUNDLING.md payload note.

### Q3 — Model quality/size profile
**Question:** Target a code-specific model or a general-purpose small baseline?
**Recommended:** General-purpose small baseline.
**Chosen:** ✅ **General-purpose small baseline** (MiniLM-L6 / BGE-small class, 384–768 dims,
Apache/MIT, quantized). Exact checkpoint pinned at plan alongside the runtime.
**Why:** Small code-specific models with proven, permissively-licensed ONNX/WASM builds are
scarce; general-purpose small models are abundant, tiny (~25–90MB quantized), and fast on
CPU. Local is the fallback — SPEC-003 owns retrieval quality, so "good enough" vectors suffice.

### Q4 — Model delivery
**Question:** How do weights reach the machine — lazy download, optionalDependencies, or
bundled?
**Recommended:** Lazy checksum-verified download (OQ-1).
**Chosen:** ✅ **Lazy checksum-verified download on first use.** Download to the cache dir,
verify against a pinned checksum, then embed. `npm install` stays lean; no platform-conditional
packages; fetched once and reused.
**Why:** Confirms roadmap OQ-1; keeps npm payload flat and matches constitution VII.

### Q5 — Download source + trust anchor
**Question:** Which host, and what anchors trust?
**Recommended:** HF hub + in-source SHA-256, env-overridable base URL.
**Chosen:** ✅ **HF hub + in-source SHA-256 + env-overridable base URL.** Default to the
model's canonical HuggingFace hub URL; verify bytes against a SHA-256 pinned in codegraph
source (host is untrusted — the checksum is the anchor); optional
`CODEGRAPH_EMBEDDING_MODEL_URL`-style override for air-gapped/enterprise mirrors.
**Why:** No infra to run, well-cached CDN, and a clean offline/enterprise escape hatch;
trust rides the pinned checksum, so the host is swappable.

### Q6 — Cache directory
**Question:** Where are downloaded weights cached?
**Recommended:** Global user cache, platform-aware, env-overridable.
**Chosen:** ✅ **Global user cache** — `~/.codegraph/models/` on POSIX (honoring
`XDG_CACHE_HOME`), `%LOCALAPPDATA%` on Windows — shared across all projects, with an optional
`CODEGRAPH_MODEL_CACHE_DIR` override. NOT the runtime's default HF cache.
**Why:** Download once, reuse everywhere; avoids per-repo re-downloads and keeps the
per-project `.codegraph/` small (the dogfood note); follows SPEC-001's per-platform config-dir
precedent; keeping our own cache preserves the checksum-verify + offline-error story.

### Q7 — Offline / model-unavailable failure posture
**Question:** Local opted-in but weights uncached and unfetchable (offline first-run, or
checksum mismatch) — what happens to `codegraph index`?
**Recommended:** Structural index succeeds; embeddings skipped with an actionable message.
**Chosen:** ✅ **Structural index succeeds; embed pass skipped with an actionable message**
naming the cache dir / how to pre-seed / the override env var; `codegraph status` shows 0%
embedded with the reason.
**Why:** Embeddings are additive; mirrors SPEC-001 (a provider failure stops the *embed pass*,
not the already-committed structural index) and the "actionable, non-abandoning guidance"
principle. A hard-fail would block indexing entirely in CI/offline over an optional feature.

### Q8 — Inference threading
**Question:** WASM CPU embedding runs for minutes; a main-thread block would freeze the
per-project daemon + file watcher (a Principle VI retrieval regression). How is inference
scheduled?
**Recommended:** Off-thread worker (reuse parse-pool/query-pool precedent).
**Chosen:** ✅ **Off-thread worker.** Run inference in a worker like the existing
`parse-pool`/`query-pool` so a long WASM pass never stalls the daemon, watcher, or CLI;
progress via SPEC-001's existing `onProgress` hook. Exact worker wiring detailed at plan
alongside the runtime. **(Hard requirement: must not stall the daemon event loop.)**
**Why:** Protects the retrieval surface (constitution VI); the off-thread precedent already
exists to copy.

### Q9 — Config / selection surface
**Question:** SPEC-001 activates only when URL+MODEL are both set (else `null`). Local has no
URL — how does the opt-in compose in `config.ts`?
**Recommended:** New `CODEGRAPH_EMBEDDING_PROVIDER` (endpoint|local|off) + `--embeddings` flag.
**Chosen:** ✅ **New `CODEGRAPH_EMBEDDING_PROVIDER` (endpoint|local|off) selector +
`--embeddings <provider>` CLI flag.** Selection order: **explicit PROVIDER/`--embeddings`
wins → else URL+MODEL present → endpoint → else off.** `PROVIDER=local` activates local
without a URL. `loadEmbeddingConfig` becomes a discriminated union (endpoint | local |
misconfig | null); fully-unset still returns `null` (dormancy intact). Env-driven so it also
works in the daemon/MCP context.
**Why:** Explicit and dormancy-safe; avoids overloading `MODEL` (which would blur SPEC-001's
half-config error) and works where embeddings matter most — the env-configured long-running
daemon, which a CLI-flag-only surface couldn't reach.

## Open Questions

> **RESOLVED — autopilot Clarify, 2026-07-05** (evidence: SPEC-002-workflow.md § Clarify Results):
> **OQ-1 runtime → `onnxruntime-web`** (MIT, pure-WASM; `@huggingface/transformers` rejected —
> measured to hard-depend on native `onnxruntime-node` and use it as the default engine from Node,
> violating FR-011). **OQ-2 checkpoint → `Xenova/all-MiniLM-L6-v2`** (384d, Apache-2.0, ~22 MB
> quantized ONNX). **OQ-3 worker → inside `LocalProvider.embed()`** (parse-worker precedent); Plan
> must validate `onnxruntime-web` inference inside a Node `worker_thread`. Cost: CodeGraph owns a
> minimal BERT WordPiece tokenizer (~100–150 LOC → may push past the 380 LOC estimate; Plan re-checks).
> The original deferrals below are now closed.

1. **Runtime library** (Q2) — `@huggingface/transformers` vs `onnxruntime-web`-only +
   hand-rolled tokenizer. **Next step:** `/speckit-plan` measures each dependency's actual
   installed size, confirms license (Apache/MIT/BSD) and pure-JS/WASM-no-native status, then
   picks; the choice drives BUNDLING.md and the ~310 LOC budget.
2. **Exact model checkpoint + dimension** (Q3) — profile is fixed (general-purpose small,
   permissive, quantized, 384–768 dims); the specific checkpoint + pinned SHA-256 are chosen
   at plan alongside the runtime (some checkpoints only ship for one runtime).
3. **Worker wiring specifics** (Q8) — reuse `parse-pool` vs `query-pool` shape, and whether
   the chosen runtime initializes cleanly inside a worker; detailed at plan. The constraint
   ("must not stall the daemon event loop") is firm regardless.

## Recommended Next Step

`/speckit-pro:speckit-autopilot docs/ai/specs/.process/SPEC-002-workflow.md` — the workflow's
Clarify phase should resolve the three Open Questions above (runtime, checkpoint, worker) as
its first session, since Plan depends on them.
