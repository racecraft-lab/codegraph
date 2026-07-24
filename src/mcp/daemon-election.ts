import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ensureDaemonLockDirectory,
  getDaemonLockDirectory,
  projectHash,
} from './daemon-paths';

interface ElectionDatabase {
  exec(sql: string): void;
  close(): void;
}

export interface DaemonElectionGuard {
  release(): Promise<void>;
}

// POSIX record locks are process-scoped: closing any descriptor for the lease
// file can release a sibling connection's lock. Never reopen a locally held
// election path, including from the synchronous discovery probe.
const locallyHeldElections = new Set<string>();

/** The private, per-user SQLite lease path for one project. */
export function getDaemonElectionPath(projectRoot: string): string {
  if (process.platform === 'win32') {
    return path.join(getDaemonLockDirectory(projectRoot), `${projectHash(projectRoot)}.election.sqlite`);
  }
  const home = fs.realpathSync.native(os.homedir());
  return path.join(home, '.codegraph', 'daemon-elections', `${projectHash(projectRoot)}.sqlite`);
}

function ensurePrivateElectionDirectory(projectRoot: string): string {
  if (process.platform === 'win32') {
    return ensureDaemonLockDirectory(projectRoot);
  }
  const home = fs.realpathSync.native(os.homedir());
  const dir = path.dirname(getDaemonElectionPath(projectRoot));
  let current = home;
  for (const part of path.relative(home, dir).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { fs.mkdirSync(current, { mode: 0o700 }); } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const stat = fs.lstatSync(current);
    const uid = process.getuid?.();
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (uid !== undefined && stat.uid !== uid)
    ) throw new Error('daemon election directory is not an owner-controlled regular directory');
    if ((stat.mode & 0o077) !== 0) fs.chmodSync(current, 0o700);
  }
  const finalStat = fs.lstatSync(dir);
  const uid = process.getuid?.();
  if (
    !finalStat.isDirectory() ||
    finalStat.isSymbolicLink() ||
    (uid !== undefined && finalStat.uid !== uid) ||
    (finalStat.mode & 0o077) !== 0 ||
    fs.realpathSync.native(dir) !== dir
  ) throw new Error('daemon election directory is not an owner-controlled regular directory');
  return dir;
}

function isBusyError(err: unknown): boolean {
  const value = err as NodeJS.ErrnoException & { errcode?: number; errstr?: string };
  return value.code === 'ERR_SQLITE_ERROR' &&
    (value.errcode === 5 || value.errstr === 'database is locked' || /database is locked/i.test(value.message));
}

/**
 * Acquire a crash-recoverable, per-project election lease.
 *
 * The guard is an exclusive transaction in a private per-project SQLite file.
 * SQLite's OS-level file lock is released automatically when a process exits or
 * crashes, so there is no sentinel to unlink and no stale-file takeover race.
 * Each project uses its own database, so one daemon never blocks another.
 */
export async function tryAcquireDaemonElectionGuard(
  projectRoot: string,
): Promise<DaemonElectionGuard | null> {
  return acquireDaemonElectionGuard(projectRoot);
}

function acquireDaemonElectionGuard(projectRoot: string): DaemonElectionGuard | null {
  ensurePrivateElectionDirectory(projectRoot);
  const leasePath = getDaemonElectionPath(projectRoot);
  if (locallyHeldElections.has(leasePath)) return null;

  // Pre-create with owner-only permissions. SQLite otherwise honors the umask,
  // which can expose a 0644 metadata file even though the parent is private.
  let fd: number | null = null;
  try {
    const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW ?? 0);
    const nonBlock = process.platform === 'win32' ? 0 : (fs.constants.O_NONBLOCK ?? 0);
    if (process.platform === 'win32') {
      try {
        if (fs.lstatSync(leasePath).isSymbolicLink()) {
          throw new Error('daemon election lease is a symlink');
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    fd = fs.openSync(
      leasePath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | noFollow | nonBlock,
      0o600,
    );
    const stat = fs.fstatSync(fd);
    const uid = process.getuid?.();
    if (!stat.isFile() || stat.nlink !== 1 || (uid !== undefined && stat.uid !== uid)) {
      throw new Error('daemon election lease is not an owner-controlled regular file');
    }
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      throw new Error('daemon election lease is not owner-only');
    }
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }

  // node:sqlite is CodeGraph's required storage backend. Source CLI launches
  // add the feature flag on Node releases where it is still opt-in; every
  // bundled CLI ships a newer supported runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (location: string) => ElectionDatabase;
  };
  const db = new DatabaseSync(leasePath);
  try {
    db.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;');
  } catch (err) {
    try { db.close(); } catch { /* preserve acquisition result */ }
    if (isBusyError(err)) return null;
    throw err;
  }
  locallyHeldElections.add(leasePath);

  let released = false;
  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      try { db.exec('COMMIT;'); } catch { /* connection close still releases */ }
      let closed = false;
      try {
        db.close();
        closed = true;
      } catch { /* preserve fail-closed local ownership */ }
      if (closed) locallyHeldElections.delete(leasePath);
    },
  };
}

/** Fail-closed probe used by synchronous daemon discovery. */
export function daemonElectionIsHeld(projectRoot: string): boolean {
  try {
    const guard = acquireDaemonElectionGuard(projectRoot);
    if (!guard) return true;
    // release() executes synchronously and returns an already-resolved promise.
    void guard.release();
    return false;
  } catch {
    return true;
  }
}
