import {
  Language as WasmLanguage,
  Parser,
  type Parser as WasmParser,
} from "web-tree-sitter"
import treeSitterRuntimeUrl from "web-tree-sitter/tree-sitter.wasm?url"
import arktsGrammarUrl from "../../../src/extraction/wasm/tree-sitter-arkts.wasm?url"
import cGrammarUrl from "../../../src/extraction/wasm/tree-sitter-c.wasm?url"
import csharpGrammarUrl from "../../../src/extraction/wasm/tree-sitter-c_sharp.wasm?url"
import cfmlGrammarUrl from "../../../src/extraction/wasm/tree-sitter-cfml.wasm?url"
import cfqueryGrammarUrl from "../../../src/extraction/wasm/tree-sitter-cfquery.wasm?url"
import cfscriptGrammarUrl from "../../../src/extraction/wasm/tree-sitter-cfscript.wasm?url"
import cobolGrammarUrl from "../../../src/extraction/wasm/tree-sitter-cobol.wasm?url"
import cppGrammarUrl from "../../../src/extraction/wasm/tree-sitter-cpp.wasm?url"
import dartGrammarUrl from "../../../src/extraction/wasm/tree-sitter-dart.wasm?url"
import erlangGrammarUrl from "../../../src/extraction/wasm/tree-sitter-erlang.wasm?url"
import goGrammarUrl from "../../../src/extraction/wasm/tree-sitter-go.wasm?url"
import javaGrammarUrl from "../../../src/extraction/wasm/tree-sitter-java.wasm?url"
import javascriptGrammarUrl from "../../../src/extraction/wasm/tree-sitter-javascript.wasm?url"
import kotlinGrammarUrl from "../../../src/extraction/wasm/tree-sitter-kotlin.wasm?url"
import luaGrammarUrl from "../../../src/extraction/wasm/tree-sitter-lua.wasm?url"
import luauGrammarUrl from "../../../src/extraction/wasm/tree-sitter-luau.wasm?url"
import nixGrammarUrl from "../../../src/extraction/wasm/tree-sitter-nix.wasm?url"
import ocamlGrammarUrl from "../../../src/extraction/wasm/tree-sitter-ocaml.wasm?url"
import ocamlInterfaceGrammarUrl from "../../../src/extraction/wasm/tree-sitter-ocaml_interface.wasm?url"
import pascalGrammarUrl from "../../../src/extraction/wasm/tree-sitter-pascal.wasm?url"
import phpGrammarUrl from "../../../src/extraction/wasm/tree-sitter-php.wasm?url"
import pythonGrammarUrl from "../../../src/extraction/wasm/tree-sitter-python.wasm?url"
import rGrammarUrl from "../../../src/extraction/wasm/tree-sitter-r.wasm?url"
import rubyGrammarUrl from "../../../src/extraction/wasm/tree-sitter-ruby.wasm?url"
import rustGrammarUrl from "../../../src/extraction/wasm/tree-sitter-rust.wasm?url"
import scalaGrammarUrl from "../../../src/extraction/wasm/tree-sitter-scala.wasm?url"
import swiftGrammarUrl from "../../../src/extraction/wasm/tree-sitter-swift.wasm?url"
import terraformGrammarUrl from "../../../src/extraction/wasm/tree-sitter-terraform.wasm?url"
import tsxGrammarUrl from "../../../src/extraction/wasm/tree-sitter-tsx.wasm?url"
import typescriptGrammarUrl from "../../../src/extraction/wasm/tree-sitter-typescript.wasm?url"
import vbnetGrammarUrl from "../../../src/extraction/wasm/tree-sitter-vbnet.wasm?url"
import objcGrammarUrl from "../../../node_modules/tree-sitter-wasms/out/tree-sitter-objc.wasm?url"
import solidityGrammarUrl from "../../../node_modules/tree-sitter-wasms/out/tree-sitter-solidity.wasm?url"
import { EXTENSION_MAP } from "../../../src/extraction/extension-map"
import type { Language } from "../../../src/types"

type GrammarLanguage = Exclude<
  Language,
  | "svelte"
  | "vue"
  | "astro"
  | "liquid"
  | "razor"
  | "yaml"
  | "twig"
  | "xml"
  | "properties"
  | "unknown"
>
type GrammarKey = GrammarLanguage | "ocaml_interface"

