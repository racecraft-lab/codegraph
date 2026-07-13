---
feature: SPEC-010 — Graph-Aware Rename
branch: 010-graph-aware-rename
date: 2026-07-12
completion_rate: 100%
spec_adherence: 100%
requirements_total: 41
requirements_implemented: 41
requirements_modified: 0
requirements_partial: 0
requirements_not_implemented: 0
requirements_unspecified: 0
critical_findings: 0
significant_findings: 6
minor_findings: 3
positive_findings: 7
---

# Retrospective: SPEC-010 — Graph-Aware Rename

## Executive Summary

53/53 tasks complete (T001–T053), all 7 SDD phases and gates G0–G7 PASS, and every
one of the 31 functional-requirement IDs (FR-001…FR-028 plus the sub-lettered
FR-003a/FR-019a/FR-021a) and 10 success criteria (SC-001…SC-010) in the final
`spec.md` is implemented and evidenced — **spec adherence 100%, task completion
100%**. Independent re-verification (`speckit.verify.run`, `speckit.verify-tasks.run`,
a full-branch code review, and this retrospective's own spot-checks) corroborates
rather than merely repeats the implementer's claims: `tsc --noEmit` is clean at the
current commit, no `TODO`/`FIXME` remain in `src/refactor/`, and the three commits
after the last gated full-suite run (`eea5e1f`, 3117/0) touch only docs/process
files — the 3117/0 figure still holds at HEAD.

The real story is not "everything went to spec on the first pass" — it didn't. Five
defect batches (D1–D5) were found by the workflow's *own* gates (Slice-1 UAT,
self-repo dogfood, the Slice-2 final gate's own quickstart scenario, and a
post-implementation code review) and TDD-remediated same-session, every time. Two
of them (D3, D4) were genuine correctness bugs that would have shipped a rename
that silently corrupted a codebase while reporting success — exactly the failure
mode SC-002/SC-004 exist to prevent. That they were caught before merge, by gates
the spec itself mandated (self-repo dogfood per the constitution's binding
Dogfooding clause; the Slice-2 quickstart scenario), is the strongest evidence in
this run that the gate ladder is doing real work, not ceremony.

Two things are **not** done: PR #43 (slice-1 → `main`) and PR #44 (slice-2 → #43,
stacked) are both still **OPEN**, unreviewed, unmerged as of this writing — the
Post-Implementation Checklist's final two boxes ("PR(s) created and reviewed" /
"Merged to main; dogfood loop run") are correctly unchecked in the workflow file.
The reviewable-LOC ceiling was exceeded roughly 4× per slice against the original
405-line scaffold estimate — disclosed prominently in both PR packets, but worth
a root-cause look below since it will recur on the next spec if the estimator's
blind spot isn't addressed.

## Proposed Spec Changes

**None.** `spec.md` is already the ratified, amended-in-session record: every
defect (D1–D5) that changed behavior was folded back into `spec.md` /
`data-model.md` in the same commit as its fix (e.g. FR-003a's
`lspDegradation: incomplete-coverage` from D3, FR-005's freshness discriminator
from D4, the `writeFailure` cause and `lspDegradation: overlapping-edits` from
D5). There is no implemented behavior that spec.md doesn't already describe, and
no spec'd behavior that implementation doesn't satisfy. The Human Gate (Step 13)
is therefore not invoked — there is nothing to confirm.

## Requirement Coverage Matrix

All 31 `FR-*` IDs and all 10 `SC-*` IDs in `spec.md` (grep-verified counts, no
missing IDs). Status legend: **I** = Implemented, **M** = Modified (implemented via
a same-session amendment after a gate found a gap), all others 0.

