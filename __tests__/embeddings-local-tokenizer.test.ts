/**
 * BERT WordPiece tokenizer — unit tests (SPEC-002, T013).
 *
 * `createLocalTokenizer` is a pure function of a parsed HuggingFace
 * `tokenizer.json` object (never a hardcoded vocab) that turns text into the
 * 3 int64 tensors the ONNX `Xenova/all-MiniLM-L6-v2` model consumes:
 * `input_ids`/`attention_mask`/`token_type_ids`, each a `BigInt64Array` whose
 * flat length is the `seqLen` of a `[1, seqLen]` tensor
 * (archived SPEC-002 local-provider contract recoverable from
 * `.specify/memory/archive-reports/2026-07-07-SPEC-002.md`, FR-009).
 * Unit-testable without ONNX — this suite never touches `onnxruntime-web` or
 * the network.
 *
 * The fixture below is a hand-built, hermetic slice of the real WordPiece
 * schema (the pinned Xenova/all-MiniLM-L6-v2 `tokenizer.json`'s
 * `model.{unk_token,continuing_subword_prefix,max_input_chars_per_word,vocab}`
 * + `truncation.max_length`) — just enough tokens to assert the algorithm
 * precisely without the real ~30k-entry vocab.
 */
import { describe, it, expect } from 'vitest';
import { createLocalTokenizer, DEFAULT_MAX_SEQ_LEN } from '../src/embeddings/local-tokenizer';
import type { TokenizerJson } from '../src/embeddings/local-tokenizer';

/**
 * Deliberately tiny vocab exercising every algorithm path:
 *  - "hello" / "world"  -> single whole-word pieces
 *  - "running"          -> ["run", "##ning"]  (WordPiece continuation)
 *  - "foobar"           -> ["foo", "##bar"]   (a second, independent pair)
 *  - ","                -> its own punctuation piece
 *  - anything else (e.g. "zzz") -> no matching prefix at any length -> [UNK]
 */
const VOCAB: Record<string, number> = {
  '[PAD]': 0,
  '[UNK]': 1,
  '[CLS]': 2,
  '[SEP]': 3,
  hello: 4,
  world: 5,
  run: 6,
  '##ning': 7,
  foo: 8,
  '##bar': 9,
  ',': 10,
};

/** `truncation.max_length` defaults small so truncation/padding fixtures stay short. */
function fixture(maxLength?: number): TokenizerJson {
  return {
    model: {
      unk_token: '[UNK]',
      continuing_subword_prefix: '##',
      max_input_chars_per_word: 100,
      vocab: VOCAB,
    },
    truncation: maxLength === undefined ? null : { max_length: maxLength },
  };
}

describe('createLocalTokenizer — output shape', () => {
  it('returns inputIds/attentionMask/tokenTypeIds as same-length BigInt64Arrays', () => {
    const encode = createLocalTokenizer(fixture(6));
    const { inputIds, attentionMask, tokenTypeIds } = encode('hello');
    expect(inputIds).toBeInstanceOf(BigInt64Array);
    expect(attentionMask).toBeInstanceOf(BigInt64Array);
    expect(tokenTypeIds).toBeInstanceOf(BigInt64Array);
    // A flat length-seqLen array IS the payload of a [1, seqLen] tensor (the
    // worker applies the leading batch-of-1 dim via `new ort.Tensor(...)`).
    expect(inputIds.length).toBe(6);
    expect(attentionMask.length).toBe(6);
    expect(tokenTypeIds.length).toBe(6);
  });

  it('falls back to a 256-token default sequence length when tokenizer.json pins none', () => {
    const encode = createLocalTokenizer(fixture());
    const { inputIds } = encode('hello');
    expect(DEFAULT_MAX_SEQ_LEN).toBe(256);
    expect(inputIds.length).toBe(DEFAULT_MAX_SEQ_LEN);
  });
});

