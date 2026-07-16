# Feature Specification: Web UI: Graph Browser

**Feature Branch**: `006-web-ui-graph-browser`

**Created**: 2026-07-15

**Status**: Draft

**Input**: User description: "Web UI: Graph Browser - a self-hosted browser app for developers to search, browse, navigate, visualize graph neighborhoods, inspect impact, re-index with progress, and ask graph-grounded chat questions from one local UI."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select Repo and See Status (Priority: P1)

As a developer exploring local codebases, I can select an indexed repository and immediately understand whether it is healthy, stale, indexing, or unavailable.

**Why this priority**: Repository selection and status are the entry point for every other workflow. Without this, users cannot trust search, graph, impact, or chat results.

**Independent Test**: Can be tested by opening the web app against a local backend with indexed, stale, and missing repository states and verifying that the repo picker and status surface show the correct state and next available action.

**Acceptance Scenarios**:

1. **Given** the local backend has one or more indexed repositories, **When** the user opens the web app, **Then** the user can select a repository and see its index health, staleness, and last analysis state.
2. **Given** the selected repository is stale or unavailable, **When** the user views the repo status, **Then** the UI clearly communicates the degraded state without hiding other safe navigation options.

---

### User Story 2 - Search and Open Symbols (Priority: P1)

As a developer, I can search for symbols in the selected repository and open a useful symbol detail page from the results.

**Why this priority**: Search is the fastest path from a user question to a concrete code entity and anchors later graph, impact, and chat workflows.

**Independent Test**: Can be tested by searching known symbols in an indexed repository and confirming that results link to a detail page with identifying metadata and source context.

**Acceptance Scenarios**:

1. **Given** an indexed repository with known symbols, **When** the user searches by symbol name or related text, **Then** matching symbols are listed with enough context to choose the right result.
2. **Given** a search returns no matches, **When** the user views the results area, **Then** the UI shows an empty state that keeps the selected repository context visible.

---

### User Story 3 - Inspect Symbol Relationships (Priority: P1)

As a developer, I can inspect callers, callees, flows, snippets, and trace-style context for a selected symbol.

**Why this priority**: Relationship inspection is the core CodeGraph value that helps users understand how code behavior is connected.

**Independent Test**: Can be tested by opening a symbol with known relationships and verifying that relationship sections can be inspected without using a separate IDE agent or CLI.

**Acceptance Scenarios**:

1. **Given** a selected symbol has callers, callees, or traceable flows, **When** the user opens the symbol detail page, **Then** those relationships are visible and navigable.
2. **Given** a selected symbol has missing or partial relationship data, **When** the user views the detail page, **Then** the UI distinguishes "none found" from "not available" or "truncated."

---

### User Story 4 - Explore Graph Neighborhoods (Priority: P1)

As a developer, I can visually explore graph neighborhoods with pan, zoom, filters, selection, and click-to-expand behavior.

**Why this priority**: The visual graph explorer is the defining browser workflow and must make CodeGraph relationships inspectable without requiring command-line graph queries.

**Independent Test**: Can be tested by loading a representative graph neighborhood, interacting with the canvas, expanding a node, and confirming that the visible graph and selected-node context update together.

**Acceptance Scenarios**:

1. **Given** a selected symbol has graph neighbors, **When** the user opens the graph view, **Then** the user sees a nonblank graph neighborhood with labels or accessible summaries sufficient to understand the selected context.
2. **Given** a graph neighborhood is visible, **When** the user pans, zooms, filters, or expands a node, **Then** the interaction updates the graph without losing the selected repository and symbol context.
3. **Given** a graph is too large to display fully in the browser, **When** the user opens or expands it, **Then** the UI applies clear limits and explains what was omitted or truncated.

---

### User Story 5 - Review Impact Radius (Priority: P2)

As a maintainer, I can inspect the likely impact radius and affected files for a selected symbol before making changes.

**Why this priority**: Impact review helps maintainers evaluate blast radius and prioritize safe edits.

**Independent Test**: Can be tested by selecting a symbol with known downstream dependents and verifying that impact details include affected symbols, files, and traversal limits.

**Acceptance Scenarios**:

1. **Given** a selected symbol has downstream impact, **When** the user opens the impact view, **Then** the UI summarizes affected files and symbols with enough context for review.
2. **Given** impact analysis is limited by missing data or configured traversal limits, **When** the user views the impact result, **Then** the limitation is visible and does not appear as a complete result.

