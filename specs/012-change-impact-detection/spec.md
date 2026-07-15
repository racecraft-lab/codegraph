# Feature Specification: Change Impact Detection

**Feature Branch**: `012-change-impact-detection`

**Created**: 2026-07-15

**Status**: Draft

**Input**: User description: "CodeGraph needs a local-first diff-to-impact capability. Given a git diff, the feature maps changed hunks to indexed symbols, expands to bounded upstream callers and affected SPEC-011 flows, and emits stable JSON/markdown through CLI and MCP surfaces with CI-stable exit codes."

## Clarifications

### Session 2026-07-15

- Q: What is the MCP tool name and minimum input contract? → A: Use `codegraph_detect_changes` with `mode`, optional `baseRef`, `format`, `failOn`, bounds, and optional `projectPath`.
- Q: How is the JSON contract versioned? → A: Use top-level `schemaVersion: 1` and stable top-level fields `summary`, `changedSymbols`, `unmappedHunks`, `callers`, `affectedFlows`, `risks`, `warnings`, `limits`, and `exitCode`.
- Q: How should markdown output present warnings and rows? → A: Use deterministic sections: Summary, Warnings, Changed Symbols, Unmapped Hunks, Impacted Callers, Affected Flows, and Risks.
- Q: What MCP response envelope should expected conditions use? → A: Return one normal text content payload in the requested format; reserve tool errors for malformed input or operational failures.
- Q: Are unmapped hunks warnings, impacts, or diagnostics? → A: Represent them as separate diagnostics that can add warnings but never invent changed-symbol impact.
- Q: What exactly do the supported diff modes compare? → A: `unstaged` compares working tree to index, `staged` compares index to `HEAD`, `all` compares tracked staged/unstaged changes to `HEAD` and reports untracked files as diagnostics, and `base-ref` compares `HEAD` to the merge base of `baseRef` and `HEAD` while ignoring dirty local-only changes.
- Q: How should rename and move detection affect semantic impact? → A: All diff acquisition uses git rename detection; reports keep old and new paths, but pure renames or moves produce no changed-symbol impact unless content hunks intersect indexed symbols.
- Q: How should renamed files with edits or deleted files be represented? → A: Edited hunks inside renamed files map normally to the new indexed path; deleted indexed symbols map to deleted changed-symbol rows when prior spans are available, otherwise the deleted hunks are unmapped diagnostics.
- Q: How should binary, generated, unsupported, unindexed, and untracked files appear? → A: Represent them as unmapped diagnostics with reason codes and warnings; do not expand callers or flows unless a hunk maps to an indexed symbol.
- Q: When is a stale index allowed to fail strictly? → A: Not in SPEC-012 v1 default behavior; stale indexes warn and continue, while strict failures are reserved for malformed input, invalid base refs, unreadable index state, or future explicit policy outside the `failOn` threshold grammar.
- Q: What are the default caller expansion bounds? → A: Use `callerDepth: 1`, `maxCallers: 20`, and clamp user-provided caller bounds to `callerDepth` 1–3 and `maxCallers` 1–100.
- Q: What is the hub-risk definition? → A: A changed symbol is hub-like when its unique direct upstream caller count exceeds `hubCallerThreshold: 20`; hub risk is calculated before display truncation.
- Q: What is the exact `failOn` grammar? → A: `failOn` is a comma-separated policy string with tokens `callers>N` and/or `hub`, where `N` is a zero-or-positive integer; `callers>0` means any impacted caller breaches the threshold. CLI `--fail-on` and MCP `failOn` use the same grammar.
- Q: When does exit code 2 apply? → A: Exit code `2` applies only when a valid report breaches a configured `failOn` policy; it takes precedence over ordinary impact code `1` but not over true operational failures.
- Q: How is affected-flow absence represented when SPEC-011 catalogs are disabled? → A: `affectedFlows` carries a `state` matching the SPEC-011 catalog state (`disabled`, `unavailable`, `not_indexed`, `stale`, `empty`, or `available`) plus empty `items` when no flow rows can be reported.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Inspect local change impact before committing (Priority: P1)

A developer can run a local impact check against unstaged, staged, all working-tree, or base-ref changes and see which changed symbols, unmapped hunks, warnings, and output rows matter before deciding what to test or commit.

