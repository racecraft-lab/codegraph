# Phase 0 Research: Graph-Aware Rename

Resolves the substrate unknowns for SPEC-010 against the real codebase. Every design decision below is fixed by the design concept (Q1–Q11) and the three Clarify sessions; this document records **how** each maps onto existing code, with file:line anchors, and flags the one genuine implementation risk. No `[NEEDS CLARIFICATION]` remain.

## Decision 1 — LSP rename is greenfield on the SPEC-008 substrate

**Decision**: Add `src/refactor/lsp-rename.ts` that issues `textDocument/rename` through the existing generic client and translates the returned workspace edit into `RenameEdit[]`. Define the LSP `Position`/`Range`/`TextEdit`/`WorkspaceEdit`/`documentChanges` types locally in `src/refactor/types.ts`.

**Rationale / evidence**:
- `LspJsonRpcClient.request(method, params, options)` (`src/lsp/client.ts:172`) returns the raw JSON-RPC `result` as `unknown` — it already carries any method, so `textDocument/rename` needs no client change. `initialize`/`shutdown`/`notify` lifecycle exists (`client.ts:156/206/197`).
- **No `textDocument/rename` (or `prepareRename`/`references`) call exists anywhere**, and **no `Position`/`Range`/`TextEdit`/`WorkspaceEdit` types are defined** — the only range shape is a local `isRange` guard (`src/lsp/precision-pass.ts:756`). SPEC-010 defines these types from scratch (scoped to `src/refactor/`, so upstream files stay untouched — Principle III).
- Availability + per-language command resolution reuse `probeLspServerCommand` (`src/lsp/prereqs.ts:24`, resolves the executable on PATH via `fs.accessSync(X_OK)`) and `resolveLspConfig` → `EffectiveLspConfig`/`EffectiveLspServerConfig` (`src/lsp/config.ts:53`, `src/lsp/types.ts:60,69`). Coverage is **per-language**, not per-file (`LSP_LANGUAGES`/`isLspLanguage`, `types.ts:3,199`; registry `servers.ts:20`).
- Document lifecycle to copy: `textDocument/didOpen` before a position request, `didClose` after (`precision-pass.ts:460/471`); a fresh client is spawned per language and shut down — **no pooling** (`precision-pass.ts:299`).

**Alternatives considered**: reuse a pre-built rename helper (none exists); negotiate `positionEncoding` in `initialize` (today capabilities are sent as `{}`, `precision-pass.ts:322`, relying on the LSP UTF-16 default — see Decision 2; adding negotiation is out of scope and unnecessary).

**Risk flagged**: LSP is **default-off** and activated only by `--lsp` / `lsp.enabled:true` (`config.ts:59,171`); committed `command` overrides in `codegraph.json` are intentionally ignored (`config.ts:191`), so machine-local server commands come from env. Consequence: on a host with no configured/available server for the target's language, the plan **correctly** takes the graph path (FR-003) — the LSP path is opportunistic, never assumed.

## Decision 2 — UTF-16 code units end-to-end; no offset translation anywhere

**Decision**: Store, compare, and emit all positions (graph spans and LSP ranges) as **UTF-16 code units**. Span verification indexes a live line as a UTF-16 JS string slice — no byte↔UTF-16 conversion in plan or apply.

**Rationale / evidence**:
- There are **no byte↔UTF-16 helpers by design**: graph columns originate from web-tree-sitter `node.startPosition.column` (already UTF-16 code units, the same unit LSP uses) and are sent to the server verbatim — `character: Math.max(0, candidate.column ?? 0)` (`precision-pass.ts:266`), consumed back verbatim (`precision-pass.ts:248`).
- The SPEC-008 pin to reuse: `__tests__/lsp-precision-pass.test.ts:250` ("sends UTF-16 definition request positions for lines with non-ASCII text") — builds `export const café = target()`, asserts the request carries the UTF-16 character index and **not** the UTF-8 byte column. SPEC-010's span-verify tests extend this pin to rename ranges (a non-ASCII fixture line).

