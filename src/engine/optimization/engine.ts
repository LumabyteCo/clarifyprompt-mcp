import type { Category, Mode } from '../config/categories.js';
import { CATEGORIES, getCategoryById } from '../config/categories.js';
import { getPlatformRegistry } from '../config/registry.js';
import type { OptimizationResult, OptimizationContext, AcceptedExampleRef, UserProvidedSource } from './types.js';
import { getStrategy } from './strategies/index.js';
import { BaseStrategy } from './strategies/base.js';
import { getSearchClient } from '../search/client.js';
import { getLLMClient } from '../llm/client.js';
import { buildContextBundle } from '../context/bundle.js';
import { getSessionStore, generateSessionId } from '../context/sessionSignals.js';
import { getTraceWriter } from '../trace/writer.js';
import { summarizeBundleForTrace } from '../trace/types.js';
import { reconcileMode, getPromptShape, buildGroundingContext } from './groundingContext.js';
import { getMemoryStore } from '../memory/store.js';
import type { MemoryMatch } from '../memory/types.js';

const VALID_CATEGORIES: Category[] = CATEGORIES.map(c => c.id);

export interface OptimizeRequest {
  prompt: string;
  category?: Category;
  platform?: string;
  mode?: Mode;
  // Distinguishes "user didn't pass mode" (→ analyzer-recommended wins) from
  // "user explicitly passed mode" (→ user wins).
  modeExplicit?: boolean;
  enrichContext?: boolean;
  sessionId?: string;
  filePath?: string;
  fileLanguage?: string;
  fileExcerpt?: string;
  cwd?: string;
  userLocale?: string;
  userPinnedInstructions?: string;
  userPreferredMode?: Mode;
  includeBundle?: boolean;
  skipIntentResolution?: boolean;
  /**
   * Caller-provided grounding sources (used by the ground_prompt MCP tool).
   * Each becomes a pinned, top-priority section in the curated grounding.
   */
  userProvidedSources?: UserProvidedSource[];
  /**
   * Override the LLM model for THIS optimize call. When omitted, uses the
   * env-default LLM_MODEL. Per-stage routing in compose_prompt sets this.
   * Note: this overrides only the rewrite-step model; the analyzer and
   * memory-retrieval embedder are unaffected.
   */
  model?: string;
  /**
   * Per-call cancellation signal (1.10.0). Propagated to the optimize LLM call
   * (and the analyzer) so a client cancel aborts work in flight.
   */
  signal?: AbortSignal;
}

export class OptimizationEngine {
  private searchClient = getSearchClient();

