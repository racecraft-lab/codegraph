/**
 * Swift Framework Resolver
 *
 * Handles SwiftUI, UIKit, and Vapor (server-side Swift) patterns.
 */

import { Node } from '../../types';
import { FrameworkResolver, UnresolvedRef, ResolvedRef, ResolutionContext } from '../types';
import { stripCommentsForRegex } from '../strip-comments';

export const swiftUIResolver: FrameworkResolver = {
  name: 'swiftui',
  languages: ['swift'],

  detect(context: ResolutionContext): boolean {
    // Check for SwiftUI imports in Swift files
    const allFiles = context.getAllFiles();
    for (const file of allFiles) {
      if (file.endsWith('.swift')) {
        const content = context.readFile(file);
        if (content && content.includes('import SwiftUI')) {
          return true;
        }
      }
    }

    // Check for Xcode project with SwiftUI
    for (const file of allFiles) {
      if (file.endsWith('.xcodeproj') || file.endsWith('.xcworkspace')) {
        return true;
      }
    }

    return false;
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Pattern 1: View references (SwiftUI views are PascalCase ending in View)
    if (ref.referenceName.endsWith('View') && /^[A-Z]/.test(ref.referenceName)) {
      const result = resolveByNameAndKind(ref.referenceName, VIEW_KINDS, VIEW_DIRS, context);
      if (result) {
        return {
          original: ref,
          targetNodeId: result,
          confidence: 0.85,
          resolvedBy: 'framework',
        };
      }
    }

    // Pattern 2: ViewModel/ObservableObject references
    if (ref.referenceName.endsWith('ViewModel') || ref.referenceName.endsWith('Store') || ref.referenceName.endsWith('Manager')) {
      const result = resolveByNameAndKind(ref.referenceName, CLASS_KINDS, VIEWMODEL_DIRS, context);
      if (result) {
        return {
          original: ref,
          targetNodeId: result,
          confidence: 0.85,
          resolvedBy: 'framework',
        };
      }
    }

    // Pattern 3: Model references
    if (/^[A-Z][a-zA-Z]+$/.test(ref.referenceName)) {
      const result = resolveByNameAndKind(ref.referenceName, MODEL_KINDS, MODEL_DIRS, context);
      if (result) {
        return {
          original: ref,
          targetNodeId: result,
          confidence: 0.7,
          resolvedBy: 'framework',
        };
      }
    }

    return null;
  },

  extract(filePath, content) {
    if (!filePath.endsWith('.swift')) return { nodes: [], references: [] };
    const nodes: Node[] = [];
    const now = Date.now();
    const safe = stripCommentsForRegex(content, 'swift');

    // Extract SwiftUI View structs
    // struct ContentView: View { ... }
    const viewPattern = /struct\s+(\w+)\s*:\s*(?:\w+\s*,\s*)*View/g;

    let match: RegExpExecArray | null;
    while ((match = viewPattern.exec(safe)) !== null) {
      const [, viewName] = match;
      const line = safe.slice(0, match.index).split('\n').length;

      nodes.push({
        id: `view:${filePath}:${viewName}:${line}`,
        kind: 'component',
        name: viewName!,
        qualifiedName: `${filePath}::${viewName}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'swift',
        updatedAt: now,
      });
    }

    // Extract @main App entry point
    const appPattern = /@main\s+struct\s+(\w+)\s*:\s*App/g;

    while ((match = appPattern.exec(safe)) !== null) {
      const [, appName] = match;
      const line = safe.slice(0, match.index).split('\n').length;

      nodes.push({
        id: `app:${filePath}:${appName}:${line}`,
        kind: 'class',
        name: appName!,
        qualifiedName: `${filePath}::${appName}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'swift',
        updatedAt: now,
      });
    }

    return { nodes, references: [] };
  },
};

