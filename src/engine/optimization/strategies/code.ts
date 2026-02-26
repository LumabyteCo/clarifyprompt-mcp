import type { Category } from '../../config/categories.js';
import type { OptimizationContext } from '../types.js';
import { BaseStrategy } from './base.js';

export class CodeStrategy extends BaseStrategy {
  readonly name = 'CodeStrategy';
  readonly category: Category = 'code';

  buildSystemPrompt(context: OptimizationContext): string {
    const platformGuidance = this.getPlatformGuidance(context.platform);
    const modeInstructions = this.getModeInstructions(context.mode);

    return `${this.getBaseSystemPrompt()}

Category: Code/Programming
${context.platform ? `Target Platform: ${context.platform}` : ''}

Code Prompt Optimization Principles:
- Specify programming language and version
- Include framework/library context when relevant
- Define input/output requirements clearly
- Add error handling expectations
- Specify code style preferences
- Include performance requirements when relevant
- Provide example inputs and expected outputs when helpful

General Guidance:
- For writing code: Define exact functionality, language, and interfaces
- For debugging: Include error messages, expected vs actual behavior
- For refactoring: Define goals, constraints, and patterns to apply
- For explanations: Specify audience level and focus areas
- For conversions: Specify source/target languages and idioms
- For testing: Specify framework, test types, and edge cases

${platformGuidance}

${modeInstructions}`;
  }

  private getPlatformGuidance(platform?: string): string {
    const guidance: Record<string, string> = {
      claude: `
Platform-Specific Guidance for CLAUDE (Anthropic):
- Use XML tags to structure complex prompts (<context>, <task>, <constraints>)
- Leverage long context window for large codebases
- Include chain-of-thought instructions for complex reasoning
- Use system prompts for persistent coding conventions
- Specify artifact output for standalone code blocks
- Good for architectural reasoning, refactoring, and code review
- Can handle entire files and multi-file contexts`,

      chatgpt: `
Platform-Specific Guidance for CHATGPT (OpenAI):
- Use system prompts to set coding persona and conventions
- Leverage Code Interpreter for runnable code and data analysis
- Use markdown code blocks for clear formatting
- Include function calling schemas for structured output
- Specify step-by-step reasoning for complex algorithms
- Good for quick prototyping and explanations
- Can execute Python code in sandbox`,

      cursor: `
Platform-Specific Guidance for CURSOR:
- Use @file references to point to specific codebase files
- Write prompts that assume codebase context is available
- Be specific about which files to edit and what changes to make
- Use .cursorrules for persistent project conventions
- Include inline edit instructions for targeted changes
- Good for multi-file refactoring and feature implementation
- Reference existing patterns in the codebase`,

      copilot: `
Platform-Specific Guidance for GITHUB COPILOT:
- Use comments directly above code for inline suggestions
- Keep prompts short and contextual (Copilot uses surrounding code)
- Write descriptive function signatures and docstrings
- Use // TODO: comments for feature guidance
- Provide type annotations for better completions
- Good for line-by-line and function-level completions
- Context comes from open files - keep relevant files open`,

      windsurf: `
Platform-Specific Guidance for WINDSURF (Codeium):
- Use natural language for cascade flow instructions
- Describe multi-file changes in a single prompt
- Leverage codebase-wide awareness for consistent changes
- Specify the scope of changes clearly
- Good for large refactors and cross-file edits
- Include the reasoning behind changes for better results
- Reference project structure and conventions`,

      'deepseek-coder': `
Platform-Specific Guidance for DEEPSEEK CODER (Open Weights):
- Top-tier coding benchmarks, especially for code generation
- Supports fill-in-the-middle (FIM) for inline completions
- Use system prompts to define coding conventions
- Open weights — runs locally via Ollama, vLLM, or llama.cpp
- Excellent at code completion, bug fixing, and generation
- Include language and framework context in prompts
- Good for privacy-sensitive codebases (fully local)
- Structure complex tasks with clear input/output specs`,

      'qwen-coder': `
Platform-Specific Guidance for QWEN CODER (Alibaba, Open Weights):
- Strong multi-language code generation
- Use system prompts for coding style and conventions
- Open weights — runs locally via Ollama or Transformers
- Good for code completion, translation between languages
- Include specific framework and version context
- Supports multiple programming languages well
- Structure prompts with clear task and constraint sections`,

      codestral: `
Platform-Specific Guidance for CODESTRAL (Mistral):
- Fast inference, optimized for code generation
- Supports fill-in-the-middle (FIM) for inline completions
- 32K context window for medium-sized codebases
- Open weights — runs locally via Ollama, vLLM, or Mistral API
- Good for rapid prototyping and code completion
- Use concise, focused prompts for best results
- Include language and framework context upfront`,

      'gemini-code': `
Platform-Specific Guidance for GEMINI (Google, Code):
- Very long context window for large codebases
- Supports multimodal input (screenshots, diagrams + code)
- Use clear, structured prompts with sections
- Good for code review, refactoring, and architectural reasoning
- Include grounding instructions for accurate code references
- Specify output format (code blocks, explanations, or both)
- Can process entire repositories with long context`,
    };

    return platform && guidance[platform]
      ? guidance[platform]
      : `
General Code Prompt Guidance:
- Specify the programming language and framework
- Define the task clearly (write, debug, refactor, explain)
- Include relevant code context and file structure
- Specify output format (code only, with comments, with tests)
- Add constraints (performance, style, compatibility)`;
  }
}
