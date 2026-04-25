/**
 * ground_prompt — explicit retrieval-augmented variant of optimize_prompt.
 *
 * The user passes a prompt PLUS one or more grounding sources (text bodies
 * with labels). The engine pins those sources at the very top of the
 * grounding context — above project rules, above pinned instructions —
 * and runs the normal optimize flow on top. The result includes a
 * `usedSources` array confirming which sources actually made it into the
 * curated grounding (so callers can verify nothing was dropped).
 *
 * Differences vs. optimize_prompt + userPinnedInstructions:
 *   - Multiple labeled sources, each tracked independently in trace + result.
 *   - Strict mode: zero sources → error, not silent degradation.
 *   - Source bodies are capped at 4000 chars each so a single huge paste
 *     can't blow the entire grounding budget.
 */

import { getOptimizationEngine } from '../optimization/engine.js';
import type { OptimizationResult, UserProvidedSource } from '../optimization/types.js';
import type { Category, Mode } from '../config/categories.js';

export interface GroundInputs {
  prompt: string;
  sources: UserProvidedSource[];
  category?: Category;
  platform?: string;
  mode?: Mode;
  modeExplicit?: boolean;
  cwd?: string;
  filePath?: string;
  fileLanguage?: string;
  fileExcerpt?: string;
  sessionId?: string;
  userLocale?: string;
  userPinnedInstructions?: string;
  enrichContext?: boolean;
  skipIntentResolution?: boolean;
  includeBundle?: boolean;
}

export interface GroundResult extends OptimizationResult {
  /**
   * The labels of the sources the curator actually selected (every source
   * is pinned, so this should normally equal the input — but if a source
   * was empty after trimming, it'll be omitted here).
   */
  usedSources: Array<{ index: number; label: string; kind?: string }>;
  /** Sources that came in but produced empty bodies after sanitization. */
  droppedSources: Array<{ index: number; label: string; reason: string }>;
}

const MAX_BODY_CHARS = 4000;

export async function groundPrompt(inputs: GroundInputs): Promise<GroundResult> {
  if (!Array.isArray(inputs.sources) || inputs.sources.length === 0) {
    throw new Error('ground_prompt requires at least one source. For automatic context curation, use optimize_prompt instead.');
  }

  const cleaned: UserProvidedSource[] = [];
  const dropped: GroundResult['droppedSources'] = [];

  inputs.sources.forEach((s, i) => {
    const label = (s.label ?? '').toString().trim() || `Source ${i + 1}`;
    const body = (s.body ?? '').toString().trim();
    if (!body) {
      dropped.push({ index: i, label, reason: 'empty body' });
      return;
    }
    cleaned.push({
      label,
      body: body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body,
      kind: s.kind,
    });
  });

  if (cleaned.length === 0) {
    throw new Error(`ground_prompt: all ${inputs.sources.length} provided source(s) were empty. Provide at least one non-empty body.`);
  }

  const engine = getOptimizationEngine();
  const result = await engine.optimize({
    prompt: inputs.prompt,
    category: inputs.category,
    platform: inputs.platform,
    mode: inputs.mode,
    modeExplicit: inputs.modeExplicit ?? (inputs.mode !== undefined),
    cwd: inputs.cwd,
    filePath: inputs.filePath,
    fileLanguage: inputs.fileLanguage,
    fileExcerpt: inputs.fileExcerpt,
    sessionId: inputs.sessionId,
    userLocale: inputs.userLocale,
    userPinnedInstructions: inputs.userPinnedInstructions,
    enrichContext: inputs.enrichContext,
    skipIntentResolution: inputs.skipIntentResolution,
    includeBundle: inputs.includeBundle,
    userProvidedSources: cleaned,
  });

  // Cross-check: which sources made it into the curated grounding? Each
  // source has id `user-source:N` matching its index in `cleaned`. Only
  // pinned sources can fail to appear (sanity check; pinned should always
  // land), so this is defensive — it tells the caller if the curator did
  // something unexpected.
  const sources = result.grounding?.sources ?? [];
  const usedSources: GroundResult['usedSources'] = [];
  cleaned.forEach((src, i) => {
    if (sources.includes(`user-source:${i}`)) {
      usedSources.push({ index: i, label: src.label, kind: src.kind });
    } else {
      dropped.push({ index: i, label: src.label, reason: 'not selected by curator (unexpected; report as bug)' });
    }
  });

  return {
    ...result,
    usedSources,
    droppedSources: dropped,
  };
}
