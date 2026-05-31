#!/usr/bin/env node
/**
 * ClarifyPrompt eval harness v0.
 *
 * Runs every YAML fixture in evals/fixtures/ against the configured LLM,
 * scores the result against declared expectations, and emits a tight
 * console summary plus a self-contained HTML report.
 *
 * Usage:
 *   npm run eval                                  # all fixtures, current LLM_MODEL
 *   npm run eval -- --filter analyzer             # only fixtures with 'analyzer' in name or tags
 *   npm run eval -- --no-html                     # skip the HTML report
 *   npm run eval -- --report-path ./out.html
 *   npm run eval -- --quiet                       # exit-code-only output for CI
 *
 * Skipping rules from fixtures: skip_unless_model_matches / skip_if_model_matches.
 *
 * Each fixture is one assertion bundle. Score = weighted-pass-rate of declared
 * checks. Threshold for "pass" is 0.85 by default.
 */

import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import yaml from 'js-yaml';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(REPO_ROOT, 'dist', 'index.js');
const FIXTURES_DIR = path.join(REPO_ROOT, 'evals', 'fixtures');
const PASS_THRESHOLD = 0.85;

// ───── argv parsing (no external dep) ─────
const argv = process.argv.slice(2);
const flag = (k, def) => {
  const i = argv.indexOf(k);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const FILTER       = flag('--filter', null);
const NO_HTML      = !!flag('--no-html', false);
const REPORT_PATH  = flag('--report-path', path.join(REPO_ROOT, 'evals', 'report.html'));
const JSON_OUT     = flag('--json-out', null);
const QUIET        = !!flag('--quiet', false);

const MODEL = process.env.LLM_MODEL || 'qwen2.5-coder:7b-instruct-q4_K_M';

// ───── colorized stdout helpers ─────
const C = {
  dim:   (s) => `\x1b[90m${s}\x1b[0m`,
  red:   (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan:  (s) => `\x1b[36m${s}\x1b[0m`,
  yellow:(s) => `\x1b[33m${s}\x1b[0m`,
  bold:  (s) => `\x1b[1m${s}\x1b[0m`,
};
const log = QUIET ? () => {} : (...a) => console.log(...a);

// ───── MCP stdio client ─────
function startServer(env = {}) {
  const proc = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      LLM_API_URL: process.env.LLM_API_URL || 'http://localhost:11434/v1',
      LLM_MODEL: MODEL,
      EMBED_MODEL: process.env.EMBED_MODEL || 'nomic-embed-text:v1.5',
      CLARIFYPROMPT_TRACE: 'local',
      ...env,
    },
  });
  let buf = '';
  const pending = new Map();
  let nextId = 1;
  proc.stdout.on('data', (chunk) => {
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
      } catch { /* skip non-JSON */ }
    }
  });
  const stderrBuf = [];
  proc.stderr.on('data', (d) => stderrBuf.push(d.toString()));

  function rpc(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); }
      }, 240_000);
    });
  }
  async function callTool(name, args) {
    const res = await rpc('tools/call', { name, arguments: args });
    const text = res?.content?.[0]?.text ?? '';
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // MCP servers return plain-text content when a tool handler THROWS
      // (the SDK wraps the error.message in content[0].text without
      // JSON.stringify-ing). Don't crash the whole harness on one bad
      // tool call — wrap as a synthetic error object so the fixture
      // can still report a useful failure.
      parsed = { error: text };
    }
    if (res?.isError) parsed._isError = true;
    return parsed;
  }
  return { proc, rpc, callTool, stderr: () => stderrBuf.join('') };
}

// ───── fixture loading ─────
async function loadFixtures() {
  const entries = await fs.readdir(FIXTURES_DIR);
  const yamlFiles = entries.filter((e) => e.endsWith('.yaml') || e.endsWith('.yml')).sort();
  const fixtures = [];
  for (const fname of yamlFiles) {
    const raw = await fs.readFile(path.join(FIXTURES_DIR, fname), 'utf-8');
    const f = yaml.load(raw);
    f._file = fname;
    fixtures.push(f);
  }
  return fixtures;
}

function shouldSkip(fixture, model) {
  if (fixture.skip_unless_model_matches) {
    const re = new RegExp(fixture.skip_unless_model_matches);
    if (!re.test(model)) return `skip_unless_model_matches=/${fixture.skip_unless_model_matches}/ vs LLM_MODEL=${model}`;
  }
  if (fixture.skip_if_model_matches) {
    const re = new RegExp(fixture.skip_if_model_matches);
    if (re.test(model)) return `skip_if_model_matches=/${fixture.skip_if_model_matches}/ vs LLM_MODEL=${model}`;
  }
  return null;
}

