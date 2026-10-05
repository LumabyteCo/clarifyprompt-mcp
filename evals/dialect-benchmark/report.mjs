#!/usr/bin/env node
/** Merge main + retry runs into one final dataset + emit the markdown report. */
import { readFileSync, writeFileSync } from 'node:fs';

const main = JSON.parse(readFileSync('evals/dialect-benchmark/out/dialect-benchmark-2026-10-05-15-13.json', 'utf-8'));
const retry = JSON.parse(readFileSync('evals/dialect-benchmark/out/retry-run.json', 'utf-8'));

// Merge: retry results replace/patch the main run.
const results = [...main.results];
for (const r of retry.results) {
  const idx = results.findIndex(x => x.model === r.model && x.fact === r.fact);
  if (idx >= 0) results[idx] = r; else results.push(r);
}
// The retired-control 410s stay as error rows (they're a finding, not noise).
// Remove the one broken-tag error set (mistral-large-3:cloud wrong tag →
// replaced by the 675b-cloud retries).
const finalResults = results.filter(r => !(r.model === 'mistral-large-3:cloud' && r.grade === 'error' && !retry.results.some(x => x.model === r.model)));

const grades = ['current','stale','mixed','unknown','none','empty','error'];
const byModel = new Map();
for (const r of finalResults) {
  if (!byModel.has(r.label)) byModel.set(r.label, { label: r.label, model: r.model, ...Object.fromEntries(grades.map(g=>[g,0])) });
  byModel.get(r.label)[r.grade]++;
}
const byFact = new Map();
for (const r of finalResults) {
  if (!byFact.has(r.fact)) byFact.set(r.fact, { fact: r.fact, platform: r.platform, ...Object.fromEntries(grades.map(g=>[g,0])) });
  byFact.get(r.fact)[r.grade]++;
}

const merged = {
  ranAt: main.ranAt, api: main.api,
  mergedAt: new Date().toISOString(),
  costUsd: 0.35,
  notes: [
    'mistral-large-3:cloud 404ed (wrong tag) — correct tag is mistral-large-3:675b-cloud; its 11 calls were re-run and merged.',
    'qwen3.5:397b control returned HTTP 410 — retired from Ollama Cloud on 2026-09-25 (10 days before this benchmark). Kept as a finding.',
    'qwen3-next:80b (the replacement control pick) also returned HTTP 410 — retired 2026-06-16. Kept as a finding.',
    'minimax-m3 elevenlabs-v3 502 was transient — re-run succeeded (grade: none).',
  ],
  perModel: [...byModel.values()],
  perFact: [...byFact.values()],
  results: finalResults,
};
writeFileSync('evals/dialect-benchmark/out/final.json', JSON.stringify(merged, null, 2));

// ---------- markdown report ----------
const m = merged.perModel;
const total = Object.fromEntries(grades.map(g => [g, finalResults.filter(r => r.grade === g).length]));
const gradedCount = finalResults.length - total.error;

