import { fetchUnifiedCatalog } from "./explorerService";

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
  featuredItems: NewsHeroItem[];
  trendingItems: NewsTrendingItem[];
  latestItems: NewsLatestItem[];
  curatedLists: NewsCuratedList[];
  categories: string[];
  warnings: string[];
}

export const fetchNewsOverview = async (): Promise<NewsOverview> => {
  const warnings: string[] = [];

  const [popular, updated, relevant] = await Promise.allSettled([
    fetchUnifiedCatalog({
      category: "Modpacks",
      sort: "popular",
      page: 0,
      pageSize: 8,
      platform: "all",
    }),
    fetchUnifiedCatalog({
      category: "Modpacks",
      sort: "updated",
      page: 0,
      pageSize: 8,
      platform: "all",
    }),
    fetchUnifiedCatalog({
      category: "Mods",
      sort: "relevance",
      page: 0,
      pageSize: 8,
      platform: "all",
    }),
  ]);

  const popularItems = popular.status === "fulfilled" ? popular.value.items : [];
  const updatedItems = updated.status === "fulfilled" ? updated.value.items : [];
  const relevantItems = relevant.status === "fulfilled" ? relevant.value.items : [];

  if (popular.status === "rejected" || updated.status === "rejected") {
    warnings.push("Se cargó parcialmente el feed de novedades por límites de API.");
  }

  const featuredItems = popularItems.slice(0, 3).map((item) => ({
    id: item.id,
    title: item.name,
    subtitle: `${item.type} · ${item.downloads}`,
    description: item.description,
    cta: "Ver detalles",
    source: item.source,
    thumbnail: item.thumbnail,
    url: item.url,
  }));

  const trendingItems = relevantItems.map((item) => ({
    id: item.id,
    title: item.name,
    type: item.type,
    source: item.source,
    thumbnail: item.thumbnail,
    url: item.url,
  }));

  const latestItems = updatedItems.map((item) => ({
    id: item.id,
    name: item.name,
    author: item.author,
    type: item.type,
    source: item.source,
    thumbnail: item.thumbnail,
    url: item.url,
  }));

  const curatedLists: NewsCuratedList[] = [
    {
      id: "popular-global",
      title: "Más populares",
      items: popularItems.slice(0, 5).map((item) => item.name),
      source: "Modrinth + CurseForge",
    },
  ];

  return {
    featuredItems,
    trendingItems,
    latestItems,
    curatedLists,
    categories: [
      "Modpacks",
      "Mods",
      "Shaders",
      "Resource Packs",
      "Data Packs",
      "Addons",
    ],
    warnings,
  };
};
