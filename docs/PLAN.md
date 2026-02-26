# ClarifyPrompt MCP — Plan & Strategy

## Status

**v1.0.1 is built and working.** The MCP server supports 7 categories, 58 platforms, 7 output modes, 4 tools, and 1 resource. See current tools below.

---

## Current Tools (v1.0)

| Tool | Purpose |
|------|---------|
| `optimize_prompt` | Optimize a prompt for a specific AI platform (58 platforms across 7 categories) |
| `list_categories` | List all 7 categories (chat, image, video, voice, music, code, document) |
| `list_platforms` | List platforms for a given category |
| `list_modes` | List 7 output modes (concise, detailed, structured, etc.) |

**Resource:** `clarifyprompt://categories` — full category config as JSON.

### v1.0.1 — Make `category` Optional (Next Patch)

Currently `category` is **required** in `optimize_prompt`. This forces every calling agent to implement its own classification logic before calling ClarifyPrompt — a high integration burden.

**Fix:** Make `category` and `platform` both optional. When omitted, the tool auto-detects from the prompt content using the LLM.

```
optimize_prompt({
  prompt: "sunset over mountains, cinematic"
  // category omitted → auto-detected as "image"
  // platform omitted → uses default for detected category
})
```

**Three calling modes after this patch:**

| Mode | When | Example |
|------|------|---------|
| **Zero-config** | Caller doesn't know category or platform | `optimize_prompt({ prompt: "..." })` |
| **Category-only** | Caller knows the category but not platform | `optimize_prompt({ prompt: "...", category: "image" })` |
| **Fully explicit** | Caller knows everything | `optimize_prompt({ prompt: "...", category: "image", platform: "midjourney" })` |

Backward compatible — existing callers that pass `category` still work identically.

---

## Design Decisions

### 1. User-Triggered Only (`/enhance`)

Prompt optimization is **never automatic**. The user explicitly triggers it with the `/enhance` prefix in the calling agent (e.g., AI Butler). ClarifyPrompt MCP itself is just the engine — it doesn't know about `/enhance`. The calling agent decides when to invoke `optimize_prompt`.

