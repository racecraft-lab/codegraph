# SPEC-013 Cypher Query Access Recipes

This document is the Slice 2 recipe packet for the supported CodeGraph Cypher subset.
Each recipe is runnable through the package API, CLI, and MCP where the listed surface
applies. Evidence below is reconciled from the SPEC-013 evidence matrix, the T075 live
self-index UAT, the T076 parity/recipe probe, and the T079 incoming-edge plan probe.

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
- Representative output: T076 live self-index success; rows=10, effectiveCap=10, truncated=true; first collectModuleControllers -> classNameAfter; bytes=1306; package=CLI=MCP.
- Expected-empty reason: Empty remains valid for projects with no active `calls` edge into a target function.
- Parity hash: 7648a2462cf91f219ed0279cd14628b7b28bc8fb4134759714364fce166235d0
- Artifact: T076-PARITY-AND-RECIPES in `specs/013-cypher-query-access/evidence-matrix.md`
- Reviewer: spec013_t076
- Date: 2026-07-30

## RECIPE-002 - Bounded Path Between Functions
- Category: bounded path between functions
- Query: `MATCH p = (source:function)-[:calls*1..3]->(target:function) RETURN p LIMIT 5`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH p = (source:function)-[:calls*1..3]->(target:function) RETURN p LIMIT 5")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH p = (source:function)-[:calls*1..3]->(target:function) RETURN p LIMIT 5" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH p = (source:function)-[:calls*1..3]->(target:function) RETURN p LIMIT 5" })`
- Expected state: success or empty
- Representative output: T076 live self-index success; rows=5, effectiveCap=5, truncated=true; first path length=1 test_invalid_email_no_domain -> validate_email via calls; bytes=9658; package=CLI=MCP.
- Expected-empty reason: Empty remains valid when no active call chain of length one through three connects indexed functions.
- Parity hash: 103fe5607eadf3eca8d2bc2ab774157c41a30ab72e6a9d52594e644055644a00
- Artifact: T076-PARITY-AND-RECIPES in `specs/013-cypher-query-access/evidence-matrix.md`
- Reviewer: spec013_t076
- Date: 2026-07-30

## RECIPE-003 - Hubs by Count
- Category: hubs by count
- Query: `MATCH (caller:function)-[:calls]->(target:function) RETURN target.name, count(caller) AS callers ORDER BY callers DESC LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (caller:function)-[:calls]->(target:function) RETURN target.name, count(caller) AS callers ORDER BY callers DESC LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (caller:function)-[:calls]->(target:function) RETURN target.name, count(caller) AS callers ORDER BY callers DESC LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (caller:function)-[:calls]->(target:function) RETURN target.name, count(caller) AS callers ORDER BY callers DESC LIMIT 10" })`
- Expected state: success or empty
- Representative output: T076 live self-index success; rows=10, effectiveCap=10, truncated=true; first getNodeText callers=218; bytes=1058; package=CLI=MCP.
- Expected-empty reason: Empty rows are valid when the project has no active function call relationships.
- Parity hash: 8b647aa13eb918bc3f5d063114f1ca73967e9445b062bc7c4b5ae8e734078c3c
- Artifact: T076-PARITY-AND-RECIPES in `specs/013-cypher-query-access/evidence-matrix.md`
- Reviewer: spec013_t076
- Date: 2026-07-30

## RECIPE-004 - Potentially Dead Exports
- Category: potentially dead exports
- Query: `MATCH (n:function) WHERE n.isExported = true RETURN n.name, n.filePath LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (n:function) WHERE n.isExported = true RETURN n.name, n.filePath LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (n:function) WHERE n.isExported = true RETURN n.name, n.filePath LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (n:function) WHERE n.isExported = true RETURN n.name, n.filePath LIMIT 10" })`
- Expected state: success or empty
- Representative output: T076 live self-index success; rows=10, effectiveCap=10, truncated=true; first describeFatal at src/bin/fatal-handler.ts; bytes=1364; package=CLI=MCP.
- Expected-empty reason: Empty rows mean the selected index has no exported functions mapped with `isExported = true`; this is not a query failure.
- Parity hash: 2529ff173bc8d0fef72c4828f2ebf50c45f6324fab13c66daa003947d1ab0217
- Artifact: T076-PARITY-AND-RECIPES in `specs/013-cypher-query-access/evidence-matrix.md`
- Reviewer: spec013_t076
- Date: 2026-07-30

