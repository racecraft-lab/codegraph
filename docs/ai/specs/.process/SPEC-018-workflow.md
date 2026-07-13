# SpecKit Workflow: SPEC-018 — LLM Access Layer

**Template Version**: 1.0.0
**Created**: 2026-07-13
**Purpose**: Execute SPEC-018 through the SpecKit workflow: one shared LLM capability in `src/llm/` with two first-class paths — a BYO OpenAI-compatible endpoint client and an agent-driven task-bundle mode — degrading to consumer-supplied heuristics when unconfigured. Consumers call `generate(prose-task)` and always receive usable text, never an error for absence of config. Ships in **2 vertical slices** (design concept Q12).

---

## Design Concept

This workflow file was enriched from a Grill Me interview run during
`/speckit-pro:speckit-scaffold-spec SPEC-018`. The full Q&A log, Goals, Non-goals, and
Open Questions live at:

```text
docs/ai/specs/.process/SPEC-018-design-concept.md
```

Re-read it before each phase. The design concept is the source of truth for scoping
decisions captured during setup. The load-bearing decisions (by Q-number):

- **Q1** — async model: **heuristic-now, upgrade-later.** `generate()` never blocks
  on an agent: in bundle mode it emits the task bundle AND immediately returns the
  caller's heuristic fallback plus a pending-bundle handle; ingestion later finalizes
  the canonical result for retrieval.
- **Q2** — heuristics are **consumer-supplied**: each `generate(task)` call carries
  the caller's own fallback producer. The layer guarantees "you always get text" but
  never invents domain heuristics (no layer-owned registry).
- **Q3** — mode selection **mirrors the embeddings posture** (SPEC-001/002):
  `CODEGRAPH_LLM_PROVIDER=endpoint|agent` explicit selector; endpoint auto-activates
  when `CODEGRAPH_LLM_URL`+`CODEGRAPH_LLM_MODEL` are both set and no provider named;
  agent-bundle mode ONLY by explicit selection; half-config → misconfig descriptor
  (status-visible, feature dormant). Discriminated union
  `Config | AgentConfig | Misconfig | null` — the null IS the dormancy signal.
- **Q4** — ingestion is an **explicit CLI command** (`codegraph tasks` list/ingest
  family; exact naming open — clarify): user-triggered, deterministic, no
  watcher/daemon coupling. The companion skill's last step tells the agent to run it.
- **Q5** — bundle state is **filesystem-only**: each `.codegraph/tasks/<id>/` carries
  a `manifest.json` with status + output contract. **No schema.sql change.**
- **Q6** — token-budget guard: **truncate context, marked.** Compose in priority
  order (instructions > output contract > graph context); trim lowest-priority
  context items; append an explicit "[context truncated: N of M]" marker;
  chars-per-token estimate (no tokenizer dependency).
- **Q7** — **streaming stays in scope** (maintainer deviation from the defer
  recommendation): streaming + non-streaming both ship, per the roadmap wording.
  The LOC consequence fed the Q12 split.
- **Q8** — self-repo UAT: **the AC-18.4 research note doubles as the UAT step** —
  no permanent user-facing `codegraph llm generate` command.
- **Q9** — research note is a **timeboxed spike on the dogfood endpoint**: endpoint
  arm = hal via `.envrc.local`; agent arm = Claude Code completing a bundle; one
  wiki chapter + one PR narrative each; measured latency/cost/judged quality; honest
  about n=1 per artifact class.
- **Q10** — companion skill: **self-describing bundle + thin skill.** The bundle dir
  carries everything (instructions.md, graph-context JSON, output contract); the
  in-repo skill is a thin discovery wrapper (find pending bundles, follow
  instructions, run ingest). Plugin packaging stays SPEC-026's job.
- **Q11** — ingest **validates + finalizes only**: checks output against the
  bundle's contract, stores the canonical result in the bundle dir, stamps status.
  NO contract-driven writes to consumer artifacts (that ships with each consumer
  spec).
- **Q12** — **split into 2 vertical slices** (accepted; see Reviewability Budget &
  Split Decision below).

> **Note:** Grill Me is human-in-the-loop only. It is not part of the autopilot
> loop. Once this workflow begins, clarifications happen via `/speckit-clarify`
> and the consensus protocol.

---

## Workflow Overview

| Phase | Command | Status | Notes |
|-------|---------|--------|-------|
| Specify | `/speckit-specify` | ✅ Complete | 5 US (P1–P5, mapped to 2-slice split) / 31 FR / 19 acceptance scenarios / 7 SC / 8 edge cases / 6 key entities; 0 markers; G1 PASS (direct verification — gate-validator agent terminated early, logged). spec.md + checklists/requirements.md + feature.json created. Spec's own budget declaration (~900–1300 LOC total) exceeds the roadmap 405 projection — flagged for the plan-phase estimator |
| Clarify | `/speckit-clarify` | ⏳ Pending | 3 sessions seeded from design-concept Open Questions |
| Plan | `/speckit-plan` | ⏳ Pending | |
| Checklist | `/speckit-checklist` | ⏳ Pending | llm-integration, error-handling, security |
| Tasks | `/speckit-tasks` | ⏳ Pending | Slice-aware ordering (Q12) |
| Analyze | `/speckit-analyze` | ⏳ Pending | |
| Implement | `/speckit-implement` | ⏳ Pending | |

