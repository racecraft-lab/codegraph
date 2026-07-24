/**
 * Daemon socket + lockfile path helpers — issue #411.
 *
 * One shared `codegraph serve --mcp` daemon per project root means we need a
 * stable, project-keyed rendezvous between cooperating processes. The IPC
 * surface area is just two file paths:
 *
 *   - `daemon.sock` — Unix domain socket / named pipe the daemon listens on.
 *   - `daemon.pid` — atomic lock path holding the daemon identity, either as a
 *     regular file or as an owner-only directory with an atomic record.
 *
 * POSIX keeps both under `.codegraph/`. Windows keeps the authoritative lock
 * under the current user's profile so a shared checkout cannot supply daemon
 * connection authority to another user.
 *
 * Special-case: Unix domain socket paths have a hard length limit (~104 on
 * macOS, ~108 on Linux); when the in-project path exceeds it we fall back to
 * an absolute-path hash under `os.tmpdir()`. The owner-only lock acts as the
 * authoritative pointer to the socket path the daemon chose; on Windows that
 * lock lives below the current user's profile rather than the shared project.
 *
 * Second special-case (#997, #974): some filesystems can't host an AF_UNIX node
 * AT ALL — ExFAT/FAT external volumes, certain network mounts, WSL2 DrvFs — so
 * `listen()` throws ENOTSUP/EACCES regardless of path length. We can't cheaply
 * tell those apart from a normal volume up front, so instead of guessing we
 * expose an ORDERED candidate list (`getDaemonSocketCandidates`): the in-project
 * path first, the deterministic tmpdir path as the fallback of last resort. The
 * daemon binds the first that works and records the selected path plus a random
 * instance identity in its owner-only lock record. Clients connect only through
 * that authenticated pointer; they never trust a socket merely because it sits
 * at a predictable fallback path.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { performance } from 'node:perf_hooks';
import { getCodeGraphDir } from '../directory';
import { isValidDaemonAuthSecret } from './daemon-auth';
import { isValidProcessBirthId } from './daemon-process';

/** Soft upper bound for in-project socket paths. */
const POSIX_SOCKET_PATH_LIMIT = 100;

/** Maximum trusted daemon-lock payload, including future metadata growth. */
export const MAX_DAEMON_LOCK_BYTES = 64 * 1024;
/** Record stored below the canonical lock directory on hard-link-free filesystems. */
export const DAEMON_LOCK_RECORD_NAME = 'record.json';

/** Short stable identifier for a project root — used in tmpdir/pipe names. */
export function projectHash(projectRoot: string): string {
  return crypto.createHash('sha256').update(path.resolve(projectRoot)).digest('hex').slice(0, 16);
}

/**
 * The deterministic tmpdir socket path for `projectRoot` — the fallback used
 * when the in-project location can't host a socket (too long, or an FS that
 * doesn't support AF_UNIX). Hash keeps it project-scoped, and being purely a
 * function of the root means the daemon and the proxy compute the identical
 * path without talking to each other.
 */
function tmpdirSocketPath(projectRoot: string): string {
  const identity = process.getuid?.() ?? projectHash(fs.realpathSync.native(os.homedir()));
  return path.join(
    os.tmpdir(),
    `codegraph-${identity}`,
    `codegraph-${projectHash(projectRoot)}.sock`,
  );
}

/**
 * Create and validate the private parent used by the shared-tmp socket
 * fallback. In-project sockets already live under the validated lock directory.
 */
export function ensureDaemonSocketDirectory(projectRoot: string, socketPath: string): void {
  if (process.platform === 'win32' || socketPath !== tmpdirSocketPath(projectRoot)) return;
  const dir = path.dirname(socketPath);
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  let stat = fs.lstatSync(dir);
  const uid = process.getuid?.();
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (uid !== undefined && stat.uid !== uid)
  ) throw new Error('daemon socket directory is not an owner-controlled regular directory');
  if ((stat.mode & 0o077) !== 0) {
    fs.chmodSync(dir, 0o700);
    stat = fs.lstatSync(dir);
    if ((stat.mode & 0o077) !== 0) {
      throw new Error('daemon socket directory is not owner-only');
    }
  }
  const realTmp = fs.realpathSync.native(os.tmpdir());
  const realDir = fs.realpathSync.native(dir);
  if (realDir !== path.join(realTmp, path.basename(dir))) {
    throw new Error('daemon socket directory escaped the system temporary directory');
  }
}

