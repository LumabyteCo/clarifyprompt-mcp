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
import { getMemoryStore } from "./engine/memory/store.js";
import { reflectOnOutcome } from "./engine/memory/reflection.js";
import { loadKnowledgePack } from "./engine/memory/packs.js";

const server = new McpServer({
  name: "clarifyprompt",
  version: "1.3.0",
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
  "Tell ClarifyPrompt whether an optimization's output was accepted, edited, or rejected. Feeds two loops: (1) the session ring buffer so accepted prior outputs are injected as few-shot examples into future similar prompts, and (2) the persistent memory layer via reflection — on accept/edit, ClarifyPrompt extracts atomic facts from the interaction and stores them; on reject, recent reflection facts from this session are invalidated. Reflection uses the same LLM you've configured; expect a 1–3s latency on local models.",
  {
    optimization_id: z.string().describe("The `id` returned from optimize_prompt"),
    session_id: z.string().describe("The `sessionId` returned from optimize_prompt. Required so the outcome lands in the right session bucket."),
    verdict: z.enum(['accepted', 'edited', 'rejected']).describe("accepted = user used the output as-is; edited = user kept it with edits; rejected = user threw it away"),
    diff: z.string().optional().describe("Optional: the user's edited version or a diff. Helps reflection extract better facts."),
    skip_reflection: z.boolean().optional().default(false).describe("Skip the LLM-based fact extraction pass (faster, no facts learned)"),
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

    return { content: [{ type: "text" as const, text: JSON.stringify({
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
    }, null, 2) }] };
  }
);

server.tool(
  "memory_search",
  "Semantic search over the persistent memory store. Returns facts, pack chunks, and past optimizations ranked by vector similarity to the query. Useful for inspecting what ClarifyPrompt would retrieve for a given prompt, and for debugging curator decisions.",
  {
    query: z.string().describe("The search query — usually the user's intent or a paraphrase of a future prompt."),
    kinds: z.array(z.enum(['fact', 'outcome', 'pack_chunk', 'optimization'])).optional().default(['fact', 'pack_chunk'])
      .describe("Which memory kinds to search. Default: facts + pack chunks."),
    limit: z.number().int().positive().max(25).optional().default(5),
  },
  async ({ query, kinds, limit }) => {
    const store = getMemoryStore();
    if (!store.isHealthy()) {
      return { content: [{ type: "text" as const, text: JSON.stringify({
        error: 'memory store not healthy (sqlite-vec may have failed to load)',
      }) }], isError: true };
    }
    if (!store.hasVectors()) {
      return { content: [{ type: "text" as const, text: JSON.stringify({
        error: 'vector search unavailable (sqlite-vec not loaded)',
      }) }], isError: true };
    }
    const results = [];
    for (const k of (kinds ?? ['fact', 'pack_chunk'])) {
      const hits = await store.searchByVector(k, query, limit ?? 5);
      results.push(...hits);
    }
    results.sort((a, b) => b.similarity - a.similarity);
    return { content: [{ type: "text" as const, text: JSON.stringify({
      query, kinds: kinds ?? ['fact', 'pack_chunk'],
      count: results.length,
      results: results.slice(0, limit ?? 5),
    }, null, 2) }] };
  }
);

server.tool(
  "explain_last_curation",
  "Render a human-readable explanation of the Context Curator's decisions for the most recent (or a specified) optimization. Shows every candidate that was considered, whether it was selected or rejected, why, and how many tokens it used against the budget. Use this when an output felt off and you want to understand which grounding sources the engine chose.",
  {
    optimization_id: z.string().optional().describe("Optional trace ID. If omitted, explains the most recent trace."),
    lookback_days: z.number().int().positive().max(60).optional().default(1),
  },
  async ({ optimization_id, lookback_days }) => {
    const tracer = getTraceWriter();
    if (tracer.getMode() === 'off') {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: 'tracing disabled; cannot explain curation' }) }], isError: true };
    }
    let entry;
    if (optimization_id) {
      entry = await tracer.findById(optimization_id, lookback_days ?? 1);
      if (!entry) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `trace ${optimization_id} not found in last ${lookback_days} days` }) }], isError: true };
      }
    } else {
      const days = await tracer.listDays();
      if (!days.length) return { content: [{ type: "text" as const, text: JSON.stringify({ error: 'no traces yet' }) }], isError: true };
      const recent = await tracer.readDay(days[0], 1);
      entry = recent[recent.length - 1];
      if (!entry) return { content: [{ type: "text" as const, text: JSON.stringify({ error: 'no traces yet' }) }], isError: true };
    }
    const c = entry.curation;
    if (!c) {
      return { content: [{ type: "text" as const, text: JSON.stringify({
        optimizationId: entry.id,
        message: 'This trace pre-dates the Context Curator (1.3.0+) or ran through a fallback path. No curation log available.',
      }, null, 2) }] };
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
    return { content: [{ type: "text" as const, text: JSON.stringify({
      optimizationId: entry.id,
      explanation: lines.join('\n'),
      raw: c,
    }, null, 2) }] };
  }
);

