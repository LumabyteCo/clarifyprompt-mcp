# evals/ — quantified eval harness for ClarifyPrompt

The `tests/` batteries verify that things **work**. The `evals/` harness measures **how well** they work, against a fixture set, with deterministic scoring. Once it's running, every change to the engine — new tool, new shape rule, tweaked analyzer prompt — gets a number you can compare against the baseline.

## Quick start

```bash
# pull the LLM you want to evaluate (the harness uses LLM_MODEL just like the server)
ollama pull qwen2.5-coder:7b-instruct-q4_K_M
ollama pull nomic-embed-text:v1.5

# build, then run
npm run build
npm run eval
```

Output: console summary + `evals/report.html` (self-contained, dark-themed, openable in any browser).

## Filtering

```bash
npm run eval -- --filter analyzer        # only fixtures with 'analyzer' in name or tags
npm run eval -- --filter regression      # only regression-tagged fixtures
npm run eval -- --no-html                # skip HTML report (CI-friendly)
npm run eval -- --quiet                  # exit-code-only (CI gating)
```

## A/B comparing across models

The harness uses your current `LLM_MODEL`. To matrix across multiple, run it a few times:

```bash
LLM_MODEL=llama3.2:3b                          npm run eval -- --report-path evals/report-3b.html
LLM_MODEL=qwen2.5-coder:7b-instruct-q4_K_M      npm run eval -- --report-path evals/report-7b.html
LLM_MODEL=qwen2.5:14b-instruct-q4_K_M           npm run eval -- --report-path evals/report-14b.html
```

Each report stands alone; eyeball them side-by-side or diff the JSON in a future v1.

## Fixture format

One YAML file per fixture in `evals/fixtures/`. Schema is in [`evals/schema.json`](./schema.json). Minimal example:

```yaml
name: analyzer-emails-as-code
description: '"validate emails" routes to code, not document'
tags: [analyzer, regression]
input:
  prompt: 'write a function to validate emails'
expected:
  category: code
  intent: production-code
  no_error: true
```

### Available `expected` keys

Every key is optional. The harness only scores what you declare.

| Key | Meaning |
|---|---|
| `category`, `platform`, `intent`, `mode`, `mode_source`, `recommended_mode`, `shape_budget` | Equal-match assertions on the corresponding result field |
| `intent_confidence`, `intent_confidence_min` | `low` / `medium` / `high` — the `_min` variant accepts higher confidence too |
| `shape_max_tokens_min`, `shape_max_tokens_max` | Bounds on `result.shape.maxTokens` |
| `must_contain`, `must_not_contain` | Case-insensitive substring matches against `optimizedPrompt` |
| `min_output_length`, `max_output_length` | Length bounds on `optimizedPrompt` |
| `grounding_sources_must_include` / `_must_exclude` | Each entry matches an exact source ID or a prefix (e.g. `memory:` matches `memory:fact:42`) |
| `system_prompt_must_contain` | Substrings in the rendered system prompt (read from the trace) |
| `no_error: true` | `result.error` must be absent |

### Conditional execution

```yaml
skip_unless_model_matches: 'qwen.*14b'    # only run when LLM_MODEL matches this regex
skip_if_model_matches: 'llama3\.2:3b'     # skip when LLM_MODEL matches (e.g. tiny model known to fail this assertion)
```

### Workspace materialization

Fixtures can declare files that get written to a temp directory; that directory is passed as `cwd` so the engine sees those files as workspace context:

```yaml
requires_workspace:
  'package.json': '{ "name": "demo", "dependencies": { "next": "^14" } }'
  'CLAUDE.md': |
    # rules
    - tone: warm
```

This is how the grounding fixtures (`11-grounding-claude-md`, `12-grounding-no-workspace-rules`) prove that workspace rules actually change the output.

## Scoring

Each fixture earns a score in `[0, 1]` — the weighted-pass-rate of its declared checks. Default weights:

| Check class | Weight |
|---|---|
| `category`, `must_contain`, `no_error` | **2.0** |
| `intent`, `must_not_contain`, `grounding_sources_*`, `system_prompt_must_contain` | **1.5** |
| `platform`, `intent_confidence*`, `mode`, `mode_source`, `recommended_mode`, `shape_budget` | **1.0** |
| `shape_max_tokens_*`, `min/max_output_length` | **0.5** |

A fixture **passes** when its score is ≥ 0.85 (the `PASS_THRESHOLD` constant in `run.mjs`).

The aggregate "average score" line in the summary is the unweighted mean of fixture scores — a single number that should trend up as the engine improves.

## Adding a new fixture

1. Copy any `evals/fixtures/*.yaml` as a template.
2. Pick a `name` matching the filename (the leading `NN-` is just sort order).
3. Set the `input` to mirror the `optimize_prompt` MCP tool args.
4. Declare the `expected` checks that *must* hold for this fixture's value to be useful.
5. Add `tags` to make it filterable.
6. Run `npm run eval -- --filter <your-fixture-name>` to verify before committing.

## CI integration (opt-in)

The harness runs in GitHub Actions as a release gate when an `OPENAI_API_KEY` repo secret is configured. It uses `gpt-4o-mini` (~$0.005 per CI run on the current 17 active fixtures). To enable on your fork:

1. Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
2. Name: `OPENAI_API_KEY` · Value: an OpenAI API key with access to `gpt-4o-mini`
3. Push or re-run any workflow

The `evals` job will:
- run `npm run eval` against `gpt-4o-mini`
- upload the generated `evals/report.html` as a build artifact (30-day retention)
- block the `publish` job (tag-triggered npm publish) if any fixture regresses

When the secret is **unset** (the default for forks): the job runs but skips the eval step with a banner explaining how to enable. Nothing leaves the machine without the secret. Forked PRs always skip cleanly because forks don't have access to the parent repo's secrets.

Workflow source: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — the `evals` job.

## What's NOT in v0

- **LLM-judge scoring at the harness level** — `critique_prompt` itself ships as a runtime tool in 1.4, but the harness's per-fixture scoring is still deterministic-only. Adding LLM-judge as an optional score-blender is a v1 candidate.
- **Cross-run trend dashboard** — each run is standalone HTML. v1 could persist results into a JSON timeline so you can see drift over commits or model versions.
- **Auto-tagging based on which engine surface the fixture exercises** — manual tags for now.
- **Memory-layer fixture coverage** — knowledge packs, reflection facts, vector retrieval ranking — the most-novel engine surface has the least eval coverage. Tracked as "D" in the post-1.4 backlog.