function passesFilter(fixture) {
  if (!FILTER) return true;
  const f = String(FILTER).toLowerCase();
  if ((fixture.name || '').toLowerCase().includes(f)) return true;
  if ((fixture.tags || []).some((t) => t.toLowerCase().includes(f))) return true;
  return false;
}

// ───── workspace materialization ─────
async function makeWorkspace(fixture) {
  if (!fixture.requires_workspace) return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clarify-eval-ws-'));
  for (const [rel, content] of Object.entries(fixture.requires_workspace)) {
    const target = path.join(dir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf-8');
  }
  return dir;
}

// ───── scoring ─────
const CHECK_WEIGHTS = {
  category: 2.0,
  platform: 1.0,
  intent: 1.5,
  intent_confidence: 1.0,
  intent_confidence_min: 1.0,
  mode: 1.0,
  mode_source: 1.0,
  recommended_mode: 1.0,
  shape_budget: 1.0,
  shape_max_tokens_min: 0.5,
  shape_max_tokens_max: 0.5,
  must_contain: 2.0,
  must_not_contain: 1.5,
  min_output_length: 0.5,
  max_output_length: 0.5,
  grounding_sources_must_include: 1.5,
  grounding_sources_must_exclude: 1.5,
  system_prompt_must_contain: 1.5,
  no_error: 2.0,
  // clarify_with_user checks
  clarification_needed: 2.0,
  min_questions: 1.0,
  max_questions: 1.0,
  question_dimensions_must_include: 1.5,
  questions_must_have_suggested_answer: 1.0,
  // ground_prompt checks
  used_sources_min: 2.0,
  dropped_sources_max: 1.0,
  // critique_prompt checks
  verdict: 2.0,
  overall_score_min: 1.5,
  overall_score_max: 1.5,
  dimension_must_include: 1.5,
  dimensions_min: 1.0,
  improved_prompt_present: 1.5,
  improved_prompt_absent: 1.0,
  // compose_prompt checks
  stages_must_include: 2.0,
  stages_must_exclude: 1.5,
  clarification_required: 2.0,
  revised: 1.5,
  iterations_min: 1.5,
  iterations_max: 1.0,
  // M1 per-stage model verification
  optimization_model_eq: 1.5,
  critique_model_eq: 1.5,
  // C1 + C4 context-signal checks
  bundle_has_git: 1.5,
  bundle_has_environment: 1.5,
  git_branch_present: 1.5,
  final_prompt_must_contain: 2.0,
  final_prompt_must_not_contain: 1.5,
  // memory_search checks
  count_min: 1.5,
  count_max: 1.0,
  top_result_must_contain: 2.0,
  top_result_kind: 1.5,
};

const CONFIDENCE_RANK = { low: 1, medium: 2, high: 3 };

function scoreCheck(name, expected, actual, opts = {}) {
  // Returns { passed: boolean, detail: string }
  switch (name) {
    case 'category':
    case 'platform':
    case 'intent':
    case 'intent_confidence':
    case 'mode':
    case 'mode_source':
    case 'recommended_mode':
    case 'shape_budget': {
      const pass = actual === expected;
      return { passed: pass, detail: pass ? `${actual}` : `expected ${expected}, got ${actual}` };
    }
    case 'intent_confidence_min': {
      const a = CONFIDENCE_RANK[actual] || 0;
      const e = CONFIDENCE_RANK[expected] || 0;
      const pass = a >= e;
      return { passed: pass, detail: pass ? `${actual} ≥ ${expected}` : `expected ≥${expected}, got ${actual}` };
    }
    case 'shape_max_tokens_min': {
      const pass = (actual || 0) >= expected;
      return { passed: pass, detail: pass ? `${actual} ≥ ${expected}` : `expected ≥${expected}, got ${actual}` };
    }
    case 'shape_max_tokens_max': {
      const pass = (actual || 0) <= expected;
      return { passed: pass, detail: pass ? `${actual} ≤ ${expected}` : `expected ≤${expected}, got ${actual}` };
    }
    case 'min_output_length': {
      const pass = (actual?.length || 0) >= expected;
      return { passed: pass, detail: pass ? `len=${actual?.length || 0}` : `expected len ≥${expected}, got ${actual?.length || 0}` };
    }
    case 'max_output_length': {
      const pass = (actual?.length || 0) <= expected;
      return { passed: pass, detail: pass ? `len=${actual?.length || 0}` : `expected len ≤${expected}, got ${actual?.length || 0}` };
    }
    case 'must_contain':
    case 'system_prompt_must_contain': {
      const haystack = (actual || '').toLowerCase();
      const missing = expected.filter((needle) => !haystack.includes(String(needle).toLowerCase()));
      return { passed: missing.length === 0, detail: missing.length === 0 ? `all ${expected.length} found` : `missing: ${missing.join(', ')}` };
    }
    case 'must_not_contain': {
      const haystack = (actual || '').toLowerCase();
      const found = expected.filter((needle) => haystack.includes(String(needle).toLowerCase()));
      return { passed: found.length === 0, detail: found.length === 0 ? `none of the ${expected.length} forbidden phrases found` : `found forbidden: ${found.join(', ')}` };
    }
    case 'grounding_sources_must_include': {
      const sources = actual || [];
      const missing = expected.filter((needle) => !sources.some((s) => s === needle || s.startsWith(`${needle}:`) || s.startsWith(`${needle}-`)));
      return { passed: missing.length === 0, detail: missing.length === 0 ? `all ${expected.length} present` : `missing: ${missing.join(', ')}` };
    }
    case 'grounding_sources_must_exclude': {
      const sources = actual || [];
      const found = expected.filter((needle) => sources.some((s) => s === needle || s.startsWith(`${needle}:`) || s.startsWith(`${needle}-`)));
      return { passed: found.length === 0, detail: found.length === 0 ? `clean` : `present unexpectedly: ${found.join(', ')}` };
    }
    case 'no_error': {
      // expected=true → error MUST be absent. expected=false → error MUST be present.
      const errPresent = !!opts.error;
      const pass = expected ? !errPresent : errPresent;
      const errStr = errPresent ? (opts.error?.message || opts.error) : '';
      const detail = expected
        ? (pass ? 'no error' : `unexpected error: ${errStr}`)
        : (pass ? `error present (as expected): ${errStr}` : 'expected an error, none surfaced');
      return { passed: pass, detail };
    }
    case 'clarification_needed': {
      const pass = actual === expected;
      return { passed: pass, detail: pass ? `clarificationNeeded=${actual}` : `expected ${expected}, got ${actual}` };
    }
    case 'min_questions': {
      const n = Array.isArray(actual) ? actual.length : 0;
      const pass = n >= expected;
      return { passed: pass, detail: pass ? `${n} ≥ ${expected} questions` : `expected ≥${expected} questions, got ${n}` };
    }
    case 'max_questions': {
      const n = Array.isArray(actual) ? actual.length : 0;
      const pass = n <= expected;
      return { passed: pass, detail: pass ? `${n} ≤ ${expected} questions` : `expected ≤${expected} questions, got ${n}` };
    }
    case 'question_dimensions_must_include': {
      const dims = Array.isArray(actual) ? actual.map((q) => String(q?.dimension || '').toLowerCase()) : [];
      const missing = expected.filter((needle) => !dims.includes(String(needle).toLowerCase()));
      return { passed: missing.length === 0, detail: missing.length === 0 ? `dims present: ${dims.join(',')}` : `missing dim(s): ${missing.join(', ')}; got: ${dims.join(',') || '(none)'}` };
    }
    case 'questions_must_have_suggested_answer': {
      const qs = Array.isArray(actual) ? actual : [];
      const missing = qs.filter((q) => !q?.suggestedAnswer || !String(q.suggestedAnswer).trim()).length;
      const want = !!expected;
      const pass = want ? missing === 0 : true;
      return { passed: pass, detail: pass ? `all ${qs.length} questions have a suggestedAnswer` : `${missing}/${qs.length} questions lack suggestedAnswer` };
    }
    case 'used_sources_min': {
      const n = Array.isArray(actual) ? actual.length : 0;
      const pass = n >= expected;
      return { passed: pass, detail: pass ? `${n} ≥ ${expected} usedSources` : `expected ≥${expected} usedSources, got ${n}` };
    }
    case 'dropped_sources_max': {
      const n = Array.isArray(actual) ? actual.length : 0;
      const pass = n <= expected;
      return { passed: pass, detail: pass ? `${n} ≤ ${expected} droppedSources` : `expected ≤${expected} droppedSources, got ${n}` };
    }
    case 'verdict': {
      const pass = actual === expected;
      return { passed: pass, detail: pass ? `verdict=${actual}` : `expected verdict=${expected}, got ${actual}` };
    }
    case 'overall_score_min': {
      const n = typeof actual === 'number' ? actual : 0;
      const pass = n >= expected;
      return { passed: pass, detail: pass ? `${n} ≥ ${expected}` : `expected ≥${expected}, got ${n}` };
    }
    case 'overall_score_max': {
      const n = typeof actual === 'number' ? actual : 0;
      const pass = n <= expected;
      return { passed: pass, detail: pass ? `${n} ≤ ${expected}` : `expected ≤${expected}, got ${n}` };
    }
    case 'dimensions_min': {
      const n = Array.isArray(actual) ? actual.length : 0;
      const pass = n >= expected;
      return { passed: pass, detail: pass ? `${n} ≥ ${expected} dimensions` : `expected ≥${expected} dimensions, got ${n}` };
    }
    case 'dimension_must_include': {
      const names = Array.isArray(actual) ? actual.map((d) => String(d?.name || '').toLowerCase()) : [];
      const missing = expected.filter((needle) => !names.includes(String(needle).toLowerCase()));
      return { passed: missing.length === 0, detail: missing.length === 0 ? `dims present: ${names.join(',')}` : `missing dim(s): ${missing.join(', ')}` };
    }
    case 'improved_prompt_present': {
      const present = !!(actual && String(actual).trim());
      const want = !!expected;
      const pass = want ? present : !present;
      return { passed: pass, detail: pass ? (present ? 'improvedPrompt present' : 'improvedPrompt absent (as expected)') : (present ? 'improvedPrompt unexpectedly present' : 'improvedPrompt unexpectedly absent') };
    }
    case 'improved_prompt_absent': {
      const present = !!(actual && String(actual).trim());
      const want = !!expected;
      const pass = want ? !present : present;
      return { passed: pass, detail: pass ? (present ? 'improvedPrompt present' : 'improvedPrompt absent') : 'unexpected state' };
    }
    case 'stages_must_include': {
      const names = Array.isArray(actual) ? actual.map((s) => String(s?.name || '').toLowerCase()) : [];
      const missing = expected.filter((needle) => !names.includes(String(needle).toLowerCase()));
      return { passed: missing.length === 0, detail: missing.length === 0 ? `stages: ${names.join('→')}` : `missing stage(s): ${missing.join(', ')}; ran: ${names.join('→') || '(none)'}` };
    }
    case 'stages_must_exclude': {
      const names = Array.isArray(actual) ? actual.map((s) => String(s?.name || '').toLowerCase()) : [];
      const found = expected.filter((needle) => names.includes(String(needle).toLowerCase()));
      return { passed: found.length === 0, detail: found.length === 0 ? `clean: ${names.join('→')}` : `unexpected stage(s) ran: ${found.join(', ')}` };
    }
    case 'clarification_required': {
      const pass = !!actual === !!expected;
      return { passed: pass, detail: pass ? `clarificationRequired=${!!actual}` : `expected ${expected}, got ${!!actual}` };
    }
    case 'revised': {
      const pass = !!actual === !!expected;
      return { passed: pass, detail: pass ? `revised=${!!actual}` : `expected ${expected}, got ${!!actual}` };
    }
    case 'iterations_min': {
      const n = typeof actual === 'number' ? actual : 0;
      const pass = n >= expected;
      return { passed: pass, detail: pass ? `iterations=${n} ≥ ${expected}` : `expected iterations ≥${expected}, got ${n}` };
    }
    case 'iterations_max': {
      const n = typeof actual === 'number' ? actual : 0;
      const pass = n <= expected;
      return { passed: pass, detail: pass ? `iterations=${n} ≤ ${expected}` : `expected iterations ≤${expected}, got ${n}` };
    }
    case 'optimization_model_eq':
    case 'critique_model_eq': {
      const pass = actual === expected;
      return { passed: pass, detail: pass ? `model=${actual}` : `expected model='${expected}', got '${actual}'` };
    }
    case 'bundle_has_git':
    case 'bundle_has_environment': {
      const present = actual != null && (typeof actual === 'object');
      const want = !!expected;
      const pass = want ? present : !present;
      return { passed: pass, detail: pass ? `present=${present}` : `expected present=${want}, got present=${present}` };
    }
    case 'git_branch_present': {
      const v = actual?.branch;
      const present = typeof v === 'string' && v.length > 0;
      const want = !!expected;
      const pass = want ? present : !present;
      return { passed: pass, detail: pass ? `branch='${v}'` : `expected branch present=${want}; got '${v}'` };
    }
    case 'final_prompt_must_contain': {
      const haystack = (actual || '').toLowerCase();
      const missing = expected.filter((needle) => !haystack.includes(String(needle).toLowerCase()));
      return { passed: missing.length === 0, detail: missing.length === 0 ? `all ${expected.length} found in finalPrompt` : `missing in finalPrompt: ${missing.join(', ')}` };
    }
    case 'final_prompt_must_not_contain': {
      const haystack = (actual || '').toLowerCase();
      const found = expected.filter((needle) => haystack.includes(String(needle).toLowerCase()));
      return { passed: found.length === 0, detail: found.length === 0 ? `clean` : `forbidden in finalPrompt: ${found.join(', ')}` };
    }
    case 'count_min': {
      const n = typeof actual === 'number' ? actual : 0;
      const pass = n >= expected;
      return { passed: pass, detail: pass ? `count=${n} ≥ ${expected}` : `expected count ≥${expected}, got ${n}` };
    }
    case 'count_max': {
      const n = typeof actual === 'number' ? actual : 0;
      const pass = n <= expected;
      return { passed: pass, detail: pass ? `count=${n} ≤ ${expected}` : `expected count ≤${expected}, got ${n}` };
    }
    case 'top_result_must_contain': {
      const top = Array.isArray(actual) && actual[0] ? String(actual[0].content || '').toLowerCase() : '';
      const missing = expected.filter((needle) => !top.includes(String(needle).toLowerCase()));
      return { passed: missing.length === 0, detail: missing.length === 0 ? `top result contains all ${expected.length}` : `top result missing: ${missing.join(', ')}` };
    }
    case 'top_result_kind': {
      const top = Array.isArray(actual) && actual[0] ? actual[0].kind : '';
      const pass = top === expected;
      return { passed: pass, detail: pass ? `top result kind=${top}` : `expected top kind=${expected}, got ${top}` };
    }
    default:
      return { passed: true, detail: `(unknown check ${name} — skipped)` };
  }
}

function evaluateFixture(fixture, result, systemPrompt, tool) {
  const expected = fixture.expected || {};
  const checks = [];
  let totalWeight = 0;
  let earnedWeight = 0;

  // optimize_prompt result has category/intent at top-level + analysis.intent;
  // clarify_with_user result keeps everything under .analysis;
  // compose_prompt nests critique.* and optimization.* under their stages.
  const isClarify = tool === 'clarify_with_user';
  const isCompose = tool === 'compose_prompt';

  for (const [key, value] of Object.entries(expected)) {
    const weight = CHECK_WEIGHTS[key] ?? 1.0;
    let actual;
    let opts = {};
    switch (key) {
      case 'category':                       actual = isClarify ? result.analysis?.category : result.category; break;
      case 'platform':                       actual = result.platform; break;
      case 'intent':                         actual = result.analysis?.intent; break;
      case 'intent_confidence':              actual = result.analysis?.confidence; break;
      case 'intent_confidence_min':          actual = result.analysis?.confidence; break;
      case 'mode':                           actual = result.mode; break;
      case 'mode_source':                    actual = result.modeSource; break;
      case 'recommended_mode':               actual = result.analysis?.recommendedMode; break;
      case 'shape_budget':                   actual = result.shape?.systemPromptBudget; break;
      case 'shape_max_tokens_min':           actual = result.shape?.maxTokens; break;
      case 'shape_max_tokens_max':           actual = result.shape?.maxTokens; break;
      case 'must_contain':
      case 'must_not_contain':
      case 'min_output_length':
      case 'max_output_length':              actual = result.optimizedPrompt; break;
      case 'grounding_sources_must_include':
      case 'grounding_sources_must_exclude': actual = result.grounding?.sources || []; break;
      case 'system_prompt_must_contain':     actual = systemPrompt || ''; break;
      case 'no_error':                       opts = { error: result.error }; break;
      // clarify_with_user
      case 'clarification_needed':           actual = result.clarificationNeeded; break;
      case 'min_questions':
      case 'max_questions':
      case 'question_dimensions_must_include':
      case 'questions_must_have_suggested_answer': actual = result.questions || []; break;
      // ground_prompt
      case 'used_sources_min':               actual = result.usedSources || []; break;
      case 'dropped_sources_max':            actual = result.droppedSources || []; break;
      // critique_prompt — also reads compose result.critique.*
      case 'verdict':                        actual = isCompose ? result.critique?.verdict : result.verdict; break;
      case 'overall_score_min':              actual = isCompose ? result.critique?.overallScore : result.overallScore; break;
      case 'overall_score_max':              actual = isCompose ? result.critique?.overallScore : result.overallScore; break;
      case 'dimensions_min':                 actual = isCompose ? (result.critique?.dimensions || []) : (result.dimensions || []); break;
      case 'dimension_must_include':         actual = isCompose ? (result.critique?.dimensions || []) : (result.dimensions || []); break;
      case 'improved_prompt_present':        actual = isCompose ? result.critique?.improvedPrompt : result.improvedPrompt; break;
      case 'improved_prompt_absent':         actual = isCompose ? result.critique?.improvedPrompt : result.improvedPrompt; break;
      // compose_prompt
      case 'stages_must_include':
      case 'stages_must_exclude':            actual = result.stages || []; break;
      case 'clarification_required':         actual = result.clarificationRequired; break;
      case 'revised':                        actual = result.revised; break;
      case 'iterations_min':
      case 'iterations_max':                 actual = result.iterations; break;
      case 'optimization_model_eq':          actual = result.optimization?.metadata?.model; break;
      case 'critique_model_eq':              actual = result.critique?.judgeModel; break;
      case 'bundle_has_git':                 actual = result.git; break;
      case 'bundle_has_environment':         actual = result.environment; break;
      case 'git_branch_present':             actual = result.git; break;
      case 'final_prompt_must_contain':
      case 'final_prompt_must_not_contain':  actual = result.finalPrompt; break;
      // memory_search
      case 'count_min':
      case 'count_max':                      actual = result.count; break;
      case 'top_result_must_contain':
      case 'top_result_kind':                actual = result.results || []; break;
      default: continue;
    }
    const { passed, detail } = scoreCheck(key, value, actual, opts);
    checks.push({ key, weight, passed, expected: value, detail });
    totalWeight += weight;
    if (passed) earnedWeight += weight;
  }

  const score = totalWeight > 0 ? earnedWeight / totalWeight : 1.0;
  const passed = score >= PASS_THRESHOLD;
  return { score, passed, totalWeight, earnedWeight, checks };
}

// ───── one-fixture run ─────
async function runFixture(fixture) {
  // Filter check FIRST so the user's explicit narrow doesn't get cluttered
  // with skip messages for fixtures they didn't ask about.
  if (!passesFilter(fixture)) return { fixture, status: 'filtered' };
  const skipReason = shouldSkip(fixture, MODEL);
  if (skipReason) return { fixture, status: 'skipped', skipReason };

  const ws = await makeWorkspace(fixture);
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'clarify-eval-home-'));
  const startedAt = Date.now();

  const srv = startServer({ CLARIFYPROMPT_HOME: home });
  try {
    await srv.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'eval-harness', version: '0.1.0' },
    });
    await srv.rpc('notifications/initialized', {}).catch(() => {});

    // Optional `setup:` sequence — a list of MCP tool calls executed BEFORE
    // the main `input`. Used by multi-call fixtures (e.g. load a knowledge
    // pack first, then optimize against it). Setup results aren't scored;
    // failures during setup fail the fixture as a whole.
    if (Array.isArray(fixture.setup) && fixture.setup.length > 0) {
      for (const [i, step] of fixture.setup.entries()) {
        if (!step?.tool) {
          throw new Error(`fixture ${fixture.name}: setup[${i}] missing 'tool' field`);
        }
        const setupArgs = { ...(step.args || {}) };
        if (ws && setupArgs.cwd === undefined) setupArgs.cwd = ws;
        const setupResult = await srv.callTool(step.tool, setupArgs);
        if (setupResult?._isError) {
          throw new Error(`fixture ${fixture.name}: setup[${i}] (${step.tool}) failed: ${(setupResult.error || JSON.stringify(setupResult)).toString().slice(0, 240)}`);
        }
      }
    }

    const args = { ...fixture.input };
    const tool = args.tool || 'optimize_prompt';
    delete args.tool; // not part of MCP tool args
    if (ws) args.cwd = ws;
    if (tool === 'optimize_prompt' || tool === 'ground_prompt') args.include_bundle = true;

    const result = await srv.callTool(tool, args);

    // Pull system prompt from the trace if any check needs it (optimize/ground only — they emit traces).
    // compose_prompt nests these under .optimization or .grounding; pull the inner trace id.
    let systemPrompt = '';
    if (fixture.expected?.system_prompt_must_contain) {
      let traceId = null;
      if (tool === 'optimize_prompt' || tool === 'ground_prompt') traceId = result.id;
      else if (tool === 'compose_prompt') traceId = result.optimization?.id ?? result.grounding?.id ?? null;
      if (traceId) {
        try {
          const trace = await srv.callTool('get_trace', { id: traceId });
          systemPrompt = trace.systemPrompt || '';
        } catch { /* trace may not be available; check will fail */ }
      }
    }

    const evaluation = evaluateFixture(fixture, result, systemPrompt, tool);
    const elapsedMs = Date.now() - startedAt;

    return {
      fixture, status: 'ran', result, evaluation,
      latencyMs: elapsedMs, model: MODEL,
      stderr: srv.stderr().slice(0, 800),
    };
  } finally {
    srv.proc.kill();
    if (ws) fs.rm(ws, { recursive: true, force: true }).catch(() => {});
    fs.rm(home, { recursive: true, force: true }).catch(() => {});
  }
}

