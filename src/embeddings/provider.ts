/**
 * EmbeddingProvider — the provider seam.
 *
 * The single interface downstream specs consume: SPEC-002 (bundled model) and
 * SPEC-003 (retrieval) depend only on this shape, never on a concrete provider.
 * The one shipped implementation is the OpenAI-compatible `EndpointProvider`.
 *
 * Contract: specs/001-embedding-infrastructure/contracts/embedding-provider.md §1.
 */

/**
 * Produces embedding vectors for batches of composed input strings.
 *
 * Seam guarantees relied on by SPEC-002/003:
 * - Output order matches input order: one `Float32Array` per input, index i → vector i.
 * - Every returned vector has length `dims`.
 * - `dims` is known after the first successful batch (inferred) for endpoint
 *   providers, or up front from config.
 */
export interface EmbeddingProvider {
  /** Stable identifier of the active model (== EmbeddingConfig.model for the endpoint provider). */
  readonly id: string;

  /** Vector dimension. Known after the first successful batch (inferred) or from config. */
  readonly dims: number;

  /**
   * Embed a batch of composed input strings, preserving order.
   * Resolves to one Float32Array per input, each of length `dims`.
   * Rejects on unrecoverable endpoint failure AFTER the bounded retry budget (D5).
   */
  embed(texts: string[]): Promise<Float32Array[]>;
}
