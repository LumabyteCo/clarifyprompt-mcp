#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getOptimizationEngine } from "./engine/optimization/engine.js";
import { CATEGORIES, MODES, getPlatformById } from "./engine/config/categories.js";
import { getConfigStore } from "./engine/config/persistence.js";
import { getPlatformRegistry } from "./engine/config/registry.js";
import { buildContextBundle } from "./engine/context/bundle.js";
import { getSessionStore } from "./engine/context/sessionSignals.js";
import { getTraceWriter } from "./engine/trace/writer.js";

const server = new McpServer({
  name: "clarifyprompt",
  version: "1.2.0",
});

const CATEGORY_ENUM = z.enum(["chat", "image", "voice", "video", "music", "code", "document"]);
const MODE_ENUM = z.enum(["concise", "detailed", "structured", "step-by-step", "bullet-points", "technical", "simple"]);

// --- Tools ---

server.tool(
  "optimize_prompt",
  "Optimize a prompt for a specific AI platform. Context-aware: auto-gathers workspace signals (CLAUDE.md / AGENTS.md / .cursorrules / package.json), resolves intent + category + recommended mode in a single analysis step, shapes the system prompt to the target model's capabilities, and grounds the rewrite in a priority-ordered Grounding Context. Supports 58+ platforms across 7 categories, plus custom registered platforms. Category, platform, and mode are all optional — the engine chooses sane defaults from the analysis.",
  {
    prompt: z.string().describe("The prompt to optimize"),
    category: CATEGORY_ENUM.optional().describe("Prompt category. Auto-detected via the analyzer when omitted. When provided, the analyzer can still override if it's confident the hint is wrong."),
    platform: z.string().optional().describe("Target platform ID (e.g. midjourney, dall-e, sora, suno, claude, cursor, or a custom platform ID). Uses category default when omitted."),
    mode: MODE_ENUM.optional().describe("Output mode. When omitted, the engine uses the analyzer's intent-derived recommendation (e.g. production-code → technical, quick-draft → concise). When passed, user choice wins."),
    enrich_context: z.boolean().optional().default(false).describe("Use web search for context enrichment (Tavily/Brave/Serper/SerpAPI/Exa/SearXNG). Results merge into the single Grounding Context block."),
    session_id: z.string().optional().describe("Session ID to stitch related optimizations so the engine can reuse accepted prior outputs as few-shot examples. Auto-generated when omitted."),
    file_path: z.string().optional().describe("Active file path — infers language and grounds the rewrite"),
    file_language: z.string().optional().describe("Explicit language override for the active file"),
    file_excerpt: z.string().optional().describe("Short excerpt (≤2 KB) of the active file to ground the rewrite"),
    cwd: z.string().optional().describe("Working directory to scan for CLAUDE.md / AGENTS.md / .cursorrules / package.json. Defaults to server cwd."),
    user_locale: z.string().optional().describe("User locale hint (e.g. en-US, ar-EG)"),
    user_pinned_instructions: z.string().optional().describe("Pinned, always-applied user instructions (highest-priority grounding)"),
    include_bundle: z.boolean().optional().default(false).describe("Include the full resolved ContextBundle in the response (same shape as inspect_context returns)"),
    skip_intent_resolution: z.boolean().optional().default(false).describe("Skip the analyzer LLM call (faster; loses intent/category/mode recommendations)"),
  },
  async (args) => {
    const engine = getOptimizationEngine();
    const result = await engine.optimize({
      prompt: args.prompt,
      category: args.category || undefined,
      platform: args.platform || undefined,
      mode: args.mode,
      modeExplicit: args.mode !== undefined,
      enrichContext: args.enrich_context,
      sessionId: args.session_id,
      filePath: args.file_path,
      fileLanguage: args.file_language,
      fileExcerpt: args.file_excerpt,
      cwd: args.cwd,
      userLocale: args.user_locale,
      userPinnedInstructions: args.user_pinned_instructions,
      includeBundle: args.include_bundle,
      skipIntentResolution: args.skip_intent_resolution,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
  { category: CATEGORY_ENUM.describe("Category to list platforms for") },
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
  "List available output modes for prompt optimization",
  {},
  async () => ({ content: [{ type: "text" as const, text: JSON.stringify(MODES, null, 2) }] })
);

// --- Custom Platform Management ---

server.tool(
  "register_platform",
  "Register a new custom AI platform for prompt optimization.",
  {
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/)
      .describe("Unique platform ID (lowercase, alphanumeric with hyphens)"),
    category: CATEGORY_ENUM.describe("Category this platform belongs to"),
    label: z.string().describe("Human-readable platform name"),
    description: z.string().describe("Short description"),
    syntax_hints: z.array(z.string()).optional(),
    instructions: z.string().optional(),
    instructions_file: z.string().optional(),
  },
  async ({ id, category, label, description, syntax_hints, instructions, instructions_file }) => {
    const store = getConfigStore();
    await store.ensureLoaded();

    if (getPlatformById(category, id)) {
      return { content: [{ type: "text" as const, text: JSON.stringify({
        error: `Platform '${id}' already exists as a built-in in category '${category}'. Use update_platform to override.`
      })}], isError: true };
    }
    if (store.getCustomPlatforms(category).find(p => p.id === id)) {
      return { content: [{ type: "text" as const, text: JSON.stringify({
        error: `Custom platform '${id}' already exists in '${category}'. Use update_platform.`
      })}], isError: true };
    }

    const now = new Date().toISOString();
    store.addCustomPlatform({
      id, label, description, categoryId: category,
      syntaxHints: syntax_hints,
      instructions, instructionsFile: instructions_file,
      createdAt: now, updatedAt: now,
    });
    await store.save();

    return { content: [{ type: "text" as const, text: JSON.stringify({
      success: true,
      platform: { id, category, label, description, isCustom: true },
      config_dir: store.getInstructionsDir(),
      message: `Platform '${id}' registered in category '${category}'.`,
    }, null, 2) }] };
  }
);

server.tool(
  "update_platform",
  "Update a custom platform or add/override instructions on a built-in platform.",
  {
    id: z.string(),
    category: CATEGORY_ENUM,
    label: z.string().optional(),
    description: z.string().optional(),
    syntax_hints: z.array(z.string()).optional(),
    syntax_hints_append: z.array(z.string()).optional(),
    instructions: z.string().optional(),
    instructions_file: z.string().optional(),
  },
  async ({ id, category, label, description, syntax_hints, syntax_hints_append, instructions, instructions_file }) => {
    const store = getConfigStore();
    await store.ensureLoaded();

    const builtIn = getPlatformById(category, id);
    const customEntry = store.getCustomPlatforms(category).find(p => p.id === id);

    if (!builtIn && !customEntry) {
      return { content: [{ type: "text" as const, text: JSON.stringify({
        error: `Platform '${id}' not found in '${category}'.`
      })}], isError: true };
    }

    if (builtIn && !customEntry) {
      if (label || description || syntax_hints) {
        return { content: [{ type: "text" as const, text: JSON.stringify({
          error: `Cannot change label, description, or replace syntax_hints on built-in '${id}'.`
        })}], isError: true };
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
    return { content: [{ type: "text" as const, text: JSON.stringify({
      success: true, message: `Platform '${id}' updated in '${category}'.`,
    }, null, 2) }] };
  }
);

server.tool(
  "unregister_platform",
  "Remove a custom platform, or clear instruction overrides on a built-in.",
  {
    id: z.string(),
    category: CATEGORY_ENUM,
    remove_override_only: z.boolean().optional().default(false),
  },
  async ({ id, category, remove_override_only }) => {
    const store = getConfigStore();
    await store.ensureLoaded();

    const builtIn = getPlatformById(category, id);
    const customEntry = store.getCustomPlatforms(category).find(p => p.id === id);

    if (builtIn && !remove_override_only) {
      return { content: [{ type: "text" as const, text: JSON.stringify({
        error: `Cannot remove built-in '${id}'. Use remove_override_only: true for overrides.`
      })}], isError: true };
    }
    if (builtIn) store.removeOverride(category, id);
    else if (customEntry) { store.removeCustomPlatform(category, id); store.removeOverride(category, id); }
    else {
      return { content: [{ type: "text" as const, text: JSON.stringify({
        error: `Platform '${id}' not found in '${category}'.`
      })}], isError: true };
    }

    await store.save();
    return { content: [{ type: "text" as const, text: JSON.stringify({
      success: true,
      message: builtIn ? `Overrides removed from built-in '${id}'.` : `Custom '${id}' removed.`,
    }, null, 2) }] };
  }
);

// --- Context + Trace + Outcome Tools (1.2.0) ---

server.tool(
  "inspect_context",
  "Preview the ContextBundle (workspace rules, frameworks, target-model capabilities, resolved analysis, session history) without running optimization. Returns the same bundle that optimize_prompt would assemble.",
  {
    prompt: z.string(),
    category: CATEGORY_ENUM.optional(),
    cwd: z.string().optional(),
    file_path: z.string().optional(),
    file_language: z.string().optional(),
    file_excerpt: z.string().optional(),
    session_id: z.string().optional(),
    skip_intent_resolution: z.boolean().optional().default(false),
  },
  async (args) => {
    const bundle = await buildContextBundle({
      prompt: args.prompt,
      category: args.category,
      cwd: args.cwd,
      filePath: args.file_path,
      fileLanguage: args.file_language,
      fileExcerpt: args.file_excerpt,
      sessionId: args.session_id,
      skipIntentResolution: args.skip_intent_resolution,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(bundle, null, 2) }] };
  }
);

server.tool(
  "list_traces",
  "List recent optimization traces from the local tracer. Summary only; use get_trace for full records.",
  {
    day: z.string().optional().describe("UTC day YYYY-MM-DD; defaults to the most recent day with data"),
    limit: z.number().int().positive().max(500).optional().default(50),
  },
  async ({ day, limit }) => {
    const tracer = getTraceWriter();
    if (tracer.getMode() === 'off') {
      return { content: [{ type: "text" as const, text: JSON.stringify({ mode: 'off', message: 'Tracing disabled. Set CLARIFYPROMPT_TRACE=local to enable.' }, null, 2) }] };
    }
    let targetDay = day;
    if (!targetDay) targetDay = (await tracer.listDays())[0];
    if (!targetDay) {
      return { content: [{ type: "text" as const, text: JSON.stringify({
        mode: tracer.getMode(), tracesDir: tracer.getTracesDir(), entries: [],
      }, null, 2) }] };
    }
    const entries = await tracer.readDay(targetDay, limit ?? 50);
    const summary = entries.map(e => ({
      id: e.id, ts: e.ts, sessionId: e.sessionId,
      category: e.category, platform: e.platform, mode: e.mode,
      intent: e.bundleSummary.intent, targetFamily: e.bundleSummary.targetFamily,
      model: e.model, latencyMs: e.latencyMs,
      shapeBudget: e.shape?.budget, groundingSources: e.groundingSources,
      error: e.error?.message,
      promptPreview: e.input.originalPrompt.slice(0, 140),
    }));
    return { content: [{ type: "text" as const, text: JSON.stringify({
      mode: tracer.getMode(), tracesDir: tracer.getTracesDir(), day: targetDay,
      count: summary.length, entries: summary,
    }, null, 2) }] };
  }
);

server.tool(
  "get_trace",
  "Fetch the full trace for an optimization ID, including system prompt + output. Looks back 7 days by default.",
  {
    id: z.string(),
    lookback_days: z.number().int().positive().max(60).optional().default(7),
  },
  async ({ id, lookback_days }) => {
    const tracer = getTraceWriter();
    if (tracer.getMode() === 'off') {
      return { content: [{ type: "text" as const, text: JSON.stringify({ mode: 'off', message: 'Tracing disabled.' })}], isError: true };
    }
    const entry = await tracer.findById(id, lookback_days ?? 7);
    if (!entry) {
      return { content: [{ type: "text" as const, text: JSON.stringify({
        error: `Trace ${id} not found within last ${lookback_days ?? 7} days.`
      })}], isError: true };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(entry, null, 2) }] };
  }
);

server.tool(
  "save_outcome",
  "Tell ClarifyPrompt whether an optimization's output was accepted, edited, or rejected. Used to feed the session retrieval loop so accepted prior outputs are injected as few-shot examples into future similar prompts. In 1.3+ this will also feed the persistent memory layer.",
  {
    optimization_id: z.string().describe("The `id` returned from optimize_prompt"),
    session_id: z.string().describe("The `sessionId` returned from optimize_prompt. Required so the outcome lands in the right session bucket."),
    verdict: z.enum(['accepted', 'edited', 'rejected']).describe("accepted = user used the output as-is; edited = user kept it with edits; rejected = user threw it away"),
    diff: z.string().optional().describe("Optional: the user's edited version or a diff. Helps later retrieval quality."),
  },
  async ({ optimization_id, session_id, verdict, diff }) => {
    getSessionStore().recordOutcome(session_id, {
      optimizationId: optimization_id,
      verdict,
      ts: Date.now(),
      diff,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify({
      success: true,
      message: `Recorded ${verdict} for ${optimization_id} in session ${session_id}. ${
        verdict === 'accepted'
          ? 'This output will be used as a few-shot example for similar future prompts in this session.'
          : verdict === 'edited'
            ? 'Recorded for learning; not used as a pure example.'
            : 'Recorded so the engine avoids echoing this pattern.'
      }`,
    }, null, 2) }] };
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
