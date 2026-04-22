import { getLLMClient } from '../llm/client.js';
import type { Category, Mode } from '../config/categories.js';
import type { Intent } from './types.js';

const CATEGORIES: Category[] = ['chat', 'image', 'voice', 'video', 'music', 'code', 'document'];

const INTENTS: Intent[] = [
  'quick-draft',
  'production-code',
  'stakeholder-comm',
  'data-extract',
  'exploration',
  'brand-voice',
  'creative-media',
  'technical-spec',
  'analysis',
  'unknown',
];

const MODES: Mode[] = [
  'concise', 'detailed', 'structured', 'step-by-step', 'bullet-points', 'technical', 'simple',
];

export type AnalysisConfidence = 'high' | 'medium' | 'low';

export interface PromptAnalysis {
  category: Category;
  intent: Intent;
  recommendedMode: Mode;
  confidence: AnalysisConfidence;
  rationale?: string;
  source: 'llm' | 'fallback';
}

export interface AnalyzerInputs {
  prompt: string;
  userCategoryHint?: Category;
  filePath?: string;
  fileLanguage?: string;
  projectRulesExcerpt?: string;
  frameworks?: string[];
}

// Intent → default recommended mode when user did not pick one.
const INTENT_MODE: Record<Intent, Mode> = {
  'quick-draft':       'concise',
  'production-code':   'technical',
  'stakeholder-comm':  'detailed',
  'data-extract':      'structured',
  'exploration':       'detailed',
  'brand-voice':       'detailed',
  'creative-media':    'detailed',
  'technical-spec':    'structured',
  'analysis':          'structured',
  'unknown':           'detailed',
};

/**
 * Replaces the separate detectCategory + resolveIntent pair with a single
 * LLM call that produces all three signals coherently. Fixes the
 * "emails → document" mis-route because intent participates in the decision.
 */
export async function analyzePrompt(inputs: AnalyzerInputs): Promise<PromptAnalysis> {
  const llm = getLLMClient();

  const system = `You are ClarifyPrompt's analysis step. For each prompt, you return THREE fields in ONE answer on a single line, separated by pipes:

<category>|<intent>|<confidence>

Categories: chat, image, voice, video, music, code, document
Intents: quick-draft, production-code, stakeholder-comm, data-extract, exploration, brand-voice, creative-media, technical-spec, analysis, unknown
Confidence: high, medium, low

Decision rules:
- Choose category and intent jointly. If a prompt's wording makes one category LOOK obvious (e.g. "emails" → document) but the intent is clearly "production-code" ("write a function to validate emails"), pick the category that matches the intent. Intent beats surface keywords.
- image / video / voice / music / document / code have priority over chat when any of them fit.
- "unknown" intent only when truly ambiguous ("make it better", "do the thing").
- high = both category and intent are obvious; medium = one is clear, the other plausible; low = ambiguous in either.

Reply format (exactly): <category>|<intent>|<confidence>
No explanation, no prose, no punctuation other than the pipes.`;

  const userPrompt = buildUserPrompt(inputs);

  try {
    const result = await llm.simpleGenerate(system, userPrompt, {
      temperature: 0.1,
      maxTokens: 24,
    });
    return parseResponse(result.content, inputs);
  } catch (err) {
    console.error('[PromptAnalyzer] analysis failed:', err);
    return fallback(inputs);
  }
}

function buildUserPrompt(inputs: AnalyzerInputs): string {
  const lines: string[] = [`Prompt:\n"""${inputs.prompt}"""`];
  if (inputs.userCategoryHint) {
    lines.push(`User-provided category hint: ${inputs.userCategoryHint} (you may still override if clearly wrong).`);
  }
  if (inputs.filePath) {
    lines.push(`Active file: ${inputs.filePath}${inputs.fileLanguage ? ` (${inputs.fileLanguage})` : ''}`);
  }
  if (inputs.frameworks?.length) {
    lines.push(`Workspace frameworks: ${inputs.frameworks.join(', ')}`);
  }
  if (inputs.projectRulesExcerpt) {
    lines.push(`Project rules excerpt:\n${inputs.projectRulesExcerpt.slice(0, 300)}`);
  }
  lines.push('Classify. Reply with: <category>|<intent>|<confidence>');
  return lines.join('\n\n');
}

function parseResponse(content: string, inputs: AnalyzerInputs): PromptAnalysis {
  const raw = content.trim().toLowerCase();
  const parts = raw.split('|').map(s => s.trim());

  const category = pickValid(parts[0], CATEGORIES, inputs.userCategoryHint ?? 'chat');
  const intent = pickValid(parts[1], INTENTS, 'unknown') as Intent;
  const confidence: AnalysisConfidence =
    parts[2] === 'high' || parts[2] === 'medium' || parts[2] === 'low'
      ? parts[2]
      : 'medium';

  return {
    category: category as Category,
    intent,
    recommendedMode: INTENT_MODE[intent],
    confidence,
    source: 'llm',
  };
}

function pickValid<T extends string>(s: string | undefined, valid: readonly T[], fallback: T): T {
  if (!s) return fallback;
  if ((valid as readonly string[]).includes(s)) return s as T;
  for (const v of valid) if (s.includes(v)) return v;
  return fallback;
}

function fallback(inputs: AnalyzerInputs): PromptAnalysis {
  const category = inputs.userCategoryHint ?? 'chat';
  return {
    category,
    intent: 'unknown',
    recommendedMode: 'detailed',
    confidence: 'low',
    source: 'fallback',
  };
}

export { INTENTS, CATEGORIES, MODES };
