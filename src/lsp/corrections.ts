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
  const compatible = nodes.filter((node) => isCompatibleLspTargetNode(candidate, node));
  if (compatible.length <= 1) return compatible;

  const exactId = compatible.filter((node) => node.id === candidate.targetId);
  if (exactId.length > 0) return exactId;

  const exactKindAndName = compatible.filter((node) =>
    node.kind === candidate.targetKind && node.name === candidate.targetName);
  if (exactKindAndName.length > 0) return narrowestNodes(exactKindAndName);

  return narrowestNodes(compatible);
}

export function isCompatibleLspTargetNode(candidate: LspEdgeCandidateRow, node: Node): boolean {
  if (node.id === candidate.targetId) return true;
  if (node.kind === 'file' || node.kind === 'import' || node.kind === 'export' || node.kind === 'parameter') {
    return false;
  }
  if (node.kind === candidate.targetKind) return true;
  return COMPATIBLE_TARGET_KINDS[candidate.kind]?.has(node.kind) ?? false;
}

function narrowestNodes(nodes: Node[]): Node[] {
  const ranked = [...nodes].sort((left, right) => nodeSpan(left) - nodeSpan(right));
  const narrowestSpan = nodeSpan(ranked[0]!);
  return ranked.filter((node) => nodeSpan(node) === narrowestSpan);
}

function nodeSpan(node: Node): number {
  const lineSpan = Math.max(0, node.endLine - node.startLine);
  const columnSpan = Math.max(0, node.endColumn - node.startColumn);
  return (lineSpan * 100000) + columnSpan;
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
