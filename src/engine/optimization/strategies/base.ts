import type { Category, Mode } from '../../config/categories.js';
import type { OptimizationContext, OptimizationStrategy } from '../types.js';
import type { Intent } from '../../context/types.js';
import { getLLMClient } from '../../llm/client.js';
import {
  buildGroundingContext,
  getPromptShape,
  type AcceptedExample,
  type PromptShape,
} from '../groundingContext.js';
import {
  buildCandidates,
  computeBudget,
  curate,
  approxTokens,
  type CurationResult,
} from '../curator.js';

export abstract class BaseStrategy implements OptimizationStrategy {
  abstract readonly name: string;
  abstract readonly category: Category;

  protected llmClient = getLLMClient();

  abstract buildSystemPrompt(context: OptimizationContext, platformInstructions?: string): string;

  protected getModeInstructions(mode: Mode): string {
    const modeInstructions: Record<Mode, string> = {
      concise: `
Output Requirements:
- Be extremely brief and direct
- Use short sentences and minimal words
- Focus only on the essential action/request
- Remove all unnecessary context or elaboration
- Target: 1-3 sentences maximum`,

      detailed: `
Output Requirements:
- Provide comprehensive context and background
- Include specific details, examples, and edge cases
- Explain the desired outcome clearly
- Add relevant constraints or preferences
- Target: Well-structured paragraph with full context`,

      structured: `
Output Requirements:
- Organize the prompt with clear sections
- Use numbered lists or bullet points where appropriate
- Include distinct: Context, Task, Requirements, and Expected Output sections
- Format for easy parsing and understanding
- Target: Structured format with clear headers`,

      'step-by-step': `
Output Requirements:
- Break down the request into sequential steps
- Number each step clearly
- Ensure each step is actionable and specific
- Include any dependencies between steps
- Target: Numbered list of clear, sequential instructions`,

      'bullet-points': `
Output Requirements:
- Format as a scannable bulleted list
- Each point should be self-contained
- Use clear, action-oriented language
- Group related points together
- Target: Easy-to-scan bullet point format`,

      technical: `
Output Requirements:
- Use precise, technical terminology
- Include specifications and constraints
- Add edge cases and error handling considerations
- Reference relevant standards or best practices
- Target: Expert-level depth with technical precision`,

      simple: `
Output Requirements:
- Use plain, everyday language
- Avoid jargon and complex terms
- Explain concepts as if to a beginner
- Keep sentences short and clear
- Target: Easy-to-understand, accessible language`,
    };

    return modeInstructions[mode];
  }

  /**
   * Pass A: intent-specific overlay folded into the system prompt so strategies
   * actually branch on WHAT the user is trying to do, not just WHICH platform.
   */
  protected getIntentOverlay(intent: Intent | undefined): string {
    if (!intent || intent === 'unknown') return '';
    const overlays: Record<Intent, string> = {
      'production-code': `
Intent: production-code — the result will ship.
- Be precise about language/version, APIs, error handling, edge cases, and tests.
- Prefer named types, explicit interfaces, and no magic constants.
- Call out obvious failure modes; do not paper over them.`,
      'quick-draft': `
Intent: quick-draft — speed beats polish.
- Skip background, constraints, and examples unless the user asked for them.
- Assume reasonable defaults; do not pad.`,
      'stakeholder-comm': `
Intent: stakeholder-comm — audience is a human reader in a business context.
- Name the audience, the ask, the deadline, and the desired tone.
- Avoid insider jargon unless the audience already shares it.`,
      'data-extract': `
Intent: data-extract — output will be machine-parsed.
- Demand a strict output schema (JSON keys, table columns, or a regex shape).
- Forbid prose wrappers, extra commentary, or markdown fences around the payload.`,
      'exploration': `
Intent: exploration — user is thinking out loud.
- Expand the problem space; list angles before converging.
- Include trade-offs and "what you'd need to know to decide".`,
      'brand-voice': `
Intent: brand-voice — a tone/voice must be respected exactly.
- Lead the prompt with the tone, voice, and audience constraints.
- Put quality bars (word count, reading level, banned terms) near the top.`,
      'creative-media': `
Intent: creative-media — a platform-specific creative output (image/video/voice/music).
- Use platform-native syntax aggressively and correctly.
- Lean into sensory/visual/aural detail; avoid meta-description of the task.`,
      'technical-spec': `
Intent: technical-spec — output is a durable engineering document.
- Demand sections: Goals, Non-goals, Constraints, Design, Trade-offs, Rollout.
- No ambiguous "we could consider…"; every statement should be a decision or an open question.`,
      'analysis': `
Intent: analysis — comparing, evaluating, or summarizing a corpus.
- State the evaluation criteria up front.
- Require evidence citations from the source material, not vibes.`,
      'unknown': '',
    };
    return overlays[intent];
  }

  /**
   * Pass B: shape the system prompt to the downstream LLM's capabilities.
   * Compact budgets drop the intent overlay and the mode's long description
   * because small models choke on multi-KB system prompts.
   */
  protected applyShape(systemPrompt: string, shape: PromptShape): string {
    if (shape.systemPromptBudget === 'compact') {
      // Keep only the first two sections (base + category principles);
      // drop platform guidance and mode rules. The actual task gets across.
      const parts = systemPrompt.split('\n\n');
      return parts.slice(0, 3).join('\n\n');
    }
    return systemPrompt;
  }

