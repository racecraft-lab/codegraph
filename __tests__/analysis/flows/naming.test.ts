/**
 * SPEC-011 T017 [US1] — flow naming (FR-010).
 *
 * `<METHOD> <path>` when route-rooted; CLI command name when CLI-rooted; else the
 * qualified root symbol.
 */
import { describe, it, expect } from 'vitest';
import { nameFlow } from '../../../src/analysis/flows/naming';
import type { EntryPoint } from '../../../src/analysis/flows/entry-points';

describe('flow naming', () => {
  it('names a route-rooted flow by its method and path', () => {
    const e: EntryPoint = {
      entryKind: 'route',
      rootNodeId: 'route:src/api.ts:1:GET:/users',
      rootName: 'GET /users',
      rootKind: 'route',
      routeName: 'GET /users',
    };
    expect(nameFlow(e)).toBe('GET /users');
  });

  it('names a CLI-rooted flow by its command name', () => {
    const e: EntryPoint = {
      entryKind: 'cli',
      rootNodeId: 'n:src/cli.ts:greetHandler',
      rootName: 'greetHandler',
      rootKind: 'function',
      commandName: 'greet',
    };
    expect(nameFlow(e)).toBe('greet');
  });

  it('names an export/event-rooted flow by its qualified root symbol', () => {
    const exp: EntryPoint = {
      entryKind: 'export',
      rootNodeId: 'n:src/lib.ts:publicApi',
      rootName: 'publicApi',
      rootKind: 'function',
      rootQualifiedName: 'src/lib.ts::publicApi',
    };
    expect(nameFlow(exp)).toBe('src/lib.ts::publicApi');

    const ev: EntryPoint = {
      entryKind: 'event',
      rootNodeId: 'n:src/ev.ts:onData',
      rootName: 'onData',
      rootKind: 'method',
      rootQualifiedName: 'src/ev.ts::Bus.onData',
    };
    expect(nameFlow(ev)).toBe('src/ev.ts::Bus.onData');
  });
});
