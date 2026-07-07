/**
 * CodeGraph Utilities
 *
 * Common utility functions for memory management, concurrency, batching,
 * and security validation.
 *
 * @module utils
 *
 * @example
 * ```typescript
 * import { Mutex, processInBatches, MemoryMonitor, validatePathWithinRoot } from 'codegraph';
 *
 * // Use mutex for concurrent safety
 * const mutex = new Mutex();
 * await mutex.withLock(async () => {
 *   await performCriticalOperation();
 * });
 *
 * // Process items in batches to manage memory
 * const results = await processInBatches(items, 100, async (item) => {
 *   return await processItem(item);
 * });
 *
 * // Monitor memory usage
 * const monitor = new MemoryMonitor(512, (usage) => {
 *   console.warn(`Memory usage exceeded 512MB: ${usage / 1024 / 1024}MB`);
 * });
 * monitor.start();
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// SECURITY UTILITIES
// ============================================================

/**
 * Sensitive system directories that should never be used as project roots.
 * Checked on all platforms; non-applicable paths are harmlessly skipped.
 */
const SENSITIVE_PATHS = new Set([
  '/', '/etc', '/usr', '/bin', '/sbin', '/var', '/tmp', '/dev', '/proc', '/sys',
  '/root', '/boot', '/lib', '/lib64', '/opt',
  'c:\\', 'c:\\windows', 'c:\\windows\\system32',
]);

/**
 * Read-only view of {@link SENSITIVE_PATHS} for reuse by other write-sink validators
 * (e.g. the SPEC-002 model cache directory) that need a PREFIX match against this same
 * denylist rather than `validateProjectPath`'s exact-match root check — see {@link isWithinDir}.
 *
 * A FROZEN array, not the live `Set`: the mutable set stays module-private so no importer
 * can weaken the guard process-wide by mutating a shared denylist. (Freezing an array truly
 * blocks push/index writes under ES-module strict mode; `Object.freeze` on a `Set` would not.)
 */
export const SENSITIVE_SYSTEM_PATHS: readonly string[] = Object.freeze([...SENSITIVE_PATHS]);

/**
 * Config "languages" whose nodes are pure key/value DATA lifted from a config
 * file (e.g. Spring `application.{yml,properties}`), not source code.
 */
export const CONFIG_LEAF_LANGUAGES: ReadonlySet<string> = new Set(['yaml', 'properties']);

/**
 * Strip angle-bracketed generic/type-argument groups without using a broad
 * multi-character regex replacement.
 */
export function stripAngleBracketGroups(input: string): string {
  let depth = 0;
  let output = '';

  for (const ch of input) {
    if (ch === '<') {
      depth++;
      continue;
    }
    if (ch === '>') {
      if (depth > 0) {
        depth--;
        continue;
      }
    }
    if (depth === 0) output += ch;
  }

  return output;
}

/**
 * A config-leaf node is a single key lifted out of a pure config/data file —
 * `kind: 'constant'` in a {@link CONFIG_LEAF_LANGUAGES} language. Its on-disk
 * line is `key = <value>`, and that value is routinely a secret (DB password,
 * API key, JDBC URL with embedded creds). CodeGraph must surface the KEY only
 * and never read/return the value, or it pushes secrets into agent context
 * unbidden — the value isn't needed for resolution, and an agent that genuinely
 * needs it can read the file directly. (#383)
 */
export function isConfigLeafNode(node: { kind: string; language?: string }): boolean {
  return node.kind === 'constant' && !!node.language && CONFIG_LEAF_LANGUAGES.has(node.language);
}

/**
 * Whether `child` is `parent` itself or sits underneath it. Case-insensitive on
 * Windows — NTFS is case-insensitive, and realpathSync can hand back a different
 * case than the lexical root, which would otherwise false-reject a valid file.
 *
 * Exported so other write-sink validators can reuse this exact PREFIX-match
 * semantics against {@link SENSITIVE_PATHS} (see model-fetch.ts's cache-dir
 * validator, which needs prefix — not exact — matching).
 */
export function isWithinDir(child: string, parent: string): boolean {
  let c = child;
  let p = parent;
  if (process.platform === 'win32') {
    c = c.toLowerCase();
    p = p.toLowerCase();
  }
  if (c === p) return true;
  // Strip a single trailing separator from the parent so a root like "/" (or
  // "c:\") does not become a double-separator prefix ("//") that never matches —
  // that would be a false negative against the helper's "child under parent"
  // contract. NB: this makes a root match every absolute path, so a prefix-match
  // caller that also lists roots (SENSITIVE_PATHS) must treat roots as exact-only
  // (see model-fetch.ts's isSensitivePath).
  const pPrefix = p.endsWith(path.sep) ? p.slice(0, -1) : p;
  return c.startsWith(pPrefix + path.sep);
}

