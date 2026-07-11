/**
 * SPEC-005 shared server test harness.
 *
 * Stands up a REAL fixture project (real files, real `node:sqlite` index via
 * `CodeGraph.init` — no mocking, repo convention) and, for the server suites, a
 * live `serve --web` HTTP server on `--port 0` (OS-assigned, collision-free).
 * Everything is keyed on `fs.mkdtempSync` temp dirs and reaped by `teardown()`
 * in `afterEach` — never this repo's own daemon (dogfood hazard).
 *
 * Two entry points:
 *   - {@link buildFixtureIndex} — just the indexed fixture (+ cleanup). Used by
 *     the daemon-client suite, which attaches to the daemon directly.
 *   - {@link startServerFixture} — the fixture PLUS a running web server (+ an
 *     optional synthetic `dist/web/` injected as the server's web root, so the
 *     later static-mount tests can exercise the web-present path).
 *
 * @module __tests__/helpers/server-fixture
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeGraph } from '../../src';
import { startWebServer, type WebServerHandle } from '../../src/server/index';
import { getDaemonPidPath } from '../../src/mcp/daemon-paths';

/** A built fixture index and its teardown. */
export interface FixtureIndex {
  /** Canonical (realpath'd) project root the daemon keys on. */
  root: string;
  /** The temp dir (pre-realpath) that was created. */
  dir: string;
  /** Reap any daemon spawned for this fixture and remove the temp dir. */
  cleanup(): void;
}

/** Options shared by both entry points. */
export interface FixtureOptions {
  /**
   * Files to seed into the fixture project before indexing (relative path →
   * contents). Defaults to a single beacon source file so the index is non-empty.
   */
  files?: Record<string, string>;
}

/** A running server over a fixture index, with a full teardown. */
export interface ServerFixture {
  /** Canonical project root of the fixture index. */
  root: string;
  /** The running web-server handle. */
  handle: WebServerHandle;
  /** Base URL, e.g. `http://127.0.0.1:<port>`. */
  baseURL: string;
  /**
   * The injected synthetic web root (present only when `withWebRoot` was set) —
   * a dir seeded with `index.html` + a probe asset.
   */
  webRoot?: string;
  /** Stop the server and remove every temp dir. Call in `afterEach`. */
  teardown(): Promise<void>;
}

/** Options for {@link startServerFixture}. */
export interface ServerFixtureOptions extends FixtureOptions {
  /**
   * Seed a synthetic `dist/web/` (index.html + a probe asset) and inject it as
   * the server's web root, so static-mount tests can exercise the present path.
   */
  withWebRoot?: boolean;
}

/** Default seed: one beacon source file so the index has real content. */
const DEFAULT_FILES: Record<string, string> = {
  'fixture.ts': 'export function fixtureBeacon(): number {\n  return 7;\n}\n',
};

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Best-effort reap of a daemon spawned for `root` (never our own process). */
function reapDaemon(root: string): void {
  try {
    const info = JSON.parse(fs.readFileSync(getDaemonPidPath(root), 'utf8'));
    const pid = typeof info.pid === 'number' ? info.pid : null;
    if (pid && pid !== process.pid && isAlive(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* raced to exit */ }
    }
  } catch { /* no daemon lockfile */ }
}

function rmDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/**
 * Build a real fixture index in a fresh temp dir (real files + real SQLite).
 * Closes the DB so a daemon can open it. `cleanup()` reaps any daemon keyed on
 * the fixture and removes the temp dir.
 */
export async function buildFixtureIndex(opts: FixtureOptions = {}): Promise<FixtureIndex> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-server-fixture-'));
  const files = opts.files ?? DEFAULT_FILES;
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  const cg = await CodeGraph.init(dir, { index: true });
  cg.close(); // release the DB lock so the daemon can open the index
  const root = fs.realpathSync(dir);

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    reapDaemon(root);
    rmDir(dir);
  };

  return { root, dir, cleanup };
}

/**
 * Build a fixture index and start `serve --web` on `--port 0` over it, returning
 * the base URL and a teardown. With `withWebRoot`, a synthetic `dist/web/` is
 * seeded (index.html + a probe asset) and injected as the server's web root.
 */
export async function startServerFixture(opts: ServerFixtureOptions = {}): Promise<ServerFixture> {
  const fixture = await buildFixtureIndex(opts);

  let webRoot: string | undefined;
  let webRootDir: string | undefined;
  if (opts.withWebRoot) {
    webRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-server-webroot-'));
    // The shape the shipped static mount serves from: `<dir>/web/`.
    webRoot = path.join(webRootDir, 'web');
    fs.mkdirSync(webRoot, { recursive: true });
    fs.writeFileSync(
      path.join(webRoot, 'index.html'),
      '<!doctype html><title>codegraph fixture</title><body>ok</body>\n',
    );
    fs.writeFileSync(path.join(webRoot, 'probe.txt'), 'CODEGRAPH_PROBE_ASSET\n');
  }

  const handle = await startWebServer({ port: 0, projectPath: fixture.root, webRoot });
  const baseURL = `http://${handle.host}:${handle.port}`;

  const teardown = async (): Promise<void> => {
    try { await handle.close(); } catch { /* already closed */ }
    fixture.cleanup();
    if (webRootDir) rmDir(webRootDir);
  };

  return { root: fixture.root, handle, baseURL, webRoot, teardown };
}
