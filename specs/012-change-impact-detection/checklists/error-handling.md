# Error Handling Checklist: Change Impact Detection

**Purpose**: Validate whether SPEC-012 requirements clearly distinguish expected degraded states from malformed input and operational failures.
**Created**: 2026-07-15
**Feature**: [spec.md](../spec.md), [contracts](../contracts/), [data-model.md](../data-model.md)

**Note**: This checklist tests requirements quality, not implementation behavior.

## Requirement Completeness

- [x] CHK001 Are missing-index and unavailable-index states explicitly represented instead of silently omitted? [Completeness, Spec §FR-008, Contract §json-report]
- [x] CHK002 Are stale indexes required to warn and continue by default? [Completeness, Spec §FR-007]
- [x] CHK003 Are malformed input, invalid base refs, git failures, path refusal, and unreadable index state defined as operational failures? [Completeness, Contract §cli, Contract §mcp]
- [x] CHK004 Are MCP expected conditions listed separately from MCP tool-error conditions? [Completeness, Spec §FR-015, Contract §mcp]
- [x] CHK005 Are threshold breaches represented as valid reports rather than operational failures? [Completeness, Spec §FR-016, Contract §mcp]

## Requirement Clarity

- [x] CHK006 Is `exitCode: 2` clearly reserved for configured `failOn` policy breaches? [Clarity, Spec §FR-016, Spec §FR-017]
- [x] CHK007 Is `exitCode: 3` clearly tied to unavailable expected states or CLI operational failures? [Clarity, Contract §cli, Contract §json-report]
- [x] CHK008 Is base-ref failure behavior clear when the named reference is invalid? [Clarity, Spec §Edge Cases, Contract §cli]
- [x] CHK009 Is flow-catalog absence represented through `affectedFlows.state` rather than generic failure? [Clarity, Spec §FR-010, Data Model §AffectedFlows]

## Requirement Consistency

- [x] CHK010 Do stale-index requirements avoid conflicting with threshold-breach semantics? [Consistency, Spec §FR-007, Spec §SC-004]
- [x] CHK011 Do CLI and MCP expected-state semantics align while still allowing MCP tool errors for malformed input? [Consistency, Contract §cli, Contract §mcp]
- [x] CHK012 Are missing, disabled, unavailable, stale, empty, and available flow states consistently named? [Consistency, Spec §FR-010, Data Model §AffectedFlows]

## Scenario Coverage

- [x] CHK013 Are expected degraded states covered for missing index, stale index, unmapped hunks, unavailable flows, and threshold breach? [Coverage, Spec §FR-015, Contract §mcp]
- [x] CHK014 Are true failure states covered for invalid input, invalid base ref, git failure, and unreadable index state? [Coverage, Contract §cli, Contract §mcp]

## Gaps

- [x] CHK015 Are there no unresolved error-handling gaps after the checklist review? [Gap Closure]

## Notes

- Result: PASS. Error-handling requirements distinguish expected degraded reports from operational failures.
