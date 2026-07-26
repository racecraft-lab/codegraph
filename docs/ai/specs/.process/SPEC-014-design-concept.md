---
topic: "Control-Flow Graphs"
slug: "spec-014-control-flow-graphs"
date: "2026-07-24"
mode: "setup"
spec_id: "SPEC-014"
source_input:
  type: "topic"
  ref: "SPEC-014 roadmap entry in docs/ai/specs/intelligence-platform-technical-roadmap.md"
question_count: 28
stop_reason: "natural"
---

# Design Concept: Control-Flow Graphs

> **Source:** SPEC-014 roadmap entry in `docs/ai/specs/intelligence-platform-technical-roadmap.md`
> **Date:** 2026-07-24
> **Questions asked:** 28
> **Stop reason:** natural

## Goals

- Build deterministic, opt-in, per-function control-flow graphs from tree-sitter ASTs through a shared language-neutral lowering IR for TypeScript, JavaScript, and Python.
- Persist function status, CFG block metadata, and typed control edges in SQLite; expose one stateful machine contract through the library, CLI JSON, and MCP, with a human-readable CLI rendering.
- Keep CFGs fresh through first-enable full backfill and transactional affected-file replacement; retain prior snapshots only when they are explicitly stale, and keep disabled rows inert.
- Model explicit exceptions, short-circuit expressions, TypeScript/JavaScript optional flow, Python `match` and comprehensions, nested-function boundaries, unreachable regions, and distinct abrupt-transfer edges without inventing control flow.
- Add project-level CFG health and coverage to `codegraph status`, enforce a paired-median enabled overhead budget of at most 20%, and skip any function that exceeds 10,000 blocks.
- Deliver SPEC-014 as two vertical language slices: shared infrastructure plus TypeScript/JavaScript end-to-end through library, CLI, and MCP; then Python and `match`/comprehension parity through the same surfaces.
- Preserve the accepted roadmap scope boundary: SPEC-014 supplies CFGs for SPEC-015 and later analysis without implementing dataflow itself.

The final advisory size estimate was approximately 780 reviewable LOC, with two
suggested slices and status `warn`. The warning is advisory; the two-slice
decision above is the accepted mitigation.

## Non-goals

- Dataflow, reaching definitions, def-use chains, PDGs, and taint analysis — deferred to SPEC-015 through SPEC-017.
- Languages beyond TypeScript, JavaScript, and Python — Go remains the next language named by the roadmap.
- Inferring exception edges from calls, property access, allocation, or other operations that might fail implicitly — Q4.
- Modeling scheduler, suspension, or resumption semantics for `await`, `yield`, or `yield from` — Q17.
- Persisting lowering IR instructions or providing edit-stable semantic identity for basic blocks — Q10 and Q11.
- Name- or source-position-based CFG lookup in the first release; public reads accept function node IDs only — Q9.
- Serving retained CFG rows while analysis is disabled or exposing incomplete/truncated CFGs as usable results — Q15, Q16, and Q20.

## Design Tree (Q&A log)

### Q1. When the v1 lowerer encounters a function construct it cannot model safely, what should SPEC-014 require?

**Branch:** Error handling and soundness

**Recommended answer:** Skip function
> Constitution Principle V forbids speculative edges, while the existing optional-analysis pattern keeps indexing successful. Skipping the whole function prevents a partial CFG from appearing authoritative.

**Alternatives offered:**
- Marked partial CFG: Persist supported blocks and edges, but expose an explicit incomplete status and diagnostic to every consumer.
- Fail CFG pass: Abort the entire opt-in CFG analysis pass when any function cannot be lowered safely.

**User's answer:** Skip function (Recommended)

---

### Q2. Should `--analysis cfg` persist CFG enablement for subsequent sync, watch, and daemon runs?

**Branch:** Activation and state lifecycle

**Recommended answer:** Persist opt-in
> A project setting keeps all indexing paths consistent and prevents CFG data from becoming silently stale. Disabled projects remain dormant.

**Alternatives offered:**
- One-shot only: Enable CFG generation only for the current command.
- Config only: Require direct project-configuration edits and omit the roadmap's CLI activation flag.

**User's answer:** Persist opt-in (Recommended)

---

### Q3. How should persisted CFG data be refreshed when files change or are deleted?

**Branch:** Data integrity

**Recommended answer:** Replace affected CFGs
> Transactional affected-file replacement bounds incremental work while ensuring deleted or changed functions cannot retain apparently current CFG rows.

