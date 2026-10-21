import * as fs from 'fs';
import * as path from 'path';

/** Copy a published npm entry and its shared runtime policy into a fixture. */
export function copyNpmEntry(source: string, packageRoot: string): void {
  fs.copyFileSync(source, path.join(packageRoot, path.basename(source)));
  fs.mkdirSync(path.join(packageRoot, 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(path.dirname(source), 'lib', 'node-runtime-policy.cjs'),
    path.join(packageRoot, 'lib', 'node-runtime-policy.cjs'),
  );
}
