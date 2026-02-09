export interface ModSearchFilters {
  query: string;
  loader?: string;
  gameVersion?: string;
}

export const searchMods = async (_filters: ModSearchFilters) => {
  return Promise.resolve([] as Array<Record<string, unknown>>);
};

export const installMod = async (_modId: string) => {
  return Promise.resolve();
};
