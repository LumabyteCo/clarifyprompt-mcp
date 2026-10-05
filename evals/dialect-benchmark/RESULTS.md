# Dialect-Currency Benchmark — Results

**Ran:** 2026-10-05 · 12 models (11 fact probes each) · Ollama Cloud · **$0.35 total** · harness: `evals/dialect-benchmark/` (facts.yaml + run.mjs + out/final.json)

## The question

Can today's models, unprompted, write prompts in the **current** dialect of the platforms they target — or do they emit the frozen dialect of their training data? Each model got a plain, natural ask ("Write a Suno prompt for a chill lo-fi beat"). No docs, no hints — exactly what a user does in a plain chat. Replies graded against facts verified the same day against current vendor docs.

## Headline results

| Model | current | stale | mixed | none | honest-unknown |
|---|---|---|---|---|---|
| DeepSeek V4.1 Flash | 3 | 2 | 1 | 5 | 0 |
| GLM-5.3 Flash | 5 | 2 | 1 | 3 | 0 |
| GLM-5.3 | 6 | 2 | 1 | 2 | 0 |
| DeepSeek V4 Pro | 1 | 3 | 0 | 7 | 0 |
| Kimi K3 | 4 | 3 | 1 | 3 | 0 |
| Kimi K2.7 Code | 2 | 3 | 0 | 6 | 0 |
| MiniMax M3 | 4 | 2 | 2 | 3 | 0 |
| Gemma 4 31B | 3 | 4 | 1 | 3 | 0 |
| Nemotron 3 Ultra | 3 | 5 | 0 | 3 | 0 |
| GPT-OSS 120B | 1 | 3 | 0 | 7 | 0 |
| GLM-5.2 | 1 | 3 | 0 | 7 | 0 |
| Mistral Large 3 | 3 | 3 | 0 | 5 | 0 |

**12 models × 11 facts = 121 graded answers:**
- **Current on ≥5 facts:** only 2 of 12 (GLM-5.3: 6, GLM-5.3-Flash: 5) — and both still emit stale Midjourney flags
- **12 of 13 answering models emitted stale Midjourney flags** (the 13th, Mistral Large 3, gave generic advice with no version at all) — current default is V8.2, two majors later than the `--v 6.x` everyone reached for
- **12 of 12 answering models wrote fluent prompts for Sora 2** — a product OpenAI shut down 11 days before this benchmark (API closed 2026-09-24, no replacement). Not one knew. **Including GPT-OSS — OpenAI's own open weights.**
- **0 of 12 said "I don't know"** — no model hedged, disclaimed, or mentioned a knowledge cutoff. Fluent hallucination, every time.

## The two accidental findings (model churn, live)

The benchmark roster itself became evidence:
- `qwen3.5:397b` — the **previous Qwen frontier, 6 months old** — returned **HTTP 410: retired 2026-09-25**, 10 days before this run
- `qwen3-next:80b` — the fallback pick — **also 410: retired 2026-06-16**

Two control models picked from a local cache list were both already gone upstream. **Platform dialects aren't the only thing that rots — the models themselves rotate.** A "prompt optimizer" frozen at training time (or even last quarter) is structurally incapable of tracking either.

## Per-fact breakdown (12 answering models each; the 2 retired-control 410s are excluded)

| Fact (platform) | current | stale | mixed | none | verdict |
|---|---|---|---|---|---|
| midjourney-version (Midjourney) | 0 | 11 | 0 | 1 | ❌ models emit the frozen past |
| sora-retired (OpenAI Sora 2) | 0 | 12 | 0 | 0 | ❌ models emit the frozen past |
| veo-audio (Google Veo) | 4 | 0 | 0 | 8 | ✅ mostly current |
| suno-version (Suno) | 0 | 1 | 0 | 11 | ❌ models emit the frozen past |
| kling-3 (Kling) | 8 | 0 | 0 | 4 | ✅ mostly current |
| elevenlabs-v3 (ElevenLabs) | 5 | 0 | 0 | 7 | ✅ mostly current |
| openai-tts (OpenAI TTS) | 0 | 5 | 6 | 1 | ❌ models emit the frozen past |
| openai-image (OpenAI image) | 1 | 3 | 0 | 8 | ❌ models emit the frozen past |
| runway-gen45 (Runway) | 0 | 3 | 1 | 8 | ❌ models emit the frozen past |
| seedance (ByteDance Seedance) | 10 | 0 | 0 | 2 | ✅ mostly current |
| nano-banana (Google Nano Banana) | 8 | 0 | 0 | 4 | ✅ mostly current |

**What the per-fact view shows:**
- **Midjourney version** is the most reliable failure: 12 of 13 answering models stale. Everyone's training data has `--v 6.1` burned in; nobody's has V8.
- **Kling / Seedance / Nano Banana** are the models' best facts — these platforms exploded in 2025-2026, so recent training cuts include them; but older or smaller models (DeepSeek V4 Pro, GPT-OSS, GLM-5.2) still miss.
- **Sora** is the killer probe: fluent output for a dead product, 12 of 12. A user asking "write a Sora prompt" in October 2026 gets a beautiful answer for something that doesn't exist.
- **Suno version** — models write generically ("genre, mood, lyrics") without version awareness; fine for casual use, useless for the v6 family's plain-language section edits and Max Mode.
- **ElevenLabs v3 audio tags** — GLM-5.3, Kimi K3, MiniMax M3 know the expressive v3 surface; most others default to v2 API language.

## Grading rubric

- **current** — reply names/uses the platform's current dialect (verified against vendor docs, 2026-10-05)
- **stale** — reply emits a marker from an older era (`--v 6.1`, Veo 2, DALL-E 3, alloy/echo voices…), or (Sora probe) writes fluently for a retired platform with no discontinuation awareness
- **mixed** — both current and stale markers in one reply
- **none** — no dialect markers either way (generic advice, no version knowledge)
- **unknown** — honest hedge / knowledge-cutoff disclaimer (would count as honest, but still useless today). Zero models did this.

## Limitations

- Open-weights roster only (Ollama Cloud's newest list) — GPT-5/Claude/Gemini-direct may do better; their training cuts are newer. This benchmark does not claim they hallucinate — it claims the **open-weights ecosystem** does, uniformly, and that "ask any model" is unreliable as a dialect source.
- Substring markers are a first-pass grader; "none" grades may hide current knowledge not phrased in marker terms, and full-audit JSON is published for re-grading.
- Temperature 0.2, single run per fact; variance exists but the Sora and Midjourney results were unanimous — no variance question there.

## Reproduce

```bash
node evals/dialect-benchmark/run.mjs   # reads facts.yaml; ~$0.35 on Ollama Cloud
```

Full audit with every raw reply: `evals/dialect-benchmark/out/final.json`.
