# Feature Specification: LSP Client Integration

**Feature Branch**: `008-lsp-client-integration`

**Created**: 2026-07-05

**Status**: Draft

**Input**: User description: "SPEC-008 adds opt-in language-server precision so installed local language servers can verify and correct graph definitions and references while default indexing remains unchanged."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Opt into compiler-accurate graph precision (Priority: P1)

As a CodeGraph user, I want to explicitly enable language-server precision for a project so graph definitions and references can be verified without changing default indexing for projects that do not opt in.

**Why this priority**: This is the core user value: stronger graph accuracy while preserving the existing structural indexing behavior by default.

**Independent Test**: Can be tested by indexing the same project with and without LSP precision enabled and confirming that only the opted-in run records LSP coverage and verified/corrected edges.

**Acceptance Scenarios**:

1. **Given** a repository where LSP precision is not enabled, **When** the user runs normal indexing, **Then** the repository indexes exactly as it did before SPEC-008 with no LSP-only coverage or provenance changes.
2. **Given** a repository with LSP precision enabled and all required local servers available, **When** indexing completes, **Then** the run records per-language LSP coverage and any corrected graph edges.
3. **Given** a project-level LSP opt-in setting, **When** the user runs indexing without an explicit command-line LSP flag, **Then** the precision pass runs according to that project setting.

---

### User Story 2 - Configure local language-server behavior (Priority: P2)

As a user running CodeGraph across different machines and projects, I want repeatable project LSP settings and machine-local command overrides so LSP precision can work with local toolchain layouts without requiring CodeGraph to install anything.

**Why this priority**: LSP precision depends on user-managed local server binaries. Configuration must be repeatable for projects and overridable for individual machines.

**Independent Test**: Can be tested by providing project configuration and machine-local environment overrides, then verifying that status and indexing use selected environment commands and project or environment timeout values.

**Acceptance Scenarios**:

1. **Given** a project configuration that overrides a language-server timeout, **When** LSP precision is enabled, **Then** CodeGraph uses the configured timeout for that project.
2. **Given** machine-local environment overrides for a language-server command or timeout, **When** LSP precision is enabled, **Then** those overrides apply to the current run without modifying project configuration.
3. **Given** no LSP opt-in setting, **When** a supported server is present on the user's machine, **Then** CodeGraph does not auto-enable LSP precision.

---

### User Story 3 - Understand LSP availability and graceful degradation (Priority: P2)

As a user, I want status output to explain which languages were verified, which servers were unavailable, and where CodeGraph fell back to existing graph behavior so I can trust the index without debugging hidden failures.

**Why this priority**: Missing or unstable local servers are expected in normal use. The product must degrade visibly by language instead of failing the entire structural index.

**Independent Test**: Can be tested by enabling LSP precision in a mixed-language repository while one configured server is missing or forced to fail, then confirming indexing succeeds and status reports the unavailable language.

**Acceptance Scenarios**:

1. **Given** LSP precision is enabled and one relevant server is missing, **When** the user indexes the repository, **Then** structural indexing succeeds and that language is reported as unverified.
2. **Given** LSP precision is enabled and one relevant server crashes or times out, **When** the user indexes the repository, **Then** other covered languages may still be verified and the failed language degrades to existing graph behavior.
3. **Given** a completed index, **When** the user checks status, **Then** status reports detected servers, unavailable servers, and per-language LSP coverage.

---

### User Story 4 - Complete SPEC-008 with no unowned parity gaps (Priority: P3)

As a maintainer, I want SPEC-008 validation to prove real-server coverage and internal parity ownership so the project cannot claim LSP precision while leaving baseline language or capability gaps unowned.

**Why this priority**: The feature is broad enough to require an explicit completion gate. This protects reviewability and prevents backlog-only parity claims.

**Independent Test**: Can be tested by running the SPEC-008 validation path with missing prerequisites, missing language ownership, and missing capability-row ownership and confirming each case fails before completion with a clear reason.

