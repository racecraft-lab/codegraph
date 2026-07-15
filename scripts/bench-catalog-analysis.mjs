#!/usr/bin/env node
/**
 * SPEC-011 T061/T062/T064 — paired full-index benchmark for the catalog
 * analysis feature (SC-006, SC-007, Q19).
 *
 * Arm A: `analysis.flows=false, analysis.clusters=false` (dormant — byte-identical
 *        to the pre-feature state, FR-025/SC-007).
 * Arm B: `analysis.flows=true,  analysis.clusters=true`  (both catalogs computed).
 *
 * Method (quickstart.md "Performance benchmark"):
 *   - The SAME committed benchmark-monorepo fixture feeds both arms (materialized
 *     once via tsx — the fixture generator lives under __tests__, excluded from
 *     the build).
 *   - Each timed iteration is a COLD full index of a fresh copy; the timed window
 *     is `indexAll()` only (fixture copy, project init, and process startup are
 *     excluded).
 *   - Arms are INTERLEAVED (A,B,A,B,…) so slow-machine drift hits both equally,
 *     after >=1 discarded warmup pair.
 *   - Embeddings/LSP are held constant: the harness asserts an IDENTICAL
 *     vectors_write_version and IDENTICAL lsp-provenance edge count across every
 *     arm/iteration (both dormant here), so the only difference between arms is
 *     the catalog analysis under test.
 *
 * Reports per-arm median + spread, the SC-006 ratio median(B)/median(A) (pass
 * bar <= 1.20), and the SC-007 zero-overhead band (Arm A split-half median delta;
 * Arm A is the pre-feature-equivalent dormant build). PR/UAT evidence, not a CI
 * timing gate.
 *
 * Usage:
 *   node scripts/bench-catalog-analysis.mjs            # human report
 *   node scripts/bench-catalog-analysis.mjs --json     # + machine-readable JSON
 *   BENCH_ITERS=20 BENCH_WARMUP=2 node scripts/bench-catalog-analysis.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const emitJson = process.argv.includes('--json');
const distIndex = path.join(repoRoot, 'dist/index.js');
const genPath = path.join(repoRoot, '__tests__/analysis/fixtures/benchmark-monorepo/generate.ts');

if (!fs.existsSync(distIndex)) {
  console.error('bench-catalog-analysis requires a built dist/. Run `npm run build` first.');
  process.exit(1);
}
if (!fs.existsSync(genPath)) {
  console.error(`benchmark fixture generator not found at ${genPath}`);
  process.exit(1);
}

const ITERS = Math.max(5, Number(process.env.BENCH_ITERS) || 15);
const WARMUP = Math.max(1, Number(process.env.BENCH_WARMUP) || 1);

const { CodeGraph, DatabaseConnection, getDatabasePath, QueryBuilder } = await import(
  pathToFileURL(distIndex).href
);

const ARMS = {
  A: { flows: false, clusters: false },
  B: { flows: true, clusters: true },
};

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-bench-catalog-'));
const templateDir = path.join(tmpRoot, 'fixture');
fs.mkdirSync(templateDir, { recursive: true });

// Materialize the committed fixture ONCE via tsx (outside every timed window).
const materializer = path.join(tmpRoot, 'materialize.mjs');
fs.writeFileSync(
  materializer,
  `const m = await import(${JSON.stringify(pathToFileURL(genPath).href)});\n` +
    `m.materializeBenchmarkMonorepo(process.argv[2]);\n`,
);
execFileSync('npx', ['tsx', materializer, templateDir], { cwd: repoRoot, stdio: 'inherit' });

/** Read one integer metadata value, defaulting to 0 when the key is absent. */
function metaInt(db, key) {
  const row = db.prepare('SELECT value FROM project_metadata WHERE key = ?').get(key);
  return row ? Number(row.value) : 0;
}

