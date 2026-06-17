#!/usr/bin/env node

// Coverage for 1.9.0 elicitation (roadmap #4).
//
//   Part A (deterministic, CI-safe): the pure helpers — schema build + answer
//           merge. No LLM, no wire.
//   Part B (live): the real server→client elicitation loop with a mock
//           elicitation-capable client. Needs a local model to generate
//           questions; degrades to a SKIP (not a failure) if unreachable.
//
// Usage: node tests/elicitation.mjs   (run `npm run build` first)

import { fileURLToPath } from 'node:url';
import * as _path from 'node:path';
const REPO_ROOT = _path.resolve(_path.dirname(fileURLToPath(import.meta.url)), '..');
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';

const DIST = `${REPO_ROOT}/dist`;
const { buildElicitationForm, applyElicitedAnswers, questionKey } = await import(`${DIST}/engine/clarification/elicit.js`);

let failures = 0;
const C = { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, d: s => `\x1b[90m${s}\x1b[0m`, c: s => `\x1b[36m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m` };
const sep = t => console.log(`\n${C.c('━━━ ' + t + ' ' + '━'.repeat(Math.max(0, 60 - t.length)))}`);
const ok = n => console.log(`  ${C.g('✔')} ${n}`);
const skip = n => console.log(`  ${C.y('⊘')} ${n}`);
const bad = (n, d) => { failures++; console.log(`  ${C.r('✖')} ${n}`); if (d) console.log(C.d(`      ${d}`)); };

// ─────────────────────────────────────────────── Part A: pure helpers
sep('A1: buildElicitationForm — enum vs free-text, defaults');
{
  const questions = [
    { question: 'Who is the audience?', reasoning: 'r', suggestedAnswer: 'developers', dimension: 'audience' },
    { question: 'What output format?', reasoning: 'r', suggestedAnswer: 'JSON', options: ['JSON', 'YAML', 'prose'], dimension: 'format' },
    { question: 'Default not in options?', reasoning: 'r', suggestedAnswer: 'nope', options: ['a', 'b'], dimension: 'scope' },
  ];
  const form = buildElicitationForm(questions);
  form.type === 'object' ? ok('schema type is object') : bad('schema type', JSON.stringify(form));
  const p = form.properties;
  (p.q1 && p.q1.type === 'string' && !p.q1.enum && p.q1.default === 'developers') ? ok('free-text field: default = suggested answer') : bad('free-text', JSON.stringify(p.q1));
  (Array.isArray(p.q2.enum) && p.q2.enum.length === 3 && p.q2.default === 'JSON') ? ok('enum field: options become enum, default applies') : bad('enum', JSON.stringify(p.q2));
  (Array.isArray(p.q3.enum) && p.q3.default === undefined) ? ok('default omitted when not one of the enum options (clients reject otherwise)') : bad('enum bad-default', JSON.stringify(p.q3));
  (p.q1.description === 'Who is the audience?' && p.q1.title === 'Audience') ? ok('description = question text; title = dimension label') : bad('labels', JSON.stringify(p.q1));
}

sep('A2: applyElicitedAnswers — blank falls back to suggested answer');
{
  const questions = [
    { question: 'Q1', reasoning: 'r', suggestedAnswer: 'sug1', dimension: 'goal' },
    { question: 'Q2', reasoning: 'r', suggestedAnswer: 'sug2', dimension: 'tone' },
    { question: 'Q3', reasoning: 'r', suggestedAnswer: 'sug3', dimension: 'scope' },
  ];
  const content = { [questionKey(0)]: 'user answer', [questionKey(1)]: '   ' /* blank */ };
  const merged = applyElicitedAnswers(questions, content);
  (merged[0].answer === 'user answer' && merged[0].usedSuggested === false) ? ok('provided answer kept') : bad('provided', JSON.stringify(merged[0]));
  (merged[1].answer === 'sug2' && merged[1].usedSuggested === true) ? ok('whitespace-only → suggested fallback') : bad('blank', JSON.stringify(merged[1]));
  (merged[2].answer === 'sug3' && merged[2].usedSuggested === true) ? ok('missing key → suggested fallback') : bad('missing', JSON.stringify(merged[2]));
  applyElicitedAnswers(questions, undefined).every(a => a.usedSuggested) ? ok('undefined content → all suggested') : bad('undefined content');
}

// ─────────────────────────────────────────────── Part B: live wire loop
sep('B1: live server→client elicitation round-trip (mock elicitation client)');
const DATA_DIR = path.join(os.tmpdir(), 'clarify-elicit-data');
await fs.rm(DATA_DIR, { recursive: true, force: true });
const server = spawn(process.execPath, [`${DIST}/index.js`], {
  env: { ...process.env, LLM_API_URL: 'http://localhost:11434/v1', LLM_API_KEY: '', LLM_MODEL: 'qwen2.5-coder:7b-instruct-q4_K_M', CLARIFYPROMPT_TRACE: 'off', CLARIFYPROMPT_DATA_DIR: DATA_DIR },
});
let nextId = 1;
const pending = new Map();
let elicitSeen = false;
let buf = '';
server.stdout.on('data', chunk => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    // Incoming server→client REQUEST (has method + id) — handle elicitation/create.
    if (msg.method === 'elicitation/create' && msg.id !== undefined) {
      elicitSeen = true;
      // Mock a user filling the form: return a SCHEMA-VALID value per field —
      // enum fields must return one of their options (the server validates).
      const schema = msg.params?.requestedSchema?.properties || {};
      const content = {};
      for (const [k, def] of Object.entries(schema)) {
        content[k] = Array.isArray(def.enum) && def.enum.length ? def.enum[0] : `auto-${k}`;
      }
      server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { action: 'accept', content } }) + '\n');
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  }
});
server.stderr.on('data', () => {});
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 60_000);
});

try {
  // Declare elicitation capability so the server will route through elicitInput.
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: { elicitation: {} }, clientInfo: { name: 'elicit-test', version: '0' } });
  await rpc('notifications/initialized', {}).catch(() => {});
  let res;
  try {
    res = await rpc('tools/call', {
      name: 'clarify_with_user',
      arguments: { prompt: 'make it better', elicit: true, force: true, max_questions: 2 },
    });
  } catch (err) {
    skip(`clarify_with_user unreachable (likely no local model): ${err.message.slice(0, 80)}`);
    res = null;
  }
  if (res) {
    const body = JSON.parse(res.content[0].text);
    if (!elicitSeen) {
      // Model may have short-circuited (no questions) — that's a valid non-elicit path.
      body.clarificationNeeded === false ? skip('analyzer short-circuited (no questions to elicit)') : bad('no elicitation/create sent despite questions', JSON.stringify(body).slice(0, 160));
    } else {
      elicitSeen ? ok('server sent elicitation/create to the client') : bad('elicitation/create not observed');
      body.elicited === true ? ok('response flagged elicited:true') : bad('elicited flag', JSON.stringify(body).slice(0, 160));
      body.elicitationAction === 'accept' ? ok('elicitationAction = accept') : bad('action', JSON.stringify(body).slice(0, 160));
      (Array.isArray(body.answers) && body.answers.length > 0 && body.answers.every(a => a.answer)) ? ok(`collected ${body.answers.length} answer(s) merged back onto questions`) : bad('answers', JSON.stringify(body.answers));
    }
  }
} catch (err) {
  bad('wire loop crashed', err.message);
} finally {
  server.kill();
}

console.log('');
if (failures === 0) console.log(C.g('✔ elicitation battery passed.'));
else { console.log(C.r(`✖ elicitation battery: ${failures} failure(s).`)); process.exitCode = 1; }
