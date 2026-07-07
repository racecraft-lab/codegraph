# Feature Specification: Bundled Local Embedding Fallback

**Feature Branch**: `002-local-embedding-fallback`

**Created**: 2026-07-05

**Status**: Draft

**Input**: User description: "Bundled Local Embedding Fallback (SPEC-002) — add a small, permissively-licensed, in-process WASM/ONNX code-embedding model so semantic indexing works with zero external setup, as an EXPLICIT OPT-IN, never an automatic default."

## User Scenarios & Testing *(mandatory)*

<!--
  User stories US1–US4 are carried verbatim from the Design Concept and ordered by
  priority. Each is independently testable and delivers standalone value.
-->

### User Story 1 - Embed locally with no endpoint configured (Priority: P1)

As an operator, I set the embedding provider to `local` (via `CODEGRAPH_EMBEDDING_PROVIDER=local` or by passing `--embeddings local`) and run `codegraph index`. Every indexed symbol is embedded locally, in-process, with no external embedding endpoint configured.

**Why this priority**: This is the core capability of the feature — it is what unlocks semantic indexing for the population of users who have no embedding endpoint. Without it, the feature delivers nothing. It is the minimum viable slice.

**Independent Test**: On a machine where the model is already present in the shared cache, opt into the local provider, run an index over a small project, and confirm that all indexed symbols carry embeddings and that no endpoint URL was configured or contacted.

**Acceptance Scenarios**:

1. **Given** a project with no embedding endpoint configured, **When** the operator sets `CODEGRAPH_EMBEDDING_PROVIDER=local` and runs `codegraph index`, **Then** every indexed symbol is embedded using the local model.
2. **Given** a project with no embedding endpoint configured, **When** the operator runs `codegraph index --embeddings local`, **Then** the local provider is selected for that invocation and every indexed symbol is embedded locally.
3. **Given** an endpoint URL is set in the environment, **When** the operator passes `--embeddings local`, **Then** the explicit local selection wins over the endpoint and embedding runs locally.

---

### User Story 2 - Fresh-machine model acquisition and reuse (Priority: P2)

As an operator on a fresh machine, my first use of the local provider lazily downloads the model to a shared, machine-wide cache, verifies the downloaded bytes against a known checksum, and reuses the cached model on every later run without downloading again.

**Why this priority**: This makes US1 work on a machine that does not yet have the model. It is the delivery mechanism; it is P2 because US1 is already demonstrable on a pre-seeded machine, and this story removes the pre-seed requirement.

**Independent Test**: On a machine with an empty model cache and network access, opt into the local provider and run an index; confirm the model is downloaded once, the checksum is verified, embeddings are produced, and a second index run performs no further download.

**Acceptance Scenarios**:

1. **Given** an empty model cache and network access, **When** the operator runs a local index for the first time, **Then** the model is downloaded, its bytes are verified against the pinned checksum, and embedding proceeds.
2. **Given** a model already present and verified in the shared cache, **When** the operator runs a later index, **Then** the cached model is reused and no download occurs.
3. **Given** downloaded bytes that do not match the pinned checksum, **When** verification runs, **Then** the bytes are rejected and are not used for embedding.

---

### User Story 3 - Offline first run degrades gracefully (Priority: P2)

As an operator who is offline on my first local run (no cached model), my structural index still completes; the embedding pass is skipped; I receive an actionable message telling me how to obtain the model; and `codegraph status` shows why embedding coverage is 0%.

**Why this priority**: Graceful degradation protects the primary product — the structural graph — from being blocked by an unavailable embedding model. It mirrors SPEC-001's "provider failure stops the embed pass, not the index" posture and honors the constitutional no-explosion / index-always-succeeds guarantee.

**Independent Test**: With no network and an empty model cache, opt into the local provider and run an index; confirm the structural graph is built completely, the process exits with an actionable message, and `codegraph status` reports 0% coverage with the reason.

**Acceptance Scenarios**:

