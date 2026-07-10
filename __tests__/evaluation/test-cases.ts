import type { EvalTestCase } from './types.js';

export const testCases: EvalTestCase[] = [
  // === searchNodes: Symbol Lookup Precision ===

  {
    id: 'search-class-exact',
    query: 'TransportService',
    api: 'searchNodes',
    expectedSymbols: ['TransportService'],
    kinds: ['class'],
  },
  {
    id: 'search-method-qualified',
    query: 'TransportService sendRequest',
    api: 'searchNodes',
    expectedSymbols: ['sendRequest'],
    kinds: ['method'],
  },
  {
    id: 'search-interface',
    query: 'ActionListener',
    api: 'searchNodes',
    expectedSymbols: ['ActionListener'],
    kinds: ['interface'],
  },
  {
    id: 'search-enum',
    query: 'RestStatus',
    api: 'searchNodes',
    expectedSymbols: ['RestStatus'],
    kinds: ['enum'],
  },
  {
    id: 'search-exception',
    query: 'SearchPhaseExecutionException',
    api: 'searchNodes',
    expectedSymbols: ['SearchPhaseExecutionException'],
    kinds: ['class'],
  },
  {
    id: 'search-nested-class',
    query: 'Engine Index',
    api: 'searchNodes',
    expectedSymbols: ['Index'],
    kinds: ['class'],
  },

  // === findRelevantContext: Exploration Quality ===

  {
    id: 'explore-rest-layer',
    query: 'How does the REST layer handle HTTP requests?',
    api: 'findRelevantContext',
    expectedSymbols: ['RestController', 'RestHandler', 'BaseRestHandler', 'RestRequest'],
    options: { searchLimit: 8, traversalDepth: 3, maxNodes: 80, minScore: 0.2 },
  },
  {
    id: 'explore-search-execution',
    query: 'How does search execution work from request to shard?',
    api: 'findRelevantContext',
    expectedSymbols: ['ShardSearchRequest', 'SearchShardsRequest', 'SearchShardsGroup'],
    options: { searchLimit: 8, traversalDepth: 3, maxNodes: 80, minScore: 0.2 },
  },
  {
    id: 'explore-bulk-indexing',
    query: 'How does bulk indexing work?',
    api: 'findRelevantContext',
    expectedSymbols: ['TransportBulkAction', 'BulkRequest', 'BulkResponse'],
    options: { searchLimit: 8, traversalDepth: 3, maxNodes: 80, minScore: 0.2 },
  },
  {
    id: 'explore-shard-allocation',
    query: 'How does shard rebalancing and allocation work?',
    api: 'findRelevantContext',
    expectedSymbols: ['AllocationService', 'BalancedShardsAllocator'],
    options: { searchLimit: 8, traversalDepth: 3, maxNodes: 80, minScore: 0.2 },
  },
  {
    id: 'explore-transport-search',
    query: 'How does TransportService connect to SearchTransportService?',
    api: 'findRelevantContext',
    expectedSymbols: ['TransportService', 'SearchTransportService'],
    options: { searchLimit: 8, traversalDepth: 3, maxNodes: 80, minScore: 0.2 },
  },
  {
    id: 'explore-engine-implementations',
    query: 'What are the Engine implementations for indexing?',
    api: 'findRelevantContext',
    expectedSymbols: ['InternalEngine', 'ReadOnlyEngine', 'Engine'],
    options: { searchLimit: 8, traversalDepth: 3, maxNodes: 80, minScore: 0.2 },
  },

  // === searchNodes hybrid: Semantic / Paraphrase Retrieval (SPEC-003 FR-014) ===
  //
  // These mirror the CI gate's paraphrase shape (hybrid-search.test.ts) in the
  // scored harness: natural-language queries whose wording deliberately AVOIDS
  // the target symbol's own tokens, so a keyword-only match cannot trivially win
  // and the semantic arm has to carry the recall. Each expectedSymbol is reused
  // from a passing keyword/exploration case above, so it is known to exist in the
  // corpus. When no live embedding provider is available the library degrades to
  // keyword (the recorded scores just reflect that); the deterministic gate lives
  // in hybrid-search.test.ts, not here.

  {
    id: 'hybrid-paraphrase-transport',
    query: 'the layer that ships an action to a remote node over the wire',
    api: 'searchNodes',
    expectedSymbols: ['TransportService'],
    kinds: ['class'],
    mode: 'hybrid',
  },
  {
    id: 'hybrid-paraphrase-bulk',
    query: 'batching many document writes into a single indexing operation',
    api: 'searchNodes',
    expectedSymbols: ['BulkRequest'],
    kinds: ['class'],
    mode: 'hybrid',
  },
  {
    id: 'hybrid-paraphrase-allocation',
    query: 'deciding which node holds each shard and rebalancing the cluster',
    api: 'searchNodes',
    expectedSymbols: ['AllocationService'],
    kinds: ['class'],
    mode: 'hybrid',
  },
  {
    id: 'hybrid-paraphrase-rest-handler',
    query: 'abstract base for components that respond to incoming HTTP API endpoints',
    api: 'searchNodes',
    expectedSymbols: ['BaseRestHandler'],
    kinds: ['class'],
    mode: 'hybrid',
  },
];