---

### User Story 6 - Re-analyze with Progress (Priority: P2)

As a maintainer, I can trigger repository re-analysis from the web app and watch progress until completion or failure.

**Why this priority**: Users need a visible way to refresh stale graph data before relying on search, graph, impact, or chat answers.

**Independent Test**: Can be tested by triggering a re-analysis job and verifying that progress, completion, cancellation or failure states, and resulting repo freshness are visible.

**Acceptance Scenarios**:

1. **Given** a selected repository can be re-analyzed by the local backend, **When** the user starts re-analysis, **Then** the UI shows live progress and prevents duplicate confusing starts.
2. **Given** re-analysis completes or fails, **When** the progress stream ends, **Then** the UI shows the terminal state and updates the repository freshness accordingly.

---

### User Story 7 - Chat with Graph Context (Priority: P2)

As a developer, I can ask questions about the selected repository through a graph-grounded browser chat that uses the local backend and the SPEC-018 LLM layer.

**Why this priority**: Chat provides parity with agent-style workflows while preserving local-first secret boundaries and graph-grounded context.

**Independent Test**: Can be tested by asking a repository question through the browser, confirming that the request goes only to the local backend, and verifying visible responses or honest disabled states.

**Acceptance Scenarios**:

1. **Given** SPEC-018 chat is configured on the local backend, **When** the user asks a graph-grounded question, **Then** the browser sends the request to the local backend and displays the response with relevant repository context.
2. **Given** SPEC-018 chat is unavailable, dormant, or misconfigured, **When** the user opens or uses chat, **Then** the UI explains the disabled state without requesting or exposing provider keys in the browser.

### Edge Cases

- No local backend is reachable from the browser.
- The backend is reachable but no repositories are indexed.
- A selected repository is stale, partially indexed, or currently indexing.
- Search returns no results, many ambiguous results, or results from stale data.
- Symbol snippets, callers, callees, flows, or impact data are unavailable.
- Graph neighborhoods exceed browser-friendly display limits.
- Re-analysis progress disconnects, stalls, completes after navigation, or fails.
- Chat is disabled, awaiting configuration, rate-limited, or returns an error through the local backend.
- Non-loopback `serve --web` startup is treated as backend unreachable or unavailable because the packaged browser UI is loopback-only until browser-compatible API and EventSource session auth exists.
- The app is used with external network access blocked except for the local backend.
- Desktop and mobile layouts have constrained space for graph, detail, and chat panels.

## Clarifications

### Session 2026-07-15 - UX and Navigation

- Q: What primary navigation model should SPEC-006 require? A: Use a persistent repo-aware developer-tool shell with repo switcher/status, global search, breadcrumbs or tabs, and deep-linkable views for search, symbol details, graph, impact, re-analysis, and chat.
- Q: How should repository switching behave after a user has selected a symbol or graph context? A: Keep the global repo switcher visible; switching repositories resets repo-scoped symbol, graph, impact, and chat context to the new repo overview or search while preserving only safe search text.
- Q: What should the symbol detail view be responsible for? A: Treat symbol detail as the selected-symbol anchor with metadata, source context, relationship sections, graph and impact actions, and sticky selected-symbol context.
- Q: What is the graph canvas interaction contract for selection, expansion, and limits? A: Selection synchronizes details, expansion fetches bounded neighborhoods, filters constrain visible relationship or kind, truncation remains visible, and a non-canvas selected-node or neighbor summary is always available.
- Q: For mobile and non-happy-path states, what should remain visible while a panel is loading, empty, stale, offline, or failed? A: Preserve the shell plus selected repo or symbol context; replace only the affected panel with skeleton, empty, or error content, and use responsive tabs or sheets plus graph summaries on constrained screens.

### Session 2026-07-15 - API and Chat

