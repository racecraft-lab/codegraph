# SpecKit Workflow: SPEC-003 — Hybrid Semantic Search

**Template Version**: 1.0.0
**Created**: 2026-07-09
**Purpose**: Prepare and execute SPEC-003 through the SpecKit workflow so CodeGraph search fuses FTS5 keyword hits with vector KNN via reciprocal-rank fusion — beating keyword-only on the eval harness, degrading gracefully when vectors are absent, and staying byte-identical for every unconfigured surface.

---

## Design Concept

This workflow file was enriched from a Grill Me interview run during
`/speckit-pro:speckit-scaffold-spec SPEC-003`. The full Q&A log, Goals, Non-goals, and
Open Questions live at:

```text
docs/ai/specs/.process/SPEC-003-design-concept.md
```

Re-read it before each phase. The design concept is the source of truth for scoping
decisions captured during setup. The load-bearing decisions (by Q-number):

- **Q1** — `searchNodes({mode})` defaults `'keyword'`: today's behavior byte-identical.
  Only the explicit surfaces (`codegraph_search` MCP tool, CLI search, opt-in library
  callers) pass `mode:'auto'` (hybrid when matching-model vectors exist, else keyword).
  Internal callers (explore, prompt hook, context builder) are untouched.
- **Q2/Q3** — hybrid fusion inside `codegraph_explore` is an explicit NON-GOAL,
  tracked as an Open Question proposing a future A/B-gated roadmap entry.
- **Q4** — query-time provider: lazy init + keyword-while-warming; internal ~2s
  per-query embed budget; on timeout/failure → keyword + success-shaped hint, never
  `isError`.
- **Q5** — the p95 ≤150 ms @ 50k nodes target gates fusion compute only (scan +
  top-k + RRF); the query-embed leg is reported, not gated.
- **Q6** — lazy in-memory Float32Array matrix cache over matching-model vectors,
  invalidated per query by a cheap staleness probe (vector count + data_version).
- **Q7** — `kind:`/`lang:`/`options.kinds` pre-filter the vector scan before top-k;
  `path:`/`name:` stay post-fusion hard gates; embed input = parsed text portion
  (filter tokens stripped).
- **Q8** — optional `matchType: 'keyword'|'semantic'|'both'` (+ fused score) on
  results in semantic/hybrid modes only; keyword-mode shapes byte-identical.
- **Q9** — CI gates live in `npm test` (vitest) with injected deterministic fixture
  vectors; `npm run eval` gains the same semantic cases for the scored report.
- **Q10** — scoped agent A/B per Constitution VI before merge
  (`scripts/agent-eval/ab-new-vs-baseline.sh`, ≥2 runs/arm, Sonnet floor, plus a
  no-vectors control repo expecting zero delta).

> **Note:** Grill Me is human-in-the-loop only. It is not part of the autopilot
> loop. Once this workflow begins, clarifications happen via `/speckit-clarify`
> and the consensus protocol.

---

## Workflow Overview

| Phase | Command | Status | Notes |
|-------|---------|--------|-------|
| Specify | `/speckit-specify` | ✅ Complete | 16 FRs · 4 user stories · 12 acceptance scenarios · 0 `[NEEDS CLARIFICATION]` markers |
| Clarify | `/speckit-clarify` | ✅ Complete | 3 sessions · 15 questions · 7 consensus items, all resolved Round 1 (0 escapes, 0 human-review) · spec gains FR-002a/FR-004a/FR-017 + SC-007, hint-wording table, p95 machinery, fixture non-tautology rules |
| Plan | `/speckit-plan` | ✅ Complete | plan.md + research.md (D1–D14) + data-model.md (E1–E7) + 3 contracts + quickstart; constitution gate PASS ×2 (initial + post-design); G3 pass (after rewording 2 benign prose mentions of the marker token) |
| Checklist | `/speckit-checklist` | ✅ Complete | 3 domains · 85 items · 23 gaps → 0 · 5 consensus items (all Round 1) · error-handling consensus skipped (zero unresolved) · G4 pass |
| Tasks | `/speckit-tasks` | ✅ Complete | 34 tasks · 7 groups · 5 [P] · full FR/SC coverage · G5 pass (34 tasks, 0 markers) · phantom check clean (0 checked tasks) |
| Analyze | `/speckit-analyze` | ✅ Complete | 5 findings (2H/1M/2L) → all resolved in 2 loops · G6 pass (0 CRITICAL/HIGH) · 0 unresolved → consensus skipped · residual `data_version` tokens verified as negations only |
| Implement | `/speckit-implement` | ⏳ Pending | |

**Status Legend:** ⏳ Pending | 🔄 In Progress | ✅ Complete | ⚠️ Blocked

### Phase Gates

| Gate | Checkpoint | Approval Criteria |
|------|------------|-------------------|
| G1 | After Specify | Clear user stories, no `[NEEDS CLARIFICATION]` markers |
| G2 | After Clarify | Fusion mechanics, degradation wording, and fixture design resolved |
| G3 | After Plan | Constitution gates pass; dormancy (byte-identical keyword default) explicit; cache + budget constants documented |
| G4 | After Checklist | All `[Gap]` markers addressed |
| G5 | After Tasks | Task coverage verified; TDD ordering; A/B + dogfood UAT tasks present |
| G6 | After Analyze | No CRITICAL/HIGH unresolved findings; no drift vs design concept |
| G7 | During Implement | Tests pass; p95 gate green; scoped A/B recorded; self-repo UAT evidence |

---

## Prerequisites

### Constitution Validation

| Principle | Requirement | Verification |
|-----------|-------------|--------------|
| I. Think Before Coding | Fusion candidate depths, degradation wording, and fixture design clarified before coding. | G1/G2 marker checks; design-concept references in spec and plan |
| II. Simplicity First | Brute-force scan + RRF only (SPEC-001 blessed); no ANN, no re-rankers, no new env vars — internal constants documented. | Plan non-goals and Complexity Tracking |
| III. Surgical Changes | New logic in `src/search/hybrid.ts`; diffs to `src/db/queries.ts`, `src/index.ts`, `src/mcp/tools.ts`, `src/bin/codegraph.ts` stay minimal. | Diff review against declared file operations |
| IV. Goal-Driven Execution | Tests first: fusion determinism, filter parity, degradation paths, provenance shapes, p95 fixture gate. | Red/green evidence in implementation |
| V. Deterministic Extraction | Search is a query-time layer — graph structure untouched; fused ranking deterministic for identical input (stable tie-breaks). | Determinism tests; node/edge counts stable |
| VI. Retrieval Performance | `searchNodes` default unchanged (explore untouched); `codegraph_search` output never says "use Read"; expected conditions success-shaped, never `isError`. Scoped A/B before merge. | Q1/Q4 decisions; A/B evidence per Q10; retrieval-guardian review |
| VII. Local-First, Zero Native Deps | Pure-JS scan over `node:sqlite` BLOBs; no new runtime deps; no network beyond the user-configured embedding endpoint; dormant = byte-identical. | `npm test` incl. dormancy cases; dependency diff |