## RECIPE-005 - Route Component Neighborhood
- Category: route/component neighborhood
- Query: `MATCH (route:route)-[:references]->(component:component) RETURN route.name, component.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (route:route)-[:references]->(component:component) RETURN route.name, component.name LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (route:route)-[:references]->(component:component) RETURN route.name, component.name LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (route:route)-[:references]->(component:component) RETURN route.name, component.name LIMIT 10" })`
- Expected state: success or empty
- Representative output: T076 live self-index expected-empty success; rows=0, effectiveCap=10, truncated=false because this self-index has no active route-to-component references; bytes=126; package=CLI=MCP.
- Expected-empty reason: Many repositories do not expose route/component public labels or active `references` relationships; empty rows are expected in those projects.
- Parity hash: dca031c7ac10d3ad1efbe2822034b562607915da85ab81b30f222a827ac9c7c3
- Artifact: T076-PARITY-AND-RECIPES in `specs/013-cypher-query-access/evidence-matrix.md`
- Reviewer: spec013_t076
- Date: 2026-07-30

## RECIPE-006 - Imports by Module
- Category: imports by module
- Query: `MATCH (source:module)-[:imports]->(target:module) RETURN source.name, target.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (source:module)-[:imports]->(target:module) RETURN source.name, target.name LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (source:module)-[:imports]->(target:module) RETURN source.name, target.name LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (source:module)-[:imports]->(target:module) RETURN source.name, target.name LIMIT 10" })`
- Expected state: success or empty
- Representative output: T076 live self-index success; rows=1, effectiveCap=10, truncated=false; Consumer -> Foo; bytes=222; package=CLI=MCP.
- Expected-empty reason: Empty rows are valid when module nodes or active `imports` relationships are not present in the selected index.
- Parity hash: 47f96f3da6f59097be588999fc2508f45677a4bbc427582cca5e8fee365feee5
- Artifact: T076-PARITY-AND-RECIPES in `specs/013-cypher-query-access/evidence-matrix.md`
- Reviewer: spec013_t076
- Date: 2026-07-30

## RECIPE-007 - Async Function Callers
- Category: async function callers
- Query: `MATCH (caller:function)-[:calls]->(target:function) WHERE caller.isAsync = true RETURN caller.name, target.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (caller:function)-[:calls]->(target:function) WHERE caller.isAsync = true RETURN caller.name, target.name LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (caller:function)-[:calls]->(target:function) WHERE caller.isAsync = true RETURN caller.name, target.name LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (caller:function)-[:calls]->(target:function) WHERE caller.isAsync = true RETURN caller.name, target.name LIMIT 10" })`
- Expected state: success or empty
- Representative output: T076 live self-index success; rows=10, effectiveCap=10, truncated=true; first generate -> emitBundle; bytes=1353; package=CLI=MCP.
- Expected-empty reason: The project may contain no async functions, or async functions may have no active call edges.
- Parity hash: 4426de480f53eea44e5f89a268decfc61efd43bf628e60b10446c0a4b495dd04
- Artifact: T076-PARITY-AND-RECIPES in `specs/013-cypher-query-access/evidence-matrix.md`
- Reviewer: spec013_t076
- Date: 2026-07-30

## RECIPE-008 - Heuristic Edge Review
- Category: heuristic edge review
- Query: `MATCH (source:function)-[edge:calls]->(target:function) WHERE edge.provenance = 'heuristic' RETURN source.name, target.name, edge.provenance LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (source:function)-[edge:calls]->(target:function) WHERE edge.provenance = 'heuristic' RETURN source.name, target.name, edge.provenance LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (source:function)-[edge:calls]->(target:function) WHERE edge.provenance = 'heuristic' RETURN source.name, target.name, edge.provenance LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (source:function)-[edge:calls]->(target:function) WHERE edge.provenance = 'heuristic' RETURN source.name, target.name, edge.provenance LIMIT 10" })`
- Expected state: success or empty
- Representative output: T076 live self-index success; rows=10, effectiveCap=10, truncated=true; first Harness -> SourcePane provenance=heuristic; bytes=1810; package=CLI=MCP.
- Expected-empty reason: Empty rows are expected when the index contains only static or LSP call provenance, or no matching call edges.
- Parity hash: 255e7616aac403ca7a280cadad3da2dc8e49448f50bf7e3795cf1b4dcbcebc6a
- Artifact: T076-PARITY-AND-RECIPES in `specs/013-cypher-query-access/evidence-matrix.md`
- Reviewer: spec013_t076
- Date: 2026-07-30

