/**
 * model-fetch — lazy, checksum-verified local model acquisition (SPEC-002, T008).
 *
 * Exercises the acquisition state machine entirely against an INJECTED `fetch`
 * and small, test-only fake artifact specs (real files, real temp dirs — never
 * the real network, and never the real ~22MB production pin, which cannot be
 * feasibly satisfied by hand-crafted test bytes since SHA-256 is preimage
 * resistant). A dedicated pin-regression test (bottom of this file) asserts the
 * two PRODUCTION digests verbatim so an accidental edit to the pinned constants
 * is caught independently.
 *
 * Traceability: FR-013 (per-artifact SHA-256), FR-013a (size + wall-clock
 * bounds), FR-014/SC-003 (verify-before-use; mismatch discarded), FR-015
 * (CODEGRAPH_MODEL_BASE_URL override + http/https scheme constraint), FR-016/
 * FR-017 (4-case cache dir + override), FR-017a (purpose-built cache validator;
 * atomic O_EXCL/no-symlink/unpredictable temp; mid-download I/O -> cache not
 * offline), FR-018 (reuse without re-download), FR-019/FR-019a (three distinct,
 * actionable, redacted messages), FR-019c (no source/composed-input echo),
 * the archived SPEC-002 model-fetch contract (the verify-before-use state
 * machine).
 *
 * See `.specify/memory/archive-reports/2026-07-07-SPEC-002.md` for recovery
 * commands for the archived SPEC-002 model-fetch contract and data model that
 * define the authoritative behavior this suite pins.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'node:crypto';
import {
  acquireLocalModel,
  probeLocalModelCache,
  resolveModelCacheDir,
  validateModelCacheDir,
  MODEL_ARTIFACT,
  TOKENIZER_ARTIFACT,
} from '../src/embeddings/model-fetch';
import type { PinnedArtifact, LocalModelArtifacts, LocalModelUnavailable } from '../src/embeddings/model-fetch';
import { isWithinDir, SENSITIVE_SYSTEM_PATHS } from '../src/utils';
import { modelCacheFixtureParent } from './setup/model-cache-fixture';

// `fs`'s ESM module namespace is not configurable (vi.spyOn(fs, 'readFileSync')
// throws "Cannot redefine property"), so the standard vitest workaround wraps
// the real implementation via `importOriginal` — every other fs function is the
// untouched real one; only `readFileSync`'s CALL COUNT becomes observable, for
// the "does not re-hash" test below.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync), writeSync: vi.fn(actual.writeSync), renameSync: vi.fn(actual.renameSync) };
});

// os.homedir() is wrapped so a test can stand in a home under a SENSITIVE_PATHS root (the
// root/Docker case: os.homedir() === '/root'); it delegates to the real homedir otherwise.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: vi.fn(actual.homedir) };
});

// --- temp dir bookkeeping ---------------------------------------------------
//
// Nested under a validated, writable parent (modelCacheFixtureParent), NOT
// os.tmpdir(): on macOS os.tmpdir() resolves under /var/folders/... — and /var is
// itself a SENSITIVE_PATHS entry — and under root os.homedir() is /root (also
// sensitive). validateModelCacheDir does a PREFIX match (FR-017a), so either would
// be (correctly!) rejected as sensitive, masking every test below that needs a
// genuinely valid cache dir stand-in. The helper picks the first non-sensitive,
// writable parent (homedir for a normal user, cwd under root).
const tempDirs: string[] = [];
function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(modelCacheFixtureParent(), '.cg-model-fetch-test-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { ...overrides };
}

/** Mirrors the module's internal cache layout (data-model.md §3): <cacheDir>/all-MiniLM-L6-v2/<basename>. */
function expectedArtifactPath(cacheDir: string, relPath: string): string {
  return path.join(cacheDir, 'all-MiniLM-L6-v2', path.basename(relPath));
}

function expectSuccess(result: LocalModelArtifacts | LocalModelUnavailable): LocalModelArtifacts {
  expect('unavailable' in result).toBe(false);
  return result as LocalModelArtifacts;
}

function expectUnavailable(result: LocalModelArtifacts | LocalModelUnavailable): LocalModelUnavailable {
  expect('unavailable' in result).toBe(true);
  return result as LocalModelUnavailable;
}

// --- fetch fixtures ----------------------------------------------------------
function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A small, test-only artifact pair — never the real ~22MB production pin. */
function fakeArtifacts(content: Buffer = Buffer.from('fake-model-bytes')): { model: PinnedArtifact; tokenizer: PinnedArtifact } {
  const sha256 = sha256Hex(content);
  return {
    model: { relPath: 'fake-model.bin', size: content.length, sha256 },
    tokenizer: { relPath: 'fake-tokenizer.bin', size: content.length, sha256 },
  };
}

/**
 * Same LENGTH as `content` but different bytes — a genuine checksum mismatch
 * without also tripping the FR-013a size-budget guard (which fires on ANY
 * length past the pin, independent of content, and would otherwise mask the
 * checksum path behind an `offline` result).
 */
function tamperedCopy(content: Buffer): Buffer {
  const copy = Buffer.from(content);
  if (copy.length > 0) copy[0] = (copy[0]! ^ 0xff) & 0xff;
  return copy;
}

interface FetchCall {
  url: string;
}

/** Injectable fetch that serves fixed bytes for any URL, recording every call. */
function fetchServing(content: Buffer, calls: FetchCall[] = []): typeof fetch {
  return (async (input: unknown) => {
    calls.push({ url: String(input) });
    return new Response(content, { status: 200 });
  }) as unknown as typeof fetch;
}

/** Injectable fetch that always fails (simulated offline / network error). */
function fetchOffline(): typeof fetch {
  return (async () => {
    throw new Error('simulated network failure');
  }) as unknown as typeof fetch;
}

/** Injectable fetch whose call hangs until the caller's AbortSignal fires. */
function fetchHanging(): typeof fetch {
  return ((_input: unknown, init?: { signal?: AbortSignal }) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  }) as unknown as typeof fetch;
}

/** Injectable fetch whose body streams MORE bytes than the artifact's pinned size. */
function fetchOversized(totalBytes: number, chunkSize = 4): typeof fetch {
  return (async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= totalBytes) {
          controller.close();
          return;
        }
        const n = Math.min(chunkSize, totalBytes - sent);
        controller.enqueue(new Uint8Array(n).fill(65));
        sent += n;
      },
    });
    return new Response(stream, { status: 200 });
  }) as unknown as typeof fetch;
}

// =============================================================================
describe('resolveModelCacheDir — FR-016 4-case platform formula / FR-017 override', () => {
  it('CODEGRAPH_MODEL_CACHE_DIR override wins regardless of platform', () => {
    const dir = resolveModelCacheDir(baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: '/custom/cache/dir' }));
    expect(dir).toBe('/custom/cache/dir');
  });

  it.runIf(process.platform !== 'win32')('POSIX, XDG_CACHE_HOME unset -> ~/.codegraph/models', () => {
    const dir = resolveModelCacheDir(baseEnv({ XDG_CACHE_HOME: undefined }));
    expect(dir).toBe(path.join(os.homedir(), '.codegraph', 'models'));
  });

  it.runIf(process.platform !== 'win32')('POSIX, XDG_CACHE_HOME set -> $XDG_CACHE_HOME/codegraph/models', () => {
    const dir = resolveModelCacheDir(baseEnv({ XDG_CACHE_HOME: '/home/x/.cache' }));
    expect(dir).toBe(path.join('/home/x/.cache', 'codegraph', 'models'));
  });

  it.runIf(process.platform !== 'win32')('IGNORES a RELATIVE XDG_CACHE_HOME (XDG spec: relative paths are invalid) and falls back to the home default (iter-38 P1)', () => {
    // A relative XDG value must not become a CWD-relative cache — fall through to ~/.codegraph/models.
    const dir = resolveModelCacheDir(baseEnv({ XDG_CACHE_HOME: 'relative/cache' }));
    expect(dir).toBe(path.join(os.homedir(), '.codegraph', 'models'));
  });

  it('REJECTS a relative CODEGRAPH_MODEL_CACHE_DIR as invalid — never roots the cache under CWD (FR-016) AND never silently uses a different cache (iter-41 P2 / iter-42 P1)', () => {
    // A relative override like `.codegraph/models` would root the ~22MB cache under CWD — inside
    // whatever project launched CodeGraph (FR-016). The explicit override is NOT silently ignored
    // (that would use a DIFFERENT cache than the operator set, and status could report a verified
    // default while the configured override is invalid); it is rejected so acquisition/status
    // degrade as invalid-cache with actionable "make it an absolute path" guidance.
    expect(resolveModelCacheDir(baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: '.codegraph/models' }))).toBeNull();
    // The status probe agrees — invalid-cache, not a verified/`missing` default cache.
    expect(probeLocalModelCache(baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: 'relative/models' }))).toBe('invalid-cache');
  });

  it.runIf(process.platform !== 'win32')('returns null for a filesystem-ROOT os.homedir() ("/") — never resolves the cache to /.codegraph/models (iter-42 P2)', () => {
    // A root home passes the isAbsolute guard but would produce `/.codegraph/models`, which the
    // exact-match-only sensitive-root guard doesn't catch. Refuse it, mirroring userHomeForms().
    vi.mocked(os.homedir).mockReturnValue('/');
    try {
      expect(resolveModelCacheDir(baseEnv({ XDG_CACHE_HOME: undefined }))).toBeNull();
    } finally {
      vi.mocked(os.homedir).mockReset();
    }
  });

  it.runIf(process.platform === 'win32')('Windows, %LOCALAPPDATA% set -> %LOCALAPPDATA%\\codegraph\\models', () => {
    const dir = resolveModelCacheDir(baseEnv({ LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }));
    expect(dir).toBe(path.join('C:\\Users\\x\\AppData\\Local', 'codegraph', 'models'));
  });

  it.runIf(process.platform === 'win32')('Windows, %LOCALAPPDATA% unset -> <home>/AppData/Local/codegraph/models', () => {
    const dir = resolveModelCacheDir(baseEnv({ LOCALAPPDATA: undefined }));
    expect(dir).toBe(path.join(os.homedir(), 'AppData', 'Local', 'codegraph', 'models'));
  });

  // Regression (adversarial review iter-34 P2): a blank/non-absolute os.homedir() (HOME="")
  // must NOT silently produce a CWD-relative default cache. resolveModelCacheDir returns null so
  // acquisition/status degrade as `cache` (set CODEGRAPH_MODEL_CACHE_DIR) instead of dumping the
  // ~22MB cache under whatever directory launched CodeGraph.
  it.runIf(process.platform !== 'win32')('returns null when the homedir fallback is needed but os.homedir() is blank (HOME="")', () => {
    vi.mocked(os.homedir).mockReturnValue('');
    try {
      expect(resolveModelCacheDir(baseEnv({ XDG_CACHE_HOME: undefined }))).toBeNull();
    } finally {
      vi.mocked(os.homedir).mockReset();
    }
  });

  it('an explicit CODEGRAPH_MODEL_CACHE_DIR still wins even when os.homedir() is blank (null-guard is scoped to the fallback)', () => {
    vi.mocked(os.homedir).mockReturnValue('');
    try {
      expect(resolveModelCacheDir(baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: '/custom/cache' }))).toBe('/custom/cache');
    } finally {
      vi.mocked(os.homedir).mockReset();
    }
  });

  it.runIf(process.platform !== 'win32')('probeLocalModelCache degrades to invalid-cache (not a CWD read) when os.homedir() is blank', () => {
    vi.mocked(os.homedir).mockReturnValue('');
    try {
      expect(probeLocalModelCache(baseEnv({ XDG_CACHE_HOME: undefined }))).toBe('invalid-cache');
    } finally {
      vi.mocked(os.homedir).mockReset();
    }
  });
});