**Alternatives considered**: converting to byte offsets for file writes — rejected; it reintroduces exactly the translation the SPEC-008 test forbids and would corrupt non-ASCII lines. A JS string slice is already UTF-16-native, so temp-file writes need no conversion.

## Decision 3 — Post-check re-sync uses `sync()` (resolution-complete), never `indexFiles()` (extraction-only)

**Decision**: After writing, the apply engine calls `CodeGraph.sync()` and reads its `SyncResult.changedFilePaths` / `filesModified` to confirm the touched files were re-resolved; it then runs the touched-file-scoped post-check. `indexFiles()` MUST NOT be used for the post-check.

**Rationale / evidence** — this is the single most important substrate nuance:
- `sync(options)` (`src/index.ts:1267`) **does not accept a caller-supplied file list**. It self-discovers changes via `orchestrator.sync()` (mtime/git), then runs the **full resolution-complete path**: `ReferenceResolver.resolveAndPersist(...)` (`index.ts:1318`) + conformance/deferred passes + LSP precision pass + heals. Its `SyncResult.changedFilePaths` (`src/extraction/index.ts:114`) reports what it re-resolved.
- `indexFiles(filePaths)` (`index.ts:1247/1255`) is **extraction-only** — it calls `orchestrator.indexFiles()` with **no resolver, no LSP, no embeddings**. Using it for the post-check would leave references unresolved and make the "zero dangling references" assertion meaningless. This is exactly why FR-018 mandates "the resolution-complete sync path (not extraction-only file indexing)".
- Because the apply engine has just written the touched files, `sync()`'s mtime discovery picks them up — so writing-then-`sync()` **is** the targeted re-sync FR-018 describes; the touched-file set (which by construction covers every graph-tracked reference of the renamed symbol) scopes the post-check.
- **Serialization**: `sync()` runs under `this.indexMutex.withLock(...)` (`index.ts:1268`) plus a cross-process `fileLock` (`index.ts:1270`); the file watcher's callback calls the same `sync()` (`index.ts:1495`), so apply's re-sync serializes with watcher-triggered syncs on one mutex. A lock-contended/no-op sync returns a zero-shape `SyncResult` (`index.ts:1507`) — FR-018 requires treating "fails or reports no change" as an **apply failure → rollback**, so the apply engine checks `filesModified > 0` (or `changedFilePaths` non-empty) and rolls back otherwise. **The post-check never runs against an un-updated graph.**

**Alternatives considered**: a bespoke targeted-resolution entry point that takes an explicit path list — rejected (Principle II/III; `sync()` already scopes resolution to discovered changes, and adding a public path-list resolve API is speculative surface on an upstream-owned file). Reusing `indexFiles()` — rejected (skips resolution, defeats the post-check).

## Decision 4 — CLI subcommand + custom exit codes are additive to the commander program

**Decision**: Register `rename` with the existing chained-commander pattern; implement the FR-026 exit-code mapping locally in the action handler (the rename command opts out of the generic error→exit-1 mapping the read-only commands use).

**Rationale / evidence**:
- Template command `explore` (`src/bin/codegraph.ts:1388-1417`): `.command().description().option().action(async (args, options) => {...})`; opens via `resolveProjectPath(options.path)` (`codegraph.ts:211`) → `CodeGraph.open()` → drives the engine → prints `result.content[0].text` → `cg.destroy()` → `if (result.isError) process.exit(1)`.
- `--json` is a per-command `.option('-j, --json', ...)` with an `if (options.json) console.log(JSON.stringify(...))` branch (`status`/`query`/`files`/`callers`). `explore`/`node` currently print only text — rename adds `-j/--json` emitting the plan schema.
- **Only exit `0`/`1` exist today** (errors `process.exit(1)`; one `process.exitCode = 1` at `:637`) — no command returns ≥2. So FR-026's `2`/`3`/`4` are new and must be set explicitly in the rename action, not delegated to a shared error path.

