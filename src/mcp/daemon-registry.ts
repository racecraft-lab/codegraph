/**
 * Global daemon registry + stop/list control — the discovery layer behind
 * `codegraph list` and `codegraph stop [--all]`.
 *
 * Every per-project daemon already writes an authoritative owner-only lock
 * (under the project on POSIX and the user profile on Windows). That's enough
 * to stop ONE daemon you can name, but there's no central place to find them
 * ALL — which `list` and `stop --all` need. So each daemon also drops a tiny
 * record under `~/.codegraph/daemons/` on start and removes it on shutdown.
 *
 * The registry is a DISCOVERY index, never a source of truth: the protected
 * lock's full instance identity is. A SIGKILL'd daemon can't remove its own
 * record, so readers prune records that no longer match a live trusted lock.
 * Every registry operation is best-effort; a hiccup must never break a daemon.
 *
 * Cross-platform by construction: stopping uses the daemon's authenticated
 * JSON-RPC control channel. PID probes are liveness hints only and never signal
 * a process, so stale PID reuse cannot terminate an unrelated process.
 */
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  DAEMON_HANDSHAKE_PROTOCOL,
  createDaemonAuthNonce,
  createDaemonClientProof,
  createDaemonServerProof,
  daemonProofMatches,
  isValidDaemonAuthNonce,
  isValidDaemonAuthProof,
  isValidDaemonAuthSecret,
} from './daemon-auth';
import {
  clearStaleDaemonLock,
  daemonLockDirectoryIsTrusted,
  getDaemonPidPath,
  readDaemonLockFile,
  readTrustedDaemonLock,
  type DaemonLockInfo,
} from './daemon-paths';
import { daemonElectionIsHeld, tryAcquireDaemonElectionGuard } from './daemon-election';
import { isDaemonProcessAlive, isProcessAlive } from './daemon-process';
import { isShareableCodeGraphVersion } from './version';
export { isProcessAlive } from './daemon-process';

export interface DaemonRecord {
  /** Realpath'd project root the daemon serves. */
  root: string;
  pid: number;
  /** Kernel process-start fingerprint paired with pid to defeat PID reuse. */
  processBirthId?: string;
  /** Marks daemons whose lifetime is protected by the SQLite election lease. */
  electionProtocol?: 1;
  version: string;
  socketPath: string;
  /** Epoch ms when the daemon bound its socket. */
  startedAt: number;
  /** Random identity for this exact daemon lifetime. */
  instanceId?: string;
}

export const MAX_DAEMON_REGISTRY_RECORD_BYTES = 64 * 1024;

/**
 * `~/.codegraph/daemons` — GLOBAL, keyed off the home install dir. (The
 * `CODEGRAPH_DIR` env var only renames the per-project index dir, not this.)
 */
export function getRegistryDir(): string {
  return path.join(fs.realpathSync.native(os.homedir()), '.codegraph', 'daemons');
}

function recordPath(root: string): string {
  const hash = crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);
  return path.join(getRegistryDir(), `${hash}.json`);
}

function ensureRegistryDir(): string {
  const dir = getRegistryDir();
  const home = fs.realpathSync.native(os.homedir());
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
      (process.platform !== 'win32' && uid !== undefined && stat.uid !== uid)
    ) throw new Error('daemon registry directory is not owner-controlled');
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fs.chmodSync(current, 0o700);
  }
  if (!registryDirectoryIsTrusted()) {
    throw new Error('daemon registry directory is not owner-controlled');
  }
  return dir;
}

function registryDirectoryIsTrusted(): boolean {
  try {
    const home = fs.realpathSync.native(os.homedir());
    const dir = path.join(home, '.codegraph', 'daemons');
    let current = home;
    for (const part of path.relative(home, dir).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const stat = fs.lstatSync(current);
      const uid = process.getuid?.();
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (process.platform !== 'win32' && uid !== undefined && stat.uid !== uid) ||
        (process.platform !== 'win32' && (stat.mode & 0o022) !== 0)
      ) return false;
    }
    const actual = fs.realpathSync.native(dir);
    return process.platform === 'win32'
      ? path.resolve(actual).toLowerCase() === path.resolve(dir).toLowerCase()
      : actual === dir;
  } catch {
    return false;
  }
}

