/**
 * Agent-mode task bundles — unit tests (SPEC-018 slice 2, T018).
 *
 * Pins the filesystem work-package surface in `src/llm/agent-bundle.ts`
 * (contracts/bundle-files.md, generate-seam.md §Redemption, data-model §3/§4/§7,
 * research D8/D9):
 *   - `emitBundle(root, task)` → `{ id, handle }`; creates `.codegraph/tasks/<id>/`
 *     with the four self-describing files + a `manifest.json` (`status:'pending'`);
 *     `crypto.randomUUID()` ids never collide/overwrite (FR-024/FR-024a); NO SQLite
 *     (FR-023); a genuinely unwritable tasks dir surfaces as a throw the `generate()`
 *     seam converts to a fallback status (Edge Case — see llm-generate.test.ts).
 *   - `listBundles(root)` → resilient enumeration (daemon-registry precedent): a
 *     missing/malformed/unreadable manifest is surfaced with an unreadable/unknown
 *     status, never aborting; an empty/absent tasks dir → empty list (FR-026).
 *   - `redeemHandle(root, handle)` → the closed `RedeemResult` union (FR-010a): the
 *     handle is anchor-contained FIRST (a separator-bearing/escaping handle → missing
 *     with NO read — FR-029a/CRL 8); dir gone → missing; manifest completed → the
 *     canonical `result.json` text; pending → pending; a present-but-unreadable
 *     manifest → pending (never throws, never a false completed — CRL 7).
 *   - `readBundleFileSafely(root, bundleDir, relPath)` → the shared FR-029a bounded
 *     safe-read (research D9): containment (validatePathWithinRoot), symlink
 *     rejection, `MAX_BUNDLE_INPUT_BYTES` size bound, `MAX_JSON_DEPTH` depth bound,
 *     read-expected-fields-only (no prototype pollution).
 *   - `countPendingBundles(root)` → the network-free pending count behind the agent
 *     status block (data-model §8), and its composition through `getLlmStatus()`.
 *
 * Real temp roots via `fs.mkdtempSync`, cleaned up in `afterEach`; real files, real
 * fs — no mocking. Symlink assertions are POSIX-gated.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  emitBundle,
  listBundles,
  redeemHandle,
  readBundleFileSafely,
  countPendingBundles,
  MAX_BUNDLE_INPUT_BYTES,
  MAX_JSON_DEPTH,
} from '../src/llm/agent-bundle';
import type { ProseTask } from '../src/llm/generate';
import { getCodeGraphDir } from '../src/directory';
import { CodeGraph } from '../src/index';

// --- temp roots -----------------------------------------------------------
const tempDirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-llm-bundle-'));
  tempDirs.push(dir);
  return dir;
}

function makeTask(overrides: Partial<ProseTask> = {}): ProseTask {
  return {
    instructions: 'Summarize the change in prose.',
    graphContext: ['ctx-item-a', 'ctx-item-b'],
    outputContract: { requiredFields: [{ name: 'prose', type: 'string', nonEmpty: true }] },
    fallback: 'HEURISTIC FALLBACK',
    ...overrides,
  };
}

function tasksDir(root: string): string {
  return path.join(getCodeGraphDir(root), 'tasks');
}
function bundleDirOf(root: string, id: string): string {
  return path.join(tasksDir(root), id);
}

/** Turn an emitted (pending) bundle into a completed one with a canonical result. */
function completeBundle(root: string, id: string, text: string): void {
  const dir = bundleDirOf(root, id);
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ text }), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  manifest.status = 'completed';
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.CODEGRAPH_LLM_PROVIDER;
  delete process.env.CODEGRAPH_LLM_URL;
  delete process.env.CODEGRAPH_LLM_MODEL;
});

