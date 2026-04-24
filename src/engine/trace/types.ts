import type { Category, Mode } from '../config/categories.js';
import type { ContextBundle } from '../context/types.js';

export type TraceMode = 'off' | 'local' | 'otel';

export interface TraceEntry {
  schemaVersion: 1;
  id: string;
  ts: string;
  sessionId: string;
  category: Category;
  platform?: string;
  mode: Mode;
  input: {
    originalPrompt: string;
    autoDetectedCategory: boolean;
  };
  bundleSummary: {
    intent?: string;
    intentConfidence?: string;
    targetModel?: string;
    targetFamily?: string;
    hasProjectRules: boolean;
    frameworks: string[];
    languages: string[];
    filePath?: string;
    sessionOptimizationCount: number;
  };
  systemPrompt: string;
  output: {
    optimizedPrompt: string;
  };
  model: string;
  strategy: string;
  latencyMs: number;
  tokensUsed?: number;
  groundingSources?: string[];
  shape?: {
    budget: 'compact' | 'standard' | 'rich';
    maxTokens: number;
    temperature: number;
  };
  /** Pass 6 — curator decisions, for explain_last_curation + trace review. */
  curation?: {
    budget: { total: number; reservedForPrompt: number; availableForGrounding: number };
    used: number;
    selected: Array<{ source: string; label: string; tokens: number; utility: number; pinned: boolean }>;
    rejected: Array<{ source: string; tokens: number; utility: number; reason: string }>;
  };
  error?: { message: string };
}

export function summarizeBundleForTrace(bundle: ContextBundle): TraceEntry['bundleSummary'] {
  return {
    intent: bundle.intent?.intent,
    intentConfidence: bundle.intent?.confidence,
    targetModel: bundle.targetModel?.model,
    targetFamily: bundle.targetModel?.family,
    hasProjectRules: !!bundle.project.rulesMarkdown,
    frameworks: bundle.project.frameworks,
    languages: bundle.project.languages,
    filePath: bundle.file?.path,
    sessionOptimizationCount: bundle.session.recentOptimizations.length,
  };
}