- Q: Should SPEC-006 define existing backend API routes by reference to `src/server/openapi.yaml` instead of duplicating schemas in `spec.md`? A: Yes. `src/server/openapi.yaml` is authoritative for shipped status, repo, search, node, callers, callees, graph, impact, flows, clusters, and re-analysis contracts; SPEC-006 only adds browser behavior and any required chat/static deltas.
- Q: Which browser-chat contract should SPEC-006 add on top of SPEC-018? A: Add a same-origin `/api/*` chat surface with status, generate, and agent-bundle redemption behavior over SPEC-018 primitives, using route names and body shapes finalized in planning.
- Q: Who owns chat graph-context assembly and truncation? A: The backend assembles bounded graph context from the selected repo plus selected node or view hints and returns context-boundary or truncation metadata; the browser must not send raw provider prompts, raw source bundles, or provider configuration.
- Q: What auth/token/secret boundary should the browser follow for API and provider credentials? A: Browser calls stay same-origin; loopback defaults need no credentials; packaged browser serving on non-loopback binds is refused until browser-compatible API and EventSource session auth exists; provider URL/model/key material remains backend-only through `CODEGRAPH_LLM_*`.
- Q: What SSE/error behavior should the browser rely on for re-analysis progress? A: Use the shipped re-analysis job endpoints and live-only EventSource stream: snapshot, progress, terminal `done` or `error`, heartbeat comments, no Last-Event-ID replay, and the existing CodeGraph `ErrorEnvelope` for non-2xx REST errors.

### Session 2026-07-15 - Clean-Room Parity

