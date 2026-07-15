import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..');

describe('SPEC-006 web package assets', () => {
  it('wires the root build to build and copy the nested web app', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts.build).toContain('npm run build:web');
    expect(pkg.scripts.build).toContain('npm run copy-web-assets');
    expect(pkg.scripts['build:web']).toBe('npm --prefix web run build');
    expect(pkg.scripts['copy-web-assets']).toBe('node scripts/copy-web-assets.mjs');
  });

  it('keeps the web build local and package-shippable', () => {
    const webPkg = JSON.parse(fs.readFileSync(path.join(root, 'web/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
    const copyScript = fs.readFileSync(path.join(root, 'scripts/copy-web-assets.mjs'), 'utf8');

    expect(webPkg.dependencies.react).toBeDefined();
    expect(webPkg.dependencies.cytoscape).toBeDefined();
    expect(webPkg.dependencies['@tailwindcss/vite']).toBeDefined();
    expect(webPkg.devDependencies.vitest).toBeDefined();
    expect(html).not.toMatch(/https?:\/\//);
    expect(copyScript).toContain('web/dist');
    expect(copyScript).toContain("'dist', 'web'");
  });
});