describe('validateModelCacheDir — the running user\'s OWN home is exempt from the sensitive-path guard (root/devcontainer + ostree zero-setup)', () => {
  const sensitiveHomes: string[] = [];
  afterEach(() => {
    vi.mocked(os.homedir).mockReset();
    for (const d of sensitiveHomes.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  // Grounded (nodejs.org/api/os.html): os.homedir() returns the effective user's home, which
  // is `/root` for root on Linux (Docker/CI/devcontainers) and realpaths under `/var/home/...`
  // on ostree/Silverblue — both are SENSITIVE_PATHS roots, so the DEFAULT cache under home used
  // to be refused, breaking zero-setup local embeddings. We stand in a real, existing home dir
  // under `/tmp` (also a SENSITIVE_PATHS root) since `/root` does not exist on the dev box.
  it.runIf(process.platform !== 'win32')(
    'accepts the default cache under a home that itself sits under a SENSITIVE_PATHS root',
    () => {
      const fakeHome = fs.mkdtempSync(path.join('/tmp', 'cg-fake-sensitive-home-'));
      sensitiveHomes.push(fakeHome);
      vi.mocked(os.homedir).mockReturnValue(fakeHome);

      // The user's OWN home subtree is not a sensitive write-sink to itself.
      expect(validateModelCacheDir(path.join(fakeHome, '.codegraph', 'models'))).toBeNull();
    },
  );

  it.runIf(process.platform !== 'win32')(
    'still REFUSES a sensitive path OUTSIDE the running user\'s home (an /etc-style override)',
    () => {
      const fakeHome = fs.mkdtempSync(path.join('/tmp', 'cg-fake-sensitive-home-'));
      sensitiveHomes.push(fakeHome);
      vi.mocked(os.homedir).mockReturnValue(fakeHome);

      // A DIFFERENT sensitive location, not under this home → the guard still bites.
      expect(validateModelCacheDir('/etc/codegraph-models')).not.toBeNull();
    },
  );

  // Regression (adversarial review iter-33 P1): with HOME="" — reachable in some
  // CI/container/systemd/cron shells — os.homedir() returns '' (verified on Node v24), and
  // path.resolve('') SILENTLY becomes process.cwd(). A blank home must NOT be promoted into a
  // home exemption equal to the cwd: a cache under a sensitive/shared cwd (here /usr, a
  // SENSITIVE_SYSTEM_PATHS root that is NOT firmlinked on macOS) would otherwise bypass the
  // guard. userHomeForms() now refuses a blank/relative home ("no home to exempt").
  it.runIf(process.platform !== 'win32')(
    'does NOT exempt a sensitive CWD when os.homedir() is blank (HOME="")',
    () => {
      vi.mocked(os.homedir).mockReturnValue('');
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/usr');
      try {
        expect(validateModelCacheDir('/usr/.codegraph/models')).toMatch(/sensitive/i);
      } finally {
        cwdSpy.mockRestore();
      }
    },
  );
});

describe('SENSITIVE_SYSTEM_PATHS — exported denylist is immutable (review iter-33 P2)', () => {
  it('is a frozen array: an importer cannot weaken the shared security denylist', () => {
    expect(Object.isFrozen(SENSITIVE_SYSTEM_PATHS)).toBe(true);
    // A push on a frozen array throws under ES-module strict mode — the guard cannot be
    // widened/narrowed process-wide via a deep import (the mutable Set stays module-private).
    expect(() => (SENSITIVE_SYSTEM_PATHS as string[]).push('/should-not-be-added')).toThrow();
    expect(SENSITIVE_SYSTEM_PATHS).not.toContain('/should-not-be-added');
  });

  it('still covers the roots the cache guard enforces (/etc, /usr, /tmp, /root)', () => {
    expect(SENSITIVE_SYSTEM_PATHS).toEqual(expect.arrayContaining(['/etc', '/usr', '/tmp', '/root']));
  });
});

describe('validateModelCacheDir — FR-017a purpose-built cache validator', () => {
  it('accepts a normal, existing temp directory', () => {
    const dir = createTempDir();
    expect(validateModelCacheDir(dir)).toBeNull();
  });

  it('accepts a legitimate ~/.config-style XDG cache path (does NOT reuse validateProjectPath verbatim)', () => {
    const dir = createTempDir();
    const xdgLike = path.join(dir, '.config', 'codegraph', 'models');
    expect(validateModelCacheDir(xdgLike)).toBeNull();
  });

  it.runIf(process.platform !== 'win32')('rejects a PREFIX (not just exact) match under a sensitive root', () => {
    // /opt itself is sensitive; a subdirectory that never even exists on disk
    // must also be rejected by the lexical resolve+prefix check alone.
    const result = validateModelCacheDir('/opt/codegraph-models-test-should-not-exist');
    expect(result).toMatch(/sensitive/i);
  });

  it.runIf(process.platform !== 'win32')('rejects a symlinked cache dir whose REAL target is a sensitive root', () => {
    const dir = createTempDir();
    const linkPath = path.join(dir, 'cache-link');
    fs.symlinkSync('/opt', linkPath); // /opt is a real (non-symlinked) dir on macOS/Linux
    const result = validateModelCacheDir(linkPath);
    expect(result).toMatch(/sensitive/i);
  });

  it.runIf(process.platform !== 'win32')('rejects a DANGLING-symlink cache leaf (realpath ENOENT but the entry exists) rather than treating it as not-yet-created', () => {
    // A dangling symlink makes realpathSync throw ENOENT like an absent path, but it EXISTS
    // (lstat OK) and mkdirSync(recursive) fails on it — acquisition degrades as `cache`, so
    // the validator/probe must reject it too instead of walking past the leaf.
    const dir = createTempDir();
    const cacheDir = path.join(dir, 'models');
    fs.symlinkSync(path.join(dir, 'no-such-target'), cacheDir); // dangling
    expect(validateModelCacheDir(cacheDir)).not.toBeNull();
  });

  it.runIf(process.platform !== 'win32')('rejects a cache dir whose INTERMEDIATE ancestor is a dangling symlink (Site B)', () => {
    const dir = createTempDir();
    fs.symlinkSync(path.join(dir, 'no-such'), path.join(dir, 'broken')); // dangling ancestor
    const cacheDir = path.join(dir, 'broken', 'models'); // leaf under the dangling ancestor
    expect(validateModelCacheDir(cacheDir)).not.toBeNull();
  });

  it.runIf(process.platform !== 'win32')('still ACCEPTS a legitimately not-yet-created cache dir + a non-dangling symlink to a real dir (no over-rejection)', () => {
    const dir = createTempDir();
    expect(validateModelCacheDir(path.join(dir, 'fresh-models'))).toBeNull(); // absent leaf
    expect(validateModelCacheDir(path.join(dir, 'a', 'b', 'models'))).toBeNull(); // absent parents
    const realTarget = createTempDir();
    const link = path.join(dir, 'good-link');
    fs.symlinkSync(realTarget, link); // symlink to a REAL dir → not dangling
    expect(validateModelCacheDir(path.join(link, 'models'))).toBeNull();
  });

  it.runIf(process.platform !== 'win32')('rejects a cache dir whose PARENT is a symlink into a sensitive dir, even though the leaf does not exist yet (P1-3)', () => {
    // A later mkdirSync(recursive) creates the missing leaf UNDER the real
    // (symlink-resolved) parent. path.resolve never follows the symlink, so the
    // lexical check misses it; realpathSync(leaf) throws ENOENT (the leaf is absent).
    // The validator must walk UP to the nearest existing ancestor, realpath THAT,
    // and re-check — otherwise the not-yet-existing leaf slips into the sensitive dir.
    // Uses /opt (not /etc): /etc is itself a symlink to /private/etc on macOS, so
    // realpath would resolve it OUT of SENSITIVE_PATHS — /opt is a real, sensitive dir
    // on macOS/Linux, matching the sibling symlink test above.
    const dir = createTempDir();
    const link = path.join(dir, 'sensitive-parent-link');
    fs.symlinkSync('/opt', link); // an EXISTING parent that resolves into a sensitive root
    const cacheDir = path.join(link, 'cg-models-not-created-yet'); // leaf does NOT exist on disk
    const result = validateModelCacheDir(cacheDir);
    expect(result).toMatch(/sensitive/i);
  });

  it.runIf(process.platform === 'win32')('rejects Windows system directories regardless of case', () => {
    expect(validateModelCacheDir('C:\\Windows\\System32\\codegraph')).toMatch(/sensitive/i);
  });

  it('rejects a `../`-traversal path that resolves under a sensitive root', () => {
    const traversal =
      process.platform === 'win32' ? 'C:\\Windows\\System32\\..\\..\\Windows\\System32' : '/home/x/../../etc/codegraph';
    const result = validateModelCacheDir(traversal);
    expect(result).toMatch(/sensitive/i);
  });

  it.runIf(process.platform === 'darwin')('treats a macOS /private firmlink alias of a sensitive dir as sensitive (/private/etc, /private/var) (P1-b)', () => {
    // On macOS /etc, /var, /tmp realpath to /private/etc etc. (firmlinks), which are
    // NOT literally in SENSITIVE_PATHS — so a symlinked cache ancestor whose real
    // target is /etc would resolve to /private/etc and otherwise evade the check. The
    // validator must also test the path with a leading /private stripped on darwin.
    expect(validateModelCacheDir('/private/etc/cg-models-firmlink-test')).toMatch(/sensitive/i);
    expect(validateModelCacheDir('/private/var/cg-models-firmlink-test')).toMatch(/sensitive/i);
    // Regression anchor: the non-/private forms were already caught.
    expect(validateModelCacheDir('/etc/cg-models-firmlink-test')).toMatch(/sensitive/i);
  });
});

describe('isWithinDir + sensitive-root handling (PR #22 review: trailing-sep + root exact-match)', () => {
  it('isWithinDir treats a trailing-separator parent (a filesystem root) as a parent of everything — no double-separator false negative', () => {
    expect(isWithinDir('/etc/foo', '/')).toBe(true);   // was false (startsWith("//")) before the fix
    expect(isWithinDir('/etc/foo', '/etc/')).toBe(true); // trailing sep on a non-root parent
    expect(isWithinDir('/etc/foo', '/etc')).toBe(true);
    expect(isWithinDir('/etcfoo', '/etc')).toBe(false);  // sibling, not a child
    expect(isWithinDir('/etc', '/etc')).toBe(true);      // self
  });

  it.runIf(process.platform !== 'win32')('validateModelCacheDir accepts a normal absolute dir even though "/" is in SENSITIVE_PATHS (roots are exact-match-only, not prefix)', () => {
    // A normal (non-sensitive) absolute cache dir must be accepted — the "/" root entry
    // must NOT prefix-reject every absolute path now that isWithinDir correctly treats "/"
    // as a parent of all. Derive from the validated temp parent (root-safe) rather than
    // os.homedir(), which is the sensitive /root under a root/Docker run.
    const cacheDir = createTempDir();
    expect(validateModelCacheDir(path.join(cacheDir, '.codegraph', 'models'))).toBeNull();
    // The root itself is still rejected (exact match), and a real sensitive prefix too.
    expect(validateModelCacheDir('/')).toMatch(/sensitive/i);
    expect(validateModelCacheDir('/etc/codegraph')).toMatch(/sensitive/i);
  });
});

describe('acquireLocalModel — download then verify success', () => {
  it('downloads both artifacts, verifies each against its pin, and returns their cached paths', async () => {
    const cacheDir = createTempDir();
    const content = Buffer.from('freshly-downloaded-bytes');
    const artifacts = fakeArtifacts(content);
    const calls: FetchCall[] = [];

    const result = expectSuccess(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchServing(content, calls), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );

    expect(fs.readFileSync(result.modelPath)).toEqual(content);
    expect(fs.readFileSync(result.tokenizerPath)).toEqual(content);
    expect(calls.map((c) => c.url)).toEqual([
      'http://127.0.0.1:1/base/fake-model.bin',
      'http://127.0.0.1:1/base/fake-tokenizer.bin',
    ]);
  });
});

describe('model cache cross-user hardening — reject group/other-writable + create 0o700 (review iter-35 P1)', () => {
  it.runIf(process.platform !== 'win32')('validateModelCacheDir refuses an EXISTING group/other-writable cache dir (another user could swap the verified model)', () => {
    const dir = createTempDir(); // mkdtempSync creates it 0o700
    fs.chmodSync(dir, 0o775); // group-writable — the cross-user swap condition
    expect(validateModelCacheDir(dir)).toMatch(/group\/other-writable/i);
  });

  // Non-root only: the test makes a self-owned dir LOOK foreign by moving getuid away from it
  // (mode stays a safe 0o700). Under root (uid 0) the dir is root-owned = trusted, nothing to reject.
  it.runIf(process.platform !== 'win32' && (process.getuid?.() ?? 0) !== 0)(
    'validateModelCacheDir refuses a FOREIGN-OWNED cache dir (owned by neither the current user nor root) even at a safe mode (iter-39 P1)',
    () => {
      const dir = createTempDir(); // 0o700, owned by the current uid
      const realUid = process.getuid!();
      expect(validateModelCacheDir(dir)).toBeNull(); // self-owned + private → trusted (control)
      const uidSpy = vi.spyOn(process as { getuid: () => number }, 'getuid').mockReturnValue(realUid + 4242);
      try {
        // The dir now reads as owned by someone who is neither us nor root → untrusted.
        expect(validateModelCacheDir(dir)).toMatch(/owned by a different user/i);
      } finally {
        uidSpy.mockRestore();
      }
    },
  );

  it.runIf(process.platform !== 'win32')('probeLocalModelCache degrades to invalid-cache for a group/other-writable cache dir', () => {
    const dir = createTempDir();
    fs.chmodSync(dir, 0o777);
    expect(probeLocalModelCache(baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: dir }))).toBe('invalid-cache');
  });

  it.runIf(process.platform !== 'win32')('acquireLocalModel creates the cache root + checkpoint dir 0o700 (private by default, umask-independent)', async () => {
    const parent = createTempDir(); // 0o700; the cache root below is created by acquisition
    const cacheDir = path.join(parent, 'fresh-cache');
    const content = Buffer.from('private-cache-bytes');
    const artifacts = fakeArtifacts(content);
    expectSuccess(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchServing(content), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );
    expect(fs.statSync(cacheDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(cacheDir, 'all-MiniLM-L6-v2')).mode & 0o777).toBe(0o700);
  });

  it.runIf(process.platform !== 'win32')('probeLocalModelCache degrades to invalid-cache when the checkpoint dir is group/other-writable (even under a private root)', () => {
    const dir = createTempDir(); // 0o700 root
    const checkpoint = path.join(dir, 'all-MiniLM-L6-v2');
    fs.mkdirSync(checkpoint, { mode: 0o700 });
    fs.chmodSync(checkpoint, 0o777); // another local user could plant/swap an artifact here
    expect(probeLocalModelCache(baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: dir }))).toBe('invalid-cache');
  });

  it.runIf(process.platform !== 'win32')('acquireLocalModel writes the cached artifact FILES 0o600 (private, umask-independent)', async () => {
    const cacheDir = createTempDir();
    const content = Buffer.from('private-artifact-file-bytes');
    const artifacts = fakeArtifacts(content);
    const result = expectSuccess(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchServing(content), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );
    expect(fs.statSync(result.modelPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(result.tokenizerPath).mode & 0o777).toBe(0o600);
  });

  it.runIf(process.platform !== 'win32')('does NOT reuse a cached artifact file that is group/other-writable — refuses as `cache` with chmod guidance, never a silent re-download (iter-38 P2)', async () => {
    const cacheDir = createTempDir();
    const content = Buffer.from('reuse-me-only-when-private');
    const artifacts = fakeArtifacts(content);
    // First acquire seeds verified 0o600 files.
    const first = expectSuccess(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchServing(content), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );
    // Make the cached MODEL file group/other-writable (bytes unchanged) — a swap-enabling mode.
    fs.chmodSync(first.modelPath, 0o666);
    // Second acquire must NOT trust it AND must surface the PERMISSION fix (chmod / private cache)
    // as a `cache` degradation — not silently re-download (which offline would misreport as retry).
    const calls: FetchCall[] = [];
    const result = await acquireLocalModel(
      { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
      { fetchImpl: fetchServing(content, calls), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
    );
    const un = result as LocalModelUnavailable;
    expect(un.unavailable).toBe('cache');
    expect(un.message).toMatch(/group\/other-writable|chmod/i);
    expect(calls).toHaveLength(0); // surfaced the permission problem instead of re-downloading
  });

  it.runIf(process.platform !== 'win32')('probeLocalModelCache reports insecure-permissions (not missing/offline) for a group/other-writable cached artifact (iter-38 P2)', async () => {
    const cacheDir = createTempDir();
    const content = Buffer.from('probe-perm-bytes');
    const artifacts = fakeArtifacts(content);
    const first = expectSuccess(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchServing(content), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );
    fs.chmodSync(first.modelPath, 0o666); // model present + correct bytes, but group/other-writable
    // Status must say "fix permissions", NOT the misleading 'missing'→'offline' "retry download".
    expect(probeLocalModelCache(baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }), { artifacts })).toBe('insecure-permissions');
  });
});

