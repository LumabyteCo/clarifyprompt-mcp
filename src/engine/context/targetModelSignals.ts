import type { TargetModelSignal } from './types.js';

interface CapabilityEntry {
  match: RegExp;
  provider: string;
  family: string;
  contextWindow?: number;
  supportsJsonMode?: boolean;
  supportsToolUse?: boolean;
  supportsSystemPrompt?: boolean;
  supportsVision?: boolean;
  localDeployment?: boolean;
  strengths: string[];
  weaknesses: string[];
}

// Order matters: first match wins. More specific patterns first.
const CAPABILITY_TABLE: CapabilityEntry[] = [
  {
    match: /^claude-opus|opus-4/i,
    provider: 'anthropic',
    family: 'Claude Opus',
    contextWindow: 200_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    supportsVision: true,
    strengths: ['complex reasoning', 'long-context analysis', 'nuanced writing', 'coding'],
    weaknesses: ['higher latency', 'higher cost'],
  },
  {
    match: /^claude-sonnet|sonnet-4/i,
    provider: 'anthropic',
    family: 'Claude Sonnet',
    contextWindow: 200_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    supportsVision: true,
    strengths: ['balanced cost/quality', 'tool use', 'coding', 'analysis'],
    weaknesses: ['not cheapest for bulk rewrites'],
  },
  {
    match: /^claude-haiku|haiku-4/i,
    provider: 'anthropic',
    family: 'Claude Haiku',
    contextWindow: 200_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    supportsVision: true,
    strengths: ['low latency', 'cheap', 'good for classifiers'],
    weaknesses: ['less depth on complex reasoning'],
  },
  {
    match: /^gpt-4\.1|^gpt-4o/i,
    provider: 'openai',
    family: 'GPT-4',
    contextWindow: 128_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    supportsVision: true,
    strengths: ['general-purpose', 'tool use', 'multimodal'],
    weaknesses: ['variable recall on very long context'],
  },
  {
    match: /^o1|^o3|^o4/i,
    provider: 'openai',
    family: 'OpenAI reasoning',
    contextWindow: 128_000,
    supportsJsonMode: true,
    supportsToolUse: false,
    supportsSystemPrompt: false,
    strengths: ['deep reasoning', 'math', 'coding'],
    weaknesses: ['no system prompt', 'higher latency'],
  },
  {
    match: /^gemini/i,
    provider: 'google',
    family: 'Gemini',
    contextWindow: 1_000_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    supportsVision: true,
    strengths: ['very long context', 'multimodal', 'grounding'],
    weaknesses: ['less steerable in some tasks'],
  },
  {
    match: /^grok/i,
    provider: 'xai',
    family: 'Grok',
    contextWindow: 128_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    strengths: ['real-time info', 'casual tone'],
    weaknesses: ['less established for enterprise'],
  },
  {
    // R-series is a reasoning model family; keep it separate so we don't
    // claim system-prompt support it doesn't have.
    match: /^deepseek[-_]?r|deepseek[-_]?reasoner/i,
    provider: 'deepseek',
    family: 'DeepSeek Reasoning',
    contextWindow: 64_000,
    supportsJsonMode: true,
    supportsToolUse: false,
    supportsSystemPrompt: false,
    localDeployment: true,
    strengths: ['deep chain-of-thought reasoning', 'math', 'open weights'],
    weaknesses: ['no system prompt', 'higher latency', 'verbose by default'],
  },
  {
    match: /^deepseek/i,
    provider: 'deepseek',
    family: 'DeepSeek',
    contextWindow: 64_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    localDeployment: true,
    strengths: ['reasoning', 'coding', 'cheap', 'open weights'],
    weaknesses: ['less polished general chat'],
  },
  {
    match: /^qwen/i,
    provider: 'alibaba',
    family: 'Qwen',
    contextWindow: 32_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    localDeployment: true,
    strengths: ['multilingual', 'open weights', 'tool use'],
    weaknesses: ['smaller variants weaker on reasoning'],
  },
  {
    match: /^llama/i,
    provider: 'meta',
    family: 'Llama',
    contextWindow: 128_000,
    supportsJsonMode: false,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    localDeployment: true,
    strengths: ['open weights', 'runs locally', 'good general-purpose'],
    weaknesses: ['quality varies heavily by size/variant'],
  },
  {
    // Mixtral (Mistral MoE) — 8x7b / 8x22b. MoE parser in parseParameterBillions
    // extracts the per-expert size so shape logic uses active-parameter count.
    match: /^mixtral/i,
    provider: 'mistral',
    family: 'Mixtral',
    contextWindow: 32_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    localDeployment: true,
    strengths: ['MoE-efficient inference', 'open weights', 'multilingual', 'function calling'],
    weaknesses: ['large total param footprint to serve', 'older than Mistral Large'],
  },
  {
    match: /^mistral|^codestral/i,
    provider: 'mistral',
    family: 'Mistral',
    contextWindow: 32_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    localDeployment: true,
    strengths: ['fast', 'open weights', 'code-specialized variants'],
    weaknesses: ['shorter context window'],
  },
  {
    match: /^gemma/i,
    provider: 'google',
    family: 'Gemma',
    contextWindow: 128_000,
    supportsJsonMode: true,
    supportsToolUse: false,
    supportsSystemPrompt: true,
    localDeployment: true,
    strengths: ['open weights', 'multilingual', 'Google-DeepMind curated training'],
    weaknesses: ['weaker tool-use', 'narrower third-party ecosystem'],
  },
  {
    match: /^phi/i,
    provider: 'microsoft',
    family: 'Phi',
    contextWindow: 128_000,
    supportsJsonMode: true,
    supportsToolUse: false,
    supportsSystemPrompt: true,
    localDeployment: true,
    strengths: ['compact + efficient', 'strong reasoning-per-parameter', 'open weights'],
    weaknesses: ['narrower world knowledge than frontier models'],
  },
  {
    match: /^command[-_]?(?:r|a|light|nightly)|cohere/i,
    provider: 'cohere',
    family: 'Cohere Command',
    contextWindow: 128_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    strengths: ['RAG-optimized', 'strong tool-use + citations', 'multilingual'],
    weaknesses: ['smaller third-party ecosystem'],
  },
  {
    match: /^aya/i,
    provider: 'cohere',
    family: 'Aya',
    contextWindow: 128_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    localDeployment: true,
    strengths: ['100+ languages', 'open weights'],
    weaknesses: ['less polished for English-only tasks than specialized models'],
  },
  {
    // Kimi K-series (Moonshot) — known for ultra-long contexts.
    match: /^kimi/i,
    provider: 'moonshot',
    family: 'Kimi',
    contextWindow: 200_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    strengths: ['ultra-long context', 'document-heavy tasks', 'multilingual'],
    weaknesses: ['variable availability outside China-region APIs'],
  },
  {
    match: /^glm/i,
    provider: 'zhipu',
    family: 'GLM',
    contextWindow: 128_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    localDeployment: true,
    strengths: ['multilingual (Chinese-English focus)', 'open weights', 'tool use'],
    weaknesses: ['smaller community than Llama/Qwen'],
  },
  {
    match: /^minimax/i,
    provider: 'minimax',
    family: 'Minimax',
    contextWindow: 128_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    strengths: ['long context', 'function calling', 'multilingual'],
    weaknesses: ['less known outside APAC region'],
  },
  {
    // OpenAI gpt-oss (open-weights) released 2025 — 20b dense + 120b MoE.
    match: /^gpt-oss/i,
    provider: 'openai',
    family: 'GPT-OSS',
    contextWindow: 128_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    localDeployment: true,
    strengths: ['open weights from OpenAI', 'strong general reasoning'],
    weaknesses: ['newer; ecosystem still forming'],
  },
  {
    match: /^yi/i,
    provider: '01-ai',
    family: 'Yi',
    contextWindow: 200_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    localDeployment: true,
    strengths: ['long context', 'bilingual (Chinese-English)', 'open weights'],
    weaknesses: ['less community tooling'],
  },
  {
    match: /^nemotron|^nvidia/i,
    provider: 'nvidia',
    family: 'Nemotron',
    contextWindow: 128_000,
    supportsJsonMode: true,
    supportsToolUse: true,
    supportsSystemPrompt: true,
    localDeployment: true,
    strengths: ['NVIDIA-tuned Llama variants', 'steerability', 'instruction following'],
    weaknesses: ['inherits the base Llama limitations'],
  },
];

