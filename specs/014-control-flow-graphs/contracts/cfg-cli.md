# Contract: CFG CLI

## Command

```bash
codegraph cfg <function-id> -p <path> --json --limit <number> --offset <number>
```

## Options

- `<function-id>`: required public CodeGraph function ID.
- `-p, --path`: project path.
- `-j, --json`: write only the exact `CfgReadResult` machine object.
- `--limit`: optional page size, default 100, clamped to `1..500`.
- `--offset`: optional page offset, default 0, clamped to zero or greater.

## JSON Output

JSON mode writes exactly one `CfgReadResult` object from `cfg-shared-contract.md` and no additional prose.

## Human Output

Human mode renders a bounded page summary with the same `state`, `reason`, `functionId`, `sourceVersion`, block count, edge count, and page metadata as the machine result. It may omit full arrays but must not hide state or reason.

## Exit Behavior

- Exit 0 for every expected `CfgReadResult` state: `available`, `disabled`, `not_indexed`, `not_computed`, `stale`, `unavailable`, `unsupported`, `resource_limited`, `unknown_function`, and `deleted`.
- Use nonzero exit only for invalid usage, invalid path or workspace access, output or serialization failure, or an unexpected internal failure that prevents producing a valid `CfgReadResult`.

