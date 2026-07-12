# Tasks: Graph-Aware Rename (SPEC-010)

**Input**: Design documents from `/specs/010-graph-aware-rename/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (cli-rename.md, mcp-codegraph_rename.md, rename-plan.schema.json), `docs/ai/specs/.process/SPEC-010-design-concept.md`

**Tests**: TDD is MANDATORY here (constitution Principle IV + this feature's user request). Every implementation task is preceded by a task that writes failing tests against **real files + real SQLite** (`fs.mkdtempSync`, `afterEach` cleanup, **no DB mocking**). Bug-class / gate checks start red, then green.

**Reviewability**: The spec's ratified **2-slice split** is binding and is the sanctioned split exception for this feature (the reviewability preset waives the file/LOC block "unless a ratified split exception exists"). Budget per slice: ~200 reviewable LOC, single primary surface (`src/refactor/`); the primary surface is 12 fine-grained single-responsibility modules — Slice 1 = 8, Slice 2 = 4 (~25 LOC each, so reviewable LOC, not raw file count, is the binding control). If task generation would push a slice past ~200/400 reviewable LOC, add a second primary surface, or grow the module set beyond the ratified per-slice layout, stop and re-scope rather than adding tasks (tasks-template Reviewability).

**Organization**: Tasks are grouped by user story (vertical slices), in priority order, honoring the slice boundary as a PR boundary.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallel-safe — different file, no dependency on an incomplete task.
- **[Story]**: US1 / US2 / US3 / US4 (Setup / Foundational / Polish carry no story label).
- Every task names an exact file path.

## Slice → PR boundary (BINDING — from plan.md Structure Decision + Clarify Session 3)

- **Slice 1 (PR 1, read-only)** = T001–T027. Plan engine + name/qualifier targeting + ambiguity/kind/invalid-arg refusals + `codegraph rename` CLI in **unconditional dry-run**. Ships zero-write-risk. **Slice 1 exposes NO `--apply` surface at all** — a Slice-1 binary rejects `--apply` with commander's standard unknown-option error (spec Assumptions); Slice 1 emits only exit codes `0`/`1`/`2`.
- **Slice 2 (PR 2, write)** = T028–T053. Apply safety ladder + `codegraph_rename` MCP tool + guidance + A/B evidence. `--apply` / `--include-heuristic` and exit codes `3`/`4` arrive **here, never earlier**.
- **Ordering rule**: EVERY Slice-1 task (T001–T027) completes before ANY Slice-2 task (T028+). At the Slice-1 PR boundary no Slice-1 file imports a Slice-2 file (Slice 1 ships self-contained); Slice 2 imports Slice 1 (notably `span-verify.ts`, the shared seam) and additively adds the one accepted plan-time cross-import (`plan-engine.ts` → `jail.ts`) in T040.

## Non-Goals guardrail (do NOT generate or implement — design-concept Non-goals)

These are **out of scope**; no task below implements them, and none should be added:

- Editing old-name occurrences in comments, docstrings, or string literals; no `--include-docs` flag (FR-012/SC-008). *Positive refusal/exclusion tests that PROVE these are never edited (T011, T025) are in scope.*
- A persisted plan artifact / plan-file handoff between dry-run and apply — `--apply` recomputes from the live index (FR-014).
- `--keep-partial` or any configurable rollback behavior — rollback is unconditional (FR-019).
- An interactive disambiguation picker on any surface (FR-008).
- Renaming `file` / `route` / `import` / `export` kinds (FR-011). *The refusal of these kinds (T023) is in scope.*
- Non-rename refactors (extract/move), cross-repo rename, a `--position file:line:col` targeting flag, and new-name collision checking on the graph path.

If any future task appears to cross one of these, STOP and flag it instead of generating it.

---

## Phase 1: Setup

**Purpose**: Establish a green baseline in the bootstrapped worktree.

- [ ] T001 Verify green baseline and worktree preflight (CLAUDE.md spec-worktree preflight): run `npm run build && npm test` (expect green); `node dist/bin/codegraph.js init .` then `node dist/bin/codegraph.js status` (expect healthy index — embeddings 100%, LSP enabled). No `src/` changes. This is the gate before any implementation.

**Checkpoint**: Baseline green; ready to build the module skeleton.

---

## Phase 2: Foundational (Slice 1 building blocks — BLOCKS all user stories)

**Purpose**: The `src/refactor/` skeleton, the pure/deterministic units, and the Slice-1 prepared statements that every Slice-1 story depends on. `span-verify.ts` is the shared seam reused apply-time in Slice 2 (FR-016).

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [ ] T002 Create `src/refactor/types.ts` — all shared value-object types (RenamePlan, RenameEdit, TargetSelector, resolved Target, Candidate, ConfidenceTier, Refusal + `reason` union, ApplyResult / ApplyOutcome / recovery) and the local LSP protocol types (Position, Range, TextEdit, WorkspaceEdit, documentChanges) per research Decision 1 and data-model.md entities. Internal positions are line 1-indexed / col 0-indexed (graph native); surface JSON uses LSP-style 0-based line/character (converted once at the boundary). Compiles under strict `tsc`. (Blocks the rest; not [P].)
- [ ] T003 [Test] Write failing unit tests in `__tests__/refactor-plan.test.ts` for (a) the FR-004 confidence table — every `resolvedBy`/`provenance` → `exact`|`heuristic` per data-model.md, `file-path` and `provenance='heuristic'` synthesized edges are **never candidates**, `instance-method` declaration-branch = `exact` vs capitalization/word-overlap branch = `heuristic`; and (b) span verification — a live line indexed as a UTF-16 JS string slice equals `oldText`, range derived as `(line,col)..(line,col + oldName UTF-16 length)` (research Decision 8), a non-ASCII fixture line (extends the SPEC-008 pin `lsp-precision-pass.test.ts:250`), and a shadow/alias/string-similar slice mismatch drops the edit. Verify RED. (Shared suite; sequential with T006.)
- [ ] T004 [P] Implement `src/refactor/confidence.ts` — the pure, deterministic `(resolvedBy, provenance) → exact|heuristic` function (fixed exclusion, not a runtime threshold); make the T003 confidence tests GREEN. (FR-004)
- [ ] T005 [P] Implement `src/refactor/span-verify.ts` — live-byte span verification over a UTF-16 line slice, range derivation from old-name UTF-16 length, false-positive drop; make the T003 span-verify tests GREEN. The shared seam (plan-time FR-005; reused apply-time FR-016). (FR-004/FR-005)
- [ ] T006 [Test] Write failing real-SQLite tests in `__tests__/refactor-plan.test.ts` (temp fixture via `fs.mkdtempSync`, `afterEach` cleanup) asserting the new Slice-1 `QueryBuilder` prepared statements return the expected rows: references-to-node (incoming `references` edges with source/line/col/metadata/provenance), node-declaration-span (`getNodeById`), and nodes-by-name / candidates. Verify RED. (Shared suite; sequential with T003.)
- [ ] T007 Add the Slice-1 prepared statements to `src/db/queries.ts` (additive; **no inline SQL** — workflow constraint); make the T006 tests GREEN. (research Decisions 7–8; data-model Schema touchpoints.)
- [ ] T008 Reviewability checkpoint — confirm the planned task/file scope stays within the ratified 2-slice budget (single primary surface `src/refactor/`; ~200 reviewable LOC/slice; the ratified per-slice module layout — Slice 1: 8 new modules, Slice 2: 4) and record the split decision. Stop and re-scope if reviewable LOC or primary-surface count is exceeded, rather than adding implementation tasks. (No `src/` change.)

**Checkpoint**: Types, confidence, span-verify, and Slice-1 statements ready — user stories can begin.

---

## Phase 3: User Story 1 — Preview a rename as a dry-run plan (Priority: P1) 🎯 MVP · Slice 1

**Goal**: `codegraph rename <target> <new-name>` returns, by default, a dry-run **plan** (every affected file, the range per edit, a before/after preview, a per-edit confidence tier and `source`), writes nothing, and works for any indexed language — LSP path where a server covers the language, graph-reference path otherwise.

**Independent Test**: Index a project with a uniquely-named symbol; run the dry-run; confirm the plan lists files/ranges/previews/confidence tiers and **no file on disk changed**; repeat once for an LSP-covered language and once for a non-LSP language and confirm both produce a plan.

### Tests for User Story 1 (write FIRST, verify RED) — all in `__tests__/refactor-plan.test.ts` (shared suite → sequential)

- [ ] T009 [US1] LSP-path derivation tests: a `textDocument/rename` WorkspaceEdit → `RenameEdit[]` with `source:'lsp'`, UTF-16 ranges mapped verbatim, `exact` tier; document lifecycle (didOpen/didClose) exercised via a fake/stub server. (FR-003)
- [ ] T010 [US1] FR-003a degradation-parity tests: an **unavailable** server (`missing-default-command` / `configured-command-unavailable`) takes the graph path from the start; a **runtime failure** mid-derivation (`server-crash` / `initialize-timeout` / `request-timeout` / `malformed-protocol-response` / `shutdown-failure`) degrades **that** rename to the graph path — no command failure, no hang, no partial plan; per-edit `source` shows `graph`; the outcome is success-shaped.
- [ ] T011 [US1] Graph-path derivation tests: `references` edges for the resolved target → span-verified edits (via `span-verify.ts` + `confidence.ts`), `source:'graph'`; the declaration edit is always present (empty-reference plan is valid, not an error — US1 scenario 3 / FR-002); the leftover-mention FYI count (FR-013) tallies comment/string occurrences **and** `provenance='heuristic'` synthesized dispatch sites but **never emits them as edits** (FR-012).
- [ ] T012 [US1] Plan-assembly tests: the LSP-vs-graph fork (FR-003), aggregate confidence `all-exact` vs `contains-heuristic`, and deterministic edit ordering by (file path, range start line, start character) (FR-027).
- [ ] T013 [US1] Plan-format + schema tests: the human table grouped by file (path, per-edit range/before-after/tier, footer with aggregate confidence and leftover-mention count); `-j/--json` emits an object that **validates against `contracts/rename-plan.schema.json`**; every edit carries `lineText` so a consumer renders before/after without a Read (SC-001); same-line composition is right-to-left by range start (FR-027).
- [ ] T014 [US1] CLI dry-run tests: `codegraph rename oldFn newFn` prints the table, makes **zero writes**, exits `0`; `--json` prints the schema object; `--file` / `--kind` qualifiers are accepted; a `target-not-found` and a not-indexed project each return **success-shaped** guidance (exit `2`); `--apply` is rejected as an unknown option (Slice-1 has no apply surface). Exit codes limited to `0`/`1`/`2` (FR-026).

### Implementation for User Story 1

- [ ] T015 [P] [US1] `src/refactor/lsp-rename.ts` — LSP path: issue `textDocument/rename` through the existing `LspJsonRpcClient`, reuse SPEC-008 `probeLspServerCommand` / `resolveLspConfig` and the UTF-16 position helpers, translate the WorkspaceEdit to `RenameEdit[]` (`source:'lsp'`, `exact`), and route unavailable/runtime-failure to the graph path per FR-003a. Make T009/T010 GREEN. (research Decision 1)
- [ ] T016 [P] [US1] `src/refactor/graph-rename.ts` — graph path: incoming `references` edges for the target → range-derive → `span-verify.ts` → `confidence.ts` tier → `RenameEdit[]` (`source:'graph'`); always include the declaration edit; compute the leftover-mention FYI count without editing those occurrences. Make T011 GREEN. (FR-003/FR-004/FR-005/FR-012/FR-013)
- [ ] T017 [P] [US1] `src/refactor/target-resolver.ts` (basic) — name + optional `Class.method` / `--file` / `--kind` → exactly one resolved Target, else a `target-not-found` success-shaped refusal. (US2 extends this file with ambiguity / kind / invalid-argument refusals.) (FR-006)
- [ ] T018 [P] [US1] `src/refactor/plan-format.ts` — human table (default) and canonical stable JSON (stable key order, UTF-8, no insignificant whitespace, deterministic array ordering) per FR-027; render `lineText` before/after preview. Make T013 GREEN.
- [ ] T019 [US1] `src/refactor/plan-engine.ts` — orchestrator: resolve target (T017) → LSP-vs-graph fork (T015/T016, FR-003/FR-003a) → assemble `RenamePlan` with aggregate confidence and deterministic ordering. Make T012 GREEN. (depends T015, T016, T017)
- [ ] T020 [US1] `src/index.ts` — add the thin, additive `planRename()` entry point on the `CodeGraph` class. (depends T019)
- [ ] T021 [US1] `src/bin/codegraph.ts` — add the `rename` subcommand in **dry-run only**: positionals `<target> <new-name>`; flags `--file` / `--kind` / `-j,--json` / `--path`; drive `planRename()`; print table or JSON; map outcomes to exit `0`/`1`/`2` (do NOT collapse onto the generic error→exit-1 path). No `--apply` surface. Make T014 GREEN. (depends T018, T020; FR-001/FR-026/FR-027)

**Checkpoint**: US1 delivers the standalone read-only MVP — reviewable rename plans, zero write risk, LSP and graph paths.

---

## Phase 4: User Story 2 — Target precisely and recover from ambiguity or unsupported kinds (Priority: P2) · Slice 1

**Goal**: Name-based targeting with qualifiers; a multi-match refusal that lists every candidate with kind, `file:line`, and the exact selecting qualifier (the refusal teaches the retry); honest kind-coverage refusals; invalid-argument refusals; and span-verified exclusion of false positives.

**Independent Test**: In a project with two symbols sharing a name, run rename on the bare name → refusal listing both candidates with selectors; retry with a `Class.method` qualifier → a plan. Separately, a graph-path parameter rename → the "needs a language server" refusal.

### Tests for User Story 2 (write FIRST, verify RED) — all in `__tests__/refactor-plan.test.ts` (shared suite → sequential)

- [ ] T022 [US2] Ambiguity-refusal tests: a bare name matching several symbols → refusal `reason:'ambiguous-target'` with a `candidates` array (each: name, kind, file, line, `selector`), **zero writes, no guess**; a retry with the printed selector produces a plan with **zero files read to disambiguate** (SC-003 / FR-007 / FR-008).
- [ ] T023 [US2] Kind-coverage refusal tests: a graph-path local/parameter → `reason:'unsupported-kind-graph-local'` ("no local usage tracking — needs a language server"), and when the degradation came from a *configured* server that was unavailable/failed the message makes clear a working server is required (FR-003a); the LSP path renames locals/params (FR-009); a `file`/`route`/`import`/`export` kind → `reason:'excluded-kind'` on **every** path (FR-010/FR-011).
- [ ] T024 [US2] Invalid-argument tests (FR-021a, CLI surface): an empty or syntactically-invalid `newName`, a `newName` equal to the target's current name (no-op), and an unrecognized `--kind` each → `reason:'invalid-argument'` success-shaped, exit `2`, naming the offending argument; the unknown-kind refusal carries `validKinds`; these stay distinct from `excluded-kind` (well-formed but out-of-scope) and `target-not-found` (valid kind, no match).
- [ ] T025 [US2] False-positive-exclusion tests (FR-005 / SC-008): a fixture with a shadowing declaration, an import alias, a string-similar name, and a comment/string occurrence → **none** appear as edits (span verification dropped them); each surviving edit's tier matches the FR-004 table. **Also assert the scope-ignored-invisibility edge case (spec.md Edge Cases):** an old-name reference living *inside* a gitignored / `codegraph.json`-excluded fixture file never appears as an edit **and** never increments the leftover-mention FYI count (FR-013) — it is invisible to the graph (no edge exists), distinct from the T030 scope-ignored-*edit* refusal where a language server returns an edit naming an ignored file. (Validates the T005 `span-verify.ts` + T016 `graph-rename.ts` behavior; no new production file.)

### Implementation for User Story 2

- [ ] T026 [US2] Extend `src/refactor/target-resolver.ts`: multi-match → `ambiguous-target` refusal building each Candidate's uniquely-selecting qualifier; kind-coverage refusals (`unsupported-kind-graph-local` for graph-path locals/params, `excluded-kind` for file/route/import/export on every path — FR-009/FR-010/FR-011); and FR-021a input validation (`invalid-argument` for empty/invalid/no-op `newName` and unrecognized `kind`, with `validKinds`). Make T022/T023/T024 GREEN. Refusals render through the existing CLI (T021). (extends the T017 file)

**Checkpoint (SLICE 1 PR BOUNDARY)**:

- [ ] T027 [US2] Slice-1 wrap and PR packet: `npm run build && npm test` GREEN; execute the quickstart Slice-1 scenarios S1-A…S1-F; add a user-facing `## [Unreleased]` → `### New Features` CHANGELOG entry for the dry-run rename-plan capability (no internal paths/symbols); assemble the Slice-1 PR review packet (what/why, non-goals, review order engine→CLI, scope budget, FR→file→evidence traceability, verification evidence, known gaps, rollback/flag notes); confirm Slice 1 emits only exit `0`/`1`/`2` and exposes **no `--apply`**. (Every Slice-1 task above must be complete; no Slice-2 task begins until this passes.)

