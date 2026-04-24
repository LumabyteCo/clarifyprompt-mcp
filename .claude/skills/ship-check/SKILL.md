---
name: ship-check (clarifyprompt-mcp overrides)
description: Repo-specific pre-ship audits for clarifyprompt-mcp. Loaded automatically by the user-scoped ship-check skill when running in this repo. Captures conventions that don't generalize to every project (yet). Trigger via the parent skill — don't invoke this file directly.
---

# ship-check — clarifyprompt-mcp overrides

Loaded by the user-scoped `ship-check` skill at `~/.claude/skills/ship-check/SKILL.md` when running audits in this repo. Uses the **cascade syntax** (CSS-like specificity) the parent skill defines:

- `OVERRIDE: <general-check>` — replace the general check entirely
- `DISABLE: <general-check>` — skip the general check, requires a rationale
- `AUGMENT: <general-check>` — keep general + add more
- `ADD: <new-check>` — a check with no general equivalent

Each directive is also tagged with a **generalization hint** — whether the check is purely repo-specific forever, or a candidate to promote back to the user-scoped skill once it proves useful elsewhere.

---

## AUGMENT: Version consistency — extra sources

Beyond the general version sources, this repo has:

- `server.json` → two version fields: `$.version` (top-level) AND `$.packages[0].version` (npm subsection). Both must match `package.json#version`.
- `src/index.ts` → the `McpServer({ name, version })` literal must match.

Run the general version-consistency check as-is, then additionally verify those two files.

**Generalization hint:** `server.json` is the MCP Registry manifest — any MCP-server project will have the same double-version quirk. **Promotion candidate** after a second MCP project adopts ship-check.

---

## AUGMENT: Secrets sweep — repo-specific guards

Keep all general secret patterns AND also hard-fail if any of these appear in tracked files:

- Any 40+ character hex string following `_authToken=` (a leaked `~/.npmrc` value).
- The literal token prefix we rotated during 1.2.0 prep: `npm_EYF3iBwo` (defense against someone accidentally re-adding it from transcript history).

The second pattern is an artifact of this project's history and expires once the token is safely out of our backscroll. Review quarterly; remove when no longer needed.

**Generalization hint:** "add project-specific secret patterns" is itself a general pattern — but the specific patterns here are clarifyprompt-only.

---

## ADD: CP-2 — server.json env-var declarations match `.env.example`

Every env var documented in `.env.example` (non-comment, non-legacy rows) must have a corresponding entry in `server.json.packages[0].environmentVariables[*].name`.

Current expected set:

```
LLM_API_URL, LLM_API_KEY, LLM_MODEL,
CLARIFYPROMPT_HOME, CLARIFYPROMPT_DATA_DIR, CLARIFYPROMPT_TRACE,
EMBED_API_URL, EMBED_API_KEY, EMBED_MODEL, EMBED_DIMENSION
```

**Hard fail** on any variable present in `.env.example` but missing from `server.json`. The 1.3.0 → 1.3.1 patch was caused by this gap.

**Generalization hint:** applies to any MCP-server project shipping a `server.json` manifest. **Strong promotion candidate.**

---

## ADD: CP-3 — README env-var reference table completeness

The README's `### Environment Variables` (or `## Environment Variables`) section includes a markdown pipe-table. Every variable in `.env.example` must appear as a row; reverse also holds.

**Soft fail** (warning, not blocker) on drift in either direction.

**Generalization hint:** README structure varies too much to promote yet. Revisit once 3+ projects adopt this pattern.

---

## ADD: CP-4 — `packs/` ships in the npm tarball

- `packs/` must be listed in `package.json#files`.
- Must contain at least the three starter packs: `nextjs-14-best-practices.md`, `anthropic-brand-voice.md`, `sox-compliance.md`.
- `npm pack --dry-run` must include `packs/*.md` in its output.

**Generalization hint:** purely clarifyprompt-specific. Stays project-scoped.

---

## ADD: CP-5 — knowledge-pack format validity

For every `packs/*.md` file:

- Starts with `---` YAML frontmatter delimiter.
- Parses under the same YAML-lite rules as `src/engine/memory/packs.ts:parsePackSource`.
- Required frontmatter: `name`, `version`, `description`, `scope`, `author`, `license`.
- Body contains at least one H2 heading (packs chunk by heading; no H2s = one giant unchunked chunk = bad retrieval).

**Generalization hint:** purely clarifyprompt-specific. Stays project-scoped.

---

## ADD: CP-6 — companion registry sync (soft warning)

When preparing a release, compare `./packs/` against [LumabyteCo/clarifyprompt-packs](https://github.com/LumabyteCo/clarifyprompt-packs) via `gh api repos/LumabyteCo/clarifyprompt-packs/contents/packs`. Flag any filename or size drift as a warning — the repos can legitimately diverge but it's worth a human look.

**Generalization hint:** any project with a "starter kit in main repo + curated companion registry" pattern benefits. Needs the general skill to learn a "companion registry URL" config field before it can promote.

---

## ADD: CP-7 — Apache-2.0 license guard

Non-negotiable per our public commitment in `CONTRIBUTING.md` and `SECURITY.md`:

- `LICENSE` file exists and starts with `"Apache License"`.
- `package.json#license === "Apache-2.0"`.
- Hard fail on any drift.

**Generalization hint:** any OSS project with a declared license benefits. **Promotion candidate** as a parameterized check (project declares its committed license; general skill enforces it).

---

## ADD: CP-8 — integration test batteries present (informational)

For minor-version prep (e.g. `1.3.0 → 1.4.0`), confirm the test batteries exist and can at least parse:

- `/tmp/clarify-integration-test.mjs` (1.2 Definition-of-Done cases)
- `/tmp/clarify-day2-test.mjs` (1.3 memory + packs + curation)
- `/tmp/clarify-reasoning-test.mjs` (reasoning + cloud-model coverage)

**TODO for 1.4:** move these from `/tmp/` into `tests/` under version control. Once moved, this check escalates from "do they exist?" to "do they pass?".

**Generalization hint:** test-harness existence is a general pattern; the file paths are project-specific. Stays project-scoped until the tests are repo-versioned.

---

## ADD: CP-9 — `dist/` is gitignored AND not committed

- `dist/` must appear in `.gitignore`.
- `git ls-files dist/` must return empty.

**Generalization hint:** applies to any compiled-language project (TypeScript, Rust, C++, Go-with-generated-artifacts). **Strong promotion candidate.**

---

## ADD: CP-10 — git tag format

Tags for this repo follow `v<major>.<minor>.<patch>` strictly (e.g. `v1.3.1`). No `v1.3.1-beta`, no `release-1.3.1`, no unprefixed `1.3.1`.

**Generalization hint:** tag convention is per-project. Stays scoped. General skill could gain a configurable pattern later if promoted.

---

## Promotion candidates — ranked

When the user next runs a skills consolidation pass, these are the strongest promotion candidates (proven useful here, should help most projects):

1. **`ADD: CP-2` (server.json env-var cross-check)** — every MCP server benefits.
2. **`ADD: CP-7` (license commitment guard)** — every OSS project benefits.
3. **`ADD: CP-9` (dist/ hygiene)** — every compiled-language project benefits.

The AUGMENT-level items (version consistency extras, secret pattern adds) are examples of how to use those operators rather than themselves promotable — they are already baked into the general skill's extension points.
