# SPEC-010 Slice-1 PR Review Packet — Plan Engine + CLI Dry-Run (read-only)

Assembled post-hoc at the Verify-Tasks step (its one PARTIAL finding: T027 named
this packet as a sub-deliverable but no discrete file was ever produced — every
other T027 claim was independently re-verified, including a historical
`git show f911f95` confirming the scope statement below). Structure mirrors
`slice-2-pr-packet.md`.

## Slice boundary

`slice-1-plan-engine` = the branch base (merge-base with origin/main `2dadccd`)
through the Slice-1 tip `f911f95`, plus the checkpoint chore `2bb5aa5`.
`git log --oneline 2dadccd..2bb5aa5` returns exactly these 12 commits:

| Commit | Content | Class |
|---|---|---|
| `91fbacc` | design concept + workflow file scaffold | process artifact |
| `0ee4e18` | mark SPEC-010 In Progress | process artifact |
| `a9bd23d` | Specify phase artifacts (spec.md) | spec artifact |
| `52dcbc1` | Clarify phase (3 sessions; FR-019a/026/027/028 added; 4 security items human-ratified) | spec artifact |
| `1c27cc8` | Plan phase (plan.md, research.md, data-model.md, contracts/, quickstart.md) | spec artifact |
| `484339b` | Checklist phase (122 items, 22 gaps fixed; FR-003a/FR-021a/SC-010 added) | spec artifact |
| `6433ec9` | Tasks phase (53 tasks; PR seam at T027; pr_marker_plan) | spec artifact |
| `64b16d0` | Analyze phase (8 findings, all remediated; G6 clean) | spec artifact |
| `994e7f6` | **Foundation — refactor types, confidence tiers, span verification, Slice-1 queries (T001–T008)** | implementation |
| `b205ad3` | **US1 dry-run plan engine — LSP+graph paths, resolver, format, CLI rename (T009–T021)** | implementation |
| `f911f95` | **US2 refusal hardening + Slice-1 wrap — candidate listing, kind coverage, input validation, D1 edge-kind fix, D2 refusal payloads, CHANGELOG (T022–T027)** | implementation |
| `2bb5aa5` | record slice-1 marker checkpoint | process artifact |

Reviewers can skim the six spec-artifact commits (they are the SDD paper trail);
the reviewable code is the three implementation commits.

## Scope statement — this slice is READ-ONLY

At `f911f95` the CLI had **no `--apply` flag**: `codegraph rename` was dry-run
only, writing nothing under any input, and only exit codes **{0, 1, 2}** were
reachable (verified historically via `git show f911f95` during the
verify-tasks pass, not inferred). The apply safety ladder, MCP tool,
server-instructions guidance, and the D3/D4 gate remediations all land in
Slice 2 (`slice-2-pr-packet.md`).

## Review order

1. `src/refactor/types.ts` — value objects; SourceRange (line 1-indexed /
   col 0-indexed) vs LSP Position (0-based) deliberately field-incompatible;
   refusal taxonomy; exit-code map.
2. `src/refactor/confidence.ts` + `src/refactor/span-verify.ts` — the shared
   seam: the FR-004 `resolvedBy`/`provenance` → `exact|heuristic` table and the
   UTF-16 live-byte span check every edit must pass.
3. `src/refactor/lsp-rename.ts` — `textDocument/rename` via the SPEC-008
   substrate; FR-003a degradation statuses.
4. `src/refactor/graph-rename.ts` — graph-reference derivation;
   `RENAME_RELEVANT_EDGE_KINDS` (D1); self-loop sentinel drop; leftover FYI.
5. `src/refactor/target-resolver.ts` — selector resolution (`Class::method`
   segment-suffix matching), ambiguity/kind/validation refusals.
6. `src/refactor/plan-format.ts` + `src/refactor/plan-engine.ts` — human table +
   canonical JSON (byte-stable, codepoint ordering) and the LSP-vs-graph fork.
7. `src/index.ts` (`planRename`, +27/−0) and `src/bin/codegraph.ts` (rename
   subcommand, +75/−0) — strictly additive entry points.
8. `__tests__/refactor-plan.test.ts` — the Slice-1 suite (108 tests at seal).

## FR → file → evidence traceability (Slice-1 FR set)

Test anchors are `describe`-block names in `__tests__/refactor-plan.test.ts`
(grep-verified at packet assembly).

