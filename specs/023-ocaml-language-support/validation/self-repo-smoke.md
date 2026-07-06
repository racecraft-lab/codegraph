# SPEC-023 Self-Repo Retrieval Smoke

Status: complete for deterministic CodeGraph probe harness.

## Index Target

- Project path: `/Users/fredrickgabelmann/Documents/Business_Documents/RSE_Documents/Projects/codegraph/.worktrees/023-ocaml-language-support`
- Command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 CODEGRAPH_NO_DAEMON=1 node dist/bin/codegraph.js init <active-worktree>`
- Node caveat: local `node` is `v26.0.0`, so commands required `CODEGRAPH_ALLOW_UNSAFE_NODE=1`.
- Result: initialized active worktree index, scanned 428 files, indexed 428 files, 6,065 nodes, 24,406 edges.

## Status Command

```bash
CODEGRAPH_ALLOW_UNSAFE_NODE=1 CODEGRAPH_NO_DAEMON=1 node dist/bin/codegraph.js status --json /Users/fredrickgabelmann/Documents/Business_Documents/RSE_Documents/Projects/codegraph/.worktrees/023-ocaml-language-support
```

Summary:

- `initialized`: true
- `projectPath`: active SPEC-023 worktree
- `fileCount`: 428
- `nodeCount`: 6,065
- `edgeCount`: 24,406
- `languages`: `astro`, `javascript`, `ocaml`, `python`, `typescript`, `yaml`
- `pendingChanges`: 0 added, 0 modified, 0 removed
- `worktreeMismatch`: null
- `reindexRecommended`: false

## Probe

```bash
CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-explore.mjs /Users/fredrickgabelmann/Documents/Business_Documents/RSE_Documents/Projects/codegraph/.worktrees/023-ocaml-language-support "OCaml getParser ocaml_interface loadGrammar isGrammarLoaded ImportResolver resolveOcamlReferences"
```

Result:

- Found 23 symbols across 4 files.
- Surfaced current source for `src/extraction/grammars.ts`, including `.mli`
  selection through `grammarKeyForLanguage`, `getParser(language, filePath?)`,
  and `isGrammarLoaded('ocaml')` requiring both implementation and interface
  grammars.
- Reported blast radius for `getParser` and `isGrammarLoaded`, including OCaml
  parser/extraction tests.

```bash
CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-node.mjs /Users/fredrickgabelmann/Documents/Business_Documents/RSE_Documents/Projects/codegraph/.worktrees/023-ocaml-language-support getParser code
CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-node.mjs /Users/fredrickgabelmann/Documents/Business_Documents/RSE_Documents/Projects/codegraph/.worktrees/023-ocaml-language-support resolveOcamlReferences code
```

Result:

- `getParser` returned the current function body and caller/callee trail.
- `resolveOcamlReference` returned the OCaml unique-only resolver body and
  caller/callee trail from `src/resolution/import-resolver.ts`.

## Read/Grep Outcome

- Deterministic probe harness: 0 Read, 0 Grep.
- Headless Claude-agent A/B: blocked because `which claude` returned
  `claude not found`.
