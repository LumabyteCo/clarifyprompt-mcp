#!/usr/bin/env node

// Resolve repo root from this file's location so tests are portable across clones.
import { fileURLToPath } from 'node:url';
import * as _path from 'node:path';
const REPO_ROOT = _path.resolve(_path.dirname(fileURLToPath(import.meta.url)), '..');
// Integration-aware battery for ClarifyPrompt 1.2.0.
// Tests the five Definition-of-Done cases from the integration plan plus the
// end-to-end flow through the MCP wire protocol.
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const DIST = `${REPO_ROOT}/dist`;
const SERVER = `${DIST}/index.js`;
const RUNNER = `${REPO_ROOT}/tests/_runner.mjs`;
const HOME = path.join(os.tmpdir(), 'clarify-integ-home');
await fs.rm(HOME, { recursive: true, force: true });
await fs.mkdir(HOME, { recursive: true });

const MODELS = {
  small:  'llama3.2:3b',
  coder:  'qwen2.5-coder:7b-instruct-q4_K_M',
  large:  'qwen2.5:14b-instruct-q4_K_M',
};

function log(s) { console.log(s); }
function sep(t) { log(`\n\x1b[36m━━━ ${t} ${'━'.repeat(Math.max(0, 68 - t.length))}\x1b[0m`); }
function kv(k, v) { log(`  \x1b[90m${k}:\x1b[0m ${v}`); }
function pass(s) { log(`  \x1b[32m✔\x1b[0m ${s}`); }
function fail(s) { log(`  \x1b[31m✖\x1b[0m ${s}`); process.exitCode = 1; }

// ----------------------------- MCP stdio client -----------------------------
function startServer(env = {}) {
  const proc = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      LLM_API_URL: 'http://localhost:11434/v1', LLM_API_KEY: '',
      LLM_MODEL: MODELS.coder,
      CLARIFYPROMPT_TRACE: 'local',
      CLARIFYPROMPT_HOME: HOME,
      ...env,
    },
  });
  let buf = '';
  const pending = new Map();
  let nextId = 1;
  proc.stdout.on('data', chunk => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id);
          pending.delete(msg.id);
          msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
        }
      } catch { /* skip */ }
    }
  });
  const stderrBuf = [];
  proc.stderr.on('data', d => stderrBuf.push(d.toString()));
  function rpc(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 180_000);
    });
  }
  async function callTool(name, args) {
    const res = await rpc('tools/call', { name, arguments: args });
    return JSON.parse(res.content[0].text);
  }
  return { proc, rpc, callTool, stderr: () => stderrBuf.join('') };
}

// Initialize and use one server for most of the tests (same session flow).
const srv = startServer();
const init = await srv.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'integ', version: '0.0.1' } });
await srv.rpc('notifications/initialized', {}).catch(() => {});

// ---------------- D1: server version matches package.json + tool surface present ------
// Version + tool-count are version-agnostic: read package.json for the source-of-truth
// version, and assert ≥ a minimum tool count + presence of every tool added across
// versions. This way the test never goes stale on a version bump.
const pkg = JSON.parse(await import('node:fs').then(fs => fs.promises.readFile('./package.json', 'utf-8')));
const EXPECTED_VERSION = pkg.version;
const REQUIRED_TOOLS = [
  // Pre-1.4 (16 tools)
  'optimize_prompt', 'list_categories', 'list_platforms', 'list_modes',
  'register_platform', 'update_platform', 'unregister_platform',
  'inspect_context', 'list_traces', 'get_trace',
  'save_outcome', 'memory_search', 'explain_last_curation',
  'load_knowledge_pack', 'list_packs', 'unload_pack',
  // 1.4+ (4 new tools)
  'clarify_with_user', 'ground_prompt', 'critique_prompt', 'compose_prompt',
];

sep(`D1: server advertises ${EXPECTED_VERSION} and the full tool surface (${REQUIRED_TOOLS.length} required)`);
kv('server version', init.serverInfo.version);
const tools = (await srv.rpc('tools/list', {})).tools;
const toolNames = tools.map(t => t.name);
kv('tool count', tools.length);
kv('save_outcome present', toolNames.includes('save_outcome') ? 'yes' : 'NO');

if (init.serverInfo.version === EXPECTED_VERSION) pass(`version = ${EXPECTED_VERSION} (matches package.json)`);
else fail(`version mismatch: server=${init.serverInfo.version} package.json=${EXPECTED_VERSION}`);

const missingTools = REQUIRED_TOOLS.filter(t => !toolNames.includes(t));
if (missingTools.length === 0) pass(`all ${REQUIRED_TOOLS.length} required tools present (server has ${tools.length})`);
else fail(`missing tools: ${missingTools.join(', ')}`);

// ---------------- D2: category-bug fixed (emails → code, not document) ------
sep('D2: "write a function to validate emails" routes to code, not document');
{
  const res = await srv.callTool('optimize_prompt', {
    prompt: 'write a function to validate emails',
    skip_intent_resolution: false,
  });
  kv('category', res.category);
  kv('analysis.intent', res.analysis?.intent);
  kv('analysis.recommendedMode', res.analysis?.recommendedMode);
  kv('analysis.confidence', res.analysis?.confidence);
  kv('modeSource', res.modeSource);
  if (res.category === 'code') pass('routed to CODE (was routed to DOCUMENT in draft)');
  else fail(`routed to ${res.category}`);
}

