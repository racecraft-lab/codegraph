#!/usr/bin/env node
// PreToolUse hook (Bash tool). House rules enforced mechanically:
//  - origin (racecraft-lab/codegraph) only; upstream (colbymchenry) is fetch-only
//  - no manual npm publish / git tag / tag pushes — releases ship via the GitHub Actions workflow
// Fail open: anything unparseable exits 0.
import fs from 'node:fs';

let cmd;
try { cmd = JSON.parse(fs.readFileSync(0, 'utf8'))?.tool_input?.command; } catch { process.exit(0); }
if (typeof cmd !== 'string') process.exit(0);

const block = (reason) => { process.stderr.write(`origin-guard: BLOCKED — ${reason}\n`); process.exit(2); };
// list/inspect/delete forms of `git tag` that don't create tags
const SAFE_TAG_ARG = /^(-l|--list|-n\d*|-d|--delete|--contains|--points-at|--sort)(=|$)/;

for (const segment of cmd.split(/&&|\|\||[;|\n]/)) {
  const t = segment.trim().split(/\s+/).filter(Boolean);
  while (t.length && (['sudo', 'command', 'env'].includes(t[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0]))) t.shift();
  if (!t.length) continue;
  const prog = t[0].replace(/^.*\//, '');
  const rest = t.slice(1);

  if (prog === 'git') {
    let i = 0; // skip git's global flags; -C and -c take a separate value
    while (i < rest.length && rest[i].startsWith('-')) i += rest[i] === '-C' || rest[i] === '-c' ? 2 : 1;
    const sub = rest[i], args = rest.slice(i + 1);
    if (sub === 'push') {
      if (args.includes('upstream')) block('pushing to the `upstream` remote is forbidden — it is fetch-only. Push to `origin` (racecraft-lab/codegraph) instead.');
      if (args.some((a) => a.includes('colbymchenry'))) block('pushing to colbymchenry/codegraph is forbidden — that repo is fetch-only. Push to `origin` (racecraft-lab/codegraph) instead.');
      if (args.includes('--tags') || args.includes('--follow-tags')) block('pushing tags is forbidden — release tags are created by the GitHub Actions "Release" workflow.');
    }
    if (sub === 'tag' && args.length && !SAFE_TAG_ARG.test(args[0]))
      block('creating git tags is forbidden — release tags come from the GitHub Actions "Release" workflow. (Listing/deleting tags is allowed.)');
  }

  if (prog === 'gh' && rest.some((a) => a.includes('colbymchenry'))) {
    const prMutates = rest.includes('pr') && ['create', 'merge', 'edit'].some((v) => rest.includes(v));
    if (prMutates || rest.includes('release'))
      block('gh operations against colbymchenry/codegraph are forbidden — PRs and releases target origin (racecraft-lab/codegraph) only.');
  }

  if (prog === 'npm' && rest.includes('publish'))
    block('manual `npm publish` is forbidden — it would ship the non-bundled root package. Releases publish via the GitHub Actions "Release" workflow.');
}
process.exit(0);
