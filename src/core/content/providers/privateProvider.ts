import type {
  ContentSearchFilters,
  ContentSourceProvider,
  DependencyCandidate,
  DownloadedArtifact,
  ModCandidate,
} from "../types";

export interface PrivateCatalogEntry {
  id: string;
  name: string;
  summary?: string;
  downloadUrl: string;
  dependencies?: string[];
}

export const createPrivateProvider = (
  catalog: PrivateCatalogEntry[] = [],
): ContentSourceProvider => ({
  source: "private",
  async search(filters: ContentSearchFilters): Promise<ModCandidate[]> {
    const needle = filters.query.trim().toLowerCase();
    return catalog
      .filter((entry) => entry.name.toLowerCase().includes(needle))
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        summary: entry.summary,
        source: "private",
      }));
  },
  async download(id: string): Promise<DownloadedArtifact | null> {
    const entry = catalog.find((item) => item.id === id);
    if (!entry) return null;

    return {
      fileName: `${entry.id}.jar`,
      url: entry.downloadUrl,
    };
  },
  async resolveDependencies(id: string): Promise<DependencyCandidate[]> {
    const entry = catalog.find((item) => item.id === id);
    return (entry?.dependencies ?? []).map((dependencyId) => ({
      id: dependencyId,
      required: true,
      source: "private",
    }));
  },
});
