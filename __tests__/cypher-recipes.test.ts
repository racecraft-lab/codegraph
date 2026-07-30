import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type RecipeSlice = 'Slice 1' | 'Slice 2' | 'Cross-slice';
type RecipeSurface = 'package' | 'CLI' | 'MCP' | 'docs' | 'live UAT';
type ExpectedState = 'success' | 'empty' | 'diagnostic' | 'timeout' | 'refusal' | 'success or empty';

type RecipeDefinition = {
  readonly id: string;
  readonly category: string;
  readonly title: string;
  readonly slice: RecipeSlice;
  readonly surfaces: readonly RecipeSurface[];
  readonly query: string;
  readonly expectedState: ExpectedState;
  readonly expectedEmptyReason?: string;
};

type LiveSelfIndexRecipeSlot = RecipeDefinition & {
  readonly commandSlots: {
    readonly packageApi: string;
    readonly cliJson: string;
    readonly mcpText: string;
  };
  readonly parityHash: string;
  readonly artifact: string;
  readonly reviewer: string;
  readonly date: string;
  readonly representativeOutput: string;
  readonly expectedEmptyReason: string;
};

type GuardProbeDefinition = {
  readonly id: string;
  readonly title: string;
  readonly input: string;
  readonly slice: RecipeSlice;
  readonly surfaces: readonly RecipeSurface[];
  readonly expectedState: ExpectedState;
  readonly expectedCode?: string;
  readonly commandSlots: {
    readonly packageApi: string;
    readonly cliJson: string;
    readonly mcpText: string;
  };
  readonly parityHash: string;
  readonly artifact: string;
  readonly reviewer: string;
  readonly date: string;
  readonly representativeOutput: string;
  readonly expectedEmptyReason: string;
};

type ParityHashCapture = {
  readonly cliHash: string;
  readonly mcpHash: string;
  readonly parityHash: string;
  readonly matches: boolean;
};

type EvidenceArtifactRecord = {
  readonly rowId: string;
  readonly artifactPath: string;
  readonly matrixArtifact: string;
};

const TBD = 'TBD' as const;
const RECIPE_DOC_PATH = path.join(
  __dirname,
  '..',
  'docs',
  'ai',
  'specs',
  '013-cypher-query-access-recipes.md',
);

const REQUIRED_RECIPE_CATEGORIES = [
  'callers of a function',
  'bounded path between functions',
  'hubs by count',
  'potentially dead exports',
  'route/component neighborhood',
  'imports by module',
  'async function callers',
  'heuristic edge review',
  'file-local relationship summary',
  'source-position filtered relationship review',
] as const;

const LIVE_SELF_INDEX_RECIPE_QUERIES: readonly string[] = [
  'MATCH (caller:function)-[:calls]->(target:function) RETURN caller.name, target.name LIMIT 10',
  'MATCH p = (source:function)-[:calls*1..3]->(target:function) RETURN p LIMIT 5',
  'MATCH (caller:function)-[:calls]->(target:function) RETURN target.name, count(caller) AS callers ORDER BY callers DESC LIMIT 10',
  'MATCH (n:function) WHERE n.isExported = true RETURN n.name, n.filePath LIMIT 10',
  'MATCH (route:route)-[:references]->(component:component) RETURN route.name, component.name LIMIT 10',
  'MATCH (source:module)-[:imports]->(target:module) RETURN source.name, target.name LIMIT 10',
  'MATCH (caller:function)-[:calls]->(target:function) WHERE caller.isAsync = true RETURN caller.name, target.name LIMIT 10',
  "MATCH (source:function)-[edge:calls]->(target:function) WHERE edge.provenance = 'heuristic' RETURN source.name, target.name, edge.provenance LIMIT 10",
  'MATCH (source:function)-[:calls]->(target:function) WHERE source.filePath = target.filePath RETURN source.name, target.name LIMIT 10',
  'MATCH (source:function)-[:calls]->(target:function) WHERE source.startLine >= 1 RETURN source.filePath, source.startLine, target.name LIMIT 10',
];

