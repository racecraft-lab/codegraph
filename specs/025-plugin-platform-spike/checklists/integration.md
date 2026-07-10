# Integration Requirements Quality Checklist: Plugin Platform Mechanics Spike (SPEC-025)

**Purpose**: Validate the integration-requirement quality of the SPEC-025 spec/plan before
SPEC-026 builds against the decision document. These are "unit tests for the requirements"
in the integration domain — they test whether the two-channel (plugin × npm-installer)
coexistence requirements are complete, clear, consistent, and cover every component × host
cell, both detection directions, the uninstall interplay, and the degraded-Codex
asymmetry — NOT whether any code works.
**Created**: 2026-07-09
**Feature**: [spec.md](../spec.md)

**Focus areas** (from the integration domain prompt):
1. Every cell of the component × host matrix (MCP, hook, skills, agents × Claude, Codex)
   has an owner: plugin, installer (gap coverage per Q7), or explicitly absent.
2. Detection specified in BOTH directions — installer-detects-plugin and
   plugin-detects-installer — including what each does on detection.
3. Uninstall interplay: removing either channel leaves the other functional, with no
   orphaned MCP entries or hooks.
4. Special attention — the degraded-Codex subset (Q6): the asymmetry must be requirements,
   not prose.

**Depth**: formal pre-SPEC-026 integration gate. **Audience**: SPEC-026 implementer + PR reviewer.

## Component × Host Ownership Matrix (8 cells)

- [ ] CHK001 Does the spec require a component × host ownership matrix covering all 8 cells — (MCP server, prompt front-load hook, skills, agents) × (Claude Code, Codex) — with no blank or undecided cell? [Completeness, Spec §FR-010, §SC-004]
- [ ] CHK002 Is each matrix cell required to state BOTH whether the host's plugin format can carry the component AND which single channel owns it? [Clarity, Spec §FR-010]
- [ ] CHK003 Is the default ownership rule specified — the plugin owns the config-writing role for every component its host format can carry, the npm installer keeps the binary-distribution role and covers per-component gaps? [Completeness, Spec §FR-009]
- [x] CHK004 Is the third possible cell outcome — a component neither channel provides (explicitly absent, no owner) — defined as a valid, labeled matrix state distinct from "installer covers it"? [Completeness, Spec §FR-010] → Resolved: extended FR-010 to require each cell resolve to exactly one of three labeled outcomes — plugin-owned / installer-owned (new-capability-flagged per FR-009) / explicitly-absent (rationale + SPEC-026 consequence) — with explicitly-absent defined as a decided outcome, not a blank, distinct from "installer covers it."
- [ ] CHK005 Is the prompt-front-load-hook cell's working assignment (plugin-owned on BOTH hosts, pending validation) specified, with the "absent on Codex" outcome conditioned on the pinned-CLI-build hook test? [Clarity, Spec §FR-010]
- [ ] CHK006 Is the skills-cell owner derivable/specified for each host from the shared agent-skills standard (plugin carries skills on both) plus the FR-009 default? [Consistency, Spec §FR-009, Assumptions]
- [ ] CHK007 Is a cell assigned to the npm installer that the installer does NOT write today required to be flagged as new SPEC-026 installer capability rather than existing behavior (Q7)? [Traceability, Spec §FR-009, §FR-010]

## Bidirectional Detection & Dedupe

