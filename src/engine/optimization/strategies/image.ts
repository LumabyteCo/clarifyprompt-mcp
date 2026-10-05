import type { Category } from '../../config/categories.js';
import type { OptimizationContext } from '../types.js';
import { BaseStrategy } from './base.js';

export class ImageStrategy extends BaseStrategy {
  readonly name = 'ImageStrategy';
  readonly category: Category = 'image';

  buildSystemPrompt(context: OptimizationContext, platformInstructions?: string): string {
    const platformGuidance = this.getPlatformGuidance(context.platform);
    const modeInstructions = this.getModeInstructions(context.mode);
    const customInstructions = platformInstructions
      ? `\nAdditional Custom Instructions:\n${platformInstructions}`
      : '';
    return `${this.getBaseSystemPrompt()}

Category: Image Generation
${context.platform ? `Target Platform: ${context.platform}` : ''}

Image Prompt Optimization Principles:
- Structure: Subject + Style + Details + Technical specs
- Use evocative, descriptive language
- Include artistic style references when relevant
- Specify composition, lighting, and mood
- Add negative prompt elements when helpful for the platform

${platformGuidance}${customInstructions}

${modeInstructions}`;
  }

  private getPlatformGuidance(platform?: string): string {
    const guidance: Record<string, string> = {
      midjourney: `
Platform-Specific Guidance for MIDJOURNEY (V8.x — current default V8.2):
- Use descriptive, artistic language; subject first, parameters last
- Include aspect ratio with --ar (e.g., --ar 16:9)
- Pin the version: --v 8.2 (V7 introduced --draft and --oref; Omni Reference replaced by the Edit Model in V8.x)
- Use --style raw for photorealistic work
- --stylize / --s 0-1000 (default 100); low = literal, high = house aesthetic
- --chaos / --c 0-100 for grid variation
- --quality / --q (V7+: 1, 2, 4; no --q 3)
- --hd / --sd on V8.1: 2048px vs 1024px output
- --sref <url|code> for style reference, --sw for style weight
- --edit (V8.x Edit Model): modify an image with written instructions + up to 4 references
- --p / --profile for personalization
- Format: "prompt text --ar 16:9 --v 8.2 --style raw"`,

      'dall-e': `
Platform-Specific Guidance for OPENAI IMAGE (GPT Image 2 / DALL-E 3):
- Use clear, natural language, full-sentence descriptions (no flags)
- Describe the scene conversationally — GPT Image 2 is instruction-following
- Be very specific about what you want to see
- Include art style, medium, lighting, camera, and mood
- State aspect ratio in words ("wide 16:9 landscape composition")
- Quote any text that should appear in the image
- Avoid commands or flags — descriptive prose only`,

      'stable-diffusion': `
Platform-Specific Guidance for STABLE DIFFUSION / SDXL:
- Use comma-separated keywords/phrases (e.g., "beautiful landscape, sunset, 8k, highly detailed")
- Include positive prompt with weighted terms using (term:1.2) syntax
- Always consider negative prompts to exclude unwanted elements
- Mention technical quality terms (masterpiece, best quality, 8k)
- Include specific art styles and artists for reference
- Consider LoRA and embeddings if available
- Format: "positive prompt, style, quality" + Negative: "unwanted elements"`,

      flux: `
Platform-Specific Guidance for FLUX:
- Use natural language descriptions
- Focus on high detail and photorealistic elements
- Be specific about lighting, materials, and textures
- Include composition and camera angle details
- Flux excels at prompt adherence - be precise
- Consider guidance scale in API (typically 3-7)`,

      ideogram: `
Platform-Specific Guidance for IDEOGRAM:
- Excels at rendering text in images
- Use clear typography instructions
- Specify exact text to appear in quotes
- Include font style preferences (bold, handwritten, etc.)
- Enable "magic prompt" for enhanced results
- Great for logos, signs, and text-heavy designs`,

      leonardo: `
Platform-Specific Guidance for LEONARDO AI:
- Use preset styles when applicable
- Include guidance scale in prompt (typically 7-12)
- Add contrast and color preferences
- Use Alchemy mode for enhanced quality
- Specify model if relevant (DreamShaper, RPG, etc.)
- Good for character art and game assets`,

      firefly: `
Platform-Specific Guidance for ADOBE FIREFLY:
- Use natural, descriptive language
- Focus on commercially-safe imagery
- Include style references (watercolor, oil painting, etc.)
- Specify effects like depth of field or motion blur
- Can use reference images for style matching
- Safe for commercial use - no copyrighted references`,

      'grok-aurora': `
Platform-Specific Guidance for GROK AURORA (xAI):
- Use natural, creative language descriptions
- Fast generation with strong creative interpretation
- Good at following complex compositional instructions
- Include artistic style and mood clearly
- Specify aspect ratio and composition preferences
- Excels at photorealistic and artistic styles alike`,

      imagen: `
Platform-Specific Guidance for GOOGLE IMAGEN 3:
- Use clear, natural language descriptions
- Excels at photorealistic output and fine details
- Specify size and aspect ratio (1024x1024, 1536x1024, etc.)
- Strong at text rendering in images
- Include lighting, composition, and atmosphere details
- Available via Gemini and Vertex AI
- Good for product photography and realistic scenes`,

      'nano-banana': `
Platform-Specific Guidance for NANO BANANA (Google Gemini 2.5 Flash Image):
- Direct the whole scene in natural language — describe subject, setting, and mood in full sentences, not a pile of keywords
- Use professional photographic terminology to control the look (camera/lens, angle, depth of field)
- Control lighting explicitly (e.g. "three-point softbox setup", "soft golden-hour backlight")
- For EDITING an existing image, say what should CHANGE and what should STAY the same — it preserves subject/character identity across edits
- Reference multiple images to keep a character consistent or place a product into a new scene
- Reliable at rendering readable text inside the image
- State the aspect ratio; iterate by changing one variable at a time
- Strong for consistent characters, iterative edits, and text-in-image work`,

      recraft: `
Platform-Specific Guidance for RECRAFT:
- Specialized in vector and design output
- Select style: realistic, digital illustration, vector, icon
- Excellent for brand assets, logos, and design elements
- Supports SVG export for scalable graphics
- Specify brand colors and design constraints
- Include typography and layout preferences for design work
- Good for consistent style across multiple assets`,
    };

    return platform && guidance[platform]
      ? guidance[platform]
      : `
General Image Prompt Guidance:
- Start with the main subject clearly stated
- Add style descriptors (photorealistic, illustration, 3D render)
- Include mood and atmosphere (dramatic, peaceful, vibrant)
- Specify technical quality (detailed, sharp, professional)
- Add composition hints (close-up, wide shot, aerial view)`;
  }
}
