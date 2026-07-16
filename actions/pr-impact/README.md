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
  issues: write
  actions: read

jobs:
  pr-impact:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
      - uses: racecraft-lab/codegraph/actions/pr-impact@<immutable-ref>
        with:
          codegraph-version: "1.5.0"
          fail-on-callers: ""
          fail-on-hubs: "false"
          narrative: "off"
```

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `codegraph-version` | `1.5.0` | Pinned `@colbymchenry/codegraph` CLI version. |
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
- Cache identity includes repository, CodeGraph version, base ref, head SHA,
  merge base, and lockfile hash. Restored warm caches are also checked against
  index health, extraction-version compatibility, pending changes, and worktree
  mismatch status before use.
- Fork-like or restricted-token PRs skip privileged comment and narrative paths
  without suppressing the deterministic report.
- Narrative is off by default. When enabled for trusted runs, it is prose-only
  and appended after deterministic facts and final conclusion are fixed.
