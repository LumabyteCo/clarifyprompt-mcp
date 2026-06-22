#!/usr/bin/env node

// Smoke test for the 1.12.0 A2A transport (roadmap #7).
// Spawns the server with CLARIFYPROMPT_TRANSPORT=a2a and exercises it as an
// Agent-to-Agent peer: agent card discovery, health, a live message/send that
// compiles a prompt and returns the artifact, and a 404. The card/health/404
// checks are deterministic; message/send needs a local model (degrades to SKIP).
//
// Usage: node tests/a2a-transport.mjs   (run `npm run build` first)

import { fileURLToPath } from 'node:url';
import * as _path from 'node:path';
const REPO_ROOT = _path.resolve(_path.dirname(fileURLToPath(import.meta.url)), '..');
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as net from 'node:net';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';

const PORT = 39621;
const BASE = `http://127.0.0.1:${PORT}`;
const A2A = `${BASE}/a2a`;
const DATA_DIR = path.join(os.tmpdir(), 'clarify-a2a-data');
await fs.rm(DATA_DIR, { recursive: true, force: true });
const MODEL = process.env.LLM_MODEL || 'qwen2.5-coder:7b-instruct-q4_K_M';

let failures = 0;
const C = { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, d: s => `\x1b[90m${s}\x1b[0m`, c: s => `\x1b[36m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m` };
const sep = t => console.log(`\n${C.c('━━━ ' + t + ' ' + '━'.repeat(Math.max(0, 54 - t.length)))}`);
const ok = n => console.log(`  ${C.g('✔')} ${n}`);
const skip = n => console.log(`  ${C.y('⊘')} ${n}`);
const bad = (n, d) => { failures++; console.log(`  ${C.r('✖')} ${n}`); if (d) console.log(C.d(`      ${d}`)); };

const server = spawn(process.execPath, [`${REPO_ROOT}/dist/index.js`], {
  env: {
    ...process.env,
    CLARIFYPROMPT_TRANSPORT: 'a2a',
    CLARIFYPROMPT_HTTP_PORT: String(PORT),
    CLARIFYPROMPT_HTTP_HOST: '127.0.0.1',
    LLM_API_URL: process.env.LLM_API_URL || 'http://localhost:11434/v1',
    LLM_MODEL: MODEL,
    CLARIFYPROMPT_TRACE: 'off',
    CLARIFYPROMPT_DATA_DIR: DATA_DIR,
  },
});
let serverErr = '';
server.stderr.on('data', d => { serverErr += d; });
await new Promise((resolve, reject) => {
  const deadline = setTimeout(() => reject(new Error(`server did not start in 10s. stderr:\n${serverErr}`)), 10_000);
  const iv = setInterval(() => { if (/A2A agent .* listening/.test(serverErr)) { clearInterval(iv); clearTimeout(deadline); resolve(); } }, 100);
});

