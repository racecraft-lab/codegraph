import {
  executeCypherSqlForTests,
  getCypherRuntimeStateForTests as getCypherRuntimeBoundaryStateForTests,
} from './runtime';
import type { CypherPerformancePlanEvidence, CypherRuntimeQueryPlanProbe } from './runtime';
import { serializeCypherResult } from './serializer';
import { CYPHER_MAX_INPUT_CODE_UNITS, CYPHER_RUNTIME_DEADLINE_MS } from './limits';

type TokenKind = 'identifier' | 'integer' | 'string' | 'punctuation' | 'eof';

type RelationshipDirection = 'outgoing' | 'incoming';

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

export type CypherDiagnosticResult = CypherDiagnostic;

export type CypherColumn = {
  readonly name: string;
};

export type CypherNode = {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly filePath: string;
  readonly language: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly docstring: string | null;
  readonly signature: string | null;
  readonly visibility: string | null;
  readonly isExported: boolean | null;
  readonly isAsync: boolean | null;
  readonly isStatic: boolean | null;
  readonly isAbstract: boolean | null;
  readonly decorators: readonly unknown[] | null;
  readonly typeParameters: readonly unknown[] | null;
  readonly returnType: string | null;
};

export type CypherRelationship = {
  readonly source: string;
  readonly target: string;
  readonly kind: string;
  readonly metadata: Record<string, unknown> | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly provenance: string | null;
};

export type CypherPath = {
  readonly nodes: readonly CypherNode[];
  readonly relationships: readonly CypherRelationship[];
  readonly length: number;
};

export type CypherScalar = null | boolean | number | string | Record<string, unknown> | readonly unknown[];

export type CypherNodeValue = { readonly type: 'node'; readonly value: CypherNode };
export type CypherRelationshipValue = { readonly type: 'relationship'; readonly value: CypherRelationship };
export type CypherPathValue = { readonly type: 'path'; readonly value: CypherPath };
export type CypherScalarValue = { readonly type: 'scalar'; readonly value: CypherScalar };

export type CypherValue = CypherNodeValue | CypherRelationshipValue | CypherPathValue | CypherScalarValue;

export type CypherRow = Record<string, CypherValue>;

export type CypherSuccessResult = {
  readonly status: 'success';
  readonly columns: readonly CypherColumn[];
  readonly rows: readonly CypherRow[];
  readonly effectiveCap: number;
  readonly truncated: boolean;
};

export type CypherTimeoutResult = {
  readonly status: 'timeout';
  readonly code: 'CYPHER_TIMEOUT';
  readonly deadlineMs: 5000;
  readonly guidance: string;
};

export type CypherQueryResult = CypherSuccessResult | CypherDiagnosticResult | CypherTimeoutResult;

export type CypherRuntimeTestOptions = {
  readonly payloadLimitBytes?: number;
  readonly onSqlPrepare?: (sql: string) => void;
  readonly onQueryPlan?: (evidence: CypherPerformancePlanEvidence) => void;
  readonly onRowsInspected?: (count: number) => void;
  readonly onRowsMaterialized?: (count: number) => void;
};

type CypherParseSuccess = {
  readonly status: 'success';
  readonly match: {
    readonly pathVariable?: string;
    readonly nodes: readonly AstNodePattern[];
    readonly relationships: readonly AstRelationshipPattern[];
  };
  readonly where?: AstWhereClause;
  readonly returns: readonly AstReturnItem[];
  readonly groupingKeys: readonly string[];
  readonly orderBy: readonly AstOrderItem[];
  readonly limit?: number;
  readonly literals: readonly AstLiteral[];
};

type CypherParseResult = CypherParseSuccess | CypherDiagnostic;

type CypherPlanSuccess = {
  readonly status: 'success';
  readonly sql: string;
  readonly boundParameters: readonly unknown[];
  readonly pathExpansionGuard?: number;
};

type CypherPlanResult = CypherPlanSuccess | CypherDiagnostic;

type Token = {
  readonly kind: TokenKind;
  readonly raw: string;
  readonly value: string;
  readonly offset: number;
  readonly line: number;
  readonly column: number;
};

type AstLiteral = {
  readonly raw: string;
  readonly decoded: string;
  readonly offset: number;
  readonly bindingIndex: number;
};

type AstNodePattern = {
  readonly variable?: string;
  readonly label?: string;
  readonly properties?: Record<string, unknown>;
};

type AstRelationshipPattern = {
  readonly variable?: string;
  readonly type?: string;
  readonly direction: RelationshipDirection;
  readonly range?: {
    readonly lower: number;
    readonly upper: number;
  };
};

type AstReturnItem = {
  readonly expression: string;
  readonly alias?: string;
  readonly aggregate?: AstAggregateExpression;
};

type AstAggregateExpression = {
  readonly function: 'count';
  readonly argument: '*' | string;
};

type AstWhereClause = {
  readonly text: string;
  readonly tokens: readonly Token[];
};

type AstOrderItem = {
  readonly expression: string;
  readonly direction: 'ASC' | 'DESC';
};

type LexSuccess = {
  readonly tokens: readonly Token[];
  readonly literals: readonly AstLiteral[];
};

type VariableBindingKind = 'node' | 'relationship' | 'relationship-list' | 'path';
type PropertyScope = 'node' | 'relationship';
type ExpressionAccess = 'bare' | 'property';

const MAX_EXCERPT_LENGTH = 160;
const MAX_VARIABLE_RELATIONSHIP_DEPTH = 8;
const DEFAULT_RESULT_CAP = 100;
const HARD_RESULT_CAP = 1000;
const VARIABLE_PATH_FRONTIER_MULTIPLIER = 16;
const INTERNAL_PATH_START_COLUMN = '__cg_start_node_id';
const INTERNAL_PATH_CURRENT_COLUMN = '__cg_current_node_id';
const INTERNAL_PATH_EDGE_IDS_COLUMN = '__cg_visited_edge_ids';
const INTERNAL_PATH_FRONTIER_COUNT_COLUMN = '__cg_path_frontier_count';
const INTERNAL_PATH_FRONTIER_SENTINEL_COLUMN = '__cg_path_frontier_sentinel';
const INTERNAL_AGGREGATE_RESULT_ORDER_COLUMN = '__cg_aggregate_result_order';
const INTERNAL_RELATIONSHIP_STORAGE_ID_FIELD = '__cgStorageId';

const PUBLIC_NODE_LABELS = new Set([
  'file',
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
  'parameter',
  'import',
  'export',
  'route',
  'component',
]);

const PUBLIC_RELATIONSHIP_TYPES = new Set([
  'contains',
  'calls',
  'imports',
  'exports',
  'extends',
  'implements',
  'references',
  'type_of',
  'returns',
  'instantiates',
  'overrides',
  'decorates',
]);

const NODE_PROPERTY_COLUMNS: Readonly<Record<string, string>> = {
  id: 'id',
  kind: 'kind',
  name: 'name',
  qualifiedName: 'qualified_name',
  filePath: 'file_path',
  language: 'language',
  startLine: 'start_line',
  endLine: 'end_line',
  startColumn: 'start_column',
  endColumn: 'end_column',
  docstring: 'docstring',
  signature: 'signature',
  visibility: 'visibility',
  isExported: 'is_exported',
  isAsync: 'is_async',
  isStatic: 'is_static',
  isAbstract: 'is_abstract',
  decorators: 'decorators',
  typeParameters: 'type_parameters',
  returnType: 'return_type',
};

const RELATIONSHIP_PROPERTY_COLUMNS: Readonly<Record<string, string>> = {
  source: 'source',
  target: 'target',
  kind: 'kind',
  metadata: 'metadata',
  line: 'line',
  column: 'col',
  provenance: 'provenance',
};

const PUBLIC_NODE_PROPERTIES = new Set(Object.keys(NODE_PROPERTY_COLUMNS));
const PUBLIC_RELATIONSHIP_PROPERTIES = new Set(Object.keys(RELATIONSHIP_PROPERTY_COLUMNS));
const OPAQUE_NODE_RETURN_ONLY_PROPERTIES = new Set(['decorators', 'typeParameters']);
const OPAQUE_RELATIONSHIP_RETURN_ONLY_PROPERTIES = new Set(['metadata']);

const SQL_ENTRYPOINT_KEYWORDS = new Set([
  'SELECT',
  'WITH',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'PRAGMA',
  'ATTACH',
  'DETACH',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
]);

const UNSUPPORTED_OPENCYPHER_CLAUSE_KEYWORDS = new Set([
  'CALL',
  'LOAD',
  'OPTIONAL',
  'UNION',
  'UNWIND',
  'USING',
  'WITH',
  'YIELD',
]);

const WRITE_CLAUSE_KEYWORDS = new Set([
  'CREATE',
  'DELETE',
  'DETACH',
  'MERGE',
  'REMOVE',
  'SET',
]);

const CLAUSE_BOUNDARY_KEYWORDS = new Set(['RETURN', 'ORDER', 'LIMIT']);

class DiagnosticThrown {
  constructor(readonly diagnostic: CypherDiagnostic) {}
}

class WhereSyntaxError extends Error {
  constructor(
    readonly tokenIndex: number,
    readonly expected: string,
  ) {
    super(`Invalid WHERE expression: expected ${expected}.`);
  }
}

type RuntimeStringPredicateOperator = 'STARTS WITH' | 'ENDS WITH' | 'CONTAINS';

type SqlOperand = {
  readonly sql: string;
  readonly parameters: readonly unknown[];
};

class Lexer {
  private readonly tokens: Token[] = [];
  private readonly literals: AstLiteral[] = [];
  private offset = 0;
  private line = 1;
  private column = 0;

  constructor(private readonly input: string) {}

  lex(): LexSuccess | CypherDiagnostic {
    try {
      while (!this.isAtEnd()) {
        this.scanToken();
      }
      this.tokens.push({
        kind: 'eof',
        raw: '',
        value: '',
        offset: this.offset,
        line: this.line,
        column: this.column,
      });
      return { tokens: this.tokens, literals: this.literals };
    } catch (error) {
      if (error instanceof DiagnosticThrown) {
        return error.diagnostic;
      }
      throw error;
    }
  }

  private scanToken(): void {
    const current = this.peek();
    if (current === undefined) {
      return;
    }

    if (this.consumeWhitespace(current)) {
      return;
    }

    if (current === "'") {
      this.scanSingleQuotedString();
      return;
    }

    if (current === '"') {
      this.failAtCurrent(
        'CYPHER_UNSUPPORTED_STRING_LITERAL',
        'single-quoted string literal',
        'stringLiteral',
        'Double-quoted string literals are not supported.',
      );
    }

    if (current === '`') {
      this.scanBacktickIdentifier();
      return;
    }

    if (isAsciiIdentifierStart(current)) {
      this.scanBareIdentifier();
      return;
    }

    if (isAsciiDigit(current)) {
      this.scanInteger();
      return;
    }

    if (current === '$') {
      this.failAtCurrent(
        'CYPHER_EXTERNAL_PARAMETER_UNSUPPORTED',
        'literal value',
        'parameter',
        'External Cypher parameters are not supported; use literal values in the bounded query text.',
      );
    }

    if ('()[]{}:,.=*+-<>'.includes(current)) {
      this.addToken('punctuation', current, current);
      this.advanceCodeUnit();
      return;
    }

    this.failAtCurrent(
      'CYPHER_SYNTAX',
      'Cypher token',
      'lexer',
      `Unsupported character ${JSON.stringify(current)}.`,
    );
  }

  private consumeWhitespace(current: string): boolean {
    if (current === ' ' || current === '\t' || current === '\f' || current === '\v') {
      this.advanceCodeUnit();
      return true;
    }

    if (current === '\r') {
      this.offset += this.peek(1) === '\n' ? 2 : 1;
      this.line += 1;
      this.column = 0;
      return true;
    }

    if (current === '\n') {
      this.advanceLineFeed();
      return true;
    }

    return false;
  }

  private scanBareIdentifier(): void {
    const startOffset = this.offset;
    const startColumn = this.column;
    while (!this.isAtEnd()) {
      const current = this.peek();
      if (current === undefined || !isAsciiIdentifierPart(current)) {
        break;
      }
      this.advanceCodeUnit();
    }
    const value = this.input.slice(startOffset, this.offset);
    this.tokens.push({
      kind: 'identifier',
      raw: value,
      value,
      offset: startOffset,
      line: this.line,
      column: startColumn,
    });
  }

  private scanBacktickIdentifier(): void {
    const startOffset = this.offset;
    const startLine = this.line;
    const startColumn = this.column;
    let value = '';
    this.advanceCodeUnit();

    while (!this.isAtEnd()) {
      const current = this.peek();
      if (current === undefined) {
        break;
      }

      if (current === '`') {
        if (this.peek(1) === '`') {
          value += '`';
          this.advanceCodeUnit();
          this.advanceCodeUnit();
          continue;
        }

        this.advanceCodeUnit();
        this.tokens.push({
          kind: 'identifier',
          raw: this.input.slice(startOffset, this.offset),
          value,
          offset: startOffset,
          line: startLine,
          column: startColumn,
        });
        return;
      }

      if (current === '\\' && (this.peek(1) === 'u' || this.peek(1) === 'U')) {
        this.failAt(
          startOffset,
          startLine,
          startColumn,
          'CYPHER_UNSUPPORTED',
          'identifier',
          'identifier',
          'Unicode escape forms inside identifiers are not supported.',
        );
      }

      const codeUnit = current.charCodeAt(0);
      if (codeUnit < 0x20 || codeUnit === 0x7f) {
        this.failAt(
          startOffset,
          startLine,
          startColumn,
          'CYPHER_UNSUPPORTED',
          'identifier',
          'identifier',
          'Control characters inside identifiers are not supported.',
        );
      }

      value += current;
      this.advanceCodeUnit();
    }

    this.failAt(
      startOffset,
      startLine,
      startColumn,
      'CYPHER_SYNTAX',
      'closing backtick',
      'identifier',
      'Unterminated backtick identifier.',
    );
  }

  private scanInteger(): void {
    const startOffset = this.offset;
    const startColumn = this.column;
    while (!this.isAtEnd()) {
      const current = this.peek();
      if (current === undefined || !isAsciiDigit(current)) {
        break;
      }
      this.advanceCodeUnit();
    }
    const value = this.input.slice(startOffset, this.offset);
    this.tokens.push({
      kind: 'integer',
      raw: value,
      value,
      offset: startOffset,
      line: this.line,
      column: startColumn,
    });
  }

  private scanSingleQuotedString(): void {
    const startOffset = this.offset;
    const startLine = this.line;
    const startColumn = this.column;
    let decoded = '';
    this.advanceCodeUnit();

    while (!this.isAtEnd()) {
      const current = this.peek();
      if (current === undefined) {
        break;
      }

      if (current === "'") {
        this.advanceCodeUnit();
        const raw = this.input.slice(startOffset, this.offset);
        const literal: AstLiteral = {
          raw,
          decoded,
          offset: startOffset,
          bindingIndex: this.literals.length,
        };
        this.literals.push(literal);
        this.tokens.push({
          kind: 'string',
          raw,
          value: decoded,
          offset: startOffset,
          line: startLine,
          column: startColumn,
        });
        return;
      }

      if (current === '\\') {
        decoded += this.scanStringEscape(startOffset, startLine, startColumn);
        continue;
      }

      const codeUnit = current.charCodeAt(0);
      if (codeUnit < 0x20) {
        this.failAt(
          startOffset,
          startLine,
          startColumn,
          'CYPHER_UNSUPPORTED_STRING_LITERAL',
          'valid single-quoted string literal',
          'stringLiteral',
          'Raw control characters are not supported inside string literals.',
        );
      }

      decoded += current;
      this.advanceCodeUnit();
    }

    this.failAt(
      startOffset,
      startLine,
      startColumn,
      'CYPHER_UNSUPPORTED_STRING_LITERAL',
      'closing single quote',
      'stringLiteral',
      'Unterminated string literal.',
    );
  }

  private scanStringEscape(startOffset: number, startLine: number, startColumn: number): string {
    this.advanceCodeUnit();
    const escaped = this.peek();
    if (escaped === undefined) {
      this.failAt(
        startOffset,
        startLine,
        startColumn,
        'CYPHER_UNSUPPORTED_STRING_LITERAL',
        'complete string escape',
        'stringLiteral',
        'Incomplete string escape.',
      );
    }

    if (escaped === 'u') {
      this.failAt(
        startOffset,
        startLine,
        startColumn,
        'CYPHER_UNSUPPORTED_STRING_LITERAL',
        'supported string escape',
        'stringLiteral',
        'Unicode string escapes are not supported.',
      );
    }

    const decoded = decodeSupportedStringEscape(escaped);
    if (decoded === undefined) {
      this.failAt(
        startOffset,
        startLine,
        startColumn,
        'CYPHER_UNSUPPORTED_STRING_LITERAL',
        'supported string escape',
        'stringLiteral',
        'Unsupported string escape.',
      );
    }

    this.advanceCodeUnit();
    return decoded;
  }

  private addToken(kind: TokenKind, raw: string, value: string): void {
    this.tokens.push({
      kind,
      raw,
      value,
      offset: this.offset,
      line: this.line,
      column: this.column,
    });
  }

  private advanceCodeUnit(): void {
    this.offset += 1;
    this.column += 1;
  }

  private advanceLineFeed(): void {
    this.offset += 1;
    this.line += 1;
    this.column = 0;
  }

  private isAtEnd(): boolean {
    return this.offset >= this.input.length;
  }

  private peek(relativeOffset = 0): string | undefined {
    const target = this.offset + relativeOffset;
    return target < this.input.length ? this.input.charAt(target) : undefined;
  }

  private failAtCurrent(code: string, expected: string, anchor: string, message: string): never {
    this.failAt(this.offset, this.line, this.column, code, expected, anchor, message);
  }

  private failAt(
    offset: number,
    line: number,
    column: number,
    code: string,
    expected: string,
    anchor: string,
    message: string,
  ): never {
    throw new DiagnosticThrown(makeDiagnostic(this.input, offset, line, column, code, expected, anchor, message));
  }
}

class Parser {
  private index = 0;
  private rangedRelationshipCount = 0;
  private readonly variableBindings = new Map<string, VariableBindingKind>();
  private readonly returnAliases = new Set<string>();

  constructor(
    private readonly input: string,
    private readonly tokens: readonly Token[],
    private readonly literals: readonly AstLiteral[],
  ) {}

  parse(): CypherParseResult {
    try {
      return this.parseQuery();
    } catch (error) {
      if (error instanceof DiagnosticThrown) {
        return error.diagnostic;
      }
      throw error;
    }
  }

