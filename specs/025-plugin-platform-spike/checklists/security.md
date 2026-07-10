# Security Requirements Quality Checklist: Plugin Platform Mechanics Spike (SPEC-025)

**Purpose**: Validate the security-requirement quality of the SPEC-025 spec/plan before
SPEC-026 builds against the decision document. These are "unit tests for the requirements"
in the security domain — they test whether the security requirements are complete, clear,
consistent, measurable, and cover the plugin-channel threat surface — NOT whether any code
works.
**Created**: 2026-07-09
**Feature**: [spec.md](../spec.md)

**Focus areas** (from the security domain prompt):
1. Trust model coverage — Claude marketplace/plugin trust prompts + Codex project- and
   hook-hash trust gating, each with citation + validation evidence.
2. npx-fallback supply-chain exposure weighed under constitution Principle VII (local-first).
3. Plugin-agent tool surface — tool inheritance + built-in-only `disallowedTools` tiering
   (operator-owned tool-surface doctrine).
4. Special attention — whether any requirement lets the plugin channel introduce phone-home
   or auto-install behavior the npm channel does not already have.

**Depth**: formal pre-SPEC-026 security gate. **Audience**: SPEC-026 implementer + PR reviewer.

## Trust Model Coverage

- [ ] CHK001 Are requirements defined for the Claude Code marketplace + plugin trust model as a load-bearing, citation-backed platform-audit claim? [Completeness, Spec §FR-001]
- [ ] CHK002 Are requirements defined for Codex project-trust and hook-hash trust gating as a load-bearing, citation-backed platform-audit claim? [Completeness, Spec §FR-002]
- [ ] CHK003 Does the spec require each trust mechanism (Claude trust prompt, Codex project/hook-hash gating) to carry BOTH a public citation AND a hands-on validation evidence block — or an explicit "could not validate" note? [Traceability, Spec §FR-002, §FR-003]
- [ ] CHK004 Is the `/hooks` trust review specified as the prerequisite that gates plugin hook execution before injected context can reach the model? [Clarity, Spec §FR-010]
- [ ] CHK005 Does the spec require the decision document to state the security posture the trust grant confers (what a trusted plugin's hooks/MCP subprocess may do), not merely the trust mechanism? [Coverage, Spec §FR-001]

## Supply-Chain & npx Fallback (Principle VII)

- [ ] CHK006 Is the npx stage required to use `--offline` (zero network requests under any condition) as the operative flag? [Completeness, Spec §FR-005]
- [ ] CHK007 Is the `--offline` vs `--prefer-offline` distinction (why `--prefer-offline` is insufficient because it still requests missing data) documented with a citation? [Clarity, Spec §FR-005]
- [ ] CHK008 Is at-least-major-version pinning of the npx package specifier required, with the supply-chain rationale (OWASP CICD-SEC-3; 2025–2026 npm latest-tag compromises) and the deliberate divergence from unpinned `npx -y` recorded? [Completeness, Spec §FR-005]
- [ ] CHK009 Is the ~50MB-per-platform-per-version cold-fetch weight required to be disclosed as a non-lightweight fallback? [Completeness, Spec §FR-005]
- [ ] CHK010 Is the npx stage's constitution Principle VII (local-first) reconciliation required to be recorded, scoped to a user-initiated plugin-install context only? [Traceability, Spec §FR-005]
- [ ] CHK011 Is a cache-miss required to fail with a catchable error that falls through to success-shaped guidance, rather than silently contacting the registry? [Consistency, Spec §FR-005, §FR-006]
- [ ] CHK012 Is the `--offline` zero-network property required to be validated hands-on (the binary-absent + offline/uncached launcher stage), not merely asserted from documentation? [Measurability, Spec §FR-007]

## Phone-Home / Network & Telemetry Parity

- [x] CHK013 Does any requirement affirm that NO plugin component (MCP stub launcher, prompt front-load hook, bundled skills, bundled agents) introduces phone-home / network egress / auto-install behavior beyond what the existing npm channel already has? [Completeness, Spec §FR-021] → Resolved: added FR-021 (plugin-channel network parity — same `codegraph` binary, byte-identical telemetry/network posture; `npx --offline` reuses the npm thin-installer, sole install path).
- [x] CHK014 Is the plugin channel required to preserve the Principle VII telemetry posture (same opt-out controls `CODEGRAPH_TELEMETRY=0`/`DO_NOT_TRACK=1`; no network calls except user-configured embedding/LLM endpoints and locally-spawned language servers)? [Consistency, Spec §FR-021] → Resolved: FR-021 records the binary's telemetry/network posture as byte-identical across channels, governed by the same opt-outs, per Principle VII.
- [ ] CHK015 Is auto-install behavior required to be bounded to the single `npx --offline` stage that reuses the npm channel's own thin-installer, with any deviation discovered in validation recorded as an explicit SPEC-026 finding rather than a silent divergence? [Consistency, Spec §FR-005]

## Plugin-Agent Tool Surface (operator-owned doctrine)

- [ ] CHK016 Is plugin-agent tool inheritance required to be audited (what a plugin-bundled agent inherits when it declares no restriction) as a load-bearing, citation-backed claim? [Completeness, Spec §FR-001]
- [ ] CHK017 Is the restriction required to be expressed as a `disallowed-tools` denylist rather than `allowed-tools` alone (given `allowed-tools` is pre-approval, not restriction, and Codex ignores it in SKILL.md)? [Clarity, Spec §FR-014]
- [ ] CHK018 Are tool-surface constraints required to target BUILT-IN tools only and to never deny or re-expose the codegraph MCP tools? [Consistency, Spec §FR-014]
- [ ] CHK019 Is the codegraph MCP tool surface required to remain operator-controlled server-side (`CODEGRAPH_MCP_TOOLS` / `DEFAULT_MCP_TOOLS`), not plugin-artifact-controlled? [Consistency, Spec §FR-014]
- [ ] CHK020 Is the default tier (FULLY OPEN for workflow/authoring skills; built-in-only denials only for read-only/review artifacts) explicitly specified, with durable enforcement via `context: fork` where a constraint must hold beyond the current turn? [Completeness, Spec §FR-014]

## Evidence & Secret Hygiene

- [ ] CHK021 Are all committed citations required to reference only public sources, with no private or vault paths in committed text? [Completeness, Spec §FR-004]
- [ ] CHK022 Are scratch plugins and validation fixtures required to never be committed (evidence-only)? [Completeness, Spec §FR-019]
- [x] CHK023 Are validation evidence blocks (exact repro command + observed-behavior transcript) and the committed decision document required to be scrubbed of secrets/credentials — the private embedding-endpoint URL and `CODEGRAPH_EMBEDDING_API_KEY` that the dogfood "binary present" launcher stage surfaces — per Principle VII / the Dogfooding never-log-or-echo rule? [Completeness, Spec §FR-019] → Resolved: extended FR-019 to require every evidence block's repro command + observed-behavior transcript be secret-scrubbed (no `.envrc.local` endpoint/key), naming the `scripts/mcp-dogfood.mjs` env-injection path as the exposure point.

## Coexistence & Launcher Safety

- [ ] CHK024 Are detection/dedupe requirements defined in BOTH directions so no duplicate MCP registration and no double hook injection occur? [Consistency, Spec §FR-011]
- [ ] CHK025 Is the non-viability of plugin-side self-suppression (an exit-before-handshake attempt surfacing as JSON-RPC -32000) recorded, with the empty-`tools/list` fallback named? [Coverage, Spec §FR-011]
- [ ] CHK026 Is the absent-binary path required to return success-shaped setup guidance and never an `isError`/failed-spawn surface (errors-teach-abandonment)? [Consistency, Spec §FR-006]
- [ ] CHK027 Is the Windows `.cmd`-shim spawn risk (CVE-2024-27980 class, CHANGELOG #289) required to be probed rather than assumed inherited from the installer's PATH spawn? [Edge Case, Spec §FR-007]
- [ ] CHK028 Are shipped artifacts required to reference — never restate — `server-instructions.ts` (#529), so agent-facing guidance stays single-sourced? [Consistency, Spec §FR-016]

## Scenario, Edge & Staged-Decision Coverage

- [ ] CHK029 Is any timebox miss required to be recorded as an explicit, attempt-first staged decision (naming what was attempted and the evidenced blocker), never a silent gap? [Coverage, Spec §FR-020, §SC-008]
- [ ] CHK030 Is the hands-on-contradicts-published-docs case required to follow the observed evidence and flag the doc as stale for SPEC-026? [Edge Case, Spec Edge Cases]
- [ ] CHK031 Is the Codex hook-execution cell required to pin and record the installed Codex CLI build (pre-fix / flag-gated window → "absent on Codex" outcome)? [Measurability, Spec §FR-010]
- [ ] CHK032 Is Codex subagent loading required to pin the `multi_agent_v1` vs `multi_agent_v2` runtime path and model pairing before a cell is recorded plugin-supported? [Measurability, Spec §FR-013]

## Re-run Verification Pass (loop 1 — after remediation)

Re-evaluation of the security domain against the updated spec (FR-021 added; FR-019 extended).
Confirms the loop-1 gaps now trace to real requirements and scans for any new gap the edits introduced.

- [x] CHK033 Post-edit, does a requirement now affirm plugin-channel phone-home/network/auto-install parity with the npm channel across all components? [Completeness, Spec §FR-021] — Confirmed: FR-021 present, covers launcher/hook/skills/agents.
- [x] CHK034 Post-edit, is the telemetry posture (same opt-out controls; Principle VII network rule) now required to be preserved for the plugin channel? [Consistency, Spec §FR-021] — Confirmed.
- [x] CHK035 Post-edit, is evidence-block secret/credential scrubbing (no `.envrc.local` endpoint/key) now required? [Completeness, Spec §FR-019] — Confirmed; plan §2 evidence schema and §5 launcher bar updated to match.
- [x] CHK036 Does FR-021 remain consistent with the consensus-settled FR-005 (npx `--offline` as the bounded, sole install vector), introducing no conflict? [Consistency, Spec §FR-005, §FR-021] — Confirmed: FR-021 references FR-005 as the sole install path and reuses the npm thin-installer, not a new vector.
- [x] CHK037 Do spec.md and plan.md agree on the new requirements (no drift between the added FRs and the plan's Constitution Check VII row / decision-doc structure)? [Consistency, Spec §FR-019, §FR-021] — Confirmed: plan VII row + §2 + §5 reference FR-019/FR-021.
- [x] CHK038 Are the prompt-hook `additionalContext` injection and stub-launcher process spawn already gated by the trust model (no new un-gated execution vector introduced)? [Coverage, Spec §FR-001, §FR-002, §FR-010] — Confirmed: plugin execution is trust-gated (Claude trust model; Codex project-/hook-hash gating + `/hooks` review); no new gap.

**Loop-1 verification result:** zero new unresolved-gap markers. All loop-1 gaps closed and traced to FR-019 / FR-021.

## Notes

- Check items off as resolved: `[x]`. A bracketed Gap marker flags a requirement assessed missing or underspecified in the security dimension; resolving it edits spec.md/plan.md and re-points the item at the added requirement.
- Traceability: ≥80% of items carry a `[Spec §…]` reference or a quality/coverage marker.