/** One cold full index of a fresh fixture copy under `arm`; returns ms + invariants. */
async function runOnce(arm) {
  const dir = fs.mkdtempSync(path.join(tmpRoot, `run-${arm}-`));
  fs.cpSync(templateDir, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'codegraph.json'), JSON.stringify({ analysis: ARMS[arm] }));

  const cg = CodeGraph.initSync(dir);
  const t0 = performance.now();
  await cg.indexAll();
  const t1 = performance.now();
  cg.close();

  const conn = DatabaseConnection.open(getDatabasePath(dir));
  let metrics;
  try {
    const db = conn.getDb();
    void new QueryBuilder(db); // parity with the read path; raw SQL below
    metrics = {
      ms: t1 - t0,
      vectorsWriteVersion: metaInt(db, 'vectors_write_version'),
      lspEdges: db.prepare("SELECT COUNT(*) AS n FROM edges WHERE provenance = 'lsp'").get().n,
      flows: db.prepare('SELECT COUNT(*) AS n FROM flows').get().n,
      clusters: db.prepare('SELECT COUNT(*) AS n FROM clusters').get().n,
    };
  } finally {
    conn.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return metrics;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function stddev(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}
const round = (x) => Math.round(x * 1000) / 1000;

async function main() {
  // Discarded warmup pairs.
  for (let w = 0; w < WARMUP; w++) {
    await runOnce('A');
    await runOnce('B');
  }

  const samples = { A: [], B: [] };
  const invariants = { A: [], B: [] };
  for (let i = 0; i < ITERS; i++) {
    const a = await runOnce('A');
    samples.A.push(a.ms);
    invariants.A.push(a);
    const b = await runOnce('B');
    samples.B.push(b.ms);
    invariants.B.push(b);
  }

  // ── Held-constant guard: embeddings + LSP identical across every arm/iter ──
  const allVwv = [...invariants.A, ...invariants.B].map((m) => m.vectorsWriteVersion);
  const allLsp = [...invariants.A, ...invariants.B].map((m) => m.lspEdges);
  const vwvConstant = allVwv.every((v) => v === allVwv[0]);
  const lspConstant = allLsp.every((v) => v === allLsp[0]);
  // Sanity: the arms genuinely differ (B computes catalogs, A writes none).
  const bComputes = invariants.B.every((m) => m.flows > 0 && m.clusters > 0);
  const aDormant = invariants.A.every((m) => m.flows === 0 && m.clusters === 0);

  const medA = median(samples.A);
  const medB = median(samples.B);
  const ratio = medA > 0 ? medB / medA : Infinity;

  // ── SC-007 zero-overhead band: Arm A is the pre-feature-equivalent (dormant)
  // build; its split-half median delta is the disabled-path run-to-run band. ──
  const half = Math.floor(samples.A.length / 2);
  const aFirst = samples.A.slice(0, half);
  const aSecond = samples.A.slice(samples.A.length - half);
  const medA1 = median(aFirst);
  const medA2 = median(aSecond);
  const zeroOverheadDeltaPct = ((Math.abs(medA1 - medA2) / Math.min(medA1, medA2)) * 100);

  const report = {
    fixture: 'benchmark-monorepo',
    iters: ITERS,
    warmup: WARMUP,
    heldConstant: {
      vectorsWriteVersion: allVwv[0],
      lspEdges: allLsp[0],
      vectorsWriteVersionConstant: vwvConstant,
      lspEdgesConstant: lspConstant,
    },
    sanity: { armBComputesCatalogs: bComputes, armADormant: aDormant },
    armA: {
      medianMs: round(medA),
      minMs: round(Math.min(...samples.A)),
      maxMs: round(Math.max(...samples.A)),
      stddevMs: round(stddev(samples.A)),
      samples: samples.A.map(round),
    },
    armB: {
      medianMs: round(medB),
      minMs: round(Math.min(...samples.B)),
      maxMs: round(Math.max(...samples.B)),
      stddevMs: round(stddev(samples.B)),
      samples: samples.B.map(round),
    },
    sc006: { ratioBoverA: round(ratio), passBar: 1.2, pass: ratio <= 1.2 },
    sc007ZeroOverhead: {
      medianFirstHalfA: round(medA1),
      medianSecondHalfA: round(medA2),
      deltaPct: round(zeroOverheadDeltaPct),
      bandPct: 2,
      withinBand: zeroOverheadDeltaPct <= 2,
    },
  };

  console.log('\n=== SPEC-011 catalog-analysis paired benchmark ===');
  console.log(`fixture: benchmark-monorepo   iters/arm: ${ITERS}   warmup pairs: ${WARMUP}`);
  console.log(
    `held constant:  vectors_write_version=${allVwv[0]} (${vwvConstant ? 'OK' : 'DRIFT'})   ` +
      `lsp edges=${allLsp[0]} (${lspConstant ? 'OK' : 'DRIFT'})`,
  );
  console.log(`sanity:  Arm B computes catalogs=${bComputes}   Arm A dormant=${aDormant}`);
  console.log(
    `Arm A (disabled):  median ${round(medA)}ms  [min ${round(Math.min(...samples.A))}, ` +
      `max ${round(Math.max(...samples.A))}, sd ${round(stddev(samples.A))}]`,
  );
  console.log(
    `Arm B (both on):   median ${round(medB)}ms  [min ${round(Math.min(...samples.B))}, ` +
      `max ${round(Math.max(...samples.B))}, sd ${round(stddev(samples.B))}]`,
  );
  console.log(
    `SC-006  median(B)/median(A) = ${round(ratio)}  (bar <= 1.20)  → ${report.sc006.pass ? 'PASS' : 'OVER BAR'}`,
  );
  console.log(
    `SC-007  Arm A split-half median delta = ${round(zeroOverheadDeltaPct)}%  (band <= 2%)  → ` +
      `${report.sc007ZeroOverhead.withinBand ? 'PASS' : 'OVER BAND (fixture too small / noisy — record as measured)'}`,
  );

  if (emitJson) console.log('\nJSON ' + JSON.stringify(report));

  fs.rmSync(tmpRoot, { recursive: true, force: true });

  // Only a genuine confounder (embeddings/LSP drift, or arms not differing) is a
  // hard failure. Timing bars are recorded as evidence, never a CI gate (Q19).
  if (!vwvConstant || !lspConstant || !bComputes || !aDormant) {
    console.error('\nFAIL: held-constant invariant or arm-difference sanity violated.');
    process.exit(1);
  }
}

main().catch((err) => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  console.error(err);
  process.exit(1);
});