1. **Given** no network access and an empty model cache, **When** the operator runs a local index, **Then** the structural index completes fully and the embedding pass is skipped.
2. **Given** the embedding pass was skipped because the model could not be obtained, **When** the run finishes, **Then** the operator receives an actionable message describing how to obtain the model.
3. **Given** the embedding pass was skipped, **When** the operator runs `codegraph status`, **Then** the reason embedding coverage is 0% is shown.

---

### User Story 4 - Status shows the active local provider (Priority: P3)

As an operator, `codegraph status` shows the active provider (`local`), the model in use, and the vector dimensions, so I can confirm what is embedding my project.

**Why this priority**: Observability is valuable but not required to embed. It is P3 because US1–US3 deliver and degrade the capability without it; this story makes the active configuration legible.

**Independent Test**: With the local provider active and the model available, run `codegraph status` and confirm the output names the provider, the model, and the vector dimensions.

**Acceptance Scenarios**:

1. **Given** the local provider is active and the model is available, **When** the operator runs `codegraph status`, **Then** the output shows the provider as `local`, the model name, and the vector dimensions.

---

### Edge Cases

- **Unset configuration (dormancy)**: With no embedding configuration at all, an index run stays byte-identical to today — no model download, no network request, no embedding-related schema write.
- **Provider explicitly off**: With the provider set to `off`, no embedding occurs even if an endpoint URL happens to be present.
- **Misconfiguration**: When embedding settings are internally inconsistent — an endpoint URL set but no model (or vice versa), *whether or not a provider is explicitly named*, or an unrecognized provider value — the structural index still completes and the operator gets an actionable message rather than a crash. SPEC-001's half-config → `misconfig` is preserved even when no explicit provider is selected. An explicit `endpoint` selection with no URL resolves to `misconfig`, NOT a downgrade to local.
- **Checksum mismatch**: Downloaded bytes that fail SHA-256 verification are discarded and never used; the run degrades like the offline case but emits a distinct tamper-aware message (FR-019a) — a mismatch is a trust-integrity event, not merely "offline."
- **Partial or interrupted download**: A partially written cache entry is treated as absent and re-acquired on the next run; it is never used as if complete.
- **Unwritable or missing cache directory**: A cache location that cannot be written (including a bad `CODEGRAPH_MODEL_CACHE_DIR`) yields an actionable message and the structural index still completes.
- **Air-gapped / mirrored source**: With the download base URL overridden to an internal mirror, acquisition uses the mirror and applies the same checksum verification.
- **Shared cache under concurrency**: Multiple projects (and the daemon serving them) share one machine-wide model cache without corrupting it.
- **Switching providers on an already-embedded project**: Changing from endpoint to local re-embeds all symbols via the existing model-mismatch path, and node/edge counts stay unchanged.
- **Long inference on the daemon**: Embedding a large project does not stall the daemon event loop or the file watcher.
- **Runtime/session-init unavailable**: model bytes present + verified but the ORT `.wasm` is missing/corrupt → the FR-019b timeout converts the `create()` hang into the graceful model-unavailable skip.
- **Hostile / slow host**: an untrusted or MITM'd host streaming unbounded or slow data is bounded by FR-013a (size + time) and degrades as unavailability.
- **Multi-project concurrent passes**: a local embed pass runs inside `index`/`sync` (the per-project daemon and the file watcher both drive `sync()`), and each project serializes its own passes through the existing per-project file lock (`.codegraph/codegraph.lock`, reused unchanged) — so a single project never runs two concurrent passes. Each individual pass is further CPU-bounded by the FR-010b `ort.env.wasm.numThreads` clamp (≥1 core free, mirroring the parse pool's core-leaving). Across independent projects on one machine (N separate per-project daemons / CLI processes), CodeGraph applies the same posture as the existing parse pool — per-process core-leaving plus OS scheduling — rather than adding a machine-wide inference coordinator the rest of the codebase lacks (Principle II/III).
- **Long-pass worker heap**: a very long pass MUST NOT grow the worker's WASM heap unbounded — recycle the worker after a threshold (mirroring the parse pool's recycle) or record measured evidence the single-session heap stays bounded.

