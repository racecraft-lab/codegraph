---
spec_id: SPEC-009
spec_name: LSP Server Facade
branch: 009-lsp-server-facade
created: 2026-07-16
status: scaffolded
interview_mode: setup
questions_asked: 21
stop_reason: natural
---

# SPEC-009 Design Concept

## Summary

SPEC-009 should expose CodeGraph's persisted, deterministic graph through a
small read-only Language Server Protocol facade. Generic local tooling connects
through `codegraph lsp` over standard stdio framing; the packaged web app uses a
same-origin `/lsp` WebSocket mounted on the existing SPEC-005 server.

The facade answers only from the indexed snapshot. It does not proxy an external
language server, parse unsaved buffers, mutate source, publish diagnostics, or
silently guess when the graph cannot map a position precisely. The browser gains
a focused source pane on the existing symbol-detail route, not a new multi-file
editor product.

## Grounding

Repository roadmap:

- `docs/ai/specs/intelligence-platform-technical-roadmap.md` defines SPEC-009 as
  P0, dependent on completed SPEC-005, and the LSP bridge for the web viewer.
- The roadmap requires `initialize`, `textDocument/definition`,
  `textDocument/references`, `textDocument/hover`,
  `textDocument/documentSymbol`, and `workspace/symbol`, plus stdio, `/lsp`, web
  viewer behaviors, and a generic scripted conformance smoke test.
- SPEC-005 shipped the local HTTP server, repository registry, daemon-client
  pool, same-origin posture, and a reserved WebSocket upgrade hook.
- SPEC-006 shipped the packaged React app and the existing symbol-detail route.
  That route currently shows signature/doc metadata but no full source viewer.
- SPEC-008 shipped the outbound LSP client and established Content-Length
  framing, a 5-second request timeout, and UTF-16 LSP position types.

Live scaffold checks:

- Worktree: `.worktrees/009-lsp-server-facade`
- Branch: `009-lsp-server-facade`, created from current `origin/main`
- Agent installation preflight: all required Codex agents current (`no_op`)
- Bootstrap: `npm install` and `npm run build` passed on 2026-07-16
- Dogfood index: 748 files, 10,941 nodes, 45,461 edges, and 6,596/6,596
  embeddings after a user-approved secure session-only bootstrap path
- Preset stack: spec and plan resolve to `speckit-pro-reviewability`; tasks
  resolve to `codegraph-project-overrides`

## Goals

- Expose a protocol-correct, read-only LSP session backed by the warm CodeGraph
  daemon and the repository selected when the session is created.
- Support the roadmap's six read methods with deterministic graph semantics,
  standard lifecycle behavior, bounded results, and honest empty results when a
  cursor cannot be resolved precisely.
- Add an advertised, read-only `codegraph/textDocumentContent` extension so the
  browser can obtain source text without a second REST source API.
- Add `codegraph lsp [path]` using standard LSP Content-Length framing over
  stdin/stdout.
- Mount `/lsp?repo=<id>` on the existing SPEC-005 server using the established
  `ws` package for RFC 6455 framing and lifecycle handling.
- Add a focused source pane to symbol detail with hover cards,
  go-to-definition navigation, a references panel, and explicit degraded states.
- Prove both transports with deterministic black-box conformance fixtures and a
  self-repository dogfood run.

## Non-Goals

- Rename, formatting, code actions, workspace edits, diagnostics, or any other
  mutating or push-oriented LSP capability.
- Unsaved-buffer overlays, `didOpen`/`didChange` synchronization, or automatic
  re-indexing from LSP notifications.
- External language-server proxying or reuse of SPEC-008's precision-pass
  processes at request time.
- Multi-repository workspace sessions, remote URI schemes, or access to files
  outside the bound indexed repository.
- A tabbed editor workspace, IDE extension packaging, IDE marketplace work, or
  IDE marketing.
- Cross-origin browser access, bearer tokens in WebSocket URLs, TLS, or a remote
  hosted service.