  private parseQuery(): CypherParseSuccess {
    if (this.isAtKeyword('OPTIONAL')) {
      this.failUnsupportedOpenCypherClause('MATCH', 'matchClause');
    }

    if (!this.isAtKeyword('MATCH')) {
      const current = this.current();
      const keyword = current.kind === 'identifier' ? current.value.toUpperCase() : '';
      if (SQL_ENTRYPOINT_KEYWORDS.has(keyword)) {
        this.failToken(
          current,
          'CYPHER_DIRECT_SQL_UNSUPPORTED',
          'MATCH query',
          'query',
          'Direct SQL input is not supported in Cypher mode.',
        );
      }
      this.failToken(current, 'CYPHER_SYNTAX', 'MATCH', 'query', 'Cypher queries must start with MATCH.');
    }

    const match = this.parseMatchClause();
    const where = this.isAtKeyword('WHERE') ? this.parseWhereClause() : undefined;

    if (this.isAtKeyword('MATCH')) {
      this.failCurrent(
        'CYPHER_MULTI_MATCH_UNSUPPORTED',
        'single MATCH clause',
        'matchClause',
        'Multiple MATCH clauses are not supported.',
      );
    }

    if (this.isAtUnsupportedOpenCypherClause()) {
      this.failUnsupportedOpenCypherClause('RETURN clause', 'query');
    }

    if (this.isAtWriteClause()) {
      this.failCurrent(
        'CYPHER_UNSUPPORTED_CLAUSE',
        'RETURN clause',
        'query',
        'Write clauses are not supported.',
      );
    }

    const returns = this.parseReturnClause();
    const groupingKeys = uniqueStrings(
      returns.filter((item) => item.aggregate === undefined).map((item) => item.expression),
    );

    const orderBy = this.isAtKeyword('ORDER') ? this.parseOrderByClause() : [];
    const limit = this.isAtKeyword('LIMIT') ? this.parseLimitClause() : undefined;

    if (this.isAtKeyword('MATCH')) {
      this.failCurrent(
        'CYPHER_MULTI_MATCH_UNSUPPORTED',
        'end of query',
        'query',
        'Multiple MATCH clauses are not supported.',
      );
    }

    this.consumeEof();

    const result: CypherParseSuccess = {
      status: 'success',
      match,
      returns,
      groupingKeys,
      orderBy,
      ...(limit === undefined ? {} : { limit }),
      literals: this.literals,
    };
    return where === undefined ? result : { ...result, where };
  }

  private parseMatchClause(): CypherParseSuccess['match'] {
    this.consumeKeyword('MATCH', 'MATCH', 'matchClause');

    const pathVariableToken = this.peekIdentifierBeforeEquals();
    if (pathVariableToken !== undefined) {
      this.advance();
      this.declareVariable(pathVariableToken, 'path', 'pathBinding');
      this.consumePunctuation('=', '"=" after path variable', 'pathBinding');
    }

    const nodes: AstNodePattern[] = [this.parseNodePattern()];
    const relationships: AstRelationshipPattern[] = [];

    while (this.startsRelationshipPattern()) {
      relationships.push(this.parseRelationshipPattern());
      nodes.push(this.parseNodePattern());
    }

    if (this.isAtPunctuation(',')) {
      this.failCurrent(
        'CYPHER_COMMA_PATTERN_UNSUPPORTED',
        'single connected pattern',
        'matchClause',
        'Comma-separated patterns are not supported.',
      );
    }

    if (this.isAtPunctuation('(')) {
      this.failCurrent(
        'CYPHER_DISCONNECTED_PATTERN',
        'connected relationship pattern',
        'matchClause',
        'Disconnected node patterns are not supported.',
      );
    }

    if (this.isAtKeyword('MATCH')) {
      this.failCurrent(
        'CYPHER_MULTI_MATCH_UNSUPPORTED',
        'single MATCH clause',
        'matchClause',
        'Multiple MATCH clauses are not supported.',
      );
    }

    if (this.isAtUnsupportedOpenCypherClause()) {
      this.failUnsupportedOpenCypherClause('RETURN clause', 'matchClause');
    }

    if (this.isAtWriteClause()) {
      this.failCurrent(
        'CYPHER_UNSUPPORTED_CLAUSE',
        'RETURN clause',
        'matchClause',
        'Write clauses are not supported.',
      );
    }

    if (relationships.length === 0 && pathVariableToken !== undefined) {
      this.failToken(
        pathVariableToken,
        'CYPHER_DISCONNECTED_PATTERN',
        'connected relationship pattern',
        'matchClause',
        'Path variables require one connected node-relationship chain.',
      );
    }

    const match = { nodes, relationships };
    const pathVariable = pathVariableToken?.value;
    return pathVariable === undefined ? match : { ...match, pathVariable };
  }

  private parseNodePattern(): AstNodePattern {
    this.consumePunctuation('(', '"(" to start node pattern', 'nodePattern');

    const variableToken = this.isAtIdentifier() ? this.advance() : undefined;
    const variable = variableToken?.value;
    const label = this.isAtPunctuation(':') ? this.parseNodeLabel() : undefined;
    const properties = this.isAtPunctuation('{') ? this.parsePropertyMap('node') : undefined;

    this.consumePunctuation(')', '")" to close node pattern', 'nodePattern');

    if (variableToken !== undefined) {
      this.declareVariable(variableToken, 'node', 'nodePattern');
    }

    const node: AstNodePattern = {};
    if (variable !== undefined) {
      return properties === undefined
        ? { ...node, variable, ...(label === undefined ? {} : { label }) }
        : { ...node, variable, ...(label === undefined ? {} : { label }), properties };
    }
    return properties === undefined
      ? { ...node, ...(label === undefined ? {} : { label }) }
      : { ...node, ...(label === undefined ? {} : { label }), properties };
  }

  private parseRelationshipPattern(): AstRelationshipPattern {
    if (this.isAtPunctuation('-') && this.peekPunctuation(1, '[')) {
      return this.parseOutgoingRelationship();
    }

    if (this.isAtPunctuation('<') && this.peekPunctuation(1, '-') && this.peekPunctuation(2, '[')) {
      return this.parseIncomingRelationship();
    }

    this.failCurrent(
      'CYPHER_SYNTAX',
      'directed relationship pattern',
      'relationshipPattern',
      'Expected directed relationship pattern.',
    );
  }

  private parseOutgoingRelationship(): AstRelationshipPattern {
    this.consumePunctuation('-', '"-" before relationship pattern', 'relationshipPattern');
    const relationship = this.parseBracketedRelationship('outgoing');
    this.consumePunctuation('-', '"-" after relationship pattern', 'relationshipPattern');

    if (!this.isAtPunctuation('>')) {
      this.failCurrent(
        'CYPHER_UNDIRECTED_RELATIONSHIP',
        'directed relationship arrow',
        'relationshipPattern',
        'Undirected relationships are not supported.',
      );
    }
    this.advance();
    return relationship;
  }

  private parseIncomingRelationship(): AstRelationshipPattern {
    this.consumePunctuation('<', '"<" before incoming relationship pattern', 'relationshipPattern');
    this.consumePunctuation('-', '"-" before incoming relationship pattern', 'relationshipPattern');
    const relationship = this.parseBracketedRelationship('incoming');
    this.consumePunctuation('-', '"-" after incoming relationship pattern', 'relationshipPattern');
    return relationship;
  }

  private parseBracketedRelationship(direction: RelationshipDirection): AstRelationshipPattern {
    this.consumePunctuation('[', '"[" to start relationship pattern', 'relationshipPattern');

    const variableToken = this.isAtIdentifier() ? this.advance() : undefined;
    const variable = variableToken?.value;
    const type = this.isAtPunctuation(':') ? this.parseRelationshipType() : undefined;
    let range: AstRelationshipPattern['range'];
    if (this.isAtPunctuation('*')) {
      if (this.rangedRelationshipCount > 0) {
        this.failCurrent(
          'CYPHER_UNSUPPORTED',
          'at most one ranged relationship segment',
          'relationshipPattern',
          'Multiple ranged relationship segments are not supported.',
        );
      }
      this.rangedRelationshipCount += 1;
      range = this.parseRange();
    }

    this.consumePunctuation(']', '"]" to close relationship pattern', 'relationshipPattern');

    if (variableToken !== undefined) {
      this.declareVariable(
        variableToken,
        range === undefined ? 'relationship' : 'relationship-list',
        'relationshipPattern',
      );
    }

    return {
      ...(variable === undefined ? {} : { variable }),
      ...(type === undefined ? {} : { type }),
      direction,
      ...(range === undefined ? {} : { range }),
    };
  }

  private parseRange(): AstRelationshipPattern['range'] {
    const star = this.consumePunctuation('*', '"*" to start variable relationship range', 'range');
    const lowerToken = this.isAtInteger() ? this.advance() : undefined;
    const lower = lowerToken === undefined ? 1 : Number(lowerToken.value);

    if (!this.isAtPunctuation('.') || !this.peekPunctuation(1, '.')) {
      this.failToken(
        star,
        'CYPHER_UNBOUNDED_PATH',
        'bounded upper relationship range',
        'range',
        'Variable relationships require an explicit upper bound.',
      );
    }

    this.advance();
    this.advance();

    if (!this.isAtInteger()) {
      this.failCurrent(
        'CYPHER_UNBOUNDED_PATH',
        'upper relationship range',
        'range',
        'Variable relationships require an explicit upper bound.',
      );
    }

    const upperToken = this.advance();
    const upper = Number(upperToken.value);
    if (lower < 1) {
      this.failToken(
        lowerToken ?? star,
        'CYPHER_UNBOUNDED_PATH',
        'relationship range lower bound >= 1',
        'range',
        'Variable relationship lower bound must be at least 1 in the supported subset.',
      );
    }
    if (lower > upper) {
      this.failToken(
        lowerToken ?? upperToken,
        'CYPHER_UNBOUNDED_PATH',
        'relationship range lower bound <= upper bound',
        'range',
        'Variable relationship lower bound cannot exceed the upper bound.',
      );
    }
    if (upper > MAX_VARIABLE_RELATIONSHIP_DEPTH) {
      this.failToken(
        upperToken,
        'CYPHER_PATH_TOO_DEEP',
        `relationship range upper bound <= ${MAX_VARIABLE_RELATIONSHIP_DEPTH}`,
        'range',
        'Variable relationship upper bound exceeds the supported maximum.',
      );
    }

    return { lower, upper };
  }

  private parsePropertyMap(scope: PropertyScope): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    this.consumePunctuation('{', '"{" to start property map', 'propertyMap');

    while (!this.isAtPunctuation('}')) {
      const keyToken = this.consumeIdentifier('property name', 'propertyMap');
      this.validatePropertyName(scope, keyToken, 'propertyMap');
      this.consumePunctuation(':', '":" after property name', 'propertyMap');
      properties[keyToken.value] = this.parsePropertyValue();

      if (!this.isAtPunctuation(',')) {
        break;
      }
      this.advance();
    }

    this.consumePunctuation('}', '"}" to close property map', 'propertyMap');
    return properties;
  }

  private parsePropertyValue(): unknown {
    if (this.isAtString()) {
      return this.advance().value;
    }
    if (this.isAtInteger()) {
      return Number(this.advance().value);
    }
    if (this.isAtKeyword('TRUE')) {
      this.advance();
      return true;
    }
    if (this.isAtKeyword('FALSE')) {
      this.advance();
      return false;
    }
    if (this.isAtKeyword('NULL')) {
      this.advance();
      return null;
    }

    this.failCurrent(
      'CYPHER_SYNTAX',
      'property literal value',
      'propertyMap',
      'Expected a supported property literal value.',
    );
  }

  private parseWhereClause(): AstWhereClause {
    const start = this.consumeKeyword('WHERE', 'WHERE', 'whereClause');
    const expressionTokens: Token[] = [];

    while (!this.isAtEof() && !this.isAtKeyword('RETURN')) {
      if (this.isAtKeyword('MATCH')) {
        this.failCurrent(
          'CYPHER_MULTI_MATCH_UNSUPPORTED',
          'RETURN clause',
          'whereClause',
          'Multiple MATCH clauses are not supported.',
        );
      }
      if (this.isAtWriteClause()) {
        this.failCurrent(
          'CYPHER_UNSUPPORTED_CLAUSE',
          'read-only expression',
          'whereClause',
          'Write clauses are not supported.',
        );
      }
      expressionTokens.push(this.advance());
    }

    if (expressionTokens.length === 0) {
      this.failToken(start, 'CYPHER_SYNTAX', 'WHERE expression', 'whereClause', 'WHERE requires an expression.');
    }

    this.validatePropertyAccesses(expressionTokens, 'whereClause');
    try {
      new WhereSqlEmitter(expressionTokens, {
        nodeAliases: new Map(),
        relationshipAliases: new Map(),
        pathAliases: new Map(),
        parameters: [],
      }).emit();
    } catch (error) {
      if (error instanceof WhereSyntaxError) {
        const token = expressionTokens[error.tokenIndex] ?? this.current();
        this.failToken(
          token,
          'CYPHER_SYNTAX',
          error.expected,
          'whereClause',
          `Invalid WHERE expression; expected ${error.expected}.`,
        );
      }
      throw error;
    }
    return {
      text: expressionTokens.map((token) => token.raw).join(' '),
      tokens: expressionTokens,
    };
  }

  private parseReturnClause(): AstReturnItem[] {
    this.consumeKeyword('RETURN', 'RETURN', 'returnClause');

    if (this.isAtKeyword('DISTINCT')) {
      this.failCurrent(
        'CYPHER_UNSUPPORTED_CLAUSE',
        'return expression',
        'returnClause',
        'DISTINCT is not supported.',
      );
    }

    const returns: AstReturnItem[] = [];
    returns.push(this.parseReturnItem());

    while (this.isAtPunctuation(',')) {
      this.advance();
      returns.push(this.parseReturnItem());
    }

    return returns;
  }

  private parseReturnItem(): AstReturnItem {
    const aggregate = this.parseAggregateReturnExpression();
    const expression = aggregate?.expression ?? this.parseExpression('returnClause');
    if (this.isAtKeyword('AS')) {
      this.advance();
      const alias = this.consumeIdentifier('alias identifier', 'returnClause').value;
      this.returnAliases.add(alias);
      return aggregate === undefined ? { expression, alias } : { expression, alias, aggregate: aggregate.aggregate };
    }
    return aggregate === undefined ? { expression } : { expression, aggregate: aggregate.aggregate };
  }

  private parseAggregateReturnExpression(): { readonly expression: string; readonly aggregate: AstAggregateExpression } | undefined {
    const functionToken = this.current();
    if (functionToken.kind !== 'identifier' || !this.peekPunctuation(1, '(')) {
      return undefined;
    }

    this.advance();
    this.consumePunctuation('(', '"(" after aggregate function', 'returnClause');

    const functionName = functionToken.value.toLowerCase();
    if (functionName !== 'count') {
      this.failToken(
        functionToken,
        'CYPHER_UNSUPPORTED_AGGREGATION',
        'count(*) or count(expression)',
        'returnClause',
        'Only count aggregation is supported.',
      );
    }

    if (this.isAtKeyword('DISTINCT')) {
      this.failCurrent(
        'CYPHER_UNSUPPORTED_CLAUSE',
        'count argument without DISTINCT',
        'returnClause',
        'DISTINCT is not supported.',
      );
    }

    const argument = this.isAtPunctuation('*') ? this.advance().value : this.parseExpression('returnClause');
    this.consumePunctuation(')', '")" after aggregate argument', 'returnClause');

    const aggregate: AstAggregateExpression = {
      function: 'count',
      argument: argument === '*' ? '*' : argument,
    };
    return {
      expression: `count(${aggregate.argument})`,
      aggregate,
    };
  }

  private parseOrderByClause(): AstOrderItem[] {
    this.consumeKeyword('ORDER', 'ORDER', 'orderByClause');
    this.consumeKeyword('BY', 'BY', 'orderByClause');
    const orderBy: AstOrderItem[] = [{
      expression: this.parseExpression('orderByClause'),
      direction: this.consumeOptionalSortDirection(),
    }];

    while (this.isAtPunctuation(',')) {
      this.advance();
      orderBy.push({
        expression: this.parseExpression('orderByClause'),
        direction: this.consumeOptionalSortDirection(),
      });
    }

    return orderBy;
  }

  private consumeOptionalSortDirection(): 'ASC' | 'DESC' {
    if (this.isAtKeyword('DESC')) {
      this.advance();
      return 'DESC';
    }
    if (this.isAtKeyword('ASC')) {
      this.advance();
    }
    return 'ASC';
  }

  private parseLimitClause(): number {
    this.consumeKeyword('LIMIT', 'LIMIT', 'limitClause');
    if (!this.isAtInteger()) {
      this.failCurrent('CYPHER_SYNTAX', 'integer LIMIT', 'limitClause', 'LIMIT requires an integer.');
    }
    return Number(this.advance().value);
  }

  private parseExpression(anchor: string): string {
    if (!this.isAtIdentifier()) {
      this.failCurrent('CYPHER_SYNTAX', 'expression', anchor, 'Expected an expression.');
    }

    const rootToken = this.advance();
    const parts: string[] = [rootToken.value];
    let access: ExpressionAccess = 'bare';
    while (this.isAtPunctuation('.')) {
      this.advance();
      parts.push('.');
      const propertyToken = this.consumeIdentifier('property identifier', anchor);
      this.validatePropertyAccess(rootToken, propertyToken, anchor);
      access = 'property';
      parts.push(propertyToken.value);
    }
    this.validateExpressionRoot(rootToken, anchor, access);
    return parts.join('');
  }

  private parseNodeLabel(): string {
    this.consumePunctuation(':', '":"', 'label');
    const labelToken = this.consumeIdentifier('node label', 'label');
    if (!PUBLIC_NODE_LABELS.has(labelToken.value)) {
      this.failToken(
        labelToken,
        'CYPHER_UNKNOWN_LABEL',
        'public node label',
        'label',
        'Unknown public node label.',
      );
    }
    return labelToken.value;
  }

  private parseRelationshipType(): string {
    this.consumePunctuation(':', '":"', 'relationshipType');
    const typeToken = this.consumeIdentifier('relationship type', 'relationshipType');
    if (!PUBLIC_RELATIONSHIP_TYPES.has(typeToken.value)) {
      this.failToken(
        typeToken,
        'CYPHER_UNKNOWN_RELATIONSHIP_TYPE',
        'public relationship type',
        'relationshipType',
        'Unknown public relationship type.',
      );
    }
    return typeToken.value;
  }

  private validatePropertyAccesses(tokens: readonly Token[], anchor: string): void {
    for (let tokenIndex = 0; tokenIndex < tokens.length - 2; tokenIndex += 1) {
      const variableToken = tokens[tokenIndex];
      const dotToken = tokens[tokenIndex + 1];
      const propertyToken = tokens[tokenIndex + 2];
      if (
        variableToken?.kind === 'identifier' &&
        dotToken?.kind === 'punctuation' &&
        dotToken.value === '.' &&
        propertyToken?.kind === 'identifier'
      ) {
        this.validatePropertyAccess(variableToken, propertyToken, anchor);
        this.validateExpressionRoot(variableToken, anchor, 'property');
      }
    }
  }

  private validateExpressionRoot(rootToken: Token, anchor: string, access: ExpressionAccess): void {
    const bindingKind = this.variableBindings.get(rootToken.value);
    if (bindingKind !== undefined) {
      if (bindingKind === 'path' && access === 'property') {
        this.failToken(
          rootToken,
          'CYPHER_UNSUPPORTED',
          'node or relationship property access',
          anchor,
          'Path variables do not support property access.',
        );
      }
      if (bindingKind === 'relationship-list' && access === 'property') {
        this.failToken(
          rootToken,
          'CYPHER_UNSUPPORTED',
          'bare ranged relationship variable',
          anchor,
          'Ranged relationship variables are relationship lists and do not support property access.',
        );
      }
      return;
    }

    if (this.returnAliases.has(rootToken.value)) {
      return;
    }

    this.failToken(
      rootToken,
      'CYPHER_UNKNOWN_VARIABLE',
      'declared variable or alias',
      anchor,
      'Unknown variable or alias.',
    );
  }

  private validatePropertyAccess(variableToken: Token, propertyToken: Token, anchor: string): void {
    const bindingKind = this.variableBindings.get(variableToken.value);
    if (bindingKind === 'node') {
      this.validatePropertyName('node', propertyToken, anchor);
      return;
    }
    if (bindingKind === 'relationship') {
      this.validatePropertyName('relationship', propertyToken, anchor);
    }
  }

  private validatePropertyName(scope: PropertyScope, propertyToken: Token, anchor: string): void {
    const allowedProperties = scope === 'node' ? PUBLIC_NODE_PROPERTIES : PUBLIC_RELATIONSHIP_PROPERTIES;
    if (!allowedProperties.has(propertyToken.value)) {
      this.failToken(
        propertyToken,
        'CYPHER_UNKNOWN_PROPERTY',
        'public property',
        anchor,
        'Unknown public property.',
      );
    }
    this.validateOpaquePropertyUsage(scope, propertyToken, anchor);
  }

  private validateOpaquePropertyUsage(scope: PropertyScope, propertyToken: Token, anchor: string): void {
    if (anchor === 'returnClause') {
      return;
    }

    const opaqueProperties =
      scope === 'node' ? OPAQUE_NODE_RETURN_ONLY_PROPERTIES : OPAQUE_RELATIONSHIP_RETURN_ONLY_PROPERTIES;
    if (!opaqueProperties.has(propertyToken.value)) {
      return;
    }

    this.failToken(
      propertyToken,
      'CYPHER_UNSUPPORTED_OPAQUE_FILTER',
      'scalar predicateable property',
      anchor,
      'Opaque JSON and array properties may only be returned whole.',
    );
  }

  private declareVariable(token: Token, kind: VariableBindingKind, anchor: string): void {
    if (this.variableBindings.has(token.value)) {
      this.failToken(
        token,
        'CYPHER_DUPLICATE_VARIABLE',
        'unique variable declaration',
        anchor,
        'Node, relationship, and path declaration names must be unique.',
      );
    }
    this.variableBindings.set(token.value, kind);
  }

  private peekIdentifierBeforeEquals(): Token | undefined {
    const current = this.current();
    return current.kind === 'identifier' && this.peekPunctuation(1, '=') ? current : undefined;
  }

  private startsRelationshipPattern(): boolean {
    return (
      (this.isAtPunctuation('-') && this.peekPunctuation(1, '[')) ||
      (this.isAtPunctuation('<') && this.peekPunctuation(1, '-') && this.peekPunctuation(2, '['))
    );
  }

  private consumeKeyword(keyword: string, expected: string, anchor: string): Token {
    if (this.isAtKeyword(keyword)) {
      return this.advance();
    }
    this.failCurrent('CYPHER_SYNTAX', expected, anchor, `Expected ${keyword}.`);
  }

  private consumePunctuation(punctuation: string, expected: string, anchor: string): Token {
    if (this.isAtPunctuation(punctuation)) {
      return this.advance();
    }
    this.failCurrent('CYPHER_SYNTAX', expected, anchor, `Expected ${expected}.`);
  }

  private consumeIdentifier(expected: string, anchor: string): Token {
    if (this.isAtIdentifier()) {
      return this.advance();
    }
    this.failCurrent('CYPHER_SYNTAX', expected, anchor, `Expected ${expected}.`);
  }

  private consumeEof(): void {
    if (!this.isAtEof()) {
      const current = this.current();
      const keyword = current.kind === 'identifier' ? current.value.toUpperCase() : '';
      if (WRITE_CLAUSE_KEYWORDS.has(keyword)) {
        this.failToken(
          current,
          'CYPHER_UNSUPPORTED_CLAUSE',
          'end of read-only query',
          'query',
          'Write clauses are not supported.',
        );
      }
      if (keyword === 'MATCH') {
        this.failToken(
          current,
          'CYPHER_MULTI_MATCH_UNSUPPORTED',
          'end of query',
          'query',
          'Multiple MATCH clauses are not supported.',
        );
      }
      if (UNSUPPORTED_OPENCYPHER_CLAUSE_KEYWORDS.has(keyword)) {
        this.failToken(
          current,
          'CYPHER_UNSUPPORTED_OPENCYPHER',
          'supported Cypher subset',
          'query',
          `${current.value.toUpperCase()} is not supported in the CodeGraph Cypher subset.`,
        );
      }
      this.failToken(current, 'CYPHER_SYNTAX', 'end of query', 'query', 'Unexpected trailing input.');
    }
  }

  private isAtKeyword(keyword: string): boolean {
    const current = this.current();
    return current.kind === 'identifier' && current.value.toUpperCase() === keyword;
  }

  private isAtWriteClause(): boolean {
    const current = this.current();
    return current.kind === 'identifier' && WRITE_CLAUSE_KEYWORDS.has(current.value.toUpperCase());
  }

  private isAtUnsupportedOpenCypherClause(): boolean {
    const current = this.current();
    return current.kind === 'identifier' && UNSUPPORTED_OPENCYPHER_CLAUSE_KEYWORDS.has(current.value.toUpperCase());
  }

  private failUnsupportedOpenCypherClause(expected: string, anchor: string): never {
    const current = this.current();
    this.failToken(
      current,
      'CYPHER_UNSUPPORTED_OPENCYPHER',
      expected,
      anchor,
      `${current.value.toUpperCase()} is not supported in the CodeGraph Cypher subset.`,
    );
  }

  private isAtIdentifier(): boolean {
    const current = this.current();
    return current.kind === 'identifier' && !CLAUSE_BOUNDARY_KEYWORDS.has(current.value.toUpperCase());
  }

  private isAtInteger(): boolean {
    return this.current().kind === 'integer';
  }

  private isAtString(): boolean {
    return this.current().kind === 'string';
  }

  private isAtPunctuation(punctuation: string): boolean {
    const current = this.current();
    return current.kind === 'punctuation' && current.value === punctuation;
  }

  private peekPunctuation(relativeIndex: number, punctuation: string): boolean {
    const token = this.tokens[this.index + relativeIndex];
    return token?.kind === 'punctuation' && token.value === punctuation;
  }

  private isAtEof(): boolean {
    return this.current().kind === 'eof';
  }

  private current(): Token {
    const current = this.tokens[this.index];
    if (current !== undefined) {
      return current;
    }
    return this.tokens[this.tokens.length - 1]!;
  }

  private advance(): Token {
    const current = this.current();
    if (!this.isAtEof()) {
      this.index += 1;
    }
    return current;
  }

  private failCurrent(code: string, expected: string, anchor: string, message: string): never {
    this.failToken(this.current(), code, expected, anchor, message);
  }

  private failToken(token: Token, code: string, expected: string, anchor: string, message: string): never {
    throw new DiagnosticThrown(
      makeDiagnostic(this.input, token.offset, token.line, token.column, code, expected, anchor, message),
    );
  }
}

