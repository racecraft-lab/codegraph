---
feature: SPEC-005 Local HTTP Server & REST API
branch: 005-local-http-server
date: 2026-07-11
completion_rate: 100        # 47/47 tasks complete (fresh-session phantom check: 47/47 VERIFIED)
spec_adherence: 100         # (32 IMPLEMENTED + 2 MODIFIED-ratified + 8 SC) / 42 requirements; 0 dropped, 0 partial
requirements:
  functional: 34            # FR-001..FR-026 incl. lettered (004a, 006a, 010a, 014a, 015a, 017a, 017b, 021a)
  success_criteria: 8       # SC-001..SC-008
  implemented: 40
  modified_ratified: 2      # FR-002 read transport (codegraph/read RPC, human-ratified); SC-007 LOC ceiling (size-only, ratified)
  not_implemented: 0
  unspecified: 0            # all additions ratified into spec/plan before or during implementation
findings:
  critical: 0
  significant: 3            # all ratified deviations, none open
  minor: 3
  positive: 5
constitution_violations: 0
prs:
  - "PR #41 (slice 1, read API, base main) — CI 10/10 green incl. CodeQL, 0 unresolved threads"
  - "PR #42 (slice 2, jobs/SSE, base #41) — 0 unresolved threads"
final_suite: "3167 passed / 7 skipped, exit 0 (env-stripped)"
---

# Retrospective: SPEC-005 — Local HTTP Server & REST API

## Executive Summary

