/**
 * model-fetch — lazy, checksum-verified local model acquisition (SPEC-002, T007-T012).
 *
 * Lazily acquires the pinned `Xenova/all-MiniLM-L6-v2` model + tokenizer on
 * first local use, verifies each artifact's bytes against a SHA-256 pinned in
 * THIS source file (the trust anchor — the download host, default or
 * `CODEGRAPH_MODEL_BASE_URL`-overridden, is untrusted), and returns a usable
 * local path pair. Never throws (contract): every failure mode is a typed,
 * actionable {@link LocalModelUnavailable} the caller treats as an advisory
 * skip, mirroring `runEmbeddingPass`'s `{ aborted, abortReason }` posture.
 *
 * Verify-before-use, atomic acquisition (per artifact — see
 * specs/002-local-embedding-fallback/contracts/model-fetch.md):
 *   cached + sha256 verified?  -> reuse, no download (FR-018)
 *   else download to a temp file created EXCLUSIVELY (O_EXCL, unpredictable
 *   name, never follows a pre-existing symlink) under a byte + wall-clock
 *   budget (FR-013a) -> sha256 mismatch discards the temp, never promotes,
 *   never used (FR-014 / SC-003) -> atomic rename verified temp -> final path.
 *   A path that exists is therefore always complete + verified; a partial or
 *   interrupted acquisition is treated as absent and re-acquired.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash, randomBytes } from 'node:crypto';
import { SENSITIVE_SYSTEM_PATHS, isWithinDir } from '../utils';
import { redactEndpoint } from './config';

// --- Contract types (contracts/model-fetch.md) ------------------------------

/** Verified local paths for both artifacts. */
export interface LocalModelArtifacts {
  modelPath: string;
  tokenizerPath: string;
}

/** Distinct degrade reasons — each carries its own actionable message (FR-019/019a/017a). */
export type ModelUnavailableReason = 'offline' | 'checksum' | 'cache';

export interface LocalModelUnavailable {
  unavailable: ModelUnavailableReason;
  message: string;
}

// --- Pinned artifacts (T007) -------------------------------------------------

/** Immutable HF repo commit — the provenance anchor for both artifacts (research.md OQ-2). */
const HF_COMMIT = '751bff37182d3f1213fa05d7196b954e230abad9';

/** Commit-pinned default download base. CODEGRAPH_MODEL_BASE_URL overrides only the base (FR-015). */
const DEFAULT_BASE_URL = `https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/${HF_COMMIT}`;

/** Local cache subdirectory for this checkpoint (data-model.md §3 illustrative layout). */
const MODEL_DIR_NAME = 'all-MiniLM-L6-v2';

/** Download wall-clock timeout (FR-013a) — an internal constant, not operator-tunable (Principle II). */
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000;

/** A single downloaded, checksum-verified artifact (FR-013). */
export interface PinnedArtifact {
  /** Repo-relative path + filename, appended to the base URL. */
  relPath: string;
  /** Exact expected byte length — also the download size budget (FR-013a). */
  size: number;
  /** Pinned SHA-256 hex digest — the sole trust anchor for this artifact. */
  sha256: string;
}

/**
 * `onnx/model_quantized.onnx` — pinned SHA-256 known ahead of T007 (research.md OQ-2,
 * verified during the plan-phase spike).
 */
export const MODEL_ARTIFACT: PinnedArtifact = {
  relPath: 'onnx/model_quantized.onnx',
  size: 22_972_370,
  sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1',
};

/**
 * `tokenizer.json` — T007's blocking gate: fetched from the pinned commit
 * (`curl -L`, download-then-hash — never piped to an interpreter) and its
 * SHA-256 computed from the real bytes (cross-checked with `shasum -a 256` and
 * `openssl dgst -sha256`; byte size independently confirmed at 711,661).
 */
export const TOKENIZER_ARTIFACT: PinnedArtifact = {
  relPath: 'tokenizer.json',
  size: 711_661,
  sha256: 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0',
};

// --- Cache directory resolution (T009 / FR-016 / FR-017) --------------------

/**
 * Resolve the machine-wide model cache directory (FR-016's 4-case platform
 * formula), honoring `CODEGRAPH_MODEL_CACHE_DIR` (FR-017). Pure — no
 * filesystem access; validate the result with {@link validateModelCacheDir}
 * before use.
 *
 * Returns `null` when the ONLY location left is the `os.homedir()` fallback but
 * homedir is blank or non-absolute — reachable with `HOME=""` (os.homedir() then
 * returns '', see {@link userHomeForms}). Joining a blank home yields a RELATIVE
 * `.codegraph/models` that `path.resolve` would silently root under the process
 * CWD, dumping the ~22MB cache wherever CodeGraph was launched. `null` signals "no
 * usable default cache" so callers degrade as `cache` and point the user at
 * `CODEGRAPH_MODEL_CACHE_DIR`, rather than writing under CWD.
 *
 * A RELATIVE `XDG_CACHE_HOME` / `LOCALAPPDATA` is IGNORED (falls through to the home
 * default), matching the XDG Base Directory Specification — "All paths set in these
 * environment variables must be absolute … a relative path … should [be] consider[ed]
 * invalid and ignore[d]" — and so the same env value can't silently root the cache under
 * CWD either. The explicit `CODEGRAPH_MODEL_CACHE_DIR` override is held to a STRICTER bar: it is
 * honored only if it is a usable absolute, non-root path; a relative or filesystem-root override is
 * REJECTED (returns null → acquisition/status degrade as invalid-cache with "make it absolute"
 * guidance), NOT silently ignored — silently falling back to the default would use a DIFFERENT
 * cache than the operator explicitly set (and could report a verified default while their override
 * is invalid), and a relative value would root the ~22MB cache under CWD (FR-016). (An ABSOLUTE
 * override the user deliberately points at a project dir is their explicit, unpoliceable choice —
 * out of scope of the automatic formula.)
 */
export function resolveModelCacheDir(env: NodeJS.ProcessEnv): string | null {
  const override = env.CODEGRAPH_MODEL_CACHE_DIR?.trim();
  // An explicit override the user deliberately set is honored ONLY if it is a usable absolute,
  // non-root path. A relative or filesystem-root override is a misconfiguration → return null,
  // NOT a silent fall-through to the platform default (which would use a DIFFERENT cache than the
  // operator asked for, and could let status report a verified default while the configured
  // override is invalid). null makes acquisition/status degrade as invalid-cache with guidance.
  if (override) return isUsableCacheBase(override) ? override : null;

  if (process.platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim();
    if (localAppData && isUsableCacheBase(localAppData)) return path.join(localAppData, 'codegraph', 'models');
    const home = os.homedir();
    if (!isUsableCacheBase(home)) return null;
    return path.join(home, 'AppData', 'Local', 'codegraph', 'models');
  }

  const xdgCacheHome = env.XDG_CACHE_HOME?.trim();
  if (xdgCacheHome && isUsableCacheBase(xdgCacheHome)) return path.join(xdgCacheHome, 'codegraph', 'models');
  const home = os.homedir();
  if (!isUsableCacheBase(home)) return null;
  return path.join(home, '.codegraph', 'models');
}

/**
 * Whether a path is usable as the cache BASE dir — ABSOLUTE and NOT a filesystem root ('/', 'C:\').
 * A blank/relative base would root the ~22MB cache under CWD (FR-016: never inside a project's
 * `.codegraph/`); a filesystem-root base resolves the cache to `/.codegraph/models`, which the
 * exact-match-only sensitive-root guard doesn't catch. Mirrors the root refusal in
 * {@link userHomeForms}. A blank string is not absolute → false (isAbsolute short-circuits dirname).
 */
function isUsableCacheBase(dir: string): boolean {
  return path.isAbsolute(dir) && path.dirname(dir) !== dir;
}

