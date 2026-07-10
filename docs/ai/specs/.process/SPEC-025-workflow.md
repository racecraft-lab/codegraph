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
| Checklist | `/speckit-checklist` | ✅ Complete | 3 domains, 105 items, 11 gaps → 0 (all 1-loop); 4 consensus items (1 security human-approved, 3 auto); G4 PASS |
| Tasks | `/speckit-tasks` | ✅ Complete | 30 tasks, all FRs covered (21 at generation; FR-022 added at Analyze, covered by T023 — 22/22 final), 9 [P] Claude∥Codex pairs, 3 staged-decision valves; G5 PASS; verify-tasks 0 phantoms; route one-navigable-PR; layer plan skipped; tasks-mode reviewability deferred (fallback chain in autopilot-state.json) |
| Analyze | `/speckit-analyze` | ✅ Complete | 13 findings (0C/2H/4M/7L) all resolved in ≤2 loops; FR-022 added (skill-authoring grounding); G6 PASS; 0 unresolved → consensus skipped; 📊 Confidence 0.98 |
| Implement | `/speckit-implement` | ✅ Complete | 30/30 tasks; decision doc `docs/design/plugin-channel-decision.md` (12 sections, ~2,400 lines, ~30 evidence blocks); OQ-8 RESOLVED (+2 refinements); 8/8 matrix cells decided; 4 staged decisions (attempt-first, evidenced); secret sweep CLEAN; commit surface docs-only |

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

