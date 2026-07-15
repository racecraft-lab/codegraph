# Research: Change Impact Detection

## Decision: Acquire diffs with explicit git modes

Use the local `git` executable with argument arrays, no shell, `--no-ext-diff`, `--no-color`, and rename detection enabled.

- `unstaged`: working tree vs index.
- `staged`: index vs `HEAD`.
- `all`: tracked staged and unstaged changes vs `HEAD`, plus untracked-file diagnostics.
- `base-ref`: `HEAD` vs `merge-base(baseRef, HEAD)`, ignoring dirty local-only changes.

Rationale: This matches the clarified spec and avoids a general git-range parser.

Alternatives considered:

- General git range input: rejected as out of scope.
- GitHub/PR API comparison: rejected because SPEC-012 is local-first and SPEC-020 owns PR automation.

## Decision: Combine file metadata with hunk parsing

Read file-level change metadata separately from hunk ranges so path-only renames, binary files, deletions, generated files, unindexed paths, and untracked files in `all` mode can be represented even when no textual hunk exists.

Rationale: The report must distinguish unmapped diagnostics from changed-symbol impact.

Alternatives considered:

- Parse only unified diff text: rejected because binary/path-only changes can disappear from symbol mapping.
- Treat every file-level change as impacted symbols: rejected because pure moves would create phantom semantic impact.

## Decision: Map hunks by indexed span intersection

Use existing indexed file and symbol spans. Map new-file ranges for additions/modifications, old-file ranges for deletions, and the relevant path side for renamed files.

Rationale: This keeps the feature deterministic and LLM-free while preserving deleted symbol reporting when prior spans exist.

Alternatives considered:

- Reparse changed files ad hoc: rejected for v1 because the current index is the source of truth and stale-index warnings already cover uncertainty.
- Name-based symbol guessing: rejected because unmapped hunks must remain diagnostics, not invented impacts.

## Decision: Warn and continue on stale index by default

When indexed file state may not match the requested diff input, include a visible stale-index warning and continue with best available local data.

Rationale: The design concept explicitly chose warn-and-continue; this preserves local usability and MCP success-shaped expected states.

Alternatives considered:

- Fail by default: rejected because stale-index failure is not the v1 policy.
- Ignore staleness: rejected because it hides uncertainty.

## Decision: Use shallow, bounded caller expansion

Default caller expansion uses direct callers only (`callerDepth: 1`), displays up to 20 callers, and clamps user bounds to `callerDepth` 1–3 and `maxCallers` 1–100.

Rationale: This mirrors existing CodeGraph caller behavior and keeps diff reports from becoming full impact-radius dumps.

Alternatives considered:

- Full transitive callers: rejected as noisy and outside scope.
- Direct symbols only: rejected because the roadmap requires bounded caller impact.

## Decision: Use SPEC-011 catalog state for affected flows

The `affectedFlows` envelope carries a state of `disabled`, `unavailable`, `not_indexed`, `stale`, `empty`, or `available`, matching existing SPEC-011 catalog semantics.

Rationale: This avoids a divergent flow-unavailable vocabulary and lets callers distinguish "no affected flows" from "flow data unavailable."

Alternatives considered:

- Omit `affectedFlows` when unavailable: rejected because the JSON schema must remain stable.
- Fail when flows are disabled: rejected because affected flows are enrichment, not a hard prerequisite.

## Decision: Use one shared threshold grammar

CLI `--fail-on` and MCP `failOn` both accept comma-separated policy tokens: `callers>N` and/or `hub`.

Rationale: A single grammar preserves CLI/MCP parity and keeps automation simple.

Alternatives considered:

- Separate CLI flags and MCP enum arrays: rejected because it creates drift between surfaces.
- Hard-fail on every risk: rejected because ordinary impact reports should remain distinct from configured threshold breaches.