const REQUIRED_GUARD_PROBES: readonly GuardProbeDefinition[] = [
  guardProbe({
    id: 'GUARD-ROW-CAP',
    title: 'Default row cap and truncation flag',
    input: 'MATCH (n:function) RETURN n.name',
    slice: 'Cross-slice',
    surfaces: ['package', 'CLI', 'MCP', 'docs', 'live UAT'],
    expectedState: 'success',
    commandSlots: placeholderCommandSlots(),
    parityHash: TBD,
    artifact: TBD,
    reviewer: TBD,
    date: TBD,
    representativeOutput: TBD,
    expectedEmptyReason: TBD,
  }),
  guardProbe({
    id: 'GUARD-PATH-CAP',
    title: 'Bounded variable path traversal',
    input: 'MATCH p = (a:function)-[:calls*1..3]->(b:function) RETURN p LIMIT 5',
    slice: 'Slice 1',
    surfaces: ['package', 'CLI', 'MCP', 'docs', 'live UAT'],
    expectedState: 'success',
    commandSlots: placeholderCommandSlots(),
    parityHash: TBD,
    artifact: TBD,
    reviewer: TBD,
    date: TBD,
    representativeOutput: TBD,
    expectedEmptyReason: TBD,
  }),
  guardProbe({
    id: 'GUARD-TIMEOUT',
    title: 'Five-second timeout guidance',
    input: 'MATCH p = (a:function)-[:calls*1..10]->(b:function) RETURN p',
    slice: 'Cross-slice',
    surfaces: ['package', 'CLI', 'MCP', 'docs'],
    expectedState: 'timeout',
    expectedCode: 'CYPHER_QUERY_TIMEOUT',
    commandSlots: placeholderCommandSlots(),
    parityHash: TBD,
    artifact: TBD,
    reviewer: TBD,
    date: TBD,
    representativeOutput: TBD,
    expectedEmptyReason: TBD,
  }),
  guardProbe({
    id: 'GUARD-READ-ONLY',
    title: 'Unsupported write clause rejection',
    input: 'MATCH (n) DELETE n RETURN n',
    slice: 'Cross-slice',
    surfaces: ['package', 'CLI', 'MCP', 'docs'],
    expectedState: 'diagnostic',
    expectedCode: 'CYPHER_UNSUPPORTED_CLAUSE',
    commandSlots: placeholderCommandSlots(),
    parityHash: TBD,
    artifact: TBD,
    reviewer: TBD,
    date: TBD,
    representativeOutput: TBD,
    expectedEmptyReason: TBD,
  }),
  guardProbe({
    id: 'GUARD-MALFORMED-STDIN',
    title: 'Malformed UTF-8 stdin rejection',
    input: 'printf malformed UTF-8 bytes to codegraph query - --json',
    slice: 'Cross-slice',
    surfaces: ['CLI', 'docs'],
    expectedState: 'diagnostic',
    expectedCode: 'CYPHER_INVALID_STDIN_ENCODING',
    commandSlots: placeholderCommandSlots(),
    parityHash: TBD,
    artifact: TBD,
    reviewer: TBD,
    date: TBD,
    representativeOutput: TBD,
    expectedEmptyReason: TBD,
  }),
  guardProbe({
    id: 'GUARD-PAYLOAD-CEILING',
    title: 'Canonical payload ceiling diagnostic',
    input: 'MATCH (n:function) RETURN n',
    slice: 'Cross-slice',
    surfaces: ['package', 'CLI', 'MCP', 'docs'],
    expectedState: 'diagnostic',
    expectedCode: 'CYPHER_OUTPUT_TOO_LARGE',
    commandSlots: placeholderCommandSlots(),
    parityHash: TBD,
    artifact: TBD,
    reviewer: TBD,
    date: TBD,
    representativeOutput: TBD,
    expectedEmptyReason: TBD,
  }),
  guardProbe({
    id: 'GUARD-CLI-MCP-PARITY',
    title: 'Byte-identical CLI and MCP JSON',
    input: 'MATCH (n:function) RETURN n.name ORDER BY n.name LIMIT 5',
    slice: 'Cross-slice',
    surfaces: ['CLI', 'MCP', 'docs', 'live UAT'],
    expectedState: 'success',
    commandSlots: placeholderCommandSlots(),
    parityHash: TBD,
    artifact: TBD,
    reviewer: TBD,
    date: TBD,
    representativeOutput: TBD,
    expectedEmptyReason: TBD,
  }),
];

const REQUIRED_RECIPE_DOC_FIELDS = [
  'Category',
  'Query',
  'Surfaces',
  'Package API command',
  'CLI --json command',
  'MCP text command',
  'Expected state',
  'Representative output',
  'Expected-empty reason',
  'Parity hash',
  'Artifact',
  'Reviewer',
  'Date',
] as const;

const REQUIRED_GUARD_DOC_FIELDS = [
  'Input',
  'Surfaces',
  'Package API command',
  'CLI --json command',
  'MCP text command',
  'Expected state',
  'Expected code',
  'Representative output',
  'Expected-empty reason',
  'Parity hash',
  'Artifact',
  'Reviewer',
  'Date',
] as const;

function placeholderCommandSlots(): LiveSelfIndexRecipeSlot['commandSlots'] {
  return {
    packageApi: TBD,
    cliJson: TBD,
    mcpText: TBD,
  };
}

