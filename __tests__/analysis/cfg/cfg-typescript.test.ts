import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

type FixtureCase = {
  readonly fileName: string;
  readonly label: string;
  readonly requiredSnippets: readonly string[];
};

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'tsjs');

const FIXTURES: readonly FixtureCase[] = [
  {
    fileName: 'baseline.ts',
    label: 'baseline',
    requiredSnippets: ['export function baselineScore', 'if (input > 10)', 'return total;'],
  },
  {
    fileName: 'unsupported.js',
    label: 'unsupported',
    requiredSnippets: ['export async function* unsupportedStream', 'yield await Promise.resolve'],
  },
  {
    fileName: 'over-limit.ts',
    label: 'over-limit',
    requiredSnippets: ['export function overLimitBranches', 'case 24:', 'return total;'],
  },
  {
    fileName: 'throw-finally.js',
    label: 'throw-finally',
    requiredSnippets: ['export function throwFinally', 'throw new Error', 'finally'],
  },
  {
    fileName: 'short-circuit.ts',
    label: 'short-circuit',
    requiredSnippets: ['export function shortCircuit', '&&', '||'],
  },
  {
    fileName: 'switch.js',
    label: 'switch',
    requiredSnippets: ['export function switchRoute', 'case \'start\':', 'default:'],
  },
  {
    fileName: 'optional-chaining.ts',
    label: 'optional-chaining',
    requiredSnippets: ['export function optionalChain', '?.', 'profile?.name'],
  },
  {
    fileName: 'nullish-coalescing.js',
    label: 'nullish-coalescing',
    requiredSnippets: ['export function nullishCoalesce', '??', 'config.retryCount ?? 3'],
  },
  {
    fileName: 'nested-functions.ts',
    label: 'nested-functions',
    requiredSnippets: ['export function outerWorkflow', 'function innerStep', 'const finish ='],
  },
  {
    fileName: 'unreachable.js',
    label: 'unreachable',
    requiredSnippets: ['export function unreachableBranch', 'return \'early\';', 'return \'unreachable\';'],
  },
  {
    fileName: 'no-op.ts',
    label: 'no-op',
    requiredSnippets: ['export function noOpFixture', 'return undefined;'],
  },
];

describe('TypeScript/JavaScript CFG fixtures', () => {
  it('keeps the deterministic fixture inventory for baseline CFG coverage', () => {
    const entries = fs.existsSync(FIXTURE_DIR)
      ? fs.readdirSync(FIXTURE_DIR, { withFileTypes: true })
      : [];
    const fileNames = entries.map((entry) => entry.name).sort();

    expect(fileNames).toEqual(FIXTURES.map((fixture) => fixture.fileName).sort());
    expect(entries.every((entry) => entry.isFile())).toBe(true);

    for (const fixture of FIXTURES) {
      const source = fs.readFileSync(path.join(FIXTURE_DIR, fixture.fileName), 'utf8');

      expect(source).toContain(`cfg-case: ${fixture.label}`);
      expect(source.endsWith('\n')).toBe(true);
      expect(source).not.toContain('\r');

      for (const snippet of fixture.requiredSnippets) {
        expect(source).toContain(snippet);
      }
    }
  });
});
