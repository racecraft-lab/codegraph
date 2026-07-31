---
topic: "Cypher Query Access"
slug: "spec-013-cypher-query-access"
date: "2026-07-29"
mode: "setup"
spec_id: "SPEC-013"
source_input:
  type: "topic"
  ref: "SPEC-013 roadmap entry in docs/ai/specs/intelligence-platform-technical-roadmap.md"
question_count: 29
stop_reason: "natural"
---

# Design Concept: Cypher Query Access

> **Source:** SPEC-013 roadmap entry in `docs/ai/specs/intelligence-platform-technical-roadmap.md`
> **Date:** 2026-07-29
> **Questions asked:** 29
> **Stop reason:** natural

## Goals

- Add a read-only, dependency-free openCypher subset that compiles one connected
  graph pattern into parameterized SQLite `SELECT`/recursive-CTE queries over
  CodeGraph's existing node and edge store.
- Define a stable virtual property graph from CodeGraph's public model: node
  kinds are labels, edge kinds are relationship types, public camelCase fields
  are properties, and inactive LSP-suppressed edge audit rows never participate.
- Support explicit incoming and outgoing relationships, relationship-simple
  variable paths of at most eight edges, first-class path binding, three-valued
  null logic, core comparisons, string predicates, `count(*)`, `count(expr)`,
  aliases, `ORDER BY`, and stable implicit ordering.
- Return typed public node, edge, path, and scalar values through a canonical
  result contract with a default 100-row limit, a hard 1,000-row cap, explicit
  truncation metadata, a fixed five-second deadline, and structured diagnostics.
- Expose one supported `queryCypher` library contract through `codegraph query`
  and a default-listed `codegraph_query` MCP tool. CLI `--json` and MCP text
  must use the same canonical serializer byte-for-byte.
- Ship at least ten documented recipes and exercise all of them against
  CodeGraph's live self-index, including representative result review and
  explicit row, path, timeout, syntax, and read-only guardrail probes.
- Deliver two thin vertical rule slices. Slice 1 ships bounded connected-path
  querying end-to-end through library, CLI, and MCP. Slice 2 adds
  count/grouping, string predicates, backtick identifiers, and recipe closure
  across those same surfaces. If this requires multiple PRs, manage the linear
  branch/PR chain non-interactively with `gh-stack`.

The shared advisory estimator used three user stories, six primary
files/surfaces, and twenty-four functional contracts for this net-new engine. It
returned approximately 675 reviewable LOC, two suggested slices, and status
`warn`. The maintainer accepted the two-slice mitigation and explicitly required
`gh-stack` if more than one PR is emitted.

## Non-goals

- Write clauses or any direct SQL input. The grammar has no mutation form and
  execution uses a dedicated read-only SQLite connection — Q15.
- Full openCypher compatibility, `OPTIONAL MATCH`, multiple MATCH clauses,
  comma-separated/disconnected patterns, or Cartesian products — Q21.
- Undirected relationship syntax in v1; every traversal states incoming or
  outgoing direction explicitly — Q3.
- External `$name` parameter bindings and a second CLI/MCP parameter-value
  contract; query literals are still bound into parameterized SQL internally —
  Q6.
- `count(DISTINCT ...)` or aggregations other than `count(*)` and
  `count(expr)` — Q20.
- Nested predicates over `metadata`, decorators, or other JSON-valued fields;
  those values may be returned only as opaque public JSON — Q23.
- `IN` list membership in v1. String matching is limited to `STARTS WITH`,
  `ENDS WITH`, and `CONTAINS` in addition to the core comparison/null operators
  selected in Q24.
- Caller-configurable timeouts, row caps, or path caps. V1 uses the fixed,
  documented limits selected in Q10–Q13.
- A `--file` query-input option. CLI input is one positional string or bounded
  UTF-8 stdin via `-` — Q17.
- Exporting lexer, parser, planner, SQL-emitter, or AST internals as public
  package APIs — Q19.
- Returning partial results after a timeout or silently truncating capped
  results — Q8 and Q13.

## Design Tree (Q&A log)

### Q1. How should Cypher labels and properties map onto CodeGraph's existing node and edge records?

**Branch:** Virtual graph model

**Recommended answer:** Public model
> Use node kind and edge kind as labels/types, expose stable camelCase public
> fields, and reject unknown properties precisely. This follows the public
> `Node`/`Edge` contract in `src/types.ts` instead of coupling the language to
> snake_case storage columns in `src/db/schema.sql`.

