/**
 * Embed-pass helpers (Slice A).
 *
 * Home for the pure, unit-testable helpers the inline embedding pass composes:
 * the vector codec below, and — added by a later task — the deterministic input
 * composition + SHA-256 input hashing. Kept as exported functions (not a class)
 * so each is directly testable in isolation.
 */

import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from './provider';
import type { EmbeddingConfig } from './config';
import type { QueryBuilder } from '../db/queries';
import type { Node } from '../types';

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

// --- Embed pass — unified full-index + incremental (T016/T025) --------------
//
// `runEmbeddingPass` is the exported orchestration entry the indexer drives after
// resolution. It STREAMS the eligible-but-unembedded symbols in `batchSize × concurrency`
// super-chunks: per super-chunk it composes each symbol's input and hands the whole
// super-chunk to the provider in ONE `embed()` call, so the provider's bounded pool runs
// `concurrency` `batchSize` requests at once; the returned vectors are then persisted in
// `batchSize`-sized transaction slices, committed serially — one commit per batch, never
// per-row and never a single pass-long transaction (FR-029). Only one super-chunk's
// composed inputs (the source-bearing strings) exist at a time, so memory stays bounded
// regardless of graph size (FR-028).
//
// The vector dimension is inferred from the first successful batch and persisted —
// with the active model — to the `project_metadata` scalars (D9/FR-004); a dimension
// already enforced (an explicit `CODEGRAPH_EMBEDDING_DIMS`, or one persisted for this
// same model) that the provider contradicts aborts the pass with a message naming
// `CODEGRAPH_EMBEDDING_DIMS` (FR-021). Any provider failure STOPS the pass — already
// committed batches stay durable — and is reported in the result rather than thrown,
// so a failed embed never fails the surrounding index (advisory, FR-014/019). Every
// abort reason is the redacted provider reason only: a symbol's source or composed
// input is never echoed into it (FR-025a).

/** Outcome of an embed pass. Returned even on an advisory abort — never thrown. */
export interface EmbeddingPassResult {
  /** Eligible symbols the pass set out to embed (its coverage denominator). */
  attempted: number;
  /** Symbols whose vectors were durably persisted. */
  embedded: number;
  /** True when a provider failure or a dimension conflict stopped the pass early. */
  aborted: boolean;
  /** Redacted reason for an abort — endpoint/dimension only, never source (FR-025a). */
  abortReason?: string;
}

/** The seam `runEmbeddingPass` drives — supplied by the indexer (or a test harness). */
export interface RunEmbeddingPassOptions {
  /** Query surface: eligible-node selection, vector upsert, metadata scalars. */
  queries: QueryBuilder;
  /** The active embedding provider (endpoint client, or a test fake). */
  provider: EmbeddingProvider;
  /** Active embedding config — model, batchSize, and any enforced dimension. */
  config: EmbeddingConfig;
  /**
   * Run one unit of writes inside a single transaction (BEGIN/COMMIT, ROLLBACK on
   * throw). Called once per completed batch — wire to `DatabaseConnection.transaction`.
   */
  transaction: <T>(fn: () => T) => T;
  /**
   * Fold the pass's WAL writes back into the main DB once it finishes (best-effort).
   * Wire to `DatabaseConnection.runMaintenance` (FR-030).
   */
  runMaintenance: () => void;
  /** Progress ping as each batch slice commits: `(embeddedSoFar, totalEligible)`. */
  onProgress?: (current: number, total: number) => void;
  /**
   * Refresh the held index-lock's mtime. Invoked on a wall-clock interval spanning the
   * whole pass (NOT at batch boundaries), so a long per-batch retry ladder can't starve
   * the refresh and let the lock be reaped as stale (FR-031).
   */
  refreshLock?: () => void;
  /**
   * Resolve a symbol's trimmed source snippet for composition. The caller (which
   * owns the project root) reads the file slice; kept out of this module so the pass
   * stays free of fs/path concerns, and invoked per-chunk so the source text is never
   * materialized for all symbols at once (FR-028). When omitted, the input composes
   * from the symbol's in-graph fields alone.
   */
  readSource?: (node: Node) => string | undefined;
}

/** Map a graph node to the deterministic composition input (§3 / D11). */
function toSymbolInput(node: Node, readSource?: (node: Node) => string | undefined): EmbeddingSymbolInput {
  const input: EmbeddingSymbolInput = { kind: node.kind, name: node.name };
  if (node.signature !== undefined) input.signature = node.signature;
  if (node.docstring !== undefined) input.docstring = node.docstring;
  const source = readSource?.(node);
  if (source !== undefined) input.source = source;
  return input;
}

