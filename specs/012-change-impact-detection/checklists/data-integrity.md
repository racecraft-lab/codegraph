# Data Integrity Checklist: Change Impact Detection

**Purpose**: Validate whether SPEC-012 requirements prevent misleading diff-to-symbol, rename, stale-index, and diagnostic reports.
**Created**: 2026-07-15
**Feature**: [spec.md](../spec.md), [data-model.md](../data-model.md), [research.md](../research.md)

**Note**: This checklist tests requirements quality, not implementation behavior.

## Requirement Completeness

- [x] CHK001 Are all four diff modes defined with exact comparison semantics, including untracked-file diagnostics in `all` mode? [Completeness, Spec §FR-001, Research §Decision: Acquire diffs]
- [x] CHK002 Are old path, new path, range, change kind, and rename/deletion context required in changed hunk data? [Completeness, Data Model §ChangedHunk]
- [x] CHK003 Are pure renames/moves required to suppress phantom changed-symbol impact while still representing path changes? [Completeness, Spec §FR-005]
- [x] CHK004 Are renamed files with edited hunks required to preserve real mapped content changes? [Completeness, Spec §FR-006]
- [x] CHK005 Are deleted indexed symbols and deleted-without-span diagnostics both defined? [Coverage, Spec §FR-006, Data Model §ChangedSymbol, Data Model §UnmappedHunk]

## Requirement Clarity

- [x] CHK006 Is hunk-to-symbol mapping defined as indexed span intersection rather than name guessing? [Clarity, Spec §FR-003, Research §Decision: Map hunks]
- [x] CHK007 Are unmapped-hunk reason codes defined with deterministic precedence? [Clarity, Spec §FR-004, Data Model §UnmappedHunk]
- [x] CHK008 Is stale-index behavior defined as visible warning-and-continue rather than silent omission or threshold failure? [Clarity, Spec §FR-007, Research §Decision: Warn and continue]
- [x] CHK009 Is the distinction between unindexed, unsupported, generated, binary, and untracked diagnostics documented? [Clarity, Spec §FR-008, Data Model §UnmappedHunk]

## Requirement Consistency

- [x] CHK010 Do diff mode requirements align across spec, research, CLI contract, and data model? [Consistency, Spec §FR-001, Research, Contract §cli, Data Model §DiffRequest]
- [x] CHK011 Do rename requirements align with the pure-move acceptance scenario and changed-symbol rules? [Consistency, Spec §Acceptance Scenarios, Spec §FR-005, Spec §FR-006]
- [x] CHK012 Do unmapped diagnostics explicitly avoid creating callers, flows, or invented changed-symbol rows? [Consistency, Spec §FR-004, Data Model §UnmappedHunk]

## Scenario Coverage

- [x] CHK013 Are binary, generated, deleted, unsupported, unindexed, untracked, renamed, and stale-index cases all represented in requirements? [Coverage, Spec §Edge Cases, Data Model]
- [x] CHK014 Is self-repo UAT required to cover symbol mapping, unmapped diagnostics, rename behavior, warnings, and exit codes together? [Coverage, Spec §FR-019, Quickstart]

## Gaps

- [x] CHK015 Are there no unresolved data-integrity gaps after the checklist review? [Gap Closure]

## Notes

- Result: PASS. Data-integrity gaps found during checklist prep were resolved in `spec.md`, `data-model.md`, `contracts/cli.md`, and `research.md`.
