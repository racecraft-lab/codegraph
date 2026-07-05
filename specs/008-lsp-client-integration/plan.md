# Implementation Plan: LSP Client Integration

**Branch**: `008-lsp-client-integration` | **Date**: 2026-07-05 | **Spec**: `specs/008-lsp-client-integration/spec.md`

**Input**: Feature specification from `specs/008-lsp-client-integration/spec.md`; Phase 3 prompt from `docs/ai/specs/.process/SPEC-008-workflow.md`; design concept from `docs/ai/specs/.process/SPEC-008-design-concept.md`; parity baseline from `docs/ai/specs/.process/language-feature-parity-baseline.md`.

## Summary

SPEC-008 adds an opt-in LSP precision pass to the existing CodeGraph indexing pipeline. When explicitly enabled through CLI or `codegraph.json`, CodeGraph detects configured local language-server subprocesses, starts JSON-RPC stdio sessions, verifies definitions and references, and corrects graph edges only when LSP returns a unique compatible target. Default indexing remains unchanged, missing or crashed servers degrade per language during normal runtime, and SPEC-008 completion requires real-server prerequisite evidence plus language and capability parity matrices with no unowned rows.

## Technical Context

**Language/Version**: TypeScript on Node.js. The package engine remains `>=20.0.0 <25.0.0`; source runs that touch `node:sqlite` require Node.js 22.5+ or the bundled runtime path already used by CodeGraph. Baseline local validation recorded Node 24.11.1 before planning.

**Primary Dependencies**: Existing CodeGraph CLI/library/MCP architecture, tree-sitter extraction, reference resolution, `node:sqlite`, commander CLI, vitest, Node child-process stdio, and locally installed language-server commands. No auto-install and no remote service dependency.

**Storage**: Existing SQLite graph store through the database layer. Use `edges.provenance` additively for `lsp` on verified/corrected active edges and preserve existing `null` and `heuristic` behavior. Correction audit metadata may require a focused schema or metadata extension, but no external graph-node creation is allowed for unindexed targets.

**Testing**: Vitest unit/contract tests; deterministic fake LSP fixtures for protocol and correction logic; real-server validation for completion; self-repo dogfood with LSP explicitly enabled. Project commands: `npm run build`, `npm run typecheck`, `npm test`, and full verify with `npm run build && npm run typecheck && npm test`.

**Target Platform**: Local CodeGraph CLI/library/MCP usage on supported developer platforms. LSP runs as local subprocesses only.

**Project Type**: TypeScript library + CLI + MCP server.

**Performance Goals**: Zero LSP overhead and byte-compatible graph behavior when LSP is disabled; bounded per-language work when enabled; no noisy duplicate edges; callers/impact/search behavior must not regress on non-LSP or heuristic-only repos.

**Constraints**: Default-off; explicit opt-in only; no auto-install; no CodeGraph-as-LSP-server; no rename/refactor behavior; no network calls beyond user-configured local subprocess commands; normal runtime degrades per language; SPEC-008 validation is strict about real-server prerequisites and parity ownership.

**Scale/Scope**: One feature spec delivered as three vertical PR slices. Languages covered in SPEC-008 real-server validation: JavaScript, TypeScript, Python, Java, C, C++, C#, Go, Ruby, Rust, PHP, Kotlin, Swift, Dart, and Vue. COBOL receives parser/resolver evidence and SPEC-024 ownership unless a concrete local LSP target is deliberately selected later.

**Reviewability Budget**: Primary surface is harness/adapter under `src/lsp/`. Secondary surfaces are CLI activation, project configuration, status reporting, graph provenance, and validation docs/process. Roadmap estimate is 565 net-new LOC, about 7 production files and 14 total files. Budget result: warning accepted, not blocked, because the spec is split into three vertical PR slices with parity rows owned explicitly.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | SPEC-008 plan response |
|---|---|---|
| I. Think Before Coding | PASS | Clarified activation, prereqs, correction semantics, parity ownership, and slice boundaries before implementation. |
| II. Simplicity First | PASS with warning | New behavior lives in focused `src/lsp/` modules and uses existing config/status/database paths. Reviewability warning is handled by three vertical slices. |
| III. Surgical Changes | PASS | Existing extraction, resolution, schema, CLI, config, and status surfaces are touched only where activation, provenance, or status integration requires it. |
| IV. Goal-Driven Execution | PASS | Each slice starts from tests and ends with build/typecheck/unit plus relevant fake and real-server validation. |
| V. Deterministic, LLM-Free Extraction | PASS | LSP uses deterministic local protocol responses; no LLM output becomes graph structure; ambiguous responses do not create replacement edges. |
| VI. Retrieval Performance | PASS | LSP is opt-in, correction prevents noisy duplicates, and callers/impact/search regressions are explicit validation gates. |
| VII. Local-First | PASS | Only local subprocesses are used; no auto-install, no remote calls, default behavior remains dormant. |