## RECIPE-009 - File-Local Relationship Summary
- Category: file-local relationship summary
- Query: `MATCH (source:function)-[:calls]->(target:function) WHERE source.filePath = target.filePath RETURN source.name, target.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (source:function)-[:calls]->(target:function) WHERE source.filePath = target.filePath RETURN source.name, target.name LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (source:function)-[:calls]->(target:function) WHERE source.filePath = target.filePath RETURN source.name, target.name LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (source:function)-[:calls]->(target:function) WHERE source.filePath = target.filePath RETURN source.name, target.name LIMIT 10" })`
- Expected state: success or empty
- Representative output: T076 live self-index success; rows=10, effectiveCap=10, truncated=true; first collectModuleControllers -> classNameAfter; bytes=1404; package=CLI=MCP.
- Expected-empty reason: Empty rows are valid when calls cross file boundaries or no active calls exist within one file.
- Parity hash: 936fa758da9461b39b009c269258cc5e7787f7668f5b5034e67c96d7aaa79014
- Artifact: T076-PARITY-AND-RECIPES in `specs/013-cypher-query-access/evidence-matrix.md`
- Reviewer: spec013_t076
- Date: 2026-07-30

## RECIPE-010 - Source-Position Filtered Relationship Review
- Category: source-position filtered relationship review
- Query: `MATCH (source:function)-[:calls]->(target:function) WHERE source.startLine >= 1 RETURN source.filePath, source.startLine, target.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (source:function)-[:calls]->(target:function) WHERE source.startLine >= 1 RETURN source.filePath, source.startLine, target.name LIMIT 10")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (source:function)-[:calls]->(target:function) WHERE source.startLine >= 1 RETURN source.filePath, source.startLine, target.name LIMIT 10" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (source:function)-[:calls]->(target:function) WHERE source.startLine >= 1 RETURN source.filePath, source.startLine, target.name LIMIT 10" })`
- Expected state: success or empty
- Representative output: T076 live self-index success; rows=10, effectiveCap=10, truncated=true; first __tests__/hybrid-mcp-surface.test.ts:86 -> makeFixture; bytes=2021; package=CLI=MCP.
- Expected-empty reason: Empty rows are valid when no active call edge has a source function with a mapped source location.
- Parity hash: 981c6a733aba2a76f660d14db4d352e201bc78a6d53851bd410cdda83a54ceae
- Artifact: T076-PARITY-AND-RECIPES in `specs/013-cypher-query-access/evidence-matrix.md`
- Reviewer: spec013_t076
- Date: 2026-07-30

## RECIPE-011 - String Predicate Expected-Empty Check
- Category: string predicate expected-empty example
- Query: `MATCH (caller:function)-[:calls]->(target:function) WHERE caller.name STARTS WITH 'recipeNoMatch' RETURN caller.name AS callerName, target.name AS targetName ORDER BY callerName ASC, targetName ASC LIMIT 5`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (caller:function)-[:calls]->(target:function) WHERE caller.name STARTS WITH 'recipeNoMatch' RETURN caller.name AS callerName, target.name AS targetName ORDER BY callerName ASC, targetName ASC LIMIT 5")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (caller:function)-[:calls]->(target:function) WHERE caller.name STARTS WITH 'recipeNoMatch' RETURN caller.name AS callerName, target.name AS targetName ORDER BY callerName ASC, targetName ASC LIMIT 5" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (caller:function)-[:calls]->(target:function) WHERE caller.name STARTS WITH 'recipeNoMatch' RETURN caller.name AS callerName, target.name AS targetName ORDER BY callerName ASC, targetName ASC LIMIT 5" })`
- Expected state: empty
- Representative output: T076 live self-index expected-empty success; rows=0, effectiveCap=5, truncated=false by deliberate recipeNoMatch prefix; bytes=121; package=CLI=MCP.
- Expected-empty reason: The `recipeNoMatch` prefix is deliberately selected to produce an expected-empty success state while exercising `STARTS WITH`.
- Parity hash: 3e2565d7767a8b4a017078d9ce5aea2207e4157b6829244967d2993c61ce7385
- Artifact: T076-PARITY-AND-RECIPES in `specs/013-cypher-query-access/evidence-matrix.md`
- Reviewer: spec013_t076
- Date: 2026-07-30