/** Core SENSITIVE_SYSTEM_PATHS test (no firmlink normalization) — see {@link isSensitivePath}. */
function isSensitivePathRaw(resolved: string): boolean {
  const r = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  for (const sensitive of SENSITIVE_SYSTEM_PATHS) {
    const s = process.platform === 'win32' ? sensitive.toLowerCase() : sensitive;
    // A filesystem root ("/", "c:\") is sensitive only for an EXACT match — a
    // prefix match against a root would flag every absolute path as sensitive and
    // make all cache dirs unusable (isWithinDir now correctly treats a root as a
    // parent of everything). Non-root entries (/etc, /var, …) still prefix-match.
    if (path.dirname(s) === s) {
      if (r === s) return true;
      continue;
    }
    if (isWithinDir(resolved, sensitive)) return true;
  }
  return false;
}

/**
 * Whether `resolved` is at or under any {@link SENSITIVE_SYSTEM_PATHS} root (prefix match —
 * the cache is a write sink), accounting for the macOS `/private` firmlinks. On
 * macOS, `/etc`, `/var`, `/tmp` realpath to `/private/etc`, `/private/var`,
 * `/private/tmp` — which are NOT literally in `SENSITIVE_SYSTEM_PATHS` — so a symlinked
 * cache ancestor whose real target is `/etc` resolves to `/private/etc` and would
 * evade the raw check. Also test the `/private`-stripped form on darwin so the
 * firmlink alias still matches. Deliberately SPEC-002-scoped: it does NOT mutate the
 * shared `SENSITIVE_SYSTEM_PATHS` in src/utils.ts.
 */
function isSensitivePath(resolved: string): boolean {
  if (isSensitivePathRaw(resolved)) return true;
  if (process.platform === 'darwin' && resolved.startsWith('/private/')) {
    return isSensitivePathRaw(resolved.slice('/private'.length));
  }
  return false;
}

/**
 * The current user's home directory in BOTH its lexical (`path.resolve`) and realpath
 * (symlinks resolved) forms. The realpath form resolves the ostree/Silverblue
 * `/home`→`/var/home` firmlink; the lexical form matches a not-yet-realpathed cache path.
 * An unresolvable homedir yields an empty list — i.e. "no home to exempt", the strict default.
 */
function userHomeForms(): string[] {
  // Read os.homedir() ONCE and refuse to derive a home from a blank/relative value. With
  // HOME="" — reachable in some CI/container/systemd/cron shells — os.homedir() returns ''
  // (verified: libuv returns a defined-but-empty HOME verbatim rather than falling back to
  // getpwuid), and path.resolve('') would SILENTLY become process.cwd(). That would exempt
  // whatever directory the process happens to run from (e.g. /tmp), defeating the guard for a
  // sensitive/shared cwd. An unusable homedir yields NO home to exempt — the strict default.
  const home = os.homedir();
  if (!home || !path.isAbsolute(home)) return [];
  const forms: string[] = [];
  const add = (p: string): void => {
    // A filesystem root ('/', 'C:\') is NEVER a meaningful home to exempt: isWithinDir treats a
    // root as the parent of every path, so exempting it would disable the guard entirely (a
    // HOME=/ spoof). Require a real home SUBTREE. (Traversal like `~/../etc` is already collapsed
    // by path.resolve, and a within-home symlink escaping to /etc is caught by the realpath
    // re-check at the call sites — the lexical exemption is always paired with a realpath one.)
    if (path.dirname(p) !== p) forms.push(p);
  };
  const lexical = path.resolve(home);
  add(lexical);
  try {
    const real = fs.realpathSync(home);
    if (real !== lexical) add(real);
  } catch { /* homedir may not exist yet — the lexical form still applies */ }
  return forms;
}

/**
 * Whether `resolved` must be REFUSED as a sensitive system write-sink for the model cache
 * (FR-017a) — {@link isSensitivePath} — EXCEPT the current user's OWN home subtree. Running as
 * root makes os.homedir() `/root` (a SENSITIVE_SYSTEM_PATHS entry) and ostree/Silverblue realpaths home
 * under `/var/home/...`; the default cache lives under home in both, and it is the user's own
 * directory, never the shared/system/other-user location the guard protects — rejecting it would
 * break SPEC-002's zero-setup local embeddings on root/devcontainer/CI (and ostree). A path
 * OUTSIDE home (an `/etc` override, or `/root` when it is NOT the running user's home) still faces
 * the full guard. Matched against home's lexical AND realpath forms so a firmlinked/symlinked home
 * still exempts either the pre- or post-realpath path a caller passes. The only residual is a
 * self-inflicted, writability-gated HOME spoof (same-user, no privilege boundary — codegraph is
 * never setuid), which grants no capability the user lacks.
 */
function isSensitiveCacheDir(resolved: string): boolean {
  if (!isSensitivePath(resolved)) return false;
  return !userHomeForms().some((home) => isWithinDir(resolved, home));
}

/**
 * On POSIX, reject an EXISTING model-cache directory (or a fresh cache's nearest existing
 * ancestor) that is writable by GROUP or OTHER (mode bits `0o022`). That is the condition
 * that lets ANOTHER local user swap the SHA-256-verified model between verification and the
 * worker's re-open-by-path (`InferenceSession.create(modelPath)`) — a CROSS-user TOCTOU the
 * "same-user, no privilege boundary" residual below does NOT cover, since the swapped bytes
 * are then NOT the pinned model. codegraph creates its own cache dirs 0o700, so this only
 * bites a dir the user pointed `CODEGRAPH_MODEL_CACHE_DIR` at (or chmod'd) that others can
 * write. Windows has no equivalent mode bit here (LOCALAPPDATA is ACL-user-scoped), so this
 * is POSIX-only. A not-yet-created dir (ENOENT) is safe — acquisition creates it 0o700.
 * Returns a `cache`-degradation reason, or null when safe.
 *
 * Residual (accepted): a group/other-writable ANCESTOR further up the tree could still rename
 * the whole cache dir and substitute its own, and a same-user chmod after this check is a
 * same-user action (no privilege boundary — codegraph is never setuid). This guard closes the
 * common case (the write sink and its immediate real parent), consistent with the sensitive-
 * path guard that already refuses shared roots like /tmp and /var.
 */
function sharedWritableCacheReason(realDir: string): string | null {
  if (!isCrossUserWritable(realDir)) return null;
  return `refusing to use a model cache directory another local user could modify — group/other-writable or owned by a different user (they could swap the verified model): ${realDir} — make it yours at mode 0700, or set CODEGRAPH_MODEL_CACHE_DIR to a private path.`;
}

/**
 * POSIX cross-user-writable predicate over an ALREADY-obtained `Stats` — true when ANOTHER local
 * user could modify or replace the path (and thus swap a checksum-verified artifact between
 * verification and the worker's re-open-by-path). Two conditions, mirroring OpenSSH `StrictModes`
 * ("owned by the current user or the superuser and not group or world-writable"):
 *   1. group/other-writable (`mode & 0o022`) — someone in group/other can write it; OR
 *   2. owned by a user OTHER than the current uid AND other than root — that foreign owner can
 *      rewrite their own file even at mode 0644, which a mode-only check misses. Root-owned is
 *      TRUSTED (root is the TCB and can already compromise anything), so an admin-seeded 0644
 *      cache is NOT rejected.
 */
function statIsCrossUserWritable(stat: fs.Stats): boolean {
  if ((stat.mode & 0o022) !== 0) return true;
  const uid = process.getuid?.();
  return uid !== undefined && stat.uid !== uid && stat.uid !== 0;
}

