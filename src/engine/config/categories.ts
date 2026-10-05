import { loadCategoriesFromPacks, mergeWithFallback } from './platformLoader.js';

export type Category = 'chat' | 'image' | 'voice' | 'video' | 'code' | 'document' | 'music';
export type Mode = 'concise' | 'detailed' | 'structured' | 'step-by-step' | 'bullet-points' | 'technical' | 'simple';

export interface PlatformConfig {
  id: string;
  label: string;
  description: string;
  syntaxHints?: string[];
  instructions?: string;
  instructionsFile?: string;
  isCustom?: boolean;
}

export interface ResolvedPlatformConfig extends PlatformConfig {
  resolvedInstructions?: string;
}

export interface CategoryConfig {
  id: Category;
  label: string;
  description: string;
  platforms?: PlatformConfig[];
  defaultPlatform?: string;
  defaultMode: Mode;
  hasPlatforms: boolean;
  /**
   * When true, an optimization with NO explicit platform produces
   * platform-neutral output instead of falling back to `defaultPlatform`.
   * Set on text categories (chat/document/code) whose output is portable
   * prose — so the result isn't silently shaped to one vendor's syntax.
   * Creative categories (image/video/…) leave this off: their output needs
   * a concrete platform format to be usable, so the flagship default stands.
   */
  portableByDefault?: boolean;
}

const IMAGE_PLATFORMS: PlatformConfig[] = [
  { id: 'midjourney', label: 'Midjourney (V8.x)', description: 'Artistic, stylized imagery; current default V8.2', syntaxHints: ['--ar', '--v 8.2', '--style raw', '--stylize 0-1000', '--chaos 0-100', '--q (1,2,4)', '--sref', '--edit'] },
  { id: 'dall-e', label: 'OpenAI image (GPT Image 2 / DALL-E 3)', description: 'Natural language, versatile; GPT Image 2 current', syntaxHints: ['natural language', 'full sentences', 'aspect ratio in words'] },
  { id: 'stable-diffusion', label: 'Stable Diffusion', description: 'Open source, highly customizable', syntaxHints: ['negative prompts', 'CFG scale', 'steps', 'samplers', 'LoRA', 'embeddings'] },
  { id: 'flux', label: 'Flux (2)', description: 'High detail, photorealistic', syntaxHints: ['natural language', 'high detail focus', 'guidance scale 3-7', 'multi-reference editing'] },
  { id: 'ideogram', label: 'Ideogram', description: 'Best for text in images', syntaxHints: ['magic prompt', 'text rendering', 'typography'] },
  { id: 'leonardo', label: 'Leonardo AI', description: 'Preset styles, game art', syntaxHints: ['preset styles', 'guidance scale', 'contrast', 'alchemy'] },
  { id: 'firefly', label: 'Adobe Firefly', description: 'Commercial safe, natural', syntaxHints: ['natural language', 'style references', 'effects'] },
  { id: 'grok-aurora', label: 'Grok Aurora', description: 'xAI, fast and creative', syntaxHints: ['natural language', 'creative interpretation', 'fast generation'] },
  { id: 'imagen', label: 'Google Imagen (4 / 4 Ultra)', description: 'Photorealistic, via Gemini/Vertex', syntaxHints: ['natural language', 'photorealistic', 'aspect ratios'] },
  { id: 'recraft', label: 'Recraft', description: 'Vector design, brand assets', syntaxHints: ['style selection', 'vector output', 'brand colors', 'SVG export'] },
];

