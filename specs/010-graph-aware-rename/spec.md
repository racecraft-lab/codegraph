# Feature Specification: Graph-Aware Rename

**Feature Branch**: `010-graph-aware-rename`

**Created**: 2026-07-10

**Status**: Draft

**Input**: User description: "Graph-Aware Rename (SPEC-010) — rename any symbol with a dry-run plan first, LSP-powered where a language server covers the language, graph-verified always, atomic on apply. The goal it serves: safe automated refactors for agents. Scope authorities: roadmap § SPEC-010 and docs/ai/specs/.process/SPEC-010-design-concept.md (Q&A log Q1–Q11)."

## User Scenarios & Testing *(mandatory)*

CodeGraph already answers "who references X" from its graph, and SPEC-008 added compiler-accurate LSP verification. This feature turns that knowledge into a *safe write* capability: a symbol rename that shows a plan before it touches anything, is verified against the graph (and against a language server where one is configured), and is atomic when applied. The primary consumer is an AI agent performing an automated refactor, with a human developer running the same command by hand as the secondary consumer.

The capability is delivered as **two vertical slices** (design concept Q11):

- **Slice 1 (read-only)** — the plan engine, name-based targeting with ambiguity/kind refusals, and the `codegraph rename` CLI in dry-run mode. Ships a complete, zero-write-risk capability on its own.
- **Slice 2 (write)** — the apply path (span guard, atomic write, snapshot rollback, post-check, targeted re-sync), the `codegraph_rename` MCP tool, and the agent-facing tool-guidance update.

User stories below are mapped to these slices and prioritized so that Slice 1 is an independently shippable MVP.

### User Story 1 - Preview a rename as a dry-run plan (Priority: P1)

A developer or agent runs `codegraph rename <target> <new-name>` and, by default, receives a *plan* rather than a change: every file that would be touched, the exact range within each, a before/after preview, and a confidence rating for each edit. Nothing is written. This works for any indexed language — the plan is derived from a language server's rename edit when one covers the language, and from graph-tracked references otherwise, with each edit's confidence reflecting how it was derived (design concept Q1: "all languages, confidence-gated").

**Why this priority**: This is the foundational, standalone MVP (Slice 1). A reviewable rename plan with zero write risk is valuable on its own — an agent can inspect the blast radius of a rename without reading a single file, and a human can eyeball the plan before ever enabling the write path. Every other story builds on this plan.

**Independent Test**: Index a project containing a uniquely-named symbol; run the dry-run command; confirm the plan lists the affected files, ranges, before/after previews, and a per-edit confidence tier, and that no file on disk changed. Repeat for an LSP-covered language and a non-LSP language and confirm both produce a plan.

**Acceptance Scenarios**:

1. **Given** an indexed symbol whose language has a configured language server, **When** the user runs `codegraph rename <target> <new-name>`, **Then** a dry-run plan prints the affected files, ranges, before/after previews, and a confidence rating per edit, and no files are written.
2. **Given** an indexed symbol in a language with no configured server, **When** the user runs the dry-run, **Then** a graph-reference-derived plan prints with a confidence rating on every edit.
3. **Given** a target with no references beyond its own declaration, **When** the user runs the dry-run, **Then** the plan still lists the declaration edit (an empty-reference plan is valid, not an error).

---

### User Story 2 - Target precisely and recover from ambiguity or unsupported kinds (Priority: P2)

The target is identified by name, optionally qualified (`Class.method`) and narrowed with `--file` / `--kind`. When a name matches several symbols, the command refuses without writing and lists every candidate with its kind, `file:line`, and the exact qualifier that would select it — the refusal itself teaches the retry, so an agent never has to open a file to disambiguate (design concept Q6). The same honest-refusal posture applies to kinds the chosen path cannot safely rename.

**Why this priority**: Precise targeting and teaching refusals are what make the plan from Story 1 *safe to use* on real, ambiguous codebases; they complete Slice 1. Prioritized P2 because a plan for an unambiguous symbol (Story 1) is demonstrable first, with disambiguation and kind-coverage refusals hardening it within the same slice.

**Independent Test**: In a project with two symbols sharing a name, run rename on the bare name and confirm a refusal listing both candidates with selecting qualifiers; retry with a `Class.method` qualifier and confirm a plan is produced. Separately, attempt a graph-path rename of a parameter and confirm the "needs a language server" refusal.

**Acceptance Scenarios**:

1. **Given** several symbols match a bare target name, **When** the user runs rename, **Then** the command refuses (no writes, no guess) and lists each candidate with kind, `file:line`, and the qualifier that selects it.
2. **Given** the user retries with a `Class.method` (or `--file` / `--kind`) qualifier that selects exactly one symbol, **When** the user runs rename, **Then** a plan is produced.
3. **Given** the target is a local variable or parameter and only the graph path is available for its language, **When** the user runs rename, **Then** it refuses with the reason "no local usage tracking — needs a language server" (design concept Q8).
4. **Given** the target is a `file`, `route`, `import`, or `export` kind, **When** the user runs rename on any path, **Then** it refuses because that kind is out of scope.
5. **Given** a nearby shadowing declaration, import alias, or string-similar name, **When** the plan is derived, **Then** those false positives are excluded from the edits by span verification and never appear as edits.

---

### User Story 3 - Apply a rename atomically through verification (Priority: P2)

Passing `--apply` recomputes the plan from the live index and executes it in one invocation — there is no persisted plan file (design concept Q2). Before it writes, it walks a safety ladder: it refuses unless every edit is `exact` confidence (or `--include-heuristic` is passed), then re-verifies every edit's span against the live file bytes, then writes inside a workspace-root jail that respects `.gitignore`, then re-syncs the touched files, then runs a post-check for dangling references to the old name. Any failure along the ladder leaves the workspace byte-identical to where it started — a stale span aborts with zero writes, and a failing post-check restores every touched file from a pre-write snapshot and reports what dangled (design concept Q3–Q5).

**Why this priority**: This is the core value of the feature — the actual safe write — and the whole of Slice 2's risk. Prioritized P2 (after the Slice 1 P1) because it depends on the plan engine from Story 1 and because the read-only slice is the viable MVP that ships first; the write path is the next increment.

**Independent Test**: With an all-`exact` plan, run `--apply` and confirm the files are rewritten, the index re-synced, and the post-check green. Then force each failure mode independently — a plan containing a heuristic edit, a file mutated after indexing, and an induced post-check dangling reference — and confirm the refusal/rollback behavior with the workspace left unchanged in the failure cases.

**Acceptance Scenarios**:

1. **Given** a plan whose every edit is `exact`, **When** the user runs `codegraph rename <target> <new-name> --apply`, **Then** the edits are written within the workspace jail, the touched files are re-synced, the post-check passes, and the rename completes.
2. **Given** a plan containing one or more `heuristic` edits, **When** the user runs `--apply` without `--include-heuristic`, **Then** it refuses and lists the gated edits; **and** with `--include-heuristic`, it proceeds.
3. **Given** a target file whose bytes changed since the last index, **When** the user runs `--apply`, **Then** span verification aborts the entire apply with a "stale index — run codegraph sync" refusal and writes nothing.
4. **Given** the post-check finds a dangling reference to the old name after writing, **When** apply completes the check, **Then** every touched file is restored byte-identically from its snapshot, the index is re-synced, and the refusal reports which references dangled.
5. **Given** a rename that passes every gate, **When** it is applied, **Then** the operation is atomic through verification — on any gate or post-check failure the workspace is left exactly as it was before apply.

---

### User Story 4 - Same plan/apply contract over the MCP tool (Priority: P3)

An MCP tool, `codegraph_rename`, exposes the identical plan/apply contract to agents: dry-run by default, side effects only when the agent passes `apply: true` (design concept Q7). It is always exposed, and every expected or recoverable condition — ambiguity, a heuristic-gated apply, a stale span, a project that is not indexed, an unsupported kind — comes back as success-shaped guidance the agent can act on, never as an error-shaped response.

**Why this priority**: Parity on the MCP surface is what lets agents perform the refactor in their normal loop, completing Slice 2. Prioritized P3 because the CLI (Stories 1–3) already delivers the full capability for human and scripted use; the MCP surface extends the same contract to in-agent use and must be added without regressing existing retrieval.

**Independent Test**: Call `codegraph_rename` over MCP without `apply` and confirm a plan payload with no side effects; call it with `apply: true` and confirm it mirrors the CLI apply contract; trigger each recoverable refusal and confirm every response is success-shaped, not error-shaped. Run the retrieval A/B check on a control repo and confirm no regression.

**Acceptance Scenarios**:

1. **Given** an agent calls `codegraph_rename` without an apply flag, **When** the call returns, **Then** it carries a dry-run plan and nothing on disk changed.
2. **Given** an agent calls `codegraph_rename` with `apply: true`, **When** the call runs, **Then** it follows the identical apply safety ladder as the CLI (confidence gate, span verification, atomic write, post-check, rollback).
3. **Given** any recoverable condition (ambiguous target, heuristic-gated apply, stale span, project not indexed, unsupported kind), **When** the tool responds, **Then** the response is success-shaped guidance that names the fix, never an error-shaped response.

