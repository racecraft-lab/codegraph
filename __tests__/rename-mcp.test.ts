/**
 * SPEC-010 Graph-Aware Rename — the `codegraph_rename` MCP tool (T043/T044/T045).
 *
 * The write-tool face of the rename engine on the MCP surface. Three contracts,
 * all pinned against real files + real SQLite (no mocking, per the constitution)
 * and driven through the actual `ToolHandler` so the dispatch, error-shaping, and
 * annotation-serving paths are the ones under test — not a re-implementation:
 *
 *  T043 — Contract + CLI parity (SC-005 / FR-021 / FR-021a). The input schema is
 *         the camelCase mirror of the CLI; a dry-run call returns the `RenamePlan`
 *         JSON as a text payload BYTE-IDENTICAL to `codegraph rename … --json`
 *         stdout for the same request; an `apply:true` call mirrors the CLI apply
 *         outcome (files actually rewritten + re-synced); an invalid argument
 *         behaves identically to the CLI (validKinds carried).
 *
 *  T044 — Error shaping (FR-023 / SC-006). Every recoverable condition — ambiguous
 *         target, heuristic-gated apply, invalid argument, excluded kind, project
 *         not indexed — returns a `textResult` carrying the `refusal` object with
 *         NO `isError`. Only the failed-rollback malfunction (FR-019a) is
 *         `isError` (POSIX-gated, induced with the T034 chmod pattern but driven
 *         through the MCP handler). stale-span / out-of-root / scope-ignored ride
 *         on the engine-level jail/re-verify coverage (T030/T031/T040): the graph
 *         path never emits an out-of-root/scope-ignored edit, and driving a
 *         stale-span through a live index race here would be non-deterministic —
 *         so MCP-driving them is disproportionate and they stay engine-covered.
 *
 *  T045 — Exposure + annotations (FR-022 / FR-028). `codegraph_rename` is a member
 *         of `DEFAULT_MCP_TOOLS` (the second default-served tool after explore),
 *         and its annotations are its OWN write-tool object
 *         `{readOnlyHint:false, destructiveHint:true, idempotentHint:false,
 *         openWorldHint:false}` — the mirror image of the shared read-only
 *         contract — surviving every tools/list-serving path.
 *
 * The graph path is forced on BOTH surfaces (the in-process library call AND the
 * spawned CLI) by scrubbing `CODEGRAPH_LSP*` from the environment (a temp fixture
 * has no codegraph.json), so a dev shell that enabled a language server for only
 * one side can't diverge the plans (SC-005). Mirrors T014's parity scrub.
 */

import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { ToolHandler, getStaticTools, tools } from '../src/mcp/tools';
import { CodeGraph } from '../src';

const BIN = path.resolve(__dirname, '../dist/bin/codegraph.js');
const ENV = 'CODEGRAPH_MCP_TOOLS';
const RENAME_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

// A clean cross-file, all-exact rename: declaration + import specifier + call
// site all resolve `exact`, so the apply passes the FR-015 confidence gate with
// no heuristic opt-in and touches both files.
const ALL_EXACT: Record<string, string> = {
  'decl.ts': 'export function widget(): void {}\n',
  'caller.ts': ["import { widget } from './decl';", 'export function useWidget(): void { widget(); }', ''].join('\n'),
};
// A single-file intra-call to a non-exported declaration resolves via name-
// matching → `heuristic`, so the plan is `contains-heuristic` and apply refuses
// unless the heuristics are opted in (FR-015).
const HEURISTIC: Record<string, string> = {
  'widget.ts': ['function widget(): void {}', 'export function consume(): void { widget(); }', ''].join('\n'),
};
// Two same-named declarations in different files → an ambiguous selector (FR-007).
const AMBIGUOUS: Record<string, string> = {
  'a.ts': 'export function dup(): void {}\n',
  'b.ts': 'export function dup(): void {}\n',
};
// A bare-module import yields a clean import-node named after the module, so it
// can be targeted by name and refused as an excluded kind (FR-011).
const IMPORT_NODE: Record<string, string> = {
  'use.ts': ["import { helper } from 'lodashx';", 'export const y = helper;', ''].join('\n'),
};

let childEnv: NodeJS.ProcessEnv;
const savedLsp: Record<string, string | undefined> = {};

