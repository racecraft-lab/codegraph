<!--
Sync Impact Report — 2026-07-03
- Version change: (uninitialized template) → 1.0.0 (initial ratification)
- Modified principles: n/a — template placeholders replaced with 7 concrete principles
- Added sections:
  - Core Principles I–VII (I–IV adopt the four Karpathy guidelines from
    https://github.com/fgabelmannjr/andrej-karpathy-skills; V–VII encode CodeGraph
    non-negotiables from CLAUDE.md house rules and the Intelligence Platform PRD §5)
  - Fork & Ecosystem Constraints
  - Quality Gates & Development Workflow
  - Governance
- Removed sections: none
- Template propagation:
  - ✅ .specify/templates/plan-template.md — no edit needed: its Constitution Check gate
    derives from this file, and its Complexity Tracking table is Principle II's escape hatch
  - ✅ .specify/templates/spec-template.md — no edit needed: [NEEDS CLARIFICATION] markers
    and independently-testable user stories already embody Principles I and IV
  - ✅ .specify/templates/tasks-template.md — updated: "Tests are OPTIONAL" qualified with
    the Principle IV bug-fix (failing-test-first) and installer contract-suite exceptions
  - n/a .specify/templates/commands/*.md — directory does not exist (skills-based install)
  - ✅ CLAUDE.md — no edit needed: it remains the operational manual; this constitution
    formalizes its house rules rather than replacing them
- Follow-up TODOs: none
-->

# CodeGraph Constitution

Governs the racecraft fork of CodeGraph (racecraft-lab/codegraph) and all Intelligence
Platform work executed through the SpecKit workflow. Principles I–IV adopt the four
Karpathy guidelines (fgabelmannjr/andrej-karpathy-skills) as binding engineering law;
Principles V–VII bind the project-specific invariants that CLAUDE.md and the Intelligence
Platform PRD already treat as non-negotiable.

## Core Principles

### I. Think Before Coding

Wrong assumptions are the cheapest defect to prevent and the most expensive to ship.

- Assumptions MUST be stated explicitly before implementation begins. If uncertain, ask —
  never guess and run.
- When multiple interpretations of a requirement exist, they MUST be presented with a
  recommendation — never silently picked. In specs this takes the form of
  `[NEEDS CLARIFICATION]` markers; gate G1 blocks while any remain unresolved.
- If a simpler approach exists than the one requested, it MUST be surfaced. Push back when
  warranted; agreement is not a deliverable.
- Confusion stops work: name what is unclear and ask. Proceeding while confused is a
  constitutional violation, not initiative.

### II. Simplicity First

The minimum code that solves the stated problem — nothing speculative.

- No features beyond what was asked. No abstractions for single-use code. No
  "flexibility" or "configurability" nobody requested. No error handling for impossible
  scenarios.
- The test is: "Would a senior engineer call this overcomplicated?" If 200 lines could be
  50, rewrite before requesting review. Good code solves today's problem simply, not
  tomorrow's problem prematurely.
- Complexity is permitted only with a completed row in the plan's Complexity Tracking
  table (violation, why needed, simpler alternative rejected because). An unjustified
  violation fails the Constitution Check gate.

### III. Surgical Changes

Touch only what you must; clean up only your own mess.

- Every changed line MUST trace directly to the task or spec requirement. No "improving"
  adjacent code, comments, or formatting; no refactoring what isn't broken; match the
  existing style even when you would choose differently.
- Unrelated dead code is mentioned in the report, never deleted. Remove only the imports,
  variables, and functions that YOUR change orphaned.
- Repo-scale corollary (fork discipline): new capabilities live in new modules
  (`src/embeddings`, `src/server`, `web/`, `src/lsp`, `src/analysis`, `src/query`,
  `src/llm`, `src/wiki`, `src/group`) behind opt-in flags; diffs to upstream-owned files
  stay minimal so upstream merges remain routine. A feature that rewrites upstream files
  fails review.

### IV. Goal-Driven Execution

Define success criteria first; loop until verified; report evidence, not vibes.

- Imperative tasks MUST be transformed into verifiable goals before work starts ("add
  validation" → "write tests for invalid inputs, then make them pass"). Multi-step work
  states a plan with a per-step verification check.
- Bug fixes MUST begin with a failing test that reproduces the bug; the fix makes it
  pass; the full suite stays green (red → green → refactor).
- Completion claims MUST carry evidence: test output, probe results, or measured numbers.
  `npm test` green is the floor. The `verify` and `verify-tasks` extensions audit
  implemented work for phantom completions after the implement phase.
- Rationale (Karpathy): "Don't tell it what to do, give it success criteria and watch it
  go." Strong criteria enable autonomous loops; weak criteria leak clarification churn.

### V. Deterministic, LLM-Free Extraction

The graph is derived, never imagined.

- Graph structure (nodes and edges) MUST derive from AST/static analysis only. LLM output
  is confined to prose layers (wiki text, labels, narratives) and never becomes graph
  structure.
- Silent beats wrong: no speculative edges. Synthesized dynamic-dispatch edges MUST carry
  `provenance: 'heuristic'` with `metadata.synthesizedBy`, and a bridged flow MUST be
  closed end-to-end before shipping — measured: partial coverage is worse than none.
- Extraction is deterministic for identical input; node/edge counts MUST stay stable
  across re-index (no explosion), verified before merging extraction changes.

### VI. Retrieval Performance Is a Regression Surface

The product is the agent stopping — treat sufficiency like uptime.

- Protected target behavior: a flow question resolves within the repo-size explore-call
  budget with Read/Grep = 0. Both explore budgets (call count and per-call output) MUST
  remain monotonic with repo size — a larger tier never gets a smaller per-file cap.
- Tool output MUST NOT instruct the agent to use Read. Expected or recoverable conditions
  return success-shaped guidance; `isError: true` is reserved for genuine stop-trying
  cases (security refusals, real malfunctions).
- Retrieval-affecting changes MUST pass the A/B validation methodology before merge:
  ≥2 runs per arm, both arms on the Sonnet floor model, no regression on a control repo.

### VII. Local-First, Private, Zero Native Dependencies

- `node:sqlite` is the only store. New runtime dependencies MUST be pure-JS/WASM. The npm
  engines range `>=20 <25` is preserved (it gates the thin-installer shim; the effective
  from-source floor is Node 22.5+ for `node:sqlite`, which the bundled runtime satisfies).
- Telemetry MUST be hard-disabled by default in this fork. No network calls except
  user-configured endpoints (embedding/LLM) and locally spawned language servers; the web
  platform makes no external requests.
- Any new SQL, WASM, or static asset MUST be wired into the `copy-assets` build step or
  it does not ship.

## Fork & Ecosystem Constraints

- **Origin only**: all pushes and PRs target `origin` (racecraft-lab/codegraph);
  `upstream` (colbymchenry/codegraph) is fetch-only. No exceptions.
- **License hygiene**: all new code MIT; dependencies MUST be MIT/Apache/BSD-compatible;
  no code or text imported from non-permissively-licensed codebases. Implementations are
  original work against public standards (LSP, openCypher, OpenAI-compatible API shapes,
  tree-sitter grammars).
- **Vendor-neutral documentation**: PRDs, specs, and code describe capabilities in
  self-contained terms — no comparisons to, endorsements of, or dependencies on
  third-party commercial or source-available products. Referencing public standards, API
  schemas, and permissively-licensed OSS frameworks is allowed.

## Quality Gates & Development Workflow

- `npm run build` and `npm test` (vitest) MUST be green before any review or merge claim.
- Installer changes (`src/installer/`, especially `targets/`) require matching coverage
  in the installer-targets contract suite AND a CHANGELOG entry — installer regressions
  break every new install silently.
- CHANGELOG entries are user-facing and written under `## [Unreleased]`; never pre-create
  a version block (release tooling promotes it).
- Tests write real files and exercise real SQLite — no DB mocking. Platform-divergent
  behavior is gated (`it.runIf`) and validated on the real platform (Docker for Linux,
  the Parallels VM for Windows) before merge.
- Releases ship only via the GitHub Actions Release workflow — never manual
  `npm publish` or `git tag`. Version bumps happen only when the maintainer asks.
- SDD flow: constitution → specify → clarify → plan → checklist → tasks → analyze →
  implement, gated G0–G7; registered `after_implement` hooks (review, verify,
  verify-tasks, cleanup, retrospective) run per `.specify/extensions.yml`.

## Governance

- This constitution supersedes other practice documents where they conflict. `CLAUDE.md`
  remains the operational manual for day-to-day mechanics; this document is the law the
  plan-phase Constitution Check enforces.
- Every plan MUST pass a Constitution Check against Principles I–VII before Phase 0
  research and again after Phase 1 design; violations require a Complexity Tracking row
  or a revised plan.
- Amendments require a PR with documented rationale and maintainer approval, a semantic
  version bump (MAJOR: principle removal/redefinition; MINOR: new principle or materially
  expanded guidance; PATCH: clarification/wording), an updated Last Amended date, and
  propagation to dependent templates.
- The constitution is committed to git. Back it up before any SpecKit upgrade or
  `specify init --force` — upgrades overwrite `.specify/memory/`.

**Version**: 1.0.0 | **Ratified**: 2026-07-03 | **Last Amended**: 2026-07-03
