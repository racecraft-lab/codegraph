# CodeGraph PR Impact Action

Reusable GitHub composite action for deterministic pull-request blast-radius
reports.

## Usage

```yaml
name: PR impact

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write
  issues: write
  actions: read

jobs:
  pr-impact:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./actions/pr-impact
        with:
          codegraph-version: "1.4.1"
          fail-on-callers: ""
          fail-on-hubs: "false"
          narrative: "off"
```

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `codegraph-version` | `1.4.1` | Pinned `@colbymchenry/codegraph` CLI version. |
| `base-ref` | event base ref | Comparison target for `detect-changes --mode base-ref`. |
| `fail-on-callers` | empty | Optional caller-count threshold, e.g. `20`. |
| `fail-on-hubs` | `false` | Fail on detector hub threshold breaches when `true`. |
| `caller-depth` | `1` | Caller traversal depth passed to the detector. |
| `max-callers` | `20` | Maximum caller rows in the deterministic report. |
| `narrative` | `off` | Use `trusted` to allow optional prose on trusted runs only. |

## Outputs

- `summary-status`
- `detector-exit-code`
- `conclusion`
- `threshold-breached`
- `cache-status`
- `delivery-status`
- `comment-url`
- `report-path`
- `artifact-name`
- `narrative-status`
- `codegraph-version`
- `helper-version`

## Behavior

- Runs CodeGraph `detect-changes` in base-ref mode and treats detector JSON as
  authoritative.
- Publishes one action-owned sticky PR comment when permissions allow.
- Always writes the deterministic report to the job summary and uploaded
  artifact path when possible.
- Keeps ordinary impact advisory. Only configured caller/hub threshold breaches
  and unrecovered analysis/report unavailability fail the action.
- Restores `.codegraph/`, validates cache identity metadata, and rebuilds with
  `codegraph index` before analysis when the restored cache is missing, stale,
  corrupt, or incompatible.
- Cache identity includes CodeGraph version, base ref, head SHA, merge base, and
  lockfile hash.
- Fork-like or restricted-token PRs skip privileged comment and narrative paths
  without suppressing the deterministic report.
- Narrative is off by default. When enabled for trusted runs, it is prose-only
  and appended after deterministic facts and final conclusion are fixed.
