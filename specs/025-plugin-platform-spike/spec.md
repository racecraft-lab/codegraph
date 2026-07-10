# Feature Specification: Plugin Platform Mechanics Spike (Claude Code + Codex)

**Feature Branch**: `025-plugin-platform-spike`

**Created**: 2026-07-09

**Status**: Draft

**Input**: User description: "Plugin Platform Mechanics Spike (SPEC-025). Before any shipped behavior changes (SPEC-026), produce a grounded, citation-backed decision document (`docs/design/plugin-channel-decision.md`) resolving how a CodeGraph plugin would work on Claude Code and Codex, how it coexists with the existing npm installer, the MCP launcher contract (OQ-8), the component ownership matrix, and the shipped-artifact plan with one fully-drafted exemplar skill. Research spike: docs/process surface only, 0 production LOC, ~2 committed files, 2–3 day timebox, evidence-only (scratch plugins never committed)."

## User Scenarios & Testing *(mandatory)*

<!--
  User stories are the deliverable sections of the SPEC-025 decision document.
  Each is an independently-writable, independently-validatable slice: implementing
  just one still leaves a valuable, grounded fragment of the decision doc.
-->

### User Story 1 - Platform audit of both plugin formats, grounded in citations and hands-on evidence (Priority: P1)

As the SPEC-026 implementer, I have a platform audit of the Claude Code and Codex plugin formats — every load-bearing claim backed by a public citation and, where load-bearing, hands-on evidence from a scratch plugin actually loaded in both hosts — so I can build the plugin without re-researching host behavior.

**Why this priority**: The audit is the citation base every other decision rests on. Without it, the launcher contract, ownership matrix, and artifact plan are ungrounded assertions. A completed audit is already a viable minimal deliverable: it prevents SPEC-026 from discovering mid-implementation that the docs were stale.

**Independent Test**: Can be fully tested by reviewing the audit sections of the decision document and confirming each load-bearing platform claim resolves to a public citation and (where load-bearing) an evidence block naming a pinned host version, an exact repro command, and the observed behavior — delivering a reusable, verifiable reference for SPEC-026.

**Acceptance Scenarios**:

1. **Given** the decision document, **When** a reader reviews the Claude Code plugin-format section (manifest and component pointers, plugin-scoped `mcpServers`/`hooks`/`skills`/`agents`/`commands`, `${CLAUDE_PLUGIN_ROOT}` resolution, marketplace + trust model, plugin-agent tool inheritance and `disallowedTools`), **Then** every load-bearing claim carries a public citation and at least one hands-on evidence block.
2. **Given** the decision document, **When** a reader reviews the Codex plugin-format section (`.codex-plugin/plugin.json`, bundled skills, `codex-agents/*.toml`, `codex-hooks.json`, MCP registration, project- and hook-hash trust gating), **Then** every load-bearing claim carries a public citation and hands-on evidence, or an explicitly-recorded "could not validate" note stating the reason.
3. **Given** the committed decision document, **When** its citations are inspected, **Then** none reference a private or vault path — all resolve to the enumerated public Anthropic and OpenAI sources.

---

### User Story 2 - Validated MCP launcher contract resolving OQ-8 (Priority: P2)

As the SPEC-026 implementer, I have a validated MCP launcher contract — PATH-resolved installed binary → npx thin-installer fallback → success-shaped setup guidance when the binary is absent (never an error response) — confirmed by loading a plugin-scoped `mcpServers` entry on both hosts, so SPEC-026 wires the launcher with a decided, evidence-backed contract.

**Why this priority**: OQ-8 is the single named open question the spike exists to resolve. The launcher is the load-bearing mechanism that lets a plugin-registered server find the user-installed binary the plugin cannot itself bundle. It builds directly on the P1 audit.

