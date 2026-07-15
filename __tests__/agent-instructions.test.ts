import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..');

const scopes = [
  '.',
  '__tests__',
  'scripts/agent-eval',
  'src/db',
  'src/extraction',
  'src/installer',
  'src/mcp',
  'src/refactor',
  'src/resolution',
  'src/server',
  'src/sync',
  'site',
  'telemetry-worker',
  '.specify',
];

const agentNames = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'] as const;

function repoPath(...parts: string[]): string {
  return path.join(repoRoot, ...parts);
}

function read(...parts: string[]): string {
  return fs.readFileSync(repoPath(...parts), 'utf8');
}

function walk(dir: string, results: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    if (entry.name === '.codegraph' || entry.name === '.worktrees') {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, results);
      continue;
    }
    if (agentNames.includes(entry.name as (typeof agentNames)[number])) {
      results.push(path.relative(repoRoot, fullPath));
    }
  }
}

describe('repository agent instructions', () => {
  it('uses only approved canonical scopes', () => {
    const expected = scopes.flatMap((scope) =>
      agentNames.map((name) => path.normalize(path.join(scope, name))),
    ).sort();
    const actual: string[] = [];
    walk(repoRoot, actual);

    expect(actual.sort()).toEqual(expected);
  });

  it('keeps AGENTS.md as regular canonical files and wrappers as exact imports', () => {
    for (const scope of scopes) {
      const agentsPath = repoPath(scope, 'AGENTS.md');
      const agentsStat = fs.lstatSync(agentsPath);
      expect(agentsStat.isSymbolicLink()).toBe(false);
      expect(agentsStat.isFile()).toBe(true);

      for (const wrapper of ['CLAUDE.md', 'GEMINI.md']) {
        const wrapperPath = repoPath(scope, wrapper);
        const wrapperStat = fs.lstatSync(wrapperPath);
        expect(wrapperStat.isSymbolicLink()).toBe(false);
        expect(wrapperStat.isFile()).toBe(true);
        expect(fs.readFileSync(wrapperPath, 'utf8')).toBe('@AGENTS.md\n');
      }
    }
  });

  it('keeps generated workflow exhaust out of agent files', () => {
    for (const scope of scopes) {
      for (const name of agentNames) {
        const content = read(scope, name);
        expect(content).not.toMatch(/speckit/i);
        expect(content).not.toContain('<!-- SPECKIT START -->');
        expect(content).not.toContain('<!-- SPECKIT END -->');
        expect(content).not.toMatch(/complete and archived/i);
        expect(content).not.toMatch(/Canonical completed-spec artifacts/i);
      }
    }
  });

  it('keeps the root and root-plus-scope instruction chains small', () => {
    const rootAgents = read('AGENTS.md');
    const rootLineCount = rootAgents.trimEnd().split('\n').length;
    expect(rootLineCount).toBeLessThan(200);

    for (const scope of scopes) {
      const scopedAgents = scope === '.' ? '' : read(scope, 'AGENTS.md');
      const bytes = Buffer.byteLength(rootAgents + scopedAgents, 'utf8');
      expect(bytes).toBeLessThan(32 * 1024);
    }
  });

  it('leaves workflow context updates unable to target agent files', () => {
    const contextConfig = read('.specify/extensions/agent-context/agent-context-config.yml');
    expect(contextConfig).toContain('context_file: ""');
    expect(contextConfig).toContain('context_files: []');
    expect(contextConfig).not.toMatch(/context_file:\s+(AGENTS|CLAUDE|GEMINI)\.md/);

    const extensions = read('.specify/extensions.yml');
    const hookBlocks = Array.from(
      extensions.matchAll(/- extension: agent-context[\s\S]*?(?=\n  - extension:|\n  before_|\n  after_|$)/g),
      (match) => match[0],
    );
    expect(hookBlocks.length).toBe(2);
    for (const block of hookBlocks) {
      expect(block).toContain('enabled: false');
    }
  });

  it('does not need a raised Codex project-doc limit', () => {
    expect(read('.codex/config.toml')).not.toContain('project_doc_max_bytes');
  });
});
