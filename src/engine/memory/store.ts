import type Database from 'better-sqlite3';
import { getDb, hasVectorSupport } from './db.js';
import { getEmbedder, vecToJson, type Embedder } from './embeddings.js';
import type {
  Fact,
  FactInsert,
  Outcome,
  PersistedOptimization,
  Verdict,
  MemoryMatch,
  MemoryScope,
  Pack,
  PackChunk,
  Entity,
  EntityKind,
} from './types.js';

/**
 * High-level memory API. The rest of the engine should talk to this, not
 * the raw DB — so when Day 3 swaps in a remote backend, the engine doesn't
 * change. Every method is null-safe when the DB / vector extension isn't
 * available (degrades to no-ops rather than throwing).
 */
export class MemoryStore {
  private db: Database.Database;
  private vectors: boolean;
  private embedder: Embedder;
  /** Vector table name for the configured embedder dim, e.g. `embeddings_1536`. */
  private vecTable: string;

  constructor(db?: Database.Database, embedder?: Embedder) {
    this.db = db || getDb();
    this.vectors = hasVectorSupport(this.db);
    this.embedder = embedder || getEmbedder();
    this.vecTable = `embeddings_${this.embedder.dimension}`;

    // Migration 1 only created embeddings_768 (the nomic-embed-text default).
    // For any other configured dim (text-embedding-3-small=1536, voyage-3=1024,
    // etc.), create the dim-specific table on the fly. Idempotent — IF NOT
    // EXISTS protects existing tables.
    if (this.vectors && this.embedder.dimension !== 768) {
      try {
        this.db.exec(
          `CREATE VIRTUAL TABLE IF NOT EXISTS ${this.vecTable} USING vec0(
             kind TEXT PARTITION KEY,
             source_id INTEGER,
             vec float[${this.embedder.dimension}]
           );`,
        );
      } catch (err) {
        // sqlite-vec missing or vec0 unsupported; degrade to no-vector mode.
        this.vectors = false;
        process.stderr.write(`[clarifyprompt] failed to ensure vec table for dim=${this.embedder.dimension}: ${(err as Error).message}\n`);
      }
    }
  }

