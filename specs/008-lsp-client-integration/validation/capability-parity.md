# Capability Parity

## Scope

This table closes SPEC-008 capability ownership against the internal baseline.
Rows outside SPEC-008 implementation scope have concrete numbered owners, not
backlog-only placeholders. There are no unowned rows.

| Capability row | Owner | Evidence | Future owner | Status |
|---|---|---|---|---|
| Multi-phase graph pipeline | Existing graph plus SPEC-001, SPEC-003, SPEC-011, and SPEC-008 insertion | LSP pass runs after structural extraction/reference resolution; default-off evidence is in `validation/slice-1.md` | SPEC-024 | Owned |
| Field/property type resolution and return-type-aware binding | Existing resolution plus SPEC-008 precision | Definition-target verification and correction evidence is recorded in `validation/slice-2.md` | SPEC-024 | Owned |
| Hybrid search | SPEC-003 | Retrieval regression evidence for corrected/suppressed LSP data is recorded in `validation/slice-2.md` | SPEC-024 | Future-owned |
| Process groups / execution flows | SPEC-011 | LSP correction is graph-edge-scoped and does not add process-group behavior | SPEC-024 | Future-owned |
| Functional clusters with cohesion scores | SPEC-011 | Node/edge stability evidence is recorded in slice validation; clustering behavior is unchanged by SPEC-008 | SPEC-024 | Future-owned |
| Blast-radius impact with depth grouping and confidence | Existing impact plus SPEC-011/SPEC-012 | Retrieval regression probes cover impact surfaces after LSP correction metadata is present | SPEC-024 | Owned |
| Git diff impact detection | SPEC-012 | Watch validation records changed-file bounds without adding diff-impact behavior | SPEC-024 | Future-owned |
| Multi-file rename with graph and text search | SPEC-010 | SPEC-008 final packet records rename/refactor as a non-goal | SPEC-024 | Future-owned |
| Raw Cypher graph queries | SPEC-013 | LSP provenance/correction metadata remains queryable through existing SQLite surfaces | SPEC-024 | Future-owned |
| MCP resources for repos, repo context, clusters, processes, and schema | SPEC-011, SPEC-013, SPEC-021, SPEC-024 | SPEC-008 does not remove MCP status or graph surfaces; resource parity remains owned by SPEC-024 | SPEC-024 | Future-owned |
| MCP prompts for impact and map generation | SPEC-012, SPEC-019, SPEC-024 | SPEC-008 preserves impact/search behavior; prompt parity remains owned by SPEC-024 | SPEC-024 | Future-owned |
| Wiki generation with custom model | SPEC-018, SPEC-019 | SPEC-008 adds no remote model, wiki, or generator behavior | SPEC-024 | Future-owned |
| Multi-repo global registry and optional repo parameter | SPEC-021, SPEC-022, SPEC-024 | LSP configuration remains project-local and does not add global registry behavior | SPEC-024 | Future-owned |
| Repository groups create/add/remove/list/sync/contracts/query/status | SPEC-021, SPEC-022 | SPEC-008 does not require repository groups and preserves per-project indexing | SPEC-024 | Future-owned |
| Remote embeddings with OpenAI-compatible endpoint and tuning env vars | SPEC-001, SPEC-002, SPEC-003 | SPEC-008 adds no embedding env vars and no remote network path | SPEC-024 | Future-owned |
| Installer setup/uninstall, agent skills, and hooks | Existing installer plus SPEC-024 | SPEC-008 does not install language servers or alter installer targets | SPEC-024 | Owned |
| Analyzer operational flags and resilience knobs | Existing index/sync plus SPEC-024 | LSP timeout/watch bounds are separate opt-in controls; existing analyzer flags are unchanged | SPEC-024 | Owned |

Gate expectation: `scripts/spec-008-parity-gate.mjs` reports 17 capability
rows and 0 unowned rows.
