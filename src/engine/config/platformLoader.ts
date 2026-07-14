/**
 * Built-in platform pack loader.
 *
 * Reads `packs/platforms/<category>.yaml` at module-load time and assembles the
 * `CategoryConfig[]` that pre-1.5 lived as hardcoded TypeScript arrays. Adding
 * or editing a platform now means editing a YAML file — no TypeScript edit, no
 * `npm publish` for built-in updates if you ship the YAML in your install.
 *
 * Resolution path:
 *   1. Walk up from the compiled `dist/engine/config/platformLoader.js` to find
 *      the package root, then look for `packs/platforms/`.
 *   2. Also accept a sibling `packs/` next to the module (covers npm-installed
 *      consumers — `node_modules/clarifyprompt-mcp/packs/`).
 *   3. If neither exists, fall back to the hardcoded built-ins via
 *      `getFallbackCategories()` so a malformed install still boots.
 *
 * Failure mode: any individual YAML that fails to parse logs ONE stderr line
 * and is skipped; other categories still load. A missing `packs/platforms/`
 * dir entirely → falls through to the fallback table without throwing.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import type { Category, CategoryConfig, Mode, PlatformConfig } from './categories.js';

const CATEGORY_IDS: Category[] = ['chat', 'image', 'voice', 'video', 'music', 'code', 'document'];

interface RawPlatform {
  id?: unknown;
  label?: unknown;
  description?: unknown;
  syntaxHints?: unknown;
}

interface RawCategoryFile {
  category?: {
    id?: unknown;
    label?: unknown;
    description?: unknown;
    defaultPlatform?: unknown;
    defaultMode?: unknown;
  };
  platforms?: unknown;
}

/**
 * Locate the directory that contains `packs/platforms/*.yaml`. Tries:
 *   1. <repo-root>/packs/platforms     (in-repo dev runs)
 *   2. <package-root>/packs/platforms  (npm-installed consumers)
 *
 * Both resolve relative to this module's file path so the function works
 * the same in `dist/` and in a published package.
 */
function findPlatformsDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/engine/config/platformLoader.js → walk up 3 levels → repo or package root
  const candidates = [
    path.resolve(here, '..', '..', '..', 'packs', 'platforms'),  // dist sibling
    path.resolve(here, '..', '..', 'packs', 'platforms'),        // src/dev sibling (one fewer level)
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
  }
  return null;
}

function isPlatformConfig(p: RawPlatform): p is RawPlatform & { id: string; label: string; description: string } {
  return typeof p?.id === 'string'
      && typeof p?.label === 'string'
      && typeof p?.description === 'string';
}

function normalizePlatforms(raw: unknown): PlatformConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: PlatformConfig[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const p = r as RawPlatform;
    if (!isPlatformConfig(p)) continue;
    const hints = Array.isArray(p.syntaxHints)
      ? p.syntaxHints.filter((h): h is string => typeof h === 'string')
      : undefined;
    out.push({
      id: p.id,
      label: p.label,
      description: p.description,
      ...(hints && hints.length ? { syntaxHints: hints } : {}),
    });
  }
  return out;
}

function loadOne(file: string): CategoryConfig | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    process.stderr.write(`[clarifyprompt] platform pack ${file}: read failed (${(err as Error).message}) — skipping\n`);
    return null;
  }
  let parsed: RawCategoryFile;
  try {
    parsed = yaml.load(raw) as RawCategoryFile;
  } catch (err) {
    process.stderr.write(`[clarifyprompt] platform pack ${file}: YAML parse failed (${(err as Error).message}) — skipping\n`);
    return null;
  }

  const cat = parsed?.category;
  if (!cat || typeof cat.id !== 'string' || !CATEGORY_IDS.includes(cat.id as Category)) {
    process.stderr.write(`[clarifyprompt] platform pack ${file}: missing or unknown category.id — skipping\n`);
    return null;
  }

  const platforms = normalizePlatforms(parsed.platforms);
  return {
    id: cat.id as Category,
    label: typeof cat.label === 'string' ? cat.label : cat.id,
    description: typeof cat.description === 'string' ? cat.description : '',
    platforms,
    defaultPlatform: typeof cat.defaultPlatform === 'string' ? cat.defaultPlatform : platforms[0]?.id,
    defaultMode: (typeof cat.defaultMode === 'string' ? cat.defaultMode : 'detailed') as Mode,
    hasPlatforms: platforms.length > 0,
  };
}

/**
 * Load all `packs/platforms/*.yaml` files. Returns one CategoryConfig per
 * loadable file. Categories not represented (missing file, parse error) are
 * filled in by the caller from the fallback table.
 */
export function loadCategoriesFromPacks(): CategoryConfig[] {
  const dir = findPlatformsDir();
  if (!dir) return [];
  const found: CategoryConfig[] = [];
  for (const id of CATEGORY_IDS) {
    const file = path.join(dir, `${id}.yaml`);
    if (!fs.existsSync(file)) continue;
    const cat = loadOne(file);
    if (cat) found.push(cat);
  }
  return found;
}

/**
 * Merge YAML-loaded categories with a fallback table. Any category present in
 * the YAML wins; categories missing from YAML come from the fallback. This is
 * the resilience layer — a malformed install still has all 7 categories.
 */
export function mergeWithFallback(
  loaded: CategoryConfig[],
  fallback: CategoryConfig[],
): CategoryConfig[] {
  const fb = new Map<Category, CategoryConfig>(fallback.map(c => [c.id, c]));
  const byId = new Map<Category, CategoryConfig>(fb);
  // Field-level merge: a loaded pack wins on the fields it declares, but
  // fallback-only fields (e.g. portableByDefault, which YAML packs don't
  // carry) are preserved rather than clobbered by whole-object replacement.
  for (const c of loaded) {
    const base = fb.get(c.id);
    byId.set(c.id, base ? { ...base, ...c } : c);
  }
  // Preserve the canonical ordering from the fallback array.
  return fallback.map(f => byId.get(f.id)!).filter(Boolean);
}