**Why this priority**: This is the minimum useful capability: it turns a diff into a concrete, reviewable impact report for humans without requiring automation or agent tooling.

**Independent Test**: Can be fully tested by preparing controlled local diffs, running the command-line surface in each supported diff mode, and verifying that the report identifies changed symbols, unmapped hunks, rename behavior, warnings, output format, and exit code.

**Acceptance Scenarios**:

1. **Given** a repository with a current index and an unstaged edit inside a known symbol, **When** the developer requests an unstaged impact report, **Then** the report lists the changed symbol and exits with the ordinary-impact code.
2. **Given** a staged change and a separate unstaged change, **When** the developer requests staged-only impact, **Then** only staged changes contribute to changed symbols and warnings.
3. **Given** a base reference with changes on the current branch, **When** the developer requests base-ref comparison, **Then** the report is based on the merge-base comparison rather than unrelated local-only state.
4. **Given** a pure file rename or move with no mapped symbol content change, **When** the report is generated, **Then** the move is represented without inventing semantic impact.

---

### User Story 2 - Let agents request bounded impact context (Priority: P2)

An AI agent can request the same change-impact information through an MCP surface and receive a bounded, success-shaped response that highlights directly changed symbols, upstream callers, affected flows when available, warnings, and risks without needing to inspect files manually.

**Why this priority**: CodeGraph's value is helping agents stop after a small number of precise tool calls. The agent-facing surface must share the same semantics as the human surface and avoid ambiguous or unbounded output.

**Independent Test**: Can be fully tested by invoking the MCP surface against controlled diffs and verifying response parity with the command-line JSON contract, bounded result counts, success-shaped expected conditions, and explicit unavailable states.

**Acceptance Scenarios**:

1. **Given** a diff that touches a symbol with upstream callers and affected flows, **When** an agent requests change impact, **Then** the response includes direct changes, bounded callers, affected flows, and risk annotations using the same meaning as the command-line report.
2. **Given** affected-flow data is disabled or unavailable, **When** an agent requests change impact, **Then** the response reports the flow-impact state explicitly without failing the tool call for an expected condition.
3. **Given** the index may be stale relative to the diff, **When** an agent requests change impact, **Then** the response includes the stale-index warning and still returns the best available local report.

---

### User Story 3 - Enforce CI thresholds for risky changes (Priority: P3)

A CI workflow or local preflight can configure risk thresholds so ordinary impacts are distinguishable from threshold breaches, allowing automation to fail only when the configured risk policy is exceeded.

**Why this priority**: CI needs stable exit codes and threshold semantics to make the feature useful for future PR automation without confusing normal impact reports with hard failures.

**Independent Test**: Can be fully tested by running controlled diffs with and without threshold options and verifying exit codes, threshold messages, risk labels, and unchanged JSON schema.

**Acceptance Scenarios**:

1. **Given** a clean diff with no reportable impact, **When** the check runs, **Then** it exits with the clean code and reports no changed-symbol impact.
2. **Given** ordinary reportable impacts that do not breach thresholds, **When** the check runs, **Then** it exits with the ordinary-impact code.
3. **Given** a configured caller-count or hub threshold is breached, **When** the check runs, **Then** it exits with the threshold-breach code and identifies the breached policy.

### Edge Cases

