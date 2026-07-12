/**
 * SPEC-005 slice-1 review-remediation regression tests.
 *
 * Covers behavioral fixes from the PR #41 external review that are cleanly and
 * deterministically testable. The remaining slice-1 remediations are either
 * defense-in-depth on paths without a surgical unit seam (spawn 'error' listener,
 * attach wall-clock budget, initialize-failure socket stop), status internals
 * that need a configured embedding provider / forced partial index, or a
 * daemon-attach identity path that needs a live spawned daemon — all verified by
 * type-check + the existing server suites + adversarial code review rather than a
 * bespoke fixture here.
 *
 * @module __tests__/server-rp-remediation
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { serveStatic, placeholderPage } from '../src/server/static';

describe('SPEC-005 slice-1 review remediation', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });

  // 41-A (FR-017b): the SPA shell fallback must route `index.html` through the
  // symlink-aware containment chokepoint, not a raw path.join — a symlinked
  // index.html whose real target escapes the web root must be treated as absent
  // (serve the placeholder), never followed to the out-of-root file.
  it.runIf(process.platform !== 'win32')(
    '41-A: a symlinked index.html escaping the web root serves the placeholder, not the target',
    () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rp-static-'));
      cleanups.push(() => fs.rmSync(base, { recursive: true, force: true }));
      const webRoot = path.join(base, 'web');
      fs.mkdirSync(webRoot, { recursive: true });
      // A secret file OUTSIDE the web root, reachable only by following the symlink.
      const secret = path.join(base, 'secret.html');
      fs.writeFileSync(secret, '<html>TOP_SECRET_OUT_OF_ROOT</html>');
      fs.symlinkSync(secret, path.join(webRoot, 'index.html'));

      const res = serveStatic('/', webRoot);

      // Escaping shell is treated as absent → the data-free placeholder, byte-identical.
      expect(res.status).toBe(200);
      expect(res.body).toBe(placeholderPage());
      expect(String(res.body)).not.toContain('TOP_SECRET');
    },
  );

  // 41-A (companion): a NON-escaping real index.html inside the web root is still
  // served normally — the containment fix must not break the happy path.
  it('41-A: a real in-root index.html is still served for the extensionless route', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rp-static-ok-'));
    cleanups.push(() => fs.rmSync(base, { recursive: true, force: true }));
    const webRoot = path.join(base, 'web');
    fs.mkdirSync(webRoot, { recursive: true });
    fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>ok</title>');

    const res = serveStatic('/', webRoot);

    expect(res.status).toBe(200);
    expect(String(res.body)).toContain('<!doctype html>');
    expect(res.body).not.toBe(placeholderPage());
  });
});
