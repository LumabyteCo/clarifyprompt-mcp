#!/usr/bin/env node

// Wire-level coverage for the MCP Apps compose panel (extension
// io.modelcontextprotocol/ui). Deterministic: registration metadata + the
// bundled ui:// resource only — no LLM required.
//
// Usage: node tests/apps.mjs   (run `npm run build` first)

import { fileURLToPath } from 'node:url';
import * as _path from 'node:path';
const REPO_ROOT = _path.resolve(_path.dirname(fileURLToPath(import.meta.url)), '..');
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';

const SERVER = `${REPO_ROOT}/dist/index.js`;
const PANEL_URI = 'ui://clarifyprompt/compose-panel.html';
const PANEL_MIME = 'text/html;profile=mcp-app';
const DATA_DIR = path.join(os.tmpdir(), 'clarify-mcp-apps-data');
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
  sep('A1: tools/list — compose_prompt carries _meta.ui.resourceUri');
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'apps-test', version: '0' } });
  await rpc('notifications/initialized', {}).catch(() => {});
  const tools = await rpc('tools/list', {});
  const compose = (tools.tools || []).find(t => t.name === 'compose_prompt');
  const uiMeta = compose?._meta?.ui;
  kv('compose_prompt._meta.ui', JSON.stringify(uiMeta));
  uiMeta?.resourceUri === PANEL_URI
    ? ok('compose_prompt links the panel resource (modern nested key)')
    : bad('compose_prompt _meta.ui.resourceUri', JSON.stringify(compose?._meta));
  compose?._meta?.['ui/resourceUri'] === PANEL_URI
    ? ok('legacy "ui/resourceUri" key also present (older-host compat)')
    : bad('legacy ui/resourceUri key missing', JSON.stringify(compose?._meta));
  const otherWithUi = (tools.tools || []).filter(t => t.name !== 'compose_prompt' && t._meta?.ui);
  otherWithUi.length === 0
    ? ok('no other tool accidentally carries ui metadata')
    : bad('unexpected ui metadata on', otherWithUi.map(t => t.name).join(', '));

  sep('A2: resources/list — the ui:// panel resource is declared');
  const list = await rpc('resources/list', {});
  const panel = (list.resources || []).find(r => r.uri === PANEL_URI);
  kv('panel resource', JSON.stringify(panel));
  panel ? ok('panel resource listed') : bad('panel resource missing from resources/list');
  panel?.mimeType === PANEL_MIME
    ? ok(`mimeType is ${PANEL_MIME}`)
    : bad('panel mimeType', panel?.mimeType);

  sep('A3: resources/read — bundled, self-contained HTML');
  const read = await rpc('resources/read', { uri: PANEL_URI });
  const c = read.contents?.[0];
  const html = c?.text || '';
  kv('bytes', html.length);
  c?.mimeType === PANEL_MIME ? ok('read mimeType correct') : bad('read mimeType', c?.mimeType);
  html.toLowerCase().startsWith('<!doctype html') ? ok('starts with doctype') : bad('doctype missing', html.slice(0, 60));
  html.includes('ClarifyPrompt Compose Panel') ? ok('panel bridge code present') : bad('panel JS missing (bundle not injected?)');
  !html.includes('<!--PANEL_JS-->') ? ok('build marker replaced') : bad('PANEL_JS marker still present — build:panel did not run');
  html.length > 50_000 ? ok('bundle size sane (App bridge inlined)') : bad('panel suspiciously small', `${html.length} bytes`);

  sep('A4: CSP self-containment — no external script/style/font references');
  const external = html.match(/<(script|link)[^>]+(src|href)\s*=\s*["']https?:\/\//gi) || [];
  external.length === 0
    ? ok('no external <script src>/<link href>')
    : bad('external references found', external.join(' | '));
  /<script>/.test(html) ? ok('inline script tag present') : bad('no inline script tag');
} catch (err) {
  bad('battery crashed', err.message);
} finally {
  server.kill();
}

console.log(failures === 0 ? `\n${C.g(`✔ Apps battery passed all cases.`)}` : `\n${C.r(`✖ ${failures} failure(s).`)}`);
process.exit(failures === 0 ? 0 : 1);
