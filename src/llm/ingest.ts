/**
 * Agent-mode bundle ingest — the user-invoked validate-and-finalize step (SPEC-018
 * slice 2; research D10, data-model §4/§5, contracts/bundle-files.md, contracts/tasks-cli.md,
 * spec FR-025/FR-026/FR-027/FR-028/FR-028a/FR-029/FR-029a).
 *
 * {@link ingestBundle} is the second half of the agent-mode round-trip: after a coding
 * agent completes a bundle emitted by `emitBundle` (writing its answer into the bundle's
 * `output.json`), the user runs `codegraph tasks ingest <id>`. Ingest STRUCTURALLY
 * validates that output against the bundle's machine-checkable `OutputContract` — a
 * deterministic check (required fields present, of the declared type, non-empty where the
 * contract requires), NEVER a semantic/quality judgment (FR-027) — and on success stores
 * the canonical `result.json = { text }` inside the bundle dir and stamps the manifest
 * `completed` (FR-028), so the FR-010a `redeemHandle` lookup can hand the finalized text
 * back to the original consumer.
 *
 * Every rejection is FR-028a-shaped: the manifest is left `pending` (re-ingestable), the
 * reason is returned to the caller (the CLI prints it to stderr and exits non-zero), NO
 * consumer artifact is written, and ingest NEVER throws / never surfaces `isError`. Ingest
 * writes nothing outside the bundle directory (SC-006) and is user-invoked only — it is
 * never wired into the watcher or daemon (FR-029).
 *
 * The bundle directory's contents AND the bundle-selecting id are untrusted, same-user
 * input (FR-029a): the id is anchor-contained to a single direct child of `.codegraph/tasks/`
 * BEFORE the bundle dir is trusted as the per-path anchor, and every named path — the
 * agent's `output.json`, `manifest.json`, and the `manifest.contract` pointer — is routed
 * through the shared {@link readBundleFileSafely} bounded safe-read (containment, symlink
 * rejection, size bound, JSON-depth bound). Parsed output is consumed by reading ONLY the
 * contract's declared fields (own-key reads), never deep-merged, so attacker-controlled
 * `__proto__`/`constructor` keys cannot pollute a prototype. Residual same-process TOCTOU
 * is out of scope (research D9). This module reuses `agent-bundle.ts`'s hardening rather
 * than reimplementing it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readBundleFileSafely, resolveBundleDir, MAX_BUNDLE_INPUT_BYTES } from './agent-bundle';

/**
 * {@link ingestBundle} outcome — a closed union the CLI maps to an exit code: `ok:true`
 * (validated; `result.json` stored, manifest stamped `completed`) exits 0 with a
 * confirmation; `ok:false` is an FR-028a-shaped rejection (manifest untouched, no
 * consumer artifact) the CLI prints to stderr before exiting non-zero.
 */
export type IngestResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/**
 * Read a single OWN enumerable property by key (prototype-pollution safe). Uses
 * `hasOwnProperty` so an inherited/`__proto__` key is never mistaken for real data, and
 * never merges attacker JSON into a live object. Returns `undefined` when absent.
 */
function ownField(obj: unknown, name: string): unknown {
  if (typeof obj !== 'object' || obj === null) return undefined;
  if (!Object.prototype.hasOwnProperty.call(obj, name)) return undefined;
  return (obj as Record<string, unknown>)[name];
}

/** A single validated required field from the parsed OutputContract. */
interface RequiredField {
  name: string;
  type: 'string' | 'string[]';
  nonEmpty: boolean;
}

/**
 * Parse the bundle's `OutputContract` from its safe-read value by reading only its own
 * declared fields. Returns `null` for a structurally-malformed contract (missing/invalid
 * `requiredFields`, a field with a non-string name or an out-of-enum type, or a DUPLICATE
 * field name). Duplicate names are rejected because {@link deriveText} emits each declared
 * field's value once PER declaration, so a contract repeating a name would amplify a single
 * bounded `output.json` value into an unbounded `result.json` (Fix G / round-2 review) — the
 * operative guard against that amplification.
 */
function parseContract(value: unknown): { requiredFields: RequiredField[] } | null {
  const fields = ownField(value, 'requiredFields');
  if (!Array.isArray(fields)) return null;
  const out: RequiredField[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    const name = ownField(f, 'name');
    const type = ownField(f, 'type');
    if (typeof name !== 'string' || (type !== 'string' && type !== 'string[]')) return null;
    if (seen.has(name)) return null; // duplicate field name → malformed (amplification guard)
    seen.add(name);
    out.push({ name, type, nonEmpty: ownField(f, 'nonEmpty') === true });
  }
  return { requiredFields: out };
}