---

### Edge Cases

- **Target not found / project not indexed**: returns success-shaped guidance (how to index, or that the name matched nothing), never an error-shaped response.
- **Ambiguous target**: refusal enumerates every candidate with a selecting qualifier (User Story 2).
- **Index stale vs. working tree**: pre-write span verification against live bytes turns any drift — including CRLF/encoding differences — into a safe "stale index — run codegraph sync" refusal with zero writes (design concept Q4, Q10).
- **Post-check finds dangling references**: unconditional rollback restores every touched file byte-identically, then re-syncs and reports (design concept Q5); there is no `--keep-partial`.
- **Rollback restore itself fails**: an error-shaped response (`isError: true` on MCP, a distinct non-zero exit code on the CLI) reports which touched files were restored and which were not, and persists any unrestored snapshots to a per-incident `.codegraph/rename-recovery-<pid>-<random-hex>/` directory; the response may note that retrying the restore step alone is safe, but never invites re-running the rename itself (FR-019a).
- **Post-check semantics**: the post-check is a name-occurrence probe over the re-indexed touched files (resolved graph edges store node identities, not callsite text), so an old-name token that resolves to a *different* same-named symbol is not counted as dangling — span verification already excluded it from the edits (FR-004/FR-005).
- **LSP edit outside the workspace root**: a language-server workspace edit naming any file whose symlink-resolved path falls outside the workspace root (a dependency's source, a monorepo sibling) refuses the entire plan — success-shaped, naming the file — at plan and apply time alike (FR-017).
- **LSP edit to a scope-ignored in-root file**: an edit targeting a file inside the root but excluded from index scope (gitignored or `codegraph.json`-excluded generated/vendored content) refuses the entire plan with success-shaped guidance naming the file — never a silent write, never a silent skip (FR-017); the user may bring the file into scope or accept a manual edit.
- **Local/parameter on the graph path**: refused with "no local usage tracking — needs a language server" (design concept Q8).
- **Excluded kinds** (`file`, `route`, `import`, `export`): refused on every path.
- **Old name lingers in comments/docstrings/strings**: never edited; the plan may report a count of these leftover textual mentions as an informational FYI (design concept Q9).
- **New name already in use in the target scope**: v1 edits only the target symbol's own verified references and does not perform new-name-availability checking on the graph path (where a language server is present, it applies the server's own rename semantics); any textual clash surfaces only via the leftover-mention FYI count, never as a silent edit.
- **Process killed mid-write**: snapshots are held only until the post-check passes, so a hard process kill during the write window is a known durability limitation of v1 (best-effort atomicity through verification, not crash-durable) rather than a guaranteed rollback.

## Clarifications

### Session 2026-07-10 — Confidence-tier taxonomy (Clarify Session 1)

