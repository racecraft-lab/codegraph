# Feature Specification: Embedding Infrastructure & Endpoint Provider (SPEC-001)

**Feature Branch**: `001-embedding-infrastructure`

**Created**: 2026-07-04

**Status**: Draft

**Input**: User description: "Build the embedding substrate for CodeGraph: every indexed declaration-level symbol gets a vector computed through a user-configured OpenAI-compatible embedding endpoint, incrementally and resiliently, with the feature fully dormant when unconfigured (zero behavior change, zero network traffic). Semantic retrieval (SPEC-003) and downstream intelligence features (SPEC-011 labels, SPEC-019 wiki) consume the provider interface and the persisted vectors."

## User Scenarios & Testing *(mandatory)*

<!--
  Slice A = P1 (configure + full-index embedding) is a viable MVP on its own.
  Slice B = P2 + P3 (incremental freshness, backfill, resilience) builds on Slice A.
-->

### User Story 1 - Configure and embed on index (Slice A) (Priority: P1)

A user who runs a local or remote OpenAI-compatible embedding endpoint (Ollama, LM Studio, vLLM, a hosted OpenAI-compatible API, etc.) wants semantic vectors over their code. They set the endpoint URL and the model name, run a full index, and every declaration-level symbol comes out with a persisted vector. They confirm coverage by running the status command, which shows the endpoint/backend, the active model, the vector dimension, and 100% coverage.

**Why this priority**: This is the substrate the entire Intelligence Platform stands on — no vectors, no semantic retrieval (SPEC-003), no vector-consuming intelligence features (SPEC-011 labels, SPEC-019 wiki). It is the smallest slice that delivers a complete, observable capability: a configured user gets fully-populated vectors and can see that they are complete. Nothing downstream can start until this exists.

**Independent Test**: Configure the endpoint URL and model, run a full index against a real project, and verify via the status command that coverage over embeddable symbols is 100%, that the reported model and dimension match the configuration/endpoint, and that a spot-checked symbol has a stored vector of the expected dimension. Delivers value with no dependency on Slice B.

**Acceptance Scenarios**:

1. **Given** an endpoint URL and model are configured and a project has never been indexed, **When** the user runs a full index, **Then** every declaration-kind symbol has a persisted vector and status reports 100% coverage, the active model, and the vector dimension.
2. **Given** no endpoint URL or no model is configured, **When** the user runs a full index, **Then** no embedding network request is made, no vectors are written, index results are identical to today, and status indicates the embedding feature is dormant (not an error).
3. **Given** an endpoint that requires no API key (a keyless local endpoint), **When** the user configures only URL and model and runs an index, **Then** embedding succeeds without an API key being set.
4. **Given** the dimension is not explicitly configured, **When** the first batch of vectors returns, **Then** the system infers the dimension from that batch, persists it, and reports it in status.

---

### User Story 2 - Incremental freshness on edit (Slice B) (Priority: P2)

A user actively editing code wants vectors to stay fresh without paying to re-embed the whole project on every change. Each sync — whether run explicitly from the CLI or triggered automatically by the background daemon's file watcher — re-embeds only the symbols whose embedding input genuinely changed and removes vectors for symbols that were deleted, keeping the vector layer current at negligible endpoint cost.

**Why this priority**: Freshness is what makes the feature usable day-to-day rather than a one-time batch job. It depends on Slice A (there must be vectors to keep fresh), so it is P2. Without it, vectors drift stale as code changes and the user must re-index fully to recover accuracy.

**Independent Test**: With a fully-embedded project (Slice A complete), edit one symbol's body, delete another symbol, and run a sync. Verify that exactly the edited symbol is re-embedded, the deleted symbol's vector is gone, and untouched symbols are not re-embedded (e.g., by observing that the number of embedding requests matches the number of changed symbols, not the total).

**Acceptance Scenarios**:

1. **Given** a fully-embedded project, **When** the user edits one symbol's signature or body and runs a sync, **Then** only that symbol (and any others whose embedding input changed) is re-embedded and all other vectors are left untouched.
2. **Given** a fully-embedded project, **When** the user deletes a symbol and runs a sync, **Then** the vector for the removed symbol is deleted.
3. **Given** a fully-embedded project, **When** a rename or move occurs that does not change a symbol's embedding input, **Then** that symbol is not re-embedded.
4. **Given** the background daemon is watching the project, **When** a watched file changes and triggers an automatic sync, **Then** the embedding pass runs in that daemon sync exactly as it would in a CLI sync.

---

### User Story 3 - Late configuration and endpoint resilience (Slice B) (Priority: P3)

A user who indexed their project before configuring an endpoint later sets the URL and model; a plain sync backfills every missing vector with no special command to learn. Separately, if the endpoint goes down partway through a pass, the index/sync still completes successfully and the pass simply resumes from where it stopped on the next run.

**Why this priority**: This closes the two failure/latecomer paths that would otherwise strand users — configuring after the fact, and transient endpoint outages. It depends on the incremental machinery from Story 2 (backfill and resume are both "embed only what's missing/stale"), so it is P3. It is the resilience polish that makes the feature safe to leave on.

**Independent Test**: (a) Index a project with no endpoint configured (zero vectors), then configure the endpoint and run a single plain sync; verify coverage reaches 100% with no new command used. (b) Start a pass, make the endpoint unreachable partway through, and confirm the operation still reports success with partial vectors written; restore the endpoint, run again, and confirm coverage completes.

**Acceptance Scenarios**:

1. **Given** a project indexed before any endpoint was configured (zero vectors), **When** the user configures the endpoint and runs a plain sync, **Then** all missing vectors are backfilled and coverage reaches 100% — with no new or special command required.
2. **Given** an embedding pass is in progress, **When** the endpoint becomes unreachable, **Then** the system retries a bounded number of times, aborts the pass cleanly leaving already-written vectors in place, and the enclosing index/sync operation still reports success.
3. **Given** a pass previously aborted with some vectors missing, **When** the user runs the next index or sync with the endpoint reachable, **Then** the pass resumes and embeds the still-missing and still-stale symbols with no manual intervention.
4. **Given** the endpoint returns a vector whose dimension conflicts with the enforced dimension, **When** the pass runs, **Then** the system surfaces an actionable error naming `CODEGRAPH_EMBEDDING_DIMS`, treats the pass as failed, and the enclosing operation still succeeds.

---

### Edge Cases

- **Only one of URL/model set**: the feature stays fully dormant; both are required to activate. Status reflects dormant, not error.
- **Endpoint requires a key but none is set**: the resulting auth failure is handled as an endpoint failure (bounded retries, then advisory abort), never as a fatal error to the index/sync.
- **Active model changed between runs**: every stored row whose model no longer matches the active model is treated as stale and re-embedded (replaced), so switching models converges to a single-model store.
- **Dimension mismatch mid-run**: an endpoint returning a different dimension than the persisted/enforced one raises an actionable error naming `CODEGRAPH_EMBEDDING_DIMS` and aborts the pass advisorily.
- **Process killed mid-pass**: because progress is tracked by which nodes still lack a current vector, the next run resumes automatically — there is no separate resume checkpoint to corrupt.
- **Empty project or project with no embeddable symbols**: no embedding requests are made and coverage is trivially complete.
- **Very large project**: symbols are embedded in bounded batches; the abort/resume design keeps a failed pass from losing prior progress.
- **Endpoint intermittently slow/timing out**: treated as endpoint failure per the bounded-retry-then-advisory-abort path; the operation never hangs the index/sync indefinitely.

## Clarifications

### Session 2026-07-04 (Session 1 — Node identity & vector lifecycle)

