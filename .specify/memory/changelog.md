# SpecKit Memory Changelog

- **2026-07-05** — SPEC-001 archived. PRs #16 (`27ee278`) + #17 (`c16d53f`) merged;
  roadmap row flipped to ✅ Complete; constitution amended to v1.1.0 (Dogfooding
  binding); `specs/001-embedding-infrastructure/` removed with provenance in
  [archive-reports/2026-07-05-SPEC-001.md](archive-reports/2026-07-05-SPEC-001.md);
  `.specify/feature.json` cleared (no feature in flight). Post-merge dogfood loop:
  3,571/3,571 symbols embedded (100%) on schema v8 via HAL.

- **2026-07-05** - SPEC-004 archived. PR #19 (`0366d3c`) merged; roadmap row
  flipped to complete; SPEC-005 moved to ready because the framework choice,
  static-asset/container handoff, and no-hosted-runtime constraints now live in
  `docs/design/web-framework-decision.md`; `specs/004-web-framework-research-spike/`
  removed with provenance in
  [archive-reports/2026-07-05-SPEC-004.md](archive-reports/2026-07-05-SPEC-004.md);
  `.specify/feature.json` cleared (no feature in flight).

- **2026-07-07** - SPEC-023 archived. PR #21 (`100a675`) merged; roadmap row
  flipped to complete; `specs/023-ocaml-language-support/` removed with
  provenance in
  [archive-reports/2026-07-07-SPEC-023.md](archive-reports/2026-07-07-SPEC-023.md).

- **2026-07-07** - SPEC-002 archived. PR #22 (`7c11f27`) merged; roadmap row
  flipped to complete; `specs/002-local-embedding-fallback/` removed with
  provenance in
  [archive-reports/2026-07-07-SPEC-002.md](archive-reports/2026-07-07-SPEC-002.md).

- **2026-07-07** - SPEC-008 archived. PRs #23 (`77c282b`), #24 (`53a9adf`),
  #25 (`096fef1`), #26 (`052f8b0`), and #27 (`8c53f53`) merged; roadmap row
  flipped to complete; SPEC-010 moved to ready because the LSP substrate shipped;
  SPEC-024 moved to no-current-gap/dormant because the final parity gate recorded
  zero unowned rows; `specs/008-lsp-client-integration/` removed with provenance
  in [archive-reports/2026-07-07-SPEC-008.md](archive-reports/2026-07-07-SPEC-008.md);
  `.specify/feature.json` cleared (no feature in flight).

- **2026-07-10** - SPEC-025 archived. PR #35 (`62693fb`) merged; roadmap row
  flipped to complete; SPEC-026 moved to ready because the plugin-channel
  decision document now lives in `docs/design/plugin-channel-decision.md`;
  `specs/025-plugin-platform-spike/` removed with provenance in
  [archive-reports/2026-07-10-SPEC-025.md](archive-reports/2026-07-10-SPEC-025.md).

- **2026-07-10** - SPEC-003 archived. PR #36 (`2c6c643`) merged; roadmap row
  flipped to complete; hybrid semantic search is live on main (dogfood loop run:
  build + sync + status healthy, `Hybrid search available: yes`);
  `specs/003-hybrid-semantic-search/` removed with provenance in
  [archive-reports/2026-07-10-SPEC-003.md](archive-reports/2026-07-10-SPEC-003.md);
  `.specify/feature.json` cleared (no feature in flight).

- **2026-07-13** - SPEC-005 archived. PRs #41 (`316ade4`) and #42 (`1857872`)
  merged (two stacked slices: read API; re-index jobs & SSE); roadmap row flipped
  to complete; SPEC-006 and SPEC-009 unblocked (both depended on SPEC-005's
  API/daemon surface); `codegraph serve --web` is live on main (post-merge dogfood
  loop: build + sync + status healthy); `specs/005-local-http-server/` removed
  with provenance in
  [archive-reports/2026-07-13-SPEC-005.md](archive-reports/2026-07-13-SPEC-005.md).

- **2026-07-13** - SPEC-010 archived. PRs #43 (`0db9db5`) and #44 (`f2e307d`)
  merged (two vertical slices: plan engine + CLI dry-run; atomic apply + MCP
  tool); roadmap row flipped to complete; no downstream spec changes readiness
  (SPEC-010 is a dependency-graph leaf); `specs/010-graph-aware-rename/` removed
  with provenance in
  [archive-reports/2026-07-13-SPEC-010.md](archive-reports/2026-07-13-SPEC-010.md);
  `.specify/feature.json` cleared (no feature in flight after this cleanup).

- **2026-07-15** - SPEC-018 archived. PRs #48 (`2cd10a7`) and #49 (`4acfa1b`)
  merged (two slices: endpoint path; agent-bundle path); roadmap row flipped to
  complete; SPEC-019's LLM dependency is satisfied and SPEC-020's optional
  narrative path is available; `specs/018-llm-access-layer/` removed with
  provenance in
  [archive-reports/2026-07-15-SPEC-018.md](archive-reports/2026-07-15-SPEC-018.md).

- **2026-07-15** - SPEC-011 archived. PR #50 (`ecb5d83`) merged (execution-flow
  and functional-cluster catalogs over MCP and REST); roadmap row flipped to
  complete; SPEC-012 can use flow impact enrichment and SPEC-019 is ready because
  both SPEC-011 and SPEC-018 are merged; `specs/011-execution-flows-clusters/`
  removed with provenance in
  [archive-reports/2026-07-15-SPEC-011.md](archive-reports/2026-07-15-SPEC-011.md);
  `.specify/feature.json` cleared (no active spec remains after this cleanup).

- **2026-07-15** - SPEC-012 archived. PR #55 (`d14e9d6`) merged (local
  diff-to-impact detection over CLI and MCP); roadmap row flipped to complete;
  SPEC-020 moved to ready because the stable report contract, markdown output,
  threshold exit codes, and MCP surface are merged; `specs/012-change-impact-detection/`
  removed with provenance in
  [archive-reports/2026-07-15-SPEC-012.md](archive-reports/2026-07-15-SPEC-012.md);
  `.specify/feature.json` cleared because it pointed at the archived spec.

- **2026-07-16** - SPEC-006 archived. PR #153 (`098e49e`) merged (packaged
  self-hosted web graph browser); roadmap row flipped to complete; SPEC-007 moved
  to ready because the packaged app shell, local API clients, graph surface, and
  static-asset pipeline are merged; `specs/006-web-ui-graph-browser/` removed
  with provenance in
  [archive-reports/2026-07-16-SPEC-006.md](archive-reports/2026-07-16-SPEC-006.md).

- **2026-07-16** - SPEC-020 archived. PR #154 (`316ca16`) merged (reusable PR
  blast-radius review action); roadmap row flipped to complete;
  `specs/020-pr-blast-radius-review-action/` removed with provenance in
  [archive-reports/2026-07-16-SPEC-020.md](archive-reports/2026-07-16-SPEC-020.md);
  `.specify/feature.json` cleared because the repository-wide sweep left no
  active spec directory.

- **2026-07-24** - SPEC-009 archived. PRs #159 (`2c0053b`), #160 (`29c7615`),
  #161 (`9a086b9`), and #162 (`436b183`) merged as an ordered stack (read core,
  stdio facade, focused source viewer, WebSocket safety); roadmap row flipped to
  complete; `specs/009-lsp-server-facade/` removed with provenance and the
  stale T018-T048 checkbox reconciliation in
  [archive-reports/2026-07-24-SPEC-009.md](archive-reports/2026-07-24-SPEC-009.md);
  `.specify/feature.json` cleared because no active spec remains.
