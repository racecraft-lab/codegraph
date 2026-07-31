# feat(SPEC-013): Add bounded read-only Cypher query access

## Summary

<!-- speckit-pro-editable:summary:start -->
Adds a bounded, deterministic, read-only Cypher subset across the library, CLI, and MCP surfaces, with shared public serialization and fail-closed resource limits.
<!-- speckit-pro-editable:summary:end -->

## What Changed

<!-- speckit-pro-editable:what_changed:start -->
- Implemented MATCH, WHERE, RETURN, aggregation, ordering, pagination, fixed paths, and bounded variable-length paths over the local CodeGraph SQLite index.
- Added library, CLI stdin/flag, MCP tool, documentation, and twelve executable recipe surfaces with byte-identical results.
- Added deterministic codepoint ordering, null-last tuple semantics, worker-enforced timeouts, result caps, stdin byte bounds, and fail-closed path expansion budgets.
- Added comprehensive parser, runtime, CLI, MCP, recipe, and instruction coverage plus SpecKit traceability evidence.
<!-- speckit-pro-editable:what_changed:end -->

## Why It Matters

<!-- speckit-pro-editable:why_it_matters:start -->
Users and coding agents can answer precise structural graph questions through one deterministic local query surface without exposing write capabilities or making network calls.
<!-- speckit-pro-editable:why_it_matters:end -->

## How To Review

- Review src/query/cypher/index.ts by parser, planner, SQL lowering, path expansion, and result-materialization sections; the 4,765-line private runtime is the main reviewability warning.
- Review src/query/cypher/runtime.ts and serializer.ts for worker boundaries, caps, timeout behavior, and public-value parity.
- Review src/bin/codegraph.ts and src/mcp/tools.ts for CLI/MCP routing, stdin limits, and diagnostic parity.
- Use the focused Cypher tests and evidence matrix to trace every functional and safety requirement.

## How To UAT

Build with Node 24.11.1 using npm run build.
Run a documented recipe through the package API, CLI, and MCP tool against the same indexed repository and confirm byte-identical result envelopes.
Run an over-budget variable-length path query and confirm CYPHER_PATH_EXPANSION_LIMIT is returned with no partial rows or leaked SQL.

## UAT Runbook

Build with Node 24.11.1 using npm run build.
Run a documented recipe through the package API, CLI, and MCP tool against the same indexed repository and confirm byte-identical result envelopes.
Run an over-budget variable-length path query and confirm CYPHER_PATH_EXPANSION_LIMIT is returned with no partial rows or leaked SQL.

## Verification

- npm run build — pass under Node 24.11.1.
- npm run typecheck — pass.
- npm test — 266 files passed; 4,839 tests passed and 181 skipped.
- Focused SPEC-013 bundle — 183/183 passed.
- Independent final review — NO FINDINGS.
- Fresh task verification — 79 VERIFIED, 0 flagged.

## Scope

- Read-only Cypher parser, planner, SQLite execution, bounded path expansion, and public serialization.
- Package API, CLI, MCP, docs, recipes, tests, and SpecKit evidence.
- Seven production files; 45 final packet-manifest files; reviewability budget result is warning.

## Known Gaps

- The optional external retrieval A/B evaluation remains BLOCKED_BY_AUTHORIZATION; the provider was never contacted and no repository context was sent.
- src/query/cypher/index.ts is 4,765 lines, so reviewers should use the ordered review guide and internal slice checkpoints.
- The UAT skeleton helper was unavailable; the packet includes executable manual UAT steps derived from the quickstart and verification evidence.
