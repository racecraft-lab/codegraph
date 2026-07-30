export type CypherSerializerDiagnosticResult = {
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

type CypherTypedValue =
  | { readonly type: 'scalar'; readonly value: unknown }
  | { readonly type: 'node'; readonly value: { readonly id?: unknown; readonly kind?: unknown; readonly name?: unknown } }
  | { readonly type: 'relationship'; readonly value: { readonly source?: unknown; readonly target?: unknown; readonly kind?: unknown } }
  | { readonly type: 'path'; readonly value: { readonly length?: unknown } };

const CYPHER_PAYLOAD_LIMIT_BYTES = 1_048_576;

export function serializeCypherResult(
  result: unknown,
  options: { readonly payloadLimitBytes?: number } = {},
): string | CypherSerializerDiagnosticResult {
  const bytes = JSON.stringify(stabilizeValue(result));
  const payloadLimitBytes = options.payloadLimitBytes ?? CYPHER_PAYLOAD_LIMIT_BYTES;
  if (Buffer.byteLength(bytes, 'utf8') > payloadLimitBytes) {
    return outputTooLargeDiagnostic();
  }
  return bytes;
}

export function cypherRowsToTable(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
): readonly Record<string, string>[] {
  return rows.map((row) => {
    const tableRow: Record<string, string> = {};
    for (const column of columns) {
      tableRow[column] = formatTableCell(row[column]);
    }
    return tableRow;
  });
}

function stabilizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stabilizeValue);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const stable: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    stable[key] = stabilizeValue(value[key]);
  }
  return stable;
}

function formatTableCell(value: unknown): string {
  if (isTypedCypherValue(value)) {
    return formatTypedValue(value);
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(stabilizeValue(value));
}

function formatTypedValue(value: CypherTypedValue): string {
  switch (value.type) {
    case 'scalar':
      return formatTableCell(value.value);
    case 'node':
      return [value.value.kind, value.value.id].filter((part) => part !== undefined && part !== null).join(' ');
    case 'relationship':
      return [value.value.source, value.value.kind, value.value.target]
        .filter((part) => part !== undefined && part !== null)
        .join(' ');
    case 'path':
      return `path length ${String(value.value.length ?? 0)}`;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTypedCypherValue(value: unknown): value is CypherTypedValue {
  return (
    isPlainObject(value) &&
    typeof value.type === 'string' &&
    'value' in value &&
    (value.type === 'scalar' || value.type === 'node' || value.type === 'relationship' || value.type === 'path')
  );
}

function outputTooLargeDiagnostic(): CypherSerializerDiagnosticResult {
  return {
    status: 'diagnostic',
    code: 'CYPHER_OUTPUT_TOO_LARGE',
    message: 'Cypher result exceeds the fixed 1 MiB machine-output payload ceiling; narrow RETURN, MATCH, or LIMIT.',
    offset: 0,
    line: 1,
    column: 0,
    expected: 'serialized payload <= 1048576 bytes',
    anchor: 'serializer',
    excerpt: '',
    truncatedBefore: false,
    truncatedAfter: false,
  };
}

export function serializeCypherResultForTests(
  result: unknown,
  options?: { readonly payloadLimitBytes?: number },
): string | CypherSerializerDiagnosticResult {
  return serializeCypherResult(result, options);
}

export function cypherRowsToTableForTests(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
): readonly Record<string, string>[] {
  return cypherRowsToTable(rows, columns);
}
