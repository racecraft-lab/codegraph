# Data Model: Web UI Graph Browser

## Repository

Represents one local codebase known to the backend.

Fields:

- `id`: opaque repository id from `/api/repos`; required.
- `name`: display name safe for UI.
- `root`: backend-provided local path metadata; display only where safe.
- `default`: whether this is the server startup repo.
- `status`: `RepositoryStatus`; loaded separately from `/api/status` for default repo and route-specific degraded states for selected repos.

Validation rules:

- Browser treats `id` as opaque and never derives filesystem paths.
- Switching repositories resets selected symbol, graph, impact, and chat context; only safe search text or neutral route intent may remain.

## RepositoryStatus

Represents index health, freshness, active job, and degraded API states.

Fields:

- `state`: `healthy | stale | indexing | unavailable | not_indexed | unauthorized | error`.
- `fileCount`, `nodeCount`, `edgeCount`: optional counts where available.
- `lastAnalysisAt`: optional timestamp.
- `activeJob`: optional `ReanalysisJob`.
- `degraded`: boolean.
- `message`: user-facing safe summary.

Validation rules:

- Status must distinguish unavailable, unauthorized, stale, indexing, and no-repo states.
- Error messages use existing CodeGraph error envelope semantics and must not expose bearer tokens or provider secrets.

## Symbol

Represents a searchable/openable graph node.

Fields:

- `id`: opaque node id; required.
- `name`: symbol display name.
- `qualifiedName`: optional qualified symbol name.
- `kind`: function, method, class, file, route, or backend-provided kind.
- `filePath`: project-relative file path when available.
- `lineStart`, `lineEnd`: optional source span.
- `provenance`: `static | lsp | heuristic | null` where route data provides it.
- `snippet`: optional bounded source context.

Validation rules:

- Browser percent-encodes node ids in path segments.
- Missing relationships must be shown as empty, unavailable, stale, or truncated, not collapsed into one generic blank state.

## SymbolRelationship

Represents callers, callees, flows, trace-style context, graph neighbors, or related symbols.

Fields:

- `sourceId`: source symbol id.
- `targetId`: target symbol id.
- `relationship`: callers, callees, flow, graph, impact, cluster, or route-specific relation.
- `provenance`: static, lsp, heuristic, or null.
- `truncated`: boolean.
- `limit`: optional applied limit.

Validation rules:

- Relationship views preserve selected repository and selected symbol orientation.
- Truncation or unavailable backend data remains visible.

## GraphView

Represents the visual graph explorer state.

Fields:

- `repoId`: selected repository id.
- `rootNodeId`: optional anchor node id.
- `nodes`: bounded list of graph nodes.
- `edges`: bounded list of graph edges.
- `selectedNodeId`: optional selected graph node.
- `filters`: relationship and kind filters.
- `depth`: requested graph depth.
- `expandedNodeIds`: node ids expanded in the current session.
- `layout`: selected layout mode.
- `truncated`: boolean from backend/browser cap.
- `omittedReason`: optional explanation for omitted data.
- `renderState`: `loading | ready | empty | truncated | render_error`.

Validation rules:

- Required graph actions have visible keyboard-operable controls: zoom, fit/reset, filter, select/focus, expand.
- A non-canvas mirror of selected node details and neighbor/edge summaries is always available.
- Graph dimensions are stable and responsive to avoid layout shift and text/control overlap.

## ImpactSummary

Represents affected symbols and files for a selected symbol.

Fields:

- `repoId`: selected repository id.
- `nodeId`: selected symbol id.
- `affectedSymbols`: bounded list of impacted symbols.
- `affectedFiles`: bounded list of files.
- `depth`: traversal depth.
- `truncated`: boolean.
- `limits`: applied traversal or node limits.
- `state`: `ready | unavailable | truncated | stale | error`.

Validation rules:

- Impact limits are disclosed.
- Stale or incomplete inputs cannot appear as complete results.

## ReanalysisJob

