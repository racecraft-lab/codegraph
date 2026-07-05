# Data Model: LSP Client Integration

## Entity: LspActivation

**Purpose**: Captures whether LSP precision is effective for a run.

**Fields**:
- `enabled`: boolean effective activation.
- `source`: `cli-enable | cli-disable | project-config | default-off`.
- `reason`: short human-readable explanation for status/debug output.

**Validation rules**:
- Explicit CLI enable/disable wins over project config.
- Environment variables cannot set `enabled`.
- Default is disabled.

## Entity: LspProjectConfig

**Purpose**: Project-scoped configuration loaded from `codegraph.json.lsp`.

**Fields**:
- `enabled`: optional boolean.
- `defaultTimeoutMs`: optional positive integer.
- `watch.enabled`: optional boolean.
- `servers`: map keyed by CodeGraph language id.
- `servers.<language>.command`: optional string array argv.
- `servers.<language>.timeoutMs`: optional positive integer.

**Validation rules**:
- `command` must be a non-empty string array when provided.
- `timeoutMs` and `defaultTimeoutMs` must be positive integers.
- Unknown language ids warn and are ignored.
- Invalid values warn and fall back to defaults or lower-precedence values.

## Entity: LspEnvironmentOverride

**Purpose**: Machine-local override of command argv or timeouts.

**Fields**:
- `language`: CodeGraph language id.
- `commandJson`: value from `CODEGRAPH_LSP_<LANG>_COMMAND_JSON`.
- `timeoutMs`: value from `CODEGRAPH_LSP_<LANG>_TIMEOUT_MS`.
- `defaultTimeoutMs`: value from `CODEGRAPH_LSP_TIMEOUT_MS`.
- `parseStatus`: `valid | invalid | absent`.
- `warning`: optional warning text.

**Validation rules**:
- Command JSON must parse to a string array.
- Timeout values must parse to positive integers.
- Overrides do not activate LSP precision.

## Entity: LspServerDefinition

**Purpose**: Built-in registry row for a supported language server.

**Fields**:
- `language`: CodeGraph language id.
- `displayName`: user-facing language name.
- `defaultCommand`: argv array or null for disposition-only rows.
- `acceptedCommands`: ordered alternatives.
- `fileExtensions`: extensions handled by the server.
- `requiresWorkspace`: boolean.
- `requiresSdkEvidence`: optional string for language-specific SDK evidence.
- `specOwner`: `SPEC-008` or future spec id.
- `statusDisposition`: `implemented | future-owned`.

**Validation rules**:
- Every baseline language must have a registry row or disposition row.
- Future-owned rows must name a concrete spec id.
- No row may use backlog-only ownership.

## Entity: EffectiveLspServerConfig

**Purpose**: Final command and timeout used for a language in a run.

**Fields**:
- `language`: CodeGraph language id.
- `command`: argv array.
- `timeoutMs`: positive integer.
- `source`: `env | project-config | registry-default`.
- `activation`: reference to `LspActivation`.

**Validation rules**:
- Produced only when LSP is enabled and the language has a command-bearing registry row.
- Environment command overrides win over project config command overrides.
- Language timeout overrides win over global timeout.

## Entity: LspServerStatus

**Purpose**: Per-language availability and lifecycle result.

**Fields**:
- `language`: CodeGraph language id.
- `state`: `not-applicable | available | unavailable | starting | initialized | crashed | timed-out | degraded`.
- `command`: argv array or disposition.
- `resolvedPath`: optional executable path.
- `observedVersion`: optional version/serverInfo text.
- `minimumRuntimeEvidence`: optional text.
- `lastError`: optional string.
- `degradedReason`: optional string.

**Validation rules**:
- Missing, crashed, malformed, or timed-out servers degrade only their language during normal runtime.
- SPEC-008 validation treats missing required real servers as prereq failures.
- Exact versions are evidence, not pins.

## Entity: LspWorkspaceSession

**Purpose**: Running JSON-RPC stdio session for one language and workspace.

**Fields**:
- `sessionId`: stable run-local id.
- `language`: CodeGraph language id.
- `workspaceRoot`: absolute project path.
- `processId`: child process id when started.
- `state`: `created | initialized | shutting-down | stopped | crashed | timed-out`.
- `capabilities`: normalized server capabilities used by the precision pass.
- `requestTimeoutMs`: effective timeout.

**Validation rules**:
- A session must initialize before definition/reference requests.
- Shutdown/exit is attempted after use.
- Crashes and timeouts produce degraded status, not whole-index failure.

## Entity: EdgeVerificationWorkItem

**Purpose**: Existing graph reference or edge selected for LSP verification.

