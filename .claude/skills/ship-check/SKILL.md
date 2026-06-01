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

## AUGMENT: README marketing-surface coherence with current version

The general check (user-scoped `### 12.`) handles the abstract pattern via heuristics. This AUGMENT pins the *exact* heading templates this repo uses so the check can run as a strict literal-string match instead of a heuristic, eliminating any false-negative risk:

```bash
TARGET_VERSION=$(node -p "require('./package.json').version")

grep -q "> \*\*New in ${TARGET_VERSION}:" README.md \
  || echo "::error::CP-11/AUGMENT: README headline blockquote not on ${TARGET_VERSION}"
grep -q "^## What's new in ${TARGET_VERSION}" README.md \
  || echo "::error::CP-11/AUGMENT: '## What's new in ${TARGET_VERSION}' heading missing"
grep -q "^## What's in the box (cumulative through ${TARGET_VERSION})" README.md \
  || echo "::error::CP-11/AUGMENT: 'cumulative through' heading not on ${TARGET_VERSION}"
```

History: this repo IS the precedent that birthed the general check. Originally added as project-scoped `CP-11` after the 1.5.0 npm tarball shipped with the README still saying 1.4.0. Promoted to general check #12 the same day (see promotion log). The augment retains the exact-string variant locally because it's faster than the heuristic and we know the templates aren't going to change here.

---

## ADD: CP-12 — Platform-pack format validity (1.5.0+)

For every `packs/platforms/<category>.yaml` shipped in the repo:

1. The file must parse as YAML.
2. It must declare a top-level `category:` mapping with at least `id` and `defaultPlatform`.
3. `category.id` must be one of: `chat`, `image`, `voice`, `video`, `music`, `code`, `document`.
4. The file must declare a `platforms:` array with at least one entry.
5. Every platform entry must have non-empty `id`, `label`, `description`.
6. The `defaultPlatform` must reference a `platforms[].id` that exists in the same file.

Detection (Node + js-yaml; runs at the project root):

```bash
node --input-type=module -e "
import yaml from 'js-yaml';
import * as fs from 'node:fs';
import * as path from 'node:path';
const dir = 'packs/platforms';
if (!fs.existsSync(dir)) { console.log('no platform packs to validate'); process.exit(0); }
const VALID = ['chat','image','voice','video','music','code','document'];
let fails = 0;
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.yaml'))) {
  const file = path.join(dir, f);
  try {
    const doc = yaml.load(fs.readFileSync(file, 'utf-8'));
    const c = doc?.category;
    if (!c?.id || !VALID.includes(c.id)) throw new Error('missing/invalid category.id');
    if (!Array.isArray(doc.platforms) || doc.platforms.length === 0) throw new Error('missing platforms[]');
    for (const p of doc.platforms) {
      if (!p?.id || !p?.label || !p?.description) throw new Error('platform entry missing id/label/description');
    }
    if (c.defaultPlatform && !doc.platforms.find(p => p.id === c.defaultPlatform)) throw new Error('defaultPlatform not in platforms[]');
    console.log('  ✔', f, c.id, doc.platforms.length, 'platforms');
  } catch (e) {
    console.error('  ✖', f, '-', e.message);
    fails++;
  }
}
process.exit(fails);
"
```

**Generalization hint:** the pattern of "declarative data files in YAML at a known location, validated at ship-time" generalizes — every project with this shape (knowledge packs, platform packs, prompt templates, model configs, etc.) benefits. **Promotion candidate** when a second project adopts a similar YAML-pack pattern, with the schema parameterized.

---

## ADD: CP-10 — git tag format

Tags for this repo follow `v<major>.<minor>.<patch>` strictly (e.g. `v1.3.1`). No `v1.3.1-beta`, no `release-1.3.1`, no unprefixed `1.3.1`.

**Generalization hint:** tag convention is per-project. Stays scoped. General skill could gain a configurable pattern later if promoted.

---

## ADD: CP-13 — lockfile regeneration safety (1.6.8+)

The single most expensive class of mistake this repo has hit: a `package-lock.json` regeneration that silently changed more than intended. When a release touches the lockfile (dependency bump, SDK upgrade, `npm audit fix`, or a `rm -rf node_modules package-lock.json` clean install):

1. **Never regenerate with `npm install --package-lock-only` when dependency versions may have changed.** That flag rewrites the lockfile but resolves optional / platform-specific (`os`/`cpu`-gated) dependencies **only for the current host platform** — silently dropping every other platform's binary from the lock. A version-only bump (no dep change) is the one safe use; anything touching deps must use a **full `npm install`** so all platform variants get recorded, then commit the resulting lock.

