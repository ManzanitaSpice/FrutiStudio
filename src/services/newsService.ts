import { apiFetch } from "./apiClients/client";
import { searchCurseforge } from "./curseService";
import { getCurseforgeApiKey } from "./curseforgeKeyService";
import { fetchPlanetMinecraftModpacks } from "./planetMinecraftService";

interface ModrinthSearchHit {
  project_id: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  project_type: string;
  slug: string;
}

interface ModrinthSearchResponse {
  hits: ModrinthSearchHit[];
}

export interface NewsHeroItem {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  cta: string;
  source: string;
  url?: string;
}

export interface NewsTrendingItem {
  id: string;
  title: string;
  type: string;
  source: string;
  url?: string;
}

export interface NewsLatestItem {
  id: string;
  name: string;
  author: string;
  type: string;
  source: string;
  url?: string;
}

export interface NewsCuratedList {
  id: string;
  title: string;
  items: string[];
  source: string;
  url?: string;
}

export interface NewsOverview {
  featuredItems: NewsHeroItem[];
  trendingItems: NewsTrendingItem[];
  latestItems: NewsLatestItem[];
  curatedLists: NewsCuratedList[];
  categories: string[];
  warnings: string[];
}

const MODRINTH_BASE = "https://api.modrinth.com/v2";

const formatDownloads = (downloads: number) =>
  new Intl.NumberFormat("es-ES", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(downloads);

const fetchModrinthSearch = async (query: string, projectType: string) => {
  const facets = JSON.stringify([[`project_type:${projectType}`]]);
  const url = `${MODRINTH_BASE}/search?query=${encodeURIComponent(
    query,
  )}&facets=${encodeURIComponent(facets)}&limit=6`;
  const data = await apiFetch<ModrinthSearchResponse>(url, { ttl: 120_000 });
  return data.hits ?? [];
};

export const fetchNewsOverview = async (): Promise<NewsOverview> => {
  const warnings: string[] = [];
  const modrinthModpacks = await fetchModrinthSearch("modpack", "modpack");
  const modrinthMods = await fetchModrinthSearch("mod", "mod");
  const planetModpacks = await fetchPlanetMinecraftModpacks();

  const featuredItems = modrinthModpacks.slice(0, 3).map((item) => ({
    id: item.project_id,
    title: item.title,
    subtitle: `Modpack · ${formatDownloads(item.downloads)} descargas`,
    description: item.description,
    cta: "Ver detalles",
    source: "Modrinth",
    url: `https://modrinth.com/modpack/${item.slug}`,
  }));

  const trendingItems = modrinthMods.slice(0, 8).map((item) => ({
    id: item.project_id,
    title: item.title,
    type: `Mod · ${formatDownloads(item.downloads)} descargas`,
    source: "Modrinth",
    url: `https://modrinth.com/mod/${item.slug}`,
  }));

  const latestItems = planetModpacks.slice(0, 6).map((item) => ({
    id: item.id,
    name: item.title,
    author: item.author,
    type: item.category,
    source: "PlanetMinecraft",
    url: item.link,
  }));

  const curatedLists: NewsCuratedList[] = [];
  const curseforgeApiKey = getCurseforgeApiKey();
  if (curseforgeApiKey) {
    try {
      const curseforgeMods = await searchCurseforge({
        apiKey: curseforgeApiKey,
        query: "modpack",
        classId: 4471,
        pageSize: 5,
      });
      curatedLists.push({
        id: "curseforge-top",
        title: "Modpacks destacados en CurseForge",
        items: curseforgeMods.map((item) => item.name),
        source: "CurseForge",
      });
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? `CurseForge: ${error.message}`
          : "CurseForge: error al conectar.",
      );
    }
  } else {
    warnings.push("CurseForge: agrega tu API key para ver listas.");
  }

  const categories = [
    "Modpacks",
    "Mods",
    "Shaders",
    "Resource Packs",
    "Data Packs",
    "Worlds",
  ];

  return {
    featuredItems,
    trendingItems,
    latestItems,
    curatedLists,
    categories,
    warnings,
  };
};
