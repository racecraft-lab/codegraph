# API Contract Requirements Quality Checklist

**Purpose**: Review whether SPEC-009's protocol requirements are complete,
clear, consistent, measurable, and implementation-ready.
**Created**: 2026-07-16
**Audience**: Pull-request reviewer before Tasks
**Depth**: Standard release gate

## Capability and Lifecycle Completeness

- [x] CHK001 Are all advertised capabilities and intentional omissions explicitly documented? [Completeness, Spec §FR-006, Contract §Initialize]
- [x] CHK002 Are initialize root precedence, validation of every supplied signal, absent-root behavior, and multi-root rejection unambiguous? [Clarity, Spec §FR-003–FR-004]
- [x] CHK003 Are lifecycle states, allowed messages, state-specific errors, and exit statuses defined for pre-initialize through termination? [Completeness, Spec §FR-005, Contract §Lifecycle]
- [x] CHK004 Are request and notification rules consistent with the read allowlist and no-response notification constraint? [Consistency, Spec §FR-023–FR-024]
- [x] CHK005 Is unsupported batch behavior explicitly defined rather than left to transport interpretation? [Completeness, Contract §Transport-Neutral Envelope]

## Method Shape and Result Semantics

- [x] CHK006 Are exact params and result/null shapes documented for definition, references, hover, document symbols, and workspace symbols? [Completeness, Contract §Read Allowlist]
- [x] CHK007 Is definition limited to one exact declaration location with same-target duplicate collapse and distinct-target ambiguity behavior? [Clarity, Spec §FR-008–FR-010]
- [x] CHK008 Are reference occurrence ranges, `includeDeclaration`, containment exclusion, identity, order, and 500-result cap jointly specified? [Completeness, Spec §FR-011]
- [x] CHK009 Is bounded hover content distinguished from source excerpts and from an absent result? [Clarity, Spec §FR-012]
- [x] CHK010 Are document hierarchy, parent-before-child order, orphan-free truncation, and cap requirements consistent? [Consistency, Spec §FR-013]
- [x] CHK011 Are workspace rank preservation and every deterministic tie-break key specified before the 100-result cap? [Measurability, Spec §FR-014]
- [x] CHK012 Are zero-based half-open UTF-16 ranges, overlong incoming character normalization, and fail-closed outgoing conversion defined? [Clarity, Spec §FR-015, Contract §Position Contract]

## Custom Content Extension

- [x] CHK013 Is the custom method explicitly distinguished from LSP 3.18's standardized text-only content request? [Consistency, Spec §FR-016]
- [x] CHK014 Are request and response fields, types, source byte cap, indexed hash semantics, and snapshot-token invariants complete? [Completeness, Spec §FR-016–FR-017]
- [x] CHK015 Are malformed, stale, and valid-but-unavailable source failures mapped to exact codes and a closed redacted reason vocabulary? [Clarity, Spec §FR-020, Contract §Error Vocabulary]
- [x] CHK016 Are snapshot tokens explicitly excluded from URLs/logs and described as opaque equality-only values? [Coverage, Spec §FR-017]

## Cross-Boundary Consistency

- [x] CHK017 Is one shared dispatcher required to produce equivalent method and error semantics on stdio and WebSocket? [Consistency, Spec §FR-022]
- [x] CHK018 Is the daemon read vocabulary closed, read-only, and sufficient for cursor, reference, symbol, metadata, and trusted-content results? [Completeness, Plan §Source Authority and Position Algorithm]
- [x] CHK019 Are daemon operational failures distinguishable from client-invalid params without leaking transport-specific details? [Clarity, Contract §Error Vocabulary, Spec §FR-021]
- [x] CHK020 Is every response ordering/cap rule applied before transport serialization so both transports are byte-stable? [Consistency, Spec §SC-002–SC-004]

## Acceptance and Exclusion Quality

- [x] CHK021 Are exact-evidence no-result cases measurable across declaration, located occurrence, overlap, Unicode, and missing-range scenarios? [Acceptance Criteria, Spec §SC-003–SC-005]
- [x] CHK022 Are mutation, diagnostics, synchronization, indexing, and external-language-server paths explicitly outside the dispatch contract? [Coverage, Spec §Out of Scope]
- [x] CHK023 Are generic-client and transport-parity success criteria traceable to the method contract and declared black-box evidence? [Traceability, Spec §SC-001–SC-002, §SC-011]
- [x] CHK024 Are public custom-extension/versioning expectations bounded to v1 without implying support for future standard-method parity? [Assumption, Contract §`codegraph/textDocumentContent`]

## Assessment

All 24 API-contract requirements-quality items pass. No `[Gap]` marker is
required. Implementation tests remain Phase 7 work; this checklist assesses the
written contract only.
