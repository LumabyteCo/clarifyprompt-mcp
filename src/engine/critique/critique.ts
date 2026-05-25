/**
 * critique_prompt — LLM-as-judge for a prompt.
 *
 * Scores a candidate prompt across N dimensions (clarity, specificity,
 * intent-alignment, format-fitness, length-appropriateness by default;
 * caller-customizable). Returns per-dimension 0–10 scores + rationales,
 * an overall score, a verdict (`accept`, `revise`, `reject`), and — when
 * the score is below `revise_threshold` — an improved rewrite the caller
 * can use as a drop-in replacement.
 *
 * Use cases:
 *   - Pre-flight: "is this prompt good enough to send to the expensive model?"
 *   - Postmortem: "this output was bad — was the prompt the cause?"
 *   - A/B: pick the best of N candidate optimizations.
 *
 * The judge runs at `temperature: 0.1` for stable scores. The `improved`
 * pass runs at the intent-derived temperature so the rewrite still feels
 * appropriate for the category (creative bumps temp; data-extract drops it).
 */

import { getLLMClient } from '../llm/client.js';
import { buildContextBundle } from '../context/bundle.js';
import { getPromptShape } from '../optimization/groundingContext.js';
import type { Category } from '../config/categories.js';
import type { AnalysisSignal, Intent } from '../context/types.js';

export interface CritiqueCriterion {
  name: string;
  description: string;
}

export interface CritiqueInputs {
  prompt: string;
  /**
   * If `prompt` is an optimized version, the original it came from.
   * The judge uses this for the intent-alignment dimension ("did the
   * rewrite preserve the user's actual ask?").
   */
  originalPrompt?: string;
  category?: Category;
  cwd?: string;
  filePath?: string;
  fileLanguage?: string;
  fileExcerpt?: string;
  userLocale?: string;
  /** Override the default 5 criteria. Leave undefined for the standard set. */
  criteria?: CritiqueCriterion[];
  /**
   * Overall score below this triggers the "improved" rewrite pass.
   * Default 7.0 / 10. Set to 0 to skip the rewrite always; 10 to always run it.
   */
  reviseThreshold?: number;
  /** Skip the "improved" rewrite pass even if the score is below threshold. */
  skipRewrite?: boolean;
  /**
   * Override the LLM model for the judge AND rewrite calls. When omitted,
   * uses LLM_MODEL from env. Per-stage routing in compose_prompt sets this.
   */
  model?: string;
}

export interface CritiqueDimensionResult {
  name: string;
  score: number;             // 0–10
  rationale: string;
  suggestions: string[];
}

export type CritiqueVerdict = 'accept' | 'revise' | 'reject';

export interface CritiqueResult {
  overallScore: number;
  verdict: CritiqueVerdict;
  summary: string;
  dimensions: CritiqueDimensionResult[];
  improvedPrompt?: string;
  /** When improvedPrompt is present, an explicit list of what the rewrite changed. */
  improvements?: string[];
  /** ms spent in this critique (analysis + judge LLM + optional rewrite LLM). */
  latencyMs: number;
  judgeModel: string;
  analysis?: {
    category: AnalysisSignal['category'];
    intent: AnalysisSignal['intent'];
    confidence: AnalysisSignal['confidence'];
  };
}

const DEFAULT_CRITERIA: CritiqueCriterion[] = [
  { name: 'clarity',                description: 'Is the ask unambiguous? Could two readers interpret it the same way?' },
  { name: 'specificity',            description: 'Does it pin down concrete details (audience, format, scope, constraints) instead of leaving them implicit?' },
  { name: 'intent_alignment',       description: 'Does the prompt match what the user actually wants to achieve? (If an originalPrompt is provided, judge whether the rewrite preserved its intent.)' },
  { name: 'format_fitness',         description: 'Is the requested output format appropriate for the platform/category and downstream use?' },
  { name: 'length_appropriateness', description: 'Is the prompt the right length — neither vague-and-too-short nor padded-and-too-long?' },
];

const DEFAULT_REVISE_THRESHOLD = 7.0;

interface RawDim {
  name?: string;
  score?: number | string;
  rationale?: string;
  suggestions?: string[];
}

interface RawJudge {
  dimensions?: RawDim[];
  overall?: number | string;
  summary?: string;
}