- Heuristic text/name fallbacks when exact graph evidence is absent.

## Design Decisions

| Question | Decision | Rationale |
|---|---|---|
| Delivery slices | Two vertical slices | The 450-LOC advisory estimate exceeds the 400-LOC ceiling and naturally separates protocol/tooling value from browser value. |
| Session repository | Bind one repository on connect | `codegraph lsp [path]` resolves one project; `/lsp?repo=<id>` resolves one registered repo. This prevents cross-repo ambiguity and leakage. |
| Initialize roots | Validate, do not select | An absent `rootUri` is allowed; a supplied root/workspace folder must match the bound repository. Multi-root is not advertised. |
| Source state | Persisted indexed snapshot only | Deterministic graph positions remain the single source of truth; no text synchronization capability is advertised. |
| Graph access | Typed daemon read operations | Both transports reuse the SPEC-005 warm daemon path instead of opening duplicate SQLite/CodeGraph instances. |
| Definition mapping | Exact declaration or located resolved edge | A declaration resolves to itself; a located semantic occurrence resolves to its persisted target. Ambiguous input returns `null`. |
| References | Located resolved semantic edges | Return graph-backed uses such as calls/imports/type/reference edges; exclude structural containment and heuristic same-name matches. Honor `includeDeclaration`. |
| Hover | Bounded persisted node metadata | Markdown contains signature, kind, qualified name, and docstring only, with a fixed payload cap. |
| Document symbols | Hierarchical graph symbols | Build `DocumentSymbol[]` from indexed nodes and `contains` relationships for the requested indexed file. |
| Workspace symbols | Existing deterministic search | Reuse graph symbol ranking with stable tie-breaks and a hard result cap. |
| Cursor ambiguity | No result | Precision is preferable to plausible but wrong navigation. |
| Position encoding | UTF-16 only | Matches LSP defaults and the repository's existing refactor position contract. |
| URI boundary | Indexed `file:` URIs inside the bound realpath | Reject traversal, symlink escape, non-file schemes, outside-root paths, and unindexed files. |
| Source delivery | `codegraph/textDocumentContent` extension | Keeps the browser on one authenticated/same-origin connection and avoids broadening REST. Advertise it under `capabilities.experimental`. |
| Stale source | Reject hash mismatch | Never combine current disk text with old graph ranges; return a typed stale result and prompt re-indexing. |
| Unsupported methods | Explicit allowlist, JSON-RPC `-32601` | Advertising read-only capabilities is backed by a dispatcher that cannot reach write code. |
| WebSocket implementation | Add `ws` runtime dependency | Avoids owning handshake, masking, fragmentation, control-frame, and close-state correctness. Browser code uses native `WebSocket`. |
| Browser origin | Same-origin only | Preserve SPEC-005 Host and loopback rules; require matching browser Origin while allowing a missing Origin for local scripted clients. |
| Failure UX | Degrade only the source pane | Keep symbol metadata and relationships usable; show a clear source/LSP error and manual retry without background reconnect loops. |
| Definition UX | Update the focused source location | Load the returned URI/range in the same pane and persist location in the page query string so browser history provides back/forward. |
| Conformance | Scripted black-box stdio and WebSocket tests | Proves packaged transport behavior without requiring an IDE or installed third-party language server. |

## Grill Me Q&A Log

The interview asked one decision at a time. The first option in each row was the
recommended option; every user answer below accepted that recommendation.

