export interface RequiredWebAsset {
  readonly id: string;
  readonly pattern: RegExp;
  readonly minimumBytes: number;
  readonly integrity: "html" | "javascript" | "wasm";
}

export interface WebAssetInventoryEntry {
  id: string;
  relativePath: string;
  bytes: number;
}

export const WEB_BUILD_ENTRIES: Readonly<Record<string, string>>;
export const REQUIRED_WEB_ASSETS: readonly RequiredWebAsset[];
export const DEFERRED_WEB_ASSET_IDS: readonly string[];

export function classifyWebAssetPath(candidate: string): string | undefined;
export function validateWebAssetDirectory(
  root: string,
): WebAssetInventoryEntry[];
