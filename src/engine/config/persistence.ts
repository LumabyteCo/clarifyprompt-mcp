import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Category } from './categories.js';
import { getPaths } from './paths.js';

export interface CustomPlatformEntry {
  id: string;
  label: string;
  description: string;
  categoryId: Category;
  syntaxHints?: string[];
  instructions?: string;
  instructionsFile?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformOverrideEntry {
  platformId: string;
  categoryId: Category;
  instructions?: string;
  instructionsFile?: string;
  syntaxHintsAppend?: string[];
  updatedAt: string;
}

interface CustomConfig {
  version: 1;
  customPlatforms: Record<string, CustomPlatformEntry[]>;
  platformOverrides: Record<string, PlatformOverrideEntry[]>;
}

function emptyConfig(): CustomConfig {
  return { version: 1, customPlatforms: {}, platformOverrides: {} };
}

export class ConfigStore {
  private configDir: string;
  private configPath: string;
  private instructionsDir: string;
  private config: CustomConfig;
  private loaded = false;

  constructor() {
    const paths = getPaths();
    this.configDir = paths.home;
    this.configPath = paths.configFile;
    this.instructionsDir = paths.instructionsDir;
    this.config = emptyConfig();
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  async load(): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    await fs.mkdir(this.instructionsDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8');
      this.config = JSON.parse(raw) as CustomConfig;
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        this.config = emptyConfig();
      } else if (err instanceof SyntaxError) {
        throw new Error(`Malformed config file at ${this.configPath}: ${err.message}`);
      } else {
        throw err;
      }
    }
    this.loaded = true;
  }

  async save(): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  async resolveInstructions(instructions?: string, instructionsFile?: string): Promise<string> {
    const parts: string[] = [];
    if (instructions) parts.push(instructions);
    if (instructionsFile) {
      const filePath = path.isAbsolute(instructionsFile)
        ? instructionsFile
        : path.join(this.instructionsDir, instructionsFile);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        parts.push(content);
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        console.error(`[ConfigStore] Warning: Could not read instructions file ${filePath}: ${e.message}`);
      }
    }
    return parts.join('\n\n');
  }

  // --- Custom Platforms ---

  getCustomPlatforms(categoryId: Category): CustomPlatformEntry[] {
    return this.config.customPlatforms[categoryId] || [];
  }

  addCustomPlatform(entry: CustomPlatformEntry): void {
    if (!this.config.customPlatforms[entry.categoryId]) {
      this.config.customPlatforms[entry.categoryId] = [];
    }
    this.config.customPlatforms[entry.categoryId].push(entry);
  }

  updateCustomPlatform(categoryId: Category, platformId: string, updates: Partial<CustomPlatformEntry>): boolean {
    const platforms = this.config.customPlatforms[categoryId];
    if (!platforms) return false;
    const idx = platforms.findIndex(p => p.id === platformId);
    if (idx === -1) return false;
    platforms[idx] = { ...platforms[idx], ...updates };
    return true;
  }

  removeCustomPlatform(categoryId: Category, platformId: string): boolean {
    const platforms = this.config.customPlatforms[categoryId];
    if (!platforms) return false;
    const idx = platforms.findIndex(p => p.id === platformId);
    if (idx === -1) return false;
    platforms.splice(idx, 1);
    return true;
  }

  // --- Platform Overrides ---

  getOverride(categoryId: Category, platformId: string): PlatformOverrideEntry | undefined {
    const overrides = this.config.platformOverrides[categoryId];
    if (!overrides) return undefined;
    return overrides.find(o => o.platformId === platformId);
  }

  setOverride(entry: PlatformOverrideEntry): void {
    if (!this.config.platformOverrides[entry.categoryId]) {
      this.config.platformOverrides[entry.categoryId] = [];
    }
    const overrides = this.config.platformOverrides[entry.categoryId];
    const idx = overrides.findIndex(o => o.platformId === entry.platformId);
    if (idx === -1) {
      overrides.push(entry);
    } else {
      overrides[idx] = { ...overrides[idx], ...entry };
    }
  }

  removeOverride(categoryId: Category, platformId: string): boolean {
    const overrides = this.config.platformOverrides[categoryId];
    if (!overrides) return false;
    const idx = overrides.findIndex(o => o.platformId === platformId);
    if (idx === -1) return false;
    overrides.splice(idx, 1);
    return true;
  }

  getInstructionsDir(): string {
    return this.instructionsDir;
  }
}

let storeInstance: ConfigStore | null = null;

export function getConfigStore(): ConfigStore {
  if (!storeInstance) storeInstance = new ConfigStore();
  return storeInstance;
}