/**
 * Deterministic structural validation of one required field against the parsed output
 * (FR-027). Returns a rejection reason, or `null` when the field satisfies the contract.
 * Never a semantic/quality judgment: a `string` is "non-empty" iff it has length; a
 * `string[]` iff it has at least one item and every item is a string.
 */
function validateField(output: unknown, field: RequiredField): string | null {
  const value = ownField(output, field.name);
  if (field.type === 'string') {
    if (typeof value !== 'string') return `output field "${field.name}" is missing or not a string`;
    if (field.nonEmpty && value.length === 0) return `output field "${field.name}" must be non-empty`;
    return null;
  }
  // string[]
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    return `output field "${field.name}" is missing or not a string[]`;
  }
  if (field.nonEmpty && value.length === 0) return `output field "${field.name}" must be non-empty`;
  return null;
}

/**
 * Derive the canonical `text` from the validated output by reading ONLY the contract's
 * declared fields (own-key reads, in declared order): a `string` field contributes its
 * value; a `string[]` field its items joined by "\n"; fields are separated by a blank
 * line. For the first-consumer single `prose: string` contract this reduces to exactly
 * `output.prose`. Called only after {@link validateField} has passed for every field, so
 * each read value is the validated type.
 */
function deriveText(output: unknown, contract: { requiredFields: RequiredField[] }): string {
  const parts: string[] = [];
  for (const field of contract.requiredFields) {
    const value = ownField(output, field.name);
    parts.push(field.type === 'string' ? (value as string) : (value as string[]).join('\n'));
  }
  return parts.join('\n\n');
}

/**
 * Atomically install the completed manifest over the bundle's existing `pending` manifest
 * WITHOUT following or truncating a pre-planted link (FR-029a). A bundle-dir entry is
 * attacker-controllable (the coding agent that fills `output.json` has full write access),
 * so writing the finalized manifest through {@link fs.writeFileSync} directly would FOLLOW a
 * pre-planted `manifest.json` symlink, or TRUNCATE a hard-linked victim, OUTSIDE the bundle.
 * Instead: write the completed manifest to a fresh temp file created EXCLUSIVELY
 * (`O_CREAT|O_EXCL`, `+O_NOFOLLOW` where available) in the bundle dir, then {@link fs.renameSync}
 * it over `manifestPath`. `rename` swaps the directory entry atomically — it breaks any hard
 * link and replaces any symlink at `manifestPath` WITHOUT touching a victim, and overwrites
 * the existing file on both POSIX and Windows (libuv `MOVEFILE_REPLACE_EXISTING`). `O_TRUNC`
 * on the live path is never used (it would truncate a hard-linked victim). A stale temp from
 * an interrupted prior ingest is unlinked and the create retried ONCE; if that still fails
 * (e.g. the temp path is a directory), the throw propagates to the caller's finalization
 * catch and becomes an FR-028a-shaped rejection. Throws on any fs error; the sole caller
 * wraps finalization in a try/catch so `ingestBundle` never throws.
 *
 * `json` is the ALREADY-serialized completed manifest: the caller builds a CANONICAL
 * manifest from known fields and serializes + size-checks it ONCE (see {@link ingestBundle}),
 * then passes that exact string through here so the bytes size-checked are the bytes written
 * — this helper never re-serializes and so cannot re-expand the payload past the reader's
 * ceiling.
 */
