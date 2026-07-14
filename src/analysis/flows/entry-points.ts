/**
 * SPEC-011 — Execution Flows: static entry-point detection (T020).
 *
 * Four static-registration sources (FR-001, research R5), deduplicated to ONE
 * flow root each (FR-003), with NO name-based heuristics (FR-002):
 *
 *   (a) `route` nodes — the framework resolvers already emit them; a route-rooted
 *       flow roots at the `route` node itself (FR-008).
 *   (b) commander CLI command registrations — a minimal `.command('<name>')
 *       …​.action(<handler>)` recognizer reusing the express inline-handler
 *       body-attribution technique; roots at the named handler, or a synthetic
 *       command node seeded with the inline body's calls.
 *   (c) event/queue handler registrations — the callback/observer registrars
 *       (`.on('e', handler)` / `onX(handler)`) re-applied to mark the REGISTERED
 *       handler node as a root.
 *   (d) externally-exposed exports — `isExported` callable (`function`/`method`)
 *       nodes with ZERO inbound `calls`/`references` edges of any provenance.
 */

import type { Node } from '../../types';
import type { QueryBuilder } from '../../db/queries';
import type { CatalogProvenance, EntryKind, FlowStepEdgeKind } from '../types';
import { stripCommentsForRegex } from '../../resolution/strip-comments';

/** A seed edge out of a SYNTHETIC root (an inline CLI command) into the graph. */
export interface VirtualRootEdge {
  targetNodeId: string;
  edgeKind: FlowStepEdgeKind;
  provenance: CatalogProvenance;
}

/**
 * A detected flow root. `rootNodeId` is a by-value reference — usually a real
 * graph node id, but a synthetic `cli:<file>:<line>:<name>` id for an inline
 * commander action (mirroring the express `route:` node id), in which case the
 * root's out-edges are supplied as {@link virtualRootEdges} rather than read from
 * the graph.
 */
export interface EntryPoint {
  entryKind: EntryKind;
  rootNodeId: string;
  rootName: string;
  rootKind: string;
  /** Fully-qualified root symbol — the flow name for event/export roots (FR-010). */
  rootQualifiedName?: string;
  /** Route method+path — the flow name for a route root (FR-010). */
  routeName?: string;
  /** Command name — the flow name for a CLI root (FR-010). */
  commandName?: string;
  /** Present ONLY for a synthetic inline-CLI root: its seeded out-edges. */
  virtualRootEdges?: VirtualRootEdge[];
}

/** The graph surface flow analysis reads from: node/edge queries + file source. */
export interface FlowAnalysisGraph {
  queries: QueryBuilder;
  /** Read a project-root-relative source file, or null when unavailable. */
  readFile(relPath: string): string | null;
}

/** Detection precedence when one node qualifies through multiple sources (FR-003). */
const ENTRY_PRECEDENCE: Record<EntryKind, number> = { route: 0, cli: 1, event: 2, export: 3 };

const JS_TS_RE = /\.(m?js|cjs|tsx?)$/;
const CALLABLE_KINDS = new Set(['function', 'method']);

/** `.on('e', fn)` / `.once('e', fn)` / `.addListener/addEventListener('e', fn)`. */
const EVENT_ON_RE =
  /\.(?:on|once|addListener|addEventListener)\(\s*['"][^'"]+['"]\s*,\s*(?:function\s+(\w+)|(?:this\.)?(\w+))/g;
/** Field-backed observer registration: `scene.onUpdate(this.triggerRender)`. */
const EVENT_REGISTRAR_RE =
  /\.(?:on[A-Z]\w*|subscribe|addListener|addEventListener|register|watch|listen|addCallback)\(\s*(?:this\.)?(\w+)\s*\)/g;
/** commander `.command('<name> …')`. */
const CMD_RE = /\.command\(\s*['"]([^'"]+)['"]/g;

/** Builtins/noise NOT attributed as an inline CLI command's flow (mirrors express). */
const RESERVED_CALLS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'await', 'typeof', 'new',
  'console', 'log', 'error', 'warn', 'info', 'JSON', 'parse', 'stringify',
  'Promise', 'resolve', 'reject', 'then', 'catch', 'require', 'String', 'Number',
  'Boolean', 'Array', 'Object', 'Date', 'Math', 'map', 'filter', 'forEach',
]);

