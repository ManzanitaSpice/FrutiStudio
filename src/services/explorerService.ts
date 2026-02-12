import { apiFetch } from "./apiClients/client";
import { invokeWithHandling } from "./tauriClient";
import { API_CONFIG } from "../config/api";

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

export interface ExplorerItemFileVersion {
  id: string;
  name: string;
  releaseType: "alpha" | "beta" | "release";
  publishedAt?: string;
  gameVersions: string[];
  loaders: string[];
  loaderVersion?: string;
  downloadUrl?: string;
  modId?: string;
  fileId?: string;
  dependencies?: string[];
}

export interface ExplorerItemDetails {
  id: string;
  source: "Modrinth" | "CurseForge" | "ATLauncher";
  title: string;
  author: string;
  description: string;
  body?: string;
  changelog?: string;
  gallery: string[];
  gameVersions: string[];
  loaders: string[];
  dependencies: string[];
  downloads: number;
  updatedAt?: string;
  url?: string;
  type: string;
  versions: ExplorerItemFileVersion[];
  primaryMinecraftVersion?: string;
  primaryLoader?: string;
  primaryLoaderVersion?: string;
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
  date_modified?: string;
  categories?: string[];
}

interface ModrinthSearchResponse {
  hits: ModrinthSearchHit[];
  total_hits: number;
}

interface ModrinthProjectResponse {
  title: string;
  description: string;
  body?: string;
  project_type: string;
  icon_url?: string;
  gallery?: Array<{ url: string }>;
  categories?: string[];
  game_versions?: string[];
  downloads?: number;
  updated?: string;
  versions?: string[];
}

interface ModrinthVersionResponse {
  id: string;
  version_number: string;
  name: string;
  version_type: "release" | "beta" | "alpha";
  date_published?: string;
  game_versions?: string[];
  loaders?: string[];
  files?: Array<{ url?: string }>;
  dependencies?: Array<{
    project_id?: string;
    version_id?: string;
    dependency_type?: "required" | "optional" | "incompatible" | "embedded";
  }>;
}

interface CurseforgeSearchItem {
  id: number;
  name: string;
  summary?: string;
  classId?: number;
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
    latestFiles?: Array<{
      id?: number;
      displayName?: string;
      fileName?: string;
      downloadUrl?: string;
      gameVersions?: string[];
      sortableGameVersions?: Array<{ gameVersionName?: string }>;
      dependencies?: Array<{ modId?: number; relationType?: number }>;
      fileDate?: string;
      releaseType?: number;
      modLoader?: number;
    }>;
  };
}

interface CurseforgeDescriptionResponse {
  data: string;
}

const MODRINTH_BASE = "https://api.modrinth.com/v2";
const CURSE_MINECRAFT_GAME_ID = 432;
const CURSE_MAX_PAGE_SIZE = 50;
const cache = new Map<
  string,
  { expiresAt: number; value: ExplorerResult | ExplorerItemDetails }
>();

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

const loaderFromCurseforge: Record<number, string> = {
  1: "forge",
  4: "fabric",
  5: "quilt",
  6: "neoforge",
};

