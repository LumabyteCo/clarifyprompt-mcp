#!/usr/bin/env node

// Wire-level coverage for the 1.8.0 resource templates + completion (roadmap #3).
// Deterministic: the assertions below hit pure-registry reads + completion, so no
// LLM or embedding endpoint is required. (Pack/fact reads share the same store
// getters the day2 battery already exercises.)
//
// Usage: node tests/mcp-resources.mjs   (run `npm run build` first)

import { fileURLToPath } from 'node:url';
import * as _path from 'node:path';
const REPO_ROOT = _path.resolve(_path.dirname(fileURLToPath(import.meta.url)), '..');
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';

const SERVER = `${REPO_ROOT}/dist/index.js`;
const DATA_DIR = path.join(os.tmpdir(), 'clarify-mcp-resources-data');
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
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 30_000);
  });
}

let failures = 0;
const C = { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, d: s => `\x1b[90m${s}\x1b[0m`, c: s => `\x1b[36m${s}\x1b[0m` };
function sep(t) { console.log(`\n${C.c('━━━ ' + t + ' ' + '━'.repeat(Math.max(0, 64 - t.length)))}`); }
function kv(k, val) { console.log(`  ${C.d(k + ':')} ${val}`); }
function ok(n) { console.log(`  ${C.g('✔')} ${n}`); }
function bad(n, d) { failures++; console.log(`  ${C.r('✖')} ${n}`); if (d) console.log(C.d(`      ${d}`)); }

try {
  sep('initialize — capabilities advertise resources + completions');
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'res-test', version: '0' } });
  await rpc('notifications/initialized', {}).catch(() => {});
  kv('capabilities', JSON.stringify(init.capabilities));
  init.capabilities?.resources ? ok('resources capability advertised') : bad('resources capability', JSON.stringify(init.capabilities));
  init.capabilities?.completions ? ok('completions capability advertised') : bad('completions capability', JSON.stringify(init.capabilities));

  sep('resources/templates/list — the 4 new templates');
  const tpl = await rpc('resources/templates/list', {});
  const tplUris = (tpl.resourceTemplates || []).map(t => t.uriTemplate);
  kv('templates', tplUris.join('  '));
  for (const want of [
    'clarifyprompt://platforms/{category}/{id}',
    'clarifyprompt://traces/{date}',
    'clarifyprompt://packs/{id}',
    'clarifyprompt://memory/facts/{scope}',
  ]) {
    tplUris.includes(want) ? ok(`template present: ${want}`) : bad(`template missing: ${want}`);
  }

  sep('resources/list — static categories still present');
  const list = await rpc('resources/list', {});
  const uris = (list.resources || []).map(r => r.uri);
  kv('resources', uris.join('  '));
  uris.includes('clarifyprompt://categories') ? ok('categories resource present') : bad('categories resource missing');

  sep('resources/read — platforms/image/midjourney (pure registry, no LLM)');
  const read = await rpc('resources/read', { uri: 'clarifyprompt://platforms/image/midjourney' });
  const body = JSON.parse(read.contents[0].text);
  kv('id', body.id);
  kv('label', body.label);
  body.id === 'midjourney' && !body.error ? ok('read returned midjourney platform config') : bad('platform read', read.contents[0].text.slice(0, 160));

  sep('completion/complete — autocomplete {category} variable');
  const compCat = await rpc('completion/complete', {
    ref: { type: 'ref/resource', uri: 'clarifyprompt://platforms/{category}/{id}' },
    argument: { name: 'category', value: 'im' },
  });
  kv('values', JSON.stringify(compCat.completion?.values));
  (compCat.completion?.values || []).includes('image') ? ok('"im" → image') : bad('category completion', JSON.stringify(compCat.completion));

  sep('completion/complete — autocomplete {id} scoped by category=image');
  const compId = await rpc('completion/complete', {
    ref: { type: 'ref/resource', uri: 'clarifyprompt://platforms/{category}/{id}' },
    argument: { name: 'id', value: 'mid' },
    context: { arguments: { category: 'image' } },
  });
  kv('values', JSON.stringify(compId.completion?.values));
  (compId.completion?.values || []).includes('midjourney') ? ok('"mid" (category=image) → midjourney') : bad('id completion', JSON.stringify(compId.completion));

  sep('resources/read — traces/{date} for an empty day degrades gracefully');
  const tr = await rpc('resources/read', { uri: 'clarifyprompt://traces/2099-01-01' });
  const trBody = JSON.parse(tr.contents[0].text);
  kv('shape', JSON.stringify(trBody).slice(0, 120));
  (trBody.count === 0 || trBody.mode === 'off') ? ok('empty-day trace read returned a clean shape (no throw)') : bad('trace read', JSON.stringify(trBody).slice(0, 160));

  console.log('');
  if (failures === 0) console.log(C.g('✔ resource-template + completion wire coverage passed.'));
  else { console.log(C.r(`✖ ${failures} failure(s).`)); process.exitCode = 1; }
} catch (err) {
  console.error(C.r('✖ resources test crashed:'), err.message);
  process.exitCode = 1;
} finally {
  server.kill();
}