const VIDEO_PLATFORMS: PlatformConfig[] = [
  { id: 'runway', label: 'Runway (Gen-4.5)', description: 'Gen-4.5 Turbo flagship — best prompt adherence, References, Act-Two', syntaxHints: ['natural language', 'References (character/object consistency)', 'Act-Two motion capture', 'camera controls', 'extend', 'up to 4K'] },
  { id: 'pika', label: 'Pika (2.2)', description: 'Fast social-first stylized video', syntaxHints: ['Pikaframes (first/last keyframe)', 'Pikaswaps', 'Pikadditions', 'Pikaformance lip-sync', 'up to 1080p'] },
  { id: 'kling', label: 'Kling (3.0 / Omni)', description: 'Best physics and complex motion, native 4K/60fps', syntaxHints: ['natural language', 'native 4K 60fps', 'Omni: native audio + 5-language lip-sync', 'multi-shot storyboards (6 shots)', 'extend to ~60s'] },
  { id: 'luma', label: 'Luma Dream Machine (Ray 2)', description: 'Fast, keyframe control', syntaxHints: ['natural language', 'keyframes', 'camera motion'] },
  { id: 'minimax', label: 'Minimax / Hailuo (2.3)', description: 'Expressive motion, best value, native audio', syntaxHints: ['natural language', 'character animation', 'expressions', 'native audio'] },
  { id: 'veo', label: 'Google Veo (3.1)', description: 'DeepMind flagship — 4K, native/spatial audio', syntaxHints: ['natural language', 'Standard/Fast/Lite tiers', '4K', '8s extendable', 'native audio', 'reference images', 'legible text-in-video'] },
  { id: 'seedance', label: 'Seedance (2.0 / 2.5)', description: 'ByteDance flagship — 20s clips, multi-reference, product consistency', syntaxHints: ['long-form natural-language prose', 'up to 20s', 'aspect ratios 16:9/9:16/1:1/4:3/3:4/custom', 'up to 12 reference files', 'native audio sync', 'multi-shot storyboarding'] },
  { id: 'wan', label: 'Wan (2.6)', description: 'Open source, versatile', syntaxHints: ['natural language', 'open source', 'image-to-video', 'text-to-video'] },
  { id: 'heygen', label: 'HeyGen', description: 'AI avatar videos, talking heads', syntaxHints: ['avatar selection', 'script input', 'voice pairing', 'gestures', 'background'] },
  { id: 'synthesia', label: 'Synthesia', description: 'Enterprise AI avatar videos', syntaxHints: ['avatar selection', 'script input', 'multi-language', 'brand templates', 'slides'] },
  { id: 'cogvideox', label: 'CogVideoX', description: 'Open weights, high quality text-to-video', syntaxHints: ['natural language', 'open weights', 'text-to-video', 'image-to-video', 'detailed descriptions'] },
];

const VOICE_PLATFORMS: PlatformConfig[] = [
  { id: 'elevenlabs', label: 'ElevenLabs (v3)', description: 'Expressive TTS with audio tags, voice cloning', syntaxHints: ['v3 audio tags: [laughs], [whispers], [excited]', 'voice settings: stability/similarity/style', 'conversational agents', 'cloning from 10s audio', '32+ languages'] },
  { id: 'openai-tts', label: 'OpenAI TTS (gpt-4o-mini-tts)', description: 'Instruction-following voices', syntaxHints: ['natural-language voice instructions', 'steer tone/delivery/emotion', 'speed 0.25-4.0', 'no SSML'] },
  { id: 'fish-audio', label: 'Fish Audio', description: 'Voice cloning, multilingual', syntaxHints: ['voice cloning', 'multilingual', 'emotional control', 'reference audio'] },
  { id: 'sesame', label: 'Sesame', description: 'Conversational AI voices', syntaxHints: ['conversational style', 'emotional expression', 'natural dialogue', 'character voices'] },
  { id: 'google-tts', label: 'Google TTS', description: 'Cloud TTS, WaveNet voices', syntaxHints: ['SSML support', 'WaveNet voices', 'Neural2 voices', 'speaking rate', 'pitch'] },
  { id: 'playht', label: 'PlayHT', description: 'Ultra-realistic TTS, voice cloning', syntaxHints: ['voice selection', 'emotion control', 'speed', 'voice cloning', 'PlayHT 2.0 turbo'] },
  { id: 'kokoro', label: 'Kokoro', description: 'Open weights, fast expressive TTS', syntaxHints: ['open weights', 'voice presets', 'emotional control', 'fast inference', 'local deployment'] },
];

const MUSIC_PLATFORMS: PlatformConfig[] = [
  { id: 'suno', label: 'Suno (v6)', description: 'Music from text prompts; v6 family Sept 2026', syntaxHints: ['models: v6 | v6-wild | v6-mini', 'genre + mood + tempo', '[Verse]/[Chorus]/[Bridge]/[Outro] section tags', 'plain-language section edits', 'Max Mode for 2min+ songs', 'up to 8 minutes', 'no public API'] },
  { id: 'udio', label: 'Udio', description: 'Music generation, remixing', syntaxHints: ['genre tags', 'mood', 'extend', 'remix'] },
  { id: 'eleven-music', label: 'ElevenLabs Music (v2.5)', description: 'Licensed commercial tracks, public API', syntaxHints: ['natural-language prompt', 'API: music_v2_5, composition plans', 'up to 5min (10min via plans)', 'inpainting, audio reference', 'creator-owned'] },
  { id: 'lyria', label: 'Google Lyria (3.5)', description: 'Google music model — Flow Music, Gemini API', syntaxHints: ['natural language', '30s to ~3min', 'Selective Section Painting', 'lyric rewrite', 'image-to-music (preview)'] },
  { id: 'stable-audio', label: 'Stable Audio', description: 'Stability AI, high-quality audio', syntaxHints: ['natural language', 'duration', 'genre', 'mood', 'instruments', 'BPM'] },
  { id: 'musicgen', label: 'MusicGen', description: 'Meta, open weights music generation', syntaxHints: ['open weights', 'natural language', 'melody conditioning', 'genre', 'tempo', 'local deployment'] },
];

