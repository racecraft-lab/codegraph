# CodeGraph Agent Guide

`AGENTS.md` is the canonical instruction source for this repository. `CLAUDE.md`
and `GEMINI.md` are wrappers only and must contain exactly `@AGENTS.md`.

## Project Capsule

CodeGraph is a local-first code intelligence library, CLI, and MCP server. It
parses supported codebases with tree-sitter, stores files, symbols, and edges in
SQLite FTS5 under `.codegraph/`, and exposes graph context to coding agents.
Graph structure is deterministic static analysis, not LLM output.

The npm package is `@colbymchenry/codegraph`. The same binary handles install,
index, sync, query, daemon, MCP, and web-server commands.

## Commands

```bash
npm run build
npm test
npm run test:eval
npm run eval
npm run cli
npx vitest run __tests__/installer-targets.test.ts
```

`npm run build` runs TypeScript, copies `src/db/schema.sql`,
`src/extraction/wasm/*.wasm`, and `src/server/openapi.yaml` into `dist/`, then
chmods the CLI. Any new SQL, WASM, or shipped static asset must be wired into
`copy-assets`.

Node engines are `>=20.0.0 <25.0.0`. Source runs that touch `node:sqlite` need
Node 22.5+; the bundled runtime satisfies that.

## Working Rules

- Think before coding. State assumptions, surface competing interpretations,
  and ask when confusion would change the implementation.
- Simplicity first. Implement the smallest solution that satisfies the stated
  goal; no speculative flags, abstractions, rewrites, or configurability.
- Surgical changes. Every changed line should trace to the task. Match local
  style and leave unrelated cleanup for a separate request.
- Verifiable goals. Convert broad asks into concrete checks, start bug fixes
  from a failing reproduction when practical, and report completion with
  evidence.
- Keep proportionality. For a trivial edit, do the trivial edit plus the
  smallest relevant verification.

## Retrieval And Dogfooding

- Use `codegraph_explore` before Read/Grep/file search for structural questions,
  flow tracing, architecture surveys, and pre-edit context. Treat returned source
  as already read.
- Do not delegate exploration that one `codegraph_explore` call can answer.
- If the graph is not indexed or cannot answer, say that plainly and continue
  with normal repo inspection. Do not run `codegraph init` unless the user asks.
- Agent-facing MCP tool guidance lives in `src/mcp/server-instructions.ts`.
  Update that file, not copied instruction blocks.
- This repo dogfoods HEAD through `.codex/config.toml`, `.mcp.json`, and
  `scripts/mcp-dogfood.mjs`. Build before relying on the dogfood MCP server.

## Stable Boundaries

- This is the racecraft tracking fork. Pushes and PRs target `origin`
  (`racecraft-lab/codegraph`). `upstream` (`colbymchenry/codegraph`) is fetch-only.
- Never put Claude Code, Codex, or other session URLs in commits or PR text.
- CodeGraph provides code context, not product requirements. Ask for UX, edge
  cases, and acceptance criteria when a feature request needs them.
- Changes under `src/installer/` need matching coverage in
  `__tests__/installer-targets.test.ts` and a user-facing `CHANGELOG.md` entry.
- Public API changes flow through `src/index.ts` and exported types. Avoid
  broadening runtime behavior accidentally.
- Privacy and dormancy are product constraints: unconfigured capabilities must
  make no network calls and no unexpected schema writes.

## Releases And Changelog

- Write release notes under `## [Unreleased]`; do not pre-create version blocks.
- Changelog bullets are user-facing: capability or symptom first, no internal
  file paths or benchmark internals.
- Releases ship through the GitHub Actions Release workflow. Do not run
  `npm publish`, create release tags, or trigger publish actions unless the user
  explicitly asks for that release operation.

## Scoped Guidance

Additional `AGENTS.md` files are intentionally small and local. Check the file
nearest your working directory for stricter rules:

- `__tests__/`
- `scripts/agent-eval/`
- `src/db/`
- `src/extraction/`
- `src/installer/`
- `src/mcp/`
- `src/refactor/`
- `src/resolution/`
- `src/server/`
- `src/sync/`
- `site/`
- `telemetry-worker/`
- `.specify/`

Use `.specify/memory/constitution.md` for binding project law, and
`docs/ai/specs/intelligence-platform-technical-roadmap.md` for roadmap state.
Generated status, completed-feature ledgers, and plan pointers stay in workflow
artifacts, not in agent instruction files.

## Instruction Maintenance

Keep root guidance below 200 lines. A line belongs here only when it is stable,
broadly applicable, non-discoverable from code, and prevents a demonstrated
mistake. Put procedures in skills or docs, and put directory-only tripwires in
scoped `AGENTS.md` files.