2. **After any lockfile change, `git diff package-lock.json` BEFORE committing** and scan for two failure modes:
   - **Dropped platform / optional deps:**
     ```bash
     git diff --cached package-lock.json | grep -E '^-.*"(node_modules/)?[a-z0-9@/._-]+-(darwin|linux|win32|windows)-(arm64|x64|ia32)"' && echo "::error::CP-13: a platform-specific binary was removed from the lock"
     ```
     A deletion of any `<pkg>-<platform>-<arch>` entry means a platform binary vanished. **This broke 1.6.5 → forced 1.6.6**: 4 of 5 `sqlite-vec` platforms dropped, breaking `npm ci` on Linux CI (the npm *tarball* was fine — no lockfile ships — but the publish gate uses `npm ci` against the committed lock).
   - **Unexpected native-dep version jumps:** a caret-range native/build-sensitive dep can silently jump within range to a version that drops support for something. **This broke 1.6.6 → forced 1.6.7**: `better-sqlite3` 12.9.0 → 12.10.0 dropped Node 20 prebuilds (Node 20 EOL'd Apr 2026), and `node:20-slim` has no toolchain to compile from source. After a lockfile change, diff the resolved version of every dep with an install script or native binary (`better-sqlite3`, `sqlite-vec`, and anything else with `hasInstallScript`) and confirm each still supports **both** the Dockerfile base Node version **and** the CI matrix's lowest Node version.

3. **Verify all expected platforms survived:**
   ```bash
   grep -oE '"sqlite-vec-[a-z0-9-]+"' package-lock.json | sort -u    # must list all 5: darwin-arm64, darwin-x64, linux-arm64, linux-x64, windows-x64
   ```

4. **If the lockfile change is part of a release, the local Docker build is a required pre-push gate** (not just CI): `docker build -t cp:precheck . && docker run --rm --entrypoint sh cp:precheck -c 'node -e "require(\"better-sqlite3\");require(\"sqlite-vec\")"'`. The slim image has no compile fallback, so it catches dropped-prebuilt regressions that the toolchain-equipped CI matrix runners would silently paper over.

**History:** direct lesson from the 1.6.5 → 1.6.6 → 1.6.7 cascade on 2026-05-27. A single `npm install --package-lock-only` after a `rm -rf node_modules package-lock.json` caused two distinct CI failures across two follow-up releases — first a dropped-platform-binary break, then a within-caret native-dep version jump that dropped an EOL Node line. Both were CI-only (end-user `npm install` resolves fresh and was never affected), but both blocked the publish gate.

**Generalization hint:** **strong promotion candidate** — this is a fully general npm lesson. Any project with native deps (`better-sqlite3`, `esbuild`, `sharp`, `swc`, `@napi-rs/*`, etc.) or platform-gated optional deps is exposed to both failure modes. The specific package names are project-specific; the *checks* (diff for dropped platform deps, diff native-dep versions against the Docker/CI Node floor, slim-image load gate) generalize directly. Promote with the native-dep list and the platform-binary glob parameterized.

---

## Promotion log

Track which project-scoped checks have been **promoted** to the user-scoped skill, with the date. Once promoted, the project-scoped entry is removed (or shrunk to project-only specifics) — running ship-check then picks up the general version automatically.

| Date | What was promoted | From → to |
|---|---|---|
| 2026-04-24 | **CP-2: server.json env-var declarations match `.env.example`** — caught the gap that drove 1.3.0 → 1.3.1 | project `ADD: CP-2` → user `### 11. MCP server-manifest env-var cross-check (conditional)` (now also cross-checks the README env-var table) |
| 2026-04-24 | **CP-3: README env-var table completeness** — folded into the same general check #11 | project `ADD: CP-3` → user `### 11.` (third surface) |
| 2026-04-24 | **CP-7: Apache-2.0 license guard** — generalized into a parameterized license-consistency check + a commitment-drift heuristic that reads CONTRIBUTING.md / SECURITY.md / README for "no relicensing" signals | project `ADD: CP-7` → user `### 9. License consistency` |
| 2026-04-24 | **CP-9: dist/ hygiene** — generalized to all common build-artifact directories across Node / Python / Rust / Java / Go ecosystems | project `ADD: CP-9` → user `### 10. Build-artifact directory hygiene` |
| 2026-04-26 | **CP-11: README marketing-surface coherence with current version** — generalized via heuristics so any project's `What's new in X` / `Highlights — X` / `Release X` heading variants get checked, not just this repo's specific templates. Promoted same-day after 1.5.0 shipped to npm with the README still on 1.4.0. | project `ADD: CP-11` → user `### 12. README marketing-surface coherence with current version`. Project-scoped becomes `AUGMENT` with the exact-string variants for this repo's templates. |

---

## Active promotion candidates (still project-scoped)

When the user next runs a skills consolidation pass, these are the strongest candidates remaining — proven useful here, would help most projects, but waiting on a second-project signal:

1. **AUGMENT version consistency** (`src/index.ts` McpServer literal) — every Node-SDK MCP server benefits. Promote with a detection gate (SDK present in deps).
2. **CP-6 companion registry sync** — any project with a "main repo + curated companion registry" pattern. Promote when the general skill grows a "companion registry URL" config field.
3. **CP-8 integration battery presence** — generic once the test files are version-controlled (currently TODO for 1.4).

---

## Notes for re-running specific checks

Don't duplicate the general checks here. If a general check needs tuning for this repo (e.g., an additional secret pattern), override it in this file with a comment explaining why — don't just add a parallel variant.
