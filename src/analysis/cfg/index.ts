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

interface CfgPendingTransfer {
  fromOrdinal: number;
  kind: CfgEdge['kind'];
  label?: string | null;
}

interface CfgStatementFlow {
  continues: CfgPendingTransfer[];
  terminals: CfgPendingTransfer[];
}

interface CfgExpressionFlow {
  exits: CfgPendingTransfer[];
  definitelyNullishExits: CfgPendingTransfer[];
}

interface CfgConditionFlow {
  trueTransfers: CfgPendingTransfer[];
  falseTransfers: CfgPendingTransfer[];
}

interface CfgLoopConditionFlow extends CfgConditionFlow {
  reentryOrdinal: number;
}

interface OptionalMemberChain {
  base: SyntaxNode;
  segments: SyntaxNode[];
}

type CfgTerminalMode = 'collect' | 'emit';

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

const CFG_EXIT_TARGET_ORDINAL = -1;

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

const CFG_EDGE_KIND_VALUES = [
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
] as const satisfies readonly CfgEdge['kind'][];
const CFG_EDGE_KINDS: ReadonlySet<string> = new Set(CFG_EDGE_KIND_VALUES);
const CFG_EDGE_KIND_ORDER: ReadonlyMap<CfgEdge['kind'], number> = new Map(
  CFG_EDGE_KIND_VALUES.map((kind, index) => [kind, index]),
);

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
const DEFERRED_EXPRESSION_BRANCH_TYPES: ReadonlySet<string> = new Set([
  'conditional_expression',
  'optional_chain',
  'ternary_expression',
]);
const DEFERRED_BINARY_OPERATORS: ReadonlySet<string> = new Set(['&&', '||', '??']);
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
  const unsupportedMessage = 'CFG lowering does not support this TypeScript/JavaScript construct yet.';
  try {
    const blockDemand = parsed.ok ? estimateCfgBlockDemand(parsed.node) : null;
    const cfgIr = parsed.ok && blockDemand !== null && blockDemand <= CFG_BASIC_BLOCK_LIMIT
      ? buildCfgIrForFunction(row, parsed.node)
      : null;
    const status = !parsed.ok
      ? parsed
      : blockDemand !== null && blockDemand > CFG_BASIC_BLOCK_LIMIT
        ? {
            state: 'resource_limited' as const,
            reason: 'block_limit_exceeded' as const,
            message: `CFG basic-block limit of ${CFG_BASIC_BLOCK_LIMIT} exceeded.`,
          }
        : cfgIr && cfgIr.blocks.length > CFG_BASIC_BLOCK_LIMIT
          ? {
              state: 'resource_limited' as const,
              reason: 'block_limit_exceeded' as const,
              message: `CFG basic-block limit of ${CFG_BASIC_BLOCK_LIMIT} exceeded.`,
            }
        : cfgIr
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

    const graph = lowerCfgIr(row, sourceVersion, cfgIr!);
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

function buildCfgIrForFunction(row: CfgFunctionRow, node: SyntaxNode): CfgIr | null {
  if (isLinearTsJsFunctionNode(node)) return buildLinearCfgIr(row, node);
  return new StructuredCfgBuilder().buildFunction(node);
}

class StructuredCfgBuilder {
  private readonly blocks: CfgBlockIr[] = [];
  private readonly edges: CfgEdgeIr[] = [];

  buildFunction(node: SyntaxNode): CfgIr | null {
    const body = getFunctionBodyNode(node);
    if (!body || body.type !== 'statement_block') return null;

    const entryOrdinal = this.addBlock('entry');
    const flow = this.buildStatementSequence(getStatementBlockStatements(body), [
      { fromOrdinal: entryOrdinal, kind: 'fallthrough' },
    ], 'emit');
    if (!flow) return null;

    const exitOrdinal = this.addBlock('exit');
    for (const continuation of flow.continues) {
      this.addEdge(continuation.fromOrdinal, exitOrdinal, continuation.kind);
    }
    for (const terminal of flow.terminals) {
      if (!isFunctionExitTransferKind(terminal.kind)) return null;
      this.addEdge(terminal.fromOrdinal, exitOrdinal, terminal.kind);
    }

    return {
      blocks: this.blocks,
      edges: this.edges.map((edge) => ({
        ...edge,
        targetOrdinal: edge.targetOrdinal === CFG_EXIT_TARGET_ORDINAL ? exitOrdinal : edge.targetOrdinal,
      })),
    };
  }

  private buildStatementSequence(
    statements: readonly SyntaxNode[],
    incoming: readonly CfgPendingTransfer[],
    terminalMode: CfgTerminalMode,
  ): CfgStatementFlow | null {
    let continues = [...incoming];
    const terminals: CfgPendingTransfer[] = [];

    for (const statement of statements) {
      if (continues.length === 0) return null;

      const flow = this.buildStatement(statement, continues, terminalMode);
      if (!flow) return null;
      terminals.push(...flow.terminals);
      continues = flow.continues;
    }

    return { continues, terminals };
  }

  private buildStatement(
    statement: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
    terminalMode: CfgTerminalMode,
    labels: readonly string[] = [],
  ): CfgStatementFlow | null {
    if (statement.type === 'labeled_statement') {
      return this.buildLabeledStatement(statement, incoming, terminalMode, labels);
    }
    if (statement.type === 'statement_block') {
      return this.buildStatementSequence(getStatementBlockStatements(statement), incoming, terminalMode);
    }
    if (statement.type === 'if_statement') {
      return this.buildIfStatement(statement, incoming, terminalMode);
    }
    if (statement.type === 'switch_statement') {
      return this.buildSwitchStatement(statement, incoming, terminalMode, labels);
    }
    if (statement.type === 'for_statement') {
      return this.buildForStatement(statement, incoming, terminalMode, labels);
    }
    if (statement.type === 'while_statement') {
      return this.buildWhileStatement(statement, incoming, terminalMode, labels);
    }
    if (statement.type === 'try_statement') {
      return this.buildTryFinallyStatement(statement, incoming, terminalMode);
    }
    if (statement.type === 'return_statement') {
      return this.buildTerminalStatement(statement, incoming, terminalMode, 'return');
    }
    if (statement.type === 'throw_statement') {
      return this.buildTerminalStatement(statement, incoming, terminalMode, 'throw');
    }
    if (statement.type === 'break_statement') {
      return this.buildJumpStatement(statement, incoming, terminalMode, 'break');
    }
    if (statement.type === 'continue_statement') {
      return this.buildJumpStatement(statement, incoming, terminalMode, 'continue');
    }
    if (isSimpleStructuredStatement(statement)) {
      return this.buildValueStatement(statement, incoming);
    }
    return null;
  }

  private buildTerminalStatement(
    statement: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
    terminalMode: CfgTerminalMode,
    kind: Extract<CfgEdge['kind'], 'return' | 'throw'>,
  ): CfgStatementFlow | null {
    const expression = getStatementExpression(statement);
    const expressionIncoming = expression && hasModeledExpressionBranching(expression)
      ? this.buildExpressionValue(expression, incoming, true)
      : null;
    if (expression && hasModeledExpressionBranching(expression) && !expressionIncoming) return null;

    const blockOrdinal = this.addBodyBlock(statement);
    this.connectIncoming(expressionIncoming ? allExpressionExits(expressionIncoming) : incoming, blockOrdinal);
    return this.handleTerminalTransfer({ fromOrdinal: blockOrdinal, kind }, terminalMode);
  }

  private buildValueStatement(
    statement: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
  ): CfgStatementFlow | null {
    let continues = [...incoming];
    for (const expression of getStatementValueExpressions(statement)) {
      if (!hasModeledExpressionBranching(expression)) continue;
      const expressionFlow = this.buildExpressionValue(expression, continues, true);
      if (!expressionFlow) return null;
      continues = allExpressionExits(expressionFlow);
    }

    const blockOrdinal = this.addBodyBlock(statement);
    this.connectIncoming(continues, blockOrdinal);
    return {
      continues: [{ fromOrdinal: blockOrdinal, kind: 'fallthrough' }],
      terminals: [],
    };
  }

  private buildIfStatement(
    statement: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
    terminalMode: CfgTerminalMode,
  ): CfgStatementFlow | null {
    const consequence = statement.childForFieldName('consequence');
    if (!consequence) return null;

    const condition = statement.childForFieldName('condition') ?? statement;
    const conditionFlow = this.buildConditionExpression(condition, incoming);
    if (!conditionFlow) return null;

    const trueFlow = this.buildStatement(consequence, conditionFlow.trueTransfers, terminalMode);
    if (!trueFlow) return null;

    const continues = [...trueFlow.continues];
    const terminals = [...trueFlow.terminals];
    const alternative = getElseClauseStatement(statement.childForFieldName('alternative'));
    if (alternative) {
      const falseFlow = this.buildStatement(alternative, conditionFlow.falseTransfers, terminalMode);
      if (!falseFlow) return null;
      continues.push(...falseFlow.continues);
      terminals.push(...falseFlow.terminals);
    } else {
      continues.push(...conditionFlow.falseTransfers);
    }

    return { continues, terminals };
  }

  private buildLabeledStatement(
    statement: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
    terminalMode: CfgTerminalMode,
    labels: readonly string[],
  ): CfgStatementFlow | null {
    const label = getStatementLabelName(statement);
    const body = getLabeledStatementBody(statement);
    if (!label || !body || labels.includes(label)) return null;

    if (isLoopStatement(body)) {
      return this.buildStatement(body, incoming, terminalMode, [...labels, label]);
    }
    if (body.type === 'labeled_statement' && labeledStatementUltimatelyTargetsLoop(body)) {
      return this.buildStatement(body, incoming, terminalMode, [...labels, label]);
    }

    const flow = this.buildStatement(body, incoming, terminalMode, labels);
    if (!flow) return null;

    const continues = [...flow.continues];
    const terminals: CfgPendingTransfer[] = [];
    for (const terminal of flow.terminals) {
      if (terminal.kind === 'break' && terminal.label === label) {
        continues.push(terminal);
      } else {
        terminals.push(terminal);
      }
    }

    return { continues, terminals };
  }

  private buildSwitchStatement(
    statement: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
    terminalMode: CfgTerminalMode,
    labels: readonly string[],
  ): CfgStatementFlow | null {
    const condition = getSwitchConditionExpression(statement);
    const body = statement.childForFieldName('body');
    if (!condition || !body || body.type !== 'switch_body') return null;

    const conditionOrdinal = this.addSwitchDiscriminantBlock(condition, incoming);
    if (conditionOrdinal === null) return null;

    const clauses = getSwitchClauses(body);
    const continues: CfgPendingTransfer[] = [];
    const terminals: CfgPendingTransfer[] = [];
    let fallthrough: CfgPendingTransfer[] = [];
    let hasDefault = false;

    for (const clause of clauses) {
      const dispatchKind: CfgEdge['kind'] = clause.type === 'switch_default' ? 'default' : 'case';
      if (dispatchKind === 'default') hasDefault = true;

      const clauseIncoming = [
        { fromOrdinal: conditionOrdinal, kind: dispatchKind },
        ...fallthrough,
      ];
      const statements = getSwitchClauseStatements(clause);
      if (statements.length === 0) {
        fallthrough = clauseIncoming;
        continue;
      }

      const flow = this.buildStatementSequence(statements, clauseIncoming, terminalMode);
      if (!flow) return null;
      const partition = partitionBreakTransfers(flow.terminals, labels);
      continues.push(...partition.consumed);
      terminals.push(...partition.remaining);
      fallthrough = flow.continues;
    }

    continues.push(...fallthrough);
    if (!hasDefault) {
      continues.push({ fromOrdinal: conditionOrdinal, kind: 'default' });
    }

    return { continues, terminals };
  }

  private buildForStatement(
    statement: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
    terminalMode: CfgTerminalMode,
    labels: readonly string[],
  ): CfgStatementFlow | null {
    let loopIncoming = [...incoming];
    const initializer = statement.childForFieldName('initializer');
    if (initializer && initializer.type !== 'empty_statement') {
      const initFlow = this.buildLoopInitializer(initializer, loopIncoming);
      if (!initFlow || initFlow.terminals.length > 0) return null;
      loopIncoming = initFlow.continues;
    }

    const condition = getForConditionExpression(statement);
    const conditionFlow = condition
      ? this.buildLoopCondition(condition, loopIncoming)
      : this.buildInfiniteLoopCondition(statement, loopIncoming);
    if (!conditionFlow) return null;

    const body = statement.childForFieldName('body');
    if (!body) return null;

    const bodyFlow = this.buildStatement(body, conditionFlow.trueTransfers, terminalMode);
    if (!bodyFlow) return null;

    const partition = partitionLoopTransfers(bodyFlow.terminals, labels);
    const loopBackTransfers = [...bodyFlow.continues, ...partition.continues];
    const update = statement.childForFieldName('increment');
    if (update) {
      const updateFlow = this.buildLoopUpdate(update, loopBackTransfers);
      if (!updateFlow || updateFlow.terminals.length > 0) return null;
      for (const transfer of updateFlow.continues) {
        this.addEdge(transfer.fromOrdinal, conditionFlow.reentryOrdinal, 'loop_back');
      }
    } else {
      for (const transfer of loopBackTransfers) {
        this.addEdge(
          transfer.fromOrdinal,
          conditionFlow.reentryOrdinal,
          transfer.kind === 'continue' ? 'continue' : 'loop_back',
        );
      }
    }

    return {
      continues: [
        ...conditionFlow.falseTransfers,
        ...partition.breaks,
      ],
      terminals: partition.remaining,
    };
  }

  private buildLoopUpdate(
    expression: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
  ): CfgStatementFlow | null {
    const node = unwrapStatementExpressionNode(expression);
    if (hasModeledExpressionBranching(node)) {
      const expressionFlow = this.buildExpressionValue(node, incoming, true);
      if (!expressionFlow) return null;
      return { continues: allExpressionExits(expressionFlow), terminals: [] };
    }

    const updateOrdinal = this.addBodyBlock(node);
    this.connectIncoming(incoming, updateOrdinal);
    return {
      continues: [{ fromOrdinal: updateOrdinal, kind: 'fallthrough' }],
      terminals: [],
    };
  }

  private buildWhileStatement(
    statement: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
    terminalMode: CfgTerminalMode,
    labels: readonly string[],
  ): CfgStatementFlow | null {
    const condition = statement.childForFieldName('condition');
    const body = statement.childForFieldName('body');
    if (!condition || !body) return null;

    const conditionFlow = this.buildLoopCondition(condition, incoming);
    if (!conditionFlow) return null;

    const bodyFlow = this.buildStatement(body, conditionFlow.trueTransfers, terminalMode);
    if (!bodyFlow) return null;

    const partition = partitionLoopTransfers(bodyFlow.terminals, labels);
    for (const transfer of bodyFlow.continues) {
      this.addEdge(transfer.fromOrdinal, conditionFlow.reentryOrdinal, 'loop_back');
    }
    for (const transfer of partition.continues) {
      this.addEdge(transfer.fromOrdinal, conditionFlow.reentryOrdinal, 'continue');
    }

    return {
      continues: [
        ...conditionFlow.falseTransfers,
        ...partition.breaks,
      ],
      terminals: partition.remaining,
    };
  }

  private buildLoopInitializer(
    statement: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
  ): CfgStatementFlow | null {
    if (isSimpleStructuredStatement(statement)) {
      return this.buildValueStatement(statement, incoming);
    }

    if (hasModeledExpressionBranching(statement)) return null;

    const blockOrdinal = this.addBodyBlock(statement);
    this.connectIncoming(incoming, blockOrdinal);
    return {
      continues: [{ fromOrdinal: blockOrdinal, kind: 'fallthrough' }],
      terminals: [],
    };
  }

  private buildJumpStatement(
    statement: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
    terminalMode: CfgTerminalMode,
    kind: Extract<CfgEdge['kind'], 'break' | 'continue'>,
  ): CfgStatementFlow {
    const blockOrdinal = this.addBodyBlock(statement);
    this.connectIncoming(incoming, blockOrdinal);
    return this.handleTerminalTransfer({
      fromOrdinal: blockOrdinal,
      kind,
      label: getTransferStatementLabel(statement),
    }, terminalMode);
  }

  private addSwitchDiscriminantBlock(
    condition: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
  ): number | null {
    const node = unwrapStatementExpressionNode(condition);
    const expressionFlow = hasModeledExpressionBranching(node)
      ? this.buildExpressionValue(node, incoming, true)
      : null;
    if (hasModeledExpressionBranching(node) && !expressionFlow) return null;

    const conditionOrdinal = this.addBlock('condition', node);
    this.connectIncoming(expressionFlow ? allExpressionExits(expressionFlow) : incoming, conditionOrdinal);
    return conditionOrdinal;
  }

  private buildLoopCondition(
    condition: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
  ): CfgLoopConditionFlow | null {
    const node = unwrapStatementExpressionNode(condition);
    if (!hasModeledExpressionBranching(node)) {
      const conditionOrdinal = this.addBlock('condition', node);
      this.connectIncoming(incoming, conditionOrdinal);
      return {
        reentryOrdinal: conditionOrdinal,
        trueTransfers: [{ fromOrdinal: conditionOrdinal, kind: 'true' }],
        falseTransfers: [{ fromOrdinal: conditionOrdinal, kind: 'false' }],
      };
    }

    const anchorOrdinal = this.addBlock('condition', node);
    this.connectIncoming(incoming, anchorOrdinal);
    const conditionFlow = this.buildConditionExpression(node, [
      { fromOrdinal: anchorOrdinal, kind: 'fallthrough' },
    ]);
    if (!conditionFlow) return null;

    return {
      reentryOrdinal: anchorOrdinal,
      trueTransfers: conditionFlow.trueTransfers,
      falseTransfers: conditionFlow.falseTransfers,
    };
  }

  private buildInfiniteLoopCondition(
    statement: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
  ): CfgLoopConditionFlow {
    const conditionOrdinal = this.addBlock('condition', statement);
    this.connectIncoming(incoming, conditionOrdinal);
    return {
      reentryOrdinal: conditionOrdinal,
      trueTransfers: [{ fromOrdinal: conditionOrdinal, kind: 'true' }],
      falseTransfers: [],
    };
  }

  private buildExpressionValue(
    expression: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
    materializeLeaf: boolean,
  ): CfgExpressionFlow | null {
    const node = unwrapExpressionNode(expression);
    const binaryOperator = node.type === 'binary_expression' ? getBinaryOperator(node) : null;
    if (binaryOperator === '&&') {
      const operands = getBinaryOperands(node);
      if (!operands) return null;
      const left = this.buildConditionExpression(operands.left, incoming);
      if (!left) return null;
      const right = this.buildExpressionValue(operands.right, left.trueTransfers, true);
      if (!right) return null;
      return {
        exits: [...left.falseTransfers, ...allExpressionExits(right)],
        definitelyNullishExits: [],
      };
    }
    if (binaryOperator === '||') {
      const operands = getBinaryOperands(node);
      if (!operands) return null;
      const left = this.buildConditionExpression(operands.left, incoming);
      if (!left) return null;
      const right = this.buildExpressionValue(operands.right, left.falseTransfers, true);
      if (!right) return null;
      return {
        exits: [...left.trueTransfers, ...allExpressionExits(right)],
        definitelyNullishExits: [],
      };
    }
    if (binaryOperator === '??') {
      return this.buildNullishCoalescingExpression(node, incoming);
    }
    if (node.type === 'ternary_expression' || node.type === 'conditional_expression') {
      return this.buildTernaryExpression(node, incoming);
    }
    if (isOptionalMemberExpression(node)) {
      return this.buildOptionalChainExpression(node, incoming);
    }
    if (node.type === 'call_expression' || node.type === 'new_expression') {
      return this.buildCallLikeExpression(node, incoming, materializeLeaf);
    }
    if (node.type === 'subscript_expression') {
      return this.buildSubscriptExpression(node, incoming, materializeLeaf);
    }
    if (node.type === 'member_expression') {
      return this.buildMemberWrapperExpression(node, incoming, materializeLeaf);
    }

    if (hasModeledExpressionBranching(node)) return null;

    if (!materializeLeaf) {
      return { exits: [...incoming], definitelyNullishExits: [] };
    }

    const blockOrdinal = this.addBodyBlock(node);
    this.connectIncoming(incoming, blockOrdinal);
    return {
      exits: [{ fromOrdinal: blockOrdinal, kind: 'fallthrough' }],
      definitelyNullishExits: [],
    };
  }

  private buildConditionExpression(
    expression: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
  ): CfgConditionFlow | null {
    const node = unwrapExpressionNode(expression);
    const binaryOperator = node.type === 'binary_expression' ? getBinaryOperator(node) : null;
    if (binaryOperator === '&&') {
      const operands = getBinaryOperands(node);
      if (!operands) return null;
      const left = this.buildConditionExpression(operands.left, incoming);
      if (!left) return null;
      const right = this.buildConditionExpression(operands.right, left.trueTransfers);
      if (!right) return null;
      return {
        trueTransfers: right.trueTransfers,
        falseTransfers: [...left.falseTransfers, ...right.falseTransfers],
      };
    }
    if (binaryOperator === '||') {
      const operands = getBinaryOperands(node);
      if (!operands) return null;
      const left = this.buildConditionExpression(operands.left, incoming);
      if (!left) return null;
      const right = this.buildConditionExpression(operands.right, left.falseTransfers);
      if (!right) return null;
      return {
        trueTransfers: [...left.trueTransfers, ...right.trueTransfers],
        falseTransfers: right.falseTransfers,
      };
    }
    if (node.type === 'ternary_expression' || node.type === 'conditional_expression') {
      const parts = getTernaryParts(node);
      if (!parts) return null;
      const condition = this.buildConditionExpression(parts.condition, incoming);
      if (!condition) return null;
      const consequence = this.buildConditionExpression(parts.consequence, condition.trueTransfers);
      if (!consequence) return null;
      const alternative = this.buildConditionExpression(parts.alternative, condition.falseTransfers);
      if (!alternative) return null;
      return {
        trueTransfers: [...consequence.trueTransfers, ...alternative.trueTransfers],
        falseTransfers: [...consequence.falseTransfers, ...alternative.falseTransfers],
      };
    }
    if (hasModeledExpressionBranching(node)) {
      const value = this.buildExpressionValue(node, incoming, true);
      if (!value) return null;
      const conditionOrdinal = this.addBlock('condition', node);
      this.connectIncoming(allExpressionExits(value), conditionOrdinal);
      return {
        trueTransfers: [{ fromOrdinal: conditionOrdinal, kind: 'true' }],
        falseTransfers: [{ fromOrdinal: conditionOrdinal, kind: 'false' }],
      };
    }

    const conditionOrdinal = this.addBlock('condition', node);
    this.connectIncoming(incoming, conditionOrdinal);
    return {
      trueTransfers: [{ fromOrdinal: conditionOrdinal, kind: 'true' }],
      falseTransfers: [{ fromOrdinal: conditionOrdinal, kind: 'false' }],
    };
  }

  private buildNullishCoalescingExpression(
    expression: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
  ): CfgExpressionFlow | null {
    const operands = getBinaryOperands(expression);
    if (!operands) return null;

    let nonNullishTransfers: CfgPendingTransfer[];
    let nullishTransfers: CfgPendingTransfer[];
    if (hasModeledExpressionBranching(operands.left)) {
      const left = this.buildExpressionValue(operands.left, incoming, true);
      if (!left) return null;
      const conditionOrdinal = this.addBlock('condition', operands.left);
      this.connectIncoming(left.exits, conditionOrdinal);
      nonNullishTransfers = [{ fromOrdinal: conditionOrdinal, kind: 'true' }];
      nullishTransfers = [
        ...left.definitelyNullishExits,
        { fromOrdinal: conditionOrdinal, kind: 'false' },
      ];
    } else {
      const conditionOrdinal = this.addBlock('condition', operands.left);
      this.connectIncoming(incoming, conditionOrdinal);
      nonNullishTransfers = [{ fromOrdinal: conditionOrdinal, kind: 'true' }];
      nullishTransfers = [{ fromOrdinal: conditionOrdinal, kind: 'false' }];
    }

    const right = this.buildExpressionValue(operands.right, nullishTransfers, true);
    if (!right) return null;
    return {
      exits: [...nonNullishTransfers, ...allExpressionExits(right)],
      definitelyNullishExits: right.definitelyNullishExits,
    };
  }

  private buildTernaryExpression(
    expression: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
  ): CfgExpressionFlow | null {
    const parts = getTernaryParts(expression);
    if (!parts) return null;
    const condition = this.buildConditionExpression(parts.condition, incoming);
    if (!condition) return null;
    const consequence = this.buildExpressionValue(parts.consequence, condition.trueTransfers, true);
    if (!consequence) return null;
    const alternative = this.buildExpressionValue(parts.alternative, condition.falseTransfers, true);
    if (!alternative) return null;
    return {
      exits: [...allExpressionExits(consequence), ...allExpressionExits(alternative)],
      definitelyNullishExits: [
        ...consequence.definitelyNullishExits,
        ...alternative.definitelyNullishExits,
      ],
    };
  }

  private buildOptionalChainExpression(
    expression: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
  ): CfgExpressionFlow | null {
    const chain = collectOptionalMemberChain(expression);
    if (!chain || hasModeledExpressionBranching(chain.base)) return null;

    let continuation = [...incoming];
    const definitelyNullishExits: CfgPendingTransfer[] = [];
    for (let index = 0; index < chain.segments.length; index++) {
      const checkNode = index === 0 ? chain.base : chain.segments[index - 1]!;
      const segment = chain.segments[index]!;
      const conditionOrdinal = this.addBlock('condition', checkNode);
      this.connectIncoming(continuation, conditionOrdinal);
      definitelyNullishExits.push({ fromOrdinal: conditionOrdinal, kind: 'false' });

      if (index === chain.segments.length - 1) {
        const valueOrdinal = this.addBodyBlock(segment);
        this.addEdge(conditionOrdinal, valueOrdinal, 'true');
        return {
          exits: [{ fromOrdinal: valueOrdinal, kind: 'fallthrough' }],
          definitelyNullishExits,
        };
      }

      continuation = [{ fromOrdinal: conditionOrdinal, kind: 'true' }];
    }

    return null;
  }

  private buildMemberWrapperExpression(
    expression: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
    materializeLeaf: boolean,
  ): CfgExpressionFlow | null {
    const objectNode = getMemberObjectNode(expression);
    if (!objectNode || !hasModeledExpressionBranching(objectNode)) return null;

    const objectFlow = this.buildExpressionValue(objectNode, incoming, true);
    if (!objectFlow) return null;

    const continues = allExpressionExits(objectFlow);
    if (!materializeLeaf) {
      return { exits: continues, definitelyNullishExits: [] };
    }

    const blockOrdinal = this.addBodyBlock(expression);
    this.connectIncoming(continues, blockOrdinal);
    return {
      exits: [{ fromOrdinal: blockOrdinal, kind: 'fallthrough' }],
      definitelyNullishExits: [],
    };
  }

  private buildSubscriptExpression(
    expression: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
    materializeLeaf: boolean,
  ): CfgExpressionFlow | null {
    const objectNode = getSubscriptObjectNode(expression);
    const indexNode = getSubscriptIndexNode(expression);
    if (!objectNode) return null;

    let continues: CfgPendingTransfer[] = [...incoming];
    const definitelyNullishExits: CfgPendingTransfer[] = [];
    if (hasModeledExpressionBranching(objectNode)) {
      const objectFlow = this.buildExpressionValue(objectNode, continues, true);
      if (!objectFlow) return null;
      continues = objectFlow.exits;
      definitelyNullishExits.push(...objectFlow.definitelyNullishExits);
    }

    if (hasOptionalSubscriptOperator(expression)) {
      const conditionOrdinal = this.addBlock('condition', objectNode);
      this.connectIncoming(continues, conditionOrdinal);
      definitelyNullishExits.push({ fromOrdinal: conditionOrdinal, kind: 'false' });
      continues = [{ fromOrdinal: conditionOrdinal, kind: 'true' }];
    }

    if (indexNode && hasModeledExpressionBranching(indexNode)) {
      const indexFlow = this.buildExpressionValue(indexNode, continues, true);
      if (!indexFlow) return null;
      continues = allExpressionExits(indexFlow);
    }

    if (!materializeLeaf) {
      return { exits: continues, definitelyNullishExits };
    }

    const blockOrdinal = this.addBodyBlock(expression);
    this.connectIncoming(continues, blockOrdinal);
    return {
      exits: [{ fromOrdinal: blockOrdinal, kind: 'fallthrough' }],
      definitelyNullishExits,
    };
  }

  private buildCallLikeExpression(
    expression: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
    materializeLeaf: boolean,
  ): CfgExpressionFlow | null {
    const callee = getCallCalleeExpression(expression);
    let continues: CfgPendingTransfer[] = [...incoming];
    const definitelyNullishExits: CfgPendingTransfer[] = [];

    if (callee && hasModeledExpressionBranching(callee)) {
      const calleeFlow = this.buildExpressionValue(callee, continues, true);
      if (!calleeFlow) return null;
      continues = calleeFlow.exits;
      definitelyNullishExits.push(...calleeFlow.definitelyNullishExits);
    }

    const optionalCall = expression.type === 'call_expression' && hasOptionalCallOperator(expression);
    if (optionalCall) {
      if (!callee) return null;
      const conditionOrdinal = this.addBlock('condition', callee);
      this.connectIncoming(continues, conditionOrdinal);
      definitelyNullishExits.push({ fromOrdinal: conditionOrdinal, kind: 'false' });
      continues = [{ fromOrdinal: conditionOrdinal, kind: 'true' }];
    }

    let sawModeledArgument = false;
    for (const argument of getCallArgumentExpressions(expression)) {
      if (!hasModeledExpressionBranching(argument)) continue;
      sawModeledArgument = true;
      const argumentFlow = this.buildExpressionValue(argument, continues, true);
      if (!argumentFlow) return null;
      continues = allExpressionExits(argumentFlow);
    }

    if (sawModeledArgument && !optionalCall) {
      return { exits: continues, definitelyNullishExits };
    }
    if (!materializeLeaf) {
      return { exits: continues, definitelyNullishExits };
    }

    const blockOrdinal = this.addBodyBlock(expression);
    this.connectIncoming(continues, blockOrdinal);
    return {
      exits: [{ fromOrdinal: blockOrdinal, kind: 'fallthrough' }],
      definitelyNullishExits,
    };
  }

  private buildTryFinallyStatement(
    statement: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
    terminalMode: CfgTerminalMode,
  ): CfgStatementFlow | null {
    if (statement.namedChildren.some((child) => child.type === 'catch_clause')) return null;

    const tryBody = statement.childForFieldName('body');
    const finalizer = statement.childForFieldName('finalizer');
    const finallyBody = finalizer?.childForFieldName('body') ?? null;
    if (!tryBody || !finallyBody || tryBody.type !== 'statement_block' || finallyBody.type !== 'statement_block') {
      return null;
    }

    const tryFlow = this.buildStatementSequence(getStatementBlockStatements(tryBody), incoming, 'collect');
    if (!tryFlow) return null;

    const continues: CfgPendingTransfer[] = [];
    const terminals: CfgPendingTransfer[] = [];
    for (const pending of [...tryFlow.terminals, ...tryFlow.continues]) {
      const finallyFlow = this.buildFinallyBody(finallyBody, [
        { fromOrdinal: pending.fromOrdinal, kind: 'finally' },
      ]);
      if (!finallyFlow) return null;

      for (const finalizerTerminal of finallyFlow.terminals) {
        const handled = this.handleTerminalTransfer(finalizerTerminal, terminalMode);
        terminals.push(...handled.terminals);
      }

      for (const finalizerContinuation of finallyFlow.continues) {
        const resumed = {
          fromOrdinal: finalizerContinuation.fromOrdinal,
          kind: isAbruptTransferKind(pending.kind) ? pending.kind : 'fallthrough',
          label: pending.label,
        };
        if (isAbruptTransferKind(resumed.kind)) {
          const handled = this.handleTerminalTransfer(resumed, terminalMode);
          terminals.push(...handled.terminals);
        } else {
          continues.push(resumed);
        }
      }
    }

    return { continues, terminals };
  }

  private buildFinallyBody(
    finallyBody: SyntaxNode,
    incoming: readonly CfgPendingTransfer[],
  ): CfgStatementFlow | null {
    const statements = getStatementBlockStatements(finallyBody);
    if (statements.length > 0) {
      return this.buildStatementSequence(statements, incoming, 'collect');
    }

    const finallyOrdinal = this.addBodyBlock(finallyBody);
    this.connectIncoming(incoming, finallyOrdinal);
    return {
      continues: [{ fromOrdinal: finallyOrdinal, kind: 'fallthrough' }],
      terminals: [],
    };
  }

  private handleTerminalTransfer(
    terminal: CfgPendingTransfer,
    terminalMode: CfgTerminalMode,
  ): CfgStatementFlow {
    if (terminalMode === 'emit' && isFunctionExitTransferKind(terminal.kind)) {
      this.addEdge(terminal.fromOrdinal, CFG_EXIT_TARGET_ORDINAL, terminal.kind);
      return { continues: [], terminals: [] };
    }
    return { continues: [], terminals: [terminal] };
  }

  private connectIncoming(incoming: readonly CfgPendingTransfer[], targetOrdinal: number): void {
    for (const transfer of incoming) {
      this.addEdge(transfer.fromOrdinal, targetOrdinal, transfer.kind);
    }
  }

  private addBodyBlock(node: SyntaxNode): number {
    return this.addBlock('body', node);
  }

  private addBlock(role: CfgBlock['role'], node?: SyntaxNode): number {
    const ordinal = this.blocks.length;
    this.blocks.push({
      role,
      spans: node ? [spanForSyntaxNode(node)] : [],
    });
    return ordinal;
  }

  private addEdge(sourceOrdinal: number, targetOrdinal: number, kind: CfgEdge['kind']): void {
    this.edges.push({ sourceOrdinal, targetOrdinal, kind });
  }
}

function getStatementBlockStatements(block: SyntaxNode): SyntaxNode[] {
  return block.namedChildren.filter((child) => !CFG_COMMENT_NODE_TYPES.has(child.type));
}

function getElseClauseStatement(node: SyntaxNode | null): SyntaxNode | null {
  if (!node) return null;
  if (node.type !== 'else_clause') return node;
  return node.namedChildren.find((child) => !CFG_COMMENT_NODE_TYPES.has(child.type)) ?? null;
}

function getStatementLabelName(node: SyntaxNode): string | null {
  const label = node.childForFieldName('label') ?? node.namedChildren.find((child) => child.type === 'statement_identifier');
  return label ? getSyntaxNodeRuntimeText(label) : null;
}

function getLabeledStatementBody(node: SyntaxNode): SyntaxNode | null {
  return node.childForFieldName('body') ?? node.namedChildren.find((child) => child.type !== 'statement_identifier') ?? null;
}

function getTransferStatementLabel(node: SyntaxNode): string | null {
  const label = node.childForFieldName('label') ?? node.namedChildren.find((child) => child.type === 'statement_identifier');
  return label ? getSyntaxNodeRuntimeText(label) : null;
}

function getSyntaxNodeRuntimeText(node: SyntaxNode): string {
  return ((node as unknown as { text?: string }).text ?? '').trim();
}

function getSwitchConditionExpression(node: SyntaxNode): SyntaxNode | null {
  return node.childForFieldName('condition') ?? node.namedChildren.find((child) => child.type !== 'switch_body') ?? null;
}

function getSwitchClauses(node: SyntaxNode): SyntaxNode[] {
  return node.namedChildren.filter((child) => child.type === 'switch_case' || child.type === 'switch_default');
}

function getSwitchClauseStatements(node: SyntaxNode): SyntaxNode[] {
  const children = node.namedChildren.filter((child) => !CFG_COMMENT_NODE_TYPES.has(child.type));
  return node.type === 'switch_case' ? children.slice(1) : children;
}

function getForConditionExpression(node: SyntaxNode): SyntaxNode | null {
  const condition = node.childForFieldName('condition') ?? null;
  return condition?.type === 'empty_statement' ? null : condition;
}

function unwrapStatementExpressionNode(node: SyntaxNode): SyntaxNode {
  const unwrapped = unwrapExpressionNode(node);
  if (unwrapped.type !== 'expression_statement') return unwrapped;
  const expression = getStatementExpression(unwrapped);
  return expression ? unwrapExpressionNode(expression) : unwrapped;
}

function partitionBreakTransfers(
  transfers: readonly CfgPendingTransfer[],
  labels: readonly string[],
): { consumed: CfgPendingTransfer[]; remaining: CfgPendingTransfer[] } {
  const consumed: CfgPendingTransfer[] = [];
  const remaining: CfgPendingTransfer[] = [];
  for (const transfer of transfers) {
    if (transfer.kind === 'break' && transferTargetsLabels(transfer, labels)) {
      consumed.push(transfer);
    } else {
      remaining.push(transfer);
    }
  }
  return { consumed, remaining };
}

function partitionLoopTransfers(
  transfers: readonly CfgPendingTransfer[],
  labels: readonly string[],
): { breaks: CfgPendingTransfer[]; continues: CfgPendingTransfer[]; remaining: CfgPendingTransfer[] } {
  const breaks: CfgPendingTransfer[] = [];
  const continues: CfgPendingTransfer[] = [];
  const remaining: CfgPendingTransfer[] = [];
  for (const transfer of transfers) {
    if (transfer.kind === 'break' && transferTargetsLabels(transfer, labels)) {
      breaks.push(transfer);
    } else if (transfer.kind === 'continue' && transferTargetsLabels(transfer, labels)) {
      continues.push(transfer);
    } else {
      remaining.push(transfer);
    }
  }
  return { breaks, continues, remaining };
}

function transferTargetsLabels(transfer: CfgPendingTransfer, labels: readonly string[]): boolean {
  return transfer.label === undefined || transfer.label === null || labels.includes(transfer.label);
}

function isLoopStatement(node: SyntaxNode): boolean {
  return node.type === 'for_statement' || node.type === 'while_statement';
}

function labeledStatementUltimatelyTargetsLoop(node: SyntaxNode): boolean {
  const body = getLabeledStatementBody(node);
  if (!body) return false;
  if (isLoopStatement(body)) return true;
  return body.type === 'labeled_statement' && labeledStatementUltimatelyTargetsLoop(body);
}

function isSimpleStructuredStatement(node: SyntaxNode): boolean {
  return (
    node.type === 'empty_statement' ||
    node.type === 'expression_statement' ||
    node.type === 'lexical_declaration' ||
    node.type === 'variable_declaration'
  );
}

function allExpressionExits(flow: CfgExpressionFlow): CfgPendingTransfer[] {
  return [...flow.exits, ...flow.definitelyNullishExits];
}

function hasModeledExpressionBranching(root: SyntaxNode): boolean {
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'binary_expression' && hasDeferredBinaryOperator(node)) return true;
    if (node.type === 'call_expression' && hasOptionalCallOperator(node)) return true;
    if (node.type === 'subscript_expression' && hasOptionalSubscriptOperator(node)) return true;
    if (DEFERRED_EXPRESSION_BRANCH_TYPES.has(node.type)) return true;
    for (let index = 0; index < node.namedChildCount; index++) {
      const child = node.namedChild(index);
      if (child) stack.push(child);
    }
  }
  return false;
}

