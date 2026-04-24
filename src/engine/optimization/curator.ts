/**
 * The Context Curator. Turns a flat pile of candidate grounding sources
 * into the smallest set of high-signal tokens that fit the target model's
 * remaining window.
 *
 * Principle (from Anthropic's context-engineering framing): every token
 * in the window is a design decision. The curator makes those decisions
 * *explicit* — budget, utility, selected, rejected — so users can inspect
 * why any given optimization looked the way it did.
 */

import type { ContextBundle, Intent } from '../context/types.js';
import type { MemoryMatch } from '../memory/types.js';

/** Approximate token count. 4 chars/token is the industry default for English text. */
export function approxTokens(s: string): number {
  return Math.max(0, Math.ceil(s.length / 4));
}

/**
 * Token-budget envelope. Derived from the target model's context window and
 * the configured output budget (from PromptShape). Does NOT include the
 * system prompt itself — that's accounted for separately.
 */
export interface TokenBudget {
  /** Total available for the user-prompt payload (grounding + original prompt + meta). */
  total: number;
  /** Reserved slack for original prompt + boilerplate; curator can't touch this. */
  reservedForPrompt: number;
  /** What the curator has to work with after reserving the prompt. */
  availableForGrounding: number;
}

export function computeBudget(args: {
  contextWindow: number;
  systemPromptTokens: number;
  outputTokens: number;
  originalPromptTokens: number;
  slackTokens?: number;
}): TokenBudget {
  const slack = args.slackTokens ?? 512;
  const total = Math.max(
    0,
    args.contextWindow - args.systemPromptTokens - args.outputTokens - slack,
  );
  const reservedForPrompt = args.originalPromptTokens + 256; // meta / formatting
  return {
    total,
    reservedForPrompt,
    availableForGrounding: Math.max(0, total - reservedForPrompt),
  };
}

/** Candidate grounding section — the curator's input. */
export interface Candidate {
  source: string;            // stable id: "user-pinned", "project-rules", "memory:fact:42", "pack:nextjs#intro"
  label: string;             // human-facing heading
  body: string;              // the actual content
  tokens: number;            // precomputed approx tokens
  baseUtility: number;       // 0..1 — how useful this is, assuming it fits
  pinned?: boolean;          // if true, MUST be included regardless of budget
  freshnessMs?: number;      // age of the source in ms; used as a decay factor
  intentMatch?: number;      // 0..1 — how well this matches the resolved intent
  authority?: number;        // 0..1 — source authority (user-pinned=1, built-in=0.3)
}

export interface CuratedSection {
  source: string;
  label: string;
  body: string;
  tokens: number;
  utility: number;
  pinned: boolean;
}

export interface RejectionReason {
  source: string;
  tokens: number;
  utility: number;
  reason: 'budget-exhausted' | 'zero-utility' | 'duplicate' | 'stale';
}

export interface CurationResult {
  /** Ready-to-inject Grounding Context block. Empty string if nothing selected. */
  block: string;
  /** What the curator kept, in order. */
  selected: CuratedSection[];
  /** What the curator cut, with reasons. */
  rejected: RejectionReason[];
  /** Budget snapshot. */
  budget: TokenBudget;
  /** Total tokens used by selected sections. */
  used: number;
  /** Ordered list of source-id strings for quick trace consumption. */
  sourceIds: string[];
}

/**
 * Score a candidate. All factors are normalized 0..1; final utility is a
 * weighted combination. This is the *only* ranking function — everything
 * else (retrieval, composition) defers to it.
 */