interface RawRewrite {
  improved?: string;
  improvements?: string[];
}

export async function critiquePrompt(inputs: CritiqueInputs): Promise<CritiqueResult> {
  const startedAt = Date.now();
  const llm = getLLMClient();
  // Reflect the per-call override if set, else fall back to the env default.
  const judgeModel = inputs.model ?? llm.getModelName();
  const reviseThreshold = inputs.reviseThreshold ?? DEFAULT_REVISE_THRESHOLD;
  const criteria = (inputs.criteria && inputs.criteria.length) ? inputs.criteria : DEFAULT_CRITERIA;

  // Pull intent so the rewrite (if any) gets an appropriate temperature.
  const bundle = await buildContextBundle({
    prompt: inputs.originalPrompt ?? inputs.prompt,
    category: inputs.category,
    cwd: inputs.cwd,
    filePath: inputs.filePath,
    fileLanguage: inputs.fileLanguage,
    fileExcerpt: inputs.fileExcerpt,
    userLocale: inputs.userLocale,
    skipIntentResolution: false,
  });
  const analysis = bundle.analysis;
  const intent: Intent | undefined = analysis?.intent;

  // ── 1. judge pass ──────────────────────────────────────────────
  const judgeSystem = `You are ClarifyPrompt's prompt-quality judge. Score a candidate prompt across the listed criteria. Output STRICT JSON.

Schema:
{"dimensions":[
  {"name":"<criterion name>","score":<0-10 integer>,"rationale":"<one sentence>","suggestions":["<one fix per item>"]}
],"overall":<0-10 number>,"summary":"<one sentence verdict>"}

Rules:
- Use only the criteria listed in the user message. Do not invent dimensions.
- Score integers 0–10. 0 = absent/broken, 5 = passable, 8 = strong, 10 = excellent and fully complete.
- Each rationale is ONE sentence. No prose outside JSON. No markdown fences.
- Suggestions are concrete edits, not platitudes. Up to 3 per dimension.
- "overall" = your judgment of the prompt as a whole, not a literal mean.`;

  const criteriaList = criteria
    .map((c, i) => `${i + 1}. ${c.name} — ${c.description}`)
    .join('\n');

  const judgeUser = [
    `Criteria:\n${criteriaList}`,
    inputs.originalPrompt
      ? `Original prompt (for intent_alignment reference):\n"""\n${inputs.originalPrompt}\n"""`
      : null,
    `Candidate prompt to score:\n"""\n${inputs.prompt}\n"""`,
    analysis
      ? `Detected category=${analysis.category}, intent=${analysis.intent}, confidence=${analysis.confidence}.`
      : null,
    'Score every criterion. Reply with the JSON object only.',
  ].filter(Boolean).join('\n\n');

  let dimensions: CritiqueDimensionResult[] = [];
  let overallScore = 0;
  let summary = '';
  try {
    const judgeRes = await llm.simpleGenerate(judgeSystem, judgeUser, {
      temperature: 0.1,
      maxTokens: 1024,
      model: inputs.model,
    });
    const parsed = parseJudge(judgeRes.content);
    dimensions = normalizeDimensions(parsed.dimensions, criteria);
    overallScore = clampScore(parsed.overall);
    summary = (parsed.summary ?? '').toString().trim() || verdictSummaryFallback(overallScore);
    // Sanity-check overall against per-dim mean — if the judge cheated and
    // the gap is huge, prefer the per-dim mean (judges sometimes inflate the
    // overall after lukewarm dim scores).
    if (dimensions.length) {
      const dimMean = dimensions.reduce((a, d) => a + d.score, 0) / dimensions.length;
      if (Math.abs(dimMean - overallScore) > 2.5) overallScore = clampScore(dimMean);
    }
  } catch (err) {
    return {
      overallScore: 0,
      verdict: 'reject',
      summary: `Judge call failed: ${(err as Error).message}`,
      dimensions: criteria.map((c) => ({ name: c.name, score: 0, rationale: 'judge unavailable', suggestions: [] })),
      latencyMs: Date.now() - startedAt,
      judgeModel,
      analysis: analysis ? analysisSummary(analysis) : undefined,
    };
  }

  const verdict: CritiqueVerdict =
    overallScore >= 8.5 ? 'accept' :
    overallScore >= reviseThreshold ? 'accept' :
    overallScore >= 4 ? 'revise' :
    'reject';

  // ── 2. optional rewrite pass ───────────────────────────────────
  let improvedPrompt: string | undefined;
  let improvements: string[] | undefined;

  if (!inputs.skipRewrite && verdict !== 'accept') {
    const rewriteShape = getPromptShape(bundle, intent);
    const rewriteSystem = `You are ClarifyPrompt's prompt-rewrite step. Apply the judge's critique to produce an improved version of the prompt that addresses every flagged issue.

Output STRICT JSON:
{"improved":"<the rewritten prompt>","improvements":["<change 1>","<change 2>",...]}

Rules:
- Preserve the user's underlying intent. Do not change WHAT they're asking for.
- Apply EVERY suggestion from dimensions whose score is below 7.
- Keep length appropriate to the category — don't pad.
- "improvements" is a short list of human-readable edits actually made.
- No prose, no markdown fences, JUST the JSON object.`;

    const rewriteUser = [
      inputs.originalPrompt
        ? `Original user request:\n"""\n${inputs.originalPrompt}\n"""`
        : null,
      `Candidate prompt:\n"""\n${inputs.prompt}\n"""`,
      `Judge feedback:\n${dimensions.map((d) => `- ${d.name} (${d.score}/10): ${d.rationale}${d.suggestions.length ? '\n    suggestions: ' + d.suggestions.join('; ') : ''}`).join('\n')}`,
      `Overall: ${overallScore.toFixed(1)}/10. Produce the rewrite as JSON.`,
    ].filter(Boolean).join('\n\n');

    try {
      const rewriteRes = await llm.simpleGenerate(rewriteSystem, rewriteUser, {
        temperature: rewriteShape.temperature,
        maxTokens: Math.max(rewriteShape.maxTokens, 1024),
        model: inputs.model,
      });
      const rw = parseRewrite(rewriteRes.content);
      const candidate = (rw.improved ?? '').toString().trim();
      // Reject the rewrite if it came back empty or essentially unchanged.
      if (candidate && candidate !== inputs.prompt.trim()) {
        improvedPrompt = candidate;
        improvements = Array.isArray(rw.improvements)
          ? rw.improvements.map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
          : undefined;
      }
    } catch {
      // Non-fatal: caller still gets the score + verdict.
    }
  }

  return {
    overallScore: round1(overallScore),
    verdict,
    summary,
    dimensions,
    improvedPrompt,
    improvements,
    latencyMs: Date.now() - startedAt,
    judgeModel,
    analysis: analysis ? analysisSummary(analysis) : undefined,
  };
}

