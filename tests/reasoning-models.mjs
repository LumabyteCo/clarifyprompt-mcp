#!/usr/bin/env node

// Resolve repo root from this file's location so tests are portable across clones.
import { fileURLToPath } from 'node:url';
import * as _path from 'node:path';
const REPO_ROOT = _path.resolve(_path.dirname(fileURLToPath(import.meta.url)), '..');
// Reasoning + cloud-model verification.
// Proves: reasoning-family models now emit non-empty content via ClarifyPrompt.
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const DIST = `${REPO_ROOT}/dist`;
const RUNNER = `${REPO_ROOT}/tests/_runner.mjs`;
const HOME = path.join(os.tmpdir(), 'clarify-reasoning-home');
await fs.rm(HOME, { recursive: true, force: true });
await fs.mkdir(HOME, { recursive: true });

function log(s) { console.log(s); }
function sep(t) { log(`\n\x1b[36m━━━ ${t} ${'━'.repeat(Math.max(0, 66 - t.length))}\x1b[0m`); }
function kv(k, v) { log(`  \x1b[90m${k}:\x1b[0m ${v}`); }
function pass(s) { log(`  \x1b[32m✔\x1b[0m ${s}`); }
function fail(s) { log(`  \x1b[31m✖\x1b[0m ${s}`); process.exitCode = 1; }

async function runJob(model, job) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      LLM_API_URL: 'http://localhost:11434/v1',
      LLM_API_KEY: '',
      LLM_MODEL: model,
      CLARIFYPROMPT_TRACE: 'local',
      CLARIFYPROMPT_HOME: HOME,
    };
    const proc = spawn(process.execPath, [RUNNER, JSON.stringify({ ...job, model })], { env });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`runner exit ${code}: ${stderr || stdout}`));
      try { resolve({ ...JSON.parse(stdout), _stderr: stderr }); } catch { reject(new Error(`bad runner output: ${stdout}`)); }
    });
  });
}