/**
 * The redacted abort reason. The provider's own error is already source-free (its
 * message is endpoint + status only); this never appends composed input or source,
 * so no code text can leak through an abort (FR-025a).
 */
function abortReasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Parse a persisted positive-integer scalar; null/blank/invalid → undefined. */
function parseStoredDims(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Execute the embed pass. Selects symbols with no current-model vector PLUS those whose
 * stored input hash is now stale (an incremental edit), embeds them in batch-sized
 * transactions, and reconciles away vectors for removed symbols (FR-016/FR-017). On a
 * fresh graph this reduces to the full-index pass (nothing embedded yet, nothing to
 * reconcile). See the section header for the streaming/dims/abort contract; the result
 * is always returned (never thrown) so the caller can treat embedding as advisory
 * (FR-014/019).
 */
export async function runEmbeddingPass(opts: RunEmbeddingPassOptions): Promise<EmbeddingPassResult> {
  const { queries, provider, config, transaction, runMaintenance, onProgress, refreshLock, readSource } = opts;
  const model = config.model;

  // Selection (bounded metadata only — the composed inputs that carry source are built
  // per-chunk below so they never all coexist, FR-028):
  //   (1) symbols with NO current-model vector — missing, or embedded under a prior
  //       model (a model switch, FR-010). Always re-embedded.
  const missing = queries.selectEmbeddableNodesMissingVector(model);
  //   (2) symbols that DO carry a current-model vector but whose freshly-composed input
  //       no longer hashes to the stored value — genuinely edited symbols. This
  //       compose-and-compare is the network-free O(embeddable) staleness scan: only
  //       symbols whose input actually changed are queued for the endpoint (FR-016/
  //       FR-027). Each composed input is hashed then discarded, so the whole graph's
  //       source never materializes at once (FR-028).
  const changed: Node[] = [];
  for (const { node, inputHash } of queries.selectEmbeddedNodeHashes(model)) {
    if (computeInputHash(composeEmbeddingInput(toSymbolInput(node, readSource))) !== inputHash) {
      changed.push(node);
    }
  }
  const eligible = [...missing, ...changed];
  const attempted = eligible.length;

  // Enforcement target, read at pass start (D9/FR-021): an explicit
  // CODEGRAPH_EMBEDDING_DIMS (config.dims) enforces from the start; otherwise a
  // dimension already persisted for THIS SAME model enforces across passes. A scalar
  // left by a DIFFERENT model does not enforce — the model changed, so the first batch
  // re-infers and overwrites it (FR-010).
  const storedModel = queries.getMetadata('embedding_model');
  const enforcedDims =
    config.dims ?? (storedModel === model ? parseStoredDims(queries.getMetadata('embedding_dims')) : undefined);

  let embedded = 0;
  let wroteAnyBatch = false;
  let aborted = false;
  let abortReason: string | undefined;
  let dims: number | undefined; // established by the first successful batch

  // Refresh the held index lock on a wall-clock interval that spans the WHOLE pass —
  // NOT only at batch boundaries. A single batch's full retry ladder (up to maxRetries ×
  // the per-request timeout, plus backoff) can otherwise run for minutes with zero
  // refreshes and let the lock be reaped as stale (FR-031). The timer is unref'd so it
  // never keeps the process alive, and is cleared in `finally` so it can't outlive the
  // pass. A refresh throw is swallowed — lock refresh is always advisory.
  const LOCK_REFRESH_INTERVAL_MS = 30_000;
  const refreshTimer = refreshLock
    ? setInterval(() => { try { refreshLock(); } catch { /* lock refresh is advisory */ } }, LOCK_REFRESH_INTERVAL_MS)
    : undefined;
  refreshTimer?.unref?.();

  try {
    // Super-chunk the eligible symbols by `batchSize × concurrency` and hand each
    // super-chunk to the provider in ONE `embed()` call. The provider splits it into
    // `batchSize` batches and runs its bounded (`concurrency`) pool over them, so several
    // requests are genuinely in flight at once — without this, feeding one `batchSize`
    // chunk per awaited call left the pool starved at a single request. The returned
    // vectors are then persisted in `batchSize`-sized transaction slices, committed
    // serially, so the per-batch durability cadence (FR-029) is preserved even though the
    // endpoint work ran concurrently.
    //
    // Abort granularity: a failure of ANY batch rejects the whole super-chunk's `embed()`,
    // so NOTHING from that super-chunk is persisted (earlier super-chunks stay durable).
    // There is no checkpoint to replay — the next pass simply re-selects the still-missing
    // symbols (stateless resume, FR-021), so a lost super-chunk costs a re-embed of at most
    // `batchSize × concurrency` symbols.
    const superChunkSize = config.batchSize * config.concurrency;
    for (let offset = 0; offset < eligible.length; offset += superChunkSize) {
      const superChunk = eligible.slice(offset, offset + superChunkSize);
      const composed = superChunk.map((node) => composeEmbeddingInput(toSymbolInput(node, readSource)));

      let vectors: Float32Array[];
      try {
        vectors = await provider.embed(composed);
      } catch (err) {
        // Advisory abort (FR-014/019): stop, keep prior committed slices, never throw.
        aborted = true;
        abortReason = abortReasonOf(err);
        break;
      }

      // Defensive contract check: the EndpointProvider enforces one-vector-per-input
      // (FR-021a), but the pass accepts ANY EmbeddingProvider — a future provider that
      // returns a short/long batch must abort here, never misalign vectors to symbols.
      if (vectors.length !== composed.length) {
        aborted = true;
        abortReason = `provider returned ${vectors.length} vectors for ${composed.length} inputs`;
        break;
      }

      if (dims === undefined) {
        const established = vectors[0]?.length ?? 0;
        if (enforcedDims !== undefined && established !== enforcedDims) {
          // Advisory abort BEFORE writing anything — the enforced dimension wins, and the
          // message names the escape hatch (FR-021). No source is referenced.
          aborted = true;
          abortReason =
            `embedding dimension mismatch: the endpoint returned ${established}-dimension vectors ` +
            `but ${enforcedDims} is enforced (CODEGRAPH_EMBEDDING_DIMS). Set CODEGRAPH_EMBEDDING_DIMS=${established} ` +
            `to accept this model, or clear it to re-infer, then re-index.`;
          break;
        }
        dims = established;
        // Persist the enforcement scalars once, on first success (idempotent upsert).
        queries.setMetadata('embedding_dims', String(dims));
        queries.setMetadata('embedding_model', model);
      }

      const hashes = composed.map(computeInputHash);
      // One transaction per `batchSize`-sized slice (FR-029): each slice's vectors commit
      // atomically, and commits run serially even though the requests ran concurrently.
      for (let sliceStart = 0; sliceStart < superChunk.length; sliceStart += config.batchSize) {
        const sliceEnd = Math.min(sliceStart + config.batchSize, superChunk.length);
        transaction(() => {
          for (let k = sliceStart; k < sliceEnd; k++) {
            queries.upsertNodeVector(superChunk[k]!.id, model, dims!, encodeVector(vectors[k]!), hashes[k]!);
          }
        });
        wroteAnyBatch = true;
        embedded += sliceEnd - sliceStart;
        onProgress?.(embedded, attempted);
      }
    }

    // Reconcile the vector layer against the live node set: drop vectors for symbols that
    // no longer exist — deletions, and the transient orphans a file's node delete-reinsert
    // leaves behind (FR-017). A single auto-committed statement (NOT the per-batch
    // transaction seam), so the batch-commit cadence is unchanged. Runs on every pass —
    // including one that embedded nothing (a pure deletion) or aborted — since a removed
    // symbol is gone regardless of endpoint state. Advisory: a failure never fails the pass.
    let reconciledAny = false;
    try {
      reconciledAny = queries.deleteRemovedVectors() > 0;
    } catch {
      // ignore — reconciliation is best-effort, never load-bearing
    }

    // WAL-checkpoint the pass's writes (embedded batches and/or a reconciliation delete)
    // via the same maintenance the index runs; best-effort, never load-bearing (FR-030).
    if (wroteAnyBatch || reconciledAny) {
      try {
        runMaintenance();
      } catch {
        // ignore — a checkpoint failure never fails the pass
      }
    }
  } finally {
    if (refreshTimer !== undefined) clearInterval(refreshTimer);
  }

  const result: EmbeddingPassResult = { attempted, embedded, aborted };
  if (abortReason !== undefined) result.abortReason = abortReason;
  return result;
}