- No auto-enhance per-category
- No `/raw` bypass (there's nothing to bypass — optimization is off by default)
- No short aliases (e.g., no `/e`)
- Full prefix only: `/enhance`

### 2. Independent from AI Butler

ClarifyPrompt MCP is a standalone MCP server. It is **not** an AI Butler dependency and is **not** required for AI Butler Phase 1.

- AI Butler has a `PromptPreprocessor` interface with a passthrough default
- ClarifyPrompt can fill that slot but so can any other MCP server, WASM plugin, or local function
- ClarifyPrompt works with any MCP client: Claude Desktop, Cursor, Claude Code, or any agent

### 3. Single Tool Call = Complete Task

Any MCP client should be able to call `optimize_prompt` with just a prompt string and get back an optimized result. No pre-classification required, no multi-step orchestration. The tool handles detection internally when `category`/`platform` are omitted.

For agents that want to inspect detection before committing, `extract_intent` (v1.1) provides a separate inspection step — but it's never required.

---

## Roadmap

### v1.0 — Prompt Optimization (Done)

- [x] 7 categories: chat, image, video, voice, music, code, document
- [x] 58 platforms with platform-specific optimization strategies
- [x] 7 output modes
- [x] Multi-LLM support (20+ providers via OpenAI-compatible API)
- [x] Web search context enrichment (6 search providers)
- [x] MCP server with stdio transport

### v1.0.1 — Agent-Ready (Next)

- [ ] Make `category` optional in `optimize_prompt` — auto-detect from prompt content when omitted
- [ ] Make `platform` auto-select the category default when omitted
- [ ] Auto-detection via LLM classification (lightweight, single call)
- [ ] Return `detected_category` and `detected_platform` in response metadata when auto-detected

### v1.1 — Intent Inspection

- [ ] `extract_intent` tool — analyze raw user input to detect category/platform/params **without** optimizing. For agents that want the two-step flow: inspect first, then optimize with explicit params.
- [ ] Platform matching intelligence — pick best platform from user's available providers based on intent (e.g., logo → DALL-E, photorealistic → Flux)
- [ ] Error handling improvements and input validation

### Future

- [ ] Streaming support via MCP notifications/progress
- [ ] Custom platform definitions (user-added platforms)
- [ ] TOON format output (token-efficient responses)
- [ ] Prompt history (SQLite-based local history of all optimizations)
- [ ] HTTP+SSE transport (in addition to stdio)

---

## Architecture

```
clarifyprompt-mcp/
├── src/
│   ├── index.ts                          # MCP server entry point
│   └── engine/
│       ├── config/
│       │   └── categories.ts             # 7 categories, 30 platforms, 7 modes
│       ├── llm/
│       │   └── client.ts                 # Multi-provider LLM client (OpenAI-compatible + Anthropic)
│       ├── search/
│       │   └── client.ts                 # Web search (Tavily, Brave, Serper, SerpAPI, Exa, SearXNG)
│       └── optimization/
│           ├── types.ts                  # TypeScript interfaces
│           ├── engine.ts                 # Core optimization orchestrator + auto-detection
│           └── strategies/
│               ├── base.ts               # Abstract base strategy
│               ├── index.ts              # Strategy registry
│               ├── chat.ts
│               ├── image.ts              # 10 platforms
│               ├── video.ts              # 8 platforms
│               ├── voice.ts              # 5 platforms
│               ├── music.ts              # 2 platforms
│               ├── code.ts               # 5 platforms
│               └── document.ts
├── docs/
│   └── PLAN.md                           # This file
├── examples/
│   ├── claude_desktop_config.json
│   └── npx_config.json
├── package.json
├── tsconfig.json
└── .env.example
```

---

## How Calling Agents Use This

### `/enhance` flow (AI Butler, Claude Desktop, any MCP client)

```
User: /enhance sunset over mountains, cinematic

Agent recognizes /enhance prefix
  → strips prefix
  → calls ClarifyPrompt MCP: optimize_prompt({
      prompt: "sunset over mountains, cinematic"
    })
  → ClarifyPrompt auto-detects: category=image, platform=midjourney (default)
  → returns optimized prompt with platform-specific syntax
  → agent passes optimized prompt to image generation API
  → returns result to user
```

The agent doesn't need to know the category or platform. One call, done.

### `/enhance` with explicit params (power users)

```
User: /enhance --platform=dall-e a logo for my coffee shop, minimalist

Agent recognizes /enhance prefix + flags
  → calls optimize_prompt({
      prompt: "a logo for my coffee shop, minimalist",
      category: "image",
      platform: "dall-e"
    })
  → returns DALL-E-optimized prompt (natural language, size constraints)
```

### Without any prefix (default)

```
User: sunset over mountains, cinematic

Agent sends prompt directly to AI service — no optimization.
Passthrough. ClarifyPrompt is never called.
```

---

## What Optimization Looks Like (Before/After)

### Image — Midjourney

```
Before: "a cat sitting on a windowsill"

After:  "a tabby cat sitting on a sunlit windowsill, warm golden hour
lighting, shallow depth of field, dust particles in light beams,
cozy interior background, shot on 35mm film, warm amber color
palette --ar 16:9 --v 6.1 --style raw --q 2"
```

### Video — Sora

```
Before: "a timelapse of a city"

After:  "Cinematic timelapse of a sprawling metropolitan skyline transitioning
from golden hour to blue hour to full night. Camera slowly dollies
forward from an elevated vantage point. Light trails from traffic
appear as the city illuminates. Clouds move rapidly overhead.
Duration: 10s. Style: documentary cinematography, 4K."
```

### Code — Claude

```
Before: "write a function to validate emails"

After:  "Write a TypeScript function `validateEmail(input: string): boolean`
that validates email addresses against RFC 5322. Handle edge cases:
quoted local parts, IP address domains, internationalized domain
names. Return boolean, no exceptions. Include JSDoc with examples
of valid and invalid inputs. No external dependencies."
```
