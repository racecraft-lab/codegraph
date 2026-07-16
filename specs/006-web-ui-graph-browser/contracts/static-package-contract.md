# Contract: Static Package And Route Fallback

## Scope

SPEC-006 ships the Vite web build as local package assets and serves them through `codegraph serve --web`. The server static mount remains local-first, path-contained, and distinct from `/api/*`.

## Build And Copy Contract

Required outputs:

- `web/dist/index.html`
- `web/dist/assets/*`
- `dist/web/index.html`
- `dist/web/assets/*`

Required build integration:

- The web build runs before root package asset copying.
- Root `copy-assets` or an equivalent build helper copies `web/dist/` into `dist/web/`.
- `package.json` `files` continues to include `dist`, so `dist/web` ships in the npm package.
- `src/server/openapi.yaml`, SQL, WASM, and existing shipped assets remain copied as before.

## Runtime Route Contract

| Request | Expected Behavior |
|---|---|
| `/api/*` known route | Dispatch through API route table. |
| `/api/*` unknown route | Return API 404/error envelope; never serve SPA shell. |
| `/` | Serve `dist/web/index.html` when present; otherwise existing placeholder. |
| Extensionless browser route | Serve SPA shell when web build is present. |
| Missing asset-extension path | Return 404; never serve SPA shell. |
| Path traversal attempt | Remain confined by existing static path containment and return safe failure. |

## Network Contract

- Runtime assets are served from same-origin local `codegraph serve --web`.
- The built app performs no external CDN, hosted asset, hosted auth, hosted database, remote telemetry, or direct provider requests.
- The packaged browser UI is loopback-only. Non-loopback `serve --web` startup
  is refused until a browser-compatible API and EventSource session mechanism is
  available.

## Offline/Package Validation

Required validation scenarios:

- `npm run build` creates `dist/web`.
- A package-style run of `codegraph serve --web` serves the SPA shell.
- Browser route fallback works for extensionless routes.
- `/api/*` remains distinct from SPA fallback.
- Missing JS/CSS asset URLs 404 instead of returning `index.html`.
- Playwright or equivalent network interception confirms no external runtime requests except the local backend.

## Acceptance Checks

- Server static tests cover present and absent `dist/web` behavior.
- Package tests inspect packed or built output for `dist/web/index.html` and asset files.
- UAT documents local/package serving and the loopback-only browser policy.