---

## Phase 5: User Story 3 — Apply a rename atomically through verification (Priority: P2) · Slice 2

**Goal**: `--apply` recomputes the plan from the live index and walks the safety ladder — **confidence gate → jail/scope → snapshot → span re-verify → atomic write → resolution-complete re-sync → post-check → unconditional rollback** (recovery dump on failed rollback). Any failure leaves the workspace byte-identical to pre-apply.

**Independent Test**: With an all-`exact` plan, `--apply` rewrites files, re-syncs, post-check green. Then force each failure independently — a heuristic-containing plan, a file mutated after indexing, an induced post-check dangling reference — and confirm the refusal/rollback behavior with the workspace unchanged in the failure cases.

> Runtime-order rule (workflow constraint): the apply-ladder tests and `apply-engine.ts` compose steps in this exact order — confidence gate → (jail) → (snapshot) → span check → write → re-sync → post-check → rollback/recovery (data-model ApplyOutcome; a superset of the required confidence-gate→span→write→re-sync→post-check→rollback spine).

- [ ] T028 [US3] Slice-2 `QueryBuilder` post-check statements: write failing real-SQLite tests in `__tests__/refactor-apply.test.ts` for touched-file-scoped `unresolved-refs-by-name-in-files` and `nodes-by-name-in-files`, then add the statements to `src/db/queries.ts` (additive, **no inline SQL**); GREEN. (FR-018; data-model Schema touchpoints)

