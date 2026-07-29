/**
 * Runtime-neutral utility subset used by canonical language extractors.
 *
 * Keep this module deliberately narrow so importing a language extractor in a
 * browser does not pull the Node-only filesystem utilities into the worker.
 */
export function stripAngleBracketGroups(input: string): string {
  let depth = 0
  let output = ""

  for (const character of input) {
    if (character === "<") {
      depth += 1
      continue
    }
    if (character === ">") {
      if (depth > 0) {
        depth -= 1
        continue
      }
    }
    if (depth === 0) output += character
  }

  return output
}
