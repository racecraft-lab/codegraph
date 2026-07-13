---
topic: "Graph-aware rename: dry-run plan, LSP-powered where possible, graph-verified always, atomic on apply"
slug: "spec-010-graph-aware-rename"
date: "2026-07-10"
mode: "setup"
spec_id: "SPEC-010"
source_input:
  type: "topic"
  ref: "docs/ai/specs/intelligence-platform-technical-roadmap.md § SPEC-010: Graph-Aware Rename"
question_count: 11
stop_reason: "natural"
---

# Design Concept: SPEC-010 Graph-Aware Rename

> **Source:** docs/ai/specs/intelligence-platform-technical-roadmap.md § SPEC-010
> **Date:** 2026-07-10
> **Questions asked:** 11
> **Stop reason:** natural (all queued branches walked; no new critical branches surfaced)

## Goals

- Rename any symbol with a dry-run plan first, LSP-powered where possible, graph-verified always, atomic on apply (roadmap goal, unchanged).
- Graph-fallback rename works for **all indexed languages**, with safety carried by per-edit confidence gating rather than a language allowlist (Q1).
- **Split into 2 vertical slices** (Q11, accepted): Slice 1 — plan engine, targeting/ambiguity refusals, `codegraph rename` CLI in dry-run mode (complete read-only capability); Slice 2 — apply path (span guard, atomic write, rollback, post-check, targeted re-sync) + MCP `codegraph_rename` tool. Each slice ~200 reviewable LOC, independently testable, end-to-end through its layers.
- One safety ladder, in order: confidence gate (refuse apply unless all edits exact, Q3) → pre-write span verification against live bytes (Q4) → atomic apply with pre-write snapshots → post-check zero-dangling-references with auto-rollback on failure (Q5).
- Same plan/apply contract on CLI and MCP; the MCP tool is always exposed, dry-run by default, side effects only on explicit `apply: true` (Q7).
- Targeting is name-based with qualifiers (`Class.method`, `--file`, `--kind`); every ambiguity refusal lists the candidates with kind, file:line, and the qualifier that would select each — the refusal teaches the retry (Q6).

## Non-goals

- Non-rename refactors (extract/move) and cross-repo rename — roadmap out-of-scope, reaffirmed.
- Editing old-name occurrences in comments, docstrings, or string literals — Q9 (plan output may count leftover textual mentions as an FYI, but never edits them).
- Renaming `file`, `route`, `import`, `export` node kinds — Q8 (file rename is move-refactor territory).
- Graph-fallback rename of locals/parameters — Q8 (the graph deliberately has no local def-use tracking; refused with reason, LSP path handles them where a server runs).
- A persisted plan artifact / plan-file handoff — Q2 (`--apply` recomputes from the live index).
- An interactive disambiguation picker — Q6 (would split the CLI and MCP contracts).
- Windows validation in v1 — Q10 (deferred; see Open Questions).
- `--keep-partial` / configurable rollback behavior — Q5 (rollback is unconditional).

## Design Tree (Q&A log)

### Q1. The LSP path covers languages with a running server (ts/js/python in the dogfood setup today). For every other indexed language, rename would fall back to graph-reference-driven edit derivation. Which languages should the graph-fallback path support in v1?

**Branch:** Fallback language scope

**Recommended answer:** All languages, confidence-gated
> Graph fallback works for any indexed language, but every edit carries confidence and only span-verified edits apply by default. Matches the roadmap's collision-detection design and avoids a hardcoded language allowlist; risk is contained by the confidence gate rather than by language.

**Alternatives offered:**
- Validated subset only (ts/js/python + LSP langs): safer but adds a gate to maintain; refusals push agents back to manual edits.
- LSP-only in v1, no graph fallback: smallest surface but guts "graph-verified always" — most indexed languages get nothing.

**User's answer:** All languages, confidence-gated (recommended option)

---

### Q2. How should the plan→apply handoff work between `codegraph rename --dry-run` (default) and `--apply`?

**Branch:** Plan/apply invocation model

**Recommended answer:** Recompute plan on --apply
> `--apply` re-derives the plan from the live index and applies it in one invocation; the dry-run output is preview-only. No plan file to persist, version, or staleness-check — simplest contract (constitution Principle II), and the index is already the source of truth.

**Alternatives offered:**
- Persisted plan artifact consumed by --apply: guarantees what-you-saw-is-what-applies, but adds a plan format to version, store, and invalidate — extra surface for marginal gain in a local-first tool.

**User's answer:** Recompute plan on --apply (recommended option)

---

### Q3. Every planned edit carries a confidence rating. What should `--apply` execute by default when the plan contains lower-confidence edits?

**Branch:** Confidence model

**Recommended answer:** Refuse apply unless all edits are exact
> Two tiers: `exact` (LSP workspace-edit or span-verified graph reference) and `heuristic` (name-match/synthesized provenance). If any heuristic edit is in the plan, `--apply` refuses with the list and requires `--include-heuristic` to proceed. All-or-nothing keeps "atomic on apply" honest — no silent partial renames.

