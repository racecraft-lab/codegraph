import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Repository-independent prefix plus the normalized file-URI path. The real
 * repository prefix is constant within one LSP session, so this key has the
 * same primary ordering as the normalized URI used by the facade. The exact
 * URI key below breaks normalization ties before any workspace result cap.
 */
export function lspUriSortKey(filePath: string): string {
  return normalizeUriForComparison(lspExactUriSortKey(filePath));
}

/** Exact URI identity used only after the normalized URI comparison ties. */
export function lspExactUriSortKey(filePath: string): string {
  const platformRelative = filePath.split(path.sep).join('/');
  const relative = path.posix.normalize(`/${platformRelative}`).slice(1);
  const root = path.parse(path.resolve('.')).root;
  return pathToFileURL(path.resolve(root, ...relative.split('/'))).href;
}

/** Normalize decoded URI path text before re-encoding it for comparison. */
export function normalizeUriForComparison(uri: string): string {
  try {
    const parsed = new URL(uri);
    parsed.pathname = parsed.pathname
      .split('/')
      .map((component) => normalizeUriPathComponent(component))
      .join('/');
    return parsed.href;
  } catch {
    return uri.normalize('NFC');
  }
}

function normalizeUriPathComponent(component: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(component).normalize('NFC'));
  } catch {
    return component.normalize('NFC');
  }
}

/** Match SQLite BINARY text ordering, which compares the stored UTF-8 bytes. */
export function compareSqliteBinaryText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}
