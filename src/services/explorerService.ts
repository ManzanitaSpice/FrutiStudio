import { apiFetch } from "./apiClients/client";
import { searchCurseforge } from "./curseService";
import { getCurseforgeApiKey } from "./curseforgeKeyService";
import {
  fetchPlanetMinecraftDataPacks,
  fetchPlanetMinecraftModpacks,
  fetchPlanetMinecraftResources,
  fetchPlanetMinecraftWorlds,
} from "./planetMinecraftService";

export type ExplorerCategory =
  | "Modpacks"
  | "Mods"
  | "Shaders"
  | "Resource Packs"
  | "Data Packs"
  | "Worlds"
  | "Addons";

export interface ExplorerItem {
  id: string;
  name: string;
  author: string;
  downloads: string;
  type: string;
  source: string;
  url?: string;
  imageUrl?: string;
}

interface ModrinthSearchHit {
  project_id: string;
  title: string;
  author: string;
  downloads: number;
  project_type: string;
  slug: string;
  icon_url?: string;
}

interface ModrinthSearchResponse {
  hits: ModrinthSearchHit[];
}

const MODRINTH_BASE = "https://api.modrinth.com/v2";

const categoryProjectTypes: Partial<Record<ExplorerCategory, string>> = {
  Modpacks: "modpack",
  Mods: "mod",
  Shaders: "shader",
  "Resource Packs": "resourcepack",
  "Data Packs": "datapack",
  Addons: "plugin",
};

const formatDownloads = (downloads: number) =>
  new Intl.NumberFormat("es-ES", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(downloads);

const buildSearchUrl = (
  category: ExplorerCategory,
  options?: {
    query?: string;
    limit?: number;
    loader?: string;
    gameVersion?: string;
    sort?: "popular" | "downloads" | "recent";
  },
) => {
  const projectType = categoryProjectTypes[category];
  const query = options?.query ?? (category === "Mods" ? "mod" : "minecraft");
  const facets: string[][] = [];
  if (projectType) {
    facets.push([`project_type:${projectType}`]);
  }
  if (options?.loader && options.loader !== "Todos") {
    facets.push([`categories:${options.loader.toLowerCase()}`]);
  }
  if (options?.gameVersion && options.gameVersion !== "Todas") {
    facets.push([`versions:${options.gameVersion}`]);
  }
  const facetsParam = facets.length
    ? `&facets=${encodeURIComponent(JSON.stringify(facets))}`
    : "";
  const limit = options?.limit ?? 24;
  const index =
    options?.sort === "downloads"
      ? "downloads"
      : options?.sort === "recent"
        ? "newest"
        : "relevance";
  return `${MODRINTH_BASE}/search?query=${encodeURIComponent(
    query,
  )}${facetsParam}&limit=${limit}&index=${index}`;
};

const fetchModrinthItems = async (
  category: ExplorerCategory,
  options?: {
    query?: string;
    limit?: number;
    loader?: string;
    gameVersion?: string;
    sort?: "popular" | "downloads" | "recent";
  },
): Promise<ExplorerItem[]> => {
  const url = buildSearchUrl(category, options);
  const data = await apiFetch<ModrinthSearchResponse>(url, { ttl: 120_000 });
  return (data.hits ?? []).map((hit) => ({
    id: hit.project_id,
    name: hit.title,
    author: hit.author,
    downloads: `${formatDownloads(hit.downloads)} descargas`,
    type: hit.project_type,
    source: "Modrinth",
    url: `https://modrinth.com/${hit.project_type}/${hit.slug}`,
    imageUrl: hit.icon_url,
  }));
};

const curseforgeClassIds: Partial<Record<ExplorerCategory, number>> = {
  Mods: 6,
  Modpacks: 4471,
  "Resource Packs": 12,
};

const fetchCurseforgeItems = async (
  category: ExplorerCategory,
  apiKey: string,
  options?: { query?: string; limit?: number },
): Promise<ExplorerItem[]> => {
  const classId = curseforgeClassIds[category];
  if (!classId) {
    return [];
  }
  const results = await searchCurseforge({
    apiKey,
    query: options?.query ?? "minecraft",
    classId,
    pageSize: options?.limit ?? 24,
  });
  return results.map((item) => ({
    id: String(item.id),
    name: item.name,
    author: "CurseForge",
    downloads: item.downloadCount
      ? `${formatDownloads(item.downloadCount)} descargas`
      : "Descargas",
    type: category,
    source: "CurseForge",
    url: item.websiteUrl,
    imageUrl: item.logoUrl,
  }));
};

const fetchPlanetMinecraftItems = async (
  category: ExplorerCategory,
  options?: { limit?: number },
): Promise<ExplorerItem[]> => {
  switch (category) {
    case "Modpacks": {
      const items = await fetchPlanetMinecraftModpacks();
      return items.slice(0, options?.limit ?? 12).map((item) => ({
        id: item.id,
        name: item.title,
        author: item.author,
        downloads: "Comunidad",
        type: "Modpack",
        source: "PlanetMinecraft",
        url: item.link,
      }));
    }
    case "Resource Packs": {
      const items = await fetchPlanetMinecraftResources();
      return items.slice(0, options?.limit ?? 12).map((item) => ({
        id: item.id,
        name: item.title,
        author: item.author,
        downloads: "Comunidad",
        type: "Resource Pack",
        source: "PlanetMinecraft",
        url: item.link,
      }));
    }
    case "Worlds": {
      const items = await fetchPlanetMinecraftWorlds();
      return items.slice(0, options?.limit ?? 12).map((item) => ({
        id: item.id,
        name: item.title,
        author: item.author,
        downloads: "Comunidad",
        type: "World",
        source: "PlanetMinecraft",
        url: item.link,
      }));
    }
    case "Data Packs": {
      const items = await fetchPlanetMinecraftDataPacks();
      return items.slice(0, options?.limit ?? 12).map((item) => ({
        id: item.id,
        name: item.title,
        author: item.author,
        downloads: "Comunidad",
        type: "Data Pack",
        source: "PlanetMinecraft",
        url: item.link,
      }));
    }
    default:
      return [];
  }
};

export const fetchExplorerItems = async (
  category: ExplorerCategory,
  options?: {
    query?: string;
    limit?: number;
    loader?: string;
    gameVersion?: string;
    sort?: "popular" | "downloads" | "recent";
  },
): Promise<ExplorerItem[]> => {
  const tasks: Array<Promise<ExplorerItem[]>> = [
    fetchModrinthItems(category, options),
  ];
  const curseforgeApiKey = getCurseforgeApiKey();
  if (curseforgeApiKey) {
    tasks.push(fetchCurseforgeItems(category, curseforgeApiKey, options));
  }
  tasks.push(fetchPlanetMinecraftItems(category, options));

  const results = await Promise.allSettled(tasks);
  const items = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  if (!items.length) {
    const hasError = results.some((result) => result.status === "rejected");
    if (hasError) {
      throw new Error("No se pudo conectar a las fuentes disponibles.");
    }
  }
  const unique = new Map<string, ExplorerItem>();
  items.forEach((item) => {
    unique.set(`${item.source}-${item.id}`, item);
  });
  return Array.from(unique.values());
};
