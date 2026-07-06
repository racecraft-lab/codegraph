import type { Node } from '../types';
import type { ResolutionContext, ResolvedRef, UnresolvedRef } from './types';
import type { OcamlWorkspace } from './ocaml-workspace';
import { isIgnoredOcamlPath, loadOcamlWorkspace, sourceUnitKey } from './ocaml-workspace';

const OCAML_BUILTIN_MODULES = new Set([
  'Stdlib',
  'List',
  'Array',
  'String',
  'Bytes',
  'Option',
  'Result',
  'Seq',
  'Map',
  'Set',
  'Hashtbl',
  'Buffer',
  'Printf',
  'Format',
  'Sys',
  'Unix',
]);

const MODULE_TARGET_KINDS = new Set<Node['kind']>([
  'module',
  'interface',
]);

const CALL_TARGET_KINDS = new Set<Node['kind']>([
  'function',
  'method',
  'constant',
]);

function firstSegment(name: string): string {
  return name.split('.')[0] ?? name;
}

function lastSegment(name: string): string {
  const parts = name.split('.');
  return parts[parts.length - 1] ?? name;
}

function isUpperModuleSegment(segment: string): boolean {
  return /^[A-Z]/.test(segment);
}

export function isOcamlUniqueOnlyReference(ref: UnresolvedRef): boolean {
  if (ref.language !== 'ocaml') return false;
  const first = firstSegment(ref.referenceName);
  if (ref.referenceKind === 'calls') return true;
  if (ref.referenceKind === 'imports') return true;
  if (ref.referenceKind === 'references' && isUpperModuleSegment(first)) return true;
  return ref.referenceName.includes('.') && isUpperModuleSegment(first);
}

function sameLanguageCandidate(node: Node): boolean {
  return node.language === 'ocaml' && node.kind !== 'import' && !isIgnoredOcamlPath(node.filePath);
}

function visibleQualifiedNames(ref: UnresolvedRef, context: ResolutionContext): Set<string> {
  const translated = ref.referenceName.replace(/\./g, '::');
  const names = new Set<string>([translated]);
  const fromNode = context.getNodeById?.(ref.fromNodeId);
  if (!fromNode) return names;

  const segments = fromNode.qualifiedName.split('::').filter(Boolean);
  for (let i = segments.length; i > 0; i--) {
    names.add(`${segments.slice(0, i).join('::')}::${translated}`);
  }
  return names;
}

function candidateNodes(ref: UnresolvedRef, context: ResolutionContext): Node[] {
  const name = ref.referenceName;
  if (!isOcamlUniqueOnlyReference(ref)) return [];
  const visibleNames = visibleQualifiedNames(ref, context);
  const fromNode = context.getNodeById?.(ref.fromNodeId);

  if (ref.referenceKind === 'calls') {
    const leaf = lastSegment(name);
    return context
      .getNodesByName(leaf)
      .filter((node) => {
        if (!sameLanguageCandidate(node) || !CALL_TARGET_KINDS.has(node.kind)) return false;
        if (!visibleNames.has(node.qualifiedName)) return false;
        return name.includes('.') || node.filePath === fromNode?.filePath;
      });
  }

  if (!name.includes('.')) {
    return context
      .getNodesByName(name)
      .filter((node) =>
        sameLanguageCandidate(node) &&
        MODULE_TARGET_KINDS.has(node.kind) &&
        visibleNames.has(node.qualifiedName)
      );
  }

  const leaf = lastSegment(name);
  return context
    .getNodesByName(leaf)
    .filter((node) => {
      if (!sameLanguageCandidate(node)) return false;
      return visibleNames.has(node.qualifiedName);
    });
}

function collapseInterfacePairs(
  candidates: Node[],
  ref: UnresolvedRef,
  workspace: OcamlWorkspace,
): Node[] {
  const byUnit = new Map<string, Node[]>();
  const unpaired: Node[] = [];

  for (const candidate of candidates) {
    const key = sourceUnitKey(candidate.filePath);
    if (!key) {
      unpaired.push(candidate);
      continue;
    }
    const group = byUnit.get(key);
    if (group) group.push(candidate);
    else byUnit.set(key, [candidate]);
  }

  const collapsed = [...unpaired];
  for (const group of byUnit.values()) {
    const implementation = group.filter((node) => node.filePath.endsWith('.ml'));
    const intf = group.filter((node) => node.filePath.endsWith('.mli'));
    const key = sourceUnitKey(group[0]!.filePath);

    if (implementation.length > 0 && intf.length === 0 && key && workspace.interfaceUnitKeys.has(key)) {
      continue;
    }

    if (implementation.length > 1 || intf.length > 1) {
      collapsed.push(...group);
      continue;
    }

    if (ref.referenceKind === 'calls') {
      collapsed.push(implementation[0] ?? intf[0]!);
    } else {
      collapsed.push(intf[0] ?? implementation[0]!);
    }
  }

  return collapsed;
}

export function resolveOcamlReference(
  ref: UnresolvedRef,
  context: ResolutionContext,
): ResolvedRef | null {
  if (ref.language !== 'ocaml') return null;

  const workspace = loadOcamlWorkspace(context);
  const root = firstSegment(ref.referenceName);
  const candidates = collapseInterfacePairs(candidateNodes(ref, context), ref, workspace);

  if (candidates.length === 0) {
    if (OCAML_BUILTIN_MODULES.has(root) || workspace.localPackageNames.has(root.toLowerCase())) {
      return null;
    }
    return null;
  }

  if (candidates.length !== 1) return null;

  return {
    original: ref,
    targetNodeId: candidates[0]!.id,
    confidence: ref.referenceName.includes('.') ? 0.95 : 0.9,
    resolvedBy: ref.referenceName.includes('.') ? 'qualified-name' : 'import',
  };
}
