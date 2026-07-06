import { describe, expect, it } from 'vitest';
import { EDGE_PROVENANCES } from '../src/types';
import { canUseLspProvenanceForDecision, isKnownEdgeProvenance } from '../src/lsp';

describe('LSP precision provenance foundation', () => {
  it('adds lsp provenance without removing existing provenance values', () => {
    expect([...EDGE_PROVENANCES]).toEqual(['tree-sitter', 'scip', 'heuristic', 'lsp']);
    expect(isKnownEdgeProvenance('tree-sitter')).toBe(true);
    expect(isKnownEdgeProvenance('heuristic')).toBe(true);
    expect(isKnownEdgeProvenance('lsp')).toBe(true);
  });

  it('limits active lsp provenance to verified or corrected decisions', () => {
    expect(canUseLspProvenanceForDecision('verified')).toBe(true);
    expect(canUseLspProvenanceForDecision('corrected')).toBe(true);
    expect(canUseLspProvenanceForDecision('unchanged')).toBe(false);
    expect(canUseLspProvenanceForDecision('suppressed')).toBe(false);
    expect(canUseLspProvenanceForDecision('skipped')).toBe(false);
  });
});

