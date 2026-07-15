/**
 * SPEC-011 T059 (CRITICAL do-not-regress) — `codegraph_explore` is untouched by
 * this feature (FR-031, SC-012, Constitution VI).
 *
 * SPEC-011 adds three NEW catalog tools and NEVER changes `codegraph_explore`,
 * its budgets, or the agent-facing steering. This test proves all three:
 *
 *   1. GOLDEN — `codegraph_explore` output over a fixed corpus is byte-identical
 *      to a committed golden, and byte-identical across two runs of the same
 *      call (determinism). Any change to explore's output — from this feature or
 *      later — fails here (regenerate deliberately with UPDATE_EXPLORE_GOLDEN=1).
 *   2. NO CATALOG STEERING — neither the explore output nor the MCP `initialize`
 *      instructions (`server-instructions.ts`, the single low-salience steering
 *      channel) mention flows/clusters/catalog tools. The feature added zero
 *      steering (the AGENTS.md do-not-regress rule).
 *   3. BUDGETS PINNED — `getExploreBudget` / `getExploreOutputBudget` (the two
 *      explore knobs the MCP AGENTS.md flags as the regression surface) return
 *      their exact pre-feature tier values, and the monotonic-`maxCharsPerFile`
 *      invariant holds.
 *
 * Real files + real SQLite (no mocking).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import CodeGraph from '../../src/index';
import { ToolHandler, getExploreBudget, getExploreOutputBudget } from '../../src/mcp/tools';
import { SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_NO_ROOT_INDEX } from '../../src/mcp/server-instructions';

const dirs: string[] = [];
const graphs: CodeGraph[] = [];
afterEach(() => {
  while (graphs.length) {
    try {
      graphs.pop()!.destroy();
    } catch {
      /* ignore */
    }
  }
  while (dirs.length) {
    try {
      fs.rmSync(dirs.pop()!, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

/**
 * A fixed 2-file corpus + query. The output is relative-path only (no temp dir
 * leaks), so the golden is portable across machines/CI. Keep this and the query
 * frozen — changing them requires regenerating the golden.
 */
const CORPUS: Record<string, string> = {
  'src/feature.ts':
    'export function target() { return 1; }\n' +
    'export function caller() { return target(); }\n',
  'src/helper.ts':
    "import { target } from './feature';\n" +
    'export function useTarget() { return target() + 1; }\n',
};
const QUERY = 'target caller useTarget';
const GOLDEN_PATH = path.resolve(__dirname, 'fixtures', 'explore-golden.txt');

async function exploreCorpus(): Promise<{ text: string; text2: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-explore-golden-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(CORPUS)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  const cg = CodeGraph.initSync(dir, { config: { include: ['**/*.ts'], exclude: [] } });
  graphs.push(cg);
  await cg.indexAll();
  const handler = new ToolHandler(cg);
  const read = async (): Promise<string> => {
    const res = await handler.execute('codegraph_explore', { query: QUERY });
    return res.content[0]?.type === 'text' ? res.content[0].text : '';
  };
  return { text: await read(), text2: await read() };
}

describe('SPEC-011 T059 — codegraph_explore golden (FR-031/SC-012, do-not-regress)', () => {
  it('produces byte-identical output vs the committed golden and across repeat calls', async () => {
    const { text, text2 } = await exploreCorpus();

    // Byte-identical for a fixed corpus (SC-012 core property).
    expect(text2).toBe(text);
    expect(text.length).toBeGreaterThan(0);

    // Golden lock. Regenerate deliberately: UPDATE_EXPLORE_GOLDEN=1 vitest run …
    if (process.env.UPDATE_EXPLORE_GOLDEN === '1') fs.writeFileSync(GOLDEN_PATH, text);
    const golden = fs.readFileSync(GOLDEN_PATH, 'utf8');
    expect(text).toBe(golden);

    // The explore output carries NO catalog content (no flow/cluster surfacing).
    for (const token of ['list_flows', 'list_clusters', 'get_flow', 'canonicalLabel', 'isSingleton', 'functional cluster']) {
      expect(text).not.toContain(token);
    }
  });

  it('server-instructions carry no flow/cluster/catalog steering (the low-salience channel is untouched)', () => {
    for (const instructions of [SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_NO_ROOT_INDEX]) {
      const lower = instructions.toLowerCase();
      expect(lower).not.toContain('cluster');
      expect(lower).not.toContain('catalog');
      expect(instructions).not.toContain('codegraph_list_flows');
      expect(instructions).not.toContain('codegraph_get_flow');
      expect(instructions).not.toContain('codegraph_list_clusters');
    }
  });

  it('getExploreBudget returns the exact pre-feature call-budget tiers', () => {
    const pairs: Array<[number, number]> = [
      [0, 1], [499, 1],
      [500, 2], [4999, 2],
      [5000, 3], [14999, 3],
      [15000, 4], [24999, 4],
      [25000, 5], [100000, 5],
    ];
    for (const [fileCount, expected] of pairs) {
      expect(getExploreBudget(fileCount), `getExploreBudget(${fileCount})`).toBe(expected);
    }
  });

  it('getExploreOutputBudget keeps the exact pre-feature per-file caps and stays monotonic', () => {
    const perFile: Array<[number, number]> = [
      [100, 3800], [400, 3800],
      [1000, 6500],
      [10000, 7000], [30000, 7000],
    ];
    for (const [fileCount, expected] of perFile) {
      expect(getExploreOutputBudget(fileCount).maxCharsPerFile, `maxCharsPerFile @${fileCount}`).toBe(expected);
    }
    // Invariant (MCP AGENTS.md): a larger tier never gets a smaller per-file cap.
    const ascending = [50, 200, 800, 6000, 12000, 20000, 40000];
    const caps = ascending.map((n) => getExploreOutputBudget(n).maxCharsPerFile);
    for (let i = 1; i < caps.length; i++) {
      expect(caps[i]!, `monotonic maxCharsPerFile at fileCount=${ascending[i]}`).toBeGreaterThanOrEqual(caps[i - 1]!);
    }
  });
});