// ───── main ─────
async function main() {
  log(C.bold(C.cyan(`╔═ ClarifyPrompt eval harness v0 ═════════════════════════════════════════╗`)));
  log(`  Model: ${C.bold(MODEL)}`);
  log(`  Fixtures dir: ${FIXTURES_DIR}`);
  if (FILTER) log(`  Filter: ${FILTER}`);
  log(C.dim(`  Pass threshold: ${PASS_THRESHOLD}`));
  log('');

  const fixtures = await loadFixtures();
  log(`  Loaded ${fixtures.length} fixture${fixtures.length === 1 ? '' : 's'}`);

  const runs = [];
  for (const fixture of fixtures) {
    let run;
    try {
      run = await runFixture(fixture);
    } catch (err) {
      // One fixture crashing shouldn't tank the whole run. Synthesize an
      // 'errored' status so the summary reflects the error and the harness
      // moves on. The exit code at the end will still be non-zero.
      run = {
        fixture, status: 'errored',
        error: { message: (err && err.message) || String(err) },
        latencyMs: 0,
      };
    }
    runs.push(run);
    if (run.status === 'skipped') {
      log(C.dim(`  ⊘ ${fixture.name.padEnd(48)} skipped — ${run.skipReason}`));
    } else if (run.status === 'errored') {
      log(C.red(`  ⚠ ${fixture.name.padEnd(48)} ERRORED — ${run.error.message.slice(0, 200)}`));
    } else if (run.status === 'filtered') {
      // suppress
    } else {
      const e = run.evaluation;
      const symbol = e.passed ? C.green('✓') : C.red('✗');
      const score = `${(e.score * 100).toFixed(0).padStart(3)}%`;
      const lat = `${run.latencyMs}ms`.padStart(7);
      log(`  ${symbol} ${fixture.name.padEnd(48)} ${score}  ${C.dim(lat)}`);
      if (!e.passed) {
        for (const ch of e.checks.filter((c) => !c.passed)) {
          log(C.red(`      ✗ ${ch.key}: ${ch.detail}`));
        }
      }
    }
  }

  const ran      = runs.filter((r) => r.status === 'ran');
  const passed   = ran.filter((r) => r.evaluation.passed).length;
  const failed   = ran.length - passed;
  const errored  = runs.filter((r) => r.status === 'errored').length;
  const skipped  = runs.filter((r) => r.status === 'skipped').length;
  const filtered = runs.filter((r) => r.status === 'filtered').length;
  const totalScore = ran.length ? ran.reduce((a, r) => a + r.evaluation.score, 0) / ran.length : 0;
  const avgLatency = ran.length ? Math.round(ran.reduce((a, r) => a + r.latencyMs, 0) / ran.length) : 0;

  log('');
  log(C.bold(`╠═ summary ═══════════════════════════════════════════════════════════════╣`));
  log(`  ${C.green(`${passed} passed`)} · ${failed > 0 ? C.red(`${failed} failed`) : C.dim('0 failed')}${errored > 0 ? ` · ${C.red(`${errored} errored`)}` : ''} · ${C.dim(`${skipped} skipped`)}${filtered > 0 ? C.dim(` · ${filtered} filtered`) : ''}`);
  log(`  Average score: ${(totalScore * 100).toFixed(0)}% · Average latency: ${avgLatency}ms`);
  log(C.bold(`╚═════════════════════════════════════════════════════════════════════════╝`));

  if (!NO_HTML) {
    await writeHtmlReport({ runs, model: MODEL, ran, passed, failed, errored, skipped, filtered, totalScore, avgLatency });
    log(C.dim(`\n  HTML report: ${REPORT_PATH}`));
  }

  // Optional structured-JSON dump for tooling (matrix.mjs uses this to
  // aggregate across multiple model runs into one side-by-side report).
  if (JSON_OUT && typeof JSON_OUT === 'string') {
    const summary = {
      model: MODEL,
      ranAt: new Date().toISOString(),
      counts: { passed, failed, errored, skipped, filtered, total: runs.length },
      totalScore,
      avgLatencyMs: avgLatency,
      fixtures: runs.map((r) => ({
        name: r.fixture?.name,
        tags: r.fixture?.tags ?? [],
        status: r.status,
        ...(r.status === 'ran' && {
          score: r.evaluation.score,
          passed: r.evaluation.passed,
          latencyMs: r.latencyMs,
          failingChecks: r.evaluation.checks.filter((c) => !c.passed).map((c) => ({ key: c.key, detail: c.detail })),
        }),
        ...(r.status === 'skipped' && { skipReason: r.skipReason }),
        ...(r.status === 'errored' && { error: r.error?.message }),
      })),
    };
    await fs.writeFile(JSON_OUT, JSON.stringify(summary, null, 2), 'utf-8');
    log(C.dim(`  JSON report: ${JSON_OUT}`));
  }

  // Exit non-zero on either scoring failures OR fixture errors — both block the gate.
  process.exit((failed > 0 || errored > 0) ? 1 : 0);
}