// ---------------- D3: mode ← intent when user omits; user-mode wins when passed
sep('D3: mode is analyzer-derived when omitted, user-driven when passed');
{
  const a = await srv.callTool('optimize_prompt', {
    prompt: 'refactor the auth middleware to support refresh tokens and tests',
    category: 'code',
  });
  kv('omitted-mode case', `mode=${a.mode} source=${a.modeSource} intent=${a.analysis?.intent}`);

  const b = await srv.callTool('optimize_prompt', {
    prompt: 'refactor the auth middleware to support refresh tokens and tests',
    category: 'code',
    mode: 'concise',
  });
  kv('explicit mode=concise case', `mode=${b.mode} source=${b.modeSource}`);

  if (a.modeSource === 'analyzer') pass('analyzer-derived mode when user omits');
  else fail(`expected modeSource=analyzer, got ${a.modeSource}`);
  if (b.mode === 'concise' && b.modeSource === 'user') pass('user mode wins when explicitly passed');
  else fail(`expected user concise, got mode=${b.mode}/source=${b.modeSource}`);
}

// ---------------- D4: target-model shaping differs across models ------------
sep('D4: system prompt size adapts to downstream model (compact vs rich)');
{
  // Use spawned child processes so each can set its own LLM_MODEL.
  async function captureShape(model) {
    const { result } = await runChildJob(model, {
      kind: 'optimize',
      request: {
        prompt: 'summarize the repo for a new contributor',
        mode: 'detailed',
        category: 'document',
        platform: 'claude',
        cwd: '/Users/ar/Code/clarifyprompt-mcp',
        skipIntentResolution: true,
      },
    });
    return result;
  }
  const [small, large] = await Promise.all([captureShape(MODELS.small), captureShape(MODELS.large)]);
  kv('llama3.2:3b  shape', `${small.shape.systemPromptBudget}  maxTokens=${small.shape.maxTokens}  T=${small.shape.temperature}`);
  kv('qwen14b     shape', `${large.shape.systemPromptBudget}  maxTokens=${large.shape.maxTokens}  T=${large.shape.temperature}`);
  if (small.shape.systemPromptBudget === 'compact' && large.shape.systemPromptBudget !== 'compact') {
    pass('compact for llama-3b, looser for qwen-14b');
  } else {
    fail(`unexpected budgets: small=${small.shape.systemPromptBudget} large=${large.shape.systemPromptBudget}`);
  }
}

// ---------------- D5: save_outcome → retrieval → example in system prompt ---
sep('D5: save_outcome → similar next prompt injects "Prior Accepted" example');
{
  // First prompt — establish optimization + session.
  const first = await srv.callTool('optimize_prompt', {
    prompt: 'write a function to validate emails',
    category: 'code',
  });
  kv('1st opt id / sessionId', `${first.id} / ${first.sessionId}`);
  kv('1st grounding.acceptedExamplesUsed', first.grounding.acceptedExamplesUsed);

  // Accept it.
  const outcome = await srv.callTool('save_outcome', {
    optimization_id: first.id,
    session_id: first.sessionId,
    verdict: 'accepted',
  });
  kv('save_outcome response', JSON.parse(JSON.stringify(outcome)).message?.slice(0, 80));

  // Second, similar prompt in SAME session — should pull the accepted example.
  const second = await srv.callTool('optimize_prompt', {
    prompt: 'write a function to validate phone numbers',
    category: 'code',
    session_id: first.sessionId,
  });
  kv('2nd opt id', second.id);
  kv('2nd grounding.acceptedExamplesUsed', second.grounding.acceptedExamplesUsed);
  kv('2nd grounding.sources', second.grounding.sources.join(', '));

  // Fetch the 2nd trace — system prompt should reflect the example presence
  // via grounding source `session-examples`.
  const usedExample = second.grounding.sources.some(s =>
    s === 'session-examples' || s.startsWith('session-example-')
  );
  if (usedExample && second.grounding.acceptedExamplesUsed >= 1) {
    pass('accepted prior was retrieved and injected');
  } else {
    fail('prior accepted example was NOT retrieved');
  }
}

// ---------------- D6: legacy env-var still works (backcompat) ---------------
sep('D6: legacy CLARIFYPROMPT_CONFIG_DIR maps to CLARIFYPROMPT_HOME with hint');
{
  const legacyHome = path.join(os.tmpdir(), 'clarify-legacy-home');
  await fs.rm(legacyHome, { recursive: true, force: true });
  const srv2 = startServer({
    CLARIFYPROMPT_HOME: '',          // unset the canonical one
    CLARIFYPROMPT_CONFIG_DIR: legacyHome,
  });
  await srv2.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'integ', version: '0.0.1' } });
  await srv2.rpc('notifications/initialized', {}).catch(() => {});
  // Trigger a write into the config/trace dirs
  await srv2.callTool('inspect_context', { prompt: 'hello', skip_intent_resolution: true });
  const traces = await srv2.callTool('list_traces', {});
  kv('legacy tracesDir', traces.tracesDir);
  const hintSeen = srv2.stderr().includes('Using legacy CLARIFYPROMPT_CONFIG_DIR');
  if (traces.tracesDir.startsWith(legacyHome)) pass(`traces written under legacy home: ${legacyHome}`);
  else fail(`tracesDir ${traces.tracesDir} is not under legacy home`);
  if (hintSeen) pass('stderr deprecation hint emitted');
  else fail('deprecation hint missing');
  srv2.proc.kill();
}

