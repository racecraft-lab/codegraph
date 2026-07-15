import { describe, it, expect, afterEach } from 'vitest';
import { ToolHandler } from '../src/mcp/tools';
import { createDetectChangesFixture, indexFixture, type DetectChangesFixture } from './helpers/detect-changes-fixture';

function textOf(result: Awaited<ReturnType<ToolHandler['execute']>>): string {
  return result.content[0]?.text ?? '';
}

describe('codegraph_detect_changes MCP tool', () => {
  let fixture: DetectChangesFixture | null = null;

  afterEach(() => {
    fixture?.close();
    fixture = null;
  });

  it('is exposed by default and returns JSON as a normal text payload', async () => {
    fixture = createDetectChangesFixture();
    await indexFixture(fixture);
    fixture.write('src/calculator.ts', 'export function computeTotal(value: number) {\n  return value + 2;\n}\n');

    const handler = new ToolHandler(fixture.cg);
    expect(handler.getTools().map((tool) => tool.name)).toContain('codegraph_detect_changes');

    const result = await handler.execute('codegraph_detect_changes', { mode: 'all', format: 'json' });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result));
    expect(payload.changedSymbols.some((s: { name: string }) => s.name === 'computeTotal')).toBe(true);
    expect(payload.exitCode).toBe(1);
  });

  it('returns threshold breaches without tool errors', async () => {
    fixture = createDetectChangesFixture();
    await indexFixture(fixture);
    fixture.write('src/calculator.ts', 'export function computeTotal(value: number) {\n  return value + 2;\n}\n');

    const result = await new ToolHandler(fixture.cg).execute('codegraph_detect_changes', {
      mode: 'all',
      format: 'json',
      failOn: 'callers>0',
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result));
    expect(payload.summary.status).toBe('threshold_breach');
    expect(payload.exitCode).toBe(2);
  });

  it('returns expected missing-index states as normal payloads', async () => {
    const result = await new ToolHandler(null).execute('codegraph_detect_changes', {
      mode: 'all',
      format: 'json',
      projectPath: '/tmp/definitely-not-a-codegraph-index',
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result));
    expect(payload.summary.status).toBe('unavailable');
    expect(payload.exitCode).toBe(3);
  });

  it('returns malformed input as a tool error before missing-index fallback', async () => {
    const result = await new ToolHandler(null).execute('codegraph_detect_changes', {
      mode: 'all',
      format: 'xml',
      projectPath: '/tmp/definitely-not-a-codegraph-index',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid detect-changes format: xml');
  });
});