/** Balanced close index for the delimiter opened at `open`, skipping strings. */
function matchDelim(s: string, open: number, oc: string, cc: string): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      i++;
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === oc) depth++;
    else if (ch === cc) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

function langOf(filePath: string): 'typescript' | 'javascript' {
  return /\.tsx?$/.test(filePath) ? 'typescript' : 'javascript';
}

/**
 * Detect and dedupe every static entry point in the graph (FR-001/003). One flow
 * per root node id; when a node qualifies through more than one source the
 * highest-precedence kind wins (route > cli > event > export).
 */
export function detectEntryPoints(graph: FlowAnalysisGraph): EntryPoint[] {
  const { queries } = graph;
  const collected: EntryPoint[] = [];

  // (a) Route nodes — the framework resolvers already emit them.
  for (const route of queries.getNodesByKind('route')) {
    collected.push({
      entryKind: 'route',
      rootNodeId: route.id,
      rootName: route.name,
      rootKind: 'route',
      routeName: route.name,
      rootQualifiedName: route.qualifiedName,
    });
  }

  // (b) + (c) Source-scan sources: commander CLI and event/queue handlers.
  for (const f of queries.getAllFiles() as Array<{ path: string }>) {
    const filePath = f.path;
    if (!JS_TS_RE.test(filePath)) continue;
    const raw = graph.readFile(filePath);
    if (!raw) continue;
    const src = stripCommentsForRegex(raw, langOf(filePath));
    collectCliEntries(src, filePath, queries, collected);
    collectEventEntries(src, filePath, queries, collected);
  }

  // (d) Externally-exposed exports — isExported callables with zero inbound
  // calls/references of any provenance (the live signal; there is no export kind).
  for (const kind of ['function', 'method'] as const) {
    for (const n of queries.iterateNodesByKind(kind)) {
      if (!n.isExported) continue;
      if (queries.getIncomingEdges(n.id, ['calls', 'references']).length > 0) continue;
      collected.push({
        entryKind: 'export',
        rootNodeId: n.id,
        rootName: n.name,
        rootKind: n.kind,
        rootQualifiedName: n.qualifiedName,
      });
    }
  }

  return dedupe(collected);
}

/** Resolve a handler NAME to a callable node, preferring the same file (FR-001). */
function resolveHandler(name: string, filePath: string, queries: QueryBuilder): Node | null {
  const candidates = queries.getNodesByName(name).filter((n) => CALLABLE_KINDS.has(n.kind));
  if (candidates.length === 0) return null;
  return candidates.find((n) => n.filePath === filePath) ?? candidates[0]!;
}