| Q | Decision branch | Alternatives offered | User answer |
|---|---|---|---|
| 1 | Implementation slicing | One all-in-one slice; three smaller slices | Two vertical slices: core/stdio first, WebSocket/viewer second |
| 2 | Repository selection | Bind during initialize; allow one multi-repo session | Bind one repository when the connection is created |
| 3 | Document freshness | Refresh on save; maintain unsaved overlays | Answer from the indexed snapshot only |
| 4 | Reference semantics | Add same-name matches; return only generic `references` edges | Return located resolved semantic graph edges and honor `includeDeclaration` |
| 5 | Web viewer scope | Full editor workspace; protocol plumbing without visible viewer behavior | Focused read-only source pane on symbol detail |
| 6 | Server-side WebSocket | Hand-write RFC 6455; defer WebSocket | Add the established `ws` package |
| 7 | Mutation requests | Custom read-only error; proxy supported writes | Allowlist reads and return Method Not Found for unsupported requests |
| 8 | Ambiguous cursor mapping | Nearest graph match; project-wide name search | Return no result unless the persisted mapping is unique |
| 9 | URI schemes and scope | Any repository file; multiple/virtual schemes | Accept indexed `file:` URIs contained by the bound repository only |
| 10 | Broad result limits | Cap every method at 500; return unbounded arrays | Stable caps: workspace symbols 100, document symbols/references 500 |
| 11 | Position encoding | Negotiate UTF-8/UTF-16; expose graph-native columns | UTF-16 only |
| 12 | Hover content | Signature only; include surrounding source excerpts | Bounded Markdown from persisted signature/kind/qualified-name/doc metadata |
| 13 | Browser source delivery | New REST endpoint; keep metadata-only preview | Advertised `codegraph/textDocumentContent` read extension |
| 14 | Resource guardrails | Looser 8 MiB/64/15s bounds; library defaults | 1 MiB messages/source, 16 in-flight WebSocket requests, 5-second timeout |
| 15 | Browser WebSocket origin | Any loopback origin; remote token in URL | Same-origin browser Origin, missing Origin allowed for local scripted clients |
| 16 | Conformance strategy | Library tests only; IDE-driven manual test | Deterministic black-box stdio and WebSocket clients plus self-repo dogfood |
| 17 | Viewer connection failure | Automatic reconnect; fail the whole route | Preserve the page and degrade only the source pane with manual retry |
| 18 | Definition navigation | Map to a symbol page; open tabs | Load the returned location in the same pane and query-string/browser history |
| 19 | Graph access | Open a DB per session; proxy a stdio child from WebSocket | Add typed daemon read operations and share them across both transports |
| 20 | Missing index/daemon | Initialize an empty degraded server; auto-index | Fail before accepting the session; never auto-initialize or auto-index |
| 21 | Disk/index mismatch | Serve live text with warning; serve silently | Reject the source request as stale and prompt re-indexing |

Natural stop was reached after Q21: all high-impact product, protocol, security,
consistency, viewer, failure, and verification branches were resolved. The shared
size estimator then returned 450 LOC, `warn`, and two suggested slices, matching
Q1; no second split decision was needed.

## Protocol Contract

### Lifecycle and capabilities

- Implement standard JSON-RPC 2.0 request/response envelopes and LSP lifecycle:
  `initialize`, `initialized`, `shutdown`, and `exit`.
- Before initialization, reject non-lifecycle requests with the standard
  server-not-initialized error. After shutdown, accept only `exit`/transport
  close and perform bounded cleanup.
- Advertise UTF-16 positions, no text synchronization, no diagnostics, and only
  these read capabilities:
  - definition provider
  - references provider
  - hover provider
  - document symbol provider
  - workspace symbol provider
  - experimental `codegraphTextDocumentContent`
- Treat notifications outside the lifecycle allowlist as ignored only where LSP
  permits; requests outside the allowlist return JSON-RPC Method Not Found.
- Do not expose or call SPEC-010 rename, formatting, edit, indexing, or external
  language-server paths.

### Graph-backed reads

- Normalize URI and position input before any graph lookup.
- Convert persisted 1-based lines and graph-native columns to 0-based UTF-16 LSP
  positions using one shared conversion path with non-ASCII coverage.
- Definition returns one precise `Location` or `null`.
- References return a stable, deduplicated `Location[]`; honor
  `ReferenceContext.includeDeclaration` and cap the array at 500.
