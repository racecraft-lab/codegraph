# SpecKit Workflow: SPEC-025 — Plugin Platform Mechanics Spike (Claude Code + Codex)

**Template Version**: 1.0.0
**Created**: 2026-07-09
**Purpose**: Prepare and execute SPEC-025 through the SpecKit workflow so CodeGraph has a grounded, citation-backed decision document (`docs/design/plugin-channel-decision.md`) on packaging CodeGraph as first-class Claude Code and Codex plugins — MCP server, prompt front-load hook, skills, and agents — validated hands-on in both hosts, before any shipped behavior changes. Research spike: docs/process surface only, 0 production LOC, timeboxed 2–3 days.

---

## Design Concept

This workflow file was enriched from a Grill Me interview run during
`/speckit-pro:speckit-scaffold-spec SPEC-025`. The full Q&A log, Goals, Non-goals, and
Open Questions live at:

```text
docs/ai/specs/.process/SPEC-025-design-concept.md
```

Re-read it before each phase. The design concept is the source of truth for scoping
decisions captured during setup. The load-bearing decisions (by Q-number):

- **Q1** — grounding is **citations + hands-on validation**: audit the official
  Anthropic and OpenAI plugin/skills docs AND load a scratch plugin in both hosts
  to empirically confirm manifest fields, `${CLAUDE_PLUGIN_ROOT}` resolution, hook
  registration, and trust gating (constitution Principle IV: evidence over vibes).
- **Q2** — OQ-8 launcher contract: **validate the PRD hypothesis** (PATH-resolved
  installed binary → npx thin-installer fallback → success-shaped setup guidance
  when absent). The equal-weight trade study re-opens ONLY if validation falsifies
  the hypothesis.
- **Q3** — coexistence precedence: **plugin wins the config-writing role; npm keeps
  the binary-distribution role.** Installer detects the plugin and skips/offers-to-
  remove its own MCP + hook entries; the plugin launcher resolves the npm-installed
  binary per OQ-8. One owner per concern.
- **Q4** — artifact-plan depth: enumerate candidates + tier decisions + validation
  bars, **plus one fully-drafted exemplar** (maintainer deviation from the
  enumerate-only recommendation). Exemplar lives in the decision doc's appendix;
  SPEC-026 lifts it into the real plugin tree.
- **Q5** — the exemplar is the **explore-flow workflow skill** (MCP-enhancement
  category: teaches the codegraph_explore-first retrieval workflow; A/B validation
  bar already defined in CLAUDE.md).
- **Q6** — Codex fallback posture: **Codex via degraded plugin** (maintainer
  deviation from staged-decision recommendation) — ship whatever subset the Codex
  plugin format supports and document the asymmetry.
- **Q7** — gap coverage: **npm installer covers the gaps** per-component per host;
  the decision doc ships a component × host ownership matrix.
- **Q8** — timebox: **2–3 days** (docs audit ½–1d; two-host scratch-plugin
  validation 1d; decision doc + exemplar ½–1d).
- **Q9** — repo hygiene: **evidence-only, no fixtures committed.** The decision doc
  quotes manifest snippets, host versions, observed behavior, and exact repro
  commands; scratch plugins never land in the repo.
- **Q10** — done bar: **every scope bullet decided, cited, validated**; OQ-8
  resolved in the PRD's terms; SPEC-026 can scaffold with zero further research;
  timebox misses become explicitly-recorded staged decisions, never silent gaps.
- **Citation policy** (standing maintainer direction): committed text cites public
  sources only — Anthropic skills docs / best-practices / engineering blog /
  `anthropics/skills`; OpenAI `developers.openai.com/codex/skills` / `openai/skills`
  / agentskills.io. Never the private vault PDF path.

> **Note:** Grill Me is human-in-the-loop only. It is not part of the autopilot
> loop. Once this workflow begins, clarifications happen via `/speckit-clarify`
> and the consensus protocol.

---

## Workflow Overview

| Phase | Command | Status | Notes |
|-------|---------|--------|-------|
| Specify | `/speckit-specify` | ✅ Complete | 5 US / 20 FR / 14 AC / 8 SC; 0 markers; G1 PASS (runner + grep). spec.md + checklists/requirements.md; feature.json created |
| Clarify | `/speckit-clarify` | ✅ Complete | 3 sessions, 15 questions, 10 consensus items (17 analyst runs, 10 syntheses); 2 security gates maintainer-approved; 1 parent edit reversed by consensus (Windows posture); G2 PASS (0 markers) |
| Plan | `/speckit-plan` | ✅ Complete | plan.md (408 lines: 12-section doc blueprint + 19-step validation protocol V1–V19, Phases A–F, 3-day timebox map) + research.md (C1–C9 citation inventory). G3 PASS after 1 auto-fix (meta-reference literal reworded). estimate-reviewable-loc: `not_estimated` (0 declared production files — correct for 0-LOC spike; advisory, continue). data-model/contracts/quickstart deliberately omitted (rationale in plan §Project Structure). CLAUDE.md SPECKIT block updated (in-flight status) |
| Checklist | `/speckit-checklist` | ⏳ Pending | security, integration, error-handling |
| Tasks | `/speckit-tasks` | ⏳ Pending | |
| Analyze | `/speckit-analyze` | ⏳ Pending | |
| Implement | `/speckit-implement` | ⏳ Pending | Implement = run validation + write the decision doc |

**Status Legend:** ⏳ Pending | 🔄 In Progress | ✅ Complete | ⚠️ Blocked

### Phase Gates (SpecKit Best Practice)

