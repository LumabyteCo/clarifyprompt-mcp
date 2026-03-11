import type { Category, Mode } from '../config/categories.js';
import { CATEGORIES, getCategoryById } from '../config/categories.js';
import { getPlatformRegistry } from '../config/registry.js';
import type { OptimizationResult, OptimizationContext } from './types.js';
import { getStrategy } from './strategies/index.js';
import { getSearchClient } from '../search/client.js';
import { getLLMClient } from '../llm/client.js';

const VALID_CATEGORIES: Category[] = CATEGORIES.map(c => c.id);

export interface OptimizeRequest {
  prompt: string;
  category?: Category;
  platform?: string;
  mode: Mode;
  enrichContext?: boolean;
}

interface DetectionResult {
  category: Category;
  confidence: 'high' | 'medium' | 'low';
}

export class OptimizationEngine {
  private searchClient = getSearchClient();

  async detectCategory(prompt: string): Promise<DetectionResult> {
    const llm = getLLMClient();

    const systemPrompt = `You are a prompt classifier. Given a user prompt, classify it into exactly one category.

Categories:
- image: Image generation, visual art, photos, logos, illustrations, design
- video: Video generation, animation, motion, clips, cinematic scenes
- voice: Voice synthesis, text-to-speech, narration, voiceover
- music: Music generation, songs, audio tracks, sound design, jingles
- code: Programming, development, debugging, technical implementation
- document: Writing, articles, emails, reports, essays, copywriting
- chat: General conversation, questions, analysis, advice, explanations

Rules:
- Reply with ONLY the category ID (one word, lowercase)
- If uncertain, choose the closest match
- Default to "chat" only when no other category fits`;

    const result = await llm.simpleGenerate(systemPrompt, prompt, {
      temperature: 0.1,
      maxTokens: 10,
    });

    const detected = result.content.trim().toLowerCase().replace(/[^a-z]/g, '') as Category;

    if (VALID_CATEGORIES.includes(detected)) {
      return { category: detected, confidence: 'high' };
    }

    // Fuzzy match: check if the response contains a valid category
    for (const cat of VALID_CATEGORIES) {
      if (result.content.toLowerCase().includes(cat)) {
        return { category: cat, confidence: 'medium' };
      }
    }

    return { category: 'chat', confidence: 'low' };
  }

  async optimize(request: OptimizeRequest): Promise<OptimizationResult> {
    const startTime = Date.now();
    const id = this.generateId();

    // Auto-detect category if not provided
    let detection: DetectionResult | undefined;
    let category: Category;

    if (request.category) {
      category = request.category;
    } else {
      detection = await this.detectCategory(request.prompt);
      category = detection.category;
    }

    // Auto-select default platform if not provided
    const platform = request.platform || getCategoryById(category)?.defaultPlatform;

    const strategy = getStrategy(category);

    const registry = getPlatformRegistry();
    const platformConfig = platform
      ? await registry.getPlatformById(category, platform)
      : undefined;

    let contextData: { enriched: boolean; context: string; sources: string[] } = {
      enriched: false,
      context: '',
      sources: [],
    };

    if (request.enrichContext) {
      try {
        contextData = await this.searchClient.enrichContext(request.prompt);
      } catch (error) {
        console.error('[Engine] Context enrichment failed:', error);
      }
    }

    const context: OptimizationContext = {
      category,
      platform,
      mode: request.mode,
      enrichWithContext: contextData.enriched,
      contextSources: contextData.enriched ? [contextData.context] : undefined,
    };

    const optimizedPrompt = await strategy.optimize(
      request.prompt,
      context,
      platformConfig?.syntaxHints,
      platformConfig?.resolvedInstructions
    );

    const processingTimeMs = Date.now() - startTime;

    return {
      id,
      originalPrompt: request.prompt,
      optimizedPrompt,
      category,
      platform,
      mode: request.mode,
      context: contextData.enriched
        ? { enriched: true, sources: contextData.sources }
        : undefined,
      detection: detection
        ? {
            autoDetected: true,
            detectedCategory: detection.category,
            detectedPlatform: platform,
            confidence: detection.confidence,
          }
        : undefined,
      metadata: {
        model: getLLMClient().getModelName(),
        processingTimeMs,
        tokensUsed: 0,
        strategy: strategy.name,
      },
    };
  }

  private generateId(): string {
    return `opt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

let engineInstance: OptimizationEngine | null = null;

export function getOptimizationEngine(): OptimizationEngine {
  if (!engineInstance) {
    engineInstance = new OptimizationEngine();
  }
  return engineInstance;
}
