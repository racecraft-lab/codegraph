# Yojson Smoke Evidence

Status: pass with local Node runtime caveat.

## Required Fields

- Repository URL: `https://github.com/ocaml-community/yojson`
- Commit SHA: `d692c15dc630a1a1635719b5426299df6f02c5ef`
- Source file count: 48 `*.ml` / `*.mli` files by `find . -name '*.ml' -o -name '*.mli'`
- Index command:
  - `CODEGRAPH_ALLOW_UNSAFE_NODE=1 CODEGRAPH_NO_DAEMON=1 node <SPEC-023-worktree>/dist/bin/codegraph.js init`
  - `CODEGRAPH_ALLOW_UNSAFE_NODE=1 CODEGRAPH_NO_DAEMON=1 node <SPEC-023-worktree>/dist/bin/codegraph.js index --quiet`
- Status command:
  - `CODEGRAPH_ALLOW_UNSAFE_NODE=1 CODEGRAPH_NO_DAEMON=1 node <SPEC-023-worktree>/dist/bin/codegraph.js status --json`
- `filesByLanguage`: `["ocaml","yaml"]`
- File count: 66 indexed files
- Node count: 1,329
- Edge count: 1,937
- Nodes by kind: `{"constant":310,"enum":4,"enum_member":36,"field":24,"file":64,"function":340,"interface":2,"module":86,"parameter":445,"struct":7,"type_alias":11}`
- Backend: `node-sqlite`, WAL enabled
- Parse warnings/errors: none surfaced in `init`, `index --quiet`, or status output
- Second-run stability: pass; second index completed with unchanged status counts and `pendingChanges` all zero
- Retrieval probe outcomes: pass for the three Yojson deterministic probe questions in `yojson-probes.md`

## Runtime Caveat

The local shell runtime was Node `v26.0.0`, which CodeGraph warns is unsupported because of the Node 25+ tree-sitter WASM crash risk. The smoke used `CODEGRAPH_ALLOW_UNSAFE_NODE=1` to exercise the built SPEC-023 CLI anyway. This is acceptable smoke evidence for extractor behavior, but release validation should prefer Node 22 LTS.