### Tests for User Story 3 (write FIRST, verify RED) — all in `__tests__/refactor-apply.test.ts`, ordered to mirror the ladder

- [ ] T029 [US3] Rung 1 — confidence gate (FR-015): a plan with a `heuristic` edit and no `--include-heuristic` → `reason:'heuristic-gated'` listing `gatedEdits`, **zero writes**, exit `2`; with `--include-heuristic` → proceeds.
- [ ] T030 [US3] Rung 2 — jail/scope (FR-017): an LSP edit whose symlink-resolved path is **outside** the root → whole-plan `reason:'out-of-root'` naming the file, at plan **and** apply time, zero writes; an in-root but scope-ignored file (gitignored / `codegraph.json`-excluded) → `reason:'scope-ignored'` naming the file; symlinked-root and case-insensitive containment resolve correctly; the check runs **before** the file's bytes are read (refuse-before-read); these are success-shaped (exit `2`) and are **not** `PathRefusalError`.
- [ ] T031 [US3] Rung 3 — snapshot + span re-verify (FR-016 / FR-018 / FR-020): in-memory byte snapshots of **all** touched files are taken before any write; a file whose bytes drifted since indexing → `reason:'stale-span'` listing the drifted `files`, **zero writes**, exit `2` (SC-004).
- [ ] T032 [US3] Rung 4 — atomic write (FR-020): per-file temp-sibling→atomic-rename; bytes **outside** edited spans are preserved exactly (LF/CRLF, trailing newline, BOM, encoding round-tripped — operate on whole-file content, never line-split-rejoin); a file's edits apply **descending / right-to-left** by range start; identical duplicate ranges de-duplicate; a genuine partial overlap (only reachable from a misbehaving LSP workspace edit — the graph path's spans are disjoint by FR-005) degrades that rename to the graph path via FR-003a.
- [ ] T033 [US3] Rung 5 — re-sync + post-check (FR-018): re-sync via `CodeGraph.sync()` (resolution-complete, **never** `indexFiles()` — research Decision 3); the lock-failure **zero-shape** (`filesChecked:0`, `durationMs:0`) is treated as an apply failure → rollback, while a watcher-raced real-empty result (`filesChecked>0`, `filesModified=0`) proceeds; the post-check is the touched-file-scoped dual assertion (no unresolved ref carrying the old name; no node named the old name); shared-`CodeGraph`-instance mutex serialization with no watcher suspension.
- [ ] T034 [US3] Rung 6 — rollback + recovery (FR-019 / FR-019a): a post-check dangling ref → restore every touched file **byte-identically** from snapshot, re-sync, refusal reports `danglingReferences`, exit `3`, workspace byte-identical (SC-002); a failed restore (a touched file made unwritable) → **error-shaped** (MCP `isError:true` / CLI exit `4`), a `recovery` object (`restoredFiles` / `unrestoredFiles` / `recoveryDir`), unrestored snapshots dumped to `.codegraph/rename-recovery-<pid>-<hex>/`, a "retry the restore step" note that never invites re-running the rename. This is the **sole** `isError` outcome.
- [ ] T035 [US3] No-index-explosion + atomicity probe (SC-010 / SC-002): total node and edge counts measured immediately before the rename equal the counts immediately after the post-check re-sync (old-named node replaced by new-named node, references re-resolve in place); every apply resolves to exactly one terminal state.

