# Performance Checklist: Execution Flows & Clusters

**Purpose**: Validate that SPEC-011's performance requirements — the ≤20% index-overhead budget, trace-cap bounding, Louvain scalability, and sync-path cost — are complete, quantified, unambiguous, and objectively measurable before implementation.
**Created**: 2026-07-14
**Feature**: [spec.md](../spec.md) | [plan.md](../plan.md)

**Note**: These items test the REQUIREMENTS (spec.md / plan.md / research.md / data-model.md / quickstart.md), not the implementation. Each asks whether a performance property is well-specified, not whether code does it.

## Benchmark Harness & Measurement Methodology (SC-006 / Q19)

- [ ] CHK001 - Is the specific "fixture monorepo" used for the SC-006 paired benchmark identified by name or path, given no standing benchmark fixture is present in the repository today? [Gap, Spec §SC-006 / §Assumptions]
- [ ] CHK002 - Is the mechanism for holding embeddings + LSP *constant* across the paired runs specified (identical env vars, provider, model, daemon/cache warm-state), rather than only stated as an intent? [Gap, Spec §SC-006 / Plan §Performance Goals]
- [ ] CHK003 - Are the benchmark's statistical parameters defined — run count beyond the ≥3 floor, warmup/discard policy, cold-vs-warm cache and daemon state, outlier handling, machine-quiescence assumptions — so "median" is reproducible? [Gap, Ambiguity, quickstart §Performance benchmark]
- [ ] CHK004 - Is the wall-clock measurement boundary defined (which pipeline stages — init, extraction, resolution, LSP, embedding, analysis, DB checkpoint — are inside vs outside the timed window)? [Clarity, quickstart §Performance benchmark]
- [ ] CHK005 - Is the ≤20% overhead threshold expressed as an objectively verifiable assertion (`median(B) ≤ 1.20 × median(A)`)? [Measurability, quickstart §Performance benchmark]
- [ ] CHK006 - Are the paired-run arms (A = both catalogs off, B = both on) and the held-constant variables described consistently across spec.md, plan.md, and quickstart.md? [Consistency, Spec §SC-006]

## Trace-Cap Enforcement & Flow Bounding (FR-005 / FR-006 / FR-007)

- [ ] CHK007 - Are the trace caps quantified with fixed, code-versioned values (12 hops depth / 20 out-edges per step / 200 unique steps)? [Clarity, Spec §FR-005/§FR-006]
- [ ] CHK008 - When a step's outgoing edges exceed the width cap (20), is the rule for *which* edges survive — a total, deterministic ordering — specified, given god-function fan-out and the byte-identical determinism requirement? [Gap, Spec §FR-005 / §SC-004]
- [ ] CHK009 - Is cycle-safety specified so each symbol is visited once regardless of fan-in, with a deterministic first-visit/parent rule? [Coverage, data-model §flow_steps]
- [ ] CHK010 - Is the *total number of flows* per repo bounded or its aggregate cost characterized — every `isExported` callable with zero inbound edges roots a flow (FR-001), so a large repo can root thousands of 200-step traces — or is only per-flow work bounded? [Gap, Spec §FR-001 / §FR-005]
- [ ] CHK011 - Are all three truncation axes required to be recorded independently when simultaneously reached, so no boundary is silently dropped? [Completeness, Spec §FR-007]
- [ ] CHK012 - Is it defined whether edges discarded by the width cap count toward the 200-step total, so per-step work under fan-out is unambiguous? [Clarity, Spec §FR-005]

## Cluster Detection Scalability (FR-011 / FR-013)

- [ ] CHK013 - Is a runtime/memory bound or complexity characterization specified for deterministic Louvain on the largest supported repos (≫536 files; vscode ~10k, ~20k/40k referenced in project docs), beyond the "file-vertex graph keeps it tractable" assertion? [Gap, Spec §FR-011 / Plan §Scale/Scope]
- [ ] CHK014 - Is file-graph construction cost (enumerating cross-file edges and aggregating pair weights) bounded or characterized for high-edge-density repos, not just high file count? [Gap, Plan §clusters/file-graph, Spec §FR-012]
- [ ] CHK015 - Is Louvain iteration convergence bounded (max passes/iterations) so a pathological graph cannot loop unboundedly while staying deterministic? [Coverage, research §R1]
- [ ] CHK016 - Is the "largest supported repo" scale defined for performance purposes, so the tractability claim has a concrete ceiling to be judged against? [Clarity, Plan §Scale/Scope]

## Sync & Lifecycle Overhead (FR-020 / FR-021)

- [ ] CHK017 - Given FR-020 mandates a *full* catalog recompute after every successful sync, is the added per-sync latency bounded or measured for watch-driven, single-file syncs on the dogfood repo? [Gap, Spec §FR-020]
- [ ] CHK018 - Is the interaction between file-watcher/daemon-driven `sync()` and full recompute characterized (debounce/coalescing of rapid saves, or explicit acceptance that every sync pays full analysis)? [Gap, Spec §FR-020 / §Assumptions]
- [ ] CHK019 - Is SC-006's scope (full-index overhead only) reconciled with the absence of any incremental-sync overhead criterion, so watch-loop cost is not left unmeasured? [Consistency, Coverage, Spec §SC-006 / §FR-020]
- [ ] CHK020 - Is the atomic-swap transaction's cost and write-lock duration characterized so a large catalog swap does not stall concurrent daemon reads under WAL? [Coverage, data-model §Atomic swap]

## Disabled-Path Zero-Cost (FR-025 / SC-007)

- [ ] CHK021 - Is "zero measurable analysis overhead" when disabled given an operational definition (measurement method + threshold), or only asserted? [Gap, Measurability, Spec §SC-007 / §FR-025]
- [ ] CHK022 - Are the disabled-path per-index costs (config read, `graph_write_version` gating) confirmed excluded from "catalog data" and characterized as non-measurable? [Clarity, Spec §FR-025 / research §R2]

## Daemon Responsiveness & Cross-Cutting

- [ ] CHK023 - Is there a requirement that the CPU-bound analysis pass cooperatively yield or run off-thread to keep the daemon query loop responsive during large-repo analysis, consistent with the existing resolution/embedding yield precedent? [Gap]
- [ ] CHK024 - Are performance requirements consistent with Constitution VI (retrieval performance is a regression surface) — e.g., analysis must not slow concurrent `codegraph_explore` queries? [Consistency, Plan §Constitution VI]

## Acceptance-Criteria Measurability

- [ ] CHK025 - Can every performance success criterion (SC-006, SC-007) be objectively measured with the evidence the spec names? [Measurability, Spec §SC-006/§SC-007]
- [ ] CHK026 - Is the benchmark evidence's role (recorded PR/UAT evidence, not a CI timing gate) stated consistently across spec, plan, and quickstart? [Consistency, research §Q19]
- [ ] CHK027 - Are performance-relevant assumptions (fixture selection, constant env) recorded as validated assumptions rather than unresolved open questions? [Assumption, Spec §Assumptions]

## Notes

- `[Gap]` = the requirement is missing or materially underspecified in the current artifacts.
- Traceability: 26 of 27 items carry a spec/plan/artifact reference or a `[Gap]` marker.
- This checklist was generated REPORT-ONLY; proposed remediations for each `[Gap]` are returned to the orchestrator as text and are NOT applied to shared artifacts.
