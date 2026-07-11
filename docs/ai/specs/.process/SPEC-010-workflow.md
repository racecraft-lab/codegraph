# SpecKit Workflow: SPEC-010 — Graph-Aware Rename

**Template Version**: 1.0.0
**Created**: 2026-07-10
**Purpose**: Prepare and execute SPEC-010 through the SpecKit workflow so CodeGraph can rename any symbol with a dry-run plan first — LSP-powered where possible, graph-verified always, atomic on apply — exposed as `codegraph rename` (CLI) and `codegraph_rename` (MCP) with one shared contract.

---

## Design Concept

This workflow file was enriched from a Grill Me interview run during
`/speckit-pro:speckit-scaffold-spec SPEC-010`. The full Q&A log, Goals, Non-goals, and Open
Questions live at:

```text
docs/ai/specs/.process/SPEC-010-design-concept.md
```

Re-read it before each phase. The design concept is the source of truth for
scoping decisions captured during setup: graph fallback covers all indexed
languages behind a per-edit confidence gate; `--apply` recomputes the plan (no
persisted plan artifact); apply refuses unless every edit is `exact` (override:
`--include-heuristic`); pre-write span verification against live bytes is the
staleness guard; post-check failure auto-rolls-back; targeting is name+qualifiers
with candidate-listing refusals; the MCP tool is always exposed with `apply: true`
explicit; symbol-kind coverage is path-dependent with honest refusals; comments/
strings are never edited; Windows validation is deferred (VM suspended); and the
work ships as **2 vertical PR slices**.

> **Note:** Grill Me is human-in-the-loop only. It is **not** part of
> the autopilot loop. Once the workflow file is populated and autopilot
> begins, clarifications happen via `/speckit-clarify` and the
> consensus protocol — never via grill-me.

---

## Reviewability Budget & Split Decision (setup gate record)

Setup gate (`reviewability-gate`, setup mode, run 2026-07-10 against the SPEC-010
roadmap section): **status WARN, pass=true** — reviewable LOC 405 exceeds the 400
warn threshold; production files 5/6, total files 11/15, primary surfaces 1/1
(harness/adapter); no blockers.

**Split decision (Q11, accepted):** 2 thin vertical slices, each under the
~400-LOC ceiling:

1. **Slice 1 — Plan engine (read-only):** targeting + ambiguity refusals,
   LSP/graph plan derivation, collision detection, confidence tiers,
   `codegraph rename` CLI in dry-run mode. Delivers reviewable rename plans with
   zero write risk.
2. **Slice 2 — Apply + MCP:** span-verification guard, atomic apply with
   snapshots/rollback, targeted re-sync, zero-dangling post-check,
   `codegraph_rename` MCP tool, `server-instructions.ts` update. Delivers the
   write path and the agent surface.

The live `estimate-spec-size` runner operation is absent in the installed runner
(treated as an absent estimate per protocol); the split follows the roadmap
estimator's advisory `suggested_slices: 2` plus the WARN gate result.

---

## Workflow Overview

| Phase | Command | Status | Notes |
|-------|---------|--------|-------|
| Specify | `/speckit-specify` | ✅ Complete | 2026-07-10 via phase-executor. spec.md: 4 US (mapped to 2 slices), 25 FR, 16 scenarios, 9 SC, 6 entities, 9 edge cases. 1 intentional `[NEEDS CLARIFICATION]` (FR-004 tiers → Clarify S1). G1: route to Clarify. |
| Clarify | `/speckit-clarify` | ✅ Complete | 3 sessions done (2026-07-10 → 2026-07-11). 15 questions resolved: 11 executor-direct, 4 via 3-analyst consensus (1 synthesis, 3 security-override → human-ratified). Spec grew FR-019a/FR-026/FR-027/FR-028 + `## Clarifications` section; FR-004/017/018/020/021/022/023/024/025 + SC-006 refined. G2: 0 markers. |
| Plan | `/speckit-plan` | ✅ Complete | 2026-07-11 via phase-executor. 7 artifacts; Constitution PASS ×7, Complexity Tracking empty; 28 FR + 9 SC mapped; 8 research decisions (file:line-anchored); 2-slice layout: 8 Slice-1 + 4 Slice-2 files, `span-verify.ts` the shared seam. G3 clean (sole "NEEDS CLARIFICATION" hit is self-referential PASS prose). |
| Checklist | `/speckit-checklist` | ✅ Complete | 2026-07-11. 4 domains sequential: 122 items, 22 gaps found → 22 fixed → 0 remaining. 5 consensus items resolved (rows 5–9), 0 human escalations. G4: 0 [Gap] across all checklist files. Spec grew FR-003a/FR-021a/SC-010; contracts schema hardened; drift in data-model/research corrected. |
| Tasks | `/speckit-tasks` | ✅ Complete | 2026-07-11. 53 tasks, slice boundary = PR seam at T027, 13 [P], full FR/SC traceability. G5 pass (runner + deterministic). Atomicity route recorded (one-navigable-PR advisory dissent; ratified 2-slice split governs); layer plan skipped; pr_marker_plan persisted (2 markers). |
| Analyze | `/speckit-analyze` | ⏳ Pending | |
| Implement | `/speckit-implement` | ⏳ Pending | Slice 1 then Slice 2 |

**Status Legend:** ⏳ Pending | 🔄 In Progress | ✅ Complete | ⚠️ Blocked

### Phase Gates (SpecKit Best Practice)

Each phase requires **human review and approval** before proceeding:

| Gate | Checkpoint | Approval Criteria |
|------|------------|-------------------|
| G1 | After Specify | All user stories clear, no `[NEEDS CLARIFICATION]` markers remain |
| G2 | After Clarify | Confidence-tier taxonomy, apply mechanics, and surface contracts resolved |
| G3 | After Plan | Architecture approved, constitution gates pass, 2-slice plan explicit, `src/refactor/` module boundary respected |
| G4 | After Checklist | All `[Gap]` markers addressed |
| G5 | After Tasks | Task coverage verified, slice ordering + dependencies correct |
| G6 | After Analyze | No `CRITICAL` issues, no drift vs design concept, `WARNING` items reviewed |
| G7 | After Each Implementation Phase | Tests pass, probe evidence recorded, self-repo dogfood UAT step complete |

---

## Prerequisites

### Constitution Validation

**Before starting any workflow phase**, verify alignment with the project constitution (`.specify/memory/constitution.md`):

| Principle | Requirement | Verification |
|-----------|-------------|--------------|
| I. Think Before Coding | Confidence tiers, apply mechanics, and ambiguity semantics resolved before coding — the design concept records them; remaining unknowns go through Clarify. | G1/G2 marker checks; design-concept references in spec and plan |
| II. Simplicity First | Recompute-on-apply (no persisted plan format), no `--keep-partial`, no `--include-docs`, no interactive picker — each was explicitly cut in the interview. | Plan non-goals and Analyze drift check |
| III. Surgical Changes | New capability lives in new module `src/refactor/`; changes to `src/mcp/tools.ts`, `src/mcp/server-instructions.ts`, `src/bin/codegraph.ts`, `src/index.ts` stay minimal (fork discipline — upstream merges must remain routine). | Diff review against declared file operations |
| IV. Goal-Driven Execution | TDD red→green per task; apply-path tests write real files against real SQLite (no DB mocking); completion claims carry test/probe evidence. | Red/green evidence in implementation log |
| V. Deterministic, LLM-Free Extraction | Rename derives edits only from graph edges + LSP responses — never from LLM output; no speculative edits (span verification excludes string-similar false positives). | Unit/integration tests; plan-derivation determinism check |
| VI. Retrieval Performance | Adding `codegraph_rename` to the always-exposed tool list must not regress retrieval; expected refusals (ambiguity, heuristic-gated, stale-span, not-indexed) return success-shaped guidance, never `isError`; tool output never says "use Read". | Control-repo A/B no-regression check (Sonnet floor model, ≥2 runs/arm); error-shape tests |
| VII. Local-First | No new runtime dependencies (pure-JS only); no network calls beyond locally spawned language servers; behavior without invoking rename is byte-identical. | `npm test`; dependency diff; dormancy check |

