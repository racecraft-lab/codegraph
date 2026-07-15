# Contract: `actions/pr-impact/action.yml`

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `codegraph-version` | no | action release default | Reproducible `@colbymchenry/codegraph` CLI/runtime version used for analysis. |
| `base-ref` | no | pull-request base ref/SHA | Comparison target for `detect-changes --mode base-ref`; required when the event cannot infer it. |
| `fail-on-callers` | no | empty | Integer caller threshold. Empty means advisory. Non-empty maps to `--fail-on callers>N`. |
| `fail-on-hubs` | no | `false` | Boolean hub threshold enablement. `true` maps to `--fail-on hub`. |
| `caller-depth` | no | `1` | Caller traversal depth, clamped by detector bounds. |
| `max-callers` | no | `20` | Maximum caller rows, clamped by detector bounds. |
| `narrative` | no | `off` | `off` or `trusted`; trusted still requires safe event and configured SPEC-018 seam. |

## Outputs

| Name | Values | Description |
|------|--------|-------------|
| `summary-status` | `clean`, `impact`, `threshold_breach`, `unavailable` | Detector summary status. |
| `detector-exit-code` | `0`, `1`, `2`, `3` | Raw detector exit code captured by the helper. |
| `conclusion` | `pass`, `fail-threshold`, `fail-analysis-unavailable`, `fail-report-unavailable` | Final action conclusion after SPEC-020 policy mapping. |
| `threshold-breached` | `true`, `false` | Whether configured policy was breached. |
| `cache-status` | `warm-valid`, `miss`, `stale`, `corrupt`, `incompatible`, `rebuilt`, `unavailable` | Cache path taken before analysis. |
| `delivery-status` | `comment`, `fallback`, `failed` | Durable delivery path. |
| `comment-url` | URL or empty | Current action-owned comment when available. |
| `report-path` | path | Deterministic markdown report path. |
| `artifact-name` | string | Uploaded report artifact name. |
| `narrative-status` | `disabled`, `suppressed`, `unavailable`, `fallback`, `pending`, `appended` | Optional narrative outcome. |
| `codegraph-version` | string | Resolved CodeGraph runtime version. |
| `helper-version` | string | Resolved action helper version. |

## Required behavior

- The helper captures detector JSON and exit code instead of allowing shell failure on ordinary impact.
- The final conclusion follows [result-matrix.md](./result-matrix.md).
- Comment write attempts require observed write capability.
- Summary and artifact delivery are mandatory fallbacks when comments are unavailable.
- All outputs are emitted even when the final conclusion is failing, unless the action cannot write outputs at all.
