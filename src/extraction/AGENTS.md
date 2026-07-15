# Extraction - Local Rules

Full detail: root `AGENTS.md` and `.specify/memory/constitution.md`.

- Graph structure derives from AST/static analysis only; never invent nodes or
  edges from LLM prose.
- Use the exact `NodeKind` and `EdgeKind` strings from `src/types.ts`.
- Any new grammar `.wasm` or shipped static asset must be copied by
  `copy-assets` or it will not ship in `dist`.
- Verify node and edge counts stay stable across a re-index before merge.
- Keep one language per file under `languages/`; non-tree-sitter formats use
  standalone extractors.