## RECIPE-012 - Backtick Identifier and Alias Check
- Category: backtick identifier example
- Query: `MATCH (`call``er`:`function`)-[:`calls`]->(`target-node`:`function`) WHERE `call``er`.name = 'entry' RETURN `call``er`.name AS `caller``name`, `target-node`.`name` AS `target-name` ORDER BY `target-name` ASC LIMIT 1`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (`call``er`:`function`)-[:`calls`]->(`target-node`:`function`) WHERE `call``er`.name = 'entry' RETURN `call``er`.name AS `caller``name`, `target-node`.`name` AS `target-name` ORDER BY `target-name` ASC LIMIT 1")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (`call``er`:`function`)-[:`calls`]->(`target-node`:`function`) WHERE `call``er`.name = 'entry' RETURN `call``er`.name AS `caller``name`, `target-node`.`name` AS `target-name` ORDER BY `target-name` ASC LIMIT 1" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (`call``er`:`function`)-[:`calls`]->(`target-node`:`function`) WHERE `call``er`.name = 'entry' RETURN `call``er`.name AS `caller``name`, `target-node`.`name` AS `target-name` ORDER BY `target-name` ASC LIMIT 1" })`
- Expected state: success or empty
- Representative output: T076 live self-index success; rows=1, effectiveCap=1, truncated=false; entry -> topLevel with preserved aliases; bytes=223; package=CLI=MCP.
- Expected-empty reason: Empty rows are valid when the selected fixture or live project has no `entry` caller with an active `calls` edge.
- Parity hash: b4d27b239dea1a842017d91325f0b06a0404c1ac5ac636856293efce2c223ee1
- Artifact: T076-PARITY-AND-RECIPES in `specs/013-cypher-query-access/evidence-matrix.md`
- Reviewer: spec013_t076
- Date: 2026-07-30

## GUARD-ROW-CAP - Default Row Cap and Truncation Flag
- Input: `MATCH (n:function) RETURN n.name`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (n:function) RETURN n.name")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (n:function) RETURN n.name" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (n:function) RETURN n.name" })`
- Expected state: success
- Expected code: n/a
- Representative output: T070 capped/truncated state success; rows=1, effectiveCap=1, truncated=true, bytes=138.
- Expected-empty reason: Empty rows are not the target condition for this guard; if seen, the project likely has no indexed function nodes.
- Parity hash: 57ebee126f297e2c8612ad0b3284c20bb21b3209de5a688a055ca445dc4ef292
- Artifact: T070-FINAL-SAFE-OPERATION
- Reviewer: spec013_t046
- Date: 2026-07-30

## GUARD-PATH-CAP - Bounded Variable Path Traversal
- Input: `MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5" })`
- Expected state: success
- Expected code: n/a
- Representative output: T075/T076 bounded path success; rows=5, effectiveCap=5, truncated=true, bytes=9658.
- Expected-empty reason: Empty rows are valid only when no active one-to-three-hop call path exists.
- Parity hash: 103fe5607eadf3eca8d2bc2ab774157c41a30ab72e6a9d52594e644055644a00
- Artifact: T075-LIVE-SELF-INDEX-UAT and T076-PARITY-AND-RECIPES
- Reviewer: spec013_tasks_retry
- Date: 2026-07-30

## GUARD-TIMEOUT - Five-Second Timeout Guidance
- Input: `MATCH p = (a:function)-[:calls*1..10]->(b:function) RETURN p`
- Surfaces: package, CLI, MCP, docs
- Package API command: `await queryCypher(projectRoot, "MATCH p = (a:function)-[:calls*1..10]->(b:function) RETURN p")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH p = (a:function)-[:calls*1..10]->(b:function) RETURN p" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH p = (a:function)-[:calls*1..10]->(b:function) RETURN p" })`
- Expected state: timeout
- Expected code: CYPHER_TIMEOUT; planning label CYPHER_QUERY_TIMEOUT
- Representative output: T070/T076 timeout state; exit=1 for CLI, status=timeout, code=CYPHER_TIMEOUT, deadlineMs=5000, bytes=175, MCP isError=false.
- Expected-empty reason: Not applicable; timeout guards should return timeout, not empty success.
- Parity hash: c6bcb2eeae3bb90bb94c686694a3c0fffd6af95f579f431b6d2dd2ee2aae98e6
- Artifact: T070-FINAL-SAFE-OPERATION and T076-PARITY-AND-RECIPES
- Reviewer: spec013_t046
- Date: 2026-07-30

