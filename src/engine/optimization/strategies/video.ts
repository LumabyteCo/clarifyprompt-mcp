import type { Category } from '../../config/categories.js';
import type { OptimizationContext } from '../types.js';
import { BaseStrategy } from './base.js';

export class VideoStrategy extends BaseStrategy {
  readonly name = 'VideoStrategy';
  readonly category: Category = 'video';

  buildSystemPrompt(context: OptimizationContext, platformInstructions?: string): string {
    const platformGuidance = this.getPlatformGuidance(context.platform);
    const modeInstructions = this.getModeInstructions(context.mode);
    const customInstructions = platformInstructions
      ? `\nAdditional Custom Instructions:\n${platformInstructions}`
      : '';
    return `${this.getBaseSystemPrompt()}

Category: Video Generation
${context.platform ? `Target Platform: ${context.platform}` : ''}

Video Prompt Optimization Principles:
- Describe motion and action sequences clearly
- Specify camera movements and angles
- Include timing and duration guidance
- Define transitions between scenes
- Add visual style references
- Include audio/music suggestions when relevant

${platformGuidance}${customInstructions}

${modeInstructions}`;
  }

  private getPlatformGuidance(platform?: string): string {
    const guidance: Record<string, string> = {
      // NOTE (1.16.0): `sora` guidance removed — OpenAI shut down the Sora 2
      // Videos API on 2026-09-24 (consumer app April 26) with no replacement.
      // The platform entry was retired from the packs; unknown ids fall back
      // to the general guidance below, so legacy callers degrade gracefully.
      runway: `
Platform-Specific Guidance for RUNWAY (Gen-4.5):
- Describe the starting frame clearly; strongest prompt adherence in the category
- Use References — upload a character/object image for consistency across generations
- Act-Two: apply recorded human motion to a character reference
- Camera controls: pan, tilt, zoom, orbit; motion brush for area-specific movement
- Include extend functionality for longer clips; up to 4K output
- Editor-first workflow (timeline, keyframing) — describe shots, not edits`,

      pika: `
Platform-Specific Guidance for PIKA (2.2):
- Use concise, action-focused descriptions; fastest generation in the category
- Pikaframes: interpolate between first and last keyframes
- Pikaswaps (replace objects), Pikadditions (insert elements), Pikaffects (stylized effects)
- Pikaformance: fast lip-synced talking images
- Keep prompts short and focused; up to 1080p`,

      kling: `
Platform-Specific Guidance for KLING (3.0 / Omni):
- Use natural-language cinematic prose
- Best physics and complex motion (fluids, dance, sports); native 4K at 60fps
- Omni variant: native audio with lip-synced dialogue in five languages
- Multi-shot storyboards — up to 6 shots per clip
- Extend to ~60 seconds; strong character consistency from reference images`,

      luma: `
Platform-Specific Guidance for LUMA DREAM MACHINE (Ray 2):
- Use natural language scene descriptions
- Include keyframe concepts for control
- Specify camera motion type (orbit, push in, etc.)
- Good for quick iterations and testing
- Describe the mood and atmosphere
- Works well with simple, clear motion requests`,

      minimax: `
Platform-Specific Guidance for MINIMAX / HAILUO (2.3):
- Use detailed character animation descriptions
- Good for expressive facial animations
- Include emotional context for characters
- Specify movement style (realistic, exaggerated)
- Native audio generation
- Use natural language descriptions`,

      veo: `
Platform-Specific Guidance for GOOGLE VEO (3.1):
- Use cinematic, detailed scene descriptions; strongest prompt adherence
- Tiers: Standard (4K, spatial audio) / Fast / Lite (720p-1080p volume tier)
- 8-second clips, extendable; reference images and start/end frame control
- Native audio generation (ambient, dialogue on Omni-class models)
- Text within video stays legible while the camera moves
- Specify aspect ratio (16:9, 9:16, 1:1)
- Good for professional and cinematic content`,

      seedance: `
Platform-Specific Guidance for SEEDANCE (2.0 / 2.5):
- Long-form natural-language prose: action + camera + lighting + mood
- Up to 20 seconds per clip — longer than most competitors
- "aspect ratios: 16:9, 9:16, 1:1, 4:3, 3:4, custom"
- Up to 12 reference files (images, video, audio) for identity/brand consistency
- Native audio-video sync; multi-shot storyboarding
- Strong on dance, sports, action, and product/logo consistency`,

      wan: `
Platform-Specific Guidance for WAN:
- Open source model with versatile capabilities
- Supports both text-to-video and image-to-video workflows
- Use clear, descriptive natural language
- Specify motion type and intensity
- Include scene transitions for multi-shot concepts
- Good for quick prototyping and experimentation
- Describe the visual style (realistic, animated, artistic)`,

      heygen: `
Platform-Specific Guidance for HEYGEN:
- Focus on the script/dialogue the avatar should speak
- Specify avatar type (stock avatar or custom)
- Include gestures and body language cues
- Define background setting (office, studio, custom)
- Specify voice pairing and language for the avatar
- Include pacing and emotional delivery notes
- Good for marketing videos, training content, and presentations
- Keep scripts conversational and direct`,

      synthesia: `
Platform-Specific Guidance for SYNTHESIA:
- Write a clear script for the AI presenter to read
- Specify avatar and language (120+ languages supported)
- Include slide or scene layout instructions
- Define brand elements (logo placement, colors, fonts)
- Add transition guidance between scenes
- Good for enterprise training, onboarding, and corporate comms
- Structure content in clear sections with scene breaks
- Include on-screen text or caption instructions`,

      cogvideox: `
Platform-Specific Guidance for COGVIDEOX (Open Weights):
- Use highly detailed, descriptive natural language
- Specify motion, camera angles, and scene transitions
- Include style references (cinematic, animated, realistic)
- Works locally via ComfyUI, Hugging Face, or custom pipelines
- Good for experimentation and research
- Describe lighting, color palette, and atmosphere
- Supports both text-to-video and image-to-video`,
    };

    return platform && guidance[platform]
      ? guidance[platform]
      : `
General Video Prompt Guidance:
- Start with the main action or scene
- Describe camera movement (static, tracking, panning)
- Include timing hints (fast, slow, gradual)
- Specify the visual style (cinematic, casual, animated)
- Add atmosphere and lighting details
- Keep motion descriptions achievable`;
  }
}
