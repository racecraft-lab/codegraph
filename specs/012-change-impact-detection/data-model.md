# Data Model: Change Impact Detection

## DiffRequest

Fields:

- `mode`: `unstaged`, `staged`, `all`, or `base-ref`.
- `baseRef`: required only when `mode` is `base-ref`.
- `format`: `json` or `markdown`.
- `failOn`: optional comma-separated threshold grammar.
- `callerDepth`: optional integer, clamped to 1–3.
- `maxCallers`: optional integer, clamped to 1–100.
- `projectPath`: optional project root for MCP and CLI parity.

Validation:

- `baseRef` is invalid unless `mode` is `base-ref`.
- Invalid mode, invalid base ref, invalid `failOn`, or malformed bounds are input failures.
- `base-ref` compares `HEAD` to `merge-base(baseRef, HEAD)` and ignores dirty local-only changes.

## ChangedHunk

Fields:

- `id`: stable report-local identifier.
- `oldPath`, `newPath`: path sides from git metadata.
- `oldStart`, `oldLines`, `newStart`, `newLines`: hunk ranges when textual.
- `changeKind`: `added`, `modified`, `deleted`, `renamed`, `moved`, `binary`, or `unknown`.
- `isPureMove`: true only when rename/move metadata has no mapped content hunk.
- `reason`: optional diagnostic reason for non-mappable cases.

Relationships:

- May map to zero or more `ChangedSymbol` rows.
- If it maps to none, it becomes an `UnmappedHunk`.

## ChangedSymbol

Fields:

- `id`: stable report-local identifier.
- `nodeId`: indexed CodeGraph node id.
- `name`, `qualifiedName`, `kind`, `filePath`, `startLine`, `endLine`.
- `changeType`: `added`, `modified`, `deleted`, or `renamed_modified`.
- `hunkIds`: changed hunks that intersect the symbol.

Validation:

- Pure path-only renames do not create changed symbols.
- Deleted symbols require prior indexed spans; otherwise the deleted hunk is unmapped.

## UnmappedHunk

Fields:

- `hunkId`.
- `oldPath`, `newPath`.
- `reason`: `no-symbol-span`, `binary`, `generated`, `unsupported`, `unindexed`, `untracked`, or `deleted-without-span`.
- `message`: human-readable explanation.

Validation:

- Unmapped hunks may create warnings.
- Unmapped hunks never create callers, flows, or invented changed-symbol rows.
- Reason selection order is deterministic: binary metadata first, then generated/excluded classification from existing CodeGraph file policy when available, then unsupported language, then unindexed path, then untracked file, then `no-symbol-span` for indexed textual hunks with no intersecting symbol.

## CallerImpact

Fields:

- `changedSymbolId`.
- `callerNodeId`.
- `name`, `qualifiedName`, `kind`, `filePath`, `startLine`.
- `depth`: caller depth from the changed symbol.
- `edgeKind`: graph edge kind that produced the caller relation.

Validation:

- Default `callerDepth` is 1.
- Displayed rows are capped by `maxCallers`.
- Full direct caller count is recorded for risk evaluation before display truncation.
- Caller rows are sorted deterministically by changed symbol, depth, file path, start line, and qualified name before display truncation.

## AffectedFlows

Fields:

- `state`: `disabled`, `unavailable`, `not_indexed`, `stale`, `empty`, or `available`.
- `items`: flow rows that include a changed symbol or impacted caller.
- `sourceVersion`: catalog source version when available.
- `truncated`: whether flow rows were bounded.

Validation:

- Inert states return empty `items`.
- `empty` means flow catalogs were computed and no flows matched.
- `available` with empty `items` means no affected flows matched the changed symbols/callers.
- `stale` can still include retained rows but must add a warning.
- Flow rows are sorted deterministically by flow name then flow id and capped at `maxFlows: 20`.

## RiskAnnotation

Fields:

- `code`: `high-callers`, `hub`, `truncated-callers`, `stale-index`, `flow-unavailable`, or `threshold-breach`.
- `severity`: `info`, `warning`, or `error`.
- `targetId`: changed symbol, flow, or report-level identifier.
- `message`: human-readable explanation.
- `policy`: optional breached `failOn` token.

Validation:

- Hub risk exists when unique direct upstream caller count exceeds `hubCallerThreshold: 20`.
- Threshold-breach risks are emitted only for configured `failOn` policies.

## Limits

Fields:

- `callerDepth`: effective caller depth.
- `maxCallers`: effective display cap.
- `hubCallerThreshold`: fixed default 20.
- `maxFlows`: fixed SPEC-012 v1 flow display cap; default 20.
- `truncatedCallers`: boolean.
- `truncatedFlows`: boolean.

## ImpactReport

Fields:

- `schemaVersion`: always `1` for SPEC-012.
- `summary`.
- `changedSymbols`.
- `unmappedHunks`.
- `callers`.
- `affectedFlows`.
- `risks`.
- `warnings`.
- `limits`.
- `exitCode`.

Exit-code state:

- `0`: clean report.
- `1`: ordinary impact report.
- `2`: configured threshold breach.
- `3`: unavailable expected state that cannot calculate impact, or true operational failure for CLI. MCP expected unavailable states return a normal payload; MCP operational failures are tool errors.
