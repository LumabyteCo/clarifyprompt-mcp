#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getOptimizationEngine } from "./engine/optimization/engine.js";
import { CATEGORIES, MODES, getPlatformById } from "./engine/config/categories.js";
import { getConfigStore } from "./engine/config/persistence.js";
import { getPlatformRegistry } from "./engine/config/registry.js";

const server = new McpServer({
  name: "clarifyprompt",
  version: "1.1.0",
});

const CATEGORY_ENUM = z.enum(["chat", "image", "voice", "video", "music", "code", "document"]);

// --- Tools ---

server.tool(
  "optimize_prompt",
  "Optimize a prompt for a specific AI platform. Supports 7 categories and 58+ platforms including Midjourney, DALL-E, Stable Diffusion, Sora, Runway, HeyGen, ElevenLabs, Suno, Claude, ChatGPT, DeepSeek, Cursor, Jasper, and more. Also supports custom registered platforms. Category and platform are auto-detected when omitted.",
  {
    prompt: z.string().describe("The prompt to optimize"),
    category: CATEGORY_ENUM.optional().describe("Prompt category. Auto-detected from prompt content when omitted."),
    platform: z.string().optional().describe("Target platform ID (e.g. midjourney, dall-e, sora, suno, claude, cursor, or a custom platform ID). Uses category default when omitted."),
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
  "List all available prompt optimization categories with platform counts including custom platforms",
  {},
  async () => {
    const registry = getPlatformRegistry();
    const cats = await Promise.all(CATEGORIES.map(async c => {
      const allPlatforms = await registry.getPlatformsForCategory(c.id);
      return {
        id: c.id,
        label: c.label,
        description: c.description,
        has_platforms: c.hasPlatforms,
        platform_count: allPlatforms.length,
        builtin_count: c.platforms?.length ?? 0,
        custom_count: allPlatforms.filter(p => p.isCustom).length,
        default_platform: c.defaultPlatform ?? null,
        default_mode: c.defaultMode,
      };
    }));
    return { content: [{ type: "text" as const, text: JSON.stringify(cats, null, 2) }] };
  }
);

server.tool(
  "list_platforms",
  "List available platforms for a category, including custom registered platforms.",
  {
    category: CATEGORY_ENUM.describe("Category to list platforms for"),
  },
  async ({ category }) => {
    const cat = CATEGORIES.find(c => c.id === category);
    const registry = getPlatformRegistry();
    const platforms = await registry.getPlatformsForCategory(category);
    const result = platforms.map(p => ({
      id: p.id,
      label: p.label,
      description: p.description,
      is_default: p.id === cat?.defaultPlatform,
      is_custom: p.isCustom || false,
      syntax_hints: p.syntaxHints,
      has_instructions: !!(p.instructions || p.instructionsFile),
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

// --- Custom Platform Management Tools ---

server.tool(
  "register_platform",
  "Register a new custom AI platform for prompt optimization. The platform must belong to an existing category. Use instructions or instructions_file to provide detailed guidance on how prompts should be optimized for this platform.",
  {
    id: z.string()
      .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/)
      .describe("Unique platform ID (lowercase, alphanumeric with hyphens, e.g. 'my-llm')"),
    category: CATEGORY_ENUM.describe("Category this platform belongs to"),
    label: z.string().describe("Human-readable platform name (e.g. 'My Custom LLM')"),
    description: z.string().describe("Short description of the platform"),
    syntax_hints: z.array(z.string()).optional()
      .describe("Platform-specific syntax hints (e.g. ['system prompts', 'JSON mode'])"),
    instructions: z.string().optional()
      .describe("Inline instructions for prompt optimization on this platform"),
    instructions_file: z.string().optional()
      .describe("Path to a .md file with detailed instructions (relative to config dir's instructions/ folder, or absolute)"),
  },
  async ({ id, category, label, description, syntax_hints, instructions, instructions_file }) => {
    const store = getConfigStore();
    await store.ensureLoaded();

    const builtIn = getPlatformById(category, id);
    if (builtIn) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          error: `Platform '${id}' already exists as a built-in platform in category '${category}'. Use update_platform to add instructions to it.`
        }) }],
        isError: true,
      };
    }

    const existing = store.getCustomPlatforms(category).find(p => p.id === id);
    if (existing) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          error: `Custom platform '${id}' already exists in category '${category}'. Use update_platform to modify it.`
        }) }],
        isError: true,
      };
    }

    const now = new Date().toISOString();
    store.addCustomPlatform({
      id, label, description, categoryId: category,
      syntaxHints: syntax_hints,
      instructions, instructionsFile: instructions_file,
      createdAt: now, updatedAt: now,
    });
    await store.save();

    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: true,
        platform: { id, category, label, description, isCustom: true },
        config_dir: store.getInstructionsDir(),
        message: `Platform '${id}' registered in category '${category}'.${instructions_file ? ` Instructions file expected at: ${instructions_file}` : ''}`,
      }, null, 2) }],
    };
  }
);

