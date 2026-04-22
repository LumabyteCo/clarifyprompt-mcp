# Changelog

All notable changes to **ClarifyPrompt MCP** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — unreleased (integration-complete)

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