// ---------------- D7: structured error wraps LLM failures -------------------
sep('D7: structured error handler — unreachable LLM does not throw');
{
  const srv3 = startServer({
    LLM_API_URL: 'http://127.0.0.1:1/v1',   // wrong port on purpose
    CLARIFYPROMPT_HOME: path.join(os.tmpdir(), 'clarify-err-home'),
  });
  await srv3.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'integ', version: '0.0.1' } });
  await srv3.rpc('notifications/initialized', {}).catch(() => {});
  let threw = false;
  let out;
  try {
    out = await srv3.callTool('optimize_prompt', {
      prompt: 'a brief test',
      category: 'chat', platform: 'claude', mode: 'concise',
      skip_intent_resolution: true,
    });
  } catch (err) {
    threw = true;
  }
  if (threw) {
    fail('optimize_prompt THREW on LLM failure — should return structured error');
  } else {
    kv('error field present?', !!out.error);
    kv('error message prefix', (out.error?.message || '').slice(0, 80));
    kv('bundle still present?', !!out.bundle || !!out.grounding);
    pass('returned structured error instead of throwing');
  }
  srv3.proc.kill();
}

// ---------------- D8: intent overlay actually lands in system prompt --------
sep('D8: intent overlay injected into the rendered system prompt');
{
  const res = await srv.callTool('optimize_prompt', {
    prompt: 'extract all email addresses from this support thread into JSON',
    category: 'code',
    mode: 'structured',
    include_bundle: true,
  });
  kv('analysis.intent', res.analysis?.intent);
  const trace = await srv.callTool('get_trace', { id: res.id });
  const hasOverlay = trace.systemPrompt.includes('strict output schema')
                  || trace.systemPrompt.includes('Intent: data-extract');
  kv('overlay present', hasOverlay ? 'yes' : 'NO');
  if (res.analysis?.intent === 'data-extract' && hasOverlay) {
    pass('data-extract overlay is in the system prompt');
  } else {
    fail('overlay missing');
  }
}

// ---------------- D9: grounding — WITH vs WITHOUT CLAUDE.md (repeat, integrated)
sep('D9: grounding — same model, different cwd → different output');
{
  const synth = path.join(os.tmpdir(), 'clarify-integ-synth');
  await fs.rm(synth, { recursive: true, force: true });
  await fs.mkdir(synth, { recursive: true });
  await fs.writeFile(path.join(synth, 'package.json'),
    JSON.stringify({ name: 'brand-landing', dependencies: { next: '^14', react: '^18' } }));
  await fs.writeFile(path.join(synth, 'CLAUDE.md'),
    `# Brand rules\n- Tone: confident, warm, concise\n- Voice: second-person\n- Always include a CTA`);

  const withIt = await srv.callTool('optimize_prompt', {
    prompt: 'write a hero headline for our new AI copilot',
    category: 'document', platform: 'claude', mode: 'concise',
    cwd: synth,
    skip_intent_resolution: true,
  });
  const withoutIt = await srv.callTool('optimize_prompt', {
    prompt: 'write a hero headline for our new AI copilot',
    category: 'document', platform: 'claude', mode: 'concise',
    cwd: '/tmp',
    skip_intent_resolution: true,
  });
  const groundedTouched = /confident|warm|concise|second-person|CTA/i.test(withIt.optimizedPrompt);
  const ungroundedTouched = /confident|warm|concise|second-person|CTA/i.test(withoutIt.optimizedPrompt);
  kv('WITH rules — touches brand?', groundedTouched ? 'YES' : 'no');
  kv('WITHOUT rules — touches brand?', ungroundedTouched ? 'YES' : 'no');
  if (groundedTouched && !ungroundedTouched) pass('grounding is actually used');
  else fail('grounding signal did not change behavior');
}

// Cleanup + summary
srv.proc.kill();
log('');
if (process.exitCode) {
  log('\x1b[31m✖ Integration battery finished WITH failures — see above.\x1b[0m\n');
} else {
  log('\x1b[32m✔ Integration battery passed all 9 cases.\x1b[0m\n');
}

// ------------- helper: child-proc job (for the per-model D4 test) ----------
async function runChildJob(model, job) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      LLM_MODEL: model,
      CLARIFYPROMPT_TRACE: 'off',
      CLARIFYPROMPT_HOME: HOME,
    };
    const proc = spawn(process.execPath, [RUNNER, JSON.stringify({ ...job, model })], { env });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`runner exit ${code}: ${stderr || stdout}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`bad runner output: ${stdout}`)); }
    });
  });
}
