import type { Category } from '../../config/categories.js';
import type { OptimizationContext } from '../types.js';
import { BaseStrategy } from './base.js';

export class MusicStrategy extends BaseStrategy {
  readonly name = 'MusicStrategy';
  readonly category: Category = 'music';

  buildSystemPrompt(context: OptimizationContext): string {
    const platformGuidance = this.getPlatformGuidance(context.platform);
    const modeInstructions = this.getModeInstructions(context.mode);

    return `${this.getBaseSystemPrompt()}

Category: Music Generation
${context.platform ? `Target Platform: ${context.platform}` : ''}

Music Prompt Optimization Principles:
- Specify the genre and sub-genre clearly
- Include mood, energy level, and emotional tone
- Add tempo hints (BPM or descriptive: slow, medium, fast)
- Define song structure (verse, chorus, bridge, outro)
- Include instrumentation preferences
- Specify vocal style or "instrumental" for no vocals
- Add production style references (lo-fi, polished, raw, etc.)

${platformGuidance}

${modeInstructions}`;
  }

  private getPlatformGuidance(platform?: string): string {
    const guidance: Record<string, string> = {
      suno: `
Platform-Specific Guidance for SUNO AI:
- Specify the music genre/style clearly
- Include mood and energy level
- Add tempo hints (slow, medium, fast)
- Use style tags: [Verse], [Chorus], [Bridge], [Outro]
- Include lyrics in quotes if needed
- Add "instrumental" for no vocals
- Specify instruments or sounds to include
- Can reference artist styles but not directly
- Use metatags for fine control: [Genre: rock], [Tempo: 120]`,

      udio: `
Platform-Specific Guidance for UDIO:
- Use genre tags for style (rock, jazz, electronic, hip-hop)
- Include mood descriptors (energetic, melancholic, uplifting)
- Add "extend" concepts for longer tracks
- Specify remix elements if needed
- Include tempo and key preferences
- Good for experimental and varied styles
- Describe the sonic texture and production quality`,

      'stable-audio': `
Platform-Specific Guidance for STABLE AUDIO:
- Use natural language descriptions of the desired audio
- Specify duration (up to 3 minutes)
- Include genre, mood, and instrumentation details
- Add BPM/tempo for precise rhythm control
- Describe the production style (clean, lo-fi, ambient, punchy)
- Good for background music, sound design, and audio loops
- Include energy progression (build-up, drop, fade out)
- Specify instruments by name for targeted results`,

      musicgen: `
Platform-Specific Guidance for MUSICGEN (Meta, Open Weights):
- Use clear natural language descriptions
- Specify genre, mood, and tempo in the description
- Supports melody conditioning (hum or reference audio input)
- Runs locally via Hugging Face, Replicate, or AudioCraft
- Good for research, prototyping, and custom pipelines
- Describe instruments and arrangement clearly
- Include energy level and dynamics
- Best for short-to-medium clips (up to 30 seconds per generation)`,
    };

    return platform && guidance[platform]
      ? guidance[platform]
      : `
General Music Generation Guidance:
- Specify the genre clearly (rock, jazz, electronic, etc.)
- Include mood and energy (upbeat, melancholic, chill)
- Add tempo preferences (slow ballad, mid-tempo groove, fast-paced)
- Describe the instrumentation (guitar, synths, drums, piano)
- Specify vocal presence (instrumental, male vocals, female vocals)
- Include production style (lo-fi, polished, live feel)`;
  }
}