## GUARD-READ-ONLY - Unsupported Write Clause Rejection
- Input: `MATCH (n) DELETE n RETURN n`
- Surfaces: package, CLI, MCP, docs
- Package API command: `await queryCypher(projectRoot, "MATCH (n) DELETE n RETURN n")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (n) DELETE n RETURN n" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (n) DELETE n RETURN n" })`
- Expected state: diagnostic
- Expected code: CYPHER_UNSUPPORTED; planning label CYPHER_UNSUPPORTED_CLAUSE
- Representative output: T070 unsupported write diagnostic; code=CYPHER_UNSUPPORTED, bytes=331. Read-only snapshot unchanged=true and beforeHash=afterHash=357d62911e8d2448c8d661e657264ef4587867fff219b275e751c68a43e5754a.
- Expected-empty reason: Not applicable; write-clause probes should be rejected before execution.
- Parity hash: 9ed5005a573223decc9b0163fac2741f712d154efdc35691e7671791fca13246
- Artifact: T070-FINAL-SAFE-OPERATION
- Reviewer: spec013_t046
- Date: 2026-07-30

## GUARD-MALFORMED-STDIN - Malformed UTF-8 Stdin Rejection
- Input: `printf malformed UTF-8 bytes to codegraph query - --json`
- Surfaces: CLI, docs
- Package API command: Not applicable; this guard targets CLI stdin decoding before package API invocation.
- CLI --json command: `printf '<malformed-utf8-bytes>' | node dist/bin/codegraph.js query - --json --path {projectRoot}`
- MCP text command: Not applicable; MCP receives structured UTF-8 JSON arguments instead of raw stdin bytes.
- Expected state: diagnostic
- Expected code: CYPHER_INVALID_STDIN_ENCODING
- Representative output: T070/T076 malformed UTF-8 stdin diagnostic; exit=1, status=diagnostic, code=CYPHER_INVALID_STDIN_ENCODING, bytes=251, stderrBytes=0, noTrailingNewline=true.
- Expected-empty reason: Not applicable; malformed input must be diagnostic, not empty success.
- Parity hash: 234b465edbc85750eaa672c2f579fbe4a812355fb3be7185bfcefecf4e00001f; MCP byte-identical comparison is not applicable because MCP accepts a Unicode string, not raw stdin bytes.
- Artifact: T070-FINAL-SAFE-OPERATION and T076-PARITY-AND-RECIPES
- Reviewer: spec013_t046
- Date: 2026-07-30

## GUARD-PAYLOAD-CEILING - Canonical Payload Ceiling Diagnostic
- Input: `MATCH (n:function) RETURN n`
- Surfaces: package, CLI, MCP, docs
- Package API command: `await queryCypher(projectRoot, "MATCH (n:function) RETURN n")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (n:function) RETURN n" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (n:function) RETURN n" })`
- Expected state: diagnostic
- Expected code: CYPHER_OUTPUT_TOO_LARGE
- Representative output: T070/T076 payload ceiling diagnostic; status=diagnostic, code=CYPHER_OUTPUT_TOO_LARGE, bytes=332, no partial rows.
- Expected-empty reason: Empty rows are not the target condition; this guard requires a fixture or live index large enough to exceed the payload limit.
- Parity hash: 8a7bf59417d0a792dddb44131a531080e14c19ab9dd5fd3a8648be9b27efd668
- Artifact: T070-FINAL-SAFE-OPERATION and T076-PARITY-AND-RECIPES
- Reviewer: spec013_t046
- Date: 2026-07-30

## GUARD-CLI-MCP-PARITY - Byte-Identical CLI and MCP JSON
- Input: `MATCH (n:function) RETURN n.name ORDER BY n.name LIMIT 5`
- Surfaces: CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (n:function) RETURN n.name ORDER BY n.name LIMIT 5")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (n:function) RETURN n.name ORDER BY n.name LIMIT 5" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (n:function) RETURN n.name ORDER BY n.name LIMIT 5" })`
- Expected state: success
- Expected code: n/a
- Representative output: T075 stdin query success; rows=5, effectiveCap=5, truncated=true, bytes=434, first n.name=__emitWatchEventForTests. T076 confirms byte-identical CLI/MCP canonical JSON across required comparable states and all twelve recipes.
- Expected-empty reason: Empty rows are acceptable only if the live index has no function nodes; parity still compares identical canonical success JSON.
- Parity hash: 14bde464cfb2bdfb24985bc17af04f4e3dc707205e8938371e3bc066ca2dc64f for the T075 live stdin query; see T076-PARITY-AND-RECIPES for final comparable-state hashes.
- Artifact: T075-LIVE-SELF-INDEX-UAT and T076-PARITY-AND-RECIPES
- Reviewer: spec013_tasks_retry
- Date: 2026-07-30

