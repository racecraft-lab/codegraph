# API Contracts Checklist: Graph-Aware Rename

**Purpose**: Validate the quality (completeness, clarity, consistency, measurability, coverage) of the CLI + MCP contract requirements — one shared plan/apply contract, the stable plan output schema, machine-actionable refusals, exit codes, and surface-native (exit-code vs success-shaped) encodings — before implementation.
**Created**: 2026-07-11
**Feature**: [spec.md](../spec.md) · contracts: [cli-rename.md](../contracts/cli-rename.md), [mcp-codegraph_rename.md](../contracts/mcp-codegraph_rename.md), [rename-plan.schema.json](../contracts/rename-plan.schema.json)

**Note**: Unit tests for the *requirements*, not the implementation. Each item asks whether the contract is well-specified — not whether code behaves.

## Contract Parity (CLI ≡ MCP)

- [x] CHK001 - Is there an explicit parameter-mapping table pairing each CLI flag/positional (`<target>`, `<new-name>`, `--file`, `--kind`, `--apply`, `--include-heuristic`, `-j/--json`, `--path`) with its MCP camelCase parameter (`target`, `newName`, `file`, `kind`, `apply`, `includeHeuristic`, `projectPath`), including the asymmetries (`-j/--json` has no MCP analog since the MCP result is always structured; `--path` ↔ `projectPath`)? [Resolved → Spec §FR-021 mapping table + contracts/cli-rename.md §"CLI ↔ MCP parameter mapping"]
- [ ] CHK002 - Are the dry-run-by-default and explicit-apply semantics specified identically for the CLI (`--apply`) and MCP (`apply: true`) surfaces? [Consistency, Spec §FR-001/FR-021]
- [ ] CHK003 - Is the "same request ⇒ same plan and same apply outcome on both surfaces" guarantee stated with an objectively verifiable criterion? [Measurability, Spec §SC-005]
- [ ] CHK004 - Are the include-heuristic gate semantics defined consistently across surfaces (default false; no effect on a dry-run)? [Consistency, Spec §FR-015]
- [ ] CHK025 - Are required vs optional parameters specified consistently (target/newName required; apply/includeHeuristic/file/kind/projectPath optional) across CLI and MCP? [Consistency, Spec §FR-021, contracts]

## Plan Output Schema