**Constitution Check:** ✅ Verified — G0 baseline green (see Autopilot Pre-Flight Record
below): `npm run build`, `npm run typecheck`, `npm test` all pass in the worktree. (Worktree bootstrap already verified:
build clean, `codegraph init` at 100% embedding coverage, LSP pass enabled.)

### Autopilot Pre-Flight Record (Step -1 / Step 0) — 2026-07-09

- **Runner:** `speckit_pro_runner` 2.18.1 invoked as `python3 -m speckit_pro_runner` with
  `PYTHONPATH` → plugin cache; vendored copy synced into this worktree's `speckit-pro/`
  (kept out of git via the common `info/exclude`) so repo-anchored helpers target this
  worktree, not the main checkout.
- **check-prerequisites:** `all_pass=true` — SpecKit CLI 0.11.8, project init ✓,
  constitution ✓, commands ✓, workflow file ✓, capability coverage advisory ✓.
  `IS_WORKTREE=true`. Helper branch detection returns an empty string inside worktrees;
  direct git shows `003-hybrid-semantic-search`, matching this file's Branch field →
  `ON_FEATURE_BRANCH=true` (Specify skips branch creation).
- **PROJECT_COMMANDS** (CLAUDE.md authoritative; detect-commands output was generic):
  BUILD=`npm run build` · TYPECHECK=`npm run typecheck` (tsc --noEmit) · LINT=N/A ·
  UNIT_TEST=`npm test` · SINGLE_FILE_TEST=`npx vitest run __tests__/<file>.test.ts` ·
  INTEGRATION_TEST=N/A (eval harness `npm run eval` is separate, not a CI gate) ·
  FULL_VERIFY=`npm run build && npm run typecheck && npm test`.
- **PRESET_CONVENTIONS** (`has_presets=true`): layered — `claude-ask-questions` (top
  layer for spec/plan/tasks templates), `codegraph-project-overrides` (constitution
  test-policy exceptions: bug fixes start from a failing test; installer changes update
  the installer-targets contract suite; reviewability augmentation),
  `speckit-pro-reviewability` (generated base). Passed to every subagent prompt.
- **Settings:** no `.claude/speckit-pro.local.md` → defaults: consensus-mode=moderate,
  gate-failure=stop, auto-commit=per-phase, security-keywords=standard.
- **CONFIDENCE_GATE_MODE=advisory** (resolved once at Step 0.6b; G6.5 reads this value).
- **AGENT_TEAMS_AVAILABLE=true** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, Claude Code
  2.1.206 ≥ 2.1.32).
- **PROJECT_IMPLEMENTATION_AGENT:** none detected (`.claude/agents/` holds only
  `retrieval-guardian`, a review-only agent; CLAUDE.md names no implementation agent) →
  Phase 7 routes: tests/default → `speckit-pro:implement-executor`, research →
  `speckit-pro:domain-researcher`, verification → minimal-viable ad-hoc agent.
- **Agent package completeness (Step 0.0b):** all 11 bundled speckit-pro agents present
  in plugin cache 2.18.1 (incl. `uat-runbook-author.md`) — verified by inspection; the
  `validate-agent-install` id is not registered on the installed read-only runner.
- **Reviewability setup gate (G0 item 8):** SPEC-003-scoped scaffold run is the
  authoritative evidence — **pass, no warnings** (195 reviewable LOC, ~4 production
  files, ~10 total files, 1 primary surface; committed in 7a4d398). Fresh re-run against
  the whole roadmap aggregates all pending specs (380 LOC / 7 files / 6 surfaces) →
  `warn`, `pass=true`. Both outcomes permit proceeding.
- **Tier-2 relocation:** suppressed — SPEC-003 is freshly scaffolded with PROCESS
  artifacts already under `.process/` (already-normalized); no thawed legacy candidates
  with relocatable root PROCESS artifacts remain (prior specs archived).
- **Doctor health check:** doctor/speckit-utils extension not installed → skipped;
  recommendation: `specify extension add speckit-utils`.
- **Hooks (`.specify/extensions.yml`, auto_execute_hooks=true):** after_specify →
  agent-context.update + git.commit; after_plan → agent-context.update + git.commit;
  after_implement → review.run + verify.run (+ registry: verify-tasks, cleanup,
  retrospective, archive, bug, git commands available). Autopilot accepts
  non-destructive hooks and skips duplicates of its own gate checks, logged per phase.