describe('acquireLocalModel — prunes stale .tmp-* leaks (review iter-37 P2)', () => {
  it.runIf(process.platform !== 'win32')('removes only STALE temp leaks, sparing fresh (concurrent) temps, symlinks, and non-temp files', async () => {
    const cacheDir = createTempDir();
    const checkpoint = path.join(cacheDir, 'all-MiniLM-L6-v2');
    fs.mkdirSync(checkpoint, { recursive: true, mode: 0o700 });
    const stale = path.join(checkpoint, '.tmp-staleaaaaaaaaaaaaaaaa');
    const fresh = path.join(checkpoint, '.tmp-freshbbbbbbbbbbbbbbbb');
    const link = path.join(checkpoint, '.tmp-linkcccccccccccccccc');
    const keep = path.join(checkpoint, 'unrelated-file');
    fs.writeFileSync(stale, 'stale-leak');
    fs.writeFileSync(fresh, 'fresh-inflight');
    fs.writeFileSync(keep, 'not-a-temp');
    fs.symlinkSync(keep, link); // a symlink at a .tmp-* name is not our temp
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago → stale
    fs.utimesSync(stale, old, old);

    const content = Buffer.from('acq-bytes');
    const artifacts = fakeArtifacts(content);
    expectSuccess(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchServing(content), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );

    expect(fs.existsSync(stale)).toBe(false);               // stale leak pruned
    expect(fs.existsSync(fresh)).toBe(true);                // fresh concurrent temp spared
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true); // symlink at .tmp-* left alone
    expect(fs.existsSync(keep)).toBe(true);                 // non-temp untouched
  });
});