// --------------------------------------------------------------------------
describe('emitBundle — self-describing work package (data-model §3/§4, FR-021/022/023)', () => {
  it('creates .codegraph/tasks/<id>/ with the four emit-time files and a pending manifest', () => {
    const root = makeRoot();
    const task = makeTask();
    const { id, handle } = emitBundle(root, task);

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(handle).toBe(id); // the handle IS the opaque bundle id

    const dir = bundleDirOf(root, id);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.readdirSync(dir).sort()).toEqual(
      ['README.md', 'graph-context.json', 'instructions.md', 'manifest.json', 'output-contract.json'].sort(),
    );

    // instructions.md carries the prose verbatim.
    expect(fs.readFileSync(path.join(dir, 'instructions.md'), 'utf8')).toBe(task.instructions);
    // graph-context.json is the opaque items verbatim.
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'graph-context.json'), 'utf8'))).toEqual(task.graphContext);
    // output-contract.json is the OutputContract.
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'output-contract.json'), 'utf8'))).toEqual(task.outputContract);
    // manifest.json: { id, status:'pending', contract, createdAt } — status EXACTLY 'pending' (CRL 1).
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    expect(manifest.id).toBe(id);
    expect(manifest.status).toBe('pending');
    expect(manifest.contract).toBe('output-contract.json');
    expect(typeof manifest.createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(manifest.createdAt))).toBe(false);
  });

  it('creates NO SQLite / graph DB — filesystem-only (FR-023)', () => {
    const root = makeRoot();
    emitBundle(root, makeTask());
    expect(fs.existsSync(path.join(getCodeGraphDir(root), 'codegraph.db'))).toBe(false);
    expect(fs.existsSync(path.join(getCodeGraphDir(root), 'schema.sql'))).toBe(false);
    // Only the tasks tree exists under .codegraph.
    expect(fs.readdirSync(getCodeGraphDir(root))).toEqual(['tasks']);
  });

  it('gives near-concurrent emits distinct ids and never collides/overwrites (FR-024/FR-024a)', () => {
    const root = makeRoot();
    const results = Array.from({ length: 8 }, () => emitBundle(root, makeTask()));
    const ids = results.map((r) => r.id);
    // All ids unique.
    expect(new Set(ids).size).toBe(ids.length);
    // Every bundle dir survives independently (no overwrite): each has its own pending manifest.
    for (const id of ids) {
      const manifest = JSON.parse(fs.readFileSync(path.join(bundleDirOf(root, id), 'manifest.json'), 'utf8'));
      expect(manifest.id).toBe(id);
      expect(manifest.status).toBe('pending');
    }
    // The tasks dir holds exactly the N bundle directories.
    expect(fs.readdirSync(tasksDir(root)).sort()).toEqual([...ids].sort());
  });

  it('throws on a genuinely unwritable tasks dir (surfaced by generate() as a fallback status, never a bundle)', () => {
    const root = makeRoot();
    // Plant a regular FILE where .codegraph/ must be a directory → mkdir of tasks/ fails (ENOTDIR).
    fs.writeFileSync(getCodeGraphDir(root), 'not a directory', 'utf8');
    expect(() => emitBundle(root, makeTask())).toThrow();
  });
});

describe('emitBundle — atomic stage-then-rename (Finding B: no orphaned partial bundle)', () => {
  it('leaves NO bundle directory when a write fails mid-emit (never a partial <id>/ or .tmp-<id>/)', () => {
    const root = makeRoot();
    // A circular graphContext makes `JSON.stringify` throw DURING emit — a deterministic,
    // mock-free mid-emit failure (after the staging dir + the first file already exist).
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const task = makeTask({ graphContext: circular as unknown as string[] });

    // The failure propagates so generate() can degrade to the consumer fallback.
    expect(() => emitBundle(root, task)).toThrow();

    // Atomicity: no partial bundle is ever visible under the tasks root — no `<id>/`,
    // no `.tmp-<id>/` staging residue — and the resilient lister surfaces nothing.
    const leftovers = fs.existsSync(tasksDir(root)) ? fs.readdirSync(tasksDir(root)) : [];
    expect(leftovers).toEqual([]);
    expect(listBundles(root)).toEqual([]);
  });

  it('happy path publishes the bundle atomically (no .tmp- residue) and returns a redeemable handle', () => {
    const root = makeRoot();
    const { id, handle } = emitBundle(root, makeTask());
    expect(handle).toBe(id);
    // Exactly the one bundle dir is published — no leftover `.tmp-<id>` staging entry.
    expect(fs.readdirSync(tasksDir(root))).toEqual([id]);
    // And the handle redeems as pending (a complete, readable manifest was published).
    expect(redeemHandle(root, handle)).toEqual({ status: 'pending' });
  });
});

