# Implementation Plan: Graph-Aware Rename

**Branch**: `010-graph-aware-rename` | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-graph-aware-rename/spec.md`

**Design authority**: `docs/ai/specs/.process/SPEC-010-design-concept.md` (Q1–Q11) and the spec's three Clarify sessions are binding. This plan implements those decisions and introduces no new architecture beyond them; any place it must extend a decision is called out as a **revision note** (none required — see Constitution Check).

## Summary

Turn CodeGraph's "who references X" knowledge into a *safe write*: rename any indexed symbol with a dry-run plan first, LSP-powered where a language server covers the language and graph-reference-derived otherwise, span-verified against live file bytes always, and atomic-through-verification on apply. Delivered as **two vertical slices** behind a new `src/refactor/` module (fork discipline, Principle III):

- **Slice 1 (read-only)** — the plan engine, name+qualifier targeting with candidate-listing/kind refusals, per-edit confidence tiers (FR-004 table), plan-time span verification, and the `codegraph rename` CLI in unconditional dry-run. A complete, zero-write-risk capability (~200 reviewable LOC).
- **Slice 2 (write)** — the apply safety ladder (confidence gate → live-byte span re-verify → per-edit symlink-jail + scope-matcher → in-memory snapshots + temp-file-atomic-rename write → resolution-complete targeted re-sync → touched-file post-check → unconditional rollback, with a failed-rollback recovery dump as the sole malfunction), plus the always-exposed `codegraph_rename` MCP tool and the agent-guidance paragraph (~200 reviewable LOC).

Technical approach: the plan is **recomputed on apply** from the live index (no persisted plan artifact, Q2); the derivation order per language is *configured+available LSP server → `textDocument/rename` workspace edit → RenameEdit[]*, else *graph `references` edges for the resolved target node → live-byte span-verified → tier-assigned*. The apply gate is **all-exact-or-refuse** with an explicit `--include-heuristic` escape (Q3). Every expected/recoverable condition is **success-shaped** on both surfaces (Principle VI); only a failed rollback restore is `isError`/exit-4 (FR-019a). Offsets are **UTF-16 code units end-to-end** (SPEC-008 pin) — no byte↔UTF-16 translation anywhere.

## Technical Context

**Language/Version**: TypeScript (strict). Node engines `>=20 <25`; effective from-source floor Node 22.5 for `node:sqlite`. No language/toolchain change.

**Primary Dependencies** (all existing — no new runtime dependency, Principle VII):
- `src/lsp/` (SPEC-008) — `LspJsonRpcClient` generic `request(method, params)` carries `textDocument/rename`; per-language `EffectiveLspConfig` + server-availability probe (`probeLspServerCommand`) decide the LSP-vs-graph fork, and an unavailable server or a runtime failure (`server-crash`/`initialize-timeout`/`request-timeout`/`malformed-protocol-response`/`shutdown-failure`, SPEC-008's `degraded` category) degrades *that* rename to the graph path rather than failing the command — SPEC-008 per-language degradation parity (FR-003a); SPEC-008 UTF-16 position-mapping helpers map rename positions and returned edit ranges.
- `src/db/` — `QueryBuilder` prepared statements over `node:sqlite`; new statements added here, never inline SQL.
- `src/resolution/` — `resolvedBy` category + `provenance` on `references` edges drive the FR-004 tier assignment.
- `src/index.ts` — `CodeGraph` class: `sync()` targeted re-sync (resolution-complete path) for the post-check; thin public entry points for plan/apply.
- `src/mcp/` — `tools.ts` tool registry + `ToolHandler.execute` error-shaping; `server-instructions.ts` single-source agent guidance.
- `src/bin/codegraph.ts` — commander CLI.

**Storage**: `node:sqlite` (WAL + FTS5) via `QueryBuilder`. Reads only from the graph (`references` edges, node declaration spans, provenance/`resolvedBy`); the apply path writes **source files**, never new schema. No migration, no new table, no new column.

**Testing**: vitest in `__tests__/`; real files + real SQLite (no DB mocking); `fs.mkdtempSync` temp projects with `afterEach` cleanup. Platform-divergent assertions gated with `it.runIf` (Windows deferred, Q10). Bug-class checks start red then green (Principle IV). A/B retrieval no-regression harness (`scripts/agent-eval/`) for Slice 2.

**Target Platform**: macOS (dev + default `npm test`) and Dockerized Linux validated in v1; **Windows deferred** (VM suspended, Q10) — write path stays on cross-platform Node `fs`; byte-exact span verification turns CRLF/encoding drift into a safe refusal rather than corruption; a Windows pass is a tracked UAT follow-up.

**Project Type**: single project — a local-first library + CLI + MCP server (not web/mobile).

**Performance Goals**: no retrieval regression on a control repo when the MCP tool joins the default-served set (A/B, ≥2 runs/arm, Sonnet floor model — FR-024/SC-007). Plan derivation is a bounded set of prepared-statement reads plus one LSP round-trip (LSP path) or one span-verify pass over the touched files (graph path) — interactive latency, no stated throughput target.

**Constraints**: no new runtime dependency; pure-JS; no network beyond locally spawned language servers (Principle VII). UTF-16 code units end-to-end (SPEC-008). Diffs to upstream-owned files (`src/mcp/tools.ts`, `src/mcp/server-instructions.ts`, `src/bin/codegraph.ts`, `src/index.ts`) stay minimal and additive; all new logic lives in `src/refactor/` (Principle III).

**Scale/Scope**: ~405 net-new reviewable LOC, ~200 per slice; ~5 production files; ~11 total files.

**Reviewability Budget**: **Primary surface** — harness/adapter (`src/refactor/` plan-and-apply engine). **Secondary surfaces** — CLI (`rename` subcommand), MCP tool, agent-guidance text. **Projected reviewable LOC** ~405 (~200/slice). **Production files** ~5. **Total files** ~11. **Budget result**: warn (405 > 400 LOC threshold) **resolved by the ratified 2-slice split** (Q11); each slice is within budget, single-primary-surface, and independently reviewable.

## Constitution Check

*GATE: evaluated before Phase 0 and re-affirmed after Phase 1 design. Result: PASS on all seven principles; Complexity Tracking is empty.*

| Principle | Assessment | Verdict |
|---|---|---|
| **I. Think Before Coding** | Every branch is resolved upstream: design concept Q1–Q11 + Clarify Session 1 (FR-004 tier table), Session 2 (apply mechanics FR-017/FR-018/FR-019a/FR-020), Session 3 (surfaces FR-026/FR-027/FR-028). Spec carries zero `[NEEDS CLARIFICATION]`. Three Open Questions (Windows validation, positional escape-hatch, tier boundary) are each **closed**: two are explicit deferrals with tracked follow-ups, the tier boundary is resolved by FR-004. | PASS |
| **II. Simplicity First** | Recompute-on-apply → no plan-file format to version/invalidate (Q2). Unconditional rollback → no `--keep-partial` second code path (Q5). No `--position` targeting flag (Q6), no `--include-docs` (Q9). All-exact gate is one boolean, not a configurable threshold (Q3, FR-004 "fixed exclusion, not runtime-configurable"). Reuse of the existing symlink-containment check and the shared scope matcher (FR-017) instead of a bespoke jail. No speculative abstraction. | PASS |
| **III. Surgical Changes** | New capability isolated in `src/refactor/` (a new module, matching the fork-discipline corollary listing `src/lsp`, `src/analysis`, …). Upstream-owned files receive only additive, minimal edits (one CLI subcommand; one MCP tool + one default-served-list entry; one guidance paragraph; thin `index.ts` entry points). No refactor of unrelated code. | PASS |
| **IV. Goal-Driven Execution** | Each FR maps to an acceptance scenario and a measurable SC. Tests precede implementation; the self-repo dogfood UAT (SC-009) and the A/B evidence (SC-007) are completion gates, not vibes. `npm run build && npm test` green is the floor. | PASS |
| **V. Deterministic, LLM-Free Extraction** | Rename edits derive only from LSP workspace edits or span-verified graph references — no LLM anywhere. `provenance='heuristic'` synthesized edges are **never** emitted as edits (their stored position is a dispatch site), only counted in the leftover-mention FYI (FR-004/FR-013). No new edges are written to the graph; node/edge counts stay stable across rename + re-sync (no index explosion), verified by the before/after count probe SC-010 rather than left as an unchecked "by design" claim. | PASS |
| **VI. Retrieval Performance Is a Regression Surface** | Adding `codegraph_rename` grows the default-served set from 1 to 2 tools — gated by an A/B no-regression run on a control repo (FR-024/SC-007), in Slice 2 only. Every recoverable refusal is success-shaped (FR-023); `isError` is reserved for the single failed-rollback malfunction (FR-019a). Guidance keeps `codegraph_explore` PRIMARY and must not dilute explore-first steering (FR-025). The `retrieval-guardian` review is applicable (diff touches `src/mcp/`). | PASS |
| **VII. Local-First, Private, Zero Native Dependencies** | No new runtime dependency; `node:sqlite` unchanged; pure-JS write path on Node `fs`. No network beyond locally spawned language servers. No new SQL/WASM/asset to wire into `copy-assets`. | PASS |

**Reviewability gate**: single primary surface (`src/refactor/`); the 405-LOC warn is resolved by the ratified split (each slice ~200 LOC, ≤ warn thresholds). No blocker thresholds (800 LOC / 8 production files / 25 total / >1 primary surface) are approached. **PASS.**

**PR review packet source** (per slice): what changed, why, non-goals, review order (Slice 1 engine → CLI; Slice 2 apply ladder → MCP → guidance), scope budget, the FR→file→evidence traceability matrix, verification evidence (`npm test`, probes, and — Slice 2 — the A/B numbers + self-repo dogfood outcome), known gaps (Windows validation), and rollback/flag notes (Slice 2 is the write increment; `--include-heuristic` is the only behavior escape).

## Project Structure

### Documentation (this feature)

```text
specs/010-graph-aware-rename/
├── spec.md              # Feature spec (final through Clarify)
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output — substrate decisions + resolved unknowns
├── data-model.md        # Phase 1 output — entities + FR-004 tier decision table
├── quickstart.md        # Phase 1 output — per-slice validation runbook
├── contracts/           # Phase 1 output — CLI, MCP tool, and shared JSON schemas
│   ├── cli-rename.md            # `codegraph rename` command contract + exit codes
│   ├── mcp-codegraph_rename.md  # MCP tool input/annotations/result contract
│   └── rename-plan.schema.json  # Shared plan JSON schema (CLI --json ≡ MCP result)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