**Constitution Check:** ✅ Verified (G0 PASS, 2026-07-10) — `npm run build` clean; **`npm test` 171/171 test files passed (~2913 tests + 7 skipped), exit 0** under a hermetic environment.

> **G0 environment caveat (binding for every test run in this autopilot):** direnv exports the dogfood embedding endpoint (`CODEGRAPH_EMBEDDING_URL=http://hal:1234/…`, `_MODEL`, `_DIMS`, `_TIMEOUT_MS=90000`) into every shell in this repo. With those set, each test's `indexAll` produces embeddings against the remote endpoint → 5s vitest timeouts on index-heavy suites and false providers in hybrid-search "no provider" states (observed: 15 → 8 → 4 shifting failures across three runs; all resolved hermetically). CI never sets these vars. **Every `npm test`/vitest invocation during this run MUST be prefixed with:** `env -u CODEGRAPH_EMBEDDING_URL -u CODEGRAPH_EMBEDDING_MODEL -u CODEGRAPH_EMBEDDING_DIMS -u CODEGRAPH_EMBEDDING_TIMEOUT_MS -u CODEGRAPH_EMBEDDING_API_KEY` (referred to below as `TEST_ENV_SCRUB`). Two benign `too many open files` watcher-degradation warnings remain in green runs (watcher disables itself gracefully; tests tolerate it).

### Autopilot Pre-Flight Record (Step -1 / Step 0, run 2026-07-10)

| Item | Result |
|---|---|
| Runner | `python3.11 -m speckit_pro_runner` (plugin 2.18.1); JSON stdin/stdout contract verified |
| Agent package completeness (0.0b) | ✅ all 11 bundled agents present in plugin cache `agents/` |
| SpecKit CLI | ✅ specify 0.11.8; project init ✅; constitution ✅; commands ✅ |
| check-prerequisites quirk | Helper resolved repo-root to the **main checkout** (worktree `.git` is a file); its `branch: main` / `workflow file not found` lines are artifacts. Direct evidence recorded instead: branch `010-graph-aware-rename` (`git rev-parse`), workflow file present and parsed. |
| ON_FEATURE_BRANCH / IS_WORKTREE | true / true (`git-dir` ≠ `git-common-dir`) → Specify runs branch-aware (no branch creation) |
| Settings | `.claude/speckit-pro.local.md` absent → defaults: consensus-mode=moderate, gate-failure=stop, auto-commit=per-phase |
| CONFIDENCE_GATE_MODE (0.6b) | `advisory` (no flags in argv, no local config) |
| AGENT_TEAMS_AVAILABLE | **false** — env var unset. Using parallel-subagents dispatch for post-impl and `[P]` runs. To enable Agent Teams set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` on Claude Code ≥ 2.1.32 and re-run. |
| PROJECT_COMMANDS (0.11; CLAUDE.md authoritative over detect-commands' `npm build`/`npm typecheck` guesses) | BUILD=`npm run build` · TYPECHECK=`npx tsc --noEmit` · LINT=N/A · UNIT_TEST=`npm test` · INTEGRATION_TEST=N/A (integration suites live inside `npm test`; `npm run eval` is a separate non-gate suite) · SINGLE_FILE_TEST=`npx vitest run <file>` · FULL_VERIFY=`npm run build && npm test` |
| PRESET_CONVENTIONS (0.12) | 3 presets (top layer first): **claude-ask-questions** (spec/plan/tasks templates), **codegraph-project-overrides** (constitution test-policy exceptions: bug fixes start from a failing test; installer changes update installer-targets contract suite), **speckit-pro-reviewability** (reviewability-augmented tasks template). Presets present in the worktree `.specify/presets/`. |
| PROJECT_IMPLEMENTATION_AGENT (0.10) | None detected — `.claude/agents/` has only `retrieval-guardian` (read-only reviewer; reserved for Post: Code Review since the diff touches `src/mcp/`). Implementation routes to `speckit-pro:implement-executor` (TDD specialist fallback). |
| Extensions (registry) | agent-context, archive, bug, cleanup, git, retrospective, review, verify, verify-tasks — all enabled. speckit-utils/doctor NOT installed → doctor tasks recorded skipped. |
| Hook decisions | All `git.commit` before/after hooks **skipped** (duplicate autopilot per-phase commits). `before_specify git.feature` **skipped** (already on feature branch in worktree). `agent-context.update` **skipped** (handcrafted CLAUDE.md in tracking fork; automated tech-stack injection violates Principle III surgical-changes/fork discipline; plan tech stack lives in plan.md + this file). `after_implement` review/verify/verify-tasks/cleanup/retrospective hooks **accepted** — executed as the canonical Post-Implementation tasks. |
| Tier-2 relocation | Suppressed — `specs/010-graph-aware-rename/SPEC-MOC.md` carries `structureVersion: 1` (already-current); no other `specs/` candidates in worktree; `.specify/feature.json` absent (no frozen spec). |
| Capability coverage (0.8) | Advisory pass. Codebase context: codegraph MCP (dogfood) + RepoPromptCE; library docs: context7 MCP; web/domain research: tavily MCP + WebSearch; source extraction: Read/Explore agents. |
| Reviewability setup gate | WARN 405>400, pass=true — recorded at scaffold with the 2-slice split decision (§ Reviewability Budget & Split Decision above). Warn-proceed condition satisfied. |
| estimate-spec-size / tasks-mode reviewability-gate / generate-uat-skeleton / final-reviewability-backstop | Deferred on installed runner — fallback evidence chains per skill guidance. |
| Archive Sweep (Step -1) | ✅ Run via subagent per `speckit.archive.run` v1.1.0 in `--sweep --current-target specs/010-graph-aware-rename` mode. archive_extension_installed=true; eligible_previous_specs=[] (SPEC-001/002/003/004/008/023/025 already archived — 7 provenance records in `.specify/memory/archive-reports/`); actions_taken=none; current spec excluded/untouched; safeToApplyCleanup=N/A (empty candidate set). Warnings logged: check-prerequisites.sh has no sweep-only mode (paths derived directly); future sweeps that find eligible specs on a feature branch must resolve the command's main-branch cleanup gate explicitly. |

---

## Specification Context

### Basic Information

| Field | Value |
|-------|-------|
| **Spec ID** | SPEC-010 |
| **Name** | Graph-Aware Rename |
| **Branch** | `010-graph-aware-rename` |
| **Dependencies** | SPEC-008 (complete — LSP substrate: `src/lsp/` client, per-language server configs, provenance schema) |
| **Enables** | Safe automated refactors for agents |
| **Priority** | P1 |

### Roadmap Scope

Rename any symbol with a dry-run plan first, LSP-powered where possible,
graph-verified always, atomic on apply. SPEC-010 owns:

- `src/refactor/rename.ts`: plan builder — LSP `textDocument/rename` workspace-edit
  when a server covers the language; otherwise graph-reference-driven edit
  derivation with collision detection (shadowing, import aliases, string-similar
  false positives excluded by span verification); ambiguous → refusal with reasons.
- Plan format: files, ranges, before/after previews, confidence per edit;
  `--dry-run` default, `--apply` executes with workspace-root jail + .gitignore
  respect, then targeted re-sync of touched files; post-check asserts zero
  dangling references.
- Surfaces: `codegraph rename` CLI + MCP tool with the same plan/apply contract.

### Setup Decisions (from the design concept — source of truth)

- Graph-fallback rename supports **all indexed languages**, confidence-gated (Q1).
- `--apply` **recomputes the plan** from the live index in one invocation; dry-run output is preview-only (Q2).
- `--apply` **refuses unless every edit is `exact`** (LSP workspace-edit or span-verified graph reference); `--include-heuristic` overrides (Q3).
- Pre-apply guard is **span verification against live bytes**; any mismatch aborts with a "stale index — run codegraph sync" refusal; no git-cleanliness requirement (Q4).
- Post-check failure (dangling references after apply + re-sync) triggers **auto-rollback from pre-write snapshots** and reports the dangling references (Q5).
- Targeting is **name + qualifiers** (`Class.method`, `--file`, `--kind`); ambiguity refusals list every candidate with kind, file:line, and the selecting qualifier (Q6).
- MCP tool **always exposed**; dry-run default; side effects only on explicit `apply: true`; identical contract to CLI (Q7).
- Symbol kinds are **path-dependent with honest refusals**: LSP path renames whatever the server supports; graph path covers declaration kinds with tracked references and refuses locals/params with a reason; `file`/`route`/`import`/`export` excluded everywhere (Q8).
- **No comment/docstring/string-literal edits**; the plan may count leftover textual mentions as an FYI (Q9).
- **Windows validation deferred** (VM suspended); macOS + Docker/Linux validation required; write path stays on cross-platform Node fs APIs (Q10).
- **2 vertical slices** (Q11) — see the split record above.

### Out of Scope

- Non-rename refactors (extract/move); cross-repo rename (post-SPEC-022).
- Editing comments, docstrings, or string literals.
- Renaming `file`, `route`, `import`, `export` nodes; graph-path locals/params.
- Persisted plan artifacts; interactive pickers; `--keep-partial`; `--include-docs`.
- Auto-installing or auto-starting language servers beyond SPEC-008's existing config.

### Success Criteria Summary

- [ ] `codegraph rename <target> <new-name>` (dry-run default) prints a plan: files, ranges, before/after previews, confidence per edit — for any indexed language.
- [ ] LSP path used when a configured server covers the language; graph-reference path otherwise; the plan states which path produced each edit.
- [ ] Ambiguous target → refusal listing every candidate (kind, file:line, selecting qualifier); zero writes.
- [ ] `--apply` refuses when any edit is below `exact` unless `--include-heuristic`; refusal lists the gated edits.
- [ ] `--apply` verifies every span against live bytes first; mismatch → whole apply aborts ("stale index — run codegraph sync"), zero writes.
- [ ] Apply is atomic: workspace-root jail + .gitignore respect; pre-write snapshots; targeted re-sync of touched files; post-check asserts zero dangling references; post-check failure → full rollback + re-sync + report.
- [ ] `codegraph_rename` MCP tool ships the same contract (dry-run default, explicit `apply: true`); expected refusals are success-shaped (never `isError`); `server-instructions.ts` updated.
- [ ] Control-repo A/B shows no retrieval regression from the enlarged tool list (Sonnet floor, ≥2 runs/arm).
- [ ] Self-repo dogfood UAT: rename a real symbol in this repository via the new capability, plan reviewed, applied, post-check green, then reverted (or kept if trivial) — evidence recorded in the UAT runbook.
- [ ] macOS + Dockerized Linux suites green; Windows-sensitive assertions gated `it.runIf` and recorded as deferred.
- [ ] Delivered as 2 vertical PR slices, each within the reviewability ceiling.

---

## Phase 1: Specify

**When to run:** At the start of the feature specification. Focus on **WHAT** and **WHY**, not implementation details. Output: `specs/010-graph-aware-rename/spec.md`

### Specify Prompt

```text
/speckit-specify