  protected getBaseSystemPrompt(): string {
    return `You are ClarifyPrompt, an AI prompt optimization expert. Your task is to transform weak, vague, or incomplete prompts into clear, detailed, and effective prompts that will produce excellent results from AI systems.

Core Principles:
1. PRESERVE INTENT: Never change what the user wants to achieve
2. ADD CLARITY: Make implicit requirements explicit
3. BE SPECIFIC: Replace vague terms with concrete details
4. STRUCTURE WELL: Organize complex requests logically
5. OPTIMIZE FOR AI: Format prompts for optimal AI comprehension

Important Rules:
- Output ONLY the optimized prompt, no explanations or metadata
- Do not add placeholders like [INSERT X HERE] unless absolutely necessary
- Maintain the user's voice and style preferences when clear
- If the input is already well-optimized, enhance it minimally`;
  }

  public renderLastSystemPrompt(context: OptimizationContext, platformInstructions?: string): string {
    const raw = this.buildSystemPrompt(context, platformInstructions);
    const intent = context.bundle?.analysis?.intent;
    const shape = getPromptShape(context.bundle, intent);
    const shaped = this.applyShape(raw, shape);
    const overlay = this.getIntentOverlay(intent);
    // Intent overlay lands AFTER shape-based trimming so small-model
    // compact-budget calls still carry the intent-specific directive.
    return overlay ? shaped + '\n' + overlay : shaped;
  }

  async optimize(
    prompt: string,
    context: OptimizationContext,
    platformHints?: string[],
    platformInstructions?: string,
  ): Promise<string> {
    const intent = context.bundle?.analysis?.intent;
    const shape = getPromptShape(context.bundle, intent);

    // System prompt: base + category principles + platform guidance + custom + mode.
    // Shape-adjusted first (so compact models don't drown), THEN the intent
    // overlay is appended — the overlay is the most directive signal and must
    // never be trimmed, regardless of shape budget.
    const rawSystem = this.buildSystemPrompt(context, platformInstructions);
    const shaped = this.applyShape(rawSystem, shape);
    const overlay = this.getIntentOverlay(intent);
    const systemPrompt = overlay ? `${shaped}\n${overlay}` : shaped;

    // --- Context Curator (Pass 2) ---
    // Turn flat grounding into an explicit token-budget problem. The curator
    // scores each candidate and fits the best subset into the target model's
    // remaining window.
    const acceptedExamples: AcceptedExample[] =
      context.acceptedExamples?.map(ex => ({
        originalPrompt: ex.originalPrompt,
        optimizedPrompt: ex.optimizedPrompt,
        category: ex.category,
        platform: ex.platform,
        intent: ex.intent,
        ts: ex.ts,
      })) ?? [];

    const curationResult = this.runCurator({
      context,
      systemPrompt,
      originalPrompt: prompt,
      acceptedExamples,
      platformHints,
      platformInstructions,
      shape,
    });

    // Stash for trace consumption + renderLastSystemPrompt consistency.
    this.lastCuration = curationResult;

    // Fallback to legacy block builder when curator returns empty (e.g., no
    // target-model capability info and no candidates). This keeps tests that
    // don't wire up a bundle still green.
    let groundingBlock = curationResult.block;
    if (!groundingBlock) {
      groundingBlock = buildGroundingContext({
        bundle: context.bundle,
        webSearchContext: context.enrichWithContext ? context.contextSources?.[0] : undefined,
        webSearchSources: context.webSearchSources,
        platformInstructions,
        platformHints,
        acceptedExamples,
      }).block;
    }

    const userPrompt = `Original Prompt:
"""
${prompt}
"""

Optimize this prompt for the ${context.category} category.${context.platform ? ` Target platform: ${context.platform}.` : ''}
${groundingBlock}
Ground the optimization in the Grounding Context above when relevant. Respect priority order (higher-listed sections outrank lower). Output only the optimized prompt:`;

    const result = await this.llmClient.simpleGenerate(systemPrompt, userPrompt, {
      temperature: shape.temperature,
      maxTokens: shape.maxTokens,
    });

    return result.content.trim();
  }

  /** Exposed for the engine to pull into the trace + response. */
  public lastCuration?: CurationResult;

  protected runCurator(args: {
    context: OptimizationContext;
    systemPrompt: string;
    originalPrompt: string;
    acceptedExamples: AcceptedExample[];
    platformHints?: string[];
    platformInstructions?: string;
    shape: PromptShape;
  }): CurationResult {
    const { context, systemPrompt, originalPrompt, acceptedExamples, platformHints, platformInstructions, shape } = args;

    const contextWindow = context.bundle?.targetModel?.capabilities.contextWindow ?? 32_000;
    const budget = computeBudget({
      contextWindow,
      systemPromptTokens: approxTokens(systemPrompt),
      outputTokens: shape.maxTokens,
      originalPromptTokens: approxTokens(originalPrompt),
    });

    const candidates = buildCandidates({
      bundle: context.bundle,
      webSearchContext: context.enrichWithContext ? context.contextSources?.[0] : undefined,
      webSearchSources: context.webSearchSources,
      platformInstructions,
      platformHints,
      acceptedExamples: acceptedExamples.map(ex => ({
        originalPrompt: ex.originalPrompt,
        optimizedPrompt: ex.optimizedPrompt,
        ts: ex.ts,
      })),
      memoryMatches: context.memoryMatches,
      intent: context.bundle?.analysis?.intent,
    });

    return curate(candidates, budget);
  }
}