  async optimize(request: OptimizeRequest): Promise<OptimizationResult> {
    const startTime = Date.now();
    const id = this.generateId();
    const sessionId = request.sessionId || generateSessionId();
    // Per-call model override (M1: per-stage routing in compose_prompt) wins
    // over the env-default. The trace, persisted optimization record, and
    // result metadata all reflect whichever model actually ran the rewrite.
    const modelName = request.model ?? getLLMClient().getModelName();

    // Build the bundle FIRST. The analyzer inside it decides category + intent
    // + recommended mode together, so downstream flow is coherent.
    const bundle = await buildContextBundle({
      prompt: request.prompt,
      category: request.category,
      platform: request.platform,
      sessionId,
      filePath: request.filePath,
      fileLanguage: request.fileLanguage,
      fileExcerpt: request.fileExcerpt,
      cwd: request.cwd,
      userLocale: request.userLocale,
      userPinnedInstructions: request.userPinnedInstructions,
      userPreferredMode: request.userPreferredMode,
      modelName,
      skipIntentResolution: request.skipIntentResolution,
    });

    // Category resolution: user-hint wins unless the analyzer confidently disagrees.
    const analysis = bundle.analysis;
    const category = this.resolveCategory(request.category, analysis?.category);
    const autoDetected = !request.category;

    // Mode resolution: user-explicit wins; analyzer recommendation otherwise.
    const modeChoice = reconcileMode(
      request.mode,
      analysis?.recommendedMode,
      !!request.modeExplicit,
    );
    const mode = modeChoice.mode;

    // Auto-select default platform if not provided
    const platform = request.platform || getCategoryById(category)?.defaultPlatform;

    const strategy = getStrategy(category);
    const registry = getPlatformRegistry();
    const platformConfig = platform
      ? await registry.getPlatformById(category, platform)
      : undefined;

    // Web search enrichment (still optional; now merges through the same
    // Grounding Context pipeline as bundle signals).
    let enriched = { enriched: false, context: '', sources: [] as string[] };
    if (request.enrichContext) {
      try {
        enriched = await this.searchClient.enrichContext(request.prompt);
      } catch (err) {
        console.error('[Engine] Context enrichment failed:', err);
      }
    }

    // --- Pass 3: semantic retrieval from persistent memory ---
    // Pull relevant facts + past optimizations + pack chunks via vector
    // similarity. The curator will score these against the token budget.
    const memoryMatches = await this.retrieveFromMemory({
      prompt: request.prompt,
      scope: `project:${bundle.project.packageName || 'default'}`,
    });

    // Session in-memory ring buffer (still used for same-session fast path).
    const acceptedExamplesFromStore = getSessionStore().findAcceptedExamples(sessionId, {
      prompt: request.prompt,
      category,
      intent: analysis?.intent,
      limit: 2,
    });
    const acceptedExamples: AcceptedExampleRef[] = acceptedExamplesFromStore.map(opt => ({
      id: opt.id,
      originalPrompt: opt.originalPrompt,
      optimizedPrompt: opt.optimizedPrompt,
      category: opt.category,
      platform: opt.platform,
      intent: opt.intent,
      ts: opt.ts,
    }));

    const context: OptimizationContext = {
      category,
      platform,
      mode,
      enrichWithContext: enriched.enriched,
      contextSources: enriched.enriched ? [enriched.context] : undefined,
      webSearchSources: enriched.enriched ? enriched.sources : undefined,
      bundle,
      acceptedExamples,
      memoryMatches,
      userProvidedSources: request.userProvidedSources,
      model: request.model,
      signal: request.signal,
    };

    // Everything upstream has a graceful fallback; the LLM call itself can
    // still blow up for network / auth / rate-limit reasons. Wrap so callers
    // at minimum receive the assembled bundle + error, never a raw throw.
    let optimizedPrompt = '';
    let strategyError: unknown;
    try {
      optimizedPrompt = await strategy.optimize(
        request.prompt,
        context,
        platformConfig?.syntaxHints,
        platformConfig?.resolvedInstructions,
      );
    } catch (err) {
      strategyError = err;
      optimizedPrompt = request.prompt;
    }

    const processingTimeMs = Date.now() - startTime;
    const shape = getPromptShape(bundle, analysis?.intent);

    // Record into session ring buffer (fast path for same-session retrieval).
    getSessionStore().recordOptimization(sessionId, {
      id,
      ts: Date.now(),
      originalPrompt: request.prompt,
      optimizedPrompt,
      category,
      platform,
      intent: analysis?.intent,
    });

    // Persist to long-term memory for cross-session retrieval. Guard so
    // memory failures (missing sqlite-vec, embed endpoint down) never crash
    // the optimize call.
    this.persistToMemoryAsync({
      id, sessionId, ts: Date.now(),
      originalPrompt: request.prompt, optimizedPrompt,
      category, platform, mode,
      intent: analysis?.intent, model: modelName,
    });

    // Trace emit
    const tracer = getTraceWriter();
    if (tracer.getMode() !== 'off') {
      const systemPrompt = strategy instanceof BaseStrategy
        ? strategy.renderLastSystemPrompt(context, platformConfig?.resolvedInstructions)
        : '';
      const grounding = buildGroundingContext({
        bundle, webSearchContext: enriched.enriched ? enriched.context : undefined,
        webSearchSources: enriched.sources, platformInstructions: platformConfig?.resolvedInstructions,
        platformHints: platformConfig?.syntaxHints, acceptedExamples,
        userProvidedSources: request.userProvidedSources,
      });
      // Pull curation log if the strategy recorded one (Pass 6).
      const curation = strategy instanceof BaseStrategy && strategy.lastCuration
        ? {
            budget: strategy.lastCuration.budget,
            used: strategy.lastCuration.used,
            selected: strategy.lastCuration.selected.map(s => ({
              source: s.source, label: s.label, tokens: s.tokens, utility: s.utility, pinned: s.pinned,
            })),
            rejected: strategy.lastCuration.rejected.map(r => ({
              source: r.source, tokens: r.tokens, utility: r.utility, reason: r.reason,
            })),
          }
        : undefined;

      await tracer.append({
        schemaVersion: 1,
        id,
        ts: new Date().toISOString(),
        sessionId,
        category,
        platform,
        mode,
        input: {
          originalPrompt: request.prompt,
          autoDetectedCategory: autoDetected,
        },
        bundleSummary: summarizeBundleForTrace(bundle),
        systemPrompt,
        output: { optimizedPrompt },
        model: modelName,
        strategy: strategy.name,
        latencyMs: processingTimeMs,
        groundingSources: curation?.selected.map(s => s.source) ?? grounding.sources,
        shape: { budget: shape.systemPromptBudget, maxTokens: shape.maxTokens, temperature: shape.temperature },
        curation,
        error: strategyError ? { message: (strategyError as Error).message } : undefined,
      });
    }

    const result: OptimizationResult = {
      id,
      sessionId,
      originalPrompt: request.prompt,
      optimizedPrompt,
      category,
      platform,
      mode,
      modeSource: modeChoice.source,
      context: enriched.enriched
        ? { enriched: true, sources: enriched.sources }
        : undefined,
      analysis: analysis && {
        category: analysis.category,
        intent: analysis.intent,
        recommendedMode: analysis.recommendedMode,
        confidence: analysis.confidence,
        source: analysis.source,
      },
      detection: autoDetected && analysis ? {
        autoDetected: true,
        detectedCategory: analysis.category,
        detectedPlatform: platform,
        confidence: analysis.confidence,
      } : undefined,
      intent: analysis ? { detected: analysis.intent, confidence: analysis.confidence } : undefined,
      grounding: {
        // Prefer the curator's actual selected sources; fall back to the
        // legacy buildGroundingContext only when the curator didn't run.
        sources: strategy instanceof BaseStrategy && strategy.lastCuration
          ? strategy.lastCuration.sourceIds
          : buildGroundingContext({
              bundle, webSearchContext: enriched.enriched ? enriched.context : undefined,
              webSearchSources: enriched.sources, platformInstructions: platformConfig?.resolvedInstructions,
              platformHints: platformConfig?.syntaxHints, acceptedExamples,
              userProvidedSources: request.userProvidedSources,
            }).sources,
        acceptedExamplesUsed: acceptedExamples.length,
      },
      shape: {
        systemPromptBudget: shape.systemPromptBudget,
        maxTokens: shape.maxTokens,
        temperature: shape.temperature,
      },
      metadata: {
        model: modelName,
        processingTimeMs,
        tokensUsed: 0,
        strategy: strategy.name,
      },
    };

    if (request.includeBundle) result.bundle = bundle;

    if (strategyError) {
      // Surface via a non-throwing channel so the caller can still inspect
      // the assembled bundle and decide whether to retry.
      (result as OptimizationResult & { error?: { message: string } }).error =
        { message: (strategyError as Error).message };
    }

    return result;
  }

