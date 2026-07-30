import {
  executeCypherSqlForTests,
  getCypherRuntimeStateForTests as getCypherRuntimeBoundaryStateForTests,
} from './runtime';
import { serializeCypherResult } from './serializer';

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
  readonly isExported: boolean;
  readonly isAsync: boolean;
  readonly isStatic: boolean;
  readonly isAbstract: boolean;
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
  readonly forceTimeout?: boolean;
  readonly payloadLimitBytes?: number;
  readonly onSqlPrepare?: (sql: string) => void;
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
  readonly orderBy: readonly AstOrderItem[];
  readonly limit?: number;
  readonly literals: readonly AstLiteral[];
};

type CypherParseResult = CypherParseSuccess | CypherDiagnostic;

type CypherPlanSuccess = {
  readonly status: 'success';
  readonly sql: string;
  readonly boundParameters: readonly unknown[];
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

type VariableBindingKind = 'node' | 'relationship' | 'path';
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

      if (current === '\\' && this.peek(1) === 'u') {
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
      if (codeUnit < 0x20) {
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
      this.failCurrent(
        'CYPHER_UNSUPPORTED_CLAUSE',
        'MATCH',
        'matchClause',
        'OPTIONAL MATCH is not supported.',
      );
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

    if (this.isAtWriteClause()) {
      this.failCurrent(
        'CYPHER_UNSUPPORTED_CLAUSE',
        'RETURN clause',
        'query',
        'Write clauses are not supported.',
      );
    }

    const returns = this.parseReturnClause();

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

    if (this.isAtWriteClause()) {
      this.failCurrent(
        'CYPHER_UNSUPPORTED_CLAUSE',
        'RETURN clause',
        'matchClause',
        'Write clauses are not supported.',
      );
    }

    if (relationships.length === 0) {
      this.failCurrent(
        'CYPHER_DISCONNECTED_PATTERN',
        'connected relationship pattern',
        'matchClause',
        'MATCH requires one connected node-relationship chain.',
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
    const range = this.isAtPunctuation('*') ? this.parseRange() : undefined;

    this.consumePunctuation(']', '"]" to close relationship pattern', 'relationshipPattern');

    if (variableToken !== undefined) {
      this.declareVariable(variableToken, 'relationship', 'relationshipPattern');
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
    const expression = this.parseExpression('returnClause');
    if (this.isAtKeyword('AS')) {
      this.advance();
      const alias = this.consumeIdentifier('alias identifier', 'returnClause').value;
      this.returnAliases.add(alias);
      return { expression, alias };
    }
    return { expression };
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

function buildExcerpt(input: string, offset: number): {
  readonly text: string;
  readonly truncatedBefore: boolean;
  readonly truncatedAfter: boolean;
} {
  const lineStart = Math.max(input.lastIndexOf('\n', offset - 1) + 1, 0);
  const nextLineFeed = input.indexOf('\n', offset);
  const lineEnd = nextLineFeed === -1 ? input.length : nextLineFeed;
  const lineText = input.slice(lineStart, lineEnd).replace(/\r$/, '');

  if (lineText.length <= MAX_EXCERPT_LENGTH) {
    return {
      text: escapeExcerpt(lineText),
      truncatedBefore: false,
      truncatedAfter: false,
    };
  }

  const relativeOffset = Math.max(offset - lineStart, 0);
  const halfWindow = Math.floor(MAX_EXCERPT_LENGTH / 2);
  const start = Math.max(0, Math.min(relativeOffset - halfWindow, lineText.length - MAX_EXCERPT_LENGTH));
  const end = Math.min(lineText.length, start + MAX_EXCERPT_LENGTH);
  return {
    text: escapeExcerpt(lineText.slice(start, end)),
    truncatedBefore: start > 0,
    truncatedAfter: end < lineText.length,
  };
}

function escapeExcerpt(value: string): string {
  return value
    .replace(/\0/g, '\\0')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
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
  readonly parameters: unknown[];
};

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
  const context: SqlEmitContext = {
    nodeAliases,
    relationshipAliases,
    pathAliases: new Map<string, string>(),
    parameters,
  };
  const capPlan = createCapPlan(parsed.limit);

  const selectList = parsed.returns.map((item) => {
    return `${emitReturnExpression(item.expression, context)} AS ${quoteIdentifier(item.alias ?? item.expression)}`;
  });
  const lines = [`SELECT ${selectList.join(', ')}`, 'FROM nodes n0'];

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
    ...emitWherePredicates(parsed.where, context),
  ];
  if (wherePredicates.length > 0) {
    lines.push(`WHERE ${wherePredicates.join(' AND ')}`);
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

  const parameters: unknown[] = [];
  const startNode = parsed.match.nodes[relationshipIndex];
  const endNode = parsed.match.nodes[relationshipIndex + 1];
  const nodeAliases = createNodeAliasMap(parsed.match.nodes);
  const pathAliases = new Map<string, string>();
  if (parsed.match.pathVariable !== undefined) {
    pathAliases.set(parsed.match.pathVariable, 'cg_bounded_paths.visited_edge_ids');
  }
  const context: SqlEmitContext = {
    nodeAliases,
    relationshipAliases: new Map<string, string>(),
    pathAliases,
    parameters,
  };
  const boundedPathAliases = new Map<string, string>();
  if (parsed.match.pathVariable !== undefined) {
    boundedPathAliases.set(parsed.match.pathVariable, 'cg_path_0.visited_edge_ids');
  }
  const boundedContext: SqlEmitContext = {
    nodeAliases,
    relationshipAliases: new Map<string, string>(),
    pathAliases: boundedPathAliases,
    parameters,
  };
  const capPlan = createCapPlan(parsed.limit);
  const frontierGuard = Math.max(
    capPlan.probeLimit,
    capPlan.probeLimit * Math.max(1, range.upper) * VARIABLE_PATH_FRONTIER_MULTIPLIER,
  );
  const outputGuard = capPlan.probeLimit;
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
  const selectList = parsed.returns.map((item) => {
    return `${emitReturnExpression(item.expression, context)} AS ${quoteIdentifier(item.alias ?? item.expression)}`;
  });
  const internalSelectList = [
    `cg_bounded_paths.start_node_id AS ${quoteIdentifier(INTERNAL_PATH_START_COLUMN)}`,
    `cg_bounded_paths.current_node_id AS ${quoteIdentifier(INTERNAL_PATH_CURRENT_COLUMN)}`,
    `cg_bounded_paths.visited_edge_ids AS ${quoteIdentifier(INTERNAL_PATH_EDGE_IDS_COLUMN)}`,
  ];
  const startNodePredicates = emitNodePatternPredicates(startNode, 'n0', parameters);
  const orderByClause = parsed.orderBy.length > 0
    ? emitOrderByClause(parsed, context)
    : emitVariablePathIdentityOrder('cg_bounded_paths');
  const boundedOrderByClause = parsed.orderBy.length > 0
    ? emitOrderByClause(parsed, boundedContext)
    : emitVariablePathIdentityOrder('cg_path_0');

  parameters.push(range.upper);
  parameters.push(frontierGuard);
  parameters.push(range.lower);
  parameters.push(range.upper);
  const finalWherePredicates = [
    ...emitNodePatternPredicates(endNode, `n${relationshipIndex + 1}`, parameters),
    ...emitWherePredicates(parsed.where, boundedContext),
  ].filter(isPresent);
  parameters.push(outputGuard);

  const lines = [
    'WITH RECURSIVE cg_path_0(depth, start_node_id, current_node_id, visited_edge_ids) AS (',
    `  SELECT 1, n0.id, ${nextNodeExpression}, ',' || ${edgeAlias}.id || ','`,
    '  FROM nodes n0',
    `  JOIN edges ${edgeAlias} INDEXED BY ${edgeIndexName} ON ${seedEdgePredicates.join(' AND ')}`,
    startNodePredicates.length === 0 ? undefined : `  WHERE ${startNodePredicates.join(' AND ')}`,
    '  UNION ALL',
    `  SELECT cg_path_0.depth + 1, cg_path_0.start_node_id, ${nextNodeExpression}, cg_path_0.visited_edge_ids || ${edgeAlias}.id || ','`,
    '  FROM cg_path_0',
    `  JOIN edges ${edgeAlias} INDEXED BY ${edgeIndexName} ON ${recursiveEdgePredicates.join(' AND ')}`,
    '  WHERE cg_path_0.depth < ?',
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
    ')',
    `SELECT ${[...selectList, ...internalSelectList].join(', ')}`,
    'FROM cg_bounded_paths',
    'JOIN nodes n0 ON n0.id = cg_bounded_paths.start_node_id',
    `JOIN nodes n${relationshipIndex + 1} ON n${relationshipIndex + 1}.id = cg_bounded_paths.current_node_id`,
    `ORDER BY ${orderByClause}`,
    'LIMIT ?',
    capPlan.comment,
  ].filter(isPresent);
  parameters.push(capPlan.probeLimit);

  return {
    status: 'success',
    sql: lines.join('\n'),
    boundParameters: parameters,
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

function emitOrderByClause(parsed: CypherParseSuccess, context: SqlEmitContext): string {
  if (parsed.orderBy.length > 0) {
    return parsed.orderBy.map((item) => emitOrderItem(item, parsed, context)).join(', ');
  }

  return [
    ...parsed.returns.map((item) => `${item.expression} ASC NULLS LAST`),
    ...emitMatchedChainIdentityOrder(parsed.match),
  ].join(', ');
}

function emitOrderItem(item: AstOrderItem, parsed: CypherParseSuccess, context: SqlEmitContext): string {
  const expression = expressionForAlias(item.expression, parsed.returns) ?? item.expression;
  const sqlExpression = expression.includes('.') ? emitReturnExpression(expression, context) : expression;
  const nullOrdering = item.direction === 'DESC' ? 'NULLS FIRST' : 'NULLS LAST';
  return `${sqlExpression} ${item.direction} ${nullOrdering}`;
}

function expressionForAlias(alias: string, returns: readonly AstReturnItem[]): string | undefined {
  return returns.find((item) => item.alias === alias)?.expression;
}

function emitMatchedChainIdentityOrder(match: CypherParseSuccess['match']): readonly string[] {
  const orderItems: string[] = [];
  match.nodes.forEach((_node, nodeIndex) => {
    orderItems.push(`n${nodeIndex}.id ASC`);
    const relationship = match.relationships[nodeIndex];
    if (relationship !== undefined) {
      const edgeAlias = `e${nodeIndex}`;
      orderItems.push(
        `${edgeAlias}.source ASC`,
        `${edgeAlias}.target ASC`,
        `${edgeAlias}.kind ASC`,
        `${edgeAlias}.line ASC NULLS LAST`,
        `${edgeAlias}.col ASC NULLS LAST`,
      );
    }
  });
  return orderItems;
}

function emitVariablePathIdentityOrder(pathAlias: string): string {
  return [
    `${pathAlias}.depth ASC`,
    `${pathAlias}.start_node_id ASC`,
    `${pathAlias}.current_node_id ASC`,
    `${pathAlias}.visited_edge_ids ASC`,
  ].join(', ');
}

function emitNodeProjection(nodeAlias: string): string {
  return [
    'json_object(',
    "'id', " + `${nodeAlias}.id`,
    "'kind', " + `${nodeAlias}.kind`,
    "'name', " + `${nodeAlias}.name`,
    "'qualifiedName', " + `${nodeAlias}.qualified_name`,
    "'filePath', " + `${nodeAlias}.file_path`,
    "'language', " + `${nodeAlias}.language`,
    "'startLine', " + `${nodeAlias}.start_line`,
    "'endLine', " + `${nodeAlias}.end_line`,
    "'startColumn', " + `${nodeAlias}.start_column`,
    "'endColumn', " + `${nodeAlias}.end_column`,
    ')',
  ].join(' ');
}

function emitRelationshipProjection(edgeAlias: string): string {
  return [
    'json_object(',
    "'source', " + `${edgeAlias}.source`,
    "'target', " + `${edgeAlias}.target`,
    "'kind', " + `${edgeAlias}.kind`,
    "'line', " + `${edgeAlias}.line`,
    "'column', " + `${edgeAlias}.col`,
    "'provenance', " + `${edgeAlias}.provenance`,
    ')',
  ].join(' ');
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
      throw new Error('SPEC-013 WHERE emitter did not consume every predicate token.');
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

    const operator = this.consumeComparisonOperator();
    const right = this.emitValueOperand();
    return `${left} ${operator} ${right}`;
  }

  private emitPropertyOperand(): string {
    const property = this.consumePropertyAccess();
    return emitPropertyExpression(property.variable, property.property, this.context);
  }

  private emitValueOperand(): string {
    const token = this.current();
    if (token?.kind === 'string') {
      this.advance();
      this.context.parameters.push(token.value);
      return '?';
    }
    if (token?.kind === 'integer') {
      this.advance();
      this.context.parameters.push(Number(token.value));
      return '?';
    }
    if (isKeywordToken(token, 'TRUE')) {
      this.advance();
      this.context.parameters.push(1);
      return '?';
    }
    if (isKeywordToken(token, 'FALSE')) {
      this.advance();
      this.context.parameters.push(0);
      return '?';
    }
    if (isKeywordToken(token, 'NULL')) {
      this.advance();
      return 'NULL';
    }
    if (this.isAtPropertyAccess()) {
      return this.emitPropertyOperand();
    }
    throw new Error('SPEC-013 WHERE emitter expected a value operand.');
  }

  private consumePropertyAccess(): { readonly variable: string; readonly property: string } {
    const property = propertyAccessFromTokens(this.tokens, this.index);
    if (property === undefined) {
      throw new Error('SPEC-013 WHERE emitter expected property access.');
    }
    this.index += 3;
    return property;
  }

  private consumeComparisonOperator(): string {
    const token = this.current();
    if (token?.kind !== 'punctuation') {
      throw new Error('SPEC-013 WHERE emitter expected comparison operator.');
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

    throw new Error('SPEC-013 WHERE emitter expected comparison operator.');
  }

  private consumeKeyword(keyword: string): void {
    if (!this.matchKeyword(keyword)) {
      throw new Error(`SPEC-013 WHERE emitter expected ${keyword}.`);
    }
  }

  private consumePunctuation(punctuation: string): void {
    if (!this.matchPunctuation(punctuation)) {
      throw new Error(`SPEC-013 WHERE emitter expected ${punctuation}.`);
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
  if (/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH|BEGIN|COMMIT|ROLLBACK)\b/i.test(trimmedSql)) {
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

type RuntimeGraph = {
  readonly nodes: readonly StorageNodeRow[];
  readonly edges: readonly StorageEdgeRow[];
  readonly nodesById: ReadonlyMap<string, StorageNodeRow>;
  readonly outgoingEdgesByNodeId: ReadonlyMap<string, readonly StorageEdgeRow[]>;
  readonly incomingEdgesByNodeId: ReadonlyMap<string, readonly StorageEdgeRow[]>;
};

type RuntimePathBinding = {
  readonly nodes: readonly StorageNodeRow[];
  readonly relationships: readonly StorageEdgeRow[];
};

type RuntimeMatch = {
  readonly nodes: ReadonlyMap<string, StorageNodeRow>;
  readonly relationships: ReadonlyMap<string, StorageEdgeRow>;
  readonly path?: RuntimePathBinding;
  readonly identity: readonly unknown[];
};

type RuntimeGraphLoadResult =
  | { readonly status: 'success'; readonly graph: RuntimeGraph }
  | CypherDiagnosticResult
  | CypherTimeoutResult;

type SortableRuntimeRow = {
  readonly match: RuntimeMatch;
  readonly row: CypherRow;
};

type RuntimeMatchVisitor = (match: RuntimeMatch) => boolean;

type RuntimeTruth = boolean | null;

const CYPHER_NODE_LOAD_SQL = [
  'SELECT id, kind, name, qualified_name, file_path, language,',
  '       start_line, end_line, start_column, end_column,',
  '       docstring, signature, visibility,',
  '       is_exported, is_async, is_static, is_abstract,',
  '       decorators, type_parameters, return_type',
  'FROM nodes',
  'ORDER BY id',
].join('\n');

const CYPHER_EDGE_LOAD_SQL = [
  'SELECT id, source, target, kind, metadata, line, col, provenance',
  'FROM edges',
  'ORDER BY source, target, kind, line, col, id',
].join('\n');

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
  const parsed = parseCypher(query);
  if (parsed.status === 'diagnostic') {
    return parsed;
  }

  const plan = emitParameterizedSql(parsed);

  if (options.forceTimeout === true) {
    const timeoutProbe = await executeCypherSqlForTests(
      projectRoot,
      { sql: 'SELECT 1 AS ok' },
      { forceTimeout: true, onSqlPrepare: options.onSqlPrepare },
    );
    return timeoutProbe.status === 'success'
      ? makeDiagnostic(query, 0, 1, 0, 'CYPHER_RUNTIME_ERROR', 'timeout result', 'runtime', 'Cypher timeout probe completed unexpectedly.')
      : timeoutProbe;
  }

  const variableRelationshipIndex = parsed.match.relationships.findIndex((relationship) => relationship.range !== undefined);
  if (variableRelationshipIndex !== -1) {
    return queryVariableCypherWithSqlPlan(projectRoot, parsed, variableRelationshipIndex, plan, options);
  }

  const graphResult = await loadRuntimeGraph(projectRoot, options);
  if (graphResult.status !== 'success') {
    return graphResult;
  }

  const capPlan = createCapPlan(parsed.limit);
  const earlyRowLimit = parsed.orderBy.length === 0 ? capPlan.effectiveCap + 1 : undefined;
  const evaluatedRows = evaluateRuntimeRows(parsed, graphResult.graph, earlyRowLimit, options);
  const orderedRows = [...evaluatedRows].sort((left, right) => compareRuntimeRows(left, right, parsed));
  const inspectedCount = Math.min(orderedRows.length, capPlan.effectiveCap + 1);
  options.onRowsInspected?.(inspectedCount);

  const probedRows = orderedRows.slice(0, capPlan.effectiveCap + 1);
  const truncated = probedRows.length > capPlan.effectiveCap;
  const result: CypherSuccessResult = {
    status: 'success',
    columns: parsed.returns.map((item) => ({ name: item.alias ?? item.expression })),
    rows: probedRows.slice(0, capPlan.effectiveCap).map((item) => item.row),
    effectiveCap: capPlan.effectiveCap,
    truncated,
  };

  const serialized = serializeCypherResult(result, { payloadLimitBytes: options.payloadLimitBytes });
  return typeof serialized === 'string' ? result : serialized;
}

async function loadRuntimeGraph(
  projectRoot: string,
  options: CypherRuntimeTestOptions,
): Promise<RuntimeGraphLoadResult> {
  const nodeResult = await executeCypherSqlForTests(
    projectRoot,
    { sql: CYPHER_NODE_LOAD_SQL },
    { onSqlPrepare: options.onSqlPrepare },
  );
  if (nodeResult.status !== 'success') {
    return nodeResult;
  }

  const edgeResult = await executeCypherSqlForTests(
    projectRoot,
    { sql: CYPHER_EDGE_LOAD_SQL },
    { onSqlPrepare: options.onSqlPrepare },
  );
  if (edgeResult.status !== 'success') {
    return edgeResult;
  }

  const nodes = nodeResult.rows.map(toStorageNodeRow);
  const edges = edgeResult.rows.map(toStorageEdgeRow).filter(isActiveStorageEdge);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const outgoingEdgesByNodeId = groupEdgesByNodeId(edges, 'source');
  const incomingEdgesByNodeId = groupEdgesByNodeId(edges, 'target');

  return {
    status: 'success',
    graph: {
      nodes,
      edges,
      nodesById,
      outgoingEdgesByNodeId,
      incomingEdgesByNodeId,
    },
  };
}

async function queryVariableCypherWithSqlPlan(
  projectRoot: string,
  parsed: CypherParseSuccess,
  relationshipIndex: number,
  plan: CypherPlanSuccess,
  options: CypherRuntimeTestOptions,
): Promise<CypherQueryResult> {
  const capPlan = createCapPlan(parsed.limit);
  const sqlRowsResult = await executeCypherSqlForTests(
    projectRoot,
    { sql: plan.sql, boundParameters: plan.boundParameters, effectiveCap: capPlan.probeLimit },
    { onSqlPrepare: options.onSqlPrepare },
  );
  if (sqlRowsResult.status !== 'success') {
    return sqlRowsResult;
  }

  const edgeIdsByRow = sqlRowsResult.rows.map((row) => edgeIdsFromVisitedEdgeIds(row[INTERNAL_PATH_EDGE_IDS_COLUMN]));
  const edgeMapResult = await loadStorageEdgesById(projectRoot, uniqueNumbers(edgeIdsByRow.flat()), options);
  if (edgeMapResult.status !== 'success') {
    return edgeMapResult;
  }

  const nodeIds = new Set<string>();
  for (const row of sqlRowsResult.rows) {
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

  const relationship = parsed.match.relationships[relationshipIndex];
  if (relationship === undefined) {
    return makeDiagnostic('', 0, 1, 0, 'CYPHER_RUNTIME_ERROR', 'variable relationship', 'runtime', 'Cypher runtime could not reconstruct a variable relationship path.');
  }

  const projectedRows: SortableRuntimeRow[] = [];
  for (let rowIndex = 0; rowIndex < sqlRowsResult.rows.length; rowIndex += 1) {
    const sqlRow = sqlRowsResult.rows[rowIndex];
    if (sqlRow === undefined) {
      continue;
    }
    const path = reconstructRuntimePath(sqlRow, edgeIdsByRow[rowIndex] ?? [], edgeMapResult.rows, nodeMapResult.rows, relationship);
    if (path === undefined) {
      return makeDiagnostic('', 0, 1, 0, 'CYPHER_RUNTIME_ERROR', 'bounded path rows', 'runtime', 'Cypher runtime could not reconstruct bounded path rows.');
    }
    const match = createRuntimeMatch(parsed, path.nodes, path.relationships);
    if (evaluateWhereClause(parsed.where, match) !== true) {
      continue;
    }
    projectedRows.push({
      match,
      row: projectRuntimeRow(parsed.returns, match),
    });
    options.onRowsMaterialized?.(projectedRows.length);
  }

  options.onRowsInspected?.(Math.min(projectedRows.length, capPlan.probeLimit));
  const probedRows = projectedRows.slice(0, capPlan.probeLimit);
  const result: CypherSuccessResult = {
    status: 'success',
    columns: parsed.returns.map((item) => ({ name: item.alias ?? item.expression })),
    rows: probedRows.slice(0, capPlan.effectiveCap).map((item) => item.row),
    effectiveCap: capPlan.effectiveCap,
    truncated: sqlRowsResult.rows.length > capPlan.effectiveCap || probedRows.length > capPlan.effectiveCap,
  };

  const serialized = serializeCypherResult(result, { payloadLimitBytes: options.payloadLimitBytes });
  return typeof serialized === 'string' ? result : serialized;
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
  relationship: AstRelationshipPattern,
): RuntimePathBinding | undefined {
  const startNode = nodeMap.get(stringFromStorage(sqlRow[INTERNAL_PATH_START_COLUMN]));
  if (startNode === undefined) {
    return undefined;
  }

  const nodes: StorageNodeRow[] = [startNode];
  const relationships: StorageEdgeRow[] = [];
  for (const edgeId of edgeIds) {
    const edge = edgeMap.get(edgeId);
    if (edge === undefined) {
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

function edgeIdsFromVisitedEdgeIds(value: unknown): readonly number[] {
  if (typeof value !== 'string') {
    return [];
  }
  return value.split(',').filter(Boolean).map((item) => Number(item)).filter(Number.isFinite);
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
  return [...new Set(values)];
}

function evaluateRuntimeRows(
  parsed: CypherParseSuccess,
  graph: RuntimeGraph,
  earlyRowLimit: number | undefined,
  options: CypherRuntimeTestOptions,
): readonly SortableRuntimeRow[] {
  const rows: SortableRuntimeRow[] = [];
  visitRuntimeMatches(parsed, graph, (match) => {
    if (evaluateWhereClause(parsed.where, match) !== true) {
      return true;
    }
    rows.push({
      match,
      row: projectRuntimeRow(parsed.returns, match),
    });
    options.onRowsMaterialized?.(rows.length);
    return earlyRowLimit === undefined || rows.length < earlyRowLimit;
  });
  return rows;
}

function visitRuntimeMatches(parsed: CypherParseSuccess, graph: RuntimeGraph, visitor: RuntimeMatchVisitor): void {
  const variableRelationshipIndex = parsed.match.relationships.findIndex((relationship) => relationship.range !== undefined);
  if (variableRelationshipIndex !== -1) {
    visitVariableRelationshipMatches(parsed, graph, variableRelationshipIndex, visitor);
    return;
  }
  visitFixedRelationshipMatches(parsed, graph, visitor);
}

function visitFixedRelationshipMatches(
  parsed: CypherParseSuccess,
  graph: RuntimeGraph,
  visitor: RuntimeMatchVisitor,
): void {
  const startPattern = parsed.match.nodes[0];
  if (startPattern === undefined) {
    return;
  }

  for (const node of graph.nodes) {
    if (!nodeMatchesPattern(node, startPattern)) {
      continue;
    }
    if (!walkFixedRuntimeMatch(parsed, graph, 0, [node], [], visitor)) {
      return;
    }
  }
}

function walkFixedRuntimeMatch(
  parsed: CypherParseSuccess,
  graph: RuntimeGraph,
  relationshipIndex: number,
  pathNodes: readonly StorageNodeRow[],
  pathRelationships: readonly StorageEdgeRow[],
  visitor: RuntimeMatchVisitor,
): boolean {
  if (relationshipIndex >= parsed.match.relationships.length) {
    return visitor(createRuntimeMatch(parsed, pathNodes, pathRelationships));
  }

  const relationship = parsed.match.relationships[relationshipIndex];
  const nextNodePattern = parsed.match.nodes[relationshipIndex + 1];
  const currentNode = pathNodes[pathNodes.length - 1];
  if (relationship === undefined || nextNodePattern === undefined || currentNode === undefined) {
    return true;
  }

  for (const edge of candidateEdgesForPattern(graph, currentNode.id, relationship)) {
    if (pathRelationships.some((usedEdge) => usedEdge.id === edge.id)) {
      continue;
    }
    const nextNodeId = edge[edgeNextColumn(relationship.direction)];
    const nextNode = graph.nodesById.get(nextNodeId);
    if (nextNode === undefined || !nodeMatchesPattern(nextNode, nextNodePattern)) {
      continue;
    }
    if (!walkFixedRuntimeMatch(
      parsed,
      graph,
      relationshipIndex + 1,
      [...pathNodes, nextNode],
      [...pathRelationships, edge],
      visitor,
    )) {
      return false;
    }
  }
  return true;
}

function visitVariableRelationshipMatches(
  parsed: CypherParseSuccess,
  graph: RuntimeGraph,
  relationshipIndex: number,
  visitor: RuntimeMatchVisitor,
): void {
  const relationship = parsed.match.relationships[relationshipIndex];
  const range = relationship?.range;
  const startPattern = parsed.match.nodes[relationshipIndex];
  const finishPattern = parsed.match.nodes[relationshipIndex + 1];
  if (
    relationship === undefined ||
    range === undefined ||
    startPattern === undefined ||
    finishPattern === undefined ||
    parsed.match.relationships.length !== 1
  ) {
    return;
  }

  for (const startNode of graph.nodes) {
    if (!nodeMatchesPattern(startNode, startPattern)) {
      continue;
    }
    if (!walkVariableRuntimeMatch(
      parsed,
      graph,
      relationship,
      finishPattern,
      range,
      startNode,
      0,
      [startNode],
      [],
      new Set<number>(),
      visitor,
    )) {
      return;
    }
  }
}

function walkVariableRuntimeMatch(
  parsed: CypherParseSuccess,
  graph: RuntimeGraph,
  relationship: AstRelationshipPattern,
  finishPattern: AstNodePattern,
  range: NonNullable<AstRelationshipPattern['range']>,
  currentNode: StorageNodeRow,
  depth: number,
  pathNodes: readonly StorageNodeRow[],
  pathRelationships: readonly StorageEdgeRow[],
  usedEdgeIds: ReadonlySet<number>,
  visitor: RuntimeMatchVisitor,
): boolean {
  if (depth >= range.lower && nodeMatchesPattern(currentNode, finishPattern)) {
    if (!visitor(createRuntimeMatch(parsed, pathNodes, pathRelationships))) {
      return false;
    }
  }
  if (depth >= range.upper) {
    return true;
  }

  for (const edge of candidateEdgesForPattern(graph, currentNode.id, relationship)) {
    if (usedEdgeIds.has(edge.id)) {
      continue;
    }
    const nextNodeId = edge[edgeNextColumn(relationship.direction)];
    const nextNode = graph.nodesById.get(nextNodeId);
    if (nextNode === undefined) {
      continue;
    }
    const nextUsedEdgeIds = new Set(usedEdgeIds);
    nextUsedEdgeIds.add(edge.id);
    if (!walkVariableRuntimeMatch(
      parsed,
      graph,
      relationship,
      finishPattern,
      range,
      nextNode,
      depth + 1,
      [...pathNodes, nextNode],
      [...pathRelationships, edge],
      nextUsedEdgeIds,
      visitor,
    )) {
      return false;
    }
  }
  return true;
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
  parsed.match.relationships.forEach((relationship, index) => {
    const storageEdge = pathRelationships[index];
    if (relationship.variable !== undefined && storageEdge !== undefined) {
      relationshipBindings.set(relationship.variable, storageEdge);
    }
  });

  return {
    nodes: nodeBindings,
    relationships: relationshipBindings,
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
  if (variableRelationshipIndex !== -1 && patternIndex === variableRelationshipIndex + 1) {
    return pathNodes[pathNodes.length - 1];
  }
  return pathNodes[patternIndex];
}

function candidateEdgesForPattern(
  graph: RuntimeGraph,
  nodeId: string,
  relationship: AstRelationshipPattern,
): readonly StorageEdgeRow[] {
  const edgePool =
    relationship.direction === 'outgoing'
      ? graph.outgoingEdgesByNodeId.get(nodeId) ?? []
      : graph.incomingEdgesByNodeId.get(nodeId) ?? [];
  return relationship.type === undefined ? edgePool : edgePool.filter((edge) => edge.kind === relationship.type);
}

function nodeMatchesPattern(node: StorageNodeRow, pattern: AstNodePattern): boolean {
  if (pattern.label !== undefined && node.kind !== pattern.label) {
    return false;
  }
  if (pattern.properties === undefined) {
    return true;
  }
  return Object.entries(pattern.properties).every(([property, value]) => {
    return compareRuntimeScalars(nodePropertyValue(node, property), value) === 0;
  });
}

function evaluateWhereClause(where: AstWhereClause | undefined, match: RuntimeMatch): RuntimeTruth {
  if (where === undefined) {
    return true;
  }
  return new RuntimeWhereEvaluator(where.tokens, match).evaluate();
}

class RuntimeWhereEvaluator {
  private index = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly match: RuntimeMatch,
  ) {}

  evaluate(): RuntimeTruth {
    const value = this.evaluateOrExpression();
    if (!this.isAtEnd()) {
      return false;
    }
    return value;
  }

  private evaluateOrExpression(): RuntimeTruth {
    let value = this.evaluateAndExpression();
    while (this.matchKeyword('OR')) {
      value = truthyOr(value, this.evaluateAndExpression());
    }
    return value;
  }

  private evaluateAndExpression(): RuntimeTruth {
    let value = this.evaluateNotExpression();
    while (this.matchKeyword('AND')) {
      value = truthyAnd(value, this.evaluateNotExpression());
    }
    return value;
  }

  private evaluateNotExpression(): RuntimeTruth {
    if (this.matchKeyword('NOT')) {
      return truthyNot(this.evaluateNotExpression());
    }
    return this.evaluatePrimaryExpression();
  }

  private evaluatePrimaryExpression(): RuntimeTruth {
    if (this.matchPunctuation('(')) {
      const expression = this.evaluateOrExpression();
      if (!this.matchPunctuation(')')) {
        return false;
      }
      return expression;
    }
    return this.evaluatePredicateExpression();
  }

  private evaluatePredicateExpression(): RuntimeTruth {
    const left = this.evaluatePropertyOperand();

    if (this.matchKeyword('IS')) {
      const isNot = this.matchKeyword('NOT');
      if (!this.matchKeyword('NULL')) {
        return false;
      }
      const isNull = left === null;
      return isNot ? !isNull : isNull;
    }

    const operator = this.consumeComparisonOperator();
    const right = this.evaluateValueOperand();
    if (left === null || right === null) {
      return null;
    }

    const comparison = compareRuntimeScalars(left, right);
    switch (operator) {
      case '=':
        return comparison === 0;
      case '<>':
        return comparison !== 0;
      case '<':
        return comparison < 0;
      case '<=':
        return comparison <= 0;
      case '>':
        return comparison > 0;
      case '>=':
        return comparison >= 0;
    }
  }

  private evaluatePropertyOperand(): CypherScalar {
    const property = propertyAccessFromTokens(this.tokens, this.index);
    if (property === undefined) {
      this.index = this.tokens.length;
      return null;
    }
    this.index += 3;
    const node = this.match.nodes.get(property.variable);
    if (node !== undefined) {
      return nodePropertyValue(node, property.property);
    }
    const relationship = this.match.relationships.get(property.variable);
    if (relationship !== undefined) {
      return relationshipPropertyValue(relationship, property.property);
    }
    return null;
  }

  private evaluateValueOperand(): CypherScalar {
    const token = this.current();
    if (token?.kind === 'string') {
      this.advance();
      return token.value;
    }
    if (token?.kind === 'integer') {
      this.advance();
      return Number(token.value);
    }
    if (isKeywordToken(token, 'TRUE')) {
      this.advance();
      return true;
    }
    if (isKeywordToken(token, 'FALSE')) {
      this.advance();
      return false;
    }
    if (isKeywordToken(token, 'NULL')) {
      this.advance();
      return null;
    }
    if (isPropertyAccessAt(this.tokens, this.index)) {
      return this.evaluatePropertyOperand();
    }
    this.index = this.tokens.length;
    return null;
  }

  private consumeComparisonOperator(): '=' | '<>' | '<' | '<=' | '>' | '>=' {
    const token = this.current();
    if (token?.kind !== 'punctuation') {
      this.index = this.tokens.length;
      return '=';
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

    this.index = this.tokens.length;
    return '=';
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
}

function projectRuntimeRow(returns: readonly AstReturnItem[], match: RuntimeMatch): CypherRow {
  const row: CypherRow = {};
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
        sortValueForExpression(expression, left.match),
        sortValueForExpression(expression, right.match),
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
      sortValueForExpression(item.expression, left.match),
      sortValueForExpression(item.expression, right.match),
      'ASC',
    );
    if (comparison !== 0) {
      return comparison;
    }
  }
  return compareSortLists(left.match.identity, right.match.identity);
}

function sortValueForExpression(expression: string, match: RuntimeMatch): unknown {
  const value = cypherValueForExpression(expression, match);
  switch (value.type) {
    case 'scalar':
      return value.value;
    case 'node':
      return value.value.id;
    case 'relationship':
      return relationshipIdentity(value.value);
    case 'path':
      return [
        value.value.length,
        ...value.value.nodes.map((node) => node.id),
        ...value.value.relationships.map(relationshipIdentity),
      ];
  }
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

function groupEdgesByNodeId(
  edges: readonly StorageEdgeRow[],
  key: 'source' | 'target',
): ReadonlyMap<string, readonly StorageEdgeRow[]> {
  const grouped = new Map<string, StorageEdgeRow[]>();
  for (const edge of edges) {
    const groupKey = edge[key];
    const group = grouped.get(groupKey);
    if (group === undefined) {
      grouped.set(groupKey, [edge]);
    } else {
      group.push(edge);
    }
  }
  return grouped;
}

function isActiveStorageEdge(edge: StorageEdgeRow): boolean {
  if (edge.metadata === null) {
    return true;
  }
  const metadata = parseJson(edge.metadata);
  if (!isRuntimeRecord(metadata)) {
    return true;
  }
  const lsp = metadata.lsp;
  return !(isRuntimeRecord(lsp) && lsp.active === false);
}

function booleanFromStorage(value: number | null): boolean {
  return value === 1;
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

function truthyAnd(left: RuntimeTruth, right: RuntimeTruth): RuntimeTruth {
  if (left === false || right === false) {
    return false;
  }
  if (left === null || right === null) {
    return null;
  }
  return true;
}

function truthyOr(left: RuntimeTruth, right: RuntimeTruth): RuntimeTruth {
  if (left === true || right === true) {
    return true;
  }
  if (left === null || right === null) {
    return null;
  }
  return false;
}

function truthyNot(value: RuntimeTruth): RuntimeTruth {
  return value === null ? null : !value;
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
  return canonicalSortString(left).localeCompare(canonicalSortString(right));
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

  const comparison = compareRuntimeScalars(left, right);
  return direction === 'DESC' ? -comparison : comparison;
}

function compareSortLists(left: readonly unknown[], right: readonly unknown[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = compareNullableSortValues(left[index], right[index], 'ASC');
    if (comparison !== 0) {
      return comparison;
    }
  }
  return 0;
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
  return [
    ...nodes.map((node) => node.id),
    ...relationships.flatMap((relationship) => [
      relationship.source,
      relationship.target,
      relationship.kind,
      relationship.line,
      relationship.col,
      relationship.id,
    ]),
  ];
}

function relationshipIdentity(relationship: CypherRelationship): readonly unknown[] {
  return [
    relationship.source,
    relationship.target,
    relationship.kind,
    relationship.line,
    relationship.column,
    relationship.provenance,
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