const GRAMMAR_URLS: Record<GrammarKey, string> = {
  typescript: typescriptGrammarUrl,
  tsx: tsxGrammarUrl,
  javascript: javascriptGrammarUrl,
  jsx: javascriptGrammarUrl,
  arkts: arktsGrammarUrl,
  python: pythonGrammarUrl,
  go: goGrammarUrl,
  rust: rustGrammarUrl,
  java: javaGrammarUrl,
  c: cGrammarUrl,
  cpp: cppGrammarUrl,
  csharp: csharpGrammarUrl,
  php: phpGrammarUrl,
  ruby: rubyGrammarUrl,
  swift: swiftGrammarUrl,
  kotlin: kotlinGrammarUrl,
  dart: dartGrammarUrl,
  pascal: pascalGrammarUrl,
  scala: scalaGrammarUrl,
  lua: luaGrammarUrl,
  luau: luauGrammarUrl,
  objc: objcGrammarUrl,
  r: rGrammarUrl,
  solidity: solidityGrammarUrl,
  nix: nixGrammarUrl,
  cfml: cfmlGrammarUrl,
  cfscript: cfscriptGrammarUrl,
  cfquery: cfqueryGrammarUrl,
  cobol: cobolGrammarUrl,
  vbnet: vbnetGrammarUrl,
  erlang: erlangGrammarUrl,
  ocaml: ocamlGrammarUrl,
  ocaml_interface: ocamlInterfaceGrammarUrl,
  terraform: terraformGrammarUrl,
}

const parsers = new Map<GrammarKey, WasmParser>()
let runtimeInitialization: Promise<void> | undefined

function initializeRuntime() {
  runtimeInitialization ??= Parser.init({
    locateFile: () => treeSitterRuntimeUrl,
  })
  return runtimeInitialization
}

export async function loadBrowserGrammars(languages: Language[]) {
  await initializeRuntime()
  const keys = languages.flatMap((language): GrammarKey[] =>
    language === "ocaml"
      ? ["ocaml", "ocaml_interface"]
      : language in GRAMMAR_URLS
        ? [language as GrammarLanguage]
        : []
  )
  for (const key of new Set(keys)) {
    if (parsers.has(key)) continue
    const grammar = await WasmLanguage.load(GRAMMAR_URLS[key])
    parsers.set(key, new Parser().setLanguage(grammar))
  }
}

function extension(path: string) {
  const fileName = path.replaceAll("\\", "/").split("/").at(-1) ?? ""
  const dot = fileName.lastIndexOf(".")
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase()
}

function isShopifyLiquidJson(path: string) {
  const parts = path.replaceAll("\\", "/").toLowerCase().split("/")
  if (!parts.at(-1)?.endsWith(".json")) return false
  return parts.some(
    (part, index) =>
      (part === "templates" || part === "sections") && index < parts.length - 1
  )
}

function isErlangAppFile(path: string) {
  return /\.app(?:\.src)?$/i.test(path)
}

function isPlayRoutesFile(path: string) {
  return (
    path === "conf/routes" ||
    path.endsWith("/conf/routes") ||
    path.endsWith(".routes")
  )
}

export function detectLanguage(
  path: string,
  source = "",
  overrides: Record<string, Language> = {}
): Language {
  if (isPlayRoutesFile(path)) return "yaml"
  if (isShopifyLiquidJson(path)) return "liquid"
  if (isErlangAppFile(path)) return "erlang"
  const suffix = extension(path)
  const language = overrides[suffix] ?? EXTENSION_MAP[suffix] ?? "unknown"
  if (language === "c" && suffix === ".h") {
    const sample = source.slice(0, 8192)
    if (
      /\bnamespace\b|\bclass\s+\w+\s*[:{]|\b(?:class|struct)\s+[A-Z][A-Z0-9_]+\s+\w+\s*(?:final\s*)?[:{]|\btemplate\s*<|\b(?:public|private|protected)\s*:|\bvirtual\b|\busing\s+(?:namespace\b|\w+\s*=)/.test(
        sample
      )
    ) {
      return "cpp"
    }
    if (/@(?:interface|implementation|protocol|synthesize)\b/.test(sample)) {
      return "objc"
    }
  }
  return language
}

export function isLanguageSupported(language: Language) {
  return (
    language !== "unknown" &&
    (language in GRAMMAR_URLS ||
      language === "svelte" ||
      language === "vue" ||
      language === "astro" ||
      language === "liquid" ||
      language === "razor" ||
      language === "yaml" ||
      language === "twig" ||
      language === "xml" ||
      language === "properties")
  )
}

export function isFileLevelOnlyLanguage(language: Language) {
  return language === "yaml" || language === "twig" || language === "properties"
}

export function getParser(
  language: Language,
  filePath?: string
): WasmParser | null {
  const key =
    language === "ocaml" && filePath?.toLowerCase().endsWith(".mli")
      ? "ocaml_interface"
      : language in GRAMMAR_URLS
        ? (language as GrammarLanguage)
        : undefined
  return key ? (parsers.get(key) ?? null) : null
}
