import { ContentProviderRegistry } from "../core/content/registry";
import type { ModSource } from "../core/content/types";

export interface ModSearchFilters {
  query: string;
  loader?: string;
  gameVersion?: string;
  tags?: string[];
  source?: "all" | ModSource;
}

const defaultRegistry = new ContentProviderRegistry();

export const searchMods = async (filters: ModSearchFilters) => {
  if (!filters.source || filters.source === "all") {
    return defaultRegistry.searchAll(filters);
  }

  return defaultRegistry.getProvider(filters.source).search(filters);
};

export const installMod = async (
  source: ModSource,
  modId: string,
  versionId?: string,
) => {
  return defaultRegistry.getProvider(source).download(modId, versionId);
};

export const resolveModDependencies = async (
  source: ModSource,
  modId: string,
  versionId?: string,
) => {
  return defaultRegistry.getProvider(source).resolveDependencies(modId, versionId);
};

export const needsModUpdate = async (current: string, latest: string) => {
  const { shouldUpdate } = await import("../utils/semver");
  return shouldUpdate(current, latest);
};
