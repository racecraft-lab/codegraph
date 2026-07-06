import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getNodeText, getPrecedingDocstring } from '../tree-sitter-helpers';
import type { ExtractorContext, LanguageExtractor } from '../tree-sitter-types';
import type { Node, NodeKind } from '../../types';

function text(node: SyntaxNode, source: string): string {
  return getNodeText(node, source).trim();
}

function firstChildOfType(node: SyntaxNode, type: string): SyntaxNode | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === type) return child;
  }
  return null;
}

function directChildrenOfType(node: SyntaxNode, type: string): SyntaxNode[] {
  return node.namedChildren.filter((child) => child.type === type);
}

function descendantsOfType(node: SyntaxNode, type: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const stack = [node];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.type === type) out.push(cur);
    for (let i = cur.namedChildCount - 1; i >= 0; i--) {
      const child = cur.namedChild(i);
      if (child) stack.push(child);
    }
  }
  return out;
}

function firstDescendantOfType(node: SyntaxNode, type: string): SyntaxNode | null {
  const stack = [node];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.type === type) return cur;
    for (let i = cur.namedChildCount - 1; i >= 0; i--) {
      const child = cur.namedChild(i);
      if (child) stack.push(child);
    }
  }
  return null;
}

function descendantsOfTypes(node: SyntaxNode, types: Set<string>): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const stack = [node];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (types.has(cur.type)) out.push(cur);
    for (let i = cur.namedChildCount - 1; i >= 0; i--) {
      const child = cur.namedChild(i);
      if (child) stack.push(child);
    }
  }
  return out;
}

function directName(node: SyntaxNode, nameType: string, source: string): string | null {
  const nameNode = firstChildOfType(node, nameType);
  return nameNode ? text(nameNode, source) : null;
}

function bindingName(node: SyntaxNode, source: string): string | null {
  return (
    directName(node, 'module_name', source) ||
    directName(node, 'module_type_name', source) ||
    directName(node, 'class_name', source) ||
    directName(node, 'value_name', source) ||
    directName(node, 'method_name', source) ||
    directName(node, 'instance_variable_name', source) ||
    directName(node, 'type_constructor', source) ||
    directName(node, 'field_name', source) ||
    directName(node, 'class_type_name', source) ||
    directName(node, 'constructor_name', source)
  );
}

function hasDirectChild(node: SyntaxNode, type: string): boolean {
  return firstChildOfType(node, type) !== null;
}

function topLevelDeclaredType(node: SyntaxNode): SyntaxNode | null {
  for (const child of node.namedChildren) {
    if (child.type === 'value_name') continue;
    return child;
  }
  return null;
}

function createNode(
  ctx: ExtractorContext,
  kind: NodeKind,
  name: string | null,
  node: SyntaxNode,
  extra?: Partial<Node>,
): Node | null {
  if (!name || name === '<anonymous>') return null;
  return ctx.createNode(kind, name, node, {
    docstring: getPrecedingDocstring(node, ctx.source),
    signature: text(node, ctx.source).slice(0, 300),
    ...extra,
  });
}

function isInterfaceFile(ctx: ExtractorContext): boolean {
  return ctx.filePath.endsWith('.mli');
}

function createParameters(parent: SyntaxNode, ctx: ExtractorContext): void {
  for (let i = 0; i < parent.namedChildCount; i++) {
    const child = parent.namedChild(i);
    if (!child || child.type !== 'parameter') continue;
    const nameNode =
      firstDescendantOfType(child, 'value_pattern') ||
      firstDescendantOfType(child, 'label_name') ||
      firstDescendantOfType(child, 'value_name');
    if (nameNode) {
      ctx.createNode('parameter', text(nameNode, ctx.source), nameNode);
    }
  }
}

function createFunctionTypeParameters(typeNode: SyntaxNode, ctx: ExtractorContext): void {
  for (const arg of descendantsOfType(typeNode, 'labeled_argument_type')) {
    const label = firstChildOfType(arg, 'label_name');
    if (label) ctx.createNode('parameter', text(label, ctx.source), label);
  }
}

function visitNonNameChildren(node: SyntaxNode, ctx: ExtractorContext): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    if (
      child.type === 'module_name' ||
      child.type === 'module_type_name' ||
      child.type === 'class_name' ||
      child.type === 'value_name' ||
      child.type === 'method_name' ||
      child.type === 'instance_variable_name' ||
      child.type === 'type_constructor' ||
      child.type === 'constructor_name' ||
      child.type === 'field_name' ||
      child.type === 'parameter'
    ) {
      continue;
    }
    ctx.visitNode(child);
  }
}

