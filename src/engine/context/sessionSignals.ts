import type {
  SessionOptimizationEntry,
  SessionOutcomeEntry,
  SessionSignal,
} from './types.js';
import type { Category } from '../config/categories.js';
import type { Intent } from './types.js';

const DEFAULT_RING_CAPACITY = 20;

export interface OutcomeRecord extends SessionOutcomeEntry {
  /** Cached pointer back to the optimization this outcome is about. */
  optimization?: SessionOptimizationEntry;
}

export class SessionStore {
  private sessions = new Map<string, SessionRecord>();
  private capacity: number;

  constructor(capacity: number = DEFAULT_RING_CAPACITY) {
    this.capacity = capacity;
  }

  get(sessionId: string): SessionSignal {
    const record = this.ensure(sessionId);
    return {
      sessionId,
      recentOptimizations: [...record.optimizations],
      recentOutcomes: [...record.outcomes],
    };
  }

  recordOptimization(sessionId: string, entry: SessionOptimizationEntry): void {
    const record = this.ensure(sessionId);
    record.optimizations.push(entry);
    while (record.optimizations.length > this.capacity) {
      record.optimizations.shift();
    }
  }

  recordOutcome(sessionId: string, entry: SessionOutcomeEntry): void {
    const record = this.ensure(sessionId);
    record.outcomes.push(entry);
    while (record.outcomes.length > this.capacity) {
      record.outcomes.shift();
    }
  }

  /**
   * Pass-D retrieval: find the most similar ACCEPTED optimizations in this
   * session whose category (and optionally intent) match the current request.
   * Similarity is a cheap token-overlap score — proper embedding retrieval
   * arrives in Day 2 with the persistent memory layer.
   */
  findAcceptedExamples(
    sessionId: string,
    query: { prompt: string; category: Category; intent?: Intent; limit?: number },
  ): SessionOptimizationEntry[] {
    const record = this.ensure(sessionId);
    const acceptedIds = new Set(
      record.outcomes.filter(o => o.verdict === 'accepted').map(o => o.optimizationId),
    );
    if (!acceptedIds.size) return [];

    const candidates = record.optimizations.filter(opt =>
      acceptedIds.has(opt.id) &&
      opt.category === query.category &&
      (!query.intent || !opt.intent || opt.intent === query.intent),
    );

    if (!candidates.length) return [];

    const queryTokens = tokenize(query.prompt);
    const scored = candidates.map(opt => ({
      opt,
      score: jaccard(queryTokens, tokenize(opt.originalPrompt)),
    }));
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, query.limit ?? 2).map(s => s.opt);
  }

  /** Which sessions exist (diagnostic). */
  listSessions(): string[] {
    return [...this.sessions.keys()];
  }

  reset(sessionId?: string): void {
    if (sessionId) this.sessions.delete(sessionId);
    else this.sessions.clear();
  }

  private ensure(sessionId: string): SessionRecord {
    let record = this.sessions.get(sessionId);
    if (!record) {
      record = { optimizations: [], outcomes: [] };
      this.sessions.set(sessionId, record);
    }
    return record;
  }
}

interface SessionRecord {
  optimizations: SessionOptimizationEntry[];
  outcomes: SessionOutcomeEntry[];
}

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union ? intersection / union : 0;
}

let storeInstance: SessionStore | null = null;

export function getSessionStore(): SessionStore {
  if (!storeInstance) storeInstance = new SessionStore();
  return storeInstance;
}

export function generateSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
