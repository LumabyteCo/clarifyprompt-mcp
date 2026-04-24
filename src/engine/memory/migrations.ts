/**
 * Memory substrate migrations. Each migration is idempotent on the tracked
 * `schema_migrations` table. Migrations run on first db open; the runner
 * records the highest-applied version so re-runs are no-ops.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
      -- Internal: migration tracking
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      -- Sessions: persistent session records (replaces in-memory ring buffer).
      CREATE TABLE IF NOT EXISTS sessions (
        id            TEXT PRIMARY KEY,
        started_at    INTEGER NOT NULL,
        last_active   INTEGER NOT NULL,
        summary       TEXT,
        metadata_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active DESC);

      -- Entities: named things the memory refers to (user, project, file, concept).
      -- 'scope' namespaces entities so the same project name in two workspaces
      -- doesn't collide.
      CREATE TABLE IF NOT EXISTS entities (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        scope        TEXT NOT NULL,        -- user | project:<name> | session:<id>
        kind         TEXT NOT NULL,        -- person | project | file | concept | other
        name         TEXT NOT NULL,
        aliases_json TEXT,                 -- JSON array of alternative names
        first_seen   INTEGER NOT NULL,
        last_seen    INTEGER NOT NULL,
        UNIQUE(scope, kind, name)
      );
      CREATE INDEX IF NOT EXISTS idx_entities_scope_kind ON entities(scope, kind);

      -- Facts: bi-temporal (Graphiti-style) atomic memory unit.
      -- subject/predicate/object form a triple; valid_from is when the fact
      -- became true in the world; observed_at is when we learned it;
      -- invalidated_at nullable means the fact has been superseded.
      CREATE TABLE IF NOT EXISTS facts (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        scope          TEXT NOT NULL,
        subject_id     INTEGER REFERENCES entities(id),
        subject_text   TEXT,
        predicate      TEXT NOT NULL,
        object_id      INTEGER REFERENCES entities(id),
        object_text    TEXT,
        confidence     REAL NOT NULL DEFAULT 0.8,  -- 0..1
        source         TEXT,                       -- where this came from
        valid_from     INTEGER NOT NULL,
        observed_at    INTEGER NOT NULL,
        invalidated_at INTEGER,
        invalidated_by INTEGER REFERENCES facts(id),
        metadata_json  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_facts_scope ON facts(scope);
      CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject_id, invalidated_at);
      CREATE INDEX IF NOT EXISTS idx_facts_predicate ON facts(predicate, invalidated_at);
      CREATE INDEX IF NOT EXISTS idx_facts_live ON facts(scope, invalidated_at);

      -- Outcomes: accept/reject verdicts from save_outcome.
      -- 'reflected' tracks whether the reflection pass has extracted facts
      -- from this outcome yet (so we don't redo the work).
      CREATE TABLE IF NOT EXISTS outcomes (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        optimization_id TEXT NOT NULL,
        session_id      TEXT NOT NULL,
        verdict         TEXT NOT NULL CHECK(verdict IN ('accepted','edited','rejected')),
        diff            TEXT,
        ts              INTEGER NOT NULL,
        reflected       INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_outcomes_opt ON outcomes(optimization_id);
      CREATE INDEX IF NOT EXISTS idx_outcomes_session ON outcomes(session_id);
      CREATE INDEX IF NOT EXISTS idx_outcomes_unreflected ON outcomes(reflected, ts) WHERE reflected = 0;

      -- Optimizations: persistent record of each optimize_prompt call,
      -- enough to drive retrieval + reflection without re-parsing traces.
      CREATE TABLE IF NOT EXISTS optimizations (
        id                TEXT PRIMARY KEY,
        session_id        TEXT NOT NULL,
        ts                INTEGER NOT NULL,
        original_prompt   TEXT NOT NULL,
        optimized_prompt  TEXT NOT NULL,
        category          TEXT,
        platform          TEXT,
        mode              TEXT,
        intent            TEXT,
        model             TEXT,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_opts_session ON optimizations(session_id, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_opts_category ON optimizations(category, intent);

      -- Packs: loaded knowledge packs.
      CREATE TABLE IF NOT EXISTS packs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        version       TEXT,
        source_type   TEXT NOT NULL CHECK(source_type IN ('local','url','inline','registry')),
        source_ref    TEXT,
        scope         TEXT NOT NULL,
        loaded_at     INTEGER NOT NULL,
        signature     TEXT,
        metadata_json TEXT,
        UNIQUE(scope, name)
      );
      CREATE INDEX IF NOT EXISTS idx_packs_scope ON packs(scope);

      -- Pack chunks: searchable chunks with their own embeddings.
      CREATE TABLE IF NOT EXISTS pack_chunks (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        pack_id       INTEGER NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
        position      INTEGER NOT NULL,
        heading       TEXT,
        content       TEXT NOT NULL,
        metadata_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pack_chunks_pack ON pack_chunks(pack_id, position);

      -- Edges: explicit entity-to-entity relations for graph-style queries.
      -- Separate from facts because many facts are subject/value, not
      -- subject/object (e.g. "user prefers concise mode" — "concise" isn't
      -- an entity, it's a value). Edges are for the subset where both sides
      -- are entities.
      CREATE TABLE IF NOT EXISTS edges (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        scope          TEXT NOT NULL,
        from_entity    INTEGER NOT NULL REFERENCES entities(id),
        relation       TEXT NOT NULL,
        to_entity      INTEGER NOT NULL REFERENCES entities(id),
        confidence     REAL NOT NULL DEFAULT 0.8,
        valid_from     INTEGER NOT NULL,
        observed_at    INTEGER NOT NULL,
        invalidated_at INTEGER,
        invalidated_by INTEGER REFERENCES edges(id)
      );
      CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_entity, invalidated_at);
      CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_entity, invalidated_at);
      CREATE INDEX IF NOT EXISTS idx_edges_rel ON edges(relation, invalidated_at);

      -- Vector index: one partitioned virtual table per embedding dim,
      -- partitioned by "kind" so we can search within a specific memory
      -- type (fact / outcome / pack_chunk / optimization). Default dim is
      -- 768 for nomic-embed-text; new dims add new tables in future migs.
      CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_768 USING vec0(
        kind TEXT PARTITION KEY,
        source_id INTEGER,
        vec float[768]
      );
    `,
  },
];
