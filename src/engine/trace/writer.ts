import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TraceEntry, TraceMode } from './types.js';
import { getPaths } from '../config/paths.js';

const TRACE_ENV = 'CLARIFYPROMPT_TRACE';

export class TraceWriter {
  private mode: TraceMode;
  private tracesDir: string;
  private initialized = false;

  constructor() {
    this.mode = resolveMode();
    this.tracesDir = getPaths().tracesDir;
  }

  getMode(): TraceMode {
    return this.mode;
  }

  getTracesDir(): string {
    return this.tracesDir;
  }

  async append(entry: TraceEntry): Promise<void> {
    if (this.mode === 'off') return;
    if (this.mode === 'otel') {
      // OTel path stubbed; emit to stderr as a JSON line so downstream collectors can still pick it up.
      process.stderr.write(`[clarifyprompt.trace] ${JSON.stringify(entry)}\n`);
      return;
    }

    try {
      await this.ensureInit();
      const filePath = path.join(this.tracesDir, `${currentDateStamp()}.jsonl`);
      await fs.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
      console.error('[TraceWriter] failed to append trace:', err);
    }
  }

  async listDays(): Promise<string[]> {
    if (this.mode === 'off') return [];
    try {
      await this.ensureInit();
      const entries = await fs.readdir(this.tracesDir);
      return entries
        .filter(n => n.endsWith('.jsonl'))
        .map(n => n.replace(/\.jsonl$/, ''))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  async readDay(day: string, limit = 50): Promise<TraceEntry[]> {
    await this.ensureInit();
    const filePath = path.join(this.tracesDir, `${day}.jsonl`);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      const start = Math.max(0, lines.length - limit);
      return lines.slice(start).map(l => JSON.parse(l) as TraceEntry);
    } catch {
      return [];
    }
  }

  async findById(id: string, lookbackDays = 7): Promise<TraceEntry | undefined> {
    const days = (await this.listDays()).slice(0, lookbackDays);
    for (const day of days) {
      const entries = await this.readDay(day, 10_000);
      const match = entries.find(e => e.id === id);
      if (match) return match;
    }
    return undefined;
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.tracesDir, { recursive: true });
    this.initialized = true;
  }
}

function resolveMode(): TraceMode {
  const raw = (process.env[TRACE_ENV] || 'local').toLowerCase();
  if (raw === 'off' || raw === 'local' || raw === 'otel') return raw;
  return 'local';
}

function currentDateStamp(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

let instance: TraceWriter | null = null;

export function getTraceWriter(): TraceWriter {
  if (!instance) instance = new TraceWriter();
  return instance;
}
