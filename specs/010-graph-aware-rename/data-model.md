# Phase 1 Data Model: Graph-Aware Rename

The entities are in-memory value objects owned by `src/refactor/` (`types.ts`). **No schema change** — rename reads existing nodes/edges and writes source files, never new tables/columns. All positions are UTF-16 code units (SPEC-008; research Decision 2). Line is **1-indexed**, column **0-indexed** — the graph's native convention (`src/types.ts:149-159`); the surface JSON (`rename-plan.schema.json`) uses LSP-style 0-based `line`/`character` positions, so the derivation converts once at the surface boundary.

## Entities

### RenamePlan
The computed result of a dry-run (and the recomputed basis of an apply — FR-014).

| Field | Type | Notes |
|---|---|---|
| `target` | Target (resolved) | The disambiguated symbol: name, kind, declaration file + range. |
| `newName` | string | Requested replacement identifier. |
| `edits` | RenameEdit[] | Ordered; an empty-references plan still contains the declaration edit (FR-002, US1 scenario 3). |
| `confidence` | `all-exact` \| `contains-heuristic` | Aggregate over `edits`; drives the apply gate (FR-015). |
| `source` | `lsp` \| `graph` | Whole-plan derivation path when uniform; per-edit `source` is authoritative (FR-003). |
| `leftoverMentions` | integer? | Optional, non-gating FYI count of un-edited old-name occurrences (FR-013). |
| `applied` | boolean | `false` for every dry-run; `true` only on a post-check-green apply. |
| `outcome` | ApplyOutcome? | Apply-only (Slice 2); absent on dry-run. |
| `refusal` | Refusal? | Present on a recoverable refusal (success-shaped). |

### RenameEdit
A single change within one file (FR-002; surfaced fields fixed by FR-027).

| Field | Type | Source in the graph |
|---|---|---|
| `file` | string | Workspace-relative path. LSP: from the `TextEdit` document URI. Graph: the referencing node's / unresolved ref's `file_path`. |
| `range` | {start, end} | LSP: the `TextEdit.range` verbatim. Graph: `start = (line, col)` from the edge/unresolved-ref position; `end = (line, col + oldText UTF-16 length)` (research Decision 8). |
| `oldText` | string | The old name occurrence; verified to equal the live-byte slice at `range` (FR-005/FR-016). |
| `newText` | string | The new name occurrence. |
| `confidence` | `exact` \| `heuristic` | The FR-004 table below — necessary but not sufficient; span verification is an independent additional gate. |
| `source` | `lsp` \| `graph` | Derivation path for this edit. |

### Target (Selector → resolved Target)
The **Target Selector** is the input: `name` plus optional qualifiers `Class.method`, `--file`, `--kind` (FR-006). Resolving it yields either exactly one **resolved Target** (name, kind, declaration `file`+`range` from `getNodeById`/`getNodesByName`) or a Refusal. Excluded/unsupported kinds (FR-010/FR-011) resolve to a Refusal, never a Target.

### Candidate
A symbol matching an ambiguous selector (FR-007). Fields: `name`, `kind`, `file`, `line`, and `selector` — the exact qualifier string that would uniquely select it (e.g. `Worker.handle`, `--file src/a.ts`, `--kind method`). The refusal lists every Candidate so a single qualified retry succeeds with zero files read (SC-003).

### ConfidenceTier
The two-valued rating `exact` | `heuristic` on each edit. Pure function of `(resolvedBy, provenance)` per the FR-004 table, computed in `src/refactor/confidence.ts`. **Always** paired with span verification — a live-byte mismatch drops the edit regardless of tier (FR-004 final clause).

### ApplyResult (Apply Result)
The outcome of an apply (Slice 2). `outcome` ∈ ApplyOutcome; plus the touched-file set, the post-check status, and — on `rolled-back`/`rollback-failed` — the dangling references and the recovery report.

## ApplyOutcome — state transitions (Slice 2)

The apply safety ladder is a linear pipeline; each gate either advances or exits to a terminal state. Terminal states map 1:1 to CLI exit codes (FR-026) and MCP result shapes (FR-023/FR-019a).

