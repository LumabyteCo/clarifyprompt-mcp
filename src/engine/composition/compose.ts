/**
 * compose_prompt — the canonical happy-path pipeline.
 *
 *   ┌──────────────┐   ┌──────────────────────┐   ┌──────────────┐
 *   │ pre_clarify  │ → │ ground_prompt OR     │ → │ post_critique│
 *   │ (optional)   │   │ optimize_prompt      │   │ (optional)   │
 *   └──────────────┘   └──────────────────────┘   └──────────────┘
 *
 * One MCP call gets you the entire flow. Designed so callers can pipeline
 * the four tools without orchestrating five round-trips themselves, and so
 * the canonical "clarify → optimize → critique" pattern is discoverable
 * straight from the tool list.
 *
 * Short-circuit semantics:
 *   - pre_clarify=true AND clarify returns questions → STOP. Return only
 *     the questions. Caller answers, re-calls with pre_clarify=false.
 *   - sources provided → goes through ground_prompt (strict mode).
 *   - sources empty/absent → goes through optimize_prompt (auto-curated).
 *   - post_critique=true → runs critique against the optimized prompt.
 *   - auto_revise=true AND critique verdict !== 'accept' AND there's an
 *     improvedPrompt → finalPrompt is the rewritten version, not the raw
 *     optimization. The caller uses finalPrompt regardless.
 *
 * The output also includes a `stages` audit so the caller can see exactly
 * what ran, in what order, and how long each stage took.
 */

import { clarifyPrompt, type ClarifyResult } from '../clarification/clarify.js';
import { groundPrompt, type GroundResult } from '../grounding/ground.js';
import { critiquePrompt, type CritiqueResult, type CritiqueCriterion } from '../critique/critique.js';
import { getOptimizationEngine } from '../optimization/engine.js';
import type { OptimizationResult, UserProvidedSource } from '../optimization/types.js';
import type { Category, Mode } from '../config/categories.js';

export interface ComposeInputs {
  prompt: string;

  // ── Pre-stage: clarify ────────────────────────────────────────
  /**
   * 'auto'   — default: run clarify ONLY if the analyzer's confidence is
   *            low or the prompt is short. If clarification is needed,
   *            stop and return the questions (caller must answer + re-call).
   * 'always' — always run clarify; stop if questions surface.
   * 'never'  — skip the clarify pre-stage entirely.
   */
  preClarify?: 'auto' | 'always' | 'never';
  /** Cap on clarify questions (passed through). */
  maxQuestions?: number;

  // ── Core: ground_prompt OR optimize_prompt ────────────────────
  /** When non-empty, the chain takes the ground_prompt branch (strict). */
  sources?: UserProvidedSource[];

  // ── Post-stage: critique ──────────────────────────────────────
  /** Run the critique judge against the optimized output. */
  postCritique?: boolean;
  /** Score threshold below which a rewrite pass is attempted. */
  reviseThreshold?: number;
  /** Override the default critique criteria. */
  critiqueCriteria?: CritiqueCriterion[];
  /**
   * When true: if critique produced an improvedPrompt and verdict !== 'accept',
   * `finalPrompt` becomes the improved version instead of the raw optimization.
   */
  autoRevise?: boolean;

  // ── Passthroughs to optimize/ground ──────────────────────────
  category?: Category;
  platform?: string;
  mode?: Mode;
  modeExplicit?: boolean;
  enrichContext?: boolean;
  sessionId?: string;
  filePath?: string;
  fileLanguage?: string;
  fileExcerpt?: string;
  cwd?: string;
  userLocale?: string;
  userPinnedInstructions?: string;
  skipIntentResolution?: boolean;
  includeBundle?: boolean;
}

export interface ComposeStage {
  name: 'clarify' | 'ground' | 'optimize' | 'critique' | 'revise';
  ranAt: string;
  durationMs: number;
  summary: string;
}

export interface ComposeResult {
  stages: ComposeStage[];
  /**
   * The prompt the caller should send downstream. Equals
   * `optimization.optimizedPrompt` unless auto_revise replaced it with
   * `critique.improvedPrompt`.
   */
  finalPrompt: string;
  /**
   * Set only when the chain stopped early because clarification was needed.
   * The caller MUST answer the questions and re-call (with preClarify='never'
   * or by editing the prompt to incorporate the answers).
   */
  clarificationRequired?: boolean;
  /** clarify result. Always present when clarify ran. */
  clarification?: ClarifyResult;
  /** ground result. Present iff the chain took the ground branch. */
  grounding?: GroundResult;
  /** optimize result. Present iff the chain took the optimize branch. */
  optimization?: OptimizationResult;
  /** critique result. Present iff post_critique=true. */
  critique?: CritiqueResult;
  /** Whether finalPrompt was replaced by critique.improvedPrompt. */
  revised?: boolean;
}

