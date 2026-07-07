/**
 * A validated, writable parent directory for a model-cache test fixture.
 *
 * `os.homedir()` suits a normal user, but is `/root` when the suite runs as root
 * (the Docker image CLAUDE.md mandates for Linux validation) — a `SENSITIVE_PATHS`
 * entry — and a checkout under `/tmp` is sensitive too. `validateModelCacheDir()`
 * would reject either, making valid-cache status tests wrongly resolve to `cache`
 * instead of `offline`/`session-init-timeout`. Pick the first candidate that BOTH
 * passes `validateModelCacheDir` (non-sensitive / resolvable) AND is writable; throw
 * clearly if none is available rather than hand back a parent the validator rejects.
 *
 * Shared by embeddings-local-status.test.ts and embeddings-model-fetch.test.ts.
 */
import * as os from 'os';
import * as fs from 'fs';
import { validateModelCacheDir } from '../../src/embeddings/model-fetch';

export function modelCacheFixtureParent(): string {
  for (const candidate of [os.homedir(), process.cwd()]) {
    if (validateModelCacheDir(candidate) !== null) continue; // sensitive / unresolvable
    try {
      fs.accessSync(candidate, fs.constants.W_OK);
    } catch {
      continue; // not writable
    }
    return candidate;
  }
  throw new Error('No non-sensitive, writable parent available for a model-cache test fixture');
}
