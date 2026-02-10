import {
  fetchCurseforgeModFiles,
  searchCurseforge,
} from "../../../services/curseService";
import type {
  ContentSearchFilters,
  ContentSourceProvider,
  DependencyCandidate,
  DownloadedArtifact,
  ModCandidate,
} from "../types";

export const createCurseforgeProvider = (apiKey?: string): ContentSourceProvider => ({
  source: "curseforge",
  async search(filters: ContentSearchFilters): Promise<ModCandidate[]> {
    const mods = await searchCurseforge({
      apiKey,
      query: filters.query,
      gameVersion: filters.gameVersion,
      pageSize: 20,
    });
    return mods.map((mod) => ({
      id: String(mod.id),
      name: mod.name,
      summary: mod.summary,
      source: "curseforge",
    }));
  },
  async download(id: string, versionId?: string): Promise<DownloadedArtifact | null> {
    const modId = Number(id);
    if (!Number.isFinite(modId)) return null;

    const files = await fetchCurseforgeModFiles(modId, apiKey);
    const picked = versionId
      ? files.find((file) => String(file.id) === versionId)
      : files[0];

    if (!picked?.downloadUrl) return null;

    return {
      fileName: picked.fileName,
      url: picked.downloadUrl,
      hash: picked.hashes?.[0]?.value,
    };
  },
  async resolveDependencies(): Promise<DependencyCandidate[]> {
    return [];
  },
});
