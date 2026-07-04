# codegraph-project-overrides

Repo-specific SpecKit preset for the racecraft CodeGraph fork.

## Why this exists

`ensure-reviewability-preset.sh` (run by `/speckit-pro:speckit-scaffold-spec` step 0)
**regenerates** `speckit-pro-reviewability` from the current core templates on every
run, so any project-specific customization stored there gets clobbered. Per the
speckit-pro Project Fixup guidance, project policy lives here instead, at higher
precedence (priority 3 < 5), where regeneration can never touch it.

## What it overrides

- `tasks-template` — the generic reviewability-augmented template **plus** the
  constitution test-policy exceptions (Constitution IV & Quality Gates): bug-fix
  tasks MUST start with a failing test that reproduces the bug, and installer
  changes MUST update the installer-targets contract suite.

## Maintenance

If the generic `speckit-pro-reviewability` preset's tasks-template ever changes
shape (plugin upgrade), re-derive this file from it: copy the regenerated
`../speckit-pro-reviewability/templates/tasks-template.md` and re-apply the
constitution-exceptions sentence to the `**Tests**:` line.
