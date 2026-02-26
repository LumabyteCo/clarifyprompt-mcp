export type Category = 'chat' | 'image' | 'voice' | 'video' | 'code' | 'document' | 'music';
export type Mode = 'concise' | 'detailed' | 'structured' | 'step-by-step' | 'bullet-points' | 'technical' | 'simple';

export interface PlatformConfig {
  id: string;
  label: string;
  description: string;
  syntaxHints?: string[];
}

export interface CategoryConfig {
  id: Category;
  label: string;
  description: string;
  platforms?: PlatformConfig[];
  defaultPlatform?: string;
  defaultMode: Mode;
  hasPlatforms: boolean;
}

const IMAGE_PLATFORMS: PlatformConfig[] = [
  { id: 'midjourney', label: 'Midjourney', description: 'Artistic, stylized imagery', syntaxHints: ['--ar', '--v 6.1', '--style raw', '--chaos', '--weird', '--q', '--s'] },
  { id: 'dall-e', label: 'DALL-E 3', description: 'Natural language, versatile', syntaxHints: ['natural language', 'size: 1024x1024, 1792x1024, 1024x1792'] },
  { id: 'stable-diffusion', label: 'Stable Diffusion', description: 'Open source, highly customizable', syntaxHints: ['negative prompts', 'CFG scale', 'steps', 'samplers', 'LoRA', 'embeddings'] },
  { id: 'flux', label: 'Flux', description: 'High detail, photorealistic', syntaxHints: ['natural language', 'high detail focus', 'guidance scale'] },
  { id: 'ideogram', label: 'Ideogram', description: 'Best for text in images', syntaxHints: ['magic prompt', 'text rendering', 'typography'] },
  { id: 'leonardo', label: 'Leonardo AI', description: 'Preset styles, game art', syntaxHints: ['preset styles', 'guidance scale', 'contrast', 'alchemy'] },
  { id: 'firefly', label: 'Adobe Firefly', description: 'Commercial safe, natural', syntaxHints: ['natural language', 'style references', 'effects'] },
  { id: 'grok-aurora', label: 'Grok Aurora', description: 'xAI, fast and creative', syntaxHints: ['natural language', 'creative interpretation', 'fast generation'] },
  { id: 'imagen', label: 'Google Imagen 3', description: 'Photorealistic, via Gemini', syntaxHints: ['natural language', 'photorealistic', 'size: 1024x1024', 'aspect ratios'] },
  { id: 'recraft', label: 'Recraft', description: 'Vector design, brand assets', syntaxHints: ['style selection', 'vector output', 'brand colors', 'SVG export'] },
];

const VIDEO_PLATFORMS: PlatformConfig[] = [
  { id: 'sora', label: 'Sora', description: 'OpenAI, cinematic quality', syntaxHints: ['natural language', 'duration', 'camera motion', 'scene description'] },
  { id: 'runway', label: 'Runway Gen-3', description: 'Motion control, professional', syntaxHints: ['motion brush', 'camera controls', 'motion amount', 'extend'] },
  { id: 'pika', label: 'Pika Labs', description: 'Quick iterations, stylized', syntaxHints: ['motion parameters', 'camera movements', '-gs', '-motion'] },
  { id: 'kling', label: 'Kling AI', description: 'Long clips, high quality', syntaxHints: ['natural language', 'duration up to 2min', 'professional mode'] },
  { id: 'luma', label: 'Luma Dream Machine', description: 'Fast, keyframe control', syntaxHints: ['natural language', 'keyframes', 'camera motion'] },
  { id: 'minimax', label: 'Minimax / Hailuo', description: 'Expressive motion, Asian style', syntaxHints: ['natural language', 'character animation', 'expressions'] },
  { id: 'veo', label: 'Google Veo 2', description: 'DeepMind, cinematic 4K', syntaxHints: ['natural language', 'cinematic quality', '4K output', 'up to 2 minutes'] },
  { id: 'wan', label: 'Wan', description: 'Open source, versatile', syntaxHints: ['natural language', 'open source', 'image-to-video', 'text-to-video'] },
  { id: 'heygen', label: 'HeyGen', description: 'AI avatar videos, talking heads', syntaxHints: ['avatar selection', 'script input', 'voice pairing', 'gestures', 'background'] },
  { id: 'synthesia', label: 'Synthesia', description: 'Enterprise AI avatar videos', syntaxHints: ['avatar selection', 'script input', 'multi-language', 'brand templates', 'slides'] },
  { id: 'cogvideox', label: 'CogVideoX', description: 'Open weights, high quality text-to-video', syntaxHints: ['natural language', 'open weights', 'text-to-video', 'image-to-video', 'detailed descriptions'] },
];

