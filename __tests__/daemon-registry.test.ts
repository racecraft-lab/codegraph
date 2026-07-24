import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync, spawn } from 'child_process';
import * as net from 'net';
import { randomUUID } from 'node:crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import {
  getRegistryDir,
  MAX_DAEMON_REGISTRY_RECORD_BYTES,
  isProcessAlive,
  registerDaemon,
  deregisterDaemon,
  cleanupDaemonArtifacts,
  listDaemons,
  stopDaemonAt,
  waitForInstanceRelease,
  type DaemonRecord,
} from '../src/mcp/daemon-registry';
import {
  type DaemonLockInfo,
  encodeLockInfo,
  ensureDaemonLockDirectory,
  ensureDaemonSocketDirectory,
  getDaemonPidPath,
  getDaemonSocketCandidates,
} from '../src/mcp/daemon-paths';
import {
  DAEMON_HANDSHAKE_PROTOCOL,
  createDaemonAuthNonce,
  createDaemonAuthSecret,
  createDaemonClientProof,
  createDaemonServerProof,
  daemonProofMatches,
} from '../src/mcp/daemon-auth';
import { tryAcquireDaemonElectionGuard } from '../src/mcp/daemon-election';

const INSTANCE_ID = '00000000-0000-4000-8000-000000000001';
const AUTH_SECRET = 'ab'.repeat(32);

function writePrivateFile(filePath: string, contents: string): void {
  const fd = fs.openSync(filePath, 'wx', 0o600);
  try { fs.writeFileSync(fd, contents); } finally { fs.closeSync(fd); }
}

