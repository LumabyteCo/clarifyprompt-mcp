#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import * as _path from 'node:path';
const REPO_ROOT = _path.resolve(_path.dirname(fileURLToPath(import.meta.url)), '..');
// Single-model runner. Reads a JSON job on argv, prints JSON result on stdout.
// Spawned one per (model, job) so the LLMClient singleton is correctly bound.
const DIST = `${REPO_ROOT}/dist`;
const job = JSON.parse(process.argv[2]);

if (!process.env.LLM_API_URL) process.env.LLM_API_URL = 'http://localhost:11434/v1';
if (!process.env.LLM_API_KEY) process.env.LLM_API_KEY = '';
if (!process.env.LLM_MODEL) process.env.LLM_MODEL = job.model;

try {
  if (job.kind === 'optimize') {
    const { getOptimizationEngine } = await import(`${DIST}/engine/optimization/engine.js`);
    const engine = getOptimizationEngine();
    const res = await engine.optimize(job.request);
    process.stdout.write(JSON.stringify({ ok: true, result: res }));
  } else if (job.kind === 'analyze') {
    // Direct analyzer access (replaces the old `intent` kind from pre-1.2.0).
    const { analyzePrompt } = await import(`${DIST}/engine/context/promptAnalyzer.js`);
    const res = await analyzePrompt({ prompt: job.prompt, userCategoryHint: job.category });
    process.stdout.write(JSON.stringify({ ok: true, result: res }));
  } else {
    throw new Error(`unknown job kind: ${job.kind}`);
  }
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, error: err.message, stack: err.stack }));
  process.exit(1);
}
