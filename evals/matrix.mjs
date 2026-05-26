#!/usr/bin/env node
/**
 * Multi-model eval matrix runner.
 *
 * Runs `npm run eval` against N models sequentially (Ollama shares the GPU
 * locally, so parallel doesn't help) and stitches the per-model JSON results
 * into one side-by-side HTML matrix. Useful for proving the engine works
 * across model classes (tiny / mid / frontier / reasoning) and for surfacing
 * fixtures that only one model class handles correctly.
 *
 * Usage:
 *   npm run matrix -- --models llama3.2:3b,qwen2.5-coder:7b-instruct-q4_K_M,qwen2.5:14b-instruct-q4_K_M
 *   npm run matrix -- --models <a>,<b>,<c> --filter analyzer
 *   npm run matrix -- --models <a>,<b>     --output evals/matrix-custom.html
 *
 * Output: `evals/matrix.html` by default — a dark-themed table with fixtures
 * as rows, models as columns. Cells show pass/fail/skip + score. Top row
 * aggregates per-model counts.
 */

import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';

const REPO_ROOT  = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_SCRIPT = path.join(REPO_ROOT, 'evals', 'run.mjs');

// ───── argv ─────
const argv = process.argv.slice(2);
const flag = (k, def) => {
  const i = argv.indexOf(k);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const MODELS_RAW = flag('--models', null);
const FILTER     = flag('--filter', null);
const OUTPUT     = flag('--output', path.join(REPO_ROOT, 'evals', 'matrix.html'));
const QUIET      = !!flag('--quiet', false);

if (!MODELS_RAW || typeof MODELS_RAW !== 'string') {
  console.error('error: --models <a>,<b>,... is required');
  console.error('');
  console.error('Example:');
  console.error('  npm run matrix -- --models llama3.2:3b,qwen2.5-coder:7b-instruct-q4_K_M,qwen2.5:14b-instruct-q4_K_M');
  console.error('');
  console.error('Optional flags:');
  console.error('  --filter <pattern>     pass through to run.mjs --filter');
  console.error('  --output <path>        HTML report output (default: evals/matrix.html)');
  console.error('  --quiet                exit-code-only output');
  process.exit(2);
}

const MODELS = MODELS_RAW.split(',').map((s) => s.trim()).filter(Boolean);
if (MODELS.length < 2) {
  console.error('error: --models needs at least 2 entries (matrix of 1 is just `npm run eval`)');
  process.exit(2);
}

const C = {
  dim:   (s) => `\x1b[90m${s}\x1b[0m`,
  red:   (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan:  (s) => `\x1b[36m${s}\x1b[0m`,
  bold:  (s) => `\x1b[1m${s}\x1b[0m`,
};
const log = QUIET ? () => {} : (...a) => console.log(...a);

// ───── per-model run ─────
function runOneModel(model, jsonOut) {
  return new Promise((resolve, reject) => {
    const args = [RUN_SCRIPT, '--no-html', '--json-out', jsonOut];
    if (FILTER) args.push('--filter', String(FILTER));
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        LLM_MODEL: model,
        // Don't kill the matrix on a single model's failed fixture — the JSON
        // dump still happens. The matrix represents the OBSERVED state.
      },
      stdio: QUIET ? 'ignore' : 'inherit',
    });
    child.on('exit', (code) => {
      // run.mjs exits non-zero on failed/errored — that's expected; we just
      // need the JSON to exist. Resolve regardless of exit code.
      if (!fsSync.existsSync(jsonOut)) {
        reject(new Error(`run.mjs exited ${code} without writing JSON for model=${model}`));
      } else {
        resolve();
      }
    });
    child.on('error', reject);
  });
}