/** Read one small owner-only regular record without following or blocking on it. */
function readRegistryRecordFile(filePath: string): DaemonRecord | null {
  let fd: number | null = null;
  try {
    if (path.dirname(filePath) !== getRegistryDir() || !registryDirectoryIsTrusted()) return null;
    const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW ?? 0);
    const nonBlock = process.platform === 'win32' ? 0 : (fs.constants.O_NONBLOCK ?? 0);
    // The mode is a semantic no-op for a read-only open, but makes the
    // owner-only contract explicit to static file-open analysis.
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow | nonBlock, 0o600);
    const stat = fs.fstatSync(fd);
    const named = fs.lstatSync(filePath);
    const uid = process.getuid?.();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > MAX_DAEMON_REGISTRY_RECORD_BYTES ||
      !named.isFile() ||
      named.isSymbolicLink() ||
      named.nlink !== 1 ||
      named.dev !== stat.dev ||
      named.ino !== stat.ino ||
      (process.platform !== 'win32' && uid !== undefined && stat.uid !== uid) ||
      (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
    ) return null;
    const bytes = Buffer.allocUnsafe(MAX_DAEMON_REGISTRY_RECORD_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > MAX_DAEMON_REGISTRY_RECORD_BYTES) return null;
    return JSON.parse(bytes.toString('utf8', 0, length)) as DaemonRecord;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

interface QuarantinedRecord {
  path: string;
  record: DaemonRecord | null;
}

/** Atomically move the current record out of the discovery namespace. */
function quarantineRecord(root: string): QuarantinedRecord | null {
  if (!registryDirectoryIsTrusted()) return null;
  const target = recordPath(root);
  const quarantine = `${target}.quarantine-${process.pid}-${crypto.randomUUID()}`;
  try { fs.renameSync(target, quarantine); } catch { return null; }
  const record = readRegistryRecordFile(quarantine);
  if (!record) {
    try { fs.unlinkSync(quarantine); } catch { /* gone */ }
    return null;
  }
  return { path: quarantine, record };
}

/** Remove an invalid discovery entry without deleting a valid raced replacement. */
function pruneUntrustedRegistryFile(filePath: string): void {
  if (path.dirname(filePath) !== getRegistryDir() || !registryDirectoryIsTrusted()) return;
  const dir = path.dirname(filePath);
  const file = path.basename(filePath);
  repairCanonicalHardLinkRestore(dir, file);
  const recovered = readRegistryRecordFile(filePath);
  if (
    recovered &&
    typeof recovered.root === 'string' &&
    filePath === recordPath(recovered.root)
  ) return;
  const quarantine = `${filePath}.quarantine-${process.pid}-${crypto.randomUUID()}`;
  try { fs.renameSync(filePath, quarantine); } catch { return; }
  const record = readRegistryRecordFile(quarantine);
  if (record && typeof record.root === 'string' && filePath === recordPath(record.root)) {
    restoreQuarantinedRecord(record.root, { path: quarantine, record });
    return;
  }
  try { fs.unlinkSync(quarantine); } catch { /* gone */ }
}

/** Restore a quarantined replacement only when no newer writer won the path. */
function restoreQuarantinedRecord(root: string, moved: QuarantinedRecord): void {
  if (!registryDirectoryIsTrusted()) return;
  const target = recordPath(root);
  let safeToRemoveQuarantine = false;
  try {
    fs.linkSync(moved.path, target);
    safeToRemoveQuarantine = true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      const current = readRegistryRecordFile(target);
      // Only a validated complete record can supersede the quarantine. An
      // incomplete copy target remains fail-closed for later recovery.
      safeToRemoveQuarantine = !!current &&
        typeof current.root === 'string' &&
        recordPath(current.root) === target;
    }
  }
  if (safeToRemoveQuarantine) {
    try { fs.unlinkSync(moved.path); } catch { /* gone */ }
  }
}

