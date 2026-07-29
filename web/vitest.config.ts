import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"
import { canonicalBrowserExtractorPlugin } from "./browser-extractor-plugin"

export default defineConfig({
  plugins: [canonicalBrowserExtractorPlugin(), react(), tailwindcss()],
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
  test: {
    environment: "jsdom",
    include: ["src/tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/tests/setup.ts"],
    globals: true,
  },
})