/**
 * POSIX: whether an EXISTING path (directory OR file) could be modified/replaced by ANOTHER local
 * user — group/other-writable OR foreign-owned (see {@link statIsCrossUserWritable}). A stat
 * failure (absent / unstatable) → false: acquisition creates its own dirs 0o700 and files 0o600
 * owned by the current user, so a not-yet-existing path is not a rejection. Used to keep the WHOLE
 * cache tree private — the cache root ({@link sharedWritableCacheReason}), the checkpoint dir
 * ({@link artifactDirIsSafe}/{@link artifactDirIsSafeToProbe}), and each cached artifact file
 * ({@link fileExistsAndVerified}) — not just the root.
 *
 * Windows residual (ACCEPTED, POSIX-only guard): Node's `fs` exposes no NTFS ACL information —
 * `statSync().mode` on Windows is synthesized from the read-only attribute alone, NOT the DACL,
 * and there is no portable owner check — so neither test is expressible, and a real ACL check
 * would need a native addon, which SPEC-002 forbids (pure-JS/WASM only). The Windows DEFAULT
 * cache (`%LOCALAPPDATA%`) is already ACL-scoped to the current user; the only exposure is a user
 * who DELIBERATELY points `CODEGRAPH_MODEL_CACHE_DIR` at a shared NTFS location — the same class
 * of deliberate misconfiguration as the accepted POSIX self-chmod residual. So Windows → false.
 */
function isCrossUserWritable(realPath: string): boolean {
  if (process.platform === 'win32') return false;
  try {
    return statIsCrossUserWritable(fs.statSync(realPath));
  } catch {
    return false;
  }
}

/**
 * For a cache path that doesn't fully exist yet (FR-017a): walk UP to the nearest
 * EXISTING ancestor, `realpathSync` THAT (resolving every symlink in the real
 * portion of the path), rejoin the not-yet-existing suffix, and reject if either
 * the real ancestor or the reconstructed real path is sensitive — that is exactly
 * where a later `mkdirSync(recursive)` would create the cache. Returns null when
 * the real destination is safe (the common fresh-cache-dir case). Without this, an
 * existing PARENT component that is a symlink into a sensitive dir would slip past
 * the lexical check (which never touches the filesystem) because `realpathSync` on
 * the not-yet-existing leaf just throws ENOENT.
 */
function validateNearestExistingAncestor(resolved: string): string | null {
  let ancestor = path.dirname(resolved);
  const suffix = [path.basename(resolved)];
  for (;;) {
    let realAncestor: string;
    try {
      realAncestor = fs.realpathSync(ancestor);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        return `unable to resolve model cache directory: ${resolved}`;
      }
      // A dangling-symlink INTERMEDIATE ancestor exists as an entry (lstat OK) but realpath
      // ENOENTs, and it is exactly where a later mkdirSync(recursive) fails — reject it rather
      // than unshift its name and keep walking up to a resolvable real parent (which passes).
      try {
        fs.lstatSync(ancestor);
        return `unable to resolve model cache directory: ${resolved}`;
      } catch {
        /* genuinely absent ancestor — keep walking up */
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        // Reached the filesystem root with no existing ancestor — nothing on disk
        // to resolve a symlink through; the lexical check above already passed.
        return null;
      }
      suffix.unshift(path.basename(ancestor));
      ancestor = parent;
      continue;
    }
    // Nearest existing ancestor found. Its REAL path (symlinks resolved) rejoined
    // with the not-yet-existing suffix is where the cache would actually be created.
    const realResolved = path.join(realAncestor, ...suffix);
    if (isSensitiveCacheDir(realAncestor) || isSensitiveCacheDir(realResolved)) {
      return `refusing to use sensitive system directory as the model cache: ${realResolved}`;
    }
    // The nearest existing ancestor is where a later mkdirSync(recursive) creates the cache —
    // if IT is group/other-writable, another local user could plant/rename the cache dir, so
    // reject before any write (cross-user FR-017a hardening; the created dirs themselves are 0o700).
    const sharedReason = sharedWritableCacheReason(realAncestor);
    if (sharedReason !== null) return sharedReason;
    return null;
  }
}

/**
 * Validate a resolved model-cache directory (T009 / FR-017a): reject a path
 * that escapes via `../` or is AT OR UNDER a `SENSITIVE_SYSTEM_PATHS` root (PREFIX
 * match — the cache is a write sink — not exact match), evaluated after
 * realpath symlink resolution. Deliberately a purpose-built check rather than
 * reusing `validateProjectPath` verbatim: that validator also rejects
 * `~/.config`, which is a legitimate `XDG_CACHE_HOME` location
 * (research.md finding 1).
 *
 * @returns a self-contained error message, or null if the directory is safe to use.
 */
export function validateModelCacheDir(dirPath: string): string | null {
  const resolved = path.resolve(dirPath);
  if (isSensitiveCacheDir(resolved)) {
    return `refusing to use sensitive system directory as the model cache: ${resolved}`;
  }
  try {
    const real = fs.realpathSync(resolved);
    if (isSensitiveCacheDir(real)) {
      return `refusing to use sensitive system directory as the model cache: ${real}`;
    }
    // The cache root EXISTS (realpath resolved) — reject it if group/other-writable (FR-017a
    // cross-user hardening): another local user could otherwise swap the verified model.
    const sharedReason = sharedWritableCacheReason(real);
    if (sharedReason !== null) return sharedReason;
  } catch (err) {
    // Any resolution failure other than "doesn't exist yet" (ELOOP, EACCES, …) is
    // unsafe to proceed on.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      return `unable to resolve model cache directory: ${resolved}`;
    }
    // A dangling symlink (or a symlink chain to a missing target) also makes realpathSync
    // throw ENOENT even though the entry EXISTS (lstat succeeds), and mkdirSync(recursive)
    // fails ENOENT on it too — so acquisition degrades as `cache`. Reject it here so the
    // status probe AGREES, instead of walking PAST the leaf to its real parent and passing.
    try {
      fs.lstatSync(resolved);
      return `unable to resolve model cache directory: ${resolved}`;
    } catch {
      /* truly absent leaf — the common fresh-cache case; fall through to the ancestor walk */
    }
    // ENOENT: the leaf (and maybe several parents) doesn't exist yet, so the full
    // realpath couldn't resolve it. A later mkdirSync(recursive) creates the missing
    // suffix UNDER whatever the nearest EXISTING ancestor really is — resolve that
    // ancestor and re-validate the reconstructed real path (a symlinked ancestor into
    // a sensitive dir is otherwise missed by the lexical check above).
    return validateNearestExistingAncestor(resolved);
  }
  return null;
}

// --- Base URL resolution (T011 / FR-015) -------------------------------------

type BaseUrlResult = { ok: true; url: string } | { ok: false; message: string };

/**
 * Resolve the download base URL: `CODEGRAPH_MODEL_BASE_URL` overrides the
 * default (FR-015), constrained to an `http`/`https` scheme only — `file:`,
 * `ftp:`, `data:`, etc. are rejected as invalid config (never attempted).
 * Never echoes the raw override string (only its scheme token), so a
 * malformed/credentialed override cannot leak through this message.
 */
