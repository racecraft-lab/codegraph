import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { serveStatic } from '../src/server/static';

const root = path.resolve(__dirname, '..');

function text(body: string | Buffer): string {
  return Buffer.isBuffer(body) ? body.toString('utf8') : body;
}

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

  it('serves copied production web assets through the package static mount', () => {
    const distWeb = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-web-assets-'));
    fs.mkdirSync(path.join(distWeb, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(distWeb, 'index.html'), '<!doctype html><div id="root"></div>');
    fs.writeFileSync(path.join(distWeb, 'assets', 'app.js'), 'console.log("local");');

    const shell = serveStatic('/symbol/file%3Asrc%2Findex.ts', distWeb);
    expect(shell.status).toBe(200);
    expect(shell.headers?.['Content-Type']).toContain('text/html');
    expect(text(shell.body)).toContain('<div id="root"');

    const missingAsset = serveStatic('/assets/not-built.js', distWeb);
    expect(missingAsset.status).toBe(404);

    fs.rmSync(distWeb, { recursive: true, force: true });
  });
});