/**
 * Ordered socket / named-pipe path candidates the daemon should try to bind for
 * `projectRoot`, most-preferred first. Clients validate the selected candidate
 * through {@link readTrustedDaemonLock}.
 * Deterministic given a project root on POSIX. Windows adds the authenticated
 * daemon instance id so another local user cannot pre-plant the endpoint.
 *
 *   - Windows: a single named pipe (lives in the kernel pipe namespace, not on
 *     the project FS, so neither the length nor the ExFAT hazard applies).
 *   - Short in-project path: `[ .codegraph/daemon.sock , <tmpdir> ]` — try the
 *     project first, fall back to tmpdir if its FS can't host a socket (#997).
 *   - Long in-project path (deep monorepos, Bazel out dirs): `[ <tmpdir> ]` only
 *     — bind would throw ENAMETOOLONG, so we skip straight to tmpdir.
 */
export function getDaemonSocketCandidates(projectRoot: string, instanceId?: string): string[] {
  if (process.platform === 'win32') {
    const suffix = isValidDaemonInstanceId(instanceId) ? `-${instanceId}` : '';
    return [`\\\\.\\pipe\\codegraph-${projectHash(projectRoot)}${suffix}`];
  }
  const inProject = path.join(getCodeGraphDir(projectRoot), 'daemon.sock');
  const tmp = tmpdirSocketPath(projectRoot);
  if (inProject.length > POSIX_SOCKET_PATH_LIMIT) return [tmp];
  return [inProject, tmp];
}

/**
 * The PREFERRED (primary) socket path — candidate 0. Use this only where a
 * single representative path is wanted (the initial lockfile
 * `socketPath` field, status display). For binding, walk the full candidate
 * list; clients use the authenticated, post-bind path from the lockfile.
 */
export function getDaemonSocketPath(projectRoot: string, instanceId?: string): string {
  // The candidate list is never empty (≥1 on every platform), so [0] is safe.
  return getDaemonSocketCandidates(projectRoot, instanceId)[0]!;
}

/**
 * Directory containing the authoritative daemon lock. On Windows this lives
 * beneath the real current-user profile instead of the possibly shared project.
 */
export function getDaemonLockDirectory(projectRoot: string): string {
  if (process.platform !== 'win32') return getCodeGraphDir(projectRoot);
  return path.join(fs.realpathSync.native(os.homedir()), '.codegraph', 'daemon-locks');
}

function pathIsWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isTrustedWindowsLockDirectory(dir: string): boolean {
  try {
    const home = fs.realpathSync.native(os.homedir());
    if (!pathIsWithin(home, dir)) return false;
    let current = home;
    for (const part of path.relative(home, dir).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    }
    const realDir = fs.realpathSync.native(dir);
    return pathIsWithin(home, realDir) &&
      path.resolve(realDir).toLowerCase() === path.resolve(dir).toLowerCase();
  } catch {
    return false;
  }
}

function isTrustedPosixLockDirectory(dir: string): boolean {
  try {
    const stat = fs.lstatSync(dir);
    const uid = process.getuid?.();
    const realParent = fs.realpathSync.native(path.dirname(dir));
    return stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (uid === undefined || stat.uid === uid) &&
      (stat.mode & 0o022) === 0 &&
      fs.realpathSync.native(dir) === path.join(realParent, path.basename(dir));
  } catch {
    return false;
  }
}

/** Whether the existing directory carrying daemon authority is trustworthy. */
export function daemonLockDirectoryIsTrusted(projectRoot: string): boolean {
  const dir = getDaemonLockDirectory(projectRoot);
  return process.platform === 'win32'
    ? isTrustedWindowsLockDirectory(dir)
    : isTrustedPosixLockDirectory(dir);
}

