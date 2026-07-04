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
const realRmSync = fs.rmSync.bind(fs);

function insideTmpdir(p: FsType.PathLike): boolean {
  try {
    const resolved = path.resolve(String(p));
    const tmp = path.resolve(os.tmpdir());
    return resolved.startsWith(tmp + path.sep) || resolved === tmp;
  } catch {
    return false;
  }
}

fs.rmSync = ((p: FsType.PathLike, opts?: FsType.RmOptions) => {
  const merged: FsType.RmOptions | undefined = opts
    ? { maxRetries: 5, retryDelay: 100, ...opts }
    : opts;
  try {
    return realRmSync(p, merged as FsType.RmOptions);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code ?? '';
    if (
      process.platform === 'win32' &&
      opts?.recursive === true &&
      TRANSIENT.has(code) &&
      insideTmpdir(p)
    ) {
      return; // best-effort: leaked tempdir on a throwaway CI VM
    }
    throw e;
  }
}) as typeof fs.rmSync;