- The repository has no usable index: the report must explain the missing-index state and avoid pretending impact was calculated.
- The index may be stale relative to the diff: every output surface must warn and continue by default.
- A diff hunk touches no indexed symbol span: the hunk must be reported as unmapped rather than converted into a fake changed symbol.
- A file is deleted, binary, generated, unsupported, or unindexed: the report must represent the condition explicitly and preserve schema stability.
- A renamed or moved file has both a path change and content edits: pure move impact suppression must not suppress real edited hunks.
- Flow-impact data is disabled, unavailable, stale, or empty: the report must distinguish those states from "no affected flows."
- Caller expansion reaches configured bounds: the report must indicate truncation or boundedness without walking the full transitive graph.
- Git diff acquisition fails or receives an invalid base reference: the report must fail clearly without using a misleading success result.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support impact reports for `unstaged` working-tree-vs-index diffs, `staged` index-vs-`HEAD` diffs, `all` tracked staged-and-unstaged-vs-`HEAD` diffs plus untracked-file diagnostics, and `base-ref` `HEAD`-vs-merge-base comparisons.
- **FR-002**: System MUST acquire diffs with git rename and move detection enabled and preserve old path, new path, and change kind in the report model.
- **FR-003**: System MUST map changed hunks to indexed symbol spans when the index contains matching file and symbol data for the relevant old or new path.
- **FR-004**: System MUST report unmapped hunks as separate diagnostics with stable reason codes that may add warnings but never invent mapped symbol impact.
- **FR-005**: System MUST suppress phantom semantic impact for pure renames or moves that do not contain mapped content changes while still representing the path change.
- **FR-006**: System MUST preserve real mapped content changes when a rename or move also edits symbol bodies or other mapped hunks, and MUST report deleted indexed symbols when prior indexed spans are available.
- **FR-007**: System MUST warn and continue when the index may be stale relative to the requested diff; stale index detection MUST NOT trigger threshold-breach exit behavior in SPEC-012 v1.
- **FR-008**: System MUST represent missing, disabled, unavailable, binary, generated, unsupported, unindexed, deleted, or untracked data explicitly rather than silently omitting it.
- **FR-009**: System MUST expand directly changed symbols to bounded upstream callers using default `callerDepth: 1` and `maxCallers: 20`, with user-provided bounds clamped to `callerDepth` 1–3 and `maxCallers` 1–100.
- **FR-010**: System MUST include affected execution flows when flow-impact data is available and MUST report `affectedFlows.state` as `disabled`, `unavailable`, `not_indexed`, `stale`, `empty`, or `available`.
- **FR-011**: System MUST emit risk annotations for high caller count and hub-like fan-in; a hub-like symbol is one whose unique direct upstream caller count exceeds `hubCallerThreshold: 20` before display truncation.
- **FR-012**: System MUST emit a stable JSON report with top-level `schemaVersion: 1` and fields named `summary`, `changedSymbols`, `unmappedHunks`, `callers`, `affectedFlows`, `risks`, `warnings`, `limits`, and `exitCode`.
- **FR-013**: System MUST emit a readable markdown report with deterministic sections named Summary, Warnings, Changed Symbols, Unmapped Hunks, Impacted Callers, Affected Flows, and Risks.
- **FR-014**: System MUST expose command-line and MCP surfaces that share one report meaning and compatible field semantics; the MCP tool name is `codegraph_detect_changes`.
- **FR-015**: MCP expected conditions, including missing indexes, stale indexes, unmapped hunks, and unavailable flow data, MUST return one normal text content payload in the requested format rather than tool errors.
- **FR-016**: Command-line exit codes MUST distinguish clean reports (`0`), ordinary impact reports (`1`), threshold breaches (`2`), and unavailable or failed operational states through a separate non-0/1/2 failure code.
- **FR-017**: Threshold configuration MUST support caller-count and hub-risk policies through one shared `failOn` grammar: comma-separated tokens `callers>N` and/or `hub`, with `N` a zero-or-positive integer.
- **FR-018**: System MUST keep SPEC-020 PR comments, GitHub Actions wiring, REST endpoints, general git-range parsing, and cross-repository impact out of SPEC-012 scope.
- **FR-019**: System MUST provide a reproducible self-repo UAT path that proves a controlled diff end-to-end across symbol mapping, caller and flow expansion, JSON and markdown output, warnings, and exit codes.
- **FR-020**: System MUST avoid network access and hidden remote state for this feature; reports derive from local git state and local index data only.

### Reviewability Budget *(mandatory)*

- **Primary surface**: harness/adapter
- **Secondary surfaces, if any**: CLI, MCP, output contracts, analysis data model
- **Projected reviewable LOC**: 610 from the shared setup estimator; the roadmap reviewability gate warned at 405 projected reviewable LOC
- **Projected production files**: 5
- **Projected total files**: 11
- **Budget result**: warning accepted with split required if planning approaches the 800 block threshold
- **Split decision**: Two vertical slices are required: Slice 1 delivers core diff-to-symbol command-line reporting; Slice 2 adds bounded impact expansion, affected flows, agent surface, thresholds, and UAT hardening.

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order, scope budget, traceability, verification evidence, known gaps, and rollback or feature-flag notes.
- Traceability MUST map each major requirement or success criterion to changed files and verification evidence.
- Deferred work MUST name the follow-up spec or issue.

