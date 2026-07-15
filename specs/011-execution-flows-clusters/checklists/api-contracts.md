# API Contracts Checklist: Execution Flows & Clusters (SPEC-011)

**Purpose**: Requirements-quality validation ("unit tests for English") of the SPEC-011 API contracts — the three MCP tools (`codegraph_list_flows`, `codegraph_get_flow`, `codegraph_list_clusters`) and two REST endpoints (`/api/flows`, `/api/clusters`) — focused on paging determinism, `minSize` filtering, `get_flow` truncation shape, success-shaped conditions, and MCP↔REST parity/drift. Tests whether the requirements are complete, clear, consistent, and measurable — NOT whether code works.
**Created**: 2026-07-14
**Feature**: [spec.md](../spec.md) · Contracts: [contracts/mcp-tools.md](../contracts/mcp-tools.md), [contracts/rest-api.md](../contracts/rest-api.md) · [data-model.md](../data-model.md)

**Scope note**: Domain = api-contracts. A Gap-tagged item flags a missing/underspecified requirement needing remediation; the dimension tags `[Completeness]`/`[Clarity]`/`[Consistency]`/`[Measurability]`/`[Coverage]`/`[Ambiguity]`/`[Conflict]`/`[Assumption]` name the requirement-quality dimension the item probes (a "passing" probe carries a spec/contract reference).

## Requirement Completeness