function hasDeferredBinaryOperator(node: SyntaxNode): boolean {
  const operator = getBinaryOperator(node);
  return operator !== null && DEFERRED_BINARY_OPERATORS.has(operator);
}

function unwrapExpressionNode(node: SyntaxNode): SyntaxNode {
  let current = node;
  while (current.type === 'parenthesized_expression') {
    const inner = current.namedChildren.find((child) => !CFG_COMMENT_NODE_TYPES.has(child.type));
    if (!inner) break;
    current = inner;
  }
  return current;
}

function getBinaryOperator(node: SyntaxNode): string | null {
  for (let index = 0; index < node.childCount; index++) {
    const child = node.child(index);
    if (child && !child.isNamed) return child.type;
  }
  return null;
}

function getBinaryOperands(node: SyntaxNode): { left: SyntaxNode; right: SyntaxNode } | null {
  const [left, right] = node.namedChildren;
  return left && right ? { left, right } : null;
}

function getTernaryParts(
  node: SyntaxNode,
): { condition: SyntaxNode; consequence: SyntaxNode; alternative: SyntaxNode } | null {
  const [condition, consequence, alternative] = node.namedChildren;
  return condition && consequence && alternative ? { condition, consequence, alternative } : null;
}

function isOptionalMemberExpression(node: SyntaxNode): boolean {
  return collectOptionalMemberChain(node) !== null;
}

