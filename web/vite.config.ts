import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import {
  WEB_BUILD_ENTRIES,
  validateWebAssetDirectory,
} from "../scripts/web-asset-manifest.mjs"
import { canonicalBrowserExtractorPlugin } from "./browser-extractor-plugin"

const buildEntries = Object.fromEntries(
  Object.entries(WEB_BUILD_ENTRIES).map(([name, relativePath]) => [
    name,
    path.resolve(__dirname, relativePath),
  ])
)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    canonicalBrowserExtractorPlugin(),
    react(),
    tailwindcss(),
    {
      name: "codegraph-required-web-assets",
      closeBundle() {
        validateWebAssetDirectory(path.resolve(__dirname, "dist"))
      },
    },
  ],
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  worker: {
    plugins: () => [canonicalBrowserExtractorPlugin()],
  },
  resolve: {
    alias: [
      {
        find: "@",
        replacement: path.resolve(__dirname, "./src"),
      },
      {
        find: /^path$/,
        replacement: path.resolve(
          __dirname,
          "./src/local-indexing/browser-path.ts"
        ),
      },
      {
        find: /^crypto$/,
        replacement: path.resolve(
          __dirname,
          "./src/local-indexing/browser-crypto.ts"
        ),
      },
      {
        find: /^(\.\.\/){1,2}utils$/,
        replacement: path.resolve(
          __dirname,
          "./src/local-indexing/browser-utils.ts"
        ),
      },
      {
        find: /^\.\/grammars$/,
        replacement: path.resolve(
          __dirname,
          "./src/local-indexing/browser-grammars.ts"
        ),
      },
      {
        find: /^\.\/kernel$/,
        replacement: path.resolve(
          __dirname,
          "./src/local-indexing/browser-kernel-shim.ts"
        ),
      },
      {
        find: /^\.\.\/resolution\/frameworks$/,
        replacement: path.resolve(
          __dirname,
          "./src/local-indexing/browser-frameworks-shim.ts"
        ),
      },
    ],
  },
  build: {
    rolldownOptions: {
      input: buildEntries,
    },
  },
})