Each phase requires **human review and approval** before proceeding:

| Gate | Checkpoint | Approval Criteria |
|------|------------|-------------------|
| G1 | After Specify | All user stories clear, no `[NEEDS CLARIFICATION]` markers remain |
| G2 | After Clarify | Ambiguities resolved, decisions documented |
| G3 | After Plan | Validation protocol approved, constitution gates pass, host prerequisites identified |
| G4 | After Checklist | All `[Gap]` markers addressed |
| G5 | After Tasks | Task coverage verified, dependencies ordered |
| G6 | After Analyze | No `CRITICAL` issues, `WARNING` items reviewed |
| G7 | After Each Implementation Phase | Evidence captured, manual verification complete |

---

## Prerequisites

### Constitution Validation

**Before starting any workflow phase**, verify alignment with the project constitution (`.specify/memory/constitution.md`):

| Principle | Requirement | Verification |
|-----------|-------------|--------------|
| I. Think Before Coding | The spike IS the thinking for SPEC-026 — decisions stated with assumptions surfaced | Decision doc review at G7 |
| II. Simplicity First | Decision doc + exemplar only; no speculative plugin machinery built | Diff shows docs/design + roadmap status edits only |
| III. Surgical Changes | Zero `src/` changes; no adjacent "improvements" while auditing installer behavior | `git diff --stat` contains no `src/**` paths |
| IV. Goal-Driven Execution | Every decision carries a public citation and, where load-bearing, hands-on evidence (Q1, Q10) | Evidence blocks in `docs/design/plugin-channel-decision.md` |
| VI. Retrieval Is a Regression Surface | Exemplar skill's validation bar = agent A/B on the Sonnet floor, no regression vs MCP-only baseline (#529: reference, never restate `server-instructions.ts`) | Validation-bar section of the decision doc |
| VII. Local-First, Private | Plugin channel must not add phone-home behavior; npx fallback's network implications explicitly weighed in the launcher decision | Launcher-contract section of the decision doc |

**Constitution Check:** ✅ (docs-only spike; gates above verified at G7)

### Autopilot Pre-flight Record (Step -1/0, 2026-07-09)

| Item | Value |
|------|-------|
| check-prerequisites | all_pass: true (specify 0.11.8; project init; constitution; all speckit commands; workflow file found). Runner anchors to main checkout — branch verified directly: `025-plugin-platform-spike`, ON_FEATURE_BRANCH=true, IS_WORKTREE=true |
| PROJECT_COMMANDS | BUILD=`npm run build` · TYPECHECK=`npx tsc --noEmit` (tsc runs inside build) · UNIT_TEST=`npm test` (vitest) · LINT=N/A · INTEGRATION_TEST=N/A (vitest suite is the full suite) · package_manager=npm, stack=nodejs |
| PRESET_CONVENTIONS | speckit-pro-reviewability v1.0.0 (spec/plan top layer), codegraph-project-overrides v1.0.0 (tasks top layer: constitution test-policy exceptions), claude-ask-questions v1.0.0 |
| Settings | No `.claude/speckit-pro.local.md` — defaults: consensus-mode default, gate-failure=stop, auto-commit per extensions.yml (`auto_execute_hooks: true`, git commit hooks on all phase boundaries) |
| CONFIDENCE_GATE_MODE | `advisory` (resolved at Step 0.6b via runner `resolve-confidence-mode`, argv had no flags; not re-run at G6.5) |
| AGENT_TEAMS_AVAILABLE | false (no TeamCreate in session tool surface) — `[P]` runs use batched background subagents |
| PROJECT_IMPLEMENTATION_AGENT | none detected (`.claude/agents/` has only retrieval-guardian, a reviewer) → fallback `speckit-pro:phase-executor`; research tasks route to `speckit-pro:domain-researcher` |
| Extensions (registry) | agent-context, archive, bug, cleanup, git, retrospective, review, verify, verify-tasks installed; 18 hook events configured; no doctor/speckit-utils extension |
| MCP availability | codegraph (dogfood daemon, explore active), context7, tavily, RepoPrompt, qmd, claude-in-chrome — research + docs coverage available |
| Reviewability (setup mode) | PASS at scaffold (0 LOC / 0 prod files / 2 total / 1 surface). Tasks + pre-PR gate modes are deferred on installed runner — fallback evidence chain recorded at Phase 5/PR steps |
| Tier-2 relocation | Suppressed — SPEC-025 is already-current (SPEC-MOC `structureVersion: 1`, PROCESS artifacts under `.process/`); no other eligible thawed legacy candidates surfaced |
| Model/effort | Orchestrator Fable 5 (> Opus 4.6 bar); effort HIGH per explicit operator override in invocation args (in place of max); operator directive: orchestrator delegates only, custom agents at minimal viable model, never Haiku |
| Archive Sweep (Step -1) | **No-op** — real sweep (`--sweep --current-target specs/025-plugin-platform-spike`, feature branch): `specs/` contains only the excluded current target; SPEC-001/002/004/008/023 already archived (provenance in `.specify/memory/archive-reports/`). No files modified. Extension nit surfaced: `check-prerequisites.sh` expects an active feature.json even in sweep mode (worker derived paths manually) |
| G0 Constitution Validation | **PASS.** BUILD (`npm run build`: tsc + copy-assets) clean. UNIT_TEST: two full-suite runs under session load each showed a *different* set of 5000ms-timeout / `EMFILE too many open files` failures (10 then 6, disjoint files); all 3 flagged files (foundation, index-command, sync — 76 tests) pass in isolation in 17s. Verdict: load-induced fd/timeout flakes, not breakage; worktree has zero `src/**` changes. Baseline: 2679 passed / 7 skipped / 162 files |