export function collectTargetModelSignal(
  modelName?: string,
  providerHint?: string,
): TargetModelSignal | undefined {
  if (!modelName) return undefined;

  const entry = CAPABILITY_TABLE.find(e => e.match.test(modelName));
  if (!entry) {
    return {
      model: modelName,
      provider: providerHint,
      capabilities: {},
      strengths: [],
      weaknesses: [],
    };
  }

  return {
    model: modelName,
    provider: providerHint || entry.provider,
    family: entry.family,
    capabilities: {
      contextWindow: entry.contextWindow,
      parameterBillions: parseParameterBillions(modelName),
      supportsJsonMode: entry.supportsJsonMode,
      supportsToolUse: entry.supportsToolUse,
      supportsSystemPrompt: entry.supportsSystemPrompt,
      supportsVision: entry.supportsVision,
      localDeployment: entry.localDeployment,
    },
    strengths: entry.strengths,
    weaknesses: entry.weaknesses,
  };
}

/**
 * Pull the model's parameter count out of its ID. Ollama conventions encode
 * size in the tag (`llama3.2:3b`, `qwen2.5:14b-instruct-q4_K_M`, `mixtral:8x7b`).
 * Hosted models (`gpt-4o`, `claude-sonnet-4`) don't advertise a count and
 * return undefined — those get the rich-tier treatment by default.
 *
 * Returns billions as a number, e.g. 3, 7, 13, 70, 405. For MoE tags like
 * "8x7b" we return the active-parameter estimate (7 in that case).
 */
function parseParameterBillions(id: string): number | undefined {
  const lower = id.toLowerCase();

  // Trillion tags like "kimi-k2:1t-cloud" — report billions (× 1000).
  const tera = lower.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)t(?=[^a-z0-9]|$)/);
  if (tera) return parseFloat(tera[1]) * 1000;

  // "8x7b" / "8x22b" — MoE; report the per-expert (active) size.
  const moe = lower.match(/\b\d+x(\d+(?:\.\d+)?)b\b/);
  if (moe) return parseFloat(moe[1]);

  // plain "3b", "7b", "14b", "70b", "405b" with word-boundary on each side
  const plain = lower.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)b(?=[^a-z0-9]|$)/);
  if (plain) return parseFloat(plain[1]);

  // Small-tier heuristic for hosted models that don't advertise size.
  // Word-boundary on each side so "mini" inside "minimax" does NOT match.
  if (/\b(mini|nano|haiku|flash)\b/i.test(id)) return 5;

  return undefined;
}