**Acceptance Scenarios**:

1. **Given** a SPEC-008 validation run where a required real local language server is absent, **When** validation starts, **Then** validation fails before completion with the missing prerequisite named clearly.
2. **Given** a SPEC-008 validation run where any internal baseline language lacks SPEC-008 coverage or concrete numbered future-spec ownership, **When** validation checks the language table, **Then** validation fails before completion.
3. **Given** a SPEC-008 validation run where any baseline feature or capability row lacks implementation evidence or concrete numbered future-spec ownership, **When** validation checks the capability table, **Then** validation fails before completion.
4. **Given** a known wrong static or heuristic graph target and a unique LSP target for the same reference, **When** LSP precision verifies that reference, **Then** the old target is replaced or suppressed and correction metadata is recorded.
5. **Given** ambiguous LSP output for a reference, **When** LSP precision evaluates that output, **Then** no speculative replacement edge is emitted.

### Edge Cases

- LSP precision is enabled for a repository that contains no files for one or more supported languages.
- A language server is present on the machine but unavailable through the configured command.
- A language server starts successfully but crashes, hangs, or exceeds the configured timeout during verification.
- Project configuration and environment overrides both provide values for the same language.
- LSP returns multiple possible definitions or references for the same graph edge.
- LSP returns a unique target that conflicts with an existing static or heuristic target.
- A baseline language has parser/resolver support but no concrete LSP target selected for SPEC-008.
- A baseline feature or capability row is not implemented by SPEC-008 and lacks concrete numbered future-spec ownership.
- Incremental watch verification runs while one covered language is temporarily unavailable.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: CodeGraph MUST keep LSP precision disabled unless the user explicitly opts in through the command line or project configuration.
- **FR-002**: CodeGraph MUST preserve existing structural indexing behavior for repositories that do not opt into LSP precision.
- **FR-003**: Users MUST be able to enable LSP precision for an indexing run with `codegraph index --lsp`.
- **FR-004**: Users MUST be able to enable LSP precision through project configuration for repeatable project use.
- **FR-005**: Users MUST be able to override LSP activation, default timeouts, watch behavior, and per-language timeouts through project configuration.
- **FR-006**: Users MUST be able to override language-server commands and timeouts through environment variables for machine-local use.
- **FR-007**: CodeGraph MUST detect and report available and unavailable local language servers for the languages covered by SPEC-008.
- **FR-008**: `codegraph status` MUST report detected servers, unavailable servers, and per-language LSP coverage for the current project.
- **FR-009**: Missing, crashed, or timed-out language servers MUST NOT fail normal structural indexing; the affected language MUST degrade to existing graph behavior and be reported as unverified.
- **FR-010**: SPEC-008 validation/completion MUST require real local language-server validation for all languages selected for SPEC-008 coverage.
- **FR-011**: SPEC-008 validation/completion MUST fail clearly when any required real local language server is missing.
- **FR-012**: SPEC-008 planning and validation MUST include a language parity table covering the internal parity baseline's reproduced language matrix and additional baseline language rows.
- **FR-013**: Every baseline language row MUST have SPEC-008 coverage or concrete numbered future-spec ownership before SPEC-008 completion can pass.
- **FR-014**: SPEC-008 planning and validation MUST include a feature and capability parity table covering every baseline capability row.
- **FR-015**: Every baseline feature or capability row MUST have implementation evidence or concrete numbered future-spec ownership before SPEC-008 completion can pass.
- **FR-016**: CodeGraph MUST preserve existing `null` and `heuristic` provenance semantics for graph edges that are not LSP-upgraded or LSP-verified.
- **FR-017**: CodeGraph MUST mark only LSP-upgraded or LSP-verified edges with `provenance: "lsp"`.
- **FR-018**: When LSP returns a unique target that conflicts with an existing graph target, CodeGraph MUST replace or suppress the old target and record correction metadata.
- **FR-018a**: Correction metadata MUST record the replaced or suppressed edge's previous provenance, previous target, LSP target, and correction reason; suppressed edges MUST NOT remain active solely to preserve audit history.
- **FR-019**: When LSP output is ambiguous, CodeGraph MUST NOT emit speculative replacement edges.
- **FR-020**: CodeGraph MUST NOT auto-install language servers.
- **FR-021**: CodeGraph MUST NOT auto-enable LSP precision only because a language server is found on the user's machine.
- **FR-022**: CodeGraph MUST NOT expose CodeGraph itself as an LSP server as part of SPEC-008.
- **FR-023**: CodeGraph MUST NOT include rename or refactor operations as part of SPEC-008.
- **FR-024**: CodeGraph MUST NOT introduce remote network calls beyond user-configured local language-server subprocesses.
- **FR-025**: SPEC-008 MUST remain one feature specification planned as three vertical review slices.
- **FR-026**: The covered server set MUST include the full internal baseline prerequisite matrix: TypeScript, TSX, JavaScript, and JSX via `typescript-language-server --stdio`; Python via `pyright-langserver --stdio` or `basedpyright-langserver --stdio`; Go via `gopls`; Rust via `rust-analyzer`; C/C++ via `clangd`; Swift via `sourcekit-lsp`; Java via `jdtls -configuration <dir> -data <workspace-data>` or an equivalent configured JDT LS Java command; C# via `csharp-ls`; Kotlin via `kotlin-language-server` or `kotlin-lsp`; PHP via `intelephense --stdio` or `phpactor language-server`; Ruby via `ruby-lsp` or `solargraph stdio`; Dart via `dart language-server`; Vue via `vue-language-server --stdio`; and a COBOL parity disposition.
- **FR-027**: If COBOL is not assigned to a concrete local LSP target in SPEC-008, SPEC-008 MUST assign it to a concrete numbered future spec and preserve parser/resolver parity evidence.
- **FR-028**: Incremental watch behavior MUST verify changed files with LSP precision when LSP is explicitly enabled and the relevant server is available.
- **FR-029**: LSP target uniqueness MUST be based on exactly one normalized semantic target after normalizing `Location` and `LocationLink` responses and deduplicating equivalent target ranges.
- **FR-030**: In-workspace LSP corrections MUST require exactly one compatible CodeGraph node for the normalized target; external or unindexed LSP targets MAY suppress a conflicting active edge with audit metadata but MUST NOT create external graph nodes.
- **FR-031**: Status output MUST include LSP precision state for human and JSON output: enabled state, last run, server availability, observed versions, per-language file coverage, and aggregate edge counts for checked, verified, corrected, suppressed, skipped-by-reason, and degraded.
- **FR-031a**: Human and JSON status MUST include stable machine-readable reason codes and short human-readable detail for every unavailable, skipped, degraded, not-present, not-applicable, and validation-only LSP condition. Required reason categories MUST distinguish missing default command, configured command unavailable, server crash, initialize timeout, request timeout, malformed protocol response, shutdown failure, absent or unbounded watch changed-file set, oversized watch changed-file batch, language not present, language not applicable, and missing real-server prerequisite that applies only to SPEC-008 validation. Command-related reasons MUST include the selected argv and expected alternatives when relevant, and version fields remain observational evidence rather than normal runtime success criteria.
- **FR-032**: Project configuration MUST use a top-level `lsp` object with `enabled`, `defaultTimeoutMs`, optional `watch.enabled`, and `servers.<language>.timeoutMs` entries keyed by CodeGraph language id. Committed `servers.<language>.command` values MUST be ignored with a warning; command argv overrides are machine-local environment only.
- **FR-033**: Environment overrides MUST use `CODEGRAPH_LSP_<LANG>_COMMAND_JSON`, `CODEGRAPH_LSP_<LANG>_TIMEOUT_MS`, and `CODEGRAPH_LSP_TIMEOUT_MS`; command JSON MUST parse to a string array, invalid values MUST warn and fall back, and environment variables MUST NOT activate LSP precision by themselves.
- **FR-034**: Effective activation precedence MUST be explicit CLI flag first, then `codegraph.json.lsp.enabled === true`, then default off; the CLI MUST support disabling LSP for one run even when project config opts in.
- **FR-035**: Incremental watch LSP verification MUST reuse the existing sync/watch path, run only after normal sync/reference resolution, process only bounded changed-file sets, and skip with a recorded reason when no bounded changed-file list is available.
- **FR-035a**: Incremental watch LSP verification MUST enforce measurable default work bounds before issuing LSP requests: at most 100 changed source files per bounded watch batch and at most 1,000 candidate LSP work items per language per batch. If the changed-file set is absent, unbounded, or any bound is exceeded, LSP watch verification MUST skip that batch or affected language with a recorded reason and MUST NOT fall back to a repository-wide LSP pass.
- **FR-036**: Language-server command selection MUST use this order: valid environment command override, then registry default or accepted alternatives in listed order. A valid environment-configured argv that cannot be resolved MUST report that language as unavailable and MUST NOT silently fall through to lower-precedence registry alternatives.
- **FR-037**: Command probing MUST resolve bare executables through the current process `PATH`; absolute or relative argv paths MUST be used as configured. Status and validation MUST report the selected argv, resolved executable path when available, unavailable-command state when resolution fails, and expected command alternatives.
- **FR-038**: Runtime and watch verification MUST use bounded server recovery. A crash, initialize timeout, request timeout, malformed protocol response, or shutdown failure MUST NOT fail normal structural indexing; at most one fresh session restart MAY be attempted per language per run or bounded watch batch before marking that language degraded with a recorded reason.
- **FR-038a**: Watch-mode server recovery MUST be keyed to the bounded watch batch, not to every file-watch debounce cycle. After the one allowed fresh-session restart for a language is exhausted, repeated debounce cycles for the same still-pending failed changed-file set MUST keep that language degraded and MUST NOT spawn additional server restarts; the restart budget MAY reset only for an explicit index or sync command, or for a materially new bounded watch batch with a changed-file set different from the failed batch.
- **FR-039**: LSP correction MUST leave at most one active graph edge for a single semantic reference identity, defined for the LSP work item by source node, edge kind, reference document URI, reference line/character or origin range, and normalized reference name when available. A corrected edge MUST NOT remain active beside the old static or heuristic target for that same semantic reference.
- **FR-040**: For a unique in-workspace LSP target that resolves to exactly one compatible CodeGraph node, CodeGraph MUST either retarget the existing active edge or retire the old active edge and insert one replacement edge, but the post-correction graph MUST contain exactly one active edge for that semantic reference. For unique generated, external, or unindexed targets, CodeGraph MUST suppress the conflicting active edge and MUST NOT create a replacement active edge or external graph node.
- **FR-041**: Suppressed edge history kept for audit MUST be inactive graph data. Suppressed audit records or inactive edge rows MUST be excluded from traversal, callers, callees, impact, search, and flow-building surfaces by default, and may appear only in status, debug, or audit output.
- **FR-042**: When LSP precision is disabled for an index, sync, or watch-triggered sync path, CodeGraph MUST perform zero LSP runtime work: no language-server command probing, no language-server subprocess startup, no JSON-RPC messages, no LSP coverage/correction/audit status writes, and no LSP-only graph mutations. Disabled-path validation MUST prove unchanged graph behavior and provenance semantics plus zero observed LSP runtime operations.
- **FR-043**: LSP-enabled full indexing MUST enforce measurable default per-language work bounds before issuing LSP requests: at most 2,000 source files and at most 10,000 candidate LSP work items per language per full-index run, processed in batches of at most 250 work items. If either bound is exceeded, CodeGraph MUST skip the excess LSP work for that language with a recorded reason, preserve structural indexing results, and MUST NOT replace the skipped work with an unbounded repository-wide LSP pass.
- **FR-044**: LSP-enabled runtime MUST enforce language-server concurrency limits: at most two language-server sessions may be active at once for one project, and at most eight definition/reference requests may be in flight per language-server session. Session initialize and shutdown MUST remain bounded by the effective timeout/retry policy, and stdout/stderr pipes MUST be drained while the subprocess is alive.
- **FR-045**: LSP-enabled indexing, sync, and watch verification MUST record performance evidence for each run: structural-index elapsed time, LSP precision-pass elapsed time, enabled-overhead ratio when a comparable non-LSP baseline exists, per-language source-file counts, candidate work-item counts, checked/skipped/degraded counts, cap-exceeded reasons, active session concurrency, and peak in-flight request count.
- **FR-046**: LSP-enabled corrections and suppressions MUST NOT regress retrieval tool sufficiency. Validation MUST include targeted probes for `codegraph_explore`, callers, callees, impact, search, and flow-building surfaces, using the existing repo-size explore-call budget and proving that suppressed audit-only data remains absent from default retrieval outputs.
- **FR-047**: SPEC-008 validation MUST include large-repo performance behavior for representative small, medium, and large repositories or fixtures. Large-repo evidence MUST show bounded completion or deterministic per-language skip/degrade reasons under the default work and concurrency caps, with no unbounded LSP pass, no duplicate active-edge growth, and no retrieval sufficiency regression.

