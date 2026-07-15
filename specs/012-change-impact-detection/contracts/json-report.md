# Contract: Detect Changes JSON Report

`schemaVersion` is `1` for SPEC-012. Field names are stable across clean, ordinary-impact, stale-index, threshold-breach, and flow-unavailable scenarios.

## Top-level shape

```json
{
  "schemaVersion": 1,
  "summary": {
    "mode": "all",
    "baseRef": null,
    "status": "impact",
    "changedSymbolCount": 1,
    "unmappedHunkCount": 0,
    "callerCount": 2,
    "affectedFlowCount": 1,
    "riskCount": 0,
    "warningCount": 0
  },
  "changedSymbols": [],
  "unmappedHunks": [],
  "callers": [],
  "affectedFlows": {
    "state": "available",
    "items": [],
    "sourceVersion": 0,
    "truncated": false
  },
  "risks": [],
  "warnings": [],
  "limits": {
    "callerDepth": 1,
    "maxCallers": 20,
    "hubCallerThreshold": 20,
    "maxFlows": 20,
    "truncatedCallers": false,
    "truncatedFlows": false
  },
  "exitCode": 1
}
```

## Required top-level fields

- `schemaVersion`
- `summary`
- `changedSymbols`
- `unmappedHunks`
- `callers`
- `affectedFlows`
- `risks`
- `warnings`
- `limits`
- `exitCode`

## Summary status values

- `clean`: no changed symbols and no unmapped hunks.
- `impact`: reportable impact exists and no configured threshold breached.
- `threshold_breach`: a configured `failOn` policy was breached.
- `unavailable`: impact could not be calculated because required local state, such as a usable CodeGraph index, is unavailable.

Operational failures do not produce a normal report on MCP. Expected unavailable states do produce a normal report and carry `exitCode: 3` for CLI parity.

## Changed symbol row

```json
{
  "id": "symbol:1",
  "nodeId": "node-id",
  "name": "detectChanges",
  "qualifiedName": "detectChanges",
  "kind": "function",
  "filePath": "src/analysis/detect-changes/index.ts",
  "startLine": 10,
  "endLine": 80,
  "changeType": "modified",
  "hunkIds": ["hunk:1"]
}
```

## Unmapped hunk row

```json
{
  "hunkId": "hunk:2",
  "oldPath": "assets/logo.png",
  "newPath": "assets/logo.png",
  "reason": "binary",
  "message": "Binary file change cannot be mapped to indexed symbol spans."
}
```

## Caller row

```json
{
  "changedSymbolId": "symbol:1",
  "callerNodeId": "caller-node-id",
  "name": "runDetectChanges",
  "qualifiedName": "runDetectChanges",
  "kind": "function",
  "filePath": "src/bin/codegraph.ts",
  "startLine": 100,
  "depth": 1,
  "edgeKind": "calls"
}
```

## Affected flow row

```json
{
  "flowId": "flow:abc123",
  "name": "codegraph detect-changes",
  "entryKind": "cli",
  "matchedNodeIds": ["node-id", "caller-node-id"],
  "stepCount": 12,
  "truncated": false
}
```

## Risk row

```json
{
  "code": "hub",
  "severity": "warning",
  "targetId": "symbol:1",
  "message": "Changed symbol has 24 direct upstream callers, above hub threshold 20.",
  "policy": "hub"
}
```