describe('acquireLocalModel — concurrent promotion race (rename loser re-checks the winner, FR-018)', () => {
  it('a renameSync failure onto an already-promoted verified artifact succeeds, not a cache error', async () => {
    const cacheDir = createTempDir();
    const content = Buffer.from('a-concurrent-winner-promoted-these-verified-bytes');
    const artifacts = fakeArtifacts(content);
    const modelFinal = expectedArtifactPath(cacheDir, artifacts.model.relPath);

    // Simulate the Windows concurrent race: a peer process promoted the verified model to
    // finalPath first, so OUR renameSync onto the existing/open destination fails (EPERM).
    // The model rename is the FIRST rename acquireLocalModel performs (model before
    // tokenizer), so mockImplementationOnce targets it and self-consumes; the tokenizer's
    // rename then uses the untouched real implementation.
    vi.mocked(fs.renameSync).mockImplementationOnce(((_from: fs.PathLike, to: fs.PathLike) => {
      fs.writeFileSync(to, content); // the concurrent winner's verified promotion
      throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
    }) as typeof fs.renameSync);

    // Without the re-check the rename failure would degrade to `unavailable: 'cache'`; the
    // fix recognizes the winner's verified artifact and returns success.
    const result = expectSuccess(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchServing(content), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );
    expect(result.modelPath).toBe(modelFinal);
    expect(fs.readFileSync(modelFinal)).toEqual(content);
  });

  it('a rename-over-existing failure with a CORRUPT cached file removes it and retries the promote (Windows self-heal)', async () => {
    const cacheDir = createTempDir();
    const content = Buffer.from('the-correct-verified-bytes-for-this-artifact');
    const artifacts = fakeArtifacts(content);
    const modelFinal = expectedArtifactPath(cacheDir, artifacts.model.relPath);

    // Pre-seed the model path with a CORRUPT (wrong-size) file — not verified, a stale leftover.
    fs.mkdirSync(path.dirname(modelFinal), { recursive: true });
    fs.writeFileSync(modelFinal, Buffer.concat([content, Buffer.from('STALE-EXTRA-BYTES')]));

    // Simulate Windows rename-over-existing: the FIRST rename (the model, onto the corrupt file)
    // fails; the retry after unlinking the corrupt file uses the real rename.
    vi.mocked(fs.renameSync).mockImplementationOnce((() => {
      throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
    }) as never);

    // Without the unlink-and-retry recovery this returns unavailable:'cache' (the verified download
    // is discarded and the corrupt file lingers, blocking local embeddings forever on Windows).
    const result = expectSuccess(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchServing(content), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );
    expect(result.modelPath).toBe(modelFinal);
    expect(fs.readFileSync(modelFinal)).toEqual(content); // the corrupt file was replaced, cache self-healed
  });

  it('fails fast as `cache` WITHOUT downloading when a DIRECTORY occupies the model artifact path (iter-41 P1)', async () => {
    const cacheDir = createTempDir();
    const content = Buffer.from('the-correct-verified-bytes-for-this-artifact');
    const artifacts = fakeArtifacts(content);
    const modelFinal = expectedArtifactPath(cacheDir, artifacts.model.relPath);

    // A DIRECTORY sits where the model FILE should be (a botched extraction, or a stray user mkdir).
    // renameSync can't atomically replace it and safeUnlink can't remove it, so a download would be
    // wasted and every retry re-downloads. Acquisition must reject it BEFORE fetching.
    fs.mkdirSync(modelFinal, { recursive: true });

    const calls: FetchCall[] = [];
    const bad = expectUnavailable(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchServing(content, calls), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );
    expect(bad.unavailable).toBe('cache');
    // The distinguishing assertion: pre-fix acquisition DOWNLOADED the full artifact and only then
    // failed at renameSync (calls.length === 1); the fix rejects the unpromotable path before any fetch.
    expect(calls).toHaveLength(0);
  });

  it('does NOT download the tokenizer when cancellation lands after the model is acquired (iter-42 P2b)', async () => {
    const cacheDir = createTempDir();
    const content = Buffer.from('the-correct-verified-bytes-for-this-artifact');
    const artifacts = fakeArtifacts(content);
    // Pre-seed a VERIFIED model file → the model is a CACHE HIT (no download); only the tokenizer
    // (a separate artifact) would need a download. With the signal already aborted, the between-
    // artifacts abort check must skip that second download entirely.
    const modelFinal = expectedArtifactPath(cacheDir, artifacts.model.relPath);
    fs.mkdirSync(path.dirname(modelFinal), { recursive: true });
    fs.writeFileSync(modelFinal, content);

    const ctrl = new AbortController();
    ctrl.abort(); // cancellation already requested before acquisition begins
    const calls: FetchCall[] = [];
    const bad = expectUnavailable(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }), signal: ctrl.signal },
        { fetchImpl: fetchServing(content, calls), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );
    expect(bad.unavailable).toBe('cache');
    // Pre-fix: no between-artifacts abort check → the tokenizer download is attempted (calls.length===1).
    // Post-fix: cancellation is honored after the model cache-hit → the tokenizer is never fetched.
    expect(calls).toHaveLength(0);
  });

  it('does NOT promote a cache file when cancellation lands during the download (iter-42 P2b)', async () => {
    const cacheDir = createTempDir();
    const content = Buffer.from('the-correct-verified-bytes-for-this-artifact');
    const artifacts = fakeArtifacts(content);
    const modelFinal = expectedArtifactPath(cacheDir, artifacts.model.relPath);

    const ctrl = new AbortController();
    const calls: FetchCall[] = [];
    // Cancellation lands AS the model's bytes resolve (the fetch itself completes, but the caller
    // requested shutdown). The post-download abort check must bail before writing/promoting.
    const abortingFetch = (async (input: unknown) => {
      calls.push({ url: String(input) });
      ctrl.abort();
      return new Response(content, { status: 200 });
    }) as unknown as typeof fetch;

    const bad = expectUnavailable(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }), signal: ctrl.signal },
        { fetchImpl: abortingFetch, artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );
    expect(bad.unavailable).toBe('cache');
    // The download happened (calls.length===1) but the post-download abort check bailed BEFORE
    // promotion — pre-fix this renamed a verified file into place, so modelFinal would exist.
    expect(calls).toHaveLength(1);
    expect(fs.existsSync(modelFinal)).toBe(false);
  });
});

