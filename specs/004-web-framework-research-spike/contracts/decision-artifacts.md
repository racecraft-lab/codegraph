# Contract: SPEC-004 Decision Artifacts

This contract defines the durable artifacts that SPEC-004 implementation must produce.

## `docs/design/web-framework-decision.md`

The decision document must include these sections:

1. Executive recommendation with exactly one selected framework stack.
2. Scope and non-goals, including "no production code" and "prototype source not committed."
3. Design concept decisions quoted from Q2-Q10.
4. Candidate matrix covering all six roadmap candidates.
5. Current-source evidence table with official docs and live package/repository metadata.
6. Hard-gate results for self-host anywhere, offline/package-shipped assets, no hosted-service runtime dependency, permissive license, package footprint, and maintenance health.
7. Weighted scoring for gate-passing candidates only.
8. Selected graph-rendering library or approach and why it fits the chosen stack.
9. Shipping strategy covering embedded package-shipped static assets and a standalone container recipe.
10. Prototype method, data shape, screenshots, performance notes, reproduction notes, and limitations.
11. Self-repo UAT result using representative CodeGraph data from this repository.
12. Deferred concerns mapped to SPEC-005, SPEC-006, SPEC-007, or a named follow-up.

## Evidence Requirements

- Every candidate must cite official documentation.
- Every candidate must cite live package or repository metadata checked during implementation.
- Every hard-gate pass/fail result must cite evidence.
- Every volatile live-source evidence record must include the captured observed value, source URL, access date, lookup method/tool/path, and the gate, score, or claim it supports.
- Bare links, uncaptured package-page observations, or unstored repository observations are not acceptable evidence for hard-gate pass/fail decisions.
- If metadata is unavailable, stale, or conflicting, the decision document must record the attempted lookup, the missing or conflicting value, and the conservative impact instead of treating absence as pass evidence.
- Any candidate that fails a hard gate must be excluded from final weighted ranking.
- The recommended stack must pass every hard gate and have prototype evidence.
- If browser automation, package metadata, or graph-rendering validation is unavailable, the document must record the fallback and impact.

## Screenshot Assets

Expected committed paths:

```text
docs/design/assets/spec-004/self-repo-graph.png
docs/design/assets/spec-004/one-k-node-target.png
```

Additional PNGs are allowed only when they clarify a concrete gate, fallback, or prototype result.

## Forbidden Durable Changes

SPEC-004 must not commit:

- Production web source code.
- Long-lived prototype source.
- Generated `node_modules` or web build output.
- SQLite schema changes.
- Extraction, retrieval, MCP, installer, or release-flow behavior changes.
- CDN/runtime hosted-service dependencies.
- Non-permissive or source-available-only dependencies.

## Review Packet Contract

The PR description for SPEC-004 must include:

- What changed.
- Why the decision is needed.
- Non-goals.
- Review order.
- Scope budget.
- Traceability from requirements to artifacts and evidence.
- Verification evidence.
- Known gaps and deferred work.
- Rollback or feature-flag notes, including that no production behavior changes are introduced.
