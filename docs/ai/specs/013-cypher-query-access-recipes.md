# SPEC-013 Cypher Query Access Recipes

This document is the Slice 2 recipe packet for the supported CodeGraph Cypher subset.
Each recipe is runnable through the package API, CLI, and MCP where the listed surface
applies. Live self-index evidence, reviewer/date attribution, byte hashes, artifacts,
and representative outputs are intentionally left as explicit pending evidence labels
for T057, T073, T075, and T076; no live result has been fabricated here.

Use `{projectRoot}` for an initialized CodeGraph project path and `{query}` for the
literal query in the recipe. CLI row limits for Cypher stay inside the query text.

## RECIPE-001 - Callers of a Function
- Category: callers of a function
- Query: `MATCH (caller:function)-[:calls]->(target:function) RETURN caller.name, target.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (caller:function)-[:calls]->(target:function) RETURN caller.name, target.name LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (caller:function)-[:calls]->(target:function) RETURN caller.name, target.name LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (caller:function)-[:calls]->(target:function) RETURN caller.name, target.name LIMIT 10" })`
- Expected state: success or empty
- Representative output: Pending T057/T075 live self-index run; expected success shape has `columns` for `caller.name` and `target.name`, `rows`, `effectiveCap`, and `truncated`.
- Expected-empty reason: The indexed project may have no active `calls` edge into the target function, or the graph may contain only isolated functions.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073/T075 validation date.

## RECIPE-002 - Bounded Path Between Functions
- Category: bounded path between functions
- Query: `MATCH p = (source:function)-[:calls*1..3]->(target:function) RETURN p LIMIT 5`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH p = (source:function)-[:calls*1..3]->(target:function) RETURN p LIMIT 5")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH p = (source:function)-[:calls*1..3]->(target:function) RETURN p LIMIT 5" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH p = (source:function)-[:calls*1..3]->(target:function) RETURN p LIMIT 5" })`
- Expected state: success or empty
- Representative output: Pending T057/T075 live self-index run; expected success rows contain typed `path` values with ordered nodes and relationships.
- Expected-empty reason: No active call chain of length one through three may connect indexed functions in the selected project.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073/T075 validation date.

## RECIPE-003 - Hubs by Count
- Category: hubs by count
- Query: `MATCH (caller:function)-[:calls]->(target:function) RETURN target.name, count(caller) AS callers ORDER BY callers DESC LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (caller:function)-[:calls]->(target:function) RETURN target.name, count(caller) AS callers ORDER BY callers DESC LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (caller:function)-[:calls]->(target:function) RETURN target.name, count(caller) AS callers ORDER BY callers DESC LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (caller:function)-[:calls]->(target:function) RETURN target.name, count(caller) AS callers ORDER BY callers DESC LIMIT 10" })`
- Expected state: success or empty
- Representative output: Pending T057/T075 live self-index run; expected success rows contain scalar `target.name` and aggregate scalar `callers`, ordered descending.
- Expected-empty reason: Empty rows are valid when the project has no active function call relationships.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073/T075 validation date.

## RECIPE-004 - Potentially Dead Exports
- Category: potentially dead exports
- Query: `MATCH (n:function) WHERE n.isExported = true RETURN n.name, n.filePath LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (n:function) WHERE n.isExported = true RETURN n.name, n.filePath LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (n:function) WHERE n.isExported = true RETURN n.name, n.filePath LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (n:function) WHERE n.isExported = true RETURN n.name, n.filePath LIMIT 10" })`
- Expected state: success or empty
- Representative output: Pending T057/T075 live self-index run; expected success rows contain exported function names and file paths.
- Expected-empty reason: Empty rows mean the selected index has no exported functions mapped with `isExported = true`; this is not a query failure.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073/T075 validation date.

## RECIPE-005 - Route Component Neighborhood
- Category: route/component neighborhood
- Query: `MATCH (route:route)-[:references]->(component:component) RETURN route.name, component.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (route:route)-[:references]->(component:component) RETURN route.name, component.name LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (route:route)-[:references]->(component:component) RETURN route.name, component.name LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (route:route)-[:references]->(component:component) RETURN route.name, component.name LIMIT 10" })`
- Expected state: success or empty
- Representative output: Pending T057/T075 live self-index run; expected success rows connect indexed route nodes to component nodes.
- Expected-empty reason: Many repositories do not expose route/component public labels or active `references` relationships; empty rows are expected in those projects.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073/T075 validation date.