  /** User hint wins unless analyzer disagreed confidently. */
  private resolveCategory(hint: Category | undefined, analyzed: Category | undefined): Category {
    if (hint && VALID_CATEGORIES.includes(hint)) return hint;
    if (analyzed && VALID_CATEGORIES.includes(analyzed)) return analyzed;
    return 'chat';
  }

  private generateId(): string {
    return `opt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Dual semantic retrieval: vector search over facts + past optimizations
   * + pack chunks. Swallows errors so a memory outage never breaks optimize.
   */
  private async retrieveFromMemory(args: { prompt: string; scope: string }): Promise<MemoryMatch[]> {
    try {
      const store = getMemoryStore();
      if (!store.isHealthy() || !store.hasVectors()) return [];

      const [facts, packChunks] = await Promise.all([
        store.searchByVector('fact', args.prompt, 3),
        store.searchByVector('pack_chunk', args.prompt, 3),
      ]);
      // Merge + dedupe by sourceId+kind, ordered by similarity.
      const all = [...facts, ...packChunks].sort((a, b) => b.similarity - a.similarity);
      const seen = new Set<string>();
      const out: MemoryMatch[] = [];
      for (const m of all) {
        const key = `${m.kind}:${m.sourceId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(m);
        if (out.length >= 5) break;
      }
      return out;
    } catch (err) {
      console.error('[Engine] memory retrieval failed (continuing without):', (err as Error).message);
      return [];
    }
  }

  /**
   * Fire-and-forget persistence into the long-term memory layer. Swallows
   * errors; every optimization is best-effort.
   */
  private persistToMemoryAsync(opt: {
    id: string; sessionId: string; ts: number;
    originalPrompt: string; optimizedPrompt: string;
    category: Category; platform?: string; mode: Mode;
    intent?: string; model: string;
  }): void {
    (async () => {
      try {
        const store = getMemoryStore();
        if (!store.isHealthy()) return;
        store.recordOptimization({
          id: opt.id, sessionId: opt.sessionId, ts: opt.ts,
          originalPrompt: opt.originalPrompt, optimizedPrompt: opt.optimizedPrompt,
          category: opt.category, platform: opt.platform, mode: opt.mode,
          intent: opt.intent, model: opt.model,
        });
        // We embed the original prompt so future "find similar past prompts"
        // queries hit well. The optimized output embedding is less useful as
        // a retrieval key.
        if (store.hasVectors()) {
          await store.embedAndStore('optimization', opt.id, opt.originalPrompt);
        }
      } catch (err) {
        console.error('[Engine] memory persist failed:', (err as Error).message);
      }
    })();
  }
}

let engineInstance: OptimizationEngine | null = null;

export function getOptimizationEngine(): OptimizationEngine {
  if (!engineInstance) engineInstance = new OptimizationEngine();
  return engineInstance;
}
