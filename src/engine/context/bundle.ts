import { getLLMClient } from '../llm/client.js';
import { collectFileSignal } from './fileSignals.js';
import { collectProjectSignal } from './projectSignals.js';
import { collectTargetModelSignal } from './targetModelSignals.js';
import { getSessionStore, generateSessionId } from './sessionSignals.js';
import { analyzePrompt } from './promptAnalyzer.js';
import type { ContextBundle, ContextBundleInputs, AnalysisSignal } from './types.js';

export async function buildContextBundle(inputs: ContextBundleInputs): Promise<ContextBundle> {
  const cwd = inputs.cwd || process.cwd();
  const sessionId = inputs.sessionId || generateSessionId();
  const sessionStore = getSessionStore();

  const [project, fileSig] = await Promise.all([
    collectProjectSignal(cwd),
    Promise.resolve(collectFileSignal({
      filePath: inputs.filePath,
      language: inputs.fileLanguage,
      excerpt: inputs.fileExcerpt,
    })),
  ]);

  const modelName = inputs.modelName || getLLMClient().getModelName();
  const targetModel = collectTargetModelSignal(modelName, inputs.modelProvider);

  const session = sessionStore.get(sessionId);

  let analysis: AnalysisSignal | undefined;
  if (!inputs.skipIntentResolution) {
    analysis = await analyzePrompt({
      prompt: inputs.prompt,
      userCategoryHint: inputs.category,
      filePath: inputs.filePath,
      fileLanguage: inputs.fileLanguage,
      projectRulesExcerpt: project.rulesMarkdown,
      frameworks: project.frameworks,
    });
  }

  return {
    schemaVersion: 1,
    user: {
      locale: inputs.userLocale,
      preferredMode: inputs.userPreferredMode,
      pinnedInstructions: inputs.userPinnedInstructions,
    },
    project,
    session,
    file: fileSig,
    targetModel,
    analysis,
    // Keep intent populated for code-path back-compat with anything
    // that reads bundle.intent directly.
    intent: analysis
      ? { intent: analysis.intent, confidence: analysis.confidence }
      : undefined,
  };
}

/**
 * Legacy helper preserved for callers that still render a single text block.
 * Pass C (groundingContext.ts) is the canonical way to assemble context.
 */
export function summarizeBundleForPrompt(bundle: ContextBundle): string {
  const parts: string[] = [];
  if (bundle.analysis && bundle.analysis.intent !== 'unknown') {
    parts.push(`Detected intent: ${bundle.analysis.intent} (confidence: ${bundle.analysis.confidence})`);
  }
  if (bundle.targetModel?.family) {
    parts.push(`Target model: ${bundle.targetModel.family} (${bundle.targetModel.model})`);
  }
  if (bundle.project.rulesMarkdown) {
    parts.push(`Project rules:\n${bundle.project.rulesMarkdown.slice(0, 2000)}`);
  }
  return parts.join('\n\n');
}

export * from './types.js';
