# Refactor - Local Rules

Full detail: root `AGENTS.md`.

- `codegraph_rename` is dry-run by default. Applying changes must stay explicit.
- Preserve the safety ladder: span verification, snapshot, apply, post-check,
  and byte-identical rollback on failure.
- Never leave partially applied edits after a failed rename.
- Tests should cover both the plan output and the apply path when behavior
  changes.
