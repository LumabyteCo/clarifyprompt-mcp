# ClarifyPrompt MCP — Test Examples

Tested with `qwen2.5:14b-instruct-q4_K_M` via Ollama on Feb 26, 2026.

---

## Default Platforms Per Category

When `category` and `platform` are omitted, ClarifyPrompt auto-detects the category and uses the default platform:

| Category | Default Platform | Platforms Available |
|----------|-----------------|-------------------|
| image | **midjourney** | 10 (Midjourney, DALL-E 3, Stable Diffusion, Flux, Ideogram, Leonardo AI, Adobe Firefly, Grok Aurora, Google Imagen 3, Recraft) |
| video | **runway** | 11 (Sora, Runway Gen-3, Pika Labs, Kling AI, Luma, Minimax/Hailuo, Google Veo 2, Wan, HeyGen, Synthesia, CogVideoX) |
| voice | **elevenlabs** | 7 (ElevenLabs, OpenAI TTS, Fish Audio, Sesame, Google TTS, PlayHT, Kokoro) |
| music | **suno** | 4 (Suno AI, Udio, Stable Audio, MusicGen) |
| code | **claude** | 9 (Claude, ChatGPT, Cursor, GitHub Copilot, Windsurf, DeepSeek Coder, Qwen Coder, Codestral, Gemini) |
| chat | **claude** | 9 (Claude, ChatGPT, Gemini, Llama, DeepSeek, Qwen, Kimi, GLM, Minimax) |
| document | **claude** | 8 (Claude, ChatGPT, Gemini, Jasper, Copy.ai, Notion AI, Grammarly, Writesonic) |

---

## Example 1: Image — Auto-Detect (Zero-Config)

No `category` or `platform` provided. ClarifyPrompt detects "image" and uses Midjourney (default).

**Request:**
```json
{
  "prompt": "a dragon flying over a castle at sunset",
  "mode": "concise"
}
```

**Response:**
```json
{
  "originalPrompt": "a dragon flying over a castle at sunset",
  "optimizedPrompt": "a majestic dragon flying over a medieval castle at sunset --ar 16:9 --v 6.1 --style raw --q 2 --chaos 30 --weird 500 --s 700",
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

Notice the Midjourney-specific syntax: `--ar 16:9 --v 6.1 --style raw --q 2 --chaos 30 --weird 500 --s 700`

---

## Example 2: Image — Explicit DALL-E (Same Prompt, Different Platform)

Same prompt as Example 1, but explicitly targeting DALL-E. The output is completely different — natural language optimized for DALL-E's API instead of Midjourney parameters.

**Request:**
```json
{
  "prompt": "a dragon flying over a castle at sunset",
  "category": "image",
  "platform": "dall-e",
  "mode": "concise"
}
```

**Response:**
```json
{
  "originalPrompt": "a dragon flying over a castle at sunset",
  "optimizedPrompt": "A majestic dragon flying over a castle at sunset. Size: 1024x1024",
  "category": "image",
  "platform": "dall-e",
  "mode": "concise",
  "metadata": {
    "model": "qwen2.5:14b-instruct-q4_K_M",
    "processingTimeMs": 1434,
    "strategy": "ImageStrategy"
  }
}
```

No `detection` field — category and platform were explicit, so no auto-detection was needed. DALL-E gets natural language + size constraints instead of Midjourney parameter flags.

---

## Example 3: Video — Auto-Detect

**Request:**
```json
{
  "prompt": "create a cinematic 10 second intro for my YouTube tech channel",
  "mode": "concise"
}
```

**Response:**
```json
{
  "originalPrompt": "create a cinematic 10 second intro for my YouTube tech channel",
  "optimizedPrompt": "Create a 10-second cinematic intro for a YouTube tech channel using dynamic motion and a zoom-in effect on key elements. Use the motion brush to highlight technical gadgets, with subtle camera pans left and right between scenes.",
  "category": "video",
  "platform": "runway",
  "mode": "concise",
  "detection": {
    "autoDetected": true,
    "detectedCategory": "video",
    "detectedPlatform": "runway",
    "confidence": "high"
  },
  "metadata": {
    "model": "qwen2.5:14b-instruct-q4_K_M",
    "processingTimeMs": 3638,
    "strategy": "VideoStrategy"
  }
}
```

Detected as video, defaulted to Runway Gen-3. The optimized prompt includes Runway-specific concepts: motion brush, camera pans, zoom effects.

---

## Example 4: Code — Auto-Detect

**Request:**
```json
{
  "prompt": "write a REST API endpoint for user authentication with JWT in Node.js",
  "mode": "concise"
}
```

**Response:**
```json
{
  "originalPrompt": "write a REST API endpoint for user authentication with JWT in Node.js",
  "optimizedPrompt": "<task>Write a REST API endpoint for user authentication using JWT in Node.js.</task>\n<constraints>Include token generation and validation. Use Express framework. Provide code style consistent with Airbnb JavaScript Style Guide.</constraints>",
  "category": "code",
  "platform": "claude",
  "mode": "concise",
  "detection": {
    "autoDetected": true,
    "detectedCategory": "code",
    "detectedPlatform": "claude",
    "confidence": "high"
  },
  "metadata": {
    "model": "qwen2.5:14b-instruct-q4_K_M",
    "processingTimeMs": 4048,
    "strategy": "CodeStrategy"
  }
}
```

Detected as code, defaulted to Claude. The optimized prompt uses XML tags (`<task>`, `<constraints>`) which Claude handles well.

---

## Example 5: Music — Auto-Detect

**Request:**
```json
{
  "prompt": "compose a chill lo-fi beat for studying, 2 minutes long",
  "mode": "concise"
}
```

**Response:**
```json
{
  "originalPrompt": "compose a chill lo-fi beat for studying, 2 minutes long",
  "optimizedPrompt": "Compose an instrumental chill lo-fi beat for studying. [Tempo: medium] [Genre: lo-fi] [Length: 2 minutes]",
  "category": "music",
  "platform": "suno",
  "mode": "concise",
  "detection": {
    "autoDetected": true,
    "detectedCategory": "music",
    "detectedPlatform": "suno",
    "confidence": "high"
  },
  "metadata": {
    "model": "qwen2.5:14b-instruct-q4_K_M",
    "processingTimeMs": 3286,
    "strategy": "MusicStrategy"
  }
}
```

Detected as music, defaulted to Suno. The optimized prompt uses Suno-style tags: `[Tempo: medium] [Genre: lo-fi] [Length: 2 minutes]`.

---

## Key Takeaways

1. **Auto-detection works reliably** — all 5 tests detected the correct category with "high" confidence
2. **Platform-specific output** — same prompt produces different output for Midjourney (`--ar --v --style`) vs DALL-E (natural language + size)
3. **No category = no problem** — callers can send just a prompt string and get optimized results
4. **Explicit mode skips detection** — when category/platform are provided, detection is skipped (faster, no extra LLM call)
5. **Default platforms are transparent** — `list_categories` and `detection` metadata show which platform was auto-selected and why
