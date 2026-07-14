/**
 * `codegraph tasks [action] [id]` CLI — end-to-end against the built binary
 * (SPEC-018 slice 2, T027). Contract: contracts/tasks-cli.md (AUTHORITATIVE), research
 * D11, spec FR-026/FR-028/FR-028a/FR-029.
 *
 * The `list` / `ingest <id>` logic lives in `listBundles` / `ingestBundle` and is pinned
 * directly in llm-agent-bundle.test.ts / llm-ingest.test.ts. This suite pins the thin
 * CLI surface the flat positional command adds:
 *   - `tasks list` → resilient enumeration; exit 0 on empty / absent / corrupt task dirs.
 *   - `tasks ingest <id>` → exit 0 + confirmation on success; non-zero + reason to stderr
 *     on any rejection (contract violation, early ingest, bad id).
 *   - unknown action / missing id → error + non-zero exit.
 *   - user-invoked only (FR-029) — the command is registered on the CLI, never wired into
 *     a watcher/daemon.
 *
 * Requires a freshly built `dist/` (run `npm run build` first). Real temp roots seeded via
 * the `emitBundle` API; real fs, cleaned in `afterEach`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { emitBundle } from '../src/llm/agent-bundle';
import type { ProseTask, OutputContract } from '../src/llm/generate';
import { getCodeGraphDir } from '../src/directory';

const BIN = path.resolve(__dirname, '../dist/bin/codegraph.js');

const tempDirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-llm-tasks-cli-'));
  tempDirs.push(dir);
  return dir;
}

const PROSE_CONTRACT: OutputContract = { requiredFields: [{ name: 'prose', type: 'string', nonEmpty: true }] };
function makeTask(overrides: Partial<ProseTask> = {}): ProseTask {
  return { instructions: 'Summarize.', graphContext: [], outputContract: PROSE_CONTRACT, fallback: 'FB', ...overrides };
}
function tasksDir(root: string): string {
  return path.join(getCodeGraphDir(root), 'tasks');
}
function bundleDirOf(root: string, id: string): string {
  return path.join(tasksDir(root), id);
}
function writeOutput(root: string, id: string, obj: unknown): void {
  fs.writeFileSync(path.join(bundleDirOf(root, id), 'output.json'), JSON.stringify(obj), 'utf8');
}
function manifestStatus(root: string, id: string): string {
  return JSON.parse(fs.readFileSync(path.join(bundleDirOf(root, id), 'manifest.json'), 'utf8')).status;
}
/** Complete a bundle without the ingest path (for `list` fixtures). */
function completeBundle(root: string, id: string, text: string): void {
  const dir = bundleDirOf(root, id);
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ text }), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  manifest.status = 'completed';
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}
function runTasks(cwd: string, args: string[]): Run {
  const env = { ...process.env };
  for (const k of [
    'CODEGRAPH_LLM_URL', 'CODEGRAPH_LLM_MODEL', 'CODEGRAPH_LLM_API_KEY', 'CODEGRAPH_LLM_PROVIDER',
    'CODEGRAPH_EMBEDDING_URL', 'CODEGRAPH_EMBEDDING_MODEL', 'CODEGRAPH_EMBEDDING_API_KEY', 'CODEGRAPH_EMBEDDING_PROVIDER',
  ]) delete env[k];
  const r = spawnSync(process.execPath, [BIN, 'tasks', ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...env, CODEGRAPH_NO_DAEMON: '1', CODEGRAPH_WASM_RELAUNCHED: '1', DO_NOT_TRACK: '1' },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
describe('codegraph tasks list', () => {
  it('exits 0 on an absent .codegraph/tasks/ directory (empty listing, never an error)', () => {
    const root = makeRoot();
    const r = runTasks(root, ['list']);
    expect(r.status).toBe(0);
  });

  it('exits 0 and surfaces id + status for pending, completed, and corrupt bundles', () => {
    const root = makeRoot();
    const pending = emitBundle(root, makeTask());
    const done = emitBundle(root, makeTask());
    completeBundle(root, done.id, 'DONE');
    const broken = emitBundle(root, makeTask());
    fs.writeFileSync(path.join(bundleDirOf(root, broken.id), 'manifest.json'), '{ not json', 'utf8');

    const r = runTasks(root, ['list']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(pending.id);
    expect(r.stdout).toContain('pending');
    expect(r.stdout).toContain(done.id);
    expect(r.stdout).toContain('completed');
    // The corrupt bundle is surfaced (unreadable), not dropped and not fatal.
    expect(r.stdout).toContain(broken.id);
  });

  it('treats a bare `tasks` (no action) as list and exits 0', () => {
    const root = makeRoot();
    emitBundle(root, makeTask());
    const r = runTasks(root, []);
    expect(r.status).toBe(0);
  });
});

describe('codegraph tasks ingest <id>', () => {
  it('exits 0 with a confirmation and finalizes the bundle on conforming output', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    writeOutput(root, id, { prose: 'the finalized answer' });

    const r = runTasks(root, ['ingest', id]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(id);
    // Effects landed on disk.
    expect(manifestStatus(root, id)).toBe('completed');
    expect(JSON.parse(fs.readFileSync(path.join(bundleDirOf(root, id), 'result.json'), 'utf8'))).toEqual({
      text: 'the finalized answer',
    });
  });

  it('exits non-zero with the reason on stderr and leaves the manifest pending on a contract violation', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    writeOutput(root, id, { prose: '' }); // non-conforming

    const r = runTasks(root, ['ingest', id]);
    expect(r.status).not.toBe(0);
    expect(r.stderr.trim().length).toBeGreaterThan(0);
    expect(manifestStatus(root, id)).toBe('pending');
    expect(fs.existsSync(path.join(bundleDirOf(root, id), 'result.json'))).toBe(false);
  });

  it('exits non-zero when the agent output is absent (ingested too early)', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask()); // no output.json
    const r = runTasks(root, ['ingest', id]);
    expect(r.status).not.toBe(0);
    expect(manifestStatus(root, id)).toBe('pending');
  });

  it('exits non-zero on a traversal id without opening or writing the escaped location', () => {
    const root = makeRoot();
    fs.mkdirSync(tasksDir(root), { recursive: true });
    const evilDir = path.join(root, 'evil');
    fs.mkdirSync(evilDir, { recursive: true });
    fs.writeFileSync(
      path.join(evilDir, 'manifest.json'),
      JSON.stringify({ id: 'evil', status: 'pending', contract: 'output-contract.json', createdAt: new Date().toISOString() }),
      'utf8',
    );
    fs.writeFileSync(path.join(evilDir, 'output-contract.json'), JSON.stringify(PROSE_CONTRACT), 'utf8');
    fs.writeFileSync(path.join(evilDir, 'output.json'), JSON.stringify({ prose: 'LEAKED' }), 'utf8');

    const r = runTasks(root, ['ingest', path.join('..', '..', 'evil')]);
    expect(r.status).not.toBe(0);
    expect(fs.existsSync(path.join(evilDir, 'result.json'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(evilDir, 'manifest.json'), 'utf8')).status).toBe('pending');
  });

  it('exits non-zero when no id is given', () => {
    const root = makeRoot();
    const r = runTasks(root, ['ingest']);
    expect(r.status).not.toBe(0);
  });
});

describe('codegraph tasks <unknown>', () => {
  it('prints an error and exits non-zero on an unknown action', () => {
    const root = makeRoot();
    const r = runTasks(root, ['frobnicate']);
    expect(r.status).not.toBe(0);
    expect(r.stderr.trim().length).toBeGreaterThan(0);
  });
});