describe('acquireLocalModel — on-disk temp is re-verified before promotion (FR-014 / SC-003)', () => {
  it('rejects a corrupted temp WRITE (in-memory bytes still valid) as checksum — the promoted file is never unverified', async () => {
    const cacheDir = createTempDir();
    const content = Buffer.from('the-correct-verified-bytes-for-this-artifact');
    const artifacts = fakeArtifacts(content);
    const modelFinal = expectedArtifactPath(cacheDir, artifacts.model.relPath);

    // Corrupt ONLY the first temp write (the model's) ON DISK — flip a byte — while the in-memory
    // download buffer stays valid. The in-memory sha256 check passes; only an on-disk re-verify
    // catches the divergence between the verified buffer and the file that gets promoted.
    const realWriteSync = (await vi.importActual<typeof import('fs')>('fs')).writeSync;
    vi.mocked(fs.writeSync).mockImplementationOnce(((fd: number, buf: Buffer, offset?: number, length?: number, position?: number) => {
      const corrupted = Buffer.from(buf);
      const at = typeof offset === 'number' ? offset : 0;
      if (corrupted.length > at) corrupted[at] = corrupted[at]! ^ 0xff;
      return (realWriteSync as unknown as (...a: unknown[]) => number)(fd, corrupted, offset, length, position);
    }) as never);

    const bad = expectUnavailable(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchServing(content), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );
    expect(bad.unavailable).toBe('checksum');       // the on-disk re-verify caught it
    expect(fs.existsSync(modelFinal)).toBe(false);  // nothing was promoted into the cache
  });
});

