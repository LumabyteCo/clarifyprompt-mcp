# Dialect-Currency Benchmark — Results

**Ran:** 2026-10-05 · 12 newest Ollama Cloud models · 11 verified facts · 2 conditions · **$0.71 total** · harness: `evals/dialect-benchmark/`

## The question

Can today's models, unprompted, write prompts in the **current** dialect of the platforms they target — and does a maintained knowledge layer fix it? Same models, same asks, two conditions:

- **RAW** — the model alone (what a user gets in a plain chat)
- **GROUNDED** — the same ask with the verified platform reference injected into the system prompt (the same pack data `clarifyprompt-mcp` ships and injects via its Context Curator)

Grades: **current** (uses current dialect), **stale** (frozen-past markers), **mixed**, **none** (no version evidence either way), **unknown** (honest hedge). Full replies in `out/final.json`.

## Headline: the flip

| Grade | RAW | GROUNDED |
|---|---|---|
| current | 36 | **117** |
| stale | **35** | 0 |
| mixed | 7 | 1 |
| none | 54 | 14 |

**Same 12 models, same 11 asks. Stale answers: 35 → 0. Every single model improved; the worst raw performer flipped from mostly-stale to mostly-current.**

- RAW: **12 of 13 answering models emitted stale Midjourney `--v 6.x`** (current default V8.2, two majors later)
- RAW: **12 of 12 wrote fluent prompts for Sora 2** — a product OpenAI shut down 11 days before the run (API closed 2026-09-24, no replacement). Including GPT-OSS — OpenAI's own open weights. **Zero hedged.**
- GROUNDED: all 12 correctly say Sora is discontinued; all 12 pin `--v 8.2` or V7+ on Midjourney; **zero stale answers across 132 graded replies.**
- The honest interpretation: models don't *know* current dialects — but with a verified knowledge layer they execute. **The knowledge is the gap; the pack layer is the product.**

## Per-model before/after (current / stale / mixed / none / unknown / err)

| Model | RAW | | GROUNDED | |
|---|---|---|---|---|
| DeepSeek V4.1 Flash | 3c / 2s / 1m / 5n | | 11c / 0s / 0m / 0n | |
| GLM-5.3 Flash | 5c / 2s / 1m / 3n | | 10c / 0s / 1m / 0n | |
| GLM-5.3 | 6c / 2s / 1m / 2n | | 11c / 0s / 0m / 0n | |
| DeepSeek V4 Pro | 1c / 3s / 0m / 7n | | 6c / 0s / 0m / 5n | |
| Kimi K3 | 4c / 3s / 1m / 3n | | 11c / 0s / 0m / 0n | |
| Kimi K2.7 Code | 2c / 3s / 0m / 6n | | 9c / 0s / 0m / 2n | |
| MiniMax M3 | 4c / 2s / 2m / 3n | | 11c / 0s / 0m / 0n | |
| Gemma 4 31B | 3c / 4s / 1m / 3n | | 10c / 0s / 0m / 1n | |
| Nemotron 3 Ultra | 3c / 5s / 0m / 3n | | 8c / 0s / 0m / 3n | |
| GPT-OSS 120B | 1c / 3s / 0m / 7n | | 10c / 0s / 0m / 1n | |
| GLM-5.2 | 1c / 3s / 0m / 7n | | 9c / 0s / 0m / 2n | |
| Mistral Large 3 | 3c / 3s / 0m / 5n | | 11c / 0s / 0m / 0n | |

## Per-fact before/after (stale counts across 12 models)

| Fact | RAW stale | GROUNDED stale |
|---|---|---|
| midjourney-version | 11 | 0 |
| sora-retired | 12 | 0 |
| veo-audio | 0 | 0 |
| suno-version | 1 | 0 |
| kling-3 | 0 | 0 |
| elevenlabs-v3 | 0 | 0 |
| openai-tts | 5 | 0 |
| openai-image | 3 | 0 |
| runway-gen45 | 3 | 0 |
| seedance | 0 | 0 |
| nano-banana | 0 | 0 |

## The two accidental findings (model churn, live)

The roster itself became evidence: `qwen3.5:397b` returned **HTTP 410 — retired from Ollama Cloud 2026-09-25**, ten days before the run; the fallback control `qwen3-next:80b` — **also 410, retired 2026-06-16**. Models rotate too, not just dialects. A prompt optimizer frozen at training time tracks neither.

## Grading methodology + corrections

- Markers verified against vendor docs on 2026-10-05; every reply published for independent re-grading (`out/final.json`).
- **Post-hoc corrections (applied uniformly to both conditions):** (1) `alloy`/`echo` reclassified as current — they carried over into the gpt-4o-mini-tts voice set; only fable/onyx/nova/shimmer are legacy-only. (2) Unicode hyphen normalization — models emit "Gen‑4.5" with a non-breaking hyphen (U+2011) that ASCII markers missed.
- "none" grades = generic advice with no version evidence (still useless for dialect work, but not *wrong*).

## Limitations

- Open-weights roster (Ollama Cloud's newest list); GPT-5/Claude/Gemini-direct may score better raw — but they read the same packs, and the Sora/Midjourney failures were unanimous across every size and price.
- Substring markers, single run per fact, temperature 0.2. The headline results were unanimous — no variance question — and the full audit is regradable.

## Reproduce

```bash
node evals/dialect-benchmark/run.mjs                    # raw condition (~$0.35)
BENCH_GROUNDED=1 node evals/dialect-benchmark/run.mjs   # grounded condition (~$0.36)
node evals/dialect-benchmark/regrade.mjs                # rebuild RESULTS.md from stored audits
```

**Total cost of both conditions: $0.71.**