---

## Specification Context

### Basic Information

| Field | Value |
|-------|-------|
| **Spec ID** | SPEC-025 |
| **Name** | Plugin Platform Mechanics Spike (Claude Code + Codex) |
| **Branch** | `025-plugin-platform-spike` |
| **Dependencies** | None |
| **Enables** | SPEC-026 (Plugin-Channel Distribution) |
| **Priority** | P1 |

### Success Criteria Summary

From the technical roadmap scope + design concept (Q10 done bar):

- [ ] `docs/design/plugin-channel-decision.md` exists; every roadmap scope bullet closes with an explicit decision + public citation + hands-on evidence where load-bearing
- [ ] Platform audit complete for BOTH hosts: Claude Code plugin format (manifest/component pointers, plugin-scoped mcpServers/hooks/skills/agents/commands, `${CLAUDE_PLUGIN_ROOT}`, marketplace + trust model, plugin-agent tool inheritance + disallowedTools) and Codex plugin format (`.codex-plugin/plugin.json`, bundled skills, `codex-agents/*.toml`, `codex-hooks.json`, MCP registration, project- and hook-hash trust gating)
- [ ] OQ-8 resolved: PRD hypothesis (PATH → npx fallback → success-shaped guidance) validated or falsified-with-evidence from a plugin-scoped MCP entry on both hosts (Q2)
- [ ] Coexistence contract recorded: plugin wins config / npm keeps binary (Q3), with a component × host ownership matrix and per-component installer gap coverage (Q6, Q7); detection + dedupe + uninstall interplay specified in both directions
- [ ] Skill-authoring grounding section cites both vendors' public guidance (shared agent-skills standard)
- [ ] Shipped-artifact plan enumerates the candidate skill/agent set with per-artifact tier decisions (operator-owned tool-surface doctrine) + validation bars (Sonnet-floor A/B, no regression vs MCP-only baseline)
- [ ] Explore-flow workflow skill exemplar fully drafted in the decision doc's appendix (Q4, Q5)
- [ ] No scratch plugins or fixtures committed — evidence quoted inline (Q9)
- [ ] Spike completed within the 2–3 day timebox; any miss recorded as an explicit staged decision (Q8, Q10)

---

## Phase 1: Specify

**When to run:** At the start. Focus on **WHAT** and **WHY**, not implementation details. Output: `specs/025-plugin-platform-spike/spec.md`

### Specify Prompt

```text
/speckit-specify

## Feature: Plugin Platform Mechanics Spike (Claude Code + Codex)

### Problem Statement
CodeGraph today reaches agents through the npm installer, which writes MCP
registration and (for Claude) a UserPromptSubmit front-load hook into each
agent's config. Both Anthropic and OpenAI now ship first-class plugin channels
that can carry an MCP server, hooks, user-invocable skills, and
explicitly-dispatched agents as one installable, updatable unit. Before any
shipped behavior changes (SPEC-026), we need a grounded, citation-backed
decision document resolving how a CodeGraph plugin would work on each host and
how it coexists with the existing npm installer.

### Users
- The maintainer executing SPEC-026 (primary consumer — the doc must leave zero
  further research).
- CodeGraph users who install via a plugin marketplace instead of `npx
  @colbymchenry/codegraph` (their setup/coexistence/uninstall story is what the
  decisions govern).

### User Stories
- [US1] As the SPEC-026 implementer, I have a platform audit of both plugin
  formats with public citations and hands-on evidence, so I can build the plugin
  without re-researching host behavior. (Design concept Q1: citations +
  hands-on validation via a scratch plugin loaded in BOTH hosts.)
- [US2] As the SPEC-026 implementer, I have a validated MCP launcher contract:
  PATH-resolved installed binary → npx thin-installer fallback → success-shaped
  setup guidance when the binary is absent (never isError — errors teach
  abandonment). (Q2: validate the PRD OQ-8 hypothesis; trade study only if
  falsified.)
- [US3] As a user with BOTH channels present, exactly one channel owns each
  component: the plugin wins the config-writing role where its host format can
  carry the component; the npm installer keeps the binary role and covers
  per-component gaps; detection, dedupe, and uninstall interplay are specified
  in both directions. (Q3 + Q7; component × host ownership matrix required.)
- [US4] As a Codex user, I get the plugin subset Codex's format actually
  supports — a degraded plugin with the asymmetry documented, installer covering
  the rest — rather than no plugin or a delayed channel. (Q6 maintainer
  decision.)
- [US5] As the SPEC-026 implementer, I have the candidate skill/agent set
  enumerated with per-artifact tier decisions (fully open vs built-in-only
  denials — operator-owned tool-surface doctrine) and validation bars
  (Sonnet-floor A/B per CLAUDE.md, no regression vs MCP-only baseline), plus ONE
  fully-drafted exemplar: the explore-flow workflow skill, in the decision doc's
  appendix. (Q4/Q5; #529: artifacts reference, never restate,
  server-instructions.ts.)

### Constraints
- Research spike: docs/process surface only; 0 production LOC; ~2 committed
  files (decision doc + roadmap status edit); timebox 2–3 days (Q8).
- Evidence-only: scratch plugins are never committed; the doc quotes manifest
  snippets, host versions, observed behavior, exact repro commands (Q9).
- Committed text cites public sources only (Anthropic skills docs /
  best-practices / engineering blog / anthropics/skills; OpenAI
  developers.openai.com/codex/skills / openai/skills / agentskills.io).
- server-instructions.ts remains the single source of agent-facing tool
  guidance (#529) — the artifact plan's validation bars must enforce
  reference-not-restate.
- Done bar (Q10): every scope bullet decided, cited, validated; OQ-8 marked
  resolved in the PRD's terms; timebox misses become explicit staged decisions.

### Out of Scope
- Shipping anything — SPEC-026 implements the decisions.
- Replacing or deprecating the npm installer (it keeps the binary role, Q3).
- Committing scratch plugins or validation fixtures (Q9).
- Drafting any artifact beyond the single explore-flow exemplar (Q4).
- A full equal-weight launcher trade study unless validation falsifies the PRD
  hypothesis (Q2).
- Upstream marketplace listing decisions beyond the racecraft channel.
```