```
recompute plan (FR-014)
   │
   ├─ any edit below `exact` and no --include-heuristic ──▶ refused:heuristic-gated      (exit 2, success-shaped)
   ├─ any edit out-of-root / scope-ignored (FR-017) ──────▶ refused:out-of-root|scope-ignored (exit 2, success-shaped)
   │
   ▼  confidence gate + jail passed
snapshot all touched files in memory (FR-018/FR-020)
   │
   ▼
span re-verify vs live bytes (FR-016)
   ├─ any span mismatch ──────────────────────────────────▶ refused:stale-span            (exit 2, success-shaped, ZERO writes)
   │
   ▼  all spans match
write each file: temp-sibling → atomic rename (FR-020)
   │
   ▼
re-sync via CodeGraph.sync() — resolution-complete (FR-018, research Decision 3)
   ├─ sync fails / reports no change (lock contention) ────▶ rollback ─┐
   │                                                                    │
   ▼  re-sync confirmed (filesModified > 0)                            │
post-check: touched-file-scoped dual assertion (FR-018)                │
   ├─ dangling old-name ref OR node named old-name remains ─▶ rollback ─┤
   │                                                                    │
   ▼  post-check green                                                  ▼
outcome: applied (exit 0) ◀──────────────────────                restore every file from snapshot
                                                                        ├─ restore OK ──▶ outcome: rolled-back (exit 3, success-shaped)
                                                                        └─ restore FAILS ▶ outcome: rollback-failed (exit 4, isError;
                                                                             dump unrestored snapshots to
                                                                             .codegraph/rename-recovery-<pid>-<hex>/, FR-019a)
```

- **Invariant (SC-002)**: every apply ends in exactly one of `applied` (post-check green) or a byte-identical-restored state — a partially-renamed workspace never occurs, except the documented hard mid-write process-kill window (FR-020).
- Snapshots are held **only until the post-check passes** (FR-020). `rollback-failed` is the **sole** error-shaped outcome (FR-019a); every other terminal is success-shaped (FR-023).

## Confidence Tier — FR-004 decision table (authoritative)

The tier is the resolver edge's `resolvedBy` category (stored in `edges.metadata` JSON, **not** a column) refined only where one label conflates a validated structural resolution with a naming guess — a **fixed exclusion of the guess branch, never a runtime-configurable threshold**. `resolvedBy` union: `src/resolution/types.ts:42`. `provenance` union (`src/types.ts:62-67`): `tree-sitter` | `scip` | `heuristic` | `lsp` (base resolved edges set none → persist NULL).