## Requirements *(mandatory)*

### Functional Requirements

#### Provider selection & dormancy

- **FR-001**: System MUST add a `CODEGRAPH_EMBEDDING_PROVIDER` configuration value accepting exactly one of `endpoint`, `local`, or `off`.
- **FR-002**: System MUST provide an `--embeddings` option on the index command accepting `local`, `endpoint`, or `off` that overrides the environment for that single invocation.
- **FR-003**: System MUST resolve the active provider by this precedence: (1) an explicit selection (`CODEGRAPH_EMBEDDING_PROVIDER` or `--embeddings`) wins — `off` short-circuits to `null` (a present endpoint URL/model is ignored), `local` activates the local provider (no URL required), `endpoint` selects the endpoint provider (→ `misconfig` when its URL/model are incomplete); (2) with NO explicit selection, resolution falls through to SPEC-001's UNCHANGED endpoint resolution — URL and model both present → `endpoint`; exactly one set → `misconfig` naming the missing variable (SPEC-001 half-config, preserved unchanged); neither set → `null` (dormant). The dormant/off tail is the fully-unset (or explicit-`off`) case only; a half-config is NEVER silently downgraded to off.
- **FR-004**: Configuration resolution MUST produce exactly one of four typed outcomes — `endpoint`, `local`, `misconfig`, or `null` (a discriminated union) — so callers branch on a single typed result.
- **FR-005**: A fully-unset embedding configuration MUST resolve to `null` (dormant): the system performs zero model download, zero network request, and zero embedding-related schema write.
- **FR-006**: `local` MUST be reachable ONLY through an explicit selection (`CODEGRAPH_EMBEDDING_PROVIDER=local` or `--embeddings local`), which activates the local provider WITHOUT requiring an endpoint URL. There MUST be NO implicit "no URL → local" fallthrough: an explicit `endpoint` selection with a missing URL/model resolves to `misconfig` (never a silent downgrade to local), and an otherwise-unconfigured repository MUST NOT auto-activate any provider (dormancy, FR-005). ("Default local when no URL" means local needs no URL when explicitly selected — not that resolution auto-picks local.)
- **FR-007**: When the embedding configuration is present but internally invalid (`misconfig`), the system MUST complete the structural index, skip the embedding pass, and emit an actionable message rather than crashing.

#### Local embedding capability

- **FR-008**: With the local provider active, `codegraph index` MUST embed every indexed symbol locally, in-process, with no endpoint configured.
- **FR-009**: The local provider MUST use a general-purpose, small, permissively-licensed (Apache or MIT) quantized code-embedding model in the MiniLM-L6 / BGE-small class producing vectors of 384–768 dimensions.
- **FR-010**: Local inference MUST run off the main thread and MUST NOT stall the daemon event loop or the file watcher.
- **FR-011**: The local provider and its runtime dependency MUST be pure-JS/WASM with no native addons.
- **FR-010a**: The local model/inference session MUST be initialized at most once per embed pass (per worker/process) and reused for every batch; per-batch or per-symbol re-initialization is a defect (the ~215–250 ms cold load is amortized once).
- **FR-010b**: The local inference worker MUST bound its ONNX Runtime WASM thread pool (`ort.env.wasm.numThreads`) so an embed pass does not saturate all CPU cores and starve the daemon's query serving or the file watcher — leaving at least one core free (mirroring the parse pool's core-leaving clamp) or single-threaded; the exact bound is pinned at implement time. (Off-thread execution alone is insufficient: the WASM pool defaults to `min(cores/2,4)` and spawns nested threads unless bounded.)

#### Model delivery & trust

