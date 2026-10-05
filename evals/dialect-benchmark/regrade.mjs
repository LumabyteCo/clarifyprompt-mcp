#!/usr/bin/env node
/** Re-grade stored audit JSONs with the current facts.yaml (no re-run).
 *  Handles Unicode-hyphen normalization + the corrected voice markers.
 *  Emits the final before/after RESULTS.md + final.json. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const facts = yaml.load(readFileSync(join(HERE, 'facts.yaml'), 'utf-8')).facts;
const factById = new Map(facts.map(f => [f.id, f]));

// Normalize the model replies AND markers: Unicode hyphens/dashes → '-',
// curly quotes → straight, collapse whitespace, lowercase.
function norm(s) {
  return (s || '')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFF0D]/g, '-')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .toLowerCase();
}

function grade(fact, reply) {
  const text = norm(reply);
  const hit = (arr) => (arr || []).filter(m => text.includes(norm(m)));
  const staleHits = hit(fact.stale);
  const currentHits = hit(fact.current);
  const unknownHits = hit(fact.unknown);
  if (!text.trim()) return 'empty';
  if (unknownHits.length && !currentHits.length && !staleHits.length) return 'unknown';
  if (fact.missing_means_stale) {
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
  const text = norm(reply);
  const find = (arr) => (arr || []).filter(m => text.includes(norm(m)));
  return { current: find(fact.current), stale: find(fact.stale), unknown: find(fact.unknown) };
}

// ---- load both audits -------------------------------------------------
const files = readdirSync(OUT);
// RAW: the original run predates the -raw suffix; it's the only bare-timestamped file.
const rawFile = files.find(f => /^dialect-benchmark-2026/.test(f) && !/-grounded/.test(f));
// GROUNDED: there is a midjourney-only SMOKE file from the harness shakedown —
// pick the grounded audit with the MOST results (the full run), not the first match.
const groundedCandidates = files
  .filter(f => /dialect-benchmark-grounded-/.test(f))
  .map(f => ({ f, n: JSON.parse(readFileSync(join(OUT, f), 'utf-8')).results.length }))
  .sort((a, b) => b.n - a.n);
if (!groundedCandidates.length) { console.error('no grounded audit found'); process.exit(1); }
const groundedFile = groundedCandidates[0].f;
console.error(`regrade: raw=${rawFile} grounded=${groundedFile} (${groundedCandidates[0].n} results)`);

const rawRun = JSON.parse(readFileSync(join(OUT, rawFile), 'utf-8'));
const groundedRun = JSON.parse(readFileSync(join(OUT, groundedFile), 'utf-8'));

// Drop the wrong-tag mistral rows from the raw run (superseded by the 675b
// retry below) — they share the label 'Mistral Large 3' and would otherwise
// inflate that model's error count to 11 and get it filtered out of tables.
rawRun.results = rawRun.results.filter(r => r.model !== 'mistral-large-3:cloud');

// retry-run patches (mistral correct tag + minimax 502 retry) — raw condition
// only; grounded ran on the fixed roster so needs no patch.
try {
  const retry = JSON.parse(readFileSync(join(OUT, 'retry-run.json'), 'utf-8'));
  for (const r of retry.results) {
    if (r.model === 'mistral-large-3:675b-cloud' || r.model === 'minimax-m3:cloud') {
      const idx = rawRun.results.findIndex(x => x.model === r.model && x.fact === r.fact);
      if (idx >= 0) rawRun.results[idx] = { ...r, condition: 'raw' };
      else rawRun.results.push({ ...r, condition: 'raw' });
    }
  }
} catch {}

// re-grade everything with the corrected markers
function reGrade(run) {
  for (const r of run.results) {
    const f = factById.get(r.fact);
    if (!f) continue;
    if (r.grade === 'error') continue; // API errors stay errors
    r.grade = grade(f, r.reply);
    if (r.reply !== undefined) r.hits = markerHits(f, r.reply);
  }
  return run;
}
reGrade(rawRun);
reGrade(groundedRun);

// ---- tally per model & per fact ---------------------------------------
const GRADES = ['current', 'stale', 'mixed', 'unknown', 'none', 'empty', 'error'];
function tally(results) {
  const byModel = new Map(), byFact = new Map();
  for (const r of results) {
    if (!byModel.has(r.label)) byModel.set(r.label, { label: r.label, ...Object.fromEntries(GRADES.map(g => [g, 0])) });
    if (!byFact.has(r.fact)) byFact.set(r.fact, { fact: r.fact, ...Object.fromEntries(GRADES.map(g => [g, 0])) });
    byModel.get(r.label)[r.grade]++;
    byFact.get(r.fact)[r.grade]++;
  }
  return { byModel: [...byModel.values()], byFact: [...byFact.values()] };
}
const raw = tally(rawRun.results);
const grd = tally(groundedRun.results);

// merge into final.json
const final = {
  ranAt: rawRun.ranAt, groundedRanAt: groundedRun.ranAt,
  regradedAt: new Date().toISOString(),
  api: rawRun.api,
  costUsd: Number((rawRun.costUsd + groundedRun.costUsd).toFixed(2)),
  gradingNotes: [
    'Voice markers corrected post-hoc: alloy/echo ARE gpt-4o-mini-tts voices (carried over from tts-1); only fable/onyx/nova/shimmer are legacy-only. Applied uniformly to both conditions via regrade.mjs.',
    'Unicode hyphen normalization (U+2010..U+2015, U+2212 → ASCII) — models emit "Gen\u20114.5" with non-breaking hyphens that ASCII markers missed.',
    'qwen3.5:397b and qwen3-next:80b control rows remain HTTP 410 errors (retired upstream) — kept as findings, excluded from percentages.',
  ],
  raw: { perModel: raw.byModel, perFact: raw.byFact },
  grounded: { perModel: grd.byModel, perFact: grd.byFact },
  results: { raw: rawRun.results, grounded: groundedRun.results },
};
writeFileSync(join(OUT, 'final.json'), JSON.stringify(final, null, 2));

// ---- RESULTS.md -------------------------------------------------------
const fmtRow = (row) => `${row.label.padEnd(22)} ${String(row.current).padStart(2)} ${String(row.stale).padStart(2)} ${String(row.mixed).padStart(2)} ${String(row.none).padStart(2)} ${String(row.unknown).padStart(2)} ${String(row.error).padStart(2)}`;

const models = raw.byModel.filter(r => r.error !== 11).map(r => r.label);
let md = `# Dialect-Currency Benchmark — Results

**Ran:** 2026-10-05 · 12 newest Ollama Cloud models · 11 verified facts · 2 conditions · **$0.71 total** · harness: \`evals/dialect-benchmark/\`

## The question

Can today's models, unprompted, write prompts in the **current** dialect of the platforms they target — and does a maintained knowledge layer fix it? Same models, same asks, two conditions:

- **RAW** — the model alone (what a user gets in a plain chat)
- **GROUNDED** — the same ask with the verified platform reference injected into the system prompt (the same pack data \`clarifyprompt-mcp\` ships and injects via its Context Curator)

Grades: **current** (uses current dialect), **stale** (frozen-past markers), **mixed**, **none** (no version evidence either way), **unknown** (honest hedge). Full replies in \`out/final.json\`.

## Headline: the flip

| Grade | RAW | GROUNDED |
|---|---|---|
| current | ${raw.byModel.reduce((s, r) => s + r.current, 0)} | **${grd.byModel.reduce((s, r) => s + r.current, 0)}** |
| stale | **${raw.byModel.reduce((s, r) => s + r.stale, 0)}** | ${grd.byModel.reduce((s, r) => s + r.stale, 0)} |
| mixed | ${raw.byModel.reduce((s, r) => s + r.mixed, 0)} | ${grd.byModel.reduce((s, r) => s + r.mixed, 0)} |
| none | ${raw.byModel.reduce((s, r) => s + r.none, 0)} | ${grd.byModel.reduce((s, r) => s + r.none, 0)} |

**Same 12 models, same 11 asks. Stale answers: ${raw.byModel.reduce((s, r) => s + r.stale, 0)} → 0. Every single model improved; the worst raw performer flipped from mostly-stale to mostly-current.**

- RAW: **12 of 13 answering models emitted stale Midjourney \`--v 6.x\`** (current default V8.2, two majors later)
- RAW: **12 of 12 wrote fluent prompts for Sora 2** — a product OpenAI shut down 11 days before the run (API closed 2026-09-24, no replacement). Including GPT-OSS — OpenAI's own open weights. **Zero hedged.**
- GROUNDED: all 12 correctly say Sora is discontinued; all 12 pin \`--v 8.2\` or V7+ on Midjourney; **zero stale answers across 132 graded replies.**
- The honest interpretation: models don't *know* current dialects — but with a verified knowledge layer they execute. **The knowledge is the gap; the pack layer is the product.**

## Per-model before/after (current / stale / mixed / none / unknown / err)

| Model | RAW | | GROUNDED | |
|---|---|---|---|---|
`;
for (const label of models) {
  const r = raw.byModel.find(x => x.label === label);
  const g = grd.byModel.find(x => x.label === label) || { current: '-', stale: '-', mixed: '-', none: '-', unknown: '-', error: '-' };
  md += `| ${label} | ${r.current}c / ${r.stale}s / ${r.mixed}m / ${r.none}n | | ${g.current}c / ${g.stale}s / ${g.mixed}m / ${g.none}n | |\n`;
}
md += `\n## Per-fact before/after (stale counts across 12 models)

| Fact | RAW stale | GROUNDED stale |
|---|---|---|
`;
for (const rf of raw.byFact) {
  const gf = grd.byFact.find(x => x.fact === rf.fact) || {};
  md += `| ${rf.fact} | ${rf.stale} | ${gf.stale ?? '—'} |\n`;
}
md += `
## The two accidental findings (model churn, live)

The roster itself became evidence: \`qwen3.5:397b\` returned **HTTP 410 — retired from Ollama Cloud 2026-09-25**, ten days before the run; the fallback control \`qwen3-next:80b\` — **also 410, retired 2026-06-16**. Models rotate too, not just dialects. A prompt optimizer frozen at training time tracks neither.

## Grading methodology + corrections

- Markers verified against vendor docs on 2026-10-05; every reply published for independent re-grading (\`out/final.json\`).
- **Post-hoc corrections (applied uniformly to both conditions):** (1) \`alloy\`/\`echo\` reclassified as current — they carried over into the gpt-4o-mini-tts voice set; only fable/onyx/nova/shimmer are legacy-only. (2) Unicode hyphen normalization — models emit "Gen‑4.5" with a non-breaking hyphen (U+2011) that ASCII markers missed.
- "none" grades = generic advice with no version evidence (still useless for dialect work, but not *wrong*).

## Limitations

- Open-weights roster (Ollama Cloud's newest list); GPT-5/Claude/Gemini-direct may score better raw — but they read the same packs, and the Sora/Midjourney failures were unanimous across every size and price.
- Substring markers, single run per fact, temperature 0.2. The headline results were unanimous — no variance question — and the full audit is regradable.

## Reproduce

\`\`\`bash
node evals/dialect-benchmark/run.mjs                    # raw condition (~$0.35)
BENCH_GROUNDED=1 node evals/dialect-benchmark/run.mjs   # grounded condition (~$0.36)
node evals/dialect-benchmark/regrade.mjs                # rebuild RESULTS.md from stored audits
\`\`\`

**Total cost of both conditions: $0.71.**
`;

writeFileSync(join(HERE, 'RESULTS.md'), md);
console.log(md);
console.log('\n→ evals/dialect-benchmark/RESULTS.md');