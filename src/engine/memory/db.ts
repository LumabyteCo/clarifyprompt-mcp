import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getPaths } from '../config/paths.js';
import { MIGRATIONS } from './migrations.js';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const { memoryDir } = getPaths();
  fs.mkdirSync(memoryDir, { recursive: true });
  const dbPath = path.join(memoryDir, 'memory.db');

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  try {
    sqliteVec.load(db);
  } catch (err) {
    console.error(
      '[clarifyprompt.memory] Failed to load sqlite-vec. Memory / retrieval features will be disabled.\n' +
      'Root cause:',
      (err as Error).message,
    );
    // Continue without vector support; callers handle the missing extension.
  }

  runMigrations(db);
  _db = db;
  return db;
}

export function closeDb(): void {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
    _db = null;
  }
}

/** Test-only: reset the cached db handle (forces next getDb() to reopen). */
export function resetDbHandle(): void {
  _db = null;
}

function runMigrations(db: Database.Database): void {
  // Ensure the tracking table exists before we check it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r: any) => r.version as number),
  );

  const insertApplied = db.prepare(
    'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const mig of MIGRATIONS) {
    if (applied.has(mig.version)) continue;
    const tx = db.transaction(() => {
      db.exec(mig.sql);
      insertApplied.run(mig.version, mig.name, new Date().toISOString());
    });
    tx();
  }
}

/**
 * Returns whether sqlite-vec is functional on this db handle. Callers that
 * need vectors should check this before building vector queries.
 */
export function hasVectorSupport(db: Database.Database): boolean {
  try {
    db.prepare('SELECT vec_version()').get();
    return true;
  } catch {
    return false;
  }
}