- Hover returns `null` or bounded Markdown derived only from persisted node
  metadata.
- Document symbols return at most 500 hierarchical symbols in source order.
- Workspace symbol returns at most 100 ranked results with deterministic
  tie-breaking.
- If stored graph data lacks the location needed for a position-based answer,
  return `null`/`[]`; do not fall back to nearest-line or name search.

### Source-content extension

- Request: `codegraph/textDocumentContent` with a text-document `file:` URI.
- Response: bounded UTF-8 text plus language, persisted content hash, and a
  stable snapshot/version token suitable for client cache invalidation.
- The file must be indexed, remain under the bound repository after realpath
  normalization, be a regular file, remain at or below 1 MiB, and still match
  the indexed content hash.
- A missing, escaped, oversized, unreadable, or stale file returns a typed
  request error without revealing unrelated filesystem paths or contents.

## Transport and Security Contract

### Stdio

- `codegraph lsp [path]` resolves the nearest initialized CodeGraph project and
  attaches to its daemon before accepting a session.
- Use standard `Content-Length: N\r\n\r\n` framing on stdin/stdout; diagnostics
  go to stderr only.
- An unindexed project or unavailable daemon fails startup nonzero with a concise
  stderr reason. It never auto-initializes or auto-indexes.
- EOF, stream error, `exit`, SIGINT, and SIGTERM close the daemon client and
  pending requests without leaving an orphan process.

### WebSocket

- `/lsp?repo=<registered-id>` performs repository resolution before completing
  the upgrade. Unknown repos and unavailable daemons use the existing 404/503
  semantics rather than accepting an empty server.
- Reuse SPEC-005 Host validation and loopback-only packaged UI policy. A browser
  Origin must match the served origin; absent Origin is allowed for local
  non-browser clients.
- One complete JSON-RPC message occupies one UTF-8 text frame. Reject binary,
  malformed JSON, and oversized messages without crashing the HTTP server.
- Cap inbound messages and source responses at 1 MiB, allow at most 16 in-flight
  requests per socket, and time out a request after 5 seconds.
- Handle ping/pong, close, peer disconnect, server shutdown, daemon loss, and
  backpressure through `ws`; every path releases listeners, timers, and the
  repository client reference.
- Never log source contents, authorization values, full request bodies, or
  client-supplied absolute paths. Local diagnostics remain bounded and redacted.

## Web Viewer Contract

- Enhance the existing symbol-detail page with a focused, read-only source pane
  initialized from the selected symbol's indexed file and position.
- The pane requests source through the advertised extension and uses standard
  LSP requests for intelligence; it does not call graph REST routes to simulate
  LSP answers.
- Hovering an identifier displays the bounded hover card. Activating
  go-to-definition loads the returned file/range in the pane and updates query
  parameters/history. The references panel groups stable results by file and
  navigates the pane to the chosen range.
- Preserve keyboard access, visible focus, readable loading/error states, and the
  existing symbol/relationship content when LSP is unavailable.
- A stale source response shows a re-index-required state. Recovery is an
  explicit manual retry after the user uses the existing re-index workflow.
- No background socket is created outside the symbol source-pane lifecycle; the
  feature remains dormant until the user opens a source view.

## Reviewability Budget

Advisory size signal:

- User stories: 3
- Production files/surfaces: 6
- Functional-requirement groups: 9
- New vs modify: new
- `estimate-spec-size`: `estimated_loc=450`, `suggested_slices=2`,
  `status=warn`

Interpretation:

- The estimate is a forward scoping signal, not the authoritative plan-phase
  production-LOC count.
- The user accepted two thin vertical slices. Each slice must stay below the
  approximately 400 reviewable-LOC ceiling; planning must re-estimate from the
  declared file table and split further if either slice crosses the block line.

## Proposed Slices

### Slice 1: Read-only LSP core and stdio tooling

