# SpecKit Workflow: SPEC-008 — LSP Client Integration

**Template Version**: 1.0.0
**Created**: 2026-07-05
**Purpose**: Prepare and execute SPEC-008 through the SpecKit workflow so CodeGraph can use installed language servers to verify and correct graph edges with compiler-accurate definition/reference data.

---

## Design Concept

This workflow file was enriched from a Grill Me interview run during
`$speckit-scaffold-spec SPEC-008`. The full Q&A log, Goals, Non-goals, and Open
Questions live at:

```text
docs/ai/specs/.process/SPEC-008-design-concept.md
docs/ai/specs/.process/language-feature-parity-baseline.md
```

Re-read it before each phase. The design concept is the source of truth for
scoping decisions captured during setup: all roadmap-listed language servers are
in scope, real-server validation is required, runtime degradation is per-language,
the implementation should be planned as three vertical PR slices, and language
plus feature parity against the internal baseline is a no-waiver gate.

> **Note:** Grill Me is human-in-the-loop only. It is not part of the autopilot
> loop. Once this workflow begins, clarifications happen via `$speckit-clarify`
> and the consensus protocol.

---

## Workflow Overview

| Phase | Command | Status | Notes |
|-------|---------|--------|-------|
| Specify | `$speckit-specify` | ⏳ Pending | Use roadmap + Design Concept decisions |
| Clarify | `$speckit-clarify` | ⏳ Pending | Focus on real-server prereqs, correction semantics, and split boundaries |
| Plan | `$speckit-plan` | ⏳ Pending | Must confirm server install/version evidence and three-slice plan |
| Checklist | `$speckit-checklist` | ⏳ Pending | Run integration, reliability, performance, and data-integrity domains |
| Tasks | `$speckit-tasks` | ⏳ Pending | Generate slice-aware tasks |
| Analyze | `$speckit-analyze` | ⏳ Pending | Check drift against Design Concept and roadmap |
| Implement | `$speckit-implement` | ⏳ Pending | TDD-first, real-server validation gate |

**Status Legend:** ⏳ Pending | 🔄 In Progress | ✅ Complete | ⚠️ Blocked

### Phase Gates

| Gate | Checkpoint | Approval Criteria |
|------|------------|-------------------|
| G1 | After Specify | Clear user stories, no `[NEEDS CLARIFICATION]` markers |
| G2 | After Clarify | LSP prereqs, correction policy, and split questions resolved |
| G3 | After Plan | Constitution gates pass; three-slice plan is explicit; language and feature parity tables have no unowned gaps |
| G4 | After Checklist | All `[Gap]` markers addressed |
| G5 | After Tasks | Task coverage and slice ordering verified |
| G6 | After Analyze | No CRITICAL/HIGH unresolved findings |
| G7 | During Implement | Tests, real-server validation, and self-repo UAT evidence pass |

---

## Prerequisites

### Constitution Validation

| Principle | Requirement | Verification |
|-----------|-------------|--------------|
| I. Think Before Coding | Clarify server prereqs, edge correction rules, and split boundaries before coding. | G1/G2 marker checks; Design Concept references in spec and plan |
| II. Simplicity First | Add only the LSP client/verification path required for SPEC-008; no LSP server facade or rename features. | Plan non-goals and Analyze drift check |
| III. Surgical Changes | New LSP code belongs under `src/lsp/`; changes to schema, CLI, config, and existing resolution stay minimal. | Diff review against declared file operations |
| IV. Goal-Driven Execution | Begin with tests for registry detection, JSON-RPC lifecycle, edge correction, and missing-server degradation. | Red/green test evidence in implementation |
| V. Deterministic, LLM-Free Extraction | LSP may verify/correct existing graph edges but never uses LLM output for graph structure. | Unit/integration tests and no network calls beyond local LSP subprocesses |
| VI. Retrieval Performance | LSP corrections must improve graph sufficiency without adding noisy duplicate edges. | Edge-count stability and callers/impact regression probes |
| VII. Local-First | Default behavior remains unchanged; LSP is opt-in and uses local subprocesses only. | `npm test`, `codegraph index` without `--lsp`, and `codegraph index --lsp` dogfood |

