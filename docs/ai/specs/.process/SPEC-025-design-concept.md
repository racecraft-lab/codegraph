---
topic: "Plugin platform mechanics spike (Claude Code + Codex)"
slug: "spec-025-plugin-platform-spike"
date: "2026-07-09"
mode: "setup"
spec_id: "SPEC-025"
source_input:
  type: "topic"
  ref: "intelligence-platform-technical-roadmap.md § SPEC-025 scope"
question_count: 10
stop_reason: "natural"
---

# Design Concept: Plugin Platform Mechanics Spike (Claude Code + Codex)

> **Source:** `docs/ai/specs/intelligence-platform-technical-roadmap.md` § SPEC-025
> **Date:** 2026-07-09
> **Questions asked:** 10
> **Stop reason:** natural (all branches walked; no critical opens remaining)

## Goals

- Produce `docs/design/plugin-channel-decision.md` in which **every roadmap scope
  bullet closes with an explicit decision, a public citation, and — where
  load-bearing — hands-on evidence** from a scratch plugin actually loaded in both
  hosts (Q1, Q10). Bar: SPEC-026 can scaffold with zero further research.
- Resolve **OQ-8 by validating the PRD hypothesis** — PATH-resolved installed
  binary → npx thin-installer fallback → success-shaped setup guidance when
  absent — rather than re-opening an equal-weight trade study (Q2).
- Fix the **coexistence contract**: the plugin wins the agent-config-writing role
  (MCP registration, hook, skills, agents); npm keeps the binary-distribution
  role; the installer skips/offers-to-remove entries the plugin owns (Q3).
  Ownership is **per-component per host**: where a host's plugin format cannot
  carry a component, the npm installer covers the gap, and the decision doc ships
  a component × host ownership matrix (Q7).
- **Codex ships as a degraded plugin** if validation shows its format cannot carry
  every component: ship whatever subset the Codex plugin format supports and
  document the asymmetry (Q6), with the installer covering the missing components
  per the Q7 rule.
- Shipped-artifact plan **enumerates the candidate skill and agent set with
  per-artifact tier decisions and validation bars, plus one fully-drafted
  exemplar: the explore-flow workflow skill**, drafted in the decision doc's
  appendix as SPEC-026's authoring template (Q4, Q5).
- Spike is **timeboxed to 2–3 days** (Q8) and commits **evidence only** — the
  decision doc quotes manifest snippets, host versions, observed behavior, and
  exact repro commands; scratch plugins are never committed (Q9).

## Non-goals

- **Shipping anything** — SPEC-026 implements the decisions (roadmap out-of-scope;
  reaffirmed throughout).
- **Replacing or deprecating the npm installer** — Q3 explicitly keeps npm as the
  binary-distribution channel; the plugin takes only the config-writing role.
- **Committing scratch plugins or validation fixtures** — Q9 (evidence-only).
- **Drafting all candidate artifacts** — Q4 bounds drafting to the single
  explore-flow exemplar; all other candidates get enumeration + tier + validation
  bar only.
- **A full equal-weight launcher trade study** — Q2; the trade study re-opens only
  if hands-on validation falsifies the PRD hypothesis.
- **Upstream marketplace listing decisions beyond the racecraft channel**
  (roadmap out-of-scope).
- **Citing the private Obsidian vault PDF path in committed text** — committed
  spec/doc text cites public sources only (Anthropic skills docs/best-practices/
  engineering blog/`anthropics/skills`; OpenAI `developers.openai.com/codex/skills`/
  `openai/skills`/agentskills.io), per the maintainer's standing direction.

## Design Tree (Q&A log)

### Q1. How should SPEC-025 ground its decisions — documentation citations alone, or citations plus hands-on validation of the load-bearing mechanics (a scratch plugin actually loaded in Claude Code and Codex to confirm manifest fields, `${CLAUDE_PLUGIN_ROOT}` resolution, hook registration, and trust gating behave as documented)?

**Branch:** Research method / grounding

**Recommended answer:** Citations + hands-on validation
> Audit the official docs AND load a throwaway plugin in both hosts to
> empirically confirm the launcher contract, hook wiring, and coexistence
> mechanics. Prevents SPEC-026 from discovering the docs were stale
> mid-implementation — aligns with the constitution's evidence-over-vibes rule
> (Principle IV) and the grounding doctrine.

**Alternatives offered:**
- Citations only: faster pure docs audit; risk that fast-moving plugin docs ship a wrong decision into SPEC-026.
- Hands-on Claude only, citations for Codex: middle ground if Codex plugin support is hard to exercise locally.

**User's answer:** Citations + hands-on validation (Recommended)

---

### Q2. For the MCP launcher contract (OQ-8), should the spike adopt the PRD's recommendation (PATH-resolved installed binary → npx thin-installer fallback → success-shaped setup guidance when absent) as the working hypothesis to validate, or re-open all three options as an equal-weight trade study?

**Branch:** OQ-8 launcher contract