function fileModuleName(filePath: string): string | null {
  const base = filePath.split('/').pop()?.replace(/\.mli?$/i, '');
  if (!base || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(base)) return null;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function addModuleReference(node: SyntaxNode, ctx: ExtractorContext, kind: 'imports' | 'references'): void {
  addModuleReferences(node, ctx, kind, true);
}

function addModuleReferences(
  node: SyntaxNode,
  ctx: ExtractorContext,
  kind: 'imports' | 'references',
  firstOnly = false,
): void {
  const fromNodeId = ctx.nodeStack[ctx.nodeStack.length - 1];
  if (!fromNodeId) return;
  const paths = descendantsOfTypes(node, new Set(['module_path', 'module_type_path', 'extended_module_path']));
  const seen = new Set<string>();
  for (const modulePath of paths) {
    const name = text(modulePath, ctx.source);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    ctx.addUnresolvedReference({
      fromNodeId,
      referenceName: name,
      referenceKind: kind,
      line: modulePath.startPosition.row + 1,
      column: modulePath.startPosition.column,
    });
    if (firstOnly) return;
  }
}

function handleCompilationUnit(node: SyntaxNode, ctx: ExtractorContext): boolean {
  const moduleName = fileModuleName(ctx.filePath);
  if (!moduleName) return false;
  const created = ctx.createNode('module', moduleName, node, {
    isExported: true,
    signature: `module ${moduleName}`,
  });
  if (!created) return false;

  ctx.pushScope(created.id);
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) ctx.visitNode(child);
  }
  ctx.popScope();
  return true;
}

function handleModuleDefinition(node: SyntaxNode, ctx: ExtractorContext): boolean {
  const binding = firstChildOfType(node, 'module_binding') ?? node;
  const created = createNode(ctx, 'module', bindingName(binding, ctx.source), node, {
    isExported: isInterfaceFile(ctx),
  });
  if (!created) return true;

  ctx.pushScope(created.id);
  for (const param of directChildrenOfType(binding, 'module_parameter')) {
    const name = directName(param, 'module_name', ctx.source);
    if (name) ctx.createNode('parameter', name, param);
    addModuleReference(param, ctx, 'references');
  }
  visitNonNameChildren(binding, ctx);
  ctx.popScope();
  return true;
}

function handleModuleTypeDefinition(node: SyntaxNode, ctx: ExtractorContext): boolean {
  const created = createNode(ctx, 'interface', bindingName(node, ctx.source), node, {
    isExported: isInterfaceFile(ctx),
  });
  if (!created) return true;
  ctx.pushScope(created.id);
  visitNonNameChildren(node, ctx);
  ctx.popScope();
  return true;
}

function handleClassDefinition(node: SyntaxNode, ctx: ExtractorContext): boolean {
  const binding = firstChildOfType(node, 'class_binding') ?? node;
  const created = createNode(ctx, 'class', bindingName(binding, ctx.source), node, {
    isExported: isInterfaceFile(ctx),
  });
  if (!created) return true;
  ctx.pushScope(created.id);
  visitNonNameChildren(binding, ctx);
  ctx.popScope();
  return true;
}

function handleClassTypeDefinition(node: SyntaxNode, ctx: ExtractorContext): boolean {
  const binding = firstChildOfType(node, 'class_type_binding') ?? node;
  const created = createNode(ctx, 'interface', bindingName(binding, ctx.source), node, {
    isExported: isInterfaceFile(ctx),
  });
  if (!created) return true;
  ctx.pushScope(created.id);
  visitNonNameChildren(binding, ctx);
  ctx.popScope();
  return true;
}

function handleValueDefinition(node: SyntaxNode, ctx: ExtractorContext): boolean {
  const bindings = node.namedChildren.filter((child) => child.type === 'let_binding');
  for (const binding of bindings.length > 0 ? bindings : [node]) {
    const name = bindingName(binding, ctx.source);
    if (!name) {
      visitNonNameChildren(binding, ctx);
      continue;
    }
    const isFunction =
      hasDirectChild(binding, 'parameter') ||
      firstChildOfType(binding, 'function') !== null ||
      firstChildOfType(binding, 'fun_expression') !== null;
    const created = createNode(ctx, isFunction ? 'function' : 'constant', name, binding);
    if (!created) continue;
    ctx.pushScope(created.id);
    createParameters(binding, ctx);
    visitNonNameChildren(binding, ctx);
    ctx.popScope();
  }
  return true;
}

function handleExternal(node: SyntaxNode, ctx: ExtractorContext): boolean {
  const name = bindingName(node, ctx.source);
  if (!name) return true;
  createNode(ctx, 'function', name, node, {
    isExported: true,
  });
  return true;
}

function handleValueSpecification(node: SyntaxNode, ctx: ExtractorContext): boolean {
  const name = bindingName(node, ctx.source);
  if (!name) return true;
  const typeNode = topLevelDeclaredType(node);
  const isFunction = typeNode?.type === 'function_type';
  const created = createNode(ctx, isFunction ? 'function' : 'constant', name, node, {
    isExported: true,
  });
  if (created) {
    ctx.pushScope(created.id);
    if (isFunction && typeNode) createFunctionTypeParameters(typeNode, ctx);
    ctx.popScope();
  }
  return true;
}