## RECIPE-006 - Imports by Module
- Category: imports by module
- Query: `MATCH (source:module)-[:imports]->(target:module) RETURN source.name, target.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (source:module)-[:imports]->(target:module) RETURN source.name, target.name LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (source:module)-[:imports]->(target:module) RETURN source.name, target.name LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (source:module)-[:imports]->(target:module) RETURN source.name, target.name LIMIT 10" })`
- Expected state: success or empty
- Representative output: Pending T057/T075 live self-index run; expected success rows list module import pairs.
- Expected-empty reason: Empty rows are valid when module nodes or active `imports` relationships are not present in the selected index.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073/T075 validation date.

## RECIPE-007 - Async Function Callers
- Category: async function callers
- Query: `MATCH (caller:function)-[:calls]->(target:function) WHERE caller.isAsync = true RETURN caller.name, target.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (caller:function)-[:calls]->(target:function) WHERE caller.isAsync = true RETURN caller.name, target.name LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (caller:function)-[:calls]->(target:function) WHERE caller.isAsync = true RETURN caller.name, target.name LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (caller:function)-[:calls]->(target:function) WHERE caller.isAsync = true RETURN caller.name, target.name LIMIT 10" })`
- Expected state: success or empty
- Representative output: Pending T057/T075 live self-index run; expected success rows contain async caller names and their targets.
- Expected-empty reason: The project may contain no async functions, or async functions may have no active call edges.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073/T075 validation date.

## RECIPE-008 - Heuristic Edge Review
- Category: heuristic edge review
- Query: `MATCH (source:function)-[edge:calls]->(target:function) WHERE edge.provenance = 'heuristic' RETURN source.name, target.name, edge.provenance LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (source:function)-[edge:calls]->(target:function) WHERE edge.provenance = 'heuristic' RETURN source.name, target.name, edge.provenance LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (source:function)-[edge:calls]->(target:function) WHERE edge.provenance = 'heuristic' RETURN source.name, target.name, edge.provenance LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (source:function)-[edge:calls]->(target:function) WHERE edge.provenance = 'heuristic' RETURN source.name, target.name, edge.provenance LIMIT 10" })`
- Expected state: success or empty
- Representative output: Pending T057/T075 live self-index run; expected success rows identify heuristic `calls` edges for review.
- Expected-empty reason: Empty rows are expected when the index contains only static or LSP call provenance, or no matching call edges.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073/T075 validation date.

## RECIPE-009 - File-Local Relationship Summary
- Category: file-local relationship summary
- Query: `MATCH (source:function)-[:calls]->(target:function) WHERE source.filePath = target.filePath RETURN source.name, target.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (source:function)-[:calls]->(target:function) WHERE source.filePath = target.filePath RETURN source.name, target.name LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (source:function)-[:calls]->(target:function) WHERE source.filePath = target.filePath RETURN source.name, target.name LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (source:function)-[:calls]->(target:function) WHERE source.filePath = target.filePath RETURN source.name, target.name LIMIT 10" })`
- Expected state: success or empty
- Representative output: Pending T057/T075 live self-index run; expected success rows summarize same-file caller and target pairs.
- Expected-empty reason: Empty rows are valid when calls cross file boundaries or no active calls exist within one file.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073/T075 validation date.

## RECIPE-010 - Source-Position Filtered Relationship Review
- Category: source-position filtered relationship review
- Query: `MATCH (source:function)-[:calls]->(target:function) WHERE source.startLine >= 1 RETURN source.filePath, source.startLine, target.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (source:function)-[:calls]->(target:function) WHERE source.startLine >= 1 RETURN source.filePath, source.startLine, target.name LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (source:function)-[:calls]->(target:function) WHERE source.startLine >= 1 RETURN source.filePath, source.startLine, target.name LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (source:function)-[:calls]->(target:function) WHERE source.startLine >= 1 RETURN source.filePath, source.startLine, target.name LIMIT 10" })`
- Expected state: success or empty
- Representative output: Pending T057/T075 live self-index run; expected success rows include source file path, source start line, and target name.
- Expected-empty reason: Empty rows are valid when no active call edge has a source function with a mapped source location.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073/T075 validation date.

