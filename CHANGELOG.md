# Changelog

All notable changes to **ClarifyPrompt MCP** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.2] — 2026-04-28

The first eval-gate-driven release. Adding `OPENAI_API_KEY` as a CI secret enabled the eval harness to run against `gpt-4o-mini` on every push — within minutes, the gate surfaced four real issues, three of which were latent bugs nobody had hit because the default Ollama setup happens to side-step them.

### Fixed

- **Memory store hardcoded vec table to 768 dimensions** ([#2](https://github.com/LumabyteCo/clarifyprompt-mcp/issues/2)). Pre-1.5.2, the sqlite-vec virtual table was created as `embeddings_768` with column `vec float[768]` regardless of the configured `EMBED_DIMENSION`. Anyone using OpenAI `text-embedding-3-small` (1536), Voyage `voyage-3` (1024), Cohere `embed-english-v3.0` (1024), or any non-768 model would hit `Dimension mismatch for query vector for the "vec" column. Expected 768 dimensions but received N` on the first `memory_search` or `load_knowledge_pack` call. The store now derives the table name from `embedder.dimension` and creates a dim-specific table (`embeddings_1536`, `embeddings_1024`, etc.) at boot. Existing 768-dim installs are fully back-compat — migration 1 still creates `embeddings_768`, and the additional table only spawns when a non-768 dim is configured.
- **Eval harness crashed on MCP error responses.** When an MCP tool handler threw, the SDK wrapped `error.message` in `content[0].text` as plain text (not JSON). The harness's `callTool` did `JSON.parse(text)` unconditionally and the whole eval run died with `SyntaxError: Unexpected token...`. Now wraps non-JSON responses in `{error: text, _isError: true}` and per-fixture errors no longer tank the run.

### Added

- **`LLM_TIMEOUT_MS` env-var override** on the LLM client. Default stays at 30s; users on slow hosted models or doing bulk prompts can bump it without code edits. The CI eval workflow sets `LLM_TIMEOUT_MS=120000` because `gpt-4o-mini` occasionally takes >30s on long prompts.
- **`evals.yml` GitHub Actions workflow** (split out of `ci.yml`) so it can be addressed by a dedicated `evals` badge. Cross-workflow gate in `ci.yml#publish` ensures eval failures still block npm publish on tag pushes.
- **`evals: passing` badge** on the README, pointing at the `evals.yml` workflow's last run on `main`.

### Notes for integrators

- **No env-var surface changes.** `LLM_TIMEOUT_MS` is purely additive and optional.
- **No MCP tool surface changes.** Still 20 tools, 1 resource.
- **Existing 768-dim installs require no action.** Their memory.db is fully forward-compatible.
- **Anyone running with a non-768 embedding model should upgrade.** Pre-1.5.2 their persistent-memory pipeline was silently broken at the first `memory_search` call.

### How this release got made (process note)

The four issues 1.5.2 fixes were caught by the eval gate the same hour we wired up the `OPENAI_API_KEY` secret. Three iterations of CI uncovered exactly one bug each, each one fixed and pushed before the next iteration ran:

1. Run 1: harness crash → fixed JSON.parse safety → run 2
2. Run 2: dimension mismatch → fixed memory store to support any dim → run 3
3. Run 3: brittle fixture content-check → reframed assertion to be deterministic → run 4
4. Run 4: ✅ 20 passed / 0 failed / 3 skipped / 100% avg

That's exactly the behavior the eval gate was built for: real-LLM regressions caught in CI rather than production. Total cost across the four CI runs: ~$0.10 against the configured $5/mo budget cap.

## [1.5.1] — 2026-04-26

A patch release on top of 1.5.0. **Runtime behavior unchanged.** Pure docs + ship-process: refreshes the README's marketing surfaces (which shipped stale on 1.5.0) and adds two new ship-check audits so future releases can't repeat the mistake.

### Fixed

- **README marketing surfaces** — the 1.5.0 npm tarball + GitHub release shipped with the README headline blockquote (`> **New in 1.4.0:**`), the `## What's new in 1.4.0` heading, and the `## What's in the box (cumulative through 1.4.0)` heading all still on 1.4.0. Every machine-readable version surface (package.json, lock, server.json, src/index.ts, CHANGELOG) was on 1.5.0; only the prose drifted. Fixed in 1.5.1.

### Added

- **Two new ship-check audits**:
  - `CP-11` — README marketing-surface coherence with the current version. Hard-fails if the headline blockquote, "What's new in X" heading, or "cumulative through X" annotation reference any version other than `package.json#version`.
  - `CP-12` — Platform-pack format validity. Parses every `packs/platforms/*.yaml`, asserts the file declares a known `category.id`, has at least one platform with `id/label/description`, and `defaultPlatform` references an existing platform in the file.
- **CP-11 promoted to the user-scoped ship-check skill** the same day, so future projects (not just clarifyprompt-mcp) get this check by default. The project-scoped variant becomes an `AUGMENT` with the exact-string heading templates this repo uses.

### Notes for integrators

- **No code changes.** No new MCP tools. No removed tools. No new env vars. No tarball anatomy changes beyond the refreshed README + CHANGELOG (~3 KB).
- **No reason to upgrade urgently.** If you're on 1.5.0, the engine is identical. The only reason to bump is to see the corrected story on the npm package page.

## [1.5.0] — 2026-04-26

**Built-in platforms become declarative.** The 58+ hardcoded TypeScript platform arrays are now loaded from YAML packs at runtime — adding a built-in platform is now a YAML edit, not a TS edit. Plus the eval harness gains multi-call fixtures (`setup:`), with two new fixtures covering the persistent memory + knowledge-pack retrieval pipeline that was previously uncovered.

### Added

- **YAML platform packs** — `packs/platforms/<category>.yaml`, one file per category, each declaring the platforms in that category with their syntax hints. The TypeScript layer (`src/engine/config/platformLoader.ts`) reads them at module-load and merges with a hardcoded fallback table. Adding a built-in platform now means appending a YAML entry; no TS edit, no rebuild for downstream consumers who pull a fresh tarball.
- **Graceful fallback** — any individual YAML that fails to parse logs a single stderr line and is skipped; the hardcoded fallback fills in for the affected category. A missing `packs/platforms/` directory entirely → falls through cleanly. Malformed YAML can never soft-brick the server.
- **Multi-call eval fixtures** — `evals/run.mjs` now supports a `setup: [{tool, args}, ...]` array that runs MCP tool calls before the main `input`. Setup calls aren't scored; their job is to establish state (e.g. load a knowledge pack) for the main call to exercise.
- **Memory-layer eval fixtures** — two new fixtures cover the previously-uncovered memory pipeline:
  - `memory-pack-chunk-grounds-optimize` — loads an inline knowledge pack via setup, then runs `optimize_prompt` on a related query and verifies the pack chunk surfaces in `grounding.sources` as `memory:pack_chunk:N`. Proves the full embed → store → retrieve → curate → ground pipeline.
  - `memory-search-ranks-pack-by-similarity` — loads a multi-section pack with one SOX-related and two unrelated sections, then runs `memory_search` for a SOX query and verifies the top result's content matches.
- **`top_result_must_contain` / `top_result_kind` / `count_min` / `count_max` checks** — eval harness check types for `memory_search` result shape.
- **`adoption/` docs directory** — `docs/adoption/` ships with HN/Reddit launch post drafts, an awesome-mcp-servers PR template, and catalog submission specs. Pure docs; doesn't affect runtime.

### Changed

- **`js-yaml` promoted from devDependency to runtime dependency** (`^4.1.1`). ~200 KB of unpacked dependency for the YAML platform-pack loader. Already used by the eval harness pre-1.5; now also used by the server at boot.
- **Eval baseline** (qwen2.5-coder:7b-instruct-q4_K_M, single-model run): **19 passed / 1 failed / 3 skipped / 96% avg** across 23 fixtures (was 17/1/3/96% across 21). The lone failure remains `analyzer-creative-media` (unchanged — deliberate signal that 7B coder models can't reliably classify creative-media prompts).

### Notes for integrators

- **Same MCP tool surface as 1.4.0.** No new tools; no removed tools. 20 MCP tools, 1 resource.
- **Same env-var surface.** No new required env vars.
- **Same publish surface.** `dist/` + `packs/` + `README.md` + `LICENSE` + `CHANGELOG.md` + `.env.example`. The npm tarball now includes `packs/platforms/*.yaml` (~12 KB total) so `npx clarifyprompt-mcp` users get the YAML-driven platform list out of the box.
- **Custom platforms via `register_platform`** still work identically; user-registered platforms persist in `~/.clarifyprompt/config.json` regardless of the YAML pack changes.

## [1.4.0] — 2026-04-25

**The pipeline ships.** Four new MCP tools turn ClarifyPrompt's core operations into a composable pipeline. The first deterministic eval harness lands under version control with 20 fixtures; opt-in CI gating runs evals on every push when an `OPENAI_API_KEY` secret is configured.

### Added

- **`clarify_with_user`** — Given an ambiguous draft, returns 1–3 targeted clarifying questions, each with a `suggested_answer` the caller can accept verbatim, optional 2–4 quick-pick `options`, and a `dimension` tag (audience/scope/format/length/tone/constraints/goal/platform). Short-circuits with `clarificationNeeded: false` on confident, well-formed prompts so it pipelines cleanly in front of `optimize_prompt` without a per-call latency tax. Pass `force: true` to disable the short-circuit.
- **`ground_prompt`** — Strict, retrieval-augmented variant of `optimize_prompt`. Caller-provided sources are pinned at the **highest** priority — above project rules, above pinned instructions — and tracked individually in the trace as `user-source:N`. Strict mode: zero non-empty sources → error, no silent fall-through. Per-source body cap of 4000 chars.
- **`critique_prompt`** — LLM-as-judge. Scores a candidate prompt 0–10 across 5 default dimensions (clarity, specificity, intent_alignment, format_fitness, length_appropriateness) — or caller-supplied criteria — with per-dimension rationale + concrete suggestions, an overall score, and a verdict (`accept` / `revise` / `reject`). When the score is below `revise_threshold` (default 7.0), runs a second pass to produce an `improvedPrompt` the caller can use as a drop-in replacement. Sanity-check: if the judge inflates `overall` more than 2.5 points above the per-dimension mean, the engine corrects it.
- **`compose_prompt`** — One MCP call runs the canonical pipeline: clarify → ground OR optimize → critique → optional auto-revise. Auto-decides the ground vs. optimize branch from whether `sources` is non-empty. `pre_clarify: 'auto' | 'always' | 'never'`. `post_critique: true` adds a judge pass. `auto_revise: true` replaces `final_prompt` with the rewrite when verdict !== `accept`. Returns a per-stage `stages` audit array.
- **`UserProvidedSource` injection point on `optimize_prompt`** — A new top-priority slot in the curator (`user-source:N`) above pinned instructions. Both `ground_prompt` and `compose_prompt` use it under the hood; available directly when you want explicit grounding control without strict-mode validation.
- **Eval harness v0** — Deterministic regression tests under `evals/`. 20 YAML fixtures cover analyzer, shape, intent-overlay, grounding, clarify, critique, ground, and compose surfaces. `npm run eval` produces a console summary + self-contained dark-themed HTML report. Fixtures are tool-aware: any fixture can target `optimize_prompt` (default) / `clarify_with_user` / `ground_prompt` / `critique_prompt` / `compose_prompt` via `input.tool`.
- **Eval-gated CI workflow** (opt-in) — When `OPENAI_API_KEY` is set as a repo secret, GitHub Actions runs `npm run eval` against `gpt-4o-mini` as a release gate. Off by default; nothing leaves your machine without the secret.

### Changed

- **20 MCP tools** (was 16). New: `clarify_with_user`, `ground_prompt`, `critique_prompt`, `compose_prompt`. The other 16 are unchanged.
- **Tests under version control.** The Day-1/Day-2 ad-hoc test scripts that were living in `/tmp/` are now in `tests/` and runnable as `npm run test:integration / test:day2 / test:reasoning / test:wire / test:all`.

### Eval baseline (qwen2.5-coder:7b-instruct-q4_K_M, single-model run)

- 16 passed / 1 failed / 3 skipped / **96% avg score** across 20 fixtures.
- The lone failure (`analyzer-creative-media`) is a deliberately retained signal: 7B coder-tuned models cannot reliably classify creative-media prompts. Larger models (qwen2.5:14b) and frontier hosted models (gpt-4o-mini, claude-haiku) classify it correctly. Multi-model matrix: see `evals/README.md`.
- The 3 skipped fixtures are gated by `skip_unless_model_matches` for model-class-specific behavior (tiny / mid / reasoning) and only fire on the appropriate model.

### Notes for integrators

- Same env-var surface as 1.3.x — no new required env vars.
- Same publish surface (`dist/` + `packs/` + `README.md` + `LICENSE` + `CHANGELOG.md` + `.env.example`).
- All pre-1.4 tools and result shapes are unchanged. `optimize_prompt`'s response shape is fully back-compat; `userProvidedSources` is a new optional field that defaults to undefined.

## [1.3.2] — 2026-04-24

Closes the audit loop opened by ship-check during the 1.3.1 retrospective. Pure docs + metadata + skill-library hygiene; no engine code changes.

### Added

- **`server.json` env-var declarations for the search-enrichment feature** — `SEARCH_PROVIDER`, `SEARCH_API_KEY` (secret), `SEARCH_API_URL`. These were documented in `.env.example` since the optional context-enrichment feature shipped in 1.1.x but never made it into the MCP Registry manifest. Users installing via the registry UI will now be prompted for them.
- **README env-var reference table rows for `SEARCH_*`** — same gap on the docs side, also closed.
- **Synced `server.json` description** to match the 1.3.0+ pitch ("persistent memory, knowledge packs, explicit token-budget curation…"). Was still on 1.2.0-era language.

### Changed

- **Removed the `CLARIFYPROMPT_TELEMETRY` placeholder line from `.env.example`.** It was a forward-looking commented-out example for a feature that doesn't exist yet. Documenting features that don't exist makes the docs slightly lie. Will reappear the moment any telemetry code lands.

### Skill library — consolidation pass

The `ship-check` skill caught its own first audit findings during the 1.3.1 → 1.3.2 cycle. Used the moment to run the first **promotion pass** under the cascade-learning model we established:

- **Promoted CP-7 → general check #9** (License consistency + commitment-drift heuristic). Now applies to any project regardless of language.
- **Promoted CP-9 → general check #10** (Build-artifact directory hygiene across Node / Python / Rust / Java / Go).
- **Promoted CP-2 + CP-3 → general check #11** (MCP server-manifest env-var cross-check, conditional on `server.json` existence — now also reconciles against the README env-var table).
- **Audit-logic fixes in the user-scoped skill**: secrets sweep now excludes `.claude/skills/**` (skill files commonly enumerate token patterns; matching them is a self-reference false positive); `.env.example` parser now includes commented `# VAR=` lines.

The project-scoped skill at `.claude/skills/ship-check/SKILL.md` now carries a **promotion log** — a dated audit trail of which checks moved from project-scoped to user-scoped, with one-line rationales each.

### Notes for integrators

- npm tarball still ships `dist/` + `packs/` + `README.md` + `LICENSE` + `CHANGELOG.md` + `.env.example`. No file-list changes.
- No new MCP tools (still 16 from 1.3.0).
- No env vars *removed* (only the `CLARIFYPROMPT_TELEMETRY` example comment was removed, and that was never a live env var).

## [1.3.1] — 2026-04-24

Post-1.3.0 audit fixes. No engine behavior change; three real gaps found and closed.

### Fixed

- **Dockerfile build broken for Day-2 features.** Removed `--ignore-scripts` from both `npm ci` invocations so `better-sqlite3`'s `prebuild-install` step runs and the native `.node` binary actually lands in the image. Without this, memory + pack features would crash at container startup. `packs/` is now also copied into the runtime stage.
- **`server.json` was missing the 1.3.0 env-var declarations.** Added `EMBED_API_URL`, `EMBED_API_KEY`, `EMBED_MODEL`, `EMBED_DIMENSION`, plus the canonical `CLARIFYPROMPT_HOME` that should have been declared in 1.2.0. MCP Registry now prompts for the right variables on install.
- **README env-var reference table didn't list `EMBED_*`.** They were documented in `.env.example` and `CHANGELOG` but not the main table. Fixed.

### Notes

- No behavior changes in the optimize / memory / reflection / pack paths — purely packaging + metadata.
- Users already on 1.3.0 via `npx` won't experience any functional difference; users running in Docker containers *will* — 1.3.0's Dockerfile was broken, 1.3.1's works.
- `glama.json` and GitHub Issues reviewed — nothing to update.

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
