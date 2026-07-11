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
| Specify | `/speckit-specify` | ⏳ Pending | |
| Clarify | `/speckit-clarify` | ⏳ Pending | 3 sessions seeded from design-concept Open Questions |
| Plan | `/speckit-plan` | ⏳ Pending | Must plan the 2-slice split explicitly |
| Checklist | `/speckit-checklist` | ⏳ Pending | api-contracts, error-handling, security, data-integrity |
| Tasks | `/speckit-tasks` | ⏳ Pending | |
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

**Constitution Check:** ⏳ (mark before proceeding to G1 — run `npm run build` and `npm test` for the G0 baseline first)

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

<!-- Fill in after running the command -->

| Metric | Value |
|--------|-------|
| Functional Requirements | |
| User Stories | |
| Acceptance Criteria | |

### Files Generated

- [ ] `specs/010-graph-aware-rename/spec.md`

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
| 1 | Confidence tiers | | |
| 2 | Apply mechanics | | |
| 3 | Surfaces & slicing | | |

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
| `plan.md` | ⏳ | Technical context, slice boundaries, execution flow |
| `research.md` | ⏳ | Decision rationales (if needed) |
| `data-model.md` | ⏳ | Plan/edit/confidence/refusal types |
| `contracts/` | ⏳ | CLI + MCP contract (shared) |
| `quickstart.md` | ⏳ | Developer onboarding |

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
| api-contracts | | | |
| error-handling | | | |
| security | | | |
| data-integrity | | | |
| **Total** | | | |

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

Setup-time context for the classifier: the accepted design-concept split (Q11)
is 2 vertical slices — expect a `split-PR` route; reconcile at G5 if the
classifier disagrees.

| Field | Value | Meaning |
|-------|-------|---------|
| **Route** | | One of `split-PR`, `one-navigable-PR`, `single-atomic-PR`, `branch-by-abstraction`, or `out-of-scope`. |
| **Releasable** | | `true`, or `false` for a destructive-migration or concurrency-sensitive change (a passing CI run does not prove such a change is safe to release). |
| **Signals** | | The decisive detector findings behind the route and releasability reading (may be empty when the classifier abstains). |
| **Warnings** | | Any release-safety warning attached to the change (empty when there is no releasability risk). |

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
