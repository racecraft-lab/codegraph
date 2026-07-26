# Contract: CFG MCP Tool

## Tool

`codegraph_get_cfg`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "projectPath": { "type": "string" },
    "functionId": { "type": "string" },
    "limit": { "type": "integer" },
    "offset": { "type": "integer" }
  },
  "required": ["projectPath", "functionId"]
}
```

## Behavior

- Returns the exact `CfgReadResult` machine object from `cfg-shared-contract.md`.
- Defaults `limit` to 100 and `offset` to 0.
- Clamps `limit` to `1..500` and `offset` to zero or greater.
- Applies the effective page independently to deterministic block and edge arrays.
- Expected CFG states return success-shaped tool content and must not set `isError: true`.
- `isError: true` is reserved for security refusals or real malfunctions that prevent a valid result.

## Reconstruction Guarantee

For an available CFG larger than one MCP page, collecting pages by increasing `offset` reconstructs the complete ordered CFG with no duplicate blocks, no duplicate edges, no gaps, and accurate totals.

