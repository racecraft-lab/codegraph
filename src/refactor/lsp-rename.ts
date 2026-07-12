/**
 * FR-003 / FR-003a — LSP-path rename derivation (SPEC-010).
 *
 * Issues a `textDocument/rename` through the SPEC-008 {@link LspJsonRpcClient}
 * and translates the returned workspace edit into `RenameEdit[]` (`source`
 * `lsp`, `exact` tier — a language-server workspace edit is server-authoritative,
 * so it earns `exact` directly, no span verification, FR-004). Availability and
 * per-language command resolution reuse the SPEC-008 substrate
 * (`resolveLspConfig` → {@link EffectiveLspConfig}, {@link probeLspServerCommand});
 * positions follow the SPEC-008 UTF-16 convention (research Decision 2) —
 * `character` is already UTF-16 code units and passes through verbatim, only the
 * line index is converted ONCE here at the boundary (LSP 0-based ↔ graph-native
 * 1-based).
 *
 * This module owns the LSP ATTEMPT and its failure CLASSIFICATION only. It never
 * throws across its seam and never returns partial edits; it returns a
 * discriminated result so the caller (the plan engine, a later task) routes an
 * `unavailable`/`failed` outcome to the graph-reference path per the SPEC-008
 * per-language degradation parity of FR-003a — the routing itself is the
 * caller's, as is the default-off enablement decision (when invoked, this module
 * probes and attempts). The workspace-root jail for out-of-root edit URIs
 * (FR-017) is a later task; this module translates every returned edit faithfully.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { LspClientError, LspJsonRpcClient } from '../lsp/client';
import { probeLspServerCommand } from '../lsp/prereqs';
import { EffectiveLspConfig, LspLanguage, LspReasonCode } from '../lsp/types';
import { normalizePath } from '../utils';
import { RenameEdit, SourcePosition, TextEdit, WorkspaceEdit } from './types';

/** LSP `languageId` values that differ from our Language tokens (didOpen). */
const LSP_LANGUAGE_IDS: Partial<Record<LspLanguage, string>> = {
  tsx: 'typescriptreact',
  jsx: 'javascriptreact',
};

export interface DeriveLspRenameOptions {
  /** Absolute workspace root. */
  projectRoot: string;
  /** Resolved SPEC-008 config (the caller reuses `resolveLspConfig`). */
  config: EffectiveLspConfig;
  /** The target's language — an LSP-covered language; the caller narrows. */
  language: LspLanguage;
  /** Workspace-relative path of the file to open for the rename request. */
  file: string;
  /** The rename cursor position — 1-indexed line, 0-indexed UTF-16 column; the
   *  caller supplies a position that lands on the target identifier. */
  position: SourcePosition;
  /** The new name handed to the server. */
  newName: string;
  /** Env override for the probe + spawned server (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
}

/**
 * The seam result (design note). `ok` carries the translated edits; an
 * `unavailable` server (probe fails: `missing-default-command` /
 * `configured-command-unavailable`) and a `failed` runtime exchange
 * (`server-crash` / `initialize-timeout` / `request-timeout` /
 * `malformed-protocol-response` / `shutdown-failure`) each hand the caller a
 * reason and NO edits, so it can route to the graph path (FR-003a).
 */
export type LspRenameResult =
  | { status: 'ok'; edits: RenameEdit[] }
  | { status: 'unavailable'; reason: LspReasonCode }
  | { status: 'failed'; reason: LspReasonCode };

export async function deriveLspRename(options: DeriveLspRenameOptions): Promise<LspRenameResult> {
  const { projectRoot, config, language, file, position, newName, env } = options;

  const server = config.servers[language];
  const probe = probeLspServerCommand(server, { cwd: projectRoot, env });
  if (probe.state === 'unavailable' || !server.command) {
    return { status: 'unavailable', reason: probe.reasonCode ?? 'missing-default-command' };
  }

  const absFile = path.join(projectRoot, file);
  const uri = pathToFileURL(absFile).href;
  const client = new LspJsonRpcClient({
    command: server.command,
    cwd: projectRoot,
    timeoutMs: server.timeoutMs,
    rootUri: pathToFileURL(projectRoot).href,
    rootPath: projectRoot,
    env,
  });

  try {
    await client.initialize();
    client.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: LSP_LANGUAGE_IDS[language] ?? language,
        version: 1,
        text: fs.readFileSync(absFile, 'utf8'),
      },
    });
    const workspaceEdit = await client.request('textDocument/rename', {
      textDocument: { uri },
      position: { line: Math.max(0, position.line - 1), character: Math.max(0, position.column) },
      newName,
    });
    client.notify('textDocument/didClose', { textDocument: { uri } });
    await client.shutdown();
    return { status: 'ok', edits: translateWorkspaceEdit(projectRoot, workspaceEdit) };
  } catch (error) {
    await client.dispose().catch(() => undefined);
    return { status: 'failed', reason: error instanceof LspClientError ? error.reasonCode : 'server-crash' };
  }
}

/**
 * Translate a `textDocument/rename` workspace edit into `RenameEdit[]`. The
 * server sends only `newText` + range, so each edited file is read once to
 * recover `oldText` (the live bytes the range replaces) and `lineText` (the full
 * pre-edit source line for the before/after preview, FR-027). LSP ranges are
 * 0-indexed UTF-16; the line converts once to graph-native 1-indexed and the
 * column passes through verbatim (research Decision 2).
 */
function translateWorkspaceEdit(projectRoot: string, result: unknown): RenameEdit[] {
  const edit = result as WorkspaceEdit | null | undefined;
  const perFile: Array<{ uri: string; edits: TextEdit[] }> = [];
  if (edit && Array.isArray(edit.documentChanges)) {
    for (const change of edit.documentChanges) {
      if (change?.textDocument?.uri && Array.isArray(change.edits)) {
        perFile.push({ uri: change.textDocument.uri, edits: change.edits });
      }
    }
  } else if (edit && edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      if (Array.isArray(edits)) perFile.push({ uri, edits });
    }
  }

  const out: RenameEdit[] = [];
  for (const { uri, edits } of perFile) {
    const absPath = fileURLToPath(uri);
    const lines = fs.readFileSync(absPath, 'utf8').split('\n');
    // Normalize to the graph's forward-slash path convention: `path.relative`
    // uses the CURRENT PLATFORM's separator, which is `\` on win32 — the same
    // normalization precision-pass.ts's uriToProjectPath already applies
    // (D5-win review finding).
    const relFile = normalizePath(path.relative(projectRoot, absPath));
    for (const textEdit of edits) {
      const { start, end } = textEdit.range;
      const lineText = (lines[start.line] ?? '').replace(/\r$/, '');
      const oldText = start.line === end.line ? lineText.slice(start.character, end.character) : '';
      out.push({
        file: relFile,
        range: {
          start: { line: start.line + 1, column: start.character },
          end: { line: end.line + 1, column: end.character },
        },
        oldText,
        newText: textEdit.newText,
        lineText,
        confidence: 'exact',
        source: 'lsp',
      });
    }
  }
  return out;
}