| Tier | Rule | `resolvedBy` / provenance | Assignment site(s) | Why |
|---|---|---|---|---|
| **exact** | LSP workspace edit | — (`source:'lsp'`) | `textDocument/rename` result | Complete by construction (includes locals). |
| **exact** | Target's own declaration span | — | `getNodeById` (`queries.ts:671`) | The definition itself. |
| **exact** | LSP-verified graph edge | `provenance='lsp'` | set by `updateEdgeLspProvenance`/`retargetEdgeWithLspCorrection` (`queries.ts:1783-1868`), callers `precision-pass.ts:700,721,728` | Compiler-accurate (SPEC-008). |
| **exact** | Scoped file/name lookup | `resolvedBy:'import'` | `import-resolver.ts` (:1174, :1240, :1275, :1451, :1534, …) | Refuses rather than guesses on ambiguity. |
| **exact** | Scoped qualified lookup | `resolvedBy:'qualified-name'` | `name-matcher.ts:437,452,470,1602`; `index.ts:1636` | Scoped, refuses on ambiguity. |
| **exact** | Exact function/method name, no fuzzy fallback | `resolvedBy:'function-ref'` | `name-matcher.ts:260,327,338`; `index.ts:1684,1786` | Refuses to emit on cross-file ambiguity. |
| **exact** | `instance-method` — **declaration-recovered branch only** | `resolvedBy:'instance-method'` where the receiver type came from an actual declaration and `Type::method` was confirmed to exist | `resolveMethodOnType()` (`name-matcher.ts:499`); sites `:840,868,909,940,962,974,978,1491,1531,1559` (conf 0.8–0.85) | Structurally validated against a real type. |
| **heuristic** | `instance-method` — **capitalization-guess / word-overlap branch** | same label, guess branch | `matchMethodCall` Strategy 2 (`name-matcher.ts:1608-1636`, conf 0.8) and Strategy 3 word-overlap (`:1641-1703`, conf 0.7/0.65) | Guesses a class by capitalizing the receiver / camel-case overlap. **This is the fixed exclusion** that splits the shared label. |
| **heuristic** | Last-resort strategies that still emit on a best guess | `resolvedBy:'exact-match'`, `resolvedBy:'fuzzy'` | `exact-match`: `name-matcher.ts:374,397,1938,1964`; `fuzzy`: `name-matcher.ts:1887` | Multi-candidate / cross-language branches pick a best guess. |
| **heuristic** | Framework resolutions, in full | `resolvedBy:'framework'` (incl. the confidence-`1.0` self-loop sentinel `targetNodeId===fromNodeId`) | `frameworks/*.ts`; self-loops e.g. `astro.ts:54-70`, `svelte.ts:77-127`, `vue.ts:108-131` | Framework-global marker, not a symbol-to-symbol edge — **never a candidate edit regardless of tier**. |
| **heuristic** | Anything unenumerated | any other `resolvedBy`; unrecognized/absent provenance | — | Default-deny. |
| **not a candidate** | Targets `file` nodes, not code symbols | `resolvedBy:'file-path'` | `name-matcher.ts:71,90,100`; `index.ts:1600` | `file` is an excluded rename kind (FR-011). |
| **not a candidate** | Dispatch/wiring site, not a name occurrence | `provenance='heuristic'` synthesized edge (callback, EventEmitter, React-render, JSX-child, ORM-descriptor, …) | synthesizers: `callback-synthesizer.ts`, `c-fnptr-synthesizer.ts:938,972`, `goframe-synthesizer.ts:136` (each with `metadata.synthesizedBy`) | Its `(line,col)` is a dispatch site — never emitted as an edit; counted only in the leftover-mention FYI (FR-013). |

**Final clause (FR-004)**: the assigned tier is **necessary but not sufficient** — every candidate edit, on every path, MUST also pass span verification (FR-005 plan-time, FR-016 apply-time). A live-byte mismatch drops the edit regardless of tier, because a byte match alone cannot catch referent misidentification (a same-named different symbol).

## Schema touchpoints (read-only)

New prepared statements go in `QueryBuilder` (`src/db/queries.ts`); the existing ones below already return what the engine needs (research Decisions 7–8).

| Need | Column(s) / query | Location |
|---|---|---|
| Resolve target + candidates by name | `getNodesByName` / `getNodesByLowerName` / `getNodesByQualifiedNameExact` | `queries.ts:1011/1051/1038` |
| Target declaration span | `nodes.start_line/end_line/start_column/end_column` via `getNodeById` | `schema.sql:27-30`; `queries.ts:671` |
| References TO the target (graph path) | `getIncomingEdges(targetId, ['references'])` → `edges.source/line/col/metadata/provenance` | `queries.ts:1945` |
| `resolvedBy` + `refName` per edge | `edges.metadata` (JSON); `metadata.refName` written at `index.ts:1005` | `schema.sql:49` |
| Reference occurrence start point | `edges.line/col` (nullable) or `unresolved_refs.line/col` (NOT NULL); **start only** → end derived from old-name UTF-16 length | `schema.sql:52-53`, `:86-87` |
| Post-check: unresolved refs by name | `getUnresolvedByName(oldName)` → filter to touched files | `queries.ts:2208` |
| Post-check: nodes by name | `getNodesByName(oldName)` → filter to touched files | `queries.ts:1011` |

New statements to add (additive): references-to-node scoped selects reused across plan + post-check, and touched-file-scoped variants of `getUnresolvedByName` / `getNodesByName` for the FR-018 dual assertion. No inline SQL (workflow constraint).