/** commander `.command('<name>').action(<handler>)` → one CLI entry per command. */
function collectCliEntries(src: string, filePath: string, queries: QueryBuilder, out: EntryPoint[]): void {
  CMD_RE.lastIndex = 0;
  const cmdMatches: Array<{ index: number; name: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = CMD_RE.exec(src))) {
    cmdMatches.push({ index: m.index, name: m[1]!.trim().split(/\s+/)[0]! });
  }
  for (let i = 0; i < cmdMatches.length; i++) {
    const { index, name: commandName } = cmdMatches[i]!;
    if (!commandName) continue;
    const segEnd = i + 1 < cmdMatches.length ? cmdMatches[i + 1]!.index : src.length;
    const actionAt = src.indexOf('.action(', index);
    if (actionAt < 0 || actionAt >= segEnd) continue;
    const open = src.indexOf('(', actionAt);
    const close = open >= 0 ? matchDelim(src, open, '(', ')') : -1;
    if (close <= open) continue;
    const arg = src.slice(open + 1, close).trim();
    const line = lineOf(src, index);

    const named = arg.match(/^([A-Za-z_$][\w$]*)\s*$/);
    if (named) {
      const handler = resolveHandler(named[1]!, filePath, queries);
      if (handler) {
        out.push({
          entryKind: 'cli',
          rootNodeId: handler.id,
          rootName: handler.name,
          rootKind: handler.kind,
          rootQualifiedName: handler.qualifiedName,
          commandName,
        });
      }
      continue;
    }
    // Inline handler (`.action(async (opts) => {…})`): synthesize a command root
    // and attribute the body's calls to it (the express inline-handler technique).
    if (arg.includes('=>') || /^(?:async\s+)?function\b/.test(arg)) {
      const seeds = inlineBodyEdges(arg, filePath, queries);
      out.push({
        entryKind: 'cli',
        rootNodeId: `cli:${filePath}:${line}:${commandName}`,
        rootName: commandName,
        rootKind: 'function',
        commandName,
        virtualRootEdges: seeds,
      });
    }
  }
}

/** Resolve the non-reserved calls in an inline action body to seed edges. */
function inlineBodyEdges(arg: string, filePath: string, queries: QueryBuilder): VirtualRootEdge[] {
  const arrowAt = arg.indexOf('=>');
  let body = arrowAt >= 0 ? arg.slice(arrowAt + 2) : arg;
  const braceAt = body.indexOf('{');
  if (braceAt >= 0) {
    const end = matchDelim(body, braceAt, '{', '}');
    if (end > braceAt) body = body.slice(braceAt + 1, end);
  }
  const callRe = /\b([A-Za-z_$][\w$]*)\s*\(/g;
  const seen = new Set<string>();
  const edges: VirtualRootEdge[] = [];
  let cm: RegExpExecArray | null;
  while ((cm = callRe.exec(body))) {
    const name = cm[1]!;
    if (seen.has(name) || RESERVED_CALLS.has(name)) continue;
    seen.add(name);
    const handler = resolveHandler(name, filePath, queries);
    if (handler) edges.push({ targetNodeId: handler.id, edgeKind: 'calls', provenance: 'heuristic' });
  }
  return edges;
}

/** `.on('e', handler)` / `onX(handler)` → mark the REGISTERED handler a root. */
function collectEventEntries(src: string, filePath: string, queries: QueryBuilder, out: EntryPoint[]): void {
  const names = new Set<string>();
  EVENT_ON_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EVENT_ON_RE.exec(src))) {
    const name = m[1] || m[2];
    if (name) names.add(name);
  }
  EVENT_REGISTRAR_RE.lastIndex = 0;
  while ((m = EVENT_REGISTRAR_RE.exec(src))) {
    if (m[1]) names.add(m[1]);
  }
  for (const name of names) {
    const handler = resolveHandler(name, filePath, queries);
    if (!handler) continue;
    out.push({
      entryKind: 'event',
      rootNodeId: handler.id,
      rootName: handler.name,
      rootKind: handler.kind,
      rootQualifiedName: handler.qualifiedName,
    });
  }
}

/** One entry per root node id; highest-precedence kind wins (FR-003). */
function dedupe(entries: EntryPoint[]): EntryPoint[] {
  const best = new Map<string, EntryPoint>();
  for (const e of entries) {
    const prior = best.get(e.rootNodeId);
    if (!prior || ENTRY_PRECEDENCE[e.entryKind] < ENTRY_PRECEDENCE[prior.entryKind]) {
      best.set(e.rootNodeId, e);
    }
  }
  return [...best.values()].sort((a, b) => {
    const pa = ENTRY_PRECEDENCE[a.entryKind];
    const pb = ENTRY_PRECEDENCE[b.entryKind];
    if (pa !== pb) return pa - pb;
    return a.rootNodeId < b.rootNodeId ? -1 : a.rootNodeId > b.rootNodeId ? 1 : 0;
  });
}