function resolveBaseUrl(env: NodeJS.ProcessEnv, defaultBaseUrl: string): BaseUrlResult {
  const override = env.CODEGRAPH_MODEL_BASE_URL?.trim();
  if (!override) return { ok: true, url: defaultBaseUrl };

  let parsed: URL;
  try {
    parsed = new URL(override);
  } catch {
    return { ok: false, message: 'CODEGRAPH_MODEL_BASE_URL is not a valid URL.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, message: `CODEGRAPH_MODEL_BASE_URL must use http or https (got "${parsed.protocol}").` };
  }
  return { ok: true, url: override };
}

// --- Actionable messages (T012 / FR-019 / FR-019a / FR-019c) ----------------
//
// Three lead phrases keep the reasons textually distinct; none ever echoes
// source text or composed embedding input (FR-019c) — only cache paths and a
// REDACTED (scheme+host+port) base URL, via SPEC-001's redactEndpoint.

function artifactPath(cacheDir: string, artifact: PinnedArtifact): string {
  return path.join(cacheDir, MODEL_DIR_NAME, path.basename(artifact.relPath));
}

function offlineMessage(cacheDir: string, baseUrl: string, artifact: PinnedArtifact): string {
  const finalPath = artifactPath(cacheDir, artifact);
  return (
    `Local embedding model unavailable: could not download ${path.basename(artifact.relPath)} from ` +
    `${redactEndpoint(baseUrl)} (override with CODEGRAPH_MODEL_BASE_URL). ` +
    `Checked cache directory: ${cacheDir} (override with CODEGRAPH_MODEL_CACHE_DIR). ` +
    `To use the local embedding provider offline, place a verified copy at ${finalPath} and re-run.`
  );
}

function checksumMessage(baseUrl: string, artifact: PinnedArtifact): string {
  return (
    `Local embedding model download failed SHA-256 verification for ${path.basename(artifact.relPath)} ` +
    `and was discarded (possible corruption, or an incorrect/tampered mirror). Retry, or check the ` +
    `CODEGRAPH_MODEL_BASE_URL override (currently resolving to ${redactEndpoint(baseUrl)}).`
  );
}

function cacheMessage(cacheDir: string): string {
  return `Local embedding model cache directory is unwritable or invalid: ${cacheDir} (override with CODEGRAPH_MODEL_CACHE_DIR).`;
}

// --- Filesystem primitives (T010 / FR-014 / FR-017a) -------------------------

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Per-process memo of paths already SHA-256 verified successfully in THIS run
 * (by their {size, mtimeMs} at verification time), keyed by BOTH the path and the
 * expected sha256 (see {@link verifiedCacheKey}). `maybeRunEmbeddingPass` builds a
 * fresh `LocalProvider` — and re-acquires the model — on every indexing/sync pass,
 * which otherwise re-reads and re-hashes the whole ~22MB model on the main thread
 * every time (a repeated event-loop block). A file whose current stat still matches
 * its last verification is trusted without a full re-read; one whose size or mtime
 * has moved is always fully re-hashed.
 */
type VerifiedStatIdentity = { size: number; mtimeMs: number; ctimeMs: number; ino: number; dev: number; mode: number };
const verifiedArtifacts = new Map<string, VerifiedStatIdentity>();

/** Full stat identity memoized for a verified artifact — any drift forces a re-hash. */
function statIdentity(stat: fs.Stats): VerifiedStatIdentity {
  return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino, dev: stat.dev, mode: stat.mode };
}

/**
 * Memo key = absolute path + the EXPECTED sha256. Including the digest means a
 * re-pin (or a different artifact resolved to the same path) re-verifies from
 * scratch rather than trusting a stat match recorded against the OLD pin.
 */
function verifiedCacheKey(filePath: string, expectedSha256: string): string {
  return `${filePath}:${expectedSha256}`;
}

/**
 * Re-verified the first time a path is seen (or after it changes) — a
 * stale/tampered file is never trusted. Two cheap guards precede any full read:
 *  1. `fs.statSync` FIRST: if the size doesn't match the pinned artifact's, return
 *     not-verified WITHOUT reading. A wrong-size file can never hash to the pinned
 *     digest, and this bounds the read so an enormous/corrupt cache file can't
 *     stall or OOM the process before the hash even runs.
 *  2. the (path, sha)-keyed memo: an exact (path, sha, size, mtimeMs) match against
 *     a prior successful verification in this process skips the full read+hash. Any
 *     other outcome (never verified, or the stat has moved) falls through.
 * Residual: a local tamper preserving BOTH size AND mtime in a user-owned cache
 * would be trusted by the memo — out of scope here; the download-time SHA-256 verify
 * in {@link acquireArtifact} is the real trust anchor, this is only a per-process
 * re-read optimization. The lstat→readFileSync gap is the SAME accepted class, not a
 * distinct one: a same-user swap of the sized regular file for a symlink/oversized file
 * between those two syscalls can at worst force a transient self-inflicted read (Node
 * caps `readFileSync` at buffer MAX_LENGTH and throws → caught → not-verified →
 * re-download), never acceptance of unpinned bytes (the sha256 gate holds) and never a
 * capability that same-user attacker lacks (no privilege boundary — codegraph is never
 * setuid; it can already exhaust its own memory). The verified bytes are DISCARDED; the
 * load-bearing read is the worker's later re-open BY PATH, whose verify→use window is the
 * {@link artifactDirIsSafe} residual already accepted above — closing this gap alone
 * (e.g. an O_NOFOLLOW+fstat read here) would harden a throwaway read while that window
 * stays open, shipping false assurance rather than real defense.
 */
function fileExistsAndVerified(filePath: string, artifact: PinnedArtifact): boolean {
  try {
    // lstat, NOT stat: a symlink at the artifact FILE path is never something acquisition
    // creates (it writes real files via atomic rename), and following one could read/accept
    // bytes from OUTSIDE the validated cache root (or a target swapped after verification).
    // Require a regular file — reject a symlink, directory, device, etc.
    const stat = fs.lstatSync(filePath);
    const key = verifiedCacheKey(filePath, artifact.sha256);
    if (!stat.isFile()) {
      verifiedArtifacts.delete(key);
      return false;
    }
    // An artifact file another local user could swap — group/other-writable OR foreign-owned —
    // must be rejected before trusting its bytes (the swap window is verification → worker
    // re-open-by-path). POSIX only; the regular-file lstat above IS the file's own stat.
    if (process.platform !== 'win32' && statIsCrossUserWritable(stat)) {
      verifiedArtifacts.delete(key);
      return false;
    }
    // Size pre-check (bounds the read + cheaply catches size tampering): a wrong-size
    // file can never match the pinned digest, so reject it before any (huge) read.
    if (stat.size !== artifact.size) {
      verifiedArtifacts.delete(key);
      return false;
    }
    // Reuse a prior in-process verification ONLY when the full stat identity is unchanged.
    // size+mtime alone is spoofable — `touch -r` clones mtime, and a swap-in preserves size —
    // so also pin ctimeMs (bumps on any metadata change incl. chmod), ino+dev (a replaced
    // file is a different inode), and mode. Any drift busts the memo and forces a re-hash,
    // preserving the checksum-before-use guarantee (FR-014/SC-003) while keeping the fast
    // path for a genuinely untouched cache file.
    const prior = verifiedArtifacts.get(key);
    if (
      prior &&
      prior.size === stat.size &&
      prior.mtimeMs === stat.mtimeMs &&
      prior.ctimeMs === stat.ctimeMs &&
      prior.ino === stat.ino &&
      prior.dev === stat.dev &&
      prior.mode === stat.mode
    ) {
      return true;
    }
    const bytes = fs.readFileSync(filePath);
    const verified = sha256Hex(bytes) === artifact.sha256;
    if (verified) {
      verifiedArtifacts.set(key, statIdentity(stat));
    } else {
      verifiedArtifacts.delete(key);
    }
    return verified;
  } catch {
    return false;
  }
}

function safeUnlink(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch {
    /* best-effort discard */
  }
}

function writeAllSync(fd: number, buf: Buffer): void {
  let offset = 0;
  while (offset < buf.length) {
    offset += fs.writeSync(fd, buf, offset, buf.length - offset);
  }
}

/**
 * Write `bytes` to a temp file created EXCLUSIVELY under `dir` (FR-017a):
 * `'wx'` (`O_CREAT|O_EXCL|O_WRONLY`) fails if the path exists — no clobber —
 * and per POSIX `open(2)`, O_EXCL+O_CREAT on an existing symlink also fails
 * rather than following it. The 16-byte random suffix makes the name
 * unpredictable, so a pre-planted symlink/file cannot be positioned in
 * advance to win the race.
 */
