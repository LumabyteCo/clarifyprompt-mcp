# ClarifyPrompt MCP

[![npm version](https://img.shields.io/npm/v/clarifyprompt-mcp.svg)](https://www.npmjs.com/package/clarifyprompt-mcp)
[![evals](https://github.com/LumabyteCo/clarifyprompt-mcp/actions/workflows/evals.yml/badge.svg?branch=main)](https://github.com/LumabyteCo/clarifyprompt-mcp/actions/workflows/evals.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
<a href="https://glama.ai/mcp/servers/LumabyteCo/clarifyprompt-mcp"><img width="380" height="200" src="https://glama.ai/mcp/servers/LumabyteCo/clarifyprompt-mcp/badge" alt="ClarifyPrompt MCP server" /></a>

A **context-aware MCP prompt compiler** that transforms vague prompts into platform-optimized prompts for 58+ AI platforms across 7 categories — grounded in your workspace signals (CLAUDE.md, AGENTS.md, .cursorrules, package.json), resolved intent, and the capabilities of the target model.

Send a raw prompt. ClarifyPrompt gathers the right context, resolves what you're actually trying to do, and returns a version specifically optimized for Midjourney, DALL-E, Sora, Runway, ElevenLabs, Claude, ChatGPT, Cursor, or any of the 58+ supported platforms — with the right syntax, parameters, structure, and grounding.

> **New in 1.5.2:** First eval-gate-driven release. CI now runs `npm run eval` against `gpt-4o-mini` on every push (when `OPENAI_API_KEY` is configured as a repo secret), and the live runs surfaced four real issues — three of which were latent bugs no one had hit because the default Ollama setup happens to side-step them. The headline fix: **the persistent memory store now supports any embedding dimension** (was hardcoded to 768 / nomic-embed-text). [#2](https://github.com/LumabyteCo/clarifyprompt-mcp/issues/2). Plus `LLM_TIMEOUT_MS` env override + harness hardening. See [CHANGELOG.md](./CHANGELOG.md).

## How It Works

```
You write:    "a dragon flying over a castle at sunset"

ClarifyPrompt returns (for Midjourney):
  "a majestic dragon flying over a medieval castle at sunset
   --ar 16:9 --v 6.1 --style raw --q 2 --chaos 30 --s 700"

ClarifyPrompt returns (for DALL-E):
  "A majestic dragon flying over a castle at sunset. Size: 1024x1024"
```

Same prompt, different platform, completely different output. ClarifyPrompt knows what each platform expects — and in 1.2.0, it also knows *what you're working on*.

## What's new in 1.5.2

The first release where CI's eval gate (against `gpt-4o-mini`) drove the diff. Three real fixes that the gate caught the moment we wired in the `OPENAI_API_KEY` secret:

- **Memory store now supports any embedding dimension** ([#2](https://github.com/LumabyteCo/clarifyprompt-mcp/issues/2)). The persistent vec table was hardcoded to 768 dims (the nomic-embed-text default), so anyone configuring `EMBED_MODEL=text-embedding-3-small` (1536), `voyage-3` (1024), `embed-english-v3.0` (1024), or any non-768 model would hit `Dimension mismatch: expected 768, got N` on the first `memory_search` call. The store now derives the table name from the embedder's actual dimension and creates the dim-specific table at boot. Existing 768-dim installs are unaffected.
- **`LLM_TIMEOUT_MS` env-var override** on the LLM client. Default stays at 30s; users on slow hosted models can bump it. The eval workflow uses 120s for `gpt-4o-mini`.
- **Eval harness hardened** — no longer crashes when a tool throws an exception (the SDK returns plain-text error responses; the harness used to `JSON.parse` them and die). One bad fixture no longer tanks the whole run.
- **Live evals badge.** The `evals.yml` workflow runs on every push to main. The `[![evals]](...)` badge at the top of this README is its real-time status. Currently green at 20/0/3 · 100% on `gpt-4o-mini`.

No new MCP tools. No env-var surface changes (only an added optional `LLM_TIMEOUT_MS`). Fully back-compat with 1.5.x.

## What's new in 1.5.1

A patch release on top of 1.5.0. Pure docs + ship-process improvements; **runtime behavior is identical to 1.5.0**.

- **README marketing surfaces refreshed** — the 1.5.0 release shipped with the README still on 1.4.0 in three places (headline blockquote, "What's new in X" heading, "cumulative through X" annotation). Every other version surface (`package.json`, `package-lock.json`, `server.json`, `src/index.ts`, `CHANGELOG`) was correct, but the prose drifted because nothing automated touched it. 1.5.1 fixes that.
- **Two new ship-check audits** — `CP-11` (README marketing-surface coherence) hard-fails if any of the three above don't reference the current `package.json#version`. `CP-12` (Platform-pack format validity) parses every `packs/platforms/*.yaml` and asserts schema validity. CP-11 was promoted to the user-scoped (cross-project) ship-check skill the same day, so future projects benefit too.
- **No code changes.** No new MCP tools. No new env vars. Same tarball anatomy as 1.5.0 plus a few hundred bytes of CHANGELOG.

## What's new in 1.5.0

**Built-in platforms become declarative.** The 58+ hardcoded TypeScript platform arrays move to `packs/platforms/*.yaml` — adding a built-in platform is now a YAML edit, not a TS edit. The TypeScript layer becomes a runtime loader with a hardcoded fallback table. Malformed YAML can never soft-brick the server.

```
packs/platforms/
  chat.yaml       9 platforms
  code.yaml       9
  document.yaml   8
  image.yaml     10
  music.yaml      4
  video.yaml     11
  voice.yaml      7
  README.md      contributor docs
```

To add a new built-in platform: append an entry to the relevant category file, run `npm run build`, open a PR. No TS edit required. Custom-platform-via-runtime (`register_platform`) still works identically for user-installed platforms.

- **Memory-layer eval coverage.** The eval harness now supports `setup: [{tool, args}, ...]` — a list of MCP tool calls executed BEFORE the main `input`. Two new fixtures use it: one loads a knowledge pack inline and verifies the chunk surfaces in `grounding.sources` after the embed → store → retrieve → curate → ground pipeline; the other proves vector-search ranking quality. **23 fixtures total** (was 20 in 1.4.0).
- **Test infrastructure modernization.** The integration + Day-2 test batteries used to assert literal version strings (`1.3.0`, `16 tools`) and broke on every bump. Now they read `EXPECTED_VERSION` from `package.json` and assert presence of a tool *set* rather than a tool *count*. Future bumps don't break the tests.
- **Adoption materials.** `docs/adoption/` ships with copy/paste-ready Show HN body, Reddit posts, Twitter thread, awesome-mcp-servers PR template, and catalog submission specs (mcp.so, Smithery, mcp-get, PulseMCP, modelcontextprotocol/servers).
- **One new runtime dep:** `js-yaml` promoted from devDependency for the platform loader (~200 KB).
- **Same MCP tool surface as 1.4.** 20 tools, 1 resource. No new tools; no removed tools; result shapes unchanged.

## Previously in 1.4.0 — the composable pipeline

Four core operations as first-class MCP tools that compose. Use any tool standalone, or run the whole chain in one call:

```
  ┌─────────────┐     ┌─────────────────────┐     ┌──────────────┐
  │  clarify    │ →   │  ground OR optimize │ →   │   critique   │
  │  (optional) │     │       (core)        │     │  (optional)  │
  └─────────────┘     └─────────────────────┘     └──────────────┘

  one call = compose_prompt(prompt, [sources], post_critique, auto_revise, ...)
```

- **`clarify_with_user`** — Given an ambiguous draft, returns 1–3 targeted clarifying questions, each with a `suggested_answer` you can accept verbatim, optional 2–4 quick-pick `options`, and a `dimension` tag (audience/scope/format/length/tone/constraints/goal/platform). Short-circuits with `clarificationNeeded: false` on confident, well-formed prompts so it pipelines cleanly in front of `optimize_prompt` without a per-call latency tax.
- **`ground_prompt`** — The strict, retrieval-augmented variant of `optimize_prompt`. Caller-provided sources are pinned at the **highest** priority — above project rules, above pinned instructions — and tracked individually in the trace as `user-source:N`. Strict mode: zero non-empty sources → error, no silent fall-through. Per-source body cap (4000 chars) so a single huge paste can't dominate the budget.
- **`critique_prompt`** — LLM-as-judge. Scores a candidate prompt 0–10 across 5 default dimensions (clarity, specificity, intent_alignment, format_fitness, length_appropriateness) — or your own criteria — with per-dimension rationale + concrete suggestions, an overall score, and a verdict (`accept` / `revise` / `reject`). Below `revise_threshold` (default 7.0) it also returns an `improvedPrompt` you can drop in. Use it pre-flight ("is this prompt good enough for the expensive model?"), postmortem ("was the prompt the cause?"), or to A/B-pick the best of N optimization variants.
- **`compose_prompt`** — One MCP call runs the canonical pipeline. Auto-decides the ground vs. optimize branch from whether you passed `sources`. `pre_clarify: 'auto' | 'always' | 'never'`. `post_critique: true` adds a judge pass. `auto_revise: true` replaces `final_prompt` with the rewrite when the verdict isn't `accept`. Returns a per-stage `stages` audit array so the caller sees exactly what ran.
- **Eval harness v0** — Deterministic regression tests under `evals/`. 20 YAML fixtures cover analyzer, shape, intent-overlay, grounding, clarify, critique, ground, and compose surfaces. `npm run eval` produces a console summary + self-contained dark-themed HTML report. Multi-model matrix is just bash: run `LLM_MODEL=... npm run eval -- --report-path evals/report-X.html` per model.
- **CI-gated evals (opt-in)** — When `OPENAI_API_KEY` is set as a repo secret, the eval harness runs in CI against `gpt-4o-mini` as a release gate. Off by default; nothing leaves your machine without the secret.
- **5 new MCP tools** (20 total). `optimize_prompt` also gains a `userProvidedSources` injection point — both `ground_prompt` and `compose_prompt` use it under the hood, but it's available directly if you want explicit control without the strict-mode validation.

> Carried over from 1.3: persistent memory + knowledge packs + reflective learning. The curator continues to score and fit grounding sources into the target model's remaining window. `explain_last_curation` still gives you a per-call breakdown of selected vs. rejected candidates with reasons.

## What's in the box (cumulative through 1.5.2)

- **Context Engine** — auto-gathers workspace rules (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.clinerules`, `clarify.md`), detects frameworks and languages from `package.json` and sibling manifests, tracks an active file excerpt, and maintains a per-session ring buffer of recent optimizations **and their outcomes**.
- **Unified `PromptAnalyzer`** — one LLM call produces `{ category, intent, recommendedMode, confidence }` together. 10 intents: `production-code`, `brand-voice`, `stakeholder-comm`, `data-extract`, `creative-media`, `technical-spec`, `analysis`, `quick-draft`, `exploration`, `unknown`. Intent beats surface keywords on ambiguity.
- **Target-model-aware prompt shaping** — system prompt, `maxTokens`, and `temperature` adapt to the downstream LLM's context window and the resolved intent. Small local models get a compact prompt; Claude/GPT-4/Gemini get the full richness.
- **Grounding Context (single, priority-ordered)** — user pinned instructions → project rules → active file → prior accepted examples → web search → workspace metadata → target-model hints → custom platform instructions → built-in syntax hints. No more parallel context silos.
- **Session retrieval (save_outcome)** — the caller reports `accepted | edited | rejected` per optimization; similar accepted outputs in the same session get injected as few-shot examples into future similar prompts. Persistent memory lands in 1.3.
- **Local JSONL tracing** — every optimization writes a structured trace line (now with `shape`, `groundingSources`, `error` fields) to `$CLARIFYPROMPT_HOME/traces/YYYY-MM-DD.jsonl`. **Nothing is uploaded.** Toggle via `CLARIFYPROMPT_TRACE=off`.
- **Unified `$CLARIFYPROMPT_HOME`** — one env var for everything ClarifyPrompt writes. Legacy `CLARIFYPROMPT_CONFIG_DIR` / `CLARIFYPROMPT_DATA_DIR` still work (deprecation hint, silenceable).
- **58+ platforms, 7 categories, custom platforms** — the original core is unchanged and fully backward-compatible.
- **Any LLM, any provider.** One code path works with **any OpenAI-compatible API** — Ollama (local + cloud), LM Studio, vLLM, OpenAI, Google Gemini, xAI Grok, Groq, Mistral, DeepSeek, Cohere, Perplexity, Together, Fireworks, OpenRouter — plus **Anthropic Claude** directly. Reasoning models (`o1/o3/o4`, `deepseek-reasoner`, `gpt-oss`, `*-thinking`) are auto-detected and given a larger token budget so they actually produce content. [See 15+ pre-configured provider examples below](#provider-examples).
- **Apache-2.0, forever.** Open-source core, no relicensing.

## Quick Start

### With Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "clarifyprompt": {
      "command": "npx",
      "args": ["-y", "clarifyprompt-mcp"],
      "env": {
        "LLM_API_URL": "http://localhost:11434/v1",
        "LLM_MODEL": "qwen2.5:7b"
      }
    }
  }
}
```

### With Claude Code

```bash
claude mcp add clarifyprompt -- npx -y clarifyprompt-mcp
```

Set the environment variables in your shell before launching:

```bash
export LLM_API_URL=http://localhost:11434/v1
export LLM_MODEL=qwen2.5:7b
```

### With Cursor

Add to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "clarifyprompt": {
      "command": "npx",
      "args": ["-y", "clarifyprompt-mcp"],
      "env": {
        "LLM_API_URL": "http://localhost:11434/v1",
        "LLM_MODEL": "qwen2.5:7b"
      }
    }
  }
}
```

### With AI Butler

[AI Butler](https://github.com/LumabyteCo/aibutler) is a self-hosted
personal AI agent runtime — single Go binary, multi-channel chat, MCP
ecosystem hub. Drop ClarifyPrompt into its `mcp.servers` config and
the agent picks up all 11 tools as native capabilities, callable from
any channel (web chat, terminal, Telegram, Slack, etc.).

Edit `~/.aibutler/config.yaml`:

```yaml
configurations:
  mcp:
    servers:
      - name: clarifyprompt
        command: clarifyprompt-mcp
        env:
          LLM_API_URL: "http://localhost:11434/v1"
          LLM_MODEL: "qwen3-vl:8b"
```

Restart AI Butler. The boot log confirms all 11 tools are wired in:

![AI Butler boot log: mcp: connected to clarifyprompt (11 tools), 1/1 servers connected, then "Ready. Press Ctrl+C to stop." Verified live integration.](docs/screenshots/aibutler/01-boot-log.png)

The agent enumerates the full surface on request — every tool prefixed
with `clarifyprompt.`:

![AI Butler webchat showing the agent listing all 11 clarifyprompt tools (optimize_prompt, inspect_context, list_categories, list_platforms, list_modes, register_platform, update_platform, unregister_platform, list_traces, get_trace, save_outcome) with one-line descriptions](docs/screenshots/aibutler/02-tool-listing.png)

#### Drive the Context Engine end-to-end

You can preview what the engine *would* gather (without running the
optimization) using `inspect_context`:

![Context Engine preview — analyzer output (Category=code, Intent=production-code, Recommended Mode=detailed, Confidence=Medium), session history, and the priority-ordered grounding stack the engine would merge into the system prompt. Closing takeaway about a language mismatch the engine detected between workspace (JS) and prompt (TypeScript).](docs/screenshots/aibutler/03-inspect-context.png)

Then run the actual optimizer for any of the 58+ supported platforms:

![optimize_prompt response — Midjourney-shaped optimized prompt for "a dragon flying over a castle at sunset" with --ar 16:9 and --v 6 parameters, plus the analysis section showing Resolved Intent="creative-media", Mode Source, and the grounding sources used](docs/screenshots/aibutler/04-optimize-image.png)

Every optimization gets a single JSONL line in
`~/.clarifyprompt/traces/YYYY-MM-DD.jsonl` — strictly local, never
uploaded. The `list_traces` tool turns that into a queryable summary
with replay support via `get_trace`:

![list_traces table — trace ID, intent, input preview, platform, latency for recent optimizations. Below the table: a 3-point explanation of what tracing gives — privacy (local-only), observability (every optimization recorded), replay (use trace ID + get_trace to re-fetch the full system prompt)](docs/screenshots/aibutler/05-list-traces.png)

The full integration walkthrough — including all 11 tools driven from
chat, configuration options, and natural-language usage examples —
is in the AI Butler docs:
**[Integrate an MCP Server](https://docs.aibutler.dev/ecosystem/integrate-mcp/)**.

## Supported Platforms (58+ built-in, unlimited custom)

| Category | Platforms | Default |
|----------|-----------|---------|
| **Image** (10) | Midjourney, DALL-E 3, Stable Diffusion, Flux, Ideogram, Leonardo AI, Adobe Firefly, Grok Aurora, Google Imagen 3, Recraft | Midjourney |
| **Video** (11) | Sora, Runway Gen-3, Pika Labs, Kling AI, Luma, Minimax/Hailuo, Google Veo 2, Wan, HeyGen, Synthesia, CogVideoX | Runway |
| **Chat** (9) | Claude, ChatGPT, Gemini, Llama, DeepSeek, Qwen, Kimi, GLM, Minimax | Claude |
| **Code** (9) | Claude, ChatGPT, Cursor, GitHub Copilot, Windsurf, DeepSeek Coder, Qwen Coder, Codestral, Gemini | Claude |
| **Document** (8) | Claude, ChatGPT, Gemini, Jasper, Copy.ai, Notion AI, Grammarly, Writesonic | Claude |
| **Voice** (7) | ElevenLabs, OpenAI TTS, Fish Audio, Sesame, Google TTS, PlayHT, Kokoro | ElevenLabs |
| **Music** (4) | Suno AI, Udio, Stable Audio, MusicGen | Suno |

## Tools

### `optimize_prompt`

The main tool. Optimizes a prompt for a specific AI platform.

```json
{
  "prompt": "a cat sitting on a windowsill",
  "category": "image",
  "platform": "midjourney",
  "mode": "concise"
}
```

**All parameters except `prompt` are optional.** When `category` and `platform` are omitted, ClarifyPrompt auto-detects them from the prompt content.

Three calling modes:

| Mode | Example |
|------|---------|
| **Zero-config** | `{ "prompt": "sunset over mountains" }` |
| **Category only** | `{ "prompt": "...", "category": "image" }` |
| **Fully explicit** | `{ "prompt": "...", "category": "image", "platform": "dall-e" }` |

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `prompt` | Yes | The prompt to optimize |
| `category` | No | `chat`, `image`, `video`, `voice`, `music`, `code`, `document`. Auto-detected when omitted. |
| `platform` | No | Platform ID (e.g. `midjourney`, `dall-e`, `sora`, `claude`). Uses category default when omitted. |
| `mode` | No | Output style: `concise`, `detailed`, `structured`, `step-by-step`, `bullet-points`, `technical`, `simple`. Default: `detailed`. |
| `enrich_context` | No | Set `true` to use web search for context enrichment. Default: `false`. |
| `session_id` | No | Stitches related optimizations together so session memory can bias subsequent calls. Auto-generated when omitted. |
| `file_path` | No | Active file path — infers language and shapes platform hints. |
| `file_language` | No | Explicit language override for the active file. |
| `file_excerpt` | No | Short excerpt (≤2 KB) of the active file to ground the rewrite. |
| `cwd` | No | Working directory to scan for `CLAUDE.md` / `AGENTS.md` / `.cursorrules` / `package.json`. Defaults to server cwd. |
| `user_locale` | No | Locale hint (e.g. `en-US`, `ar-EG`) to inform tone and language. |
| `user_pinned_instructions` | No | Pinned, always-applied user instructions (short core-memory block). |
| `include_bundle` | No | Include the resolved ContextBundle summary in the response. Default: `false`. |
| `skip_intent_resolution` | No | Skip the intent classifier LLM call (faster; loses intent signal). Default: `false`. |

**Response (1.2.0):**

```json
{
  "id": "opt_mo9vlg9i_foohjx",
  "sessionId": "sess_mo9vlfn3_abc123",
  "originalPrompt": "a dragon flying over a castle at sunset",
  "optimizedPrompt": "a majestic dragon flying over a medieval castle at sunset --ar 16:9 --v 6.1 --style raw --q 2 --s 700",
  "category": "image",
  "platform": "midjourney",
  "mode": "concise",
  "modeSource": "analyzer",
  "analysis": {
    "category": "image",
    "intent": "creative-media",
    "recommendedMode": "detailed",
    "confidence": "high",
    "source": "llm"
  },
  "grounding": {
    "sources": ["project-rules", "workspace-meta", "target-model", "platform-hints"],
    "acceptedExamplesUsed": 0
  },
  "shape": {
    "systemPromptBudget": "standard",
    "maxTokens": 2048,
    "temperature": 0.9
  },
  "metadata": {
    "model": "qwen2.5:14b-instruct-q4_K_M",
    "processingTimeMs": 3911,
    "strategy": "ImageStrategy"
  },
  "detection": { "autoDetected": true, "detectedCategory": "image", "detectedPlatform": "midjourney", "confidence": "high" },
  "intent": { "detected": "creative-media", "confidence": "high" }
}
```

The canonical classification field is `analysis`. The `detection` and `intent` fields are **deprecated aliases** kept for 1.x back-compat; they will be removed in 2.x.

`modeSource` tells you how the final mode was decided (`user` if you passed one, `analyzer` if intent-driven, `default` if neither).

`grounding.sources` lists which Grounding Context sections contributed, in priority order. `grounding.acceptedExamplesUsed` tells you how many few-shot examples the engine pulled from `save_outcome` history.

`shape` tells you how the system prompt was sized for your target model.

### `clarify_with_user` *(new in 1.4.0)*

Given an ambiguous draft prompt, returns 1–3 targeted clarifying questions instead of guessing. Use it as a pre-stage before `optimize_prompt` when you can't tell whether the user's request will produce a good rewrite.

```json
{
  "prompt": "make it better",
  "force": true
}
```

**Response:**

```json
{
  "clarificationNeeded": true,
  "reason": "Clarification recommended (analyzer confidence=low; intent=unknown; prompt is short (12 chars); caller passed force=true).",
  "questions": [
    {
      "question": "What outcome do you want from this prompt — what does success look like?",
      "reasoning": "The draft is ambiguous on the goal/audience dimension; pinning this typically resolves most downstream ambiguity.",
      "suggestedAnswer": "Make the email shorter, clearer, and more action-oriented.",
      "options": ["Make it shorter", "Make it more formal", "Make it more persuasive"],
      "dimension": "goal"
    }
  ],
  "analysis": { "category": "chat", "intent": "unknown", "confidence": "low" }
}
```

`suggestedAnswer` is always populated — the caller can accept it verbatim and keep moving. `options` is optional; UI clients can render it as quick-pick buttons. The `dimension` tag classifies which axis the question addresses.

**Short-circuit:** when the analyzer's confidence is `high` AND the prompt is non-trivially long, the tool returns `clarificationNeeded: false` with no LLM call beyond the analyzer — so you can pipeline it in front of `optimize_prompt` without a latency tax on every call. Pass `force: true` to disable the short-circuit.

### `ground_prompt` *(new in 1.4.0)*

Strict, retrieval-augmented variant of `optimize_prompt`. Caller-provided sources are **pinned at the highest priority** — above project rules and pinned instructions — so the rewrite is grounded in the material you provided rather than whatever the curator decides is relevant.

```json
{
  "prompt": "rewrite the launch announcement to match our voice",
  "category": "document",
  "platform": "claude",
  "sources": [
    {
      "label": "Brand Voice Rules",
      "body": "Tone: warm, plain-spoken, no jargon. Always lead with the user benefit. Avoid 'leverage', 'synergy', 'robust'. Max sentence length: 18 words.",
      "kind": "rules"
    },
    {
      "label": "Launch Draft",
      "body": "Today we're launching FlowSync Pro — a tool to leverage AI synergy for robust team coordination...",
      "kind": "draft"
    }
  ]
}
```

Returns the same shape as `optimize_prompt` plus `usedSources` (which sources actually landed in the curated grounding) and `droppedSources` (sources that were empty or dropped). Sources appear in the trace as `user-source:0`, `user-source:1`, etc.

**Strict mode:** zero non-empty sources → error, not silent fall-through. Per-source body cap is 4000 chars so a single huge paste can't dominate the budget.

### `critique_prompt` *(new in 1.4.0)*

LLM-as-judge. Scores a candidate prompt 0–10 across 5 default dimensions and (when below threshold) returns an improved rewrite.

```json
{
  "prompt": "make it good",
  "revise_threshold": 7
}
```

**Response:**

```json
{
  "overallScore": 2.0,
  "verdict": "reject",
  "summary": "Reject — substantial rewrite required.",
  "dimensions": [
    { "name": "clarity", "score": 1, "rationale": "...", "suggestions": ["Specify what 'it' refers to", "..."] },
    { "name": "specificity", "score": 0, "rationale": "...", "suggestions": [...] },
    { "name": "intent_alignment", "score": 3, "rationale": "...", "suggestions": [...] },
    { "name": "format_fitness", "score": 2, "rationale": "...", "suggestions": [...] },
    { "name": "length_appropriateness", "score": 1, "rationale": "...", "suggestions": [...] }
  ],
  "improvedPrompt": "Improve the README's getting-started section: shorten...",
  "improvements": ["Specified the artifact (README's getting-started section)", "Added concrete success criteria", "..."],
  "judgeModel": "qwen2.5-coder:7b-instruct-q4_K_M"
}
```

**Parameters:**

| Parameter | Default | Description |
|---|---|---|
| `prompt` | — | Candidate prompt to score. |
| `original_prompt` | — | When critiquing an optimized version, the user's original ask. Used for the `intent_alignment` dimension. |
| `criteria` | 5 defaults | Custom dimensions: `[{ name, description }, ...]`. Up to ~8 dimensions. |
| `revise_threshold` | `7.0` | Overall score below this triggers the rewrite pass. |
| `skip_rewrite` | `false` | Skip the rewrite pass entirely (faster; just returns scores). |

**Sanity-check:** if the judge inflates `overall` more than 2.5 points above the per-dimension mean, the engine corrects it.

### `compose_prompt` *(new in 1.4.0)*

The canonical pipeline. One call runs clarify → ground/optimize → critique → optional auto-revise.

```json
{
  "prompt": "Write a TypeScript function that takes an array of email strings and returns only those that match RFC 5322 syntax. Include unit tests using Vitest with at least 6 test cases.",
  "pre_clarify": "auto",
  "post_critique": true,
  "auto_revise": true
}
```

**Response (truncated):**

```json
{
  "stages": [
    { "name": "clarify",  "ranAt": "...", "durationMs":  541, "summary": "no clarification needed (short-circuit)" },
    { "name": "optimize", "ranAt": "...", "durationMs": 3128, "summary": "5 grounding source(s) selected" },
    { "name": "critique", "ranAt": "...", "durationMs": 3422, "summary": "verdict=accept, score=8.4" }
  ],
  "finalPrompt": "Write a TypeScript function `validateEmails(emails: string[]): string[]` that...",
  "clarificationRequired": false,
  "clarification": { "clarificationNeeded": false, ... },
  "optimization": { "id": "opt_...", "optimizedPrompt": "...", ... },
  "critique": { "overallScore": 8.4, "verdict": "accept", ... }
}
```

`finalPrompt` is what you should send downstream. It equals `optimization.optimizedPrompt` (or `grounding.optimizedPrompt`) unless `auto_revise: true` AND the critique verdict isn't `accept` AND there's an `improvedPrompt` — in which case `finalPrompt` is the rewrite and `revised: true`.

**Branching:**

| Inputs | Path |
|---|---|
| no `sources` | `optimize_prompt` branch (auto-curated grounding) |
| non-empty `sources` | `ground_prompt` branch (strict, caller-provided sources pinned) |
| `pre_clarify: "auto"` (default) | clarify runs; short-circuits without surfacing questions on confident prompts |
| `pre_clarify: "always"` | clarify always runs and STOPS the chain if questions surface |
| `pre_clarify: "never"` | skip clarify entirely |
| `post_critique: true` | critique runs after optimize/ground |
| `auto_revise: true` (with `post_critique: true`) | when verdict !== `accept` and there's an `improvedPrompt`, replace `finalPrompt` |

**Hard stop:** if clarify surfaces questions (only happens when `pre_clarify: "always"`, or `auto` on a low-confidence prompt), the chain stops and returns `clarificationRequired: true`. Caller answers the questions, edits the prompt to incorporate the answers, and re-calls (typically with `pre_clarify: "never"` to skip the second clarify pass).

### `inspect_context` *(new in 1.2.0)*

Preview the **ContextBundle** ClarifyPrompt would assemble for a given prompt — workspace rules, frameworks, target-model capabilities, resolved intent, and session history — without running the full optimization. Useful for debugging why an optimization turned out the way it did.

```json
{
  "prompt": "Write an email to finance explaining the Q2 spend variance",
  "category": "document",
  "cwd": "/path/to/your/project"
}
```

Returns the full `ContextBundle` as JSON.

### `list_traces` *(new in 1.2.0)*

Summary list of recent optimization traces captured by the local tracer (when `CLARIFYPROMPT_TRACE=local`, the default).

```json
{ "day": "2026-04-22", "limit": 50 }
```

Returns trace IDs, inputs previews, resolved intents, target families, and latencies — never the full system prompt (use `get_trace` for that). Omit `day` to get the most recent day with data.

### `get_trace` *(new in 1.2.0)*

Fetch the full trace for a single optimization by ID, including the exact system prompt, bundle summary, and output.

```json
{ "id": "opt_xxx", "lookback_days": 7 }
```

### `save_outcome` *(new in 1.2.0)*

Tell ClarifyPrompt whether a past optimization was `accepted`, `edited`, or `rejected`. Accepted outputs become few-shot examples for similar future prompts in the same session. In 1.3+ this will also feed the persistent memory layer. The IDE / agent / caller is expected to invoke this after the user acts on the optimization.

```json
{
  "optimization_id": "opt_xxx",
  "session_id": "sess_yyy",
  "verdict": "accepted",
  "diff": "optional: the user's edited version or a patch"
}
```

### `list_categories`

Lists all 7 categories with platform counts (built-in and custom) and defaults.

### `list_platforms`

Lists available platforms for a given category, including custom registered platforms. Shows which is the default and whether custom instructions are configured.

### `list_modes`

Lists all 7 output modes with descriptions.

### `register_platform`

Register a new custom AI platform for prompt optimization.

```json
{
  "id": "my-llm",
  "category": "chat",
  "label": "My Custom LLM",
  "description": "Internal fine-tuned model",
  "syntax_hints": ["JSON mode", "max 2000 tokens"],
  "instructions": "Always use structured output format",
  "instructions_file": "my-llm.md"
}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `id` | Yes | Unique ID (lowercase, alphanumeric with hyphens) |
| `category` | Yes | Category this platform belongs to |
| `label` | Yes | Human-readable platform name |
| `description` | Yes | Short description |
| `syntax_hints` | No | Platform-specific syntax hints |
| `instructions` | No | Inline optimization instructions |
| `instructions_file` | No | Path to a `.md` file with detailed instructions |

### `update_platform`

Update a custom platform or add instruction overrides to a built-in platform.

For **built-in platforms** (e.g. Midjourney, Claude), you can add custom instructions and extra syntax hints without modifying the originals:

```json
{
  "id": "midjourney",
  "category": "image",
  "instructions": "Always use --v 6.1, prefer --style raw",
  "syntax_hints_append": ["--no plants", "--tile for patterns"]
}
```

For **custom platforms**, all fields can be updated.

### `unregister_platform`

Remove a custom platform or clear instruction overrides from a built-in platform.

```json
{
  "id": "my-llm",
  "category": "chat"
}
```

For built-in platforms, use `remove_override_only: true` to clear your custom instructions without affecting the platform itself.

## Custom Platforms & Instructions

ClarifyPrompt supports registering custom platforms and providing optimization instructions — similar to how `.cursorrules` or `CLAUDE.md` guide AI behavior.

### How It Works

1. **Register** a custom platform via `register_platform`
2. **Provide instructions** inline or as a `.md` file
3. **Optimize prompts** targeting your custom platform — instructions are injected into the optimization pipeline

### Instruction Files

Instructions can be provided as markdown files stored at `~/.clarifyprompt/instructions/`:

```
~/.clarifyprompt/
  config.json                    # custom platforms + overrides
  instructions/
    my-llm.md                   # instructions for custom platform
    midjourney-overrides.md     # extra instructions for built-in platform
```

Example instruction file (`my-llm.md`):

```markdown
# My Custom LLM Instructions

## Response Format
- Always output valid JSON
- Include a "reasoning" field before the answer

## Constraints
- Max 2000 tokens
- Temperature should be set low (0.1-0.3) for factual queries

## Style
- Be concise and technical
- Avoid filler phrases
```

### Override Built-in Platforms

You can add custom instructions to any of the 58 built-in platforms using `update_platform`. This lets you customize how prompts are optimized for platforms like Midjourney, Claude, or Sora without modifying the defaults.

### Config Directory

The config directory defaults to `~/.clarifyprompt/` and can be changed via the `CLARIFYPROMPT_CONFIG_DIR` environment variable. Custom platforms and overrides persist across server restarts.

## LLM Configuration

ClarifyPrompt uses an LLM to optimize prompts. It works with **any OpenAI-compatible API** and with the **Anthropic API** directly.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LLM_API_URL` | Yes | API endpoint URL |
| `LLM_API_KEY` | Depends | API key (not needed for local Ollama) |
| `LLM_MODEL` | Yes | Model name/ID |
| `CLARIFYPROMPT_HOME` | No | **Canonical (1.2.0+)** root for everything ClarifyPrompt writes — custom platforms, instruction `.md` files, traces, memory DB, and knowledge packs. Default: `$XDG_DATA_HOME/clarifyprompt` or `~/.clarifyprompt`. |
| `CLARIFYPROMPT_TRACE` | No | `off` \| `local` \| `otel`. Default: `local`. Traces are strictly local JSONL; nothing is uploaded. |
| `EMBED_API_URL` | No | **(1.3.0+)** Embedding endpoint for memory + knowledge-pack retrieval. Any OpenAI-compatible `/v1/embeddings` endpoint. Defaults to `LLM_API_URL` when unset — Ollama users just work. |
| `EMBED_API_KEY` | No | **(1.3.0+)** Embedding API key. Defaults to `LLM_API_KEY` when unset; not needed for local Ollama. |
| `EMBED_MODEL` | No | **(1.3.0+)** Default: `nomic-embed-text:v1.5` (768-dim, pull with `ollama pull nomic-embed-text`). Swap to `text-embedding-3-small` for OpenAI, `voyage-3` for Voyage, `embed-english-v3.0` for Cohere. |
| `EMBED_DIMENSION` | No | **(1.3.0+)** Embedding output dimension. Default: `768`. Must match your embedding model (`1536` for OpenAI `text-embedding-3-small`, `1024` for Voyage, etc.). |
| `SEARCH_PROVIDER` | No | Optional web-search enrichment provider when `enrich_context: true`. One of `tavily` (default) \| `brave` \| `serper` \| `serpapi` \| `exa` \| `searxng`. |
| `SEARCH_API_KEY` | No | API key for the configured `SEARCH_PROVIDER`. Not needed for self-hosted SearXNG. |
| `SEARCH_API_URL` | No | Search endpoint URL. Only needed for self-hosted SearXNG (point at your instance). |
| `CLARIFYPROMPT_SUPPRESS_LEGACY_WARN` | No | Set to `1` to silence the one-line deprecation hint when `CLARIFYPROMPT_CONFIG_DIR` / `CLARIFYPROMPT_DATA_DIR` are used. |
| `CLARIFYPROMPT_CONFIG_DIR` | No | **Legacy** alias for `CLARIFYPROMPT_HOME`. Still works; will be removed in 2.x. |
| `CLARIFYPROMPT_DATA_DIR` | No | **Legacy** alias for `CLARIFYPROMPT_HOME`. Still works; will be removed in 2.x. |

<a id="provider-examples"></a>

### Provider Examples

**Ollama (local, free):**
```
LLM_API_URL=http://localhost:11434/v1
LLM_MODEL=qwen2.5:7b
```

**Ollama — cloud models via local passthrough (recommended):**

If your local Ollama is signed in to Ollama Cloud, any `:cloud` model routes through it transparently — same URL, no separate API key. The capability table auto-detects **reasoning / thinking variants** (`gpt-oss`, `kimi-k2-thinking`, `qwen3-thinking`, `deepseek-r1`, etc.) and bumps `maxTokens` so they finish thinking and actually produce content.
```
LLM_API_URL=http://localhost:11434/v1
LLM_MODEL=gpt-oss:20b-cloud        # or kimi-k2.6:cloud, qwen3-next:80b-cloud, glm-4.6:cloud, etc.
```

**Ollama — direct cloud endpoint (no local install):**
```
LLM_API_URL=https://ollama.com/v1
LLM_API_KEY=your-ollama-cloud-key
LLM_MODEL=qwen2.5:7b
```

**OpenAI:**
```
LLM_API_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o
```

**Anthropic Claude:**
```
LLM_API_URL=https://api.anthropic.com/v1
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-20250514
```

**Google Gemini:**
```
LLM_API_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=your-gemini-key
LLM_MODEL=gemini-2.0-flash
```

**Groq:**
```
LLM_API_URL=https://api.groq.com/openai/v1
LLM_API_KEY=gsk_...
LLM_MODEL=llama-3.3-70b-versatile
```

**DeepSeek:**
```
LLM_API_URL=https://api.deepseek.com/v1
LLM_API_KEY=your-deepseek-key
LLM_MODEL=deepseek-chat
```

**OpenRouter (any model):**
```
LLM_API_URL=https://openrouter.ai/api/v1
LLM_API_KEY=your-openrouter-key
LLM_MODEL=anthropic/claude-sonnet-4
```

See [`.env.example`](.env.example) for the full list of 20+ supported providers including Together AI, Fireworks, Mistral, xAI, Cohere, Perplexity, LM Studio, vLLM, LocalAI, Jan, GPT4All, and more.

## Web Search (Optional)

Enable context enrichment by setting `enrich_context: true` in your `optimize_prompt` call. ClarifyPrompt will search the web for relevant context before optimizing.

Supported search providers:

| Provider | Variable | URL |
|----------|----------|-----|
| Tavily (default) | `SEARCH_API_KEY` | [tavily.com](https://tavily.com) |
| Brave Search | `SEARCH_API_KEY` | [brave.com/search/api](https://brave.com/search/api) |
| Serper | `SEARCH_API_KEY` | [serper.dev](https://serper.dev) |
| SerpAPI | `SEARCH_API_KEY` | [serpapi.com](https://serpapi.com) |
| Exa | `SEARCH_API_KEY` | [exa.ai](https://exa.ai) |
| SearXNG (self-hosted) | — | [github.com/searxng/searxng](https://github.com/searxng/searxng) |

```
SEARCH_PROVIDER=tavily
SEARCH_API_KEY=your-key
```

## Before and After

### Image (Midjourney)

```
Before: "a cat sitting on a windowsill"

After:  "a tabby cat sitting on a sunlit windowsill, warm golden hour
         lighting, shallow depth of field, dust particles in light beams,
         cozy interior background, shot on 35mm film, warm amber color
         palette --ar 16:9 --v 6.1 --style raw --q 2"
```

### Video (Sora)

```
Before: "a timelapse of a city"

After:  "Cinematic timelapse of a sprawling metropolitan skyline
         transitioning from golden hour to blue hour to full night.
         Camera slowly dollies forward from an elevated vantage point.
         Light trails from traffic appear as the city illuminates.
         Clouds move rapidly overhead. Duration: 10s.
         Style: documentary cinematography, 4K."
```

### Code (Claude)

```
Before: "write a function to validate emails"

After:  "Write a TypeScript function `validateEmail(input: string): boolean`
         that validates email addresses against RFC 5322. Handle edge cases:
         quoted local parts, IP address domains, internationalized domain
         names. Return boolean, no exceptions. Include JSDoc with examples
         of valid and invalid inputs. No external dependencies."
```

### Music (Suno)

```
Before: "compose a chill lo-fi beat for studying"

After:  "Compose an instrumental chill lo-fi beat for studying.
         [Tempo: medium] [Genre: lo-fi] [Length: 2 minutes]"
```

## Context Engine (1.2.0)

Every optimization runs through five integrated passes that flow one bundle of context end-to-end:

1. **Analysis** — a single `analyzePrompt()` LLM call produces `category`, `intent`, and `recommendedMode` together so they can't disagree. Intent beats surface keywords when they conflict (e.g. `"validate emails"` → `code` not `document`).
2. **Mode reconciliation** — explicit user `mode` wins; otherwise the analyzer's intent-derived recommendation applies; `modeSource` in the response tells you which.
3. **Prompt shaping** — target-model capability signal drives `systemPromptBudget` (compact for small local models, rich for 100K+ ctx models), `maxTokens`, `temperature` (intent-aware), and whether examples are included.
4. **Intent overlay** — a short overlay per intent (`production-code`: demand error handling + tests; `data-extract`: demand strict schema; `brand-voice`: lead with tone; etc.) folded into the strategy's system prompt.
5. **Grounding Context** — a single priority-ordered block that merges user pinned instructions → project rules → active file → session few-shot examples → web search → workspace metadata → target-model hints → custom platform instructions → built-in syntax hints.

### What's collected (ContextBundle)

- **Project** — first matching file from `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.clinerules`, `clarify.md`, `.clarify/rules.md`. `package.json` plus sibling manifests (`pyproject.toml`, `Cargo.toml`, `go.mod`, `Gemfile`, `composer.json`, …) drive framework + language detection.
- **File** — optional `file_path` / `file_language` / `file_excerpt` inputs.
- **Session** — ring buffer (20 ops/session) of recent optimizations and outcomes. Accepted outputs get retrieved as few-shot examples for similar future prompts.
- **Target model** — the LLM doing the rewrite, matched against a capability table.
- **User** — locale, preferred mode, pinned instructions (highest-priority grounding).

### Inspecting what the engine sees

Use the `inspect_context` tool to preview the full bundle without running an optimization. Same shape as `optimize_prompt` returns when `include_bundle: true`.

### Extending context

Drop an `AGENTS.md` / `clarify.md` / `CLAUDE.md` at your project root. Next optimization picks it up automatically. To feed accepted outputs back into future rewrites, call `save_outcome` after the user acts on the result.

## Tracing

```
$CLARIFYPROMPT_HOME/traces/YYYY-MM-DD.jsonl
```

Every optimization writes one JSONL line capturing `{id, ts, sessionId, category, platform, mode, input, bundleSummary, systemPrompt, output, model, strategy, latencyMs, shape, groundingSources, error}`. Use `list_traces` for summaries and `get_trace` for full records.

**Privacy posture:**

- Traces are **strictly local**. No outbound network calls to any ClarifyPrompt-owned infrastructure.
- Only calls out to the **LLM endpoint you configured** (`LLM_API_URL`) and optional **search provider** (`SEARCH_API_KEY`).
- Disable tracing entirely with `CLARIFYPROMPT_TRACE=off`.
- There is **no telemetry** in this release. When a telemetry option ships it will be **opt-in**, anonymous, and documented before the build includes it.

## Known limitations & roadmap

### Session memory is in-memory only (today)
The `save_outcome` + few-shot retrieval loop writes into a per-process ring buffer. Restarting the MCP server clears session state; two servers don't share memory. The **MCP tool surface is deliberately stable** — the interface won't change in 1.3. The upgrade is purely a backend swap to **SQLite + sqlite-vec** for disk persistence and richer similarity. Ship target: **1.3**.

### Intent quality scales with the model running the analyzer
The analyzer runs on the same `LLM_MODEL` that does the rewrite. In the integration battery:

- Qwen 2.5 7B and 14B → correct on every well-formed prompt tested.
- Llama 3.2 3B → occasionally over-commits on ambiguous prompts (e.g. tagged `"make it better"` as `brand-voice/high` when `unknown/low` is the right answer). Larger models on the same prompt correctly returned `unknown/low`.

**Guidance:** prefer a 7B+ local model (or any frontier hosted model) as `LLM_MODEL`. Latency-sensitive callers can set `skip_intent_resolution: true` to skip the analyzer; the engine falls back to user-hint category and default mode, losing intent-driven mode + overlay but keeping grounding + shape. A systematic **eval harness** with a public fixture set lands in **1.3 (Day 3)** so you can score the analyzer against your own fixtures and detect regressions across model or classifier changes.

### Capability table is not exhaustive
Entries today: Claude, GPT-4/o-series, Gemini, Grok, DeepSeek (chat + reasoning), Qwen, Llama, Mistral/Codestral, Mixtral, Gemma, Phi, Cohere Command, Aya, Kimi, GLM, Minimax, GPT-OSS, Yi, Nemotron. Unknown models fall back to `capabilities: {}` and `standard` prompt-shape — still functional, just without model-aware sizing. Adding entries is a data-only edit to [src/engine/context/targetModelSignals.ts](src/engine/context/targetModelSignals.ts).

### Reasoning / chain-of-thought models
Supported as a first-class case. The engine auto-detects reasoners at family level (`o1/o3/o4`, `deepseek-reasoner`, `gpt-oss`) and at variant level (anything whose ID matches `/\b(thinking|reasoner|reasoning)\b/` or `/\br[12]\b/`: `kimi-k2-thinking:cloud`, `qwen3-thinking:72b`, `qwen-r1-distill`, etc.). For these, `maxTokens` is automatically bumped to ≥ 8192 so the model has room to think AND produce content. The `reasoning` field is never surfaced as the optimized prompt — only `content` is.

## Architecture

```
clarifyprompt-mcp/
  src/
    index.ts                           MCP server entry point (20 tools, 1 resource)
    engine/
      config/
        categories.ts                  CategoryConfig type + CATEGORIES const (loaded from YAML in 1.5.0)
        platformLoader.ts              (1.5.0) YAML pack loader — reads packs/platforms/*.yaml at boot
        paths.ts                       Unified $CLARIFYPROMPT_HOME resolver (1.2.0)
        persistence.ts                 ConfigStore — JSON config + .md file loading
        registry.ts                    PlatformRegistry — merges built-in + custom
      context/                         Context Engine (1.2.0)
        types.ts                       ContextBundle + signal types + AnalysisSignal
        projectSignals.ts              CLAUDE.md / AGENTS.md / .cursorrules / manifests scan
        fileSignals.ts                 Active-file path + language + excerpt
        sessionSignals.ts              In-memory per-session ring buffer + outcome retrieval
        targetModelSignals.ts          Model → capabilities mapping
        promptAnalyzer.ts              Unified analyzer: category + intent + recommendedMode
        bundle.ts                      Bundle orchestrator
      trace/                           Local tracing (1.2.0)
        types.ts                       TraceEntry schema (shape, groundingSources, error)
        writer.ts                      JSONL + OTel-stub writer, reader, lookup
      memory/                          Persistent memory + knowledge packs (1.3.0)
        store.ts                       SQLite + sqlite-vec; bi-temporal facts, outcomes, packs
        packs.ts                       Knowledge-pack loader (local / URL / inline)
        reflection.ts                  LLM fact extraction on save_outcome
      llm/client.ts                    Multi-provider LLM client (OpenAI + Anthropic)
      search/client.ts                 Web search (6 providers; results merge into Grounding Context)
      optimization/
        engine.ts                      Core orchestrator — analyzer, shape, grounding, retrieval, trace
        curator.ts                     Token-budget grounding curator (1.3.0)
        groundingContext.ts            Priority-ordered context assembly + mode/shape helpers
        types.ts                       OptimizationContext + result shape (UserProvidedSource)
        strategies/
          base.ts                      Bundle-aware base strategy (intent overlay + shape-aware sizing)
          chat.ts                      9 platforms
          image.ts                     10 platforms
          video.ts                     11 platforms
          voice.ts                     7 platforms
          music.ts                     4 platforms
          code.ts                      9 platforms
          document.ts                  8 platforms
      clarification/clarify.ts         (1.4.0) clarify_with_user — targeted questions w/ defaults
      grounding/ground.ts              (1.4.0) ground_prompt — strict caller-provided grounding
      critique/critique.ts             (1.4.0) critique_prompt — LLM-as-judge + optional rewrite
      composition/compose.ts           (1.4.0) compose_prompt — canonical clarify→ground/opt→critique pipeline
  evals/                                Eval harness v0 (1.3.0; setup: multi-call in 1.5.0)
    run.mjs                            YAML fixtures → MCP server → scored HTML report
    fixtures/*.yaml                    23 deterministic fixtures
    schema.json                        Fixture schema
  packs/                                (1.3.0) knowledge packs + (1.5.0) platform packs
    *.md                               Knowledge packs (community-contributable)
    platforms/*.yaml                   (1.5.0) built-in AI platform declarations — 7 files, 58 platforms
  docs/adoption/                        (1.5.0) launch-post drafts + catalog submission specs
```

## Docker

```bash
docker build -t clarifyprompt-mcp .
docker run -e LLM_API_URL=http://host.docker.internal:11434/v1 -e LLM_MODEL=qwen2.5:7b clarifyprompt-mcp
```

## Development

```bash
git clone https://github.com/LumabyteCo/clarifyprompt-mcp.git
cd clarifyprompt-mcp
npm install
npm run build
```

Test with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Set environment variables in the Inspector's "Environment Variables" section before connecting.

### Tests + evals

| Command | What it does |
|---|---|
| `npm run test:integration` | Day-1 integration battery (intent + grounding + shape) |
| `npm run test:day2` | Day-2 memory + curator + reflection battery |
| `npm run test:reasoning` | Reasoning-model coverage (chain-of-thought maxTokens bump) |
| `npm run test:wire` | MCP-wire smoke test (server boots, tools list, initialize round-trips) |
| `npm run test:all` | All four batteries in sequence |
| `npm run eval` | Run the 20 deterministic eval fixtures + render `evals/report.html` |
| `npm run eval -- --filter <name>` | Run only fixtures matching `<name>` (or a tag) |
| `npm run eval -- --quiet` | Exit-code-only output (CI-friendly) |

Eval harness details, fixture format, and multi-model matrix instructions: [`evals/README.md`](./evals/README.md).

### CI / Quality gates

The repo ships a GitHub Actions workflow ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) with five jobs:

| Job | Runs on | What it gates |
|---|---|---|
| `build` | every push + PR | Typecheck + build + boot smoke-test on Node 18/20/22 across Linux + macOS |
| `secrets-audit` | every push + PR | git-grep for known API-key prefixes in tracked files |
| `evals` | every push + PR (opt-in) | `npm run eval` against `gpt-4o-mini`. Skips with success when `OPENAI_API_KEY` secret is unset; blocks publish when configured and any fixture regresses |
| `docker` | every push + PR | `docker build` + container boot smoke-test |
| `publish` | tag pushes only | `npm publish --provenance` when tag matches `package.json#version`, gated on all four jobs above |

**To enable evals as a release gate on your fork:**

1. Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
2. Name: `OPENAI_API_KEY` · Value: an OpenAI API key with access to `gpt-4o-mini`
3. Push or re-run any workflow

Cost: ~$0.005 per CI run (17 active fixtures × ~1500 input tokens × ~600 output tokens at gpt-4o-mini pricing). The eval harness's HTML report is uploaded as a build artifact (30-day retention) so you can inspect any failure without re-running locally.

**To enable npm-publish on tag pushes:** add an `NPM_TOKEN` secret with a Granular Access Token scoped to `clarifyprompt-mcp` (bypass-2FA enabled). Same Settings flow.

## License

[Apache-2.0](LICENSE)