### Implementation for User Story 3 (composed in ladder order)

- [ ] T036 [P] [US3] `src/refactor/jail.ts` — per-edit symlink-resolved containment reusing `validatePathWithinRoot`, plus the shared scope matcher (`buildScopeIgnore` / `ScopeIgnore`, honoring `codegraph.json` include/exclude — never a raw `.gitignore` reparse); whole-plan out-of-root / scope-ignored refusal; refuse-before-read. Make T030 GREEN. (research Decision 5)
- [ ] T037 [P] [US3] `src/refactor/snapshot.ts` — in-memory byte snapshots; temp-file-then-atomic-rename writer (byte-preservation, descending edit-application order, duplicate de-dup, overlap→degrade); the recovery-dir dump. Make T031/T032/T034 GREEN. (FR-018/FR-019a/FR-020)
- [ ] T038 [P] [US3] `src/refactor/post-check.ts` — touched-file-scoped dual assertion using the T028 statements. Make (with T039) T033 GREEN. (FR-018; depends T028)
- [ ] T039 [US3] `src/refactor/apply-engine.ts` — the safety ladder in runtime order: recompute plan (FR-014) → confidence gate (FR-015) → jail (FR-017, T036) → snapshot (FR-018, T037) → span re-verify via `span-verify.ts` (FR-016) → atomic write (FR-020, T037) → `sync()` re-sync with zero-shape discrimination (FR-018, T033) → post-check (T038) → unconditional rollback (FR-019) / recovery (FR-019a); map each exit to an ApplyOutcome. Make T029/T033/T034/T035 GREEN. (depends T036, T037, T038)
- [ ] T040 [US3] Wire the FR-017 **plan-time** jail/scope refusal into plan generation (dry-run and apply alike) — an additive guard in `src/refactor/plan-engine.ts` that consults `jail.ts` after derivation so an out-of-root / scope-ignored plan is refused at plan time too. (Accepted additive Slice-2 edit to a Slice-1 file; depends T036, T039)
- [ ] T041 [US3] `src/index.ts` — add the thin, additive `applyRename()` entry point. (depends T039)
- [ ] T042 [US3] `src/bin/codegraph.ts` — add `--apply` and `--include-heuristic` to the `rename` subcommand; drive `applyRename()`; add exit codes `3` (rolled-back) and `4` (failed rollback). Cover the CLI apply paths in `__tests__/refactor-apply.test.ts`. (depends T041; FR-026)

