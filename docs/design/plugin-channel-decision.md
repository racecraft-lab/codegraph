# SPEC-025 Plugin Channel Decision

Status: **Complete — decisions final.** All 12 sections are populated and every roadmap
SPEC-025 scope bullet closes with an explicit decision (§1), a public citation, and — where
load-bearing — a hands-on Validation Evidence Block conforming to the frozen §2 schema (or an
explicit "could not validate" note). Hands-on evidence is pinned to **Claude Code 2.1.206** and
**Codex CLI 0.144.0** (macOS) plus a Linux/Docker launcher pass. The four attempt-first staged
decisions (§11.1 — the Windows launcher three-stage, the Codex subagent v2 config-fidelity, the
Codex prompt-hook model-reach leg, and the interactive-only host-UI confirmations) are the
complete set of outstanding validation legs, each routed to SPEC-026's pre-ship gate with an
exact repro step — **zero silent gaps** (SC-008). SPEC-026 can scaffold from this document with
zero further platform research (SC-006). The final polish tasks are complete (no decision
above changed): the secret-scrub verification sweep (T028) recorded CLEAN in §12.1, the
network/telemetry parity affirmation (T029) recorded in §5.H, and the roadmap SPEC-025 status
edit (T030) applied.

This document is the sole deliverable of SPEC-025 (per
[`plan.md`](../../specs/025-plugin-platform-spike/plan.md)): a grounded,
citation-backed decision record so SPEC-026 can scaffold the Claude Code + Codex
plugin channel with **zero further platform research**. Genre precedent:
[`docs/design/web-framework-decision.md`](./web-framework-decision.md) (SPEC-004).

**Review order = section order (1 → 12).** Each section names the user story /
functional requirements it closes and the validation bar that makes it "done." Every
load-bearing claim in a drafted section carries a public citation (FR-004) and, where
load-bearing, a hands-on **Validation Evidence Block** conforming to the frozen §2
schema — or an explicit "could not validate" note (FR-003). Scratch plugins are built
outside the repo tree and never committed (FR-018/FR-019); only their scrubbed
evidence lands here.

---

## 1. Executive decision + scope/non-goals

_Closes: framing for SC-001 — the US1–US5 headline decisions (validate the PRD OQ-8
hypothesis; plugin-wins-config / npm-keeps-binary; degraded-Codex if needed;
skills-first artifact set)._

> **Done bar.** Every roadmap SPEC-025 scope bullet appears with an explicit decision.

_Status: **drafted (T025).** All five roadmap SPEC-025 scope areas close below with an explicit
decision and a pointer to the section that grounds it; the non-goals restate what this spike
deliberately does not do. Every load-bearing decision is backed in its home section by a public
citation and a hands-on evidence block (or an explicit "could not validate" note)._

**The one-paragraph decision.** Package CodeGraph as first-class Claude Code **and** Codex
plugins carrying the MCP server, the prompt front-load hook, and skills — with the **npm
installer keeping the binary-distribution role** and covering the one component the Codex plugin
format cannot carry (agents). The **plugin owns config-writing** for every component its host
format can carry; the installer keeps the binary and the cross-channel reconciliation. The MCP
launcher resolves the user-installed binary with a **PATH-resolved binary → `npx --offline`
thin-installer → success-shaped stub guidance** fallback (OQ-8, confirmed and adopted). v1 ships
**skills-first** — one workflow skill survives the inclusion criterion and no agent qualifies
yet. **Nothing ships in this spike: SPEC-026 implements every decision below.**

### 1.1 Scope-bullet closure (SC-001 / FR-020) — every roadmap SPEC-025 scope bullet, decided

The five roadmap SPEC-025 scope bullets (roadmap § SPEC-025 "Scope") — the same five scope areas
the Q10 done bar names (platform audit, skill-authoring grounding, launcher contract, coexistence
matrix, artifact plan) — each close here with an explicit decision:

| # | Roadmap scope bullet | Decision (headline) | Closed in |
|---|---|---|---|
| 1 | **Platform audit with citations** (Claude Code + Codex plugin formats) | **DONE — both hosts audited capability-first**, every load-bearing claim carrying a public citation + a hands-on evidence block, pinned to **Claude Code 2.1.206** and **Codex CLI 0.144.0**. Audit corrections recorded to the evidence (Claude MCP declared via the `.mcp.json` file form + the top-level `hooks` wrapper; Codex manifest confirmed `.codex-plugin/plugin.json` with **no** `agents` component pointer). | §3, §4 |
| 2 | **Skill-authoring grounding** (shared standard + Anthropic + OpenAI guidance) | **DONE — a decided, citation-backed authoring standard** (public S1–S10): the shared `SKILL.md` open standard + the four per-host divergences; Anthropic progressive disclosure / MCP-enhancement category / trigger discipline / structural+security rules / `allowed-tools`; OpenAI `.agents/skills` scan order / explicit-vs-implicit invocation / `agents/openai.yaml` sidecar. **Audit correction (FR-002):** the roadmap's `metadata.mcp-server` frontmatter field is corrected to a qualified `ServerName:tool_name` **body** reference (Codex: the `openai.yaml` `dependencies.tools` sidecar). | §9.1 |
| 3 | **MCP launcher contract (OQ-8)** | **RESOLVED — the PRD ordered fallback ADOPTED as specified**, hypothesis **not** falsified (no trade study, Q2): PATH-resolved binary → `npx --offline` thin-installer → success-shaped stub guidance (never `isError`). Two evidence-backed **refinements**: (1) the GUI-inherited PATH does not carry bare-name `codegraph` → resolve via login-shell/absolute path; (2) `npx --offline` covers only the npm-shim hop — the ~50 MB GitHub-Releases bundle is a **second** hop, so full offline needs the npm cache **and** the bundle on disk, else stage 2 falls through to the stage-3 stub. | §5 |
| 4 | **npm-installer coexistence rules** (both directions, uninstall, who-wins) | **DECIDED — lever (i)**: the installer **keeps** its MCP entry and the plugin copy is the redundant one; **realized by installer-side FR-012 detection**, not host dedup (the two channels' launcher commands always differ textually, so host dedup does not fire — validated hands-on). Detection/dedupe stated in both directions; invocation-driven uninstall restore with no orphaned entry; plugin-side self-suppression ruled **non-viable** (JSON-RPC −32000). | §6, §7 |
| 5 | **Shipped-artifact plan** (candidate set, per-artifact tier, validation bar) | **DECIDED — skills-first.** Exactly one candidate (explore-flow, **K1**) survives the three-leg inclusion criterion; K2–K5 are considered-and-excluded (they restate #529). **v1 ships skills-only — no agent qualifies** (`retrieval-guardian` inapplicable to a user repo; cross-host agent inconsistency + the low-salience anti-pattern). Per-artifact tier (K1 = fully open) + the FR-015 A/B bar (a third comparison mode, Sonnet floor, published-criteria leg) defined; reference-not-restate (#529) per candidate; exactly **one** exemplar drafted (§10). | §9, §10 |

**The 8-cell ownership matrix (scope bullet 4's "who-wins" table) — all decided, none blank
(SC-004):** MCP × Claude = **installer-owned** (lever i); MCP × Codex, prompt-hook × both hosts,
skills × both hosts, and agents × Claude = **plugin-owned**; agents × Codex = **installer-owned
(new SPEC-026 capability)**. Full table + the lever reconciliation are in §6.

### 1.2 Headline decisions (the US1–US5 spine)

1. **Platform audit (US1).** Both plugin formats are real and loadable; the audit is grounded in
   public citations + hands-on evidence against pinned builds (§3 Claude, §4 Codex).
2. **Launcher / OQ-8 (US2).** The PRD's ordered fallback is **confirmed and adopted** with two
   refinements; no trade study (§5). The absent-binary path is **success-shaped guidance, never
   `isError`** (errors-teach-abandonment), and the install command is a **USER** action, never an
   agent auto-install (FR-021).
3. **Coexistence + ownership (US3).** **Plugin-wins-config / npm-keeps-binary**, with the single
   host-deduplicated cell (MCP × Claude) reconciled to **installer-owned** so the matrix owner
   (FR-010) and the coexistence lever (FR-011) never disagree. Both-directions detection/dedupe,
   invocation-driven uninstall restore, no orphans (§6, §7).
4. **Degraded-Codex (US4).** **Minimally degraded — exactly one cell (agents × Codex).** The
   predicted casualty — the Codex prompt hook — is **NOT** absent: it is plugin-owned,
   version-gated **ON** at Codex ≥ 0.144.0 (§4.8/§8). Agents × Codex is installer-owned (new
   capability), gated on the T021 v2 config-fidelity staged deferral; every degraded/absent cell
   is observable-complete (§8).
5. **Skill-authoring + artifact set (US5).** A decided authoring standard (§9.1) + a
   **skills-first** gated candidate list (§9.2–§9.7) + exactly **one** fully-drafted exemplar
   (§10).

### 1.3 Scope + non-goals

**In scope:** this decision document (12 sections) + a one-line roadmap SPEC-025 status edit —
docs/process only, **0 production LOC** (§12.1).

**Non-goals** (design-concept § Non-goals; roadmap § Out of Scope — reaffirmed):

- **Shipping anything.** SPEC-026 implements every decision here; this spike changes no
  production code and ships no plugin.
- **Replacing or deprecating the npm installer** (Q3). npm keeps the binary-distribution role;
  the plugin takes only the config-writing role.
- **Committing scratch plugins or validation fixtures** (Q9 / FR-019). Only their scrubbed
  evidence lands here; the plugins live outside the repo tree and are never committed.
- **Drafting all candidate artifacts** (Q4 / FR-017). Exactly one exemplar (explore-flow) is
  drafted; every other candidate gets enumeration + tier + validation bar only.
- **A full equal-weight launcher trade study** (Q2 / FR-008). Produced only if hands-on
  validation falsified the PRD hypothesis — it did not, so none is produced (§5.G).
- **Upstream marketplace listing decisions beyond the racecraft channel** (roadmap out-of-scope).
- **Citing the private Obsidian-vault skill PDF** — committed text cites public sources only
  (FR-004); the public `resources.anthropic.com` PDF (S5) is cited in its place.

---

## 2. Validation Evidence Block schema

_Closes: US1 Independent Test, SC-002. This section is **frozen** (T003): the fields
below are fixed **before any evidence block is recorded**, so every hands-on claim in
§§3–11 uses exactly this shape and passes exactly this scrub bar._

> **Done bar.** Schema fields fixed before any evidence is recorded; no
> credential/endpoint value in committed text.

A **Validation Evidence Block** is the reusable unit every hands-on claim in this
document cites. It records one observation against a scratch plugin (built outside the
repo tree, never committed — FR-019) loaded in a real host. A load-bearing claim that
has no such block, and no explicit "could not validate" note, is not done.

### 2.1 Fields (frozen)

Every block MUST carry all seven fields. A field that genuinely does not apply is
recorded as `n/a` with a one-clause reason — never left blank.

| # | Field | Required content |
|---|-------|------------------|
| 1 | **id** | Stable local identifier so other sections and the §12 traceability map can reference the block. Namespaced by concern, e.g. `CC-MANIFEST-001` (Claude audit), `CX-HOOK-001` (Codex audit), `LX-CC-STAGE2-001` (launcher, Claude Code, stage 2), `DEDUP-CC-001` (coexistence), `AGENTS-CX-001` (degraded Codex). |
| 2 | **subject** | What the block observes — the exact manifest field, hook, launcher stage, dedup surface, or runtime path under test. |
| 3 | **host + pinned version** | Which host (Claude Code or Codex CLI) **and** the exact pinned build/version string the observation was made on. Named as one field because a claim is only as good as the build it was seen on (e.g. the Codex `UserPromptSubmit` hook cell turns on the pinned CLI build — FR-010). |
| 4 | **exact repro command** | The precise command(s) run to force the observed condition — copy-pasteable, not paraphrased. |
| 5 | **quoted manifest/config snippet** | The verbatim manifest or config text the claim rests on (e.g. `.claude-plugin/plugin.json`, `hooks/hooks.json`, `.mcp.json`, `config.toml`), **secret-scrubbed** per §2.3. |
| 6 | **observed behavior** | What actually happened — the transcript/observation, **secret-scrubbed** per §2.3. May include host debug output (`claude --debug`) and environment/PATH dumps (`env`/`printenv`), which the launcher PATH-scoping evidence (§2.2) invites. |
| 7 | **supported claim OR explicit "could not validate" note** | The single load-bearing claim this block grounds — **or**, where the claim could not be validated, an explicit note stating the reason (a documented staged deferral per FR-007/SC-008, never a silent gap). |

### 2.2 Launcher-chain evidence rule (one block per stage per host)

The MCP launcher contract (§5, OQ-8) is validated as an **ordered chain**, so its
evidence is **one block per stage per host**, not one block for the whole contract.
The three condition-forcing stages are:

1. **binary present on PATH** — tools appear in the host;
2. **binary absent + warm npm cache** — `npx --offline` serves cache-first and the
   server still comes up;
3. **binary absent + offline/uncached** — the stub launcher returns success-shaped
   guidance, never an `isError`/failed-spawn surface.

Each launcher block additionally:

- **pins the condition-forcing step** it represents (which of the three stages above,
  and the exact command that forced it — field 4); and
- **records PATH scoping** for a GUI-launched host — whether PATH is **login-shell**
  resolved or **app-inherited** — because bare-name resolution for a GUI-launched host
  is a known risk (the in-repo Antigravity darwin-only precedent; FR-007). This is the
  field-6 observation that legitimately surfaces `env`/PATH dumps, which is exactly why
  the §2.3 scrub rule covers observed-behavior transcripts.

macOS is the hands-on primary: three stages × two hosts (Claude Code, Codex) = **six
launcher blocks minimum**. The same per-stage-per-host sequence is **attempted** on
Windows (Parallels VM) and, where relevant, Linux (Docker); a platform not completed
in time is recorded as an explicit attempt-first staged deferral (field 7), never
omitted.

### 2.3 Secret-scrub rule (FR-019) — mandatory at drafting time

Every block is scrubbed of secrets and credentials **before it lands** (at drafting
time, not in a later pass). The scrub covers **all four Validation Evidence Block
artifact classes** — pinned host version (field 3), exact repro command (field 4),
quoted manifest/config snippet (field 5), and observed-behavior transcript (field 6).
No `CODEGRAPH_EMBEDDING_API_KEY`, private embedding-endpoint value, or any other
untracked `.envrc.local` value may appear in committed text (constitution Principle VII
and the binding Dogfooding rule that the embedding key is never persisted, logged, or
echoed).

**Redact by identity-preserving placeholder, never by deleting the line.** Substitute a
placeholder that preserves *that a secret-bearing injection or resolution occurred at
that step* — e.g. `<REDACTED:CODEGRAPH_EMBEDDING_API_KEY>`,
`<REDACTED:EMBEDDING_ENDPOINT>`, or the unresolved `${VAR}` form — rather than removing
the line, so the evidence still records the injection/resolution point.

**Scrub both endpoint forms.** The raw endpoint URL is always scrubbed, **and so is its
scheme+host:port-redacted form** — host:port alone still identifies private
infrastructure. This is deliberately **stricter** than the CLI's own scheme+host+port
redaction precedent, because this committed evidence is permanent git history.

**Four named exposure points** (FR-019) require redaction at the point evidence is
drafted:

- **(a) Dogfood-index binary-present launcher stage.** The launcher "binary present"
  stage (§2.2 stage 1) validates against this repository's own dogfood index — whose
  MCP launcher `scripts/mcp-dogfood.mjs` injects `.envrc.local` assignments directly
  into the spawned server's environment (confirmed: `scripts/mcp-dogfood.mjs` loads
  `.envrc.local` into the spawned server env) — so that stage's block MUST redact any
  endpoint/key value it would otherwise surface.
- **(b) `claude mcp add` `${VAR}` write-back.** `claude mcp add` resolves `${ENV_VAR}`
  placeholders and writes the literal value back into `.mcp.json`
  (anthropics/claude-code#18692), so a quoted **post-add** manifest/config snippet
  (field 5) MUST be redacted — not only repro commands and transcripts.
- **(c) `codegraph status` endpoint printing.** `codegraph status`'s human and JSON
  output prints the embedding endpoint, so any status-command transcript MUST redact it.
- **(d) Plaintext-http embedding warning.** The plaintext-http warning fires on every
  endpoint-provider embedding pass and echoes the endpoint, so any transcript surfacing
  that warning MUST redact it.

### 2.4 Freeze statement

The seven fields (§2.1), the launcher one-block-per-stage-per-host rule (§2.2), and the
scrub rule (§2.3) are **frozen as of T003 — fixed before any evidence block is
recorded** (FR-003, FR-019, SC-002). Every subsequent evidence-gathering task in this
spike MUST conform to this block shape and MUST apply the scrub at drafting time; T028
is the final verification sweep across all four artifact classes and all four exposure
points, not the first scrub.

---

## 3. Claude Code platform audit

_Closes: US1 — FR-001, FR-003. Manifest + component pointers; plugin-scoped
`mcpServers`/`hooks`/`skills`/`agents`/`commands`; `${CLAUDE_PLUGIN_ROOT}` resolution;
marketplace + trust model; plugin-agent tool inheritance + `disallowedTools`._

> **Done bar.** Every load-bearing claim → public citation + ≥1 hands-on evidence block.

_Status: **Claude-track drafted (T007).** Every load-bearing claim below carries a public
citation + a hands-on evidence block gathered against **Claude Code 2.1.206** (macOS,
darwin-arm64) using the T004 scratch plugin (`codegraph-scratch`) loaded per-session via
`--plugin-dir` (never installed into the user's real `~/.claude`). Citation audit (T009):
§3 clean — no private/vault path; every citation resolves to an enumerated public source
(consolidated §3–§4 audit note closes §4)._

Public citations for this section (FR-004; all resolve to public sources):

- **P1** Plugins reference — `https://code.claude.com/docs/en/plugins-reference`
- **P2** MCP / plugin-provided servers — `https://code.claude.com/docs/en/mcp`
- **P3** Plugin marketplaces — `https://code.claude.com/docs/en/plugin-marketplaces`
- **P4** Claude Code CHANGELOG (public) — versioned entries cited inline (e.g. v2.1.71).

### 3.1 Manifest + component pointers

**Claim.** A Claude Code plugin is a directory whose manifest lives at the fixed path
`.claude-plugin/plugin.json`; component fields (`commands`, `agents`, `hooks`, `mcpServers`,
`skills`) point at bundled components and default to standard locations, so a manifest with
only `name` plus default dirs is a valid plugin. Paths must be relative, `./`-prefixed, no
`../` (P1).

**Evidence block `CC-MANIFEST-001`.**
- **subject** — `.claude-plugin/plugin.json` manifest recognition + component tally.
- **host + pinned version** — Claude Code 2.1.206, macOS darwin-arm64.
- **exact repro command** — `claude plugin validate <scratch>` and
  `claude plugin validate <scratch> --strict`; then (plugin loaded via `--plugin-dir`)
  `claude --plugin-dir <scratch> plugin details codegraph-scratch`.
- **quoted manifest snippet** —
  ```json
  { "name": "codegraph-scratch", "version": "0.0.1",
    "description": "…", "author": { "name": "SPEC-025 plugin platform spike" },
    "keywords": ["codegraph","spike","evidence-only"] }
  ```
  (plus a sibling `.mcp.json`, `hooks/hooks.json`, `skills/…/SKILL.md`, `agents/….md`).
- **observed behavior** — `validate` and `validate --strict` both print `✔ Validation passed`
  (exit 0). `plugin details` reports the component inventory:
  `Skills (1) codegraph-explore-flow · Agents (1) codegraph-explorer ·
  Hooks (1) UserPromptSubmit (harness-only — no model context cost) · MCP servers (1) codegraph
  (tool schemas resolved at runtime; not counted) · Always-on ~208 tok`.
- **supported claim** — the fixed manifest path and the component-pointer set load exactly as
  P1 documents; `--strict` (which fails on unrecognized fields) passes, so the manifest shape
  is exactly valid.

**Audit correction (FR-002).** P1 documents plugin MCP servers as declarable **either** inline
in `plugin.json` (`mcpServers` object) **or** as a `./.mcp.json` file at plugin root. Hands-on,
`claude plugin details` tallied **`MCP servers (0)`** for the inline-only form but
**`MCP servers (1)`** once the server was declared via `./.mcp.json`. The scratch plugin
therefore uses the **`.mcp.json` file form** — the confirmed-recognized shape. Recorded as an
audit finding (details-tally reflects the file form; the inline-only form did not surface in the
tally on 2.1.206), not asserted beyond the observation.

### 3.2 Plugin-scoped MCP server + `${CLAUDE_PLUGIN_ROOT}` + tool namespacing

**Claim.** A plugin's MCP server starts automatically when the plugin is enabled; its tools are
namespaced `mcp__plugin_<plugin-name>_<server-name>__<tool>`; `${CLAUDE_PLUGIN_ROOT}` in the
server command/args/env resolves to the plugin's install directory (P1, P2).

**Evidence block `CC-MCP-NS-001`.**
- **subject** — plugin MCP auto-start, `${CLAUDE_PLUGIN_ROOT}` resolution, tool namespacing.
- **host + pinned version** — Claude Code 2.1.206, macOS.
- **exact repro command** —
  `claude --plugin-dir <scratch> --debug -p "Reply with the exact names of any tools whose name
  contains 'guidance' or 'codegraph'. If none, reply NONE."` (plain session; **no**
  approval-disabling flag).
- **quoted config snippet** — plugin `.mcp.json`:
  ```json
  { "mcpServers": { "codegraph": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/launcher.mjs"],
      "env": { "CODEGRAPH_PLUGIN_ROOT": "${CLAUDE_PLUGIN_ROOT}" } } } }
  ```
- **observed behavior** — the server started **without any approval-disabling flag**; the model
  replied with the single tool
  **`mcp__plugin_codegraph-scratch_codegraph__codegraph_setup_guidance`**. The launcher's own
  runtime log recorded `CODEGRAPH_PLUGIN_ROOT` resolved to the scratch plugin's absolute
  directory (i.e. `${CLAUDE_PLUGIN_ROOT}` expanded correctly), and `claude mcp list` shows the
  server as `plugin:codegraph-scratch:codegraph - ✔ Connected`.
- **supported claim** — the namespacing pattern and `${CLAUDE_PLUGIN_ROOT}` resolution are
  exactly as P1/P2 document; the plugin MCP server auto-starts on a normal session.

### 3.3 Plugin hooks (UserPromptSubmit) + skills + agents

**Claim.** Plugin-scoped hooks live in `hooks/hooks.json` under a top-level `"hooks"` key keyed
by event name; a `UserPromptSubmit` hook can inject context via
`hookSpecificOutput.additionalContext`. Skills are `skills/<name>/SKILL.md`; agents are
`agents/<name>.md` (P1).

**Evidence block `CC-HOOK-001`.**
- **subject** — `hooks/hooks.json` schema + `UserPromptSubmit` firing.
- **host + pinned version** — Claude Code 2.1.206, macOS.
- **exact repro command** — same `--plugin-dir` session as `CC-MCP-NS-001`.
- **quoted config snippet** —
  ```json
  { "hooks": { "UserPromptSubmit": [ { "hooks": [
      { "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/prompt-hook.mjs\"", "timeout": 10 } ] } ] } }
  ```
- **observed behavior** — `plugin validate` initially failed the hooks file with
  `hooks: Invalid input: expected record, received undefined` for a **flat** `{ "UserPromptSubmit": … }`
  file; wrapping the events under a top-level `"hooks"` key made it pass. In the session, the
  model's answer referenced "the `codegraph_explore` tool referenced by **the hook**" — a phrase
  that only appears in the hook's injected `additionalContext` — confirming the
  `UserPromptSubmit` hook fired and its context reached the model. (`plugin details` also lists
  `Hooks (1) UserPromptSubmit`.)
- **supported claim** — plugin `UserPromptSubmit` hooks work and require the top-level `"hooks"`
  wrapper (audit correction vs the flat inline example — FR-002); skills and agents load
  (component tally in `CC-MANIFEST-001`).

### 3.4 Marketplace + trust model

**Claim.** Plugins are distributed via a marketplace `.claude-plugin/marketplace.json`
(git/GitHub/local source); users add a marketplace with `/plugin marketplace add` and install
with `/plugin install <plugin>@<marketplace>`; enablement is a user action, and a plugin's MCP
server goes through the **same per-server approval** as a project `.mcp.json` (P1, P2, P3).

**Evidence block `CC-MARKETPLACE-001`.**
- **subject** — marketplace registry shape + trust/approval surfaces.
- **host + pinned version** — Claude Code 2.1.206, macOS.
- **exact repro command** — read-only inspection of the live registry
  `~/.claude/plugins/known_marketplaces.json` and an on-disk `.claude-plugin/marketplace.json`;
  `claude plugin marketplace --help`.
- **quoted config snippet** — a live `known_marketplaces.json` entry:
  ```json
  { "<marketplace>": { "source": { "source": "github", "repo": "<org>/<repo>" },
      "installLocation": "/Users/<user>/.claude/plugins/marketplaces/<marketplace>",
      "autoUpdate": true } }
  ```
  and a `marketplace.json`: `{ "name": …, "owner": { "name": … }, "plugins": [ { "name", "source", "description", "version" } ] }`.
- **observed behavior** — marketplaces resolve from `github`/`git`/local `source`s with an
  `installLocation` and optional `autoUpdate`; `claude plugin marketplace add|list|remove|update`
  exist. P1 states a plugin's MCP servers "go through the same per-server approval as a project
  `.mcp.json`"; `defaultEnabled` (min 2.1.154) controls post-install enablement; `enabledPlugins`
  in `.claude/settings.json` drives team enablement on folder-trust.
- **supported claim** — the marketplace + trust model is exactly as P1–P3 document. **Could not
  validate — requires interactive host UI (FR-003):** the actual install-time / first-use **trust
  prompt** and the `/plugin` trust-review screen are interactive-only. Exact step a human must
  run: in an interactive `claude` session, `/plugin marketplace add <repo>` then
  `/plugin install <plugin>@<marketplace>` and accept the trust prompt.

### 3.5 Plugin-agent tool inheritance + `disallowedTools`

**Claim.** A plugin-shipped agent (`agents/<name>.md`, YAML frontmatter) **inherits all tools by
default** (omit the `tools` field); tools can be restricted with a `tools` allow-list or a
`disallowedTools` deny-list. Plugin agents support `name`, `description`, `model`, `effort`,
`maxTurns`, `tools`, `disallowedTools`, `skills`, `memory`, `background`, and `isolation`; for
security **`hooks`, `mcpServers`, and `permissionMode` are NOT supported** for plugin-shipped
agents, and the only valid `isolation` is `"worktree"` (P1).

**Evidence block `CC-AGENT-TOOLS-001`.**
- **subject** — plugin-agent frontmatter fields + tool inheritance/denylist.
- **host + pinned version** — Claude Code 2.1.206, macOS; cross-checked against Anthropic's own
  on-disk `plugin-dev` agent-development skill.
- **exact repro command** — `claude plugin validate <scratch> --strict` (agent frontmatter with
  `tools` + `disallowedTools`); P1 §"agents" field table.
- **quoted config snippet** — scratch agent frontmatter:
  ```yaml
  name: codegraph-explorer
  model: inherit
  color: cyan
  tools: ["mcp__plugin_codegraph-scratch_codegraph__codegraph_explore", "Read", "Grep"]
  disallowedTools: ["Write", "Edit"]
  ```
- **observed behavior** — `--strict` passes with both `tools` and `disallowedTools` present. P1
  verbatim: *"Plugin agents support name, description, model, … tools, disallowedTools, … For
  security reasons, hooks, mcpServers, and permissionMode are not supported for plugin-shipped
  agents."* Anthropic's agent-development skill: *"tools (optional) … Default: If omitted, agent
  has access to all tools"*.
- **supported claim** — tool inheritance (omit `tools`) + the `tools`/`disallowedTools` levers
  are real and validate; the plugin-agent security exclusions (`hooks`/`mcpServers`/
  `permissionMode`) are a load-bearing constraint for the US5 agent-class decision (feeds T023).

---

## 4. Codex platform audit

_Closes: US1 — FR-002, FR-003. Enumerated capability-first: `.codex-plugin/plugin.json`
manifest + component pointers; bundled skills; hook surface (plugin `hooks/hooks.json`;
standalone `.codex/hooks.json` / inline `config.toml` `[hooks]`); MCP registration;
subagent-support distinction (plugin-bundled vs standalone `.codex/agents/*.toml` vs
plugin-root `agents/` branding metadata); project- + hook-hash trust gating. Exact
artifact filenames are audit outputs, corrected to the evidence where docs diverge._

> **Done bar.** Every load-bearing claim → public citation + hands-on evidence, or an
> explicit "could not validate" note.

_Status: **Codex track drafted (T008 + the T017/T021 hands-on blocks).** Evidence gathered
against **Codex CLI 0.144.0** on macOS (darwin), a plugin-capable build. The synthesis
consumers (§6 matrix / §7 coexistence / §8 degraded-Codex) remain; the citation audit
(T009) is recorded clean in the consolidated note closing this section._

**Host pin (applies to every block in this section).** `codex --version` → `codex-cli
0.144.0` (latest advertised `0.144.1`; `~/.codex/version.json` →
`{"latest_version":"0.144.1", …}`). All hands-on evidence below was gathered against an
**isolated `CODEX_HOME`** (a scratch dir) so the operator's real `~/.codex` was never
mutated: `export CODEX_HOME=<scratch>/codex-home`. The scratch plugin (T005) lives at
`<scratch>/codex-scratch-marketplace/plugins/codegraph-scratch/` and is **never committed**
(FR-019/Q9).

Codex 0.144.0 exposes a first-class plugin surface — `codex plugin {add,list,marketplace,
remove}`, `codex mcp {add,list,get,remove}`, and the feature flags `plugins` (stable/true),
`plugin_sharing` (stable/true), `remote_plugin` (stable/true), and `hooks` (stable/true).
Public grounding: OpenAI Codex documentation (`developers.openai.com/codex/…`, research.md
C3); `openai/skills` + `developers.openai.com/codex/skills` (C6).

### 4.1 Manifest + component pointers — `.codex-plugin/plugin.json`

**`CX-MANIFEST-001`**
- **subject** — the Codex plugin manifest filename and its component-pointer keys.
- **host + pinned version** — Codex CLI 0.144.0, macOS.
- **exact repro command** — `cat ~/.codex/.tmp/bundled-marketplaces/openai-bundled/plugins/latex/.codex-plugin/plugin.json` (a real OpenAI-shipped plugin) and the SPEC-025 scratch `…/codegraph-scratch/.codex-plugin/plugin.json`.
- **quoted manifest/config snippet** — real OpenAI `latex` plugin:
  ```json
  { "name": "latex", "version": "0.2.4",
    "interface": { "displayName": "LaTeX", "capabilities": ["Interactive","Read","Write"],
      "defaultPrompt": ["Use latex-doctor to check whether this machine can compile LaTeX."],
      "brandColor": "#2563EB" },
    "description": "Compile LaTeX …", "author": { "name": "OpenAI" },
    "license": "Proprietary", "keywords": ["latex", … ], "skills": "./skills/" }
  ```
  Cross-host plugin (`speckit-pro`) manifest carries component pointers to **all three**
  bundle-carried component types: `"skills": "./codex-skills/"`, `"hooks":
  "./codex-hooks.json"`, plus an `interface` branding block; and a sibling bundled plugin
  declares `"mcpServers": "./.mcp.json"`.
- **observed behavior** — the manifest dir is confirmed **`.codex-plugin/`** and the file
  **`plugin.json`** (every OpenAI-bundled plugin — latex, visualize, sites, browser, chrome,
  computer-use — carries exactly this). Codex parsed the scratch `plugin.json` on
  `codex plugin add` (name/version echoed in the install JSON). Component pointers observed
  in real manifests: **`skills`**, **`hooks`**, **`mcpServers`** (all optional path pointers),
  plus a rich **`interface`** branding block (`displayName`, `shortDescription`,
  `longDescription`, `capabilities`, `defaultPrompt`, `brandColor`, `websiteURL`, …).
- **supported claim** — the Codex plugin manifest is **`.codex-plugin/plugin.json`**
  (task's assumed filename **confirmed against observed evidence**), a superset of the Claude
  `.claude-plugin/plugin.json` that adds a Codex-specific `interface` branding block; its
  component pointers are `skills` / `hooks` / `mcpServers` (path strings). There is **no
  `agents` component pointer** (see §4.5). Public citation: C3.

### 4.2 Bundled skills — the shared agent-skills standard

**`CX-SKILLS-001`**
- **subject** — how a Codex plugin carries skills, and the on-disk skill format.
- **host + pinned version** — Codex CLI 0.144.0, macOS.
- **exact repro command** — `cat ~/.codex/skills/gh-stack/SKILL.md`; and the scratch plugin's
  `skills/explore-flow/SKILL.md` copied into the install cache on `codex plugin add`.
- **quoted manifest/config snippet** — real installed skill frontmatter:
  ```yaml
  ---
  description: |
      Manage stacked branches and pull requests with the gh-stack GitHub CLI extension. …
  metadata:
      author: github
      version: 0.0.5
  name: gh-stack
  ---
  ```
- **observed behavior** — the plugin `skills` pointer resolves to a directory of
  `<skill-name>/SKILL.md` bundles (`SKILL.md` = YAML frontmatter with `name` + `description`
  + optional `metadata`, then a markdown body). On install, the whole `skills/` tree is copied
  verbatim into `$CODEX_HOME/plugins/cache/<plugin>@<marketplace>/<plugin>/<version>/skills/`.
- **supported claim** — Codex plugins carry skills as a `skills/<name>/SKILL.md` tree
  (the shared agent-skills `SKILL.md` open standard, C6), pointed to by the manifest `skills`
  key; the skill body transfers unchanged between hosts (spec Assumptions). Per-host divergence
  (discovery dir, invocation syntax, `allowed-tools` semantics) is enumerated in §9.

### 4.3 Hook surface — plugin, global, and project, all Claude-Code-shaped

**`CX-HOOK-SURFACE-001`**
- **subject** — the three places a Codex hook can be declared and the hook-manifest schema.
- **host + pinned version** — Codex CLI 0.144.0, macOS (`hooks` feature = stable/true).
- **exact repro command** — `cat ~/.codex/hooks.json`; `cat
  ~/.codex/.tmp/plugins/plugins/replayio/hooks.json` (real plugin hook); scratch plugin
  `hooks/hooks.json` (pointer `"hooks": "./hooks/hooks.json"`).
- **quoted manifest/config snippet** — global standalone `~/.codex/hooks.json`:
  ```json
  { "hooks": { "UserPromptSubmit": [ { "hooks": [ { "type": "command",
    "command": "/bin/zsh <HOME>/.codex/scripts/ensure-speckit-pro-latest.sh",
    "statusMessage": "Checking SpecKit Pro latest-release guard" } ] } ] } }
  ```
  Real plugin hook (`replayio`) uses **plugin-root-relative** commands: `"command":
  "./scripts/post_bash_upload.sh"`.
- **observed behavior** — three hook sources are all real and share the Claude-Code hook
  schema (`{hooks:{<Event>:[{matcher?,hooks:[{type:"command",command,statusMessage?}]}]}}`):
  **(1) plugin-bundled** via the manifest `hooks` pointer (commands resolve relative to the
  plugin-cache root — confirmed cwd in §4.4); **(2) global standalone** `~/.codex/hooks.json`;
  **(3) project standalone** `<project>/.codex/hooks.json` (confirmed present in the trust
  state, §4.6, keyed `pre_tool_use` / `stop`). Events observed in the wild: `SessionStart`,
  `UserPromptSubmit`, `PreToolUse`, `Stop`. The inline `config.toml` form in active use is
  the trust table `[hooks.state]` (§4.6), not inline hook definitions.
- **supported claim** — Codex hooks are Claude-Code-schema-compatible and declarable from a
  plugin bundle (`hooks` pointer), a global `~/.codex/hooks.json`, or a project
  `.codex/hooks.json`; plugin hook commands are plugin-root-relative. Public citation: C3.
  **Filename correction to observed evidence:** the task's `hooks/hooks.json` is one valid
  layout (used by the scratch plugin via the `hooks` pointer); real plugins also place a
  bare `hooks.json` at the plugin root (`replayio`) or point the manifest `hooks` key at any
  path (`speckit-pro` → `./codex-hooks.json`). The **manifest key** is `hooks`; the filename
  is author's choice.

### 4.4 MCP registration — plugin `.mcp.json` → Codex's unified server registry

**`CX-MCP-001`**
- **subject** — how a plugin registers an MCP server and whether Codex loads/spawns it.
- **host + pinned version** — Codex CLI 0.144.0, macOS.
- **exact repro command** — scratch plugin `.mcp.json`; then `CODEX_HOME=<scratch>/codex-home
  codex mcp list`.
- **quoted manifest/config snippet** — plugin `.mcp.json` (identical shape to the real
  OpenAI `sites` plugin):
  ```json
  { "mcpServers": { "codegraph-scratch": {
      "command": "node", "args": ["./mcp/stub-launcher.mjs"], "cwd": "." } } }
  ```
- **observed behavior** — `codex mcp list` shows the plugin-declared server in the **same
  registry as `config.toml` `[mcp_servers.*]` servers**: `Name=codegraph-scratch,
  Command=node, Args=./mcp/stub-launcher.mjs, Cwd=<cache>/…/0.0.1/., Status=enabled,
  Auth=Unsupported`. The **cwd is the plugin-cache root**, so relative `args`/`command`
  paths resolve against the bundle. In a live session (§5, `LX-CX-STAGE3` / `LX-CX-RUNTIME`)
  Codex actually spawned this server and it completed the MCP handshake.
- **supported claim** — a Codex plugin registers MCP servers via a bundle **`.mcp.json`**
  with the Claude-Code-shaped `mcpServers` key (command/args/cwd/env); Codex merges plugin
  servers into its unified MCP registry with cwd = plugin-cache root, and spawns them in a
  session. This is the plugin-channel analogue of the installer's `config.toml`
  `[mcp_servers.codegraph]` entry. Public citation: C3.

### 4.5 Subagent-support distinction — DO NOT conflate a plugin `agents/` dir with agent loading

**`CX-AGENTS-DISTINCT-001`**
- **subject** — whether Codex loads custom agents from a plugin bundle vs from
  `.codex/agents/`, and the standalone agent-TOML format.
- **host + pinned version** — Codex CLI 0.144.0, macOS.
- **exact repro command** — `cat ~/.codex/agents/phase-executor.toml` (a real installed
  agent); scratch project `.codex/agents/codegraph-explorer.toml`; and the invocation in §4.9.
- **quoted manifest/config snippet** — real standalone agent TOML:
  ```toml
  name = "phase-executor"
  description = "Phase execution worker …"
  model = "gpt-5.5"
  model_reasoning_effort = "xhigh"
  sandbox_mode = "workspace-write"
  developer_instructions = """ … """
  ```
  And the **decisive primary-source note** from the real `speckit-pro` `.codex-plugin/
  plugin.json` `interface.longDescription`:
  > "SpecKit Pro also bundles Codex custom-agent TOML templates plus a Codex-only install
  > skill **because Codex still registers custom agents from `.codex/agents/` or
  > `~/.codex/agents/` rather than directly from the plugin bundle.**"
- **observed behavior** — the manifest has **no `agents` component pointer** (§4.1); real
  cross-host plugins ship agent TOML **templates** in the bundle but rely on an install step
  to copy them into `.codex/agents/` or `~/.codex/agents/`. The scratch standalone agent at
  `<project>/.codex/agents/codegraph-explorer.toml` **was resolved and spawned** as a subagent
  (§4.9), confirming the standalone path is the live one.
- **supported claim** — Codex agents are loaded from **`.codex/agents/*.toml`** (project) or
  **`~/.codex/agents/*.toml`** (global), **not** auto-loaded from a plugin bundle. A plugin's
  `interface` block is **branding metadata only** — a plugin-root `agents/` dir is NOT an
  agent-loading channel and must not be conflated with one. Therefore the **agents × Codex**
  ownership cell (§6) cannot be plugin-owned via bundle auto-load; it is installer-owned (the
  installer writes the TOML into `.codex/agents/`), pending the §4.9 runtime-fidelity caveat.
  Public citations: C3 (manifest), C5 (runtime dependence).

### 4.6 Trust gating — project-scoped + content-hash-pinned

**`CX-TRUST-001`**
- **subject** — how Codex gates plugin/hook execution (trust model).
- **host + pinned version** — Codex CLI 0.144.0, macOS.
- **exact repro command** — `codex plugin add … --json` (shows `authPolicy`); `grep -nE
  '^\[hooks' ~/.codex/config.toml` and reading the `[hooks.state]` table.
- **quoted manifest/config snippet** — the persisted hook-trust table (home path abbreviated,
  one representative hash shown):
  ```toml
  [hooks.state."speckit-pro@racecraft-plugins-public:codex-hooks.json:user_prompt_submit:0:0"]
  trusted_hash = "sha256:86ed2136…"
  [hooks.state."<HOME>/.codex/hooks.json:user_prompt_submit:0:0"]
  trusted_hash = "sha256:bb73231c…"
  [hooks.state."<PROJECT>/.codex/hooks.json:pre_tool_use:0:0"]
  trusted_hash = "sha256:7aa0f903…"
  ```
  Plugin install policy: `codex plugin add` returned `"authPolicy": "ON_INSTALL"` for the
  scratch plugin (OpenAI runtime plugins show `"authPolicy": "ON_USE"`).
- **observed behavior** — hook trust is persisted per hook, keyed
  `"<source>:<event>:<matcher-idx>:<hook-idx>"` where `<source>` is either
  `<plugin>@<marketplace>:<hook-file>` (plugin hook), a global `~/.codex/hooks.json` path, or a
  **project** `<project>/.codex/hooks.json` path — with a `trusted_hash = "sha256:…"` over the
  hook definition. Changing a hook's content changes the hash and **re-arms the trust
  review**. Writing these entries is done by the interactive `/hooks` review (see §4.8) — the
  only non-interactive path is the `codex exec --dangerously-bypass-hook-trust` safety-bypass
  flag.
- **supported claim** — Codex trust is **two-layered**: a plugin `authPolicy`
  (`ON_INSTALL`/`ON_USE`) gates plugin activation, and a **content-hash-pinned, source- and
  project-scoped hook-trust table** (`[hooks.state].…trusted_hash`) gates hook *execution*.
  This is the "project- + hook-hash trust gating" of the audit brief, **confirmed on disk**.
  Public citation: C3; C4 (the one-time hook trust review as the gate on plugin-local
  `UserPromptSubmit`).

### 4.7 Plugin lifecycle — marketplace → install → enable → uninstall (loadability + coexistence feed)

**`CX-LIFECYCLE-001`**
- **subject** — the end-to-end install/enable/uninstall model (proves T005 loadability; feeds
  §7 coexistence).
- **host + pinned version** — Codex CLI 0.144.0, macOS, isolated `CODEX_HOME`.
- **exact repro command** —
  ```bash
  codex plugin marketplace add <scratch>/codex-scratch-marketplace   # local path source
  codex plugin add codegraph-scratch@codegraph-scratch
  codex plugin list --json
  codex plugin remove codegraph-scratch@codegraph-scratch
  ```
- **quoted manifest/config snippet** — install wrote to the isolated `config.toml`:
  ```toml
  [marketplaces.codegraph-scratch]
  source_type = "local"
  source = "<scratch>/codex-scratch-marketplace"
  [plugins."codegraph-scratch@codegraph-scratch"]
  enabled = true
  ```
  Marketplace descriptor read by Codex is `.claude-plugin/marketplace.json`
  (`{name, owner, plugins:[{name, source, version, …}]}`).
- **observed behavior** — `marketplace add` accepted a **local path** (also supports
  `owner/repo[@ref]`, HTTPS/SSH Git, with `--ref`/`--sparse`); `plugin add` copied the whole
  bundle into `$CODEX_HOME/plugins/cache/<plugin>@<marketplace>/<plugin>/<version>/` and set
  `installed=true, enabled=true`; `plugin list --json` returned a rich record (`pluginId`,
  `marketplaceName`, `version`, `installed`, `enabled`, `source{local,path}`,
  `installPolicy`, `authPolicy`); `plugin remove` reversed it cleanly (exit 0). The
  per-plugin **`[plugins."…"].enabled`** toggle is the user-side enable/disable lever.
- **supported claim** — the scratch Codex plugin **loads, enables, and uninstalls cleanly on
  Codex 0.144.0** (T005 done bar met). The marketplace descriptor is the shared
  `.claude-plugin/marketplace.json`; the config levers a coexisting installer must reconcile
  with are `[marketplaces.*]`, `[plugins."<plugin>@<marketplace>"].enabled`, and the
  `[mcp_servers.*]` table (§7). Public citation: C3.

### 4.8 UserPromptSubmit hook functional test — **T017 evidence** (feeds §6 matrix, §8 degraded-Codex)

**`CX-HOOK-PROMPT-001`**
- **subject** — does a **plugin-owned** `UserPromptSubmit` hook emit
  `hookSpecificOutput.additionalContext` that reaches the model, on this pinned build.
- **host + pinned version** — **Codex CLI 0.144.0** (recorded verbatim; latest `0.144.1`).
  This build is **well past the issue-#16430 documented-but-not-executed window** (filed
  2026-04-01 vs v0.118.0) and **past PR #19705** (merged 2026-04-28); corroborated hands-on:
  `hooks` = stable/true and the old gating flag **`plugin_hooks` = removed** (i.e. plugin
  hooks are now unconditional, gated only by the one-time hook-trust review — matching C4's
  "later unconditional").
- **exact repro command** —
  1. author `hooks/inject-context.mjs` emitting
     `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"CODEGRAPH_SCRATCH_CANARY_7F3A9D2 …"}}`;
  2. `codex plugin add codegraph-scratch@codegraph-scratch` (installed + enabled);
  3. command-level fire: `(cd <cache>/…/0.0.1 && node ./hooks/inject-context.mjs)`;
  4. end-to-end model reach (attempted): `codex exec -C <project> "…print the CODEGRAPH_SCRATCH token…"`.
- **quoted manifest/config snippet** — `hooks/hooks.json`:
  ```json
  { "hooks": { "UserPromptSubmit": [ { "hooks": [ { "type": "command",
    "command": "node ./hooks/inject-context.mjs",
    "statusMessage": "codegraph-scratch: injecting explore-first retrieval context" } ] } ] } }
  ```
- **observed behavior** — the hook **fires correctly at the command level**, emitting the exact
  canary JSON:
  `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"CODEGRAPH_SCRATCH_CANARY_7F3A9D2 :: …"}}`.
  The build is version-gated **ON** (post-#19705; `plugin_hooks` removed; `hooks` stable). The
  **end-to-end "reaches the model"** leg could **not** be completed non-interactively: persisting
  hook trust for the plugin hook requires the **interactive `/hooks` TUI review** (writes the
  `[hooks.state].…trusted_hash` entry, §4.6); the only headless avenue is `codex exec
  --dangerously-bypass-hook-trust`, an out-of-scope safety-bypass flag (its use was
  deliberately not taken). A plain `codex exec` (no bypass) correctly **skipped** the untrusted
  hook — confirming the trust gate is real.
- **supported claim OR "could not validate" note** — **DECISION: prompt-front-load × Codex =
  plugin-CAPABLE / plugin-owned, version-gated ON on 0.144.0** (NOT "absent on Codex": the
  build is post-fix, the mechanism is present, and the hook demonstrably produces
  `additionalContext`). **Could-not-validate (one leg only): the end-to-end model-reach
  confirmation**, blocked by the interactive-only hook-trust review. **Exact human step to
  close it:** in a terminal with the isolated `CODEX_HOME` and the scratch plugin installed,
  launch interactive `codex`, run **`/hooks`**, trust the `codegraph-scratch`
  `UserPromptSubmit` hook, then `codex exec -C <project> "print any CODEGRAPH_SCRATCH token"`
  and confirm the model prints `CODEGRAPH_SCRATCH_CANARY_7F3A9D2`. Public citation: C4.

### 4.9 Subagent runtime-path pinning — **T021 evidence** (feeds §8 degraded-Codex)

**`CX-SUBAGENT-V2-001`**
- **subject** — do standalone `.codex/agents/*.toml` load and can a **named** subagent be
  invoked, on the runtime/model pairing CodeGraph ships against.
- **host + pinned version** — Codex CLI 0.144.0, macOS. Feature flags: `multi_agent` =
  stable/true, **`multi_agent_v2` = under-development/false**; `[agents] max_depth = 2`.
- **exact repro command** — `codex exec -C <scratch>/codex-scratch-project -s read-only
  --skip-git-repo-check "You have a custom subagent named 'codegraph-explorer' … invoke/delegate
  … reply DELEGATED …"`; then inspect the session rollout under
  `$CODEX_HOME/sessions/2026/07/10/rollout-…jsonl`.
- **quoted manifest/config snippet** — the standalone agent + the **runtime rollout record**:
  ```toml
  # <project>/.codex/agents/codegraph-explorer.toml
  name = "codegraph-explorer"
  model = "gpt-5.5"
  model_reasoning_effort = "high"
  sandbox_mode = "read-only"
  ```
  ```json
  "multi_agent_version":"v2"   "multi_agent_mode":"explicitRequestOnly"
  "subagent":{"thread_spawn":{"parent_thread_id":"019f4c34…","depth":1,
     "agent_path":"/root/codegraph_explorer","agent_nickname":"Wegener","agent_role":null}}
  ```
- **observed behavior** — the named subagent **was spawned** (`thread_spawn` resolved
  `agent_path=/root/codegraph_explorer` at `depth:1`) — so a single load/spawn *does* succeed.
  **But the runtime self-reported `multi_agent_version:"v2"`** (`multi_agent_mode:
  explicitRequestOnly`) — surprising, since the `multi_agent_v2` *feature flag* reads false;
  the flag name and the runtime `multi_agent_version` field are distinct. On this v2 path the
  agent's **declared config was NOT applied**: `agent_role: null`, and the agent's declared
  **`model = "gpt-5.5"` was ignored** — the subagent ran on the parent session model
  `gpt-5.6-sol` (grep for `gpt-5.5` across all three rollouts = **0 hits**). This is exactly
  the `multi_agent_v2` named-agent config-fidelity limitation reported in issues **#15250 /
  #20077** (no `agent_type`/role applied), now observed as: spawns, but does not honor the
  named agent's `model`/`role`.
- **supported claim OR staged-deferral note** — **Runtime path pinned: `multi_agent_version:
  v2`, mode `explicitRequestOnly`, on Codex 0.144.0.** Named-agent invocation of a standalone
  `.codex/agents/*.toml` **partially exercised**: the thread spawns and resolves the named
  agent path, but v2 does **not** apply the agent's declared `model` (gpt-5.5 → ran
  gpt-5.6-sol) or a non-null `role`. **CANDIDATE STAGED DECISION → DEFERRED to SPEC-026
  (named blocker, verbatim):** _"Attempted: named-agent invocation of a standalone
  `.codex/agents/codegraph-explorer.toml` (declared model gpt-5.5) via `codex exec` on Codex
  CLI 0.144.0. Result: subagent thread_spawn succeeded but on `multi_agent_version:v2` the
  agent's declared model and role were not honored (ran parent model gpt-5.6-sol, agent_role
  null) — the #15250/#20077 v2 config-fidelity limitation. Blocker: the shipped CodeGraph
  agent/model pairing (SpecKit-Codex agents declaring gpt-5.5) cannot be exercised with full
  fidelity on the v2 runtime this build selects. SPEC-026 must confirm named-agent config
  fidelity (declared model + role applied) on the exact shipped runtime/model pairing — or
  ship agents in a form that does not depend on per-agent model/role override — before relying
  on Codex subagents."_ Public citation: C5.

### Citation audit (T009) — §3–§4 clean

_Join task (depends on T007 + T008): every committed citation in §3 (Claude Code audit)
and §4 (Codex audit) was cross-checked against the `research.md` §2a verified-URL ledger.
**Result: clean** — no citation references a private or vault path; every citation
resolves to an enumerated public source (FR-004, US1 AS3, SC-002)._

- **§3 (Claude Code): P1 `code.claude.com/docs/en/plugins-reference`, P2
  `code.claude.com/docs/en/mcp`, P3 `code.claude.com/docs/en/plugin-marketplaces`, P4 the
  public Claude Code CHANGELOG (v2.1.71 / v2.1.152 / v2.1.154 cited inline).** P1 and P2
  match §2a rows verbatim; P4's dedup entry (v2.1.71) is the §2a-C2 verified public
  CHANGELOG entry. **P3 caveat (not a failure):** its exact slug is not an
  independently-fetched §2a row, but it is on the **same §2a-verified-public host**
  (`code.claude.com/docs/en/`) — same public host, not a private/vault path.
- **§4 (Codex): C3 `developers.openai.com/codex/…`, C4 issues #16430 + PR #19705, C5
  issues #15250 + #20077, C6 `developers.openai.com/codex/skills` + `openai/skills`.** All
  resolve to enumerated public OpenAI/Codex sources (§2a C3–C6). **Ledger-flagged
  refresh carried forward (public→public, not an audit failure):** §2a marks
  `github.com/openai/skills` DEPRECATED (still HTTP 200) with the recommended swap to
  `github.com/openai/plugins` — a citation refresh for the §4/polish owner, not a
  private/vault issue.
- **Non-citation evidence paths are scrubbed local artifacts, not citations.** The
  `~/.claude/…` / `~/.codex/…` registry, cache, and hook-trust-table paths quoted in the
  evidence blocks (and §3.5's on-disk `plugin-dev` skill) are **public product artifacts**
  shown as observed evidence, with user/home/project segments already placeholder-redacted
  (`<user>` / `<HOME>` / `<PROJECT>` / `<scratch>`); none is a citation and none is a
  private/vault path. (Grep sweep of §3–§4: zero `vault`/`obsidian`/`file://`/`.pdf`
  references, zero unredacted absolute `/Users/…` or `C:\…` paths; the only http(s) URLs
  are the three public `code.claude.com` links above.)
- **The one true vault-path risk is absent here.** The maintainer's local skill-authoring
  PDF (Obsidian vault) does not appear in §3–§4 — it is a §9 concern, and §2a already
  substitutes the public
  `resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf`
  equivalent in its place.

---

## 5. MCP launcher contract — OQ-8

_Closes: US2 — FR-005, FR-006, FR-007, FR-008, FR-021. The ordered fallback
(PATH-resolved binary → `npx --offline` thin-installer → success-shaped guidance); the
stub-launcher delivery mechanism; the runtime-self-sufficiency condition; the
`--offline`/major-pin/~50 MB disclosure; the plugin-channel network/telemetry parity
affirmation; the three-stage-per-host evidence._

> **Done bar.** Ordered fallback fully specified; absent-binary path success-shaped
> (never `isError`); ANY npx-stage failure (not only the offline cache-miss —
> corrupt/partial cache, npx/runtime unavailable, or a spawned-but-nonfunctional
> package) falls through to the stub guidance; the guidance's install command framed as
> a USER action (never an agent auto-install, FR-021); network/telemetry parity
> affirmed; OQ-8 marked resolved in PRD terms (SC-003) with recorded evidence.

_Status: **Claude-track (T010) + Codex-track (T011) macOS evidence drafted: three stage blocks
+ the FR-006 runtime finding per host. Cross-platform attempts recorded (§5.D/§5.E): Windows
(T012) staged-deferred on a named, evidenced blocker (the Parallels VM is suspended with no IP
AND the `.parallels` credentials file is absent); Linux (T013) validated hands-on in Docker.**
The launcher-contract synthesis (T014, §5.F), the OQ-8 resolution (T015, §5.G), and the
network/telemetry parity affirmation (T029, §5.H) are all recorded below._

### 5.A Claude Code launcher three-stage (macOS) — **T010 evidence**

All Claude blocks were gathered against **Claude Code 2.1.206** on macOS (darwin-arm64) using
the T004 scratch plugin's `.mcp.json` (`command:"node", args:["${CLAUDE_PLUGIN_ROOT}/mcp/launcher.mjs"]`)
— the plugin-channel analogue of the installer's Claude `.mcp.json` entry. The stub
launcher (`mcp/launcher.mjs`) implements the OQ-8 ordered fallback; the three condition-forcing
stages were exercised directly and end-to-end. **Runtime env note (FR-019 exposure a):** the
"binary present" stage's dogfood form (`node dist/bin/codegraph.js`) would inject `.envrc.local`
(private embedding endpoint/key) into a live server env — the stub stages here were forced so no
endpoint/key was ever surfaced; any value that *would* appear is redacted as
`<REDACTED:EMBEDDING_ENDPOINT>` / `<REDACTED:CODEGRAPH_EMBEDDING_API_KEY>`.

**`LX-CC-STAGE1-001` — stage 1: binary present on PATH.**
- **subject** — PATH-resolved `codegraph` binary → exec real MCP server; GUI-launched PATH scoping.
- **host + pinned version** — Claude Code 2.1.206, macOS darwin-arm64; Node v24.11.1.
- **exact repro command** — `command -v codegraph`; and the plugin MCP subprocess's own PATH dump
  (launcher `launcher_start` log) when the host started it.
- **quoted config snippet** — launcher stage-1 resolver: `command -v codegraph` (or `$CODEGRAPH_BIN`)
  → `exec <bin> serve --mcp`.
- **observed behavior** — `codegraph` is **NOT on the GUI-inherited PATH** on this machine
  (`command -v codegraph` → not found). The plugin MCP subprocess the host spawned received a PATH
  beginning `/opt/homebrew/…:…:/Users/<user>/Library/pnpm …` (the GUI-launched app's inherited
  environment, **not** a fresh login shell) — it contains `node` but **not** `codegraph`. The
  "present" form of codegraph on this repo is the dogfood `node dist/bin/codegraph.js` invoked by
  **absolute path**, never a bare-name `codegraph`.
- **supported claim** — stage-1 **bare-name resolution fails for a GUI-launched host** whose
  inherited PATH lacks `codegraph` — the in-repo Antigravity darwin-only precedent (FR-007),
  realized. A plugin launcher must not assume `codegraph` is bare-name-resolvable; PATH is
  **app-inherited**, not login-shell resolved.

**`LX-CC-STAGE2-001` — stage 2: binary absent + warm npm cache.**
- **subject** — `npx --offline` cache-first serve of the thin-installer.
- **host + pinned version** — Claude Code 2.1.206 / npm 11.6.2 / Node v24.11.1, macOS.
- **exact repro command** — `npm cache add @colbymchenry/codegraph@^1` (warm the cache; no install
  scripts, no binary) → `npx --offline --yes @colbymchenry/codegraph@^1 --version`.
- **quoted config snippet** — launcher stage-2 handoff:
  `npx --offline --yes @colbymchenry/codegraph@^1 serve --mcp`.
- **observed behavior** — with the cache warm (tarball `codegraph-1.4.0.tgz` present),
  `npx --offline` **serves the npm shim from cache** (gets past the ENOTCACHED gate of stage 3).
  The shim then printed: *"codegraph: platform bundle missing … downloading
  codegraph-darwin-arm64.tar.gz from GitHub Releases (1.4.0)…"* — i.e. the shim reaches
  **GitHub Releases** for the ~50 MB per-platform bundle (staged atomically in
  `~/.codegraph/bundles/.dl-XXXX/`). The download was interrupted (not completed) and the partial
  removed.
- **supported claim (load-bearing, FR-005/FR-006)** — `npx --offline` covers only the **npm
  registry** hop (the shim). The shim's **platform-bundle fetch from GitHub Releases is a SECOND
  network dependency that `--offline` does NOT make offline.** So "warm npm cache ⇒ server comes
  up offline" holds **only if the platform bundle is already present** on disk; a first-ever
  offline run with a warm npm cache but no bundle still needs GitHub Releases. The launcher
  contract (T014) must treat a missing bundle as a stage-2 failure that **falls through to stage-3
  guidance**, not a hang.

**`LX-CC-STAGE3-001` — stage 3: binary absent + npx offline/uncached → success-shaped guidance.**
- **subject** — stub launcher returns success-shaped MCP guidance, never `isError`/failed-spawn.
- **host + pinned version** — Claude Code 2.1.206 / npm 11.6.2, macOS.
- **exact repro command** — `npx --offline --yes @colbymchenry/codegraph@^1 --version` with the
  cache cold; then the stub over stdio:
  `printf '<initialize>\n<tools/list>\n<tools/call>\n' | CODEGRAPH_FORCE_STAGE=3 node launcher.mjs`;
  and end-to-end `claude --plugin-dir <scratch> --debug -p "…list codegraph/guidance tools…"`.
- **quoted config snippet** — stub `tools/call` result: `{ "content": [{ "type":"text", "text": "…a
  USER should run: npx @colbymchenry/codegraph@^1 install … No action is taken automatically." }] }`
  (no `isError` field).
- **observed behavior** — cold-cache `npx --offline` → `npm error code ENOTCACHED` / *"cache mode is
  'only-if-cached' but no cached response is available"* / **exit 1** (a clean catchable failure).
  The stub then completed the MCP handshake: `initialize` → result with `instructions`;
  `tools/list` → one `codegraph_setup_guidance` tool; `tools/call` → success-shaped text;
  **exit 0, no `isError` anywhere**. End-to-end, the model reported the tool available and relayed
  its guidance (*"CodeGraph isn't installed on this machine yet…"*) — treated as guidance, **not an
  error** (errors-teach-abandonment respected, FR-006).
- **supported claim** — the absent-binary path is **success-shaped** (guidance, never a failed
  spawn or `isError`); the install command is framed as a **USER** action (FR-021), never an
  agent auto-install.

**`LX-CC-RUNTIME-001` — FR-006 runtime self-sufficiency check (what runtime Claude provides).**
- **subject** — the runtime the host actually hands the plugin MCP subprocess.
- **host + pinned version** — Claude Code 2.1.206, macOS.
- **exact repro command** — the launcher's `launcher_start` log (`process.execPath`,
  `process.version`, `process.env.PATH`) captured when the host spawned it via `--plugin-dir`.
- **quoted config snippet** — manifest command `"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/mcp/launcher.mjs"]`.
- **observed behavior** — the host started the subprocess with `execPath =` the **PATH-resolved
  `node`** (nvm `v24.11.1`), `cwd =` the session's project dir, and `${CLAUDE_PLUGIN_ROOT}`/env from
  the manifest `env` block all propagated. The host did **not** inject a bundled runtime; it relied
  on `node` being on the inherited PATH.
- **supported claim (FR-006)** — **do not assume `node`.** Claude provides the plugin subprocess
  **no runtime of its own** — `command:"node"` resolves against the host's (app-inherited) PATH.
  The *resolved codegraph binary* is runtime-self-sufficient (ships its own ≥22.5 Node in the
  bundle), but the **npx bootstrap and any `command:"node"` launcher depend on the host PATH
  providing node/npx** — the same PATH-scoping exposure as stage 1. A `.cmd`/shell launcher is a
  Windows risk deferred to T012.

### 5.C Codex launcher three-stage (macOS) — **T011 evidence**

All three Codex blocks were gathered against **Codex CLI 0.144.0** on macOS using the T005
scratch plugin's `.mcp.json` (`command:"node", args:["./mcp/stub-launcher.mjs"]`) — the
plugin-channel analogue of the installer's `config.toml` `[mcp_servers.codegraph]` entry. The
launcher's own resolution order (PATH binary → `npx --offline` → stub guidance) is
host-independent; the Codex-specific facts are **how Codex spawns the command** and **what
runtime it provides** (FR-006).

**`LX-CX-STAGE1-001` — stage 1: binary present on PATH → server comes up**
- **subject** — a PATH-resolvable `codegraph` (or a node-launched `dist/bin/codegraph.js`) is
  spawned by Codex and the tools appear.
- **host + pinned version** — Codex CLI 0.144.0, macOS; node v24.11.1 (nvm).
- **exact repro command** — `command -v codegraph` (resolution check); `node
  <worktree>/dist/bin/codegraph.js --version`; the repo's own dogfood `.mcp.json` launcher
  shape.
- **quoted manifest/config snippet** — the repo's dogfood `.mcp.json` (the shipped "binary
  present via node" launcher precedent):
  ```json
  { "mcpServers": { "codegraph": { "command": "node",
    "args": ["-e", "…walk-up locator that imports scripts/mcp-dogfood.mjs…"] } } }
  ```
- **observed behavior** — `command -v codegraph` → **not on PATH** on this machine (no global
  install), so the PATH-binary form was exercised via the node entry point: `node
  dist/bin/codegraph.js --version` → **`1.3.1`** (the real server binary runs). Codex spawns
  MCP `command` values exactly as declared (see `LX-CX-RUNTIME-001` — a bare `node` resolved
  against the inherited PATH). **PATH scoping observed: login-shell** (this session was
  CLI-launched; the captured PATH is the full interactive-shell PATH). GUI-launched PATH
  scoping is the documented **risk** (the in-repo Antigravity darwin-only precedent; FR-007),
  not yet reproduced from a GUI launch.
- **supported claim** — Codex spawns the launcher command as declared; with the binary
  reachable (directly on PATH, or via `node <path>`), the server comes up and tools appear.
  **FR-019 note:** this stage was run against the **isolated scratch home + dist binary**, not
  the dogfood index, so **no `.envrc.local` endpoint/key value is present**; were this stage run
  through `scripts/mcp-dogfood.mjs` (which injects `.envrc.local` into the spawned env), the
  exposure-(a) redaction of §2.3 would apply. Public citations: C3, C7.

**`LX-CX-STAGE2-001` — stage 2: binary absent + warm npm cache → `npx --offline` serves**
- **subject** — with no PATH binary but a warm npm cache, the `npx --offline` fallback serves
  the thin installer locally (zero network).
- **host + pinned version** — Codex CLI 0.144.0, macOS; npm cache under `~/.npm`.
- **exact repro command** — `npm cache ls @colbymchenry/codegraph`; (contract) `npx --offline
  @colbymchenry/codegraph@^1 serve --mcp`.
- **quoted manifest/config snippet** — npm cache hit for the package:
  ```
  make-fetch-happen:request-cache:https://registry.npmjs.org/@colbymchenry/codegraph/-/codegraph-1.4.0.tgz
  make-fetch-happen:request-cache:https://registry.npmjs.org/@colbymchenry%2fcodegraph
  ```
- **observed behavior** — the package **is present in the warm npm cache**
  (`@colbymchenry/codegraph-1.4.0.tgz` cached), so `npx --offline` would resolve it **cache-first
  with no network request** (C7 `--offline` = `only-if-cached`). Codex would spawn this `npx`
  form identically to any other `command` (per `LX-CX-RUNTIME-001`).
- **supported claim** — stage 2 is viable on Codex: a warm-cache `npx --offline
  @colbymchenry/codegraph@^X` serves the server locally with no network, spawned by Codex the
  same way as stage 1. The **major-version pin** (`@^X`) is the OWASP CICD-SEC-3 / npm
  "Shai-Hulud" supply-chain mitigation (C8), diverging deliberately from the unpinned `npx -y`
  MCP-reference pattern. Public citations: C7, C8.

**`LX-CX-STAGE3-001` — stage 3: binary absent + offline/uncached → success-shaped stub guidance**
- **subject** — when nothing resolves (no PATH binary, cache-miss offline), the stub launcher
  still starts an MCP-speaking process and returns success-shaped guidance — never
  `isError`/failed-spawn.
- **host + pinned version** — Codex CLI 0.144.0, macOS.
- **exact repro command** — `npx --offline @colbymchenry/nonexistent-pkg-xyz --version`
  (forces the uncached-offline condition); `printf '{"jsonrpc":"2.0","id":1,"method":"initialize",…}\n'
  | node ./mcp/stub-launcher.mjs` (stub handshake); and the live spawn in a `codex exec`
  session (`LX-CX-RUNTIME-001`).
- **quoted manifest/config snippet** — the stub's success-shaped `initialize` reply:
  ```json
  { "jsonrpc":"2.0","id":1,"result":{ "protocolVersion":"2025-06-18",
    "serverInfo":{"name":"codegraph-scratch-stub","version":"0.0.1"},
    "capabilities":{"tools":{}},
    "instructions":"codegraph binary not resolved. This is success-shaped guidance, not an
      error. A user (never the agent) can install it: `codegraph install`." } }
  ```
- **observed behavior** — uncached `npx --offline` fails **catchably**: `npm error code
  ENOTCACHED … cache mode is 'only-if-cached' but no cached response is available` (no network
  request emitted) — exactly the signal a launcher catches to fall through to the stub. The
  stub then answers `initialize` with a success-shaped payload carrying install guidance and
  `tools/list` → `[]`; **Codex spawned it in a live session and it completed the handshake**
  (no `isError`, no failed-spawn surface). The install command is framed as a **USER** action
  (`codegraph install`), never an agent auto-install (FR-021).
- **supported claim** — the absent-binary path is **success-shaped on Codex**, honoring the
  errors-teach-abandonment doctrine: any npx-stage failure (offline cache-miss here; the
  same fall-through covers corrupt/partial cache, npx/runtime unavailable, or a
  spawned-but-nonfunctional package) degrades to a live MCP server serving guidance, not a
  failed spawn. Public citations: C3, C7; PRD OQ-8.

**`LX-CX-RUNTIME-001` — FR-006 runtime check: what runtime does Codex hand the subprocess?**
- **subject** — the runtime Codex actually provides a plugin MCP subprocess (do NOT assume
  `node`).
- **host + pinned version** — Codex CLI 0.144.0, macOS.
- **exact repro command** — plain `codex exec -C <project> -s read-only --skip-git-repo-check
  "Reply with exactly: OK"` (no bypass flags); the stub records its runtime to a file at
  startup. Session used model `gpt-5.6-sol`; cost ≈ 5,903 tokens.
- **quoted manifest/config snippet** — the stub's captured runtime report:
  ```json
  { "execPath": "<HOME>/.nvm/versions/node/v24.11.1/bin/node",
    "nodeVersion": "v24.11.1", "argv0": "node", "hasPATH": true,
    "cwd": "<cache>/…/codegraph-scratch/0.0.1",
    "PATH": "<CODEX_HOME>/tmp/arg0/codex-arg0…:/opt/homebrew/opt/openjdk/bin:…:<HOME>/.nvm/versions/node/v24.11.1/bin:… [full login-shell PATH inherited; no secrets] " }
  ```
- **observed behavior** — Codex resolved the bare `command:"node"` to the **user's
  nvm-installed node (v24.11.1) via the inherited login-shell PATH**; it does **not** bundle or
  guarantee its own node runtime. `cwd` = the plugin-cache root (relative bundle paths resolve).
  Codex prepends a private `…/tmp/arg0/codex-arg0…` shim dir to PATH. No `.envrc.local`,
  credential, or embedding-endpoint value appears (isolated scratch home).
- **supported claim** — **FR-006 finding (Codex): the launcher must NOT assume `node` is
  present** — Codex resolves the bare command against the inherited PATH and provides no
  runtime guarantee; it worked here only because the user has node on PATH. The shipped stub
  launcher must therefore be self-sufficient about locating a runtime (or the manifest must
  pin an absolute/known interpreter), and the plugin channel must disclose the ~50 MB
  per-platform bundled-runtime weight the npm channel carries (FR-005). PATH scoping here is
  **login-shell** (CLI-launched); GUI-launched scoping remains the FR-007 risk. Public
  citation: C3; in-repo precedent `scripts/mcp-dogfood.mjs` (assumes `node`).

### 5.D Windows (Parallels VM) launcher attempt — **T012 evidence**

_Attempt-first staged decision (Q10/SC-008): the Windows per-stage-per-host launcher
sequence was **attempted** and hit a named, evidenced blocker (below), so the three live
stages on both hosts **and** the two named Windows risks are **deferred to SPEC-026's
pre-ship gate** — never decided in advance, never a silent gap (§2.2, FR-007)._

**`LX-WIN-ATTEMPT-001` — Windows host reachability + the two named Windows risks.**
- **subject** — reaching a Windows host (Parallels VM over the repo's documented SSH bridge)
  to run the three launcher stages on Claude Code + Codex, specifically to probe **risk (a)**
  the CVE-2024-27980-class `.cmd`/shim spawn refusal (#289) and **risk (b)** bare-name PATH
  resolution for a GUI-launched Windows host.
- **host + pinned version** — target: Windows 11 (Parallels VM `{db490dcc-…}`); driver host:
  macOS darwin-arm64 with Parallels Desktop present (`/usr/local/bin/prlctl`). **No Windows
  host build could be pinned — the VM was never reached** (see blocker); this is itself the
  recorded evidence.
- **exact repro command** — the attempt sequence, each line with its actual result:
  ```
  # 1. read the documented connection file (VM name, guest IP, SSH user/key)
  cat <checkout-root>/.parallels   # -> No such file or directory
  #    (absent at the main checkout root, the worktree, HOME, and anywhere under the project tree)
  # 2. discover the VM via Parallels
  prlctl list -a                   # -> {db490dcc-…}  STATUS=suspended  IP_ADDR=-  NAME="Windows 11"
  # 3. look for alternate SSH credentials
  grep -inE 'parallels|windows|10\.211' ~/.ssh/config   # -> no VM host entry
  grep -c '10\.211\.55' ~/.ssh/known_hosts              # -> 0
  # 4. attempt non-interactive exec into the VM
  prlctl exec "{db490dcc-…}" whoami
  #    -> Unable to perform the operation because "Windows 11" is not started.
  #       This operation can be performed for running virtual machines only.
  # 5. the SSH bridge itself could NOT be formed — guest IP / SSH user / key live only in the
  #    absent .parallels file:
  ssh <user>@<guest_ip> "..."      # -> UNRUNNABLE: <user>/<guest_ip>/<key> undefined (source file absent)
  ```
- **quoted manifest/config snippet** — `n/a` for a not-reached host (no manifest/config was
  loaded on Windows). The intended Windows launcher subject is the scratch plugin's `.mcp.json`
  `command`/`args` resolving to the shipped Windows entry point (npm `.cmd` shim /
  `codegraph.cmd`); it was never spawned.
- **observed behavior** — **what IS testable was recorded** (task requirement, since the host
  is unreachable): (1) the "Windows 11" VM exists in Parallels but is **suspended with no IP
  address assigned**, so it is not network-reachable; (2) the `.parallels` connection file that
  holds the guest IP + SSH user + key (repo CLAUDE.md "Windows (Parallels VM + SSH)") is
  **absent on this machine**, so no SSH session can be authenticated even if the VM were resumed;
  (3) `prlctl exec` is unavailable (VM not started; also Parallels-Pro-gated per CLAUDE.md).
  Risks (a) and (b) are **Windows-runtime-specific** and cannot be exercised on the macOS host,
  so they were recorded at the level that IS testable here — **static launcher inspection**: the
  scratch launcher's Windows branch `resolveBinary()` runs
  `spawnSync('where', ['codegraph'], { shell: true })` and then `handoff(bin, ['serve','--mcp'])`
  spawns the resolved path **without `shell:true`**; if `where` resolves `codegraph` to a
  `.cmd`/`.ps1` shim, that `spawn`-without-shell of a `.cmd` is exactly the CVE-2024-27980 / #289
  refusal surface (patched Node refuses to spawn a `.cmd`/`.bat` without `shell:true`). For risk
  (b), the macOS stage-1 blocks (`LX-CC-STAGE1-001` / `LX-CX-STAGE1-001`) already show bare-name
  `codegraph` failing to resolve on a GUI-inherited PATH (the darwin Antigravity precedent) — the
  cross-platform analogue; the Windows GUI-launched-host PATH behavior specifically is deferred.
- **supported claim OR "could not validate" note — STAGED DECISION → DEFERRED to SPEC-026
  (named blocker, verbatim):** _"Attempted: the Windows per-stage-per-host launcher sequence
  (three stages × Claude Code + Codex) on the Parallels 'Windows 11' VM via the repo's documented
  SSH bridge, specifically to probe risk (a) the CVE-2024-27980-class `.cmd`/shim spawn refusal
  (#289) and risk (b) bare-name PATH resolution for a GUI-launched Windows host. Exact commands +
  errors: `cat <root>/.parallels` → 'No such file or directory' (the file is absent at the main
  checkout root, the worktree, HOME, and anywhere under the project); `prlctl list -a` → the
  'Windows 11' VM is `suspended` with `IP_ADDR=-`; `prlctl exec {db490dcc-…} whoami` → 'Unable to
  perform the operation because "Windows 11" is not started…'; the `ssh <user>@<guest_ip>` bridge
  could not be formed because the guest IP / SSH user / key live only in the absent `.parallels`
  file. Blocker: no Windows host is reachable — the VM is suspended with no assigned IP, AND the
  `.parallels` file that is the documented sole source of the guest IP + SSH user + key is absent
  on this machine, so the VM cannot be authenticated to even if resumed. (Resuming the user's
  suspended VM was deliberately not done: it is a state-changing action that still cannot succeed
  without the missing credentials.) SPEC-026's pre-ship gate MUST, on a reachable Windows host,
  before shipping the plugin channel to Windows: (a) confirm the host MCP launcher spawns the
  shipped Windows entry point (npm `.cmd` shim / `codegraph.cmd`) WITHOUT the CVE-2024-27980-class
  `.cmd` spawn refusal — i.e. the launcher's `handoff()` must spawn a resolved `.cmd` shim with
  `shell:true` + proper escaping, or resolve to a non-`.cmd` entry point; and (b) confirm
  bare-name `codegraph` PATH resolution succeeds (or is not relied upon) for a GUI-launched
  Windows host, given the darwin precedent that a GUI-inherited PATH lacks it."_ Public citations:
  CVE-2024-27980; Claude Code CHANGELOG #289; FR-007.

### 5.E Linux (Docker) launcher attempt — **T013 evidence**

_Attempt-first (Q10/SC-008): Docker was available, so the Linux launcher sequence was
**validated hands-on — no deferral.** `node:22-bookworm`, `docker run --rm --init` per repo
CLAUDE.md. The launcher-resolution chain (PATH binary → `npx --offline` → success-shaped stub)
behaves **identically to macOS** on Linux; the OS-sensitive `win32` branch is the only
divergence and is the T012 Windows concern above._

**Host pin (all Linux blocks).** Docker Engine 29.5.3 (client + server); image
`node:22-bookworm` (digest `sha256:a25c9934…4127c365`), Node **v22.23.1**, npm 10.9.8;
macOS darwin-arm64 driver host. **FR-019:** the container is clean — no `.envrc.local`, no
`CODEX_HOME`, no dogfood index — so no embedding endpoint/key value could appear (the observed
PATH is the container default `/usr/local/sbin:/usr/local/bin:/usr/sbin …`, no secrets); nothing
to scrub.

**`LX-LNX-STAGE1-001` — stage 1: bare-name PATH resolution on a clean Linux host.**
- **subject** — whether a bare `codegraph` resolves on a pristine Linux host.
- **host + pinned version** — `node:22-bookworm` (Node v22.23.1) under Docker 29.5.3, macOS host.
- **exact repro command** — `command -v codegraph` inside the container.
- **quoted manifest/config snippet** — the launcher stage-1 resolver `resolveBinary()`, POSIX
  branch: `spawnSync('command', ['-v', 'codegraph'])`.
- **observed behavior** — `command -v codegraph` → **NOT-FOUND** (a clean host has no codegraph
  binary); container default PATH `/usr/local/sbin:/usr/local/bin:/usr/sbin …`.
- **supported claim** — on Linux, exactly as on the macOS GUI-inherited PATH
  (`LX-CC-STAGE1-001`), a plugin launcher must NOT assume a bare-name `codegraph` is resolvable;
  the stage-1 "binary absent" path is the realistic default on a fresh host and must fall through.

**`LX-LNX-STAGE3-001` — stage 2→3 boundary: `npx --offline` cold cache → success-shaped stub.**
- **subject** — the `npx --offline` cold-cache failure signal and the stub fall-through, on Linux.
- **host + pinned version** — `node:22-bookworm` (Node v22.23.1, npm 10.9.8) under Docker 29.5.3.
- **exact repro command** —
  ```
  npx --offline --yes @colbymchenry/codegraph@^1 --version    # (b) cold-cache probe
  cat hs.jsonl | CODEGRAPH_FORCE_STAGE=3 node launcher.mjs     # (c) forced stage-3 handshake
  cat hs.jsonl | node launcher.mjs                             # (d) AUTO fall-through (npx probe -> stage 3)
  # hs.jsonl = newline-delimited initialize / tools/list / tools/call JSON-RPC
  ```
- **quoted manifest/config snippet** — the stub's success-shaped `tools/call` result (**no
  `isError` field**):
  ```json
  { "jsonrpc":"2.0","id":3,"result":{ "content":[{ "type":"text",
    "text":"CodeGraph is not installed on this machine yet. … a USER should run:  npx
      @colbymchenry/codegraph@^1 install  (or: codegraph install). No action is taken automatically." }] } }
  ```
- **observed behavior** — **(b)** cold-cache `npx --offline` → `npm error code ENOTCACHED` /
  *"cache mode is 'only-if-cached' but no cached response is available"* / **exit 1** — a clean
  catchable failure, no network request emitted. **(c)** forced stage 3: the launcher logged
  `{"ev":"stage","stage":3,…}` then completed the MCP handshake — `initialize` → result with
  `instructions`, `tools/list` → one `codegraph_setup_guidance` tool, `tools/call` →
  success-shaped text; **exit 0, no `isError` anywhere**. **(d)** AUTO mode reproduced the
  realistic end-to-end chain: `{"ev":"npx_probe_failed","status":1,…,"enotcached":true}` →
  `{"ev":"stage","stage":3}` → the same success-shaped handshake, **exit 0**.
- **supported claim** — on Linux the absent-binary path is **success-shaped, identically to
  macOS**: any `npx`-stage failure (here the offline cache-miss `ENOTCACHED`; the same
  fall-through covers corrupt/partial cache, npx/runtime unavailable, or a spawned-but-
  nonfunctional package) degrades to a live MCP server serving **USER-framed** install guidance
  (FR-021), never a failed spawn or `isError` (FR-006, errors-teach-abandonment). Stage-2
  warm-cache viability is npm-cache mechanics (host-independent) and is shown on macOS
  (`LX-CC-STAGE2-001` / `LX-CX-STAGE2-001`); it was not separately re-warmed on Linux. Public
  citations: C7 (`--offline` = only-if-cached); PRD OQ-8.

**`LX-LNX-RUNTIME-001` — FR-006 runtime check on Linux (what runtime the host provides).**
- **subject** — the runtime a Linux host hands the plugin MCP subprocess (do NOT assume `node`).
- **host + pinned version** — `node:22-bookworm` (Node v22.23.1) under Docker 29.5.3.
- **exact repro command** — the launcher's `launcher_start` self-report captured at startup.
- **quoted manifest/config snippet** — manifest command shape
  `"command":"node","args":["…/launcher.mjs"]`.
- **observed behavior** —
  `{"ev":"launcher_start","execPath":"/usr/local/bin/node","nodeVersion":"v22.23.1","cwd":"/","hasPATH":true,…}`
  — the bare `command:"node"` resolved to the **container's own `/usr/local/bin/node`**; no host
  injected a runtime.
- **supported claim (FR-006)** — consistent with macOS (`LX-CC-RUNTIME-001` /
  `LX-CX-RUNTIME-001`): a bare `command:"node"` resolves against the environment's PATH; on Linux
  that is the base image's node. The launcher/manifest must not assume a specific runtime is
  provided by the host — the resolved codegraph binary is self-sufficient (bundled ≥22.5 Node),
  but the `npx` bootstrap and any `command:"node"` launcher depend on the environment providing
  node/npx. Public citation: C3.

### 5.F Launcher contract (synthesis) — **T014**

_The ordered fallback the plugin channel's stub launcher implements, synthesized from the
§5.A (Claude/macOS, `LX-CC-*`), §5.C (Codex/macOS, `LX-CX-*`), §5.D (Windows attempt,
`LX-WIN-*`), and §5.E (Linux/Docker, `LX-LNX-*`) evidence. This closes the FR-005/FR-006
bars; the OQ-8 verdict is §5.G; the full FR-021 network/telemetry parity affirmation is
§5.H (T029)._

**The contract — three ordered stages.** The plugin's `.mcp.json` declares a **stub
launcher** (`command:"node"`, `args:["${CLAUDE_PLUGIN_ROOT}/mcp/launcher.mjs"]` on Claude
Code; `command:"node", args:["./mcp/stub-launcher.mjs"]` on Codex — the plugin-channel
analogue of the installer's Claude `.mcp.json` / Codex `config.toml`
`[mcp_servers.codegraph]` entry). On spawn the launcher resolves, in order:

1. **Stage 1 — PATH-resolved installed binary.** If a `codegraph` binary resolves (on
   PATH, via `$CODEGRAPH_BIN`, or an absolute path), `exec <bin> serve --mcp` — the real
   MCP server comes up and its tools appear. **Refinement (GUI-PATH finding,
   `LX-CC-STAGE1-001`):** bare-name `codegraph` is **NOT** on the GUI-inherited PATH on
   macOS (`command -v codegraph` → not found; the plugin subprocess received the launched
   app's inherited environment, **not** a fresh login shell — it carried `node` but not
   `codegraph`). This is the in-repo **Antigravity darwin-only precedent realized**
   (FR-007). Stage 1 must therefore **not assume bare-name resolvability** — it needs
   **login-shell PATH resolution or absolute-path resolution**. A clean Linux host
   likewise has no bare `codegraph` (`LX-LNX-STAGE1-001`), so "binary absent" is the
   realistic default and stage 1 falls through cleanly.

2. **Stage 2 — `npx --offline` thin-installer, cache-first.** With no PATH binary,
   `npx --offline --yes @colbymchenry/codegraph@^1 serve --mcp`. `--offline` = npm's
   `only-if-cached` (C7): a **warm npm cache serves the shim locally with zero network**;
   a cold cache fails **catchably** (`npm error code ENOTCACHED`, exit 1 —
   `LX-CC-STAGE3-001` / `LX-CX-STAGE3-001` / `LX-LNX-STAGE3-001`), the exact signal the
   launcher catches to fall through. **CRITICAL refinement — the two-hop offline finding
   (`LX-CC-STAGE2-001`):** `npx --offline` makes only the **npm-registry hop** (the
   thin-installer *shim*) offline. The shim, once running, **fetches a ~50 MB per-platform
   bundle from GitHub Releases** — a **SECOND network dependency that `--offline` does NOT
   cover** (observed verbatim: *"codegraph: platform bundle missing … downloading
   codegraph-darwin-arm64.tar.gz from GitHub Releases (1.4.0)…"*, staged atomically under
   `~/.codegraph/bundles/`). So the **full offline-serve condition is: warm npm cache AND
   the platform bundle already present on disk** — not the npm cache alone. When **only the
   shim is cached** (bundle absent), the bundle fetch is a network action taken in the
   user-initiated launch context: **if it completes, the server comes up; if it is blocked
   (offline / air-gapped), the missing bundle is a stage-2 failure that falls through to
   stage-3 guidance**, never a hang.

3. **Stage 3 — success-shaped setup guidance (the stub).** When nothing resolves — no PATH
   binary and any npx-stage failure — the launcher **still starts an MCP-speaking process**
   (it never fails to spawn) and answers the handshake **success-shaped**: `initialize` →
   server info + `instructions`; `tools/list` → a single `codegraph_setup_guidance` tool;
   `tools/call` → success-shaped guidance text; **exit 0, no `isError` anywhere.**
   Validated end-to-end on Claude/macOS (`LX-CC-STAGE3-001`), Codex/macOS
   (`LX-CX-STAGE3-001`), and Linux/Docker (`LX-LNX-STAGE3-001`) — the host spawned the stub
   and it completed the handshake, the model treating the reply as guidance, not an error.
   This honors **errors-teach-abandonment** (one `isError` early and the agent abandons
   codegraph — FR-006): the absent-binary path is **guidance, never a failed spawn**.

**Any-npx-stage-failure fall-through (not only the offline cache-miss).** The stage-2 →
stage-3 fall-through is triggered by the offline cache-miss (`ENOTCACHED`) **and equally
by** a corrupt/partial npm cache, `npx`/runtime unavailable, a spawned-but-nonfunctional
package, **and the missing-bundle second-hop failure above**. Every one degrades to the
same live stage-3 stub guidance — never a failed-to-spawn surface.

**Install command is a USER action (FR-021).** The stage-3 guidance frames installation as
a **user** step — *"a USER should run: `npx @colbymchenry/codegraph@^1 install` (or
`codegraph install`). No action is taken automatically."* The agent **never**
auto-installs; the launcher's pre-exec path (binary discovery, PATH resolution,
npx-fallback logic) takes no install action of its own.

**Runtime self-sufficiency condition (FR-006).** **Finding: the hosts provide the plugin
MCP subprocess NO runtime of their own.** A bare `command:"node"` resolves against the
host's **inherited PATH** — confirmed on Claude Code (`LX-CC-RUNTIME-001`: `execPath` = the
PATH-resolved nvm `node v24.11.1`; the host injected no bundled runtime), Codex
(`LX-CX-RUNTIME-001`: bare `node` → the user's nvm node via the inherited login-shell PATH,
no runtime guarantee), and Linux/Docker (`LX-LNX-RUNTIME-001`: bare `node` → the base
image's `/usr/local/bin/node`). The **resolved codegraph binary is runtime-self-sufficient**
(it ships its own ≥22.5 Node in the ~50 MB bundle), but the **npx bootstrap and any
`command:"node"` launcher depend on the host PATH providing `node`/`npx`** — so the
launcher/manifest must not assume a host-provided runtime (pin an absolute/known
interpreter, or resolve one), the same PATH-scoping exposure as stage 1.

**Disclosure + supply-chain + Principle VII reconciliation (FR-005).** The contract carries
three deliberate, disclosed properties:

- **`npx --offline`, not `-y`/`--prefer-offline`** — `--prefer-offline` still requests
  missing data (C7); `--offline` guarantees zero network for the shim hop, which is why
  stage-2's offline behavior is well-defined (the only residual network is the disclosed
  second-hop bundle fetch above).
- **Major-version pin `@colbymchenry/codegraph@^1`, not floating `latest`** — the OWASP
  **CICD-SEC-3** (Dependency Chain Abuse, C8) / npm "Shai-Hulud"-family latest-tag
  mitigation, diverging deliberately from the unpinned `npx -y` MCP-reference pattern.
- **~50 MB per-platform-per-version bundle weight** — disclosed as the cold-fetch cost the
  npm channel already carries (the stage-2 second hop).

These reconcile with **Constitution Principle VII (no new egress/telemetry beyond the npm
channel):** every network action in the contract — the npm-registry shim hop and the
GitHub-Releases bundle hop — is **identical to what the existing npm channel already
performs**; the plugin stub adds **no** new endpoint, phone-home, or auto-install, and its
pre-exec path performs no independent network/telemetry/install action. (The full
component-wise FR-021 parity affirmation — stub launcher, prompt hook, bundled skills,
bundled agents — is recorded in §5.H, T029.)

### 5.G OQ-8 resolution — **T015**

_Closes FR-008, SC-003: a reader identifies the chosen launcher contract with no further
research. Resolved from the recorded §5 evidence in the PRD's own terms (`research.md` §1
hypothesis)._

**OQ-8 is RESOLVED: the PRD's ordered-fallback launcher contract — PATH-resolved installed
binary → `npx --offline` thin-installer fallback → success-shaped setup guidance when
absent (never a hard error) — is CONFIRMED in mechanism and ADOPTED as specified in §5.F,
with two evidence-backed refinements; the hypothesis was NOT falsified, so per
design-concept Q2 no equal-weight launcher trade study is produced.**

**Mechanism confirmed (hands-on).** Stage-3 success-shaped guidance was validated
end-to-end on **both hosts and Linux** — Claude/macOS (`LX-CC-STAGE3-001`), Codex/macOS
(`LX-CX-STAGE3-001`), Linux/Docker (`LX-LNX-STAGE3-001`); the npx-stage failure is a
**catchable** `ENOTCACHED`/exit-1 signal (not a hang or crash); the stub completes the MCP
handshake and returns `codegraph_setup_guidance` with **no `isError` anywhere**. The
ordered fallback resolves exactly as the PRD hypothesized.

**Two refinements (evidence-backed — they sharpen, not falsify, the contract SPEC-026
implements):**

1. **Stage-1 GUI-PATH scoping.** Bare-name `codegraph` is absent from the GUI-inherited
   PATH on macOS (`LX-CC-STAGE1-001`) and from a clean Linux host (`LX-LNX-STAGE1-001`) —
   the Antigravity darwin-only precedent realized (FR-007). SPEC-026 implements stage 1 to
   resolve via **login-shell PATH or absolute path**, not to assume bare-name
   resolvability.
2. **Stage-2 two-hop offline condition.** `npx --offline` makes only the **npm-shim** hop
   offline; the shim's **~50 MB GitHub-Releases bundle fetch is a second hop `--offline`
   does not cover** (`LX-CC-STAGE2-001`). The offline-serve guarantee holds only when
   **npm cache AND the platform bundle** are both on disk; a shim-cached-but-bundle-absent
   offline launch falls through to stage-3 guidance. SPEC-026 implements the stage-2 →
   stage-3 fall-through to treat a missing bundle as a stage-2 failure.

**Scope of the confirmation.** Confirmed on macOS (both hosts) + Linux; the Windows launcher
stages are **staged-deferred on a host-reachability blocker** (§5.D `LX-WIN-ATTEMPT-001`:
VM suspended with no IP, `.parallels` credentials absent) — a deferral, **not a
falsification** of the contract mechanism, so it does not re-open OQ-8 (tracked to
SPEC-026's pre-ship gate and the §11 close-out).

**Q2 guard satisfied.** Validation confirmed the PRD lean (with the two refinements), so
re-opening a full equal-weight trade study (PATH-only vs npx vs install-on-first-use
prompt) would re-litigate a decided-and-now-validated recommendation — a Simplicity-First
violation. **None is produced.** The chosen contract is §5.F; SPEC-026 scaffolds against it
with no further launcher research (SC-003). Public grounding: PRD OQ-8; C3, C7, C8, C9.

### 5.H Network/telemetry parity affirmation (FR-021) — **T029**

_Closes FR-021 in full. §5.F records the Constitution Principle VII reconciliation of the
launcher's two network hops; this block is the **component-wise** affirmation across every
plugin component, synthesized from the recorded §5 launcher evidence and the §3/§4 audit —
no new validation, an affirmation over evidence already in this document._

**Affirmation: the plugin channel introduces NO phone-home, egress, telemetry, or
auto-install beyond what the npm channel already performs.** Component by component:

- **Stub launcher / MCP server.** On resolution the launcher `exec`s the **same
  `codegraph serve --mcp` binary the npm installer configures** (`LX-CC-STAGE1-001` /
  `LX-CX-STAGE1-001`), so the running server's network/telemetry posture is
  **byte-identical** to the npm channel — the plugin adds no endpoint, phone-home, or
  telemetry the binary does not already have, and every existing opt-out
  (`codegraph telemetry off`, `CODEGRAPH_TELEMETRY=0`, `DO_NOT_TRACK=1`) applies unchanged
  because it is **literally the same binary**. The only network actions in the entire
  contract are stage 2's npm-registry shim hop and GitHub-Releases bundle hop — **both are
  the existing npm thin-installer's own actions, reused verbatim** inside a user-initiated
  install context, with the two-hop weight already disclosed (§5.F).
- **Stub launcher PRE-EXEC path.** Binary discovery (`command -v` / `$CODEGRAPH_BIN` /
  absolute-path resolution), PATH resolution, and the `npx --offline` fallback logic perform
  **no independent network, telemetry, or auto-install action of their own**: stage 1 is a
  local `command -v` lookup; stage 2 is `npx --offline` (npm's `only-if-cached` — **zero
  network** on a cold cache, a catchable `ENOTCACHED`, C7); stage 3 is a purely local stub
  that only completes the MCP handshake over stdio and returns success-shaped **USER-framed**
  guidance (`LX-CC-STAGE3-001` / `LX-CX-STAGE3-001` / `LX-LNX-STAGE3-001`) — it **never
  auto-installs** (the install command is always a user action, FR-021). The stub reaches no
  endpoint and writes no telemetry.
- **Prompt front-load hook.** The `UserPromptSubmit` hook emits `additionalContext` locally
  from a bundled script (`CC-HOOK-001` / `CX-HOOK-PROMPT-001`) — no network call, no
  telemetry; the plugin-channel analogue of the installer's existing prompt hook, same
  posture.
- **Bundled skills.** Skills are static `SKILL.md` text the host loads (§4.2, §9) — inert
  data: no process, no egress, no telemetry.
- **Bundled agents (Claude) / agent TOML (Codex).** Agent definitions are static
  frontmatter/TOML (§3.5, §4.5); they spawn only host-mediated subagents over the same tool
  surface, adding no independent egress or telemetry.

**Roster-currency clause.** This affirmation is scoped to the components the plugin ships
**today** (stub launcher / MCP server, prompt hook, skills, agents). **Any later component
type** — an LSP server, a background monitor/daemon, a PATH-exposed executable, or an
additional hook — **MUST re-run this component-wise affirmation before shipping**; a new
component type does not inherit parity from this list.

**Net-new-surface finding (SPEC-026).** **None was discovered.** Across all §5 launcher
evidence and the §3/§4 audit, no plugin component introduced a network endpoint, phone-home,
telemetry sink, or auto-install path absent from the npm channel. Had validation surfaced
one, it would be recorded here as an explicit SPEC-026 finding — the evidence shows none.
Public grounding: Constitution Principle VII; PRD OQ-8; C7.

---

## 6. Component × host ownership matrix

_Closes: US3/US4 — FR-009, FR-010, FR-013. The 8-cell table: component (MCP server,
prompt front-load hook, skills, agents) × host (Claude Code, Codex); each cell states
can-carry? + exactly one decided owner (**plugin-owned** / **installer-owned** /
**explicitly-absent**); the MCP-Claude owner reconciled with the FR-011 dedup lever;
installer-gap cells flagged as new SPEC-026 capability._

> **Done bar.** Every cell carries one of the three decided outcomes, none
> blank/undecided (SC-004).

_Status: **Drafted (T019).** The 8 cells are decided from §3 (Claude audit), §4 (Codex
audit — §4.4 MCP, §4.5 subagent distinction, §4.8/T017 hook, §4.9/T021 subagent runtime),
§5 (launcher), and §7.A/§7.B (dedup lever + near-duplicate). Every cell carries exactly one
decided outcome; none blank (SC-004). The MCP × Claude cell is reconciled with the §7.A
lever-(i) decision per FR-009 (owner = the active registration after host dedup)._

### 6.1 The 8-cell matrix

Each cell states **can-carry?** (whether the host's plugin format can bundle the component)
and its single **owner** — one of **plugin-owned** / **installer-owned** (*new* = new SPEC-026
installer capability per FR-009) / **explicitly-absent**. Can-carry and owner diverge on
exactly one cell (MCP × Claude): the plugin *can* carry the server, but the lever-(i)
reconciliation assigns the active registration to the installer.

| Component | Claude Code | Codex |
|---|---|---|
| **MCP server** | can-carry **yes** → **installer-owned** (lever i; §7.A). The plugin carries the launcher (§3.2, §5), but the installer's manually-written entry is the persistent/active registration (FR-009). The registration itself is existing installer behavior; the cross-channel FR-012 detection that keeps it single is *new*. | can-carry **yes** → **plugin-owned**. Bundle `.mcp.json` registers and Codex spawns it (§4.4, validated); no host dedup on Codex, so the FR-009 default holds. The installer keeps its `config.toml` entry, reconciled by FR-012 detection + user toggle (§7.C). |
| **Prompt front-load hook** | can-carry **yes** → **plugin-owned**. `hooks/hooks.json` `UserPromptSubmit` fires and injects `additionalContext` (§3.3, validated; top-level `hooks` wrapper required). | can-carry **yes** → **plugin-owned**, version-gated **ON at Codex ≥ 0.144.0** (§4.8/T017; post-#19705, `plugin_hooks` flag removed). One interactive `/hooks` trust step outstanding for the model-reach leg. **Not** "absent on Codex." |
| **Skills** | can-carry **yes** → **plugin-owned**. `skills/<name>/SKILL.md` bundle loads (§3.1/§3.3). | can-carry **yes** → **plugin-owned**. Manifest `skills` pointer → `SKILL.md` tree copied to cache on install (§4.2). |
| **Agents** | can-carry **yes** → **plugin-owned**. Bundled `agents/<name>.md` validated (§3.5: `--strict` passes; tool inheritance + `disallowedTools`; `hooks`/`mcpServers`/`permissionMode` security-excluded). | can-carry **no** → **installer-owned** (*new SPEC-026 capability*). The plugin format cannot bundle subagents (§4.5: no `agents` pointer; agents load from `.codex/agents/*.toml`, not the bundle; `interface` block is branding only). The installer writes standalone `.codex/agents/*.toml`; **gated on the §4.9/T021 v2 config-fidelity staged deferral**. |

### 6.2 Three-outcome discipline — no blank, no forced absent (SC-004, FR-010)

Every cell resolves to one of the three labeled outcomes; **none is explicitly-absent.** The
two cells the PRD flagged as absent-candidates both resolved to a positive owner on the
evidence, not a blank:

- **Prompt hook × Codex** — the roadmap's likely-Codex-casualty — is **plugin-owned**, not
  absent: T017 (§4.8) validated the hook firing on the shipped build (≥ 0.144.0). "Absent on
  Codex" is recorded *only* for a pre-0.144.0 / pre-#19705 build (the version gate).
- **Agents × Codex** is **installer-owned** (new capability), not absent: the plugin format
  cannot carry it, but standalone `.codex/agents/*.toml` is CLI config the installer can write.

**New-capability flags (FR-009).** Two installer-owned outcomes; their novelty differs:

- **Agents × Codex — new.** The installer writes no agent TOML today (only
  `config.toml [mcp_servers.codegraph]`), so this is net-new SPEC-026 installer capability.
- **MCP server × Claude — existing registration, new detection.** The installer already writes
  a Claude MCP entry today; only the cross-channel FR-012 *detection* that keeps the coexisting
  registration single is new.

### 6.3 MCP × Claude — the lever-(i) reconciliation and its realization (FR-009 / FR-011)

Per FR-009, the one host-deduplicated cell records as owner the channel whose entry is the
**active registration after host dedup** — the installer under the §7.A **lever (i)** decision.
So **MCP × Claude = installer-owned**, overriding the FR-009 plugin-owns-config-writing default
for this cell precisely so the matrix owner (FR-010) and the coexistence lever (FR-011) never
disagree on it.

**Realization — which mechanism the contract picks.** The §7.B near-duplicate evidence
(NEARDUP-001…004) shows host dedup will **not** deliver lever-(i) suppression when the two
channels' launcher commands differ textually — which they always do: the plugin's command is
`${CLAUDE_PLUGIN_ROOT}`-relative (`node ${CLAUDE_PLUGIN_ROOT}/mcp/launcher.mjs`) and cannot be
made byte-identical to the installer's `codegraph` / `npx @colbymchenry/codegraph@^1` / dogfood
`node dist/bin/…` command. So of the two ways to realize lever (i) — **command-string
alignment** or **installer-side FR-012 detection** — the contract picks **installer-side
FR-012 detection** (command-string alignment is infeasible via `${CLAUDE_PLUGIN_ROOT}`). Host
dedup remains a partial backstop for the exact-match case only; the full coexistence mechanics
are §7.C.

---

## 7. Coexistence + uninstall interplay

_Closes: US3 — FR-011, FR-012. Detection/dedupe in BOTH directions
(plugin-detects-installer, installer-detects-plugin); the host-arbitrated Claude dedup
lever decision (i vs ii); the Codex levers; the non-viability of plugin-side
self-suppression (JSON-RPC -32000) with the empty-`tools/list` fallback;
invocation-driven uninstall restore with no orphaned entries; the diagnostic ownership
for a both-present state that evades dedup._

> **Done bar.** Both directions stated; surviving channel stays functional; no duplicate
> registration / no double hook injection / no orphaned MCP entry or hook; and for the
> evades-dedup both-present case, who-reports-what and the user/agent observable are
> specified.

_Status: **Drafted (T020).** §7.A (T016 Claude host-dedup lever + decision) and §7.B (T018
4-step near-duplicate scenario, both hosts) record the evidence; §7.C synthesizes the
both-directions coexistence + uninstall interplay from it (FR-011, FR-012)._

### 7.A Claude host-dedup lever observation — **T016 evidence**

**`DEDUP-CC-001` — plugin-vs-manual MCP dedup + which channel's entry survives.**
- **subject** — the CHANGELOG "plugin-provided MCP server deduplication" behavior and the
  surviving MCP registration when installer + plugin coexist.
- **host + pinned version** — Claude Code 2.1.206, macOS; scratch plugin `codegraph-scratch` via
  `--plugin-dir`; a manual project `.mcp.json` `codegraph` server whose command is textually
  identical to the plugin server's.
- **exact repro command** — `claude --plugin-dir <scratch> mcp list` in a project whose
  `.mcp.json` declares a same-command `codegraph` server; corroborated by the authoritative
  public CHANGELOG entries (P4).
- **quoted config snippet** — manual `.mcp.json`:
  `{ "mcpServers": { "codegraph": { "command":"node", "args":["<abs>/mcp/launcher.mjs"], … } } }`;
  plugin `.mcp.json`: `{ … "args":["${CLAUDE_PLUGIN_ROOT}/mcp/launcher.mjs"] … }`.
- **observed behavior** — `claude mcp list` shows the plugin server as
  `plugin:codegraph-scratch:codegraph - ✔ Connected`. The manual project `.mcp.json` server did
  **not** go live — project `.mcp.json` servers are **approval-gated**, so in a non-interactive
  run they stay pending; the both-live-same-command state could not be forced without the
  interactive approval + `/plugin` UI. Authoritative dedup semantics (public CHANGELOG):
  **v2.1.71** — *"Improved plugin-provided MCP server deduplication — servers that duplicate a
  manually-configured server (same command/URL) are now skipped, preventing duplicate connections
  and tool sets. Suppressions are shown in the `/plugin` menu."* Refined by **v2.1.152** —
  *"Fixed plugin MCP servers with the same command but different environment variables being
  incorrectly deduplicated"* (dedup key = command **and** env).
- **supported claim** — dedup **suppresses the plugin copy**; the **manually-configured
  (installer) entry wins**; the key is **textually-identical command/URL (+ env)**.
- **could not validate — requires interactive host UI (FR-003):** the `/plugin`-menu suppression
  **notice**, and forcing two same-command servers live (project `.mcp.json` approval). Exact step
  a human must run: in an interactive `claude` session in a project that has an **approved**
  same-command `.mcp.json` `codegraph` server **and** the plugin enabled, open `/plugin` and read
  the plugin `codegraph` MCP server's suppressed/skipped state.

**Lever decision (FR-011): LEVER (i)** — the npm installer **keeps** its manually-configured MCP
entry; rely on the host's built-in same-command/URL dedup to suppress the plugin's duplicate copy
(**manual/installer wins**). Basis (observed + authoritative):

1. The host's dedup is definitionally "manual wins, plugin copy skipped" (v2.1.71) — lever (i)
   **aligns with the host default**; no net-new installer deferral logic for the common case.
2. Lever (ii) (installer defers so only the plugin remains) would contradict the host default,
   require net-new installer logic to detect the plugin and remove/skip its own entry, and open a
   **zero-registered-server window** if the plugin is later disabled/uninstalled (the installer
   entry would be gone). Lever (i) keeps a working server if the plugin is disabled — resilience.
3. **Load-bearing caveat (observed):** host dedup keys on **textually-identical command/URL
   (+ env)**. The installer's command (`npx @colbymchenry/codegraph …` / bare `codegraph serve
   --mcp` / dogfood `node dist/bin/…`) will almost always differ textually from the plugin's
   (`node ${CLAUDE_PLUGIN_ROOT}/…`), so host dedup will **NOT fire automatically** — both would
   connect as two distinct namespaced tool sets (exactly the **T018** near-duplicate scenario).
   Realizing lever (i)'s suppression reliably therefore requires **either** command-string
   alignment between the two channels **or** the installer-side FR-012 detection (installer detects
   the plugin on its next invocation and skips/removes its redundant entry) — **not** host dedup
   alone. This is load-bearing for **T019** (the MCP × Claude cell owner = the active registration
   after dedup) and **T020** (coexistence prose).

### 7.B Near-duplicate coexistence scenario (both hosts) — **T018 evidence**

_The T016 caveat (§7.A item 3) predicted it: when the two channels' launcher commands **differ
textually but resolve to the same binary**, host dedup does **not** fire and both connect as two
distinct namespaced registrations. T018 forces that state hands-on on both hosts and records the
four step-observations (FR-011). Scratch plugins built outside the repo tree (never committed,
FR-019); Claude via `--plugin-dir` + an isolated `CLAUDE_CONFIG_DIR` (the user's real
`~/.claude.json` was verified byte-stable before/after — top-level `mcpServers` hash unchanged, no
`codegraph` entry added); Codex via an isolated `CODEX_HOME`. Abbreviations used below: `<node24>`
= the absolute Node path `…/v24.11.1/bin/node` (home-dir redacted), textually distinct from bare
`node` but the identical binary; `<PLUGIN>` = the scratch Claude plugin dir; `<CACHE>` = the Codex
plugin cache dir `…/codegraph-scratch/0.0.1`; `<iso>` = an isolated host config/home; `<proj>` =
a throwaway project dir._

**`NEARDUP-001` — both channels configured; commands differ textually, resolve to one binary.**
- **subject** — the two launcher command strings (plugin vs installer/manual) per host, and
  whether each pair resolves to the identical on-disk binary.
- **host + pinned version** — Claude Code 2.1.206 **and** Codex CLI 0.144.0; macOS darwin-arm64;
  Node v24.11.1; scratch plugin `codegraph-scratch`.
- **exact repro command** — `realpath` equality on each pair:
  `realpath <PLUGIN>/mcp/launcher.mjs` vs `realpath <PLUGIN>/mcp/../mcp/launcher.mjs` (Claude);
  `realpath <CACHE>/mcp/stub-launcher.mjs` vs `realpath <CACHE>/mcp/../mcp/stub-launcher.mjs`
  (Codex); and `command -v node` vs the absolute `<node24>`.
- **quoted config snippet** —
  Claude plugin `.mcp.json`: `"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/mcp/launcher.mjs"]`;
  Claude manual (`.mcp.json` / `--mcp-config`):
  `"command":"<node24>","args":["<PLUGIN>/mcp/../mcp/launcher.mjs"]`.
  Codex plugin (`codex mcp list`): `codegraph-scratch  node  ./mcp/stub-launcher.mjs  cwd=<CACHE>`;
  Codex direct (`config.toml`):
  `[mcp_servers.codegraph] command="<node24>" args=["<CACHE>/mcp/../mcp/stub-launcher.mjs"]`.
- **observed behavior** — every pair's two `realpath` values are byte-identical (same launcher
  file; same Node binary), while the command **text** differs on two axes: bare `node` vs absolute
  `<node24>`, and a `${CLAUDE_PLUGIN_ROOT}`/relative path vs an absolute path carrying a redundant
  `../mcp/` segment. (Node normalizes `argv[1]` at runtime, but each host's dedup key is the
  **pre-spawn config command string**, which stays distinct — `claude mcp list` and `codex mcp
  list` both echo the literal `../mcp/`.)
- **supported claim** — both channels are configured on both hosts with launcher commands that are
  **textually distinct yet binary-identical** — the exact near-duplicate FR-011 targets. VALIDATED.

**`NEARDUP-002` — both channels connect and run healthy, simultaneously.**
- **subject** — live connection status of the plugin server and the installer/manual server when
  both are loaded together.
- **host + pinned version** — Claude Code 2.1.206 (isolated `CLAUDE_CONFIG_DIR`; project `.mcp.json`
  `codegraph` pre-approved via seeded `enabledMcpjsonServers`); Codex CLI 0.144.0 (isolated
  `CODEX_HOME`); macOS.
- **exact repro command** — Claude:
  `CLAUDE_CONFIG_DIR=<iso> claude --plugin-dir <PLUGIN> mcp list`, and
  `claude -p --plugin-dir <PLUGIN> --mcp-config=<manual.json> --debug-file <f> "…"`;
  Codex: `CODEX_HOME=<iso> codex mcp list`, and
  `CODEX_HOME=<iso> RUST_LOG=info codex exec -C <proj> "reply hi"`.
- **quoted config snippet** — n/a (same configs as `NEARDUP-001`).
- **observed behavior** —
  **Claude** `mcp list`: `plugin:codegraph-scratch:codegraph … - ✔ Connected` **and**
  `codegraph <node24> …/mcp/../mcp/launcher.mjs - ✔ Connected` (both live at once); `-p --debug`
  transcript: `MCP server "codegraph": Successfully connected (transport: stdio) in 49ms` **and**
  `MCP server "plugin:codegraph-scratch:codegraph": Successfully connected … in 8103ms`.
  **Codex** `mcp list`: both `codegraph` and `codegraph-scratch` shown **enabled** (env value
  auto-masked `*****`); `codex exec` logs `mcp_servers="codegraph-scratch, codegraph"`,
  `mcp_server_count=2`, **two** distinct `rmcp::service: Service initialized as client` handshakes
  (each `server_info … name:"codegraph-scratch-stub"`), and **two** distinct stub runtime reports
  (bare `node` @ `<CACHE>`; `<node24>` @ `<proj>`). The later model turn returned `401
  Unauthorized` **only because the isolated `CODEX_HOME` carries no auth** — that is downstream of
  MCP init and does not affect server liveness.
- **supported claim** — the plugin channel and the installer/manual channel connect and run healthy
  **at the same time**, on both hosts, from textually-distinct same-binary commands. VALIDATED.

**`NEARDUP-003` — two distinct namespaced tool sets on Claude; two live registrations on Codex.**
- **subject** — the agent-facing tool namespaces (Claude) / server registrations (Codex) the two
  channels expose while coexisting.
- **host + pinned version** — Claude Code 2.1.206 (an agent session enumerates its own tools);
  Codex CLI 0.144.0; macOS.
- **exact repro command** — Claude:
  `claude -p --plugin-dir <PLUGIN> --mcp-config=<manual.json> "Output every tool name ending with
  'codegraph_setup_guidance', one per line."`; Codex: the `codex exec` MCP-init handshakes from
  `NEARDUP-002`.
- **quoted config snippet** — Claude stub `tools/list` advertises one tool
  `codegraph_setup_guidance`; Codex stub `tools/list` returns `[]` (empty by design).
- **observed behavior** — the **Claude** agent returned **both**
  `mcp__codegraph__codegraph_setup_guidance` (installer/manual channel) **and**
  `mcp__plugin_codegraph-scratch_codegraph__codegraph_setup_guidance` (plugin channel) — the two
  distinct namespaces `mcp__<server>__<tool>` and `mcp__plugin_<plugin>_<server>__<tool>`,
  reproducing the prior-track (T016) plugin-side name. On **Codex** the two servers register under
  distinct config identities `codegraph` and `codegraph-scratch`, each completing MCP `initialize`;
  the Codex stub exposes no named tools (empty `tools/list` by design), so the Codex distinction is
  **server-level**, not tool-name-level.
- **supported claim** — the two channels surface as **two distinct namespaced tool sets** on Claude
  Code and **two distinct live registrations** on Codex — no merge, no shared namespace. VALIDATED.

**`NEARDUP-004` — nothing fires: no host auto-suppression (Claude), no duplicate warning (Codex).**
- **subject** — whether any host dedup / suppression / duplicate-warning surface activates in the
  both-present, textually-distinct-command state.
- **host + pinned version** — Claude Code 2.1.206; Codex CLI 0.144.0; macOS.
- **exact repro command** — Claude: grep the `-p --debug` transcript for
  `dedupl|suppress|skipp…server`; Codex: grep the `codex exec` stderr for
  `duplicat|dedup|collision|conflict|already registered|skipping` (CA-cert/refresh-token
  "override" lines excluded as false positives).
- **quoted config snippet** — n/a (the finding is an absence).
- **observed behavior** — **Claude:** **zero** dedup/skip/suppress lines in the debug transcript,
  and both `mcp__…` tool sets live simultaneously (`NEARDUP-003`). This is the predicted non-event:
  host dedup (CHANGELOG v2.1.71) keys on **textually-identical command/URL (+ env)** (v2.1.152), and
  the two commands differ on both axes, so it does **not** fire. **Codex:** **zero**
  duplicate/dedup/collision/conflict warnings across the full `codex exec` log — the only `WARN` is
  an unrelated `failed to warm featured plugin ids cache … 401` network fetch, and the only
  `ERROR`s are the no-auth `401` model retries; distinct config-table names (`codegraph` vs
  `codegraph-scratch`) mean Codex never treats the pair as duplicates.
- **could not validate — interactive host UI (FR-003):** the `/plugin`-menu **visual** confirmation
  that the plugin `codegraph` MCP server shows **no** suppressed/skipped badge in this
  near-duplicate state. Exact step a human must run: in an interactive `claude` session in the T018
  project with the plugin enabled **and** an approved same-named `codegraph` `.mcp.json`, open
  `/plugin` and confirm the plugin server is listed **active with no suppression notice**.
- **supported claim** — in the near-duplicate (textually-distinct, same-binary) state **nothing
  fires**: no Claude host auto-suppression and no Codex duplicate warning; the two channels coexist
  as independent registrations. The non-event **is** the finding (FR-011). VALIDATED (structural);
  the `/plugin` visual badge-absence is the single could-not-validate item, deferred to the human
  step above.

**Structural non-collision — held on both hosts.** Because the two channels register under
**distinct identities** — Claude `codegraph` vs `plugin:codegraph-scratch:codegraph`; Codex
`codegraph` vs `codegraph-scratch` — and host dedup keys on textually-identical command text, the
textually-distinct-same-binary near-duplicate yields **two independent namespaced registrations
with no host-side collapse**. This is the T016 caveat realized: lever (i)'s suppression is **not**
delivered by host dedup when the command strings differ.

**Reporter of the evades-dedup both-present state (FR-012).** With host dedup silent, diagnostic
ownership of the redundant-but-live pair falls to the **installer's next-invocation detection**: on
the next `codegraph install`, the installer detects the coexisting plugin registration and
reconciles its own redundant entry (skip/remove) — this is what realizes lever (i) when
command-string alignment is absent, **not** the host. The four observations above are the evidence
base credited to that reporter; T020 writes the full both-directions coexistence prose (the
installer-detects-plugin direction, the residual-window observable, and the Codex
`plugins.<plugin>.mcp_servers.<server>.enabled` user toggle).

### 7.C Coexistence + uninstall interplay (synthesis) — T020

_Both-directions detection/dedupe, the lever-(i) realization, the Codex levers, the
non-viability of plugin-side self-suppression, and the invocation-driven uninstall restore —
synthesized from the §7.A (T016) and §7.B (T018) evidence. Closes FR-011, FR-012._

**Invariant.** Exactly one registered MCP server per capability is the coexistence goal on
both hosts (FR-011). The FR-009 default — the plugin owns config-writing for every component
its host format can carry; the installer keeps binary-distribution and covers gaps — holds for
every cell except the one the host natively deduplicates (MCP × Claude), reconciled by the
lever below.

**Detection/dedupe — both directions.**

- **Installer-detects-plugin (both hosts; new SPEC-026 capability).** Keys on the installed
  plugin's directory/manifest presence — today's installer detection sees only its own config
  entries, so this is net-new. On the next explicit `codegraph install`, the installer detects
  the coexisting plugin and **skips or offers to remove its own** redundant MCP (and, on Claude,
  hook) entries. This is both the realization of lever (i) when host dedup is silent and the
  **reporter** for the evaded-dedup near-duplicate (FR-012).
- **Plugin-detects-installer (asymmetric BY HOST).**
  - *Claude Code:* the host itself arbitrates. Host dedup (CHANGELOG v2.1.71) suppresses a
    plugin-declared server whose command/URL — and env (v2.1.152) — duplicates the
    manually-configured (installer) entry; the manual entry wins; the suppression shows in
    `/plugin` (`DEDUP-CC-001`). **But** when the two commands differ textually — the real case —
    host dedup does **not** fire (§7.B).
  - *Codex:* no native cross-channel dedup exists. Plugin-detects-installer has no host
    mechanism; coexistence rests on the installer's FR-012 detection plus the user-side toggle.

**Lever-(i) decision + its realization mechanism.** §7.A decides **lever (i)**: the installer
keeps writing its MCP entry (it does **not** defer), so a working server always survives the
plugin being disabled or removed — the resilience that rejected lever (ii). Realizing lever
(i)'s single-registration outcome requires **either** command-string alignment between the two
channels **or** the installer-side FR-012 detection — **not host dedup alone**, because host
dedup keys on textually-identical command/URL (+ env) and the two commands always differ
(NEARDUP-001/004): the plugin's command is `${CLAUDE_PLUGIN_ROOT}`-relative
(`node ${CLAUDE_PLUGIN_ROOT}/mcp/launcher.mjs`) and cannot be made byte-identical to the
installer's `codegraph` / `npx @colbymchenry/codegraph@^1` / dogfood `node dist/bin/…` command.
**The contract picks installer-side FR-012 detection** (command-string alignment is infeasible
via `${CLAUDE_PLUGIN_ROOT}`); host dedup stays a partial backstop for the exact-match case only.
Until that next install runs, the near-duplicate is a **tolerated, harmless** state — two
distinct namespaces, no collision, no host warning (§7.B) — and the installer's entry remains
the active/persistent registration, so the §6 matrix owner is **installer** (FR-009).

**The Codex levers.** Two, both non-host:

1. **Installer-detects-plugin** (new capability, above).
2. **User-side per-server `config.toml` toggle** `plugins.<plugin>.mcp_servers.<server>.enabled`
   (§4.7) — the user disables the plugin's server, or disables the installer's via
   `[mcp_servers.*]`.

**Plugin-side self-suppression is non-viable.** Neither plugin format exposes a plugin-side
"skip starting my declared server" field. An exit-before-handshake self-suppression attempt
surfaces as an MCP protocol error — JSON-RPC **-32000** on Claude Code, actively reported to
the host (FR-011) — so it is **not** a viable mechanism. The one constructible plugin-side form,
if suppression is ever required, is a **completed handshake returning an empty `tools/list`** —
exactly the shape the stub launcher already produces (Codex stub `tools/list` → `[]`,
NEARDUP-003; the §5 stage-3 stub). Recorded as the only viable plugin-side fallback.

**Uninstall interplay — invocation-driven restore, no orphans (FR-012).**

- **Removing the plugin.** The installer re-detects the absence and restores its own entries —
  **invocation-driven, on the next explicit `codegraph install` re-run** (each target's existing
  install-time self-heal precedent), never automatically via a file watcher or background
  process.
- **No orphaned MCP entry or hook.** Each channel strips only its own. The installer's
  `codegraph uninstall` removes only what it wrote (its MCP registration and, on Claude, the
  front-load prompt hook) and MUST NOT touch the plugin's entries; the plugin's components are
  plugin-scoped (they live in the plugin, not the user's host config — FR-001), so removing the
  plugin removes them **atomically**, leaving no dangling host-config entry pointing at an absent
  plugin.
- **No zero-registered-server window under lever (i).** The installer's entry persists through a
  plugin disable/removal (that is lever (i)'s whole point). *Road not taken:* under lever (ii)
  the installer would have deferred, so plugin removal would leave **zero** registered servers
  until the invocation-driven `codegraph install` restore — the window §7.A item 2 flagged and
  lever (i) avoids. Stated, not implied.

**Who-reports-what for the evaded-dedup both-present state + the residual-window observable
(FR-012).**

- **Claude Code:** the host `/plugin` dedup surface reports only exact command/URL-match
  duplicates, so for the textually-divergent near-duplicate **nothing fires** (NEARDUP-004):
  two healthy servers, two distinct namespaced tool sets (`mcp__codegraph__…` and
  `mcp__plugin_codegraph-scratch_codegraph__…`), no host-surfaced warning. The reporter is the
  **installer's next-invocation FR-012 detection.**
- **Codex:** no cross-scope dedup/collision surface exists at all, so a both-present duplicate
  has **no host reporter by construction.** The only remediators are the user-side `config.toml`
  toggle and the installer's next-invocation detection; the **residual-window observable** is
  duplicate servers/hooks persisting until the next `codegraph install` re-run.
- **Not a `codegraph status` role.** `status` reports index health today and carries no
  config-diagnostic precedent to extend (FR-011); the reporter is the install-time detection on
  both hosts.

---

## 8. Degraded-Codex subset

_Closes: US4 — FR-013. The matrix cells the Codex plugin format cannot carry, each
reassigned to the npm installer per the matrix (a no-installer-coverage-today cell — e.g.
the Codex prompt front-load hook — resolves to **new SPEC-026 capability** or
**explicitly-absent**, decided on the T017 pinned-build evidence); the **agents** cell
gated on the T021 pinned runtime/model pairing; the asymmetry vs Claude Code documented;
each degraded/absent cell's DECIDED runtime user-observable._

> **Done bar.** Subset named; each unsupported cell assigned per the matrix; each
> degraded/absent cell observable-complete, not merely ownership-complete.

_Status: **Drafted (T022).** The degraded subset is decided from §4.5 (subagent distinction),
§4.8/T017 (Codex prompt hook), §4.9/T021 (subagent runtime pinning), and the §6 matrix. Each
degraded/absent cell carries a DECIDED runtime observable (FR-013), not merely an owner._

### 8.1 The degraded subset — exactly one cell

Of the eight matrix cells, the **only** component the Codex plugin format cannot carry is
**agents**. The Codex plugin is therefore **minimally degraded**: it ships three of its four
components exactly as the Claude plugin does, and only agents fall to the installer.

- **MCP server × Codex** — plugin-owned (§4.4, validated). Not degraded.
- **Skills × Codex** — plugin-owned (§4.2). Not degraded.
- **Prompt front-load hook × Codex** — **plugin-owned, NOT degraded on the shipped build.**
  This is the corrected finding. The PRD/roadmap flagged the Codex prompt hook as the likely
  casualty (the Codex installer writes no hook today, unlike Claude's `UserPromptSubmit`
  front-load hook); T017 (§4.8) instead found the plugin-bundled `UserPromptSubmit` hook
  **version-gated ON at Codex ≥ 0.144.0** — it fires and emits `additionalContext` (post-#19705;
  `plugin_hooks` flag removed). Two documented (never silent) caveats: (a) **version gate** — a
  pre-0.144.0 / pre-#19705 build records the cell as "absent on Codex" instead; (b) a **one-time
  interactive `/hooks` trust review** is the human step that closes the end-to-end model-reach
  leg (§4.6/§4.8), the single could-not-validate item from T017.

### 8.2 The one degraded cell — agents × Codex

**Cannot be plugin-carried (§4.5, `CX-AGENTS-DISTINCT-001`).** The Codex manifest has no
`agents` component pointer; Codex loads custom agents from `.codex/agents/*.toml` (project) or
`~/.codex/agents/*.toml` (global), never from the plugin bundle. A plugin-root `agents/` dir /
`interface` block is branding metadata only and MUST NOT be conflated with an agent-loading
channel.

**Reassigned per the matrix to installer-owned — new SPEC-026 capability.** The installer
writes standalone `.codex/agents/*.toml`; it writes no agent TOML today (only
`config.toml [mcp_servers.codegraph]`), so this is net-new installer capability (FR-009/FR-010).

**Gated on the T021 v2 config-fidelity staged deferral (§4.9, `CX-SUBAGENT-V2-001`).** A named
subagent *does* spawn, but on the runtime this build selects — `multi_agent_version: v2`, mode
`explicitRequestOnly` — the agent's declared `model`/`role` are not honored. Recorded deferral,
verbatim:

> "Attempted: named-agent invocation of a standalone `.codex/agents/codegraph-explorer.toml`
> (declared model gpt-5.5) via `codex exec` on Codex CLI 0.144.0. Result: subagent thread_spawn
> succeeded but on `multi_agent_version:v2` the agent's declared model and role were not honored
> (ran parent model gpt-5.6-sol, agent_role null) — the #15250/#20077 v2 config-fidelity
> limitation. Blocker: the shipped CodeGraph agent/model pairing (SpecKit-Codex agents declaring
> gpt-5.5) cannot be exercised with full fidelity on the v2 runtime this build selects. SPEC-026
> must confirm named-agent config fidelity (declared model + role applied) on the exact shipped
> runtime/model pairing — or ship agents in a form that does not depend on per-agent model/role
> override — before relying on Codex subagents."

### 8.3 Asymmetry vs Claude Code

Exactly one cell differs between the two hosts: **agents**.

- **Claude Code — plugin-owned:** subagents ship *inside* the plugin (`agents/<name>.md`,
  validated §3.5), inheriting tools by default with a `disallowedTools` denylist.
- **Codex — installer-owned, new capability:** subagents must be written *outside* the plugin as
  standalone `.codex/agents/*.toml`, and even then per-agent model/role fidelity is unconfirmed
  on the shipped v2 runtime (deferred, §8.2).

All other cells are symmetric — plugin-owned on both hosts (the Codex prompt hook with the §8.1
version-gate + trust-step caveats). The asymmetry is thus narrow and fully localized to agent
bundling: a Codex user loses nothing a plugin bundle would otherwise provide except in-bundle
subagents, which the installer supplies instead.

### 8.4 DECIDED runtime user-observable per degraded/absent cell (FR-013)

The matrix has **no explicitly-absent cell**, so FR-013's silent-by-design / surfaced-note
branch does not fire; every unsupported cell is installer-covered, whose FR-013 default is
*functionally equivalent, no degraded signal*.

- **Agents × Codex (installer-covered, new capability): functionally equivalent, no degraded
  runtime signal.** The installer delivers the subagent as standalone TOML; it is invocable and
  spawns with no user-facing "missing feature" error (the §4.9 spawn succeeded). The T021 caveat
  is a *runtime-fidelity* gate, not a functional absence: until SPEC-026 confirms named-agent
  config fidelity on the exact shipped runtime/model pairing, an invoked agent may **silently**
  run on the parent session's model/role rather than its declared `model`/`role` (the v2
  limitation). That is flagged to SPEC-026's pre-ship gate, not surfaced to the user as an error
  today — the decided observable is "the subagent works; per-agent model/role override is the one
  unconfirmed dimension."
- **Prompt hook × Codex (context — not a degraded cell): functionally equivalent on ≥ 0.144.0.**
  The hook fires and injects context exactly as Claude's does. The one-time interactive `/hooks`
  trust review is a documented install-time human action, and the version gate (a pre-fix build
  → "absent on Codex") is a documented, not silent, outcome — a decided surfaced note, not an
  unspecified gap.

**Done bar (FR-013).** Subset named (agents × Codex); the unsupported cell assigned per the
matrix (installer-owned, new SPEC-026 capability); each degraded/absent cell
observable-complete — functionally equivalent, with the one deferred runtime-fidelity gate named
and routed to SPEC-026 — not merely ownership-complete.

---

## 9. Skill-authoring grounding + shipped-artifact plan

_Closes: US5 — FR-014, FR-015, FR-016, FR-022. **Opens** with the skill-authoring
grounding block (FR-022, roadmap scope bullet 2): the shared agent-skills open standard
+ per-host divergences; Anthropic's progressive disclosure / MCP-enhancement category /
trigger discipline / structural + security rules / `allowed-tools` + the skill-to-MCP
dependency mechanism as an audit output; OpenAI's `.agents/skills` scan order /
explicit-vs-implicit invocation / `agents/openai.yaml` sidecar / authoring best
practices; the vendors' published skill success criteria. **Then** the candidate
skill/agent enumeration with the three-leg inclusion criterion, per-artifact tier
decisions, trigger surfaces, the FR-015 A/B bar definition, and the reference-not-restate
(#529) line item per candidate; the agent class evaluated separately (retrieval-guardian
excluded)._

> **Done bar.** The skill-authoring grounding closes roadmap scope bullet 2 with public
> citations and all named elements present (SC-001); each candidate has a tier + a
> validation bar; excluded workflows recorded with reasons.

_Status: **drafted (T023).** The FR-022 skill-authoring grounding block (§9.1) is grounded
entirely in the public C6 source set (`research.md` §2a, fetched & verified 2026-07-10) and
in the §3/§4 hands-on audit for the per-host divergences; the candidate enumeration
(§9.2–§9.7) applies the FR-014 three-leg inclusion criterion, tiers each artifact, defines
the FR-015 A/B bar, and records the FR-016 reference-not-restate (#529) line item per
candidate. The single included candidate is drafted in full as the §10 exemplar; no other
body is drafted (Q4/Q5)._

**Public citations for this section (FR-004; all resolve to public sources — the
`research.md` §2a C6 ledger, fetched & verified 2026-07-10):**

- **S1** Agent Skills open standard — `https://agentskills.io`
- **S2** Agent Skills format specification — `https://agentskills.io/specification`
- **S3** Anthropic Agent Skills overview — `https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview`
- **S4** Anthropic Agent Skills best-practices — `https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices`
- **S5** "The Complete Guide to Building Skills for Claude" (public PDF) — `https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf` (FR-004: this public URL is cited, never the maintainer's local/vault copy)
- **S6** Anthropic engineering blog, "Equipping agents for the real world with Agent Skills" (2025-10-16) — `https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills`
- **S7** `anthropics/skills` (public examples + `./spec/`, `./template/`) — `https://github.com/anthropics/skills`
- **S8** Claude Code skills doc — `https://code.claude.com/docs/en/skills`
- **S9** OpenAI Codex "Build skills" — `https://developers.openai.com/codex/skills` (308 → `learn.chatgpt.com/docs/build-skills`)
- **S10** OpenAI curated plugin/skill examples — `https://github.com/openai/plugins` (the §2a-ledger public→public refresh of the DEPRECATED `github.com/openai/skills`)

### 9.1 Skill-authoring grounding block (FR-022 — closes roadmap SPEC-025 scope bullet 2)

This is a decided, citation-backed standard, not an aside: SPEC-026 authors every skill to
it with zero further research. All grounding is public (S1–S10); the two per-host divergence
columns are cross-checked against the §3/§4 hands-on audit.

**(a) The shared agent-skills open standard (S1, S2).** Both hosts implement the same open
standard: a skill is a directory whose `SKILL.md` carries YAML frontmatter (`name` +
`description`, plus optional `license`/`compatibility`/`metadata`/`allowed-tools`) followed
by a markdown body, with optional sibling `scripts/`, `references/`, and `assets/`
directories (S1, S2). One `SKILL.md` source tree therefore serves **both** hosts' skill
bodies unchanged (spec Assumptions; confirmed hands-on — the shared `SKILL.md` shape loaded
in Claude Code §3.3 and Codex §4.2). What does **not** transfer is per-host — the four
divergences the US1 audit enumerated, each an authoring decision SPEC-026 must make per host:

| Divergence | Claude Code (§3 audit) | Codex (§4 audit) |
|---|---|---|
| **Discovery directory** | Plugin `skills/<name>/SKILL.md` under the manifest `skills` pointer; also user/project `.claude/skills/` (S8, §3.1/§3.3). | Plugin `skills/<name>/SKILL.md` under the manifest `skills` pointer; standalone `.agents/skills` scan order and `~/.codex/skills/` (S9, §4.2). |
| **Tool-permission frontmatter** | `allowed-tools` is honored as pre-approval (S3, S4; Experimental per S2) — every tool stays callable; a plugin **agent** (not a skill) uses `tools`/`disallowedTools` in `agents/<name>.md` (§3.5). | Codex does **not** read `allowed-tools` from `SKILL.md` at all (S9, per FR-014); tool pre-approval + MCP dependencies live in the `agents/openai.yaml` sidecar. |
| **Auto-invoke opt-out** | Description-match auto-trigger with host-level invocation control (S8). | `agents/openai.yaml` `allow_implicit_invocation: false` opts a skill out of implicit triggering, requiring explicit dispatch (S9). |
| **Invocation syntax** | Implicit description-match; plugin skills addressable as `/<plugin>:<skill>` (S8, §2a C1). | Explicit `$skill-name` **or** implicit description-match (S9). |

**(b) Anthropic authoring guidance (S3–S7).** The load-bearing rules SPEC-026 follows:

- **Progressive disclosure** — frontmatter (always loaded) → body (loaded on trigger) →
  linked `references/` (loaded on demand). Keep the always-on cost minimal (S3, S5, S6).
- **The MCP-enhancement skill category** — "MCP provides the kitchen, skills provide the
  recipes" (S5, S6): a skill encodes a **repeatable multi-step recipe over a tool the agent
  already calls**, not a new tool to learn. This is the category every CodeGraph candidate
  belongs to (recipes over `codegraph_explore`), and it is the reason the inclusion criterion
  (§9.2) demands a candidate ride `codegraph_explore`.
- **What/when trigger discipline** — the `description` states **what** the skill does **and
  when** to use it, in the trigger vocabulary a user would actually type (S3, S4, S5).
- **Structural + security rules** — `name` is kebab-case, ≤64 chars, and the file is exactly
  `SKILL.md`; `description` ≤1024 chars; **no XML** in name/description and the reserved
  prefixes **`anthropic`/`claude`** are disallowed (S3, S2).
- **`allowed-tools` is pre-approval, not restriction** — listing tools pre-approves them;
  every tool remains callable, so it does not sandbox a skill (S3, S4). Codex ignores it in
  `SKILL.md` (S9), so it is not a cross-host restriction mechanism — consistent with FR-014's
  "constrain via a `disallowed-tools` denylist, never `allowed-tools` alone."
- **Skill→MCP dependency mechanism — AUDIT CORRECTION (FR-002 / FR-022(b)).** The roadmap
  (SPEC-025 scope bullet 2, roadmap line 847) names an optional **`metadata.mcp-server`**
  frontmatter field. **The audit corrects this to the evidence:** Anthropic's public
  best-practices (S4, §"MCP tool references") documents a skill's dependency on an MCP tool as
  a **qualified `ServerName:tool_name` reference in the skill body** — e.g. the CodeGraph
  recipe references **`codegraph:codegraph_explore`** in prose — **not** a frontmatter field.
  The agent-skills specification (S2) lists `metadata` as a generic string map and defines
  **no `mcp-server` field**; the real installed-skill frontmatter observed hands-on carried
  only `metadata: { author, version }` (§4.2 `CX-SKILLS-001`), no `mcp-server` key. Therefore
  a `metadata.mcp-server` **Anthropic frontmatter field MUST NOT be asserted** — SPEC-026
  declares the CodeGraph MCP dependency as a qualified body reference on Anthropic and via the
  `agents/openai.yaml` `dependencies.tools` sidecar on Codex (S9). (Recorded as an audit
  output per the FR-002 correct-to-evidence discipline; never asserted beyond the observation.)

**(c) OpenAI Codex authoring guidance (S9, S10).** The Codex-specific rules:

- **`.agents/skills` scan order** — Codex discovers skills from the `.agents/skills` tree in a
  defined order (S9); the plugin `skills` pointer feeds the same `SKILL.md` bundles (§4.2).
- **Explicit vs implicit invocation** — `$skill-name` explicit dispatch **or** implicit
  description-match (S9).
- **The `agents/openai.yaml` sidecar** — carries `allow_implicit_invocation`, display
  metadata, and **MCP tool dependencies** (`dependencies.tools`) — the Codex home of the
  dependency declaration the Anthropic side puts in the body (S9).
- **Authoring best practices** — one focused job per skill; imperative steps with explicit
  inputs/outputs; front-loaded use cases; trigger testing (should / should-NOT lists);
  instructions over scripts unless determinism is required (S9).

**(d) The vendors' published skill success criteria (S4, S5, S9).** Both vendors publish the
**set of measurements to record** — trigger rate on relevant queries, workflow tool-call
count, zero failed tool calls, and a with-skill/without-skill comparison. These are the
**recommended measurements, not target numbers**: no vendor publishes a trigger-rate a skill
must clear, and Anthropic's own guidance acknowledges Claude undertriggers skills (S4, S5).
This is exactly what FR-015's A/B bar records **alongside** the repo's agent-eval metrics
(§9.6), per the roadmap's binding SPEC-025 validation gate — and it is why the bar is a
**real filter**, not a rubber stamp (§9.7).

### 9.2 Candidate enumeration — the FR-014 three-leg inclusion criterion

A workflow qualifies as a candidate skill only if it clears **all three** legs:

1. **Rides a tool the host agent already calls** — the recipe is expressed over
   `codegraph_explore` (the DEFAULT MCP surface is `codegraph_explore` **alone**;
   `DEFAULT_MCP_TOOLS` in `tools.ts`), encoding a repeatable multi-step retrieval recipe
   rather than a new tool the agent must learn to pick. This is the CLAUDE.md "Adapt the tool
   to the agent" lever: a change lands only if it makes a tool the agent **already calls** do
   more with the input it **already gives**; a new tool or a "pick a different tool" ask hits
   the low-salience wall and does not land.
2. **Adds guidance not already carried by `server-instructions.ts` (#529)** — the host injects
   the MCP `initialize` instructions into every session; a skill that restates them adds no
   delta (and violates FR-016). The skill body must point to that guidance and add **only** the
   delta recipe.
3. **Expected to clear the FR-015 A/B bar (§9.6)** — artifact-off vs artifact-on, no regression
   on the Sonnet floor + control repo. Trigger efficacy is unproven (§9.7); a workflow that is
   not plausibly bar-clearing is excluded.

A workflow failing **any** leg is recorded as considered-and-excluded with the reason (§9.4).
The list is deliberately **short**: because the default surface is `codegraph_explore` alone
and `server-instructions.ts` already carries the general explore-before-Read doctrine, most
plausible "skills" restate #529 (fail leg 2) or are too narrow to move the A/B bar (fail
leg 3). Exactly one workflow survives all three legs.

| # | Candidate (recipe over `codegraph_explore`) | Leg 1 rides explore | Leg 2 delta over #529 | Leg 3 plausibly clears bar | Verdict |
|---|---|---|---|---|---|
| K1 | **explore-flow** — trace "how does X reach Y" / structural-flow via symbol-bag queries | ✓ | ✓ (thin — see §9.3) | unproven — the bar decides | **INCLUDED** (→ §10 exemplar) |
| K2 | pre-edit blast-radius / impact survey before an edit | ✓ | ✗ | — | excluded (§9.4) |
| K3 | area-survey / architecture onboarding | ✓ | ✗ | — | excluded (§9.4) |
| K4 | post-edit staleness-banner re-verification | ✓ | ✗ | — | excluded (§9.4) |
| K5 | monorepo `projectPath` routing | ✓ | ✗ | ✗ | excluded (§9.4) |

### 9.3 Included candidate — the explore-flow workflow skill (K1)

- **Artifact** — a workflow skill, `skills/codegraph-explore-flow/SKILL.md` (kebab-case,
  ≤64 chars, not reserved; the name recorded in the §3.1 hands-on tally). Fully drafted in §10.
- **Trigger surface** — structural/flow questions and pre-edit surveys in an indexed repo:
  "how does X reach Y", "what calls Z", "trace the flow / the path from X to Y", "where is X",
  and the pre-edit blast-radius check. (This is the trigger vocabulary a user types — S3/S4
  what/when discipline.)
- **Tier decision — FULLY OPEN** (FR-014 default for a workflow/authoring skill): it retains
  `Edit`/`Write` and carries **no** `allowed-tools`/`disallowed-tools` frontmatter. It does
  **not** touch the codegraph MCP tools' exposure — that surface is operator-controlled
  server-side (`CODEGRAPH_MCP_TOOLS`/`DEFAULT_MCP_TOOLS`), never denied or re-exposed by an
  artifact. No `context: fork` is used — this recipe holds only for the current retrieval turn,
  so it needs no constraint outlasting the turn.
- **Leg-2 delta (honest).** `server-instructions.ts` already carries the *general* doctrine
  (explore before Read; name the symbols that span the flow; treat returned source as already
  Read; the staleness-banner protocol). The skill's delta is the **narrow, higher-salience,
  step-by-step recipe** it does **not** spell out: how to *construct* the symbol bag (collect
  the concrete names spanning the flow; use qualified `Class.method`; add a PascalCase type
  token to disambiguate an overloaded name), the explore-again-not-Read **escalation loop**,
  and the explicit **stop condition**. This delta is real but thin — recorded honestly, because
  it is exactly why leg 3 is unproven and the A/B bar (§9.6) is the gate.
- **FR-016 reference-not-restate line item.** The body **references** the host-injected #529
  guidance and the qualified `codegraph:codegraph_explore` tool, and adds only the delta recipe
  — no verbatim duplication, and it must stay correct if `server-instructions.ts` changes.
  Demonstrated by the §10 exemplar; verified as a line item in the K1 A/B bar (§9.6).
- **FR-015 A/B bar** — per §9.6, run for K1 as artifact-off vs artifact-on. **This is the gate,
  not a formality:** if K1 ties-or-regresses on the Sonnet floor or the control repo, it does
  **not** ship (§9.7) — an acceptable, informative outcome even for the exemplar.

### 9.4 Considered-and-excluded candidates (with reasons)

Each rides `codegraph_explore` (leg 1) but fails a later leg:

- **K2 — pre-edit blast-radius / impact survey.** **Fails leg 2.** `server-instructions.ts`
  already says, near-verbatim, "Reach for it BEFORE *and* while writing or editing code … one
  call returns the verbatim source PLUS who calls it and what it affects, so you edit with the
  blast radius in view." A skill here would **restate** #529 (also an FR-016 violation), adding
  no delta.
- **K3 — area-survey / architecture onboarding.** **Fails leg 2.** #529's "How to query"
  already routes "surveying an area → `codegraph_explore` with a natural-language question,"
  and this is a single-call use, not a repeatable multi-step recipe that adds a delta.
- **K4 — post-edit staleness-banner re-verification.** **Fails leg 2.** The full
  staleness-banner protocol (re-Read only the pending files; the auto-sync-disabled variant)
  is carried verbatim in #529's Anti-patterns; a skill would duplicate it.
- **K5 — monorepo `projectPath` routing.** **Fails legs 2 and 3.** The
  `SERVER_INSTRUCTIONS_NO_ROOT_INDEX` variant already tells the agent to pass `projectPath` to
  a project that has a `.codegraph/`; it is a single-argument convention, not a multi-step
  workflow, and is not plausibly bar-moving on its own.

### 9.5 Agent class — evaluated separately (FR-014)

The explicitly-dispatched **agent** class is assessed on its own, not folded into skills.

- **`retrieval-guardian` is out of the shipped set** — it reviews **CodeGraph's own source and
  constitution** (the do-not-regress surface in `src/mcp/`, `src/resolution/`,
  `src/extraction/`), which does not exist in a user's repo; it is inapplicable to a user
  install (FR-014, verbatim).
- **Verdict: no agent qualifies for v1 → v1 ships skills-only.** Two evidenced reasons:
  1. **The audit constraints make a cross-host agent inconsistent.** Claude plugin-shipped
     agents cannot declare `hooks`/`mcpServers`/`permissionMode` and the only valid isolation is
     `worktree` (§3.5 `CC-AGENT-TOOLS-001`); Codex does **not** load agents from the plugin
     bundle at all (loads from `.codex/agents/*.toml`, §4.5) **and** on the shipped
     `multi_agent_version:v2` runtime a named subagent's declared `model`/`role` are **not
     honored** (§4.9 `CX-SUBAGENT-V2-001`, #15250/#20077 — a staged deferral to SPEC-026). An
     agent cannot be authored to behave identically on both hosts today.
  2. **An explicitly-dispatched agent is the low-salience anti-pattern.** CLAUDE.md's validated
     finding is that new tools/agents are under-picked (the agent under-picks even `trace`); an
     agent needs the host to *choose to dispatch* it — precisely the "needs the agent to behave
     differently" lever that does not land. A skill meets the agent where it already is; an
     agent does not.
- **Admit-later criterion (recorded).** An agent enters the candidate set when **all** hold:
  (i) a concrete **read-only/review** workflow over the *user's* repo is identified that a
  skill cannot express because the constraint must **outlast the turn** (the `context: fork`
  case, with a built-in-only `disallowedTools` denylist and no `tools:` allowlist — never
  denying the codegraph MCP tools); (ii) it clears the same FR-015 A/B bar (§9.6) on the Sonnet
  floor; and (iii) the Codex subagent config-fidelity blocker (§4.9) is resolved so the agent
  behaves identically cross-host. Until then, v1 is skills-only.

### 9.6 The FR-015 A/B validation bar (definition — applies per candidate)

Every enumerated artifact carries this bar; SPEC-026 **executes** it as a pre-ship gate (this
spike **defines** it). It is a **third comparison mode**, distinct from the two documented
agent-eval scripts (with-vs-without codegraph, `run-all.sh`; build-vs-build,
`ab-new-vs-baseline.sh`):

- **Arms — artifact-off vs artifact-on, both codegraph-on.** Baseline = the plugin's MCP
  server with the candidate **absent** (MCP-only); treatment = the **same** server with the
  artifact loaded. (Not with-vs-without codegraph; not build-vs-build.)
- **Model floor** — both arms `--model sonnet --effort high`, always (CLAUDE.md model policy —
  Sonnet is the deliberate floor; an affordance that lands on Sonnet generalizes up).
- **Runs** — ≥2 runs per arm (run-to-run variance is large; never conclude from n=1); report
  the range.
- **Primary metrics** — wall-clock latency, total tool-call count, and Read/Grep count, plus a
  **control repo** (a flow the skill does not target, to catch a regression the skill causes
  elsewhere).
- **Published-criteria leg (recorded alongside — FR-022(d), roadmap binding gate)** — trigger
  rate on relevant queries, workflow tool-call count, zero failed tool calls, and the
  with-skill/without-skill comparison. Recorded as measurements, not pass/fail thresholds
  (§9.7).
- **FR-016 reference-not-restate leg (per candidate)** — verify the body references (never
  restates) `server-instructions.ts` and stays correct if it changes.
- **Pass = no regression** on the primary metrics **and** the control repo. A candidate that
  **ties-or-regresses does not qualify** — nothing ships on the strength of the model
  spontaneously picking it.

### 9.7 Efficacy prior — recorded honestly

Skill **trigger efficacy is unproven, not assumed.** Skills sit in a structurally
higher-salience channel than the `server-instructions.ts` steering this repo already tried and
**rejected** (three wording variants regressed wall-clock; steering does not ship — CLAUDE.md
"Adapt the tool to the agent"). But no vendor publishes a trigger-rate **target number**, and
Anthropic's own guidance acknowledges Claude undertriggers skills (S4, S5). The FR-015 A/B bar
is therefore a **real filter**: a candidate — **including the K1 exemplar** — that fails it is
an **acceptable, informative spike outcome, not a spike failure** (spec Assumptions revision
note). SPEC-026 ships an artifact only after its bar passes; the §10 exemplar de-risks the
**authoring pattern**, and demonstrates reference-not-restate, regardless of whether K1 itself
ultimately clears the bar.

---

## 10. Appendix: explore-flow exemplar skill

_Closes: US5 — FR-017. Exactly one fully-drafted `SKILL.md`-shaped artifact body — the
explore-flow workflow skill — that references, never restates, `server-instructions.ts`
(#529) and encodes the explore-flow retrieval recipe over `codegraph_explore`. No other
candidate artifact body is drafted._

> **Done bar.** Exactly one exemplar (SC-005).

_Status: **drafted (T024).** Exactly one fully-drafted artifact body follows — the
`codegraph-explore-flow` workflow skill (K1 from §9.3). It **references, never restates**
`server-instructions.ts` (#529), encodes the explore-flow retrieval recipe over
`codegraph_explore`, and obeys the §9.1 authoring rules (kebab-case `name` ≤64, `SKILL.md`
filename, no XML, no reserved prefix, fully-open tier — no `allowed-tools`/`disallowed-tools`,
MCP dependency as a qualified body reference not a `metadata.mcp-server` field). No other
candidate artifact body is drafted (Q4/Q5 guard; SC-005)._

The exemplar is the single SKILL.md source tree (shared agent-skills standard, S1/S2) SPEC-026
lifts into the real plugin's `skills/codegraph-explore-flow/` on both hosts; per-host wiring
(the §9.1 divergences — discovery dir, invocation, the Codex `agents/openai.yaml` sidecar for
the MCP dependency) is a SPEC-026 lift detail, not a body change.

**`skills/codegraph-explore-flow/SKILL.md`** (drafted body — docs-only; SPEC-026 lifts it into
the plugin tree):

```markdown
---
name: codegraph-explore-flow
description: >-
  Trace how one part of a codebase reaches another, and survey code before editing,
  using codegraph_explore instead of a Read/Grep loop. Use for structural and flow
  questions in a repo that has a .codegraph/ index: "how does X reach Y", "what calls Z",
  tracing a call path or data/control flow, an impact or blast-radius check before an
  edit, or locating a named symbol. Do not use for config/doc files codegraph does not
  index, or a repo with no .codegraph/.
---

# codegraph-explore-flow

Your MCP host has already injected CodeGraph's tool guidance into this session — the
`initialize` instructions from `server-instructions.ts` (issue #529). That injected text
is the single source of truth for what `codegraph:codegraph_explore` returns and for the
explore-before-Read baseline; do not restate or second-guess it. This skill adds only the
delta: how to turn a structural question into one good `codegraph_explore` query, and when
to stop.

## Recipe

1. **Build the symbol bag.** Collect the concrete names that span the flow you're after:
   the function / method / class names (and any file paths) at both ends, plus any midpoint
   you already know. For a method, use the qualified `Class.method` form. If a name is
   overloaded, add its PascalCase type token to bias resolution to that type's own
   definition (e.g. `DataRequest task` for `DataRequest`'s `task`, not the base). Precise
   names in, precise path out.
2. **Make ONE call, not a grep/read loop.** Pass the whole bag to `codegraph_explore` in a
   single call (a natural-language question also works, but a symbol bag disambiguates a
   flow's two endpoints best). It surfaces the call path among the named symbols — including
   the dynamic-dispatch hops grep can't follow — with their source. Don't hand-reconstruct
   the path with your own search.
3. **Treat the returned source as already Read.** It is line-numbered and safe to `Edit`
   from. Don't re-Read or re-grep it to confirm — it comes from a full AST parse.
4. **Escalate by exploring again — never by falling back to Read/Grep.** If the path has a
   gap, or you need a symbol you didn't name, add those names to the bag and call
   `codegraph_explore` again. Don't drop to Read/Grep to fill a graph gap.
5. **Stop when the flow connects end-to-end** and you hold the source you need to answer or
   edit. Only then, and only for what codegraph genuinely doesn't cover — a config/doc file
   it doesn't index, or a file the staleness banner flags as pending re-index — use Read for
   that one specific gap.

## Trigger test

- Use when: "how does X reach Y", "what calls / what's affected by Z", tracing a call path
  or data/control flow, a pre-edit blast-radius check, or locating a named symbol — in a
  repo with a `.codegraph/` index.
- Do NOT use when: the target is a config/doc file codegraph doesn't index; the repo has no
  `.codegraph/` (use your built-in tools); or the staleness banner flags the specific file
  as pending (Read that file directly).
```

**Reference-not-restate compliance (FR-016, FR-017).** The body **points to** the
host-injected #529 guidance for what `codegraph_explore` returns and the explore-before-Read
baseline, and adds **only** the delta recipe (symbol-bag construction, qualified
`Class.method` + PascalCase-type-token disambiguation, the explore-again escalation loop, the
stop condition) — none of which #529 spells out. It contains **no** verbatim copy of the
`initialize` text and stays correct if `server-instructions.ts` changes (it names the file and
the `codegraph:codegraph_explore` tool, not their contents). The MCP dependency is expressed
as the qualified body reference `codegraph:codegraph_explore` (S4), **not** a
`metadata.mcp-server` frontmatter field (the §9.1 audit correction). Fully-open tier: no
`allowed-tools`/`disallowed-tools`. This is the **only** drafted artifact body in the document
(SC-005); every other candidate (§9.2) carries a tier + bar but no body.

---

## 11. Staged decisions + close-out

_Closes: FR-020, SC-008. Any timebox miss recorded as an explicit attempt-first staged
decision naming what was attempted + the specific evidenced blocker (no silent gap); the
candidate deferrals (T012/T013/T021) collected if triggered; the SC-001…SC-008 done-bar
checklist._

> **Done bar.** Zero silent gaps; the SC-001…SC-008 done-bar recorded.

_Status: **drafted (T026).** Every staged decision below is attempt-first — each names what
was attempted, the specific evidenced blocker, and the SPEC-026 pre-ship-gate step that closes
it; none is a silent gap (SC-008, FR-020). The SC-001…SC-008 done-bar checklist follows, with an
honest per-criterion verdict._

### 11.1 Staged decisions (attempt-first — what was attempted + the evidenced blocker + the SPEC-026 gate)

Two kinds appear here: **cross-platform / runtime staged deferrals** (a validation that was
attempted and hit an environment or runtime blocker, deferred to SPEC-026's pre-ship gate) and
**interactive-only could-not-validate legs** (a behavior validated structurally or by an
authoritative public source, whose final confirmation needs a human in an interactive host TUI).
The **Linux launcher attempt (T013, §5.E)** is noted for completeness as **attempted-and-completed
— no deferral** (Docker was available; the launcher chain behaves identically to macOS). Every
decision this spike makes stands on recorded evidence; only the named confirmation legs below are
outstanding.

**SD-1 — Windows launcher three-stage (T012, §5.D `LX-WIN-ATTEMPT-001`). DEFERRED.**

- *Attempted:* the Windows per-stage-per-host launcher sequence (three stages × Claude Code +
  Codex) on the Parallels "Windows 11" VM via the repo's documented SSH bridge, specifically to
  probe risk (a) the CVE-2024-27980-class `.cmd`/shim spawn refusal (#289) and risk (b) bare-name
  PATH resolution for a GUI-launched Windows host.
- *Evidenced blocker:* no Windows host was reachable — `prlctl list -a` shows the VM `suspended`
  with `IP_ADDR=-`, **and** the `.parallels` file that is the documented sole source of the guest
  IP + SSH user + key is **absent** on this machine (`cat <root>/.parallels` → "No such file or
  directory" at the checkout root, the worktree, HOME, and anywhere under the project). The VM
  cannot be authenticated to even if resumed; resuming the user's suspended VM (state-changing,
  and still credential-blocked) was deliberately not done.
- *SPEC-026 pre-ship gate:* on a reachable Windows host, before shipping the plugin channel to
  Windows, confirm (a) the host MCP launcher spawns the shipped Windows entry point (npm `.cmd`
  shim / `codegraph.cmd`) **without** the `.cmd` spawn refusal (spawn a resolved `.cmd` with
  `shell:true` + escaping, or resolve to a non-`.cmd` entry point), and (b) bare-name `codegraph`
  PATH resolution succeeds (or is not relied upon) for a GUI-launched Windows host. This does
  **not** re-open OQ-8 — a host-reachability deferral, not a falsification of the contract (§5.G).

**SD-2 — Codex subagent v2 config-fidelity (T021, §4.9 `CX-SUBAGENT-V2-001` / §8.2). DEFERRED.**

- *Attempted:* named-agent invocation of a standalone `.codex/agents/codegraph-explorer.toml`
  (declared model `gpt-5.5`) via `codex exec` on Codex CLI 0.144.0.
- *Evidenced blocker:* the subagent `thread_spawn` succeeded, but on the runtime this build
  selects — `multi_agent_version:v2`, mode `explicitRequestOnly` — the agent's **declared model
  and role were not honored** (it ran the parent model `gpt-5.6-sol`; `agent_role: null`; zero
  `gpt-5.5` hits across all three session rollouts) — the #15250/#20077 v2 config-fidelity
  limitation, observed hands-on.
- *SPEC-026 pre-ship gate:* confirm named-agent config fidelity (declared model + role applied) on
  the **exact shipped runtime/model pairing** — or ship Codex agents in a form that does not depend
  on per-agent model/role override — before relying on Codex subagents. This gates the **agents ×
  Codex** matrix cell (§6, §8.2); ownership is already **decided** (installer-owned, new
  capability), only the runtime fidelity is deferred.

**SD-3 — Codex prompt-hook end-to-end model-reach leg (T017, §4.8 `CX-HOOK-PROMPT-001`).
DECISION MADE; one confirmation leg deferred.**

- *Decision (not deferred):* prompt-front-load × Codex = **plugin-owned, version-gated ON at Codex
  ≥ 0.144.0** (post-#19705; the old `plugin_hooks` flag removed). The hook fires and emits the
  exact canary `additionalContext` at the command level — validated, and the reason the §6 matrix
  cell is plugin-owned, **not** "absent on Codex."
- *Attempted (the deferred leg):* the end-to-end "context reaches the model" confirmation via a
  headless `codex exec`. *Evidenced blocker:* persisting hook trust requires the **interactive
  `/hooks` TUI review** (which writes the `[hooks.state].…trusted_hash` entry); a plain headless
  `codex exec` correctly **skipped** the untrusted hook (proving the trust gate is real), and the
  only headless bypass (`--dangerously-bypass-hook-trust`) is an out-of-scope safety-bypass flag,
  deliberately not used.
- *SPEC-026 / human step:* with the isolated `CODEX_HOME` and the scratch plugin installed, launch
  interactive `codex`, run `/hooks`, trust the `codegraph-scratch` `UserPromptSubmit` hook, then
  `codex exec -C <project>` and confirm the model prints `CODEGRAPH_SCRATCH_CANARY_7F3A9D2`.

**SD-4 — Interactive-only host-UI confirmation legs (Claude Code). DECISIONS MADE; visual
confirmations deferred to a human step.** These are validated structurally or by the authoritative
public CHANGELOG; only the interactive-TUI visual is outstanding (FR-003 could-not-validate, each
with the exact human step recorded in place):

- **Marketplace + first-use trust prompt / `/plugin` trust-review screen (§3.4
  `CC-MARKETPLACE-001`).** The marketplace + trust model is confirmed from P1–P3 + the on-disk
  registry; the interactive install-time trust prompt is UI-only. Human step: `/plugin marketplace
  add <repo>` → `/plugin install <plugin>@<marketplace>` → accept the trust prompt.
- **`/plugin` dedup suppression *notice* (§7.A `DEDUP-CC-001`).** Dedup semantics ("manual wins,
  plugin copy skipped, suppression shown in `/plugin`") are confirmed from the public CHANGELOG
  v2.1.71 / v2.1.152; forcing the exact-match both-live state and reading its `/plugin` badge needs
  interactive approval. Human step recorded in §7.A.
- **`/plugin` no-suppression badge in the near-duplicate state (§7.B `NEARDUP-004`).** The
  non-event (two healthy servers, two namespaced tool sets, nothing fires) is validated
  structurally in a headless `-p --debug` run; only the `/plugin` **visual** badge-absence is
  outstanding. Human step recorded in §7.B.

**No other gaps.** Every remaining load-bearing claim in §§1–10 carries a public citation and a
hands-on evidence block (see the §12.2 map). SD-1…SD-4 are the **complete** set of attempt-first
staged decisions — zero silent gaps (SC-008, FR-020).

### 11.2 SC-001…SC-008 done-bar checklist (honest per-criterion verdict)

| SC | Bar | Verdict | Basis |
|---|---|---|---|
| **SC-001** | 100% of roadmap SPEC-025 scope bullets close with an explicit decision | **PASS** | §1.1 closure table — all five bullets decided; bullet 2 (skill-authoring grounding) is closed by §9.1. |
| **SC-002** | Every load-bearing platform claim carries a public citation **and** a hands-on evidence block (or explicit "could not validate" note) | **PASS** | §3/§4/§5/§7 evidence blocks against pinned builds; citation audit (T009) §3–§4 recorded clean; every could-not-validate leg is explicitly noted (§11.1). Scrub is applied at drafting (§2.3); T028 is the final verification sweep. |
| **SC-003** | OQ-8 resolved in the PRD's terms; a reader identifies the contract with no further research | **PASS** | §5.G — RESOLVED, adopted as specified with two refinements, no trade study (Q2). |
| **SC-004** | Every matrix cell has a decided single owner (no blank/undecided) | **PASS** | §6.1 — all 8 cells decided; none explicitly-absent (§6.2). |
| **SC-005** | Exactly one fully-drafted exemplar; every other candidate has a tier + bar but no body | **PASS** | §10 (one body: `codegraph-explore-flow`); §9.2/§9.4 (K2–K5 carry tier + bar, no body). |
| **SC-006** | SPEC-026 can scaffold with zero further platform research | **PASS** | §§3–10 close every scope area; §12 traceability. SD-1/SD-2 are **pre-ship validation gates, not scaffolding blockers** — SPEC-026 scaffolds the plugin tree now and validates Windows + Codex-v2 fidelity before shipping. |
| **SC-007** | Committed change is docs/process only — 0 production LOC, ~2 files, no committed scratch plugin/fixture | **PASS** | §12.1 checkpoint — the decision document + the roadmap status edit; scratch plugins live outside the repo tree (FR-019). The final scrub verification sweep (T028, recorded CLEAN) and the roadmap status edit (T030, applied) have sealed this bar — §12.1 records both. |
| **SC-008** | Spike completes within the 2–3 day timebox, or any miss is an explicit staged decision | **PASS** | The spike ran within the 2–3 day timebox; SD-1…SD-4 above are the recorded attempt-first staged decisions — zero silent gaps. |

---

## 12. Traceability + PR review packet

_Closes: the requirement/SC → section → evidence map and the PR packet fields (SC-006)._

> **Done bar.** FR/SC → section → evidence map complete; PR packet fields filled; SPEC-026
> can scaffold with zero further platform research.

### 12.1 Reviewability checkpoint

Recorded at the foundational phase (T006), re-verified at close-out (T030).

- **0 production LOC.** The spike changes no code; the deliverable is prose/markdown. The
  repo verification floor (`npm run build`, `npm test`) stays trivially green.
- **0 production files.** No file is created or modified under `src/`; no committed
  scratch plugin or validation fixture. Scratch plugins live outside the repo tree and are
  evidence-only (FR-018/FR-019).
- **~2 total committed files.** This decision document
  (`docs/design/plugin-channel-decision.md`, created) plus the SPEC-025 status edit to
  `docs/ai/specs/intelligence-platform-technical-roadmap.md`.
- **1 docs surface** (docs/process). No secondary surface.
- **Within the spike budget.** Far under the reviewability warn thresholds (400 LOC, 6
  production files, 15 total files, 1 surface).
- **No split.** A single docs/process surface sized by a 2–3 day timebox, not by LOC (plan
  Reviewability Budget; spec Reviewability Budget; FR-018, SC-007).

**Final secret-scrub sweep (T028, FR-019) — CLEAN.** The committed
`docs/design/plugin-channel-decision.md` was swept across all **four Validation Evidence Block
artifact classes** (pinned host version, exact repro command, quoted manifest/config snippet,
observed-behavior transcript) and all **four named §2.3 exposure points (a–d)**; `research.md`
and the committed `spec.md` / `plan.md` / `tasks.md` were swept alongside it. **Zero hits:** no
`CODEGRAPH_EMBEDDING_API_KEY` value, no raw private embedding endpoint, no
scheme+host:port-redacted endpoint form (the dogfood endpoint host and port appear **nowhere**
in committed text), no other `.envrc.local` value (embedding model, dims, timeout, batch,
concurrency all absent), and no real identity-leaking absolute user path. Only
identity-preserving placeholders survive — `<REDACTED:EMBEDDING_ENDPOINT>` /
`<REDACTED:CODEGRAPH_EMBEDDING_API_KEY>` / unresolved `${VAR}` / `<user>` / `<HOME>` /
`<CODEX_HOME>` / masked `*****` — **never a deleted line**. Per exposure point: **(a)** the
dogfood binary-present launcher stage was deliberately forced to the stub so no endpoint/key ever
surfaced (§5.A runtime-env note; §5.C `LX-CX-STAGE1-001` ran against an isolated scratch home +
`dist` binary, not the dogfood index); **(b)** no `claude mcp add` resolved-value write-back
reached any committed `.mcp.json` — the real `~/.claude.json` was byte-stable and Codex env
values render masked `*****` (§7.B); **(c)** no `codegraph status` transcript surfaces the
endpoint; **(d)** no plaintext-`http://` embedding-warning transcript appears. Sweep recorded
**CLEAN across all four artifact classes × four exposure points** (FR-019, SC-007).

**Commit-surface verification (T030, FR-018 / SC-007) — docs/process only.** `git status
--porcelain` + `git diff --stat HEAD` at close-out show exactly the in-budget surface — **no
`src/**`, no committed scratch plugin or validation fixture**:

```
 M docs/ai/specs/intelligence-platform-technical-roadmap.md   (SPEC-025 status row — T030; 1-row diff)
 M specs/025-plugin-platform-spike/research.md                (citation ledger — earlier tasks)
 M specs/025-plugin-platform-spike/tasks.md                   (task checkboxes)
?? docs/design/plugin-channel-decision.md                     (this decision document — new, untracked)
```

Four files: one docs/design surface plus the spec's own process artifacts (`research.md`,
`tasks.md`) and the roadmap status row. **0 production LOC, 0 files under `src/`, 0 committed
scratch plugins/fixtures** — within the spike budget (FR-018, SC-007).

### 12.2 Requirement/SC → section → evidence map

_Status: **drafted (T027).** Every FR-001…FR-022 and SC-001…SC-008 maps below to a home section
and — where load-bearing — the evidence block IDs that ground it. **No FR or SC is unmapped.** Two
requirements carried a named downstream finalizer, now closed: FR-019's final verification sweep
(T028) is recorded CLEAN in §12.1, and FR-021's full component-wise parity affirmation (T029) is
recorded in §5.H._

**Functional requirements → section → evidence.**

| Req | Closed in | Evidence block IDs / basis |
|---|---|---|
| **FR-001** Claude Code platform audit | §3 | `CC-MANIFEST-001`, `CC-MCP-NS-001`, `CC-HOOK-001`, `CC-MARKETPLACE-001`, `CC-AGENT-TOOLS-001` |
| **FR-002** Codex platform audit (capability-first; filenames corrected to evidence) | §4 (+ §9.1(b)) | `CX-MANIFEST-001`, `CX-SKILLS-001`, `CX-HOOK-SURFACE-001`, `CX-MCP-001`, `CX-AGENTS-DISTINCT-001`, `CX-TRUST-001`, `CX-LIFECYCLE-001`; audit corrections §3.1, §3.3, §4.3, §9.1(b) |
| **FR-003** Hands-on evidence in BOTH hosts, or an explicit "could not validate" note | §2 (schema); §3/§4/§5/§7 | all evidence blocks; could-not-validate: `CC-MARKETPLACE-001`, `CX-HOOK-PROMPT-001`, `DEDUP-CC-001`, `NEARDUP-004` |
| **FR-004** Public citations only | §3 (P1–P4), §4 (C3–C6), §9.1 (S1–S10) | Citation audit (T009) §3–§4 recorded clean |
| **FR-005** Launcher ordered fallback + `--offline` / major-pin / ~50 MB / Principle VII | §5.F | `LX-CC-STAGE1-001`, `LX-CC-STAGE2-001`, `LX-CC-STAGE3-001`, `LX-CX-STAGE1-001`, `LX-CX-STAGE2-001`, `LX-CX-STAGE3-001`, `LX-LNX-STAGE1-001`, `LX-LNX-STAGE3-001` |
| **FR-006** Absent-binary success-shaped (never `isError`); stub; runtime self-sufficiency | §5.F | `LX-CC-STAGE3-001`, `LX-CX-STAGE3-001`, `LX-LNX-STAGE3-001`, `LX-CC-RUNTIME-001`, `LX-CX-RUNTIME-001`, `LX-LNX-RUNTIME-001` |
| **FR-007** Three-stage per host (macOS) + Windows/Linux attempt; PATH scoping; two Windows risks | §5.A, §5.C, §5.D, §5.E | `LX-CC-STAGE1-001`, `LX-CX-STAGE1-001` (PATH scoping); `LX-WIN-ATTEMPT-001` (deferral, SD-1); `LX-LNX-STAGE1-001` |
| **FR-008** OQ-8 resolved; trade study only if falsified | §5.G | synthesis over §5 evidence (Q2 guard satisfied) |
| **FR-009** Channel-ownership rule; installer-gap = new SPEC-026 capability; lever reconciliation | §6.1, §6.2, §6.3, §7.C | matrix + `DEDUP-CC-001` |
| **FR-010** 8-cell matrix, three-outcome discipline; pinned Codex build for the hook cell | §6.1, §6.2 | `CX-HOOK-PROMPT-001` (T017 pinned build) |
| **FR-011** Detection/dedupe both directions; Claude lever; Codex levers; self-suppression non-viable; 4-step near-dup | §7.A, §7.B, §7.C | `DEDUP-CC-001`; `NEARDUP-001`, `NEARDUP-002`, `NEARDUP-003`, `NEARDUP-004` |
| **FR-012** Uninstall interplay; invocation-driven restore; no orphans; lever-(ii) window; who-reports | §7.C (+ §6.2) | synthesis over `DEDUP-CC-001` + `NEARDUP-001…004` |
| **FR-013** Degraded-Codex subset; each cell observable-complete | §8.1, §8.2, §8.3, §8.4 | `CX-AGENTS-DISTINCT-001`, `CX-SUBAGENT-V2-001` (T021), `CX-HOOK-PROMPT-001` (T017) |
| **FR-014** Candidate skill+agent set, tier, three-leg criterion; agent class evaluated separately | §9.2, §9.3, §9.4, §9.5 | `CC-AGENT-TOOLS-001`, `CX-AGENTS-DISTINCT-001`, `CX-SUBAGENT-V2-001` (audit constraints) |
| **FR-015** A/B bar (third comparison mode, Sonnet floor, published-criteria leg) | §9.6 | definition (SPEC-026 executes as a pre-ship gate) |
| **FR-016** Reference-not-restate `server-instructions.ts` (#529) per candidate | §9.3, §9.6, §10 | §10 exemplar reference-not-restate compliance |
| **FR-017** Exactly one exemplar; no other body | §10 | one drafted body (`codegraph-explore-flow`) |
| **FR-018** 0 production LOC, ~2 files | §12.1 | reviewability checkpoint |
| **FR-019** No committed scratch plugin; scrub; four exposure points; identity-preserving placeholders | §2.3 (+ §12.1) | scrub applied per block; **T028 final verification sweep recorded CLEAN (§12.1) — all four artifact classes × four exposure points, zero hits** |
| **FR-020** Every scope area closed with a decision; timebox miss → staged decision | §1.1, §11.1 | closure table + SD-1…SD-4 |
| **FR-021** Network/telemetry parity; pre-exec path no independent action | §5.F, §5.H | Principle VII reconciliation (§5.F) + **§5.H (T029) full component-wise affirmation — stub launcher/MCP, pre-exec path, prompt hook, skills, agents; roster-currency clause; net-new surface: none found** |
| **FR-022** Skill-authoring grounding block closes roadmap scope bullet 2 | §9.1 | S1–S10 (public); §3/§4 per-host divergences |

**Success criteria → section → basis.**

| SC | Closed in | Basis |
|---|---|---|
| **SC-001** | §1.1 (+ §9.1) | scope-bullet closure table — all 5 decided |
| **SC-002** | §3, §4 (+ citation audit T009) | citations + hands-on evidence blocks; §11.2 |
| **SC-003** | §5.G | OQ-8 RESOLVED in the PRD's terms |
| **SC-004** | §6.1, §6.2 | 8 cells, all decided, none blank |
| **SC-005** | §10 (+ §9.2) | one drafted body; others tier + bar only |
| **SC-006** | §12 (whole doc) + §1 | traceability; the SD-1/SD-2 deferrals are pre-ship gates, not scaffolding blockers |
| **SC-007** | §12.1 | docs-only; 0 production LOC; T028/T030 finalize |
| **SC-008** | §11.1 | within timebox; SD-1…SD-4 staged decisions |

**Completeness.** All 22 functional requirements (FR-001…FR-022) and all 8 success criteria
(SC-001…SC-008) map to at least one section, and every load-bearing one to its evidence block IDs.
The only two entries that carried a downstream finalizer — FR-019 (→ T028 final scrub sweep,
recorded CLEAN in §12.1) and FR-021 (→ T029 full parity affirmation, §5.H) — are now closed,
neither a silent gap. **SPEC-026 can scaffold from this map with zero further platform research
(SC-006).**

### 12.3 PR review packet

_Status: **drafted (T027).** The nine PR-packet fields the spec's PR Review Packet Requirements
mandate, filled from this document._

- **What changed.** One new decision document — `docs/design/plugin-channel-decision.md` (12
  sections) — plus a one-line SPEC-025 status edit to `docs/ai/specs/intelligence-platform-technical-roadmap.md`
  (T030). **0 production LOC**; no file created or modified under `src/`; no committed scratch
  plugin or validation fixture (§12.1).
- **Why.** SPEC-026 (Plugin-Channel Distribution) is blocked until this decision record lands. The
  document resolves OQ-8 (the launcher contract), the coexistence rules and the 8-cell ownership
  matrix, the degraded-Codex subset, and the shipped-artifact plan + one exemplar — so SPEC-026
  scaffolds the Claude Code + Codex plugin channel with **zero further platform research** (SC-006).
- **Non-goals.** Nothing ships (SPEC-026 implements); no npm-installer replacement/deprecation (Q3);
  no committed scratch plugins/fixtures (Q9); only one exemplar drafted (Q4); no equal-weight
  launcher trade study (the PRD hypothesis was confirmed, not falsified — Q2); no upstream
  marketplace listing beyond the racecraft channel; no private-vault path cited (public sources
  only — FR-004). Full list in §1.3.
- **Review order (1 → 12).** Section order **is** review order. Each section's header names the
  user story / functional requirements it closes and its done bar: §1 executive decision + scope
  closure → §2 evidence-block schema (frozen) → §3 Claude audit → §4 Codex audit → §5 launcher /
  OQ-8 → §6 ownership matrix → §7 coexistence + uninstall → §8 degraded-Codex → §9 skill-authoring
  grounding + artifact plan → §10 exemplar appendix → §11 staged decisions + done bar → §12
  traceability + this packet.
- **Scope budget.** 0 production LOC · 0 production files · ~2 committed files · 1 docs surface —
  within the spike budget, far under the reviewability warn thresholds (400 LOC / 6 production
  files / 15 total files / 1 surface); no split (§12.1, FR-018, SC-007).
- **Traceability.** §12.2 maps every FR-001…FR-022 and SC-001…SC-008 → home section → evidence
  block IDs; none unmapped. The two downstream finalizers (FR-019 → T028, FR-021 → T029) are
  flagged there, not silent.
- **Verification evidence.** Hands-on Validation Evidence Blocks against **pinned builds** — Claude
  Code 2.1.206 and Codex CLI 0.144.0 (macOS darwin-arm64), plus a Linux launcher pass on
  `node:22-bookworm` under Docker 29.5.3 — each with an exact repro command, a quoted
  manifest/config snippet, and observed behavior, secret-scrubbed at drafting (§2.3). The citation
  audit (T009, §3–§4) is recorded clean. The repo verification floor (`npm run build`, `npm test`)
  stays trivially green — the spike changes no code.
- **Known gaps.** The four attempt-first staged decisions in §11.1 — **SD-1** Windows launcher
  three-stage (VM suspended with no IP **and** `.parallels` credentials absent), **SD-2** Codex
  subagent v2 config-fidelity (#15250/#20077), **SD-3** the Codex prompt-hook end-to-end model-reach
  leg (interactive `/hooks` trust), and **SD-4** the interactive-only Claude host-UI confirmations
  (marketplace trust prompt; `/plugin` dedup notice + near-duplicate badge). Each names what was
  attempted, the evidenced blocker, and the SPEC-026 pre-ship-gate / human step. The two named
  polish tasks are now complete: the final scrub verification sweep (T028, recorded CLEAN in §12.1)
  and the network/telemetry parity affirmation (T029, §5.H).
- **Rollback / feature-flag notes.** **Docs-only — nothing to feature-gate.** No production code,
  no runtime flag, no migration. Rollback = revert the two committed files (delete
  `docs/design/plugin-channel-decision.md` and revert the one-line roadmap SPEC-025 status edit);
  the repo returns to its prior state with no residue. All decided behavior is inert until SPEC-026
  implements it.