- **Archive Sweep (Step -1):** ✅ complete — archive extension installed; apply-eligibility
  mode (feature branch); current target `specs/003-hybrid-semantic-search` excluded; specs
  enumerated: only the current target (origin/main's `specs/` tree is empty — all previously
  archived specs SPEC-001/002/004/008/023 already removed on main); eligible previous specs:
  **none**; actions taken: **none**; `safeToApplyCleanup=false` (no candidates; active branch
  is not a safe cleanup base). Worktree clean before/after. Noted for awareness only: no
  `.specify/feature.json` (consistent with changelog), stale local branch litter from
  squash-merged SPEC-008 PRs, and a `025-plugin-platform-spike` branch ancestor-of-main with
  no `specs/025-*/` directory anywhere (CLAUDE.md still lists SPEC-025 as ready to scaffold) —
  state-tracking ambiguity, no specs/** artifact to act on.
- **G0 baselines:** ✅ GREEN — `npm run build` PASS (exit 0, 3.5s); `npm run typecheck`
  PASS (exit 0, 2.4s); `npm test` PASS (exit 0, 52.6s, **2685 passed | 7 skipped, 162 test
  files** — this is the G7 test-count baseline). No failures. Constitution automated checks
  (Principles II/III/V/VI/VII structural checks are code-review items validated during
  implementation per Step 0.9) → **Constitution Check: ✅ Verified**.
- **Effort note (2026-07-09):** session effort dropped `max`→`high` mid-run after G0;
  autopilot paused per the skill's effort prerequisite and the operator explicitly
  instructed "continue" — proceeding under operator override (logged as a deliberate
  override; bundled subagents still run at their own configured effort).

---

## Specification Context

### Basic Information

| Field | Value |
|-------|-------|
| **Spec ID** | SPEC-003 |
| **Name** | Hybrid Semantic Search |
| **Branch** | `003-hybrid-semantic-search` |
| **Dependencies** | SPEC-001 (✅ complete — vectors + endpoint provider); SPEC-002 (✅ complete — bundled local ONNX provider) |
| **Enables** | Better retrieval everywhere (MCP search, web UI, wiki); proposed follow-up: A/B-gated explore-fusion spec (design concept Open Questions) |
| **Priority** | P0 |

### Success Criteria Summary

- [ ] Hybrid hit-rate ≥ keyword on the paraphrase eval set (vitest gate in `npm test`, deterministic fixture vectors)
- [ ] Zero keyword regressions: existing search cases byte-stable; `searchNodes` default behavior unchanged (Q1 dormancy)
- [ ] p95 fusion compute ≤150 ms on the generated 50k-node × 384-dim fixture (gated); 3584-dim number reported, not gated (Q5/Q9)
- [ ] Graceful degradation, all success-shaped: no vectors → keyword + hint; no provider at query time → keyword; warming → keyword + note; embed timeout/failure → keyword + hint; never `isError` (Q4)
- [ ] `mode: keyword|semantic|hybrid` on `searchNodes` options, `codegraph_search` schema, and CLI search; `auto` resolution at the explicit surfaces (Q1)
- [ ] Optional `matchType` provenance (+ fused score) present in semantic/hybrid results, absent in keyword mode (Q8)
- [ ] Scoped A/B per Constitution VI: `ab-new-vs-baseline.sh`, ≥2 runs/arm, Sonnet floor, embedded repo + no-vectors control (zero delta) — evidence recorded (Q10)
- [ ] Self-repo dogfood UAT: paraphrase NL queries via `codegraph_search` on this repo's live index against the configured endpoint; dormancy check on an unconfigured project (constitution § Dogfooding)

---

## Phase 1: Specify

**When to run:** At the start. Focus on **WHAT** and **WHY**, not implementation
details. Output: `specs/003-hybrid-semantic-search/spec.md`

### Specify Prompt

```text
/speckit-specify

## Feature: Hybrid Semantic Search (SPEC-003)

### Problem Statement
CodeGraph search is keyword-only (FTS5 + LIKE + fuzzy fallbacks). Paraphrase and
natural-language queries ("function that retries failed HTTP calls") miss symbols
whose names share no tokens with the query, even though SPEC-001/002 already
persist an embedding vector for every declaration symbol. Search should fuse
keyword hits with vector KNN via reciprocal-rank fusion (RRF, k=60) so semantic
matches surface — beating keyword-only on the eval harness — while degrading
gracefully to keyword whenever vectors or a provider are absent.

### Users
- AI agents calling the `codegraph_search` MCP tool with natural-language queries
- Developers using CLI search and the library `searchNodes` API
- Downstream platform features (web UI search, wiki) that reuse `searchNodes`

### User Stories
- [US1] An agent's paraphrase query returns semantically relevant symbols fused
  with keyword hits, each hit carrying matchType provenance (semantic/hybrid modes).
- [US2] A developer selects mode keyword|semantic|hybrid on the CLI and MCP
  surfaces; unspecified mode at those surfaces resolves to auto (hybrid when
  matching-model vectors exist, else keyword).
- [US3] A user with no vectors, no provider, a warming provider, or an embed
  timeout still gets useful keyword results with a success-shaped hint — never an
  error (errors teach abandonment).
- [US4] Existing keyword behavior is untouched: library default mode is keyword,
  internal callers (explore, prompt hook, context builder) see byte-identical
  results, and all existing filters (kind:/lang:/path:/name:) work identically in
  every mode.

### Constraints (from the design concept — cite Q-numbers in FRs)
- Library default mode 'keyword'; auto-resolution only at explicit surfaces (Q1).
- Lazy provider init + keyword-while-warming; internal ~2s per-query embed budget;
  no new env vars (Q4; Constitution II).
- p95 ≤150 ms @ 50k nodes gates fusion compute only (scan + top-k + RRF); the
  query-embed leg (endpoint HTTP or in-process ONNX) is reported, not gated (Q5).
- Lazy in-memory Float32Array matrix cache over vectors whose model matches the
  active provider; per-query staleness probe (vector count + data_version);
  memory = count×dims×4B documented (Q6).
- kind:/lang: pre-filter the scan before top-k; path:/name: post-fusion hard
  gates; embed input is the parsed text with filter tokens stripped (Q7).
- Optional matchType ('keyword'|'semantic'|'both') + fused score on results only
  in semantic/hybrid modes (Q8).
- Deterministic ranking for identical input: stable tie-breaks (Constitution V).
- CI gates in npm test via injected deterministic fixture vectors (Q9).

### Out of Scope
- Hybrid fusion inside codegraph_explore (explicit non-goal — Q2/Q3; deferred to
  a proposed future A/B-gated roadmap entry)
- ANN indexes / quantization (roadmap: follow-up if scale demands)
- Re-ranking models
- New env vars or user-facing tuning knobs for budgets/cache
- Any change to searchNodes default behavior for internal callers
```

### Specify Results

| Metric | Value |
|--------|-------|
| Functional Requirements | 16 (FR-001…FR-016, each citing its design-concept Q-number or constitution principle) |
| User Stories | 4 (US1 P1, US2 P2, US3 P1, US4 P1) — independently testable slices |
| Acceptance Criteria | 12 Given/When/Then scenarios + 8 edge cases + 6 success criteria (SC-001…SC-006) |

**G1 (2026-07-09):** 0 `[NEEDS CLARIFICATION]` markers — marker routing alone would skip
Clarify, but the workflow-prescribed 3 sessions (seeded from design-concept open areas,
deliberately left to specification detail) run anyway; G2's approval criteria require
those areas resolved. Template requirements checklist
(`specs/003-hybrid-semantic-search/checklists/requirements.md`): 0 gaps.
`.specify/feature.json` created by /speckit-specify (feature_directory pointer) —
committed with this phase. Spec-MOC index check: **current** (no regen needed; write-mode
regen is not registered on the installed runner — check-only available).
**after_specify hooks:** `speckit.git.commit` skipped (duplicates the autopilot's own
phase commit); `speckit.agent-context.update` deferred to after_plan (the update script
extracts tech stack from plan.md, which doesn't exist yet; CLAUDE.md is upstream-owned —
fork discipline says minimal diffs, so run it only where it's designed to act).

### Files Generated

- [x] `specs/003-hybrid-semantic-search/spec.md`
- [x] `specs/003-hybrid-semantic-search/checklists/requirements.md` (template quality checklist, 0 gaps)
- [x] `.specify/feature.json`

### SpecKit Traceability Markers

| Marker | Purpose | Example |
|--------|---------|---------|
| `[US1]`, `[US2]` | User story reference | `[US1] Paraphrase query returns fused hits` |
| `[FR-001]` | Functional requirement | `[FR-001] mode parameter accepted on searchNodes` |
| `[NEEDS CLARIFICATION]` | Flag for Clarify phase | `Candidate depth per arm [NEEDS CLARIFICATION]` |
| `[P]` | Parallel-safe task | `[P] Can run alongside other tasks` |
| `[Gap]` | Missing coverage | `[Gap] No task covers model-mismatch degradation` |

---

## Phase 2: Clarify

**When to run:** After Specify. Maximum 5 targeted questions per session. The
grill-me interview already resolved the architecture-level decisions (Q1–Q10);
these sessions target what it deliberately left to specification detail.

### Clarify Prompts

#### Session 1: Fusion mechanics

```text
/speckit-clarify Focus on fusion mechanics: candidate depth per arm (keyword arm
already over-fetches 5×limit; semantic top-k depth), RRF k=60 application and the
merged-score formula, deterministic tie-breaks for equal fused scores, semantic-arm
eligibility (only nodes with matching-model vectors), and how pure 'semantic' mode
behaves when FTS would have contributed exact-name matches. Do NOT reopen decisions
Q1/Q4–Q8 from docs/ai/specs/.process/SPEC-003-design-concept.md — build on them.
```

#### Session 2: Degradation UX & observability

```text
/speckit-clarify Focus on degradation and observability: exact success-shaped hint
wording for each fallback (no vectors / no provider / provider warming / embed
timeout / model-dims mismatch), how codegraph_search and CLI annotate matchType,
whether codegraph status should surface query-side semantic availability, and what
the reported (not gated) embed-leg latency looks like in output. Hints must never
instruct the agent to use Read (Constitution VI).
```

#### Session 3: Fixture & eval design

```text
/speckit-clarify Focus on test/eval design: how the deterministic fixture vectors
are injected (fixture provider seam) without a live endpoint, generation of the
50k-node × 384-dim latency fixture, the paraphrase case set shape in
__tests__/evaluation/ plus the vitest gate suite, p95 measurement method (N runs,
which percentile machinery), and the no-vectors dormancy assertions (byte-identical
keyword behavior).
```

### Clarify Results

| Session | Focus Area | Questions | Key Outcomes |
|---------|------------|-----------|--------------|
| 1 | Fusion mechanics | 5 | Q1: both arms feed RRF at depth `max(5×limit,100)` (FR-004). Q2: rank-only RRF formula `Σ 1/(k+rank)`, no raw magnitudes (FR-004, Key Entities). Q3: ascending node-id tie-breaks at both levels (FR-013). Q4 (consensus): keyword rescoring stays intra-arm — FR-004a added. Q5 (consensus): pure `semantic` = vector-arm only — FR-002a + US2 scenario 4 added; FR-004 opening clause corrected to scope fusion to hybrid. |
| 2 | Degradation UX | 5 | Q2: inline `[keyword]`/`[semantic]`/`[both]` per-hit tag, fused score `--json`-only (FR-012). Q5: footer placement, emitted every query while condition holds (FR-005). Consensus — Q1: four literal hint strings, model-mismatch folded, normative table under FR-015 (strings corrected to shipped `status` wording + FR-006's failure scope); Q3: FR-017 + SC-007 status availability line ruled IN-SCOPE (SPEC-001/002 same-block precedent); Q4: `semantic: embed Xms · fusion Yms` footer only when semantic arm ran + `--json` machine fields (FR-008). |
| 3 | Fixture & eval | 5 | Q1: two-seam determinism injection — seed `node_vectors` via existing f32 codec + one named test-only query-provider seam (FR-014, Assumptions). Q2: 50k×384 latency fixture from a seeded pure-JS PRNG, in-memory, no committed asset (FR-014). Q5: byte-identical asserted via deep-equal + explicit field-absence + zero-embed-call spy (FR-014). Consensus — Q3: p95 machinery = N=200 iterations, fixed 10-iter warmup, nearest-rank `sorted[189]`, no retry (FR-014c, SC-002); Q4: non-tautological gate — SC-001 aggregate `≥` with strict semantic-only anchor case, FR-014 restructured (a)/(b)/(c), binding fixture rules added to Assumptions (4-column keyword-miss, decoys, unit-normalized vectors, model-id byte-match + direct semantic-arm assertion, new top-level test file). |

### Consensus Resolution Log

| # | Type | Question/Gap/Finding | Categories | Round | Outcome | Resolution | Analysts Used |
|---|------|----------------------|------------|-------|---------|------------|---------------|
| 1 | Clarify | S1-Q4: is keyword multi-signal rescoring re-applied post-fusion? | [codebase] | 1 | high-confidence | No — intra-arm only; FR-004a added | codebase-analyst |
| 2 | Clarify | S1-Q5: pure `semantic` mode — vector-only or exact-name-supplemented? | [spec, domain] | 1 | both-agree | Vector-only; FR-002a + US2 scenario 4 added; FR-004 opening scoped to hybrid | spec-context-analyst, domain-researcher |
| 3 | Clarify | S2-Q1: exact degradation hint strings; fold model-mismatch? | [spec] | 1 | high-confidence | 4 literal strings (fold confirmed); table added under FR-015; strings 1/4 corrected to shipped precedent (status dormant wording; FR-006 failure scope) | spec-context-analyst |
| 4 | Clarify | S2-Q3: `codegraph status` query-side availability line — in scope? | [spec] | 1 | high-confidence | IN-SCOPE; FR-017 + SC-007 added (SPEC-001 FR-022 / SPEC-002 FR-021 same-block precedent) | spec-context-analyst |
| 5 | Clarify | S2-Q4: embed-leg latency reporting surface | [spec] | 1 | high-confidence | Footer only when semantic arm ran + `--json` machine fields; FR-008 rendering clause added | spec-context-analyst |
| 6 | Clarify | S3-Q3: p95 measurement machinery | [spec, domain] | 1 | both-agree | N=200, fixed 10-iter warmup, nearest-rank `sorted[189]`, no retry (headroom is the ratified anti-flake mechanism); FR-014(c) + SC-002 amended | spec-context-analyst, domain-researcher |
| 7 | Clarify | S3-Q4: non-tautological hybrid≥keyword gate construction | [codebase, spec] | 1 | both-agree | SC-001 aggregate `≥` + strict semantic-only anchor; FR-014 (a)/(b)/(c) restructure; binding fixture rules in Assumptions | codebase-analyst, spec-context-analyst |
| 8 | Gap | CHK008: runner-class normalization for the absolute-ms p95 gate | [domain] | 1 | high-confidence | Absolute floor + 10× headroom confirmed as industry pattern (catastrophic-regression gate, not delta gate); FR-014d strengthened with empirical noise budget + GitHub runner-spec anchor | domain-researcher |
| 9 | Gap | CHK017: runtime memory guard at the 50k×3584 ≈717 MB matrix corner | [codebase, domain] | 1 | both-agree | FR-009c revised document-only → cheap pre-build guard: `MAX_MATRIX_BYTES`=1 GiB hardcoded (repo pool-ceiling idiom), fires only ABOVE the documented corner, degrades to keyword rendering hint string 4 | codebase-analyst, domain-researcher |
| 10 | Gap | CHK009: `.score` value in semantic/hybrid modes | [codebase, domain] | 1 | both-agree | `score` = fusedScore (primary score = actual sort key; cross-vendor invariant; types.ts contract + monotonicity); existing FR-012/contract text confirmed, no edit | codebase-analyst, domain-researcher |
| 11 | Gap | CHK022: `--json` naming/placement for FR-017 availability fields | [codebase] | 1 | high-confidence | Flat top-level camelCase confirmed (flat-scalar vs nested-snapshot repo split; EmbeddingStatus contract frozen); added `null` iff `true` invariant to FR-017 + contract | codebase-analyst |
| 12 | Gap | CHK015: `options.offset` semantics in fused modes | [codebase] | 1 | high-confidence | Post-fusion slice kept (zero first-party offset callers; unsupported-in-v1 costs more); FR-012 + contract reworded — bounded by fixed candidate depth, deep pages return < limit, not an error | codebase-analyst |

---

## Phase 3: Plan

**When to run:** After spec is finalized. Output: `specs/003-hybrid-semantic-search/plan.md`

### Plan Prompt

```text
/speckit-plan

## Tech Stack
- TypeScript strict (tsc), Node engines >=20 <25 (effective from-source floor
  22.5+ for node:sqlite); no new runtime dependencies — pure JS/WASM only
  (Constitution VII)
- Storage: node:sqlite (DatabaseSync) — node_vectors BLOBs are little-endian f32,
  decode helper already in src/embeddings/indexer-hook.ts
- Providers: src/embeddings/ (endpoint-provider.ts HTTP /v1/embeddings;
  local-provider.ts in-process ONNX worker, 384 dims; config.ts selection order
  endpoint → local → off)
- Keyword arm: QueryBuilder.searchNodes in src/db/queries.ts (FTS5 → LIKE →
  fuzzy + exact-name supplement + multi-signal rescoring) — reuse verbatim as the
  keyword arm, do not restructure
- Surfaces: src/index.ts searchNodes plumbing; src/mcp/tools.ts codegraph_search
  (handleSearch) schema + formatting; src/bin/codegraph.ts CLI search
- Testing: vitest (__tests__/), evaluation harness (__tests__/evaluation/ via
  npm run eval)

## Required decisions from the Design Concept (source of truth; cite Q-numbers)
- Q1 mode plumbing: searchNodes({mode}) default 'keyword'; 'auto' resolution
  helper used ONLY by codegraph_search, CLI, and explicit callers
- Q4 lazy provider init + keyword-while-warming; internal ~2s embed budget
- Q5 latency gate = fusion compute only; embed leg reported
- Q6 lazy in-memory matrix cache (matching-model vectors), staleness probe =
  vector count + data_version; memory documented in code comments + BUNDLING/docs
- Q7 pre-filter kind/lang in scan; path/name post-gates; embed parsed.text
- Q8 optional matchType + fused score, set only in semantic/hybrid modes
- Q9 vitest CI gates w/ fixture vectors; eval harness cases added
- Q10 scoped A/B plan (ab-new-vs-baseline.sh) written into the UAT runbook

## Architecture notes
- New module src/search/hybrid.ts: query-vector acquisition (active provider,
  budget-capped), matrix cache + staleness probe, cosine top-k heap, RRF merge
  (k=60) with the keyword arm's results, matchType assignment
- Model matching: scan only vectors whose model column equals the active
  provider's model id; zero matching vectors → keyword + hint (follows
  SPEC-001/002 re-embed-on-switch precedent)
- Where the cache lives relative to the daemon query pool: pick ONE owner so the
  matrix is not duplicated per worker; document the choice and its RSS impact
- MCP schema: optional mode enum on codegraph_search (schema change in tools.ts
  tool definition; keep description agent-friendly, single source of truth stays
  server-instructions.ts if guidance changes — issue #529)
- Deterministic ordering: stable sort keys (fused score, then node id) so
  identical input yields identical output (Constitution V)

## Constraints
- Dormancy: with no vectors and no provider, every surface byte-identical to
  today (Constitution VII + dogfooding law); prove with tests
- Surgical diffs: hybrid logic isolated in src/search/hybrid.ts; existing files
  gain plumbing only (Constitution III)
- Reviewability budget: 195 projected reviewable LOC, ~4 production files,
  ~10 total files, single primary surface (API/search path) — setup gate passed
  with zero warnings; hold the implementation near this envelope
```

### Plan Results

| Artifact | Status | Notes |
|----------|--------|-------|
| `plan.md` | ✅ | Summary, Technical Context, Constitution Check (PASS ×2), Project Structure, empty Complexity Tracking |
| `research.md` | ✅ | D1–D14 resolved decisions; two design discoveries: no `data_version` column → staleness = coverage-count + `project_metadata`, zero schema writes (strengthens VII); pool workers own separate DB isolates → matrix cache owner = single main-daemon process (strengthens III) |
| `data-model.md` | ✅ | E1–E7 runtime shapes; optional result fields; no persistent schema change |
| `contracts/` | ✅ | search-api.md (library signature) · mcp-cli-surface.md (schema + CLI flags/rendering) · degradation-hints.md (4 literal strings + FR-017 line) |
| `quickstart.md` | ✅ | CI gates, eval, smoke checks, dormancy, A/B, full verify |

**Post-plan boundary record (2026-07-09):** G3 validate-gate → pass (0 markers; first run
counted 1 benign bracketed token in plan.md prose — reworded, auto-fix attempt 1 of 2).
`estimate-reviewable-loc` → **not_estimated** (`projected: null` — plan.md declares no
machine-parseable production-file table); recorded as *not estimated*, NOT treated as a
within-budget pass (advisory, run continues per protocol). Spec-MOC index check: current.
after_plan hooks: `agent-context.update` satisfied in-phase (plan skill updated the
CLAUDE.md `<!-- SPECKIT START/END -->` block — rides this phase commit);
`speckit.git.commit` skipped as duplicate of the autopilot's own phase commit.

---

## Phase 4: Domain Checklists

**When to run:** After `/speckit-plan` — validates spec AND plan together.

### Step 1: Recommended Domains (from spec analysis)

| Signal in SPEC-003 | Domain |
|---|---|
| p95 fusion-compute gate, matrix cache memory, 50k fixture | **performance** |
| searchNodes options, MCP schema mode enum, matchType result shape, CLI flag | **api-contracts** |
| Five degradation paths, success-shaped hints, never-isError doctrine | **error-handling** |

### Step 2: Enriched Checklist Prompts

#### 1. performance Checklist

<!-- Why: the spec carries a hard latency gate and a memory-bearing cache; the riskiest quantitative surface. -->

```text
/speckit-checklist performance

Focus on Hybrid Semantic Search requirements:
- p95 fusion compute ≤150 ms on the 50k×384 fixture: measurement method, run
  count, and CI-stability headroom (Q5/Q9)
- Matrix cache: build cost on first semantic query, staleness-probe cost per
  query, memory = count×dims×4B documented incl. the 717 MB corner (Q6)
- Keyword-arm latency unchanged in keyword mode (no cache build, no embed call)
- Embed-leg budget (~2s) interaction with the keyword fallback — no query ever
  blocks past the budget (Q4)
- Pay special attention to: the p95 gate flaking on shared CI runners — headroom
  and percentile method must make it deterministic in practice
```

#### 2. api-contracts Checklist

<!-- Why: three public surfaces gain a mode parameter and an optional result field; shape stability is the compatibility contract. -->

```text
/speckit-checklist api-contracts

Focus on Hybrid Semantic Search requirements:
- searchNodes(options.mode) accepted values + default 'keyword'; auto-resolution
  documented at the surfaces, not the library (Q1)
- codegraph_search schema: optional mode enum, backward compatible; formatting of
  matchType annotations (Q8)
- CLI search mode flag semantics and help text
- SearchResult shape: matchType + fused score OPTIONAL and absent in keyword mode
  — existing consumers see byte-identical shapes (Q8)
- Pay special attention to: accidental behavior change for internal searchNodes
  callers (explore, prompt hook, context builder) — must be provably untouched
```

#### 3. error-handling Checklist

<!-- Why: five distinct degradation paths, each of which must be success-shaped — the errors-teach-abandonment doctrine is a hard project law. -->

```text
/speckit-checklist error-handling

Focus on Hybrid Semantic Search requirements:
- Each fallback path has a defined, success-shaped response: no vectors; no
  provider configured; provider warming (first query); embed timeout/failure;
  model/dims mismatch (Q4, roadmap degradation scope)
- No path returns isError: true; no hint ever instructs the agent to use Read
  (Constitution VI)
- Provider failure during warming latches cleanly — subsequent queries retry or
  stay keyword without wedging the daemon
- Pay special attention to: the ~2s budget expiring while the embed eventually
  succeeds — the late vector must not corrupt cache/provenance state
```

### Checklist Results

| Checklist | Items | Gaps | Spec References |
|-----------|-------|------|-----------------|
| performance | 30 (CHK001–030) | 13 found → 0 remaining (11 executor-fixed, 2 via consensus) | New spec subsection "Performance Budgets & CI-Stability": FR-003a, FR-006a, FR-008a/b, FR-009a/b/c, FR-014d. Consensus: CHK008 → FR-014d kept + noise-budget & GitHub runner-spec anchoring; CHK017 → FR-009c revised to a pre-build memory guard (`MAX_MATRIX_BYTES`=1 GiB, above the 717 MB corner, folds into hint string 4). |
| api-contracts | 30 (CHK001–030) | 5 found → 0 remaining (all executor-fixed; 3 confirmed/refined via consensus) | CLI `-m/--mode` help text; `score`=`fusedScore` in fused modes (confirmed 2-analyst); unknown-mode coercion (library→keyword, surfaces→auto, never error); offset = bounded post-fusion slice with documented depth truncation; FR-017 `--json` flat fields + null-iff-available invariant. Files: spec.md FR-001/002/012/017 + all 3 contracts. |
| error-handling | 25 (CHK001–025) | 5 found → 0 remaining (all executor-fixed; **0 unresolved → consensus round skipped**) | No-abandonment invariant (hints never steer to Read); FR-005 provider-init failure latch (re-attempt serialized, budget-bounded, never wedges); FR-006 late-vector discard (no cache/provenance mutation after budget expiry); string 4 = catch-all for unexpected semantic-path exceptions; healthy empty embed-input arm = NOT degraded (no hint, no footer). Files: spec.md FR-005/006 + Edge Cases + hint section; contracts/degradation-hints.md. |
| **Total** | 85 items + template requirements checklist | 23 gaps found → 0 remaining | G4 validate-gate: pass (0 markers across all checklist files) |

### Addressing Gaps

1. Review the gap — genuine missing requirement?
2. Update `spec.md` or `plan.md` to address it
3. Re-run the checklist to verify coverage
4. If intentionally out of scope, document why (cite the design concept Q-number)

---

## Phase 5: Tasks

**When to run:** After checklists complete. Output: `specs/003-hybrid-semantic-search/tasks.md`

### Tasks Prompt

```text
/speckit-tasks

## Task Structure
- Small, testable chunks (1-2 hours each); acceptance criteria referencing FR-xxx
- TDD ordering per Constitution IV: failing test precedes implementation
- Dependency ordering: fusion core (hybrid.ts + cache) → library plumbing →
  MCP/CLI surfaces → eval/vitest gates → A/B + dogfood UAT
- Mark parallel-safe tasks [P]; organize by user story, not technical layer

## Bounds (from the design concept — flag any task crossing them)
- NO task may touch codegraph_explore's retrieval path (Q2 non-goal)
- NO ANN/quantization, NO re-ranker, NO new env vars (non-goals)
- searchNodes default stays 'keyword' — a task changing internal-caller behavior
  is out of bounds (Q1)

## Required coverage
- Deterministic fixture-vector seam + paraphrase eval cases (Q9)
- p95 fixture generation + gate test (Q5/Q9)
- Dormancy proof tasks (byte-identical keyword behavior, zero network) —
  constitution § Dogfooding
- Scoped A/B execution + evidence recording task (Q10)
- Self-repo dogfood UAT task (constitution: exercise on this repository's index)
- CHANGELOG entry under ## [Unreleased] (user-facing wording)

## Constraints
- Tests in __tests__/ (vitest, real SQLite, no DB mocking; temp dirs via
  fs.mkdtempSync); eval cases in __tests__/evaluation/
- New production code in src/search/hybrid.ts; minimal plumbing diffs elsewhere
```

### Tasks Results

| Metric | Value |
|--------|-------|
| **Total Tasks** | 34 (T001–T034) |
| **Phases** | 7 — Setup · Foundational · US1 MVP (T006–T013) · US2 (T014–T017) · US3 (T018–T024) · US4 (T025–T027) · Polish (T028–T034) |
| **Parallel Opportunities** | 5 `[P]` tasks (T002; T016+T017 pair; T028, T031, T032) |
| **User Stories Covered** | 4/4 (US1–US4); every FR-001…FR-017 + checklist sub-FR and SC-001…SC-007 mapped to ≥1 task |

**Post-G5 boundary record (2026-07-10):** G5 validate-gate → pass (34 tasks, 0 markers).
Verify-tasks phantom check → trivially clean (0 tasks marked `[X]` in a fresh tasks.md;
recorded deterministically, no agent needed). Tasks-phase reviewability gate → **deferred**
(installed runner supports setup mode only); fallback evidence chain: setup-gate pass
(scaffold, 195 LOC budget) + plan-phase estimate `not_estimated` (advisory) + no operator
split decision + T005 reviewability checkpoint task → **proceed**. PR marker plan:
**not_required** (no size-only block exists). State persisted in
`docs/ai/specs/.process/autopilot-state.json` (repointed from SPEC-008's archived state).

---

## Atomicity Route

**When this is filled:** After the Tasks phase / gate G5, the autopilot SKILL runs
the read-only atomicity classifier and records its decision here. This is a
**placeholder** until then — leave the cells blank during scoping.

| Field | Value | Meaning |
|-------|-------|---------|
| **Route** | `one-navigable-PR` | Default/modify-heavy route — one PR, navigable by review order. |
| **Releasable** | `true` | No destructive-migration or concurrency-sensitive change detected. |
| **Signals** | `change-shape:modify-heavy` | Existing-file plumbing dominates (queries/index/tools/bin), one new module. |
| **Warnings** | none | |

## Layer Plan

`layer_plan.status = skipped` — route is `one-navigable-PR`, not `split-PR`; the layer
planner runs only for split routes. Recorded in `autopilot-state.json` (2026-07-10).

To produce the decision:

```text
runner helper atomicity-route specs/003-hybrid-semantic-search
```

---

## Phase 6: Analyze

**When to run:** Always run after generating tasks.

### Analyze Prompt

```text
/speckit-analyze

Focus on:
1. Constitution alignment — Principles I–VII; especially V (deterministic
   ranking), VI (no isError for expected conditions; explore untouched;
   scoped A/B planned), VII (dormancy byte-identical, zero new deps)
2. Design-concept drift — spec.md/plan.md/tasks.md must not contradict
   docs/ai/specs/.process/SPEC-003-design-concept.md (Q1–Q10). The design
   concept wins unless a revision note says otherwise.
3. Coverage — every FR and user story has tasks; the five degradation paths
   each have a test task; the A/B and self-repo UAT tasks exist
4. Consistency between task file paths and the actual module layout
   (src/search/hybrid.ts, src/db/queries.ts, src/index.ts, src/mcp/tools.ts,
   src/bin/codegraph.ts, __tests__/)
```

### Analyze Severity Levels

| Severity | Meaning | Action Required |
|----------|---------|-----------------|
| `CRITICAL` | Blocks implementation, violates constitution | **Must fix before G6** |
| `HIGH` | Significant gap, impacts quality | Should fix |
| `MEDIUM` | Improvement opportunity | Review and decide |
| `LOW` | Minor inconsistency | Note for future |

### Analysis Results

| ID | Severity | Issue | Resolution |
|----|----------|-------|------------|
| C1 | HIGH | 4 spec.md sites (FR-009, Edge Cases staleness, Key Entities cache, Assumptions) still described the staleness probe as "vector count + data_version" — no `data_version` column exists (schema.sql:161-167; grep src/ = 0 hits) | All 4 rewritten to the authoritative FR-008b mechanism (matching-model count + `project_metadata` scalars), each noting the column doesn't exist |
| C2 | HIGH | plan.md Storage line claimed a `data_version` column, self-contradicting its own Post-Phase-1 re-check | Rewritten to match the re-check (FR-008b mechanism) |
| G1 | MEDIUM | SC-006 (identical query ⇒ identical ordering) had no dedicated run-twice assertion task | T006 extended: run one hybrid fixture query twice, deep-equal ordered hit lists (FR-013 both levels) |
| X1 | LOW | No-abandonment note misattributed the verbatim hint-string assertion to FR-014 tests | Reattributed to the FR-015 / US3 degradation tests |
| N1 | LOW | X1's reword left a bare task-ID (T018) in spec.md — stale-on-renumber upstream→downstream ref | Removed; attribution uses durable FR-015/US3 identifiers only. 0 bare task-IDs remain in spec.md |

**Loops used:** 2 of 2 (re-run confirmed C1/C2/G1/X1 resolved; N1 introduced-then-fixed).
**Unresolved for consensus:** none → consensus resolution round skipped; the Pre-Implement
Confidence emit still runs (single consensus-synthesizer fan-out) as G6.5's data source.

### Pre-Implement Confidence (consensus-synthesizer emit, 2026-07-10)

📊 Confidence: 0.96

- Task understanding: 0.97
- Approach clarity: 0.96
- Requirements alignment: 0.96
- Risk assessment: 0.95
- Completeness: 0.97

Synthesizer inspected the live artifacts directly: spec.md (313 lines, 17 FRs + sub-clauses,
literal hint table, SC-001…SC-007, fixture rules), plan.md (constitution PASS ×2, one new
module + plumbing-only, budget zero-warnings), tasks.md (34 TDD-ordered tasks, full FR/SC
mapping, guardrails encoded), workflow Analysis Results (5 findings all resolved, G6 0
CRITICAL/HIGH), and all supporting artifacts present and substantial. Deduction held solely
for inherent surface risk (embed-timeout races, cache staleness, CI p95 stability).

---

## Phase 7: Implement

**When to run:** After tasks.md is generated and analyzed (no coverage gaps).

### Implement Prompt

```text
/speckit-implement

## Approach: TDD-First (Constitution IV)

For each task: RED (failing test) → GREEN (minimum code) → REFACTOR → VERIFY.

### Project Commands
- BUILD: npm run build
- TYPECHECK: npm run typecheck
- UNIT_TEST: npm test
- SINGLE_FILE_TEST: npx vitest run __tests__/<file>.test.ts
- FULL_VERIFY: npm run build && npm run typecheck && npm test

### Pre-Implementation Setup
- Worktree already bootstrapped (npm install, build, codegraph init at 100%
  embedding coverage, LSP enabled); verify npm test green before the first task
- The dogfood MCP daemon serves HEAD builds via scripts/mcp-dogfood.mjs — after
  meaningful changes, npm run build refreshes what agents exercise

### Implementation Notes
- Match existing style in each touched file (Constitution III); comment density
  in src/db/queries.ts and src/mcp/tools.ts is high and explanatory — follow it
- src/search/hybrid.ts is the only new production module; keep plumbing diffs
  in queries.ts/index.ts/tools.ts/bin minimal and mode-gated
- matchType + fused score set ONLY in semantic/hybrid modes (Q8); keyword-mode
  result objects byte-identical to today
- Success-shaped hints for every degradation path; never isError; never tell
  the agent to Read (Constitution VI)
- Deterministic tie-breaks (fused score, then node id) so identical input →
  identical output (Constitution V)
- CHANGELOG.md entry under ## [Unreleased] → ### New Features, user-facing
  wording, no internal paths/symbols
```

### Implementation Progress

| Phase | Tasks | Completed | Notes |
|-------|-------|-----------|-------|
| 1 - Fusion core (hybrid.ts + cache) | T001–T013 (Setup + Foundational + US1) | 13/13 ✅ | Gate file 43/43; full suite 2727 passed / 0 failed at T012; **observed fusion p95 = 19.9 ms vs 150 ms gate (~7.5× headroom; FR-014d 2× revisit NOT triggered)**; median 19.4 ms over N=200, warmup 10, 50k×384 seeded fixture. TDD evidence per task in transcripts; T006 gate went RED→GREEN at T012 with zero assertion rewrites. |

**Design decision recorded mid-implement (T012, 2026-07-10, orchestrator-approved):**
`searchNodes` is contract-bound synchronous (`SearchResult[]`, all callers), but providers
embed async-only — no production-only bridge exists (a sync-over-async spin bridge was
tried by a failed executor and deadlocked the main thread; reverted). Resolution mirrors
FR-005's own keyword-while-warming semantics at the library layer: async
`acquireQueryVectorForSearch` (the single async entry the MCP/CLI surfaces await) deposits
into a bounded sync LRU query-vector cache (`QUERY_VECTOR_CACHE_MAX = 32`, internal
constant, no knob — FR-007) keyed by (filter-stripped text, model id); sync `searchNodes`
reads it and fuses; cache miss → keyword results in dormant shape (warming). Keyword path
remains zero-touch (FR-003/003a). Boundary documented in a header comment in src/index.ts.
Test impact: additive fixture pre-warm only (US1 scenario 1's "warmed provider" Given);
zero assertion rewrites.

**T033 findings ledger (2026-07-10, grounded by re-running the suites):**
1. **Open regression (route to remediation before G7):** `__tests__/security.test.ts › should
   truncate oversized tool output` fails — the pre-existing test's `fakeCg` mock implements only
   `searchNodes`, while SPEC-003's `handleSearch` (src/mcp/tools.ts) now also calls
   `acquireQueryVectorForSearch` + `searchNodesDetailed` (throw → isError:true). Fix = extend the
   mock (or pass `mode:'keyword'`); production code is correct. Full suite at T033: 2798 passed /
   1 failed / 7 skipped.
2. **p95 correction:** grounded p95 fusion = **49.9 ms** (median 22.4 ms) — the earlier "19.9 ms"
   recorded at US1-close was the distribution *min*, not p95. Gate ≤150 ms still passes with ~3×
   headroom; FR-014d 2× revisit still NOT triggered.
3. **Test-count correction:** per-file counts are 81 / **11** / **22** / 5 (hybrid-search /
   mcp-surface / cli-surface / status-json), total 119 — not the 12/30 quoted in earlier notes.
4. **Reviewability budget: OVER.** Raw added production LOC **1830** across **6** src files
   (code-only, non-blank/non-comment: **743**) vs the setup-gate estimate of ~195 LOC / ~4 files
   (~3.8× code-only). Cause: estimator modeled a thin slice; the fusion module (RRF + matrix
   cache + staleness probe + 4 degradation conditions + embed-budget discipline) is inherently
   larger. Recorded here as committed evidence for the post-impl Reviewability Diff Gate —
   needs an explicit warn/exception decision there, not silent pass.
5. Non-goals verified held: explore path + server-instructions.ts untouched; no ANN/re-ranker;
   no new env vars (all 3 `CODEGRAPH_EMBEDDING_*` pre-exist from SPEC-002); schema.sql untouched
   (no migration).
| 2 - Library + surfaces (US1/US2) | T014–T017 (MCP `codegraph_search` mode param + provenance tags + timing footer; CLI `--mode` + footers; status availability line) | 4/4 ✅ | `hybrid-mcp-surface` 12/12, `hybrid-cli-surface` 30/30, status-json 5/5. Env-hermeticity fix applied twice (subprocess CHILD_ENV scrub commit 929f13f; in-process vitest-worker scrub commit 15bdf71) — direnv-loaded live HAL endpoint was activating semantic paths inside dormant-path tests. `codegraph_explore` + server-instructions.ts untouched (non-goal held). |
| 3 - Degradation paths (US3) | T018–T024 (4 literal hint strings; no-provider/no-vectors/guard/warming precedence; memory guard; unknown-mode→auto) | 7/7 ✅ | Deliberately resequenced BEFORE US2 surface renderers needed them; all 4 `DEGRADATION_HINT_STRINGS` byte-pinned in tests; precedence order no-provider→no-vectors→guard/embed-failure→warming verified; suite re-run green after load-spike false failures (contention at load 72, quiet re-run 110/110). |
| 4 - Dormancy + gates + polish (US4) | T025–T034 | 9.5/10 (T034 in flight; T029+T030+T033 ✅ 2026-07-10) — **T030 dogfood UAT**: live index 4,630/4,630 vectors (nomic-embed-code 3584d); 4/4 paraphrase queries semantic rank 1 (3) / top-4 (1), incl. pre-SPEC-003 code (`reapDeadClients`); keyword contrast: Q1 ground truth absent from keyword top-6; MCP `codegraph_search` surface matches CLI (tags + timing footer render); dormancy: env-scrubbed temp project → result rows byte-identical auto vs keyword, hint-only delta per T022 contract. Evidence: `specs/003-hybrid-semantic-search/.process/dogfood-uat.md` | Dormancy byte-parity pinned (T025–T027). T028 eval cases + T031 memory-envelope docs + T032 CHANGELOG done. **T029 scoped A/B complete** — evidence: `specs/003-hybrid-semantic-search/.process/ab-evidence.md`: agent A/B null (Sonnet never picked codegraph in either arm — known salience wall, both arms 0 codegraph calls, overlapping ranges); **deterministic probe decisive** (paraphrase query: BASE keyword ground-truth MISS vs NEW semantic/hybrid/auto rank #1); dormant control zero-delta (auto degrades to exact keyword output, no tags, no crash). Model policy honored (sonnet+high both arms). |

---

## Post-Implementation Checklist

- [ ] All tasks marked complete in tasks.md
- [ ] Typecheck passes: `npm run typecheck`
- [ ] Tests pass: `npm test` (incl. new vitest gates: hybrid ≥ keyword, keyword byte-stable, p95 fixture)
- [ ] Build succeeds: `npm run build`
- [ ] `npm run eval` semantic cases recorded in the scored report
- [x] Scoped A/B evidence recorded (≥2 runs/arm, Sonnet floor, embedded repo + no-vectors control; wrapper `ab-spec003.sh` over canonical script — canonical would zero vectors in both arms) — Q10 · `specs/003-hybrid-semantic-search/.process/ab-evidence.md`
- [ ] Self-repo dogfood UAT recorded in the UAT runbook (paraphrase queries via codegraph_search on this repo against the configured endpoint; dormancy spot-check)
- [ ] retrieval-guardian review run (diff touches src/mcp/ + search path — CLAUDE.md requires it before PR)
- [ ] CHANGELOG entry under `## [Unreleased]` (user-facing)
- [ ] PR created against origin (racecraft-lab/codegraph) with review packet body; no session URLs
- [ ] Merged; dogfood loop run on main (`npm run build` + `codegraph sync`, verify `codegraph status` healthy)

---

## Lessons Learned

### What Worked Well

-

### Challenges Encountered

-

### Patterns to Reuse

-

---

## Project Structure Reference

```
codegraph/
├── src/
│   ├── search/            # query parser + helpers; NEW: hybrid.ts (KNN + RRF fusion)
│   ├── db/                # DatabaseConnection, QueryBuilder (keyword arm), schema.sql
│   ├── embeddings/        # SPEC-001/002: providers, config selection, encode/decode, indexer hook
│   ├── mcp/               # tools.ts (codegraph_search handleSearch), server-instructions.ts, daemon
│   ├── bin/codegraph.ts   # CLI (commander) — search/query surface
│   └── index.ts           # CodeGraph public API — searchNodes plumbing
├── __tests__/             # vitest suites (real SQLite, no mocking)
│   └── evaluation/        # eval harness (npm run eval) — semantic paraphrase cases land here
├── specs/003-hybrid-semantic-search/   # CONTRACT artifacts (spec.md, plan.md, tasks.md, SPEC-MOC.md)
└── docs/ai/specs/.process/             # this workflow + SPEC-003-design-concept.md (EXHAUST)
```

---

Template based on SpecKit best practices; populated from the technical roadmap § SPEC-003 and the grill-me design concept (Q1–Q10).