- [ ] CHK008 Are detection and dedupe requirements specified in BOTH directions (installer-detects-plugin AND plugin-detects-installer) so no duplicate MCP registration and no double hook injection occur? [Completeness, Spec §FR-011]
- [ ] CHK009 Is the installer-detects-plugin key specified (keys on the installed plugin's directory/manifest presence) along with what it does on detection (skips or offers to remove its own MCP and hook entries)? [Clarity, Spec §FR-011]
- [ ] CHK010 Is the plugin-detects-installer side specified per host — Claude host-arbitrated MCP dedup (manual/installer entry wins, plugin copy suppressed, shown in `/plugin`) versus Codex user-side `config.toml` toggle — with the exactly-one-registered-server invariant held? [Clarity, Spec §FR-011]
- [ ] CHK011 Is the Claude coexistence lever decision (i: installer keeps its entry + host dedup suppresses the plugin copy, vs ii: installer defers so only the plugin copy remains) required to be decided and recorded hands-on rather than assuming the plugin wins by default? [Measurability, Spec §FR-011]
- [ ] CHK012 Is the non-viability of plugin-side self-suppression recorded (an exit-before-handshake attempt surfaces as JSON-RPC -32000), with the empty-`tools/list` completed-handshake fallback named for the case plugin-side suppression is ever required? [Coverage, Spec §FR-011]
- [x] CHK013 Do the FR-009 "plugin owns config-writing for every component its host format can carry" rule and the FR-011 lever-(i) "installer keeps its winning MCP entry" outcome reconcile — i.e., is the MCP-server-on-Claude matrix owner unambiguous when a host-native dedup lever is in play? [Consistency, Spec §FR-009, §FR-011] → Resolved (provisional — flagged for consensus): extended FR-009 so its plugin-owns-config-writing default yields to the FR-011 lever for a natively-deduped cell (MCP-server × Claude) — the matrix owner is the active-registration channel (installer under lever (i); plugin under lever (ii)), so FR-010 and FR-011 never disagree. The choice of "owner = active-registration channel" (vs "owner = FR-009 policy default") is a matrix-semantics project decision surfaced for consensus.
- [ ] CHK014 Are detection and dedupe requirements required to distinguish entries the installer writes today from entries that would be new SPEC-026 installer capability? [Consistency, Spec §FR-011, §FR-009]

## Uninstall Interplay & Orphan Cleanliness

- [ ] CHK015 Is the uninstall interplay required such that removing EITHER channel leaves the other channel functional? [Completeness, Spec §FR-012]
- [ ] CHK016 Is the plugin-removal restore path specified as invocation-driven (takes effect on the next explicit `codegraph install` re-run, consistent with install-time self-heal), explicitly NOT automatic via a file watcher or background process? [Clarity, Spec §FR-012]
- [x] CHK017 Is it required that removing a channel leaves NO orphaned MCP entry or hook — each channel's uninstall removes only its own entries, and the installer's `codegraph uninstall` must not remove or clobber the plugin's entries (nor vice-versa)? [Completeness, Spec §FR-012] → Resolved: extended FR-012 to require no orphaned MCP entry/hook — the installer's `codegraph uninstall` strips only what it wrote (its MCP registration + the Claude front-load prompt hook) and must not touch the plugin's entries; plugin components are plugin-scoped (FR-001) so plugin removal is atomic with no dangling host-config entry; plus the lever-(ii) zero-server window is stated.
- [ ] CHK018 Is the plugin-removal cleanliness mechanism required to be documented — plugin-scoped `mcpServers`/`hooks` live in the plugin, so removing the plugin removes them atomically with no dangling host-config entry pointing at an absent plugin? [Coverage, Spec §FR-001] (see CHK017)
- [ ] CHK019 Is the interaction between the chosen coexistence lever and uninstall covered — e.g. under lever (ii) (installer deferred), plugin removal leaves zero registered servers until the invocation-driven restore runs, and that window is stated rather than implied? [Coverage, Spec §FR-011, §FR-012] (see CHK017)

## Degraded-Codex Subset & Asymmetry (Q6)

- [ ] CHK020 Is the degraded-Codex subset expressed as REQUIREMENTS — the specific matrix cells the Codex plugin format cannot carry, each reassigned per the ownership matrix — rather than narrative prose? [Clarity, Spec §FR-013]
- [ ] CHK021 Is the known agents-cell degradation specified (the Codex plugin format does not bundle subagents; standalone `.codex/agents/*.toml` is installer-writable CLI config), recorded as new SPEC-026 installer capability? [Completeness, Spec §FR-013]
- [ ] CHK022 Is the Codex subagent reassignment gated on hands-on confirmation that pins the multi-agent runtime path (`multi_agent_v1` vs `multi_agent_v2`) and the model pairing CodeGraph ships against, given named-agent invocation is reported to fail on `multi_agent_v2`? [Measurability, Spec §FR-013]
- [ ] CHK023 Is the asymmetry vs Claude Code required to be documented (which components Claude's plugin carries that Codex's cannot)? [Completeness, Spec §FR-013]
- [ ] CHK024 Is the Codex hook-execution cell required to pin the installed Codex CLI build so a pre-fix / flag-gated-off build (issue #16430 window) records the "absent on Codex" outcome rather than assuming plugin-owned? [Measurability, Spec §FR-010]
- [x] CHK025 Where a degraded Codex cell has NO installer coverage today (e.g. the prompt front-load hook, which the Codex installer does not write), is the outcome required to resolve to either new SPEC-026 installer capability or an explicitly-absent cell — rather than FR-013 force-assigning every degraded cell to an installer that may not cover it? [Completeness, Spec §FR-013] → Resolved: extended FR-013 — reassignment to the installer presumes installer coverage; a degraded Codex cell with no installer coverage today (naming the Codex prompt hook, which the Codex installer does not write, unlike Claude's `UserPromptSubmit` hook) resolves to new SPEC-026 capability or explicitly-absent (per FR-010) on the pinned-build evidence, not force-assigned. (see CHK004)

## Cross-Cutting Integration Quality

- [ ] CHK026 Is a stable component × host cell identity scheme used so each cell's owner, can-carry verdict, and evidence are individually traceable (no cell resolvable only by inference)? [Traceability, Spec §FR-010]
- [ ] CHK027 Are the coexistence failure modes the matrix exists to prevent stated as the pass condition — no duplicate MCP registration and no double prompt-hook front-loading when both channels are present? [Measurability, Spec §FR-011, US3]
- [ ] CHK028 Is every ownership/coexistence/uninstall decision required to close with a public citation and, where load-bearing, a hands-on evidence block (or an explicit "could not validate" note), consistent with the spike's evidence discipline? [Consistency, Spec §FR-003, §FR-020]

## Re-run Verification Pass (loop 1 — after remediation)

Re-evaluation of the integration domain against the updated spec (FR-010 three-outcome matrix;
FR-009 lever reconciliation; FR-012 orphan cleanliness; FR-013 no-coverage fallback) and plan
(§6/§7/§8 bars). Confirms the loop-1 gaps now trace to real requirements and scans for any new
gap the edits introduced.

- [x] CHK029 Post-edit, does FR-010 now define all three cell-ownership outcomes (plugin / installer / explicitly-absent), with explicitly-absent a decided outcome distinct from installer-covered? [Completeness, Spec §FR-010] — Confirmed.
- [x] CHK030 Post-edit, does the FR-009 lever reconciliation stay consistent with FR-011 (lever (i) → installer entry wins; lever (ii) → plugin entry) and with FR-010 (installer-owned MCP-Claude under lever (i) is EXISTING capability — `claude.ts` writes that entry today — so no false new-capability flag)? [Consistency, Spec §FR-009, §FR-011, §FR-010] — Confirmed; no new inconsistency.
- [x] CHK031 Post-edit, does FR-012 require no orphaned MCP entry/hook with each channel's uninstall removing only its own entries, grounded in plugin-scoped atomicity (FR-001) and the lever-(ii) zero-server window? [Completeness, Spec §FR-012] — Confirmed.
- [x] CHK032 Post-edit, does FR-013's no-installer-coverage fallback align with FR-010's explicitly-absent outcome (the Codex prompt-hook cell resolves to new capability or explicitly-absent, not force-assigned)? [Consistency, Spec §FR-013, §FR-010] — Confirmed; FR-013 and FR-010 agree.
- [x] CHK033 Do spec.md and plan.md agree on the new/clarified requirements (no drift between the edited FRs and plan §6/§7/§8 bars)? [Consistency, Spec §FR-009, §FR-010, §FR-012, §FR-013] — Confirmed: plan §6 (three-outcome + lever), §7 (no-orphan bar), §8 (no-coverage fallback) updated to match.

**Loop-1 verification result:** zero new unresolved-gap markers. All four loop-1 gaps closed and
traced to FR-009 / FR-010 / FR-012 / FR-013. CHK013 (FR-009 matrix-owner semantics) carries a
provisional reconciliation flagged for consensus — the spec is internally consistent regardless of
which semantics consensus ratifies.

## Notes

- Check items off as resolved: `[x]`. A bracketed Gap marker flags a requirement assessed
  missing or underspecified in the integration dimension; resolving it edits
  spec.md/plan.md and re-points the item at the added/clarified requirement.
- Traceability: ≥80% of items carry a `[Spec §…]` reference or a quality/coverage marker.
