# Phase 0 Research: Plugin Platform Mechanics Spike (SPEC-025)

**Purpose.** This is the spike's **citation inventory** and prior-art record: the
public sources that will ground every load-bearing claim in
`docs/design/plugin-channel-decision.md` (FR-004, SC-002), the OQ-8 prior-art
hypothesis the validation protocol confirms or falsifies, the in-repo reference
surfaces SPEC-026 builds on (none modified by this spike), the shared skill-authoring
standard, and the disposition of every remaining unknown.

**Committed-text rule (FR-004).** Only public sources are cited in committed text — the
enumerated Anthropic and OpenAI docs/example repos plus `agentskills.io`, the public
Claude Code CHANGELOG, and public Codex issue/PR references. No private or vault path
appears in any committed file. The private skill-authoring PDF in the maintainer's
vault is **grounding-only** and is deliberately not cited.

---

## 1. OQ-8 prior-art hypothesis (the decision the spike validates)

- **Decision**: Adopt the PRD OQ-8 recommendation as the **working hypothesis to
  validate**, not an equal-weight trade study to re-open (design-concept Q2).
- **Hypothesis (verbatim intent, PRD OQ-8, `docs/prd-intelligence-platform.md`)**:
  MCP launcher resolution for the plugin channel = **PATH-resolved installed binary →
  `npx` thin-installer fallback → success-shaped setup guidance when absent** (never a
  hard error). The plugin cannot bundle the per-platform runtime, so the launcher must
  find the user-installed binary; absent-binary returns success-shaped guidance per the
  errors-teach-abandonment doctrine (PRD AC-25.2; roadmap SPEC-025 scope).
- **Rationale**: The PRD already weighed PATH-resolved binary vs npx thin-installer vs
  install-on-first-use prompt and recommends the ordered fallback; re-litigating a
  decided lean violates Simplicity First.
- **Alternatives considered** (recorded, not chosen): (a) a **full equal-weight launcher
  trade study** — produced **only if** hands-on validation falsifies the hypothesis
  (FR-008); (b) **PATH-only, no npx fallback** — avoids surprise network installs at the
  cost of first-run convenience.
- **Refinements the current spec layers on the hypothesis** (from three clarify
  sessions): the npx stage MUST use **`--offline`** (zero network requests; warm cache
  served locally; cache-miss fails catchably → guidance — `--prefer-offline` is
  insufficient because it still requests missing data); SHOULD **pin at least a major
  version** (`@colbymchenry/codegraph@^X`) per OWASP CICD-SEC-3 and the 2025–2026 npm
  "Shai-Hulud"-family latest-tag compromises, diverging deliberately from the unpinned
  `npx -y` MCP-reference pattern; and MUST **disclose** the ~50MB-per-platform-per-version
  cold-fetch weight (FR-005). Delivery is a **stub launcher** that always starts an
  MCP-speaking process and serves success-shaped guidance when the binary is unresolved
  — never a failed-to-spawn surface (FR-006).

---

## 2. Public citation inventory (grounds → claims)

Each row is a claim area, the public source class that grounds it, and the FR/SC it
serves. Exact URLs, doc titles, and pinned host versions are recorded in the decision
doc's evidence blocks at validation time (host/version pinning is a validation-protocol
detail, not a scoping decision — spec Assumptions).