**Alternatives offered:**
- Full recompute: Delete and rebuild every project CFG after each successful sync.
- Init-time only: Build CFGs during initialization and allow incremental syncs to leave them stale.

**User's answer:** Replace affected CFGs (Recommended)

---

### Q4. Which operations should produce exception edges in the first CFG release?

**Branch:** Exception semantics

**Recommended answer:** Explicit throws only
> Explicit `throw` and `raise` nodes are grounded in syntax. Inferring every potentially failing operation would add noisy, speculative edges before inter-procedural exception summaries exist.

**Alternatives offered:**
- Potentially throwing ops: Add exception edges from calls, member access, allocation, and similar operations.
- Defer exception edges: Postpone all exception edges and try/finally semantics.

**User's answer:** Explicit throws only (Recommended)

---

### Q5. Should v1 CFGs represent expression-level branching such as `&&`, `||`, Python `and`/`or`, and conditional expressions?

**Branch:** Expression semantics

**Recommended answer:** Model short-circuit
> These constructs change which operands execute. Lowering them as real branches preserves the evaluation semantics later dataflow analysis will depend on.

**Alternatives offered:**
- Statements only: Treat every expression as opaque and model only statement-level control flow.
- Conditions only: Model short-circuit behavior only inside explicit if or loop predicates.

**User's answer:** Model short-circuit (Recommended)

---

### Q6. Should the first Python lowerer support `match`/`case` alongside the required TypeScript/JavaScript `switch` support?

**Branch:** Language parity

**Recommended answer:** Support match now
> Both constructs can share a language-neutral multi-way branch IR while retaining their language-specific default and fallthrough behavior.

**Alternatives offered:**
- Defer Python match: Skip entire Python functions containing `match`/`case`.
- Treat match opaque: Collapse `match`/`case` into one sequential statement.

**User's answer:** Support match now (Recommended)

---

### Q7. How should `getCfg(functionId)` distinguish disabled analysis, unknown functions, and functions skipped as unsupported?

**Branch:** Library API contract

**Recommended answer:** Stateful result
> Existing analysis reads use typed, success-shaped state rather than exceptions for expected conditions. A found/miss union keeps disabled, unsupported, unavailable, stale, and unknown-function cases distinguishable.

**Alternatives offered:**
- Nullable CFG: Return `Cfg | null` for every absence case.
- Throw by cause: Throw distinct errors for each expected absence state.

**User's answer:** Stateful result (Recommended)

---

### Q8. Which CFG read surfaces should SPEC-014 ship beyond the `--analysis cfg` activation flag?

**Branch:** Public interfaces

**Recommended answer:** Library API only
> This matched the original roadmap and minimized scope: ship `getCfg(functionId)` and dogfood it with a local Node probe.

**Alternatives offered:**
- Add CLI query: Add human-readable and JSON CLI reads.
- Add CLI and MCP: Expose CFG reads through the library, CLI, and a new MCP tool.

**User's answer:** Add CLI and MCP

---

### Q9. How should the new CLI and MCP read surfaces identify the function whose CFG is requested?

**Branch:** Target resolution

**Recommended answer:** Function ID only
> The persisted graph already has stable function node IDs. Reusing them avoids adding ambiguous name or source-position resolution to an already expanded scope.

**Alternatives offered:**
- ID or file-line: Add position-based resolution and ambiguity handling.
- ID or name: Add qualified-name lookup with ranked ambiguity results.

**User's answer:** Function ID only (Recommended)

---

### Q10. What stability guarantee should persisted basic-block IDs provide across re-indexing?

**Branch:** Identity

**Recommended answer:** Stable for same source
> Deterministic IDs derived from function identity and canonical traversal order satisfy reproducibility. A changed function is transactionally replaced, so edit-stable identity is unnecessary complexity.

**Alternatives offered:**
- Stable across edits: Transfer block identity semantically across function edits.
- Database IDs: Use generated row IDs with no deterministic rebuild guarantee.

**User's answer:** Stable for same source (Recommended)

---

### Q11. What should each persisted basic block contain in SPEC-014?

**Branch:** Data model

**Recommended answer:** CFG metadata only
> Persist block identity, role, ordered source spans, and typed edges. Keeping lowering IR internal avoids prematurely freezing an instruction-storage contract that belongs to SPEC-015.

**Alternatives offered:**
- Embedded IR JSON: Store normalized IR instructions as JSON on each block.
- Instruction rows: Add a normalized persisted row for every lowered operation.

**User's answer:** CFG metadata only (Recommended)

---

### Q12. Because `getCfg()` must distinguish unsupported functions later, where should skip diagnostics live?

