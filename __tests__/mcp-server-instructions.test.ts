/**
 * SPEC-010 Graph-Aware Rename — server-level MCP guidance for the write tool
 * (T047 / FR-025 / FR-028).
 *
 * `src/mcp/server-instructions.ts` is the single source of truth for
 * agent-facing tool guidance (issue #529). T046 added `codegraph_rename` to
 * the default-served MCP tools (`DEFAULT_MCP_TOOLS`); FR-025 requires
 * the `initialize`-response guidance to describe it — dry-run-by-default /
 * explicit `apply` — in a SHORT paragraph that keeps `codegraph_explore` as
 * the retrieval PRIMARY and does not dilute the explore-first steering these
 * tests also pin. FR-028 additionally requires the guidance to make the
 * Agent-mode requirement legible (a read-only client mode gates the tool on
 * `readOnlyHint: false`, even for a dry-run call).
 *
 * No existing suite pinned SERVER_INSTRUCTIONS content before this file
 * (confirmed via `grep -rl "SERVER_INSTRUCTIONS" __tests__/` — no hits), so
 * this is a new, narrowly-scoped suite rather than an extension of one.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_NO_ROOT_INDEX } from '../src/mcp/server-instructions';
import { getStaticTools, ToolHandler } from '../src/mcp/tools';

const ENV = 'CODEGRAPH_MCP_TOOLS';
const CFG_STATES = [
  'available',
  'disabled',
  'not_indexed',
  'not_computed',
  'stale',
  'unavailable',
  'unsupported',
  'resource_limited',
  'unknown_function',
  'deleted',
];

/**
 * Slice out the write-tool section: from the `##` heading that introduces
 * `codegraph_rename` up to (but not including) the next `##` heading, or EOF.
 * Lets assertions scope "never suggests Read/Grep" to the new content only —
 * the rest of the doc legitimately names Read/Grep when telling the agent
 * NOT to use them (e.g. "Don't grep or Read first").
 */
function writeToolSection(text: string): string {
  const mention = text.indexOf('codegraph_rename');
  expect(mention, 'SERVER_INSTRUCTIONS must mention codegraph_rename').toBeGreaterThanOrEqual(0);
  const headingStart = text.lastIndexOf('\n## ', mention);
  expect(headingStart, 'codegraph_rename must be introduced under its own ## heading').toBeGreaterThanOrEqual(0);
  const nextHeading = text.indexOf('\n## ', headingStart + 1);
  return nextHeading === -1 ? text.slice(headingStart) : text.slice(headingStart, nextHeading);
}

function cfgToolSection(text: string): string {
  const mention = text.indexOf('codegraph_get_cfg');
  expect(mention, 'SERVER_INSTRUCTIONS must mention codegraph_get_cfg').toBeGreaterThanOrEqual(0);
  const headingStart = text.lastIndexOf('\n## ', mention);
  expect(headingStart, 'codegraph_get_cfg must be introduced under its own ## heading').toBeGreaterThanOrEqual(0);
  const nextHeading = text.indexOf('\n## ', headingStart + 1);
  return nextHeading === -1 ? text.slice(headingStart) : text.slice(headingStart, nextHeading);
}

