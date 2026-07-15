# Quickstart: Validate Change Impact Detection

This guide defines the SPEC-012 validation and UAT path. Commands assume the repository root is the SPEC-012 worktree.

## Prerequisites

```text
PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:$PATH npm run build
PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:$PATH npm run typecheck
```

Ensure the repository has a current CodeGraph index before UAT:

```text
PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:$PATH node dist/bin/codegraph.js init .
PATH=/Users/fredrickgabelmann/.nvm/versions/node/v24.11.1/bin:$PATH node dist/bin/codegraph.js status
```

## Scenario 1: Unstaged symbol change

1. Make an unstaged edit inside a small indexed function.
2. Run:

   ```text
   node dist/bin/codegraph.js detect-changes --mode unstaged --format json
   ```

3. Expected:
   - `changedSymbols` includes the edited symbol.
   - `unmappedHunks` does not include that edited hunk.
   - `exitCode` is `1`.

## Scenario 2: Staged-only isolation

1. Stage one symbol edit.
2. Leave a second symbol edit unstaged.
3. Run:

   ```text
   node dist/bin/codegraph.js detect-changes --mode staged --format json
   ```

4. Expected:
   - Only the staged edit contributes changed symbols.
   - The unstaged edit is absent.

## Scenario 3: Pure rename or move

1. Rename an indexed source file without editing content.
2. Run:

   ```text
   node dist/bin/codegraph.js detect-changes --mode all --format markdown
   ```

3. Expected:
   - The path change is represented.
   - No changed-symbol impact is invented for the pure move.

## Scenario 4: Edited rename

1. Rename an indexed source file.
2. Edit a symbol in the renamed file.
3. Run:

   ```text
   node dist/bin/codegraph.js detect-changes --mode all --format json
   ```

4. Expected:
   - The renamed path is recorded.
   - The edited symbol appears in `changedSymbols`.

## Scenario 5: Threshold breach

1. Use a fixture or controlled diff touching a symbol with more than the configured caller threshold.
2. Run:

   ```text
   node dist/bin/codegraph.js detect-changes --mode all --fail-on 'callers>1' --format json
   ```

3. Expected:
   - `risks` includes a threshold-breach annotation.
   - `exitCode` is `2`.
   - The process exits with code `2`.

## Scenario 6: Flow catalog unavailable

1. Disable SPEC-011 flow analysis in `codegraph.json` or use a fixture without flow catalog metadata.
2. Run:

   ```text
   node dist/bin/codegraph.js detect-changes --mode all --format json
   ```

3. Expected:
   - `affectedFlows.state` is `disabled`, `unavailable`, or `not_indexed`.
   - `affectedFlows.items` is empty.
   - The report still returns normally.

## Scenario 7: MCP parity

Invoke `codegraph_detect_changes` with the same options as a CLI JSON run.

Expected:

- MCP returns one normal text content payload.
- Parsed JSON has the same top-level fields as the CLI report.
- Expected states such as stale index, unmapped hunks, flow unavailable, and threshold breach do not become tool errors.

## Completion evidence

Before SPEC-012 is complete, record:

- Targeted Vitest command output.
- `npm run build`.
- `npm run typecheck`.
- `npm test`.
- Self-repo UAT command/output summary for JSON, markdown, warnings, callers, affected flows, and exit codes.
