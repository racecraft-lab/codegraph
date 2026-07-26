import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/python');

const PYTHON_FIXTURES = [
  {
    file: 'async_await.py',
    contains: ['async def fetch_profile(', 'await client.fetch_profile(', 'return await client.refresh_profile('],
  },
  {
    file: 'comprehensions.py',
    contains: [
      '[item.name for item in items if item.active]',
      '{item.kind for item in items if item.kind}',
      '{item.name: item.score for item in items if item.score >= minimum}',
      '(item.score for item in items if item.score >= minimum)',
    ],
  },
  {
    file: 'generators.py',
    contains: ['def stream_chunks(', 'yield chunk', 'yield from fallback'],
  },
  {
    file: 'lambdas_and_nested_classes.py',
    contains: ['transform = lambda value: value.strip().lower()', 'class LocalFormatter:', 'return LocalFormatter(prefix).format_all(values)'],
  },
  {
    file: 'match_case.py',
    contains: [
      'match event:',
      'case {"type": "click", "target": target} if target:',
      'case {"type": "submit"}:',
      'case _:',
    ],
  },
  {
    file: 'parity_baseline.py',
    contains: ['def branch_loop_parity(', 'for item in items:', 'while attempts < 3:', 'continue'],
  },
  {
    file: 'raise_and_unreachable.py',
    contains: ['raise ValueError("missing name")', 'return "accepted"', 'unreachable_after_return = "never reached"'],
  },
] as const;

describe('SPEC-014 T003 Python CFG fixture inventory', () => {
  it('commits deterministic Python fixtures for the Python CFG construct families', () => {
    expect(fs.existsSync(FIXTURE_DIR), 'Python fixture directory must be committed').toBe(true);

    const expectedFiles = PYTHON_FIXTURES.map((fixture) => fixture.file);
    const actualFiles = fs.readdirSync(FIXTURE_DIR).filter((file) => file.endsWith('.py')).sort();
    expect(actualFiles).toEqual(expectedFiles);

    for (const fixture of PYTHON_FIXTURES) {
      const source = fs.readFileSync(path.join(FIXTURE_DIR, fixture.file), 'utf8');
      expect(source, `${fixture.file} uses LF line endings`).not.toContain('\r');
      expect(source, `${fixture.file} ends with a newline`).toMatch(/\n$/);

      for (const expected of fixture.contains) {
        expect(source, `${fixture.file} contains ${expected}`).toContain(expected);
      }
    }
  });
});