**Constitution Check:** ✅ Verified — G0 baseline passed with `npm run build`,
`npm run typecheck`, and `npm test` under Node 24.11.1.

---

## Specification Context

### Basic Information

| Field | Value |
|-------|-------|
| **Spec ID** | SPEC-008 |
| **Name** | LSP Client Integration |
| **Branch** | `008-lsp-client-integration` |
| **Dependencies** | None |
| **Enables** | SPEC-010 Graph-Aware Rename; compiler-accurate edges platform-wide |
| **Priority** | P0 |

### Roadmap Scope

Where a language server is installed, graph definitions/references become
compiler-accurate, with per-edge provenance and graceful per-language
degradation.

SPEC-008 owns:

- `src/lsp/servers.ts`: registry for baseline language coverage, starting from TypeScript/JavaScript, Python, Go, Rust, C/C++, Swift, Java, C#, Kotlin, PHP, Ruby, Dart, and Vue language servers; PATH probe; user config override.
- A parity disposition for every language in the internal baseline, including experimental Vue and COBOL. A language not implemented in SPEC-008 must be assigned to a concrete numbered future spec before SPEC-008 can pass final validation; backlog-only ownership is not sufficient.
- `src/lsp/client.ts`: JSON-RPC over stdio, initialize/shutdown lifecycle, per-workspace instances, timeout handling, and crash restart.
- `src/lsp/precision-pass.ts`: verify/correct/annotate existing graph edges using `textDocument/definition` and `textDocument/references`.
- `edges.provenance` use for `lsp`-verified edges, preserving existing `null` and `heuristic` behavior.
- Status reporting for per-language coverage and detected servers.
- Opt-in activation through `codegraph index --lsp` or project config; incremental verification on watch events.

### Setup Decisions

- All roadmap-listed language servers are in scope for this spec.
- Internal baseline parity is mandatory with no compromises: every reproduced language, feature, and capability row must be implemented or assigned to a concrete numbered spec before completion.
- Real-server validation is required for completion; fake-only validation is insufficient.
- Missing required server binaries fail the validation prereq check, but normal runtime degrades per language.
- User overrides live in `codegraph.json` plus environment overrides.
- Unique LSP conflicts replace/suppress the old graph target and record correction metadata.
- The spec should be planned as one spec with three vertical PR slices.
- LSP remains default-off and must be explicitly enabled for self-repo dogfooding.

### Out of Scope

- Auto-installing language servers.
- Exposing CodeGraph as an LSP server.
- Rename/refactor operations.
- Auto-enabling LSP when a server is found on `PATH`.
- Failing the whole structural index because one LSP server is unavailable.

### Success Criteria Summary

- [ ] Running without LSP remains byte-compatible for existing indexing behavior.
- [ ] `codegraph index --lsp` or config opt-in runs the precision pass for covered languages.
- [ ] Missing/crashed servers degrade per language and are surfaced in status.
- [ ] Real-server validation covers TypeScript/JavaScript, Python, Go, Rust, C/C++, Swift, Java, C#, Kotlin, PHP, Ruby, Dart, and Vue where implemented in SPEC-008.
- [ ] Language parity table covers JavaScript, TypeScript, Python, Java, C, C++, C#, Go, Ruby, Rust, PHP, Kotlin, Swift, Dart, Vue, and COBOL with no backlog-only owners.
- [ ] Feature/capability parity table covers every row in `docs/ai/specs/.process/language-feature-parity-baseline.md` with implementation evidence or concrete numbered spec ownership.
- [ ] Unique LSP conflicts correct graph targets with auditable metadata.
- [ ] Callers/impact/search behavior does not regress on non-LSP and heuristic-only repos.
- [ ] Self-repo dogfood evidence is recorded with all required servers present.

---

## Phase 1: Specify

**When to run:** At the start of the feature specification. Focus on what and why, not implementation details. Output: `specs/008-lsp-client-integration/spec.md`

