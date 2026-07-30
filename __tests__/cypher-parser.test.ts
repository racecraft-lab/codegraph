import { describe, it, expect } from 'vitest';

type CypherDiagnostic = {
  readonly status: 'diagnostic';
  readonly code: string;
  readonly message: string;
  readonly offset: number;
  readonly line: number;
  readonly column: number;
  readonly expected: string;
  readonly anchor: string;
  readonly excerpt: string;
  readonly truncatedBefore: boolean;
  readonly truncatedAfter: boolean;
};

type CypherParseSuccess = {
  readonly status: 'success';
  readonly match: {
    readonly pathVariable?: string;
    readonly nodes: readonly Array<{
      readonly variable?: string;
      readonly label?: string;
      readonly properties?: Record<string, unknown>;
    }>;
    readonly relationships: readonly Array<{
      readonly variable?: string;
      readonly type?: string;
      readonly direction: 'outgoing' | 'incoming';
      readonly range?: {
        readonly lower: number;
        readonly upper: number;
      };
    }>;
  };
  readonly where?: unknown;
  readonly returns: readonly Array<{
    readonly expression: string;
    readonly alias?: string;
  }>;
  readonly literals: readonly Array<{
    readonly raw: string;
    readonly decoded: string;
    readonly offset: number;
    readonly bindingIndex: number;
  }>;
};

type CypherParseResult = CypherParseSuccess | CypherDiagnostic;

type CypherPlanSuccess = {
  readonly status: 'success';
  readonly sql: string;
  readonly boundParameters: readonly unknown[];
};

type CypherPlanResult = CypherPlanSuccess | CypherDiagnostic;

type CypherParserTestContract = {
  readonly parseCypherForTests: (query: string) => CypherParseResult;
  readonly planCypherForTests: (query: string) => CypherPlanResult;
};

