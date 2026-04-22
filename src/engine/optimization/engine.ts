import type { Category, Mode } from '../config/categories.js';
import { CATEGORIES, getCategoryById } from '../config/categories.js';
import { getPlatformRegistry } from '../config/registry.js';
import type { OptimizationResult, OptimizationContext, AcceptedExampleRef } from './types.js';
import { getStrategy } from './strategies/index.js';
import { BaseStrategy } from './strategies/base.js';
import { getSearchClient } from '../search/client.js';
import { getLLMClient } from '../llm/client.js';
import { buildContextBundle } from '../context/bundle.js';
import { getSessionStore, generateSessionId } from '../context/sessionSignals.js';
import { getTraceWriter } from '../trace/writer.js';
import { summarizeBundleForTrace } from '../trace/types.js';
import { reconcileMode, getPromptShape, buildGroundingContext } from './groundingContext.js';

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
}

export class OptimizationEngine {
  private searchClient = getSearchClient();

  async optimize(request: OptimizeRequest): Promise<OptimizationResult> {
    const startTime = Date.now();
    const id = this.generateId();
    const sessionId = request.sessionId || generateSessionId();
    const modelName = getLLMClient().getModelName();

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

    // Pass D retrieval: similar accepted outputs from this session, used as
    // few-shot examples. Until Day 2 adds persistent memory, this is
    // in-memory-only — but the shape is stable.
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

    // Record into session ring buffer (always — helps debugging even on error).
    getSessionStore().recordOptimization(sessionId, {
      id,
      ts: Date.now(),
      originalPrompt: request.prompt,
      optimizedPrompt,
      category,
      platform,
      intent: analysis?.intent,
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
      });
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
        groundingSources: grounding.sources,
        shape: { budget: shape.systemPromptBudget, maxTokens: shape.maxTokens, temperature: shape.temperature },
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
        sources: buildGroundingContext({
          bundle, webSearchContext: enriched.enriched ? enriched.context : undefined,
          webSearchSources: enriched.sources, platformInstructions: platformConfig?.resolvedInstructions,
          platformHints: platformConfig?.syntaxHints, acceptedExamples,
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
}

let engineInstance: OptimizationEngine | null = null;

export function getOptimizationEngine(): OptimizationEngine {
  if (!engineInstance) engineInstance = new OptimizationEngine();
  return engineInstance;
}
