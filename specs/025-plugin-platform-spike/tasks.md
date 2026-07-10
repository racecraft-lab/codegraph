---
description: "Task list for Plugin Platform Mechanics Spike (SPEC-025)"
---

# Tasks: Plugin Platform Mechanics Spike (Claude Code + Codex)

**Input**: Design documents from `/specs/025-plugin-platform-spike/`

**Prerequisites**: plan.md (validation protocol V1–V19 + 12-section decision-doc blueprint + 3-day timebox map), spec.md (US1–US5, FR-001…FR-021, SC-001…SC-008), research.md (public citation inventory + OQ-8 prior-art hypothesis)

**Tests**: This is a **research spike — 0 production LOC**. There are no code tests. The verification surface is the **hands-on validation protocol** (plan.md V1–V19): every load-bearing claim lands as a Validation Evidence Block (pinned host version, exact repro command, quoted manifest/config snippet, observed behavior) or an explicit "could not validate" note. Repo floor (`npm run build`, `npm test`) stays trivially green — the spike changes no code.

**Reviewability**: The spike's budget is **0 production LOC / 0 production files / ~2 total files / 1 docs surface**. T006 is the reviewability checkpoint. If any task would create a file under `src/`, commit a scratch plugin/fixture, or draft a second artifact body, STOP — it crosses a design-concept Non-goal (Q4/Q5/Q9).

**Organization**: Tasks are grouped by user story (US1 audit, US2 launcher/OQ-8, US3 coexistence, US4 degraded Codex, US5 artifact plan + exemplar). The **Claude-side** and **Codex-side** evidence tracks are independent and marked `[P]` until the synthesis tasks join them.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — independent host track / different scratch tree / different doc concern, no dependency on an incomplete task.
- **[Story]**: US1…US5 (user-story phases only; Setup/Foundational/Polish carry no story label).
- Every task names its target file (the decision doc + section, or the outside-repo scratch path) and the evidence it must produce.

## Deliverable surface (recap)