function collectOptionalMemberChain(node: SyntaxNode): OptionalMemberChain | null {
  if (node.type !== 'member_expression') return null;

  let current: SyntaxNode | null = node;
  let base: SyntaxNode | null = null;
  const segments: SyntaxNode[] = [];
  while (current && current.type === 'member_expression') {
    if (hasOptionalChainChild(current)) segments.unshift(current);
    const objectNode = getMemberObjectNode(current);
    if (!objectNode || objectNode.type !== 'member_expression') {
      base = objectNode;
      break;
    }
    current = objectNode;
  }

  return base && segments.length > 0 ? { base, segments } : null;
}

function hasOptionalChainChild(node: SyntaxNode): boolean {
  for (let index = 0; index < node.namedChildCount; index++) {
    if (node.namedChild(index)?.type === 'optional_chain') return true;
  }
  return false;
}

function getMemberObjectNode(node: SyntaxNode): SyntaxNode | null {
  return (
    node.childForFieldName('object') ??
    node.namedChildren.find((child) => child.type !== 'optional_chain' && child.type !== 'property_identifier') ??
    null
  );
}

function getSubscriptObjectNode(node: SyntaxNode): SyntaxNode | null {
  return node.childForFieldName('object') ?? node.namedChildren[0] ?? null;
}