function handleTypeDefinition(node: SyntaxNode, ctx: ExtractorContext): boolean {
  const bindings = node.namedChildren.filter((child) => child.type === 'type_binding');
  for (const binding of bindings.length > 0 ? bindings : [node]) {
    const name = bindingName(binding, ctx.source);
    if (!name) continue;
    const record = firstChildOfType(binding, 'record_declaration');
    const variant = firstChildOfType(binding, 'variant_declaration');
    const polymorphicVariant = firstChildOfType(binding, 'polymorphic_variant_type');
    const exported = isInterfaceFile(ctx);
    if (record) {
      const created = createNode(ctx, 'struct', name, binding, { isExported: exported });
      if (!created) continue;
      ctx.pushScope(created.id);
      for (const field of descendantsOfType(record, 'field_declaration')) {
        createNode(ctx, 'field', bindingName(field, ctx.source), field, { isExported: exported });
      }
      ctx.popScope();
    } else if (variant) {
      const created = createNode(ctx, 'enum', name, binding, { isExported: exported });
      if (!created) continue;
      ctx.pushScope(created.id);
      for (const ctor of descendantsOfType(variant, 'constructor_declaration')) {
        createNode(ctx, 'enum_member', bindingName(ctor, ctx.source), ctor, { isExported: exported });
      }
      ctx.popScope();
    } else if (polymorphicVariant) {
      const created = createNode(ctx, 'enum', name, binding, { isExported: exported });
      if (!created) continue;
      ctx.pushScope(created.id);
      for (const tag of descendantsOfType(polymorphicVariant, 'tag')) {
        createNode(ctx, 'enum_member', text(tag, ctx.source), tag, { isExported: exported });
      }
      ctx.popScope();
    } else {
      createNode(ctx, 'type_alias', name, binding, { isExported: exported });
    }
  }
  return true;
}

function handleMethod(node: SyntaxNode, ctx: ExtractorContext): boolean {
  const created = createNode(ctx, 'method', bindingName(node, ctx.source), node, {
    isExported: isInterfaceFile(ctx),
  });
  if (!created) return true;
  ctx.pushScope(created.id);
  createParameters(node, ctx);
  visitNonNameChildren(node, ctx);
  ctx.popScope();
  return true;
}

function handleField(node: SyntaxNode, ctx: ExtractorContext): boolean {
  createNode(ctx, 'field', bindingName(node, ctx.source), node, {
    isExported: isInterfaceFile(ctx),
  });
  return true;
}

export const ocamlExtractor: LanguageExtractor = {
  functionTypes: [],
  classTypes: [],
  methodTypes: [],
  interfaceTypes: [],
  structTypes: [],
  enumTypes: [],
  typeAliasTypes: [],
  importTypes: [],
  callTypes: ['application_expression'],
  variableTypes: [],

  nameField: 'name',
  bodyField: 'body',
  paramsField: 'parameters',

  visitNode: (node, ctx) => {
    switch (node.type) {
      case 'compilation_unit':
        return handleCompilationUnit(node, ctx);
      case 'module_definition':
        return handleModuleDefinition(node, ctx);
      case 'module_type_definition':
        return handleModuleTypeDefinition(node, ctx);
      case 'class_definition':
        return handleClassDefinition(node, ctx);
      case 'class_type_definition':
        return handleClassTypeDefinition(node, ctx);
      case 'type_definition':
        return handleTypeDefinition(node, ctx);
      case 'value_definition':
        return handleValueDefinition(node, ctx);
      case 'external':
        return handleExternal(node, ctx);
      case 'value_specification':
        return handleValueSpecification(node, ctx);
      case 'item_extension':
      case 'extension':
      case 'floating_attribute':
      case 'item_attribute':
      case 'attribute':
      case 'attribute_payload':
        return true;
      case 'method_definition':
      case 'method_specification':
        return handleMethod(node, ctx);
      case 'instance_variable_definition':
        return handleField(node, ctx);
      case 'open_module':
        addModuleReference(node, ctx, 'imports');
        return true;
      case 'include_module':
      case 'include_module_type':
        addModuleReference(node, ctx, 'references');
        return true;
      case 'module_application':
        addModuleReferences(node, ctx, 'references');
        visitNonNameChildren(node, ctx);
        return true;
      case 'local_open_expression':
        addModuleReference(node, ctx, 'imports');
        visitNonNameChildren(node, ctx);
        return true;
      case 'package_expression':
        addModuleReferences(node, ctx, 'references');
        return true;
      default:
        return false;
    }
  },
};