try {
  sep('A1: agent card discovery (/.well-known/agent-card.json)');
  {
    const r = await fetch(`${BASE}/.well-known/agent-card.json`);
    const card = await r.json();
    (r.status === 200 && card.name === 'ClarifyPrompt') ? ok(`card served: ${card.name} v${card.version}, protocol ${card.protocolVersion}`) : bad('agent card', `${r.status} ${JSON.stringify(card).slice(0, 160)}`);
    const skill = (card.skills || [])[0];
    (skill && skill.id === 'compile-prompt-for-platform') ? ok(`skill present: ${skill.id}`) : bad('skill', JSON.stringify(card.skills));
    (card.url === A2A && card.capabilities?.streaming === true) ? ok('url + streaming capability correct') : bad('card url/caps', `url=${card.url} caps=${JSON.stringify(card.capabilities)}`);
  }

  sep('A2: /health');
  {
    const r = await fetch(`${BASE}/health`);
    const b = await r.json();
    (r.status === 200 && b.transport === 'a2a') ? ok(`health OK (${JSON.stringify(b)})`) : bad('health', JSON.stringify(b));
  }

  sep('A3: unknown path → 404');
  {
    const r = await fetch(`${BASE}/nope`);
    r.status === 404 ? ok('unknown path returns 404') : bad('404', `got ${r.status}`);
  }

  sep('AH: hardening (deterministic — no model)');
  {
    // AH1: empty prompt → a clean `failed` task (the guard fires before any LLM
    // call, so this is deterministic). Regression for the orphan-status bug.
    const r1 = await fetch(A2A, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'message/send',
      params: { message: { kind: 'message', messageId: randomUUID(), role: 'user', parts: [{ kind: 'text', text: '   ' }] } },
    }) });
    const j1 = await r1.json();
    (j1.result?.kind === 'task' && j1.result.status?.state === 'failed' && !j1.error)
      ? ok('empty prompt → clean failed task (not an opaque internal error)')
      : bad('empty-prompt failed task', JSON.stringify(j1).slice(0, 160));

    // AH2: malformed JSON body → spec-correct JSON-RPC -32700 parse error.
    const r2 = await fetch(A2A, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{ this is not json ' });
    const j2 = await r2.json();
    j2.error?.code === -32700 ? ok('malformed JSON → -32700 parse error') : bad('malformed JSON code', JSON.stringify(j2).slice(0, 140));

    // AH3: oversized body → 413 (not buffered into memory).
    const big = 'x'.repeat(5 * 1024 * 1024); // 5 MB > 4 MB cap
    const r3 = await fetch(A2A, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big }).catch(e => ({ _err: e.message }));
    (r3.status === 413 || r3._err) ? ok(`oversized body rejected (${r3.status ?? 'socket closed: ' + r3._err?.slice(0, 40)})`) : bad('oversized body', `got ${r3.status}`);

    // AH4: a malformed raw request line (`GET // HTTP/1.1`) must NOT crash the
    // process — `new URL()` throws on it, and an unguarded throw exits Node.
    const rawResp = await new Promise(resolve => {
      const sock = net.connect(PORT, '127.0.0.1', () => sock.write('GET // HTTP/1.1\r\nHost: x\r\n\r\n'));
      let buf = '';
      sock.on('data', d => { buf += d; });
      sock.on('close', () => resolve(buf));
      sock.on('error', () => resolve(buf));
      setTimeout(() => { sock.destroy(); resolve(buf); }, 1500);
    });
    /400|Bad/.test(rawResp) ? ok('malformed request line → 400, process survives') : bad('raw malformed request', rawResp.slice(0, 80) || '(no response)');
    // Prove the server is still alive after the malformed request.
    const alive = await fetch(`${BASE}/health`).then(r => r.ok).catch(() => false);
    alive ? ok('server still serving /health after the malformed request') : bad('server crashed on malformed request', 'health unreachable');
  }

  sep('A4: message/send compiles a prompt → artifact (live, needs model)');
  {
    let res;
    try {
      const r = await fetch(A2A, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'message/send',
        params: { message: { kind: 'message', messageId: randomUUID(), role: 'user', parts: [{ kind: 'text', text: 'write a function to validate emails' }] } },
      }) });
      res = await r.json();
    } catch (err) { res = { _err: err.message }; }

    if (res?._err || res?.error) {
      const msg = res._err || JSON.stringify(res.error);
      /model|connect|fetch|ECONNREFUSED|not found/i.test(msg) ? skip(`message/send needs a local model (${MODEL}): ${msg.slice(0, 90)}`) : bad('message/send error', msg.slice(0, 200));
    } else {
      const result = res.result;
      const kind = result?.kind;
      ok(`message/send returned a ${kind}`);
      if (kind === 'task') {
        result.status?.state === 'completed' ? ok(`task completed`) : bad('task state', JSON.stringify(result.status));
        const art = (result.artifacts || [])[0];
        const textPart = art?.parts?.find(p => p.kind === 'text');
        (textPart && textPart.text && textPart.text.length > 10) ? ok(`artifact carries the optimized prompt (${textPart.text.length} chars): "${textPart.text.slice(0, 70)}…"`) : bad('artifact', JSON.stringify(art).slice(0, 160));
        const dataPart = art?.parts?.find(p => p.kind === 'data');
        (dataPart && dataPart.data?.finalPrompt) ? ok('artifact also carries the structured compose result (data part)') : bad('data part', JSON.stringify(dataPart).slice(0, 120));
      } else if (kind === 'message') {
        const t = (result.parts || []).find(p => p.kind === 'text');
        t?.text ? ok(`message reply: "${t.text.slice(0, 70)}…"`) : bad('message parts', JSON.stringify(result.parts));
      } else {
        bad('unexpected result kind', JSON.stringify(res).slice(0, 200));
      }
    }
  }

  sep('A5: opt-in clarify → input-required round-trip (live, needs model)');
  {
    const send = body => fetch(A2A, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    let t1;
    try {
      // pre_clarify:'always' forces the clarify stage, so questions deterministically surface.
      t1 = await send({ jsonrpc: '2.0', id: 10, method: 'message/send', params: { message: { kind: 'message', messageId: randomUUID(), role: 'user',
        parts: [{ kind: 'text', text: JSON.stringify({ prompt: 'make it better', pre_clarify: 'always' }) }] } } });
    } catch (err) { t1 = { _err: err.message }; }

    if (t1?._err || t1?.error) {
      const m = t1._err || JSON.stringify(t1.error);
      /model|connect|fetch|ECONNREFUSED|not found/i.test(m) ? skip(`clarify round-trip needs a local model: ${m.slice(0, 80)}`) : bad('clarify turn 1', m.slice(0, 160));
    } else {
      const task = t1.result;
      task?.status?.state === 'input-required' ? ok('turn 1 paused on input-required (did not echo the un-optimized prompt)') : bad('turn 1 state', JSON.stringify(task?.status?.state));
      const msg = task?.status?.message;
      const qText = msg?.parts?.find(p => p.kind === 'text')?.text;
      const qData = msg?.parts?.find(p => p.kind === 'data')?.data;
      (qText && qData?.clarification?.questions?.length > 0) ? ok(`clarification carried as text + ${qData.clarification.questions.length} structured question(s)`) : bad('clarification payload', JSON.stringify(msg).slice(0, 160));

      // Turn 2: resume the SAME task with an augmented prompt → should compile, not re-ask.
      let t2;
      try {
        t2 = await send({ jsonrpc: '2.0', id: 11, method: 'message/send', params: { message: { kind: 'message', messageId: randomUUID(), role: 'user', taskId: task.id, contextId: task.contextId,
          parts: [{ kind: 'text', text: 'rewrite this onboarding email to be warmer and under 80 words for new SaaS signups' }] } } });
      } catch (err) { t2 = { _err: err.message }; }
      if (t2?._err || t2?.error) {
        bad('clarify turn 2', (t2._err || JSON.stringify(t2.error)).slice(0, 160));
      } else {
        t2.result?.status?.state === 'completed' ? ok('turn 2 (resume) compiled to completed — clarify not re-asked') : bad('turn 2 state', JSON.stringify(t2.result?.status?.state));
        ((t2.result?.artifacts?.length || 0) > 0) ? ok('turn 2 produced the optimized-prompt artifact') : bad('turn 2 artifact', 'missing');
      }
    }
  }

  sep('A6: message/stream → SSE progress + artifact (live, needs model)');
  {
    let r;
    try {
      r = await fetch(A2A, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({
        jsonrpc: '2.0', id: 20, method: 'message/stream',
        params: { message: { kind: 'message', messageId: randomUUID(), role: 'user', parts: [{ kind: 'text', text: 'write a haiku about databases' }] } },
      }) });
    } catch (err) { r = { _err: err.message }; }

    if (r?._err) {
      /model|connect|fetch|ECONNREFUSED/i.test(r._err) ? skip(`message/stream needs a local model: ${r._err.slice(0, 80)}`) : bad('message/stream', r._err.slice(0, 160));
    } else if (!/text\/event-stream/.test(r.headers.get('content-type') || '')) {
      bad('message/stream content-type', r.headers.get('content-type'));
    } else {
      ok('responds with text/event-stream');
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '', kinds = [], states = [], sawArtifact = false, modelErr = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const line = chunk.split('\n').find(l => l.startsWith('data:'));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            const r2 = ev.result || ev;
            kinds.push(r2.kind);
            if (r2.kind === 'status-update') { states.push(r2.status?.state); if (r2.status?.state === 'failed') modelErr = true; }
            if (r2.kind === 'artifact-update') sawArtifact = true;
            if (r2.kind === 'status-update' && r2.final) { await reader.cancel(); buf = ''; break; }
          } catch { /* skip non-JSON keepalives */ }
        }
      }
      if (modelErr && !sawArtifact) {
        skip(`stream reached a model error (states: ${states.join('→')})`);
      } else {
        kinds.includes('task') && kinds.includes('status-update') ? ok(`streamed events: ${[...new Set(kinds)].join(', ')}`) : bad('stream events', kinds.join(','));
        states.includes('working') ? ok(`progress streamed as status-updates: ${states.join(' → ')}`) : bad('stream progress', states.join('→'));
        sawArtifact ? ok('artifact streamed before completion') : bad('stream artifact', 'no artifact-update seen');
      }
    }
  }

  sep('A7: client disconnect mid-stream aborts the in-flight compose (live)');
  {
    const ac = new AbortController();
    let taskId, started = false;
    try {
      const r = await fetch(A2A, { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({
        jsonrpc: '2.0', id: 30, method: 'message/stream',
        params: { message: { kind: 'message', messageId: randomUUID(), role: 'user', parts: [{ kind: 'text', text: 'write a detailed 500-word technical essay about distributed consensus' }] } },
      }) });
      started = true;
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = chunk.split('\n').find(l => l.startsWith('data:'));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            const inner = ev.result || ev;
            if (inner.kind === 'task') { taskId = inner.id; ac.abort(); break outer; } // disconnect now
          } catch { /* */ }
        }
      }
    } catch (err) {
      if (!started) { /* connection refused → model/server unavailable */ }
    }

    if (!taskId) {
      skip('disconnect test needs a model to start the stream');
    } else {
      await new Promise(r => setTimeout(r, 2500)); // let the server observe the disconnect + abort
      const g = await fetch(A2A, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 31, method: 'tasks/get', params: { id: taskId } }) }).then(r => r.json()).catch(e => ({ _err: e.message }));
      const state = g.result?.status?.state;
      state === 'canceled' ? ok('disconnect aborted the compose (task → canceled; no orphaned LLM work)')
        : (state === 'completed' ? skip('compose finished before the disconnect landed (fast model) — re-run for the cancel path')
          : bad('disconnect cancel', `task state is '${state}', expected 'canceled'`));
    }
  }
} catch (err) {
  bad('a2a test crashed', `${err.message}\nserver stderr:\n${serverErr.slice(0, 300)}`);
} finally {
  server.kill();
}

console.log('');
if (failures === 0) console.log(C.g('✔ A2A transport smoke test passed.'));
else { console.log(C.r(`✖ a2a transport: ${failures} failure(s).`)); process.exitCode = 1; }
