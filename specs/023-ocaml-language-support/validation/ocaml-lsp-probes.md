# OCaml-LSP Probe Evidence

Status: pass with local Node runtime caveat.

See `retrieval-probes.md` for the three required OCaml-LSP questions and
fields.

Repository: `https://github.com/ocaml/ocaml-lsp`
Commit SHA: `329c4d684a4358398795a6e317052605c88c3e80`

## Probe 1: `textDocument/hover` Dispatch to Hover Output

- Question: How does `textDocument/hover` reach the code that computes hover output?
- `probe-explore` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-explore.mjs /private/tmp/spec-023-ocaml-repos/ocaml-lsp "textDocument/hover Hover_req.handle hover_at_cursor type_enclosing_hover Req_hover_extended on_request"`
- `probe-explore` result: found 40 symbols across 1 file and surfaced `ocaml-lsp-server/src/hover_req.ml`.
- Key evidence: `handle` loads the document, asks Merlin for the reader parsetree, uses `hover_at_cursor`, and calls `type_enclosing_hover` for normal hover responses. The caller trail also shows `on_request` in `ocaml_lsp_server.ml` and the extended-hover request path.
- `probe-node` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-node.mjs /private/tmp/spec-023-ocaml-repos/ocaml-lsp handle code`
- `probe-node` result: returned both `handle` definitions in full, including `ocaml-lsp-server/src/hover_req.ml:502`, with caller/callee trails.
- Explore budget: within one explore call for a 382-file indexed repository.
- Known gap: no agent A/B conclusion here; this is deterministic probe evidence only.

## Probe 2: `textDocument/completion` to Completion Items

- Question: How does `textDocument/completion` reach completion construction?
- `probe-explore` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-explore.mjs /private/tmp/spec-023-ocaml-repos/ocaml-lsp "textDocument/completion Compl.handle completionItem_of_completion_entry process_dispatch_resp complete_prefix completion"`
- `probe-explore` result: found 56 symbols across 4 files and surfaced `ocaml-lsp-server/src/compl.ml`, `ocaml-lsp-server/src/compl.mli`, `ocaml-lsp-server/src/hover_req.mli`, and `lsp/src/types.mli`.
- Key evidence: `complete` computes the prefix, dispatches Merlin completion or construction requests, then builds LSP `CompletionItem` values through `completionItem_of_completion_entry` and `process_dispatch_resp`.
- `probe-node` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-node.mjs /private/tmp/spec-023-ocaml-repos/ocaml-lsp complete code`
- `probe-node` result: returned all 5 ambiguous `complete` definitions in full, including `ocaml-lsp-server/src/compl.ml:194` and `ocaml-lsp-server/src/compl.ml:263`, with caller/callee trails.
- Explore budget: within one explore call for a 382-file indexed repository.
- Known gap: no agent A/B conclusion here; this is deterministic probe evidence only.

## Probe 3: Dune RPC Diagnostics to LSP Publish Diagnostics

- Question: How do Dune RPC diagnostics reach the LSP diagnostic publication path?
- `probe-explore` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-explore.mjs /private/tmp/spec-023-ocaml-repos/ocaml-lsp "Dune_rpc diagnostic_loop lsp_of_dune Diagnostics.send PublishDiagnostics set_report_dune_diagnostics"`
- `probe-explore` result: found 83 symbols across 3 files and surfaced `ocaml-lsp-server/src/dune.ml`, `ocaml-lsp-server/src/diagnostics.ml`, and `ocaml-lsp-server/src/diagnostics.mli`.
- Key evidence: `diagnostic_loop` polls Dune RPC diagnostics, maps each Dune diagnostic through `lsp_of_dune`, stores it with `Diagnostics.set`, and flushes changes through `Diagnostics.send`.
- `probe-node` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-node.mjs /private/tmp/spec-023-ocaml-repos/ocaml-lsp diagnostic_loop code`
- `probe-node` result: returned the `diagnostic_loop` body in full with a trail to `Drpc.Sub.diagnostic`, `lsp_of_dune`, `Diagnostics.set`, and `Diagnostics.send`.
- Explore budget: within one explore call for a 382-file indexed repository.
- Known gap: no agent A/B conclusion here; this is deterministic probe evidence only.

## Runtime Caveat

The local shell runtime was Node `v26.0.0`, which CodeGraph warns is unsupported because of the Node 25+ tree-sitter WASM crash risk. The probes used `CODEGRAPH_ALLOW_UNSAFE_NODE=1` to exercise the built SPEC-023 CLI anyway. Release validation should prefer Node 22 LTS.