function writeExclusiveTemp(dir: string, bytes: Buffer): string {
  // 0o700 (private): a cache dir another local user can write is how they'd swap the
  // checksum-verified model between verification and the worker's re-open (cross-user
  // TOCTOU). Applied to every level `recursive` creates, and NOT masked away by a lax
  // umask (0o700 has no group/other bits for umask to clear).
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 5; attempt++) {
    const tempPath = path.join(dir, `.tmp-${randomBytes(16).toString('hex')}`);
    let fd: number;
    try {
      // 0o600 (private): the atomic rename preserves this mode onto the final artifact, so a
      // cached model/tokenizer is never group/other-writable — another local user cannot swap it
      // in the verify→worker-reopen window. Umask-independent (0o600 has no group/other bits).
      fd = fs.openSync(tempPath, 'wx', 0o600);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw err;
    }
    // A mid-write (disk-full/interrupted) OR close failure must not leave the
    // exclusively-created temp file behind: on either error, discard the
    // partial blob before rethrowing so retries can't accumulate leaked
    // `.tmp-*` files in the cache dir.
    let failure: unknown;
    try {
      writeAllSync(fd, bytes);
    } catch (err) {
      failure = err;
    }
    try {
      fs.closeSync(fd);
    } catch (err) {
      failure ??= err;
    }
    if (failure) {
      safeUnlink(tempPath);
      throw failure;
    }
    return tempPath;
  }
  throw new Error('unable to create a unique temp file for model acquisition');
}

/**
 * Download `url`, bounded by (a) a max byte budget — abort once streamed
 * bytes exceed `maxBytes` — and (b) a wall-clock timeout (FR-013a). Both
 * bounds convert a hostile/MITM/slow host into a thrown error the caller
 * degrades as unavailability, never an unbounded hang or unbounded buffer.
 */
async function downloadWithBudget(url: string, fetchImpl: typeof fetch, maxBytes: number, timeoutMs: number, signal?: AbortSignal): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Forward an external abort (LocalProvider.close()) onto the timeout controller so an
  // in-flight download is cancelled PROMPTLY rather than running out its wall-clock budget
  // after the caller tore down. `{ once: true }` self-removes on fire; the finally
  // removeEventListener covers a normal completion, so the listener never lingers on the
  // (per-pass, shared-across-both-artifacts) signal.
  const onExternalAbort = (): void => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    const body = response.body;
    if (!response.ok || !body) {
      // Cancel the un-read body so undici releases the connection PROMPTLY (no leaked socket, no
      // "body not consumed" warning) — a non-2xx mirror can attach a long/streaming body we never
      // intend to read. Awaited while the timeout above is still active, so cleanup is bounded too.
      await body?.cancel('non-ok response').catch(() => undefined);
      throw new Error(`download failed: HTTP ${response.status}`);
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel('exceeded expected artifact size').catch(() => undefined);
          throw new Error('download exceeded the expected artifact size');
        }
        chunks.push(value);
      }
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Guard the actual write sink before any read or write (P1-a / FR-017a).
 * `validateModelCacheDir` vetted only the cache ROOT, but every artifact lands in
 * `<cacheDir>/all-MiniLM-L6-v2` (the per-checkpoint subdir). If THAT subdir was
 * pre-planted as a symlink, `mkdirSync(recursive)` is a silent no-op on it and the
 * temp-write + atomic rename would follow it OUT of the validated root — a TOCTOU the
 * root-only check misses. After ensuring the artifact dir exists, realpath it and
 * require the real target to be (a) NOT sensitive AND (b) still inside the realpath of
 * the validated cache root; otherwise it is unsafe to write and the caller degrades as
 * `cache` (never writing).
 */
// Residual TOCTOU (accepted, out of scope — mirrors fileExistsAndVerified's documented
// residual): this realpath + within-root check is a point-in-time validation. The path it
// blesses is a STRING the kernel re-resolves at every later openSync/renameSync, so an
// attacker who can already write the cache root could rmdir this dir and replace it with a
// symlink in the window before the temp-write/rename, redirecting the write. Fully closing it
// needs openat(2)/renameat(2) against a held O_DIRECTORY fd — not exposed by Node's fs — and a
// dev/ino recheck only narrows (never closes) the window. Not defended because it requires
// same-user cache-write authority (no privilege boundary — codegraph is never setuid) and the
// promoted bytes are the SHA-256-verified PUBLIC pinned model, so a redirect grants the
// attacker no capability they lack (they could already write those bytes anywhere the user can).
function artifactDirIsSafe(cacheDir: string): boolean {
  const artifactDir = path.join(cacheDir, MODEL_DIR_NAME);
  try {
    // 0o700 (private): keep the checkpoint dir and any cache-root levels created here
    // unwritable by group/other, so no other local user can plant/swap an artifact.
    fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
    const realArtifactDir = fs.realpathSync(artifactDir);
    const realCacheRoot = fs.realpathSync(cacheDir);
    if (isSensitiveCacheDir(realArtifactDir)) return false;
    // A group/other-writable checkpoint dir lets another local user plant/swap the artifact
    // even under a private root — reject it (cross-user FR-017a; created dirs are 0o700).
    if (isCrossUserWritable(realArtifactDir)) return false;
    return isWithinDir(realArtifactDir, realCacheRoot);
  } catch {
    // A dangling symlink (mkdir EEXIST), an unresolvable realpath (ELOOP), or any
    // other error is unsafe to write through — treat as not safe.
    return false;
  }
}

/**
 * A `.tmp-*` file older than this is treated as a leak from a process killed AFTER
 * `writeExclusiveTemp` created it but BEFORE the rename/unlink cleaned it up. The threshold is
 * deliberately far longer than any live acquisition (download budget is seconds/low-minutes), so
 * a CONCURRENT acquisition's in-flight temp — freshly created, unpredictable name — is never
 * pruned out from under it.
 */
const STALE_TEMP_AGE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Remove stale `.tmp-*` leaks from the checkpoint dir before a new acquisition (FR-017a hygiene).
 * A successful download renames its temp onto the final artifact and a handled error unlinks it,
 * but a process KILLED between those points leaves a ~23MB `.tmp-<random>` behind that no later
 * run reuses (unpredictable name) — repeated interruptions would accumulate. `lstat` (never
 * follow a symlink), regular files only, and an age threshold so a live concurrent temp is spared.
 * Best-effort: any readdir/lstat/unlink failure is ignored (acquisition surfaces real errors).
 */
function pruneStaleTempFiles(dir: string, now: number): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith('.tmp-')) continue;
    const p = path.join(dir, name);
    try {
      const st = fs.lstatSync(p);
      if (!st.isFile()) continue; // a symlink/dir at a .tmp-* name is never our temp — leave it
      if (now - st.mtimeMs < STALE_TEMP_AGE_MS) continue; // spare a possibly-live concurrent temp
      fs.unlinkSync(p);
    } catch {
      // racing unlink / vanished / permission — best-effort pruning
    }
  }
}

/**
 * Whether a cached artifact FILE exists (as a regular file) but is group/other-writable — the
 * exact reason {@link fileExistsAndVerified} rejects it. Lets callers distinguish a PERMISSION
 * problem (fix: chmod 0600 / a private cache) from a genuinely absent cache, so status/acquisition
 * give "tighten permissions" guidance instead of the misleading `missing`→`offline` "retry
 * download". POSIX-only via {@link isGroupOrOtherWritable}; a missing/non-regular path → false.
 */
function fileIsInsecure(filePath: string): boolean {
  try {
    if (!fs.lstatSync(filePath).isFile()) return false;
  } catch {
    return false;
  }
  return isCrossUserWritable(filePath);
}

/**
 * Whether a path already exists as something acquisition can NEVER promote over — a directory,
 * device, fifo, or socket (anything that is neither a regular file nor a symlink). The atomic
 * `renameSync` below won't replace such a target and `safeUnlink` can't remove it (it declines a
 * directory), so a download would be wasted and every retry would re-download while promotion keeps
 * failing. Callers fail fast as `cache` (acquisition) / report `invalid-cache` (status) instead of
 * the misleading `missing`→`offline` "retry download". A regular file (stale/corrupt) and a symlink
 * ARE promotable — the rename replaces them (POSIX) or the unlink-and-retry does (Windows) — so both
 * return false. An absent path → false (the normal download path). `lstat` is cross-platform here.
 */
