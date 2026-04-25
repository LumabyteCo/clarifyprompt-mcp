# tests/

End-to-end test batteries for ClarifyPrompt. **Live LLM-driven** — they require a running Ollama (or any OpenAI-compatible LLM endpoint) plus a working embedding model. They are **not** unit tests; they verify the engine end-to-end against real model behavior.

## Quick start

```bash
# 1. Make sure Ollama has the models the batteries use
ollama pull qwen2.5-coder:7b-instruct-q4_K_M    # default classifier + optimize model
ollama pull qwen2.5:14b-instruct-q4_K_M          # larger generalist
ollama pull llama3.2:3b                           # small generalist
ollama pull nomic-embed-text:v1.5                 # embeddings (memory + packs)

# 2. Build the dist
npm run build

# 3. Run any of the four batteries
npm run test:integration       # 1.2 Definition-of-Done — analyzer, mode arbitration, grounding, etc.
npm run test:day2              # 1.3 — memory store, packs, curator, reflection, save_outcome
npm run test:reasoning         # cloud + reasoning-model coverage (gpt-oss / kimi-thinking / etc.)
npm run test:wire              # MCP stdio protocol — initialize / tools/list / tool calls
npm run test:all               # all four, sequential
```

Each battery prints a final `✔ All checks passed` or `✖ failures` line so they're easy to grep.

## What each battery does

### `integration.mjs` — Definition-of-Done battery
The 9 cases that proved 1.2.0's Context Engine integration is real, not bolted-on. Covers:
- Server advertises correct version + tool count
- `"validate emails"` correctly routes to `code` not `document` (analyzer fix)
- Mode arbitration: explicit-user vs. analyzer-derived
- Target-model-aware shape (small local vs. larger model gets different `systemPromptBudget`)
- `save_outcome` → similar-prompt retrieval injects accepted examples
- Legacy `CLARIFYPROMPT_CONFIG_DIR` still works with deprecation hint
- Structured error handler when LLM is unreachable
- Intent overlay survives compact-budget shape trimming
- `CLAUDE.md` grounding actually changes output

### `day2-memory-and-curator.mjs` — 1.3 features
- 16 MCP tools registered including `save_outcome`, `load_knowledge_pack`, `memory_search`, `explain_last_curation`
- Pack load → chunk → embed → semantic retrieval roundtrip
- Memory + curator integration (curation log includes pack-chunk grounding sources)
- Reflection extracts facts from accepted optimizations
- Unload pack cascades chunks + embeddings

### `reasoning-models.mjs` — cloud + reasoning coverage
- Capability flag detection across families (`o3`, `deepseek-r`, `gpt-oss`, `kimi-thinking`, etc.)
- `getPromptShape` bumps `maxTokens` for reasoning models
- Live test against gpt-oss cloud (proves prebuilt-binary path works)
- Structured-error fallback when cloud upstream returns 500

### `mcp-wire.mjs` — MCP stdio protocol
- Drives the actual server binary over stdio JSON-RPC
- `initialize`, `tools/list`, `tools/call` for `inspect_context`, `optimize_prompt`, `list_traces`, `get_trace`, `list_categories`
- The same protocol any MCP host (Claude Desktop / Cursor / Claude Code) speaks

## Helper

`_runner.mjs` is a single-job child-process runner. Used by `reasoning-models.mjs` to spawn a fresh Node process per `(model, request)` pair so the LLMClient singleton is correctly bound to the tested model. Don't run it directly.

## CI integration (current state)

GitHub Actions CI (`.github/workflows/ci.yml`) runs:
- `npm run build` on Node 18/20/22 × ubuntu/macos
- Container smoke-test (initialize roundtrip)
- Secrets sweep
- Docker build + container startup

It does **NOT** run these batteries because they need a live LLM endpoint. To run them in CI you'd need either:
- A self-hosted runner with Ollama installed, or
- A cloud LLM key in repo secrets (e.g. `OPENAI_API_KEY` for `gpt-4o-mini` as the test model)

Open question for 1.4+: add an opt-in CI job that runs `test:integration` against `gpt-4o-mini` if the secret is set.

## Adding a new battery

1. Create `tests/<name>.mjs`. Use the prelude from existing files (REPO_ROOT / startServer / kv helpers).
2. Print a clear `✔ All checks passed` or `✖ failures` on the last line.
3. Add an npm script: `"test:<name>": "node tests/<name>.mjs"`.
4. Document it here.

If the new battery exercises a new MCP tool or response field, also add a fixture to the eval harness in `evals/` (Pass 2+).