describe('createLocalTokenizer — [CLS]/[SEP] framing', () => {
  it('frames every input as [CLS] ...content... [SEP]', () => {
    const encode = createLocalTokenizer(fixture(6));
    const { inputIds } = encode('hello');
    expect(inputIds[0]).toBe(2n); // [CLS]
    expect(inputIds[1]).toBe(4n); // "hello"
    expect(inputIds[2]).toBe(3n); // [SEP]
  });

  it('produces the exact known token-id sequence for a two-word input', () => {
    const encode = createLocalTokenizer(fixture(6));
    const { inputIds } = encode('hello world');
    expect([...inputIds]).toEqual([2n, 4n, 5n, 3n, 0n, 0n]); // CLS hello world SEP PAD PAD
  });
});

describe('createLocalTokenizer — [PAD] + attention mask', () => {
  it('pads short input with [PAD] up to the fixed sequence length', () => {
    const encode = createLocalTokenizer(fixture(6));
    const { inputIds } = encode('hello');
    expect([...inputIds]).toEqual([2n, 4n, 3n, 0n, 0n, 0n]); // CLS hello SEP PAD PAD PAD
  });

  it('sets attentionMask to 1n for [CLS]/content/[SEP] and 0n for [PAD]', () => {
    const encode = createLocalTokenizer(fixture(6));
    const { attentionMask } = encode('hello');
    expect([...attentionMask]).toEqual([1n, 1n, 1n, 0n, 0n, 0n]);
  });
});

describe('createLocalTokenizer — tokenTypeIds', () => {
  it('is all-zero regardless of input', () => {
    const encode = createLocalTokenizer(fixture(6));
    const { tokenTypeIds } = encode('hello world');
    expect([...tokenTypeIds]).toEqual([0n, 0n, 0n, 0n, 0n, 0n]);
  });
});

describe('createLocalTokenizer — truncation', () => {
  it('truncates content tokens to fit maxSeqLen while always keeping [CLS] and [SEP]', () => {
    const encode = createLocalTokenizer(fixture(6));
    // Wordpieces to 6 content pieces (hello, world, run, ##ning, foo, ##bar)
    // but only 4 fit the content budget (maxSeqLen 6 - 2 for CLS/SEP); "foobar"
    // is dropped entirely rather than partially split.
    const { inputIds, attentionMask } = encode('hello world running foobar');
    expect([...inputIds]).toEqual([2n, 4n, 5n, 6n, 7n, 3n]); // CLS hello world run ##ning SEP
    expect([...attentionMask]).toEqual([1n, 1n, 1n, 1n, 1n, 1n]); // fully real, no PAD left
  });
});

describe('createLocalTokenizer — WordPiece ## continuation', () => {
  it('splits an unlisted word into known prefix + "##"-continuation pieces', () => {
    const encode = createLocalTokenizer(fixture(8));
    const { inputIds } = encode('running');
    expect([...inputIds].slice(0, 4)).toEqual([2n, 6n, 7n, 3n]); // CLS run ##ning SEP
  });

  it('resolves a second, independent continuation pair the same way', () => {
    const encode = createLocalTokenizer(fixture(8));
    const { inputIds } = encode('foobar');
    expect([...inputIds].slice(0, 4)).toEqual([2n, 8n, 9n, 3n]); // CLS foo ##bar SEP
  });
});

describe('createLocalTokenizer — [UNK] fallback', () => {
  it('maps a word with no matching vocab prefix at any length to [UNK]', () => {
    const encode = createLocalTokenizer(fixture(8));
    const { inputIds } = encode('zzz');
    expect([...inputIds].slice(0, 3)).toEqual([2n, 1n, 3n]); // CLS [UNK] SEP
  });
});

describe('createLocalTokenizer — lowercasing (uncased BERT)', () => {
  it('produces identical output for differently-cased input', () => {
    const encode = createLocalTokenizer(fixture(8));
    expect([...encode('HELLO').inputIds]).toEqual([...encode('hello').inputIds]);
  });
});

describe('createLocalTokenizer — punctuation splitting', () => {
  it('splits punctuation off the preceding word into its own token', () => {
    const encode = createLocalTokenizer(fixture(8));
    const { inputIds } = encode('hello, world');
    expect([...inputIds].slice(0, 5)).toEqual([2n, 4n, 10n, 5n, 3n]); // CLS hello , world SEP
  });
});
