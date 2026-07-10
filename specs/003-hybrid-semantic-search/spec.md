# Feature Specification: Hybrid Semantic Search

**Feature Branch**: `003-hybrid-semantic-search`

**Created**: 2026-07-09

**Status**: Draft

**Input**: User description: "Hybrid Semantic Search (SPEC-003) — fuse keyword hits with vector KNN via reciprocal-rank fusion so paraphrase / natural-language queries surface semantically relevant symbols, degrading gracefully to keyword whenever vectors or a provider are absent."

## User Scenarios & Testing *(mandatory)*

<!--
  User stories are prioritized as independently testable slices. Each maps back to the
  design-concept Q&A log (docs/ai/specs/.process/SPEC-003-design-concept.md) so scope
  traces to a resolved decision.
-->

### User Story 1 - Paraphrase query surfaces semantic matches (US1) (Priority: P1)

An AI agent (or developer) issues a natural-language / paraphrase query such as
"function that retries failed HTTP calls" against a project whose symbols already
carry embedding vectors. The search fuses keyword hits with vector nearest-neighbor
matches so relevant symbols surface even when their names share no tokens with the
query. Each returned hit carries provenance describing which arm(s) matched it.

**Why this priority**: This is the reason the feature exists — semantic recall for
queries that keyword-only search misses. Without it, nothing else delivers value.

**Independent Test**: With fixture vectors present, run a paraphrase query in
semantic/hybrid mode and confirm the fused result set contains semantically relevant
symbols that keyword-only search omits, each annotated with its match provenance.

**Acceptance Scenarios**:

1. **Given** a project with matching-model vectors and a warmed provider, **When** a user runs a paraphrase query in hybrid mode, **Then** the results are the reciprocal-rank fusion of the keyword and vector arms and include semantically relevant symbols absent from the keyword-only result.
2. **Given** the same query and index, **When** it is run again, **Then** the returned ordering is byte-identical (deterministic ranking with stable tie-breaks).
3. **Given** a hybrid or semantic query, **When** results are returned, **Then** every hit carries a `matchType` of `keyword`, `semantic`, or `both` plus the fused score.

---

### User Story 2 - Explicit mode selection with auto resolution (US2) (Priority: P2)

A developer or agent selects a search mode — `keyword`, `semantic`, or `hybrid` — on
the CLI search surface or the `codegraph_search` MCP tool. When mode is unspecified at
those explicit surfaces, it resolves to `auto`: hybrid when matching-model vectors
exist, otherwise keyword.

**Why this priority**: Gives users deterministic control and a sensible default at the
surfaces, but the core semantic value (US1) is deliverable before the full mode matrix
is exposed.

**Independent Test**: Invoke the CLI/MCP surface with each explicit mode and with no
mode, and confirm the resolved behavior matches the mode selected (or the auto rule).

**Acceptance Scenarios**:

1. **Given** the MCP or CLI surface, **When** a user passes `mode: keyword|semantic|hybrid`, **Then** the search runs exactly that arm configuration.
2. **Given** the MCP or CLI surface with no mode specified and matching-model vectors present, **When** a user searches, **Then** the mode resolves to hybrid.
3. **Given** the MCP or CLI surface with no mode specified and no matching-model vectors, **When** a user searches, **Then** the mode resolves to keyword.

---

### User Story 3 - Graceful degradation, never an error (US3) (Priority: P1)

A user searches on a project that has no vectors, no configured provider, a provider
that is still warming, or where the query-embed exceeds its time budget. In every one
of these situations the user still receives useful keyword results accompanied by a
success-shaped hint — never an error response.

**Why this priority**: An error response teaches users and agents to abandon the tool.
Degradation must be safe on day one for US1 to be shippable at all, so this is P1.

**Independent Test**: Run a search under each degraded condition (no vectors, no
provider, warming provider, embed timeout) and confirm the response is success-shaped
keyword results with a hint, and never an error.

**Acceptance Scenarios**:

1. **Given** a project with no vectors or no configured provider, **When** a user searches in auto/semantic/hybrid mode, **Then** keyword results are returned with a success-shaped hint and no error.
2. **Given** the first hybrid-eligible query after the daemon starts, **When** the provider is still initializing, **Then** that query is served keyword-only with a success-shaped "semantic warming" note, and later queries fuse once the provider is ready.
3. **Given** a query whose embedding exceeds the internal per-query embed budget, **When** the budget elapses, **Then** the query falls back to keyword results plus a hint, never an error.

---

### User Story 4 - Existing keyword behavior is untouched (US4) (Priority: P1)

