#!/usr/bin/env node

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getOptimizationEngine } from "./engine/optimization/engine.js";
import { CATEGORIES, MODES, getPlatformById, type Category } from "./engine/config/categories.js";
import { getConfigStore } from "./engine/config/persistence.js";
import { getPlatformRegistry } from "./engine/config/registry.js";
import { buildContextBundle } from "./engine/context/bundle.js";
import { getSessionStore } from "./engine/context/sessionSignals.js";
import { getTraceWriter } from "./engine/trace/writer.js";
import { getMemoryStore } from "./engine/memory/store.js";
import { reflectOnOutcome } from "./engine/memory/reflection.js";
import { loadKnowledgePack } from "./engine/memory/packs.js";
import { clarifyPrompt } from "./engine/clarification/clarify.js";
import { buildElicitationForm, applyElicitedAnswers } from "./engine/clarification/elicit.js";
import { groundPrompt } from "./engine/grounding/ground.js";
import { critiquePrompt } from "./engine/critique/critique.js";
import { composePrompt } from "./engine/composition/compose.js";
import { startTransport } from "./transport.js";

const VERSION = "1.12.1";

const CATEGORY_ENUM = z.enum(["chat", "image", "voice", "video", "music", "code", "document"]);
const MODE_ENUM = z.enum(["concise", "detailed", "structured", "step-by-step", "bullet-points", "technical", "simple"]);

// --- Structured-output helpers (1.7.0) ---------------------------------------
//
// Every tool declares an outputSchema, which makes the SDK require
// `structuredContent` on every non-error return (validated against the schema;
// error returns with `isError: true` skip validation — SDK mcp.js
// validateToolOutput). The text `content` stays byte-compatible with pre-1.7
// consumers: object payloads serialize identically, and the three list tools
// keep their bare-array text while structuredContent wraps the array in an
// object (the MCP spec requires object-typed structured output).
//
// Output schemas are deliberately permissive — all fields optional, objects
// passthrough, variable leaves typed as unknown. They document the shape for
// hosts without ever rejecting real engine output; the engine's TypeScript
// types remain the source of truth.

type Payload = Record<string, unknown>;

function ok(payload: Payload) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function okList(key: string, arr: unknown[]) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(arr, null, 2) }],
    structuredContent: { [key]: arr } as Payload,
  };
}

function fail(payload: Payload) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    isError: true as const,
  };
}

// --- Output schemas (1.7.0) ---------------------------------------------------

const LOOSE = z.object({}).passthrough();

const ANALYSIS_OUT = z.object({
  category: z.string(),
  intent: z.string(),
  recommendedMode: z.string(),
  confidence: z.string(),
  source: z.string(),
}).partial().passthrough();

const OPTIMIZATION_OUT = z.object({
  id: z.string(),
  sessionId: z.string(),
  originalPrompt: z.string(),
  optimizedPrompt: z.string(),
  category: z.string(),
  platform: z.string(),
  mode: z.string(),
  modeSource: z.string(),
  analysis: ANALYSIS_OUT,
  context: LOOSE,
  bundle: z.unknown(),
}).partial().passthrough();

const CATEGORIES_OUT = z.object({ categories: z.array(LOOSE) }).partial().passthrough();
const PLATFORMS_OUT = z.object({ platforms: z.array(LOOSE) }).partial().passthrough();
const MODES_OUT = z.object({ modes: z.array(z.unknown()) }).partial().passthrough();

const PLATFORM_MUTATION_OUT = z.object({
  success: z.boolean(),
  message: z.string(),
  platform: LOOSE,
  config_dir: z.string(),
}).partial().passthrough();

const BUNDLE_OUT = z.object({
  git: z.unknown(),
  environment: z.unknown(),
  analysis: z.unknown(),
}).partial().passthrough();

const TRACES_LIST_OUT = z.object({
  mode: z.string(),
  tracesDir: z.string(),
  day: z.string(),
  count: z.number(),
  entries: z.array(LOOSE),
  message: z.string(),
}).partial().passthrough();

const TRACE_OUT = z.object({
  id: z.string(),
  ts: z.unknown(),
  sessionId: z.string(),
  category: z.string(),
  platform: z.string(),
  mode: z.string(),
  model: z.string(),
  strategy: z.string(),
  latencyMs: z.number(),
}).partial().passthrough();

const OUTCOME_OUT = z.object({
  success: z.boolean(),
  verdict: z.string(),
  sessionId: z.string(),
  optimizationId: z.string(),
  reflection: LOOSE,
  message: z.string(),
}).partial().passthrough();

const MEMORY_SEARCH_OUT = z.object({
  query: z.string(),
  kinds: z.array(z.string()),
  count: z.number(),
  results: z.array(LOOSE),
}).partial().passthrough();

const MEMORY_REMEMBER_OUT = z.object({
  success: z.boolean(),
  id: z.number(),
  scope: z.string(),
  subject: z.string(),
  predicate: z.string(),
  object: z.string(),
  confidence: z.number(),
  message: z.string(),
}).partial().passthrough();

const MEMORY_FORGET_OUT = z.object({
  success: z.boolean(),
  id: z.number(),
  message: z.string(),
}).partial().passthrough();

const FACTS_LIST_OUT = z.object({
  scope: z.string(),
  predicate: z.string().nullable(),
  count: z.number(),
  facts: z.array(LOOSE),
}).partial().passthrough();

const CURATION_OUT = z.object({
  optimizationId: z.string(),
  explanation: z.string(),
  raw: z.unknown(),
  message: z.string(),
}).partial().passthrough();

const PACK_LOAD_OUT = z.object({
  success: z.boolean(),
  pack: LOOSE,
  chunks: z.number(),
  embedded: z.number(),
  skipped: z.number(),
  message: z.string(),
}).partial().passthrough();

const PACKS_LIST_OUT = z.object({
  scope: z.string().nullable(),
  count: z.number(),
  packs: z.array(LOOSE),
}).partial().passthrough();

const PACK_UNLOAD_OUT = z.object({
  success: z.boolean(),
  message: z.string(),
}).partial().passthrough();

const CLARIFY_OUT = z.object({
  clarificationNeeded: z.boolean(),
  reason: z.string(),
  questions: z.array(LOOSE),
  analysis: ANALYSIS_OUT,
  latencyMs: z.number(),
}).partial().passthrough();

const CRITIQUE_OUT = z.object({
  overallScore: z.number(),
  verdict: z.string(),
  summary: z.string(),
  dimensions: z.array(LOOSE),
  improvedPrompt: z.string(),
  improvements: z.array(z.string()),
  latencyMs: z.number(),
  judgeModel: z.string(),
  analysis: ANALYSIS_OUT,
}).partial().passthrough();