- Typed daemon read operations and the shared repository-bound LSP dispatcher.
- Lifecycle, definition, references, hover, document symbols, workspace symbols,
  content extension, URI/hash/position validation, caps, and write rejection.
- `codegraph lsp [path]` Content-Length transport.
- Deterministic fixture tests and packaged stdio black-box conformance.
- Independently valuable outcome: generic tooling can query the CodeGraph index
  through standard read-only LSP over stdio.

### Slice 2: Same-origin WebSocket and focused web viewer

- `ws` dependency, `/lsp?repo=` upgrade bridge, origin/Host/repository gates,
  lifecycle limits, cleanup, and WebSocket black-box conformance.
- Browser LSP client and focused symbol source pane with content, hover,
  definition navigation, references, degraded/retry, history, and accessibility.
- Package/offline checks and self-repository UAT across the shipped server/app.
- Independently valuable outcome: the packaged browser can navigate indexed
  source through the same protocol contract.

## Verification Strategy

- Unit-test URI containment, hash freshness, UTF-16 conversion, exact cursor
  mapping, capability output, method allowlisting, result caps, and errors.
- Integration-test daemon read operations against a real temporary SQLite index.
- Drive the built `codegraph lsp` process using a scripted generic client that
  sends Content-Length frames and verifies initialize/read/shutdown/exit.
- Start the real SPEC-005 fixture server and drive `/lsp` with a WebSocket client,
  including origin rejection, unknown repo, malformed/binary/oversized payloads,
  disconnect cleanup, in-flight cap, timeout, and server shutdown.
- Test the React source pane for loading, hover, definition/history, grouped
  references, stale/unavailable states, retry, keyboard access, and preserved
  symbol-page content.
- Run build, typecheck, focused tests, full test suites, package-asset checks, and
  self-repo UAT before each slice is declared complete.

## Open Risks

- Graph edge locations are not uniformly precise. The fail-closed cursor rule
  preserves correctness but may yield fewer results for synthesized edges; tests
  must make this limitation visible rather than adding heuristics.
- Tree-sitter columns and LSP UTF-16 offsets differ for non-ASCII text. One
  shared conversion implementation and Unicode fixtures are mandatory.
- Source text is a new exposure surface. Realpath containment, index membership,
  hash equality, size caps, origin checks, and redacted diagnostics are hard
  gates, not later polish.
- The focused viewer still needs a plan-phase component choice. Select the
  smallest accessible read-only surface that can map pointer/keyboard positions
  accurately; do not grow into Monaco-style workspace features unless a later
  spec explicitly authorizes them.
- WebSocket lifecycle bugs can leak daemon references or listeners. Cleanup and
  backpressure tests are required by `src/server/AGENTS.md`.
- The existing typed daemon vocabulary does not yet contain cursor lookup,
  document-symbol, indexed-hash, or source-content reads. The roadmap's six-file
  estimate is therefore optimistic; the Plan phase must declare the real file
  table and re-run reviewability sizing without weakening the accepted outcomes.

## Open Questions

No unresolved product decisions remain from Grill Me. Planning must resolve only
implementation details within the boundaries above, including exact typed daemon
operation names, error-code mapping, whether secure source read/hash happens in
the daemon or facade, and the smallest accessible source-viewer component.

## Evidence Sources

- Roadmap: `docs/ai/specs/intelligence-platform-technical-roadmap.md`
- Constitution: `.specify/memory/constitution.md`
- SPEC-005 server handoff: `docs/ai/specs/.process/SPEC-005-design-concept.md`
- SPEC-006 web handoff: `docs/ai/specs/.process/SPEC-006-design-concept.md`
- SPEC-008 LSP client handoff: `docs/ai/specs/.process/SPEC-008-design-concept.md`
- Current server: `src/server/`
- Current outbound LSP substrate: `src/lsp/`
- Current web symbol route: `web/src/routes/SymbolDetailRoute.tsx`