**Initial gate status**: PASS. No unresolved clarification markers are present.

**Post-design gate status**: PASS. Phase 0/1 artifacts preserve default-off activation, local-only subprocesses, three slices, real-server validation, and no unowned parity gaps.

## Project Structure

### Documentation (this feature)

```text
specs/008-lsp-client-integration/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── config-and-activation.md
│   ├── edge-correction.md
│   └── status-and-prereqs.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── lsp/
│   ├── servers.ts
│   ├── prereqs.ts
│   ├── client.ts
│   ├── precision-pass.ts
│   ├── status.ts
│   └── index.ts
├── bin/codegraph.ts
├── project-config.ts
├── index.ts
└── db/
    ├── schema.sql
    └── migrations.ts

__tests__/
├── lsp-config.test.ts
├── lsp-client.test.ts
├── lsp-precision-pass.test.ts
├── lsp-prereqs.test.ts
├── lsp-status.test.ts
└── lsp-watch.test.ts
```

**Structure Decision**: Add new LSP behavior under `src/lsp/` and integrate through existing public indexing, config, CLI, status, and database seams. Tests sit in `__tests__/` beside current repo-wide vitest suites and use real temp files/SQLite.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Reviewability warning: all baseline LSP rows remain in one spec | The clarified parity gate requires SPEC-008 to own every baseline language through coverage or a concrete future owner before implementation proceeds. | Deferring rows to generic backlog language would fail the parity gate; instead, implementation is split into three vertical PR slices and COBOL is explicitly owned by SPEC-024. |

## Vertical PR Slices

| Slice | Scope | Languages | Completion evidence |
|---|---|---|---|
| 1. Activation/config/status/client/prereq + complete TypeScript/JavaScript path | `codegraph.json.lsp`, env overrides, CLI enable/disable precedence, status skeleton, prereq detection, JSON-RPC lifecycle, first precision-pass path | TypeScript, JavaScript | Non-LSP byte-compatible fixture, config precedence tests, fake protocol tests, real `typescript-language-server --stdio` validation, status shows observed version and coverage |
| 2. Correction/status generalization + middle language expansion | Unique-target correction/suppression, correction metadata, aggregate status counters, shared server adapters and fixtures | Python, Go, Rust, C, C++, Swift, Java | Fake ambiguity/correction tests, real-server prereq and smoke validation for each language, callers/impact/search regression probes |
| 3. Remaining baseline servers/dispositions + watch + parity matrices + dogfood | Remaining server adapters, bounded watch verification, full language/capability parity evidence, self-repo validation packet | C#, Kotlin, PHP, Ruby, Dart, Vue, COBOL disposition | Real-server evidence for implemented LSP rows, COBOL parser/resolver evidence plus SPEC-024 owner, watch bounds tests, self-repo `index --lsp`, status coverage, final parity tables with 0 unowned rows |

## Activation, Config, and Watch Contract

Effective activation precedence is explicit CLI enable/disable first, then `codegraph.json.lsp.enabled === true`, then default off. Environment variables override command arrays and timeout values only; they never activate LSP precision.

`codegraph.json` owns a top-level `lsp` object:

```json
{
  "lsp": {
    "enabled": true,
    "defaultTimeoutMs": 5000,
    "watch": { "enabled": true },
    "servers": {
      "typescript": {
        "command": ["typescript-language-server", "--stdio"],
        "timeoutMs": 5000
      }
    }
  }
}
```

Language keys use CodeGraph language ids such as `typescript`, `javascript`, `python`, `java`, `c`, `cpp`, `csharp`, `go`, `ruby`, `rust`, `php`, `kotlin`, `swift`, `dart`, and `vue`.

Environment overrides:

| Override | Meaning | Activation power |
|---|---|---|
| `CODEGRAPH_LSP_<LANG>_COMMAND_JSON` | JSON argv array for one language server command | None |
| `CODEGRAPH_LSP_<LANG>_TIMEOUT_MS` | Timeout for one language | None |
| `CODEGRAPH_LSP_TIMEOUT_MS` | Default timeout for all LSP servers unless language-specific timeout wins | None |

Incremental watch verification runs only when LSP is effectively enabled, after the normal sync/reference-resolution path, and only for bounded changed-file sets from the existing watcher. When a bounded changed-file list is unavailable, LSP watch verification is skipped with a recorded status reason.

