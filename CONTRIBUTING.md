# Contributing to ClarifyPrompt

Thanks for looking. ClarifyPrompt is an open-source MCP prompt compiler under **Apache-2.0, forever** — no relicensing, ever. We ship fast and take contributions that are specific, well-scoped, and include tests.

## Fast paths

| I want to… | Best starting point |
|---|---|
| Report a bug | [File a bug](https://github.com/LumabyteCo/clarifyprompt-mcp/issues/new?template=bug_report.yml) |
| Propose a feature | [File a feature request](https://github.com/LumabyteCo/clarifyprompt-mcp/issues/new?template=feature_request.yml) |
| Add a knowledge pack | PR to [LumabyteCo/clarifyprompt-packs](https://github.com/LumabyteCo/clarifyprompt-packs) |
| Add a model to the capability table | Edit [`src/engine/context/targetModelSignals.ts`](src/engine/context/targetModelSignals.ts) — data-only, very welcome |
| Report a security issue | Private — see [SECURITY.md](SECURITY.md) |
| Ask a question | [GitHub Discussions](https://github.com/LumabyteCo/clarifyprompt-mcp/discussions) |

## Local setup

```bash
git clone https://github.com/LumabyteCo/clarifyprompt-mcp.git
cd clarifyprompt-mcp
npm install
npm run build
```

**Requirements:** Node 18+, and an Ollama (or other OpenAI-compatible LLM + embeddings endpoint) you can point the server at for integration testing.

```bash
# Pull the default embedding model if you're on Ollama
ollama pull nomic-embed-text
```

## Running the server locally

```bash
export LLM_API_URL=http://localhost:11434/v1
export LLM_MODEL=qwen2.5-coder:7b-instruct-q4_K_M
export CLARIFYPROMPT_HOME=/tmp/clarify-dev
npx @modelcontextprotocol/inspector node dist/index.js
```

The inspector UI lets you exercise every tool interactively while you iterate.

## What we welcome

- **Data additions.** New models in the capability table, new starter packs, new provider entries in `.env.example`. Low-friction PRs; usually merged same-day.
- **Bug fixes with a reproducer.** Add a failing case first, fix it, ensure the integration + Day-2 batteries still pass.
- **New MCP tools that fit the four-pillar frame** (system / MCP & data / tools / history). Discuss the design in an issue first if the shape isn't obvious.
- **Docs improvements.** Typo fixes to overhauls — both useful.

## What needs more discussion first

- **Changes to the core analyzer or curator scoring.** These affect every downstream behavior. Open an issue describing the problem + proposed change before PR'ing.
- **New dependencies.** Especially native modules. We try hard to keep the tree small + auditable.
- **Breaking API changes.** Require a major-version bump and a documented migration path.

## What we won't merge

- **Relicensing away from Apache-2.0.** The license is a public commitment.
- **Outbound telemetry or phone-home callbacks** of any shape. Everything stays local or goes only to endpoints the user explicitly configured.
- **Code that requires a paid LumabyteCo service** to function. Anything hosted ships as a separate product on top of the OSS core, never inside it.
- **PRs without tests for behavior changes.** Small exception for docs/data-only PRs.

## Commit + PR etiquette

- **Branch from `main`.** Commit-graph-wise we prefer a linear history; rebase before merging if there's drift.
- **Commit messages** — short imperative title + a body that explains *why*, not just what. See recent commits for the house style.
- **Co-Authored-By trailers** are welcome for paired/AI-assisted work.
- **Keep PRs small.** One concern per PR. "Rewrite 3 subsystems" will get asked to split.
- **CHANGELOG.md** — add a bullet under the appropriate release section (or create `## [Unreleased]` if none exists).
- **README** — update if your change is user-facing.

## Tests

Today there are three test batteries (all in `/tmp/clarify-*-test.mjs`, driven by local Ollama + a real embedding model):

- **Integration battery** — Definition-of-Done cases for the Context Engine + Curator.
- **Day-2 battery** — memory, packs, reflection, `explain_last_curation`.
- **Reasoning battery** — cloud-model + reasoning-variant coverage.

Run them against your local stack before opening a PR that touches the engine. The CI workflow on `main` runs the deterministic pieces (typecheck, Docker build, secrets sweep, container startup) on every push + PR.

If your PR adds a new feature, add a test case to the appropriate battery (or propose a new one in the PR description).

## Release process (for maintainers)

1. Bump `version` in `package.json`, `server.json` (both places), and `src/index.ts`. Run `npm install --package-lock-only` to update the lockfile.
2. Add a CHANGELOG entry dated today.
3. Commit + push.
4. `git tag -a v<x.y.z> -m "…"` + `git push origin v<x.y.z>`.
5. CI picks up the tag and publishes to npm automatically (requires `NPM_TOKEN` secret — see [`ci.yml`](.github/workflows/ci.yml)).
6. `gh release create v<x.y.z> --notes-file <tmp>` for the GitHub Release.

## Governance

- Lumabyte Co. owns the repo and the npm package.
- Design decisions that affect the public API surface go through an issue → discussion → merge path.
- The license is Apache-2.0, forever. That isn't revisitable.

## Code of Conduct

Be kind, precise, and respectful. Racist, sexist, homophobic, or personally attacking contributions get reverted; repeat offenders get blocked. No formal CoC document yet — this line is it for now.

---

Thanks for reading. PRs welcome; questions welcome too.
