# SPEC-013 Cypher Query Access Recipes

This document is the Slice 2 recipe evidence packet. T046 intentionally creates
the live self-index command, parity, reviewer/date, representative output, and
expected-empty slots as placeholders so later implementation and UAT tasks can
replace them with reviewed evidence.

## RECIPE-001 - Callers of a Function
- Category: callers of a function
- Query: `MATCH (caller:function)-[:calls]->(target:function) RETURN caller.name, target.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: success or empty
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD

## RECIPE-002 - Bounded Path Between Functions
- Category: bounded path between functions
- Query: `MATCH p = (source:function)-[:calls*1..3]->(target:function) RETURN p LIMIT 5`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: success or empty
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD

## RECIPE-003 - Hubs by Count
- Category: hubs by count
- Query: `MATCH (caller:function)-[:calls]->(target:function) RETURN target.name, count(caller) AS callers ORDER BY callers DESC LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: success or empty
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD

## RECIPE-004 - Potentially Dead Exports
- Category: potentially dead exports
- Query: `MATCH (n:function) WHERE n.isExported = true RETURN n.name, n.filePath LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: success or empty
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD

## RECIPE-005 - Route Component Neighborhood
- Category: route/component neighborhood
- Query: `MATCH (route:route)-[:references]->(component:component) RETURN route.name, component.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: success or empty
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD

## RECIPE-006 - Imports by Module
- Category: imports by module
- Query: `MATCH (source:module)-[:imports]->(target:module) RETURN source.name, target.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: success or empty
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD

## RECIPE-007 - Async Function Callers
- Category: async function callers
- Query: `MATCH (caller:function)-[:calls]->(target:function) WHERE caller.isAsync = true RETURN caller.name, target.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: success or empty
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD

## RECIPE-008 - Heuristic Edge Review
- Category: heuristic edge review
- Query: `MATCH (source:function)-[edge:calls]->(target:function) WHERE edge.provenance = 'heuristic' RETURN source.name, target.name, edge.provenance LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: success or empty
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD

## RECIPE-009 - File-Local Relationship Summary
- Category: file-local relationship summary
- Query: `MATCH (source:function)-[:calls]->(target:function) WHERE source.filePath = target.filePath RETURN source.name, target.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: success or empty
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD

## RECIPE-010 - Source-Position Filtered Relationship Review
- Category: source-position filtered relationship review
- Query: `MATCH (source:function)-[:calls]->(target:function) WHERE source.startLine >= 1 RETURN source.filePath, source.startLine, target.name LIMIT 10`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: success or empty
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD

## GUARD-ROW-CAP - Default Row Cap and Truncation Flag
- Input: `MATCH (n:function) RETURN n.name`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: success
- Expected code: n/a
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD

## GUARD-PATH-CAP - Bounded Variable Path Traversal
- Input: `MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5`
- Surfaces: package, CLI, MCP, docs, live UAT
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: success
- Expected code: n/a
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD

## GUARD-TIMEOUT - Five-Second Timeout Guidance
- Input: `MATCH p = (a:function)-[:calls*1..10]->(b:function) RETURN p`
- Surfaces: package, CLI, MCP, docs
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: timeout
- Expected code: CYPHER_QUERY_TIMEOUT
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD

## GUARD-READ-ONLY - Unsupported Write Clause Rejection
- Input: `MATCH (n) DELETE n RETURN n`
- Surfaces: package, CLI, MCP, docs
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: diagnostic
- Expected code: CYPHER_UNSUPPORTED_CLAUSE
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD

## GUARD-MALFORMED-STDIN - Malformed UTF-8 Stdin Rejection
- Input: `printf malformed UTF-8 bytes to codegraph query - --json`
- Surfaces: CLI, docs
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: diagnostic
- Expected code: CYPHER_INVALID_STDIN_ENCODING
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD

## GUARD-PAYLOAD-CEILING - Canonical Payload Ceiling Diagnostic
- Input: `MATCH (n:function) RETURN n`
- Surfaces: package, CLI, MCP, docs
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: diagnostic
- Expected code: CYPHER_OUTPUT_TOO_LARGE
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD

## GUARD-CLI-MCP-PARITY - Byte-Identical CLI and MCP JSON
- Input: `MATCH (n:function) RETURN n.name ORDER BY n.name LIMIT 5`
- Surfaces: CLI, MCP, docs, live UAT
- Package API command: TBD
- CLI --json command: TBD
- MCP text command: TBD
- Expected state: success
- Expected code: n/a
- Representative output: TBD
- Expected-empty reason: TBD
- Parity hash: TBD
- Artifact: TBD
- Reviewer: TBD
- Date: TBD