/** Create and validate the directory that carries daemon-election authority. */
export function ensureDaemonLockDirectory(projectRoot: string): string {
  const dir = getDaemonLockDirectory(projectRoot);
  if (process.platform !== 'win32') {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(dir);
    const uid = process.getuid?.();
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (uid !== undefined && stat.uid !== uid)
    ) throw new Error('daemon lock directory is not an owner-controlled regular directory');
    if ((stat.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
    if (!isTrustedPosixLockDirectory(dir)) {
      throw new Error('daemon lock directory is not an owner-controlled regular directory');
    }
    return dir;
  }
  const home = fs.realpathSync.native(os.homedir());
  let current = home;
  for (const part of path.relative(home, dir).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { fs.mkdirSync(current); } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Windows daemon lock directory is not a private regular directory');
    }
  }
  if (!isTrustedWindowsLockDirectory(dir)) {
    throw new Error('Windows daemon lock directory escaped the current-user profile');
  }
  return dir;
}

/** Absolute path to the authoritative daemon lockfile for `projectRoot`. */
export function getDaemonPidPath(projectRoot: string): string {
  if (process.platform === 'win32') {
    return path.join(getDaemonLockDirectory(projectRoot), `${projectHash(projectRoot)}.json`);
  }
  return path.join(getDaemonLockDirectory(projectRoot), 'daemon.pid');
}

/** Daemon output path, private to the current user on Windows shared checkouts. */
export function getDaemonLogPath(projectRoot: string): string {
  if (process.platform === 'win32') {
    return path.join(getDaemonLockDirectory(projectRoot), `${projectHash(projectRoot)}.log`);
  }
  return path.join(getCodeGraphDir(projectRoot), 'daemon.log');
}

/**
 * Open the daemon log without following a project-controlled symlink or hard
 * link. The returned descriptor is the object inherited by the child, so later
 * pathname replacement cannot redirect output.
 */
export function openDaemonLog(projectRoot: string): number {
  const logPath = getDaemonLogPath(projectRoot);
  let before: fs.Stats | null = null;
  if (process.platform === 'win32') {
    ensureDaemonLockDirectory(projectRoot);
    try {
      before = fs.lstatSync(logPath);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
        throw new Error('daemon log is not a private regular file');
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  } else {
    ensureDaemonLockDirectory(projectRoot);
    try {
      before = fs.lstatSync(logPath);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
        throw new Error('daemon log is not a private regular file');
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW ?? 0);
  const nonBlock = process.platform === 'win32' ? 0 : (fs.constants.O_NONBLOCK ?? 0);
  const fd = fs.openSync(
    logPath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | noFollow | nonBlock,
    0o600,
  );
  try {
    const stat = fs.fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (before !== null && process.platform !== 'win32' && (before.dev !== stat.dev || before.ino !== stat.ino))
    ) throw new Error('daemon log is not a private regular file');
    if (process.platform !== 'win32') {
      const uid = process.getuid?.();
      if (uid !== undefined && stat.uid !== uid) throw new Error('daemon log has a different owner');
      if ((stat.mode & 0o077) !== 0) fs.fchmodSync(fd, 0o600);
    }
    return fd;
  } catch (err) {
    try { fs.closeSync(fd); } catch { /* preserve validation error */ }
    throw err;
  }
}

/** Structured contents of the pid lockfile. */
export interface DaemonLockInfo {
  pid: number;
  /** Kernel process-start fingerprint paired with pid to defeat PID reuse. */
  processBirthId?: string;
  /** Marks daemons whose lifetime is protected by the SQLite election lease. */
  electionProtocol?: 1;
  version: string;
  socketPath: string;
  startedAt: number;
  /** Random identity for this exact daemon lifetime. Absent on legacy locks. */
  instanceId?: string;
  /** HMAC key for mutual daemon/client authentication. Absent on legacy locks. */
  authSecret?: string;
}

/** A cryptographically strong daemon-instance identity encoded as a UUID. */
export function isValidDaemonInstanceId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Serialize a {@link DaemonLockInfo} for writing to the pidfile. JSON for
 * human readability — operators occasionally `cat` this when debugging.
 */
export function encodeLockInfo(info: DaemonLockInfo): string {
  return JSON.stringify(info, null, 2) + '\n';
}

/**
 * Parse a pidfile body. Tolerant of old-format pidfiles (plain decimal pid) so
 * a 0.10.x daemon doesn't trip over a 0.9.x lockfile if that ever happens —
 * we treat such a lockfile as "process is unknown version, refuse to share."
 */
export function decodeLockInfo(raw: string): DaemonLockInfo | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed.pid === 'number' &&
      typeof parsed.version === 'string' &&
      typeof parsed.socketPath === 'string' &&
      typeof parsed.startedAt === 'number'
    ) {
      return parsed as DaemonLockInfo;
    }
    return null;
  } catch {
    // Fall through to legacy plain-pid handling.
  }
  const pid = Number(trimmed);
  if (Number.isFinite(pid) && pid > 0) {
    return { pid, version: 'unknown', socketPath: '', startedAt: 0 };
  }
  return null;
}