## Feature: Graph-Aware Rename (SPEC-010)

CodeGraph can answer "who references X" from its graph, and SPEC-008 gave it
compiler-accurate LSP verification. SPEC-010 turns that into a safe write
capability: rename any symbol with a dry-run plan first, LSP-powered where a
language server covers the language, graph-verified always, atomic on apply.
The goal it serves: safe automated refactors for agents.

Use the roadmap section for SPEC-010 and the Design Concept at
docs/ai/specs/.process/SPEC-010-design-concept.md as the scope authority. The
design concept's Q&A log records WHY each decision was made — quote it when a
requirement needs rationale.

### Required user-visible outcomes
- `codegraph rename <target> <new-name>` plans a rename in dry-run mode by
  default: files, ranges, before/after previews, and a confidence rating per
  edit ('exact' = LSP workspace-edit or span-verified graph reference;
  'heuristic' = anything less). Works for every indexed language — LSP path
  when a configured server covers the language, graph-reference derivation
  otherwise (design concept Q1: "all languages, confidence-gated").
- Targeting is name-based with qualifiers: bare name, qualified Class.method,
  plus --file / --kind narrowing. When several symbols match, the command
  refuses and lists every candidate with kind, file:line, and the exact
  qualifier that would select it — the refusal teaches the retry (Q6).
  No interactive prompting on any surface.
- `--apply` recomputes the plan from the live index and executes it in one
  invocation (Q2 — no persisted plan artifact). It refuses if any edit is
  below 'exact' unless --include-heuristic is passed, listing the gated
  edits (Q3).
- Before writing, every edit's span is re-verified against live file bytes;
  any mismatch aborts the entire apply with a "stale index — run codegraph
  sync" refusal and zero writes (Q4). No git-cleanliness requirement.
- Apply is atomic through verification: workspace-root jail + .gitignore
  respect, pre-write snapshots, targeted re-sync of touched files, then a
  post-check asserting zero dangling references to the old name. Post-check
  failure restores every touched file from snapshots, re-syncs, and reports
  the dangling references (Q5).
- Collision detection excludes false positives: shadowing, import aliases,
  and string-similar matches are excluded by span verification; genuinely
  ambiguous derivations are refused with reasons, never guessed.
- Symbol-kind coverage is path-dependent with honest refusals (Q8): the LSP
  path renames anything the server supports (including locals/parameters);
  the graph path covers named declaration kinds with tracked references and
  refuses locals/params with the reason "no local usage tracking — needs a
  language server". file/route/import/export kinds are excluded everywhere.
- Comments, docstrings, and string literals are never edited; the plan may
  report a count of leftover textual mentions as an FYI (Q9).
- An MCP tool `codegraph_rename` exposes the identical plan/apply contract:
  dry-run by default, side effects only on explicit apply: true (Q7). All
  expected/recoverable conditions (ambiguity, heuristic-gated apply, stale
  span, project not indexed, unsupported kind) return success-shaped
  responses carrying guidance — never isError (constitution Principle VI).

### Non-goals
- No extract/move or other non-rename refactors; no cross-repo rename.
- No comment/string editing, no --include-docs flag.
- No persisted plan file; no interactive picker; no --keep-partial.
- No new runtime dependencies; no network calls beyond locally spawned
  language servers.

### Constraints
- New code lives in the new module src/refactor/ (fork discipline —
  constitution Principle III); modifications to src/mcp/tools.ts,
  src/mcp/server-instructions.ts, src/bin/codegraph.ts, and src/index.ts
  stay minimal.
- Delivered as 2 vertical slices (setup gate record in the workflow file):
  Slice 1 = plan engine + targeting/refusals + CLI dry-run (read-only);
  Slice 2 = apply path + MCP tool + server-instructions update.
- Windows validation is deferred (VM suspended — design concept Q10):
  macOS + Dockerized Linux validation required; platform-sensitive
  assertions gated it.runIf.
- Adding the MCP tool must not regress retrieval on a control repo
  (Principle VI A/B methodology, Sonnet floor model).

### Acceptance scenarios (seed — expand in the spec)
- Unique target, LSP-covered language: dry-run prints an LSP-derived plan;
  --apply writes atomically, re-syncs, post-check green.
- Unique target, non-LSP language: graph-derived plan with per-edit
  confidence; all-exact plan applies; plan containing heuristic edits
  refuses apply without --include-heuristic.
- Ambiguous name: refusal lists all candidates with selecting qualifiers;
  retry with Class.method qualifier succeeds.
- File drifted since last sync: apply aborts on span mismatch with the
  stale-index refusal; nothing written.
- Post-check finds a dangling reference: every touched file restored
  byte-identical, re-sync run, refusal explains which references dangled.
- Graph-path attempt to rename a function parameter: refusal citing "no
  local usage tracking — needs a language server".
- MCP call without apply: plan JSON; with apply: true: same contract as CLI;
  every refusal above arrives success-shaped over MCP.
