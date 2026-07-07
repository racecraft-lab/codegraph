# Language and Feature Parity Baseline

**Date:** 2026-07-05
**Purpose:** Track full parity against the reproduced language-support matrix
and feature list required for SPEC-008 and future compatibility work.

This is a no-waiver audit. A row is not closed by intent, backlog language, or a
partial implementation. A row closes only when CodeGraph has an implemented
capability, tests, and self-repo validation evidence, or a concrete numbered spec
that owns the remaining work.

Do not add outbound links or external project names to this file. The required
baseline is reproduced below so implementation specs can validate parity without
referencing an external repository.

## Capability Contract

| Baseline capability | Owner | Parity gate |
|---|---|---|
| Multi-phase graph pipeline: structure, parsing, resolution, clustering, processes, search | Existing graph + SPEC-001, SPEC-003, SPEC-011 | SPEC-024 must verify every phase exists and is exposed in CLI/MCP/API |
| Field/property type resolution and return-type-aware binding | Existing resolution + SPEC-008 LSP precision | SPEC-024 must audit all matrix languages for type/binding parity fixtures |
| Hybrid search: BM25 + semantic + RRF | SPEC-003 | SPEC-024 must require process-grouped hybrid query parity after SPEC-003 |
| Process groups / execution flows | SPEC-011 | SPEC-024 must require flow list/get parity and process participation in context |
| Functional clusters with cohesion scores | SPEC-011 | SPEC-024 must require cluster list/get parity and stable ids |
| Blast-radius impact with depth grouping and confidence | Existing impact + SPEC-011/SPEC-012 enrichment | SPEC-024 must verify confidence/depth grouping or add concrete sub-spec |
| Git diff impact detection | SPEC-012 | SPEC-024 must verify changed-line to symbol/process mapping |
| Multi-file rename with graph + text search | SPEC-010 | SPEC-024 must verify CLI + MCP rename parity |
| Raw Cypher graph queries | SPEC-013 | SPEC-024 must verify CLI + MCP Cypher parity plus schema resource |
| MCP resources for repos, repo context, clusters, processes, schema | SPEC-011, SPEC-013, SPEC-021, SPEC-024 | SPEC-024 owns resource-surface parity audit and any missing resource implementation |
| MCP prompts `detect_impact` and `generate_map` | SPEC-012, SPEC-019, SPEC-024 | SPEC-024 owns prompt-surface parity audit and any missing prompt implementation |
| Wiki generation with custom model | SPEC-018, SPEC-019 | SPEC-024 must verify CLI command and model-config parity |
| Multi-repo global registry and optional `repo` param | SPEC-021, SPEC-022, SPEC-024 | SPEC-024 must verify global repo discovery/list/query parity |
| Repository groups: create/add/remove/list/sync/contracts/query/status | SPEC-021, SPEC-022 | SPEC-024 must verify all group subcommands and MCP parity |
| Remote embeddings with OpenAI-compatible endpoint and tuning env vars | SPEC-001, SPEC-002, SPEC-003 | SPEC-024 must verify env/config parity or document equivalent CodeGraph vars |
| Installer setup/uninstall, agent skills, hooks | Existing installer + SPEC-024 | SPEC-024 must compare agent support and close any agent integration gaps still present |
| Analyzer repair/rebuild/verbose/max-file-size/worker-timeout/WAL/FTS/CJK/resilience knobs | Existing index/sync + SPEC-024 | SPEC-024 must map every operational flag/env var to CodeGraph equivalent or implement it |

## Language Feature Matrix

This matrix has 13 languages and 9 feature columns. CodeGraph must prove every
advertised checkmark for those rows, plus each additional language in the
addendum below.

| Language | Imports | Named Bindings | Exports | Heritage | Type Annotations | Constructor Inference | Config | Frameworks | Entry Points | CodeGraph owner |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| TypeScript | yes | yes | yes | yes | yes | yes | yes | yes | yes | SPEC-024 audit over existing support + SPEC-008 LSP |
| JavaScript | yes | yes | yes | yes | no | yes | yes | yes | yes | SPEC-024 audit over existing support + SPEC-008 LSP |
| Python | yes | yes | yes | yes | yes | yes | yes | yes | yes | SPEC-024 audit over existing support + SPEC-008 LSP |
| Java | yes | yes | yes | yes | yes | yes | no | yes | yes | SPEC-024 audit over existing support + SPEC-008 LSP |
| Kotlin | yes | yes | yes | yes | yes | yes | no | yes | yes | SPEC-024 audit over existing support + SPEC-008 LSP |
| C# | yes | yes | yes | yes | yes | yes | yes | yes | yes | SPEC-024 audit over existing support + SPEC-008 LSP |
| Go | yes | no | yes | yes | yes | yes | yes | yes | yes | SPEC-024 audit over existing support + SPEC-008 LSP |
| Rust | yes | yes | yes | yes | yes | yes | no | yes | yes | SPEC-024 audit over existing support + SPEC-008 LSP |
| PHP | yes | yes | yes | no | yes | yes | yes | yes | yes | SPEC-024 audit over existing support + SPEC-008 LSP |
| Ruby | yes | no | yes | yes | no | yes | no | yes | yes | SPEC-024 audit over existing support + SPEC-008 LSP |
| Swift | no | no | yes | yes | yes | yes | yes | yes | yes | SPEC-024 audit over existing support + SPEC-008 LSP |
| C | no | no | yes | no | yes | yes | no | yes | yes | SPEC-024 audit over existing support + SPEC-008 LSP |
| C++ | no | no | yes | yes | yes | yes | no | yes | yes | SPEC-024 audit over existing support + SPEC-008 LSP |

## Additional Language Baseline

Full parity also requires Dart, Vue, and COBOL to be audited even though they
are not in the 13-language matrix above.

| Additional language | Classification | CodeGraph owner | Parity gate |
|---|---|---|---|
| Dart | production | SPEC-024 audit over existing support + SPEC-008 LSP where applicable | Must prove support equal to or stronger than the baseline |
| Vue | experimental | SPEC-024 audit over existing support + SPEC-008 LSP where applicable | Must prove support equal to or stronger than the baseline |
| COBOL | experimental | SPEC-024 audit over existing support | Must prove support equal to or stronger than the baseline |

## Closure Rule

SPEC-008 may proceed only after the Plan phase imports this baseline and
produces a language-server parity matrix. The platform may not claim full
parity until SPEC-024, or its decomposed numbered child specs, closes every row
above with implementation and validation evidence.
