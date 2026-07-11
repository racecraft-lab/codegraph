# Error-Handling Checklist: Graph-Aware Rename

**Purpose**: Validate the quality (completeness, clarity, consistency, coverage) of the *error-handling* requirements — the refusal ladder, LSP degradation/failure handling, the rollback & recovery paths, and the apply-pipeline ordering guarantees — before implementation.
**Created**: 2026-07-11
**Feature**: [spec.md](../spec.md) · plan: [plan.md](../plan.md) · contracts: [rename-plan.schema.json](../contracts/rename-plan.schema.json)

**Note**: Unit tests for the *requirements*, not the implementation. Each item asks whether the error-handling contract is well-specified — not whether code behaves. Focus areas (domain prompt): every refusal class has a trigger + a fix-naming reason + zero side effects; LSP absent/crashed/timeout falls back or refuses honestly and never half-applies; rollback restores byte-identically and a failed rollback is a real malfunction with a snapshot location; per-language degradation parity with SPEC-008; and the apply pipeline's ordering guarantees (confidence gate → span check → writes → re-sync → post-check) with each stage's abort leaving prior state intact.

## Refusal Class Completeness & Actionability

- [ ] CHK001 - Is the full set of refusal `reason` values enumerated, each mapped to its triggering condition, so every refusal class is modeled? [Completeness, Spec §FR-023, schema §refusal.reason]
- [ ] CHK002 - For every refusal class, is a reason message that names the concrete fix/retry required (the selecting qualifier, "run codegraph sync", the offending file, the offending argument)? [Clarity, Spec §FR-007/FR-016/FR-017/FR-021a, schema §refusal.message]
- [ ] CHK003 - Is it required that every recoverable refusal produces zero writes / zero side effects, on both the dry-run and apply surfaces? [Completeness, Spec §FR-001/FR-016/FR-017/FR-020/FR-023]
- [ ] CHK004 - For an ambiguous target, is every candidate required to carry kind, `file:line`, and the exact selecting qualifier so one qualified retry succeeds with zero files read? [Completeness, Spec §FR-007/SC-003, schema §candidates]
- [ ] CHK005 - Is the graph-path local/parameter refusal reason and message ("no local usage tracking — needs a language server") specified? [Completeness, Spec §FR-010]
- [ ] CHK006 - Is the excluded-kind refusal (`file`/`route`/`import`/`export`) specified as terminal on every derivation path? [Completeness, Spec §FR-011]
- [ ] CHK007 - Is the invalid-argument refusal (empty/invalid `newName`, no-op rename, unrecognized `kind`) specified with the offending argument named and `validKinds` enumerated? [Completeness, Spec §FR-021a, schema §refusal.validKinds]
- [ ] CHK008 - Is the not-indexed / target-not-found condition specified as a success-shaped, actionable response (never error-shaped) that names how to proceed? [Coverage, Spec §FR-023/Edge Cases]

## LSP Degradation & Server-Failure Handling

- [x] CHK009 - Is the LSP-vs-graph derivation fork specified to key on server *availability* (a runtime probe), and is a configured-but-absent/unavailable server's degradation to the graph path defined as a requirement (not left implicit in the plan)? [Resolved → Spec §FR-003/§FR-003a "Unavailable" bullet keys the fork on the `probeLspServerCommand` availability probe and routes an unavailable server to the graph path; plan §Primary Dependencies updated]
- [x] CHK010 - Is the behavior on an LSP server *runtime failure* — crash, initialize/request timeout, malformed protocol response, or shutdown failure — during plan derivation OR apply-time recompute specified (fall back to the graph path vs. an honest refusal, and which)? [Resolved → Spec §FR-003a "Runtime failure" bullet: the SPEC-008 `degraded` reason set degrades that rename to the graph path (visible via per-edit `source`), never failing/hanging/partial-planning; Edge Cases bullet added. Flagged for consensus: degrade-to-graph vs. honest-refuse on a mid-rename crash is a genuine design choice — resolved to the SPEC-008-consistent default]
- [x] CHK011 - Is SPEC-008 per-language degradation parity explicitly claimed for rename — a missing or broken server for the target's language never fails the whole `codegraph rename` command? [Resolved → Spec §FR-003a states the parity explicitly (never fails the whole command, mirrors SPEC-008 degrade-and-continue); Assumptions §SPEC-008 substrate tightened]
- [ ] CHK012 - Is it specified that a partial or interrupted LSP workspace edit is never half-applied — the multi-file edit is all-or-nothing? [Coverage, Spec §FR-016/FR-020]
- [ ] CHK013 - Is each edit's derivation path recorded (`source: lsp|graph`) so a fall-back from the LSP path to the graph path is visible in the plan, not silent? [Clarity, Spec §FR-027, schema §edit.source]

## Rollback & Recovery (state mutation)