```

### Specify Results

| Metric | Value |
|--------|-------|
| Functional Requirements | 25 (FR-001…FR-025) |
| User Stories | 4 — US1 P1 dry-run plan · US2 P2 targeting/refusals · US3 P2 atomic apply · US4 P3 MCP parity (Slice 1 = US1+US2, Slice 2 = US3+US4) |
| Acceptance Criteria | 16 Given/When/Then scenarios; 9 success criteria (SC-009 = self-repo dogfood UAT) |
| Key Entities | 6 — Rename Plan, Rename Edit, Target Selector, Candidate, Confidence Tier, Apply Result |
| Markers | 1 intentional `[NEEDS CLARIFICATION]` (FR-004 exact/heuristic tier per provenance class — deferred to Clarify S1 by design-concept Open Questions) |
| Template | speckit-pro-reviewability spec-template (adds Reviewability Budget + PR Review Packet sections; budget recorded, warn-accepted via 2-slice split) |

**G1 (routing):** 1 marker → Clarify proceeds. `validate-gate` runner helper hit the known worktree repo-root quirk ("spec.md not found" — resolved against the main checkout); direct evidence recorded instead (`grep -c "NEEDS CLARIFICATION" spec.md` → 1; file present in worktree git status).

**Spec-MOC regen (phase-gate step):** `generate-spec-index-write` is a mutation-mode op and the installed runner rejects mutation envelopes (`invalid_envelope`) — **deferred on installed runner**, same class as generate-pr-body/generate-uat-skeleton/final-reviewability-backstop. Generated zones in SPEC-MOC.md remain template placeholders; no diff to fold at phase boundaries. Re-evaluate once at PR time; do not retry per-phase. (`generate-pr-body` at post-impl will need the deferred-helper fallback: hand-authored body per repo conventions + read-only packet validation where possible.)

`.specify/feature.json` created by the executor (pins downstream phases to specs/010-graph-aware-rename) — committed as run state.

### Files Generated

- [x] `specs/010-graph-aware-rename/spec.md`
- [x] `specs/010-graph-aware-rename/checklists/requirements.md`
- [x] `.specify/feature.json`

### SpecKit Traceability Markers

Use these markers in spec.md for traceability through later phases:

| Marker | Purpose | Example |
|--------|---------|---------|
| `[US1]`, `[US2]` | User story reference | `[US1] Agent plans a rename in dry-run` |
| `[FR-001]` | Functional requirement | `[FR-001] Dry-run is the default mode` |
| `[NEEDS CLARIFICATION]` | Flag for Clarify phase | `Exact-tier boundary [NEEDS CLARIFICATION]` |
| `[P]` | Parallel-safe task | `[P] Can run alongside other tasks` |
| `[Gap]` | Missing coverage | `[Gap] No task covers rollback failure` |

---

## Phase 2: Clarify (Optional but Recommended)

**When to run:** After Specify. The design concept's Open Questions section seeds
these sessions — anything still open after grill-me is exactly what Clarify digs into.
Maximum 5 targeted questions per session.

### Clarify Prompts

#### Session 1: Confidence-tier taxonomy

```text
/speckit-clarify Focus on SPEC-010 confidence tiers (design concept Open Question 2):
- Define the exact boundary between 'exact' and 'heuristic' per evidence class:
  LSP workspace-edit spans, graph edges with provenance='lsp' (SPEC-008
  verified/corrected), resolver edges with provenance=null, synthesized edges
  with provenance='heuristic'.
- Decide whether provenance='heuristic' synthesized edges ever produce plan
  edits at all, or are only counted/reported (constitution Principle V: no
  speculative writes — silent beats wrong).
- Confirm span verification at plan time is what promotes a graph-derived edit
  to 'exact', and that apply-time re-verification is a second, independent check.
- Preserve the design concept decisions: apply refuses below all-exact (Q3);
  --include-heuristic is the only override.
```

#### Session 2: Apply mechanics & atomicity

```text
/speckit-clarify Focus on SPEC-010 apply mechanics (design concept Q4/Q5):
- Snapshot mechanism for rollback: in-memory vs temp-file copies; the write
  strategy that makes multi-file apply atomic-through-verification.
- Post-check definition: the exact query/probe that asserts "zero dangling
  references to the old name" after targeted re-sync, and its scope (renamed
  symbol's references only, not repo-wide noise).
- Rollback failure handling (a snapshot restore itself fails): surface as a
  real malfunction (isError with retry-once note is acceptable here — genuine
  stop-trying case) with the snapshot location reported.
- Workspace-root jail semantics for LSP workspace-edits that touch files
  outside the project root (refuse the whole plan), and .gitignore-respect
  interaction with generated/vendored files the LSP may edit.
- Preserve: span-verification guard (Q4), auto-rollback on post-check failure
  (Q5), no git-cleanliness requirement (Q4).
```

#### Session 3: Surfaces & slice boundary

```text
/speckit-clarify Focus on SPEC-010 surfaces and slicing:
- CLI contract details: exact flag names (--apply, --include-heuristic,
  --file, --kind, --json), exit codes for plan/refusal/applied/rolled-back,
  and dry-run output format (human table + --json).
- MCP tool schema for codegraph_rename: parameter names/types mirroring the
  CLI (target, newName, apply, includeHeuristic, file, kind, projectPath),
  and the server-instructions.ts update (single source of truth — describe
  the tool without regressing explore/node guidance).
- Slice-1/Slice-2 boundary: confirm slice 1 ships plan engine + CLI dry-run
  only (no --apply flag surface at all, or --apply present but refusing as
  not-yet-implemented — pick one and justify), and slice 2 ships apply + MCP.
- Control-repo no-regression check placement: which slice runs the A/B
  (slice 2, when the tool list actually grows) and the pass bar
  (Principle VI: ≥2 runs/arm, Sonnet floor, no regression).
- Preserve: same plan/apply contract on both surfaces (Q7); success-shaped
  refusals everywhere (Principle VI).
```

### Clarify Results

| Session | Focus Area | Questions | Key Outcomes |
|---------|------------|-----------|--------------|
| 1 | Confidence tiers | 5 (4 executor-answered high-confidence + 1 consensus) | ✅ 2026-07-10. FR-004 rewritten as a deterministic `resolvedBy`-keyed tier table (exact = LSP/declaration/provenance-lsp + import + qualified-name + function-ref + instance-method's declaration-verified branch; heuristic = exact-match + fuzzy + framework-in-full + guess branches + unknown provenance; file-path and synthesized edges never candidates). Synthesized edges count-only via FR-013. Span verification confirmed as an independent gate at plan AND apply time. UTF-16 code units end-to-end recorded in Assumptions (SPEC-008 pin). Marker removed; 0 remain. |
| 2 | Apply mechanics | 5 (3 executor-answered high-confidence + 2 security-consensus → human-ratified) | ✅ 2026-07-11. FR-018 refined (resolution-complete sync path; lock-contended/no-op re-sync ⇒ apply failure ⇒ rollback; post-check = touched-files-scoped dual assertion, never repo-wide). FR-020 refined (in-memory snapshots; temp-file-then-atomic-rename; snapshots held until post-check). NEW FR-019a (human-ratified): failed rollback restore = the sole error-shaped malfunction — snapshot dump to per-incident `.codegraph/rename-recovery-<pid>-<hex>/`, restore-retry note OK, never invites rename re-run. FR-017 amended (human-ratified): per-edit symlink-resolved jail at plan+apply; scope test = indexer/watcher scope matcher (codegraph.json include/exclude aware); out-of-root or scope-ignored target ⇒ whole-plan success-shaped refusal. FR-023/SC-006 recoverable lists extended accordingly. 3 Edge Case bullets added. |
| 3 | Surfaces & slicing | 5 (Q1/Q2/Q3/Q4ab/Q5 executor-answered high-confidence + Q4c security-consensus → human-ratified) | ✅ 2026-07-11. NEW FR-026 (exit codes 0/1/2/3/4 — two successes share 0; FR-019a gets reserved code 4). NEW FR-027 (human table + `-j, --json` stable schema byte-identical to MCP; per-edit file/range/oldText/newText/confidence/source). Slice-1 flag surface pinned (no --apply until Slice 2; Assumptions). FR-021 append (camelCase schema), FR-022 append (DEFAULT_MCP_TOOLS membership), FR-024 append (A/B in Slice 2), FR-025 append (scoped write-tool paragraph, explore-first preserved). NEW FR-028 (human-ratified): annotations readOnlyHint:false/destructiveHint:true/idempotentHint:false/openWorldHint:false — move_file precedent; Ask-mode consequence accepted. `## Clarifications` section added to spec.md (G2 requirement). |

