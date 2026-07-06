import { LspEdgeCandidateRow } from '../db/queries';
import { EdgeKind, Node, NodeKind } from '../types';

export type LspCorrectionDecision = 'verified' | 'corrected' | 'suppressed' | 'skipped';

export type LspSuppressionReason =
  | 'external-target'
  | 'generated-target'
  | 'unindexed-target'
  | 'replacement-edge';

export interface LspTargetAudit {
  uri: string;
  filePath: string | null;
  line: number;
  character: number;
}

const COMPATIBLE_TARGET_KINDS: Partial<Record<EdgeKind, ReadonlySet<NodeKind>>> = {
  calls: new Set(['function', 'method', 'class', 'route', 'component']),
  references: new Set([
    'module',
    'class',
    'struct',
    'interface',
    'trait',
    'protocol',
    'function',
    'method',
    'property',
    'field',
    'variable',
    'constant',
    'enum',
    'enum_member',
    'type_alias',
    'namespace',
    'route',
    'component',
  ]),
  imports: new Set([
    'module',
    'class',
    'struct',
    'interface',
    'trait',
    'protocol',
    'function',
    'method',
    'variable',
    'constant',
    'enum',
    'type_alias',
    'namespace',
    'component',
  ]),
  instantiates: new Set(['class', 'struct', 'component']),
};

export function compatibleLspTargetNodes(
  candidate: LspEdgeCandidateRow,
  nodes: Node[],
): Node[] {
  return nodes.filter((node) => isCompatibleLspTargetNode(candidate, node));
}

export function isCompatibleLspTargetNode(candidate: LspEdgeCandidateRow, node: Node): boolean {
  if (node.id === candidate.targetId) return true;
  if (node.kind === 'file' || node.kind === 'import' || node.kind === 'export' || node.kind === 'parameter') {
    return false;
  }
  if (node.kind === candidate.targetKind) return true;
  return COMPATIBLE_TARGET_KINDS[candidate.kind]?.has(node.kind) ?? false;
}

export function lspDecisionMetadata(
  candidate: LspEdgeCandidateRow,
  decision: LspCorrectionDecision,
  target: LspTargetAudit | null,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = new Date().toISOString();
  const timestampKey =
    decision === 'verified'
      ? 'verifiedAt'
      : decision === 'corrected'
        ? 'correctedAt'
        : decision === 'suppressed'
          ? 'suppressedAt'
          : 'skippedAt';

  return {
    ...(candidate.metadata ?? {}),
    lsp: {
      decision,
      active: decision !== 'suppressed',
      previousProvenance: candidate.provenance ?? null,
      previousTargetId: candidate.targetId,
      previousTargetFilePath: candidate.targetFilePath,
      targetUri: target?.uri ?? null,
      targetFilePath: target?.filePath ?? null,
      targetLine: target?.line ?? null,
      targetCharacter: target?.character ?? null,
      [timestampKey]: now,
      ...extras,
    },
  };
}

export function lspReplacementSuppressionMetadata(
  candidate: LspEdgeCandidateRow,
  target: LspTargetAudit,
  replacementTargetId: string,
): Record<string, unknown> {
  return lspDecisionMetadata(candidate, 'suppressed', target, {
    reason: 'replacement-edge' satisfies LspSuppressionReason,
    replacementTargetId,
  });
}
