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
import { readBundleFileSafely, resolveBundleDir } from './agent-bundle';

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
 * `requiredFields`, or a field with a non-string name or an out-of-enum type).
 */
function parseContract(value: unknown): { requiredFields: RequiredField[] } | null {
  const fields = ownField(value, 'requiredFields');
  if (!Array.isArray(fields)) return null;
  const out: RequiredField[] = [];
  for (const f of fields) {
    const name = ownField(f, 'name');
    const type = ownField(f, 'type');
    if (typeof name !== 'string' || (type !== 'string' && type !== 'string[]')) return null;
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
 * FR-029a write-side containment: reject a write target that already exists as a symlink
 * or any other non-regular file. A bundle-dir entry is attacker-controllable (the coding
 * agent that fills `output.json` has full write access to the dir), so a pre-planted
 * `result.json`/`manifest.json` symlink would otherwise make {@link fs.writeFileSync}
 * FOLLOW it and overwrite a file OUTSIDE the bundle (arbitrary-file-overwrite). `lstat`
 * the addressed target — never its realpath — so a symlink final component is seen as a
 * symlink, mirroring {@link readBundleFileSafely}'s read-side rejection. A not-yet-existing
 * target (the normal `result.json` case) is safe to create; an existing regular file (the
 * emitted `manifest.json`) is safe to overwrite. Returns a rejection reason, or `null`
 * when the write may proceed; never throws. Residual same-process TOCTOU is out of scope
 * (research D9).
 */
function rejectNonRegularWriteTarget(target: string, name: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return null; // absent → safe to create
  }
  if (stat.isSymbolicLink()) return `refusing to write ${name}: it is a symlink`;
  if (!stat.isFile()) return `refusing to write ${name}: it is not a regular file`;
  return null;
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

  // PASS (FR-028): store the canonical result INSIDE the bundle dir, then stamp completed.
  // The write paths are fixed literals, but a bundle-dir ENTRY is attacker-controllable
  // (the coding agent has full write access): a pre-planted `result.json`/`manifest.json`
  // symlink would make fs.writeFileSync FOLLOW it and overwrite a file OUTSIDE the bundle
  // (arbitrary-file-overwrite, FR-029a). Guard BOTH targets against a symlink/non-regular
  // file BEFORE writing either — mirroring readBundleFileSafely's lstat rejection — so a
  // rejection leaves the manifest `pending` and installs no consumer artifact (FR-028a).
  const resultPath = path.join(bundleDir, 'result.json');
  const manifestPath = path.join(bundleDir, 'manifest.json');
  const resultGuard = rejectNonRegularWriteTarget(resultPath, 'result.json');
  if (resultGuard !== null) return { ok: false, reason: resultGuard };
  const manifestGuard = rejectNonRegularWriteTarget(manifestPath, 'manifest.json');
  if (manifestGuard !== null) return { ok: false, reason: manifestGuard };

  const text = deriveText(outputRead.value, contract);
  fs.writeFileSync(resultPath, JSON.stringify({ text }), 'utf8');
  const completedManifest = { ...(manifestRead.value as Record<string, unknown>), status: 'completed' };
  fs.writeFileSync(manifestPath, JSON.stringify(completedManifest, null, 2), 'utf8');
  return { ok: true, text };
}
