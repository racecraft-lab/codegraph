/**
 * Deterministic embedding-input composition + SHA-256 input hashing
 * (D11 / FR-007 / FR-008 / FR-025).
 *
 * The embed pass composes each symbol's input BEFORE calling the provider, in a
 * fixed field order, LF-normalized, capped at ~6,000 characters by trimming the
 * source snippet LAST (never dropping kind/name/signature/doc). The composed
 * text is hashed with SHA-256 (hex) to drive change detection; identical symbol
 * content always yields byte-identical composed text and therefore an identical
 * hash, and CRLF vs LF of the same content hash identically.
 *
 * Contract: specs/001-embedding-infrastructure/contracts/embedding-provider.md §3
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  composeEmbeddingInput,
  computeInputHash,
} from '../src/embeddings/indexer-hook';

// The character cap is a fixed contract constant (§3): ~6,000 chars total.
const INPUT_CHAR_CAP = 6000;

describe('embedding input composition — composeEmbeddingInput (D11 / FR-007)', () => {
  it('composes all fields in fixed order kind/name/signature/doc/source', () => {
    const composed = composeEmbeddingInput({
      kind: 'function',
      name: 'greet',
      signature: '(name: string): string',
      docstring: 'Returns a greeting.',
      source: 'return name;',
    });
    expect(composed).toBe(
      'kind: function\n' +
        'name: greet\n' +
        'signature: (name: string): string\n' +
        'doc: Returns a greeting.\n' +
        'source:\n' +
        'return name;',
    );
  });

  it('composes a minimal symbol (kind + name only) with no other lines', () => {
    const composed = composeEmbeddingInput({ kind: 'variable', name: 'count' });
    expect(composed).toBe('kind: variable\nname: count');
  });

  it('omits the doc and source lines when only a signature is present', () => {
    const composed = composeEmbeddingInput({
      kind: 'method',
      name: 'run',
      signature: '(): void',
    });
    expect(composed).toBe('kind: method\nname: run\nsignature: (): void');
  });

  it('omits the signature and source lines when only a docstring is present', () => {
    const composed = composeEmbeddingInput({
      kind: 'class',
      name: 'Foo',
      docstring: 'A foo.',
    });
    expect(composed).toBe('kind: class\nname: Foo\ndoc: A foo.');
  });

  it('trims the snippet LAST so a huge snippet fits under the cap with other fields intact', () => {
    const hugeSnippet = 'x'.repeat(20000);
    const composed = composeEmbeddingInput({
      kind: 'function',
      name: 'big',
      signature: '() => void',
      docstring: 'A big one',
      source: hugeSnippet,
    });

    // Total length is capped.
    expect(composed.length).toBeLessThanOrEqual(INPUT_CHAR_CAP);
    // Snippet filled the remaining budget (not over-trimmed).
    expect(composed.length).toBeGreaterThan(INPUT_CHAR_CAP - 100);

    // Every non-snippet field survives intact.
    expect(composed).toContain('kind: function');
    expect(composed).toContain('name: big');
    expect(composed).toContain('signature: () => void');
    expect(composed).toContain('doc: A big one');
    expect(composed).toContain('source:\n');

    // The snippet was truncated: some survived, but not all 20,000 chars.
    const snippetChars = (composed.match(/x/g) ?? []).length;
    expect(snippetChars).toBeGreaterThan(0);
    expect(snippetChars).toBeLessThan(20000);
  });

  it('trims the snippet to zero before dropping any other field (enormous docstring)', () => {
    const hugeDoc = 'd'.repeat(20000);
    const composed = composeEmbeddingInput({
      kind: 'function',
      name: 'big',
      signature: '() => void',
      docstring: hugeDoc,
      source: 'return 1;',
    });

    // The docstring is never truncated — it survives intact...
    expect(composed).toContain(`doc: ${hugeDoc}`);
    // ...as do the other non-snippet fields.
    expect(composed).toContain('kind: function');
    expect(composed).toContain('name: big');
    expect(composed).toContain('signature: () => void');

    // Only the snippet is the trim target: its content is trimmed to zero.
    expect(composed).not.toContain('return 1;');

    // With an enormous docstring the composed text may exceed the cap, because
    // the non-snippet fields are never dropped (only the snippet is trimmed).
    expect(composed.length).toBeGreaterThan(INPUT_CHAR_CAP);
  });

  it('normalizes CRLF and lone CR to LF per field, so CRLF and LF content compose byte-identically (FR-007)', () => {
    const crlf = composeEmbeddingInput({
      kind: 'function',
      name: 'f',
      docstring: 'line1\r\nline2',
      source: 'a\rb\r\nc',
    });
    const lf = composeEmbeddingInput({
      kind: 'function',
      name: 'f',
      docstring: 'line1\nline2',
      source: 'a\nb\nc',
    });
    expect(crlf).toBe(lf);
    // And there is no carriage return left anywhere in the composed output.
    expect(crlf).not.toMatch(/\r/);
  });
});

describe('embedding input hashing — computeInputHash (FR-008)', () => {
  it('returns a 64-character lowercase hex SHA-256 digest', () => {
    const hash = computeInputHash('kind: variable\nname: count');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches an independent SHA-256 hex digest over the UTF-8 bytes', () => {
    const composed = composeEmbeddingInput({
      kind: 'function',
      name: 'greet',
      signature: '(name: string): string',
      docstring: 'Returns a greeting.',
      source: 'return name;',
    });
    const expected = createHash('sha256').update(composed, 'utf8').digest('hex');
    expect(computeInputHash(composed)).toBe(expected);
  });

  it('is stable across repeated calls with the same input', () => {
    const composed = 'kind: function\nname: greet\nsource:\nreturn name;';
    expect(computeInputHash(composed)).toBe(computeInputHash(composed));
  });

  it('produces identical hashes for identical content', () => {
    const a = composeEmbeddingInput({ kind: 'function', name: 'f', source: 'x' });
    const b = composeEmbeddingInput({ kind: 'function', name: 'f', source: 'x' });
    expect(computeInputHash(a)).toBe(computeInputHash(b));
  });

  it('produces different hashes for differing content', () => {
    const a = computeInputHash('kind: function\nname: f\nsource:\nx');
    const b = computeInputHash('kind: function\nname: f\nsource:\ny');
    expect(a).not.toBe(b);
  });

  it('hashes CRLF and LF of the same content identically (FR-008)', () => {
    expect(computeInputHash('a\r\nb\rc')).toBe(computeInputHash('a\nb\nc'));
  });
});