| FR | Requirement (short) | Implementing file(s) | Test anchor |
|---|---|---|---|
| FR-001 | dry-run by default; plan prints without writing | plan-engine.ts, bin/codegraph.ts | `T014 CLI dry-run — codegraph rename (built binary, FR-001/FR-026/FR-027)` |
| FR-002 | every edit: file, range, before/after, tier | types.ts, plan-format.ts | `T013 plan format + schema (FR-027 / SC-001)` |
| FR-003 | LSP path when covered, graph otherwise; no language allowlist | plan-engine.ts, lsp-rename.ts | `T009 LSP-path rename derivation (real stub server, FR-003)` |
| FR-003a | availability probe + runtime-failure degradation, never whole-command failure | lsp-rename.ts, plan-engine.ts | `T010 FR-003a degradation parity (unavailable + runtime failures)` |
| FR-004 | deterministic tier table; synthesized/file-path edges never candidates | confidence.ts | `FR-004 confidence table — classifyEdgeConfidence` (exact/heuristic/never blocks) |
| FR-005 | span verification excludes shadow/alias/string-similar false positives | span-verify.ts, graph-rename.ts | `FR-005 / FR-016 span verification — verifySpan` + `T025 scope-ignored invisibility (FR-005/SC-008)` |
| FR-006 | target selector resolution (name, `--file`, `--kind`) | target-resolver.ts | `T017 target selector resolution (real SQLite, FR-006)` |
| FR-007 | ambiguity refusal enumerates every candidate + qualifier | target-resolver.ts, plan-format.ts | `T022 ambiguous-target refusal (FR-007/FR-008/SC-003)` + `D2 refusal candidate surface (FR-007)` |
| FR-008 | no interactive prompting; refusal is the answer | target-resolver.ts | `T022` (same block) |
| FR-009/FR-010/FR-011 | kind coverage: supported kinds, graph-local limits, excluded kinds | target-resolver.ts | `T023 kind-coverage refusals (FR-009/FR-010/FR-011, FR-003a honesty)` |
| FR-012/FR-013 | leftover-mention FYI (comments/strings never edits, counted only) | graph-rename.ts, plan-format.ts | `T011 graph-path rename derivation` + `T012 plan assembly` |
| FR-021a | input validation refusal with `validKinds` | target-resolver.ts | `T024 invalid-argument validation (FR-021a)` + `T024 invalid-argument CLI (FR-021a/FR-026)` |
| FR-026 (partial) | exit codes {0,1,2} (3/4 arrive with apply in Slice 2) | bin/codegraph.ts, types.ts | `T014` exit-taxonomy test |
| FR-027 | human table default; `--json` canonical, stable schema | plan-format.ts, contracts/rename-plan.schema.json | `T013` (in-test draft-07 validation) |

## Verification evidence (from the workflow doc, rows 1–2 — authoritative)

- **T027 gate**: full hermetic suite **172/172, run twice** (pre- and
  post-remediation); scoped suite 108/108; tsc clean; quickstart **S1-A…S1-F
  all PASS**; zero-write verified via shasum.
- **UAT found 2 defects, both TDD-remediated before seal**: **D1** —
  references-only edge scoping (calls/imports/extends/implements sites got no
  edits; would have invalidated FR-018's touched-file premise at apply time;
  fixed via the empirically-probed `RENAME_RELEVANT_EDGE_KINDS` with
  span-verify as the safety filter; data-model drift corrected) and **D2** —
  human-surface refusals omitted candidates/validKinds/files payloads (FR-007;
  `renderRefusal` added to plan-format).
- CHANGELOG user-facing dry-run entry added under `## [Unreleased]`.

## Post-Slice-1 amendments (review those deltas in the Slice-2 PR)

Slice-2 work later amended Slice-1 files — the Slice-1 PR should be reviewed at
its checkpoint semantics (`2bb5aa5`), with these deltas belonging to Slice 2:

- **D3** (dogfood finding): plan-engine gained the LSP completeness
  verification; types/plan-format/schema gained `lspDegradation:
  "incomplete-coverage"`.
- **D4** (gate finding): plan-engine + graph-rename gained the plan-time
  index-freshness guard (drifted candidate files → whole-plan `stale-span`
  refusal); the plan suite grew to 117 tests (`D4 plan-time index-freshness
  guard` describe block).

## Known gaps at the Slice-1 boundary

- No apply surface yet: the FR-015 heuristic gate and every apply-ladder
  guarantee (FR-014…FR-020) are unexercisable in this slice by design.
- Windows validation deferred (VM suspended) — `it.runIf` gating audited in
  Slice 2 (T052).
- Doc-comment/string mentions of a renamed symbol are deliberately
  leftover-only (FR-013), never edits.
