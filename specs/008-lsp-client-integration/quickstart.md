# Quickstart: SPEC-008 LSP Client Integration Validation

## Purpose

Use this guide to validate SPEC-008 end to end after implementation. It proves default-off behavior, explicit activation, real-server prerequisites, edge correction, watch bounds, parity ownership, and self-repo dogfood.

## Project Commands

```bash
npm run build
npm run typecheck
npm test
npm run build && npm run typecheck && npm test
```

Single-file tests use:

```bash
npm test --
```

## Prerequisites

Install or configure local language servers before running SPEC-008 validation. CodeGraph must not auto-install them.

| Language | Required command or disposition | Evidence to record |
|---|---|---|
| JavaScript | `typescript-language-server --stdio` | Observed server version, TypeScript SDK evidence, status coverage |
| TypeScript | `typescript-language-server --stdio` | Observed server version, TypeScript SDK evidence, status coverage |
| Python | `pyright-langserver --stdio` or `basedpyright-langserver --stdio` | Observed selected server version, status coverage |
| Java | `jdtls -configuration <dir> -data <workspace-data>` or configured equivalent | Observed server version, workspace dir evidence |
| C | `clangd` | Observed server version, compile-command evidence when used |
| C++ | `clangd` | Observed server version, compile-command evidence when used |
| C# | `csharp-ls` | Observed server version, status coverage |
| Go | `gopls` | Observed server version, status coverage |
| Ruby | `ruby-lsp` or `solargraph stdio` | Observed selected server version, status coverage |
| Rust | `rust-analyzer` | Observed server version, status coverage |
| PHP | `intelephense --stdio` or `phpactor language-server` | Observed selected server version, status coverage |
| Kotlin | `kotlin-language-server` or `kotlin-lsp` | Observed selected server version, status coverage |
| Swift | `sourcekit-lsp` | Observed server version, status coverage |
| Dart | `dart language-server` | Observed Dart SDK/server version, status coverage |
| Vue | `vue-language-server --stdio` | Observed server version, TypeScript SDK evidence, status coverage |
| COBOL | SPEC-024-owned LSP disposition unless a concrete local target is selected later | Parser/resolver evidence, explicit future-owner status |

Version evidence policy:

- Record observed versions at validation time.
- Do not pin exact versions unless a selected server's minimum runtime requirement makes older versions invalid.
- Capture upstream minimum runtime requirements as plain text evidence in the validation packet.
- Do not add outbound links to spec artifacts.

## Scenario 1: Default-Off Structural Indexing

1. Ensure no CLI LSP flag is present.
2. Ensure project config does not enable `lsp.enabled`.
3. Run:

```bash
npm run build
node dist/bin/codegraph.js index
node dist/bin/codegraph.js status --json
```

Expected outcome:

- Indexing succeeds using existing structural behavior.
- No LSP-only provenance or coverage is recorded.
- Status reports LSP as disabled or absent for the run.

## Scenario 2: Explicit CLI Activation

1. Keep project config neutral or disabled.
2. Run:

```bash
node dist/bin/codegraph.js index --lsp
node dist/bin/codegraph.js status --json
```

Expected outcome:

- LSP precision runs for languages with available configured servers.
- Missing or crashed servers degrade only their languages.
- Status records activation source as CLI, observed versions where available, and per-language coverage.

## Scenario 3: Project Config and Environment Overrides

Create or update `codegraph.json` with:

```json
{
  "lsp": {
    "enabled": true,
    "defaultTimeoutMs": 5000,
    "watch": { "enabled": true },
    "servers": {
      "typescript": {
        "timeoutMs": 5000
      }
    }
  }
}
```

Set an environment override for one run:

```bash
CODEGRAPH_LSP_TYPESCRIPT_COMMAND_JSON='["typescript-language-server","--stdio"]' node dist/bin/codegraph.js index
```

Expected outcome:

- Project config activates LSP when no CLI enable/disable is provided.
- Project config may set activation, watch behavior, default timeouts, and per-language timeouts.
- Environment command and timeout overrides apply without modifying project config.
- Committed `lsp.servers.<language>.command` values warn and are ignored; use `CODEGRAPH_LSP_<LANG>_COMMAND_JSON` for machine-local command argv.
- Environment variables do not activate LSP by themselves when config and CLI are disabled.

## Scenario 4: Strict SPEC-008 Prereq Validation

Run the implemented prereq validation command or test path for SPEC-008.

Expected outcome when all servers are present:

- Report includes observed command, resolved path when available, observed version/serverInfo, minimum runtime evidence when relevant, platform, CodeGraph version/commit, and timestamp.
- Missing list is empty for SPEC-008-owned language rows.
- COBOL is reported as future-owned by SPEC-024 unless a concrete local LSP target has been selected.

Expected outcome when a required server is missing:

```text
SPEC-008 real-server validation prerequisites failed. Missing required local language servers: <language>: expected <command or alternatives>. Install the server or configure codegraph.json/environment overrides. Normal codegraph index --lsp still degrades per language; this failure applies only to SPEC-008 validation.
```

## Scenario 5: Unique-Target Correction

Use a fixture where static or heuristic resolution points at a known wrong target and the selected language server returns exactly one normalized in-workspace target with exactly one compatible CodeGraph node.

Expected outcome:

- The active graph target is corrected or the old edge is suppressed according to the storage design.
- The surviving active verified/corrected edge has `provenance: "lsp"`.
- Correction metadata records previous target, previous provenance, LSP target, new target when present, reason, language, server, and timestamp.
- Callers/impact/search output does not include noisy duplicate active edges.

## Scenario 6: Ambiguous and External Targets

Use fixtures for:

- Multiple LSP targets.
- No LSP target.
- Unique external or unindexed target.
- Generated target.

Expected outcome:

- Ambiguous output does not create speculative replacement edges.
- No-target output leaves existing graph unchanged.
- External or unindexed unique targets may suppress a conflicting active edge with audit metadata but must not create external graph nodes.
- Status records skip or suppression reasons.

## Scenario 7: Bounded Watch Verification

1. Enable LSP through CLI or project config.
2. Enable `lsp.watch.enabled`.
3. Start the existing watch/sync path.
4. Modify a bounded set of files in a covered language.

Expected outcome:

- LSP verification runs only after normal sync/reference resolution.
- Only changed files from the bounded set are considered.
- If no bounded changed-file list is available, LSP watch verification is skipped with a recorded reason.

## Scenario 8: Self-Repo Dogfood

Run:

```bash
npm run build
npm run typecheck
npm test
node dist/bin/codegraph.js index
node dist/bin/codegraph.js index --lsp
node dist/bin/codegraph.js status --json
```

Expected outcome:

- Build, typecheck, and unit tests pass.
- Non-LSP index preserves existing behavior.
- LSP index records coverage/degradation accurately.
- Status shows observed versions for available servers and unavailable/degraded rows for missing servers during normal runtime.
- Final SPEC-008 validation packet includes real-server evidence for all SPEC-008-owned rows.

## Language Parity Gate

