#!/usr/bin/env node

// Resolve repo root from this file's location so tests are portable across clones.
import { fileURLToPath } from 'node:url';
import * as _path from 'node:path';
const REPO_ROOT = _path.resolve(_path.dirname(fileURLToPath(import.meta.url)), '..');
// Day 2 smoke test — Context Curator + persistent memory + knowledge packs + reflection.
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const SERVER = `${REPO_ROOT}/dist/index.js`;
const HOME = path.join(os.tmpdir(), 'clarify-day2-home');
await fs.rm(HOME, { recursive: true, force: true });
await fs.mkdir(HOME, { recursive: true });

function sep(t) { console.log(`\n\x1b[36m━━━ ${t} ${'━'.repeat(Math.max(0, 66 - t.length))}\x1b[0m`); }
function kv(k, v) { console.log(`  \x1b[90m${k}:\x1b[0m ${v}`); }
function pass(s) { console.log(`  \x1b[32m✔\x1b[0m ${s}`); }
function fail(s) { console.log(`  \x1b[31m✖\x1b[0m ${s}`); process.exitCode = 1; }

function startServer(env = {}) {
  const proc = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      LLM_API_URL: 'http://localhost:11434/v1',
      LLM_MODEL: 'qwen2.5-coder:7b-instruct-q4_K_M',
      EMBED_MODEL: 'nomic-embed-text:v1.5',
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
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 300_000);
    });
  }
  async function callTool(name, args) {
    const res = await rpc('tools/call', { name, arguments: args });
    return JSON.parse(res.content[0].text);
  }
  return { proc, rpc, callTool, stderr: () => stderrBuf.join('') };
}

const srv = startServer();
const init = await srv.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'day2', version: '0.0.1' } });
await srv.rpc('notifications/initialized', {}).catch(() => {});

// ---- D1: server version matches package.json + Day-2 tools all present ----
// Version-agnostic: asserts the SET of Day-2 tools exists, not a specific count,
// so post-1.3 versions that add new tools (1.4: clarify/ground/critique/compose)
// don't fail this battery.
const pkg = JSON.parse(await import('node:fs').then(fs => fs.promises.readFile('./package.json', 'utf-8')));
const EXPECTED_VERSION = pkg.version;

sep(`D1: server advertises ${EXPECTED_VERSION} and the 5 Day-2 tools (memory + packs + curator)`);
kv('server version', init.serverInfo.version);
const tools = (await srv.rpc('tools/list', {})).tools;
kv('tool count', tools.length);
const day2Tools = ['load_knowledge_pack', 'list_packs', 'unload_pack', 'memory_search', 'explain_last_curation'];
const missing = day2Tools.filter(n => !tools.some(t => t.name === n));
if (init.serverInfo.version === EXPECTED_VERSION && missing.length === 0) {
  pass(`${EXPECTED_VERSION} (matches package.json) + all 5 Day-2 tools present (server has ${tools.length} tools total)`);
} else {
  fail(`version=${init.serverInfo.version} (expected ${EXPECTED_VERSION}); tools=${tools.length}; missing=${missing.join(',') || '(none)'}`);
}

// ---- D2: load a knowledge pack, list, confirm ----
sep('D2: load knowledge pack from local path');
const packLoad = await srv.callTool('load_knowledge_pack', {
  source: '/Users/ar/Code/clarifyprompt-mcp/packs/nextjs-14-best-practices.md',
});
kv('chunks', packLoad.chunks);
kv('embedded', packLoad.embedded);
kv('pack name', packLoad.pack?.name);
if (packLoad.chunks > 5 && packLoad.embedded === packLoad.chunks) pass('pack loaded and all chunks embedded');
else fail(`chunks=${packLoad.chunks} embedded=${packLoad.embedded}`);

const packList = await srv.callTool('list_packs', {});
kv('loaded packs', packList.count);
kv('pack ids', packList.packs.map(p => p.name).join(', '));

// ---- D3: memory_search against pack ----
sep('D3: memory_search retrieves pack chunks by meaning');
const searchResult = await srv.callTool('memory_search', {
  query: 'when should I use a server component vs a client component',
  kinds: ['pack_chunk'],
  limit: 3,
});
kv('search hits', searchResult.count);
if (searchResult.results?.length) {
  kv('top match (sim)', searchResult.results[0].similarity.toFixed(3));
  kv('top match (preview)', searchResult.results[0].content.slice(0, 120).replace(/\n/g, ' ⏎ '));
}
if (searchResult.count > 0 && searchResult.results[0].similarity > 0.3) pass('semantic retrieval from pack works');
else fail('no usable pack hits');

