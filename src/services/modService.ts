export interface ModSearchFilters {
  query: string;
  loader?: string;
  gameVersion?: string;
  tags?: string[];
}

export const searchMods = async (_filters: ModSearchFilters) => {
  const { searchModrinth } = await import("./modrinthService");
  return searchModrinth(_filters);
};

export const installMod = async (_modId: string) => {
  return Promise.resolve();
};

export const needsModUpdate = async (current: string, latest: string) => {
  const { shouldUpdate } = await import("../utils/semver");
  return shouldUpdate(current, latest);
};