**Branch:** Diagnostics and persistence

**Recommended answer:** Persist function status
> A compact per-function status with reason code and source version makes the stateful read contract durable without re-running lowering during reads.

**Alternatives offered:**
- Recompute on read: Re-run lowering whenever a missing CFG is queried.
- Generic absence: Persist no diagnostic and collapse skipped functions into not-computed.

**User's answer:** Persist function status (Recommended)

---

### Q13. If an enabled CFG refresh fails unexpectedly after a prior CFG exists, what should queries return?

**Branch:** Failure recovery

**Recommended answer:** Retain stale CFG
> The existing analysis lifecycle preserves the prior atomic snapshot on failure and labels it stale. This keeps indexing successful without presenting old data as current.

**Alternatives offered:**
- Delete old CFG: Remove the prior CFG and report unavailable.
- Fail indexing: Roll back the whole index or sync operation.

**User's answer:** Retain stale CFG (Recommended)

---

### Q14. What enabled index-time overhead budget should the CFG acceptance criteria enforce on the existing benchmark monorepo?

**Branch:** Performance

**Recommended answer:** At most 20%
> The repository already uses a paired median benchmark and a 20% ceiling for optional catalog analysis. Reusing that method makes the new gate comparable and measurable.

**Alternatives offered:**
- Measure only: Record overhead without a pass/fail threshold.
- At most 50%: Allow a broader first-release budget.

**User's answer:** At most 20% (Recommended)

---

### Q15. How should CFG analysis handle a pathologically large function that would exceed a fixed safety limit?

**Branch:** Resource bounds

**Recommended answer:** Skip whole function
> A bounded, deterministic skip preserves the no-partial-CFG contract and prevents one generated function from exhausting analysis resources.

**Alternatives offered:**
- Rely on file limits: Define no CFG-specific bound.
- Persist truncation: Keep a bounded prefix and mark the result incomplete.

**User's answer:** Skip whole function (Recommended)

---

### Q16. How should the new MCP CFG tool bound responses for large valid functions?

**Branch:** MCP contract

**Recommended answer:** Paginate graph
> Deterministic pages with totals allow complete retrieval without hidden output truncation or oversized tool responses.

**Alternatives offered:**
- Fixed truncation: Return one capped response with a truncated flag.
- Return full CFG: Emit every block and edge in one response.

**User's answer:** Paginate graph (Recommended)

---

### Q17. How should v1 CFGs treat `await`, `yield`, and `yield from` inside supported functions?

**Branch:** Async and generator scope

**Recommended answer:** Ordinary operations
> Preserve surrounding intra-procedural evaluation order while leaving scheduler, suspension, and resumption modeling outside this CFG release.

**Alternatives offered:**
- Suspension edges: Expand the IR and edge taxonomy with suspend/resume behavior.
- Skip such functions: Treat all async and generator functions as unsupported.

**User's answer:** Ordinary operations (Recommended)

---

### Q18. Should statements after unconditional exits remain represented in a function's CFG?

**Branch:** Unreachable code

**Recommended answer:** Keep disconnected blocks
> Explicitly unreachable blocks preserve source coverage without inventing an incoming path, which satisfies deterministic extraction and no-speculative-edge constraints.

**Alternatives offered:**
- Omit unreachable code: Stop lowering a sequence after an unconditional exit.
- Synthetic reachability: Connect unreachable statements with a special edge.

**User's answer:** Keep disconnected blocks (Recommended)

---

### Q19. When CFG analysis is enabled on an already indexed project with no file changes, what should the next sync do?

**Branch:** Migration and rollout

**Recommended answer:** Full CFG backfill
> First enablement must produce complete supported-function coverage even when the ordinary incremental change set is empty.

**Alternatives offered:**
- Changed files only: Build CFGs only as files later change.
- Require re-init: Require a manual full index rebuild.

**User's answer:** Full CFG backfill (Recommended)

---

### Q20. When a project disables CFG analysis after data has been computed, should existing CFG rows be retained?

**Branch:** Dormancy

**Recommended answer:** Retain inert rows
> This matches existing analysis lifecycle behavior: live configuration is consulted first, disabled reads expose nothing, and stale retained data must refresh before reuse.

**Alternatives offered:**
- Purge immediately: Delete all CFG data when disabled.
- Keep readable: Continue serving the final snapshot while disabled.

**User's answer:** Retain inert rows (Recommended)

---

### Q21. Should abrupt control transfers have distinct persisted edge kinds?

**Branch:** Edge taxonomy