**Recommended answer:** Validate PRD hypothesis
> The PRD (`docs/prd-intelligence-platform.md` OQ-8) already weighed the options
> and recommends PATH → npx fallback → guidance. The spike's job is to
> empirically confirm it works from a plugin-scoped `mcpServers` entry on both
> hosts (incl. Windows PATH quirks) and only fall back to the trade study if
> validation falsifies it. Simplicity-first: don't re-litigate a decided lean.

**Alternatives offered:**
- Full equal-weight trade study: more rigorous-looking, slower, likely lands where the PRD already points.
- PATH-only, no npx fallback: avoids surprise network installs from an agent-config context at the cost of first-run convenience.

**User's answer:** Validate PRD hypothesis (Recommended)

---

### Q3. When both channels are present — the npm installer's MCP entry + UserPromptSubmit hook AND the plugin's registrations — which channel should win the config-writing role?

**Branch:** npm-installer coexistence

**Recommended answer:** Plugin wins config; npm keeps binary
> Frame the channels as complementary: npm distributes the runtime binary, the
> plugin distributes agent config (MCP registration, hook, skills, agents). When
> the plugin is detected, the installer skips/offers-to-remove its own MCP+hook
> entries; the plugin launcher still resolves the npm-installed binary per OQ-8.
> One owner per concern — no duplicate servers, clean uninstall story.

**Alternatives offered:**
- npm installer wins; plugin defers: preserves existing setups but leaves the plugin half-active and harder to reason about.
- Newest-write wins, both tolerated: least engineering; risks duplicate codegraph MCP servers and double prompt-hook front-loading.

**User's answer:** Plugin wins config; npm keeps binary (Recommended)

---

### Q4. How deep should the spike's shipped-artifact plan go on the candidate skills and agents — enumerate with tier decisions and validation bars only, or also draft the actual artifact content?

**Branch:** Shipped-artifact plan depth

**Recommended answer:** Enumerate + tiers + validation bar
> List each candidate skill/agent, its tier (fully open vs built-in-only
> denials), the trigger surface it targets, and the A/B validation bar — but
> write no SKILL.md/agent bodies; authoring is SPEC-026's implementation work.

**Alternatives offered:**
- Also draft one exemplar skill: everything above PLUS one fully-drafted exemplar as a concrete authoring template for SPEC-026; costs spike timebox but de-risks the authoring pattern once.
- Full drafts of all candidates: pulls SPEC-026's authoring work into the spike; breaks the spike boundary and file budget.

**User's answer:** Also draft one exemplar skill *(deviation from recommendation)*

**Notes:** Exemplar placement: the decision doc's appendix (assistant assumption
surfaced before Q5 and unchallenged) — keeps the spike docs-only; SPEC-026 lifts
it into the real plugin tree.

---

### Q5. Which candidate artifact should be the fully-drafted exemplar in the decision doc's appendix?

**Branch:** Shipped-artifact plan — exemplar choice

**Recommended answer:** Explore-flow workflow skill
> A skill teaching the host agent the codegraph_explore-first retrieval workflow
> (flow questions → one explore call with a symbol bag; treat returned source as
> Read). It's the MCP-enhancement category exactly ("MCP provides the kitchen,
> skills provide the recipes"), targets the tool agents already call, and its
> A/B validation bar is already defined in CLAUDE.md.

**Alternatives offered:**
- Structural-question trigger skill: simpler, but overlaps `server-instructions.ts` — higher risk of restating rather than referencing (#529).
- Pre-edit blast-radius agent: exercises the agent tier + disallowedTools doctrine, but agents are the rarer artifact class; a skill exemplar covers what SPEC-026 authors most.

**User's answer:** Explore-flow workflow skill (Recommended)

---

### Q6. If hands-on validation shows the Codex plugin channel is immature or can't carry a required component (e.g. hooks or MCP registration don't work as documented), what outcome should the decision doc record?

**Branch:** Codex viability / fallback posture

**Recommended answer:** Staged decision acceptable
> The doc may conclude "Claude Code plugin now; Codex plugin deferred with
> evidence," keeping Codex on the existing `codex.ts` installer path until the
> gap closes. Evidence-over-vibes: don't force a symmetric decision the platform
> can't support.

**Alternatives offered:**
- Both-or-neither: avoids a two-tier distribution story at the cost of delaying the whole channel on the slower vendor.
- Codex via degraded plugin: ship whatever subset the Codex plugin format supports and document the asymmetry; keeps one channel story but ships a half-plugin.

**User's answer:** Codex via degraded plugin *(deviation from recommendation)*

**Notes:** Maintainer prefers one channel story even if asymmetric. Follow-up
gap-coverage rule captured in Q7.

---

### Q7. On a host where the plugin can only carry a subset of components, how are the missing components provided?

**Branch:** Codex viability — gap coverage (follow-up to Q6)

**Recommended answer:** npm installer covers the gaps
> Per-component precedence: the plugin owns every component it can carry on that
> host; the existing installer target keeps writing only the components the
> plugin can't (e.g. `config.toml` MCP entry if plugin MCP registration fails
> validation). Q3's "plugin wins config" becomes per-component, and the decision
> doc ships a component × host ownership matrix.