- **CREATED (committed)**: `docs/design/plugin-channel-decision.md` — the sole deliverable (12 sections per plan.md blueprint).
- **EDITED (committed)**: `docs/ai/specs/intelligence-platform-technical-roadmap.md` — SPEC-025 status only.
- **NEVER COMMITTED (evidence-only, FR-019 / Q9)**: scratch plugins built outside the repo tree, e.g. `/tmp/spec-025-plugin-research/{claude,codex}-scratch-plugin/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Stand up the deliverable skeleton and the public citation base every section rests on (plan Phase A / implementation-phase 1).

- [ ] T001 Create the decision-document skeleton at `docs/design/plugin-channel-decision.md` with the 12 section headers and each section's "done" bar from plan.md's blueprint (executive decision; evidence-block schema; Claude audit; Codex audit; launcher/OQ-8; ownership matrix; coexistence+uninstall; degraded-Codex; artifact plan; exemplar appendix; staged-decisions+close-out; traceability+PR packet) — no evidence yet. **Evidence**: skeleton committed with all 12 sections present.
- [ ] T002 [P] Fetch and verify the public citation set (V1) into the doc's citation base, extending `specs/025-plugin-platform-spike/research.md`'s C1–C9 inventory; confirm every citation resolves to an enumerated **public** source (Anthropic skills docs/best-practices/engineering blog/`anthropics/skills`; OpenAI `developers.openai.com/codex/skills`/`openai/skills`; `agentskills.io`; public Claude Code CHANGELOG; public Codex issue/PR refs; npm docs; OWASP CICD-SEC-3; CVE-2024-27980). **Evidence**: citation list captured, each with a resolvable public URL; zero private/vault paths (FR-004, SC-002).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The evidence schema and the two scratch plugins that BLOCK all hands-on validation (plan Phase B). No user-story evidence can be recorded until this phase completes.

**CRITICAL**: T003 fixes the evidence-block fields before any evidence is recorded; T004/T005 produce the scratch plugins every host observation loads.

- [ ] T003 Define and freeze the **Validation Evidence Block schema** in `docs/design/plugin-channel-decision.md` section 2 — fields `{ id, subject, host + pinned version, exact repro command, quoted manifest/config snippet, observed behavior, supported claim OR explicit "could not validate" note }`; launcher-chain evidence = one block **per stage per host** recording PATH scoping (login-shell vs GUI-inherited); embed the FR-019 secret-scrub rule (identity-preserving placeholder substitution, never deletion). **Evidence**: schema fields fixed and documented before any evidence block exists (FR-003, FR-019, SC-002).
- [ ] T004 [P] Author the scratch **Claude Code** plugin OUTSIDE the repo tree (V2): `.claude-plugin/plugin.json`, plugin-scoped `mcpServers` stub launcher, `hooks/hooks.json` `UserPromptSubmit`, a `skills/` body, an `agents/` stub. **Non-goal guard (Q9/FR-019)**: lives under a scratch path, NEVER committed. **Evidence**: plugin loads in Claude Code; path recorded for the evidence tracks (feeds T007/T010/T016/T018).
- [ ] T005 [P] Author the scratch **Codex** plugin OUTSIDE the repo tree (V3): `.codex-plugin/plugin.json`, bundled skill, hook surface (`hooks/hooks.json`), MCP registration, standalone `.codex/agents/*.toml`. **Non-goal guard (Q9/FR-019)**: scratch path, NEVER committed. **Evidence**: plugin loads in Codex; path recorded for the evidence tracks (feeds T008/T011/T017/T021).
- [ ] T006 Record the **reviewability checkpoint** in the decision doc's traceability notes: confirm 0 production LOC / 0 production files / ~2 total files / 1 docs surface, within the spike budget, no split (plan Reviewability Budget). **Evidence**: checkpoint statement recorded (FR-018).

**Checkpoint**: Schema frozen + both scratch plugins loadable → the Claude-track and Codex-track evidence work can proceed in parallel.

---

## Phase 3: User Story 1 - Platform audit of both plugin formats (Priority: P1) 🎯 MVP

**Goal**: Deliver the Claude Code and Codex platform-audit sections (doc sections 3–4), every load-bearing claim backed by a public citation and (where load-bearing) a hands-on evidence block.

**Independent Test**: Review the two audit sections — each load-bearing platform claim resolves to a public citation and an evidence block naming a pinned host version, an exact repro command, and the observed behavior (or an explicit "could not validate" note); no citation references a private/vault path. This is a viable minimal deliverable on its own.

- [ ] T007 [P] [US1] Record **Claude Code platform-audit evidence** (V4) into `docs/design/plugin-channel-decision.md` section 3: manifest + component pointers, plugin-scoped `mcpServers`/`hooks`/`skills`/`agents`/`commands`, `${CLAUDE_PLUGIN_ROOT}` resolution, marketplace + trust model, plugin-agent tool inheritance + `disallowedTools`. Scrub secrets at drafting (FR-019). **Evidence**: each load-bearing claim → public citation + ≥1 evidence block (quoted manifest snippet + pinned Claude Code version + repro command + observed behavior) (FR-001, FR-003).
- [ ] T008 [P] [US1] Record **Codex platform-audit evidence** (V7) into `docs/design/plugin-channel-decision.md` section 4, capability-first: `.codex-plugin/plugin.json` manifest + component pointers, bundled skills, hook surface (plugin `hooks/hooks.json`; standalone `.codex/hooks.json` / inline `config.toml` `[hooks]`), MCP registration, subagent-support distinction (plugin-bundled vs standalone `.codex/agents/*.toml` vs plugin-root `agents/` branding metadata), project- + hook-hash trust gating; correct exact artifact filenames to the observed evidence. Scrub secrets (FR-019). **Evidence**: each load-bearing claim → public citation + evidence block, OR an explicit "could not validate" note stating the reason (FR-002, FR-003).
- [ ] T009 [US1] Verify **no committed citation** in doc sections 3–4 references a private or vault path — all resolve to the enumerated public sources (join task; depends on T007+T008). **Evidence**: citation audit recorded clean (FR-004, US1 AS3, SC-002).

**Checkpoint**: US1 delivers a standalone, grounded platform-audit reference — the citation base US2–US5 build on.

---

## Phase 4: User Story 2 - Validated MCP launcher contract resolving OQ-8 (Priority: P2)

**Goal**: Deliver the launcher-contract section (doc section 5) with the ordered fallback validated hands-on and OQ-8 marked resolved in the PRD's terms.

**Independent Test**: Read the launcher-contract section — the ordered fallback (PATH-resolved binary → `npx --offline` thin-installer → success-shaped guidance) is fully specified, the absent-binary path is success-shaped (never `isError`), and OQ-8 is marked resolved with recorded validation evidence.

- [ ] T010 [P] [US2] Record **Claude launcher three-stage evidence** on macOS (V5) into `docs/design/plugin-channel-decision.md` section 5, one block per stage: (1) binary present on PATH → tools appear, recording GUI-launched PATH scoping (login-shell vs app-inherited); (2) binary absent + warm npm cache → `npx --offline` cache-first, server still comes up; (3) binary absent + offline/uncached → stub launcher returns success-shaped guidance, never `isError`/failed-spawn. Include the **stub-launcher runtime check** (FR-006): record the runtime Claude actually provides the subprocess — do NOT silently assume `node`. **Scrub (FR-019 exposure a)**: the binary-present stage validates against this repo's dogfood index whose launcher injects `.envrc.local` — redact any endpoint/key value. **Evidence**: 3 stage blocks + runtime finding (FR-005, FR-006, FR-007).
- [ ] T011 [P] [US2] Record **Codex launcher three-stage evidence** on macOS (V9) into doc section 5 — the same three stages (present / absent+warm-cache / absent+offline) on Codex, incl. the stub-launcher runtime check. Scrub secrets (FR-019). **Evidence**: 3 stage blocks + runtime finding for Codex (FR-005, FR-006, FR-007).
- [ ] T012 [US2] Attempt the **Windows (Parallels VM)** launcher three-stage on both hosts (V11), specifically probing risk (a) whether the host spawns the shipped Windows entry point (npm `.cmd` shim / `install.ps1`'s `codegraph.cmd`) without the CVE-2024-27980-class `.cmd` spawn refusal (CHANGELOG #289 — i.e. `shell:true`/shim resolution), and risk (b) whether bare-name PATH resolution succeeds for a GUI-launched host (Antigravity darwin-only precedent). Scrub PATH/env dumps (FR-019). **CANDIDATE STAGED DECISION (Q10/SC-008)**: attempt-first; staged-defer for SPEC-026's pre-ship gate ONLY after the attempt hits an evidenced blocker, naming what was attempted + the blocker — never decided in advance, never a silent gap. **Evidence**: per-stage blocks OR a named-blocker staged-deferral note (FR-007).
- [ ] T013 [US2] Attempt the **Linux (Docker)** launcher sequence where relevant (V12); scrub secrets (FR-019). **CANDIDATE STAGED DECISION (Q10/SC-008)**: attempt-first; staged-defer ONLY after an evidenced blocker (e.g. Docker unavailability). **Evidence**: launcher blocks OR a named-blocker staged-deferral note (FR-007).
- [ ] T014 [US2] Write the **launcher-contract prose** in doc section 5: the ordered fallback; the stub-launcher delivery mechanism (always starts an MCP-speaking process; stub serves success-shaped guidance when unresolved — never a failed-to-spawn surface); ANY-npx-stage-failure fall-through to the stub (offline cache-miss, corrupt/partial cache, npx/runtime unavailable, spawned-but-nonfunctional package); the guidance's install command framed as a **USER** action (never an agent auto-install, FR-021); the runtime-self-sufficiency condition; the `--offline`/major-version-pin/~50MB-per-platform disclosure and its OWASP CICD-SEC-3 + Principle VII reconciliation. **Evidence**: section closes FR-005/FR-006 bars with the T010/T011 evidence cited (FR-005, FR-006).
- [ ] T015 [US2] Mark **OQ-8 resolved in the PRD's terms** (V18) from the V5/V9 (± V11/V12) evidence; produce a full equal-weight launcher trade study ONLY if validation falsified the hypothesis — otherwise none. **Non-goal guard (Q2)**: do not re-open the trade study unless a validation task falsified the PRD hypothesis. **Evidence**: OQ-8 marked resolved (or, if falsified, a trade study) — a reader identifies the chosen contract with no further research (FR-008, SC-003).

**Checkpoint**: US2 resolves the single named open question (OQ-8) the spike exists for.

---

## Phase 5: User Story 3 - Coexistence ownership with a component × host matrix (Priority: P2)

**Goal**: Deliver the 8-cell ownership matrix (doc section 6) and the coexistence + uninstall interplay (doc section 7), both directions.

**Independent Test**: Consult the matrix and coexistence rules — every cell names exactly one owning channel (or explicitly-absent), and dedupe + uninstall behavior are stated in both directions (plugin-detects-installer; installer-detects-plugin).

- [ ] T016 [P] [US3] Record the **Claude host-dedup lever observation** (V6): reproduce the CHANGELOG "Plugin-provided MCP server deduplication" (a plugin-declared server duplicating a manually-configured/installer entry is suppressed, the manual entry wins, suppression shown in `/plugin`); **decide and record lever (i)** installer keeps its entry + host dedup suppresses the plugin copy **vs (ii)** installer defers so only the plugin copy remains. **Guard**: the plugin winning by default MUST NOT be assumed without this observation. **Evidence**: reproduced behavior block + the recorded (i)/(ii) decision (FR-011).
- [ ] T017 [P] [US3] Record the **Codex `UserPromptSubmit` hook test with a pinned CLI version** (V8): author a `hooks/hooks.json` `UserPromptSubmit` hook emitting `hookSpecificOutput.additionalContext`, install the plugin, complete the `/hooks` trust review, submit a prompt, confirm the injected context reaches the model. **Pin and record the installed Codex CLI version/build** (issue #16430 window; PR #19705). **Evidence**: a passing build records the prompt-front-load-hook × Codex matrix cell **plugin-owned**; a pre-fix/flag-gated-off build records **"absent on Codex"** — the recorded outcome + pinned build feed T019 (FR-010).
- [ ] T018 [US3] Record the **4-step near-duplicate scenario end-to-end** (FR-011) into doc section 7, using both scratch plugins + the installer: (1) install both channels with launcher commands that differ textually but resolve to the same binary; (2) confirm both connect and run healthy; (3) confirm two distinct namespaced tool sets (`mcp__plugin_<plugin>_<server>__<tool>` vs `mcp__<server>__<tool>`) appear on Claude Code, and both servers/hooks are live on Codex; (4) confirm nothing fires — no `/plugin` suppression notice on Claude Code, no duplicate-warning surface in Codex logs. **Evidence**: the four observations recorded before crediting the installer's next-invocation detection (per FR-012) as the reporter (FR-011).
- [ ] T019 [US3] Fill the **8-cell component × host ownership matrix** (V13) in doc section 6: for each cell — component (MCP server, prompt front-load hook, skills, agents) × host (Claude Code, Codex) — state can-carry? + exactly one of three decided owners (**plugin-owned** / **installer-owned** / **explicitly-absent**); reconcile the MCP-server × Claude cell with the T016 lever (owner = the channel whose entry is the active registration after host dedup); flag installer-gap cells as **new SPEC-026 capability** per FR-009. **Evidence**: every cell carries one decided outcome, none blank/undecided (FR-009, FR-010, SC-004).
- [ ] T020 [US3] Write the **coexistence + uninstall-interplay** prose (V14) in doc section 7: detection/dedupe in BOTH directions (plugin-detects-installer, installer-detects-plugin); the T016 Claude lever decision + the Codex levers (installer-detects-plugin + user-side `config.toml` `plugins.<plugin>.mcp_servers.<server>.enabled` toggle); the plugin-side self-suppression non-viability (exit-before-handshake → JSON-RPC -32000) with the completed-handshake empty `tools/list` fallback; invocation-driven uninstall restore on the next `codegraph install` re-run with no orphaned MCP entry or hook (each channel strips only its own; plugin-scoped removal is atomic) and the lever-(ii) zero-registered-server window stated; the diagnostic ownership for the evades-dedup both-present state (who detects/reports — the installer's next invocation-driven detection, per FR-012 — and the residual-window observable). **Evidence**: both directions stated; surviving-channel-functional, no-orphan, and who-reports-what all specified (FR-011, FR-012).

**Checkpoint**: US3 makes a marketplace install safe alongside an existing `npx @colbymchenry/codegraph` setup.

---

## Phase 6: User Story 4 - Degraded Codex plugin with the asymmetry documented (Priority: P3)

**Goal**: Deliver the degraded-Codex-subset section (doc section 8) — the cells the Codex plugin cannot carry, each reassigned per the matrix, asymmetry vs Claude Code documented, each degraded/absent cell observable-complete.

**Independent Test**: Read the Codex-viability decision — it specifies which components the Codex plugin ships, documents the asymmetry, assigns every unsupported component per the matrix, and states the DECIDED runtime observable for each degraded/absent cell.

- [ ] T021 [US4] Record the **Codex subagent runtime-path pinning** (V10): confirm installer-written `.codex/agents/*.toml` load in a tool-backed session; **pin the multi-agent runtime path (`multi_agent_v1` vs `multi_agent_v2`) and the model combination** — named-agent invocation is reported to fail on `multi_agent_v2` (no `agent_type`; #15250, #20077) while working on `multi_agent_v1` for some models, so a single successful load is insufficient unless it is on the runtime/model pairing CodeGraph actually ships against. **CANDIDATE STAGED DECISION (Q10/SC-008)**: staged-defer for SPEC-026 to confirm if the shipped pairing cannot be exercised in time, recording what was attempted. **Evidence**: load result + the pinned runtime/model pairing, OR a named-blocker staged-deferral note (FR-013).
- [ ] T022 [US4] Write the **degraded-Codex-subset** section (V15) in doc section 8: the matrix cells the Codex plugin format cannot carry, each reassigned to the npm installer per the matrix (a no-installer-coverage-today cell — e.g. the Codex prompt front-load hook — resolves to **new SPEC-026 capability** or **explicitly-absent**, decided on the T017 pinned-build evidence, never force-assigned); the **agents** cell recorded as new SPEC-026 installer capability gated on the T021 pinned-pairing confirmation; the asymmetry vs Claude Code documented; and each degraded/absent cell's **DECIDED runtime user-observable** (installer-covered = functionally equivalent, no degraded signal; explicitly-absent = a decided silent-by-design outcome or a specific surfaced note). **Evidence**: subset named; each unsupported cell assigned per the matrix; each degraded/absent cell observable-complete, not merely ownership-complete (FR-013).

**Checkpoint**: US4 preserves a single-channel story for Codex while honoring evidence over forced symmetry.

---

## Phase 7: User Story 5 - Shipped-artifact plan with per-artifact tiers and one exemplar (Priority: P3)

**Goal**: Deliver the shipped-artifact plan (doc section 9) and the ONE fully-drafted explore-flow exemplar (doc section 10 appendix).

**Independent Test**: Review the artifact-plan section + appendix — each candidate carries a tier decision and an A/B validation bar, exactly one exemplar is fully drafted, and the plan requires artifacts to reference rather than restate `server-instructions.ts`.

- [ ] T023 [US5] Write the **shipped-artifact plan** (V16) in doc section 9: enumerate the candidate skill/agent set applying the three-leg inclusion criterion (rides `codegraph_explore` the agent already calls; adds guidance not in `server-instructions.ts` #529; expected to clear the FR-015 bar — workflows failing any leg recorded as considered-and-excluded with the reason); per-artifact **tier decision** (default FULLY OPEN for workflow/authoring skills retaining Edit/Write; built-in-only `disallowed-tools` denylists for read-only/review artifacts; never deny or re-expose the codegraph MCP tools — operator-controlled server-side; `context: fork` to a restricted subagent where a constraint must outlast the turn); the trigger surface each targets; the **agent class evaluated separately** (recording whether any agent qualifies for v1; `retrieval-guardian` excluded — reviews CodeGraph's own source, inapplicable to a user repo); the **FR-015 A/B bar definition** (artifact-off vs artifact-on: baseline = plugin MCP server with the candidate absent, treatment = same server + artifact loaded; both arms `--model sonnet --effort high`, ≥2 runs/arm, wall-clock + tool-call + Read/Grep + control repo; pass = no regression); and the **FR-016 reference-not-restate line item** per candidate. **Evidence**: each candidate has a tier + a validation bar; excluded workflows recorded with reasons (FR-014, FR-015, FR-016).
- [ ] T024 [US5] Draft the **ONE explore-flow exemplar skill body** (V17) in doc section 10 (the appendix) — a fully-drafted `SKILL.md`-shaped artifact that **references, never restates** `server-instructions.ts` (#529) and encodes the explore-flow retrieval recipe over `codegraph_explore`. **Non-goal guard (Q4/Q5)**: exactly one exemplar; draft NO other candidate artifact body. **Evidence**: exactly one exemplar present, no second body (FR-017, FR-016, SC-005).

**Checkpoint**: US5 turns "ship skills and agents" into a concrete gated list SPEC-026 authors against, with the authoring pattern de-risked once.

---

## Phase 8: Polish & Close-out (Doc Assembly + Cross-Cutting)

**Purpose**: Assemble the framing + close-out sections, sweep evidence for secrets, affirm parity, and make the roadmap status edit (plan Phase F tail / implementation-phase 5).

- [ ] T025 Write the **executive-decision + scope/non-goals** section (doc section 1): the headline decisions (validate PRD OQ-8; plugin-wins-config / npm-keeps-binary; degraded-Codex if needed; skills-first artifact set) with **every roadmap SPEC-025 scope bullet closed by an explicit decision**. **Evidence**: 100% of scope bullets appear with a decision (FR-020, SC-001).
- [ ] T026 Write the **staged-decisions + close-out** section (V19) in doc section 11: any timebox miss recorded as an explicit **attempt-first** staged decision naming what was attempted + the specific evidenced blocker (no silent gap); collect the T012/T013/T021 candidate deferrals if triggered; run the **SC-001…SC-008 done-bar** checklist. **Evidence**: zero silent gaps; done-bar recorded (FR-020, SC-006, SC-008).
- [ ] T027 Write the **traceability + PR-review-packet** section (doc section 12): map each FR/SC → doc section → evidence block; fill the PR packet fields (what changed, why, non-goals, review order 1→12, scope budget, traceability, verification evidence, known gaps, rollback/flag notes) per plan's PR Review Packet Source. **Evidence**: FR/SC → section → evidence map complete; SPEC-026 can scaffold with zero further platform research (SC-006).
- [ ] T028 **Final secret-scrub sweep** across all four Validation Evidence Block classes (pinned host version, exact repro command, quoted manifest/config snippet, observed-behavior transcript) in the committed `docs/design/plugin-channel-decision.md` (FR-019): verify no `CODEGRAPH_EMBEDDING_API_KEY`, raw private embedding endpoint, its scheme+host+port-redacted form, or any other `.envrc.local` value survives; check the four known exposure points — (a) the dogfood-index binary-present launcher stage, (b) `claude mcp add` `${VAR}` write-back into `.mcp.json` (anthropics/claude-code#18692), (c) `codegraph status` endpoint printing, (d) the plaintext-http embedding warning — and confirm identity-preserving placeholders (`<REDACTED:…>` / unresolved `${VAR}`) are used, never line deletion. **Evidence**: sweep recorded clean across all four classes and four exposure points (FR-019, SC-007).
- [ ] T029 Affirm **plugin-channel network/telemetry parity** (FR-021) in doc section 5 (or its own affirmation block): no plugin component (stub launcher, prompt hook, bundled skills, bundled agents) adds phone-home/egress/telemetry/auto-install beyond the npm channel; the exec'd `codegraph` binary's posture is byte-identical (same `codegraph telemetry off` / `CODEGRAPH_TELEMETRY=0` / `DO_NOT_TRACK=1` opt-outs, same Principle VII rule); the stub launcher's pre-exec path (binary discovery, PATH resolution, npx-fallback logic) performs no independent network/telemetry/auto-install action; any net-new surface found in validation recorded as an explicit SPEC-026 finding. **Evidence**: parity affirmation recorded, with any net-new surface flagged (FR-021).
- [ ] T030 Make the **roadmap SPEC-025 status edit** in `docs/ai/specs/intelligence-platform-technical-roadmap.md` (the ~2nd committed file); confirm the total committed change is **docs/process only** — ~2 files, 0 production LOC, no committed scratch plugin or validation fixture. **Evidence**: roadmap status updated; commit surface verified within budget (FR-018, SC-007).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately. T002 grounds every downstream citation.
- **Foundational (Phase 2)**: depends on Setup. T003 (evidence schema) and T004/T005 (scratch plugins) BLOCK all user-story evidence tasks.
- **User Stories (Phases 3–7)**: all depend on Foundational.
  - **US1 (P1, MVP)** is the citation base US2–US5 rest on.
  - **US2 (P2)** builds on US1; **US3 (P2)** builds on US1.
  - **US4 (P3)** depends on US1 + the US3 matrix (T019) + the T017 pinned-build outcome.
  - **US5 (P3)** consumes US1 (audit), US2 (launcher), US3 (ownership).
- **Polish (Phase 8)**: depends on all desired user stories; T028 (scrub) and T030 (roadmap edit + budget check) run last.

### Within each user story

- Evidence-gathering tasks precede the synthesis/writing tasks that consume them (e.g. T016 → T019/T020; T017 → T019/T022; T010/T011 → T014; T021 → T022).
- Scratch-plugin authoring (T004/T005) precedes every host observation that loads it.

### Cross-story evidence dependencies (feed-forward)

- T017 (Codex hook test, pinned build) → T019 (matrix prompt-hook × Codex cell) → T022 (degraded-Codex observable).
- T016 (Claude dedup lever) → T019 (MCP × Claude cell) + T020 (coexistence).
- T010/T011 (launcher stages) → T014 (launcher prose) → T015 (OQ-8 resolution).

---

## Parallel Opportunities — the two independent host tracks

The Claude-side and Codex-side evidence tracks are independent until the synthesis tasks join them. `[P]` pairs (safe to run concurrently / by two operators):

- **Setup**: T002 [P] alongside T001.
- **Foundational**: T004 [P] (Claude plugin) alongside T005 [P] (Codex plugin).
- **US1 audit**: T007 [P] (Claude) alongside T008 [P] (Codex) — joined by T009.
- **US2 launcher (macOS)**: T010 [P] (Claude) alongside T011 [P] (Codex) — joined by T014.
- **US3 coexistence**: T016 [P] (Claude dedup lever) alongside T017 [P] (Codex hook test) — joined by T019/T020.

Cross-platform launcher attempts (T012 Windows, T013 Linux) and all synthesis/doc-assembly tasks are sequential joins, not `[P]`.

```text
# Claude-side track (one operator):   T004 → T007 → T010 → T016
# Codex-side  track (other operator): T005 → T008 → T011 → T017
# Both tracks converge at the synthesis tasks (T009, T014, T019, T020).
```

---

## Timebox alignment (2–3 days, per plan.md)

| Day | Tasks | Focus |
|---|---|---|
| **Day 1** | T001, T002, T003, T004, T005, T006, T007, T010, T016 | Setup + foundational; full Claude-track hands-on (audit, launcher three-stage, dedup lever) — plan V1–V6. |
| **Day 2** | T008, T011, T017, T021, T012, T013 | Full Codex-track hands-on (audit, pinned-version hook test, launcher three-stage, subagent v1/v2 pinning); then the Windows (Parallels) + Linux (Docker) launcher **attempts** — the risk-heavy day; plan V7–V12. |
| **Day 3** | T009, T014, T015, T018, T019, T020, T022, T023, T024, T025, T026, T027, T028, T029, T030 | Synthesis + doc assembly: matrix, coexistence, degraded-Codex, artifact plan, the one exemplar, OQ-8 marker, scrub sweep, parity affirmation, done-bar + roadmap edit — plan V13–V19. |

**Non-deferrable core (must land in-timebox)**: T010, T011 (macOS launcher both hosts), T016 (Claude lever), T017 (Codex pinned-version hook test), T019 (8-cell matrix), T020 (coexistence both directions), T023 (artifact plan), T024 (the one exemplar).

**Candidate staged-decision tasks (attempt-first release valves, per Q10/SC-008)**: **T012** (Windows/V11), **T013** (Linux/V12), **T021** (Codex subagent v1/v2 pairing/V10) — each defers to SPEC-026's pre-ship gate ONLY after an attempt hits a named, evidenced blocker; **T017's** outcome is a *decision*, not a deferral (a pre-fix/flag-gated-off build records "absent on Codex" directly).

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Complete Phase 1 (Setup) + Phase 2 (Foundational).
2. Complete Phase 3 (US1 audit) — both tracks.
3. **STOP and VALIDATE**: the two audit sections resolve every load-bearing claim to a public citation + evidence block. This is already a viable, grounded deliverable that prevents SPEC-026 from discovering stale docs mid-implementation.

### Incremental delivery

1. Setup + Foundational → schema frozen, both scratch plugins loadable.
2. US1 (audit) → grounded citation base (MVP).
3. US2 (launcher/OQ-8) → the named open question resolved.
4. US3 (coexistence) → marketplace install safe alongside the installer.
5. US4 (degraded Codex) → single-channel Codex story, asymmetry documented.
6. US5 (artifact plan + exemplar) → gated authoring list + one drafted exemplar.
7. Polish → framing, scrub, parity, roadmap edit.

### Parallel team strategy (two operators)

- Operator A runs the Claude track (T004→T007→T010→T016); Operator B runs the Codex track (T005→T008→T011→T017).
- Both converge on the synthesis tasks (T009, T014, T015, T018–T020, T022–T030).

---

## Notes

- **This is a 0-LOC research spike.** No task creates a file under `src/`, commits a scratch plugin/fixture (Q9/FR-019), drafts a second artifact body (Q4/Q5/FR-017), or re-opens the launcher trade study unless a validation task falsified the PRD hypothesis (Q2/FR-008). Total committed output stays ~2 files: `docs/design/plugin-channel-decision.md` + the roadmap status edit.
- `[P]` = independent host track / different scratch tree / different doc concern — not code files.
- Every evidence task scrubs secrets **at drafting time** (FR-019); T028 is the final verification sweep.
- Every load-bearing claim carries a public citation + a hands-on evidence block, or an explicit "could not validate" note — evidence over vibes (Constitution IV).
- Any timebox miss is an explicit attempt-first staged decision naming the evidenced blocker, never a silent gap (SC-008).