### Specify Prompt

```bash
$speckit-specify

## Feature: LSP Client Integration (SPEC-008)

CodeGraph currently derives graph edges from AST extraction, framework resolvers,
and conservative heuristics. SPEC-008 adds an opt-in LSP precision pass so that,
where a real language server is installed, CodeGraph can verify definitions and
references with compiler-accurate data while keeping default behavior unchanged.

Use the roadmap section for SPEC-008, the Design Concept at
docs/ai/specs/.process/SPEC-008-design-concept.md, and the internal baseline at
docs/ai/specs/.process/language-feature-parity-baseline.md as the scope
authority.

### Required user-visible outcomes
- Users can opt into LSP precision with `codegraph index --lsp` or project config.
- Users can override language-server commands/timeouts in `codegraph.json` and by environment variables.
- `codegraph status` reports detected servers, unavailable servers, and per-language LSP coverage.
- Missing or crashed servers do not fail structural indexing at normal runtime; they degrade that language to existing graph behavior.
- Validation/completion requires real language servers for all listed languages and fails clearly when prereqs are missing.
- Validation/completion requires language and feature parity tables with no unowned gaps.

### Covered language servers
- TypeScript/JavaScript: typescript-language-server
- Python: pyright or basedpyright
- Go: gopls
- Rust: rust-analyzer
- C/C++: clangd
- Swift: SourceKit-LSP
- Java: jdtls
- C#: csharp-ls, OmniSharp/Roslyn LSP, or another concrete local LSP selected during Plan from current primary docs
- Kotlin: kotlin-language-server or another concrete local LSP selected during Plan from current primary docs
- PHP: phpactor, Intelephense, or another concrete local LSP selected during Plan from current primary docs
- Ruby: ruby-lsp, Solargraph, or another concrete local LSP selected during Plan from current primary docs
- Dart: Dart SDK language server
- Vue: Vue language server / Vue Language Tools
- COBOL: parity disposition required; if a local LSP target is not selected in SPEC-008, assign a numbered future spec and preserve parser/resolver parity evidence

### Edge and provenance behavior
- Preserve existing `null` and `heuristic` provenance semantics.
- Mark only LSP-upgraded/verified edges with `provenance: "lsp"`.
- When LSP returns a unique target that conflicts with the existing graph, replace/suppress the old target and record correction metadata.
- Do not emit speculative edges when LSP output is ambiguous.

### Scope and slicing
- Keep SPEC-008 as one spec but plan for three vertical PR slices.
- Suggested initial slices:
  1. Core LSP client/config/status plus one complete language path.
  2. Expand real-server verification and correction behavior across the next language group.
  3. Complete remaining language servers, incremental watch verification, self-repo dogfood, and final status/reporting.

### Non-goals
- Do not auto-install language servers.
- Do not expose CodeGraph as an LSP server; that is SPEC-009.
- Do not implement rename/refactor operations; that is SPEC-010.
- Do not auto-enable LSP just because a server is found on PATH.
- Do not introduce remote network calls beyond user-configured local language-server subprocesses.

### Acceptance scenarios
- A repo without `--lsp` indexes exactly as before.
- A repo with LSP enabled and all servers present records LSP coverage and corrected edges.
- A repo with LSP enabled but one missing server indexes successfully and reports that language as unverified.
- A validation run for SPEC-008 fails before completion when a required real server is missing.
- A validation run for SPEC-008 fails before completion when any baseline language lacks SPEC-008 coverage or a concrete numbered future-spec owner.
- A validation run for SPEC-008 fails before completion when any baseline feature/capability row lacks implementation evidence or concrete numbered future-spec ownership.
- A known wrong static/heuristic target is replaced only when LSP returns a unique target.
```

### Specify Results

| Metric | Value |
|--------|-------|
| Functional Requirements | 28 |
| User Stories | 4 |
| Acceptance Criteria | 14 |

### Files Generated

- [x] `specs/008-lsp-client-integration/spec.md`
- [x] `specs/008-lsp-client-integration/checklists/requirements.md`

