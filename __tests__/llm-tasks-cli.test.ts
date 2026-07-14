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

// --------------------------------------------------------------------------
// Finding 1 (rp-review): a bundle id is a directory name — attacker-craftable to
// carry ANSI/OSC/ESC control sequences. `tasks list` prints ids to a terminal, so a
// raw ESC byte could forge output or trigger terminal features. The HUMAN rendering
// must escape control characters into a visible form; structured/JSON output stays raw.
describe('codegraph tasks list — escapes control characters in untrusted bundle ids (terminal injection)', () => {
  it('renders an ESC/ANSI-bearing bundle id escaped, with NO raw ESC byte in stdout', () => {
    const root = makeRoot();
    // A manually-created bundle dir whose NAME carries an ANSI color sequence (valid on
    // POSIX — any byte but '/' and NUL is a legal filename byte).
    const evilId = 'evil\x1b[31mRED\x1b[0m';
    const dir = bundleDirOf(root, evilId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ id: evilId, status: 'pending', contract: 'output-contract.json', createdAt: new Date().toISOString() }),
      'utf8',
    );

    const r = runTasks(root, ['list']);
    expect(r.status).toBe(0);
    // The untrusted id is rendered fully ESCAPED — its ESC (0x1B) bytes become the literal
    // token `\x1b`, so the injected ANSI sequence reaches the terminal as inert text.
    expect(r.stdout).toContain('evil\\x1b[31mRED\\x1b[0m');
    // The injected raw red-ANSI sequence (real ESC + "[31m") NEVER reaches the terminal.
    // (chalk.dim on the numeric age field emits only `\x1b[2m`/reset — trusted, not `[31m` —
    // so this assertion isolates the untrusted-id terminal-injection property.)
    expect(r.stdout).not.toContain('\x1b[31m');
  });
});

// --------------------------------------------------------------------------
// Finding 3 (rp-review): `list` takes no id (only `ingest <id>` does), but the flat
// `tasks [action] [id]` shape silently accepts and ignores a stray id. That is a
// foot-gun (`tasks list some-id` looked like it did something). Reject it.
describe('codegraph tasks list — rejects an unexpected id argument', () => {
  it('exits non-zero with a usage error when given an id (list takes none)', () => {
    const root = makeRoot();
    const r = runTasks(root, ['list', 'extra-arg']);
    expect(r.status).not.toBe(0);
    expect(r.stderr.trim().length).toBeGreaterThan(0);
    expect(r.stderr.toLowerCase()).toContain('usage');
  });

  it('still lists normally with no id (regression guard for the accepted shape)', () => {
    const root = makeRoot();
    emitBundle(root, makeTask());
    const r = runTasks(root, ['list']);
    expect(r.status).toBe(0);
  });
});

// --------------------------------------------------------------------------
// Fix H (rp-review round 2): control-character escaping coverage gaps. `escapeControlChars`
// was applied to `tasks list` ids and ingest rejection reasons, but NOT to the SUCCESSFUL
// ingest confirmation (which echoes the untrusted bundle id) or to the unknown-action echo.
// Both interpolate attacker-controllable strings into the terminal raw. The HUMAN surface
// must escape control characters into a visible form; structured output stays raw.
describe('codegraph tasks ingest <id> — escapes control characters in the success confirmation (Fix H(a))', () => {
  // POSIX-gated: the bundle id is a real directory name, and control bytes (ESC 0x1b) are
  // illegal in Windows filenames, so the ESC-named bundle dir can only be created on POSIX.
  it.runIf(process.platform !== 'win32')('renders an ESC/ANSI-bearing bundle id escaped on the success path, with NO raw injected ANSI', () => {
    const root = makeRoot();
    // A manually-created bundle whose NAME carries an ANSI sequence (valid on POSIX).
    const evilId = 'zz\x1b[31mRED\x1b[0m';
    const dir = bundleDirOf(root, evilId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ id: evilId, status: 'pending', contract: 'output-contract.json', createdAt: new Date().toISOString() }),
      'utf8',
    );
    fs.writeFileSync(path.join(dir, 'output-contract.json'), JSON.stringify(PROSE_CONTRACT), 'utf8');
    fs.writeFileSync(path.join(dir, 'output.json'), JSON.stringify({ prose: 'ok' }), 'utf8');

    const r = runTasks(root, ['ingest', evilId]);
    expect(r.status).toBe(0); // conforming output → success confirmation
    expect(manifestStatus(root, evilId)).toBe('completed'); // the effect landed on disk
    // The untrusted id in the confirmation is rendered fully ESCAPED — its ESC (0x1b) bytes
    // become the literal token `\x1b`, so the injected ANSI reaches the terminal as inert text.
    expect(r.stdout).toContain('zz\\x1b[31mRED\\x1b[0m');
    // The injected RAW ANSI sequence never reaches the terminal. (chalk.green on the success
    // glyph emits only `\x1b[32m`, never `\x1b[31mRED`, so this isolates the untrusted-id
    // terminal-injection property.)
    expect(r.stdout).not.toContain('\x1b[31mRED');
  });
});

describe('codegraph tasks <unknown> — escapes control characters in the unknown-action echo (Fix H(c))', () => {
  it('renders an ESC/ANSI-bearing unknown action escaped in the error echo, with NO raw injected ANSI', () => {
    const root = makeRoot();
    // The action positional is untrusted argv — an unknown value is echoed back; escape it.
    const evilAction = 'zz\x1b[31mRED\x1b[0m';
    const r = runTasks(root, [evilAction]);
    expect(r.status).not.toBe(0);
    // The unknown action is echoed ESCAPED …
    expect(r.stderr).toContain('zz\\x1b[31mRED\\x1b[0m');
    // … so the injected RAW ANSI never reaches the terminal. (error() wraps only the glyph in
    // chalk.red → `\x1b[31m<glyph>`, never `\x1b[31mRED`, so this isolates the injection.)
    expect(r.stderr).not.toContain('\x1b[31mRED');
  });
});
