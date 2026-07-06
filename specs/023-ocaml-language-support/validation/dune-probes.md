# Dune Probe Evidence

Status: pass with local Node runtime caveat.

See `retrieval-probes.md` for the three required Dune questions and fields.

Repository: `https://github.com/ocaml/dune`
Commit SHA: `7ad482c95af63d8f996af30c4d13fffe2ba144c1`

## Probe 1: `dune build` Stanzas to Build Rules

- Question: How does a `dune build` stanza become a build rule?
- `probe-explore` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-explore.mjs /private/tmp/spec-023-ocaml-repos/dune "Dune_load.stanzas_in_dir Dune_file.stanzas Buildable_rules.modules_rules Super_context.add_rule gen_rules stanza rules"`
- `probe-explore` result: found 29 symbols across 6 files and surfaced `src/dune_rules/dune_load.ml`, `src/dune_rules/dune_file.ml`, `src/dune_rules/buildable_rules.ml`, `src/dune_rules/super_context.ml`, and related rule files.
- Key evidence: `Dune_load.stanzas_in_dir` retrieves evaluated dune files, `Dune_file.stanzas` exposes the stanzas, buildable rule generation flows through `Buildable_rules.modules_rules`, and rules are registered through `Super_context.add_rule`.
- `probe-node` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-node.mjs /private/tmp/spec-023-ocaml-repos/dune modules_rules code`
- `probe-node` result: returned all 3 `modules_rules` definitions in full, including the preprocessing and module-rule construction bodies in `src/dune_rules/buildable_rules.ml`.
- Explore budget: within one explore call; the 2,711-file indexed repository allows the medium tier of two explore calls.
- Known gap: no agent A/B conclusion here; this is deterministic probe evidence only.

## Probe 2: `dune-project` and opam Metadata

- Question: How are `dune-project` and opam package metadata read and applied?
- `probe-explore` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-explore.mjs /private/tmp/spec-023-ocaml-repos/dune "dune-project Dune_project decode Package load_opam_file_with_contents Dune_load.packages opam_file"`
- `probe-explore` result: found 76 symbols across 7 files and surfaced `src/dune_rules/dune_load.ml`, `src/dune_lang/package.ml`, `src/dune_lang/package.mli`, `src/dune_lang/package_info.ml`, and `src/dune_pkg/opam_file.ml`.
- Key evidence: `Dune_load.load` collects projects and packages, `Dune_load.packages` exposes the filtered package map, and `load_opam_file_with_contents` parses checked-in opam file contents into `Dune_lang.Package` records.
- `probe-node` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-node.mjs /private/tmp/spec-023-ocaml-repos/dune load_opam_file_with_contents code`
- `probe-node` result: returned all 5 matching definitions in full, including the concrete parser/constructor body in `src/dune_pkg/opam_file.ml:225` and the public signature in `src/dune_pkg/opam_file.mli`.
- Explore budget: within one explore call; the 2,711-file indexed repository allows the medium tier of two explore calls.
- Known gap: no agent A/B conclusion here; this is deterministic probe evidence only.

## Probe 3: Scheduler and Action Execution

- Question: How does rule execution flow through scheduler/action execution?
- `probe-explore` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-explore.mjs /private/tmp/spec-023-ocaml-repos/dune "Build_system.execute_action Action_exec exec Scheduler Action_builder run action"`
- `probe-explore` result: found 36 symbols across 7 files and surfaced a call path `Action_exec.exec` -> `exec_list` -> `Action_exec.exec`.
- Key evidence: `src/dune_engine/build_system.mli` exposes cached action execution, `src/dune_engine/action_exec.ml` executes action forms and recursively runs action lists, and scheduler entry points in `src/dune_scheduler/scheduler.ml` and `bin/scheduler_setup.ml` run the fiber scheduler around build work.
- `probe-node` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-node.mjs /private/tmp/spec-023-ocaml-repos/dune exec code`
- `probe-node` result: returned 8 of 25 ambiguous `exec` definitions in full and listed the remaining definitions. The returned set included `src/dune_engine/action_exec.ml:107`, `src/dune_engine/action_exec.ml:354`, and `src/dune_engine/action_exec.mli:40`.
- Explore budget: within one explore call; the 2,711-file indexed repository allows the medium tier of two explore calls.
- Known gap: no agent A/B conclusion here; this is deterministic probe evidence only.

## Runtime Caveat

The local shell runtime was Node `v26.0.0`, which CodeGraph warns is unsupported because of the Node 25+ tree-sitter WASM crash risk. The probes used `CODEGRAPH_ALLOW_UNSAFE_NODE=1` to exercise the built SPEC-023 CLI anyway. Release validation should prefer Node 22 LTS.