- [ ] CHK014 - Are rollback requirements defined for a failing post-check — restore every touched file byte-identically from a pre-write snapshot, re-sync, and report which references dangled? [Completeness, Spec §FR-019]
- [ ] CHK015 - Is rollback specified as unconditional (no `--keep-partial` / no configurable partial-apply)? [Consistency, Spec §FR-019/Non-Goals]
- [ ] CHK016 - Is a failed rollback restore specified as the sole error-shaped malfunction, reporting restored/unrestored files and the snapshot recovery-directory location? [Completeness, Spec §FR-019a, schema §recovery]
- [ ] CHK017 - Are the dangling references surfaced as a machine-actionable list on a rolled-back apply so the caller learns what blocked the rename without reading a file? [Completeness, Spec §FR-019, schema §danglingReferences]
- [ ] CHK018 - Is a re-sync that fails or reports no change (index-lock contention) specified as an apply failure that triggers rollback, so the post-check never runs against an un-updated graph? [Coverage, Spec §FR-018]

## Apply Pipeline Ordering & Atomicity

- [ ] CHK019 - Is the apply safety-ladder order specified end-to-end (confidence gate → live-byte span re-verify → workspace-root jail → in-memory snapshot + write → resolution-complete re-sync → touched-file post-check → rollback)? [Completeness, Spec §US3 / plan §Summary]
- [ ] CHK020 - Is the confidence-gate-before-span-check order pinned, so the fired refusal is deterministic when an edit is both heuristic-tier and span-stale? [Clarity, Spec §US3]
- [ ] CHK021 - Is "an abort at any stage leaves the workspace byte-identical to its pre-apply state" specified as an invariant covering every stage (gate, span, write, re-sync, post-check)? [Completeness, Spec §FR-020]
- [ ] CHK022 - Is the stale-span abort specified to occur before any write (span re-verify precedes writes) with zero writes on drift, and to enumerate the drifted files? [Consistency, Spec §FR-016]
- [ ] CHK023 - Is a pre-write in-memory snapshot required for every touched file before any file is written? [Completeness, Spec §FR-018/FR-020]

## Error-Shape Discipline & Surface Encoding

- [ ] CHK024 - Is every expected/recoverable condition required to be success-shaped (never `isError`), with the single failed-rollback exception explicitly carved out of that closed list? [Consistency, Spec §FR-023/FR-019a]
- [ ] CHK025 - Is the CLI exit-code mapping distinct per modeled outcome (0/1/2/3/4) and reconciled with the MCP success-shaped-vs-`isError` encoding so both surfaces encode the same information? [Completeness, Spec §FR-026, contracts]

## Verification Pass (loop 2 — post-remediation re-scan)

Confirms the three loop-1 remediations (new §FR-003a + the LSP-failure Edge Case + the tightened SPEC-008 Assumption + the plan `src/lsp` note) are coherent across spec.md + plan.md, and adversarially re-scans for any inconsistency the edits introduced.

- [x] CHK026 - Does FR-003a resolve the availability-probe fork and absent-server degradation without contradicting FR-003's "configured server covers the language" wording? [Resolved, Spec §FR-003 now routes its "covers" test at §FR-003a — no contradiction]
- [x] CHK027 - Does the runtime-failure degradation reuse the existing refusal taxonomy (no new `reason` enum value added), keeping the Clarify-ratified enum intact? [Resolved, Spec §FR-003a degrades to the graph path then reuses FR-010 `unsupported-kind-graph-local`; schema §refusal.reason unchanged]
- [x] CHK028 - Is an apply-time LSP degradation (dry-run used LSP, apply-time recompute degrades to graph) still safe — the recomputed plan re-enters the confidence gate rather than silently applying a different-shaped plan? [Resolved, Spec §FR-014 recompute + §FR-015 gate compose: a graph-derived recompute containing heuristic edits is heuristic-gated, never silently applied]
- [x] CHK029 - Is the degrade-to-graph outcome kept honest — success-shaped, the LSP→graph path change visible per edit, and the locals refusal message noting a *working* server is required when a configured one failed? [Resolved, Spec §FR-003a `source` visibility + refusal-message clause; §FR-023]
- [x] CHK030 - Do spec (§FR-003a, Edge Cases, Assumptions) and plan (§Primary Dependencies `src/lsp`) state the SPEC-008 degradation parity consistently, with no drift between the two? [Resolved, all four sites cite FR-003a parity]

## Notes

- Check items off as completed: `[x]`.
- A `Gap`-tagged item marks a genuinely missing/under-specified requirement to be remediated by editing the spec/plan/contract artifacts; a resolved item is checked off `[x]` and its tag updated to `Resolved` with the new spec/contract reference.
- Untagged-as-gap items (`[ ]` with a dimension + `Spec §X` reference) are satisfied by the referenced spec section or contract artifact and are recorded for reviewer traceability.