Represents backend re-index work initiated from the browser.

Fields:

- `id`: job id.
- `repo`: repo id.
- `mode`: sync or full.
- `status`: `running | done | error`.
- `startedAt`: timestamp.
- `finishedAt`: optional timestamp.
- `progress`: optional progress counters.
- `result`: optional terminal result.
- `error`: optional safe error summary.

Validation rules:

- One active job per repo; duplicate active start maps to existing `409` behavior.
- EventSource stream is live-only: snapshot, progress, terminal `done` or `error`, heartbeat comments, terminal status collapsed into the snapshot for already-finished jobs, slow-consumer progress coalescing, disconnects that never cancel the job, and no Last-Event-ID replay guarantee.
- UI prevents duplicate ambiguous starts while a job is active.

## ChatStatus

Represents backend-owned SPEC-018 readiness as visible to the browser.

Fields:

- `state`: `endpoint_active | agent_pending | dormant | misconfigured | endpoint_fallback | rate_limited | unavailable | error`.
- `active`: boolean.
- `mode`: `endpoint | agent | fallback | none`.
- `pendingBundles`: optional count.
- `activationVars`: optional safe variable names such as `CODEGRAPH_LLM_URL` and `CODEGRAPH_LLM_MODEL`.
- `message`: safe user-facing state text.

Validation rules:

- Provider URL, model, API key, bearer token for a provider, raw provider response bodies, and secret surrogates never appear in browser payloads, persisted web state, logs, or rendered UI.
- Dormant and misconfigured states are explicit and do not trigger browser provider calls.

## ChatRequest

Represents one graph-grounded browser chat request.

Fields:

- `repoId`: selected repository id.
- `prompt`: user prompt.
- `selectedNodeId`: optional selected symbol.
- `view`: optional current view hint: search, symbol, graph, impact, flow, or cluster.
- `contextHints`: optional bounded ids or filters selected in the UI.

Validation rules:

- Browser sends no raw source bundles, provider prompts, provider config, or provider credentials.
- Backend owns graph-context assembly and truncation.

## ChatResponse

Represents one backend chat result.

Fields:

- `state`: `answer | fallback | pending_bundle | disabled | dormant | misconfigured | rate_limited | error`.
- `text`: response or fallback text safe to render.
- `handle`: optional agent-bundle handle for pending-bundle mode.
- `context`: `ChatContextBoundary`.
- `error`: optional safe error summary.

Validation rules:

- `state` must let the UI distinguish endpoint answer, fallback, pending bundle, disabled, dormant, misconfigured, rate-limited, and error paths.
- Adapter mapping preserves SPEC-018 generation result semantics: endpoint source becomes an answer, pending-bundle source returns fallback text plus an opaque handle, and fallback source returns safe fallback text without implying provider success.
- Context boundaries and truncation are visible with the answer or fallback.

## ChatContextBoundary

Represents backend-assembled graph context visibility.

Fields:

- `repoId`: selected repository id.
- `selectedNodeId`: optional anchor.
- `includedSymbols`: bounded symbol ids/names.
- `includedFiles`: bounded file paths.
- `limits`: applied token, node, edge, file, or depth limits.
- `truncated`: boolean.
- `reason`: optional truncation or fallback explanation.

Validation rules:

- The boundary describes what context was included without exposing provider internals or raw secret-bearing configuration.

## CleanRoomBehaviorInventory

Represents parity evidence derived from allowed GitNexus public README/license sources.

Fields:

- `publicBehavior`: behavior class observed from allowed sources.
- `specTarget`: SPEC-006 behavior target.
- `status`: `implemented | deferred | backend_blocked | out_of_scope`.
- `owner`: CodeGraph backend surface or follow-up spec.
- `evidenceUrl`: README or license URL.
- `notes`: clean-room guardrail notes.

Validation rules:

- Evidence URL must be an allowed README/license source.
- Notes must confirm no source, assets, screenshots, UI text, visual design, CSS, or implementation structure were used.