- [ ] CHK001 Is a machine-readable state discriminator specified on the wire for BOTH surfaces to distinguish `disabled` / `not-indexed` / `unavailable` / `available-but-empty` — or do the contracts expose only `state: "available" | "stale"` (mcp-tools.md list Result; rest-api.md Shared conventions) and rely on free-text guidance for the other four conditions the spec's Catalog entity enumerates? [Gap] [Completeness, spec §Key Entities Catalog, FR-030]
- [ ] CHK002 Does the REST contract specify the response envelope schema that carries `sourceVersion` and `state` alongside the paged items, given that the reused SPEC-005 `ListResult` (openapi.yaml:116-123) has neither field and types `items` as `Node`? [Gap] [Completeness, rest-api.md §GET /api/flows / §openapi additions, FR-028]
- [ ] CHK003 Are the `minSize` semantics fully specified on both `codegraph_list_clusters` and `/api/clusters` — default 1, values `<1` clamp to 1, `member_count >= minSize` inclusion, and `total` reflecting the post-filter count? [Completeness, FR-029, mcp-tools.md §list_clusters, rest-api.md §GET /api/clusters]
- [ ] CHK004 Is denormalized display identity (symbol `name`/`kind`) and an explicit placeholder-when-unresolved specified for `get_flow` steps whose `nodeId` no longer resolves after ordinary edits? [Completeness, FR-022a, mcp-tools.md §get_flow steps]
- [ ] CHK005 Are all three MCP tools and both REST endpoints (plus `/api/flows/{id}`) enumerated with inputs, item shapes, sorts, and result envelopes in the contract docs? [Completeness, FR-027/FR-028, contracts/*]
- [ ] CHK006 Is `sourceVersion` (the recorded `graph_write_version`) required on stale reads so a consumer can identify which graph version a stale catalog was computed from? [Completeness, FR-022, mcp-tools.md §list Result]

## Requirement Clarity

- [ ] CHK007 Are the page-size bounds quantified unambiguously for each surface — MCP `limit` default 20 / clamp 1–100, REST `Limit` default 100 / max 500, zero-based `offset`/`Offset` default 0? [Clarity, mcp-tools.md §Shared conventions, rest-api.md §Shared conventions, openapi.yaml:61-69]
- [ ] CHK008 Is the collation/ordering semantics of the string sort keys (`name`, `canonicalLabel`) pinned — case sensitivity and Unicode/byte-vs-locale ordering — AND is it specified that the sort is applied once in the shared read path rather than independently per surface, so MCP (JS) and REST (SQL) cannot order equal-prefix rows differently? [Gap] [Clarity, FR-027/FR-028, mcp-tools.md §Sort, data-model.md:40/71]
- [ ] CHK009 Is the `get_flow` truncation metadata's exact shape `{ truncated, truncation: { depth, width, totalSteps } }` specified with `truncated` defined as the disjunction of the three independent axis flags? [Clarity, FR-027, mcp-tools.md §get_flow, data-model.md:34-39]
- [ ] CHK010 Is the `provenance` field on flow steps specified as a three-value enum `static | lsp | heuristic` WITH its mapping from the internal 4-value `EDGE_PROVENANCES` (tree-sitter/scip/lsp/heuristic), and is the deliberate divergence from the existing 2-value wire `Edge.provenance` (`[static, heuristic]`, which collapses `lsp`→`static`) called out so the openapi `FlowStep` schema does not inherit the wrong enum? [Gap] [Clarity, mcp-tools.md §get_flow, data-model.md:55, openapi.yaml:115]
- [ ] CHK011 Is "clamp, never errors" for over-cap page sizes stated for both surfaces? [Clarity, mcp-tools.md §Shared conventions, openapi.yaml:65]

## Requirement Consistency (MCP↔REST parity / drift)

- [ ] CHK012 Beyond FR-028's assertion that the two surfaces "cannot drift," does any requirement mandate a concrete drift-prevention mechanism — a single shared wire-shape definition/type feeding both surfaces, or a cross-surface field-name/semantics parity test — that would actually enforce the identity of field names and item shapes? [Gap] [Consistency, FR-028/SC-009, plan.md §Structure Decision]
- [ ] CHK013 Do the contracts establish a single normative field-name list that REST defers to (rest-api.md §Shared conventions names `id, name, entryKind, stepCount, truncated, canonicalLabel, displayLabel, memberCount, isSingleton` + the `get_flow` step/truncation shapes)? [Consistency, FR-028]
- [ ] CHK014 Is the reuse of SPEC-005 `ListResult` / `Limit` / `Offset` components stated for the REST endpoints? [Consistency, FR-028, rest-api.md §openapi additions]
- [ ] CHK015 Is the intentional per-surface page-size divergence (MCP default 20/max 100 vs REST default 100/max 500) explicitly documented as sanctioned rather than accidental drift? [Consistency, FR-028, contracts §Shared conventions]
- [ ] CHK016 Is the REST `/api/flows/{id}` unknown-id behavior (200 success-shaped, NOT 404) documented as an intentional divergence from REST convention to keep condition-handling identical to MCP? [Consistency, FR-030, rest-api.md §GET /api/flows/{id}]
- [ ] CHK017 Is the `entryKind` enum (`route | cli | event | export`) consistent between the contract item shapes and the Entry Point entity / FR-001, and shared identically by both surfaces? [Consistency, FR-001, mcp-tools.md §list_flows, data-model.md:30]

## Acceptance Criteria & Measurability

- [ ] CHK018 Does FR-031 ("MUST NOT modify `codegraph_explore`'s behavior or output") carry a measurable acceptance criterion — a byte-identical/golden-output check for existing queries and an assertion that `server-instructions.ts` and the explore handler are untouched — or is it verified only by manual retrieval-guardian review? [Gap] [Measurability, FR-031/Q16, plan.md §Constitution Check VI]
- [ ] CHK019 Is the deterministic sort measurable/objectively verifiable — i.e., totally ordered by ending in the unique stable id (flows: `name,id`; clusters: `member_count desc, canonicalLabel, id`) so a given page is reproducible? [Measurability, FR-027/SC-004, data-model.md:40/71]
- [ ] CHK020 Is SC-009's "MCP and REST return the same field semantics for the same catalog data" expressed so it can be objectively checked against a concrete parity oracle? [Measurability, SC-009] (depends on CHK012)
- [ ] CHK021 Is the single-snapshot requirement for a composed `total`+paged-slice read (FR-021a) stated so the list envelope cannot return a torn cross-generation `total`/`items` pair? [Measurability, FR-021a, read-ops.ts precedent]

## Scenario & State Coverage (success-shaped conditions)

- [ ] CHK022 Are the success-shaped (never `isError`) requirements enumerated for EVERY expected MCP condition — not indexed, disabled, stale, unknown id, available-but-empty? [Coverage, FR-030, mcp-tools.md §Shared conventions]
- [ ] CHK023 Is it required that REST returns 200 (never a 4xx/5xx) for every ordinary catalog state, reserving error status codes for genuine transport/auth faults? [Coverage, FR-030, rest-api.md §Shared conventions]
- [ ] CHK024 Is the stale-read scenario covered — prior items returned WITH a staleness note and the recorded `sourceVersion`, on both list surfaces? [Coverage, FR-022, mcp-tools.md §list Result, rest-api.md §Shared conventions]
- [ ] CHK025 Is the available-but-empty scenario (tokens equal, zero content rows — e.g. no detectable entry points) covered as a distinct success-shaped empty page, separate from disabled/unavailable? [Coverage, spec §Edge Cases, data-model.md:102] (wire-level distinguishability tracked in CHK001)

## Edge Case Coverage

- [ ] CHK026 Is the coercion of malformed numeric query parameters specified — non-integer (`2.5`) or non-numeric (`abc`) `limit`/`offset`/`minSize`, which on the REST surface always arrive as strings — given that "clamp, never errors" addresses only out-of-range values, not type coercion? [Gap] [Edge Case, FR-029, rest-api.md §Shared conventions, read-ops.ts:171 Number() precedent]
- [ ] CHK027 Is the relationship between `get_flow`'s `root` object and its `steps[]` array specified — whether the root is ALSO emitted as the depth-0 step (data-model.md:52-56 stores it in `flow_steps` with `edge_kind`/`parent_node_id` NULL), whether `stepCount` and the 200-step cap count the root, and what `provenance` value the root step carries given FR-009 requires every step to carry the provenance of an incoming call edge the root does not have? [Gap] [Conflict, FR-009, mcp-tools.md §get_flow, data-model.md:52-56]
- [ ] CHK028 Is the offset-beyond-`total` case defined (empty `items`, correct `total`), consistent with the reused SPEC-005 full-fetch-then-slice paging? [Edge Case, FR-028, read-ops.ts:184-191 precedent]
- [ ] CHK029 Are simultaneous multi-axis truncations covered so each applicable axis flag (`depth`/`width`/`totalSteps`) is recorded independently and none is silently dropped? [Edge Case, spec §Edge Cases, FR-007, mcp-tools.md §get_flow]

## Ambiguities, Conflicts & Assumptions

- [ ] CHK030 Is the summary-vs-detail split intentional and non-conflicting — list items expose only `truncated: boolean` while `get_flow` exposes the full per-axis `truncation` object? [Consistency, FR-027, mcp-tools.md §list_flows / §get_flow]
- [ ] CHK031 Is `displayLabel` unambiguously specified as presentation-only, `null` when no LLM is configured, and never affecting membership/identity/sort — so its dormant-here value cannot alter the catalog contract? [Ambiguity, FR-019, mcp-tools.md §list_clusters item, data-model.md:66]
- [ ] CHK032 Is the assumption that REST list responses can reuse the Node-typed SPEC-005 `ListResult` validated, or does it silently assume a generic/overridden `items` type that the openapi additions must introduce? [Assumption, FR-028, openapi.yaml:120] (remediation tracked in CHK002)

## Notes

- Gap-marked items (8): CHK001, CHK002, CHK008, CHK010, CHK012, CHK018, CHK026, CHK027. Each has a proposed remediation returned to the orchestrator; this is a report-only run — shared artifacts are NOT edited by this agent.
- Traceability: every item carries a spec §, FR, contract §, data-model, or codebase file:line reference (≥80% requirement met).
- This checklist validates requirement quality only; implementation verification (tests, probes, benchmarks) is out of scope for this domain.