- **FR-012**: The model MUST be acquired lazily on first local use via download — it MUST NOT be bundled in the npm package and MUST NOT be shipped as an optional dependency.
- **FR-013**: EACH downloaded artifact required for local embedding — the quantized model AND the tokenizer file — MUST be verified against its own SHA-256 checksum pinned in CodeGraph source before it is loaded, parsed, or used (host untrusted; the per-artifact checksums are the trust anchor). The default download source MUST be the model's public model-hub URL.
- **FR-014**: A downloaded artifact (model or tokenizer) whose bytes fail checksum verification MUST NOT be loaded, parsed, persisted to the verified cache path, or used for embedding — it is discarded before atomic promotion.
- **FR-015**: The system MUST allow an optional `CODEGRAPH_MODEL_BASE_URL` override of the download base URL — a base/prefix (the model's repo-relative path + filename are appended), not a full file URL — for air-gapped or enterprise mirrors. The same pinned SHA-256 verification (FR-013/FR-014) MUST apply to bytes obtained from the override, so the override host is untrusted and cannot inject unverified bytes. The override MUST be constrained to an `http`/`https` scheme (other schemes — `file:`, `ftp:`, `data:` — are rejected and degrade as invalid config) and is read ONLY from the process environment (operator-controlled), never from project-local config; the pinned checksum bounds the returned bytes but not the outbound request, so the scheme constraint + env-only provenance bound the SSRF/exfil surface.
- **FR-013a**: Each artifact download MUST be bounded by (a) a maximum byte budget derived from the pinned exact artifact size (abort once bytes exceed the pinned length) and (b) a download wall-clock timeout; exceeding either aborts and degrades as unavailability (like offline), so an untrusted/MITM host cannot exhaust disk or hang acquisition. (Distinct from the FR-019b session-init timeout.)

#### Model cache

- **FR-016**: The verified model MUST be stored in a global, platform-aware cache shared across projects, resolved as: POSIX with `XDG_CACHE_HOME` unset → `~/.codegraph/models`; POSIX with `XDG_CACHE_HOME` set → `$XDG_CACHE_HOME/codegraph/models`; Windows with `%LOCALAPPDATA%` set → `%LOCALAPPDATA%\codegraph\models`; Windows with `%LOCALAPPDATA%` unset → `<home>/AppData/Local/codegraph/models`. It MUST NOT be stored inside any project's `.codegraph/` directory.
- **FR-017**: The system MUST allow an optional `CODEGRAPH_MODEL_CACHE_DIR` override of the cache location.
- **FR-017a**: The resolved cache directory — the default and any `CODEGRAPH_MODEL_CACHE_DIR`/`XDG_CACHE_HOME`-derived value — MUST be rejected if it escapes via `../` or is AT OR UNDER a sensitive system root (PREFIX match against the sensitive-path set — the cache is a write sink — NOT exact match), evaluated AFTER resolving symlinks (realpath); it MUST NOT false-reject a legit `~/.config` XDG cache (purpose-built validator, not `validateProjectPath` verbatim). Temp files written during acquisition MUST be created exclusively (fail if the path exists — no clobber), MUST NOT follow a pre-existing symlink, and use an unpredictable name (pre-planted-symlink / predictable-name race cannot redirect the write). The unwritable/invalid-cache actionable message MUST name the resolved cache dir and the `CODEGRAPH_MODEL_CACHE_DIR` override; a mid-download I/O failure (disk-full / permission race) resolves to the `cache` reason, not `offline`.
- **FR-018**: When a verified model is already present in the cache, later runs MUST reuse it without re-downloading.

#### Offline & failure resilience

- **FR-019**: If the model cannot be obtained on first use (for example, offline with no cached copy), the structural index MUST still complete, the embedding pass MUST be skipped, and the operator MUST receive an actionable message that names (a) the resolved cache directory, (b) the `CODEGRAPH_MODEL_BASE_URL` override, and (c) how to pre-seed the model (the exact filename to place in the cache directory so the next run verifies-then-uses it). Any message, status line, or log referencing the `CODEGRAPH_MODEL_BASE_URL` value MUST redact it to scheme+host+port only (reuse SPEC-001's `redactEndpoint`), so an override carrying embedded credentials (`https://user:pass@mirror/`) cannot leak. A degraded run (embed pass skipped, structural index completed) MUST exit 0; non-zero is reserved for a failed structural index.
- **FR-019a**: A checksum mismatch (as distinct from an offline miss) MUST emit a distinct message indicating the downloaded bytes failed SHA-256 verification and were discarded (possible corruption or an incorrect/tampered mirror), advising retry or checking `CODEGRAPH_MODEL_BASE_URL`. The same `CODEGRAPH_MODEL_BASE_URL` redaction as FR-019 applies to this message. Both cases degrade identically: structural index completes, embed pass skipped, and `codegraph status` reports the reason (FR-020).
- **FR-019b**: The local provider MUST wrap `InferenceSession.create()` in a timeout (default ~30 s, an internal constant — not operator-tunable; no env knob is introduced, per Principle II) so a missing/corrupt runtime `.wasm` — which makes `create()` hang indefinitely rather than reject — degrades to the model-unavailable skip (FR-019) instead of hanging the index.
- **FR-019c**: Any actionable, abort, status, or log message MUST NOT echo source text or composed embedding input (SPEC-002's own redaction guarantee, matching SPEC-001's redacted-abort-reason posture).
- **FR-020**: When the embedding pass is skipped, `codegraph status` MUST report the DISTINCT reason coverage is 0% — one of: offline, checksum-mismatch, unwritable/invalid cache, misconfig, or session-init timeout — matching the distinct index-time messages, best-effort where determinable at status time (a transient index-time reason like checksum-mismatch MAY be surfaced generically if not persisted).

#### Observability

- **FR-021**: When the local provider is active, `codegraph status` MUST show the active provider, the model, and the vector dimensions.
- **FR-021a**: During first-run model acquisition (~22 MB download) and session cold-load — both preceding the first per-batch progress ping — the operator MUST receive a status signal (e.g. "downloading model…", "loading model…").

#### Re-embed & invariants

- **FR-022**: Switching the active provider or model MUST trigger a full re-embed using SPEC-001's existing model-column-mismatch mechanism; no new re-embed mechanism is introduced.
- **FR-023**: A local re-embed of identical source input MUST leave node and edge counts unchanged (no graph growth).
- **FR-024**: The change MUST preserve the npm `engines` range `>=20 <25`, MUST NOT meaningfully grow the npm payload, and MUST document the runtime dependency's size in `BUNDLING.md`.

### Reviewability Budget *(mandatory)*

- **Primary surface**: harness/adapter (the local embedding provider + its worker/tokenizer/fetch modules).
- **Secondary surfaces, if any**: seed/config (provider selection resolution); docs/process (`BUNDLING.md` size note).
- **Projected reviewable LOC**: **~650–680** (production only; excludes tests, docs, and lock/vendor artifacts).
- **Projected production files**: **8** (4 new + 4 modified).
- **Projected total files**: **~16**.
- **Budget result**: **advisory WARN** — over the soft warn thresholds (400 reviewable-LOC / 6 production-file) but within the hard block limits (800 LOC / 8 production files / 25 total files / 1 primary surface); the slice is predominantly net-new modules, so the greenfield allowance applies.
- **Split decision**: remains a single spec — the local provider, its lazy checksum-verified acquisition, the selection resolution, and the status/observability surface form one cohesive capability that is not independently shippable when split, and the projected surface stays within the hard block limits.
- **Superseded projection**: this section's original estimate (~310 reviewable LOC / ~4 production files / "within budget" here; ~380 LOC in the design-concept estimator — the "~310/~380" the plan back-references) was **superseded at plan time**. The Clarify-mandated pure-WASM runtime (`onnxruntime-web`, no native addon — FR-011) has no batteries-included pipeline, forcing CodeGraph to own a BERT WordPiece tokenizer + an inference worker (~245 LOC), plus the Phase-4 checklist hardening (~40–70 LOC). The higher figure is ratified as a justified advisory overage in [plan.md](./plan.md)'s Complexity Tracking — it is NOT a budget violation.

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order, scope budget, traceability, verification evidence, known gaps, and rollback or feature-flag notes.
- Traceability MUST map each major requirement or success criterion to changed files and verification evidence.
- Deferred work MUST name the follow-up spec or issue (retrieval quality → SPEC-003).

### Key Entities *(include if feature involves data)*

- **Embedding Provider Selection**: the typed resolution of how a project embeds — one of `endpoint`, `local`, `misconfig`, or `null` (dormant) — derived from the environment and CLI inputs per the precedence rules.
- **Local Embedding Model**: the model artifact used for in-process embedding; its salient attributes are name, vector dimensions, license, source URL, and the pinned SHA-256 checksum that anchors trust.
- **Model Cache**: the machine-wide, platform-aware directory that holds verified model artifacts shared across all projects on the machine (never per-project).
- **Embedding Configuration Inputs**: the operator-facing settings that drive selection — `CODEGRAPH_EMBEDDING_PROVIDER`, the `--embeddings` flag, the endpoint URL/model settings from SPEC-001, the optional download base-URL override (`CODEGRAPH_MODEL_BASE_URL`), and the optional `CODEGRAPH_MODEL_CACHE_DIR`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the local provider opted in and the model available, a `codegraph index` run embeds 100% of indexed symbols with no endpoint configured.
- **SC-002**: On a fresh machine with network access, the first local index run acquires the model exactly once, and every subsequent run reuses the cached copy with zero additional downloads.
- **SC-003**: A downloaded model whose bytes do not match the pinned checksum is used for embedding 0% of the time (mismatched bytes are always rejected).
- **SC-004**: With no embedding configuration set, an index run makes zero network requests and zero embedding-related schema writes — observably byte-identical to today's dormant behavior.
- **SC-005**: When the model cannot be obtained (offline, uncached), the structural index completes successfully 100% of the time, the operator receives an actionable message, and `codegraph status` states the reason coverage is 0%.
- **SC-006**: Whenever the local provider is active, `codegraph status` displays the provider, the model, and the vector dimensions.
- **SC-007**: A local re-embed of unchanged source produces identical node and edge counts before and after (0 growth).
- **SC-008**: Switching from an endpoint to the local provider re-embeds all symbols with the local model with no manual data-migration step.
- **SC-009**: With a warmed local worker (≥4 cores), warmed per-symbol embedding is single-digit ms (target ≤8 ms/text median) and session cold-load ≤~300 ms; the target holds at repo scale (10k–100k+ symbols) with memory bounded by SPEC-001's per-super-chunk streaming, verified by a deterministic probe (self-repo dogfood or a large real repo).
- **SC-010**: While a full local embed pass runs on the daemon, the event loop is not blocked for long stretches and `codegraph_explore` latency stays within a small delta of idle baseline — enforced by the FR-010b ORT thread bound (exact bounds tuned + validated at implement per constitution VI methodology).
- **SC-011**: Enabling the local provider leaves the retrieval/tool surface unchanged — `codegraph_explore` call-count and output budgets identical, and a control-repo A/B shows no retrieval regression while a local embed pass runs.

## Clarifications

### Session 2026-07-05 (autopilot Clarify — 3 sessions)

Resolved the design concept's three Open Questions and three internal-spec contradictions. Full evidence: `docs/ai/specs/.process/SPEC-002-workflow.md` (Clarify Results) + the design concept.

- **Runtime (OQ-1):** `onnxruntime-web` (MIT, pure-WASM, no native addon). Rejected `@huggingface/transformers` — measured: it hard-depends on native `onnxruntime-node` and uses it as the default engine from Node, violating FR-011 / Constitution VII. Trade-off: CodeGraph owns a minimal BERT WordPiece tokenizer (~100–150 LOC).
- **Checkpoint (OQ-2):** `Xenova/all-MiniLM-L6-v2` — 384 dims, Apache-2.0, ~22 MB quantized ONNX; tokenizer artifacts (`tokenizer.json`/`vocab.txt`) fetched + SHA-verified alongside the model.
- **Worker (OQ-3):** off-thread inference lives inside the local provider's `embed()` (mirrors `parse-worker.ts`); Plan/Implement MUST validate that `onnxruntime-web` runs inference inside a Node `worker_thread` (the one residual technical risk / de-risking spike).
- **Selection semantics:** FR-003 rewritten so the `PROVIDER`/`--embeddings` selector layers above SPEC-001's unchanged resolution; a half-config stays `misconfig` (never silently `off`); explicit `off` → `null` short-circuit; `local` reachable ONLY by explicit selection (no implicit "no URL → local" fallthrough — preserves dormancy/SC-004). FR-006 reworded accordingly.
- **Cache/download:** cache path pinned to an explicit 4-case platform formula (FR-016, XDG-honoring); base-URL override named `CODEGRAPH_MODEL_BASE_URL` (FR-015); cache-dir traversal/sensitive-path validation added (FR-017a); offline vs checksum-mismatch emit distinct actionable/tamper-aware messages naming cache dir + override + pre-seed (FR-019/FR-019a).
- The download-trust + path-traversal security surface (SHA-256 anchor, atomic verify-before-use, override-as-SSRF) is adversarially verified in the Phase-4 **security** checklist — the dedicated adversarial pass for these `[security]`-tagged decisions.
- **Plaintext-http override (security checklist decision)**: parity with SPEC-001's `plaintextRemoteWarning` is NOT required — the model/tokenizer are PUBLIC artifacts (no source code or bearer key crosses the wire) and the per-artifact checksums remove the integrity risk; the residual credential-in-URL leak is covered by the FR-019 redaction. No mandatory block/warning (an optional advisory MAY be added).
- **Override SSRF scope (security checklist decision)**: bounded by the http/https scheme-allowlist + env-only provenance + checksum-anchored bytes — NOT an IP/link-local blocklist (which would break legitimate internal mirrors; the override is operator-supplied, so the risk is at most self-inflicted SSRF).

## Assumptions

- The exact model within the MiniLM-L6 / BGE-small class is chosen at plan time; the local model is a functional baseline, not a tuned retriever — retrieval quality is owned by SPEC-003.
- SPEC-001's `EmbeddingProvider` interface, vector store, model-column-mismatch re-embed path, and "provider failure stops the embed pass, not the index" posture already exist and are reused unchanged.
- The pinned SHA-256 lives in CodeGraph source and is the trust anchor; the default download host (the model's public hub) is treated as untrusted.
- "Automatic when no endpoint" refines the roadmap's phrasing: `local` is the default provider only once embeddings are explicitly opted into; an unconfigured repository stays dormant, consistent with constitution Principle VII and the Dogfooding dormancy discipline.
- Off-thread inference reuses the existing worker-pool precedent (parse-pool / query-pool) so it does not stall the daemon or watcher.
- The WASM embedding runtime dependency is pure-JS/WASM and MIT/Apache/BSD-license-compatible, satisfying fork license hygiene and the zero-native-dependency principle.
- The self-repo dogfood UAT step (per the Dogfooding Protocol) switches this repository from the HAL endpoint to the local provider and re-embeds, verifying `codegraph status` and coverage after the switch.

## Out of Scope

- GPU execution paths and model fine-tuning.
- Search and retrieval behavior and quality — owned by SPEC-003. This spec delivers a functional embedding baseline only.
- Auto-activation on an unconfigured repository — it would break dormancy (constitution Principle VII) and is explicitly excluded.
- Bundling model weights in the npm package or shipping them as optional dependencies — delivery is lazy, checksum-verified download only.
- Running a racecraft-hosted model mirror — the default source is the model's public hub, with an optional operator-supplied base-URL override; no first-party mirror is operated.
