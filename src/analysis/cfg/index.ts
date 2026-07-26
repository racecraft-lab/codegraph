import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import { CURRENT_SCHEMA_VERSION } from '../../db/migrations';
import type { SqliteDatabase } from '../../db/sqlite-adapter';
import { getParser } from '../../extraction/grammars';
import { getNodeText } from '../../extraction/tree-sitter-helpers';
import type { Language } from '../../types';
export type CfgState =
  | 'available'
  | 'disabled'
  | 'not_indexed'
  | 'not_computed'
  | 'stale'
  | 'unavailable'
  | 'unsupported'
  | 'resource_limited'
  | 'unknown_function'
  | 'deleted';

export type CfgReason =
  | 'analysis_disabled'
  | 'project_not_indexed'
  | 'cfg_not_computed'
  | 'function_unknown'
  | 'function_deleted'
  | 'unsupported_language'
  | 'unsupported_construct'
  | 'parse_error'
  | 'parse_unsafe_region'
  | 'parser_unavailable'
  | 'block_limit_exceeded'
  | 'first_refresh_failed'
  | 'refresh_failed_retained_stale'
  | 'source_version_mismatch'
  | 'no_current_cfg_functions';

export interface CfgReadResult {
  analysis: 'cfg';
  functionId: string;
  state: CfgState;
  reason: CfgReason | null;
  message: string;
  sourceVersion: string | null;
  stale: boolean;
  cfg: CfgGraph | null;
  page: CfgPage | null;
}

export interface CfgGraph {
  analysis: 'cfg';
  graphId: string;
  language: string;
  functionId: string;
  sourceVersion: string;
  blocks: CfgBlock[];
  edges: CfgEdge[];
}

export interface CfgBlock {
  id: string;
  role: 'entry' | 'exit' | 'body' | 'condition' | 'merge' | 'unreachable';
  ordinal: number;
  spans: Array<{
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  }>;
}

export interface CfgEdge {
  source: string;
  target: string;
  kind:
    | 'fallthrough'
    | 'true'
    | 'false'
    | 'case'
    | 'default'
    | 'loop_back'
    | 'return'
    | 'throw'
    | 'break'
    | 'continue'
    | 'finally';
}

