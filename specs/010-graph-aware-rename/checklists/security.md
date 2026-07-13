# Security Checklist: Graph-Aware Rename

**Purpose**: Validate the quality (completeness, clarity, consistency, coverage) of the *security* requirements — the workspace-root path jail, `.gitignore`/scope-ignore respect, path-refusal shape and its consistency with the existing `PathRefusalError` class, and the MCP write-exposure / authorization boundary — before implementation.
**Created**: 2026-07-11
**Feature**: [spec.md](../spec.md) · plan: [plan.md](../plan.md) · contracts: [mcp-codegraph_rename.md](../contracts/mcp-codegraph_rename.md) · [cli-rename.md](../contracts/cli-rename.md)

**Note**: Unit tests for the *requirements*, not the implementation. Each item asks whether the security contract is well-specified — not whether code behaves. Focus areas (domain prompt): every planned write path resolves inside the symlink-resolved project root and an outside-root LSP edit refuses the whole plan; ignored/vendored files are neither planned nor written; refusals stay consistent with the one legitimate `isError` `PathRefusalError` class; MCP side effects occur only on explicit `apply:true` with host permission prompts as the outer gate; with special attention to **symlinked project roots** and **case-insensitive filesystems (macOS)** when resolving "inside the jail".

## Workspace-Root Jail — Path Containment

- [ ] CHK001 - Is every planned write path required to resolve inside the workspace root via a symlink-resolving containment check, enforced per edit at **both** plan generation and apply time? [Completeness, Spec §FR-017]
- [x] CHK002 - Is the jail's behavior on a **symlinked project root** specified — is the workspace root itself symlink-resolved (both sides of the comparison) so an edit under the root's real location is correctly in-jail and an in-root symlink whose real target escapes the root is refused? [Resolved → Spec §FR-017 "Symlinked root & case-insensitive filesystems": both the candidate path and the root are realpath-resolved before comparison; an in-root symlink whose real target escapes the root is refused]
- [x] CHK003 - Is the jail's behavior on a **case-insensitive filesystem (macOS/APFS, Windows)** specified, so a case-variant of an in-root path is neither falsely refused nor able to escape the jail? [Resolved → Spec §FR-017 "Symlinked root & case-insensitive filesystems": containment is decided after realpath normalization, which canonicalizes each existing path to its on-disk casing, so a case-variant of an in-root path resolves as in-root and case never manufactures an escape]
- [ ] CHK004 - Is a language-server workspace edit naming a file whose symlink-resolved path falls outside the root required to refuse the **entire** plan (never a partial apply), success-shaped and naming the file? [Completeness, Spec §FR-017, Edge Cases]
- [x] CHK005 - Is it specified that the jail/scope check is applied **before** an edit's target file is read for span verification, so a path outside the root (or in ignored scope) is refused without its bytes ever being read during plan derivation? [Resolved → Spec §FR-017 "Refuse before read": the jail/scope check precedes the span-verification read (FR-005/FR-016), reusing the out-of-root content-leak chokepoint so derivation never discloses a file it would refuse to write]
- [ ] CHK006 - Is the containment check required on **both** derivation paths (LSP and graph), so neither can emit an out-of-root edit? [Consistency, Spec §FR-017]

## `.gitignore` / Scope-Ignore Respect

- [ ] CHK007 - Is the ignore test specified as the indexer/watcher's shared scope matcher (honoring `codegraph.json` `include`/`exclude`), never a raw `.gitignore` reparse? [Clarity, Spec §FR-017]
- [ ] CHK008 - Is an edit targeting an in-root but scope-ignored (gitignored / `codegraph.json`-excluded) file required to refuse the whole plan, success-shaped, naming the file — never a silent write and never a silent skip? [Completeness, Spec §FR-017, Edge Cases]
- [x] CHK009 - Is the interaction with **vendored/generated code** documented — that old-name references living *inside* scope-ignored/un-indexed files are neither planned/renamed nor reported (the post-check and leftover-mention FYI range only over re-indexed touched files)? [Resolved → Spec §Edge Cases "Old-name references inside scope-ignored / un-indexed files": such references are invisible to the index, so neither edited nor counted; remedy is a `codegraph.json` `include`; contrasted with the FR-017 scope-ignored-edit refusal]
- [ ] CHK010 - Is the remedy for a legitimately-needed rename into ignored scope specified (bring the file into scope, or accept a manual edit)? [Coverage, Spec §FR-017, Edge Cases]

## Path-Refusal Shape & `PathRefusalError` Consistency

- [ ] CHK011 - Is the workspace-jail / scope-ignore refusal specified as **success-shaped** (a `textResult` carrying the `refusal` object; CLI exit `2`), consistent with FR-023's recoverable-condition list? [Consistency, Spec §FR-017/FR-023]
- [x] CHK012 - Is the jail refusal specified as **distinct from the existing `isError` `PathRefusalError`** class — which stays scoped to an agent-supplied sensitive-path argument and is neither reused nor widened by this feature? [Resolved → Spec §FR-017 "Not `PathRefusalError`": jail/scope refusals are success-shaped (textResult, exit 2); `PathRefusalError` stays scoped to agent-supplied sensitive-path arguments and is neither reused nor widened; FR-019a remains the sole `isError` outcome]
- [ ] CHK013 - Is `isError` reserved on this surface to the single failed-rollback malfunction, so a jail/scope refusal never trips the `isError` path? [Consistency, Spec §FR-019a/FR-023]

