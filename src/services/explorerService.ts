import { apiFetch } from "./apiClients/client";
import { getCurseforgeApiKey } from "./curseforgeKeyService";

export type ExplorerCategory =
  | "Modpacks"
  | "Mods"
  | "Shaders"
  | "Resource Packs"
  | "Data Packs"
  | "Worlds"
  | "Addons";

export type ExplorerSort = "relevance" | "popular" | "updated";

export interface ExplorerFilters {
  query?: string;
  category: ExplorerCategory;
  gameVersion?: string;
  loader?: string;
  platform?: "all" | "modrinth" | "curseforge";
  sort?: ExplorerSort;
  page?: number;
  pageSize?: number;
}

export interface ExplorerItem {
  id: string;
  projectId: string;
  name: string;
  author: string;
  downloads: string;
  rawDownloads: number;
  description: string;
  type: string;
  source: "Modrinth" | "CurseForge" | "ATLauncher";
  updatedAt?: string;
  versions: string[];
  loaders: string[];
  thumbnail?: string;
  url?: string;
}

export interface ExplorerResult {
  items: ExplorerItem[];
  hasMore: boolean;
  total: number;
  page: number;
}

export interface ExplorerItemDetails {
  id: string;
  source: "Modrinth" | "CurseForge" | "ATLauncher";
  title: string;
  author: string;
  description: string;
  body?: string;
  gallery: string[];
  gameVersions: string[];
  loaders: string[];
  dependencies: string[];
  downloads: number;
  updatedAt?: string;
  url?: string;
  type: string;
}

interface ModrinthSearchHit {
  project_id: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  project_type: string;
  slug: string;
  icon_url?: string;
  versions?: string[];
  latest_version?: string;
  date_modified?: string;
  categories?: string[];
  gallery?: Array<{ featured: boolean; url: string }>;
}

interface ModrinthSearchResponse {
  hits: ModrinthSearchHit[];
  total_hits: number;
}

interface ModrinthProjectResponse {
  id: string;
  title: string;
  description: string;
  body?: string;
  project_type: string;
  icon_url?: string;
  gallery?: Array<{ featured: boolean; url: string }>;
  versions?: string[];
  categories?: string[];
  game_versions?: string[];
  downloads?: number;
  updated?: string;
  slug?: string;
}

interface CurseforgeSearchItem {
  id: number;
  name: string;
  summary?: string;
  downloadCount?: number;
  dateReleased?: string;
  authors?: Array<{ name?: string }>;
  logo?: { thumbnailUrl?: string; url?: string };
  links?: { websiteUrl?: string };
  latestFilesIndexes?: Array<{ gameVersion?: string; modLoader?: number }>;
}

interface CurseforgeSearchResponse {
  data: CurseforgeSearchItem[];
  pagination?: {
    index: number;
    pageSize: number;
    resultCount: number;
    totalCount: number;
  };
}

interface CurseforgeModResponse {
  data: CurseforgeSearchItem & {
    screenshots?: Array<{ url?: string; thumbnailUrl?: string }>;
    latestFiles?: Array<{ gameVersions?: string[]; dependencies?: Array<{ modId?: number }> }>;
  };
}

const MODRINTH_BASE = "https://api.modrinth.com/v2";
const CURSEFORGE_BASE = "https://api.curseforge.com/v1";
const CURSE_MINECRAFT_GAME_ID = 432;

const MAX_PAGE_SIZE = 24;

const categoryProjectTypes: Record<ExplorerCategory, string> = {
  Modpacks: "modpack",
  Mods: "mod",
  Shaders: "shader",
  "Resource Packs": "resourcepack",
  "Data Packs": "datapack",
  Worlds: "mod",
  Addons: "plugin",
};

const curseforgeClassIds: Partial<Record<ExplorerCategory, number>> = {
  Mods: 6,
  Modpacks: 4471,
  "Resource Packs": 12,
  Shaders: 6552,
};

const curseforgeLoaders: Record<string, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};

