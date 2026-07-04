# MCP server — do-not-regress rules

Full detail: root CLAUDE.md → "Retrieval performance & dynamic-dispatch coverage"; constitution Principle VI.

- `src/mcp/server-instructions.ts` is the single source of truth for agent-facing tool guidance (#529) — edit guidance there and nowhere else.
- `getExploreBudget` / `getExploreOutputBudget` in `tools.ts` must stay monotonic with repo size — a larger tier never gets a smaller `maxCharsPerFile` than a smaller tier.
- Tool output never tells the agent to "use Read" — steer to another `codegraph_explore` and treat returned source as already Read.
- `isError: true` only for genuine stop-trying cases (security refusals, real malfunctions). Every expected/recoverable condition returns a success-shaped response carrying the guidance — one or two early errors teach the agent to abandon the tool entirely.
- Tools stay exposed even at an un-indexed root (#964) — safety comes from response shape, not from hiding tools. Indexing is the user's call, never the agent's.
- Retrieval-affecting changes need the A/B validation before merge: ≥2 runs per arm, both arms on the Sonnet floor model, no regression on a control repo.
