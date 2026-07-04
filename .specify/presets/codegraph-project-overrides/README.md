# codegraph-project-overrides

Repo-specific SpecKit preset for the racecraft CodeGraph fork.

## Why this exists

`ensure-reviewability-preset.sh` — a script that ships with the speckit-pro
plugin, not this repo (run by `/speckit-pro:speckit-scaffold-spec` step 0) —
**regenerates** the entire sibling `speckit-pro-reviewability` preset
(templates *and* its README) from the current core templates on every run, so
any project-specific customization stored there gets clobbered. That preset
directory is committed byte-identical to the generator's output (a re-run is a
verified no-op) and must not be hand-edited. Per the speckit-pro Project Fixup
guidance, project policy lives here instead, at higher precedence
(priority 3 < 5), where regeneration can never touch it.

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
