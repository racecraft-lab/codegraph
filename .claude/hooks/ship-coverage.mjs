#!/usr/bin/env node
// Stop hook: turn-end sentinel for silent-failure house rules.
//  1. src/installer/ code changes require contract-suite coverage AND a CHANGELOG entry.
//  2. New .sql / misplaced .wasm under src/ must be wired into the copy-assets build step or they won't ship.
// Fail open: any unexpected error exits 0.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

try {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
  if (input.stop_hook_active) process.exit(0); // don't re-block a stop we already blocked

  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  const entries = status.split('\n').filter(Boolean).map((l) => {
    let p = l.slice(3);
    if (p.includes(' -> ')) p = p.split(' -> ').pop(); // renames: keep the new path
    return { xy: l.slice(0, 2), path: p.replace(/^"|"$/g, '') };
  });
  const changed = entries.map((e) => e.path);
  const problems = [];

  // Docs (.md) under src/installer don't need contract coverage — only code does.
  const installerCode = changed.filter((p) => p.startsWith('src/installer/') && !p.endsWith('.md'));
  if (installerCode.length && !(changed.includes('__tests__/installer-targets.test.ts') && changed.includes('CHANGELOG.md')))
    problems.push(`installer changes (${installerCode.join(', ')}) without touching BOTH __tests__/installer-targets.test.ts and CHANGELOG.md — house rule: installer changes need contract-suite coverage and a CHANGELOG entry under "## [Unreleased]" (installer regressions break every new install silently).`);

  let copyAssets = '';
  try { copyAssets = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts?.['copy-assets'] ?? ''; } catch {}
  for (const e of entries) {
    if (!e.xy.includes('?') && !e.xy.includes('A')) continue; // only NEW files matter for shipping
    if (e.path.startsWith('src/') && e.path.endsWith('.sql') && e.path !== 'src/db/schema.sql' && !copyAssets.includes(path.basename(e.path)))
      problems.push(`new SQL file ${e.path} is not referenced by the copy-assets script in package.json — it will silently not ship in dist/.`);
    if (e.path.startsWith('src/') && e.path.endsWith('.wasm') && !e.path.startsWith('src/extraction/wasm/'))
      problems.push(`new wasm file ${e.path} is outside src/extraction/wasm/ (the only dir copy-assets globs) — it will silently not ship in dist/.`);
  }

  if (problems.length) {
    process.stderr.write('ship-coverage: before stopping, address:\n' + problems.map((p) => `  - ${p}`).join('\n') + '\n');
    process.exit(2);
  }
  process.exit(0);
} catch { process.exit(0); }