function isAsciiIdentifierStart(value: string): boolean {
  const code = value.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || value === '_';
}

function isAsciiIdentifierPart(value: string): boolean {
  return isAsciiIdentifierStart(value) || isAsciiDigit(value);
}

function isAsciiDigit(value: string): boolean {
  const code = value.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function decodeSupportedStringEscape(value: string): string | undefined {
  switch (value) {
    case "'":
      return "'";
    case '\\':
      return '\\';
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    case 'b':
      return '\b';
    case 'f':
      return '\f';
    default:
      return undefined;
  }
}

function makeDiagnostic(
  input: string,
  offset: number,
  line: number,
  column: number,
  code: string,
  expected: string,
  anchor: string,
  message: string,
): CypherDiagnostic {
  const excerpt = buildExcerpt(input, offset);
  return {
    status: 'diagnostic',
    code,
    message,
    offset,
    line,
    column,
    expected,
    anchor,
    excerpt: excerpt.text,
    truncatedBefore: excerpt.truncatedBefore,
    truncatedAfter: excerpt.truncatedAfter,
  };
}

function makeInputTooLongDiagnostic(): CypherDiagnostic {
  return makeDiagnostic(
    '',
    0,
    1,
    0,
    'CYPHER_INPUT_TOO_LONG',
    `query text <= ${CYPHER_MAX_INPUT_CODE_UNITS} UTF-16 code units`,
    'cli-input',
    `Cypher input exceeds the ${CYPHER_MAX_INPUT_CODE_UNITS} UTF-16 code unit ceiling.`,
  );
}

function buildExcerpt(input: string, offset: number): {
  readonly text: string;
  readonly truncatedBefore: boolean;
  readonly truncatedAfter: boolean;
} {
  const lineStart = Math.max(input.lastIndexOf('\n', offset - 1) + 1, 0);
  const nextLineFeed = input.indexOf('\n', offset);
  const lineEnd = nextLineFeed === -1 ? input.length : nextLineFeed;
  const lineText = input.slice(lineStart, lineEnd).replace(/\r$/, '');
  const relativeOffset = Math.max(offset - lineStart, 0);
  const escapedLine = escapeExcerptLine(lineText);
  const escapedRelativeOffset = escapeExcerptLine(lineText.slice(0, relativeOffset)).length;

  if (escapedLine.length <= MAX_EXCERPT_LENGTH) {
    return {
      text: escapedLine,
      truncatedBefore: false,
      truncatedAfter: false,
    };
  }

  const halfWindow = Math.floor(MAX_EXCERPT_LENGTH / 2);
  const start = Math.max(0, Math.min(escapedRelativeOffset - halfWindow, escapedLine.length - MAX_EXCERPT_LENGTH));
  const end = Math.min(escapedLine.length, start + MAX_EXCERPT_LENGTH);
  return {
    text: escapedLine.slice(start, end),
    truncatedBefore: start > 0,
    truncatedAfter: end < escapedLine.length,
  };
}

function escapeExcerptLine(value: string): string {
  let escaped = '';
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charAt(index);
    if (current === "'" || current === '"') {
      escaped += `${current}<redacted>${current}`;
      index = consumeQuotedExcerpt(value, index, current) - 1;
      continue;
    }
    escaped += escapeExcerptChar(current);
  }
  return escaped;
}

function consumeQuotedExcerpt(value: string, start: number, quote: string): number {
  for (let index = start + 1; index < value.length; index += 1) {
    const current = value.charAt(index);
    if (current === '\\') {
      index += 1;
      continue;
    }
    if (current === quote) {
      return index + 1;
    }
  }
  return value.length;
}

function escapeExcerptChar(value: string): string {
  switch (value) {
    case '\0':
      return '\\0';
    case '\t':
      return '\\t';
    case '\r':
      return '\\r';
    case '\n':
      return '\\n';
    default:
      return value;
  }
}

function lex(input: string): LexSuccess | CypherDiagnostic {
  return new Lexer(input).lex();
}

function parseCypher(input: string): CypherParseResult {
  const lexed = lex(input);
  if (isDiagnosticResult(lexed)) {
    return lexed;
  }
  return new Parser(input, lexed.tokens, lexed.literals).parse();
}

type SqlEmitContext = {
  readonly nodeAliases: ReadonlyMap<string, string>;
  readonly relationshipAliases: ReadonlyMap<string, string>;
  readonly pathAliases: ReadonlyMap<string, string>;
  readonly publicPathIdentityAliases?: ReadonlyMap<string, string>;
  readonly publicRelationshipSequenceIdentityAliases?: ReadonlyMap<string, string>;
  readonly publicMatchIdentityExpression?: string;
  readonly parameters: unknown[];
};

function createRangedFrontierContext(
  base: SqlEmitContext,
  publicPathIdentityExpression: string,
  publicRelationshipIdentityExpression: string,
  pathVariable: string | undefined,
  relationshipVariable: string | undefined,
): SqlEmitContext {
  const publicPathIdentityAliases = new Map<string, string>();
  if (pathVariable !== undefined) {
    publicPathIdentityAliases.set(pathVariable, publicPathIdentityExpression);
  }
  const publicRelationshipSequenceIdentityAliases = new Map<string, string>();
  if (relationshipVariable !== undefined) {
    publicRelationshipSequenceIdentityAliases.set(
      relationshipVariable,
      publicRelationshipIdentityExpression,
    );
  }
  return {
    ...base,
    publicPathIdentityAliases,
    publicRelationshipSequenceIdentityAliases,
    publicMatchIdentityExpression: publicPathIdentityExpression,
  };
}

function emitParameterizedSql(parsed: CypherParseSuccess): CypherPlanSuccess {
  const variableRelationshipIndex = parsed.match.relationships.findIndex((relationship) => relationship.range !== undefined);
  const plan =
    variableRelationshipIndex === -1
      ? emitFixedRelationshipSql(parsed)
      : emitVariableRelationshipSql(parsed, variableRelationshipIndex);

  assertGeneratedSqlIsReadOnly(plan.sql);
  return plan;
}

function emitFixedRelationshipSql(parsed: CypherParseSuccess): CypherPlanSuccess {
  const parameters: unknown[] = [];
  const nodeAliases = createNodeAliasMap(parsed.match.nodes);
  const relationshipAliases = createRelationshipAliasMap(parsed.match.relationships);
  const pathEdgeIdsExpression = emitEdgeIdListExpression(
    parsed.match.relationships.map((_relationship, relationshipIndex) => `e${relationshipIndex}`),
  );
  const pathAliases = new Map<string, string>();
  if (parsed.match.pathVariable !== undefined) {
    pathAliases.set(parsed.match.pathVariable, pathEdgeIdsExpression);
  }
  const context: SqlEmitContext = {
    nodeAliases,
    relationshipAliases,
    pathAliases,
    parameters,
  };
  const capPlan = createCapPlan(parsed.limit);

  const selectList = parsed.returns.map((item) => {
    return `${emitReturnItemExpression(item, context)} AS ${quoteIdentifier(item.alias ?? item.expression)}`;
  });
  const outputSelectList = hasAggregateReturns(parsed)
    ? selectList
    : [
        ...selectList,
        `n0.id AS ${quoteIdentifier(INTERNAL_PATH_START_COLUMN)}`,
        `n${parsed.match.nodes.length - 1}.id AS ${quoteIdentifier(INTERNAL_PATH_CURRENT_COLUMN)}`,
        `${pathEdgeIdsExpression} AS ${quoteIdentifier(INTERNAL_PATH_EDGE_IDS_COLUMN)}`,
      ];
  const lines = [`SELECT ${outputSelectList.join(', ')}`, 'FROM nodes n0'];

  parsed.match.relationships.forEach((relationship, relationshipIndex) => {
    const edgeAlias = `e${relationshipIndex}`;
    const leftNodeAlias = `n${relationshipIndex}`;
    const rightNodeAlias = `n${relationshipIndex + 1}`;
    const indexName = edgeIndexNameForDirection(relationship.direction);
    const edgeSourcePredicate = `${edgeAlias}.${edgeAnchorColumn(relationship.direction)} = ${leftNodeAlias}.id`;
    const nextNodePredicate = `${edgeAlias}.${edgeNextColumn(relationship.direction)} = ${rightNodeAlias}.id`;
    const edgePredicates = [
      edgeSourcePredicate,
      relationship.type === undefined ? undefined : `${edgeAlias}.kind = ${sqlStringLiteral(relationship.type)}`,
      activeEdgePredicate(edgeAlias),
    ].filter(isPresent);

    lines.push(`JOIN edges ${edgeAlias} INDEXED BY ${indexName} ON ${edgePredicates.join(' AND ')}`);
    lines.push(`JOIN nodes ${rightNodeAlias} ON ${nextNodePredicate}`);
  });

  const wherePredicates = [
    ...parsed.match.nodes.flatMap((node, nodeIndex) => emitNodePatternPredicates(node, `n${nodeIndex}`, parameters)),
    ...emitFixedRelationshipUniquenessPredicates(parsed.match.relationships.length),
    ...emitWherePredicates(parsed.where, context),
  ];
  if (wherePredicates.length > 0) {
    lines.push(`WHERE ${wherePredicates.join(' AND ')}`);
  }
  const groupByClause = emitGroupByClause(parsed, context);
  if (groupByClause !== undefined) {
    lines.push(`GROUP BY ${groupByClause}`);
  }
  lines.push(`ORDER BY ${emitOrderByClause(parsed, context)}`);
  parameters.push(capPlan.probeLimit);
  lines.push('LIMIT ?');
  lines.push(capPlan.comment);

  return {
    status: 'success',
    sql: lines.join('\n'),
    boundParameters: parameters,
  };
}