const VOICE_PLATFORMS: PlatformConfig[] = [
  { id: 'elevenlabs', label: 'ElevenLabs', description: 'Voice cloning, realistic TTS', syntaxHints: ['voice settings', 'stability', 'clarity', 'style'] },
  { id: 'openai-tts', label: 'OpenAI TTS', description: 'Simple, reliable voices', syntaxHints: ['voice selection', 'speed', 'alloy/echo/fable/onyx/nova/shimmer'] },
  { id: 'fish-audio', label: 'Fish Audio', description: 'Voice cloning, multilingual', syntaxHints: ['voice cloning', 'multilingual', 'emotional control', 'reference audio'] },
  { id: 'sesame', label: 'Sesame', description: 'Conversational AI voices', syntaxHints: ['conversational style', 'emotional expression', 'natural dialogue', 'character voices'] },
  { id: 'google-tts', label: 'Google TTS', description: 'Cloud TTS, WaveNet voices', syntaxHints: ['SSML support', 'WaveNet voices', 'Neural2 voices', 'speaking rate', 'pitch'] },
  { id: 'playht', label: 'PlayHT', description: 'Ultra-realistic TTS, voice cloning', syntaxHints: ['voice selection', 'emotion control', 'speed', 'voice cloning', 'PlayHT 2.0 turbo'] },
  { id: 'kokoro', label: 'Kokoro', description: 'Open weights, fast expressive TTS', syntaxHints: ['open weights', 'voice presets', 'emotional control', 'fast inference', 'local deployment'] },
];

const MUSIC_PLATFORMS: PlatformConfig[] = [
  { id: 'suno', label: 'Suno AI', description: 'Music from text prompts', syntaxHints: ['genre', 'mood', 'lyrics', 'instrumental', 'style tags'] },
  { id: 'udio', label: 'Udio', description: 'Music generation, remixing', syntaxHints: ['genre tags', 'mood', 'extend', 'remix'] },
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
  { id: 'claude', label: 'Claude', description: 'Anthropic, strong reasoning and analysis', syntaxHints: ['system prompts', 'XML tags', 'chain of thought', 'long context', 'artifacts'] },
  { id: 'chatgpt', label: 'ChatGPT', description: 'OpenAI, versatile conversation', syntaxHints: ['system prompts', 'browsing', 'code interpreter', 'DALL-E integration', 'custom GPTs'] },
  { id: 'gemini', label: 'Gemini', description: 'Google, multimodal reasoning', syntaxHints: ['multimodal input', 'Google integration', 'long context', 'grounding'] },
  { id: 'llama', label: 'Llama', description: 'Meta, open weights, local deployment', syntaxHints: ['open weights', 'system prompts', 'local deployment', 'fine-tunable', 'Ollama/vLLM'] },
  { id: 'deepseek', label: 'DeepSeek', description: 'Open weights, strong reasoning (R1/V3)', syntaxHints: ['open weights', 'system prompts', 'chain of thought', 'deep reasoning', 'local deployment'] },
  { id: 'qwen', label: 'Qwen', description: 'Alibaba, open weights, multilingual', syntaxHints: ['open weights', 'system prompts', 'multilingual', 'tool use', 'local deployment'] },
  { id: 'kimi', label: 'Kimi', description: 'Moonshot AI, ultra-long context (2M tokens)', syntaxHints: ['ultra-long context', 'document analysis', 'natural language', 'file upload'] },
  { id: 'glm', label: 'GLM', description: 'Zhipu AI, ChatGLM series, open weights', syntaxHints: ['open weights', 'system prompts', 'multilingual', 'tool use', 'local deployment'] },
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

export const CATEGORIES: CategoryConfig[] = [
  { id: 'chat', label: 'Chat', description: 'General conversation & Q&A', platforms: CHAT_PLATFORMS, defaultPlatform: 'claude', defaultMode: 'detailed', hasPlatforms: true },
  { id: 'image', label: 'Image', description: 'Image generation', platforms: IMAGE_PLATFORMS, defaultPlatform: 'midjourney', defaultMode: 'detailed', hasPlatforms: true },
  { id: 'voice', label: 'Voice', description: 'Voice & speech synthesis', platforms: VOICE_PLATFORMS, defaultPlatform: 'elevenlabs', defaultMode: 'detailed', hasPlatforms: true },
  { id: 'video', label: 'Video', description: 'Video generation', platforms: VIDEO_PLATFORMS, defaultPlatform: 'runway', defaultMode: 'detailed', hasPlatforms: true },
  { id: 'music', label: 'Music', description: 'Music generation', platforms: MUSIC_PLATFORMS, defaultPlatform: 'suno', defaultMode: 'detailed', hasPlatforms: true },
  { id: 'code', label: 'Code', description: 'Programming & development', platforms: CODE_PLATFORMS, defaultPlatform: 'claude', defaultMode: 'detailed', hasPlatforms: true },
  { id: 'document', label: 'Document', description: 'Writing & documents', platforms: DOCUMENT_PLATFORMS, defaultPlatform: 'claude', defaultMode: 'detailed', hasPlatforms: true },
];

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
