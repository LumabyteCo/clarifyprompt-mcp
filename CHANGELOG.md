# Changelog

All notable changes to **ClarifyPrompt MCP** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] — 2026-04-24

ClarifyPrompt 1.3 stops tuning prompts and starts **curating context**. Every call becomes an explicit token-budget problem — memory, tools, MCP, history — and every decision the curator makes is inspectable, persistent, and improves with use.

Framed against Anthropic's four context-engineering pillars:

| Pillar | What 1.3 adds |
|---|---|
| **System instructions** | Unchanged from 1.2 (intent overlay + shape-aware sizing) |
| **MCP & external data** | **Knowledge packs** — markdown + YAML frontmatter, loaded by URL / path / inline, chunked and embedded into the persistent memory store |
| **Tools** | 4 new MCP tools: `load_knowledge_pack`, `list_packs`, `unload_pack`, `memory_search`, `explain_last_curation` (15 total, up from 11) |
| **Message history** | **Persistent memory** via SQLite + sqlite-vec; **reflective learning** via `save_outcome` → LLM fact extraction → invalidation; **semantic retrieval** across sessions |

### Added — Persistent memory substrate

- **SQLite + sqlite-vec** as the storage layer (new deps: `better-sqlite3 ^12.9.0`, `sqlite-vec ^0.1.9`). Single `memory.db` at `$CLARIFYPROMPT_HOME/memory/`, WAL mode.
- **Bi-temporal schema** (Graphiti-style): every fact has `valid_from` + `observed_at` + optional `invalidated_at`. New contradicting facts don't overwrite — they invalidate the prior edge.
- Tables: `sessions`, `entities`, `facts`, `edges`, `outcomes`, `optimizations`, `packs`, `pack_chunks`, plus vec0 vector index `embeddings_768`.
- **Versioned migrations** with `schema_migrations` tracking — safe to re-run.
- **Graceful degradation:** if sqlite-vec fails to load, memory operations become no-ops instead of errors; the rest of the engine keeps working.

### Added — Pluggable embedder

- **`OpenAICompatibleEmbedder`** following the same contract as the LLM client. Any `/v1/embeddings`-shaped endpoint works.
- Defaults to local Ollama + `nomic-embed-text:v1.5` (768-dim). `EMBED_API_URL` falls back to `LLM_API_URL` so Ollama users "just work".
- Pre-configured examples in `.env.example` for OpenAI (`text-embedding-3-small`), Voyage (`voyage-3`), Cohere (`embed-english-v3.0`).

### Added — The Context Curator

The centerpiece of 1.3. Replaces flat priority-ordered context stacking with an explicit token-budget solver:

- **`computeBudget`** — derives the grounding-budget envelope from the target model's context window, system-prompt tokens, output budget, and the original prompt size.
- **`buildCandidates`** — constructs a scoreable candidate per grounding source: user-pinned, project rules, active file, session few-shots, web search, memory matches, workspace meta, target-model hints, custom platform instructions, platform syntax hints.
- **`scoreCandidate`** — weighted combination of `baseUtility × 0.5 + intentMatch × 0.25 + authority × 0.15 + freshness × 0.10`. User-pinned sources are hard-pinned (utility = 1.0, always included).
- **`curate`** — dedupes, pins required sources, then fills the remaining budget greedily by utility-per-token. Returns a full `CurationResult` with `selected`, `rejected` (with reasons), `budget`, and `used` — making every decision inspectable.
- **Token counting**: 4-chars-per-token approximation; cheap and good enough for budgeting decisions that operate at the hundreds-of-tokens granularity.

### Added — Semantic retrieval into the pipeline

- Every `optimize_prompt` call now does a **dual vector search** (facts + pack chunks) over the persistent memory store and injects the top matches as curator candidates.
- Each optimization is **persisted** to memory with its original-prompt embedding, so "have I seen a similar prompt before?" works across sessions and processes.
- The old session ring buffer remains as a fast-path for same-session retrieval.

### Added — Reflective memory

