# SPEC-025 Plugin Channel Decision

**Status: Complete — decisions final.** This document is the sole deliverable of SPEC-025:
the decision record from which SPEC-026 scaffolds the Claude Code + Codex plugin channel
with no further platform research. Genre precedent:
[`docs/design/web-framework-decision.md`](./web-framework-decision.md) (SPEC-004).

**How to review.** Sections 1–8 are the decisions — that is the review surface (~15
minutes). Every hands-on claim carries a bracketed evidence ID like `[CC-MANIFEST-001]`
resolving to a full Validation Evidence Block (exact repro command, config snippet,
observed behavior) in **Appendix B**; citation tags (P·, S·, C·) resolve in **§8 Sources**.
Appendix A is the one drafted artifact; Appendix C is the compliance record (done-bar,
budget, secret-scrub result, FR/SC traceability). Hands-on evidence is pinned to **Claude
Code 2.1.206** and **Codex CLI 0.144.0** (macOS darwin-arm64) plus a Linux/Docker pass;
scratch plugins were built outside the repo tree and never committed — only their scrubbed
evidence appears here.

---

## 1. The decision

Package CodeGraph as first-class Claude Code **and** Codex plugins carrying the MCP
server, the prompt front-load hook, and skills — with the **npm installer keeping the
binary-distribution role** and covering the one component the Codex plugin format cannot
carry (agents). The **plugin owns config-writing** for every component its host format can
carry; the installer keeps the binary and the cross-channel reconciliation. The MCP
launcher resolves the user-installed binary via **PATH-resolved binary → `npx --offline`
thin-installer → success-shaped stub guidance** (OQ-8, confirmed and adopted — §3). v1
ships **skills-first**: one workflow skill survives the inclusion criterion; no agent
qualifies yet (§6). **Nothing ships in this spike — SPEC-026 implements every decision
here.**

### 1.1 Every roadmap scope bullet, decided

| # | Roadmap scope bullet | Decision | Where |
|---|---|---|---|
| 1 | Platform audit with citations | **Done.** Both plugin formats audited hands-on against pinned builds; every load-bearing claim carries a public citation + an evidence block. Where official docs and the roadmap's guesses diverged from observed behavior, the evidence wins (corrections table, §2.3). | §2 |
| 2 | Skill-authoring grounding | **Done.** A decided authoring standard from the shared agent-skills spec + both vendors' public guidance, with the four per-host divergences enumerated. | §6.1 |
| 3 | MCP launcher contract (OQ-8) | **Resolved — the PRD's ordered fallback adopted as specified**, with two evidence-backed refinements (GUI PATH scoping; the two-hop offline condition). No trade study needed: the hypothesis was not falsified. | §3 |
| 4 | npm-installer coexistence rules | **Decided — lever (i):** the installer keeps its MCP entry; the plugin copy is the redundant one. Realized by installer-side detection, not host dedup (the two channels' commands always differ textually, so host dedup never fires — proven live). No orphans on uninstall in either direction. | §4 |
| 5 | Shipped-artifact plan | **Decided — skills-first.** One candidate (explore-flow) survives the three-leg inclusion criterion; four are excluded with reasons; no agent qualifies for v1. One exemplar drafted (Appendix A); everything ships only after an A/B bar. | §6 |

**The 8-cell ownership matrix — all decided, none blank:** MCP × Claude =
installer-owned; agents × Codex = installer-owned (new SPEC-026 capability); the other six
cells = plugin-owned (§4.1).

### 1.2 Non-goals

- **Shipping anything** — this spike changes no production code; SPEC-026 implements.
- **Replacing or deprecating the npm installer** — it keeps binary distribution.
- **Committing scratch plugins or validation fixtures** — evidence only.
- **Drafting more than one artifact body** — one exemplar; others get tier + bar only.
- **A launcher trade study** — produced only on falsification, which did not occur (§3).
- **Upstream marketplace listings** beyond the racecraft channel.
- **Citing private sources** — public URLs only; the public copy of Anthropic's
  skill-building guide (S5) is cited, never a local/vault path.

---

## 2. What the plugin formats can carry (platform audit)

### 2.1 Claude Code (2.1.206)

A plugin is a directory with its manifest at the fixed path `.claude-plugin/plugin.json`;
component fields (`commands`, `agents`, `hooks`, `mcpServers`, `skills`) point at bundled
components and default to standard locations. The scratch plugin passes
`claude plugin validate --strict` and `plugin details` tallies all four component types
`[CC-MANIFEST-001]` (P1).

- **MCP server** — auto-starts when the plugin is enabled; tools are namespaced
  `mcp__plugin_<plugin>_<server>__<tool>`; `${CLAUDE_PLUGIN_ROOT}` in command/args/env
  resolves to the plugin's install directory `[CC-MCP-NS-001]` (P1, P2).
- **Prompt hook** — a plugin `UserPromptSubmit` hook fires and its
  `hookSpecificOutput.additionalContext` reaches the model `[CC-HOOK-001]` (P1).
- **Skills** — `skills/<name>/SKILL.md` bundles load (tallied in `[CC-MANIFEST-001]`).
- **Agents** — bundled `agents/<name>.md` load; they **inherit all tools by default**,
  restrictable via `tools`/`disallowedTools`; for security, plugin agents cannot declare
  `hooks`, `mcpServers`, or `permissionMode`, and the only valid isolation is `worktree`
  `[CC-AGENT-TOOLS-001]` (P1). This constraint drives the §6.4 agent decision.
- **Distribution & trust** — a marketplace is a repo with
  `.claude-plugin/marketplace.json`; users `/plugin marketplace add` then
  `/plugin install <plugin>@<marketplace>`. A plugin's MCP server goes through the **same
  per-server approval as a project `.mcp.json`**; `defaultEnabled` (≥2.1.154) and
  `enabledPlugins` in team settings control enablement `[CC-MARKETPLACE-001]` (P1–P3).
  The interactive trust prompt itself is a deferred human check (SD-4, §7).

### 2.2 Codex CLI (0.144.0)

Codex 0.144.0 has a first-class plugin surface (`codex plugin
{add,list,marketplace,remove}`; feature flags `plugins`/`plugin_sharing`/`hooks` all
stable). The manifest is **`.codex-plugin/plugin.json`** — a superset of Claude's manifest
adding an `interface` branding block; its component pointers are `skills`, `hooks`, and
`mcpServers`. **There is no `agents` component pointer** `[CX-MANIFEST-001]` (C3).

- **Skills** — the `skills` pointer resolves a `skills/<name>/SKILL.md` tree (the same
  shared agent-skills standard as Claude); the tree is copied verbatim into the plugin
  cache on install `[CX-SKILLS-001]` (C6).
- **Hooks** — Claude-Code-shaped hook schema, declarable from three places: the plugin
  bundle (manifest `hooks` pointer; commands resolve plugin-root-relative), a global
  `~/.codex/hooks.json`, or a project `.codex/hooks.json` `[CX-HOOK-SURFACE-001]` (C3).
  The plugin-bundled `UserPromptSubmit` hook **fires and emits `additionalContext` on this
  build** — version-gated ON at ≥0.144.0 (post-PR #19705; the old `plugin_hooks` flag is
  removed). One leg remains: "context reaches the model" end-to-end needs a one-time
  interactive `/hooks` trust review (SD-3, §7) `[CX-HOOK-PROMPT-001]` (C4).
- **MCP server** — a bundle `.mcp.json` merges into the same unified registry as
  `config.toml` `[mcp_servers.*]`; cwd = the plugin-cache root; Codex spawns it live in a
  session `[CX-MCP-001]` (C3).
- **Agents — not carried.** Codex loads custom agents from `.codex/agents/*.toml`
  (project) or `~/.codex/agents/*.toml` (global), never from a plugin bundle; a
  plugin-root `agents/` dir or `interface` block is branding metadata only
  `[CX-AGENTS-DISTINCT-001]` (C3, C5). A named standalone agent **does spawn**, but the
  v2 multi-agent runtime this build selects ignores the agent's declared `model`/`role`
  (the #15250/#20077 config-fidelity limitation) — deferred as SD-2 (§7)
  `[CX-SUBAGENT-V2-001]` (C5).
- **Trust** — two layers: a plugin `authPolicy` (`ON_INSTALL`/`ON_USE`) gates activation,
  and a **content-hash-pinned hook-trust table** (`[hooks.state]."<source>:<event>:…"` →
  `trusted_hash`) gates hook execution; changing a hook's content re-arms the review. Only
  the interactive `/hooks` review writes trust; the sole headless bypass is a
  deliberately-unused safety-bypass flag `[CX-TRUST-001]` (C3, C4).
- **Lifecycle** — marketplace add (local path or git) → `plugin add` copies the bundle
  into `$CODEX_HOME/plugins/cache/…` and sets `enabled = true` → `plugin remove` reverses
  cleanly. The per-plugin `[plugins."…"].enabled` toggle is the user-side lever
  `[CX-LIFECYCLE-001]` (C3).

### 2.3 Audit corrections — where the evidence overruled the docs or the roadmap

| Assumed / documented | Observed (binding for SPEC-026) | Evidence |
|---|---|---|
| Claude plugin MCP declarable inline in `plugin.json` **or** as `./.mcp.json` | Only the **`.mcp.json` file form** surfaced in the component tally on 2.1.206 — use it | `[CC-MANIFEST-001]` |
| Claude hooks file as a flat `{ "UserPromptSubmit": … }` map | Requires the **top-level `"hooks"` wrapper**; the flat form fails validation | `[CC-HOOK-001]` |
| Roadmap: skills declare their MCP dependency via a `metadata.mcp-server` frontmatter field | **No such field exists.** Anthropic documents a qualified `ServerName:tool_name` **body** reference; Codex uses the `agents/openai.yaml` `dependencies.tools` sidecar | S2, S4, S9; `[CX-SKILLS-001]` |
| Codex hook file fixed at `hooks/hooks.json` | The **manifest key** `hooks` is fixed; the filename is the author's choice (real plugins use `hooks.json`, `codex-hooks.json`, …) | `[CX-HOOK-SURFACE-001]` |
| Roadmap prediction: the Codex prompt hook is the likely plugin casualty | **Wrong on the shipped build** — the hook is plugin-carried and version-gated ON at ≥0.144.0 | `[CX-HOOK-PROMPT-001]` |

---

## 3. The MCP launcher contract (OQ-8 — resolved)

**Verdict: the PRD's ordered-fallback hypothesis is confirmed and adopted as specified,
with two refinements.** It was not falsified, so no launcher trade study is produced.
Validated three-stages-per-host on Claude Code and Codex (macOS) and on Linux/Docker;
Windows is staged-deferred (SD-1, §7). Evidence: the twelve `LX-*` blocks in Appendix B.3.

The plugin's `.mcp.json` declares a **stub launcher** (`command:"node"` + a bundled
`launcher.mjs`). On spawn it resolves, in order:

1. **PATH-resolved installed binary.** If `codegraph` resolves (PATH, `$CODEGRAPH_BIN`,
   or absolute path), `exec <bin> serve --mcp` — the real server comes up.
   **Refinement 1 — GUI PATH scoping:** bare-name `codegraph` is NOT on the GUI-inherited
   PATH on macOS, nor on a clean Linux host — the in-repo Antigravity darwin precedent,
   realized `[LX-CC-STAGE1-001]` `[LX-LNX-STAGE1-001]`. Stage 1 must resolve via
   login-shell PATH or absolute path, and treat "binary absent" as the realistic default.
2. **`npx --offline` thin-installer, cache-first.**
   `npx --offline --yes @colbymchenry/codegraph@^1 serve --mcp`. A warm npm cache serves
   the shim with zero network; a cold cache fails **catchably** (`ENOTCACHED`, exit 1) —
   the fall-through signal `[LX-CC-STAGE3-001]` `[LX-CX-STAGE2-001]`.
   **Refinement 2 — the two-hop offline condition:** `--offline` covers only the
   npm-registry hop. The shim then fetches a **~50 MB per-platform bundle from GitHub
   Releases** — a second network dependency `--offline` does not cover
   `[LX-CC-STAGE2-001]`. Full offline operation therefore requires the npm cache **and**
   the bundle already on disk; a shim-cached-but-bundle-absent offline launch is a stage-2
   failure that falls through to stage 3, never a hang.
3. **Success-shaped setup guidance (the stub).** When nothing resolves, the launcher
   still starts an MCP-speaking process and completes the handshake: `initialize` →
   instructions, `tools/list` → one `codegraph_setup_guidance` tool, `tools/call` →
   guidance text — exit 0, **no `isError` anywhere**. Validated end-to-end on both hosts
   and Linux; the model treats the reply as guidance, not an error
   `[LX-CC-STAGE3-001]` `[LX-CX-STAGE3-001]` `[LX-LNX-STAGE3-001]`. This honors the
   errors-teach-abandonment doctrine: one `isError` early and an agent abandons the tool.

**Contract properties (binding for SPEC-026):**

- **Any npx-stage failure falls through** — offline cache-miss, corrupt/partial cache,
  npx/runtime unavailable, nonfunctional package, missing second-hop bundle — all degrade
  to the same live stage-3 guidance, never a failed spawn.
- **Install is a USER action.** The guidance says a user should run
  `npx @colbymchenry/codegraph@^1 install`; the launcher and the agent never auto-install.
- **Do not assume `node`.** All three hosts hand the subprocess **no runtime of their
  own** — a bare `command:"node"` resolves against the inherited PATH
  `[LX-CC-RUNTIME-001]` `[LX-CX-RUNTIME-001]` `[LX-LNX-RUNTIME-001]`. The resolved
  codegraph binary is runtime-self-sufficient (bundled Node ≥22.5), but the launcher must
  locate its own interpreter or pin one.
- **Disclosed supply-chain choices:** `--offline` rather than `--prefer-offline` (which
  still makes network requests, C7); a **major-version pin** `@^1` rather than floating
  `latest` (OWASP CICD-SEC-3 / "Shai-Hulud" mitigation, C8); the ~50 MB bundle weight is
  the npm channel's existing cold-fetch cost, not a new one.

**Network/telemetry parity (constitution Principle VII).** The plugin channel introduces
**no phone-home, egress, telemetry, or auto-install beyond the npm channel**: the launcher
`exec`s the same binary the installer configures (identical posture; identical opt-outs —
`codegraph telemetry off`, `CODEGRAPH_TELEMETRY=0`, `DO_NOT_TRACK=1`); its pre-exec path
performs no independent network action; the hook, skills, and agent definitions are local
scripts/static text. The only network actions in the whole contract are stage 2's two
hops — both the npm thin-installer's own existing actions. **Scope note:** this
affirmation covers today's component roster (MCP server, prompt hook, skills, agents); any
later component type (LSP server, daemon, PATH-exposed executable, extra hook) must re-run
it before shipping. No net-new surface was discovered.

---
## 4. Ownership & coexistence with the npm installer

### 4.1 The 8-cell matrix

Each cell: can the host's plugin format carry the component, and which channel owns the
active registration. All eight are decided; none is blank or explicitly-absent. Can-carry
and owner diverge on exactly one cell (MCP × Claude) — the plugin *can* carry the server,
but the coexistence lever assigns the active registration to the installer (§4.2).

| Component | Claude Code | Codex |
|---|---|---|
| **MCP server** | carry: yes → **installer-owned** (lever i, §4.2). The plugin bundles the launcher; the installer's entry stays the active registration. | carry: yes → **plugin-owned**. Bundle `.mcp.json` registers and spawns `[CX-MCP-001]`; no host dedup on Codex, reconciled by installer detection + the user toggle. |
| **Prompt front-load hook** | carry: yes → **plugin-owned** `[CC-HOOK-001]`. | carry: yes → **plugin-owned**, version-gated ON at ≥0.144.0 `[CX-HOOK-PROMPT-001]`; one interactive trust step outstanding (SD-3). **Not** "absent on Codex" — the roadmap's casualty prediction was wrong (§2.3). |
| **Skills** | carry: yes → **plugin-owned** `[CC-MANIFEST-001]`. | carry: yes → **plugin-owned** `[CX-SKILLS-001]`. |
| **Agents** | carry: yes → **plugin-owned** `[CC-AGENT-TOOLS-001]`. | carry: **no** → **installer-owned, new SPEC-026 capability**: the installer writes standalone `.codex/agents/*.toml` `[CX-AGENTS-DISTINCT-001]`; gated on SD-2 (§5). |

Two installer-owned cells, different novelty: **agents × Codex** is net-new installer
capability (it writes no agent TOML today); **MCP × Claude** is the existing registration
— only the cross-channel *detection* below is new.

### 4.2 Coexistence: lever (i), realized by installer detection

**Decision: lever (i)** — the installer **keeps** writing its MCP entry and the plugin's
copy is the redundant one. (The alternative, lever (ii) — installer defers to the plugin —
was rejected: it contradicts the host's own "manual wins" dedup default and opens a
zero-registered-server window whenever the plugin is disabled or removed.)

What the evidence adds — **host dedup will not do this job.** Claude's dedup (CHANGELOG
v2.1.71, refined v2.1.152) keys on a **textually identical command/URL + env**, and the
two channels' commands always differ textually: the plugin's is
`${CLAUDE_PLUGIN_ROOT}`-relative, the installer's is `codegraph` /
`npx @colbymchenry/codegraph@^1` / an absolute path. Forced live on both hosts, the
near-duplicate (textually distinct, same binary) produced **two healthy simultaneous
registrations, two distinct tool namespaces, and zero host warnings** — nothing fired
`[NEARDUP-001…004]`. Codex has no cross-channel dedup at all.

