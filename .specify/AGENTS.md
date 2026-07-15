# Spec Workflow - Local Rules

Full detail: `.specify/memory/constitution.md`.

- Generated workflow state stays under `.specify/memory/`, `specs/`, or archive
  reports. Never append status ledgers or plan pointers to `AGENTS.md`,
  `CLAUDE.md`, or `GEMINI.md`.
- Agent context hooks remain disabled unless the maintainer explicitly opts
  back in for a different repository.
- Keep mirrored command and skill instructions consistent when changing workflow
  behavior.
- Use project-relative paths in docs and absolute paths for filesystem commands.