**Checkpoint**: US3 delivers the safe write — atomic through verification, unconditional rollback, recovery dump on the sole malfunction.

---

## Phase 6: User Story 4 — Same plan/apply contract over the MCP tool (Priority: P3) · Slice 2

**Goal**: A `codegraph_rename` MCP tool exposing the identical plan/apply contract — dry-run by default, side effects only on `apply: true`, always default-served (the second tool after `explore`), every recoverable condition success-shaped, write-tool annotations, and a byte-identical CLI≡MCP result — added without regressing retrieval.

**Independent Test**: Call `codegraph_rename` over MCP without `apply` → a plan payload, no side effects, JSON byte-identical to the CLI `--json`; call with `apply: true` → mirrors the CLI apply ladder; trigger each recoverable refusal → every response success-shaped; run the retrieval A/B on a control repo → no regression.

### Tests for User Story 4 (write FIRST, verify RED) — all in `__tests__/rename-mcp.test.ts`

- [ ] T043 [US4] MCP contract + parity tests (SC-005 / FR-021 / FR-021a): the input schema is the camelCase CLI mirror (`target`, `newName` required; `apply`, `includeHeuristic`, `file`, `kind`, `projectPath` optional); a dry-run call returns the `RenamePlan` JSON as a canonically-serialized **text** payload **byte-identical** to the CLI `--json` stdout for the same request; an `apply: true` call mirrors the CLI apply outcome; invalid-argument behaves identically to the CLI.
- [ ] T044 [US4] Success-shaped refusal tests (FR-023 / SC-006): ambiguous, heuristic-gated, stale-span, not-indexed, unsupported/excluded kind, out-of-root, scope-ignored, and invalid-argument all return `textResult` with the `refusal` object and **no `isError`**; only the failed-rollback malfunction is `isError`.
- [ ] T045 [US4] Exposure + annotations tests (FR-022 / FR-028): `codegraph_rename` is a member of `DEFAULT_MCP_TOOLS` (the second listed tool, after `explore`); its annotations are exactly `readOnlyHint:false`, `destructiveHint:true`, `idempotentHint:false`, `openWorldHint:false` — its own object, not a reference to `READ_ONLY_ANNOTATIONS`.

