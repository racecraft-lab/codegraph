# Extraction — edit-time rules

Full detail: root CLAUDE.md → Architecture + "Dynamic-dispatch coverage"; constitution Principle V.

- Any new grammar `.wasm` (or any static asset) must be wired into the `copy-assets` build step or it silently won't ship in `dist/`.
- Node/edge kinds are the exact strings defined in `src/types.ts` (`NodeKind`/`EdgeKind`) — extractors and resolvers must match them literally.
- Graph structure derives from the AST only — deterministic, LLM-free.
- Verify node/edge counts stay stable across a re-index before merging extraction changes (no node explosion).
- One language per file under `languages/`; non-tree-sitter formats get standalone extractors (see `svelte-extractor.ts` et al.).
