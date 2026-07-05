# Existing-Language A/B Gate

Status: applicable; local-only current-vs-baseline control completed.

Existing-language A/B is conditional. The current implementation touches shared
grammar, parser, import-resolution, and resolver orchestration paths, so an
existing-language control is applicable.

## Intended External-Agent Command

```bash
bash scripts/agent-eval/ab-new-vs-baseline.sh <indexed-existing-language-repo> "<control retrieval question>" origin/main
```

## External-Agent Blocker

The Claude CLI is installed at `/Users/fredrickgabelmann/.local/bin/claude`,
version `2.1.201`, but unsandboxed `bypassPermissions` A/B runs are currently
risky. During OCaml-LSP A/B, a `without` arm left the target repo and began broad
system searches under `/root` and `/Users`. A repeated unsandboxed rerun was
rejected by the escalation reviewer without explicit user approval.

After the implementation commit, a safer copy of the A/B helper was prepared
with `Bash`, `Task`, `Agent`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, and
`WebSearch` disabled for Claude. The sandbox reviewer still rejected that run
because it would send private repository contents and structure to the external
Claude service. That policy boundary is not a CodeGraph regression.

## Local-Only Replacement Control

Because the external-agent run was disallowed, T060 was completed with a
materially safer local-only control that compares current and baseline CodeGraph
builds without network or external model access.

Command:

```bash
/private/tmp/spec-023-local-existing-language-control.sh HEAD~1
```

Evidence:

- Output directory:
  `/private/tmp/spec-023-existing-language-local.wbMHdR`
- Summary:
  `/private/tmp/spec-023-existing-language-local.wbMHdR/summary.json`
- Current build and `HEAD~1` baseline build both completed.
- Both arms indexed identical target copies of this repository.
- Parser-selection probe:
  - Current: `new-parser-explore.txt`, 24,373 chars, `getParser=true`,
    `typescript=true`, no error.
  - Baseline: `baseline-parser-explore.txt`, 24,373 chars, `getParser=true`,
    `typescript=true`, no error.
- `getParser` node probe:
  - Current: `new-getParser-node.txt`, 1,614 chars, function body and
    tree-sitter references present, no error.
  - Baseline: `baseline-getParser-node.txt`, 1,614 chars, function body and
    tree-sitter references present, no error.
- TypeScript import-resolution probe:
  - Current: `new-resolution-explore.txt`, 16,646 chars,
    `ReferenceResolver=true`, `ImportResolver=true`, no error.
  - Baseline: `baseline-resolution-explore.txt`, 16,646 chars,
    `ReferenceResolver=true`, `ImportResolver=true`, no error.

Result: pass. The SPEC-023 shared parser/resolution changes did not regress the
existing-language deterministic retrieval surfaces covered by this local
control. The external Claude A/B remains unavailable without explicit approval
to send private repository context to the external service.
