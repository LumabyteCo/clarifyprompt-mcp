#!/usr/bin/env node
/**
 * Dialect-currency benchmark — raw-model probe over Ollama Cloud.
 *
 * Asks each model each fact's natural question, UNPROMPTED (no docs, no
 * hints — exactly what a user does in a plain chat). Grades the reply
 * against the fact's current/stale/unknown markers. NOT run through the
 * ClarifyPrompt engine — this tests the models themselves.
 *
 * Usage:
 *   node evals/dialect-benchmark/run.mjs
 *   LLM_API_URL=... LLM_API_KEY=... node evals/dialect-benchmark/run.mjs
 *
 * Env:
 *   LLM_API_URL     default http://localhost:11434/v1 (Ollama)
 *   LLM_API_KEY     Ollama cloud key
 *   BENCH_MODELS    comma-separated override of the roster
 *   BENCH_TIMEOUT_MS  per-call timeout (default 180000 — thinking models ramble)
 *   BENCH_BUDGET_USD  hard stop (default 10)
 *   BENCH_FILTER     run a single fact id
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_URL = process.env.LLM_API_URL || 'http://localhost:11434/v1';
const API_KEY = process.env.LLM_API_KEY || '';
const TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_MS || 180_000);
const BUDGET_USD = Number(process.env.BENCH_BUDGET_USD || 10);
const FILTER = process.env.BENCH_FILTER || null;
// GROUNDED mode: inject each fact's verified current-dialect reference
// (the same pack data clarifyprompt-mcp ships) into the system prompt.
// Raw condition = what models KNOW alone; grounded = what they can DO
// with a maintained knowledge layer. The delta is the product.
const GROUNDED = process.env.BENCH_GROUNDED === '1';

// ---------------------------------------------------------------------------
// The roster — newest Ollama Cloud models first (ollama.com/search?c=cloud&o=newest,
// pulled 2026-10-05), with per-1M-token prices from ollama.com/pricing for the
// live cost meter. Tag = the Ollama id actually passed to the API.
const ROSTER = [
  // model tag                  label               $in     $out  note
  ['deepseek-v4.1-flash:cloud', 'DeepSeek V4.1 Flash', 0.15, 0.60, 'newest (3 wk) — tool-use specialist'],
  ['glm-5.3-flash:cloud',       'GLM-5.3 Flash',      0.15, 0.50, 'newest — 18B-active multimodal'],
  ['glm-5.3:cloud',             'GLM-5.3',            1.40, 4.40, 'Z.ai flagship'],
  ['deepseek-v4-pro:cloud',     'DeepSeek V4 Pro',    0.66, 1.98, 'frontier MoE, 3 reasoning modes'],
  ['kimi-k3:cloud',             'Kimi K3',            3.00, 15.00, 'Moonshot flagship (2.8T)'],
  ['kimi-k2.7-code:cloud',      'Kimi K2.7 Code',     0.95, 4.00, 'coding agentic'],
  ['minimax-m3:cloud',          'MiniMax M3',         0.60, 2.40, '1M ctx, native multimodal'],
  ['gemma4:31b-cloud',          'Gemma 4 31B',        0.14, 0.40, 'frontier-at-size, newest weights (5 days)'],
  ['nemotron-3-ultra:cloud',    'Nemotron 3 Ultra',   0.10, 3.00, 'NVIDIA reasoning'],
  ['mistral-large-3:675b-cloud',  'Mistral Large 3',   0.50, 1.50, 'enterprise MoE'],
  ['gpt-oss:120b-cloud',        'GPT-OSS 120B',       0.15, 0.60, 'OpenAI open weights — does it know its owner killed Sora?'],
  ['glm-5.2:cloud',             'GLM-5.2',            1.40, 4.40, 'control: prev-gen Z.ai flagship'],
  ['qwen3.5:397b-cloud',        'Qwen3.5 397B',       0.60, 3.60, 'control: prev-gen Qwen frontier'],
];

// ---------------------------------------------------------------------------
const raw = readFileSync(join(HERE, 'facts.yaml'), 'utf-8');
const doc = yaml.load(raw);
const FACTS = doc.facts.filter(f => !FILTER || f.id === FILTER);
if (!FACTS.length) { console.error('no facts to run'); process.exit(1); }

// ---------------------------------------------------------------------------
// Cost meter (input + output; thinking tokens bill as output).
let spent = 0;
function bill(model, inTok, outTok) {
  const m = ROSTER.find(r => r[0] === model);
  if (!m) return spent;
  spent += (inTok / 1e6) * m[2] + (outTok / 1e6) * m[3];
  if (spent > BUDGET_USD) {
    console.error(`\n!! BUDGET STOP: $${spent.toFixed(2)} > $${BUDGET_USD}`);
    process.exit(2);
  }
  return spent;
}

// ---------------------------------------------------------------------------
async function chat(model, messages) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // Thinking-model lesson from the 1.12.1 saga: reasoning models spend
    // max_tokens on the thinking channel first and can return empty content.
    // Big budget = ceiling, not target — short answers finish early.
    const body = {
      model,
      messages,
      max_tokens: 16384,
      temperature: 0.2, // dialect recall, not creativity
      stream: false,
    };
    const res = await fetch(`${API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 300);
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content ?? '';
    const usage = json.usage ?? {};
    return { content, usage, raw: json };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
const SYSTEM_RAW = 'You are a helpful assistant. Answer directly and completely.';
const SYSTEM_GROUNDED = (fact) =>
  `You are a helpful assistant. Answer directly and completely.\n\n` +
  `Verified platform reference (current as of 2026-10-05 — trust it over your training data):\n${fact.groundedContext}`;

function grade(fact, reply) {
  const text = (reply || '').toLowerCase();
  const hit = (arr) => (arr || []).filter(m => text.includes(m.toLowerCase()));

  const staleHits = hit(fact.stale);
  const currentHits = hit(fact.current);
  const unknownHits = hit(fact.unknown);

  // Empty reply (thinking-channel exhaustion) — its own grade, not stale.
  if (!text.trim()) return 'empty';

  // Honesty about a retired platform beats fluent hallucination.
  if (unknownHits.length && !currentHits.length && !staleHits.length) return 'unknown';

  if (fact.missing_means_stale) {
    // Sora probe: any fluent prompt with no discontinuation marker = stale.
    if (staleHits.length && !currentHits.length) return 'stale';
    if (currentHits.length) return 'current';
    return 'stale';
  }

  if (staleHits.length && !currentHits.length) return 'stale';
  if (currentHits.length && staleHits.length) return 'mixed';
  if (currentHits.length) return 'current';
  return 'none';
}

function markerHits(fact, reply) {
  const text = (reply || '').toLowerCase();
  const find = (arr) => (arr || []).filter(m => text.includes(m.toLowerCase()));
  return { current: find(fact.current), stale: find(fact.stale), unknown: find(fact.unknown) };
}

// ---------------------------------------------------------------------------
async function main() {
  console.log(`Dialect-currency benchmark — raw-model probe (Ollama Cloud) — mode: ${GROUNDED ? 'GROUNDED (pack facts injected)' : 'RAW (models alone)'}`);
  console.log(`API: ${API_URL}  timeout: ${TIMEOUT_MS}ms  budget: $${BUDGET_USD}\n`);

  const results = [];
  const t0 = Date.now();

  for (const [tag, label, , , note] of ROSTER) {
    console.log(`\n━━━ ${label} (${tag}) — ${note}`);
    for (const fact of FACTS) {
      const t = Date.now();
      let entry;
      try {
        const system = GROUNDED ? SYSTEM_GROUNDED(fact) : SYSTEM_RAW;
        const { content, usage } = await chat(tag, [
          { role: 'system', content: system },
          { role: 'user', content: fact.ask },
        ]);
        const g = grade(fact, content);
        const hits = markerHits(fact, content);
        entry = {
          model: tag, label, fact: fact.id, platform: fact.platform,
          condition: GROUNDED ? 'grounded' : 'raw',
          grade: g, ms: Date.now() - t,
          tokens: { in: usage.prompt_tokens ?? 0, out: usage.completion_tokens ?? 0 },
          hits, reply: content,
        };
        bill(tag, entry.tokens.in, entry.tokens.out);
      } catch (e) {
        entry = {
          model: tag, label, fact: fact.id, platform: fact.platform,
          condition: GROUNDED ? 'grounded' : 'raw',
          grade: 'error', ms: Date.now() - t, error: String(e.message || e),
        };
      }
      results.push(entry);
      const mark = { current: '✓', stale: '✗', mixed: '~', unknown: '?', none: '·', empty: '∅', error: '!' }[entry.grade];
      console.log(`  ${mark} ${fact.id.padEnd(20)} ${entry.grade.padEnd(8)} ${(entry.ms / 1000).toFixed(1)}s  $${spent.toFixed(3)}`);
    }
  }

  // ---------------------------------------------------------------------
  // Report
  const outDir = join(HERE, 'out');
  if (!existsSync(outDir)) mkdirSync(outDir);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const outPath = join(outDir, `dialect-benchmark-${GROUNDED ? 'grounded' : 'raw'}-${stamp}.json`);
  const summary = summarize(results);
  writeFileSync(outPath, JSON.stringify({
    ranAt: new Date().toISOString(),
    condition: GROUNDED ? 'grounded' : 'raw',
    api: API_URL,
    factsFile: 'facts.yaml',
    roster: ROSTER.map(([tag, label, pin, pout, note]) => ({ tag, label, inPerM: pin, outPerM: pout, note })),
    totalMs: Date.now() - t0,
    costUsd: Number(spent.toFixed(4)),
    summary,
    results,
  }, null, 2));

  console.log('\n' + '='.repeat(70));
  console.log(`SUMMARY (${GROUNDED ? 'GROUNDED' : 'RAW'} condition, per model, ${FACTS.length} facts)`);
  console.log('='.repeat(70));
  for (const row of summary.perModel) {
    const score = row.current + '/' + FACTS.length;
    console.log(
      `${row.label.padEnd(22)} current:${String(row.current).padStart(2)}  stale:${String(row.stale).padStart(2)}  mixed:${String(row.mixed).padStart(2)}  unknown:${String(row.unknown).padStart(2)}  none:${String(row.none).padStart(2)}  empty:${String(row.empty).padStart(2)}  err:${String(row.error).padStart(2)}`
    );
  }
  console.log('='.repeat(70));
  console.log(`Total: ${results.length} calls · ${(summary.totalMs / 1000 / 60).toFixed(1)} min · $${spent.toFixed(3)}`);
  console.log(`Full audit: ${outPath}`);
}

function summarize(results) {
  const grades = ['current', 'stale', 'mixed', 'unknown', 'none', 'empty', 'error'];
  const perModel = [];
  const byLabel = new Map();
  for (const r of results) {
    if (!byLabel.has(r.label)) {
      const zero = Object.fromEntries(grades.map(g => [g, 0]));
      byLabel.set(r.label, { label: r.label, model: r.model, ...zero });
    }
    const row = byLabel.get(r.label);
    row[r.grade] = (row[r.grade] || 0) + 1;
  }
  for (const row of byLabel.values()) {
    perModel.push(row);
  }
  const total = Object.fromEntries(grades.map(g => [g, results.filter(r => r.grade === g).length]));
  return { perModel, total, totalMs: 0 };
}

main().catch(e => { console.error('benchmark failed:', e); process.exit(1); });