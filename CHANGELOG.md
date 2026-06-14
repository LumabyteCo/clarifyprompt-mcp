# Changelog

All notable changes to **ClarifyPrompt MCP** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.1] — 2026-06-13

Patch: fixes [#3](https://github.com/LumabyteCo/clarifyprompt-mcp/issues/3) — some models returned a **silent empty `optimizedPrompt`**. No MCP tool surface changes.

### Fixed

- **`optimize`/`critique`/`clarify` could silently return empty text** when the LLM produced no `content`. Two distinct causes, now handled uniformly in `src/engine/llm/client.ts`:
  1. **Thinking-channel models** (DeepSeek, qwen-thinking, some gateways) return the chain-of-thought under a field name `simpleGenerate` wasn't reading. It read only `message.reasoning`; it now reads `reasoning` / `thinking` / `reasoning_content` via a new pure, exported `extractAssistantContent()`.
  2. **gpt-oss harmony format over Ollama's `/v1` shim** (the actual issue #3 case, confirmed from the raw response): the model *generates* tokens (`completion_tokens > 0`) but the OpenAI-compatible endpoint returns `content: ""` with **no** thinking field — the harmony `final` channel is never mapped into `content`. There's no field to recover, so this can't be silently papered over.
- **New recovery + fail-loud path:** when `content` is empty (regardless of any thinking field), `simpleGenerate` now retries once with a final-answer-only directive and a larger token budget. If the answer is still empty, it throws `LLMError` (with a `completion_tokens` diagnostic). The optimization engine catches the throw, **degrades to the original prompt** (non-empty), and surfaces a structured `error` in the result and trace. Callers never again receive a silent empty optimized prompt — they get either a recovered answer or a clear, actionable error.

### Not fixed (out of scope, tracked)

Genuinely *recovering* gpt-oss harmony output would require switching that provider to Ollama's native `/api/chat` endpoint — fragile, provider-specific, and the wrong size for a patch. Filed as a follow-up on #3. The user-facing harm (silent failure) is fully resolved; affected users now get the original prompt back plus a diagnostic pointing at non-reasoning models or `/api/chat`.

### Tests

- **New `npm run test:thinking`** (`tests/llm-thinking-channel.mjs`) — a deterministic, mock-based battery (no live cloud model) that locks the regression: all three thinking-field names extract correctly; thinking-only responses recover via retry; the harmony shape (empty content + no thinking field + `completion_tokens: 306`) retries then throws with the diagnostic; and normal responses are passed through untouched in a single call. Added to `test:all`.
- The live reasoning battery's R3 now asserts the real invariant — "produced real output **OR** degraded loudly (non-empty fallback + surfaced error), never silent-empty" — instead of demanding content a broken upstream endpoint can't deliver.

### Verified

- `test:thinking` ✅ · reasoning battery ✅ (R3 degrades loudly, R4 non-reasoning works, R5 genuine thinking-model `kimi-k2-thinking:cloud` returns real content — proving working reasoners are untouched) · integration · day2 · evals · wire · `tsc`.

## [1.7.0] — 2026-06-12

Minor release: **the full MCP tool surface modernized to the SDK's `registerTool` API** — every tool now declares a human-readable `title`, the four behavior-hint `annotations`, and a validated `outputSchema` with `structuredContent` on every response. This is step #2 of the modernization roadmap in [`docs/audits/mcp-completeness-2026-05.md`](./docs/audits/mcp-completeness-2026-05.md) (step #1, the SDK floor bump, shipped in 1.6.5). **No engine behavior changes; full back-compat for existing consumers.**

### Changed

- **All 23 tools migrated from the deprecated `server.tool()` shorthand to `server.registerTool()`** (the legacy registration API is removed in SDK 2.0 — this clears the migration before the ecosystem forces it).
- **Every tool now declares `title`** — hosts render "Forget a fact" instead of `memory_forget`.
- **Every tool now declares the four annotation hints** (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`). Hosts can now distinguish the three destructive tools (`memory_forget`, `unload_pack`, `unregister_platform` — confirmation-worthy) from the seven read-only+idempotent inspectors (`list_*`, `memory_search`, `get_trace`, `explain_last_curation` — safe to call freely), and see which tools reach outside the machine (`openWorldHint: true` on the seven LLM/embedding/web-calling tools).
- **Every tool now declares an `outputSchema` and returns `structuredContent`** alongside the text content. Hosts that understand structured output get typed, field-named responses for all 23 tools. Schemas are deliberately permissive (all fields optional, objects passthrough, variable leaves `unknown`) — they document the shape without ever rejecting real engine output; the engine's TypeScript types remain the source of truth.
- **The `categories` resource migrated to `registerResource`** with a `title`.
- **Stale registry link fixed** in `load_knowledge_pack`'s description — it still pointed at the archived `clarifyprompt-packs` repo; now points at the canonical [`packs/`](./packs/) home (a surface the 1.6.4 consolidation missed).

### Back-compat (verified, not assumed)

- **Text content is byte-identical for every tool.** Object payloads serialize exactly as before; the three array-returning tools (`list_categories`, `list_platforms`, `list_modes`) keep their bare-array text while `structuredContent` wraps the array in an object (the MCP spec requires object-typed structured output). The wire test — which `JSON.parse`s the text and indexes it as an array — passes unchanged.
- **Error returns are unchanged** (`isError: true` + JSON text). Error responses skip output-schema validation by SDK design, so no error path gained new failure modes.
- **Verification:** wire 7/7, integration 9/9, day2 ✅, evals 26/27 with **zero output-validation errors** across all fixtures (the one fail is the known `analyzer-creative-media` qwen-coder-7b classifier flake, pre-existing since 1.6.x and passing on CI's gpt-4o-mini).

### Found during verification (not caused by this release)

- **[#3](https://github.com/LumabyteCo/clarifyprompt-mcp/issues/3)** — cloud `gpt-oss:20b-cloud` now returns its entire completion in the thinking channel with empty `content`, and `client.ts` reads only the legacy `reasoning` field name (missing `thinking` / `reasoning_content`), so affected users silently get an empty `optimizedPrompt`. Deterministic 3/3 in the maintainer reasoning battery; the identical engine code passed on 2026-05-31, so this is a remote model/API-side change exposing a pre-existing parsing gap. Root cause + fix sketch in the issue; targeted for 1.7.1.

### Numbers

- Tools: 23 (unchanged count, modernized registration). Resources: 1 (modernized). Platforms: 60+ (unchanged). Eval fixtures: 30 (unchanged).
- `npm audit --production`: 0 vulnerabilities (unchanged).

## [1.6.8] — 2026-06-01

Housekeeping release closing the two loops the 1.6.5 → 1.6.7 cascade opened. **No engine code, MCP tool surface, platform, or env-var changes.**

### Changed

- **CI build matrix now tests Node 24** (the current active LTS, EOL Apr 2028) in addition to 18, 20, and 22 — `node: [18, 20, 22, 24]` across Ubuntu + macOS. Before this, the matrix tested two EOL versions (18, EOL Apr 2025; 20, EOL Apr 2026) but **not the current LTS at all**. Verified before merge that `better-sqlite3@12.10.0` + `sqlite-vec@0.1.9` load and `vec_version()` returns cleanly on Node 24.16.0 in a toolchain-free `node:24-slim` container — which guarantees the toolchain-equipped matrix runners pass. `engines` stays `>=18` (maximum compatibility; we test what we claim).
- **Publish-job runner bumped Node 20 → 22.** The release-critical `npm publish` step was running on Node 20 (now EOL); moved it to Node 22 to match the Dockerfile base and keep an EOL runtime off the publish path. Not a user-facing support change — purely internal CI hygiene.

### Process

- **New ship-check `CP-13 — lockfile regeneration safety`** (`.claude/skills/ship-check/SKILL.md`). Encodes the hard lesson from the 1.6.5 → 1.6.6 → 1.6.7 cascade so it can't recur: never use `npm install --package-lock-only` when deps may change (it silently drops non-host platform binaries); always diff the lockfile for dropped platform/optional deps and unexpected native-dep version jumps before committing; verify all 5 `sqlite-vec` platforms survive; gate release lockfile changes on a local slim-Docker load test. Flagged as a strong promotion candidate to the user-scoped ship-check skill (the failure modes are general to any project with native or platform-gated deps). **Dogfooded on this very release** — the 1.6.8 lockfile bump went through a full `npm install` (not `--package-lock-only`), verified all 5 platforms intact with zero native-dep drift.

### Why this is a separate release

1.6.5 cleared two CVEs but its lockfile regen silently broke CI twice (1.6.6 restored dropped sqlite-vec platforms; 1.6.7 bumped the Docker base off EOL Node 20). 1.6.8 closes the underlying drift — tests the current LTS, removes EOL Node from the publish path, and writes down the lesson — so the same class of mistake is caught at ship-check next time rather than discovered in CI.

### Verification

- Node 24 native-dep load: ✓ (`node:24-slim`, `vec_version()=v0.1.9`)
- `tsc` build: clean
- All 5 `sqlite-vec` platforms in `package-lock.json`: ✓
- `npm audit --production`: 0 vulnerabilities (unchanged)
- CP-13 self-check on the 1.6.8 lockfile bump: ✓ (no dropped platforms, no native-dep version drift)

## [1.6.7] — 2026-05-27

Dockerfile patch — bump base image from `node:20-slim` to `node:22-slim`. **No engine code, MCP tool surface, platform, or env-var changes.**

### Fixed

- **`CI / docker build` failed on 1.6.6** with `npm error gyp ERR! find Python` — `better-sqlite3@12.10.0` (which my 1.6.6 lockfile regen happened to pull within the `^12.9.0` caret) [explicitly dropped prebuilds for Node.js v20 and v23](https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.10.0) because Node 20 reached end-of-life in April 2026. Without a prebuilt binary, `npm ci` fell through to `node-gyp rebuild`, which needs Python + a C++ toolchain — neither are present in `node:20-slim`. The CI matrix's Node 18/20/22 jobs still pass because they install on macOS/Ubuntu with a working build environment as fallback. Only the slim Docker image hit the floor.
- Bumped the Dockerfile's base image to `node:22-slim`, the current active LTS line where `better-sqlite3` still ships prebuilts. Verified locally: container builds clean, `require('better-sqlite3')` + `require('sqlite-vec')` both load in the runtime image.

### Why now, not later

Node 20 transitioned to EOL last month (April 2026). The ecosystem's first reaction (better-sqlite3 dropping Node 20 binaries in 12.10.0) just hit us via the caret resolution. The honest fix is to follow the ecosystem off Node 20, not pin around it.

### Note on the CI test matrix

`.github/workflows/ci.yml` still tests Node 18, 20, and 22 across macOS + Ubuntu. Node 18 reached EOL in April 2025 and Node 20 in April 2026, but both have working install paths (with prebuilts or fallback compile) in regular CI environments — only the slim Docker image stumbles because it lacks the toolchain. Whether to prune those matrix entries is a separate question; 1.6.7 doesn't touch them.

### Verification

- `docker build -t clarifyprompt-mcp:ci-test .` locally: clean, 13 layers, no errors.
- `docker run ... node -e 'require("better-sqlite3"); require("sqlite-vec")'`: both native deps load.
- All 5 `sqlite-vec` platform binaries still in `package-lock.json` (the 1.6.6 fix held).
- `npm audit --production`: 0 vulnerabilities (unchanged).
- `tsc` build: clean.

## [1.6.6] — 2026-05-27

Lockfile + harness patch. **No engine code, MCP tool surface, platform, or env-var changes.** Ships the MCP-completeness audit doc that was promised in `docs/audits/`.

### Fixed

- **`package-lock.json` was missing 4 of 5 `sqlite-vec` platform binaries.** During the 1.6.5 SDK bump I regenerated the lockfile with `npm install --package-lock-only`, which silently dropped the optional `sqlite-vec-darwin-x64`, `sqlite-vec-linux-arm64`, `sqlite-vec-linux-x64`, and `sqlite-vec-windows-x64` entries — keeping only the `sqlite-vec-darwin-arm64` binary for my host platform. The 1.6.5 *npm tarball* was fine (end-user `npm install` resolves all platforms at install time), but **`npm ci` against the committed lockfile** — which is what GitHub Actions uses — could only find the macOS-ARM binary. On Ubuntu CI this surfaced as `no such module: vec0` errors in the memory-and-packs fixtures: 4 fixtures errored (`memory-pack-chunk-grounds-optimize`, `memory-search-ranks-pack-by-similarity`, `memory-remember-persists`, `memory-forget-invalidates`). Regenerated with a full `npm install` (not `--package-lock-only`) so all 5 platform binaries are back in the lock.
- **`evals/run.mjs` HTML report writer crashed on ERRORED entries.** Line 729 assumed every non-skipped, non-filtered run had an `evaluation.checks` field, but errored runs (where the fixture setup or run itself threw) don't go through evaluation — they have an `error` field instead. Symptom on CI: even with the sqlite-vec issue forcing 4 errors, the harness's per-fixture summary printed correctly, but the final `writeHtmlReport` step crashed with `TypeError: Cannot read properties of undefined (reading 'checks')`, exiting the whole workflow at code 2 instead of cleanly reporting "22 passed, 4 errored." Added an explicit errored-status branch that emits a fail-styled row with the error message. The harness now degrades gracefully.

### Why this matters

The 1.6.5 release that just shipped to npm is **functionally correct for end users** — the npm tarball doesn't ship a lockfile, so users' `npm install` resolves all platforms freshly. But our CI publish gate was broken, which would have blocked every future tag-push from publishing. 1.6.6 restores the gate.

### Verification

- `npm install` (clean): all 5 sqlite-vec platforms back in `package-lock.json`.
- `npm audit --production`: 0 vulnerabilities (unchanged from 1.6.5).
- `tsc` build: clean.
- `node evals/run.mjs --quiet` locally: exits 0, no harness crash even when fixtures error.

### Bundled docs

- New `docs/audits/mcp-completeness-2026-05.md` — full audit of the engine's MCP surface against the current SDK + spec. Tool-by-tool registration table, resource gap analysis, SDK feature delta (1.12 → 1.29 → 2.0-alpha), capability declarations, transport refactor sketch, A2A feasibility note, and a 7-step modernization roadmap. Diagnostic only — no engine code changes prescribed inline. This is the artifact behind the next-session planning around MCP modernization + A2A enablement.

## [1.6.5] — 2026-05-27

Security patch. Bumps `@modelcontextprotocol/sdk` floor from `^1.12.1` to `^1.29.0` and `zod` floor from `^3.24.0` to `^3.25.76`. **No engine code changes, no MCP tool surface changes, no platform changes, no env-var changes.**

### Security

- **CVE-2026-0621** — ReDoS vulnerability in `UriTemplate` regex patterns. Fixed upstream in `@modelcontextprotocol/sdk@1.25.2`. ClarifyPrompt's previous `^1.12.1` declaration *allowed* caret-resolution to a vulnerable floor; users with `npm` caches pinning to `1.12.x` were exposed. The new `^1.29.0` floor guarantees the patched version.
- **GHSA-345p-7cg4-v4c7** — Shared server/transport instances leak cross-client response data. Fixed upstream in `@modelcontextprotocol/sdk@1.26.0`. ClarifyPrompt is not multi-tenant in practice (one MCP host = one server instance), but the floor bump removes the vulnerable code path from the dependency graph entirely.
- **7 transitive vulnerabilities** (2 moderate, 5 high) in the SDK's HTTP-transport substack (`hono`, `express-rate-limit`, `fast-uri`, `ip-address`, `path-to-regexp`, `qs`, `@hono/node-server`) — cleared via `npm audit fix`. These never affected runtime behavior (ClarifyPrompt is stdio-only and doesn't load the HTTP transport) but they showed up in users' `npm audit` and made the install look unsafe.

`npm audit --production` now reports **0 vulnerabilities** against the new floor.

### Why the bump matters beyond CVEs

The previous `^1.12.1` declaration was misleading documentation — caret resolution was actually pulling SDK `1.27.1` in fresh installs. The floor bump aligns the declared baseline with what `npm` was already doing for most users, while guaranteeing the floor for users on stale caches. It also positions us for a clean migration when the SDK's `2.0.0-alpha` series stabilizes (it removes `.tool()` / `.prompt()` / `.resource()` shorthand registration in favor of `registerTool()` etc.).

### Verification

- `tsc` build: clean.
- `npm run test:wire`: MCP stdio protocol verified end-to-end with `qwen2.5-coder:7b-instruct-q4_K_M`. All 7 wire stages green.
- `npm run test:integration`: all 9 cases green.
- `npm run test:day2` + `test:reasoning`: green.
- `npm run eval`: 29/30 fixtures pass on local Ollama. The one fail (`analyzer-creative-media`) is a pre-existing qwen-coder-7b classifier flake — verified SDK-independent by stash-reverting and re-running against the previous SDK (identical failure mode, same misclassification). On CI against `gpt-4o-mini` the fixture passes as it has since 1.6.0.

### Migration

None. Anyone on `clarifyprompt-mcp@1.6.4` with a normal `npm install` was already getting SDK `1.27.1` via caret. Upgrading to `1.6.5` just makes the floor honest and clears the audit warnings.

## [1.6.4] — 2026-05-27

Docs + process patch. **No engine code changes; no MCP tool surface changes; no platform changes; no env-var changes.**

This release resolves a long-standing architectural inconsistency: from `1.3` onward there were two homes for knowledge packs — `clarifyprompt-mcp/packs/*.md` (which actually shipped in every npm tarball and is what the engine's `load_knowledge_pack` and platformLoader code reads) and the standalone `LumabyteCo/clarifyprompt-packs` registry repo (which the engine never touched but whose README told users to fetch packs from there). The drift caught up: the `higgsfield-creative-handbook` pack shipped in `1.6.2` directly to the engine repo and never made it to the registry.

### Changed

- **Pack distribution consolidated into a single repo.** `LumabyteCo/clarifyprompt-packs` has been archived on GitHub with a tombstone README that redirects to this repo. All four bundled knowledge packs (`anthropic-brand-voice`, `higgsfield-creative-handbook`, `nextjs-14-best-practices`, `sox-compliance`) plus all platform configs (`packs/platforms/*.yaml`) now have a single source of truth: this repo.
- **New `packs/README.md`** — pack-authoring guide lifted from the archived registry's README + `CONTRIBUTING.md`. Documents the YAML frontmatter schema, H2 chunk-boundary rules, the quality bar that gets PRs merged, and the directory's two-content-types model (knowledge packs in `packs/*.md`, platform configs in `packs/platforms/*.yaml`).
- **New `## Knowledge packs` section in this README** — explains what packs are, the four bundled starter packs, how to call `load_knowledge_pack` against either GitHub raw URLs or local paths, the `user` / `project` / `session` scope semantics, how to contribute new packs, and the rationale for keeping packs in the engine repo at current scale.
- **Architecture tree updated** — `packs/` is no longer labeled `(1.3.0)` since the 1.3.0 timeframe was when packs briefly moved external. The single-source-of-truth model is `1.6.4+`.
- **Fixed placeholder URL** in the 1.6.2 release notes — previously `https://raw.githubusercontent.com/.../packs/higgsfield-creative-handbook.md`, now the canonical `https://raw.githubusercontent.com/LumabyteCo/clarifyprompt-mcp/main/packs/higgsfield-creative-handbook.md`.

### Why now, and why this direction

At current scale (~10 users, 4 packs, all authored by the maintainer, zero external pack PRs, registry repo at 1 commit in a month), the cost of keeping two repos in sync was paying for a community-contribution surface that hadn't materialized. The split-repo approach makes structural sense once there's a forcing function — a real PR queue, pack count >20, or divergent licensing/governance. Until then the single-repo model keeps the source of truth singular, removes drift risk by construction, and lowers the barrier for the few users who do exist (one repo to star, one CHANGELOG to follow, one place to PR).

### Migration

None. Any code that was loading packs via either `https://raw.githubusercontent.com/LumabyteCo/clarifyprompt-packs/main/packs/<name>.md` or the bundled `packs/<name>.md` path still works:

- The old registry URL still resolves to the archived repo content (the three starter packs remain at their historical paths there as well).
- The engine repo's `packs/<name>.md` paths are unchanged.
- The npm tarball ships the same `packs/` contents as 1.6.2 / 1.6.3.

The recommended URL going forward is `https://raw.githubusercontent.com/LumabyteCo/clarifyprompt-mcp/main/packs/<name>.md` (canonical, version-tracked alongside the engine).

## [1.6.3] — 2026-05-26

Patch. CI hardening + one cosmetic README fix. No engine code changes; no MCP tool surface changes; no platform changes; no env-var changes.

The 1.6.2 tag-push CI run surfaced two latent fixture issues that local development doesn't hit:

### Fixed

- **`evals/fixtures/28-context-includes-git-state.yaml`** — previously asserted `git_branch_present: true`. CI's `actions/checkout@v4` checks out in detached-HEAD mode where `git rev-parse --abbrev-ref HEAD` returns `HEAD`, which `gitSignals.ts` correctly maps to `bundle.git.branch === undefined`. The branch-present check was over-strict for CI. Relaxed to `bundle_has_git: true` (always populated by SHA + recent commits in any readable repo, including detached-HEAD checkouts).
- **`evals/fixtures/17-critique-strong-prompt-accepts.yaml`** — previously asserted `verdict: accept` + `overall_score_min: 7`. The fixture's strong prompt is unambiguously good, but gpt-4o-mini's judge calibrates stricter than qwen2.5-coder:7b's, and on one CI run returned a non-numeric `overall` field that the parser defaulted to 0 → verdict downgraded to `reject` → fixture marked failing. The fixture's real intent is to verify engine wiring (5+ dimensions returned, standard dimension names present, no harness error), not to grade judge calibration across model classes. Dropped the verdict assertion + lowered `overall_score_min` to 3 (catches genuine 0-floor failures but doesn't flake on legitimately strict judges).
- **README Glama badge** — replaced inline `<img>` (which intermittently renders broken via GitHub's camo image proxy despite Glama serving a valid PNG) with a shields.io text-link badge. Same target URL, more stable rendering.

### Notes

- **CI gate now clears on both new fixture configurations.** The two relaxations are explicitly documented in the fixture descriptions so anyone reading them later sees why the assertions are calibrated this way.
- **Eval coverage is materially unchanged.** The relaxed assertions still catch real engine bugs (a broken curator wouldn't populate `bundle.git` at all; a broken critique parser would return zero dimensions, not a strict judge verdict).
- **The CI publish-gate failure on the v1.6.2 tag** was downstream of the eval failure — once evals pass on the v1.6.3 tag SHA, the gate clears.

## [1.6.2] — 2026-04-28

Patch release. Two additive ships — one user-facing (Higgsfield knowledge pack), one maintainer-facing (multi-model eval matrix runner). No engine code changes, no MCP tool surface changes, no env-var changes.

### Added

- **`packs/higgsfield-creative-handbook.md`** — knowledge pack with model-selection rules, Soul ID workflow, camera-move vocabulary, prompt-structure pattern, multi-reference editing, Marketing Studio modes, common pitfalls, output specs. Pairs with the `higgsfield` platform entries from 1.6.1. 9 H2-chunked sections; Context Curator pulls relevant chunks via semantic retrieval when targeting Higgsfield.
- **`evals/matrix.mjs` — multi-model eval matrix runner.** New `npm run matrix` script. Runs the eval harness sequentially against N models, produces a side-by-side HTML (`evals/matrix.html`). Lights up the model-class-gated fixtures (`shape-small-local-model` / `shape-mid-tier-model` / `shape-reasoning-model`) that single-model runs skip. Usage: `npm run matrix -- --models a,b,c`. Optional `--filter`, `--output`, `--quiet` flags.
- **`evals/run.mjs --json-out <path>`** — new flag that writes structured per-model results to JSON. Used internally by `matrix.mjs`; also useful for CI agents that want machine-readable run data.

### Notes for integrators

- **npm tarball grows ~10 KB** for the knowledge pack file. `evals/matrix.mjs` is NOT in `package.json#files` — it's a maintainer/contributor tool that runs from a cloned repo, not a runtime artifact.
- **No env-var changes.** `--json-out` is opt-in.
- **No MCP tool surface changes.** Still 23 tools.
- **Existing CI eval gate behavior unchanged** — it doesn't pass `--json-out`, so output is identical to 1.6.1.

## [1.6.1] — 2026-04-28

Patch. Adds **[Higgsfield](https://higgsfield.ai)** as a multi-model platform in both `image` and `video` categories. Pure YAML platform-pack additions; no code changes; no MCP tool surface changes.

### Added

- **`higgsfield` platform in `packs/platforms/image.yaml`** — exposes the 7 image models Higgsfield routes to (Soul 2.0, Soul Cinema, Soul Cast, Flux 2, Seedream 5, Nano Banana Pro, GPT Image 2) plus Soul ID (face-faithful character reuse) and multi-reference compositing as syntax hints.
- **`higgsfield` platform in `packs/platforms/video.yaml`** — exposes the 6 video models (Cinema Studio, Sora 2, Veo 3.1, Kling 3.0, WAN 2.6, Seedance 2.0) plus Lipsync Studio / UGC Factory / Cinema Studio mode hints.
- **`evals/fixtures/30-higgsfield-platform-loaded.yaml`** — regression check that the new YAML entries load and the curator selects `platform-hints` for `higgsfield` targets.

### Pairing pattern

Higgsfield exposes its own hosted MCP server at `https://mcp.higgsfield.ai/mcp` (`generate_image`, `generate_video`, `show_characters`, `virality_predictor`, etc., authenticated by Higgsfield account; no API key). The intended composition pattern: install BOTH `clarifyprompt-mcp` AND Higgsfield's MCP in your client. Use ClarifyPrompt's `optimize_prompt(platform: 'higgsfield', ...)` or `compose_prompt(platform: 'higgsfield', ...)` to compile the natural-language prompt with Higgsfield's syntax conventions, then pass the compiled prompt to Higgsfield's MCP for actual generation. MCPs compose at the client; ClarifyPrompt stays at the "compile" layer.

### Notes for integrators

- Platform counts: 58+ → 60+ across the README. **Image: 10 → 11, Video: 11 → 12.**
- 29 → 30 eval fixtures.
- No env-var changes. No MCP tool surface changes (still 23 tools).
- Same publish surface; tarball grows by ~2 KB for the YAML additions.

## [1.6.0] — 2026-04-28

Four targeted additions, one across each engine pillar — memory, agentic, models, context. **3 new MCP tools** (20 → 23). **6 new eval fixtures** (23 → 29). Fully back-compat with 1.5.x.

### Added

**Memory pillar — explicit CRUD (Me1).** Three new tools that complement reflection-on-`save_outcome`:

- **`memory_remember`** — explicitly insert a `(subject, predicate, object)` triple. Source tagged `user:explicit`. Auto-embedded for future semantic retrieval. Returns the new fact id.
- **`memory_forget`** — bi-temporal soft-delete by id (sets `invalidated_at`). Idempotent; returns `success: false` cleanly for non-existent or already-invalidated ids.
- **`memory_list_facts`** — list live facts in a scope (default `user`), optionally filtered by predicate, sorted by recency.

Closes the obvious UX gap where the engine could only learn from outcomes — users can now say "remember I prefer X" directly.

**Agentic pillar — `compose_prompt` revise loop (A1).** New `max_iterations` field (default 1, hard max 5). With `auto_revise: true` AND `post_critique: true`, the engine feeds each iteration's `improvedPrompt` back through optimize+critique until verdict=accept, no improvedPrompt is available, or the cap is reached. Pre-clarify only runs once. Response includes new `iterations` field.

**Models pillar — per-stage routing in `compose_prompt` (M1).** Three new fields: `clarify_model`, `optimize_model`, `critique_model`. Each overrides the env `LLM_MODEL` for that stage. Lets users route clarify→cheap-local, optimize→frontier-hosted, critique→cheap-judge. `optimization.metadata.model` and `critique.judgeModel` in the response now reflect the actual model that ran each stage.

**Context pillar — git-state + environment signals (C1 + C4).** Two new bundle fields populated automatically:
- **`bundle.git`** — current branch, short SHA, dirty flag, last 5 commit titles. Detected via `git rev-parse` / `git status` / `git log`; fails soft when cwd isn't a repo (returns `undefined`).
- **`bundle.environment`** — `nowIso` / `weekday` / `timezone` (IANA). Pure JS, never fails.

Both feed the Context Curator as low-base-utility candidates (`source: 'git-state'`, `source: 'environment'`); won't dominate budget but surface when relevant.

### Eval coverage

29 fixtures total (was 23). New: `memory-remember-persists`, `memory-forget-invalidates`, `compose-loop-iterates`, `compose-per-stage-models-honored`, `context-includes-git-state`, `context-includes-environment-time`.

Local baseline (qwen2.5-coder:7b-instruct-q4_K_M): **25 passed / 1 failed / 3 skipped / 97% avg**. The lone failure remains the persistent `analyzer-creative-media` model-class signal.

New harness check types: `iterations_min`, `iterations_max`, `optimization_model_eq`, `critique_model_eq`, `bundle_has_git`, `bundle_has_environment`, `git_branch_present`.

### Changed

- `MemoryStore.invalidateFact()` now returns `boolean` (was `void`) — true when an actual invalidation happened. Backward-compat: existing caller in `reflection.ts` ignored the return value, unaffected.

### Notes for integrators

- **No env-var surface changes.** All new fields are additive.
- **23 MCP tools, 1 resource.** No tools removed.
- **Same tarball anatomy.** Just slightly larger source.
- **Existing memory.db files** are fully forward-compat. The dimension fix from 1.5.2 still applies; if you switched embedders mid-flight, you might already have multiple `embeddings_<dim>` tables. That's fine.

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