export function scoreCandidate(c: Candidate, nowMs = Date.now()): number {
  if (c.pinned) return 1.0;

  const base = clamp01(c.baseUtility);
  const intent = c.intentMatch !== undefined ? clamp01(c.intentMatch) : 0.5;
  const authority = c.authority !== undefined ? clamp01(c.authority) : 0.5;
  const freshness = c.freshnessMs !== undefined ? freshnessScore(c.freshnessMs, nowMs) : 0.8;

  // Weights: base utility dominates, but intent-match and authority matter.
  // Freshness is a gentle multiplier — a stale source isn't zero-value, just discounted.
  const weighted = (base * 0.5) + (intent * 0.25) + (authority * 0.15) + (freshness * 0.10);
  return clamp01(weighted);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** Exponential decay. 0 ms old → 1.0, 7 days → ~0.5, 30 days → ~0.1. */
function freshnessScore(ageMs: number, nowMs: number): number {
  void nowMs;
  if (ageMs < 0) return 1;
  const days = ageMs / (1000 * 60 * 60 * 24);
  return Math.exp(-days / 10); // half-life ~= 7 days
}

/**
 * The core curation function. Hard-pin constraints first, then greedy
 * knapsack by utility-per-token. Duplicate sources are suppressed.
 */
export function curate(candidates: Candidate[], budget: TokenBudget): CurationResult {
  const rejected: RejectionReason[] = [];
  const selected: CuratedSection[] = [];
  let used = 0;
  const seenSources = new Set<string>();

  // Phase 1: dedupe (keep first occurrence of each source id)
  const deduped: Candidate[] = [];
  for (const c of candidates) {
    if (seenSources.has(c.source)) {
      rejected.push({ source: c.source, tokens: c.tokens, utility: 0, reason: 'duplicate' });
      continue;
    }
    seenSources.add(c.source);
    deduped.push(c);
  }

  // Phase 2: place pinned candidates first. Pinned can overflow budget if
  // they must (rare; only happens when user pinned instructions are huge).
  const pinned = deduped.filter(c => c.pinned);
  const flexible = deduped.filter(c => !c.pinned);

  for (const c of pinned) {
    selected.push({
      source: c.source, label: c.label, body: c.body,
      tokens: c.tokens, utility: 1.0, pinned: true,
    });
    used += c.tokens;
  }

  // Phase 3: score flexible candidates
  const now = Date.now();
  const scored = flexible.map(c => ({ c, score: scoreCandidate(c, now) }))
    // Compare by utility-per-token so a short high-utility candidate wins
    // over a long medium-utility one.
    .sort((a, b) => (b.score / Math.max(1, b.c.tokens)) - (a.score / Math.max(1, a.c.tokens)));

  // Phase 4: greedy fill
  for (const { c, score } of scored) {
    if (score <= 0) {
      rejected.push({ source: c.source, tokens: c.tokens, utility: score, reason: 'zero-utility' });
      continue;
    }
    if (used + c.tokens > budget.availableForGrounding) {
      rejected.push({ source: c.source, tokens: c.tokens, utility: score, reason: 'budget-exhausted' });
      continue;
    }
    selected.push({
      source: c.source, label: c.label, body: c.body,
      tokens: c.tokens, utility: score, pinned: false,
    });
    used += c.tokens;
  }

  // Phase 5: render the final block
  const block = selected.length
    ? `\nGrounding Context (curated — ${selected.length} sections, ${used} tokens of ${budget.availableForGrounding} budget):\n` +
      selected.map(s => `## ${s.label}\n${s.body}`).join('\n\n') + '\n'
    : '';

  return {
    block,
    selected,
    rejected,
    budget,
    used,
    sourceIds: selected.map(s => s.source),
  };
}

// ---------------- candidate construction helpers ----------------

/**
 * Build curator candidates from a ContextBundle + web-search + platform
 * signals + memory matches. Keeps the candidate-construction logic in one
 * place so the engine wiring stays thin.
 */
export function buildCandidates(args: {
  bundle?: ContextBundle;
  webSearchContext?: string;
  webSearchSources?: string[];
  platformInstructions?: string;
  platformHints?: string[];
  acceptedExamples?: Array<{ originalPrompt: string; optimizedPrompt: string; ts: number }>;
  memoryMatches?: MemoryMatch[];
  intent?: Intent;
}): Candidate[] {
  const now = Date.now();
  const candidates: Candidate[] = [];
  const bundle = args.bundle;

  if (bundle?.user.pinnedInstructions) {
    const body = bundle.user.pinnedInstructions.slice(0, 2000);
    candidates.push({
      source: 'user-pinned',
      label: 'User Pinned Instructions',
      body,
      tokens: approxTokens(body),
      baseUtility: 1.0,
      authority: 1.0,
      intentMatch: 1.0,
      pinned: true,
    });
  }

  if (bundle?.project.rulesMarkdown) {
    const body = bundle.project.rulesMarkdown.slice(0, 3000);
    const which = [
      bundle.project.hasClaudeMd && 'CLAUDE.md',
      bundle.project.hasAgentsMd && 'AGENTS.md',
      bundle.project.hasCursorRules && '.cursorrules',
      bundle.project.hasClarifyMd && 'clarify.md',
    ].filter(Boolean).join(', ') || 'workspace';
    candidates.push({
      source: 'project-rules',
      label: `Project Rules (${which})`,
      body,
      tokens: approxTokens(body),
      baseUtility: 0.9,
      authority: 0.9,
      intentMatch: 0.8,
    });
  }

  if (bundle?.file?.path) {
    const lines: string[] = [`path: ${bundle.file.path}${bundle.file.language ? ` (${bundle.file.language})` : ''}`];
    if (bundle.file.excerpt) lines.push('excerpt:\n' + bundle.file.excerpt);
    const body = lines.join('\n');
    candidates.push({
      source: 'active-file',
      label: 'Active File',
      body,
      tokens: approxTokens(body),
      baseUtility: 0.8,
      authority: 0.7,
      intentMatch: intentMatchForFile(args.intent),
    });
  }

  if (args.acceptedExamples?.length) {
    const examples = args.acceptedExamples.slice(0, 2);
    for (const [i, ex] of examples.entries()) {
      const body = `Original: ${ex.originalPrompt}\nAccepted output: ${ex.optimizedPrompt}`;
      candidates.push({
        source: `session-example-${i}`,
        label: `Prior Accepted Example ${i + 1}`,
        body,
        tokens: approxTokens(body),
        baseUtility: 0.85,
        authority: 0.8,
        intentMatch: 0.9,
        freshnessMs: now - ex.ts,
      });
    }
  }

  if (args.memoryMatches?.length) {
    for (const [i, m] of args.memoryMatches.slice(0, 4).entries()) {
      candidates.push({
        source: `memory:${m.kind}:${m.sourceId}`,
        label: `Memory (${m.kind}, sim=${m.similarity.toFixed(2)})`,
        body: m.content,
        tokens: m.tokens ?? approxTokens(m.content),
        baseUtility: m.similarity,
        authority: m.kind === 'pack_chunk' ? 0.85 : 0.7,
        intentMatch: m.similarity,
      });
      void i;
    }
  }

  if (args.webSearchContext) {
    const body = args.webSearchSources?.length
      ? `${args.webSearchContext.slice(0, 2400)}\nSources: ${args.webSearchSources.slice(0, 3).join(', ')}`
      : args.webSearchContext.slice(0, 2400);
    candidates.push({
      source: 'web-search',
      label: 'Web Search Context',
      body,
      tokens: approxTokens(body),
      baseUtility: 0.6,
      authority: 0.5,
      intentMatch: 0.6,
    });
  }

  if (bundle) {
    const meta: string[] = [];
    if (bundle.project.packageName) meta.push(`package: ${bundle.project.packageName}`);
    if (bundle.project.languages.length) meta.push(`languages: ${bundle.project.languages.join(', ')}`);
    if (bundle.project.frameworks.length) meta.push(`frameworks: ${bundle.project.frameworks.join(', ')}`);
    if (meta.length) {
      const body = meta.join('; ');
      candidates.push({
        source: 'workspace-meta',
        label: 'Workspace',
        body,
        tokens: approxTokens(body),
        baseUtility: 0.5,
        authority: 0.6,
        intentMatch: 0.5,
      });
    }
  }

  if (bundle?.targetModel?.family) {
    const caps: string[] = [];
    const tm = bundle.targetModel;
    if (tm.capabilities.contextWindow) caps.push(`${tm.capabilities.contextWindow.toLocaleString()}-token context`);
    if (tm.capabilities.supportsJsonMode) caps.push('JSON mode');
    if (tm.capabilities.supportsToolUse) caps.push('tool use');
    if (tm.capabilities.supportsVision) caps.push('vision');
    if (tm.capabilities.localDeployment) caps.push('local-deployable');
    if (tm.capabilities.reasoningChainOfThought) caps.push('chain-of-thought reasoning');
    const line = `${tm.family} (${tm.model})${caps.length ? ` — ${caps.join(', ')}` : ''}`;
    const strengths = tm.strengths.length ? `\nStrengths: ${tm.strengths.join(', ')}.` : '';
    const body = line + strengths;
    candidates.push({
      source: 'target-model',
      label: 'Compiler Model (downstream LLM running the rewrite)',
      body,
      tokens: approxTokens(body),
      baseUtility: 0.4,
      authority: 0.6,
      intentMatch: 0.4,
    });
  }

  if (args.platformInstructions) {
    const body = args.platformInstructions.slice(0, 2000);
    candidates.push({
      source: 'platform-custom',
      label: 'Custom Platform Instructions',
      body,
      tokens: approxTokens(body),
      baseUtility: 0.75,
      authority: 0.8,
      intentMatch: 0.7,
    });
  }

  if (args.platformHints?.length) {
    const body = args.platformHints.join(', ');
    candidates.push({
      source: 'platform-hints',
      label: 'Platform Syntax Hints',
      body,
      tokens: approxTokens(body),
      baseUtility: 0.7,
      authority: 0.7,
      intentMatch: 0.8,
    });
  }

  return candidates;
}

function intentMatchForFile(intent?: Intent): number {
  // Code/spec/analysis intents benefit strongly from the active file;
  // brand-voice or stakeholder-comm don't.
  switch (intent) {
    case 'production-code':
    case 'technical-spec':
    case 'analysis':
      return 0.95;
    case 'data-extract':
    case 'exploration':
      return 0.7;
    case 'brand-voice':
    case 'stakeholder-comm':
    case 'creative-media':
    case 'quick-draft':
      return 0.3;
    default:
      return 0.5;
  }
}
