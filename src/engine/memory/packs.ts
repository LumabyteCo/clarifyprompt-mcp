/**
 * Knowledge-pack loader.
 *
 * A knowledge pack is a markdown document with a YAML-ish frontmatter that
 * declares metadata. Packs can be loaded from local paths, HTTPS URLs, or
 * inline strings. The loader:
 *   1. Fetches the content
 *   2. Parses frontmatter
 *   3. Splits the body into heading-scoped chunks (~500–1500 chars)
 *   4. Embeds each chunk
 *   5. Stores pack + chunks in the memory DB
 *
 * Packs show up as `pack_chunk` memory matches in subsequent optimize calls,
 * scored by the curator like any other grounding source. This is the
 * community-facing surface of 1.3.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getMemoryStore } from './store.js';
import type { MemoryScope, Pack } from './types.js';

export interface LoadPackOptions {
  source: string;             // local path, https://... URL, or raw markdown (inline)
  sourceType?: 'auto' | 'local' | 'url' | 'inline' | 'registry';
  scope?: MemoryScope;
  name?: string;              // override pack name (else from frontmatter)
  version?: string;           // override pack version (else from frontmatter)
}

export interface LoadPackResult {
  pack: Pack;
  chunks: number;
  embedded: number;
  skipped: number;
}

export interface PackFrontmatter {
  name?: string;
  version?: string;
  description?: string;
  scope?: string;
  author?: string;
  license?: string;
  tags?: string[];
}

export interface ParsedPack {
  frontmatter: PackFrontmatter;
  body: string;
}

const FRONTMATTER_DELIM = /^---\s*$/m;

/** Parse `--- frontmatter --- body` markdown. YAML-lite, no deps. */
export function parsePackSource(raw: string): ParsedPack {
  const trimmed = raw.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: trimmed };
  }
  const rest = trimmed.slice(3);
  const closeMatch = rest.match(FRONTMATTER_DELIM);
  if (!closeMatch || closeMatch.index === undefined) {
    return { frontmatter: {}, body: trimmed };
  }
  const yaml = rest.slice(0, closeMatch.index).trim();
  const body = rest.slice(closeMatch.index).replace(FRONTMATTER_DELIM, '').trim();
  return { frontmatter: parseYamlLite(yaml), body };
}

/**
 * A minimal YAML parser sufficient for flat key-value frontmatter plus
 * arrays via inline [a, b, c] syntax. Avoids pulling in js-yaml just for
 * pack metadata.
 */
function parseYamlLite(s: string): PackFrontmatter {
  const out: Record<string, unknown> = {};
  for (const rawLine of s.split(/\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let value: unknown = m[2].trim();
    if (typeof value === 'string') {
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Inline array: [a, b, c]
      if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      }
    }
    out[key] = value;
  }
  return out as PackFrontmatter;
}

/**
 * Split markdown body into heading-scoped chunks. Keeps under ~1500 chars
 * each; bodies below a heading that exceed the limit get further split by
 * paragraph.
 */
export function chunkPackBody(body: string, maxChars = 1500): { heading?: string; content: string }[] {
  const lines = body.split(/\n/);
  const chunks: { heading?: string; content: string }[] = [];
  let currentHeading: string | undefined;
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (!content) return;
    if (content.length <= maxChars) {
      chunks.push({ heading: currentHeading, content });
    } else {
      // split by blank lines into paragraphs, merge until ~maxChars
      const paras = content.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
      let part: string[] = [];
      let partLen = 0;
      for (const p of paras) {
        if (partLen + p.length + 2 > maxChars && part.length) {
          chunks.push({ heading: currentHeading, content: part.join('\n\n') });
          part = [p]; partLen = p.length;
        } else {
          part.push(p); partLen += p.length + 2;
        }
      }
      if (part.length) chunks.push({ heading: currentHeading, content: part.join('\n\n') });
    }
    buffer = [];
  };

  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h) {
      flush();
      currentHeading = h[2].trim();
      buffer.push(line);
    } else {
      buffer.push(line);
    }
  }
  flush();
  return chunks.filter(c => c.content.trim().length > 0);
}

/** Fetch pack source from wherever. */
async function fetchPackSource(source: string, sourceType: LoadPackOptions['sourceType']): Promise<{ raw: string; resolvedType: 'local' | 'url' | 'inline' | 'registry' }> {
  const explicit = sourceType && sourceType !== 'auto' ? sourceType : undefined;

  if (explicit === 'inline' || (!explicit && looksLikeInline(source))) {
    return { raw: source, resolvedType: 'inline' };
  }
  if (explicit === 'url' || (!explicit && /^https?:\/\//i.test(source))) {
    const response = await fetch(source, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching pack from ${source}`);
    return { raw: await response.text(), resolvedType: 'url' };
  }
  // Default to local path
  const abs = path.isAbsolute(source) ? source : path.resolve(process.cwd(), source);
  const raw = await fs.readFile(abs, 'utf-8');
  return { raw, resolvedType: explicit === 'registry' ? 'registry' : 'local' };
}

function looksLikeInline(source: string): boolean {
  // Inline markdown typically contains a newline or starts with `---` frontmatter.
  return source.includes('\n') && source.length > 80;
}

/** High-level loader — the function called by the MCP tool. */
export async function loadKnowledgePack(opts: LoadPackOptions): Promise<LoadPackResult> {
  const store = getMemoryStore();
  if (!store.isHealthy()) throw new Error('memory store not healthy');

  const { raw, resolvedType } = await fetchPackSource(opts.source, opts.sourceType);
  const parsed = parsePackSource(raw);
  const name = opts.name ?? parsed.frontmatter.name ?? inferName(opts.source);
  const version = opts.version ?? parsed.frontmatter.version ?? '0.0.0';
  const scope = opts.scope ?? parsed.frontmatter.scope ?? 'user';

  const existing = store.listPacks(scope).find(p => p.name === name);
  if (existing) {
    // Replace: drop existing + chunks (ON DELETE CASCADE) then insert fresh.
    store.removePack(existing.id);
  }

  const packId = store.insertPack({
    name,
    version,
    sourceType: resolvedType,
    sourceRef: resolvedType === 'inline' ? undefined : opts.source,
    scope,
    loadedAt: Date.now(),
    signature: undefined,
    metadata: {
      description: parsed.frontmatter.description,
      author: parsed.frontmatter.author,
      license: parsed.frontmatter.license,
      tags: parsed.frontmatter.tags,
    },
  });

  const chunks = chunkPackBody(parsed.body);
  let embedded = 0;
  let skipped = 0;
  for (const [i, c] of chunks.entries()) {
    const chunkId = store.insertPackChunk({
      packId,
      position: i,
      heading: c.heading,
      content: c.content,
    });
    if (store.hasVectors()) {
      try {
        await store.embedAndStore('pack_chunk', chunkId, `${c.heading ?? ''}\n${c.content}`);
        embedded++;
      } catch {
        skipped++;
      }
    } else {
      skipped++;
    }
  }

  const pack = store.listPacks(scope).find(p => p.id === packId)!;
  return { pack, chunks: chunks.length, embedded, skipped };
}

function inferName(source: string): string {
  if (/^https?:\/\//i.test(source)) {
    const u = new URL(source);
    return path.basename(u.pathname).replace(/\.md$/i, '') || u.hostname;
  }
  return path.basename(source).replace(/\.md$/i, '') || 'unnamed-pack';
}