**Independent Test**: Can be fully tested by reading the launcher-contract section and confirming (a) the ordered fallback is fully specified, (b) the absent-binary path is specified as success-shaped guidance rather than an error, and (c) OQ-8 is marked resolved in the PRD's terms with recorded validation evidence.

**Acceptance Scenarios**:

1. **Given** the launcher-contract section, **When** a reader traces binary resolution, **Then** the ordered fallback — PATH-resolved installed binary → npx thin-installer → success-shaped setup guidance — is fully specified.
2. **Given** the absent-binary case, **When** the launcher runs with no installed CodeGraph binary, **Then** the specified response is success-shaped setup guidance and is never an `isError` response (errors-teach-abandonment doctrine).
3. **Given** hands-on validation from a plugin-scoped `mcpServers` entry on both hosts including Windows PATH behavior, **When** validation confirms the PRD hypothesis, **Then** OQ-8 is marked resolved in the PRD's terms and no equal-weight trade study is produced; **When** validation falsifies the hypothesis, **Then** a full equal-weight launcher trade study is produced instead.

---

### User Story 3 - Coexistence ownership specified in both directions with a component × host matrix (Priority: P2)

As a user with both channels present, exactly one channel owns each component: the plugin wins the config-writing role for every component its host format can carry; the npm installer keeps the binary-distribution role and covers per-component gaps; detection, dedupe, and uninstall interplay are specified in both directions.

**Why this priority**: Coexistence prevents the two visible failure modes — duplicate CodeGraph MCP servers and double prompt-hook front-loading. It is what makes a marketplace install safe alongside an existing `npx @colbymchenry/codegraph` setup.

**Independent Test**: Can be fully tested by consulting the component × host ownership matrix and the coexistence rules, confirming every matrix cell names one owning channel and that dedupe and uninstall behavior are stated for both the plugin-present and installer-present directions.

**Acceptance Scenarios**:

1. **Given** the ownership section, **When** a reader consults the component × host matrix (MCP server, prompt front-load hook, skills, agents) × (Claude Code, Codex), **Then** every cell names exactly one owning channel.
2. **Given** both channels present, **When** the coexistence rules are applied, **Then** no duplicate MCP registration and no double hook injection occur, and the rules are stated in both directions (plugin detects installer; installer detects plugin).
3. **Given** either channel is uninstalled, **When** the other remains, **Then** the document specifies that the surviving channel stays functional.

---

### User Story 4 - Degraded Codex plugin with the asymmetry documented (Priority: P3)

As a Codex user, I get the plugin subset the Codex plugin format actually supports — a degraded plugin with the asymmetry vs Claude Code documented and the npm installer covering the rest — rather than no plugin at all or a delayed channel.

**Why this priority**: This preserves a single-channel story for both hosts even if the Codex plugin format is less capable, while honoring evidence over a forced-symmetric decision. It depends on the P1 audit and the P2 ownership matrix.

**Independent Test**: Can be fully tested by reading the Codex-viability decision and confirming it specifies which components the Codex plugin ships, documents the asymmetry, and assigns every unsupported component to the npm installer per the ownership matrix.

**Acceptance Scenarios**:

1. **Given** Codex validation shows the plugin format cannot carry a component, **When** the document records the outcome, **Then** it specifies a degraded Codex plugin shipping the supported subset with the asymmetry vs Claude Code documented.
2. **Given** a component the Codex plugin cannot carry, **When** ownership is assigned, **Then** the npm installer is designated to cover that component per the component × host matrix.

---

### User Story 5 - Shipped-artifact plan with per-artifact tiers, validation bars, and one drafted exemplar (Priority: P3)

As the SPEC-026 implementer, I have the candidate skill and agent set enumerated with per-artifact tier decisions (fully open vs built-in-only denials — the operator-owned tool-surface doctrine) and validation bars (Sonnet-floor A/B per the agent-eval methodology, no regression vs the MCP-only baseline), plus one fully-drafted exemplar — the explore-flow workflow skill — in the decision document's appendix as the authoring template.

