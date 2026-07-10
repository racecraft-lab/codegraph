# Error-Handling Requirements Quality Checklist: Plugin Platform Mechanics Spike (SPEC-025)

**Purpose**: Validate the error-handling-requirement quality of the SPEC-025 spec/plan before
SPEC-026 builds against the decision document. These are "unit tests for the requirements" in the
error-handling domain — they test whether the failure-path requirements are complete, clear,
consistent, and measurable: the absent-binary launcher path, the npx-fallback failure modes, the
degraded/absent Codex states a user observes, and the both-channels-present misconfiguration
diagnostics — NOT whether any code works.
**Created**: 2026-07-09
**Feature**: [spec.md](../spec.md)

**Focus areas** (from the error-handling domain prompt):
1. Absent-binary path — success-shaped setup guidance CONTENT is specified (what the agent sees,
   what the user is told to run), never `isError`.
2. npx-fallback failure (offline, registry error) — the NEXT fallback step is specified, not implied.
3. Degraded-Codex states — what a Codex user OBSERVES when a component is plugin-absent and
   installer-covered vs. absent entirely.
4. Special attention — any path where BOTH channels are present and MISCONFIGURED: the doc must
   say WHO REPORTS WHAT.

**Depth**: formal pre-SPEC-026 error-handling gate. **Audience**: SPEC-026 implementer + PR reviewer.

**Doctrinal anchor** (grounded, `src/mcp/tools.ts`): `isError: true` is reserved for security
refusals (`PathRefusalError` — "abandoning this path is the desired agent reaction") and genuine
malfunctions; every expected/recoverable condition returns the success-shaped `textResult` shape
(`{ content: [{ type: 'text', text }] }`, no `isError`). FR-006's absent-binary guidance mirrors
`NotIndexedError → textResult`. The checklist tests whether the spike's failure paths hold this line.

## Absent-Binary Path — Success-Shaped Setup Guidance (FR-006)

