import {
  fetchModrinthVersionDetails,
  fetchModrinthProjectVersions,
  searchModrinth,
} from "../../../services/modrinthService";
import type {
  ContentSearchFilters,
  ContentSourceProvider,
  DependencyCandidate,
  DownloadedArtifact,
  ModCandidate,
} from "../types";

export const modrinthProvider: ContentSourceProvider = {
  source: "modrinth",
  async search(filters: ContentSearchFilters): Promise<ModCandidate[]> {
    const results = await searchModrinth({
      query: filters.query,
      loader: filters.loader,
      gameVersion: filters.gameVersion,
      tags: filters.tags,
      limit: 20,
    });

    return results.map((item) => ({
      id: item.id,
      name: item.title,
      summary: item.description,
      source: "modrinth",
    }));
  },
  async download(id: string, versionId?: string): Promise<DownloadedArtifact | null> {
    if (!versionId) {
      const versions = await fetchModrinthProjectVersions(id);
      versionId = versions[0]?.id;
    }
    if (!versionId) return null;

    const version = await fetchModrinthVersionDetails(versionId);
    const file = version.files?.[0] as
      | { filename?: string; url?: string; hashes?: { sha1?: string } }
      | undefined;
    if (!file?.url) return null;

    return {
      fileName: file.filename ?? `${id}.jar`,
      url: file.url,
      hash: file.hashes?.sha1,
    };
  },
  async resolveDependencies(
    id: string,
    versionId?: string,
  ): Promise<DependencyCandidate[]> {
    if (!versionId) {
      const versions = await fetchModrinthProjectVersions(id);
      versionId = versions[0]?.id;
    }
    if (!versionId) return [];

    const version = await fetchModrinthVersionDetails(versionId);
    const dependencies =
      (
        version as unknown as {
          dependencies?: Array<{ project_id?: string; dependency_type?: string }>;
        }
      ).dependencies ?? [];

    return dependencies
      .filter((dependency) => Boolean(dependency.project_id))
      .map((dependency) => ({
        id: String(dependency.project_id),
        required: dependency.dependency_type !== "optional",
        source: "modrinth",
      }));
  },
};