- **`save_outcome` now extracts facts** via an LLM pass when the verdict is `accepted` or `edited`. Facts are 1–3 `(subject, predicate, object)` triples per outcome, stored with `source: "reflection:<optId>"`, embedded, and available for retrieval on subsequent calls.
- **Rejection path** invalidates recent reflection-sourced facts from the same session (last hour window) as a conservative anti-pattern signal.
- **`skip_reflection`** flag on `save_outcome` for latency-sensitive callers.

### Added — Knowledge packs

A community-contributable primitive for teaching ClarifyPrompt durable knowledge.

- **Pack format**: markdown body + optional YAML frontmatter (`name`, `version`, `description`, `scope`, `author`, `license`, `tags`). Parsed by a minimal YAML-lite parser (no external deps).
- **`load_knowledge_pack`** MCP tool — loads from local path, HTTPS URL, or inline markdown. Chunks the body by H1/H2 headings (fallback to paragraph splitting for sections > ~1500 chars), embeds each chunk, writes everything to memory.
- **`list_packs`** and **`unload_pack`** tools for pack management.
- **3 starter packs** shipped in `packs/`:
  - `nextjs-14-best-practices` — server-first Next.js 14 App Router conventions
  - `anthropic-brand-voice` — Anthropic's public tone, register, word choices
  - `sox-compliance` — Sarbanes-Oxley 404 guardrails for AI-assisted financial work