describe('emitBundle — bundle-local completion protocol (Finding C: FR-022 self-describing)', () => {
  it('writes a protocol file naming output.json + `codegraph tasks ingest`, keeping instructions.md verbatim', () => {
    const root = makeRoot();
    const task = makeTask({ instructions: 'THE EXACT CONSUMER TASK TEXT — DO NOT ALTER' });
    const { id } = emitBundle(root, task);
    const dir = bundleDirOf(root, id);

    // A bundle-local protocol file exists so the bundle is completable using ONLY
    // its own contents (FR-022) — no external companion skill required.
    const protocolPath = path.join(dir, 'README.md');
    expect(fs.existsSync(protocolPath)).toBe(true);
    const protocol = fs.readFileSync(protocolPath, 'utf8');
    // It tells the agent WHERE to write its answer, WHICH schema governs it, and
    // HOW the user finalizes — naming THIS bundle's id in the ingest command.
    expect(protocol).toContain('output.json');
    expect(protocol).toContain('output-contract.json');
    expect(protocol).toContain('codegraph tasks ingest');
    expect(protocol).toContain(id);

    // The consumer's task text stays verbatim and separate in instructions.md.
    expect(fs.readFileSync(path.join(dir, 'instructions.md'), 'utf8')).toBe(
      'THE EXACT CONSUMER TASK TEXT — DO NOT ALTER',
    );
  });
});

describe('listBundles — resilient enumeration (FR-026, daemon-registry precedent)', () => {
  it('returns an empty list when the tasks dir is absent', () => {
    expect(listBundles(makeRoot())).toEqual([]);
  });

  it('returns an empty list when the tasks dir exists but is empty', () => {
    const root = makeRoot();
    fs.mkdirSync(tasksDir(root), { recursive: true });
    expect(listBundles(root)).toEqual([]);
  });

  it('lists a pending bundle with id, status, createdAt and a non-negative age', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    const listing = listBundles(root);
    expect(listing).toHaveLength(1);
    expect(listing[0]!.id).toBe(id);
    expect(listing[0]!.status).toBe('pending');
    expect(typeof listing[0]!.createdAt).toBe('string');
    expect(listing[0]!.ageMs).not.toBeNull();
    expect(listing[0]!.ageMs!).toBeGreaterThanOrEqual(0);
  });

  it('surfaces a malformed / missing / unknown-status manifest instead of aborting the listing', () => {
    const root = makeRoot();
    const good = emitBundle(root, makeTask());
    const completed = emitBundle(root, makeTask());
    completeBundle(root, completed.id, 'DONE');

    // A bundle whose manifest is malformed JSON.
    const broken = emitBundle(root, makeTask());
    fs.writeFileSync(path.join(bundleDirOf(root, broken.id), 'manifest.json'), '{ not json', 'utf8');

    // A bundle dir with NO manifest at all.
    const noManifest = emitBundle(root, makeTask());
    fs.rmSync(path.join(bundleDirOf(root, noManifest.id), 'manifest.json'));

    // A bundle whose manifest has an out-of-enum status.
    const weird = emitBundle(root, makeTask());
    fs.writeFileSync(
      path.join(bundleDirOf(root, weird.id), 'manifest.json'),
      JSON.stringify({ id: weird.id, status: 'ingested', contract: 'output-contract.json', createdAt: new Date().toISOString() }),
      'utf8',
    );

    // A stray non-directory entry under tasks/ is skipped.
    fs.writeFileSync(path.join(tasksDir(root), 'stray.txt'), 'x', 'utf8');

    const byId = new Map(listBundles(root).map((b) => [b.id, b.status] as const));
    expect(byId.get(good.id)).toBe('pending');
    expect(byId.get(completed.id)).toBe('completed');
    expect(byId.get(broken.id)).toBe('unreadable');
    expect(byId.get(noManifest.id)).toBe('unreadable');
    expect(byId.get(weird.id)).toBe('unknown');
    // Five bundle directories surfaced; the stray file is not one of them.
    expect(byId.size).toBe(5);
    expect([...byId.keys()]).not.toContain('stray.txt');
  });
});

