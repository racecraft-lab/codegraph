# OCaml-LSP Smoke Evidence

Status: pass with local Node runtime caveat.

## Required Fields

- Repository URL: `https://github.com/ocaml/ocaml-lsp`
- Commit SHA: `329c4d684a4358398795a6e317052605c88c3e80`
- Source file count: 374 `*.ml` / `*.mli` files by `find . -name '*.ml' -o -name '*.mli'`
- Index command:
  - `CODEGRAPH_ALLOW_UNSAFE_NODE=1 CODEGRAPH_NO_DAEMON=1 node <SPEC-023-worktree>/dist/bin/codegraph.js init`
  - `CODEGRAPH_ALLOW_UNSAFE_NODE=1 CODEGRAPH_NO_DAEMON=1 node <SPEC-023-worktree>/dist/bin/codegraph.js index --quiet`
- Status command:
  - `CODEGRAPH_ALLOW_UNSAFE_NODE=1 CODEGRAPH_NO_DAEMON=1 node <SPEC-023-worktree>/dist/bin/codegraph.js status --json`
- `filesByLanguage`: `["c","javascript","ocaml","typescript","yaml"]`
- File count: 382 indexed files
- Node count: 16,382
- Edge count: 21,700
- Nodes by kind: `{"class":13,"constant":3384,"enum":206,"enum_member":939,"field":1587,"file":376,"function":3045,"import":133,"interface":12,"method":115,"module":1354,"parameter":4367,"struct":555,"type_alias":292,"variable":4}`
- Backend: `node-sqlite`, WAL enabled
- Parse warnings/errors: none surfaced in `init`, `index --quiet`, or status output
- Second-run stability: pass; second index completed with unchanged status counts and `pendingChanges` all zero
- Retrieval probe outcomes: pending in `ocaml-lsp-probes.md`

## Runtime Caveat

The local shell runtime was Node `v26.0.0`, which CodeGraph warns is unsupported because of the Node 25+ tree-sitter WASM crash risk. The smoke used `CODEGRAPH_ALLOW_UNSAFE_NODE=1` to exercise the built SPEC-023 CLI anyway. This is acceptable smoke evidence for extractor behavior, but release validation should prefer Node 22 LTS.