**Fields**:
- `edgeId`: existing edge id.
- `sourceNodeId`: CodeGraph node id.
- `currentTargetNodeId`: optional CodeGraph node id.
- `language`: CodeGraph language id.
- `documentUri`: file URI.
- `position`: line/character for LSP request.
- `currentProvenance`: `null | heuristic | lsp`.
- `reason`: `definition-check | reference-check | watch-change`.

**Validation rules**:
- Work items are generated only after structural extraction and reference resolution.
- Watch work items are restricted to bounded changed-file sets.
- Generated or unindexed positions may be skipped with a status reason.

## Entity: NormalizedLspTarget

**Purpose**: Deduplicated semantic target returned by LSP.

**Fields**:
- `uri`: normalized file URI.
- `range`: normalized target range.
- `selectionRange`: optional normalized selection range.
- `workspaceRelation`: `in-workspace | external | generated | unindexed`.
- `compatibleNodeId`: optional CodeGraph node id.

**Validation rules**:
- `Location` and `LocationLink` responses normalize to the same shape.
- Equivalent ranges deduplicate before uniqueness checks.
- In-workspace corrections require exactly one compatible CodeGraph node.

## Entity: EdgeVerificationResult

**Purpose**: Outcome of checking one work item.

**Fields**:
- `edgeId`: existing edge id.
- `result`: `verified | corrected | suppressed | ambiguous | skipped | degraded`.
- `lspTarget`: optional `NormalizedLspTarget`.
- `activeTargetNodeId`: optional CodeGraph node id after verification.
- `correctionMetadataId`: optional reference.
- `skipReason`: optional string.

**Validation rules**:
- Only `verified` and `corrected` surviving active edges receive `provenance: "lsp"`.
- `ambiguous` results do not create replacement edges.
- External or unindexed unique targets may suppress a conflicting edge but must not create external graph nodes.

## Entity: CorrectionMetadata

**Purpose**: Audit record for replaced or suppressed graph targets.

**Fields**:
- `correctionId`: stable id.
- `edgeId`: affected edge id.
- `language`: CodeGraph language id.
- `server`: selected server command/display name.
- `previousTargetNodeId`: optional node id.
- `previousProvenance`: `null | heuristic | lsp`.
- `lspTargetUri`: URI.
- `lspTargetRange`: range.
- `newTargetNodeId`: optional node id.
- `reason`: `unique-in-workspace-target | unique-external-target | unique-unindexed-target`.
- `createdAt`: timestamp.

**Validation rules**:
- Suppressed edges do not remain active solely for audit history.
- Metadata must be queryable enough for status and debug output.

## Entity: LanguageCoverageRecord

**Purpose**: Per-language coverage summary for status and validation.

**Fields**:
- `language`: CodeGraph language id.
- `filesTotal`: integer.
- `filesChecked`: integer.
- `state`: `not-present | verified | partially-verified | degraded | future-owned`.
- `checkedEdges`: integer.
- `verifiedEdges`: integer.
- `correctedEdges`: integer.
- `suppressedEdges`: integer.
- `skippedByReason`: map of reason to count.
- `degradedReason`: optional string.

**Validation rules**:
- Languages with no files report `not-present`, not failure.
- Degraded languages still leave structural index results intact.
- Future-owned rows must name the concrete owner.

## Entity: ParityRow

**Purpose**: Language or capability baseline row used by completion gates.

**Fields**:
- `rowType`: `language | capability`.
- `name`: baseline row label.
- `owner`: implementation or spec owner.
- `evidence`: required or collected validation evidence.
- `futureOwner`: optional concrete spec id.
- `status`: `owned | future-owned | verified`.

**Validation rules**:
- `futureOwner` is required when status is `future-owned`.
- Backlog-only ownership is invalid.
- Final SPEC-008 packet must show zero unowned rows.

## Entity: LspPrereqReport

**Purpose**: Strict real-server validation report.

**Fields**:
- `generatedAt`: timestamp.
- `codegraphVersion`: version or commit.
- `platform`: platform string.
- `missing`: list of language/expected command alternatives.
- `observed`: list of language/command/path/version/minimum-runtime evidence.
- `paritySummary`: count of owned, verified, and future-owned rows.

**Validation rules**:
- Missing required real-server rows stop SPEC-008 validation.
- Normal runtime status and validation report have different failure semantics.

## State Transitions

### LspWorkspaceSession

```text
created -> initialized -> shutting-down -> stopped
created -> crashed
initialized -> crashed
created -> timed-out
initialized -> timed-out
```

### EdgeVerificationResult

```text
unchecked -> verified
unchecked -> corrected
unchecked -> suppressed
unchecked -> ambiguous
unchecked -> skipped
unchecked -> degraded
```

### LanguageCoverageRecord

```text
not-present
pending -> verified
pending -> partially-verified
pending -> degraded
future-owned
```

