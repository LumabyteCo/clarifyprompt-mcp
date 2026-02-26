#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getOptimizationEngine } from "./engine/optimization/engine.js";
import { CATEGORIES, MODES, getPlatformsForCategory } from "./engine/config/categories.js";

const server = new McpServer({
  name: "clarifyprompt",
  version: "1.0.1",
});

// --- Tools ---

server.tool(
  "optimize_prompt",
  "Optimize a prompt for a specific AI platform. Supports 7 categories and 58 platforms including Midjourney, DALL-E, Stable Diffusion, Sora, Runway, HeyGen, ElevenLabs, Suno, Claude, ChatGPT, DeepSeek, Cursor, Jasper, and more. Category and platform are auto-detected when omitted.",
  {
    prompt: z.string().describe("The prompt to optimize"),
    category: z.enum(["chat", "image", "voice", "video", "music", "code", "document"]).optional().describe("Prompt category. Auto-detected from prompt content when omitted."),
    platform: z.string().optional().describe("Target platform ID (e.g. midjourney, dall-e, sora, suno, claude, cursor). Uses category default when omitted."),
    mode: z.enum(["concise", "detailed", "structured", "step-by-step", "bullet-points", "technical", "simple"]).optional().default("detailed").describe("Output mode"),
    enrich_context: z.boolean().optional().default(false).describe("Use web search for context enrichment (supports Tavily, Brave, Serper, SerpAPI, Exa, SearXNG)"),
  },
  async ({ prompt, category, platform, mode, enrich_context }) => {
    const engine = getOptimizationEngine();
    const result = await engine.optimize({
      prompt,
      category: category || undefined,
      platform: platform || undefined,
      mode: mode ?? "detailed",
      enrichContext: enrich_context,
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "list_categories",
  "List all available prompt optimization categories (chat, image, video, voice, music, code, document)",
  {},
  async () => {
    const cats = CATEGORIES.map(c => ({
      id: c.id,
      label: c.label,
      description: c.description,
      has_platforms: c.hasPlatforms,
      platform_count: c.platforms?.length ?? 0,
      default_platform: c.defaultPlatform ?? null,
      default_mode: c.defaultMode,
    }));
    return { content: [{ type: "text" as const, text: JSON.stringify(cats, null, 2) }] };
  }
);

server.tool(
  "list_platforms",
  "List available platforms for a category. Use this to discover which platforms are supported for image, video, voice, music, or code categories.",
  {
    category: z.enum(["chat", "image", "voice", "video", "music", "code", "document"]).describe("Category to list platforms for"),
  },
  async ({ category }) => {
    const cat = CATEGORIES.find(c => c.id === category);
    const platforms = getPlatformsForCategory(category);
    const result = platforms.map(p => ({
      id: p.id,
      label: p.label,
      description: p.description,
      is_default: p.id === cat?.defaultPlatform,
      syntax_hints: p.syntaxHints,
    }));
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "list_modes",
  "List available output modes for prompt optimization (concise, detailed, structured, step-by-step, bullet-points, technical, simple)",
  {},
  async () => {
    return { content: [{ type: "text" as const, text: JSON.stringify(MODES, null, 2) }] };
  }
);

// --- Resources ---

server.resource(
  "categories",
  "clarifyprompt://categories",
  { description: "Full category configuration with all platforms and modes", mimeType: "application/json" },
  async () => ({
    contents: [{
      uri: "clarifyprompt://categories",
      mimeType: "application/json",
      text: JSON.stringify(CATEGORIES, null, 2),
    }],
  })
);

// --- Connect ---

const transport = new StdioServerTransport();
await server.connect(transport);