- [x] `docs/design/plugin-channel-decision.md` exists; every roadmap scope bullet closes with an explicit decision + public citation + hands-on evidence where load-bearing
- [x] Platform audit complete for BOTH hosts: Claude Code plugin format (manifest/component pointers, plugin-scoped mcpServers/hooks/skills/agents/commands, `${CLAUDE_PLUGIN_ROOT}`, marketplace + trust model, plugin-agent tool inheritance + disallowedTools) and Codex plugin format (`.codex-plugin/plugin.json`, bundled skills, `codex-agents/*.toml`, `codex-hooks.json`, MCP registration, project- and hook-hash trust gating)
- [x] OQ-8 resolved: PRD hypothesis (PATH → npx fallback → success-shaped guidance) validated or falsified-with-evidence from a plugin-scoped MCP entry on both hosts (Q2)
- [x] Coexistence contract recorded: plugin wins config / npm keeps binary (Q3), with a component × host ownership matrix and per-component installer gap coverage (Q6, Q7); detection + dedupe + uninstall interplay specified in both directions
- [x] Skill-authoring grounding section cites both vendors' public guidance (shared agent-skills standard)
- [x] Shipped-artifact plan enumerates the candidate skill/agent set with per-artifact tier decisions (operator-owned tool-surface doctrine) + validation bars (Sonnet-floor A/B, no regression vs MCP-only baseline)
- [x] Explore-flow workflow skill exemplar fully drafted in the decision doc's appendix (Q4, Q5)
- [x] No scratch plugins or fixtures committed — evidence quoted inline (Q9)
- [x] Spike completed within the 2–3 day timebox; any miss recorded as an explicit staged decision (Q8, Q10)

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
| 11 | Gap | Checklist security: FR-019 evidence secret hygiene completeness | [security] | 1 | [HUMAN REVIEW] → approved | 3/3 direction; consolidated scrub rule (4 artifact classes; #18692 + status + plaintext-warning exposure points; redacted-host:port also scrubbed; placeholder convention); **maintainer APPROVED (2026-07-09)** — applied + Key Entities one-word edit | all 3 (security tag → mandatory) |
| 12 | Gap | Checklist security: FR-021 standalone vs redundant | [spec, domain] | 1 | both-agree | KEEP standalone (no overlap with FR-005; Principle VII + Q10 pattern); appended roster-currency trigger + launcher pre-exec parity clause | spec-context-analyst, domain-researcher |
| 13 | Gap | Checklist integration: matrix owner semantics under FR-011 lever | [spec] | 1 | high-confidence | Executor's active-registration reading RATIFIED (plan §6 + roadmap "matrix is the contract" + CHK030 no-false-flag all corroborate; policy-default reading would recreate the FR-009/FR-011 contradiction). No edit — synthesizer step collapsed to no-op ratification, single high-confidence analyst | spec-context-analyst |
| 14 | Gap | Checklist error-handling: evaded-dedup diagnostic ownership (FR-011) | [codebase, domain] | 1 | both-agree | Installer-next-invocation reporter FINALIZED (install action-log + upgrade self-heal precedents; status has no config-diagnostic role); Claude near-duplicates structurally cannot collide (plugin tool namespacing) — /plugin notice is exact-match-only backstop; Codex has no duplicate surface at all; 4-step hands-on scenario mandated. Stale types.ts `--check` doc comment flagged not-citable | codebase-analyst, domain-researcher |

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
| security | 38 (32 first-pass + 6 verify) | 3 found → 0 remaining (1 loop) | FR-019 extended (evidence secret-scrubbing — consolidated per consensus, maintainer-approved: 4 artifact classes, 4 named exposure points incl. #18692, redacted-host:port bar, placeholder convention); FR-021 added (channel network-parity affirmation + roster-currency trigger + launcher pre-exec parity clause) |
| integration | 33 (28 domain + 5 verify) | 4 found → 0 remaining (1 loop); G4 pass | FR-010 three-outcome cells (plugin / installer-new-flagged / explicitly-absent); FR-009 reconciled with FR-011 lever (matrix owner = active-registration channel — consensus-ratified, CRL 13); FR-012 orphan-cleanliness + lever-(ii) window; FR-013 no-coverage fallback (Codex hook cell → new capability or explicitly-absent, never force-assigned); plan §6/§7/§8 synced |
| error-handling | 34 (28 domain + 6 verify) | 4 found → 0 remaining (1 loop) | FR-005 catch generalized (ANY npx-stage failure → guidance); FR-006 terminal-fallback + user-action install-command framing (no agent auto-install, FR-021-consistent); FR-013 runtime observables per degraded cell; FR-011 evaded-dedup diagnostic ownership finalized per consensus (installer-next-invocation reporter; Claude tool-namespacing observable; /plugin exact-match backstop; Codex no surface; 4-step validation scenario) — CRL 14; plan §5/§7/§8 synced |
| **Total** | 105 checklist items across 3 domains | 11 found → 0 remaining (all 1-loop) | 2 security items maintainer-approved; G4 PASS (0 [Gap] markers) |

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
| **Total Tasks** | 30 (T001–T030), 1–2h chunks, each acceptance criterion cites FR-xxx + names its evidence |
| **Phases** | Setup 2 · Foundational 4 · US1 3 · US2 6 · US3 5 · US4 2 · US5 2 · Polish/Close-out 6 (backbone: plan V1–V19 + 12-section doc blueprint) |
| **Parallel Opportunities** | 9 [P] tasks — Claude∥Codex pairs: T004/T005 (scratch plugins), T007/T008 (audits), T010/T011 (launcher macOS), T016/T017 (dedup lever / pinned hook test), + T002 |
| **User Stories Covered** | All 5 (US1→T007–T009; US2→T010–T015; US3→T016–T020; US4→T021–T022; US5→T023–T024). All 21 FRs covered, none orphaned. 3 candidate staged-decision tasks (T012 Windows, T013 Linux, T021 v1/v2 pairing) — attempt-first per SC-008 |

**G5:** PASS (30 tasks). **Verify-tasks:** phantom check run post-G5 (fresh tasks.md, 0 pre-checked expected). **Reviewability (tasks mode):** DEFERRED on installed runner — fallback evidence chain recorded in `autopilot-state.json` (setup-mode PASS + not_estimated advisory + within-budget spike); marker-planning input = pass, no `pr_marker_plan` required.

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
| **Route** | `one-navigable-PR` | One of `split-PR`, `one-navigable-PR`, `single-atomic-PR`, `branch-by-abstraction`, or `out-of-scope`. |
| **Releasable** | `true` | `true`, or `false` for a destructive-migration or concurrency-sensitive change. |
| **Signals** | `change-shape:modify-heavy` | The decisive detector findings behind the route and releasability reading. |
| **Warnings** | none | Any release-safety warning attached to the change. |

**Layer Plan:** `skipped` — non-split route; `plan-layers-feature-dir` not invoked (recorded in `autopilot-state.json`). Recorded 2026-07-10 by the autopilot SKILL from the runner classifier's read-only decision.

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

13 findings across initial pass + 2 loops, ALL resolved (0 remaining; loop-2 re-run = PROCEED; count-markers 0/0/0). Zero unresolved-for-consensus → Analyze-Consensus task skipped per protocol. G6 PASS (0 CRITICAL/HIGH).

| ID | Severity | Issue | Resolution |
|----|----------|-------|------------|
| C1 | HIGH | Roadmap scope bullet "skill-authoring grounding" had no decision-doc section or task | Added FR-022 (all four element groups, cited); plan §9 retitled + V16 extended; T023 extended; US5 AS4 added |
| C2 | HIGH | FR-015 A/B bar omitted the roadmap's binding published-success-criteria leg | FR-015 extended (trigger rate, workflow tool-call count, zero failed calls, with/without comparison — roadmap L878 quoted); propagated to plan/T023/US5 AS1 |
| I1 | MEDIUM | Assumption "no vendor publishes trigger-rate metrics" read as roadmap contradiction | Reconciled: no published benchmark NUMBERS vs the recommended criteria SET vendors do publish; explicit revision note tying FR-015/FR-022 |
| G1 | MEDIUM | `metadata.mcp-server` (from roadmap) is not a documented public frontmatter field | Reframed as audit output; real mechanisms: qualified `ServerName:tool_name` body refs (Claude) / `agents/openai.yaml` `dependencies.tools` (Codex) |
| N1–N2 | MEDIUM | I1 residue in research.md §4; US4 scenarios missed FR-013 runtime observables | research.md reconciled; US4 AS3 added + Independent Test aligned |
| N3–N6, L1–L3 | LOW | Traceability/wording nits (US5 AS1 criteria leg; C6 stale; V14 missing T018 scenario; FR-022 numbering note; T018 non-deferrable label; disallowed-tools per-type wording; openai.yaml naming) | All applied as mechanical fixes |

**Pre-Implement Confidence Emit** (consensus-synthesizer, clean-pass path):

📊 Confidence: 0.98

- Task understanding: 0.97
- Approach clarity: 0.96
- Requirements alignment: 0.98
- Risk assessment: 1.00
- Completeness: 1.00

Rationale highlights: 22 FRs / 8 SCs all task-traced; the one open design fork (Claude dedup lever (i)/(ii)) is named and assigned to V6/T016, not silent; residual risk lives in the three SC-008 staged-decision valves, not open findings; data-model/contracts deliberately not-planned with Principle II rationale.

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
| 1 - Citation audit | T001–T002 | ✅ 2/2 | 30/30 public URLs verified live 2026-07-10; openai/skills→openai/plugins deprecation caught; public PDF replaces vault path; §2a ledger added |
| 2 - Hands-on validation (Claude ∥ Codex) | T003–T013, T016–T018, T021 | ✅ 15/15 | Claude 2.1.206 + Codex 0.144.0 pinned; both scratch plugins loaded; launcher 3-stage validated macOS both hosts + Linux/Docker; Windows staged-deferred (VM unreachable, .parallels absent); Codex hook = plugin-owned ≥0.144.0; v2 config-fidelity limitation reproduced live; NEARDUP 4-step validated both hosts |
| 3 - Decision synthesis | T009, T014–T015, T019–T020, T022 | ✅ 6/6 | OQ-8 RESOLVED as refined (GUI-PATH; two-hop offline); lever (i) via installer-side FR-012 detection; 8-cell matrix all decided, zero explicitly-absent; degraded-Codex = agents cell only |
| 4 - Artifact plan + exemplar | T023–T024 | ✅ 2/2 | FR-022 grounding block (S1–S10); K1 explore-flow included (delta recorded honestly as thin), K2–K5 excluded with reasons; v1 skills-only; ONE exemplar `codegraph-explore-flow`, reference-not-restate PASS |
| 5 - Doc assembly | T025–T030 | ✅ 6/6 | All 5 scope bullets closed; SD-1…SD-4 staged decisions; SC-001–008 all PASS; FR/SC traceability complete; secret sweep clean; §5.H parity affirmation (no net-new surface); roadmap row → Under Review |

---

## Post-Implementation Record

- **G7 (full verification):** PASS — `npm run build` clean; full vitest suite under parallel-subagent load showed 25 contention failures (timeouts/EMFILE, same signature as G0) across 5 files; all 823 tests in those 5 files pass in isolation (54s). Zero `src/**` changes on the branch — regression impossible by construction. Baseline preserved: 2,660+ passed / 7 skipped.
- **Integration Suite:** same run/verdict as G7 (docs-only spike; no spec-specific code tests expected — rationale: the deliverable is a document; its verification surface is the hands-on evidence protocol).
- **Verify-tasks phantom check (fresh context):** 30/30 VERIFIED, 0 phantoms; staged deferrals confirmed legitimate (named evidenced blockers, not fabricated passes).
- **Doctor extension check:** skipped — doctor/speckit-utils not installed.
- **Independent code review:** SHIP. Secrets sweep independently CLEAN (full branch diff; token/IP/path/endpoint patterns — zero hits). 1 major (stale autopilot-state.json) + 3 minors REMEDIATED in 41d6e60 (CLAUDE.md SPECKIT block refreshed, FR-count note, done-bar boxes checked, C-citation durability recorded as a known gap); nit (§5 lettering skips 5.B) accepted as-is; unchecked domain-checklist boxes accepted (reviewer-facing review questions by design).
- **Final reviewability gate (deferred `final-reviewability-backstop`):** PROCEED on committed fallback evidence — setup-mode PASS (0 LOC/0 prod/2 files/1 surface) + plan estimator `not_estimated` (0 declared prod files) + tasks-mode deferral chain + route `one-navigable-PR` + actual branch diff verified 0 `src/**` lines (16 files, +5,069/−72, docs/process only). No `pr_marker_plan` required; single-PR path.
- **Self-Review (mandatory 4-question audit, orchestrator):**
  1. *Did the implementation do what the spec asked?* Yes — all 22 FRs and 8 SCs close in the decision doc with a complete traceability map; independently verified by the verify agent (8 FRs deep-checked) and the phantom check (30/30 real).
  2. *What was skipped or deferred, and is each recorded?* Four staged decisions (SD-1 Windows VM unreachable + `.parallels` absent; SD-2 Codex v2 config fidelity; SD-3 Codex hook interactive-trust leg; SD-4 interactive Claude host-UI confirmations) — each attempt-first with a named evidenced blocker and the SPEC-026/human next step. Nothing silent.
  3. *What would a skeptical reviewer flag?* (a) The maintainer should restore `.parallels` and run the SD-1 Windows steps before SPEC-026 ships; (b) two spike findings CORRECT prior assumptions and deserve explicit reviewer attention — `npx --offline` covers only the shim (bundle fetch is a second network hop) and bare-name PATH fails for GUI-launched hosts; (c) one worker briefly copied `auth.json` into an isolated scratch CODEX_HOME for two small authenticated `codex exec` probes, then deleted it (never echoed/committed) — disclosed for transparency; (d) the roadmap's pre-spike guesses (`codex-agents/*.toml`, `codex-hooks.json` filenames; `metadata.mcp-server` field; hook-cell-absent prediction) were all corrected by evidence — the roadmap text itself is NOT updated beyond the status row (deliberate: surgical scope; SPEC-026 scaffolding reads the decision doc, not the stale scope prose).
  4. *Is the evidence real?* Yes — pinned host builds (Claude Code 2.1.206, Codex CLI 0.144.0, Node v24.11.1, Docker 29.5.3), live transcripts, reproduced upstream behaviors (#16430 fix window, v2 fidelity limitation, host dedup semantics), and honest could-not-validate notes where interaction was required.
- **UAT runbook:** `generate-uat-skeleton` is registered DEFERRED on the installed runner; no committed source-derived runbook exists → recorded as skipped with deferred-helper evidence (fail-open, logged); `uat-runbook-author` not spawned (no skeleton). The de-facto acceptance path for a docs spike is the §11.2 SC-001–SC-008 done-bar checklist plus the SD human steps.

## Post-Implementation Checklist

- [x] All tasks marked complete in tasks.md
- [x] `docs/design/plugin-channel-decision.md` closes every scope bullet with decision + citation + evidence (Q10 done bar)
- [x] OQ-8 verdict recorded in the doc in the PRD's terms
- [x] Component × host ownership matrix present with per-component gap coverage
- [x] Explore-flow exemplar drafted in the appendix
- [x] `git diff --stat` shows no `src/**` changes and no committed fixtures (Q9)
- [x] CHANGELOG: no entry needed (docs/process only — no user-facing behavior change); add one only if the maintainer asks
- [x] Roadmap Progress Tracking row updated
- [x] PR created against origin (racecraft-lab) — never upstream; no session URLs in the PR body: **PR #35** https://github.com/racecraft-lab/codegraph/pull/35 (packet + contract validators passed fresh; body from the speckit packet)
- [ ] Merged to main, then Dogfooding Protocol step: `npm run build` + `codegraph sync` on main

## Review Remediation (PR #35)

- **Round 1 — Copilot (3 inline comments, one concern):** the "~2 total files" budget wording vs the committed SpecKit process artifacts. Reworded spec.md FR-018, plan.md Reviewability Budget, and the tasks.md header to distinguish "~2 primary deliverable files" from standard process-artifact overhead (`0c61f9d`); replied to and resolved all three threads.
- **Round 2 — maintainer readability refactor:** the decision doc was rewritten in place to cut low-value prose (per-section "Status: drafted (Txxx)" narration removed; the Closes/Done-bar apparatus collapsed to one contract line per section; findings stated once in their home section with pointers elsewhere — the SD-1/SD-2 verbatim blocker text now lives only in §11.1; §12.1/§11.2/§12.3 budget wording aligned with the round-1 FR-018 deliverable-file framing). Volume 181.6 KB → 146.0 KB (−20%); **nothing substantive removed**: all 12 sections, all 31 evidence blocks (7 frozen fields each, IDs unchanged), P1–P4/S1–S10/C-references, SD-1…SD-4, the full §12.2 traceability map, and the §10 exemplar body (byte-identical) survive; secret sweep re-verified clean.
- **Round 3 — maintainer verdict "still almost impossible to review" → full body/appendix restructure:** the doc was rewritten from 12 flat sections into a **~480-line decision body (§§1–8) + appendices** — A: the exemplar SKILL.md (byte-identical); B: the frozen evidence schema/scrub rule + all 31 evidence blocks (IDs and 7 fields unchanged); C: the compliance record (done-bar, budget + scrub sweep, FR/SC traceability, PR packet). Body prose rewritten engineer-to-engineer with inline FR/SC/T/Q compliance tags dropped (traceability lives in App C.3); the C1–C9 citation roster **inlined into §8 Sources**, closing the previously-recorded citation-durability gap. Volume 181.6 KB → 101.9 KB (−44% vs original); words 23,753 → 13,194. **Anchor map (old → new):** §1→§1 · §2→App B.0 · §3/§4→§2 (blocks → B.1/B.2) · §5→§3 (blocks → B.3; §5.G→§3 verdict; §5.H→§3 parity) · §6/§7→§4 (blocks → B.4) · §8→§5 · §9→§6 · §10→App A · §11.1→§7 · §11.2→C.1 · §12.1→C.2 · §12.2→C.3 · §12.3→C.4. plan.md's "Decision Document Structure (the blueprint)" section revised in the same commit to match (with a revision note); verification re-run: 31/31 blocks × 7 fields, exemplar byte-identical, zero stale anchors, secret sweep clean.

---

## Lessons Learned

_Retrospective run 2026-07-10 (speckit-retrospective-analyze, terminal worker). Completion 30/30 tasks (100%); spec adherence 100% — all 22 FRs + 8 SCs close in the decision doc with a complete §12.2 traceability map, 0 dropped, 0 unspecified; the 4 staged decisions (SD-1…SD-4) are SC-008-conformant attempt-first deferrals, not drift. Constitution I–VII: no violations (docs-only branch, 0 `src/**` lines). Spec/plan/tasks untouched by this retrospective per hook policy._

### What Worked Well

- **Consensus caught the orchestrator being wrong, twice-over.** The parent's preemptive Windows-deferral edit was REVERSED by 2-of-3 consensus (CRL 7: design-concept Q2/Q8 budgeted Windows in-spike; the deferral rationale ignored the #289 `.cmd`-spawn and Antigravity GUI-PATH risks) — and the restored attempt-first posture is what produced SD-1's *evidenced* blocker instead of a silent guess. The consensus protocol functioned as a genuine check on the strongest agent in the room, not a rubber stamp.
- **Security-tag → mandatory human gates caught real factual errors.** CRL 8 corrected the spec's npx stage from `--prefer-offline` to `--offline` (only the latter guarantees zero-network with a catchable miss); CRL 6 hardened FR-014 tiering after the domain analyst showed `allowed-tools` alone doesn't constrain (it pre-approves; Codex ignores it) — constrained artifacts need built-in-only `disallowed-tools` + `context: fork`. Both were maintainer-approved same-day (2026-07-09); neither would have been caught by a single-analyst pass.
- **Evidence-first discipline (DEFINE→GATHER→WRITE→VERIFY) transferred TDD to a 0-LOC spike.** Freezing the Validation Evidence Block schema (T003) *before* any evidence existed forced per-stage-per-host launcher blocks and pinned versions from the first observation; the roadmap's pre-spike guesses (`codex-hooks.json`, `codex-agents/*.toml`, `metadata.mcp-server`, hook-cell-absent) were all corrected by evidence rather than propagated.
- **Attempt-first staged decisions eliminated silent gaps.** All three candidate valves (T012 Windows, T013 Linux, T021 Codex v2) were actually attempted; T013 completed (no deferral), T012/T021 deferred with named, evidenced blockers plus the exact SPEC-026 gate step. Verify-tasks (fresh context) confirmed 30/30 real, 0 phantoms — the deferrals read as legitimate because each carries its attempt transcript.
- **The two-operator `[P]` host-track split matched the work's real shape.** 9 `[P]` tasks in Claude∥Codex pairs (T004/T005, T007/T008, T010/T011, T016/T017) ran as independent evidence tracks converging only at synthesis joins (T009, T014, T019, T020) — no cross-track contention, because "parallel-safe" was defined by scratch tree + doc concern, not by code files.
- **Two-phase secret hygiene (scrub-at-drafting + T028 final sweep) came back CLEAN** across all four artifact classes × four named exposure points, independently re-confirmed at code review; identity-preserving placeholders (never line deletion) kept the evidence readable.

### Challenges Encountered

- **Load-induced vitest flakes under parallel-subagent load, at both G0 and G7.** Full-suite runs during orchestration showed 5000ms-timeout / `EMFILE` failures (G0: 10 then 6, *disjoint* files across two runs; G7: 25 across 5 files) — every flagged file passed in isolation (G0: 76 tests/17s; G7: 823 tests/54s). Verdict each time: fd/timeout contention, not breakage — but reaching that verdict cost isolated re-runs both times, and only the 0-`src/**` diff made "regression impossible by construction" a clean closer.
- **Runner anchoring to the main checkout, not the worktree.** `check-prerequisites` resolved against the main checkout, so branch identity (`025-plugin-platform-spike`, ON_FEATURE_BRANCH, IS_WORKTREE) had to be verified directly; the Step -1 archive sweep helper likewise expected an active `feature.json` even in sweep mode and the worker derived paths manually. Worktree-based specs must expect runner path assumptions to leak.
- **Deferred helpers on the installed runner forced manual fallback chains.** `generate-spec-index-write`, tasks-mode reviewability, `final-reviewability-backstop`, and `generate-uat-skeleton` were all registered DEFERRED — each closed via a recorded fallback evidence chain (setup-mode PASS + `not_estimated` advisory + route `one-navigable-PR` + verified 0-`src/**` branch diff in `autopilot-state.json`) rather than the helper's own output. Fail-open worked, but the evidence lives in prose, not machine checks.
- **Interactive trust gating blocked headless end-to-end legs.** Codex's `/hooks` TUI trust review (SD-3) and three Claude host-UI confirmations (SD-4: marketplace trust prompt, `/plugin` dedup notice, near-dup badge) cannot be driven headlessly without safety-bypass flags that were deliberately not used — the trust gates proving real is itself evidence, but each leg now needs a recorded human step.
- **Environment decay bit the Windows valve.** The Parallels VM was suspended with no IP *and* the documented `.parallels` credentials file was absent — SD-1 was un-attemptable beyond the probe itself. Cross-platform valves depend on infrastructure that must be verified *before* the risk-heavy day, not during it.
- **Process-ledger staleness surfaced only at independent review.** The 1 major finding (stale `autopilot-state.json`) plus 3 minors were caught by the post-implementation review and remediated in 41d6e60 — the orchestrator kept artifacts consistent during phases but not the cross-phase state file.

### Patterns to Reuse

- **Attempt-first staged-decision valve**: pre-name candidate deferral tasks at Tasks time (with the trigger condition), attempt each, and record {what was attempted, evidenced blocker, downstream gate step} — never decide a deferral in advance. This run's SD set is the template (and T013 shows valves can *close*).
- **Security-tag override → all-3-analysts + human approval** for any consensus item touching trust models, network fetch, or tool surfaces — it caught two factual errors that were both in the "obvious, everyone knows this" class.
- **Freeze the evidence schema before the first observation** (T003-style), including the scrub rule and the per-stage-per-host granularity — retrofitting structure onto collected evidence is where silent gaps breed.
- **Consensus may reverse parent edits**: treat the orchestrator's own artifact edits as first-class consensus inputs, revertible on 2-of-3 evidence — don't privilege the parent.
- **`[P]` by evidence track, not by file**: for two-host validation work, split parallel tracks per host with explicit sequential synthesis joins; give each track its own scratch tree.
- **Flake-signature baselining**: record the full-suite failure signature at G0 (count, files, error class) so G7 can distinguish load contention from regression by comparison + isolated re-runs, instead of relitigating from scratch.
- **Deferred-helper fallback chain**: when a runner helper is deferred, record the substitute evidence chain in `autopilot-state.json` at the moment of deferral (not at the final gate) so the backstop gate can PROCEED on committed evidence.
- **Fresh-context phantom check + independent review before PR**: verify-tasks in a fresh context (0 phantoms) and an independent reviewer (secrets re-sweep, staleness catch) each found things the implementing context could not see about itself.

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