| ID | What it guarantees (short) | Status | Primary file(s) | Evidence |
|---|---|---|---|---|
| FR-001 | Dry-run is the default; no writes without `--apply` | I | `plan-engine.ts`, `bin/codegraph.ts` | T014; UAT Step 1 |
| FR-002 | Every edit: file, range, before/after, tier | I | `types.ts`, `plan-format.ts` | T013; UAT Step 1 |
| FR-003 | LSP path when covered, graph otherwise, no allowlist | I | `plan-engine.ts`, `lsp-rename.ts` | T009; UAT Step 2 |
| FR-003a | Availability-probe fork + runtime-failure degrade, never fails the command; **completeness-verified** (D3) | M | `lsp-rename.ts`, `plan-engine.ts` | T010; D3 fix `ab7f287`; UAT Step 2 |
| FR-004 | Deterministic `resolvedBy`→tier table; synthesized/file-path edges never candidates | I | `confidence.ts` | T003/T004; Clarify S1 |
| FR-005 | Span verification excludes false positives; **file-level freshness discriminator** (D4) | M | `span-verify.ts`, `graph-rename.ts`, `plan-engine.ts` | T025; D4 fix `acf1a60`; UAT Step 7/10 |
| FR-006 | Name / `Class.method` / `--file` / `--kind` targeting | I | `target-resolver.ts` | T017; UAT Step 4/5 |
| FR-007 | Ambiguity refusal lists every candidate + selecting qualifier | I | `target-resolver.ts`, `plan-format.ts` | T022; D2 fix; UAT Step 4 |
| FR-008 | No interactive picker on any surface | I | `target-resolver.ts` | T022 |
| FR-009 | LSP path can rename locals/parameters | I | `lsp-rename.ts` | T023 |
| FR-010 | Graph path refuses locals/parameters with reason | I | `target-resolver.ts` | T023; UAT Step 5 |
| FR-011 | `file`/`route`/`import`/`export` refused on every path | I | `target-resolver.ts` | T023; UAT Step 5 |
| FR-012 | Comments/docstrings/strings never edited | I | `graph-rename.ts` | T011; UAT Step 7 |
| FR-013 | Leftover mentions counted, never edited | I | `graph-rename.ts`, `plan-format.ts` | T011; UAT Step 7 |
| FR-014 | `--apply` recomputes the plan; no persisted plan file | I | `apply-engine.ts` | T039; UAT Step 8 |
| FR-015 | All-`exact` gate; `--include-heuristic` escape | I | `apply-engine.ts` | T029; UAT Step 9 |
| FR-016 | Apply-time re-verification against live bytes | I | `apply-engine.ts`, `span-verify.ts` | T031; UAT Step 10 |
| FR-017 | Workspace-root jail + scope-matcher; refuse-before-read | I | `jail.ts` | T030/T036; UAT Step 12 |
| FR-018 | Snapshot → targeted re-sync → touched-file post-check | I | `apply-engine.ts`, `post-check.ts` | T028/T033; UAT Step 8/11 |
| FR-019 | Post-check failure → byte-identical restore, report dangling refs | I | `snapshot.ts`, `apply-engine.ts` | T034; UAT Step 11 |
| FR-019a | Failed-restore malfunction: `isError`/exit 4, recovery dir, no rename-retry invitation | I | `snapshot.ts` | T034; Clarify S2 (human-ratified); UAT Step 13 |
| FR-020 | Atomic through verification; byte-preservation; descending write order; overlap handling | I | `snapshot.ts` | T032; UAT Step 8/10/11 |
| FR-021 | MCP tool mirrors CLI contract 1:1 (camelCase) | I | `mcp/tools.ts` | T043; UAT Step 14 |
| FR-021a | Invalid-argument refusal (`newName`, no-op, unrecognized `kind`) w/ `validKinds` | I | `target-resolver.ts` | T024; UAT Step 6 |
| FR-022 | `codegraph_rename` always default-served (2nd tool, after `explore`) | I | `mcp/tools.ts` | T045; UAT Step 14 |
| FR-023 | Every recoverable condition success-shaped, never `isError` (except FR-019a) | I | `mcp/tools.ts` | T044; UAT throughout |
| FR-024 | No retrieval regression from the enlarged default tool set | I | (A/B harness, no src) | T048 A/B NO-REGRESSION |
| FR-025 | Agent guidance describes the tool without diluting explore-first steering | I | `mcp/server-instructions.ts` | T047; retrieval-guardian 6/6 |
| FR-026 | Distinct exit codes per outcome (0/1/2/3/4) | I | `bin/codegraph.ts`, `types.ts` | T014 (0/1/2), T042 (3/4) |
| FR-027 | Human table default; `-j/--json` stable schema, byte-identical to MCP | I | `plan-format.ts`, `contracts/rename-plan.schema.json` | T013; T043 byte-parity test |
| FR-028 | Write-tool annotations: `readOnlyHint:false`/`destructiveHint:true`/`idempotentHint:false`/`openWorldHint:false` | I | `mcp/tools.ts` | T045; Clarify S3 (human-ratified) |
| SC-001 | Preview any symbol in one command, zero files read first | I | — | T013; live dry-runs |
| SC-002 | 100% of applies end in exactly 2 states, never partial | M | — | T035; **closed by D4** (see below) |
| SC-003 | Ambiguity refusal + qualifier retry, zero reads | I | — | T022 (Slice 1, unaffected by Slice 2) |
| SC-004 | Drifted file → zero writes + sync guidance | M | — | T031; **closed by D4** |
| SC-005 | CLI ≡ MCP, byte-identical | I | — | T043 |
| SC-006 | Every *detected* recoverable condition is success-shaped | I | — | T044 |
| SC-007 | No control-repo retrieval regression | I | — | T048 (express@4.21.2, 2 runs/arm) |
| SC-008 | Never edits comment/docstring/string | I | — | Slice-1 S1-F; D4 coupling pin holds the span-level/file-level split |
| SC-009 | Self-repo dogfood UAT recorded | I | — | T050; found+fixed D3 |
| SC-010 | Node/edge counts stable across apply+re-sync | I | — | T035; T050 (7,882/31,664 → 7,885/31,686 byte-stable across the D3 mutate-revert cycle) |

