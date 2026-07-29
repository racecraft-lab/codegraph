import type { Language } from "../../../src/types"

interface BrowserFrameworkResolver {
  name: string
  languages?: Language[]
  extract?: (
    filePath: string,
    source: string
  ) => {
    nodes: []
    references: []
  }
}

export function getAllFrameworkResolvers(): BrowserFrameworkResolver[] {
  return []
}

export function getApplicableFrameworks(
  resolvers: BrowserFrameworkResolver[],
  language: Language
) {
  return resolvers.filter(
    (resolver) =>
      resolver.languages === undefined || resolver.languages.includes(language)
  )
}
