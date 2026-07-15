# MCP - Local Rules

Full detail: root `AGENTS.md` and `.specify/memory/constitution.md`.

- `src/mcp/server-instructions.ts` is the single source of truth for
  agent-facing tool guidance.
- `getExploreBudget` and `getExploreOutputBudget` in `tools.ts` must stay
  monotonic with repo size; a larger tier never gets a smaller per-file cap.
- Tool output must not tell the agent to use Read. Steer to another
  `codegraph_explore` call and say returned source can be treated as read.
- Use `isError: true` only for security refusals or real malfunctions. Expected
  recoverable states return success-shaped guidance.
- Keep tools exposed even at an unindexed root; safety comes from response
  shape, not hiding the surface.
- Retrieval-affecting changes need deterministic probes plus A/B validation
  before merge claims.