**Alternatives offered:**
- Raw SQL columns: Reduce translation but couple saved queries to storage details.
- Minimal properties: Expose only identity, name, kind, and file location, making
  v1 smaller but substantially less expressive.

**User's answer:** Public model (Recommended)

---

### Q2. Which stored relationships should MATCH traversals consider by default?

**Branch:** Edge visibility and graph truth

**Recommended answer:** Active edges only
> Exclude LSP-suppressed rows using the existing active-edge policy, include
> active static/LSP/heuristic edges, and let callers filter the public provenance
> field. This keeps Cypher aligned with normal CodeGraph reads while preserving
> deterministic graph evidence.

**Alternatives offered:**
- Verified edges only: Exclude heuristic relationships for higher precision but
  lose useful dynamic-dispatch paths.
- All stored edges: Include inactive audit rows, making ordinary results misleading.

**User's answer:** Active edges only (Recommended)

---

### Q3. Which relationship directions should the v1 MATCH grammar support?

**Branch:** Relationship direction

**Recommended answer:** Explicit arrows only
> Support incoming and outgoing arrows and require the query to state its
> direction. CodeGraph edges are directed, and deferring undirected traversal
> avoids ambiguous duplicate rows in the first subset.

**Alternatives offered:**
- Include undirected: Support dash-only patterns and deduplicate both orientations.
- Outgoing only: Keep the grammar smallest but make reverse caller queries awkward.

**User's answer:** Explicit arrows only (Recommended)

---

### Q4. What uniqueness rule should variable-length paths use within one matched path?

**Branch:** Path semantics

