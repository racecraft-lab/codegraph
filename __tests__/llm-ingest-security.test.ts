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
import { emitBundle, MAX_BUNDLE_INPUT_BYTES, MAX_JSON_DEPTH } from '../src/llm/agent-bundle';
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
