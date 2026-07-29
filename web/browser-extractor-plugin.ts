import path from "node:path"
import type { Plugin } from "vite"

const PUBLIC_ID = "virtual:codegraph-browser-extractor"
const RESOLVED_ID = `\0${PUBLIC_ID}`

/**
 * Expose the canonical extractor to the browser bundle without making the web
 * TypeScript project re-typecheck the Node project under different compiler
 * settings. Vite still bundles the real source through the browser aliases.
 */
export function canonicalBrowserExtractorPlugin(): Plugin {
  const browserSource = (fileName: string) =>
    path.resolve(__dirname, `./src/local-indexing/${fileName}`)
  return {
    name: "codegraph-canonical-browser-extractor",
    resolveId(source, importer) {
      if (source === PUBLIC_ID) return RESOLVED_ID
      const canonicalExtraction =
        importer?.includes("/src/extraction/") === true
      if (canonicalExtraction && source === "./grammars") {
        return browserSource("browser-grammars.ts")
      }
      if (canonicalExtraction && source === "./kernel") {
        return browserSource("browser-kernel-shim.ts")
      }
      if (
        importer?.endsWith("/src/extraction/tree-sitter.ts") &&
        source === "../resolution/frameworks"
      ) {
        return browserSource("browser-frameworks-shim.ts")
      }
      if (canonicalExtraction && source === "path") {
        return browserSource("browser-path.ts")
      }
      if (canonicalExtraction && source === "crypto") {
        return browserSource("browser-crypto.ts")
      }
      if (
        canonicalExtraction &&
        (source === "../utils" || source === "../../utils")
      ) {
        return browserSource("browser-utils.ts")
      }
      return undefined
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined
      const extractor = path.resolve(
        __dirname,
        "../src/extraction/tree-sitter.ts"
      )
      return `export { extractFromSource } from ${JSON.stringify(extractor)}`
    },
  }
}
