/**
 * clarify_with_user — given an ambiguous prompt, return 1–3 targeted
 * clarifying questions instead of guessing. The complement to optimize_prompt:
 * when the analyzer's confidence is `low`, or the prompt is short and vague,
 * the engine asks the user *first* rather than emitting a confident-but-wrong
 * rewrite.
 *
 * The module never blocks. If the user explicitly opts in (force=true), or
 * the analyzer's confidence is medium/low, we ask the LLM to surface the
 * most ambiguous dimensions (audience, scope, format, length, constraints,
 * tone) and return targeted questions WITH suggested defaults — so the
 * caller can always proceed without a back-and-forth if they choose to.
 *
 * On the LLM side we ask for STRICT JSON to keep this deterministic for
 * the eval harness; on parse failure we degrade gracefully to a generic
 * fallback question rather than throwing.
 */

import { getLLMClient } from '../llm/client.js';
import { buildContextBundle } from '../context/bundle.js';
import type { Category } from '../config/categories.js';
import type { AnalysisSignal } from '../context/types.js';

export interface ClarifyInputs {
  prompt: string;
  category?: Category;
  cwd?: string;
  filePath?: string;
  fileLanguage?: string;
  fileExcerpt?: string;
  userLocale?: string;
  /**
   * When true, generate questions even if the analyzer is highly confident.
   * Default: false (skip when confidence === 'high' AND prompt looks complete).
   */
  force?: boolean;
  /** Cap on returned questions. Default 3, hard max 5. */
  maxQuestions?: number;
  /**
   * Override the LLM model for this clarify call. When omitted, uses LLM_MODEL
   * from env. Useful with per-stage routing in compose_prompt — e.g. run
   * clarify on a cheap model and optimize on a frontier model.
   */
  model?: string;
  /** Per-call cancellation signal (1.10.0) — aborts the clarify LLM call. */
  signal?: AbortSignal;
}

export interface ClarifyQuestion {
  question: string;
  reasoning: string;
  /**
   * A reasonable default the caller can use verbatim to keep moving.
   * Always populated; falls back to "Use your best judgment based on context."
   * if the LLM declined to suggest one.
   */
  suggestedAnswer: string;
  /**
   * Optional 2–4 multiple-choice alternatives. Useful for chat/UI clients
   * that want to render quick-pick buttons instead of free-form input.
   */
  options?: string[];
  /** Which ambiguous dimension this question addresses. */
  dimension: ClarifyDimension;
}

export type ClarifyDimension =
  | 'audience'
  | 'scope'
  | 'format'
  | 'length'
  | 'tone'
  | 'constraints'
  | 'goal'
  | 'platform'
  | 'other';

export interface ClarifyResult {
  clarificationNeeded: boolean;
  reason: string;
  questions: ClarifyQuestion[];
  analysis?: {
    category: AnalysisSignal['category'];
    intent: AnalysisSignal['intent'];
    confidence: AnalysisSignal['confidence'];
    recommendedMode: AnalysisSignal['recommendedMode'];
  };
  /** ms spent in this call (LLM + analysis). */
  latencyMs: number;
}

const DEFAULT_MAX_QUESTIONS = 3;
const HARD_CAP_QUESTIONS = 5;
const SHORT_PROMPT_CHARS = 60;

const DIMENSIONS: ClarifyDimension[] = [
  'audience', 'scope', 'format', 'length', 'tone', 'constraints', 'goal', 'platform', 'other',
];

interface RawQuestion {
  question?: string;
  reasoning?: string;
  suggested_answer?: string;
  suggestedAnswer?: string;
  options?: string[];
  dimension?: string;
}

