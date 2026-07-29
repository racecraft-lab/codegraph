import * as fs from "node:fs";
import * as path from "node:path";

export const WEB_BUILD_ENTRIES = Object.freeze({
  main: "./index.html",
  "local-indexing-worker": "./src/local-indexing/worker.ts",
});

export const REQUIRED_WEB_ASSETS = Object.freeze([
  {
    id: "index-html",
    pattern: /^index\.html$/,
    minimumBytes: 128,
    integrity: "html",
  },
  {
    id: "local-indexing-worker",
    pattern: /^assets\/local-indexing-worker-[^/]+\.js$/,
    minimumBytes: 1_024,
    integrity: "javascript",
  },
  {
    id: "sqlite-wasm",
    pattern: /^assets\/sqlite3-[^/]+\.wasm$/,
    minimumBytes: 1_024,
    integrity: "wasm",
  },
  {
    id: "sqlite-opfs-proxy",
    pattern: /^assets\/sqlite3-opfs-async-proxy-[^/]+\.js$/,
    minimumBytes: 1_024,
    integrity: "javascript",
  },
  {
    id: "sqlite-worker",
    pattern: /^assets\/sqlite3-worker1-[^/]+\.js$/,
    minimumBytes: 1_024,
    integrity: "javascript",
  },
  {
    id: "local-indexing-runtime-worker",
    pattern: /^assets\/worker-[^/]+\.js$/,
    minimumBytes: 1_024,
    integrity: "javascript",
  },
  {
    id: "tree-sitter-runtime",
    pattern:
      /^assets\/tree-sitter-(?!javascript-|typescript-|tsx-)[^/]+\.wasm$/,
    minimumBytes: 1_024,
    integrity: "wasm",
  },
  {
    id: "grammar-javascript",
    pattern: /^assets\/tree-sitter-javascript-[^/]+\.wasm$/,
    minimumBytes: 1_024,
    integrity: "wasm",
  },
  {
    id: "grammar-typescript",
    pattern: /^assets\/tree-sitter-typescript-[^/]+\.wasm$/,
    minimumBytes: 1_024,
    integrity: "wasm",
  },
  {
    id: "grammar-tsx",
    pattern: /^assets\/tree-sitter-tsx-[^/]+\.wasm$/,
    minimumBytes: 1_024,
    integrity: "wasm",
  },
]);

export const DEFERRED_WEB_ASSET_IDS = Object.freeze(
  REQUIRED_WEB_ASSETS.filter(
    (asset) =>
      asset.id.startsWith("sqlite-") ||
      asset.id === "tree-sitter-runtime" ||
      asset.id.startsWith("grammar-"),
  ).map((asset) => asset.id),
);

function listFiles(root, relativeRoot = "") {
  const directory = path.join(root, relativeRoot);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeRoot, entry.name);
    return entry.isDirectory() ? listFiles(root, relativePath) : [relativePath];
  });
}

function assertIntegrity(asset, absolutePath) {
  const bytes = fs.readFileSync(absolutePath);
  if (bytes.byteLength < asset.minimumBytes) {
    throw new Error(
      `required web asset ${asset.id} is corrupt: expected at least ${asset.minimumBytes} bytes`,
    );
  }
  if (
    asset.integrity === "wasm" &&
    !bytes.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]))
  ) {
    throw new Error(
      `required web asset ${asset.id} is corrupt: invalid WebAssembly header`,
    );
  }
  const prefix = bytes.subarray(0, Math.min(bytes.byteLength, 512)).toString();
  if (asset.integrity === "html" && !/<!doctype html>/i.test(prefix)) {
    throw new Error(
      `required web asset ${asset.id} is corrupt: invalid HTML entry`,
    );
  }
}

export function classifyWebAssetPath(candidate) {
  const pathname = String(candidate).split(/[?#]/, 1)[0] ?? "";
  const relativePath = pathname.replace(/^\/+/, "");
  return REQUIRED_WEB_ASSETS.find((asset) => asset.pattern.test(relativePath))
    ?.id;
}

export function validateWebAssetDirectory(root) {
  const files = listFiles(root);
  return REQUIRED_WEB_ASSETS.map((asset) => {
    const matches = files.filter((file) => asset.pattern.test(file));
    if (matches.length !== 1) {
      throw new Error(
        `required web asset ${asset.id} is ${
          matches.length === 0 ? "missing" : "ambiguous"
        } in ${root}`,
      );
    }
    const relativePath = matches[0];
    const absolutePath = path.join(root, relativePath);
    assertIntegrity(asset, absolutePath);
    return {
      id: asset.id,
      relativePath,
      bytes: fs.statSync(absolutePath).size,
    };
  });
}
