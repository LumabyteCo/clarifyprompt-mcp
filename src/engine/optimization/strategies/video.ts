import type { Category } from '../../config/categories.js';
import type { OptimizationContext } from '../types.js';
import { BaseStrategy } from './base.js';

export class VideoStrategy extends BaseStrategy {
  readonly name = 'VideoStrategy';
  readonly category: Category = 'video';

  buildSystemPrompt(context: OptimizationContext): string {
    const platformGuidance = this.getPlatformGuidance(context.platform);
    const modeInstructions = this.getModeInstructions(context.mode);

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

${platformGuidance}

${modeInstructions}`;
  }

  private getPlatformGuidance(platform?: string): string {
    const guidance: Record<string, string> = {
      sora: `
Platform-Specific Guidance for SORA (OpenAI):
- Use detailed, cinematic scene descriptions
- Describe motion naturally ("the camera slowly pans across...")
- Include duration preferences (up to 60 seconds supported)
- Specify camera movement types (tracking shot, crane shot, etc.)
- Add lighting and atmosphere details
- Describe character movements and emotions clearly
- Use natural language - no special syntax needed`,

      runway: `
Platform-Specific Guidance for RUNWAY GEN-3:
- Describe the starting frame clearly
- Use motion amount controls (subtle, moderate, dynamic)
- Specify camera movements (pan left/right, zoom in/out, orbit)
- Include extend functionality for longer clips
- Add motion brush concepts for specific area movement
- Keep descriptions focused on achievable motion
- Consider image-to-video workflows`,

      pika: `
Platform-Specific Guidance for PIKA LABS:
- Use concise, action-focused descriptions
- Include camera motion parameters (-camera zoom in, -camera pan left)
- Add motion strength with -gs (guidance scale)
- Specify -motion parameter for movement intensity
- Keep prompts relatively short and focused
- Good for stylized and artistic motion`,

      kling: `
Platform-Specific Guidance for KLING AI:
- Use natural language descriptions
- Can generate longer clips (up to 2 minutes)
- Use professional mode for higher quality
- Describe character expressions and movements
- Include scene continuity for multi-shot videos
- Good for human motion and complex scenes`,

      luma: `
Platform-Specific Guidance for LUMA DREAM MACHINE:
- Use natural language scene descriptions
- Include keyframe concepts for control
- Specify camera motion type (orbit, push in, etc.)
- Good for quick iterations and testing
- Describe the mood and atmosphere
- Works well with simple, clear motion requests`,

      minimax: `
Platform-Specific Guidance for MINIMAX / HAILUO:
- Use detailed character animation descriptions
- Good for expressive facial animations
- Include emotional context for characters
- Specify movement style (realistic, exaggerated)
- Works well for character-focused content
- Use natural language descriptions`,

      veo: `
Platform-Specific Guidance for GOOGLE VEO 2:
- Use cinematic, detailed scene descriptions
- Supports 4K output with high visual fidelity
- Can generate up to 2 minutes of video
- Describe camera movements naturally (dolly, crane, tracking)
- Include lighting and atmosphere details
- Strong at realistic physics and motion
- Specify aspect ratio (16:9, 9:16, 1:1)
- Good for professional and cinematic content`,

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
