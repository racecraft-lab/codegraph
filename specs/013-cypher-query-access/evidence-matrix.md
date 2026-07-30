# Evidence Matrix: SPEC-013 — Cypher Query Access

This matrix records implementation verification evidence for SPEC-013. Rows are
added by the dependent setup, test, implementation, verification, and delivery
tasks.

| id | slice | surface | input | command | expectedState | observedState | parityHash | artifact | reviewer | date |
|---|---|---|---|---|---|---|---|---|---|---|
| FR-001 | Cross-slice | package, CLI, MCP | Placeholder: surface parity and query routing | TBD | TBD | pending | n/a | TBD | autopilot | TBD |
| FR-002 | Cross-slice | package, CLI, MCP | Placeholder: 10000 character input ceiling | TBD | diagnostic | pending | n/a | TBD | autopilot | TBD |
| FR-003 | Slice 1 | package | Placeholder: public virtual schema catalog | TBD | success | pending | n/a | TBD | autopilot | TBD |
| FR-004 | Slice 1 | package | Placeholder: unknown-name diagnostics | TBD | diagnostic | pending | n/a | TBD | autopilot | TBD |
| FR-005 | Slice 1 | package | Placeholder: active relationship filtering | TBD | success | pending | n/a | TBD | autopilot | TBD |
| FR-006 | Slice 1 | package | Placeholder: one connected MATCH chain | TBD | success or diagnostic | pending | n/a | TBD | autopilot | TBD |
| FR-007 | Slice 1 | package | Placeholder: directed relationship syntax | TBD | success or diagnostic | pending | n/a | TBD | autopilot | TBD |
| FR-008 | Slice 1 | package | Placeholder: variable path upper bound | TBD | success or diagnostic | pending | n/a | TBD | autopilot | TBD |
| FR-009 | Slice 1 | package | Placeholder: relationship-simple paths | TBD | success | pending | n/a | TBD | autopilot | TBD |
| FR-010 | Slice 1 | package | Placeholder: ordered typed path evidence | TBD | success | pending | n/a | TBD | autopilot | TBD |
| FR-011 | Cross-slice | package | Placeholder: WHERE null semantics and comparisons | TBD | success | pending | n/a | TBD | autopilot | TBD |
| FR-012 | Slice 2 | package | Placeholder: string predicates | TBD | success | pending | n/a | TBD | autopilot | TBD |
| FR-013 | Slice 1 | package | Placeholder: opaque JSON return-only fields | TBD | success or diagnostic | pending | n/a | TBD | autopilot | TBD |
| FR-014 | Cross-slice | package | Placeholder: keyword and public-name casing | TBD | success or diagnostic | pending | n/a | TBD | autopilot | TBD |
| FR-015 | Slice 2 | package | Placeholder: backtick identifiers | TBD | success or diagnostic | pending | n/a | TBD | autopilot | TBD |
| FR-016 | Slice 1 | package | Placeholder: single-quoted bound literals | TBD | success or diagnostic | pending | n/a | TBD | autopilot | TBD |
| FR-017 | Cross-slice | package | Placeholder: RETURN values and count | TBD | success | pending | n/a | TBD | autopilot | TBD |
| FR-018 | Slice 2 | package | Placeholder: implicit grouping and count only | TBD | success or diagnostic | pending | n/a | TBD | autopilot | TBD |
| FR-019 | Cross-slice | package | Placeholder: ORDER BY LIMIT deterministic order | TBD | success | pending | n/a | TBD | autopilot | TBD |
| FR-020 | Cross-slice | package, CLI, MCP | Placeholder: row caps truncation and payload ceiling | TBD | success or diagnostic | pending | TBD | TBD | autopilot | TBD |
| FR-021 | Slice 1 | package | Placeholder: five-second execution deadline | TBD | timeout | pending | n/a | TBD | autopilot | TBD |
| FR-022 | Cross-slice | CLI, MCP | Placeholder: timeout surface mapping | TBD | timeout | pending | TBD | TBD | autopilot | TBD |
| FR-023 | Cross-slice | package, CLI, MCP | Placeholder: bounded diagnostics and redaction | TBD | diagnostic | pending | n/a | TBD | autopilot | TBD |
| FR-024 | Cross-slice | package | Placeholder: SELECT-only read-only execution | TBD | success or diagnostic | pending | n/a | TBD | autopilot | TBD |
| FR-025 | Cross-slice | CLI | Placeholder: CLI query and search routing | TBD | success or diagnostic | pending | n/a | TBD | autopilot | TBD |
| FR-026 | Cross-slice | CLI, MCP | Placeholder: canonical byte-identical JSON | TBD | success | pending | TBD | TBD | autopilot | TBD |
| FR-027 | Cross-slice | CLI | Placeholder: human table rendering | TBD | success | pending | n/a | TBD | autopilot | TBD |
| FR-028 | Cross-slice | MCP | Placeholder: MCP tool result states and default listing | TBD | success or refusal | pending | TBD | TBD | autopilot | TBD |
| FR-029 | Slice 2 | docs, live UAT | Placeholder: ten documented recipes | TBD | success or empty | pending | TBD | TBD | autopilot | TBD |
| FR-030 | Cross-slice | retrieval | Placeholder: retrieval guardian and A/B gate | TBD | success or blocked | pending | n/a | TBD | autopilot | TBD |
| FR-031 | Slice 1 | package | Placeholder: public queryCypher API and types | TBD | success | pending | n/a | TBD | autopilot | TBD |
| FR-032 | Cross-slice | package, CLI, MCP | Placeholder: two independently demonstrable slices | TBD | success | pending | TBD | TBD | autopilot | TBD |
| SC-001 | Cross-slice | package, CLI, MCP | Placeholder: grammar subset and input ceiling acceptance tests | TBD | success | pending | n/a | TBD | autopilot | TBD |
| SC-002 | Slice 1 | package, CLI, MCP | Placeholder: bounded path demo across surfaces | TBD | success | pending | TBD | TBD | autopilot | TBD |
| SC-003 | Slice 2 | package, CLI, MCP | Placeholder: count string and backtick demo | TBD | success | pending | TBD | TBD | autopilot | TBD |
| SC-004 | Slice 2 | docs, live UAT | Placeholder: live self-index recipes | TBD | success or empty | pending | TBD | TBD | autopilot | TBD |
| SC-005 | Cross-slice | package, CLI, MCP | Placeholder: invalid input and mutation guard probes | TBD | diagnostic | pending | n/a | TBD | autopilot | TBD |
| SC-006 | Cross-slice | CLI, MCP | Placeholder: byte parity states | TBD | success | pending | TBD | TBD | autopilot | TBD |
| SC-007 | Cross-slice | package | Placeholder: default and hard row caps | TBD | success | pending | n/a | TBD | autopilot | TBD |
| SC-008 | Cross-slice | package, CLI, MCP | Placeholder: timeout probe behavior | TBD | timeout | pending | TBD | TBD | autopilot | TBD |
| SC-009 | Cross-slice | retrieval | Placeholder: retrieval regression review and A/B disposition | TBD | success or blocked | pending | n/a | TBD | autopilot | TBD |
| SC-010 | Cross-slice | package | Placeholder: representative query-plan performance probes | TBD | success or diagnostic | pending | n/a | TBD | autopilot | TBD |
| RECIPE-001 | Slice 1 | package, CLI, MCP | callers query placeholder | TBD | success or empty | pending | TBD | docs/ai/specs/013-cypher-query-access-recipes.md | autopilot | TBD |
| RECIPE-002 | Slice 1 | package, CLI, MCP | bounded path query placeholder | TBD | success or empty | pending | TBD | docs/ai/specs/013-cypher-query-access-recipes.md | autopilot | TBD |
| RECIPE-003 | Slice 2 | package, CLI, MCP | hub query placeholder | TBD | success or empty | pending | TBD | docs/ai/specs/013-cypher-query-access-recipes.md | autopilot | TBD |
| RECIPE-004 | Slice 2 | package, CLI, MCP | dead export query placeholder | TBD | success or empty | pending | TBD | docs/ai/specs/013-cypher-query-access-recipes.md | autopilot | TBD |
| RECIPE-005 | Slice 2 | package, CLI, MCP | count grouping query placeholder | TBD | success or empty | pending | TBD | docs/ai/specs/013-cypher-query-access-recipes.md | autopilot | TBD |
| RECIPE-006 | Slice 2 | package, CLI, MCP | string predicate query placeholder | TBD | success or empty | pending | TBD | docs/ai/specs/013-cypher-query-access-recipes.md | autopilot | TBD |
| RECIPE-007 | Slice 2 | package, CLI, MCP | backtick identifier query placeholder | TBD | success or empty | pending | TBD | docs/ai/specs/013-cypher-query-access-recipes.md | autopilot | TBD |
| RECIPE-008 | Slice 1 | package, CLI, MCP | row cap query placeholder | TBD | success | pending | TBD | docs/ai/specs/013-cypher-query-access-recipes.md | autopilot | TBD |
| RECIPE-009 | Slice 1 | package, CLI, MCP | path cap query placeholder | TBD | diagnostic | pending | TBD | docs/ai/specs/013-cypher-query-access-recipes.md | autopilot | TBD |
| RECIPE-010 | Cross-slice | CLI, MCP | CLI MCP parity query placeholder | TBD | success | pending | TBD | docs/ai/specs/013-cypher-query-access-recipes.md | autopilot | TBD |
| GUARD-READONLY | Cross-slice | package | read-only invariant placeholder | TBD | success | pending | n/a | TBD | autopilot | TBD |
| GUARD-MUTATION-REJECT | Cross-slice | package, CLI, MCP | mutating syntax rejection placeholder | TBD | diagnostic | pending | n/a | TBD | autopilot | TBD |
| GUARD-OVERSIZE-INPUT | Cross-slice | package, CLI, MCP | oversized input placeholder | TBD | diagnostic | pending | n/a | TBD | autopilot | TBD |
| GUARD-MALFORMED-STDIN | Cross-slice | CLI | malformed stdin placeholder | TBD | diagnostic | pending | n/a | TBD | autopilot | TBD |
| GUARD-TIMEOUT | Cross-slice | package, CLI, MCP | timeout cleanup placeholder | TBD | timeout | pending | TBD | TBD | autopilot | TBD |
| GUARD-PAYLOAD-CEILING | Cross-slice | package, CLI, MCP | payload ceiling placeholder | TBD | diagnostic | pending | TBD | TBD | autopilot | TBD |
| PERF-VAR-PATH | Slice 1 | package | EXPLAIN variable path placeholder | TBD | success or timeout | pending | n/a | TBD | autopilot | TBD |
| PERF-STABLE-ORDER | Cross-slice | package | EXPLAIN stable ordering placeholder | TBD | success | pending | n/a | TBD | autopilot | TBD |
| PERF-COUNT-GROUP | Slice 2 | package | EXPLAIN count grouping placeholder | TBD | success | pending | n/a | TBD | autopilot | TBD |
| PERF-CAP-PLUS-ONE | Cross-slice | package | EXPLAIN cap plus one placeholder | TBD | success | pending | n/a | TBD | autopilot | TBD |
| PERF-PAYLOAD-CEILING | Cross-slice | package | EXPLAIN payload ceiling placeholder | TBD | diagnostic | pending | n/a | TBD | autopilot | TBD |
| PERF-TIMEOUT | Cross-slice | package | EXPLAIN timeout envelope placeholder | TBD | timeout | pending | n/a | TBD | autopilot | TBD |
| RETRIEVAL-GUARDIAN | Cross-slice | retrieval | retrieval guardian review placeholder | TBD | success | pending | n/a | TBD | autopilot | TBD |
| RETRIEVAL-AB-AUTH | Cross-slice | retrieval | off-box A/B authorization gate placeholder | TBD | blocked unless authorized | pending | n/a | TBD | autopilot | TBD |
| PR-REVIEW-PACKET | Cross-slice | PR | PR review packet evidence placeholder | TBD | success | pending | n/a | TBD | autopilot | TBD |
| G5-ATOMICITY-ROUTE | Cross-slice | PR | feature_dir specs/013-cypher-query-access | speckit_pro_runner atomicity-route read_only | route decision | route=one-navigable-PR; releasable=true; signals=change-shape:modify-heavy; warnings=none | n/a | runner stdout_json captured by T003 | autopilot | 2026-07-30 |
| G5-SPLIT-PR-BRANCHES | Cross-slice | PR | route one-navigable-PR | conditional T004 disposition | not applicable | split-PR branch creation skipped; gh stack submit/view targets not applicable because route=one-navigable-PR | n/a | branch/worktree pre/post checks | autopilot | 2026-07-30 |
| G5-ONE-PR-DELIVERY | Cross-slice | PR | branch 013-cypher-query-access | conditional T005 disposition | one PR | delivery uses one PR from 013-cypher-query-access; gh-stack proof not applicable; Slice 1 checkpoint mandatory; Slice 2 checkpoint mandatory | n/a | branch/worktree pre/post checks | autopilot | 2026-07-30 |
| T006-FILE-SET | Cross-slice | scope | 16 repo-relative planned paths | file-set baseline check | scope baseline | planAgreement=true; pathCount=16; plannedAbsent=8; modifiedPresent=7; evidencePresent=1; mismatches=0; outOfScope=0 | n/a | plan.md and tasks.md declarations | autopilot | 2026-07-30 |
| T007-REVIEWABILITY-DECISION | Cross-slice | scope | pre-implementation reviewability baseline | reviewability decision check | proceed | proceed; scopeBaseline=16/16; mismatches=0; planEstimator=pass 280 advisory LOC 7 production entries; setupWarn=accepted; slices=2 internal; route=one-navigable-PR; tasksMode=deferred; correctnessBlocks=0; markerPlan=notRequired | n/a | workflow reviewability section and T006 baseline | autopilot | 2026-07-30 |
| T012-EVIDENCE-RED | Cross-slice | tests | bounded/redacted RED story test inputs; no query output | env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npx vitest run __tests__/cypher-parser.test.ts __tests__/cypher-runtime.test.ts __tests__/cli-query-command.test.ts __tests__/mcp-cypher-query.test.ts __tests__/cypher-recipes.test.ts | expected failure before implementation | pending — command category recorded only; no result claimed | n/a | TBD | autopilot | TBD |
| T012-EVIDENCE-GREEN | Cross-slice | tests | bounded/redacted GREEN implementation inputs; no query output | env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npx vitest run __tests__/cypher-parser.test.ts __tests__/cypher-runtime.test.ts __tests__/cli-query-command.test.ts __tests__/mcp-cypher-query.test.ts __tests__/cypher-recipes.test.ts | expected pass after implementation | pending — command category recorded only; no result claimed | n/a | TBD | autopilot | TBD |
| T012-EVIDENCE-FOCUSED | Cross-slice | tests | bounded/redacted focused harness inputs; no query output | env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npx vitest run __tests__/cypher-runtime.test.ts __tests__/cli-query-command.test.ts __tests__/mcp-cypher-query.test.ts __tests__/cypher-recipes.test.ts | focused harness pass expected | pending — command category recorded only; no result claimed | n/a | TBD | autopilot | TBD |
| T012-EVIDENCE-FULL | Cross-slice | tests | bounded/redacted full validation commands; no query output | env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npm run build<br>env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npm run typecheck<br>env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin npm test | full validation pass expected | pending — command category recorded only; no result claimed | n/a | TBD | autopilot | TBD |
| T012-EVIDENCE-LIVE | Cross-slice | live UAT | bounded/redacted live self-index query slots; no live execution in T012 | env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin node dist/bin/codegraph.js status . --json<br>env PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin node dist/bin/codegraph.js query "<redacted bounded MATCH recipe>" --json<br>codegraph_query query=<redacted bounded MATCH recipe> projectPath=. | success or empty when live UAT is authorized and run | pending — command category recorded only; no result claimed | TBD | TBD | autopilot | TBD |