### Implementation for User Story 4

- [ ] T046 [US4] `src/mcp/tools.ts` — add the `codegraph_rename` `ToolDefinition` (input schema, own annotations object per FR-028), add `'rename'` to `DEFAULT_MCP_TOOLS`, and wire the handler to `planRename()` / `applyRename()` using the existing `textResult` (recoverable → success-shaped) vs `errorResult` (failed-rollback → `isError`) discipline. Minimal additive diff. Make T043/T044/T045 GREEN. (research Decision 6; FR-021/FR-022/FR-023/FR-028; depends T020, T041)
- [ ] T047 [US4] `src/mcp/server-instructions.ts` — add a short write-tool paragraph after the `## One tool` block: dry-run-by-default / explicit-`apply`, and the Agent-mode requirement implied by `readOnlyHint:false` (FR-028). It MUST preserve `codegraph_explore` as the retrieval PRIMARY and MUST NOT dilute explore-first steering (FR-025; single source of truth, issue #529; depends T046).
- [ ] T048 [US4] Retrieval no-regression evidence (FR-024 / SC-007): run `scripts/agent-eval/` with vs without the new default surface on a control repo, ≥2 runs/arm, `--model sonnet --effort high`; record Read/Grep counts and wall-clock; confirm no measurable regression. Run the `retrieval-guardian` review over the Slice-2 diff (touches `src/mcp/`). Record numbers in the PR packet. (depends T046, T047)

**Checkpoint**: US4 completes Slice 2 — MCP parity for in-agent refactors, retrieval unregressed.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Release notes, dogfood + cross-platform validation, and the Slice-2 PR packet.

- [ ] T049 [P] `CHANGELOG.md` — add a user-facing entry under `## [Unreleased]` (`### New Features`) for the apply + MCP rename capability: `codegraph rename … --apply` and the `codegraph_rename` MCP tool (dry-run plan by default, atomic apply through verification). Plain language; no internal file paths, symbols, or benchmark numbers.
- [ ] T050 [P] Self-repo dogfood UAT (SC-009 / constitution Dogfooding): run a dry-run — and where safe, an apply — of an internal rename **against this repository itself**; record the outcome in the UAT runbook.
- [ ] T051 [P] Linux (Docker) validation: build a throwaway `node:22-bookworm` image (`.dockerignore` excludes `node_modules`/`dist`/`.git`/`.codegraph`), `npm ci && npm run build`, then `docker run --rm --init` running `npx vitest run __tests__/refactor-plan.test.ts __tests__/refactor-apply.test.ts __tests__/rename-mcp.test.ts`; confirm the write/rename path is green on Linux (`--init` is load-bearing for any process-lifecycle assertion).
- [ ] T052 [P] Windows deferral hygiene: confirm platform-sensitive assertions (path/jail, CRLF/encoding, recovery-dir) are `it.runIf`-gated; record the Windows apply-path validation pass as a tracked follow-up in the UAT runbook (VM suspended — spec Assumptions / design-concept Q10). Do NOT mark any Windows-gated assertion validated without seeing it run.
- [ ] T053 Slice-2 PR packet and final gate: `npm run build && npm test` GREEN; execute quickstart Slice-2 scenarios S2-A…S2-I; assemble the Slice-2 PR review packet (review order apply-ladder→MCP→guidance; FR→file→evidence traceability; verification evidence incl. the T048 A/B numbers and the T050 self-repo dogfood outcome; known gaps = Windows validation; rollback/flag notes = `--include-heuristic` is the only behavior escape); confirm SC-001…SC-010 evidence is captured.

---

## Dependencies & Execution Order

### Phase / slice dependencies

- **Setup (T001)** → **Foundational (T002–T008)** → **US1 (T009–T021)** → **US2 (T022–T027)** — all **Slice 1**, in this order.
- **Slice 1 → Slice 2 boundary is T027** (PR boundary). No Slice-2 task starts until T027 passes.
- **US3 (T028–T042)** → **US4 (T043–T048)** — **Slice 2**.
- **Polish (T049–T053)** after US4 (T053 is the final Slice-2 gate).

### Key within-story dependencies

- T002 blocks all of Phase 2+. T003→(T004,T005); T006→T007.
- US1: (T015,T016,T017,T018) → T019 → T020 → T021.
- US2: T026 extends the T017 file; T027 requires all of T009–T026.
- US3: T028 → T038; (T036,T037,T038) → T039 → (T040, T041) → T042.
- US4: (T020,T041) → T046 → T047 → T048.

### Parallel opportunities

- **Foundational**: T004 and T005 run in parallel (distinct files, tests from T003).
- **US1 impl**: T015, T016, T017, T018 run in parallel (distinct files; depend only on Foundational). T019/T020/T021 are sequential after them.
- **US3 impl**: T036, T037, T038 run in parallel (distinct files; T038 needs T028). T039 onward is sequential.
- **Polish**: T049, T050, T051, T052 run in parallel.
- Test-authoring tasks that share a suite file (`refactor-plan.test.ts` in Slice 1; `refactor-apply.test.ts` / `rename-mcp.test.ts` in Slice 2) are **sequential**, not [P].

## Parallel Example: User Story 1 implementation

```bash
# After Foundational (T002–T008) is complete, launch the four independent Slice-1 modules together:
Task: "T015 src/refactor/lsp-rename.ts — LSP path"
Task: "T016 src/refactor/graph-rename.ts — graph path"
Task: "T017 src/refactor/target-resolver.ts — basic resolution"
Task: "T018 src/refactor/plan-format.ts — table + stable JSON"
# Then converge: T019 plan-engine → T020 index.planRename → T021 CLI rename (dry-run)
```

## Implementation Strategy

### MVP first (Slice 1 = US1 + US2)

1. Setup (T001) → Foundational (T002–T008).
2. US1 (T009–T021) → **STOP and VALIDATE**: reviewable dry-run plans, zero writes, LSP + graph paths.
3. US2 (T022–T026) hardens targeting/refusals → T027 ships **Slice 1 as PR 1** (a complete read-only capability).

### Incremental delivery

- **PR 1 (Slice 1)**: T001–T027 — plan engine + CLI dry-run. Independently valuable, zero write risk.
- **PR 2 (Slice 2)**: T028–T053 — apply ladder (US3) + MCP tool (US4) + polish. The risky write machinery gets its own focused review.

## Notes

- **No DB mocking**: every test uses `fs.mkdtempSync` fixtures + `afterEach` cleanup against real `node:sqlite`.
- **No schema / asset changes**: rename reads existing nodes/edges and writes source files; `QueryBuilder` gains prepared statements only (no new table/column, no `copy-assets` wiring).
- **UTF-16 code units end-to-end** (SPEC-008 pin): no byte↔UTF-16 translation anywhere in plan or apply.
- **Surgical diffs to upstream-owned files** (`src/db/queries.ts`, `src/index.ts`, `src/bin/codegraph.ts`, `src/mcp/tools.ts`, `src/mcp/server-instructions.ts`) stay additive; all new logic lives in `src/refactor/` (constitution Principle III).
- **`isError` discipline** (Principle VI): reserved for the single failed-rollback malfunction (FR-019a). Every other refusal is success-shaped.
- Commit after each task or logical group. Do not expand a slice past the reviewability budget — re-split instead.