**Gate G1:** ✅ Passed — `spec.md` exists with 0 active
`[NEEDS CLARIFICATION]` markers.

---

## Phase 2: Clarify

**When to run:** After Specify, before Plan. Maximum 5 targeted questions per session.

### Clarify Prompts

#### Session 1: Server prereqs and validation

```bash
$speckit-clarify Focus on SPEC-008 server prerequisites and validation:
- Confirm exact required binaries and acceptable alternatives for each language.
- Decide whether versions are pinned, minimum-versioned, or recorded as observed evidence.
- Define the full prereq failure message when one or more real servers are absent.
- Confirm where prereq checks live and whether they are invoked by quickstart, tests, or both.
- Preserve the Design Concept decision that real-server validation is required for completion.
- Expand prereqs to the internal parity baseline, not only the original roadmap list.
```

#### Session 1B: Language parity baseline

```bash
$speckit-clarify Focus on SPEC-008 language parity:
- Use `docs/ai/specs/.process/language-feature-parity-baseline.md` as the controlling baseline.
- Confirm the required disposition for every language: JavaScript, TypeScript, Python, Java, C, C++, C#, Go, Ruby, Rust, PHP, Kotlin, Swift, Dart, Vue, and COBOL.
- Decide which additional local LSP servers are in SPEC-008 now and which require concrete numbered follow-on specs.
- Do not accept backlog-only, undocumented, or "not in original roadmap" answers.
- Confirm how the parity table is represented in `plan.md`, `quickstart.md`, and final validation evidence.
```

#### Session 1C: Feature and capability parity baseline

```bash
$speckit-clarify Focus on SPEC-008 feature/capability parity:
- Use `docs/ai/specs/.process/language-feature-parity-baseline.md` as the controlling baseline.
- Assign every baseline capability row to implemented CodeGraph behavior, SPEC-001 through SPEC-023, SPEC-024, or a concrete numbered child spec.
- Do not accept backlog-only, undocumented, or "not in this spec" answers without a concrete numbered owner.
- Confirm how the feature/capability parity table is represented in `plan.md`, `quickstart.md`, and final validation evidence.
- Confirm that no external project name or outbound link is added to the spec artifacts.
```

#### Session 2: Edge correction and provenance

```bash
$speckit-clarify Focus on SPEC-008 edge correction semantics:
- Define when an LSP result is unique enough to replace/suppress an existing graph edge.
- Specify correction metadata fields for auditability.
- Define how `provenance: "lsp"` coexists with existing `null` and `heuristic` edges.
- Clarify how ambiguity, multi-target definitions, generated files, and external-library targets are handled.
- Confirm the status/report fields that show verified, corrected, skipped, and degraded edge counts.
```

#### Session 3: Activation, config, and slicing

```bash
$speckit-clarify Focus on SPEC-008 activation/config/slicing:
- Confirm `codegraph.json` shape and environment override names for per-language command arrays and timeouts.
- Confirm `codegraph index --lsp` and config opt-in precedence.
- Confirm how incremental watch verification is enabled and bounded.
- Refine the three vertical PR slices accepted in the Design Concept.
- Ensure no slice crosses into SPEC-009 LSP server facade or SPEC-010 rename.
```

### Clarify Results

| Session | Focus Area | Questions | Key Outcomes |
|---------|------------|-----------|--------------|
| 1 | Server prereqs and validation | ⏳ | |
| 1B | Language parity baseline | ⏳ | |
| 1C | Feature/capability parity baseline | ⏳ | |
| 2 | Edge correction and provenance | ⏳ | |
| 3 | Activation, config, and slicing | ⏳ | |

---

## Phase 3: Plan

**When to run:** After spec is finalized. Output: `specs/008-lsp-client-integration/plan.md`

### Plan Prompt