beforeAll(() => {
  if (!fs.existsSync(BIN)) {
    throw new Error(`Build the project first: ${BIN} is missing (run npm run build).`);
  }
  // Force the graph path on both surfaces (subprocess CLI + in-process library),
  // so a dev shell / codegraph.json that enabled a real language server for one
  // side can't diverge the plans (SC-005). Saved + restored so the scrub can't
  // leak into other files if vitest reuses the worker.
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('CODEGRAPH_LSP')) {
      savedLsp[k] = process.env[k];
      delete process.env[k];
    }
  }
  // Subprocess inherits the scrubbed env; NO_DAEMON + WASM_RELAUNCHED keep the
  // spawn fast and self-contained (no daemon, no startup re-exec) — matches T014.
  childEnv = { ...process.env, CODEGRAPH_NO_DAEMON: '1', CODEGRAPH_WASM_RELAUNCHED: '1' };
});

afterAll(() => {
  for (const [k, v] of Object.entries(savedLsp)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

/** Create + index a real TS fixture; returns the handle + a registered cleanup. */
async function indexedFixture(files: Record<string, string>): Promise<{ dir: string; cg: CodeGraph }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-rename-mcp-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
  await cg.indexAll();
  cleanups.push(() => {
    try {
      cg.close();
    } catch {
      /* already closed */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, cg };
}

/** Run `codegraph rename <args> -p <dir>` against the built binary; return stdout/status. */
function cliRename(args: string[], dir: string): { status: number | null; stdout: string } {
  const res = spawnSync(process.execPath, [BIN, 'rename', ...args, '-p', dir], {
    encoding: 'utf-8',
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: res.status, stdout: res.stdout ?? '' };
}

/** The single text payload of a tool result. */
const textOf = (r: { content: Array<{ text: string }> }): string => r.content[0]!.text;

// =============================================================================
// T043 — MCP contract + CLI parity (SC-005 / FR-021 / FR-021a)
// =============================================================================
describe('T043 codegraph_rename — contract + CLI parity', () => {
  it('input schema is the camelCase CLI mirror (target/newName required; apply/includeHeuristic/file/kind/projectPath optional)', () => {
    const def = tools.find((t) => t.name === 'codegraph_rename');
    expect(def, 'codegraph_rename must be a defined tool').toBeDefined();
    expect(def!.inputSchema.type).toBe('object');
    expect(def!.inputSchema.required).toEqual(['target', 'newName']);
    const props = def!.inputSchema.properties;
    expect(props.target?.type).toBe('string');
    expect(props.newName?.type).toBe('string');
    expect(props.apply?.type).toBe('boolean');
    expect(props.includeHeuristic?.type).toBe('boolean');
    expect(props.file?.type).toBe('string');
    expect(props.kind?.type).toBe('string');
    // projectPath reuses the SHARED projectPathProperty (reference-identical to
    // every other tool's projectPath), not a bespoke copy.
    const exploreProjectPath = tools.find((t) => t.name === 'codegraph_explore')!.inputSchema.properties.projectPath;
    expect(props.projectPath).toBe(exploreProjectPath);
  });

  it('dry-run returns the RenamePlan JSON as a text payload byte-identical to CLI --json stdout', async () => {
    const { dir, cg } = await indexedFixture(ALL_EXACT);
    // Same on-disk index feeds both surfaces, so any divergence is the MCP layer.
    const cli = cliRename(['widget', 'gadget', '--json'], dir);
    expect(cli.status).toBe(0);

    const mcp = await new ToolHandler(cg).execute('codegraph_rename', { target: 'widget', newName: 'gadget' });
    expect(mcp.isError).toBeUndefined();
    expect(textOf(mcp)).toBe(cli.stdout.trimEnd()); // byte-identical (CLI adds one trailing \n)

    // Sanity: it really is a dry-run plan with the deterministic edit set.
    const plan = JSON.parse(textOf(mcp));
    expect(plan.applied).toBe(false);
    expect(plan.confidence).toBe('all-exact');
    expect(plan.edits.map((e: { file: string }) => e.file)).toEqual(['caller.ts', 'caller.ts', 'decl.ts']);
  });

  it('apply:true mirrors the CLI apply outcome — files actually rewritten and index re-synced', async () => {
    // Two identical fixtures: the CLI arm and the MCP arm each mutate their own
    // copy (a successful apply is destructive), then their JSON outcomes are
    // compared byte-for-byte (workspace-relative touchedFiles are identical).
    const cliFix = await indexedFixture(ALL_EXACT);
    const mcpFix = await indexedFixture(ALL_EXACT);

    const cli = cliRename(['widget', 'gadget', '--apply', '--json'], cliFix.dir);
    expect(cli.status).toBe(0);

    const mcp = await new ToolHandler(mcpFix.cg).execute('codegraph_rename', {
      target: 'widget',
      newName: 'gadget',
      apply: true,
    });
    expect(mcp.isError).toBeUndefined();
    expect(textOf(mcp)).toBe(cli.stdout.trimEnd());
    expect(JSON.parse(textOf(mcp))).toEqual({
      newName: 'gadget',
      applied: true,
      outcome: 'applied',
      touchedFiles: ['caller.ts', 'decl.ts'],
      postCheckPassed: true,
    });

    // Files on disk in the MCP arm were actually rewritten…
    expect(fs.readFileSync(path.join(mcpFix.dir, 'decl.ts'), 'utf8')).toContain('gadget');
    expect(fs.readFileSync(path.join(mcpFix.dir, 'caller.ts'), 'utf8')).not.toMatch(/\bwidget\b/);
    // …and the index was re-synced: the old name no longer resolves.
    const after = await mcpFix.cg.planRename({ name: 'widget' }, 'x');
    expect(after.refusal?.reason).toBe('target-not-found');
  });

  it('an invalid argument (unrecognized kind) behaves identically to the CLI, carrying validKinds', async () => {
    const { dir, cg } = await indexedFixture(HEURISTIC);
    const cli = cliRename(['widget', 'gadget', '--kind', 'notakind', '--json'], dir);
    expect(cli.status).toBe(2);

    const mcp = await new ToolHandler(cg).execute('codegraph_rename', {
      target: 'widget',
      newName: 'gadget',
      kind: 'notakind',
    });
    expect(mcp.isError).toBeUndefined();
    expect(textOf(mcp)).toBe(cli.stdout.trimEnd());
    const plan = JSON.parse(textOf(mcp));
    expect(plan.refusal.reason).toBe('invalid-argument');
    expect(plan.refusal.validKinds).toContain('function');
  });
});

// =============================================================================
// T044 — Success-shaped refusals + the sole malfunction (FR-023 / SC-006)
// =============================================================================
describe('T044 codegraph_rename — success-shaped refusals, one isError', () => {
  it('ambiguous target → success-shaped refusal (textResult, no isError) with candidates', async () => {
    const { cg } = await indexedFixture(AMBIGUOUS);
    const mcp = await new ToolHandler(cg).execute('codegraph_rename', { target: 'dup', newName: 'gizmo' });
    expect(mcp.isError).toBeUndefined();
    const plan = JSON.parse(textOf(mcp));
    expect(plan.refusal.reason).toBe('ambiguous-target');
    expect(plan.refusal.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('heuristic-gated apply → success-shaped refusal listing gatedEdits, ZERO writes, no isError', async () => {
    const { dir, cg } = await indexedFixture(HEURISTIC);
    const mcp = await new ToolHandler(cg).execute('codegraph_rename', {
      target: 'widget',
      newName: 'gadget',
      apply: true,
    });
    expect(mcp.isError).toBeUndefined();
    const res = JSON.parse(textOf(mcp));
    expect(res.outcome).toBe('refused');
    expect(res.refusal.reason).toBe('heuristic-gated');
    expect(res.refusal.gatedEdits.length).toBeGreaterThanOrEqual(1);
    // The gate is pre-write: the fixture is byte-unchanged.
    expect(fs.readFileSync(path.join(dir, 'widget.ts'), 'utf8')).toContain('function widget');
  });

  it('project not indexed → success-shaped not-indexed refusal (textResult, no isError)', async () => {
    // No default project + no projectPath → the not-indexed condition, delivered
    // as the refusal object the CLI produces, never an isError (Principle VI).
    const mcp = await new ToolHandler(null).execute('codegraph_rename', { target: 'foo', newName: 'bar' });
    expect(mcp.isError).toBeUndefined();
    const plan = JSON.parse(textOf(mcp));
    expect(plan.applied).toBe(false);
    expect(plan.refusal.reason).toBe('not-indexed');
  });

  it('invalid argument (malformed new name) → success-shaped invalid-argument refusal, no isError', async () => {
    const { cg } = await indexedFixture(HEURISTIC);
    const mcp = await new ToolHandler(cg).execute('codegraph_rename', { target: 'widget', newName: '123bad' });
    expect(mcp.isError).toBeUndefined();
    expect(JSON.parse(textOf(mcp)).refusal.reason).toBe('invalid-argument');
  });

  it('excluded kind (import) → success-shaped excluded-kind refusal, no isError', async () => {
    const { cg } = await indexedFixture(IMPORT_NODE);
    const mcp = await new ToolHandler(cg).execute('codegraph_rename', { target: 'lodashx', newName: 'X', kind: 'import' });
    expect(mcp.isError).toBeUndefined();
    expect(JSON.parse(textOf(mcp)).refusal.reason).toBe('excluded-kind');
  });

  it.runIf(process.platform !== 'win32')(
    'failed rollback (unwritable touched file) → the SOLE isError malfunction, carrying the recovery object',
    async () => {
      // The T034 pattern, driven through the MCP handler: monkey-patch the watched
      // instance's `sync` (which applyRename binds as its injected re-sync) so, at
      // the post-write re-sync point, it injects a drift reference to the old name
      // AND makes caller.ts unwritable — the drift dangles → rollback → the
      // in-place restore of caller.ts fails (EACCES) → rollback-failed.
      const { dir, cg } = await indexedFixture(ALL_EXACT);
      const callerAbs = path.join(dir, 'caller.ts');
      const DRIFT_LINE = 'export function drift(): void { widget(); }\n';
      const originalSync = cg.sync.bind(cg);
      let injected = false;
      (cg as unknown as { sync: (...a: unknown[]) => Promise<unknown> }).sync = async (...a: unknown[]) => {
        if (!injected) {
          injected = true;
          fs.appendFileSync(callerAbs, DRIFT_LINE);
          fs.chmodSync(callerAbs, 0o444);
        }
        return originalSync(...(a as []));
      };

      let mcp: Awaited<ReturnType<ToolHandler['execute']>> | undefined;
      try {
        mcp = await new ToolHandler(cg).execute('codegraph_rename', {
          target: 'widget',
          newName: 'gadget',
          apply: true,
        });
      } finally {
        fs.chmodSync(callerAbs, 0o644); // let cleanup remove the dir
      }

      expect(mcp!.isError).toBe(true);
      const res = JSON.parse(textOf(mcp!).replace(/^Error: /, ''));
      expect(res.outcome).toBe('rollback-failed');
      expect(res.recovery.unrestoredFiles.some((f: string) => f.endsWith('caller.ts'))).toBe(true);
      expect(res.recovery.recoveryDir).toMatch(/rename-recovery-/);
    },
  );
});

// =============================================================================
// T045 — Exposure + annotations (FR-022 / FR-028)
// =============================================================================
describe('T045 codegraph_rename — exposure + write annotations', () => {
  const original = process.env[ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  it('is a member of DEFAULT_MCP_TOOLS — the second default-served tool after explore', () => {
    // getStaticTools() with no allowlist reflects DEFAULT_MCP_TOOLS exactly (the
    // proxy tools/list surface). Order proves rename lands right after explore.
    delete process.env[ENV];
    expect(getStaticTools().map((t) => t.name)).toEqual(['codegraph_explore', 'codegraph_rename']);
  });

  it('advertises its OWN write annotations, the mirror image of READ_ONLY_ANNOTATIONS', () => {
    const def = tools.find((t) => t.name === 'codegraph_rename')!;
    expect(def.annotations).toEqual(RENAME_ANNOTATIONS);
    // Concretely NOT the shared read-only object: it declares a mutating contract.
    expect(def.annotations!.readOnlyHint).toBe(false);
    expect(def.annotations!.destructiveHint).toBe(true);
  });

  it('keeps its write annotations across getStaticTools and the no-default-project schema clone', () => {
    process.env[ENV] = tools.map((t) => t.name).join(',');
    const stat = getStaticTools().find((t) => t.name === 'codegraph_rename');
    expect(stat!.annotations).toEqual(RENAME_ANNOTATIONS);

    // withRequiredProjectPath (null cg) clones each schema — annotations must ride
    // the spread, and projectPath gets marked required.
    const cloned = new ToolHandler(null).getTools().find((t) => t.name === 'codegraph_rename');
    expect(cloned!.annotations).toEqual(RENAME_ANNOTATIONS);
    expect(cloned!.inputSchema.required ?? []).toContain('projectPath');
  });
});
