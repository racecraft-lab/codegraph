/**
 * Agent-mode task bundles — the filesystem work-package emitter, resilient
 * lister, FR-010a redemption lookup, and the shared FR-029a bounded safe-read
 * (SPEC-018 slice 2; research D8/D9, data-model §3/§4/§7, contracts/bundle-files.md).
 *
 * Agent mode is reached only by an explicit `CODEGRAPH_LLM_PROVIDER=agent`. When
 * `generate()` dispatches into it, {@link emitBundle} writes a self-describing
 * directory `.codegraph/tasks/<id>/` (Q10) that a coding agent can complete using
 * ONLY the files inside it (FR-022), then hands back an opaque `handle` the consumer
 * later redeems with {@link redeemHandle}. There is NO SQLite and NO schema change
 * (FR-023): the sole durable state is the per-bundle `manifest.json` on disk.
 *
 * Everything a bundle-selecting id/handle touches is treated as untrusted, same-user
 * input (FR-029a): {@link resolveBundleDir} anchor-contains the id to a single direct
 * child of `.codegraph/tasks/` before any read, and {@link readBundleFileSafely} —
 * reused by Group G's ingest — bounds every file read (containment, symlink
 * rejection, size, JSON depth, read-expected-fields-only). The threat model is
 * same-user; residual same-process TOCTOU between check and use is out of scope
 * (research D9).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getCodeGraphDir } from '../directory';
import { validatePathWithinRoot } from '../utils';
import type { ProseTask } from './generate';

/**
 * Size ceiling for any single bundle file read from disk (research D9 / D-constants).
 * The stat-then-cap bound is applied BEFORE the file is read, so an oversized
 * attacker-planted file is never pulled into memory.
 */
export const MAX_BUNDLE_INPUT_BYTES = 1_048_576; // 1 MiB

/**
 * Maximum JSON nesting depth accepted by {@link readBundleFileSafely} (research D9).
 * A bounded-depth scan runs before `JSON.parse`, so deeply-nested attacker input
 * can never drive an unbounded parse.
 */
export const MAX_JSON_DEPTH = 32;

/** Emit-time manifest (data-model §4). `status` is EXACTLY `pending | completed` (CRL 1). */
export interface BundleManifest {
  /** = the directory name / opaque handle. */
  id: string;
  /** Filesystem-only state; `completed` is set solely by a successful ingest (FR-028). */
  status: 'pending' | 'completed';
  /** Relative ref to `output-contract.json` inside the dir. */
  contract: string;
  /** ISO-8601 creation time, for `tasks list` age (FR-026). */
  createdAt: string;
}

/** {@link emitBundle} success shape — the opaque bundle id and its redeemable handle. */
export interface EmitResult {
  id: string;
  handle: string;
}

/**
 * FR-010a handle redemption result (data-model §7) — a closed union so a consumer
 * can always tell finalized text from a still-open or vanished bundle.
 */
export type RedeemResult =
  | { status: 'completed'; text: string } // manifest completed → canonical result read from the bundle dir
  | { status: 'pending' } // manifest still pending, or unreadable (never a false completed — CRL 7)
  | { status: 'missing' }; // bundle dir gone, or the handle is not a contained segment (CRL 8)

/** Status surfaced by {@link listBundles}. A readable in-enum status passes through; a
 *  safe-read failure → `unreadable`; a readable-but-out-of-enum status → `unknown`. */
export type BundleListStatus = 'pending' | 'completed' | 'unreadable' | 'unknown';

/** One row of {@link listBundles} (contracts/tasks-cli.md: id / status / age). */
export interface BundleListing {
  id: string;
  status: BundleListStatus;
  /** From `manifest.createdAt`; null when the manifest is unreadable or lacks it. */
  createdAt: string | null;
  /** `Date.now() - createdAt` in ms; null when `createdAt` is absent/unparseable. */
  ageMs: number | null;
}

/**
 * {@link readBundleFileSafely} outcome. A closed union rather than a throw so BOTH
 * consumers can map it into their own disposition (research D9): `redeemHandle`
 * maps `ok:false` → `pending`; Group G's ingest maps `ok:false` → an FR-028a-shaped
 * rejection (reason → stderr, manifest left `pending`).
 */
