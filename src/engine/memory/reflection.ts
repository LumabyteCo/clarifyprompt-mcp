/**
 * Reflective memory. When a user accepts or rejects an optimization via
 * save_outcome, we extract atomic facts from the interaction and write
 * them back to memory — so future optimizations are informed by accumulated
 * evidence of what works and what doesn't.
 *
 * Synchronous on purpose: the user's save_outcome call waits for extraction
 * to complete. In practice this is 1–3 seconds on a local LLM; an acceptable
 * tax for memory that's actually up-to-date when the next optimize fires.
 */

import { getLLMClient } from '../llm/client.js';
import { getMemoryStore } from './store.js';
import type { Verdict, Fact } from './types.js';

export interface ReflectionResult {
  optimizationId: string;
  verdict: Verdict;
  factsExtracted: number;
  factsInvalidated: number;
  source: 'llm' | 'skipped';
  notes?: string;
}

interface ExtractedFact {
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
}

/** Wrap a single reflection run. Failures are non-fatal. */
export async function reflectOnOutcome(args: {
  optimizationId: string;
  sessionId: string;
  verdict: Verdict;
  diff?: string;
}): Promise<ReflectionResult> {
  const store = getMemoryStore();
  if (!store.isHealthy()) {
    return {
      optimizationId: args.optimizationId,
      verdict: args.verdict,
      factsExtracted: 0,
      factsInvalidated: 0,
      source: 'skipped',
      notes: 'memory store not healthy',
    };
  }

  const opt = store.getOptimization(args.optimizationId);
  if (!opt) {
    return {
      optimizationId: args.optimizationId,
      verdict: args.verdict,
      factsExtracted: 0,
      factsInvalidated: 0,
      source: 'skipped',
      notes: 'optimization not in memory',
    };
  }

  const scope = `session:${args.sessionId}`;

  if (args.verdict === 'accepted' || args.verdict === 'edited') {
    try {
      const facts = await extractFacts({
        originalPrompt: opt.originalPrompt,
        optimizedPrompt: opt.optimizedPrompt,
        category: opt.category,
        intent: opt.intent,
        edited: args.verdict === 'edited',
        diff: args.diff,
      });

      let stored = 0;
      for (const f of facts) {
        if (!f.subject || !f.predicate || !f.object) continue;
        const factId = store.insertFact({
          scope,
          subjectText: f.subject,
          predicate: f.predicate,
          objectText: f.object,
          confidence: args.verdict === 'accepted' ? (f.confidence ?? 0.8) : Math.min(f.confidence ?? 0.6, 0.7),
          source: `reflection:${args.optimizationId}`,
        });
        if (store.hasVectors()) {
          const text = `${f.subject} ${f.predicate} ${f.object}`;
          await store.embedAndStore('fact', factId, text);
        }
        stored++;
      }

      return {
        optimizationId: args.optimizationId,
        verdict: args.verdict,
        factsExtracted: stored,
        factsInvalidated: 0,
        source: 'llm',
      };
    } catch (err) {
      return {
        optimizationId: args.optimizationId,
        verdict: args.verdict,
        factsExtracted: 0,
        factsInvalidated: 0,
        source: 'skipped',
        notes: `extraction failed: ${(err as Error).message}`,
      };
    }
  }

  // Rejection path: invalidate recent facts that came from this same session
  // and share the same category+intent as the rejected optimization. We
  // don't know *which* facts caused the rejection, so this is a conservative
  // signal — downgrade confidence / invalidate the most recent handful.
  if (args.verdict === 'rejected') {
    const liveFacts = store.listLiveFacts(scope, undefined, 20);
    let invalidated = 0;
    const nowMs = Date.now();
    for (const f of liveFacts.filter((f: Fact) => f.source?.startsWith('reflection:'))) {
      // Only touch facts from the last hour; older ones aren't about this opt.
      if (nowMs - f.observedAt > 60 * 60 * 1000) continue;
      store.invalidateFact(f.id);
      invalidated++;
      if (invalidated >= 3) break;
    }
    return {
      optimizationId: args.optimizationId,
      verdict: args.verdict,
      factsExtracted: 0,
      factsInvalidated: invalidated,
      source: 'llm',
      notes: 'invalidated recent reflection facts from this session',
    };
  }

  return {
    optimizationId: args.optimizationId,
    verdict: args.verdict,
    factsExtracted: 0,
    factsInvalidated: 0,
    source: 'skipped',
  };
}

/** LLM-based fact extraction. Returns a small list of atomic triples. */
async function extractFacts(args: {
  originalPrompt: string;
  optimizedPrompt: string;
  category?: string;
  intent?: string;
  edited?: boolean;
  diff?: string;
}): Promise<ExtractedFact[]> {
  const llm = getLLMClient();

  const system = `You extract atomic, reusable facts from a prompt optimization transcript.
Each fact is a (subject, predicate, object) triple that captures a preference, convention,
or pattern the user implicitly confirmed by ACCEPTING${args.edited ? ' (with edits)' : ''} this optimization.

Return STRICT JSON: {"facts": [{"subject": "...", "predicate": "...", "object": "...", "confidence": 0.0-1.0}, ...]}
- Extract 0–3 facts. If nothing generalizable, return an empty list.
- Facts should be general enough to apply to FUTURE similar prompts.
- Subjects are usually "user", "project", or a named entity.
- Predicates are short verb phrases: "prefers", "uses", "avoids", "requires".
- Objects are the concrete value.
- NEVER invent facts not grounded in the transcript. If unsure, omit.
- NO prose, NO markdown, JUST the JSON object.`;

  const user = `Category: ${args.category || 'unknown'}
Intent: ${args.intent || 'unknown'}

Original prompt:
"""
${args.originalPrompt}
"""

Accepted${args.edited ? ' (edited)' : ''} output:
"""
${args.optimizedPrompt.slice(0, 1500)}
"""
${args.diff ? `\nUser's edit diff:\n${args.diff.slice(0, 500)}\n` : ''}
Extract reusable facts:`;

  const result = await llm.simpleGenerate(system, user, {
    temperature: 0.2,
    maxTokens: 512,
  });

  return parseFactsResponse(result.content);
}

function parseFactsResponse(raw: string): ExtractedFact[] {
  // Strip markdown fences if the model ignored our instructions
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as { facts?: ExtractedFact[] };
    return Array.isArray(parsed.facts) ? parsed.facts.slice(0, 3) : [];
  } catch {
    // Best-effort: find the first {...} block
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]) as { facts?: ExtractedFact[] };
        return Array.isArray(parsed.facts) ? parsed.facts.slice(0, 3) : [];
      } catch { /* fall through */ }
    }
    return [];
  }
}