function fixtureRecipe(recipe: RecipeDefinition): RecipeDefinition {
  if (!recipe.id.trim()) {
    throw new Error('Recipe id is required');
  }
  if (!recipe.query.trim()) {
    throw new Error(`Recipe ${recipe.id} query is required`);
  }
  if (recipe.surfaces.length === 0) {
    throw new Error(`Recipe ${recipe.id} must declare at least one surface`);
  }
  return {
    ...recipe,
    surfaces: [...recipe.surfaces],
  };
}

function liveSelfIndexRecipeSlots(): readonly LiveSelfIndexRecipeSlot[] {
  if (LIVE_SELF_INDEX_RECIPE_QUERIES.length !== REQUIRED_RECIPE_CATEGORIES.length) {
    throw new Error('Live self-index recipe query slots must match required recipe categories');
  }

  return REQUIRED_RECIPE_CATEGORIES.map((category, index) => ({
    ...fixtureRecipe({
      id: `RECIPE-${String(index + 1).padStart(3, '0')}`,
      category,
      title: category,
      slice: index < 2 ? 'Slice 1' : 'Slice 2',
      surfaces: ['package', 'CLI', 'MCP', 'docs', 'live UAT'],
      query: LIVE_SELF_INDEX_RECIPE_QUERIES[index]!,
      expectedState: 'success or empty',
    }),
    commandSlots: {
      ...placeholderCommandSlots(),
    },
    parityHash: TBD,
    artifact: TBD,
    reviewer: TBD,
    date: TBD,
    representativeOutput: TBD,
    expectedEmptyReason: TBD,
  }));
}

function guardProbe(probe: GuardProbeDefinition): GuardProbeDefinition {
  if (!probe.id.trim()) {
    throw new Error('Guard probe id is required');
  }
  if (!probe.input.trim()) {
    throw new Error(`Guard probe ${probe.id} input is required`);
  }
  return { ...probe };
}

function requireRecipeDoc(): string {
  return fs.readFileSync(RECIPE_DOC_PATH, 'utf8');
}

function unresolvedRecipeEvidenceCount(slots: readonly LiveSelfIndexRecipeSlot[]): number {
  return slots.reduce((count, slot) => count + unresolvedEvidenceValues([
    slot.commandSlots.packageApi,
    slot.commandSlots.cliJson,
    slot.commandSlots.mcpText,
    slot.parityHash,
    slot.artifact,
    slot.reviewer,
    slot.date,
    slot.representativeOutput,
    slot.expectedEmptyReason,
  ]), 0);
}

function unresolvedGuardEvidenceCount(probes: readonly GuardProbeDefinition[]): number {
  return probes.reduce((count, probe) => count + unresolvedEvidenceValues([
    probe.commandSlots.packageApi,
    probe.commandSlots.cliJson,
    probe.commandSlots.mcpText,
    probe.parityHash,
    probe.artifact,
    probe.reviewer,
    probe.date,
    probe.representativeOutput,
    probe.expectedEmptyReason,
  ]), 0);
}

function unresolvedEvidenceValues(values: readonly string[]): number {
  return values.filter((value) => value === TBD || value.trim() === '').length;
}