export type DaemonLockFileRead =
  | { state: 'missing' }
  | {
      state: 'invalid';
      identity?: { dev: number; ino: number };
      storage?: 'file' | 'directory';
    }
  | {
      state: 'ok';
      info: DaemonLockInfo;
      mode: number;
      identity: { dev: number; ino: number };
      storage: 'file' | 'directory';
    };

/** Resolve the record location after the canonical lock representation is trusted. */
export function getDaemonLockRecordPath(pidPath: string): string {
  try {
    const named = fs.lstatSync(pidPath);
    if (named.isDirectory() && !named.isSymbolicLink()) {
      return path.join(pidPath, DAEMON_LOCK_RECORD_NAME);
    }
  } catch { /* absent canonical path uses the regular-file location */ }
  return pidPath;
}

function readDaemonLockRecord(
  recordPath: string,
  storage: 'file' | 'directory',
): DaemonLockFileRead {
  let fd: number | null = null;
  try {
    const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW ?? 0);
    const nonBlock = process.platform === 'win32' ? 0 : (fs.constants.O_NONBLOCK ?? 0);
    fd = fs.openSync(recordPath, fs.constants.O_RDONLY | noFollow | nonBlock, 0o600);
    const stat = fs.fstatSync(fd);
    const named = fs.lstatSync(recordPath);
    const uid = process.getuid?.();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > MAX_DAEMON_LOCK_BYTES ||
      (uid !== undefined && stat.uid !== uid) ||
      !named.isFile() ||
      named.isSymbolicLink() ||
      named.nlink !== 1 ||
      named.dev !== stat.dev ||
      named.ino !== stat.ino
    ) return { state: 'invalid', storage };
    const identity = { dev: stat.dev, ino: stat.ino };
    const bytes = Buffer.allocUnsafe(MAX_DAEMON_LOCK_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > MAX_DAEMON_LOCK_BYTES) return { state: 'invalid', identity, storage };
    const info = decodeLockInfo(bytes.toString('utf8', 0, length));
    return info
      ? { state: 'ok', info, mode: stat.mode, identity, storage }
      : { state: 'invalid', identity, storage };
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT'
      ? { state: 'missing' }
      : { state: 'invalid', storage };
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

/**
 * Read any daemon-lock generation without following links, blocking on special
 * files, or retaining an unbounded payload. This is the raw lifecycle reader;
 * callers that use a lock as an authentication anchor must additionally apply
 * {@link readTrustedDaemonLock} validation.
 */
export function readDaemonLockFile(pidPath: string): DaemonLockFileRead {
  try {
    const named = fs.lstatSync(pidPath);
    const uid = process.getuid?.();
    if (named.isDirectory() && !named.isSymbolicLink()) {
      if (
        (uid !== undefined && named.uid !== uid) ||
        (process.platform !== 'win32' && (named.mode & 0o077) !== 0)
      ) return { state: 'invalid', storage: 'directory' };
      const read = readDaemonLockRecord(
        path.join(pidPath, DAEMON_LOCK_RECORD_NAME),
        'directory',
      );
      if (read.state === 'missing') return { state: 'invalid', storage: 'directory' };
      const after = fs.lstatSync(pidPath);
      if (
        !after.isDirectory() ||
        after.isSymbolicLink() ||
        after.dev !== named.dev ||
        after.ino !== named.ino
      ) return { state: 'invalid', storage: 'directory' };
      return read;
    }
    return readDaemonLockRecord(pidPath, 'file');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT'
      ? { state: 'missing' }
      : { state: 'invalid' };
  }
}

