# ClarifyPrompt MCP

[![npm version](https://img.shields.io/npm/v/clarifyprompt-mcp.svg)](https://www.npmjs.com/package/clarifyprompt-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

An MCP server that transforms vague prompts into platform-optimized prompts for 58 AI platforms across 7 categories.

Send a raw prompt. Get back a version specifically optimized for Midjourney, DALL-E, Sora, Runway, ElevenLabs, Claude, ChatGPT, or any of the 58 supported platforms — with the right syntax, parameters, and structure each platform expects.

## How It Works

```
You write:    "a dragon flying over a castle at sunset"

ClarifyPrompt returns (for Midjourney):
  "a majestic dragon flying over a medieval castle at sunset
   --ar 16:9 --v 6.1 --style raw --q 2 --chaos 30 --s 700"

ClarifyPrompt returns (for DALL-E):
  "A majestic dragon flying over a castle at sunset. Size: 1024x1024"
```

Same prompt, different platform, completely different output. ClarifyPrompt knows what each platform expects.

## Quick Start

### With Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "clarifyprompt": {
      "command": "npx",
      "args": ["-y", "clarifyprompt-mcp"],
      "env": {
        "LLM_API_URL": "http://localhost:11434/v1",
        "LLM_MODEL": "qwen2.5:7b"
      }
    }
  }
}
```

### With Claude Code

```bash
claude mcp add clarifyprompt -- npx -y clarifyprompt-mcp
```

Set the environment variables in your shell before launching:

```bash
export LLM_API_URL=http://localhost:11434/v1
export LLM_MODEL=qwen2.5:7b
```

### With Cursor

Add to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "clarifyprompt": {
      "command": "npx",
      "args": ["-y", "clarifyprompt-mcp"],
      "env": {
        "LLM_API_URL": "http://localhost:11434/v1",
        "LLM_MODEL": "qwen2.5:7b"
      }
    }
  }
}
```

## Supported Platforms (58)

| Category | Platforms | Default |
|----------|-----------|---------|
| **Image** (10) | Midjourney, DALL-E 3, Stable Diffusion, Flux, Ideogram, Leonardo AI, Adobe Firefly, Grok Aurora, Google Imagen 3, Recraft | Midjourney |
| **Video** (11) | Sora, Runway Gen-3, Pika Labs, Kling AI, Luma, Minimax/Hailuo, Google Veo 2, Wan, HeyGen, Synthesia, CogVideoX | Runway |
| **Chat** (9) | Claude, ChatGPT, Gemini, Llama, DeepSeek, Qwen, Kimi, GLM, Minimax | Claude |
| **Code** (9) | Claude, ChatGPT, Cursor, GitHub Copilot, Windsurf, DeepSeek Coder, Qwen Coder, Codestral, Gemini | Claude |
| **Document** (8) | Claude, ChatGPT, Gemini, Jasper, Copy.ai, Notion AI, Grammarly, Writesonic | Claude |
| **Voice** (7) | ElevenLabs, OpenAI TTS, Fish Audio, Sesame, Google TTS, PlayHT, Kokoro | ElevenLabs |
| **Music** (4) | Suno AI, Udio, Stable Audio, MusicGen | Suno |

## Tools

### `optimize_prompt`

The main tool. Optimizes a prompt for a specific AI platform.

```json
{
  "prompt": "a cat sitting on a windowsill",
  "category": "image",
  "platform": "midjourney",
  "mode": "concise"
}
```

**All parameters except `prompt` are optional.** When `category` and `platform` are omitted, ClarifyPrompt auto-detects them from the prompt content.

Three calling modes:

| Mode | Example |
|------|---------|
| **Zero-config** | `{ "prompt": "sunset over mountains" }` |
| **Category only** | `{ "prompt": "...", "category": "image" }` |
| **Fully explicit** | `{ "prompt": "...", "category": "image", "platform": "dall-e" }` |

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `prompt` | Yes | The prompt to optimize |
| `category` | No | `chat`, `image`, `video`, `voice`, `music`, `code`, `document`. Auto-detected when omitted. |
| `platform` | No | Platform ID (e.g. `midjourney`, `dall-e`, `sora`, `claude`). Uses category default when omitted. |
| `mode` | No | Output style: `concise`, `detailed`, `structured`, `step-by-step`, `bullet-points`, `technical`, `simple`. Default: `detailed`. |
| `enrich_context` | No | Set `true` to use web search for context enrichment. Default: `false`. |

**Response:**

```json
{
  "originalPrompt": "a dragon flying over a castle at sunset",
  "optimizedPrompt": "a majestic dragon flying over a medieval castle at sunset --ar 16:9 --v 6.1 --style raw --q 2 --s 700",
  "category": "image",
  "platform": "midjourney",
  "mode": "concise",
  "detection": {
    "autoDetected": true,
    "detectedCategory": "image",
    "detectedPlatform": "midjourney",
    "confidence": "high"
  },
  "metadata": {
    "model": "qwen2.5:14b-instruct-q4_K_M",
    "processingTimeMs": 3911,
    "strategy": "ImageStrategy"
  }
}
```

The `detection` field only appears when auto-detection was used. When `category` and `platform` are provided explicitly, detection is skipped.