function getSubscriptIndexNode(node: SyntaxNode): SyntaxNode | null {
  const objectNode = getSubscriptObjectNode(node);
  return (
    node.childForFieldName('index') ??
    node.namedChildren.find((child) => child !== objectNode && child.type !== 'optional_chain') ??
    null
  );
}

function hasOptionalSubscriptOperator(node: SyntaxNode): boolean {
  return hasOptionalChainChild(node);
}

function getCallCalleeExpression(node: SyntaxNode): SyntaxNode | null {
  return node.childForFieldName('function') ?? node.namedChildren.find((child) => child.type !== 'arguments') ?? null;
}

function hasOptionalCallOperator(node: SyntaxNode): boolean {
  for (let index = 0; index < node.childCount; index++) {
    if (node.child(index)?.type === '?.') return true;
  }
  return false;
}

function getStatementExpression(statement: SyntaxNode): SyntaxNode | null {
  return statement.namedChildren.find((child) => !CFG_COMMENT_NODE_TYPES.has(child.type)) ?? null;
}

function getStatementValueExpressions(statement: SyntaxNode): SyntaxNode[] {
  if (statement.type === 'lexical_declaration' || statement.type === 'variable_declaration') {
    return statement.namedChildren
      .filter((child) => child.type === 'variable_declarator')
      .map(getVariableDeclaratorValue)
      .filter((child): child is SyntaxNode => child !== null);
  }
  if (statement.type === 'expression_statement') {
    const expression = getStatementExpression(statement);
    return expression ? [expression] : [];
  }
  return [];
}

