# Yojson Probe Evidence

Status: pass.

See `retrieval-probes.md` for the three required Yojson questions and fields.

Repository: `https://github.com/ocaml-community/yojson`
Commit SHA: `d692c15dc630a1a1635719b5426299df6f02c5ef`

## Probe 1: `from_string` Parse Flow

- Question: How does `from_string` parse JSON text into a Yojson value?
- `probe-explore` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-explore.mjs /private/tmp/spec-023-ocaml-repos/yojson "from_string parse_from_string Parser.parse_from_string Yojson.Safe"`
- `probe-explore` result: found 61 symbols across 3 files and surfaced `lib/json5/parser.ml`, `lib/json5/read.ml`, and `lib/json5/yojson_five.mli`.
- Key evidence: `Read.Make.from_string` calls `Parser.parse_from_string`, which calls `parse_from_lexbuf (Sedlexing.Utf8.from_string input)`.
- `probe-node` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-node.mjs /private/tmp/spec-023-ocaml-repos/yojson from_string code`
- `probe-node` result: returned all 6 ambiguous `from_string` definitions in full, including `lib/json5/read.ml`, `lib/json5/yojson_five.mli`, `lib/read.mli`, and `test/test_read.ml`.
- Explore budget: within one explore call for a 66-file indexed repository.
- Known gap: no agent A/B conclusion here; this is deterministic probe evidence only.

## Probe 2: `to_string` / Pretty-Print Serialization

- Question: How does `to_string` or pretty-printing serialize a Yojson value?
- `probe-explore` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-explore.mjs /private/tmp/spec-023-ocaml-repos/yojson "to_string Prettyprint.to_string Write.to_string to_buffer pp"`
- `probe-explore` result: found 66 symbols across 3 files and surfaced `lib/write.ml`, `lib/write.mli`, and `lib/prettyprint.ml`.
- Key evidence: `Write.to_string` calls `to_buffer`, which calls `write_json`; `Prettyprint.to_string` calls `Format.asprintf` through `pp`.
- `probe-node` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-node.mjs /private/tmp/spec-023-ocaml-repos/yojson to_string code`
- `probe-node` result: returned all 7 ambiguous `to_string` definitions in full with caller/callee trails for `Prettyprint.to_string`, `Util.to_string`, and `Write.to_string`.
- Explore budget: within one explore call for a 66-file indexed repository.
- Known gap: no agent A/B conclusion here; this is deterministic probe evidence only.

## Probe 3: Safe/Common/Util `.ml` and `.mli` Exposure

- Question: How are Safe/Common/Util declarations exposed across `.ml` and `.mli` files?
- `probe-explore` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-explore.mjs /private/tmp/spec-023-ocaml-repos/yojson "Yojson.Safe Safe Common Util interface implementation mli ml"`
- `probe-explore` result: found 37 symbols across 4 files and surfaced `lib/common.mli`, `lib/safe.cppo.mli`, `lib/util.mli`, and `lib/yojson.mli`.
- Key evidence: `.mli` interface declarations for `Common`, `Util`, and public `Yojson.Safe` exposure are indexed and returned without requiring file reads.
- `probe-node` command: `CODEGRAPH_ALLOW_UNSAFE_NODE=1 node scripts/agent-eval/probe-node.mjs /private/tmp/spec-023-ocaml-repos/yojson Safe code`
- `probe-node` result: returned all 5 ambiguous `Safe` module definitions, including implementation aliases in `lib/json5/safe.ml`, `lib/json5/yojson_five.ml`, `lib/yojson.ml`, and interface declarations in `lib/json5/yojson_five.mli` and `lib/yojson.mli`.
- Explore budget: within one explore call for a 66-file indexed repository.
- Known gap: no agent A/B conclusion here; this is deterministic probe evidence only.
