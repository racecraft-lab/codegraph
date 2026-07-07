/**
 * local-tokenizer — pure BERT WordPiece tokenizer (SPEC-002, T013/T015).
 *
 * Turns text into the 3 int64 tensors the ONNX `Xenova/all-MiniLM-L6-v2`
 * model consumes: `input_ids`, `attention_mask`, `token_type_ids`
 * (archived SPEC-002 local-provider contract recoverable from
 * `.specify/memory/archive-reports/2026-07-07-SPEC-002.md`). A pure
 * function of (tokenizer.json, text) — no ONNX import, no filesystem access,
 * no hardcoded vocab. `local-embed-worker.ts` reads + JSON.parses the
 * verified `tokenizerPath` from `model-fetch.ts` and passes the parsed
 * object in here.
 *
 * Implements the standard BERT *uncased* WordPiece algorithm: basic
 * tokenization (lowercase, NFD accent-strip, whitespace + punctuation split),
 * then greedy longest-match-first WordPiece with `##` continuation and
 * `[UNK]` fallback. Every call returns a FIXED shape — `[CLS]`/`[SEP]`-framed
 * content is padded with `[PAD]` (or truncated) to exactly `maxSeqLen`, so
 * the caller always gets a stable `[1, seqLen]` tensor shape regardless of
 * input length (FR-009). This is a "good enough" fallback tokenizer —
 * SPEC-003 owns retrieval quality, not this module.
 */

/** The 3 int64 tensor inputs the model's ONNX graph expects, batch size 1. */
export interface TokenizerEncoding {
  inputIds: BigInt64Array;
  attentionMask: BigInt64Array;
  tokenTypeIds: BigInt64Array;
}

/**
 * The slice of a HuggingFace fast-tokenizer `tokenizer.json` this module
 * reads. All fields optional — every one falls back to the standard BERT
 * default when the source file doesn't pin its own value.
 */
export interface TokenizerJson {
  model?: {
    vocab?: Record<string, number>;
    unk_token?: string;
    continuing_subword_prefix?: string;
    max_input_chars_per_word?: number;
  };
  truncation?: {
    max_length?: number;
  } | null;
}

/**
 * Default fixed sequence length when `tokenizer.json` doesn't pin its own
 * `truncation.max_length`. BERT's own default is 512; 256 is picked instead
 * — generous for short code symbols/doc comments while keeping every batch
 * cheap. (The real Xenova/all-MiniLM-L6-v2 `tokenizer.json` pins 128, which
 * — being present — wins over this fallback.)
 */
export const DEFAULT_MAX_SEQ_LEN = 256;

const CLS_TOKEN = '[CLS]';
const SEP_TOKEN = '[SEP]';
const PAD_TOKEN = '[PAD]';
const DEFAULT_UNK_TOKEN = '[UNK]';
const DEFAULT_CONTINUING_SUBWORD_PREFIX = '##';
const DEFAULT_MAX_INPUT_CHARS_PER_WORD = 100;

/**
 * BERT's `_is_punctuation`: ASCII punctuation-ish ranges (covers symbols like
 * `+`/`<`/`~` that Unicode itself categorizes as Symbol, not Punctuation, but
 * BERT still splits on) plus Unicode general category P for everything else.
 */
function isPunctuation(ch: string): boolean {
  const code = ch.codePointAt(0);
  if (code === undefined) return false;
  if (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  ) {
    return true;
  }
  return /\p{P}/u.test(ch);
}

/**
 * NFD-decompose then drop every Unicode "Mn" (Mark, nonspacing) codepoint —
 * exactly BERT's `_run_strip_accents` (`unicodedata.category(char) == "Mn"`).
 */
function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{Mn}/gu, '');
}

/**
 * BasicTokenizer: whitespace-split, lowercase + strip-accents per word, then
 * split each word around punctuation (each punctuation char becomes its own
 * token, matching BERT's `_run_split_on_punc`).
 */
function basicTokenize(text: string): string[] {
  const words = text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const output: string[] = [];
  for (const raw of words) {
    const normalized = stripAccents(raw.toLowerCase());
    let current = '';
    for (const ch of normalized) {
      if (isPunctuation(ch)) {
        if (current) {
          output.push(current);
          current = '';
        }
        output.push(ch);
      } else {
        current += ch;
      }
    }
    if (current) output.push(current);
  }
  return output;
}

