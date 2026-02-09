import { apiFetch } from "./apiClients/client";

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
}

interface ModrinthSearchHit {
  project_id: string;
  title: string;
  author: string;
  downloads: number;
  project_type: string;
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

const buildSearchUrl = (category: ExplorerCategory) => {
  const projectType = categoryProjectTypes[category];
  const query = category === "Mods" ? "mod" : "minecraft";
  const facets = projectType
    ? `&facets=${encodeURIComponent(
        JSON.stringify([[`project_type:${projectType}`]]),
      )}`
    : "";
  return `${MODRINTH_BASE}/search?query=${encodeURIComponent(
    query,
  )}${facets}&limit=6`;
};

export const fetchExplorerItems = async (
  category: ExplorerCategory,
): Promise<ExplorerItem[]> => {
  const url = buildSearchUrl(category);
  const data = await apiFetch<ModrinthSearchResponse>(url, { ttl: 120_000 });
  return (data.hits ?? []).map((hit) => ({
    id: hit.project_id,
    name: hit.title,
    author: hit.author,
    downloads: `${formatDownloads(hit.downloads)} descargas`,
    type: hit.project_type,
  }));
};
