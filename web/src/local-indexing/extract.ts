import {
  extractBrowserSources,
  type BrowserExtractionResult,
  type BrowserSourceEntry,
} from "../../../src/extraction/browser-kernel"
import { findMarkupBlocks } from "../../../src/extraction/markup-utils"
import type { Language } from "../../../src/types"
import { extractFromSource } from "virtual:codegraph-browser-extractor"
import {
  detectLanguage,
  isLanguageSupported,
  loadBrowserGrammars,
} from "./browser-grammars"

export interface BrowserExtractionRules {
  ignorePatterns?: readonly string[]
  extensionOverrides?: Record<string, Language>
}

/**
 * Retained for callers that need to preview the first Vue script block. The
 * canonical Vue extractor uses the same shared markup scanner internally.
 */
export function extractVueScriptSource(source: string) {
  return findMarkupBlocks(source, ["script"])[0]?.content ?? ""
}

function contentFingerprint(content: string) {
  let hash = 0
  for (let index = 0; index < content.length; index += 1) {
    hash = Math.imul(hash ^ content.charCodeAt(index), 0x45d9f3b)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

/**
 * Browser admission plus canonical semantic extraction.
 *
 * The environment-specific pieces are limited to preloaded browser WASM
 * grammars and runtime-neutral shims. Symbol, edge, reference, and custom
 * language semantics come from the same extractor used by the Node indexer.
 */
export async function extractLocalSources(
  entries: readonly BrowserSourceEntry[],
  rules: BrowserExtractionRules = {}
): Promise<BrowserExtractionResult> {
  return extractBrowserSources(entries, {
    ignorePatterns: rules.ignorePatterns ?? [],
    extensionOverrides: rules.extensionOverrides ?? {},
    maxFileBytes: 1024 * 1024,
    hashContent: contentFingerprint,
    detectLanguage,
    isLanguageSupported,
    loadGrammars: loadBrowserGrammars,
    extract: (path, source, language) =>
      extractFromSource(path, source, language),
  })
}
