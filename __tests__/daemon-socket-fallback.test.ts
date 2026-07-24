/**
 * Daemon support on socket-incapable filesystems — issue #997 (and the adjacent
 * #974 WSL2 DrvFs hazard).
 *
 * A project on an ExFAT/FAT external volume (or some network mounts / WSL2 DrvFs)
 * breaks the daemon at TWO points, BOTH surfacing as ENOTSUP (verified on a real
 * macOS fskit ExFAT volume):
 *
 *   1. Lock acquisition `link()`s a temp file onto `.codegraph/daemon.pid` for
 *      race-free exclusivity (#411). ExFAT has no hard links, so this throws
 *      first — before the socket is ever reached. The fix falls back to an
 *      exclusive owner-only directory containing the complete record.
 *   2. The socket `listen()` then throws ENOTSUP regardless of path length, so
 *      the old length-only tmpdir fallback never triggered. The fix makes the
 *      socket path an ORDERED candidate list (in-project, then a deterministic
 *      tmpdir path); the daemon binds the first that works and the proxy connects
 *      the first that answers, so both converge on the fallback with zero
 *      coordination.
 *
 * Both failures report a DIFFERENT errno per OS — ENOTSUP (macOS), EPERM (Linux),
 * EISDIR (Windows) — so the fix deliberately does NOT gate on an enumerated set:
 * the lock falls back on ANY non-EEXIST link error, the socket relocates on ANY
 * non-EADDRINUSE bind error. These tests pin that policy (incl. a deliberately
 * unanticipated errno), the candidate list, the candidate-walk binder, and the
 * directory lock primitive. (Throwaway scripts drove the full daemon end-to-
 * end on a real macOS ExFAT image, a Linux FAT loopback mount, and a Windows
 * exFAT VHD — relocate, serve a real client, rewrite the pidfile — none of which
 * can run in CI.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { createDaemonAuthSecret } from '../src/mcp/daemon-auth';
import {
  ensureDaemonLockDirectory,
  ensureDaemonSocketDirectory,
  getDaemonLockDirectory,
  getDaemonLockRecordPath,
  getDaemonPidPath,
  MAX_DAEMON_LOCK_BYTES,
  openDaemonLog,
  getDaemonSocketCandidates,
  getDaemonSocketPath,
  readDaemonLockFile,
  readTrustedDaemonLock,
  recoverDaemonLockDirectory,
  removeOwnedDaemonSocket,
} from '../src/mcp/daemon-paths';
import type { DaemonLockInfo } from '../src/mcp/daemon-paths';
import { decodeLockInfo, encodeLockInfo } from '../src/mcp/daemon-paths';
import {
  acquireLockViaDirectoryFallback,
  bindFirstUsableSocket,
  clearStaleDaemonLock,
  tryAcquireDaemonLock,
  tryAcquireDaemonElectionGuard,
  waitForCompleteDaemonLock,
} from '../src/mcp/daemon';
import { daemonElectionIsHeld, getDaemonElectionPath } from '../src/mcp/daemon-election';

const POSIX = process.platform !== 'win32';

const tmpFiles: string[] = [];
const tmpDirs: string[] = [];

function secureTempFile(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return path.join(dir, 'daemon.pid');
}

function writePrivateFile(filePath: string, contents: string): void {
  const fd = fs.openSync(filePath, 'wx', 0o600);
  try { fs.writeFileSync(fd, contents); } finally { fs.closeSync(fd); }
}
beforeEach(() => {
  const tmpHome = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cg-daemon-home-')));
  tmpDirs.push(tmpHome);
  vi.stubEnv('HOME', tmpHome);
  vi.stubEnv('USERPROFILE', tmpHome);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  while (tmpFiles.length) {
    try { fs.rmSync(tmpFiles.pop()!, { force: true }); } catch { /* best-effort */ }
  }
  while (tmpDirs.length) {
    try { fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

/** A stand-in net.Server — bindFirstUsableSocket only ever passes it through. */
const fakeServer = (tag: string): net.Server => ({ tag } as unknown as net.Server);

/** Build an ErrnoException carrying a specific code, like a real listen() error. */
function errno(code: string): NodeJS.ErrnoException {
  const e = new Error(`listen ${code}`) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

describe('getDaemonSocketCandidates (#997)', () => {
  it.runIf(POSIX)('returns [in-project, tmpdir] for a normal short path', () => {
    const root = path.join(os.tmpdir(), 'cg-cand-short');
    const candidates = getDaemonSocketCandidates(root);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toBe(path.join(root, '.codegraph', 'daemon.sock'));
    expect(candidates[1]!.startsWith(os.tmpdir())).toBe(true);
    expect(path.dirname(candidates[1]!)).not.toBe(os.tmpdir());
    expect(path.dirname(path.dirname(candidates[1]!))).toBe(os.tmpdir());
    expect(path.basename(candidates[1]!)).toMatch(/^codegraph-[0-9a-f]{16}\.sock$/);
  });

  it.runIf(POSIX)('drops straight to [tmpdir] when the in-project path is too long', () => {
    // A deep root pushes `.codegraph/daemon.sock` past the POSIX socket limit.
    const root = path.join('/tmp', 'x'.repeat(120));
    const candidates = getDaemonSocketCandidates(root);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.startsWith(os.tmpdir())).toBe(true);
  });

  it.runIf(POSIX)('is deterministic and project-scoped: same root → same tmpdir fallback', () => {
    const root = path.join(os.tmpdir(), 'cg-cand-determinism');
    const a = getDaemonSocketCandidates(root);
    const b = getDaemonSocketCandidates(root);
    expect(a).toEqual(b);
    // A different root yields a different (hashed) tmpdir fallback.
    const other = getDaemonSocketCandidates(root + '-other');
    expect(other[other.length - 1]).not.toBe(a[a.length - 1]);
  });

  it.runIf(POSIX)('creates the tmpdir fallback inside an owner-only directory', () => {
    const root = path.join('/tmp', 'x'.repeat(120));
    const socketPath = getDaemonSocketCandidates(root)[0]!;

    ensureDaemonSocketDirectory(root, socketPath);

    const stat = fs.lstatSync(path.dirname(socketPath));
    expect(stat.isDirectory()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.mode & 0o077).toBe(0);
    if (process.getuid) expect(stat.uid).toBe(process.getuid());
  });

  it.runIf(!POSIX)('returns a single named pipe on Windows', () => {
    const instanceId = randomUUID();
    const candidates = getDaemonSocketCandidates('C:/dev/proj', instanceId);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.startsWith('\\\\.\\pipe\\codegraph-')).toBe(true);
    expect(candidates[0]!.endsWith(`-${instanceId}`)).toBe(true);
  });

  it('getDaemonSocketPath returns the preferred candidate (index 0)', () => {
    const root = path.join(os.tmpdir(), 'cg-cand-primary');
    expect(getDaemonSocketPath(root)).toBe(getDaemonSocketCandidates(root)[0]);
  });
});

describe('bindFirstUsableSocket (#997)', () => {
  it('binds the first candidate when it works, without relocating', async () => {
    const tried: string[] = [];
    const relocations: string[] = [];
    const result = await bindFirstUsableSocket(
      ['/proj/.codegraph/daemon.sock', '/tmp/fallback.sock'],
      (p) => { tried.push(p); return Promise.resolve(fakeServer(p)); },
      { onRelocate: (from, to) => relocations.push(`${from}->${to}`) },
    );
    expect(result.socketPath).toBe('/proj/.codegraph/daemon.sock');
    expect(tried).toEqual(['/proj/.codegraph/daemon.sock']); // never touched the fallback
    expect(relocations).toEqual([]);
  });

  it('relocates to the tmpdir fallback when the in-project bind throws ENOTSUP', async () => {
    const tried: string[] = [];
    const relocations: Array<[string, string, string]> = [];
    const result = await bindFirstUsableSocket(
      ['/exfat/proj/.codegraph/daemon.sock', '/tmp/fallback.sock'],
      (p) => {
        tried.push(p);
        if (p.includes('/exfat/')) return Promise.reject(errno('ENOTSUP'));
        return Promise.resolve(fakeServer(p));
      },
      { onRelocate: (from, to, code) => relocations.push([from, to, code]) },
    );
    expect(result.socketPath).toBe('/tmp/fallback.sock');
    expect(tried).toEqual(['/exfat/proj/.codegraph/daemon.sock', '/tmp/fallback.sock']);
    expect(relocations).toEqual([
      ['/exfat/proj/.codegraph/daemon.sock', '/tmp/fallback.sock', 'ENOTSUP'],
    ]);
  });

  it('does NOT relocate on EADDRINUSE — it propagates even with a fallback present', async () => {
    const tried: string[] = [];
    await expect(
      bindFirstUsableSocket(
        ['/proj/.codegraph/daemon.sock', '/tmp/fallback.sock'],
        (p) => { tried.push(p); return Promise.reject(errno('EADDRINUSE')); },
      ),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(tried).toEqual(['/proj/.codegraph/daemon.sock']); // fallback never tried
  });

  it('propagates a capability error on the LAST candidate (nowhere left to go)', async () => {
    // When tmpdir itself can't host a socket, the single-candidate long-path list
    // (or the exhausted tail of a longer one) has no fallback — the daemon must
    // surface the error so the launcher drops to direct mode (#974).
    await expect(
      bindFirstUsableSocket(
        ['/tmp/only.sock'],
        () => Promise.reject(errno('ENOTSUP')),
      ),
    ).rejects.toMatchObject({ code: 'ENOTSUP' });
  });

  it('walks past multiple unusable candidates to the first that binds', async () => {
    const tried: string[] = [];
    const result = await bindFirstUsableSocket(
      ['/a.sock', '/b.sock', '/c.sock'],
      (p) => {
        tried.push(p);
        if (p === '/a.sock') return Promise.reject(errno('ENOTSUP'));
        if (p === '/b.sock') return Promise.reject(errno('EACCES'));
        return Promise.resolve(fakeServer(p));
      },
    );
    expect(result.socketPath).toBe('/c.sock');
    expect(tried).toEqual(['/a.sock', '/b.sock', '/c.sock']);
  });

  it('relocates on an UNEXPECTED errno too — the policy is "anything but EADDRINUSE", not a fixed list', async () => {
    // ExFAT/FAT report different bind errnos per OS (ENOTSUP macOS, EPERM Linux),
    // so we must NOT gate relocation on an enumerated set — a code we never
    // anticipated must still fall through to tmpdir. 'EWEIRD' stands in for any
    // such surprise.
    const result = await bindFirstUsableSocket(
      ['/odd/proj/.codegraph/daemon.sock', '/tmp/fallback.sock'],
      (p) => p.includes('/odd/') ? Promise.reject(errno('EWEIRD')) : Promise.resolve(fakeServer(p)),
    );
    expect(result.socketPath).toBe('/tmp/fallback.sock');
  });
});

describe('lock acquisition without hard links (#997)', () => {
  it.runIf(POSIX)('places POSIX election leases under the owner-controlled home authority', () => {
    const root = path.join(os.tmpdir(), 'cg-election-posix-path');
    expect(path.dirname(getDaemonElectionPath(root))).toBe(
      path.join(fs.realpathSync.native(os.homedir()), '.codegraph', 'daemon-elections'),
    );
    expect(path.basename(getDaemonElectionPath(root))).toMatch(/^[0-9a-f]{16}\.sqlite$/);
  });

  it.runIf(POSIX)('rejects a foreign-owned election directory before creating a lease', async () => {
    const root = path.join(os.tmpdir(), 'cg-election-foreign-owner');
    const leasePath = getDaemonElectionPath(root);
    const electionDir = path.dirname(leasePath);
    fs.mkdirSync(electionDir, { recursive: true, mode: 0o700 });
    const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
    const originalLstat = mutableFs.lstatSync;
    mutableFs.lstatSync = ((target: fs.PathLike) => {
      const stat = originalLstat(target);
      if (path.resolve(String(target)) !== path.resolve(electionDir)) return stat;
      const foreign = Object.create(stat) as fs.Stats;
      Object.defineProperty(foreign, 'uid', { value: stat.uid + 1 });
      return foreign;
    }) as typeof fs.lstatSync;
    syncBuiltinESMExports();

    try {
      await expect(tryAcquireDaemonElectionGuard(root)).rejects.toThrow(/owner-controlled/);
    } finally {
      mutableFs.lstatSync = originalLstat;
      syncBuiltinESMExports();
    }
    expect(fs.existsSync(leasePath)).toBe(false);
  });

  it.runIf(POSIX)('places simulated Windows election leases under the user-profile authority directory', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    try {
      const root = path.join(os.tmpdir(), 'cg-election-windows-path');
      expect(path.dirname(getDaemonElectionPath(root))).toBe(getDaemonLockDirectory(root));
      expect(path.basename(getDaemonElectionPath(root))).toMatch(/^[0-9a-f]{16}\.election\.sqlite$/);
    } finally {
      platform.mockRestore();
    }
  });

  it('serializes election and recovers the persisted record after lease release', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-election-guard-'));
    tmpDirs.push(root);
    tmpFiles.push(getDaemonElectionPath(root));
    const first = await tryAcquireDaemonElectionGuard(root);
    expect(first).not.toBeNull();
    expect(await tryAcquireDaemonElectionGuard(root)).toBeNull();

    await first!.release();
    const next = await tryAcquireDaemonElectionGuard(root);
    expect(next).not.toBeNull();
    await next!.release();
  });

  it.runIf(POSIX)('keeps a locally held election locked after a same-process probe', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-election-probe-'));
    tmpDirs.push(root);
    const leasePath = getDaemonElectionPath(root);
    const guard = await tryAcquireDaemonElectionGuard(root);
    expect(guard).not.toBeNull();
    try {
      expect(daemonElectionIsHeld(root)).toBe(true);
      const childResult = execFileSync(process.execPath, ['-e', [
        "const { DatabaseSync } = require('node:sqlite')",
        'const db = new DatabaseSync(process.env.CG_TEST_ELECTION_PATH)',
        "try { db.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;'); process.stdout.write('acquired') } catch { process.stdout.write('busy') } finally { try { db.close() } catch {} }",
      ].join(';')], {
        env: { ...process.env, CG_TEST_ELECTION_PATH: leasePath },
        encoding: 'utf8',
      });
      expect(childResult).toBe('busy');
    } finally {
      await guard!.release();
    }
  });

  it('keeps election acquisition fail-closed when database close reports failure', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-election-close-failure-'));
    tmpDirs.push(root);
    const sqlite = createRequire(import.meta.url)('node:sqlite') as {
      DatabaseSync: { prototype: { close(): void } };
    };
    const originalClose = sqlite.DatabaseSync.prototype.close;
    let failClose = false;
    sqlite.DatabaseSync.prototype.close = function closeWithFailure(): void {
      originalClose.call(this);
      if (failClose) {
        failClose = false;
        throw new Error('simulated close reporting failure');
      }
    };

    try {
      const guard = await tryAcquireDaemonElectionGuard(root);
      expect(guard).not.toBeNull();
      failClose = true;
      await guard!.release();
      const replacement = await tryAcquireDaemonElectionGuard(root);
      if (replacement) await replacement.release();
      expect(replacement).toBeNull();
    } finally {
      sqlite.DatabaseSync.prototype.close = originalClose;
    }
  });

  it.runIf(POSIX)('rejects symlinked and overly permissive election lease files', async () => {
    const symlinkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-election-symlink-'));
    const modeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-election-mode-'));
    tmpDirs.push(symlinkRoot, modeRoot);

    const symlinkLease = getDaemonElectionPath(symlinkRoot);
    fs.mkdirSync(path.dirname(symlinkLease), { recursive: true, mode: 0o700 });
    const victim = path.join(path.dirname(symlinkLease), 'victim.sqlite');
    fs.writeFileSync(victim, 'untouched', { mode: 0o600 });
    fs.symlinkSync(victim, symlinkLease);
    await expect(tryAcquireDaemonElectionGuard(symlinkRoot)).rejects.toThrow();
    expect(fs.readFileSync(victim, 'utf8')).toBe('untouched');

    const modeLease = getDaemonElectionPath(modeRoot);
    fs.writeFileSync(modeLease, '', { mode: 0o600 });
    fs.chmodSync(modeLease, 0o644);
    await expect(tryAcquireDaemonElectionGuard(modeRoot)).rejects.toThrow(/owner-only/);
  });

  it.runIf(POSIX)('opens a FIFO election path nonblocking and rejects it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-election-fifo-'));
    tmpDirs.push(root);
    const leasePath = getDaemonElectionPath(root);
    fs.mkdirSync(path.dirname(leasePath), { recursive: true, mode: 0o700 });
    execFileSync('mkfifo', [leasePath]);
    const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
    const originalOpen = mutableFs.openSync;
    let observedFlags = 0;
    mutableFs.openSync = ((target: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
      if (path.resolve(String(target)) === path.resolve(leasePath)) {
        observedFlags = Number(flags);
        if ((observedFlags & fs.constants.O_NONBLOCK) === 0) {
          throw new Error('FIFO election lease would block without O_NONBLOCK');
        }
      }
      return originalOpen(target, flags, mode);
    }) as typeof fs.openSync;
    syncBuiltinESMExports();

    try {
      await expect(tryAcquireDaemonElectionGuard(root)).rejects.toThrow();
    } finally {
      mutableFs.openSync = originalOpen;
      syncBuiltinESMExports();
    }
    expect(observedFlags & fs.constants.O_NONBLOCK).toBe(fs.constants.O_NONBLOCK);
  });

  it('recovers the election lease after its owner is killed without cleanup', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-election-crash-'));
    tmpDirs.push(root);
    const leasePath = getDaemonElectionPath(root);
    tmpFiles.push(leasePath);
    const primer = await tryAcquireDaemonElectionGuard(root);
    expect(primer).not.toBeNull();
    await primer!.release();

    const child = spawn(process.execPath, ['-e', [
      "const { DatabaseSync } = require('node:sqlite')",
      "const db = new DatabaseSync(process.env.CG_TEST_ELECTION_PATH)",
      "db.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;')",
      "process.stdout.write('ready\\n')",
      'setInterval(() => {}, 1000)',
    ].join(';')], {
      env: { ...process.env, CG_TEST_ELECTION_PATH: leasePath },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('lease child did not start')), 3_000);
        child.stdout!.once('data', () => {
          clearTimeout(timer);
          resolve();
        });
        child.once('error', reject);
        child.once('exit', (code) => {
          if (code !== null) reject(new Error(`lease child exited ${code}`));
        });
      });
      expect(await tryAcquireDaemonElectionGuard(root)).toBeNull();
      child.kill('SIGKILL');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));

      const recovered = await tryAcquireDaemonElectionGuard(root);
      expect(recovered).not.toBeNull();
      await recovered!.release();
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });

  it.runIf(POSIX)('rejects a symlinked or hard-linked daemon log', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-daemon-log-'));
    tmpDirs.push(root);
    const codegraphDir = path.join(root, '.codegraph');
    fs.mkdirSync(codegraphDir);
    const victim = path.join(root, 'victim');
    fs.writeFileSync(victim, 'unchanged');
    const logPath = path.join(codegraphDir, 'daemon.log');

    fs.symlinkSync(victim, logPath);
    expect(() => openDaemonLog(root)).toThrow();
    expect(fs.readFileSync(victim, 'utf8')).toBe('unchanged');

    fs.unlinkSync(logPath);
    fs.linkSync(victim, logPath);
    expect(() => openDaemonLog(root)).toThrow();
    expect(fs.readFileSync(victim, 'utf8')).toBe('unchanged');
  });

  it.runIf(POSIX)('rejects a FIFO daemon log without blocking', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-daemon-log-fifo-'));
    tmpDirs.push(root);
    ensureDaemonLockDirectory(root);
    execFileSync('mkfifo', [path.join(root, '.codegraph', 'daemon.log')]);
    const startedAt = Date.now();

    expect(() => openDaemonLog(root)).toThrow(/regular file/);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it.runIf(POSIX)('rejects a symlinked daemon authority directory without touching its target', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-daemon-dir-'));
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-daemon-external-'));
    tmpDirs.push(root, external);
    const victim = path.join(external, 'daemon.sock');
    fs.writeFileSync(victim, 'unchanged');
    fs.symlinkSync(external, path.join(root, '.codegraph'), 'dir');

    expect(() => ensureDaemonLockDirectory(root)).toThrow(/owner-controlled/);
    expect(() => tryAcquireDaemonLock(root)).toThrow(/owner-controlled/);
    expect(readTrustedDaemonLock(root)).toBeNull();
    expect(fs.readFileSync(victim, 'utf8')).toBe('unchanged');
  });

  it.runIf(POSIX)('removes only an owner-owned socket from a trusted rendezvous path', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-daemon-socket-clean-'));
    tmpDirs.push(root);
    ensureDaemonLockDirectory(root);
    const socketPath = getDaemonSocketCandidates(root)[0]!;
    ensureDaemonSocketDirectory(root, socketPath);

    writePrivateFile(socketPath, 'ordinary file');
    expect(removeOwnedDaemonSocket(root, socketPath)).toBe(false);
    expect(fs.readFileSync(socketPath, 'utf8')).toBe('ordinary file');
    fs.unlinkSync(socketPath);

    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    expect(fs.lstatSync(socketPath).isSocket()).toBe(true);
    expect(removeOwnedDaemonSocket(root, socketPath)).toBe(true);
    expect(fs.existsSync(socketPath)).toBe(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.runIf(POSIX)('preserves a legacy lock whose publisher does not honor the election lease', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-recycled-pid-'));
    tmpDirs.push(root);
    const pidPath = getDaemonPidPath(root);
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    const stale: DaemonLockInfo = {
      pid: process.pid,
      processBirthId: 'test:previous-lifetime',
      version: '1.0.0',
      socketPath: getDaemonSocketPath(root),
      startedAt: Date.now(),
    };
    fs.writeFileSync(pidPath, encodeLockInfo(stale), { mode: 0o600 });

    expect(clearStaleDaemonLock(pidPath, {
      pid: stale.pid,
      processBirthId: stale.processBirthId,
    }, true)).toBe(false);
    expect(decodeLockInfo(fs.readFileSync(pidPath, 'utf8'))).toEqual(stale);
  });

  it.runIf(POSIX)('uses the held election lease to clear a same-pid stale daemon lock', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-stale-lease-'));
    tmpDirs.push(root);
    const pidPath = getDaemonPidPath(root);
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    const stale: DaemonLockInfo = {
      pid: process.pid,
      processBirthId: 'test:same-lifetime',
      electionProtocol: 1,
      version: '1.0.0',
      socketPath: getDaemonSocketPath(root),
      startedAt: Date.now(),
    };
    fs.writeFileSync(pidPath, encodeLockInfo(stale), { mode: 0o600 });

    expect(clearStaleDaemonLock(
      pidPath,
      { pid: stale.pid, processBirthId: stale.processBirthId },
      true,
    )).toBe(true);
  });

  it.runIf(POSIX)('preserves a stale new-protocol lock when atomic restoration is unavailable', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-stale-no-hardlink-'));
    tmpDirs.push(root);
    const pidPath = getDaemonPidPath(root);
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    const stale: DaemonLockInfo = {
      pid: process.pid,
      electionProtocol: 1,
      version: '1.0.0',
      socketPath: getDaemonSocketPath(root),
      startedAt: Date.now(),
    };
    fs.writeFileSync(pidPath, encodeLockInfo(stale), { mode: 0o600 });
    const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
    const originalLink = mutableFs.linkSync;
    mutableFs.linkSync = (() => {
      const error = new Error('hard links unsupported') as NodeJS.ErrnoException;
      error.code = 'ENOTSUP';
      throw error;
    }) as typeof fs.linkSync;
    syncBuiltinESMExports();

    try {
      expect(clearStaleDaemonLock(pidPath, stale.pid, true)).toBe(false);
    } finally {
      mutableFs.linkSync = originalLink;
      syncBuiltinESMExports();
    }
    expect(decodeLockInfo(fs.readFileSync(pidPath, 'utf8'))).toEqual(stale);
  });

  it.runIf(POSIX)('restores a legacy replacement atomically published during stale cleanup', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-stale-replaced-'));
    tmpDirs.push(root);
    const pidPath = getDaemonPidPath(root);
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    const stale: DaemonLockInfo = {
      pid: process.pid,
      processBirthId: 'test:stale-election-lifetime',
      electionProtocol: 1,
      version: '1.0.0',
      socketPath: getDaemonSocketPath(root),
      startedAt: Date.now(),
    };
    const replacement: DaemonLockInfo = {
      pid: process.pid,
      processBirthId: 'test:legacy-replacement',
      version: '0.9.0',
      socketPath: getDaemonSocketPath(root),
      startedAt: Date.now() + 1,
    };
    fs.writeFileSync(pidPath, encodeLockInfo(stale), { mode: 0o600 });
    const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
    const originalRename = mutableFs.renameSync;
    let replaced = false;
    mutableFs.renameSync = ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
      if (!replaced && path.resolve(String(oldPath)) === path.resolve(pidPath)) {
        replaced = true;
        const replacementPath = `${pidPath}.legacy-replacement`;
        fs.writeFileSync(replacementPath, encodeLockInfo(replacement), { mode: 0o600 });
        originalRename(replacementPath, pidPath);
      }
      return originalRename(oldPath, newPath);
    }) as typeof fs.renameSync;
    syncBuiltinESMExports();

    try {
      expect(clearStaleDaemonLock(
        pidPath,
        { pid: stale.pid, processBirthId: stale.processBirthId },
        true,
      )).toBe(false);
    } finally {
      mutableFs.renameSync = originalRename;
      syncBuiltinESMExports();
    }
    expect(decodeLockInfo(fs.readFileSync(pidPath, 'utf8'))).toEqual(replacement);
  });

  it.runIf(POSIX)('recovers an interrupted lock quarantine before acquiring a new daemon lock', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lock-quarantine-crash-'));
    tmpDirs.push(root);
    const pidPath = getDaemonPidPath(root);
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    const liveLegacy: DaemonLockInfo = {
      pid: process.pid,
      version: '0.9.0',
      socketPath: getDaemonSocketPath(root),
      startedAt: Date.now(),
    };
    const quarantine = `${pidPath}.quarantine-crashed-cleaner`;
    fs.writeFileSync(quarantine, encodeLockInfo(liveLegacy), { mode: 0o600 });

    const result = tryAcquireDaemonLock(root);

    expect(result).toMatchObject({ kind: 'taken', existing: liveLegacy });
    expect(decodeLockInfo(fs.readFileSync(pidPath, 'utf8'))).toEqual(liveLegacy);
    expect(fs.existsSync(quarantine)).toBe(false);
  });

  it.runIf(POSIX)('finds a valid lock quarantine after more than 64 invalid entries', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lock-quarantine-many-'));
    tmpDirs.push(root);
    const pidPath = getDaemonPidPath(root);
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    for (let index = 0; index < 64; index++) {
      fs.writeFileSync(
        `${pidPath}.quarantine-000-invalid-${String(index).padStart(2, '0')}`,
        '{',
        { mode: 0o600 },
      );
    }
    const liveLegacy: DaemonLockInfo = {
      pid: process.pid,
      version: '0.9.0',
      socketPath: getDaemonSocketPath(root),
      startedAt: Date.now(),
    };
    fs.writeFileSync(
      `${pidPath}.quarantine-zzz-valid`,
      encodeLockInfo(liveLegacy),
      { mode: 0o600 },
    );

    expect(tryAcquireDaemonLock(root)).toMatchObject({ kind: 'taken', existing: liveLegacy });
    expect(decodeLockInfo(fs.readFileSync(pidPath, 'utf8'))).toEqual(liveLegacy);
  });

  it.runIf(POSIX)('drains multiple stale new-protocol quarantines under the election lease', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lock-quarantine-stale-many-'));
    tmpDirs.push(root);
    const pidPath = getDaemonPidPath(root);
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    for (let index = 0; index < 6; index++) {
      const stale: DaemonLockInfo = {
        pid: 900_000 + index,
        electionProtocol: 1,
        version: '1.0.0',
        socketPath: getDaemonSocketPath(root),
        startedAt: Date.now() - index,
      };
      fs.writeFileSync(
        `${pidPath}.quarantine-stale-${index}`,
        encodeLockInfo(stale),
        { mode: 0o600 },
      );
    }

    const acquired = tryAcquireDaemonLock(root, true);

    expect(acquired.kind).toBe('acquired');
    expect(fs.readdirSync(path.dirname(pidPath)).filter((file) => file.includes('.quarantine-'))).toEqual([]);
  });

  // The hard-link-FAILS path (link() → O_EXCL fallback) can't be forced on a
  // normal FS — fs.linkSync's namespace export is non-configurable, so it can't
  // be spied. It's proven instead end-to-end on real ExFAT/FAT/exFAT volumes
  // (macOS ENOTSUP, Linux EPERM, Windows EISDIR — all acquire via the fallback).
  // Here we just guard that the refactored catch block didn't break the normal
  // link path: a clean acquire, and a second caller correctly sees it held.
  it.runIf(POSIX)('tryAcquireDaemonLock still acquires on a normal FS, and a second caller is told it is taken', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lock-'));
    tmpDirs.push(root);

    const first = tryAcquireDaemonLock(root);
    expect(first.kind).toBe('acquired');
    const pidPath = getDaemonPidPath(root);
    expect(fs.existsSync(pidPath)).toBe(true);
    expect(decodeLockInfo(fs.readFileSync(pidPath, 'utf8'))?.pid).toBe(process.pid);
    expect(decodeLockInfo(fs.readFileSync(pidPath, 'utf8'))?.authSecret).toMatch(/^[0-9a-f]{64}$/);

    const second = tryAcquireDaemonLock(root); // link() → EEXIST → taken
    expect(second.kind).toBe('taken');
    if (second.kind === 'taken') expect(second.existing?.pid).toBe(process.pid);
  });

  it.runIf(POSIX)('trusts only an owner-only, non-symlink lock with a valid instance identity', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-trusted-lock-'));
    tmpDirs.push(root);
    fs.mkdirSync(path.dirname(getDaemonPidPath(root)), { recursive: true });
    const instanceId = randomUUID();
    const info: DaemonLockInfo = {
      pid: process.pid,
      version: '1.0.0',
      socketPath: getDaemonSocketPath(root, instanceId),
      startedAt: Date.now(),
      instanceId,
      authSecret: createDaemonAuthSecret(),
    };
    const pidPath = getDaemonPidPath(root);
    fs.writeFileSync(pidPath, encodeLockInfo(info), { mode: 0o600 });
    expect(readTrustedDaemonLock(root)).toEqual(info);

    fs.chmodSync(pidPath, 0o644);
    expect(readTrustedDaemonLock(root)).toBeNull();
    fs.unlinkSync(pidPath);

    const external = path.join(root, 'external-lock');
    fs.writeFileSync(external, encodeLockInfo(info), { mode: 0o600 });
    fs.symlinkSync(external, pidPath);
    expect(readTrustedDaemonLock(root)).toBeNull();
  });

  it.runIf(POSIX)('never follows a symlink through legacy lock readers or stale cleanup', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-raw-lock-symlink-'));
    tmpDirs.push(root);
    ensureDaemonLockDirectory(root);
    const pidPath = getDaemonPidPath(root);
    const victim = path.join(root, 'external-lock');
    const info: DaemonLockInfo = {
      pid: 2_147_483_647,
      version: 'legacy-test',
      socketPath: getDaemonSocketPath(root),
      startedAt: Date.now(),
    };
    fs.writeFileSync(victim, encodeLockInfo(info), { mode: 0o600 });
    fs.symlinkSync(victim, pidPath);

    const acquired = tryAcquireDaemonLock(root);
    expect(acquired.kind).toBe('taken');
    if (acquired.kind === 'taken') expect(acquired.existing).toBeNull();
    await expect(waitForCompleteDaemonLock(pidPath, 20, 5)).resolves.toBeNull();
    expect(clearStaleDaemonLock(pidPath, info.pid)).toBe(false);
    expect(clearStaleDaemonLock(pidPath, undefined, true)).toBe(false);
    expect(fs.lstatSync(pidPath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(victim, 'utf8')).toBe(encodeLockInfo(info));
  });

  it.runIf(POSIX)('rejects a FIFO daemon lock without blocking', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-daemon-lock-fifo-'));
    tmpDirs.push(root);
    ensureDaemonLockDirectory(root);
    execFileSync('mkfifo', [getDaemonPidPath(root)]);
    const startedAt = Date.now();

    expect(readTrustedDaemonLock(root)).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('rejects an oversized daemon lock before decoding it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-daemon-lock-oversized-'));
    tmpDirs.push(root);
    ensureDaemonLockDirectory(root);
    fs.writeFileSync(getDaemonPidPath(root), 'x'.repeat(MAX_DAEMON_LOCK_BYTES + 1), { mode: 0o600 });

    expect(readTrustedDaemonLock(root)).toBeNull();
  });

  it('directory fallback publishes a complete record atomically', () => {
    const pidPath = secureTempFile('cg-excl-');
    tmpFiles.push(pidPath);
    const completed = `${pidPath}.completed`;
    tmpFiles.push(completed);
    const info: DaemonLockInfo = {
      pid: 4242,
      electionProtocol: 1,
      version: '9.9.9-test',
      socketPath: '/tmp/whatever.sock',
      startedAt: 1_700_000_000_000,
    };
    writePrivateFile(completed, encodeLockInfo(info));

    const acquired = acquireLockViaDirectoryFallback(pidPath, completed);
    expect(acquired).toBe(true);
    expect(readDaemonLockFile(pidPath)).toMatchObject({ state: 'ok', info, storage: 'directory' });
    expect(getDaemonLockRecordPath(pidPath)).toBe(path.join(pidPath, 'record.json'));
    const loser = `${pidPath}.loser`;
    tmpFiles.push(loser);
    writePrivateFile(loser, encodeLockInfo({ ...info, pid: 4243 }));
    expect(acquireLockViaDirectoryFallback(pidPath, loser)).toBe(false);
    expect(readDaemonLockFile(pidPath)).toMatchObject({ state: 'ok', info });
  });

  it('a failed temporary-record write leaves no canonical lock and the next acquisition succeeds', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-lock-temp-write-fail-'));
    tmpDirs.push(root);
    const pidPath = getDaemonPidPath(root);
    const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
    const originalWriteFile = mutableFs.writeFileSync;
    let injected = false;
    mutableFs.writeFileSync = ((target: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: unknown) => {
      if (!injected && typeof target === 'string' && target.startsWith(`${pidPath}.`) && target.endsWith('.tmp')) {
        injected = true;
        originalWriteFile(target, '{', options as never);
        const error = new Error('injected partial temp write') as NodeJS.ErrnoException;
        error.code = 'EIO';
        throw error;
      }
      return originalWriteFile(target, data, options as never);
    }) as typeof fs.writeFileSync;
    syncBuiltinESMExports();
    try {
      expect(() => tryAcquireDaemonLock(root, true)).toThrow(/injected partial/);
    } finally {
      mutableFs.writeFileSync = originalWriteFile;
      syncBuiltinESMExports();
    }
    expect(fs.existsSync(pidPath)).toBe(false);
    const acquired = tryAcquireDaemonLock(root, true);
    expect(acquired.kind).toBe('acquired');
    if (acquired.kind === 'acquired') {
      expect(clearStaleDaemonLock(pidPath, { pid: acquired.info.pid }, true)).toBe(true);
    }
  });

  it('recovers a crash between the directory claim and record publication', () => {
    const pidPath = secureTempFile('cg-excl-crash-');
    tmpFiles.push(pidPath);
    const completed = `${pidPath}.completed`;
    tmpFiles.push(completed);
    writePrivateFile(completed, encodeLockInfo({
      pid: 4242, electionProtocol: 1, version: 'a', socketPath: '/s', startedAt: 1,
    }));
    const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
    const originalRename = mutableFs.renameSync;
    mutableFs.renameSync = (() => {
      const error = new Error('injected rename failure') as NodeJS.ErrnoException;
      error.code = 'EIO';
      throw error;
    }) as typeof fs.renameSync;
    syncBuiltinESMExports();
    try {
      expect(() => acquireLockViaDirectoryFallback(pidPath, completed)).toThrow(/injected/);
    } finally {
      mutableFs.renameSync = originalRename;
      syncBuiltinESMExports();
    }
    expect(fs.lstatSync(pidPath).isDirectory()).toBe(true);
    expect(readDaemonLockFile(pidPath)).toMatchObject({ state: 'invalid', storage: 'directory' });
    expect(recoverDaemonLockDirectory(pidPath, false)).toBe(false);
    expect(recoverDaemonLockDirectory(pidPath, true)).toBe(true);
    expect(fs.existsSync(pidPath)).toBe(false);
  });

  it('directory fallback blocks legacy regular-file publication', () => {
    const pidPath = secureTempFile('cg-excl-legacy-');
    tmpFiles.push(pidPath);
    const completed = `${pidPath}.completed`;
    const legacy = `${pidPath}.legacy`;
    tmpFiles.push(completed, legacy);
    const info: DaemonLockInfo = {
      pid: 1, electionProtocol: 1, version: 'a', socketPath: '/s1', startedAt: 1,
    };
    writePrivateFile(completed, encodeLockInfo(info));
    writePrivateFile(legacy, encodeLockInfo({ pid: 2, version: 'b', socketPath: '/s2', startedAt: 2 }));
    expect(acquireLockViaDirectoryFallback(pidPath, completed)).toBe(true);

    expect(() => fs.writeFileSync(pidPath, 'legacy', { flag: 'wx' })).toThrow();
    expect(() => fs.linkSync(legacy, pidPath)).toThrow();
    expect(readDaemonLockFile(pidPath)).toMatchObject({ state: 'ok', info });
  });

  it('preserves a replacement that wins immediately after directory removal', () => {
    const pidPath = secureTempFile('cg-excl-replaced-');
    tmpFiles.push(pidPath);
    const completed = `${pidPath}.completed`;
    const replacementPath = `${pidPath}.replacement`;
    tmpFiles.push(completed, replacementPath);
    const owned: DaemonLockInfo = {
      pid: 1, electionProtocol: 1, version: 'a', socketPath: '/s1', startedAt: 1,
    };
    const replacement: DaemonLockInfo = {
      pid: 2, version: 'legacy', socketPath: '/s2', startedAt: 2,
    };
    writePrivateFile(completed, encodeLockInfo(owned));
    writePrivateFile(replacementPath, encodeLockInfo(replacement));
    expect(acquireLockViaDirectoryFallback(pidPath, completed)).toBe(true);
    const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
    const originalRmdir = mutableFs.rmdirSync;
    const originalRename = mutableFs.renameSync;
    mutableFs.rmdirSync = ((target: fs.PathLike) => {
      originalRmdir(target);
      originalRename(replacementPath, pidPath);
    }) as typeof fs.rmdirSync;
    syncBuiltinESMExports();
    try {
      expect(clearStaleDaemonLock(pidPath, { pid: owned.pid }, true)).toBe(true);
    } finally {
      mutableFs.rmdirSync = originalRmdir;
      syncBuiltinESMExports();
    }
    expect(decodeLockInfo(fs.readFileSync(pidPath, 'utf8'))).toEqual(replacement);
  });

  it('preserves the directory lock when record removal is temporarily denied', () => {
    const pidPath = secureTempFile('cg-excl-busy-');
    tmpFiles.push(pidPath);
    const completed = `${pidPath}.completed`;
    tmpFiles.push(completed);
    const owned: DaemonLockInfo = {
      pid: 1, electionProtocol: 1, version: 'a', socketPath: '/s1', startedAt: 1,
    };
    writePrivateFile(completed, encodeLockInfo(owned));
    expect(acquireLockViaDirectoryFallback(pidPath, completed)).toBe(true);
    const recordPath = getDaemonLockRecordPath(pidPath);
    const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
    const originalUnlink = mutableFs.unlinkSync;
    mutableFs.unlinkSync = ((target: fs.PathLike) => {
      if (path.resolve(String(target)) === path.resolve(recordPath)) {
        const error = new Error('busy') as NodeJS.ErrnoException;
        error.code = 'EBUSY';
        throw error;
      }
      return originalUnlink(target);
    }) as typeof fs.unlinkSync;
    syncBuiltinESMExports();
    try {
      expect(clearStaleDaemonLock(pidPath, { pid: owned.pid }, true)).toBe(false);
    } finally {
      mutableFs.unlinkSync = originalUnlink;
      syncBuiltinESMExports();
    }
    expect(readDaemonLockFile(pidPath)).toMatchObject({ state: 'ok', info: owned });
  });

  it('waits for an exclusive-open winner to finish its initially empty record', async () => {
    const pidPath = secureTempFile('cg-excl-pending-');
    tmpFiles.push(pidPath);
    const info: DaemonLockInfo = {
      pid: process.pid,
      version: '9.9.9-test',
      socketPath: '/tmp/pending.sock',
      startedAt: 1_700_000_000_000,
    };
    const fd = fs.openSync(pidPath, 'wx', 0o600);
    setTimeout(() => {
      try { fs.writeFileSync(fd, encodeLockInfo(info)); } finally { fs.closeSync(fd); }
    }, 25);

    await expect(waitForCompleteDaemonLock(pidPath, 200, 5)).resolves.toEqual(info);
    expect(readDaemonLockFile(pidPath)).toMatchObject({ state: 'ok', info });
  });

  it('never deletes an incomplete fallback lock after the bounded wait expires', async () => {
    const pidPath = secureTempFile('cg-excl-stalled-');
    tmpFiles.push(pidPath);
    fs.closeSync(fs.openSync(pidPath, 'wx', 0o600));

    await expect(waitForCompleteDaemonLock(pidPath, 20, 5)).resolves.toBeNull();
    expect(clearStaleDaemonLock(pidPath)).toBe(false);
    expect(fs.existsSync(pidPath)).toBe(true);
  });

  it('preserves an incomplete lock because a legacy publisher may still be writing it', async () => {
    const pidPath = secureTempFile('cg-excl-abandoned-');
    tmpFiles.push(pidPath);
    fs.closeSync(fs.openSync(pidPath, 'wx', 0o600));

    await expect(waitForCompleteDaemonLock(pidPath, 20, 5)).resolves.toBeNull();
    expect(clearStaleDaemonLock(pidPath, undefined, true)).toBe(false);
    expect(fs.existsSync(pidPath)).toBe(true);
  });
});