**Recommended answer:** Distinct kinds
> Separate return, throw, break, and continue kinds preserve semantics for queries and later dependence analysis without relying on loosely typed metadata.

**Alternatives offered:**
- Single early-exit: Collapse return, break, and continue into one edge kind.
- Generic edges: Put all distinctions in optional metadata.

**User's answer:** Distinct kinds (Recommended)

---

### Q22. The shared estimator now projects about 720 reviewable LOC and recommends two slices; how should SPEC-014 be structured?

**Branch:** Slice sizing

**Recommended answer:** Two language slices
> A SPIDR data-variation split keeps each delivery vertical: the first proves the complete pipeline for TypeScript/JavaScript, and the second carries Python through that same pipeline.

**Alternatives offered:**
- Keep one slice: Accept one larger review surface.
- Three smaller slices: Separate shared TS/JS core, Python parity, and expanded CLI/MCP surfaces.

**User's answer:** Two language slices (Recommended)

**Notes:** The final estimator rerun after all later decisions projected approximately 780 reviewable LOC and still suggested two slices.

---

### Q23. What fixed per-function basic-block limit should trigger the resource-limit skip behavior?

**Branch:** Resource limit

**Recommended answer:** 10,000 blocks
> This is a generous deterministic ceiling intended to protect the process without rejecting ordinary fixtures. The recommendation had medium confidence and must be validated during Plan.

**Alternatives offered:**
- 1,000 blocks: Choose a tighter bound with a higher skip risk.
- Plan decides threshold: Defer the measurable value to benchmark research.

**User's answer:** 10,000 blocks (Recommended)

---

### Q24. Should `codegraph status` report aggregate CFG health and coverage?

**Branch:** Observability

**Recommended answer:** Add CFG status
> Aggregate enabled/freshness state and available/skipped counts make partial language coverage visible without flooding ordinary status output with per-function diagnostics.

**Alternatives offered:**
- Query only: Provide no project-level CFG summary.
- Verbose diagnostics: List every skipped function and reason in ordinary status output.

**User's answer:** Add CFG status (Recommended)

---

### Q25. How should the Python slice handle list/set/dict comprehensions and generator expressions?

**Branch:** Python expression semantics

**Recommended answer:** Lower comprehensions
> Their loops, filters, and evaluation order are genuine intra-procedural control flow and can reuse the shared loop and branch IR.

**Alternatives offered:**
- Skip containing function: Mark functions using comprehensions unsupported.
- Opaque expression: Hide the comprehension's internal control flow.

**User's answer:** Lower comprehensions (Recommended)

---

### Q26. Should TypeScript/JavaScript optional chaining and nullish coalescing create explicit short-circuit branches?

**Branch:** TypeScript and JavaScript expression semantics

**Recommended answer:** Model both
> `?.` and `??` conditionally suppress later evaluation, so they belong with the accepted logical and conditional-expression branching contract.

**Alternatives offered:**
- Nullish only: Model `??` but keep optional-chain segments opaque.
- Skip containing function: Treat either construct as unsupported.

**User's answer:** Model both (Recommended)

---

### Q27. Should library results, CLI JSON, and MCP responses use one shared CFG response contract?

**Branch:** Cross-surface API consistency

**Recommended answer:** Exact shared shape
> One exported type and parity tests prevent state or field-name drift. Only the human-readable CLI presentation needs a separate rendering.

**Alternatives offered:**
- Surface-specific shapes: Let each interface define its own names and states.
- Library canonical only: Leave CLI JSON and MCP parity untested.

**User's answer:** Exact shared shape (Recommended)

---

### Q28. How should nested functions, lambdas, and local class methods relate to their enclosing function's CFG?

**Branch:** Function boundaries

**Recommended answer:** Separate CFGs
> Each function-like graph must remain intra-procedural. The enclosing CFG records declaration or value creation but never incorporates the nested body.

**Alternatives offered:**
- Inline nested bodies: Add nested bodies as disconnected regions in the parent CFG.
- Skip parent function: Treat any parent containing nested function-like definitions as unsupported.

**User's answer:** Separate CFGs (Recommended)

## Open Questions

No critical design questions were deferred.

The Plan phase must validate that the selected 10,000-block safety cap is
practical against deterministic fixtures; changing that value after measurement
does not reopen the selected whole-function skip policy.

## Recommended Next Step

Continue `$speckit-scaffold-spec SPEC-014` in this worktree. Populate the
workflow's Specify, Clarify, Plan, Checklist, Tasks, Analyze, and Implement
prompts from this decision log, preserve the accepted two-slice structure, and
then stop before autopilot.