Existing consumers see no change. The library `searchNodes` default mode is keyword,
internal callers (explore, prompt hook, context builder) receive byte-identical results,
and every existing filter (`kind:`, `lang:`, `path:`, `name:`) behaves identically in
every mode. Keyword-mode result shapes gain no new fields.

**Why this priority**: This is a tracking-fork dormancy invariant — a retrieval-affecting
regression to the primary tools is unacceptable, so no-harm is P1 alongside the new value.

**Independent Test**: Run the existing keyword-search cases and internal-caller paths and
confirm results and shapes are byte-identical to the pre-feature baseline.

**Acceptance Scenarios**:

1. **Given** a library caller that does not specify a mode, **When** it calls `searchNodes`, **Then** the behavior and result shape are byte-identical to today's keyword search.
2. **Given** internal callers (explore, prompt hook, context builder), **When** they search, **Then** they receive keyword results with no query-embed latency and no shape change.
3. **Given** any of the `kind:`, `lang:`, `path:`, `name:` filters, **When** used in keyword, semantic, or hybrid mode, **Then** the filter semantics are identical across all three modes.

---

### Edge Cases

- **Provider warming**: The first hybrid-eligible query triggers lazy provider init and is served keyword with a warming note; subsequent queries fuse once ready.
- **Embed timeout**: Query-embed exceeds the internal budget → keyword results + hint, never an error.
- **No vectors / no provider**: Auto resolves to keyword; explicit semantic/hybrid still returns keyword + hint.
- **Model mismatch**: Vectors whose model differs from the active provider's model are excluded from the KNN cache and scan (only matching-model vectors participate).
- **Index staleness mid-session**: A cheap per-query staleness probe (vector count + data_version) invalidates and rebuilds the in-memory matrix cache when the index changed.
- **Filter removes all semantic candidates**: `kind:`/`lang:` pre-filtering the scan before top-k must never starve top-k with filtered-out rows; a fully-filtered scan yields keyword-only fusion input.
- **Query is only filter tokens**: With filter tokens stripped the embed input may be empty — the semantic arm contributes nothing and results fall back to keyword.
- **Large-index memory corner**: A 50k×3584 vector matrix (~717 MB resident) is documented as the boundary where quantization/ANN (named follow-up) becomes necessary.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The library `searchNodes` API MUST accept a search mode of `keyword`, `semantic`, `hybrid`, or `auto`, and the library default MUST be `keyword` — byte-identical to today's behavior when unspecified (Q1).
- **FR-002**: The explicit surfaces — the `codegraph_search` MCP tool and CLI search — MUST resolve an unspecified mode to `auto`, which selects hybrid when matching-model vectors exist and keyword otherwise (Q1).
- **FR-003**: Internal callers (explore, prompt hook, context builder) MUST continue to receive keyword results with no query-embed latency and no result-shape change (Q1).
- **FR-004**: In semantic and hybrid modes the system MUST fuse FTS5 keyword hits with vector nearest-neighbor (KNN) hits using reciprocal-rank fusion with `k=60` (roadmap; design Goals).
- **FR-005**: The query-time embedding provider MUST initialize lazily on the first hybrid-eligible query; that first query MUST be served keyword-only with a success-shaped "semantic warming" note, and later queries MUST fuse once the provider is ready (Q4).
- **FR-006**: The per-query embed wait MUST be capped at an internal budget of approximately 2 seconds; on timeout or provider failure the system MUST fall back to keyword results plus a hint and MUST NOT return an error response (Q4).
- **FR-007**: The feature MUST NOT introduce any new environment variables or user-facing tuning knobs for the embed budget or cache size; these MUST be internal, documented constants (Q4, Q6; Constitution II).
- **FR-008**: The fusion compute path — vector scan + top-k selection + RRF merge — MUST meet a p95 latency of ≤150 ms at 50k nodes; the query-embed leg (endpoint HTTP round trip or in-process inference) MUST be reported but MUST NOT be gated (Q5).
- **FR-009**: The KNN scan MUST use a lazily built in-memory single-precision matrix cache covering all vectors whose model matches the active provider's model, invalidated per query by a cheap staleness probe (vector count + data_version); resident memory equals count×dims×4 bytes and MUST be documented (Q6).
- **FR-010**: The `kind:`, `lang:`, and `options.kinds` filters MUST pre-filter the vector scan before top-k selection (so filtered-out rows never consume top-k slots), while `path:` and `name:` MUST remain post-fusion hard gates (Q7).
- **FR-011**: The embedding input for the semantic arm MUST be the parsed query text with filter tokens stripped, mirroring how FTS receives it (Q7).
- **FR-012**: Results in semantic and hybrid modes MUST carry an optional `matchType` of `keyword`, `semantic`, or `both` plus the fused score; these fields MUST be absent in keyword mode so existing result shapes stay byte-identical, and the `codegraph_search` / CLI surfaces MUST annotate hits with their provenance (Q8).
- **FR-013**: Ranking MUST be deterministic for identical input — identical query and index MUST produce identical ordering via stable tie-breaks (Constitution V).
- **FR-014**: CI gates MUST run inside `npm test` using injected deterministic fixture vectors (no live provider), asserting: hybrid hit-rate ≥ keyword on the paraphrase set; existing keyword cases byte-stable; and p95 fusion compute over a generated 50k×384-dim fixture ≤150 ms. The scored `npm run eval` report MUST gain the same semantic cases (Q9).
- **FR-015**: A project with no vectors, no provider, a warming provider, or an embed timeout MUST still return useful keyword results with a success-shaped hint in auto, semantic, or hybrid mode (US3; Q4).
- **FR-016**: All existing filters (`kind:`, `lang:`, `path:`, `name:`) MUST produce identical filtering semantics in keyword, semantic, and hybrid modes (US4; Q7).

