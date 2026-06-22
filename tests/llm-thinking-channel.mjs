// Deterministic regression test for issue #3 — the gpt-oss empty-content bug.
//
// Reasoning models route their answer through a thinking channel whose field
// name varies by provider (`reasoning` / `thinking` / `reasoning_content`).
// The TRUE root cause (confirmed 2026-06): gpt-oss spends its whole token budget
// in the thinking channel and never reaches the final channel → content "". The
// fix is reasoning_effort=low (auto-applied to detected reasoning models), with
// the empty-content retry forcing it. simpleGenerate must NOT silently return ''
// — it retries once at reasoning_effort=low, and throws if still empty.
//
// No live model: we subclass LLMClient and stub chat()/fetch. Runs in CI.
//
// Usage: node tests/llm-thinking-channel.mjs   (run `npm run build` first)

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = `${REPO_ROOT}/dist`;

const { LLMClient, LLMError, extractAssistantContent, isReasoningModel } = await import(`${DIST}/engine/llm/client.js`);
const { observeResponse, characterizeThinking, isThinkingModel, isThinkingByName, _resetThinkingCache } = await import(`${DIST}/engine/llm/model-capabilities.js`);

// Make the suite network-free + deterministic. characterizeThinking (called
// inside simpleGenerate) probes Ollama's /api/show; default that to "unreachable"
// so it falls back to the name heuristic. Individual tests override fetch.
globalThis.fetch = async (url) => {
  if (String(url).includes('/api/show')) return { ok: false, json: async () => ({}) };
  return { ok: true, json: async () => msg({ content: 'ok', finish_reason: 'stop' }) };
};

let failures = 0;
const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};
function ok(name) { console.log(`  ${c.green('✔')} ${name}`); }
function bad(name, detail) { failures++; console.log(`  ${c.red('✖')} ${name}`); if (detail) console.log(c.dim(`      ${detail}`)); }
function sep(s) { console.log(`\n${c.cyan('━━━ ' + s + ' ')}`); }

