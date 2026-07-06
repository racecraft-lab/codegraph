# SPEC-023 Validation Evidence Index

This directory records evidence for OCaml language support. Local implementation
evidence and deterministic real-repository smoke/probes are complete. Yojson
and OCaml-LSP A/B evidence is recorded; Dune A/B remains a follow-up gate.

## Required Records

| Evidence | File | Status |
|----------|------|--------|
| Grammar/status parser health and copied artifacts | `grammar-status.md` | Complete |
| Extraction breadth and spans | `extraction.md` | Complete locally |
| Conservative resolution and negative cases | `resolution.md` | Complete locally |
| PPX non-expansion boundary | `ppx-boundary.md` | Complete locally |
| Yojson smoke/probes/A/B | `yojson-smoke.md`, `yojson-probes.md`, `yojson-ab.md` | Complete; A/B shows weak adoption |
| OCaml-LSP smoke/probes/A/B | `ocaml-lsp-smoke.md`, `ocaml-lsp-probes.md`, `ocaml-lsp-ab.md` | Complete with adjusted safer A/B |
| Dune smoke/probes/A/B gate | `dune-smoke.md`, `dune-probes.md`, `dune-ab-gate.md` | Smoke/probes complete; A/B follow-up gate recorded |
| Self-repo retrieval smoke | `self-repo-smoke.md` | Complete |
| Existing-language controls | `existing-language-controls.md`, `existing-language-ab-gate.md` | Test controls complete; A/B blocked |
| Quickstart run and marker scan | `quickstart-run.md` | Complete with recorded follow-up gate |
| PR packet traceability | `pr-packet-traceability.md` | Complete |
| Manual UAT | `manual-uat.md`, `.process/uat-runbook.md` | Complete for PR #21; Dune A/B follow-up gate preserved |

## Smoke/Probe Fields

Each real-repository smoke record must include repository URL, commit SHA, index
command, `filesByLanguage`, node count, edge count, parse warning/error summary,
second-run stability, and retrieval probe outcomes. Probe records must include
the prompt, `probe-explore` result, `probe-node` result, explore-budget outcome,
and known gap if not passing.