const CODE_PLATFORMS: PlatformConfig[] = [
  { id: 'claude', label: 'Claude', description: 'Anthropic, long context reasoning', syntaxHints: ['system prompts', 'XML tags', 'chain of thought', 'artifacts'] },
  { id: 'chatgpt', label: 'ChatGPT', description: 'OpenAI, general coding', syntaxHints: ['system prompts', 'code interpreter', 'function calling', 'markdown'] },
  { id: 'cursor', label: 'Cursor', description: 'AI-first IDE', syntaxHints: ['inline edits', 'codebase context', '@file references', '.cursorrules'] },
  { id: 'copilot', label: 'GitHub Copilot', description: 'Inline completions', syntaxHints: ['inline suggestions', 'comment-driven', 'context from open files', 'short prompts'] },
  { id: 'windsurf', label: 'Windsurf', description: 'Codeium, flow-based', syntaxHints: ['cascade flows', 'multi-file edits', 'codebase awareness', 'natural language'] },
  { id: 'deepseek-coder', label: 'DeepSeek Coder', description: 'Open weights, top coding benchmarks', syntaxHints: ['open weights', 'system prompts', 'fill-in-middle', 'code completion', 'local deployment'] },
  { id: 'qwen-coder', label: 'Qwen Coder', description: 'Alibaba, open weights coding specialist', syntaxHints: ['open weights', 'system prompts', 'code completion', 'multi-language', 'local deployment'] },
  { id: 'codestral', label: 'Codestral', description: 'Mistral, fast code generation', syntaxHints: ['open weights', 'fill-in-middle', 'fast inference', '32K context', 'local deployment'] },
  { id: 'gemini-code', label: 'Gemini', description: 'Google, strong coding with long context', syntaxHints: ['system prompts', 'long context', 'multimodal', 'grounding', 'Google integration'] },
];

const CHAT_PLATFORMS: PlatformConfig[] = [
  { id: 'claude', label: 'Claude (Sonnet 5 / Opus 4 line)', description: 'Anthropic, strong reasoning and analysis', syntaxHints: ['system prompts', 'XML tags', 'extended thinking', 'long context', 'artifacts'] },
  { id: 'chatgpt', label: 'ChatGPT (GPT-5)', description: 'OpenAI, versatile conversation', syntaxHints: ['system prompts', 'browsing', 'code interpreter', 'custom GPTs', 'reasoning models: max_completion_tokens'] },
  { id: 'gemini', label: 'Gemini (Flash latest / Pro)', description: 'Google, multimodal reasoning', syntaxHints: ['multimodal input', 'Google integration', 'long context', 'grounding'] },
  { id: 'llama', label: 'Llama', description: 'Meta, open weights, local deployment', syntaxHints: ['open weights', 'system prompts', 'local deployment', 'fine-tunable', 'Ollama/vLLM'] },
  { id: 'deepseek', label: 'DeepSeek', description: 'Open weights, strong reasoning (R1/V3)', syntaxHints: ['open weights', 'system prompts', 'chain of thought', 'deep reasoning', 'local deployment'] },
  { id: 'qwen', label: 'Qwen', description: 'Alibaba, open weights, multilingual', syntaxHints: ['open weights', 'system prompts', 'multilingual', 'tool use', 'local deployment'] },
  { id: 'kimi', label: 'Kimi', description: 'Moonshot AI, ultra-long context (2M tokens)', syntaxHints: ['ultra-long context', 'document analysis', 'natural language', 'file upload'] },
  { id: 'glm', label: 'GLM (Z.ai)', description: 'Z.ai (formerly Zhipu AI), GLM-4.6+ line, open weights', syntaxHints: ['open weights', 'system prompts', 'multilingual', 'tool use', 'local deployment'] },
  { id: 'minimax-chat', label: 'Minimax', description: 'Minimax, strong general reasoning', syntaxHints: ['system prompts', 'function calling', 'long context', 'multilingual'] },
];

