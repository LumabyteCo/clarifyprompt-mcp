/**
 * Memory-layer types. Surface-level DTOs; the SQL schema is in migrations.ts.
 */

export type MemoryScope = string; // `user` | `project:<name>` | `session:<id>`

export type EntityKind = 'person' | 'project' | 'file' | 'concept' | 'platform' | 'other';

export interface Entity {
  id: number;
  scope: MemoryScope;
  kind: EntityKind;
  name: string;
  aliases?: string[];
  firstSeen: number;
  lastSeen: number;
}

export interface Fact {
  id: number;
  scope: MemoryScope;
  subjectId?: number;
  subjectText?: string;
  predicate: string;
  objectId?: number;
  objectText?: string;
  confidence: number;
  source?: string;
  validFrom: number;
  observedAt: number;
  invalidatedAt?: number | null;
  invalidatedBy?: number | null;
  metadata?: Record<string, unknown>;
}

export interface FactInsert {
  scope: MemoryScope;
  subjectText?: string;
  subjectId?: number;
  predicate: string;
  objectText?: string;
  objectId?: number;
  confidence?: number;
  source?: string;
  validFrom?: number;
  observedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface Edge {
  id: number;
  scope: MemoryScope;
  fromEntity: number;
  relation: string;
  toEntity: number;
  confidence: number;
  validFrom: number;
  observedAt: number;
  invalidatedAt?: number | null;
}

export type Verdict = 'accepted' | 'edited' | 'rejected';

export interface Outcome {
  id: number;
  optimizationId: string;
  sessionId: string;
  verdict: Verdict;
  diff?: string;
  ts: number;
  reflected: boolean;
}

export interface PersistedOptimization {
  id: string;
  sessionId: string;
  ts: number;
  originalPrompt: string;
  optimizedPrompt: string;
  category?: string;
  platform?: string;
  mode?: string;
  intent?: string;
  model?: string;
}

export interface Pack {
  id: number;
  name: string;
  version?: string;
  sourceType: 'local' | 'url' | 'inline' | 'registry';
  sourceRef?: string;
  scope: MemoryScope;
  loadedAt: number;
  signature?: string;
  metadata?: Record<string, unknown>;
}

export interface PackChunk {
  id: number;
  packId: number;
  position: number;
  heading?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * A retrieval match that can come from any memory kind (fact, outcome,
 * pack_chunk, prior optimization). Returned as a common DTO so the
 * Curator doesn't care where the signal originated.
 */
export interface MemoryMatch {
  kind: 'fact' | 'outcome' | 'pack_chunk' | 'optimization';
  sourceId: number | string;
  content: string;
  similarity: number;        // 0..1, higher = closer
  tokens?: number;           // approximate token count
  metadata?: Record<string, unknown>;
}