server.tool(
  "update_platform",
  "Update a custom platform or add/override instructions on a built-in platform. For built-in platforms, only instructions, instructions_file, and syntax_hints_append are supported.",
  {
    id: z.string().describe("Platform ID to update"),
    category: CATEGORY_ENUM.describe("Category the platform belongs to"),
    label: z.string().optional().describe("Updated display name (custom platforms only)"),
    description: z.string().optional().describe("Updated description (custom platforms only)"),
    syntax_hints: z.array(z.string()).optional()
      .describe("Replace syntax hints (custom platforms only)"),
    syntax_hints_append: z.array(z.string()).optional()
      .describe("Additional syntax hints to append (works for both built-in and custom)"),
    instructions: z.string().optional()
      .describe("Inline instructions (replaces existing)"),
    instructions_file: z.string().optional()
      .describe("Path to .md instructions file (replaces existing)"),
  },
  async ({ id, category, label, description, syntax_hints, syntax_hints_append, instructions, instructions_file }) => {
    const store = getConfigStore();
    await store.ensureLoaded();

    const builtIn = getPlatformById(category, id);
    const customEntry = store.getCustomPlatforms(category).find(p => p.id === id);

    if (!builtIn && !customEntry) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          error: `Platform '${id}' not found in category '${category}'.`
        }) }],
        isError: true,
      };
    }

    if (builtIn && !customEntry) {
      if (label || description || syntax_hints) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            error: `Cannot change label, description, or replace syntax_hints on built-in platform '${id}'. Use syntax_hints_append, instructions, or instructions_file instead.`
          }) }],
          isError: true,
        };
      }
      store.setOverride({
        platformId: id, categoryId: category,
        instructions, instructionsFile: instructions_file,
        syntaxHintsAppend: syntax_hints_append,
        updatedAt: new Date().toISOString(),
      });
    } else {
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (label !== undefined) updates.label = label;
      if (description !== undefined) updates.description = description;
      if (syntax_hints !== undefined) updates.syntaxHints = syntax_hints;
      if (instructions !== undefined) updates.instructions = instructions;
      if (instructions_file !== undefined) updates.instructionsFile = instructions_file;
      store.updateCustomPlatform(category, id, updates);

      if (syntax_hints_append?.length) {
        store.setOverride({
          platformId: id, categoryId: category,
          syntaxHintsAppend: syntax_hints_append,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    await store.save();
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: true,
        message: `Platform '${id}' updated in category '${category}'.`,
      }, null, 2) }],
    };
  }
);

server.tool(
  "unregister_platform",
  "Remove a custom platform registration. Cannot remove built-in platforms, but can remove instruction overrides from them.",
  {
    id: z.string().describe("Platform ID to remove"),
    category: CATEGORY_ENUM.describe("Category the platform belongs to"),
    remove_override_only: z.boolean().optional().default(false)
      .describe("If true, only remove instruction overrides (for built-in platforms)"),
  },
  async ({ id, category, remove_override_only }) => {
    const store = getConfigStore();
    await store.ensureLoaded();

    const builtIn = getPlatformById(category, id);
    const customEntry = store.getCustomPlatforms(category).find(p => p.id === id);

    if (builtIn && !remove_override_only) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          error: `Cannot remove built-in platform '${id}'. Use remove_override_only: true to remove instruction overrides.`
        }) }],
        isError: true,
      };
    }

    if (builtIn) {
      store.removeOverride(category, id);
    } else if (customEntry) {
      store.removeCustomPlatform(category, id);
      store.removeOverride(category, id);
    } else {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          error: `Platform '${id}' not found in category '${category}'.`
        }) }],
        isError: true,
      };
    }

    await store.save();
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: true,
        message: builtIn
          ? `Instruction overrides removed from built-in platform '${id}'.`
          : `Custom platform '${id}' removed from category '${category}'.`,
      }, null, 2) }],
    };
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