/** Finish a hard-link restore that crashed after linkSync() but before unlinkSync(). */
function repairInterruptedHardLinkRestore(dir: string, file: string): boolean {
  const match = /^([0-9a-f]{16}\.json)\.quarantine-.+$/.exec(file);
  if (!match) return false;
  const target = path.join(dir, match[1]!);
  const quarantine = path.join(dir, file);
  try {
    const targetStat = fs.lstatSync(target);
    const quarantineStat = fs.lstatSync(quarantine);
    const uid = process.getuid?.();
    if (
      !targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.nlink !== 2 ||
      !quarantineStat.isFile() || quarantineStat.isSymbolicLink() || quarantineStat.nlink !== 2 ||
      targetStat.dev !== quarantineStat.dev || targetStat.ino !== quarantineStat.ino ||
      targetStat.size > MAX_DAEMON_REGISTRY_RECORD_BYTES ||
      (process.platform !== 'win32' && uid !== undefined && targetStat.uid !== uid) ||
      (process.platform !== 'win32' && (targetStat.mode & 0o077) !== 0)
    ) return false;
    fs.unlinkSync(quarantine);
    return true;
  } catch {
    return false;
  }
}

/** Finish a trusted two-link restore before a canonical reader can prune it. */
function repairCanonicalHardLinkRestore(dir: string, file: string): boolean {
  if (!/^[0-9a-f]{16}\.json$/.test(file)) return false;
  let candidates: string[];
  try {
    candidates = fs.readdirSync(dir).filter((candidate) =>
      candidate.startsWith(`${file}.quarantine-`),
    );
  } catch {
    return false;
  }
  return candidates.some((candidate) => repairInterruptedHardLinkRestore(dir, candidate));
}

/** Recover a record moved aside by a reader that crashed mid-prune. */
function recoverQuarantinedRecords(dir: string, pruneInvalid: boolean): void {
  if (!registryDirectoryIsTrusted()) return;
  let files: string[];
  try { files = fs.readdirSync(dir).filter((file) => file.includes('.json.quarantine-')); }
  catch { return; }
  for (const file of files) {
    if (repairInterruptedHardLinkRestore(dir, file)) continue;
    const quarantine = path.join(dir, file);
    try {
      const record = readRegistryRecordFile(quarantine);
      if (!record || typeof record.root !== 'string') {
        if (pruneInvalid) {
          try { fs.unlinkSync(quarantine); } catch { /* gone */ }
        }
        continue;
      }
      const target = recordPath(record.root);
      if (!quarantine.startsWith(`${target}.quarantine-`)) {
        if (pruneInvalid) {
          try { fs.unlinkSync(quarantine); } catch { /* gone */ }
        }
        continue;
      }
      restoreQuarantinedRecord(record.root, { path: quarantine, record });
    } catch { /* best-effort recovery */ }
  }
}

/** Best-effort: record this daemon so `list`/`stop --all` can find it. */
export function registerDaemon(rec: DaemonRecord): void {
  let tmp: string | null = null;
  try {
    ensureRegistryDir();
    const target = recordPath(rec.root);
    tmp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, target);
    tmp = null;
  } catch {
    /* best-effort — list's liveness prune tolerates a missing record */
  } finally {
    if (tmp) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  }
}

/** Best-effort: drop this daemon's record on graceful shutdown. */
export function deregisterDaemon(root: string, expectedPid?: number, expectedInstanceId?: string): void {
  if (!registryDirectoryIsTrusted()) return;
  let moved: QuarantinedRecord | null = null;
  try {
    moved = quarantineRecord(root);
    if (!moved) return;
    if (expectedPid !== undefined) {
      const record = moved.record;
      if (
        !record ||
        record.pid !== expectedPid ||
        (expectedInstanceId !== undefined && record.instanceId !== expectedInstanceId)
      ) {
        restoreQuarantinedRecord(root, moved);
        moved = null;
        return;
      }
    }
  } catch {
    /* already gone */
  } finally {
    if (moved) {
      try { fs.unlinkSync(moved.path); } catch { /* gone */ }
    }
  }
}

function sameRecordIdentity(a: DaemonRecord | null, b: DaemonRecord | null): boolean {
  return !!a && !!b &&
    path.resolve(a.root) === path.resolve(b.root) &&
    a.pid === b.pid &&
    a.processBirthId === b.processBirthId &&
    a.electionProtocol === b.electionProtocol &&
    a.instanceId === b.instanceId;
}

