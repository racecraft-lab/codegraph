export interface MarkupBlock {
  tagName: string;
  attrs: string;
  content: string;
  startIndex: number;
  endIndex: number;
  contentStartIndex: number;
  contentEndIndex: number;
  startLine: number;
  endLine: number;
  contentStartLine: number;
}

function isTagNameChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9:-]/.test(ch);
}

function isTagBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === '>' || ch === '/' || /\s/.test(ch);
}

function findTagEnd(source: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

function findLineNumber(source: string, index: number): number {
  let line = 0;
  let pos = -1;
  while ((pos = source.indexOf('\n', pos + 1)) !== -1 && pos < index) {
    line++;
  }
  return line;
}

function findTagStart(source: string, needle: string, from: number): number {
  const lower = source.toLowerCase();
  let search = from;
  while (search < source.length) {
    const start = lower.indexOf(needle, search);
    if (start === -1) return -1;
    const afterName = start + needle.length;
    if (!isTagBoundary(source[afterName])) {
      search = afterName;
      continue;
    }
    return start;
  }
  return -1;
}

function isSelfClosingTag(source: string, tagEnd: number): boolean {
  let i = tagEnd - 1;
  while (i >= 0 && /\s/.test(source[i]!)) i--;
  return source[i] === '/';
}

function findClosingTag(source: string, tagName: string, from: number): { start: number; end: number } | null {
  const openNeedle = `<${tagName.toLowerCase()}`;
  const closeNeedle = `</${tagName.toLowerCase()}`;
  const allowNested = tagName === 'template';
  let depth = 0;
  let search = from;

  while (search < source.length) {
    const closeStart = findTagStart(source, closeNeedle, search);
    if (closeStart === -1) return null;

    if (allowNested) {
      const openStart = findTagStart(source, openNeedle, search);
      if (openStart !== -1 && openStart < closeStart) {
        const openEnd = findTagEnd(source, openStart + openNeedle.length);
        if (openEnd === -1) return null;
        if (!isSelfClosingTag(source, openEnd)) depth++;
        search = openEnd + 1;
        continue;
      }
    }

    const end = findTagEnd(source, closeStart + closeNeedle.length);
    if (end === -1) return null;
    if (depth === 0) return { start: closeStart, end };
    depth--;
    search = end + 1;
  }

  return null;
}

/**
 * Find complete HTML-like blocks with a small linear scanner.
 *
 * This is intentionally not a general HTML parser. It is enough for SFC-style
 * source extraction, handles quoted `>` in attributes, case-insensitive tag
 * names, and browser-tolerated closing tags such as `</script >`.
 */
export function findMarkupBlocks(source: string, tagNames: readonly string[]): MarkupBlock[] {
  const wanted = new Set(tagNames.map((tag) => tag.toLowerCase()));
  const blocks: MarkupBlock[] = [];
  let search = 0;

  while (search < source.length) {
    const openStart = source.indexOf('<', search);
    if (openStart === -1) break;

    const first = source[openStart + 1];
    if (!first || first === '/' || first === '!' || first === '?') {
      search = openStart + 1;
      continue;
    }

    let nameEnd = openStart + 1;
    while (isTagNameChar(source[nameEnd])) nameEnd++;

    const rawName = source.slice(openStart + 1, nameEnd);
    const tagName = rawName.toLowerCase();
    if (!rawName || !wanted.has(tagName) || !isTagBoundary(source[nameEnd])) {
      search = openStart + 1;
      continue;
    }

    const openEnd = findTagEnd(source, nameEnd);
    if (openEnd === -1) break;

    const close = findClosingTag(source, tagName, openEnd + 1);
    if (!close) {
      search = openEnd + 1;
      continue;
    }

    const contentStartIndex = openEnd + 1;
    const contentEndIndex = close.start;
    blocks.push({
      tagName,
      attrs: source.slice(nameEnd, openEnd),
      content: source.slice(contentStartIndex, contentEndIndex),
      startIndex: openStart,
      endIndex: close.end,
      contentStartIndex,
      contentEndIndex,
      startLine: findLineNumber(source, openStart),
      endLine: findLineNumber(source, close.end),
      contentStartLine: findLineNumber(source, contentStartIndex),
    });

    search = close.end + 1;
  }

  return blocks;
}

export function findBraceExpressions(
  line: string,
  excludedFirstChars: ReadonlySet<string>,
  includeOpenEnded = false,
): Array<{ text: string; offset: number }> {
  const expressions: Array<{ text: string; offset: number }> = [];
  let search = 0;

  while (search < line.length) {
    const open = line.indexOf('{', search);
    if (open === -1) break;

    const first = line[open + 1];
    if (!first || excludedFirstChars.has(first)) {
      search = open + 1;
      continue;
    }

    const close = line.indexOf('}', open + 1);
    if (close === -1) {
      if (includeOpenEnded) {
        expressions.push({ text: line.slice(open + 1), offset: open });
      }
      break;
    }

    expressions.push({ text: line.slice(open + 1, close), offset: open });
    search = close + 1;
  }

  return expressions;
}
