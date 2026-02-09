export interface ModSearchFilters {
  query: string;
  loader?: string;
  gameVersion?: string;
}

export const searchMods = async (_filters: ModSearchFilters) => {
  const { searchModrinthMods } = await import("./apiClients/modrinth");
  const result = await searchModrinthMods(_filters.query);
  return result.hits ?? [];
};

export const installMod = async (_modId: string) => {
  return Promise.resolve();
};

export const needsModUpdate = async (current: string, latest: string) => {
  const { shouldUpdate } = await import("../utils/semver");
  return shouldUpdate(current, latest);
};