// ---- D4: optimize with curator — confirm curation + memory in grounding ----
sep('D4: optimize_prompt emits curation log + retrieves from loaded pack');
const opt = await srv.callTool('optimize_prompt', {
  prompt: 'write a contact form component for our marketing page',
  category: 'code',
  platform: 'claude',
  include_bundle: true,
  skip_intent_resolution: true,
});
kv('opt id', opt.id);
kv('shape', `${opt.shape?.systemPromptBudget} / maxTokens=${opt.shape?.maxTokens}`);
kv('grounding.sources', opt.grounding?.sources?.join(', '));
kv('grounding.acceptedExamplesUsed', opt.grounding?.acceptedExamplesUsed);
kv('has error', !!opt.error);
const sawPackInGrounding = (opt.grounding?.sources ?? []).some(s => s.startsWith('memory:pack_chunk'));
if (opt.optimizedPrompt?.length > 40 && opt.grounding?.sources?.length > 0) pass('optimize+curator+memory integrated end-to-end');
else fail('optimize pipeline broken');
if (sawPackInGrounding) pass('pack chunk surfaced in grounding sources');
else console.log('  ⚠ pack chunk did not surface (prompt may not be similar enough to any pack section)');

// ---- D5: explain_last_curation ----
sep('D5: explain_last_curation renders a per-candidate breakdown');
const explain = await srv.callTool('explain_last_curation', { optimization_id: opt.id });
kv('explanation length', explain.explanation?.length ?? 0);
if (explain.explanation?.length > 100 && explain.raw?.selected?.length) {
  pass('curation explanation available');
  console.log('  \x1b[90m--- explanation preview ---\x1b[0m');
  console.log(explain.explanation.split('\n').slice(0, 10).join('\n'));
} else {
  fail('no curation log');
}

// ---- D6: save_outcome + reflection → extracts facts ----
sep('D6: save_outcome(accepted) triggers reflection that writes facts');
const outcome = await srv.callTool('save_outcome', {
  optimization_id: opt.id,
  session_id: opt.sessionId,
  verdict: 'accepted',
});
kv('reflection.factsExtracted', outcome.reflection?.factsExtracted);
kv('reflection.source', outcome.reflection?.source);
kv('notes', outcome.reflection?.notes ?? '(none)');
if (outcome.reflection?.factsExtracted >= 0 && outcome.reflection?.source !== 'error') {
  pass('reflection ran without error');
  if (outcome.reflection.factsExtracted > 0) pass(`reflected ${outcome.reflection.factsExtracted} fact(s) into persistent memory`);
} else {
  fail('reflection errored');
}

// ---- D7: memory_search now finds facts from reflection ----
sep('D7: memory_search (fact-kind) returns reflected facts');
const factSearch = await srv.callTool('memory_search', {
  query: 'marketing contact form conventions',
  kinds: ['fact'],
  limit: 3,
});
kv('fact search hits', factSearch.count);
if (factSearch.count > 0) pass(`found ${factSearch.count} fact(s) — reflection persisted them successfully`);
else console.log('  ⚠ no fact matches — either the LLM extracted nothing, or the query was too different');

// ---- D8: unload pack → it disappears ----
sep('D8: unload_pack removes pack + chunks');
const packId = packList.packs[0].id;
await srv.callTool('unload_pack', { id: packId });
const aftList = await srv.callTool('list_packs', {});
kv('packs after unload', aftList.count);
const aftSearch = await srv.callTool('memory_search', { query: 'server components', kinds: ['pack_chunk'], limit: 2 });
kv('pack_chunk search after unload', aftSearch.count);
if (aftList.count === packList.count - 1 && aftSearch.count === 0) pass('unload cascaded chunks + embeddings');
else fail('unload leaked chunks');

srv.proc.kill();
console.log('');
if (process.exitCode) console.log('\x1b[31m✖ Day-2 battery finished WITH failures.\x1b[0m');
else console.log('\x1b[32m✔ Day-2 battery passed.\x1b[0m');