function msg(fields) {
  return { id: 'x', model: 'mock-model', choices: [{ index: 0, message: { role: 'assistant', ...fields }, finish_reason: fields.finish_reason || 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
}

// ───────────────────────────────────────────── T1: field-name extraction
sep('T1: extractAssistantContent reads all three thinking-channel field names');
{
  const cases = [
    [{ content: 'answer', reasoning: 'r' }, 'answer', 'r', 'reasoning'],
    [{ content: '', thinking: 'thought' }, '', 'thought', 'thinking (Ollama)'],
    [{ content: '', reasoning_content: 'dsk' }, '', 'dsk', 'reasoning_content (DeepSeek)'],
    [{ content: 'final', thinking: 't', reasoning_content: 'rc' }, 'final', 't', 'content wins; reasoning precedence'],
    [undefined, '', '', 'undefined message → empty strings, no throw'],
  ];
  for (const [input, wantContent, wantReasoning, label] of cases) {
    const got = extractAssistantContent(input);
    if (got.content === wantContent && got.reasoning === wantReasoning) ok(label);
    else bad(label, `got content=${JSON.stringify(got.content)} reasoning=${JSON.stringify(got.reasoning)}`);
  }
}

// ───────────────────────────────────────────── T2: retry recovers content
sep('T2: simpleGenerate recovers when the first response is thinking-only');
{
  class StubClient extends LLMClient {
    calls = 0;
    retryReq = null;
    async chat(req) {
      this.calls++;
      // 1st call: empty content, full thinking channel (the gpt-oss failure).
      if (this.calls === 1) return msg({ content: '', thinking: 'let me reason about this…', finish_reason: 'stop' });
      // 2nd call (the retry): capture it, return a real answer.
      this.retryReq = req;
      return msg({ content: 'OPTIMIZED PROMPT', finish_reason: 'stop' });
    }
  }
  const client = new StubClient();
  try {
    const out = await client.simpleGenerate('sys', 'user', { maxTokens: 8192 });
    if (out.content === 'OPTIMIZED PROMPT' && client.calls === 2) ok('retried once and recovered the final answer');
    else bad('recover via retry', `content=${JSON.stringify(out.content)} calls=${client.calls}`);
    // The retry must pull the effective lever: reasoning_effort=low.
    if (client.retryReq?.reasoning_effort === 'low') ok('retry forces reasoning_effort=low (the lever that actually works on gpt-oss)');
    else bad('retry reasoning_effort', `retry req had reasoning_effort=${JSON.stringify(client.retryReq?.reasoning_effort)}`);
  } catch (err) {
    bad('recover via retry', `unexpected throw: ${err.message}`);
  }
}

// ───────────────────────────────────────────── T3: throw when retry also empty
sep('T3: simpleGenerate throws (not returns empty) when retry is still thinking-only');
{
  class AlwaysThinking extends LLMClient {
    calls = 0;
    async chat() { this.calls++; return msg({ content: '', reasoning_content: 'thinking forever', finish_reason: 'stop' }); }
  }
  const client = new AlwaysThinking();
  try {
    const out = await client.simpleGenerate('sys', 'user', {});
    bad('throw on unrecoverable empty content', `returned instead of throwing: content=${JSON.stringify(out.content)} calls=${client.calls}`);
  } catch (err) {
    if (err instanceof LLMError && client.calls === 2 && /even after a reasoning_effort=low retry/.test(err.message)) ok('threw LLMError after one retry (no silent empty string)');
    else bad('throw on unrecoverable empty content', `wrong error/calls: ${err?.name} "${err?.message}" calls=${client.calls}`);
  }
}

// ───────────────────────────────────────────── T3b: harmony case (no thinking field)
sep('T3b: empty content with NO thinking field (gpt-oss harmony) → retry → throw');
{
  // The real issue #3 shape: content=='', no reasoning/thinking/reasoning_content,
  // yet completion_tokens>0 (the endpoint dropped the harmony "final" channel).
  class HarmonyDrop extends LLMClient {
    calls = 0;
    async chat() {
      this.calls++;
      return { id: 'x', model: 'gpt-oss-mock', choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 99, completion_tokens: 306, total_tokens: 405 } };
    }
  }
  const client = new HarmonyDrop();
  try {
    const out = await client.simpleGenerate('sys', 'user', { maxTokens: 8192 });
    bad('harmony empty → throw', `returned instead of throwing: content=${JSON.stringify(out.content)} calls=${client.calls}`);
  } catch (err) {
    if (err instanceof LLMError && client.calls === 2 && /no final answer/.test(err.message)) ok('retried once, then threw with the thinking-budget diagnostic (no silent empty)');
    else bad('harmony empty → throw', `wrong error/calls: ${err?.name} "${err?.message}" calls=${client.calls}`);
  }
}

// ───────────────────────────────────────────── T4: normal path untouched
sep('T4: a normal (content-present) response does not trigger a retry');
{
  class NormalClient extends LLMClient {
    calls = 0;
    async chat() { this.calls++; return msg({ content: 'straight answer', finish_reason: 'stop' }); }
  }
  const client = new NormalClient();
  const out = await client.simpleGenerate('sys', 'user', {});
  if (out.content === 'straight answer' && client.calls === 1) ok('single call, no retry, content returned verbatim');
  else bad('normal path', `content=${JSON.stringify(out.content)} calls=${client.calls}`);
}

// ───────────────────────────────────────────── T5: reasoning-model detection
sep('T5: isReasoningModel detects thinking-channel families only');
{
  const reasoning = ['gpt-oss:20b-cloud', 'gpt-oss:120b', 'glm-5.2:cloud', 'glm-4.6:cloud', 'glm-z1', 'qwen3-thinking', 'kimi-k2-thinking:cloud', 'deepseek-r1', 'qwq:32b'];
  const normal = ['qwen2.5-coder:7b', 'gemma4:31b-cloud', 'llama3.3:70b', 'gpt-4o-mini', 'mistral-small'];
  let good = true;
  for (const m of reasoning) if (!isReasoningModel(m)) { good = false; bad('detect reasoning', `${m} not detected`); }
  for (const m of normal) if (isReasoningModel(m)) { good = false; bad('detect reasoning', `${m} wrongly detected`); }
  if (good) ok(`${reasoning.length} reasoning models detected, ${normal.length} normal models left alone`);
}

// ───────────────────────────────────────────── T6: body-level reasoning_effort + budget floor
sep('T6: reasoning_effort + max_tokens floor applied only to reasoning models (real chatOpenAI path)');
{
  const bodies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/show')) return { ok: false, json: async () => ({}) }; // probe → name heuristic
    if (String(url).includes('/chat/completions')) bodies.push(JSON.parse(opts.body));
    return { ok: true, json: async () => msg({ content: 'ok', finish_reason: 'stop' }) };
  };
  try {
    _resetThinkingCache();
    const client = new LLMClient({ apiUrl: 'http://x/v1', apiKey: '', defaultModel: 'qwen2.5-coder:7b' });
    await client.simpleGenerate('s', 'u', { model: 'qwen2.5-coder:7b', maxTokens: 300 });   // normal → untouched
    await client.simpleGenerate('s', 'u', { model: 'gpt-oss:20b-cloud', maxTokens: 300 });   // reasoning → low + floor
    await client.simpleGenerate('s', 'u', { model: 'gpt-oss:20b-cloud', reasoningEffort: 'high' }); // explicit effort wins
    await client.simpleGenerate('s', 'u', { model: 'glm-5.2:cloud', maxTokens: 300 });        // glm ignores effort; floor is the fix
    // reasoning_effort gating
    (bodies[0].reasoning_effort === undefined) ? ok('non-reasoning model: no reasoning_effort sent') : bad('gating', `qwen body had ${bodies[0].reasoning_effort}`);
    (bodies[1].reasoning_effort === 'low') ? ok('reasoning model: auto reasoning_effort=low') : bad('gating', `gpt-oss body had ${bodies[1].reasoning_effort}`);
    (bodies[2].reasoning_effort === 'high') ? ok('explicit per-call reasoningEffort overrides the default') : bad('gating', `override body had ${bodies[2].reasoning_effort}`);
    // budget floor (the universal lever)
    (bodies[0].max_tokens === 300) ? ok('non-reasoning model: max_tokens left at requested 300 (path byte-identical)') : bad('floor', `qwen max_tokens=${bodies[0].max_tokens}`);
    (bodies[1].max_tokens >= 8192) ? ok(`reasoning model: tiny budget floored to ${bodies[1].max_tokens} (thinking can't starve the final answer)`) : bad('floor', `gpt-oss max_tokens=${bodies[1].max_tokens}`);
    (bodies[3].max_tokens >= 8192) ? ok('glm: budget floored (the lever that actually fixes glm, which ignores reasoning_effort)') : bad('floor', `glm max_tokens=${bodies[3].max_tokens}`);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ───────────────────────────────────────────── T7: robust characterization (runtime + learning)
sep('T7: model characterization is robust, not a locked-in name list');
{
  // 7a — runtime probe: an unknown-named model that Ollama reports as `thinking`
  // is characterized as such, WITHOUT any name match.
  _resetThinkingCache();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/show')) return { ok: true, json: async () => ({ capabilities: ['completion', 'tools', 'thinking'] }) };
    return { ok: true, json: async () => msg({ content: 'ok', finish_reason: 'stop' }) };
  };
  try {
    const weirdName = 'totally-made-up-model-x9';
    (!isThinkingByName(weirdName)) ? ok('a novel model name is NOT matched by the heuristic (as expected)') : bad('robust', 'heuristic wrongly matched the novel name');
    const viaRuntime = await characterizeThinking(weirdName, { apiUrl: 'http://x/v1', apiKey: '' });
    viaRuntime ? ok('…but the runtime /api/show capability probe characterizes it as thinking (self-updating, no name list)') : bad('robust', 'runtime probe did not detect thinking');
  } finally {
    globalThis.fetch = realFetch;
  }

  // 7b — response learning: a reasoning trace (or empty content + spent tokens)
  // marks the model as thinking thereafter, regardless of name or provider.
  _resetThinkingCache();
  const learned = 'no-such-model-y7';
  (!isThinkingModel(learned)) ? ok('unknown model starts uncharacterized') : bad('learn', 'unexpectedly pre-characterized');
  observeResponse(learned, { content: '', reasoning: '', completionTokens: 120 }); // empty + tokens spent
  isThinkingModel(learned) ? ok('learned from an empty-with-tokens response → now treated as thinking') : bad('learn', 'did not learn from empty+tokens');
  _resetThinkingCache();
  observeResponse(learned, { content: 'answer', reasoning: 'a long chain of thought', completionTokens: 200 }); // reasoning present
  isThinkingModel(learned) ? ok('learned from a populated reasoning trace → now treated as thinking') : bad('learn', 'did not learn from reasoning trace');
  _resetThinkingCache();
}

console.log('');
if (failures === 0) {
  console.log(c.green('✔ thinking-channel battery passed (issue #3 regression locked).'));
} else {
  console.log(c.red(`✖ thinking-channel battery: ${failures} failure(s).`));
  process.exitCode = 1;
}