**Why this priority**: The artifact plan turns "ship skills and agents" into a concrete, gated list SPEC-026 can author against, and the single drafted exemplar de-risks the authoring pattern once. It is the last slice because it consumes the audit, the launcher contract, and the ownership rules.

**Independent Test**: Can be fully tested by reviewing the artifact-plan section and appendix, confirming each candidate carries a tier decision and a validation bar, exactly one exemplar is fully drafted, and the plan requires artifacts to reference rather than restate `server-instructions.ts`.

**Acceptance Scenarios**:

1. **Given** the artifact plan, **When** a reader reviews the candidate list, **Then** each skill or agent carries a tier decision (fully open vs built-in-only `disallowedTools` denials), the trigger surface it targets, and a Sonnet-floor A/B validation bar with a no-regression-vs-MCP-only-baseline condition.
2. **Given** the appendix, **When** a reader looks for drafted artifact bodies, **Then** exactly one fully-drafted exemplar (the explore-flow workflow skill) is present and no other candidate artifact body is drafted.
3. **Given** any enumerated artifact, **When** its relationship to `server-instructions.ts` is checked, **Then** the plan requires it to reference — never restate — that file (issue #529).

---

### Edge Cases

- **Hands-on validation contradicts the published docs** (a manifest field or hook behaves differently than documented): the document records the observed behavior, flags the documentation as stale for SPEC-026, and the decision follows the evidence, not the doc.
- **The Codex plugin format cannot carry hooks or MCP registration at all**: a degraded Codex plugin ships whatever subset is supported; the npm installer covers the missing components; the asymmetry is documented (US4).
- **The npx fallback could trigger an unexpected network install from an agent-config context**: the launcher orders PATH-first, and the npx-fallback behavior and its risk are documented so SPEC-026 implements it deliberately rather than by surprise.
- **The 2–3 day timebox is exhausted before every scope bullet closes**: remaining bullets are recorded as explicit staged decisions in the document; they never become silent gaps.
- **Windows PATH resolution differs from POSIX** for the installed binary: the launcher contract is validated including Windows PATH behavior, and the evidence is recorded.
- **A candidate artifact fails its A/B validation bar**: it does not qualify for the shipped set; the plan records the bar as the gate SPEC-026 must clear before shipping that artifact (nothing ships on the strength of the model spontaneously picking it).

## Requirements *(mandatory)*

### Functional Requirements

**Platform audit (US1)**

- **FR-001**: The decision document MUST contain a platform audit of the Claude Code plugin format covering the manifest and component pointers, plugin-scoped `mcpServers`/`hooks`/`skills`/`agents`/`commands`, `${CLAUDE_PLUGIN_ROOT}` resolution, the marketplace and trust model, and plugin-agent tool inheritance with `disallowedTools` — each load-bearing claim backed by a public citation.
- **FR-002**: The decision document MUST contain a platform audit of the Codex plugin format covering `.codex-plugin/plugin.json`, bundled skills, `codex-agents/*.toml`, `codex-hooks.json`, MCP registration, and project- and hook-hash trust gating — each load-bearing claim backed by a public citation.
- **FR-003**: Every load-bearing platform claim MUST be corroborated by hands-on evidence from a scratch plugin loaded in BOTH hosts — recorded as quoted manifest snippets, pinned host versions, observed behavior, and exact repro commands — or, where a claim could not be validated, an explicitly-recorded note stating why.
- **FR-004**: All committed citations MUST reference only public sources (the enumerated Anthropic skills docs / best-practices / engineering blog / `anthropics/skills`, and OpenAI `developers.openai.com/codex/skills` / `openai/skills` / agentskills.io); no private or vault paths appear in committed text.

**MCP launcher contract — OQ-8 (US2)**

- **FR-005**: The decision document MUST specify the MCP launcher resolution contract as an ordered fallback: PATH-resolved installed binary → npx thin-installer fallback → success-shaped setup guidance when the binary is absent.
- **FR-006**: The absent-binary path MUST be specified to return success-shaped setup guidance and MUST NOT return an `isError` response, consistent with the errors-teach-abandonment doctrine.
- **FR-007**: The launcher contract MUST be validated hands-on from a plugin-scoped `mcpServers` entry on both hosts, including Windows PATH behavior, with the evidence recorded in the document.
- **FR-008**: The document MUST mark OQ-8 resolved in the PRD's terms; a full equal-weight launcher trade study is produced ONLY if hands-on validation falsifies the PRD hypothesis.

**npm-installer coexistence (US3)**

- **FR-009**: The decision document MUST define the channel-ownership rule: the plugin owns the config-writing role for every component its host format can carry, and the npm installer retains the binary-distribution role and covers per-component gaps.
- **FR-010**: The decision document MUST include a component × host ownership matrix stating, for each component (MCP server, prompt front-load hook, skills, agents) on each host (Claude Code, Codex), which single channel owns it.
- **FR-011**: The document MUST specify detection and dedupe behavior in BOTH directions (plugin-detects-installer and installer-detects-plugin) so that no duplicate MCP registration and no double hook injection occur.
- **FR-012**: The document MUST specify the uninstall interplay such that removing either channel leaves the other channel functional.

**Degraded Codex plugin (US4)**

- **FR-013**: If validation shows the Codex plugin format cannot carry every component, the document MUST specify a degraded Codex plugin that ships the supported subset, documents the asymmetry vs Claude Code, and assigns every unsupported component to the npm installer per the ownership matrix.

**Shipped-artifact plan and exemplar (US5)**

- **FR-014**: The decision document MUST enumerate the candidate skill and agent set, each with a tier decision (fully open vs built-in-only `disallowedTools` denials per the operator-owned tool-surface doctrine) and the trigger surface it targets.
- **FR-015**: Each enumerated artifact MUST carry a validation bar: a retrieval A/B on the Sonnet floor per the agent-eval methodology showing no regression versus the MCP-only baseline.
- **FR-016**: The artifact plan MUST require that shipped artifacts reference — never restate — `server-instructions.ts`, preserving it as the single source of agent-facing tool guidance (issue #529).
- **FR-017**: The decision document's appendix MUST contain exactly one fully-drafted exemplar artifact — the explore-flow workflow skill — and MUST NOT draft the body of any other candidate artifact.

**Scope, process, and done bar**

- **FR-018**: The spike MUST produce a docs/process surface only — 0 production LOC — committing approximately two files: the decision document (`docs/design/plugin-channel-decision.md`) and the roadmap status edit.
- **FR-019**: Scratch plugins and validation fixtures MUST NOT be committed; only their evidence lands in the decision document.
- **FR-020**: The document MUST close every scope area with an explicit decision, a public citation, and — where load-bearing — hands-on evidence, such that SPEC-026 can scaffold with zero further research; any timebox miss MUST be recorded as an explicit staged decision, never a silent gap.

### Reviewability Budget *(mandatory)*

- **Primary surface**: docs/process
- **Secondary surfaces, if any**: N/A
- **Projected reviewable LOC**: 0 (research spike — the decision document and roadmap status edit are prose/markdown, not reviewable production LOC)
- **Projected production files**: 0
- **Projected total files**: ~2 (`docs/design/plugin-channel-decision.md` created; `docs/ai/specs/intelligence-platform-technical-roadmap.md` status edited)
- **Budget result**: within budget (spike)
- **Split decision**: Remains one spec — a single docs/process surface with 0 production LOC, a research-only spike sized by a 2–3 day timebox rather than by LOC. The reviewability setup gate returned pass (0 LOC / 0 production files / 2 total files / 1 surface). No split warranted.

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order,
  scope budget, traceability, verification evidence, known gaps, and rollback
  or feature-flag notes.
- Traceability MUST map each major requirement or success criterion to changed
  files and verification evidence.
- Deferred work MUST name the follow-up spec or issue.

### Key Entities *(include if feature involves data)*

- **Plugin Channel Decision Document**: `docs/design/plugin-channel-decision.md` — the sole deliverable; holds the platform audit, launcher contract, ownership matrix, artifact plan, and exemplar appendix.
- **Platform Audit (per host)**: the cited and evidence-backed description of one host's plugin format (one for Claude Code, one for Codex).
- **MCP Launcher Contract**: the ordered binary-resolution rule (PATH-resolved binary → npx fallback → success-shaped guidance) that resolves OQ-8.
- **Component × Host Ownership Matrix**: the table assigning each component (MCP server, prompt front-load hook, skills, agents) on each host (Claude Code, Codex) to one owning channel (plugin vs npm installer).
- **Candidate Artifact Entry**: one enumerated skill or agent with its tier decision, targeted trigger surface, and validation bar.
- **Explore-flow Exemplar Skill**: the single fully-drafted artifact in the appendix; SPEC-026's authoring template.
- **Validation Evidence Block**: a recorded observation — pinned host version, exact repro command, quoted manifest snippet, and observed behavior.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the roadmap SPEC-025 scope bullets close in the decision document with an explicit decision.
- **SC-002**: 100% of load-bearing platform claims carry a public citation, and every load-bearing claim additionally carries a hands-on evidence block (pinned host version, repro command, observed behavior) or an explicit "could not validate" note.
- **SC-003**: OQ-8 is marked resolved in the PRD's terms — a reader can identify the chosen launcher contract from the document without any further research.
- **SC-004**: The component × host ownership matrix has a decided single owner for every cell (no blank or undecided cells).
- **SC-005**: Exactly one fully-drafted exemplar artifact (the explore-flow workflow skill) appears; every other candidate has a tier decision and a validation bar but no drafted body.
- **SC-006**: SPEC-026 can scaffold from the decision document with zero further platform research — the done bar, verifiable by SPEC-026 scaffolding requiring no new host investigation.
- **SC-007**: The committed change is docs/process only — 0 production LOC across approximately 2 files — and contains no committed scratch plugin or validation fixture.
- **SC-008**: The spike completes within the 2–3 day timebox, or any miss is recorded in the document as an explicit staged decision (no silent gap).

## Assumptions

- Both hosts (Claude Code and Codex CLI) expose a loadable plugin format that a throwaway scratch plugin can exercise locally on the maintainer's machine, making the Q1 hands-on validation feasible.
- The PRD OQ-8 recommendation (PATH-resolved installed binary → npx fallback → success-shaped guidance) is adopted as the working hypothesis to validate rather than re-opened as an equal-weight trade study; the trade study is produced only if validation falsifies it.
- Both vendors implement the same agent-skills open standard (`SKILL.md` plus optional `scripts/`/`references/`/`assets/`), so one skill source tree can serve both hosts; the artifact plan is written against that shared standard.
- The decision document lives at `docs/design/plugin-channel-decision.md` (roadmap Key Files); the exemplar skill is placed inside that document's appendix, keeping the spike docs-only so SPEC-026 lifts it into the real plugin tree.
- Host and version pinning for evidence is recorded at validation time in the document's evidence blocks; it is a validation-protocol detail, not a scoping decision to resolve in this spec.
- SPEC-026 implements the decisions; this spike ships no plugin and does not modify production code.

### Dependencies

- Depends on the public Anthropic and OpenAI plugin/skill documentation and example repositories being accessible for citation.
- Depends on local availability of both hosts (Claude Code and Codex CLI) for the hands-on validation.
- Depends on the existing npm installer and `server-instructions.ts` as the coexistence and reference baselines (neither is modified by this spike).
- Enables SPEC-026 (Plugin-Channel Distribution), which is blocked until this decision document lands.