function getVariableDeclaratorValue(node: SyntaxNode): SyntaxNode | null {
  return node.childForFieldName('value') ?? (node.namedChildren.length > 1 ? node.namedChildren.at(-1)! : null);
}

function getCallArgumentExpressions(node: SyntaxNode): SyntaxNode[] {
  const args = node.childForFieldName('arguments') ?? node.namedChildren.find((child) => child.type === 'arguments');
  return args ? args.namedChildren.filter((child) => !CFG_COMMENT_NODE_TYPES.has(child.type)) : [];
}

function isFunctionExitTransferKind(kind: CfgEdge['kind']): boolean {
  return kind === 'return' || kind === 'throw';
}

function isAbruptTransferKind(kind: CfgEdge['kind']): boolean {
  return kind === 'return' || kind === 'throw' || kind === 'break' || kind === 'continue';
}

function spanForSyntaxNode(node: SyntaxNode): CfgBlock['spans'][number] {
  return {
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
  };
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
  const edges = ir.edges
    .map((edge) => ({
      sourceOrdinal: edge.sourceOrdinal,
      targetOrdinal: edge.targetOrdinal,
      source: blocks[edge.sourceOrdinal]!.id,
      target: blocks[edge.targetOrdinal]!.id,
      kind: edge.kind,
    }))
    .sort(compareLoweredCfgEdges);
  return {
    analysis: 'cfg',
    graphId: deriveCfgGraphId(row.id, sourceVersion),
    language: row.language,
    functionId: row.id,
    sourceVersion,
    blocks,
    edges: edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
    })),
  };
}

function compareLoweredCfgEdges(
  left: CfgEdgeIr & { source: string; target: string },
  right: CfgEdgeIr & { source: string; target: string },
): number {
  return (
    left.sourceOrdinal - right.sourceOrdinal ||
    cfgEdgeKindOrder(left.kind) - cfgEdgeKindOrder(right.kind) ||
    left.target.localeCompare(right.target)
  );
}

function cfgEdgeKindOrder(kind: CfgEdge['kind']): number {
  return CFG_EDGE_KIND_ORDER.get(kind) ?? Number.MAX_SAFE_INTEGER;
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