```bash
$speckit-plan

## Tech Stack
- Runtime: Node.js / TypeScript in the existing CodeGraph CLI/library architecture.
- Store: node:sqlite via the existing database layer.
- Existing graph pipeline: tree-sitter extraction, reference resolution, dynamic-dispatch synthesis, then query/context surfaces.
- Tests: vitest, real SQLite temp dirs, existing project evaluation/probe scripts when applicable.
- Config: extend existing project-scoped `codegraph.json` parsing plus environment overrides.

## Required decisions from Design Concept
- Use additive `provenance: "lsp"` only for LSP-upgraded/verified edges.
- Preserve existing `null` and `heuristic` provenance semantics.
- Cover all roadmap-listed language servers in this spec.
- Enforce internal language parity with no compromises: every baseline language must be implemented in SPEC-008 or assigned to a concrete numbered future spec; backlog-only ownership fails the gate.
- Enforce internal feature/capability parity with no compromises: every baseline capability row must have implementation evidence or concrete numbered spec ownership.
- Require real-server validation and fail prereq checks when required binaries are missing.
- Degrade normal runtime per language when servers are missing or crash.
- Use `codegraph.json` plus environment overrides for commands and timeouts.
- Replace/suppress conflicting graph targets only when LSP returns a unique target, and record correction metadata.
- Plan three vertical PR slices.

## Architecture notes
- Prefer new modules under `src/lsp/`: registry, client, precision pass, status model, and prereq helpers.
- Keep changes to `src/db/schema.sql`, migrations, `src/index.ts`, `src/bin/codegraph.ts`, `src/project-config.ts`, and MCP/status output surgical.
- Treat LSP as a local subprocess capability. No auto-install and no remote service calls.
- Ensure `codegraph index` without LSP is unchanged and covered by tests.
- For real-server validation, plan exact version/install evidence before tasks. Use official language-server docs where current facts are needed.
- Add a language parity matrix to `plan.md` and `quickstart.md` using `docs/ai/specs/.process/language-feature-parity-baseline.md` as the controlling baseline. The matrix must include owner spec, server command if applicable, validation evidence, and explicit reason for any future-spec assignment.
- Add a feature/capability parity matrix to `plan.md` and `quickstart.md`. Every row from the baseline must have an implementation owner, validation evidence, or concrete numbered follow-on spec.
- Keep spec artifacts free of external project names and outbound source links; reproduce required rows instead.
- Include self-repo dogfood: build, full test suite, index without LSP, index with LSP, status coverage, and targeted edge-correction probes.

## Tentative slices
1. Core activation/config/status + JSON-RPC client lifecycle + one complete language path.
2. Edge verification/correction policy + real-server coverage expansion for the next language group.
3. Remaining language servers + incremental watch verification + full self-repo dogfood and validation packet.

## Complexity tracking
- If real-server all-language validation pushes the implementation above reviewability budget, split into vertical PR slices or add concrete numbered follow-on specs; do not drop baseline parity coverage.
- If schema changes are needed beyond widening provenance typing and metadata, record the simpler alternative rejected.
```

### Plan Results

| Artifact | Status | Notes |
|----------|--------|-------|
| `plan.md` | ⏳ | |
| `research.md` | ⏳ | Must include language-server prereq/version evidence |
| `data-model.md` | ⏳ | LSP registry, server status, verification result, correction metadata |
| `contracts/` | ⏳ | CLI/config/status behavior and prereq contract |
| `quickstart.md` | ⏳ | Must include real-server install/prereq check and self-repo dogfood |

---

## Phase 4: Domain Checklists

**When to run:** After Plan, validating spec and plan together.

### Recommended Domains

#### 1. Integration Checklist

Real language servers, subprocess lifecycle, PATH probing, and project/env configuration are the highest integration risks.

```bash
$speckit-checklist integration

Focus on SPEC-008 LSP Client Integration requirements:
- Language-server registry entries for TypeScript/JavaScript, Python, Go, Rust, C/C++, Swift, and Java.
- Baseline registry/disposition entries for C#, Kotlin, PHP, Ruby, Dart, Vue, and COBOL.
- Feature/capability parity entries from `docs/ai/specs/.process/language-feature-parity-baseline.md`.
- PATH probing, `codegraph.json` overrides, environment overrides, and timeout precedence.
- JSON-RPC initialize/shutdown lifecycle and crash/restart behavior.
- Real-server validation prereq checks and operator-facing missing-binary messages.
- Pay special attention to: no auto-install and no remote service dependency.
```

