# Contract: Local Repository Client

## Purpose

`LocalRepositoryClient` lets existing web routes read from either the daemon REST API or the browser-local worker without duplicating UI behavior. It preserves current response shapes for repositories, status, search, source, graph, relationships, impact, flows, and clusters where supported by local indexes.

## Runtime Modes

| Mode | Backing Runtime | Network |
|------|-----------------|---------|
| `remote` | Existing REST API client | Same-origin daemon requests. |
| `local` | Browser worker and OPFS SQLite database | None by default. |
| `semantic-local` | Browser worker plus explicit direct endpoint | Only after user opt-in. |

## Interface

```ts
export interface RepositoryClient {
  listRepositories(): Promise<Repository[]>;
  getRepositoryStatus(repositoryId: string): Promise<RepositoryStatus>;
  search(repositoryId: string, request: SearchRequest): Promise<SearchResult>;
  getNode(repositoryId: string, nodeId: string): Promise<CodeNode>;
  getSource(repositoryId: string, nodeId: string): Promise<SourceResult>;
  getCallers(repositoryId: string, nodeId: string, request?: RelationshipRequest): Promise<ListResult<CodeEdge>>;
  getCallees(repositoryId: string, nodeId: string, request?: RelationshipRequest): Promise<ListResult<CodeEdge>>;
  getGraph(repositoryId: string, nodeId: string, request?: GraphRequest): Promise<GraphResult>;
  getImpact(repositoryId: string, nodeId: string, request?: ImpactRequest): Promise<ImpactResult>;
}

export interface LocalRepositoryClient extends RepositoryClient {
  getCapabilities(): Promise<CapabilityReport>;
  openPickedFolder(request: OpenFolderRequest): Promise<LocalRepository>;
  importSnapshot(request: SnapshotImportRequest): Promise<LocalRepository>;
  reconnect(repositoryId: string): Promise<LocalRepository>;
  refresh(repositoryId: string): Promise<WorkerOperation>;
  cancel(operationId: string): Promise<void>;
  deleteRepository(repositoryId: string): Promise<void>;
  configureEmbeddings(repositoryId: string, request: EmbeddingConfigRequest): Promise<EmbeddingProfile>;
  clearEmbeddings(repositoryId: string): Promise<void>;
}
```

## Request Rules

- `openPickedFolder` is invoked only from a user gesture and owns any permission request.
- `reconnect` may call `queryPermission`; if permission is `prompt`, UI must require another user gesture before `requestPermission`.
- `refresh` creates a new generation and leaves the previous generation readable until publish.
- `cancel` is best-effort and idempotent.
- `deleteRepository` removes source cache, graph DB, vectors, registry row, and stored handles.
- `configureEmbeddings` stores only a secret-free profile; in-memory credentials are supplied only to the active operation.

## Response Rules

- Local read methods return existing web API type shapes from `web/src/lib/api/types.ts`.
- Local-only errors are normalized to the existing `ErrorEnvelope` style with a stable code and redacted message.
- Unsupported local read types return `capability_unavailable` rather than falling through to the remote daemon silently.
- Empty indexes return valid empty results, not transport failures.
- A browser-local `SourcePane` uses `getSource` as its sole content transport
  and never instantiates or connects `BrowserLspClient`.
- Hover, definition, references, and other LSP-only source intelligence remain
  disabled for browser-local repositories with an honest explanation; server
  repositories retain their existing LSP transport.

## Repository Status Extensions

Local status may add these browser-only fields behind an optional extension object:

```ts
export interface LocalRepositoryStatusExtension {
  mode: "local";
  sourceKind: "picked-folder" | "dropped-snapshot" | "imported-snapshot";
  generation: number | null;
  permission: "granted" | "prompt" | "denied" | "not-applicable";
  capability: CapabilityReport;
  storage?: StorageEstimate;
  progress?: ProgressEvent;
  warnings: LocalIndexWarning[];
}
```

Rules:

- Existing remote status consumers must ignore the extension safely.
- Local status must not expose absolute host filesystem paths.
- Local warnings are stable enough for tests and support docs.

## Error Codes

| Code | Client Behavior |
|------|-----------------|
| `capability_unavailable` | Disable unsupported action and show capability detail. |
| `permission_denied` | Offer reconnect or reselect action. |
| `repository_busy` | Explain another tab/session is indexing and allow retry. |
| `quota_exceeded` | Show storage estimate when available and stop publish. |
| `asset_unavailable` | Report package/asset loading issue. |
| `schema_migration_failed` | Keep previous generation and surface failure. |
| `operation_cancelled` | Return to previous readable state. |
| `network_blocked` | Keep semantic feature disabled or degraded. |
| `credential_required` | Request session-only key before semantic call. |

## Compatibility Requirements

- Existing daemon REST client remains the default when a remote repository is selected.
- Local repositories are visually distinct in the switcher but use the same routes once selected.
- Local mode must not issue daemon requests for query data unless the user explicitly selects a remote repository.
- Semantic endpoint calls must never occur during keyword-only local browsing.
