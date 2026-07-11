import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * SPEC-005 T009 — ship-check for the read-slice OpenAPI contract.
 *
 * The committed contract (`src/server/openapi.yaml`) must be copied into
 * `dist/server/` by `copy-assets` (Constitution VII: a static asset that isn't
 * in copy-assets doesn't ship), and the shipped copy must be well-formed YAML
 * documenting the eight read-tagged (Slice 1) paths.
 *
 * Zero-dep by design (FR-025 / plan.md "zero new deps"): the repo ships no YAML
 * parser, so this walks the document structurally rather than importing one.
 * T029 grows this file into the full contract walk against a running fixture.
 */

// The committed source and the shipped copy of the read-slice contract.
const SRC_SPEC = path.resolve(__dirname, '../src/server/openapi.yaml');
const DIST_SPEC = path.resolve(__dirname, '../dist/server/openapi.yaml');

// The eight read-tagged (Slice 1) paths this artifact must document.
const READ_PATHS = [
  '/api/status',
  '/api/repos',
  '/api/search',
  '/api/node/{id}',
  '/api/callers/{id}',
  '/api/callees/{id}',
  '/api/impact/{id}',
  '/api/graph/{id}',
];

/**
 * Zero-dep structural read of the `paths:` block's child keys (the path
 * templates indented exactly two spaces under it). Throws on tab indentation
 * (YAML forbids tabs) or a missing `paths:` section, so a truncated/corrupt
 * shipped copy is caught. Not a general YAML parser — scoped to the assertion.
 */
function pathKeys(yaml: string): string[] {
  if (yaml.includes('\t')) throw new Error('YAML indentation must not use tabs');
  const lines = yaml.split(/\r?\n/);
  const start = lines.indexOf('paths:');
  if (start === -1) throw new Error('missing top-level `paths:` mapping');
  const keys: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\S/.test(line)) break; // next top-level key => end of the paths block
    const m = line.match(/^ {2}(\/[^:\s]+):\s*$/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

describe('openapi ship check', () => {
  it('commits the read-slice contract source at src/server/openapi.yaml', () => {
    expect(fs.existsSync(SRC_SPEC)).toBe(true);
  });

  it('ships dist/server/openapi.yaml via copy-assets, byte-identical to source', () => {
    expect(fs.existsSync(DIST_SPEC)).toBe(true);
    expect(fs.readFileSync(DIST_SPEC).equals(fs.readFileSync(SRC_SPEC))).toBe(true);
  });

  it('is well-formed YAML documenting exactly the 8 read-tagged paths', () => {
    expect(fs.existsSync(DIST_SPEC)).toBe(true);
    const yaml = fs.readFileSync(DIST_SPEC, 'utf8');
    expect(yaml).toMatch(/^openapi:\s*3\.1\.0\s*$/m);
    expect(yaml).toMatch(/^components:\s*$/m);
    const keys = pathKeys(yaml);
    for (const p of READ_PATHS) expect(keys).toContain(p);
    expect(keys).toHaveLength(READ_PATHS.length);
  });

  it('omits the Slice-2 /api/reindex jobs paths', () => {
    expect(fs.existsSync(DIST_SPEC)).toBe(true);
    // Assert on parsed path keys (not raw substrings): the header comment
    // deliberately names the excluded jobs surface, so a naive text match
    // would false-positive on the documentation of the omission itself.
    const keys = pathKeys(fs.readFileSync(DIST_SPEC, 'utf8'));
    expect(keys.some((k) => k.includes('reindex'))).toBe(false);
  });
});