**Alternatives offered:**
- Apply exact edits, skip heuristic ones: ships a knowingly incomplete rename — dangling old-name references by design, which the zero-dangling post-check would have to special-case.
- Apply everything in the plan: a false-positive heuristic edit silently corrupts code — the failure mode the collision-detection scope exists to prevent.

**User's answer:** Refuse apply unless all edits are exact (recommended option)

---

### Q4. What pre-apply guard should protect against the index being out of date with the working tree at the moment `--apply` writes?

**Branch:** Apply-time staleness guard

**Recommended answer:** Span verification against live bytes
> Before writing, re-read every target file and verify each edit's span still contains the expected old-name text; any mismatch aborts the whole apply with a "stale index — run codegraph sync" refusal. Git-agnostic (works in non-git dirs), and it directly extends the span-verification the roadmap already requires for false-positive exclusion. Byte-exact matching also turns CRLF/encoding drift into a safe refusal.

**Alternatives offered:**
- Require clean git worktree for touched files: couples rename to git, blocks rename-mid-edit, and still misses index-vs-disk drift in committed files.
- Both guards: the git guard is mostly redundant once spans are verified and atomic rollback exists — extra friction for little added protection.

**User's answer:** Span verification against live bytes (recommended option)

---

### Q5. After a successful apply and targeted re-sync, the post-check finds dangling references to the old name. What should happen?

**Branch:** Post-check failure handling

**Recommended answer:** Auto-rollback and report
> Apply keeps pre-write file snapshots in memory/temp until the post-check passes; on failure it restores every touched file, re-syncs, and reports the dangling references as the refusal reason. "Atomic on apply" then means atomic through verification — the workspace is never left in a known-broken state.

**Alternatives offered:**
- Keep changes, report + nonzero exit: ships a state the tool itself just proved inconsistent; agents read nonzero as failure anyway.
- Prompt/flag-controlled (rollback default, --keep-partial): adds a flag and a second code path for a case the plan/confidence gates should make rare — speculative configurability (Principle II).

**User's answer:** Auto-rollback and report (recommended option)

---

### Q6. How should the target symbol be identified in `codegraph rename <target> <new-name>` — and what does the ambiguity refusal look like when several symbols match?

**Branch:** Targeting & ambiguity semantics

**Recommended answer:** Name + qualifiers, refusal lists candidates
> Target is a symbol name, optionally qualified (`Class.method`) plus `--file`/`--kind` narrowing flags. On multiple matches, refuse and return every candidate with kind, file:line, and the exact qualifier that would select it — the refusal itself teaches the retry, matching how explore/node already disambiguate (agents never need to Read first).

**Alternatives offered:**
- Position-based (file:line:col): zero ambiguity by construction, but forces agents to read files for coordinates — the Read-inducing pattern the retrieval principles prevent. Fine as an optional extra flag later, wrong as the primary contract.
- Interactive picker on ambiguity: the MCP surface can't prompt, so CLI and MCP contracts would diverge — the roadmap requires them to match.

**User's answer:** Name + qualifiers, refusal lists candidates (recommended option)

---

### Q7. codegraph_rename would be the first write-capable tool on the MCP surface (explore/node are read-only). How should its apply capability be exposed to agents?

**Branch:** MCP write-tool exposure

**Recommended answer:** Always exposed; apply needs explicit apply:true
> One `codegraph_rename` tool, plan/dry-run by default, apply only on an explicit parameter — byte-identical contract to the CLI as the roadmap requires. Host agents already gate MCP side effects behind user permission prompts, and the plan→confidence→span→post-check ladder is the real safety story. Note: adding a tool touches the always-exposed tool list, so the spec includes a control-repo no-regression check (Principle VI). Expected/recoverable refusals (ambiguity, heuristic-gated, stale span, not-indexed) return success-shaped guidance, never `isError`.

**Alternatives offered:**
- MCP tool gated behind codegraph.json opt-in: honors "new capabilities behind opt-in flags" most literally, but splits the CLI/MCP contract and hidden tools never build agent adoption.
- MCP is plan-only; apply stays CLI-only: safest posture, but breaks "same plan/apply contract" and undercuts the stated goal — safe automated refactors for agents.

**User's answer:** Always exposed; apply needs explicit apply:true (recommended option)

---

### Q8. Which symbol kinds are renameable in v1? Context: the graph deliberately does not track local def-use (locals/parameters have no usage edges), while an LSP server can rename them natively.

**Branch:** Symbol-kind coverage

**Recommended answer:** Path-dependent, honest refusals
> LSP path renames anything the server supports (including locals/params). Graph path covers named declaration kinds with tracked references (function, method, class, interface, type_alias, enum, constant…) and refuses locals/params with the reason "no local usage tracking — needs a language server". `file`/`route`/`import`/`export` are excluded everywhere (file rename is move-refactor territory, explicitly out of scope).

**Alternatives offered:**
- Fixed allowlist, identical on both paths: predictable, but forfeits LSP's native local-rename ability for no safety gain (the LSP workspace-edit is complete by construction).
- Any node kind in the index: over-promises — the graph provably cannot derive local usages, so graph-fallback parameter renames would silently miss usages, the corruption class this spec prevents.