function pathIsUnpromotable(filePath: string): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    return !stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

// --- Per-artifact acquisition (T010 — the verify-before-use state machine) --

type ArtifactOutcome = { ok: true; path: string } | { ok: false; unavailable: ModelUnavailableReason; message: string };

async function acquireArtifact(
  artifact: PinnedArtifact,
  cacheDir: string,
  baseUrlResult: BaseUrlResult,
  fetchImpl: typeof fetch,
  downloadTimeoutMs: number,
  signal?: AbortSignal,
): Promise<ArtifactOutcome> {
  const finalPath = artifactPath(cacheDir, artifact);

  // 1. Guard the real write sink (P1-a): validateModelCacheDir vetted only the cache
  //    ROOT, but artifacts land in <cacheDir>/all-MiniLM-L6-v2. A pre-planted symlink
  //    at that subdir would redirect the temp-write + rename below out of the validated
  //    root, so re-validate the REAL artifact dir before reading or writing through it.
  if (!artifactDirIsSafe(cacheDir)) {
    return { ok: false, unavailable: 'cache', message: cacheMessage(cacheDir) };
  }

  // Clean up `.tmp-*` leaks from a previously-killed acquisition before writing a new temp,
  // so repeated interruptions don't accumulate ~23MB files in the checkpoint dir (best-effort).
  pruneStaleTempFiles(path.dirname(finalPath), Date.now());

  // 2. Reuse if present AND verified (FR-018) — re-verified on every call, not
  //    a bare existence check. A stale/partial/tampered file at this exact
  //    path is never trusted; it is superseded by a fresh download below. This
  //    reuse check runs BEFORE the base-URL override is validated, so a fully
  //    pre-seeded/offline model is reused with no download even under an invalid
  //    CODEGRAPH_MODEL_BASE_URL (the override only gates the download path below).
  if (fileExistsAndVerified(finalPath, artifact)) {
    return { ok: true, path: finalPath };
  }

  // A file that EXISTS but is group/other-writable was just rejected as untrusted (another local
  // user could swap it). Fail as `cache` with the actionable fix — chmod / private cache — rather
  // than silently re-downloading; the status probe agrees (insecure-permissions), and a permission
  // problem is never masked as an `offline` "retry download".
  if (fileIsInsecure(finalPath)) {
    return {
      ok: false,
      unavailable: 'cache',
      message: `refusing to reuse a cached model file another local user could swap — group/other-writable or owned by a different user: ${finalPath} — make it yours at mode 0600, or set CODEGRAPH_MODEL_CACHE_DIR to a private path.`,
    };
  }

  // A non-file, non-symlink already at the artifact path (a directory, device, fifo, …) can never be
  // promoted over: the atomic rename below won't replace it and safeUnlink can't remove it, so a
  // download would be wasted and every retry would re-download. Fail fast as `cache` BEFORE any fetch
  // — probeLocalModelCache agrees (invalid-cache), so status gives the right FR-020 reason instead of
  // a misleading `offline`/`missing` "retry download".
  if (pathIsUnpromotable(finalPath)) {
    return {
      ok: false,
      unavailable: 'cache',
      message: `refusing to use the model cache: a non-file (directory or special file) already occupies the artifact path: ${finalPath} — remove it, or set CODEGRAPH_MODEL_CACHE_DIR to a clean private path.`,
    };
  }

  // 3. A download is required → the checkpoint dir must be a usable write sink FIRST
  //    (writable + searchable). Fail as `cache` BEFORE any fetch — matching the status probe
  //    (probeLocalModelCache) — rather than attempting a download whose temp-write would fail,
  //    or masking an unwritable cache as `offline` when the network also happens to be down.
  if (!cacheDirIsWritable(path.dirname(finalPath))) {
    return { ok: false, unavailable: 'cache', message: cacheMessage(cacheDir) };
  }

  // 4. NOW the base URL override must be valid (FR-015). A bad override never blocks reuse
  //    above, only a fresh fetch here.
  if (!baseUrlResult.ok) {
    return { ok: false, unavailable: 'offline', message: baseUrlResult.message };
  }
  const baseUrl = baseUrlResult.url;

  // Download to a temp file, bounded by size + wall-clock (FR-013a).
  // Join relPath onto the base URL's PATH (not a bare string append): a mirror override may
  // carry ?query/#fragment (e.g. a signed `?token=…`), which a string concat would absorb into
  // the query value — requesting `…?token=abc/onnx/model.onnx`. baseUrl is always parseable
  // (the pinned default or an override validated via `new URL` in resolveBaseUrl). A trailing
  // slash trims to a single separator; a root `/` pathname collapses to `` so there is no `//`.
  const u = new URL(baseUrl);
  u.pathname = `${u.pathname.replace(/\/+$/, '')}/${artifact.relPath}`;
  const url = u.toString();
  let bytes: Buffer;
  try {
    bytes = await downloadWithBudget(url, fetchImpl, artifact.size, downloadTimeoutMs, signal);
  } catch {
    return { ok: false, unavailable: 'offline', message: offlineMessage(cacheDir, baseUrl, artifact) };
  }

  // Honor a cancellation that landed DURING the download (the forwarded signal already cancels the
  // fetch, but a cancel arriving just as the bytes resolve must not still write + promote a cache
  // file after shutdown was requested). Bail before any disk mutation; the provider's closed-check
  // then turns this into the terminal "closed" error.
  if (signal?.aborted) {
    return { ok: false, unavailable: 'cache', message: 'local embedding model acquisition was cancelled.' };
  }

  // Write to an exclusively-created, unpredictable temp file (FR-017a). A
  // mid-write I/O failure (disk-full, permission race) is the `cache` reason,
  // not `offline` — the download itself succeeded.
  let tempPath: string;
  try {
    tempPath = writeExclusiveTemp(path.dirname(finalPath), bytes);
  } catch {
    return { ok: false, unavailable: 'cache', message: cacheMessage(cacheDir) };
  }

  // 4. Verify BEFORE any use (FR-014). A mismatch discards the temp — never
  //    promoted, never opened, never used (SC-003). This first check is on the
  //    in-memory download buffer (fail-fast on an untrusted-mirror/network fault).
  if (sha256Hex(bytes) !== artifact.sha256) {
    safeUnlink(tempPath);
    return { ok: false, unavailable: 'checksum', message: checksumMessage(baseUrl, artifact) };
  }

  // 4b. Re-verify the ON-DISK temp — the file we are about to PROMOTE and that the worker later
  //     loads BY PATH with no re-check. The in-memory check alone assumes a faithful write; a
  //     silent write corruption (or a same-user tamper of the temp before promotion) would
  //     otherwise rename unverified bytes into the cache and use them for a whole pass before the
  //     next run's fileExistsAndVerified re-hash catches it. Read back the unpredictable O_EXCL
  //     temp path; a same-user symlink-swap of that path is the documented accepted residual, but
  //     this closes the far likelier non-adversarial corruption gap so the "always complete+
  //     verified" invariant below actually holds for the promoted file.
  let onDisk: Buffer;
  try {
    onDisk = fs.readFileSync(tempPath);
  } catch {
    safeUnlink(tempPath);
    return { ok: false, unavailable: 'cache', message: cacheMessage(cacheDir) };
  }
  if (onDisk.length !== artifact.size || sha256Hex(onDisk) !== artifact.sha256) {
    safeUnlink(tempPath);
    return { ok: false, unavailable: 'checksum', message: checksumMessage(baseUrl, artifact) };
  }

  // 5. Atomic promote: rename the verified temp into place (same directory,
  //    so the rename is atomic). A partial/interrupted acquisition never
  //    reaches this line, so a file at `finalPath` is always complete+verified.
  try {
    fs.renameSync(tempPath, finalPath);
  } catch {
    // On POSIX rename atomically REPLACES an existing finalPath, so this path is rarely hit.
    // On Windows renameSync onto an existing/open destination fails (EPERM/EACCES/EBUSY).
    // (1) A CONCURRENT acquirer may have promoted the verified artifact first — use it.
    if (fileExistsAndVerified(finalPath, artifact)) {
      safeUnlink(tempPath);
      return { ok: true, path: finalPath };
    }
    // (2) Otherwise finalPath is a STALE/CORRUPT/wrong-size/symlink leftover (unverified) that
    //     Windows rename-over-existing won't replace. Without removing it, a bad cache would
    //     PERMANENTLY block local embeddings on Windows (every run re-downloads a verified temp,
    //     the rename keeps failing, and the fresh bytes are discarded). POSIX already self-healed
    //     via the atomic replace above; remove the leftover and retry the promote so Windows does
    //     too. safeUnlink removes a corrupt regular file or a symlink (never a directory it holds).
    try {
      safeUnlink(finalPath);
      fs.renameSync(tempPath, finalPath);
      // Retry succeeded → fall through to the verified-cache warm + `return ok` below.
    } catch {
      safeUnlink(tempPath);
      // A concurrent winner may have promoted during the unlink→retry window — accept it.
      if (fileExistsAndVerified(finalPath, artifact)) {
        return { ok: true, path: finalPath };
      }
      return { ok: false, unavailable: 'cache', message: cacheMessage(cacheDir) };
    }
  }

  // Warm the verified-artifact cache immediately: this download already fully
  // hashed `bytes` above, so an immediate next pass's fileExistsAndVerified can
  // trust it via the cheap stat pre-check rather than re-hashing right away.
  // Best-effort — a stat failure here just means the next call re-verifies.
  try {
    const finalStat = fs.statSync(finalPath);
    verifiedArtifacts.set(verifiedCacheKey(finalPath, artifact.sha256), statIdentity(finalStat));
  } catch {
    /* best-effort cache warm */
  }

  return { ok: true, path: finalPath };
}

