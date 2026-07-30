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
    readonly aggregate?: {
      readonly function: 'count';
      readonly argument: '*' | string;
    };
  }>;
  readonly groupingKeys?: readonly string[];
  readonly orderBy: readonly Array<{
    readonly expression: string;
    readonly direction: 'ASC' | 'DESC';
  }>;
  readonly limit?: number;
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
  readonly pathExpansionGuard?: number;
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

function expectReadOnlySqlStatement(sql: string): void {
  const normalized = sql.trim();
  expect(normalized).not.toContain(';');
  expect(normalized).toMatch(/^(SELECT|WITH RECURSIVE)\b/i);
  expect(normalized).not.toMatch(
    /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH|BEGIN|COMMIT|ROLLBACK)\b/i,
  );
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

  it('rejects variable relationship declarations without a bounded upper limit, with invalid lower bounds, or with upper bound greater than eight', async () => {
    expectDiagnostic(
      await parse('MATCH p = (a:function)-[:calls*]->(b:function) RETURN p'),
      'CYPHER_UNBOUNDED_PATH',
    );
    expectDiagnostic(
      await parse('MATCH p = (a:function)-[:calls*0..3]->(b:function) RETURN p'),
      'CYPHER_UNBOUNDED_PATH',
    );
    expectDiagnostic(
      await parse('MATCH p = (a:function)-[:calls*3..2]->(b:function) RETURN p'),
      'CYPHER_UNBOUNDED_PATH',
    );
    expectDiagnostic(
      await parse('MATCH p = (a:function)-[:calls*1..9]->(b:function) RETURN p'),
      'CYPHER_PATH_TOO_DEEP',
    );
  });

  it('rejects a second ranged relationship segment deterministically before planning', async () => {
    const query = [
      'MATCH (a:function)-[:calls*1..2]->(b:function)',
      '-[:calls*1..2]->(c:function)',
      'RETURN c',
    ].join(' ');
    const diagnostic = expectDiagnostic(await plan(query), 'CYPHER_UNSUPPORTED');

    expect(diagnostic.offset).toBe(query.lastIndexOf('*'));
    expect(diagnostic.anchor).toBe('relationshipPattern');
    expect(diagnostic.expected).toBe('at most one ranged relationship segment');
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

describe('SPEC-013 Cypher planner — Slice 1 SQL emission', () => {
  it('emits one parameterized read-only SELECT for fixed directed relationships with active-edge predicates', async () => {
    const planned = expectPlanSuccess(await plan(
      "MATCH (file:file)-[contains:contains]->(fn:function)<-[caller:calls]-(method:method) WHERE fn.name = 'handler' RETURN file.name, fn.name, caller.provenance",
    ));

    expectReadOnlySqlStatement(planned.sql);
    expect(planned.sql).toMatch(/^SELECT\b/i);
    expect(planned.sql).toContain('INDEXED BY idx_edges_source_kind');
    expect(planned.sql).toContain('INDEXED BY idx_edges_target_kind');
    expect(planned.sql).toContain('e0.source = n0.id');
    expect(planned.sql).toContain('e0.target = n1.id');
    expect(planned.sql).toContain('e1.target = n1.id');
    expect(planned.sql).toContain('e1.source = n2.id');
    expect(planned.sql).toContain("json_extract(e0.metadata, '$.lsp.active') IS NOT 0");
    expect(planned.sql).toContain("json_extract(e1.metadata, '$.lsp.active') IS NOT 0");
    expect(planned.sql).toContain('n1.name = ?');
    expect(planned.sql).not.toContain('handler');
    expect(planned.boundParameters.slice(0, 1)).toEqual(['handler']);
    expect(planned.boundParameters.slice(-1)).toEqual([101]);
  });

  it('emits a bounded recursive relationship plan with relationship-simple visited-edge state', async () => {
    const planned = expectPlanSuccess(await plan(
      'MATCH p = (source:function)-[edge:calls*1..3]->(target:function) RETURN p, target.name',
    ));

    expectReadOnlySqlStatement(planned.sql);
    expect(planned.sql).toMatch(/^WITH RECURSIVE\b/i);
    expect(planned.sql).toContain('INDEXED BY idx_edges_source_kind');
    expect(planned.sql).toContain('SELECT 1, n0.id, e0.target');
    expect(planned.sql).toContain('JOIN edges e0 INDEXED BY idx_edges_source_kind ON e0.source = n0.id');
    expect(planned.sql).not.toContain('SELECT 0, n0.id, n0.id');
    expect(planned.sql).toContain('visited_edge_ids');
    expect(planned.sql).toContain('__cg_start_node_id');
    expect(planned.sql).toContain('__cg_visited_edge_ids');
    expect(planned.sql).toContain("instr(cg_path_0.visited_edge_ids, ',' || e0.id || ',') = 0");
    expect(planned.sql).toContain('cg_path_0.depth < ?');
    expect(planned.sql).toContain("WHERE cg_path_0.depth BETWEEN ? AND ? AND n1.kind = 'function'");
    expect(planned.sql).toContain(
      'frontier_order_0, frontier_order_1, frontier_order_2) AS (',
    );
    expect(planned.sql).toContain('ORDER BY 7 ASC, 8 ASC NULLS LAST, 9 ASC');
    expect(planned.sql).toContain('ORDER BY cg_path_0.public_identity ASC');
    expect(planned.sql).toContain('ORDER BY cg_bounded_paths.public_identity ASC');
    expect(planned.sql).toContain("|| '~'");
    expect(planned.sql).toContain(
      'substr(cg_path_0.public_identity, 1, length(cg_path_0.public_identity) - 1)',
    );
    expect(planned.sql).not.toMatch(/ORDER BY cg_(?:path_0|bounded_paths)\.depth\b/);
    expect(planned.sql).toContain('LIMIT ?');
    expect(planned.pathExpansionGuard).toBe(48000);
    expect(planned.boundParameters.slice(0, 5)).toEqual([3, 48001, 1, 3, 101]);
    expect(planned.boundParameters.slice(-1)).toEqual([101]);
  });

  it('orders pure and mixed ranged SQL caps by public projections and match identity', async () => {
    const projected = expectPlanSuccess(await plan(
      'MATCH (source:function)-[edge:calls*1..2]->(target:function) RETURN target.name AS name LIMIT 1',
    ));
    expect(projected.sql).toContain(
      'ORDER BY n1.name ASC NULLS LAST, cg_path_0.public_identity ASC',
    );
    expect(projected.sql).toContain(
      'ORDER BY n1.name ASC NULLS LAST, cg_bounded_paths.public_identity ASC',
    );
    expect(projected.sql).toContain(
      'frontier_order_0, frontier_order_1) AS (',
    );
    expect(projected.sql).toContain('ORDER BY 7 ASC NULLS LAST, 8 ASC');
    expect(projected.pathExpansionGuard).toBe(32000);
    expect(projected.boundParameters).toEqual([2, 32001, 1, 2, 2, 2]);
    expect(projected.sql).toContain('cg_result_rows AS (');
    expect(projected.sql).toContain('1 AS "__cg_path_frontier_sentinel"');

    const relationshipList = expectPlanSuccess(await plan(
      'MATCH (source:function)-[edge:calls*1..2]->(target:function) RETURN edge LIMIT 1',
    ));
    expect(relationshipList.sql).toContain(
      'ORDER BY cg_path_0.relationship_identity ASC, cg_path_0.public_identity ASC',
    );
    expect(relationshipList.sql).toContain(
      'ORDER BY cg_bounded_paths.relationship_identity ASC, cg_bounded_paths.public_identity ASC',
    );

    const mixedProjected = expectPlanSuccess(await plan([
      'MATCH (source:function)-[:imports]->(middle:function)',
      '-[:calls*1..2]->(target:function)',
      'RETURN target.name AS name LIMIT 1',
    ].join(' ')));
    expect(mixedProjected.sql).toContain(
      'frontier_order_0, frontier_order_1) AS (',
    );
    expect(mixedProjected.sql).toContain('ORDER BY 11 ASC NULLS LAST, 12 ASC');
    expect(mixedProjected.sql).toContain(
      'ORDER BY n2.name ASC NULLS LAST, cg_path_0.public_identity ASC',
    );

    const mixed = expectPlanSuccess(await plan([
      'MATCH p = (source:function)-[:imports]->(middle:function)',
      '-[:calls*1..2]->(candidate:function)-[:imports]->(target:function)',
      'RETURN p LIMIT 1',
    ].join(' ')));
    expect(mixed.sql).toContain(
      'visited_edge_ids, public_identity, relationship_identity) AS (',
    );
    expect(mixed.sql).toContain('ORDER BY 9 ASC');
    expect(mixed.sql).toContain(
      'substr(cg_path_0.public_identity, 1, length(cg_path_0.public_identity) - 1)',
    );
    expect(mixed.sql).not.toMatch(/ORDER BY cg_path_0\.(?:visited_edge_ids|variable_edge_ids)\b/);
  });

  it('uses a private guard-plus-one sentinel for ranged aggregate frontiers', async () => {
    const planned = expectPlanSuccess(await plan([
      "MATCH (start:function {name: 'aggregateFrontierHub'})",
      '-[:calls*1..3]->(finish:function)',
      'RETURN start.name AS startName, count(finish.name) AS reachable',
      'ORDER BY reachable DESC LIMIT 1',
    ].join(' ')));

    expect(planned.pathExpansionGuard).toBe(48000);
    expect(planned.sql).toContain(
      'cg_path_frontier AS (SELECT count(*) AS "__cg_path_frontier_count" FROM cg_path_0)',
    );
    expect(planned.sql).toContain(
      'SELECT NULL AS "startName", NULL AS "reachable", cg_path_frontier."__cg_path_frontier_count" AS "__cg_path_frontier_count", 1 AS "__cg_path_frontier_sentinel"',
    );
    expect(planned.sql).toContain('UNION ALL');
    expect(planned.sql).toContain(
      'ORDER BY "__cg_path_frontier_sentinel" DESC, "__cg_aggregate_result_order" ASC',
    );
    expect(planned.boundParameters).toEqual([
      'aggregateFrontierHub',
      3,
      48001,
      1,
      3,
      48000,
      2,
    ]);
  });
});

describe('SPEC-013 Cypher planner — Slice 1 WHERE emission', () => {
  it('rejects property access on ranged relationship lists before SQL emission', async () => {
    const query = [
      'MATCH (start:function)-[edge:calls*1..2]->(finish:function)',
      "WHERE edge.kind = 'calls'",
      'RETURN edge',
    ].join(' ');
    const diagnostic = expectDiagnostic(await plan(query), 'CYPHER_UNSUPPORTED');

    expect(diagnostic.offset).toBe(query.indexOf('edge.kind'));
    expect(diagnostic.anchor).toBe('whereClause');
    expect(diagnostic.expected).toBe('bare ranged relationship variable');
    expect(diagnostic.message).toContain('list');
  });

  it('returns located canonical diagnostics for structurally incomplete WHERE expressions', async () => {
    const queries = [
      'MATCH (n:function) WHERE n.name = RETURN n.name',
      "MATCH (n:function) WHERE (n.name = 'entry' RETURN n.name",
      'MATCH (n:function) WHERE n.name STARTS RETURN n.name',
    ];

    for (const query of queries) {
      const diagnostic = expectDiagnostic(await plan(query), 'CYPHER_SYNTAX');
      expect(diagnostic.offset).toBe(query.indexOf('RETURN'));
      expect(diagnostic.anchor).toBe('whereClause');
      expect(diagnostic.excerpt).toContain('RETURN n.name');
    }
  });

  it('emits parenthesized boolean predicates with comparisons and bound literals', async () => {
    const planned = expectPlanSuccess(await plan(
      "MATCH (n:function)-[:calls]->(m:method) WHERE NOT (n.name = 'skip' OR m.startLine <= 10) AND m.endLine >= 20 RETURN m.name",
    ));

    expectReadOnlySqlStatement(planned.sql);
    expect(planned.sql).toContain('WHERE');
    expect(planned.sql).toContain('(NOT ((n0.name = ? OR n1.start_line <= ?)) AND n1.end_line >= ?)');
    expect(planned.sql).not.toContain('skip');
    expect(planned.boundParameters.slice(0, 3)).toEqual(['skip', 10, 20]);
    expect(planned.boundParameters.slice(-1)).toEqual([101]);
  });

  it('emits null checks and inequality predicates without allowing opaque filters', async () => {
    const planned = expectPlanSuccess(await plan(
      "MATCH (n:function)-[:calls]->(m:function) WHERE n.docstring IS NULL OR m.name <> 'internal' RETURN m.name",
    ));

    expect(planned.sql).toContain('(n0.docstring IS NULL OR n1.name <> ?)');
    expect(planned.boundParameters.slice(0, 1)).toEqual(['internal']);
    expect(planned.boundParameters.slice(-1)).toEqual([101]);

    expectDiagnostic(
      await plan('MATCH (n:function)-[:calls]->(m:function) WHERE n.decorators IS NOT NULL RETURN m.name'),
      'CYPHER_UNSUPPORTED_OPAQUE_FILTER',
    );
  });
});

describe('SPEC-013 Cypher planner — Slice 1 projection, ordering, and caps', () => {
  it('plans scalar, node, relationship, and path projections with explicit ordering and bounded cap', async () => {
    const planned = expectPlanSuccess(await plan(
      'MATCH p = (source:function)-[edge:calls*1..3]->(target:function) RETURN p, source, target.name AS targetName ORDER BY targetName DESC, source.id ASC LIMIT 2500',
    ));

    expectReadOnlySqlStatement(planned.sql);
    expect(planned.sql).toContain('cg_bounded_paths.visited_edge_ids AS "p"');
    expect(planned.sql).toContain('json_object(');
    expect(planned.sql).toContain('AS "source"');
    expect(planned.sql).toContain('n1.name AS "targetName"');
    expect(planned.sql).toContain('ORDER BY n1.name DESC NULLS FIRST, n0.id ASC NULLS LAST');
    expect(planned.sql).toContain('LIMIT ?');
    expect(planned.boundParameters.slice(-1)).toEqual([1001]);
    expect(planned.sql).toContain('/* effectiveCap=1000 truncationProbe=effectiveCap+1 no totalRows */');
  });

  it('plans deterministic default ordering over projected values and matched-chain identity before default cap', async () => {
    const planned = expectPlanSuccess(await plan(
      'MATCH (file:file)-[contains:contains]->(fn:function) RETURN file.name, fn, contains',
    ));

    expect(planned.sql).toContain("'source', e0.source");
    expect(planned.sql).toContain('AS "contains"');
    expect(planned.sql).toContain(
      'ORDER BY n0.name ASC NULLS LAST, n1.id ASC, e0.source ASC, e0.target ASC, e0.kind ASC, e0.line ASC NULLS LAST, e0.col ASC NULLS LAST',
    );
    expect(planned.sql).toContain("'id', n1.id");
    expect(planned.sql).toContain("'source', e0.source");
    expect(planned.sql).toContain('n0.id ASC, e0.source ASC, e0.target ASC, e0.kind ASC, e0.line ASC NULLS LAST, e0.col ASC NULLS LAST, n1.id ASC');
    expect(planned.boundParameters.slice(-1)).toEqual([101]);
    expect(planned.sql).toContain('/* effectiveCap=100 truncationProbe=effectiveCap+1 no totalRows */');
  });
});

describe('SPEC-013 Cypher parser — Slice 2 count and implicit grouping', () => {
  it('accepts count projections, aliases, and ORDER BY over aliases while exposing every non-aggregate grouping key', async () => {
    const parsed = expectParseSuccess(await parse(
      [
        'MATCH (caller:function)-[:calls]->(target:function)',
        'RETURN caller.filePath AS filePath, target.name, count(*) AS edgeCount, count(target.name) AS namedTargets',
        'ORDER BY edgeCount DESC, filePath ASC',
        'LIMIT 10',
      ].join(' '),
    ));

    expect(parsed.returns).toEqual([
      { expression: 'caller.filePath', alias: 'filePath' },
      { expression: 'target.name' },
      { expression: 'count(*)', alias: 'edgeCount', aggregate: { function: 'count', argument: '*' } },
      { expression: 'count(target.name)', alias: 'namedTargets', aggregate: { function: 'count', argument: 'target.name' } },
    ]);
    expect(parsed.groupingKeys).toEqual(['caller.filePath', 'target.name']);
    expect(parsed.orderBy).toEqual([
      { expression: 'edgeCount', direction: 'DESC' },
      { expression: 'filePath', direction: 'ASC' },
    ]);
    expect(parsed.limit).toBe(10);
  });

  it('rejects aggregation forms other than count star and count expression with a dedicated unsupported diagnostic', async () => {
    expectDiagnostic(
      await parse('MATCH (n:function)-[:calls]->(m:function) RETURN sum(m.startLine) AS totalLines'),
      'CYPHER_UNSUPPORTED_AGGREGATION',
    );
    expectDiagnostic(
      await parse('MATCH (n:function)-[:calls]->(m:function) RETURN count(*) AS calls, max(m.name) AS maxName'),
      'CYPHER_UNSUPPORTED_AGGREGATION',
    );
  });

  it('rejects DISTINCT in RETURN and aggregate arguments before planning', async () => {
    expectDiagnostic(
      await parse('MATCH (n:function)-[:calls]->(m:function) RETURN DISTINCT n.name'),
      'CYPHER_UNSUPPORTED_CLAUSE',
    );
    expectDiagnostic(
      await parse('MATCH (n:function)-[:calls]->(m:function) RETURN count(DISTINCT m.name) AS uniqueNames'),
      'CYPHER_UNSUPPORTED_CLAUSE',
    );
  });
});

describe('SPEC-013 Cypher parser — Slice 2 backtick identifiers', () => {
  it('accepts backtick-escaped identifiers and aliases while unescaping doubled backticks', async () => {
    const parsed = expectParseSuccess(await parse(
      [
        'MATCH (`call er`:function)-[`edge``name`:calls]->(`target-node`:function)',
        'RETURN `call er`.name AS `display name`, `edge``name`.provenance AS `edge provenance`, `target-node` AS `target node`',
        'ORDER BY `display name` DESC',
      ].join(' '),
    ));

    expect(parsed.match.nodes).toEqual([
      { variable: 'call er', label: 'function' },
      { variable: 'target-node', label: 'function' },
    ]);
    expect(parsed.match.relationships).toEqual([
      { variable: 'edge`name', type: 'calls', direction: 'outgoing' },
    ]);
    expect(parsed.returns).toEqual([
      { expression: 'call er.name', alias: 'display name' },
      { expression: 'edge`name.provenance', alias: 'edge provenance' },
      { expression: 'target-node', alias: 'target node' },
    ]);
    expect(parsed.orderBy).toEqual([{ expression: 'display name', direction: 'DESC' }]);
  });

  it('accepts backtick-escaped public labels, relationship types, and properties with exact spelling', async () => {
    const parsed = expectParseSuccess(await parse(
      [
        'MATCH (`n`:`function`)-[:`calls`]->(`m`:`method`)',
        'RETURN `n`.`qualifiedName` AS `qualified name`, `m`.`startLine` AS `start line`',
      ].join(' '),
    ));

    expect(parsed.match.nodes.map((node) => node.label)).toEqual(['function', 'method']);
    expect(parsed.match.relationships.map((relationship) => relationship.type)).toEqual(['calls']);
    expect(parsed.returns).toEqual([
      { expression: 'n.qualifiedName', alias: 'qualified name' },
      { expression: 'm.startLine', alias: 'start line' },
    ]);
  });

  it('rejects control characters inside backtick identifiers before semantic validation', async () => {
    const nul = String.fromCharCode(0);
    const del = String.fromCharCode(0x7f);

    expectDiagnostic(
      await parse('MATCH (`bad' + nul + 'name`:function)-[:calls]->(target:function) RETURN target.name'),
      'CYPHER_UNSUPPORTED',
    );
    expectDiagnostic(
      await parse('MATCH (`bad' + del + 'name`:function)-[:calls]->(target:function) RETURN target.name'),
      'CYPHER_UNSUPPORTED',
    );
  });

  it('rejects Unicode escape forms inside backtick identifiers instead of decoding them', async () => {
    expectDiagnostic(
      await parse('MATCH (`bad\\u006e`:function)-[:calls]->(target:function) RETURN target.name'),
      'CYPHER_UNSUPPORTED',
    );
    expectDiagnostic(
      await parse('MATCH (`bad\\U0000006e`:function)-[:calls]->(target:function) RETURN target.name'),
      'CYPHER_UNSUPPORTED',
    );
  });

  it('keeps public names exact and case-sensitive after backtick unescaping', async () => {
    expectDiagnostic(
      await parse('MATCH (n:`Function`)-[:`calls`]->(m:function) RETURN n'),
      'CYPHER_UNKNOWN_LABEL',
    );
    expectDiagnostic(
      await parse('MATCH (n:function)-[:`CALLS`]->(m:function) RETURN n'),
      'CYPHER_UNKNOWN_RELATIONSHIP_TYPE',
    );
    expectDiagnostic(
      await parse('MATCH (n:function)-[:calls]->(m:function) RETURN n.`Name`'),
      'CYPHER_UNKNOWN_PROPERTY',
    );
  });

  it('does not normalize Unicode identifiers or aliases before comparing names', async () => {
    const decomposed = 'e\u0301';
    const precomposed = '\u00e9';
    const exact = expectParseSuccess(await parse(
      'MATCH (`' + decomposed + '`:function)-[:calls]->(target:function) RETURN `' + decomposed + '`.name AS `' + decomposed + 'Alias`',
    ));

    expect(exact.match.nodes[0]?.variable).toBe(decomposed);
    expect(exact.returns).toEqual([{ expression: decomposed + '.name', alias: decomposed + 'Alias' }]);
    expectDiagnostic(
      await parse('MATCH (`' + decomposed + '`:function)-[:calls]->(target:function) RETURN `' + precomposed + '`.name'),
      'CYPHER_UNKNOWN_VARIABLE',
    );
    expectDiagnostic(
      await parse(
        'MATCH (`' + decomposed + '`:function)-[:calls]->(target:function) ' +
          'RETURN `' + decomposed + '`.name AS `' + decomposed + 'Alias` ORDER BY `' + precomposed + 'Alias`',
      ),
      'CYPHER_UNKNOWN_VARIABLE',
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
    expect(planned.boundParameters.slice(0, 1)).toEqual(["can't\\stop"]);
    expect(planned.boundParameters.slice(-1)).toEqual([101]);
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
