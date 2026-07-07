# Performance Checklist: Bundled Local Embedding Fallback (SPEC-002)

**Purpose**: Requirements-quality gate ("unit tests for English") for the performance
domain — off-thread inference / daemon non-stall (Constitution VI), once-per-worker session
load amortization, batch/concurrency sizing for WASM CPU, progress feedback, retrieval
non-regression, and node/edge stability across re-embed.
**Created**: 2026-07-05
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [research.md](../research.md) · [contracts/local-provider.md](../contracts/local-provider.md)

**Scope note**: These items test whether the *requirements* are complete, clear, consistent,
and measurable — not whether the implementation works. Items carrying a trailing Gap marker
flag a missing or non-normative requirement to remediate; items with a spec/contract/data-model
reference and no Gap marker credit an adequately-specified requirement.

## Performance Success Criteria & Measurability

- [x] CHK001 - Are any performance targets (cold-load time, per-symbol inference latency, throughput) expressed as measurable Success Criteria with a designated verification method (probe/benchmark), or do they remain non-binding design goals in plan.md/research.md with no SC coverage? (closed by SC-009) [Measurability]
- [x] CHK002 - Is a measurable acceptance criterion defined for "MUST NOT stall the daemon event loop or the file watcher" (FR-010) — e.g., a bound on main-thread block time or on daemon query latency observed *during* a full embed pass? (closed by SC-010) [Measurability, Spec §FR-010]
- [x] CHK003 - Are performance requirements specified under realistic load (a large repo of 10k–100k+ symbols), not only the small-project happy path, so the ~5–8 ms/symbol goal is bounded at scale? (closed by SC-009's repo-scale clause) [Completeness]
- [ ] CHK004 - Is byte-identical dormancy (no model download, no network, no schema write — hence zero embedding perf cost) defined for the unconfigured case? [Coverage, Spec §FR-005, §SC-004]

## Off-Thread Execution & Daemon Non-Stall (Constitution VI / FR-010)

- [ ] CHK005 - Is the requirement that local inference runs off the main thread explicitly stated? [Completeness, Spec §FR-010]
- [ ] CHK006 - Is the "long inference on the daemon does not stall the event loop or the file watcher" scenario captured as an edge case? [Coverage, Spec Edge Cases]
- [x] CHK007 - Does the spec specify which thread composes embedding inputs, reads source snippets (the `readSource` disk IO in `runEmbeddingPass`), and marshals each `batchSize × concurrency` super-chunk to the worker, so "off-thread" (FR-010) covers input preparation + IO + marshalling, not only ONNX inference? (closed by plan.md Constraints append — only ONNX inference is off-thread; the daemon drives the pass and yields between super-chunks) [Completeness]
- [x] CHK008 - Are requirements defined for the inference runtime's internal thread usage (the WASM runtime auto-populates a multi-thread pool, `numThreads:4` per research OQ-1) and its CPU contention with the daemon, the file watcher, and the parse worker pool, so a full embed pass does not starve query serving? (closed by FR-010b) [Completeness]

## Session / Model Load-Once Amortization

- [x] CHK009 - Is the "model/session is created exactly once per worker and reused for every batch" invariant (the ~215–250 ms cold load amortized once, not per batch or per symbol) captured as a normative, measurable requirement (FR/SC) — with a criterion such as session-create count == 1 per pass — rather than living only as design rationale in research.md and the provider contract? (closed by FR-010a) [Measurability]
- [ ] CHK010 - Is the cold-load (~215–250 ms once per worker) documented as a design constraint with its per-symbol amortization rationale? [Clarity, Research §OQ-1, Contract]
- [ ] CHK011 - Is it specified that the worker/session cold-load is skipped entirely when a pass has zero eligible symbols (lazy init on first `embed()`), so an incremental sync with no changes pays no ~215–250 ms cold-load? [Coverage, Contract]

## Batch / Concurrency Sizing & Runtime Resource Budgets

- [x] CHK012 - Are the local provider's default `batchSize`/`concurrency` values **and** their clamp ceilings explicitly specified and justified for single-worker WASM CPU inference, rather than inherited from the network-tuned endpoint defaults (16 / 4 with 2048 / 64 ceilings sized for an OpenAI-style HTTP endpoint)? (closed by data-model.md §1 note — ceilings chosen for single-worker WASM CPU, not the endpoint's network ceilings) [Clarity, Data-model §1]
- [x] CHK013 - Is the meaning of "`concurrency`" defined for the local provider given a single long-lived worker (research OQ-3 states a pool is unnecessary), since "in-flight batch concurrency" implies no real parallelism against one worker and the whole super-chunk (`batchSize × concurrency`) is processed by that one worker? (closed by data-model.md §1 note — concurrency does not create parallel inference, only sizes the super-chunk + commit cadence) [Ambiguity, Data-model §1]