**Alternatives offered:**
- Missing components just don't ship there: simpler ownership story, but Codex users could silently lose the MCP server or front-load context they get today.
- Decide per-component in the spike: maximum flexibility; leaves SPEC-026's coexistence logic underspecified until the doc lands.

**User's answer:** npm installer covers the gaps (Recommended)

---

### Q8. What timebox should bound the SPEC-025 spike?

**Branch:** Slice sizing — spike timebox

**Recommended answer:** 2–3 days
> Fits the enlarged scope: docs audit with citations (½–1d), scratch-plugin
> validation on both hosts (1d — the Codex side and Windows-adjacent launcher
> checks are where time goes), decision doc + exemplar skill draft (½–1d).

**Alternatives offered:**
- 1 day: realistic only with hands-on validation cut back — which Q1 chose against.
- 1 week: risks the spike absorbing SPEC-026 implementation energy.

**User's answer:** 2–3 days (Recommended)

---

### Q9. Should the scratch plugins used for hands-on validation be committed to the repo, or should only their evidence land in the decision doc?

**Branch:** Committed artifacts / repo hygiene

**Recommended answer:** Evidence-only, no fixtures committed
> The decision doc quotes the load-bearing evidence inline — manifest snippets,
> host versions, observed behavior, exact repro commands — and the scratch
> plugins stay outside the repo. Keeps the spike at its ~2-file budget and the
> repo free of dead throwaway code; SPEC-026 builds the real plugin fresh from
> the doc's contract.

**Alternatives offered:**
- Commit scratch plugins as fixtures: byte-for-byte re-runnable validation, but blows the file budget with code that ships nowhere and rots as both hosts evolve.

**User's answer:** Evidence-only, no fixtures committed (Recommended)

---

### Q10. What is the acceptance bar for the decision doc — when is SPEC-025 done?

**Branch:** Acceptance criteria / done bar

**Recommended answer:** Every bullet decided, cited, validated
> Each scope area (platform audit, skill-authoring grounding, launcher contract,
> coexistence matrix, artifact plan) closes with an explicit decision, a public
> citation, and — where load-bearing — hands-on evidence; OQ-8 marked resolved in
> the PRD's terms; exemplar drafted. Bar: SPEC-026 can scaffold with zero further
> research. Timebox misses become explicitly-recorded staged decisions, never
> silent gaps.

**Alternatives offered:**
- Core decided; edges may stay open: faster, but SPEC-026 inherits research debt — the exact thing a decision spike exists to prevent.

**User's answer:** Every bullet decided, cited, validated (Recommended)

## Slice Sizing (advisory)

The shared estimator (runner operation `estimate-spec-size`) is not registered in
the vendored speckit-pro runner 2.18.1 — treated as an **absent estimate** per the
grill-me protocol. Manual signals: SPIDR **Spike** (research-only), sized by
timebox (2–3 days, Q8) rather than LOC; 0 production LOC; ~2 committed files
(decision doc + roadmap status edit; exemplar lives inside the doc); single
docs/process surface. The reviewability setup gate returned **pass** (0 LOC /
0 production files / 2 total files / 1 surface). **No split warranted.**

## Open Questions

- **What:** The component × host support matrix values (which of MCP server,
  UserPromptSubmit-equivalent hook, skills, agents each host's plugin format can
  actually carry — and therefore the exact degraded-Codex subset per Q6/Q7).
  **Why deferred:** This is the spike's own research output — unanswerable before
  hands-on validation runs.
  **Suggested next step:** Resolved during the Implement phase's validation work;
  the matrix is a required section of `docs/design/plugin-channel-decision.md`.

- **What:** Codex prompt-front-load equivalence — whether Codex exposes any
  `UserPromptSubmit`-equivalent hook surface (`codex-hooks.json` semantics, hook-hash
  trust gating UX), and if not, whether front-loading on Codex is covered by the
  installer (per Q7) or simply absent.
  **Why deferred:** Requires the hands-on Codex validation to answer.
  **Suggested next step:** Seed a `/speckit-clarify` session focus; close with
  validation evidence in the decision doc.

- **What:** The exact candidate artifact list beyond the explore-flow exemplar
  (which other skills; whether any agent makes the v1 candidate set), and each
  one's tier decision.
  **Why deferred:** Enumeration is the spike's deliverable (Q4 fixed the *depth*,
  not the *list*).
  **Suggested next step:** Enumerate during Specify/Plan from the MCP tool surface
  + `server-instructions.ts` workflows; tier each per the operator-owned
  tool-surface doctrine.

- **What:** Host/version pinning for validation evidence (which Claude Code and
  Codex CLI versions the scratch-plugin runs are performed on).
  **Why deferred:** Detail of the validation protocol, not a scoping decision.
  **Suggested next step:** Record the exact versions in the decision doc's
  evidence blocks at validation time.

## Recommended Next Step

Setup mode — scaffolding has already happened. Proceed with
`/speckit-pro:speckit-autopilot docs/ai/specs/.process/SPEC-025-workflow.md`
from the `025-plugin-platform-spike` worktree once the workflow file is populated
and committed.
