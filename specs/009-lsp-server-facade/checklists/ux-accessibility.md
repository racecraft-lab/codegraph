# UX and Accessibility Requirements Quality Checklist

**Purpose**: Review whether the focused source-viewer requirements are complete,
accessible, privacy-safe, and resilient without becoming an editor workspace.
**Created**: 2026-07-16
**Audience**: Product/accessibility pull-request reviewer before Tasks
**Depth**: Standard release gate

## Information Architecture and Scope

- [x] CHK001 Is the viewer explicitly an additive focused pane inside symbol detail rather than a replacement route or tabbed workspace? [Clarity, Spec §FR-033, §Out of Scope]
- [x] CHK002 Are existing symbol metadata and relationship panels required to remain usable in every source failure? [Completeness, Spec §FR-039, §SC-009]
- [x] CHK003 Are source and language-intelligence acquisition paths limited to the LSP content/read contract? [Consistency, Spec §FR-034]
- [x] CHK004 Are tabs, editing, diagnostics, workspace chrome, and background reconnect explicitly excluded? [Coverage, Spec §Out of Scope, §FR-040–FR-041]

## Source Interaction Clarity

- [x] CHK005 Is one single-tab-stop read-only composite with one programmatic active token specified without requiring a particular inaccessible widget role? [Clarity, Spec §FR-035, Contract §Source Composite]
- [x] CHK006 Are pointer and keyboard required to share the same exact UTF-16 token mapping? [Consistency, Spec §FR-035]
- [x] CHK007 Are named hover and definition actions, deliberate pointer activation, Enter behavior, visible focus, and no-result behavior defined? [Completeness, Spec §FR-035–FR-036]
- [x] CHK008 Are hover association, focus/pointer activation, persistence, dismissal, bounded content, and non-modal behavior documented? [Coverage, Spec §FR-035, Contract §Source Composite]
- [x] CHK009 Are hover debounce/latest-wins requirements quantified enough to avoid request-slot exhaustion? [Measurability, Plan §Frozen Operational Limits]
- [x] CHK010 Are ordinary Tab/scroll/navigation keys protected from editor-like key hijacking? [Accessibility, Contract §Source Composite]

## Navigation and References

- [x] CHK011 Is privacy-safe URL state complete, including repo identity, relative path, full UTF-16 range, and forbidden values? [Completeness, Spec §FR-036]
- [x] CHK012 Are initial/fallback replace, explicit navigation push, and POP restoration semantics unambiguous? [Clarity, Spec §FR-036]
- [x] CHK013 Are traversal, malformed/reversed range, and repository-mismatch fallback requirements documented? [Coverage, Spec §FR-036]
- [x] CHK014 Are reference headings, counts, server ordering, semantic controls, accessible names, and navigation behavior specified? [Completeness, Spec §FR-037]
- [x] CHK015 Is focus after source/reference/definition navigation predictable without forcing focus merely for status announcements? [Consistency, Spec §FR-035–FR-039]

## Degradation and Recovery

- [x] CHK016 Are dormant, connecting, loading, ready, empty, stale, unavailable, timed-out, disconnected, and retry states mapped to distinct triggers? [Completeness, Spec §FR-038]
- [x] CHK017 Are every typed source-failure reason given truthful safe unavailable semantics rather than empty content? [Consistency, Spec §FR-038]
- [x] CHK018 Are stale re-index requirements, manual retry ownership, fresh-connection behavior, and no auto-reconnect explicit? [Clarity, Spec §FR-039–FR-040]
- [x] CHK019 Are generation guards defined across location, history, retry, repo, and pane lifecycle, including late-result discard? [Coverage, Spec §FR-040]
- [x] CHK020 Is old content prohibited from appearing as a newly failed location? [Edge Case, Spec §FR-039]

## Accessible Status and Layout

- [x] CHK021 Are persistent polite status, one-time actionable alert, hover-noise suppression, and no-focus-move announcement rules defined? [Accessibility, Spec §FR-038]
- [x] CHK022 Are Retry/source focus retention and deterministic focus return requirements complete? [Accessibility, Spec §FR-039]
- [x] CHK023 Are narrow-layout scrolling, visible focus, semantic controls, and reduced-motion usability specified? [Coverage, Spec §FR-041]
- [x] CHK024 Is keyboard-only completion objectively measurable across source, hover, definition, references, retry, and history? [Acceptance Criteria, Spec §SC-008]
- [x] CHK025 Are package/offline and socket-dormancy outcomes included so UI requirements do not imply hidden external/background activity? [Non-Functional, Spec §FR-040, §SC-010–SC-011]

## Assessment

All 25 UX/accessibility requirements-quality items pass. No `[Gap]` marker is
required. Component/ARIA realization remains a Plan/implementation choice only
where the written behavior is already fixed.
