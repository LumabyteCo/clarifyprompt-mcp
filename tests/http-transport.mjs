#!/usr/bin/env node

// Smoke test for the 1.11.0 streamable-http transport (roadmap #6).
// Spawns the server with CLARIFYPROMPT_TRANSPORT=streamable-http and drives a
// real MCP session over HTTP: initialize → session id → tools/list → /health.
// No LLM needed (pure protocol). Deterministic; CI-safe.
//
// Usage: node tests/http-transport.mjs   (run `npm run build` first)

import { fileURLToPath } from 'node:url';
import * as _path from 'node:path';
const REPO_ROOT = _path.resolve(_path.dirname(fileURLToPath(import.meta.url)), '..');
import { spawn } from 'node:child_process';
import * as net from 'node:net';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';

const PORT = 39517; // unlikely-to-collide test port
const BASE = `http://127.0.0.1:${PORT}`;
const MCP = `${BASE}/mcp`;
const DATA_DIR = path.join(os.tmpdir(), 'clarify-http-data');
await fs.rm(DATA_DIR, { recursive: true, force: true });

let failures = 0;
const C = { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, d: s => `\x1b[90m${s}\x1b[0m`, c: s => `\x1b[36m${s}\x1b[0m` };
const sep = t => console.log(`\n${C.c('━━━ ' + t + ' ' + '━'.repeat(Math.max(0, 56 - t.length)))}`);
const ok = n => console.log(`  ${C.g('✔')} ${n}`);
const bad = (n, d) => { failures++; console.log(`  ${C.r('✖')} ${n}`); if (d) console.log(C.d(`      ${d}`)); };

// Extract the first JSON-RPC message from a response body that may be raw JSON
// or SSE (`event: message\ndata: {...}`).
function parseRpc(text) {
  const t = text.trim();
  if (t.startsWith('{')) return JSON.parse(t);
  for (const line of t.split('\n')) {
    const s = line.trim();
    if (s.startsWith('data:')) return JSON.parse(s.slice(5).trim());
  }
  throw new Error(`no JSON-RPC in response: ${t.slice(0, 120)}`);
}

const server = spawn(process.execPath, [`${REPO_ROOT}/dist/index.js`], {
  env: {
    ...process.env,
    CLARIFYPROMPT_TRANSPORT: 'streamable-http',
    CLARIFYPROMPT_HTTP_PORT: String(PORT),
    CLARIFYPROMPT_HTTP_HOST: '127.0.0.1',
    LLM_API_URL: 'http://localhost:11434/v1',
    LLM_MODEL: 'dummy',
    CLARIFYPROMPT_TRACE: 'off',
    CLARIFYPROMPT_DATA_DIR: DATA_DIR,
  },
});
let serverErr = '';
server.stderr.on('data', d => { serverErr += d; });

// Wait for the "listening" banner (or timeout).
await new Promise((resolve, reject) => {
  const deadline = setTimeout(() => reject(new Error(`server did not start in 10s. stderr:\n${serverErr}`)), 10_000);
  const iv = setInterval(() => { if (/listening on/.test(serverErr)) { clearInterval(iv); clearTimeout(deadline); resolve(); } }, 100);
});

const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };

try {
  sep('H1: /health liveness probe');
  {
    const r = await fetch(`${BASE}/health`);
    const body = await r.json();
    (r.status === 200 && body.status === 'ok' && body.transport === 'streamable-http') ? ok(`health OK (${JSON.stringify(body)})`) : bad('health', `${r.status} ${JSON.stringify(body)}`);
  }

  sep('H2: initialize → server returns a session id');
  let sessionId;
  {
    const r = await fetch(MCP, { method: 'POST', headers, body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'http-test', version: '0' } },
    }) });
    sessionId = r.headers.get('mcp-session-id');
    const msg = parseRpc(await r.text());
    (r.ok && sessionId && msg.result?.serverInfo?.name === 'clarifyprompt') ? ok(`initialized, session=${sessionId?.slice(0, 8)}…, server=${msg.result.serverInfo.name} v${msg.result.serverInfo.version}`) : bad('initialize', `status=${r.status} session=${sessionId} ${JSON.stringify(msg).slice(0, 160)}`);
  }

  sep('H3: initialized notification + tools/list over the session');
  if (sessionId) {
    const sh = { ...headers, 'mcp-session-id': sessionId };
    await fetch(MCP, { method: 'POST', headers: sh, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    const r = await fetch(MCP, { method: 'POST', headers: sh, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
    const msg = parseRpc(await r.text());
    const tools = msg.result?.tools ?? [];
    tools.length === 23 ? ok(`tools/list returned all 23 tools over HTTP`) : bad('tools/list', `got ${tools.length} tools: ${tools.map(t => t.name).slice(0, 5).join(',')}…`);
    tools.find(t => t.name === 'compose_prompt') ? ok('compose_prompt present (full surface served over HTTP)') : bad('surface', 'compose_prompt missing');
  }

  sep('H4: unknown path → 404');
  {
    const r = await fetch(`${BASE}/nope`);
    r.status === 404 ? ok('unknown path returns 404') : bad('404', `got ${r.status}`);
  }

  sep('H5: second concurrent session gets its OWN id (no sharing)');
  {
    const r = await fetch(MCP, { method: 'POST', headers, body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'http-test-2', version: '0' } },
    }) });
    const sid2 = r.headers.get('mcp-session-id');
    (sid2 && sid2 !== sessionId) ? ok(`distinct session id for a second client (${sid2?.slice(0, 8)}… ≠ ${sessionId?.slice(0, 8)}…)`) : bad('session isolation', `sid2=${sid2}`);
  }

  sep('H6: malformed request line does not crash the process');
  {
    const rawResp = await new Promise(resolve => {
      const sock = net.connect(PORT, '127.0.0.1', () => sock.write('GET // HTTP/1.1\r\nHost: x\r\n\r\n'));
      let buf = '';
      sock.on('data', d => { buf += d; });
      sock.on('close', () => resolve(buf));
      sock.on('error', () => resolve(buf));
      setTimeout(() => { sock.destroy(); resolve(buf); }, 1500);
    });
    /400|Bad/.test(rawResp) ? ok('malformed request line → 400, no crash') : bad('raw malformed request', rawResp.slice(0, 80) || '(no response)');
    const alive = await fetch(`${BASE}/health`).then(r => r.ok).catch(() => false);
    alive ? ok('server still serving /health afterward') : bad('server crashed on malformed request', 'health unreachable');
  }
} catch (err) {
  bad('http test crashed', `${err.message}\nserver stderr:\n${serverErr.slice(0, 300)}`);
} finally {
  server.kill();
}

console.log('');
if (failures === 0) console.log(C.g('✔ streamable-http transport smoke test passed.'));
else { console.log(C.r(`✖ http transport: ${failures} failure(s).`)); process.exitCode = 1; }
