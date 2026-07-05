import * as fs from 'fs';
import * as path from 'path';
import type { ResolutionContext } from './types';

export interface OcamlWorkspace {
  metadataPaths: string[];
  interfaceUnitKeys: Set<string>;
  localPackageNames: Set<string>;
}

const workspaceCache = new WeakMap<ResolutionContext, OcamlWorkspace>();

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function isIgnoredOcamlPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return (
    normalized.includes('/_opam/') ||
    normalized.startsWith('_opam/') ||
    normalized.includes('/.opam-switch/') ||
    normalized.startsWith('.opam-switch/') ||
    normalized.includes('/_build/') ||
    normalized.startsWith('_build/') ||
    normalized.endsWith('.opam.template') ||
    normalized === 'opam.locked' ||
    normalized.endsWith('/opam.locked') ||
    normalized.includes('/opam.locked/')
  );
}

export function moduleNameFromOcamlFile(filePath: string): string | null {
  const base = filePath.split('/').pop()?.replace(/\.mli?$/i, '');
  if (!base || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(base)) return null;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function sourceUnitKey(filePath: string): string | null {
  if (!/\.mli?$/i.test(filePath)) return null;
  return filePath.replace(/\\/g, '/').replace(/\.mli?$/i, '').toLowerCase();
}

function isOcamlMetadataPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  const base = normalized.split('/').pop() ?? '';
  return (
    base === 'dune-project' ||
    base === 'dune' ||
    /^[^/]+\.opam$/i.test(normalized) ||
    /^opam\/[^/]+\.opam$/i.test(normalized)
  );
}

function parentDirectory(filePath: string): string {
  const normalized = normalizePath(filePath);
  const slash = normalized.lastIndexOf('/');
  return slash < 0 ? '.' : normalized.slice(0, slash);
}

function joinRelative(dir: string, fileName: string): string {
  return dir === '.' ? fileName : `${dir}/${fileName}`;
}

function readProjectDir(context: ResolutionContext, relativeDir: string): string[] {
  const root = path.resolve(context.getProjectRoot());
  const target = path.resolve(root, relativeDir);
  if (target !== root && !target.startsWith(root + path.sep)) return [];

  try {
    return fs
      .readdirSync(target, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => joinRelative(relativeDir, entry.name));
  } catch {
    return [];
  }
}

function collectCandidateMetadataPaths(context: ResolutionContext, sourceDirs: Set<string>): Set<string> {
  const candidates = new Set<string>(['dune-project']);
  for (const dir of sourceDirs) candidates.add(joinRelative(dir, 'dune'));

  for (const filePath of readProjectDir(context, '.')) {
    if (/^[^/]+\.opam$/i.test(filePath)) candidates.add(filePath);
  }
  for (const filePath of readProjectDir(context, 'opam')) {
    if (/^opam\/[^/]+\.opam$/i.test(filePath)) candidates.add(filePath);
  }

  return candidates;
}

export function loadOcamlWorkspace(context: ResolutionContext): OcamlWorkspace {
  const cached = workspaceCache.get(context);
  if (cached) return cached;

  const metadataPaths: string[] = [];
  const interfaceUnitKeys = new Set<string>();
  const localPackageNames = new Set<string>();
  const sourceDirs = new Set<string>(['.']);
  const seenMetadataPaths = new Set<string>();

  for (const filePath of context.getAllFiles()) {
    const normalized = normalizePath(filePath);
    if (isIgnoredOcamlPath(normalized)) continue;
    const unitKey = sourceUnitKey(normalized);
    if (unitKey) {
      sourceDirs.add(parentDirectory(normalized));
      if (normalized.endsWith('.mli')) interfaceUnitKeys.add(unitKey);
    }
    if (isOcamlMetadataPath(normalized)) seenMetadataPaths.add(normalized);
  }

  for (const candidate of collectCandidateMetadataPaths(context, sourceDirs)) {
    if (isIgnoredOcamlPath(candidate)) continue;
    if (context.fileExists(candidate)) seenMetadataPaths.add(candidate);
  }

  for (const metadataPath of seenMetadataPaths) {
    const normalized = normalizePath(metadataPath);
    if (isIgnoredOcamlPath(normalized) || !isOcamlMetadataPath(normalized)) continue;
    const base = normalized.split('/').pop() ?? '';

    metadataPaths.push(normalized);
    if (base.endsWith('.opam')) localPackageNames.add(base.replace(/\.opam$/i, '').toLowerCase());

    const content = context.readFile(normalized);
    if (!content) continue;
    for (const match of content.matchAll(/\(\s*(?:name|package\s+\(\s*name)\s+([A-Za-z0-9_.-]+)/g)) {
      if (match[1]) localPackageNames.add(match[1].toLowerCase());
    }
    for (const match of content.matchAll(/^\s*name\s*:\s*"?([A-Za-z0-9_.-]+)"?/gm)) {
      if (match[1]) localPackageNames.add(match[1].toLowerCase());
    }
  }

  const workspace = {
    metadataPaths: metadataPaths.sort(),
    interfaceUnitKeys,
    localPackageNames,
  };
  workspaceCache.set(context, workspace);
  return workspace;
}