**Alternatives considered**: a shared exit-code helper for all commands — rejected (Principle III, would touch unrelated read-only commands; rename's codes are rename-specific).

## Decision 5 — Reuse `validatePathWithinRoot` (jail) and `buildScopeIgnore`/`ScopeIgnore` (scope) — do not reimplement

**Decision**: FR-017's per-edit jail = the existing symlink-resolving containment check; the in-scope test = the same matcher the indexer and watcher share.

**Rationale / evidence**:
- **Jail**: `validatePathWithinRoot(projectRoot, filePath, options?)` (`src/utils.ts:158-194`) — lexical `isWithinDir` (`utils.ts:113`) then `fs.realpathSync` on both sides and re-check (`utils.ts:177-183`); ENOENT falls back to lexical. This is the existing chokepoint for content-serving read sinks; the apply/plan paths call it per edit at both plan and apply time (state can drift between them — FR-017).
- **Scope**: `class ScopeIgnore.ignores(rel)` (`src/extraction/index.ts:624-685`) via `buildScopeIgnore(rootDir)` (`:692`) — honors `codegraph.json` `exclude` (wins) / `include` (forces first-party source in) plus default-ignores; **not** a raw `.gitignore` reparse. Confirmed shared: the watcher imports and builds it (`src/sync/watcher.ts:36,368`). An LSP/graph edit targeting an in-root but `ignores()`-true file ⇒ whole-plan refusal (FR-017).

**Alternatives considered**: a fresh `.gitignore` parse (rejected by FR-017 — must honor `codegraph.json` overrides, which only the shared matcher does); a bespoke path check (rejected — the realpath jail already exists and is the security-reviewed sink).

## Decision 6 — MCP tool + default-served membership + own annotations, following the error-shaping discipline

**Decision**: Add `codegraph_rename` to the `tools` array, add `'rename'` to `DEFAULT_MCP_TOOLS`, give it its own annotations object, and shape refusals with the existing `textResult` (success) vs `errorResult` (`isError`) split.

**Rationale / evidence**:
- Tool shape `ToolDefinition` (`src/mcp/tools.ts:468-478`); tools array `:559-774`; `codegraph_explore` is the PRIMARY (`:709`).
- **Default-served set** `DEFAULT_MCP_TOOLS = new Set(['explore'])` (`tools.ts:832`) filtered at `getStaticTools()` (`:812-819`) and `ToolHandler.getTools()` (`:978-985`) — adding `'rename'` makes it the second listed tool (FR-022). (Note a stale comment at `:980` says "4-tool surface"; the live set is 1 — do not be misled.)
- **Annotations**: `READ_ONLY_ANNOTATIONS` (`tools.ts:543-548`) with the comment (`:532-542`) "a hypothetical mutating tool would simply not reference it" — FR-028's mirror-image annotations object is a new literal, not a reference to the shared one.
- **Error shaping**: `ToolHandler.execute` catch (`tools.ts:1449-1465`): `NotIndexedError → textResult` (`:4739`, success-shaped, no `isError`); `PathRefusalError → errorResult` (`:4745`, `isError:true`). SPEC-010's recoverable refusals follow the `textResult` branch; only failed-rollback (FR-019a) uses `errorResult`.
- **Guidance** (`src/mcp/server-instructions.ts`): `SERVER_INSTRUCTIONS` (`:20-70`, explore framed as the single PRIMARY tool at `:34`) and `SERVER_INSTRUCTIONS_NO_ROOT_INDEX` (`:84-103`). Insert a short write-tool paragraph after the `## One tool` block (`~:48`) once `rename` joins the default set — the file's own doc note (`:9-19`) forbids naming non-default tools, so the paragraph is valid only in the same slice that grows the default set (FR-025). This file is the single source of truth (#529); no duplicate instruction blocks to sync.

**Alternatives considered**: gate the tool behind `codegraph.json` (rejected by Q7/FR-022 — splits the CLI/MCP contract, hidden tools never build adoption); reuse `READ_ONLY_ANNOTATIONS` (rejected — a write tool must declare `readOnlyHint:false`, FR-028).

## Decision 7 — Confidence tiers derive from `resolvedBy` + `provenance`, gated by span verification

**Decision**: The `exact`/`heuristic` tier per edit is the deterministic FR-004 table keyed on the resolver edge's `resolvedBy` category and `provenance`, applied as a pure function in `src/refactor/confidence.ts`; the tier is **necessary but not sufficient** — every edit also passes live-byte span verification (FR-005 plan-time, FR-016 apply-time) before it survives.

**Rationale / evidence**: the taxonomy, the exact per-category assignment, the schema columns feeding it, and the file:line assignment sites are enumerated in **`data-model.md` § Confidence Tier (FR-004 decision table)** — the authoritative table lives there to keep this feature's data model in one place. Key point carried here: `provenance='heuristic'` synthesized edges (callback/EventEmitter/React-render/JSX-child/ORM-descriptor) are **never** rename-edit candidates (their `(line,col)` is a dispatch site, not a name occurrence) — they are counted only in the leftover-mention FYI (FR-013), never emitted as edits.

## Decision 8 — Edge/reference positions are start-only points; derive the edit range from the old name's UTF-16 length, then span-verify

**Decision**: A graph-path `RenameEdit` range is `(line, col) .. (line, col + oldName.length)` where `oldName.length` is counted in **UTF-16 code units**; the derived span is then confirmed by reading the live line and asserting the slice equals `oldName` (this *is* the FR-005/FR-016 span verification). If the slice does not equal `oldName`, the edit is dropped (plan-time) or the apply aborts (apply-time).

**Rationale / evidence**:
- Node declaration spans carry a full range (`nodes.start_line/end_line/start_column/end_column`, `schema.sql:27-30`, all NOT NULL), but **edge/reference callsite positions store only a start point** — `edges.line`/`col` (nullable, `schema.sql:52-53`; mapped to `Edge.line`/`Edge.column`, `queries.ts:218-219`) and `unresolved_refs.line`/`col` (NOT NULL, `schema.sql:86-87`). **No end column, no length, no byte offset exists in the schema.**
- The old name is recoverable from the reference: `unresolved_refs.reference_name`, or the edge's `metadata.refName` (written at `index.ts:1005`). So the identifier width = `oldName` UTF-16 length — and since positions are already UTF-16 (Decision 2), no conversion is needed.
- This makes span verification **load-bearing, not just a guard**: the derived end is trusted only because the live-byte slice is confirmed to equal the old name. It also naturally excludes false positives (a shadow/alias/string-similar occurrence whose slice differs) — FR-005.
- The LSP path does **not** need this derivation: a `textDocument/rename` workspace edit returns complete `TextEdit` ranges (start+end) directly.

**Alternatives considered**: adding an end-column to the schema (rejected — Principle III schema churn on an upstream-owned file for data the name length already yields); trusting the derived range without verification (rejected — cannot catch referent misidentification, the exact corruption class FR-004/FR-005 close).

## Resolved Open Questions (from the design concept)

| Concept Open Question | Resolution |
|---|---|
| Windows validation of the apply path | **Deferred** (Q10). macOS + Docker/Linux in v1; cross-platform `fs`; byte-exact span verification fails safe on CRLF/encoding drift. Windows pass tracked as a UAT follow-up. |
| Exact `exact`/`heuristic` boundary per provenance | **Resolved** by FR-004 (Clarify Session 1) — the decision table in `data-model.md`. |
| `--position file:line:col` escape hatch | **Not shipped** in v1 (Q6, Principle II) — name+qualifiers is the sole targeting contract; revisit only if Slice-1 dogfooding hits a case qualifiers can't express. |

## Deferred work (name the follow-up)

- **Windows apply-path validation** — follow-up tracked in the UAT runbook (un-gate `it.runIf(win32)` apply tests once the Parallels VM is restored). Not a v1 gate (Q10).
- **Mid-write hard-kill durability** — documented v1 limitation (FR-020); crash-durable atomicity is explicitly out of scope.