function emitVariableRelationshipSql(
  parsed: CypherParseSuccess,
  relationshipIndex: number,
): CypherPlanSuccess {
  const relationship = parsed.match.relationships[relationshipIndex];
  const range = relationship?.range;
  if (relationship === undefined || range === undefined) {
    throw new Error('Internal SPEC-013 planner invariant violated: missing variable relationship range.');
  }
  if (parsed.match.relationships.length > 1) {
    return emitMixedVariableRelationshipSql(parsed, relationshipIndex, relationship, range);
  }

  const parameters: unknown[] = [];
  const startNode = parsed.match.nodes[relationshipIndex];
  const endNode = parsed.match.nodes[relationshipIndex + 1];
  const nodeAliases = createNodeAliasMap(parsed.match.nodes);
  const pathAliases = new Map<string, string>();
  if (parsed.match.pathVariable !== undefined) {
    pathAliases.set(parsed.match.pathVariable, 'cg_bounded_paths.visited_edge_ids');
  }
  if (relationship.variable !== undefined) {
    pathAliases.set(relationship.variable, 'cg_bounded_paths.visited_edge_ids');
  }
  const publicPathIdentityAliases = new Map<string, string>();
  if (parsed.match.pathVariable !== undefined) {
    publicPathIdentityAliases.set(parsed.match.pathVariable, 'cg_bounded_paths.public_identity');
  }
  const publicRelationshipSequenceIdentityAliases = new Map<string, string>();
  if (relationship.variable !== undefined) {
    publicRelationshipSequenceIdentityAliases.set(
      relationship.variable,
      'cg_bounded_paths.relationship_identity',
    );
  }
  const context: SqlEmitContext = {
    nodeAliases,
    relationshipAliases: new Map<string, string>(),
    pathAliases,
    publicPathIdentityAliases,
    publicRelationshipSequenceIdentityAliases,
    publicMatchIdentityExpression: 'cg_bounded_paths.public_identity',
    parameters,
  };
  const boundedPathAliases = new Map<string, string>();
  if (parsed.match.pathVariable !== undefined) {
    boundedPathAliases.set(parsed.match.pathVariable, 'cg_path_0.visited_edge_ids');
  }
  if (relationship.variable !== undefined) {
    boundedPathAliases.set(relationship.variable, 'cg_path_0.visited_edge_ids');
  }
  const boundedPublicPathIdentityAliases = new Map<string, string>();
  if (parsed.match.pathVariable !== undefined) {
    boundedPublicPathIdentityAliases.set(parsed.match.pathVariable, 'cg_path_0.public_identity');
  }
  const boundedPublicRelationshipSequenceIdentityAliases = new Map<string, string>();
  if (relationship.variable !== undefined) {
    boundedPublicRelationshipSequenceIdentityAliases.set(
      relationship.variable,
      'cg_path_0.relationship_identity',
    );
  }
  const boundedContext: SqlEmitContext = {
    nodeAliases,
    relationshipAliases: new Map<string, string>(),
    pathAliases: boundedPathAliases,
    publicPathIdentityAliases: boundedPublicPathIdentityAliases,
    publicRelationshipSequenceIdentityAliases: boundedPublicRelationshipSequenceIdentityAliases,
    publicMatchIdentityExpression: 'cg_path_0.public_identity',
    parameters,
  };
  const capPlan = createCapPlan(parsed.limit);
  const aggregatesReturns = hasAggregateReturns(parsed);
  const frontierGuard =
    HARD_RESULT_CAP * Math.max(1, range.upper) * VARIABLE_PATH_FRONTIER_MULTIPLIER;
  const outputGuard = aggregatesReturns ? frontierGuard : capPlan.probeLimit;
  const edgeAlias = `e${relationshipIndex}`;
  const edgeIndexName = edgeIndexNameForDirection(relationship.direction);
  const seedEdgePredicates = [
    `${edgeAlias}.${edgeAnchorColumn(relationship.direction)} = n0.id`,
    relationship.type === undefined ? undefined : `${edgeAlias}.kind = ${sqlStringLiteral(relationship.type)}`,
    activeEdgePredicate(edgeAlias),
  ].filter(isPresent);
  const edgeAnchorPredicate = `${edgeAlias}.${edgeAnchorColumn(relationship.direction)} = cg_path_0.current_node_id`;
  const nextNodeExpression = `${edgeAlias}.${edgeNextColumn(relationship.direction)}`;
  const recursiveEdgePredicates = [
    edgeAnchorPredicate,
    relationship.type === undefined ? undefined : `${edgeAlias}.kind = ${sqlStringLiteral(relationship.type)}`,
    activeEdgePredicate(edgeAlias),
    `instr(cg_path_0.visited_edge_ids, ',' || ${edgeAlias}.id || ',') = 0`,
  ].filter(isPresent);
  const seedPublicIdentity = emitVariablePathIdentitySeed('n0.id', edgeAlias, nextNodeExpression);
  const recursivePublicIdentity = emitVariablePathIdentityAppend(
    'cg_path_0.public_identity',
    edgeAlias,
    nextNodeExpression,
  );
  const seedRelationshipIdentity = emitRelationshipSequenceIdentitySeed(edgeAlias);
  const recursiveRelationshipIdentity = emitRelationshipSequenceIdentityAppend(
    'cg_path_0.relationship_identity',
    edgeAlias,
  );
  const selectList = parsed.returns.map((item) => {
    return `${emitReturnItemExpression(item, context)} AS ${quoteIdentifier(item.alias ?? item.expression)}`;
  });
  const internalSelectList = [
    `cg_bounded_paths.start_node_id AS ${quoteIdentifier(INTERNAL_PATH_START_COLUMN)}`,
    `cg_bounded_paths.current_node_id AS ${quoteIdentifier(INTERNAL_PATH_CURRENT_COLUMN)}`,
    `cg_bounded_paths.visited_edge_ids AS ${quoteIdentifier(INTERNAL_PATH_EDGE_IDS_COLUMN)}`,
  ];
  const outputSelectList = aggregatesReturns ? selectList : [...selectList, ...internalSelectList];
  const guardedResultRowsName = aggregatesReturns ? 'cg_aggregate_rows' : 'cg_result_rows';
  const guardedOutputColumnNames = [
    ...parsed.returns.map((item) => item.alias ?? item.expression),
    ...(aggregatesReturns
      ? []
      : [INTERNAL_PATH_START_COLUMN, INTERNAL_PATH_CURRENT_COLUMN, INTERNAL_PATH_EDGE_IDS_COLUMN]),
  ];
  const guardedOutputSelectList = guardedOutputColumnNames.map((columnName) => {
    const column = quoteIdentifier(columnName);
    return `${guardedResultRowsName}.${column} AS ${column}`;
  });
  const guardedSentinelSelectList = guardedOutputColumnNames.map((columnName) => {
    return `NULL AS ${quoteIdentifier(columnName)}`;
  });
  const startNodePredicates = emitNodePatternPredicates(startNode, 'n0', parameters);
  const orderByClause = emitOrderByClause(parsed, context);
  const boundedOrderByClause = aggregatesReturns
    ? emitVariablePathIdentityOrder('cg_path_0')
    : emitOrderByClause(parsed, boundedContext);
  const seedFrontierContext = createRangedFrontierContext(
    boundedContext,
    seedPublicIdentity,
    seedRelationshipIdentity,
    parsed.match.pathVariable,
    relationship.variable,
  );
  const recursiveFrontierContext = createRangedFrontierContext(
    boundedContext,
    recursivePublicIdentity,
    recursiveRelationshipIdentity,
    parsed.match.pathVariable,
    relationship.variable,
  );
  const seedFrontierOrderTerms = aggregatesReturns
    ? []
    : emitRangedFrontierOrderTerms(parsed, seedFrontierContext);
  const recursiveFrontierOrderTerms = aggregatesReturns
    ? []
    : emitRangedFrontierOrderTerms(parsed, recursiveFrontierContext);
  const frontierOrderColumns = seedFrontierOrderTerms.map((_term, index) => `frontier_order_${index}`);

  parameters.push(range.upper);
  parameters.push(frontierGuard + 1);
  parameters.push(range.lower);
  parameters.push(range.upper);
  const finalWherePredicates = [
    ...emitNodePatternPredicates(endNode, `n${relationshipIndex + 1}`, parameters),
    ...emitWherePredicates(parsed.where, boundedContext),
  ].filter(isPresent);
  parameters.push(outputGuard);

  const lines = [
    `WITH RECURSIVE cg_path_0(${[
      'depth',
      'start_node_id',
      'current_node_id',
      'visited_edge_ids',
      'public_identity',
      'relationship_identity',
      ...frontierOrderColumns,
    ].join(', ')}) AS (`,
    `  SELECT ${[
      '1',
      'n0.id',
      nextNodeExpression,
      `',' || ${edgeAlias}.id || ','`,
      seedPublicIdentity,
      seedRelationshipIdentity,
      ...seedFrontierOrderTerms.map((term) => term.expression),
    ].join(', ')}`,
    '  FROM nodes n0',
    `  JOIN edges ${edgeAlias} INDEXED BY ${edgeIndexName} ON ${seedEdgePredicates.join(' AND ')}`,
    `  JOIN nodes n1 ON n1.id = ${nextNodeExpression}`,
    startNodePredicates.length === 0 ? undefined : `  WHERE ${startNodePredicates.join(' AND ')}`,
    '  UNION ALL',
    `  SELECT ${[
      'cg_path_0.depth + 1',
      'cg_path_0.start_node_id',
      nextNodeExpression,
      `cg_path_0.visited_edge_ids || ${edgeAlias}.id || ','`,
      recursivePublicIdentity,
      recursiveRelationshipIdentity,
      ...recursiveFrontierOrderTerms.map((term) => term.expression),
    ].join(', ')}`,
    '  FROM cg_path_0',
    '  JOIN nodes n0 ON n0.id = cg_path_0.start_node_id',
    `  JOIN edges ${edgeAlias} INDEXED BY ${edgeIndexName} ON ${recursiveEdgePredicates.join(' AND ')}`,
    `  JOIN nodes n1 ON n1.id = ${nextNodeExpression}`,
    '  WHERE cg_path_0.depth < ?',
    aggregatesReturns
      ? '  ORDER BY 5 ASC'
      : `  ORDER BY ${emitRangedFrontierOrderByClause(recursiveFrontierOrderTerms, 7)}`,
    '  LIMIT ?',
    '),',
    'cg_bounded_paths AS (',
    '  SELECT cg_path_0.*',
    '  FROM cg_path_0',
    '  JOIN nodes n0 ON n0.id = cg_path_0.start_node_id',
    `  JOIN nodes n${relationshipIndex + 1} ON n${relationshipIndex + 1}.id = cg_path_0.current_node_id`,
    `  WHERE ${['cg_path_0.depth BETWEEN ? AND ?', ...finalWherePredicates].join(' AND ')}`,
    `  ORDER BY ${boundedOrderByClause}`,
    '  LIMIT ?',
    '),',
    `${guardedResultRowsName} AS (`,
    `  SELECT ${[
      ...outputSelectList,
      `row_number() OVER (ORDER BY ${orderByClause}) AS ${quoteIdentifier(INTERNAL_AGGREGATE_RESULT_ORDER_COLUMN)}`,
    ].join(', ')}`,
    '  FROM cg_bounded_paths',
    '  JOIN nodes n0 ON n0.id = cg_bounded_paths.start_node_id',
    `  JOIN nodes n${relationshipIndex + 1} ON n${relationshipIndex + 1}.id = cg_bounded_paths.current_node_id`,
    emitGroupByClause(parsed, context) === undefined
      ? undefined
      : `  GROUP BY ${emitGroupByClause(parsed, context)}`,
    `  ORDER BY ${orderByClause}`,
    '  LIMIT ?',
    '),',
    `cg_path_frontier AS (SELECT count(*) AS ${quoteIdentifier(INTERNAL_PATH_FRONTIER_COUNT_COLUMN)} FROM cg_path_0)`,
    `SELECT ${[
      ...guardedSentinelSelectList,
      `cg_path_frontier.${quoteIdentifier(INTERNAL_PATH_FRONTIER_COUNT_COLUMN)} AS ${quoteIdentifier(INTERNAL_PATH_FRONTIER_COUNT_COLUMN)}`,
      `1 AS ${quoteIdentifier(INTERNAL_PATH_FRONTIER_SENTINEL_COLUMN)}`,
      `0 AS ${quoteIdentifier(INTERNAL_AGGREGATE_RESULT_ORDER_COLUMN)}`,
    ].join(', ')}`,
    'FROM cg_path_frontier',
    'UNION ALL',
    `SELECT ${[
      ...guardedOutputSelectList,
      `cg_path_frontier.${quoteIdentifier(INTERNAL_PATH_FRONTIER_COUNT_COLUMN)} AS ${quoteIdentifier(INTERNAL_PATH_FRONTIER_COUNT_COLUMN)}`,
      `0 AS ${quoteIdentifier(INTERNAL_PATH_FRONTIER_SENTINEL_COLUMN)}`,
      `${guardedResultRowsName}.${quoteIdentifier(INTERNAL_AGGREGATE_RESULT_ORDER_COLUMN)} AS ${quoteIdentifier(INTERNAL_AGGREGATE_RESULT_ORDER_COLUMN)}`,
    ].join(', ')}`,
    `FROM ${guardedResultRowsName} CROSS JOIN cg_path_frontier`,
    `ORDER BY ${quoteIdentifier(INTERNAL_PATH_FRONTIER_SENTINEL_COLUMN)} DESC, ${quoteIdentifier(INTERNAL_AGGREGATE_RESULT_ORDER_COLUMN)} ASC`,
    capPlan.comment,
  ].filter(isPresent);
  parameters.push(capPlan.probeLimit);

  return {
    status: 'success',
    sql: lines.join('\n'),
    boundParameters: parameters,
    pathExpansionGuard: frontierGuard,
  };
}

