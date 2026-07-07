#!/bin/sh
# Dogfood MCP launcher — .mcp.json (Claude Code) and .codex/config.toml (Codex)
# both start the CodeGraph MCP server through this script instead of a bare
# `node` command so every agent session serves the HEAD build with the dogfood
# environment attached:
#   1. cwd is pinned to the checkout root (Codex may spawn from a subdirectory);
#   2. the untracked `.envrc.local` (private embedding endpoint — roadmap
#      § Dogfooding Protocol) reaches the daemon even when the host app wasn't
#      launched from a direnv-activated shell, so watcher syncs keep embedding
#      coverage at 100% and query-time semantic search lights up the day
#      SPEC-003 lands;
#   3. a spec worktree (.worktrees/<spec>/) falls back to the MAIN checkout's
#      `.envrc.local`, so worktrees need no per-worktree env copy.
# Fail-open / dormancy-safe: with no `.envrc.local` anywhere this is
# byte-equivalent to `node dist/bin/codegraph.js serve --mcp` (embeddings stay
# dormant). POSIX sh (macOS/Linux); Windows dogfood clones keep a plain `node`
# command instead.
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 1
if [ -f ./.envrc.local ]; then
  . ./.envrc.local
else
  main_root="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" 2>/dev/null)"
  if [ -n "$main_root" ] && [ -f "$main_root/.envrc.local" ]; then
    . "$main_root/.envrc.local"
  fi
fi
exec node dist/bin/codegraph.js serve --mcp "$@"