### Server Prerequisite Matrix

| Language | Required validation command or disposition | SPEC-008 validation rule |
|---|---|---|
| TypeScript / TSX / JavaScript / JSX | `typescript-language-server --stdio`; validate TypeScript SDK availability | Real-server validation required |
| Python | `pyright-langserver --stdio` or `basedpyright-langserver --stdio` | Real-server validation required |
| Go | `gopls` | Real-server validation required |
| Rust | `rust-analyzer` | Real-server validation required |
| C / C++ | `clangd` | Real-server validation required |
| Swift | `sourcekit-lsp` | Real-server validation required |
| Java | `jdtls -configuration <dir> -data <workspace-data>` or equivalent configured JDT LS Java command | Real-server validation required |
| C# | `csharp-ls` | Real-server validation required |
| Kotlin | `kotlin-language-server` or `kotlin-lsp` | Real-server validation required |
| PHP | `intelephense --stdio` or `phpactor language-server` | Real-server validation required |
| Ruby | `ruby-lsp` or `solargraph stdio` | Real-server validation required |
| Dart | `dart language-server` | Real-server validation required |
| Vue | `vue-language-server --stdio`, with TypeScript SDK evidence and `--tsdk` when required | Real-server validation required |
| COBOL | No SPEC-008 LSP server selected unless Plan deliberately chooses one | Parser/resolver parity evidence plus concrete numbered future-spec ownership required if no local LSP target is selected |

