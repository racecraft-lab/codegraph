#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const repoRoot = process.cwd();
const languagePath = valueFor('--language') ?? 'specs/008-lsp-client-integration/validation/language-parity.md';
const capabilityPath = valueFor('--capability') ?? 'specs/008-lsp-client-integration/validation/capability-parity.md';
const outputJson = args.includes('--json');

const result = {
  status: 'pass',
  checkedAt: new Date().toISOString(),
  files: {
    language: languagePath,
    capability: capabilityPath,
  },
  language: validateTable(resolvePath(languagePath), {
    requiredHeaders: ['Language', 'Owner', 'Evidence', 'Future owner', 'Status'],
    rowName: 'Language',
  }),
  capability: validateTable(resolvePath(capabilityPath), {
    requiredHeaders: ['Capability row', 'Owner', 'Evidence', 'Future owner', 'Status'],
    rowName: 'Capability row',
  }),
};

const failures = [...result.language.failures, ...result.capability.failures];
if (failures.length > 0) result.status = 'fail';

if (outputJson || result.status === 'fail') {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`SPEC-008 parity gate passed: ${result.language.rows} language rows, ${result.capability.rows} capability rows, 0 unowned rows.`);
}

if (result.status === 'fail') process.exit(1);

function validateTable(filePath, options) {
  if (!fs.existsSync(filePath)) {
    return { rows: 0, unowned: 1, failures: [`missing file: ${path.relative(repoRoot, filePath)}`] };
  }

  const text = fs.readFileSync(filePath, 'utf8');
  const table = firstMarkdownTable(text, options.requiredHeaders);
  if (!table) {
    return { rows: 0, unowned: 1, failures: [`missing required table in ${path.relative(repoRoot, filePath)}`] };
  }

  const failures = [];
  let unowned = 0;
  for (const row of table.rows) {
    const name = row[options.rowName] ?? '<unnamed>';
    const owner = row.Owner ?? '';
    const futureOwner = row['Future owner'] ?? '';
    const status = row.Status ?? '';
    const evidence = row.Evidence ?? '';
    if (/\bunowned\b/i.test(status) || /\bbacklog\b/i.test(status)) {
      unowned += 1;
      failures.push(`${name}: status is not allowed (${status})`);
    }
    if (!owner.trim()) {
      unowned += 1;
      failures.push(`${name}: owner is empty`);
    }
    if (/future-owned/i.test(status) && !/^SPEC-\d+/.test(futureOwner.trim())) {
      unowned += 1;
      failures.push(`${name}: future-owned row lacks concrete numbered future owner`);
    }
    if (!evidence.trim()) {
      unowned += 1;
      failures.push(`${name}: evidence is empty`);
    }
  }

  return { rows: table.rows.length, unowned, failures };
}

function firstMarkdownTable(text, requiredHeaders) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].trim().startsWith('|')) continue;
    if (!/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) continue;
    const headers = splitRow(lines[i]);
    if (!requiredHeaders.every((header) => headers.includes(header))) continue;
    const rows = [];
    for (let j = i + 2; j < lines.length; j += 1) {
      if (!lines[j].trim().startsWith('|')) break;
      const values = splitRow(lines[j]);
      if (values.length !== headers.length) break;
      rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
    }
    return { headers, rows };
  }
  return null;
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function valueFor(name) {
  const equals = args.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function resolvePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}