const COMPOSE_OUT = z.object({
  stages: z.array(LOOSE),
  finalPrompt: z.string(),
  clarificationRequired: z.boolean(),
  clarification: CLARIFY_OUT,
  grounding: OPTIMIZATION_OUT,
  optimization: OPTIMIZATION_OUT,
  critique: CRITIQUE_OUT,
  revised: z.boolean(),
  iterations: z.number(),
}).partial().passthrough();

// --- Server factory (1.11.0) -------------------------------------------------
//
// Build a FRESH McpServer per connection: exactly one for stdio, and one PER
// SESSION for streamable-http. This is the SDK's recommended pattern — sharing
// a single server instance across concurrent HTTP sessions can leak one client's
// response data to another (GHSA-345p-7cg4-v4c7). The module-level helpers,
// schemas, and engine singletons above are pure/stateless and safely shared.

export function createServer(): McpServer {
  const server = new McpServer({
    name: "clarifyprompt",
    version: VERSION,
  });

  // --- Tools ---

server.registerTool(
  "optimize_prompt",
  {
    title: "Optimize a prompt for a platform",
    description: "Optimize a prompt for a specific AI platform. Context-aware: auto-gathers workspace signals (CLAUDE.md / AGENTS.md / .cursorrules / package.json), resolves intent + category + recommended mode in a single analysis step, shapes the system prompt to the target model's capabilities, and grounds the rewrite in a priority-ordered Grounding Context. Supports 58+ platforms across 7 categories, plus custom registered platforms. Category, platform, and mode are all optional — the engine chooses sane defaults from the analysis.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    outputSchema: OPTIMIZATION_OUT,
    inputSchema: {
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
    return ok(result as unknown as Payload);
  }
);

server.registerTool(
  "list_categories",
  {
    title: "List categories",
    description: "List all available prompt optimization categories with platform counts including custom platforms",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    outputSchema: CATEGORIES_OUT,
    inputSchema: {},
  },
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
    return okList("categories", cats);
  }
);

server.registerTool(
  "list_platforms",
  {
    title: "List platforms",
    description: "List available platforms for a category, including custom registered platforms.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    outputSchema: PLATFORMS_OUT,
    inputSchema: { category: CATEGORY_ENUM.describe("Category to list platforms for") },
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
    return okList("platforms", result);
  }
);

server.registerTool(
  "list_modes",
  {
    title: "List output modes",
    description: "List available output modes for prompt optimization",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    outputSchema: MODES_OUT,
    inputSchema: {},
  },
  async () => okList("modes", MODES as unknown as unknown[])
);

// --- Custom Platform Management ---

server.registerTool(
  "register_platform",
  {
    title: "Register a custom platform",
    description: "Register a new custom AI platform for prompt optimization.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    outputSchema: PLATFORM_MUTATION_OUT,
    inputSchema: {
      id: z.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/)
        .describe("Unique platform ID (lowercase, alphanumeric with hyphens)"),
      category: CATEGORY_ENUM.describe("Category this platform belongs to"),
      label: z.string().describe("Human-readable platform name"),
      description: z.string().describe("Short description"),
      syntax_hints: z.array(z.string()).optional(),
      instructions: z.string().optional(),
      instructions_file: z.string().optional(),
    },
  },
  async ({ id, category, label, description, syntax_hints, instructions, instructions_file }) => {
    const store = getConfigStore();
    await store.ensureLoaded();

    if (getPlatformById(category, id)) {
      return fail({
        error: `Platform '${id}' already exists as a built-in in category '${category}'. Use update_platform to override.`,
      });
    }
    if (store.getCustomPlatforms(category).find(p => p.id === id)) {
      return fail({
        error: `Custom platform '${id}' already exists in '${category}'. Use update_platform.`,
      });
    }

    const now = new Date().toISOString();
    store.addCustomPlatform({
      id, label, description, categoryId: category,
      syntaxHints: syntax_hints,
      instructions, instructionsFile: instructions_file,
      createdAt: now, updatedAt: now,
    });
    await store.save();

    return ok({
      success: true,
      platform: { id, category, label, description, isCustom: true },
      config_dir: store.getInstructionsDir(),
      message: `Platform '${id}' registered in category '${category}'.`,
    });
  }
);