export type SafeReadResult = { ok: true; value: unknown } | { ok: false; reason: string };

/** `.codegraph/tasks/` for a project root, honoring the `CODEGRAPH_DIR` override. */
function tasksRootDir(root: string): string {
  return path.join(getCodeGraphDir(root), 'tasks');
}

/**
 * FR-029a anchor containment (CRL 8): resolve a bundle-selecting id/handle to its
 * directory, or `null` when it is not a single path segment resolving to a direct
 * child of `.codegraph/tasks/`. Rejects — WITHOUT any read — any handle that is
 * empty, `.`/`..`, carries a path separator, is absolute, or (via
 * {@link validatePathWithinRoot}) resolves outside the tasks root, including a
 * symlink whose realpath escapes. Emit-side ids are `crypto.randomUUID()` and thus
 * inherently single-segment; this guard governs the untrusted read/redeem side.
 */
export function resolveBundleDir(root: string, handle: string): string | null {
  if (typeof handle !== 'string' || handle === '' || handle === '.' || handle === '..') return null;
  if (handle.includes('/') || handle.includes('\\') || handle.includes(path.sep)) return null;
  // A single segment resolving within the tasks root is, by construction, a direct
  // child; validatePathWithinRoot additionally rejects any realpath/symlink escape.
  return validatePathWithinRoot(tasksRootDir(root), handle);
}

/**
 * True when the raw JSON `text` nests deeper than `maxDepth`. A single O(n),
 * non-recursive, string-aware scan of the bracket structure — so a deeply-nested
 * payload is rejected BEFORE `JSON.parse` ever runs, with no risk of exhausting the
 * stack in our own parser (research D9). Brackets inside string literals do not count.
 */
function exceedsJsonDepth(text: string, maxDepth: number): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === '{' || c === '[') {
      depth++;
      if (depth > maxDepth) return true;
    } else if (c === '}' || c === ']') {
      depth--;
    }
  }
  return false;
}

/**
 * Read a single string field from a parsed object by its OWN enumerable key only
 * (read-expected-fields-only, research D9). Uses `hasOwnProperty` so an inherited
 * `__proto__`/`constructor` key can never be mistaken for real data, and never
 * deep-merges/`Object.assign`s attacker JSON — so no prototype can be polluted.
 * Returns `null` when the value is absent or not a string.
 */