- Q: What artifact should define GitNexus parity for SPEC-006? A: Planning must create a clean-room behavior parity matrix in `research.md` using public README/license inventory only, with columns for public behavior, SPEC-006 target, status, owning backend or follow-up spec, evidence URL, and clean-room notes.
- Q: How should unsupported GitNexus backend capabilities be represented? A: SPEC-006 must not create executable flows for capabilities absent from the shipped CodeGraph API except approved chat/static deltas; parity gaps must be labeled deferred, backend-blocked, or out of scope and tied to the owning follow-up spec where known.
- Q: What should a Cypher-style query affordance mean for SPEC-006? A: The UI may provide existing-API query presets for search, graph, impact, and flow workflows, but raw Cypher execution must be non-executing or disabled unless a supported CodeGraph backend route exists; raw Cypher is SPEC-013-blocked.
- Q: What local/Docker serving expectation should SPEC-006 require? A: Use local/package serving as the supported path: `codegraph serve --web` must serve packaged static assets on loopback, package validation must prove web assets are included, offline/no-CDN behavior must be tested, and non-loopback browser serving must be documented as unsupported until browser-compatible API/SSE session auth exists. SPEC-006 does not require a full production Dockerfile or hosted demo path.
- Q: What clean-room guardrails should be acceptance criteria? A: Planning, implementation, and PR evidence must include a clean-room source ledger listing allowed GitNexus public README/LICENSE URLs and confirming no GitNexus source, assets, screenshots, UI text, visual design, CSS, or implementation structure were inspected or copied.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST open directly to the production graph-browsing tool surface, not a marketing or landing page.
- **FR-002**: The system MUST let users view and select repositories known to the local backend.
- **FR-003**: The system MUST show repository health, staleness, index availability, and active analysis state for the selected repository.
- **FR-004**: The system MUST keep repository input backend-only; browser ZIP upload, drag-and-drop indexing, and browser-side indexing are out of scope for SPEC-006.
- **FR-005**: Users MUST be able to search symbols and related code entities within the selected repository.
- **FR-006**: Search results MUST provide enough identifying context for users to choose the intended symbol.
- **FR-007**: Users MUST be able to open a symbol detail view from search results or graph interactions.
- **FR-008**: The symbol detail view MUST show identifying metadata, source context, and available relationship summaries for the selected symbol.
- **FR-009**: The system MUST show callers, callees, flow, context, impact, and trace-style graph workflows where backend data is available.
- **FR-010**: The system MUST distinguish empty relationship results from unavailable, stale, or truncated relationship data.
- **FR-011**: Users MUST be able to open a visual graph explorer for a selected repository or symbol.
- **FR-012**: The graph explorer MUST support pan, zoom, filtering, node selection, and click-to-expand behavior.
- **FR-013**: The graph explorer MUST synchronize selected graph nodes with relevant symbol and relationship context.
- **FR-014**: The system MUST expose browser-friendly limits for large graph neighborhoods and clearly explain truncation or omitted data.
- **FR-015**: Users MUST be able to inspect impact radius and affected files for a selected symbol when backend data supports it.
- **FR-016**: The impact view MUST disclose traversal limits, stale inputs, and incomplete result conditions.
- **FR-017**: Users MUST be able to trigger backend repository re-analysis from the browser for eligible repositories.
- **FR-018**: The system MUST show live re-analysis progress and terminal success or failure states.
- **FR-019**: The system MUST prevent duplicate or ambiguous re-analysis actions while a repository analysis job is already active.
- **FR-020**: Browser chat MUST route through the local backend and SPEC-018; no LLM provider key, token, or provider-secret material may be sent to or stored in the browser.
- **FR-021**: Chat MUST show honest user-visible states for configured, disabled, dormant, misconfigured, pending, and failed backend chat modes.
- **FR-022**: Chat answers MUST be presented as graph-grounded repository assistance, with visible context boundaries when context is limited or truncated.
- **FR-023**: The runtime app MUST make no external CDN, hosted asset, hosted auth, hosted database, remote telemetry, or direct provider requests.
- **FR-024**: The self-hosted web mode MUST serve packaged runtime assets locally and keep local backend API routes distinct from browser route fallback.
- **FR-025**: GitNexus parity MUST be behavior-level only and limited to public README/license inventory: visual graph explorer, browser AI chat, repo status/selection, web mode with local backend or bridge, query/context/impact/trace-style workflows, and browser limits around large repositories when running fully client-side.
- **FR-026**: The project MUST NOT inspect, copy, derive from, or reproduce GitNexus repository source, assets, UI text, visual design, CSS, or implementation structure.
- **FR-027**: The planning and implementation MUST preserve the SPEC-004 stack requirement: Vite + React SPA under `web/`.
- **FR-028**: The planning and implementation MUST use Tailwind CSS and shadcn/ui, including shadcn skills/MCP where the workflow requires them.
- **FR-029**: The `web/` foundation MUST include `components.json`, CSS variables, a `cn` utility, and Vite Tailwind integration.
- **FR-030**: Planning MUST compare shadcn presets/styles before locking the final style and MUST run a Cytoscape.js vs Sigma.js renderer bake-off before choosing the production graph canvas.
- **FR-031**: The system MUST keep a persistent developer-tool shell visible across primary workflows, including repository switcher, selected repository status, global search, active navigation, and selected-context orientation.
- **FR-032**: Repository switching MUST prevent ambiguous cross-repository state by resetting repo-scoped symbol, graph, impact, and chat context when the selected repository changes, while preserving only safe search text or neutral route intent.
- **FR-033**: The symbol detail view MUST act as the canonical selected-symbol anchor, with visible paths to relationship details, graph exploration, impact review, and chat-with-context when those workflows are available.
- **FR-034**: Every graph canvas function required for exploration, including zoom, fit/reset, filtering, selecting, focusing, and expanding, MUST have a visible keyboard-operable control or equivalent in addition to pointer gestures.
- **FR-035**: The graph view MUST provide a non-canvas mirror of selected graph data, such as selected-node details and navigable neighbor or edge summaries, so canvas-only visual selection is not the only access path.
- **FR-036**: The system MUST use a consistent state taxonomy for backend unreachable, no repositories, stale or indexing repository, unauthorized or token-required API access, search loading/no results/ambiguous/degraded, graph loading/no neighbors/truncated/render failure, impact unavailable/truncated, re-analysis running/stalled/disconnected/succeeded/failed, and chat disabled/dormant/misconfigured/rate-limited/error.
- **FR-037**: Mobile and narrow layouts MUST preserve the primary workflows with responsive tabs or sheets, reachable controls, nonblank graph access or summary-first fallback, no required two-dimensional page scrolling outside the graph canvas, and no loss of selected repository context.
- **FR-038**: The browser UI MUST target WCAG 2.2 AA for primary workflows, including keyboard operation, visible focus, no keyboard traps, accessible names for icon controls, non-color-only status, reduced-motion support, and status messages for asynchronous changes.
- **FR-039**: The web UI MUST consume the shipped local API contract in `src/server/openapi.yaml` for repository, status, search, node, callers, callees, graph, impact, flows, clusters, and re-analysis workflows before adding any backend route.
- **FR-040**: Repo-scoped read workflows MUST use the existing repo-selection contract: `/api/status` accepts optional `?repo=<repo-id>` selection, `/api/repos` is not repo-scoped, search, node, callers, callees, graph, impact, flows, and clusters use `?repo=<repo-id>`, and re-analysis uses `/api/reindex/{repo}`.
- **FR-041**: Any SPEC-006 chat endpoint MUST be same-origin, backend-routed, and implemented as a thin adapter over SPEC-018 rather than a separate LLM provider implementation, preserving SPEC-018 generation result semantics for endpoint answers, pending bundles with fallback text and opaque handles, and fallback results for dormant, misconfigured, failed endpoint, or failed bundle-emission paths.
- **FR-042**: The browser chat request MUST carry only repository id, user prompt, and selected symbol or view context hints; the backend MUST assemble bounded graph context and return visible context-boundary or truncation metadata.
- **FR-043**: Chat configuration and provider-secret material MUST remain backend-only through `CODEGRAPH_LLM_*`; browser payloads, persisted web state, logs, and rendered UI MUST NOT contain provider keys, bearer tokens for providers, raw endpoint URLs, provider response bodies, or secret surrogates.
- **FR-044**: Chat unavailable, disabled, dormant, misconfigured, pending-bundle, rate-limited, endpoint-fallback, and backend-error states MUST be represented as explicit UI states without browser-side provider calls or browser-side provider SDK usage.
- **FR-045**: Re-analysis progress MUST use the existing SPEC-005 job and SSE contracts, including one active job per repo, duplicate-job `409`, snapshot-on-connect, progress events, terminal `done` or `error`, heartbeat comments, terminal-status-in-snapshot behavior for already-finished jobs, slow-consumer progress coalescing, disconnect-does-not-cancel semantics, and no Last-Event-ID replay guarantee.
- **FR-046**: API client handling MUST use the existing CodeGraph JSON error envelope `{ error: { code, message, details? } }` and route-specific success-shaped degraded states; SPEC-006 MUST NOT introduce a competing browser-only error protocol.
- **FR-047**: Browser API calls in the packaged runtime MUST use relative same-origin `/api/*` REST or EventSource routes, keep `/api/*` distinct from SPA fallback, and enforce no external runtime connections except the local backend and any backend-owned provider calls.
- **FR-048**: Backend work in SPEC-006 MUST be limited to static asset/package integration and the minimal chat adapter needed for SPEC-018; new graph-query backends, Cypher implementation, browser indexing, LSP-over-WebSocket behavior, persistent job history, chat transcript persistence, and provider-specific browser SDKs are out of scope.
- **FR-049**: Planning MUST produce a clean-room behavior parity matrix from public README/license inventory, with implemented, deferred, backend-blocked, and out-of-scope dispositions and evidence links.
- **FR-050**: The UI MUST NOT create executable flows for backend capabilities absent from `src/server/openapi.yaml` except the approved SPEC-018 chat adapter and static serving; parity gaps MUST be labeled deferred, backend-blocked, or out of scope.
- **FR-051**: Any Cypher-style UI MUST be non-executing or disabled unless a supported CodeGraph backend route exists; SPEC-006 may offer existing-API query presets and MUST identify raw Cypher as SPEC-013-blocked.
- **FR-052**: SPEC-006 MUST validate local package serving through `codegraph serve --web` and document loopback package-shipped assets, existing host and port behavior, and the current non-loopback browser-serving refusal.
- **FR-053**: Planning, implementation, and PR evidence MUST include a clean-room source ledger listing allowed GitNexus public README/LICENSE URLs and confirming no source, assets, screenshots, UI text, visual design, CSS, or implementation structure were inspected or copied.
- **FR-054**: The browser UI MUST define keyboard-operable paths for the sidebar, repository switcher, global search, responsive tablists, graph controls, dialogs, sheets, and chat controls, with logical DOM/tab order, no positive `tabindex`, and no pointer-only operation for primary workflows.
- **FR-055**: Dialogs, sheets, command/search overlays, chat send or failure flows, and mobile responsive panels MUST define focus behavior, including initial focus, contained focus while modal, Escape or visible close behavior where applicable, return focus to the invoking control, and focus placement that remains visible after layout or scroll changes.
- **FR-056**: The UI MUST expose programmatically determinable landmarks, headings, labels, roles, names, values, and state changes for sidebar/search/tabs/dialog/sheet/chat regions, icon-only controls, graph controls, status badges, and disabled or degraded states; repeated controls with the same function MUST use consistent accessible names.
- **FR-057**: Graph and impact workflows MUST provide synchronized non-canvas, programmatic summaries for selected graph nodes, neighbors, edges, impact affected symbols, affected files, traversal limits, stale inputs, truncation, and incomplete-result conditions, so visual canvas or color-only output is never the sole source of relationship or impact information.
- **FR-058**: Visual accessibility requirements MUST quantify WCAG 2.2 AA contrast for the dense developer UI: normal text at 4.5:1, large text and UI state/focus indicators at 3:1, graph nodes/edges/selection affordances and other non-text information at 3:1 against adjacent colors, and no status conveyed by color alone.
- **FR-059**: Pointer and touch targets for toolbar buttons, graph controls, tabs, sheet/dialog controls, and chat controls MUST meet WCAG 2.2 AA target-size requirements of at least 24 by 24 CSS pixels or a documented allowed exception; primary mobile controls SHOULD provide at least 44 by 44 CSS pixels where the dense layout permits.
- **FR-060**: Reduced-motion and reflow requirements MUST cover graph layout animation, pan/zoom easing, panel transitions, loading indicators, chat/progress updates, and skeleton shimmer by respecting `prefers-reduced-motion`; primary workflows MUST preserve content and function at 200% text resize and 320 CSS-pixel reflow without text overlap or hidden controls outside the intentionally two-dimensional graph canvas region.

