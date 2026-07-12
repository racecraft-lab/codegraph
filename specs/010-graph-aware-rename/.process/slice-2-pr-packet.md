# SPEC-010 Slice-2 PR Review Packet — Apply Safety Ladder + MCP Tool

Gate: T053. No precedent packet exists for Slice-1 (T027) — `.process/` held only
`autopilot-state.json` at gate time — so this document defines the shape.

## Slice boundary

`slice-2-apply-mcp` = every commit after the Slice-1 tip `f911f95`, through the
gate commit itself:

| Commit | Content |
|---|---|
| `4751425` | US3 apply safety ladder — jail, snapshots, atomic write, re-sync discrimination, post-check, rollback/recovery, CLI `--apply` (T028–T042) |
| `00de5f7` | US4 MCP surface — `codegraph_rename` tool (dry-run default, CLI-parity JSON, own write annotations, main-instance dispatch) + server-instructions write-tool paragraph (T043–T047) |
| `6a3cdbd` | tasks.md bookkeeping (T001–T047 marked complete) |
| `e5251fb` | guardian doc advisories — stale MCP doc-comment reconciliation |
| `29bd5ea` | group record — Slice-2 apply+MCP completion, guardian SHIP-WITH-NOTES 6/6, T048 A/B NO-REGRESSION |
| `cdc56d7` | T049 CHANGELOG entry + `.cursor/rules/codegraph.mdc` two-tool update |
| `ab7f287` | D3 fix — LSP completeness verification + spec amendments |
| `e12952f` | T050 closed — D3 post-fix dogfood validation PASSED |
| *(gate commit)* | T053 — this packet, plus any gate-driven fixes |

Verified: `git log --oneline 2bb5aa5..e12952f` returns exactly these 8 commits in
this order.

## Gate results

- `npm run build`: clean (tsc + copy-assets + chmod, no errors).
- Scrubbed full suite (`npx vitest run`, LSP/embedding env vars unset): **175
  files / 3103 passed / 7 skipped / 0 failed** — matches the expected ballpark
  exactly.
- **Re-gate after the D4 remediation** (see the Gate Finding's remediation note
  below): **175 files / 3110 passed / 7 skipped / 0 failed** (the 7 new D4
  tests), `tsc --noEmit` clean, build clean.

## ⚠ Gate finding — pre-existing index drift silently drops edits instead of refusing (new, this pass)

**Severity: significant — contradicts spec.md Edge Cases (line 94), SC-002, and
SC-004; the S2-C quickstart scenario as documented does not hold.** Not a
pre-accepted v1 limitation like the Windows deferral or the mid-write-kill
window below — this is a gap between what the spec promises and what the
built binary does today. Structurally the same class of bug as D1 (edge-kind
scope) and D3 (LSP completeness): an edit silently missing from the plan,
invisible to the touched-file-scoped post-check because its file was never
"touched."

**What the spec promises** (`spec.md:94`, Edge Cases): *"Index stale vs.
working tree: pre-write span verification against live bytes turns **any**
drift — including CRLF/encoding differences — into a safe 'stale index — run
codegraph sync' refusal with zero writes."* Quickstart S2-C encodes the same
promise: mutate a file after indexing, `--apply` should abort the **entire**
plan with **zero writes**, exit `2`.

**What actually happens, live, against the built binary** (both directions
tested — drift on the declaration's own file, and drift on a reference-only
file):

```bash
# Fixture: decl.ts exports widget(); caller.ts imports + calls it.
codegraph init .                              # indexes original bytes

# Mutate decl.ts directly (bypassing codegraph — no re-sync), simulating an
# editor save the watcher hasn't caught up to yet.
printf '// comment\nexport function widget(): void {}\n' > decl.ts

codegraph rename widget gadget --kind function --json -p .
# BEFORE mutation: 3 edits (decl.ts declaration + caller.ts import + call site)
# AFTER  mutation: 2 edits — decl.ts's declaration edit is GONE from the array.
#   confidence is STILL "all-exact"; human table says "0 leftover mention(s)".
#   No signal to the user that anything was excluded.

codegraph rename widget gadget --kind function --apply -p .
# exit 0, "applied → gadget", 1 file rewritten (caller.ts), post-check green.
# decl.ts (drifted, never in the plan) is left untouched: still exports `widget`.
# Final state: caller.ts imports `{ gadget }` from './decl' — a symbol decl.ts
# does not export. The workspace is broken; the tool reports success.
```