function readOwnStringField(obj: unknown, name: string): string | null {
  if (typeof obj !== 'object' || obj === null) return null;
  if (!Object.prototype.hasOwnProperty.call(obj, name)) return null;
  const value = (obj as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : null;
}

/**
 * The shared FR-029a bounded safe-read (research D9), the reader for EVERY named
 * path inside a bundle dir — the agent's `output.json`, `result.json`, and even
 * `manifest.json`'s own `contract` pointer — so no tampered value can escape the
 * bundle. Exported so Group G's ingest reuses exactly these checks. Never throws;
 * returns a closed {@link SafeReadResult} the caller maps to its own disposition.
 *
 * Enforced in order, before the read/parse completes:
 *  1. Containment — {@link validatePathWithinRoot} against `bundleDir` (reused, not
 *     reimplemented); reject any path resolving outside it, incl. a symlink realpath
 *     escape. This is the ONLY path-based operation.
 *  2. Single-descriptor bind — `openSync` the addressed path with `O_NOFOLLOW`, so
 *     opening a symlink final component fails (`ELOOP` → symlink rejection) and the
 *     symlink/type/size validation AND the read all touch the SAME descriptor, never
 *     the path again. This closes the check-then-use file-system race (CodeQL
 *     js/file-system-race): no path-based stat can be followed by a path-based read of
 *     a swapped inode. `O_NOFOLLOW` is undefined on Windows, where it degrades to a
 *     no-op — the realpath containment above still rejects an escaping symlink.
 *  3. Type + size bound — `fstatSync` the descriptor; reject a non-regular file, or
 *     size > {@link MAX_BUNDLE_INPUT_BYTES}, BEFORE reading its content from the same fd.
 *  4. Depth bound — reject nesting > {@link MAX_JSON_DEPTH} with a bounded-depth scan
 *     BEFORE `JSON.parse`.
 * The parsed value is returned as-is; callers consume it via own-field reads only
 * (never a deep-merge), keeping the read prototype-pollution safe.
 *
 * `root` is accepted for signature symmetry with the rest of the module and future
 * use; containment anchors at `bundleDir`, which the caller has already
 * anchor-contained under the tasks root (see {@link resolveBundleDir}).
 */
export function readBundleFileSafely(root: string, bundleDir: string, relPath: string): SafeReadResult {
  void root;
  // 1. Containment — realpath-aware; rejects `../` traversal and symlink escapes.
  if (validatePathWithinRoot(bundleDir, relPath) === null) {
    return { ok: false, reason: `path escapes the bundle directory: ${relPath}` };
  }
  // 2. Bind validation AND the read to a SINGLE descriptor so no path-based stat can be
  // followed by a path-based read of a swapped inode (CodeQL js/file-system-race). Only
  // this openSync touches the path; the type/size check (fstat) and the read use the fd.
  // O_NOFOLLOW makes opening a symlink final component fail (ELOOP on POSIX); it is
  // undefined on Windows, where `?? 0` degrades it to a no-op (the realpath containment
  // above still rejects a symlink that escapes the bundle dir).
  const addressed = path.resolve(bundleDir, relPath);
  let fd: number;
  try {
    fd = fs.openSync(addressed, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ELOOP') {
      return { ok: false, reason: `refusing to read a symlink: ${relPath}` };
    }
    return { ok: false, reason: `file not found: ${relPath}` };
  }

  try {
    // 3. Type + size bound on the OPEN descriptor (never the path again), before reading.
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      return { ok: false, reason: `not a regular file: ${relPath}` };
    }
    if (stat.size > MAX_BUNDLE_INPUT_BYTES) {
      return { ok: false, reason: `file exceeds ${MAX_BUNDLE_INPUT_BYTES} bytes: ${relPath}` };
    }
    // Read the content FROM THE SAME fd — the exact inode validated above.
    let raw: string;
    try {
      raw = fs.readFileSync(fd, 'utf8');
    } catch {
      return { ok: false, reason: `unreadable file: ${relPath}` };
    }
    // 4. Depth bound (before parse).
    if (exceedsJsonDepth(raw, MAX_JSON_DEPTH)) {
      return { ok: false, reason: `JSON nesting exceeds ${MAX_JSON_DEPTH}: ${relPath}` };
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, reason: `malformed JSON: ${relPath}` };
    }
    return { ok: true, value };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The bundle-local completion protocol (FR-022). A FIXED, deterministic README — no
 * randomness, no timestamp — that makes a bundle completable using ONLY its own
 * contents, with no external companion skill: it tells the coding agent to read
 * `instructions.md` for the task, honor the schema in `output-contract.json`, write its
 * answer as `output.json` in the bundle dir, and how the user then finalizes the bundle
 * (`codegraph tasks ingest <id>`). The consumer's task text stays verbatim and separate
 * in `instructions.md`; this file is bundle-local scaffolding, so naming the
 * `codegraph tasks ingest` command here is intentional.
 */
function bundleReadme(id: string): string {
  return [
    '# CodeGraph agent task bundle',
    '',
    'This directory is a self-contained work package. Complete it using ONLY the files',
    'in this directory — no external state or tooling is required.',
    '',
    '## Steps',
    '',
    '1. Read `instructions.md` — the task to perform.',
    '2. Read `output-contract.json` — the machine-checkable schema your answer must',
    '   satisfy: each required field, its type, and whether it must be non-empty.',
    '3. Read `graph-context.json` — supporting code-graph context for the task.',
    '4. Write your completed answer to `output.json` in THIS directory, as a single JSON',
    '   object containing EXACTLY the fields required by `output-contract.json`.',
    '',
    '## Finalize',
    '',
    'After `output.json` is written, the user finalizes this bundle by running:',
    '',
    `    codegraph tasks ingest ${id}`,
    '',
    'That command structurally validates `output.json` against `output-contract.json`',
    'and, on success, records the canonical result for the original requester.',
    '',
  ].join('\n');
}

/**
 * Emit a self-describing agent-mode task bundle under `.codegraph/tasks/<id>/` and
 * return its opaque `{ id, handle }` (data-model §3/§4, research D8). Writes five files
 * — `instructions.md`, `graph-context.json`, `output-contract.json`, `README.md` (the
 * FR-022 bundle-local completion protocol), and `manifest.json` (`status:'pending'`) —
 * carrying the consumer's task parts verbatim (FR-021/FR-022). No SQLite (FR-023).
 *
 * Identity is `crypto.randomUUID()`; the directory is created with an EXCLUSIVE
 * `mkdir` (`recursive:false`), regenerating the id on the astronomically-unlikely
 * `EEXIST` (the `jobs.ts` discipline) so concurrent `generate()` calls never collide
 * or overwrite (FR-024); there is no cross-call dedup — a repeat call for a
 * logically-identical task emits a fresh bundle (FR-024a). A genuinely unwritable
 * root (any non-`EEXIST` fs error) propagates as a throw, which the `generate()`
 * agent branch catches and degrades to the consumer fallback (Edge Case; US1).
 */
export function emitBundle(root: string, task: ProseTask): EmitResult {
  const tasksRoot = tasksRootDir(root);
  // Agent mode may be the first fs touch of this root; ensure the tasks parent
  // exists. A genuinely unwritable root throws here (ENOTDIR/EACCES) → propagates.
  fs.mkdirSync(tasksRoot, { recursive: true });

  // Emit atomically: stage every file in a sibling `.tmp-<id>` dir — OUTSIDE the
  // enumerated bundle namespace — then `rename` it onto `<id>` in one step. A
  // mid-emit fs error therefore never publishes a partial bundle under a bundle id
  // (only the complete file set is ever visible to listBundles/resolveBundleDir).
  // The exclusive staging `mkdir` keeps the `jobs.ts` EEXIST-retry discipline so
  // concurrent emits never collide or overwrite (FR-024/FR-024a).
  let id = randomUUID();
  let stagingDir = path.join(tasksRoot, `.tmp-${id}`);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.mkdirSync(stagingDir, { recursive: false }); // exclusive create: EEXIST if the id already exists
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST' && attempt < 8) {
        id = randomUUID();
        stagingDir = path.join(tasksRoot, `.tmp-${id}`);
        continue;
      }
      throw err; // any other fs failure (or exhausted UUID retries) surfaces to generate()
    }
  }

  const finalDir = path.join(tasksRoot, id);
  try {
    const manifest: BundleManifest = {
      id,
      status: 'pending',
      contract: 'output-contract.json',
      createdAt: new Date().toISOString(),
    };
    // The five self-describing files (Q10 / FR-021, FR-022). graphContext + the
    // OutputContract are embedded verbatim; the layer never parses or enriches them.
    // README.md is the bundle-local completion protocol so the bundle is completable
    // using ONLY its own contents (FR-022), with no external companion skill.
    fs.writeFileSync(path.join(stagingDir, 'instructions.md'), task.instructions, 'utf8');
    fs.writeFileSync(path.join(stagingDir, 'graph-context.json'), JSON.stringify(task.graphContext, null, 2), 'utf8');
    fs.writeFileSync(path.join(stagingDir, 'output-contract.json'), JSON.stringify(task.outputContract, null, 2), 'utf8');
    fs.writeFileSync(path.join(stagingDir, 'README.md'), bundleReadme(id), 'utf8');
    fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    // Atomic publish: the complete staging dir becomes `<id>/` in a single rename.
    fs.renameSync(stagingDir, finalDir);
  } catch (err) {
    // Any failure before the rename: best-effort remove the staging dir so no
    // partial bundle (`<id>/` or `.tmp-<id>/`) is ever visible (FR-024). rmSync is
    // force:true so an already-vanished staging dir is not itself an error.
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw err; // surfaces to generate(), which degrades to the consumer fallback
  }

  return { id, handle: id };
}