- Q: Where is the exact/heuristic line within span-verified resolver edges? → A: A deterministic `resolvedBy`-keyed table (consensus synthesis: `import`/`qualified-name`/`function-ref` and `instance-method`'s declaration-verified branch = exact; `exact-match`/`fuzzy`/`framework`-in-full and unknown provenance = heuristic; `file-path` and synthesized edges never candidates) — FR-004.
- Q: Do `provenance='heuristic'` synthesized edges ever emit edits? → A: Never — counted only in the leftover-mention FYI; their stored position is a dispatch site, not a name occurrence — FR-004/FR-013.
- Q: How do plan-time and apply-time span checks relate? → A: Two independent live-byte verifications of the same span (plan-time earns `exact` and drops false positives; apply-time guards the plan→apply window) — FR-004/FR-005/FR-016.
- Q: Offset encoding for spans and LSP ranges? → A: UTF-16 code units end-to-end; no byte↔UTF-16 translation anywhere (SPEC-008 pin) — Assumptions.

### Session 2026-07-11 — Apply mechanics & atomicity (Clarify Session 2)

- Q: Which re-sync mechanism backs the post-check? → A: The resolution-complete sync path (never extraction-only); a lock-contended or no-op re-sync is an apply failure that triggers rollback — FR-018.
- Q: Post-check probe and scope? → A: Touched-files-scoped dual assertion (no unresolved reference carrying the old name; no node named the old name), never repo-wide — FR-018, Edge Cases.
- Q: Snapshot and write strategy? → A: In-memory byte snapshots of all touched files before any write; per-file temp-file-then-atomic-rename — FR-018/FR-020.
- Q: Failed rollback restore? → A (human-ratified): the feature's sole error-shaped malfunction — recovery dump to a per-incident `.codegraph/rename-recovery-<pid>-<random-hex>/`, restored/unrestored files reported, restore-step-retry note permitted, rename re-run never invited — FR-019a.
- Q: LSP edit outside the root, or to a scope-ignored in-root file? → A (human-ratified): whole-plan refusal in both cases, success-shaped, naming the file; per-edit symlink-resolved jail at plan and apply time; ignore test is the indexer/watcher's shared scope matcher — FR-017; FR-023/SC-006 extended.

### Session 2026-07-11 — Surfaces & slice boundary (Clarify Session 3)

- Q: CLI exit codes? → A: `0` plan-produced or applied-green, `1` internal/usage error, `2` recoverable refusal, `3` rolled-back, `4` failed rollback (sole malfunction code) — FR-026.
- Q: Dry-run output and JSON schema? → A: Human table by default; `-j, --json` emits a stable schema byte-identical to the MCP result — FR-027.
- Q: Slice-1 `--apply` surface? → A: None — `--apply`/`--include-heuristic` arrive with Slice 2; Slice 1 is unconditionally dry-run — Assumptions.
- Q: MCP schema and exposure? → A: camelCase mirror of the CLI (`target`, `newName`, `apply`, `includeHeuristic`, `file`, `kind`, `projectPath`); joins the default-served tool set as the second default tool — FR-021/FR-022.
- Q: A/B placement and guidance scope? → A: The retrieval A/B runs in Slice 2; the guidance update is a short write-tool paragraph preserving explore-first steering — FR-024/FR-025.
- Q: Write-tool annotations? → A (human-ratified): `readOnlyHint:false`, `destructiveHint:true`, `idempotentHint:false`, `openWorldHint:false`; read-only-gated client modes refusing even dry-run is accepted — FR-028.

## Requirements *(mandatory)*

### Functional Requirements

**Plan generation & confidence (Slice 1)**

- **FR-001**: `codegraph rename <target> <new-name>` MUST default to dry-run — it produces a rename plan and makes no writes unless an explicit apply is requested.
- **FR-002**: The plan MUST list, for every edit, the file path, the range within the file, a before/after preview, and a confidence tier.
- **FR-003**: Plan derivation MUST use the language-server path (a `textDocument/rename` workspace edit) when a configured server covers the target's language, and the graph-reference-derivation path otherwise; it MUST work for every indexed language, with safety carried by per-edit confidence rather than a language allowlist (design concept Q1).
- **FR-004**: Each edit MUST be assigned a confidence of `exact` or `heuristic`. The tier is determined by the resolver edge's `resolvedBy` category, refined only where a category's current implementation conflates a validated structural resolution with a naming guess under one shared label — the refinement is a fixed exclusion of the identified guess branch, not a runtime-configurable threshold:
  - `exact` — a language-server workspace edit, the target symbol's own declaration span, or a `provenance='lsp'` span-verified graph edge.
  - `exact` — `resolvedBy` `import` and `qualified-name`: scoped file/name lookups that refuse rather than guess on ambiguity.
  - `exact` — `resolvedBy` `function-ref`: matches only exact function/method names and already refuses to emit an edge on any cross-file ambiguity, with no fuzzy fallback.
  - `exact` — `resolvedBy` `instance-method`, limited to its declaration-recovered branch: the receiver type is resolved from an actual declaration and the method is confirmed to exist on that type. The same label's capitalization-guess / word-overlap branch is `heuristic`, not `exact`.
  - `heuristic` — `resolvedBy` `exact-match` and `fuzzy`: both are explicit last-resort strategies whose multi-candidate/cross-language branches pick a best guess and still emit an edge.
  - `heuristic` — `resolvedBy` `framework`, in full, including its confidence-`1.0` self-loop sentinel (`targetNodeId === fromNodeId`, a framework-global marker rather than a symbol-to-symbol edge, and therefore never a candidate edit regardless of tier).
  - `heuristic` — any `resolvedBy` value not enumerated above, and any edge with unrecognized or absent provenance.
  - Not a rename-edit candidate at any tier — `resolvedBy` `file-path`: it targets `file` nodes, not code symbols, and `file` is already an excluded rename kind (FR-011).
  - Not a rename-edit candidate at any tier — a `provenance='heuristic'` synthesized edge (callback, EventEmitter, React re-render, JSX-child, ORM-descriptor, etc.): its `(line, col)` is a dispatch/wiring site, not a name occurrence, so it is never emitted as an edit and is counted only in the leftover-mention FYI (FR-013).
  - The tier assigned above is necessary but not sufficient: every edit, on every path, MUST still pass the span verification already required by FR-005 (plan-time false-positive exclusion) and FR-016 (apply-time re-verification against live file bytes); a failure there drops the edit regardless of its tier, because a live-byte match alone cannot catch referent misidentification (a same-named different symbol).
- **FR-005**: Collision detection MUST exclude false positives — shadowing, import aliases, and string-similar matches — via span verification, and MUST never emit a guessed edit; a genuinely ambiguous derivation is refused with reasons, not resolved silently.
- **FR-027**: `codegraph rename` MUST default to a human-readable plan grouped by file (path, range, before/after preview, per-edit confidence) and MUST accept `-j, --json` emitting the plan as a stable-schema object whose field names are identical to the `codegraph_rename` MCP result (SC-005). Per edit: `file`, `range` (UTF-16 code units), `oldText`, `newText`, `confidence` (`exact`|`heuristic`), `source` (`lsp`|`graph`). Per plan: target identity, `newName`, ordered `edits`, aggregate confidence (`all-exact`|`contains-heuristic`), and the optional leftover-mention count.

**Targeting & refusals (Slice 1)**

- **FR-006**: Target identification MUST be name-based with qualifiers: a bare name, a qualified `Class.method`, and `--file` / `--kind` narrowing flags (design concept Q6).
- **FR-007**: When more than one symbol matches the target, the command MUST refuse (no writes, no guess) and list every candidate with its kind, `file:line`, and the exact qualifier that would select it (design concept Q6).
- **FR-008**: The capability MUST NOT prompt interactively on any surface — the CLI and MCP contracts stay identical, so there is no interactive disambiguation picker (design concept Q6).
- **FR-009**: On the language-server path, any symbol kind the server supports (including locals and parameters) MUST be renameable (design concept Q8).
- **FR-010**: On the graph path, coverage MUST be limited to named declaration kinds that carry tracked references (e.g. function, method, class, struct, interface, enum, constant, type alias); locals and parameters MUST be refused with the reason "no local usage tracking — needs a language server" (design concept Q8).
- **FR-011**: `file`, `route`, `import`, and `export` kinds MUST be refused on every path (design concept Q8).

**Textual occurrences (Slice 1)**

- **FR-012**: The rename MUST NOT edit occurrences of the old name inside comments, docstrings, or string literals; only spans that the graph or the language server prove are references to the symbol are edited (design concept Q9).
- **FR-013**: The plan MAY report a count of leftover textual mentions of the old name as an informational FYI — including references known only through synthesized dynamic-dispatch relationships, which are never edits (FR-004) — but MUST NOT edit them (design concept Q9).

**Apply safety ladder (Slice 2)**

- **FR-014**: `--apply` MUST recompute the plan from the live index and execute it in a single invocation; no plan artifact is persisted between the dry-run and the apply (design concept Q2).
- **FR-015**: `--apply` MUST refuse if any edit is below `exact` confidence, listing the gated edits, unless `--include-heuristic` is passed — an all-or-nothing gate that keeps "atomic on apply" honest (design concept Q3).
- **FR-016**: Before writing, apply MUST re-verify every edit's span against the live file bytes; any mismatch MUST abort the entire apply with a "stale index — run codegraph sync" refusal and zero writes (design concept Q4).
- **FR-017**: Writes MUST be confined to the workspace root (a path jail) and MUST respect `.gitignore`; no clean-git-worktree precondition is imposed (design concept Q4). The jail is enforced per edit with the existing symlink-resolving containment check, at both plan generation and apply time (state can drift between the two). The ignore test is the same scope matcher the indexer and file watcher share — honoring `codegraph.json` `include`/`exclude` overrides — never a raw `.gitignore` reparse. If any edit in the plan (from either derivation path) targets a file outside the workspace root, or an in-root file excluded from index scope, the entire plan MUST be refused — never a partial apply. Both refusals are success-shaped, name the offending file(s), and coach no bypass; they extend FR-023's recoverable-condition list (Clarify Session 2).
- **FR-018**: Apply MUST take a pre-write snapshot (an in-memory byte copy) of every touched file, then perform a targeted re-sync of the touched files, then run a post-check asserting zero dangling references to the old name (design concept Q5). The re-sync MUST be the resolution-complete sync path (not extraction-only file indexing); it is serialized with the file watcher by the index mutex, and a re-sync that fails or reports no change (index-lock contention) MUST be treated as an apply failure and trigger rollback — the post-check never runs against an un-updated graph. The post-check is scoped to the touched-file set (which by construction covers every graph-tracked reference of the renamed symbol): it asserts (a) no unresolved reference in those files still carries the old name and (b) no node named the old name remains in those files; it is never repo-wide.
- **FR-019**: If the post-check finds dangling references, apply MUST restore every touched file byte-identically from its snapshot, re-sync, and report which references dangled; rollback is unconditional (no `--keep-partial`) (design concept Q5).
- **FR-019a**: If the rollback restore required by FR-019 itself fails partway through (e.g. `EACCES`, `ENOSPC`, `EPERM` writing a snapshot's bytes back), apply MUST return an error-shaped response — `isError: true` on the `codegraph_rename` MCP tool, a distinct non-zero exit code on the CLI — rather than the success-shaped refusals used elsewhere on this ladder; a failed rollback happens after side effects have already landed and is a malfunction, not a pre-write gate refusal (FR-023's success-shaped list is closed and does not include this case). Before returning, apply MUST persist every snapshot not yet confirmed restored to a per-incident recovery directory under `.codegraph/` (`.codegraph/rename-recovery-<pid>-<random-hex>/`, following the project's existing PID+random-hex uniqueness convention so a later incident's dump never overwrites an earlier one), and MUST report, by file path, which touched files were successfully restored, which were not, and the recovery directory holding the unrestored snapshots. The response MAY note that retrying the restore step alone — an idempotent write-back of already-known snapshot bytes to already-known paths — is safe, but MUST NOT invite a retry of the rename/apply call itself: recomputing the plan (FR-014) against a workspace left in an unknown partial state cannot distinguish a surviving old-name span from a different, legitimately same-named symbol (constitution Principle I).
- **FR-020**: A rename MUST be atomic through verification — on any gate, span, or post-check failure the workspace MUST be left byte-identical to its pre-apply state. Apply snapshots all touched files in memory before writing any, writes each file via a temp-file-then-atomic-rename (a non-source-suffixed temp sibling in the same directory, ignored by the file watcher's source filter), and holds snapshots only until the post-check passes — the hard mid-write process-kill window remains the documented v1 durability limitation.
- **FR-026**: The `codegraph rename` CLI MUST map each modeled outcome to a distinct process exit code — `0`: a dry-run plan produced, or `--apply` post-check-green; `2`: a recoverable refusal with zero writes (FR-023's list) — the CLI-native encoding of the MCP success-shaped refusals; `3`: an apply that wrote then rolled back byte-identically (FR-019); `4`: a failed rollback restore (FR-019a), reserved as the sole malfunction code; `1`: an unexpected internal or usage error. The two success states intentionally share `0` (the caller knows whether it passed `--apply`; a non-zero code for the common dry-run success would break shell chaining). The rename command MUST NOT collapse these onto the generic error→exit-1 mapping the read-only CLI commands use. Codes `3`/`4` are reachable only once the apply engine ships in Slice 2.

**MCP surface (Slice 2)**

- **FR-021**: An MCP tool `codegraph_rename` MUST expose the identical plan/apply contract as the CLI: dry-run by default, with side effects only on an explicit `apply: true` parameter (design concept Q7). The input schema MUST mirror the CLI in camelCase: `target`, `newName` (required); `apply`, `includeHeuristic` (boolean, default false); `file`, `kind` (optional qualifiers); the shared optional `projectPath`.
- **FR-022**: The `codegraph_rename` tool MUST always be exposed on the MCP surface; it is never hidden behind an opt-in gate (design concept Q7). "Always exposed" concretely means membership in the default-served tool set (today `explore` alone) — the second tool listed to every agent by default, not merely defined-but-unlisted like the other non-explore tools.
- **FR-023**: Every expected or recoverable condition — ambiguity, a heuristic-gated apply, a stale span, a project that is not indexed, an unsupported kind, a plan touching a file outside the workspace root, or a plan touching a scope-ignored file — MUST return a success-shaped response carrying actionable guidance, never an error-shaped (`isError`) response (design concept Q7; constitution Principle VI). The sole malfunction exception on this surface is a failed rollback restore (FR-019a).
- **FR-024**: Adding the tool MUST NOT regress retrieval on a control repository, validated with the A/B methodology (≥2 runs per arm, on the floor model) before merge (constitution Principle VI). This A/B runs in **Slice 2** — the slice that adds the MCP tool and grows the default-served surface; Slice 1 adds no MCP tool and has nothing to measure.
- **FR-025**: The agent-facing tool guidance (the single source of truth returned in the MCP initialize response) MUST be updated to describe the new write tool and its dry-run-by-default / explicit-apply contract. The added guidance MUST be a short, clearly-scoped write-tool paragraph that preserves `codegraph_explore` as the retrieval PRIMARY and MUST NOT dilute the explore-first steering.
- **FR-028**: The `codegraph_rename` MCP tool's annotations MUST declare `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`, and `openWorldHint: false` — the mirror image of the shared read-only annotations, whose own comment anticipates exactly this ("a hypothetical mutating tool would simply not reference it"), and byte-identical to the MCP reference filesystem server's `move_file` tool, the closest same-shape precedent (an old identity becomes invalid, a new one becomes valid). `destructiveHint: true` reflects the in-place overwrite of existing spans — rollback (FR-019/FR-020) protects the outcome of a bad apply but does not shrink the capability envelope a truthful annotation must describe. `idempotentHint: false` reflects that retry-safety of a repeated `apply: true` call was never designed and MUST NOT be asserted unverified. `openWorldHint: false` reflects the closed local workspace, including locally-spawned language servers (constitution Principle VII). The consequence is accepted: a client that gates tool availability in a read-only mode on `readOnlyHint: true` (e.g. Cursor's Ask mode) will refuse `codegraph_rename` in that mode — including a dry-run call — because annotations are declared once per tool, not varied per call, and no split plan-tool/apply-tool exposure is available (FR-021/FR-022; design concept Q7 rejected an MCP-is-plan-only alternative). FR-025's guidance update MUST make the Agent-mode requirement legible. A client that instead reads `readOnlyHint` for call-parallelism correctly serializes `codegraph_rename` calls — intended behavior for a write tool, not a regression. (Clarify Session 3, human-ratified)

### Reviewability Budget *(mandatory)*

- **Primary surface**: harness/adapter (the `src/refactor/` plan-and-apply engine).
- **Secondary surfaces, if any**: CLI (`rename` subcommand), MCP tool surface, and agent-facing tool-guidance text.
- **Projected reviewable LOC**: ~405 net-new (roadmap estimate), ~200 per slice.
- **Projected production files**: ~5.
- **Projected total files**: ~11.
- **Budget result**: warning accepted → resolved by split. The roadmap flagged 405 projected LOC against the 400 warn threshold (no blockers); design concept Q11 chose the split.
- **Split decision**: two vertical slices. **Slice 1** = plan engine + name-based targeting/ambiguity/kind refusals + `codegraph rename` CLI in dry-run (complete read-only capability, zero write risk). **Slice 2** = apply path (confidence gate, span verification, workspace jail, atomic write with snapshots, unconditional rollback, post-check, targeted re-sync) + `codegraph_rename` MCP tool + tool-guidance update. Each slice is ~200 reviewable LOC, independently testable, and cuts end-to-end through its layers; the risky write machinery gets its own focused review.

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order, scope budget, traceability, verification evidence, known gaps, and rollback or feature-flag notes.
- Traceability MUST map each major requirement or success criterion to changed files and verification evidence.
- Deferred work MUST name the follow-up spec or issue (here: Windows validation of the apply path; see Assumptions).

### Key Entities *(include if feature involves data)*

- **Rename Plan**: the computed result of a dry-run — the target symbol's identity, the requested new name, the ordered set of edits, the aggregate confidence (all-exact vs. contains-heuristic), and the optional leftover-textual-mention count.
- **Rename Edit**: a single change within one file — its file path, its span/range, the old text and the new text, its confidence tier, and the provenance that produced it; surfaced in `--json`/MCP as the fields `file`, `range`, `oldText`, `newText`, `confidence`, `source` (FR-027).
- **Target Selector**: the name plus optional qualifiers (`Class.method`, `--file`, `--kind`) that identify the symbol to rename.
- **Candidate**: a symbol matching an ambiguous selector — surfaced in a refusal with its kind, `file:line`, and the qualifier that would uniquely select it.
- **Confidence Tier**: the two-valued rating on each edit — `exact` or `heuristic` — that drives the apply gate; derived from how the edge's referent was established (`resolvedBy` category / provenance class per the FR-004 table) and always subject to span verification as an independent additional gate.
- **Apply Result**: the outcome of an apply — applied, refused (with reason), or rolled-back (with the dangling references) — together with the set of touched files and the post-check status.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user or agent can preview a rename for any indexed symbol and see every affected file, location, before/after, and confidence in a single command, without opening or reading any file first.
- **SC-002**: 100% of applied renames end in one of exactly two states — post-check green with zero dangling references to the old name, or the workspace restored byte-identical to its pre-apply state; a partially-renamed workspace never occurs.
- **SC-003**: When a target name is ambiguous, the refusal lists every candidate with a selecting qualifier, and a single retry using that qualifier succeeds — with zero files read to disambiguate.
- **SC-004**: An apply against a file that drifted since the last index makes zero writes and returns guidance to sync.
- **SC-005**: The same rename request yields the same plan and the same apply outcome whether issued from the CLI or the MCP tool.
- **SC-006**: Every recoverable condition (ambiguous, heuristic-gated, stale span, not indexed, unsupported kind, out-of-root or scope-ignored plan target) is delivered as actionable, success-shaped guidance, so none of them causes an agent to stop using the tool.
- **SC-007**: Adding the MCP tool produces no measurable retrieval regression on a control repository (A/B on the floor model, ≥2 runs per arm).
- **SC-008**: A rename never modifies a comment, docstring, or string literal.
- **SC-009**: The capability is exercised against this repository itself (self-repo dogfood UAT) — a dry-run, and where safe an apply, of an internal rename — with the outcome recorded in the UAT runbook (constitution, Dogfooding).

## Assumptions

- The answers recorded in `docs/ai/specs/.process/SPEC-010-design-concept.md` (Q1–Q11) are authoritative and are reaffirmed by this spec; the exact/heuristic tier-assignment table that concept explicitly deferred to Clarify is resolved in FR-004 (Clarify Session 1).
- Stored reference positions `(line, col)` and language-server rename ranges are both expressed in UTF-16 code units (SPEC-008 pin): span verification indexes the live line as a UTF-16 JS string slice — no byte↔UTF-16 offset translation is performed anywhere in plan or apply.
- The language-server substrate delivered by SPEC-008 is the source of language coverage for the LSP path; where no server is configured for a language, the graph-reference path is used (design concept Q1).
- New code lives in a new `src/refactor/` module (constitution Principle III, fork discipline); edits to existing files (`src/mcp/tools.ts`, `src/mcp/server-instructions.ts`, `src/bin/codegraph.ts`, `src/index.ts`) stay minimal.
- No new runtime dependency is introduced, and no network call is made beyond locally spawned language servers (constitution Principle VII).
- Validation covers macOS and Dockerized Linux; Windows validation is **deferred** (the validation VM is suspended, design concept Q10). Platform-sensitive assertions are gated with `it.runIf`, and a Windows validation pass is a tracked follow-up in the UAT runbook — not a v1 gate.
- A positional `--position file:line:col` targeting escape hatch is **not** shipped in v1 (name + qualifiers is the sole targeting contract; design concept Q6 and Open Questions; constitution Principle II); it may be revisited only if Slice 1 dogfooding hits a case qualifiers cannot express.
- The leftover-textual-mention FYI count (FR-013) is optional and non-gating in v1 — the design concept records it as something the plan "may" report (Q9).
- The graph path renames only the target symbol's own span-verified references; it does not verify that the new name is free of collisions in scope (the language server enforces that where present).
- The `--apply` and `--include-heuristic` flags are introduced in Slice 2 with the apply engine; Slice 1's `codegraph rename` is unconditionally dry-run and exposes no `--apply` surface (a Slice-1 build rejects `--apply` with the CLI's standard unknown-option error, not a bespoke refusal — constitution Principle II). Slice 1's only flags are `--file`, `--kind`, and `-j, --json`; Slice 1 emits only exit codes `0`/`1`/`2` (FR-026).

## Non-Goals

- Non-rename refactors (extract, move) and cross-repo rename — reaffirmed out of scope (roadmap; design concept Non-goals).
- Editing old-name occurrences in comments, docstrings, or string literals; no `--include-docs` flag (design concept Q9).
- Graph-fallback rename of locals or parameters — the graph deliberately has no local def-use tracking; refused with a reason, handled by the LSP path where a server runs (design concept Q8).
- Renaming `file`, `route`, `import`, or `export` kinds (design concept Q8).
- A persisted plan artifact / plan-file handoff between dry-run and apply (design concept Q2).
- An interactive disambiguation picker (design concept Q6).
- `--keep-partial` or any configurable rollback behavior — rollback is unconditional (design concept Q5).
- Windows validation in v1 — deferred, see Assumptions (design concept Q10).
