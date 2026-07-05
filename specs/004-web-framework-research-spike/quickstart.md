# Quickstart: Validate SPEC-004

Use this guide during implementation to prove the research spike is complete and reviewable.

## Prerequisites

- Run from the repository root.
- Use the existing npm workflow.
- Use only local files, official documentation, live package/repository metadata, and locally generated prototype assets.
- Keep prototype source in a temporary or ignored path. Do not commit prototype source.

## 1. Refresh Current Research

For each framework candidate:

1. Read official documentation for production build, self-hosting, asset loading, routing, and deployment model.
2. Capture live package metadata: version, license, repository URL, package size signals, dependencies, and package health.
3. Capture repository metadata: archive/deprecation status, latest release or meaningful activity, license file, and maintainer warnings.
4. Add evidence links and access dates to `docs/design/web-framework-decision.md`.

Expected result: all six roadmap candidates have official-doc evidence and live metadata before gates or scores are finalized.

## 2. Apply Hard Gates

Evaluate every candidate against:

- Self-host anywhere.
- Offline/package-shipped assets.
- No hosted-service runtime dependency.
- Permissive license.
- Package footprint.
- Maintenance health.

Expected result: every gate has a status, evidence, and a short rationale. Failed candidates are excluded from weighted ranking.

## 3. Score Gate-Passing Candidates

Score each gate-passing candidate from 0 to 5:

| Criterion | Weight |
|-----------|--------|
| UX and graph-interaction fit | 35 |
| Deployment effort | 20 |
| Developer experience | 15 |
| Cost/self-host operations | 10 |
| Footprint | 10 |
| License and maintenance risk | 10 |

Expected result: exactly one recommended stack, with runner-up tradeoffs and downstream guidance for SPEC-005, SPEC-006, and SPEC-007.

## 4. Build Throwaway Prototype

Create the selected-stack prototype outside durable source, for example:

```bash
mkdir -p /tmp/spec-004-web-framework-research/prototype
```

Use representative CodeGraph data from this repository with the documented graph JSON shape:

```json
{
  "metadata": {
    "source": "codegraph repository",
    "nodeCount": 1000,
    "edgeCount": 0,
    "selection": "representative self-repo subset or 1k-node/60fps target"
  },
  "nodes": [
    {
      "id": "stable node id",
      "label": "display name",
      "kind": "function",
      "file": "src/example.ts",
      "line": 1
    }
  ],
  "edges": [
    {
      "source": "source node id",
      "target": "target node id",
      "kind": "calls",
      "provenance": "static"
    }
  ]
}
```

Expected result: prototype renders representative self-repo data and a 1k-node/60fps target, or records the closest achieved fallback with cause and downstream implication.

## 5. Capture Evidence

Capture browser screenshots using the available browser automation path. If unavailable, use local Playwright or an equivalent local browser screenshot flow and record the fallback.

Expected committed assets:

```text
docs/design/assets/spec-004/self-repo-graph.png
docs/design/assets/spec-004/one-k-node-target.png
```

Expected notes in `docs/design/web-framework-decision.md`:

- Prototype commands.
- Browser/tooling path.
- Machine context.
- Node/edge counts.
- First visible render timing.
- Interaction observations.
- Asset size and package-footprint notes.
- Limitations and deferred work.

## 6. Run Self-Repo UAT

Run the project floor:

```bash
npm run build
npm test
```

Then verify the prototype evidence uses representative CodeGraph data from this repository and no hosted runtime services.

Expected result: UAT outcome is recorded as pass, pass with limitation, or fail. Any fallback is explicit.

## 7. Review Durable Diff

Before review, confirm the durable diff contains only planning, decision, and screenshot evidence artifacts for SPEC-004.

Expected durable implementation paths:

```text
docs/design/web-framework-decision.md
docs/design/assets/spec-004/*.png
specs/004-web-framework-research-spike/
```

Forbidden durable changes:

- Production web source.
- Long-lived prototype source.
- Generated web build output.
- Changes to extraction, retrieval, MCP, SQLite schema, installer behavior, or release behavior.

Expected result: SPEC-004 remains a docs/process research spike.