Validation MUST record observed server versions and upstream minimum runtime
requirements as evidence. It MUST NOT pin exact versions in the specification
unless a server's own minimum runtime requirement makes a lower version invalid.

Missing-prerequisite validation failures MUST use this message shape:
`SPEC-008 real-server validation prerequisites failed. Missing required local
language servers: <language>: expected <command or alternatives>. Install the
server or configure codegraph.json/environment overrides. Normal codegraph index
--lsp still degrades per language; this failure applies only to SPEC-008
validation.`

### Reviewability Budget *(mandatory)*

- **Primary surface**: harness/adapter
- **Secondary surfaces, if any**: CLI, project configuration, status reporting, graph provenance, validation docs/process
- **Projected reviewable LOC**: 565 net-new LOC from roadmap estimate, excluding generated, lock, or vendor artifacts
- **Projected production files**: Approximately 7
- **Projected total files**: Approximately 14
- **Budget result**: warning accepted after parity expansion
- **Split decision**: Remain one spec, planned as three vertical PR slices: core client/config/status plus one complete language path; expanded real-server verification and correction behavior across the next language group; remaining servers, incremental watch verification, self-repo dogfood, and final status/reporting. Any remaining parity work must name concrete numbered future specs, not backlog-only ownership.

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order,
  scope budget, traceability, verification evidence, known gaps, and rollback
  or feature-flag notes.
