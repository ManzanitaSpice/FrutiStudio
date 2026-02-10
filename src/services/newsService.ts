import { type ExplorerCategory, type ExplorerItem, type ExplorerResult, fetchUnifiedCatalog } from "./explorerService";

export interface NewsHeroItem {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  cta: string;
  source: string;
  thumbnail?: string;
  url?: string;
}

export interface NewsTrendingItem {
  id: string;
  title: string;
  type: string;
  source: string;
  thumbnail?: string;
  url?: string;
}

export interface NewsLatestItem {
  id: string;
  name: string;
  author: string;
  type: string;
  source: string;
  thumbnail?: string;
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
  catalogItems: ExplorerItem[];
  featuredItems: NewsHeroItem[];
  trendingItems: NewsTrendingItem[];
  latestItems: NewsLatestItem[];
  curatedLists: NewsCuratedList[];
  categories: string[];
  warnings: string[];
}

export const fetchNewsOverview = async (): Promise<NewsOverview> => {
  const warnings: string[] = [];
  const categories: ExplorerCategory[] = ["Modpacks", "Mods", "Shaders", "Resource Packs", "Data Packs", "Addons"];

  const settled = await Promise.allSettled(
    categories.map((category) =>
      fetchUnifiedCatalog({
        category,
        sort: "popular",
        page: 0,
        pageSize: 8,
        platform: "all",
      }),
    ),
  );

  const catalogItems = settled
    .filter((result): result is PromiseFulfilledResult<ExplorerResult> => result.status === "fulfilled")
    .flatMap((result) => result.value.items);

  if (settled.some((result) => result.status === "rejected")) {
    warnings.push("Se cargó parcialmente el feed de novedades por límites de API.");
  }

  const featuredItems = catalogItems.slice(0, 4).map((item) => ({
    id: item.id,
    title: item.name,
    subtitle: `${item.type} · ${item.downloads}`,
    description: item.description,
    cta: "Ver detalles",
    source: item.source,
    thumbnail: item.thumbnail,
    url: item.url,
  }));

  const trendingItems = [...catalogItems]
    .sort((a, b) => b.rawDownloads - a.rawDownloads)
    .slice(0, 12)
    .map((item) => ({
      id: item.id,
      title: item.name,
      type: item.type,
      source: item.source,
      thumbnail: item.thumbnail,
      url: item.url,
    }));

  const latestItems = [...catalogItems]
    .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
    .slice(0, 18)
    .map((item) => ({
      id: item.id,
      name: item.name,
      author: item.author,
      type: item.type,
      source: item.source,
      thumbnail: item.thumbnail,
      url: item.url,
    }));

  return {
    catalogItems,
    featuredItems,
    trendingItems,
    latestItems,
    curatedLists: [],
    categories,
    warnings,
  };
};