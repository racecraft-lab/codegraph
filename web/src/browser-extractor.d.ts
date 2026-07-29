declare module "virtual:codegraph-browser-extractor" {
  import type { ExtractionResult, Language } from "../../src/types"

  export function extractFromSource(
    filePath: string,
    source: string,
    language?: Language,
    frameworkNames?: string[]
  ): ExtractionResult
}
