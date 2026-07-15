# Contract: `codegraph detect-changes`

## Command

```text
codegraph detect-changes [options]
```

## Options

```text
--mode <mode>             unstaged | staged | all | base-ref
--base-ref <ref>          required when --mode base-ref
--format <format>         json | markdown; default json
--fail-on <policy>        comma-separated callers>N and/or hub
--caller-depth <number>   clamped to 1-3; default 1
--max-callers <number>    clamped to 1-100; default 20
-p, --path <path>         project path
```

CLI default mode is `all` so local preflight checks include tracked staged and unstaged changes plus untracked-file diagnostics. CI and PR-style checks must pass `--mode base-ref --base-ref <ref>`.

## Diff mode semantics

- `unstaged`: working tree vs index.
- `staged`: index vs `HEAD`.
- `all`: tracked staged and unstaged changes vs `HEAD`, plus untracked-file diagnostics.
- `base-ref`: `HEAD` vs `merge-base(baseRef, HEAD)`, ignoring dirty local-only changes.

## Exit codes

- `0`: clean report.
- `1`: ordinary impact report.
- `2`: configured `failOn` threshold breach.
- `3`: unavailable expected state that cannot calculate impact, or true operational failure such as malformed input, invalid base ref, git failure, or unreadable index state.

Threshold breaches take precedence over ordinary impact code `1`, but operational failures take precedence over threshold semantics.

## Markdown sections

Markdown output must use deterministic sections:

1. Summary
2. Warnings
3. Changed Symbols
4. Unmapped Hunks
5. Impacted Callers
6. Affected Flows
7. Risks

## Markdown tables

- Summary: `Field`, `Value`.
- Warnings: `Code`, `Message`.
- Changed Symbols: `Symbol`, `Kind`, `Change`, `File`, `Lines`, `Hunks`.
- Unmapped Hunks: `Path`, `Range`, `Reason`, `Message`.
- Impacted Callers: `Changed Symbol`, `Caller`, `Kind`, `File`, `Line`, `Depth`.
- Affected Flows: `State`, `Flow`, `Entry Kind`, `Matched Symbols`, `Step Count`, `Truncated`.
- Risks: `Severity`, `Code`, `Target`, `Policy`, `Message`.

## Examples

```text
codegraph detect-changes --mode all --format json
codegraph detect-changes --mode staged --format markdown
codegraph detect-changes --mode base-ref --base-ref origin/main --fail-on 'callers>10,hub'
```