/**
 * WordpieceTokenizer: greedy longest-match-first over `word`, preferring the
 * longest vocab-matching prefix at each step and marking every continuation
 * piece with `continuingSubwordPrefix` ("##"). Falls back to a single
 * `unkToken` for the WHOLE word if it's longer than `maxInputCharsPerWord`,
 * or if any step finds no matching substring at all — BERT never emits a
 * partial split for a word it can't fully cover.
 */
function wordpieceTokenize(
  word: string,
  vocab: Record<string, number>,
  unkToken: string,
  continuingSubwordPrefix: string,
  maxInputCharsPerWord: number
): string[] {
  const chars = [...word];
  if (chars.length > maxInputCharsPerWord) return [unkToken];

  const output: string[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = chars.length;
    let matched: string | null = null;
    while (start < end) {
      let candidate = chars.slice(start, end).join('');
      if (start > 0) candidate = continuingSubwordPrefix + candidate;
      if (Object.prototype.hasOwnProperty.call(vocab, candidate)) {
        matched = candidate;
        break;
      }
      end -= 1;
    }
    if (matched === null) return [unkToken];
    output.push(matched);
    start = end;
  }
  return output;
}

/** Looks up a required special token's id; throws if the vocab doesn't define it. */
function requireVocabId(vocab: Record<string, number>, token: string): number {
  const id = vocab[token];
  if (id === undefined) {
    throw new Error(`local-tokenizer: tokenizer.json vocab is missing the required token ${token}`);
  }
  return id;
}

/**
 * Builds an `encode(text)` function from a parsed `tokenizer.json` object.
 * Reads the WordPiece vocab + config once, up front; the returned `encode`
 * does no I/O and never mutates its inputs.
 */
export function createLocalTokenizer(tokenizerJson: TokenizerJson): (text: string) => TokenizerEncoding {
  const vocab = tokenizerJson.model?.vocab ?? {};
  const unkToken = tokenizerJson.model?.unk_token ?? DEFAULT_UNK_TOKEN;
  const continuingSubwordPrefix =
    tokenizerJson.model?.continuing_subword_prefix ?? DEFAULT_CONTINUING_SUBWORD_PREFIX;
  const maxInputCharsPerWord = tokenizerJson.model?.max_input_chars_per_word ?? DEFAULT_MAX_INPUT_CHARS_PER_WORD;
  const maxSeqLen = tokenizerJson.truncation?.max_length ?? DEFAULT_MAX_SEQ_LEN;

  const clsId = requireVocabId(vocab, CLS_TOKEN);
  const sepId = requireVocabId(vocab, SEP_TOKEN);
  const padId = requireVocabId(vocab, PAD_TOKEN);
  const unkId = requireVocabId(vocab, unkToken);

  return function encode(text: string): TokenizerEncoding {
    const pieceIds: number[] = [];
    for (const word of basicTokenize(text)) {
      for (const piece of wordpieceTokenize(word, vocab, unkToken, continuingSubwordPrefix, maxInputCharsPerWord)) {
        pieceIds.push(piece === unkToken ? unkId : requireVocabId(vocab, piece));
      }
    }

    const maxContentLen = Math.max(0, maxSeqLen - 2); // room left after [CLS]/[SEP]
    const ids: number[] = [clsId, ...pieceIds.slice(0, maxContentLen), sepId];

    const inputIds = new BigInt64Array(maxSeqLen);
    const attentionMask = new BigInt64Array(maxSeqLen);
    const tokenTypeIds = new BigInt64Array(maxSeqLen); // all-zero: single-segment input only

    let i = 0;
    for (const id of ids) {
      inputIds[i] = BigInt(id);
      attentionMask[i] = 1n;
      i += 1;
    }
    for (; i < maxSeqLen; i += 1) {
      inputIds[i] = BigInt(padId);
      // attentionMask[i] stays at its zero-initialized default for [PAD].
    }

    return { inputIds, attentionMask, tokenTypeIds };
  };
}
