import type { Category, PlatformConfig, ResolvedPlatformConfig } from './categories.js';
import { getPlatformById as getBuiltInPlatform, getPlatformsForCategory as getBuiltInPlatforms } from './categories.js';
import { getConfigStore, type ConfigStore } from './persistence.js';

export class PlatformRegistry {
  private store: ConfigStore;

  constructor(store?: ConfigStore) {
    this.store = store || getConfigStore();
  }

  async getPlatformsForCategory(categoryId: Category): Promise<PlatformConfig[]> {
    await this.store.ensureLoaded();
    const builtIn = getBuiltInPlatforms(categoryId);
    const custom = this.store.getCustomPlatforms(categoryId).map(entry => ({
      id: entry.id,
      label: entry.label,
      description: entry.description,
      syntaxHints: entry.syntaxHints,
      instructions: entry.instructions,
      instructionsFile: entry.instructionsFile,
      isCustom: true as const,
    }));
    return [...builtIn, ...custom];
  }

  async getPlatformById(categoryId: Category, platformId: string): Promise<ResolvedPlatformConfig | undefined> {
    await this.store.ensureLoaded();

    // Check built-in first
    let platform: PlatformConfig | undefined = getBuiltInPlatform(categoryId, platformId);
    let isCustom = false;

    if (!platform) {
      // Check custom platforms
      const customEntry = this.store.getCustomPlatforms(categoryId).find(p => p.id === platformId);
      if (!customEntry) return undefined;
      platform = {
        id: customEntry.id,
        label: customEntry.label,
        description: customEntry.description,
        syntaxHints: customEntry.syntaxHints,
        instructions: customEntry.instructions,
        instructionsFile: customEntry.instructionsFile,
        isCustom: true,
      };
      isCustom = true;
    }

    // Check for overrides (applies to both built-in and custom)
    const override = this.store.getOverride(categoryId, platformId);

    // Merge syntaxHints
    let mergedHints = platform.syntaxHints || [];
    if (override?.syntaxHintsAppend?.length) {
      mergedHints = [...mergedHints, ...override.syntaxHintsAppend];
    }

    // Resolve instructions: platform instructions + override instructions + file contents
    const platformInstructions = await this.store.resolveInstructions(
      platform.instructions, platform.instructionsFile
    );
    const overrideInstructions = override
      ? await this.store.resolveInstructions(override.instructions, override.instructionsFile)
      : '';

    const resolvedInstructions = [platformInstructions, overrideInstructions]
      .filter(Boolean).join('\n\n');

    return {
      ...platform,
      syntaxHints: mergedHints,
      isCustom: isCustom || platform.isCustom,
      resolvedInstructions: resolvedInstructions || undefined,
    };
  }
}

let registryInstance: PlatformRegistry | null = null;

export function getPlatformRegistry(): PlatformRegistry {
  if (!registryInstance) registryInstance = new PlatformRegistry();
  return registryInstance;
}