| Language | Owner | Evidence required | Future owner | Status |
|---|---|---|---|---|
| JavaScript | SPEC-008 Slice 1 | Real-server validation and correction/status fixture | SPEC-024 audit | Owned |
| TypeScript | SPEC-008 Slice 1 | Real-server validation and correction/status fixture | SPEC-024 audit | Owned |
| Python | SPEC-008 Slice 2 | Real-server validation and degraded/status fixture | SPEC-024 audit | Owned |
| Java | SPEC-008 Slice 2 | Real-server validation and workspace/status fixture | SPEC-024 audit | Owned |
| C | SPEC-008 Slice 2 | Real-server validation and degraded/status fixture | SPEC-024 audit | Owned |
| C++ | SPEC-008 Slice 2 | Real-server validation and correction/status fixture | SPEC-024 audit | Owned |
| C# | SPEC-008 Slice 3 | Real-server validation and degraded/status fixture | SPEC-024 audit | Owned |
| Go | SPEC-008 Slice 2 | Real-server validation and correction/status fixture | SPEC-024 audit | Owned |
| Ruby | SPEC-008 Slice 3 | Real-server validation and degraded/status fixture | SPEC-024 audit | Owned |
| Rust | SPEC-008 Slice 2 | Real-server validation and correction/status fixture | SPEC-024 audit | Owned |
| PHP | SPEC-008 Slice 3 | Real-server validation and degraded/status fixture | SPEC-024 audit | Owned |
| Kotlin | SPEC-008 Slice 3 | Real-server validation and degraded/status fixture | SPEC-024 audit | Owned |
| Swift | SPEC-008 Slice 2 | Real-server validation and correction/status fixture | SPEC-024 audit | Owned |
| Dart | SPEC-008 Slice 3 | Real-server validation and degraded/status fixture | SPEC-024 audit | Owned |
| Vue | SPEC-008 Slice 3 | Real-server validation and TypeScript SDK evidence | SPEC-024 audit | Owned |
| COBOL | SPEC-024 disposition from SPEC-008 Slice 3 | Parser/resolver evidence and explicit non-LSP disposition | SPEC-024 | Future-owned |

Gate result required before completion: zero unowned language rows.

## Capability Parity Gate

| Capability row | Owner | Evidence required | Future owner | Status |
|---|---|---|---|---|
| Multi-phase graph pipeline | Existing graph plus SPEC-001/SPEC-003/SPEC-011 | Default-off regression and LSP insertion-point evidence | SPEC-024 | Owned |
| Field/property type resolution and return-type-aware binding | Existing resolution plus SPEC-008 | LSP definition/reference verification evidence | SPEC-024 | Owned |
| Hybrid search | SPEC-003 | Search regression evidence when LSP corrections are active | SPEC-024 | Future-owned |
| Process groups / execution flows | SPEC-011 | Flow compatibility evidence | SPEC-024 | Future-owned |
| Functional clusters | SPEC-011 | Stable graph-count evidence | SPEC-024 | Future-owned |
| Blast-radius impact | Existing impact plus SPEC-011/SPEC-012 | Impact regression evidence | SPEC-024 | Owned |
| Git diff impact detection | SPEC-012 | Watch/change compatibility evidence | SPEC-024 | Future-owned |
| Multi-file rename | SPEC-010 | Explicit SPEC-008 non-goal evidence | SPEC-024 | Future-owned |
| Raw Cypher graph queries | SPEC-013 | Provenance/schema query compatibility evidence | SPEC-024 | Future-owned |
| MCP resources | SPEC-011/SPEC-013/SPEC-021/SPEC-024 | Status/resource compatibility evidence if surfaced | SPEC-024 | Future-owned |
| MCP prompts | SPEC-012/SPEC-019/SPEC-024 | Impact prompt compatibility evidence | SPEC-024 | Future-owned |
| Wiki generation | SPEC-018/SPEC-019 | No remote/model behavior change evidence | SPEC-024 | Future-owned |
| Multi-repo registry | SPEC-021/SPEC-022/SPEC-024 | Per-repo config isolation evidence | SPEC-024 | Future-owned |
| Repository groups | SPEC-021/SPEC-022 | No group dependency evidence | SPEC-024 | Future-owned |
| Remote embeddings | SPEC-001/SPEC-002/SPEC-003 | No embedding/network change evidence | SPEC-024 | Future-owned |
| Installer setup/uninstall, agent skills, hooks | Existing installer plus SPEC-024 | No auto-install evidence | SPEC-024 | Owned |
| Analyzer operational flags | Existing index/sync plus SPEC-024 | Existing flag compatibility and separate LSP timeout evidence | SPEC-024 | Owned |

Gate result required before completion: zero unowned capability rows.
