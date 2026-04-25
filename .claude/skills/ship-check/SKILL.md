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

## AUGMENT: Version consistency — extra source for MCP Node SDK

The general check already inspects `package.json`, `package-lock.json`, `server.json` (both top-level and `packages[*].version`), `CHANGELOG.md`, and ecosystem-specific manifests. This repo additionally has:

- `src/index.ts` → the `McpServer({ name, version })` literal must match all of the above.

Run the general check, then verify `grep -oE 'version: "[^"]+"' src/index.ts` matches `package.json#version`.

**Generalization hint:** the `src/index.ts` McpServer literal is specific to MCP servers built with `@modelcontextprotocol/sdk` for Node. **Promotion candidate** once a second such project adopts ship-check, with detection gated on the SDK being a declared dep.

---

## AUGMENT: Secrets sweep — repo-specific guards

Keep all general patterns AND additionally hard-fail on:

- Any 40+ character hex string following `_authToken=` (a leaked `~/.npmrc` value).
- The literal token prefix `npm_EYF3iBwo` we rotated during 1.2.0 prep — defense against someone re-adding it from transcript history.

The second pattern is an artifact of this project's history and expires once the token is safely out of all backscroll. Review quarterly; remove when no longer needed.

**Generalization hint:** "add project-specific secret patterns" is itself a general capability — the parent skill already supports it via this AUGMENT operator. The specific patterns here are clarifyprompt-only.

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

## ADD: CP-8 — integration test batteries present (informational)

For minor-version prep (e.g. `1.3.0 → 1.4.0`), confirm the test batteries exist and can at least parse:

- `/tmp/clarify-integration-test.mjs` (1.2 Definition-of-Done cases)
- `/tmp/clarify-day2-test.mjs` (1.3 memory + packs + curation)
- `/tmp/clarify-reasoning-test.mjs` (reasoning + cloud-model coverage)

**TODO for 1.4:** move these from `/tmp/` into `tests/` under version control. Once moved, this check escalates from "do they exist?" to "do they pass?".

**Generalization hint:** test-harness existence is a general pattern; the file paths are project-specific. Stays project-scoped until the tests are repo-versioned.

---

## ADD: CP-10 — git tag format

Tags for this repo follow `v<major>.<minor>.<patch>` strictly (e.g. `v1.3.1`). No `v1.3.1-beta`, no `release-1.3.1`, no unprefixed `1.3.1`.

**Generalization hint:** tag convention is per-project. Stays scoped. General skill could gain a configurable pattern later if promoted.

---

## Promotion log

Track which project-scoped checks have been **promoted** to the user-scoped skill, with the date. Once promoted, the project-scoped entry is removed (or shrunk to project-only specifics) — running ship-check then picks up the general version automatically.

| Date | What was promoted | From → to |
|---|---|---|
| 2026-04-24 | **CP-2: server.json env-var declarations match `.env.example`** — caught the gap that drove 1.3.0 → 1.3.1 | project `ADD: CP-2` → user `### 11. MCP server-manifest env-var cross-check (conditional)` (now also cross-checks the README env-var table) |
| 2026-04-24 | **CP-3: README env-var table completeness** — folded into the same general check #11 | project `ADD: CP-3` → user `### 11.` (third surface) |
| 2026-04-24 | **CP-7: Apache-2.0 license guard** — generalized into a parameterized license-consistency check + a commitment-drift heuristic that reads CONTRIBUTING.md / SECURITY.md / README for "no relicensing" signals | project `ADD: CP-7` → user `### 9. License consistency` |
| 2026-04-24 | **CP-9: dist/ hygiene** — generalized to all common build-artifact directories across Node / Python / Rust / Java / Go ecosystems | project `ADD: CP-9` → user `### 10. Build-artifact directory hygiene` |

---

## Active promotion candidates (still project-scoped)

When the user next runs a skills consolidation pass, these are the strongest candidates remaining — proven useful here, would help most projects, but waiting on a second-project signal:

1. **AUGMENT version consistency** (`src/index.ts` McpServer literal) — every Node-SDK MCP server benefits. Promote with a detection gate (SDK present in deps).
2. **CP-6 companion registry sync** — any project with a "main repo + curated companion registry" pattern. Promote when the general skill grows a "companion registry URL" config field.
3. **CP-8 integration battery presence** — generic once the test files are version-controlled (currently TODO for 1.4).

---

## Notes for re-running specific checks

Don't duplicate the general checks here. If a general check needs tuning for this repo (e.g., an additional secret pattern), override it in this file with a comment explaining why — don't just add a parallel variant.