**Status Legend:** ⏳ Pending | 🔄 In Progress | ✅ Complete | ⚠️ Blocked

### Phase Gates (SpecKit Best Practice)

Each phase requires **human review and approval** before proceeding:

| Gate | Checkpoint | Approval Criteria |
|------|------------|-------------------|
| G1 | After Specify | All user stories clear, no `[NEEDS CLARIFICATION]` markers remain |
| G2 | After Clarify | Ambiguities resolved, decisions documented |
| G3 | After Plan | Architecture approved, constitution gates pass, dependencies identified |
| G4 | After Checklist | All `[Gap]` markers addressed |
| G5 | After Tasks | Task coverage verified, dependencies ordered |
| G6 | After Analyze | No `CRITICAL` issues, `WARNING` items reviewed |
| G7 | After Each Implementation Phase | Tests pass, manual verification complete |

---

## Prerequisites

### Constitution Validation

**Before starting any workflow phase**, verify alignment with the project constitution (`.specify/memory/constitution.md`):

| Principle | Requirement | Verification |
|-----------|-------------|--------------|
| I. Think Before Coding | Scoping decisions surfaced via grill-me (Q1–Q12); remaining ambiguity carries `[NEEDS CLARIFICATION]` into Clarify | G1/G2 marker counts |
| II. Simplicity First | No layer-owned heuristic registry (Q2); filesystem-only bundle state (Q5); no auto-chunking (Q6); retry/timeout as internal constants with test-only overrides (embeddings posture) | Plan Constitution Check + code review |
| III. Surgical Changes | New capability lives in new module `src/llm/` (constitution names it a sanctioned module); diffs to upstream-owned files limited to CLI/status wiring | `git diff --stat` review at G7 |
| IV. Goal-Driven Execution | TDD red→green per task; completion claims carry test output; research note carries measured numbers | G7 evidence + UAT runbook |
| V. Deterministic, LLM-Free Extraction | LLM output confined to prose layers — NOTHING the layer produces becomes graph structure (nodes/edges) | Code review: no writes to nodes/edges tables |
| VII. Local-First, Private | No new runtime dependencies (built-in `fetch`); network calls ONLY to the user-configured endpoint; API key memory-only, never persisted/logged/echoed; unconfigured behavior byte-identical — zero network, zero writes | Dormancy tests + secret-hygiene review |

**Constitution Check:** ✅ (G0 PASS 2026-07-13 — see Autopilot Pre-flight Record below)

### Autopilot Pre-flight Record (Step -1/0, 2026-07-13)