### Key Entities *(include if feature involves data)*

- **Diff Request**: A user's requested comparison mode: `unstaged` compares working tree to index, `staged` compares index to `HEAD`, `all` compares tracked staged and unstaged changes to `HEAD` while reporting untracked files as diagnostics, and `base-ref` compares `HEAD` to the merge base of `baseRef` and `HEAD`; MCP requests carry this through `mode`, optional `baseRef`, optional `format`, optional `failOn`, bounds, and optional `projectPath`.
- **Changed Hunk**: A contiguous changed range from the requested diff, including old path, new path, old/new ranges, change kind, and rename, deletion, binary, generated, unsupported, unindexed, or untracked context.
- **Changed Symbol**: An indexed symbol whose span intersects a changed hunk and can be reported as directly impacted, including modified, added, or deleted symbol rows when the relevant indexed spans are available.
- **Unmapped Hunk**: A changed hunk that cannot be associated with an indexed symbol but still matters to the report, with a stable reason code such as `no-symbol-span`, `binary`, `generated`, `unsupported`, `unindexed`, `untracked`, or `deleted-without-span`.
- **Caller Impact**: A bounded upstream caller associated with a directly changed symbol, using `callerDepth`, `maxCallers`, and truncation metadata recorded in `limits`.
- **Affected Flow**: A known execution flow that includes a changed symbol or impacted caller when flow-impact data is available; the flow envelope always includes a SPEC-011-compatible `state`.
- **Risk Annotation**: A report label indicating conditions such as high caller count, hub-like fan-in, stale index, truncation, threshold breach, or unavailable enrichment.
- **Impact Report**: The complete output shared across command-line and MCP surfaces, with stable JSON fields `summary`, `changedSymbols`, `unmappedHunks`, `callers`, `affectedFlows`, `risks`, `warnings`, `limits`, and `exitCode`, or equivalent deterministic markdown sections.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For controlled diffs touching indexed symbols, reports identify the correct directly changed symbols in `unstaged`, `staged`, `all`, and `base-ref` modes using the documented comparison semantics.
- **SC-002**: Pure renames or moves with no mapped content edits produce zero phantom changed-symbol impacts while still representing the path change.
- **SC-003**: Diffs containing unmapped hunks include those hunks in the report with no invented symbol impact.
- **SC-004**: Stale or missing index conditions are visible in JSON, markdown, and MCP outputs, and stale-index warnings do not become threshold-breach failures in SPEC-012 v1.
- **SC-005**: JSON and MCP report schemas remain stable across clean, ordinary-impact, threshold-breach, stale-index, and flow-unavailable scenarios.
- **SC-006**: Command-line exit behavior is deterministic: clean reports use `0`, ordinary impact reports use `1`, configured threshold breaches use `2`, and unavailable or failed operational states use a separate failure code.
- **SC-007**: Caller and flow expansion stays bounded on high-fan-in changes using the documented default limits, and explicitly reports truncation or risk state when limits are reached.
- **SC-008**: A reproducible self-repo UAT run demonstrates changed symbols, caller impact, affected flows, JSON output, markdown output, warnings, and exit codes together.
- **SC-009**: With no remote services configured, the feature performs zero network calls and relies only on local repository and index state.

## Assumptions

- SPEC-011 flow catalogs are available in this repository, but SPEC-012 must still represent flow-impact data as disabled or unavailable when those catalogs are absent.
- Default local and MCP behavior warns and continues on stale indexes; strict stale-index failure is outside SPEC-012 v1 unless the index is unreadable or input is invalid.
- Base-ref comparison means comparing `HEAD` against the merge base of `HEAD` and the named base reference; it ignores dirty local-only state, which remains covered by `unstaged`, `staged`, and `all`.
- The command-line and MCP surfaces share the same report model, with formatting differences only where the surface requires them.
- MCP returns the requested report format as normal text content for expected states; only malformed input or operational failures should become tool errors.
- Caller depth, caller width, and hub-risk defaults intentionally mirror existing shallow CodeGraph caller behavior: direct callers by default, 20 displayed callers, and bounded escalation only when explicitly requested.
- PR review automation belongs to SPEC-020, and cross-repository impact belongs to SPEC-022.
