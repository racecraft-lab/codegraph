import {
  getNodeText,
  getChildByField,
  getPrecedingDocstring,
} from '../tree-sitter-helpers';
import type { LanguageExtractor } from '../tree-sitter-types';
import type { Node as SyntaxNode } from 'web-tree-sitter';

function syntheticLambdaName(node: SyntaxNode): string {
  return `<lambda@${node.startPosition.row + 1}:${node.startPosition.column}>`;
}

function isClassLikeScopeKind(kind: string | undefined): boolean {
  return (
    kind === 'class' ||
    kind === 'struct' ||
    kind === 'interface' ||
    kind === 'trait' ||
    kind === 'enum' ||
    kind === 'module'
  );
}

export const pythonExtractor: LanguageExtractor = {
  functionTypes: ['function_definition', 'lambda'],
  classTypes: ['class_definition'],
  methodTypes: ['function_definition'], // Methods are functions inside classes
  interfaceTypes: [],
  structTypes: [],
  enumTypes: [],
  typeAliasTypes: [],
  importTypes: ['import_statement', 'import_from_statement'],
  callTypes: ['call'],
  variableTypes: ['assignment'], // Python uses assignment for variable declarations
  nameField: 'name',
  resolveName: (node) => {
    if (node.type === 'lambda') return syntheticLambdaName(node);
    return undefined;
  },
  bodyField: 'body',
  paramsField: 'parameters',
  returnField: 'return_type',
  getSignature: (node, source) => {
    const params = getChildByField(node, 'parameters');
    const returnType = getChildByField(node, 'return_type');
    if (!params) return undefined;
    let sig = getNodeText(params, source);
    if (returnType) {
      sig += ' -> ' + getNodeText(returnType, source);
    }
    return sig;
  },
  isAsync: (node) => {
    const prev = node.previousSibling;
    return prev?.type === 'async';
  },
  isStatic: (node) => {
    // Check for @staticmethod decorator
    const prev = node.previousNamedSibling;
    if (prev?.type === 'decorator') {
      const text = prev.text;
      return text.includes('staticmethod');
    }
    return false;
  },
  extractImport: (node, source) => {
    const importText = source.substring(node.startIndex, node.endIndex).trim();
    if (node.type === 'import_from_statement') {
      const moduleNode = node.childForFieldName('module_name');
      if (moduleNode) {
        return { moduleName: source.substring(moduleNode.startIndex, moduleNode.endIndex), signature: importText };
      }
    }
    // import_statement creates multiple imports - return null for core fallback
    return null;
  },
  visitNode: (node, ctx) => {
    if (node.type !== 'assignment') return false;

    const right = getChildByField(node, 'right') || node.namedChild(1);
    if (right?.type !== 'lambda') return false;

    const currentScopeId = ctx.nodeStack[ctx.nodeStack.length - 1];
    const currentScope = currentScopeId
      ? ctx.nodes.find((candidate) => candidate.id === currentScopeId)
      : null;
    if (isClassLikeScopeKind(currentScope?.kind)) return false;

    const left = getChildByField(node, 'left') || node.namedChild(0);
    if (left?.type === 'identifier') {
      const initValue = getNodeText(right, ctx.source).slice(0, 100);
      ctx.createNode('variable', getNodeText(left, ctx.source), node, {
        docstring: getPrecedingDocstring(node, ctx.source),
        signature: `= ${initValue}${initValue.length >= 100 ? '...' : ''}`,
      });
    }

    ctx.visitNode(right);
    return true;
  },
};