- [ ] CHK005 - Are the per-edit output fields (`file`, `range`, `oldText`, `newText`, `confidence`, `source`) enumerated with identical names for `-j/--json` and the MCP result? [Completeness, Spec §FR-027]
- [x] CHK006 - Is "before/after preview" (FR-002) reconciled with the JSON `oldText`/`newText` fields, and does the schema carry enough context for a JSON/MCP consumer to satisfy SC-001's "see before/after without reading any file first"? [Resolved → Spec §FR-027 adds per-edit `lineText` (source line before edit) + schema §edit; flagged for consensus: how much context the contract carries is a design choice]
- [ ] CHK007 - Is the offset unit for `range` specified unambiguously and identically across both surfaces (UTF-16 code units, no byte↔UTF-16 translation)? [Clarity, Spec §FR-027/Assumptions]
- [ ] CHK008 - Is the line/character indexing base for the surface schema (0-based, vs the graph's 1-based line) specified so both surfaces agree? [Clarity, data-model.md §Data Model / schema §position]
- [ ] CHK009 - Is the aggregate plan `confidence` (`all-exact` / `contains-heuristic`) and its relationship to per-edit tiers defined? [Completeness, Spec §FR-027, schema §confidence]
- [x] CHK010 - Is the `edits` ordering criterion (and the ordering of the `candidates` / `gatedEdits` / `files` arrays) defined deterministically, and the MCP payload carrier (`structuredContent` vs `text`) + serialization pinned, so the CLI `--json` and MCP results are actually byte-identical as SC-005/FR-027 assert? [Resolved → Spec §FR-027 determinism clause (order by file/line/char; canonical serialization; text result) + schema top + edit description + contracts/mcp-codegraph_rename.md §Result]
- [ ] CHK011 - Is it specified that a plan's `edits` always contains at least the declaration edit (an empty-references plan is valid, never an empty edit set)? [Consistency, Spec §FR-002/US1-scenario-3]

## Refusal Machine-Actionability

- [ ] CHK012 - Are refusal responses required to carry machine-actionable structured content (not only a human message) so a caller can retry without reading a file? [Completeness, Spec §FR-007/FR-023, schema §refusal]
- [ ] CHK013 - For an ambiguous target, is every candidate required to include its kind, `file:line`, and the exact selecting qualifier, so one qualified retry succeeds with zero files read? [Completeness, Spec §FR-007/SC-003, schema §candidates]
- [ ] CHK014 - For a heuristic-gated apply, is the gated-edit list required in the refusal? [Completeness, Spec §FR-015, schema §gatedEdits]
- [x] CHK015 - For a stale-span refusal, is a machine-actionable list of the drifted file(s)/span(s) required — sufficient to act on without reading a file — or is the absence of such a list an explicit, justified decision? [Resolved → Spec §FR-016 now requires the refusal to enumerate the drifted files (schema §refusal.files extended to stale-span)]
- [ ] CHK016 - For out-of-root / scope-ignored refusals, is the offending file list required in the refusal? [Completeness, Spec §FR-017, schema §files]
- [x] CHK017 - Are the apply-outcome payloads modeled in the shared schema — the dangling-reference list for `rolled-back` (FR-019) and the recovery report (restored/unrestored files + recovery directory) for `rollback-failed` (FR-019a) — given the schema's `refusal` description references a `recovery` object that is never defined? [Resolved → schema adds top-level `danglingReferences` + defines `recovery` (restoredFiles/unrestoredFiles/recoveryDir); Spec §FR-019/§FR-019a + data-model §ApplyResult name them]
- [ ] CHK018 - Is the full set of refusal `reason` values enumerated and each mapped to its triggering condition? [Completeness, schema §refusal.reason]

## Exit Codes & Surface-Native Encoding

- [ ] CHK019 - Are the CLI exit codes distinct per modeled outcome (0 plan-produced/apply-green, 1 internal/usage, 2 recoverable refusal, 3 rolled-back, 4 failed rollback)? [Completeness, Spec §FR-026]
- [ ] CHK020 - Is the deliberate sharing of exit 0 by both success states (dry-run plan produced / apply post-check-green) documented with rationale? [Clarity, Spec §FR-026]
- [ ] CHK021 - Is the correspondence between CLI exit codes and MCP result shapes (success-shaped + `outcome` field vs `isError`) documented so both encode the same information in surface-native form? [Consistency, Spec §FR-023/FR-026, data-model §ApplyOutcome]
- [ ] CHK022 - Is the single error-shaped exception (failed rollback → `isError` / exit 4) unambiguously distinguished from every success-shaped refusal? [Clarity, Spec §FR-019a/FR-023]
- [ ] CHK023 - Are the Slice-1-reachable exit codes (0/1/2 only; 3/4 arrive with the apply engine) specified so the surface contract is correct per slice? [Consistency, Spec §FR-026/Assumptions]

## Input Contract & Edge Coverage

- [x] CHK024 - Are input-validation requirements defined for `newName` (non-empty, a valid identifier, differing from the target's current name) and for an unknown/invalid `kind` value, with a specified surface-native outcome on both surfaces? [Resolved → Spec adds §FR-021a (validation contract) + Edge Cases bullet + §FR-023/schema `invalid-argument` reason (success-shaped, exit 2); flagged for consensus: unknown-kind vs target-not-found routing]
- [ ] CHK026 - Is the not-indexed / target-not-found condition specified as a success-shaped, actionable response on both surfaces (never error-shaped)? [Coverage, Spec §FR-023, schema §refusal.reason]

## Annotations & Tool Exposure (MCP)

- [ ] CHK027 - Are the MCP tool annotations (`readOnlyHint:false`, `destructiveHint:true`, `idempotentHint:false`, `openWorldHint:false`) specified with rationale? [Completeness, Spec §FR-028]
- [ ] CHK028 - Is the accepted consequence (a read-only-gated client mode refusing even a dry-run call) documented as an explicit contract decision, and is `codegraph_rename`'s always-exposed / second-default-served membership specified? [Clarity, Spec §FR-022/FR-028]

## Verification Pass (loop 2 — post-remediation re-scan)

Confirms the six loop-1 remediations are coherent across spec.md + contracts + schema, and adversarially re-scans for any inconsistency the edits introduced.

- [x] CHK029 - Does the FR-021 CLI↔MCP mapping table cover every parameter with the two asymmetries (`-j/--json` has no analog; `--path` ↔ `projectPath`)? [Resolved, Spec §FR-021 / contracts/cli-rename.md]
- [x] CHK030 - Is the before/after preview now renderable by a JSON/MCP consumer without a Read via the per-edit `lineText` field? [Resolved, Spec §FR-027 / schema §edit]
- [x] CHK031 - Is the byte-identical CLI≡MCP parity now backed by a deterministic edit order + canonical serialization + pinned text-result carrier? [Resolved, Spec §FR-027 / schema top+edit / contracts/mcp-codegraph_rename.md]
- [x] CHK032 - Does the stale-span refusal now enumerate the drifted files (schema §refusal.files extended)? [Resolved, Spec §FR-016]
- [x] CHK033 - Are the `rolled-back` (`danglingReferences`) and `rollback-failed` (`recovery`) payloads now defined in the schema, with no dangling `recovery` reference? [Resolved, schema §danglingReferences/§recovery, Spec §FR-019/FR-019a]
- [x] CHK034 - Is the `invalid-argument` input-validation refusal specified identically on both surfaces (success-shaped; CLI exit 2; never isError)? [Resolved, Spec §FR-021a/FR-023 / schema §refusal.reason]
- [x] CHK035 - Does the shared schema's top-level `required` list (`target`, `newName`, `edits`, `confidence`, `applied`) admit a **refusal** result — where `target`/`edits`/`confidence` are legitimately absent (ambiguous-target, not-indexed, target-not-found, invalid-argument) yet `refusal` is populated — or does it force fields a refusal cannot supply? [Resolved → schema top-level `required` relaxed to `["newName","applied"]` + description documents the three result shapes (plan / refusal / apply terminal); Spec §FR-027 "Result envelope shape"]
- [x] CHK036 - Is the plan-vs-refusal result shape (which fields are present in each) documented so a consumer can branch deterministically on `applied` / `refusal`? [Consistency, schema top-level description]

## Notes

- Check items off as completed: `[x]`.
- A `Gap`-tagged item marks a genuinely missing/under-specified requirement to be remediated by editing the spec/plan/contract artifacts; a resolved item is checked off and its tag updated to `Resolved` with the new spec/contract reference.
- Untagged-as-gap items are satisfied by the referenced spec section or contract artifact and are recorded for reviewer traceability.
