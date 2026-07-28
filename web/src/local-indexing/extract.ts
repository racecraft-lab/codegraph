import {
  Language as WasmLanguage,
  Parser,
  type Node as SyntaxNode,
} from "web-tree-sitter"
import treeSitterRuntimeUrl from "web-tree-sitter/tree-sitter.wasm?url"
import javascriptGrammarUrl from "../../../src/extraction/wasm/tree-sitter-javascript.wasm?url"
import tsxGrammarUrl from "../../../src/extraction/wasm/tree-sitter-tsx.wasm?url"
import typescriptGrammarUrl from "../../../src/extraction/wasm/tree-sitter-typescript.wasm?url"
import {
  extractBrowserSources,
  type BrowserExtractionResult,
  type BrowserSourceEntry,
} from "../../../src/extraction/browser-kernel"
import type {
  Edge,
  ExtractionResult,
  Language,
  Node,
  NodeKind,
} from "../../../src/types"

const GRAMMAR_URLS: Partial<Record<Language, string>> = {
  javascript: javascriptGrammarUrl,
  jsx: javascriptGrammarUrl,
  typescript: typescriptGrammarUrl,
  tsx: tsxGrammarUrl,
}

const EXTENSIONS: Record<string, Language> = {
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".mts": "typescript",
  ".cts": "typescript",
  ".vue": "vue",
}

let runtimeInitialization: Promise<void> | undefined
const parsers = new Map<Language, Parser>()

function initializeRuntime() {
  runtimeInitialization ??= Parser.init({
    locateFile: () => treeSitterRuntimeUrl,
  })
  return runtimeInitialization
}

async function loadGrammars(languages: Language[]) {
  await initializeRuntime()
  for (const language of languages) {
    if (parsers.has(language)) continue
    const url = GRAMMAR_URLS[language]
    if (!url) {
      throw new Error(`The ${language} browser grammar asset is unavailable.`)
    }
    const grammar = await WasmLanguage.load(url)
    parsers.set(language, new Parser().setLanguage(grammar))
  }
}

function extension(path: string) {
  const last = path.split("/").at(-1) ?? ""
  const dot = last.lastIndexOf(".")
  return dot < 0 ? "" : last.slice(dot).toLowerCase()
}

function detectLanguage(
  path: string,
  _source: string,
  overrides: Record<string, Language>,
) {
  const suffix = extension(path)
  return overrides[suffix] ?? EXTENSIONS[suffix] ?? "unknown"
}

