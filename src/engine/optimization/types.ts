import type { Category, Mode } from '../config/categories.js';
import type { ContextBundle, Intent } from '../context/types.js';

export interface AcceptedExampleRef {
  id: string;
  originalPrompt: string;
  optimizedPrompt: string;
  category: Category;
  platform?: string;
  intent?: Intent;
  ts: number;
}

export interface UserProvidedSource {
  /** Human-facing label rendered in the grounding context heading. */
  label: string;
  /** Source content. Used verbatim. */
  body: string;
  /** Optional categorization for analytics. Free-form (e.g. 'spec', 'rfc', 'transcript'). */
  kind?: string;
}

export interface OptimizationContext {
  category: Category;
  platform?: string;
  mode: Mode;
  enrichWithContext?: boolean;
  contextSources?: string[];
  webSearchSources?: string[];
  bundle?: ContextBundle;
  acceptedExamples?: AcceptedExampleRef[];
  memoryMatches?: import('../memory/types.js').MemoryMatch[];
  /**
   * Caller-supplied grounding sources (from ground_prompt). Each becomes a
   * pinned, highest-priority section in the curated grounding context.
   */
  userProvidedSources?: UserProvidedSource[];
  /**
   * Per-call LLM model override (from request.model). Strategies pass this
   * to simpleGenerate so a single compose call can route optimize to a
   * different model than the env default.
   */
  model?: string;
}

export interface OptimizationResult {
  id: string;
  sessionId: string;
  originalPrompt: string;
  optimizedPrompt: string;
  category: Category;
  platform?: string;
  mode: Mode;
  modeSource?: 'user' | 'analyzer' | 'default';
  context?: {
    enriched: boolean;
    sources: string[];
  };
  /**
   * Back-compat: retained so pre-1.2 callers still get `detection`.
   * The canonical field is `analysis` (Pass A).
   * @deprecated Read `analysis` instead; `detection` will be removed in 2.x.
   */
  detection?: {
    autoDetected: boolean;
    detectedCategory: Category;
    detectedPlatform?: string;
    confidence: 'high' | 'medium' | 'low';
  };
  analysis?: {
    category: Category;
    intent: Intent;
    recommendedMode: Mode;
    confidence: 'high' | 'medium' | 'low';
    source: 'llm' | 'fallback';
  };
  /**
   * Back-compat alias populated from `analysis.intent` for pre-1.2.0-final callers.
   * @deprecated Read `analysis.intent` instead.
   */
  intent?: {
    detected: Intent;
    confidence: 'high' | 'medium' | 'low';
  };
  bundle?: ContextBundle;
  grounding?: {
    sources: string[];
    acceptedExamplesUsed: number;
  };
  shape?: {
    systemPromptBudget: 'compact' | 'standard' | 'rich';
    maxTokens: number;
    temperature: number;
  };
  metadata: {
    model: string;
    processingTimeMs: number;
    tokensUsed: number;
    strategy: string;
  };
}

export interface OptimizationStrategy {
  readonly name: string;
  readonly category: Category;

  optimize(
    prompt: string,
    context: OptimizationContext,
    platformHints?: string[],
    platformInstructions?: string,
  ): Promise<string>;
  buildSystemPrompt(context: OptimizationContext, platformInstructions?: string): string;
}

export interface EnrichedContext {
  query: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
  }>;
  timestamp: number;
}
