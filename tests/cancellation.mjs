#!/usr/bin/env node

// Coverage for 1.10.0 cancellation + progress (roadmap #5, stable core).
//
//   Part A (deterministic, CI-safe): a pre-aborted signal makes composePrompt
//           throw BEFORE any LLM call — proves checkAbort + propagation. No LLM.
//   Part B (live): wire-level — compose_prompt with a progressToken emits
//           notifications/progress. Needs a model; SKIPs if unreachable.
//
// Usage: node tests/cancellation.mjs   (run `npm run build` first)

import { fileURLToPath } from 'node:url';
import * as _path from 'node:path';
const REPO_ROOT = _path.resolve(_path.dirname(fileURLToPath(import.meta.url)), '..');
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';

const DIST = `${REPO_ROOT}/dist`;
const { composePrompt } = await import(`${DIST}/engine/composition/compose.js`);

let failures = 0;
const C = { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, d: s => `\x1b[90m${s}\x1b[0m`, c: s => `\x1b[36m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m` };
const sep = t => console.log(`\n${C.c('━━━ ' + t + ' ' + '━'.repeat(Math.max(0, 58 - t.length)))}`);
const ok = n => console.log(`  ${C.g('✔')} ${n}`);
const skip = n => console.log(`  ${C.y('⊘')} ${n}`);
const bad = (n, d) => { failures++; console.log(`  ${C.r('✖')} ${n}`); if (d) console.log(C.d(`      ${d}`)); };

// ─────────────────────────────────────── Part A: deterministic cancellation
sep('A1: a pre-aborted signal cancels composePrompt before any LLM call');
{
  const ac = new AbortController();
  ac.abort(); // already cancelled
  let progressCalls = 0;
  try {
    await composePrompt({
      prompt: 'write a function to parse dates',
      preClarify: 'never',           // skip clarify so the first checkAbort is the loop guard
      signal: ac.signal,
      onProgress: () => { progressCalls++; },
    });
    bad('pre-aborted compose should throw', 'it returned a result instead');
  } catch (err) {
    /cancelled/i.test(err.message) ? ok(`threw "${err.message}" with no LLM call`) : bad('wrong error', err.message);
    progressCalls === 0 ? ok('no progress emitted (aborted before any stage)') : bad('progress leaked', `calls=${progressCalls}`);
  }
}

sep('A2: onProgress signature + ComposeProgress shape are wired');
{
  // Exercise the emit path deterministically by aborting AFTER the guard would
  // have emitted: we can't run a real stage without a model, so we assert the
  // callback contract is honored — a non-aborted run with preClarify:'never' and
  // an immediately-aborting onProgress proves emit fires before the LLM call.
  const ac = new AbortController();
  const seen = [];
  try {
    await composePrompt({
      prompt: 'x',
      preClarify: 'always',          // clarify runs first and emits before its LLM call
      signal: ac.signal,
      onProgress: (u) => { seen.push(u); ac.abort(); }, // abort on first emit → stop before LLM finishes
    });
  } catch { /* expected: aborted */ }
  (seen.length >= 1 && seen[0].stage === 'clarify' && typeof seen[0].message === 'string' && typeof seen[0].maxIterations === 'number')
    ? ok(`onProgress fired with {stage:'${seen[0].stage}', message, iteration, maxIterations}`)
    : bad('onProgress contract', JSON.stringify(seen[0] ?? null));
}

// ─────────────────────────────────────── Part B: live progress over the wire
sep('B1: compose_prompt emits notifications/progress (live, needs model)');
const DATA_DIR = path.join(os.tmpdir(), 'clarify-cancel-data');
await fs.rm(DATA_DIR, { recursive: true, force: true });
const MODEL = process.env.LLM_MODEL || 'gemma4:31b-cloud';
const server = spawn(process.execPath, [`${DIST}/index.js`], {
  env: { ...process.env, LLM_API_URL: process.env.LLM_API_URL || 'http://localhost:11434/v1', LLM_MODEL: MODEL, CLARIFYPROMPT_TRACE: 'off', CLARIFYPROMPT_DATA_DIR: DATA_DIR },
});
let nextId = 1;
const pending = new Map();
const progressMsgs = [];
let buf = '';
server.stdout.on('data', chunk => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === 'notifications/progress') { progressMsgs.push(msg.params); continue; }
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
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 120_000);
});

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cancel-test', version: '0' } });
  await rpc('notifications/initialized', {}).catch(() => {});
  let res;
  try {
    res = await rpc('tools/call', {
      name: 'compose_prompt',
      arguments: { prompt: 'make a function that validates emails', post_critique: true, auto_revise: false, skip_intent_resolution: true },
      _meta: { progressToken: 'compose-1' },   // opt into progress
    });
  } catch (err) {
    skip(`compose_prompt unreachable (model ${MODEL}?): ${err.message.slice(0, 80)}`);
    res = null;
  }
  if (res) {
    const mine = progressMsgs.filter(p => p.progressToken === 'compose-1');
    mine.length >= 1 ? ok(`received ${mine.length} progress notification(s): ${mine.map(p => p.message).join(' · ').slice(0, 120)}`) : bad('no progress notifications', JSON.stringify(progressMsgs).slice(0, 160));
    mine.every((p, i) => p.progress === i + 1) ? ok('progress counter increments monotonically') : bad('progress counter', JSON.stringify(mine.map(p => p.progress)));
  }
} catch (err) {
  bad('wire progress test crashed', err.message);
} finally {
  server.kill();
}

console.log('');
if (failures === 0) console.log(C.g('✔ cancellation + progress battery passed.'));
else { console.log(C.r(`✖ cancellation battery: ${failures} failure(s).`)); process.exitCode = 1; }
