#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'web', 'dist');
const target = path.join(root, 'dist', 'web');

if (!fs.existsSync(path.join(source, 'index.html'))) {
  throw new Error('web build output missing: expected web/dist/index.html');
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true });