server.registerTool(
  "update_platform",
  {
    title: "Update a platform",
    description: "Update a custom platform or add/override instructions on a built-in platform.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    outputSchema: PLATFORM_MUTATION_OUT,
    inputSchema: {
      id: z.string(),
      category: CATEGORY_ENUM,
      label: z.string().optional(),
      description: z.string().optional(),
      syntax_hints: z.array(z.string()).optional(),
      syntax_hints_append: z.array(z.string()).optional(),
      instructions: z.string().optional(),
      instructions_file: z.string().optional(),
    },
  },
  async ({ id, category, label, description, syntax_hints, syntax_hints_append, instructions, instructions_file }) => {
    const store = getConfigStore();
    await store.ensureLoaded();

    const builtIn = getPlatformById(category, id);
    const customEntry = store.getCustomPlatforms(category).find(p => p.id === id);

    if (!builtIn && !customEntry) {
      return fail({ error: `Platform '${id}' not found in '${category}'.` });
    }

    if (builtIn && !customEntry) {
      if (label || description || syntax_hints) {
        return fail({
          error: `Cannot change label, description, or replace syntax_hints on built-in '${id}'.`,
        });
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
    return ok({
      success: true, message: `Platform '${id}' updated in '${category}'.`,
    });
  }
);

server.registerTool(
  "unregister_platform",
  {
    title: "Remove a custom platform / clear overrides",
    description: "Remove a custom platform, or clear instruction overrides on a built-in.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    outputSchema: PLATFORM_MUTATION_OUT,
    inputSchema: {
      id: z.string(),
      category: CATEGORY_ENUM,
      remove_override_only: z.boolean().optional().default(false),
    },
  },
  async ({ id, category, remove_override_only }) => {
    const store = getConfigStore();
    await store.ensureLoaded();

    const builtIn = getPlatformById(category, id);
    const customEntry = store.getCustomPlatforms(category).find(p => p.id === id);

    if (builtIn && !remove_override_only) {
      return fail({
        error: `Cannot remove built-in '${id}'. Use remove_override_only: true for overrides.`,
      });
    }
    if (builtIn) store.removeOverride(category, id);
    else if (customEntry) { store.removeCustomPlatform(category, id); store.removeOverride(category, id); }
    else {
      return fail({ error: `Platform '${id}' not found in '${category}'.` });
    }

    await store.save();
    return ok({
      success: true,
      message: builtIn ? `Overrides removed from built-in '${id}'.` : `Custom '${id}' removed.`,
    });
  }
);

// --- Context + Trace + Outcome Tools (1.2.0) ---

server.registerTool(
  "inspect_context",
  {
    title: "Inspect the context bundle",
    description: "Preview the ContextBundle (workspace rules, frameworks, target-model capabilities, resolved analysis, session history) without running optimization. Returns the same bundle that optimize_prompt would assemble.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    outputSchema: BUNDLE_OUT,
    inputSchema: {
      prompt: z.string(),
      category: CATEGORY_ENUM.optional(),
      cwd: z.string().optional(),
      file_path: z.string().optional(),
      file_language: z.string().optional(),
      file_excerpt: z.string().optional(),
      session_id: z.string().optional(),
      skip_intent_resolution: z.boolean().optional().default(false),
    },
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
    return ok(bundle as unknown as Payload);
  }
);

server.registerTool(
  "list_traces",
  {
    title: "List optimization traces",
    description: "List recent optimization traces from the local tracer. Summary only; use get_trace for full records.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    outputSchema: TRACES_LIST_OUT,
    inputSchema: {
      day: z.string().optional().describe("UTC day YYYY-MM-DD; defaults to the most recent day with data"),
      limit: z.number().int().positive().max(500).optional().default(50),
    },
  },
  async ({ day, limit }) => {
    const tracer = getTraceWriter();
    if (tracer.getMode() === 'off') {
      return ok({ mode: 'off', message: 'Tracing disabled. Set CLARIFYPROMPT_TRACE=local to enable.' });
    }
    let targetDay = day;
    if (!targetDay) targetDay = (await tracer.listDays())[0];
    if (!targetDay) {
      return ok({
        mode: tracer.getMode(), tracesDir: tracer.getTracesDir(), entries: [],
      });
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
    return ok({
      mode: tracer.getMode(), tracesDir: tracer.getTracesDir(), day: targetDay,
      count: summary.length, entries: summary,
    });
  }
);

server.registerTool(
  "get_trace",
  {
    title: "Get a full trace",
    description: "Fetch the full trace for an optimization ID, including system prompt + output. Looks back 7 days by default.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    outputSchema: TRACE_OUT,
    inputSchema: {
      id: z.string(),
      lookback_days: z.number().int().positive().max(60).optional().default(7),
    },
  },
  async ({ id, lookback_days }) => {
    const tracer = getTraceWriter();
    if (tracer.getMode() === 'off') {
      return fail({ mode: 'off', message: 'Tracing disabled.' });
    }
    const entry = await tracer.findById(id, lookback_days ?? 7);
    if (!entry) {
      return fail({ error: `Trace ${id} not found within last ${lookback_days ?? 7} days.` });
    }
    return ok(entry as unknown as Payload);
  }
);

server.registerTool(
  "save_outcome",
  {
    title: "Record an outcome (accept / edit / reject)",
    description: "Tell ClarifyPrompt whether an optimization's output was accepted, edited, or rejected. Feeds two loops: (1) the session ring buffer so accepted prior outputs are injected as few-shot examples into future similar prompts, and (2) the persistent memory layer via reflection — on accept/edit, ClarifyPrompt extracts atomic facts from the interaction and stores them; on reject, recent reflection facts from this session are invalidated. Reflection uses the same LLM you've configured; expect a 1–3s latency on local models.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    outputSchema: OUTCOME_OUT,
    inputSchema: {
      optimization_id: z.string().describe("The `id` returned from optimize_prompt"),
      session_id: z.string().describe("The `sessionId` returned from optimize_prompt. Required so the outcome lands in the right session bucket."),
      verdict: z.enum(['accepted', 'edited', 'rejected']).describe("accepted = user used the output as-is; edited = user kept it with edits; rejected = user threw it away"),
      diff: z.string().optional().describe("Optional: the user's edited version or a diff. Helps reflection extract better facts."),
      skip_reflection: z.boolean().optional().default(false).describe("Skip the LLM-based fact extraction pass (faster, no facts learned)"),
    },
  },
  async ({ optimization_id, session_id, verdict, diff, skip_reflection }) => {
    // Fast path: session ring buffer
    getSessionStore().recordOutcome(session_id, {
      optimizationId: optimization_id,
      verdict,
      ts: Date.now(),
      diff,
    });

    // Persistent path: outcome record in memory.db
    let reflection: { factsExtracted: number; factsInvalidated: number; source: string; notes?: string } | undefined;
    try {
      const store = getMemoryStore();
      if (store.isHealthy()) {
        store.recordOutcome({
          optimizationId: optimization_id,
          sessionId: session_id,
          verdict,
          diff,
        });
        if (!skip_reflection) {
          const r = await reflectOnOutcome({ optimizationId: optimization_id, sessionId: session_id, verdict, diff });
          reflection = { factsExtracted: r.factsExtracted, factsInvalidated: r.factsInvalidated, source: r.source, notes: r.notes };
        }
      }
    } catch (err) {
      reflection = { factsExtracted: 0, factsInvalidated: 0, source: 'error', notes: (err as Error).message };
    }

    return ok({
      success: true,
      verdict,
      sessionId: session_id,
      optimizationId: optimization_id,
      reflection,
      message: `Recorded ${verdict} for ${optimization_id} in session ${session_id}. ${
        verdict === 'accepted'
          ? `Session ring buffer updated. ${reflection ? `Reflection extracted ${reflection.factsExtracted} fact(s) into persistent memory.` : ''}`
          : verdict === 'edited'
            ? `Session ring buffer updated. ${reflection ? `Reflection extracted ${reflection.factsExtracted} fact(s) (at reduced confidence) into persistent memory.` : ''}`
            : `Anti-pattern recorded. ${reflection ? `Invalidated ${reflection.factsInvalidated} recent reflection fact(s) from this session.` : ''}`
      }`.trim(),
    });
  }
);

server.registerTool(
  "memory_search",
  {
    title: "Search persistent memory",
    description: "Semantic search over the persistent memory store. Returns facts, pack chunks, and past optimizations ranked by vector similarity to the query. Useful for inspecting what ClarifyPrompt would retrieve for a given prompt, and for debugging curator decisions.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    outputSchema: MEMORY_SEARCH_OUT,
    inputSchema: {
      query: z.string().describe("The search query — usually the user's intent or a paraphrase of a future prompt."),
      kinds: z.array(z.enum(['fact', 'outcome', 'pack_chunk', 'optimization'])).optional().default(['fact', 'pack_chunk'])
        .describe("Which memory kinds to search. Default: facts + pack chunks."),
      limit: z.number().int().positive().max(25).optional().default(5),
    },
  },
  async ({ query, kinds, limit }) => {
    const store = getMemoryStore();
    if (!store.isHealthy()) {
      return fail({ error: 'memory store not healthy (sqlite-vec may have failed to load)' });
    }
    if (!store.hasVectors()) {
      return fail({ error: 'vector search unavailable (sqlite-vec not loaded)' });
    }
    const results = [];
    for (const k of (kinds ?? ['fact', 'pack_chunk'])) {
      const hits = await store.searchByVector(k, query, limit ?? 5);
      results.push(...hits);
    }
    results.sort((a, b) => b.similarity - a.similarity);
    return ok({
      query, kinds: kinds ?? ['fact', 'pack_chunk'],
      count: results.length,
      results: results.slice(0, limit ?? 5),
    });
  }
);

server.registerTool(
  "memory_remember",
  {
    title: "Remember a fact",
    description: "Explicitly add a fact to persistent memory. Use when the user says something the engine should remember across sessions (preferences, conventions, project facts). Complements `save_outcome` reflection, which extracts facts implicitly — this is the explicit, user-driven path. Returns the new fact id, which can be passed to `memory_forget` later.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    outputSchema: MEMORY_REMEMBER_OUT,
    inputSchema: {
      subject: z.string().describe("Who/what the fact is about. Examples: 'user', 'project', 'this codebase', a person's name."),
      predicate: z.string().describe("Short verb phrase. Examples: 'prefers', 'uses', 'avoids', 'requires', 'is'."),
      object: z.string().describe("The concrete value. Example: 'TypeScript with strict mode'."),
      scope: z.string().optional().default('user').describe("Memory scope. Default 'user' (cross-session, cross-project). Use 'project:<name>' for project-local memory, 'session:<id>' for ephemeral session-only memory."),
      confidence: z.number().min(0).max(1).optional().default(1.0).describe("0-1 confidence. Default 1.0 for explicit user remember. Reflection-extracted facts use 0.6-0.8."),
    },
  },
  async ({ subject, predicate, object, scope, confidence }) => {
    const store = getMemoryStore();
    if (!store.isHealthy()) {
      return fail({ error: 'memory store not healthy' });
    }
    const factId = store.insertFact({
      scope: scope ?? 'user',
      subjectText: subject,
      predicate,
      objectText: object,
      confidence: confidence ?? 1.0,
      source: 'user:explicit',
    });
    // Embed for future semantic retrieval. Non-fatal if embeddings unavailable.
    if (store.hasVectors()) {
      try {
        await store.embedAndStore('fact', factId, `${subject} ${predicate} ${object}`);
      } catch { /* embeddings can fail without breaking the remember */ }
    }
    return ok({
      success: true,
      id: factId,
      scope: scope ?? 'user',
      subject, predicate, object,
      confidence: confidence ?? 1.0,
      message: `Remembered fact #${factId} in scope '${scope ?? 'user'}'. It will surface in future memory_search and grounding calls.`,
    });
  }
);

server.registerTool(
  "memory_forget",
  {
    title: "Forget a fact",
    description: "Invalidate (soft-delete) a fact by its id. The fact is marked invalidated_at = now and won't appear in future memory_search or grounding, but its history is preserved (bi-temporal soft-delete). Use `memory_list_facts` first to find the id you want to forget.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    outputSchema: MEMORY_FORGET_OUT,
    inputSchema: {
      id: z.number().int().positive().describe("Fact id (from memory_remember response, memory_search result, or memory_list_facts row)."),
    },
  },
  async ({ id }) => {
    const store = getMemoryStore();
    if (!store.isHealthy()) {
      return fail({ error: 'memory store not healthy' });
    }
    const invalidated = store.invalidateFact(id);
    if (!invalidated) {
      return ok({
        success: false,
        id,
        message: `Fact #${id} not found, or was already invalidated. No change.`,
      });
    }
    return ok({
      success: true,
      id,
      message: `Fact #${id} invalidated. It won't surface in future memory_search or grounding.`,
    });
  }
);

server.registerTool(
  "memory_list_facts",
  {
    title: "List remembered facts",
    description: "List live (non-invalidated) facts in persistent memory, optionally filtered by scope and predicate. Sorted by most-recently-observed first. Useful for inspecting what the engine knows, or finding fact ids to forget.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    outputSchema: FACTS_LIST_OUT,
    inputSchema: {
      scope: z.string().optional().default('user').describe("Memory scope to filter by. Default 'user'. Examples: 'user', 'project:myapp', 'session:abc'."),
      predicate: z.string().optional().describe("Optional predicate filter (e.g., only 'prefers' facts)."),
      limit: z.number().int().positive().max(100).optional().default(50).describe("Max facts to return. Default 50, hard max 100."),
    },
  },
  async ({ scope, predicate, limit }) => {
    const store = getMemoryStore();
    if (!store.isHealthy()) {
      return fail({ error: 'memory store not healthy' });
    }
    const facts = store.listLiveFacts(scope ?? 'user', predicate, limit ?? 50);
    return ok({
      scope: scope ?? 'user',
      predicate: predicate ?? null,
      count: facts.length,
      facts: facts.map(f => ({
        id: f.id,
        subject: f.subjectText,
        predicate: f.predicate,
        object: f.objectText,
        confidence: f.confidence,
        source: f.source,
        observedAt: new Date(f.observedAt).toISOString(),
      })),
    });
  }
);

server.registerTool(
  "explain_last_curation",
  {
    title: "Explain the last curation",
    description: "Render a human-readable explanation of the Context Curator's decisions for the most recent (or a specified) optimization. Shows every candidate that was considered, whether it was selected or rejected, why, and how many tokens it used against the budget. Use this when an output felt off and you want to understand which grounding sources the engine chose.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    outputSchema: CURATION_OUT,
    inputSchema: {
      optimization_id: z.string().optional().describe("Optional trace ID. If omitted, explains the most recent trace."),
      lookback_days: z.number().int().positive().max(60).optional().default(1),
    },
  },
  async ({ optimization_id, lookback_days }) => {
    const tracer = getTraceWriter();
    if (tracer.getMode() === 'off') {
      return fail({ error: 'tracing disabled; cannot explain curation' });
    }
    let entry;
    if (optimization_id) {
      entry = await tracer.findById(optimization_id, lookback_days ?? 1);
      if (!entry) {
        return fail({ error: `trace ${optimization_id} not found in last ${lookback_days} days` });
      }
    } else {
      const days = await tracer.listDays();
      if (!days.length) return fail({ error: 'no traces yet' });
      const recent = await tracer.readDay(days[0], 1);
      entry = recent[recent.length - 1];
      if (!entry) return fail({ error: 'no traces yet' });
    }
    const c = entry.curation;
    if (!c) {
      return ok({
        optimizationId: entry.id,
        message: 'This trace pre-dates the Context Curator (1.3.0+) or ran through a fallback path. No curation log available.',
      });
    }
    const lines: string[] = [];
    lines.push(`# Curation log — ${entry.id}`);
    lines.push(`Model: ${entry.model}  |  Strategy: ${entry.strategy}  |  Category/Mode: ${entry.category}/${entry.mode}`);
    lines.push(`Budget: ${c.used} / ${c.budget.availableForGrounding} tokens used for grounding (reserved ${c.budget.reservedForPrompt} for prompt).`);
    lines.push('');
    lines.push(`## Selected (${c.selected.length} sections)`);
    for (const s of c.selected) {
      lines.push(`  ✔ ${s.source.padEnd(28)}  tokens=${String(s.tokens).padStart(5)}  utility=${s.utility.toFixed(2)}${s.pinned ? '  [PINNED]' : ''}  — ${s.label}`);
    }
    lines.push('');
    if (c.rejected.length) {
      lines.push(`## Rejected (${c.rejected.length})`);
      for (const r of c.rejected) {
        lines.push(`  ✖ ${r.source.padEnd(28)}  tokens=${String(r.tokens).padStart(5)}  utility=${r.utility.toFixed(2)}  — reason: ${r.reason}`);
      }
    } else {
      lines.push(`## Rejected (0) — everything fit.`);
    }
    return ok({
      optimizationId: entry.id,
      explanation: lines.join('\n'),
      raw: c,
    });
  }
);

// --- Knowledge Packs (1.3.0) ---

server.registerTool(
  "load_knowledge_pack",
  {
    title: "Load a knowledge pack",
    description: "Load a knowledge pack — a markdown document with optional YAML frontmatter — into the persistent memory store. The pack is chunked by heading, each chunk embedded, and made available for semantic retrieval during subsequent optimize_prompt calls. Packs can come from a local file path, an HTTPS URL, or be passed inline as raw markdown. Bundled packs + authoring guide: https://github.com/LumabyteCo/clarifyprompt-mcp/tree/main/packs",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    outputSchema: PACK_LOAD_OUT,
    inputSchema: {
      source: z.string().describe("Local file path, HTTPS URL, or inline markdown body (auto-detected)."),
      source_type: z.enum(['auto', 'local', 'url', 'inline', 'registry']).optional().default('auto')
        .describe("Override source-type detection. `registry` marks a pack as community-sourced."),
      scope: z.string().optional().describe("Scope to load under (e.g. 'user', 'project:myapp'). Defaults to pack frontmatter or 'user'."),
      name: z.string().optional().describe("Override the pack name (else pulled from frontmatter)."),
      version: z.string().optional().describe("Override the pack version (else pulled from frontmatter or '0.0.0')."),
    },
  },
  async (args) => {
    try {
      const result = await loadKnowledgePack({
        source: args.source,
        sourceType: args.source_type,
        scope: args.scope,
        name: args.name,
        version: args.version,
      });
      return ok({
        success: true,
        pack: result.pack,
        chunks: result.chunks,
        embedded: result.embedded,
        skipped: result.skipped,
        message: `Loaded pack '${result.pack.name}@${result.pack.version}' with ${result.chunks} chunks (${result.embedded} embedded, ${result.skipped} not embedded). Chunks will surface in future optimize_prompt calls via semantic retrieval.`,
      });
    } catch (err) {
      return fail({ error: `Failed to load pack: ${(err as Error).message}` });
    }
  }
);

server.registerTool(
  "list_packs",
  {
    title: "List loaded packs",
    description: "List knowledge packs currently loaded in the persistent memory store.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    outputSchema: PACKS_LIST_OUT,
    inputSchema: {
      scope: z.string().optional().describe("Filter by scope (e.g. 'user', 'project:myapp'). Omit to list all."),
    },
  },
  async ({ scope }) => {
    const store = getMemoryStore();
    if (!store.isHealthy()) {
      return fail({ error: 'memory store not healthy' });
    }
    const packs = store.listPacks(scope);
    return ok({
      scope: scope ?? null,
      count: packs.length,
      packs: packs.map(p => ({
        id: p.id, name: p.name, version: p.version, scope: p.scope,
        sourceType: p.sourceType, sourceRef: p.sourceRef,
        loadedAt: new Date(p.loadedAt).toISOString(),
        metadata: p.metadata,
      })),
    });
  }
);

server.registerTool(
  "unload_pack",
  {
    title: "Unload a knowledge pack",
    description: "Remove a loaded knowledge pack (and all its chunks + embeddings) from the memory store.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    outputSchema: PACK_UNLOAD_OUT,
    inputSchema: {
      id: z.number().int().describe("Pack id (as returned by list_packs)."),
    },
  },
  async ({ id }) => {
    const store = getMemoryStore();
    if (!store.isHealthy()) {
      return fail({ error: 'memory store not healthy' });
    }
    store.removePack(id);
    return ok({
      success: true,
      message: `Pack ${id} removed (cascade-deleted all its chunks + embeddings).`,
    });
  }
);

// --- Clarification (1.4.0-dev) ---

server.registerTool(
  "clarify_with_user",
  {
    title: "Ask clarifying questions",
    description: "Given an ambiguous draft prompt, return 1–3 targeted clarifying questions instead of guessing. Each question carries a `suggested_answer` you can accept verbatim to keep moving, an optional 2–4 quick-pick `options` list, and a `dimension` tag (audience/scope/format/length/tone/constraints/goal/platform). When the analyzer is highly confident AND the prompt is non-trivially long, the tool short-circuits with `clarificationNeeded: false` so callers can pipeline this in front of optimize_prompt without paying a latency tax on every call. Pass `force: true` to always generate questions. Pass `elicit: true` to collect answers interactively through the host's native form UI (MCP elicitation) instead of returning the raw questions — when the client supports it.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    outputSchema: CLARIFY_OUT,
    inputSchema: {
      prompt: z.string().describe("The draft prompt the user is unsure about."),
      category: CATEGORY_ENUM.optional().describe("Category hint. Will skip questions about category/platform if you pass it."),
      cwd: z.string().optional().describe("Working directory to pull workspace rules (CLAUDE.md / AGENTS.md / .cursorrules) from. Defaults to server cwd."),
      file_path: z.string().optional().describe("Active file path — informs the clarifier's defaults."),
      file_language: z.string().optional().describe("Explicit language override for the active file."),
      file_excerpt: z.string().optional().describe("Short excerpt of the active file to ground the questions."),
      user_locale: z.string().optional(),
      force: z.boolean().optional().default(false).describe("Always generate questions even when the analyzer is highly confident. Useful for UIs that want to surface clarification on every call."),
      max_questions: z.number().int().positive().max(5).optional().default(3).describe("Cap on returned questions. Default 3, hard max 5."),
      elicit: z.boolean().optional().default(false).describe("When true AND the connected client supports MCP elicitation, render the questions as a native form, collect the user's answers inline, and return them as `answers` (each question's suggested answer is the field default). Falls back to returning the raw questions when the client can't elicit. Default false (back-compat)."),
    },
  },
  async (args) => {
    const result = await clarifyPrompt({
      prompt: args.prompt,
      category: args.category,
      cwd: args.cwd,
      filePath: args.file_path,
      fileLanguage: args.file_language,
      fileExcerpt: args.file_excerpt,
      userLocale: args.user_locale,
      force: args.force,
      maxQuestions: args.max_questions,
    });

    // Elicitation path (1.9.0, roadmap #4): when the caller asks for it AND the
    // connected client advertised the `elicitation` capability, render the
    // questions as a native form, collect answers inline, and return them. Any
    // failure (unsupported client, transport hiccup) degrades to the raw-questions
    // JSON — fully back-compat with every existing caller.
    const clientCaps = server.server.getClientCapabilities();
    if (args.elicit && clientCaps?.elicitation && result.questions.length > 0) {
      try {
        const elicitRes = await server.server.elicitInput({
          message: result.reason || "A few quick questions to sharpen your prompt:",
          requestedSchema: buildElicitationForm(result.questions),
        });
        if (elicitRes.action === "accept") {
          return ok({
            ...result,
            elicited: true,
            elicitationAction: "accept",
            answers: applyElicitedAnswers(result.questions, elicitRes.content),
          } as unknown as Payload);
        }
        // decline / cancel — surface the action; caller keeps the raw questions.
        return ok({ ...result, elicited: true, elicitationAction: elicitRes.action } as unknown as Payload);
      } catch (err) {
        return ok({ ...result, elicited: false, elicitationError: (err as Error).message } as unknown as Payload);
      }
    }
    return ok(result as unknown as Payload);
  }
);

// --- Strict Grounding (1.4.0-dev) ---

server.registerTool(
  "ground_prompt",
  {
    title: "Optimize against explicit sources",
    description: "Optimize a prompt against EXPLICIT caller-provided grounding sources (a spec, a transcript excerpt, an RFC, an internal doc, etc.). Each source is pinned at the highest priority — above project rules, above pinned instructions — and tracked individually in the trace. Use this when you want the rewrite to cite specific material rather than letting the curator decide what's relevant. Requires at least one non-empty source; will error rather than silently fall through to optimize_prompt. Sources are capped at 4000 chars each so a single large paste can't dominate the budget.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    outputSchema: OPTIMIZATION_OUT,
    inputSchema: {
      prompt: z.string().describe("The prompt to optimize."),
      sources: z.array(z.object({
        label: z.string().describe("Human-facing heading for this source (e.g. 'RFC 5322 §3.4')."),
        body: z.string().describe("Source content. Used verbatim. Capped at 4000 chars per source."),
        kind: z.string().optional().describe("Optional categorization (e.g. 'spec', 'transcript', 'doc'). Free-form."),
      })).min(1).describe("Caller-provided grounding sources. Must be non-empty."),
      category: CATEGORY_ENUM.optional(),
      platform: z.string().optional(),
      mode: MODE_ENUM.optional(),
      cwd: z.string().optional(),
      file_path: z.string().optional(),
      file_language: z.string().optional(),
      file_excerpt: z.string().optional(),
      session_id: z.string().optional(),
      user_locale: z.string().optional(),
      user_pinned_instructions: z.string().optional(),
      enrich_context: z.boolean().optional().default(false),
      skip_intent_resolution: z.boolean().optional().default(false),
      include_bundle: z.boolean().optional().default(false),
    },
  },
  async (args) => {
    try {
      const result = await groundPrompt({
        prompt: args.prompt,
        sources: args.sources,
        category: args.category,
        platform: args.platform,
        mode: args.mode,
        modeExplicit: args.mode !== undefined,
        cwd: args.cwd,
        filePath: args.file_path,
        fileLanguage: args.file_language,
        fileExcerpt: args.file_excerpt,
        sessionId: args.session_id,
        userLocale: args.user_locale,
        userPinnedInstructions: args.user_pinned_instructions,
        enrichContext: args.enrich_context,
        skipIntentResolution: args.skip_intent_resolution,
        includeBundle: args.include_bundle,
      });
      return ok(result as unknown as Payload);
    } catch (err) {
      return fail({ error: (err as Error).message });
    }
  }
);

// --- Critique (1.4.0-dev) ---

server.registerTool(
  "critique_prompt",
  {
    title: "Critique a prompt (LLM-as-judge)",
    description: "LLM-as-judge for a prompt. Scores it 0–10 across 5 default dimensions (clarity, specificity, intent_alignment, format_fitness, length_appropriateness) — or your own custom criteria — and returns per-dimension rationale + concrete suggestions, an overall score, and a verdict (`accept` / `revise` / `reject`). When the score is below `revise_threshold` (default 7.0), the tool also returns an `improvedPrompt` you can use as a drop-in replacement. Use it pre-flight (is this prompt good enough for the expensive model?), postmortem (was the prompt the cause of a bad output?), or to A/B-pick the best of N optimization variants. Pass `original_prompt` when critiquing an optimized version so the judge can verify intent was preserved.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    outputSchema: CRITIQUE_OUT,
    inputSchema: {
      prompt: z.string().describe("The candidate prompt to critique."),
      original_prompt: z.string().optional().describe("If `prompt` is an optimized version, the user's original ask. Used for the intent_alignment dimension."),
      category: CATEGORY_ENUM.optional(),
      cwd: z.string().optional(),
      file_path: z.string().optional(),
      file_language: z.string().optional(),
      file_excerpt: z.string().optional(),
      user_locale: z.string().optional(),
      criteria: z.array(z.object({
        name: z.string().describe("Short snake_case identifier."),
        description: z.string().describe("One sentence explaining what this dimension measures."),
      })).optional().describe("Override the default 5 criteria. Up to ~8 dimensions; more bloats the judge call."),
      revise_threshold: z.number().min(0).max(10).optional().default(7.0).describe("Overall score below this triggers the rewrite pass. Default 7.0."),
      skip_rewrite: z.boolean().optional().default(false).describe("Skip the rewrite pass even when below threshold (faster; just returns scores)."),
    },
  },
  async (args) => {
    const result = await critiquePrompt({
      prompt: args.prompt,
      originalPrompt: args.original_prompt,
      category: args.category,
      cwd: args.cwd,
      filePath: args.file_path,
      fileLanguage: args.file_language,
      fileExcerpt: args.file_excerpt,
      userLocale: args.user_locale,
      criteria: args.criteria,
      reviseThreshold: args.revise_threshold,
      skipRewrite: args.skip_rewrite,
    });
    return ok(result as unknown as Payload);
  }
);

// --- Composition (1.4.0) — the canonical pipeline ---

server.registerTool(
  "compose_prompt",
  {
    title: "Compose the full pipeline",
    description: "Run the canonical ClarifyPrompt pipeline in ONE call: clarify (optional pre-stage) → ground OR optimize (core) → critique (optional post-stage) → optional auto-revise. Use this when you want the four-tool happy path without orchestrating five round-trips. Short-circuits if `pre_clarify` surfaces questions — caller answers and re-calls. When `sources` is non-empty the chain takes the strict ground_prompt branch; otherwise it goes through optimize_prompt. When `auto_revise` is true and critique returns a non-accept verdict with an improved rewrite, `final_prompt` is the rewrite. The `stages` array is a per-call audit log so callers can see exactly what ran.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    outputSchema: COMPOSE_OUT,
    inputSchema: {
    prompt: z.string().describe("The prompt to compose."),
    pre_clarify: z.enum(['auto', 'always', 'never']).optional().default('auto')
      .describe("'auto' = run clarify only if analyzer confidence is low / prompt is short. 'always' = force clarify. 'never' = skip. When clarification questions surface, the chain stops; caller answers and re-calls."),
    max_questions: z.number().int().positive().max(5).optional().default(3),
    sources: z.array(z.object({
      label: z.string(),
      body: z.string(),
      kind: z.string().optional(),
    })).optional().describe("When non-empty, the chain takes the strict ground_prompt branch (caller-provided sources pinned at highest priority)."),
    post_critique: z.boolean().optional().default(false)
      .describe("Run the critique judge against the optimized output. Adds ~3-5s on a local model."),
    revise_threshold: z.number().min(0).max(10).optional().default(7.0),
    critique_criteria: z.array(z.object({
      name: z.string(),
      description: z.string(),
    })).optional().describe("Override the default 5 critique criteria."),
    auto_revise: z.boolean().optional().default(false)
      .describe("When true AND post_critique is true AND verdict !== 'accept' AND there's an improvedPrompt: `final_prompt` becomes the rewritten version instead of the raw optimization."),
    max_iterations: z.number().int().min(1).max(5).optional().default(1)
      .describe("Max revise-loop iterations. With `auto_revise: true` AND `post_critique: true`, the engine can feed each iteration's improvedPrompt back through optimize+critique up to this cap. Stops early at verdict=accept or when there's no improvedPrompt. Default 1 (single-shot, no loop). Hard max 5 to prevent cost runaways."),
    clarify_model: z.string().optional()
      .describe("Override the LLM model for the clarify pre-stage. Default: env LLM_MODEL. Useful for per-stage cost/quality routing — e.g. run clarify on a cheap model while critique runs on a frontier one."),
    optimize_model: z.string().optional()
      .describe("Override the LLM model for the optimize/ground core stage."),
    critique_model: z.string().optional()
      .describe("Override the LLM model for the critique judge AND rewrite."),
    category: CATEGORY_ENUM.optional(),
    platform: z.string().optional(),
    mode: MODE_ENUM.optional(),
    enrich_context: z.boolean().optional().default(false),
    session_id: z.string().optional(),
    file_path: z.string().optional(),
    file_language: z.string().optional(),
    file_excerpt: z.string().optional(),
    cwd: z.string().optional(),
    user_locale: z.string().optional(),
    user_pinned_instructions: z.string().optional(),
    skip_intent_resolution: z.boolean().optional().default(false),
    include_bundle: z.boolean().optional().default(false),
    },
  },
  async (args, extra) => {
    // Cancellation + progress (1.10.0). `extra.signal` fires when the client
    // sends notifications/cancelled for this request — plumbed all the way to
    // the in-flight LLM fetch. Progress is emitted only when the client opted
    // in by including a progressToken in the request _meta.
    const progressToken = extra._meta?.progressToken;
    let progressCount = 0;
    const onProgress = progressToken !== undefined
      ? (u: { message: string }) => {
          progressCount++;
          void extra.sendNotification({
            method: "notifications/progress",
            params: { progressToken, progress: progressCount, message: u.message },
          }).catch(() => { /* progress is best-effort; never fail the call on it */ });
        }
      : undefined;

    const result = await composePrompt({
      prompt: args.prompt,
      preClarify: args.pre_clarify,
      maxQuestions: args.max_questions,
      sources: args.sources,
      postCritique: args.post_critique,
      reviseThreshold: args.revise_threshold,
      critiqueCriteria: args.critique_criteria,
      autoRevise: args.auto_revise,
      maxIterations: args.max_iterations,
      clarifyModel: args.clarify_model,
      optimizeModel: args.optimize_model,
      critiqueModel: args.critique_model,
      category: args.category,
      platform: args.platform,
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
      skipIntentResolution: args.skip_intent_resolution,
      includeBundle: args.include_bundle,
      signal: extra.signal,
      onProgress,
    });
    return ok(result as unknown as Payload);
  }
);

// --- Resources (1.8.0) -------------------------------------------------------
//
// Beyond the static `categories` resource, the engine's natural read surfaces —
// platforms, traces, loaded packs, and remembered facts — are exposed as
// templated resources so MCP hosts can browse them as a tree and link to stable
// URIs. Each template carries:
//   - list:     enumerate the concrete resources that currently exist
//   - complete: autocomplete a URI-template variable (the only place MCP
//               completion applies for this server — we register no prompts)
//   - read:     return one resource's JSON, given the matched variables
//
// Registering templates with `complete` callbacks makes the SDK advertise the
// `resources` (with templates) and `completions` capabilities at initialize.

const CAT_IDS = CATEGORIES.map(c => c.id);

function jsonResource(uri: URL | string, payload: unknown) {
  return {
    contents: [{
      uri: typeof uri === "string" ? uri : uri.href,
      mimeType: "application/json",
      text: JSON.stringify(payload, null, 2),
    }],
  };
}

const v = (x: string | string[] | undefined) => (Array.isArray(x) ? x[0] : x) ?? "";
const byPrefix = (xs: string[], value: string) =>
  (value ? xs.filter(x => x.toLowerCase().startsWith(value.toLowerCase())) : xs).slice(0, 100);

// Static: full category configuration.
server.registerResource(
  "categories",
  "clarifyprompt://categories",
  {
    title: "Category configuration",
    description: "Full category configuration with all platforms and modes",
    mimeType: "application/json",
  },
  async () => jsonResource("clarifyprompt://categories", CATEGORIES)
);

// Template: one platform's full config — clarifyprompt://platforms/{category}/{id}
server.registerResource(
  "platform",
  new ResourceTemplate("clarifyprompt://platforms/{category}/{id}", {
    list: async () => {
      const registry = getPlatformRegistry();
      const resources: { uri: string; name: string; description?: string; mimeType: string }[] = [];
      for (const c of CATEGORIES) {
        const platforms = await registry.getPlatformsForCategory(c.id);
        for (const p of platforms) {
          resources.push({
            uri: `clarifyprompt://platforms/${c.id}/${p.id}`,
            name: `${c.id}/${p.id}`,
            description: p.description,
            mimeType: "application/json",
          });
        }
      }
      return { resources };
    },
    complete: {
      category: (value) => byPrefix(CAT_IDS, value),
      id: async (value, context) => {
        const cat = context?.arguments?.category as Category | undefined;
        const registry = getPlatformRegistry();
        const cats = cat && CAT_IDS.includes(cat) ? [cat] : CATEGORIES.map(c => c.id);
        const ids: string[] = [];
        for (const c of cats) ids.push(...(await registry.getPlatformsForCategory(c)).map(p => p.id));
        return byPrefix([...new Set(ids)], value);
      },
    },
  }),
  { title: "Platform config", description: "One platform's full configuration (label, description, syntax hints, instructions, custom/override status)", mimeType: "application/json" },
  async (uri, variables) => {
    const category = v(variables.category) as Category;
    const id = v(variables.id);
    if (!CAT_IDS.includes(category)) return jsonResource(uri, { error: `unknown category '${category}'` });
    const registry = getPlatformRegistry();
    const platform = (await registry.getPlatformsForCategory(category)).find(p => p.id === id);
    if (!platform) return jsonResource(uri, { error: `platform '${id}' not found in category '${category}'` });
    return jsonResource(uri, platform);
  }
);

// Template: one day's trace index — clarifyprompt://traces/{date}
server.registerResource(
  "traces-by-day",
  new ResourceTemplate("clarifyprompt://traces/{date}", {
    list: async () => {
      const tracer = getTraceWriter();
      if (tracer.getMode() === "off") return { resources: [] };
      const days = await tracer.listDays();
      return {
        resources: days.map(d => ({
          uri: `clarifyprompt://traces/${d}`,
          name: `traces ${d}`,
          description: `Optimization traces for ${d} (UTC)`,
          mimeType: "application/json",
        })),
      };
    },
    complete: {
      date: async (value) => {
        const tracer = getTraceWriter();
        if (tracer.getMode() === "off") return [];
        return byPrefix(await tracer.listDays(), value);
      },
    },
  }),
  { title: "Traces by day", description: "Summary index of optimization traces for one UTC day. Use the get_trace tool for a single full trace.", mimeType: "application/json" },
  async (uri, variables) => {
    const tracer = getTraceWriter();
    if (tracer.getMode() === "off") return jsonResource(uri, { mode: "off", message: "Tracing disabled. Set CLARIFYPROMPT_TRACE=local." });
    const day = v(variables.date);
    const entries = await tracer.readDay(day, 200);
    return jsonResource(uri, {
      day,
      count: entries.length,
      entries: entries.map(e => ({
        id: e.id, ts: e.ts, sessionId: e.sessionId, category: e.category, platform: e.platform,
        mode: e.mode, intent: e.bundleSummary.intent, model: e.model, latencyMs: e.latencyMs,
        error: e.error?.message, promptPreview: e.input.originalPrompt.slice(0, 140),
      })),
    });
  }
);

// Template: one loaded pack's metadata — clarifyprompt://packs/{id}
server.registerResource(
  "pack",
  new ResourceTemplate("clarifyprompt://packs/{id}", {
    list: async () => {
      const store = getMemoryStore();
      if (!store.isHealthy()) return { resources: [] };
      return {
        resources: store.listPacks().map(p => ({
          uri: `clarifyprompt://packs/${p.id}`,
          name: `${p.name}@${p.version}`,
          description: `scope=${p.scope} · ${p.sourceType}`,
          mimeType: "application/json",
        })),
      };
    },
    complete: {
      id: (value) => {
        const store = getMemoryStore();
        if (!store.isHealthy()) return [];
        return byPrefix(store.listPacks().map(p => String(p.id)), value);
      },
    },
  }),
  { title: "Knowledge pack", description: "One loaded knowledge pack's metadata (name, version, scope, source, chunk/load info)", mimeType: "application/json" },
  async (uri, variables) => {
    const store = getMemoryStore();
    if (!store.isHealthy()) return jsonResource(uri, { error: "memory store not healthy" });
    const id = Number(v(variables.id));
    const pack = store.listPacks().find(p => p.id === id);
    if (!pack) return jsonResource(uri, { error: `pack ${id} not found` });
    return jsonResource(uri, {
      id: pack.id, name: pack.name, version: pack.version, scope: pack.scope,
      sourceType: pack.sourceType, sourceRef: pack.sourceRef,
      loadedAt: new Date(pack.loadedAt).toISOString(), metadata: pack.metadata,
    });
  }
);

// Template: live facts under a scope — clarifyprompt://memory/facts/{scope}
server.registerResource(
  "memory-facts",
  new ResourceTemplate("clarifyprompt://memory/facts/{scope}", {
    list: async () => {
      // Scopes aren't cheaply enumerable; surface the always-present 'user'
      // scope plus any scopes that currently own a loaded pack.
      const store = getMemoryStore();
      const scopes = new Set<string>(["user"]);
      if (store.isHealthy()) for (const p of store.listPacks()) scopes.add(p.scope);
      return {
        resources: [...scopes].map(s => ({
          uri: `clarifyprompt://memory/facts/${s}`,
          name: `facts (${s})`,
          description: `Live remembered facts in scope '${s}'`,
          mimeType: "application/json",
        })),
      };
    },
    complete: {
      scope: (value) => {
        const store = getMemoryStore();
        const scopes = new Set<string>(["user", "session"]);
        if (store.isHealthy()) for (const p of store.listPacks()) scopes.add(p.scope);
        return byPrefix([...scopes], value);
      },
    },
  }),
  { title: "Memory facts", description: "Live (non-invalidated) remembered facts under a memory scope, most-recently-observed first", mimeType: "application/json" },
  async (uri, variables) => {
    const store = getMemoryStore();
    if (!store.isHealthy()) return jsonResource(uri, { error: "memory store not healthy" });
    const scope = v(variables.scope);
    const facts = store.listLiveFacts(scope, undefined, 100);
    return jsonResource(uri, {
      scope, count: facts.length,
      facts: facts.map(f => ({
        id: f.id, subject: f.subjectText, predicate: f.predicate, object: f.objectText,
        confidence: f.confidence, source: f.source, observedAt: new Date(f.observedAt).toISOString(),
      })),
    });
  }
);

  return server;
}

// --- Connect (1.11.0: transport factory) ------------------------------------
//
// Default transport is stdio (unchanged behavior). Set
// CLARIFYPROMPT_TRANSPORT=streamable-http to serve over HTTP instead — the
// runway for Agent-to-Agent (A2A) and remote MCP hosts.

await startTransport(createServer, VERSION);
