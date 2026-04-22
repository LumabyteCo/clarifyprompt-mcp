import type { ContextBundle } from '../context/types.js';
import type { Intent } from '../context/types.js';
import type { Category, Mode } from '../config/categories.js';
import type { SessionOptimizationEntry, SessionOutcomeEntry } from '../context/types.js';

/**
 * Single authoritative context assembly. All context sources merge here,
 * in priority order, so downstream strategies never have to juggle parallel
 * streams and readers can trace exactly why something was or wasn't included.
 */
export interface GroundingInputs {
  bundle?: ContextBundle;
  webSearchContext?: string;         // from search/client.ts enrichContext, if enabled
  webSearchSources?: string[];
  platformInstructions?: string;      // from ConfigStore.resolveInstructions
  platformHints?: string[];
  acceptedExamples?: AcceptedExample[]; // from Pass D retrieval
}

export interface AcceptedExample {
  originalPrompt: string;
  optimizedPrompt: string;
  category: Category;
  platform?: string;
  intent?: Intent;
  ts: number;
}

export interface GroundingOutput {
  /** Ready-to-inject user-prompt block. Empty string if nothing applies. */
  block: string;
  /** Which sources contributed, in order. Useful for trace. */
  sources: string[];
}

/**
 * Priority order (highest → lowest). Documented so contributors don't add
 * a 4th silo silently:
 *
 *   1. User pinned instructions (authoritative; the user said "always do X")
 *   2. Project rules (CLAUDE.md / AGENTS.md / .cursorrules / clarify.md)
 *   3. Active file context (what they're working on)
 *   4. Session: prior accepted examples for similar prompts (few-shot)
 *   5. Web search (if enabled; contextualizes open-ended requests)
 *   6. Workspace metadata (frameworks, languages, package name)
 *   7. Target model capability hints (for the downstream LLM's strengths)
 *   8. Custom platform instructions (.md file + inline)
 *   9. Built-in platform syntax hints
 */
export function buildGroundingContext(inputs: GroundingInputs): GroundingOutput {
  const sections: { label: string; body: string; source: string }[] = [];
  const bundle = inputs.bundle;

  if (bundle?.user.pinnedInstructions) {
    sections.push({
      label: 'User Pinned Instructions',
      body: bundle.user.pinnedInstructions.slice(0, 1200),
      source: 'user-pinned',
    });
  }

  if (bundle?.project.rulesMarkdown) {
    const which = [
      bundle.project.hasClaudeMd && 'CLAUDE.md',
      bundle.project.hasAgentsMd && 'AGENTS.md',
      bundle.project.hasCursorRules && '.cursorrules',
      bundle.project.hasClarifyMd && 'clarify.md',
    ].filter(Boolean).join(', ') || 'workspace';
    sections.push({
      label: `Project Rules (${which})`,
      body: bundle.project.rulesMarkdown.slice(0, 2400),
      source: 'project-rules',
    });
  }

  if (bundle?.file?.path) {
    const lines: string[] = [`path: ${bundle.file.path}${bundle.file.language ? ` (${bundle.file.language})` : ''}`];
    if (bundle.file.excerpt) lines.push('excerpt:\n' + bundle.file.excerpt);
    sections.push({ label: 'Active File', body: lines.join('\n'), source: 'active-file' });
  }

  if (inputs.acceptedExamples?.length) {
    const body = inputs.acceptedExamples
      .slice(0, 2)
      .map((ex, i) => `Example ${i + 1}:\nOriginal: ${ex.originalPrompt}\nAccepted output: ${ex.optimizedPrompt}`)
      .join('\n\n');
    sections.push({
      label: 'Prior Accepted Examples (same session)',
      body,
      source: 'session-examples',
    });
  }

  if (inputs.webSearchContext) {
    const sourcesLine = inputs.webSearchSources?.length
      ? `\nSources: ${inputs.webSearchSources.slice(0, 3).join(', ')}`
      : '';
    sections.push({
      label: 'Web Search Context',
      body: inputs.webSearchContext.slice(0, 2400) + sourcesLine,
      source: 'web-search',
    });
  }

  if (bundle) {
    const meta: string[] = [];
    if (bundle.project.packageName) meta.push(`package: ${bundle.project.packageName}`);
    if (bundle.project.languages.length) meta.push(`languages: ${bundle.project.languages.join(', ')}`);
    if (bundle.project.frameworks.length) meta.push(`frameworks: ${bundle.project.frameworks.join(', ')}`);
    if (meta.length) sections.push({ label: 'Workspace', body: meta.join('; '), source: 'workspace-meta' });
  }

  if (bundle?.targetModel?.family) {
    const caps: string[] = [];
    if (bundle.targetModel.capabilities.contextWindow) {
      caps.push(`${bundle.targetModel.capabilities.contextWindow.toLocaleString()}-token context`);
    }
    if (bundle.targetModel.capabilities.supportsJsonMode) caps.push('JSON mode');
    if (bundle.targetModel.capabilities.supportsToolUse) caps.push('tool use');
    if (bundle.targetModel.capabilities.supportsVision) caps.push('vision');
    if (bundle.targetModel.capabilities.localDeployment) caps.push('local-deployable');
    const line = `${bundle.targetModel.family} (${bundle.targetModel.model})${caps.length ? ` — ${caps.join(', ')}` : ''}`;
    const strengths = bundle.targetModel.strengths.length
      ? `\nStrengths: ${bundle.targetModel.strengths.join(', ')}.`
      : '';
    sections.push({ label: 'Compiler Model (downstream LLM running the rewrite)', body: line + strengths, source: 'target-model' });
  }

  if (inputs.platformInstructions) {
    sections.push({
      label: 'Custom Platform Instructions',
      body: inputs.platformInstructions.slice(0, 2000),
      source: 'platform-custom',
    });
  }

  if (inputs.platformHints?.length) {
    sections.push({
      label: 'Platform Syntax Hints',
      body: inputs.platformHints.join(', '),
      source: 'platform-hints',
    });
  }

  if (!sections.length) return { block: '', sources: [] };

  const rendered = sections
    .map(s => `## ${s.label}\n${s.body}`)
    .join('\n\n');

  return {
    block: `\nGrounding Context (priority-ordered):\n${rendered}\n`,
    sources: sections.map(s => s.source),
  };
}

