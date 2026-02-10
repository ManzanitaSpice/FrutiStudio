import { createCurseforgeProvider } from "./providers/curseforgeProvider";
import { modrinthProvider } from "./providers/modrinthProvider";
import {
  createPrivateProvider,
  type PrivateCatalogEntry,
} from "./providers/privateProvider";
import type {
  ContentSearchFilters,
  ContentSourceProvider,
  ModCandidate,
  ModSource,
} from "./types";

export interface ContentRegistryOptions {
  curseforgeApiKey?: string;
  privateCatalog?: PrivateCatalogEntry[];
}

export class ContentProviderRegistry {
  private readonly providers: Map<ModSource, ContentSourceProvider>;

  constructor(options: ContentRegistryOptions = {}) {
    this.providers = new Map<ModSource, ContentSourceProvider>([
      ["curseforge", createCurseforgeProvider(options.curseforgeApiKey)],
      ["modrinth", modrinthProvider],
      ["private", createPrivateProvider(options.privateCatalog)],
    ]);
  }

  getProvider(source: ModSource) {
    const provider = this.providers.get(source);
    if (!provider) {
      throw new Error(`Proveedor no soportado: ${source}`);
    }
    return provider;
  }

  async searchAll(filters: ContentSearchFilters): Promise<ModCandidate[]> {
    const searches = Array.from(this.providers.values()).map((provider) =>
      provider.search(filters).catch(() => []),
    );
    const results = await Promise.all(searches);
    return results.flat();
  }
}
