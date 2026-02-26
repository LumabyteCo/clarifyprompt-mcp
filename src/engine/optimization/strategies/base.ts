import type { Category, Mode } from '../../config/categories.js';
import type { OptimizationContext, OptimizationStrategy } from '../types.js';
import { getLLMClient } from '../../llm/client.js';

export abstract class BaseStrategy implements OptimizationStrategy {
  abstract readonly name: string;
  abstract readonly category: Category;

  protected llmClient = getLLMClient();

  abstract buildSystemPrompt(context: OptimizationContext): string;

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

  async optimize(prompt: string, context: OptimizationContext, platformHints?: string[]): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(context);

    const platformInstructions = platformHints?.length
      ? `\nPlatform-Specific Requirements:\n- ${platformHints.join('\n- ')}`
      : '';

    const userPrompt = `Original Prompt:
"""
${prompt}
"""

Optimize this prompt for the ${context.category} category.${context.platform ? ` Target platform: ${context.platform}.` : ''}${platformInstructions}
${context.enrichWithContext && context.contextSources?.length ? `
Additional Context (from web search):
${context.contextSources.join('\n')}
` : ''}
Output only the optimized prompt:`;

    const result = await this.llmClient.simpleGenerate(systemPrompt, userPrompt, {
      temperature: 0.7,
      maxTokens: 2048,
    });

    return result.content.trim();
  }
}