  isHealthy(): boolean {
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  hasVectors(): boolean {
    return this.vectors;
  }

  // ---------------- Sessions ----------------

  upsertSession(sessionId: string): void {
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO sessions(id, started_at, last_active) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_active = excluded.last_active`,
    ).run(sessionId, now, now);
  }

  // ---------------- Optimizations ----------------

  recordOptimization(opt: PersistedOptimization): void {
    this.upsertSession(opt.sessionId);
    this.db.prepare(
      `INSERT OR REPLACE INTO optimizations
         (id, session_id, ts, original_prompt, optimized_prompt, category, platform, mode, intent, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      opt.id, opt.sessionId, opt.ts,
      opt.originalPrompt, opt.optimizedPrompt,
      opt.category, opt.platform, opt.mode, opt.intent, opt.model,
    );
  }

  getOptimization(id: string): PersistedOptimization | undefined {
    const row: any = this.db.prepare('SELECT * FROM optimizations WHERE id = ?').get(id);
    if (!row) return undefined;
    return {
      id: row.id, sessionId: row.session_id, ts: row.ts,
      originalPrompt: row.original_prompt, optimizedPrompt: row.optimized_prompt,
      category: row.category, platform: row.platform, mode: row.mode,
      intent: row.intent, model: row.model,
    };
  }

  // ---------------- Outcomes ----------------

  recordOutcome(o: { optimizationId: string; sessionId: string; verdict: Verdict; diff?: string; ts?: number }): number {
    this.upsertSession(o.sessionId);
    const ts = o.ts ?? Date.now();
    const result = this.db.prepare(
      `INSERT INTO outcomes(optimization_id, session_id, verdict, diff, ts, reflected)
       VALUES (?, ?, ?, ?, ?, 0)`,
    ).run(o.optimizationId, o.sessionId, o.verdict, o.diff ?? null, ts);
    return Number(result.lastInsertRowid);
  }

  listUnreflectedOutcomes(limit = 50): Outcome[] {
    const rows: any[] = this.db.prepare(
      `SELECT * FROM outcomes WHERE reflected = 0 ORDER BY ts ASC LIMIT ?`,
    ).all(limit);
    return rows.map(rowToOutcome);
  }

  markOutcomeReflected(id: number): void {
    this.db.prepare('UPDATE outcomes SET reflected = 1 WHERE id = ?').run(id);
  }

  // ---------------- Facts ----------------

  insertFact(f: FactInsert): number {
    const now = Date.now();
    const result = this.db.prepare(
      `INSERT INTO facts
         (scope, subject_id, subject_text, predicate, object_id, object_text,
          confidence, source, valid_from, observed_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      f.scope,
      f.subjectId ?? null,
      f.subjectText ?? null,
      f.predicate,
      f.objectId ?? null,
      f.objectText ?? null,
      f.confidence ?? 0.8,
      f.source ?? null,
      f.validFrom ?? now,
      f.observedAt ?? now,
      f.metadata ? JSON.stringify(f.metadata) : null,
    );
    return Number(result.lastInsertRowid);
  }

  /** Soft-delete via bi-temporal invalidation, Graphiti-style. */
  invalidateFact(id: number, supersededBy?: number, atMs?: number): void {
    const ts = atMs ?? Date.now();
    this.db.prepare(
      `UPDATE facts SET invalidated_at = ?, invalidated_by = ? WHERE id = ? AND invalidated_at IS NULL`,
    ).run(ts, supersededBy ?? null, id);
  }

  listLiveFacts(scope: MemoryScope, predicate?: string, limit = 100): Fact[] {
    const q = predicate
      ? `SELECT * FROM facts WHERE scope = ? AND predicate = ? AND invalidated_at IS NULL ORDER BY observed_at DESC LIMIT ?`
      : `SELECT * FROM facts WHERE scope = ? AND invalidated_at IS NULL ORDER BY observed_at DESC LIMIT ?`;
    const rows: any[] = predicate
      ? this.db.prepare(q).all(scope, predicate, limit)
      : this.db.prepare(q).all(scope, limit);
    return rows.map(rowToFact);
  }

  // ---------------- Entities ----------------

  upsertEntity(scope: MemoryScope, kind: EntityKind, name: string): Entity {
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO entities(scope, kind, name, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(scope, kind, name) DO UPDATE SET last_seen = excluded.last_seen`,
    ).run(scope, kind, name, now, now);
    const row: any = this.db.prepare(
      `SELECT * FROM entities WHERE scope = ? AND kind = ? AND name = ?`,
    ).get(scope, kind, name);
    return {
      id: row.id, scope: row.scope, kind: row.kind, name: row.name,
      aliases: row.aliases_json ? JSON.parse(row.aliases_json) : undefined,
      firstSeen: row.first_seen, lastSeen: row.last_seen,
    };
  }

  // ---------------- Embeddings + vector retrieval ----------------

  /**
   * Store an embedding vector for a source row. `kind` partitions the
   * vector table so we can search within a specific memory type.
   */
  async embedAndStore(
    kind: 'fact' | 'outcome' | 'pack_chunk' | 'optimization',
    sourceId: number | string,
    text: string,
  ): Promise<void> {
    if (!this.vectors || !text.trim()) return;
    const vec = await this.embedder.embed(text);
    if (vec.length !== this.embedder.dimension) return;
    // sqlite-vec's rowid is an opaque INTEGER; we use a synthetic key that
    // encodes kind + sourceId lookup via separate indexes in the normal tables.
    // CAST + BigInt so sqlite-vec sees an INTEGER, not a REAL. better-sqlite3
    // binds JS numbers as REAL by default; vec0 metadata columns are strict.
    const sidInt = typeof sourceId === 'string' ? hashToInt(sourceId) : sourceId;
    this.db.prepare(
      `INSERT INTO ${this.vecTable}(kind, source_id, vec) VALUES (?, CAST(? AS INTEGER), vec_f32(?))`,
    ).run(kind, BigInt(sidInt), vecToJson(vec));
  }

  /**
   * Semantic search across a single kind. Returns MemoryMatch rows joined
   * to the source content. Low-level; Pass 3 builds higher-level retrieval
   * (dual local/global + temporal filter) on top.
   */
  async searchByVector(
    kind: 'fact' | 'outcome' | 'pack_chunk' | 'optimization',
    query: string,
    limit = 5,
  ): Promise<MemoryMatch[]> {
    if (!this.vectors || !query.trim()) return [];
    const qVec = await this.embedder.embed(query);
    if (qVec.length !== this.embedder.dimension) return [];

    // LIMIT must be an integer too — use k= in the MATCH constraint, which
    // sqlite-vec understands for KNN queries, OR plain LIMIT with an int.
    const rows: any[] = this.db.prepare(`
      SELECT source_id, distance FROM ${this.vecTable}
      WHERE kind = ? AND vec MATCH vec_f32(?)
      ORDER BY distance LIMIT ?
    `).all(kind, vecToJson(qVec), BigInt(limit));

    return rows.map(r => this.hydrateMatch(kind, Number(r.source_id), r.distance)).filter(Boolean) as MemoryMatch[];
  }

  private hydrateMatch(
    kind: MemoryMatch['kind'],
    sourceIdHashedOrReal: number,
    distance: number,
  ): MemoryMatch | null {
    // For optimizations we encoded the TEXT id as a hash; the hashed id
    // is only usable for filtering, not for retrieval. For Pass 1 we keep
    // the hydration simple: only int-keyed kinds roundtrip cleanly.
    if (kind === 'optimization') return null;

    const table = kind === 'fact' ? 'facts'
      : kind === 'outcome' ? 'outcomes'
      : 'pack_chunks';
    const row: any = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(sourceIdHashedOrReal);
    if (!row) return null;

    const content = kind === 'fact'
      ? renderFact(rowToFact(row))
      : kind === 'outcome'
        ? `[${row.verdict}] ${row.diff ?? '(no diff)'}`
        : String(row.content ?? '');

    return {
      kind,
      sourceId: row.id,
      content,
      // vec0 distance is squared-L2 for float[N]; higher = further. Flip to
      // a rough 0..1 similarity for convenience (1 = identical).
      similarity: distance === 0 ? 1 : 1 / (1 + distance),
      tokens: approxTokens(content),
    };
  }

  // ---------------- Packs ----------------

  insertPack(p: Omit<Pack, 'id'>): number {
    const result = this.db.prepare(
      `INSERT INTO packs(name, version, source_type, source_ref, scope, loaded_at, signature, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      p.name, p.version ?? null, p.sourceType, p.sourceRef ?? null,
      p.scope, p.loadedAt,
      p.signature ?? null,
      p.metadata ? JSON.stringify(p.metadata) : null,
    );
    return Number(result.lastInsertRowid);
  }

  insertPackChunk(c: Omit<PackChunk, 'id'>): number {
    const result = this.db.prepare(
      `INSERT INTO pack_chunks(pack_id, position, heading, content, metadata_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      c.packId, c.position, c.heading ?? null, c.content,
      c.metadata ? JSON.stringify(c.metadata) : null,
    );
    return Number(result.lastInsertRowid);
  }

  listPacks(scope?: MemoryScope): Pack[] {
    const rows: any[] = scope
      ? this.db.prepare('SELECT * FROM packs WHERE scope = ? ORDER BY loaded_at DESC').all(scope)
      : this.db.prepare('SELECT * FROM packs ORDER BY loaded_at DESC').all();
    return rows.map(rowToPack);
  }

  removePack(id: number): void {
    // pack_chunks has ON DELETE CASCADE
    this.db.prepare('DELETE FROM packs WHERE id = ?').run(id);
  }
}

// ---------------- helpers ----------------

function rowToFact(r: any): Fact {
  return {
    id: r.id, scope: r.scope,
    subjectId: r.subject_id ?? undefined,
    subjectText: r.subject_text ?? undefined,
    predicate: r.predicate,
    objectId: r.object_id ?? undefined,
    objectText: r.object_text ?? undefined,
    confidence: r.confidence,
    source: r.source ?? undefined,
    validFrom: r.valid_from,
    observedAt: r.observed_at,
    invalidatedAt: r.invalidated_at ?? null,
    invalidatedBy: r.invalidated_by ?? null,
    metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined,
  };
}

function rowToOutcome(r: any): Outcome {
  return {
    id: r.id, optimizationId: r.optimization_id, sessionId: r.session_id,
    verdict: r.verdict, diff: r.diff ?? undefined, ts: r.ts,
    reflected: !!r.reflected,
  };
}

function rowToPack(r: any): Pack {
  return {
    id: r.id, name: r.name, version: r.version ?? undefined,
    sourceType: r.source_type, sourceRef: r.source_ref ?? undefined,
    scope: r.scope, loadedAt: r.loaded_at, signature: r.signature ?? undefined,
    metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined,
  };
}

function renderFact(f: Fact): string {
  const subj = f.subjectText || `#${f.subjectId ?? '?'}`;
  const obj = f.objectText || `#${f.objectId ?? '?'}`;
  return `${subj} — ${f.predicate} — ${obj}`;
}

/** FNV-1a 32-bit; stable cross-process, adequate for vec0 rowid encoding. */
function hashToInt(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

/** Rough token approximation; cheap, good enough for budgeting. ~4 chars/token. */
export function approxTokens(s: string): number {
  return Math.max(1, Math.ceil(s.length / 4));
}

let _store: MemoryStore | null = null;
export function getMemoryStore(): MemoryStore {
  if (!_store) _store = new MemoryStore();
  return _store;
}
export function resetMemoryStore(): void {
  _store = null;
}