### Reviewability Budget *(mandatory)*

- **Primary surface**: API (library `searchNodes` + `codegraph_search` MCP tool + CLI search)
- **Secondary surfaces, if any**: harness/adapter (vitest fixture-vector gates + `npm run eval` cases)
- **Projected reviewable LOC**: ~195 (roadmap estimator; setup reviewability gate passed with zero warnings against thresholds 400/6/15)
- **Projected production files**: ~4
- **Projected total files**: ~10
- **Budget result**: within budget
- **Split decision**: Remains one spec — a single thin vertical slice (query → fusion logic → library/MCP/CLI surfaces). No split (design-concept slice-sizing: pass, zero warnings).

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order, scope budget, traceability, verification evidence, known gaps, and rollback or feature-flag notes.
- Traceability MUST map each major requirement or success criterion to changed files and verification evidence.
- Deferred work MUST name the follow-up spec or issue (explore-side semantic fusion is deferred to a future A/B-gated roadmap entry, per design-concept Open Questions Q2/Q3).

### Key Entities *(include if feature involves data)*

- **Search mode**: The requested retrieval strategy — `keyword`, `semantic`, `hybrid`, or `auto`. Library default is `keyword`; explicit surfaces default to `auto`.
- **Search result (provenance)**: An existing result optionally extended, in semantic/hybrid modes only, with `matchType` (`keyword`|`semantic`|`both`) and the fused RRF score.
- **Vector matrix cache**: A lazily built in-memory single-precision matrix of all matching-model vectors, carrying per-row kind and language for pre-filtering, invalidated by a vector-count + data_version staleness probe.
- **Query embedding / provider**: The active embedding provider (endpoint HTTP or in-process model) that turns the filter-stripped query text into a query vector, initialized lazily with a keyword-while-warming fallback and a per-query embed budget.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the paraphrase evaluation set, hybrid mode returns at least as many relevant symbols as keyword-only search (hybrid hit-rate ≥ keyword hit-rate).
- **SC-002**: Fusion compute (scan + top-k + RRF) completes within 150 ms at the 95th percentile on a 50k-node fixture.
- **SC-003**: Under every degraded condition (no vectors, no provider, warming provider, embed timeout), 100% of searches return success-shaped keyword results with a hint — zero error responses.
- **SC-004**: Existing keyword queries and internal-caller paths return byte-identical results and shapes to the pre-feature baseline — zero keyword regressions.
- **SC-005**: 100% of hits returned in semantic/hybrid mode are labeled with their match provenance; keyword-mode results carry no added fields.
- **SC-006**: Repeated runs of an identical query against an unchanged index produce identical result ordering (deterministic ranking).

## Assumptions

- SPEC-001/002 already persist an embedding vector for every declaration symbol, tagged with its model, dimensionality, and a `data_version` usable for the staleness probe.
- The active query-time provider is either the configured embedding endpoint or the in-process bundled model delivered by SPEC-002; no new provider is introduced here.
- Reciprocal-rank fusion uses `k=60` as specified by the technical roadmap.
- CI has no live embedding provider; the paraphrase and performance gates run against injected deterministic fixture vectors, with the p95 gate fixed at 50k×384 dimensions (the zero-config bundled-model reality) and the 3584-dim figure reported but not gated.
- The existing brute-force vector scan (blessed in SPEC-001) is sufficient at current scale; ANN indexes and quantization are an out-of-scope follow-up invoked only when scale demands.
- Pre-merge validation includes a scoped agent A/B (`scripts/agent-eval/ab-new-vs-baseline.sh`, both arms codegraph-on, ≥2 runs/arm, Sonnet floor) plus a no-vectors control repo expecting zero delta, per Constitution VI, with results recorded in the UAT runbook.