function emitMixedVariableRelationshipSql(
  parsed: CypherParseSuccess,
  relationshipIndex: number,
  variableRelationship: AstRelationshipPattern,
  range: NonNullable<AstRelationshipPattern['range']>,
): CypherPlanSuccess {
  const parameters: unknown[] = [];
  const capPlan = createCapPlan(parsed.limit);
  const aggregatesReturns = hasAggregateReturns(parsed);
  const frontierGuard =
    HARD_RESULT_CAP * Math.max(1, range.upper) * VARIABLE_PATH_FRONTIER_MULTIPLIER;
  const finalNodeIndex = parsed.match.nodes.length - 1;
  const variableEdgeAlias = `e${relationshipIndex}`;
  const prefixEdgeAliases = parsed.match.relationships
    .slice(0, relationshipIndex)
    .map((_relationship, index) => `e${index}`);
  const suffixEdgeAliases = parsed.match.relationships
    .slice(relationshipIndex + 1)
    .map((_relationship, index) => `e${relationshipIndex + 1 + index}`);
  const prefixNodeIdColumns = Array.from(
    { length: relationshipIndex + 1 },
    (_value, index) => `node_${index}_id`,
  );
  const prefixEdgeIdColumns = prefixEdgeAliases.map((_alias, index) => `edge_${index}_id`);
  const cteColumns = [
    'depth',
    ...prefixNodeIdColumns,
    ...prefixEdgeIdColumns,
    'current_node_id',
    'current_edge_id',
    'variable_edge_ids',
    'visited_edge_ids',
    'public_identity',
    'relationship_identity',
  ];

  const seedLines = ['  FROM nodes n0'];
  for (let index = 0; index < relationshipIndex; index += 1) {
    const fixedRelationship = parsed.match.relationships[index];
    if (fixedRelationship === undefined) {
      continue;
    }
    const edgeAlias = `e${index}`;
    const edgePredicates = [
      `${edgeAlias}.${edgeAnchorColumn(fixedRelationship.direction)} = n${index}.id`,
      fixedRelationship.type === undefined ? undefined : `${edgeAlias}.kind = ${sqlStringLiteral(fixedRelationship.type)}`,
      activeEdgePredicate(edgeAlias),
      ...prefixEdgeAliases.slice(0, index).map((priorAlias) => `${edgeAlias}.id <> ${priorAlias}.id`),
    ].filter(isPresent);
    seedLines.push(
      `  JOIN edges ${edgeAlias} INDEXED BY ${edgeIndexNameForDirection(fixedRelationship.direction)} ON ${edgePredicates.join(' AND ')}`,
      `  JOIN nodes n${index + 1} ON ${edgeAlias}.${edgeNextColumn(fixedRelationship.direction)} = n${index + 1}.id`,
    );
  }

  const variableSeedPredicates = [
    `${variableEdgeAlias}.${edgeAnchorColumn(variableRelationship.direction)} = n${relationshipIndex}.id`,
    variableRelationship.type === undefined
      ? undefined
      : `${variableEdgeAlias}.kind = ${sqlStringLiteral(variableRelationship.type)}`,
    activeEdgePredicate(variableEdgeAlias),
    ...prefixEdgeAliases.map((priorAlias) => `${variableEdgeAlias}.id <> ${priorAlias}.id`),
  ].filter(isPresent);
  seedLines.push(
    `  JOIN edges ${variableEdgeAlias} INDEXED BY ${edgeIndexNameForDirection(variableRelationship.direction)} ON ${variableSeedPredicates.join(' AND ')}`,
    `  JOIN nodes n${relationshipIndex + 1} ON n${relationshipIndex + 1}.id = ${variableEdgeAlias}.${edgeNextColumn(variableRelationship.direction)}`,
  );

  const seedNodePredicates = parsed.match.nodes
    .slice(0, relationshipIndex + 1)
    .flatMap((node, index) => emitNodePatternPredicates(node, `n${index}`, parameters));
  const seedVisitedEdgeIds = emitEdgeIdListExpression([...prefixEdgeAliases, variableEdgeAlias]);
  const variableNextNodeExpression =
    `${variableEdgeAlias}.${edgeNextColumn(variableRelationship.direction)}`;
  const seedPublicIdentity = emitMixedVariablePathIdentitySeed(
    relationshipIndex,
    variableEdgeAlias,
    variableNextNodeExpression,
  );
  const seedRelationshipIdentity = emitRelationshipSequenceIdentitySeed(variableEdgeAlias);
  const seedSelectValues = [
    '1',
    ...prefixNodeIdColumns.map((_column, index) => `n${index}.id`),
    ...prefixEdgeAliases.map((alias) => `${alias}.id`),
    variableNextNodeExpression,
    `${variableEdgeAlias}.id`,
    `',' || ${variableEdgeAlias}.id || ','`,
    seedVisitedEdgeIds,
    seedPublicIdentity,
    seedRelationshipIdentity,
  ];

  parameters.push(range.upper);
  parameters.push(frontierGuard + 1);

  const outerJoinLines: string[] = [];
  for (let index = 0; index <= relationshipIndex; index += 1) {
    outerJoinLines.push(`JOIN nodes n${index} ON n${index}.id = cg_path_0.node_${index}_id`);
  }
  for (let index = 0; index < relationshipIndex; index += 1) {
    outerJoinLines.push(`JOIN edges e${index} ON e${index}.id = cg_path_0.edge_${index}_id`);
  }
  outerJoinLines.push(
    `JOIN edges ${variableEdgeAlias} ON ${variableEdgeAlias}.id = cg_path_0.current_edge_id`,
    `JOIN nodes n${relationshipIndex + 1} ON n${relationshipIndex + 1}.id = cg_path_0.current_node_id`,
  );

  let usedEdgeIdsExpression = 'cg_path_0.visited_edge_ids';
  for (let index = relationshipIndex + 1; index < parsed.match.relationships.length; index += 1) {
    const fixedRelationship = parsed.match.relationships[index];
    if (fixedRelationship === undefined) {
      continue;
    }
    const edgeAlias = `e${index}`;
    const edgePredicates = [
      `${edgeAlias}.${edgeAnchorColumn(fixedRelationship.direction)} = n${index}.id`,
      fixedRelationship.type === undefined ? undefined : `${edgeAlias}.kind = ${sqlStringLiteral(fixedRelationship.type)}`,
      activeEdgePredicate(edgeAlias),
      `instr(${usedEdgeIdsExpression}, ',' || ${edgeAlias}.id || ',') = 0`,
    ].filter(isPresent);
    outerJoinLines.push(
      `JOIN edges ${edgeAlias} INDEXED BY ${edgeIndexNameForDirection(fixedRelationship.direction)} ON ${edgePredicates.join(' AND ')}`,
      `JOIN nodes n${index + 1} ON ${edgeAlias}.${edgeNextColumn(fixedRelationship.direction)} = n${index + 1}.id`,
    );
    usedEdgeIdsExpression = `${usedEdgeIdsExpression} || ${edgeAlias}.id || ','`;
  }

  const nodeAliases = createNodeAliasMap(parsed.match.nodes);
  const relationshipAliases = createRelationshipAliasMap(parsed.match.relationships);
  const fullVisitedEdgeIds = suffixEdgeAliases.length === 0
    ? 'cg_path_0.visited_edge_ids'
    : `cg_path_0.visited_edge_ids ${suffixEdgeAliases.map((alias) => `|| ${alias}.id || ','`).join(' ')}`;
  let fullPublicIdentity = 'cg_path_0.public_identity';
  for (let index = relationshipIndex + 1; index < parsed.match.relationships.length; index += 1) {
    fullPublicIdentity = emitVariablePathIdentityAppend(
      fullPublicIdentity,
      `e${index}`,
      `n${index + 1}.id`,
    );
  }
  const pathAliases = new Map<string, string>();
  if (parsed.match.pathVariable !== undefined) {
    pathAliases.set(parsed.match.pathVariable, fullVisitedEdgeIds);
  }
  if (variableRelationship.variable !== undefined) {
    pathAliases.set(variableRelationship.variable, 'cg_path_0.variable_edge_ids');
  }
  const publicPathIdentityAliases = new Map<string, string>();
  if (parsed.match.pathVariable !== undefined) {
    publicPathIdentityAliases.set(parsed.match.pathVariable, fullPublicIdentity);
  }
  const publicRelationshipSequenceIdentityAliases = new Map<string, string>();
  if (variableRelationship.variable !== undefined) {
    publicRelationshipSequenceIdentityAliases.set(
      variableRelationship.variable,
      'cg_path_0.relationship_identity',
    );
  }
  const context: SqlEmitContext = {
    nodeAliases,
    relationshipAliases,
    pathAliases,
    publicPathIdentityAliases,
    publicRelationshipSequenceIdentityAliases,
    publicMatchIdentityExpression: fullPublicIdentity,
    parameters,
  };
  const selectList = parsed.returns.map((item) => {
    return `${emitReturnItemExpression(item, context)} AS ${quoteIdentifier(item.alias ?? item.expression)}`;
  });
  const outputSelectList = aggregatesReturns
    ? selectList
    : [
        ...selectList,
        `n0.id AS ${quoteIdentifier(INTERNAL_PATH_START_COLUMN)}`,
        `n${finalNodeIndex}.id AS ${quoteIdentifier(INTERNAL_PATH_CURRENT_COLUMN)}`,
        `${fullVisitedEdgeIds} AS ${quoteIdentifier(INTERNAL_PATH_EDGE_IDS_COLUMN)}`,
      ];
  const guardedResultRowsName = aggregatesReturns ? 'cg_aggregate_rows' : 'cg_result_rows';
  const guardedOutputColumnNames = [
    ...parsed.returns.map((item) => item.alias ?? item.expression),
    ...(aggregatesReturns
      ? []
      : [INTERNAL_PATH_START_COLUMN, INTERNAL_PATH_CURRENT_COLUMN, INTERNAL_PATH_EDGE_IDS_COLUMN]),
  ];
  const guardedOutputSelectList = guardedOutputColumnNames.map((columnName) => {
    const column = quoteIdentifier(columnName);
    return `${guardedResultRowsName}.${column} AS ${column}`;
  });
  const guardedSentinelSelectList = guardedOutputColumnNames.map((columnName) => {
    return `NULL AS ${quoteIdentifier(columnName)}`;
  });

  parameters.push(range.lower);
  parameters.push(range.upper);
  const finalWherePredicates = [
    'cg_path_0.depth BETWEEN ? AND ?',
    ...parsed.match.nodes
      .slice(relationshipIndex + 1)
      .flatMap((node, index) => emitNodePatternPredicates(node, `n${relationshipIndex + 1 + index}`, parameters)),
    ...emitWherePredicates(parsed.where, context),
  ];
  const groupByClause = emitGroupByClause(parsed, context);
  parameters.push(capPlan.probeLimit);

  const recursiveCarryValues = [
    'cg_path_0.depth + 1',
    ...prefixNodeIdColumns.map((column) => `cg_path_0.${column}`),
    ...prefixEdgeIdColumns.map((column) => `cg_path_0.${column}`),
    variableNextNodeExpression,
    `${variableEdgeAlias}.id`,
    `cg_path_0.variable_edge_ids || ${variableEdgeAlias}.id || ','`,
    `cg_path_0.visited_edge_ids || ${variableEdgeAlias}.id || ','`,
    emitVariablePathIdentityAppend(
      'cg_path_0.public_identity',
      variableEdgeAlias,
      variableNextNodeExpression,
    ),
    emitRelationshipSequenceIdentityAppend(
      'cg_path_0.relationship_identity',
      variableEdgeAlias,
    ),
  ];
  const supportsProjectionAwareFrontier = !aggregatesReturns && suffixEdgeAliases.length === 0;
  const seedFrontierContext = createRangedFrontierContext(
    context,
    seedPublicIdentity,
    seedRelationshipIdentity,
    parsed.match.pathVariable,
    variableRelationship.variable,
  );
  const recursivePublicIdentity = emitVariablePathIdentityAppend(
    'cg_path_0.public_identity',
    variableEdgeAlias,
    variableNextNodeExpression,
  );
  const recursiveRelationshipIdentity = emitRelationshipSequenceIdentityAppend(
    'cg_path_0.relationship_identity',
    variableEdgeAlias,
  );
  const recursiveFrontierContext = createRangedFrontierContext(
    context,
    recursivePublicIdentity,
    recursiveRelationshipIdentity,
    parsed.match.pathVariable,
    variableRelationship.variable,
  );
  const seedFrontierOrderTerms = supportsProjectionAwareFrontier
    ? emitRangedFrontierOrderTerms(parsed, seedFrontierContext)
    : [];
  const recursiveFrontierOrderTerms = supportsProjectionAwareFrontier
    ? emitRangedFrontierOrderTerms(parsed, recursiveFrontierContext)
    : [];
  const frontierOrderFirstOrdinal = cteColumns.length + 1;
  seedFrontierOrderTerms.forEach((_term, index) => cteColumns.push(`frontier_order_${index}`));
  seedSelectValues.push(...seedFrontierOrderTerms.map((term) => term.expression));
  recursiveCarryValues.push(...recursiveFrontierOrderTerms.map((term) => term.expression));
  const recursiveEdgePredicates = [
    `${variableEdgeAlias}.${edgeAnchorColumn(variableRelationship.direction)} = cg_path_0.current_node_id`,
    variableRelationship.type === undefined
      ? undefined
      : `${variableEdgeAlias}.kind = ${sqlStringLiteral(variableRelationship.type)}`,
    activeEdgePredicate(variableEdgeAlias),
    `instr(cg_path_0.visited_edge_ids, ',' || ${variableEdgeAlias}.id || ',') = 0`,
  ].filter(isPresent);
  const recursiveFrontierJoinLines: string[] = [];
  if (supportsProjectionAwareFrontier) {
    for (let index = 0; index <= relationshipIndex; index += 1) {
      recursiveFrontierJoinLines.push(
        `  JOIN nodes n${index} ON n${index}.id = cg_path_0.node_${index}_id`,
      );
    }
    for (let index = 0; index < relationshipIndex; index += 1) {
      recursiveFrontierJoinLines.push(
        `  JOIN edges e${index} ON e${index}.id = cg_path_0.edge_${index}_id`,
      );
    }
    recursiveFrontierJoinLines.push(
      `  JOIN nodes n${relationshipIndex + 1} ON n${relationshipIndex + 1}.id = ${variableNextNodeExpression}`,
    );
  }

  const lines = [
    `WITH RECURSIVE cg_path_0(${cteColumns.join(', ')}) AS (`,
    `  SELECT ${seedSelectValues.join(', ')}`,
    ...seedLines,
    seedNodePredicates.length === 0 ? undefined : `  WHERE ${seedNodePredicates.join(' AND ')}`,
    '  UNION ALL',
    `  SELECT ${recursiveCarryValues.join(', ')}`,
    '  FROM cg_path_0',
    `  JOIN edges ${variableEdgeAlias} INDEXED BY ${edgeIndexNameForDirection(variableRelationship.direction)} ON ${recursiveEdgePredicates.join(' AND ')}`,
    ...recursiveFrontierJoinLines,
    '  WHERE cg_path_0.depth < ?',
    supportsProjectionAwareFrontier
      ? `  ORDER BY ${emitRangedFrontierOrderByClause(recursiveFrontierOrderTerms, frontierOrderFirstOrdinal)}`
      : `  ORDER BY ${cteColumns.indexOf('public_identity') + 1} ASC`,
    '  LIMIT ?',
    '),',
    `${guardedResultRowsName} AS (`,
    `  SELECT ${[
      ...outputSelectList,
      `row_number() OVER (ORDER BY ${emitOrderByClause(parsed, context)}) AS ${quoteIdentifier(INTERNAL_AGGREGATE_RESULT_ORDER_COLUMN)}`,
    ].join(', ')}`,
    '  FROM cg_path_0',
    ...outerJoinLines.map((line) => `  ${line}`),
    `  WHERE ${finalWherePredicates.join(' AND ')}`,
    groupByClause === undefined
      ? undefined
      : `  GROUP BY ${groupByClause}`,
    `  ORDER BY ${emitOrderByClause(parsed, context)}`,
    '  LIMIT ?',
    '),',
    `cg_path_frontier AS (SELECT count(*) AS ${quoteIdentifier(INTERNAL_PATH_FRONTIER_COUNT_COLUMN)} FROM cg_path_0)`,
    `SELECT ${[
      ...guardedSentinelSelectList,
      `cg_path_frontier.${quoteIdentifier(INTERNAL_PATH_FRONTIER_COUNT_COLUMN)} AS ${quoteIdentifier(INTERNAL_PATH_FRONTIER_COUNT_COLUMN)}`,
      `1 AS ${quoteIdentifier(INTERNAL_PATH_FRONTIER_SENTINEL_COLUMN)}`,
      `0 AS ${quoteIdentifier(INTERNAL_AGGREGATE_RESULT_ORDER_COLUMN)}`,
    ].join(', ')}`,
    'FROM cg_path_frontier',
    'UNION ALL',
    `SELECT ${[
      ...guardedOutputSelectList,
      `cg_path_frontier.${quoteIdentifier(INTERNAL_PATH_FRONTIER_COUNT_COLUMN)} AS ${quoteIdentifier(INTERNAL_PATH_FRONTIER_COUNT_COLUMN)}`,
      `0 AS ${quoteIdentifier(INTERNAL_PATH_FRONTIER_SENTINEL_COLUMN)}`,
      `${guardedResultRowsName}.${quoteIdentifier(INTERNAL_AGGREGATE_RESULT_ORDER_COLUMN)} AS ${quoteIdentifier(INTERNAL_AGGREGATE_RESULT_ORDER_COLUMN)}`,
    ].join(', ')}`,
    `FROM ${guardedResultRowsName} CROSS JOIN cg_path_frontier`,
    `ORDER BY ${quoteIdentifier(INTERNAL_PATH_FRONTIER_SENTINEL_COLUMN)} DESC, ${quoteIdentifier(INTERNAL_AGGREGATE_RESULT_ORDER_COLUMN)} ASC`,
    capPlan.comment,
  ].filter(isPresent);

  return {
    status: 'success',
    sql: lines.join('\n'),
    boundParameters: parameters,
    pathExpansionGuard: frontierGuard,
  };
}

function createNodeAliasMap(nodes: readonly AstNodePattern[]): Map<string, string> {
  const aliases = new Map<string, string>();
  nodes.forEach((node, nodeIndex) => {
    if (node.variable !== undefined) {
      aliases.set(node.variable, `n${nodeIndex}`);
    }
  });
  return aliases;
}

function createRelationshipAliasMap(relationships: readonly AstRelationshipPattern[]): Map<string, string> {
  const aliases = new Map<string, string>();
  relationships.forEach((relationship, relationshipIndex) => {
    if (relationship.variable !== undefined) {
      aliases.set(relationship.variable, `e${relationshipIndex}`);
    }
  });
  return aliases;
}

function edgeAnchorColumn(direction: RelationshipDirection): 'source' | 'target' {
  return direction === 'outgoing' ? 'source' : 'target';
}

function edgeNextColumn(direction: RelationshipDirection): 'source' | 'target' {
  return direction === 'outgoing' ? 'target' : 'source';
}

function edgeIndexNameForDirection(direction: RelationshipDirection): 'idx_edges_source_kind' | 'idx_edges_target_kind' {
  return direction === 'outgoing' ? 'idx_edges_source_kind' : 'idx_edges_target_kind';
}

function emitReturnExpression(expression: string, context: SqlEmitContext): string {
  const propertyAccess = splitPropertyAccess(expression);
  if (propertyAccess === undefined) {
    const pathAlias = context.pathAliases.get(expression);
    if (pathAlias !== undefined) {
      return pathAlias;
    }
    const nodeAlias = context.nodeAliases.get(expression);
    if (nodeAlias !== undefined) {
      return emitNodeProjection(nodeAlias);
    }
    const relationshipAlias = context.relationshipAliases.get(expression);
    if (relationshipAlias !== undefined) {
      return emitRelationshipProjection(relationshipAlias);
    }
    return expression;
  }
  return emitPropertyExpression(propertyAccess.variable, propertyAccess.property, context);
}

function emitReturnItemExpression(item: AstReturnItem, context: SqlEmitContext): string {
  return item.aggregate === undefined
    ? emitReturnExpression(item.expression, context)
    : emitAggregateExpression(item.aggregate, context);
}

function emitAggregateExpression(aggregate: AstAggregateExpression, context: SqlEmitContext): string {
  if (aggregate.argument === '*') {
    return 'count(*)';
  }
  return `count(${emitReturnExpression(aggregate.argument, context)})`;
}

function emitGroupByClause(parsed: CypherParseSuccess, context: SqlEmitContext): string | undefined {
  if (!hasAggregateReturns(parsed) || parsed.groupingKeys.length === 0) {
    return undefined;
  }
  return parsed.groupingKeys.map((expression) => emitReturnExpression(expression, context)).join(', ');
}

function emitOrderByClause(parsed: CypherParseSuccess, context: SqlEmitContext): string {
  if (parsed.orderBy.length > 0) {
    return parsed.orderBy.map((item) => emitOrderItem(item, parsed, context)).join(', ');
  }

  const matchIdentityOrder = context.publicMatchIdentityExpression === undefined
    ? emitMatchedChainIdentityOrder(parsed.match)
    : [`${context.publicMatchIdentityExpression} ASC`];
  return [
    ...parsed.returns.flatMap((item) => emitDefaultProjectedValueOrder(item, parsed, context)),
    ...matchIdentityOrder,
  ].join(', ');
}

function emitDefaultProjectedValueOrder(
  item: AstReturnItem,
  parsed: CypherParseSuccess,
  context: SqlEmitContext,
): readonly string[] {
  if (item.aggregate !== undefined) {
    return [`${emitReturnItemExpression(item, context)} ASC NULLS LAST`];
  }

  const publicPathIdentity = context.publicPathIdentityAliases?.get(item.expression);
  if (publicPathIdentity !== undefined) {
    return [`${publicPathIdentity} ASC`];
  }

  const publicRelationshipSequenceIdentity =
    context.publicRelationshipSequenceIdentityAliases?.get(item.expression);
  if (publicRelationshipSequenceIdentity !== undefined) {
    return [`${publicRelationshipSequenceIdentity} ASC`];
  }

  const nodeIndex = parsed.match.nodes.findIndex((node) => node.variable === item.expression);
  if (nodeIndex !== -1) {
    return [`n${nodeIndex}.id ASC`];
  }

  const relationshipIndex = parsed.match.relationships.findIndex((relationship) => {
    return relationship.variable === item.expression && relationship.range === undefined;
  });
  if (relationshipIndex !== -1) {
    return emitRelationshipIdentityOrder(`e${relationshipIndex}`);
  }

  if (
    parsed.match.pathVariable === item.expression &&
    parsed.match.relationships.every((relationship) => relationship.range === undefined)
  ) {
    return emitMatchedChainIdentityOrder(parsed.match);
  }

  return [`${emitReturnItemExpression(item, context)} ASC NULLS LAST`];
}

function emitRelationshipIdentityOrder(edgeAlias: string): readonly string[] {
  return [
    `${edgeAlias}.source ASC`,
    `${edgeAlias}.target ASC`,
    `${edgeAlias}.kind ASC`,
    `${edgeAlias}.line ASC NULLS LAST`,
    `${edgeAlias}.col ASC NULLS LAST`,
  ];
}

type RangedFrontierOrderTerm = {
  readonly expression: string;
  readonly direction: 'ASC' | 'DESC';
  readonly nullOrdering?: 'NULLS FIRST' | 'NULLS LAST';
};

function emitRangedFrontierOrderTerms(
  parsed: CypherParseSuccess,
  context: SqlEmitContext,
): readonly RangedFrontierOrderTerm[] {
  if (parsed.orderBy.length > 0) {
    return parsed.orderBy.map((item) => ({
      expression: emitOrderItemExpression(item, parsed, context),
      direction: item.direction,
      nullOrdering: item.direction === 'DESC' ? 'NULLS FIRST' : 'NULLS LAST',
    }));
  }

  const terms: RangedFrontierOrderTerm[] = [];
  for (const item of parsed.returns) {
    if (item.aggregate !== undefined) {
      continue;
    }
    const publicIdentity =
      context.publicPathIdentityAliases?.get(item.expression) ??
      context.publicRelationshipSequenceIdentityAliases?.get(item.expression);
    if (publicIdentity !== undefined) {
      terms.push({ expression: publicIdentity, direction: 'ASC' });
      continue;
    }
    const nodeAlias = context.nodeAliases.get(item.expression);
    if (nodeAlias !== undefined) {
      terms.push({ expression: `${nodeAlias}.id`, direction: 'ASC' });
      continue;
    }
    const fixedRelationshipAlias = context.relationshipAliases.get(item.expression);
    if (fixedRelationshipAlias !== undefined) {
      terms.push(
        { expression: `${fixedRelationshipAlias}.source`, direction: 'ASC' },
        { expression: `${fixedRelationshipAlias}.target`, direction: 'ASC' },
        { expression: `${fixedRelationshipAlias}.kind`, direction: 'ASC' },
        { expression: `${fixedRelationshipAlias}.line`, direction: 'ASC', nullOrdering: 'NULLS LAST' },
        { expression: `${fixedRelationshipAlias}.col`, direction: 'ASC', nullOrdering: 'NULLS LAST' },
      );
      continue;
    }
    terms.push({
      expression: emitReturnItemExpression(item, context),
      direction: 'ASC',
      nullOrdering: 'NULLS LAST',
    });
  }
  if (context.publicMatchIdentityExpression !== undefined) {
    terms.push({ expression: context.publicMatchIdentityExpression, direction: 'ASC' });
  }
  return terms;
}

function emitRangedFrontierOrderByClause(
  terms: readonly RangedFrontierOrderTerm[],
  firstOrdinal: number,
): string {
  return terms.map((term, index) => {
    return [
      String(firstOrdinal + index),
      term.direction,
      term.nullOrdering,
    ].filter(isPresent).join(' ');
  }).join(', ');
}

function emitOrderItem(item: AstOrderItem, parsed: CypherParseSuccess, context: SqlEmitContext): string {
  const sqlExpression = emitOrderItemExpression(item, parsed, context);
  const nullOrdering = item.direction === 'DESC' ? 'NULLS FIRST' : 'NULLS LAST';
  return `${sqlExpression} ${item.direction} ${nullOrdering}`;
}

function emitOrderItemExpression(
  item: AstOrderItem,
  parsed: CypherParseSuccess,
  context: SqlEmitContext,
): string {
  const returnItem = returnItemForAlias(item.expression, parsed.returns);
  const expression = returnItem?.expression ?? item.expression;
  const publicIdentityExpression =
    context.publicPathIdentityAliases?.get(expression) ??
    context.publicRelationshipSequenceIdentityAliases?.get(expression);
  const sqlExpression = publicIdentityExpression ??
    (returnItem === undefined
      ? emitReturnExpression(expression, context)
      : emitReturnItemExpression(returnItem, context));
  return sqlExpression;
}

function expressionForAlias(alias: string, returns: readonly AstReturnItem[]): string | undefined {
  return returns.find((item) => item.alias === alias)?.expression;
}

function returnItemForAlias(alias: string, returns: readonly AstReturnItem[]): AstReturnItem | undefined {
  return returns.find((item) => item.alias === alias);
}

