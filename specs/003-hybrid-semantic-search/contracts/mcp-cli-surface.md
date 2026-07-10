# Contract: MCP `codegraph_search` + CLI `query` surfaces

These are the explicit surfaces that default unspecified mode to `auto` (FR-002).

## MCP tool: `codegraph_search` (`src/mcp/tools.ts`)

### Input schema change (plumbing)

Add one optional property to the existing `inputSchema` (keep description agent-friendly; single source of truth for agent guidance stays `server-instructions.ts` per issue #529 — update it only if guidance changes):

```jsonc
{
  "properties": {
    "query":       { "type": "string" },                 // required (unchanged)
    "kind":        { "type": "string", "enum": [ ... ] }, // unchanged (maps 'type'→type_alias)
    "limit":       { "type": "number" },                 // unchanged (default 10, clamp 1..100)
    "projectPath": { "type": "string" },                 // unchanged
    "mode":        { "type": "string",                   // NEW — optional
                     "enum": ["keyword","semantic","hybrid","auto"] }
  },
  "required": ["query"]
}
```

- `mode` omitted → `auto` (FR-002). Unknown value → `auto` (never error).
- `handleSearch` maps `mode` through to `cg.searchNodes(query, { limit, kinds, mode: resolved })`.

### Output rendering

- **Provenance tag (FR-012)**: in semantic/hybrid modes only, append an inline bracket tag to each hit's primary line — `[keyword]` / `[semantic]` / `[both]`. Keyword mode: no tag (byte-identical).
- **Timing footer (FR-008)**: when the semantic arm actually ran (non-degraded), append a footer after results, e.g. `semantic: embed 34ms · fusion 12ms`. Omitted in keyword mode and every degraded condition.
- **Degradation hint (FR-015)**: under a degraded condition, append the matching literal footer string (see `degradation-hints.md`) after results. Results always lead; the response is **success-shaped — never `isError`** (Constitution VI, FR-015).
- Fused score is **never** rendered in MCP output (human-readable; CLI `--json` only).

## CLI: `codegraph query <search>` (`src/bin/codegraph.ts`)

### Options change (plumbing)

Existing: `-p, --path`, `-l, --limit` (default `'10'`), `-k, --kind`, `-j, --json`.
Add: `-m, --mode <mode>` (`keyword|semantic|hybrid|auto`; unspecified → `auto`).

### Output rendering

- **Human output**: same layout as today; in semantic/hybrid modes append the `[keyword]`/`[semantic]`/`[both]` tag per hit and the timing footer (non-degraded) / degradation hint (degraded) after results. Raw/fused score NOT printed in human mode (matches existing #1045 no-score policy).
- **`--json` output**: `JSON.stringify(results, ...)` now includes `matchType` and `fusedScore` on each result in semantic/hybrid modes (absent in keyword mode), plus machine-readable timing fields (`embedMs`, `fusionMs`) when the semantic arm ran. Omitted entirely otherwise.

## Auto-resolution predicate (shared helper, FR-002)

`auto` → `hybrid` iff (provider configured AND ≥1 vector matches the active stored model), else `keyword`. Same predicate as the FR-017 status line (research D6/D12). Used ONLY by these two surfaces + explicit opt-in callers — never by internal callers (FR-003).
