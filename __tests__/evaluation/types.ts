import type { NodeKind, SearchMode } from '../../src/types.js';

export interface EvalTestCase {
  id: string;
  query: string;
  api: 'searchNodes' | 'findRelevantContext';
  expectedSymbols: string[];
  kinds?: NodeKind[];
  options?: Record<string, unknown>;
  /**
   * SPEC-003 retrieval mode for `searchNodes` cases (FR-014). Absent — not
   * `undefined` conceptually — means today's keyword behavior, so every
   * existing case is unchanged; set `'hybrid'`/`'semantic'`/`'auto'` to
   * exercise the fused paraphrase path. When no live embedding provider is
   * available the library degrades gracefully to keyword, so these cases
   * still run (their recorded scores just reflect keyword behavior).
   */
  mode?: SearchMode;
}

export interface EvalResult {
  caseId: string;
  pass: boolean;
  recall: number;
  mrr: number;
  foundSymbols: string[];
  missedSymbols: string[];
  nodeCount?: number;
  edgeCount?: number;
  edgeDensity?: number;
  latencyMs: number;
}

export interface EvalReport {
  timestamp: string;
  codebasePath: string;
  codegraphSha: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    meanRecall: number;
    meanMRR: number;
  };
  results: EvalResult[];
}
