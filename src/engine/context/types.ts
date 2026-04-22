import type { Category, Mode } from '../config/categories.js';

export type Intent =
  | 'quick-draft'
  | 'production-code'
  | 'stakeholder-comm'
  | 'data-extract'
  | 'exploration'
  | 'brand-voice'
  | 'creative-media'
  | 'technical-spec'
  | 'analysis'
  | 'unknown';

export interface IntentSignal {
  intent: Intent;
  confidence: 'high' | 'medium' | 'low';
  rationale?: string;
}

/**
 * The single, authoritative classification result produced by analyzePrompt().
 * Category and intent are resolved together so they can't disagree silently.
 */
export interface AnalysisSignal {
  category: import('../config/categories.js').Category;
  intent: Intent;
  recommendedMode: import('../config/categories.js').Mode;
  confidence: 'high' | 'medium' | 'low';
  source: 'llm' | 'fallback';
}

export interface FileSignal {
  path?: string;
  language?: string;
  excerpt?: string;
  excerptLines?: { start: number; end: number };
}

export interface ProjectSignal {
  rootPath?: string;
  hasClaudeMd: boolean;
  hasAgentsMd: boolean;
  hasCursorRules: boolean;
  hasClarifyMd: boolean;
  rulesMarkdown?: string;
  packageName?: string;
  frameworks: string[];
  languages: string[];
}

export interface SessionSignal {
  sessionId: string;
  recentOptimizations: SessionOptimizationEntry[];
  recentOutcomes: SessionOutcomeEntry[];
}

export interface SessionOptimizationEntry {
  id: string;
  ts: number;
  originalPrompt: string;
  optimizedPrompt: string;
  category: Category;
  platform?: string;
  intent?: Intent;
}

export interface SessionOutcomeEntry {
  optimizationId: string;
  verdict: 'accepted' | 'edited' | 'rejected';
  ts: number;
  diff?: string;
}

export interface TargetModelSignal {
  provider?: string;
  model: string;
  family?: string;
  capabilities: {
    contextWindow?: number;
    parameterBillions?: number;
    supportsJsonMode?: boolean;
    supportsToolUse?: boolean;
    supportsSystemPrompt?: boolean;
    supportsVision?: boolean;
    localDeployment?: boolean;
  };
  strengths: string[];
  weaknesses: string[];
}

export interface UserSignal {
  locale?: string;
  preferredMode?: Mode;
  pinnedInstructions?: string;
}

export interface ContextBundle {
  schemaVersion: 1;
  user: UserSignal;
  project: ProjectSignal;
  session: SessionSignal;
  file?: FileSignal;
  targetModel?: TargetModelSignal;
  intent?: IntentSignal;
  analysis?: AnalysisSignal;
}

export interface ContextBundleInputs {
  filePath?: string;
  fileLanguage?: string;
  fileExcerpt?: string;
  cwd?: string;
  sessionId?: string;
  userLocale?: string;
  userPinnedInstructions?: string;
  userPreferredMode?: Mode;
  prompt: string;
  category?: Category;
  platform?: string;
  modelName?: string;
  modelProvider?: string;
  skipIntentResolution?: boolean;
}
