#!/usr/bin/env node

// Resolve repo root from this file's location so tests are portable across clones.
import { fileURLToPath } from 'node:url';
import * as _path from 'node:path';
const REPO_ROOT = _path.resolve(_path.dirname(fileURLToPath(import.meta.url)), '..');
// Drive the ClarifyPrompt MCP server over real stdio JSON-RPC.
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';

const SERVER = `${REPO_ROOT}/dist/index.js`;
const DATA_DIR = path.join(os.tmpdir(), 'clarify-mcp-wire-data');
await fs.rm(DATA_DIR, { recursive: true, force: true });

const server = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    LLM_API_URL: 'http://localhost:11434/v1',
    LLM_API_KEY: '',
    LLM_MODEL: 'qwen2.5-coder:7b-instruct-q4_K_M',
    CLARIFYPROMPT_TRACE: 'local',
    CLARIFYPROMPT_DATA_DIR: DATA_DIR,
  },
});

let nextId = 1;
const pending = new Map();
let buf = '';
server.stdout.on('data', chunk => {
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
server.stderr.on('data', d => process.stderr.write(`[server stderr] ${d}`));
server.on('close', code => console.log(`[server exited ${code}]`));

function rpc(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    server.stdin.write(JSON.stringify(msg) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 120_000);
  });
}

function sep(t) { console.log(`\n\x1b[36m━━━ ${t} ${'━'.repeat(Math.max(0, 68 - t.length))}\x1b[0m`); }
function kv(k, v) { console.log(`  \x1b[90m${k}:\x1b[0m ${v}`); }

try {
  sep('W1: initialize handshake');
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'wire-test', version: '0.0.1' },
  });
  kv('server name', init.serverInfo.name);
  kv('server version', init.serverInfo.version);
  kv('protocol version', init.protocolVersion);
  await rpc('notifications/initialized', {}).catch(() => {}); // notification — no response

  sep('W2: tools/list');
  const { tools } = await rpc('tools/list', {});
  kv('tool count', tools.length);
  kv('tool names', tools.map(t => t.name).join(', '));

  sep('W3: call inspect_context');
  const inspect = await rpc('tools/call', {
    name: 'inspect_context',
    arguments: {
      prompt: 'refactor the auth middleware',
      cwd: '/Users/ar/Code/clarifyprompt-mcp',
      skip_intent_resolution: true,
    },
  });
  const bundle = JSON.parse(inspect.content[0].text);
  kv('schemaVersion', bundle.schemaVersion);
  kv('target family', bundle.targetModel?.family);
  kv('frameworks detected', bundle.project.frameworks.join(', '));
  kv('languages', bundle.project.languages.join(', '));
  kv('session id', bundle.session.sessionId);

  sep('W4: call optimize_prompt (code, qwen2.5-coder)');
  const opt = await rpc('tools/call', {
    name: 'optimize_prompt',
    arguments: {
      prompt: 'parse iso 8601 dates in typescript',
      category: 'code',
      platform: 'claude',
      mode: 'concise',
      include_bundle: true,
    },
  });
  const res = JSON.parse(opt.content[0].text);
  kv('id', res.id);
  kv('category/platform/mode', `${res.category}/${res.platform}/${res.mode}`);
  kv('intent', res.intent ? `${res.intent.detected}/${res.intent.confidence}` : '(none)');
  kv('bundle summary', JSON.stringify(res.bundle));
  kv('model', res.metadata.model);
  kv('strategy', res.metadata.strategy);
  kv('latencyMs', res.metadata.processingTimeMs);
  kv('output[0..220]', res.optimizedPrompt.replace(/\n/g, ' ⏎ ').slice(0, 220) + (res.optimizedPrompt.length > 220 ? '…' : ''));
  const OPT_ID = res.id;

  sep('W5: call list_traces');
  const list = await rpc('tools/call', {
    name: 'list_traces',
    arguments: { limit: 10 },
  });
  const traces = JSON.parse(list.content[0].text);
  kv('mode', traces.mode);
  kv('tracesDir', traces.tracesDir);
  kv('count', traces.count);
  if (traces.entries?.length) {
    const e = traces.entries[traces.entries.length - 1];
    kv('latest entry', `id=${e.id}  category=${e.category}  intent=${e.intent}  model=${'(in detail fetch)'}  latencyMs=${e.latencyMs}`);
  }

  sep('W6: call get_trace with the optimization id');
  const got = await rpc('tools/call', {
    name: 'get_trace',
    arguments: { id: OPT_ID },
  });
  const full = JSON.parse(got.content[0].text);
  kv('id', full.id);
  kv('model', full.model);
  kv('strategy', full.strategy);
  kv('bundleSummary', JSON.stringify(full.bundleSummary));
  kv('systemPrompt length', full.systemPrompt.length);
  kv('output length', full.output.optimizedPrompt.length);

  sep('W7: call list_categories');
  const cats = await rpc('tools/call', { name: 'list_categories', arguments: {} });
  const catArr = JSON.parse(cats.content[0].text);
  kv('category count', catArr.length);
  kv('category ids', catArr.map(c => c.id).join(', '));
  const code = catArr.find(c => c.id === 'code');
  kv('code platforms', `builtin=${code.builtin_count} custom=${code.custom_count} default=${code.default_platform}`);

  console.log('\n\x1b[32m✔ MCP stdio wire protocol verified end-to-end.\x1b[0m\n');
} catch (err) {
  console.error('\n\x1b[31m✖ wire test failed:\x1b[0m', err.message);
  process.exitCode = 1;
} finally {
  server.kill();
}
