import type { ResolutionContext } from './types';

export interface OcamlWorkspace {
  metadataPaths: string[];
  localPackageNames: Set<string>;
}

const workspaceCache = new WeakMap<ResolutionContext, OcamlWorkspace>();

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

export function loadOcamlWorkspace(context: ResolutionContext): OcamlWorkspace {
  const cached = workspaceCache.get(context);
  if (cached) return cached;

  const metadataPaths: string[] = [];
  const localPackageNames = new Set<string>();

  for (const filePath of context.getAllFiles()) {
    const normalized = filePath.replace(/\\/g, '/');
    if (isIgnoredOcamlPath(normalized)) continue;

    const base = normalized.split('/').pop() ?? '';
    const isRootOpam = /^[^/]+\.opam$/i.test(normalized);
    const isOpamDirPackage = /^opam\/[^/]+\.opam$/i.test(normalized);
    const isMetadata =
      base === 'dune-project' ||
      base === 'dune' ||
      isRootOpam ||
      isOpamDirPackage;
    if (!isMetadata) continue;

    metadataPaths.push(normalized);
    if (base.endsWith('.opam')) {
      localPackageNames.add(base.replace(/\.opam$/i, '').toLowerCase());
    }

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
    localPackageNames,
  };
  workspaceCache.set(context, workspace);
  return workspace;
}