function unresolvedDocumentationPlaceholderCount(markdown: string): number {
  return markdown.match(/\bTBD\b/g)?.length ?? 0;
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function captureCliMcpParityHash(cliBytes: Buffer, mcpBytes: Buffer): ParityHashCapture {
  const cliHash = sha256Hex(cliBytes);
  const mcpHash = sha256Hex(mcpBytes);
  const matches = cliBytes.equals(mcpBytes);
  return {
    cliHash,
    mcpHash,
    parityHash: matches ? cliHash : 'mismatch',
    matches,
  };
}

function evidencePathSegment(rowId: string): string {
  return rowId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact';
}

function recordEvidenceArtifactPath(
  artifactRoot: string,
  rowId: string,
  fileName: string,
): EvidenceArtifactRecord {
  const segment = evidencePathSegment(rowId);
  const safeFileName = path.basename(fileName);
  const artifactDir = path.join(artifactRoot, segment);
  fs.mkdirSync(artifactDir, { recursive: true });

  return {
    rowId,
    artifactPath: path.join(artifactDir, safeFileName),
    matrixArtifact: path.join(segment, safeFileName),
  };
}

describe('SPEC-013 recipe helper contracts', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-cypher-recipes-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('define recipe fixtures, live slots, guards, parity hashes, and artifact paths without executing live queries', () => {
    const callers = fixtureRecipe({
      id: 'RECIPE-001',
      category: 'callers of a function',
      title: 'Find callers of a function',
      slice: 'Slice 1',
      surfaces: ['package', 'CLI', 'MCP'],
      query: 'MATCH (caller:function)-[:calls]->(target:function) RETURN caller.name, target.name LIMIT 10',
      expectedState: 'success or empty',
    });

    expect(callers.id).toBe('RECIPE-001');
    expect(callers.surfaces).toEqual(['package', 'CLI', 'MCP']);

    const liveSlots = liveSelfIndexRecipeSlots();
    expect(liveSlots.map((slot) => slot.category)).toEqual([...REQUIRED_RECIPE_CATEGORIES]);
    expect(liveSlots.every((slot) => slot.commandSlots.cliJson === 'TBD')).toBe(true);
    expect(liveSlots.every((slot) => slot.parityHash === 'TBD')).toBe(true);
    expect(liveSlots.every((slot) => slot.reviewer === 'TBD' && slot.date === 'TBD')).toBe(true);
    expect(liveSlots.every((slot) => slot.representativeOutput === 'TBD')).toBe(true);
    expect(liveSlots.every((slot) => slot.expectedEmptyReason === 'TBD')).toBe(true);

    const mutationGuard = guardProbe({
      id: 'GUARD-MUTATION-REJECT',
      title: 'Unsupported write clause',
      input: 'MATCH (n) DELETE n RETURN n',
      slice: 'Cross-slice',
      surfaces: ['package', 'CLI', 'MCP'],
      expectedState: 'diagnostic',
      expectedCode: 'CYPHER_UNSUPPORTED_CLAUSE',
      commandSlots: placeholderCommandSlots(),
      parityHash: TBD,
      artifact: TBD,
      reviewer: TBD,
      date: TBD,
      representativeOutput: TBD,
      expectedEmptyReason: TBD,
    });
    expect(mutationGuard.expectedCode).toBe('CYPHER_UNSUPPORTED_CLAUSE');

    const payload = Buffer.from('{"status":"success","rows":[]}', 'utf8');
    const parity = captureCliMcpParityHash(payload, payload);
    expect(parity.matches).toBe(true);
    expect(parity.parityHash).toMatch(/^[0-9a-f]{64}$/);

    const artifact = recordEvidenceArtifactPath(tempDir, 'RECIPE-001', 'cli-mcp-parity.json');
    expect(artifact.rowId).toBe('RECIPE-001');
    expect(artifact.matrixArtifact).toBe(path.join('recipe-001', 'cli-mcp-parity.json'));
    expect(fs.existsSync(path.dirname(artifact.artifactPath))).toBe(true);
  });

  it('documents all ten live self-index recipe placeholders with required evidence fields', () => {
    const markdown = requireRecipeDoc();
    const liveSlots = liveSelfIndexRecipeSlots();

    expect(liveSlots).toHaveLength(10);
    for (const slot of liveSlots) {
      expect(markdown).toContain(`## ${slot.id}`);
      expect(markdown).toContain(slot.category);
      expect(markdown).toContain(slot.query);
      for (const field of REQUIRED_RECIPE_DOC_FIELDS) {
        expect(markdown).toContain(`- ${field}:`);
      }
    }
  });

  it('documents guard probe placeholders for row cap, path cap, timeout, read-only, malformed input, payload ceiling, and parity', () => {
    const markdown = requireRecipeDoc();

    expect(REQUIRED_GUARD_PROBES.map((probe) => probe.id)).toEqual([
      'GUARD-ROW-CAP',
      'GUARD-PATH-CAP',
      'GUARD-TIMEOUT',
      'GUARD-READ-ONLY',
      'GUARD-MALFORMED-STDIN',
      'GUARD-PAYLOAD-CEILING',
      'GUARD-CLI-MCP-PARITY',
    ]);

    for (const probe of REQUIRED_GUARD_PROBES) {
      expect(markdown).toContain(`## ${probe.id}`);
      expect(markdown).toContain(probe.input);
      if (probe.expectedCode) {
        expect(markdown).toContain(probe.expectedCode);
      }
      for (const field of REQUIRED_GUARD_DOC_FIELDS) {
        expect(markdown).toContain(`- ${field}:`);
      }
    }
  });

  it('proves recipe documentation readiness while reserving live evidence slots for later verification', () => {
    const placeholderCounts = {
      liveRecipeFields: unresolvedRecipeEvidenceCount(liveSelfIndexRecipeSlots()),
      guardProbeFields: unresolvedGuardEvidenceCount(REQUIRED_GUARD_PROBES),
      documentationPlaceholders: unresolvedDocumentationPlaceholderCount(requireRecipeDoc()),
    };

    expect(placeholderCounts).toEqual({
      liveRecipeFields: 90,
      guardProbeFields: 63,
      documentationPlaceholders: 0,
    });
  });
});