#### 2. Reliability Checklist

The feature must degrade by language without corrupting the base graph or failing normal indexing.

```bash
$speckit-checklist reliability

Focus on SPEC-008 LSP Client Integration requirements:
- Per-language degradation when a server is missing, times out, returns malformed data, or crashes.
- Status reporting for detected, unavailable, verified, corrected, skipped, and degraded language coverage.
- Incremental watch verification bounds and restart/backoff behavior.
- Preservation of non-LSP indexing behavior.
- Pay special attention to: failure isolation so one broken server never invalidates the entire structural index.
```

#### 3. Data Integrity Checklist

The correctness risk is in replacing/suppressing graph edges based on LSP output.

```bash
$speckit-checklist data-integrity

Focus on SPEC-008 LSP Client Integration requirements:
- Unique-target rules before replacing/suppressing existing graph edges.
- `provenance: "lsp"` semantics and correction metadata schema.
- Ambiguous, generated, external-library, and multi-definition LSP responses.
- Node/edge count stability and duplicate-edge prevention.
- Pay special attention to: avoiding noisy duplicate edges that degrade callers/impact.
```

#### 4. Performance Checklist

The LSP pass must stay opt-in and bounded.

```bash
$speckit-checklist performance

Focus on SPEC-008 LSP Client Integration requirements:
- Timeout budgets, concurrency limits, and per-language work caps.
- Index-time overhead when `--lsp` is enabled.
- Zero overhead when LSP is disabled.
- Incremental verification on watch events.
- Pay special attention to: large-repo behavior and no regression to retrieval tool sufficiency.
```

### Checklist Results

| Checklist | Items | Gaps | Spec References |
|-----------|-------|------|-----------------|
| integration | ⏳ | | |
| reliability | ⏳ | | |
| data-integrity | ⏳ | | |
| performance | ⏳ | | |
| **Total** | ⏳ | | |

---

## Phase 5: Tasks

**When to run:** After checklists complete and all gaps are resolved. Output: `specs/008-lsp-client-integration/tasks.md`

### Tasks Prompt

```bash
$speckit-tasks

Generate tasks for SPEC-008 LSP Client Integration.

Read:
- `specs/008-lsp-client-integration/spec.md`
- `specs/008-lsp-client-integration/plan.md`
- `docs/ai/specs/.process/SPEC-008-design-concept.md`
- `docs/ai/specs/.process/language-feature-parity-baseline.md`

Task structure requirements:
- TDD-first: tests before implementation for registry detection, config precedence, JSON-RPC lifecycle, edge verification/correction, missing-server degradation, and status reporting.
- Preserve default-off behavior: include tests proving non-LSP indexing is unchanged.
- Keep the three vertical PR slices explicit and reviewable.
- Include real-server prereq and validation tasks for all listed language servers.
- Include language parity tasks with no unowned gaps; any future-spec assignments must name the spec number and validation boundary.
- Include feature/capability parity tasks for every baseline row; any future-spec assignments must name the spec number and validation boundary.
- Include self-repo dogfood tasks using explicit LSP opt-in.
- Do not add auto-install tasks, LSP server facade tasks, or rename/refactor tasks.

Suggested implementation phases:
1. Foundation: config/status types, provenance typing, registry contracts, prereq check contract.
2. Slice 1: core JSON-RPC client lifecycle, activation plumbing, status output, one complete language path.
3. Slice 2: edge verification/correction and real-server validation for the next language group.
4. Slice 3: remaining language servers, incremental watch verification, self-repo dogfood, docs, and final packet.
5. Polish: regression probes, README/CHANGELOG if required, final reviewability and validation.
```

### Tasks Results

