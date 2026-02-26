import type { Category } from '../../config/categories.js';
import type { OptimizationContext } from '../types.js';
import { BaseStrategy } from './base.js';

export class VoiceStrategy extends BaseStrategy {
  readonly name = 'VoiceStrategy';
  readonly category: Category = 'voice';

  buildSystemPrompt(context: OptimizationContext): string {
    const platformGuidance = this.getPlatformGuidance(context.platform);
    const modeInstructions = this.getModeInstructions(context.mode);

    return `${this.getBaseSystemPrompt()}

Category: Voice/Speech Synthesis
${context.platform ? `Target Platform: ${context.platform}` : ''}

Voice Prompt Optimization Principles:
- Specify voice characteristics (age, gender, accent, tone)
- Include emotional tone and delivery style
- Add pacing and rhythm guidance
- Specify pronunciation for unusual words
- Include pauses and emphasis markers
- Define the speaking context (narration, conversation, presentation)

${platformGuidance}

${modeInstructions}`;
  }

  private getPlatformGuidance(platform?: string): string {
    const guidance: Record<string, string> = {
      elevenlabs: `
Platform-Specific Guidance for ELEVENLABS:
- Specify voice selection or clone requirements
- Include stability setting hints (0.0-1.0, lower = more variable)
- Add clarity/similarity enhancement preferences
- Include style exaggeration if needed
- Specify speaker boost for audio quality
- Add SSML-like markers for pauses: ... or [pause]
- Include pronunciation guides: [word: pronunciation]
- Good for cloned voices and realistic TTS`,

      'openai-tts': `
Platform-Specific Guidance for OPENAI TTS:
- Select voice: alloy (neutral), echo (deep), fable (warm), onyx (authoritative), nova (female), shimmer (soft)
- Specify speed (0.25 to 4.0, default 1.0)
- Use natural language for tone and delivery
- No special syntax - describe the reading style
- Good for clear, professional narration`,

      'fish-audio': `
Platform-Specific Guidance for FISH AUDIO:
- Specify voice cloning requirements with reference audio
- Include multilingual support needs (language, accent)
- Add emotional control parameters (happy, sad, neutral, excited)
- Describe voice characteristics in detail for cloning
- Good for multilingual content and voice cloning
- Specify audio quality and format preferences`,

      sesame: `
Platform-Specific Guidance for SESAME:
- Focus on conversational and natural dialogue style
- Include emotional expression cues (warm, empathetic, enthusiastic)
- Specify character voice traits for consistent personas
- Add natural dialogue markers (hesitations, reactions)
- Good for conversational AI, chatbots, and character voices
- Describe the interaction context for better tone matching`,

      'google-tts': `
Platform-Specific Guidance for GOOGLE TTS:
- Use SSML tags for fine control: <break>, <emphasis>, <prosody>
- Select voice type: WaveNet (natural) or Neural2 (latest quality)
- Specify speaking rate (0.25-4.0) and pitch (-20 to +20 semitones)
- Include language and locale codes for multilingual
- Add volume gain in dB for consistent levels
- Good for production-grade TTS with SSML control`,

      playht: `
Platform-Specific Guidance for PLAYHT:
- Select from ultra-realistic PlayHT 2.0 voices
- Include emotion control (happy, sad, angry, excited, calm)
- Specify speech speed and pacing
- Use voice cloning for custom voices (reference audio)
- Add emphasis markers for key words and phrases
- Good for podcasts, audiobooks, and content creation
- Specify output quality (draft for preview, high for production)
- Include pronunciation hints for proper nouns`,

      kokoro: `
Platform-Specific Guidance for KOKORO (Open Weights):
- Select from built-in voice presets or fine-tuned voices
- Include emotional tone cues (cheerful, serious, warm, neutral)
- Runs locally — no API latency, full privacy
- Specify language and accent preferences
- Good for applications needing fast, offline TTS
- Works with Hugging Face, local Python, or ONNX runtime
- Add pacing and emphasis guidance for natural delivery`,
    };

    return platform && guidance[platform]
      ? guidance[platform]
      : `
General Voice/TTS Guidance:
- Specify the voice type (male/female, age range)
- Include emotional tone (warm, authoritative, cheerful)
- Add pacing guidance (slow, conversational, energetic)
- Specify accent or dialect if relevant
- Include emphasis on key words
- Define the output context (podcast, audiobook, assistant)`;
  }
}