export interface CfgPage {
  limit: number;
  offset: number;
  blocks: {
    total: number;
    returned: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
  edges: {
    total: number;
    returned: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}

export const CFG_STATUS_CONTRACT_VERSION = 1;
export const CFG_BLOCK_CONTRACT_VERSION = 1;
export const CFG_EDGE_CONTRACT_VERSION = 1;

export interface CfgSourceVersionInput {
  fileContentHash: string;
  functionId: string;
  language: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  statusVersion: number;
  blockVersion: number;
  edgeVersion: number;
  graphWriteVersion?: number;
}

export interface CfgPageRequest {
  limit?: number;
  offset?: number;
}

export interface NormalizedCfgPageRequest {
  limit: number;
  offset: number;
}

export interface BuildCfgPageInput extends NormalizedCfgPageRequest {
  totalBlocks: number;
  totalEdges: number;
}

export interface PageCfgGraphInput {
  graph: CfgGraph;
  request: CfgPageRequest;
}

type StoredCfgState = Extract<CfgState, 'available' | 'unavailable' | 'unsupported' | 'resource_limited' | 'deleted'>;

export interface StoredCfgStatus {
  state: StoredCfgState;
  reason: CfgReason | null;
  message?: string | null;
  sourceVersion: string | null;
  statusVersion: number;
  blockVersion: number;
  edgeVersion: number;
}

export interface ResolveCfgStatusInput {
  enabled: boolean;
  projectIndexed: boolean;
  currentSourceVersion: string | null;
  stored: StoredCfgStatus | null;
  statusVersion?: number;
  blockVersion?: number;
  edgeVersion?: number;
}

export interface ResolvedCfgStatus {
  state: CfgState;
  reason: CfgReason | null;
  stale: boolean;
  sourceVersion: string | null;
  carriesPayload: boolean;
}

export interface MakeCfgReadResultInput {
  functionId: string;
  state: CfgState;
  reason: CfgReason | null;
  message?: unknown;
  sourceVersion?: string | null;
  cfg?: CfgGraph | null;
  page?: CfgPage | null;
}

export interface RunCfgAnalysisInput {
  projectRoot: string;
  db: SqliteDatabase;
  signal?: AbortSignal;
}
export interface ReadCfgInput {
  db: SqliteDatabase;
  functionId: string;
  enabled: boolean;
  request?: CfgPageRequest;
  projectIndexed?: boolean;
}
interface CfgFunctionRow {
  id: string;
  file_path: string;
  language: string;
  kind: string;
  name: string;
  start_line: number;
  start_column: number;
  end_line: number;
  end_column: number;
  content_hash: string;
}
interface StoredCfgStatusRow {
  function_id: string;
  language: string;
  state: StoredCfgState;
  reason: CfgReason | null;
  message: string | null;
  source_version: string | null;
  status_version: number;
  block_version: number;
  edge_version: number;
}
interface StoredCfgBlockRow {
  block_id: string;
  ordinal: number;
  role: CfgBlock['role'];
  spans_json: string;
}

interface StoredCfgEdgeRow {
  source_block_id: string;
  target_block_id: string;
  kind: CfgEdge['kind'];
}

interface CfgBlockIr {
  role: CfgBlock['role'];
  spans: CfgBlock['spans'];
}

interface CfgEdgeIr {
  sourceOrdinal: number;
  targetOrdinal: number;
  kind: CfgEdge['kind'];
}

interface CfgIr {
  blocks: CfgBlockIr[];
  edges: CfgEdgeIr[];
}

interface ParsedCfgFunction {
  ok: true;
  tree: Tree;
  node: SyntaxNode;
}

interface CfgFunctionParseFailure {
  ok: false;
  state: Extract<CfgState, 'unavailable' | 'unsupported'>;
  reason: Extract<CfgReason, 'first_refresh_failed' | 'parser_unavailable' | 'parse_error' | 'parse_unsafe_region'>;
  message: string;
}

type CfgFunctionParseResult = ParsedCfgFunction | CfgFunctionParseFailure;

type CfgParser = {
  parse(source: string): Tree | null;
};

const CFG_STATES: ReadonlySet<string> = new Set([
  'available',
  'disabled',
  'not_indexed',
  'not_computed',
  'stale',
  'unavailable',
  'unsupported',
  'resource_limited',
  'unknown_function',
  'deleted',
]);

const CFG_BLOCK_ROLES: ReadonlySet<string> = new Set([
  'entry',
  'exit',
  'body',
  'condition',
  'merge',
  'unreachable',
]);

const CFG_EDGE_KINDS: ReadonlySet<string> = new Set([
  'fallthrough',
  'true',
  'false',
  'case',
  'default',
  'loop_back',
  'return',
  'throw',
  'break',
  'continue',
  'finally',
]);

const RESULT_KEYS = [
  'analysis',
  'cfg',
  'functionId',
  'message',
  'page',
  'reason',
  'sourceVersion',
  'stale',
  'state',
];

const REASONS_BY_STATE: Record<CfgState, ReadonlySet<CfgReason | null>> = {
  available: new Set([null]),
  disabled: new Set(['analysis_disabled']),
  not_indexed: new Set(['project_not_indexed']),
  not_computed: new Set(['cfg_not_computed']),
  stale: new Set(['refresh_failed_retained_stale', 'source_version_mismatch']),
  unavailable: new Set(['first_refresh_failed']),
  unsupported: new Set([
    'unsupported_language',
    'unsupported_construct',
    'parse_error',
    'parse_unsafe_region',
    'parser_unavailable',
  ]),
  resource_limited: new Set(['block_limit_exceeded']),
  unknown_function: new Set(['function_unknown']),
  deleted: new Set(['function_deleted']),
};

const CFG_TSJS_LANGUAGES = ['typescript', 'tsx', 'javascript', 'jsx'] as const;
const CFG_TSJS_LANGUAGE_SET: ReadonlySet<string> = new Set(CFG_TSJS_LANGUAGES);
const CFG_FUNCTION_KINDS = ['function', 'method'] as const;
const CFG_BASIC_BLOCK_LIMIT = 10_000;
const CFG_TSJS_FUNCTION_NODE_TYPES: ReadonlySet<string> = new Set([
  'function_declaration',
  'method_definition',
]);
const LINEAR_BODY_STATEMENT_TYPES: ReadonlySet<string> = new Set([
  'empty_statement',
  'expression_statement',
  'lexical_declaration',
  'return_statement',
  'variable_declaration',
]);
const LINEAR_DESCENDANT_TYPES: ReadonlySet<string> = new Set([
  ...LINEAR_BODY_STATEMENT_TYPES,
  'false',
  'identifier',
  'null',
  'number',
  'property_identifier',
  'string',
  'string_fragment',
  'true',
  'undefined',
  'variable_declarator',
]);
const CFG_COMMENT_NODE_TYPES: ReadonlySet<string> = new Set([
  'comment',
  'line_comment',
  'block_comment',
]);
const UNSUPPORTED_LINEAR_DESCENDANT_TYPES: ReadonlySet<string> = new Set([
  'arrow_function',
  'break_statement',
  'case_statement',
  'catch_clause',
  'class_declaration',
  'continue_statement',
  'do_statement',
  'else_clause',
  'finally_clause',
  'for_in_statement',
  'for_statement',
  'function_declaration',
  'function_expression',
  'generator_function',
  'generator_function_declaration',
  'if_statement',
  'labeled_statement',
  'method_definition',
  'switch_statement',
  'throw_statement',
  'try_statement',
  'while_statement',
  'with_statement',
  'yield_expression',
]);
const CFG_CONSERVATIVE_BLOCK_DEMAND: ReadonlyMap<string, number> = new Map([
  ['break_statement', 1],
  ['case_statement', 2],
  ['catch_clause', 1],
  ['continue_statement', 1],
  ['do_statement', 4],
  ['else_clause', 1],
  ['finally_clause', 1],
  ['for_in_statement', 4],
  ['for_statement', 4],
  ['if_statement', 2],
  ['return_statement', 1],
  ['switch_statement', 2],
  ['throw_statement', 1],
  ['try_statement', 3],
  ['while_statement', 4],
]);

const cfgParserOverridesForTests = new Map<string, CfgParser | null>();

export function setCfgParserOverrideForTests(language: string, parser: CfgParser | null | undefined): void {
  if (parser === undefined) {
    cfgParserOverridesForTests.delete(language);
    return;
  }
  cfgParserOverridesForTests.set(language, parser);
}

export function runCfgAnalysis(input: RunCfgAnalysisInput): void {
  if (input.signal?.aborted) return;

  const functions = input.db
    .prepare(
      `
      SELECT
        nodes.id,
        nodes.file_path,
        nodes.language,
        nodes.kind,
        nodes.name,
        nodes.start_line,
        nodes.start_column,
        nodes.end_line,
        nodes.end_column,
        files.content_hash
      FROM nodes
      INNER JOIN files ON files.path = nodes.file_path
      WHERE nodes.kind IN (${CFG_FUNCTION_KINDS.map(() => '?').join(', ')})
      ORDER BY nodes.file_path, nodes.start_line, nodes.start_column, nodes.id
      `,
    )
    .all(...CFG_FUNCTION_KINDS) as CfgFunctionRow[];

  if (input.signal?.aborted) return;

  const writeCfg = input.db.transaction(() => {
    input.db.prepare('DELETE FROM cfg_status').run();

    for (const row of functions) {
      writeCfgForFunction(input.db, input.projectRoot, row);
    }
  });

  if (input.signal?.aborted) return;
  writeCfg();
}

export function readCfg(input: ReadCfgInput): CfgReadResult {
  const current = selectCurrentCfgFunction(input.db, input.functionId);
  const currentSourceVersion = current ? deriveSourceVersionForFunction(current) : null;
  const stored = selectStoredCfgStatus(input.db, input.functionId);
  const resolved = resolveCfgStatus({
    enabled: input.enabled,
    projectIndexed: input.projectIndexed ?? true,
    currentSourceVersion,
    stored: stored ? toStoredCfgStatus(stored) : null,
  });

  if (!resolved.carriesPayload) {
    return makeCfgReadResult({
      functionId: input.functionId,
      state: resolved.state,
      reason: resolved.reason,
      message: stored?.message,
      sourceVersion: resolved.sourceVersion,
    });
  }

  const sourceVersion = resolved.sourceVersion;
  if (sourceVersion === null || stored === null) {
    throw new TypeError('Invalid stored CFG payload: missing source version or status');
  }

  const graph = readStoredCfgGraph(input.db, input.functionId, stored.language, sourceVersion);
  const { cfg, page } = pageCfgGraph({ graph, request: input.request ?? {} });
  return makeCfgReadResult({
    functionId: input.functionId,
    state: resolved.state,
    reason: resolved.reason,
    message: stored.message,
    sourceVersion,
    cfg,
    page,
  });
}

function writeCfgForFunction(db: SqliteDatabase, projectRoot: string, row: CfgFunctionRow): void {
  const sourceVersion = deriveSourceVersionForFunction(row);
  if (!CFG_TSJS_LANGUAGE_SET.has(row.language)) {
    writeCfgStatus(db, row, {
      state: 'unsupported',
      reason: 'unsupported_language',
      message: 'CFG analysis does not support this function language.',
      sourceVersion,
    });
    return;
  }

  const parsed = parseCfgFunction(projectRoot, row);
  const unsupportedMessage = 'CFG lowering currently supports linear TypeScript/JavaScript functions only.';
  try {
    const status = !parsed.ok
      ? parsed
      : estimateCfgBlockDemand(parsed.node) > CFG_BASIC_BLOCK_LIMIT
        ? {
            state: 'resource_limited' as const,
            reason: 'block_limit_exceeded' as const,
            message: `CFG basic-block limit of ${CFG_BASIC_BLOCK_LIMIT} exceeded.`,
          }
        : isLinearTsJsFunctionNode(parsed.node)
          ? {
              state: 'available' as const,
              reason: null,
              message: '',
            }
          : {
              state: 'unsupported' as const,
              reason: 'unsupported_construct' as const,
              message: unsupportedMessage,
            };

    writeCfgStatus(db, row, { ...status, sourceVersion });

    if (status.state !== 'available' || !parsed.ok) return;

    const graph = lowerCfgIr(row, sourceVersion, buildLinearCfgIr(row, parsed.node));
    const insertBlock = db.prepare(
      `
      INSERT INTO cfg_blocks (function_id, block_id, ordinal, role, spans_json)
      VALUES (?, ?, ?, ?, ?)
      `,
    );
    const insertEdge = db.prepare(
      `
      INSERT INTO cfg_edges (function_id, edge_ordinal, source_block_id, target_block_id, kind)
      VALUES (?, ?, ?, ?, ?)
      `,
    );

    for (const block of graph.blocks) {
      insertBlock.run(row.id, block.id, block.ordinal, block.role, JSON.stringify(block.spans));
    }
    graph.edges.forEach((edge, edgeOrdinal) => {
      insertEdge.run(row.id, edgeOrdinal, edge.source, edge.target, edge.kind);
    });
  } finally {
    if (parsed.ok) parsed.tree.delete();
  }
}

function writeCfgStatus(
  db: SqliteDatabase,
  row: CfgFunctionRow,
  status: {
    state: StoredCfgState;
    reason: CfgReason | null;
    message: string;
    sourceVersion: string | null;
  },
): void {
  db.prepare(
    `
    INSERT INTO cfg_status (
      function_id,
      file_path,
      language,
      function_kind,
      function_name,
      start_line,
      start_column,
      end_line,
      end_column,
      state,
      reason,
      message,
      source_version,
      status_version,
      block_version,
      edge_version,
      schema_version,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    row.id,
    row.file_path,
    row.language,
    row.kind,
    row.name,
    row.start_line,
    row.start_column,
    row.end_line,
    row.end_column,
    status.state,
    status.reason,
    status.message,
    status.sourceVersion,
    CFG_STATUS_CONTRACT_VERSION,
    CFG_BLOCK_CONTRACT_VERSION,
    CFG_EDGE_CONTRACT_VERSION,
    CURRENT_SCHEMA_VERSION,
    Date.now(),
  );
}

function selectCurrentCfgFunction(db: SqliteDatabase, functionId: string): CfgFunctionRow | null {
  const row = db
    .prepare(
      `
      SELECT
        nodes.id,
        nodes.file_path,
        nodes.language,
        nodes.kind,
        nodes.name,
        nodes.start_line,
        nodes.start_column,
        nodes.end_line,
        nodes.end_column,
        files.content_hash
      FROM nodes
      INNER JOIN files ON files.path = nodes.file_path
      WHERE nodes.id = ?
        AND nodes.kind IN (${CFG_FUNCTION_KINDS.map(() => '?').join(', ')})
      `,
    )
    .get(functionId, ...CFG_FUNCTION_KINDS) as CfgFunctionRow | undefined;
  return row ?? null;
}

function selectStoredCfgStatus(db: SqliteDatabase, functionId: string): StoredCfgStatusRow | null {
  const row = db
    .prepare(
      `
      SELECT
        function_id,
        language,
        state,
        reason,
        message,
        source_version,
        status_version,
        block_version,
        edge_version
      FROM cfg_status
      WHERE function_id = ?
      `,
    )
    .get(functionId) as StoredCfgStatusRow | undefined;
  return row ?? null;
}

function toStoredCfgStatus(row: StoredCfgStatusRow): StoredCfgStatus {
  return {
    state: row.state,
    reason: row.reason,
    message: row.message,
    sourceVersion: row.source_version,
    statusVersion: Number(row.status_version),
    blockVersion: Number(row.block_version),
    edgeVersion: Number(row.edge_version),
  };
}

function readStoredCfgGraph(
  db: SqliteDatabase,
  functionId: string,
  language: string,
  sourceVersion: string,
): CfgGraph {
  const blocks = db
    .prepare(
      `
      SELECT block_id, ordinal, role, spans_json
      FROM cfg_blocks
      WHERE function_id = ?
      ORDER BY ordinal
      `,
    )
    .all(functionId) as StoredCfgBlockRow[];
  const edges = db
    .prepare(
      `
      SELECT source_block_id, target_block_id, kind
      FROM cfg_edges
      WHERE function_id = ?
      ORDER BY edge_ordinal
      `,
    )
    .all(functionId) as StoredCfgEdgeRow[];

  return {
    analysis: 'cfg',
    graphId: deriveCfgGraphId(functionId, sourceVersion),
    language,
    functionId,
    sourceVersion,
    blocks: blocks.map((block) => ({
      id: block.block_id,
      role: block.role,
      ordinal: Number(block.ordinal),
      spans: parseStoredSpans(block.spans_json),
    })),
    edges: edges.map((edge) => ({
      source: edge.source_block_id,
      target: edge.target_block_id,
      kind: edge.kind,
    })),
  };
}

function deriveSourceVersionForFunction(row: CfgFunctionRow): string {
  return deriveCfgSourceVersion({
    fileContentHash: row.content_hash,
    functionId: row.id,
    language: row.language,
    startLine: row.start_line,
    startColumn: row.start_column,
    endLine: row.end_line,
    endColumn: row.end_column,
    statusVersion: CFG_STATUS_CONTRACT_VERSION,
    blockVersion: CFG_BLOCK_CONTRACT_VERSION,
    edgeVersion: CFG_EDGE_CONTRACT_VERSION,
  });
}

function parseCfgFunction(projectRoot: string, row: CfgFunctionRow): CfgFunctionParseResult {
  const source = readIndexedFileSource(projectRoot, row.file_path);
  if (source === null) {
    return {
      ok: false,
      state: 'unavailable',
      reason: 'first_refresh_failed',
      message: 'Unable to read indexed function source.',
    };
  }

  const parser = getCfgParser(row.language, row.file_path);
  if (parser === null) {
    return {
      ok: false,
      state: 'unsupported',
      reason: 'parser_unavailable',
      message: 'Parser unavailable for CFG analysis.',
    };
  }

  let tree: Tree | null = null;
  try {
    tree = parser.parse(source) ?? null;
    if (tree === null) {
      return {
        ok: false,
        state: 'unsupported',
        reason: 'parse_error',
        message: 'Unable to parse function source for CFG analysis.',
      };
    }

    const node = findCfgFunctionNode(tree.rootNode, row, source);
    if (node === null) {
      tree.delete();
      return {
        ok: false,
        state: 'unsupported',
        reason: 'parse_error',
        message: 'Unable to locate indexed function in parsed source.',
      };
    }
    if (node.hasError || hasMissingSyntaxNode(node)) {
      tree.delete();
      return {
        ok: false,
        state: 'unsupported',
        reason: 'parse_unsafe_region',
        message: 'Function syntax contains a parse-unsafe region.',
      };
    }
    if (tree.rootNode.hasError) {
      tree.delete();
      return {
        ok: false,
        state: 'unsupported',
        reason: 'parse_error',
        message: 'Unable to parse complete source for CFG analysis.',
      };
    }

    return { ok: true, tree, node };
  } catch {
    tree?.delete();
    return {
      ok: false,
      state: 'unsupported',
      reason: 'parse_error',
      message: 'Unable to parse function source for CFG analysis.',
    };
  }
}

function getCfgParser(language: string, filePath: string): CfgParser | null {
  if (cfgParserOverridesForTests.has(language)) {
    return cfgParserOverridesForTests.get(language)!;
  }
  return getParser(language as Language, filePath);
}

function hasMissingSyntaxNode(node: SyntaxNode): boolean {
  if (node.isMissing) return true;
  for (let index = 0; index < node.namedChildCount; index++) {
    const child = node.namedChild(index);
    if (child && hasMissingSyntaxNode(child)) return true;
  }
  return false;
}

function estimateCfgBlockDemand(root: SyntaxNode): number {
  let demand = 3;
  const stack: SyntaxNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop()!;
    demand += CFG_CONSERVATIVE_BLOCK_DEMAND.get(node.type) ?? 0;
    if (demand > CFG_BASIC_BLOCK_LIMIT) return demand;

    for (let index = 0; index < node.namedChildCount; index++) {
      const child = node.namedChild(index);
      if (child) stack.push(child);
    }
  }

  return demand;
}

function findCfgFunctionNode(root: SyntaxNode, row: CfgFunctionRow, source: string): SyntaxNode | null {
  let best: SyntaxNode | null = null;
  const visit = (node: SyntaxNode): void => {
    if (
      CFG_TSJS_FUNCTION_NODE_TYPES.has(node.type) &&
      isNodeWithinIndexedSpan(node, row) &&
      cfgFunctionNameMatches(node, row, source) &&
      (best === null || node.endIndex - node.startIndex < best.endIndex - best.startIndex)
    ) {
      best = node;
    }

    for (let index = 0; index < node.namedChildCount; index++) {
      const child = node.namedChild(index);
      if (child) visit(child);
    }
  };
  visit(root);
  return best;
}

function cfgFunctionNameMatches(node: SyntaxNode, row: CfgFunctionRow, source: string): boolean {
  const nameNode =
    node.childForFieldName('name') ??
    node.namedChildren.find((child) => child.type === 'identifier' || child.type === 'property_identifier');
  if (!nameNode) return false;
  const name = getNodeText(nameNode, source).trim();
  return row.name === name || row.name.endsWith(`::${name}`) || row.name.endsWith(`.${name}`);
}

function isNodeWithinIndexedSpan(node: SyntaxNode, row: CfgFunctionRow): boolean {
  const nodeStartLine = node.startPosition.row + 1;
  const nodeStartColumn = node.startPosition.column;
  const nodeEndLine = node.endPosition.row + 1;
  const nodeEndColumn = node.endPosition.column;
  const startsAfterIndexedStart =
    nodeStartLine > row.start_line ||
    (nodeStartLine === row.start_line && nodeStartColumn >= row.start_column);
  const endsBeforeIndexedEnd =
    nodeEndLine < row.end_line ||
    (nodeEndLine === row.end_line && nodeEndColumn <= row.end_column);
  return startsAfterIndexedStart && endsBeforeIndexedEnd;
}

function isLinearTsJsFunctionNode(node: SyntaxNode): boolean {
  const body = getFunctionBodyNode(node);
  if (!body || body.type !== 'statement_block') return false;

  let sawReturn = false;
  for (const statement of body.namedChildren) {
    if (CFG_COMMENT_NODE_TYPES.has(statement.type)) continue;
    if (!LINEAR_BODY_STATEMENT_TYPES.has(statement.type)) return false;
    if (sawReturn) return false;
    if (hasUnsupportedLinearDescendant(statement)) return false;
    if (statement.type === 'return_statement') sawReturn = true;
  }
  return true;
}

function hasUnsupportedLinearDescendant(node: SyntaxNode): boolean {
  if (CFG_COMMENT_NODE_TYPES.has(node.type)) return false;
  if (UNSUPPORTED_LINEAR_DESCENDANT_TYPES.has(node.type) || node.type === 'ERROR') return true;
  if (!LINEAR_DESCENDANT_TYPES.has(node.type)) return true;
  for (let index = 0; index < node.namedChildCount; index++) {
    const child = node.namedChild(index);
    if (child && hasUnsupportedLinearDescendant(child)) return true;
  }
  return false;
}

function getFunctionBodyNode(node: SyntaxNode): SyntaxNode | null {
  return node.childForFieldName('body') ?? node.namedChildren.find((child) => child.type === 'statement_block') ?? null;
}

function functionBodyEndsWithReturn(node: SyntaxNode): boolean {
  const body = getFunctionBodyNode(node);
  if (!body) return false;
  const statements = body.namedChildren.filter((child) => !CFG_COMMENT_NODE_TYPES.has(child.type));
  return statements.at(-1)?.type === 'return_statement';
}

function buildLinearCfgIr(row: CfgFunctionRow, node: SyntaxNode): CfgIr {
  const exitEdgeKind: CfgEdge['kind'] = functionBodyEndsWithReturn(node) ? 'return' : 'fallthrough';
  return {
    blocks: [
      { role: 'entry', spans: [] },
      {
        role: 'body',
        spans: [
          {
            startLine: row.start_line,
            startColumn: row.start_column,
            endLine: row.end_line,
            endColumn: row.end_column,
          },
        ],
      },
      { role: 'exit', spans: [] },
    ],
    edges: [
      { sourceOrdinal: 0, targetOrdinal: 1, kind: 'fallthrough' },
      { sourceOrdinal: 1, targetOrdinal: 2, kind: exitEdgeKind },
    ],
  };
}

function lowerCfgIr(row: CfgFunctionRow, sourceVersion: string, ir: CfgIr): CfgGraph {
  const blocks = ir.blocks.map((block, ordinal) => ({
    id: deriveCfgBlockId(row.id, sourceVersion, ordinal, block.role),
    role: block.role,
    ordinal,
    spans: block.spans,
  }));
  return {
    analysis: 'cfg',
    graphId: deriveCfgGraphId(row.id, sourceVersion),
    language: row.language,
    functionId: row.id,
    sourceVersion,
    blocks,
    edges: ir.edges.map((edge) => ({
      source: blocks[edge.sourceOrdinal]!.id,
      target: blocks[edge.targetOrdinal]!.id,
      kind: edge.kind,
    })),
  };
}

function deriveCfgGraphId(functionId: string, sourceVersion: string): string {
  return deriveStableCfgId('cfg', [functionId, sourceVersion]);
}

function deriveCfgBlockId(
  functionId: string,
  sourceVersion: string,
  ordinal: number,
  role: CfgBlock['role'],
): string {
  return deriveStableCfgId('cfgblock', [functionId, sourceVersion, ordinal, role]);
}

function deriveStableCfgId(prefix: string, parts: readonly unknown[]): string {
  const digest = crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  return `${prefix}:${digest.slice(0, 24)}`;
}

function readIndexedFileSource(projectRoot: string, filePath: string): string | null {
  try {
    const root = path.resolve(projectRoot);
    const absolutePath = path.resolve(root, filePath);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) return null;
    return fs.readFileSync(absolutePath, 'utf8');
  } catch {
    return null;
  }
}

function parseStoredSpans(value: string): CfgBlock['spans'] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSpan);
  } catch {
    return [];
  }
}

export function deriveCfgSourceVersion(input: CfgSourceVersionInput): string {
  const payload = {
    fileContentHash: input.fileContentHash,
    functionId: input.functionId,
    language: input.language,
    span: {
      startLine: input.startLine,
      startColumn: input.startColumn,
      endLine: input.endLine,
      endColumn: input.endColumn,
    },
    contracts: {
      statusVersion: input.statusVersion,
      blockVersion: input.blockVersion,
      edgeVersion: input.edgeVersion,
    },
  };
  const digest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `cfgsrc:v1:${digest}`;
}

export function normalizeCfgPageRequest(request: CfgPageRequest): NormalizedCfgPageRequest {
  const rawLimit = Number.isFinite(request.limit) ? Math.trunc(request.limit!) : 100;
  const rawOffset = Number.isFinite(request.offset) ? Math.trunc(request.offset!) : 0;
  return {
    limit: Math.min(500, Math.max(1, rawLimit)),
    offset: Math.max(0, rawOffset),
  };
}

function pagePart(total: number, request: NormalizedCfgPageRequest): CfgPage['blocks'] {
  const boundedTotal = Math.max(0, Math.trunc(total));
  const returned = Math.max(0, Math.min(request.limit, boundedTotal - request.offset));
  const nextOffset = request.offset + returned;
  const hasMore = nextOffset < boundedTotal;
  return {
    total: boundedTotal,
    returned,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
  };
}

export function buildCfgPage(input: BuildCfgPageInput): CfgPage {
  const request = normalizeCfgPageRequest(input);
  return {
    ...request,
    blocks: pagePart(input.totalBlocks, request),
    edges: pagePart(input.totalEdges, request),
  };
}

export function pageCfgGraph(input: PageCfgGraphInput): { cfg: CfgGraph; page: CfgPage } {
  const request = normalizeCfgPageRequest(input.request);
  const page = buildCfgPage({
    ...request,
    totalBlocks: input.graph.blocks.length,
    totalEdges: input.graph.edges.length,
  });
  return {
    cfg: {
      ...input.graph,
      blocks: input.graph.blocks.slice(request.offset, request.offset + request.limit),
      edges: input.graph.edges.slice(request.offset, request.offset + request.limit),
    },
    page,
  };
}

export function safeCfgMessage(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (value instanceof Error) return 'CFG analysis result unavailable.';
  if (typeof value !== 'string') return 'CFG analysis result unavailable.';
  return [...value.replace(/\s+/g, ' ').trim()].slice(0, 240).join('');
}

export function resolveCfgStatus(input: ResolveCfgStatusInput): ResolvedCfgStatus {
  if (!input.enabled) {
    return {
      state: 'disabled',
      reason: 'analysis_disabled',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    };
  }
  if (!input.projectIndexed) {
    return {
      state: 'not_indexed',
      reason: 'project_not_indexed',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    };
  }
  if (input.currentSourceVersion === null) {
    return input.stored
      ? {
          state: 'deleted',
          reason: 'function_deleted',
          stale: false,
          sourceVersion: null,
          carriesPayload: false,
        }
      : {
          state: 'unknown_function',
          reason: 'function_unknown',
          stale: false,
          sourceVersion: null,
          carriesPayload: false,
        };
  }
  if (!input.stored) {
    return {
      state: 'not_computed',
      reason: 'cfg_not_computed',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    };
  }
  if (input.stored.state === 'deleted') {
    return {
      state: 'deleted',
      reason: 'function_deleted',
      stale: false,
      sourceVersion: null,
      carriesPayload: false,
    };
  }

  const expectedStatusVersion = input.statusVersion ?? CFG_STATUS_CONTRACT_VERSION;
  const expectedBlockVersion = input.blockVersion ?? CFG_BLOCK_CONTRACT_VERSION;
  const expectedEdgeVersion = input.edgeVersion ?? CFG_EDGE_CONTRACT_VERSION;
  const versionMismatch =
    input.stored.statusVersion !== expectedStatusVersion ||
    input.stored.blockVersion !== expectedBlockVersion ||
    input.stored.edgeVersion !== expectedEdgeVersion;
  if (input.stored.sourceVersion !== input.currentSourceVersion || versionMismatch) {
    if (input.stored.state !== 'available') {
      return {
        state: 'not_computed',
        reason: 'cfg_not_computed',
        stale: false,
        sourceVersion: null,
        carriesPayload: false,
      };
    }
    return {
      state: 'stale',
      reason: 'source_version_mismatch',
      stale: true,
      sourceVersion: input.stored.sourceVersion,
      carriesPayload: true,
    };
  }

  return {
    state: input.stored.state,
    reason: input.stored.reason,
    stale: false,
    sourceVersion: input.stored.sourceVersion,
    carriesPayload: input.stored.state === 'available',
  };
}

export function makeCfgReadResult(input: MakeCfgReadResultInput): CfgReadResult {
  const carriesPayload = input.state === 'available' || input.state === 'stale';
  const hasCompletePayload = input.cfg !== undefined && input.cfg !== null && input.page !== undefined && input.page !== null;
  const sourceVersion = input.sourceVersion ?? input.cfg?.sourceVersion ?? null;
  if (carriesPayload && !hasCompletePayload) {
    throw new TypeError(`Invalid CfgReadResult: ${input.state} requires complete cfg and page`);
  }
  const result: CfgReadResult = {
    analysis: 'cfg',
    functionId: input.functionId,
    state: input.state,
    reason: input.reason,
    message: safeCfgMessage(input.message),
    sourceVersion,
    stale: input.state === 'stale',
    cfg: carriesPayload && hasCompletePayload ? input.cfg! : null,
    page: carriesPayload && hasCompletePayload ? input.page! : null,
  };
  if (!isCfgReadResult(result)) {
    throw new TypeError('Invalid CfgReadResult: constructed result violates CFG contract');
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isSpan(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.startLine) &&
    isNonNegativeInteger(value.startColumn) &&
    isNonNegativeInteger(value.endLine) &&
    isNonNegativeInteger(value.endColumn)
  );
}

function isCfgBlock(value: unknown): value is CfgBlock {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.role === 'string' &&
    CFG_BLOCK_ROLES.has(value.role) &&
    isNonNegativeInteger(value.ordinal) &&
    Array.isArray(value.spans) &&
    value.spans.every(isSpan)
  );
}

function isCfgEdge(value: unknown): value is CfgEdge {
  return (
    isRecord(value) &&
    typeof value.source === 'string' &&
    typeof value.target === 'string' &&
    typeof value.kind === 'string' &&
    CFG_EDGE_KINDS.has(value.kind)
  );
}

function isCfgGraph(value: unknown, functionId: string, sourceVersion: string): value is CfgGraph {
  return (
    isRecord(value) &&
    value.analysis === 'cfg' &&
    typeof value.graphId === 'string' &&
    typeof value.language === 'string' &&
    value.functionId === functionId &&
    value.sourceVersion === sourceVersion &&
    Array.isArray(value.blocks) &&
    value.blocks.every(isCfgBlock) &&
    Array.isArray(value.edges) &&
    value.edges.every(isCfgEdge)
  );
}

function isPagePart(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.total) &&
    isNonNegativeInteger(value.returned) &&
    value.returned <= value.total &&
    typeof value.hasMore === 'boolean' &&
    (value.nextOffset === null || isNonNegativeInteger(value.nextOffset)) &&
    (value.hasMore || value.nextOffset === null)
  );
}

function isCfgPage(value: unknown): value is CfgPage {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.limit) &&
    isNonNegativeInteger(value.offset) &&
    isPagePart(value.blocks) &&
    isPagePart(value.edges)
  );
}

export function isCfgReadResult(value: unknown): value is CfgReadResult {
  if (!isRecord(value) || !hasExactKeys(value, RESULT_KEYS)) return false;
  if (value.analysis !== 'cfg') return false;
  if (typeof value.functionId !== 'string') return false;
  if (typeof value.state !== 'string' || !CFG_STATES.has(value.state)) return false;
  if (typeof value.message !== 'string' || [...value.message].length > 240) return false;
  if (typeof value.stale !== 'boolean' || value.stale !== (value.state === 'stale')) return false;
  if (!(value.sourceVersion === null || typeof value.sourceVersion === 'string')) return false;

  const allowedReasons = REASONS_BY_STATE[value.state as CfgState];
  if (!allowedReasons.has(value.reason as CfgReason | null)) return false;

  const carriesPayload = value.state === 'available' || value.state === 'stale';
  if (!carriesPayload) return value.cfg === null && value.page === null;
  if (typeof value.sourceVersion !== 'string') return false;
  return isCfgGraph(value.cfg, value.functionId, value.sourceVersion) && isCfgPage(value.page);
}
