# Error-Handling Checklist: Execution Flows & Clusters

**Purpose**: Requirements-quality audit ("unit tests for English") of SPEC-011's error, failure, dormancy, and degraded-read requirements — testing whether the requirements themselves are complete, clear, consistent, measurable, and cover the failure/edge scenarios. NOT a test of implementation behavior.
**Created**: 2026-07-14
**Feature**: [spec.md](../spec.md) | [plan.md](../plan.md)

**Scope**: analysis failure after a successful graph update (FR-022/FR-022a/SC-008); first-run failure → explicit "unavailable" vs available-but-empty (FR-023); disabled/unconfigured dormancy (FR-019/FR-024/FR-025); MCP/REST success-shaped guidance and the `isError` boundary (FR-030/SC-009, Constitution VI); staleness that never blocks reads; atomic swap / torn-read avoidance (FR-021/FR-021a).

## Failure Isolation & Analysis Lifecycle

- [ ] CHK001 Is the term "catalog analysis failure" defined with an explicit boundary — is it specified that every failure mode (compute exception, resource exhaustion, AND persistence/atomic-swap commit failure) is caught inside the analysis step so it can never propagate to fail the enclosing index/sync? [Ambiguity, Gap, Spec §FR-022]
- [ ] CHK002 Are requirements defined for a mixed per-catalog outcome — both catalogs enabled, one catalog's analysis succeeds while the other fails in the same index/sync run — specifying that the succeeding catalog swaps fresh while the failing one independently retains its prior catalog as stale? [Coverage, Gap, Exception Flow, Spec §FR-020/§FR-022]
- [ ] CHK003 Is it specified whether catalog analysis runs (and whether `graph_write_version` advances) after a PARTIAL index (files silently dropped, `index_state='partial'`) versus only after a fully-complete index? [Ambiguity, Gap, Spec §FR-020/§FR-022]
- [ ] CHK004 Are requirements defined for cancellation/abort of catalog analysis (index/sync abort signal) — is a cancelled analysis a failure that retains the prior catalog as stale, or a no-op that leaves the prior catalog fresh? [Coverage, Gap, Exception Flow]
- [ ] CHK005 Is the requirement that a post-graph-update analysis failure "still reports the index/sync as successful" stated as a measurable, testable outcome? [Measurability, Spec §SC-008]
- [ ] CHK006 Is `graph_write_version` advance timing specified precisely enough (advanced on the successful graph-update commit, before analysis runs) that a subsequent analysis failure deterministically derives the retained catalog as stale? [Clarity, Spec §FR-022]

## Catalog State Model & First-Run Failure

- [ ] CHK007 Are all catalog read-time states enumerated and mutually distinguished in the requirements — available, stale, unavailable, available-but-empty, and disabled/never-computed? [Completeness, Spec §Key Entities: Catalog]
- [ ] CHK008 Is the first-run analysis failure required to surface an explicit "unavailable" state that is machine-distinguishable (a structured state value, not only prose) from "available-but-empty" at every consumer surface, or does the surface contract expose only `state: available|stale` and conflate unavailable/disabled/empty into an empty `items` list? [Consistency, Conflict, Gap, Spec §FR-023 vs contracts/mcp-tools.md §Result]
- [ ] CHK009 Is "available-but-empty" (e.g. no detectable entry points) defined as distinct from both "unavailable" and "disabled," with a clear trigger (tokens equal, zero content rows)? [Clarity, Spec §Edge Cases / §Key Entities: Catalog]
- [ ] CHK010 Is "empty-looking data" (the thing FR-023 forbids for the unavailable state) defined against the actual surface response shape — i.e., is it stated that an empty `items` array alone MUST NOT be the sole representation of the unavailable state? [Ambiguity, Gap, Spec §FR-023]
- [ ] CHK011 Is derived staleness (recorded token < live token) specified as a computed comparison rather than a stored mutable flag? [Clarity, Spec §FR-022]

## Surface Error-Shaping (MCP / REST — FR-030, Constitution VI)

- [ ] CHK012 Does the FR-030 / SC-009 enumeration of success-shaped "expected conditions" include the unavailable (first-run-failure) and available-but-empty states, or are those two states' shaping left unstated while the contracts already treat them as success-shaped? [Completeness, Conflict, Gap, Spec §FR-030/§SC-009 vs contracts/mcp-tools.md §Shared conventions]
- [ ] CHK013 Is the boundary between an "expected condition" (success-shaped) and a "genuine malfunction" (`isError`, per Constitution VI) explicitly drawn for the three new tools — specifically, is a first-run analysis failure classified as an expected condition (success-shaped) rather than a malfunction? [Ambiguity, Gap, Spec §FR-030, Constitution §VI]
- [ ] CHK014 Are requirements defined for genuine (non-expected) read-time malfunctions of the new tools/endpoints — e.g. a corrupt/unreadable catalog or SQL error — specifying that they reuse the existing `isError`-with-retry catch rather than an unshaped throw or a torn/empty result? [Coverage, Gap, Spec §FR-030]
- [ ] CHK015 Is success-shaped handling required on BOTH surfaces for the same conditions, with REST returning a 2xx (not 4xx/5xx) for not-indexed / disabled / stale / unknown-id / empty? [Consistency, Spec §FR-030/§FR-028, contracts/rest-api.md]
- [ ] CHK016 Are MCP and REST required to share identical field semantics for error/edge states so the two surfaces cannot drift? [Consistency, Spec §FR-028/§SC-009]