function hasAggregateReturns(parsed: CypherParseSuccess): boolean {
  return parsed.returns.some((item) => item.aggregate !== undefined);
}

function emitMatchedChainIdentityOrder(match: CypherParseSuccess['match']): readonly string[] {
  const orderItems: string[] = [];
  match.nodes.forEach((_node, nodeIndex) => {
    orderItems.push(`n${nodeIndex}.id ASC`);
    const relationship = match.relationships[nodeIndex];
    if (relationship !== undefined) {
      const edgeAlias = `e${nodeIndex}`;
      orderItems.push(...emitRelationshipIdentityOrder(edgeAlias));
    }
  });
  return orderItems;
}

function emitVariablePathIdentityOrder(pathAlias: string): string {
  return `${pathAlias}.public_identity ASC`;
}

function emitVariablePathIdentitySeed(
  startNodeExpression: string,
  edgeAlias: string,
  nextNodeExpression: string,
): string {
  return emitIdentityKey([
    emitTextIdentityComponent(startNodeExpression),
    ...emitRelationshipIdentityComponents(edgeAlias),
    emitTextIdentityComponent(nextNodeExpression),
  ]);
}

function emitMixedVariablePathIdentitySeed(
  relationshipIndex: number,
  variableEdgeAlias: string,
  nextNodeExpression: string,
): string {
  const components: string[] = [];
  for (let nodeIndex = 0; nodeIndex <= relationshipIndex; nodeIndex += 1) {
    components.push(emitTextIdentityComponent(`n${nodeIndex}.id`));
    if (nodeIndex < relationshipIndex) {
      components.push(...emitRelationshipIdentityComponents(`e${nodeIndex}`));
    }
  }
  components.push(
    ...emitRelationshipIdentityComponents(variableEdgeAlias),
    emitTextIdentityComponent(nextNodeExpression),
  );
  return emitIdentityKey(components);
}

function emitVariablePathIdentityAppend(
  pathIdentityExpression: string,
  edgeAlias: string,
  nextNodeExpression: string,
): string {
  return [
    `substr(${pathIdentityExpression}, 1, length(${pathIdentityExpression}) - 1)`,
    emitIdentityKey([
      ...emitRelationshipIdentityComponents(edgeAlias),
      emitTextIdentityComponent(nextNodeExpression),
    ]),
  ].join(' || ');
}

function emitRelationshipSequenceIdentitySeed(edgeAlias: string): string {
  return emitIdentityKey(emitRelationshipIdentityComponents(edgeAlias));
}

function emitRelationshipSequenceIdentityAppend(
  relationshipIdentityExpression: string,
  edgeAlias: string,
): string {
  return [
    `substr(${relationshipIdentityExpression}, 1, length(${relationshipIdentityExpression}) - 1)`,
    emitRelationshipSequenceIdentitySeed(edgeAlias),
  ].join(' || ');
}

function emitRelationshipIdentityComponents(edgeAlias: string): readonly string[] {
  return [
    emitTextIdentityComponent(`${edgeAlias}.source`),
    emitTextIdentityComponent(`${edgeAlias}.target`),
    emitTextIdentityComponent(`${edgeAlias}.kind`),
    emitNullableIntegerIdentityComponent(`${edgeAlias}.line`),
    emitNullableIntegerIdentityComponent(`${edgeAlias}.col`),
  ];
}

function emitTextIdentityComponent(expression: string): string {
  return `hex(CAST(${expression} AS BLOB)) || '/'`;
}

function emitNullableIntegerIdentityComponent(expression: string): string {
  return [
    'CASE',
    `WHEN ${expression} IS NULL THEN '2'`,
    `WHEN ${expression} < 0 THEN '0' || printf('%019d', (9223372036854775807 + ${expression}) + 1)`,
    `ELSE '1' || printf('%019d', ${expression})`,
    "END || '/'",
  ].join(' ');
}

function emitIdentityKey(components: readonly string[]): string {
  return [
    ...components.map((component) => `(${component})`),
    "'~'",
  ].join(' || ');
}

function emitNodeProjection(nodeAlias: string): string {
  return `json_object(${[
    `'id', ${nodeAlias}.id`,
    `'kind', ${nodeAlias}.kind`,
    `'name', ${nodeAlias}.name`,
    `'qualifiedName', ${nodeAlias}.qualified_name`,
    `'filePath', ${nodeAlias}.file_path`,
    `'language', ${nodeAlias}.language`,
    `'startLine', ${nodeAlias}.start_line`,
    `'endLine', ${nodeAlias}.end_line`,
    `'startColumn', ${nodeAlias}.start_column`,
    `'endColumn', ${nodeAlias}.end_column`,
  ].join(', ')})`;
}

function emitRelationshipProjection(edgeAlias: string): string {
  return `json_object(${[
    `'${INTERNAL_RELATIONSHIP_STORAGE_ID_FIELD}', ${edgeAlias}.id`,
    `'source', ${edgeAlias}.source`,
    `'target', ${edgeAlias}.target`,
    `'kind', ${edgeAlias}.kind`,
    `'line', ${edgeAlias}.line`,
    `'column', ${edgeAlias}.col`,
    `'provenance', ${edgeAlias}.provenance`,
  ].join(', ')})`;
}

function emitEdgeIdListExpression(edgeAliases: readonly string[]): string {
  if (edgeAliases.length === 0) {
    return "''";
  }
  return `',' ${edgeAliases.map((alias) => `|| ${alias}.id || ','`).join(' ')}`;
}

function emitFixedRelationshipUniquenessPredicates(relationshipCount: number): readonly string[] {
  const predicates: string[] = [];
  for (let relationshipIndex = 1; relationshipIndex < relationshipCount; relationshipIndex += 1) {
    for (let priorIndex = 0; priorIndex < relationshipIndex; priorIndex += 1) {
      predicates.push(`e${relationshipIndex}.id <> e${priorIndex}.id`);
    }
  }
  return predicates;
}

function createCapPlan(requestedLimit: number | undefined): {
  readonly effectiveCap: number;
  readonly probeLimit: number;
  readonly comment: string;
} {
  const effectiveCap = Math.min(requestedLimit ?? DEFAULT_RESULT_CAP, HARD_RESULT_CAP);
  return {
    effectiveCap,
    probeLimit: effectiveCap + 1,
    comment: `/* effectiveCap=${effectiveCap} truncationProbe=effectiveCap+1 no totalRows */`,
  };
}

function emitWherePredicates(where: AstWhereClause | undefined, context: SqlEmitContext): readonly string[] {
  if (where === undefined) {
    return [];
  }

  return [new WhereSqlEmitter(where.tokens, context).emit()];
}

class WhereSqlEmitter {
  private index = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly context: SqlEmitContext,
  ) {}

  emit(): string {
    const expression = this.emitOrExpression();
    if (!this.isAtEnd()) {
      throw this.syntaxError('end of WHERE expression');
    }
    return expression;
  }

  private emitOrExpression(): string {
    let expression = this.emitAndExpression();
    while (this.matchKeyword('OR')) {
      const right = this.emitAndExpression();
      expression = `(${expression} OR ${right})`;
    }
    return expression;
  }

  private emitAndExpression(): string {
    let expression = this.emitNotExpression();
    while (this.matchKeyword('AND')) {
      const right = this.emitNotExpression();
      expression = `(${expression} AND ${right})`;
    }
    return expression;
  }

  private emitNotExpression(): string {
    if (this.matchKeyword('NOT')) {
      return `NOT (${this.emitNotExpression()})`;
    }
    return this.emitPrimaryExpression();
  }

  private emitPrimaryExpression(): string {
    if (this.matchPunctuation('(')) {
      const expression = this.emitOrExpression();
      this.consumePunctuation(')');
      return expression;
    }
    return this.emitPredicateExpression();
  }

  private emitPredicateExpression(): string {
    const left = this.emitPropertyOperand();

    if (this.matchKeyword('IS')) {
      if (this.matchKeyword('NOT')) {
        this.consumeKeyword('NULL');
        return `${left} IS NOT NULL`;
      }
      this.consumeKeyword('NULL');
      return `${left} IS NULL`;
    }

    const stringPredicate = this.matchStringPredicateOperator();
    if (stringPredicate !== undefined) {
      return this.emitStringPredicateExpression(left, stringPredicate);
    }

    const operator = this.consumeComparisonOperator();
    const right = this.emitValueOperand();
    return `${left} ${operator} ${right}`;
  }

  private emitPropertyOperand(): string {
    return this.emitPropertyOperandSql().sql;
  }

  private emitPropertyOperandSql(): SqlOperand {
    const property = this.consumePropertyAccess();
    return {
      sql: emitPropertyExpression(property.variable, property.property, this.context),
      parameters: [],
    };
  }

  private emitValueOperand(): string {
    const operand = this.emitValueOperandSql();
    this.context.parameters.push(...operand.parameters);
    return operand.sql;
  }

  private emitValueOperandSql(): SqlOperand {
    const token = this.current();
    if (token?.kind === 'string') {
      this.advance();
      return { sql: '?', parameters: [token.value] };
    }
    if (token?.kind === 'integer') {
      this.advance();
      return { sql: '?', parameters: [Number(token.value)] };
    }
    if (isKeywordToken(token, 'TRUE')) {
      this.advance();
      return { sql: '?', parameters: [1] };
    }
    if (isKeywordToken(token, 'FALSE')) {
      this.advance();
      return { sql: '?', parameters: [0] };
    }
    if (isKeywordToken(token, 'NULL')) {
      this.advance();
      return { sql: 'NULL', parameters: [] };
    }
    if (this.isAtPropertyAccess()) {
      return this.emitPropertyOperandSql();
    }
    throw this.syntaxError('value operand');
  }

  private emitStringPredicateExpression(leftSql: string, operator: RuntimeStringPredicateOperator): string {
    const right = this.emitValueOperandSql();
    // The operand is named three to five times below. Binding it once and
    // referring back by explicit parameter index keeps exactly one entry in the
    // shared `parameters` array; the earlier form re-ran a push-on-read closure
    // per interpolation, so the same literal was bound up to five times and
    // correctness rested on an unwritten one-push-per-occurrence invariant
    // between this string and an array consumed hundreds of lines away.
    // `push` returns the new length, which is the 1-based index SQLite assigns
    // to that slot, and a bare `?` still takes "highest index so far + 1", so
    // numbered and positional placeholders stay consistent in one statement.
    const rightSql = right.parameters.length === 1
      ? `?${this.context.parameters.push(right.parameters[0])}`
      : right.sql;

    // ENDS WITH anchors from the right by absolute offset, NOT `substr(x, -length(y))`:
    // SQLite reads a zero start offset as "whole string", so the negative form makes
    // `x ENDS WITH ''` compare the entire left value against '' and return false, while
    // STARTS WITH/CONTAINS and the empty-needle case in every other engine treat it as
    // a match. The length guard keeps a longer needle from wrapping back into a
    // negative (count-from-the-right) offset.
    const comparison =
      operator === 'STARTS WITH'
        ? `substr(${leftSql}, 1, length(${rightSql})) = ${rightSql}`
        : operator === 'ENDS WITH'
          ? `(length(${leftSql}) >= length(${rightSql}) AND substr(${leftSql}, length(${leftSql}) - length(${rightSql}) + 1) = ${rightSql})`
          : `instr(${leftSql}, ${rightSql}) > 0`;

    return [
      '(CASE',
      `WHEN ${leftSql} IS NULL OR ${rightSql} IS NULL THEN NULL`,
      `WHEN typeof(${leftSql}) <> 'text' OR typeof(${rightSql}) <> 'text' THEN NULL`,
      `ELSE ${comparison}`,
      'END)',
    ].join(' ');
  }

  private consumePropertyAccess(): { readonly variable: string; readonly property: string } {
    const property = propertyAccessFromTokens(this.tokens, this.index);
    if (property === undefined) {
      throw this.syntaxError('property access');
    }
    this.index += 3;
    return property;
  }

  private consumeComparisonOperator(): string {
    const token = this.current();
    if (token?.kind !== 'punctuation') {
      throw this.syntaxError('comparison operator');
    }

    if (token.value === '<' && this.peekPunctuation('=')) {
      this.advance();
      this.advance();
      return '<=';
    }

    if (token.value === '>' && this.peekPunctuation('=')) {
      this.advance();
      this.advance();
      return '>=';
    }

    if (token.value === '<' && this.peekPunctuation('>')) {
      this.advance();
      this.advance();
      return '<>';
    }

    if (token.value === '=' || token.value === '<' || token.value === '>') {
      this.advance();
      return token.value;
    }

    throw this.syntaxError('comparison operator');
  }

  private matchStringPredicateOperator(): RuntimeStringPredicateOperator | undefined {
    if (this.matchKeyword('STARTS')) {
      this.consumeKeyword('WITH');
      return 'STARTS WITH';
    }
    if (this.matchKeyword('ENDS')) {
      this.consumeKeyword('WITH');
      return 'ENDS WITH';
    }
    if (this.matchKeyword('CONTAINS')) {
      return 'CONTAINS';
    }
    return undefined;
  }

  private consumeKeyword(keyword: string): void {
    if (!this.matchKeyword(keyword)) {
      throw this.syntaxError(keyword);
    }
  }

  private consumePunctuation(punctuation: string): void {
    if (!this.matchPunctuation(punctuation)) {
      throw this.syntaxError(punctuation);
    }
  }

  private matchKeyword(keyword: string): boolean {
    if (!isKeywordToken(this.current(), keyword)) {
      return false;
    }
    this.advance();
    return true;
  }

  private matchPunctuation(punctuation: string): boolean {
    const token = this.current();
    if (token?.kind !== 'punctuation' || token.value !== punctuation) {
      return false;
    }
    this.advance();
    return true;
  }

  private isAtPropertyAccess(): boolean {
    return isPropertyAccessAt(this.tokens, this.index);
  }

  private isAtEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  private current(): Token | undefined {
    return this.tokens[this.index];
  }

  private peekPunctuation(punctuation: string): boolean {
    const token = this.tokens[this.index + 1];
    return token?.kind === 'punctuation' && token.value === punctuation;
  }

  private advance(): void {
    this.index += 1;
  }

  private syntaxError(expected: string): WhereSyntaxError {
    return new WhereSyntaxError(this.index, expected);
  }
}

function isPropertyAccessAt(tokens: readonly Token[], index: number): boolean {
  return (
    tokens[index]?.kind === 'identifier' &&
    tokens[index + 1]?.kind === 'punctuation' &&
    tokens[index + 1]?.value === '.' &&
    tokens[index + 2]?.kind === 'identifier'
  );
}

function propertyAccessFromTokens(
  tokens: readonly Token[],
  index: number,
): { readonly variable: string; readonly property: string } | undefined {
  const variable = tokens[index];
  const property = tokens[index + 2];
  if (variable?.kind !== 'identifier' || property?.kind !== 'identifier') {
    return undefined;
  }
  return {
    variable: variable.value,
    property: property.value,
  };
}

function splitPropertyAccess(expression: string): { readonly variable: string; readonly property: string } | undefined {
  const dotIndex = expression.indexOf('.');
  if (dotIndex === -1) {
    return undefined;
  }
  return {
    variable: expression.slice(0, dotIndex),
    property: expression.slice(dotIndex + 1),
  };
}

function emitPropertyExpression(variable: string, property: string, context: SqlEmitContext): string {
  const nodeAlias = context.nodeAliases.get(variable);
  if (nodeAlias !== undefined) {
    return `${nodeAlias}.${NODE_PROPERTY_COLUMNS[property] ?? property}`;
  }

  const relationshipAlias = context.relationshipAliases.get(variable);
  if (relationshipAlias !== undefined) {
    return `${relationshipAlias}.${RELATIONSHIP_PROPERTY_COLUMNS[property] ?? property}`;
  }

  return `${variable}.${property}`;
}

function emitNodePatternPredicates(
  node: AstNodePattern | undefined,
  nodeAlias: string,
  parameters: unknown[],
): readonly string[] {
  if (node === undefined) {
    return [];
  }

  const predicates: string[] = [];
  if (node.label !== undefined) {
    predicates.push(`${nodeAlias}.kind = ${sqlStringLiteral(node.label)}`);
  }

  if (node.properties !== undefined) {
    for (const [property, value] of Object.entries(node.properties)) {
      const column = NODE_PROPERTY_COLUMNS[property] ?? property;
      if (value === null) {
        predicates.push(`${nodeAlias}.${column} IS NULL`);
      } else {
        parameters.push(value === true ? 1 : value === false ? 0 : value);
        predicates.push(`${nodeAlias}.${column} = ?`);
      }
    }
  }

  return predicates;
}