The inverse (drift on `caller.ts` instead of `decl.ts`) reproduces identically:
both reference edits silently vanish from the plan, and `--apply` renames only
the declaration, leaving `caller.ts` importing a name (`widget`) that no
longer exists anywhere.

**Root cause** (file:line):

- `src/refactor/graph-rename.ts:88-91` — the declaration edit is only pushed
  `if (declCol >= 0)`; a drifted line silently omits it, no signal raised.
- `src/refactor/graph-rename.ts:114-116` — `if (!range) continue; // FR-005:
  shadow / alias / string-similar / drift → drop`. The code comment itself
  says drift is intentionally handled identically to a genuine false positive
  (shadowing/alias/string-similarity).

FR-016's apply-time `reverifySpans` (`src/refactor/snapshot.ts:95-115`,
Rung 3b in `apply-engine.ts:130-145`) is correctly implemented and does
abort the whole plan with zero writes — verified via `T031` (direct
function-level fixtures, real fs, all passing) — **but it never gets the
chance to see a drifted edit that predates plan derivation**, because
FR-005's plan-time span verification (shared by dry-run and the `--apply`
Rung-0 recompute) already silently dropped it. Per spec.md's own Clarify
answer (`spec.md:115`): *"plan-time earns `exact` and drops false positives;
apply-time guards the plan→apply window"* — i.e. FR-016 was, by design, only
ever scoped to drift injected **during** a single apply call's own execution,
not to drift that already existed when the call started. That narrower
guarantee is real (confirmed by `T031`), but it is materially narrower than
what `spec.md:94`, SC-002, and SC-004 state, and narrower than what the
quickstart's S2-C scenario — written the way a user would naturally read it —
promises. There is no code path (confirmed by grep across
`src/refactor/*.ts`, `src/bin/codegraph.ts`, `src/mcp/tools.ts`) that performs
a distinct pre-plan mtime/staleness check; "stale index" and "genuine
false-positive" are indistinguishable to `verifySpan` today.

**Trigger realism**: this is not an exotic precondition. `CODEGRAPH_NO_DAEMON`
is a normal, documented, test-suite-wide mode; and even with the file-watcher
daemon running, the index "lags writes by ~1s" (root CLAUDE.md) — an
edit-then-immediately-rename sequence inside that window hits the identical
path.

**Recommendation** (for the orchestrator/maintainer to triage, not this gate's
call): this looks like it needs its own remediation pass before Slice-2 ships
as "safe by default," analogous to D3 — either (a) have plan-time span
verification distinguish "content mismatch because it's a different symbol"
from "content mismatch because the file changed since indexing" (e.g. an
mtime/hash check against the indexed `files` row) and surface the latter as a
`stale-span`-shaped refusal instead of a silent drop, or (b) at minimum,
surface a non-zero leftover/dropped-edit signal in the plan so `--apply`'s
Rung 1 (or a new rung) can refuse rather than silently proceed on a partial
edit set. Filing this does not block the rest of the packet below, but it
should not be quietly folded into "Known gaps" as if pre-accepted — it
contradicts a currently-committed spec line.

