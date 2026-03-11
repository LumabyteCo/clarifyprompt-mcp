import type { Category } from '../../config/categories.js';
import type { OptimizationContext } from '../types.js';
import { BaseStrategy } from './base.js';

export class ChatStrategy extends BaseStrategy {
  readonly name = 'ChatStrategy';
  readonly category: Category = 'chat';

  buildSystemPrompt(context: OptimizationContext, platformInstructions?: string): string {
    const platformGuidance = this.getPlatformGuidance(context.platform);
    const modeInstructions = this.getModeInstructions(context.mode);
    const customInstructions = platformInstructions
      ? `\nAdditional Custom Instructions:\n${platformInstructions}`
      : '';
    return `${this.getBaseSystemPrompt()}

Category: Chat/Conversation
${context.platform ? `Target Platform: ${context.platform}` : ''}

Chat Prompt Optimization Principles:
- Clarify exactly what information is being sought
- Add context about the requester's knowledge level
- Specify the desired depth and format of the answer
- Include relevant constraints (time period, domain, etc.)
- Make implicit assumptions explicit
- Define the target audience's expertise level
- Request appropriate analogies or examples when helpful
- Indicate preferred explanation style if relevant

${platformGuidance}${customInstructions}

${modeInstructions}`;
  }

  private getPlatformGuidance(platform?: string): string {
    const guidance: Record<string, string> = {
      claude: `
Platform-Specific Guidance for CLAUDE (Anthropic):
- Use XML tags to structure complex prompts (<task>, <context>, <constraints>, <examples>)
- Leverage long context window for detailed background information
- Include chain-of-thought instructions ("Think step by step")
- Use system prompt for persona and behavioral guidelines
- Claude responds well to explicit formatting instructions
- Good for analysis, reasoning, coding, and nuanced writing
- Include examples of desired output format when possible`,

      chatgpt: `
Platform-Specific Guidance for CHATGPT (OpenAI):
- Use clear, conversational instructions
- Leverage system message for setting persona and rules
- Include "You are a..." role definitions for best results
- Specify output format explicitly (JSON, markdown, bullet points)
- Good for creative writing, brainstorming, and general knowledge
- Use step-by-step instructions for complex tasks
- Include constraints to prevent hallucination ("Only use information from...")`,

      gemini: `
Platform-Specific Guidance for GEMINI (Google):
- Leverage multimodal capabilities (can process images, audio, video)
- Use clear, structured prompts with explicit sections
- Good for tasks requiring Google ecosystem knowledge
- Include grounding instructions for factual accuracy
- Supports very long context for document analysis
- Specify output format and length expectations
- Good for research, summarization, and multimodal reasoning`,

      llama: `
Platform-Specific Guidance for LLAMA (Meta, Open Weights):
- Use clear system prompts for persona and behavior
- Keep instructions direct and unambiguous
- Structure complex requests with numbered steps
- Good for privacy-sensitive tasks (runs locally)
- Works with Ollama, vLLM, llama.cpp, and other runtimes
- Smaller models need simpler, more focused prompts
- Larger models (70B+) handle complex reasoning well
- Include few-shot examples for specialized tasks`,

      deepseek: `
Platform-Specific Guidance for DEEPSEEK (R1/V3):
- Excels at deep reasoning and chain-of-thought tasks
- Use system prompts for behavior and persona
- Include "think step by step" for complex reasoning (R1 speciality)
- Good for math, logic, coding, and analytical tasks
- Open weights — runs locally via Ollama, vLLM, or SGLang
- Structure multi-step problems with clear numbered steps
- Larger models handle nuanced and ambiguous queries well`,

      qwen: `
Platform-Specific Guidance for QWEN (Alibaba):
- Strong multilingual support (especially Chinese-English)
- Use system prompts for persona and task definition
- Supports tool use and function calling
- Open weights — runs locally via Ollama, vLLM, or Transformers
- Good for general conversation, translation, and analysis
- Include language preferences when multilingual content is needed
- Structure complex tasks with clear sections`,

      kimi: `
Platform-Specific Guidance for KIMI (Moonshot AI):
- Ultra-long context window (up to 2M tokens)
- Ideal for analyzing very large documents or codebases
- Use file upload for document-heavy tasks
- Include specific references to sections when analyzing long content
- Good for summarization, research, and document Q&A
- Structure questions to leverage the full context window
- Specify which parts of long documents to focus on`,

      glm: `
Platform-Specific Guidance for GLM (Zhipu AI, ChatGLM):
- Open weights — runs locally via Hugging Face or custom pipelines
- Strong multilingual support (Chinese-English focus)
- Use system prompts for persona and behavior
- Supports tool use and function calling
- Good for general conversation and knowledge tasks
- Include clear formatting instructions for structured output
- Smaller models work well for focused, single-turn tasks`,

      'minimax-chat': `
Platform-Specific Guidance for MINIMAX:
- Strong general reasoning and conversation abilities
- Supports function calling and tool use
- Good for long-context tasks and document analysis
- Use system prompts for persona definition
- Include clear output format specifications
- Strong multilingual capabilities
- Good for creative writing and analytical tasks`,
    };

    return platform && guidance[platform]
      ? guidance[platform]
      : `
General Chat/Conversation Guidance:
- For questions: Clarify what specific information is needed
- For explanations: Specify the audience and depth
- For comparisons: List items clearly and define criteria
- For brainstorming: Define the problem and constraints
- For roleplay: Define the character/persona clearly
- For translations: Specify languages and formality level`;
  }
}