// --- Public entry point (contract) ------------------------------------------

/**
 * Test-only knobs so acquisition can be exercised hermetically (no real
 * network, no real ~22MB pin — SHA-256 preimage resistance makes hand-crafted
 * bytes matching the production digests infeasible). Production callers pass
 * only `{ env }`; every field here defaults to the real production behavior.
 */
export interface AcquireLocalModelOverrides {
  /** Injected fetch so tests never touch the real network. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Download wall-clock timeout in ms. Defaults to DEFAULT_DOWNLOAD_TIMEOUT_MS (not operator-tunable). */
  downloadTimeoutMs?: number;
  /** Substitute artifact specs. Defaults to the real MODEL_ARTIFACT/TOKENIZER_ARTIFACT pins. */
  artifacts?: { model: PinnedArtifact; tokenizer: PinnedArtifact };
  /** Substitute the default (commit-pinned) base URL. Defaults to DEFAULT_BASE_URL. */
  defaultBaseUrl?: string;
}

/**
 * Lazily acquire the pinned local embedding model + tokenizer (contract:
 * contracts/model-fetch.md). Never throws — every failure degrades to a
 * typed, actionable {@link LocalModelUnavailable}.
 */
export async function acquireLocalModel(
  opts: { env: NodeJS.ProcessEnv; signal?: AbortSignal },
  overrides: AcquireLocalModelOverrides = {},
): Promise<LocalModelArtifacts | LocalModelUnavailable> {
  try {
    const env = opts.env;
    const signal = opts.signal;
    const fetchImpl = overrides.fetchImpl ?? fetch;
    const downloadTimeoutMs = overrides.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
    const { model, tokenizer } = overrides.artifacts ?? { model: MODEL_ARTIFACT, tokenizer: TOKENIZER_ARTIFACT };
    const defaultBaseUrl = overrides.defaultBaseUrl ?? DEFAULT_BASE_URL;

    // 1. Resolve + validate the cache dir (FR-016/017/017a) BEFORE any network
    //    or artifact work — an invalid/sensitive cache dir never even attempts fetch.
    const resolvedCacheDir = resolveModelCacheDir(env);
    if (resolvedCacheDir === null) {
      // No usable cache location: a blank/root HOME with no override, OR a relative/root
      // CODEGRAPH_MODEL_CACHE_DIR (rejected rather than silently used, and never written under CWD).
      // Degrade as `cache` with actionable guidance instead of dumping the ~22MB cache under CWD.
      return { unavailable: 'cache', message: 'no usable model cache directory: set CODEGRAPH_MODEL_CACHE_DIR to an absolute path.' };
    }
    const cacheDir = path.resolve(resolvedCacheDir);
    const cacheDirError = validateModelCacheDir(cacheDir);
    if (cacheDirError !== null) {
      return { unavailable: 'cache', message: `${cacheDirError} (override with CODEGRAPH_MODEL_CACHE_DIR).` };
    }

    // Resolve the base URL (FR-015). Its scheme is validated ONLY in the download
    // path (acquireArtifact), NOT up-front — so a verified/pre-seeded cache is reused
    // with no download even under an invalid CODEGRAPH_MODEL_BASE_URL override (FR-018
    // reuse-first). A bad override still fails a genuinely-needed fetch as `offline`.
    // This is consistent with FR-015's intent, not a gap: the scheme constraint exists to
    // bound the OUTBOUND REQUEST's SSRF/exfil surface, and a warm cache issues no request —
    // there is nothing to constrain, so an unused invalid override must not break reuse.
    const baseUrlResult = resolveBaseUrl(env, defaultBaseUrl);

    const modelResult = await acquireArtifact(model, cacheDir, baseUrlResult, fetchImpl, downloadTimeoutMs, signal);
    if (!modelResult.ok) return { unavailable: modelResult.unavailable, message: modelResult.message };

    // A cancellation between artifacts must skip the tokenizer's SEPARATE download — otherwise
    // close() during the model (or a cache-hit model) still pays a full second download before the
    // provider's closed-check fires.
    if (signal?.aborted) return { unavailable: 'cache', message: 'local embedding model acquisition was cancelled.' };

    const tokenizerResult = await acquireArtifact(tokenizer, cacheDir, baseUrlResult, fetchImpl, downloadTimeoutMs, signal);
    if (!tokenizerResult.ok) return { unavailable: tokenizerResult.unavailable, message: tokenizerResult.message };

    return { modelPath: modelResult.path, tokenizerPath: tokenizerResult.path };
  } catch {
    // Defensive backstop (contract: never throws). Deliberately generic — an
    // unexpected internal error's message is never echoed, matching FR-019c's
    // no-echo posture.
    return {
      unavailable: 'cache',
      message: 'Local embedding model acquisition failed unexpectedly; check the resolved cache directory and CODEGRAPH_MODEL_CACHE_DIR.',
    };
  }
}

// --- Status-time cache probe (T022 / FR-020) --------------------------------

/**
 * Network-free, best-effort probe of the resolved model cache — lets
 * `codegraph status` (FR-020) explain a 0%-coverage local-provider skip
 * WITHOUT attempting a download or spawning acquisition. Mirrors
 * `acquireArtifact`'s own cache-reuse check (re-verified on every call, not a
 * bare existence check) for BOTH pinned artifacts, but never touches the
 * network:
 *  - `'invalid-cache'` — the resolved cache directory itself fails validation
 *    (FR-017a: traversal / sensitive-path / unresolvable), OR it exists but is not a
 *    writable directory / its nearest existing ancestor is unwritable (P2-a: a
 *    permissions problem, surfaced as `cache` rather than a misleading `offline`);
 *  - `'verified'` — both the model and tokenizer are present and checksum-verified;
 *  - `'missing'` — the cache dir is fine but at least one artifact is absent or
 *    fails verification. This single bucket deliberately folds "never
 *    attempted", "offline", and "checksum-mismatch" together: a failed
 *    download's bytes are ALWAYS discarded before promotion (FR-014), so none
 *    of those three leave a distinguishable trace in the cache — FR-020's own
 *    allowance for a generic reason when the transient one isn't persisted.
 */