- Traceability MUST map each major requirement or success criterion to changed
  files and verification evidence.
- Deferred work MUST name the follow-up spec or issue.

### Key Entities *(include if feature involves data)*

- **LSP Precision Setting**: The user-visible opt-in state that determines whether language-server verification runs for a project or indexing command.
- **Language Server Configuration**: User-provided timeout and command choices for a language, including project per-language timeouts and machine-local environment command/timeout override values. Committed project command argv values are ignored with a warning.
- **Server Availability Record**: The detected status for a language server, including available, unavailable, crashed, timed out, or not applicable for the current project.
- **Language Coverage Record**: The per-language result describing whether files for that language were verified, degraded, or not present.
- **Edge Verification Record**: The result of verifying an existing graph edge, including unchanged, upgraded, corrected, suppressed, or ambiguous.
- **Correction Metadata**: Audit information explaining why a previous graph target was replaced or suppressed by a unique LSP result, including previous target, new target when present, previous provenance, reason, language, server, and timestamp.
- **LSP Performance Record**: Runtime evidence for a disabled or LSP-enabled run, including elapsed time, effective work caps, per-language work counts, skip/degrade reasons, session concurrency, request concurrency, and observed zero-work proof for disabled paths.
- **Language Parity Row**: A baseline language row with SPEC-008 coverage status or concrete numbered future-spec ownership.
- **Capability Parity Row**: A baseline feature or capability row with implementation evidence or concrete numbered future-spec ownership.