- Q: Are symbol identities stable across re-index; is a vector-reuse cache needed? → A: Identities are deterministic text ids (derived from file path, kind, name, and start line — stable for unchanged content); no reuse cache. The full CLI re-index recreates the database and re-embeds by design; sync and library re-index preserve vectors for unchanged files.
- Q: Does the `variable` kind include function locals? → A: No — locals are never graph symbols; symbol selection is a flat kind-membership test (FR-005).
- Q: When a modified file's node rows are deleted and re-inserted, must re-embedding be strictly per-symbol (skip vectors for symbols in the touched file whose identity and input hash are unchanged), or is re-embedding every symbol in the touched file acceptable? → A: Strictly per-symbol. Node identity is a deterministic function of file path, kind, name, and start line, so an unaffected symbol regenerates the identical node id on re-extraction; the vector table carries no cascading delete from the node row, so its vector survives the file's node delete-and-reinsert cycle untouched. Vectors for symbols confirmed gone after re-extraction are removed by the explicit reconciliation in FR-017, not as a side effect of the file-level node delete. (Consensus: codebase-analyst + spec-context-analyst, both-agree, Round 1.)

### Session 2026-07-04 (Session 2 — Endpoint client behavior)

- Q: Where are the inferred/enforced dimension and active model persisted so enforcement survives restarts? → A: As project-metadata scalars (written on first successful batch, read at pass start), following the existing index-version stamp pattern; per-row model/dims columns stay self-describing integrity metadata (FR-004 updated).
- Q: Backoff parameters for 5xx/429, given abort-on-exhaustion (Q8)? → A: Base 1,000 ms, ×2 growth, full jitter, ~8 s per-delay cap, 3 retries per batch, honoring `Retry-After` on 429 (capped ~30 s); fixed constants, not env vars.
- Q: Embedding-input truncation cap? → A: Fixed ~6,000-character cap on the composed input, character-based (token counting would need a tokenizer dependency, FR-025); small-context models may still truncate server-side — accepted.
- Q: Defaults for batch size / concurrency / timeout? → A: 16 / 4 / 30,000 ms, all env-overridable with positive-int validation and clamping.

### Session 2026-07-04 (Session 3 — Status surface & slice boundary)

- Q: How is coverage computed given transient orphan vector rows (no-FK design)? → A: Join from live embeddable symbols to vector rows filtered to the active model; "current" = present ∧ model-match (input-hash staleness is a sync-time trigger, not a status-time check). FR-022 updated.
- Q: What does the status embedding section show, and does `--json` get parity? → A: Endpoint (redacted), model, dimension, coverage as `embedded/embeddable (NN%)`; a parallel `embedding` object in `--json` (required — automated probes read machine output).
- Q: What renders for the endpoint line (credential safety)? → A: Scheme + host + port only — userinfo, path, and query stripped; the API key never rendered anywhere (FR-023 extended). Strictest option chosen; security-flagged decision surfaced for operator review.
- Q: What shows when dormant? → A: A neutral (never warning-styled) dormant line naming the two activation variables; if vectors from a prior configured run exist on disk, their model/dims/coverage are also shown labeled "from a previous run" (disk-read only — dormancy preserved).
- Q: Does the progress surface gain an embedding phase? → A: Yes — `embedding` added to the progress phase union with a display label, emitted only when active, progress = embedded ÷ eligible.
- Q: Does the Q10 slice split map onto user stories? → A: Confirmed 1:1 — Slice A = US1 (including the full observability surface: status section, coverage, progress phase); Slice B = US2+US3. The "current = present ∧ model-match" reading removes the only straddle, so Slice A has no dependency on Slice B.

### Functional Requirements

#### Activation and configuration

- **FR-001**: The system MUST treat the embedding feature as active only when BOTH an embedding endpoint URL and an embedding model are configured (`CODEGRAPH_EMBEDDING_URL` and `CODEGRAPH_EMBEDDING_MODEL`). If either is absent, the feature MUST remain fully dormant.
- **FR-002**: When dormant, the system MUST make zero embedding-endpoint network requests and MUST produce index and sync results identical to a build without the feature (zero behavior change).
- **FR-003**: The embedding API key (`CODEGRAPH_EMBEDDING_API_KEY`) MUST be optional so that keyless local endpoints work; when the endpoint requires a key and none is supplied, the resulting authentication failure MUST be handled as an endpoint failure (see FR-019).
- **FR-004**: The embedding dimension (`CODEGRAPH_EMBEDDING_DIMS`) MUST be optional; when unset, the system MUST infer it from the first successful batch, persist it (as a project-metadata scalar, alongside the active model identity), and enforce it on all subsequent vectors.

