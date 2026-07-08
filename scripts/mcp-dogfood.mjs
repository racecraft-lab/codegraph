#!/usr/bin/env node
// Dogfood MCP launcher — .mcp.json (Claude Code) and .codex/config.toml (Codex)
// both start the CodeGraph MCP server through this script (via a tiny `node -e`
// walk-up locator, so a session spawned from a repo subdirectory still finds it)
// instead of a bare `node` command, so every agent session serves the HEAD build
// with the dogfood environment attached:
//   1. everything anchors to THIS script's own location (scripts/ sits at the
//      checkout root), so the launcher is immune to whatever cwd the host app
//      spawned it with — a worktree's copy anchors to that worktree;
//   2. the untracked `.envrc.local` (private embedding endpoint — roadmap
//      § Dogfooding Protocol) reaches the daemon even when the host app wasn't
//      launched from a direnv-activated shell, so watcher syncs keep embedding
//      coverage at 100% and query-time semantic search lights up the day
//      SPEC-003 lands. Assignments are applied to process.env directly, so
//      they reach the server whether or not the file says `export`;
//   3. a spec worktree (.worktrees/<spec>/) falls back to the MAIN checkout's
//      `.envrc.local`, resolved portably via `git rev-parse --git-common-dir`
//      (Git ≥ 2.5) + path.resolve — no `--path-format=absolute` (Git ≥ 2.31)
//      dependency — so worktrees need no per-worktree env copy.
// Node everywhere (macOS/Linux/Windows) — no POSIX sh required. Fail-open /
// dormancy-safe: with no `.envrc.local` anywhere this is equivalent to
// `node dist/bin/codegraph.js serve --mcp` (embeddings stay dormant). stdout
// belongs to the MCP protocol: this launcher only ever writes to stderr.
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Conservative env-file parser: `KEY=value` / `export KEY=value` lines only
// (values may be single- or double-quoted); anything else — comments, shell
// logic — is skipped, never evaluated. Returns false when the file is absent
// so the caller can try the worktree fallback.
function loadEnvFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
  for (const raw of text.split('\n')) {
    const match = assignment.exec(raw);
    if (!match) continue;
    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
  return true;
}

if (!loadEnvFile(path.join(root, '.envrc.local'))) {
  const probe = spawnSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: root,
    encoding: 'utf8',
  });
  const commonDir = probe.status === 0 ? probe.stdout.trim() : '';
  if (commonDir) {
    const mainRoot = path.dirname(path.resolve(root, commonDir));
    if (mainRoot !== root) loadEnvFile(path.join(mainRoot, '.envrc.local'));
  }
}

const server = spawn(
  process.execPath,
  [path.join(root, 'dist', 'bin', 'codegraph.js'), 'serve', '--mcp', ...process.argv.slice(2)],
  { cwd: root, stdio: 'inherit' },
);
server.on('error', (err) => {
  console.error(`mcp-dogfood: failed to start the MCP server: ${err.message}`);
  process.exit(1);
});
server.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}
