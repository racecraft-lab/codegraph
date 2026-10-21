import * as path from 'node:path';

import { isSupportedNodeVersion } from './node-runtime-policy.cjs';

export { isSupportedNodeVersion as isSupportedDogfoodNodeVersion };

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
  if (isSupportedNodeVersion(currentVersion)) return currentExecutable;

  const seen = new Set([path.resolve(currentExecutable)]);
  for (const rawEntry of String(pathValue ?? '').split(pathDelimiter)) {
    const entry = rawEntry.trim().replace(/^"(.*)"$/, '$1');
    if (!entry) continue;
    const candidate = path.join(entry, executableName);
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const version = probeVersion(candidate);
    if (version && isSupportedNodeVersion(version)) return candidate;
  }

  throw new Error(
    `no supported Node runtime found (current ${currentVersion}); ` +
    'install Node 22.23.4+ or 24.22.1+ and include it on PATH',
  );
}
