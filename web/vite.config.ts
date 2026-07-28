import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import {
  WEB_BUILD_ENTRIES,
  validateWebAssetDirectory,
} from "../scripts/web-asset-manifest.mjs"

const buildEntries = Object.fromEntries(
  Object.entries(WEB_BUILD_ENTRIES).map(([name, relativePath]) => [
    name,
    path.resolve(__dirname, relativePath),
  ])
)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
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
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rolldownOptions: {
      input: buildEntries,
    },
  },
})
