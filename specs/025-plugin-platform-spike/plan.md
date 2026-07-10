# Implementation Plan: Plugin Platform Mechanics Spike (Claude Code + Codex)

**Branch**: `025-plugin-platform-spike` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/025-plugin-platform-spike/spec.md`

## Summary

Produce one grounded, citation-backed decision document —
`docs/design/plugin-channel-decision.md` — that resolves how CodeGraph would ship
as a first-class Claude Code and Codex plugin, so SPEC-026 can scaffold with zero
further platform research. This is a **research spike**: docs/process surface only,
**0 production LOC**, ~2 committed files (the decision doc + a roadmap status edit),
timeboxed to **2–3 days**, evidence-only (scratch plugins are built outside the repo
and never committed — only their evidence lands in the doc).

Technical approach: audit both public plugin formats, then corroborate every
load-bearing claim with a scratch plugin actually loaded in **both hosts**
(citations + hands-on evidence, per design-concept Q1). The spike validates the PRD
OQ-8 hypothesis rather than re-opening a trade study (Q2): PATH-resolved installed
binary → `npx --offline` thin-installer fallback → success-shaped setup guidance when
the binary is absent (never an `isError`, preserving the errors-teach-abandonment
doctrine). It fixes coexistence as a per-component × per-host ownership matrix
(Q3/Q6/Q7), records the degraded-Codex subset with the asymmetry documented (Q6), grounds the
artifact plan in both vendors' public skill-authoring guidance (roadmap scope bullet 2,
FR-022), and enumerates the candidate skill/agent set with per-artifact tier decisions
and A/B validation bars — drafting exactly one exemplar (the explore-flow workflow skill)
in the appendix (Q4/Q5). The "implementation blueprint" for this spike is therefore a
**validation protocol + a decision-document structure**, not code. Any timebox miss is
recorded as an explicit, attempt-first staged decision, never a silent gap (Q10 / SC-008).

## Technical Context

**Language/Version**: N/A — the deliverable is a Markdown decision document
(`docs/design/plugin-channel-decision.md`) plus a Markdown roadmap status edit. No
source language; 0 production LOC.

**Primary Dependencies**: Public vendor documentation and example repositories only
(Anthropic Claude Code plugin/skills docs + `anthropics/skills`; OpenAI Codex skills
docs + `openai/skills`; agentskills.io; the Claude Code CHANGELOG dedup entry; the
Codex issue/PR references). Hands-on validation depends on locally-available **Claude
Code** and **Codex CLI** hosts. No new runtime dependency is added to the repo.

**Storage**: N/A (no schema, no persisted data — the spike writes prose).

**Testing**: Hands-on host validation recorded as evidence blocks (pinned host
version, exact repro command, quoted manifest snippet, observed behavior) is the
primary verification method. The artifact-plan section additionally **defines** the
FR-015 A/B validation bar (a third agent-eval comparison mode — artifact-off vs
artifact-on, Sonnet floor `--model sonnet --effort high`, ≥2 runs/arm, wall-clock +
tool-call + Read/Grep, plus a control repo, plus the vendors' published skill success
criteria — trigger rate, workflow tool-call count, zero failed tool calls, with/without
comparison — recorded alongside per the roadmap's binding SPEC-025 gate); **execution**
of each artifact's bar is SPEC-026's pre-ship gate, not this spike. Repo verification floor (`npm run build`,
`npm test`) stays trivially green — the spike changes 0 code.

**Target Platform**: macOS is the hands-on primary (the dev machine). Windows
(Parallels VM per CLAUDE.md) and, where relevant, Linux (Docker per CLAUDE.md) receive
an **in-timebox validation attempt** for the launcher contract; a platform not
completed in time falls back to an explicit staged deferral **only after being
attempted and its blocker evidenced** (FR-007, SC-008).

**Project Type**: Research spike / decision document (same genre as SPEC-004's
`docs/design/web-framework-decision.md`).

**Performance Goals**: N/A. (The retrieval performance the candidate artifacts must
not regress is expressed as the FR-015 A/B bar, gated in SPEC-026, not a spike metric.)

**Constraints**: 0 production LOC; ~2 committed files; 2–3 day timebox; **public
citations only** in committed text (no private/vault paths); scratch plugins and
fixtures never committed (evidence-only); the launcher contract MUST preserve
errors-teach-abandonment (absent binary → success-shaped guidance, never a hard
error); `npx` fallback MUST use `--offline` (zero network requests; cache-miss fails
catchably → guidance) and SHOULD pin at least a major version; shipped artifacts MUST
reference — never restate — `server-instructions.ts` (#529).

**Scale/Scope**: One decision document with a fixed section set (platform audit ×2
hosts, launcher contract, an **8-cell** component × host ownership matrix, coexistence
+ uninstall interplay, degraded-Codex subset, skill-authoring grounding, artifact plan,
and exactly **1** drafted exemplar in the appendix); OQ-8 marked resolved in the PRD's
terms.

**Reviewability Budget**: Primary surface: docs/process. Secondary surfaces: none.
Projected reviewable LOC: 0 (prose/markdown, not production LOC). Projected production
files: 0. Projected total files: ~2 (`docs/design/plugin-channel-decision.md` created;
`docs/ai/specs/intelligence-platform-technical-roadmap.md` status edited). Budget
result: within budget (spike). Split decision: no split — a single docs/process
surface sized by a 2–3 day timebox.

**Unresolved unknowns**: none block the plan. The design-concept open questions (the
matrix cell values, Codex prompt-front-load equivalence, the exact candidate list, and
host/version pinning) are the **spike's own research outputs** — resolved by the
hands-on validation protocol during Implement, not answerable at plan time. They are
tracked in `research.md` as deferred-to-protocol-step, **not** as `[NEEDS
CLARIFICATION]` (the spec was sharpened by three consensus-backed clarify sessions;
zero clarification markers remain).

## Constitution Check

*GATE: evaluated against Constitution v1.1.0 Principles I–VII before Phase 0. Re-checked
after Phase 1 (below).*

| Principle | Result | Basis |
|---|---|---|
| I. Think Before Coding | PASS | Assumptions are stated in the spec's Assumptions block; competing interpretations were resolved through three clarify sessions; zero clarification markers remain. The one open decision the spike itself must make hands-on (Claude dedup lever (i) vs (ii), FR-011) is named, not silently picked. |
| II. Simplicity First | PASS | Minimum surface that solves the stated problem: one decision doc + one status edit. `data-model.md`, `contracts/`, and `quickstart.md` are deliberately **omitted** (justified below) rather than generated speculatively. No trade study unless the PRD hypothesis is falsified (Q2). |
| III. Surgical Changes | PASS | The spike modifies **no** upstream-owned files and adds **0** production LOC. It touches only new/owned docs (`docs/design/…` created) and one status line in the roadmap. SPEC-MOC.md is left untouched. Scratch plugins live outside the repo. |
| IV. Goal-Driven Execution | PASS | Success is defined as SC-001…SC-008 (every scope bullet decided + cited + evidenced; OQ-8 resolved; matrix fully owned; one exemplar). Every load-bearing claim carries evidence (pinned host version, repro command, observed behavior) or an explicit "could not validate" note — evidence over vibes. |
| V. Deterministic, LLM-Free Extraction | PASS (N/A) | The spike adds no extraction and no graph structure. |
| VI. Retrieval Performance Is a Regression Surface | PASS | The launcher's absent-binary path is specified as success-shaped guidance, **never `isError`** (FR-006), and tool output never tells the agent to Read. Candidate artifacts each carry an A/B bar on the Sonnet floor with a control repo and a no-regression-vs-MCP-only condition (FR-015). No retrieval-affecting code ships in this spike; the bars gate SPEC-026. |
| VII. Local-First, Private, Zero Native Dependencies | PASS | The `npx --offline` stage performs **zero** network requests (warm cache served locally; cache-miss fails catchably → guidance), exists **only** inside a user-initiated plugin-install context, and is recorded as the Principle VII reconciliation (FR-005). The document must additionally affirm plugin-channel network/telemetry **parity** — no component introduces phone-home, telemetry, or auto-install the npm channel lacks; the plugin launches the same `codegraph` binary, so its telemetry/opt-out posture is byte-identical (FR-021) — and evidence blocks must be scrubbed of the dogfood embedding endpoint/key `.envrc.local` values (FR-019). No telemetry, no schema writes, no new runtime dependency. |

**Fork & Ecosystem Constraints**: PASS. Naming Claude Code and Codex as plugin **hosts**
is integration-target documentation consistent with the existing multi-agent installer
(which already targets Claude, Cursor, Codex, opencode, Gemini, Kiro, Antigravity,
Hermes) and cites public vendor docs — not a vendor-neutrality violation
(comparisons/endorsements are what the constraint forbids). All committed citations are
public (FR-004); the private vault skill-authoring PDF is grounding-only and is **not**
cited in committed text.

**Reviewability budget gate**: PASS. 0 reviewable LOC / 0 production files / ~2 total
files / 1 primary surface — far under the warn thresholds (400 LOC, 6 production files,
15 total files, 1 surface). No split exception required.

**Dogfooding (binding)**: The spike's self-repo step is the hands-on validation
performed with **this repository** as an indexed target where relevant — launcher
stage-1 ("binary present on PATH") resolves against this repo's own `.codegraph` index,
and the explore-flow exemplar's recipe rides `codegraph_explore` against this repo's
graph (the dogfood target). SPEC-026 dogfoods the real plugin build per the protocol.

**PR review packet source**: defined below (§ PR Review Packet Source).

**Complexity Tracking**: no violations — table empty.

## Project Structure

### Documentation (this feature)

```text
specs/025-plugin-platform-spike/
├── spec.md              # Feature spec (input; sharpened by 3 clarify sessions)
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output — public citation inventory + OQ-8 prior art
├── checklists/          # Pre-existing checklist artifacts (untouched here)
├── data-model.md        # N/A — omitted (see rationale)
├── contracts/           # N/A — omitted (see rationale)
├── quickstart.md        # N/A — omitted (see rationale)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