function analysisSummary(a: AnalysisSignal) {
  return { category: a.category, intent: a.intent, confidence: a.confidence };
}

function parseJudge(raw: string): RawJudge {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as RawJudge;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]) as RawJudge; } catch { /* fallthrough */ }
    }
    return {};
  }
}

function parseRewrite(raw: string): RawRewrite {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as RawRewrite;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]) as RawRewrite; } catch { /* fallthrough */ }
    }
    return {};
  }
}

function normalizeDimensions(raws: RawDim[] | undefined, criteria: CritiqueCriterion[]): CritiqueDimensionResult[] {
  const byName = new Map<string, RawDim>();
  for (const r of raws ?? []) {
    if (r?.name) byName.set(String(r.name).toLowerCase().trim(), r);
  }
  // Always emit one entry per requested criterion, even if the judge dropped one.
  return criteria.map((c) => {
    const r = byName.get(c.name.toLowerCase());
    return {
      name: c.name,
      score: clampScore(r?.score),
      rationale: ((r?.rationale ?? '') as string).toString().trim() || 'No rationale provided.',
      suggestions: Array.isArray(r?.suggestions)
        ? r!.suggestions!.map((s) => String(s).trim()).filter(Boolean).slice(0, 3)
        : [],
    };
  });
}

function clampScore(x: unknown): number {
  const n = typeof x === 'string' ? Number(x) : (x as number);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function verdictSummaryFallback(score: number): string {
  if (score >= 8.5) return 'Strong prompt — ship as-is.';
  if (score >= 7.0) return 'Acceptable — minor polish optional.';
  if (score >= 4.0) return 'Needs revision before sending.';
  return 'Reject — substantial rewrite required.';
}
