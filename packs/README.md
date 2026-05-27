# Knowledge packs

This directory holds the **knowledge packs** that ship with `clarifyprompt-mcp` and the built-in **platform packs** that the optimizer auto-loads at boot.

Two different things live here. The distinction matters.

## What's in this folder

| Path | What it is | Loaded how |
|---|---|---|
| `packs/*.md` | **Knowledge packs.** Brand voices, coding conventions, compliance rules, domain prompting patterns. Apache-2.0 unless dual-licensed in frontmatter. | On-demand via `load_knowledge_pack({source: <URL or path>, scope: ...})`. |
| `packs/platforms/*.yaml` | **Built-in platform configs.** Source of truth for the 58+ platforms the optimizer knows about (chat, code, image, video, music, voice, document). | Auto-loaded at module init by `platformLoader.ts`. See [`platforms/README.md`](./platforms/README.md). |

If you want to add a new AI platform (a new image-gen tool, a new chat model), see [`platforms/README.md`](./platforms/README.md) — not this file.

If you want to teach ClarifyPrompt something durable about a domain (your brand's tone, your team's coding conventions, a compliance regime), read on.

## Loading a pack

In any MCP host wired to `clarifyprompt-mcp@1.3+`:

```
load_knowledge_pack({
  source: "https://raw.githubusercontent.com/LumabyteCo/clarifyprompt-mcp/main/packs/nextjs-14-best-practices.md",
  scope: "user"
})
```

Or load locally from a path:

```
load_knowledge_pack({ source: "/path/to/my-team-style-guide.md", scope: "project" })
```

Packs get chunked at H2 boundaries, embedded, and made available for semantic retrieval in every subsequent `optimize_prompt` call — scored by the Context Curator against the available token budget.

**Scopes:**
- `user` — persists across all projects on this machine.
- `project` — persists only in the current working tree.
- `session` — in-memory, gone when the MCP server restarts.

## Built-in starter packs

| Pack | What it teaches |
|---|---|
| [`anthropic-brand-voice`](./anthropic-brand-voice.md) | Anthropic's public-facing tone, register, and word choices |
| [`higgsfield-creative-handbook`](./higgsfield-creative-handbook.md) | Higgsfield model selection, prompt structure, camera moves, Soul ID workflow |
| [`nextjs-14-best-practices`](./nextjs-14-best-practices.md) | Server-first Next.js 14 App Router conventions |
| [`sox-compliance`](./sox-compliance.md) | Sarbanes-Oxley 404 guardrails for AI-assisted financial work |

## Authoring a new pack

Packs are plain markdown with YAML frontmatter:

```markdown
---
name: my-team-style-guide
version: 1.0.0
description: Brand + voice guidelines for MyTeam's marketing copy
scope: user
author: My Name
license: Apache-2.0
tags: [brand, voice, marketing]
---

# My Team Style Guide

## Tone
...

## Register
...
```

**Structural rules:**

- **H1 = the pack title** (implicit, from the filename or frontmatter).
- **H2+ define chunk boundaries.** Each H2 section becomes one (or more) retrievable chunks. Aim for ~500–1500 chars per chunk.
- **Be specific and actionable.** Packs that teach abstract principles don't retrieve as well as packs with concrete rules and examples.
- **Keep it under ~15 KB.** Larger packs still work but lose retrieval precision as chunks dilute.

**Quality bar (what we look for in PRs):**

- **Does it teach something durable?** A pack that says "be more helpful" isn't useful. A pack that says *"when writing SQL for Snowflake, prefer CTEs over nested subqueries and always use `QUALIFY ROW_NUMBER() OVER (...)` for deduplication"* is.
- **Is it chunkable?** Each H2 section should stand on its own; don't rely on cross-chunk context.
- **Is it cited?** Reference standards (ASC numbers, RFC specs, framework versions), not vibes.

## Contributing

1. Fork `LumabyteCo/clarifyprompt-mcp` and branch off `main`.
2. Add your pack as `packs/<your-pack-name>.md`.
3. Include YAML frontmatter with at minimum: `name`, `version`, `description`, `license`.
4. Optionally add an eval fixture under `evals/fixtures/` that loads your pack and verifies a representative retrieval.
5. Add a row to the **Built-in starter packs** table above.
6. Open a PR with a short description of what the pack teaches and when to load it.

By contributing, you agree your pack ships under Apache-2.0 unless you explicitly dual-license via frontmatter.

## History

This directory was the single source of truth from `1.0` through `1.2`, then briefly split into a separate [`clarifyprompt-packs`](https://github.com/LumabyteCo/clarifyprompt-packs) registry repo in `1.3` (2026-04). The two-repo model was archived in `1.6.4` (2026-05) — the maintenance overhead was paying for an external-contributor audience that hadn't materialized, and the higgsfield pack shipping to npm without making it to the registry was exhibit A of the resulting drift. Packs live here again, as a single source of truth.