## MCP Write Exposure & Authorization Boundary

- [ ] CHK014 - Is the tool required to be dry-run by default, with side effects only on an explicit `apply: true` parameter? [Completeness, Spec §FR-021]
- [x] CHK015 - Is it specified that **no rename/write is triggered by the MCP `initialize` handshake or a `tools/list` request** — that exposure/listing of the write tool is inert? [Resolved → Spec §Assumptions "Host permission prompts are the outer authorization gate": listing is inert; a rename is triggered only by an explicit `tools/call` carrying `apply: true`, never by `initialize` or `tools/list`]
- [x] CHK016 - Is the reliance on **host permission prompts as the outer authorization gate** (design concept Q7) documented — the tool performs no authentication/authorization of its own and holds no credential? [Resolved → Spec §Assumptions "Host permission prompts are the outer authorization gate": the tool does no auth of its own and holds no credential; the security boundary is the host's permission prompt plus the FR-017 workspace-root jail]
- [ ] CHK017 - Are the write-tool annotations (`readOnlyHint:false`, `destructiveHint:true`, `idempotentHint:false`, `openWorldHint:false`) specified so a host can gate/prompt on the destructive write? [Completeness, Spec §FR-028]
- [ ] CHK018 - Is "always exposed" specified as default-served-set membership (never hidden behind an opt-in gate), with safety carried by response *shape* rather than by hiding the tool? [Clarity, Spec §FR-022]

## Write Atomicity & Temp-File Safety

- [ ] CHK019 - Is the write specified as temp-file-then-atomic-rename with an in-memory pre-write snapshot of every touched file? [Completeness, Spec §FR-018/FR-020]
- [ ] CHK020 - Is the temp sibling's containment covered — it is created in the target file's already-jail-verified directory, so it cannot redirect a write outside the root? [Coverage, Spec §FR-017/FR-020]
- [ ] CHK021 - Is an in-root **source file that is itself a symlink escaping the root** handled — refused by the realpath jail before any write, so the atomic-rename never redirects through it? [Consistency, Spec §FR-017]
- [ ] CHK022 - Is the hard mid-write process-kill window documented as the accepted v1 durability limitation (best-effort atomicity through verification, not crash-durable)? [Assumption, Spec §FR-020, Edge Cases]

## Input Validation (Injection Surface)

- [ ] CHK023 - Is `newName` required to be a syntactically valid identifier for the target's language — refusing empty/malformed values — as the guard against injecting non-identifier text into an edited span? [Completeness, Spec §FR-021a]
- [ ] CHK024 - Is an unrecognized `kind` refused as `invalid-argument` (distinct from a well-formed excluded kind and from a valid-but-unmatched kind), with `validKinds` enumerated so the retry needs no file read? [Clarity, Spec §FR-021a]
- [ ] CHK025 - Is the recovery-directory path specified with PID+random-hex uniqueness under `.codegraph/` (in-root), so a later incident's dump never overwrites an earlier one? [Coverage, Spec §FR-019a]

## Verification Pass (loop 2 — post-remediation re-scan)

Confirms the three loop-1 remediations (the FR-017 security sub-bullets, the new scope-ignored/un-indexed Edge Case, and the host-permission-gate Assumption) are coherent across spec.md and do not reopen any human-ratified decision.

- [x] CHK026 - Do the new FR-017 sub-bullets (symlinked root, case-insensitive FS, refuse-before-read, not-`PathRefusalError`) sit within the ratified FR-017 jail decision as clarifying additions rather than changes to it? [Resolved, Spec §FR-017 — additions describe the ratified `validatePathWithinRoot` mechanism's behavior; the per-edit symlink-resolved jail at plan+apply time is unchanged]
- [x] CHK027 - Does the "Not `PathRefusalError`" clause stay consistent with FR-019a's "sole `isError` outcome" and FR-023's closed success-shaped list (no new `isError` class introduced)? [Resolved, Spec §FR-017/FR-019a/FR-023 — jail/scope refusals are success-shaped `textResult`; `PathRefusalError` neither reused nor widened; FR-019a stays the only `isError`]
- [x] CHK028 - Does the new Edge Case (references inside scope-ignored/un-indexed files) stay consistent with FR-017's scope-ignored-*edit* refusal — distinct cases, not a contradiction? [Resolved, Spec §Edge Cases — explicitly contrasts the invisible-reference case (no edit produced) with the refused-edit case (whole plan refused)]
- [x] CHK029 - Does the host-permission-gate Assumption stay consistent with FR-021 (side effects only on `apply:true`) and FR-022 (always-exposed = default-served membership), with exposure/listing inert? [Resolved, Spec §Assumptions/FR-021/FR-022 — listing is inert; a write fires only on an explicit `apply:true` `tools/call`]

## Notes

- Check items off as completed: `[x]`.
- A `Gap`-tagged item marks a genuinely missing/under-specified requirement to be remediated by editing the spec/plan/contract artifacts; a resolved item is checked off `[x]` and its tag updated to `Resolved` with the new spec/contract reference.
- Untagged-as-gap items (`[ ]` with a dimension + `Spec §X` reference) are satisfied by the referenced spec section or contract artifact and are recorded for reviewer traceability.