## PERF-VARIABLE-PATH-PLAN - Variable Path Plan and Bounded Recursion
- Input: `MATCH p = (start:function)-[:calls*1..2]->(finish:function) RETURN p LIMIT 5`
- Surfaces: package, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH p = (start:function)-[:calls*1..2]->(finish:function) RETURN p LIMIT 5")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH p = (start:function)-[:calls*1..2]->(finish:function) RETURN p LIMIT 5" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH p = (start:function)-[:calls*1..2]->(finish:function) RETURN p LIMIT 5" })`
- Expected state: success
- Plan transcript: T061/T066 runtime plan evidence covers bounded recursive variable-path planning and query-plan details matching QUERY PLAN/SEARCH/SCAN.
- Edge index evidence: idx_edges_source_kind
- Temporary work evidence: no `ORDER BY` or `GROUP BY` temporary work required for this probe.
- Bounded-by note: relationship depth, effectiveCap + 1, and five-second timeout
- Representative output: T061/T066 plan probe passed; materialized/inspected rows <=6 and boundedBy matched effectiveCap plus one, LIMIT 5, or timeout.
- Expected-empty reason: Empty rows are valid when no active one-to-two-hop `calls` path connects indexed function nodes.
- Artifact: T066-FINAL-FOCUSED-GUARDRAILS
- Reviewer: spec013_t046
- Date: 2026-07-30

## PERF-STABLE-ORDERING - Stable Default and Explicit Ordering
- Input: `MATCH (hub:function)-[:calls]->(target:function) RETURN target.name LIMIT 5`
- Surfaces: package, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (hub:function)-[:calls]->(target:function) RETURN target.name LIMIT 5")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (hub:function)-[:calls]->(target:function) RETURN target.name LIMIT 5" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (hub:function)-[:calls]->(target:function) RETURN target.name LIMIT 5" })`
- Expected state: success
- Plan transcript: T061/T066 runtime evidence covers deterministic ordered rows and temp work evidence including ORDER BY in plan details.
- Edge index evidence: idx_edges_source_kind
- Temporary work evidence: ORDER BY
- Bounded-by note: effectiveCap + 1 or explicit LIMIT
- Representative output: T061/T066 capped ordered output remained bounded to five rows with inspected rows <=6.
- Expected-empty reason: Empty rows are valid when the selected index has no active `calls` edges from function nodes.
- Artifact: T066-FINAL-FOCUSED-GUARDRAILS
- Reviewer: spec013_t046
- Date: 2026-07-30

## PERF-COUNT-GROUPING - Count and Implicit Grouping Work
- Input: `MATCH (caller:function)-[:calls]->(target:function) RETURN caller.name AS callerName, count(*) AS calls ORDER BY calls DESC LIMIT 5`
- Surfaces: package, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (caller:function)-[:calls]->(target:function) RETURN caller.name AS callerName, count(*) AS calls ORDER BY calls DESC LIMIT 5")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (caller:function)-[:calls]->(target:function) RETURN caller.name AS callerName, count(*) AS calls ORDER BY calls DESC LIMIT 5" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (caller:function)-[:calls]->(target:function) RETURN caller.name AS callerName, count(*) AS calls ORDER BY calls DESC LIMIT 5" })`
- Expected state: success
- Plan transcript: T061/T066 grouped variable-path aggregate query plan included SQL with GROUP BY and ORDER BY.
- Edge index evidence: idx_edges_source_kind
- Temporary work evidence: GROUP BY, ORDER BY
- Bounded-by note: group cardinality, effectiveCap + 1, and timeout
- Representative output: T061/T066 aggregate plan returned rows=5, truncated=true, and bounded materialized/inspected rows <=6.
- Expected-empty reason: Empty rows are valid when the selected index has no active function-to-function `calls` relationships.
- Artifact: T066-FINAL-FOCUSED-GUARDRAILS
- Reviewer: spec013_t046
- Date: 2026-07-30

