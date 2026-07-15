# Contract: MCP Tools

**Feature**: SPEC-011 | Surface: `src/mcp/tools.ts` | FR-027, FR-029, FR-030, FR-031

Three new tools carrying the `codegraph_` prefix every existing MCP tool uses. **`codegraph_explore` is not modified** (FR-031). No steering is added to `server-instructions.ts` (Q16, Constitution VI); the tools carry factual descriptions only.

## Shared conventions

- **Paging** (offset/limit; reuses SPEC-005 semantics, MCP page-size ceiling): `limit` integer, default **20**, clamped to **1–100** (over-cap clamps, never errors); `offset` integer, zero-based, default **0**. Numeric params (`limit`/`offset`/`minSize`) are coerced before clamping — parsed as an integer (floor of a numeric value; non-numeric or missing → the stated default), never a 4xx (the read-ops `Number(x)||default` precedent).
- **List envelope**: `{ items: [...], total: <int match count>, limit: <effective>, offset: <effective> }`.
- **State** (FR-030): every list/detail result carries a machine-readable `state` enum — `"available" | "stale" | "empty" | "unavailable" | "disabled" | "not_indexed"` — alongside the human-readable guidance string, so consumers branch structurally; an empty `items` array is NEVER the sole signal of the unavailable state.
- **Determinism**: every list uses a totally-ordered sort ending in the stable identifier (below). String sort keys (`name`, `canonicalLabel`) use **BINARY** (case-sensitive, code-point) collation, applied ONCE in the shared catalog-store read (`ORDER BY name COLLATE BINARY, id` for flows; `ORDER BY member_count DESC, canonical_label COLLATE BINARY ASC, id` for clusters) so both surfaces page an identically-ordered result (FR-028/SC-004).
- **Success-shaped only** (FR-030, Constitution VI): for *every* expected condition — project not indexed, catalog disabled, catalog stale, unknown id, available-but-empty — the tool returns a normal (non-`isError`) result carrying guidance text. `isError: true` is never used for these.

## `codegraph_list_flows`

Lists execution-flow summaries.

**Input**: `{ projectPath?: string, limit?: number, offset?: number }`

**Sort**: `name` ascending, then `id` ascending (FR-027).

**Item** (summary):
```
{
  id: string,            // deterministic flow id (root-derived)
  name: string,          // "<METHOD> <path>" | CLI command | qualified symbol (FR-010)
  entryKind: "route" | "cli" | "event" | "export",
  stepCount: number,     // unique steps persisted
  truncated: boolean     // depth OR width OR totalSteps (FR-027)
}
```

**Result**: `{ items: Item[], total, limit, offset }` + a `sourceVersion` and a `state` (the shared `state` enum) when a catalog exists. Stale (FR-022) returns items with a staleness note and the recorded `sourceVersion`. Disabled / not-indexed / unavailable (FR-023) return an empty `items` with success-shaped guidance describing the condition.

## `codegraph_get_flow`

Returns one flow's bounded graph + truncation metadata (FR-027).

**Input**: `{ projectPath?: string, id: string }`

**Result** (on found):
```
{
  id, name, entryKind,
  root: { nodeId, name, kind },
  steps: [
    {
      nodeId: string,
      name: string,            // denormalized; explicit placeholder if node id no longer resolves (FR-022a)
      kind: string,
      depth: number,           // hops from root
      parentNodeId: string | null,
      edgeKind: "calls" | "references" | null,   // null for root
      provenance: "static" | "lsp" | "heuristic" | null // null only for the root step; every non-root step carries one (FR-009)
    }, ...
  ],
  truncated: boolean,
  truncation: { depth: boolean, width: boolean, totalSteps: boolean },  // FR-027 exact shape; each axis independent
  sourceVersion: number,
  state: "available" | "stale" | "empty" | "unavailable" | "disabled" | "not_indexed"
}
```

> **Provenance is a 3-value WIRE enum** `static | lsp | heuristic` (null only for the root step). Internal edge provenance maps onto it: tree-sitter/scip → `static`, lsp → `lsp`, heuristic → `heuristic`. This enum MUST NOT reuse the 2-value `Edge.provenance` (which collapses `lsp` → `static` and would silently drop the LSP provenance FR-008/FR-009 require). The `root` and each step's `name`/`kind` are the denormalized catalog columns (FR-022a), rendered without a live `nodes` join.

**Unknown id** (FR-030): success-shaped guidance `"unknown flow id"` (not `isError`). Disabled / not-indexed / unavailable: success-shaped guidance describing the condition.

## `codegraph_list_clusters`

Lists functional-cluster summaries.

**Input**: `{ projectPath?: string, limit?: number, offset?: number, minSize?: number }`

- `minSize` (FR-029): integer, default **1** (values `< 1` clamp to 1). A cluster is returned when `member_count >= minSize`. Default 1 returns the full total-coverage catalog including singletons; `minSize >= 2` suppresses singletons. `total` reflects the count **after** the `minSize` filter.

**Sort**: `member_count` **descending**, then `canonicalLabel` ascending, then `id` ascending (FR-027).

**Item** (summary):
```
{
  id: string,              // opaque minted stable id (FR-017a)
  canonicalLabel: string,  // deterministic (FR-018)
  displayLabel: string | null,  // optional LLM label, presentation-only; null when unconfigured (FR-019)
  memberCount: number,
  isSingleton: boolean     // FR-014
}
```

**Result**: `{ items: Item[], total, limit, offset }` + `sourceVersion`/`state`. Same stale / disabled / not-indexed / unavailable success-shaped handling as the flow lists.

## Traceability

| Requirement | Where |
|---|---|
| FR-027 tools + paging + sorts + truncation shape | all three tools above |
| FR-029 `minSize` | `codegraph_list_clusters` |
| FR-030 success-shaped conditions | Shared conventions + per-tool notes |
| FR-031 explore untouched | (no change to `codegraph_explore`) |
