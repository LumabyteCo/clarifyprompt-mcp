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
  /**
   * Max revise-loop iterations. Each iteration re-runs ground/optimize + critique
   * on the previously-improved prompt. Stops at verdict=accept, no improvedPrompt
   * to feed back, or this cap. Default 1 (single-shot, current behavior). Hard
   * max 5 to prevent cost runaways on pathological prompts.
   *
   * Only meaningful with `postCritique: true` AND `autoRevise: true`. Without
   * autoRevise there's no rewritten prompt to feed back; the loop short-circuits
   * after iteration 1.
   */
  maxIterations?: number;

  // ── Per-stage model routing (M1) ──────────────────────────────
  /** Override the LLM model for the clarify pre-stage. Default: env LLM_MODEL. */
  clarifyModel?: string;
  /** Override the LLM model for the optimize/ground core stage. */
  optimizeModel?: string;
  /** Override the LLM model for the critique judge + rewrite. */
  critiqueModel?: string;

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

  // ── Cancellation + progress (1.10.0) ──────────────────────────
  /**
   * Cancellation signal. Propagated to every stage's LLM call so a client
   * cancel aborts work in flight; also checked between iterations so a long
   * revise loop stops promptly.
   */
  signal?: AbortSignal;
  /**
   * Progress callback, invoked at the start of each stage. The MCP handler maps
   * these to `notifications/progress` so hosts can show a live status on a long
   * compose. Pure-data; safe to ignore.
   */
  onProgress?: (update: ComposeProgress) => void;
}

export interface ComposeProgress {
  stage: ComposeStage['name'] | 'analyze';
  iteration: number;
  maxIterations: number;
  message: string;
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
  /**
   * How many optimize+critique iterations ran. Equals 1 for the default
   * single-shot flow; only >1 when maxIterations > 1 AND the engine actually
   * fed the rewrite back through another iteration.
   */
  iterations?: number;
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

  const maxIter = Math.max(1, Math.min(5, inputs.maxIterations ?? 1));
  let iterations = 0;
  const emit = (stage: ComposeProgress['stage'], message: string) =>
    inputs.onProgress?.({ stage, iteration: iterations, maxIterations: maxIter, message });
  const checkAbort = () => {
    if (inputs.signal?.aborted) throw new Error('compose_prompt cancelled by client');
  };

  // ── 1. clarify (optional) ──────────────────────────────────────
  const clarifyMode = inputs.preClarify ?? 'auto';
  let clarification: ClarifyResult | undefined;

  if (clarifyMode !== 'never') {
    const startedAt = Date.now();
    checkAbort();
    emit('clarify', 'checking whether clarification is needed');
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
      model: inputs.clarifyModel,
      signal: inputs.signal,
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

  // ── 2-4. loop: ground OR optimize → critique → revise ─────────
  // When inputs.maxIterations > 1 AND auto_revise is on AND the critique
  // didn't accept, we feed the rewritten prompt back through optimize+critique
  // for another pass. Stops at: verdict=accept, no improvedPrompt to feed
  // back, or max iterations reached.
  //
  // Clarify only runs once (at the top), since the question "what does the
  // user want?" doesn't get re-asked on a rewritten prompt.
  const useGround = Array.isArray(inputs.sources) && inputs.sources.length > 0;

  let optimization: OptimizationResult | undefined;
  let grounding: GroundResult | undefined;
  let critique: CritiqueResult | undefined;
  let optimizedText: string = inputs.prompt; // safety default
  let currentPrompt = inputs.prompt;
  let finalPrompt = inputs.prompt;
  let revised = false;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations++;
    checkAbort();
    const iterTag = maxIter > 1 ? ` [iter ${iter + 1}/${maxIter}]` : '';

    // ── ground OR optimize ──
    if (useGround) {
      const startedAt = Date.now();
      emit('ground', `grounding against ${inputs.sources!.length} source(s)${iterTag}`);
      grounding = await groundPrompt({
        prompt: currentPrompt,
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
        model: inputs.optimizeModel,
        signal: inputs.signal,
      });
      optimizedText = grounding.optimizedPrompt;
      recordStage('ground', startedAt, `${grounding.usedSources.length} source(s) pinned, ${grounding.droppedSources.length} dropped${iterTag}`);
    } else {
      const startedAt = Date.now();
      emit('optimize', `optimizing prompt${iterTag}`);
      optimization = await getOptimizationEngine().optimize({
        prompt: currentPrompt,
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
        model: inputs.optimizeModel,
        signal: inputs.signal,
      });
      optimizedText = optimization.optimizedPrompt;
      recordStage('optimize', startedAt, `${optimization.grounding?.sources.length ?? 0} grounding source(s) selected${iterTag}`);
    }

    // Default finalPrompt to whatever the latest optimize/ground produced.
    finalPrompt = optimizedText;

    // The engine's graceful-degradation try/catch swallows an AbortError into a
    // fallback (original prompt) rather than re-throwing. Re-assert cancellation
    // here so a cancel during optimize/ground halts the chain cleanly instead of
    // returning a throwaway result.
    checkAbort();

    // ── critique (optional) ──
    if (!inputs.postCritique) break; // no critique → no revise → no loop value

    const cStart = Date.now();
    checkAbort();
    emit('critique', `critiquing the optimized prompt${iterTag}`);
    critique = await critiquePrompt({
      // Always compare the LATEST optimized output, but reference the
      // ORIGINAL user prompt for intent_alignment so paraphrasing across
      // iterations doesn't make the engine forget what was asked.
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
      skipRewrite: !inputs.autoRevise,
      model: inputs.critiqueModel,
      signal: inputs.signal,
    });
    recordStage('critique', cStart, `verdict=${critique.verdict}, score=${critique.overallScore}${iterTag}`);

    // ── revise (optional) ──
    if (inputs.autoRevise && critique.verdict !== 'accept' && critique.improvedPrompt) {
      const rStart = Date.now();
      finalPrompt = critique.improvedPrompt;
      revised = true;
      recordStage('revise', rStart, `replaced finalPrompt with critique.improvedPrompt (verdict=${critique.verdict})${iterTag}`);

      // Loop continuation: feed the rewrite back through optimize+critique
      // on the next iteration. Bail early if we're already at the cap.
      if (iter + 1 < maxIter) {
        currentPrompt = critique.improvedPrompt;
        continue;
      }
    }

    // Either accepted, no rewrite available, or autoRevise off → done.
    break;
  }

  return {
    stages,
    finalPrompt,
    clarification,
    grounding,
    optimization,
    critique,
    revised: revised || undefined,
    iterations,
  };
}