// --- Knowledge Packs (1.3.0) ---

server.tool(
  "load_knowledge_pack",
  "Load a knowledge pack — a markdown document with optional YAML frontmatter — into the persistent memory store. The pack is chunked by heading, each chunk embedded, and made available for semantic retrieval during subsequent optimize_prompt calls. Packs can come from a local file path, an HTTPS URL, or be passed inline as raw markdown. Community pack registry: https://github.com/LumabyteCo/clarifyprompt-packs",
  {
    source: z.string().describe("Local file path, HTTPS URL, or inline markdown body (auto-detected)."),
    source_type: z.enum(['auto', 'local', 'url', 'inline', 'registry']).optional().default('auto')
      .describe("Override source-type detection. `registry` marks a pack as community-sourced."),
    scope: z.string().optional().describe("Scope to load under (e.g. 'user', 'project:myapp'). Defaults to pack frontmatter or 'user'."),
    name: z.string().optional().describe("Override the pack name (else pulled from frontmatter)."),
    version: z.string().optional().describe("Override the pack version (else pulled from frontmatter or '0.0.0')."),
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
      return { content: [{ type: "text" as const, text: JSON.stringify({
        success: true,
        pack: result.pack,
        chunks: result.chunks,
        embedded: result.embedded,
        skipped: result.skipped,
        message: `Loaded pack '${result.pack.name}@${result.pack.version}' with ${result.chunks} chunks (${result.embedded} embedded, ${result.skipped} not embedded). Chunks will surface in future optimize_prompt calls via semantic retrieval.`,
      }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: JSON.stringify({
        error: `Failed to load pack: ${(err as Error).message}`,
      }) }], isError: true };
    }
  }
);

server.tool(
  "list_packs",
  "List knowledge packs currently loaded in the persistent memory store.",
  {
    scope: z.string().optional().describe("Filter by scope (e.g. 'user', 'project:myapp'). Omit to list all."),
  },
  async ({ scope }) => {
    const store = getMemoryStore();
    if (!store.isHealthy()) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: 'memory store not healthy' }) }], isError: true };
    }
    const packs = store.listPacks(scope);
    return { content: [{ type: "text" as const, text: JSON.stringify({
      scope: scope ?? null,
      count: packs.length,
      packs: packs.map(p => ({
        id: p.id, name: p.name, version: p.version, scope: p.scope,
        sourceType: p.sourceType, sourceRef: p.sourceRef,
        loadedAt: new Date(p.loadedAt).toISOString(),
        metadata: p.metadata,
      })),
    }, null, 2) }] };
  }
);

server.tool(
  "unload_pack",
  "Remove a loaded knowledge pack (and all its chunks + embeddings) from the memory store.",
  {
    id: z.number().int().describe("Pack id (as returned by list_packs)."),
  },
  async ({ id }) => {
    const store = getMemoryStore();
    if (!store.isHealthy()) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: 'memory store not healthy' }) }], isError: true };
    }
    store.removePack(id);
    return { content: [{ type: "text" as const, text: JSON.stringify({
      success: true,
      message: `Pack ${id} removed (cascade-deleted all its chunks + embeddings).`,
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