/**
 * Validate that a file path stays within the project root, resolving symlinks.
 *
 * Two layers: a cheap lexical check that catches `../` traversal, then a
 * realpath check that catches symlink escapes — an in-repo symlink whose
 * logical path is inside the root but whose real target points outside it
 * (issue #527). A symlink that stays within the root is still allowed, so
 * legitimate in-tree symlinks keep working. Both content-serving read sinks
 * (codegraph_node `includeCode`, codegraph_explore source) go through here, so
 * this is the chokepoint that keeps out-of-root file contents from leaking.
 *
 * `allowSymlinkEscape` waives **only** the realpath-escape rejection (the
 * lexical `../` guard still applies) for the INDEXING read path. The directory
 * walk deliberately descends into in-root symlinks whose targets live outside
 * the root (e.g. a `game/` symlink in a Dota custom-game tree, #935); discovery
 * and the reader must agree, or every file the walk enumerated fails to index.
 * Indexing only reads paths it just discovered, into a local index — it never
 * serves them to an agent, so this does not widen the #527 leak surface. The
 * content-serving sinks must never pass this flag.
 *
 * @param projectRoot - The project root directory
 * @param filePath - The (relative or absolute) file path to validate
 * @param options.allowSymlinkEscape - Follow in-root symlinks out of the root
 *   (indexing read path only); defaults to the strict, leak-safe behavior.
 * @returns The resolved absolute path (realpath when it exists), or null if it
 *   escapes the root
 */
export function validatePathWithinRoot(
  projectRoot: string,
  filePath: string,
  options?: { allowSymlinkEscape?: boolean }
): string | null {
  const resolved = path.resolve(projectRoot, filePath);
  const normalizedRoot = path.resolve(projectRoot);

  // 1. Lexical containment — cheap, catches `../` traversal. Applies even on
  //    the indexing read path: a crafted `../` escape is still rejected.
  if (!isWithinDir(resolved, normalizedRoot)) {
    return null;
  }

  // 2. Symlink-aware containment — resolve symlinks on both sides and re-check,
  //    so an in-repo symlink whose real target escapes the root is rejected.
  //    The indexing read path (allowSymlinkEscape) skips only this rejection so
  //    it stays consistent with the directory walk, which already followed the
  //    in-root symlink to enumerate these files (#935).
  try {
    const realRoot = fs.realpathSync(normalizedRoot);
    const realResolved = fs.realpathSync(resolved);
    if (options?.allowSymlinkEscape) {
      return realResolved;
    }
    return isWithinDir(realResolved, realRoot) ? realResolved : null;
  } catch (err) {
    // ENOENT: the path doesn't exist yet (a file about to be written, or an
    // index entry for a since-deleted file) — no symlink to follow, and the
    // lexical check already passed, so allow the lexical path. Any other
    // resolution failure (ELOOP, EACCES, …) is treated as unsafe → reject.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return resolved;
    }
    return null;
  }
}

/**
 * Validate that a path is a safe project root directory.
 *
 * Rejects sensitive system directories and ensures the path is
 * a real, existing directory. Used at MCP and API entry points
 * to prevent arbitrary directory access.
 *
 * @param dirPath - The path to validate
 * @returns An error message if invalid, or null if valid
 */
export function validateProjectPath(dirPath: string): string | null {
  const resolved = path.resolve(dirPath);

  // Block sensitive system directories
  if (SENSITIVE_PATHS.has(resolved) || SENSITIVE_PATHS.has(resolved.toLowerCase())) {
    return `Refusing to operate on sensitive system directory: ${resolved}`;
  }

  // Also block common sensitive home subdirectories
  const homeDir = require('os').homedir();
  const sensitiveHomeDirs = ['.ssh', '.gnupg', '.aws', '.config'];
  for (const dir of sensitiveHomeDirs) {
    const sensitivePath = path.join(homeDir, dir);
    if (resolved === sensitivePath || resolved.startsWith(sensitivePath + path.sep)) {
      return `Refusing to operate on sensitive directory: ${resolved}`;
    }
  }

  // Verify it's a real directory
  try {
    const stats = fs.statSync(resolved);
    if (!stats.isDirectory()) {
      return `Path is not a directory: ${resolved}`;
    }
  } catch {
    return `Path does not exist or is not accessible: ${resolved}`;
  }

  return null;
}

/**
 * Safely parse JSON with a fallback value.
 * Prevents crashes from corrupted database metadata.
 */
export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Clamp a numeric value to a range.
 * Used to enforce sane limits on MCP tool inputs.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normalize a file path to use forward slashes.
 * Fixes Windows backslash paths so glob matching works consistently.
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/** The four common `.gitignore` spellings that already ignore `.codegraph`. */
const CODEGRAPH_IGNORE_SPELLINGS: ReadonlySet<string> = new Set([
  '.codegraph', '.codegraph/', '/.codegraph', '/.codegraph/',
]);