| Metric | Value |
|--------|-------|
| **Total Tasks** | ⏳ |
| **Phases** | ⏳ |
| **Parallel Opportunities** | ⏳ |
| **User Stories Covered** | ⏳ |

---

## Atomicity Route

**When this is filled:** After the Tasks phase / gate G5, the autopilot skill runs
the read-only atomicity classifier and records its decision here.

| Field | Value | Meaning |
|-------|-------|---------|
| **Route** | ⏳ | One of `split-PR`, `one-navigable-PR`, `single-atomic-PR`, `branch-by-abstraction`, or `out-of-scope`. |
| **Releasable** | ⏳ | `true` or `false`. |
| **Signals** | ⏳ | Decisive detector findings. |
| **Warnings** | ⏳ | Release-safety warnings. |

To produce the decision, run the classifier against the feature directory:

```bash
bash speckit-pro/skills/speckit-autopilot/scripts/atomicity-route.sh specs/008-lsp-client-integration
```

---

## Phase 6: Analyze

**When to run:** Always run after generating tasks.

### Analyze Prompt

```bash
$speckit-analyze

Analyze SPEC-008 artifacts for consistency:
- `docs/ai/specs/.process/SPEC-008-design-concept.md`
- `docs/ai/specs/.process/language-feature-parity-baseline.md`
- `specs/008-lsp-client-integration/spec.md`
- `specs/008-lsp-client-integration/plan.md`
- `specs/008-lsp-client-integration/tasks.md`
- Domain checklists under `specs/008-lsp-client-integration/checklists/`

Focus on:
1. Drift from Design Concept decisions: all languages now, real-server validation required, per-language runtime degradation, additive `lsp` provenance, unique-target correction, three vertical slices, opt-in activation.
2. Constitution alignment: local-first subprocesses only, no auto-install, no default behavior change, surgical upstream diffs.
3. Coverage gaps: every FR and user story must have tasks, tests, and validation evidence.
4. Reviewability: tasks must preserve the three-slice plan or justify a safer route.
5. Validation feasibility: real-server prereq checks must fail early and name missing binaries.
6. Language parity: JavaScript, TypeScript, Python, Java, C, C++, C#, Go, Ruby, Rust, PHP, Kotlin, Swift, Dart, Vue, and COBOL must have SPEC-008 coverage or concrete numbered future-spec ownership.
7. Feature/capability parity: every row in `docs/ai/specs/.process/language-feature-parity-baseline.md` must have implementation evidence or concrete numbered future-spec ownership.

Flag any mismatch as HIGH or CRITICAL if it could cause an implementation to ship a partial LSP path, duplicate noisy edges, or cross into SPEC-009/SPEC-010 scope.
```

### Analysis Results

| ID | Severity | Issue | Resolution |
|----|----------|-------|------------|
| ⏳ | | | |

---

## Phase 6.5: Confidence Gate

Run the strict pre-Implement confidence gate after Analyze and before Implement.

### Pre-Implement Confidence Emit

⏳ Pending. Phase 6 Analyze must emit confidence scores before this gate runs.

| Phase | Gate | Status | Notes |
|-------|------|--------|-------|
| Confidence Gate | G6.5 | ⏳ Pending | Mode: strict |
| G6.5 | Confidence Gate | ⏳ Pending | Awaiting Phase 6 confidence emit |

---

## Phase 7: Implement

**When to run:** After tasks.md is generated and analyzed with no blocking coverage gaps.

### Implement Prompt