- **Companion registry** at [github.com/LumabyteCo/clarifyprompt-packs](https://github.com/LumabyteCo/clarifyprompt-packs) — Apache-2.0, community-curated.

### Added — Curation observability

- Trace entries now carry a `curation` block: `{budget, used, selected[], rejected[]}` with per-candidate tokens, utility score, and rejection reasons.
- **`explain_last_curation`** MCP tool renders a human-readable explanation of the most recent (or specified) optimization's curator decisions. Use this when an output feels off and you want to know which grounding sources the engine chose and why.

### Added — New MCP tools (16 total, up from 11)

- `load_knowledge_pack` — load a pack into persistent memory
- `list_packs` — list loaded packs
- `unload_pack` — remove a pack and its chunks
- `memory_search` — semantic search over facts + pack chunks
- `explain_last_curation` — inspect the Context Curator's decisions

### Added — Env vars

| Variable | Required | Description |
|---|---|---|
| `EMBED_API_URL` | No | Embedding endpoint. Defaults to `LLM_API_URL` if unset. |
| `EMBED_API_KEY` | No | Embedding API key. Defaults to `LLM_API_KEY` if unset. |
| `EMBED_MODEL` | No | Embedding model ID. Default: `nomic-embed-text:v1.5`. |
| `EMBED_DIMENSION` | No | Embedding dimension. Default: `768`. |

### Changed

- `optimize_prompt` response now includes `curation` metadata: how the token budget was allocated, what was kept, what was cut.
- Trace JSONL schema gains the `curation` field. Existing 1.2 traces remain readable.
- `save_outcome` response now includes a `reflection` sub-object: `{factsExtracted, factsInvalidated, source, notes}`.
- Server version bumped to `1.3.0` across `package.json`, `server.json`, `src/index.ts`, `package-lock.json`.
- npm tarball now includes `packs/` — the 3 starter packs ship with the install.

### Notes for integrators

- **All new features are opt-in.** Callers that only pass `{ prompt }` still get 1.2-level behavior. Memory / packs require an embedding endpoint; missing it degrades to `memoryMatches: []` instead of erroring.
- **Reflection adds latency to `save_outcome`.** Expect 1–3 seconds on a local 7B model. Pass `skip_reflection: true` for sub-100ms outcome recording.
- **`memory.db` is a single file.** Back it up, sync it between machines, ship it as part of a team's workspace if you want — it's yours.
- **Knowledge packs are strictly local.** The registry at `github.com/LumabyteCo/clarifyprompt-packs` is just a curated markdown-file index; `load_knowledge_pack` fetches the file once and stores everything locally. No callbacks, no telemetry.

### Positioning (the one-sentence 1.3 pitch)

> ClarifyPrompt 1.3 stops tuning prompts and starts curating context. Every call becomes an explicit token-budget problem — memory, tools, MCP, history — and every decision the curator makes is inspectable, persistent, and improves with use.

## [1.2.1] — 2026-04-22

Packaging polish. No behavior change.

- **`CHANGELOG.md` now ships in the npm tarball.** Added to the `files` array in `package.json`. Users installing via npm can now read the full release history directly from `node_modules/clarifyprompt-mcp/CHANGELOG.md`, and the npm package page renders it.
- **`npm pkg fix`**: dropped the leading `./` from the `bin` path so the npm CLI stops emitting the auto-correct warning on publish. Purely cosmetic.
- Package size unchanged (~65 kB).

## [1.2.0] — 2026-04-22

ClarifyPrompt graduates from a stateless string-rewriter into a **context-aware prompt compiler**. The five integration passes below ensure every new signal flows into the decisions that shape the output — no more "parallel repo inside a repo".

### Added — Context Engine

- **ContextBundle** — structured context assembled before every optimization, threaded through the entire pipeline.
  - `project` signals: auto-scans `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.clinerules`, `clarify.md`, `.clarify/rules.md`, plus `package.json` and sibling manifests.
  - `file` signal: optional active-file path + language + excerpt to ground the rewrite.
  - `session` signal: in-memory ring buffer (20 ops/session) of recent optimizations **and outcomes**.
  - `targetModel` signal: configured `LLM_MODEL` mapped to a capability table (context window, JSON mode, tool use, vision, local-deploy, strengths, weaknesses).
  - `user` signal: locale, preferred mode, pinned instructions.
- **Unified `PromptAnalyzer`** — one LLM call produces `{ category, intent, recommendedMode, confidence }` together. Replaces the old sequential `detectCategory` → `resolveIntent` pair so the two classifiers can't disagree. Intent now beats surface keywords when they conflict (e.g. `"write a function to validate emails"` routes to `code` not `document`).
- **Intent-driven mode** — when the user doesn't pass `mode`, the engine uses the analyzer's recommendation (e.g. `production-code` → `technical`, `quick-draft` → `concise`). When the user does pass `mode`, user choice wins. The response reports `modeSource: user | analyzer | default`.

### Added — Grounding Context (single, priority-ordered)

A single `Grounding Context` block merges **all** context sources in a documented priority order. No more parallel web-search vs. workspace-signal blocks. Order:

1. User pinned instructions (highest)
2. Project rules (`CLAUDE.md` / `AGENTS.md` / `.cursorrules` / `clarify.md`)
3. Active file
4. Prior accepted examples (same session)
5. Web search (if enabled)
6. Workspace metadata (frameworks, languages)
7. Compiler-model capability hints
8. Custom platform instructions
9. Built-in platform syntax hints

### Added — Target-model-aware prompt shaping

Every optimize call now adapts to the downstream LLM's capabilities:

- **Compact budget** for small / short-context models (<16K ctx, small Llama/Mistral variants): shortened system prompt, `maxTokens=1024`, no examples.
- **Standard budget** for mid-tier models (8–32B, 32K+ ctx): full system prompt, `maxTokens=2048`.
- **Rich budget** for 100K+ ctx models (Claude / GPT-4 / Gemini): full richness, `maxTokens=3072`, examples allowed.
- Temperature is intent-aware: `data-extract`/`technical-spec`/`analysis` → 0.2; `creative-media`/`brand-voice` → 0.9; `quick-draft` → 0.5; default 0.7.

### Added — Intent-specific system-prompt overlays

Each of the 10 intents now injects a short overlay into the strategy's system prompt. `production-code` gets "be precise about language/version, error handling, edge cases, tests"; `data-extract` demands a strict schema and forbids prose wrappers; `brand-voice` leads with tone/voice constraints; etc.

### Added — Session retrieval as a real memory loop (Pass D)

- `save_outcome` MCP tool: the caller (IDE / agent) reports `accepted | edited | rejected` verdicts for past optimizations.
- Before each new optimization, the engine finds similar accepted outputs in the same session (category + intent match, Jaccard-scored prompt similarity) and injects the top 2 as few-shot examples in the Grounding Context.
- The session tier is no longer a passive log. Day 2's persistent SQLite+vector memory drops into the same interface.

### Added — Local tracing (enriched)

- JSONL trace writer at `$CLARIFYPROMPT_HOME/traces/YYYY-MM-DD.jsonl`.
- Each trace now captures `shape` (budget, maxTokens, temperature), `groundingSources` (which context sources contributed), and any `error` from the LLM call.
- **Strictly local.** Nothing uploaded. Disable with `CLARIFYPROMPT_TRACE=off`.

### Added — New MCP tools (11 total, up from 7)

- `inspect_context` — preview the full ContextBundle without running optimization.
- `list_traces` — summary list of recent traces.
- `get_trace` — full trace record by ID.
- `save_outcome` — report an optimization's accept / edit / reject verdict.

### Added — Unified config/data directory (Pass E)

- **`CLARIFYPROMPT_HOME`** — new single canonical env var. Defaults to `$XDG_DATA_HOME/clarifyprompt` or `~/.clarifyprompt`.
- All subdirs (`instructions/`, `traces/`, `packs/`, `memory/`, `config.json`) live under `CLARIFYPROMPT_HOME`.
- **Legacy `CLARIFYPROMPT_CONFIG_DIR` and `CLARIFYPROMPT_DATA_DIR` still work** as aliases, with a one-line stderr hint. Silence via `CLARIFYPROMPT_SUPPRESS_LEGACY_WARN=1`. Will be removed in 2.x.

### Added — Extended `optimize_prompt` inputs

All optional; backward-compatible:

- `session_id`, `file_path`, `file_language`, `file_excerpt`, `cwd`
- `user_locale`, `user_pinned_instructions`
- `include_bundle` — returns the full `ContextBundle` (same shape as `inspect_context`)
- `skip_intent_resolution` — skips the analyzer for latency-sensitive callers

### Changed

- `optimize_prompt` response now includes:
  - `analysis` (canonical): `{ category, intent, recommendedMode, confidence, source }`
  - `shape`: `{ systemPromptBudget, maxTokens, temperature }`
  - `grounding`: `{ sources, acceptedExamplesUsed }`
  - `modeSource`: how the final mode was decided
  - `sessionId`: always echoed so callers can route `save_outcome` to the right session
- **Back-compat preserved**: the old `detection` and `intent` fields still populate for pre-1.2 callers. Both are marked `@deprecated` in types; they will be removed in 2.x.
- Base strategy now consumes the bundle structurally (intent overlay, grounding priority, shape) instead of dumping a summary string.
- Server version bumped to `1.2.0` across `package.json`, `src/index.ts`, and `server.json` (fixes pre-1.2 version drift).
- Dockerfile stays on `node:20-slim`; no changes required.

### Fixed

- **Category mis-route bug** (`"write a function to validate emails"` → `document` instead of `code`). The unified analyzer resolves category and intent together, letting intent veto obvious-keyword traps.
- **Two classifiers running serially with no arbitration**. Collapsed into a single analyzer.
- **Mode/intent conflicts silently ignored**. Now reconciled with a documented priority: explicit user `mode` → analyzer recommendation → default.
- **Parallel context silos** (web search + bundle) merging as separate blocks. Unified into one Grounding Context.
- **Target-model signal detected but ignored**. Now drives prompt budget, maxTokens, temperature, and example count.
- **Session ring buffer was write-only.** `save_outcome` + retrieval turn it into a real few-shot source.
- **LLM call failures propagating as raw throws.** Now wrapped — callers receive the assembled bundle and a structured `error` field instead of losing all state.
- **`include_bundle` returning a 5-field projection.** Now returns the full `ContextBundle`, consistent with `inspect_context`.
- Server version in `src/index.ts` no longer lags behind `package.json`.

### Notes for integrators

- All new parameters and env vars are opt-in. Callers that send only `{ prompt }` still work and still get richer responses.
- Trace JSONL schema is versioned (`schemaVersion: 1`). Future breaking changes will bump it per line.
- `ContextBundle` is stable within `1.x` minor.
- `detection` and `intent` fields on the result are **deprecated aliases** kept for 1.x compatibility.

### Added — Reasoning-model support (Ollama Cloud + OpenAI o-series + DeepSeek-R)

Reasoning / chain-of-thought models (OpenAI `o1/o3/o4`, DeepSeek-R, GPT-OSS, and any variant whose ID contains `thinking` / `reasoner` / `reasoning` / `r1`) emit a separate `reasoning` field alongside `content` on OpenAI-compatible responses, and burn tokens on an internal chain-of-thought **before** producing any content. The prior 2048-token default would often cut them off mid-thought, leaving `content` empty.

1.2.0 adds:
- **`reasoningChainOfThought` capability flag** on the target-model signal. Set family-wide for OpenAI reasoning, DeepSeek Reasoning, and GPT-OSS; also set per-variant on any model ID matching `/\b(thinking|reasoner|reasoning)\b/` or `/\br[12]\b/`. Covers `kimi-k2-thinking:cloud`, `qwen3-thinking`, etc.
- **`getPromptShape` auto-bumps `maxTokens`** to ≥ 8192 (and up to `4 × base`) whenever the target model has the flag, so reasoning finishes and content lands.
- **`ChatMessage.reasoning` type** added so the response shape is typed correctly. ClarifyPrompt never returns `reasoning` as the optimized prompt — it's chain-of-thought, not the answer.
- **Safety-net warning**: if `content` is empty but `reasoning` is present AND `finish_reason === 'length'`, the LLM client logs a one-shot stderr hint telling the user to raise the budget or flag the model.

Live-verified against Ollama Cloud `gpt-oss:20b-cloud` (1674-char optimized prompt at 3.7s), `qwen3-next:80b-cloud` (non-reasoning cloud still clean), and the structured-error fallback kicking in correctly when Ollama Cloud returned a 500 for `kimi-k2-thinking:cloud`.

### Known limitations (intentional, tracked)

**Session memory is in-memory only.** The `save_outcome` tool + `findAcceptedExamples` retrieval loop write into a per-process ring buffer, which means:

- Restarting the MCP server clears all session state, including accepted examples.
- Two MCP servers running against the same user/workspace do not share sessions.
- No disk persistence of outcomes across days.

The `save_outcome` MCP tool surface and the retrieval-augmentation flow are **deliberately stable** — the interface won't change in 1.3. The upgrade path is purely a backend swap to SQLite + sqlite-vec, giving persistence + richer similarity without any client-visible contract change. Target: 1.3 (Day 2 of the context-engine roadmap).

**Intent quality scales with model size.** The `analyzePrompt` classifier runs on the same LLM that does the rewrite (configured via `LLM_MODEL`). Observations from the integration battery against local Ollama:

- Qwen 2.5 7B (code specialist) and 14B: correctly classified every well-formed prompt in our test set.
- Llama 3.2 3B: occasionally over-commits on ambiguous prompts (e.g. tagging "make it better" as `brand-voice/high` when `unknown/low` is correct). Larger/specialist models on the same prompt correctly returned `unknown/low`.

Implications for integrators:
- For production use, prefer a 7B+ model (or any frontier hosted model) as `LLM_MODEL` to get reliable category + intent classification.
- Callers that are latency-sensitive or cost-sensitive can pass `skip_intent_resolution: true` — the engine falls back to user-hint category and default mode, losing intent-driven mode and overlay but keeping grounding + shape.
- Systematic measurement of classifier quality is a 1.3 deliverable (Day 3): a fixture set + eval harness will ship so users can score the analyzer against their own fixtures and see regressions across model/analyzer changes.

**Capability table coverage is not exhaustive.** We include Claude, GPT-4/o-series, Gemini, Grok, DeepSeek (chat + reasoning), Qwen, Llama, Mistral, Mixtral, Gemma, Phi, Cohere Command, Aya, Kimi, GLM, Minimax, GPT-OSS, Yi, and Nemotron. Anything else returns `capabilities: {}` and falls back to `standard` prompt-shape — still functional, just without model-aware sizing. Adding new entries is a data-only PR (`src/engine/context/targetModelSignals.ts`).

## [1.1.3] — 2026-03-12

- Registry + packaging updates for the MCP Official Registry.
- Dockerfile moved to `node:20-slim` for Glama compatibility.
- Miscellaneous README polish.

## [1.1.0] — 2026-02-26

- Initial public release of custom-platform registration, `.md` instruction files, and multi-provider LLM + search support.
