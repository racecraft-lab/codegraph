/**
 * Resolved package version, computed once at module load.
 *
 * The version string is the rendezvous datum between cooperating daemon and
 * proxy processes: the daemon advertises its version in the hello line, and
 * the proxy refuses to share IPC across a mismatch (falls back to direct
 * mode). Keeping the resolution in one place avoids drift between the CLI
 * `--version` output (which reads `package.json` directly) and the daemon
 * handshake.
 *
 * Resolution strategy: read the bundled `package.json` two levels up from
 * this file — same relative position whether we're loaded from `src/mcp/` or
 * the `dist/mcp/` output, since `tsc` preserves the layout. If reading fails
 * (e.g. the package was unpacked oddly), fall back to an explicit sentinel.
 * Daemon sharing rejects that sentinel even when both peers report it; two
 * unknown builds have not established compatibility.
 */

import * as fs from 'fs';
import * as path from 'path';

export const UNKNOWN_CODEGRAPH_VERSION = '0.0.0-unknown';

/** Only a resolved release version is safe as a cross-process rendezvous key. */
export function isShareableCodeGraphVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value !== UNKNOWN_CODEGRAPH_VERSION;
}

function readPackageVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.version === 'string' && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // Fall through to sentinel.
  }
  return UNKNOWN_CODEGRAPH_VERSION;
}

export const CodeGraphPackageVersion = readPackageVersion();