## PERF-ROW-CAP-TRUNCATION - Row-Cap Truncation Existence Probe
- Input: `MATCH (n:function) RETURN n.name`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH (n:function) RETURN n.name")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (n:function) RETURN n.name" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (n:function) RETURN n.name" })`
- Expected state: success
- Plan transcript: T061/T066 runtime tests cover cap-plus-one inspected rows paired with runtime row-inspection evidence.
- Edge index evidence: no edge index is required for this node-only probe.
- Temporary work evidence: no `ORDER BY` or `GROUP BY` temporary work is required for this probe.
- Bounded-by note: default cap plus one inspected row
- Representative output: T070 capped/truncated state rows=1, effectiveCap=1, truncated=true.
- Expected-empty reason: Empty rows are valid only when the selected index has no function nodes.
- Artifact: T070-FINAL-SAFE-OPERATION
- Reviewer: spec013_t046
- Date: 2026-07-30

## PERF-PAYLOAD-CEILING - Canonical Output-Size Rejection
- Input: `MATCH (n:function) RETURN n`
- Surfaces: package, CLI, MCP, docs
- Package API command: `await queryCypher(projectRoot, "MATCH (n:function) RETURN n")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH (n:function) RETURN n" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH (n:function) RETURN n" })`
- Expected state: diagnostic
- Plan transcript: T061/T066 runtime tests cover payload-too-large without partial rows.
- Edge index evidence: no edge index is required for this node payload probe.
- Temporary work evidence: no `ORDER BY` or `GROUP BY` temporary work is required for this probe.
- Bounded-by note: fixed 1 MiB UTF-8 canonical JSON ceiling
- Representative output: T070 payload ceiling diagnostic code=CYPHER_OUTPUT_TOO_LARGE, bytes=332, sha256=8a7bf59417d0a792dddb44131a531080e14c19ab9dd5fd3a8648be9b27efd668.
- Expected-empty reason: Not applicable for the ceiling condition; this probe requires enough node payload to exceed the canonical JSON limit.
- Artifact: T070-FINAL-SAFE-OPERATION
- Reviewer: spec013_t046
- Date: 2026-07-30

## PERF-INCOMING-EDGE-INDEX - Incoming Edge Index Use
- Input: `MATCH p = (caller:function)<-[:calls*1..2]-(target:function) RETURN caller.name AS callerName, count(target.name) AS incoming ORDER BY incoming DESC, callerName ASC LIMIT 5`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: `await queryCypher(projectRoot, "MATCH p = (caller:function)<-[:calls*1..2]-(target:function) RETURN caller.name AS callerName, count(target.name) AS incoming ORDER BY incoming DESC, callerName ASC LIMIT 5")`
- CLI --json command: `node dist/bin/codegraph.js query "MATCH p = (caller:function)<-[:calls*1..2]-(target:function) RETURN caller.name AS callerName, count(target.name) AS incoming ORDER BY incoming DESC, callerName ASC LIMIT 5" --json --path {projectRoot}`
- MCP text command: `codegraph_query({ "projectPath": "{projectRoot}", "query": "MATCH p = (caller:function)<-[:calls*1..2]-(target:function) RETURN caller.name AS callerName, count(target.name) AS incoming ORDER BY incoming DESC, callerName ASC LIMIT 5" })`
- Expected state: success
- Plan transcript: T079 live self-index plan succeeded; details include SEARCH e0 USING INDEX idx_edges_target_kind at setup and recursive step.
- Edge index evidence: idx_edges_target_kind
- Temporary work evidence: recursive ORDER BY, GROUP BY, final ORDER BY
- Bounded-by note: LIMIT 5; effectiveCap + 1 truncation probe; timeout 5000ms. Compatibility note for the original readiness fixture: effectiveCap + 1 and timeout.
- Representative output: T079 live self-index result success; rows=5, effectiveCap=5, truncated=true.
- Expected-empty reason: Empty rows remain valid for repositories with no active incoming `calls` edge; not observed in T079.
- Artifact: T079-FINAL-HYGIENE
- Reviewer: spec013_tasks_retry
- Date: 2026-07-30
- Previous input reference retained for the recipe-readiness test harness: `MATCH (caller:function)<-[:calls]-(target:function) RETURN caller.name, target.name LIMIT 5`
