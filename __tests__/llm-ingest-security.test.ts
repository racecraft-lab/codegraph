/**
 * Agent-mode bundle ingest — FR-029a untrusted-input hardening (SPEC-018 slice 2, T025).
 *
 * Pins the security posture of `ingestBundle(root, id)` in `src/llm/ingest.ts`
 * (spec FR-029a / SC-006, research D9, contracts/bundle-files.md §FR-029a). The bundle
 * directory's contents AND the bundle-selecting id are untrusted, same-user input:
 *   - Anchor containment (CRL 8): the `<id>` is validated as a single contained segment
 *     under `.codegraph/tasks/` BEFORE the bundle dir is trusted as the per-path anchor
 *     — a crafted id (`../../evil`, `..`, `a/b`) cannot relocate the anchor, so ingest
 *     never reads or writes at the escaped location.
 *   - Every named path (agent output, the `manifest.contract` pointer, any contract/
 *     output-named path) is routed through `readBundleFileSafely` — containment,
 *     symlink rejection, `MAX_BUNDLE_INPUT_BYTES` size bound, `MAX_JSON_DEPTH` depth
 *     bound — so a tampered pointer, a symlink, an oversize file, or a deeply-nested
 *     payload is rejected before the read/parse completes.
 *   - Parsed output is consumed by reading only the contract's declared fields (own-key
 *     reads), never deep-merged — so `__proto__`/`constructor` keys cannot pollute a
 *     prototype.
 *
 * Every rejection is FR-028a-shaped: manifest stays `pending`, no consumer artifact is
 * written, ingest never throws / never `isError`. Symlink assertions are POSIX-gated
 * (`it.runIf`). Real temp roots + real fs, cleaned in `afterEach`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ingestBundle } from '../src/llm/ingest';
import { emitBundle, redeemHandle, MAX_BUNDLE_INPUT_BYTES, MAX_JSON_DEPTH } from '../src/llm/agent-bundle';
import type { ProseTask, OutputContract } from '../src/llm/generate';
import { getCodeGraphDir } from '../src/directory';

const POSIX = process.platform !== 'win32';

const tempDirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-llm-ingest-sec-'));
  tempDirs.push(dir);
  return dir;
}

const PROSE_CONTRACT: OutputContract = { requiredFields: [{ name: 'prose', type: 'string', nonEmpty: true }] };
function makeTask(overrides: Partial<ProseTask> = {}): ProseTask {
  return {
    instructions: 'Summarize.',
    graphContext: [],
    outputContract: PROSE_CONTRACT,
    fallback: 'FALLBACK',
    ...overrides,
  };
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
function resultExists(root: string, id: string): boolean {
  return fs.existsSync(path.join(bundleDirOf(root, id), 'result.json'));
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
describe('FR-029a — id anchor containment (CRL 8): a crafted id cannot relocate the anchor', () => {
  it('does not process a completable bundle planted at an escape target, and writes nothing there', () => {
    const root = makeRoot();
    // Make the tasks root exist so a plain path.join(tasksRoot, "../../evil") would resolve
    // to a real, completable bundle just outside it.
    fs.mkdirSync(tasksDir(root), { recursive: true });
    const evilDir = path.join(root, 'evil'); // == path.join(tasksRoot, '../../evil')
    fs.mkdirSync(evilDir, { recursive: true });
    fs.writeFileSync(
      path.join(evilDir, 'manifest.json'),
      JSON.stringify({ id: 'evil', status: 'pending', contract: 'output-contract.json', createdAt: new Date().toISOString() }),
      'utf8',
    );
    fs.writeFileSync(path.join(evilDir, 'output-contract.json'), JSON.stringify(PROSE_CONTRACT), 'utf8');
    fs.writeFileSync(path.join(evilDir, 'output.json'), JSON.stringify({ prose: 'LEAKED' }), 'utf8');

    const result = ingestBundle(root, path.join('..', '..', 'evil'));
    expect(result.ok).toBe(false); // rejected before the escaped dir is opened

    // The escape target is untouched: no consumer artifact, manifest still pending.
    expect(fs.existsSync(path.join(evilDir, 'result.json'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(evilDir, 'manifest.json'), 'utf8')).status).toBe('pending');
  });

  it('rejects ids carrying a path separator or dot-segments (a/b, ../.., ., .., "") with no read/write', () => {
    const root = makeRoot();
    fs.mkdirSync(tasksDir(root), { recursive: true });
    for (const bad of ['a/b', 'nested/child', '..', '.', '', path.join('..', '..', 'src'), path.join('..', 'escape')]) {
      const result = ingestBundle(root, bad);
      expect(result.ok).toBe(false);
    }
    // An absolute path is likewise rejected as a non-segment.
    expect(ingestBundle(root, path.resolve(root, 'src')).ok).toBe(false);
  });
});

describe('FR-029a — every named path routed through the bounded safe-read', () => {
  it('rejects a tampered manifest.contract pointer that escapes the bundle dir (no artifact, manifest pending)', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    writeOutput(root, id, { prose: 'conforming' }); // output itself is fine
    // A valid contract sitting OUTSIDE the bundle dir, that a naive follow-the-pointer read
    // would happily load.
    fs.writeFileSync(path.join(tasksDir(root), 'outside-contract.json'), JSON.stringify(PROSE_CONTRACT), 'utf8');
    // Point the manifest's contract pointer at it (escaping the bundle dir).
    const manifestPath = path.join(bundleDirOf(root, id), 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.contract = path.join('..', 'outside-contract.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');

    const result = ingestBundle(root, id);
    expect(result.ok).toBe(false); // the escaping contract pointer is rejected
    expect(manifestStatus(root, id)).toBe('pending');
    expect(resultExists(root, id)).toBe(false);
  });

  it.runIf(POSIX)('rejects a symlinked output.json where a regular file is expected', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    // A real conforming answer elsewhere; output.json is a symlink to it.
    const realAnswer = path.join(root, 'real-output.json');
    fs.writeFileSync(realAnswer, JSON.stringify({ prose: 'via symlink' }), 'utf8');
    fs.symlinkSync(realAnswer, path.join(bundleDirOf(root, id), 'output.json'));

    const result = ingestBundle(root, id);
    expect(result.ok).toBe(false);
    expect(manifestStatus(root, id)).toBe('pending');
    expect(resultExists(root, id)).toBe(false);
  });

  it.runIf(POSIX)('rejects a symlinked contract path where a regular file is expected', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    writeOutput(root, id, { prose: 'conforming' });
    // Replace the in-bundle contract with a symlink (to a real, valid contract).
    const realContract = path.join(root, 'real-contract.json');
    fs.writeFileSync(realContract, JSON.stringify(PROSE_CONTRACT), 'utf8');
    const contractPath = path.join(bundleDirOf(root, id), 'output-contract.json');
    fs.rmSync(contractPath);
    fs.symlinkSync(realContract, contractPath);

    const result = ingestBundle(root, id);
    expect(result.ok).toBe(false);
    expect(manifestStatus(root, id)).toBe('pending');
    expect(resultExists(root, id)).toBe(false);
  });

  it(`rejects an output.json larger than MAX_BUNDLE_INPUT_BYTES (${MAX_BUNDLE_INPUT_BYTES}) before parsing`, () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    const huge = '{"prose":"' + 'A'.repeat(MAX_BUNDLE_INPUT_BYTES + 16) + '"}';
    fs.writeFileSync(path.join(bundleDirOf(root, id), 'output.json'), huge, 'utf8');
    const result = ingestBundle(root, id);
    expect(result.ok).toBe(false);
    expect(manifestStatus(root, id)).toBe('pending');
    expect(resultExists(root, id)).toBe(false);
  });

  it(`rejects an output.json nested past MAX_JSON_DEPTH (${MAX_JSON_DEPTH})`, () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    const deep = '{"prose":' + '['.repeat(MAX_JSON_DEPTH + 8) + ']'.repeat(MAX_JSON_DEPTH + 8) + '}';
    fs.writeFileSync(path.join(bundleDirOf(root, id), 'output.json'), deep, 'utf8');
    const result = ingestBundle(root, id);
    expect(result.ok).toBe(false);
    expect(manifestStatus(root, id)).toBe('pending');
    expect(resultExists(root, id)).toBe(false);
  });
});

describe('FR-029a — read-expected-fields-only: no prototype pollution from output keys', () => {
  it('does not pollute Object.prototype from a __proto__ key in the agent output', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    fs.writeFileSync(
      path.join(bundleDirOf(root, id), 'output.json'),
      '{"prose":"clean","__proto__":{"polluted":"yes"}}',
      'utf8',
    );
    ingestBundle(root, id);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect('polluted' in {}).toBe(false);
  });

  it('does not pollute a prototype from a constructor.prototype key in the agent output', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    fs.writeFileSync(
      path.join(bundleDirOf(root, id), 'output.json'),
      '{"prose":"clean","constructor":{"prototype":{"polluted":"yes"}}}',
      'utf8',
    );
    // Consuming only the declared `prose` field, ingest succeeds and pollutes nothing.
    expect(ingestBundle(root, id)).toEqual({ ok: true, text: 'clean' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('FR-029a — write targets refuse a pre-planted link (no arbitrary-file overwrite)', () => {
  it.runIf(POSIX)(
    'refuses to follow a pre-planted result.json symlink and leaves the out-of-bundle victim untouched',
    () => {
      const root = makeRoot();
      const { id } = emitBundle(root, makeTask());
      // A conforming answer — structural validation PASSES, so ingest reaches the write step.
      writeOutput(root, id, { prose: 'attacker-controlled prose' });

      // A victim file OUTSIDE the bundle dir, with known content.
      const victim = path.join(root, 'victim.txt');
      const ORIGINAL = 'ORIGINAL VICTIM CONTENTS - DO NOT OVERWRITE';
      fs.writeFileSync(victim, ORIGINAL, 'utf8');

      // Pre-plant result.json inside the bundle dir as a SYMLINK -> the victim. A naive
      // fs.writeFileSync(result.json, …) FOLLOWS this and overwrites the victim with
      // {"text":"attacker-controlled prose"} — the arbitrary-file-overwrite primitive. The
      // exclusive create (O_CREAT|O_EXCL|O_NOFOLLOW) refuses the pre-existing symlink with
      // EEXIST, so the victim is never opened and the symlink is left in place untouched.
      const resultPath = path.join(bundleDirOf(root, id), 'result.json');
      fs.symlinkSync(victim, resultPath);

      const result = ingestBundle(root, id);

      // (b) The victim is byte-for-byte unchanged — the write must never follow the symlink.
      expect(fs.readFileSync(victim, 'utf8')).toBe(ORIGINAL);
      // (a) FR-028a-shaped rejection: no completion, no valid result installed.
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('result.json');
      expect(manifestStatus(root, id)).toBe('pending');
      // The planted symlink was NOT replaced by a real result file — nothing was installed.
      expect(fs.lstatSync(resultPath).isSymbolicLink()).toBe(true);
    },
  );

  it.runIf(POSIX)(
    'refuses to follow a pre-planted result.json HARD LINK and leaves the out-of-bundle victim untouched',
    () => {
      const root = makeRoot();
      const { id } = emitBundle(root, makeTask());
      // A conforming answer — structural validation PASSES, so ingest reaches the write step.
      writeOutput(root, id, { prose: 'attacker-controlled prose' });

      // A victim file OUTSIDE the bundle dir, with known content.
      const victim = path.join(root, 'victim.txt');
      const ORIGINAL = 'ORIGINAL VICTIM CONTENTS - DO NOT OVERWRITE';
      fs.writeFileSync(victim, ORIGINAL, 'utf8');

      // Pre-plant result.json inside the bundle dir as a HARD LINK -> the victim. A hard link
      // IS a regular file, so a symlink/lstat guard passes it; a naive fs.writeFileSync then
      // TRUNCATES the victim through the shared inode — the arbitrary-file-overwrite primitive
      // a symlink guard CANNOT catch (the link's own path is inside the bundle, so
      // validatePathWithinRoot sees only a contained path). Exclusive create (O_CREAT|O_EXCL)
      // fails with EEXIST because the path already exists at all, so the victim is never opened.
      const resultPath = path.join(bundleDirOf(root, id), 'result.json');
      fs.linkSync(victim, resultPath);

      const result = ingestBundle(root, id);

      // The victim is byte-for-byte unchanged — the exclusive create refuses the existing entry.
      expect(fs.readFileSync(victim, 'utf8')).toBe(ORIGINAL);
      // FR-028a-shaped rejection: no completion.
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('result.json');
      expect(manifestStatus(root, id)).toBe('pending');
    },
  );
});

describe('FR-029a / FR-028a — finalization is atomic and never throws (no partial consumer artifact)', () => {
  it.runIf(POSIX)(
    'returns { ok:false } (never throws) and installs no result.json when the bundle dir is unwritable',
    () => {
      const root = makeRoot();
      const { id } = emitBundle(root, makeTask());
      writeOutput(root, id, { prose: 'valid answer' });
      const bundleDir = bundleDirOf(root, id);
      // Make the bundle dir read-only so every finalization write (creating result.json or the
      // temp manifest) fails with EACCES. A naive unguarded writeFileSync THROWS here —
      // violating ingestBundle's documented never-throws contract. Reads (manifest / output /
      // contract) still succeed on an r-x dir, so validation passes and finalization is reached.
      fs.chmodSync(bundleDir, 0o555);
      try {
        let result: ReturnType<typeof ingestBundle> | undefined;
        expect(() => {
          result = ingestBundle(root, id);
        }).not.toThrow();
        expect(result && result.ok).toBe(false);
        expect(fs.existsSync(path.join(bundleDir, 'result.json'))).toBe(false);
      } finally {
        fs.chmodSync(bundleDir, 0o755); // restore so afterEach cleanup can remove the tree
      }
      // The manifest was never stamped — the bundle stays re-ingestable.
      expect(manifestStatus(root, id)).toBe('pending');
    },
  );

  it('rolls back result.json and leaves the manifest pending when the manifest step cannot complete', () => {
    const root = makeRoot();
    const { id } = emitBundle(root, makeTask());
    writeOutput(root, id, { prose: 'valid answer' });
    const bundleDir = bundleDirOf(root, id);
    // Pre-plant the manifest temp path as a DIRECTORY so the exclusive temp-file create (and
    // its single unlink+retry) cannot succeed — finalization fails AFTER result.json is
    // written but BEFORE the manifest is stamped. The rollback must remove the just-written
    // result.json so no consumer artifact is left beside a still-`pending` manifest (FR-028a).
    fs.mkdirSync(path.join(bundleDir, 'manifest.json.ingest-tmp'));

    let result: ReturnType<typeof ingestBundle> | undefined;
    expect(() => {
      result = ingestBundle(root, id);
    }).not.toThrow();
    expect(result && result.ok).toBe(false);
    expect(resultExists(root, id)).toBe(false); // rolled back — no orphaned consumer artifact
    expect(manifestStatus(root, id)).toBe('pending'); // re-ingestable
  });
});

// --------------------------------------------------------------------------
// Fix G (rp-review round 2): a tampered OutputContract must not amplify bounded input
// into an unbounded result. `parseContract` accepted DUPLICATE required-field names, and
// `deriveText` emits each declared field's value once PER declaration — so a contract
// repeating the same field name, over a single large-but-valid `output.json`, produced a
// result.json far larger than any input file. That result then also failed the 1 MiB
// bounded safe-read, so `redeemHandle` could never hand it back — a written-but-un-redeemable
// bundle. The fix rejects duplicate field names at parse time (the operative guard) and, as
// defense-in-depth, refuses to write any serialized result that exceeds the safe reader's
// ceiling — so every written result.json stays redeemable.
describe('FR-028a — a tampered contract cannot amplify bounded input into an un-redeemable result (Fix G)', () => {
  it('rejects a contract with DUPLICATE required-field names as malformed (no artifact, manifest pending)', () => {
    const root = makeRoot();
    const dupContract = {
      requiredFields: [
        { name: 'prose', type: 'string', nonEmpty: true },
        { name: 'prose', type: 'string', nonEmpty: true },
      ],
    } as OutputContract;
    const { id } = emitBundle(root, makeTask({ outputContract: dupContract }));
    writeOutput(root, id, { prose: 'small' });

    const result = ingestBundle(root, id);
    expect(result.ok).toBe(false); // pre-fix: ACCEPTED (deriveText emits "small\n\nsmall")
    if (!result.ok) expect(result.reason).toContain('malformed output contract');
    expect(manifestStatus(root, id)).toBe('pending');
    expect(resultExists(root, id)).toBe(false);
  });

  it('rejects an amplifying contract before writing an oversized, un-redeemable result.json (result stays redeemable)', () => {
    const root = makeRoot();
    // Three declarations of the SAME field: each bundle file stays < MAX_BUNDLE_INPUT_BYTES,
    // but a naive deriveText concatenates the (large, valid) value 3× into a > 1 MiB result —
    // which the 1 MiB bounded safe-reader could then NEVER redeem. It must be rejected before
    // any result.json is written, leaving the bundle pending and redeemable.
    const ampContract = {
      requiredFields: [
        { name: 'prose', type: 'string', nonEmpty: true },
        { name: 'prose', type: 'string', nonEmpty: true },
        { name: 'prose', type: 'string', nonEmpty: true },
      ],
    } as OutputContract;
    const { id, handle } = emitBundle(root, makeTask({ outputContract: ampContract }));
    const big = 'a'.repeat(400 * 1024); // one 400 KiB value → output.json < 1 MiB, but 3× derived > 1 MiB
    writeOutput(root, id, { prose: big });

    const result = ingestBundle(root, id);
    // Pre-fix: ingest ACCEPTS, writes a ~1.2 MiB result.json, and stamps completed — but
    // redeemHandle can never read it back (> 1 MiB), so the finalized text is silently lost.
    expect(result.ok).toBe(false);
    expect(resultExists(root, id)).toBe(false);
    expect(manifestStatus(root, id)).toBe('pending');
    // The bundle is never left written-but-un-redeemable — it stays pending / re-ingestable.
    expect(redeemHandle(root, handle)).toEqual({ status: 'pending' });
  });
});
