# Data Model: PR Blast-Radius Review Action

## PullRequestContext

| Field | Type | Rules |
|-------|------|-------|
| `repository` | string | Required owner/name of the repository under analysis. |
| `pullNumber` | number | Required for comment delivery; absent only in unsupported events. |
| `baseRef` | string | Required comparison base ref or SHA. |
| `headSha` | string | Required pull-request head SHA. |
| `mergeBase` | string | Required before cache identity is considered valid. |
| `isForkLike` | boolean | True for forks or other read-only/untrusted contexts. |
| `tokenPermissions` | object | Captures observed delivery capability; write assumptions must be proven. |

## ActionInputs

| Field | Type | Default | Rules |
|-------|------|---------|-------|
| `codegraph-version` | string | Action release default | Must resolve to a reproducible CodeGraph CLI/runtime version. |
| `base-ref` | string | Pull-request base ref/SHA | Required outside pull_request events. |
| `fail-on-callers` | integer or empty | empty | Empty means advisory. Non-empty maps to detector `callers>N`. |
| `fail-on-hubs` | boolean | false | False means advisory. True maps to detector `hub`. |
| `caller-depth` | integer | 1 | Must respect detector bounds 1-3. |
| `max-callers` | integer | 20 | Must respect detector bounds 1-100. |
| `narrative` | enum | `off` | Allowed values: `off`, `trusted`. `trusted` still requires safe event and configured SPEC-018 seam. |

## DetectorResult

| Field | Type | Rules |
|-------|------|-------|
| `summary.status` | enum | One of `clean`, `impact`, `threshold_breach`, `unavailable`. |
| `exitCode` | integer | 0 clean, 1 impact, 2 threshold breach, 3 unavailable. |
| `changedSymbols` | array | Canonical changed symbol facts from SPEC-012. |
| `callers` | array | Canonical impacted caller facts from SPEC-012. |
| `affectedFlows` | object | Canonical affected-flow state and items from SPEC-012. |
| `risks` | array | Includes threshold-breach risks when policy is breached. |
| `warnings` | array | Includes stale-index and limitation warnings. |
| `limits` | object | Caller depth, caller row limit, hub threshold, flow limits, truncation flags. |

## CacheValidationResult

| State | Meaning | Next transition |
|-------|---------|-----------------|
| `warm-valid` | Restored cache identity and freshness checks pass. | Run analysis. |
| `miss` | No usable cache was restored. | Rebuild, then analyze. |
| `stale` | Cache exists but comparison or working-tree freshness does not match. | Rebuild, then analyze. |
| `corrupt` | Cache is unreadable or incomplete. | Rebuild, then analyze. |
| `incompatible` | CodeGraph version or extraction version is incompatible. | Rebuild, then analyze. |
| `unavailable` | Rebuild or validation cannot recover a usable index. | Publish unavailable report and fail. |

## DeliveryResult

| Field | Type | Rules |
|-------|------|-------|
| `comment` | enum | `updated`, `created`, `skipped`, `permission-denied`, `failed`. |
| `summary` | enum | `written` or `failed`. |
| `artifact` | enum | `uploaded` or `failed`. |
| `currentCommentId` | string or null | Set only when comment delivery succeeds. |
| `duplicateCommentIds` | array | Action-owned duplicates found and retired or warned. |
| `reportPath` | string | Local markdown path uploaded or summarized. |

## NarrativeResult

| State | Meaning |
|-------|---------|
| `disabled` | Narrative input is off. |
| `suppressed` | Event trust or secret availability does not permit narrative. |
| `unavailable` | SPEC-018 seam is not configured or cannot produce endpoint prose. |
| `fallback` | SPEC-018 returned deterministic fallback prose. |
| `pending` | SPEC-018 agent bundle was emitted and deterministic fallback was used now. |
| `appended` | Trusted endpoint prose was appended after deterministic conclusion was fixed. |

## FinalConclusion

| State | Meaning |
|-------|---------|
| `pass` | Clean or ordinary impact, durable report delivery available, no threshold breach. |
| `fail-threshold` | Configured caller or hub threshold breached. |
| `fail-analysis-unavailable` | Analysis unavailable after cache/rebuild fallback. |
| `fail-report-unavailable` | Analysis succeeded but no durable report surface remained available. |

## State Transitions

```text
PullRequestContext
  -> CacheValidationResult
  -> DetectorResult
  -> FinalConclusion (deterministic)
  -> DeliveryResult
  -> NarrativeResult (optional, prose-only)
  -> Published report + outputs
```

Narrative never transitions back into `DetectorResult` or `FinalConclusion`.