## Prerequisite and Version Evidence Policy

- SPEC-008 validation records observed server command, resolved executable path when available, observed version from `--version` or LSP `initialize.serverInfo`, platform, CodeGraph version/commit, and timestamp.
- Exact server versions are evidence, not pins. The artifacts do not require a fixed version unless a server's own current minimum runtime requirement makes older versions invalid.
- Upstream minimum runtime requirements are captured as text evidence during validation, without outbound links in spec artifacts.
- Missing real-server prerequisites stop SPEC-008 validation before completion, but normal `codegraph index --lsp` degrades only the affected language.
- The missing-prereq message shape remains: `SPEC-008 real-server validation prerequisites failed. Missing required local language servers: <language>: expected <command or alternatives>. Install the server or configure codegraph.json/environment overrides. Normal codegraph index --lsp still degrades per language; this failure applies only to SPEC-008 validation.`

## Language Parity Matrix

| Language | SPEC-008 owner | Server command or disposition | Evidence required | Future owner | Status |
|---|---|---|---|---|---|
| JavaScript | Slice 1 | `typescript-language-server --stdio` with TypeScript SDK evidence | Real-server prereq, definition/reference smoke, correction fixture, status coverage | SPEC-024 parity audit | Owned in SPEC-008 |
| TypeScript | Slice 1 | `typescript-language-server --stdio` with TypeScript SDK evidence | Real-server prereq, definition/reference smoke, correction fixture, status coverage | SPEC-024 parity audit | Owned in SPEC-008 |
| Python | Slice 2 | `pyright-langserver --stdio` or `basedpyright-langserver --stdio` | Real-server prereq, definition/reference smoke, degraded-server status fixture | SPEC-024 parity audit | Owned in SPEC-008 |
| Java | Slice 2 | `jdtls -configuration <dir> -data <workspace-data>` or configured equivalent | Real-server prereq, workspace initialization smoke, correction/status fixture | SPEC-024 parity audit | Owned in SPEC-008 |
| C | Slice 2 | `clangd` | Real-server prereq, compile-command-aware smoke when available, degraded status fixture | SPEC-024 parity audit | Owned in SPEC-008 |
| C++ | Slice 2 | `clangd` | Real-server prereq, compile-command-aware smoke when available, correction/status fixture | SPEC-024 parity audit | Owned in SPEC-008 |
| C# | Slice 3 | `csharp-ls` | Real-server prereq, workspace smoke, unavailable/degraded fixture | SPEC-024 parity audit | Owned in SPEC-008 |
| Go | Slice 2 | `gopls` | Real-server prereq, module workspace smoke, correction/status fixture | SPEC-024 parity audit | Owned in SPEC-008 |
| Ruby | Slice 3 | `ruby-lsp` or `solargraph stdio` | Real-server prereq, definition/reference smoke, degraded status fixture | SPEC-024 parity audit | Owned in SPEC-008 |
| Rust | Slice 2 | `rust-analyzer` | Real-server prereq, cargo workspace smoke, correction/status fixture | SPEC-024 parity audit | Owned in SPEC-008 |
| PHP | Slice 3 | `intelephense --stdio` or `phpactor language-server` | Real-server prereq, definition/reference smoke, degraded status fixture | SPEC-024 parity audit | Owned in SPEC-008 |
| Kotlin | Slice 3 | `kotlin-language-server` or `kotlin-lsp` | Real-server prereq, workspace smoke, degraded status fixture | SPEC-024 parity audit | Owned in SPEC-008 |
| Swift | Slice 2 | `sourcekit-lsp` | Real-server prereq, package/source workspace smoke, correction/status fixture | SPEC-024 parity audit | Owned in SPEC-008 |
| Dart | Slice 3 | `dart language-server` | Real-server prereq, package smoke, degraded status fixture | SPEC-024 parity audit | Owned in SPEC-008 |
| Vue | Slice 3 | `vue-language-server --stdio` with TypeScript SDK evidence and configured SDK path when required | Real-server prereq, component workspace smoke, degraded status fixture | SPEC-024 parity audit | Owned in SPEC-008 |
| COBOL | Slice 3 disposition | No SPEC-008 local LSP target selected by default | Parser/resolver evidence, status disposition, explicit non-LSP parity note | SPEC-024 owns LSP parity closure or child spec creation | Future-owned, not unowned |

## Feature and Capability Parity Matrix