describe('SERVER_INSTRUCTIONS — codegraph_rename write-tool guidance (T047)', () => {
  it('mentions codegraph_rename, dry-run-by-default, and explicit apply', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/codegraph_rename/);
    expect(SERVER_INSTRUCTIONS).toMatch(/dry-run/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/\bapply\b/i);
  });

  it('makes the Agent-mode requirement legible (FR-028) — readOnlyHint:false gates read-only client modes', () => {
    const section = writeToolSection(SERVER_INSTRUCTIONS);
    expect(section).toMatch(/readOnlyHint/);
    expect(section).toMatch(/agent/i);
  });

  it('the write-tool section never suggests Read/Grep as an alternative (binding constraint)', () => {
    const section = writeToolSection(SERVER_INSTRUCTIONS);
    expect(section).not.toMatch(/\bRead\b/);
    expect(section).not.toMatch(/\bGrep\b/);
  });

  it('is placed AFTER the "primary tool: codegraph_explore" block and before "How to query" (explore primacy first)', () => {
    const exploreHeading = SERVER_INSTRUCTIONS.indexOf('## The primary tool: codegraph_explore');
    const howToQueryHeading = SERVER_INSTRUCTIONS.indexOf('## How to query');
    const renameHeading = SERVER_INSTRUCTIONS.lastIndexOf('\n## ', SERVER_INSTRUCTIONS.indexOf('codegraph_rename'));
    expect(exploreHeading).toBeGreaterThanOrEqual(0);
    expect(howToQueryHeading).toBeGreaterThan(exploreHeading);
    expect(renameHeading).toBeGreaterThan(exploreHeading);
    expect(renameHeading).toBeLessThan(howToQueryHeading);
  });

  it('does not dilute the existing explore-first steering (regression guard on today\'s phrasing)', () => {
    expect(SERVER_INSTRUCTIONS).toContain('## The primary tool: codegraph_explore — use it instead of reading files');
    expect(SERVER_INSTRUCTIONS).toContain(
      "The primary tool is `codegraph_explore`, and it is Read-equivalent.",
    );
    expect(SERVER_INSTRUCTIONS).toContain(
      'Whether you\'re answering "how does X work" or implementing a change',
    );
    expect(SERVER_INSTRUCTIONS).toContain("Don't grep or Read first");
    expect(SERVER_INSTRUCTIONS).toContain('## How to query');
    expect(SERVER_INSTRUCTIONS).toContain('## Anti-patterns');
    expect(SERVER_INSTRUCTIONS).toContain('## Limitations');
  });

  it('SERVER_INSTRUCTIONS_NO_ROOT_INDEX carries the rename guidance too (C5) — dry-run-by-default, projectPath, explicit apply', () => {
    // The no-root variant EXPOSES codegraph_rename (its schema requires
    // projectPath), so its guidance must name the destructive tool explicitly —
    // a projectPath pointing at an indexed project, dry-run by default, writing
    // only with explicit apply — rather than leaving the write tool undocumented
    // on this surface (C5). The generic "any other codegraph tool" phrasing
    // wasn't enough to make the dry-run/apply contract legible.
    expect(SERVER_INSTRUCTIONS_NO_ROOT_INDEX).toMatch(/codegraph_rename/);
    expect(SERVER_INSTRUCTIONS_NO_ROOT_INDEX).toMatch(/dry-run/i);
    expect(SERVER_INSTRUCTIONS_NO_ROOT_INDEX).toMatch(/\bapply\b/i);
    expect(SERVER_INSTRUCTIONS_NO_ROOT_INDEX).toMatch(/projectPath/);
  });
});

describe('SERVER_INSTRUCTIONS — codegraph_get_cfg bounded CFG guidance (T030)', () => {
  const original = process.env[ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  it('serves codegraph_get_cfg by default while preserving codegraph_explore primacy', () => {
    delete process.env[ENV];
    const names = getStaticTools().map((tool) => tool.name);

    expect(names).toEqual([
      'codegraph_detect_changes',
      'codegraph_explore',
      'codegraph_rename',
      'codegraph_get_cfg',
    ]);
    expect(names.indexOf('codegraph_explore')).toBeLessThan(names.indexOf('codegraph_get_cfg'));
  });

  it('keeps codegraph_get_cfg on the default live tiny-project tools/list surface', () => {
    delete process.env[ENV];
    const tinyProject = { getStats: () => ({ fileCount: 1 }) } as ConstructorParameters<typeof ToolHandler>[0];
    const names = new ToolHandler(tinyProject).getTools().map((tool) => tool.name);

    expect(names).toContain('codegraph_explore');
    expect(names).toContain('codegraph_get_cfg');
    expect(names.indexOf('codegraph_explore')).toBeLessThan(names.indexOf('codegraph_get_cfg'));
  });

  it('adds a scoped codegraph_get_cfg section to both instruction variants', () => {
    for (const text of [SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_NO_ROOT_INDEX]) {
      const section = cfgToolSection(text);
      expect(section).toMatch(/^## codegraph_get_cfg/m);
      expect(section).toMatch(/\bprojectPath\b/);
      expect(section).toMatch(/\bfunctionId\b/);
    }
  });

  it('pins bounded paging, independent block/edge metadata, and nextOffset traversal', () => {
    for (const text of [SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_NO_ROOT_INDEX]) {
      const section = cfgToolSection(text);
      expect(section).toMatch(/limit[\s\S]*100/i);
      expect(section).toMatch(/offset[\s\S]*0/i);
      expect(section).toMatch(/1\.\.500/);
      expect(section).toMatch(/blocks/i);
      expect(section).toMatch(/edges/i);
      expect(section).toMatch(/total/);
      expect(section).toMatch(/returned/);
      expect(section).toMatch(/hasMore/);
      expect(section).toMatch(/nextOffset/);
    }
  });

  it('describes every expected CFG state as a normal state/reason result, not a tool failure', () => {
    for (const text of [SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_NO_ROOT_INDEX]) {
      const section = cfgToolSection(text);
      for (const state of CFG_STATES) {
        expect(section).toContain(state);
      }
      expect(section).toMatch(/normal\s+state\/reason results, not tool failures/);
    }
  });

  it('pins the CFG payload rule and avoids Read/Grep alternatives in the CFG section', () => {
    for (const text of [SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_NO_ROOT_INDEX]) {
      const section = cfgToolSection(text);
      expect(section).toMatch(/Only `available` and retained\s+`stale` results carry `cfg` and `page`/);
      expect(section).toMatch(/`cfg: null` and `page: null`/);
      expect(section).not.toMatch(/\bRead\b/);
      expect(section).not.toMatch(/\bGrep\b/);
    }
  });
});