**Omitted Phase-1 artifacts (justified — Principle II):**

- **`data-model.md` — N/A.** The spec's "Key Entities" are documentary sections of the
  decision doc (Platform Audit, Launcher Contract, Ownership Matrix, Candidate Artifact
  Entry, Exemplar Skill, Validation Evidence Block), not persisted data with
  fields/relationships. The one genuinely reusable structure — the **Validation
  Evidence Block schema** — is captured inline in the decision-doc outline below
  (mirroring how SPEC-004 embedded its evidence schema in the decision doc, not a
  separate model file).
- **`contracts/` — N/A.** The two load-bearing "contracts" (the MCP launcher
  resolution contract and the component × host ownership matrix) are **prose
  deliverables of the decision document**, consumed by SPEC-026 — not code interface
  contracts implemented in this 0-LOC spike. A `contracts/` directory of machine
  schemas would be speculative.
- **`quickstart.md` — N/A.** The spike's runnable validation scenarios ARE the
  Validation Protocol below (the spike's core blueprint). A separate quickstart would
  duplicate it, and the scratch-plugin commands gather evidence recorded in the
  decision doc rather than serving as an end-user quickstart.

### Deliverable surface (repository root)

```text
docs/design/plugin-channel-decision.md          # CREATED — the sole deliverable
docs/ai/specs/intelligence-platform-technical-roadmap.md   # EDITED — SPEC-025 status only

# NEVER COMMITTED (evidence-only, FR-019) — built outside the repo tree:
/tmp/spec-025-plugin-research/claude-scratch-plugin/     # .claude-plugin/plugin.json, mcpServers, hooks/, skills/, agents/
/tmp/spec-025-plugin-research/codex-scratch-plugin/      # .codex-plugin/plugin.json, hooks/, skill mirror, .codex/agents/*.toml
```

**Structure Decision**: Single docs/process surface. The decision document is created
under `docs/design/` (roadmap Key Files path, same genre as
`docs/design/web-framework-decision.md`); the exemplar skill lives **inside that
document's appendix** so the spike stays docs-only and SPEC-026 lifts it into the real
plugin tree. Scratch plugins stay under a scratch path outside durable source.

## Decision Document Structure (the blueprint)

`docs/design/plugin-channel-decision.md` is organized into the sections below. Each
section names the user story / FRs it closes, and the validation bar that makes it
"done." (Section order is the intended review order.)

1. **Executive decision + scope/non-goals** — the headline decisions (validate PRD
   OQ-8 hypothesis; plugin-wins-config / npm-keeps-binary; degraded-Codex if needed;
   skills-first artifact set). Closes: framing for SC-001. *Bar:* every roadmap SPEC-025
   scope bullet appears with an explicit decision.
2. **Validation Evidence Block schema** — the reusable evidence structure every
   hands-on claim uses: `{ id, subject, host+pinned version, exact repro command,
   quoted manifest snippet, observed behavior, supported claim, or explicit "could not
   validate" note }`. Launcher-chain evidence = one block **per stage per host**, each
   pinning the condition-forcing step (binary present / absent+warm cache /
   absent+offline) and recording PATH scoping (login-shell vs GUI-inherited). Every block
   is **secret-scrubbed** before it lands — no `.envrc.local` embedding endpoint/key value
   the dogfood launcher injects (FR-019). Closes: US1 Independent Test, SC-002. *Bar:* schema
   fields fixed before any evidence is recorded; no credential/endpoint value in committed text.
3. **Claude Code platform audit** (US1 / FR-001, FR-003) — manifest + component
   pointers, plugin-scoped `mcpServers`/`hooks`/`skills`/`agents`/`commands`,
   `${CLAUDE_PLUGIN_ROOT}` resolution, marketplace + trust model, plugin-agent tool
   inheritance + `disallowedTools`. *Bar:* every load-bearing claim → public citation +
   ≥1 hands-on evidence block.
4. **Codex platform audit** (US1 / FR-002, FR-003) — enumerated capability-first:
   `.codex-plugin/plugin.json` manifest + component pointers, bundled skills, the hook
   surface (plugin `hooks/hooks.json`; standalone `.codex/hooks.json` / inline
   `config.toml` `[hooks]`), MCP registration, subagent support (plugin-bundled vs
   standalone `.codex/agents/*.toml` vs plugin-root `agents/` branding metadata), and
   project- + hook-hash trust gating. Exact artifact filenames are audit outputs,
   corrected to the hands-on evidence where docs diverge. *Bar:* every load-bearing
   claim → public citation + hands-on evidence, or an explicit "could not validate" note.
5. **MCP launcher contract — OQ-8** (US2 / FR-005, FR-006, FR-007, FR-008, FR-021) — the ordered
   fallback (PATH-resolved binary → `npx --offline` thin-installer → success-shaped
   guidance), the stub-launcher delivery mechanism (always starts an MCP-speaking
   process; serves a stub MCP server returning success-shaped guidance when the binary
   is unresolved — never a failed-to-spawn surface), the runtime-self-sufficiency
   condition, the `--offline`/major-pin/~50MB disclosure, the plugin-channel
   network/telemetry **parity** affirmation (no phone-home/auto-install the npm channel
   lacks; same telemetry opt-outs and Principle VII rule; the `npx --offline` stage reuses
   the npm channel's own thin-installer, not a new vector — FR-021), and the
   three-stage-per-host evidence. *Bar:* ordered fallback fully specified; absent-binary
   path success-shaped (never `isError`); ANY npx-stage failure (not only the offline
   cache-miss — corrupt/partial cache, npx/runtime unavailable, or a spawned-but-nonfunctional
   package) falls through to the stub guidance; the guidance's install command framed as a
   USER action (never an agent auto-install, FR-021); network/telemetry parity affirmed; OQ-8
   marked resolved in PRD terms (SC-003) with recorded evidence.
6. **Component × host ownership matrix** (US3/US4 / FR-009, FR-010, FR-013) — the 8-cell
   table: component (MCP server, prompt front-load hook, skills, agents) × host (Claude
   Code, Codex); each cell states can-carry? + one of three decided owners (plugin /
   installer / explicitly-absent), the MCP-Claude owner reconciled with the FR-011 lever;
   installer-gap cells flagged as new SPEC-026 capability. *Bar:* every cell carries one of
   the three decided outcomes, none blank/undecided (SC-004).
7. **Coexistence + uninstall interplay** (US3 / FR-011, FR-012) — detection/dedupe in
   both directions (plugin-detects-installer, installer-detects-plugin), the
   host-arbitrated Claude dedup lever decision (i vs ii), the Codex levers, the
   non-viability of plugin-side self-suppression (JSON-RPC -32000) with the empty
   `tools/list` fallback, and invocation-driven uninstall restore with no orphaned entries
   (each channel's uninstall removes only its own; plugin-scoped removal is atomic; the
   lever-(ii) zero-server window is stated); and the diagnostic ownership for a both-present
   state that EVADES dedup (near-duplicate Claude entries the host does not collapse; Codex
   with no native cross-channel dedup) — who detects/reports it and the residual-window
   observable. *Bar:* both directions stated; surviving channel stays functional; no duplicate
   registration / no double hook injection / no orphaned MCP entry or hook; and for the
   evades-dedup both-present case, who-reports-what and the user/agent observable are specified
   (provisional, flagged for consensus).
8. **Degraded-Codex subset** (US4 / FR-013) — the matrix cells the Codex plugin format
   cannot carry, each reassigned to the npm installer (a degraded cell with no installer
   coverage today — e.g. the Codex prompt hook — resolves to new SPEC-026 capability or
   explicitly-absent, not force-assigned), asymmetry vs Claude Code documented; gated on
   hands-on confirmation with the pinned `multi_agent_v1`/`v2` runtime + model pairing; and
   each degraded/absent cell's runtime USER-OBSERVABLE specified (installer-covered =
   functionally equivalent; explicitly-absent = a decided silent-by-design or surfaced-note
   observable). *Bar:* subset named; each unsupported cell assigned to the installer per the
   matrix; each degraded/absent cell observable-complete, not merely ownership-complete.
9. **Skill-authoring grounding + shipped-artifact plan** (US5 / FR-014, FR-015, FR-016,
   FR-022) — **opens with the skill-authoring grounding** (roadmap SPEC-025 scope bullet 2,
   FR-022): a dedicated, citation-backed block grounding the plan + exemplar in both
   vendors' PUBLIC guidance — the shared agent-skills open standard (`SKILL.md` + optional
   `scripts/`/`references/`/`assets/`; the per-host divergences the US1 audit enumerates),
   Anthropic's progressive disclosure / MCP-enhancement "recipes over the kitchen" category
   / what-when trigger discipline / kebab-case + exact-`SKILL.md` structural rules / no-XML
   + reserved-name security restrictions / optional `allowed-tools` field (pre-approval,
   not restriction) / the skill-to-MCP dependency mechanism as an audit output (qualified
   `ServerName:tool_name` body references per Anthropic best-practices — correcting the
   roadmap's `metadata.mcp-server` to the evidence, per FR-002), OpenAI's `.agents/skills`
   scan order / explicit `$skill-name` vs implicit
   invocation / `agents/openai.yaml` sidecar / authoring best practices, and the vendors'
   published skill success criteria — **then** the candidate skill/agent enumeration with
   the three-leg inclusion criterion, per-artifact tier decisions, trigger surfaces, the
   FR-015 A/B bar definition (recording the published success criteria — trigger rate,
   workflow tool-call count, zero failed tool calls, with/without comparison — **alongside**
   wall-clock + tool-call + Read/Grep + control repo, per the roadmap's binding gate), and
   the reference-not-restate (#529) line item per candidate; the agent class evaluated
   separately (retrieval-guardian excluded). *Bar:* the skill-authoring grounding closes
   roadmap scope bullet 2 with public citations and all named elements present (SC-001);
   each candidate has a tier + a validation bar; excluded workflows recorded with reasons.
10. **Appendix: explore-flow exemplar skill** (US5 / FR-017) — exactly one fully-drafted
    artifact body; no other candidate body drafted. *Bar:* exactly one exemplar (SC-005).
11. **Staged decisions + close-out** (FR-020 / SC-008) — any timebox miss recorded as an
    explicit, attempt-first staged decision naming what was attempted and the evidenced
    blocker; the done-bar checklist (SC-001…SC-008); the roadmap status edit. *Bar:* zero
    silent gaps.
12. **Traceability + PR review packet** — requirement/SC → section → evidence map, and
    the PR packet fields.

## Validation Protocol (19 steps)

The hands-on protocol that produces the evidence. Scratch plugins are authored **outside
the repo** (FR-019). Steps are grouped into phases; the timebox mapping follows.

**Phase A — Documentation audit + citation inventory**
- **V1** Enumerate and fetch the public source set; build the `research.md` citation
  inventory (grounds FR-001/002/004, SC-002).

**Phase B — Scratch-plugin authoring (outside repo)**
- **V2** Author the scratch **Claude Code** plugin (`.claude-plugin/plugin.json`,
  plugin-scoped `mcpServers` launcher, `hooks/hooks.json` `UserPromptSubmit`, a
  `skills/` body, an `agents/` stub).
- **V3** Author the scratch **Codex** plugin (`.codex-plugin/plugin.json`, bundled
  skill, hook surface, MCP registration, standalone `.codex/agents/*.toml`).

**Phase C — Claude Code hands-on (macOS)**
- **V4** Claude platform-audit evidence (FR-001/003): manifest + component pointers,
  `${CLAUDE_PLUGIN_ROOT}`, plugin-scoped `mcpServers`/`hooks`/`skills`/`agents`,
  marketplace + trust, plugin-agent tool inheritance + `disallowedTools`.
- **V5** Claude launcher three-stage (FR-005/006/007): (1) binary present on PATH → tools
  appear, record GUI-launched PATH scoping (login-shell vs app-inherited); (2) binary
  absent + warm npm cache → `npx --offline` cache-first, server still comes up; (3) binary
  absent + offline/uncached → stub launcher returns success-shaped guidance, never
  `isError`/failed-spawn. Includes the **stub-launcher runtime check** (FR-006): record
  what runtime Claude actually provides the subprocess (do not silently assume `node`).
- **V6** Claude **host-dedup lever observation** (FR-011): reproduce the CHANGELOG
  "Plugin-provided MCP server deduplication" — plugin-declared server duplicating a
  manually-configured (installer) entry is suppressed, manual wins, suppression shown in
  `/plugin`; **decide and record lever (i)** installer keeps its entry + host dedup
  suppresses the plugin copy **vs (ii)** installer defers so only the plugin copy remains
  (the plugin winning by default is NOT assumed without this observation).

**Phase D — Codex hands-on (macOS)**
- **V7** Codex platform-audit evidence (FR-002/003): manifest + component pointers,
  bundled skills, hook surface, MCP registration, subagent support distinction, trust
  gating; correct exact artifact filenames to the evidence.
- **V8** Codex **`UserPromptSubmit` hook test with pinned CLI version** (FR-010): author a
  `hooks/hooks.json` `UserPromptSubmit` hook emitting
  `hookSpecificOutput.additionalContext`, install the plugin, complete the `/hooks` trust
  review, submit a prompt, confirm the injected context reaches the model. **Pin and
  record the installed Codex CLI version/build**; only a build passing this records the
  cell plugin-owned — a pre-fix/flag-gated-off build (issue #16430 window) records the
  "absent on Codex" outcome instead.
- **V9** Codex launcher three-stage (FR-007): the same three stages as V5, on Codex.
- **V10** Codex **subagent runtime-path pinning** (FR-013): confirm installer-written
  `.codex/agents/*.toml` load in a tool-backed session; **pin the multi-agent runtime
  path (`multi_agent_v1` vs `multi_agent_v2`) and the model combination**. Named-agent
  invocation is reported to fail on `multi_agent_v2` (#15250, #20077) while working on
  `multi_agent_v1` for some models — a single load is insufficient unless it is on the
  runtime/model pairing CodeGraph actually ships against.

**Phase E — Cross-platform launcher attempts (in-timebox, attempt-first)**
- **V11** **Windows (Parallels VM)** launcher attempt (FR-007, edge case): attempt the
  three-stage-per-host sequence on **both** hosts, specifically probing (a) whether the
  host spawns the shipped Windows entry point (npm `.cmd` shim / `install.ps1`'s
  `codegraph.cmd`) without the CVE-2024-27980-class `.cmd` spawn refusal (CHANGELOG #289
  — i.e. whether the host uses `shell:true` / resolves the shim), and (b) whether
  bare-name PATH resolution succeeds for a GUI-launched host (Antigravity darwin
  precedent). **Staged-deferral only after an attempt hits an evidenced blocker** (SC-008).
- **V12** **Linux (Docker)** launcher attempt where relevant (FR-007): attempt the
  launcher sequence. **Staged-deferral only after an attempt hits an evidenced blocker.**

**Phase F — Synthesis into the decision document**
- **V13** Fill the **8-cell** component × host ownership matrix; flag installer-gap cells
  as new SPEC-026 capability; apply per-component precedence Q3/Q6/Q7 (FR-009/010/013,
  SC-004).
- **V14** Write coexistence + uninstall interplay both directions, incorporating the V6
  Claude dedup-lever decision and the Codex levers; record the plugin-side
  self-suppression non-viability + empty-`tools/list` fallback; invocation-driven restore
  (FR-011/012). Grounds the evades-dedup diagnostic-ownership prose in the **4-step
  near-duplicate evasion scenario** (install both channels with textually-different
  launcher commands resolving to the same binary → both healthy → two distinct namespaced
  tool sets on Claude / both live on Codex → nothing fires) recorded by tasks.md T018 before
  the installer's next-invocation detection is credited as the reporter (FR-011).
- **V15** Record the degraded-Codex subset from V7/V8/V10 evidence; reassign unsupported
  cells to the installer; document the asymmetry (FR-013, US4).
- **V16** Write the **skill-authoring grounding** block (FR-022, roadmap scope bullet 2) —
  ground the plan + exemplar in both vendors' public guidance with public citations
  (shared agent-skills standard + per-host divergences; Anthropic progressive disclosure /
  MCP-enhancement / trigger discipline / structural + security rules / `allowed-tools` +
  the MCP-dependency mechanism as an audit output (correcting the roadmap's
  `metadata.mcp-server` to the evidence); OpenAI `.agents/skills` scan order / explicit-vs-implicit
  invocation / `agents/openai.yaml` sidecar / authoring best practices; the published skill
  success criteria); then enumerate the candidate artifacts; apply the three-leg inclusion
  criterion; tier each (default FULLY OPEN for workflow/authoring skills; built-in-only
  `disallowed-tools` denylists for read-only/review artifacts; never deny/re-expose the
  codegraph MCP tools; `context: fork` where a restriction must hold beyond the turn);
  evaluate the agent class separately (retrieval-guardian excluded); define the FR-015
  A/B bar (recording the published success criteria — trigger rate, workflow tool-call
  count, zero failed tool calls, with/without — alongside the agent-eval metrics) and the
  FR-016 reference-not-restate line item per candidate (FR-014/015/016/022).
- **V17** Draft the **one** explore-flow exemplar skill in the appendix; draft no other
  candidate body (FR-017, SC-005).
- **V18** Mark **OQ-8 resolved in the PRD's terms** if V5/V9 (± V11/V12) confirm the
  hypothesis; only if falsified, produce a full equal-weight launcher trade study
  (FR-008, SC-003).
- **V19** Close-out: verify every scope bullet closed with decision + citation + evidence
  or an explicit attempt-first staged deferral; run the SC-001…SC-008 done-bar; make the
  roadmap SPEC-025 status edit (the ~2nd committed file) (FR-018/019/020, SC-001/006/007/008).

## Timebox Plan (2–3 days) & staged-decision conditions

| Day | Steps | Focus |
|---|---|---|
| **Day 1** | V1 → V6 | Docs audit + citation inventory; author both scratch plugins; full Claude Code hands-on (audit, launcher three-stage, dedup-lever observation). |
| **Day 2** | V7 → V12 | Full Codex hands-on (audit, pinned-version hook test, launcher three-stage, subagent v1/v2 pinning); then the Windows (Parallels) and, where relevant, Linux (Docker) launcher **attempts** — the risk-heavy day. |
| **Day 3** | V13 → V19 | Synthesis: ownership matrix, coexistence + uninstall, degraded-Codex subset, artifact plan, the one exemplar draft, OQ-8 resolution marker, done-bar + roadmap status edit. |

**Non-deferrable core (must land in-timebox — deferring these leaves SPEC-026 the
research debt the spike exists to prevent):** the macOS launcher three-stage on both
hosts (V5, V9), the Claude dedup-lever decision (V6), the Codex pinned-version hook test
(V8), the 8-cell matrix (V13), coexistence both directions (V14), the artifact plan
(V16), and the one exemplar (V17).

**Conditioned, attempt-first staged decisions (per FR-007 / SC-008 — a deferral is valid
only after an attempt hits an evidenced blocker, naming what was attempted and the
specific blocker; never decided in advance, never a silent gap):**

- **V11 (Windows)** and **V12 (Linux)** are the first to become explicit staged
  deferrals for SPEC-026's pre-ship gate if the timebox closes mid-attempt — each
  recording the evidenced blocker (e.g. `.cmd` spawn refusal, bare-name PATH failure on a
  GUI-launched host, or VM/Docker unavailability).
- **V10 (Codex subagent v1/v2 pairing)** becomes a staged deferral if the exact
  runtime/model pairing CodeGraph ships against cannot be exercised in time — recording
  what was attempted, for SPEC-026 to confirm.
- **V8 outcome** is a *decision, not a deferral*: a shipped Codex build in the pre-fix or
  flag-gated-off window records the "absent on Codex" cell outcome directly (staged
  deferral only if the build's hook state cannot be determined within the timebox).

## PR Review Packet Source

- **What changed**: added `docs/design/plugin-channel-decision.md` (platform audit ×2,
  launcher contract/OQ-8, ownership matrix, coexistence, degraded-Codex subset, artifact
  plan, exemplar appendix); edited SPEC-025 status in the roadmap. No code.
- **Why**: unblock SPEC-026 with a grounded, citation-backed contract so it scaffolds
  with zero further platform research.
- **Non-goals**: shipping any plugin; modifying the npm installer or
  `server-instructions.ts`; committing scratch plugins/fixtures; a full launcher trade
  study (unless the hypothesis is falsified).
- **Review order**: the decision-doc section order (1 → 12) above.
- **Scope budget**: 0 reviewable LOC / 0 production files / ~2 total files / 1 surface —
  within the spike budget.
- **Traceability**: the decision doc's Traceability section maps each FR/SC → section →
  evidence block.
- **Verification evidence**: per-stage hands-on evidence blocks (pinned host versions,
  repro commands, observed behavior); `npm run build` + `npm test` green (0-code change);
  SC-001…SC-008 done-bar.
- **Known gaps**: any attempt-first staged deferral (Windows/Linux launcher legs, or the
  Codex subagent pairing) named with its evidenced blocker and assigned to SPEC-026's
  pre-ship gate.
- **Rollback / feature-flag notes**: none required — 0 production behavior; reverting the
  two files removes the change.

## Complexity Tracking

No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Post-Design Constitution Re-Check

Re-evaluated after the decision-doc structure and validation protocol were designed:
**still PASS on all of I–VII.** The design adds no code, no dependency, no schema, and no
retrieval-affecting surface; it omits `data-model.md`/`contracts/`/`quickstart.md`
(Simplicity); it preserves errors-teach-abandonment in the launcher contract (VI) and the
local-first `npx --offline` reconciliation (VII); and it keeps every committed citation
public (Fork & Ecosystem). No Complexity Tracking row required.