```bash
$speckit-implement

Implement SPEC-008 with TDD-first discipline.

Before starting:
1. Re-read `docs/ai/specs/.process/SPEC-008-design-concept.md`.
2. Verify you are on `008-lsp-client-integration`.
3. Run `npm run build` and `npm test`.
4. Run or create the real-language-server prereq check and stop if required servers are missing.
5. Verify the language parity matrix has no unowned gaps.
6. Verify the feature/capability parity matrix has no unowned gaps.

Implementation rules:
- New LSP code belongs under `src/lsp/` where possible.
- Keep LSP default-off. Non-LSP indexing behavior must stay unchanged.
- Preserve existing `null` and `heuristic` provenance semantics; use `lsp` only for LSP-upgraded/verified edges.
- Replace/suppress conflicting graph targets only for unique LSP results and record correction metadata.
- Normal runtime degrades per language on missing/crashed servers.
- Do not add auto-install, LSP server facade, or rename/refactor behavior.
- Keep the three vertical PR slices reviewable and update workflow progress after each slice.

Verification expected before completion:
- `npm run build`
- `npm run typecheck`
- `npm test`
- Real-server validation for TypeScript/JavaScript, Python, Go, Rust, C/C++, Swift, Java, C#, Kotlin, PHP, Ruby, Dart, and Vue where covered in SPEC-008.
- Language parity validation for JavaScript, TypeScript, Python, Java, C, C++, C#, Go, Ruby, Rust, PHP, Kotlin, Swift, Dart, Vue, and COBOL with no backlog-only dispositions.
- Feature/capability parity validation for every baseline row with no backlog-only dispositions.
- Self-repo dogfood with LSP explicitly enabled.
- Status output shows coverage/degradation accurately.
- Regression checks prove non-LSP indexing remains unchanged.
```

### Implementation Progress

| Phase | Tasks | Completed | Notes |
|-------|-------|-----------|-------|
| Slice 1 - Core client/config/status + first complete language path | ⏳ | | |
| Slice 2 - Edge correction + middle language expansion | ⏳ | | |
| Slice 3 - Remaining servers + watch/status/dogfood | ⏳ | | |
| Polish - Docs, validation packet, final gates | ⏳ | | |

---

## Post-Implementation Checklist

| Phase | Item | Status | Notes |
|-------|------|--------|-------|
| Post | Post: Doctor Extension Check | ⏳ Pending | Doctor extension availability to be checked |
| Post | Post: Verify Implementation | ⏳ Pending | Verify extension is installed |
| Post | Post: Verify Tasks Phantom Check | ⏳ Pending | Verify-tasks extension is installed |
| Post | Post: Code Review | ⏳ Pending | Built-in post-implementation review |
| Post | Post: Integration Suite | ⏳ Pending | Full repo verification after implementation |
| Post | Post: Reviewability Diff Gate | ⏳ Pending | Final reviewability backstop |
| Post | Post: Self-Review | ⏳ Pending | Four-question audit before PR body |
| Post | Post: UAT Runbook Generation | ⏳ Pending | Generate and author runbook |
| Post | Post: PR Body Generation | ⏳ Pending | Generate and validate PR packet/body |
| Post | Post: PR Creation | ⏳ Pending | Open PR after passing packet validation |
| Post | Post: Review Remediation | ⏳ Pending | Monitor and resolve review comments |
| Post | Post: Retrospective | ⏳ Pending | Final retrospective artifact |

- [ ] All tasks marked complete in `specs/008-lsp-client-integration/tasks.md`
- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Real-server validation passes for all required language servers
- [ ] Language parity table has no unowned or backlog-only gaps
- [ ] Feature/capability parity table has no unowned or backlog-only gaps
- [ ] Self-repo LSP dogfood evidence recorded
- [ ] Non-LSP indexing regression evidence recorded
- [ ] Final reviewability gate passes
- [ ] PR packet generated and validated

---

## Project Structure Reference

```text
codegraph/
├── src/lsp/                         # New SPEC-008 LSP modules
├── src/db/schema.sql                # Existing graph schema
├── src/db/migrations.ts             # Schema migrations
├── src/project-config.ts            # Project-scoped config parsing
├── src/bin/codegraph.ts             # CLI activation/status wiring
├── src/index.ts                     # Library indexing/sync integration
├── __tests__/                       # Vitest tests
├── docs/ai/specs/.process/          # Scaffold workflow and design concept
└── specs/008-lsp-client-integration # SpecKit contract artifacts
```

---

Template based on SpecKit workflow-template.md, populated for SPEC-008 from the roadmap and Grill Me design concept.