export const uikitResolver: FrameworkResolver = {
  name: 'uikit',
  languages: ['swift'],

  detect(context: ResolutionContext): boolean {
    const allFiles = context.getAllFiles();
    for (const file of allFiles) {
      if (file.endsWith('.swift')) {
        const content = context.readFile(file);
        if (content && (
          content.includes('import UIKit') ||
          content.includes('UIViewController') ||
          content.includes('UIView')
        )) {
          return true;
        }
      }
    }

    return false;
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Pattern 1: ViewController references
    if (ref.referenceName.endsWith('ViewController')) {
      const result = resolveByNameAndKind(ref.referenceName, CLASS_KINDS, VC_DIRS, context);
      if (result) {
        return {
          original: ref,
          targetNodeId: result,
          confidence: 0.85,
          resolvedBy: 'framework',
        };
      }
    }

    // Pattern 2: UIView subclass references
    if (ref.referenceName.endsWith('View') && !ref.referenceName.endsWith('ViewController')) {
      const result = resolveByNameAndKind(ref.referenceName, CLASS_KINDS, UIVIEW_DIRS, context);
      if (result) {
        return {
          original: ref,
          targetNodeId: result,
          confidence: 0.8,
          resolvedBy: 'framework',
        };
      }
    }

    // Pattern 3: Cell references
    if (ref.referenceName.endsWith('Cell')) {
      const result = resolveByNameAndKind(ref.referenceName, CLASS_KINDS, CELL_DIRS, context);
      if (result) {
        return {
          original: ref,
          targetNodeId: result,
          confidence: 0.85,
          resolvedBy: 'framework',
        };
      }
    }

    // Pattern 4: Delegate/DataSource references
    if (ref.referenceName.endsWith('Delegate') || ref.referenceName.endsWith('DataSource')) {
      const result = resolveByNameAndKind(ref.referenceName, PROTOCOL_KINDS, [], context);
      if (result) {
        return {
          original: ref,
          targetNodeId: result,
          confidence: 0.8,
          resolvedBy: 'framework',
        };
      }
    }

    return null;
  },

  extract(filePath, content) {
    if (!filePath.endsWith('.swift')) return { nodes: [], references: [] };
    const nodes: Node[] = [];
    const now = Date.now();
    const safe = stripCommentsForRegex(content, 'swift');

    // Extract UIViewController subclasses
    const vcPattern = /class\s+(\w+)\s*:\s*(?:\w+\s*,\s*)*UIViewController/g;

    let match: RegExpExecArray | null;
    while ((match = vcPattern.exec(safe)) !== null) {
      const [, vcName] = match;
      const line = safe.slice(0, match.index).split('\n').length;

      nodes.push({
        id: `viewcontroller:${filePath}:${vcName}:${line}`,
        kind: 'class',
        name: vcName!,
        qualifiedName: `${filePath}::${vcName}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'swift',
        updatedAt: now,
      });
    }

    // Extract UIView subclasses
    const viewPattern = /class\s+(\w+)\s*:\s*(?:\w+\s*,\s*)*UIView[^C]/g;

    while ((match = viewPattern.exec(safe)) !== null) {
      const [, viewName] = match;
      const line = safe.slice(0, match.index).split('\n').length;

      nodes.push({
        id: `uiview:${filePath}:${viewName}:${line}`,
        kind: 'class',
        name: viewName!,
        qualifiedName: `${filePath}::${viewName}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'swift',
        updatedAt: now,
      });
    }

    return { nodes, references: [] };
  },
};

