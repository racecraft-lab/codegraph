# Contract: `codegraph_detect_changes`

## Tool name

```text
codegraph_detect_changes
```

## Input schema

```json
{
  "mode": "all",
  "baseRef": "origin/main",
  "format": "json",
  "failOn": "callers>10,hub",
  "callerDepth": 1,
  "maxCallers": 20,
  "projectPath": "/absolute/project/path"
}
```

## Required fields

- `mode`

## Optional fields

- `baseRef`: required only when `mode` is `base-ref`.
- `format`: `json` or `markdown`; default `json`.
- `failOn`: comma-separated `callers>N` and/or `hub`.
- `callerDepth`: clamped to 1–3; default 1.
- `maxCallers`: clamped to 1–100; default 20.
- `projectPath`: absolute project path for non-default roots.

## Response behavior

Expected states return one normal text content payload in the requested format. These include:

- Missing index.
- Stale index.
- Unmapped hunks.
- Binary/generated/unsupported/unindexed/untracked files.
- Disabled or unavailable SPEC-011 flow catalog.
- Threshold breach with `exitCode: 2`.
- Unavailable expected state with `exitCode: 3`.

Tool errors are reserved for malformed input or operational failures, such as invalid `baseRef`, git command failure, path refusal, or unreadable index state.

## JSON response

When `format` is `json`, the content text is a JSON `ImpactReport` matching `contracts/json-report.md`.

## Markdown response

When `format` is `markdown`, the content text uses the deterministic sections defined by the CLI contract.

## Parity rule

For the same repository state and equivalent options, CLI JSON and MCP JSON must have compatible field semantics and matching `exitCode` values.