### `list_categories`

Lists all 7 categories with platform counts and defaults.

### `list_platforms`

Lists available platforms for a given category, including which is the default.

### `list_modes`

Lists all 7 output modes with descriptions.

## LLM Configuration

ClarifyPrompt uses an LLM to optimize prompts. It works with **any OpenAI-compatible API** and with the **Anthropic API** directly.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LLM_API_URL` | Yes | API endpoint URL |
| `LLM_API_KEY` | Depends | API key (not needed for local Ollama) |
| `LLM_MODEL` | Yes | Model name/ID |

### Provider Examples

**Ollama (local, free):**
```
LLM_API_URL=http://localhost:11434/v1
LLM_MODEL=qwen2.5:7b
```

**OpenAI:**
```
LLM_API_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o
```

**Anthropic Claude:**
```
LLM_API_URL=https://api.anthropic.com/v1
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-20250514
```

**Google Gemini:**
```
LLM_API_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=your-gemini-key
LLM_MODEL=gemini-2.0-flash
```

**Groq:**
```
LLM_API_URL=https://api.groq.com/openai/v1
LLM_API_KEY=gsk_...
LLM_MODEL=llama-3.3-70b-versatile
```

**DeepSeek:**
```
LLM_API_URL=https://api.deepseek.com/v1
LLM_API_KEY=your-deepseek-key
LLM_MODEL=deepseek-chat
```

**OpenRouter (any model):**
```
LLM_API_URL=https://openrouter.ai/api/v1
LLM_API_KEY=your-openrouter-key
LLM_MODEL=anthropic/claude-sonnet-4
```

See [`.env.example`](.env.example) for the full list of 20+ supported providers including Together AI, Fireworks, Mistral, xAI, Cohere, Perplexity, LM Studio, vLLM, LocalAI, Jan, GPT4All, and more.

## Web Search (Optional)

Enable context enrichment by setting `enrich_context: true` in your `optimize_prompt` call. ClarifyPrompt will search the web for relevant context before optimizing.

Supported search providers:

| Provider | Variable | URL |
|----------|----------|-----|
| Tavily (default) | `SEARCH_API_KEY` | [tavily.com](https://tavily.com) |
| Brave Search | `SEARCH_API_KEY` | [brave.com/search/api](https://brave.com/search/api) |
| Serper | `SEARCH_API_KEY` | [serper.dev](https://serper.dev) |
| SerpAPI | `SEARCH_API_KEY` | [serpapi.com](https://serpapi.com) |
| Exa | `SEARCH_API_KEY` | [exa.ai](https://exa.ai) |
| SearXNG (self-hosted) | — | [github.com/searxng/searxng](https://github.com/searxng/searxng) |

```
SEARCH_PROVIDER=tavily
SEARCH_API_KEY=your-key
```

## Before and After

### Image (Midjourney)

```
Before: "a cat sitting on a windowsill"

After:  "a tabby cat sitting on a sunlit windowsill, warm golden hour
         lighting, shallow depth of field, dust particles in light beams,
         cozy interior background, shot on 35mm film, warm amber color
         palette --ar 16:9 --v 6.1 --style raw --q 2"
```

### Video (Sora)

```
Before: "a timelapse of a city"

After:  "Cinematic timelapse of a sprawling metropolitan skyline
         transitioning from golden hour to blue hour to full night.
         Camera slowly dollies forward from an elevated vantage point.
         Light trails from traffic appear as the city illuminates.
         Clouds move rapidly overhead. Duration: 10s.
         Style: documentary cinematography, 4K."
```

### Code (Claude)

```
Before: "write a function to validate emails"

After:  "Write a TypeScript function `validateEmail(input: string): boolean`
         that validates email addresses against RFC 5322. Handle edge cases:
         quoted local parts, IP address domains, internationalized domain
         names. Return boolean, no exceptions. Include JSDoc with examples
         of valid and invalid inputs. No external dependencies."
```

### Music (Suno)

```
Before: "compose a chill lo-fi beat for studying"

After:  "Compose an instrumental chill lo-fi beat for studying.
         [Tempo: medium] [Genre: lo-fi] [Length: 2 minutes]"
```

## Architecture

```
clarifyprompt-mcp/
  src/
    index.ts                           MCP server entry point (4 tools, 1 resource)
    engine/
      config/categories.ts             7 categories, 58 platforms, 7 modes
      llm/client.ts                    Multi-provider LLM client (OpenAI + Anthropic)
      search/client.ts                 Web search (6 providers)
      optimization/
        engine.ts                      Core orchestrator + auto-detection
        types.ts                       TypeScript interfaces
        strategies/
          base.ts                      Abstract base strategy
          chat.ts                      9 platforms
          image.ts                     10 platforms
          video.ts                     11 platforms
          voice.ts                     7 platforms
          music.ts                     4 platforms
          code.ts                      9 platforms
          document.ts                  8 platforms
```

## Development

```bash
git clone https://github.com/LumabyteCo/clarifyprompt-mcp.git
cd clarifyprompt-mcp
npm install
npm run build
```

Test with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Set environment variables in the Inspector's "Environment Variables" section before connecting.

## License

[Apache-2.0](LICENSE)