const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const requestCurseforgeV1 = async <T>(
  path: string,
  apiKey?: string,
  query?: Record<string, string>,
): Promise<T> => {
  const params = query ? `?${new URLSearchParams(query).toString()}` : "";

  if (isTauriRuntime()) {
    return invokeWithHandling<T>("curseforge_v1_get", {
      path,
      query,
    });
  }

  const effectiveApiKey = apiKey?.trim() || API_CONFIG.curseforgeApiKey;

  if (effectiveApiKey) {
    return apiFetch<T>(`${API_CONFIG.curseforgeBase}${path}${params}`, {
      init: { headers: { "x-api-key": effectiveApiKey } },
      ttl: 45_000,
    });
  }

  let lastError: unknown;
  for (const base of API_CONFIG.curseforgeProxyBases) {
    try {
      return await apiFetch<T>(`${base}${path}${params}`, { ttl: 45_000 });
    } catch (error) {
      lastError = error;
      console.warn("[explorer] curseforge proxy failed", { base, path, error });
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `No se pudo conectar con CurseForge (proxy): ${lastError.message}`
      : "No se pudo conectar con CurseForge (proxy).",
  );
};

const stripHtml = (value: string) =>
  value
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const extractChangelog = (value?: string) => {
  if (!value) return "";
  const normalized = stripHtml(value);
  const parts = normalized.split(/\n{2,}/);
  const changelogStart = parts.findIndex((part) =>
    /novedades|changelog|changes/i.test(part),
  );
  if (changelogStart === -1) return "";
  return parts.slice(changelogStart).join("\n\n").trim();
};

const extractDescription = (summary: string, body?: string) => {
  if (!body) return summary;
  const normalized = stripHtml(body);
  if (!normalized) return summary;
  const sections = normalized.split(/\n{2,}/);
  const stopIndex = sections.findIndex((part) =>
    /novedades|changelog|changes/i.test(part),
  );
  const picked = stopIndex > 0 ? sections.slice(0, stopIndex).join("\n\n") : normalized;
  return picked || summary;
};

const resolveLoaderVersion = (displayName?: string, loader?: string) => {
  if (!displayName || !loader) return undefined;
  const regex = new RegExp(`${loader}[-\s:]?([0-9][0-9A-Za-z+._-]*)`, "i");
  const match = displayName.match(regex);
  return match?.[1];
};

const resolveReleaseType = (releaseType?: number): "alpha" | "beta" | "release" => {
  if (releaseType === 1) return "release";
  if (releaseType === 2) return "beta";
  return "alpha";
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
  Math.max(1, Math.min(CURSE_MAX_PAGE_SIZE, pageSize ?? 24));

const getCached = <T>(key: string): T | null => {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
};

const setCached = <T>(key: string, value: T, ttl = 45_000) => {
  cache.set(key, {
    value: value as ExplorerResult | ExplorerItemDetails,
    expiresAt: Date.now() + ttl,
  });
};

const buildCacheKey = (scope: string, filters: ExplorerFilters) =>
  `${scope}:${JSON.stringify({
    platform: filters.platform,
    category: filters.category,
    query: filters.query?.trim().toLowerCase(),
    gameVersion: filters.gameVersion,
    loader: filters.loader?.toLowerCase(),
    sort: filters.sort,
    page: filters.page,
    pageSize: filters.pageSize,
  })}`;

const fetchModrinthPage = async (filters: ExplorerFilters): Promise<ExplorerResult> => {
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

const fetchCurseforgePage = async (filters: ExplorerFilters): Promise<ExplorerResult> => {
  const classId = curseforgeClassIds[filters.category];

  const pageSize = normalizePageSize(filters.pageSize);
  const page = Math.max(0, filters.page ?? 0);

  const response = await requestCurseforgeV1<CurseforgeSearchResponse>(
    "/mods/search",
    undefined,
    Object.entries({
      gameId: String(CURSE_MINECRAFT_GAME_ID),
      searchFilter:
        filters.query?.trim() ||
        (filters.category === "Modpacks" ? "modpack" : "minecraft"),
      gameVersion: filters.gameVersion,
      classId: classId ? String(classId) : undefined,
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
  );

  const items = (response.data ?? [])
    .filter((item) => (classId ? item.classId === classId : true))
    .map((item) => ({
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
      loaders: Array.from(
        new Set(
          item.latestFilesIndexes
            ?.map((indexEntry) =>
              indexEntry.modLoader !== undefined
                ? loaderFromCurseforge[indexEntry.modLoader]
                : undefined,
            )
            .filter((value): value is string => Boolean(value)) ?? [],
        ),
      ),
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

  const cacheKey = buildCacheKey("catalog", effective);
  const cached = getCached<ExplorerResult>(cacheKey);
  if (cached) {
    console.debug("[explorer] cache hit", cacheKey);
    return cached;
  }
  console.info("[explorer] fetch catalog", effective);

  const tasks: Array<Promise<ExplorerResult>> = [];
  if (effective.platform === "all" || effective.platform === "modrinth") {
    tasks.push(fetchModrinthPage(effective));
  }
  if (effective.platform === "all" || effective.platform === "curseforge") {
    tasks.push(fetchCurseforgePage(effective));
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

  const ordered = sortUnifiedItems(
    Array.from(unique.values()),
    effective.sort ?? "popular",
  );
  const result: ExplorerResult = {
    items: ordered,
    total: successful.reduce((acc, entry) => acc + entry.value.total, 0),
    hasMore: successful.some((entry) => entry.value.hasMore),
    page: effective.page ?? 0,
  };

  setCached(cacheKey, result, 40_000);
  console.info("[explorer] catalog loaded", {
    page: result.page,
    total: result.total,
    hasMore: result.hasMore,
    count: result.items.length,
  });
  return result;
};

export const fetchExplorerItemDetails = async (
  item: ExplorerItem,
): Promise<ExplorerItemDetails> => {
  const detailKey = `${item.source}:${item.projectId}`;
  const cached = getCached<ExplorerItemDetails>(detailKey);
  if (cached) {
    console.debug("[explorer] detail cache hit", detailKey);
    return cached;
  }
  console.info("[explorer] fetch detail", {
    source: item.source,
    projectId: item.projectId,
  });

  if (item.source === "Modrinth") {
    const data = await apiFetch<ModrinthProjectResponse>(
      `${MODRINTH_BASE}/project/${item.projectId}`,
      { ttl: 60_000 },
    );

    const versionData = await apiFetch<ModrinthVersionResponse[]>(
      `${MODRINTH_BASE}/project/${item.projectId}/version`,
      { ttl: 60_000 },
    );

    const details: ExplorerItemDetails = {
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
      versions: (versionData ?? [])
        .map((version) => ({
          id: version.id,
          name: version.name || version.version_number,
          releaseType: version.version_type,
          publishedAt: version.date_published,
          gameVersions: version.game_versions ?? [],
          loaders: version.loaders ?? [],
          loaderVersion: resolveLoaderVersion(
            version.name || version.version_number,
            (version.loaders ?? [])[0],
          ),
          downloadUrl: version.files?.[0]?.url,
          dependencies: (version.dependencies ?? [])
            .filter((dependency) => dependency.dependency_type === "required")
            .map((dependency) => dependency.project_id)
            .filter((value): value is string => Boolean(value)),
        }))
        .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")),
      primaryMinecraftVersion: (versionData ?? []).flatMap(
        (version) => version.game_versions ?? [],
      )[0],
      primaryLoader: (versionData ?? []).flatMap((version) => version.loaders ?? [])[0],
      primaryLoaderVersion: undefined,
      changelog: extractChangelog(data.body),
    };
    setCached(detailKey, details, 60_000);
    return details;
  }

  const fallback: ExplorerItemDetails = {
    id: item.id,
    source: "CurseForge",
    title: item.name,
    author: item.author,
    description: item.description,
    body: item.description,
    changelog: "",
    gallery: item.thumbnail ? [item.thumbnail] : [],
    gameVersions: item.versions,
    loaders: item.loaders,
    dependencies: [],
    downloads: item.rawDownloads,
    updatedAt: item.updatedAt,
    url: item.url,
    type: item.type,
    versions: [],
    primaryMinecraftVersion: item.versions[0],
    primaryLoader: item.loaders[0],
    primaryLoaderVersion: undefined,
  };

  const data = await requestCurseforgeV1<CurseforgeModResponse>(
    `/mods/${item.projectId}`,
    undefined,
  ).catch((error) => {
    console.warn("[explorer] curseforge detail fallback", {
      projectId: item.projectId,
      error,
    });
    return null;
  });

  if (!data?.data) {
    return fallback;
  }

  const files = data.data.latestFiles ?? [];
  const versions = files.map((file, index) => {
    const allVersions = [
      ...(file.gameVersions ?? []),
      ...(file.sortableGameVersions
        ?.map((entry) => entry.gameVersionName)
        .filter((value): value is string => Boolean(value)) ?? []),
    ];
    const uniqueVersions = Array.from(new Set(allVersions));
    const detectedLoader =
      (file.modLoader !== undefined ? loaderFromCurseforge[file.modLoader] : undefined) ??
      uniqueVersions.find((value) => /fabric|forge|quilt|neoforge/i.test(value));
    const normalizedLoader = detectedLoader?.toLowerCase();
    const minecraftVersions = uniqueVersions.filter((value) =>
      /^\d+(\.\d+)+/.test(value),
    );
    return {
      id: String(file.id ?? file.fileName ?? file.displayName ?? `file-${index}`),
      name: file.displayName ?? file.fileName ?? "Versión sin nombre",
      releaseType: resolveReleaseType(file.releaseType),
      publishedAt: file.fileDate,
      gameVersions: minecraftVersions,
      loaders: normalizedLoader ? [normalizedLoader] : [],
      loaderVersion: resolveLoaderVersion(file.displayName, normalizedLoader),
      downloadUrl: file.downloadUrl,
      modId: item.projectId,
      fileId: String(file.id ?? ""),
      dependencies: (file.dependencies ?? [])
        .filter((dependency) => dependency.relationType === 3)
        .map((dependency) => dependency.modId)
        .filter((value): value is number => Boolean(value))
        .map(String),
    };
  });

  const sortedVersions = [...versions].sort((a, b) =>
    (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
  );
  const latestStable =
    sortedVersions.find((version) => version.releaseType === "release") ??
    sortedVersions[0];

  const descriptionResponse = await requestCurseforgeV1<CurseforgeDescriptionResponse>(
    `/mods/${item.projectId}/description`,
    undefined,
  ).catch(() => ({ data: data.data.summary ?? item.description }));

  const detailBody = extractDescription(
    data.data.summary || item.description,
    descriptionResponse.data,
  );

  const details: ExplorerItemDetails = {
    id: item.id,
    source: "CurseForge",
    title: data.data.name,
    author: data.data.authors?.[0]?.name || item.author,
    description: detailBody || data.data.summary || item.description,
    body: detailBody || data.data.summary || item.description,
    changelog: extractChangelog(descriptionResponse.data),
    gallery: [
      ...(data.data.logo?.url ? [data.data.logo.url] : []),
      ...(data.data.screenshots ?? [])
        .map((screen) => screen.url ?? screen.thumbnailUrl)
        .filter((url): url is string => Boolean(url)),
    ],
    gameVersions: Array.from(
      new Set(sortedVersions.flatMap((version) => version.gameVersions)),
    ),
    loaders: Array.from(new Set(sortedVersions.flatMap((version) => version.loaders))),
    dependencies: files
      .flatMap((file) => file.dependencies ?? [])
      .map((dep) => dep.modId)
      .filter((value): value is number => Boolean(value))
      .map(String),
    downloads: data.data.downloadCount ?? item.rawDownloads,
    updatedAt: data.data.dateReleased ?? item.updatedAt,
    url: data.data.links?.websiteUrl ?? item.url,
    type: item.type,
    versions: sortedVersions,
    primaryMinecraftVersion: latestStable?.gameVersions[0],
    primaryLoader: latestStable?.loaders[0],
    primaryLoaderVersion: latestStable?.loaderVersion,
  };

  setCached(detailKey, details, 60_000);
  return details;
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