/**
 * Enumerate the bundles under `.codegraph/tasks/`, one row per bundle (FR-026). The
 * enumeration is resilient in the `daemon-registry.ts` mold: a bundle whose
 * `manifest.json` is missing / malformed / unreadable is surfaced with an
 * `unreadable` (or `unknown`, for an out-of-enum status) row rather than aborting the
 * listing; a non-directory entry is skipped; an empty or absent tasks dir returns an
 * empty list. Reads only manifests; opens no socket and no DB (network-free).
 */
export function listBundles(root: string): BundleListing[] {
  const tasksRoot = tasksRootDir(root);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(tasksRoot, { withFileTypes: true });
  } catch {
    return []; // absent/unreadable tasks dir → empty listing (never an error)
  }

  const out: BundleListing[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue; // stray files are not bundles
    const id = entry.name;
    const read = readBundleFileSafely(root, path.join(tasksRoot, id), 'manifest.json');
    if (!read.ok) {
      out.push({ id, status: 'unreadable', createdAt: null, ageMs: null });
      continue;
    }
    const rawStatus = readOwnStringField(read.value, 'status');
    const createdAt = readOwnStringField(read.value, 'createdAt');
    const status: BundleListStatus =
      rawStatus === 'pending' || rawStatus === 'completed' ? rawStatus : 'unknown';
    let ageMs: number | null = null;
    if (createdAt !== null) {
      const parsed = Date.parse(createdAt);
      if (!Number.isNaN(parsed)) ageMs = Math.max(0, Date.now() - parsed);
    }
    out.push({ id, status, createdAt, ageMs });
  }
  return out;
}

