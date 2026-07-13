---
topic: "LLM Access Layer — shared endpoint + agent-bundle generation with heuristic degradation"
slug: "SPEC-018-design-concept"
date: "2026-07-13"
mode: "setup"
spec_id: "SPEC-018"
source_input:
  type: "topic"
  ref: "intelligence-platform-technical-roadmap.md § SPEC-018: LLM Access Layer"
question_count: 12
stop_reason: "natural"
---

# Design Concept: SPEC-018 LLM Access Layer

> **Source:** docs/ai/specs/intelligence-platform-technical-roadmap.md § SPEC-018
> **Date:** 2026-07-13
> **Questions asked:** 12
> **Stop reason:** natural (all queued design-tree branches walked; no critical opens remain)

## Goals

- One shared LLM capability in `src/llm/` with two first-class paths — a BYO OpenAI-compatible endpoint client and an agent-driven task-bundle mode — degrading to consumer-supplied heuristics when unconfigured; consumers call `generate(prose-task)` and always receive usable text, never an error for absence of config.
- **Split into 2 vertical slices** (accepted in Q12, per the roadmap estimator's advisory and the setup gate warn at 405 LOC):
  - **Slice 1 — endpoint path end-to-end:** config resolution (`LLMConfigResult` discriminated union mirroring embeddings), `client.ts` (streaming + non-streaming, retry/timeout), prompt-template helpers + token-budget guard, `generate()` facade with consumer-fallback degradation. Independently unblocks SPEC-011/019/020 minimally.
  - **Slice 2 — agent-bundle path:** `agent-bundle.ts` emitter, filesystem manifest, `tasks` list/ingest CLI surface, thin companion skill, plus the AC-18.4 research-note spike (needs both paths).
- `generate()` never blocks on an agent: in bundle mode it emits the bundle AND immediately returns the caller's heuristic fallback plus a pending-bundle handle; ingestion later finalizes the canonical result for retrieval (Q1, Q11).
- Mode selection mirrors the proven SPEC-001/002 embeddings posture: `CODEGRAPH_LLM_PROVIDER=endpoint|agent` explicit selector; endpoint auto-activates when `CODEGRAPH_LLM_URL`+`CODEGRAPH_LLM_MODEL` are both set; agent-bundle mode only by explicit selection; half-config → misconfig descriptor, feature dormant (Q3).
- Streaming + non-streaming both ship in this spec, per the roadmap wording (Q7 — maintainer kept it against the LOC-trim recommendation).
- Security/dormancy posture inherited from the constitution and SPEC-001/002 precedent: API key memory-only (never persisted/logged/echoed), endpoint redaction + plaintext-remote warning, retry/timeout as internal constants with test-only overrides, unconfigured behavior byte-identical with zero network calls and zero schema writes.
- Self-repo UAT: the AC-18.4 research note doubles as the dogfood UAT step — one wiki-chapter task + one PR-narrative task through both paths against this repository (endpoint via `.envrc.local` → hal; agent via a bundle completed by Claude Code using the companion skill), committed to `docs/design/llm-paths-note.md` (Q8, Q9).

## Non-goals

- Vendor-specific SDKs, fine-tuning, long-term memory — roadmap Out of Scope, carried forward unchanged.
- No layer-owned heuristic registry: domain heuristics (labels, skeletons, narratives) belong to each consumer spec; the layer only guarantees "you always get text" (Q2).
- No implicit bundle emission: agent-bundle mode is never an auto-fallback when the endpoint is unconfigured — dormancy discipline forbids unrequested writes (Q3).
- No watcher/daemon auto-ingestion of bundles in v1 (Q4).
- No SQLite schema changes: bundle lifecycle state is filesystem-only (`manifest.json` per bundle) (Q5).
- No auto-chunking/map-reduce over oversized prompts (Q6).
- No permanent user-facing `codegraph llm generate` CLI subcommand (Q8).
- No contract-driven install actions from agent output: ingest validates + finalizes only; consumer-artifact regeneration ships with each consumer spec (Q11).
- No cloud-endpoint arm in the research note (Q9).
- No coupling to SPEC-026 plugin distribution: the companion skill is a thin in-repo entry; plugin packaging stays SPEC-026's job (Q10).

## Design Tree (Q&A log)

### Q1. When a consumer (wiki chapter, PR narrative, cluster label) calls generate() and the layer is in agent-bundle mode, how does the consumer get the final LLM prose, given the coding agent may complete the bundle minutes or days later?

**Branch:** Integration contract / async model

**Recommended answer:** Heuristic-now, upgrade-later
> generate() never blocks: in bundle mode it emits the task bundle AND immediately returns the heuristic fallback plus a pending-bundle handle; later ingestion lets the consumer regenerate/patch its artifact. Keeps the daemon non-blocking, matches the roadmap's "never an error path", and consumers stay simple (one call, always usable text).

**Alternatives offered:**
- Block with timeout: one call = final answer, but couples call latency to human/agent behavior — risky inside a long-running daemon or watch loop.
- Event/callback subscription: most flexible, but adds pub/sub machinery a single-consumer-per-spec design doesn't need yet (Principle II risk).

**User's answer:** Heuristic-now, upgrade-later (Recommended)

---

### Q2. Where does the heuristic fallback content come from when the layer is unconfigured (or a bundle is still pending)?

**Branch:** Degradation / heuristics ownership

**Recommended answer:** Consumer-supplied fallback
> Each generate(task) call carries the caller's own fallback producer (SPEC-011's dominant-directory/name-token labels, SPEC-019's deterministic skeleton). The layer stays domain-agnostic — Principle II, and the roadmap already assigns heuristics per consumer spec.

**Alternatives offered:**
- Layer-owned heuristic registry: centralizes degradation but couples the shared layer to every future consumer's domain, growing it speculatively.
- Sentinel return, consumer branches: minimal layer but spreads the degradation contract across call sites, against the "never an error path" framing.

**User's answer:** Consumer-supplied fallback (Recommended)

---

### Q3. How does the layer decide between endpoint mode, agent-bundle mode, and dormant, and what selects agent-bundle mode?

**Branch:** Config & mode selection

**Recommended answer:** Mirror embeddings selection
> `CODEGRAPH_LLM_PROVIDER=endpoint|agent` as explicit selector; endpoint auto-activates when URL+MODEL are both set and no provider is named; agent-bundle mode ONLY by explicit selection (never an implicit fallback); half-config → misconfig descriptor visible in status while the feature stays dormant. Reuses the proven SPEC-001/002 discriminated-union shape (`Config | AgentConfig | Misconfig | null` — the null IS the dormancy signal), including endpoint redaction, plaintext-remote warning, and positive-int clamps.

**Alternatives offered:**
- Per-call mode, no env selector: minimal env surface but spreads mode plumbing into every consumer spec.
- Auto-cascade endpoint→bundle→heuristic: zero config but violates dormancy discipline — unrequested bundle files under `.codegraph/tasks/` break byte-identical unconfigured behavior.

**User's answer:** Mirror embeddings selection (Recommended)

---

### Q4. After a coding agent writes its output into .codegraph/tasks/<id>/, what triggers validation and installation of that output?

**Branch:** Bundle lifecycle / ingestion trigger

**Recommended answer:** Explicit CLI ingest command
> A `codegraph tasks` subcommand (list + ingest) validates the agent's output against the bundle's contract and installs it; the companion skill's last step tells the agent to run it. Deterministic and user-triggered — same philosophy as "indexing is the user's call" — with no daemon/watcher coupling.

**Alternatives offered:**
- Watcher auto-ingestion: zero manual steps but adds daemon failure modes and races against an agent's partial writes.
- Lazy ingest on next generate(): no new CLI surface but unpredictable timing; read paths silently mutate state.

**User's answer:** Explicit CLI ingest command (Recommended)

---

### Q5. Where does bundle lifecycle state (pending / completed / ingested) live?

**Branch:** Bundle state storage

**Recommended answer:** Filesystem-only manifest
> Each `.codegraph/tasks/<id>/` carries a `manifest.json` with status and output contract; list/ingest read the directory. No schema.sql change, no migration, dormant path byte-identical. Bundle counts are small-N — a DB table is overkill (Principle II); the roadmap's key-files list already omits schema changes.

**Alternatives offered:**
- SQLite table in the graph DB: queryable and transactional, but costs a schema migration and couples the LLM layer to the DB layer for a handful of directories.

**User's answer:** Filesystem-only manifest (Recommended)

---

### Q6. When a composed prompt (instructions + graph context) exceeds the token budget, what does the client do?

**Branch:** Token-budget guard

**Recommended answer:** Truncate context, marked
> Prompt-template helpers compose in priority order (instructions > output contract > graph context); the guard trims lowest-priority graph-context items to fit and appends an explicit "[context truncated: N of M]" marker. Deterministic, never errors, chars-per-token estimate so no tokenizer dependency enters the tree (Principle VII).

**Alternatives offered:**
- Over-budget → heuristic fallback: simplest guard but discards a viable LLM call because one input was large.
- Auto-chunk (map-reduce): best quality on huge inputs but machinery none of the first consumers need (Principle II).

**User's answer:** Truncate context, marked (Recommended)

---

### Q7. The roadmap scope lists streaming + non-streaming chat completions, but the setup gate warned at 405 projected LOC (threshold 400), and none of the enumerated first consumers consume partial output. Ship streaming in this spec?

**Branch:** Scope / streaming

**Recommended answer:** Defer streaming
> SSE parsing + partial-chunk handling is the natural LOC trim to get back under the warn threshold, and no dependent spec needs streaming yet (Principle II); the client's return shape stays compatible with adding it later.

**Alternatives offered:**
- Keep both per roadmap: avoids revisiting the client in a later spec and keeps terminal-UX options open for wiki generation, at the cost of the extra surface that tripped the warn.

**User's answer:** Keep both per roadmap — **deviation from recommendation**. Streaming stays in scope; the LOC consequence fed the Q12 split decision.

---

### Q8. SPEC-018 ships a layer with no production consumer until SPEC-011/019/020. What exercises generate() against this repo for the binding self-repo UAT step?

**Branch:** Dogfood / UAT surface

**Recommended answer:** Research note doubles as UAT
> AC-18.4 already requires running one wiki-chapter task and one PR-narrative task through BOTH paths against this repo (endpoint via `.envrc.local` → hal; agent path via a bundle completed by Claude Code using the companion skill). Drive it with a small script/hidden probe; the measured comparison committed to `docs/design/llm-paths-note.md` is the UAT evidence. No speculative user-facing surface.

**Alternatives offered:**
- Visible CLI subcommand (`codegraph llm generate`): permanent probe but speculative product surface (Principle II) and widens the diff.
- Tests only, no live UAT: fails the constitution's dogfooding requirement.

**User's answer:** Research note doubles as UAT (Recommended)

---

### Q9. For the AC-18.4 endpoint-vs-agent comparison note, what setup and rigor?

**Branch:** Research note method

**Recommended answer:** Timeboxed spike, dogfood endpoint
> Endpoint arm = the already-configured hal endpoint from `.envrc.local`; agent arm = Claude Code completing a bundle; one wiki chapter + one PR narrative each; report measured latency, cost (local $0 vs subscription-amortized), maintainer-judged quality. Sized as a SPIDR Spike (timebox, not LOC), honest about n=1 per artifact class.

**Alternatives offered:**
- Add a cloud-endpoint arm: richer 3-arm data but requires API spend and key handling, growing the spike beyond its advisory purpose.
- Qualitative note only: fastest but wouldn't satisfy AC-18.4's cost/quality/latency ask.

**User's answer:** Timeboxed spike, dogfood endpoint (Recommended)

---

### Q10. What form does the "companion skill documented in-repo" take for agents completing task bundles?

**Branch:** Companion skill shape

**Recommended answer:** Self-describing bundle + thin skill
> The bundle itself carries everything (instructions.md, graph-context JSON, output contract) so ANY agent can complete it by reading the directory; the in-repo companion skill is a thin discovery wrapper (find pending bundles under `.codegraph/tasks/`, follow instructions, run the ingest command) — e.g. a `.claude/skills/` entry this repo dogfoods. Plugin-channel distribution stays SPEC-026's job.

**Alternatives offered:**
- Doc only, no skill file: minimal surface but the roadmap explicitly names a companion skill, and discovery is exactly what a skill makes reliable.
- Full skill in the SPEC-026 plugin: couples SPEC-018 to distribution scaffolding that hasn't started.

**User's answer:** Self-describing bundle + thin skill (Recommended)

---

### Q11. When ingest validates a completed bundle, does it also act on the output (write consumer artifacts), or only finalize the bundle?

**Branch:** Ingest scope

**Recommended answer:** Validate + finalize only
> Ingest checks the agent's output against the bundle's contract, stores the canonical result inside the bundle dir, stamps it completed; a consumer holding the pending handle retrieves the text and regenerates its own artifact (that mechanics ships with each consumer spec). Keeps SPEC-018 free of consumer knowledge and avoids agent-output-driven file writes needing path-safety machinery.

**Alternatives offered:**
- Contract-driven install actions: feels more complete, but no consumer exists to define destinations, and agent-output-steered writes need path-validation/rollback now — speculative until SPEC-019.

**User's answer:** Validate + finalize only (Recommended)

---

### Q12. Size signals: setup gate warned (projected 405 reviewable LOC > 400), the roadmap's estimator suggested 2 slices (advisory), and streaming was kept in scope. Split SPEC-018 into two thin vertical slices?

**Branch:** Slice-sizing

**Recommended answer:** Split into 2 slices
> Slice 1: endpoint path end-to-end — config resolution, client (streaming + non-streaming, retry/timeout), prompt templates + token guard, generate() with consumer-fallback degradation. Slice 2: agent-bundle path — emitter, manifest, tasks list/ingest CLI, companion skill, plus the AC-18.4 research spike. Each is independently testable and reviewable (vertical seam, SPIDR "Interface"); slice 1 alone already unblocks SPEC-011/019/020 minimally. Two PRs off this one spec branch. (The plugin's `estimate-spec-size` operation is absent from this install; the split recommendation rests on the roadmap's recorded estimator advisory of 2 slices plus the setup gate's warn.)

**Alternatives offered:**
- Keep as one slice/PR: the warn is marginal (405 vs 400) and the two paths share the config/generate() spine, but the review exceeds budget with streaming kept.
- Defer to plan phase: keeps options open but pushes a known sizing decision downstream where re-slicing costs more.

**User's answer:** Split into 2 slices (Recommended) — recorded as a Goals decision.

## Open Questions

- **What:** Stale/abandoned pending bundles — is there a prune surface, or is manual deletion documented?
  **Why deferred:** Low-impact for v1 (small-N directories; `tasks list` makes them visible); not worth an interview question.
  **Suggested next step:** Let /speckit-clarify decide between a `tasks prune` subcommand and documented manual deletion.
- **What:** Exact CLI naming (`codegraph tasks list|ingest` vs `bundles`, subcommand verb set).
  **Why deferred:** Cosmetic; better decided in /speckit-specify with the full command surface in view.
  **Suggested next step:** Fix names during specify; keep the "explicit user-triggered ingest" semantics from Q4.
- **What:** Whether the AC-18.4 research-note spike lands inside slice 2's PR or as a separate docs-only follow-up commit.
  **Why deferred:** Depends on slice 2's real diff size, unknown until plan/tasks.
  **Suggested next step:** Decide in /speckit-plan's layer planning; the note needs both paths working, so it can't precede slice 2.
- **What:** The shared `estimate-spec-size` estimator was unavailable in the installed plugin (operation not present in speckit-pro 2.18.1's runner).
  **Why deferred:** Tooling gap, not a design question; the split decision used the roadmap's recorded advisory + the setup gate instead.
  **Suggested next step:** Report upstream to speckit-pro; re-run the estimator on a future version if re-slicing is ever considered.

## Recommended Next Step

Setup mode — scaffolding continues automatically: /speckit-pro:speckit-scaffold-spec populates `SPEC-018-workflow.md` from this doc, then run `/speckit-pro:speckit-autopilot docs/ai/specs/.process/SPEC-018-workflow.md`.