function writeManifestViaRename(tmpPath: string, manifestPath: string, json: string): void {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0);
  let fd: number;
  try {
    fd = fs.openSync(tmpPath, flags, 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    fs.unlinkSync(tmpPath); // clear a stale temp (or fail on a non-file), then retry once
    fd = fs.openSync(tmpPath, flags, 0o600);
  }
  try {
    fs.writeFileSync(fd, json, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, manifestPath);
}

/**
 * Validate + finalize one completed bundle (FR-026/FR-027/FR-028). Reads the bundle's
 * `output.json` and `OutputContract`, structurally validates the former against the
 * latter, and on success stores the canonical `result.json = { text }` inside the bundle
 * dir and stamps `manifest.status = 'completed'`. Returns an {@link IngestResult}; never
 * throws. Every rejection leaves the manifest `pending` and writes no consumer artifact
 * (FR-028a). User-invoked only (FR-029).
 */
export function ingestBundle(root: string, id: string): IngestResult {
  // FR-029a anchor containment (CRL 8): the id is untrusted input. Validate it as a
  // single contained segment resolving to a direct child of `.codegraph/tasks/` BEFORE
  // the bundle dir is trusted as the per-path anchor below — a crafted id (`../../src`,
  // a separator-bearing handle, an absolute path) must not relocate the anchor and let a
  // downstream read/write escape the per-path containment.
  const bundleDir = resolveBundleDir(root, id);
  if (bundleDir === null) return { ok: false, reason: `invalid task id: ${id}` };

  // The bundle directory must exist and be a directory.
  let dirStat: fs.Stats;
  try {
    dirStat = fs.statSync(bundleDir);
  } catch {
    return { ok: false, reason: `task bundle not found: ${id}` };
  }
  if (!dirStat.isDirectory()) return { ok: false, reason: `task bundle not found: ${id}` };

  // Manifest — routed through the bounded safe-read; a malformed/unreadable manifest is a
  // rejection, never a false completed stamp.
  const manifestRead = readBundleFileSafely(root, bundleDir, 'manifest.json');
  if (!manifestRead.ok) return { ok: false, reason: `cannot read manifest for ${id}: ${manifestRead.reason}` };
  const status = ownField(manifestRead.value, 'status');
  if (status === 'completed') return { ok: false, reason: `task ${id} is already completed` };
  if (status !== 'pending') return { ok: false, reason: `task ${id} has an unexpected manifest status` };

  // Output contract — reached through the manifest's OWN `contract` pointer (untrusted),
  // routed through the bounded safe-read so a tampered pointer that escapes the bundle dir
  // (or names a symlink/oversize/deep file) is rejected rather than followed.
  const contractPointer = ownField(manifestRead.value, 'contract');
  if (typeof contractPointer !== 'string') return { ok: false, reason: `manifest for ${id} has no contract pointer` };
  const contractRead = readBundleFileSafely(root, bundleDir, contractPointer);
  if (!contractRead.ok) return { ok: false, reason: `cannot read output contract for ${id}: ${contractRead.reason}` };
  const contract = parseContract(contractRead.value);
  if (contract === null) return { ok: false, reason: `malformed output contract for ${id}` };

  // Agent output — untrusted; absent/empty/unreadable/oversize/deep is an FR-028a-shaped
  // rejection (ingested too early, or a hostile payload).
  const outputRead = readBundleFileSafely(root, bundleDir, 'output.json');
  if (!outputRead.ok) return { ok: false, reason: `agent output is not ingestable: ${outputRead.reason}` };

  // Structural validation (FR-027).
  for (const field of contract.requiredFields) {
    const reason = validateField(outputRead.value, field);
    if (reason !== null) return { ok: false, reason };
  }

  // PASS (FR-028): store the canonical result INSIDE the bundle dir, then stamp the manifest
  // `completed`. The write paths are fixed literals, but a bundle-dir ENTRY is attacker-
  // controllable (the coding agent has full write access): a pre-planted `result.json`/
  // `manifest.json` HARD LINK or SYMLINK would make a naive fs.writeFileSync FOLLOW/truncate a
  // file OUTSIDE the bundle (arbitrary-file-overwrite, FR-029a) — and an lstat-then-write guard
  // cannot stop a hard link (it is a regular file whose own path is contained) and TOCTOU-races
  // a symlink. So:
  //   - result.json is created EXCLUSIVELY (O_CREAT|O_EXCL, +O_NOFOLLOW where available): a
  //     pre-existing entry of ANY kind (hard link, symlink, regular file) fails with EEXIST, so
  //     the victim is never opened. In normal flow result.json never pre-exists (an already-
  //     completed bundle returns early above), so EEXIST is a genuine refusal.
  //   - the completed manifest is installed via a fresh exclusive temp file + rename (see
  //     writeManifestViaRename): rename breaks a link / replaces a symlink without truncation.
  // The whole finalization runs under ONE try/catch so ANY fs error (EACCES on a read-only dir,
  // ENOSPC, a blocked temp, …) becomes an FR-028a-shaped rejection — ingestBundle NEVER throws.
  // On a post-result failure the just-written result.json is rolled back so no consumer artifact
  // is left beside a still-`pending` manifest (re-ingestable). Same-process TOCTOU is out of
  // scope (research D9).
  const resultPath = path.join(bundleDir, 'result.json');
  const manifestPath = path.join(bundleDir, 'manifest.json');
  const tmpManifestPath = path.join(bundleDir, 'manifest.json.ingest-tmp');
  const text = deriveText(outputRead.value, contract);
  // Canonical-result size ceiling (Fix G, defense-in-depth): `redeemHandle` reads result.json
  // back through the SAME 1 MiB bounded safe-read, so a serialized result larger than that
  // would be written yet never redeemable. Refuse to write it (FR-028a-shaped) — the manifest
  // stays pending and the bundle re-ingestable. parseContract already rejects the known
  // amplification vector (duplicate field names), so this is a belt-and-suspenders invariant on
  // the write itself. Serialize once and reuse the value for the write below.
  const serializedResult = JSON.stringify({ text });
  if (Buffer.byteLength(serializedResult, 'utf8') > MAX_BUNDLE_INPUT_BYTES) {
    return { ok: false, reason: `finalized result for ${id} exceeds ${MAX_BUNDLE_INPUT_BYTES} bytes` };
  }
  // Completed manifest — built as a CANONICAL object from KNOWN, already-validated fields
  // only (mirroring emitBundle's BundleManifest shape): the bundle `id`, `status:'completed'`,
  // the already-validated `contractPointer`, and `createdAt` carried through ONLY when the
  // pending manifest holds a string (otherwise omitted — listBundles tolerates an absent
  // createdAt). NEVER spread the untrusted pending manifest: the coding agent can pad it (a
  // large extra field) so it stays < MAX_BUNDLE_INPUT_BYTES when COMPACT yet expands PAST it
  // once serialized pretty-printed — which would write an { ok:true } completion whose manifest
  // readBundleFileSafely then rejects, wedging redeemHandle at `pending` and tasks-list at
  // `unreadable` forever. Serialize ONCE, with the exact `JSON.stringify(m, null, 2)` formatting
  // writeManifestViaRename writes, and reuse that string below so the size checked here is the
  // size written. Canonical fields keep this inherently tiny; the byte-length guard is a
  // defensive invariant mirroring the result.json ceiling above (FR-028a-shaped on the
  // astronomically-unlikely overflow) — and, unlike the pre-fix spread, no agent-supplied
  // padding can reach it.
  const createdAt = ownField(manifestRead.value, 'createdAt');
  const completedManifest: Record<string, unknown> = {
    id,
    status: 'completed',
    contract: contractPointer,
    ...(typeof createdAt === 'string' ? { createdAt } : {}),
  };
  const serializedManifest = JSON.stringify(completedManifest, null, 2);
  if (Buffer.byteLength(serializedManifest, 'utf8') > MAX_BUNDLE_INPUT_BYTES) {
    return { ok: false, reason: `finalized manifest for ${id} exceeds ${MAX_BUNDLE_INPUT_BYTES} bytes` };
  }
  const resultFlags =
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0);

  let resultCreated = false;
  try {
    // result.json — exclusive create refuses a pre-planted link/file instead of following it.
    let resultFd: number;
    try {
      resultFd = fs.openSync(resultPath, resultFlags);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        return { ok: false, reason: `refusing to write result.json: it already exists` };
      }
      throw err;
    }
    // The exclusive create SUCCEEDED — result.json now exists on disk (empty). Mark it created
    // BEFORE the write so a failed write (ENOSPC/EIO) still triggers the rollback below. Setting
    // this only AFTER the write would leave an orphan EMPTY result.json on a write failure, which
    // then permanently wedges every re-ingest via the O_EXCL EEXIST refusal above.
    resultCreated = true;
    try {
      fs.writeFileSync(resultFd, serializedResult, 'utf8');
    } finally {
      fs.closeSync(resultFd);
    }

    // manifest.json — install the CANONICAL completed manifest (built + size-checked above)
    // atomically over the pending one, passing the exact serialized string so no re-serialize
    // can re-expand it past the reader's ceiling.
    writeManifestViaRename(tmpManifestPath, manifestPath, serializedManifest);

    return { ok: true, text };
  } catch (err) {
    // Rollback (FR-028a): drop any partial consumer artifact + temp file so no result.json is
    // left beside a still-`pending` manifest. Best-effort; the rollback itself never throws.
    if (resultCreated) {
      try {
        fs.rmSync(resultPath, { force: true });
      } catch {
        /* best-effort */
      }
    }
    try {
      fs.rmSync(tmpManifestPath, { force: true });
    } catch {
      /* best-effort */
    }
    return { ok: false, reason: `failed to finalize bundle ${id}: ${(err as Error).message}` };
  }
}
