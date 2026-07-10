---
topic: "Hybrid semantic search (SPEC-003)"
slug: "spec-003-hybrid-semantic-search"
date: "2026-07-09"
mode: "setup"
spec_id: "SPEC-003"
source_input:
  type: "topic"
  ref: "docs/ai/specs/intelligence-platform-technical-roadmap.md § SPEC-003 scope"
question_count: 10
stop_reason: "natural"
---

# Design Concept: Hybrid Semantic Search (SPEC-003)

> **Source:** technical roadmap § SPEC-003 (scope passed in by /speckit-pro:speckit-scaffold-spec)
> **Date:** 2026-07-09
> **Questions asked:** 10
> **Stop reason:** natural (all branches converged; no critical opens remained)

## Goals

- Search fuses FTS5 keyword hits with vector KNN via reciprocal-rank fusion (RRF, `k=60` per the roadmap), beating keyword-only on the eval harness with graceful degradation when vectors are absent.
- `searchNodes(query, {mode})` defaults to `'keyword'` — today's behavior byte-identical when unconfigured/unspecified (dormancy discipline). The explicit surfaces — `codegraph_search` (MCP), CLI search, and opt-in library callers — pass `mode:'auto'` (hybrid when matching-model vectors exist, else keyword). (Q1)
- Query-time provider comes up lazily on the first hybrid-eligible query; that query is served keyword with a success-shaped "semantic warming" note; per-query embed wait is capped at an internal ~2s budget with keyword-plus-hint fallback — never `isError`. (Q4)
- The p95 ≤150 ms @ 50k nodes target gates **fusion compute only** (vector scan + top-k heap + RRF merge); the query-embed leg (endpoint HTTP round trip or in-process ONNX inference) is reported, not gated — it already has the ~2s budget + keyword fallback. (Q5)
- KNN scans a lazy in-memory Float32Array matrix cache (all vectors whose `model` matches the active provider's model), invalidated per query by a cheap staleness probe (vector count + data_version). Memory = count×dims×4B, documented (≈64 MB on the dogfood repo today; the 50k×3584 ≈ 717 MB corner is documented with quantization/ANN as the already-named follow-up). (Q6)
- Existing filters keep byte-identical semantics in every mode: `kind:`/`lang:`/`options.kinds` pre-filter the vector scan before top-k selection (cache rows carry kind+language); `path:`/`name:` remain post-fusion hard gates. The embed input is the parsed text portion with filter tokens stripped, mirroring FTS. (Q7)
- Results in semantic/hybrid modes carry optional provenance — `matchType: 'keyword'|'semantic'|'both'` plus the fused score — absent in keyword mode so existing shapes stay byte-identical; `codegraph_search`/CLI annotate hits. (Q8)
- CI gates live in `npm test` as a vitest suite with injected deterministic fixture vectors: hybrid hit-rate ≥ keyword on the paraphrase set; existing keyword cases byte-stable; p95 fusion compute over a generated 50k×384-dim fixture ≤150 ms (~10× headroom; the 3584-dim number reported, not gated). `npm run eval` gains the same semantic cases for the scored report. (Q9)
- Before merge, a scoped agent A/B per Constitution VI: `scripts/agent-eval/ab-new-vs-baseline.sh` (both arms codegraph-on, ≥2 runs/arm, Sonnet floor) on an embedded repo with NL-flavored search prompts, plus a no-vectors control repo expecting zero delta; results recorded in the UAT runbook. (Q10)
- Self-repo dogfood UAT (constitution § Dogfooding): paraphrase NL queries through `codegraph_search` on this repository's live index (endpoint = HAL nomic-embed-code), plus the dormancy check that an unconfigured/vector-less project behaves byte-identically.

**Slice-sizing (advisory):** the shared `estimate-spec-size` runner operation is unavailable in the installed runner (2.18.1) — treated as an absent estimate per protocol. Grounded signals instead: the roadmap estimator projects **195 reviewable LOC / ~4 production files / ~10 total files**, and the reviewability setup gate returned **pass with zero warnings** (thresholds 400/6/15). The spec is one thin vertical slice (query → fusion logic → library/MCP/CLI surfaces). **No split.**

## Non-goals

- **Hybrid fusion inside `codegraph_explore`** — explicit non-goal; deferred to a proposed future roadmap entry after SPEC-003's dogfood results exist (Q2, Q3; see Open Questions).
- ANN indexes / quantization — roadmap out-of-scope (follow-up if scale demands).
- Re-ranking models — roadmap out-of-scope.
- No new env vars / configurability for the query-embed budget or cache size (Constitution II) — internal constants, documented (Q4, Q6).
- No change to `searchNodes` default behavior for internal callers (explore, prompt hook, context builder) — they stay keyword (Q1).

## Design Tree (Q&A log)

### Q1. Where should the "default hybrid when vectors exist" behavior live?

**Branch:** Mode default & blast radius

**Recommended answer:** Library defaults keyword; surfaces opt in
> `searchNodes({mode})` defaults `'keyword'` — byte-identical today (dormancy discipline, Constitution VII/dogfooding). `codegraph_search`, CLI search, and explicit callers pass `mode:'auto'` (hybrid when matching vectors exist). Internal callers like explore are untouched — no silent retrieval change to the PRIMARY tool, no surprise query-embed latency (Constitution VI).

**Alternatives offered:**
- `searchNodes` defaults auto-hybrid globally: matches the roadmap phrasing most literally, but silently upgrades every internal caller — a retrieval-affecting change to the primary tool requiring full A/B, plus a per-call embed latency tax.

**User's answer:** Library defaults keyword; surfaces opt in (Recommended)

---

### Q2. Should wiring hybrid search into `codegraph_explore` be an explicit NON-GOAL of SPEC-003, deferred to a separate follow-up experiment?

**Branch:** Explore scope (retrieval do-not-regress surface)

**Recommended answer:** Yes — explicit non-goal, defer to follow-up
> The roadmap scope names searchNodes/MCP search/CLI only. Explore's symbol-bag resolution is precision-tuned; fusing semantic candidates into it is a retrieval-affecting change to the do-not-regress surface needing its own A/B (≥2 runs/arm, Sonnet floor, control repo) per Constitution VI — wrong to bundle into a 195-LOC search spec.

**Alternatives offered:**
- Include a guarded explore experiment in this spec: value sooner, but roughly doubles validation burden and couples merge to A/B outcomes.

**User's answer:** Other: "yes but do we need or have an existing future spec on the roadmap for this?"

**Notes:** Verified during the session: no existing roadmap spec owns explore-side semantic fusion. Resolved in Q3.

---

### Q3. No existing spec on the roadmap owns explore-side semantic fusion. How should we track that deferred work?

**Branch:** Explore scope — tracking

**Recommended answer:** Open Question + propose roadmap entry later
> Record in this doc's Open Questions with the suggested next step: after SPEC-003 merges and dogfood results exist, add a new roadmap entry via /speckit-pro:speckit-coach (an A/B-gated explore-fusion experiment spec). Keeps this scaffold surgical — the roadmap edit on this branch is only the SPEC-003 In-Progress mark.

**Alternatives offered:**
- Add the roadmap entry in this scaffold now: concrete owner immediately, but bundles roadmap authoring into the SPEC-003 branch and pre-decides an experiment before SPEC-003's own results exist.
- Leave it unowned: weakest traceability.

**User's answer:** Open Question + propose roadmap entry later (Recommended)

---

### Q4. How should the query-time embedding provider come up in the daemon?

**Branch:** Query-embed lifecycle

**Recommended answer:** Lazy init + keyword-while-warming
> First hybrid-eligible query kicks off provider init in the background and is served keyword-only with a success-shaped note; later queries fuse. Per-query embed wait capped at an internal ~2s budget (no new env var, Constitution II); on timeout/failure → keyword + hint, never `isError` (errors-teach-abandonment). Nothing is spent until first use — dormancy preserved. Context: the local provider lazily spawns a worker + ONNX session (up to ~45s init incl. first-ever model download); the endpoint provider is a per-call HTTP round trip.

**Alternatives offered:**
- Pre-warm on daemon start when configured: first query fuses, but the local model sits resident (~hundreds of MB) in every agent session whether or not search is used.
- Block the first query on init: up to 45s stall — unacceptable, teaches abandonment.

**User's answer:** Lazy init + keyword-while-warming (Recommended)

---

### Q5. Should the 'p95 ≤150 ms @ 50k nodes' target gate only the fusion compute (vector scan + top-k + RRF merge — identical for both providers), or also include the query-embed leg (HAL endpoint HTTP round trip, or in-process ONNX inference)?

**Branch:** Latency budget semantics

**Recommended answer:** Fusion compute only; embed leg reported, not gated
> Scan+fusion is deterministic and fixture-measurable in CI regardless of provider. The embed leg varies by operator setup (HAL network hop ≈ tens of ms; ONNX inference ≈ tens of ms warm, seconds while warming) and already has the Q4 ~2s budget + keyword fallback — gating it would fail builds on infrastructure, not code. UAT still records real end-to-end numbers on the dogfood repo against HAL.

**Alternatives offered:**
- End-to-end including the embed leg: gates felt latency, but CI has no HAL and a cold ONNX — the gate would measure a synthetic embed anyway.

**User's answer:** Fusion compute only; embed leg reported, not gated (Recommended)

**Notes:** First ask was paused to clarify terminology — "query embedding" = producing the query vector via EITHER active provider (endpoint `/v1/embeddings` on HAL's LM Studio serving nomic-embed-code, or SPEC-002's in-process ONNX model); "fusion compute" = everything after the vector exists. Re-asked with clean terms.

---

### Q6. How should the KNN scan get its vectors?

**Branch:** Memory strategy / performance

**Recommended answer:** Lazy in-memory matrix cache + invalidation
> Decode all matching-model vectors into one Float32Array matrix on first semantic query; invalidate with a cheap staleness probe (vector count + data_version) each query. Simplest code that meets the p95 gate (SPEC-001 already blessed brute-force scan v1). Daemon RSS grows by count×dims×4B — ≈64 MB on the dogfood repo today (4.5k×3584); 50k×384 (bundled ONNX) ≈ 77 MB; the 50k×3584 ≈ 717 MB corner is documented, with quantization/ANN the already-named follow-up when scale demands. Streaming 717 MB of BLOBs per query cannot hit 150 ms.

**Alternatives offered:**
- Budgeted cache with streaming fallback: bounds worst-case memory but adds a second scan path + threshold to test; the fallback misses the p95 target anyway.
- Always stream from SQLite: zero resident memory, hopeless at 50k×3584.

**User's answer:** Lazy in-memory matrix cache + invalidation (Recommended)

---

### Q7. How should the existing search filters interact with the semantic arm in hybrid mode?

**Branch:** Filter semantics / correctness

**Recommended answer:** Pre-filter scan by kind/lang; path/name post-gate
> The vector scan skips rows failing `kind:`/`lang:`/`options.kinds` BEFORE top-k selection (the cache carries kind+language per row), so filtered-out nodes never consume top-k slots; `path:`/`name:` remain hard gates applied after RRF — byte-identical semantics to the keyword arm today. The embed input is the parsed text portion with filter tokens stripped, mirroring how FTS gets it.

**Alternatives offered:**
- Post-filter the semantic top-k: simpler loop, but a `kind:function` query on a class-heavy repo burns top-k slots on filtered-out symbols.

**User's answer:** Pre-filter scan by kind/lang; path/name post-gate (Recommended)

---

### Q8. Should hybrid/semantic results carry per-result provenance — which arm(s) surfaced each hit — exposed through the library result shape and the codegraph_search/CLI output?

**Branch:** Result shape / observability

**Recommended answer:** Yes — optional matchType on results
> `SearchResult` gains an optional `matchType: 'keyword'|'semantic'|'both'` (+ the fused RRF score), set ONLY in semantic/hybrid modes so keyword-mode shapes stay byte-identical for existing consumers. `codegraph_search`/CLI annotate hits (e.g. a `[semantic]` tag). Makes eval failures diagnosable and UAT verifiable; costs ~a field.

**Alternatives offered:**
- Keep SearchResult unchanged: leanest, but you can't tell whether hybrid contributed a hit without re-running arms by hand.

**User's answer:** Yes — optional matchType on results (Recommended)

---

### Q9. Where should the CI gates live — 'hybrid ≥ keyword on paraphrase cases', 'zero keyword regressions', and the p95 fusion-compute check?

**Branch:** Eval harness / CI wiring

**Recommended answer:** Vitest gates in npm test with fixture vectors
> A normal vitest suite injects deterministic fixture vectors (no live provider in CI): asserts hybrid hit-rate ≥ keyword on the paraphrase set, existing keyword cases byte-stable, and p95 fusion compute over a generated 50k×384-dim fixture ≤150 ms (384 = the zero-config bundled-ONNX reality; scan runs ~10–20 ms there, so ~10× headroom keeps shared runners from flaking; the 3584-dim number is reported, not gated). `npm run eval` gains the same semantic cases for the richer scored report. Context: `__tests__/evaluation/` is deliberately NOT part of `npm test` today.

**Alternatives offered:**
- Separate CI job running `npm run eval`: keeps the harness authoritative but adds a build-first CI lane and promotes eval into a gate, changing that contract for every future PR.

**User's answer:** Vitest gates in npm test w/ fixture vectors (Recommended)

---

### Q10. How much agent-level A/B validation should SPEC-003 carry before merge, given explore (the primary tool) is untouched and codegraph_search is a secondary surface that is byte-identical whenever vectors are absent?

**Branch:** Constitution VI validation burden

**Recommended answer:** Scoped A/B per Constitution VI
> Run `scripts/agent-eval/ab-new-vs-baseline.sh` (new build vs baseline, BOTH codegraph-on, ≥2 runs/arm, Sonnet floor) on an embedded repo with NL-flavored search prompts, plus a no-vectors control repo expecting zero delta. Satisfies Principle VI's MUST at the smallest honest scope; results recorded in the UAT runbook. Keeps the precedent clean for the future explore-fusion spec.

**Alternatives offered:**
- Deterministic gates only — no agent A/B: cheaper, but bends a constitutional MUST one spec before someone proposes fusing into explore.

**User's answer:** Scoped A/B per Constitution VI (Recommended)

---

## Open Questions

- **What:** Explore-side semantic fusion (hybrid candidates inside `codegraph_explore`) has no owning spec on the roadmap.
  **Why deferred:** Q2/Q3 — it is a retrieval-affecting experiment on the do-not-regress primary tool; it should be designed against SPEC-003's real dogfood results, not speculated now.
  **Suggested next step:** After SPEC-003 merges and dogfood/A-B numbers exist, add a new roadmap entry via `/speckit-pro:speckit-coach` for an A/B-gated explore-fusion experiment spec (Constitution VI methodology binding).

- **What:** The shared `estimate-spec-size` runner operation was unavailable (not registered in installed runner 2.18.1; no script in the plugin cache).
  **Why deferred:** Tooling gap, not a design gap — protocol says treat as absent estimate and continue; grounded roadmap estimator + setup-gate numbers were used instead.
  **Suggested next step:** Report upstream to speckit-pro; no SPEC-003 action needed.

## Recommended Next Step

Setup mode — scaffolding already in progress. This doc feeds the workflow file's Specify/Clarify/Plan prompts; run `/speckit-pro:speckit-autopilot docs/ai/specs/.process/SPEC-003-workflow.md` from the worktree once the scaffold completes.