export type LocalModelCacheProbe = 'verified' | 'missing' | 'invalid-cache' | 'invalid-base-url' | 'insecure-permissions';

/**
 * Test-only artifact substitution for {@link probeLocalModelCache} — mirrors
 * {@link AcquireLocalModelOverrides.artifacts} for the same reason (SHA-256
 * preimage resistance makes the real ~22MB pin infeasible to satisfy by hand).
 */
export interface ProbeLocalModelCacheOverrides {
  artifacts?: { model: PinnedArtifact; tokenizer: PinnedArtifact };
}

/**
 * Whether the resolved cache dir is a usable WRITE target for acquisition (P2-a).
 * `validateModelCacheDir` only rejects traversal/sensitive/unresolvable paths — it does
 * NOT check permissions or type, so an unwritable or non-directory cache would otherwise
 * be reported as `missing` (→ status "offline/not downloaded") when the real cause is the
 * cache itself. An EXISTING path must be a writable directory; a not-yet-existing one
 * needs its nearest existing ancestor writable (that's where a later `mkdirSync(recursive)`
 * lands). Any permission/type failure returns false so the probe reports `invalid-cache`.
 */
function cacheDirIsWritable(cacheDir: string): boolean {
  let current = cacheDir;
  for (;;) {
    try {
      if (!fs.statSync(current).isDirectory()) return false;
      // A usable write sink needs BOTH write AND execute/search: creating or opening a file
      // inside a directory requires search (X) permission on it, not just write (W) — a
      // write-but-no-execute dir passes W_OK yet cannot actually hold new files.
      fs.accessSync(current, fs.constants.W_OK | fs.constants.X_OK);
      return true;
    } catch (err) {
      // Only a not-yet-existing path is worth walking up for; an EACCES on stat or a
      // denied W_OK/X_OK (any non-ENOENT error) is a genuine permissions/type failure.
      // NB: this does NOT distinguish a dangling symlink from an absent path (statSync
      // follows symlinks), but it never sees one — callers (probeLocalModelCache after
      // validateModelCacheDir + artifactDirIsSafeToProbe; acquisition after artifactDirIsSafe)
      // reject a dangling cache path upstream first. Keep that ordering if refactoring.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return false;
      const parent = path.dirname(current);
      if (parent === current) return false; // walked to the root; nothing exists to write into
      current = parent;
    }
  }
}

/**
 * Read-only counterpart to {@link artifactDirIsSafe} for the status probe (T022):
 * `status` MUST NOT mutate the filesystem, so — unlike `artifactDirIsSafe` — this
 * never `mkdir`s the checkpoint subdir. Acquisition rejects an escaping/sensitive
 * `<cacheDir>/all-MiniLM-L6-v2` via `artifactDirIsSafe`; the probe must AGREE, or
 * `status` would read straight through the symlink and report `verified`/`missing`
 * (→ "session-init-timeout"/"offline") for a cache that acquisition will always
 * reject as `cache`. A not-yet-existing artifact dir is safe (acquisition creates
 * it under the validated root); an EXISTING one must realpath to a non-sensitive
 * target still inside the real cache root. A dangling/looping symlink is unsafe.
 */
function artifactDirIsSafeToProbe(cacheDir: string): boolean {
  const artifactDir = path.join(cacheDir, MODEL_DIR_NAME);
  try {
    fs.lstatSync(artifactDir);
  } catch (err) {
    // Absent → nothing to read through; acquisition will create it safely later.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
    return false;
  }
  try {
    const realArtifactDir = fs.realpathSync(artifactDir);
    // A regular file (or any non-directory) at the checkpoint path is not a usable
    // artifact dir: acquisition's mkdirSync(recursive) fails on it as `cache`, so the
    // probe must agree rather than read a bogus `<file>/<artifact>` path as `missing`.
    if (!fs.statSync(realArtifactDir).isDirectory()) return false;
    if (isSensitiveCacheDir(realArtifactDir)) return false;
    // Probe must AGREE with acquisition's artifactDirIsSafe: a group/other-writable checkpoint
    // dir is rejected there, so status reports the same `cache` degradation (never reads through it).
    if (isCrossUserWritable(realArtifactDir)) return false;
    return isWithinDir(realArtifactDir, fs.realpathSync(cacheDir));
  } catch {
    // Dangling symlink / ELOOP / otherwise unresolvable → unsafe to trust.
    return false;
  }
}

export function probeLocalModelCache(
  env: NodeJS.ProcessEnv,
  overrides: ProbeLocalModelCacheOverrides = {},
): LocalModelCacheProbe {
  const resolvedCacheDir = resolveModelCacheDir(env);
  // No usable default cache location (blank/non-absolute HOME) — same `cache` degradation
  // acquisition takes, surfaced here as an invalid cache so status agrees (never reads under CWD).
  if (resolvedCacheDir === null) return 'invalid-cache';
  const cacheDir = path.resolve(resolvedCacheDir);
  if (validateModelCacheDir(cacheDir) !== null) return 'invalid-cache';
  // The checkpoint subdir is the real read/write sink; if it escapes the validated
  // root (symlink) or resolves to a sensitive target, acquisition rejects it as
  // `cache` (artifactDirIsSafe) — the probe must agree, not read through it (P1).
  if (!artifactDirIsSafeToProbe(cacheDir)) return 'invalid-cache';
  const { model, tokenizer } = overrides.artifacts ?? { model: MODEL_ARTIFACT, tokenizer: TOKENIZER_ARTIFACT };
  const verified =
    fileExistsAndVerified(artifactPath(cacheDir, model), model) &&
    fileExistsAndVerified(artifactPath(cacheDir, tokenizer), tokenizer);
  if (verified) return 'verified';
  // An artifact that EXISTS but is group/other-writable was rejected by fileExistsAndVerified as
  // untrusted — surface it as a PERMISSION problem (fix: chmod / private cache), NOT the generic
  // 'missing'→'offline' ("retry download") that misdirects a user whose model is already present.
  if (fileIsInsecure(artifactPath(cacheDir, model)) || fileIsInsecure(artifactPath(cacheDir, tokenizer))) {
    return 'insecure-permissions';
  }
  // A non-file at either artifact path (a directory, device, …) that acquisition can never promote
  // over is an invalid cache, not a `missing`→offline "retry download" — match acquireArtifact's
  // fail-fast so status points the user at removing the path instead of retrying a doomed download.
  if (pathIsUnpromotable(artifactPath(cacheDir, model)) || pathIsUnpromotable(artifactPath(cacheDir, tokenizer))) {
    return 'invalid-cache';
  }
  // Not verified: check writability of the ACTUAL write sink — the
  // <cacheDir>/all-MiniLM-L6-v2 checkpoint dir, where acquisition's temp-write lands, NOT
  // just the cache root. cacheDirIsWritable walks up to the nearest existing ancestor, so a
  // not-yet-created subdir falls back to the cache root (matching acquisition's mkdirSync).
  // An existing-but-unwritable checkpoint dir is a `cache` problem acquisition hits (EACCES
  // on the temp-write), distinct from a valid-but-empty `missing` cache.
  if (!cacheDirIsWritable(path.join(cacheDir, MODEL_DIR_NAME))) return 'invalid-cache';
  // A download is required (nothing verified), but if the mirror override is unusable, say so
  // SPECIFICALLY rather than the generic 'missing'→"retry online", which misdirects a user whose
  // real fix is correcting CODEGRAPH_MODEL_BASE_URL. Network-free: resolveBaseUrl only parses +
  // scheme-checks the override (matches what acquireArtifact rejects a genuine fetch with, FR-015).
  if (!resolveBaseUrl(env, DEFAULT_BASE_URL).ok) return 'invalid-base-url';
  return 'missing';
}