describe('acquireLocalModel — reuse if present + verified, no re-download (FR-018 / SC-002)', () => {
  it('makes zero fetch calls on a second acquisition once the artifact is cached and verified', async () => {
    const cacheDir = createTempDir();
    const content = Buffer.from('already-cached-and-verified');
    const artifacts = fakeArtifacts(content);
    const env = baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir });

    const firstCalls: FetchCall[] = [];
    const first = expectSuccess(
      await acquireLocalModel({ env }, { fetchImpl: fetchServing(content, firstCalls), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' }),
    );
    expect(firstCalls.length).toBeGreaterThan(0); // the FIRST call really did download

    const secondCalls: FetchCall[] = [];
    const second = expectSuccess(
      await acquireLocalModel({ env }, { fetchImpl: fetchServing(content, secondCalls), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' }),
    );

    expect(secondCalls).toHaveLength(0); // reused — no re-download
    expect(second.modelPath).toBe(first.modelPath);
    expect(second.tokenizerPath).toBe(first.tokenizerPath);
    expect(fs.readFileSync(second.modelPath)).toEqual(content);
  });
});

describe('acquireLocalModel — verified-artifact cache avoids re-hashing on every pass', () => {
  it('does not re-read/re-hash a file already verified in this process when size+mtime are unchanged', async () => {
    const cacheDir = createTempDir();
    const content = Buffer.from('a-verified-artifact-that-should-not-be-rehashed');
    const artifacts = fakeArtifacts(content);
    const env = baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir });

    // First acquisition: downloads + verifies — the FIRST-use full hash is expected here.
    await acquireLocalModel(
      { env },
      { fetchImpl: fetchServing(content), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
    );

    // Second acquisition of the SAME (unchanged) cached file: the cheap size+mtime
    // pre-check should short-circuit before any full re-read/re-hash of the bytes.
    // Cleared first — earlier tests/calls in this file share the one mocked fn.
    const readFileSyncMock = vi.mocked(fs.readFileSync);
    readFileSyncMock.mockClear();
    const secondCalls: FetchCall[] = [];
    const second = expectSuccess(
      await acquireLocalModel(
        { env },
        { fetchImpl: fetchServing(content, secondCalls), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );

    expect(secondCalls).toHaveLength(0); // still reused — no re-download
    expect(readFileSyncMock).not.toHaveBeenCalled(); // and no full re-hash of the cached bytes

    expect(fs.readFileSync(second.modelPath)).toEqual(content); // sanity: bytes unchanged
  });

  it.runIf(process.platform !== 'win32')('busts the verified memo on a metadata change that preserves size+mtime (chmod) — re-hashes rather than trusting stale size+mtime', async () => {
    // size+mtime alone is spoofable (`touch -r` clones mtime; a swap-in preserves size), so
    // the memo also pins ctime/ino/dev/mode. chmod bumps ctime + mode but NOT size or mtime —
    // a size+mtime-only memo would (wrongly) keep trusting the file. Assert the next
    // verification RE-READS (re-hashes) it instead of short-circuiting on stale metadata.
    const cacheDir = createTempDir();
    const content = Buffer.from('a-verified-artifact-metadata-sensitive');
    const artifacts = fakeArtifacts(content);
    const env = baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir });

    const first = expectSuccess(
      await acquireLocalModel({ env }, { fetchImpl: fetchServing(content), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' }),
    );

    fs.chmodSync(first.modelPath, 0o600); // ctime + mode change; size + mtime unchanged

    const readFileSyncMock = vi.mocked(fs.readFileSync);
    readFileSyncMock.mockClear();
    await acquireLocalModel({ env }, { fetchImpl: fetchServing(content), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' });

    // The model file was re-hashed (memo busted by the ctime/mode change) — a size+mtime-only
    // memo would have skipped this read and blindly trusted the file.
    expect(readFileSyncMock.mock.calls.some((c) => c[0] === first.modelPath)).toBe(true);
  });

  it('rejects a wrong-size cached file WITHOUT a full read — the cheap stat size pre-check fires (P1-2)', async () => {
    const cacheDir = createTempDir();
    const content = Buffer.from('the-correct-verified-bytes-for-this-artifact');
    const artifacts = fakeArtifacts(content); // pinned size === content.length
    const env = baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir });

    // Pre-seed BOTH artifact paths with a file of a DIFFERENT size than the pin — a
    // truncated/corrupt/huge cache file. It can never hash to the pinned digest, so it
    // must be rejected on the cheap statSync size check alone, never read into memory
    // (an enormous cache file would otherwise stall/OOM before the hash even runs).
    const modelPath = expectedArtifactPath(cacheDir, 'fake-model.bin');
    const tokenizerPath = expectedArtifactPath(cacheDir, 'fake-tokenizer.bin');
    fs.mkdirSync(path.dirname(modelPath), { recursive: true });
    const wrongSize = Buffer.concat([content, Buffer.from('EXTRA-BYTES-CHANGING-THE-SIZE')]);
    fs.writeFileSync(modelPath, wrongSize);
    fs.writeFileSync(tokenizerPath, wrongSize);

    const readFileSyncMock = vi.mocked(fs.readFileSync);
    readFileSyncMock.mockClear();

    const calls: FetchCall[] = [];
    const result = expectSuccess(
      await acquireLocalModel(
        { env },
        { fetchImpl: fetchServing(content, calls), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );

    // The wrong-size CACHED files are rejected on the cheap statSync size check alone, never read
    // into memory (a huge/corrupt cache file would otherwise stall/OOM). The download path DOES
    // read back each size-bounded temp for the on-disk re-verify before promotion, but the
    // pre-seeded cache files are never among the paths read.
    const readPaths = readFileSyncMock.mock.calls.map((c) => c[0]);
    expect(readPaths).not.toContain(modelPath);
    expect(readPaths).not.toContain(tokenizerPath);
    // And acquisition recovered by re-downloading the correct bytes.
    expect(calls.length).toBeGreaterThan(0);
    expect(fs.readFileSync(result.modelPath)).toEqual(content);
  });

  it('re-verifies (and recovers via re-download) when the cached file changes on disk after a prior verification', async () => {
    const cacheDir = createTempDir();
    const originalContent = Buffer.from('the-original-verified-bytes-000');
    const artifacts = fakeArtifacts(originalContent);
    const env = baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir });

    await acquireLocalModel(
      { env },
      { fetchImpl: fetchServing(originalContent), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
    );

    // Tamper the cached files directly on disk (different SIZE, so this is
    // unaffected by any filesystem's mtime resolution) — a stale, path-keyed
    // cache entry from the prior verification must NOT be trusted for a file
    // that has genuinely changed since.
    const modelPath = expectedArtifactPath(cacheDir, 'fake-model.bin');
    const tokenizerPath = expectedArtifactPath(cacheDir, 'fake-tokenizer.bin');
    const tampered = Buffer.concat([tamperedCopy(originalContent), Buffer.from('X')]);
    fs.writeFileSync(modelPath, tampered);
    fs.writeFileSync(tokenizerPath, tampered);

    const calls: FetchCall[] = [];
    const result = expectSuccess(
      await acquireLocalModel(
        { env },
        { fetchImpl: fetchServing(originalContent, calls), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );

    expect(calls.length).toBeGreaterThan(0); // re-downloaded — the changed file was not blindly trusted
    expect(fs.readFileSync(result.modelPath)).toEqual(originalContent); // recovered the correct bytes
  });
});

describe('acquireLocalModel — checksum mismatch (FR-014 / FR-019a / SC-003)', () => {
  it('discards the temp file, never promotes it, and returns the checksum reason', async () => {
    const cacheDir = createTempDir();
    const pinnedContent = Buffer.from('the-real-expected-bytes');
    const wrongContent = tamperedCopy(pinnedContent); // same length (no size-budget trip), different hash
    const artifacts = fakeArtifacts(pinnedContent); // pin != served bytes

    const bad = expectUnavailable(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchServing(wrongContent), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );

    expect(bad.unavailable).toBe('checksum');
    expect(bad.message.toLowerCase()).toContain('sha-256');

    // Nothing was promoted: the final path must not exist, and no file left
    // behind in the cache carries the rejected (mismatched) bytes.
    const finalPath = expectedArtifactPath(cacheDir, 'fake-model.bin');
    expect(fs.existsSync(finalPath)).toBe(false);
    const modelDir = path.dirname(finalPath);
    const leftovers = fs.existsSync(modelDir) ? fs.readdirSync(modelDir) : [];
    for (const entry of leftovers) {
      const entryPath = path.join(modelDir, entry);
      if (fs.statSync(entryPath).isFile()) {
        expect(fs.readFileSync(entryPath)).not.toEqual(wrongContent);
      }
    }
  });

  it('re-attempts the download on the next call rather than trusting a discarded mismatch', async () => {
    const cacheDir = createTempDir();
    const pinnedContent = Buffer.from('the-pin-these-bytes-will-never-match');
    const wrongContent = tamperedCopy(pinnedContent); // same length (no size-budget trip), different hash
    const artifacts = fakeArtifacts(pinnedContent);
    const calls: FetchCall[] = [];
    const env = baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir });

    const first = expectUnavailable(
      await acquireLocalModel({ env }, { fetchImpl: fetchServing(wrongContent, calls), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' }),
    );
    expect(first.unavailable).toBe('checksum'); // confirms this genuinely exercises the checksum path
    const firstCallCount = calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    await acquireLocalModel({ env }, { fetchImpl: fetchServing(wrongContent, calls), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' });
    expect(calls.length).toBeGreaterThan(firstCallCount); // downloaded again — nothing was cached
  });
});

describe('acquireLocalModel — atomic verify-before-rename (partial/interrupted treated as absent)', () => {
  it('never trusts a corrupt/partial file already at the final path — redownloads and overwrites correctly', async () => {
    const cacheDir = createTempDir();
    const goodContent = Buffer.from('the-correct-verified-bytes');
    const artifacts = fakeArtifacts(goodContent);

    // Simulate a leftover partial/corrupt file at the EXACT final path (as if
    // some earlier, non-atomic write had landed there directly), plus a
    // stray temp-looking leftover that must also never be mistaken for it.
    const modelPath = expectedArtifactPath(cacheDir, 'fake-model.bin');
    const tokenizerPath = expectedArtifactPath(cacheDir, 'fake-tokenizer.bin');
    fs.mkdirSync(path.dirname(modelPath), { recursive: true });
    fs.writeFileSync(modelPath, Buffer.from('PARTIAL-GARBAGE'));
    fs.writeFileSync(tokenizerPath, Buffer.from('PARTIAL-GARBAGE'));
    fs.writeFileSync(path.join(path.dirname(modelPath), '.tmp-stale-leftover'), Buffer.from('stale'));

    const calls: FetchCall[] = [];
    const result = expectSuccess(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchServing(goodContent, calls), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );

    expect(calls.length).toBeGreaterThan(0); // it did NOT blindly trust the partial file
    expect(fs.readFileSync(result.modelPath)).toEqual(goodContent);
    expect(fs.readFileSync(result.tokenizerPath)).toEqual(goodContent);
  });
});

describe('acquireLocalModel — download size + wall-clock bounds (FR-013a)', () => {
  it('aborts as unavailable when downloaded bytes exceed the pinned artifact size', async () => {
    const cacheDir = createTempDir();
    const artifacts = {
      model: { relPath: 'oversized.bin', size: 8, sha256: 'irrelevant-never-reached' },
      tokenizer: { relPath: 'fake-tokenizer.bin', size: 8, sha256: 'irrelevant-never-reached' },
    };

    const bad = expectUnavailable(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchOversized(64), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );

    expect(bad.unavailable).toBe('offline');
  });

  it('cancels the response body on a non-OK HTTP status so the connection is not leaked', async () => {
    let bodyCancelled = false;
    // A non-2xx response can carry a long/streaming body we never read; the download must
    // cancel it (release the socket) instead of throwing and leaving it dangling.
    const body = new ReadableStream<Uint8Array>({ cancel() { bodyCancelled = true; } });
    const fetchNonOk = (async () => new Response(body, { status: 503 })) as unknown as typeof fetch;
    const cacheDir = createTempDir();

    const bad = expectUnavailable(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchNonOk, artifacts: fakeArtifacts(), defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );
    expect(bad.unavailable).toBe('offline'); // an HTTP error degrades as offline
    expect(bodyCancelled).toBe(true);        // the un-read body was released, not leaked
  });

  it('aborts as unavailable when the download exceeds the wall-clock timeout, bounded not hung', async () => {
    const cacheDir = createTempDir();
    const artifacts = fakeArtifacts();

    const start = Date.now();
    const bad = expectUnavailable(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchHanging(), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base', downloadTimeoutMs: 25 },
      ),
    );
    const elapsed = Date.now() - start;

    expect(bad.unavailable).toBe('offline');
    expect(elapsed).toBeLessThan(2000); // bounded, not an unbounded hang
  });
});

describe('acquireLocalModel — mid-download I/O failure resolves to cache, not offline (FR-017a)', () => {
  it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)(
    'an unwritable cache directory (permission denied) resolves to the cache reason',
    async () => {
      const parentDir = createTempDir();
      const readOnlyDir = path.join(parentDir, 'readonly-cache');
      fs.mkdirSync(readOnlyDir, { mode: 0o555 }); // read+execute only, no write
      const artifacts = fakeArtifacts();

      try {
        const bad = expectUnavailable(
          await acquireLocalModel(
            { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: readOnlyDir }) },
            { fetchImpl: fetchServing(Buffer.from('fake-model-bytes')), artifacts },
          ),
        );
        expect(bad.unavailable).toBe('cache');
      } finally {
        fs.chmodSync(readOnlyDir, 0o755); // restore so afterEach can remove it
      }
    },
  );

  it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)(
    'reports cache (never offline) and SKIPS the download when the checkpoint dir exists but is unwritable — even with the network down',
    async () => {
      // The cache ROOT is writable, but the real write sink <cacheDir>/all-MiniLM-L6-v2 is not.
      // Acquisition must detect this BEFORE fetching: a failed fetch would otherwise mask the
      // unwritable cache as `offline` (probeLocalModelCache already reports invalid-cache).
      const cacheDir = createTempDir();
      const artifactDir = path.join(cacheDir, 'all-MiniLM-L6-v2');
      fs.mkdirSync(artifactDir);
      fs.chmodSync(artifactDir, 0o555); // read+execute only, no write
      const artifacts = fakeArtifacts(Buffer.from('x'));
      try {
        const bad = expectUnavailable(
          await acquireLocalModel(
            { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
            { fetchImpl: fetchOffline(), artifacts }, // network down
          ),
        );
        expect(bad.unavailable).toBe('cache'); // the cache is the real problem, not the network
      } finally {
        fs.chmodSync(artifactDir, 0o755);
      }
    },
  );

  it('cleans up the exclusively-created temp file when the write itself fails mid-stream (no leaked .tmp-* blobs)', async () => {
    // The download succeeds, so writeExclusiveTemp opens a `.tmp-*` file and starts
    // writing. A disk-full / interrupted write (fs.writeSync throwing) must NOT leave
    // that partial blob behind — otherwise repeated retries accumulate leaked temp
    // files in the cache dir. Simulate the mid-write failure and assert the temp file
    // is discarded and the outcome is the `cache` reason (download succeeded).
    const cacheDir = createTempDir();
    const content = Buffer.from('fake-model-bytes');
    const artifacts = fakeArtifacts(content);

    const writeSyncMock = vi.mocked(fs.writeSync);
    // Fail the very first write (the model artifact's temp-file write). The single
    // 16-byte write means one throwing call fully exercises the failure path.
    writeSyncMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('simulated disk-full'), { code: 'ENOSPC' });
    });

    const bad = expectUnavailable(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchServing(content), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
      ),
    );

    expect(bad.unavailable).toBe('cache'); // download succeeded; the write failed
    expect(writeSyncMock).toHaveBeenCalled(); // the injected failure actually fired

    // No leaked temp file remains in the artifact write dir.
    const artifactDir = path.join(cacheDir, 'all-MiniLM-L6-v2');
    const leaked = fs.readdirSync(artifactDir).filter((f) => f.startsWith('.tmp-'));
    expect(leaked).toEqual([]);
  });
});