describe('redeemHandle — FR-010a closed RedeemResult', () => {
  it('returns { status:"pending" } for a freshly emitted (uncompleted) bundle', () => {
    const root = makeRoot();
    const { handle } = emitBundle(root, makeTask());
    expect(redeemHandle(root, handle)).toEqual({ status: 'pending' });
  });

  it('returns { status:"completed", text } once the bundle is completed', () => {
    const root = makeRoot();
    const { id, handle } = emitBundle(root, makeTask());
    completeBundle(root, id, 'THE FINAL PROSE ANSWER');
    expect(redeemHandle(root, handle)).toEqual({ status: 'completed', text: 'THE FINAL PROSE ANSWER' });
  });

  it('returns { status:"missing" } once the bundle dir is removed', () => {
    const root = makeRoot();
    const { id, handle } = emitBundle(root, makeTask());
    fs.rmSync(bundleDirOf(root, id), { recursive: true, force: true });
    expect(redeemHandle(root, handle)).toEqual({ status: 'missing' });
  });

  it('returns { status:"pending" } on a present-but-unreadable manifest (never throws, never false completed — CRL 7)', () => {
    const root = makeRoot();
    const { id, handle } = emitBundle(root, makeTask());
    fs.writeFileSync(path.join(bundleDirOf(root, id), 'manifest.json'), 'not-json{{{', 'utf8');
    expect(redeemHandle(root, handle)).toEqual({ status: 'pending' });
  });

  it('returns { status:"pending" } when the manifest is completed but the canonical result is unreadable (never a false completed)', () => {
    const root = makeRoot();
    const { id, handle } = emitBundle(root, makeTask());
    // Stamp completed but write a corrupt result.json.
    const manifest = JSON.parse(fs.readFileSync(path.join(bundleDirOf(root, id), 'manifest.json'), 'utf8'));
    manifest.status = 'completed';
    fs.writeFileSync(path.join(bundleDirOf(root, id), 'manifest.json'), JSON.stringify(manifest), 'utf8');
    fs.writeFileSync(path.join(bundleDirOf(root, id), 'result.json'), 'corrupt{', 'utf8');
    expect(redeemHandle(root, handle)).toEqual({ status: 'pending' });
  });

  it('anchor-contains the handle: a separator-bearing / escaping / non-segment handle → missing with NO read (FR-029a/CRL 8)', () => {
    const root = makeRoot();
    // Prove no read happens: even with a real bundle present, these handles never designate it.
    emitBundle(root, makeTask());
    for (const bad of ['../../src', 'a/b', '..', '.', '', 'nested/child', path.join('..', 'escape')]) {
      expect(redeemHandle(root, bad)).toEqual({ status: 'missing' });
    }
    // An absolute path is likewise rejected as a non-segment.
    expect(redeemHandle(root, path.resolve(root))).toEqual({ status: 'missing' });
  });

  it('does not follow a bundle-dir symlink that escapes the tasks root', () => {
    if (process.platform === 'win32') return; // symlink creation needs privileges on Windows
    const root = makeRoot();
    // A completed bundle OUTSIDE the tasks root.
    const outside = makeRoot();
    fs.mkdirSync(path.join(outside, 'secret'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret', 'manifest.json'), JSON.stringify({ status: 'completed' }), 'utf8');
    fs.writeFileSync(path.join(outside, 'secret', 'result.json'), JSON.stringify({ text: 'LEAKED' }), 'utf8');
    fs.mkdirSync(tasksDir(root), { recursive: true });
    fs.symlinkSync(path.join(outside, 'secret'), bundleDirOf(root, 'evil'), 'dir');
    // The realpath escapes the tasks root → treated as missing, never a completed leak.
    expect(redeemHandle(root, 'evil')).toEqual({ status: 'missing' });
  });
});

describe('readBundleFileSafely — FR-029a bounded safe-read (research D9)', () => {
  function seedBundle(root: string): string {
    const { id } = emitBundle(root, makeTask());
    return bundleDirOf(root, id);
  }

  it('reads and parses a contained regular JSON file → { ok:true, value }', () => {
    const root = makeRoot();
    const dir = seedBundle(root);
    const res = readBundleFileSafely(root, dir, 'manifest.json');
    expect(res.ok).toBe(true);
    expect(res.ok && (res.value as { status: string }).status).toBe('pending');
  });

  it('rejects a relPath resolving outside the bundle dir (containment)', () => {
    const root = makeRoot();
    const dir = seedBundle(root);
    // Plant a file just outside the bundle dir and try to escape into it.
    fs.writeFileSync(path.join(tasksDir(root), 'outside.json'), JSON.stringify({ x: 1 }), 'utf8');
    const res = readBundleFileSafely(root, dir, path.join('..', 'outside.json'));
    expect(res.ok).toBe(false);
  });

  it('rejects a symlink where a regular file is expected, independent of target', () => {
    if (process.platform === 'win32') return; // symlink creation needs privileges on Windows
    const root = makeRoot();
    const dir = seedBundle(root);
    // A symlink to an in-bundle regular file: containment passes, symlink rejection still fires.
    fs.symlinkSync(path.join(dir, 'manifest.json'), path.join(dir, 'link.json'));
    const res = readBundleFileSafely(root, dir, 'link.json');
    expect(res.ok).toBe(false);
  });

  it(`rejects a file larger than MAX_BUNDLE_INPUT_BYTES (${MAX_BUNDLE_INPUT_BYTES}) before parsing`, () => {
    const root = makeRoot();
    const dir = seedBundle(root);
    const huge = '"' + 'A'.repeat(MAX_BUNDLE_INPUT_BYTES + 16) + '"';
    fs.writeFileSync(path.join(dir, 'big.json'), huge, 'utf8');
    const res = readBundleFileSafely(root, dir, 'big.json');
    expect(res.ok).toBe(false);
  });

  it(`rejects JSON nested past MAX_JSON_DEPTH (${MAX_JSON_DEPTH}) with a bounded-depth parse`, () => {
    const root = makeRoot();
    const dir = seedBundle(root);
    const deep = '['.repeat(MAX_JSON_DEPTH + 8) + ']'.repeat(MAX_JSON_DEPTH + 8);
    fs.writeFileSync(path.join(dir, 'deep.json'), deep, 'utf8');
    const res = readBundleFileSafely(root, dir, 'deep.json');
    expect(res.ok).toBe(false);
  });

  it('accepts JSON at exactly MAX_JSON_DEPTH (the bound is inclusive)', () => {
    const root = makeRoot();
    const dir = seedBundle(root);
    const atLimit = '['.repeat(MAX_JSON_DEPTH) + ']'.repeat(MAX_JSON_DEPTH);
    fs.writeFileSync(path.join(dir, 'atlimit.json'), atLimit, 'utf8');
    const res = readBundleFileSafely(root, dir, 'atlimit.json');
    expect(res.ok).toBe(true);
  });

  it('rejects malformed JSON and an absent file (both { ok:false })', () => {
    const root = makeRoot();
    const dir = seedBundle(root);
    fs.writeFileSync(path.join(dir, 'bad.json'), 'not json', 'utf8');
    expect(readBundleFileSafely(root, dir, 'bad.json').ok).toBe(false);
    expect(readBundleFileSafely(root, dir, 'nope.json').ok).toBe(false);
  });

  it('never pollutes Object.prototype from a __proto__ key (read-expected-fields-only)', () => {
    const root = makeRoot();
    const dir = seedBundle(root);
    fs.writeFileSync(
      path.join(dir, 'evil.json'),
      '{"__proto__": {"polluted": "yes"}, "status": "pending"}',
      'utf8',
    );
    const res = readBundleFileSafely(root, dir, 'evil.json');
    expect(res.ok).toBe(true);
    // No global prototype pollution occurred.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('readBundleFileSafely — fd-bound validate+read (Finding A: CodeQL js/file-system-race)', () => {
  // The fix binds the symlink/type/size validation AND the read to ONE descriptor, so
  // no path-based stat is followed by a path-based read of a swapped inode. The observable
  // contract is unchanged (behavior-preserving refactor); the definitive acceptance is the
  // CodeQL alert clearing in CI post-push. These pin the contract the fd path must uphold,
  // with the EXACT preserved reason strings that ingest.ts / redeemHandle depend on.
  function seedBundle(root: string): string {
    const { id } = emitBundle(root, makeTask());
    return bundleDirOf(root, id);
  }

  it('reads and parses a normal contained JSON file via the single descriptor', () => {
    const root = makeRoot();
    const dir = seedBundle(root);
    const res = readBundleFileSafely(root, dir, 'manifest.json');
    expect(res.ok).toBe(true);
    expect(res.ok && (res.value as { status: string }).status).toBe('pending');
  });

  it('rejects a symlinked final component with the preserved symlink reason (O_NOFOLLOW → ELOOP)', () => {
    if (process.platform === 'win32') return; // symlink creation needs privileges on Windows
    const root = makeRoot();
    const dir = seedBundle(root);
    // A symlink to an in-bundle regular file: containment passes, the fd open still refuses it.
    fs.symlinkSync(path.join(dir, 'manifest.json'), path.join(dir, 'link.json'));
    const res = readBundleFileSafely(root, dir, 'link.json');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('refusing to read a symlink: link.json');
  });

  it('rejects an oversized file via the fstat size check with the preserved size reason', () => {
    const root = makeRoot();
    const dir = seedBundle(root);
    const huge = '"' + 'A'.repeat(MAX_BUNDLE_INPUT_BYTES + 16) + '"';
    fs.writeFileSync(path.join(dir, 'big.json'), huge, 'utf8');
    const res = readBundleFileSafely(root, dir, 'big.json');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe(`file exceeds ${MAX_BUNDLE_INPUT_BYTES} bytes: big.json`);
  });

  it('maps an absent file to the preserved not-found reason (fd open fails, non-ELOOP)', () => {
    const root = makeRoot();
    const dir = seedBundle(root);
    const res = readBundleFileSafely(root, dir, 'nope.json');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('file not found: nope.json');
  });
});

describe('countPendingBundles — network-free pending count (data-model §8)', () => {
  it('is 0 for an absent tasks dir', () => {
    expect(countPendingBundles(makeRoot())).toBe(0);
  });

  it('counts only pending bundles — completed and unreadable are excluded', () => {
    const root = makeRoot();
    emitBundle(root, makeTask()); // pending
    emitBundle(root, makeTask()); // pending
    const done = emitBundle(root, makeTask());
    completeBundle(root, done.id, 'DONE'); // completed
    const broken = emitBundle(root, makeTask());
    fs.writeFileSync(path.join(bundleDirOf(root, broken.id), 'manifest.json'), '{bad', 'utf8'); // unreadable
    expect(countPendingBundles(root)).toBe(2);
  });
});

describe('getLlmStatus — agent branch composes pendingBundles (T021, network-free)', () => {
  it('attaches the pending-bundle count in agent mode and drops it once completed', () => {
    const root = makeRoot();
    const cg = CodeGraph.initSync(root);
    try {
      process.env.CODEGRAPH_LLM_PROVIDER = 'agent';
      emitBundle(root, makeTask());
      const two = emitBundle(root, makeTask());

      const status = cg.getLlmStatus();
      expect(status).toEqual({ active: true, mode: 'agent', pendingBundles: 2 });

      completeBundle(root, two.id, 'DONE');
      const after = cg.getLlmStatus();
      expect(after).toEqual({ active: true, mode: 'agent', pendingBundles: 1 });
    } finally {
      cg.close();
    }
  });

  it('does not attach pendingBundles when the LLM layer is dormant', () => {
    const root = makeRoot();
    const cg = CodeGraph.initSync(root);
    try {
      const status = cg.getLlmStatus();
      expect(status.active).toBe(false);
      expect('pendingBundles' in status).toBe(false);
    } finally {
      cg.close();
    }
  });
});
