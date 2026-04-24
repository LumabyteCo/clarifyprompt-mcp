---
name: ship-check (clarifyprompt-mcp overrides)
description: Repo-specific pre-ship audits for clarifyprompt-mcp. Loaded automatically by the user-scoped ship-check skill when running in this repo. Captures conventions that don't generalize to every project (yet). Trigger via the parent skill — don't invoke this file directly.
---

# ship-check — clarifyprompt-mcp overrides

Loaded by the user-scoped `ship-check` skill at `~/.claude/skills/ship-check/SKILL.md` when running audits in this repo. These checks are specific to clarifyprompt-mcp's conventions. Each one is tagged with a **generalization hint** — some are purely clarifyprompt-specific, others are patterns that would apply to any MCP server or any CLI-publishable npm package.

Run these **in addition to** the general checks. Report them in a separate `── project-specific ──` section of the final summary.

## Checks

### CP-1. Version consistency — extended files

Beyond the general version sources, this repo also has:

- `server.json` — **two** version fields: `$.version` (top-level) AND `$.packages[0].version` (npm subsection). Both must match `package.json`.
- `src/index.ts` — the `McpServer({ name, version })` literal must match.

**Generalization hint:** `server.json` is the MCP Registry manifest. Any MCP-server project will have this file with the same double-version quirk. **Promote to user-scope** once a second MCP project is audited.

### CP-2. `server.json` env-var declarations cross-check

Every env var documented in `.env.example` (non-comment, non-legacy lines) must have a corresponding entry in `server.json.packages[0].environmentVariables[*].name`. Currently expected:

```
LLM_API_URL, LLM_API_KEY, LLM_MODEL,
CLARIFYPROMPT_HOME, CLARIFYPROMPT_DATA_DIR, CLARIFYPROMPT_TRACE,
EMBED_API_URL, EMBED_API_KEY, EMBED_MODEL, EMBED_DIMENSION
```

Flag any env var in `.env.example` that isn't declared in `server.json`. The 1.3.0 → 1.3.1 cleanup we just did was caused by this gap; don't let it recur.

**Generalization hint:** applies to any MCP server project shipping a `server.json` manifest. **Promote** once any other MCP project uses ship-check.

### CP-3. README env-var reference table completeness

The README has an "Environment Variables" section with a markdown table. Every var in `.env.example` must appear as a row in that table. The reverse also holds — if a variable is in the table but not in `.env.example`, it's either obsolete or `.env.example` is out of date.

Regex for the table: find the heading `### Environment Variables` (or `## Environment Variables`) and parse the markdown pipe-table that follows.

**Generalization hint:** applies to any project that documents env vars in a README table. **Not quite promotable yet** — README structure varies too much across projects. Revisit once 3+ projects have this pattern.

### CP-4. `packs/` ships in the npm tarball

The `packs/` directory must be:
- Listed in `package.json#files` so npm includes it
- Contain at least the three starter packs (`nextjs-14-best-practices.md`, `anthropic-brand-voice.md`, `sox-compliance.md`)

Run `npm pack --dry-run` and confirm `packs/*.md` appears in the output.

**Generalization hint:** purely clarifyprompt-specific. Stays project-scoped.

### CP-5. Knowledge-pack format validity

For every file under `packs/*.md` (and any other pack dirs referenced in the README):

- File starts with `---` (YAML frontmatter delimiter) or is documented as frontmatter-less
- Frontmatter parses as YAML-lite (same parser semantics as `src/engine/memory/packs.ts:parsePackSource`)
- Required frontmatter fields present: `name`, `version`, `description`, `scope`, `author`, `license`
- Body has at least one H2 heading (packs chunk by heading; bodies without H2s become one massive chunk which is bad retrieval)

**Generalization hint:** purely clarifyprompt-specific. Stays project-scoped.

### CP-6. Companion registry sync check (soft warning, not a fail)

When preparing a release, the companion [LumabyteCo/clarifyprompt-packs](https://github.com/LumabyteCo/clarifyprompt-packs) repo should have the same 3 starter packs (or the user has consciously diverged them). This is a **warning only** — the two repos can legitimately drift (packs in the registry may be newer, or repo packs may be older "baseline"). Just flag the diff for human attention.

Run `gh api repos/LumabyteCo/clarifyprompt-packs/contents/packs` and compare filenames + sizes against `./packs/`.

**Generalization hint:** applies to any project that ships a "starter" kit which also lives in a companion registry (think language stdlib vs community packages). **Potential promote** but needs the general skill to learn the "companion registry URL" convention per-project.

### CP-7. Apache-2.0 license guard

This is non-negotiable: the project is Apache-2.0 forever (per the public commitment in CONTRIBUTING.md and SECURITY.md).

- `LICENSE` file must exist and start with "Apache License"
- `package.json#license` must be `"Apache-2.0"`
- Don't let a PR slip through that changes either.

**Generalization hint:** any license commitment applies to any OSS project. **Promote** as a parameterized check (project declares its committed license; skill enforces it).

### CP-8. Integration test harness availability (informational)

When preparing a major release (anything that bumps the minor version), check that the integration test batteries exist and can at least start:

- `/tmp/clarify-integration-test.mjs` (1.2 Definition-of-Done cases)
- `/tmp/clarify-day2-test.mjs` (1.3 memory + packs + curation)
- `/tmp/clarify-reasoning-test.mjs` (reasoning-model support)

These are in `/tmp/` today — not ideal for version control. **TODO:** move to `tests/` under version control before 1.4, and then this check becomes "do they pass?" rather than "do they exist?".

**Generalization hint:** integration-test-harness existence is general. Stays project-scoped until we move them into the repo.

### CP-9. `dist/` is gitignored AND not committed

- `dist/` in `.gitignore` — hard fail if not
- `git ls-files dist/` should return nothing

**Generalization hint:** applies to any compiled TypeScript project. **Promote** to user-scope.

### CP-10. Git tag format matches convention

For this repo, release tags use `v<major>.<minor>.<patch>` (e.g., `v1.3.1`). No `v1.3.1-beta`, no `release-1.3.1`, no unprefixed `1.3.1`.

**Generalization hint:** tag convention is per-project. Leave here; the user-scoped skill can gain a configurable pattern later.

## Notes for the next promotion pass

When the user next runs a skills consolidation pass, these are the strongest **promotion candidates** — patterns proven useful here that would help in most projects:

1. **CP-1 + CP-2 (MCP server.json awareness)** — every MCP server benefits.
2. **CP-7 (license commitment guard)** — every OSS project benefits.
3. **CP-9 (dist/ hygiene)** — every compiled-language project benefits.

The rest stay project-scoped unless proven useful in ≥ 2 other repos.

## Notes for re-running specific checks

Don't duplicate the general checks here. If a general check needs tuning for this repo (e.g., an additional secret pattern), override it in this file with a comment explaining why — don't just add a parallel variant.
