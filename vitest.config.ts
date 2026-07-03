import { defineConfig } from 'vitest/config';
import { WASM_RUNTIME_FLAGS } from './src/extraction/wasm-runtime-flags';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    /**
     * The parse-heavy suites compile tree-sitter grammar WASM inside the test
     * process; without `--liftoff-only` V8's turboshaft tier can exhaust its
     * Zone arena and abort the whole vitest fork — "Fatal process out of
     * memory: Zone", reported by vitest only as "Worker exited unexpectedly"
     * (no failing test). The CLI solves this by re-execing itself with the
     * flag (src/extraction/wasm-runtime-flags.ts); vitest forks never take
     * that path, so hand the same flags to the fork processes here. V8 flags
     * are process-wide — the parse-worker threads inherit them.
     */
    poolOptions: {
      forks: {
        execArgv: [...WASM_RUNTIME_FLAGS],
      },
    },
    /**
     * Several MCP integration tests (mcp-daemon, mcp-initialize, mcp-ppid-watchdog,
     * mcp-roots) spawn `dist/bin/codegraph.js serve --mcp` with `process.execPath`
     * and rely on the child inheriting `process.env`. On a Node >= 25 dev machine
     * the CLI's hard-block (src/bin/codegraph.ts) would otherwise exit the child
     * before it ever responds, so every spawn-based test times out — see #478.
     *
     * Setting the override here keeps the CLI's runtime guard intact for end
     * users (it's still enforced when `codegraph` is invoked directly) while
     * letting the test suite run on whatever Node the contributor happens to
     * have installed. CI on Node 22/23 is unaffected — the guard doesn't fire
     * there, so the variable is a no-op.
     */
    env: {
      CODEGRAPH_ALLOW_UNSAFE_NODE: '1',
      /**
       * The suite spawns real CLI/MCP processes; without this they would write
       * telemetry state into the contributor's real ~/.codegraph and count test
       * tool calls as real usage. The telemetry unit tests are unaffected —
       * they inject their own `env` via the Telemetry constructor.
       */
      CODEGRAPH_TELEMETRY: '0',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
