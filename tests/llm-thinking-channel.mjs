// Deterministic regression test for issue #3 — the gpt-oss empty-content bug.
//
// Reasoning models route their answer through a thinking channel whose field
// name varies by provider (`reasoning` / `thinking` / `reasoning_content`).
// When the final-answer channel comes back empty, simpleGenerate must NOT
// silently return '' — it reads all three field names, retries once with a
// final-answer-only directive, and throws if the retry is still empty.
//
// No live model: we subclass LLMClient and stub chat(). Runs in CI.
//
// Usage: node tests/llm-thinking-channel.mjs   (run `npm run build` first)

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = `${REPO_ROOT}/dist`;

const { LLMClient, LLMError, extractAssistantContent } = await import(`${DIST}/engine/llm/client.js`);

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
    async chat() {
      this.calls++;
      // 1st call: empty content, full thinking channel (the gpt-oss failure).
      if (this.calls === 1) return msg({ content: '', thinking: 'let me reason about this…', finish_reason: 'stop' });
      // 2nd call (the retry): real answer.
      return msg({ content: 'OPTIMIZED PROMPT', finish_reason: 'stop' });
    }
  }
  const client = new StubClient();
  try {
    const out = await client.simpleGenerate('sys', 'user', { maxTokens: 8192 });
    if (out.content === 'OPTIMIZED PROMPT' && client.calls === 2) ok('retried once and recovered the final answer');
    else bad('recover via retry', `content=${JSON.stringify(out.content)} calls=${client.calls}`);
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
    if (err instanceof LLMError && client.calls === 2 && /even after a final-answer-only retry/.test(err.message)) ok('threw LLMError after one retry (no silent empty string)');
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
    if (err instanceof LLMError && client.calls === 2 && /did not surface as/.test(err.message)) ok('retried once, then threw with the completion_tokens diagnostic (no silent empty)');
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

console.log('');
if (failures === 0) {
  console.log(c.green('✔ thinking-channel battery passed (issue #3 regression locked).'));
} else {
  console.log(c.red(`✖ thinking-channel battery: ${failures} failure(s).`));
  process.exitCode = 1;
}