function daemonLockInfoMatches(a: DaemonLockInfo, b: DaemonLockInfo): boolean {
  return a.pid === b.pid &&
    a.processBirthId === b.processBirthId &&
    a.electionProtocol === b.electionProtocol &&
    a.version === b.version &&
    a.socketPath === b.socketPath &&
    a.startedAt === b.startedAt &&
    a.instanceId === b.instanceId &&
    a.authSecret === b.authSecret;
}

function daemonLockDirectoryIsSafe(pidPath: string): boolean {
  try {
    const stat = fs.lstatSync(pidPath);
    const uid = process.getuid?.();
    return stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (uid === undefined || stat.uid === uid) &&
      (process.platform === 'win32' || (stat.mode & 0o077) === 0);
  } catch {
    return false;
  }
}

function boundedDaemonLockDirectoryEntries(pidPath: string): string[] | null {
  let directory: fs.Dir | null = null;
  try {
    directory = fs.opendirSync(pidPath);
    const entries: string[] = [];
    for (;;) {
      const entry = directory.readSync();
      if (!entry) return entries;
      entries.push(entry.name);
      if (entries.length > 1) return null;
    }
  } catch {
    return null;
  } finally {
    if (directory) {
      try { directory.closeSync(); } catch { /* best-effort */ }
    }
  }
}

