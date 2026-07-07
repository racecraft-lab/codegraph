# Contract: LSP Status and Prerequisites

## Scope

This contract defines status output and strict SPEC-008 real-server validation behavior.

## Runtime Status

`codegraph status` must report LSP state for human and JSON output.

### Required status fields

| Field | Meaning |
|---|---|
| `lsp.enabled` | Effective LSP activation for the last relevant run or current config context |
| `lsp.activationSource` | `cli-enable`, `cli-disable`, `project-config`, or `default-off` |
| `lsp.lastRunAt` | Timestamp for last LSP precision pass, when present |
| `lsp.servers[]` | Per-language server availability records |
| `lsp.coverage[]` | Per-language coverage records |
| `lsp.edgeCounts.checked` | Count of candidate edges checked |
| `lsp.edgeCounts.verified` | Count of active edges verified by LSP |
| `lsp.edgeCounts.corrected` | Count of active edges retargeted by LSP |
| `lsp.edgeCounts.suppressed` | Count of conflicting active edges suppressed due to unique external/unindexed targets |
| `lsp.edgeCounts.skippedByReason` | Map of skip reasons to counts |
| `lsp.edgeCounts.degraded` | Count of candidate edges skipped due to unavailable server/language degradation |
| `lsp.performance.structuralElapsedMs` | Structural-index elapsed time for the comparable run, when recorded |
| `lsp.performance.lspElapsedMs` | LSP precision-pass elapsed time, when LSP ran |
| `lsp.performance.enabledOverheadRatio` | Ratio of LSP-enabled elapsed time to comparable non-LSP elapsed time, when available |
| `lsp.performance.activeSessionHighWatermark` | Maximum simultaneous language-server sessions observed |
| `lsp.performance.inFlightRequestHighWatermark` | Maximum simultaneous definition/reference requests observed for any session |
| `lsp.performance.caps` | Effective full-index and watch work/concurrency caps |
| `lsp.performance.zeroWorkWhenDisabled` | Disabled-path evidence that no LSP runtime work occurred, when validation records it |

### Server record

| Field | Meaning |
|---|---|
| `language` | CodeGraph language id |
| `command` | Effective command argv or disposition text |
| `state` | `available`, `unavailable`, `initialized`, `crashed`, `timed-out`, `degraded`, `not-applicable`, or `future-owned` |
| `observedVersion` | Version/serverInfo evidence when observed |
| `minimumRuntimeEvidence` | Text evidence for upstream minimum runtime when relevant |
| `lastError` | Short failure text when unavailable/crashed/timed out |

### Performance record

| Field | Meaning |
|---|---|
| `language` | CodeGraph language id or `all` for run-level disabled-path evidence |
| `sourceFilesSeen` | Source files considered for LSP work |
| `candidateWorkItems` | Candidate LSP work items before cap skips |
| `checkedWorkItems` | Candidate work items actually sent to LSP |
| `skippedByReason` | Map of performance, applicability, and degradation skip reasons to counts |
| `capExceededReasons` | Full-index or watch cap reasons observed for this language |
| `elapsedMs` | Language-specific LSP elapsed time when measurable |

## Normal Runtime Degradation

During normal `codegraph index --lsp`:

- A missing server degrades only that language.
- A crashed or timed-out server degrades only that language.
- Other available language servers may still verify their languages.
- Structural indexing succeeds unless a non-LSP indexing failure occurs.
- Status names unavailable languages and degraded reasons.
- Full-index caps, watch caps, and concurrency caps report skip/degrade reasons rather than silently broadening work.

## SPEC-008 Validation Prereq Check

SPEC-008 validation has stricter semantics than normal runtime. It must stop before completion if any required real-server prerequisite is missing for a SPEC-008-owned language row.

### Required report fields

| Field | Meaning |
|---|---|
| `generatedAt` | Report timestamp |
| `codegraphVersion` | CodeGraph version or commit |
| `platform` | Platform and architecture |
| `observed[]` | Language, command, resolved path, observed version/serverInfo, minimum runtime evidence |
| `missing[]` | Language and expected command alternatives |
| `paritySummary` | Counts of verified, owned, future-owned, and unowned rows |

### Missing-prereq message

```text
SPEC-008 real-server validation prerequisites failed. Missing required local language servers: <language>: expected <command or alternatives>. Install the server or configure codegraph.json/environment overrides. Normal codegraph index --lsp still degrades per language; this failure applies only to SPEC-008 validation.
```

## Version Evidence Policy

- Record observed versions; do not pin exact versions in artifacts.
- Record upstream minimum runtime requirements only when the selected server requires them.
- Store evidence as plain text in validation artifacts without outbound links.

## Parity Gate

Validation fails if any language or capability parity row is unowned. Valid ownership is one of:

- Implemented by SPEC-008 with validation evidence.
- Implemented by an existing or previous numbered spec with evidence requirement.
- Future-owned by SPEC-024 or another concrete numbered child spec.

Generic backlog ownership is invalid.