| Item | Value |
|------|-------|
| Model/effort | Orchestrator Fable 5 (> Opus 4.6 bar); effort **xhigh per explicit operator override** in the autopilot pre-flight question (in place of max; SPEC-025 `high`-override precedent). Operator directive: orchestrator-only — delegate all phase work; right-sized subagents (minimal viable model, never Haiku) where the plugin provides no agent |
| Archive Sweep (Step -1) | **No-op confirmed** (subagent, real sweep on feature branch, `--current-target specs/018-llm-access-layer`): `specs/` holds only the excluded current target; SPEC-001/002/003/004/005/008/010/023/025 already archived (provenance in `.specify/memory/archive-reports/`). Known nit reproduced: extension's check-prerequisites expects active feature.json in sweep mode — paths derived manually. Zero files modified; worktree clean before/after |
| check-prerequisites | Runner helper: speckit CLI ✓ (0.11.8 on runner PATH; 0.12.12.dev0 via user PATH), project init ✓, constitution ✓, commands ✓, settings defaults ✓, capability coverage ✓ (advisory). **Runner anchors to the main checkout** (SPEC-025 caveat reproduced): workflow-file + branch checks verified directly against the worktree — branch `018-llm-access-layer`, ON_FEATURE_BRANCH=true, IS_WORKTREE=true, workflow file present |
| PROJECT_COMMANDS | BUILD=`npm run build` · TYPECHECK=`npx tsc --noEmit` (tsc runs inside build) · UNIT_TEST=`npm test` (vitest) · LINT=N/A · INTEGRATION_TEST=N/A (vitest suite is the full suite) · package_manager=npm, stack=nodejs. (runner detect-commands emitted generic `npm build`/`npm typecheck` — corrected to this repo's real scripts, matching the SPEC-025 record) |
| PRESET_CONVENTIONS | speckit-pro-reviewability v1.0.0 (spec/plan top layer), codegraph-project-overrides v1.0.0 (tasks top layer: constitution test-policy exceptions), claude-ask-questions v1.0.0 — verified via `specify preset resolve` from the worktree |
| Settings | No `.claude/speckit-pro.local.md` — defaults: consensus-mode default, gate-failure=stop, auto-commit per extensions.yml (`auto_execute_hooks: true`, git commit hooks on phase boundaries) |
| CONFIDENCE_GATE_MODE | `advisory` (runner resolve-confidence-mode, argv no flags; resolved once at Step 0.6b — not re-run at G6.5) |
| AGENT_TEAMS_AVAILABLE | false (no TeamCreate in session tool surface) — `[P]` runs use batched background subagents |
| PROJECT_IMPLEMENTATION_AGENT | none detected (`.claude/agents/` has only retrieval-guardian, a reviewer) → fallback `speckit-pro:phase-executor`; research tasks route to `speckit-pro:domain-researcher`. retrieval-guardian available as post-implement reviewer if the diff ever touches src/mcp|resolution|extraction (not expected: SPEC-018 adds no MCP surface) |
| Extensions (registry) | agent-context, archive, bug, cleanup, git, retrospective, review, verify, verify-tasks installed; 18 hook events configured; no doctor/speckit-utils extension (doctor health check → skipped, logged) |
| MCP availability | codegraph (dogfood daemon, explore active), context7, tavily, RepoPromptCE, qmd, claude-in-chrome — codebase context, library docs, web research, and source extraction all covered |
| Reviewability (setup mode) | **warn** recorded at scaffold (405 LOC > 400 warn; no blockers) + accepted 2-slice split — see § Reviewability Budget & Split Decision. Tasks/pre-PR gate modes deferred on installed runner → fallback evidence chain at Phase 5/PR steps |
| Tier-2 relocation | Suppressed — SPEC-018 is already-current (SPEC-MOC `structureVersion: 1`, PROCESS artifacts under `.process/`); no other thawed legacy candidates in `specs/` |
| G0 Constitution Validation | **PASS.** BUILD (`npm run build`: tsc + copy-assets) clean. UNIT_TEST full-suite runs under session load: run 1 = 17 failed/3474 passed (10 files), run 2 = 8 failed/3483 passed (6 files) — disjoint counts, SPEC-025 flake signature. Isolation triage split the failures into two explained classes: (a) **3 tests reproduce in isolation but pass env-clean** — `mcp-staleness-banner` (footer-vs-banner) + `server-read-api` (status hybrid availability; search degradation-without-embeddings) assert unconfigured-embeddings behavior and fail under the direnv-applied dogfood env (`CODEGRAPH_EMBEDDING_URL/MODEL/DIMS/TIMEOUT_MS` present in the shell); (b) the rest are 5000ms-timeout load flakes. **All 230 tests in the 6 run-2 failed files pass env-clean in isolation (13s).** Zero `src/**` changes on the branch. Baseline: 3483 passed / 7 skipped / 183 files. **Binding run rule: every test-running agent unsets `CODEGRAPH_EMBEDDING_*` (env-clean UNIT_TEST) — `env -u CODEGRAPH_EMBEDDING_URL -u CODEGRAPH_EMBEDDING_MODEL -u CODEGRAPH_EMBEDDING_API_KEY -u CODEGRAPH_EMBEDDING_PROVIDER -u CODEGRAPH_EMBEDDING_DIMS -u CODEGRAPH_EMBEDDING_TIMEOUT_MS npm test` — same hazard will apply to `CODEGRAPH_LLM_*` once SPEC-018's own dormancy tests exist** |

---

## Specification Context

### Basic Information

| Field | Value |
|-------|-------|
| **Spec ID** | SPEC-018 |
| **Name** | LLM Access Layer |
| **Branch** | `018-llm-access-layer` |
| **Dependencies** | None |
| **Enables** | SPEC-019 (wiki), SPEC-020 (PR narrative), SPEC-011 (LLM cluster labels) |
| **Priority** | P1 |

### Reviewability Budget & Split Decision

Recorded per the setup-gate warning (scaffold, 2026-07-13):

| Item | Value |
|------|-------|
| Setup gate result | **warn** (pass=true, no blockers): reviewable LOC 405 exceeds warn threshold 400 |
| Budget (roadmap) | Primary surface: harness/adapter · projected 405 reviewable LOC (net-new) · ~5 production files · ~11 total files |
| Estimator advisory | Roadmap-recorded estimator suggested **2 slices** (the plugin's `estimate-spec-size` operation is absent from speckit-pro 2.18.1 — absent estimate noted in the design concept) |
| Streaming kept (Q7) | Maintainer kept streaming in scope, so no LOC trim applies |
| **Split decision (Q12)** | **Split into 2 thin vertical slices — two PRs off this one spec branch** |
| Slice 1 | Endpoint path end-to-end: config resolution (`LLMConfigResult`-style union), `client.ts` (streaming + non-streaming, retry/timeout), prompt-template helpers + token-budget guard, `generate()` facade with consumer-fallback degradation. Independently unblocks SPEC-011/019/020 minimally. |
| Slice 2 | Agent-bundle path: `agent-bundle.ts` emitter, filesystem manifest, `tasks` list/ingest CLI surface, thin companion skill, AC-18.4 research-note spike (needs both paths). |

The Atomicity Route section below is still filled by the autopilot after G5 — the
classifier's structural reading is expected to corroborate this split; if it
contradicts it, surface the conflict at G5 rather than silently following either.

### Success Criteria Summary

From the PRD (AC-18.*) and the design concept:

- [ ] **AC-18.1**: A shared client supports any OpenAI-compatible chat endpoint via `CODEGRAPH_LLM_{URL,MODEL,API_KEY}` with retry, timeout, and streaming; wiki, PR narrative, and cluster labeling all consume it (in this spec: the `generate()` seam they will consume).
- [ ] **AC-18.2**: An agent-driven mode lets features emit a structured task bundle (outline + graph context) that a subscription coding agent completes instead of a server-side LLM call; the bundle format and companion skill are documented.
- [ ] **AC-18.3**: With nothing configured, LLM-consuming features degrade to heuristic/skeleton output — never an error.
- [ ] **AC-18.4**: A short research note compares the two paths (cost, quality, latency) on one wiki chapter and one PR narrative, committed to `docs/design/llm-paths-note.md`.
- [ ] Dormancy: with no `CODEGRAPH_LLM_*` configured, behavior is byte-identical — zero network calls, zero writes (constitution Dogfooding discipline).
- [ ] Both slices land as independently reviewable PRs (Q12), each ≤ ~400 reviewable LOC.

---

## Phase 1: Specify

**When to run:** At the start. Focus on **WHAT** and **WHY**, not implementation details. Output: `specs/018-llm-access-layer/spec.md`

### Specify Prompt

```text
/speckit-specify

## Feature: LLM Access Layer

### Problem Statement
Upcoming Intelligence Platform features (SPEC-011 cluster labels, SPEC-019 wiki
prose, SPEC-020 PR narratives) each need LLM-generated prose, but CodeGraph is
local-first: users may have an OpenAI-compatible endpoint, may prefer routing
prose tasks through the subscription coding agent they already pay for, or may
have nothing configured at all. Today there is no shared capability — each
future feature would reinvent config, retries, degradation, and agent handoff.
SPEC-018 ships one shared layer with two first-class paths and guaranteed
heuristic degradation, so consumers ask for prose exactly one way.

### Users
- Future feature code (SPEC-011/019/020) — the direct consumers of the
  generate(prose-task) seam.
- CodeGraph users with a BYO OpenAI-compatible endpoint (local LM server or
  hosted) configured via CODEGRAPH_LLM_{URL,MODEL,API_KEY}.
- CodeGraph users who route prose tasks through their subscription coding agent
  (Claude Code, Codex, Gemini CLI, Copilot) via task bundles instead of a
  server-side LLM call.
- Users with nothing configured — who must see zero behavior change and zero
  errors (dormancy).

### User Stories
- [US1] As a feature consumer, I call generate(prose-task) with my own heuristic
  fallback and always receive usable text: endpoint output when an endpoint is
  configured, my fallback (plus a pending-bundle handle) in agent mode, or my
  fallback when dormant — never an error for absence of config (Q1, Q2; AC-18.3).
- [US2] As a user with an OpenAI-compatible endpoint, I configure
  CODEGRAPH_LLM_{URL,MODEL,API_KEY} and prose tasks are completed via chat
  completions with retry, timeout, streaming + non-streaming, and a token-budget
  guard that trims context deterministically with an explicit truncation marker
  (Q6, Q7; AC-18.1).
- [US3] As a user in agent mode (CODEGRAPH_LLM_PROVIDER=agent, explicit
  selection only), generate() emits a self-describing task bundle under
  .codegraph/tasks/<id>/ (instructions, graph context JSON, expected output
  contract, manifest.json status) that any subscription coding agent can
  complete by reading the directory (Q3, Q5, Q10; AC-18.2).
- [US4] As a user whose agent completed a bundle, I run an explicit CLI ingest
  command that validates the output against the bundle's contract, stores the
  canonical result in the bundle dir, and stamps it completed — ingest never
  writes consumer artifacts (Q4, Q11).
- [US5] As the maintainer, I have a committed research note comparing the two
  paths (cost, quality, latency) on one wiki chapter and one PR narrative
  generated against this repository — the note doubles as the self-repo UAT
  step (Q8, Q9; AC-18.4).

### Constraints
- Mirror the SPEC-001/002 embeddings posture: discriminated-union config result
  (Config | AgentConfig | Misconfig | null; null IS dormancy), half-config →
  status-visible misconfig, endpoint redaction, plaintext-remote warning,
  positive-int clamps, retry/timeout as internal constants with test-only
  overrides (Q3).
- API key memory-only: never persisted, logged, or echoed (constitution VII).
- No new runtime dependencies — built-in fetch; chars-per-token estimate, no
  tokenizer (Q6; constitution VII).
- No SQLite schema changes — bundle state is filesystem-only manifest.json (Q5).
- Agent-bundle mode is NEVER an implicit fallback — explicit selection only;
  dormant means zero writes including bundle emission (Q3).
- LLM output is confined to prose layers — never graph structure
  (constitution V).
- Two-slice delivery (Q12): slice 1 endpoint path end-to-end; slice 2
  agent-bundle path + companion skill + research note.

### Out of Scope
- Vendor-specific SDKs; fine-tuning; long-term memory (roadmap).
- Layer-owned heuristic registry — heuristics are consumer-supplied (Q2).
- Watcher/daemon auto-ingestion of bundles (Q4).
- Auto-chunking / map-reduce over oversized prompts (Q6).
- A permanent user-facing `codegraph llm generate` CLI subcommand (Q8).
- Contract-driven install actions writing consumer artifacts at ingest (Q11).
- A cloud-endpoint arm in the research note (Q9).
- Plugin-channel packaging of the companion skill — SPEC-026's job (Q10).
```

### Specify Results

<!-- Fill in after running the command -->

| Metric | Value |
|--------|-------|
| Functional Requirements | 31 (FR-001–FR-031: config posture, generate() seam, endpoint path, agent-bundle path, CLI ingest, research note/delivery) |
| User Stories | 5 (US1 P1 seam/degradation; US2 P2 endpoint; US3 P3 bundle emission; US4 P4 ingest; US5 P5 research note) — slice 1 = US1+US2, slice 2 = US3+US4+US5 |
| Acceptance Criteria | 19 acceptance scenarios + 7 success criteria (SC-001–SC-007) + 8 edge cases |

Hooks: `after_specify` agent-context.update **skipped** (repo CLAUDE.md is hand-curated; no tech-stack change at specify — SPEC-025 precedent, logged); git.commit honored via orchestrator checkpoint commit. Spec-index regen: **deferred** on installed runner (SPEC-025-recorded evidence; applies to all phase boundaries).

### Files Generated

- [x] `specs/018-llm-access-layer/spec.md` (+ `checklists/requirements.md`, `.specify/feature.json`)

### SpecKit Traceability Markers

Use these markers in spec.md for traceability through later phases:

| Marker | Purpose | Example |
|--------|---------|---------|
| `[US1]`, `[US2]` | User story reference | `[US1] Consumer always receives usable text` |
| `[FR-001]` | Functional requirement | `[FR-001] Endpoint auto-activates when URL+MODEL set` |
| `[NEEDS CLARIFICATION]` | Flag for Clarify phase | `Bundle CLI naming [NEEDS CLARIFICATION]` |
| `[P]` | Parallel-safe task | `[P] Client retry tests alongside template tests` |
| `[Gap]` | Missing coverage | `[Gap] No requirement covers malformed manifest.json` |

---

## Phase 2: Clarify

**When to run:** After Specify. Maximum 5 targeted questions per session. Sessions below are seeded from the design concept's Open Questions — dig into exactly what grill-me left open.

### Clarify Prompts

#### Session 1: Bundle Lifecycle & CLI Surface

```text
/speckit-clarify Focus on the task-bundle lifecycle and its CLI surface: the exact
subcommand naming and verb set (codegraph tasks list|ingest vs bundles — design
concept Open Question; keep Q4's explicit user-triggered semantics); the
manifest.json schema (status values, output contract shape, what "validates
against the contract" concretely checks at ingest); stale/abandoned pending
bundles (prune subcommand vs documented manual deletion — Open Question); bundle
id generation and collision behavior; and what a second generate() call for the
same prose-task does while a bundle is still pending (dedupe, re-emit, or
return the existing handle).
```

#### Session 2: Endpoint Client Behavior & Config Surfaces

```text
/speckit-clarify Focus on the endpoint client: the streaming API shape consumers
see (does generate() expose partial output, or is streaming an internal
transport detail with only the final text returned — Q7 kept streaming in scope
but no enumerated consumer reads partial output); retry/timeout defaults and
which failures retry vs degrade to the consumer fallback (mirror the embeddings
EndpointProvider posture: bounded retries, Retry-After respected, redaction-safe
errors); token-budget guard mechanics (budget source — config vs constant,
chars-per-token ratio, the truncation marker text, Q6 priority order); and how
misconfig/half-config states surface in codegraph status (mirror the embeddings
status section shape without touching its section).
```

#### Session 3: Integration Contract & Research-Note Protocol

```text
/speckit-clarify Focus on the generate() seam and the AC-18.4 protocol: the
exact TypeScript contract (prose-task shape: instructions, graph-context items,
output contract; the consumer-supplied fallback — function vs precomputed
string, Q2; the three result kinds and the pending-bundle handle shape, Q1); how
a consumer later redeems a pending handle for the finalized text (Q11 —
retrieval API, given ingest only finalizes the bundle dir); whether the handle
survives process restarts (filesystem-backed lookup); and the research-note
protocol (which repo artifacts serve as the wiki-chapter and PR-narrative
inputs, what latency/cost/quality fields the note records, and whether the
spike lands inside slice 2's PR or as a docs-only follow-up — Open Question).
```

### Clarify Results

| Session | Focus Area | Questions | Key Outcomes |
|---------|------------|-----------|--------------|
| 1 | | | |
| 2 | | | |
| 3 | | | |

---

## Phase 3: Plan

**When to run:** After spec is finalized. Generates technical implementation blueprint. Output: `specs/018-llm-access-layer/plan.md`

### Plan Prompt

```text
/speckit-plan

## Tech Stack
- Language: TypeScript strict mode, compiled with tsc (npm run build; build also
  runs copy-assets — no new static assets expected for this spec)
- Runtime: Node >=20 <25 engines range (effective from-source floor 22.5);
  HTTP via built-in fetch — NO new runtime dependencies (constitution VII)
- Storage: NONE for this spec — bundle state is filesystem-only manifest.json
  under .codegraph/tasks/<id>/ (Q5); the graph DB (node:sqlite) is not touched
- Testing: vitest (__tests__/ mirrors module layout); tests write real files in
  fs.mkdtempSync temp dirs and clean up in afterEach; no mocking of the
  filesystem; endpoint tests use a local fake HTTP server (embeddings-endpoint
  test precedent)
- Module: src/llm/{config,client,agent-bundle}.ts + the generate() facade —
  a constitution-sanctioned new module (Principle III fork discipline)

## Constraints
- Two-slice delivery (Q12): plan the file/task graph so slice 1 (config +
  client + templates + token guard + generate() with fallback degradation) is
  complete and reviewable without any slice-2 file; slice 2 (agent-bundle
  emitter + manifest + tasks CLI + companion skill + research note) builds on
  slice 1's seam. Two PRs off branch 018-llm-access-layer.
- Mirror src/embeddings/config.ts and endpoint-provider.ts patterns exactly
  where analogous: discriminated-union config result, redactEndpoint-style
  redaction, plaintextRemoteWarning analog, positive-int clamps with ceilings,
  internal-constant retry/timeout with test-only override interfaces
  (EndpointProviderOverrides precedent).
- Upstream-owned file diffs stay minimal: src/bin/codegraph.ts gains the tasks
  subcommand registration (slice 2); status wiring follows the embeddings
  status-section precedent. No src/mcp/tools.ts changes — this spec exposes no
  MCP tool (Principle VI untouched; retrieval surface unaffected).
- Dormancy discipline: with no CODEGRAPH_LLM_* set, zero network calls, zero
  filesystem writes, byte-identical behavior — plan explicit dormancy tests.
- API key hygiene: memory-only, never persisted/logged/echoed; redaction-safe
  error types only (EmbeddingEndpointError precedent).
- CHANGELOG entry under ## [Unreleased] (user-facing New Features wording),
  one per slice PR.

## Architecture Notes
- Re-read docs/ai/specs/.process/SPEC-018-design-concept.md before planning —
  it is the source of truth for every scoping decision (Q1–Q12).
- generate() result is a three-kind discriminated union (endpoint text /
  pending-bundle handle + fallback text / fallback text) — Q1's
  heuristic-now-upgrade-later contract; consumers never block on an agent.
- The consumer-supplied fallback (Q2) is part of the prose-task input contract —
  design the task type so SPEC-011/019/020 can adopt it without layer changes.
- Bundle dirs are self-describing (Q10): instructions.md + graph-context JSON +
  output contract + manifest.json; the companion skill is a thin discovery
  wrapper committed in-repo; ingest (Q4/Q11) validates + finalizes only.
- The research note (Q9) is a timeboxed spike task, not LOC-budgeted work —
  endpoint arm via .envrc.local (hal), agent arm via a Claude Code-completed
  bundle, committed to docs/design/llm-paths-note.md.
```

### Plan Results

| Artifact | Status | Notes |
|----------|--------|-------|
| `plan.md` | ⏳ | Technical context, execution flow, slice boundary |
| `research.md` | ⏳ | Decision rationales (if needed) |
| `data-model.md` | ⏳ | Prose-task / result-union / manifest schema entities |
| `contracts/` | ⏳ | generate() seam + bundle manifest contract |
| `quickstart.md` | ⏳ | Developer onboarding (if needed) |

---

## Phase 4: Domain Checklists

**When to run:** After `/speckit-plan` — validates both spec AND plan together.

### Step 1: Recommended Domains (from spec analysis)

| Signal in SPEC-018 | Recommended Domain |
|---|---|
| LLM prompts, chat-completion calls, token limits, truncation, model config | **llm-integration** |
| Degradation contract ("never an error"), retries, timeouts, pending-bundle states, malformed agent output | **error-handling** |
| API key hygiene, endpoint redaction, plaintext-remote warning, validating untrusted agent output at ingest, path safety under .codegraph/tasks/ | **security** |

**Target: 2-4 domains.** These three cover the spec's risk concentration; UX/performance/data-integrity domains don't apply to a headless adapter layer with filesystem-only state.

### Step 2: Run Enriched Checklist Prompts

#### 1. llm-integration Checklist

Why this domain: the spec's core surface IS an LLM integration — endpoint contract, prompt composition, token budgets, and a second (agent-mediated) generation path.

```text
/speckit-checklist llm-integration

Focus on SPEC-018 requirements:
- OpenAI-compatible chat-completions contract coverage: request/response shape,
  streaming AND non-streaming (Q7), model/env config precedence (Q3)
- Prompt-template composition and the token-budget guard: priority order,
  deterministic truncation, the explicit truncation marker (Q6)
- The task-bundle path as an LLM integration: instructions + graph context +
  output contract must carry everything an agent needs (Q10 self-describing bar)
- Pay special attention to: requirements that would silently couple the layer to
  one vendor's API extensions — the contract is the OpenAI-compatible shape only
```

#### 2. error-handling Checklist

Why this domain: "never an error path for absence of config" is the feature's defining behavioral guarantee, and every failure (endpoint down, retry exhaustion, malformed agent output, oversized prompt) must land in a specified degraded state.

```text
/speckit-checklist error-handling

Focus on SPEC-018 requirements:
- The three-kind generate() result (Q1): every failure mode maps to a specified
  outcome; consumers NEVER see a thrown error for unconfigured/degraded states
  (AC-18.3)
- Endpoint failures: which statuses retry (with bounded backoff, Retry-After)
  vs degrade immediately to the consumer fallback; timeout behavior
- Bundle-path failures: malformed/missing manifest.json, agent output failing
  contract validation at ingest, double-ingest, pending-forever bundles
- Half-config and invalid CODEGRAPH_LLM_PROVIDER values → status-visible
  misconfig while behavior stays dormant (Q3)
- Pay special attention to: the dormant path — zero network, zero writes,
  byte-identical (constitution dogfooding discipline)
```

#### 3. security Checklist

Why this domain: the layer handles a bearer key, sends repo-derived context over the network, and ingests untrusted agent output from a world-writable-ish task directory.

```text
/speckit-checklist security

Focus on SPEC-018 requirements:
- CODEGRAPH_LLM_API_KEY hygiene: memory-only, never persisted/logged/echoed;
  redaction-safe error types (endpoint reduced to scheme+host+port — the
  embeddings redactEndpoint bar)
- Plaintext-http-to-non-loopback warning analog for the LLM endpoint
- Ingest validates UNTRUSTED agent output: contract validation before
  finalizing; no path traversal via bundle ids or manifest fields; ingest never
  writes outside the bundle's own directory (Q11)
- Graph context packed into bundles/prompts is repo source the user already
  owns — but confirm no secrets from env/config leak into bundle files or
  prompts
- Pay special attention to: bundle manifest fields that could steer file writes
  (Q11 forbids install actions — verify no requirement reintroduces them)
```

### Checklist Results

| Checklist | Items | Gaps | Spec References |
|-----------|-------|------|-----------------|
| llm-integration | | | |
| error-handling | | | |
| security | | | |
| **Total** | | | |

### Addressing Gaps

When checklist identifies `[Gap]` items:

1. Review the gap — is it a genuine missing requirement?
2. Update `spec.md` or `plan.md` to address it
3. Re-run the checklist to verify coverage
4. If the gap is intentionally out of scope, document why

---

## Phase 5: Tasks

**When to run:** After checklists complete (all gaps resolved). Output: `specs/018-llm-access-layer/tasks.md`

### Tasks Prompt

```text
/speckit-tasks

## Task Structure
- Small, testable chunks (1-2 hours each); every task's acceptance criterion
  references FR-xxx
- TDD ordering: failing test first, then implementation (constitution IV)
- Dependency ordering honors the two-slice split (Q12): ALL slice-1 tasks
  (config union → client retry/timeout/streaming → templates + token guard →
  generate() facade + degradation → dormancy tests) complete before any slice-2
  task (bundle emitter → manifest → tasks CLI → companion skill → ingest →
  research-note spike)
- Mark parallel-safe tasks explicitly with [P] — e.g. client retry tests vs
  prompt-template tests within slice 1
- Organize by user story ([US1] contract/degradation, [US2] endpoint client,
  [US3] bundle emission, [US4] ingest CLI, [US5] research note)

## Implementation Phases
1. Slice 1 — Foundation: config resolution union + dormancy tests
2. Slice 1 — Endpoint client (retry/timeout/streaming) + templates + token guard
3. Slice 1 — generate() facade with consumer-fallback degradation → PR 1
4. Slice 2 — Bundle emitter + manifest + companion skill
5. Slice 2 — tasks CLI (list/ingest) + ingest validation
6. Slice 2 — AC-18.4 research-note spike (timeboxed, not LOC-budgeted) → PR 2

## Constraints (from design concept Non-goals — flag any task that crosses these)
- No task may add a runtime dependency, touch schema.sql, or write MCP tool
  surface (src/mcp/tools.ts)
- No task may implement a layer-owned heuristic registry (Q2), watcher
  auto-ingestion (Q4), auto-chunking (Q6), a user-facing llm generate command
  (Q8), or ingest-driven consumer-artifact writes (Q11)
- Tests write real files in temp dirs (no DB/fs mocking); endpoint tests use a
  local fake HTTP server
- The research-note task is a timeboxed spike (Q9) — its deliverable is
  docs/design/llm-paths-note.md, not code
```

### Tasks Results

| Metric | Value |
|--------|-------|
| **Total Tasks** | |
| **Phases** | |
| **Parallel Opportunities** | |
| **User Stories Covered** | |

---

## Atomicity Route

**When this is filled:** After the Tasks phase / gate G5, the autopilot SKILL runs
the read-only atomicity classifier and records its decision here. This is a
**placeholder** until then — leave the cells blank during scoping. The classifier
emits one machine-readable decision; the SKILL is what writes it into this section
(the script never writes a file of its own). This route is recorded only here in the
workflow file — never in the spec map. It is read downstream by the layer-planner and
multi-PR emission work that builds on top of it; recording it now wires no PR creation
or branch splitting on its own.

The scaffold-time expectation is `split-PR` (two slices per Q12 — see Reviewability
Budget & Split Decision). If the classifier disagrees, surface the conflict at G5.

| Field | Value | Meaning |
|-------|-------|---------|
| **Route** | | One of `split-PR`, `one-navigable-PR`, `single-atomic-PR`, `branch-by-abstraction`, or `out-of-scope`. |
| **Releasable** | | `true`, or `false` for a destructive-migration or concurrency-sensitive change (a passing CI run does not prove such a change is safe to release). |
| **Signals** | | The decisive detector findings behind the route and releasability reading (may be empty when the classifier abstains). |
| **Warnings** | | Any release-safety warning attached to the change (empty when there is no releasability risk). |

To produce the decision, run the classifier against the feature directory:

```text
runner helper atomicity-route specs/018-llm-access-layer
```

---

## Phase 6: Analyze

**When to run:** Always run after generating tasks to catch issues.

### Analyze Prompt

```text
/speckit-analyze

Focus on:
1. Constitution alignment — II (no speculative machinery beyond Q1–Q11
   decisions), III (src/llm/ module; minimal upstream-file diffs), V (no LLM
   output becomes graph structure), VII (no new deps; key hygiene; dormancy)
2. Coverage gaps — every FR and user story (US1–US5) has tasks; AC-18.1–18.4
   each map to tasks; dormancy tests exist as explicit tasks
3. Design-concept drift — spec.md, plan.md, tasks.md must not contradict
   docs/ai/specs/.process/SPEC-018-design-concept.md (Q1–Q12 are the scoping
   source of truth; a contradicting downstream artifact is wrong unless it
   carries an explicit revision note). Q7's streaming-in-scope deviation and
   Q12's two-slice split are deliberate — verify they survived.
4. Slice-boundary integrity — no slice-1 task depends on a slice-2 file; the
   slice-1 task set alone satisfies US1+US2 and is independently shippable
```

### Analyze Severity Levels

| Severity | Meaning | Action Required |
|----------|---------|-----------------|
| `CRITICAL` | Blocks implementation, violates constitution | **Must fix before G6 gate** |
| `HIGH` | Significant gap, impacts quality | Should fix |
| `MEDIUM` | Improvement opportunity | Review and decide |
| `LOW` | Minor inconsistency | Note for future |

### Analysis Results

| ID | Severity | Issue | Resolution |
|----|----------|-------|------------|
| | | | |

---

## Phase 7: Implement

**When to run:** After tasks.md is generated and analyzed (no coverage gaps).

### Implement Prompt

```text
/speckit-implement

## Approach: TDD-First

For each task, follow this cycle:

1. **RED**: Write failing test defining expected behavior
2. **GREEN**: Implement minimum code to make test pass
3. **REFACTOR**: Clean up while tests still pass
4. **VERIFY**: Manual verification of acceptance criteria

### Pre-Implementation Setup

Before starting any task:
1. Worktree preflight already done at scaffold time (npm install, npm run
   build, codegraph init/status: 536 files, embeddings 100%, LSP enabled) —
   verify with `node dist/bin/codegraph.js status` if the session is fresh
2. Verify all tests pass before making changes (`npm test`); record the
   baseline failure signature if the suite flakes under load (SPEC-025 lesson)
3. Confirm you're on branch 018-llm-access-layer in the worktree

### Implementation Notes
- Mirror the embeddings module's posture file-for-file where analogous:
  src/embeddings/config.ts → src/llm/config.ts (union result, redaction,
  clamps); src/embeddings/endpoint-provider.ts → src/llm/client.ts (bounded
  retry, Retry-After, redaction-safe single error type, test-only overrides
  interface). Deviations need a reason in code review.
- Constitution V: nothing this layer produces may be written as nodes/edges.
- Dormancy tests are first-class: no CODEGRAPH_LLM_* env → zero network
  (assert no fetch), zero writes (assert no .codegraph/tasks/ creation).
- Slice discipline (Q12): finish and PR slice 1 before starting slice-2 tasks;
  each PR carries its own CHANGELOG [Unreleased] entry (user-facing New
  Features wording, no internal paths/symbols).
- The companion skill file and docs/design/llm-paths-note.md are committed
  artifacts; bundle fixtures created by tests live in temp dirs, never the repo.
- The research-note spike (Q9): endpoint arm sources .envrc.local (never echo
  its values); agent arm = real Claude Code session completing a bundle; record
  latency/cost/quality per artifact; n=1 per class stated honestly.
- No session URLs in commits or PR bodies; PRs target origin (racecraft-lab).
```

### Implementation Progress

| Phase | Tasks | Completed | Notes |
|-------|-------|-----------|-------|
| 1 - Slice 1: Foundation (config + dormancy) | | | |
| 2 - Slice 1: Client + templates + guard | | | |
| 3 - Slice 1: generate() facade → PR 1 | | | |
| 4 - Slice 2: Bundle emitter + skill | | | |
| 5 - Slice 2: tasks CLI + ingest | | | |
| 6 - Slice 2: Research note → PR 2 | | | |

---

## Post-Implementation Checklist

- [ ] All tasks marked complete in tasks.md
- [ ] Build succeeds: `npm run build`
- [ ] Tests pass: `npm test` (vitest; full suite green or load-flake signature matched against baseline with isolated re-run evidence)
- [ ] Dormancy verified: unconfigured run makes zero network calls and zero writes
- [ ] CHANGELOG entry under `## [Unreleased]` per slice PR (user-facing wording)
- [ ] Research note committed: `docs/design/llm-paths-note.md` (AC-18.4 + UAT evidence)
- [ ] Roadmap Progress Tracking row updated
- [ ] PR(s) created against origin (racecraft-lab) — never upstream; no session URLs in PR bodies
- [ ] Merged to main, then Dogfooding Protocol step: `npm run build` + `codegraph sync` on main

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
│   ├── llm/                         # NEW module this spec creates
│   │   ├── config.ts                # env resolution → Config|AgentConfig|Misconfig|null (Q3)
│   │   ├── client.ts                # OpenAI-compatible chat completions (Q6, Q7)
│   │   ├── agent-bundle.ts          # bundle emitter + manifest + ingest validation (Q4, Q5, Q10, Q11)
│   │   └── (generate() facade)      # three-kind result union (Q1, Q2) — exact file per plan
│   ├── embeddings/                  # SPEC-001/002 precedent — mirror config/provider posture
│   └── bin/codegraph.ts             # tasks subcommand registration (slice 2, minimal diff)
├── docs/
│   ├── design/llm-paths-note.md     # AC-18.4 research note (slice 2)
│   └── ai/specs/.process/           # This workflow + design concept
├── specs/018-llm-access-layer/      # spec.md, plan.md, tasks.md, SPEC-MOC.md (CONTRACT dir)
├── __tests__/                       # vitest — mirrors module layout; real files, temp dirs
└── .codegraph/tasks/<id>/           # runtime bundle dirs (NEVER committed)
```

---

Template based on SpecKit best practices. Prompts populated from `docs/ai/specs/.process/SPEC-018-design-concept.md` (grill-me, 2026-07-13) and the technical roadmap § SPEC-018.