const DOCUMENT_PLATFORMS: PlatformConfig[] = [
  { id: 'claude', label: 'Claude', description: 'Anthropic, long-form writing and analysis', syntaxHints: ['system prompts', 'XML tags', 'long context', 'artifacts', 'structured output'] },
  { id: 'chatgpt', label: 'ChatGPT', description: 'OpenAI, versatile writing', syntaxHints: ['system prompts', 'browsing for research', 'custom GPTs', 'markdown output'] },
  { id: 'gemini', label: 'Gemini', description: 'Google, research-backed writing', syntaxHints: ['grounding', 'Google Search integration', 'long context', 'multimodal input'] },
  { id: 'jasper', label: 'Jasper', description: 'Marketing copy and brand content', syntaxHints: ['brand voice', 'templates', 'tone of voice', 'campaign briefs', 'SEO mode'] },
  { id: 'copy-ai', label: 'Copy.ai', description: 'Marketing copy and workflows', syntaxHints: ['templates', 'workflows', 'brand voice', 'tone selection', 'use cases'] },
  { id: 'notion-ai', label: 'Notion AI', description: 'Integrated writing assistant', syntaxHints: ['in-context editing', 'summarize', 'translate', 'tone adjustment', 'action items'] },
  { id: 'grammarly', label: 'Grammarly', description: 'Editing, rewriting, tone adjustment', syntaxHints: ['tone detection', 'rewrite suggestions', 'formality level', 'audience', 'intent'] },
  { id: 'writesonic', label: 'Writesonic', description: 'SEO content and articles', syntaxHints: ['SEO keywords', 'article templates', 'tone', 'word count', 'target audience'] },
];

/**
 * Hardcoded fallback table. Pre-1.5 this WAS the source of truth. Now it's
 * a defense layer: if `packs/platforms/<category>.yaml` is missing or
 * unparseable for some category, we fall back to this entry for that one
 * category — the rest still load from YAML.
 *
 * Editing built-in platforms? Edit `packs/platforms/*.yaml`. This array
 * is kept in sync with the YAML packs but should not be the place you make
 * changes.
 */
const FALLBACK_CATEGORIES: CategoryConfig[] = [
  { id: 'chat', label: 'Chat', description: 'General conversation & Q&A', platforms: CHAT_PLATFORMS, defaultPlatform: 'claude', defaultMode: 'detailed', hasPlatforms: true, portableByDefault: true },
  { id: 'image', label: 'Image', description: 'Image generation', platforms: IMAGE_PLATFORMS, defaultPlatform: 'midjourney', defaultMode: 'detailed', hasPlatforms: true },
  { id: 'voice', label: 'Voice', description: 'Voice & speech synthesis', platforms: VOICE_PLATFORMS, defaultPlatform: 'elevenlabs', defaultMode: 'detailed', hasPlatforms: true },
  { id: 'video', label: 'Video', description: 'Video generation', platforms: VIDEO_PLATFORMS, defaultPlatform: 'runway', defaultMode: 'detailed', hasPlatforms: true },
  { id: 'music', label: 'Music', description: 'Music generation', platforms: MUSIC_PLATFORMS, defaultPlatform: 'suno', defaultMode: 'detailed', hasPlatforms: true },
  { id: 'code', label: 'Code', description: 'Programming & development', platforms: CODE_PLATFORMS, defaultPlatform: 'claude', defaultMode: 'detailed', hasPlatforms: true, portableByDefault: true },
  { id: 'document', label: 'Document', description: 'Writing & documents', platforms: DOCUMENT_PLATFORMS, defaultPlatform: 'claude', defaultMode: 'detailed', hasPlatforms: true, portableByDefault: true },
];

/**
 * The live table the rest of the engine reads from. Loaded once at module
 * import: YAML packs win where present, fallback entries fill any gaps.
 *
 * Side effect: missing-pack and parse-failure warnings are written to
 * stderr by the loader. We don't throw — better to boot with the fallback
 * than to refuse to start because of a malformed YAML edit.
 */
export const CATEGORIES: CategoryConfig[] = mergeWithFallback(
  loadCategoriesFromPacks(),
  FALLBACK_CATEGORIES,
);

export const MODES: { id: Mode; label: string; description: string }[] = [
  { id: 'concise', label: 'Concise', description: 'Short and to the point' },
  { id: 'detailed', label: 'Detailed', description: 'Comprehensive with examples' },
  { id: 'structured', label: 'Structured', description: 'Organized with clear sections' },
  { id: 'step-by-step', label: 'Step-by-Step', description: 'Sequential instructions' },
  { id: 'bullet-points', label: 'Bullet Points', description: 'List format, scannable' },
  { id: 'technical', label: 'Technical', description: 'Expert-level depth' },
  { id: 'simple', label: 'Simple', description: 'Plain language, easy to understand' },
];

export function getCategoryById(id: Category): CategoryConfig | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function getPlatformsForCategory(categoryId: Category): PlatformConfig[] {
  const category = getCategoryById(categoryId);
  return category?.platforms ?? [];
}

export function getPlatformById(categoryId: Category, platformId: string): PlatformConfig | undefined {
  const platforms = getPlatformsForCategory(categoryId);
  return platforms.find((p) => p.id === platformId);
}