#### Symbol selection

- **FR-005**: The system MUST embed only declaration-kind symbols: `function`, `method`, `class`, `struct`, `interface`, `trait`, `protocol`, `enum`, `type_alias`, `module`, `namespace`, `component`, `route`, plus `constant` and `variable` (the extractor emits these kinds only at file/module scope or as type-member constants — never for function locals, which are not graph symbols — so selection is a flat kind-membership test with no scope predicate).
- **FR-006**: The system MUST NOT embed noise-level kinds: `parameter`, `import`, `export`, `enum_member`, `field`, `property`, and `file`.

#### Embedding input and change detection

- **FR-007**: The system MUST compose a deterministic embedding input per symbol from its name, kind, signature, docstring, and a trimmed source snippet — identical inputs MUST always produce the identical composed text.
- **FR-008**: The system MUST derive a stable input hash from the composed embedding input and use that hash to decide whether a symbol's stored vector is out of date.

#### Persistence

- **FR-009**: The system MUST persist exactly one vector per embedded symbol, keyed by symbol identity, storing the active model name, the vector dimension, and the input hash alongside the vector.
- **FR-010**: The store MUST hold vectors for exactly one active model; any stored row whose model does not match the active model MUST be treated as stale and replaced on the next pass (no multi-model storage).
- **FR-011**: Each vector MUST be stored as a compact binary blob of little-endian 32-bit floats, with no native or external storage component (brute-force scan is acceptable in this version; approximate-nearest-neighbor indexing and quantization are out of scope).
- **FR-012**: The schema addition MUST ship as a versioned migration applied in lockstep with the base schema definition, so both freshly-created and upgraded databases converge to the same shape.

#### Embedding pass behavior

- **FR-013**: The embedding pass MUST run inline, after reference resolution, as part of both the full-index and the sync operations.
- **FR-014**: The embedding pass MUST be advisory: any failure within it MUST NOT fail the enclosing index or sync operation, which MUST still report success ("advisory — never fail an index over it").
- **FR-015**: The embedding pass MUST run in every context where sync runs, including syncs triggered automatically by the background daemon's file watcher.

#### Incremental freshness

- **FR-016**: On sync, the system MUST re-embed only symbols whose embedding input hash has changed or that have no current vector, leaving unchanged symbols untouched.
- **FR-016a**: The persisted vector for a symbol MUST NOT be deleted as a side effect of that symbol's node row being deleted and re-inserted during re-extraction of its file (no cascading delete from the node row to the vector row) — the vector survives that cycle undisturbed whenever the symbol's node identity (kind, name, start line, file path) and input hash are unchanged. Cleanup of vectors for symbols that no longer exist after re-extraction is performed solely by the explicit reconciliation in FR-017.
- **FR-017**: On sync, the system MUST delete the stored vectors of symbols that no longer exist.
- **FR-018**: A plain sync MUST backfill vectors for all embeddable symbols that are missing a current vector (for example, a project indexed before the endpoint was configured) without requiring any new or special command.

#### Resilience

- **FR-019**: On an endpoint failure, the system MUST retry a bounded number of times and then abort the pass cleanly, leaving already-written vectors in place, so the enclosing operation still succeeds.
- **FR-020**: After an aborted pass, the next index or sync MUST resume by embedding the still-missing and still-stale symbols, with no manual intervention or separate resume command.
- **FR-021**: When the endpoint returns a vector whose dimension conflicts with the enforced dimension, the system MUST surface an actionable error message that names `CODEGRAPH_EMBEDDING_DIMS` and MUST treat the pass as failed (advisory — the enclosing operation still succeeds).

#### Observability