/**
 * Reconcile user-supplied mode with the intent-derived recommended mode.
 * User-supplied wins unless it's undefined or the literal default — in which
 * case the analyzer's recommendation applies.
 */
export function reconcileMode(
  userMode: Mode | undefined,
  analyzerRecommended: Mode | undefined,
  userExplicitlyPassed: boolean,
): { mode: Mode; source: 'user' | 'analyzer' | 'default' } {
  if (userExplicitlyPassed && userMode) return { mode: userMode, source: 'user' };
  if (analyzerRecommended) return { mode: analyzerRecommended, source: 'analyzer' };
  return { mode: userMode ?? 'detailed', source: 'default' };
}

/**
 * Shape the LLM call to match the target model's capabilities. Small,
 * local models choke on 2KB system prompts and drown in high-max-token
 * budgets; large models benefit from richer system prompts.
 */
export interface PromptShape {
  systemPromptBudget: 'compact' | 'standard' | 'rich';
  maxTokens: number;
  temperature: number;
  includeExamples: boolean;
}

export function getPromptShape(bundle: ContextBundle | undefined, intent: Intent | undefined): PromptShape {
  const caps = bundle?.targetModel?.capabilities;
  const ctx = caps?.contextWindow ?? 32_000;
  const params = caps?.parameterBillions;
  const isLocal = !!caps?.localDeployment;

  // Priority: model parameter count (when we know it) → context window.
  // Small-param LOCAL models drown in big prompts → compact. Small-param
  // HOSTED models (gpt-4o-mini, claude-haiku, gemini-flash) are frontier
  // quality at low cost — they deserve rich framing. Distinguishing the
  // two is what localDeployment is for.
  let systemPromptBudget: PromptShape['systemPromptBudget'] = 'standard';
  if (params !== undefined) {
    if (params <= 8 && isLocal) systemPromptBudget = 'compact';
    else if (params <= 8 && !isLocal) systemPromptBudget = 'rich';
    else if (params >= 70) systemPromptBudget = 'rich';
    else systemPromptBudget = 'standard';
  } else if (ctx >= 100_000 && !isLocal) {
    // Hosted, 100K+ ctx frontier model (Claude / GPT-4 / Gemini) with no size advertised.
    systemPromptBudget = 'rich';
  } else if (ctx < 16_000) {
    systemPromptBudget = 'compact';
  }

  // maxTokens: cap generous output for rich models, be terser for compact.
  let maxTokens = 2048;
  if (systemPromptBudget === 'compact') maxTokens = 1024;
  if (systemPromptBudget === 'rich') maxTokens = 3072;

  // Reasoning / chain-of-thought models (o-series, DeepSeek-R, GPT-OSS,
  // thinking variants) spend tokens on an internal reasoning channel BEFORE
  // producing content. If maxTokens cuts off mid-thought, `content` comes
  // back empty. Give them 4x headroom so the content actually lands.
  if (caps?.reasoningChainOfThought) {
    maxTokens = Math.max(maxTokens * 4, 8192);
  }

  // Temperature: intent-aware.
  let temperature = 0.7;
  if (intent === 'data-extract' || intent === 'technical-spec' || intent === 'analysis') temperature = 0.2;
  if (intent === 'creative-media' || intent === 'brand-voice') temperature = 0.9;
  if (intent === 'quick-draft') temperature = 0.5;

  return {
    systemPromptBudget,
    maxTokens,
    temperature,
    includeExamples: systemPromptBudget !== 'compact',
  };
}