- [ ] CHK001 Is the absent-binary path required to return success-shaped setup guidance and to NEVER return an `isError` response (errors-teach-abandonment)? [Consistency, Spec §FR-006]
- [ ] CHK002 Is the success-shaped guidance CONTENT specified as a fixed triple — a plain "CodeGraph isn't installed" statement, the exact install command, and success-shaped framing — rather than left to implementer discretion? [Completeness, Spec §FR-006]
- [ ] CHK003 Is the stub-launcher delivery mechanism specified (the plugin's MCP `command` always starts an MCP-speaking process; an unresolved binary yields a stub MCP server returning guidance to initialize/tool calls, never a failed-to-spawn surface)? [Clarity, Spec §FR-006]
- [ ] CHK004 Is "success-shaped" made objectively verifiable by reference to an existing pattern (the `NotIndexedError → textResult` shape) rather than defined subjectively? [Measurability, Spec §FR-006]
- [ ] CHK005 Is the stub launcher's own runtime self-sufficiency required — its executability must not silently depend on an unverified system runtime (e.g. `node`), and SPEC-026's launcher must be a POSIX-shell/self-contained entry point or validate-and-record its per-host runtime dependency? [Completeness, Spec §FR-006]

## npx Fallback Failure Handling (FR-005)

- [ ] CHK006 Is the npx stage required to use `--offline` as the operative flag (zero network requests under any condition; warm cache served locally; cache-miss fails immediately with a catchable error)? [Completeness, Spec §FR-005]
- [ ] CHK007 Is a cache-miss (cold cache or genuinely offline) required to be CAUGHT by the launcher and fall through to the success-shaped guidance stage, rather than silently contacting the registry? [Consistency, Spec §FR-005, §FR-006]
- [ ] CHK008 Is a "registry error" during the npx stage shown to be structurally prevented by `--offline` (zero network requests → no registry contact), so it cannot arise as an unhandled failure? [Consistency, Spec §FR-005]
- [x] CHK009 Does the catch-and-fall-through rule generalize to ALL npx-stage failure modes — a corrupt or partial cache entry, an unavailable `npx`/runtime, or a cached-but-nonfunctional package that spawns yet never completes the MCP handshake — or is ONLY the offline cache-miss error specified as caught? [Coverage, Spec §FR-005, §FR-006] → Resolved: generalized FR-005's catch to ANY npx-stage failure (corrupt/partial cache, npx/runtime unavailable, non-zero npx exit) — all fall through to the stub guidance, never a hard error/failed-spawn; extended FR-006 so the stub is the terminal fallback even for an npx result that spawns but never completes the MCP handshake. The offline cache-miss path (consensus-settled) is preserved verbatim.

## Launcher Stage Observability (FR-007)

- [ ] CHK010 Are the three launcher stages each required to have a distinct recorded observable — (1) binary present → tools appear; (2) absent + warm cache → server comes up via `npx --offline`; (3) absent + offline/uncached → success-shaped guidance, never `isError`/failed-spawn? [Completeness, Spec §FR-007]
- [ ] CHK011 Is the binary-present stage required to record HOW PATH is scoped for a GUI-launched host (login-shell vs app-inherited), so a PATH-resolution failure is attributable rather than ambiguous? [Clarity, Spec §FR-007]
- [ ] CHK012 Is the Windows `.cmd`-shim spawn failure mode (CVE-2024-27980 class, CHANGELOG #289) required to be PROBED as a named risk rather than assumed sound from the installer's PATH spawn? [Edge Case, Spec §FR-007]

## Degraded-Codex Observable States (FR-013 / FR-010)

- [ ] CHK013 Are the three cell-ownership outcomes (plugin-owned / installer-owned / explicitly-absent) each defined as a decided state, with explicitly-absent distinct from "installer covers it"? [Completeness, Spec §FR-010]
- [x] CHK014 Does the spec require the document to specify what a Codex user OBSERVES at runtime for a degraded/absent component — distinguishing a plugin-absent-but-installer-covered cell (functionally equivalent, or a degraded signal?) from an explicitly-absent cell (silent-by-design, or a surfaced note)? [Coverage, Spec §FR-013, §FR-010] → Resolved: extended FR-013 — separately from ownership, the document MUST specify each degraded/absent cell's runtime observable: installer-covered = whether any functional difference is observed (default functionally equivalent, no degraded signal); explicitly-absent = a DECIDED observable (silent-by-design with no user-facing error, or a specific surfaced note), never unspecified — making the US4 asymmetry observable-complete, not merely ownership-complete.
- [ ] CHK015 Is the degraded-Codex asymmetry vs Claude Code required to be expressed as requirements (which components Claude's plugin carries that Codex's cannot), not narrative prose? [Clarity, Spec §FR-013]
- [ ] CHK016 Is the Codex hook-execution cell required to record the "absent on Codex" outcome for a pre-fix/flag-gated CLI build (issue #16430 window), so the degraded state is pinned to build evidence rather than assumed plugin-owned? [Measurability, Spec §FR-010]

## Both-Channels-Present Misconfiguration & Diagnostic Ownership (FR-011)

- [ ] CHK017 Are detection/dedupe requirements specified in BOTH directions so that, when both channels are present, no duplicate MCP registration and no double hook injection occur? [Completeness, Spec §FR-011]
- [ ] CHK018 Is the exactly-one-registered-server invariant held explicitly for the both-present case, with the per-host mechanism recorded (Claude host-arbitrated dedup shown in `/plugin`; Codex installer-detect + user-side `config.toml` toggle)? [Consistency, Spec §FR-011]
- [ ] CHK019 Is the non-viability of plugin-side self-suppression recorded (exit-before-handshake → JSON-RPC -32000, actively reported to the host) with the empty-`tools/list` completed-handshake fallback named for the case suppression is ever required? [Coverage, Spec §FR-011]
- [x] CHK020 For a both-present state that EVADES prevention — near-duplicate MCP entries the Claude host dedup does not collapse, a double hook injection from divergent configs, or Codex (no native cross-channel dedup confirmed) where neither coexistence lever was exercised — does the spec specify WHO detects and reports the duplicate/double-injection and WHAT the user or agent observes? [Coverage, Spec §FR-011] → Resolved (provisional — flagged for consensus): extended FR-011 to require the document specify diagnostic ownership for the evaded-dedup both-present state — on Claude, near-duplicate entries are not host-collapsed, so the observable (two servers run; duplicated tool surfaces) + reporter (installer's next invocation-driven detection, FR-012) MUST be recorded; on Codex (no native dedup), the residual-window observable (duplicate servers/hooks until the next `codegraph install`) + the toggle/installer-detection remediators MUST be stated, not implied. The exact diagnostic OWNER for the evaded/Codex case is surfaced for consensus (coexistence-semantics decision); the who-reports-what + observable requirement holds regardless.
- [ ] CHK021 Is the installer-detects-plugin timing understood as invocation-driven (detection occurs when `codegraph install` runs), so a plugin installed AFTER the last installer run is a recognized coexistence condition rather than an assumed-impossible one? [Consistency, Spec §FR-011, §FR-012]

## Guidance / Auto-Install Consistency (FR-006 × FR-021)

- [x] CHK022 Is the absent-binary guidance's "exact install command" element required to be framed as a USER action (surfaced for the user to run), reconciled with FR-021's no-auto-install rule so the guidance does NOT direct or invite the AGENT to execute the install itself? [Consistency, Spec §FR-006, §FR-021] → Resolved: extended FR-006 — the exact install command MUST be framed as a USER action (guidance the agent surfaces to the user to run), and the guidance MUST NOT direct or invite the agent to execute the install itself, preserving FR-021's no-auto-install rule (an agent-run install would be the exact auto-install vector FR-021 forbids).
- [ ] CHK023 Is plugin-channel network/telemetry/auto-install parity with the npm channel affirmed, so no error-path or guidance behavior introduces an install/phone-home vector the npm channel lacks? [Consistency, Spec §FR-021]

## Staged-Decision & Timebox Error Discipline (FR-020 / FR-008 / SC-008)

- [ ] CHK024 Is any timebox miss required to be recorded as an explicit, attempt-first staged decision (naming what was attempted and the evidenced blocker), never a silent gap? [Coverage, Spec §FR-020, §SC-008]
- [ ] CHK025 Is the hands-on-contradicts-published-docs case required to follow the observed evidence and flag the doc as stale for SPEC-026, so a documentation-vs-reality mismatch resolves deterministically? [Edge Case, Spec Edge Cases]
- [ ] CHK026 Is a launcher-contract falsification (validation contradicts the PRD OQ-8 hypothesis) required to trigger a defined alternative — a full equal-weight launcher trade study — rather than an undefined outcome? [Coverage, Spec §FR-008]

## Evidence Discipline for Error-Path Claims (FR-003 / FR-019)

- [ ] CHK027 Is every load-bearing error-path claim (absent-binary guidance, npx fall-through, dedup/self-suppression behavior) required to carry a public citation AND a hands-on evidence block, or an explicit "could not validate" note? [Traceability, Spec §FR-003, §FR-020]
- [ ] CHK028 Are error-path evidence transcripts (the observed stub-vs-failed-spawn host surface; the JSON-RPC -32000 observation) required to be secret-scrubbed before they land in committed text? [Consistency, Spec §FR-019]

## Re-run Verification Pass (loop 1 — after remediation)

Re-evaluation of the error-handling domain against the updated spec (FR-005 npx-failure
generalization; FR-006 stub terminal fallback + install-command-as-user-action; FR-011
evaded-dedup diagnostic ownership; FR-013 degraded/absent observable) and plan (§5/§7/§8 bars).
Confirms the loop-1 gaps now trace to real requirements and scans for any new gap the edits introduced.

- [x] CHK029 Post-edit, does FR-005 now require the catch-and-fall-through to generalize to ALL npx-stage failures (corrupt/partial cache, npx/runtime unavailable, non-zero exit), not only the offline cache-miss? [Completeness, Spec §FR-005] — Confirmed; the consensus-settled cache-miss path is preserved verbatim.
- [x] CHK030 Post-edit, does FR-006 now (a) make the stub the terminal fallback for a spawned-but-nonfunctional npx result that never completes the handshake, and (b) frame the exact install command as a USER action reconciled with FR-021's no-auto-install rule? [Consistency, Spec §FR-006, §FR-021] — Confirmed; the guidance triple (consensus-settled) is preserved verbatim.
- [x] CHK031 Post-edit, does FR-013 now require each degraded/absent Codex cell's runtime user-observable (installer-covered = functionally equivalent; explicitly-absent = a decided silent-or-noted observable), distinct from ownership? [Completeness, Spec §FR-013] — Confirmed; the ownership/no-coverage-fallback content is preserved.
- [x] CHK032 Post-edit, does FR-011 now require diagnostic ownership (who-reports-what + the user/agent observable) for the evaded-dedup both-present state on both hosts, provisional-flagged for consensus? [Coverage, Spec §FR-011] — Confirmed; the prevention content + exactly-one-server invariant are preserved.
- [x] CHK033 Do the edits introduce no conflict with the consensus-settled requirements (FR-005 cache-miss fallthrough, FR-006 guidance triple / stub-launcher delivery, FR-010 three-outcome cells, FR-012 orphan-cleanliness, FR-013 no-coverage fallback)? [Consistency, Spec §FR-005, §FR-006, §FR-010, §FR-012, §FR-013] — Confirmed: all settled content preserved verbatim; every addition is orthogonal (generalization, observable dimension, diagnostic dimension), reversing nothing.
- [x] CHK034 Do spec.md and plan.md agree on the new sub-requirements (no drift between the edited FRs and plan §5/§7/§8 bars)? [Consistency, Spec §FR-005, §FR-006, §FR-011, §FR-013] — Confirmed: plan §5 (any-npx-failure fallthrough + install-as-user-action), §7 (evaded-dedup who-reports-what), §8 (per-cell observable) updated to match.

**Loop-1 verification result:** zero new unresolved-gap markers. All four loop-1 gaps closed and traced
to FR-005 / FR-006 / FR-011 / FR-013. CHK020 (FR-011 evaded-dedup diagnostic ownership) carries a
provisional resolution flagged for consensus — the spec is internally consistent regardless of which
diagnostic-owner semantics consensus ratifies.

## Notes

- Check items off as resolved: `[x]`. A bracketed Gap marker flags a requirement assessed
  missing or underspecified in the error-handling dimension; resolving it edits spec.md/plan.md and
  re-points the item at the added/clarified requirement.
- Traceability: ≥80% of items carry a `[Spec §…]` reference or a quality/coverage marker.