**User's answer:** Path-dependent, honest refusals (recommended option)

---

### Q9. Should the rename also update occurrences of the old name inside comments, docstrings, and string literals?

**Branch:** Textual-occurrence scope

**Recommended answer:** No — code identifiers only in v1
> Rename touches only spans the graph/LSP prove are references to the symbol. Comment/string occurrences are textual guesses (the collision-detection scope explicitly excludes string-similar false positives by span verification) — renaming them is grep-and-hope, the opposite of graph-verified. The plan output can COUNT leftover textual mentions as an FYI without editing them.

**Alternatives offered:**
- Optional --include-docs flag: introduces exactly the unverifiable edit class the confidence gate blocks, and doubles the test matrix for a v1.
- Follow the LSP server's option when available: server-dependent behavior, inconsistent across the two paths — same-contract-everywhere is a stated requirement.

**User's answer:** No — code identifiers only in v1 (recommended option)

---

### Q10. The apply path writes files, which is platform-sensitive — and Windows validation is currently blocked (.parallels absent, VM suspended, per project memory). How should SPEC-010 handle Windows?

**Branch:** Platform validation

**Recommended answer:** Proceed; validate macOS+Linux, defer Windows
> Ship with macOS + Docker/Linux validation; keep the write path on cross-platform Node fs APIs; byte-exact span verification already turns CRLF/encoding drift into a safe refusal rather than corruption. Record a Windows validation pass as an explicit follow-up once the VM is restored — matches CLAUDE.md's "don't merge Windows-gated tests you haven't seen run".

**Alternatives offered:**
- Block the spec until the Windows VM is restored: maximum rigor, but holds a P1 spec hostage to infrastructure restored separately, and the refusal-on-mismatch design already fails safe on the untested platform.

**User's answer:** Proceed; validate macOS+Linux, defer Windows (recommended option)

---

### Q11. Slice sizing: the reviewability gate returned WARN (projected 405 reviewable LOC vs 400 warn threshold, no blockers) and the roadmap's estimator suggested 2 slices (advisory; roadmap records it as within greenfield allowance). Split SPEC-010 into two vertical slices, or keep it as one spec?

**Branch:** Slice sizing (SPIDR/INVEST)

**Recommended answer:** Split into 2 vertical slices
> Slice 1: plan engine + targeting/refusals + CLI dry-run — a complete read-only capability (reviewable rename plans) with zero write risk. Slice 2: apply path (span guard, atomic write, rollback, post-check, re-sync) + MCP tool. Each lands ~200 LOC, independently testable (INVEST), cuts end-to-end (SPIDR Interface/Path seam), and the risky write machinery gets its own focused review. N=2 follows the roadmap estimator's suggested_slices. (Live `estimate-spec-size` operation is absent in the installed runner — treated as an absent estimate per protocol; the decision leans on the roadmap's recorded estimate plus the setup gate's WARN result.)

**Alternatives offered:**
- Keep as one spec: 405 is only 5 LOC over the warn line and the roadmap records within-greenfield-allowance; one PR avoids split overhead. Review burden marginal — warning, not block.
- Decide at plan phase: re-run estimate-reviewable-loc against the real plan; keeps options open but the workflow file must carry both contingencies.

**User's answer:** Split into 2 vertical slices (recommended option)

---

## Open Questions

- **What:** Windows validation of the apply path (file writes, CRLF handling, path/jail behavior on drive letters).
  **Why deferred:** Windows VM is suspended and `.parallels` is absent (project memory, 2026-07-10) — validation infrastructure is unavailable; Q10 chose to proceed with macOS + Linux.
  **Suggested next step:** When the maintainer restores the VM, run the apply-path suite on Windows and un-gate any `it.runIf(win32)` tests before claiming tri-platform support; track as a follow-up item in the UAT runbook.
- **What:** Exact boundary between `exact` and `heuristic` confidence tiers per edge provenance (e.g. are `lsp-verified` graph edges exact? are `heuristic`-provenance synthesized edges ever included in plans, or only counted?).
  **Why deferred:** Plan-phase detail — needs the edge-provenance taxonomy from SPEC-008's schema in front of the planner; the interview fixed the gate semantics (Q3), not the tier assignment table.
  **Suggested next step:** Resolve in `/speckit-clarify` (session focus: confidence-tier assignment per provenance class) or in plan.md's data-model section.
- **What:** Whether a `--position file:line:col` escape-hatch flag ships in v1 alongside name-based targeting.
  **Why deferred:** Q6 fixed name+qualifiers as the primary contract; the positional variant was noted as "fine as an optional extra flag later".
  **Suggested next step:** Default to omitting it (Principle II); revisit only if slice-1 dogfooding hits a disambiguation case qualifiers can't express.

## Recommended Next Step

Setup mode — scaffolding is already in progress. This doc feeds the SPEC-010 workflow file's Specify/Clarify/Plan prompts; next is `/speckit-pro:speckit-autopilot docs/ai/specs/.process/SPEC-010-workflow.md` from the `.worktrees/010-graph-aware-rename` worktree, honoring the 2-slice split recorded in Goals.