function activeEdgePredicate(edgeAlias: string): string {
  return `(${edgeAlias}.metadata IS NULL OR json_valid(${edgeAlias}.metadata) = 0 OR json_extract(${edgeAlias}.metadata, '$.lsp.active') IS NOT 0)`;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function isKeywordToken(token: Token | undefined, keyword: string): boolean {
  return token?.kind === 'identifier' && token.value.toUpperCase() === keyword;
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function assertGeneratedSqlIsReadOnly(sql: string): void {
  const trimmedSql = sql.trim();
  if (!/^(SELECT|WITH RECURSIVE)\b/i.test(trimmedSql)) {
    throw new Error('SPEC-013 generated SQL must start with SELECT or WITH RECURSIVE.');
  }
  if (trimmedSql.includes(';')) {
    throw new Error('SPEC-013 generated SQL must contain exactly one statement.');
  }
  if (/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(trimmedSql)) {
    throw new Error('SPEC-013 generated SQL must be read-only.');
  }
}

type StorageNodeRow = {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly qualified_name: string;
  readonly file_path: string;
  readonly language: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly start_column: number;
  readonly end_column: number;
  readonly docstring: string | null;
  readonly signature: string | null;
  readonly visibility: string | null;
  readonly is_exported: number | null;
  readonly is_async: number | null;
  readonly is_static: number | null;
  readonly is_abstract: number | null;
  readonly decorators: string | null;
  readonly type_parameters: string | null;
  readonly return_type: string | null;
};

type StorageEdgeRow = {
  readonly id: number;
  readonly source: string;
  readonly target: string;
  readonly kind: string;
  readonly metadata: string | null;
  readonly line: number | null;
  readonly col: number | null;
  readonly provenance: string | null;
};

type RuntimePathBinding = {
  readonly nodes: readonly StorageNodeRow[];
  readonly relationships: readonly StorageEdgeRow[];
};

type RuntimeMatch = {
  readonly nodes: ReadonlyMap<string, StorageNodeRow>;
  readonly relationships: ReadonlyMap<string, StorageEdgeRow>;
  readonly relationshipLists: ReadonlyMap<string, readonly StorageEdgeRow[]>;
  readonly path?: RuntimePathBinding;
  readonly identity: readonly unknown[];
};

type SortableRuntimeRow = {
  readonly match: RuntimeMatch;
  readonly row: CypherRow;
  readonly sortValues?: ReadonlyMap<string, unknown>;
};

export async function queryCypher(projectRoot: string, query: string): Promise<CypherQueryResult> {
  return queryCypherInternal(projectRoot, query, {});
}

export async function queryCypherForTests(
  projectRoot: string,
  query: string,
  options: CypherRuntimeTestOptions = {},
): Promise<CypherQueryResult> {
  return queryCypherInternal(projectRoot, query, options);
}

export function getCypherRuntimeStateForTests(): {
  readonly activeWorkers: number;
  readonly terminatedWorkers: number;
} {
  return getCypherRuntimeBoundaryStateForTests();
}

async function queryCypherInternal(
  projectRoot: string,
  query: string,
  options: CypherRuntimeTestOptions,
): Promise<CypherQueryResult> {
  if (query.length > CYPHER_MAX_INPUT_CODE_UNITS) {
    return makeInputTooLongDiagnostic();
  }

  const parsed = parseCypher(query);
  if (parsed.status === 'diagnostic') {
    return parsed;
  }

  const plan = emitParameterizedSql(parsed);

  if (hasAggregateReturns(parsed)) {
    return queryAggregateCypherWithSqlPlan(projectRoot, query, parsed, plan, options);
  }

  return queryMatchedCypherWithSqlPlan(projectRoot, parsed, plan, options);
}

function finalizeCypherSuccessResult(result: CypherSuccessResult, options: CypherRuntimeTestOptions): CypherQueryResult {
  const serialized = serializeCypherResult(result, { payloadLimitBytes: options.payloadLimitBytes });
  return typeof serialized === 'string' ? result : serialized;
}

async function queryMatchedCypherWithSqlPlan(
  projectRoot: string,
  parsed: CypherParseSuccess,
  plan: CypherPlanSuccess,
  options: CypherRuntimeTestOptions,
): Promise<CypherQueryResult> {
  const capPlan = createCapPlan(parsed.limit);
  const sqlRowsResult = await executeCypherSqlForTests(
    projectRoot,
    {
      sql: plan.sql,
      boundParameters: plan.boundParameters,
      effectiveCap: capPlan.probeLimit + (plan.pathExpansionGuard === undefined ? 0 : 1),
    },
    { onSqlPrepare: options.onSqlPrepare },
  );
  if (sqlRowsResult.status !== 'success') {
    return sqlRowsResult;
  }
  if (
    plan.pathExpansionGuard !== undefined &&
    sqlRowsResult.rows.some((row) => {
      return numberFromStorage(row[INTERNAL_PATH_FRONTIER_COUNT_COLUMN]) >
        plan.pathExpansionGuard!;
    })
  ) {
    return makePathExpansionLimitDiagnostic();
  }
  const sqlRows = plan.pathExpansionGuard === undefined
    ? sqlRowsResult.rows
    : sqlRowsResult.rows.filter((row) => {
        return numberFromStorage(row[INTERNAL_PATH_FRONTIER_SENTINEL_COLUMN]) !== 1;
      });

  const edgeIdsByRow = sqlRows.map((row) => edgeIdsFromVisitedEdgeIds(row[INTERNAL_PATH_EDGE_IDS_COLUMN]));
  const edgeMapResult = await loadStorageEdgesById(projectRoot, uniqueNumbers(edgeIdsByRow.flat()), options);
  if (edgeMapResult.status !== 'success') {
    return edgeMapResult;
  }

  const nodeIds = new Set<string>();
  for (const row of sqlRows) {
    nodeIds.add(stringFromStorage(row[INTERNAL_PATH_START_COLUMN]));
  }
  for (const edge of edgeMapResult.rows.values()) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }

  const nodeMapResult = await loadStorageNodesById(projectRoot, [...nodeIds], options);
  if (nodeMapResult.status !== 'success') {
    return nodeMapResult;
  }

  const projectedRows: SortableRuntimeRow[] = [];
  for (let rowIndex = 0; rowIndex < sqlRows.length; rowIndex += 1) {
    const sqlRow = sqlRows[rowIndex];
    if (sqlRow === undefined) {
      continue;
    }
    const path = reconstructRuntimePath(sqlRow, edgeIdsByRow[rowIndex] ?? [], edgeMapResult.rows, nodeMapResult.rows, parsed);
    if (path === undefined) {
      return makeDiagnostic('', 0, 1, 0, 'CYPHER_RUNTIME_ERROR', 'bounded path rows', 'runtime', 'Cypher runtime could not reconstruct bounded path rows.');
    }
    const match = createRuntimeMatch(parsed, path.nodes, path.relationships);
    projectedRows.push({
      match,
      row: projectRuntimeRow(parsed.returns, match),
    });
    options.onRowsMaterialized?.(projectedRows.length);
  }

  const orderedRows = [...projectedRows].sort((left, right) => compareRuntimeRows(left, right, parsed));
  options.onRowsInspected?.(Math.min(orderedRows.length, capPlan.probeLimit));
  const probedRows = orderedRows.slice(0, capPlan.probeLimit);
  return finalizeCypherSuccessResult({
    status: 'success',
    columns: parsed.returns.map((item) => ({ name: item.alias ?? item.expression })),
    rows: probedRows.slice(0, capPlan.effectiveCap).map((item) => item.row),
    effectiveCap: capPlan.effectiveCap,
    truncated: orderedRows.length > capPlan.effectiveCap,
  }, options);
}

async function queryAggregateCypherWithSqlPlan(
  projectRoot: string,
  query: string,
  parsed: CypherParseSuccess,
  plan: CypherPlanSuccess,
  options: CypherRuntimeTestOptions,
): Promise<CypherQueryResult> {
  const capPlan = createCapPlan(parsed.limit);
  const queryPlanProbe = options.onQueryPlan === undefined
    ? undefined
    : createPerformanceQueryPlanProbe(query, plan.sql, capPlan);
  const sqlRowsResult = await executeCypherSqlForTests(
    projectRoot,
    {
      sql: plan.sql,
      boundParameters: plan.boundParameters,
      effectiveCap: capPlan.probeLimit + (plan.pathExpansionGuard === undefined ? 0 : 1),
      queryPlanProbe,
    },
    { onSqlPrepare: options.onSqlPrepare, onQueryPlan: options.onQueryPlan },
  );
  if (sqlRowsResult.status !== 'success') {
    return sqlRowsResult;
  }
  const aggregateRows = plan.pathExpansionGuard === undefined
    ? sqlRowsResult.rows
    : sqlRowsResult.rows.filter((row) => {
        return numberFromStorage(row[INTERNAL_PATH_FRONTIER_SENTINEL_COLUMN]) !== 1;
      });
  if (
    plan.pathExpansionGuard !== undefined &&
    sqlRowsResult.rows.some((row) => {
      return numberFromStorage(row[INTERNAL_PATH_FRONTIER_COUNT_COLUMN]) >
        plan.pathExpansionGuard!;
    })
  ) {
    return makePathExpansionLimitDiagnostic();
  }

  const projectedRowsResult = await projectSqlAggregateRows(
    projectRoot,
    parsed,
    aggregateRows,
    options,
  );
  if (projectedRowsResult.status !== 'success') {
    return projectedRowsResult;
  }

  options.onRowsMaterialized?.(aggregateRows.length);
  options.onRowsInspected?.(Math.min(aggregateRows.length, capPlan.probeLimit));
  const probedRows = projectedRowsResult.rows.slice(0, capPlan.probeLimit);
  return finalizeCypherSuccessResult({
    status: 'success',
    columns: parsed.returns.map((item) => ({ name: item.alias ?? item.expression })),
    rows: probedRows.slice(0, capPlan.effectiveCap),
    effectiveCap: capPlan.effectiveCap,
    truncated: aggregateRows.length > capPlan.effectiveCap,
  }, options);
}

function makePathExpansionLimitDiagnostic(): CypherDiagnosticResult {
  return makeDiagnostic(
    '',
    0,
    1,
    0,
    'CYPHER_PATH_EXPANSION_LIMIT',
    'narrower MATCH pattern or bounded path range',
    'runtime',
    'Cypher path expansion exceeded the bounded aggregate match limit. Narrow the MATCH pattern or path range.',
  );
}

function createPerformanceQueryPlanProbe(
  query: string,
  sql: string,
  capPlan: ReturnType<typeof createCapPlan>,
): CypherRuntimeQueryPlanProbe | undefined {
  if (!/^WITH RECURSIVE\b/i.test(sql)) {
    return undefined;
  }
  return {
    probeId: 'PERF-VARIABLE-PATH-PLAN',
    query,
    boundedBy: `LIMIT ${capPlan.effectiveCap}; effectiveCap + 1 truncation probe; timeout ${CYPHER_RUNTIME_DEADLINE_MS}ms`,
  };
}

/**
 * RETURN aliases are arbitrary user identifiers, so a row keyed on a plain `{}`
 * loses `AS __proto__` to the `Object.prototype` setter instead of storing it as
 * an own property — the column would silently vanish from `Object.keys`, JSON
 * output, and the CLI table. A null-prototype row keeps every alias addressable.
 */
function createCypherRow(): CypherRow {
  return Object.create(null) as CypherRow;
}

function projectSqlAggregateRow(parsed: CypherParseSuccess, sqlRow: Record<string, unknown>): CypherRow {
  const row = createCypherRow();
  for (const item of parsed.returns) {
    const columnName = item.alias ?? item.expression;
    row[columnName] = { type: 'scalar', value: sqlProjectionScalarValue(sqlRow[columnName]) };
  }
  return row;
}

type SqlAggregateProjectionResult =
  | { readonly status: 'success'; readonly rows: readonly CypherRow[] }
  | CypherDiagnosticResult
  | CypherTimeoutResult;

async function projectSqlAggregateRows(
  projectRoot: string,
  parsed: CypherParseSuccess,
  sqlRows: readonly Record<string, unknown>[],
  options: CypherRuntimeTestOptions,
): Promise<SqlAggregateProjectionResult> {
  const pathVariable = parsed.match.pathVariable;
  const pathReturnItems = pathVariable === undefined
    ? []
    : parsed.returns.filter((item) => item.aggregate === undefined && item.expression === pathVariable);
  const nodeVariables = new Set(parsed.match.nodes.map((node) => node.variable).filter(isPresent));
  const fixedRelationshipVariables = new Set(
    parsed.match.relationships
      .filter((relationship) => relationship.range === undefined)
      .map((relationship) => relationship.variable)
      .filter(isPresent),
  );
  const rangedRelationshipVariables = new Set(
    parsed.match.relationships
      .filter((relationship) => relationship.range !== undefined)
      .map((relationship) => relationship.variable)
      .filter(isPresent),
  );
  const nodeReturnItems = parsed.returns.filter((item) => {
    return item.aggregate === undefined && nodeVariables.has(item.expression);
  });
  const fixedRelationshipReturnItems = parsed.returns.filter((item) => {
    return item.aggregate === undefined && fixedRelationshipVariables.has(item.expression);
  });
  const rangedRelationshipReturnItems = parsed.returns.filter((item) => {
    return item.aggregate === undefined && rangedRelationshipVariables.has(item.expression);
  });
  if (
    pathReturnItems.length === 0 &&
    nodeReturnItems.length === 0 &&
    fixedRelationshipReturnItems.length === 0 &&
    rangedRelationshipReturnItems.length === 0
  ) {
    return {
      status: 'success',
      rows: sqlRows.map((row) => projectSqlAggregateRow(parsed, row)),
    };
  }

  const edgeIds = new Set<number>();
  const nodeIds = new Set<string>();
  for (const sqlRow of sqlRows) {
    for (const item of nodeReturnItems) {
      const nodeId = stringFieldFromSqlProjection(sqlRow[item.alias ?? item.expression], 'id');
      if (nodeId !== undefined) {
        nodeIds.add(nodeId);
      }
    }
    for (const item of fixedRelationshipReturnItems) {
      const edgeId = numberFieldFromSqlProjection(
        sqlRow[item.alias ?? item.expression],
        INTERNAL_RELATIONSHIP_STORAGE_ID_FIELD,
      );
      if (edgeId !== undefined) {
        edgeIds.add(edgeId);
      }
    }
    for (const item of [...pathReturnItems, ...rangedRelationshipReturnItems]) {
      for (const edgeId of edgeIdsFromVisitedEdgeIds(sqlRow[item.alias ?? item.expression])) {
        edgeIds.add(edgeId);
      }
    }
  }

  const edgeMapResult = await loadStorageEdgesById(projectRoot, [...edgeIds], options);
  if (edgeMapResult.status !== 'success') {
    return edgeMapResult;
  }

  for (const edge of edgeMapResult.rows.values()) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }
  const nodeMapResult = await loadStorageNodesById(projectRoot, [...nodeIds], options);
  if (nodeMapResult.status !== 'success') {
    return nodeMapResult;
  }

  const projectedRows: CypherRow[] = [];
  for (const sqlRow of sqlRows) {
    const projectedRow = projectSqlAggregateRow(parsed, sqlRow);
    for (const item of nodeReturnItems) {
      const columnName = item.alias ?? item.expression;
      const nodeId = stringFieldFromSqlProjection(sqlRow[columnName], 'id');
      const node = nodeId === undefined ? undefined : nodeMapResult.rows.get(nodeId);
      if (node === undefined) {
        return makeAggregateHydrationDiagnostic('grouped node rows');
      }
      projectedRow[columnName] = { type: 'node', value: publicNodeFromStorage(node) };
    }

    for (const item of fixedRelationshipReturnItems) {
      const columnName = item.alias ?? item.expression;
      const edgeId = numberFieldFromSqlProjection(
        sqlRow[columnName],
        INTERNAL_RELATIONSHIP_STORAGE_ID_FIELD,
      );
      const edge = edgeId === undefined ? undefined : edgeMapResult.rows.get(edgeId);
      if (edge === undefined) {
        return makeAggregateHydrationDiagnostic('grouped relationship rows');
      }
      projectedRow[columnName] = {
        type: 'relationship',
        value: publicRelationshipFromStorage(edge),
      };
    }

    for (const item of pathReturnItems) {
      const columnName = item.alias ?? item.expression;
      const pathEdgeIds = edgeIdsFromVisitedEdgeIds(sqlRow[columnName]);
      const startNodeId = startNodeIdForPath(pathEdgeIds, edgeMapResult.rows, parsed);
      const path = startNodeId === undefined
        ? undefined
        : reconstructRuntimePathFromStartNodeId(
            startNodeId,
            pathEdgeIds,
            edgeMapResult.rows,
            nodeMapResult.rows,
            parsed,
          );
      if (path === undefined) {
        return makeAggregateHydrationDiagnostic('grouped path rows');
      }
      projectedRow[columnName] = {
        type: 'path',
        value: publicPathFromStorage(path),
      };
    }

    for (const item of rangedRelationshipReturnItems) {
      const columnName = item.alias ?? item.expression;
      const relationships = edgeIdsFromVisitedEdgeIds(sqlRow[columnName]).map((edgeId) => {
        return edgeMapResult.rows.get(edgeId);
      });
      if (relationships.some((relationship) => relationship === undefined)) {
        return makeAggregateHydrationDiagnostic('grouped ranged relationship rows');
      }
      projectedRow[columnName] = {
        type: 'scalar',
        value: relationships.filter(isPresent).map(publicRelationshipFromStorage),
      };
    }
    projectedRows.push(projectedRow);
  }
  return { status: 'success', rows: projectedRows };
}

function makeAggregateHydrationDiagnostic(expected: string): CypherDiagnosticResult {
  return makeDiagnostic(
    '',
    0,
    1,
    0,
    'CYPHER_RUNTIME_ERROR',
    expected,
    'runtime',
    `Cypher runtime could not reconstruct ${expected}.`,
  );
}

function stringFieldFromSqlProjection(value: unknown, field: string): string | undefined {
  const record = recordFromSqlProjection(value);
  const fieldValue = record?.[field];
  return typeof fieldValue === 'string' ? fieldValue : undefined;
}

function numberFieldFromSqlProjection(value: unknown, field: string): number | undefined {
  const record = recordFromSqlProjection(value);
  const fieldValue = record?.[field];
  return typeof fieldValue === 'number' ? fieldValue : undefined;
}

