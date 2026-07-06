# Research: LSP Client Integration

## Decision: Keep LSP precision default-off and opt-in only

**Rationale**: The existing structural index is the stable default behavior. LSP precision depends on user-managed local tools, so enabling it implicitly would make indexing behavior vary by machine.

**Alternatives considered**:
- Auto-enable when a server is found on `PATH`: rejected because it violates default-off behavior and makes local machines change graph output unexpectedly.
- Environment-variable activation: rejected because environment overrides are machine-local tuning, not project intent.

## Decision: Use local JSON-RPC over stdio subprocesses

**Rationale**: Language servers already expose the protocol CodeGraph needs for `initialize`, `textDocument/definition`, `textDocument/references`, and `shutdown`. A small client under `src/lsp/client.ts` keeps CodeGraph local-first and avoids adding an LSP server facade.

**Alternatives considered**:
- Use a remote language-intelligence service: rejected by local-first constraints and no-network scope.
- Expose CodeGraph as an LSP server: rejected as SPEC-009 scope.
- Implement rename/refactor requests now: rejected as SPEC-010 scope.

## Decision: Add an explicit server registry and prereq checker

**Rationale**: SPEC-008 needs consistent server detection, command defaults, accepted alternatives, observed-version capture, and validation failure messages. A registry in `src/lsp/servers.ts` and prereq helper in `src/lsp/prereqs.ts` gives implementation and validation one source of truth.

**Alternatives considered**:
- Inline per-language commands in CLI code: rejected because status, validation, and watch paths would drift.
- Rely only on user config: rejected because status and prereq validation need baseline defaults.

## Decision: Record observed versions, not exact pins

**Rationale**: Language servers release independently. SPEC-008 validation should prove which command and version were observed during the run without freezing the implementation to a transient version. Exact version pins are avoided unless a server's own minimum runtime requirement makes an older version invalid.

**Evidence requirements**:
- Record command argv and resolved executable path when available.
- Record observed version from `--version` output or LSP `initialize.serverInfo`.
- Record any upstream minimum runtime requirement as text in validation evidence.
- Record platform, CodeGraph commit/version, and timestamp.
- Do not add outbound links to plan artifacts.

**Alternatives considered**:
- Pin exact versions in the spec: rejected because pins go stale and shift package-management responsibility into CodeGraph.
- Record no versions: rejected because completion would be impossible to audit.

## Decision: Runtime degrades per language, validation is strict

**Rationale**: Normal `codegraph index --lsp` should remain useful when one local server is missing or unstable. SPEC-008 completion is different: it must prove real-server coverage and should stop early when required validation prerequisites are absent.

**Alternatives considered**:
- Fail the entire runtime index on a missing server: rejected as too fragile for local developer machines.
- Let validation proceed with warnings: rejected because real-server validation is a completion gate.

## Decision: Correct graph targets only for a unique normalized LSP target

**Rationale**: LSP precision improves graph quality only when it reduces uncertainty. A replacement or suppression is allowed when the LSP response normalizes to exactly one semantic target and, for in-workspace targets, exactly one compatible CodeGraph node.

**Alternatives considered**:
- Add LSP targets alongside existing targets: rejected because duplicate active edges would degrade callers and impact.
- Annotate only without correction: rejected because known wrong static/heuristic targets would remain active.
- Pick the first LSP target from ambiguous output: rejected as speculative graph structure.

## Decision: Use additive `provenance: "lsp"`

**Rationale**: Existing static edges may have `null` provenance and heuristic edges already carry `heuristic`. SPEC-008 should mark only surviving active edges that LSP verified or corrected.

**Alternatives considered**:
- Migrate all existing static edges to explicit provenance values: rejected as broad schema churn.
- Store LSP verification only in metadata: rejected because provenance queries and status would be harder to express.

## Decision: Use `codegraph.json.lsp` plus environment overrides

**Rationale**: Project configuration is repeatable and shareable for activation, watch behavior, and timeouts, while environment variables let individual machines choose different executable paths or timeout values without changing the repo. Committed executable argv is intentionally ignored with a warning so repositories cannot select arbitrary local subprocesses for other users.

**Accepted contract**:
- `codegraph.json.lsp.enabled`
- `codegraph.json.lsp.defaultTimeoutMs`
- `codegraph.json.lsp.watch.enabled`
- `codegraph.json.lsp.servers.<language>.timeoutMs`
- `CODEGRAPH_LSP_<LANG>_COMMAND_JSON`
- `CODEGRAPH_LSP_<LANG>_TIMEOUT_MS`
- `CODEGRAPH_LSP_TIMEOUT_MS`

Command selection is environment override first, then registry defaults or accepted alternatives; committed project command values warn and do not participate in command selection.

**Alternatives considered**:
- CLI flags only: rejected because repeatable project use is required.
- Project command argv support: rejected because committed executable selection is unsafe for machine-local toolchains; environment overrides are explicit to the current run and visible in status evidence.

## Decision: Use the clarified language-server registry

