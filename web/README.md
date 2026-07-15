# CodeGraph Web UI

This workspace contains the packaged browser UI for `codegraph serve --web`.
It is a Vite + React + TypeScript app using Tailwind CSS and shadcn/ui
components.

## Development

Run commands from the repository root with the repo-pinned Node version:

```sh
npm --prefix web run dev
npm --prefix web run test
npm --prefix web run test:e2e
npm --prefix web run typecheck
```

The root build runs the web build and copies `web/dist` into `dist/web`:

```sh
npm run build
```

Runtime assets must remain local and package-shipped. Do not add CDN fonts,
hosted scripts, direct browser LLM provider calls, or browser-side provider
secrets.