/**
 * Ensure `<projectRoot>/.gitignore` ignores `.codegraph/` so the local index
 * — the SQLite graph and, once embeddings are configured, the vectors (tens of
 * MB, fully regenerated by `codegraph init`/`sync`) — is never committed.
 *
 * Advisory and idempotent, matching the repo's other fs helpers: any fs error
 * (or a non-git directory, or an already-present entry) is a silent no-op that
 * returns false — it never throws. Returns true only when it actually wrote the
 * entry, so the caller can report the change.
 *
 * @param projectRoot - The initialized project's root directory
 * @returns true if a `.codegraph/` entry was added, false otherwise
 */
export function ensureCodegraphIgnored(projectRoot: string): boolean {
  try {
    // Only touch git repositories. A worktree/submodule uses a `.git` FILE
    // (a gitdir pointer), a normal repo a `.git` directory — existsSync covers
    // both, and a missing `.git` means this isn't a repo to ignore into.
    if (!fs.existsSync(path.join(projectRoot, '.git'))) {
      return false;
    }

    const gitignorePath = path.join(projectRoot, '.gitignore');
    let existing = '';
    try {
      existing = fs.readFileSync(gitignorePath, 'utf-8');
    } catch {
      // No `.gitignore` yet — created below.
    }

    // Idempotent: skip if any line already ignores `.codegraph` (exact match
    // on the common spellings, trailing whitespace allowed).
    const alreadyIgnored = existing
      .split(/\r?\n/)
      .some((line) => CODEGRAPH_IGNORE_SPELLINGS.has(line.replace(/\s+$/, '')));
    if (alreadyIgnored) {
      return false;
    }

    const block =
      '# CodeGraph local index (machine-generated — never commit)\n.codegraph/\n';
    if (existing === '') {
      fs.writeFileSync(gitignorePath, block);
    } else {
      // Exactly one newline between existing content and our block.
      const separator = existing.endsWith('\n') ? '' : '\n';
      fs.appendFileSync(gitignorePath, separator + block);
    }
    return true;
  } catch {
    // Advisory — a `.gitignore` write must never break init.
    return false;
  }
}

/**
 * Cross-process file lock using a lock file with PID tracking.
 *
 * Prevents multiple processes (e.g., git hooks, CLI, MCP server) from
 * writing to the same database simultaneously.
 */
export class FileLock {
  private lockPath: string;
  private held = false;

  /** Locks older than this are considered stale regardless of PID status */
  private static readonly STALE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

  constructor(lockPath: string) {
    this.lockPath = lockPath;
  }

  /**
   * Acquire the lock. Throws if the lock is held by another live process.
   */
  acquire(): void {
    try {
      this.createLockFile();
      return;
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
    }

    this.removeStaleLockIfPresent();

    try {
      this.createLockFile();
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
      throw new Error(
        'CodeGraph database is locked by another process. ' +
        `If this is stale, run 'codegraph unlock' or delete ${this.lockPath}`
      );
    }
  }

  private createLockFile(): void {
    fs.writeFileSync(this.lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
    this.held = true;
  }

  private readLockInfo(): { pid: number; mtimeMs: number } | null {
    let fd: number | null = null;
    try {
      fd = fs.openSync(this.lockPath, 'r');
      const stat = fs.fstatSync(fd);
      const content = fs.readFileSync(fd, 'utf-8').trim();
      return { pid: parseInt(content, 10), mtimeMs: stat.mtimeMs };
    } catch {
      return null;
    } finally {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch { /* ignore */ }
      }
    }
  }

  private removeStaleLockIfPresent(): void {
    const staleGuidance =
      `If this is stale, run 'codegraph unlock' or delete ${this.lockPath}`;
    const info = this.readLockInfo();
    if (!info) {
      throw new Error(
        `CodeGraph database lock state could not be read. ${staleGuidance}`
      );
    }

    const lockAge = Date.now() - info.mtimeMs;
    const hasValidPid = Number.isInteger(info.pid) && info.pid > 0;

    if (lockAge < FileLock.STALE_TIMEOUT_MS) {
      if (!hasValidPid) {
        throw new Error(
          `CodeGraph database lock state could not be read. ${staleGuidance}`
        );
      }

      if (this.isProcessAlive(info.pid)) {
        throw new Error(
          `CodeGraph database is locked by another process (PID ${info.pid}). ` +
          staleGuidance
        );
      }
    }

    try { fs.unlinkSync(this.lockPath); } catch { /* ignore */ }
  }

  /**
   * Release the lock
   */
  release(): void {
    if (!this.held) return;
    try {
      // Only remove if we still own it (check PID)
      const content = fs.readFileSync(this.lockPath, 'utf-8').trim();
      if (parseInt(content, 10) === process.pid) {
        fs.unlinkSync(this.lockPath);
      }
    } catch {
      // Lock file already gone - that's fine
    }
    this.held = false;
  }