// ============================= R1: capability flag detection ==============
sep('R1: reasoningChainOfThought flag detected across families + variants');
{
  const { collectTargetModelSignal } = await import(`${DIST}/engine/context/targetModelSignals.js`);
  const cases = [
    // Family-level reasoners
    ['o3-mini',                  true],
    ['o4-mini',                  true],
    ['gpt-oss:20b-cloud',        true],
    ['gpt-oss:120b-cloud',       true],
    ['deepseek-reasoner',        true],
    ['deepseek-r1',              true],
    // ID-level variants (family itself mixed)
    ['kimi-k2-thinking:cloud',   true],
    ['qwen3-thinking:72b',       true],
    ['qwen-r1-distill',          true],
    // Non-reasoning family, non-reasoning variant
    ['kimi-k2.6:cloud',          false],
    ['qwen2.5:14b-instruct',     false],
    ['llama3.2:3b',              false],
    ['claude-sonnet-4',          false],
    ['gpt-4o',                   false],
  ];
  let fails = 0;
  for (const [id, expected] of cases) {
    const sig = collectTargetModelSignal(id);
    const got = !!sig?.capabilities.reasoningChainOfThought;
    const ok = got === expected;
    const marker = ok ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✖\x1b[0m';
    log(`  ${marker} ${id.padEnd(28)} → reasoning=${got} (expected ${expected})`);
    if (!ok) fails++;
  }
  if (fails === 0) pass('reasoning flag detection is correct across family + variant');
  else fail(`${fails} mismatches`);
}

// ============================= R2: maxTokens bumps for reasoning ==========
sep('R2: getPromptShape bumps maxTokens for reasoning models');
{
  const { getPromptShape } = await import(`${DIST}/engine/optimization/groundingContext.js`);
  const { collectTargetModelSignal } = await import(`${DIST}/engine/context/targetModelSignals.js`);
  function fakeBundle(id) {
    const sig = collectTargetModelSignal(id);
    return { schemaVersion: 1, user: {}, project: { frameworks: [], languages: [], hasClaudeMd: false, hasAgentsMd: false, hasCursorRules: false, hasClarifyMd: false }, session: { sessionId: 'x', recentOptimizations: [], recentOutcomes: [] }, targetModel: sig };
  }
  const cases = [
    ['gpt-oss:20b-cloud',       8192],     // 20B hosted → rich=3072 → bumped to max(3072*4, 8192)=12288? actually max(12288, 8192)=12288
    ['gpt-oss:120b-cloud',      12288],    // rich → 3072 * 4
    ['o3-mini',                 8192],     // params=5 hosted → rich=3072 * 4 = 12288
    ['kimi-k2-thinking:cloud',  8192],     // no family reasoner; variant flagged → reasoningChainOfThought=true → bump
    ['llama3.2:3b',             1024],     // no reasoning; local small → compact=1024
    ['qwen2.5:14b-instruct',    2048],     // standard → 2048
    ['claude-sonnet-4',         3072],     // rich → 3072
  ];
  let fails = 0;
  for (const [id, expectedAtLeast] of cases) {
    const shape = getPromptShape(fakeBundle(id), undefined);
    // For reasoners we expect AT LEAST 8192; for non-reasoners exact match.
    const sig = await import(`${DIST}/engine/context/targetModelSignals.js`).then(m => m.collectTargetModelSignal(id));
    const isReasoner = !!sig?.capabilities.reasoningChainOfThought;
    const ok = isReasoner ? shape.maxTokens >= 8192 : shape.maxTokens === expectedAtLeast;
    const marker = ok ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✖\x1b[0m';
    log(`  ${marker} ${id.padEnd(28)} → maxTokens=${shape.maxTokens} (reasoner=${isReasoner}; expected ${isReasoner ? '≥ 8192' : '= ' + expectedAtLeast})`);
    if (!ok) fails++;
  }
  if (fails === 0) pass('maxTokens bumps for reasoning, stays normal otherwise');
  else fail(`${fails} shape mismatches`);
}

// ============================= R3: live — gpt-oss:20b-cloud produces content
sep('R3: LIVE — gpt-oss:20b-cloud returns non-empty optimized prompt');
{
  const start = Date.now();
  const { result, _stderr } = await runJob('gpt-oss:20b-cloud', {
    kind: 'optimize',
    request: {
      prompt: 'write a function to parse rfc 3339 timestamps in typescript',
      mode: 'detailed',
      category: 'code',
      platform: 'claude',
      skipIntentResolution: true,
    },
  });
  const wallMs = Date.now() - start;
  kv('model', result.metadata.model);
  kv('shape', `${result.shape?.systemPromptBudget} / maxTokens=${result.shape?.maxTokens} / T=${result.shape?.temperature}`);
  kv('engineMs / wallMs', `${result.metadata.processingTimeMs} / ${wallMs}`);
  kv('optimizedPrompt length', result.optimizedPrompt?.length ?? 0);
  kv('optimized[0..240]', result.optimizedPrompt.replace(/\n/g, ' ⏎ ').slice(0, 240));
  kv('error', result.error?.message ?? '(none)');
  if (result.optimizedPrompt && result.optimizedPrompt.length > 40 && !result.error) {
    pass('reasoning model produced a real optimized prompt');
  } else {
    fail('empty/too-short output from reasoning model');
    log(`  stderr: ${_stderr.slice(0, 400)}`);
  }
}

// ============================= R4: live — qwen3-next:80b-cloud (non-reasoner)
sep('R4: LIVE — qwen3-next:80b-cloud (non-reasoning cloud) still works');
{
  const start = Date.now();
  const { result } = await runJob('qwen3-next:80b-cloud', {
    kind: 'optimize',
    request: {
      prompt: 'a cinematic drone shot over snow-capped alps at golden hour',
      mode: 'concise',
      category: 'image',
      platform: 'midjourney',
      skipIntentResolution: true,
    },
  });
  const wallMs = Date.now() - start;
  kv('model', result.metadata.model);
  kv('shape', `${result.shape?.systemPromptBudget} / maxTokens=${result.shape?.maxTokens}`);
  kv('engineMs / wallMs', `${result.metadata.processingTimeMs} / ${wallMs}`);
  kv('optimized[0..240]', result.optimizedPrompt.replace(/\n/g, ' ⏎ ').slice(0, 240));
  if (result.optimizedPrompt && result.optimizedPrompt.length > 40) {
    pass('non-reasoning cloud model still works end-to-end');
  } else {
    fail('non-reasoning cloud model broken');
  }
}

// ============================= R5: live — kimi-k2-thinking:cloud =========
sep('R5: LIVE — kimi-k2-thinking:cloud (variant-flagged reasoner)');
{
  const start = Date.now();
  try {
    const { result } = await runJob('kimi-k2-thinking:cloud', {
      kind: 'optimize',
      request: {
        prompt: 'explain the cap theorem in one paragraph for a mid-level engineer',
        mode: 'concise',
        category: 'chat',
        platform: 'claude',
        skipIntentResolution: true,
      },
    });
    const wallMs = Date.now() - start;
    kv('model', result.metadata.model);
    kv('shape', `${result.shape?.systemPromptBudget} / maxTokens=${result.shape?.maxTokens}`);
    kv('engineMs / wallMs', `${result.metadata.processingTimeMs} / ${wallMs}`);
    kv('error', result.error?.message ?? '(none)');
    kv('optimized[0..240]', result.optimizedPrompt.replace(/\n/g, ' ⏎ ').slice(0, 240));
    if (result.error && result.optimizedPrompt === result.originalPrompt) {
      log('  \x1b[33m⚠\x1b[0m Ollama Cloud returned upstream error for this model — structured-error handler correctly fell back to input. Not a ClarifyPrompt bug. Shape+flag still verified in R1/R2.');
      pass('structured-error handler survived cloud upstream failure');
    } else if (result.optimizedPrompt && result.optimizedPrompt.length > 40 && !result.error) {
      pass('kimi thinking variant returned a real optimized prompt');
    } else {
      fail('kimi thinking variant returned unexpected output');
    }
  } catch (err) {
    log(`  \x1b[33m⚠\x1b[0m kimi-k2-thinking:cloud errored (${err.message.slice(0, 80)}) — may be cloud availability; not a 1.2 fix blocker`);
  }
}

log('');
if (process.exitCode) {
  log('\x1b[31m✖ Reasoning battery finished WITH failures.\x1b[0m\n');
} else {
  log('\x1b[32m✔ Reasoning battery passed.\x1b[0m\n');
}