## RECIPE-011 - String Predicate Expected-Empty Check
- Category: string predicate expected-empty example
- Query: `MATCH (caller:function)-[:calls]->(target:function) WHERE caller.name STARTS WITH 'recipeNoMatch' RETURN caller.name AS callerName, target.name AS targetName ORDER BY callerName ASC, targetName ASC LIMIT 5`
- Surfaces: package, CLI, MCP, docs
- Package API command: `await queryCypher(projectRoot, "MATCH (caller:function)-[:calls]->(target:function) WHERE caller.name STARTS WITH 'recipeNoMatch' RETURN caller.name AS callerName, target.name AS targetName ORDER BY callerName ASC, targetName ASC LIMIT 5")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (caller:function)-[:calls]->(target:function) WHERE caller.name STARTS WITH 'recipeNoMatch' RETURN caller.name AS callerName, target.name AS targetName ORDER BY callerName ASC, targetName ASC LIMIT 5" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (caller:function)-[:calls]->(target:function) WHERE caller.name STARTS WITH 'recipeNoMatch' RETURN caller.name AS callerName, target.name AS targetName ORDER BY callerName ASC, targetName ASC LIMIT 5" })`
- Expected state: empty
- Representative output: Pending T057/T073 fixture transcript; expected canonical success JSON has `rows: []`.
- Expected-empty reason: The `recipeNoMatch` prefix is deliberately selected to produce an expected-empty success state while exercising `STARTS WITH`.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073 validation date.

## RECIPE-012 - Backtick Identifier and Alias Check
- Category: backtick identifier example
- Query: `MATCH (`call``er`:`function`)-[:`calls`]->(`target-node`:`function`) WHERE `call``er`.name = 'entry' RETURN `call``er`.name AS `caller``name`, `target-node`.`name` AS `target-name` ORDER BY `target-name` ASC LIMIT 1`
- Surfaces: package, CLI, MCP, docs
- Package API command: `await queryCypher(projectRoot, "MATCH (`call``er`:`function`)-[:`calls`]->(`target-node`:`function`) WHERE `call``er`.name = 'entry' RETURN `call``er`.name AS `caller``name`, `target-node`.`name` AS `target-name` ORDER BY `target-name` ASC LIMIT 1")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (`call``er`:`function`)-[:`calls`]->(`target-node`:`function`) WHERE `call``er`.name = 'entry' RETURN `call``er`.name AS `caller``name`, `target-node`.`name` AS `target-name` ORDER BY `target-name` ASC LIMIT 1" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (`call``er`:`function`)-[:`calls`]->(`target-node`:`function`) WHERE `call``er`.name = 'entry' RETURN `call``er`.name AS `caller``name`, `target-node`.`name` AS `target-name` ORDER BY `target-name` ASC LIMIT 1" })`
- Expected state: success or empty
- Representative output: Pending T057/T073 fixture transcript; expected columns preserve unescaped alias names such as `caller``name` and `target-name`.
- Expected-empty reason: Empty rows are valid when the selected fixture or live project has no `entry` caller with an active `calls` edge.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073 validation date.

## GUARD-ROW-CAP - Default Row Cap and Truncation Flag
- Input: `MATCH (n:function) RETURN n.name`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (n:function) RETURN n.name")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (n:function) RETURN n.name" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (n:function) RETURN n.name" })`
- Expected state: success
- Expected code: n/a
- Representative output: Pending T057/T075 live self-index run; expected `effectiveCap` reflects the default cap and `truncated` reports whether more than the cap was available.
- Expected-empty reason: Empty rows are not the target condition for this guard; if seen, the project likely has no indexed function nodes.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073/T075 validation date.

## GUARD-PATH-CAP - Bounded Variable Path Traversal
- Input: `MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5" })`
- Expected state: success
- Expected code: n/a
- Representative output: Pending T057/T075 live self-index run; expected rows contain paths no deeper than three relationships and no more than five public rows.
- Expected-empty reason: Empty rows are valid only when no active one-to-three-hop call path exists.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073/T075 validation date.