describe('acquireLocalModel — artifact-subdir symlink guard (P1-a / FR-017a)', () => {
  it.runIf(process.platform !== 'win32')(
    'refuses to write when <cacheDir>/all-MiniLM-L6-v2 is a symlink escaping the validated cache root — returns cache and writes nothing to the target',
    async () => {
      // validateModelCacheDir vets only the cache ROOT; the real write sink is the
      // per-checkpoint subdir <cacheDir>/all-MiniLM-L6-v2. Pre-plant THAT subdir as a
      // symlink pointing OUT of the validated root (a "sensitive stand-in" the root
      // check never saw). mkdirSync(recursive) is a silent no-op on the existing
      // symlink, so pre-fix the temp-write + atomic rename followed it out of the root.
      const cacheDir = createTempDir();
      const standIn = createTempDir(); // outside cacheDir — the escaped write target
      fs.symlinkSync(standIn, path.join(cacheDir, 'all-MiniLM-L6-v2'));

      const content = Buffer.from('bytes-that-must-never-be-written-through-the-symlink');
      const artifacts = fakeArtifacts(content);
      const calls: FetchCall[] = [];

      const bad = expectUnavailable(
        await acquireLocalModel(
          { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
          { fetchImpl: fetchServing(content, calls), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
        ),
      );

      expect(bad.unavailable).toBe('cache');
      // Nothing was written through the symlink to the escaped target, and the guard
      // fired before a download was even attempted.
      expect(fs.readdirSync(standIn)).toHaveLength(0);
      expect(calls).toHaveLength(0);
    },
  );

  it.runIf(process.platform !== 'win32')(
    'does NOT reuse a symlinked ARTIFACT FILE — re-downloads instead of reading through a link that could escape the cache root (even if its bytes match the pin)',
    async () => {
      // The artifact DIR guard is separate; here the individual model FILE is a symlink to a
      // pin-matching file OUTSIDE the checkpoint dir. fileExistsAndVerified must lstat + reject
      // it (never stat/read THROUGH the link), forcing a fresh download over the link.
      const cacheDir = createTempDir();
      const content = Buffer.from('correct-model-bytes-for-symlink-test');
      const artifacts = fakeArtifacts(content);
      const artifactDir = path.join(cacheDir, 'all-MiniLM-L6-v2');
      fs.mkdirSync(artifactDir, { recursive: true });
      const outside = path.join(createTempDir(), 'planted-model.bin');
      fs.writeFileSync(outside, content); // bytes match the pin
      fs.symlinkSync(outside, path.join(artifactDir, path.basename(artifacts.model.relPath)));
      // A normal (correct) tokenizer file so ONLY the symlinked model triggers a re-download.
      fs.writeFileSync(path.join(artifactDir, path.basename(artifacts.tokenizer.relPath)), content);

      const calls: FetchCall[] = [];
      const result = expectSuccess(
        await acquireLocalModel(
          { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
          { fetchImpl: fetchServing(content, calls), artifacts, defaultBaseUrl: 'http://127.0.0.1:1/base' },
        ),
      );

      // The symlinked model was NOT trusted: it was re-downloaded, and the final path is now a
      // regular file (the atomic rename replaced the link).
      expect(calls.some((c) => c.url.includes(path.basename(artifacts.model.relPath)))).toBe(true);
      expect(fs.lstatSync(result.modelPath).isSymbolicLink()).toBe(false);
    },
  );
});

describe('probeLocalModelCache — artifact-subdir symlink guard mirrors acquisition (P1, read-only)', () => {
  it.runIf(process.platform !== 'win32')(
    'returns invalid-cache when <cacheDir>/all-MiniLM-L6-v2 escapes the cache root via symlink — even if the escaped target holds otherwise-verified artifacts',
    () => {
      // The status probe MUST agree with acquisition (artifactDirIsSafe): a checkpoint
      // subdir symlinked OUT of the validated cache root is rejected as `cache` on
      // acquisition, so the probe must not read straight through it and report a
      // misleading `verified`/`missing`. Pre-fix, the probe validated only the root.
      const cacheDir = createTempDir();
      const escaped = createTempDir(); // outside cacheDir — the symlink's real target
      const content = Buffer.from('escaped-but-otherwise-valid-bytes');
      const artifacts = fakeArtifacts(content);
      // Seed the escaped target so a naive read-through would (wrongly) look verified.
      fs.writeFileSync(path.join(escaped, path.basename(artifacts.model.relPath)), content);
      fs.writeFileSync(path.join(escaped, path.basename(artifacts.tokenizer.relPath)), content);
      fs.symlinkSync(escaped, path.join(cacheDir, 'all-MiniLM-L6-v2'));

      const probe = probeLocalModelCache(baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }), { artifacts });
      expect(probe).toBe('invalid-cache');
    },
  );

  it('does NOT over-reject an ordinary valid, empty cache with no artifact subdir yet (returns missing)', () => {
    // A not-yet-existing checkpoint subdir is safe — acquisition creates it under the
    // validated root — so the guard must leave the normal empty-cache path as `missing`.
    const cacheDir = createTempDir();
    const probe = probeLocalModelCache(
      baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }),
      { artifacts: fakeArtifacts(Buffer.from('x')) },
    );
    expect(probe).toBe('missing');
  });

  it.runIf(process.platform !== 'win32')('reports invalid-cache (not missing/offline) AND matches acquisition for a DANGLING-symlink cache root', async () => {
    // The finding: a dangling-symlink cache root made the probe report `missing` (→ status
    // "offline") while acquisition failed as `cache`. The probe must now agree — and no fetch
    // must be attempted (the cache is unusable regardless of the network).
    const dir = createTempDir();
    const cacheDir = path.join(dir, 'models');
    fs.symlinkSync(path.join(dir, 'no-such-target'), cacheDir); // dangling
    const artifacts = fakeArtifacts(Buffer.from('x'));

    expect(probeLocalModelCache(baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }), { artifacts })).toBe('invalid-cache');

    const calls: FetchCall[] = [];
    const bad = expectUnavailable(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchServing(Buffer.from('x'), calls), artifacts },
      ),
    );
    expect(bad.unavailable).toBe('cache'); // probe now AGREES with acquisition
    expect(calls).toHaveLength(0);          // never touched the network
  });

  it('returns invalid-cache when <cacheDir>/all-MiniLM-L6-v2 is a regular file, not a directory (P2)', () => {
    // A plain file where the checkpoint DIRECTORY is expected: acquisition's
    // mkdirSync(recursive) fails on it as `cache`, so the probe must agree — not read
    // a bogus `<file>/<artifact>` path and report `missing`.
    const cacheDir = createTempDir();
    fs.writeFileSync(path.join(cacheDir, 'all-MiniLM-L6-v2'), 'not a directory');
    const probe = probeLocalModelCache(
      baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }),
      { artifacts: fakeArtifacts(Buffer.from('x')) },
    );
    expect(probe).toBe('invalid-cache');
  });

  it('returns invalid-cache (not missing) when a DIRECTORY occupies the model artifact FILE path (iter-41 P1)', () => {
    // A directory where the model FILE belongs: fileExistsAndVerified and fileIsInsecure both return
    // false (neither is a regular file), so the probe used to fall through to `missing`→offline
    // "retry download" — but acquisition can never promote over it. Report invalid-cache to match.
    const cacheDir = createTempDir();
    const artifacts = fakeArtifacts(Buffer.from('x'));
    fs.mkdirSync(expectedArtifactPath(cacheDir, artifacts.model.relPath), { recursive: true });
    const probe = probeLocalModelCache(baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }), { artifacts });
    expect(probe).toBe('invalid-cache');
  });

  it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)(
    'returns invalid-cache when the checkpoint dir EXISTS but is unwritable, even though the cache root is writable (P2)',
    () => {
      // Acquisition writes its temp file INTO <cacheDir>/all-MiniLM-L6-v2; an existing but
      // unwritable checkpoint dir fails acquisition as `cache` (EACCES). The probe used to
      // check only the writable ROOT and report `missing` — it must check the real write sink.
      const cacheDir = createTempDir(); // root is writable
      const artifactDir = path.join(cacheDir, 'all-MiniLM-L6-v2');
      fs.mkdirSync(artifactDir);
      fs.chmodSync(artifactDir, 0o555); // read+execute only, no write
      try {
        const probe = probeLocalModelCache(
          baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }),
          { artifacts: fakeArtifacts(Buffer.from('x')) },
        );
        expect(probe).toBe('invalid-cache');
      } finally {
        fs.chmodSync(artifactDir, 0o755); // restore so afterEach can remove it
      }
    },
  );

  it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)(
    'returns invalid-cache when the checkpoint dir has write but NO execute/search permission (files cannot be created inside)',
    () => {
      // A dir with W but not X passes a W_OK-only check yet cannot hold new files: creating
      // or opening a file inside requires search (X) permission. The probe must reject it.
      const cacheDir = createTempDir();
      const artifactDir = path.join(cacheDir, 'all-MiniLM-L6-v2');
      fs.mkdirSync(artifactDir);
      fs.chmodSync(artifactDir, 0o200); // write only — no execute/search
      try {
        const probe = probeLocalModelCache(
          baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }),
          { artifacts: fakeArtifacts(Buffer.from('x')) },
        );
        expect(probe).toBe('invalid-cache');
      } finally {
        fs.chmodSync(artifactDir, 0o755); // restore so afterEach can remove it
      }
    },
  );

  it('missing cache + INVALID CODEGRAPH_MODEL_BASE_URL → invalid-base-url (not the misleading missing→offline)', () => {
    const cacheDir = createTempDir(); // valid, empty
    const probe = probeLocalModelCache(
      baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir, CODEGRAPH_MODEL_BASE_URL: 'ftp://mirror.example/models' }),
      { artifacts: fakeArtifacts(Buffer.from('x')) },
    );
    expect(probe).toBe('invalid-base-url');
  });

  it('missing cache + VALID CODEGRAPH_MODEL_BASE_URL → missing (a genuine download-needed state)', () => {
    const cacheDir = createTempDir();
    const probe = probeLocalModelCache(
      baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir, CODEGRAPH_MODEL_BASE_URL: 'https://mirror.example/models' }),
      { artifacts: fakeArtifacts(Buffer.from('x')) },
    );
    expect(probe).toBe('missing');
  });
});

