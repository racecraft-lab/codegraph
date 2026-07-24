/**
 * Daemon bind-failure cleanup — issue #974.
 *
 * A detached daemon acquires the `.codegraph/daemon.pid` lock (via
 * `tryAcquireDaemonLock`) BEFORE it binds its socket. If the bind then fails —
 * e.g. AF_UNIX is unsupported/unreliable on the filesystem (the WSL2 DrvFs
 * hazard behind #974) — `Daemon.start()` must release that lockfile before it
 * propagates the error and exits. Otherwise the next launcher reads a stale lock
 * pointing at the now-dead pid and the process pileup the issue reported recurs.
 *
 * We force a deterministic bind failure by planting a *directory* at the socket
 * path: `unlinkSync` (the daemon's stale-socket clear) can't remove a directory,
 * so it survives and `listen()` fails with EADDRINUSE.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import {
  Daemon,
  tryAcquireDaemonElectionGuard,
  tryAcquireDaemonLock,
  finalizeDaemonExit,
} from '../src/mcp/daemon';
import {
  encodeLockInfo,
  getDaemonPidPath,
  getDaemonSocketCandidates,
  getDaemonSocketPath,
} from '../src/mcp/daemon-paths';
import { listDaemons, registerDaemon } from '../src/mcp/daemon-registry';

const tmpRoots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  while (tmpRoots.length) {
    const root = tmpRoots.pop()!;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe('Daemon.start() bind failure (#974)', () => {
  it.runIf(process.platform !== 'win32')('releases the lockfile it acquired when the socket cannot bind', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-bind-'));
    tmpRoots.push(root);
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);

    // Acquire the lock exactly as the detached-daemon startup does.
    const election = await tryAcquireDaemonElectionGuard(root);
    expect(election).not.toBeNull();
    const lock = tryAcquireDaemonLock(root);
    expect(lock.kind).toBe('acquired');
    const pidPath = getDaemonPidPath(root);
    expect(fs.existsSync(pidPath)).toBe(true);

    // Make the socket path un-bindable: a directory can't be unlink'd by the
    // daemon's stale-socket clear, and listen() on it fails with EADDRINUSE.
    const sockPath = getDaemonSocketPath(root);
    fs.mkdirSync(sockPath, { recursive: true });
    // The tmpdir-fallback socket path can live outside `root`; clean it too.
    tmpRoots.push(sockPath);

    const daemon = new Daemon(root, { lockInfo: lock.info, electionGuard: election! }) as any;
    const ensureInitialized = vi.spyOn(daemon.engine, 'ensureInitialized').mockResolvedValue(undefined);
    const stopEngine = vi.spyOn(daemon.engine, 'stop');
    await expect(daemon.start()).rejects.toThrow();

    // The lockfile must be gone so the next launcher doesn't spin on a stale lock.
    expect(fs.existsSync(pidPath)).toBe(false);
    expect(ensureInitialized).not.toHaveBeenCalled();
    expect(stopEngine).toHaveBeenCalledOnce();
    const replacementElection = await tryAcquireDaemonElectionGuard(root);
    expect(replacementElection).not.toBeNull();
    await replacementElection!.release();
  });

  it('releases the engine and election lease when lock ownership changes before bind', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-start-lock-race-'));
    tmpRoots.push(root);
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    const election = await tryAcquireDaemonElectionGuard(root);
    expect(election).not.toBeNull();
    const lock = tryAcquireDaemonLock(root);
    expect(lock.kind).toBe('acquired');
    const pidPath = getDaemonPidPath(root);
    const daemon = new Daemon(root, { lockInfo: lock.info, electionGuard: election! }) as any;
    const ensureInitialized = vi.spyOn(daemon.engine, 'ensureInitialized').mockResolvedValue(undefined);
    const stopEngine = vi.spyOn(daemon.engine, 'stop');
    fs.writeFileSync(pidPath, encodeLockInfo({ ...lock.info, instanceId: 'replacement-instance' }), { mode: 0o600 });

    await expect(daemon.start()).rejects.toThrow(/lock ownership changed/);

    expect(ensureInitialized).not.toHaveBeenCalled();
    expect(stopEngine).toHaveBeenCalledOnce();
    expect(fs.existsSync(pidPath)).toBe(true);
    const replacementElection = await tryAcquireDaemonElectionGuard(root);
    expect(replacementElection).not.toBeNull();
    await replacementElection!.release();
  });

  it.runIf(process.platform !== 'win32')('releases the server, engine, lock, and election when relocation publication fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-start-relocate-'));
    tmpRoots.push(root);
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    const election = await tryAcquireDaemonElectionGuard(root);
    expect(election).not.toBeNull();
    const lock = tryAcquireDaemonLock(root);
    expect(lock.kind).toBe('acquired');
    const candidates = getDaemonSocketCandidates(root, lock.info.instanceId);
    expect(candidates).toHaveLength(2);
    const originalListen = net.Server.prototype.listen;
    vi.spyOn(net.Server.prototype, 'listen').mockImplementation(function(this: net.Server, ...args: any[]) {
      if (args[0] === candidates[0]) {
        const err = new Error('primary socket unsupported') as NodeJS.ErrnoException;
        err.code = 'ENOTSUP';
        process.nextTick(() => this.emit('error', err));
        return this;
      }
      return originalListen.apply(this, args as any);
    } as any);
    const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
    const originalRename = mutableFs.renameSync;
    mutableFs.renameSync = ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
      if (String(oldPath).includes('.relocate') && newPath === getDaemonPidPath(root)) {
        const err = new Error('relocation lock publication failed') as NodeJS.ErrnoException;
        err.code = 'EIO';
        throw err;
      }
      originalRename(oldPath, newPath);
    }) as typeof fs.renameSync;
    syncBuiltinESMExports();
    const daemon = new Daemon(root, { lockInfo: lock.info, electionGuard: election! }) as any;
    vi.spyOn(daemon.engine, 'ensureInitialized').mockResolvedValue(undefined);
    const stopEngine = vi.spyOn(daemon.engine, 'stop');

    try {
      await expect(daemon.start()).rejects.toThrow(/relocation lock publication failed/);
    } finally {
      mutableFs.renameSync = originalRename;
      syncBuiltinESMExports();
    }

    expect(stopEngine).toHaveBeenCalledOnce();
    expect(fs.existsSync(getDaemonPidPath(root))).toBe(false);
    expect(candidates.every((candidate) => !fs.existsSync(candidate))).toBe(true);
    const replacementElection = await tryAcquireDaemonElectionGuard(root);
    expect(replacementElection).not.toBeNull();
    await replacementElection!.release();
  });

  it.runIf(process.platform !== 'win32')('fails closed when socket permissions cannot be secured', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-socket-mode-fail-'));
    tmpRoots.push(root);
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    const election = await tryAcquireDaemonElectionGuard(root);
    expect(election).not.toBeNull();
    const lock = tryAcquireDaemonLock(root);
    expect(lock.kind).toBe('acquired');
    const candidates = getDaemonSocketCandidates(root, lock.info.instanceId);
    const mutableFs = createRequire(import.meta.url)('node:fs') as typeof fs;
    const originalChmod = mutableFs.chmodSync;
    mutableFs.chmodSync = ((target: fs.PathLike, mode: fs.Mode) => {
      if (candidates.includes(String(target))) {
        const err = new Error('simulated socket chmod failure') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      return originalChmod(target, mode);
    }) as typeof fs.chmodSync;
    syncBuiltinESMExports();
    const daemon = new Daemon(root, { lockInfo: lock.info, electionGuard: election! }) as any;
    vi.spyOn(daemon.engine, 'ensureInitialized').mockResolvedValue(undefined);
    const stopEngine = vi.spyOn(daemon.engine, 'stop');

    try {
      await expect(daemon.start()).rejects.toThrow(/simulated socket chmod failure/);
    } finally {
      mutableFs.chmodSync = originalChmod;
      syncBuiltinESMExports();
    }

    expect(stopEngine).toHaveBeenCalledOnce();
    expect(fs.existsSync(getDaemonPidPath(root))).toBe(false);
    expect(candidates.every((candidate) => !fs.existsSync(candidate))).toBe(true);
    const replacementElection = await tryAcquireDaemonElectionGuard(root);
    expect(replacementElection).not.toBeNull();
    await replacementElection!.release();
  });

  it.runIf(process.platform !== 'win32')('routes post-listen server errors through ordered shutdown', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-listener-error-'));
    tmpRoots.push(root);
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    const signalListeners = {
      SIGINT: new Set(process.listeners('SIGINT')),
      SIGTERM: new Set(process.listeners('SIGTERM')),
    };
    const lock = tryAcquireDaemonLock(root);
    expect(lock.kind).toBe('acquired');
    const daemon = new Daemon(root, { lockInfo: lock.info }) as any;
    vi.spyOn(daemon.engine, 'ensureInitialized').mockResolvedValue(undefined);
    const stop = vi.spyOn(daemon, 'stop').mockResolvedValue(undefined);
    let server: import('node:net').Server | null = null;
    try {
      await daemon.start();
      server = daemon.server;
      expect(server).not.toBeNull();
      expect(server!.listenerCount('error')).toBe(1);

      expect(() => server!.emit('error', new Error('post-listen failure at /private/path'))).not.toThrow();

      expect(stop).toHaveBeenCalledOnce();
      expect(stop).toHaveBeenCalledWith('listener error');
      expect(server!.listenerCount('error')).toBe(1);
    } finally {
      if (server) {
        server.removeAllListeners('error');
        if (server.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
      daemon.engine.stop();
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        for (const listener of process.listeners(signal)) {
          if (!signalListeners[signal].has(listener)) process.removeListener(signal, listener);
        }
      }
    }
  });
});

describe('Daemon.stop() cleanup', () => {
  it('releases authority and election ownership after teardown operations throw', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-stop-cleanup-'));
    tmpRoots.push(root);
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    const election = await tryAcquireDaemonElectionGuard(root);
    expect(election).not.toBeNull();
    const lock = tryAcquireDaemonLock(root);
    expect(lock.kind).toBe('acquired');
    const daemon = new Daemon(root, { lockInfo: lock.info, electionGuard: election! }) as any;
    daemon.server = {
      close: vi.fn(() => { throw new Error('server close failed'); }),
    };
    const stopEngine = vi.spyOn(daemon.engine, 'stop').mockImplementation(() => {
      throw new Error('engine stop failed');
    });
    registerDaemon({
      root,
      pid: lock.info.pid,
      processBirthId: lock.info.processBirthId,
      electionProtocol: lock.info.electionProtocol,
      version: lock.info.version,
      socketPath: lock.info.socketPath,
      startedAt: lock.info.startedAt,
      instanceId: lock.info.instanceId,
    });
    const previousExitCode = process.exitCode;
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    try {
      await expect(daemon.stop('test failure')).resolves.toBeUndefined();
      expect(stopEngine).toHaveBeenCalledOnce();
      expect(fs.existsSync(getDaemonPidPath(root))).toBe(false);
      expect(listDaemons({ prune: false }).some((record) => record.root === root)).toBe(false);
      expect(daemon.electionGuard).toBeNull();
      const replacementElection = await tryAcquireDaemonElectionGuard(root);
      expect(replacementElection).not.toBeNull();
      await replacementElection!.release();
      if (process.platform !== 'win32') expect(exit).toHaveBeenCalledWith(0);
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});

/**
 * Windows shutdown must not force `process.exit()` while the recursive file
 * watcher is still tearing down — that aborts the daemon with a libuv
 * `UV_HANDLE_CLOSING` assertion (0xC0000409), reproducible when the indexed tree
 * contains a nested repo. `finalizeDaemonExit` drains on Windows and exits
 * immediately elsewhere; both branches are exercised here by injecting the
 * platform + exit fn (so it runs on any host).
 */
describe('finalizeDaemonExit — Windows drains instead of aborting mid-watcher-close', () => {
  for (const platform of ['linux', 'darwin'] as const) {
    it(`exits immediately on ${platform}`, () => {
      const exit = vi.fn();
      const backstop = finalizeDaemonExit(platform, exit);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
      expect(backstop).toBeNull();
    });
  }

  it('on win32 defers exit (lets the loop drain), then force-exits via an unref\'d backstop', () => {
    vi.useFakeTimers();
    const prevExitCode = process.exitCode;
    const exit = vi.fn();
    try {
      const backstop = finalizeDaemonExit('win32', exit);
      // No synchronous exit — the process must drain its closing watch handles first.
      expect(exit).not.toHaveBeenCalled();
      expect(backstop).not.toBeNull();
      // Success code is set so a natural drain exits 0.
      expect(process.exitCode).toBe(0);
      // If a stray handle keeps the loop alive, the backstop still forces exit.
      vi.advanceTimersByTime(2_000);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
      process.exitCode = prevExitCode; // don't leak a 0 exit code into the runner
    }
  });
});