## GUARD-TIMEOUT - Five-Second Timeout Guidance
- Input: `MATCH p = (a:function)-[:calls*1..10]->(b:function) RETURN p`
- Surfaces: package, CLI, MCP, docs
- Package API command: `await queryCypher(projectRoot, "MATCH p = (a:function)-[:calls*1..10]->(b:function) RETURN p")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH p = (a:function)-[:calls*1..10]->(b:function) RETURN p" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH p = (a:function)-[:calls*1..10]->(b:function) RETURN p" })`
- Expected state: timeout
- Expected code: CYPHER_TIMEOUT; planning label CYPHER_QUERY_TIMEOUT
- Representative output: Pending T057/T073 guard transcript; expected timeout JSON contains `status: "timeout"`, `code: "CYPHER_TIMEOUT"`, `deadlineMs: 5000`, and guidance to narrow relationship depth or add `LIMIT`.
- Expected-empty reason: Not applicable; timeout guards should return timeout, not empty success.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073 validation date.

## GUARD-READ-ONLY - Unsupported Write Clause Rejection
- Input: `MATCH (n) DELETE n RETURN n`
- Surfaces: package, CLI, MCP, docs
- Package API command: `await queryCypher(projectRoot, "MATCH (n) DELETE n RETURN n")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (n) DELETE n RETURN n" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (n) DELETE n RETURN n" })`
- Expected state: diagnostic
- Expected code: CYPHER_UNSUPPORTED; planning label CYPHER_UNSUPPORTED_CLAUSE
- Representative output: Pending T057/T073 guard transcript; expected diagnostic JSON is success-shaped for MCP and failure-exit for CLI without database mutation.
- Expected-empty reason: Not applicable; write-clause probes should be rejected before execution.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073 validation date.

## GUARD-MALFORMED-STDIN - Malformed UTF-8 Stdin Rejection
- Input: `printf malformed UTF-8 bytes to codegraph query - --json`
- Surfaces: CLI, docs
- Package API command: Not applicable; this guard targets CLI stdin decoding before package API invocation.
- CLI --json command: `printf '<malformed-utf8-bytes>' | node dist/bin/codegraph.js query - --json --path {projectRoot}`
- MCP text command: Not applicable; MCP receives structured UTF-8 JSON arguments instead of raw stdin bytes.
- Expected state: diagnostic
- Expected code: CYPHER_INVALID_STDIN_ENCODING
- Representative output: Pending T057/T073 guard transcript; expected diagnostic JSON has no raw malformed byte echo and no partial rows.
- Expected-empty reason: Not applicable; malformed input must be diagnostic, not empty success.
- Parity hash: Pending T073 evidence note; no CLI-MCP byte parity is applicable for raw stdin-only malformed bytes.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073 validation date.

## GUARD-PAYLOAD-CEILING - Canonical Payload Ceiling Diagnostic
- Input: `MATCH (n:function) RETURN n`
- Surfaces: package, CLI, MCP, docs
- Package API command: `await queryCypher(projectRoot, "MATCH (n:function) RETURN n")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (n:function) RETURN n" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (n:function) RETURN n" })`
- Expected state: diagnostic
- Expected code: CYPHER_OUTPUT_TOO_LARGE
- Representative output: Pending T057/T073 guard transcript; expected diagnostic JSON contains no partial `rows` when canonical bytes exceed the 1 MiB ceiling.
- Expected-empty reason: Empty rows are not the target condition; this guard requires a fixture or live index large enough to exceed the payload limit.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073 validation date.

## GUARD-CLI-MCP-PARITY - Byte-Identical CLI and MCP JSON
- Input: `MATCH (n:function) RETURN n.name ORDER BY n.name LIMIT 5`
- Surfaces: CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (n:function) RETURN n.name ORDER BY n.name LIMIT 5")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (n:function) RETURN n.name ORDER BY n.name LIMIT 5" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (n:function) RETURN n.name ORDER BY n.name LIMIT 5" })`
- Expected state: success
- Expected code: n/a
- Representative output: Pending T057/T075 live self-index run; expected CLI stdout bytes must equal MCP text bytes exactly with no trailing newline.
- Expected-empty reason: Empty rows are acceptable only if the live index has no function nodes; parity still compares identical canonical success JSON.
- Parity hash: Pending T057/T076 CLI-MCP byte comparison.
- Artifact: Pending T073 evidence-matrix artifact path.
- Reviewer: Pending T073 review owner.
- Date: Pending T073/T075 validation date.