export async function clarifyPrompt(inputs: ClarifyInputs): Promise<ClarifyResult> {
  const startedAt = Date.now();
  const maxQ = Math.min(Math.max(1, inputs.maxQuestions ?? DEFAULT_MAX_QUESTIONS), HARD_CAP_QUESTIONS);

  // Run the analyzer to get category/intent/confidence — this drives the
  // short-circuit decision. We don't need the rest of the bundle for the
  // happy path, but we DO want workspace rules in the LLM prompt so the
  // questions can be grounded ("which CLAUDE.md tone applies?", not
  // "what tone do you want?").
  const bundle = await buildContextBundle({
    prompt: inputs.prompt,
    category: inputs.category,
    cwd: inputs.cwd,
    filePath: inputs.filePath,
    fileLanguage: inputs.fileLanguage,
    fileExcerpt: inputs.fileExcerpt,
    userLocale: inputs.userLocale,
    skipIntentResolution: false,
  });

  const analysis = bundle.analysis;
  const looksComplete = inputs.prompt.trim().length >= SHORT_PROMPT_CHARS;

  // Short-circuit: high confidence AND prompt is non-trivially long.
  if (!inputs.force && analysis && analysis.confidence === 'high' && looksComplete) {
    return {
      clarificationNeeded: false,
      reason: `Analyzer is confident (intent=${analysis.intent}, category=${analysis.category}). No clarification required — pass this directly to optimize_prompt.`,
      questions: [],
      analysis: analysisSummary(analysis),
      latencyMs: Date.now() - startedAt,
    };
  }

  const llm = getLLMClient();
  const projectRules = bundle.project.rulesMarkdown;
  const frameworks = bundle.project.frameworks;

  const system = `You are ClarifyPrompt's clarification step. Given a user's draft prompt, return 1–${maxQ} TARGETED clarifying questions that surface the MOST AMBIGUOUS dimensions of the request before it gets optimized.

Return STRICT JSON. Schema:
{"questions": [
  {
    "question": "...",            // concrete; never "what do you mean?"
    "reasoning": "...",            // 1 sentence on WHY this matters here
    "suggested_answer": "...",     // a default the user can accept verbatim
    "options": ["a","b","c"],     // optional 2–4 quick-pick alternatives
    "dimension": "audience|scope|format|length|tone|constraints|goal|platform|other"
  }
]}

Rules:
- Ask about the dimensions most likely to change the OUTPUT, not nice-to-haves.
- Prefer one excellent question over three mediocre ones. Stop at ${maxQ}.
- "suggested_answer" must be plausible enough that accepting it produces a useful result.
- If the prompt mentions a specific platform or category, do NOT ask about it again.
- Lean on workspace context (project rules, frameworks) to pick relevant defaults.
- NO prose, NO markdown, NO commentary — JUST the JSON object.`;

  const userPrompt = buildUserPrompt({
    prompt: inputs.prompt,
    category: inputs.category,
    analysis,
    frameworks,
    projectRules,
    maxQ,
  });

  let questions: ClarifyQuestion[] = [];
  let parseNote: string | undefined;
  try {
    const result = await llm.simpleGenerate(system, userPrompt, {
      temperature: 0.3,
      maxTokens: 768,
      model: inputs.model,
      signal: inputs.signal,
    });
    const parsed = parseQuestions(result.content);
    if (!parsed.length) {
      parseNote = 'LLM returned no usable questions; falling back to a generic prompt.';
      questions = [genericFallbackQuestion(inputs.prompt)];
    } else {
      questions = parsed.slice(0, maxQ);
    }
  } catch (err) {
    parseNote = `LLM call failed: ${(err as Error).message}`;
    questions = [genericFallbackQuestion(inputs.prompt)];
  }

  const reasonParts: string[] = [];
  if (inputs.force) reasonParts.push('caller passed force=true');
  if (analysis) {
    reasonParts.push(`analyzer confidence=${analysis.confidence}`);
    if (analysis.intent === 'unknown') reasonParts.push('intent=unknown');
  }
  if (!looksComplete) reasonParts.push(`prompt is short (${inputs.prompt.trim().length} chars)`);
  if (parseNote) reasonParts.push(parseNote);
  const reason = reasonParts.length
    ? `Clarification recommended (${reasonParts.join('; ')}).`
    : 'Clarification recommended.';

  return {
    clarificationNeeded: true,
    reason,
    questions,
    analysis: analysis ? analysisSummary(analysis) : undefined,
    latencyMs: Date.now() - startedAt,
  };
}

function analysisSummary(a: AnalysisSignal) {
  return {
    category: a.category,
    intent: a.intent,
    confidence: a.confidence,
    recommendedMode: a.recommendedMode,
  };
}

function buildUserPrompt(args: {
  prompt: string;
  category?: Category;
  analysis?: AnalysisSignal;
  frameworks: string[];
  projectRules?: string;
  maxQ: number;
}): string {
  const lines: string[] = [];
  lines.push(`Draft prompt:\n"""${args.prompt}"""`);
  if (args.category) lines.push(`User category hint: ${args.category}`);
  if (args.analysis) {
    lines.push(`Analyzer says: category=${args.analysis.category}, intent=${args.analysis.intent}, confidence=${args.analysis.confidence}.`);
  }
  if (args.frameworks.length) {
    lines.push(`Workspace frameworks: ${args.frameworks.join(', ')}`);
  }
  if (args.projectRules) {
    lines.push(`Project rules excerpt:\n${args.projectRules.slice(0, 400)}`);
  }
  lines.push(`Return up to ${args.maxQ} clarifying questions as the JSON object described in the system instructions. JSON only.`);
  return lines.join('\n\n');
}

function parseQuestions(raw: string): ClarifyQuestion[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const parseOne = (text: string): RawQuestion[] => {
    try {
      const parsed = JSON.parse(text) as { questions?: RawQuestion[] };
      return Array.isArray(parsed.questions) ? parsed.questions : [];
    } catch {
      return [];
    }
  };

  let raws = parseOne(cleaned);
  if (!raws.length) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) raws = parseOne(m[0]);
  }

  const out: ClarifyQuestion[] = [];
  for (const r of raws) {
    const question = (r.question ?? '').trim();
    if (!question) continue;
    const suggested = (r.suggested_answer ?? r.suggestedAnswer ?? '').trim()
      || 'Use your best judgment based on context.';
    const dim = normalizeDimension(r.dimension);
    const reasoning = (r.reasoning ?? '').trim() || 'This dimension is ambiguous in the draft.';
    const options = Array.isArray(r.options)
      ? r.options.map(o => String(o).trim()).filter(Boolean).slice(0, 4)
      : undefined;
    out.push({
      question,
      reasoning,
      suggestedAnswer: suggested,
      options: options && options.length ? options : undefined,
      dimension: dim,
    });
  }
  return out;
}

function normalizeDimension(s: string | undefined): ClarifyDimension {
  if (!s) return 'other';
  const lower = s.toLowerCase().trim();
  if ((DIMENSIONS as string[]).includes(lower)) return lower as ClarifyDimension;
  return 'other';
}

function genericFallbackQuestion(prompt: string): ClarifyQuestion {
  return {
    question: prompt.length < 30
      ? 'What outcome do you want from this prompt — what does success look like?'
      : 'Who is the primary audience, and what should they do after reading the output?',
    reasoning: 'The draft is ambiguous on the goal/audience dimension; pinning this typically resolves most downstream ambiguity.',
    suggestedAnswer: 'Use your best judgment based on context.',
    dimension: 'goal',
  };
}
