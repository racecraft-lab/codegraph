# API Contracts Checklist: Change Impact Detection

**Purpose**: Validate whether SPEC-012 CLI, MCP, JSON, and markdown contract requirements are complete, clear, consistent, and measurable.
**Created**: 2026-07-15
**Feature**: [spec.md](../spec.md), [plan.md](../plan.md), [contracts](../contracts/)

**Note**: This checklist tests requirements quality, not implementation behavior.

## Requirement Completeness

- [x] CHK001 Are all stable JSON top-level fields documented with `schemaVersion: 1`? [Completeness, Spec §FR-012, Contract §json-report]
- [x] CHK002 Are CLI options and MCP input fields documented with matching meanings for `mode`, `baseRef`, `format`, `failOn`, `callerDepth`, `maxCallers`, and `projectPath`? [Consistency, Spec §FR-014, Contract §cli, Contract §mcp]
- [x] CHK003 Are markdown sections and table columns defined for every report area? [Completeness, Spec §FR-013, Contract §cli]
- [x] CHK004 Are CLI exit codes defined for clean, ordinary impact, threshold breach, and unavailable/failed operational states? [Completeness, Spec §FR-016, Contract §cli]

## Requirement Clarity

- [x] CHK005 Is the `failOn` grammar specified without surface-specific variants? [Clarity, Spec §FR-017, Contract §cli, Contract §mcp]
- [x] CHK006 Is the difference between MCP expected-state payloads and MCP tool errors explicitly defined? [Clarity, Spec §FR-015, Contract §mcp]
- [x] CHK007 Are summary status values defined for clean, impact, threshold breach, and unavailable reports? [Clarity, Contract §json-report]
- [x] CHK008 Are shell-sensitive `callers>N` examples quoted so the documented CLI contract is copy-safe? [Clarity, Contract §cli]

## Requirement Consistency

- [x] CHK009 Do CLI and MCP contracts share one report model rather than defining divergent output semantics? [Consistency, Spec §FR-014, Contract §mcp]
- [x] CHK010 Do JSON and markdown requirements represent warnings, unmapped hunks, affected-flow states, risks, and limits consistently? [Consistency, Spec §FR-012, Spec §FR-013, Contract §json-report, Contract §cli]
- [x] CHK011 Is `exitCode: 2` limited to configured threshold breaches across CLI and MCP contracts? [Consistency, Spec §FR-016, Contract §cli, Contract §mcp]

## Acceptance Criteria Quality

- [x] CHK012 Can schema stability be objectively assessed across clean, impact, threshold-breach, stale-index, and flow-unavailable scenarios? [Measurability, Spec §SC-005, Contract §json-report]
- [x] CHK013 Are parity expectations measurable for equivalent CLI JSON and MCP JSON requests? [Measurability, Contract §mcp]

## Gaps

- [x] CHK014 Are there no unresolved API-contract gaps after the checklist review? [Gap Closure]

## Notes

- Result: PASS. No unresolved API-contract requirement gaps remain.