/**
 * The network-free count of PENDING bundles under `.codegraph/tasks/` behind the
 * agent-mode status block (data-model §8). Completed and unreadable bundles are not
 * pending work, so they are excluded. Reads only manifests (no socket, no DB).
 */
export function countPendingBundles(root: string): number {
  return listBundles(root).filter((b) => b.status === 'pending').length;
}

/**
 * FR-010a handle redemption (data-model §7, research D7). Reads ONLY the handle's own
 * bundle directory and introduces no persistence beyond the manifest (FR-023). Every
 * path is FR-029a-guarded:
 *  - The handle is anchor-contained FIRST ({@link resolveBundleDir}); a
 *    separator-bearing / escaping / non-segment handle → `missing` with NO read
 *    (CRL 8) — such a handle designates no location under the tasks root.
 *  - Bundle dir gone → `missing` (its own existence is the sole definition of missing).
 *  - Manifest `completed` → the canonical `result.json` text → `{ completed, text }`.
 *  - Manifest `pending` (or any non-completed value) → `pending`.
 *  - A present-but-unreadable manifest, or a completed manifest whose `result.json`
 *    fails the bounded safe-read, → `pending` (never throws, never a false
 *    `completed` — CRL 7). The canonical result shape is `{ text: string }`, written
 *    by ingest on a successful validation.
 */
export function redeemHandle(root: string, handle: string): RedeemResult {
  const bundleDir = resolveBundleDir(root, handle);
  if (bundleDir === null) return { status: 'missing' };

  let dirStat: fs.Stats;
  try {
    dirStat = fs.statSync(bundleDir);
  } catch {
    return { status: 'missing' };
  }
  if (!dirStat.isDirectory()) return { status: 'missing' };

  const manifestRead = readBundleFileSafely(root, bundleDir, 'manifest.json');
  if (!manifestRead.ok) return { status: 'pending' }; // present-but-unreadable → pending (CRL 7)

  if (readOwnStringField(manifestRead.value, 'status') !== 'completed') {
    return { status: 'pending' };
  }

  const resultRead = readBundleFileSafely(root, bundleDir, 'result.json');
  if (!resultRead.ok) return { status: 'pending' }; // completed but result unreadable → pending, never a false completed
  const text = readOwnStringField(resultRead.value, 'text');
  if (text === null) return { status: 'pending' };
  return { status: 'completed', text };
}