const formatDownloads = (downloads: number) =>
  new Intl.NumberFormat("es-ES", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(downloads);

const mapSort = (sort: ExplorerSort | undefined) => {
  if (sort === "popular") {
    return 2;
  }
  if (sort === "updated") {
    return 3;
  }
  return 1;
};

const normalizePageSize = (pageSize?: number) =>
  Math.max(1, Math.min(MAX_PAGE_SIZE, pageSize ?? 12));

const fetchModrinthItems = async (
  filters: ExplorerFilters,
): Promise<ExplorerResult> => {
  const pageSize = normalizePageSize(filters.pageSize);
  const page = Math.max(0, filters.page ?? 0);
  const facets: string[][] = [[`project_type:${categoryProjectTypes[filters.category]}`]];

  if (filters.loader) {
    facets.push([`categories:${filters.loader.toLowerCase()}`]);
  }
  if (filters.gameVersion) {
    facets.push([`versions:${filters.gameVersion}`]);
  }

  const params = new URLSearchParams({
    query:
      filters.query?.trim() ||
      (filters.category === "Modpacks" ? "modpack" : "minecraft"),
    facets: JSON.stringify(facets),
    limit: String(pageSize),
    offset: String(page * pageSize),
    index: filters.sort === "updated" ? "updated" : "downloads",
  });

  const data = await apiFetch<ModrinthSearchResponse>(
    `${MODRINTH_BASE}/search?${params.toString()}`,
    { ttl: 45_000 },
  );

  const items = (data.hits ?? []).map((hit) => ({
    id: `modrinth-${hit.project_id}`,
    projectId: hit.project_id,
    name: hit.title,
    author: hit.author || "Autor desconocido",
    downloads: `${formatDownloads(hit.downloads)} descargas`,
    rawDownloads: hit.downloads,
    description: hit.description || "Sin descripción.",
    type: hit.project_type,
    source: "Modrinth" as const,
    updatedAt: hit.date_modified,
    versions: hit.versions ?? [],
    loaders: hit.categories ?? [],
    thumbnail: hit.icon_url,
    url: `https://modrinth.com/${hit.project_type}/${hit.slug}`,
  }));

  const total = data.total_hits ?? items.length;
  return {
    items,
    total,
    page,
    hasMore: (page + 1) * pageSize < total,
  };
};

const fetchCurseforgeItems = async (
  filters: ExplorerFilters,
): Promise<ExplorerResult> => {
  const apiKey = getCurseforgeApiKey();
  if (!apiKey) {
    return { items: [], hasMore: false, total: 0, page: filters.page ?? 0 };
  }

  const classId = curseforgeClassIds[filters.category];
  if (!classId) {
    return { items: [], hasMore: false, total: 0, page: filters.page ?? 0 };
  }

  const pageSize = normalizePageSize(filters.pageSize);
  const page = Math.max(0, filters.page ?? 0);

  const response = await apiFetch<CurseforgeSearchResponse>(
    `${CURSEFORGE_BASE}/mods/search?${new URLSearchParams(
      Object.entries({
        gameId: String(CURSE_MINECRAFT_GAME_ID),
        searchFilter:
          filters.query?.trim() ||
          (filters.category === "Modpacks" ? "modpack" : "minecraft"),
        gameVersion: filters.gameVersion,
        classId: String(classId),
        modLoaderType: filters.loader
          ? String(curseforgeLoaders[filters.loader.toLowerCase()] ?? "")
          : undefined,
        sortField: String(mapSort(filters.sort)),
        sortOrder: "desc",
        pageSize: String(pageSize),
        index: String(page * pageSize),
      }).reduce<Record<string, string>>((acc, [key, value]) => {
        if (value !== undefined && value !== "") {
          acc[key] = value;
        }
        return acc;
      }, {}),
    ).toString()}`,
    { init: { headers: { "x-api-key": apiKey } }, ttl: 45_000 },
  );

  const items = (response.data ?? []).map((item) => ({
    id: `curseforge-${item.id}`,
    projectId: String(item.id),
    name: item.name,
    author: item.authors?.[0]?.name || "CurseForge",
    downloads: item.downloadCount
      ? `${formatDownloads(item.downloadCount)} descargas`
      : "Descargas no disponibles",
    rawDownloads: item.downloadCount ?? 0,
    description: item.summary || "Sin descripción.",
    type: filters.category,
    source: "CurseForge" as const,
    updatedAt: item.dateReleased,
    versions:
      item.latestFilesIndexes
        ?.map((indexEntry) => indexEntry.gameVersion)
        .filter((value): value is string => Boolean(value)) ?? [],
    loaders: [],
    thumbnail: item.logo?.thumbnailUrl ?? item.logo?.url,
    url: item.links?.websiteUrl,
  }));

  const total = response.pagination?.totalCount ?? items.length;
  return {
    items,
    total,
    page,
    hasMore: (page + 1) * pageSize < total,
  };
};

const sortUnifiedItems = (items: ExplorerItem[], sort: ExplorerSort) => {
  if (sort === "updated") {
    return [...items].sort((a, b) =>
      (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
    );
  }
  if (sort === "relevance") {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }
  return [...items].sort((a, b) => b.rawDownloads - a.rawDownloads);
};

export const fetchUnifiedCatalog = async (
  filters: ExplorerFilters,
): Promise<ExplorerResult> => {
  const effective: ExplorerFilters = {
    ...filters,
    sort: filters.sort ?? "popular",
    platform: filters.platform ?? "all",
    page: filters.page ?? 0,
    pageSize: normalizePageSize(filters.pageSize),
  };

  const tasks: Array<Promise<ExplorerResult>> = [];
  if (effective.platform === "all" || effective.platform === "modrinth") {
    tasks.push(fetchModrinthItems(effective));
  }
  if (effective.platform === "all" || effective.platform === "curseforge") {
    tasks.push(fetchCurseforgeItems(effective));
  }

  const settled = await Promise.allSettled(tasks);
  const successful = settled.filter(
    (entry): entry is PromiseFulfilledResult<ExplorerResult> =>
      entry.status === "fulfilled",
  );

  if (!successful.length) {
    const rateLimited = settled.some(
      (entry) =>
        entry.status === "rejected" &&
        entry.reason instanceof Error &&
        entry.reason.message.includes("429"),
    );
    if (rateLimited) {
      throw new Error(
        "Las APIs alcanzaron el límite de solicitudes. Intenta nuevamente en unos segundos.",
      );
    }
    throw new Error("No se pudo conectar a los catálogos de Modrinth/CurseForge.");
  }

  const merged = successful.flatMap((entry) => entry.value.items);
  const unique = new Map<string, ExplorerItem>();
  merged.forEach((item) => {
    unique.set(item.id, item);
  });

  const ordered = sortUnifiedItems(Array.from(unique.values()), effective.sort ?? "popular");
  const total = successful.reduce((acc, entry) => acc + entry.value.total, 0);
  const hasMore = successful.some((entry) => entry.value.hasMore);

  return {
    items: ordered,
    total,
    hasMore,
    page: effective.page ?? 0,
  };
};

export const fetchExplorerItemDetails = async (
  item: ExplorerItem,
): Promise<ExplorerItemDetails> => {
  if (item.source === "Modrinth") {
    const data = await apiFetch<ModrinthProjectResponse>(
      `${MODRINTH_BASE}/project/${item.projectId}`,
      { ttl: 60_000 },
    );

    return {
      id: item.id,
      source: "Modrinth",
      title: data.title,
      author: item.author,
      description: data.description,
      body: data.body,
      gallery: [
        ...(data.icon_url ? [data.icon_url] : []),
        ...((data.gallery ?? []).map((image) => image.url).filter(Boolean) as string[]),
      ],
      gameVersions: data.game_versions ?? item.versions,
      loaders: data.categories ?? item.loaders,
      dependencies: [],
      downloads: data.downloads ?? item.rawDownloads,
      updatedAt: data.updated ?? item.updatedAt,
      url: item.url,
      type: data.project_type,
    };
  }

  const apiKey = getCurseforgeApiKey();
  if (!apiKey) {
    return {
      id: item.id,
      source: "CurseForge",
      title: item.name,
      author: item.author,
      description: item.description,
      gallery: item.thumbnail ? [item.thumbnail] : [],
      gameVersions: item.versions,
      loaders: item.loaders,
      dependencies: [],
      downloads: item.rawDownloads,
      updatedAt: item.updatedAt,
      url: item.url,
      type: item.type,
    };
  }

  const data = await apiFetch<CurseforgeModResponse>(
    `${CURSEFORGE_BASE}/mods/${item.projectId}`,
    { init: { headers: { "x-api-key": apiKey } }, ttl: 60_000 },
  );

  return {
    id: item.id,
    source: "CurseForge",
    title: data.data.name,
    author: data.data.authors?.[0]?.name || item.author,
    description: data.data.summary || item.description,
    gallery: [
      ...(data.data.logo?.url ? [data.data.logo.url] : []),
      ...((data.data.screenshots ?? [])
        .map((screen) => screen.url ?? screen.thumbnailUrl)
        .filter((url): url is string => Boolean(url))),
    ],
    gameVersions: data.data.latestFiles?.flatMap((file) => file.gameVersions ?? []) ?? [],
    loaders: item.loaders,
    dependencies:
      data.data.latestFiles
        ?.flatMap((file) => file.dependencies ?? [])
        .map((dep) => dep.modId)
        .filter((value): value is number => Boolean(value))
        .map(String) ?? [],
    downloads: data.data.downloadCount ?? item.rawDownloads,
    updatedAt: data.data.dateReleased ?? item.updatedAt,
    url: data.data.links?.websiteUrl ?? item.url,
    type: item.type,
  };
};

export const fetchExplorerItems = async (
  category: ExplorerCategory,
): Promise<ExplorerItem[]> => {
  const result = await fetchUnifiedCatalog({
    category,
    sort: "popular",
    pageSize: 12,
    page: 0,
    platform: "all",
  });
  return result.items;
};