## Progress & Feedback

- [ ] CHK014 - Is progress reporting for the local pass covered by reuse of `runEmbeddingPass`'s existing per-batch `onProgress` hook? [Coverage, Research §OQ-3, Indexer-hook]
- [x] CHK015 - Are progress/feedback requirements defined for the model-acquisition (first-run ~22 MB download) and the session cold-load window, which both precede the first per-batch `onProgress` ping, so a long first run is not silent? (closed by FR-021a) [Coverage, Edge Case]

## Retrieval Non-Regression (Constitution VI)

- [x] CHK016 - Is the "retrieval/tool surface and `codegraph_explore` budgets remain untouched" guarantee expressed as a verifiable Success Criterion (naming the basis Constitution VI requires — no explore-path change / A/B-neutral), or only asserted in the plan's Constitution Check? (closed by SC-011) [Measurability]
- [x] CHK017 - Does the spec distinguish "the retrieval tool surface is *statically* unchanged (only vectors are produced)" from "explore query *latency* does not regress *while* a local embed pass is running" (runtime CPU contention), and are requirements defined for the latter? (closed by SC-011's static-surface guarantee alongside SC-010's during-pass latency criterion) [Ambiguity]
- [ ] CHK018 - Is the boundary that search/retrieval quality is owned by SPEC-003 (this spec produces vectors only) clearly stated so retrieval behavior is out of performance scope here? [Consistency, Spec Out of Scope]

## Re-Embed Invariants (No Graph Growth)

- [ ] CHK019 - Are node/edge count-stability requirements for a local re-embed defined with a measurable before/after criterion (0 growth)? [Measurability, Spec §FR-023, §SC-007]
- [ ] CHK020 - Is it clear that vector-layer churn (`node_vectors` delete/upsert on a provider switch) is excluded from "graph growth," so the stability criterion is unambiguous? [Clarity, Data-model §2]

## Edge Cases & Resource Bounds under Scale / Concurrency

- [x] CHK021 - Are requirements defined for the inference worker's WASM heap growth over a long single pass? The parse pool recycles workers every 250 parses precisely because WASM linear memory grows but never shrinks; a single long-lived embed worker (research OQ-3) has no analogous bound specified. (closed by Edge Case "Long-pass worker heap") [Completeness, Edge Case]
- [x] CHK022 - Are CPU/worker resource bounds specified when multiple projects embed concurrently under one daemon (each spawning an inference worker with its own WASM thread pool), combining the "shared cache under concurrency" and "long inference on the daemon" edge cases? (closed by Edge Case "Multi-project concurrent passes") [Coverage, Edge Case]
- [x] CHK023 - Is the mandatory `InferenceSession.create()` timeout (a missing/corrupt `.wasm` hangs indefinitely and never rejects, per research OQ-1) captured as a normative requirement with a *specified* timeout budget, rather than only a design note in research.md / plan Constraints — so "model unavailable → skip" degrades instead of hanging the index? (closed by FR-019b — default ~30s, tunable) [Completeness]

## Notes

- Check items off as completed: `[x]`.
- All 14 gap-marked items in this domain are now closed (see per-item "closed by" notes above).
- CHK023 (session-create timeout) is liveness/DoS-adjacent and overlaps the error-handling
  domain checklist's CHK006 — both close via the same FR-019b.