// ───── HTML report ─────
async function writeHtmlReport({ runs, model, ran, passed, failed, skipped, filtered, totalScore, avgLatency }) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = new Date().toISOString();

  const rows = runs.map((r) => {
    if (r.status === 'skipped') {
      return `<tr class="skipped"><td>⊘</td><td>${esc(r.fixture.name)}</td><td colspan="3">skipped — ${esc(r.skipReason)}</td></tr>`;
    }
    if (r.status === 'filtered') return '';
    if (r.status === 'errored') {
      return `<tr class="fail"><td class="status">⚠</td><td><div class="name">${esc(r.fixture.name)}</div><div class="desc">${esc(r.fixture.description || '')}</div></td><td class="score">errored</td><td class="latency">—</td><td class="checks"><ul><li class="fail"><b>error</b>: ${esc(r.error?.message || 'unknown error')}</li></ul></td></tr>`;
    }
    const e = r.evaluation;
    const checksHtml = e.checks.map((c) =>
      `<li class="${c.passed ? 'ok' : 'fail'}"><b>${esc(c.key)}</b>: ${esc(c.detail)}</li>`
    ).join('');
    const tagsHtml = (r.fixture.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join(' ');
    const optimized = esc((r.result?.optimizedPrompt || '').slice(0, 600));
    return `
      <tr class="${e.passed ? 'pass' : 'fail'}">
        <td class="status">${e.passed ? '✓' : '✗'}</td>
        <td>
          <div class="name">${esc(r.fixture.name)}</div>
          <div class="desc">${esc(r.fixture.description || '')}</div>
          <div>${tagsHtml}</div>
        </td>
        <td class="score">${(e.score * 100).toFixed(0)}%</td>
        <td class="latency">${r.latencyMs}ms</td>
        <td class="checks">
          <ul>${checksHtml}</ul>
          <details><summary>output preview</summary><pre>${optimized}</pre></details>
        </td>
      </tr>`;
  }).join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ClarifyPrompt evals — ${esc(date)}</title>
<style>
  :root { color-scheme: dark; }
  body { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; background: #0d1117; color: #c9d1d9; max-width: 1100px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #8b949e; font-size: 12px; margin-bottom: 24px; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px 16px; }
  .card .label { color: #8b949e; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .card .value { font-size: 22px; font-weight: 600; margin-top: 4px; }
  .pass .value { color: #3fb950; }
  .fail .value { color: #f85149; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #21262d; vertical-align: top; }
  th { background: #161b22; color: #8b949e; font-size: 11px; text-transform: uppercase; }
  tr.pass td.status { color: #3fb950; font-weight: 700; }
  tr.fail td.status { color: #f85149; font-weight: 700; }
  tr.skipped { color: #6e7681; font-style: italic; }
  .name { font-weight: 600; color: #e6edf3; }
  .desc { color: #8b949e; font-size: 12px; margin-top: 2px; }
  .tag { display: inline-block; padding: 1px 6px; margin: 4px 4px 0 0; background: #21262d; border-radius: 3px; font-size: 10px; color: #8b949e; }
  .score { font-weight: 600; text-align: right; }
  .latency { color: #8b949e; text-align: right; }
  ul { margin: 0; padding-left: 18px; }
  ul li.ok { color: #56d364; }
  ul li.fail { color: #ff7b72; font-weight: 600; }
  details { margin-top: 8px; }
  summary { cursor: pointer; color: #58a6ff; font-size: 11px; }
  pre { background: #0d1117; border: 1px solid #21262d; padding: 8px; border-radius: 4px; white-space: pre-wrap; max-height: 200px; overflow-y: auto; font-size: 11px; }
</style>
</head>
<body>
  <h1>ClarifyPrompt evals</h1>
  <div class="meta">${esc(date)} · model <b>${esc(model)}</b> · pass threshold ${PASS_THRESHOLD}</div>
  <div class="summary">
    <div class="card pass"><div class="label">passed</div><div class="value">${passed}</div></div>
    <div class="card ${failed > 0 ? 'fail' : ''}"><div class="label">failed</div><div class="value">${failed}</div></div>
    <div class="card"><div class="label">skipped</div><div class="value">${skipped}</div></div>
    <div class="card"><div class="label">avg score</div><div class="value">${(totalScore * 100).toFixed(0)}%</div></div>
    <div class="card"><div class="label">avg latency</div><div class="value">${avgLatency}ms</div></div>
    <div class="card"><div class="label">fixtures total</div><div class="value">${runs.length}</div></div>
  </div>
  <table>
    <thead><tr><th></th><th>fixture</th><th>score</th><th>lat</th><th>checks</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

  await fs.writeFile(REPORT_PATH, html, 'utf-8');
}

main().catch((err) => {
  console.error('eval harness error:', err);
  process.exit(2);
});
