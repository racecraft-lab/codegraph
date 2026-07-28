# Contract: Browser Capabilities

## Purpose

Browser local indexing is capability-gated. UI state, worker behavior, tests, and support messages must derive from live feature checks rather than browser-name checks.

## Capability Matrix

| Capability | Required For | Detection | Full Behavior | Degraded Behavior |
|------------|--------------|-----------|---------------|-------------------|
| Secure context | All durable local indexing | `window.isSecureContext` | Enable capability checks. | Disable local indexing and explain secure context requirement. |
| Module worker | Worker runtime | `new Worker(new URL(...), { type: "module" })` boot check | Start local indexing worker. | Disable local indexing. |
| WebAssembly | SQLite and tree-sitter | Worker boot and asset instantiation | Load SQLite/tree-sitter WASM. | Return `asset_unavailable` or `capability_unavailable`. |
| Worker source policy | Worker runtime | Worker boot under current CSP | Use same-origin packaged worker. | Report CSP/asset failure. |
| WASM CSP policy | SQLite/tree-sitter | SQLite/tree-sitter boot under current CSP | Use same-origin WASM assets. | Report CSP/asset failure. |
| OPFS | Durable graph/source cache | `navigator.storage.getDirectory` in worker/window where available | Store SQLite SAH-pool and source cache. | Disable durable local index or use only supported transient tests. |
| Web Locks | Single writer | `navigator.locks.request` | Serialize repository writes. | Report `repository_busy`/unsupported writer lock. |
| Folder picker | Full folder-open flow | `window.showDirectoryPicker` | Select project directory after user gesture. | Offer snapshot/import if supported. |
| Stored directory handles | Reconnect flow | IndexedDB structured clone plus `queryPermission` | Reconnect without reselect when granted. | Require reselect/import. |
| Permission request | Reconnect prompt | `requestPermission` after user gesture | Ask user to regrant access. | Move repository to `needs-permission`. |
| Directory drop | Snapshot import | `DataTransferItem.getAsFileSystemHandle` or supported legacy directory entries | Import immutable snapshot. | Hide drop/import affordance. |
| Storage estimate | Quota reporting | `navigator.storage.estimate` | Show quota/usage and quota failures. | Continue without exact estimate. |
| Persistent storage request | Eviction resilience | `navigator.storage.persist` on window after user action | Request durable bucket where browser allows. | Report `not-supported` or `denied`; feature still works with eviction risk. |
| Direct fetch endpoint | Semantic opt-in | Explicit HTTPS URL plus Fetch/CSP outcome | Call endpoint only after opt-in. | Keep keyword-only mode and show redacted failure. |

## Browser Support Policy

| Browser Family | Required Result |
|----------------|-----------------|
| Chromium-class secure context | Full folder picker, OPFS, worker, WASM, Web Locks, reconnect, refresh, delete, and keyword indexing when capabilities pass. |
| Firefox secure context | Graceful degradation unless live capabilities support the relevant local flow. No promise of folder picker parity. |
| WebKit secure context | Graceful degradation unless live capabilities support the relevant local flow. No promise of folder picker parity. |
| Non-secure context | Local indexing disabled. Existing remote/daemon browsing may continue if otherwise available. |

## Permission Rules

- Permission prompts happen only after a user gesture.
- `queryPermission` may run to inspect state, but `requestPermission` requires explicit UI action.
- Stored handles can become `prompt` or `denied` after reload or browser policy changes.
- Denied permission is recoverable through reconnect/reselect and must not be treated as graph corruption.

## Storage Rules

- OPFS storage is origin-private and may be cleared with site data.
- The app must tolerate missing registry or OPFS files by showing empty/recoverable state.
- `persist()` is advisory; denial does not block indexing.
- Quota estimates are approximate and used for messaging, not correctness.

## CSP And Asset Rules

- Worker scripts must be same-origin packaged assets.
- WASM assets must be same-origin packaged assets.
- If a deployment sends CSP, it must allow the local worker and WebAssembly execution required by SQLite/tree-sitter.
- Semantic endpoint calls are governed by `connect-src`; failure must not leak secrets in error text.
- Secure pages must reject insecure direct embedding endpoints because mixed active content is blockable.

## Network Rules

- Keyword indexing and local graph browsing make no network requests.
- REST daemon requests occur only when a remote repository is selected.
- Semantic network calls occur only after explicit opt-in.
- Browser-hidden CORS, TLS, CSP, and mixed-content failures normalize to `network_blocked` with redacted diagnostic detail.

## Test Requirements

- Chromium full-flow Playwright test verifies folder picker/reconnect/index/search/source/graph/impact/delete.
- Firefox/WebKit Playwright tests verify degradation state and absence of broken controls.
- Unit tests cover capability detection fallback objects for missing APIs.
- Packaged asset test verifies worker and WASM URLs after `npm run build`.
- Network audit verifies no request before semantic opt-in.