function lockMatchesRecord(lock: DaemonLockInfo | null, rec: DaemonRecord | null): boolean {
  return !!lock && !!rec &&
    Number.isSafeInteger(rec.pid) && rec.pid > 1 &&
    typeof rec.instanceId === 'string' &&
    typeof rec.version === 'string' &&
    typeof rec.socketPath === 'string' &&
    typeof rec.startedAt === 'number' &&
    (rec.electionProtocol === undefined || rec.electionProtocol === 1) &&
    lock.pid === rec.pid &&
    lock.processBirthId === rec.processBirthId &&
    lock.electionProtocol === rec.electionProtocol &&
    lock.instanceId === rec.instanceId &&
    lock.version === rec.version &&
    lock.socketPath === rec.socketPath;
}

function daemonIdentityIsLive(root: string, info: DaemonLockInfo): boolean {
  return info.electionProtocol === 1
    ? daemonElectionIsHeld(root) && isDaemonProcessAlive(info)
    : isDaemonProcessAlive(info);
}

/**
 * All registered daemons whose process is still alive, newest first. Dead/garbage
 * records are deleted as a side effect (self-healing) unless `prune` is false.
 */
export function listDaemons(opts: { prune?: boolean } = {}): DaemonRecord[] {
  const prune = opts.prune ?? true;
  const dir = getRegistryDir();
  let files: string[];
  try {
    if (!registryDirectoryIsTrusted()) return [];
    recoverQuarantinedRecords(dir, prune);
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return []; // no registry dir yet
  }

  const live: DaemonRecord[] = [];
  for (const file of files) {
    const full = path.join(dir, file);
    let rec: DaemonRecord | null = null;
    rec = readRegistryRecordFile(full);
    if (!rec) {
      repairCanonicalHardLinkRestore(dir, file);
      rec = readRegistryRecordFile(full);
    }
    // Record contents are untrusted discovery data. A misplaced record must
    // never redirect liveness checks or mutation toward another root's
    // canonical registry entry.
    if (!rec || typeof rec.root !== 'string' || full !== recordPath(rec.root)) {
      if (prune) pruneUntrustedRegistryFile(full);
      continue;
    }
    let trusted: DaemonLockInfo | null = null;
    try {
      if (rec && typeof rec.root === 'string') trusted = readTrustedDaemonLock(rec.root);
    } catch { /* malformed or inaccessible root */ }
    if (lockMatchesRecord(trusted, rec) && daemonIdentityIsLive(rec!.root, trusted!)) {
      live.push(rec!);
    } else if (prune) {
      let moved: QuarantinedRecord | null = null;
      let recordRoot: string | null = null;
      try {
        recordRoot = rec.root;
        moved = quarantineRecord(recordRoot);
        if (!moved) continue;
        const current = moved.record;
        if (!sameRecordIdentity(current, rec)) continue;
        const currentLock = readTrustedDaemonLock(rec.root);
        if (lockMatchesRecord(currentLock, current) && daemonIdentityIsLive(rec.root, currentLock!)) continue;
        try { fs.unlinkSync(moved.path); } catch { /* gone */ }
        moved = null;
      } catch { /* best-effort prune */ }
      finally {
        if (moved && recordRoot) restoreQuarantinedRecord(recordRoot, moved);
      }
    }
  }
  return live.sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Remove a stopped daemon's artifacts without touching a replacement daemon.
 * Cleanup shares the daemon-election guard with startup, then compares the
 * authoritative lock and registry record against the pid we actually stopped.
 */
export async function cleanupDaemonArtifacts(
  root: string,
  expected: {
    pid: number;
    processBirthId?: string;
    electionProtocol?: 1;
    instanceId?: string;
    authSecret?: string;
  } | null,
): Promise<boolean> {
  const election = await tryAcquireDaemonElectionGuard(root);
  if (!election) return false;
  try {
    const lockDir = path.dirname(getDaemonPidPath(root));
    if (fs.existsSync(lockDir) && !daemonLockDirectoryIsTrusted(root)) return false;
    // A failed/denied control request must never turn into artifact deletion
    // for a process that is still alive under the pid we were asked to stop.
    let processIdentityProvesStale = false;
    if (expected !== null && expected.electionProtocol !== 1) {
      if (isDaemonProcessAlive(expected)) return false;
      processIdentityProvesStale = true;
    }
    const pidPath = getDaemonPidPath(root);
    const lockExists = fs.existsSync(pidPath);
    const lock = lockExists ? readTrustedDaemonLock(root) : null;

    // An incomplete/malformed lock has unknown ownership. A different lock is
    // a replacement (or another operator target). Preserve every artifact.
    if (
      (lockExists && !lock) ||
      (lock && (!expected || lock.pid !== expected.pid)) ||
      (lock && expected?.processBirthId !== undefined && lock.processBirthId !== expected.processBirthId) ||
      (lock && expected?.electionProtocol !== undefined && lock.electionProtocol !== expected.electionProtocol) ||
      (lock && expected?.instanceId !== undefined && lock.instanceId !== expected.instanceId) ||
      (lock && expected?.authSecret !== undefined && lock.authSecret !== expected.authSecret)
    ) return false;

    let record: DaemonRecord | null = null;
    record = readRegistryRecordFile(recordPath(root));
    if (
      record &&
      (!expected || record.pid !== expected.pid ||
        (expected.instanceId !== undefined && record.instanceId !== expected.instanceId)) &&
      record.electionProtocol !== 1 && isDaemonProcessAlive(record)
    ) return false;

    if (lock) {
      // Delete only the exact generation we validated. The election lease owns
      // new-protocol generations; legacy files additionally require the dead
      // process-identity proof above. The helper atomically quarantines and
      // revalidates, restoring any replacement that raced our cleanup.
      if (!clearStaleDaemonLock(pidPath, {
        pid: lock.pid,
        processBirthId: lock.processBirthId,
      }, true, processIdentityProvesStale)) return false;
    }
    // Socket paths are deterministic across legacy versions and cannot be
    // compare-deleted. Preserve them; a future bind either proves the node is
    // stale through its own guarded protocol or fails closed on EADDRINUSE.
    if (record) deregisterDaemon(root, record.pid, record.instanceId);
    return true;
  } finally {
    await election.release();
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function waitForInstanceRelease(
  root: string,
  instanceId: string,
  timeoutMs: number,
  pollMs = 100,
): Promise<boolean> {
  const releaseState = (): 'released' | 'held' | 'unknown' => {
    const read = readDaemonLockFile(getDaemonPidPath(root));
    if (read.state === 'missing') return 'released';
    // A malformed, unsafe, or incomplete record proves neither release nor replacement.
    if (read.state !== 'ok' || !read.info.instanceId) return 'unknown';
    return read.info.instanceId !== instanceId ? 'released' : 'held';
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (releaseState() === 'released') return true;
    await sleep(pollMs);
  }
  return releaseState() === 'released';
}

export interface StopResult {
  root: string;
  pid: number | null;
  /** 'term' authenticated graceful stop, 'failed' still live/untrusted. */
  outcome: 'term' | 'not-running' | 'no-daemon' | 'failed';
}

const CONTROL_TIMEOUT_MS = 3_000;
const CONTROL_LINE_LIMIT = 4_096;

/** Ask the exact lockfile-authenticated daemon instance to shut itself down. */
async function requestAuthenticatedShutdown(info: DaemonLockInfo): Promise<boolean> {
  if (
    !isShareableCodeGraphVersion(info.version) ||
    !info.instanceId ||
    !isValidDaemonAuthSecret(info.authSecret)
  ) return false;
  const instanceId = info.instanceId;
  const authSecret = info.authSecret;
  return new Promise<boolean>((resolve) => {
    let socket: net.Socket;
    try {
      socket = net.createConnection(info.socketPath);
    } catch {
      resolve(false);
      return;
    }
    socket.setEncoding('utf8');
    const requestId = `codegraph-stop:${crypto.randomUUID()}`;
    let phase: 'hello' | 'response' = 'hello';
    let buffer = '';
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    const onData = (chunk: string | Buffer): void => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (buffer.length > CONTROL_LINE_LIMIT) {
        finish(false);
        return;
      }
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message: Record<string, unknown>;
        try { message = JSON.parse(line) as Record<string, unknown>; } catch { finish(false); return; }
        if (phase === 'hello') {
          if (
            message.protocol !== DAEMON_HANDSHAKE_PROTOCOL ||
            message.codegraph !== info.version ||
            message.pid !== info.pid ||
            message.socketPath !== info.socketPath ||
            message.instanceId !== instanceId ||
            !isValidDaemonAuthNonce(message.nonce) ||
            !isValidDaemonAuthProof(message.proof)
          ) {
            finish(false);
            return;
          }
          const serverProof = createDaemonServerProof(authSecret, {
            codegraph: info.version,
            pid: info.pid,
            socketPath: info.socketPath,
            instanceId,
            nonce: message.nonce,
          });
          if (!daemonProofMatches(message.proof, serverProof)) {
            finish(false);
            return;
          }
          phase = 'response';
          const nonce = createDaemonAuthNonce();
          socket.write(JSON.stringify({
            codegraph_client: 1,
            pid: process.pid,
            hostPid: null,
            instanceId,
            nonce,
            proof: createDaemonClientProof(authSecret, {
              pid: process.pid,
              hostPid: null,
              instanceId,
              serverNonce: message.nonce,
              nonce,
            }),
          }) + '\n');
          socket.write(JSON.stringify({
            jsonrpc: '2.0',
            id: requestId,
            method: 'codegraph/shutdown',
          }) + '\n');
          continue;
        }
        const result = message.result as { stopping?: unknown } | undefined;
        finish(message.id === requestId && result?.stopping === true);
        return;
      }
    };
    const timer = setTimeout(() => finish(false), CONTROL_TIMEOUT_MS);
    timer.unref?.();
    socket.on('data', onData);
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
  });
}

/**
 * Stop the daemon serving `root` through its authenticated control channel.
 * PID liveness is diagnostic only: it is never used as authority to signal a
 * process because a stale PID may have been reused by an unrelated process.
 */
export async function stopDaemonAt(root: string): Promise<StopResult> {
  const initialTrusted = readTrustedDaemonLock(root);
  const parsedRead = readDaemonLockFile(getDaemonPidPath(root));
  const parsedLock: DaemonLockInfo | null = parsedRead.state === 'ok' ? parsedRead.info : null;
  let pid = parsedLock?.pid ?? null;
  if (pid == null) {
    const rec = listDaemons({ prune: false }).find(
      (r) => path.resolve(r.root) === path.resolve(root)
    );
    pid = rec?.pid ?? null;
  }

  if (pid == null) {
    await cleanupDaemonArtifacts(root, null);
    return { root, pid: null, outcome: 'no-daemon' };
  }
  if (parsedLock ? !daemonIdentityIsLive(root, parsedLock) : !isProcessAlive(pid)) {
    await cleanupDaemonArtifacts(root, parsedLock ? {
      pid,
      processBirthId: parsedLock.processBirthId,
      electionProtocol: parsedLock.electionProtocol,
      instanceId: parsedLock.instanceId,
      authSecret: parsedLock.authSecret,
    } : null);
    return { root, pid, outcome: 'not-running' };
  }

  if (!initialTrusted || initialTrusted.pid !== pid) return { root, pid, outcome: 'failed' };
  const trusted = readTrustedDaemonLock(root);
  if (
    !trusted ||
    trusted.pid !== initialTrusted.pid ||
    trusted.instanceId !== initialTrusted.instanceId ||
    trusted.authSecret !== initialTrusted.authSecret
  ) {
    return { root, pid, outcome: 'not-running' };
  }
  const accepted = await requestAuthenticatedShutdown(trusted);
  if (!accepted) {
    if (!daemonIdentityIsLive(root, trusted)) {
      await cleanupDaemonArtifacts(root, {
        pid,
        processBirthId: trusted.processBirthId,
        electionProtocol: trusted.electionProtocol,
        instanceId: trusted.instanceId,
        authSecret: trusted.authSecret,
      });
      return { root, pid, outcome: 'not-running' };
    }
    return { root, pid, outcome: 'failed' };
  }
  if (!(await waitForInstanceRelease(root, trusted.instanceId!, 5_000))) {
    if (!daemonIdentityIsLive(root, trusted)) await cleanupDaemonArtifacts(root, {
      pid,
      processBirthId: trusted.processBirthId,
      electionProtocol: trusted.electionProtocol,
      instanceId: trusted.instanceId,
      authSecret: trusted.authSecret,
    });
    return { root, pid, outcome: 'failed' };
  }
  return { root, pid, outcome: 'term' };
}

/** Stop every registered, live daemon. */
export async function stopAllDaemons(): Promise<StopResult[]> {
  const results: StopResult[] = [];
  for (const rec of listDaemons()) {
    results.push(await stopDaemonAt(rec.root));
  }
  return results;
}