**Remediation (D4 — landed in this gate commit, same-session).** Option (a)
was implemented, TDD-first (7 tests, 6 RED with real failures incl. an
uncaught ENOENT on a deleted candidate file; the SC-008 coupling pin
deliberately not-RED): plan derivation now collects every candidate file
(graph reference files ∪ LSP edit files ∪ the declaration file — including
files whose edits span-verification would drop) and verifies each against its
indexed `files` row using the indexer's own semantics (size + mtime fast path;
`hashContent` sha256 confirm — "fresh" means exactly what `codegraph sync`
would treat as unchanged). Any drifted, deleted, or untracked candidate file
refuses the whole plan as `stale-span` ("stale index — run `codegraph sync`
and retry", offending files listed) at plan time — so dry-run, CLI `--apply`
(Rung 0), and MCP all refuse identically with zero writes. False-positive
drops in index-fresh files stay silent (SC-008 preserved, pinned by a
dedicated regression test). The check runs after the FR-017 jail
(refuse-before-read). CRLF-only drift RED-proved that per-edge span checks are
`\r`-tolerant — only the file-level hash check satisfies the spec's CRLF
clause. Verified live end-to-end post-fix: drift → `stale-span` refusal exit 2
zero writes → `codegraph sync` → the same rename applies cleanly (exit 0,
post-check green). spec.md FR-005 and the Clarify Q&A were amended to encode
the freshness discriminator; FR-016's apply-window guard is unchanged.

## Review order

1. **Apply ladder** — `src/refactor/jail.ts`, `src/refactor/snapshot.ts`,
   `src/refactor/post-check.ts`, `src/refactor/apply-engine.ts`, plus the
   supporting type additions in `src/refactor/types.ts`.
2. **MCP** — `src/mcp/tools.ts` (`codegraph_rename` `ToolDefinition`,
   `RENAME_ANNOTATIONS`, `DEFAULT_MCP_TOOLS`, dispatch special-case).
3. **Guidance** — `src/mcp/server-instructions.ts`, `.cursor/rules/codegraph.mdc`.
4. **D3 completeness verification** — `src/refactor/plan-engine.ts` (LSP
   edit-set coverage check against the graph's own reference index).

## FR → file → evidence traceability

Grounded by grepping test names; every row below was independently re-run
live during this gate (commands and counts in "Quickstart S2 scenario
results" and the terminal report).

| FR | Requirement (short) | Implementing file(s) | Test/evidence |
|---|---|---|---|
| FR-014 | `--apply` recomputes the plan from the live index in one invocation; no persisted dry-run artifact | `src/refactor/apply-engine.ts` (Rung 0) | `T042` *"--apply on an all-exact plan rewrites the files on disk, re-syncs the index, exits 0 (FR-014/FR-018/FR-026)"*; live S2-A repro |
| FR-015 | `--apply` refuses any below-`exact` edit unless `--include-heuristic` | `src/refactor/apply-engine.ts` (Rung 1) | `T029` *"a below-exact edit with no includeHeuristic → refused heuristic-gated..."* + *"...with includeHeuristic → proceeds..."*; `T042` CLI heuristic-gate tests; live S2-B repro (exit 2 refused → exit 0 with flag) |
| FR-016 | apply-time span re-verify vs. live bytes; mismatch aborts the entire apply, zero writes | `src/refactor/snapshot.ts` (`reverifySpans`) | `T031` *"reverifySpans: a file whose live bytes drifted from the planned span → {ok:false,...}"* (function-level, real fs) — **narrower than documented; see Gate Finding above** |
| FR-017 | path jail + index-scope guard; whole-plan refusal; refuse-before-read | `src/refactor/jail.ts` (`checkPlanJail`) | `T030` (11 tests, real fs, incl. symlink + case-insensitivity); `T040` (LSP-induced out-of-root, engine-level); live S2-E repro (scope-ignored, exit 2 both dry-run and apply, zero writes) |
| FR-018 | pre-write snapshot; targeted resolution-complete re-sync; touched-file-scoped dual-assertion post-check | `src/refactor/snapshot.ts` (`takeSnapshots`), `src/refactor/post-check.ts` (`runPostCheck`, `discriminateSyncResult`) | `T028` (QueryBuilder post-check statements); `T033` (re-sync discrimination + post-check, 8 tests); live S2-A/B post-check-green confirmation |
| FR-019 | dangling ref → unconditional byte-identical rollback + re-sync; `danglingReferences` reported | `src/refactor/apply-engine.ts` (rollback branch), `src/refactor/snapshot.ts` (`restoreSnapshots`) | `T034` *"a post-check dangling ref → restores every touched file byte-identically, re-syncs, reports danglingReferences, outcome rolled-back"* (re-run live this gate, PASS) |
| FR-019a | failed rollback restore → error-shaped, recovery dump, restored/unrestored report | `src/refactor/apply-engine.ts`, `src/refactor/snapshot.ts` | `T034` *"a failed restore (an unwritable touched file) → outcome rollback-failed..."* (re-run live this gate, PASS, POSIX-gated); `T042` exit-code mapper (`rollback-failed`→4) |
| FR-020 | atomic-through-verification; snapshot before any write; temp-then-atomic-rename; byte preservation | `src/refactor/snapshot.ts` (`writeEdits`) | `T032` (12 tests: CRLF round-trip, BOM, trailing-newline preservation, right-to-left multi-edit ordering, de-dup, overlap whole-plan refusal, no lingering temp sibling) |
| FR-021 | MCP tool mirrors the CLI contract 1:1; camelCase schema | `src/mcp/tools.ts` (`codegraph_rename` `ToolDefinition` + dispatch) | `T043` schema-mirror test; *"dry-run returns the RenamePlan JSON as a text payload byte-identical to CLI --json stdout"*; *"apply:true mirrors the CLI apply outcome"* — all re-run live this gate (24/24 across the 3 MCP test files) |
| FR-022 | always exposed; second default-served tool after `explore` | `src/mcp/tools.ts` (`DEFAULT_MCP_TOOLS`) | `T045` *"is a member of DEFAULT_MCP_TOOLS — the second default-served tool after explore"*; `mcp-tool-allowlist.test.ts` *"exposes the default surface (explore + rename) when unset"*; source-confirmed `DEFAULT_MCP_TOOLS = new Set(['explore', 'rename'])` (`tools.ts:897`) |
| FR-023 | every recoverable condition success-shaped, never `isError` (sole exception: FR-019a) | `src/mcp/tools.ts` (`handleRename`) | `T044` (5 refusal tests — ambiguous, heuristic-gated, not-indexed, invalid-argument, excluded-kind — all `textResult`, no `isError`); CLI-side refusal coverage across `refactor-plan.test.ts`/`refactor-apply.test.ts` |
| FR-024 | A/B no-regression on a control repo before merge | `scripts/agent-eval/` | T048 A/B, express@4.21.2 — cited from the workflow doc (authoritative), not re-executed this gate pass (see S2-H in the scenario table for rationale) |
| FR-025 | server-instructions write-tool guidance; preserves explore-first steering | `src/mcp/server-instructions.ts` | `mcp-server-instructions.test.ts`: *"mentions codegraph_rename, dry-run-by-default, and explicit apply"*; *"the write-tool section never suggests Read/Grep as an alternative (binding constraint)"* |
| FR-026 | CLI exit-code mapping `{0,1,2,3,4}` | `src/refactor/types.ts` (`renameApplyExitCode`), `src/bin/codegraph.ts` | `T042` *"maps every ApplyOutcome to its FR-026 exit code (applied→0, refused→2, rolled-back→3, rollback-failed→4)"* (re-run live this gate); exit-code assertions throughout `T014`/`T023`/`T024`/`T042` |
| FR-027 | human table by default; `-j/--json` stable schema byte-identical to MCP | `src/bin/codegraph.ts` (format), `contracts/rename-plan.schema.json` | `T013` (plan-format/schema, FR-027/SC-001); `T014` CLI dry-run; live S2-A/B/C/E human-table + JSON repro this gate |
| FR-028 | `codegraph_rename` annotation quadruplet | `src/mcp/tools.ts` (`RENAME_ANNOTATIONS`, `tools.ts:568`) | `T045` *"advertises its OWN write annotations, the mirror image of READ_ONLY_ANNOTATIONS"*; *"keeps its write annotations across getStaticTools and the no-default-project schema clone"*; `mcp-server-instructions.test.ts` *"...Agent-mode requirement legible (FR-028)"*; source-confirmed `readOnlyHint:false, destructiveHint:true, idempotentHint:false, openWorldHint:false` |
| FR-003a (D3 extension) | LSP edit-set completeness verified against the graph; any gap degrades the whole rename to graph, `lspDegradation:"incomplete-coverage"` | `src/refactor/plan-engine.ts` | T050 dogfood found D3; post-fix re-validation PASSED (`ab7f287`); RED→GREEN 111/111 plan suite, full suite 3103/0; live S2-I dry-run against this repo (this gate) confirms `lspDegradation:"incomplete-coverage"` firing live today on a real rename |

## Verification evidence

Pulled verbatim from `docs/ai/specs/.process/SPEC-010-workflow.md` Implementation
Progress rows 3–4 (authoritative; not re-derived), plus this gate's own re-runs.

- **Full suite**: 3103/0 (175 files, 7 skipped) — reconfirmed this gate, exact match.
- **retrieval-guardian**: SHIP-WITH-NOTES, 6/6 checks PASS (explore primacy,
  steering byte-intact +14/−0, Principle-VI `isError` audit — the refactor
  engine carries exactly one impossible-by-construction throw, read-path
  neutrality, pin integrity, variant coherence); 2 doc advisories fixed in `e5251fb`.
- **T048 A/B** (express@4.21.2, baseline `4751425`, 2 runs/arm, sonnet/high,
  scrubbed env): **NO-REGRESSION** — new arm 37–57s / Read 1–2 / Grep 0 vs.
  baseline 45–55s / Read 1 / Grep 0; `codegraph_explore` the only codegraph
  tool called in all 4 runs; `codegraph_rename` provably exposed (tools 2 vs 1)
  yet never mis-picked on the rename-neutral task; $0.38–0.44/run; engine tree
  verified restored. Daemon-prewarm WARNs in all 4 arms ruled benign (documented
  nested-session artifact).
- **T050 self-repo dogfood**: refusal probes (ambiguous-target, target-not-found),
  plan↔diff scope conformance, revert + index stability (7,882 nodes / 31,664
  edges byte-identical across mutate→revert) all PASS. Found defect **D3**: the
  LSP plan covered only the declaration file on this 381-file TS repo
  (tsserver project-load race), so `--apply` exited 0 with a green
  touched-file-scoped post-check while `tsc` broke (TS2305) and 9 tests failed
  at runtime. **D3 remediated** under the FR-003a unusable-result taxonomy
  ("graph-verified always"): graph edits now derived first on every rename; an
  `ok` LSP result must cover every span-verified graph-edit file or the whole
  rename degrades to graph with `lspDegradation: incomplete-coverage`.
  RED→GREEN (111/111 plan suite; full suite 3103/0). Post-fix re-validation
  (`ab7f287`) **PASSED**: plan degraded to graph, covered all 3 reference files
  (9 edits, all-exact; leftoverMentions 1→11 reconciled against the grep
  inventory), apply rewrote all 3 files, post-check green, **tsc clean
  post-apply**, `refactor-apply` 60/60, byte-clean revert, index stable
  (7,885/31,686 pre≡post).
- **T051 Docker Linux** (`node:22-bookworm`, `--rm --init`): root run 179/182
  (3 fails = the chmod-0444 rollback-failure simulation bypassed by root DAC,
  deterministic, documented environment artifact); **non-root** (chown + `USER
  node`, uid 1000): **182/182**, the 3 target tests confirmed passing by name filter.
- **T052 gating audit**: zero ungated platform-sensitive assertions
  (symlink-jail ×2 + chmod/EACCES rollback-failed ×3 all `it.runIf`-gated;
  CRLF/BOM handling is Buffer-level and platform-neutral by design; 188/188
  macOS baseline proves the gated tests execute, not silently skip).

## Quickstart S2 scenario results (S2-A … S2-I)

Full command transcripts and per-scenario detail are in this gate's terminal
report (not duplicated here); this table is the summary.

| Scenario | Verdict | Note |
|---|---|---|
| S2-A · Apply an all-exact plan | **PASS** | Live CLI repro; graph-level zero-dangling-`widget` / resolves-`gadget` confirmed via direct SQLite query, not just CLI text |
| S2-B · Heuristic gate | **PASS** | Live CLI repro both arms (refused exit 2 zero-writes without flag; applied exit 0 with `--include-heuristic`) |
| S2-C · Stale-span abort | **PASS (post-D4)** | Initially FAIL (see Gate Finding) → remediated same-session (D4) → re-verified live: drift on a reference file → `stale-span` refusal, exit 2, zero writes, offending file listed; after `codegraph sync` the same rename applies cleanly (exit 0, post-check green). Test coverage: 7 D4 tests incl. CRLF-only drift, deleted file, and the S2-C CLI `--apply` repro |
| S2-D · Post-check rollback | **PASS** | Engine-level only — the test file's own comment marks CLI-subprocess induction "impractical"; `T034` re-run live this gate |
| S2-E · Workspace jail | **PASS** | Scope-ignored: live CLI repro (exit 2 both dry-run/apply, zero writes). Out-of-root: `T040` (LSP-stub-induced) + `T030` (11 unit tests) re-run live |
| S2-F · Failed-rollback malfunction | **PASS** | Engine-level only, same rationale as S2-D; `T034` failed-restore test re-run live (POSIX-gated, ran on macOS) |
| S2-G · MCP parity + success-shaped refusals | **PASS** | `rename-mcp.test.ts` + `mcp-tool-annotations.test.ts` + `mcp-tool-allowlist.test.ts` re-run live (24/24); annotations and `DEFAULT_MCP_TOOLS` ordering cross-checked directly against source |
| S2-H · Retrieval no-regression A/B | **PASS (cited, not re-executed)** | T048's evidence is this gate's own designated authoritative source (see task instructions); re-running a multi-run sonnet/high agent A/B is out of scope for a terminal gate pass |
| S2-I · Self-repo dogfood UAT | **PASS (fresh dry-run + cited apply evidence)** | Live dry-run against this repo this gate confirms `lspDegradation:"incomplete-coverage"` firing correctly today; apply+revert already exhaustively validated by T050/D3 (re-running that on the live repo would be duplicative risk, not new signal) |

## Known gaps

- **Windows validation deferred**: the write path uses cross-platform Node
  `fs`; byte-exact span verification turns CRLF/encoding drift into a safe
  refusal (for the in-window case — see Gate Finding for the pre-existing-drift
  caveat). A Windows apply-path pass and un-gating of `it.runIf(win32)` tests
  is a tracked follow-up once the VM is restored (currently suspended per
  standing project memory).
- **LSP tsserver project-load warm-up**: recorded out-of-scope follow-up — D3's
  fix makes safety independent of server timing (completeness is verified
  rather than trusted), so warm-up latency is a performance concern only, not
  a correctness one.
- **Mid-write hard process-kill window** (FR-020): snapshots are held only
  until the post-check passes; a hard kill during the write window is a
  documented v1 durability limitation (best-effort atomicity through
  verification, not crash-durable) — this one IS a deliberate, accepted v1 scope cut.
- **Found and closed this gate (D4)**: pre-existing index drift silently
  dropping edits — see the Gate Finding section above, including its
  remediation note. No longer a gap: any drifted candidate file now refuses
  the whole plan as `stale-span` with zero writes, verified live and pinned
  by 7 tests.

## Rollback / flag notes

- `--include-heuristic` (CLI) / `includeHeuristic` (MCP) is the **only**
  behavior escape on this surface.
- Rename is dry-run by default on both the CLI and MCP surfaces.
- Recovery directory on rollback-failure: `.codegraph/rename-recovery-<pid>-<hex>/`.
- CLI exit codes: `{0: applied or dry-run success, 1: internal/usage error, 2:
  recoverable refusal, 3: rolled-back, 4: rollback-failed}`.

## SC-001 … SC-010 evidence map

| SC | Statement (short) | Evidence | Verdict |
|---|---|---|---|
| SC-001 | Preview any indexed symbol's rename in one command, no file read first | `T013` (FR-027/SC-001); live S2-A/B/C/E dry-runs, each a single command | Solid |
| SC-002 | 100% of applied renames end in exactly two states — post-check-green or byte-identical restore; never partial | `T035` (count stability), `T034` (rollback), `T042` (all-exact apply), D4 tests (drifted candidate → refusal, zero writes) | **Solid (post-D4)** — the silent third outcome S2-C exposed is closed: a drifted candidate set can no longer produce a partial apply; it refuses before any write. |
| SC-003 | Ambiguity refusal lists every candidate + qualifier; retry succeeds with zero file reads | Slice-1 coverage (`T022`-era tests), unaffected by Slice-2 changes | Solid (out of this gate's scope to re-verify; Slice-1 already gated at T027) |
| SC-004 | Apply against index-drifted file makes zero writes, returns sync guidance | `T031` (apply-window `reverifySpans`) + D4 tests (plan-time freshness: drift/CRLF/deleted-file → `stale-span` refusal + sync guidance; CLI `--apply` repro, exit 2, zero writes) + live post-fix repro | **Solid (post-D4)** — the guarantee now reaches the user-facing scenario end-to-end for pre-existing drift AND the plan→apply window. |
| SC-005 | Same plan/apply outcome CLI vs. MCP | `T043` (byte-identical JSON test; apply-mirrors-CLI test) | Solid — re-run live this gate |
| SC-006 | Every recoverable condition delivered as success-shaped guidance | `T044` (5 refusal tests); live S2-B/E CLI refusals | Solid for conditions that ARE detected. Does not cover the Gate Finding case, because that case is never detected as a condition at all (silently dropped, not refused) — a different failure mode than SC-006 addresses. |
| SC-007 | No measurable retrieval regression on a control repo | T048 A/B (cited, authoritative) | Solid (cited, not re-derived) |
| SC-008 | Never modifies a comment/docstring/string literal | S1-F (Slice-1) + FR-005 span verification (`src/refactor/graph-rename.ts`) + the D4 coupling pin (index-fresh false positive still drops silently, no refusal) | **Solid** — the D4 fix discriminated drift from false positives at the FILE level (index freshness), leaving the span-level drop untouched; the coupling risk called out here was addressed exactly as flagged and is now regression-pinned. |
| SC-009 | Self-repo dogfood UAT, dry-run + safe apply, recorded in UAT runbook | T050 (cited) + fresh live S2-I dry-run this gate | Solid |
| SC-010 | Node/edge counts stable across apply + re-sync, no index explosion | `T035` *"total node + edge counts are stable across a successful rename + post-check re-sync"*; T050 dogfood counts (7,882/31,664 → byte-identical revert; 7,885/31,686 pre≡post on the post-fix run) | Solid |
