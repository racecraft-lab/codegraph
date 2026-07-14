/**
 * SPEC-011 — Execution Flows & Clusters: analysis module entry point.
 *
 * New module tree sanctioned by Constitution Principle III. This barrel
 * re-exports the shared wire-shape types and the catalog-store primitives; the
 * index-time orchestrator (`runFlowAnalysis` / `runClusterAnalysis` /
 * `maybeRunCatalogAnalysis`) lands with the user-story phases (US1/US2/US4).
 */

export * from './types';
export * from './catalog-store';
