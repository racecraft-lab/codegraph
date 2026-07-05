/**
 * Vector codec — Float32Array <-> little-endian f32 Buffer (FR-011).
 *
 * Each embedding vector is persisted as a compact binary blob of little-endian
 * 32-bit floats. The byte order MUST be fixed little-endian regardless of the
 * host's native endianness (the SPEC-003 search side decodes with the same
 * assumption), `encodeVector(v).byteLength === v.length * 4`, and
 * `decodeVector(encodeVector(v), v.length)` MUST round-trip `v`
 * element-for-element.
 *
 * Contract: specs/001-embedding-infrastructure/contracts/node-vectors-schema.md
 */

import { describe, it, expect } from 'vitest';
import { encodeVector, decodeVector } from '../src/embeddings/indexer-hook';

describe('vector codec — encodeVector', () => {
  it('returns a Buffer whose byteLength is dims * 4', () => {
    for (const dims of [1, 3, 128, 1536]) {
      const buf = encodeVector(new Float32Array(dims));
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.byteLength).toBe(dims * 4);
    }
  });

  it('lays out Float32 1.0 as little-endian bytes [00 00 80 3f] regardless of host', () => {
    const buf = encodeVector(new Float32Array([1.0]));
    expect([...buf]).toEqual([0x00, 0x00, 0x80, 0x3f]);
  });

  it('lays out a negative value little-endian (Float32 -1.5 -> [00 00 c0 bf])', () => {
    const buf = encodeVector(new Float32Array([-1.5]));
    expect([...buf]).toEqual([0x00, 0x00, 0xc0, 0xbf]);
  });

  it('writes multi-element vectors in order, each little-endian ([1.0, 2.0])', () => {
    const buf = encodeVector(new Float32Array([1.0, 2.0]));
    expect([...buf]).toEqual([
      0x00, 0x00, 0x80, 0x3f, // 1.0
      0x00, 0x00, 0x00, 0x40, // 2.0
    ]);
  });
});

describe('vector codec — decodeVector', () => {
  it('round-trips element-for-element through encode -> decode', () => {
    // Values are constructed into the Float32Array first, so each element is
    // already f32-quantized; the round-trip must reproduce them exactly.
    const input = new Float32Array([
      0,
      -1.5,
      Math.PI,
      1e-30, // very small (normal f32)
      1e30, // very large (finite f32)
      -3.4e38, // near the negative f32 max
      1.175e-38, // near the smallest normal f32
    ]);
    const decoded = decodeVector(encodeVector(input), input.length);
    expect(decoded).toBeInstanceOf(Float32Array);
    expect(decoded.length).toBe(input.length);
    for (let i = 0; i < input.length; i++) {
      expect(decoded[i]).toBe(input[i]);
    }
  });

  it('decodes a known little-endian byte layout back to the original floats', () => {
    const blob = Buffer.from([
      0x00, 0x00, 0x80, 0x3f, // 1.0
      0x00, 0x00, 0x00, 0x40, // 2.0
    ]);
    const decoded = decodeVector(blob, 2);
    expect(decoded.length).toBe(2);
    expect(decoded[0]).toBe(1.0);
    expect(decoded[1]).toBe(2.0);
  });

  it('preserves NaN through a round-trip', () => {
    const decoded = decodeVector(encodeVector(new Float32Array([NaN])), 1);
    expect(Number.isNaN(decoded[0])).toBe(true);
  });

  it('throws when the blob length does not match dims * 4', () => {
    const buf = encodeVector(new Float32Array([1, 2, 3])); // 12 bytes
    expect(() => decodeVector(buf, 4)).toThrow(); // expects 16 bytes
    expect(() => decodeVector(buf, 2)).toThrow(); // expects 8 bytes
    expect(() => decodeVector(Buffer.alloc(0), 1)).toThrow(); // expects 4 bytes
  });
});
