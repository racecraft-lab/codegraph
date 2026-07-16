# Phase 0 Research: PR Blast-Radius Review Action

## Decision: Use a composite action with a compiled helper

**Rationale**: A composite action can own setup/cache/report steps while a compiled helper handles stateful orchestration, detector interpretation, comment upsert, and fallback delivery. This satisfies the roadmap's `actions/pr-impact/action.yml` + `run.ts` shape without asking consuming repositories to execute uncompiled TypeScript.

**Alternatives considered**:

- Pure shell composite action: rejected because result-matrix interpretation, duplicate-comment recovery, and narrative status would become brittle.
- JavaScript action only: rejected because the roadmap calls for a composite action that can express setup/cache/upload steps directly.
- Runtime `tsx` or uncompiled TypeScript: rejected because consuming repositories should not depend on source-only execution.

## Decision: Pin CodeGraph CLI/runtime via action input and report metadata

**Rationale**: The action needs reproducible behavior across consuming repositories. A `codegraph-version` input pins the CLI/runtime version, while the helper reports the resolved version and helper version in outputs/report metadata.

**Alternatives considered**:

- Always use repository source: rejected because external consumers do not have this repository's build output.
- Floating latest package: rejected because it makes CI behavior drift without a workflow change.
- Bundle all CodeGraph runtime output inside the action directory: rejected for v1 because it risks large generated artifacts and duplicated package release rules.

## Decision: Treat detector JSON as canonical and normalize shell exit handling in the helper

**Rationale**: SPEC-012 intentionally uses exit code 1 for ordinary impact and exit code 2 for threshold breach. The action must capture that result and apply SPEC-020 policy: ordinary impact passes, configured threshold breach fails, unavailable analysis fails.

**Alternatives considered**:

- Let shell `set -e` fail on any nonzero detector exit: rejected because ordinary impact would fail contrary to Q2.
- Reimplement detector policy in the action: rejected because it creates a second policy engine and risks drift.

## Decision: Use pull_request event analysis and gate privileged operations by observed permissions

**Rationale**: GitHub's official token guidance says workflows should grant the least required `GITHUB_TOKEN` permissions, and workflow syntax docs state forked pull-request runs typically cannot be granted write access unless a repository admin opts into write tokens. The action should analyze untrusted PR code in the pull-request context, then attempt comment/narrative only when token permissions and trust allow it.

**Alternatives considered**:

- `pull_request_target` for all behavior: rejected because it risks privileged execution around untrusted PR code.
- Same-repository PRs only: rejected by Q1 safe fork support.
- Identical behavior on forks: rejected because secrets/write credentials are not generally safe or available.

References:

- GitHub Docs, "Use GITHUB_TOKEN for authentication in workflows": https://docs.github.com/en/actions/tutorials/authenticate-with-github_token
- GitHub Docs, "Workflow syntax for GitHub Actions" permissions and fork behavior: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax

## Decision: Validate cache before analysis and record the cache path taken

**Rationale**: Q6 says cache changes latency, not correctness. Cache identity therefore includes lockfile identity, merge base, base ref, PR head, and CodeGraph runtime identity. Restored state is accepted only when version/extraction state, repository/comparison identity, complete index state, and freshness checks pass.

**Alternatives considered**:

- Trust cache key only: rejected because stale indexes could be reported as current.
- Always rebuild: rejected because it discards the warm-cache performance goal.

## Decision: Keep optional narrative downstream of deterministic conclusion

**Rationale**: SPEC-018 exposes a prose generation seam that can be dormant, endpoint-backed, agent-bundle pending, misconfigured, or fallback. SPEC-020 uses that seam only after deterministic facts and final conclusion are fixed, records narrative status, and never lets prose alter machine outputs.

**Alternatives considered**:

- Let narrative classify risk: rejected by Q4 and the constitution's deterministic graph authority.
- Fail when narrative is unavailable: rejected because narrative is optional and off by default.

## Decision: Measure warm-cache performance with at least five eligible dogfood runs

**Rationale**: A median over at least five successful self-repository pull-request runs is small enough for project workflow overhead but large enough to avoid one-run noise. Samples require accepted cache validation, thresholds unset, and narrative disabled so the measurement binds the warm-cache action path.

**Alternatives considered**:

- Single-run timing: rejected as too noisy.
- Include cold-cache or narrative runs: rejected because those measure different paths.
