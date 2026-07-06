# Dune Smoke Evidence

Status: pass with local Node runtime caveat.

## Required Fields

- Repository URL: `https://github.com/ocaml/dune`
- Commit SHA: `7ad482c95af63d8f996af30c4d13fffe2ba144c1`
- Source file count: 2,801 `*.ml` / `*.mli` files by `find . -name '*.ml' -o -name '*.mli'`
- Index command:
  - `CODEGRAPH_ALLOW_UNSAFE_NODE=1 CODEGRAPH_NO_DAEMON=1 node <SPEC-023-worktree>/dist/bin/codegraph.js init`
  - `CODEGRAPH_ALLOW_UNSAFE_NODE=1 CODEGRAPH_NO_DAEMON=1 node <SPEC-023-worktree>/dist/bin/codegraph.js index --quiet`
- Status command:
  - `CODEGRAPH_ALLOW_UNSAFE_NODE=1 CODEGRAPH_NO_DAEMON=1 node <SPEC-023-worktree>/dist/bin/codegraph.js status --json`
- `filesByLanguage`: `["c","cpp","javascript","ocaml","php","python","yaml"]`
- File count: 2,711 indexed files
- Node count: 80,650
- Edge count: 119,297
- Nodes by kind: `{"class":4,"constant":18923,"enum":1152,"enum_member":3825,"field":3988,"file":2692,"function":17673,"import":263,"interface":204,"method":10,"module":6728,"parameter":22546,"struct":1030,"type_alias":1573,"variable":39}`
- Backend: `node-sqlite`, WAL enabled
- Parse warnings/errors: none surfaced in `init`, `index --quiet`, or status output
- Second-run stability: pass; second index completed with unchanged status counts and `pendingChanges` all zero
- Retrieval probe outcomes: pending in `dune-probes.md`

## Runtime Caveat

The local shell runtime was Node `v26.0.0`, which CodeGraph warns is unsupported because of the Node 25+ tree-sitter WASM crash risk. The smoke used `CODEGRAPH_ALLOW_UNSAFE_NODE=1` to exercise the built SPEC-023 CLI anyway. This is acceptable smoke evidence for extractor behavior, but release validation should prefer Node 22 LTS.
