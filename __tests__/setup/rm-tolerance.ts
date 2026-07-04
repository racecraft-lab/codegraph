/**
 * Suite-wide teardown tolerance for temp-dir removal (vitest setupFile).
 *
 * Nearly every suite builds a fixture under `os.tmpdir()` and removes it in
 * afterEach/finally with `fs.rmSync(dir, { recursive: true })`. On Windows
 * runners those removes race handles briefly held by just-finished work —
 * parse-pool workers, SQLite WAL files, a SIGKILL'd server's liftoff re-exec
 * grandchild — and fail EPERM/EBUSY; on Linux the same race surfaces as
 * ENOTEMPTY. The tests themselves pass; only cleanup is flaky (observed on
 * hosted CI across mcp-*, frameworks-integration, and resolution suites —
 * a new file every run, so per-file patching doesn't converge).
 *
 * Policy, applied to every `fs.rmSync` call in the test runtime:
 *   1. Always add retry backoff (matches Node's own maxRetries semantics).
 *   2. If it STILL fails: on win32 only, for recursive removes of paths
 *      inside os.tmpdir() only, swallow the transient error classes — a
 *      leaked CI tempdir is harmless, a red suite over cleanup is not.
 *      Everything else (POSIX, non-tmpdir paths, other error codes) still
 *      throws, so real product bugs are never masked.
 */
import { createRequire } from 'node:module';
import * as os from 'os';
import * as path from 'path';
import type * as FsType from 'fs';

// The ESM namespace of 'fs' is frozen; patch the underlying CJS exports
// object (the graceful-fs approach) — builtin ESM facades read it live.
const requireCjs = createRequire(import.meta.url);
const fs: typeof FsType = requireCjs('fs');

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);

// vitest re-runs setupFiles per test file (isolate: true) while the CJS fs
// module is process-wide — guard so wrappers don't chain, and keep a handle
// to the true original for rmrfBestEffort.
type PatchedRmSync = typeof fs.rmSync & {
  __cgRmTolerance?: true;
  __cgRealRmSync?: typeof fs.rmSync;
};
const current = fs.rmSync as PatchedRmSync;
const realRmSync: typeof fs.rmSync = current.__cgRmTolerance
  ? current.__cgRealRmSync!
  : current.bind(fs);

function insideTmpdir(p: FsType.PathLike): boolean {
  try {
    const resolved = path.resolve(String(p));
    const tmp = path.resolve(os.tmpdir());
    return resolved.startsWith(tmp + path.sep) || resolved === tmp;
  } catch {
    return false;
  }
}

function swallowable(p: FsType.PathLike, recursive: boolean | undefined, code: string): boolean {
  return process.platform === 'win32' && recursive === true && TRANSIENT.has(code) && insideTmpdir(p);
}

/**
 * Teardown helper for suites whose fixtures are held open a beat longer than
 * the test (spawned servers, parse workers): recursive rm with retry backoff,
 * best-effort on win32 for tmpdir fixtures, throwing everywhere else. Call it
 * once per directory so one failure never skips a sibling cleanup.
 */
export function rmrfBestEffort(p: FsType.PathLike): void {
  try {
    realRmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code ?? '';
    if (swallowable(p, true, code)) return; // leaked CI tempdir is harmless
    throw e;
  }
}

if (!current.__cgRmTolerance) {
  const patched = ((p: FsType.PathLike, opts?: FsType.RmOptions) => {
    const merged: FsType.RmOptions | undefined = opts
      ? { maxRetries: 5, retryDelay: 100, ...opts }
      : opts;
    try {
      return realRmSync(p, merged as FsType.RmOptions);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code ?? '';
      if (swallowable(p, opts?.recursive, code)) {
        return; // best-effort: leaked tempdir on a throwaway CI VM
      }
      throw e;
    }
  }) as PatchedRmSync;
  patched.__cgRmTolerance = true;
  patched.__cgRealRmSync = realRmSync;
  fs.rmSync = patched;
}