| Baseline capability | Current owner | SPEC-008 evidence or impact | Future owner | Status |
|---|---|---|---|---|
| Multi-phase graph pipeline: structure, parsing, resolution, clustering, processes, search | Existing graph plus SPEC-001, SPEC-003, SPEC-011 | LSP pass runs after extraction/resolution and before query surfaces; default-off regression evidence required | SPEC-024 verifies full phase exposure | Owned |
| Field/property type resolution and return-type-aware binding | Existing resolution plus SPEC-008 | LSP definition/reference verification strengthens this row for covered languages | SPEC-024 audits matrix fixtures | Owned by SPEC-008 plus audit |
| Hybrid search: BM25 + semantic + RRF | SPEC-003 | No direct LSP scope; ensure corrected edges do not regress search fixtures | SPEC-024 verifies process-grouped hybrid parity | Future-owned |
| Process groups / execution flows | SPEC-011 | No direct LSP scope; corrected references must not break flow participation | SPEC-024 verifies flow parity | Future-owned |
| Functional clusters with cohesion scores | SPEC-011 | No direct LSP scope; corrected graph must preserve stable node/edge counts | SPEC-024 verifies cluster parity | Future-owned |
| Blast-radius impact with depth grouping and confidence | Existing impact plus SPEC-011/SPEC-012 | Regression probes prove LSP corrections do not degrade impact output | SPEC-024 verifies confidence/depth grouping | Owned plus audit |
| Git diff impact detection | SPEC-012 | No direct LSP scope; changed-file watch validation must stay compatible | SPEC-024 verifies changed-line mapping | Future-owned |
| Multi-file rename with graph + text search | SPEC-010 | Explicit non-goal; no rename/refactor behavior in SPEC-008 | SPEC-024 verifies rename parity after SPEC-010 | Future-owned |
| Raw Cypher graph queries | SPEC-013 | No direct LSP scope; schema/provenance changes must remain queryable | SPEC-024 verifies CLI/MCP Cypher parity | Future-owned |
| MCP resources for repos, repo context, clusters, processes, schema | SPEC-011, SPEC-013, SPEC-021, SPEC-024 | Status/resource compatibility checked if LSP fields surface through MCP | SPEC-024 owns resource-surface parity | Future-owned |
| MCP prompts `detect_impact` and `generate_map` | SPEC-012, SPEC-019, SPEC-024 | No direct LSP scope; corrected impact must remain usable by prompts | SPEC-024 owns prompt-surface parity | Future-owned |
| Wiki generation with custom model | SPEC-018, SPEC-019 | No direct LSP scope; no remote/model behavior added | SPEC-024 verifies wiki parity | Future-owned |
| Multi-repo global registry and optional repo parameter | SPEC-021, SPEC-022, SPEC-024 | No direct LSP scope; project-local LSP config remains per repo | SPEC-024 verifies global query parity | Future-owned |
| Repository groups: create/add/remove/list/sync/contracts/query/status | SPEC-021, SPEC-022 | No direct LSP scope; group sync must not be required for LSP | SPEC-024 verifies group parity | Future-owned |
| Remote embeddings with OpenAI-compatible endpoint and tuning env vars | SPEC-001, SPEC-002, SPEC-003 | No direct LSP scope; no embedding env or network changes | SPEC-024 verifies env/config parity | Future-owned |
| Installer setup/uninstall, agent skills, hooks | Existing installer plus SPEC-024 | No installer behavior unless user docs need status guidance; no auto-install | SPEC-024 closes agent integration gaps | Owned plus audit |
| Analyzer repair/rebuild/verbose/max-file-size/worker-timeout/WAL/FTS/CJK/resilience knobs | Existing index/sync plus SPEC-024 | LSP timeouts and watch bounds are separate and opt-in; existing analyzer flags unchanged | SPEC-024 maps remaining operational flags | Owned plus audit |

## Contracts Generated

- `specs/008-lsp-client-integration/contracts/config-and-activation.md`
- `specs/008-lsp-client-integration/contracts/status-and-prereqs.md`
- `specs/008-lsp-client-integration/contracts/edge-correction.md`

## Validation Strategy

1. Unit and contract tests prove config parsing, env override validation, CLI precedence, JSON-RPC lifecycle, unique-target normalization, correction metadata, status counters, and watch bounds.
2. Fake LSP fixtures cover deterministic success, ambiguity, missing server, crash, timeout, malformed response, external target suppression, and generated/unindexed targets.
3. Real-server validation records observed version evidence for every SPEC-008-owned language row.
4. Regression probes compare non-LSP indexing behavior and retrieval surfaces before and after LSP-enabled paths.
5. Self-repo dogfood runs `codegraph index` without LSP, `codegraph index --lsp`, `codegraph status`, and targeted correction/status probes.