Only active edges whose target was explicitly verified or corrected by the LSP
pass are marked `provenance: "lsp"`. Existing static/null and heuristic edges
that LSP does not verify remain unchanged. Corrected or suppressed edges record
previous provenance and target details in correction metadata or an audit record.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In non-opted-in test projects, 100% of indexing runs produce the same graph behavior and provenance semantics as the pre-SPEC-008 structural index.
- **SC-002**: In fully provisioned validation projects, 100% of SPEC-008-covered languages report LSP availability and per-language coverage in status.
- **SC-003**: In missing-server and crashed-server runtime scenarios, 100% of structural indexing runs complete successfully while reporting the affected language as unverified.
- **SC-004**: In prereq validation scenarios, 100% of missing required real local servers fail validation before completion with a clear missing-prerequisite message.
- **SC-005**: In parity validation scenarios, 100% of unowned baseline language rows and baseline capability rows fail validation before completion.
- **SC-006**: In edge-correction fixtures with a unique LSP target, 100% of known wrong static or heuristic targets are replaced or suppressed with correction metadata.
- **SC-007**: In ambiguous LSP fixtures, 0 speculative replacement edges are emitted.
- **SC-008**: The final SPEC-008 review packet includes a language parity table and a feature/capability parity table with 0 unowned gaps.
- **SC-009**: The final SPEC-008 validation evidence covers all three vertical PR slices and records self-repo dogfood results with LSP explicitly enabled.
- **SC-010**: In correction and suppression fixtures, 100% of LSP-processed semantic references leave 0 duplicate active edges, 0 suppressed audit-only records visible through traversal/callers/callees/impact/search surfaces, and node/edge-count deltas that match only the expected correction or suppression action.
- **SC-011**: In disabled-path index, sync, and watch-triggered sync fixtures, 100% of runs record zero LSP command probes, zero LSP subprocess starts, zero LSP JSON-RPC requests, zero LSP status writes, and graph/provenance output equivalent to the non-LSP structural path.
- **SC-012**: In LSP-enabled validation fixtures, 100% of runs report structural-index elapsed time, LSP precision-pass elapsed time, per-language source-file and candidate counts, cap-exceeded skips, active session concurrency, and peak in-flight request counts.
- **SC-013**: In large-repo validation fixtures, 100% of LSP-enabled runs either complete within the default per-language work/concurrency caps or report deterministic per-language skip/degrade reasons without falling back to unbounded repository-wide LSP verification.
- **SC-014**: In retrieval regression probes, 100% of LSP-enabled correction and suppression scenarios preserve existing `codegraph_explore`, callers, callees, impact, search, and flow-building sufficiency within the current repo-size explore-call budget.

