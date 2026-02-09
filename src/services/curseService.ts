import {
  fetchCurseforgeFiles,
  fetchCurseforgeGameVersions,
  fetchCurseforgeMod,
  fetchCurseforgeModLoaders,
  searchCurseforgeMods,
  type CurseforgeSearchFilters,
} from "./apiClients/curseforge";

export interface CurseforgeSearchOptions extends CurseforgeSearchFilters {
  apiKey?: string;
}

export interface CurseforgeModSummary {
  id: number;
  name: string;
  summary?: string;
  downloadCount?: number;
  websiteUrl?: string;
}

const mapMod = (item: Record<string, unknown>): CurseforgeModSummary => ({
  id: Number(item.id ?? 0),
  name: String(item.name ?? ""),
  summary: item.summary as string | undefined,
  downloadCount: item.downloadCount as number | undefined,
  websiteUrl: item.links && typeof item.links === "object"
    ? (item.links as { websiteUrl?: string }).websiteUrl
    : undefined,
});

export const searchCurseforge = async ({
  apiKey,
  ...filters
}: CurseforgeSearchOptions) => {
  const response = await searchCurseforgeMods(filters, apiKey);
  return (response.data ?? []).map((item) =>
    mapMod(item as Record<string, unknown>),
  );
};

export const fetchCurseforgeModDetails = async (
  modId: number,
  apiKey?: string,
) => {
  const response = await fetchCurseforgeMod(modId, apiKey);
  return mapMod(response.data as Record<string, unknown>);
};

export const fetchCurseforgeModFiles = async (modId: number, apiKey?: string) => {
  const response = await fetchCurseforgeFiles(modId, apiKey);
  return (response.data ?? []).map((file) => ({
    id: Number((file as Record<string, unknown>).id ?? 0),
    fileName: String((file as Record<string, unknown>).fileName ?? ""),
    downloadUrl: String((file as Record<string, unknown>).downloadUrl ?? ""),
    hashes: (file as Record<string, unknown>).hashes as
      | Array<{ algo: number; value: string }>
      | undefined,
    gameVersions: (file as Record<string, unknown>).gameVersions as
      | string[]
      | undefined,
  }));
};

export const fetchCurseforgeMinecraftVersions = async (apiKey?: string) => {
  const response = await fetchCurseforgeGameVersions(apiKey);
  return response.data ?? [];
};

export const fetchCurseforgeLoaders = async (apiKey?: string) => {
  const response = await fetchCurseforgeModLoaders(apiKey);
  return response.data ?? [];
};