### Specify Results

| Metric | Value |
|--------|-------|
| Functional Requirements | 20 (FR-001–FR-020) |
| User Stories | 5 (US1 P1 audit; US2/US3 P2 launcher/coexistence; US4/US5 P3 degraded-Codex/artifact-plan) |
| Acceptance Criteria | 14 acceptance scenarios + 8 success criteria (SC-001–SC-008) + 6 edge cases |

Hooks: `after_specify` agent-context.update **skipped** (repo CLAUDE.md is hand-curated; docs-only spike adds no tech stack — surgical-changes call, logged); git.commit honored via orchestrator checkpoint commit. Spec-index regen: **deferred** on installed runner (`generate-spec-index-write` registered deferred; check variant is a stub) — recorded once, applies to all phase boundaries.

### Files Generated

- [x] `specs/025-plugin-platform-spike/spec.md` (+ `checklists/requirements.md`, `.specify/feature.json`)

### SpecKit Traceability Markers

Use these markers in spec.md for traceability through later phases:

| Marker | Purpose | Example |
|--------|---------|---------|
| `[US1]`, `[US2]` | User story reference | `[US1] Platform audit with citations` |
| `[FR-001]` | Functional requirement | `[FR-001] Launcher resolves PATH binary first` |
| `[NEEDS CLARIFICATION]` | Flag for Clarify phase | `Codex hook surface [NEEDS CLARIFICATION]` |
| `[P]` | Parallel-safe task | `[P] Claude and Codex audits can run in parallel` |
| `[Gap]` | Missing coverage | `[Gap] No requirement covers uninstall interplay` |

---

## Phase 2: Clarify

**When to run:** After Specify. Maximum 5 targeted questions per session. Sessions below are seeded from the design concept's Open Questions — dig into exactly what grill-me left open.

### Clarify Prompts

#### Session 1: Component × Host Support Matrix

```text
/speckit-clarify Focus on the component × host ownership matrix: which of the four
components (MCP server registration, prompt front-load hook, skills, agents) the
spec assumes each host's plugin format can carry; what "carry" means concretely per
host (Claude plugin-scoped mcpServers/hooks/skills/agents vs Codex
.codex-plugin/plugin.json + codex-agents/*.toml + codex-hooks.json); whether Codex
exposes ANY UserPromptSubmit-equivalent hook surface and, if not, whether front-load
on Codex is installer-covered (design concept Q7) or absent-by-design; and how the
degraded-Codex subset (Q6) is expressed as requirements rather than prose.
```

#### Session 2: Candidate Artifact Set & Tiering

```text
/speckit-clarify Focus on the shipped-artifact plan: the inclusion criteria for the
candidate skill/agent enumeration (which workflows over the MCP tools deserve a
skill; whether any explicitly-dispatched agent makes the v1 candidate set); the
per-artifact tier decision rule (fully open vs focus-constrained via built-in-only
denials — the operator-owned tool-surface doctrine); and the exact validation bar
each artifact must pass (Sonnet-floor A/B per CLAUDE.md agent-eval methodology, no
regression vs the MCP-only baseline, reference-not-restate per #529).
```

#### Session 3: Launcher & Coexistence Validation Protocol

```text
/speckit-clarify Focus on validation mechanics for OQ-8 and coexistence: what
hands-on evidence counts as validating the PATH → npx → guidance launcher chain
from a plugin-scoped MCP entry (host versions pinned; macOS now, Windows/Linux
follow-up posture); the npx fallback's supply-chain/network implications under
constitution Principle VII; how installer-detects-plugin and plugin-detects-
installer are each observed in a scratch setup; and what the absent-binary
success-shaped guidance must contain to satisfy the errors-teach-abandonment
doctrine.
```

### Clarify Results