## Dormancy — Disabled / Unconfigured States

- [ ] CHK017 Is the LLM display-label CONFIGURED-but-FAILING path specified — must an LLM label call failure be swallowed (canonical label retained, display label null) without failing catalog analysis or marking the catalog stale/unavailable, mirroring the advisory embedding-pass precedent? [Coverage, Gap, Exception Flow, Spec §FR-019]
- [ ] CHK018 Is it required that an LLM label call failure never leaks the configured endpoint URL or API key/credential in any surfaced error or log line (the embedding pass surfaces only the error NAME for total redaction)? [Security, Gap, Spec §FR-019]
- [ ] CHK019 Is FR-019's "no model call when unconfigured" backed by a measurable success criterion (zero model calls / byte-identical output), analogous to SC-007 for opt-in dormancy? [Measurability, Gap, Spec §FR-019 vs §SC-007]
- [ ] CHK020 Is disabled / not-opted-in dormancy specified as zero analysis work, zero catalog rows, zero catalog metadata, and byte-identical behavior — and is it measurable? [Completeness, Measurability, Spec §FR-025/§SC-007]
- [ ] CHK021 Is per-catalog independent opt-in specified (one catalog enabled, the other not), including its effect on whether `graph_write_version` is maintained? [Completeness, Spec §FR-024, data-model.md]

## Atomic Swap & Torn-Read Avoidance

- [ ] CHK022 Is the atomic single-transaction swap specified with explicit reader-isolation semantics (a concurrent reader — including a daemon query connection under WAL snapshot isolation — observes the complete prior OR the complete new catalog, never a partial one)? [Completeness, Spec §FR-021]
- [ ] CHK023 Is a swap/commit failure (the replacement transaction fails to commit) explicitly classified as a "catalog analysis failure" that retains the prior catalog and derives as stale, closing the failure taxonomy? [Coverage, Gap, Spec §FR-021/§FR-022]
- [ ] CHK024 Are multi-statement composite reads (a `total` count alongside a paged slice) required to derive from a single consistent snapshot to avoid a torn cross-generation response? [Completeness, Spec §FR-021a]
- [ ] CHK025 Is the WAL-unavailable degradation path (writer-blocks-reader on virtualized/network mounts) specified so the all-or-nothing guarantee is preserved? [Coverage, Spec §FR-021a]
- [ ] CHK026 Is concurrent-writer safety addressed (whether two index/sync analyses can race on the same catalog), or is it left to the existing index/sync file-lock serialization without a stated requirement? [Coverage, Spec §FR-021]

## Staleness Semantics (surfaced, never blocking)

- [ ] CHK027 Is it explicitly required that a stale catalog stays fully readable — staleness surfaces a marker (state + recorded version) but never blocks, withholds, or empties the paged items? [Clarity, Spec §FR-022/§US4 Scenario 3]
- [ ] CHK028 Is the retained-stale catalog's dangling-node-id handling specified (denormalized name/kind kept, unresolvable fields render as an explicit placeholder, never an error)? [Completeness, Spec §FR-022a]
- [ ] CHK029 Is the interaction between staleness and the available-but-empty state defined — can a zero-entry catalog become stale, and does a "stale-empty" catalog stay distinguishable from unavailable (recorded token non-null)? [Coverage, Spec §FR-022 vs §Key Entities: Catalog]

## Notes

- Items marked `[Gap]`, `[Conflict]`, or `[Ambiguity]` denote a requirements-quality defect in spec.md/plan.md; each is remediated in the parallel gap-analysis report (proposed FR/SC/edge-case/contract text). Items without those markers reference an existing, adequately-specified requirement and are expected to pass.
- Grounding: the `isError`-vs-success-shaped discipline is codified in Constitution §VI and implemented in `src/mcp/tools.ts` (`ToolHandler.execute` catch: `NotIndexedError`→`textResult` success-shaped; `PathRefusalError`/malfunction→`isError`+retry). The advisory "never fail the index" precedent for FR-022 is `maybeRunEmbeddingPass` (`src/index.ts` — try/catch at both indexAll and sync call sites, internally non-throwing, only the error NAME surfaced for total endpoint/key redaction). The single-snapshot read precedent for FR-021a is full-fetch-then-slice in `src/mcp/read-ops.ts`.