### Non-Functional Requirements

- **NFR-001**: Primary UI actions for repository selection, search submission, symbol opening, graph view opening, re-analysis start, and chat submission MUST show visible feedback within 100 ms of the browser event, even when backend work remains pending.
- **NFR-002**: Search results and symbol detail content MUST render within 500 ms after a successful local API response is received on a representative indexed repository; if the backend has not responded within 500 ms, the affected panel MUST remain in a visible loading or skeleton state without blocking the shell.
- **NFR-003**: Representative graph payloads up to 500 nodes and 1,000 edges MUST produce a nonblank canvas or documented summary-first fallback within 2,000 ms after the payload is received, and graph pan, zoom, selection, filter, fit/reset, and expansion controls MUST avoid validation-visible main-thread stalls over 100 ms.
- **NFR-004**: Large or capped graph payloads up to the shipped OpenAPI cap MUST preserve explicit truncation disclosure and avoid unbounded browser expansion; over-limit cases MUST degrade to summary-first or capped rendering rather than attempting to render every omitted node or edge.
- **NFR-005**: Re-analysis progress MUST show an active state within 1,000 ms of an accepted start response, reflect received SSE progress or terminal events within 1,000 ms, and surface stream disconnect or stalled states within 3,000 ms unless a terminal snapshot has already arrived.
- **NFR-006**: Package validation MUST record built JS and CSS asset sizes; any single uncompressed runtime JS or CSS asset above 1.5 MB MUST be split, deferred, or documented as an accepted review exception with no external runtime asset fallback.