| Language | Accepted command or disposition | Version evidence policy |
|---|---|---|
| JavaScript | `typescript-language-server --stdio` with TypeScript SDK evidence | Record observed server version and SDK evidence |
| TypeScript | `typescript-language-server --stdio` with TypeScript SDK evidence | Record observed server version and SDK evidence |
| Python | `pyright-langserver --stdio` or `basedpyright-langserver --stdio` | Record observed selected server version |
| Java | `jdtls -configuration <dir> -data <workspace-data>` or configured equivalent | Record observed server version and required workspace dirs |
| C | `clangd` | Record observed server version and compile-command evidence when used |
| C++ | `clangd` | Record observed server version and compile-command evidence when used |
| C# | `csharp-ls` | Record observed server version |
| Go | `gopls` | Record observed server version |
| Ruby | `ruby-lsp` or `solargraph stdio` | Record observed selected server version |
| Rust | `rust-analyzer` | Record observed server version |
| PHP | `intelephense --stdio` or `phpactor language-server` | Record observed selected server version |
| Kotlin | `kotlin-language-server` or `kotlin-lsp` | Record observed selected server version |
| Swift | `sourcekit-lsp` | Record observed server version |
| Dart | `dart language-server` | Record observed Dart SDK/server version |
| Vue | `vue-language-server --stdio` with TypeScript SDK evidence and configured SDK path when required | Record observed server version and SDK evidence |
| COBOL | No default SPEC-008 LSP target selected | Record parser/resolver evidence and SPEC-024 ownership |

**Alternatives considered**:
- Restrict SPEC-008 to the original roadmap set: rejected by clarified parity baseline.
- Assign unsupported rows to generic backlog: rejected by the no-unowned-gaps gate.

## Decision: Bound incremental watch verification to existing changed-file sets

**Rationale**: Watch verification should improve changed files without adding a second watcher, repo-wide LSP pass, or unbounded background work. The precision pass runs after normal sync/reference resolution and only for the bounded files already known to the watcher.

**Alternatives considered**:
- Run full-project LSP verification on every watch event: rejected for performance and stability.
- Add a second watcher pipeline: rejected as unnecessary complexity.

## Decision: Use fixed SPEC-008 LSP performance caps before adding user-facing tuning

**Rationale**: LSP requests run against user-managed subprocesses, so SPEC-008 needs explicit default work and concurrency limits before issuing requests. CodeGraph already uses bounded-worker precedents for parsing, query serving, and endpoint-style batches: leave a core for the main loop, cap cold starts, process work in bounded chunks, and report skips instead of silently expanding work. LSP also permits parallel request handling when correctness is preserved, but correctness still depends on initialize ordering, per-request responses, and bounded cancellation/timeout handling.

**Accepted defaults**:
- Disabled index/sync/watch paths do zero LSP runtime work.
- LSP-enabled full index runs at most two language-server sessions per project.
- Each language-server session runs at most eight in-flight definition/reference requests.
- Full-index verification considers at most 2,000 source files and 10,000 candidate work items per language per run.
- Full-index work is processed in batches of at most 250 LSP work items.
- Existing watch bounds remain 100 changed source files and 1,000 candidate work items per language per bounded watch batch.

**Alternatives considered**:
- Expose user-facing concurrency knobs in SPEC-008: rejected as premature; fixed defaults are enough to make the first implementation bounded and reviewable.
- Let full-index LSP verification exhaustively process every source file and candidate edge: rejected because large repositories could turn opt-in precision into an unbounded subprocess workload.
- Disable LSP entirely when a full-index cap is exceeded: rejected because partial coverage with explicit cap-exceeded reasons is more useful than discarding all verified languages.

## Decision: Treat retrieval sufficiency as part of LSP performance validation

**Rationale**: LSP correction can improve precision, but extra active edges, visible suppressed audit rows, or changed query output can push agents back to fallback file reads. SPEC-008 therefore validates performance not only by elapsed time and work caps, but also by whether existing retrieval surfaces remain sufficient after LSP-enabled correction and suppression.

**Alternatives considered**:
- Measure only elapsed indexing time: rejected because retrieval output sufficiency is a protected project performance surface.
- Validate only correction metadata: rejected because audit data that leaks into traversal/query surfaces would still degrade agent behavior.

## Decision: Preserve one spec with three vertical slices

**Rationale**: The clarified scope requires broad parity ownership, but a single large implementation would be hard to review. Three vertical slices keep each PR independently testable while preserving one SPEC-008 feature contract.

**Slices**:
1. Activation/config/status/client/prereq plus complete TypeScript-family path.
2. Correction/status generalization plus Python, Go, Rust, C/C++, Swift, and Java.
3. C#, Kotlin, PHP, Ruby, Dart, Vue, COBOL disposition, watch verification, parity matrices, dogfood, and validation packet.

**Alternatives considered**:
- One large PR: rejected for reviewability risk.
- Child specs for every language: rejected because the parity gate must be planned now and most language rows can share the same LSP client path.