## Configuration Contract

`codegraph.json` uses a top-level LSP object:

```json
{
  "lsp": {
    "enabled": true,
    "defaultTimeoutMs": 5000,
    "watch": { "enabled": true },
    "servers": {
      "typescript": {
        "timeoutMs": 5000
      }
    }
  }
}
```

Language keys use CodeGraph language ids such as `typescript`, `tsx`,
`javascript`, `jsx`, `cpp`, `csharp`, `vue`, and `cobol`. Environment
overrides can replace command argv arrays or timeouts for the current machine,
but cannot activate LSP precision.
Activation precedence is: explicit CLI enable/disable, then
`codegraph.json.lsp.enabled === true`, then default off.

Command precedence is: `CODEGRAPH_LSP_<LANG>_COMMAND_JSON`, then the registry
default or accepted alternatives. Committed
`codegraph.json.lsp.servers.<language>.command` values warn and are ignored.
Timeout precedence is:
`CODEGRAPH_LSP_<LANG>_TIMEOUT_MS`,
`codegraph.json.lsp.servers.<language>.timeoutMs`,
`CODEGRAPH_LSP_TIMEOUT_MS`, `codegraph.json.lsp.defaultTimeoutMs`, then the
registry/default timeout. Invalid command or timeout values warn and fall back
to the next lower-precedence value.

## Assumptions

- The users for this feature are developers and maintainers who run CodeGraph locally or in controlled validation environments.
- Normal runtime and SPEC-008 validation have intentionally different failure behavior: normal runtime degrades per language, while validation fails when required real-server prerequisites or parity ownership are missing.
- Project configuration is the repeatable source for shared settings, while environment variables are machine-local overrides for the current run.
- Presence of a language server on the user's machine is never enough to activate LSP precision without an explicit opt-in.
- The internal parity baseline is authoritative for language and capability ownership; references to the baseline stay generic as the internal parity baseline, reproduced matrix, and baseline capability rows.
- The exact concrete local server choices for languages with accepted alternatives are finalized during planning against current primary documentation.
- The COBOL row requires an explicit parity disposition; if SPEC-008 does not select a local LSP target, a concrete numbered future spec owns the remaining LSP parity work.
- The server prerequisite matrix is authoritative for Clarify and validation
  planning; Plan records observed versions, install evidence, and any upstream
  minimum runtime requirements.
- Roadmap and PRD shorthand that describes edge provenance as `lsp | heuristic`
  is interpreted as a high-level contrast between LSP-verified and non-LSP
  resolution. It does not require rewriting untouched static/null provenance to
  `heuristic`.
- Incremental watch LSP verification follows the existing sync/watch lifecycle
  and is enabled only when LSP precision is effectively enabled; it does not add
  a second watcher pipeline.
- Final vertical slices are: Slice 1 activation/config/status contracts,
  client lifecycle, prereq detection, and complete TypeScript-family
  verification/correction path; Slice 2 correction/status generalization plus
  Python, Go, Rust, C/C++, Swift, and Java coverage; Slice 3 remaining baseline
  servers/dispositions, incremental watch verification, parity matrices,
  self-repo dogfood, and validation packet.