/** A pid that's guaranteed dead: spawn a trivial process, let it exit, reap it. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
  const pid = child.pid!;
  await new Promise<void>((r) => child.on('exit', () => r()));
  await new Promise((r) => setTimeout(r, 50)); // let the OS reap it
  return pid;
}

function rec(root: string, pid: number, startedAt = Date.now()): DaemonRecord {
  return {
    root,
    pid,
    version: '1.0.0',
    socketPath: getDaemonSocketCandidates(root, INSTANCE_ID)[0]!,
    startedAt,
    instanceId: INSTANCE_ID,
  };
}

function trustedLock(record: DaemonRecord, authSecret = AUTH_SECRET): DaemonLockInfo {
  return { ...record, authSecret };
}

function writeTrustedLock(record: DaemonRecord, authSecret = AUTH_SECRET): DaemonLockInfo {
  const lock = trustedLock(record, authSecret);
  ensureDaemonLockDirectory(record.root);
  fs.writeFileSync(getDaemonPidPath(record.root), encodeLockInfo(lock), { mode: 0o600 });
  return lock;
}

describe('daemon-registry', () => {
  let tmpHome: string;
  let projectsRoot: string;
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;

  beforeEach(() => {
    tmpHome = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cg-reg-home-')));
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpHome; // os.homedir() honors HOME (POSIX) ...
    process.env.USERPROFILE = tmpHome; // ... and USERPROFILE (Windows)
    projectsRoot = path.join(tmpHome, 'projects');
    fs.mkdirSync(projectsRoot, { recursive: true });
    // Sanity: the registry must resolve under our temp home, or the test would
    // pollute the real ~/.codegraph.
    expect(getRegistryDir().startsWith(tmpHome)).toBe(true);
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUserProfile;
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('isProcessAlive', () => {
    it('is true for our own process and false for junk/dead pids', async () => {
      expect(isProcessAlive(process.pid)).toBe(true);
      expect(isProcessAlive(0)).toBe(false);
      expect(isProcessAlive(-1)).toBe(false);
      expect(isProcessAlive(NaN)).toBe(false);
      expect(isProcessAlive(await deadPid())).toBe(false);
    });
  });

  it('listDaemons returns [] when nothing is registered (no dir yet)', () => {
    expect(listDaemons()).toEqual([]);
  });

  it.runIf(process.platform !== 'win32')('refuses a symlinked registry directory', () => {
    const external = path.join(tmpHome, 'external-registry');
    const codegraphDir = path.join(tmpHome, '.codegraph');
    fs.mkdirSync(external);
    fs.mkdirSync(codegraphDir);
    fs.symlinkSync(external, path.join(codegraphDir, 'daemons'), 'dir');
    const root = path.join(projectsRoot, 'symlinked-registry');
    const record = rec(root, process.pid);
    writeTrustedLock(record);

    registerDaemon(record);

    expect(listDaemons()).toEqual([]);
    expect(fs.readdirSync(external)).toEqual([]);
  });

  it.runIf(process.platform !== 'win32')('does not follow a symlinked registry record', () => {
    const root = path.join(projectsRoot, 'symlinked-record');
    const record = rec(root, process.pid);
    writeTrustedLock(record);
    registerDaemon(record);
    const recordFile = path.join(getRegistryDir(), fs.readdirSync(getRegistryDir()).find((file) => file.endsWith('.json'))!);
    const victim = path.join(tmpHome, 'registry-victim');
    fs.writeFileSync(victim, JSON.stringify(record));
    fs.unlinkSync(recordFile);
    fs.symlinkSync(victim, recordFile);

    expect(listDaemons({ prune: false })).toEqual([]);
    expect(fs.readFileSync(victim, 'utf8')).toBe(JSON.stringify(record));
  });

  it.runIf(process.platform !== 'win32')('does not block on a FIFO registry record', () => {
    const root = path.join(projectsRoot, 'fifo-record');
    const record = rec(root, process.pid);
    writeTrustedLock(record);
    registerDaemon(record);
    const recordFile = path.join(getRegistryDir(), fs.readdirSync(getRegistryDir()).find((file) => file.endsWith('.json'))!);
    fs.unlinkSync(recordFile);
    execFileSync('mkfifo', [recordFile]);
    const startedAt = Date.now();

    expect(listDaemons({ prune: false })).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('rejects an oversized registry record before reading it', () => {
    const root = path.join(projectsRoot, 'oversized-record');
    const record = rec(root, process.pid);
    writeTrustedLock(record);
    registerDaemon(record);
    const recordFile = path.join(getRegistryDir(), fs.readdirSync(getRegistryDir()).find((file) => file.endsWith('.json'))!);
    fs.writeFileSync(recordFile, 'x'.repeat(MAX_DAEMON_REGISTRY_RECORD_BYTES + 1), { mode: 0o600 });

    expect(listDaemons({ prune: false })).toEqual([]);
  });

  it('reads registry records through the bounded descriptor loop', () => {
    const root = path.join(projectsRoot, 'bounded-record');
    const record = rec(root, process.pid);
    writeTrustedLock(record);
    registerDaemon(record);
    const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
    const recordFile = path.join(
      getRegistryDir(),
      fs.readdirSync(getRegistryDir()).find((file) => file.endsWith('.json'))!,
    );
    const originalFstat = mutableFs.fstatSync;
    const originalRead = mutableFs.readSync;
    let grew = false;
    let bytesRead = 0;
    mutableFs.fstatSync = ((...args: unknown[]) => {
      const stat = (originalFstat as (...values: unknown[]) => fs.Stats)(...args);
      if (!grew) {
        grew = true;
        fs.appendFileSync(recordFile, 'x'.repeat(MAX_DAEMON_REGISTRY_RECORD_BYTES * 2));
      }
      return stat;
    }) as typeof fs.fstatSync;
    mutableFs.readSync = ((
      fd: number,
      buffer: NodeJS.ArrayBufferView,
      offset: number,
      length: number,
      position: fs.ReadPosition | null,
    ) => {
      const read = originalRead(fd, buffer, offset, length, position);
      bytesRead += read;
      return read;
    }) as typeof fs.readSync;
    syncBuiltinESMExports();

    try {
      expect(listDaemons({ prune: false })).toEqual([]);
    } finally {
      mutableFs.fstatSync = originalFstat;
      mutableFs.readSync = originalRead;
      syncBuiltinESMExports();
    }
    expect(bytesRead).toBeLessThanOrEqual(MAX_DAEMON_REGISTRY_RECORD_BYTES + 1);
  });

  it('register → list shows a live daemon; deregister removes it', () => {
    const root = path.join(projectsRoot, 'a');
    const record = rec(root, process.pid);
    writeTrustedLock(record);
    registerDaemon(record);
    const live = listDaemons();
    expect(live).toHaveLength(1);
    expect(live[0].root).toBe(root);
    expect(live[0].pid).toBe(process.pid);

    deregisterDaemon(root);
    expect(listDaemons()).toEqual([]);
  });

  it('restores a registry record left quarantined by a crashed prune', () => {
    const root = path.join(projectsRoot, 'quarantine-recovery');
    const record = rec(root, process.pid);
    writeTrustedLock(record);
    registerDaemon(record);
    const target = path.join(
      getRegistryDir(),
      fs.readdirSync(getRegistryDir()).find((file) => file.endsWith('.json'))!,
    );
    const quarantine = `${target}.quarantine-crashed-reader`;
    fs.renameSync(target, quarantine);

    expect(listDaemons()).toEqual([record]);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(quarantine)).toBe(false);
  });

  it.runIf(process.platform !== 'win32')('finishes a hard-link restore interrupted before quarantine cleanup', () => {
    const root = path.join(projectsRoot, 'quarantine-hard-link-recovery');
    const record = rec(root, process.pid);
    writeTrustedLock(record);
    registerDaemon(record);
    const target = path.join(
      getRegistryDir(),
      fs.readdirSync(getRegistryDir()).find((file) => file.endsWith('.json'))!,
    );
    const quarantine = `${target}.quarantine-crashed-restore`;
    fs.linkSync(target, quarantine);
    expect(fs.lstatSync(target).nlink).toBe(2);
    expect(fs.lstatSync(quarantine).nlink).toBe(2);

    expect(listDaemons()).toEqual([record]);
    expect(fs.existsSync(quarantine)).toBe(false);
    expect(fs.lstatSync(target).nlink).toBe(1);
  });

  it.runIf(process.platform !== 'win32')('does not prune a canonical record published after quarantine recovery', () => {
    const root = path.join(projectsRoot, 'quarantine-concurrent-hard-link-restore');
    const record = rec(root, process.pid);
    writeTrustedLock(record);
    registerDaemon(record);
    const dir = getRegistryDir();
    const target = path.join(
      dir,
      fs.readdirSync(dir).find((file) => file.endsWith('.json'))!,
    );
    const quarantine = `${target}.quarantine-concurrent-restore`;
    fs.renameSync(target, quarantine);
    const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
    const originalReaddir = mutableFs.readdirSync;
    let registryReads = 0;
    mutableFs.readdirSync = ((readPath: fs.PathLike, options?: unknown) => {
      if (readPath === dir && options === undefined) {
        registryReads += 1;
        if (registryReads === 1) return [];
        if (registryReads === 2) fs.linkSync(quarantine, target);
      }
      return (originalReaddir as (...args: unknown[]) => unknown)(readPath, options);
    }) as typeof fs.readdirSync;
    syncBuiltinESMExports();

    let listed: DaemonRecord[];
    try {
      listed = listDaemons();
    } finally {
      mutableFs.readdirSync = originalReaddir;
      syncBuiltinESMExports();
      try { fs.unlinkSync(quarantine); } catch { /* repaired by the reader */ }
    }

    expect(listed!).toEqual([record]);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.lstatSync(target).nlink).toBe(1);
  });

  it('prunes records whose process is dead', async () => {
    const dead = await deadPid();
    const deadRecord = rec(path.join(projectsRoot, 'dead'), dead);
    const liveRecord = rec(path.join(projectsRoot, 'live'), process.pid);
    writeTrustedLock(deadRecord);
    writeTrustedLock(liveRecord);
    registerDaemon(deadRecord);
    registerDaemon(liveRecord);

    const live = listDaemons();
    expect(live).toHaveLength(1);
    expect(live[0].root).toBe(liveRecord.root);

    // The dead record's file was deleted as a side effect.
    const remaining = fs.readdirSync(getRegistryDir()).filter((f) => f.endsWith('.json'));
    expect(remaining).toHaveLength(1);
  });

  it('does not let a successor election lease make a dead daemon record live', async () => {
    const root = path.join(projectsRoot, 'stale-election-owner');
    const stale = { ...rec(root, await deadPid()), electionProtocol: 1 as const };
    writeTrustedLock(stale);
    registerDaemon(stale);
    const successorElection = await tryAcquireDaemonElectionGuard(root);
    expect(successorElection).not.toBeNull();

    try {
      expect(listDaemons({ prune: false })).toEqual([]);
    } finally {
      await successorElection?.release();
    }
  });

  it('peeking with prune:false leaves dead records on disk', async () => {
    const dead = await deadPid();
    const record = rec(path.join(projectsRoot, 'dead'), dead);
    writeTrustedLock(record);
    registerDaemon(record);
    expect(listDaemons({ prune: false })).toEqual([]); // dead is filtered from results
    // ...but the file survives for the caller to inspect.
    expect(fs.readdirSync(getRegistryDir()).filter((f) => f.endsWith('.json'))).toHaveLength(1);
  });

  it('lists multiple live daemons newest-first', () => {
    const oldRecord = rec(path.join(projectsRoot, 'old'), process.pid, 1000);
    const newRecord = rec(path.join(projectsRoot, 'new'), process.pid, 2000);
    writeTrustedLock(oldRecord);
    writeTrustedLock(newRecord);
    registerDaemon(oldRecord);
    registerDaemon(newRecord);
    const live = listDaemons();
    expect(live.map((d) => d.root)).toEqual([newRecord.root, oldRecord.root]);
  });

  it('ignores a record whose contents point at another root\'s canonical filename', () => {
    const target = rec(path.join(projectsRoot, 'target-root'), process.pid, Date.now() + 1);
    const misplaced = rec(path.join(projectsRoot, 'misplaced-root'), process.pid);
    writeTrustedLock(target);
    registerDaemon(target);
    writeTrustedLock(misplaced);
    registerDaemon(misplaced);
    const misplacedFile = fs.readdirSync(getRegistryDir())
      .map((file) => path.join(getRegistryDir(), file))
      .find((file) => {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')).root === misplaced.root; }
        catch { return false; }
      })!;
    fs.writeFileSync(misplacedFile, JSON.stringify(target, null, 2) + '\n', { mode: 0o600 });

    expect(listDaemons({ prune: false })).toEqual([target]);
    expect(fs.existsSync(misplacedFile)).toBe(true);
    expect(listDaemons()).toEqual([target]);
    expect(fs.existsSync(misplacedFile)).toBe(false);
  });

  it('prunes a malformed registry record without a usable root', () => {
    const malformed = path.join(getRegistryDir(), 'malformed.json');
    fs.mkdirSync(getRegistryDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(malformed, '{', { mode: 0o600 });

    expect(listDaemons({ prune: false })).toEqual([]);
    expect(fs.existsSync(malformed)).toBe(true);
    expect(listDaemons()).toEqual([]);
    expect(fs.existsSync(malformed)).toBe(false);
  });

  it('finishes pruning a malformed record quarantined by a crashed reader', () => {
    const dir = getRegistryDir();
    const quarantine = path.join(dir, 'malformed.json.quarantine-crashed-reader');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(quarantine, '{', { mode: 0o600 });

    expect(listDaemons({ prune: false })).toEqual([]);
    expect(fs.existsSync(quarantine)).toBe(true);
    expect(listDaemons()).toEqual([]);
    expect(fs.existsSync(quarantine)).toBe(false);
  });

  it('does not treat a reused live pid as proof that a stale registry instance is live', () => {
    const root = path.join(projectsRoot, 'pid-reused-list');
    const stale = rec(root, process.pid);
    const replacementInstanceId = randomUUID();
    const replacement = {
      ...stale,
      instanceId: replacementInstanceId,
      socketPath: getDaemonSocketCandidates(root, replacementInstanceId)[0]!,
    };
    writeTrustedLock(replacement, createDaemonAuthSecret());
    registerDaemon(stale);

    expect(listDaemons()).toEqual([]);
    expect(fs.readdirSync(getRegistryDir()).filter((file) => file.endsWith('.json'))).toEqual([]);
  });

  it('preserves a replacement registry record that appears during stale pruning', async () => {
    const root = path.join(projectsRoot, 'prune-replacement');
    const stale = rec(root, await deadPid());
    writeTrustedLock(stale);
    registerDaemon(stale);
    const recordFile = path.join(
      getRegistryDir(),
      fs.readdirSync(getRegistryDir()).find((file) => file.endsWith('.json'))!,
    );
    const replacementInstanceId = randomUUID();
    const replacement = {
      ...stale,
      pid: process.pid,
      instanceId: replacementInstanceId,
      socketPath: getDaemonSocketCandidates(root, replacementInstanceId)[0]!,
      startedAt: Date.now() + 1,
    };
    const replacementLock = trustedLock(replacement, createDaemonAuthSecret());
    const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
    const originalRename = mutableFs.renameSync;
    let injected = false;
    mutableFs.renameSync = ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
      originalRename(oldPath, newPath);
      if (!injected && oldPath === recordFile && String(newPath).includes('.quarantine-')) {
        injected = true;
        fs.writeFileSync(recordFile, JSON.stringify(replacement, null, 2) + '\n', { mode: 0o600 });
        fs.writeFileSync(getDaemonPidPath(root), encodeLockInfo(replacementLock), { mode: 0o600 });
      }
    }) as typeof fs.renameSync;
    syncBuiltinESMExports();

    let listed: DaemonRecord[];
    try {
      listed = listDaemons();
    } finally {
      mutableFs.renameSync = originalRename;
      syncBuiltinESMExports();
    }
    expect(listed!).toEqual([]);
    expect(JSON.parse(fs.readFileSync(recordFile, 'utf8'))).toMatchObject({
      pid: process.pid,
      instanceId: replacement.instanceId,
    });
  });

  it('preserves a replacement quarantine when atomic restoration is unavailable', async () => {
    const root = path.join(projectsRoot, 'prune-replacement-no-links');
    const stale = rec(root, await deadPid());
    writeTrustedLock(stale);
    registerDaemon(stale);
    const recordFile = path.join(
      getRegistryDir(),
      fs.readdirSync(getRegistryDir()).find((file) => file.endsWith('.json'))!,
    );
    const replacementInstanceId = randomUUID();
    const replacement = {
      ...stale,
      pid: process.pid,
      instanceId: replacementInstanceId,
      socketPath: getDaemonSocketCandidates(root, replacementInstanceId)[0]!,
      startedAt: Date.now() + 1,
    };
    const replacementLock = trustedLock(replacement, createDaemonAuthSecret());
    const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
    const originalRename = mutableFs.renameSync;
    const originalLink = mutableFs.linkSync;
    let injected = false;
    mutableFs.renameSync = ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
      if (!injected && oldPath === recordFile && String(newPath).includes('.quarantine-')) {
        injected = true;
        fs.writeFileSync(recordFile, JSON.stringify(replacement, null, 2) + '\n', { mode: 0o600 });
        fs.writeFileSync(getDaemonPidPath(root), encodeLockInfo(replacementLock), { mode: 0o600 });
      }
      originalRename(oldPath, newPath);
    }) as typeof fs.renameSync;
    mutableFs.linkSync = ((existingPath: fs.PathLike, newPath: fs.PathLike) => {
      if (String(existingPath).includes('.quarantine-') && newPath === recordFile) {
        const err = new Error('hard links unavailable') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      originalLink(existingPath, newPath);
    }) as typeof fs.linkSync;
    syncBuiltinESMExports();

    let listed: DaemonRecord[];
    try {
      listed = listDaemons();
    } finally {
      mutableFs.renameSync = originalRename;
      mutableFs.linkSync = originalLink;
      syncBuiltinESMExports();
    }
    expect(listed!).toEqual([]);
    expect(fs.existsSync(recordFile)).toBe(false);
    expect(fs.readdirSync(getRegistryDir()).some((file) => file.includes('.quarantine-'))).toBe(true);
    expect(listDaemons()).toEqual([replacement]);
  });

  it('removes an incomplete target before restoring its valid quarantine', () => {
    const root = path.join(projectsRoot, 'quarantine-partial-target');
    const record = rec(root, process.pid);
    writeTrustedLock(record);
    registerDaemon(record);
    const target = path.join(
      getRegistryDir(),
      fs.readdirSync(getRegistryDir()).find((file) => file.endsWith('.json'))!,
    );
    const quarantine = `${target}.quarantine-crashed-copy`;
    fs.renameSync(target, quarantine);
    fs.writeFileSync(target, '{', { mode: 0o600 });

    expect(listDaemons()).toEqual([]);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(quarantine)).toBe(true);
    expect(listDaemons()).toEqual([record]);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(quarantine)).toBe(false);
  });

  it('preserves every artifact when a replacement daemon owns the lock', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-reg-replacement-'));
    const stalePid = await deadPid();
    const record = rec(root, process.pid);
    const lock = writeTrustedLock(record);
    registerDaemon(record);
    const sockets = process.platform === 'win32' ? [] : getDaemonSocketCandidates(root);
    for (const socket of sockets) {
      ensureDaemonSocketDirectory(root, socket);
      writePrivateFile(socket, 'replacement');
    }

    try {
      expect(await cleanupDaemonArtifacts(root, {
        pid: stalePid,
        instanceId: lock.instanceId,
        authSecret: lock.authSecret,
      })).toBe(false);
      expect(fs.existsSync(getDaemonPidPath(root))).toBe(true);
      expect(sockets.every((socket) => fs.existsSync(socket))).toBe(true);
      expect(listDaemons({ prune: false }).some((record) => record.pid === process.pid)).toBe(true);
    } finally {
      for (const socket of sockets) { try { fs.unlinkSync(socket); } catch { /* gone */ } }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== 'win32')('preserves a legacy replacement published during cleanup', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-reg-cleanup-replacement-'));
    const stalePid = await deadPid();
    const stale = { ...rec(root, stalePid), electionProtocol: 1 as const };
    const staleLock = writeTrustedLock(stale);
    registerDaemon(stale);
    const pidPath = getDaemonPidPath(root);
    const replacement: DaemonRecord = {
      ...rec(root, process.pid, Date.now() + 1),
      instanceId: randomUUID(),
    };
    replacement.socketPath = getDaemonSocketCandidates(root, replacement.instanceId)[0]!;
    const replacementLock = trustedLock(replacement, createDaemonAuthSecret());
    ensureDaemonSocketDirectory(root, replacement.socketPath);
    writePrivateFile(replacement.socketPath, 'replacement');
    const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
    const originalRename = mutableFs.renameSync;
    let replaced = false;
    mutableFs.renameSync = ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
      if (
        !replaced &&
        path.resolve(String(oldPath)) === path.resolve(pidPath) &&
        String(newPath).includes('.quarantine-')
      ) {
        replaced = true;
        const replacementPath = `${pidPath}.legacy-replacement`;
        fs.writeFileSync(replacementPath, encodeLockInfo(replacementLock), { mode: 0o600 });
        originalRename(replacementPath, pidPath);
        registerDaemon(replacement);
      }
      return originalRename(oldPath, newPath);
    }) as typeof fs.renameSync;
    syncBuiltinESMExports();

    try {
      expect(await cleanupDaemonArtifacts(root, {
        pid: stalePid,
        processBirthId: staleLock.processBirthId,
        electionProtocol: 1,
        instanceId: staleLock.instanceId,
        authSecret: staleLock.authSecret,
      })).toBe(false);
    } finally {
      mutableFs.renameSync = originalRename;
      syncBuiltinESMExports();
    }

    expect(replaced).toBe(true);
    expect(JSON.parse(fs.readFileSync(pidPath, 'utf8'))).toEqual(replacementLock);
    expect(fs.existsSync(replacement.socketPath)).toBe(true);
    expect(listDaemons({ prune: false })).toEqual([replacement]);
  });

  it.runIf(process.platform !== 'win32')('fails closed when the project daemon directory is a symlink', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-reg-symlink-root-'));
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-reg-symlink-target-'));
    const victim = path.join(external, 'daemon.sock');
    fs.writeFileSync(victim, 'unchanged');
    fs.symlinkSync(external, path.join(root, '.codegraph'), 'dir');

    try {
      await expect(cleanupDaemonArtifacts(root, null)).resolves.toBe(false);
      expect(fs.readFileSync(victim, 'utf8')).toBe('unchanged');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(external, { recursive: true, force: true });
    }
  });

  it('preserves artifacts when the expected daemon pid is still alive', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-reg-live-owner-'));
    const record = rec(root, process.pid);
    const lock = writeTrustedLock(record);
    registerDaemon(record);

    try {
      expect(await cleanupDaemonArtifacts(root, {
        pid: process.pid,
        instanceId: lock.instanceId,
        authSecret: lock.authSecret,
      })).toBe(false);
      expect(fs.existsSync(getDaemonPidPath(root))).toBe(true);
      expect(listDaemons({ prune: false }).some((record) => record.pid === process.pid)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('removes a complete legacy lock after its expected process identity is dead', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-reg-dead-legacy-'));
    const stalePid = await deadPid();
    const record = rec(root, stalePid);
    const lock = writeTrustedLock(record);
    registerDaemon(record);

    try {
      expect(await cleanupDaemonArtifacts(root, {
        pid: stalePid,
        processBirthId: lock.processBirthId,
        instanceId: lock.instanceId,
        authSecret: lock.authSecret,
      })).toBe(true);
      expect(fs.existsSync(getDaemonPidPath(root))).toBe(false);
      expect(fs.readdirSync(getRegistryDir()).filter((file) => file.endsWith('.json'))).toHaveLength(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('removes lock and registry only for the expected dead pid while preserving non-socket paths', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-reg-owned-'));
    const stalePid = await deadPid();
    const record = { ...rec(root, stalePid), electionProtocol: 1 as const };
    const lock = writeTrustedLock(record);
    registerDaemon(record);
    const sockets = process.platform === 'win32' ? [] : getDaemonSocketCandidates(root);
    for (const socket of sockets) {
      ensureDaemonSocketDirectory(root, socket);
      writePrivateFile(socket, 'stale');
    }

    try {
      expect(await cleanupDaemonArtifacts(root, {
        pid: stalePid,
        instanceId: lock.instanceId,
        authSecret: lock.authSecret,
      })).toBe(true);
      expect(fs.existsSync(getDaemonPidPath(root))).toBe(false);
      expect(sockets.every((socket) => fs.existsSync(socket))).toBe(true);
      expect(fs.readdirSync(getRegistryDir()).filter((file) => file.endsWith('.json'))).toHaveLength(0);
    } finally {
      for (const socket of sockets) { try { fs.unlinkSync(socket); } catch { /* gone */ } }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== 'win32')('stops only through an authenticated daemon control reply', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-reg-auth-stop-'));
    fs.mkdirSync(path.dirname(getDaemonPidPath(root)), { recursive: true });
    const socketPath = getDaemonSocketCandidates(root)[0]!;
    const instanceId = randomUUID();
    const authSecret = createDaemonAuthSecret();
    const lock = {
      pid: process.pid,
      version: '1.0.0',
      socketPath,
      startedAt: Date.now(),
      instanceId,
      authSecret,
    };
    fs.writeFileSync(getDaemonPidPath(root), encodeLockInfo(lock), { mode: 0o600 });
    let authenticated = false;
    const server = net.createServer((socket) => {
      const nonce = createDaemonAuthNonce();
      const helloFields = {
        codegraph: lock.version,
        pid: lock.pid,
        socketPath,
        instanceId,
      };
      socket.write(JSON.stringify({
        ...helloFields,
        protocol: DAEMON_HANDSHAKE_PROTOCOL,
        nonce,
        proof: createDaemonServerProof(authSecret, { ...helloFields, nonce }),
      }) + '\n');
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        for (;;) {
          const newline = buffer.indexOf('\n');
          if (newline < 0) return;
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const message = JSON.parse(line) as {
            id?: unknown;
            method?: string;
            codegraph_client?: number;
            pid?: number;
            hostPid?: number | null;
            instanceId?: string;
            nonce?: string;
            proof?: string;
          };
          if (message.codegraph_client === 1) {
            authenticated = typeof message.nonce === 'string' && daemonProofMatches(
              message.proof,
              createDaemonClientProof(authSecret, {
                pid: message.pid!,
                hostPid: message.hostPid ?? null,
                instanceId: message.instanceId!,
                serverNonce: nonce,
                nonce: message.nonce,
              }),
            );
            continue;
          }
          if (message.method !== 'codegraph/shutdown') continue;
          if (!authenticated) return;
          fs.unlinkSync(getDaemonPidPath(root));
          socket.write(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: { stopping: true },
          }) + '\n');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    try {
      await expect(stopDaemonAt(root)).resolves.toMatchObject({
        pid: process.pid,
        outcome: 'term',
      });
      expect(authenticated).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== 'win32')('never signals a live pid when daemon authentication fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-reg-untrusted-stop-'));
    fs.mkdirSync(path.dirname(getDaemonPidPath(root)), { recursive: true });
    fs.writeFileSync(getDaemonPidPath(root), encodeLockInfo({
      pid: process.pid,
      version: '1.0.0',
      socketPath: getDaemonSocketCandidates(root)[0]!,
      startedAt: Date.now(),
      instanceId: randomUUID(),
    }), { mode: 0o600 });
    const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0) return true;
      throw new Error(`unexpected signal ${String(signal)} to ${pid}`);
    }) as typeof process.kill);

    try {
      await expect(stopDaemonAt(root)).resolves.toMatchObject({ outcome: 'failed' });
      expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
      expect(fs.existsSync(getDaemonPidPath(root))).toBe(true);
    } finally {
      kill.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not treat a malformed daemon lock as confirmed instance release', async () => {
    const root = fs.mkdtempSync(path.join(projectsRoot, 'release-malformed-'));
    ensureDaemonLockDirectory(root);
    fs.writeFileSync(getDaemonPidPath(root), '{not-json', { mode: 0o600 });

    await expect(waitForInstanceRelease(root, INSTANCE_ID, 20, 5)).resolves.toBe(false);
    fs.unlinkSync(getDaemonPidPath(root));
    await expect(waitForInstanceRelease(root, INSTANCE_ID, 20, 5)).resolves.toBe(true);
  });

  it.runIf(process.platform !== 'win32')(
    'does not treat a lockfile read failure as confirmed instance release',
    async () => {
      const root = fs.mkdtempSync(path.join(projectsRoot, 'release-unreadable-'));
      ensureDaemonLockDirectory(root);
      const pidPath = getDaemonPidPath(root);
      fs.symlinkSync(pidPath, pidPath);

      await expect(waitForInstanceRelease(root, INSTANCE_ID, 20, 5)).resolves.toBe(false);
    },
  );

  it.runIf(process.platform !== 'win32')('does not contact a replacement instance after a pid is reused', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-reg-pid-reuse-'));
    const original = rec(root, process.pid);
    const originalLock = writeTrustedLock(original);
    const replacement = {
      ...original,
      instanceId: randomUUID(),
    };
    const replacementLock = trustedLock(replacement, createDaemonAuthSecret());
    let replaced = false;
    const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal !== 0) throw new Error(`unexpected signal ${String(signal)} to ${pid}`);
      if (!replaced) {
        replaced = true;
        fs.writeFileSync(getDaemonPidPath(root), encodeLockInfo(replacementLock), { mode: 0o600 });
      }
      return true;
    }) as typeof process.kill);

    try {
      await expect(stopDaemonAt(root)).resolves.toMatchObject({
        pid: originalLock.pid,
        outcome: 'not-running',
      });
      expect(replaced).toBe(true);
      expect(fs.readFileSync(getDaemonPidPath(root), 'utf8')).toContain(replacement.instanceId);
      expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
    } finally {
      kill.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