New logic is confined to `src/refactor/`. The file layout makes the **slice boundary a clean PR boundary** — Slice 1 files never import Slice 2 files; Slice 2 imports Slice 1 (notably `span-verify.ts`, written for plan-time FR-005 and reused for apply-time FR-016).

```text
src/refactor/                     # NEW module — owns the plan/apply engine (Principle III)
│   # ── Slice 1 (read-only plan engine) ──
├── types.ts                      # RenamePlan, RenameEdit, TargetSelector, Candidate,
│                                 #   ConfidenceTier, ApplyResult, refusal shapes
├── target-resolver.ts            # name+qualifier → target node; ambiguity → Candidate[]
│                                 #   refusal; kind-coverage refusals (FR-006–FR-011)
├── confidence.ts                 # FR-004 resolvedBy/provenance → exact|heuristic table
│                                 #   (pure, deterministic; the fixed-exclusion function)
├── span-verify.ts                # live-byte span verification over a line as a UTF-16
│                                 #   string slice (FR-005 plan-time; reused FR-016 apply)
├── lsp-rename.ts                 # LSP path: textDocument/rename → WorkspaceEdit →
│                                 #   RenameEdit[] (source='lsp'); reuses SPEC-008 helpers
├── graph-rename.ts               # graph path: references edges for target → span-verified
│                                 #   edits, tier-assigned (source='graph'); FYI count
├── plan-engine.ts                # orchestrator: LSP-vs-graph fork (FR-003), assembles
│                                 #   RenamePlan, aggregate confidence
├── plan-format.ts                # human table (default) + stable JSON (FR-027)
│   # ── Slice 2 (write / apply) ──
├── jail.ts                       # per-edit symlink-resolved containment + shared scope
│                                 #   matcher; whole-plan refusal on out-of-root / ignored (FR-017)
├── snapshot.ts                   # in-memory byte snapshots; temp-file-then-atomic-rename
│                                 #   write; recovery-dir dump (FR-018/FR-019a/FR-020)
├── post-check.ts                 # touched-file-scoped dual assertion after re-sync (FR-018)
└── apply-engine.ts               # the safety ladder: gate→span→jail→snapshot→write→
                                  #   re-sync→post-check→rollback / recovery (FR-014–FR-020, FR-026)

src/db/query-builder.ts           # ADD prepared statements (additive):
                                  #   Slice 1: references-to-node, node-declaration-span,
                                  #     nodes-by-name (targeting + candidates)
                                  #   Slice 2: unresolved-refs-by-name-in-files,
                                  #     nodes-by-name-in-files (post-check)
src/index.ts                      # ADD thin entry points (additive):
                                  #   Slice 1: planRename(); Slice 2: applyRename()
src/bin/codegraph.ts              # ADD `rename` subcommand (additive):
                                  #   Slice 1: dry-run only, flags --file/--kind/-j,--json,
                                  #     exit 0/1/2; Slice 2: --apply/--include-heuristic,
                                  #     exit 3/4
src/mcp/tools.ts                  # Slice 2 ADD codegraph_rename tool + default-served
                                  #   membership + annotations (FR-021/FR-022/FR-028)
src/mcp/server-instructions.ts    # Slice 2 ADD short write-tool paragraph (FR-025)

__tests__/
├── refactor-plan.test.ts         # Slice 1: derivation, targeting/ambiguity/kind refusals,
│                                 #   FR-004 tiers, span-verify false-positive exclusion,
│                                 #   JSON schema, CLI dry-run, exit 0/1/2
├── refactor-apply.test.ts        # Slice 2: gate, stale-span abort, jail refusals, atomic
│                                 #   write, post-check, rollback, failed-rollback recovery,
│                                 #   exit 3/4
└── rename-mcp.test.ts            # Slice 2: MCP contract parity (CLI≡MCP, SC-005),
                                  #   success-shaped refusals, annotations
```

**Structure Decision**: Single-project layout. The plan/apply engine is a **new `src/refactor/` module** (fork discipline — new capabilities go in new modules, keeping upstream-owned files' diffs routine). The intra-module split is by slice: the eight Slice-1 files form a self-contained read-only plan engine that the CLI dry-run drives; the four Slice-2 files add the write ladder that the `--apply` CLI path and the MCP tool drive. `span-verify.ts` is the deliberate shared seam (Slice 1 owns it; Slice 2 reuses it), so the two live-byte verifications required by FR-004/FR-005/FR-016 are one implementation. All surface edits (CLI, MCP, `index.ts`, server-instructions) are additive; `QueryBuilder` gains prepared statements in both slices but no schema changes anywhere.

## Complexity Tracking

> No Constitution Check violations. No deviation from Principle II. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