  /**
   * Execute a function while holding the lock
   */
  withLock<T>(fn: () => T): T {
    this.acquire();
    try {
      return fn();
    } finally {
      this.release();
    }
  }

  /**
   * Execute an async function while holding the lock
   */
  async withLockAsync<T>(fn: () => Promise<T>): Promise<T> {
    this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Check if a process is still running
   */
  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Process items in batches to manage memory
 *
 * @param items - Array of items to process
 * @param batchSize - Number of items per batch
 * @param processor - Function to process each item
 * @param onBatchComplete - Optional callback after each batch
 * @returns Array of results
 */
export async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T, index: number) => Promise<R>,
  onBatchComplete?: (completed: number, total: number) => void
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, Math.min(i + batchSize, items.length));
    const batchResults = await Promise.all(
      batch.map((item, idx) => processor(item, i + idx))
    );
    results.push(...batchResults);

    if (onBatchComplete) {
      onBatchComplete(Math.min(i + batchSize, items.length), items.length);
    }

    // Allow GC between batches
    if (global.gc) {
      global.gc();
    }
  }

  return results;
}

/**
 * Simple mutex lock for preventing concurrent operations
 */
export class Mutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  /**
   * Acquire the lock
   *
   * @returns A release function to call when done
   */
  async acquire(): Promise<() => void> {
    while (this.locked) {
      await new Promise<void>((resolve) => {
        this.waitQueue.push(resolve);
      });
    }

    this.locked = true;

    return () => {
      this.locked = false;
      const next = this.waitQueue.shift();
      if (next) {
        next();
      }
    };
  }

  /**
   * Execute a function while holding the lock
   */
  async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Check if the lock is currently held
   */
  isLocked(): boolean {
    return this.locked;
  }
}

/**
 * Chunked file reader for large files
 *
 * Reads a file in chunks to avoid loading entire file into memory.
 */
export async function* readFileInChunks(
  filePath: string,
  chunkSize: number = 64 * 1024
): AsyncGenerator<string, void, undefined> {
  const fs = await import('fs');

  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(chunkSize);

  try {
    let bytesRead: number;
    while ((bytesRead = fs.readSync(fd, buffer, 0, chunkSize, null)) > 0) {
      yield buffer.toString('utf-8', 0, bytesRead);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Debounce a function
 *
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Throttle a function
 *
 * @param fn - Function to throttle
 * @param limit - Minimum time between calls in milliseconds
 * @returns Throttled function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = limit - (now - lastCall);

    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCall = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        fn(...args);
      }, remaining);
    }
  };
}

/**
 * Estimate memory usage of an object (rough approximation)
 *
 * @param obj - Object to measure
 * @returns Approximate size in bytes
 */
export function estimateSize(obj: unknown): number {
  const seen = new WeakSet();

  function sizeOf(value: unknown): number {
    if (value === null || value === undefined) {
      return 0;
    }

    switch (typeof value) {
      case 'boolean':
        return 4;
      case 'number':
        return 8;
      case 'string':
        return 2 * (value as string).length;
      case 'object':
        if (seen.has(value as object)) {
          return 0;
        }
        seen.add(value as object);

        if (Array.isArray(value)) {
          return value.reduce((acc: number, item) => acc + sizeOf(item), 0);
        }

        return Object.entries(value as object).reduce(
          (acc, [key, val]) => acc + sizeOf(key) + sizeOf(val),
          0
        );
      default:
        return 0;
    }
  }

  return sizeOf(obj);
}

/**
 * Memory monitor for tracking usage during operations
 */
export class MemoryMonitor {
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private peakUsage = 0;
  private threshold: number;
  private onThresholdExceeded?: (usage: number) => void;

  constructor(
    thresholdMB: number = 500,
    onThresholdExceeded?: (usage: number) => void
  ) {
    this.threshold = thresholdMB * 1024 * 1024;
    this.onThresholdExceeded = onThresholdExceeded;
  }

  /**
   * Start monitoring memory usage
   */
  start(intervalMs: number = 1000): void {
    this.stop();
    this.peakUsage = 0;

    this.checkInterval = setInterval(() => {
      const usage = process.memoryUsage().heapUsed;
      if (usage > this.peakUsage) {
        this.peakUsage = usage;
      }
      if (usage > this.threshold && this.onThresholdExceeded) {
        this.onThresholdExceeded(usage);
      }
    }, intervalMs);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Get peak memory usage in bytes
   */
  getPeakUsage(): number {
    return this.peakUsage;
  }

  /**
   * Get current memory usage in bytes
   */
  getCurrentUsage(): number {
    return process.memoryUsage().heapUsed;
  }
}
