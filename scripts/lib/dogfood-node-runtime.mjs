import * as path from 'node:path';

/** Whether a version satisfies package.json's supported Node engine range. */
export function isSupportedDogfoodNodeVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version).trim());
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major === 20) return minor >= 19;
  if (major === 22) return minor >= 12;
  return major === 23 || major === 24;
}

/**
 * Select a supported Node executable without assuming the MCP host's first
 * `node` on PATH is compatible with CodeGraph.
 */
export function selectDogfoodNodeRuntime({
  currentExecutable,
  currentVersion,
  pathValue,
  pathDelimiter,
  executableName,
  probeVersion,
}) {
  if (isSupportedDogfoodNodeVersion(currentVersion)) return currentExecutable;

  const seen = new Set([path.resolve(currentExecutable)]);
  for (const rawEntry of String(pathValue ?? '').split(pathDelimiter)) {
    const entry = rawEntry.trim().replace(/^"(.*)"$/, '$1');
    if (!entry) continue;
    const candidate = path.join(entry, executableName);
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const version = probeVersion(candidate);
    if (version && isSupportedDogfoodNodeVersion(version)) return candidate;
  }

  throw new Error(
    `no supported Node runtime found (current ${currentVersion}); ` +
    'install Node 20.19+ or 22.12+ through 24 and include it on PATH',
  );
}