- **FR-022**: The status command MUST report the embedding endpoint (redacted to scheme + host + port only — never credentials, path, or query), the active model, the vector dimension, and coverage — in both the human-readable output and the machine-readable (`--json`) output. Coverage is the share of embeddable (declaration-kind) symbols that have a current vector, where "current" means a vector row exists for the symbol's identity with the active model — computed by joining from live symbols, so transient orphan vector rows never count (input-hash staleness is a sync-time re-embed trigger, not a status-time check). When the feature is dormant, status MUST convey that clearly and neutrally without implying an error; if vectors from a previous configured run are present on disk, status additionally reports their model/dimension/coverage labeled as from a previous run (read from disk only — no network).

#### Security and invariants

- **FR-023**: The API key MUST never be persisted to disk, written to any log, or echoed in any error message. Credentials embedded in the endpoint URL (userinfo or query parameters) MUST likewise never be rendered in any output — the endpoint is always displayed redacted to scheme + host + port.
- **FR-024**: The feature MUST NOT alter graph structure: symbol (node) and relationship (edge) counts MUST remain identical between an index run with the feature active and one without.
- **FR-025**: The feature MUST NOT add any new runtime dependency (it MUST use the platform's built-in HTTP capability) and MUST NOT introduce any new telemetry.
- **FR-026**: The feature MUST NOT modify the retrieval surface used by agents (no change to how queries are answered); vectors are written but not yet consumed in this spec.

### Reviewability Budget *(mandatory)*

<!--
  Constitution budget (from reviewability preset):
  WARN  above 400 reviewable LOC / 6 production files / 15 total files / >1 primary surface
  BLOCK above 800 reviewable LOC / 8 production files / 25 total files / >1 primary surface
        unless a ratified split exception is recorded.
-->

- **Primary surface**: schema/migration (a new per-symbol vector table + its versioned migration) co-equal with scheduler/runtime (the inline, advisory embedding pass and endpoint provider).
- **Secondary surfaces, if any**: seed/config (environment-variable activation and dimension inference) and CLI output (status coverage/model/dimension reporting).
- **Projected reviewable LOC**: ~750 for the whole feature (excluding tests) — approximately ~500 for Slice A (provider, symbol selection, input composition + hashing, vector codec, storage, migration, index wiring, status) and ~250 for Slice B (incremental diff/delete, backfill/heal, bounded-retry abort/resume, daemon-watcher wiring).
- **Projected production files**: ~10 for the whole feature (~8 for Slice A, ~3-4 for Slice B, several of which are edits to existing files).
- **Projected total files**: ~20 including tests (~13 for Slice A, ~7 for Slice B).
- **Budget result**: **split required** — as a single PR the feature exceeds the block thresholds (more than 8 production files and more than one primary surface), so it MUST ship as two independently-reviewable vertical slices. Slice A (P1) then Slice B (P2 + P3), each its own PR under this spec. Slice A itself sits at the warning tier (schema + runtime primary surfaces, ~500 LOC, ~8 files): **warning accepted** because the migration, storage, provider, and pass form one indivisible "produce and persist a vector" capability — splitting further would ship dead code (a table with no writer, or a writer with no schema) and violate independent-testability.
- **Split decision**: This remains **one spec** because the whole feature is a single coherent capability sharing one migration and one provider/vector contract that downstream specs (SPEC-002/003/011/019) consume as a unit; splitting into separate specs would fragment that contract. It is delivered as **two slice-PRs** — Slice A = User Story 1 (P1); Slice B = User Stories 2 and 3 (P2, P3). No transition exception is required; the split into two PRs keeps each reviewable unit at or below the block threshold.

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order, scope budget, traceability, verification evidence, known gaps, and rollback or feature-flag notes.
- Traceability MUST map each major requirement or success criterion to changed files and verification evidence (e.g., FR-005/FR-006 → symbol-selection module + selection test; FR-024 → node/edge-count-stable test; FR-023 → key-redaction test; SC-001 → 100%-coverage probe).
- Deferred work MUST name the follow-up spec or issue (search-side consumption → SPEC-003; bundled local model → SPEC-002; ANN/quantization → deferred until scale demands).
- Rollback/flag note: the feature is dormant-by-default, so rollback is unsetting `CODEGRAPH_EMBEDDING_URL`/`CODEGRAPH_EMBEDDING_MODEL` (no data migration needed); the additive migration leaves existing graph data untouched.

### Key Entities *(include if feature involves data)*

- **Symbol vector record**: one row per embedded symbol. Represents the persisted embedding of a declaration-level symbol. Key attributes: symbol identity (primary key — the existing symbol's deterministic **text** identifier, derived from file path, kind, name, and start line, and therefore stable across sync and re-index of unchanged content), the vector (compact binary blob of little-endian 32-bit floats), the active model name, the vector dimension, and the input hash used for change detection. The store holds exactly one active model's vectors. The record's lifecycle is independent of the node row's delete/re-insert cycle during file re-extraction (no cascading delete; cleanup is by explicit reconciliation, FR-016a/FR-017).
- **Embedding input**: the deterministic text composed per symbol from its name, kind, signature, docstring, and trimmed source snippet. It is hashed to the input hash that drives change detection; it is transient (sent to the endpoint) and not itself persisted beyond the hash.
- **Endpoint configuration**: the user-provided activation surface — required endpoint URL and model, optional API key, optional dimension — sourced from the environment. Presence of both URL and model activates the feature; the API key is never persisted.
- **Embedding pass**: the inline, post-resolution reconciliation that, when active, embeds missing/stale symbols, deletes vectors for removed symbols, and (on failure) aborts advisorily and resumes on the next run. It never fails the enclosing index/sync.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With an endpoint configured, a full index produces a current vector for 100% of embeddable (declaration-kind) symbols, and status reports 100% coverage along with the correct model and dimension.
- **SC-002**: With no endpoint configured, indexing and sync produce results identical to a build without the feature — zero vectors written and zero embedding network requests made — with no observable behavior change.
- **SC-003**: After editing code and running a sync, the number of symbols re-embedded equals the number whose embedding input actually changed (plus any previously missing), not the project total; vectors for deleted symbols are removed.
- **SC-004**: A project indexed before the endpoint was configured reaches 100% coverage with a single plain sync, using no new or special command.
- **SC-005**: If the endpoint becomes unreachable partway through a pass, the enclosing index/sync operation still completes successfully; after the endpoint is restored, a subsequent run reaches 100% coverage without manual intervention.
- **SC-006**: Symbol (node) and relationship (edge) counts are identical between an index run with the feature active and one without — the feature adds no graph structure and causes no count drift across re-index.
- **SC-007**: The configured API key never appears in any persisted file, log line, or error message across all success and failure paths.
- **SC-008**: The feature adds no new runtime dependency and emits no telemetry event.

## Assumptions

<!--
  Recorded scoping decisions from the pre-spec interview (Q1-Q9) are quoted here
  verbatim where the phrasing is load-bearing, alongside reasonable defaults chosen
  for details the interview did not fix.
-->

Recorded scoping decisions (interview Q1-Q9 and the roadmap storage decision):

- **Q1 — symbol selection**: Embed **declaration kinds only** — `function`, `method`, `class`, `struct`, `interface`, `trait`, `protocol`, `enum`, `type_alias`, `module`, `namespace`, `component`, `route`, plus top-level `constant`/`variable`. Skip `parameter`, `import`, `export`, `enum_member`, `field`/`property`, `file` (embedding noise-level kinds is a non-goal).
- **Q2 — storage keying**: The vector store is keyed by symbol identity with **one active model**; model and dimension are metadata columns; "a model-mismatched row is stale and re-embeds (replace)." No multi-model storage.
- **Q3 — pass placement**: The embedding pass runs **inline post-resolution** inside the index/sync operations and is **advisory** — "advisory — never fail an index over it."
- **Q4 — coverage of sync contexts**: Embed **everywhere sync runs**, including the background daemon watcher's syncs.
- **Q5 — backfill mechanism**: Backfill happens via the existing `sync` heal path — **no new CLI command** (no `codegraph embed` command).
- **Q6 — activation**: Activation requires **URL + MODEL both set**; the API key is optional to support keyless local endpoints.
- **Q7 — dimension handling**: Dimension is optional — **inferred from the first batch, persisted, then enforced**; a mismatch raises an actionable error naming `CODEGRAPH_EMBEDDING_DIMS`.
- **Q8 — endpoint failure**: On endpoint failure, **abort the pass after bounded retries and resume on the next run**.
- **Q9 — telemetry**: **No new telemetry.**
- **Storage (roadmap decision 2026-07-03)**: Vectors are stored as a **plain binary blob (little-endian 32-bit floats) with brute-force scan** in this version, preserving the zero-native-dependency constraint.
- **Session 1 clarification — symbol identity**: Symbol identifiers are deterministic (derived from file path, kind, name, and start line), so vectors keyed by symbol identity survive sync and library re-index of unchanged files; the full CLI re-index command recreates the database and re-embeds from scratch by design. No input-hash-keyed vector reuse cache is needed.
- **Session 1 clarification — locals**: Function-local variables are never graph symbols, so no scope predicate is required for symbol selection (FR-005).

Reasonable defaults for details the interview did not fix (to be finalized in planning):

- Symbols are embedded in bounded batches with bounded concurrency and a per-request timeout. Defaults (Session 2): **batch size 16, concurrency 4, request timeout 30,000 ms** — all user-overridable via `CODEGRAPH_EMBEDDING_BATCH_SIZE`, `CODEGRAPH_EMBEDDING_CONCURRENCY`, and `CODEGRAPH_EMBEDDING_TIMEOUT_MS` (positive-integer validated and clamped, following the existing worker-pool env-parse precedent).
- "Bounded retries" (Session 2) is exponential backoff with full jitter: base 1,000 ms, ×2 growth, ~8 s per-delay cap, **3 retries per batch** (4 attempts total), honoring a server-provided `Retry-After` on 429 (capped ~30 s). These are fixed constants, not new env vars. The retry budget is deliberately smaller than hosted-API cookbook defaults because one exhausted batch aborts the whole pass (Q8) — a sustained-down endpoint should fail fast rather than burn wall-clock inside the index lock. The observable contract remains only that the pass aborts advisorily rather than hanging or failing the operation.
- The composed embedding input (Session 2) is capped at a fixed **~6,000 characters** (snippet trimmed to fit), character-based rather than token-counted because accurate token counting would require a tokenizer dependency (FR-025). ~6,000 chars ≈ ~1,500–1,700 code tokens — under the 2,048-token default context of common local models (e.g. nomic-embed-text) and far under hosted 8,191-token limits. Models with very small contexts (256–512 tokens) may still truncate server-side — an accepted limitation. The cap is a fixed deterministic constant (FR-007).
- The inferred/enforced dimension and the active model identity (Session 2) are persisted as **project-metadata scalars** (written on the first successful batch, read at pass start as the authoritative enforcement values), following the existing index-version stamp pattern; the per-row model/dimension columns (FR-009) remain self-describing integrity metadata, not the enforcement source of truth.
- The endpoint speaks the standard OpenAI-compatible embeddings request/response shape; no vendor-specific behavior is assumed or required.
- Coverage in status (Session 3) is computed by joining from live embeddable symbols to their vector rows filtered to the active model ("current" = present with matching model); transient orphan rows are structurally excluded from the count. Input-hash staleness is detected at sync time, not status time. Zero embeddable symbols reports as trivially complete.
- The index/sync progress surface (Session 3) gains an `embedding` phase (emitted only when the feature is active — dormancy adds no phase), with progress = embedded-so-far ÷ eligible-to-embed.

Scope boundaries assumed for this spec:

- Search-side consumption of vectors is **out of scope** (SPEC-003); this spec writes vectors but does not query them.
- A bundled local embedding model is **out of scope** (SPEC-002); this spec only talks to a user-configured endpoint.
- Approximate-nearest-neighbor indexes and quantization are **out of scope**, deferred until scale demands.
- No change is made under the retrieval/MCP surface; agent-facing query behavior is untouched until SPEC-003.
