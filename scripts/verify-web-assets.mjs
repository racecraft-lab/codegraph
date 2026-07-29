#!/usr/bin/env node
import * as path from "node:path";
import { validateWebAssetDirectory } from "./web-asset-manifest.mjs";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  throw new Error("expected at least one web asset directory");
}

for (const root of roots) {
  const absoluteRoot = path.resolve(root);
  const inventory = validateWebAssetDirectory(absoluteRoot);
  process.stdout.write(
    `${absoluteRoot}: ${inventory
      .map((entry) => `${entry.id}=${entry.bytes}`)
      .join(" ")}\n`,
  );
}
