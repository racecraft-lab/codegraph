# Existing-Language A/B Gate

Status: applicable and blocked by safe-runner constraints.

Existing-language A/B is conditional. The current implementation touches shared
grammar, parser, import-resolution, and resolver orchestration paths, so an
existing-language control is applicable.

## Intended Command

```bash
bash scripts/agent-eval/ab-new-vs-baseline.sh <indexed-existing-language-repo> "<control retrieval question>" origin/main
```

## Current Blocker

The Claude CLI is installed at `/Users/fredrickgabelmann/.local/bin/claude`,
version `2.1.201`, but unsandboxed `bypassPermissions` A/B runs are currently
risky. During OCaml-LSP A/B, a `without` arm left the target repo and began broad
system searches under `/root` and `/Users`. A repeated unsandboxed rerun was
rejected by the escalation reviewer without explicit user approval.

The helper also expects a clean engine worktree when comparing the current build
against a baseline. This worktree intentionally has uncommitted SPEC-023 changes
while implementation is in progress, so the control remains open until both
conditions are true:

- A safe repo-confined A/B harness exists, or the maintainer explicitly approves
  another unsandboxed `bypassPermissions` eval after the out-of-repo-search risk.
- The engine worktree is clean enough for `ab-new-vs-baseline.sh` to check out
  baseline files and restore HEAD safely.
