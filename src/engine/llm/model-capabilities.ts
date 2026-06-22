// Robust, self-updating "is this a thinking-channel model?" characterization.
//
// Replaces a hardcoded model-name list (which rots as new models ship). The
// question is answered in priority order, cached per model for the session:
//
//   1. cache         — learned or probed earlier this session
//   2. the runtime   — Ollama's /api/show reports `capabilities`, which includes
//                      "thinking" for models with a reasoning channel. This is
//                      authoritative and updates itself as Ollama ships models
//                      (gpt-oss, glm, minimax-m3, … all report it; qwen-coder
//                      does not).
//   3. a name hint   — last resort for providers without an /api/show endpoint
//
// …and CONFIRMED at runtime: observeResponse() marks a model as thinking the
// moment a response carries a reasoning trace (or comes back empty with tokens
// spent), so even a model we've never seen self-characterizes after one call.
//
// Why this matters: a thinking model that starves its final answer needs a
// max_tokens floor (see client.ts). Getting the characterization right on the
// FIRST call (via the runtime probe) avoids an empty-then-retry double-call.

const thinkingCache = new Map<string, boolean>();

/**
 * Last-resort name heuristic, used only when the runtime can't tell us (e.g. a
 * non-Ollama OpenAI-compatible gateway). NOT the source of truth — the runtime
 * probe and response-learning override it. Kept deliberately small.
 */
export function isThinkingByName(model: string): boolean {
  return /gpt-oss|glm-?(z|[4-9])|deepseek-r\d|reasoner|qwq|thinking|minimax-m\d/i.test(model);
}

export function cachedThinking(model: string): boolean | undefined {
  return thinkingCache.get(model);
}

/** Once a model is known to think, it stays that way for the session. */
export function markThinking(model: string): void {
  thinkingCache.set(model, true);
}

/**
 * Learn from an actual response: a populated reasoning trace, or empty content
 * despite spent tokens, both prove a thinking channel — regardless of the
 * model's name or provider. This is what makes the characterization robust to
 * models no list knows about yet.
 */
export function observeResponse(
  model: string,
  r: { content: string; reasoning: string; completionTokens: number },
): void {
  if (r.reasoning || (!r.content && r.completionTokens > 0)) markThinking(model);
}

/**
 * Ask the Ollama runtime directly. Its native /api/show sits next to the
 * OpenAI-compatible /v1 surface (…:11434/v1 → …:11434/api/show). Returns
 * true/false from the reported capabilities, or null when the endpoint isn't
 * Ollama / is unreachable. Never throws.
 */
async function ollamaThinkingCapability(apiUrl: string, apiKey: string, model: string): Promise<boolean | null> {
  const base = apiUrl.replace(/\/v1\/?$/, '');
  try {
    const res = await fetch(`${base}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { capabilities?: unknown };
    if (!Array.isArray(body.capabilities)) return null;
    return body.capabilities.includes('thinking');
  } catch {
    return null;
  }
}

/**
 * Best-effort upfront characterization, cached per model. Probes the runtime
 * first (authoritative), falls back to the name hint. Never throws. Call once
 * before the first request to a model; subsequent calls are cache hits.
 */
export async function characterizeThinking(model: string, opts: { apiUrl: string; apiKey: string }): Promise<boolean> {
  const cached = thinkingCache.get(model);
  if (cached !== undefined) return cached;
  const fromRuntime = await ollamaThinkingCapability(opts.apiUrl, opts.apiKey, model);
  const thinking = fromRuntime ?? isThinkingByName(model);
  thinkingCache.set(model, thinking);
  return thinking;
}

/** Synchronous best-known answer: cache if populated, else the name hint. */
export function isThinkingModel(model: string): boolean {
  return thinkingCache.get(model) ?? isThinkingByName(model);
}

/** Test helper. */
export function _resetThinkingCache(): void {
  thinkingCache.clear();
}