**Recommended answer:** No repeated edge
> Use relationship-isomorphic matching: one relationship cannot repeat within
> a path, while nodes may recur. This follows the openCypher path model described
> by the [openCypher implementers group](https://opencypher.org/event/2017/02/08/event-ocim1/)
> and remains bounded by the v1 path-length cap.

**Alternatives offered:**
- No repeated node: Prevent node cycles, but deliberately diverge from openCypher
  path semantics.
- Reachability only: Return one endpoint pair rather than distinct paths, reducing
  explosion but weakening path-query compatibility.

**User's answer:** No repeated edge (Recommended)

---

### Q5. How should WHERE handle absent optional properties such as docstring, signature, or provenance?

**Branch:** Null semantics

**Recommended answer:** Three-valued nulls
> Propagate null through comparisons and boolean expressions, with explicit
> `IS NULL` and `IS NOT NULL`. This keeps absence distinct from empty strings or
> false values in the public graph model.

**Alternatives offered:**
- SQL-like passthrough: Delegate directly to SQLite and document only resulting cases.
- Coerce defaults: Treat missing strings as empty and booleans as false.

**User's answer:** Three-valued nulls (Recommended)

---

### Q6. Should v1 accept caller-supplied Cypher parameters such as `$name`, or only literals embedded in the query text?

**Branch:** Parameters and SQL safety

**Recommended answer:** Literals only
> Parse scalar literals and bind every value into parameterized SQL internally.
> Deferring `$name` avoids adding a second CLI/MCP values contract while still
> preventing literal interpolation into generated SQL.

**Alternatives offered:**
- Named parameters: Add `$name`, CLI flags, and an MCP values object.
- Parameters only: Require external values for every predicate.

**User's answer:** Literals only (Recommended)

---

### Q7. How should projected nodes, relationships, and paths appear in machine-readable query results?

**Branch:** Result value model

**Recommended answer:** Typed graph values
> Return public node/edge objects and paths as ordered node-and-edge sequences;
> scalar properties stay native JSON values. This preserves the stable model
> chosen in Q1 and makes path queries directly useful.

**Alternatives offered:**
- Flat scalar rows: Permit only property/count projections.
- Raw database rows: Return storage-shaped records and JSON strings.

**User's answer:** Typed graph values (Recommended)

---

### Q8. What should happen when a query produces more rows than the configured maximum?

**Branch:** Result bounding

**Recommended answer:** Partial result flag
> Return the first deterministically ordered capped rows with `truncated: true`
> and the effective cap on every surface. Callers retain useful bounded results
> without mistaking them for the complete set.

**Alternatives offered:**
- Reject result: Return no rows and require a rewritten query.
- Silent truncation: Return capped rows without completeness metadata.

**User's answer:** Partial result flag (Recommended)

---

### Q9. When RETURN has no ORDER BY, should CodeGraph guarantee a stable row order?

**Branch:** Determinism

**Recommended answer:** Stable internal order
> Sort by projected stable identities and path sequence so capped results,
> snapshots, and self-repo UAT are reproducible. The grammar reference must
> document this CodeGraph-subset guarantee.

**Alternatives offered:**
- Unspecified order: Require explicit `ORDER BY` whenever ordering matters.
- Require ORDER BY: Reject uncapped multi-row queries without it.

**User's answer:** Stable internal order (Recommended)

---

### Q10. What maximum variable-path length should v1 permit?

**Branch:** Traversal guardrails

**Recommended answer:** Eight edges
> Require an explicit upper bound no greater than eight. This supports meaningful
> code flows while containing recursive path growth in cyclic graphs.

**Alternatives offered:**
- Five edges: Tighter and more predictable, but may miss legitimate dependency chains.
- Configurable maximum: Add project configuration for the cap.

**User's answer:** Eight edges (Recommended)

---

### Q11. Which row-limit policy should apply when a query omits LIMIT or requests a very large value?

**Branch:** Result guardrails

**Recommended answer:** Default 100, max 1000
> Return at most 100 rows by default and clamp explicit `LIMIT` to 1,000. This
> follows the repository's bounded-read posture while preserving analytical use.

**Alternatives offered:**
- Always max 500: Use one fixed cap with no smaller routine default.
- Default 20, max 100: Keep agent output smaller but constrain broad recipes.

**User's answer:** Default 100, max 1000 (Recommended)

---

### Q12. What statement deadline should v1 enforce across library, CLI, and MCP query surfaces?

**Branch:** Execution timeout

**Recommended answer:** Fixed five seconds
> Use one non-configurable five-second execution deadline and run synchronous
> SQLite work off-thread so it can be terminated safely. The current Node
> `DatabaseSync` APIs are synchronous, and its `timeout` option is a lock wait,
> not a general statement deadline; see the
> [Node 24 SQLite documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html).

**Alternatives offered:**
- Fixed two seconds: Reject expensive traversals sooner.
- Caller override: Add a per-request timeout up to a hard maximum.

**User's answer:** Fixed five seconds (Recommended)

---

### Q13. How should a five-second timeout surface to callers?

**Branch:** Timeout result contract

**Recommended answer:** Structured no-row result
> Return a typed timeout state with no partial rows. CLI exits 1; MCP remains
> success-shaped with guidance to narrow the pattern or add predicates, matching
> `src/mcp/AGENTS.md` for expected recoverable states.

**Alternatives offered:**
- Throw everywhere: Use one exception path across all surfaces.
- Return partial rows: Preserve work completed before cancellation.

**User's answer:** Structured no-row result (Recommended)

---

### Q14. What diagnostic contract should invalid or unsupported Cypher syntax return?

**Branch:** Parser diagnostics

**Recommended answer:** Structured source span
> Return a stable code, UTF-16 offset plus line/column, bounded escaped excerpt,
> expected construct, and grammar-document anchor. This is precise enough for
> CLI users, agents, and deterministic fixtures without echoing unbounded input.

**Alternatives offered:**
- Message only: Return one human-readable string.
- Token index only: Return a token number and message.

**User's answer:** Structured source span (Recommended)

---

### Q15. Beyond omitting mutating grammar, what runtime read-only defense should the query engine require?

**Branch:** Read-only security

**Recommended answer:** Read-only connection
> Compile only whitelisted SELECT/CTE AST forms and execute them on a dedicated
> SQLite read-only connection. This is a small defense-in-depth boundary around
> the new query engine without committing to version-specific authorizer policy.

**Alternatives offered:**
- Compiler only: Trust the internal emitter because callers never supply SQL.
- Authorizer stack: Add a SQLite authorizer on top of the read-only connection.

**User's answer:** Read-only connection (Recommended)

---

### Q16. Should the new `codegraph_query` tool be listed in CodeGraph's default MCP tool set?

**Branch:** MCP exposure and retrieval steering

**Recommended answer:** Default with guardrail
> List the tool by default but keep `codegraph_explore` explicitly primary and
> reserve Cypher for structured graph-language requests. Because this changes
> default MCP steering, implementation must run retrieval-guardian review and
> the constitution's retrieval A/B gate.

**Alternatives offered:**
- Opt-in only: Require `CODEGRAPH_MCP_TOOLS` configuration.
- Replace CFG tool: Keep the default count stable by removing default CFG access.

**User's answer:** Default with guardrail (Recommended)

---

### Q17. How should `codegraph query` accept query text in v1?

**Branch:** CLI input

**Recommended answer:** Argument or stdin
> Accept one quoted positional query or `-` for bounded UTF-8 stdin. This covers
> ad-hoc and multi-line queries without adding file-path validation or precedence.

**Alternatives offered:**
- Argument only: Smallest CLI, but awkward for long queries.
- Argument, stdin, file: Add `--file` and its path/precedence contract.

**User's answer:** Argument or stdin (Recommended)

---

### Q18. What parity guarantee should CLI `--json` and MCP provide?

**Branch:** Cross-surface contract

**Recommended answer:** Byte-identical JSON
> Use one canonical serializer so MCP text and CLI `--json` are byte-identical;
> the default CLI table renders the same bounded rows. Existing rename surfaces
> use the same shared-serializer pattern.

**Alternatives offered:**
- Shape-equivalent JSON: Keep fields aligned but allow formatting/order drift.
- Surface-specific output: Optimize each surface separately.

**User's answer:** Byte-identical JSON (Recommended)

---

### Q19. Should SPEC-013 add a supported package-level library API in addition to CLI and MCP?

**Branch:** Public API

**Recommended answer:** Typed library method
> Export `queryCypher` and result/error types through the existing package entry
> so CLI and MCP consume one supported contract. Keep lexer/parser/planner types
> private so implementation details can evolve.

**Alternatives offered:**
- CLI and MCP only: Keep the engine internal.
- Parser API too: Export grammar and AST internals for third-party tools.

**User's answer:** Typed library method (Recommended)

---

### Q20. Which `count` forms should the documented subset support?

**Branch:** Aggregation

**Recommended answer:** Count star and value
> Support `count(*)` and `count(expr)` with implicit grouping by non-aggregate
> RETURN items. This covers hub-ranking recipes while deferring DISTINCT and
> every other aggregation.

**Alternatives offered:**
- Count star only: Smaller but weak for null-aware counts.
- Include distinct: Also support `count(DISTINCT expr)`.

**User's answer:** Count star and value (Recommended)

---

### Q21. How many graph patterns should one v1 query support?

**Branch:** MATCH scope

**Recommended answer:** One connected pattern
> Allow one MATCH clause containing one connected node-edge chain. This avoids
> Cartesian products, multi-clause binding, and join-order complexity while
> delivering the roadmap's callers/path/hub recipes.

**Alternatives offered:**
- Comma patterns: Allow multiple patterns and shared variables.
- Multiple MATCH clauses: Support sequential matching and joins.

**User's answer:** One connected pattern (Recommended)

---

### Q22. Should v1 support binding a complete pattern path, such as `MATCH p = (a)-[:calls*1..3]->(b) RETURN p`?

**Branch:** Path projection

**Recommended answer:** Support path binding
> First-class path binding makes path-between and flow recipes return typed,
> ordered evidence without reconstructing it from endpoint variables.

**Alternatives offered:**
- Endpoints only: Return nodes and relationships but no complete path value.
- Implicit path column: Always add a path even when it was not projected.

**User's answer:** Support path binding (Recommended)

---

### Q23. Should WHERE and RETURN support nested access into edge metadata or other JSON-valued fields in v1?

**Branch:** JSON property scope

**Recommended answer:** Opaque JSON only
> Allow whole metadata/decorator values to be returned, but permit predicates
> only on stable top-level public fields. This avoids freezing arbitrary JSON
> internals as query-language schema.

**Alternatives offered:**
- Nested key access: Support dotted SQLite JSON paths.
- Hide JSON fields: Exclude metadata and arrays entirely.

**User's answer:** Opaque JSON only (Recommended)

---

### Q24. Which WHERE operators should v1 include beyond null checks?

**Branch:** Predicate language

**Recommended answer:** Core comparisons only
> The minimal recommendation was `=`, `<>`, `<`, `<=`, `>`, `>=`, `AND`, `OR`,
> `NOT`, and parentheses, deferring string/list operators.

**Alternatives offered:**
- Add string matching: Also support `STARTS WITH`, `ENDS WITH`, and `CONTAINS`.
- Add strings and IN: Add string predicates plus IN-list membership.

**User's answer:** Add string matching

---

### Q25. How should keyword, label/type, and property-name casing behave?

**Branch:** Lexical casing

**Recommended answer:** Keywords insensitive
> Parse grammar keywords case-insensitively while requiring canonical
> case-sensitive node labels, relationship types, public camelCase properties,
> variables, and aliases. This keeps the language familiar without hiding schema
> typos.

**Alternatives offered:**
- Everything insensitive: Accept any casing for every name.
- Everything sensitive: Require exact casing even for MATCH and RETURN.

**User's answer:** Keywords insensitive (Recommended)

---

### Q26. Should v1 support backtick-escaped identifiers and aliases?

**Branch:** Identifier grammar

**Recommended answer:** Bare identifiers only
> The minimal recommendation was a documented ASCII identifier grammar with
> reserved words rejected unless renamed.

**Alternatives offered:**
- Backticks too: Allow escaped spaces, punctuation, and reserved words.
- Quoted aliases only: Permit quoted RETURN aliases but not other identifiers.

**User's answer:** Backticks too

---

### Q27. What maximum Cypher query-text size should every surface accept?

**Branch:** Input bounding

**Recommended answer:** Ten thousand characters
> Reuse the MCP free-form input ceiling of 10,000 characters and reject larger
> positional/stdin/MCP/library payloads before lexing.

**Alternatives offered:**
- Four thousand characters: Tighter but restrictive for generated queries.
- One megabyte: Flexible but increases parser-abuse and memory exposure.

**User's answer:** Ten thousand characters (Recommended)

---

### Q28. The estimator projects about 675 reviewable LOC and recommends two slices; how should SPEC-013 be delivered?

**Branch:** Slice sizing and PR strategy

**Recommended answer:** Two rule slices
> Slice 1 ships bounded connected-path queries end-to-end through library, CLI,
> and MCP. Slice 2 adds count/grouping, string predicates, backticks, and recipe
> closure across the same surfaces. Both remain thin vertical capabilities.

**Alternatives offered:**
- Keep one spec: Deliver the entire subset in one review despite the warning.
- Three interface slices: Split library, CLI, and MCP into separate PRs.

**User's answer:** Other: "two slices but make sure we use gh-stack if more than one pr is required"

**Notes:** The accepted implementation route is one linear two-PR stack when
the task/atomicity gates confirm multiple PRs. Use the installed `gh-stack`
skill non-interactively: foundational slice at the bottom, language/recipe
closure above it; pass explicit branch names, `--remote origin` when required,
`gh stack submit --auto`, and `gh stack view --json`.

---

### Q29. What self-repository acceptance bar should the workflow require before SPEC-013 can merge?

**Branch:** Dogfooding and acceptance

**Recommended answer:** Recipes plus guardrails
> Run every documented recipe against CodeGraph's live index, manually verify
> representative graph answers, prove CLI/MCP canonical JSON parity, and
> exercise the row, path, timeout, syntax, and read-only guards. This implements
> the constitution's binding self-repo UAT rule.

**Alternatives offered:**
- Three smoke queries: One node, edge, and path query on the live index.
- Automated fixtures only: Skip real-index validation.

**User's answer:** Recipes plus guardrails (Recommended)

## Open Questions

No critical product or behavior questions remain from Grill Me. The planning
phase must still name the exact two stack branch suffixes and map each task to
one accepted vertical rule slice. That is an operational delivery detail, not a
deferred product decision; the lower branch must contain all foundations needed
by the upper branch.

Context7 was selected for current `node:sqlite` API grounding but its transport
was unavailable during this session. The fallback was the official Node 24
SQLite documentation linked in Q12; confidence is high for the conclusion that
`DatabaseSync` is synchronous and its constructor `timeout` governs lock waits,
not arbitrary statement execution.

## Recommended Next Step

Continue `$speckit-pro:speckit-scaffold-spec SPEC-013`: generate the populated
workflow and SPEC-MOC in this worktree, commit and push the scaffold, then start
a new Codex task rooted at this exact worktree and run
`$speckit-autopilot docs/ai/specs/.process/SPEC-013-workflow.md`.
