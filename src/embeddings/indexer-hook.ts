/**
 * Embed-pass helpers (Slice A).
 *
 * Home for the pure, unit-testable helpers the inline embedding pass composes:
 * the vector codec below, and — added by a later task — the deterministic input
 * composition + SHA-256 input hashing. Kept as exported functions (not a class)
 * so each is directly testable in isolation.
 */

import { createHash } from 'node:crypto';

// --- Vector codec (little-endian f32) -------------------------------------
//
// FR-011: each vector is persisted as a compact binary blob of little-endian
// 32-bit floats (`byteLength === dims * 4`). The byte order is fixed
// little-endian regardless of host endianness — `writeFloatLE`/`readFloatLE`
// encode the little-endian layout explicitly, so a big-endian host produces the
// identical bytes and the SPEC-003 search side decodes with the same assumption.

/** Encode a vector as a little-endian f32 BLOB (`byteLength === vector.length * 4`). */
export function encodeVector(vector: Float32Array): Buffer {
  const buf = Buffer.alloc(vector.length * 4);
  for (const [i, value] of vector.entries()) {
    buf.writeFloatLE(value, i * 4);
  }
  return buf;
}

/**
 * Decode a little-endian f32 BLOB back into a `Float32Array` of `dims` elements.
 * Round-trips `encodeVector` element-for-element. Throws if the blob length does
 * not match `dims * 4` (a corrupt or wrong-dimension row).
 */
export function decodeVector(blob: Buffer, dims: number): Float32Array {
  const expected = dims * 4;
  if (blob.byteLength !== expected) {
    throw new Error(
      `decodeVector: blob byteLength ${blob.byteLength} does not match dims * 4 (${expected})`,
    );
  }
  const out = new Float32Array(dims);
  for (let i = 0; i < dims; i++) {
    out[i] = blob.readFloatLE(i * 4);
  }
  return out;
}

// --- Embedding input composition & hashing (D11 / FR-007 / FR-008) ---------
//
// The embed pass composes each symbol's input deterministically — fixed field
// order, LF-normalized, capped by trimming the source snippet LAST — then
// hashes it (FR-008) to drive change detection. The cap is a fixed character
// constant, not a tokenizer (FR-025).

/**
 * Maximum composed-input length in characters (§3). The source snippet is
 * trimmed to fit; the other fields (kind/name/signature/doc) are never dropped,
 * so an enormous docstring can push the composed text past the cap.
 */
const INPUT_CHAR_CAP = 6000;

/** Normalize CRLF and lone CR to LF (FR-007) so identical content composes/hashes alike. */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** Minimal symbol shape the embed pass composes into a deterministic input (§3). */
export interface EmbeddingSymbolInput {
  kind: string;
  name: string;
  signature?: string;
  docstring?: string;
  source?: string;
}

/**
 * Compose a symbol's embedding input deterministically (§3 / D11 / FR-007).
 *
 * Fixed order, LF-normalized per field, newline-joined:
 *   kind: {kind}
 *   name: {name}
 *   signature: {signature}   (when present)
 *   doc: {docstring}         (when present)
 *   source:
 *   {snippet}                (when present; trimmed LAST to fit the cap)
 *
 * Capped at INPUT_CHAR_CAP by trimming the snippet — never the other fields. If
 * the non-snippet fields already fill the cap (enormous docstring), the snippet
 * is trimmed to zero and the text is left over-cap rather than dropping a field.
 */
export function composeEmbeddingInput(symbol: EmbeddingSymbolInput): string {
  const lines = [
    `kind: ${normalizeLineEndings(symbol.kind)}`,
    `name: ${normalizeLineEndings(symbol.name)}`,
  ];
  if (symbol.signature !== undefined) {
    lines.push(`signature: ${normalizeLineEndings(symbol.signature)}`);
  }
  if (symbol.docstring !== undefined) {
    lines.push(`doc: ${normalizeLineEndings(symbol.docstring)}`);
  }

  const prefix = lines.join('\n');
  if (symbol.source === undefined) {
    return prefix;
  }

  const sourceLabel = '\nsource:\n';
  const snippet = normalizeLineEndings(symbol.source);
  const snippetBudget = INPUT_CHAR_CAP - prefix.length - sourceLabel.length;
  if (snippetBudget <= 0) {
    // The non-snippet fields alone fill or exceed the cap: trim the snippet to
    // zero, but never drop the other fields (so the text may exceed the cap).
    return prefix + sourceLabel;
  }
  return prefix + sourceLabel + snippet.slice(0, snippetBudget);
}

/**
 * SHA-256 (hex) of the composed input over its normalized UTF-8 bytes (FR-008).
 * Identical content — including CRLF vs LF of the same content — hashes alike.
 */
export function computeInputHash(composed: string): string {
  return createHash('sha256')
    .update(normalizeLineEndings(composed), 'utf8')
    .digest('hex');
}