**Total Requirements** = 41 (31 FR + 10 SC). IMPLEMENTED = 41, MODIFIED = 4 (FR-003a,
FR-005, SC-002, SC-004 — each closed by a same-session defect fix, now fully
conformant to the *current*, amended spec text), PARTIAL/NOT_IMPLEMENTED/UNSPECIFIED
= 0.

**Spec Adherence % = ((41 + 4·0 + 0×0.5) / (41 − 0)) × 100 = 100%.** (MODIFIED items
count identically to IMPLEMENTED in the formula since they fully satisfy the current
spec; they are called out separately here because the path to 100% went through a
same-session spec amendment, which is the more interesting fact than the number
itself.)

## Success Criteria Assessment

All 10 SC statements are met at HEAD. Two required a same-session close (see
Significant Deviations, D4); both are now regression-pinned by tests that assert
the specific failure mode found.

| SC | Verdict | Note |
|---|---|---|
| SC-001, SC-003, SC-005, SC-006\*, SC-007, SC-008, SC-009, SC-010 | Solid | No qualification |
| SC-002 | Solid, post-D4 | A silent third outcome (drifted file dropped from the plan without refusal, apply "succeeds," workspace left broken) existed until D4; now structurally closed |
| SC-004 | Solid, post-D4 | The original guard only covered the plan→apply window (FR-016); D4 added the plan-time file-freshness check for drift that pre-dates the dry-run itself |

\* SC-006 covers conditions that are *detected*; see the D4 root-cause note — the
whole point of D4 was that the pre-fix code detected nothing, so SC-006 was
technically unfalsified while SC-002/SC-004 were silently broken. This is a good
illustration of why success criteria need to be checked as a *set*, not
independently — a passing SC-006 test suite gave false confidence until SC-002/004
were checked against the same scenario.

## Architecture Drift

`plan.md`'s Project Structure section names 12 new `src/refactor/` modules (8
Slice-1 + 4 Slice-2) plus 5 additive upstream edits. Actual `src/refactor/` at HEAD
has exactly those 12 files, no more, no fewer, same names, same slice split:

| Planned | Actual | Drift |
|---|---|---|
| 12 `src/refactor/` modules (8+4) | 12 modules present (verified `ls`) | None — structure held exactly |
| `span-verify.ts` as the sole Slice-1→Slice-2 shared seam | Confirmed; T040 additively wires `plan-engine.ts → jail.ts` as the one pre-accepted exception | None — the one exception was planned as an exception (Clarify S3 / plan.md Structure Decision), not discovered as drift |
| 5 additive upstream edits (`queries.ts`, `index.ts`, `codegraph.ts`, `mcp/tools.ts`, `server-instructions.ts`) | Same 5 files touched, diffstat shows additive-only shape (`+159`, `+69`, `+102`, `+166/−?`, `+19/−?`) | None |
| ~405 reviewable LOC total, ~200/slice | Slice-1 src **+1,683** (tests +2,315); Slice-2 src **+1,419/−46** (tests +2,624/−72) | **~4× overrun on src alone, ~10× counting tests** — see D-LOC below |

