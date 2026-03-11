import type { Category } from '../../config/categories.js';
import type { OptimizationContext } from '../types.js';
import { BaseStrategy } from './base.js';

export class DocumentStrategy extends BaseStrategy {
  readonly name = 'DocumentStrategy';
  readonly category: Category = 'document';

  buildSystemPrompt(context: OptimizationContext, platformInstructions?: string): string {
    const platformGuidance = this.getPlatformGuidance(context.platform);
    const modeInstructions = this.getModeInstructions(context.mode);
    const customInstructions = platformInstructions
      ? `\nAdditional Custom Instructions:\n${platformInstructions}`
      : '';
    return `${this.getBaseSystemPrompt()}

Category: Document/Writing
${context.platform ? `Target Platform: ${context.platform}` : ''}

Document Prompt Optimization Principles:
- Define the target audience clearly
- Specify tone and voice requirements
- Include length and format guidelines
- Add key points or themes to cover
- Specify call-to-action if applicable
- Include brand voice or style guide references when relevant

${platformGuidance}${customInstructions}

${modeInstructions}`;
  }

  private getPlatformGuidance(platform?: string): string {
    const guidance: Record<string, string> = {
      claude: `
Platform-Specific Guidance for CLAUDE (Anthropic, Writing):
- Use XML tags to structure complex writing requests (<context>, <task>, <style>, <examples>)
- Leverage long context for providing reference materials and style samples
- Include detailed tone and voice descriptions for consistent output
- Use artifacts for standalone document output
- Good for long-form content, analysis, reports, and nuanced writing
- Specify formatting requirements explicitly (headings, lists, sections)
- Include examples of desired writing style when possible`,

      chatgpt: `
Platform-Specific Guidance for CHATGPT (OpenAI, Writing):
- Use system prompts to define writing persona and style guidelines
- Leverage browsing for research-backed content
- Use custom GPTs for specialized writing tasks
- Specify output format (markdown, plain text, HTML)
- Good for creative writing, brainstorming, and versatile content
- Include word count targets and structure requirements
- Use step-by-step instructions for complex documents`,

      gemini: `
Platform-Specific Guidance for GEMINI (Google, Writing):
- Leverage Google Search grounding for factual, research-backed content
- Use multimodal input (images, PDFs) as reference material
- Good for research papers, summaries, and fact-heavy documents
- Include grounding instructions for accuracy
- Specify source requirements and citation style
- Long context window supports extensive reference materials
- Good for document analysis and content synthesis`,

      jasper: `
Platform-Specific Guidance for JASPER:
- Define brand voice profile (tone, personality, values)
- Use built-in templates for specific content types (blog, ad, email)
- Include SEO keywords and target search intent
- Specify campaign context for marketing content
- Add target audience demographics and pain points
- Define content brief with key messaging points
- Good for marketing copy, ads, landing pages, and brand content
- Include competitor references for differentiation`,

      'copy-ai': `
Platform-Specific Guidance for COPY.AI:
- Select the appropriate workflow or template type
- Define brand voice and tone preferences
- Include target audience and use case context
- Specify the content format (email, social post, ad copy, blog)
- Add key selling points and value propositions
- Good for marketing copy, sales emails, and social media content
- Include word count or length preferences
- Define the call-to-action clearly`,

      'notion-ai': `
Platform-Specific Guidance for NOTION AI:
- Leverage in-context editing for refining existing documents
- Use for summarizing, translating, or adjusting tone of existing content
- Specify the action: write, edit, summarize, translate, brainstorm
- Include the surrounding document context for coherent results
- Good for meeting notes, project docs, and knowledge base content
- Define tone adjustments (more formal, more casual, more concise)
- Use for extracting action items and key takeaways`,

      grammarly: `
Platform-Specific Guidance for GRAMMARLY:
- Focus on rewriting and improving existing text
- Specify the target audience (general, expert, academic)
- Define formality level (informal, neutral, formal)
- Include intent (inform, persuade, describe, tell a story)
- Specify tone (confident, friendly, diplomatic, constructive)
- Good for editing, proofreading, and tone adjustment
- Use for making text more concise or more detailed
- Include domain context (academic, business, creative)`,

      writesonic: `
Platform-Specific Guidance for WRITESONIC:
- Include primary and secondary SEO keywords
- Define target audience and search intent
- Use article templates for structured long-form content
- Specify word count and content depth
- Include competitor URLs for reference
- Good for SEO blog posts, landing pages, and product descriptions
- Define tone of voice (professional, conversational, authoritative)
- Include outline structure or key headings to cover`,
    };

    return platform && guidance[platform]
      ? guidance[platform]
      : `
General Document/Writing Guidance:
- For blog posts: Define topic, audience, SEO keywords, and structure
- For emails: Specify purpose, recipient relationship, and tone
- For reports: Define type, audience, and structure requirements
- For essays: Specify thesis, style guide, and academic level
- For social media: Include platform, length limits, and hashtags
- For resumes: Define target role, key skills, and format`;
  }
}
