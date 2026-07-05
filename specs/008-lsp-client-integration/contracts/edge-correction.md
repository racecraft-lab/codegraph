# Contract: LSP Edge Verification and Correction

## Scope

This contract defines when LSP results verify, correct, suppress, skip, or degrade graph edges.

## Inputs

The precision pass consumes existing graph data after structural extraction and reference resolution:

- Candidate reference location.
- Existing source node.
- Existing target node, when present.
- Existing edge provenance.
- Language and workspace path.
- Effective server config and session.

## LSP Requests

The precision pass may use:

- `textDocument/definition`
- `textDocument/references`

Request selection is implementation-specific, but correction rules are the same for both.

## Normalization

LSP `Location` and `LocationLink` responses normalize to:

- URI.
- Target range.
- Optional selection range.
- Workspace relation: `in-workspace`, `external`, `generated`, or `unindexed`.

Equivalent target ranges deduplicate before uniqueness checks.

## Result Rules

| LSP outcome | Graph action | Provenance action | Metadata |
|---|---|---|---|
| Exactly one normalized in-workspace target and exactly one compatible CodeGraph node matching current target | Keep active edge | Set active edge to `lsp` | Record verified count |
| Exactly one normalized in-workspace target and exactly one compatible CodeGraph node different from current target | Replace target or suppress old active edge according to storage design | Set surviving active edge to `lsp` | Record correction metadata |
| Exactly one normalized external/unindexed/generated target that conflicts with an active graph target | Suppress conflicting active edge; do not create external graph node | No external active edge is created | Record suppression metadata |
| Multiple normalized targets | Keep existing graph unchanged | Preserve existing provenance | Record ambiguous skip |
| No target | Keep existing graph unchanged | Preserve existing provenance | Record skipped reason |
| Server missing/crashed/timed out | Keep existing graph unchanged | Preserve existing provenance | Record degraded language |

## Correction Metadata

Every correction or suppression records:

- Affected edge id.
- Language.
- Server command/display name.
- Previous target node id, when present.
- Previous provenance.
- LSP target URI and range.
- New target node id, when present.
- Reason.
- Timestamp.

Suppressed edges must not remain active solely to preserve audit history.

## Invariants

- Existing `null` and `heuristic` provenance semantics remain unchanged unless LSP verifies or corrects the active edge.
- Ambiguous LSP output never creates speculative replacement edges.
- External/unindexed targets never create new external graph nodes.
- Duplicate active edges for the same semantic reference are not emitted.
- Node and edge counts must remain stable aside from intentional correction/suppression effects.