So lever (i) is realized by **installer-side detection** (the spec's FR-012 mechanism),
not by the host: on the next explicit `codegraph install`, the installer detects the
coexisting plugin (directory/manifest presence — net-new capability) and skips or offers
to remove its own redundant MCP and hook entries. Host dedup remains a backstop for the
exact-match case only `[DEDUP-CC-001]`. Until that next install runs, the near-duplicate
is a tolerated, harmless state — and the installer's entry remains the active
registration, which is why the §4.1 matrix owner is "installer".

Remaining coexistence facts, both directions:

- **Codex levers (two, both non-host):** the installer detection above, and the user-side
  per-server toggle `plugins.<plugin>.mcp_servers.<server>.enabled` (or disabling the
  installer's `[mcp_servers.*]` entry) `[CX-LIFECYCLE-001]`.
- **Plugin-side self-suppression is non-viable.** Neither format has a "skip starting my
  server" field, and exiting before the handshake surfaces as a JSON-RPC −32000 protocol
  error on Claude. The only constructible plugin-side fallback is a completed handshake
  returning an empty `tools/list` — the shape the stub already produces.
- **Who reports a both-present state:** on Claude, nothing host-side (the `/plugin` dedup
  notice covers exact matches only); on Codex, no surface exists by construction. The
  reporter on both hosts is the installer's next-invocation detection; the residual-window
  observable is duplicate servers/hooks until the next `codegraph install`. This is
  deliberately **not** a `codegraph status` role — `status` reports index health and
  carries no config-diagnostic precedent.

### 4.3 Uninstall rules — no orphans

- **Removing the plugin** removes its components atomically (they live in the plugin, not
  the user's host config). The installer restores its own entries on the next explicit
  `codegraph install` — invocation-driven, matching the installer's existing self-heal
  precedent; never a file watcher or background process.
- **`codegraph uninstall`** removes only what the installer wrote and must not touch the
  plugin's entries.
- **No zero-server window:** under lever (i) the installer's entry persists through a
  plugin disable/removal — the resilience that rejected lever (ii).

---

## 5. The degraded-Codex subset

**Exactly one cell is degraded: agents × Codex.** The Codex plugin ships three of its four
components exactly as the Claude plugin does. The predicted casualty — the prompt hook —
is not degraded on the shipped build (§2.3).

For agents, the installer covers the gap by writing standalone `.codex/agents/*.toml`
(new capability), **gated on SD-2**: the named agent spawns, but the v2 runtime ignores
its declared `model`/`role` `[CX-SUBAGENT-V2-001]`. The decided user-observable:
**functionally equivalent, no degraded signal** — the subagent is invocable and works;
until SPEC-026 confirms config fidelity on the shipped runtime/model pairing, an invoked
agent may silently run on the parent session's model/role. That risk is routed to
SPEC-026's pre-ship gate, not surfaced to users as an error.

The asymmetry vs Claude Code is fully localized: on Claude, subagents ship inside the
plugin; on Codex they are installer-written TOML. A Codex user loses nothing else.

---

## 6. Shipped artifacts: skills-first

### 6.1 The authoring standard (grounding for every SPEC-026 skill)

Both hosts implement the **shared agent-skills open standard** (S1, S2): a skill is a
directory whose `SKILL.md` carries YAML frontmatter (`name`, `description`, optional
`license`/`compatibility`/`metadata`/`allowed-tools`) and a markdown body, with optional
`scripts/`, `references/`, `assets/`. One source tree serves both hosts' skill bodies
unchanged (confirmed hands-on on both, §2). Four things do **not** transfer:

| Divergence | Claude Code | Codex |
|---|---|---|
| Discovery dir | plugin `skills/` pointer; user/project `.claude/skills/` (S8) | plugin `skills/` pointer; `.agents/skills` scan order; `~/.codex/skills/` (S9) |
| Tool-permission frontmatter | `allowed-tools` honored as **pre-approval** (S3, S4) | **ignored** in `SKILL.md`; sidecar `agents/openai.yaml` carries it (S9) |
| Auto-invoke opt-out | host-level invocation control (S8) | `allow_implicit_invocation: false` in the sidecar (S9) |
| Invocation | implicit description-match; `/<plugin>:<skill>` (S8) | explicit `$skill-name` or implicit (S9) |

The load-bearing authoring rules (Anthropic S3–S7; OpenAI S9, S10):

- **Progressive disclosure** — frontmatter always loaded; body on trigger; `references/`
  on demand. Keep always-on cost minimal.
- **The MCP-enhancement category** — "MCP provides the kitchen, skills provide the
  recipes" (S5, S6): a skill encodes a repeatable multi-step recipe over a tool the agent
  **already calls**. Every CodeGraph candidate is a recipe over `codegraph_explore`.
- **What/when trigger discipline** — the `description` says what the skill does and when
  to use it, in the vocabulary a user actually types.
- **Structural + security rules** — kebab-case `name` ≤64 chars; the file is exactly
  `SKILL.md`; `description` ≤1024; no XML; `anthropic`/`claude` prefixes reserved (S2, S3).
- **`allowed-tools` is pre-approval, not restriction** — and Codex ignores it, so it is
  not a cross-host restriction mechanism; restriction, where ever needed, is a
  `disallowed-tools`-style denylist.
- **MCP dependency declaration** — a qualified `ServerName:tool_name` **body** reference
  on Anthropic (`codegraph:codegraph_explore`), the `agents/openai.yaml`
  `dependencies.tools` sidecar on Codex. Not a `metadata.mcp-server` field (§2.3).
- **OpenAI authoring practice** — one focused job per skill; imperative steps with
  explicit inputs/outputs; front-loaded use cases; trigger testing with should /
  should-NOT lists; instructions over scripts unless determinism is required (S9).
- **Published success criteria** (both vendors): trigger rate, workflow tool-call count,
  zero failed tool calls, with/without comparison — published as **measurements to
  record, not target numbers**; Anthropic itself notes Claude undertriggers skills
  (S4, S5). These measurements are folded into the §6.3 bar.

### 6.2 Candidates — three-leg inclusion criterion, one survivor

A workflow qualifies only if it (1) **rides `codegraph_explore`** — the one tool agents
already call (the repo's "adapt the tool to the agent" lever; the default MCP surface is
`codegraph_explore` alone); (2) **adds a delta over the server-injected instructions**
(issue #529) — a skill that restates what every session already receives adds nothing; and
(3) **is plausibly A/B-bar-clearing** (§6.3). Most plausible skills die on leg 2, because
the injected instructions already carry the explore-before-Read doctrine:

| # | Candidate | Verdict |
|---|---|---|
| K1 | **explore-flow** — trace "how does X reach Y" via symbol-bag queries | **INCLUDED** → Appendix A |
| K2 | pre-edit blast-radius survey | excluded — restates #529's "edit with the blast radius in view" |
| K3 | area-survey / onboarding | excluded — #529 already routes this; single-call, no recipe |
| K4 | staleness-banner re-verification | excluded — protocol carried verbatim in #529 |
| K5 | monorepo `projectPath` routing | excluded — a single-argument convention; not bar-moving |

**K1's shape:** fully-open tier (keeps `Edit`/`Write`; no `allowed-tools`/
`disallowed-tools`; no `context: fork` — the recipe holds only for the current turn; it
never touches the operator-controlled MCP tool exposure). Its honest delta over #529 is
thin but real: how to *construct* the symbol bag (qualified `Class.method`; a PascalCase
type token to disambiguate overloads), the explore-again-not-Read escalation loop, and the
explicit stop condition. The body **references** the injected guidance rather than
restating it, and stays correct if `server-instructions.ts` changes.

### 6.3 The A/B validation bar (SPEC-026 executes it; nothing ships without it)

A third comparison mode, distinct from the repo's two existing eval scripts:
**artifact-off vs artifact-on, both codegraph-on.** Both arms on the Sonnet floor
(`--model sonnet --effort high`, per repo model policy); ≥2 runs per arm, report ranges;
primary metrics wall-clock, total tool calls, Read/Grep count, plus a **control repo** to
catch regressions the skill causes elsewhere; the vendors' published measurements (§6.1)
and a reference-not-restate check recorded alongside. **Pass = no regression.** A
candidate that ties-or-regresses does not ship — including K1. Skill trigger efficacy is
unproven (undertriggering is documented), so a K1 failure is an acceptable, informative
outcome: the exemplar de-risks the authoring pattern either way.

### 6.4 Agents: none in v1

`retrieval-guardian` — the one existing agent — reviews CodeGraph's own source and
constitution, which do not exist in a user's repo; it is inapplicable to a user install.
Beyond that, two evidenced reasons no agent ships: (1) **cross-host inconsistency** —
Claude plugin agents cannot declare `hooks`/`mcpServers`/`permissionMode`
`[CC-AGENT-TOOLS-001]`, Codex does not load agents from the bundle at all, and the v2
runtime ignores declared model/role (SD-2) — an agent cannot behave identically on both
hosts today; (2) an explicitly-dispatched agent is the **low-salience anti-pattern** this
repo has already validated: hosts under-pick new tools/agents, so the artifact would sit
unused. **Admit-later criterion:** a concrete read-only workflow over the *user's* repo
that must outlast the turn (the `context: fork` case, denylist-only), clearing the same
§6.3 bar, after SD-2 is resolved.

---

## 7. Staged decisions — SPEC-026 pre-ship gates

Everything decided in §§1–6 stands on recorded evidence. Exactly four validation legs are
outstanding; each names what was attempted, the evidenced blocker, and the closing step.
(Linux needed no deferral — Docker was available and the launcher chain validated
end-to-end, Appendix B.3.)

**SD-1 — Windows launcher three-stage. DEFERRED.** Attempted against the Parallels
"Windows 11" VM via the repo's documented SSH bridge, to probe (a) the
CVE-2024-27980-class `.cmd` spawn refusal (#289) and (b) bare-name PATH resolution for a
GUI-launched host. Blocker: the VM is suspended with no IP **and** the `.parallels`
credentials file is absent, so the VM cannot be reached or authenticated (resuming it was
deliberately not done — state-changing and still credential-blocked)
`[LX-WIN-ATTEMPT-001]`. Gate: on a reachable Windows host, confirm the launcher spawns the
shipped `.cmd` entry point without the refusal (spawn with `shell:true` + escaping, or a
non-`.cmd` entry point), and that bare-name resolution succeeds or is not relied on. A
reachability deferral — it does not re-open OQ-8.

**SD-2 — Codex subagent v2 config fidelity. DEFERRED.** Attempted: named-agent invocation
of a standalone `.codex/agents/codegraph-explorer.toml` (declared model `gpt-5.5`) via
`codex exec` on 0.144.0. Blocker: the spawn succeeded but the v2 runtime ignored the
declared model and role (ran parent `gpt-5.6-sol`; `agent_role: null`) — the
#15250/#20077 limitation, observed live `[CX-SUBAGENT-V2-001]`. Gate: confirm declared
model + role are applied on the exact shipped runtime/model pairing — or ship Codex agents
in a form that does not depend on per-agent overrides.

**SD-3 — Codex prompt-hook model-reach leg. DECIDED; one confirmation leg.** The decision
(plugin-owned, version-gated ON) stands on the hook demonstrably firing. The end-to-end
"context reaches the model" run is blocked headlessly by the hook-trust gate — a plain
`codex exec` correctly skipped the untrusted hook, and the only bypass is a
deliberately-unused safety flag `[CX-HOOK-PROMPT-001]`. Human step: interactive `codex` →
`/hooks` → trust the hook → `codex exec` and confirm the canary
`CODEGRAPH_SCRATCH_CANARY_7F3A9D2` prints.

**SD-4 — Interactive Claude host-UI confirmations. DECIDED; visual checks only.** Three
UI-only visuals remain, each validated structurally or from the public CHANGELOG: the
marketplace install trust prompt `[CC-MARKETPLACE-001]`; the `/plugin` dedup suppression
notice for an exact-match duplicate `[DEDUP-CC-001]`; the absence of any suppression badge
in the near-duplicate state `[NEARDUP-004]`. Human steps are recorded in the respective
evidence blocks.

---

## 8. Sources

All committed citations are public (verified live 2026-07-10;
`specs/025-plugin-platform-spike/research.md` §2a is the verification ledger). The
citation audit found no private or vault path anywhere in this document; local
registry/cache paths quoted in evidence are product artifacts with home/user segments
redacted.

**Claude Code (P·)**

- **P1** Plugins reference — `https://code.claude.com/docs/en/plugins-reference`
- **P2** MCP — `https://code.claude.com/docs/en/mcp`
- **P3** Plugin marketplaces — `https://code.claude.com/docs/en/plugin-marketplaces`
- **P4** Claude Code CHANGELOG (public) — versioned entries cited inline (v2.1.71,
  v2.1.152, v2.1.154)

**Skills (S·)**

- **S1** Agent Skills open standard — `https://agentskills.io`
- **S2** Format specification — `https://agentskills.io/specification`
- **S3** Anthropic Agent Skills overview — `https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview`
- **S4** Anthropic best-practices — `https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices`
- **S5** "The Complete Guide to Building Skills for Claude" (public PDF) — `https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf`
- **S6** Anthropic engineering blog (2025-10-16) — `https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills`
- **S7** `anthropics/skills` — `https://github.com/anthropics/skills`
- **S8** Claude Code skills doc — `https://code.claude.com/docs/en/skills`
- **S9** OpenAI Codex "Build skills" — `https://developers.openai.com/codex/skills` (308 → `learn.chatgpt.com/docs/build-skills`)
- **S10** OpenAI curated examples — `https://github.com/openai/plugins` (replacing the DEPRECATED `github.com/openai/skills`)

**Cross-cutting (C·)** — inlined here so the references never dangle if the research
ledger is archived:

- **C1** Claude Code plugin docs — `https://code.claude.com/docs/en/plugins` (+
  `plugins-reference`, `skills`, `mcp` on the same host)
- **C2** Claude Code CHANGELOG — `https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md`
  (v2.1.71 dedup; corroborated by issue `#32549`)
- **C3** OpenAI Codex plugin docs — `https://developers.openai.com/codex/plugins`, `…/plugins/build`,
  `…/hooks`, `…/subagents` (each 308 → the `learn.chatgpt.com/docs/…` mirror)
- **C4** Codex plugin-hooks gap + fix — `https://github.com/openai/codex/issues/16430`;
  `https://github.com/openai/codex/pull/19705`
- **C5** Codex subagent fidelity — `https://github.com/openai/codex/issues/15250`;
  `https://github.com/openai/codex/issues/20077`
- **C6** the skills source set (= S1–S10 above)
- **C7** npm config: `offline` vs `prefer-offline` — `https://docs.npmjs.com/cli/v10/using-npm/config`
- **C8** OWASP CICD-SEC-3 Dependency Chain Abuse — `https://owasp.org/www-project-top-10-ci-cd-security-risks/CICD-SEC-03-Dependency-Chain-Abuse`
- **C9** CVE-2024-27980 — `https://nvd.nist.gov/vuln/detail/CVE-2024-27980`; in-repo
  `CHANGELOG.md` #289 (the `.cmd` spawn-refusal fix)
- FR-019 exposure (b) grounding — `https://github.com/anthropics/claude-code/issues/18692`
  (`claude mcp add` writes resolved env values back)

---
## Appendix A — the explore-flow exemplar skill

The one fully-drafted artifact body (no other candidate gets a body). SPEC-026 lifts this
single `SKILL.md` source tree into the real plugin's `skills/codegraph-explore-flow/` on
both hosts; per-host wiring (discovery dir, invocation, the Codex `agents/openai.yaml`
sidecar for the MCP dependency — §6.1) is a lift detail, not a body change.

**`skills/codegraph-explore-flow/SKILL.md`:**

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

**Compliance.** The body points to the host-injected #529 guidance and adds only the delta
recipe — no verbatim copy of the `initialize` text; it names the file and the qualified
`codegraph:codegraph_explore` tool, not their contents, so it stays correct if
`server-instructions.ts` changes. The MCP dependency is a qualified body reference, not a
`metadata.mcp-server` field (§2.3). Fully-open tier: no `allowed-tools` /
`disallowed-tools`.

---

## Appendix B — validation evidence

A **Validation Evidence Block** is the unit every bracketed `[ID]` in §§1–7 resolves to:
one observation against a scratch plugin (built outside the repo tree, never committed)
loaded in a real host. 31 blocks follow, grouped by concern. The schema was frozen before
any evidence was recorded.

### B.0 The evidence schema + secret-scrub rule (frozen)

Every block carries all seven fields; a field that genuinely does not apply is recorded as
`n/a` with a one-clause reason.

| # | Field | Required content |
|---|-------|------------------|
| 1 | **id** | Stable identifier the body and the App C.3 traceability map reference, namespaced by concern (`CC-*` Claude audit, `CX-*` Codex audit, `LX-*` launcher, `DEDUP-*`/`NEARDUP-*` coexistence). |
| 2 | **subject** | What the block observes — the exact manifest field, hook, launcher stage, dedup surface, or runtime path under test. |
| 3 | **host + pinned version** | Which host **and** the exact pinned build — a claim is only as good as the build it was seen on. |
| 4 | **exact repro command** | The precise command(s) that forced the observed condition — copy-pasteable. |
| 5 | **quoted manifest/config snippet** | The verbatim config text the claim rests on, secret-scrubbed. |
| 6 | **observed behavior** | What actually happened — transcript/observation, secret-scrubbed. May include host debug output and env/PATH dumps (the PATH-scoping rule below invites them). |
| 7 | **supported claim OR "could not validate" note** | The single claim the block grounds — or an explicit note why it could not be validated (a documented deferral, never a silent gap). |

**Launcher-chain rule.** The §3 contract is validated as an ordered chain — one block per
stage per host: (1) binary present on PATH; (2) binary absent + warm npm cache; (3) binary
absent + offline/uncached. Each launcher block pins the condition-forcing command and
records **PATH scoping** (login-shell vs app-inherited) — bare-name resolution for a
GUI-launched host is a known risk. macOS is the hands-on primary (3 stages × 2 hosts); the
same sequence is attempted on Windows and Linux, with any incomplete platform recorded as
an explicit staged deferral, never omitted.

**Secret-scrub rule (mandatory at drafting time).** Every block is scrubbed across all
four artifact classes (fields 3–6): no `CODEGRAPH_EMBEDDING_API_KEY`, private
embedding-endpoint value, or any other untracked `.envrc.local` value in committed text.
Redaction is by **identity-preserving placeholder, never line deletion**
(`<REDACTED:EMBEDDING_ENDPOINT>`, `<REDACTED:CODEGRAPH_EMBEDDING_API_KEY>`, unresolved
`${VAR}`), and covers **both endpoint forms** — the raw URL and its scheme+host:port
form (host:port alone identifies private infrastructure). Four named exposure points
require redaction wherever they could surface:

- **(a)** the dogfood binary-present launcher stage — `scripts/mcp-dogfood.mjs` injects
  `.envrc.local` into the spawned server env;
- **(b)** `claude mcp add` resolves `${ENV_VAR}` placeholders and writes literal values
  back into `.mcp.json` (anthropics/claude-code#18692) — post-add snippets included;
- **(c)** `codegraph status` prints the embedding endpoint in human and JSON output;
- **(d)** the plaintext-http embedding warning echoes the endpoint.

The final verification sweep across all four classes × four exposure points is recorded
CLEAN in App C.2.

### B.1 Claude Code audit blocks

All blocks: **Claude Code 2.1.206**, macOS darwin-arm64, the scratch plugin
(`codegraph-scratch`) loaded per-session via `--plugin-dir` — never installed into the
user's real `~/.claude`.

**`CC-MANIFEST-001`**
- **subject** — `.claude-plugin/plugin.json` manifest recognition + component tally.
- **host + pinned version** — Claude Code 2.1.206, macOS darwin-arm64.
- **exact repro command** — `claude plugin validate <scratch>` and
  `claude plugin validate <scratch> --strict`; then
  `claude --plugin-dir <scratch> plugin details codegraph-scratch`.
- **quoted manifest snippet** —
  ```json
  { "name": "codegraph-scratch", "version": "0.0.1",
    "description": "…", "author": { "name": "SPEC-025 plugin platform spike" },
    "keywords": ["codegraph","spike","evidence-only"] }
  ```
  (plus a sibling `.mcp.json`, `hooks/hooks.json`, `skills/…/SKILL.md`, `agents/….md`).
- **observed behavior** — `validate` and `validate --strict` both print
  `✔ Validation passed` (exit 0). `plugin details` reports:
  `Skills (1) codegraph-explore-flow · Agents (1) codegraph-explorer · Hooks (1)
  UserPromptSubmit · MCP servers (1) codegraph · Always-on ~208 tok`.
- **supported claim** — the fixed manifest path and component-pointer set load exactly as
  P1 documents; `--strict` (fails on unrecognized fields) passes. Also grounds the §2.3
  correction: `plugin details` tallied `MCP servers (0)` for the inline-only `mcpServers`
  form and `MCP servers (1)` via `./.mcp.json` — the file form is the
  confirmed-recognized shape on 2.1.206.

**`CC-MCP-NS-001`**
- **subject** — plugin MCP auto-start, `${CLAUDE_PLUGIN_ROOT}` resolution, tool
  namespacing.
- **host + pinned version** — Claude Code 2.1.206, macOS.
- **exact repro command** — `claude --plugin-dir <scratch> --debug -p "Reply with the
  exact names of any tools whose name contains 'guidance' or 'codegraph'. If none, reply
  NONE."` (plain session; no approval-disabling flag).
- **quoted config snippet** — plugin `.mcp.json`:
  ```json
  { "mcpServers": { "codegraph": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/launcher.mjs"],
      "env": { "CODEGRAPH_PLUGIN_ROOT": "${CLAUDE_PLUGIN_ROOT}" } } } }
  ```
- **observed behavior** — the server started without any approval-disabling flag; the
  model replied with the single tool
  **`mcp__plugin_codegraph-scratch_codegraph__codegraph_setup_guidance`**. The launcher's
  runtime log shows `CODEGRAPH_PLUGIN_ROOT` resolved to the scratch plugin's absolute
  directory; `claude mcp list` shows `plugin:codegraph-scratch:codegraph - ✔ Connected`.
- **supported claim** — namespacing and `${CLAUDE_PLUGIN_ROOT}` resolution are exactly as
  P1/P2 document; the plugin MCP server auto-starts on a normal session.

**`CC-HOOK-001`**
- **subject** — `hooks/hooks.json` schema + `UserPromptSubmit` firing.
- **host + pinned version** — Claude Code 2.1.206, macOS.
- **exact repro command** — same `--plugin-dir` session as `CC-MCP-NS-001`.
- **quoted config snippet** —
  ```json
  { "hooks": { "UserPromptSubmit": [ { "hooks": [
      { "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/prompt-hook.mjs\"", "timeout": 10 } ] } ] } }
  ```
- **observed behavior** — `plugin validate` initially failed a **flat**
  `{ "UserPromptSubmit": … }` file with `hooks: Invalid input: expected record, received
  undefined`; wrapping the events under a top-level `"hooks"` key made it pass. In the
  session, the model's answer referenced "the `codegraph_explore` tool referenced by **the
  hook**" — a phrase that only appears in the hook's injected `additionalContext` — so the
  hook fired and its context reached the model.
- **supported claim** — plugin `UserPromptSubmit` hooks work and require the top-level
  `"hooks"` wrapper (the §2.3 correction); skills and agents load (tally in
  `CC-MANIFEST-001`).

**`CC-MARKETPLACE-001`**
- **subject** — marketplace registry shape + trust/approval surfaces.
- **host + pinned version** — Claude Code 2.1.206, macOS.
- **exact repro command** — read-only inspection of the live registry
  `~/.claude/plugins/known_marketplaces.json` and an on-disk
  `.claude-plugin/marketplace.json`; `claude plugin marketplace --help`.
- **quoted config snippet** — a live `known_marketplaces.json` entry:
  ```json
  { "<marketplace>": { "source": { "source": "github", "repo": "<org>/<repo>" },
      "installLocation": "/Users/<user>/.claude/plugins/marketplaces/<marketplace>",
      "autoUpdate": true } }
  ```
  and a `marketplace.json`:
  `{ "name": …, "owner": { "name": … }, "plugins": [ { "name", "source", "description", "version" } ] }`.
- **observed behavior** — marketplaces resolve from `github`/`git`/local sources with an
  `installLocation` and optional `autoUpdate`; `claude plugin marketplace
  add|list|remove|update` exist. P1: a plugin's MCP servers "go through the same
  per-server approval as a project `.mcp.json`"; `defaultEnabled` (min 2.1.154) controls
  post-install enablement; `enabledPlugins` in `.claude/settings.json` drives team
  enablement on folder-trust.
- **supported claim** — the marketplace + trust model is exactly as P1–P3 document.
  **Could not validate — interactive host UI:** the install-time / first-use trust prompt
  and the `/plugin` trust-review screen (SD-4, §7). Exact human step: in an interactive
  `claude` session, `/plugin marketplace add <repo>` then
  `/plugin install <plugin>@<marketplace>` and accept the trust prompt.

**`CC-AGENT-TOOLS-001`**
- **subject** — plugin-agent frontmatter fields + tool inheritance/denylist.
- **host + pinned version** — Claude Code 2.1.206, macOS; cross-checked against
  Anthropic's own on-disk `plugin-dev` agent-development skill.
- **exact repro command** — `claude plugin validate <scratch> --strict` (agent frontmatter
  with `tools` + `disallowedTools`); P1 §"agents" field table.
- **quoted config snippet** — scratch agent frontmatter:
  ```yaml
  name: codegraph-explorer
  model: inherit
  color: cyan
  tools: ["mcp__plugin_codegraph-scratch_codegraph__codegraph_explore", "Read", "Grep"]
  disallowedTools: ["Write", "Edit"]
  ```
- **observed behavior** — `--strict` passes with both `tools` and `disallowedTools`
  present. P1 verbatim: *"Plugin agents support name, description, model, … tools,
  disallowedTools, … For security reasons, hooks, mcpServers, and permissionMode are not
  supported for plugin-shipped agents."* Anthropic's agent-development skill: *"tools
  (optional) … Default: If omitted, agent has access to all tools"*.
- **supported claim** — tool inheritance (omit `tools`) + the `tools`/`disallowedTools`
  levers are real and validate; the plugin-agent security exclusions are a load-bearing
  constraint for the §6.4 agent decision.

### B.2 Codex audit blocks

All blocks: **Codex CLI 0.144.0** (`codex --version` → `codex-cli 0.144.0`; latest
advertised `0.144.1`), macOS, against an **isolated `CODEX_HOME`** so the operator's real
`~/.codex` was never mutated. The scratch plugin lives at
`<scratch>/codex-scratch-marketplace/plugins/codegraph-scratch/` and is never committed.

**`CX-MANIFEST-001`**
- **subject** — the Codex plugin manifest filename and its component-pointer keys.
- **host + pinned version** — Codex CLI 0.144.0, macOS.
- **exact repro command** —
  `cat ~/.codex/.tmp/bundled-marketplaces/openai-bundled/plugins/latex/.codex-plugin/plugin.json`
  (a real OpenAI-shipped plugin) and the scratch
  `…/codegraph-scratch/.codex-plugin/plugin.json`.
- **quoted manifest/config snippet** — real OpenAI `latex` plugin:
  ```json
  { "name": "latex", "version": "0.2.4",
    "interface": { "displayName": "LaTeX", "capabilities": ["Interactive","Read","Write"],
      "defaultPrompt": ["Use latex-doctor to check whether this machine can compile LaTeX."],
      "brandColor": "#2563EB" },
    "description": "Compile LaTeX …", "author": { "name": "OpenAI" },
    "license": "Proprietary", "keywords": ["latex", … ], "skills": "./skills/" }
  ```
  A cross-host plugin (`speckit-pro`) carries pointers to all three bundle-carried
  component types (`"skills": "./codex-skills/"`, `"hooks": "./codex-hooks.json"`, an
  `interface` block); a sibling bundled plugin declares `"mcpServers": "./.mcp.json"`.
- **observed behavior** — the manifest dir is confirmed **`.codex-plugin/`**, the file
  **`plugin.json`** (every OpenAI-bundled plugin carries exactly this). Codex parsed the
  scratch `plugin.json` on `codex plugin add` (name/version echoed in the install JSON).
  Component pointers observed in real manifests: `skills`, `hooks`, `mcpServers`, plus the
  `interface` branding block.
- **supported claim** — the Codex manifest is `.codex-plugin/plugin.json`, a superset of
  Claude's adding `interface`; component pointers are `skills`/`hooks`/`mcpServers`;
  **no `agents` pointer** (`CX-AGENTS-DISTINCT-001`). (C3)

**`CX-SKILLS-001`**
- **subject** — how a Codex plugin carries skills, and the on-disk skill format.
- **host + pinned version** — Codex CLI 0.144.0, macOS.
- **exact repro command** — `cat ~/.codex/skills/gh-stack/SKILL.md`; the scratch plugin's
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
  `<skill-name>/SKILL.md` bundles (YAML frontmatter `name` + `description` + optional
  `metadata`, markdown body). On install the whole `skills/` tree is copied verbatim into
  `$CODEX_HOME/plugins/cache/<plugin>@<marketplace>/<plugin>/<version>/skills/`.
- **supported claim** — Codex plugins carry skills as a `skills/<name>/SKILL.md` tree (the
  shared agent-skills standard, C6); the body transfers unchanged between hosts. The
  observed frontmatter carries no `mcp-server` key — part of the §2.3 correction.

**`CX-HOOK-SURFACE-001`**
- **subject** — the three places a Codex hook can be declared and the hook-manifest
  schema.
- **host + pinned version** — Codex CLI 0.144.0, macOS (`hooks` feature = stable/true).
- **exact repro command** — `cat ~/.codex/hooks.json`;
  `cat ~/.codex/.tmp/plugins/plugins/replayio/hooks.json` (real plugin hook); scratch
  plugin `hooks/hooks.json` (pointer `"hooks": "./hooks/hooks.json"`).
- **quoted manifest/config snippet** — global standalone `~/.codex/hooks.json`:
  ```json
  { "hooks": { "UserPromptSubmit": [ { "hooks": [ { "type": "command",
    "command": "/bin/zsh <HOME>/.codex/scripts/ensure-speckit-pro-latest.sh",
    "statusMessage": "Checking SpecKit Pro latest-release guard" } ] } ] } }
  ```
  A real plugin hook (`replayio`) uses plugin-root-relative commands:
  `"command": "./scripts/post_bash_upload.sh"`.
- **observed behavior** — three hook sources are real and share the Claude-Code schema
  (`{hooks:{<Event>:[{matcher?,hooks:[{type:"command",command,statusMessage?}]}]}}`):
  plugin-bundled (manifest `hooks` pointer; commands resolve relative to the plugin-cache
  root — cwd confirmed in `CX-MCP-001`), global `~/.codex/hooks.json`, and project
  `<project>/.codex/hooks.json` (present in the trust state, `CX-TRUST-001`). Events
  observed in the wild: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop`.
- **supported claim** — Codex hooks are Claude-Code-schema-compatible and declarable from
  a plugin bundle, a global file, or a project file; plugin hook commands are
  plugin-root-relative. The manifest **key** is `hooks`; the filename is the author's
  choice (the §2.3 correction). (C3)

**`CX-MCP-001`**
- **subject** — how a plugin registers an MCP server and whether Codex loads/spawns it.
- **host + pinned version** — Codex CLI 0.144.0, macOS.
- **exact repro command** — scratch plugin `.mcp.json`; then
  `CODEX_HOME=<scratch>/codex-home codex mcp list`.
- **quoted manifest/config snippet** — plugin `.mcp.json` (identical shape to the real
  OpenAI `sites` plugin):
  ```json
  { "mcpServers": { "codegraph-scratch": {
      "command": "node", "args": ["./mcp/stub-launcher.mjs"], "cwd": "." } } }
  ```
- **observed behavior** — `codex mcp list` shows the plugin-declared server in the same
  registry as `config.toml` `[mcp_servers.*]` servers: `Name=codegraph-scratch,
  Command=node, Args=./mcp/stub-launcher.mjs, Cwd=<cache>/…/0.0.1/., Status=enabled,
  Auth=Unsupported`. The cwd is the plugin-cache root, so relative paths resolve against
  the bundle. In a live session (`LX-CX-RUNTIME-001`) Codex spawned this server and it
  completed the MCP handshake.
- **supported claim** — a Codex plugin registers MCP servers via a bundle `.mcp.json`;
  Codex merges them into its unified registry (cwd = cache root) and spawns them — the
  plugin-channel analogue of the installer's `config.toml` `[mcp_servers.codegraph]`
  entry. (C3)

**`CX-AGENTS-DISTINCT-001`**
- **subject** — whether Codex loads custom agents from a plugin bundle vs from
  `.codex/agents/`, and the standalone agent-TOML format.
- **host + pinned version** — Codex CLI 0.144.0, macOS.
- **exact repro command** — `cat ~/.codex/agents/phase-executor.toml` (a real installed
  agent); scratch project `.codex/agents/codegraph-explorer.toml`; the invocation in
  `CX-SUBAGENT-V2-001`.
- **quoted manifest/config snippet** — real standalone agent TOML:
  ```toml
  name = "phase-executor"
  description = "Phase execution worker …"
  model = "gpt-5.5"
  model_reasoning_effort = "xhigh"
  sandbox_mode = "workspace-write"
  developer_instructions = """ … """
  ```
  And the decisive primary-source note from the real `speckit-pro`
  `.codex-plugin/plugin.json` `interface.longDescription`:
  > "SpecKit Pro also bundles Codex custom-agent TOML templates plus a Codex-only install
  > skill **because Codex still registers custom agents from `.codex/agents/` or
  > `~/.codex/agents/` rather than directly from the plugin bundle.**"
- **observed behavior** — the manifest has no `agents` component pointer
  (`CX-MANIFEST-001`); real cross-host plugins ship agent TOML **templates** and rely on
  an install step to copy them into `.codex/agents/`. The scratch standalone agent **was
  resolved and spawned** as a subagent (`CX-SUBAGENT-V2-001`) — the standalone path is the
  live one.
- **supported claim** — Codex agents load from `.codex/agents/*.toml` (project) or
  `~/.codex/agents/*.toml` (global), not from a plugin bundle; a plugin-root `agents/`
  dir / `interface` block is branding only. The agents × Codex cell (§4.1) therefore
  cannot be plugin-owned. (C3, C5)

**`CX-TRUST-001`**
- **subject** — how Codex gates plugin/hook execution (trust model).
- **host + pinned version** — Codex CLI 0.144.0, macOS.
- **exact repro command** — `codex plugin add … --json` (shows `authPolicy`);
  `grep -nE '^\[hooks' ~/.codex/config.toml` and reading the `[hooks.state]` table.
- **quoted manifest/config snippet** — the persisted hook-trust table (home path
  abbreviated, one representative hash shown):
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
  `"<source>:<event>:<matcher-idx>:<hook-idx>"` — `<source>` is a
  `<plugin>@<marketplace>:<hook-file>`, a global path, or a project path — with a
  `trusted_hash = "sha256:…"` over the hook definition. Changing a hook's content changes
  the hash and re-arms the review. These entries are written by the interactive `/hooks`
  review; the only non-interactive path is `codex exec --dangerously-bypass-hook-trust`.
- **supported claim** — Codex trust is two-layered: plugin `authPolicy`
  (`ON_INSTALL`/`ON_USE`) gates activation; the content-hash-pinned, source- and
  project-scoped hook-trust table gates hook execution. Confirmed on disk. (C3, C4)

**`CX-LIFECYCLE-001`**
- **subject** — the end-to-end install/enable/uninstall model (loadability; feeds §4).
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
  The marketplace descriptor Codex reads is `.claude-plugin/marketplace.json`
  (`{name, owner, plugins:[{name, source, version, …}]}`).
- **observed behavior** — `marketplace add` accepted a local path (also
  `owner/repo[@ref]`, HTTPS/SSH Git, `--ref`/`--sparse`); `plugin add` copied the bundle
  into `$CODEX_HOME/plugins/cache/<plugin>@<marketplace>/<plugin>/<version>/` and set
  `installed=true, enabled=true`; `plugin list --json` returned a rich record (`pluginId`,
  `marketplaceName`, `version`, `installed`, `enabled`, `source{local,path}`,
  `installPolicy`, `authPolicy`); `plugin remove` reversed it cleanly (exit 0).
- **supported claim** — the scratch Codex plugin loads, enables, and uninstalls cleanly on
  0.144.0. The config levers a coexisting installer must reconcile with are
  `[marketplaces.*]`, `[plugins."<plugin>@<marketplace>"].enabled`, and
  `[mcp_servers.*]` (§4.2). (C3)

**`CX-HOOK-PROMPT-001`**
- **subject** — does a plugin-owned `UserPromptSubmit` hook emit
  `hookSpecificOutput.additionalContext` that reaches the model, on this pinned build.
- **host + pinned version** — Codex CLI 0.144.0 (latest `0.144.1`) — well past the
  issue-#16430 documented-but-not-executed window and past PR #19705 (merged 2026-04-28);
  corroborated hands-on: `hooks` = stable/true and the old gating flag `plugin_hooks` =
  **removed** (plugin hooks unconditional, gated only by the hook-trust review).
- **exact repro command** —
  1. author `hooks/inject-context.mjs` emitting
     `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"CODEGRAPH_SCRATCH_CANARY_7F3A9D2 …"}}`;
  2. `codex plugin add codegraph-scratch@codegraph-scratch` (installed + enabled);
  3. command-level fire: `(cd <cache>/…/0.0.1 && node ./hooks/inject-context.mjs)`;
  4. end-to-end model reach (attempted):
     `codex exec -C <project> "…print the CODEGRAPH_SCRATCH token…"`.
- **quoted manifest/config snippet** — `hooks/hooks.json`:
  ```json
  { "hooks": { "UserPromptSubmit": [ { "hooks": [ { "type": "command",
    "command": "node ./hooks/inject-context.mjs",
    "statusMessage": "codegraph-scratch: injecting explore-first retrieval context" } ] } ] } }
  ```
- **observed behavior** — the hook fires correctly at the command level, emitting the
  exact canary JSON. The end-to-end "reaches the model" leg could not be completed
  non-interactively: persisting hook trust requires the interactive `/hooks` TUI review
  (`CX-TRUST-001`), and the only headless avenue is the deliberately-unused
  `--dangerously-bypass-hook-trust` flag. A plain `codex exec` correctly **skipped** the
  untrusted hook — confirming the trust gate is real.
- **supported claim OR "could not validate" note** — **decision: prompt-front-load ×
  Codex = plugin-owned, version-gated ON on 0.144.0** (not "absent on Codex").
  Could-not-validate (one leg): the end-to-end model-reach confirmation — SD-3 (§7)
  carries the exact human step. (C4)

**`CX-SUBAGENT-V2-001`**
- **subject** — do standalone `.codex/agents/*.toml` load, and can a named subagent be
  invoked, on the runtime/model pairing CodeGraph ships against.
- **host + pinned version** — Codex CLI 0.144.0, macOS. Feature flags: `multi_agent` =
  stable/true, `multi_agent_v2` = under-development/false; `[agents] max_depth = 2`.
- **exact repro command** — `codex exec -C <scratch>/codex-scratch-project -s read-only
  --skip-git-repo-check "You have a custom subagent named 'codegraph-explorer' …
  invoke/delegate … reply DELEGATED …"`; then inspect the session rollout under
  `$CODEX_HOME/sessions/2026/07/10/rollout-…jsonl`.
- **quoted manifest/config snippet** — the standalone agent + the runtime rollout record:
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
  `agent_path=/root/codegraph_explorer` at `depth:1`). But the runtime self-reported
  `multi_agent_version:"v2"` (`multi_agent_mode: explicitRequestOnly`) — the flag name and
  the runtime field are distinct — and on this v2 path the agent's declared config was
  NOT applied: `agent_role: null`, and the declared `model = "gpt-5.5"` was ignored — the
  subagent ran on the parent session model `gpt-5.6-sol` (grep for `gpt-5.5` across all
  three rollouts = 0 hits). This is the #15250/#20077 v2 named-agent config-fidelity
  limitation: spawns, but does not honor the named agent's `model`/`role`.
- **supported claim OR staged-deferral note** — runtime path pinned
  (`multi_agent_version: v2`, mode `explicitRequestOnly`, Codex 0.144.0); named-agent
  invocation partially exercised — **staged deferral SD-2 (§7)**, gating the agents ×
  Codex cell (§5). (C5)
### B.3 Launcher-chain blocks (three stages × host; Windows attempt; Linux)

**Claude Code (T010).** All four blocks: Claude Code 2.1.206, macOS darwin-arm64, the
scratch plugin's `.mcp.json`
(`command:"node", args:["${CLAUDE_PLUGIN_ROOT}/mcp/launcher.mjs"]`). **Exposure-(a)
note:** the "binary present" stage's dogfood form (`node dist/bin/codegraph.js`) would
inject `.envrc.local` into a live server env — the stub stages were forced so no
endpoint/key was ever surfaced; any value that would appear is redacted as
`<REDACTED:EMBEDDING_ENDPOINT>` / `<REDACTED:CODEGRAPH_EMBEDDING_API_KEY>`.

**`LX-CC-STAGE1-001` — stage 1: binary present on PATH.**
- **subject** — PATH-resolved `codegraph` binary → exec real MCP server; GUI-launched PATH
  scoping.
- **host + pinned version** — Claude Code 2.1.206, macOS darwin-arm64; Node v24.11.1.
- **exact repro command** — `command -v codegraph`; and the plugin MCP subprocess's own
  PATH dump (launcher `launcher_start` log) when the host started it.
- **quoted config snippet** — launcher stage-1 resolver: `command -v codegraph` (or
  `$CODEGRAPH_BIN`) → `exec <bin> serve --mcp`.
- **observed behavior** — `codegraph` is **NOT on the GUI-inherited PATH** on this machine
  (`command -v codegraph` → not found). The plugin MCP subprocess received a PATH
  beginning `/opt/homebrew/…:…:/Users/<user>/Library/pnpm …` — the GUI-launched app's
  inherited environment, not a fresh login shell — carrying `node` but not `codegraph`.
  The "present" form on this repo is the dogfood `node dist/bin/codegraph.js` invoked by
  absolute path, never a bare-name `codegraph`.
- **supported claim** — stage-1 bare-name resolution fails for a GUI-launched host whose
  inherited PATH lacks `codegraph` — the in-repo Antigravity darwin-only precedent,
  realized. PATH is app-inherited, not login-shell resolved (§3 refinement 1).

**`LX-CC-STAGE2-001` — stage 2: binary absent + warm npm cache.**
- **subject** — `npx --offline` cache-first serve of the thin-installer.
- **host + pinned version** — Claude Code 2.1.206 / npm 11.6.2 / Node v24.11.1, macOS.
- **exact repro command** — `npm cache add @colbymchenry/codegraph@^1` (warm the cache; no
  install scripts, no binary) → `npx --offline --yes @colbymchenry/codegraph@^1 --version`.
- **quoted config snippet** — launcher stage-2 handoff:
  `npx --offline --yes @colbymchenry/codegraph@^1 serve --mcp`.
- **observed behavior** — with the cache warm (tarball `codegraph-1.4.0.tgz` present),
  `npx --offline` serves the npm shim from cache (past the ENOTCACHED gate). The shim then
  printed: *"codegraph: platform bundle missing … downloading
  codegraph-darwin-arm64.tar.gz from GitHub Releases (1.4.0)…"* — the shim reaches GitHub
  Releases for the ~50 MB per-platform bundle (staged atomically in
  `~/.codegraph/bundles/.dl-XXXX/`). The download was interrupted and the partial removed.
- **supported claim** — `npx --offline` covers only the npm-registry hop; the platform
  bundle is a SECOND network dependency `--offline` does not cover. "Warm npm cache ⇒
  offline serve" holds only if the bundle is already on disk; a missing bundle is a
  stage-2 failure that falls through to stage 3 (§3 refinement 2).

**`LX-CC-STAGE3-001` — stage 3: binary absent + npx offline/uncached → success-shaped guidance.**
- **subject** — stub launcher returns success-shaped MCP guidance, never
  `isError`/failed-spawn.
- **host + pinned version** — Claude Code 2.1.206 / npm 11.6.2, macOS.
- **exact repro command** — `npx --offline --yes @colbymchenry/codegraph@^1 --version`
  with the cache cold; then the stub over stdio:
  `printf '<initialize>\n<tools/list>\n<tools/call>\n' | CODEGRAPH_FORCE_STAGE=3 node launcher.mjs`;
  and end-to-end
  `claude --plugin-dir <scratch> --debug -p "…list codegraph/guidance tools…"`.
- **quoted config snippet** — stub `tools/call` result: `{ "content": [{ "type":"text",
  "text": "…a USER should run: npx @colbymchenry/codegraph@^1 install … No action is taken
  automatically." }] }` (no `isError` field).
- **observed behavior** — cold-cache `npx --offline` → `npm error code ENOTCACHED` /
  *"cache mode is 'only-if-cached' but no cached response is available"* / exit 1 (a clean
  catchable failure). The stub then completed the MCP handshake: `initialize` → result
  with `instructions`; `tools/list` → one `codegraph_setup_guidance` tool; `tools/call` →
  success-shaped text; exit 0, **no `isError` anywhere**. End-to-end, the model reported
  the tool available and relayed its guidance as guidance, not an error.
- **supported claim** — the absent-binary path is success-shaped; the install command is a
  USER action, never an agent auto-install.

**`LX-CC-RUNTIME-001` — runtime check: what runtime Claude provides.**
- **subject** — the runtime the host actually hands the plugin MCP subprocess.
- **host + pinned version** — Claude Code 2.1.206, macOS.
- **exact repro command** — the launcher's `launcher_start` log (`process.execPath`,
  `process.version`, `process.env.PATH`) captured when the host spawned it via
  `--plugin-dir`.
- **quoted config snippet** — manifest command
  `"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/mcp/launcher.mjs"]`.
- **observed behavior** — the host started the subprocess with `execPath =` the
  PATH-resolved `node` (nvm `v24.11.1`), `cwd =` the session's project dir, and the
  manifest `env` block propagated. The host did **not** inject a bundled runtime.
- **supported claim** — do not assume `node`: Claude provides the plugin subprocess no
  runtime of its own; `command:"node"` resolves against the host's app-inherited PATH. A
  `.cmd`/shell launcher is a Windows risk (SD-1).

**Codex (T011).** All four blocks: Codex CLI 0.144.0, macOS, the scratch plugin's
`.mcp.json` (`command:"node", args:["./mcp/stub-launcher.mjs"]`).

**`LX-CX-STAGE1-001` — stage 1: binary present on PATH → server comes up.**
- **subject** — a PATH-resolvable `codegraph` (or node-launched `dist/bin/codegraph.js`)
  is spawned by Codex and the tools appear.
- **host + pinned version** — Codex CLI 0.144.0, macOS; node v24.11.1 (nvm).
- **exact repro command** — `command -v codegraph`;
  `node <worktree>/dist/bin/codegraph.js --version`; the repo's own dogfood `.mcp.json`
  launcher shape.
- **quoted manifest/config snippet** — the repo's dogfood `.mcp.json` (the shipped
  "binary present via node" precedent):
  ```json
  { "mcpServers": { "codegraph": { "command": "node",
    "args": ["-e", "…walk-up locator that imports scripts/mcp-dogfood.mjs…"] } } }
  ```
- **observed behavior** — `command -v codegraph` → not on PATH (no global install), so the
  binary-present form was exercised via the node entry point:
  `node dist/bin/codegraph.js --version` → `1.3.1` (the real server binary runs). Codex
  spawns MCP `command` values exactly as declared (`LX-CX-RUNTIME-001`). PATH scoping
  observed: **login-shell** (CLI-launched session); GUI-launched scoping remains the
  documented risk. Run against the isolated scratch home + dist binary, not the dogfood
  index — no `.envrc.local` value present.
- **supported claim** — Codex spawns the launcher command as declared; with the binary
  reachable, the server comes up and tools appear. (C3, C7)

**`LX-CX-STAGE2-001` — stage 2: binary absent + warm npm cache → `npx --offline` serves.**
- **subject** — with no PATH binary but a warm npm cache, the `npx --offline` fallback
  serves the thin installer locally (zero network).
- **host + pinned version** — Codex CLI 0.144.0, macOS; npm cache under `~/.npm`.
- **exact repro command** — `npm cache ls @colbymchenry/codegraph`; (contract)
  `npx --offline @colbymchenry/codegraph@^1 serve --mcp`.
- **quoted manifest/config snippet** — npm cache hit for the package:
  ```
  make-fetch-happen:request-cache:https://registry.npmjs.org/@colbymchenry/codegraph/-/codegraph-1.4.0.tgz
  make-fetch-happen:request-cache:https://registry.npmjs.org/@colbymchenry%2fcodegraph
  ```
- **observed behavior** — the package is in the warm npm cache (`codegraph-1.4.0.tgz`), so
  `npx --offline` resolves it cache-first with no network request (C7: `--offline` =
  `only-if-cached`). Codex spawns this `npx` form identically to any other `command`.
- **supported claim** — stage 2 is viable on Codex. The major-version pin (`@^1`) is the
  OWASP CICD-SEC-3 / "Shai-Hulud" supply-chain mitigation, diverging deliberately from
  the unpinned `npx -y` MCP-reference pattern. (C7, C8)

**`LX-CX-STAGE3-001` — stage 3: binary absent + offline/uncached → success-shaped stub guidance.**
- **subject** — when nothing resolves, the stub still starts an MCP-speaking process and
  returns success-shaped guidance.
- **host + pinned version** — Codex CLI 0.144.0, macOS.
- **exact repro command** — `npx --offline @colbymchenry/nonexistent-pkg-xyz --version`
  (forces the uncached-offline condition);
  `printf '{"jsonrpc":"2.0","id":1,"method":"initialize",…}\n' | node ./mcp/stub-launcher.mjs`;
  and the live spawn in a `codex exec` session (`LX-CX-RUNTIME-001`).
- **quoted manifest/config snippet** — the stub's success-shaped `initialize` reply:
  ```json
  { "jsonrpc":"2.0","id":1,"result":{ "protocolVersion":"2025-06-18",
    "serverInfo":{"name":"codegraph-scratch-stub","version":"0.0.1"},
    "capabilities":{"tools":{}},
    "instructions":"codegraph binary not resolved. This is success-shaped guidance, not an
      error. A user (never the agent) can install it: `codegraph install`." } }
  ```
- **observed behavior** — uncached `npx --offline` fails catchably
  (`npm error code ENOTCACHED …`, no network request emitted). The stub answers
  `initialize` success-shaped with install guidance and `tools/list` → `[]`; **Codex
  spawned it in a live session and it completed the handshake** (no `isError`, no
  failed-spawn surface). The install command is framed as a USER action.
- **supported claim** — the absent-binary path is success-shaped on Codex: any npx-stage
  failure degrades to a live MCP server serving guidance (§3). (C3, C7)

**`LX-CX-RUNTIME-001` — runtime check: what runtime Codex hands the subprocess.**
- **subject** — the runtime Codex actually provides a plugin MCP subprocess.
- **host + pinned version** — Codex CLI 0.144.0, macOS.
- **exact repro command** — plain `codex exec -C <project> -s read-only
  --skip-git-repo-check "Reply with exactly: OK"` (no bypass flags); the stub records its
  runtime to a file at startup. Session model `gpt-5.6-sol`; cost ≈ 5,903 tokens.
- **quoted manifest/config snippet** — the stub's captured runtime report:
  ```json
  { "execPath": "<HOME>/.nvm/versions/node/v24.11.1/bin/node",
    "nodeVersion": "v24.11.1", "argv0": "node", "hasPATH": true,
    "cwd": "<cache>/…/codegraph-scratch/0.0.1",
    "PATH": "<CODEX_HOME>/tmp/arg0/codex-arg0…:/opt/homebrew/opt/openjdk/bin:…:<HOME>/.nvm/versions/node/v24.11.1/bin:… [full login-shell PATH inherited; no secrets] " }
  ```
- **observed behavior** — Codex resolved the bare `command:"node"` to the user's
  nvm-installed node (v24.11.1) via the inherited login-shell PATH; it does not bundle or
  guarantee its own runtime. `cwd` = the plugin-cache root. Codex prepends a private
  `…/tmp/arg0/codex-arg0…` shim dir to PATH. No credential or endpoint value appears
  (isolated scratch home).
- **supported claim** — the launcher must NOT assume `node` is present; Codex provides no
  runtime guarantee (§3). In-repo precedent: `scripts/mcp-dogfood.mjs` assumes `node`.
  (C3)

**Windows attempt (T012) — staged-deferred (SD-1, §7).**

**`LX-WIN-ATTEMPT-001` — Windows host reachability + the two named Windows risks.**
- **subject** — reaching a Windows host (Parallels VM over the repo's documented SSH
  bridge) to run the three launcher stages on both hosts — probing risk (a) the
  CVE-2024-27980-class `.cmd`/shim spawn refusal (#289) and risk (b) bare-name PATH
  resolution for a GUI-launched Windows host.
- **host + pinned version** — target: Windows 11 (Parallels VM `{db490dcc-…}`); driver:
  macOS darwin-arm64 with Parallels Desktop (`/usr/local/bin/prlctl`). No Windows build
  could be pinned — the VM was never reached; that is itself the recorded evidence.
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
  # 5. the SSH bridge could NOT be formed — guest IP / SSH user / key live only in the
  #    absent .parallels file:
  ssh <user>@<guest_ip> "..."      # -> UNRUNNABLE: <user>/<guest_ip>/<key> undefined (source file absent)
  ```
- **quoted manifest/config snippet** — `n/a` for a not-reached host (no manifest was
  loaded on Windows). The intended subject is the scratch plugin's `.mcp.json` command
  resolving to the shipped Windows entry point (npm `.cmd` shim / `codegraph.cmd`); it was
  never spawned.
- **observed behavior** — what IS testable was recorded: (1) the VM exists but is
  suspended with no IP address; (2) the `.parallels` connection file (repo CLAUDE.md
  "Windows (Parallels VM + SSH)") is absent, so no SSH session can be authenticated even
  if the VM were resumed; (3) `prlctl exec` is unavailable (VM not started;
  Parallels-Pro-gated). Risks (a)/(b) were recorded at the level testable here — static
  launcher inspection: the scratch launcher's Windows branch runs
  `spawnSync('where', ['codegraph'], { shell: true })` and then `handoff(bin, …)` spawns
  the resolved path **without `shell:true`**; if `where` resolves a `.cmd`/`.ps1` shim,
  that spawn-without-shell is exactly the CVE-2024-27980 / #289 refusal surface. For risk
  (b), the macOS stage-1 blocks already show bare-name failure on a GUI-inherited PATH —
  the cross-platform analogue.
- **supported claim OR "could not validate" note** — staged decision **SD-1 (§7)**: no
  Windows host reachable; the three live stages on both hosts + the two named Windows
  risks are deferred to SPEC-026's pre-ship gate with exact repro steps. (C9; CHANGELOG
  #289)

**Linux/Docker (T013) — validated hands-on, no deferral.** Host pin for all three blocks:
Docker Engine 29.5.3 (client + server); image `node:22-bookworm` (digest
`sha256:a25c9934…4127c365`), Node v22.23.1, npm 10.9.8; macOS darwin-arm64 driver host.
The container is clean — no `.envrc.local`, no `CODEX_HOME`, no dogfood index — nothing to
scrub.

**`LX-LNX-STAGE1-001` — stage 1: bare-name PATH resolution on a clean Linux host.**
- **subject** — whether a bare `codegraph` resolves on a pristine Linux host.
- **host + pinned version** — `node:22-bookworm` (Node v22.23.1) under Docker 29.5.3.
- **exact repro command** — `command -v codegraph` inside the container.
- **quoted manifest/config snippet** — the launcher stage-1 resolver, POSIX branch:
  `spawnSync('command', ['-v', 'codegraph'])`.
- **observed behavior** — `command -v codegraph` → NOT-FOUND; container default PATH
  `/usr/local/sbin:/usr/local/bin:/usr/sbin …`.
- **supported claim** — on Linux, as on the macOS GUI-inherited PATH, a plugin launcher
  must not assume a bare-name `codegraph`; "binary absent" is the realistic default and
  stage 1 falls through cleanly.

**`LX-LNX-STAGE3-001` — stage 2→3 boundary: `npx --offline` cold cache → success-shaped stub.**
- **subject** — the `npx --offline` cold-cache failure signal and the stub fall-through,
  on Linux.
- **host + pinned version** — `node:22-bookworm` (Node v22.23.1, npm 10.9.8) under Docker
  29.5.3.
- **exact repro command** —
  ```
  npx --offline --yes @colbymchenry/codegraph@^1 --version    # (b) cold-cache probe
  cat hs.jsonl | CODEGRAPH_FORCE_STAGE=3 node launcher.mjs     # (c) forced stage-3 handshake
  cat hs.jsonl | node launcher.mjs                             # (d) AUTO fall-through (npx probe -> stage 3)
  # hs.jsonl = newline-delimited initialize / tools/list / tools/call JSON-RPC
  ```
- **quoted manifest/config snippet** — the stub's success-shaped `tools/call` result (no
  `isError` field):
  ```json
  { "jsonrpc":"2.0","id":3,"result":{ "content":[{ "type":"text",
    "text":"CodeGraph is not installed on this machine yet. … a USER should run:  npx
      @colbymchenry/codegraph@^1 install  (or: codegraph install). No action is taken automatically." }] } }
  ```
- **observed behavior** — (b) cold-cache `npx --offline` → `npm error code ENOTCACHED` /
  exit 1 — a clean catchable failure, no network request. (c) forced stage 3: the launcher
  logged `{"ev":"stage","stage":3,…}` and completed the MCP handshake — `initialize` →
  result with `instructions`, `tools/list` → one `codegraph_setup_guidance` tool,
  `tools/call` → success-shaped text; exit 0, no `isError` anywhere. (d) AUTO mode
  reproduced the end-to-end chain:
  `{"ev":"npx_probe_failed","status":1,…,"enotcached":true}` → `{"ev":"stage","stage":3}`
  → the same success-shaped handshake, exit 0.
- **supported claim** — on Linux the absent-binary path is success-shaped, identically to
  macOS. Stage-2 warm-cache viability is npm-cache mechanics (host-independent), shown on
  macOS. (C7)

**`LX-LNX-RUNTIME-001` — runtime check on Linux.**
- **subject** — the runtime a Linux host hands the plugin MCP subprocess.
- **host + pinned version** — `node:22-bookworm` (Node v22.23.1) under Docker 29.5.3.
- **exact repro command** — the launcher's `launcher_start` self-report captured at
  startup.
- **quoted manifest/config snippet** — manifest command shape
  `"command":"node","args":["…/launcher.mjs"]`.
- **observed behavior** —
  `{"ev":"launcher_start","execPath":"/usr/local/bin/node","nodeVersion":"v22.23.1","cwd":"/","hasPATH":true,…}`
  — the bare `command:"node"` resolved to the container's own `/usr/local/bin/node`; no
  host injected a runtime.
- **supported claim** — consistent with macOS: a bare `command:"node"` resolves against
  the environment's PATH; the launcher/manifest must not assume a host-provided runtime.
  (C3)

### B.4 Coexistence blocks

**`DEDUP-CC-001` — plugin-vs-manual MCP dedup + which channel's entry survives (T016).**
- **subject** — the CHANGELOG "plugin-provided MCP server deduplication" behavior and the
  surviving registration when installer + plugin coexist.
- **host + pinned version** — Claude Code 2.1.206, macOS; scratch plugin via
  `--plugin-dir`; a manual project `.mcp.json` `codegraph` server whose command is
  textually identical to the plugin server's.
- **exact repro command** — `claude --plugin-dir <scratch> mcp list` in a project whose
  `.mcp.json` declares a same-command `codegraph` server; corroborated by the public
  CHANGELOG (P4).
- **quoted config snippet** — manual `.mcp.json`:
  `{ "mcpServers": { "codegraph": { "command":"node", "args":["<abs>/mcp/launcher.mjs"], … } } }`;
  plugin `.mcp.json`: `{ … "args":["${CLAUDE_PLUGIN_ROOT}/mcp/launcher.mjs"] … }`.
- **observed behavior** — `claude mcp list` shows
  `plugin:codegraph-scratch:codegraph - ✔ Connected`. The manual project `.mcp.json`
  server did not go live — project `.mcp.json` servers are approval-gated, so in a
  non-interactive run they stay pending; the both-live-same-command state could not be
  forced headlessly. Authoritative dedup semantics (public CHANGELOG): v2.1.71 — *"servers
  that duplicate a manually-configured server (same command/URL) are now skipped …
  Suppressions are shown in the `/plugin` menu"*; refined by v2.1.152 —
  same-command-different-env servers are no longer deduplicated (dedup key = command
  **and** env).
- **supported claim** — dedup suppresses the plugin copy; the manually-configured
  (installer) entry wins; the key is textually-identical command/URL (+ env).
  **Could not validate — interactive host UI:** the `/plugin`-menu suppression notice and
  forcing two same-command servers live (SD-4, §7). Exact human step: in an interactive
  session with an approved same-command `.mcp.json` `codegraph` server and the plugin
  enabled, open `/plugin` and read the plugin server's suppressed/skipped state.

**Near-duplicate scenario (T018).** The state the §4.2 lever decision hinges on: the two
channels' commands differ textually but resolve to the same binary. Isolation: Claude via
`--plugin-dir` + an isolated `CLAUDE_CONFIG_DIR` (the user's real `~/.claude.json`
verified byte-stable before/after); Codex via an isolated `CODEX_HOME`. Abbreviations:
`<node24>` = the absolute Node path `…/v24.11.1/bin/node` (home-dir redacted) — textually
distinct from bare `node`, identical binary; `<PLUGIN>` = the scratch Claude plugin dir;
`<CACHE>` = the Codex plugin cache dir `…/codegraph-scratch/0.0.1`; `<iso>` = an isolated
host config/home; `<proj>` = a throwaway project dir.

**`NEARDUP-001` — both channels configured; commands differ textually, resolve to one binary.**
- **subject** — the two launcher command strings (plugin vs installer/manual) per host,
  and whether each pair resolves to the identical on-disk binary.
- **host + pinned version** — Claude Code 2.1.206 **and** Codex CLI 0.144.0; macOS; Node
  v24.11.1.
- **exact repro command** — `realpath` equality on each pair:
  `realpath <PLUGIN>/mcp/launcher.mjs` vs `realpath <PLUGIN>/mcp/../mcp/launcher.mjs`
  (Claude); the same pattern on `<CACHE>/mcp/stub-launcher.mjs` (Codex); and
  `command -v node` vs the absolute `<node24>`.
- **quoted config snippet** —
  Claude plugin: `"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/mcp/launcher.mjs"]`;
  Claude manual: `"command":"<node24>","args":["<PLUGIN>/mcp/../mcp/launcher.mjs"]`.
  Codex plugin (`codex mcp list`): `codegraph-scratch  node  ./mcp/stub-launcher.mjs
  cwd=<CACHE>`; Codex direct (`config.toml`):
  `[mcp_servers.codegraph] command="<node24>" args=["<CACHE>/mcp/../mcp/stub-launcher.mjs"]`.
- **observed behavior** — every pair's two `realpath` values are byte-identical (same
  launcher file; same Node binary), while the command **text** differs on two axes: bare
  `node` vs absolute `<node24>`, and a `${CLAUDE_PLUGIN_ROOT}`/relative path vs an
  absolute path with a redundant `../mcp/` segment. Each host's dedup key is the pre-spawn
  config command string, which stays distinct — both `mcp list`s echo the literal
  `../mcp/`.
- **supported claim** — both channels are configured on both hosts with commands that are
  textually distinct yet binary-identical — the exact near-duplicate the coexistence rule
  targets.

**`NEARDUP-002` — both channels connect and run healthy, simultaneously.**
- **subject** — live connection status of the plugin server and the installer/manual
  server when both are loaded together.
- **host + pinned version** — Claude Code 2.1.206 (isolated `CLAUDE_CONFIG_DIR`; project
  `.mcp.json` pre-approved via seeded `enabledMcpjsonServers`); Codex CLI 0.144.0
  (isolated `CODEX_HOME`); macOS.
- **exact repro command** — Claude:
  `CLAUDE_CONFIG_DIR=<iso> claude --plugin-dir <PLUGIN> mcp list`, and
  `claude -p --plugin-dir <PLUGIN> --mcp-config=<manual.json> --debug-file <f> "…"`;
  Codex: `CODEX_HOME=<iso> codex mcp list`, and
  `CODEX_HOME=<iso> RUST_LOG=info codex exec -C <proj> "reply hi"`.
- **quoted config snippet** — n/a (same configs as `NEARDUP-001`).
- **observed behavior** — Claude `mcp list`:
  `plugin:codegraph-scratch:codegraph … - ✔ Connected` **and**
  `codegraph <node24> …/mcp/../mcp/launcher.mjs - ✔ Connected` (both live at once); the
  `-p --debug` transcript shows both `Successfully connected` handshakes (49 ms /
  8103 ms). Codex `mcp list`: both `codegraph` and `codegraph-scratch` enabled;
  `codex exec` logs `mcp_servers="codegraph-scratch, codegraph"`, `mcp_server_count=2`,
  and two distinct `rmcp::service: Service initialized as client` handshakes with two
  distinct stub runtime reports. (A later model-turn `401` is auth-only — the isolated
  `CODEX_HOME` carries no auth — downstream of MCP init.)
- **supported claim** — the plugin channel and the installer/manual channel connect and
  run healthy at the same time, on both hosts, from textually-distinct same-binary
  commands.

**`NEARDUP-003` — two distinct namespaced tool sets on Claude; two live registrations on Codex.**
- **subject** — the agent-facing tool namespaces (Claude) / server registrations (Codex)
  the two channels expose while coexisting.
- **host + pinned version** — Claude Code 2.1.206; Codex CLI 0.144.0; macOS.
- **exact repro command** — Claude: `claude -p --plugin-dir <PLUGIN>
  --mcp-config=<manual.json> "Output every tool name ending with
  'codegraph_setup_guidance', one per line."`; Codex: the `codex exec` MCP-init handshakes
  from `NEARDUP-002`.
- **quoted config snippet** — Claude stub `tools/list` advertises one tool
  `codegraph_setup_guidance`; Codex stub `tools/list` returns `[]` (empty by design).
- **observed behavior** — the Claude agent returned **both**
  `mcp__codegraph__codegraph_setup_guidance` (installer/manual channel) **and**
  `mcp__plugin_codegraph-scratch_codegraph__codegraph_setup_guidance` (plugin channel) —
  two distinct namespaces. On Codex the two servers register under distinct config
  identities `codegraph` and `codegraph-scratch`, each completing `initialize`; the Codex
  stub exposes no named tools, so the distinction is server-level.
- **supported claim** — the two channels surface as two distinct namespaced tool sets on
  Claude Code and two distinct live registrations on Codex — no merge, no shared
  namespace.

**`NEARDUP-004` — nothing fires: no host auto-suppression (Claude), no duplicate warning (Codex).**
- **subject** — whether any dedup / suppression / duplicate-warning surface activates in
  the both-present, textually-distinct-command state.
- **host + pinned version** — Claude Code 2.1.206; Codex CLI 0.144.0; macOS.
- **exact repro command** — Claude: grep the `-p --debug` transcript for
  `dedupl|suppress|skipp…server`; Codex: grep the `codex exec` stderr for
  `duplicat|dedup|collision|conflict|already registered|skipping` (CA-cert/refresh-token
  "override" lines excluded as false positives).
- **quoted config snippet** — n/a (the finding is an absence).
- **observed behavior** — Claude: zero dedup/skip/suppress lines; both `mcp__…` tool sets
  live simultaneously (`NEARDUP-003`) — the predicted non-event, since dedup (v2.1.71)
  keys on textually-identical command/URL (+ env, v2.1.152) and the commands differ on
  both axes. Codex: zero duplicate/dedup/collision/conflict warnings across the full log
  (the only `WARN`/`ERROR`s are unrelated network/auth lines); distinct config-table names
  mean Codex never treats the pair as duplicates.
- **supported claim** — in the near-duplicate state nothing fires; the two channels
  coexist as independent registrations. The non-event **is** the finding, and it is why
  lever (i) is realized by installer detection (§4.2).
  **Could not validate — interactive host UI:** the `/plugin`-menu visual confirmation of
  no suppression badge in this state (SD-4, §7). Exact human step: in the T018 project
  with the plugin enabled and an approved same-named `codegraph` `.mcp.json`, open
  `/plugin` and confirm the plugin server is listed active with no suppression notice.

---
## Appendix C — compliance record

The spec-facing record: the success-criteria verdicts, the reviewability/budget
checkpoint, the secret-scrub sweep result, and the full requirement → section → evidence
traceability. Nothing here changes a decision; it proves coverage.

### C.1 Success-criteria done-bar (SC-001…SC-008)

| SC | Bar | Verdict | Basis |
|---|---|---|---|
| **SC-001** | 100% of roadmap SPEC-025 scope bullets close with an explicit decision | **PASS** | §1.1 closure table; bullet 2 closed by §6.1. |
| **SC-002** | Every load-bearing platform claim carries a public citation and a hands-on evidence block (or explicit "could not validate" note) | **PASS** | 31 blocks in Appendix B against pinned builds; citation audit clean (§8); every could-not-validate leg is named in §7. Scrub applied at drafting (B.0); final sweep in C.2. |
| **SC-003** | OQ-8 resolved in the PRD's terms; a reader identifies the contract with no further research | **PASS** | §3 — confirmed and adopted with two refinements; no trade study. |
| **SC-004** | Every matrix cell has a decided single owner (no blank/undecided) | **PASS** | §4.1 — all 8 cells decided; none explicitly-absent. |
| **SC-005** | Exactly one fully-drafted exemplar; every other candidate has a tier + bar but no body | **PASS** | Appendix A (one body); §6.2 (K2–K5: tier + bar only). |
| **SC-006** | SPEC-026 can scaffold with zero further platform research | **PASS** | §§1–7 close every scope area; C.3 traceability. SD-1/SD-2 are pre-ship validation gates, not scaffolding blockers. |
| **SC-007** | Committed change is docs/process only — 0 production LOC across ~2 files, no committed scratch plugin/fixture | **PASS** | C.2 — ~2 deliverable files (this document + the roadmap status edit); the SpecKit process artifacts are standard per-spec overhead (FR-018); scratch plugins never committed. |
| **SC-008** | Spike completes within the 2–3 day timebox, or any miss is an explicit staged decision | **PASS** | Ran within the timebox; SD-1…SD-4 (§7) are the complete set of attempt-first staged decisions — zero silent gaps. |

### C.2 Reviewability checkpoint + secret-scrub sweep

**Budget (FR-018, SC-007).** 0 production LOC; 0 files under `src/`; **~2 deliverable
files** (this document, created + the one-line SPEC-025 status edit to
`docs/ai/specs/intelligence-platform-technical-roadmap.md`); 1 docs surface. The
accompanying SpecKit process artifacts (spec/plan/tasks/research/checklists, SPEC-MOC,
the `.process/` workflow ledger) are standard per-spec workflow overhead outside the
deliverable count. Far under every reviewability warn threshold; no split. The repo
verification floor (`npm run build`, `npm test`) stays trivially green — no code changed.

Commit-surface snapshot at close-out (`git status --porcelain` + `git diff --stat HEAD`) —
no `src/**`, no committed scratch plugin or fixture:

```
 M docs/ai/specs/intelligence-platform-technical-roadmap.md   (SPEC-025 status row — 1-row diff)
 M specs/025-plugin-platform-spike/research.md                (citation ledger)
 M specs/025-plugin-platform-spike/tasks.md                   (task checkboxes)
?? docs/design/plugin-channel-decision.md                     (this decision document — new)
```

**Final secret-scrub sweep (T028) — CLEAN.** The committed decision document was swept
across all four evidence artifact classes (pinned host version, exact repro command,
quoted config snippet, observed-behavior transcript) and all four B.0 exposure points
(a–d); `research.md` and the committed `spec.md`/`plan.md`/`tasks.md` were swept
alongside. **Zero hits:** no `CODEGRAPH_EMBEDDING_API_KEY` value, no raw private
embedding endpoint, no scheme+host:port form of it (the dogfood endpoint host and port
appear nowhere in committed text), no other `.envrc.local` value, no identity-leaking
absolute user path. Only identity-preserving placeholders survive
(`<REDACTED:…>`, unresolved `${VAR}`, `<user>`/`<HOME>`/`<CODEX_HOME>`, masked `*****`) —
never a deleted line. Per exposure point: (a) the dogfood binary-present stage was forced
to the stub so no endpoint/key ever surfaced; (b) no `claude mcp add` write-back reached
any committed `.mcp.json` — the real `~/.claude.json` was byte-stable and Codex env values
render masked; (c) no `codegraph status` transcript appears; (d) no plaintext-`http://`
embedding-warning transcript appears.

**Citation audit (T009) — clean.** Every committed citation resolves to an enumerated
public source (§8); no private or vault path anywhere; local registry/cache paths in
evidence are product artifacts with home/user segments redacted.

### C.3 Requirement → section → evidence map

Every FR-001…FR-022 and SC-001…SC-008 maps to a home section and — where load-bearing —
the evidence block IDs that ground it. No FR or SC is unmapped.

| Req | Closed in | Evidence block IDs / basis |
|---|---|---|
| **FR-001** Claude Code platform audit | §2.1 (blocks B.1) | `CC-MANIFEST-001`, `CC-MCP-NS-001`, `CC-HOOK-001`, `CC-MARKETPLACE-001`, `CC-AGENT-TOOLS-001` |
| **FR-002** Codex platform audit (capability-first; filenames corrected to evidence) | §2.2, §2.3 (blocks B.2) | `CX-MANIFEST-001`, `CX-SKILLS-001`, `CX-HOOK-SURFACE-001`, `CX-MCP-001`, `CX-AGENTS-DISTINCT-001`, `CX-TRUST-001`, `CX-LIFECYCLE-001`; corrections table §2.3 |
| **FR-003** Hands-on evidence in BOTH hosts, or an explicit "could not validate" note | B.0 (schema); all blocks | could-not-validate: `CC-MARKETPLACE-001`, `CX-HOOK-PROMPT-001`, `DEDUP-CC-001`, `NEARDUP-004` |
| **FR-004** Public citations only | §8 | citation audit recorded clean (C.2) |
| **FR-005** Launcher ordered fallback + `--offline` / major-pin / ~50 MB / Principle VII | §3 | `LX-CC-STAGE1/2/3-001`, `LX-CX-STAGE1/2/3-001`, `LX-LNX-STAGE1-001`, `LX-LNX-STAGE3-001` |
| **FR-006** Absent-binary success-shaped (never `isError`); stub; runtime self-sufficiency | §3 | `LX-CC-STAGE3-001`, `LX-CX-STAGE3-001`, `LX-LNX-STAGE3-001`, `LX-CC-RUNTIME-001`, `LX-CX-RUNTIME-001`, `LX-LNX-RUNTIME-001` |
| **FR-007** Three-stage per host (macOS) + Windows/Linux attempt; PATH scoping; two Windows risks | §3, §7 (SD-1) | `LX-CC-STAGE1-001`, `LX-CX-STAGE1-001` (PATH scoping); `LX-WIN-ATTEMPT-001`; `LX-LNX-STAGE1-001` |
| **FR-008** OQ-8 resolved; trade study only if falsified | §3 (verdict) | synthesis over the B.3 blocks |
| **FR-009** Channel-ownership rule; installer-gap = new SPEC-026 capability; lever reconciliation | §4.1, §4.2 | matrix + `DEDUP-CC-001` |
| **FR-010** 8-cell matrix, three-outcome discipline; pinned Codex build for the hook cell | §4.1 | `CX-HOOK-PROMPT-001` (pinned build) |
| **FR-011** Detection/dedupe both directions; Claude lever; Codex levers; self-suppression non-viable; 4-step near-dup | §4.2 (blocks B.4) | `DEDUP-CC-001`; `NEARDUP-001…004` |
| **FR-012** Uninstall interplay; invocation-driven restore; no orphans; lever-(ii) window; who-reports | §4.2, §4.3 | synthesis over `DEDUP-CC-001` + `NEARDUP-001…004` |
| **FR-013** Degraded-Codex subset; each cell observable-complete | §5 | `CX-AGENTS-DISTINCT-001`, `CX-SUBAGENT-V2-001`, `CX-HOOK-PROMPT-001` |
| **FR-014** Candidate skill+agent set, tier, three-leg criterion; agent class evaluated separately | §6.2, §6.4 | `CC-AGENT-TOOLS-001`, `CX-AGENTS-DISTINCT-001`, `CX-SUBAGENT-V2-001` (audit constraints) |
| **FR-015** A/B bar (third comparison mode, Sonnet floor, published-criteria leg) | §6.3 | definition (SPEC-026 executes as a pre-ship gate) |
| **FR-016** Reference-not-restate `server-instructions.ts` (#529) per candidate | §6.2, §6.3, App A | exemplar compliance note (App A) |
| **FR-017** Exactly one exemplar; no other body | App A | one drafted body (`codegraph-explore-flow`) |
| **FR-018** 0 production LOC, ~2 deliverable files | C.2 | reviewability checkpoint |
| **FR-019** No committed scratch plugin; scrub; four exposure points; identity-preserving placeholders | B.0, C.2 | scrub applied per block; final sweep CLEAN (C.2) |
| **FR-020** Every scope area closed with a decision; timebox miss → staged decision | §1.1, §7 | closure table + SD-1…SD-4 |
| **FR-021** Network/telemetry parity; pre-exec path no independent action | §3 (parity affirmation) | component-wise affirmation; roster-currency clause; net-new surface: none found |
| **FR-022** Skill-authoring grounding closes roadmap scope bullet 2 | §6.1 | S1–S10 (public); §2 per-host divergences |

| SC | Closed in | Basis |
|---|---|---|
| **SC-001** | §1.1 (+ §6.1) | scope-bullet closure table — all 5 decided |
| **SC-002** | §2, §8, App B | citations + hands-on evidence blocks |
| **SC-003** | §3 | OQ-8 resolved in the PRD's terms |
| **SC-004** | §4.1 | 8 cells, all decided, none blank |
| **SC-005** | App A (+ §6.2) | one drafted body; others tier + bar only |
| **SC-006** | whole doc + C.3 | traceability; SD-1/SD-2 are pre-ship gates, not scaffolding blockers |
| **SC-007** | C.2 | docs-only; 0 production LOC |
| **SC-008** | §7 | within timebox; SD-1…SD-4 staged decisions |

### C.4 PR review packet

- **What changed.** One new decision document —
  `docs/design/plugin-channel-decision.md` — plus a one-line SPEC-025 status edit to
  `docs/ai/specs/intelligence-platform-technical-roadmap.md`. 0 production LOC; nothing
  under `src/`; no committed scratch plugin or fixture (C.2).
- **Why.** SPEC-026 (plugin-channel distribution) is blocked until this decision record
  lands; with it, SPEC-026 scaffolds with zero further platform research.
- **Non-goals.** §1.2.
- **Review order.** §§1–8 are the decisions (the review surface); Appendix A is the one
  drafted artifact; Appendix B the evidence blocks; Appendix C this compliance record.
- **Scope budget.** 0 production LOC · 0 production files · ~2 deliverable files (+ the
  standard SpecKit process artifacts) · 1 docs surface — far under the warn thresholds;
  no split (C.2).
- **Traceability.** C.3 — every FR and SC mapped; none unmapped.
- **Verification evidence.** 31 hands-on evidence blocks against pinned builds (Claude
  Code 2.1.206, Codex CLI 0.144.0, Node v24.11.1, Docker 29.5.3), each with an exact
  repro command, quoted config, and observed behavior, secret-scrubbed at drafting;
  citation audit clean; the repo verification floor stays trivially green.
- **Known gaps.** SD-1…SD-4 (§7), each with the attempted step, evidenced blocker, and
  closing gate. The C-citation roster is inlined in §8, so no reference dangles if the
  research ledger is archived.
- **Rollback.** Docs-only — nothing to feature-gate. Revert the two deliverable files and
  the repo returns to its prior state; all decided behavior is inert until SPEC-026
  implements it.