### Consensus Resolution Log

| # | Type | Question/Gap/Finding | Categories | Round | Outcome | Resolution | Analysts Used |
|---|------|----------------------|------------|-------|---------|------------|---------------|
| 1 | Clarify | S1/Q3: exact/heuristic tier boundary per `resolvedBy` category (FR-004) | [spec, codebase, ambiguous] | 1 | synthesis (6 of 8 values 3/3 or resolved-convergence; `instance-method` split 2/3 — dissent: spec-context wanted uniform exact; `framework` heuristic-in-full 2/3 — dissent: codebase wanted a floor-≥0.9 split, preserved as a future Complexity Tracking candidate if dogfood UAT shows over-gating) | FR-004 rewritten as a deterministic `resolvedBy`-keyed table; `file-path` + `provenance='heuristic'` synthesized edges never candidate edits; span verification (FR-005/FR-016) remains an independent additional gate; Assumptions line synced | codebase-analyst, spec-context-analyst, domain-researcher |
| 2 | Clarify | S2/Q4: rollback-restore-itself-fails — response shape / recovery artifact / retry stance (FR-019a) | [security] | 1 | 3/3 unanimous → security override → **human-ratified 2026-07-11** ("Adopt consensus draft") | New FR-019a: `isError:true` MCP + distinct non-zero CLI exit (sole malfunction exception to FR-023); unrestored snapshots persisted to per-incident `.codegraph/rename-recovery-<pid>-<random-hex>/` (repo's PID+hex uniqueness convention — never clobbers a prior incident); reports restored/unrestored by path + recovery dir; restore-step-retry note permitted; rename/apply retry never invited (Principle I). Edge Case bullet added. | codebase-analyst, spec-context-analyst, domain-researcher |
| 3 | Clarify | S2/Q5: LSP workspace-edit jail semantics — out-of-root shape (a) + scope-ignored in-root file (b) (FR-017) | [security, domain] | 1 | (a) 2/3 success-shaped [dissent: spec-context wanted isError/PathRefusalError, event-based reading]; (b) 2/3 refuse-whole-plan [codebase abstained on code evidence; supplied buildScopeIgnore mechanism correction] → security override → **human-ratified 2026-07-11** ("Success-shaped refusal"; "Refuse whole plan") | FR-017 amended: per-edit symlink-resolved containment (existing jail check) at plan AND apply time (TOCTOU); ignore test = the indexer/watcher's shared scope matcher honoring codegraph.json include/exclude (never raw .gitignore reparse); out-of-root or scope-ignored target ⇒ entire plan refused, success-shaped, names the file(s), coaches no bypass; FR-023 + SC-006 recoverable lists extended; dissent's defense-in-depth concern honored via no-bypass-coaching clause. 2 Edge Case bullets added. | codebase-analyst, spec-context-analyst, domain-researcher |
| 4 | Clarify | S3/Q4(c): `codegraph_rename` write-tool annotation posture (FR-028) | [security, codebase] | 1 | 3/3 unanimous → security override → **human-ratified 2026-07-11** ("Adopt consensus draft") | New FR-028: readOnlyHint:false + destructiveHint:true + idempotentHint:false + openWorldHint:false — byte-identical to the MCP reference filesystem server's `move_file` quadruplet; consequence accepted that read-only-gated client modes (Cursor Ask mode, #1018 class) refuse the tool even for dry-run (annotations per-tool, not per-call; split plan/apply tools foreclosed by FR-021/FR-022 + design Q7); FR-025 guidance carries the Agent-mode requirement; Claude Code's readOnlyHint-parallelism consumption correctly serializes the write tool | codebase-analyst, spec-context-analyst, domain-researcher |
| 5 | Gap | api-contracts CHK006: preview-context contract (`lineText`) | [spec, domain] | 1 | both-agree | Applied fix ratified: single REQUIRED per-edit pre-edit `lineText` (after-state client-derivable; N-line window unrequested; optional would reintroduce the Read SC-001 forbids; map-indirection = unrequested complexity for byte-identical duplicates). Documentation-only addition: same-line composition rule (apply all of a line's edits to one copy, right-to-left) in schema + FR-027 | spec-context-analyst, domain-researcher |
| 6 | Gap | api-contracts CHK024: FR-021a invalid-argument routing (unrecognized kind; no-op rename) | [codebase, spec] | 1 | both-agree | Both rulings confirmed: unrecognized kind → `invalid-argument` (selector-arg fail-fast convention; four-way taxonomy; teach-the-retry), no-op → `invalid-argument` refusal (US1-AS3 doesn't extend; minItems:1 forecloses empty; old==new would break the FR-018 post-check → spurious rollback → third state SC-002 forbids). Adopted structured `validKinds` refusal field (schema per-reason convention) + FR-021a cross-ref | codebase-analyst, spec-context-analyst |
| 7 | Gap | error-handling CHK010: runtime LSP failure routing — degrade-to-graph vs honest-refuse (FR-003a) | [codebase, domain, spec] | 1 | 3/3 | FR-003a ratified as applied — degrade at plan AND apply, no hybrid carve-out; safety carried by cause-blind uniform gates (FR-004 tiers key on resolvedBy; span checks + FR-015 gate identical either path); client contract never resolves partial data; per-edit `source` visibility (SPEC-003 provenance-tag precedent); industry structural test (cascade when a second engine exists — VS Code provider sequence, Sourcegraph fallback; refuse only when none exists — IntelliJ dumb mode, gopls); locals honest-refusal retained | codebase-analyst, spec-context-analyst, domain-researcher |
| 8 | Gap | data-integrity CHK020: watcher-vs-apply re-sync serialization mechanism (FR-018) | [codebase, domain] | 1 | both-agree | Mechanism (c) — result-shape discrimination on the EXISTING structural serialization; mutex-hold rejected (Mutex non-reentrant, sync() re-acquires → guaranteed deadlock) and watcher-suspend rejected (no pause surface; unwatch/rewatch drops pending files). MCP-served apply shares ONE CodeGraph instance with the watcher (engine holds one cg) → indexMutex already totally orders them; cross-process = existing on-disk fileLock. Apply discriminates the lock-failure zero-shape (filesChecked:0 + durationMs:0 → rollback) from any filesChecked>0 result incl. watcher-raced real-empty → proceed to the post-check, which reads live graph state agnostic to who synced (shipped watch()-callback precedent). Domain's optional defer-signal recorded considered-and-not-needed (no in-process race remains; Principle II). 4 edits applied: FR-018 sub-bullet rewritten; drift corrected in data-model.md (diagram label + Concurrency invariant) and research.md Decision 3 (stale filesModified>0 gate) | codebase-analyst, domain-researcher |
| 9 | Gap | data-integrity CHK011: overlapping LSP edits — degrade vs new refusal reason (FR-020) | [domain, spec] | 1 | both-agree | FR-020 ratified as applied — identical duplicates dedup; a genuine partial overlap (protocol-contract violation, only reachable from a misbehaving server; graph spans disjoint by FR-005) degrades via the FR-003a runtime-failure contract, same family as malformed-protocol-response; NO new refusal reason (extends CHK010's cause-blind precedent a fortiori; a new isError reason would contradict FR-019a's "sole malfunction"; no caller-actionable fix exists — LSP's own ApplyWorkspaceEditResult is boolean+free-text, VS Code applyEdit is a bare boolean, Neovim doesn't validate overlap at all). Overlap-specific cause-visibility considered and declined (would break cause-blind uniformity — none of the five sibling reasons gets per-cause visibility) | spec-context-analyst, domain-researcher |

---

## Phase 3: Plan

**When to run:** After spec is finalized. Generates technical implementation blueprint. Output: `specs/010-graph-aware-rename/plan.md`

### Plan Prompt

```text
/speckit-plan

Re-read docs/ai/specs/.process/SPEC-010-design-concept.md before planning —
it records the decisions and their rationale; plan.md must not contradict it
without an explicit revision note.

## Tech Stack
- Language: TypeScript (strict), Node >=20 <25 engines range (effective
  from-source floor 22.5 for node:sqlite) — no new runtime dependencies
  (constitution Principle VII, pure-JS only).
- Storage: node:sqlite via src/db/ QueryBuilder prepared statements; graph
  reads go through existing queries (references, spans, provenance) — add
  new prepared statements to QueryBuilder rather than inline SQL.
- LSP: SPEC-008 substrate in src/lsp/ — LspJsonRpcClient (generic
  request(method, params) carries textDocument/rename), per-language server
  configs (EffectiveLspConfig, probeLspServerCommand), UTF-16 position
  encoding on the wire (pinned by the SPEC-008 UTF-16 test — reuse its
  position-mapping helpers for rename positions and returned edit ranges).
- Surfaces: commander subcommand in src/bin/codegraph.ts; MCP tool in
  src/mcp/tools.ts registered alongside explore/node; server-instructions.ts
  is the single source of truth for agent-facing tool guidance.
- Testing: vitest in __tests__/, real files + real SQLite (no DB mocking),
  fs.mkdtempSync temp dirs with afterEach cleanup; platform-divergent
  assertions gated it.runIf (Windows deferred — design concept Q10).

## Constraints
- New module src/refactor/ owns the plan/apply engine (fork discipline —
  Principle III); keep diffs to src/mcp/tools.ts, src/bin/codegraph.ts,
  src/index.ts, src/mcp/server-instructions.ts minimal and additive.
- Two vertical slices (workflow § Reviewability Budget & Split Decision):
  Slice 1 read-only plan engine + CLI dry-run; Slice 2 apply + MCP. Each
  slice independently testable and within the ~400 reviewable-LOC ceiling —
  plan the file layout so the slice boundary is a clean PR boundary.
- Architecture decisions fixed by the design concept: recompute-on-apply
  (Q2), all-exact apply gate with --include-heuristic (Q3), live-bytes span
  verification (Q4), snapshot auto-rollback on post-check failure (Q5),
  name+qualifier targeting with candidate-listing refusals (Q6), always-
  exposed MCP tool with explicit apply:true (Q7), path-dependent kind
  coverage (Q8), no textual-occurrence edits (Q9).
- Error shaping (Principle VI): expected/recoverable refusals are success-
  shaped on MCP (follow ToolHandler.execute's NotIndexedError → textResult
  pattern); isError only for security refusals and real malfunctions.

## Architecture Notes
- Plan derivation order per language: configured+available LSP server →
  textDocument/rename workspace-edit (edits arrive complete, including
  locals); otherwise graph references for the resolved target node,
  span-verified against file bytes to earn 'exact'.
- Confidence tiers resolved in Clarify Session 1 — carry the decision table
  into plan.md's data model.
- Post-check rides the existing targeted re-sync (CodeGraph.sync with
  changed file paths) then queries for references to the old name among the
  touched symbol's edges.
- Include a Complexity Tracking row for any deviation from Principle II
  (none expected).
```

### Plan Results

| Artifact | Status | Notes |
|----------|--------|-------|
| `plan.md` | ✅ 16.1 KB | Constitution Check PASS ×7 (empty Complexity Tracking); tech context; slice-boundary file layout; execution flow |
| `research.md` | ✅ 16.0 KB | 8 decisions incl.: FR-018 re-sync = `CodeGraph.sync()` (resolution-complete, never `indexFiles()`); no LSP rename types exist yet — SPEC-010 defines them in `src/refactor/types.ts`; positions are start-only points — range end derives from old-name UTF-16 length then span-verifies (no schema change) |
| `data-model.md` | ✅ 12.1 KB | Carries the authoritative FR-004 tier decision table enriched with confirmed `resolvedBy` assignment sites + the `instance-method` two-branch split |
| `contracts/` | ✅ 3 files | `cli-rename.md`, `mcp-codegraph_rename.md`, `rename-plan.schema.json` (valid JSON, verified) — one shared plan schema |
| `quickstart.md` | ✅ 7.4 KB | Developer onboarding |

**Plan-phase reviewability budget (advisory, step 7b):** `estimate-reviewable-loc` ran clean (exit 0) → `status: not_estimated, projected: null` — plan.md declares no parseable production-file-operations structure. Recorded as **not estimated (no declared production files)**, never treated as within-budget. Operative sizing evidence remains the scaffold setup gate (WARN 405 > 400, pass=true) + the human-ratified 2-slice split (~200 LOC/slice). Note: first estimator attempt hit the known worktree repo-root quirk ("plan file not readable"); succeeded with a main-checkout-relative path.

**CLAUDE.md managed section:** the plan executor updated the `<!-- SPECKIT START -->` block (SPEC-010 in-flight + plan pointer) — surgical, accurate, folded into this phase's commit.

---

## Phase 4: Domain Checklists

**When to run:** After `/speckit-plan` — validates both spec AND plan together.

### Step 1: Recommended Domains (from spec analysis at setup)

| Signal in SPEC-010 | Domain |
|---|---|
| One plan/apply contract across CLI and MCP; JSON plan format; exit codes | **api-contracts** |
| Refusal taxonomy (ambiguity, heuristic-gated, stale-span, unsupported kind), rollback, degradation without a server | **error-handling** |
| Workspace-root jail, .gitignore respect, path refusals, first write-capable MCP tool | **security** |
| Atomic multi-file writes, snapshots, span verification, post-check, index re-sync consistency | **data-integrity** |

### Step 2: Run Enriched Checklist Prompts

#### 1. api-contracts Checklist

<!-- Why: the same plan/apply contract must hold byte-for-byte across two surfaces, and agents consume the refusals programmatically. -->

```text
/speckit-checklist api-contracts

Focus on Graph-Aware Rename requirements:
- CLI and MCP expose one contract: identical semantics for target/qualifiers,
  dry-run default, apply, include-heuristic; document the mapping table.
- Plan output schema: files, ranges, before/after previews, per-edit
  confidence, per-edit source path (lsp|graph); stable field names for --json
  and the MCP result.
- Refusal responses enumerate machine-actionable content: candidate lists
  with selecting qualifiers, gated-edit lists, stale-span file list, dangling-
  reference list — each sufficient to retry without a Read.
- Exit codes: distinct for planned-ok / refused / applied / rolled-back.
- Pay special attention to: MCP refusals staying success-shaped (never
  isError) while the CLI uses exit codes — same information, surface-native
  encodings.
```

#### 2. error-handling Checklist

<!-- Why: the spec is mostly a ladder of refusal and recovery paths; each must be reachable, tested, and honest. -->

```text
/speckit-checklist error-handling

Focus on Graph-Aware Rename requirements:
- Every refusal class has: a trigger test, a reason message naming the fix
  (e.g. "run codegraph sync", the qualifier to add), and zero side effects.
- LSP server absent/crashed/timeout mid-rename → falls back to graph path or
  refuses honestly; never half-applies an LSP workspace-edit.
- Rollback paths: post-check failure restores byte-identical content;
  rollback-failure itself is surfaced as a real malfunction with snapshot
  location.
- Degradation parity with SPEC-008: per-language, never failing the whole
  command because one server is missing.
- Pay special attention to: the apply pipeline's ordering guarantees —
  confidence gate before span check before writes before re-sync before
  post-check — and that an abort at each stage leaves prior stages' state
  intact.
```

#### 3. security Checklist

<!-- Why: first write-capable surface in the MCP server — the jail and ignore rules are the blast-radius control. -->

```text
/speckit-checklist security

Focus on Graph-Aware Rename requirements:
- Workspace-root jail: every planned write path resolves inside the project
  root (symlink-resolved); LSP workspace-edits touching outside files refuse
  the whole plan.
- .gitignore respect: ignored files are neither planned nor written; interaction
  with vendored/generated code documented.
- Path refusal behavior consistent with existing PathRefusalError semantics
  (the one legitimate isError class).
- MCP write exposure: side effects only on explicit apply:true; no rename
  triggered by initialize/list; host permission prompts remain the outer gate.
- Pay special attention to: symlinked project roots and case-insensitive
  filesystems (macOS) when resolving "inside the jail".
```

#### 4. data-integrity Checklist

<!-- Why: atomic multi-file mutation with an index that must stay consistent afterward is the riskiest machinery in the spec. -->

```text
/speckit-checklist data-integrity

Focus on Graph-Aware Rename requirements:
- Span verification is byte-exact (UTF-8 offsets vs UTF-16 LSP positions
  mapped correctly; CRLF drift refuses rather than corrupts).
- Atomicity: no observable intermediate state on success; snapshots cover
  every touched file before the first write; restore is byte-identical.
- Index consistency: targeted re-sync covers exactly the touched files;
  post-check queries the post-sync graph; node/edge counts stay stable
  (no explosion) across rename + re-sync.
- Concurrent-access safety: file watcher / daemon sessions observing the
  apply see a consistent index afterward (sync mutex honored).
- Pay special attention to: multi-occurrence lines and overlapping edit
  ranges within one file — ordering and offset arithmetic under multiple
  edits per file.
```

### Checklist Results

| Checklist | Items | Gaps | Spec References |
|-----------|-------|------|-----------------|
| api-contracts | 36 (✅ 2026-07-11) | 7 found → 7 fixed → 0 remaining (2 loops); 2 consensus items both-agree ratified | FR-021 mapping table; FR-021a (+validKinds); FR-016 stale-span files; FR-019/FR-019a payload fields; FR-027 lineText + determinism + envelope + same-line composition; schema: lineText/danglingReferences/recovery/invalid-argument/validKinds/relaxed required |
| error-handling | 30 (✅ 2026-07-11) | 3 found → 3 fixed → 0 remaining (1 loop + verification pass); 1 consensus item 3/3 ratified | NEW FR-003a (availability-probe fork keyed on probeLspServerCommand; runtime-failure degradation across the five SPEC-008 `degraded` reasons; per-language parity — never fails the whole command); FR-003 cross-ref; LSP-failure Edge Case; tightened SPEC-008 Assumption; plan.md src/lsp/ dependency note. No new refusal reason (taxonomy intact) |
| security | 29 (✅ 2026-07-11) | 7 found → 7 fixed → 0 remaining (1 loop + adversarial re-scan); 0 unresolved → consensus skipped (zero items) | FR-017 +3 sub-bullets (symlinked-root/case-insensitive realpath-both-sides; refuse-before-read info-disclosure guard; not-PathRefusalError demarcation); Edge Case (old-name refs inside scope-ignored files are index-invisible — remedy: codegraph.json include); Assumption (host permission prompts = outer gate; list/initialize never write). All document ratified posture — nothing reopened |
| data-integrity | 27 (✅ 2026-07-11) | 5 found → 5 fixed → 0 remaining (1 loop + verification pass); 2 consensus items both-agree (CHK020 revised the applied mechanism + fixed 3-artifact drift; CHK011 ratified as applied) | NEW SC-010 (node/edge count stability); FR-018 +2 sub-bullets (watcher serialization via existing mutex ordering + zero-shape discrimination; no index explosion); FR-020 +3 sub-bullets (byte-preservation outside spans; descending intra-file write order; overlap dedup/degrade); data-model + research drift corrected |
| **Total** | 122 items across 4 domains + requirements.md | 22 gaps found → 22 fixed → **0 remaining**; 5 consensus items (2 both-agree api-contracts, 1 3/3 error-handling, 2 both-agree data-integrity); 0 human escalations (no new security decisions — Clarify's 3 ratifications held as fixed ground) | spec.md grew FR-003a + FR-021a + SC-010 + ~12 refined FRs; schema hardened; plan/research/data-model kept consistent |

### Addressing Gaps

When checklist identifies `[Gap]` items:

1. Review the gap — is it a genuine missing requirement?
2. Update `spec.md` or `plan.md` to address it
3. Re-run the checklist to verify coverage
4. If the gap is intentionally out of scope, document why (the design concept's Non-goals are the authority)

---

## Phase 5: Tasks

**When to run:** After checklists complete (all gaps resolved). Output: `specs/010-graph-aware-rename/tasks.md`

### Tasks Prompt

```text
/speckit-tasks

Reference spec.md, plan.md, AND docs/ai/specs/.process/SPEC-010-design-concept.md.
The design concept's Non-goals bound task generation — flag any task that
would cross them (comment/string edits, persisted plans, --keep-partial,
interactive pickers, file/route/import/export renames) instead of generating it.

## Task Structure
- Small, testable chunks (1-2 hours each); TDD per constitution Principle IV:
  each task's tests are written first against real files + real SQLite.
- Clear acceptance criteria referencing FR-xxx.
- Dependency ordering honors the 2-slice split (workflow § Reviewability
  Budget & Split Decision): every Slice-1 task (plan engine, targeting,
  refusals, CLI dry-run) completes before any Slice-2 task (apply, rollback,
  MCP tool, server-instructions) — the slice boundary is a PR boundary.
- Mark parallel-safe tasks explicitly with [P].
- Organize by user story, not by technical layer (vertical slices).

## Implementation Phases
1. Foundation (src/refactor/ module skeleton, plan/edit/confidence types,
   QueryBuilder statements for reference/span lookup)
2. Slice 1 user stories — plan derivation (LSP path, graph path), targeting +
   ambiguity refusals, confidence assignment, CLI dry-run output
3. Slice 2 user stories — confidence gate, span verification, atomic apply +
   snapshots + rollback, targeted re-sync + post-check, MCP tool +
   server-instructions update, control-repo A/B evidence
4. Polish & cross-cutting: CHANGELOG entry under [Unreleased] (user-facing:
   the codegraph rename capability), self-repo dogfood UAT task, Linux
   (Docker) validation task, gated-Windows notes

## Constraints
- Tests live in __tests__/ mirroring the module (e.g. __tests__/refactor-rename-plan.test.ts).
- No DB mocking; fs.mkdtempSync + afterEach cleanup.
- Ordering within apply pipeline tasks must mirror the runtime order:
  confidence gate → span check → write → re-sync → post-check → rollback.
```

### Tasks Results

| Metric | Value |
|--------|-------|
| **Total Tasks** | 53 (T001–T053), all TDD-paired (failing test precedes every implementation task; real files + real SQLite) |
| **Phases** | Setup 1 · Foundational 7 · US1 13 · US2 6 (Slice-1 wrap at T027 = PR seam) · US3 15 · US4 6 · Polish 5 |
| **Parallel Opportunities** | 13 `[P]` (T004/T005; T015–T018; T036–T038; T049–T052) |
| **User Stories Covered** | 4/4; all FR-001…FR-028 (+FR-003a/019a/021a) and SC-001…SC-010 mapped (G5 verified both deterministically and via runner: pass, 53 tasks, 0 markers). Phantom check: 0 `[x]` (vacuously clean; re-runs post-impl). Apply-ladder task order mirrors runtime order. Non-Goals guardrail section present — no task crosses the 5 forbidden scopes. |

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

Setup-time context for the classifier: the accepted design-concept split (Q11)
is 2 vertical slices — expect a `split-PR` route; reconcile at G5 if the
classifier disagrees.

| Field | Value | Meaning |
|-------|-------|---------|
| **Route** | `one-navigable-PR` (recorded 2026-07-11) | One of `split-PR`, `one-navigable-PR`, `single-atomic-PR`, `branch-by-abstraction`, or `out-of-scope`. |
| **Releasable** | `true` | `true`, or `false` for a destructive-migration or concurrency-sensitive change (a passing CI run does not prove such a change is safe to release). |
| **Signals** | `change-shape:modify-heavy` | The decisive detector findings behind the route and releasability reading (may be empty when the classifier abstains). |
| **Warnings** | (none from classifier) | Any release-safety warning attached to the change (empty when there is no releasability risk). |

**Reconciliation (anticipated above, now recorded):** the classifier's `one-navigable-PR` is its modify-heavy DEFAULT reading, an advisory abstain-class outcome — not a safety finding against splitting (`releasable: true`, no warnings). The **human-ratified 2-slice split governs PR emission**: design concept Q11 (accepted), the setup reviewability gate's warn-proceed condition (405>400 — the split IS the recorded remediation), and Clarify Session 3's ratified slice boundary (Slice 1 ships no `--apply` surface; T027 is the PR seam). The dissent is preserved in `pr_marker_plan.warnings`.

## Layer Plan

`layer_plan.status = skipped` — the layer planner (`plan-layers-feature-dir`) runs only on `split-PR` routes; route is `one-navigable-PR`. PR structure derives from the ratified marker plan instead.

## PR Marker Plan (mirror of `specs/010-graph-aware-rename/.process/autopilot-state.json`)

| Field | Value |
|---|---|
| schema_version | 1.0 |
| source_fingerprint | `sha256:470997bc25d574b8084a4a092d543644c5eb571e8a4e2081c9b118c34311be47` (spec.md + plan.md + tasks.md) |
| markers (ordered) | `slice-1-plan-engine` (T001–T027: plan engine + targeting/refusals + CLI dry-run, read-only) → `slice-2-apply-mcp` (T028–T053: apply ladder + MCP tool + server-instructions + polish) |
| review_order | slice-1-plan-engine, slice-2-apply-mcp |
| checkpoints | (populated per marker during Phase 7) |
| warnings | classifier one-navigable-PR dissent (advisory); tasks-mode reviewability gate deferred → fallback evidence chain (setup WARN pass=true + not_estimated + ratified split) |
| final_marker_split / packet_validation / pr_mappings | null (populated at PR emission) |

**Post-G5 reviewability capture (deferred-mode record):** runner `reviewability-gate` supports setup mode only on the installed runner — tasks mode NOT invoked (deferred; helper_id=reviewability-gate, requested mode=tasks, reason=installed-runner defers non-setup modes). Fallback evidence chain applied per the capture matrix: setup-mode gate **WARN 405>400, pass=true** (scaffold record above) + plan-phase `estimate-reviewable-loc` **not_estimated** + operator-ratified split decision → **proceed** (warn is a marker-planning input; `pr_marker_plan` persisted). Evidence path: `specs/010-graph-aware-rename/.process/autopilot-state.json` (repo-relative).

To produce the decision, run the classifier against the feature directory:

```text
runner helper atomicity-route specs/010-graph-aware-rename
```

See the classifier script at
[`speckit-autopilot/scripts/atomicity-route`](../../speckit-autopilot/scripts/atomicity-route).

---

## Phase 6: Analyze

**When to run:** Always run after generating tasks to catch issues.

### Analyze Prompt

```text
/speckit-analyze

Cross-artifact consistency across spec.md, plan.md, tasks.md, AND
docs/ai/specs/.process/SPEC-010-design-concept.md. The design concept is the
source of truth for scoping decisions captured during grill-me; if a
downstream artifact contradicts it without an explicit revision note, the
downstream artifact is wrong.

Focus on:
1. Constitution alignment — Principles II (no cut features resurrected:
   persisted plans, --keep-partial, --include-docs, interactive picker),
   III (src/refactor/ boundary; minimal diffs to shared files), V (edits
   derive only from graph/LSP evidence), VI (success-shaped refusals; A/B
   task present), VII (no new runtime deps).
2. Decision drift — every design-concept decision (Q1–Q11) traceable into
   spec/plan/tasks: all-language fallback, recompute-on-apply, all-exact
   gate, span guard, auto-rollback, name+qualifier targeting, explicit
   apply:true, path-dependent kinds, no textual edits, Windows deferral,
   2-slice split.
3. Coverage gaps — every FR and user story has tasks; every refusal class
   has a failing-test-first task; slice boundary respected in ordering.
4. Consistency between task file paths and the actual project structure
   (src/refactor/, __tests__/, existing CLI/MCP files).
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

Consult docs/ai/specs/.process/SPEC-010-design-concept.md's Q&A log for the
"why" behind decisions — it informs test specifications, edge-case handling,
and refactor choices. Decisions captured there but missing from tasks.md are
gaps to surface before coding, not silently drop.

## Approach: TDD-First (constitution Principle IV)

For each task:
1. **RED**: Write failing test defining expected behavior (real files, real
   SQLite, fs.mkdtempSync temp dirs — no DB mocking)
2. **GREEN**: Implement minimum code to make the test pass
3. **REFACTOR**: Clean up while tests stay green
4. **VERIFY**: Manual/probe verification of acceptance criteria

### Pre-Implementation Setup
1. From .worktrees/010-graph-aware-rename: `npm run build` and `npm test`
   green before changes (G0 baseline).
2. Confirm branch: `git rev-parse --abbrev-ref HEAD` → 010-graph-aware-rename.
3. Dogfood index healthy: `node dist/bin/codegraph.js status` — embeddings
   100%, LSP enabled (ts/js/python servers), matching the scaffold bootstrap.

### Implementation Notes
- Slice discipline: complete and checkpoint Slice 1 (plan engine + CLI
  dry-run) before starting Slice 2 (apply + MCP) — the boundary is a PR seam.
- Position encoding: LSP speaks UTF-16 code units; file bytes are UTF-8 —
  reuse SPEC-008's position-mapping helpers both when sending rename
  positions and when applying returned workspace-edit ranges.
- Apply pipeline order is contractual: confidence gate → span verification →
  snapshot → write → targeted re-sync → post-check → (rollback on failure).
- MCP refusals follow the ToolHandler.execute success-shaped pattern
  (NotIndexedError → textResult); PathRefusalError stays isError.
- server-instructions.ts is the single source of truth for agent-facing
  guidance — describe codegraph_rename there; do not touch installer
  instruction blocks (there are none since #529).
- CHANGELOG: one user-facing entry under ## [Unreleased] ### New Features
  (the `codegraph rename` capability); no internal paths/symbols.
- Self-repo dogfood UAT (constitution, binding): rename a real symbol in
  this repository with the new capability — plan reviewed, applied,
  post-check green, evidence recorded — then revert unless trivially safe
  to keep.
- Linux validation via Docker (`docker run --rm --init`, node:22-bookworm)
  for the apply-path suite; Windows assertions gated it.runIf and recorded
  as deferred (design concept Q10).
```

### Implementation Progress

| Phase | Tasks | Completed | Notes |
|-------|-------|-----------|-------|
| 1 - Foundation | | | |
| 2 - Slice 1: plan engine + CLI dry-run | | | |
| 3 - Slice 2: apply + MCP | | | |
| 4 - Polish & cross-cutting | | | |

---

## Post-Implementation Checklist

- [ ] All tasks marked complete in tasks.md
- [ ] Build succeeds: `npm run build`
- [ ] Tests pass: `npm test` (vitest, full suite)
- [ ] Linux suite green in Docker (`--init`)
- [ ] Control-repo A/B: no retrieval regression (≥2 runs/arm, Sonnet floor)
- [ ] Self-repo dogfood UAT evidence recorded (rename in this repo, post-check green)
- [ ] CHANGELOG entry under `## [Unreleased]`
- [ ] `server-instructions.ts` updated (and `.cursor/rules/codegraph.mdc` dogfood copy if applicable)
- [ ] PR(s) created per the 2-slice split and reviewed — no session URLs in PR bodies
- [ ] Merged to main; dogfood loop run (`npm run build`, `codegraph sync`, healthy `codegraph status`)

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
│   ├── refactor/           # NEW — rename plan/apply engine (this spec)
│   ├── lsp/                # SPEC-008 substrate: client, config, precision pass
│   ├── mcp/                # tools.ts (+codegraph_rename), server-instructions.ts
│   ├── bin/codegraph.ts    # CLI (+rename subcommand)
│   ├── db/                 # QueryBuilder + schema.sql
│   ├── index.ts            # CodeGraph class (sync for targeted re-sync)
│   └── ...
├── __tests__/              # vitest; mirrors modules; real files + real SQLite
├── docs/ai/specs/          # roadmap + .process/ workflow & design concept
└── specs/010-graph-aware-rename/  # spec.md, plan.md, tasks.md, SPEC-MOC.md
```

---

Template based on SpecKit best practices. Prompts above are populated from the
SPEC-010 roadmap scope, the Design Concept Q&A log, and the project constitution.