async function loadCypherParserContract(): Promise<CypherParserTestContract> {
  let mod: unknown;
  try {
    mod = await import('../src/query/cypher/index');
  } catch (error) {
    throw new Error(
      'SPEC-013 Cypher parser production contract missing: expected ' +
        '`src/query/cypher/index.ts` to export internal test seams ' +
        '`parseCypherForTests(query)` and `planCypherForTests(query)`. ' +
        `Original load failure: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const contract = mod as Partial<CypherParserTestContract>;
  expect(typeof contract.parseCypherForTests, 'parseCypherForTests export').toBe('function');
  expect(typeof contract.planCypherForTests, 'planCypherForTests export').toBe('function');
  return contract as CypherParserTestContract;
}

async function parse(query: string): Promise<CypherParseResult> {
  const contract = await loadCypherParserContract();
  return contract.parseCypherForTests(query);
}

async function plan(query: string): Promise<CypherPlanResult> {
  const contract = await loadCypherParserContract();
  return contract.planCypherForTests(query);
}

function expectParseSuccess(result: CypherParseResult): CypherParseSuccess {
  expect(result.status).toBe('success');
  return result as CypherParseSuccess;
}

function expectPlanSuccess(result: CypherPlanResult): CypherPlanSuccess {
  expect(result.status).toBe('success');
  return result as CypherPlanSuccess;
}

function expectDiagnostic(result: CypherParseResult | CypherPlanResult, code: string): CypherDiagnostic {
  expect(result.status).toBe('diagnostic');
  const diagnostic = result as CypherDiagnostic;
  expect(diagnostic.code).toBe(code);
  expect(typeof diagnostic.offset).toBe('number');
  expect(typeof diagnostic.line).toBe('number');
  expect(typeof diagnostic.column).toBe('number');
  expect(diagnostic.expected.length).toBeGreaterThan(0);
  expect(diagnostic.anchor.length).toBeGreaterThan(0);
  expect(diagnostic.excerpt.length).toBeLessThanOrEqual(160);
  expect(typeof diagnostic.truncatedBefore).toBe('boolean');
  expect(typeof diagnostic.truncatedAfter).toBe('boolean');
  return diagnostic;
}

describe('SPEC-013 Cypher parser — Slice 1 grammar acceptance', () => {
  it('accepts one connected MATCH chain with public labels/types, explicit arrows, fixed relationships, and RETURN', async () => {
    const parsed = expectParseSuccess(await parse(
      'MATCH (file:file)-[contains:contains]->(fn:function)<-[caller:calls]-(method:method) RETURN file.name, fn.name, caller.provenance',
    ));

    expect(parsed.match.pathVariable).toBeUndefined();
    expect(parsed.match.nodes).toEqual([
      { variable: 'file', label: 'file' },
      { variable: 'fn', label: 'function' },
      { variable: 'method', label: 'method' },
    ]);
    expect(parsed.match.relationships).toEqual([
      { variable: 'contains', type: 'contains', direction: 'outgoing' },
      { variable: 'caller', type: 'calls', direction: 'incoming' },
    ]);
    expect(parsed.returns.map((item) => item.expression)).toEqual(['file.name', 'fn.name', 'caller.provenance']);
  });

  it('accepts optional full-chain path binding and bounded variable relationships up to eight edges', async () => {
    const parsed = expectParseSuccess(await parse(
      'MATCH p = (source:function)-[edge:calls*1..8]->(target:function) RETURN p, source.name AS sourceName, target.name AS targetName LIMIT 5',
    ));

    expect(parsed.match.pathVariable).toBe('p');
    expect(parsed.match.relationships).toEqual([
      { variable: 'edge', type: 'calls', direction: 'outgoing', range: { lower: 1, upper: 8 } },
    ]);
    expect(parsed.returns).toEqual([
      { expression: 'p' },
      { expression: 'source.name', alias: 'sourceName' },
      { expression: 'target.name', alias: 'targetName' },
    ]);
  });

  it('rejects variable relationship declarations without a bounded upper limit or with upper bound greater than eight', async () => {
    expectDiagnostic(
      await parse('MATCH p = (a:function)-[:calls*]->(b:function) RETURN p'),
      'CYPHER_UNBOUNDED_PATH',
    );
    expectDiagnostic(
      await parse('MATCH p = (a:function)-[:calls*1..9]->(b:function) RETURN p'),
      'CYPHER_PATH_TOO_DEEP',
    );
  });

  it('requires every node and relationship declaration name to be unique in the connected chain', async () => {
    expectDiagnostic(
      await parse('MATCH (n:function)-[:calls]->(n:function) RETURN n'),
      'CYPHER_DUPLICATE_VARIABLE',
    );
    expectDiagnostic(
      await parse('MATCH (a:function)-[edge:calls]->(b:function)-[edge:references]->(c:function) RETURN a'),
      'CYPHER_DUPLICATE_VARIABLE',
    );
  });
});

describe('SPEC-013 Cypher parser — Slice 1 rejection semantics', () => {
  it('rejects disconnected, comma-separated, and multi-MATCH patterns', async () => {
    expectDiagnostic(
      await parse('MATCH (a:function) (b:function) RETURN a'),
      'CYPHER_DISCONNECTED_PATTERN',
    );
    expectDiagnostic(
      await parse('MATCH (a:function), (b:function) RETURN a'),
      'CYPHER_COMMA_PATTERN_UNSUPPORTED',
    );
    expectDiagnostic(
      await parse('MATCH (a:function)-[:calls]->(b:function) MATCH (c:function)-[:calls]->(d:function) RETURN a'),
      'CYPHER_MULTI_MATCH_UNSUPPORTED',
    );
  });

  it('rejects undirected relationships, write clauses, and direct SQL forms before planning', async () => {
    expectDiagnostic(
      await parse('MATCH (a:function)-[:calls]-(b:function) RETURN a'),
      'CYPHER_UNDIRECTED_RELATIONSHIP',
    );
    expectDiagnostic(
      await parse('MATCH (n:function) DELETE n RETURN n'),
      'CYPHER_UNSUPPORTED_CLAUSE',
    );
    expectDiagnostic(
      await parse('SELECT * FROM nodes'),
      'CYPHER_DIRECT_SQL_UNSUPPORTED',
    );
  });

  it('treats keywords case-insensitively while enforcing exact public label/type/property casing', async () => {
    const parsed = expectParseSuccess(await parse(
      'mAtCh (n:function)-[:calls]->(m:method) wHeRe n.name IS NOT NULL rEtUrN n.name As displayName LiMiT 3',
    ));
    expect(parsed.match.nodes.map((node) => node.label)).toEqual(['function', 'method']);
    expect(parsed.returns).toEqual([{ expression: 'n.name', alias: 'displayName' }]);

    expectDiagnostic(
      await parse('MATCH (n:Function)-[:calls]->(m:function) RETURN n'),
      'CYPHER_UNKNOWN_LABEL',
    );
    expectDiagnostic(
      await parse('MATCH (n:function)-[:CALLS]->(m:function) RETURN n'),
      'CYPHER_UNKNOWN_RELATIONSHIP_TYPE',
    );
    expectDiagnostic(
      await parse('MATCH (n:function)-[:calls]->(m:function) RETURN n.updatedAt'),
      'CYPHER_UNKNOWN_PROPERTY',
    );
  });

  it('accepts single-quoted literals as bound parameters and rejects unsupported literal forms', async () => {
    const planned = expectPlanSuccess(await plan(
      "MATCH (n:function)-[:calls]->(m:function) WHERE n.name = 'can\\'t\\\\stop' RETURN n.name",
    ));
    expect(planned.boundParameters).toEqual(["can't\\stop"]);
    expect(planned.sql).not.toContain("can't\\stop");
    expect(planned.sql).not.toContain('can\\');

    const parsed = expectParseSuccess(await parse(
      "MATCH (n:function)-[:calls]->(m:function) WHERE n.name = 'line\\nfeed' RETURN n.name",
    ));
    expect(parsed.literals).toContainEqual(expect.objectContaining({
      raw: "'line\\nfeed'",
      decoded: 'line\nfeed',
      bindingIndex: 0,
    }));

    expectDiagnostic(
      await parse('MATCH (n:function)-[:calls]->(m:function) WHERE n.name = "double" RETURN n.name'),
      'CYPHER_UNSUPPORTED_STRING_LITERAL',
    );
    expectDiagnostic(
      await parse("MATCH (n:function)-[:calls]->(m:function) WHERE n.name = 'bad\\u1234' RETURN n.name"),
      'CYPHER_UNSUPPORTED_STRING_LITERAL',
    );
  });

  it('reports UTF-16 offsets, line/column, expected construct, anchor, and bounded excerpt for multiline diagnostics', async () => {
    const query = [
      'MATCH (emoji:function)-[:calls]->(target:function)',
      "WHERE emoji.name = 'ok😀é'",
      'RETURN emoji.name',
      'ORDER BY missing.updatedAt',
    ].join('\r\n');
    const diagnostic = expectDiagnostic(await parse(query), 'CYPHER_UNKNOWN_VARIABLE');
    const badOffset = query.indexOf('missing');

    expect(diagnostic.offset).toBe(badOffset);
    expect(diagnostic.line).toBe(4);
    expect(diagnostic.column).toBe(9);
    expect(diagnostic.expected).toBe('declared variable or alias');
    expect(diagnostic.anchor).toBe('orderByClause');
    expect(diagnostic.excerpt).toContain('ORDER BY missing.updatedAt');
  });
});