Structurally, the plan was followed with unusual fidelity — no new files, no
renamed files, no unplanned cross-imports beyond the one pre-approved exception.
The drift is entirely in *size*, not *shape*.

## Significant Deviations

All SIGNIFICANT items below were caught by the workflow's own gates and remediated
with TDD (failing test reproducing the exact defect → fix → green) in the same
session they were found, per the Implementation Progress record and independently
re-confirmed by `speckit.verify-tasks.run` and a full-branch code review.

| ID | Found by | What was wrong | Fix | Evidence it's closed |
|---|---|---|---|---|
| D1 | Slice-1 UAT | Plan derivation only considered `references`-kind edges; `calls`/`imports`/`extends`/`implements` sites got no edits — would have invalidated FR-018's "touched-file set covers every reference" premise at apply time | Empirically-probed `RENAME_RELEVANT_EDGE_KINDS` widening, with span-verify as the safety filter against over-inclusion | `f911f95`; 172/172 full suite ×2 |
| D2 | Slice-1 UAT | Human-readable refusal output omitted `candidates`/`validKinds`/`files`/`gatedEdits` payloads — FR-007's "teaches the retry without a file read" guarantee broken on the human surface | `renderRefusal` added to `plan-format.ts` | `f911f95` |
| D3 | Self-repo dogfood (SC-009, this repo, 381 TS files) | `tsserver` queried before full project load returned file-local-only edits; code trusted any `ok`-status LSP result unconditionally → `--apply` exited 0, post-check green, but `tsc` broke (TS2305) and 9 tests failed at runtime. **A rename that reports success while silently corrupting the codebase** | Plan derivation now cross-checks LSP edit-set file coverage against the graph's own reference index; any gap degrades the whole rename to the graph path, surfaced as `lspDegradation: incomplete-coverage` | `ab7f287` fix, RED→GREEN 111/111; `e12952f` post-fix re-run: tsc clean, 60/60, byte-clean revert |
| D4 | Slice-2 final gate, quickstart scenario S2-C | Pre-existing index drift (a file mutated on disk without a re-sync) was silently conflated with the FR-005 span-level false-positive drop — the drifted file's edit just vanished from the plan with no refusal; apply then "succeeded" against a workspace missing one of three needed edits | Plan-time file-level freshness check (indexer's size+mtime fast path + `hashContent` sha256) over every candidate file; any drift/delete/untrack → whole-plan `stale-span` refusal | `acf1a60`; 7 TDD tests incl. a CRLF RED-proof and a latent-ENOENT RED-proof; live CLI loop re-verified |
| D5 (batch) | Post-implementation full-branch code review (independent of the implementing session) | 4 findings: (a) a mid-write I/O error (disk full/EACCES/lock) could leave a genuinely partial workspace with no recovery path; (b) LSP file-URI→path comparison wasn't separator-normalized (would misbehave on Windows); (c) two concurrent applies on one process weren't serialized; (d) a genuinely-overlapping LSP edit set wasn't caught until the write layer | (a) routes through the existing rollback ladder with a new `writeFailure` cause; (b) `normalizePath` reuse; (c) a dedicated `applyMutex`; (d) plan-time degrade to graph via `lspDegradation: overlapping-edits` | `eea5e1f`; targeted 204/204, full suite 3117/0 |
| Reviewability ceiling | Post-implementation reviewability diff gate (#91) | Actual reviewable size ~4× the 405-line scaffold estimate per slice (src only; ~10× counting tests) | Disclosed prominently in both PR packets with review-order + FR-traceability as navigation mitigation; the ratified 2-slice split and the atomicity classifier's advisory `one-navigable-PR` dissent both stand as recorded | Both packets lead with the disclosure; not a code defect, an estimation-accuracy gap (see Root Cause below) |

## Innovations and Best Practices

| What improved | Why it's better | Reusability | Constitution candidate? |
|---|---|---|---|
| LSP-vs-graph completeness verification (`lspDegradation` field, from D3) | The original plan trusted a well-formed LSP response as complete; nothing in `plan.md` anticipated a server returning `ok` with a *partial* answer. This closes a whole failure class — "server responded, but wrong" — not just the one instance found | Directly reusable pattern for any future SPEC that forks between an external tool and the graph as ground truth | Worth proposing as a Principle V corollary: **"a well-formed external answer is not automatically a complete one — verify coverage against the graph before trusting it."** Currently implicit in FR-003a; could be promoted |
| File-level freshness discriminator, separate from span-level false-positive exclusion (D4) | Keeps the fix to one additional check (file hash) rather than conflating two genuinely different conditions (a false positive vs. stale data) under one span-level test — a clean Simplicity-First fix, not a broadened heuristic | Applicable to any future write-path feature that reads live files against an index | No — this is FR-005-specific machinery, not a general principle |
| Reused `indexMutex` + shared `CodeGraph` instance for watcher/apply serialization instead of new locking (data-integrity consensus #8) | Explicitly rejected two heavier alternatives (holding the mutex across the write window — would deadlock since `sync()` re-acquires it; suspending the watcher — no pause surface exists) in favor of discriminating an existing zero-shape signal (`filesChecked:0 && durationMs:0`) already produced by lock contention | Strong precedent for "check whether the existing signal already tells you what you need before adding a new mechanism" | Good concrete example for Principle II training material |
| Consensus protocol routed all 4 security-tagged Clarify/Checklist items to human ratification rather than auto-resolving | FR-019a (rollback-failure shape), FR-017 (LSP-jail semantics ×2), FR-028 (write-tool annotations) all went through 3/3 or 2/3 analyst agreement *and then* an explicit human "Adopt consensus draft" — the protocol worked as designed, not just as documented | This is the existing consensus protocol working correctly — no new pattern, but a clean validation instance worth citing | N/A — already constitutional |
| Self-repo dogfooding caught D3 (and the D4-adjacent gate scenario) | Automated tests alone did not catch either — D3 needed a real 381-file TypeScript project with a real, not-yet-warmed-up `tsserver`; no synthetic fixture reproduces server timing races | Validates the constitution's binding Dogfooding clause as substantively useful on this spec, not ceremonial | N/A — already constitutional (this *is* the evidence for it) |
| Fallback evidence chains for every absent runner mutation op | 7+ instances (`generate-spec-index-write`, `generate-pr-body`, `estimate-spec-size`, `reviewability-gate` tasks-mode, `generate-uat-skeleton`, `final-reviewability-backstop`) across the whole run, every one disclosed with a named fallback rather than silently skipped | Kept the audit trail intact despite a real, pervasive tooling gap (see Root Cause below) | N/A — process resilience, not product code |
| `RENAME_RELEVANT_EDGE_KINDS` widening (D1) | Empirically probed rather than guessed — the fix was derived from what edge kinds the graph actually carries for a reference, not a speculative superset | Candidate for the same review in any future graph-consuming write feature | N/A |

## Root Cause Analysis

| Deviation | Discovery point | Cause | Prevention recommendation |
|---|---|---|---|
| D1, D2 | Implementation (Slice-1 UAT, a dry-run step inside T027's own gate) | Spec gap: FR-018's "touched-file set" premise assumed `references`-kind edges were the complete picture; FR-007's refusal-payload requirement was implemented on the JSON surface first and the human-table surface lagged | Add an explicit "assert the human and machine surfaces carry the same payload fields" test earlier in TDD sequencing for any dual-surface (CLI table + JSON/MCP) feature — this exact class of gap (one surface complete, the other silently thinner) is cheap to catch with a snapshot-diff test and expensive to catch by inspection |
| D3 | Testing (self-repo dogfood, SC-009) | Tech constraint: `tsserver`'s project-load timing is not deterministic and no synthetic fixture reproduces it; the spec's FR-003a already had a *runtime-failure* degradation path but hadn't anticipated a *well-formed-but-incomplete* response as a distinct failure mode | This is precisely why constitution's Dogfooding clause is binding, not optional — keep it that way. For future LSP-dependent specs, explicitly design a "response completeness" check into the plan phase rather than treating a non-error LSP response as trustworthy by default |
| D4 | Testing (Slice-2 final gate, quickstart scenario S2-C — i.e., the workflow's own prescribed scenario list, not an ad hoc find) | Spec gap: FR-005's span verification was designed as a per-span exclusion filter; nothing in the original FR-005/FR-016 pairing considered "the candidate file itself is stale before the plan is even built," only the plan→apply window (FR-016) | Any span-verification design that reads live files against an index should explicitly separate "is this span a false positive" from "is this file's index entry even current" as two distinct checks from the start — treating them as one check is what let D4 happen |
| D5 (batch) | Review (independent post-implementation code review, deliberately run by a different reviewer than the implementing session) | Process gap: the apply ladder's own tests exercised "expected" failure modes (heuristic-gated, stale-span, dangling-post-check) thoroughly but under-tested genuine I/O malfunction mid-write, cross-platform path comparison, and concurrent-invocation safety — categories that require either a different reviewer's eye or explicit chaos/fault-injection test design | The FRESH SESSION ADVISORY already followed for verify-tasks ("run in a separate agent session from the implementing one") should extend to code review generally — this batch is direct evidence that a same-session reviewer is less likely to find these categories than an independent one |
| Reviewability ceiling | Post-implementation (reviewability diff gate #91) | Tooling gap: the scaffold-time LOC estimator (`estimate-reviewable-loc`) returned `not_estimated` at plan time ("no declared production files" — plan.md's structure doesn't parse into the estimator's expected shape) and the only real sizing signal was the *setup-gate* estimate (405, WARN) made before Clarify/Checklist had grown the requirement surface by ~12 refined FRs + 3 new ones. The estimator also structurally excludes test-file growth, which was 1.4–1.8× the src growth here | Two independent fixes: (1) re-run the LOC estimate (or at minimum a manual `git diff --stat` sanity check) at the T008 "Reviewability checkpoint" task using the *post-Clarify/Checklist* spec, not the pre-Clarify setup-gate number; (2) if the estimator is going to stay src-only, say so explicitly in its output so nobody reads `not_estimated` as "no signal" when a stale setup number is being relied on instead |

## Constitution Compliance

**0 violations.** Constitution Check in `plan.md` was PASS on all 7 principles at
plan time and re-affirmed after Phase 1 design (empty Complexity Tracking table).
Post-implementation verification (`speckit.verify.run`, the D5 code review, and
this retrospective's own `tsc --noEmit` + `TODO`/`FIXME` sweep) finds nothing that
contradicts that PASS:

- **I. Think Before Coding** — held; 3 Open Questions (Windows deferral,
  `--position` escape hatch, tier boundary) were each explicitly closed, not left
  ambiguous; D1–D5 were each surfaced and named before being fixed, never silently
  patched.
- **II. Simplicity First** — held; no configurable rollback, no persisted plan
  file, no interactive picker (all explicitly cut per the design concept); the
  watcher/mutex reuse (see Innovations) is a positive exemplar, not just an
  absence-of-violation.
- **III. Surgical Changes** — held; all new logic in `src/refactor/` (12 files,
  matches plan exactly); the 5 upstream-owned files received additive-only diffs
  (reviewer-verified in the D5 batch).
- **IV. Goal-Driven Execution** — held; TDD red→green for all 53 tasks and all 5
  defect batches; every completion claim in the workflow file carries a test count
  or probe result, never a bare assertion.
- **V. Deterministic, LLM-Free Extraction** — held; every edit derives from an LSP
  workspace edit or a span-verified graph reference; `provenance='heuristic'`
  synthesized edges are never emitted as edits (FR-004/FR-013); SC-010 index
  stability directly measured, not assumed.
- **VI. Retrieval Performance** — held; T048 A/B is NO-REGRESSION; retrieval-guardian
  SHIP-WITH-NOTES 6/6; `isError` reserved for the single FR-019a malfunction class,
  confirmed by both the implementer's own audit and the independent D5 review.
- **VII. Local-First** — held; no new runtime dependency; no network calls beyond
  locally-spawned language servers.

**One clause is not yet triggered, not violated**: the constitution's binding
Dogfooding clause requires the rebuild→sync loop to run "after each spec's PR(s)
merge, before the next spec starts." PR #43/#44 are still open, so this step is
correctly still pending — it is the second unchecked box in the Post-Implementation
Checklist, not a gap in this retrospective's scope.

## Unspecified Implementations

None of substance. This project's own discipline — amend `spec.md`/`data-model.md`
in the same commit as any implementation-driven behavior change (see D3, D4, D5's
`writeFailure`/`lspDegradation: overlapping-edits`) — means nothing shipped that
the current spec doesn't describe. The one residual item is deliberately
*unfixed*, not unspecified: the D5 review's NIT (a predictable temp-file name in
the atomic-write path) was found, named, and consciously left as-is — recorded in
the workflow file, not silently dropped.

## Task Execution Analysis

- **Tasks**: 53/53 complete (T001–T053), TDD-paired throughout (every
  implementation task preceded by a task that writes a failing test first).
- **Independent phantom-completion audit** (`speckit.verify-tasks.run`, run in a
  separate session from the implementing one per its own FRESH SESSION ADVISORY):
  46 VERIFIED, 1 PARTIAL (T027 — a named Slice-1 PR-packet file wasn't produced at
  gate time; closed same day by assembling `slice-1-pr-packet.md`, `79eb7fc`), 4
  WEAK-but-independently-corroborated (T048/T050/T051/T052 — evidence-recording
  tasks with no source artifact by nature; the auditor re-derived enough
  circumstantial detail — exact dollar ranges, named commits that exist in branch
  history, root-vs-non-root Docker DAC behavior explained correctly — to treat them
  as genuine, not fabricated), 2 SKIPPED-by-design (T001/T008, gate/checkpoint
  tasks with no code artifact), **0 NOT_FOUND**.
- **Commit cadence**: 24 commits from scaffold (`0ee4e18`) to the final polish
  commit in scope (`aff8506`), spanning 2026-07-10 → 2026-07-12 (a 3-day autopilot
  run). Commit messages cleanly separate phase completions, slice checkpoints, and
  each defect-batch fix — the git history alone reconstructs the same narrative as
  the workflow file.
- **PR status (verified live, not from the record)**: PR **#43**
  (`010-graph-aware-rename-slice-1` → `main`) and PR **#44**
  (`010-graph-aware-rename` → `010-graph-aware-rename-slice-1`, stacked) are both
  **OPEN**, `mergedAt: null`. Neither has been reviewed or merged as of this
  retrospective. This matches the workflow file's own Post-Implementation
  Checklist (both final boxes unchecked) — the record is accurate; there is no
  drift to report here, only a status to carry forward.
- **Execution-environment blockers** (operational, not spec/code drift): the
  iTerm2 teammate backend died mid-run and the run fell back to in-process agents
  with no recorded data loss; one executor was lost to a session limit and its
  work was redone by the orchestrator, also with no recorded data loss. Both are
  noted here because they extended wall-clock time on this run without affecting
  correctness — worth tracking if they recur on future specs.

## Lessons Learned and Recommendations

**Priority HIGH**

1. **Re-check reviewable-LOC sizing after Clarify/Checklist, not just at
   scaffold.** The 405-line estimate that justified the 2-slice split was made
   *before* Clarify grew the spec by 3 FRs and Checklist refined ~12 more; actual
   size landed ~4× over on src alone. Add a second sizing checkpoint (T008 already
   exists as a "Reviewability checkpoint" task — use it to re-run or manually
   sanity-check the estimate against the *current* spec, not cite the stale
   setup-gate number).
2. **Extend the "fresh session" principle from verify-tasks to code review
   generally.** D5's batch (4 real findings, including a genuine data-loss-risk
   gap) was found only because an independent reviewer looked at the branch after
   the implementing session considered itself done. This is strong evidence the
   pattern generalizes — codify it as a standing recommendation for any
   write-path or safety-critical spec.

**Priority MEDIUM**

3. **Treat a well-formed-but-incomplete external answer as its own failure
   class.** D3 happened because an `ok`-status LSP response was trusted without a
   completeness check. Any future spec that forks between an external tool and
   the graph as ground truth should design the completeness check in at plan
   time, not discover the gap via dogfooding.
4. **Design span-level and file-level freshness as two separate checks from the
   start.** D4 existed because FR-005 conflated "is this span a false positive"
   with "is this file's index entry current." When span-verification designs are
   written for future write-path specs, call this out explicitly as two
   requirements, not one.

**Priority LOW (process/tooling, not this spec's code)**

5. **The installed runner's mutation-op gap is now well-worn.** Seven-plus
   fallback-evidence-chain instances across one spec is a lot of repeated manual
   compensation for the same missing capability (`generate-pr-body`,
   `generate-uat-skeleton`, `estimate-spec-size`, `reviewability-gate` tasks-mode,
   `final-reviewability-backstop`, `generate-spec-index-write`). Each was handled
   correctly and disclosed, but fixing or upgrading the runner would remove a
   recurring tax on every future spec run.
6. **PR review and merge remain open follow-ups**, not retrospective findings —
   surfacing them here only so the next action on this spec is unambiguous:
   review and merge #43, then #44, then run the constitution's Dogfooding
   rebuild→sync loop before starting the next spec.

## Self-Assessment Checklist

| Check | Result |
|---|---|
| Evidence completeness — every major deviation cites file/task/commit/behavior | PASS |
| Coverage integrity — all 31 FR + 10 SC IDs present, none missing | PASS (grep-verified) |
| Metrics sanity — completion_rate and spec_adherence formulas applied correctly | PASS (53/53=100%; (41+0+0)/(41−0)×100=100%) |
| Severity consistency — CRITICAL/SIGNIFICANT/MINOR/POSITIVE labels match stated impact | PASS |
| Constitution review — violations explicitly listed or "None" stated | PASS (0 violations; one clause explicitly marked pending-not-violated) |
| Human Gate readiness — populated if spec changes are proposed | N/A — no spec changes proposed, nothing to gate |
| Actionability — recommendations specific, prioritized, tied to findings | PASS (6 recommendations, HIGH/MEDIUM/LOW, each traced to a specific defect or gap) |

No blocking failures. Report finalized.

## File Traceability Appendix

Reviewable diff, `91fbacc..aff8506` (48 files changed, 11,421 insertions(+), 83
deletions(-)):

**New module — `src/refactor/`** (12 files, matches plan exactly):

| File | Slice | +LOC |
|---|---|---|
| `types.ts` | 1 | 466 |
| `plan-engine.ts` | 1 (+T040 additive Slice-2 hook) | 426 |
| `target-resolver.ts` | 1 | 258 |
| `plan-format.ts` | 1 | 265 |
| `graph-rename.ts` | 1 | 182 |
| `lsp-rename.ts` | 1 | 166 |
| `confidence.ts` | 1 | 76 |
| `span-verify.ts` | 1 (shared seam, reused by Slice 2) | 40 |
| `apply-engine.ts` | 2 | 258 |
| `snapshot.ts` | 2 | 247 |
| `jail.ts` | 2 | 89 |
| `post-check.ts` | 2 | 84 |

**Upstream-owned files (additive-only, reviewer-verified)**: `src/db/queries.ts`
(+159), `src/index.ts` (+69), `src/bin/codegraph.ts` (+102), `src/mcp/tools.ts`
(+166 net), `src/mcp/server-instructions.ts` (+19 net).

**Tests**: `__tests__/refactor-plan.test.ts` (117 tests at final count),
`__tests__/refactor-apply.test.ts`, `__tests__/rename-mcp.test.ts` — real files +
real SQLite throughout, no DB mocking, `fs.mkdtempSync`/`afterEach` per repo
convention.

**Spec artifacts**: `spec.md` (+291), `plan.md` (+147), `tasks.md` (+243),
`data-model.md` (+127), `research.md` (+104), `quickstart.md` (+111),
`contracts/{cli-rename.md,mcp-codegraph_rename.md,rename-plan.schema.json}`
(+342 combined), 3 checklist files (+186 combined).

**Process record** (this retrospective's primary source material):
`docs/ai/specs/.process/SPEC-010-workflow.md`,
`specs/010-graph-aware-rename/.process/{autopilot-state.json,
slice-1-pr-packet.md, slice-2-pr-packet.md, uat-runbook.md,
verify-tasks-report.md}`.
