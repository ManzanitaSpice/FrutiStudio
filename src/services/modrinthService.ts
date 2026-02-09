import {
  fetchModrinthProject,
  fetchModrinthVersionFiles,
  fetchModrinthVersions,
  searchModrinthMods,
} from "./apiClients/modrinth";

export interface ModrinthSearchFilters {
  query: string;
  loader?: string;
  gameVersion?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export interface ModrinthProjectSummary {
  id: string;
  title: string;
  description?: string;
  downloads?: number;
  versions?: string[];
  projectType?: string;
}

const buildFacets = (filters: ModrinthSearchFilters) => {
  const facets: string[][] = [];
  if (filters.loader) {
    facets.push([`categories:${filters.loader}`]);
  }
  if (filters.gameVersion) {
    facets.push([`versions:${filters.gameVersion}`]);
  }
  if (filters.tags && filters.tags.length > 0) {
    facets.push(filters.tags.map((tag) => `categories:${tag}`));
  }
  return facets;
};

const mapProject = (item: Record<string, unknown>): ModrinthProjectSummary => ({
  id: String(item.project_id ?? item.id ?? ""),
  title: String(item.title ?? item.name ?? ""),
  description: item.description as string | undefined,
  downloads: item.downloads as number | undefined,
  versions: item.versions as string[] | undefined,
  projectType: item.project_type as string | undefined,
});

export const searchModrinth = async (filters: ModrinthSearchFilters) => {
  const result = await searchModrinthMods({
    query: filters.query,
    facets: buildFacets(filters),
    limit: filters.limit,
    offset: filters.offset,
  });
  return (result.hits ?? []).map((item) =>
    mapProject(item as Record<string, unknown>),
  );
};

export const fetchModrinthProjectDetails = async (projectId: string) => {
  const project = (await fetchModrinthProject(projectId)) as Record<
    string,
    unknown
  >;
  return mapProject(project);
};

export const fetchModrinthProjectVersions = async (projectId: string) => {
  const versions = (await fetchModrinthVersions(projectId)) as Record<
    string,
    unknown
  >[];
  return versions.map((version) => ({
    id: String(version.id ?? ""),
    name: String(version.name ?? ""),
    versionNumber: String(version.version_number ?? ""),
    loaders: version.loaders as string[] | undefined,
    gameVersions: version.game_versions as string[] | undefined,
    files: version.files as unknown[] | undefined,
  }));
};

export const fetchModrinthVersionDetails = async (versionId: string) => {
  const details = (await fetchModrinthVersionFiles(versionId)) as Record<
    string,
    unknown
  >;
  return {
    id: String(details.id ?? ""),
    name: String(details.name ?? ""),
    versionNumber: String(details.version_number ?? ""),
    files: details.files as unknown[] | undefined,
  };
};
