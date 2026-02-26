import type { Category, Mode } from '../config/categories.js';

export interface OptimizationContext {
  category: Category;
  platform?: string;
  mode: Mode;
  enrichWithContext?: boolean;
  contextSources?: string[];
}

export interface OptimizationResult {
  id: string;
  originalPrompt: string;
  optimizedPrompt: string;
  category: Category;
  platform?: string;
  mode: Mode;
  context?: {
    enriched: boolean;
    sources: string[];
  };
  detection?: {
    autoDetected: boolean;
    detectedCategory: Category;
    detectedPlatform?: string;
    confidence: 'high' | 'medium' | 'low';
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

  optimize(prompt: string, context: OptimizationContext, platformHints?: string[]): Promise<string>;
  buildSystemPrompt(context: OptimizationContext): string;
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
