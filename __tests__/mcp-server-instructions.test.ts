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

function cypherQuerySection(text: string): string {
  const mention = text.indexOf('codegraph_query');
  expect(mention, 'SERVER_INSTRUCTIONS must mention codegraph_query').toBeGreaterThanOrEqual(0);
  const headingStart = text.lastIndexOf('\n## ', mention);
  expect(headingStart, 'codegraph_query must be introduced under its own ## heading').toBeGreaterThanOrEqual(0);
  const nextHeading = text.indexOf('\n## ', headingStart + 1);
  return nextHeading === -1 ? text.slice(headingStart) : text.slice(headingStart, nextHeading);
}

function defaultStaticToolNames(): string[] {
  const original = process.env[ENV];
  delete process.env[ENV];
  try {
    return getStaticTools().map((tool) => tool.name);
  } finally {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  }
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

describe('SERVER_INSTRUCTIONS — codegraph_query deliberate Cypher steering (SPEC-013 T034)', () => {
  it('keeps codegraph_explore primary while default-serving codegraph_query', () => {
    delete process.env[ENV];
    const names = getStaticTools().map((tool) => tool.name);

    expect(names).toEqual([
      'codegraph_query',
      'codegraph_detect_changes',
      'codegraph_explore',
      'codegraph_rename',
      'codegraph_get_cfg',
    ]);
    expect(names).toContain('codegraph_explore');
    expect(names).toContain('codegraph_query');
    expect(SERVER_INSTRUCTIONS).toContain('## The primary tool: codegraph_explore');
    expect(SERVER_INSTRUCTIONS).toContain('The primary tool is `codegraph_explore`');
  });

  it('adds a scoped codegraph_query section to both instruction variants', () => {
    for (const text of [SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_NO_ROOT_INDEX]) {
      const section = cypherQuerySection(text);
      expect(section).toMatch(/^## codegraph_query/m);
      expect(section).toMatch(/\bCypher\b/);
      expect(section).toMatch(/structured graph-language/i);
      expect(section).toMatch(/deliberate/i);
      expect(section).toMatch(/projectPath/);
    }
  });

  it('reserves codegraph_query for deliberate structured graph-language requests, not general retrieval', () => {
    for (const text of [SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_NO_ROOT_INDEX]) {
      const section = cypherQuerySection(text);
      expect(section).toMatch(/only/i);
      expect(section).toMatch(/when .*asks.*Cypher|when .*asks.*structured graph-language/i);
      expect(section).not.toMatch(/primary/i);
      expect(section).not.toMatch(/general retrieval/i);
      expect(section).not.toMatch(/prefer.*Cypher/i);
      expect(section).not.toMatch(/instead of.*codegraph_explore/i);
    }
  });

  it('does not steer agents from codegraph_query guidance to Read or Grep', () => {
    for (const text of [SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_NO_ROOT_INDEX]) {
      const section = cypherQuerySection(text);
      expect(section).not.toMatch(/\bRead\b/);
      expect(section).not.toMatch(/\bGrep\b/);
    }
  });

  it('keeps broad retrieval examples routed to codegraph_explore instead of codegraph_query', () => {
    const howToQueryHeading = SERVER_INSTRUCTIONS.indexOf('## How to query');
    const antiPatternsHeading = SERVER_INSTRUCTIONS.indexOf('## Anti-patterns');
    expect(howToQueryHeading).toBeGreaterThanOrEqual(0);
    expect(antiPatternsHeading).toBeGreaterThan(howToQueryHeading);
    const howToQuery = SERVER_INSTRUCTIONS.slice(howToQueryHeading, antiPatternsHeading);

    expect(howToQuery).toMatch(/Almost any question[\s\S]*codegraph_explore/);
    expect(howToQuery).toMatch(/flow[\s\S]*codegraph_explore/);
    expect(howToQuery).toMatch(/Reading or editing[\s\S]*codegraph_explore/);
    expect(howToQuery).not.toContain('codegraph_query');
  });
});

describe('SERVER_INSTRUCTIONS — final retrieval steering regression surface (SPEC-013 T060)', () => {
  it('pins the default-listed tool surface without promoting Cypher over explore', () => {
    const names = defaultStaticToolNames();
    const tinyProject = { getStats: () => ({ fileCount: 1 }) } as ConstructorParameters<typeof ToolHandler>[0];
    const liveNames = new ToolHandler(tinyProject).getTools().map((tool) => tool.name);

    expect(names).toEqual([
      'codegraph_query',
      'codegraph_detect_changes',
      'codegraph_explore',
      'codegraph_rename',
      'codegraph_get_cfg',
    ]);
    expect(new Set(names).size).toBe(names.length);
    expect(liveNames).toEqual(names);
    expect(names).toContain('codegraph_query');
    expect(names).toContain('codegraph_explore');
    expect(names).not.toContain('codegraph_node');
    expect(names).not.toContain('codegraph_search');
    expect(names).not.toContain('codegraph_callers');
    expect(names).not.toContain('codegraph_callees');
  });

  it('contains no final T060 steering that prefers Cypher or codegraph_query over explore', () => {
    for (const text of [SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_NO_ROOT_INDEX]) {
      const section = cypherQuerySection(text);

      expect(text).not.toMatch(/prefer\s+(?:`codegraph_query`|Cypher)[\s\S]{0,120}(?:over|instead of)[\s\S]{0,120}`codegraph_explore`/i);
      expect(text).not.toMatch(/(?:`codegraph_query`|Cypher)[\s\S]{0,120}(?:primary|default)\s+retrieval/i);
      expect(section).not.toMatch(/prefer\s+(?:`codegraph_query`|Cypher)/i);
      expect(section).not.toMatch(/(?:replace|supersede|instead of)\s+`codegraph_explore`/i);
    }
  });

  it('uses explicit reserved codegraph_query language for deliberate structured graph-language requests', () => {
    for (const text of [SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_NO_ROOT_INDEX]) {
      const section = cypherQuerySection(text);

      expect(section).toMatch(/\breserved\b[\s\S]{0,120}`codegraph_query`|`codegraph_query`[\s\S]{0,120}\breserved\b/i);
      expect(section).toMatch(/deliberate structured graph-language requests/i);
    }
  });
});

describe('SERVER_INSTRUCTIONS — codegraph_get_cfg bounded CFG guidance (T030)', () => {
  const original = process.env[ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  it('serves codegraph_query and codegraph_get_cfg by default while preserving codegraph_explore availability', () => {
    delete process.env[ENV];
    const names = getStaticTools().map((tool) => tool.name);

    expect(names).toEqual([
      'codegraph_query',
      'codegraph_detect_changes',
      'codegraph_explore',
      'codegraph_rename',
      'codegraph_get_cfg',
    ]);
    expect(names).toContain('codegraph_explore');
  });

  it('keeps codegraph_query and codegraph_get_cfg on the default live tiny-project tools/list surface', () => {
    delete process.env[ENV];
    const tinyProject = { getStats: () => ({ fileCount: 1 }) } as ConstructorParameters<typeof ToolHandler>[0];
    const names = new ToolHandler(tinyProject).getTools().map((tool) => tool.name);

    expect(names).toContain('codegraph_explore');
    expect(names).toContain('codegraph_query');
    expect(names).toContain('codegraph_get_cfg');
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