### Reviewability Budget *(mandatory)*

- **Primary surface**: UI
- **Secondary surfaces, if any**: API, package/static serving, docs/process
- **Projected reviewable LOC**: 1115
- **Projected production files**: 35
- **Projected total files**: 55
- **Budget result**: warning accepted
- **Split decision**: Remains one spec because the repository picker, symbol pages, graph explorer, impact view, re-analysis progress, chat surface, and package serving form one coherent self-hosted web surface. Implementation must stay in three reviewable vertical slices: foundation/search/symbol, graph canvas, and impact/reindex/chat/package validation.

### PR Review Packet Requirements *(mandatory)*

- PR description MUST include: what changed, why, non-goals, review order,
  scope budget, traceability, verification evidence, known gaps, and rollback
  or feature-flag notes.
- Traceability MUST map each major requirement or success criterion to changed
  files and verification evidence.
- Deferred work MUST name the follow-up spec or issue.

### Key Entities

- **Repository**: A local codebase known to the backend, with identity, display name, path metadata safe for display, index availability, and freshness state.
- **Repository Status**: Health, staleness, active job, last analysis, and degraded-state information for a repository.
- **Symbol**: A code entity users can search, open, inspect, and use as the anchor for graph, impact, and chat workflows.
- **Symbol Relationship**: Caller, callee, flow, context, trace, or graph neighbor data associated with a symbol.
- **Graph View**: The visible graph neighborhood, selected node, filters, expansion state, layout state, and truncation disclosures.
- **Impact Summary**: Affected symbols, files, traversal depth, limits, and incomplete-result disclosures for a selected symbol.
- **Re-analysis Job**: Backend analysis work initiated from the browser, including progress, status, terminal state, and repository freshness update.
- **Chat Conversation**: User prompts, backend responses, graph-grounded context references, disabled states, and context-limit disclosures.
- **Chat Status**: Backend-owned readiness state for chat, including endpoint-active, agent-mode pending bundle, dormant, misconfigured, endpoint fallback, rate-limited, unavailable, and error states.
- **Chat Context Boundary**: Server-assembled graph context, selected repo and symbol hints, truncation metadata, and fallback explanation shown with chat answers.
- **Clean-room Behavior Inventory**: Public README/license-only behavior notes used to track behavior-level parity without source, asset, text, design, CSS, or implementation copying.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 90% of first-time users can select an indexed repository, identify its freshness state, search for a known symbol, and open symbol details in under 3 minutes.
- **SC-002**: Users can move from symbol details to graph neighborhood exploration and back to selected-symbol context without losing repository context in 100% of tested primary flows.
- **SC-003**: Representative graph neighborhoods render visibly and support pan, zoom, selection, filtering, and expansion without blank-canvas failures in desktop and mobile validation.
- **SC-004**: Large graph neighborhoods clearly disclose truncation or omitted data in 100% of tested over-limit cases.
- **SC-005**: Maintainers can identify affected files for a selected symbol in under 2 minutes when impact data is available.
- **SC-006**: Re-analysis progress displays a live active state and a terminal success or failure state for 100% of tested jobs.
- **SC-007**: Browser chat never exposes provider secrets and makes no direct provider requests in network inspection across configured, disabled, and misconfigured states.
- **SC-008**: The runtime app remains usable with all external network access blocked except the local backend, with no external CDN or hosted runtime requests.
- **SC-009**: Desktop and mobile UAT find no critical text overlap, unreachable primary controls, or keyboard traps in the repository, search, symbol, graph, impact, re-analysis, and chat workflows.
- **SC-010**: Clean-room review confirms behavior-level parity notes were derived only from public README/license inventory and did not copy source, assets, text, visual design, CSS, or implementation structure.
- **SC-011**: Maintainers can build package assets, run `codegraph serve --web`, verify the app loads packaged web assets with external network access blocked except the local backend, and follow documented loopback-only browser serving guidance.
- **SC-012**: Accessibility validation confirms keyboard-only completion of repository, search, symbol, graph, impact, re-analysis, and chat workflows; dialog/sheet focus containment and return; accessible names and status announcements for icon and async controls; synchronized graph and impact text mirrors; WCAG 2.2 AA contrast and target-size thresholds; reduced-motion behavior; and no text overlap at required desktop/mobile text-resize and reflow checks.
- **SC-013**: Performance validation confirms UI feedback, post-response rendering, representative graph rendering, large-graph degradation, re-analysis progress updates, and package asset-size evidence satisfy NFR-001 through NFR-006.

## Assumptions

- SPEC-004 establishes the required browser app stack for this feature.
- SPEC-005 provides or will provide the local web-serving and backend API surface needed for repository, search, symbol, graph, impact, and re-analysis workflows.
- SPEC-018 provides the local backend LLM layer used by browser chat, including disabled or dormant behavior when not configured.
- `src/server/openapi.yaml` is the authoritative API contract for SPEC-006 planning; archived SPEC-005 text is precedent, while the live OpenAPI file reflects shipped additions such as flows and clusters.
- SPEC-018 provides endpoint, agent-bundle, dormant, and misconfigured modes; SPEC-006 is only a browser consumer and thin server adapter of that layer.
- A configured chat endpoint may call user-configured LLM endpoints from the backend, but the browser runtime itself remains same-origin and does not make provider calls.
- Users run the web app against a local CodeGraph backend; hosted multi-tenant access, hosted authentication, and remote repository ingestion are outside this feature.
- The browser can present large graphs with explicit limits instead of attempting to display every node and edge client-side.
- Mobile support must preserve access to primary workflows, but dense graph exploration may use constrained or summarized views where needed.
- GitNexus behavior inventory is limited to public README/license material and exists only to guide behavior-level parity, not implementation, wording, or visual design.
