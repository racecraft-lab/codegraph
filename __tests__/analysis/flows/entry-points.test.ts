/**
 * SPEC-011 T013 [US1] — entry-point detection (FR-001/002/003).
 *
 * Four static sources, deduped to one root each, NO name heuristics:
 *   route nodes; commander `.command('<name>').action(<handler>)`; event/queue
 *   handler via re-applied callback/observer registrars; externally-exposed
 *   export (`isExported` callable, zero inbound calls/references).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { detectEntryPoints } from '../../../src/analysis/flows/entry-points';
import { freshSeed, cleanupSeeds, node, edge, file, type SeedHandle } from './helpers';

afterEach(cleanupSeeds);

function kindsByRoot(h: SeedHandle): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of detectEntryPoints(h.graph)) m.set(e.rootNodeId, e.entryKind);
  return m;
}

describe('entry-point detection', () => {
  it('roots a flow at a route node', () => {
    const h = freshSeed();
    const route = node(h, { id: 'route:src/api.ts:1:GET:/users', name: 'GET /users', kind: 'route', filePath: 'src/api.ts' });
    const handler = node(h, { name: 'listUsers', kind: 'function', filePath: 'src/api.ts' });
    edge(h, route.id, handler.id, 'references');

    const entries = detectEntryPoints(h.graph);
    const routeEntry = entries.find((e) => e.entryKind === 'route');
    expect(routeEntry).toBeDefined();
    expect(routeEntry!.rootNodeId).toBe(route.id);
    expect(routeEntry!.routeName).toBe('GET /users');
    // The handler is referenced by the route → it is NOT an exposed export.
    expect(entries.some((e) => e.rootNodeId === handler.id)).toBe(false);
  });

  it('roots a flow at a commander CLI command handler (named)', () => {
    const h = freshSeed();
    file(h, 'src/cli.ts', `program.command('greet <name>').action(greetHandler);\n`);
    const handler = node(h, { name: 'greetHandler', kind: 'function', filePath: 'src/cli.ts' });

    const entries = detectEntryPoints(h.graph);
    const cli = entries.find((e) => e.entryKind === 'cli');
    expect(cli).toBeDefined();
    expect(cli!.rootNodeId).toBe(handler.id);
    expect(cli!.commandName).toBe('greet');
  });

  it('roots a flow at an externally-exposed export (isExported, zero inbound)', () => {
    const h = freshSeed();
    const exported = node(h, { name: 'publicApi', kind: 'function', filePath: 'src/lib.ts', isExported: true });

    const entries = detectEntryPoints(h.graph);
    const exp = entries.find((e) => e.rootNodeId === exported.id);
    expect(exp).toBeDefined();
    expect(exp!.entryKind).toBe('export');
  });

  it('does NOT treat an exported callable WITH inbound calls/references as an export entry', () => {
    const h = freshSeed();
    const caller = node(h, { name: 'caller', kind: 'function', filePath: 'src/a.ts', isExported: true });
    const used = node(h, { name: 'used', kind: 'function', filePath: 'src/b.ts', isExported: true });
    edge(h, caller.id, used.id, 'calls');

    // `caller` (exported, zero inbound) IS an export entry, but `used` (exported
    // but WITH an inbound call) must not be.
    const roots = kindsByRoot(h);
    expect(roots.get(used.id)).toBeUndefined();
    expect(roots.get(caller.id)).toBe('export');
  });

  it('roots a flow at an event handler registered via .on(...)', () => {
    const h = freshSeed();
    file(h, 'src/ev.ts', `emitter.on('data', onData);\n`);
    const onData = node(h, { name: 'onData', kind: 'function', filePath: 'src/ev.ts', isExported: true });

    const entries = detectEntryPoints(h.graph);
    const ev = entries.find((e) => e.rootNodeId === onData.id);
    expect(ev).toBeDefined();
    expect(ev!.entryKind).toBe('event');
  });

  it('dedupes an entry qualifying two ways to exactly one flow (FR-003)', () => {
    const h = freshSeed();
    // onData is BOTH an exposed export (isExported, zero inbound) AND an event
    // handler. It must root exactly ONE flow; event wins by precedence.
    file(h, 'src/ev.ts', `emitter.on('data', onData);\n`);
    const onData = node(h, { name: 'onData', kind: 'function', filePath: 'src/ev.ts', isExported: true });

    const entries = detectEntryPoints(h.graph);
    const forNode = entries.filter((e) => e.rootNodeId === onData.id);
    expect(forNode).toHaveLength(1);
    expect(forNode[0]!.entryKind).toBe('event');
  });

  it('uses NO name-based heuristics — a non-exported "handler" with inbound edges is not an entry (FR-002)', () => {
    const h = freshSeed();
    const caller = node(h, { name: 'caller', kind: 'function', filePath: 'src/a.ts' });
    const handler = node(h, { name: 'handler', kind: 'function', filePath: 'src/b.ts', isExported: false });
    edge(h, caller.id, handler.id, 'calls');

    const roots = kindsByRoot(h);
    // Named "handler" but not exported and has an inbound call → not an entry.
    expect(roots.get(handler.id)).toBeUndefined();
  });

  it('resolves a same-name handler deterministically, not by SQLite row order (FR-008a)', () => {
    const h = freshSeed();
    // Registration lives in a file with NO local `handler` def, so the same-file
    // preference does not apply and the deterministic total order must decide.
    // Insert the src/b.ts def FIRST so an insertion-ordered `candidates[0]` (the
    // pre-fix behavior) would wrongly pick it over the lexicographically-first one.
    file(h, 'src/z.ts', `emitter.on('evt', handler);\n`);
    node(h, { name: 'handler', kind: 'function', filePath: 'src/b.ts' });
    const inA = node(h, { name: 'handler', kind: 'function', filePath: 'src/a.ts' });

    const ev = detectEntryPoints(h.graph).find((e) => e.entryKind === 'event');
    expect(ev).toBeDefined();
    expect(ev!.rootNodeId).toBe(inA.id); // src/a.ts wins the total order, every run
  });

  it('still prefers the same-file handler over a lexicographically-earlier one', () => {
    const h = freshSeed();
    file(h, 'src/here.ts', `emitter.on('evt', handler);\n`);
    node(h, { name: 'handler', kind: 'function', filePath: 'src/aaa.ts' }); // sorts first…
    const here = node(h, { name: 'handler', kind: 'function', filePath: 'src/here.ts' });

    const ev = detectEntryPoints(h.graph).find((e) => e.entryKind === 'event');
    expect(ev!.rootNodeId).toBe(here.id); // …but same-file preference wins (FR-001)
  });

  it('detects registrations in .mts and .jsx variants, not just .ts/.js (FR-001)', () => {
    const h = freshSeed();
    file(h, 'src/ev.mts', `emitter.on('data', onData);\n`);
    const onData = node(h, { name: 'onData', kind: 'function', filePath: 'src/ev.mts' });
    file(h, 'src/cli.jsx', `program.command('build').action(buildHandler);\n`);
    const buildHandler = node(h, { name: 'buildHandler', kind: 'function', filePath: 'src/cli.jsx' });

    const roots = kindsByRoot(h);
    expect(roots.get(onData.id)).toBe('event'); // .mts scanned (was skipped pre-fix)
    expect(roots.get(buildHandler.id)).toBe('cli'); // .jsx scanned (was skipped pre-fix)
  });
});
