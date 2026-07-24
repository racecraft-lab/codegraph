import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const LINUX_BOOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Build a boot-scoped Linux process lifetime fingerprint from procfs records. */
export function linuxProcessBirthId(stat: string, bootId: string): string | null {
  const commandEnd = stat.lastIndexOf(')');
  if (commandEnd < 0) return null;
  // After the command field, index 0 is field 3 (state); field 22 is 19.
  const fields = stat.slice(commandEnd + 1).trim().split(/\s+/);
  const startTicks = fields[19];
  const boot = bootId.trim().toLowerCase();
  return startTicks && /^\d+$/.test(startTicks) && LINUX_BOOT_ID.test(boot)
    ? `linux:${boot}:${startTicks}`
    : null;
}

/** Probe process existence without sending a signal. EPERM still means alive. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Return a platform process-start fingerprint for `pid`.
 *
 * A PID alone is recyclable. Pairing it with the kernel-reported start instant
 * lets stale daemon records distinguish their original process from an
 * unrelated process that later inherited the same number. Failure is reported
 * as null so callers can preserve ownership rather than delete uncertain state.
 */
export function getProcessBirthId(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    if (platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8');
      return linuxProcessBirthId(stat, bootId);
    }

    if (platform === 'win32') {
      // There is no Node-native Windows process-birth query. Starting
      // PowerShell synchronously added seconds to every cold daemon launch and
      // could exhaust the web/LSP admission deadline before a healthy named
      // pipe became reachable. New daemons do not rely on this optional field:
      // their SQLite election transaction is a kernel-backed lifetime lease,
      // which is authoritative across PID reuse and released on process exit.
      // Legacy records remain fail-closed when their PID is live and are still
      // removable when process.kill(pid, 0) proves it dead.
      return null;
    }

    const result = spawnSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
      timeout: 2_000,
      windowsHide: true,
    });
    const started = result.status === 0 ? result.stdout.trim().replace(/\s+/g, ' ') : '';
    return started ? `${platform}:${started}` : null;
  } catch {
    return null;
  }
}

export function isValidProcessBirthId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

/** True only when the recorded PID still names the recorded process lifetime. */
export function isDaemonProcessAlive(
  info: { pid: number; processBirthId?: string },
  birthIdFor: (pid: number) => string | null = getProcessBirthId,
  alive: (pid: number) => boolean = isProcessAlive,
): boolean {
  if (!alive(info.pid)) return false;
  if (!isValidProcessBirthId(info.processBirthId)) return true;
  const current = birthIdFor(info.pid);
  // A failed platform query is uncertainty, not permission to clear authority.
  return current === null || current === info.processBirthId;
}