| # | Claim area | Public source class | Grounds |
|---|---|---|---|
| C1 | Claude Code plugin format: manifest + component pointers, plugin-scoped `mcpServers`/`hooks`/`skills`/`agents`/`commands`, `${CLAUDE_PLUGIN_ROOT}`, marketplace + trust model, plugin-agent tool inheritance + `disallowedTools` | Anthropic Claude Code plugin documentation | FR-001, US1 |
| C2 | Claude Code host-arbitrated MCP dedup ("Plugin-provided MCP server deduplication": plugin server duplicating a manual/installer entry is suppressed, manual wins, shown in `/plugin`) | Public Claude Code CHANGELOG entry | FR-011 |
| C3 | Codex plugin format: `.codex-plugin/plugin.json` manifest + component pointers, bundled skills, hook surface (plugin `hooks/hooks.json`; standalone `.codex/hooks.json` / inline `config.toml` `[hooks]`), MCP registration, subagent support vs standalone `.codex/agents/*.toml`, project- + hook-hash trust gating | OpenAI Codex documentation (`developers.openai.com/codex/…`) | FR-002, US1 |
| C4 | Codex plugin-local `UserPromptSubmit` hook execution history: documented-but-not-executed window (issue #16430, filed 2026-04-01 vs v0.118.0), fixed by PR #19705 (merged 2026-04-28, initially flag-gated, later unconditional gated only by `plugins_enabled` default-on + one-time hook trust review) | Public Codex issue #16430 + PR #19705 | FR-010 |
| C5 | Codex named-agent invocation runtime-path dependence: reported to fail on `multi_agent_v2` (no `agent_type` parameter) while working on `multi_agent_v1` for some models | Public Codex issues #15250, #20077 | FR-013 |
| C6 | Shared agent-skills open standard: `SKILL.md` + optional `scripts/`/`references/`/`assets/`; progressive disclosure; MCP-enhancement skill category ("MCP is the kitchen, skills are the recipes"); what/when trigger-description discipline; kebab-case + exact-`SKILL.md` structure; `allowed-tools` (pre-approval, not restriction; Codex ignores it in `SKILL.md`); the skill-to-MCP dependency mechanism (qualified `ServerName:tool_name` body references on Anthropic / `agents/openai.yaml` `dependencies.tools` on Codex — the roadmap's `metadata.mcp-server` is NOT a documented Anthropic frontmatter field and is an audit output to correct, per FR-002); published skill success criteria (recommended measurements, not target numbers); OpenAI `.agents/skills` scan order + explicit `$skill-name`/implicit invocation + `agents/openai.yaml` sidecar | Anthropic skills docs + best-practices + the public skill-building guide ("The Complete Guide to Building Skills for Claude") + engineering blog + `anthropics/skills`; OpenAI `developers.openai.com/codex/skills` + `openai/skills`; `agentskills.io` | FR-014, FR-015, FR-016, FR-017, FR-022 |
| C7 | `npx --offline` semantics (zero network; warm-cache local serve; cache-miss catchable failure) vs `--prefer-offline` (still requests missing data) | npm CLI documentation | FR-005 |
| C8 | Supply-chain pinning guidance for the npx specifier (pin ≥ major, avoid floating latest) | OWASP CICD-SEC-3; public reporting on 2025–2026 npm "Shai-Hulud"-family latest-tag compromises | FR-005 |
| C9 | Windows `.cmd`-shim spawn refusal class (CVE-2024-27980) that already broke this binary once and was worked around by resolving an absolute `node.exe` in the npm shim | Public CVE-2024-27980 record + in-repo CHANGELOG #289 | FR-007 (Windows risk a) |

**SC-002 discipline** (adopted from SPEC-004's evidence schema): a bare link is not
evidence. Every load-bearing claim carries a public citation **and** a hands-on evidence
block (pinned host version + exact repro command + observed behavior), or an explicit
"could not validate" note stating the reason.

### 2a. Verified public-citation URL ledger (T002 — fetched & verified 2026-07-10)

Every source below was fetched on 2026-07-10 and resolves to a **public** page (no login,
no private/vault path). `✓ (308 → …)` = the canonical URL permanent-redirects to a target
that was itself fetched and loads. This ledger records exact URLs; per-evidence host/version
pinning still happens in the decision-doc evidence blocks at validation time.

| Ref | Public URL | Resolves | Resolved target / note |
|---|---|---|---|
| C1 | `https://code.claude.com/docs/en/plugins` | ✓ | "Create plugins". **Claude Code docs moved host** → now `code.claude.com/docs/en/` (off `docs.anthropic.com` / `docs.claude.com/en/docs/claude-code/`); cite the new host. Confirms `.claude-plugin/plugin.json`, plugin-root `skills/`/`agents/`/`hooks/`/`.mcp.json`/`.lsp.json`, marketplaces, `${CLAUDE_PLUGIN_ROOT}`, namespaced skills `/<plugin>:<skill>`. |
| C1 (namespacing) | `https://code.claude.com/docs/en/plugins-reference` | ✓ | "Plugins reference". **Grounds the consensus-added tool-namespacing claim**: scoped MCP tool name `mcp__plugin_<plugin>_<server>__<tool>` and hook `mcp_tool` server field `plugin:<plugin>:<server>`. |
| C1 (skills doc) | `https://code.claude.com/docs/en/skills` | ✓ | "Extend Claude with skills"; follows the agentskills.io standard + Claude-Code extensions (invocation control, subagent execution, dynamic context injection). |
| C1 (mcp doc) | `https://code.claude.com/docs/en/mcp` | ✓ | "Connect Claude Code to tools via MCP". |
| C2 | `https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md` | ✓ (page 200) | Blob view fails to render under automated fetch (JS error); raw file (`raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`, ~419 KB) is too large for a single-pass scan. Dedup entry confirmed by search: **v2.1.71** "Plugin-provided MCP server deduplication" — a plugin server duplicating a manually-configured server (same command/URL) is skipped; the manual entry always wins; among plugin servers the first-loaded wins; suppressed duplicates logged at debug. |
| C2 (corrob.) | `https://github.com/anthropics/claude-code/issues/32549` | ✓ (closed/not-planned) | The v2.1.71 dedup **regression** (same command/args, differing `env` falsely deduped) — corroborates the dedup mechanism for V6/T016. |
| C3 | `https://developers.openai.com/codex/plugins` | ✓ (308 → `learn.chatgpt.com/docs/plugins`) | Codex plugins doc; links to Build plugins. |
| C3 (build) | `https://developers.openai.com/codex/plugins/build` | ✓ (308 → `learn.chatgpt.com/docs/build-plugins`) | `.codex-plugin/plugin.json` manifest, `skills/`, repo/personal `marketplace.json`. |
| C3 (hooks) | `https://developers.openai.com/codex/hooks` | ✓ (308 → `learn.chatgpt.com/docs/hooks`) | Hook events incl. `UserPromptSubmit` + `hookSpecificOutput.additionalContext`; plugin `hooks/hooks.json` (overridable via `.codex-plugin/plugin.json` `hooks`) — also grounds C4 & T017. |
| C3 (subagents) | `https://developers.openai.com/codex/subagents` | ✓ (308 → `learn.chatgpt.com/docs/agent-configuration/subagents`) | `.codex/agents/*.toml`, spawn-agent, multi-agent runtime. |
| C4 | `https://github.com/openai/codex/issues/16430` | ✓ (open) | "Plugin docs/examples imply plugin-local hooks, but runtime only executes global hooks.json". |
| C4 | `https://github.com/openai/codex/pull/19705` | ✓ (merged PR) | "Discover hooks bundled with plugins" (`plugin_hooks` flag; discovers `hooks/hooks.json`). |
| C5 | `https://github.com/openai/codex/issues/15250` | ✓ (open) | "Custom subagents in .codex/agents are not accessible from tool-backed Codex sessions as docs imply". |
| C5 | `https://github.com/openai/codex/issues/20077` | ✓ (open) | "MultiAgentV2 spawn_agent defaults to full-history fork, rejecting agent_type/model overrides" — pins the `multi_agent_v1` vs `v2` runtime dependence (T021). |
| C6 | `https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview` | ✓ | Agent Skills overview: progressive disclosure; `name` ≤64 kebab-case, no XML, reserved "anthropic"/"claude"; `description` ≤1024. |
| C6 | `https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices` | ✓ | Authoring best-practices. **Grounds the FR-002 correction**: the skill→MCP dependency mechanism is qualified **`ServerName:tool_name` body references** (§"MCP tool references"), NOT a `metadata.mcp-server` frontmatter field. |
| C6 | `https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills` | ✓ | Engineering blog (pub. 2025-10-16). |
| C6 | `https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf` | ✓ | **Public** copy of "The Complete Guide to Building Skills for Claude" (no login; ~548 KB PDF). **FR-004: cite this URL — never the maintainer's local/vault PDF path.** |
| C6 | `https://github.com/anthropics/skills` | ✓ | Anthropic public skills repo (`./spec/`, `./template/`). |
| C6 | `https://agentskills.io` | ✓ | Agent Skills open standard (originally developed by Anthropic; org repo `github.com/agentskills/agentskills`). |
| C6 | `https://agentskills.io/specification` | ✓ | Format spec: frontmatter `name`/`description`/`license`/`compatibility`/`metadata`/`allowed-tools` (`allowed-tools` Experimental; `metadata` a generic string map) — confirms **no documented `mcp-server` frontmatter field**, seconding the C6/FR-002 correction. |
| C6 | `https://developers.openai.com/codex/skills` | ✓ (308 → `learn.chatgpt.com/docs/build-skills`) | Codex "Build skills": SKILL.md, `.agents/skills` scan order, `$skill-name` vs implicit invocation, `agents/openai.yaml` sidecar. |
| C6 | `https://github.com/openai/skills` | ✓ but **DEPRECATED** | Resolves but deprecated ("use the OpenAI Plugins repository"). **Fix → cite** `https://github.com/openai/plugins` (✓ live; curated Codex plugin/skill examples; `.codex-plugin/plugin.json`, `plugins/<name>/`, `.agents/plugins/marketplace.json`). |
| C7 | `https://docs.npmjs.com/cli/v10/using-npm/config` | ✓ | `offline` ("no network requests; missing data NOT fetched") vs `prefer-offline` ("bypasses staleness checks but still requests missing data"). |
| C8 | `https://owasp.org/www-project-top-10-ci-cd-security-risks/CICD-SEC-03-Dependency-Chain-Abuse` | ✓ | OWASP CICD-SEC-3: Dependency Chain Abuse. (The "Shai-Hulud"-family npm-compromise reporting in C8 stays a public-press source class, not a single pinned URL.) |
| C9 | `https://nvd.nist.gov/vuln/detail/CVE-2024-27980` | ✓ | Node.js Windows `.bat`/`.cmd` `child_process` argument injection (CWE-77; patched 18.20.2 / 20.12.2 / 21.7.3). |
| C9 (in-repo) | `CHANGELOG.md` #289 (line ~524) | ✓ (local, public via repo) | "Windows: … the launcher now invokes the bundled runtime directly instead of a `.cmd` file that modern Node refuses to spawn (#289)." No external URL. |
| +FR-019 | `https://github.com/anthropics/claude-code/issues/18692` | ✓ (closed/not-planned) | "`claude mcp add` expands env-var placeholders and writes resolved values to `.mcp.json`" — the secret-writeback exposure (b) T028 sweeps. |
| +FR-012 | `https://github.com/anthropics/claude-code/issues/72431` | ✓ (open) | "Claude cannot see failed/erroring MCP tools" — no visibility into configured-but-broken MCP; informs the plugin self-suppression → empty `tools/list` fallback (T020). |

**Dead / redirected URLs (with the fix):**

1. `github.com/openai/skills` is **deprecated** (still HTTP 200) → cite `github.com/openai/plugins` (current curated Codex plugin/skill examples).
2. `developers.openai.com/codex/*` **308 Permanent Redirect** → `learn.chatgpt.com/docs/*` (skills→`/docs/build-skills`, hooks→`/docs/hooks`, subagents→`/docs/agent-configuration/subagents`, plugins→`/docs/plugins`, plugins/build→`/docs/build-plugins`). Both forms resolve; the `developers.openai.com/codex/*` canonical is what OpenAI + agentskills.io publish — cite it and note the target.
3. Docs host moves (no dead links, cite current host): Claude Code docs → `code.claude.com/docs/en/`; Anthropic Agent Skills platform docs → `platform.claude.com/docs/en/`.
4. `github.com/anthropics/claude-code/blob/main/CHANGELOG.md` renders with a JS error under automated fetch (page is 200) and the raw file is too large for a single-pass scan; anchor the dedup citation on **v2.1.71** (or issue #32549).

**FR-004 private-path check:** research.md committed text contains **zero** private/vault paths. The maintainer's local guide PDF (Obsidian vault) is grounding-only; its **public** equivalent at `resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf` was verified publicly accessible and is the cited source in its place. Clean (SC-002).

---

## 3. In-repo reference surfaces (precedent; not modified by this spike)

The spike cites these as the coexistence/launcher baseline and SPEC-026's build-on
points. None is edited here (0 production LOC; the spike is additive-docs only).

| Surface | What it establishes for the decision |
|---|---|
| `scripts/mcp-dogfood.mjs` | Launcher precedent: a cross-platform **Node** launcher (no POSIX `sh`, so Windows clones work) reached via a `node -e` walk-up locator; anchors to the checkout root and spawns `node dist/bin/codegraph.js serve --mcp`. Informs the stub-launcher shape **and** the FR-006 runtime-self-sufficiency question (it assumes `node` is present — the plugin case must validate/record what each host guarantees). |
| `src/installer/targets/claude.ts` | How the installer writes Claude's MCP entry **and** the `UserPromptSubmit` prompt-hook today — the installer-detects-plugin / dedup baseline (FR-011) and the "entries the installer writes today vs new SPEC-026 capability" distinction. |
| `src/installer/targets/codex.ts` (+ `targets/toml.ts`) | How the installer writes Codex's `config.toml` MCP entry via the hand-rolled `[mcp_servers.codegraph]` TOML serializer (siblings preserved) — the Codex coexistence baseline and the `plugins.<plugin>.mcp_servers.<server>.enabled` user-side toggle context (FR-011). |
| `src/installer/targets/antigravity.ts` | In-repo precedent that **bare-name PATH resolution already failed for a GUI-launched host on macOS** and was fixed darwin-only — the reason Windows GUI-launched PATH is treated as unproven, not inherited (FR-007 Windows risk b). |
| `src/mcp/server-instructions.ts` | The single source of agent-facing tool guidance (#529). Every shipped artifact must **reference, never restate** it (FR-016); the exemplar demonstrates the reference pattern (FR-017). |
| `src/bin/node-version-check.ts` + `package.json` engines (`>=20 <25`) | The runtime-floor context for FR-006's runtime-self-sufficiency condition and the thin-installer shim the npx stage would invoke. |
| `CHANGELOG.md` #289 | The prior `.cmd`/CVE-2024-27980 incident for this binary (FR-007 Windows risk a). |
| `docs/design/web-framework-decision.md` (SPEC-004) | Genre template for the decision doc: executive recommendation, evidence schema with stable IDs, hard gates, traceability, review packet, and "prototype/scratch source stays outside durable tree" discipline. |

---

## 4. Skill-authoring grounding (shared open standard)

- **Decision**: Treat both hosts as implementing the **same agent-skills open standard**
  (`agentskills.io`): `SKILL.md` content + optional `scripts/`/`references/`/`assets/`
  transfers unchanged, so one skill source tree serves both hosts' skill bodies (spec
  Assumptions).
- **Does not transfer** (per-host divergences the US1 audit must enumerate):
  discovery-directory conventions, tool-permission frontmatter semantics, auto-invoke
  opt-out mechanisms, and invocation syntax (explicit `$skill-name` vs
  description-match).
- **Authoring principles carried into the artifact plan (FR-014) and exemplar (FR-017)**:
  progressive disclosure (frontmatter → body → linked references); the **MCP-enhancement
  category** ("MCP provides the kitchen, skills provide the recipes") — a skill encodes a
  repeatable multi-step recipe over a tool the agent already calls (`codegraph_explore`),
  not a new tool to learn; one focused job per skill; what/when trigger discipline;
  **reference-not-restate** `server-instructions.ts` (#529).
- **Trigger efficacy is unproven, not assumed** (spec Assumptions): skills sit in a
  higher-salience channel than the server-instructions steering this repo already tried
  and rejected, but no vendor publishes trigger-rate **benchmark numbers** (a target rate
  a skill must hit) and Anthropic's own guidance acknowledges Claude undertriggers skills.
  This is NOT a contradiction of the roadmap's "record the vendors' published skill success
  criteria": both vendors publish the recommended success-criteria *set to measure*
  (trigger rate on relevant queries, workflow tool-call count, zero failed tool calls,
  with/without comparison), which FR-015/FR-022 accordingly require the A/B bar to RECORD —
  what no vendor publishes is a *target number* to clear (see the spec.md Assumptions
  revision note). The FR-015 A/B bar is therefore a **real filter** — a candidate
  (including the exemplar) failing it is an acceptable, informative spike outcome, not a
  spike failure.

---

## 5. Unknowns — disposition (why zero `[NEEDS CLARIFICATION]`)

The design-concept Open Questions are the **spike's own research outputs**, resolved by
the hands-on validation protocol during Implement — not answerable at plan time and not
blocking clarifications. Recorded here as deferred-to-protocol-step:

| Design-concept open question | Disposition | Resolved by |
|---|---|---|
| The component × host support matrix cell values (what each host's plugin format can carry; the exact degraded-Codex subset) | Deferred to Implement — it is the spike's deliverable | Protocol V4, V7, V8, V10 → synthesized in V13 |
| Codex prompt-front-load equivalence (does a plugin-local `UserPromptSubmit`-class hook execute; is front-load installer-covered or absent) | Deferred to Implement — requires the pinned-version hands-on test | Protocol V8 (pinned Codex CLI build) |
| The exact candidate artifact list beyond the explore-flow exemplar; each one's tier | Deferred to Implement — enumeration is the deliverable (Q4 fixed depth, not list) | Protocol V16 (three-leg inclusion criterion) |
| Host/version pinning for evidence | Validation-protocol detail, recorded at validation time | Every evidence block (Decision-doc §2 schema) |

**Marker status: 0 `[NEEDS CLARIFICATION]`, 0 `TODO`.** The spec was sharpened by three
consensus-backed clarify sessions; the current spec text governs and leaves no
clarification open. The single decision the spike must make hands-on (the Claude dedup
lever (i) vs (ii), FR-011 / V6) is an explicit protocol step with a recorded outcome, not
an unresolved ambiguity.