function recordFromSqlProjection(value: unknown): Record<string, unknown> | undefined {
  if (isRuntimeRecord(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = parseJson(value);
  return isRuntimeRecord(parsed) ? parsed : undefined;
}

function startNodeIdForPath(
  edgeIds: readonly number[],
  edgeMap: ReadonlyMap<number, StorageEdgeRow>,
  parsed: CypherParseSuccess,
): string | undefined {
  const firstEdgeId = edgeIds[0];
  const firstRelationship = parsed.match.relationships[0];
  if (firstEdgeId === undefined || firstRelationship === undefined) {
    return undefined;
  }
  return edgeMap.get(firstEdgeId)?.[edgeAnchorColumn(firstRelationship.direction)];
}

function sqlProjectionScalarValue(value: unknown): CypherScalar {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (isRuntimeRecord(value)) {
    return value;
  }
  return String(value);
}

type StorageNodeMapLoadResult =
  | { readonly status: 'success'; readonly rows: ReadonlyMap<string, StorageNodeRow> }
  | CypherDiagnosticResult
  | CypherTimeoutResult;

type StorageEdgeMapLoadResult =
  | { readonly status: 'success'; readonly rows: ReadonlyMap<number, StorageEdgeRow> }
  | CypherDiagnosticResult
  | CypherTimeoutResult;

async function loadStorageNodesById(
  projectRoot: string,
  ids: readonly string[],
  options: CypherRuntimeTestOptions,
): Promise<StorageNodeMapLoadResult> {
  if (ids.length === 0) {
    return { status: 'success', rows: new Map() };
  }

  const result = await executeCypherSqlForTests(
    projectRoot,
    {
      sql: [
        'SELECT id, kind, name, qualified_name, file_path, language,',
        '       start_line, end_line, start_column, end_column,',
        '       docstring, signature, visibility,',
        '       is_exported, is_async, is_static, is_abstract,',
        '       decorators, type_parameters, return_type',
        `FROM nodes WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ].join('\n'),
      boundParameters: ids,
    },
    { onSqlPrepare: options.onSqlPrepare },
  );
  if (result.status !== 'success') {
    return result;
  }

  const rows = new Map(result.rows.map((row) => {
    const node = toStorageNodeRow(row);
    return [node.id, node] as const;
  }));
  return { status: 'success', rows };
}

async function loadStorageEdgesById(
  projectRoot: string,
  ids: readonly number[],
  options: CypherRuntimeTestOptions,
): Promise<StorageEdgeMapLoadResult> {
  if (ids.length === 0) {
    return { status: 'success', rows: new Map() };
  }

  const result = await executeCypherSqlForTests(
    projectRoot,
    {
      sql: [
        'SELECT id, source, target, kind, metadata, line, col, provenance',
        `FROM edges WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ].join('\n'),
      boundParameters: ids,
    },
    { onSqlPrepare: options.onSqlPrepare },
  );
  if (result.status !== 'success') {
    return result;
  }

  const rows = new Map(result.rows.map((row) => {
    const edge = toStorageEdgeRow(row);
    return [edge.id, edge] as const;
  }));
  return { status: 'success', rows };
}

function reconstructRuntimePath(
  sqlRow: Record<string, unknown>,
  edgeIds: readonly number[],
  edgeMap: ReadonlyMap<number, StorageEdgeRow>,
  nodeMap: ReadonlyMap<string, StorageNodeRow>,
  parsed: CypherParseSuccess,
): RuntimePathBinding | undefined {
  return reconstructRuntimePathFromStartNodeId(
    stringFromStorage(sqlRow[INTERNAL_PATH_START_COLUMN]),
    edgeIds,
    edgeMap,
    nodeMap,
    parsed,
  );
}

function reconstructRuntimePathFromStartNodeId(
  startNodeId: string,
  edgeIds: readonly number[],
  edgeMap: ReadonlyMap<number, StorageEdgeRow>,
  nodeMap: ReadonlyMap<string, StorageNodeRow>,
  parsed: CypherParseSuccess,
): RuntimePathBinding | undefined {
  const startNode = nodeMap.get(startNodeId);
  if (startNode === undefined) {
    return undefined;
  }

  const nodes: StorageNodeRow[] = [startNode];
  const relationships: StorageEdgeRow[] = [];
  const variableRelationshipIndex = parsed.match.relationships.findIndex((relationship) => relationship.range !== undefined);
  const variableDepth = variableRelationshipIndex === -1
    ? 0
    : edgeIds.length - (parsed.match.relationships.length - 1);
  for (let edgeIndex = 0; edgeIndex < edgeIds.length; edgeIndex += 1) {
    const edgeId = edgeIds[edgeIndex];
    if (edgeId === undefined) {
      return undefined;
    }
    const edge = edgeMap.get(edgeId);
    if (edge === undefined) {
      return undefined;
    }
    const relationshipIndex = relationshipIndexForPathEdge(
      edgeIndex,
      variableRelationshipIndex,
      variableDepth,
    );
    const relationship = parsed.match.relationships[relationshipIndex];
    if (relationship === undefined) {
      return undefined;
    }
    const nextNode = nodeMap.get(edge[edgeNextColumn(relationship.direction)]);
    if (nextNode === undefined) {
      return undefined;
    }
    relationships.push(edge);
    nodes.push(nextNode);
  }
  return { nodes, relationships };
}

function relationshipIndexForPathEdge(
  pathEdgeIndex: number,
  variableRelationshipIndex: number,
  variableDepth: number,
): number {
  if (variableRelationshipIndex === -1 || pathEdgeIndex < variableRelationshipIndex) {
    return pathEdgeIndex;
  }
  if (pathEdgeIndex < variableRelationshipIndex + variableDepth) {
    return variableRelationshipIndex;
  }
  return pathEdgeIndex - variableDepth + 1;
}

function edgeIdsFromVisitedEdgeIds(value: unknown): readonly number[] {
  if (typeof value !== 'string') {
    return [];
  }
  return value.split(',').filter(Boolean).map((item) => Number(item)).filter(Number.isFinite);
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
  return [...new Set(values)];
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function createRuntimeMatch(
  parsed: CypherParseSuccess,
  pathNodes: readonly StorageNodeRow[],
  pathRelationships: readonly StorageEdgeRow[],
): RuntimeMatch {
  const nodeBindings = new Map<string, StorageNodeRow>();
  parsed.match.nodes.forEach((node, index) => {
    const storageNode = pathNodeForPatternIndex(parsed, pathNodes, index);
    if (node.variable !== undefined && storageNode !== undefined) {
      nodeBindings.set(node.variable, storageNode);
    }
  });

  const relationshipBindings = new Map<string, StorageEdgeRow>();
  const relationshipListBindings = new Map<string, readonly StorageEdgeRow[]>();
  parsed.match.relationships.forEach((relationship, index) => {
    if (relationship.variable !== undefined && relationship.range !== undefined) {
      const variableDepth = pathRelationships.length - parsed.match.relationships.length + 1;
      relationshipListBindings.set(
        relationship.variable,
        pathRelationships.slice(index, index + variableDepth),
      );
      return;
    }
    const storageEdge = pathRelationshipForPatternIndex(parsed, pathRelationships, index);
    if (relationship.variable !== undefined && storageEdge !== undefined) {
      relationshipBindings.set(relationship.variable, storageEdge);
    }
  });

  return {
    nodes: nodeBindings,
    relationships: relationshipBindings,
    relationshipLists: relationshipListBindings,
    ...(parsed.match.pathVariable === undefined ? {} : { path: { nodes: pathNodes, relationships: pathRelationships } }),
    identity: matchIdentity(pathNodes, pathRelationships),
  };
}

function pathNodeForPatternIndex(
  parsed: CypherParseSuccess,
  pathNodes: readonly StorageNodeRow[],
  patternIndex: number,
): StorageNodeRow | undefined {
  const variableRelationshipIndex = parsed.match.relationships.findIndex((relationship) => relationship.range !== undefined);
  if (variableRelationshipIndex === -1 || patternIndex <= variableRelationshipIndex) {
    return pathNodes[patternIndex];
  }
  const variableDepth = pathNodes.length - parsed.match.nodes.length + 1;
  return pathNodes[patternIndex + variableDepth - 1];
}

function pathRelationshipForPatternIndex(
  parsed: CypherParseSuccess,
  pathRelationships: readonly StorageEdgeRow[],
  patternIndex: number,
): StorageEdgeRow | undefined {
  const variableRelationshipIndex = parsed.match.relationships.findIndex((relationship) => relationship.range !== undefined);
  if (variableRelationshipIndex === -1 || patternIndex <= variableRelationshipIndex) {
    return pathRelationships[patternIndex];
  }
  const variableDepth = pathRelationships.length - parsed.match.relationships.length + 1;
  return pathRelationships[patternIndex + variableDepth - 1];
}

function projectRuntimeRow(returns: readonly AstReturnItem[], match: RuntimeMatch): CypherRow {
  const row = createCypherRow();
  for (const item of returns) {
    row[item.alias ?? item.expression] = cypherValueForExpression(item.expression, match);
  }
  return row;
}

function cypherValueForExpression(expression: string, match: RuntimeMatch): CypherValue {
  const propertyAccess = splitPropertyAccess(expression);
  if (propertyAccess !== undefined) {
    const node = match.nodes.get(propertyAccess.variable);
    if (node !== undefined) {
      return { type: 'scalar', value: nodePropertyValue(node, propertyAccess.property) };
    }
    const relationship = match.relationships.get(propertyAccess.variable);
    if (relationship !== undefined) {
      return { type: 'scalar', value: relationshipPropertyValue(relationship, propertyAccess.property) };
    }
    return { type: 'scalar', value: null };
  }

  const node = match.nodes.get(expression);
  if (node !== undefined) {
    return { type: 'node', value: publicNodeFromStorage(node) };
  }
  const relationship = match.relationships.get(expression);
  if (relationship !== undefined) {
    return { type: 'relationship', value: publicRelationshipFromStorage(relationship) };
  }
  const relationshipList = match.relationshipLists.get(expression);
  if (relationshipList !== undefined) {
    return {
      type: 'scalar',
      value: relationshipList.map(publicRelationshipFromStorage),
    };
  }
  if (match.path !== undefined) {
    return { type: 'path', value: publicPathFromStorage(match.path) };
  }
  return { type: 'scalar', value: null };
}

function compareRuntimeRows(left: SortableRuntimeRow, right: SortableRuntimeRow, parsed: CypherParseSuccess): number {
  if (parsed.orderBy.length > 0) {
    for (const item of parsed.orderBy) {
      const expression = expressionForAlias(item.expression, parsed.returns) ?? item.expression;
      const comparison = compareNullableSortValues(
        sortValueForSortableExpression(expression, left),
        sortValueForSortableExpression(expression, right),
        item.direction,
      );
      if (comparison !== 0) {
        return comparison;
      }
    }
    return compareSortLists(left.match.identity, right.match.identity);
  }

  for (const item of parsed.returns) {
    const comparison = compareNullableSortValues(
      sortValueForSortableExpression(item.expression, left),
      sortValueForSortableExpression(item.expression, right),
      'ASC',
    );
    if (comparison !== 0) {
      return comparison;
    }
  }
  return compareSortLists(left.match.identity, right.match.identity);
}

function sortValueForSortableExpression(expression: string, row: SortableRuntimeRow): unknown {
  if (row.sortValues?.has(expression)) {
    return row.sortValues.get(expression);
  }
  return sortValueForExpression(expression, row.match);
}

function sortValueForExpression(expression: string, match: RuntimeMatch): unknown {
  const value = cypherValueForExpression(expression, match);
  return sortValueForCypherValue(value);
}

function sortValueForCypherValue(value: CypherValue): unknown {
  switch (value.type) {
    case 'scalar':
      return isCypherRelationshipArray(value.value)
        ? makeRuntimeIdentityTuple(value.value.map(relationshipIdentity))
        : value.value;
    case 'node':
      return value.value.id;
    case 'relationship':
      return makeRuntimeIdentityTuple(relationshipIdentity(value.value));
    case 'path':
      return makeRuntimeIdentityTuple(pathIdentity(value.value));
  }
}

type RuntimeIdentityTuple = {
  readonly kind: 'cypher-identity-tuple';
  readonly values: readonly unknown[];
};

function makeRuntimeIdentityTuple(values: readonly unknown[]): RuntimeIdentityTuple {
  return { kind: 'cypher-identity-tuple', values };
}

function isRuntimeIdentityTuple(value: unknown): value is RuntimeIdentityTuple {
  return (
    isRuntimeRecord(value) &&
    value.kind === 'cypher-identity-tuple' &&
    Array.isArray(value.values)
  );
}

function isCypherRelationshipArray(value: unknown): value is readonly CypherRelationship[] {
  // `[].every(...)` is vacuously true, so an empty scalar array would otherwise
  // be sorted as a relationship-identity tuple instead of as a scalar — reachable
  // whenever a ranged relationship variable binds zero edges.
  return Array.isArray(value) && value.length > 0 && value.every((item) => {
    if (!isRuntimeRecord(item)) {
      return false;
    }
    return (
      typeof item.source === 'string' &&
      typeof item.target === 'string' &&
      typeof item.kind === 'string' &&
      (item.line === null || typeof item.line === 'number') &&
      (item.column === null || typeof item.column === 'number')
    );
  });
}

function pathIdentity(path: CypherPath): readonly unknown[] {
  const identity: unknown[] = [];
  path.nodes.forEach((node, nodeIndex) => {
    identity.push(node.id);
    const relationship = path.relationships[nodeIndex];
    if (relationship !== undefined) {
      identity.push(...relationshipIdentity(relationship));
    }
  });
  return identity;
}

function nodePropertyValue(node: StorageNodeRow, property: string): CypherScalar {
  switch (property) {
    case 'id':
      return node.id;
    case 'kind':
      return node.kind;
    case 'name':
      return node.name;
    case 'qualifiedName':
      return node.qualified_name;
    case 'filePath':
      return node.file_path;
    case 'language':
      return node.language;
    case 'startLine':
      return node.start_line;
    case 'endLine':
      return node.end_line;
    case 'startColumn':
      return node.start_column;
    case 'endColumn':
      return node.end_column;
    case 'docstring':
      return node.docstring;
    case 'signature':
      return node.signature;
    case 'visibility':
      return node.visibility;
    case 'isExported':
      return booleanFromStorage(node.is_exported);
    case 'isAsync':
      return booleanFromStorage(node.is_async);
    case 'isStatic':
      return booleanFromStorage(node.is_static);
    case 'isAbstract':
      return booleanFromStorage(node.is_abstract);
    case 'decorators':
      return jsonArrayOrNull(node.decorators);
    case 'typeParameters':
      return jsonArrayOrNull(node.type_parameters);
    case 'returnType':
      return node.return_type;
    default:
      return null;
  }
}

function relationshipPropertyValue(relationship: StorageEdgeRow, property: string): CypherScalar {
  switch (property) {
    case 'source':
      return relationship.source;
    case 'target':
      return relationship.target;
    case 'kind':
      return relationship.kind;
    case 'metadata':
      return jsonObjectOrNull(relationship.metadata);
    case 'line':
      return relationship.line;
    case 'column':
      return relationship.col;
    case 'provenance':
      return relationship.provenance;
    default:
      return null;
  }
}

function publicNodeFromStorage(node: StorageNodeRow): CypherNode {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    qualifiedName: node.qualified_name,
    filePath: node.file_path,
    language: node.language,
    startLine: node.start_line,
    endLine: node.end_line,
    startColumn: node.start_column,
    endColumn: node.end_column,
    docstring: node.docstring,
    signature: node.signature,
    visibility: node.visibility,
    isExported: booleanFromStorage(node.is_exported),
    isAsync: booleanFromStorage(node.is_async),
    isStatic: booleanFromStorage(node.is_static),
    isAbstract: booleanFromStorage(node.is_abstract),
    decorators: jsonArrayOrNull(node.decorators),
    typeParameters: jsonArrayOrNull(node.type_parameters),
    returnType: node.return_type,
  };
}

function publicRelationshipFromStorage(relationship: StorageEdgeRow): CypherRelationship {
  return {
    source: relationship.source,
    target: relationship.target,
    kind: relationship.kind,
    metadata: jsonObjectOrNull(relationship.metadata),
    line: relationship.line,
    column: relationship.col,
    provenance: relationship.provenance,
  };
}

function publicPathFromStorage(path: RuntimePathBinding): CypherPath {
  return {
    nodes: path.nodes.map(publicNodeFromStorage),
    relationships: path.relationships.map(publicRelationshipFromStorage),
    length: path.relationships.length,
  };
}

function toStorageNodeRow(row: Record<string, unknown>): StorageNodeRow {
  return {
    id: stringFromStorage(row.id),
    kind: stringFromStorage(row.kind),
    name: stringFromStorage(row.name),
    qualified_name: stringFromStorage(row.qualified_name),
    file_path: stringFromStorage(row.file_path),
    language: stringFromStorage(row.language),
    start_line: numberFromStorage(row.start_line),
    end_line: numberFromStorage(row.end_line),
    start_column: numberFromStorage(row.start_column),
    end_column: numberFromStorage(row.end_column),
    docstring: nullableStringFromStorage(row.docstring),
    signature: nullableStringFromStorage(row.signature),
    visibility: nullableStringFromStorage(row.visibility),
    is_exported: nullableNumberFromStorage(row.is_exported),
    is_async: nullableNumberFromStorage(row.is_async),
    is_static: nullableNumberFromStorage(row.is_static),
    is_abstract: nullableNumberFromStorage(row.is_abstract),
    decorators: nullableStringFromStorage(row.decorators),
    type_parameters: nullableStringFromStorage(row.type_parameters),
    return_type: nullableStringFromStorage(row.return_type),
  };
}

function toStorageEdgeRow(row: Record<string, unknown>): StorageEdgeRow {
  return {
    id: numberFromStorage(row.id),
    source: stringFromStorage(row.source),
    target: stringFromStorage(row.target),
    kind: stringFromStorage(row.kind),
    metadata: nullableStringFromStorage(row.metadata),
    line: nullableNumberFromStorage(row.line),
    col: nullableNumberFromStorage(row.col),
    provenance: nullableStringFromStorage(row.provenance),
  };
}

function booleanFromStorage(value: number | null): boolean | null {
  return value === null ? null : value === 1;
}

function stringFromStorage(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function nullableStringFromStorage(value: unknown): string | null {
  return value === null || value === undefined ? null : stringFromStorage(value);
}

function numberFromStorage(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function nullableNumberFromStorage(value: unknown): number | null {
  return value === null || value === undefined ? null : numberFromStorage(value);
}

function jsonArrayOrNull(value: string | null): readonly unknown[] | null {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : null;
}

function jsonObjectOrNull(value: string | null): Record<string, unknown> | null {
  const parsed = parseJson(value);
  return isRuntimeRecord(parsed) ? parsed : null;
}

function parseJson(value: string | null): unknown {
  if (value === null) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function compareRuntimeScalars(left: unknown, right: unknown): number {
  if (left === right) {
    return 0;
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left < right ? -1 : 1;
  }
  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return left ? 1 : -1;
  }
  return compareUnicodeCodePoints(canonicalSortString(left), canonicalSortString(right));
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftCodePoints = [...left].map((value) => value.codePointAt(0) ?? 0);
  const rightCodePoints = [...right].map((value) => value.codePointAt(0) ?? 0);
  const length = Math.max(leftCodePoints.length, rightCodePoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftCodePoint = leftCodePoints[index];
    const rightCodePoint = rightCodePoints[index];
    if (leftCodePoint === rightCodePoint) {
      continue;
    }
    if (leftCodePoint === undefined) {
      return -1;
    }
    if (rightCodePoint === undefined) {
      return 1;
    }
    return leftCodePoint < rightCodePoint ? -1 : 1;
  }
  return 0;
}

function compareNullableSortValues(left: unknown, right: unknown, direction: 'ASC' | 'DESC'): number {
  const leftIsNull = left === null || left === undefined;
  const rightIsNull = right === null || right === undefined;
  if (leftIsNull || rightIsNull) {
    if (leftIsNull && rightIsNull) {
      return 0;
    }
    if (direction === 'DESC') {
      return leftIsNull ? -1 : 1;
    }
    return leftIsNull ? 1 : -1;
  }

  if (isRuntimeIdentityTuple(left) && isRuntimeIdentityTuple(right)) {
    const comparison = compareIdentityTupleValues(left.values, right.values);
    return direction === 'DESC' ? -comparison : comparison;
  }

  const comparison = compareRuntimeScalars(left, right);
  return direction === 'DESC' ? -comparison : comparison;
}

function compareSortLists(left: readonly unknown[], right: readonly unknown[]): number {
  return compareIdentityTupleValues(left, right);
}

function compareIdentityTupleValues(left: readonly unknown[], right: readonly unknown[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = compareIdentityTupleComponent(left[index], right[index]);
    if (comparison !== 0) {
      return comparison;
    }
  }
  return 0;
}

function compareIdentityTupleComponent(left: unknown, right: unknown): number {
  const leftIsNull = left === null || left === undefined;
  const rightIsNull = right === null || right === undefined;
  if (leftIsNull || rightIsNull) {
    if (leftIsNull && rightIsNull) {
      return 0;
    }
    return leftIsNull ? 1 : -1;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return compareIdentityTupleValues(left, right);
  }
  return compareRuntimeScalars(left, right);
}

function canonicalSortString(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSortString).join(',')}]`;
  }
  if (isRuntimeRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${key}:${canonicalSortString(value[key])}`).join(',')}}`;
  }
  return String(value ?? '');
}

function matchIdentity(nodes: readonly StorageNodeRow[], relationships: readonly StorageEdgeRow[]): readonly unknown[] {
  const identity: unknown[] = [];
  nodes.forEach((node, nodeIndex) => {
    identity.push(node.id);
    const relationship = relationships[nodeIndex];
    if (relationship !== undefined) {
      identity.push(
        relationship.source,
        relationship.target,
        relationship.kind,
        relationship.line,
        relationship.col,
      );
    }
  });
  return identity;
}

function relationshipIdentity(relationship: CypherRelationship): readonly unknown[] {
  return [
    relationship.source,
    relationship.target,
    relationship.kind,
    relationship.line,
    relationship.column,
  ];
}

function isRuntimeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function planCypher(input: string): CypherPlanResult {
  const parsed = parseCypher(input);
  if (parsed.status === 'diagnostic') {
    return parsed;
  }
  return emitParameterizedSql(parsed);
}

function isDiagnosticResult(value: LexSuccess | CypherParseResult): value is CypherDiagnostic {
  return 'status' in value && value.status === 'diagnostic';
}

export function parseCypherForTests(query: string): CypherParseResult {
  return parseCypher(query);
}

export function planCypherForTests(query: string): CypherPlanResult {
  return planCypher(query);
}