export async function composePrompt(inputs: ComposeInputs): Promise<ComposeResult> {
  const stages: ComposeStage[] = [];

  const recordStage = (name: ComposeStage['name'], started: number, summary: string) => {
    stages.push({
      name,
      ranAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      summary,
    });
  };

  // ── 1. clarify (optional) ──────────────────────────────────────
  const clarifyMode = inputs.preClarify ?? 'auto';
  let clarification: ClarifyResult | undefined;

  if (clarifyMode !== 'never') {
    const startedAt = Date.now();
    clarification = await clarifyPrompt({
      prompt: inputs.prompt,
      category: inputs.category,
      cwd: inputs.cwd,
      filePath: inputs.filePath,
      fileLanguage: inputs.fileLanguage,
      fileExcerpt: inputs.fileExcerpt,
      userLocale: inputs.userLocale,
      maxQuestions: inputs.maxQuestions,
      force: clarifyMode === 'always',
    });
    recordStage(
      'clarify',
      startedAt,
      clarification.clarificationNeeded
        ? `${clarification.questions.length} question(s) surfaced`
        : 'no clarification needed (short-circuit)',
    );

    // Hard stop when questions came back. Caller answers + re-calls.
    if (clarification.clarificationNeeded && clarification.questions.length > 0) {
      return {
        stages,
        finalPrompt: inputs.prompt, // unchanged; caller hasn't optimized yet
        clarificationRequired: true,
        clarification,
      };
    }
  }

  // ── 2. ground OR optimize (always) ─────────────────────────────
  let optimization: OptimizationResult | undefined;
  let grounding: GroundResult | undefined;
  let optimizedText: string;

  const useGround = Array.isArray(inputs.sources) && inputs.sources.length > 0;

  if (useGround) {
    const startedAt = Date.now();
    grounding = await groundPrompt({
      prompt: inputs.prompt,
      sources: inputs.sources!,
      category: inputs.category,
      platform: inputs.platform,
      mode: inputs.mode,
      modeExplicit: inputs.modeExplicit,
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
    });
    optimizedText = grounding.optimizedPrompt;
    recordStage('ground', startedAt, `${grounding.usedSources.length} source(s) pinned, ${grounding.droppedSources.length} dropped`);
  } else {
    const startedAt = Date.now();
    optimization = await getOptimizationEngine().optimize({
      prompt: inputs.prompt,
      category: inputs.category,
      platform: inputs.platform,
      mode: inputs.mode,
      modeExplicit: inputs.modeExplicit,
      enrichContext: inputs.enrichContext,
      sessionId: inputs.sessionId,
      filePath: inputs.filePath,
      fileLanguage: inputs.fileLanguage,
      fileExcerpt: inputs.fileExcerpt,
      cwd: inputs.cwd,
      userLocale: inputs.userLocale,
      userPinnedInstructions: inputs.userPinnedInstructions,
      includeBundle: inputs.includeBundle,
      skipIntentResolution: inputs.skipIntentResolution,
    });
    optimizedText = optimization.optimizedPrompt;
    recordStage('optimize', startedAt, `${optimization.grounding?.sources.length ?? 0} grounding source(s) selected`);
  }

  // ── 3. critique (optional) ─────────────────────────────────────
  let critique: CritiqueResult | undefined;
  let revised = false;
  let finalPrompt = optimizedText;

  if (inputs.postCritique) {
    const startedAt = Date.now();
    critique = await critiquePrompt({
      prompt: optimizedText,
      originalPrompt: inputs.prompt,
      category: inputs.category,
      cwd: inputs.cwd,
      filePath: inputs.filePath,
      fileLanguage: inputs.fileLanguage,
      fileExcerpt: inputs.fileExcerpt,
      userLocale: inputs.userLocale,
      criteria: inputs.critiqueCriteria,
      reviseThreshold: inputs.reviseThreshold,
      // critique runs its own rewrite; auto_revise just decides whether
      // to surface that rewrite as the final prompt.
      skipRewrite: !inputs.autoRevise,
    });
    recordStage('critique', startedAt, `verdict=${critique.verdict}, score=${critique.overallScore}`);

    if (inputs.autoRevise && critique.verdict !== 'accept' && critique.improvedPrompt) {
      const startedAt2 = Date.now();
      finalPrompt = critique.improvedPrompt;
      revised = true;
      recordStage('revise', startedAt2, `replaced finalPrompt with critique.improvedPrompt (verdict=${critique.verdict})`);
    }
  }

  return {
    stages,
    finalPrompt,
    clarification,
    grounding,
    optimization,
    critique,
    revised: revised || undefined,
  };
}
