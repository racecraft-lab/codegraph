/**
 * SPEC-011 — Execution Flows: deterministic flow id (FR-017a).
 *
 * A flow needs no minted/opaque identity — its natural key is its deterministic
 * root entry point. The id is a stable content hash of `entry_kind` + the root's
 * project-relative FILE + the NORMALIZED root identity (route method+path, CLI
 * command name, or qualified symbol). The file discriminator is what makes two
 * DISTINCT roots that share a public name — two services' `GET /health`, two
 * CLIs' `sync` — resolve to DISTINCT ids instead of colliding and being dropped
 * (FR-003/SC-001). It stays byte-identical across runs and clones (SC-004: a
 * project-relative path is clone-stable) and, unlike a node id, is unchanged by
 * edits elsewhere in the same file.
 */

import { createHash } from 'crypto';
import type { EntryPoint } from './entry-points';

/**
 * The normalized, position-independent root identity a flow id hashes over: the
 * route method+path for a route, the command name for a CLI entry, else the
 * qualified root symbol (falling back to the root name when unqualified).
 */
export function normalizedRootIdentity(entry: EntryPoint): string {
  if (entry.entryKind === 'route') return entry.routeName ?? entry.rootName;
  if (entry.entryKind === 'cli') return entry.commandName ?? entry.rootName;
  return entry.rootQualifiedName ?? entry.rootName;
}

/** Deterministic flow id: `flow:` + a 16-hex content hash (FR-017a). */
export function computeFlowId(entry: EntryPoint): string {
  // NUL-separated so no field can bleed into the next (a file path can't contain
  // a NUL); the file path distinguishes distinct same-name roots (FR-003).
  const material = `${entry.entryKind}\0${entry.filePath ?? ''}\0${normalizedRootIdentity(entry)}`;
  return 'flow:' + createHash('sha256').update(material).digest('hex').slice(0, 16);
}