export const vaporResolver: FrameworkResolver = {
  name: 'vapor',
  languages: ['swift'],

  detect(context: ResolutionContext): boolean {
    // Check for Package.swift with Vapor dependency
    const packageSwift = context.readFile('Package.swift');
    if (packageSwift && packageSwift.includes('vapor')) {
      return true;
    }

    // Check for Vapor imports
    const allFiles = context.getAllFiles();
    for (const file of allFiles) {
      if (file.endsWith('.swift')) {
        const content = context.readFile(file);
        if (content && content.includes('import Vapor')) {
          return true;
        }
      }
    }

    return false;
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Pattern 1: Controller references
    if (ref.referenceName.endsWith('Controller')) {
      const result = resolveByNameAndKind(ref.referenceName, VAPOR_CONTROLLER_KINDS, VAPOR_CONTROLLER_DIRS, context);
      if (result) {
        return {
          original: ref,
          targetNodeId: result,
          confidence: 0.85,
          resolvedBy: 'framework',
        };
      }
    }

    // Pattern 2: Model references (Fluent)
    if (/^[A-Z][a-zA-Z]+$/.test(ref.referenceName)) {
      const result = resolveByNameAndKind(ref.referenceName, CLASS_KINDS, FLUENT_MODEL_DIRS, context);
      if (result) {
        return {
          original: ref,
          targetNodeId: result,
          confidence: 0.75,
          resolvedBy: 'framework',
        };
      }
    }

    // Pattern 3: Middleware references
    if (ref.referenceName.endsWith('Middleware')) {
      const result = resolveByNameAndKind(ref.referenceName, VAPOR_CONTROLLER_KINDS, VAPOR_MIDDLEWARE_DIRS, context);
      if (result) {
        return {
          original: ref,
          targetNodeId: result,
          confidence: 0.8,
          resolvedBy: 'framework',
        };
      }
    }

    return null;
  },

  extract(filePath, content) {
    if (!filePath.endsWith('.swift')) return { nodes: [], references: [] };
    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const now = Date.now();
    const safe = stripCommentsForRegex(content, 'swift');

    // Build a group-var → path-prefix map first. Modern Vapor routes live on a
    // grouped builder (`let todos = routes.grouped("todos"); todos.get(use: index)`
    // or `routes.group("todos") { todos in todos.get(use: index) }`), so the path
    // comes from the group, not the call. Roots (app/routes/router) have no prefix.
    const groupPrefix = new Map<string, string>();
    const segJoin = (existing: string, segsStr: string): string => {
      const segs = (segsStr.match(/"([^"]*)"/g) || []).map((s) => s.slice(1, -1));
      return existing + segs.map((s) => '/' + s).join('');
    };
    let gm: RegExpExecArray | null;
    // let X = Y.grouped("a", "b")
    const groupedRegex = /\blet\s+(\w+)\s*=\s*(\w+)\.grouped\s*\(([^)]*)\)/g;
    while ((gm = groupedRegex.exec(safe)) !== null) {
      groupPrefix.set(gm[1]!, segJoin(groupPrefix.get(gm[2]!) ?? '', gm[3]!));
    }
    // Y.group("a") { X in ... }
    const groupClosureRegex = /\b(\w+)\.group\s*\(([^)]*)\)\s*\{\s*(\w+)\s+in/g;
    while ((gm = groupClosureRegex.exec(safe)) !== null) {
      groupPrefix.set(gm[3]!, segJoin(groupPrefix.get(gm[1]!) ?? '', gm[2]!));
    }

    for (const route of findVaporRouteCalls(safe)) {
      const line = safe.slice(0, route.index).split('\n').length;
      const upper = route.method.toUpperCase();
      const routePath = (groupPrefix.get(route.receiver) ?? '') + segJoin('', route.pathArgs) || '/';

      const routeNode: Node = {
        id: `route:${filePath}:${line}:${upper}:${routePath}`,
        kind: 'route',
        name: `${upper} ${routePath}`,
        qualifiedName: `${filePath}::route:${routePath}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: route.length,
        language: 'swift',
        updatedAt: now,
      };
      nodes.push(routeNode);

      // Last segment of a dotted handler (self.list / UserController.list -> list)
      const handlerName = route.handlerExpr.split('.').pop();
      if (handlerName) {
        references.push({
          fromNodeId: routeNode.id,
          referenceName: handlerName,
          referenceKind: 'references',
          line,
          column: 0,
          filePath,
          language: 'swift',
        });
      }
    }

    return { nodes, references };
  },
};

// Directory patterns
const VIEW_DIRS = ['/Views/', '/View/', '/Screens/', '/Components/', '/UI/'];
const VIEWMODEL_DIRS = ['/ViewModels/', '/ViewModel/', '/Stores/', '/Managers/', '/Services/'];
const MODEL_DIRS = ['/Models/', '/Model/', '/Entities/', '/Domain/'];
const VC_DIRS = ['/ViewControllers/', '/ViewController/', '/Controllers/', '/Screens/'];
const UIVIEW_DIRS = ['/Views/', '/View/', '/UI/', '/Components/'];
const CELL_DIRS = ['/Cells/', '/Cell/', '/Views/', '/TableViewCells/', '/CollectionViewCells/'];
const VAPOR_CONTROLLER_DIRS = ['/Controllers/', '/Controller/', '/Routes/'];
const FLUENT_MODEL_DIRS = ['/Models/', '/Model/', '/Entities/', '/Database/'];
const VAPOR_MIDDLEWARE_DIRS = ['/Middleware/', '/Middlewares/'];

const VIEW_KINDS = new Set(['struct', 'component']);
const CLASS_KINDS = new Set(['class']);
const MODEL_KINDS = new Set(['struct', 'class']);
const PROTOCOL_KINDS = new Set(['protocol']);
const VAPOR_CONTROLLER_KINDS = new Set(['class', 'struct']);
const VAPOR_ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

interface VaporRouteCall {
  index: number;
  length: number;
  receiver: string;
  method: string;
  pathArgs: string;
  handlerExpr: string;
}

function findVaporRouteCalls(source: string): VaporRouteCall[] {
  const routes: VaporRouteCall[] = [];
  let search = 0;

  while (search < source.length) {
    const dot = source.indexOf('.', search);
    if (dot === -1) break;

    let receiverStart = dot - 1;
    while (receiverStart >= 0 && isSwiftIdentifierChar(source[receiverStart]!)) receiverStart--;
    receiverStart++;
    if (receiverStart === dot || (receiverStart > 0 && isSwiftIdentifierChar(source[receiverStart - 1]!))) {
      search = dot + 1;
      continue;
    }

    let methodEnd = dot + 1;
    while (methodEnd < source.length && isSwiftIdentifierChar(source[methodEnd]!)) methodEnd++;
    const method = source.slice(dot + 1, methodEnd);
    if (!VAPOR_ROUTE_METHODS.has(method)) {
      search = methodEnd;
      continue;
    }

    const open = skipSwiftWhitespace(source, methodEnd);
    if (source[open] !== '(') {
      search = methodEnd;
      continue;
    }

    const close = findMatchingParen(source, open);
    if (close === -1) {
      search = open + 1;
      continue;
    }

    const args = source.slice(open + 1, close);
    const useIndex = findTopLevelUseLabel(args);
    if (useIndex === -1) {
      search = close + 1;
      continue;
    }

    const handlerExpr = readSwiftExpressionName(args, useIndex + 'use:'.length);
    if (!handlerExpr) {
      search = close + 1;
      continue;
    }

    routes.push({
      index: receiverStart,
      length: close - receiverStart + 1,
      receiver: source.slice(receiverStart, dot),
      method,
      pathArgs: args.slice(0, useIndex),
      handlerExpr,
    });
    search = close + 1;
  }

  return routes;
}

function isSwiftIdentifierChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function skipSwiftWhitespace(source: string, from: number): number {
  let pos = from;
  while (pos < source.length && /\s/.test(source[pos]!)) pos++;
  return pos;
}

function findMatchingParen(source: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let i = open; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function findTopLevelUseLabel(args: string): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let i = 0; i < args.length; i++) {
    const ch = args[i]!;
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && args.startsWith('use:', i)) {
      const prev = i > 0 ? args[i - 1] : undefined;
      if (!prev || !isSwiftIdentifierChar(prev)) return i;
    }
  }

  return -1;
}

function readSwiftExpressionName(source: string, from: number): string | null {
  let pos = skipSwiftWhitespace(source, from);
  if (!/[A-Za-z_]/.test(source[pos] ?? '')) return null;

  const start = pos;
  pos++;
  while (pos < source.length && /[A-Za-z0-9_.]/.test(source[pos]!)) pos++;
  return source.slice(start, pos);
}

/**
 * Resolve a symbol by name using indexed queries instead of scanning all files.
 */
function resolveByNameAndKind(
  name: string,
  kinds: Set<string>,
  preferredDirPatterns: string[],
  context: ResolutionContext,
): string | null {
  const candidates = context.getNodesByName(name);
  if (candidates.length === 0) return null;

  const kindFiltered = candidates.filter((n) => kinds.has(n.kind));
  if (kindFiltered.length === 0) return null;

  // Prefer candidates in framework-conventional directories
  if (preferredDirPatterns.length > 0) {
    const preferred = kindFiltered.filter((n) =>
      preferredDirPatterns.some((d) => n.filePath.includes(d))
    );
    if (preferred.length > 0) return preferred[0]!.id;
  }

  // Fall back to any match
  return kindFiltered[0]!.id;
}