describe('acquireLocalModel — CODEGRAPH_MODEL_BASE_URL override (FR-015)', () => {
  it('applies the override to BOTH artifact download requests', async () => {
    const cacheDir = createTempDir();
    const content = Buffer.from('served-from-the-override-mirror');
    const artifacts = fakeArtifacts(content);
    const calls: FetchCall[] = [];

    const result = await acquireLocalModel(
      { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir, CODEGRAPH_MODEL_BASE_URL: 'http://127.0.0.1:1234/enterprise-mirror' }) },
      { fetchImpl: fetchServing(content, calls), artifacts },
    );

    expectSuccess(result);
    expect(calls.map((c) => c.url)).toEqual([
      'http://127.0.0.1:1234/enterprise-mirror/fake-model.bin',
      'http://127.0.0.1:1234/enterprise-mirror/fake-tokenizer.bin',
    ]);
  });

  it('joins the artifact path onto the base PATH — preserving ?query/#frag, avoiding //, honoring a trailing slash + userinfo/port', async () => {
    const content = Buffer.from('served-from-mirror');
    const artifacts = fakeArtifacts(content);
    const model = path.basename(artifacts.model.relPath); // 'fake-model.bin'
    // [base override, expected MODEL artifact URL] — a bare string concat would absorb the
    // artifact path into the ?query value (breaking signed mirrors); the URL-API join keeps it.
    const cases: Array<[string, string]> = [
      ['https://mirror.example/models?token=abc', `https://mirror.example/models/${model}?token=abc`],
      ['https://mirror.example/models/', `https://mirror.example/models/${model}`],
      ['https://mirror.example', `https://mirror.example/${model}`],
      ['https://mirror.example/models#frag', `https://mirror.example/models/${model}#frag`],
      ['https://user:pass@host:8443/models', `https://user:pass@host:8443/models/${model}`],
    ];
    for (const [base, expected] of cases) {
      const cacheDir = createTempDir();
      const calls: FetchCall[] = [];
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir, CODEGRAPH_MODEL_BASE_URL: base }) },
        { fetchImpl: fetchServing(content, calls), artifacts },
      );
      expect(calls[0]?.url).toBe(expected);
    }
  });

  it('redacts a credentialed override to scheme+host+port in the unavailable message (FR-019 credential-leak guard)', async () => {
    const cacheDir = createTempDir();
    const pinnedContent = Buffer.from('the-real-pinned-bytes');
    const artifacts = fakeArtifacts(pinnedContent);

    const result = expectUnavailable(
      await acquireLocalModel(
        {
          env: baseEnv({
            CODEGRAPH_MODEL_CACHE_DIR: cacheDir,
            CODEGRAPH_MODEL_BASE_URL: 'http://mirror-user:mirror-secret@127.0.0.1:1234/enterprise-mirror',
          }),
        },
        // Same length as the pin (no size-budget trip), different bytes — deliberately
        // exercises the checksum path so this test proves redaction on THAT message.
        { fetchImpl: fetchServing(tamperedCopy(pinnedContent)), artifacts },
      ),
    );

    expect(result.unavailable).toBe('checksum');
    expect(result.message).toContain('http://127.0.0.1:1234');
    expect(result.message).not.toContain('mirror-secret');
    expect(result.message).not.toContain('mirror-user');
    expect(result.message).not.toContain('enterprise-mirror');
  });

  it('rejects a non-http(s) scheme override as invalid config and never attempts the request', async () => {
    const cacheDir = createTempDir();
    const artifacts = fakeArtifacts();
    const calls: FetchCall[] = [];

    const result = await acquireLocalModel(
      { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir, CODEGRAPH_MODEL_BASE_URL: 'file:///etc/passwd' }) },
      { fetchImpl: fetchServing(Buffer.from('x'), calls), artifacts },
    );

    expectUnavailable(result);
    expect(calls).toHaveLength(0); // never even attempted the request
  });

  it('reuses a fully pre-seeded/verified cache with zero downloads even under an INVALID base-URL override (FR-018 reuse-first)', async () => {
    // A pre-seeded/offline model must remain usable regardless of a stale/typo'd mirror
    // override: base-URL validity gates only the DOWNLOAD path, not cache reuse. Pre-fix,
    // acquireLocalModel validated CODEGRAPH_MODEL_BASE_URL up-front and rejected as offline
    // before ever consulting the cache.
    const cacheDir = createTempDir();
    const content = Buffer.from('fake-model-bytes');
    const artifacts = fakeArtifacts(content);
    const modelDir = path.join(cacheDir, 'all-MiniLM-L6-v2');
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, path.basename(artifacts.model.relPath)), content);
    fs.writeFileSync(path.join(modelDir, path.basename(artifacts.tokenizer.relPath)), content);

    const calls: FetchCall[] = [];
    const result = expectSuccess(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir, CODEGRAPH_MODEL_BASE_URL: 'file:///etc/passwd' }) },
        { fetchImpl: fetchServing(content, calls), artifacts },
      ),
    );

    expect(result.modelPath).toBe(expectedArtifactPath(cacheDir, artifacts.model.relPath));
    expect(result.tokenizerPath).toBe(expectedArtifactPath(cacheDir, artifacts.tokenizer.relPath));
    expect(calls).toHaveLength(0); // reused from cache; never downloaded despite the bad override
  });
});

describe('acquireLocalModel — distinct messages per unavailable reason (FR-019 / FR-019a / FR-020)', () => {
  it('offline, checksum, and cache reasons carry three pairwise-distinct actionable messages', async () => {
    const offlineDir = createTempDir();
    const offlineResult = expectUnavailable(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: offlineDir }) },
        { fetchImpl: fetchOffline(), artifacts: fakeArtifacts() },
      ),
    );
    expect(offlineResult.unavailable).toBe('offline');

    const checksumDir = createTempDir();
    const checksumPinnedContent = Buffer.from('different-pinned-bytes');
    const checksumResult = expectUnavailable(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: checksumDir }) },
        {
          // Same length as the pin (no size-budget trip), different bytes.
          fetchImpl: fetchServing(tamperedCopy(checksumPinnedContent)),
          artifacts: fakeArtifacts(checksumPinnedContent),
        },
      ),
    );
    expect(checksumResult.unavailable).toBe('checksum');

    const sensitiveCacheDir = process.platform === 'win32' ? 'C:\\Windows\\System32\\cg-models' : '/opt/cg-models-should-be-rejected';
    const cacheResult = expectUnavailable(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: sensitiveCacheDir }) },
        { fetchImpl: fetchServing(Buffer.from('unused')), artifacts: fakeArtifacts() },
      ),
    );
    expect(cacheResult.unavailable).toBe('cache');

    const messages = [offlineResult.message, checksumResult.message, cacheResult.message];
    expect(new Set(messages).size).toBe(3); // pairwise distinct

    expect(offlineResult.message).toContain('CODEGRAPH_MODEL_BASE_URL');
    expect(checksumResult.message.toLowerCase()).toContain('sha-256');
    expect(cacheResult.message).toContain('CODEGRAPH_MODEL_CACHE_DIR');
  });

  it('names the resolved cache dir and the exact pre-seed filename in the offline message', async () => {
    const cacheDir = createTempDir();
    const result = expectUnavailable(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: fetchOffline(), artifacts: fakeArtifacts() },
      ),
    );
    expect(result.message).toContain(cacheDir);
    expect(result.message).toContain('fake-model.bin'); // the exact filename to pre-seed
  });
});

describe('acquireLocalModel — never throws (advisory outcome only)', () => {
  it('resolves (never rejects) even when the injected fetch throws synchronously', async () => {
    const cacheDir = createTempDir();
    const throwingFetch = (() => {
      throw new Error('boom — a misbehaving fetch implementation');
    }) as unknown as typeof fetch;

    await expect(
      acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: cacheDir }) },
        { fetchImpl: throwingFetch, artifacts: fakeArtifacts() },
      ),
    ).resolves.toBeDefined();
  });

  it('resolves to a cache-reason unavailable for a rejected sensitive cache dir, without ever calling fetch', async () => {
    const calls: FetchCall[] = [];
    const sensitiveDir = process.platform === 'win32' ? 'C:\\Windows\\System32\\cg-models' : '/opt/cg-models-should-be-rejected';

    const result = expectUnavailable(
      await acquireLocalModel(
        { env: baseEnv({ CODEGRAPH_MODEL_CACHE_DIR: sensitiveDir }) },
        { fetchImpl: fetchServing(Buffer.from('x'), calls), artifacts: fakeArtifacts() },
      ),
    );

    expect(result.unavailable).toBe('cache');
    expect(calls).toHaveLength(0);
  });
});

describe('T007 — pinned artifact digests (regression guard against an accidental edit)', () => {
  it('pins model_quantized.onnx at its known SHA-256 and exact byte size', () => {
    expect(MODEL_ARTIFACT.relPath).toBe('onnx/model_quantized.onnx');
    expect(MODEL_ARTIFACT.size).toBe(22_972_370);
    expect(MODEL_ARTIFACT.sha256).toBe('afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1');
  });

  it('pins tokenizer.json at the SHA-256 computed from the real bytes at the pinned commit, and its exact byte size', () => {
    expect(TOKENIZER_ARTIFACT.relPath).toBe('tokenizer.json');
    expect(TOKENIZER_ARTIFACT.size).toBe(711_661);
    expect(TOKENIZER_ARTIFACT.sha256).toBe('da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0');
  });
});