function stableId(path: string, kind: NodeKind, name: string, line: number) {
  const input = `${path}:${kind}:${name}:${line}`
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${kind}:browser-${(hash >>> 0).toString(16).padStart(8, "0")}`
}

function sourceNode(
  path: string,
  language: Language,
  kind: NodeKind,
  name: string,
  node: SyntaxNode,
  exported = false,
): Node {
  const startLine = node.startPosition.row + 1
  return {
    id: stableId(path, kind, name, startLine),
    kind,
    name,
    qualifiedName: kind === "file" ? path : name,
    filePath: path,
    language,
    startLine,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column,
    endColumn: node.endPosition.column,
    isExported: exported,
    updatedAt: 0,
  }
}

function fileNode(path: string, language: Language, endLine: number): Node {
  return {
    id: stableId(path, "file", path, 1),
    kind: "file",
    name: path.split("/").at(-1) ?? path,
    qualifiedName: path,
    filePath: path,
    language,
    startLine: 1,
    endLine,
    startColumn: 0,
    endColumn: 0,
    updatedAt: 0,
  }
}

function declarations(
  root: SyntaxNode,
  path: string,
  language: Language,
): Node[] {
  const output: Node[] = []
  const namedChildren = (node: SyntaxNode) =>
    node.namedChildren.filter(
      (child): child is SyntaxNode => child !== null,
    )

  const visit = (node: SyntaxNode, exported = false) => {
    if (node.type === "export_statement") {
      for (const child of namedChildren(node)) visit(child, true)
      return
    }
    if (node.type === "function_declaration") {
      const nameNode = node.childForFieldName("name")
      if (nameNode) {
        output.push(
          sourceNode(path, language, "function", nameNode.text, node, exported),
        )
      }
      return
    }
    if (
      node.type === "lexical_declaration" ||
      node.type === "variable_declaration"
    ) {
      const constant = node.text.trimStart().startsWith("const ")
      for (const child of namedChildren(node)) {
        if (child.type !== "variable_declarator") continue
        const nameNode = child.childForFieldName("name")
        const valueNode = child.childForFieldName("value")
        if (!nameNode) continue
        const functionValue =
          valueNode?.type === "arrow_function" ||
          valueNode?.type === "function_expression"
        output.push(
          sourceNode(
            path,
            language,
            functionValue ? "function" : constant ? "constant" : "variable",
            nameNode.text,
            child,
            exported,
          ),
        )
      }
      return
    }
    for (const child of namedChildren(node)) visit(child, exported)
  }

  for (const child of namedChildren(root)) visit(child)
  return output
}

export function extractVueScriptSource(source: string) {
  const match = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/i.exec(source)
  return match?.[1] ?? ""
}

function extract(path: string, source: string, language: Language): ExtractionResult {
  const parseLanguage =
    language === "vue"
      ? /<script\b[^>]*\blang\s*=\s*["']ts["']/i.test(source)
        ? "typescript"
        : "javascript"
      : language
  const parser = parsers.get(parseLanguage)
  if (!parser) {
    throw new Error(`The ${parseLanguage} browser parser is not loaded.`)
  }
  const parsedSource =
    language === "vue" ? extractVueScriptSource(source) : source
  const tree = parser.parse(parsedSource)
  if (!tree) throw new Error(`The ${parseLanguage} browser parser returned no tree.`)
  try {
    const file = fileNode(
      path,
      language,
      Math.max(1, source.split("\n").length),
    )
    const symbols = declarations(tree.rootNode, path, language)
    const nodes = [file, ...symbols]
    const edges: Edge[] = symbols.map((symbol) => ({
      source: file.id,
      target: symbol.id,
      kind: "contains",
      provenance: "tree-sitter",
    }))
    if (language === "vue") {
      const component: Node = {
        ...file,
        id: stableId(path, "component", path, 1),
        kind: "component",
        name: (path.split("/").at(-1) ?? path).replace(/\.vue$/i, ""),
        qualifiedName: `${path}::${(path.split("/").at(-1) ?? path).replace(/\.vue$/i, "")}`,
      }
      nodes.unshift(component)
      edges.unshift({
        source: component.id,
        target: file.id,
        kind: "contains",
        provenance: "tree-sitter",
      })
      edges.push(
        ...symbols.map((symbol) => ({
          source: component.id,
          target: symbol.id,
          kind: "contains" as const,
          provenance: "tree-sitter" as const,
        })),
      )
    }
    return {
      nodes,
      edges,
      unresolvedReferences: [],
      errors: [],
      durationMs: 0,
    }
  } finally {
    tree.delete()
  }
}

function contentFingerprint(content: string) {
  let hash = 0
  for (let index = 0; index < content.length; index += 1) {
    hash = Math.imul(hash ^ content.charCodeAt(index), 0x45d9f3b)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export async function extractLocalSources(
  entries: readonly BrowserSourceEntry[],
): Promise<BrowserExtractionResult> {
  return extractBrowserSources(entries, {
    ignorePatterns: [],
    extensionOverrides: {},
    maxFileBytes: 1024 * 1024,
    hashContent: contentFingerprint,
    detectLanguage,
    isLanguageSupported: (language) =>
      language === "vue" || language in GRAMMAR_URLS,
    loadGrammars,
    extract,
  })
}