| Session | Focus Area | Questions | Key Outcomes |
|---------|------------|-----------|--------------|
| 1 | Component × host matrix | 5 (all recommendations accepted) | FR-002 reframed capability-first (real Codex artifact names; `codex-hooks.json`/`codex-agents/*.toml` confirmed non-existent; do-not-conflate note for plugin-root `agents/` branding YAML). FR-009/FR-011 now distinguish existing vs NEW SPEC-026 installer capability. FR-010: all-8-cells requirement + working assignment "front-load hook plugin-owned on BOTH hosts" with pinned-CLI-version concrete hook test (#16430/PR #19705 history). FR-013: degraded-Codex subset concretized — agents cell → npm installer via `.codex/agents/*.toml` (net-new SPEC-026 work), validation must pin multi-agent runtime path v1/v2 + model (#15250/#20077 open upstream) |
| 2 | Artifact set & tiering | 5 (all recommendations accepted) | FR-014: three-leg inclusion criterion (rides codegraph_explore / adds delta beyond server-instructions.ts / expected to clear A/B bar; considered-and-excluded recorded); agent class evaluated separately (retrieval-guardian OUT — dev-only reviewer; skills-only v1 unless a user-facing agent qualifies); tier rule fixed. FR-015: third A/B mode defined (artifact-off vs artifact-on, Sonnet floor, ≥2 runs/arm, pass = no regression + control). FR-016: reference-not-restate now a per-candidate validation line item. Assumptions: skill-efficacy prior recorded (unproven — real filter, exemplar may fail acceptably); shared agent-skills standard corroborated with 4 load-bearing per-host divergences scoped to US1 audit. ⚠️ One security-tagged item ([U2] tier-mechanism hardening) escalated to HUMAN REVIEW per protocol — see CRL row 6 |
| 3 | Validation protocol | 5 (Q5 accepted directly; Q1–Q4 via consensus) | FR-005: npx stage corrected to `--offline` (guaranteed zero-network; catchable miss → guidance), SHOULD-pin major version (recorded divergence from MCP ecosystem convention), ~50MB disclosure — **maintainer APPROVED (security gate, 2026-07-09)**. FR-006: stub-launcher delivery + runtime-self-sufficiency condition (no host guarantees node for plugin subprocesses; agent-invisibility of failed spawns confirmed via Claude #72431). FR-007/AC/edge: consensus REVERSED the parent's preemptive Windows deferral — in-spike Windows (Parallels) + Linux (Docker) attempt restored, staged deferral now a conditioned fallback naming the two known risks (CVE-2024-27980-class .cmd spawn #289; Antigravity bare-name GUI-PATH precedent). FR-011: per-host coexistence mechanics (Claude host-arbitrated dedup — installer entry wins, lever (i)/(ii) to decide hands-on; Codex no native dedup, user-side toggle; exit-0 self-suppression not viable, handshake+empty-tools is the constructible fallback). FR-012: restore is next-`codegraph install`-run-driven |

### Consensus Resolution Log

| # | Type | Question/Gap/Finding | Categories | Round | Outcome | Resolution | Analysts Used |
|---|------|----------------------|------------|-------|---------|------------|---------------|
| 1 | Clarify | S1: Codex front-load hook plugin-owned (matrix cell)? | [domain] | 1 | high-confidence | FR-010 sharpened: pin installed Codex CLI version; concrete UserPromptSubmit hooks/hooks.json test; docs+source corroborated | domain-researcher |
| 2 | Clarify | S1: Codex agents cell → installer-written `.codex/agents/*.toml` as new SPEC-026 capability? | [domain, spec] | 1 | both-agree | FR-013 sharpened: pin multi_agent_v1/v2 runtime + model in validation; #15250 OPEN + #20077 corroborated; Q3→Q6→Q7 chain + net-new confirmed at codex.ts:92-109 | domain-researcher, spec-context-analyst |
| 3 | Clarify | S1: exact Codex artifact filenames (no codex-hooks.json / codex-agents/*.toml)? | [domain] | 1 | high-confidence | FR-002 confirmed correct; added do-not-conflate note (plugin-root `agents/` = YAML branding metadata, not subagent bundling); verified vs live docs + openai/plugins + codex-plugin-cc real files | domain-researcher |
| 4 | Clarify | S2: skill salience — "several clear" vs "unproven/real filter" framing? | [domain, codebase] | 1 | both-agree | Assumptions bullet added: efficacy unproven (vendor-admitted undertriggering, zero in-repo skill-A/B precedent); skills structurally higher-salience than failed server-instructions channel; FR-015 is a real filter, exemplar may fail acceptably | domain-researcher, codebase-analyst |
| 5 | Clarify | S2: shared agent-skills standard "one tree serves both hosts"? | [domain] | 1 | high-confidence | Assumption rescoped: SKILL.md content transfers; discovery dirs, tool-permission frontmatter, auto-invoke opt-outs, invocation syntax are per-host divergences for the US1 audit (agentskills.io canonical; first-party corroboration both vendors) | domain-researcher |
| 6 | Clarify | S2: tool-tier rule for shipped artifacts (fully-open default; never touch MCP surface; constrained-tier mechanism) | [security, spec, codebase] | 1 | [HUMAN REVIEW] | 3/3 substantive agreement (rule sound; doctrine provenance = roadmap:850/:875 + grill-me Q4); domain adds hardening (constrained skills need `disallowed-tools`, not `allowed-tools` alone; durable via context:fork; Codex ignores allowed-tools). Security-tag override → surfaced to maintainer; **maintainer APPROVED hardened FR-014 (2026-07-09)** — applied | all 3 (security tag → mandatory) |
| 7 | Clarify | S3: Windows/Linux launcher validation posture (parent's preemptive deferral) | [spec, codebase] | 1 | both-agree | Parent edit REVERSED: design-concept Q2/Q8 budget Windows checks in-spike; deferral justification unsound (.cmd spawn risk #289, Antigravity PATH precedent); FR-007/AC-US2.3/edge restored to attempt-first with conditioned SC-008 fallback | spec-context-analyst, codebase-analyst |
| 8 | Clarify | S3: npx stage under Principle VII (flag mechanics, pinning, size) | [security, domain] | 1 | [HUMAN REVIEW] → approved | 3/3 unanimous; `--offline` correction + SHOULD-pin-major + ~50MB disclosure; Principle VII satisfied via spec-level reconciliation (SPEC-002 precedent); **maintainer APPROVED corrected FR-005 (2026-07-09)** — applied | all 3 (security tag → mandatory) |
| 9 | Clarify | S3: absent-binary guidance delivery mechanism | [domain, codebase] | 1 | both-agree | Stub-launcher confirmed (failed spawns agent-invisible per Claude #72431; NotIndexedError/proxy.ts patterns established); runtime-self-sufficiency condition appended to FR-006 | domain-researcher, codebase-analyst |
| 10 | Clarify | S3: detection/dedupe directions per host | [codebase, domain] | 1 | both-agree | FR-011 rewritten per-host (Claude host-arbitrated dedup with lever (i)/(ii) decision; Codex user-side toggle; no plugin self-suppression — handshake+empty-tools fallback); FR-012 restore made invocation-driven | codebase-analyst, domain-researcher |

---

## Phase 3: Plan

**When to run:** After spec is finalized. For this spike the "implementation blueprint" is the validation protocol + decision-doc structure — no production code. Output: `specs/025-plugin-platform-spike/plan.md`

### Plan Prompt

```text
/speckit-plan

## Tech Stack (research-spike variant — no production code)
- Deliverable: docs/design/plugin-channel-decision.md (Markdown decision doc,
  same genre as docs/design/web-framework-decision.md from SPEC-004)
- Validation hosts: Claude Code (plugin channel: marketplace / --plugin-dir
  style loading) and Codex CLI (.codex-plugin channel) — pin exact versions in
  evidence blocks
- Scratch plugins: built OUTSIDE the repo (evidence-only per design concept Q9);
  quote manifests inline in the doc
- Reference surfaces in this repo: src/installer/targets/claude.ts (MCP +
  UserPromptSubmit hook writing), src/installer/targets/codex.ts (config.toml
  TOML writing), src/mcp/server-instructions.ts (single source of agent-facing
  guidance, #529), scripts/mcp-dogfood.mjs (launcher precedent)

## Constraints
- 0 production LOC; docs/process surface only; ~2 committed files; 2–3 day
  timebox (design concept Q8) — plan the work to fit the timebox, and mark
  which validation steps become explicit staged decisions if time runs out (Q10)
- Public citations only in committed text
- The launcher contract must preserve the errors-teach-abandonment doctrine:
  absent binary → success-shaped setup guidance, never a hard error
- Decision doc must include: platform audit (both hosts), OQ-8 launcher
  validation evidence, component × host ownership matrix with per-component
  installer gap coverage (Q3/Q6/Q7), skill-authoring grounding, artifact plan
  with tiers + validation bars, and the explore-flow exemplar appendix (Q4/Q5)

## Architecture Notes
- Re-read docs/ai/specs/.process/SPEC-025-design-concept.md before planning —
  it is the source of truth for every scoping decision (Q1–Q10)
- OQ-8 prior art: docs/prd-intelligence-platform.md records the hypothesis
  (PATH-resolved binary, npx fallback, success-shaped guidance) — the plan's
  validation protocol confirms or falsifies it, nothing more (Q2)
- Coexistence design must be expressible later as per-component precedence
  logic in the installer targets (SPEC-026's job) — the matrix is the contract
```

### Plan Results

| Artifact | Status | Notes |
|----------|--------|-------|
| `plan.md` | ✅ | 12-section decision-doc blueprint (each mapped to US/FR/SC + per-section validation bar); 19-step validation protocol (A docs → B scratch plugins → C Claude → D Codex → E Windows/Linux attempts → F synthesis); timebox map with non-deferrable core (macOS launcher, dedup lever, matrix, exemplar) and attempt-first conditioned deferrals (V10/V11/V12); Constitution Check PASS I–VII pre+post design |
| `research.md` | ✅ | 5 sections: OQ-8 decision record (+ --offline/pin/~50MB refinements); C1–C9 public citation inventory; in-repo reference surfaces; shared skills standard + unproven-trigger-efficacy note; unknowns disposition table |
| `data-model.md` | ➖ omitted | Key Entities are documentary sections, not persisted data; Evidence Block schema captured inline (SPEC-004 precedent) |
| `contracts/` | ➖ omitted | Launcher contract/matrix are prose deliverables consumed by SPEC-026, not code interfaces (0-LOC spike) |
| `quickstart.md` | ➖ omitted | The 19-step Validation Protocol IS the runnable scenario set; separate quickstart would duplicate it |

---

## Phase 4: Domain Checklists

**When to run:** After `/speckit-plan` — validates both spec AND plan together.

### Step 1: Recommended Domains (from spec analysis)

| Signal in SPEC-025 | Recommended Domain |
|---|---|
| Marketplace trust models, hook-hash gating, npx fallback supply-chain exposure, plugin-agent tool inheritance / disallowedTools | **security** |
| Two hosts × two channels interplay: detection, dedupe, uninstall in both directions, component × host matrix | **integration** |
| Absent-binary path, success-shaped guidance, errors-teach-abandonment, degraded-Codex asymmetry | **error-handling** |

**Target: 2-4 domains.** These three cover the spike's risk concentration; UX/performance/data domains don't apply to a docs-only spike.

### Step 2: Run Enriched Checklist Prompts

#### 1. security Checklist

Why this domain: the spike fixes trust-model decisions (marketplace trust, hook-hash gating) and the npx fallback runs network installs from an agent-config context — the highest-risk decision in the doc.

```text
/speckit-checklist security

Focus on SPEC-025 requirements:
- Trust model coverage: Claude marketplace/plugin trust prompts and Codex
  project- and hook-hash trust gating each have requirements with citation +
  validation evidence
- npx-fallback supply-chain exposure: the launcher decision must weigh
  network-install implications under constitution Principle VII (local-first)
- Plugin-agent tool surface: requirements cover tool inheritance and
  built-in-only disallowedTools tiering (operator-owned tool-surface doctrine)
- Pay special attention to: whether any requirement lets the plugin channel
  introduce phone-home or auto-install behavior the npm channel doesn't have
```

#### 2. integration Checklist

Why this domain: coexistence is a two-host, two-channel, four-component matrix — the likeliest place for a silent gap (a component × host cell nobody decided).

```text
/speckit-checklist integration

Focus on SPEC-025 requirements:
- Every cell of the component × host matrix (MCP, hook, skills, agents ×
  Claude, Codex) has an owner: plugin, installer (gap coverage per Q7), or
  explicitly absent
- Detection is specified in BOTH directions: installer-detects-plugin and
  plugin-detects-installer, including what each does on detection
- Uninstall interplay: removing either channel leaves the other functional,
  with no orphaned MCP entries or hooks
- Pay special attention to: the degraded-Codex subset (Q6) — the asymmetry must
  be requirements, not prose
```

#### 3. error-handling Checklist

Why this domain: the launcher's absent-binary path is doctrine-critical (errors teach abandonment) and the degraded plugin creates partial-availability states that must fail success-shaped.

```text
/speckit-checklist error-handling

Focus on SPEC-025 requirements:
- Absent-binary path: success-shaped setup guidance content is specified (what
  the agent sees, what the user is told to run), never isError
- npx fallback failure (offline, registry error): the next fallback step is
  specified, not implied
- Degraded-Codex states: what a Codex user observes when a component is
  plugin-absent and installer-covered vs absent entirely
- Pay special attention to: any path where BOTH channels are present and
  misconfigured — the doc must say who reports what
```

### Checklist Results

| Checklist | Items | Gaps | Spec References |
|-----------|-------|------|-----------------|
| security | | | |
| integration | | | |
| error-handling | | | |
| **Total** | | | |

### Addressing Gaps

When checklist identifies `[Gap]` items:

1. Review the gap — is it a genuine missing requirement?
2. Update `spec.md` or `plan.md` to address it
3. Re-run the checklist to verify coverage
4. If the gap is intentionally out of scope, document why

---

## Phase 5: Tasks

**When to run:** After checklists complete (all gaps resolved). Output: `specs/025-plugin-platform-spike/tasks.md`

### Tasks Prompt

```text
/speckit-tasks

## Task Structure
- Small, verifiable chunks (1-2 hours each); every task's acceptance criterion
  references FR-xxx and names the evidence it must produce (citation captured,
  behavior observed + quoted, section drafted)
- Dependency ordering: citation audit → scratch-plugin validation (per host) →
  decision synthesis (matrix, launcher, coexistence) → artifact plan + exemplar
  → doc assembly
- Mark parallel-safe tasks explicitly with [P] — the Claude-side and Codex-side
  audits/validations are independent [P] tracks until the synthesis tasks join
  them
- Organize by user story ([US1] audit, [US2] launcher, [US3] coexistence,
  [US4] degraded Codex, [US5] artifact plan + exemplar)

## Implementation Phases
1. Citation audit (both vendors, public sources only)
2. Hands-on validation — Claude Code track [P] and Codex track [P]
3. Decision synthesis — OQ-8 verdict, component × host matrix, coexistence rules
4. Artifact plan + explore-flow exemplar draft
5. Doc assembly + evidence blocks + roadmap status update

## Constraints (from design concept Non-goals — flag any task that crosses these)
- No task may create files under src/ or commit scratch plugins/fixtures (Q9)
- No task drafts any artifact beyond the explore-flow exemplar (Q4/Q5)
- No task re-opens the launcher trade study unless a validation task falsified
  the PRD hypothesis (Q2)
- Total committed output stays ~2 files: docs/design/plugin-channel-decision.md
  and the roadmap status edit
- The 2–3 day timebox (Q8) bounds total task estimates; tasks that would
  overflow it must be marked as candidate staged decisions (Q10)
```

### Tasks Results

| Metric | Value |
|--------|-------|
| **Total Tasks** | |
| **Phases** | |
| **Parallel Opportunities** | |
| **User Stories Covered** | |

---

## Atomicity Route

**When this is filled:** After the Tasks phase / gate G5, the autopilot SKILL runs
the read-only atomicity classifier and records its decision here. This is a
**placeholder** until then — leave the cells blank during scoping. The classifier
emits one machine-readable decision; the SKILL is what writes it into this section
(the script never writes a file of its own). This route is recorded only here in the
workflow file — never in the spec map. It is read downstream by the layer-planner and
multi-PR emission work that builds on top of it; recording it now wires no PR creation
or branch splitting on its own.

| Field | Value | Meaning |
|-------|-------|---------|
| **Route** | | One of `split-PR`, `one-navigable-PR`, `single-atomic-PR`, `branch-by-abstraction`, or `out-of-scope`. |
| **Releasable** | | `true`, or `false` for a destructive-migration or concurrency-sensitive change. |
| **Signals** | | The decisive detector findings behind the route and releasability reading. |
| **Warnings** | | Any release-safety warning attached to the change. |

To produce the decision, run the classifier against the feature directory:

```text
runner helper atomicity-route specs/025-plugin-platform-spike
```

---

## Phase 6: Analyze

**When to run:** Always run after generating tasks to catch issues.

### Analyze Prompt

```text
/speckit-analyze

Focus on:
1. Constitution alignment — Principles II/III (docs-only, surgical: no src/
   tasks), IV (every decision task names its evidence), VII (launcher decision
   weighs local-first)
2. Coverage gaps — every FR and user story (US1–US5) has tasks; every scope
   bullet from the roadmap maps to a decision-doc section task
3. Design-concept drift — spec.md, plan.md, tasks.md must not contradict
   docs/ai/specs/.process/SPEC-025-design-concept.md (Q1–Q10 are the scoping
   source of truth; a contradicting downstream artifact is wrong unless it
   carries an explicit revision note)
4. Verify the component × host matrix, OQ-8 verdict, coexistence rules,
   artifact plan, and exemplar each have complete task coverage — the Q10 done
   bar tolerates no silent gaps
```

### Analyze Severity Levels

| Severity | Meaning | Action Required |
|----------|---------|-----------------|
| `CRITICAL` | Blocks implementation, violates constitution | **Must fix before G6 gate** |
| `HIGH` | Significant gap, impacts quality | Should fix |
| `MEDIUM` | Improvement opportunity | Review and decide |
| `LOW` | Minor inconsistency | Note for future |

### Analysis Results

| ID | Severity | Issue | Resolution |
|----|----------|-------|------------|
| | | | |

---

## Phase 7: Implement

**When to run:** After tasks.md is generated and analyzed (no coverage gaps).

### Implement Prompt

```text
/speckit-implement

## Approach: Evidence-First (research-spike adaptation of TDD)

For each task, follow this cycle:

1. **DEFINE**: State the claim the task must establish (the "failing test" — a
   decision-doc section that cannot yet be written honestly)
2. **GATHER**: Capture the citation and/or run the scratch-plugin step that
   produces the evidence (pin host versions; record exact repro commands)
3. **WRITE**: Draft the decision-doc section quoting the evidence inline
4. **VERIFY**: Re-read against the design concept (Q1–Q10) and the spec's FRs —
   the section must close its scope bullet per the Q10 done bar

### Pre-Implementation Setup

Before starting any task:
1. Worktree preflight already done at scaffold time (npm install, npm run
   build, codegraph init/status: embeddings 100%, LSP enabled) — verify with
   `node dist/bin/codegraph.js status` if the session is fresh
2. Scratch-plugin workspace lives OUTSIDE the repo (Q9) — set it up under the
   session scratchpad, never under the checkout
3. Confirm host versions for evidence blocks (claude --version, codex
   --version) before the first validation task

### Implementation Notes
- The decision doc is docs/design/plugin-channel-decision.md — follow the genre
  of docs/design/web-framework-decision.md (SPEC-004's spike output)
- Quote manifests/configs verbatim in fenced blocks with host versions
- Public citations only; cite by stable URL (Anthropic docs, anthropics/skills,
  developers.openai.com/codex/skills, openai/skills, agentskills.io)
- The exemplar skill draft follows both vendors' authoring guidance (what/when
  trigger description, progressive disclosure, imperative steps) and MUST
  reference — never restate — server-instructions.ts (#529)
- If the timebox (Q8) forces a cut, write the staged decision explicitly into
  the doc (Q10): what was validated, what is deferred, what evidence is missing
```

### Implementation Progress

| Phase | Tasks | Completed | Notes |
|-------|-------|-----------|-------|
| 1 - Citation audit | | | |
| 2 - Hands-on validation (Claude ∥ Codex) | | | |
| 3 - Decision synthesis | | | |
| 4 - Artifact plan + exemplar | | | |
| 5 - Doc assembly | | | |

---

## Post-Implementation Checklist

- [ ] All tasks marked complete in tasks.md
- [ ] `docs/design/plugin-channel-decision.md` closes every scope bullet with decision + citation + evidence (Q10 done bar)
- [ ] OQ-8 verdict recorded in the doc in the PRD's terms
- [ ] Component × host ownership matrix present with per-component gap coverage
- [ ] Explore-flow exemplar drafted in the appendix
- [ ] `git diff --stat` shows no `src/**` changes and no committed fixtures (Q9)
- [ ] CHANGELOG: no entry needed (docs/process only — no user-facing behavior change); add one only if the maintainer asks
- [ ] Roadmap Progress Tracking row updated
- [ ] PR created against origin (racecraft-lab) — never upstream; no session URLs in the PR body
- [ ] Merged to main, then Dogfooding Protocol step: `npm run build` + `codegraph sync` on main

---

## Lessons Learned

### What Worked Well

-

### Challenges Encountered

-

### Patterns to Reuse

-

---

## Project Structure Reference

```
codegraph/
├── docs/
│   ├── design/                      # Decision docs — plugin-channel-decision.md lands here
│   │   └── web-framework-decision.md  # SPEC-004 spike precedent (genre to follow)
│   ├── prd-intelligence-platform.md # OQ-8 hypothesis lives here
│   └── ai/specs/                    # Roadmap + .process/ scaffolding artifacts
├── src/
│   ├── installer/targets/           # claude.ts (MCP+hook), codex.ts (config.toml) — READ-ONLY reference this spike
│   └── mcp/server-instructions.ts   # Single source of agent-facing guidance (#529) — never restated by plugin artifacts
├── scripts/mcp-dogfood.mjs          # Launcher precedent (walk-up locator, env application)
└── specs/025-plugin-platform-spike/ # spec.md, plan.md, tasks.md, SPEC-MOC.md (this spec's CONTRACT dir)
```

---

Template based on SpecKit best practices. Prompts populated from `docs/ai/specs/.process/SPEC-025-design-concept.md` (grill-me, 2026-07-09) and the technical roadmap § SPEC-025.
