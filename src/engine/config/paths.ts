import * as path from 'node:path';
import * as os from 'node:os';

const HOME_ENV = 'CLARIFYPROMPT_HOME';
const LEGACY_CONFIG_ENV = 'CLARIFYPROMPT_CONFIG_DIR';
const LEGACY_DATA_ENV = 'CLARIFYPROMPT_DATA_DIR';

export interface ResolvedPaths {
  home: string;
  instructionsDir: string;
  configFile: string;
  tracesDir: string;
  memoryDir: string;
  packsDir: string;
  source: 'home' | 'legacy-config' | 'legacy-data' | 'xdg' | 'default';
}

let cached: ResolvedPaths | null = null;

/**
 * Single authoritative resolver for all ClarifyPrompt file paths.
 *
 * Precedence:
 *   1. $CLARIFYPROMPT_HOME (canonical, 1.2.0+)
 *   2. $CLARIFYPROMPT_CONFIG_DIR (legacy, pre-1.2 custom-platform dir)
 *   3. $CLARIFYPROMPT_DATA_DIR (legacy, early-1.2 traces dir)
 *   4. $XDG_DATA_HOME/clarifyprompt (standard fallback)
 *   5. ~/.clarifyprompt (final default)
 *
 * Everything — config, traces, memory, packs — lives under one root. The
 * legacy env vars still work so existing installs don't break; they just
 * get logged to stderr once per session as a deprecation hint.
 */
export function getPaths(): ResolvedPaths {
  if (cached) return cached;

  const { home, source } = resolveHome();
  cached = {
    home,
    source,
    configFile: path.join(home, 'config.json'),
    instructionsDir: path.join(home, 'instructions'),
    tracesDir: path.join(home, 'traces'),
    memoryDir: path.join(home, 'memory'),
    packsDir: path.join(home, 'packs'),
  };

  if (source === 'legacy-config' || source === 'legacy-data') {
    // One-line hint, not a spammy warning. Caller can silence via ENV.
    if (!process.env.CLARIFYPROMPT_SUPPRESS_LEGACY_WARN) {
      const legacy = source === 'legacy-config' ? LEGACY_CONFIG_ENV : LEGACY_DATA_ENV;
      process.stderr.write(
        `[clarifyprompt] Using legacy ${legacy}. Prefer CLARIFYPROMPT_HOME going forward. Set CLARIFYPROMPT_SUPPRESS_LEGACY_WARN=1 to silence.\n`,
      );
    }
  }

  return cached;
}

/**
 * Test-only reset. Production code should never call this.
 */
export function resetPaths(): void {
  cached = null;
}

function resolveHome(): { home: string; source: ResolvedPaths['source'] } {
  const fromHome = process.env[HOME_ENV];
  if (fromHome) return { home: fromHome, source: 'home' };

  const fromLegacyConfig = process.env[LEGACY_CONFIG_ENV];
  if (fromLegacyConfig) return { home: fromLegacyConfig, source: 'legacy-config' };

  const fromLegacyData = process.env[LEGACY_DATA_ENV];
  if (fromLegacyData) return { home: fromLegacyData, source: 'legacy-data' };

  const fromXdg = process.env.XDG_DATA_HOME;
  if (fromXdg) return { home: path.join(fromXdg, 'clarifyprompt'), source: 'xdg' };

  return { home: path.join(os.homedir(), '.clarifyprompt'), source: 'default' };
}