SPEC-005 shipped `codegraph serve --web` — a zero-new-dependency local REST API
(read surface + re-index jobs with SSE progress) riding the existing per-project
daemon — as two stacked PRs (#41 read API, #42 jobs/SSE) with all 47 tasks, all
34 FRs, and all 8 SCs independently verified. Strict TDD held throughout (RED
verified per task group; ~255 new server tests across 5 suites; final full suite
3167 passed / 7 skipped). Dormancy, fail-closed binding, the closed six-code
error envelope, and the contract-test-enforced `openapi.yaml` all landed as
specified.

**Spec adherence: 100%** (formula: 40 IMPLEMENTED + 2 MODIFIED, 0 partial, 0
unspecified, over 42 total requirements). Three deviations occurred, **all
ratified through the sanctioned amendment channel** — one human-ratified plan
amendment (the `codegraph/read` daemon RPC, forced by a genuine plan
impossibility), one orchestrator-ratified implementation detail (daemon
main-thread reads), and one size-only finding (both slices exceeded the ~400
reviewable-LOC estimate). No unratified drift.

The headline learning is two-sided: the **phase gates produced a defect-free
requirements surface but not a defect-free implementation** — the
post-implementation quality loop (6-aspect review panel, CodeQL, Copilot review)
caught 1 HIGH and 2 MEDIUM real defects plus two real cross-platform bugs that
TDD-with-green-suite had not surfaced. That loop is not optional polish; it is a
load-bearing gate and should be treated as such in future cycles.

## Proposed Spec Changes

**None.** All spec-affecting discoveries were amended into `spec.md`/`plan.md`
during the cycle through the consensus/ratification protocol (the human gate was
exercised live for the security items and the IMPL-1 plan amendment). The spec
as committed matches the shipped implementation; no post-hoc edits are proposed.
(Human gate not invoked — nothing to confirm.)

## Requirement Coverage Matrix

Status vocabulary: IMPLEMENTED (as specified) · MODIFIED (delivered with a
ratified change of approach) · PARTIAL · NOT IMPLEMENTED · UNSPECIFIED.

| Requirement | Status | Evidence (files / tests) |
|---|---|---|
| FR-001 dormancy, `--web` only, `--web`/`--mcp` exclusive | IMPLEMENTED | `src/bin/codegraph.ts` (+19/−1 minimal diff, T007); dormancy tests in `server-read-api.test.ts`; SC-006 verified |
| FR-002 serve process is a daemon client, one warm index | MODIFIED (ratified) | Upheld in substance — all reads execute in the daemon over its socket — but via a **new additive `codegraph/read` JSON-RPC** (`src/mcp/read-ops.ts`, `session.ts`, `engine.ts`), not the existing `tools/call` surface, which returns id-less markdown unusable for REST wire shapes. Human-ratified plan amendment (IMPL-1, 2026-07-11); plan Constitution III/VI rows amended; retrieval-guardian verified no MCP tool-output change |
| FR-003 zero new runtime deps | IMPLEMENTED | `package.json` dependencies diff vs main empty; T010 + G7 check |
| FR-004/004a read endpoints; opaque ids, split-then-decode-once | IMPLEMENTED | `src/server/routes.ts` single decode chokepoint (T004); `%2F` round-trip + malformed-id 404 tests (T011, contract walk T029) |
| FR-005 status body incl. un-indexed `index.state` | IMPLEMENTED | T014; status handler + fixture tests |
| FR-006/006a paging, `q` required, `mode` enum 400, degradation 200 | IMPLEMENTED | T015/T016; clamp-not-error verified; degradation `degraded:true` path tested |
| FR-007 graph depth 1/max 3, 2000-node cap, `truncated` | IMPLEMENTED | T018; divergent impact-depth-3 default separately asserted (T011, Analyze I2) |
| FR-008 reads from shared daemon index | IMPLEMENTED | `src/server/daemon-client.ts` (T013) |
| FR-009/010/010a repos list, 16-hex ids, optional `?repo=`, lazy attach | IMPLEMENTED | T026–T028; lazy-attach asserted; fixture uses exported `repoIdForRoot` (PR #42 review fix) |
| FR-011 unregistered/malformed repo → 404 never 400 | IMPLEMENTED | T026; contract walk |
| FR-012 loopback default 127.0.0.1:11235, shared predicate, Host allowlist | IMPLEMENTED | T002 (predicate extracted to `src/utils.ts`), T022/T023; **octet-validation gap in `isLoopbackHost` found by Copilot review and fixed** (57f26f3) |
| FR-013 fail-closed non-loopback bind | IMPLEMENTED | T022; SC-002 verified 100% |
| FR-014/014a constant-time Bearer, token never logged | IMPLEMENTED | T024/T025; digest-first `timingSafeEqual`; log-capture assertion for token absence |
| FR-015/015a six-code envelope, whitelisted details, top-level catch | IMPLEMENTED | `src/server/errors.ts` (T003); per-handler catch (T004); **server-side diagnostics at contained-error sites added post-review (panel HIGH finding)** |
| FR-016 no `/api/v1`; version in status | IMPLEMENTED | T014 |
| FR-017/017a/017b placeholder, data-free shell, traversal confinement | IMPLEMENTED | `src/server/static.ts` (T019/T020) via `validatePathWithinRoot`; traversal probes in both web-root states (T012) |
| FR-018/019 strict fallback rules; no CORS | IMPLEMENTED | T012/T019; unsupported-method-on-known-path → 404 route |
| FR-020 `POST /api/reindex/:repo`, URL-only params, registry-only | IMPLEMENTED | T038; body never read; unregistered → 404 |
| FR-021/021a in-process jobs, fault containment, lock retry → `lock_unavailable`, watcher re-arm | IMPLEMENTED | `src/server/jobs.ts` (T034–T036); `MCPEngine.rearmWatcher()` control op (T039 — landed in `session.ts` not `daemon.ts`, benign task-text drift, documented) |
| FR-022 single active job per repo → 409 | IMPLEMENTED | T034/T038; tested mid-run |
| FR-023 SSE snapshot/progress/terminal, heartbeat, backpressure coalescing, shutdown abort | IMPLEMENTED | `src/server/sse.ts` (T037), T040; **socket leak on failed handshake + post-writeHead double-writeHead cascade found by review panel and fixed** (e69f84e) |
| FR-024 in-memory latest-job-per-repo; no-job → 404 `resource:repo` | IMPLEMENTED | T034; tested |
| FR-025 committed openapi.yaml + contract test walks every path/method/status | IMPLEMENTED | `src/server/openapi.yaml` shipped via copy-assets (T009); `server-openapi-contract.test.ts` 723 lines, jobs walk added (T041); **search-total contract mismatch caught by the review loop and corrected** |
| FR-026 ordered shutdown, `--port 0`, EADDRINUSE, ~5s grace, never kill a shared daemon | IMPLEMENTED | `src/server/index.ts` (T006/T040); lifecycle tests |

## Success Criteria Assessment

| SC | Verdict | Evidence |
|---|---|---|
| SC-001 full read surface over HTTP | MET | US1 tests + T047 self-repo dogfood (status/repos/search/node/graph live) |
| SC-002 safe-by-default binding 100% | MET | T021/T022; fail-closed startup refusal asserted |
| SC-003 Bearer enforcement 100% | MET | T024; generic byte-identical 401 bodies |
| SC-004 live progress + terminal outcome + 409 | MET | T033–T040; quickstart S8–S11 (two edge conditions unit-grounded, recorded honestly in slice2-quickstart-evidence.md) |
| SC-005 contract test, zero undocumented endpoints | MET | 43/43 contract walk incl. jobs surface; CI green |
| SC-006 dormancy verified | MET | Bare `serve`/`serve --mcp` byte-identical tests; no bind without `--web` |
| SC-007 two PRs each under ~400 LOC | MET WITH RATIFIED DEVIATION | 2-PR structure held exactly (PR #41 / #42, stacked, review-markered); the LOC ceiling did not — ~1280 (slice 1) and ~560 (slice 2) logic LOC vs ~400. Size-only finding, ratified at both marker checkpoints; PR packets carry review-order + traceability to compensate |
| SC-008 self-repo dogfood | MET | T047: 7/7 UAT PASS against this repo's own index, incl. a live sync job over SSE and clean SIGTERM |

## Architecture Drift

| Plan element | Built | Drift |
|---|---|---|
| `src/server/` module (index/routes/auth/daemon-client/static/errors + jobs/sse + openapi.yaml) | Exactly as planned | None |
| Daemon read transport: "forward queries over the daemon socket" (mechanism unstated in plan v1) | Additive `codegraph/read` structured JSON-RPC on session dispatch | **Ratified amendment** — plan's implicit "reuse `tools/call`" was impossible (id-less markdown); FR-002/Q1 upheld verbatim |
| Reads via daemon **query pool** (off-thread) | Reads on daemon **main thread** | **Orchestrator-ratified** — the pool is ToolResult-text-only; point queries are capped/bounded, so main-thread execution is acceptable; flagged in PR packet |
| Slice sizes ~400 LOC each (620 total estimate) | ~1280 + ~560 logic LOC | **Size-only ratified deviation** — scaffold estimator materially under-projected (3.0×); no undisclosed scope |
| T039 dispatch case in `daemon.ts` | Landed in `session.ts` (the daemon's session dispatcher) | Benign task-text drift, documented; not an orphan |
| Everything else (zero deps, hand-rolled router/SSE/static, in-memory jobs, lazy attach, upgrade-hook reservation) | As planned | None |

## Significant Deviations (all ratified — none open)

1. **[SIGNIFICANT · ratified · human gate] `codegraph/read` additive daemon RPC
   (IMPL-1).** Discovered at implementation start: the plan's original "no new
   daemon RPC; ride the existing socket surface" was impossible because
   `tools/call` returns id-less markdown, unusable for structured REST wire
   shapes. Root cause: **spec/plan gap** — the plan pinned the transport
   principle (daemon client, one warm index) but never verified the socket's
   payload shape against the REST endpoints' needs. Discovery point:
   implementation (first task of US1). Resolution: implement-executor escalated
   with file:line evidence → human ratified the additive read-only RPC → plan
   Constitution III/VI rows amended → retrieval-guardian scope extended to both
   slice PRs. Prevention: plan-phase "transport shape probe" — when a plan says
   "reuse existing channel X," verify X's actual payload shape against the
   consumer's wire contract before G3, not at first implementation contact.

2. **[SIGNIFICANT · ratified · orchestrator] Daemon main-thread reads instead
   of the query pool.** The query pool is ToolResult-text-only, so structured
   reads execute on the daemon main thread. Bounded/capped point queries make
   this acceptable; flagged in the slice-1 PR packet. Same root cause family as
   (1): an existing-infrastructure capability assumed at plan time without a
   shape check.

3. **[SIGNIFICANT · ratified · size-only] Slice LOC overrun.** Slice 1 ~1280
   and slice 2 ~560 logic LOC vs the ~400/slice ceiling (620 total scaffold
   estimate — actual production src total 3500 insertions). Root cause: the
   scaffold estimator priced the endpoint list, not the hardening the Clarify/
   Checklist phases correctly added (8 lettered FRs — 004a, 006a, 010a, 014a,
   15a, 017a, 017b, 021a — are all security/contract hardening born in those
   phases, each with real test surface). The 2-PR marker plan held; both
   checkpoints recorded the overrun before proceeding. Prevention: re-estimate
   the budget **after** Clarify/Checklist close (they grew requirements ~30%),
   not only at scaffold; treat lettered-FR growth as a size signal.

## Minor Findings

- **Tasks.md checkboxes were never ticked by executors during implementation**
  — reconciled in bulk at close-out (9c4ae68). Harmless here (the phantom check
  independently verified 47/47) but it removes the live progress signal the
  file exists to provide mid-run.
- **T039 task-text drift** (`daemon.ts` named, `session.ts` landed) — documented.
- **Deferred refactors recorded, not silently dropped**: JobDescriptor
  discriminated union, BindSecurity union, rearmWatcher helper consolidation —
  named in slice2-pr-packet.md for the PR follow-up section.

## Positive Deviations / Innovations

1. **Post-implementation quality loop as a real gate.** The 6-aspect review
   panel found 1 HIGH (no server-side diagnostics at contained-error sites — a
   debuggability hole the FR-015a "never leak to the client" rule created) and
   2 MEDIUM (SSE socket leak on failed handshake; post-writeHead double-writeHead
   cascade) plus a search-total contract mismatch; CodeQL found insecure
   `daemon.log` creation (fixed: owner-only 0600 + O_NOFOLLOW, 55ea3ed); Copilot
   review produced 15 threads, all valid-or-addressed, including **two real
   cross-platform file-URI bugs** (`file://${path}` vs `pathToFileURL`) and an
   `isLoopbackHost` octet-validation gap. All fixed with guard tests before
   merge; PR #41 CI 10/10 green incl. CodeQL. **Reusable pattern; constitution
   candidate** (see Recommendations).
2. **Ratification-with-evidence as the deviation channel.** All three deviations
   went through evidence → ratify → amend-artifacts → extend-guardrails (the
   retrieval-guardian scope grew to cover the amendment). Zero silent drift is
   the direct result. Reusable as-is.
3. **Deterministic fallback evidence chains for deferred runner helpers.**
   generate-pr-body / multi-pr-emission / generate-uat-skeleton /
   reviewability-gate(pre-pr) were unavailable on the installed runner; each
   deferral was recorded loudly in `autopilot-state.json` with a hand-executed
   equivalent (PR bodies authored from committed T032/T045 packets;
   title-contract validators passed; explicit `gh pr create` fallback). The
   process degraded gracefully instead of blocking or skipping silently.
4. **Honest evidence grading.** Two spec edge conditions (watcher-restore
   true→false, live mid-index abort) were unit-grounded rather than end-to-end
   and recorded as such in slice2-quickstart-evidence.md instead of being
   claimed live. Keeps verification claims trustworthy.
5. **Seam-first slice layering worked exactly as designed.** Slice 2 attached
   to the router/shutdown seams slice 1 exposed with zero rework of slice-1
   files (T038/T040/T041 flagged `[seam→Slice1]`, straddler audit clean) —
   validating the plan's layering strategy for future multi-slice specs.

## Constitution Compliance

**Violations: None.** All seven principles verified:

| Principle | Verdict |
|---|---|
| I Think Before Coding | PASS — 15 clarify questions across 3 sessions, 11-row consensus log, 2 security panels human-approved; the one implementation-time confusion (IMPL-1) stopped work and became a question, exactly as required |
| II Simplicity First | PASS — zero new runtime deps end-to-end; hand-rolled router/SSE/static; Complexity Tracking empty |
| III Surgical Changes / fork discipline | PASS — new capability in new `src/server/`; upstream-owned diffs minimal and enumerated (`codegraph.ts` +19/−1, `embeddings/config.ts` +2/−8, `utils.ts` +13, additive `src/mcp/` dispatch cases); the one plan amendment was human-ratified into the Constitution III row, not slipped in |
| IV Goal-Driven Execution | PASS — strict TDD with RED verified per group; 47/47 phantom check; completion claims carry test output throughout |
| V Deterministic Extraction | PASS (n/a) — no extraction/graph change |
| VI Retrieval no-regress | PASS — retrieval-guardian OVERALL PASS 7/7, zero blocking, run for both `src/mcp/`-touching slices |
| VII Local-first / dormancy | PASS — SC-006 verified; loopback default; no CORS; `openapi.yaml` in copy-assets |

## Unspecified Implementations

None outstanding. `src/mcp/read-ops.ts` (202 lines) is part of the ratified
IMPL-1 amendment; review-panel remediation (F1–F10 + 15 guard tests) and the
CodeQL `daemon.log` hardening are bounded defect fixes under the "not drift"
guideline, all folded into PR #42's checkpoint (e69f84e) with the fold recorded
in the marker plan.

## Task Execution Analysis

- **47/47 completed, 0 modified in scope, 0 dropped, 0 added** (the review-panel
  remediation was folded as close-out work, not a task). Fresh-session phantom
  check: 47/47 VERIFIED, zero phantom/partial.
- TDD fidelity: every implementation group's failing tests were seen RED first
  (e.g., US3's 27 tests verified 24-fail before implementation).
- Test growth: G0 baseline 2912 → final 3167 passed (~255 new across the 5
  `server-*` suites + guard tests), 7 skipped stable.
- Timeline: scaffold 2026-07-10 → both PRs open 2026-07-11 — the full SDD cycle
  (specify → clarify ×3 → plan → checklist ×4 → tasks → analyze → implement →
  review loop → emission) in ~2 days.
- Blockers encountered and cleared: subagent stalls during consensus (3, model
  outage-correlated), locked-down-agent result delivery, stale `dist/` in the
  shared worktree, deferred runner helpers — all in Lessons below.

## Lessons Learned & Recommendations

### What worked (keep)

1. **Clarify/Checklist consensus with human security gates.** The 8 lettered FRs
   — DNS-rebinding Host allowlist, constant-time token compare, traversal
   confinement, token-logging ban, closed error vocabulary — all originated in
   these phases and every one survived contact with CodeQL/Copilot review. The
   requirements surface itself had zero post-hoc security additions.
2. **Contract test as drift police.** The FR-025 walk (every path/method/status)
   caught the search-total mismatch during the quality loop and turns any future
   API drift into a CI failure for SPEC-006 to build against.
3. **Fold-target marker plans.** Folding polish + remediation into PR 2's
   checkpoint (with the fold recorded in `autopilot-state.json`) kept the 2-PR
   contract intact while absorbing unplanned close-out work.
4. **Evidence-graded verification** (live vs unit-grounded, stated per item).

### What didn't (fix)

1. **Green TDD ≠ defect-free.** The phase gates missed 1 HIGH + 2 MEDIUM real
   defects, one security-relevant file-creation issue, and two cross-platform
   bugs. All were caught by the post-implementation loop — but only because it
   ran. → **Recommendation (HIGH, constitution candidate):** make the
   review-panel + CodeQL + external-review pass a named, blocking post-implement
   gate (G7.5) in the workflow template, not an optional "Post:" step.
2. **Plan-time capability assumptions about existing infrastructure.** Both
   ratified technical deviations trace to the same cause: the plan asserted
   "reuse channel X" without checking X's payload shape. → **Recommendation
   (HIGH):** add a plan-phase checklist item — for every "rides existing
   mechanism" claim, cite the file:line evidence that the mechanism's actual
   input/output shape satisfies the new consumer.
3. **Scaffold LOC estimator under-projects hardened specs (3.0× here).** →
   **Recommendation (MEDIUM):** re-run the reviewability estimate after
   Checklist closes; scale the estimate with lettered-FR growth; when the
   projection already sits at a warn line at scaffold, expect the real number
   to be worse, and consider 3 slices where 2 were marginal.
4. **Cross-platform surfaces were reviewed, not validated.** The two file-URI
   bugs (`file://${path}` breaks on Windows paths) shipped to review despite
   CLAUDE.md's validate-for-real rule; the Windows VM is currently unavailable
   (`.parallels` absent). → **Recommendation (MEDIUM):** while the VM is down,
   add a lint-style guard or targeted test for `pathToFileURL` usage on any
   `file://` construction, and record the platform-validation debt per PR.
5. **Executor process frictions** (record for orchestrator playbooks):
   (a) subagent 600s watchdog stalls — recover via transcript-resume with a
   targeted root-cause hint, respawn with no-tool-call length-capped prompts as
   the second resort; (b) locked-down agent types (retrieval-guardian) deny
   SendMessage so they can neither deliver results nor approve shutdown — the
   orchestrator must read transcripts directly and TaskStop; → **Recommendation
   (LOW):** give reviewer-type agents a result-delivery allowance or route their
   verdicts through a file artifact by convention; (c) stale untracked `dist/`
   caused false contract-test failures when switching branches in one worktree —
   rebuild-per-branch is mandatory before any dist-dependent test;
   → **Recommendation (LOW):** add a branch-switch rebuild note to the workflow
   template's pre-implementation setup; (d) executors never tick tasks.md live —
   → **Recommendation (LOW):** make the tick part of each task's done-definition
   in the implement prompt, or accept bulk reconciliation as the norm and say so
   in the template.

### Follow-up priorities

1. **HIGH** — institutionalize the post-implementation quality loop as a
   blocking gate (workflow template + possibly constitution Quality Gates).
2. **HIGH** — plan-phase "existing-mechanism shape probe" checklist item.
3. **MEDIUM** — post-checklist reviewability re-estimate; `pathToFileURL` guard.
4. **LOW** — executor-friction playbook items (5a–5d above).
5. Merge path: PRs #41 → #42 → main, then `npm run build` + `codegraph sync`
   (Dogfooding Protocol step 1); archive via the standard archive-run when merged.

## File Traceability Appendix

Production (branch vs main, `src/` + shipped assets — 3,532 insertions / 10 deletions):

| File | +/− | Requirements |
|---|---|---|
| `src/server/index.ts` | +486 | FR-001/002/026, SC-006 (bootstrap, lifecycle, shutdown, upgrade-hook reservation) |
| `src/server/routes.ts` | +532 | FR-004–007/010a/015a/016/018/020/022–024 (router + all handlers) |
| `src/server/daemon-client.ts` | +557 | FR-002/008/009/010/011 (attach-or-spawn, lazy multi-repo, read forwarding) |
| `src/server/jobs.ts` | +544 | FR-020/021/021a/022/024 (registry, driver, lock retry, watcher re-arm trigger) |
| `src/server/sse.ts` | +200 | FR-023 (writer, heartbeat, backpressure coalescing) |
| `src/server/auth.ts` | +140 | FR-012/013/014 (bind gate, Host allowlist, constant-time Bearer) |
| `src/server/errors.ts` | +159 | FR-015/015a (six-code envelope) |
| `src/server/static.ts` | +165 | FR-017/017a/017b/018/019 (placeholder, fallback, traversal confinement) |
| `src/server/openapi.yaml` | +390 | FR-025 (shipped contract) |
| `src/mcp/read-ops.ts` | +202 | IMPL-1 amendment (structured read ops) |
| `src/mcp/session.ts` / `engine.ts` | +63 / +45 | IMPL-1 `codegraph/read` dispatch; FR-021a `rearmWatcher` |
| `src/bin/codegraph.ts` | +19/−1 | FR-001 (`--web`, mutual exclusion; minimal upstream diff) |
| `src/utils.ts` / `src/embeddings/config.ts` | +13 / +2/−8 | FR-012 shared `isLoopbackHost` |
| `src/index.ts` | +15 | library seam for job driver |
| `package.json` | +1/−1 | copy-assets ships openapi.yaml (Constitution VII) |

Tests (4,033 insertions): `server-read-api` 1,450 · `server-reindex-jobs` 924 ·
`server-openapi-contract` 723 · `server-auth-binding` 366 ·
`server-static-fallback` 365 · `helpers/server-fixture.ts` 205. Docs:
`docs/web-server.md` +129 (T046). Process evidence:
`specs/005-local-http-server/.process/` (autopilot-state.json v2 manifest, PR
packets, quickstart evidence, emission bodies).

## Self-Assessment Checklist

- Evidence completeness: **PASS** — every deviation cites commit/file/ratification.
- Coverage integrity: **PASS** — all 34 FR + 8 SC IDs enumerated, none missing.
- Metrics sanity: **PASS** — completion 47/47 = 100%; adherence (40 + 2 + 0×0.5) / (42 − 0) = 100%.
- Severity consistency: **PASS** — SIGNIFICANT reserved for ratified approach/size deviations; POSITIVE for improvements.
- Constitution review: **PASS** — explicitly checked, violations: None.
- Human Gate readiness: **PASS (n/a)** — Proposed Spec Changes is explicitly empty; no spec-modifying action proposed.
- Actionability: **PASS** — recommendations prioritized HIGH/MEDIUM/LOW and each tied to a named finding.