function removeDaemonLockDirectory(
  pidPath: string,
  expected: { pid: number; processBirthId?: string } | undefined,
  allowIncomplete: boolean,
): boolean {
  if (!daemonLockDirectoryIsSafe(pidPath)) return false;
  const entries = boundedDaemonLockDirectoryEntries(pidPath);
  if (entries === null) return false;
  if (entries.length === 0) {
    if (!allowIncomplete) return false;
  } else {
    if (entries[0] !== DAEMON_LOCK_RECORD_NAME) return false;
    const read = readDaemonLockFile(pidPath);
    if (read.state === 'ok') {
      if (read.storage !== 'directory' || read.info.electionProtocol !== 1) return false;
      if (expected !== undefined && read.info.pid !== expected.pid) return false;
      if (
        expected?.processBirthId !== undefined &&
        read.info.processBirthId !== expected.processBirthId
      ) return false;
    } else {
      if (!allowIncomplete) return false;
      try {
        const record = fs.lstatSync(path.join(pidPath, DAEMON_LOCK_RECORD_NAME));
        const uid = process.getuid?.();
        if (
          !record.isFile() ||
          record.isSymbolicLink() ||
          record.nlink !== 1 ||
          (uid !== undefined && record.uid !== uid)
        ) return false;
      } catch {
        return false;
      }
    }
    try { fs.unlinkSync(path.join(pidPath, DAEMON_LOCK_RECORD_NAME)); }
    catch { return false; }
  }
  try {
    fs.rmdirSync(pidPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recover an incomplete hard-link-free lock directory only under the SQLite
 * election lease. The directory representation prevents legacy file publishers
 * from replacing the failed generation while it is inspected and removed.
 */
export function recoverDaemonLockDirectory(pidPath: string, leaseProvesStale = false): boolean {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(pidPath); }
  catch (err) { return (err as NodeJS.ErrnoException).code === 'ENOENT'; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return true;
  if (readDaemonLockFile(pidPath).state === 'ok') return true;
  return leaseProvesStale && removeDaemonLockDirectory(pidPath, undefined, true);
}

function restoreQuarantinedDaemonLock(quarantinePath: string, pidPath: string): boolean {
  try {
    fs.linkSync(quarantinePath, pidPath);
    fs.unlinkSync(quarantinePath);
    return true;
  } catch {
    return false;
  }
}

/** Bound synchronous recovery even if an owner-controlled directory is huge. */
const LOCK_QUARANTINE_RECOVERY_BUDGET_MS = 1_000;

/**
 * Recover a lock moved aside by stale cleanup that crashed before restoration
 * or deletion. A missing canonical path is never considered acquirable while
 * an unresolved quarantine remains.
 */
export function recoverDaemonLockQuarantines(
  pidPath: string,
  leaseProvesStale = false,
): boolean {
  const dir = path.dirname(pidPath);
  const prefix = `${path.basename(pidPath)}.quarantine-`;
  let canonical: fs.Stats | null = null;
  try { canonical = fs.lstatSync(pidPath); } catch { /* missing or untrusted */ }
  let directory: fs.Dir | null = null;
  try { directory = fs.opendirSync(dir); }
  catch (err) { return (err as NodeJS.ErrnoException).code === 'ENOENT'; }
  const deadline = performance.now() + LOCK_QUARANTINE_RECOVERY_BUDGET_MS;
  let unresolved = false;
  try {
    for (;;) {
      if (performance.now() > deadline) return canonical !== null;
      const entry = directory.readSync();
      if (!entry) break;
      if (!entry.name.startsWith(prefix)) continue;
      const quarantine = path.join(dir, entry.name);
      if (canonical) {
        // Complete a hard-link restoration that crashed between link and unlink.
        try {
          const moved = fs.lstatSync(quarantine);
          if (
            canonical.isFile() && !canonical.isSymbolicLink() && canonical.nlink === 2 &&
            moved.isFile() && !moved.isSymbolicLink() && moved.nlink === 2 &&
            canonical.dev === moved.dev && canonical.ino === moved.ino
          ) fs.unlinkSync(quarantine);
        } catch { /* preserve unresolved quarantine */ }
        continue;
      }

      const read = readDaemonLockFile(quarantine);
      if (read.state !== 'ok') {
        unresolved = true;
        continue;
      }
      if (leaseProvesStale && read.info.electionProtocol === 1) {
        // The held SQLite lease proves every abandoned new-protocol generation
        // is stale. Drain all of them in this bounded pass so they do not each
        // consume a separate daemon-takeover retry.
        try { fs.unlinkSync(quarantine); }
        catch { unresolved = true; }
        continue;
      }
      if (restoreQuarantinedDaemonLock(quarantine, pidPath)) return true;
      try {
        if (fs.lstatSync(pidPath)) return true;
      } catch { /* still absent */ }
      unresolved = true;
    }
    return canonical !== null || !unresolved;
  } finally {
    try { directory.closeSync(); } catch { /* best-effort */ }
  }
}

/**
 * Remove a stale daemon pidfile after its ownership is proven stale. A
 * new-protocol generation requires its election lease. A complete legacy file
 * may instead be removed when the caller has definitively disproved its process
 * identity. The canonical path is atomically moved to a unique quarantine
 * before validation; incomplete generations always fail closed.
 */
export function clearStaleDaemonLock(
  pidPath: string,
  expected?: number | { pid: number; processBirthId?: string },
  leaseProvesStale = false,
  processIdentityProvesStale = false,
): boolean {
  const quarantinePath = `${pidPath}.quarantine-${process.pid}-${crypto.randomUUID()}`;
  const restoreProbePath = `${pidPath}.restore-probe-${process.pid}-${crypto.randomUUID()}`;
  let quarantined = false;
  try {
    const read = readDaemonLockFile(pidPath);
    if (read.state === 'missing') {
      return recoverDaemonLockQuarantines(pidPath, leaseProvesStale);
    }
    if (read.state === 'invalid' && read.storage === 'directory') {
      return leaseProvesStale && removeDaemonLockDirectory(pidPath, undefined, true);
    }
    if (read.state !== 'ok') return false;
    const info = read.info;
    const expectedIdentity = typeof expected === 'number' ? { pid: expected } : expected;
    const electionOwnsGeneration = leaseProvesStale && info.electionProtocol === 1;
    const deadLegacyFile = processIdentityProvesStale &&
      expectedIdentity !== undefined &&
      info.electionProtocol !== 1 &&
      read.storage === 'file';
    if (!electionOwnsGeneration && !deadLegacyFile) return false;
    if (expectedIdentity !== undefined && info.pid !== expectedIdentity.pid) return false;
    if (
      expectedIdentity?.processBirthId !== undefined &&
      info.processBirthId !== expectedIdentity.processBirthId
    ) return false;
    if (read.storage === 'directory') {
      return removeDaemonLockDirectory(pidPath, expectedIdentity, false);
    }
    // Quarantine is only safe when the same filesystem can atomically restore
    // the exact moved inode without overwriting a newer canonical publisher.
    try {
      fs.linkSync(pidPath, restoreProbePath);
      fs.unlinkSync(restoreProbePath);
    } catch {
      return false;
    }
    fs.renameSync(pidPath, quarantinePath);
    quarantined = true;
    const moved = readDaemonLockFile(quarantinePath);
    if (
      moved.state !== 'ok' ||
      moved.identity.dev !== read.identity.dev ||
      moved.identity.ino !== read.identity.ino ||
      !daemonLockInfoMatches(moved.info, info)
    ) {
      restoreQuarantinedDaemonLock(quarantinePath, pidPath);
      quarantined = fs.existsSync(quarantinePath);
      return false;
    }
    fs.unlinkSync(quarantinePath);
    quarantined = false;
    return true;
  } catch (err: unknown) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT'
      ? recoverDaemonLockQuarantines(pidPath, leaseProvesStale)
      : false;
  } finally {
    try { fs.unlinkSync(restoreProbePath); } catch { /* absent or best-effort */ }
    if (quarantined) restoreQuarantinedDaemonLock(quarantinePath, pidPath);
  }
}

/**
 * Read the authoritative lock only when it is safe to use as an IPC trust
 * anchor. Its record must be an owner-only regular file owned by this user on
 * POSIX, contain a live-instance token, and point at one of this root's socket
 * candidates. Legacy locks remain readable through {@link decodeLockInfo} for
 * stale cleanup and diagnostics, but cannot authenticate a connection or stop.
 */
export function readTrustedDaemonLock(projectRoot: string): DaemonLockInfo | null {
  const pidPath = getDaemonPidPath(projectRoot);
  try {
    if (!daemonLockDirectoryIsTrusted(projectRoot)) return null;
    const read = readDaemonLockFile(pidPath);
    if (read.state !== 'ok') return null;
    if (process.platform !== 'win32') {
      if ((read.mode & 0o077) !== 0) return null;
    }
    const info = read.info;
    if (!info || !Number.isSafeInteger(info.pid) || info.pid <= 1) return null;
    if (info.processBirthId !== undefined && !isValidProcessBirthId(info.processBirthId)) return null;
    if (info.electionProtocol !== undefined && info.electionProtocol !== 1) return null;
    if (!isValidDaemonInstanceId(info.instanceId)) return null;
    if (!isValidDaemonAuthSecret(info.authSecret)) return null;
    if (!getDaemonSocketCandidates(projectRoot, info.instanceId).includes(info.socketPath)) return null;
    return info;
  } catch {
    return null;
  }
}

/**
 * Remove only a daemon-owned POSIX socket at one of this project's known
 * rendezvous paths. Regular files, symlinks, foreign-owned sockets, and paths
 * below an untrusted project data directory are preserved so cleanup cannot be
 * redirected into deleting repository-controlled content.
 */
export function removeOwnedDaemonSocket(projectRoot: string, socketPath: string): boolean {
  if (process.platform === 'win32') return false;
  if (!getDaemonSocketCandidates(projectRoot).includes(socketPath)) return false;
  if (
    path.dirname(socketPath) === getCodeGraphDir(projectRoot) &&
    !daemonLockDirectoryIsTrusted(projectRoot)
  ) return false;

  try {
    const stat = fs.lstatSync(socketPath);
    const uid = process.getuid?.();
    if (
      !stat.isSocket() ||
      stat.isSymbolicLink() ||
      (uid !== undefined && stat.uid !== uid)
    ) return false;
    fs.unlinkSync(socketPath);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT';
  }
}