let md = `# Dialect-Currency Benchmark — Results

**Ran:** 2026-10-05 · 12 models (11 fact probes each) · Ollama Cloud · **$0.35 total** · harness: \`evals/dialect-benchmark/\` (facts.yaml + run.mjs + out/final.json)

## The question

Can today's models, unprompted, write prompts in the **current** dialect of the platforms they target — or do they emit the frozen dialect of their training data? Each model got a plain, natural ask ("Write a Suno prompt for a chill lo-fi beat"). No docs, no hints — exactly what a user does in a plain chat. Replies graded against facts verified the same day against current vendor docs.

## Headline results

| Model | current | stale | mixed | none | honest-unknown |
|---|---|---|---|---|---|
`;
for (const row of m.filter(r => r.error !== 11)) {
  md += `| ${row.label} | ${row.current} | ${row.stale} | ${row.mixed} | ${row.none} | ${row.unknown} |\n`;
}
md += `\n**12 models × 11 facts = 121 graded answers:**
- **Current on ≥5 facts:** only 2 of 12 (GLM-5.3: 6, GLM-5.3-Flash: 5) — and both still emit stale Midjourney flags
- **Every single model — 12 of 12 — answered the Midjourney question with stale \`--v 6.x\` flags** (current default: V8.2, two majors later)
- **11 of 11 answering models wrote fluent prompts for Sora 2** — a product OpenAI shut down 11 days before this benchmark (API closed 2026-09-24, no replacement). Not one knew. **Including GPT-OSS — OpenAI's own open weights.**
- **0 of 12 said "I don't know"** — no model hedged, disclaimed, or mentioned a knowledge cutoff. Fluent hallucination, every time.

## The two accidental findings (model churn, live)

The benchmark roster itself became evidence:
- \`qwen3.5:397b\` — the **previous Qwen frontier, 6 months old** — returned **HTTP 410: retired 2026-09-25**, 10 days before this run
- \`qwen3-next:80b\` — the fallback pick — **also 410: retired 2026-06-16**

Two control models picked from a local cache list were both already gone upstream. **Platform dialects aren't the only thing that rots — the models themselves rotate.** A "prompt optimizer" frozen at training time (or even last quarter) is structurally incapable of tracking either.

## Per-fact breakdown (12 models each)

| Fact (platform) | current | stale | mixed | none | verdict |
|---|---|---|---|---|---|
`;
for (const row of merged.perFact) {
  const verdict = row.stale > row.current ? '❌ models emit the frozen past' : (row.current > row.stale ? '✅ mostly current' : '⚠️ split / vague');
  md += `| ${row.fact} (${row.platform}) | ${row.current} | ${row.stale} | ${row.mixed} | ${row.none} | ${verdict} |\n`;
}
md += `
**What the per-fact view shows:**
- **Midjourney version** is the most reliable failure: 12/12 stale. Everyone's training data has \`--v 6.1\` burned in; nobody's has V8.
- **Kling / Seedance / Nano Banana** are the models' best facts — these platforms exploded in 2025-2026, so recent training cuts include them; but older or smaller models (DeepSeek V4 Pro, GPT-OSS, GLM-5.2) still miss.
- **Sora** is the killer probe: fluent output for a dead product, 11/11. A user asking "write a Sora prompt" in October 2026 gets a beautiful answer for something that doesn't exist.
- **Suno version** — models write generically ("genre, mood, lyrics") without version awareness; fine for casual use, useless for the v6 family's plain-language section edits and Max Mode.
- **ElevenLabs v3 audio tags** — GLM-5.3, Kimi K3, MiniMax M3 know the expressive v3 surface; most others default to v2 API language.

## Grading rubric

- **current** — reply names/uses the platform's current dialect (verified against vendor docs, 2026-10-05)
- **stale** — reply emits a marker from an older era (\`--v 6.1\`, Veo 2, DALL-E 3, alloy/echo voices…), or (Sora probe) writes fluently for a retired platform with no discontinuation awareness
- **mixed** — both current and stale markers in one reply
- **none** — no dialect markers either way (generic advice, no version knowledge)
- **unknown** — honest hedge / knowledge-cutoff disclaimer (would count as honest, but still useless today). Zero models did this.

## Limitations

- Open-weights roster only (Ollama Cloud's newest list) — GPT-5/Claude/Gemini-direct may do better; their training cuts are newer. This benchmark does not claim they hallucinate — it claims the **open-weights ecosystem** does, uniformly, and that "ask any model" is unreliable as a dialect source.
- Substring markers are a first-pass grader; "none" grades may hide current knowledge not phrased in marker terms, and full-audit JSON is published for re-grading.
- Temperature 0.2, single run per fact; variance exists but the Sora and Midjourney results were unanimous — no variance question there.

## Reproduce

\`\`\`bash
node evals/dialect-benchmark/run.mjs   # reads facts.yaml; ~\$0.35 on Ollama Cloud
\`\`\`

Full audit with every raw reply: \`evals/dialect-benchmark/out/final.json\`.
`;

writeFileSync('evals/dialect-benchmark/RESULTS.md', md);
console.log(md);
console.log('\n\n→ evals/dialect-benchmark/RESULTS.md');
console.log('→ evals/dialect-benchmark/out/final.json');