// ───── HTML ─────
function html(modelResults) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = new Date().toISOString();

  // Union of all fixture names across models, preserving order from the first run.
  const seen = new Set();
  const allFixtures = [];
  for (const m of modelResults) {
    for (const f of m.fixtures) {
      if (!seen.has(f.name)) { seen.add(f.name); allFixtures.push(f.name); }
    }
  }

  // Per-model fixture lookup.
  const byModel = modelResults.map((m) => {
    const lookup = new Map();
    for (const f of m.fixtures) lookup.set(f.name, f);
    return { model: m.model, counts: m.counts, totalScore: m.totalScore, avgLatencyMs: m.avgLatencyMs, lookup };
  });

  // Cell rendering.
  const cellFor = (entry) => {
    if (!entry) return '<td class="cell na"><span title="not in this model\'s run">—</span></td>';
    if (entry.status === 'skipped') return `<td class="cell skipped" title="${esc(entry.skipReason || 'skipped')}">⊘</td>`;
    if (entry.status === 'errored') return `<td class="cell errored" title="${esc(entry.error || 'errored')}">⚠</td>`;
    if (entry.status === 'filtered') return '<td class="cell filtered">·</td>';
    const symbol = entry.passed ? '✓' : '✗';
    const pct = `${(entry.score * 100).toFixed(0)}%`;
    const klass = entry.passed ? 'pass' : 'fail';
    const tooltip = entry.failingChecks?.length
      ? entry.failingChecks.map((c) => `${c.key}: ${c.detail}`).join(' | ')
      : `score ${pct} · ${entry.latencyMs}ms`;
    return `<td class="cell ${klass}" title="${esc(tooltip)}"><span class="sym">${symbol}</span> <span class="pct">${pct}</span></td>`;
  };

  // Header — one column per model.
  const modelHeaderCells = byModel.map((m) =>
    `<th class="model-col"><div class="model-name">${esc(m.model)}</div></th>`
  ).join('');

  // Summary row — counts + avg score per model.
  const summaryCells = byModel.map((m) => {
    const { passed, failed, errored, skipped } = m.counts;
    const pct = `${(m.totalScore * 100).toFixed(0)}%`;
    const tag = failed > 0 || errored > 0 ? 'cell-summary fail' : 'cell-summary pass';
    return `<td class="${tag}"><div class="big">${pct}</div><div class="small">${passed}p · ${failed}f${errored ? ` · ${errored}e` : ''} · ${skipped}s</div></td>`;
  }).join('');

  // Fixture rows.
  const rows = allFixtures.map((name) => {
    const cells = byModel.map((m) => cellFor(m.lookup.get(name))).join('');
    return `<tr><td class="fixture-name">${esc(name)}</td>${cells}</tr>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ClarifyPrompt eval matrix — ${esc(date)}</title>
<style>
  :root { color-scheme: dark; }
  body { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; background: #0d1117; color: #c9d1d9; padding: 24px; max-width: 1400px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #8b949e; font-size: 12px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; background: #0d1117; }
  th, td { padding: 10px 12px; text-align: center; border-bottom: 1px solid #21262d; }
  th { background: #161b22; color: #8b949e; font-size: 11px; text-transform: uppercase; font-weight: 600; vertical-align: bottom; }
  .fixture-col { text-align: left; min-width: 280px; }
  .model-col { min-width: 180px; }
  .model-name { font-family: ui-monospace; font-size: 11px; word-break: break-all; line-height: 1.3; }
  .fixture-name { text-align: left; font-weight: 600; color: #e6edf3; font-size: 12px; padding: 8px 12px; }
  .cell { font-size: 12px; cursor: help; }
  .cell.pass { color: #3fb950; }
  .cell.fail { color: #f85149; font-weight: 600; }
  .cell.skipped { color: #6e7681; }
  .cell.errored { color: #d29922; font-weight: 600; }
  .cell.filtered { color: #484f58; }
  .cell.na { color: #484f58; font-style: italic; }
  .cell .sym { font-weight: 700; }
  .cell .pct { color: #8b949e; font-size: 11px; margin-left: 2px; }
  .cell-summary { padding: 12px 8px; }
  .cell-summary .big { font-size: 22px; font-weight: 700; }
  .cell-summary .small { font-size: 11px; color: #8b949e; margin-top: 2px; }
  .cell-summary.pass .big { color: #3fb950; }
  .cell-summary.fail .big { color: #f85149; }
  tr.summary-row { background: #161b22; }
  tr.summary-row td.fixture-name { color: #8b949e; font-weight: 600; }
  .legend { color: #8b949e; font-size: 11px; margin-top: 16px; padding: 12px 16px; background: #161b22; border-radius: 6px; }
  .legend code { color: #c9d1d9; }
</style>
</head>
<body>
  <h1>ClarifyPrompt eval matrix</h1>
  <div class="meta">${esc(date)} · ${byModel.length} models · ${allFixtures.length} fixtures · pass threshold 0.85</div>
  <table>
    <thead>
      <tr><th class="fixture-col">Fixture</th>${modelHeaderCells}</tr>
    </thead>
    <tbody>
      <tr class="summary-row">
        <td class="fixture-name">— summary —</td>
        ${summaryCells}
      </tr>
      ${rows}
    </tbody>
  </table>
  <div class="legend">
    <code>✓</code> pass · <code>✗</code> fail · <code>⊘</code> skipped (model-class gating) · <code>⚠</code> errored · <code>·</code> filtered · <code>—</code> not in this model's run<br>
    Hover any cell for details (failing check + reason, or skip rationale).
  </div>
</body>
</html>`;
}

// ───── main ─────
async function main() {
  log(C.bold(C.cyan(`╔═ ClarifyPrompt eval matrix runner ══════════════════════════════════════╗`)));
  log(`  Models: ${MODELS.join(', ')}`);
  log(`  Output: ${OUTPUT}`);
  if (FILTER) log(`  Filter: ${FILTER}`);
  log('');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clarify-matrix-'));
  const modelResults = [];

  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    const jsonOut = path.join(tmpDir, `model-${i}.json`);
    log(C.cyan(`▶ [${i + 1}/${MODELS.length}] ${model}`));
    try {
      await runOneModel(model, jsonOut);
      const data = JSON.parse(await fs.readFile(jsonOut, 'utf-8'));
      modelResults.push(data);
      const { passed, failed, errored, skipped } = data.counts;
      const pct = `${(data.totalScore * 100).toFixed(0)}%`;
      log(`  ${C.green(`${passed} passed`)} · ${failed > 0 ? C.red(`${failed} failed`) : C.dim('0 failed')}${errored ? ` · ${C.red(`${errored} errored`)}` : ''} · ${C.dim(`${skipped} skipped`)} · avg ${pct}`);
      log('');
    } catch (err) {
      log(C.red(`  ✖ ${model}: ${err.message}`));
      log('');
    }
  }

  if (modelResults.length === 0) {
    console.error('No model produced results. Bailing.');
    process.exit(2);
  }

  await fs.writeFile(OUTPUT, html(modelResults), 'utf-8');

  // Console summary.
  log(C.bold(`╠═ matrix summary ════════════════════════════════════════════════════════╣`));
  for (const m of modelResults) {
    const { passed, failed, errored, skipped, total } = m.counts;
    const pct = `${(m.totalScore * 100).toFixed(0)}%`;
    const tag = failed > 0 || errored > 0 ? C.red('NOT GREEN') : C.green('GREEN');
    log(`  ${m.model.padEnd(45)} ${tag}  ${passed}/${total}  ${pct}${failed ? ` (${failed} failed)` : ''}${errored ? ` (${errored} errored)` : ''}${skipped ? ` (${skipped} skipped)` : ''}`);
  }
  log(C.bold(`╚═════════════════════════════════════════════════════════════════════════╝`));
  log(C.dim(`\n  Matrix HTML: ${OUTPUT}`));

  // Clean up.
  await fs.rm(tmpDir, { recursive: true, force: true });

  // Exit code: non-zero if ANY model had a failure (other than the deliberate
  // analyzer-creative-media on coder-tuned 7B). Conservative default: green
  // iff every model is green. Callers wanting laxer semantics can ignore.
  const anyFailed = modelResults.some((m) => m.counts.failed > 0 || m.counts.errored > 0);
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error('matrix runner error:', err);
  process.exit(2);
});
